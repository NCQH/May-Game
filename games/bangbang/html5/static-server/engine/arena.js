/* Browser port of server/battle_runtime.py (Arena + TankActions base).
 *
 * Faithful to the generic mechanics: ordered event queue, movement/geometry,
 * buff add/remove/expiry, speed/stat recomputation, shields, damage pipeline,
 * projectiles, respawn and the C501/C503/C510 input handlers.
 *
 * Tank-specific behaviour lives in the 91 *_actions.py subclasses. This base
 * exposes the same method names and hooks so those can be ported one by one.
 * Anything mode-only (PK scoring, PvE maps, world boss, map objectives,
 * borrowed views, crystal/guild/military loadouts) is an overridable hook
 * returning the neutral value.
 */
import {
  D, ZERO, ONE, PERMANENT, quantize, damageAmount, applyDamage, heal,
  pyRound, pointAt, distance, rectContact, actorContact, sumDec,
} from './math.js';
import { createData, setActiveData } from './data.js';
import {
  scene, stopMove, moveEvent, skillEvent, tankInfo, objectInfo,
  encodeS1550, encodeS1553, encodeS1556, encodeS1558, encodeS1559, encodeS1560,
  encodeS1562, encodeS1572, encodeS1579, encodeS1581, encodeS1605,
} from './protocol.js';

export const DIRECTIONS = [
  [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [0, 0],
];
export const TANK_CONTACT_RADIUS = 36;
export const TANK_MOVE_HALF = 36;

/** Python scene() already returns (1564, body); keep the packet shape. */
export function scenePacket(vectors) { return scene(vectors); }

export function bkey(id, template) { return `${id},${template}`; }
export function parseBkey(key) { return key.split(',').map(Number); }
export function inRange(value, low, high) { return value >= low && value <= high; }

/** Python dict-like packet with recipient metadata. */
export class TargetedPacket extends Array {
  constructor(msgId, body, { viewers = null, exclude = [] } = {}) {
    super(msgId, body);
    this.viewers = viewers === null ? null : new Set(viewers);
    this.exclude = new Set(exclude);
  }
}

export function human(actor) {
  return Boolean(!actor.info.npc_template && actor.info.human !== false && (actor.info.human || actor.id === 1));
}

export function privatePacket(actor, packet) {
  return new TargetedPacket(packet[0], packet[1], { viewers: [actor.id] });
}

export function otherViewers(actor, packet) {
  return new TargetedPacket(packet[0], packet[1], { exclude: [actor.id] });
}

export function friendly(actor, packet) {
  if (actor.arena.state?.multiplayer_players) {
    return [new TargetedPacket(packet[0], packet[1], {
      viewers: [...actor.arena.actors.values()].filter(a => human(a) && a.camp === actor.camp).map(a => a.id),
    })];
  }
  return actor.camp === actor.arena.player.camp ? [packet] : [];
}

export function forViewer(packets, actor) {
  const result = [];
  for (const packet of packets) {
    const viewers = packet.viewers ?? null;
    if ((viewers && !viewers.has(actor.id)) || packet.exclude?.has(actor.id)) continue;
    let [mid, body] = packet;
    if (mid === 1579) {
      const owner = body.length >= 26
        ? new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(22, true) : 1;
      mid = 1572;
      const out = new Uint8Array(26);
      out.set(body.subarray(0, 22)); out.set(body.subarray(22, 26), 22);
      new DataView(out.buffer).setUint32(22, owner, true);
      body = out;
    }
    if ([1581, 1585, 1588, 1590].includes(mid) && viewers === null && actor.id !== 1) continue;
    if (mid === 1550 && new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(0, true) !== actor.id) continue;
    result.push([mid, body]);
  }
  return result;
}

function sameShields(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].shield_id !== b[i].shield_id || !D(a[i].remaining).eq(b[i].remaining)
      || a[i].expires_ms !== b[i].expires_ms) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// BattleMap: immutable cached geometry per arena (battle_map.py).

export class BattleMap {
  constructor(definition) {
    this.data = definition;
    this.id = Number(definition.id ?? definition.mapId ?? 0);
    this.width = definition.width;
    this.height = definition.height;
    this.bounds = [...definition.bounds];
    this.walls = (definition.walls || []).map(rect => [...rect]);
    this.movementWalls = (definition.movementWalls || definition.walls || []).map(rect => [...rect]);
    this._playableExterior = this.id === 7 ? [[0, 0, this.width, 216], [0, 0, 216, 504]] : [];
    this._bulletBins = BattleMap._index(this.walls);
    this._moveBins = BattleMap._index(this.movementWalls);

    const objects = [];
    for (const npc of definition.npcs || []) {
      if (this.id === 70 && npc.script_only) continue;
      const type = Number(npc.type ?? npc.iType ?? 0);
      if ([51, 52, 53].includes(type)) continue;
      if (Array.isArray(npc.rectangle)) { objects.push([...npc.rectangle]); continue; }
      const w = Number(npc.width ?? npc.iWidth ?? 0), h = Number(npc.height ?? npc.iHeight ?? 0);
      if (w && h) objects.push([npc.x - w / 2, npc.y - h / 2, npc.x + w / 2, npc.y + h / 2]);
    }
    for (const barrier of definition.pve_barriers || []) objects.push([...barrier.rect]);
    this._walkObjects = objects;
    this._walkTerrain = BattleMap._subtract(this.movementWalls, this._walkObjects);
    this._walkTerrainBins = BattleMap._index(this._walkTerrain);
    this._walkObjectBins = BattleMap._index(this._walkObjects);
  }

  static _index(rectangles) {
    const bins = new Map();
    for (const rect of rectangles) {
      const [l, t, r, b] = rect;
      for (let x = Math.floor(l / 192); x <= Math.floor(r / 192); x += 1) {
        for (let y = Math.floor(t / 192); y <= Math.floor(b / 192); y += 1) {
          const key = `${x},${y}`;
          if (!bins.has(key)) bins.set(key, new Set());
          bins.get(key).add(rect);
        }
      }
    }
    return bins;
  }

  /** Python Counter difference uses rectangle values, not array identity. */
  static _subtract(rectangles, removed) {
    const key = rect => rect.join(',');
    const counts = new Map();
    for (const rect of rectangles) counts.set(key(rect), { rect, count: (counts.get(key(rect))?.count || 0) + 1 });
    for (const rect of removed) {
      const entry = counts.get(key(rect));
      if (entry) entry.count -= 1;
    }
    const out = [];
    for (const { rect, count } of counts.values()) for (let i = 0; i < count; i += 1) out.push(rect);
    return out;
  }

  spawn(camp, index = 0, { respawn = false } = {}) {
    const rows = this.data[respawn ? 'respawns' : 'spawns'];
    const points = rows?.[String(camp)] ?? rows?.[camp];
    if (!points?.length) throw new Error(`Map ${this.id} has no spawn for camp ${camp}`);
    return [...points[index % points.length]];
  }

  inside(pos) {
    return pos[0] >= 0 && pos[0] <= this.width && pos[1] >= 0 && pos[1] <= this.height;
  }

  clampTankPosition(pos) {
    const [l, t, r, b] = this.bounds;
    return [pyRound(Math.min(r, Math.max(l, pos[0]))), pyRound(Math.min(b, Math.max(t, pos[1])))];
  }

  inPlayableRegion(pos) {
    return !this._playableExterior.length || rectContact(pos, pos, this._playableExterior, 35.999) === null;
  }

  _clipPlayableMotion(start, dest) {
    if (!this._playableExterior.length) return dest;
    const hit = rectContact(start, dest, this._playableExterior, 35.999);
    if (hit === null) return dest;
    const edge = pointAt(start, dest, hit);
    return edge.map((z, i) => (z > start[i] ? Math.floor(z) : z < start[i] ? Math.ceil(z) : pyRound(z)));
  }

  clipTankMotion(start, dest) {
    start = this.clampTankPosition(start);
    const [l, t, r, b] = this.bounds;
    let fraction = 1;
    for (let i = 0; i < 2; i += 1) {
      const a = start[i], z = dest[i], lo = i === 0 ? l : t, hi = i === 0 ? r : b;
      if (z > hi) fraction = Math.min(fraction, (hi - a) / (z - a));
      else if (z < lo) fraction = Math.min(fraction, (lo - a) / (z - a));
    }
    return this._clipPlayableMotion(start, this.clampTankPosition(pointAt(start, dest, fraction)));
  }

  clearTankLanding(start, dest, water = []) {
    dest = this._clipPlayableMotion(start, dest.map(pyRound));
    const landingWalls = this.movementWalls.concat(this._playableExterior);
    for (let i = 0; i < landingWalls.length; i += 1) {
      const blocked = landingWalls.filter(rect => rectContact(dest, dest, [rect], 35.999) !== null);
      if (!blocked.length) return this._mobileTankLanding(start, dest, water);
      const fraction = Math.min(...blocked.map(rect => rectContact(start, dest, [rect], 36)));
      if (fraction <= 0) return start.map(pyRound);
      const edge = pointAt(start, dest, fraction);
      dest = edge.map((z, axis) => (z > start[axis] ? Math.floor(z)
        : z < start[axis] ? Math.ceil(z) : pyRound(z)));
    }
    return start.map(pyRound);
  }

  _mobileTankLanding(start, dest, water = []) {
    const directions = DIRECTIONS.slice(0, 8);
    const mobile = pos => directions.some(([x, y]) =>
      this.canWalkStep(pos, [pos[0] + 24 * x, pos[1] + 24 * y], water));
    if (mobile(dest)) return dest;
    start = this.clampTankPosition(start);
    const steps = Math.max(1, Math.ceil(Math.max(...start.map((v, i) => Math.abs(dest[i] - v)))));
    let previous = dest;
    for (let i = steps - 1; i >= 0; i -= 1) {
      const point = pointAt(start, dest, i / steps).map(pyRound);
      if (point[0] === previous[0] && point[1] === previous[1]) continue;
      previous = point;
      if (!this.canWalkTo(point) || this.wallContact(point, point, 35.999) !== null) continue;
      if (rectContact(start, point, water, 35.999) !== null) continue;
      if (mobile(point)) return point;
    }
    return dest;
  }

  wallContact(start, dest, padding = 0, { exclude = [], bullets = false } = {}) {
    // Python: bullets or no padding -> bullet/static walls; padded probes -> move walls.
    const useBullet = bullets || !padding;
    const bins = useBullet ? this._bulletBins : this._moveBins;
    const rects = new Set();
    for (let x = Math.floor((Math.min(start[0], dest[0]) - padding) / 192);
      x <= Math.floor((Math.max(start[0], dest[0]) + padding) / 192); x += 1) {
      for (let y = Math.floor((Math.min(start[1], dest[1]) - padding) / 192);
        y <= Math.floor((Math.max(start[1], dest[1]) + padding) / 192); y += 1) {
        for (const rect of bins.get(`${x},${y}`) || []) rects.add(rect);
      }
    }
    if (exclude.length) {
      const ex = new Set(exclude.map(r => r.join(',')));
      for (const rect of [...rects]) if (ex.has(rect.join(','))) rects.delete(rect);
    }
    return rectContact(start, dest, rects, padding);
  }

  _walkContact(start, end, { objects = false } = {}) {
    const bins = objects ? this._walkObjectBins : this._walkTerrainBins;
    const rects = new Set();
    for (let x = Math.floor((Math.min(start[0], end[0]) - 36) / 192);
      x <= Math.floor((Math.max(start[0], end[0]) + 36) / 192); x += 1) {
      for (let y = Math.floor((Math.min(start[1], end[1]) - 36) / 192);
        y <= Math.floor((Math.max(start[1], end[1]) + 36) / 192); y += 1) {
        for (const rect of bins.get(`${x},${y}`) || []) rects.add(rect);
      }
    }
    return rectContact(start, end, rects, 35.999);
  }

  _walkBounds(pos) {
    const [l, t, r, b] = this.bounds;
    return l <= pos[0] && pos[0] <= r && t <= pos[1] && pos[1] <= b && this.inPlayableRegion(pos);
  }

  static _walkGrid(pos) {
    return pos.map(v => Math.floor((v - 36) / 24) * 24 + 36);
  }

  _walkGridClear(pos) {
    const grid = BattleMap._walkGrid(pos);
    return this._walkBounds(grid) && this._walkContact(grid, grid) === null;
  }

  canWalkTo(pos) {
    return this._walkBounds(pos) && this._walkContact(pos, pos, { objects: true }) === null
      && (this._walkGridClear(pos) || this._walkContact(pos, pos) === null);
  }

  canWalkStep(start, dest, water = []) {
    if (!this.canWalkTo(start) || !this.canWalkTo(dest)) return false;
    if (this._walkContact(start, dest, { objects: true }) !== null
      || rectContact(start, dest, water, 35.999) !== null
      || rectContact(start, dest, this._playableExterior, 35.999) !== null) return false;
    if (this._walkContact(start, dest) === null) return true;
    const cuts = new Set([0, 1]);
    for (let axis = 0; axis < 2; axis += 1) {
      const a = start[axis], b = dest[axis];
      if (a === b) continue;
      const lo = Math.min(a, b), hi = Math.max(a, b);
      for (let cell = Math.floor((lo - 36) / 24) + 1; cell < Math.ceil((hi - 36) / 24); cell += 1) {
        const fraction = (36 + 24 * cell - a) / (b - a);
        if (fraction > 0 && fraction < 1) cuts.add(fraction);
      }
    }
    const sorted = [...cuts].sort((a, b) => a - b);
    const at = t => pointAt(start, dest, t);
    if (sorted.slice(1, -1).some(t => !this.canWalkTo(at(t)))) return false;
    for (let i = 1; i < sorted.length; i += 1) {
      const left = sorted[i - 1], right = sorted[i];
      if (this._walkGridClear(at((left + right) / 2))) continue;
      if (this._walkContact(at(left), at(right)) !== null) return false;
    }
    return true;
  }

  recoverWalkPosition(pos, water = [], occupied = []) {
    if (this.canWalkTo(pos) && rectContact(pos, pos, water, 35.999) === null) return pos;
    if (!this._walkBounds(pos)) return null;
    const rectangles = [...new Set([...this.movementWalls, ...this._playableExterior, ...water]
      .map(rect => rect.join(',')))].map(text => text.split(',').map(Number));
    const overlaps = rectangles.filter(rect => rectContact(pos, pos, [rect], 35.999) !== null);
    if (!overlaps.length) return null;
    const xs = new Set([pos[0]]), ys = new Set([pos[1]]);
    const exits = [];
    for (const [l, t, r, b] of overlaps) {
      const distances = [pos[0] - (l - 36), r + 36 - pos[0], pos[1] - (t - 36), b + 36 - pos[1]];
      const nearest = Math.min(...distances);
      const sides = new Set(distances.flatMap((d, i) => (d <= nearest + 0.001 ? [i] : [])));
      exits.push([l, t, r, b, sides]);
      if (sides.has(0)) xs.add(Math.floor(l - 36));
      if (sides.has(1)) xs.add(Math.ceil(r + 36));
      if (sides.has(2)) ys.add(Math.floor(t - 36));
      if (sides.has(3)) ys.add(Math.ceil(b + 36));
    }
    const others = rectangles.filter(rect => !overlaps.some(o => o.join(',') === rect.join(',')));
    const legal = [];
    for (const x of xs) for (const y of ys) {
      const dest = [x, y];
      if (x === pos[0] && y === pos[1]) continue;
      if (Math.max(Math.abs(x - pos[0]), Math.abs(y - pos[1])) > 24) continue;
      if (!this.canWalkTo(dest) || rectContact(dest, dest, rectangles, 35.999) !== null) continue;
      if (occupied.some(other => distance(dest, other) < 72)) continue;
      if (rectContact(pos, dest, others, 35.999) !== null) continue;
      if (!exits.every(([l, t, r, b, sides]) =>
        (sides.has(0) && x <= l - 36) || (sides.has(1) && x >= r + 36)
        || (sides.has(2) && y <= t - 36) || (sides.has(3) && y >= b + 36))) continue;
      legal.push(dest);
    }
    legal.sort((a, b) => distance(pos, a) - distance(pos, b) || a[0] - b[0] || a[1] - b[1]);
    return legal.length ? legal[0] : null;
  }

  walkEnd(start, dest, water = []) {
    const steps = Math.max(1, Math.ceil(Math.max(...start.map((v, i) => Math.abs(dest[i] - v))) / 24));
    let end = [...start];
    for (let i = 1; i <= steps; i += 1) {
      const point = pointAt(start, dest, i / steps).map(pyRound);
      if (!this.canWalkStep(end, point, water)) break;
      end = point;
    }
    return end;
  }
}

// ---------------------------------------------------------------------------
// Arena: ordered event queue, actors, projectiles.

export class BattleArena {
  constructor(state, {
    clock = null, rng = null, botAttacks = false, serialStart = 0,
    data = null, battleMap = null, classes = null,
  } = {}) {
    this.state = state;
    this.humanStates = new Map((state.multiplayer_players || []).map(p => [p.object_id, p.state]));
    this.clock = clock || (() => Date.now());
    this.rng = rng || Math.random;
    this.sceneId = state.battle?.scene_id ?? state.scene_id ?? 1;
    this.battle = state.battle || {};
    this.data = createData(data || state.data || {});
    setActiveData(this.data);
    const mapId = state.room?.map_id ?? state.map_id ?? 101;
    this.geometry = new BattleMap(battleMap || this.data.mapDefinition(mapId));
    this.tankTest = this.geometry.id === 7 && Boolean(state.room?.tank_test);
    this.botAttacks = botAttacks && !this.tankTest;
    this.serial = serialStart;
    this.eventSerial = 0;
    this.pending = [];
    this.activeBuffs = new Map();
    this.objects = new Map();
    this.pk = state.pk || null;
    this.botBrains = new Map();
    this.damageContext = null;
    this.currentFlight = null;
    this.eventNow = null;
    this.isMultiplayer = Boolean(state.multiplayer_players);

    const camp = state.room?.camp ?? 1;
    const spawns = { 1: [444, 612], 2: [780, 804] };
    const baseInfo = {
      acct_id: state.char_id ?? 1, name: state.name ?? '', tank_id: state.tank_id,
      tank_level: state.tank_level ?? 1, tank_strength: state.tank_strength ?? 0,
      human: true, human_profile_id: state.char_id ?? 1, tank_ext: state.tank_ext ?? 0,
      in_room: !state.multiplayer_left,
    };
    for (const [source, target] of [['crystal_build', 'crystals'], ['military_build', 'military'],
      ['guild_build', 'guild'], ['booster_build', 'booster']]) {
      if (state[source]) baseInfo[target] = state[source];
    }
    const resolve = id => (classes && (classes[id] || classes[String(id)])) || TankActions;
    const spawnFor = c => state.spawns?.[c]
      ?? (this.geometry.id === 101 ? spawns[c] : this.geometry.spawn(c));
    this.player = new (resolve(baseInfo.tank_id))(this, 1, baseInfo, camp, spawnFor(camp));
    this.actors = new Map([[1, this.player]]);
    this.bot = null;
    if (state.bot) {
      const botCamp = 3 - camp;
      this.bot = new (resolve(state.bot.tank_id))(this, 2, state.bot, botCamp, spawnFor(botCamp));
      this.actors.set(2, this.bot);
    }
    if (state.ally_bot) {
      this.actors.set(3, new (resolve(state.ally_bot.tank_id))(this, 3, state.ally_bot, camp,
        camp === 1 ? [660, 804] : [540, 612]));
    }
    for (const actor of this.actors.values()) this.queue(this.clock(), actor.onSpawn.bind(actor));
    if (this.botAttacks) this.queue(this.clock() + 1000, this._botAttack);
  }

  newId(objectType) {
    this.serial += 1;
    return ((objectType << 26) | this.serial) >>> 0;
  }

  queue(due, callback, ...args) {
    this.eventSerial += 1;
    const entry = { due, order: this.eventSerial, callback, args };
    this.pending.push(entry);
    this._heapUp(this.pending.length - 1);
  }

  _heapUp(index) {
    const heap = this.pending;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this._earlier(heap[parent], heap[index])) break;
      [heap[parent], heap[index]] = [heap[index], heap[parent]];
      index = parent;
    }
  }

  _heapDown(index) {
    const heap = this.pending;
    for (;;) {
      const left = index * 2 + 1, right = left + 1;
      let best = index;
      if (left < heap.length && this._earlier(heap[left], heap[best])) best = left;
      if (right < heap.length && this._earlier(heap[right], heap[best])) best = right;
      if (best === index) return;
      [heap[best], heap[index]] = [heap[index], heap[best]];
      index = best;
    }
  }

  _earlier(a, b) { return a.due < b.due || (a.due === b.due && a.order < b.order); }

  _pop() {
    const heap = this.pending;
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) { heap[0] = last; this._heapDown(0); }
    return top;
  }

  _requeue(entries) { this.pending = entries; for (let i = (entries.length >> 1) - 1; i >= 0; i -= 1) this._heapDown(i); }

  waterRects(now) {
    const actors = [...this.actors.values()];
    for (const actor of [...actors]) {
      if (typeof actor.borrowedViews === 'function') actors.push(...actor.borrowedViews(false));
    }
    const rects = [];
    for (const actor of actors) {
      const wall = actor.water_wall;
      if (!wall || !(wall.end > now)) continue;
      for (const [, [x, y]] of wall.blocks) rects.push([x - 36, y - 36, x + 36, y + 36]);
    }
    return rects;
  }

  clipMotion(start, dest, now) {
    dest = this.geometry.clipTankMotion(start, dest);
    const water = this.waterRects(now);
    const hit = rectContact(start, dest, water, 35.999);
    if (hit !== null) dest = pointAt(start, dest, Math.max(0, hit - 0.0001)).map(pyRound);
    return this.geometry.clearTankLanding(this.geometry.clampTankPosition(start), dest, water);
  }

  freePosition(pos, now, { extra = [], occupied = [] } = {}) {
    pos = this.geometry.clampTankPosition(pos);
    const rects = this.waterRects(now).concat(extra);
    const candidates = new Map([[pos.join(','), pos]]);
    for (const [l, t, r, b] of rects) {
      for (const p of [[pyRound(l - 36), pos[1]], [pyRound(r + 36), pos[1]],
        [pos[0], pyRound(t - 36)], [pos[0], pyRound(b + 36)]]) candidates.set(p.join(','), p);
    }
    const legal = [...candidates.values()].filter(p =>
      this.geometry.clampTankPosition(p).join(',') === p.join(',')
      && this.geometry.inPlayableRegion(p)
      && rectContact(p, p, rects, 35.999) === null
      && this.geometry.wallContact(p, p, 35.999) === null
      && occupied.every(q => distance(p, q) >= 72));
    legal.sort((a, b) => distance(pos, a) - distance(pos, b) || a[0] - b[0] || a[1] - b[1]);
    return legal.length ? legal[0] : null;
  }

  _waterBlockedFlight(flight, due) {
    if (flight.kind !== 'bullet') return null;
    if (flight.template === 352501) return null; // Mikasa's executor latches itself.
    const rects = this.waterRects(due);
    if (!rects.length) return null;
    const previous = flight.previous, begin = flight.begin, finish = flight.finish;
    const target = this.actors.get(flight.target);
    let start, end;
    if (target) {
      start = flight.pos;
      const dest = target.positionAt(due);
      end = pointAt(start, dest, Math.min(1,
        flight.speed * (due - previous) / 1000 / Math.max(1, distance(start, dest))));
    } else {
      start = pointAt(flight.start, flight.end, (previous - begin) / Math.max(1, finish - begin));
      end = pointAt(flight.start, flight.end, Math.min(1, (due - begin) / Math.max(1, finish - begin)));
    }
    const hit = rectContact(start, end, rects, flight.template === 386301 ? 96 : 0);
    return hit === null ? null
      : Math.max(previous, Math.min(finish - 1, previous + Math.floor((due - previous) * hit)));
  }

  /** Aquaman absorption lives in aquaman_actions.py; neutral core hook. */
  _aquamanAbsorbs() { return false; }

  tick(now = null) {
    now = now === null ? this.clock() : now;
    if (this.pk && now < (this.pk.intro_until ?? 0)) return [];
    if (this.pk && this.pk.finished) return this.syncHint(now);
    if (this.pk && this.pk.round_phase === 'result') return this.onRoundResultTick(now);
    const deadline = this.pk && !this.tankTest ? this.pk.end : null;
    if (deadline != null) now = Math.min(now, deadline);
    const packets = [];
    while (this.pending.length && this.pending[0].due <= now && !(this.pk && this.pk.finished)) {
      const { due, callback, args } = this._pop();
      const owner = callback.__owner?.id ?? 0;
      const flight = args.length && args[0] === 'flight' ? args[1][0] : null;
      this.damageContext = flight ? (flight.attack_key || [owner, this.eventSerial]) : [owner, this.eventSerial];
      this.currentFlight = flight;
      this.eventNow = due;
      try {
        if (this._aquamanAbsorbs(owner, flight, due)) {
          packets.push(scenePacket({ expiredBullets: [flight.id] }));
          continue;
        }
        const wallDue = flight ? this._waterBlockedFlight(flight, due) : null;
        packets.push(...(callback(wallDue === null ? due : wallDue, ...args) || []));
        if (wallDue !== null) {
          const remaining = this.pending.filter(entry => !(entry.callback === callback
            && entry.args?.[0] === 'flight' && entry.args[1][0] === flight));
          if (remaining.length !== this.pending.length) {
            this._requeue(remaining);
            packets.push(scenePacket({ expiredBullets: [flight.id] }));
          }
        }
      } finally {
        this.damageContext = null;
        this.currentFlight = null;
        this.eventNow = null;
      }
      if (this.pk && this.pk.round_phase && this.pk.round_phase !== 'playing') {
        const result = this.checkRound?.(due);
        if (result?.length) return packets.concat(result);
      }
    }
    if (this.pk && this.pk.finished) return packets.concat(this.syncHint(now));
    for (const actor of [...this.actors.values()]) {
      const box = actor.noel_box ? this.actors.get(actor.noel_box) : null;
      if (box?.hold) box.hold(actor, now);
      packets.push(...actor.update(now));
    }
    if (this.pk && this.pk.round_phase) return packets.concat(this.checkRound?.(now) || [], this.syncHint(now));
    if (deadline !== null && now >= deadline) packets.push(...(this.finish?.(deadline) || []));
    return packets.concat(this.syncHint(now));
  }

  syncHint() { return []; }
  onRoundResultTick() { return []; }

  inputOpen(now, actor = null) {
    if (actor && this.actors.get(actor.id) !== actor) return false;
    if (this.pk && (this.pk.finished || now < (this.pk.intro_until ?? 0))) return false;
    return !this.pk?.round_phase || this.pk.round_phase === 'playing';
  }

  handle(message, payload) {
    if (!this.inputOpen(this.clock())) return [];
    const packets = this.player.handle(message, payload);
    return packets.concat(this.syncHint(this.clock()));
  }

  handleFor(objectId, message, payload) {
    const actor = this.actors.get(objectId);
    if (!actor || !human(actor) || !this.inputOpen(this.clock(), actor)) return [];
    return actor.handle(message, payload).concat(this.syncHint(this.clock()));
  }

  _botAttack(now) {
    const bot = this.bot, target = this.player;
    let packets = [];
    if (bot && target && bot.alive && target.alive && !target.isUntargetable()
      && !bot.blocked('attack', now)) {
      const start = bot.positionAt(now), dest = target.positionAt(now);
      if (distance(start, dest) <= Number(bot.stats.nFireRange || 0)
        && this.geometry.wallContact(start, dest) === null) {
        packets = bot.cast(0, start, dest, target.id, now);
      }
    }
    this.queue(now + 50, this._botAttack.bind(this));
    return packets;
  }
}

// ---------------------------------------------------------------------------
// TankActions: the per-actor base every *_actions.py subclass extends.

export class TankActions {
  constructor(arena, ident, info, camp, spawn) {
    this.arena = arena;
    this.state = arena.humanStates.get(ident) || arena.state;
    this.clock = arena.clock;
    this.id = ident;
    this.info = info;
    this.camp = camp;
    this.sceneId = arena.sceneId;
    this.stats = arena.data.tankStats(info.tank_id, info.tank_level, info.tank_strength || 0);
    this.crystalCrits = new Map();
    this.crystalHealAt = this.clock() + 5000;
    this.position = [...spawn];
    this.spawn = [...spawn];
    this.motion = null;
    this.motionKind = 0;
    this.hp = D(this.stats.iHp ?? '1');
    this.maxHp = D(this.stats.iHp ?? '1');
    this.info.hp = this.info.max_hp = this.hp.ceil();
    this.generation = 0;
    this.forcedUntil = 0;
    this.cooldowns = { 0: 0, 1: 0, 2: 0, 10: 0 };
    this.lastSpeed = Number(this.stats.iSpeed ?? 0);
    this.speedLock = null;
    this.buffs = new Map();
    this.buffStarted = new Map();
    this.buffStacks = new Map();
    this.buffVersions = new Map();
    this.buffSources = new Map();
    this.shields = [];
    this.athenaShield = null;
    this.statLoans = new Map();
    this.lastInterval = Number(this.stats.iFireInterv ?? 0);
    this.lastAttack = null;
    this.damageCredit = null;
    // Bind per actor: the event callback needs a stable owner id at pop time.
    this._event = this._event.bind(this);
    this._event.__owner = this;
    this._bindSnakeOverrides();
  }

  /** A ported tank class overrides Python snake_case hooks; route the engine's
   * camelCase calls to those overrides for this instance. */
  _bindSnakeOverrides() {
    const proto = Object.getPrototypeOf(this);
    for (const [snake, camel] of SNAKE_DISPATCH) {
      const override = proto[snake];
      if (typeof override === 'function' && override !== TankActions.prototype[snake]) {
        this[camel] = override.bind(this);
      }
    }
  }

  get enemy() {
    if (this.arena.pk) {
      const now = this.arena.eventNow || this.clock();
      const candidates = [...this.arena.actors.values()].filter(a => a.camp !== this.camp);
      candidates.sort((a, b) => (Number(!a.alive) - Number(!b.alive))
        || (Number(a.isUntargetable()) - Number(b.isUntargetable()))
        || (distance(this.positionAt(now), a.positionAt(now)) - distance(this.positionAt(now), b.positionAt(now)))
        || (a.id - b.id));
      return candidates[0];
    }
    if (this.id === 1 || this.id === 2) return this.arena.actors.get(3 - this.id);
    return [...this.arena.actors.values()].find(a => a.camp !== this.camp);
  }

  get alive() { return this.hp.gt(0) && this.info.in_room !== false; }
  get activeBuffs() { return this.arena.activeBuffs; }

  _newId(kind) { return this.arena.newId(kind); }
  _skillEvent(skill, start, dest, target = 0, { ready = 0 } = {}) {
    return skillEvent(skill, start, dest, target, { owner: this.id, ready });
  }
  _moveEvent(position, speed, kind, owner = null) {
    return moveEvent(position, speed, kind, owner === null ? this.id : owner);
  }
  _queue(due, kind, ...data) {
    if (kind === 'flight' && data.length && data[0] && typeof data[0] === 'object') {
      const flight = data[0];
      if (flight.kind === 'bullet' && flight.attacker_ap === undefined) {
        flight.attacker_ap = this.combatStat('iAttack', flight.begin ?? due);
      }
    }
    this._event.__owner = this;
    this.arena.queue(due, this._event, kind, data);
  }

  tick(now = null) { return this.arena.tick(now); }

  positionAt(now) {
    if (!this.motion) return this.position;
    const [start, dest, begin, end] = this.motion;
    const f = Math.min(1, Math.max(0, (now - begin) / Math.max(1, end - begin)));
    return pointAt(start, dest, f).map(pyRound);
  }

  _inside(pos) { return this.arena.geometry.inside(pos); }

  _setMotion(start, dest, speed, now, kind = 0) {
    if (this.effectBlocked()) dest = start;
    start = this.arena.geometry.clampTankPosition(start);
    dest = this.arena.clipMotion(start, dest, now);
    const duration = Math.max(1, pyRound(distance(start, dest) * 1000 / speed));
    this.position = dest;
    this.motion = [start, dest, now, now + duration];
    this.motionKind = kind;
    return duration;
  }

  stopPosition(now, position = null) {
    position = position === null ? this.positionAt(now) : position;
    const origin = this.motion ? this.motion[0] : position;
    return this.arena.clipMotion(origin, position, now);
  }

  moveDestination(start, dest) {
    if (this.effectBlocked()) return start;
    return this.arena.clipMotion(start, dest, this.clock());
  }

  blinkDestination(start, dest) {
    if (this.effectBlocked()) return start;
    dest = this.arena.geometry.clearTankLanding(this.arena.geometry.clampTankPosition(start),
      this.arena.geometry.clipTankMotion(start, dest));
    if (rectContact(dest, dest, this.arena.waterRects(this.clock()), 35.999) === null) return dest;
    return this.arena.freePosition(dest, this.clock()) || start;
  }

  hasBuff(template, now) {
    const entry = this.activeBuffs.get(bkey(this.id, template));
    return Boolean(entry && entry[1] > now);
  }

  effectBlocked() { return this.inStasis(); }

  inStasis() {
    return Boolean(this.noel_box || this.dora_travel)
      || this.hasBuff(357402, this.arena.eventNow || this.clock());
  }

  isUntargetable() {
    const now = this.arena.eventNow || this.clock();
    return this.inStasis() || Boolean(this.info.untargetable)
      || (this.hasBuff(358902, now) && !this.buffTypes(now).has(32));
  }

  ccImmune(now, { slow = false } = {}) {
    return Boolean(this.dora_travel) || this.hasBuff(311313, now) || this.hasBuff(510711, now)
      || (!slow && this.buffTypes(now).has(54));
  }

  isAreaTargetable() { return !this.isUntargetable(); }

  /** Loadout/crystal/guild bonuses; neutral in the core. */
  crystalBonus() { return ZERO; }
  weakenFactor() { return 1; }

  attrBonus(attributes, now) {
    let value = this.crystalBonus(attributes);
    const excluded = new Set([416412, 416413, 416415, 416416, 388112, 336106, 344207,
      358923, 305110, 305111, 305112, 305314, 381203, 381204, 391103, 391104, 391105, 330122]);
    for (const [key, [owner, end]] of this.activeBuffs) {
      const [id, template] = parseBkey(key);
      if (this.arena.geometry.id === 40002 && inRange(template, 483, 489)) continue;
      if (inRange(template, 500101, 508109) || inRange(template, 510801, 510839)) continue;
      if (id !== this.id || end <= now || excluded.has(template)) continue;
      const row = this.arena.data.tableRow('BuffTemplate_table.xml', { nBuffId: template });
      const attribute = template === 358607 ? 10 : Number(row.get('nTypeParam', 0));
      if (row.get('nEffectType') === '201' && attributes.includes(attribute)) {
        let amount = D(row.get('fEffectValA', '0'))
          .add(D(row.get('iStackAdd', '0')).mul((this.buffStacks.get(template) ?? 1) - 1));
        if (row.get('fTimeEffectValA') && Number(row.get('iCoolTime', 0)) > 0) {
          const changed = amount.add(D(row.fTimeEffectValA)
            .mul(Math.floor((now - (this.buffStarted.get(template) ?? now)) / Number(row.iCoolTime))));
          amount = amount.gt(0) ? changed.max(0) : changed.min(0);
        }
        value = value.add(amount);
      }
    }
    return value;
  }

  combatStat(key, now) {
    const attrs = {
      iAttack: [1, 4], iEgAtk: [1, 5], iArmor: [2, 6],
      iEgArmor: [2, 7], iCentesis: [3, 8], iEgCtsis: [3, 9],
    };
    let value = D(this.stats[key] ?? '0').mul(ONE.add(this.attrBonus(attrs[key], now)));
    for (const [key2, link] of this.statLoans) {
      if (link.end > now && this.hasBuff(key2 === 'iArmor' || key2 === 'iEgArmor'
        ? link.armor_buff : link.attack_buff, now)) {
        value = value.add(link.values.get(key) ?? 0);
      }
    }
    value = value.mul(D(this.weakenFactor(attrs[key], now)));
    return ['iArmor', 'iEgArmor'].includes(key) ? value : value.max(0);
  }

  fireInterval(now) {
    return Math.max(1, pyRound(Number(this.stats.iFireInterv ?? 0)
      / Math.max(0.01, (1 + this.attrBonus([10], now).toNumber()) * this.weakenFactor([10], now))));
  }

  projectileBlocked(target, now) {
    const flight = this.arena.currentFlight;
    if (target.info.tank_id === 10000115 && target.dodge_projectile?.(now)) return true;
    if (target.hasBuff(332206, now) && flight?.basic) return true;
    if ([10000111, 10000055].includes(target.info.tank_id) && target.hasBuff(386111, now)
      && flight && target.reflect_projectile?.(flight, now)) return true;
    if (target.hasBuff(351401, now)) {
      if (flight) target.reflect_projectile?.(flight, now);
      return true;
    }
    return [323401, 382121, 334212, 341401, 318402].some(t => target.hasBuff(t, now));
  }

  projectileTargetable(flight, target) { return !target.isUntargetable(); }

  cleanse(now) {
    const packets = [];
    for (const key of [...this.activeBuffs.keys()]) {
      const [owner, template] = parseBkey(key);
      if (owner !== this.id) continue;
      const aspect = this.arena.data.tableRow('BuffTemplate_table.xml', { nBuffId: template }).get('iAspect');
      const source = this.buffSources.get(template);
      if (aspect === '-1' || ([344207, 344211, 368305, 368405].includes(template) && source !== this.id)) {
        packets.push(...this.removeBuff(template, now));
      }
    }
    for (const actor of this.arena.actors.values()) {
      if (actor.info.npc_template) continue;
      if (actor.info.tank_id === 10000044 && actor.e_hits) {
        for (const key of [...actor.e_hits.keys()]) {
          if (key[1] === this.id && key[2] === this.generation) actor.e_hits.delete(key);
        }
      }
      if (actor.info.tank_id === 10000057) {
        if (actor.link && [actor.id, actor.link.target].includes(this.id)) packets.push(...(actor._end_link?.(now, true) || []));
        packets.push(...(actor.clear_loans?.(this, now) || []));
      }
    }
    return packets;
  }

  addObject(template, position) {
    const ident = this._newId(4);
    const info = { objectId: ident, templateId: template, x: position[0], y: position[1],
      hp: 0, camp: this.camp, maxHp: 0, ownerId: this.id, shield: 0, buffs: [] };
    this.arena.objects.set(ident, objectInfo(info));
    return [ident, [1556, encodeS1556(this.sceneId, info)]];
  }

  removeObject(ident, { destroyed = false } = {}) {
    if (!this.arena.objects.delete(ident)) return [];
    return [scenePacket(destroyed ? { removedObjects: [ident] } : { expiredBullets: [ident] })];
  }

  stripDefenses(now) {
    const packets = [];
    for (const key of [...this.activeBuffs.keys()]) {
      const [owner, template] = parseBkey(key);
      if (owner === this.id && this.defenseBuff(template)) packets.push(...this.removeBuff(template, now));
    }
    return packets;
  }

  defenseBuff(template) {
    if ([350302, 367406, 368302, 314101, 383323, 381307].includes(template)) return true;
    const staticIds = [331224, 363309, 304302, 304312, 307303, 323122, 321302, 322214,
      322305, 338105, 338306, 364303, 365403, 380147, 380401, 311312, 347104, 347303,
      339204, 339113, 318202, 336401, 336503, 344110, 344113, 335315, 8190103, 8190421,
      8190422, 356112];
    if (staticIds.includes(template)) return true;
    for (const [lo, hi] of [[328231, 328236], [316311, 316315], [316321, 316325], [316331, 316335]]) {
      if (inRange(template, lo, hi)) return true;
    }
    const row = this.arena.data.tableRow('BuffTemplate_table.xml', { nBuffId: template });
    return (row.get('nEffectType') === '201' && [2, 6, 7].includes(Number(row.get('nTypeParam', 0)))
      && D(row.get('fEffectValA', '0')).gt(0));
  }

  buffTypes(now) {
    const active = [];
    for (const [key, [, end]] of this.activeBuffs) {
      const [owner, template] = parseBkey(key);
      if (owner === this.id && end > now) active.push(template);
    }
    return this.arena.data.activeBuffEffectTypes(active);
  }

  _speed(now) {
    if (this.inStasis() || this.dracula_ritual || this.caocao_hostage || this.buffTypes(now).has(36)) return 0;
    const bonuses = [this.crystalBonus([11]).toNumber()];
    const slows = [];
    let flat = 0;
    for (const [key, [, end]] of this.activeBuffs) {
      const [owner, template] = parseBkey(key);
      if (owner !== this.id || end <= now) continue;
      if (inRange(template, 500101, 508109) || inRange(template, 510801, 510839)) continue;
      const row = this.arena.data.tableRow('BuffTemplate_table.xml', { nBuffId: template });
      if (template === 30106) { flat += 72; continue; }
      const source = this.arena.actors.get(this.buffSources.get(template));
      if (template === 247 && this.info.pve_npc) { flat -= Math.min(100, Number(this.stats.iSpeed)); continue; }
      if (template === 50311 && source?.info.pve_npc && source.shot_skill === 1000065) {
        flat -= Math.min(100, Number(this.stats.iSpeed)); continue;
      }
      if ([391103, 391104, 391105, 330122].includes(template)) continue;
      if (row.get('nEffectType') === '201'
        && (row.get('nTypeParam') === '11' || template === 381203) && template !== 358607) {
        let value = Number(row.get('fEffectValA', 0))
          + Number(row.get('iStackAdd', 0)) * ((this.buffStacks.get(template) ?? 1) - 1);
        if (template === 310122) value = -0.4;
        if (template === 341212) value = -0.3 * Math.min(2, this.buffStacks.get(template) ?? 1);
        if (template === 384223) value = -0.5;
        if (template === 362107) value = -0.5;
        if (template === 350112) value = 0.05 * (this.buffStacks.get(template) ?? 1);
        if (![362107, 384223].includes(template) && row.get('fTimeEffectValA')
          && Number(row.get('iCoolTime', 0)) > 0) {
          const changed = value + Number(row.fTimeEffectValA)
            * Math.floor((now - (this.buffStarted.get(template) ?? now)) / Number(row.iCoolTime));
          value = value > 0 ? Math.max(0, changed) : Math.min(0, changed);
        }
        (value < 0 ? slows : bonuses).push(value);
      }
    }
    const base = Math.max(0, Number(this.stats.iSpeed) * Math.max(0,
      1 + bonuses.reduce((a, b) => a + b, 0) + (slows.length ? Math.min(...slows) : 0)) + flat);
    return pyRound(base * this.weakenFactor([11], now));
  }

  blocked(action, now) {
    if (!this.alive || this.inStasis() || this.dracula_ritual || this.caocao_hostage) return true;
    const types = this.buffTypes(now);
    const forcedBasic = action === 'attack' && this.arena.forced_basic_actor === this.id;
    let charm = types.has(62);
    if (forcedBasic) {
      charm = [...this.buffStarted.keys()].some(t => this.hasBuff(t, now)
        && this.arena.data.tableRow('BuffTemplate_table.xml', { nBuffId: t }).get('nEffectType') === '62'
        && !(t === 314304));
    }
    if (types.has(30) || charm) return true;
    if (action === 'attack' && this.hasBuff(320311, now)) return true;
    return action === 'move' && (now < this.forcedUntil || types.has(36));
  }

  skillSealed(slot, now) {
    if (this.inStasis() || this.dracula_ritual || this.caocao_hostage) return true;
    if (this.hasBuff(314303, now) && !(slot === 0 && this.arena.forced_basic_actor === this.id)) return true;
    const mask = { 0: 1, 1: 2, 2: 4, 10: 8, 4: 16 }[slot] || 0;
    for (const [key, [, end]] of this.activeBuffs) {
      const [owner, template] = parseBkey(key);
      if (owner !== this.id || end <= now || !mask) continue;
      const row = this.arena.data.tableRow('BuffTemplate_table.xml', { nBuffId: template });
      const effect = Number(row.nEffectType);
      if (effect === 66 || (effect === 35 && slot !== 0)) {
        const bits = Number(row.get('fEffectValB', 0));
        if (bits === 0 || (bits & mask)) return true;
      }
    }
    return false;
  }

  _buff(template, now, owner = null, { duration = null, stacks = null, refresh = false } = {}) {
    const target = owner === null ? this : this.arena.actors.get(owner);
    if (!target || !target.alive || target.inStasis()) return [];
    const row = this.arena.data.tableRow('BuffTemplate_table.xml', { nBuffId: template });
    if (target.rejectBuff(row, this, now)) return [];
    const effect = Number(row.nEffectType);
    const harmful = this.camp !== target.camp;
    const isCc = [30, 35, 36, 39, 62, 66, 88].includes(effect)
      || [357402, 381203].includes(template)
      || (effect === 201 && row.get('nTypeParam') === '11' && D(row.get('fEffectValA', '0')).lt(0));
    const silenceChu = [35, 66].includes(effect)
      && (!Number(row.get('fEffectValB', 0)) || (Number(row.get('fEffectValB', 0)) & 8))
      && target.info.tank_id === 10000112 && target.channel;
    if (harmful && isCc && !silenceChu && target.ccImmune(now, { slow: effect === 201 })) return [];
    if (this.defenseBuff(template)
      && (target.hasBuff(416315, now) || target.hasBuff(416323, now))) return [];
    duration = duration === null ? Number(row.get('iPersistTime', 0)) : duration;
    if (harmful && isCc && duration > 0) {
      for (const [buffId, factor] of [[357103, 1.25], [323402, 0.5], [321304, 0.5], [326316, 0.25],
        [365404, 0.7], [308603, 0.5], [356111, 0.5], [318117, 0.75], [391308, 0.75], [367407, 0.5]]) {
        if (target.hasBuff(buffId, now)) duration = pyRound(duration * factor);
      }
    }
    const end = duration >= 0 ? now + duration : PERMANENT;
    const ident = this._newId(6);
    const key = bkey(target.id, template);
    const packets = [];
    if (stacks === null) {
      const maxStacks = Number(row.get('iStackCount', 1));
      stacks = target.hasBuff(template, now)
        ? Math.min(template === 327113 ? 6 : maxStacks, (target.buffStacks.get(template) ?? 0) + 1) : 1;
    } else {
      stacks = Math.max(1, Math.min(Number(row.get('iStackCount', 1)), stacks));
    }
    const reuse = refresh && target.hasBuff(template, now)
      && target.buffSources.get(template) === this.id
      && target.buffStacks.get(template) === stacks;
    let instanceId = ident;
    if (reuse) {
      instanceId = this.activeBuffs.get(key)[0];
    } else if (this.activeBuffs.has(key)) {
      packets.push([1559, encodeS1559(target.id, this.activeBuffs.get(key)[0])]);
    }
    target.buffStacks.set(template, stacks);
    target.buffVersions.set(template, (target.buffVersions.get(template) ?? 0) + 1);
    target.buffStarted.set(template, now);
    target.buffSources.set(template, this.id);
    this.activeBuffs.set(key, [instanceId, end]);
    if (duration >= 0) this._queue(end, 'unbuff', [target.id, template], instanceId);
    if (!reuse) {
      packets.push([1558, encodeS1558(target.id, {
        templateId: template, instanceId, stackCount: stacks, casterId: this.id,
      }, duration)]);
    } else if (human(target)) {
      packets.push(privatePacket(target, [1581, encodeS1581(instanceId, duration, stacks)]));
    }
    if ([30, 36].includes(effect) || template === 357402) {
      target.position = target.stopPosition(now);
      target.motion = null;
      packets.push(scenePacket({ moves: [{ position: target.position, speed: 0, kind: 5, owner: target.id }] }));
      if (effect === 30 || template === 357402) {
        packets.push(...(effect === 30 && target.info.tank_id === 10000115
          ? target.interrupt(now, { stun: true }) : target.interrupt(now)));
      }
    }
    packets.push(...target.syncSpeed(now));
    const receivedControl = [30, 36].includes(effect)
      || ([35, 66].includes(effect)
        && (!Number(row.get('fEffectValB', 0)) || (Number(row.get('fEffectValB', 0)) & 8)));
    if (harmful && (receivedControl
      || ([10000106, 10000111, 10000054, 10000057, 10000080, 10000091, 10000115, 10000055]
        .includes(target.info.tank_id) && [35, 66].includes(effect)))) {
      packets.push(...target.onControl(this, template, now));
    }
    return packets;
  }

  syncSpeed(now) {
    const speed = this.inStasis() || this.dracula_ritual || this.caocao_hostage ? 0 : this._speed(now);
    const packets = [];
    if (speed !== this.lastSpeed) {
      this.lastSpeed = speed;
      if (speed === 0 && this.alive) {
        if (!this.buffTypes(now).has(45)) {
          packets.push(...this._buff(50353, now));
          this.speedLock = this.activeBuffs.get(bkey(this.id, 50353))?.[0] ?? null;
        }
        let pos = this.positionAt(now);
        if (this.motion && !this.motionKind && this.forcedUntil > now && this.motion[3] > now) {
          pos = this.stopPosition(now);
        }
        packets.push([1554, stopMove(this.sceneId, this.id, pos)]);
        if (this.motion && this.motionKind && this.motion[3] > now) {
          const [start, dest, begin, end] = this.motion;
          const velocity = Math.max(1, pyRound(distance(start, dest) * 1000 / Math.max(1, end - begin)));
          packets.push(scenePacket({ moves: [{ position: dest, speed: velocity, kind: this.motionKind, owner: this.id }] }));
        } else if (this.motion) {
          this.position = pos;
          this.motion = null;
        }
      }
      packets.push([1560, encodeS1560(this.info.acct_id, 1, speed)]);
    }
    if (speed > 0 && this.speedLock && (!this.motion || this.motion[3] <= now)) {
      const ident = this.speedLock;
      this.speedLock = null;
      if (this.activeBuffs.get(bkey(this.id, 50353))?.[0] === ident) {
        packets.push(...this.removeBuff(50353, now));
      }
    }
    const interval = this.fireInterval(now);
    if (interval !== this.lastInterval) {
      this.lastInterval = interval;
      packets.push([1560, encodeS1560(this.info.acct_id, 4, interval)]);
    }
    return packets;
  }

  _hpPacket(owner, hp) {
    const value = hp instanceof Object && typeof hp.ceil === 'function' ? hp.ceil() : Math.ceil(hp);
    return scenePacket({ hp: [{ objectId: owner, hp: value }] });
  }

  removeBuff(template, now, { expired = false } = {}) {
    const key = bkey(this.id, template);
    const old = this.activeBuffs.get(key);
    this.activeBuffs.delete(key);
    if (!expired) this.buffVersions.set(template, (this.buffVersions.get(template) ?? 0) + 1);
    this.buffStarted.delete(template);
    this.buffStacks.delete(template);
    this.shields = this.shields.filter(s => s.shield_id !== String(template));
    const packets = (old ? [[1559, encodeS1559(this.id, old[0])]] : []).concat(this.syncSpeed(now));
    if (template === 323301) for (const dep of [323302, 323303]) packets.push(...this.removeBuff(dep, now));
    if (template === 311201) for (const dep of [311202, 311203, 311204]) packets.push(...this.removeBuff(dep, now));
    if (template === 359201) this.athenaShield = null;
    if (template === 30101) this.mapShieldHits = 0;
    if (template === 30102) for (const dep of [30108, 30109]) packets.push(...this.removeBuff(dep, now));
    return packets;
  }

  shieldAmount(now) {
    return this.shields.filter(s => s.expires_ms > now).reduce((total, s) => total.add(D(s.remaining)), ZERO);
  }

  shieldPacket(now) {
    return scenePacket({ shields: [{ objectId: this.id, shield: this.shieldAmount(now).ceil() }] });
  }

  addShield(template, amount, now, { caster = null, duration = null } = {}) {
    if (!this.alive || this.inStasis()) return [];
    if (this.hasBuff(382213, now)) return [];
    if (this.hasBuff(321114, now)) amount = amount.mul(D('.5'));
    if (this.hasBuff(375309, now)) amount = amount.mul(D('.5'));
    if (this.hasBuff(376421, now)) amount = amount.mul(D('.5'));
    if (this.hasBuff(356322, now)) amount = amount.mul(D('.5'));
    if (this.hasBuff(361112, now)) amount = amount.mul(D('.7'));
    const previousVersion = this.buffVersions.get(template);
    const packets = (caster || this)._buff(template, now, this.id, { duration });
    if (this.buffVersions.get(template) === previousVersion) return packets;
    const end = this.activeBuffs.get(bkey(this.id, template))[1];
    this.shields = this.shields.filter(s => s.shield_id !== String(template))
      .concat({ shield_id: String(template), remaining: quantize(amount), school: 'all', expires_ms: end });
    return packets.concat([this.shieldPacket(now)]);
  }

  restoreHp(amount, now) {
    if (!this.alive || this.inStasis()) return [];
    if (this.hasBuff(510610, now)) return [];
    if (this.hasBuff(510901, now)) amount = amount.mul(D('1.3'));
    const woundIds = [...Array.from({ length: 10 }, (_, i) => 343111 + i),
      364102, 364105, 364106, 364107, 334111, 368102, 368311, 305100, 305101, 305102,
      305301, ...Array.from({ length: 5 }, (_, i) => 380121 + i)];
    const poisonWound = woundIds.some(t => this.hasBuff(t, now)) ? D('.3') : ZERO;
    const result = heal(amount.mul(ONE.add(this.attrBonus([21], now)).max(0)), this.hp, this.maxHp,
      { woundReductions: [poisonWound] });
    if (this.ledger?.deferHeal) return this.ledger.deferHeal(result.potential_heal, now);
    return result.effective_heal.gt(0) ? this.commitHp(result.hp_after, now) : [];
  }

  skillCooldown(duration) { return duration; }

  commitHp(hp, now, { critical = false } = {}) {
    if (this.arena.pk?.finished) return [];
    const before = this.hp;
    this.hp = quantize(hp).min(this.maxHp);
    this.info.hp = this.hp.ceil();
    const delta = this.hp.ceil() - before.ceil();
    const credit = this.damageCredit;
    const fury = Number(Boolean(critical) && delta < 0);
    const packets = [];
    if (delta) packets.push([1605, encodeS1605(delta, this.id, fury, credit ? credit[0] : this.id)]);
    packets.push(this._hpPacket(this.id, this.hp));
    this.recordHp(before, now);
    if (before.gt(0) && this.hp.isZero()) {
      packets.push(...this.rewardDeath(now));
      this.mapAmmo = null;
      this.mapShieldHits = 0;
      this.position = this.positionAt(now);
      this.motion = null;
      packets.push(...this.interrupt(now));
      for (const key of [...this.activeBuffs.keys()]) {
        const [owner] = parseBkey(key);
        if (owner === this.id) {
          packets.push([1559, encodeS1559(this.id, this.activeBuffs.get(key)[0])]);
          this.activeBuffs.delete(key);
        }
      }
      this.onDeath();
      for (const actor of [...this.arena.actors.values()]) packets.push(...actor.onTargetDeath(this, now));
      this.shields = [];
      this.athenaShield = null;
      this.buffStarted.clear();
      this.buffStacks.clear();
      packets.push(this.shieldPacket(now));
      packets.push(...this.deathHook(now));
      if (this.info.pve_npc) { this.respawn_at = 0; return packets; }
      if ([30, 40].includes(this.arena.geometry.id) && !this.info.npc_template) {
        this.respawn_at = 0;
        if (human(this)) packets.push(privatePacket(this, [1588, new Uint8Array(0)]));
        return packets;
      }
      let delay = this.info.bomb_cart ? 10000
        : (this.info.robo || this.info.mascot || this.info.totem) ? 30000
          : (this.arena.pk && !this.info.npc_template) ? 5000 : 2000;
      delay = this.respawnDelay(now, delay);
      if ((!this.arena.pk || !this.arena.pk.finished) && !this.info.base_robot) {
        this.respawn_at = now + delay;
        this._queue(now + delay, 'respawn', this.generation);
        if (!this.info.npc_template) packets.push([1553, encodeS1553(this.info.acct_id, delay)]);
      }
    }
    return packets;
  }

  recordHp() {}
  rewardDeath() { return []; }
  deathHook() { return []; }
  respawnDelay(now, delay) { return delay; }

  damageImmune(school, now, periodic = false) {
    return Boolean(this.info.damage_immune || this.hasBuff(511202, now)
      || now < (this.pk_safe_until ?? 0) || now < (this.portal_safe_until ?? 0)
      || (school === 'physical' && this.hasBuff(332205, now)) || this.hasBuff(330132, now)
      || (school === 'true' && this.hasBuff(330305, now)) || this.hasBuff(303136, now)
      || this.hasBuff(386312, now) || this.hasBuff(312111, now) || this.hasBuff(320101, now)
      || this.hasBuff(326341, now) || this.hasBuff(338103, now) || this.hasBuff(348202, now)
      || this.hasBuff(353121, now) || this.hasBuff(371111, now)
      || this.hasBuff(336108, now) || this.hasBuff(336507, now)
      || this.hasBuff(336301, now) || this.hasBuff(336311, now) || this.hasBuff(344103, now)
      || this.hasBuff(327222, now) || this.hasBuff(379202, now) || this.hasBuff(379207, now)
      || (school === 'energy' && this.hasBuff(333301, now))
      || (!periodic && this.hasBuff(303111, now)));
  }

  damage(raw, now, {
    target = null, school = 'physical', basic = false, lifesteal = 0, reflected = false,
    attacker_ap = null, periodic = false, ignore_armor = false, inverse_armor = false,
    hp_swap_loss = 0, resolved_damage = null, source_generation = null,
    credit_override = null, allow_friendly = false, critical_handled = false,
    crystal_vamp = true, critical_display = false, ignore_reductions = false,
  } = {}) {
    if (this.arena.pk?.finished) return [[], false];
    target = target || this.enemy;
    if (!target) return [[], false];
    if (!allow_friendly && (target.info.map_object || target.info.totem || target.info.bomb_cart)
      && target.camp === this.camp) return [[], false];
    if (!target.alive || target.inStasis()) return [[], false];
    const [armorKey, penKey] = school === 'physical' ? ['iArmor', 'iCentesis'] : ['iEgArmor', 'iEgCtsis'];
    const reductions = [];
    const notBasic = !basic;
    if (notBasic && target.hasBuff(331224, now)) reductions.push(D('.5'));
    if (notBasic && target.hasBuff(510720, now)) reductions.push(D('.5'));
    if (target.info.bomb_cart && target.escorted?.(now)) reductions.push(D('.9'));
    const skillMultiplier = target.skill_damage_multiplier ?? target.skillDamageMultiplier;
    if (notBasic && skillMultiplier !== undefined && skillMultiplier !== 1) {
      reductions.push(ONE.sub(D(String(skillMultiplier))));
    }
    if (target.hasBuff(330305, now)) reductions.push(D('.99'));
    if (this.hasBuff(381204, now)) reductions.push(D('.25'));
    if (target.hasBuff(381307, now)) reductions.push(D('.25'));
    if (notBasic && target.hasBuff(384101, now)) reductions.push(D('.6').mul(ONE.sub(target.hp.div(target.maxHp))));
    if (target.hasBuff(384205, now)) reductions.push(D('.25'));
    if (basic && target.hasBuff(314101, now)) reductions.push(D('.6').mul(ONE.sub(target.hp.div(target.maxHp))));
    if (target.hasBuff(383323, now)) reductions.push(D('.1').mul(target.buffStacks.get(383323) ?? 1));
    if (this.hasBuff(383404, now) && this.buffSources.get(383404) === target.id) reductions.push(D('.25'));
    if (basic && target.hasBuff(358915, now)) reductions.push(D('.15'));
    if (this.hasBuff(358923, now)) reductions.push(D('.3'));
    if (school === 'energy' && target.hasBuff(363309, now)) reductions.push(D('.5'));
    if (target.hasBuff(304302, now)) reductions.push(D('.5'));
    if (notBasic && target.hasBuff(304312, now)) reductions.push(D('.25'));
    if (target.hasBuff(307303, now)) reductions.push(D('.25'));
    if (basic && target.hasBuff(323122, now)) reductions.push(D('.25'));
    if (target.hasBuff(321302, now)) reductions.push(D('.5'));
    if (target.hasBuff(322214, now)) reductions.push(D('.25'));
    if (target.hasBuff(322305, now)) reductions.push(D('.5'));
    if (notBasic && target.hasBuff(325202, now)) reductions.push(D('.5'));
    if (target.hasBuff(325605, now)) reductions.push(D('.5'));
    if (target.hasBuff(334252, now)) reductions.push(D('.5'));
    if (target.hasBuff(310203, now)) reductions.push(D('.5'));
    if (target.hasBuff(341313, now)) reductions.push(D('.3'));
    if (notBasic && target.hasBuff(342403, now)) reductions.push(D('.5'));
    if (notBasic && target.hasBuff(352504, now)) reductions.push(D('.5'));
    if ([374126, 374207, 374315, 374412].some(t => target.hasBuff(t, now))) reductions.push(D('.75'));
    if (target.hasBuff(377122, now) || target.hasBuff(377325, now)) reductions.push(D('.5'));
    if (target.hasBuff(339204, now)) reductions.push(D('.25'));
    if (notBasic && target.hasBuff(339113, now)) reductions.push(D('.15').mul(target.buffStacks.get(339113) ?? 1));
    if (target.hasBuff(335315, now)) reductions.push(D('.25'));
    if (target.hasBuff(8190103, now)) reductions.push(D('.5').mul(D(String((target.mp ?? 0) / 200))));
    if (target.hasBuff(8190421, now)) reductions.push(D('.5'));
    else if (target.hasBuff(8190422, now)) reductions.push(D('.25'));
    if (notBasic && target.hasBuff(356112, now)) reductions.push(D('.5'));
    if (target.hasBuff(318202, now)) reductions.push(D('.5'));
    if (target.hasBuff(336401, now) || target.hasBuff(336503, now)) reductions.push(D('.25'));
    if (target.hasBuff(344110, now)) reductions.push(D('.5'));
    if (target.hasBuff(344113, now)) reductions.push(D('.15').mul(target.buffStacks.get(344113) ?? 1));
    if (this.hasBuff(344207, now)) reductions.push(D('.5'));
    if (target.hasBuff(367406, now)) reductions.push(D('.5'));
    if (target.hasBuff(368302, now)) reductions.push(D('.25'));
    if (this.hasBuff(367102, now) && this.buffSources.get(367102) === target.id) reductions.push(D('.3'));
    for (const [t, amount] of [[316321, '.1'], [316322, '.2'], [316323, '.4'], [316324, '.6']]) {
      if (target.hasBuff(t, now)) reductions.push(D(amount));
    }
    if (this.hasBuff(355406, now) && this.buffSources.get(355406) === target.id) reductions.push(D('.25'));
    if (this.hasBuff(351113, now) && this.buffSources.get(351113) === target.id) reductions.push(D('.25'));
    for (let t = 328231; t <= 328235; t += 1) {
      if (target.hasBuff(t, now)) reductions.push(D('.15').mul(Math.min(4, t - 328230)));
    }
    if (this.hasBuff(360203, now) && this.buffSources.get(360203) === target.id) reductions.push(D('.3'));
    if (this.hasBuff(334313, now) && this.buffSources.get(334313) === target.id) reductions.push(D('.5'));
    if (notBasic && target.hasBuff(338105, now)) reductions.push(D('.5'));
    if (target.hasBuff(338306, now)) reductions.push(D('.25'));
    if (this.hasBuff(321213, now) && this.buffSources.get(321213) === target.id) reductions.push(D('.5'));
    if (Array.from({ length: 10 }, (_, i) => 343111 + i)
      .some(t => this.hasBuff(t, now) && this.buffSources.get(t) === target.id)) reductions.push(D('.2'));
    if (this.hasBuff(343304, now) && this.buffSources.get(343304) === target.id) reductions.push(D('.25'));
    if (target.hasBuff(364303, now)) reductions.push(D('.25'));
    if (target.hasBuff(365403, now)) reductions.push(D('.3'));
    if (target.hasBuff(311312, now)) reductions.push(D('.25'));
    if (target.hasBuff(347104, now) || target.hasBuff(347303, now)) reductions.push(D('.5'));
    if (this.hasBuff(340104, now) && this.buffSources.get(340104) === target.id) reductions.push(D('.25'));
    if (notBasic && this.hasBuff(378302, now)) reductions.push(D('.5'));
    if (this.hasBuff(388411, now) && this.buffSources.get(388411) === target.id) reductions.push(D('.25'));
    if (school === 'physical' && this.hasBuff(388112, now)) {
      reductions.push(D('.05').mul(this.buffStacks.get(388112) ?? 1));
    }
    if (basic && target.hasBuff(380401, now)) reductions.push(D('.5'));
    if (target.info.tank_id === 10000105 && target.hasBuff(380147, now)) {
      reductions.push(D(1).min(D('.1').mul(target.burningCount?.(now) ?? 0)));
    }
    if (target.hasBuff(387302, now)) reductions.push(D('.25'));
    if (target.hasBuff(387314, now)) reductions.push(D('.05').mul(target.buffStacks.get(387314) ?? 1));
    if (notBasic && target.hasBuff(389305, now)) reductions.push(D('.25'));
    let finalReductions = reductions;
    if (target.hasBuff(306341, now) || ignore_reductions) finalReductions = [];
    const armorReduction = sumDec(((school === 'physical' ? [306101, 306311] : [306102, 306321]))
      .filter(t => target.hasBuff(t, now))
      .map(t => ([306101, 306102].includes(t) ? D('.2') : D('.4'))));
    let key = this.arena.damageContext;
    if (reflected || !key || key[0] !== this.id) key = [this.id, this._newId(2)];
    const crit = this.critical(key, {
      basic, school, handled: critical_handled, reflected, resolved: resolved_damage !== null,
    });
    const burning = this.info.tank_id === 10000105 ? 1 + 0.1 * (this.burningCount?.(now) ?? 0) : 1;
    let amount = damageAmount(raw, {
      school,
      armor: ignore_armor ? 0 : target.combatStat(armorKey, now),
      armorConstant: target.pve_armor_constant ?? 300,
      critical: crit, canCritical: basic && school !== 'true',
      reductionPct: armorReduction,
      penetrationFlat: this.combatStat(penKey, now),
      penetrationPct: this.attrBonus([34], now)
        .sub(school === 'physical' && this.hasBuff(358913, now) ? D('.15') : ZERO)
        .add(school === 'physical' && this.hasBuff(377121, now) ? D('.5') : ZERO).max(0),
      inverseArmor: inverse_armor,
      sourceConditionMultiplier: this.damageBonus(target).mul(D(String(burning))),
      incomingBonus: (target.hasBuff(303305, now) ? D('.3') : ZERO)
        .add(target.hasBuff(510841, now) ? D('.15') : ZERO)
        .add(((target.hasBuff(381131, now) && target.hasBuff(381132, now))
          || (target.hasBuff(381412, now) && target.hasBuff(381415, now))) ? D('.1') : ZERO)
        .add(target.hasBuff(321113, now) ? D('.25') : ZERO)
        .add(basic && target.hasBuff(379412, now) ? D('.25') : ZERO)
        .add(target.hasBuff(358505, now) ? D('.15') : ZERO)
        .add(basic && target.hasBuff(384337, now) ? D('.5') : ZERO),
      reductions: finalReductions,
      immune: target.damageImmune(school, now, periodic),
    });
    amount = amount.sub(D(hp_swap_loss)).max(0);
    if (resolved_damage !== null) {
      amount = target.damageImmune(school, now, periodic) ? ZERO : D(resolved_damage);
    }
    if (resolved_damage === null && !basic && target.hasBuff(416313, now)) {
      return [target.restoreHp(amount, now), false];
    }
    if (resolved_damage === null) amount = target.limitHit(key, amount, now);
    if (amount.gt(0) && target.ordinary_obstacle) amount = target.maxHp.div(4);
    if (amount.gt(0)) this.onCombat(now);
    let blocked = false, wardPackets = [];
    if (resolved_damage === null) [blocked, wardPackets] = target.blockHit(key, amount, now, { basic, periodic, source: this });
    if (blocked) return [wardPackets, false];
    if (amount.gt(0) && basic && target.hasBuff(30101, now)
      && (target.mapShieldHits ?? 0) > 0 && !this.hasBuff(30102, now)) {
      target.mapShieldHits -= 1;
      return [target.mapShieldHits ? [] : target.removeBuff(30101, now), false];
    }
    let transferPackets = [];
    if (resolved_damage === null && target.hostage) {
      [amount, transferPackets] = target.redirectDamage(amount, school, now);
    }
    const oldShields = target.shields.slice();
    const hpFloor = target.hp.min(D(target.info.death_floor ?? 0).max(target.hasBuff(359301, now) ? ONE : ZERO));
    let hit = applyDamage(amount, target.hp, target.shields, { school, nowMs: now, hpFloor });
    if (target.ledger?.deferHit) {
      hit = target.ledger.deferHit(hit, now, this, school, source_generation, { transferred: resolved_damage !== null, credit_override });
    }
    const protectedHit = target.preventLethalHit(hit, now);
    if (protectedHit !== null) return [transferPackets.concat(protectedHit), false];
    target.shields = hit.shields;
    const shieldPackets = [];
    const grant = target.athenaShield;
    if (grant && target.hasBuff(359201, now)) {
      const before = oldShields.filter(s => s.shield_id === '359201' && s.expires_ms > now)
        .reduce((a, s) => a.add(D(s.remaining)), ZERO);
      const after = hit.shields.filter(s => s.shield_id === '359201')
        .reduce((a, s) => a.add(D(s.remaining)), ZERO);
      const used = before.sub(after);
      const caster = this.arena.actors.get(grant.owner);
      if (used.gt(0) && caster?.alive && caster.generation === grant.generation) {
        const step = D(grant.step);
        const absorbed = D(grant.absorbed).add(used);
        const count = absorbed.div(step).floor();
        grant.absorbed = absorbed.sub(step.mul(count));
        if (count) shieldPackets.push(...(caster._resource?.(15 * count) || []));
      }
    }
    let credit = credit_override || [this.id, source_generation === null ? this.generation : source_generation];
    const hold = target.caocao_hostage;
    if (hold && hold.end > now) credit = [hold.owner, hold.generation];
    target.damageCredit = hit.hp_loss.gt(0) ? credit : null;
    const displayCritical = Boolean(crit || critical_display) && school !== 'true'
      && !reflected && resolved_damage === null;
    const packets = transferPackets.slice();
    try {
      packets.push(...target.commitHp(hit.hp_after, now, { critical: displayCritical }));
    } finally {
      target.damageCredit = null;
    }
    if (hit.hp_loss.gt(0) && target.hasBuff(358902, now)) packets.push(...target.removeBuff(358902, now));
    if (hit.potential_damage.gt(0) && target.hasBuff(389202, now)
      && now - (target.buffStarted.get(389202) ?? now) >= 1000) {
      packets.push(...target.removeBuff(389202, now), ...target.removeBuff(389203, now));
    }
    packets.push(...shieldPackets);
    if (!sameShields(oldShields, target.shields)) packets.push(target.shieldPacket(now));
    for (const ident of hit.broken_shield_ids) {
      packets.push(...target.removeBuff(Number(ident), now));
      packets.push(...target.onShieldBreak(Number(ident), now));
    }
    let steal = D(lifesteal).add(this.vamp(target, { basic, reflected, resolved: resolved_damage !== null, allowed: crystal_vamp }));
    if (!steal.isZero()) packets.push(...this.restoreHp(hit.hp_loss.mul(steal), now));
    if (resolved_damage !== null) return [packets, hit.hp_loss.gt(0)];
    packets.push(...target.onDamage(this, hit, now, school, reflected,
      attacker_ap === null ? this.combatStat('iAttack', now) : attacker_ap));
    if (basic && hit.hp_loss.gt(0) && !(reflected && target.info.tank_id === 10000040)) {
      packets.push(...target.onBasicDamage(this, hit, now));
    }
    if (!basic && hit.potential_damage.gt(0)) packets.push(...target.onSkillDamage(this, hit, now));
    for (const actor of this.arena.actors.values()) {
      if (actor.info.tank_id === 10000073 && actor._emergency) packets.push(...actor._emergency(now));
    }
    return [packets, hit.hp_loss.gt(0)];
  }

  // Hooks overridden by tank action ports and by mode installers.
  critical() { return false; }
  vamp() { return ZERO; }
  onShieldBreak() { return []; }
  preventLethalHit() { return null; }
  onDamage() { return []; }
  onBasicDamage() { return []; }
  onSkillDamage() { return []; }
  onControl() { return []; }
  rejectBuff() { return false; }
  blockHit() { return [false, []]; }
  limitHit(key, amount) { return amount; }
  onCombat() {}
  onTargetDeath() { return []; }
  damageBonus() { return ONE; }
  onDashHit() { return []; }
  onBulletHit() { return []; }
  extraShots() { return []; }
  enhanceShot() { return []; }

  _respawn(now, generation) {
    if (generation !== this.generation || this.alive || this.info.in_room === false) return [];
    this.generation += 1;
    this.respawn_at = 0;
    if (this.arena.pk) {
      this.pk_safe_until = now + 2000;
      this.mp = Number(this.stats.iMp ?? 0);
      if (this.arena.tankTest && this.info.test_spawn) this.spawn = [...this.info.test_spawn];
      else this.spawn = this.arena.geometry.spawn(this.camp, this.info.spawn_index ?? 0, { respawn: true });
    }
    this.hp = this.maxHp;
    this.info.hp = this.hp.ceil();
    this.position = [...this.spawn];
    this.motion = null;
    this.forcedUntil = 0;
    this.lastSpeed = Number(this.stats.iSpeed ?? 0);
    const packets = human(this)
      ? this.selfSnapshotPackets().concat(Object.keys(this.cooldowns)
        .map(Number).filter(slot => this.skillForSlot(slot)).map(slot => this._cooldown(slot)))
      : [[1552, tankInfo({
        objectId: this.id, accountId: this.info.acct_id, x: this.spawn[0], y: this.spawn[1],
        hp: this.hp.ceil(), maxHp: this.hp.ceil(), camp: this.camp, name: this.info.name ?? '',
        battleLevel: this.info.battle_level ?? 1, battleExp: this.info.battle_exp ?? 0,
        tankLevel: this.info.tank_level ?? 1, mp: Number(this.stats.iMp ?? 0),
        maxMp: Number(this.stats.iMp ?? 0), shield: 0,
      })]];
    return packets.concat(this.onSpawn(now));
  }

  onSpawn() { return []; }

  selfSnapshotPackets() {
    const skills = [];
    for (const slot of [0, 1, 2, 3, 10]) {
      if (!this.skillForSlot(slot)) continue;
      // battle_entry takes the first 22 bytes of the actor's own cooldown packet.
      const body = this._cooldown(slot)[1];
      if (body.length >= 22) skills.push(body.slice(0, 22));
    }
    const buffs = []; // battle_entry._tank_info carries only the level-6 visual ring
    const tank = {
      objectId: this.id, accountId: this.info.acct_id, x: this.positionAt(this.clock())[0],
      y: this.positionAt(this.clock())[1], hp: this.hp.ceil(), maxHp: this.maxHp.ceil(),
      camp: this.camp, name: this.info.name ?? '', buffs,
      battleLevel: this.info.battle_level ?? 1, battleExp: this.info.battle_exp ?? 0,
      tankLevel: this.info.tank_level ?? 1, mp: Number(this.stats.iMp ?? 0),
      maxMp: Number(this.stats.iMp ?? 0), shield: this.shieldAmount(this.clock()).ceil(),
    };
    const packets = [[1550, encodeS1550({
      tank, fireInterval: Math.max(-32768, Math.min(32767, this.fireInterval(this.clock()))),
      speed: this._speed(this.clock()), skills, kills: 0, deaths: 0, assists: 0,
    })]];
    const interval = this.fireInterval(this.clock());
    if (interval < -32768 || interval > 32767) packets.push([1560, encodeS1560(this.info.acct_id, 4, interval)]);
    return packets;
  }

  shoot(template, start, dest, now, raw, {
    school, basic = false, target = null, speed_multiplier = 1, proc = false,
    power = null, lifesteal = 0, reflected = false, hit_ids = [], range_multiplier = 1,
    through_walls = false, shared_hits = null, context = null, attack_key = null,
    fixed_destination = false, critical_display = false,
  } = {}) {
    const row = this.arena.data.tableRow('SkillTemplate_table.xml', { nId: template });
    let duration = Number(row.get('iLifeTime', 0));
    const launchFactor = Math.max(0.01, 1 + this.attrBonus([basic ? 23 : 37], now).toNumber());
    speed_multiplier *= launchFactor;
    let speed = Math.max(1, pyRound(Number(row.get('iFlyRange', 0)) * 1000 / duration * speed_multiplier));
    if (fixed_destination) {
      speed = Math.max(1, pyRound(distance(start, dest) * 1000 / duration * launchFactor));
      duration = Math.max(1, pyRound(duration / launchFactor));
    } else if (target !== null) {
      duration = Math.max(1, pyRound(duration / launchFactor));
    } else {
      const range = Number(row.get('iFlyRange', 0)) * Number(range_multiplier);
      const aimLength = distance(start, dest);
      if (!aimLength) return [];
      dest = pointAt(start, dest, range / aimLength);
      duration = Math.max(1, pyRound(range * 1000 / speed));
    }
    dest = dest.map(pyRound);
    const ident = this._newId(2);
    const packets = [scenePacket({ fires: [{
      bulletId: ident, ownerId: this.id, start, dest, speed, templateId: template,
    }] })];
    const flight = {
      kind: 'bullet', id: ident, start, end: dest, begin: now, finish: now + duration,
      previous: now, raw, school, basic, template, proc, source_generation: this.generation,
      target: target ? target.id : null, target_generation: target ? target.generation : null,
      pos: start, speed, attacker_ap: this.combatStat('iAttack', now), lifesteal, reflected,
      power: power === null ? this.combatStat('iEgAtk', now) : power,
      hits: shared_hits === null ? new Set(hit_ids) : shared_hits, through_walls,
    };
    if (critical_display) flight.critical_display = true;
    if (attack_key === null) {
      let attackId;
      if (!proc && !reflected) {
        if (!this.lastAttack || this.lastAttack.begin !== now || this.lastAttack.template !== template) {
          this.lastAttack = { begin: now, template, id: ident };
        }
        attackId = this.lastAttack.id;
      } else attackId = ident;
      attack_key = [this.id, this.generation, template, attackId];
    }
    flight.attack_key = attack_key;
    if (context !== null) flight.context = context;
    this._queue(now + Math.min(20, duration), 'flight', flight);
    if (range_multiplier === 1 && shared_hits === null && !fixed_destination) {
      packets.push(...this.extraShots(flight, now));
    }
    if (this.arena.pk && range_multiplier === 1 && shared_hits === null && !fixed_destination) {
      packets.push(...this.enhanceShot(flight, now));
    }
    return packets;
  }

  _launch(kind, ident, start, dest, duration, raw, now) {
    this._queue(now + Math.min(20, duration), 'flight', {
      kind, id: ident, start, end: dest, begin: now, finish: now + duration,
      previous: now, raw, school: 'physical', basic: false, source_generation: this.generation,
    });
  }

  _flight(flight, now) {
    if (flight.kind === 'dash' && (flight.id !== this.dash_id || !this.alive)) return [];
    const previous = flight.previous, begin = flight.begin, finish = flight.finish;
    const packets = [];
    const homing = this.arena.actors.get(flight.target);
    let start, end;
    if (flight.kind === 'dash') {
      start = this.positionAt(previous);
      end = this.positionAt(now);
    } else if (homing) {
      if (!homing.alive || homing.generation !== flight.target_generation) {
        return [scenePacket({ expiredBullets: [flight.id] })];
      }
      start = flight.pos;
      const dest = homing.positionAt(now);
      const span = distance(start, dest);
      end = pointAt(start, dest, Math.min(1, flight.speed * (now - previous) / 1000 / Math.max(1, span)));
      if (dest[0] !== flight.end[0] || dest[1] !== flight.end[1]) {
        packets.push([1562, encodeS1562(flight.id, start, dest)]);
        flight.end = dest;
      }
      flight.pos = end;
    } else {
      start = pointAt(flight.start, flight.end, (previous - begin) / (finish - begin));
      end = pointAt(flight.start, flight.end, Math.min(1, (now - begin) / (finish - begin)));
    }
    const candidates = homing ? [homing] : [...this.arena.actors.values()].filter(a => a.camp !== this.camp);
    const contacts = [];
    for (const a of candidates) {
      if (!a.alive) continue;
      const h = actorContact(start, end, a, previous, now);
      if (h !== null && this.projectileTargetable(flight, a, now)) contacts.push([h, a.id, a]);
    }
    contacts.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    const [hit, , target] = contacts.length ? contacts[0] : [null, 0, null];
    const ownRect = this.map_rect ? [this.map_rect] : (this.mapRect ? [this.mapRect] : []);
    const wall = flight.kind === 'bullet' && !flight.through_walls
      ? this.arena.geometry.wallContact(start, end, 0, { exclude: ownRect }) : null;
    const contact = hit !== null && (wall === null || hit < wall);
    if (contact && flight.kind === 'bullet' && this.projectileBlocked(target, now)) {
      return packets.concat([scenePacket({ expiredBullets: [flight.id] })]);
    }
    if (contact) {
      const raw = flight.hp_fraction !== undefined ? target.maxHp.mul(D(String(flight.hp_fraction))) : flight.raw;
      packets.push(...this.damage(raw, now, {
        target, school: flight.school, basic: flight.basic,
        lifesteal: flight.source_generation === this.generation ? (flight.lifesteal ?? 0) : 0,
        reflected: flight.reflected ?? false, attacker_ap: flight.attacker_ap,
        source_generation: flight.source_generation,
      })[0]);
      if (flight.kind === 'dash') {
        packets.unshift(...this.onDashHit(pointAt(start, end, hit).map(pyRound), target, now));
      } else {
        packets.push(...this.onBulletHit(flight, target, now));
      }
    }
    const stopped = contact || wall !== null || now >= finish
      || (flight.kind === 'dash' && (!this.motion || now >= this.motion[3]));
    if (stopped && flight.kind === 'bullet') {
      packets.push(scenePacket(contact || wall !== null ? { blownBullets: [flight.id] } : { expiredBullets: [flight.id] }));
    }
    if (!stopped) {
      flight.previous = now;
      this._queue(Math.min(now + 20, finish), 'flight', flight);
    }
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'object_expire') return this.removeObject(data[0]);
    if (kind === 'flight') return this._flight(data[0], now);
    if (kind === 'damage') {
      const [generation, raw, buffId, version] = data;
      const target = data.length > 4 ? this.arena.actors.get(data[4]) : this.enemy;
      const valid = target && target.generation === generation
        && target.buffVersions.get(buffId) === version;
      return valid ? this.damage(raw, now, {
        target, periodic: true, source_generation: data.length > 5 ? data[5] : null,
      })[0] : [];
    }
    if (kind === 'respawn') return this._respawn(now, data[0]);
    if (kind === 'unbuff') {
      const [key, ident] = data;
      const entry = this.activeBuffs.get(bkey(key[0], key[1]));
      if (entry && entry[0] === ident && entry[1] <= now) {
        const target = this.arena.actors.get(key[0]);
        const shield = target.shields.some(s => s.shield_id === String(key[1]));
        const packets = target.removeBuff(key[1], now, { expired: true });
        return packets.concat(shield ? [target.shieldPacket(now)] : []);
      }
    }
    return this.onEvent ? this.onEvent(now, kind, data) : [];
  }

  update(now) {
    for (const [key, link] of [...this.statLoans]) {
      if (!(link.end > now)) this.statLoans.delete(key);
    }
    return this.syncSpeed(now).concat(this.regenerate(now), this.spawnPassives(now));
  }

  regenerate() { return []; }
  spawnPassives() { return []; }
  interrupt() { return []; }
  onDeath() {}

  skillForSlot(slot) {
    if (this.skillIds?.[slot]) return this.skillIds[slot];
    const field = { 0: 'nBullet', 1: 'nSkill1', 2: 'nSkill2', 3: 'nSkill3', 10: 'nSkill4' }[slot];
    return field ? Number(this.stats[field] ?? this.arena.data.tableRow('TankBaseTemplate_table.xml',
      { nTankId: this.info.tank_id }).get(field, 0)) : 0;
  }

  _cooldown(slot, changed = false) {
    const skillId = this.skillForSlot(slot);
    const info = { skillId, slot, count: -1, end: this.cooldowns[slot] ?? 0, nextCharge: 0 };
    if (changed && this.id === 1) return [1579, encodeS1579(info)];
    return [1572, encodeS1572(this.id, info)];
  }

  /**
   * Neutral baseline cast used until a tank class is ported. Slot 0 fires the
   * base bullet; E/Space/R fire their table skill as a plain projectile.
   * ponytail: no wind-up/channel/effect bytecode. Ported classes override this.
   */
  cast(slot, start, dest, target = 0, now = null) {
    now = now === null ? this.clock() : now;
    const skillId = this.skillForSlot(slot);
    if (!skillId || this.blocked('attack', now) || (this.cooldowns[slot] ?? 0) > now) return [];
    if (!this._inside(dest) || (slot !== 1 && start[0] === dest[0] && start[1] === dest[1])) return [];
    let row;
    try { row = this.arena.data.tableRow('SkillTemplate_table.xml', { nId: skillId }); }
    catch { return []; }
    if (slot !== 0 && distance(start, dest) > Number(row.get('iRange', 0))) return [];
    const basic = slot === 0;
    const duration = basic ? this.fireInterval(now) : Number(row.get('iCoolTime', 0));
    this.cooldowns[slot] = now + this.skillCooldown(duration, slot);
    const raw = this.combatStat(basic ? 'iAttack' : 'iEgAtk', now);
    const targetActor = target ? this.arena.actors.get(target) : null;
    return this.shoot(skillId, start, dest, now, raw, {
      school: basic ? 'physical' : 'energy', basic, target: targetActor,
    }).concat([this._cooldown(slot)]);
  }

  handle(message, payload) {
    const now = this.clock();
    const packets = this.arena.tick(now);
    if (!this.arena.inputOpen(now, this)) return packets;
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    if (message === 501 && payload.length >= 9) {
      const x = view.getUint16(0, true), y = view.getUint16(2, true);
      const direction = view.getUint8(4), sceneId = view.getUint32(5, true);
      if (sceneId !== this.sceneId || direction > 8 || !this._inside([x, y]) || this.blocked('move', now)) return packets;
      const [dx, dy] = DIRECTIONS[direction];
      const dest = [x + 24 * dx, y + 24 * dy];
      if (this._speed(now) > 0) {
        const start = [x, y];
        const water = this.arena.waterRects(now);
        if (!this.arena.geometry.canWalkTo(start) || rectContact(start, start, water, 35.999) !== null) {
          let current = this.positionAt(now);
          if (rectContact(current, current, water, 35.999) !== null) {
            const occupied = [...this.arena.actors.values()].filter(a => a !== this && a.alive).map(a => a.positionAt(now));
            current = this.arena.freePosition(current, now, { occupied }) || current;
          }
          if (!this.arena.geometry.canWalkTo(current)) {
            const occupied = [...this.arena.actors.values()].filter(a => a !== this && a.alive && !a.info.map_object).map(a => a.positionAt(now));
            current = this.arena.geometry.recoverWalkPosition(current, water, occupied) || current;
          }
          this.position = current; this.motion = null;
          packets.push([1554, stopMove(this.sceneId, this.id, current)]);
          return packets;
        }
        const end = this.arena.geometry.walkEnd(start, dest, water);
        if (end[0] === dest[0] && end[1] === dest[1]) {
          const duration = Math.max(1, pyRound(distance(start, end) * 1000 / this._speed(now)));
          this.position = end;
          this.motion = [start, end, now, now + duration];
          this.motionKind = 0;
          if (this.arena.isMultiplayer && human(this)) {
            packets.push(otherViewers(this, direction === 8
              ? [1554, stopMove(this.sceneId, this.id, end)]
              : scenePacket({ moves: [{ owner: this.id, position: start,
                speed: this._speed(now), kind: 0, direction }] })));
          }
        } else {
          if (!this.arena.geometry.canWalkTo(end)) end = this.arena.clipMotion(start, end, now);
          this.position = end; this.motion = null;
          packets.push(scenePacket({ moves: [{ position: this.position, speed: 0, kind: 5, owner: this.id }] }));
        }
      }
      return packets;
    }

    let start, target, slot, sceneId, x, y;
    if (message === 503 && payload.length >= 13) {
      sceneId = view.getUint32(0, true); target = view.getUint32(4, true);
      slot = view.getUint8(8); x = view.getInt16(9, true); y = view.getInt16(11, true);
      start = this.positionAt(now);
    } else if (message === 510 && payload.length >= 12) {
      sceneId = view.getUint32(0, true);
      const sx = view.getInt16(4, true), sy = view.getInt16(6, true);
      x = view.getInt16(8, true); y = view.getInt16(10, true);
      if (!this._inside([sx, sy])) return packets;
      start = this.arena.geometry.clampTankPosition([sx, sy]);
      target = 0; slot = 0;
      if (sceneId === this.sceneId && !this.blocked('attack', now)) {
        const water = this.arena.waterRects(now);
        const crossing = this.motion && this.motionKind && this.motion[3] > now;
        if (crossing && !this.arena.geometry.inPlayableRegion(start)) return packets;
        if (!crossing && (!this.arena.geometry.canWalkTo(start)
          || rectContact(start, start, water, 35.999) !== null)) {
          const current = this.positionAt(now);
          if (this.arena.geometry.canWalkTo(current)
            && rectContact(current, current, water, 35.999) === null) {
            this.position = current; this.motion = null;
            packets.push([1554, stopMove(this.sceneId, this.id, current)]);
            return packets;
          }
        }
      }
    } else return packets;

    if (sceneId === this.sceneId
      && (slot === 4 || (slot in this.cooldowns && !this.skillSealed(slot, now)))) {
      this.arena.damageContext = [this.id, this.generation, 0, this._newId(2)];
      this.arena.current_slot = slot;
      try {
        const castPackets = this.cast(slot, start, [x, y], target, now);
        if (castPackets.length) this.pk_safe_until = 0;
        if (castPackets.length && this.hasBuff(358902, now)) packets.push(...this.removeBuff(358902, now));
        if (castPackets.length && this.hasBuff(30105, now)) packets.push(...this.removeBuff(30105, now));
        packets.push(...castPackets);
      } finally {
        this.arena.damageContext = null;
        this.arena.current_slot = null;
      }
    }
    return packets;
  }
}

// ---------------------------------------------------------------------------
// Python-name aliases. Tank action ports can keep the source method/property
// names; the camelCase implementation stays private to the engine.

// Engine-call -> Python-name hook pairs. Subclass overrides of either name win.
const SNAKE_DISPATCH = [
  ['position_at', 'positionAt'], ['move_destination', 'moveDestination'],
  ['blink_destination', 'blinkDestination'], ['stop_position', 'stopPosition'],
  ['has_buff', 'hasBuff'], ['attr_bonus', 'attrBonus'], ['combat_stat', 'combatStat'],
  ['fire_interval', 'fireInterval'], ['projectile_blocked', 'projectileBlocked'],
  ['projectile_targetable', 'projectileTargetable'], ['defense_buff', 'defenseBuff'],
  ['skill_sealed', 'skillSealed'], ['buff_types', 'buffTypes'],
  ['restore_hp', 'restoreHp'], ['add_shield', 'addShield'],
  ['skill_cooldown', 'skillCooldown'], ['commit_hp', 'commitHp'],
  ['damage_immune', 'damageImmune'], ['on_shield_break', 'onShieldBreak'],
  ['prevent_lethal_hit', 'preventLethalHit'], ['on_damage', 'onDamage'],
  ['on_basic_damage', 'onBasicDamage'], ['on_skill_damage', 'onSkillDamage'],
  ['on_control', 'onControl'], ['reject_buff', 'rejectBuff'],
  ['block_hit', 'blockHit'], ['limit_hit', 'limitHit'], ['on_combat', 'onCombat'],
  ['on_target_death', 'onTargetDeath'], ['damage_bonus', 'damageBonus'],
  ['on_dash_hit', 'onDashHit'], ['sync_speed', 'syncSpeed'],
  ['crystal_bonus', 'crystalBonus'], ['weaken_factor', 'weakenFactor'],
  ['spawn_passives', 'spawnPassives'], ['extra_shots', 'extraShots'],
  ['enhance_shot', 'enhanceShot'], ['on_spawn', 'onSpawn'], ['on_death', 'onDeath'],
  ['on_bullet_hit', 'onBulletHit'],
];

const BM = BattleMap.prototype;
for (const [snake, camel] of [
  ['wall_contact', 'wallContact'], ['clamp_tank_position', 'clampTankPosition'],
  ['in_playable_region', 'inPlayableRegion'], ['clip_tank_motion', 'clipTankMotion'],
  ['clear_tank_landing', 'clearTankLanding'], ['can_walk_to', 'canWalkTo'],
  ['can_walk_step', 'canWalkStep'], ['walk_end', 'walkEnd'],
  ['recover_walk_position', 'recoverWalkPosition'],
]) {
  Object.defineProperty(BM, snake, { value: BM[camel], writable: true, configurable: true });
}
Object.defineProperty(BM, 'movement_walls', {
  get() { return this.movementWalls; }, set(v) { this.movementWalls = v; }, configurable: true,
});

const TA = TankActions.prototype;
for (const [snake, camel] of [
  ['_new_id', '_newId'], ['_skill_event', '_skillEvent'], ['_move_event', '_moveEvent'],
  ['position_at', 'positionAt'], ['_set_motion', '_setMotion'],
  ['stop_position', 'stopPosition'], ['move_destination', 'moveDestination'],
  ['blink_destination', 'blinkDestination'], ['has_buff', 'hasBuff'],
  ['effect_blocked', 'effectBlocked'], ['in_stasis', 'inStasis'],
  ['is_untargetable', 'isUntargetable'], ['cc_immune', 'ccImmune'],
  ['is_area_targetable', 'isAreaTargetable'], ['attr_bonus', 'attrBonus'],
  ['combat_stat', 'combatStat'], ['fire_interval', 'fireInterval'],
  ['projectile_blocked', 'projectileBlocked'], ['projectile_targetable', 'projectileTargetable'],
  ['add_object', 'addObject'], ['remove_object', 'removeObject'],
  ['defense_buff', 'defenseBuff'], ['strip_defenses', 'stripDefenses'],
  ['buff_types', 'buffTypes'], ['skill_sealed', 'skillSealed'],
  ['sync_speed', 'syncSpeed'], ['_hp_packet', '_hpPacket'], ['remove_buff', 'removeBuff'],
  ['shield_packet', 'shieldPacket'], ['add_shield', 'addShield'],
  ['restore_hp', 'restoreHp'], ['skill_cooldown', 'skillCooldown'],
  ['commit_hp', 'commitHp'], ['damage_immune', 'damageImmune'],
  ['on_shield_break', 'onShieldBreak'], ['prevent_lethal_hit', 'preventLethalHit'],
  ['on_damage', 'onDamage'], ['on_basic_damage', 'onBasicDamage'],
  ['on_skill_damage', 'onSkillDamage'], ['on_control', 'onControl'],
  ['reject_buff', 'rejectBuff'], ['block_hit', 'blockHit'], ['limit_hit', 'limitHit'],
  ['on_combat', 'onCombat'], ['on_target_death', 'onTargetDeath'],
  ['damage_bonus', 'damageBonus'], ['on_spawn', 'onSpawn'],
  ['on_death', 'onDeath'], ['on_bullet_hit', 'onBulletHit'],
  ['on_dash_hit', 'onDashHit'], ['crystal_bonus', 'crystalBonus'],
  ['weaken_factor', 'weakenFactor'], ['spawn_passives', 'spawnPassives'],
  ['extra_shots', 'extraShots'], ['enhance_shot', 'enhanceShot'],
]) {
  Object.defineProperty(TA, snake, { value: TA[camel], writable: true, configurable: true });
}
for (const [snake, camel] of [
  ['scene_id', 'sceneId'], ['max_hp', 'maxHp'], ['last_speed', 'lastSpeed'],
  ['speed_lock', 'speedLock'], ['motion_kind', 'motionKind'], ['forced_until', 'forcedUntil'],
  ['buff_started', 'buffStarted'], ['buff_stacks', 'buffStacks'],
  ['buff_versions', 'buffVersions'], ['buff_sources', 'buffSources'],
  ['stat_loans', 'statLoans'], ['last_interval', 'lastInterval'],
  ['last_attack', 'lastAttack'], ['damage_credit', 'damageCredit'],
  ['athena_shield', 'athenaShield'], ['crystal_crits', 'crystalCrits'],
  ['crystal_heal_at', 'crystalHealAt'], ['map_shield_hits', 'mapShieldHits'],
]) {
  Object.defineProperty(TA, snake, {
    get() { return this[camel]; }, set(v) { this[camel] = v; }, configurable: true,
  });
}
Object.defineProperty(TA, 'active_buffs', {
  get() { return this.activeBuffs; }, configurable: true,
});

const BA = BattleArena.prototype;
for (const [snake, camel] of [
  ['new_id', 'newId'], ['input_open', 'inputOpen'], ['handle_for', 'handleFor'],
  ['free_position', 'freePosition'], ['water_rects', 'waterRects'],
  ['clip_motion', 'clipMotion'], ['_water_blocked_flight', '_waterBlockedFlight'],
  ['_aquaman_absorbs', '_aquamanAbsorbs'], ['_bot_attack', '_botAttack'],
]) {
  Object.defineProperty(BA, snake, { value: BA[camel], writable: true, configurable: true });
}
for (const [snake, camel] of [
  ['scene_id', 'sceneId'], ['human_states', 'humanStates'], ['event_serial', 'eventSerial'],
  ['active_buffs', 'activeBuffs'], ['damage_context', 'damageContext'],
  ['current_flight', 'currentFlight'], ['event_now', 'eventNow'],
  ['bot_brains', 'botBrains'], ['tank_test', 'tankTest'], ['bot_attacks', 'botAttacks'],
]) {
  Object.defineProperty(BA, snake, {
    get() { return this[camel]; }, set(v) { this[camel] = v; }, configurable: true,
  });
}
