/* PvP bot AI: server/bot_ai.py navigation, delayed observation, aiming,
 * movement, skill choice and light teamwork, plus bot_setup.make_roster.
 *
 * Decisions act on the previous observation and sample the next one after a
 * 180-350ms delay, exactly like the Python loop. Per-kit controllers
 * (bot_ai01..20) are reduced to a range table plus a generic cast order; the
 * tank classes themselves still own real skill behaviour.
 */
import { scenePacket } from '../arena.js';
import { distance, pointAt, pyRound } from '../math.js';
import { encodeS1554 } from '../protocol.js';
import { AI_TANKS } from './tank-classes.js';

export const STEP = 24;
export const DIRECTIONS = Object.freeze([
  [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0],
]);

const samePoint = (a, b) => a[0] === b[0] && a[1] === b[1];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ratio = (a) => (a.maxHp && !a.maxHp.isZero() ? a.hp.div(a.maxHp).toNumber() : 0);

// ---------------------------------------------------------------- RNG helpers
function rngValue(engine) {
  const rng = engine.rng;
  if (typeof rng === 'function') return rng();
  if (rng && typeof rng.next === 'function') return rng.next();
  return Math.random();
}
export function randInt(engine, low, high) {
  return low + Math.floor(rngValue(engine) * (high - low + 1));
}
export function randFloat(engine, low, high) {
  return low + rngValue(engine) * (high - low);
}
let gaussSpare = null;
export function randGauss(engine, mean, sd) {
  const rng = engine.rng;
  if (rng && typeof rng.gauss === 'function') return rng.gauss(mean, sd);
  if (gaussSpare !== null) { const value = gaussSpare; gaussSpare = null; return mean + sd * value; }
  let u = 0, v = 0;
  while (u === 0) u = rngValue(engine);
  while (v === 0) v = rngValue(engine);
  const mag = Math.sqrt(-2 * Math.log(u));
  gaussSpare = mag * Math.sin(2 * Math.PI * v);
  return mean + sd * mag * Math.cos(2 * Math.PI * v);
}
function randChoice(engine, list) {
  if (!list || !list.length) return null;
  if (engine.rng && typeof engine.rng.choice === 'function') return engine.rng.choice(list);
  return list[Math.floor(rngValue(engine) * list.length)];
}

// ---------------------------------------------------------------- Navigation
/** server/bot_ai.py Navigation on the native 24-unit walk grid. */
export class Navigation {
  constructor(geometry) {
    this.geometry = geometry;
    this.components = new Map();
    this.edges = new Map();
    this.clearCache = new Map();
    this.nearestCache = new Map();
  }

  _clearKey(a, b) { return `${a[0]},${a[1]}|${b[0]},${b[1]}`; }

  clear(a, b) {
    const key = this._clearKey(a, b);
    if (this.clearCache.has(key)) return this.clearCache.get(key);
    let value = false;
    try {
      if (this.geometry.canWalkTo(a)) {
        const end = this.geometry.walkEnd(a, b);
        value = samePoint(end, b);
      }
    } catch { value = false; }
    if (this.clearCache.size > 60000) this.clearCache.clear();
    this.clearCache.set(key, value);
    return value;
  }

  neighbors(p) {
    const key = `${p[0]},${p[1]}`;
    if (this.edges.has(key)) return this.edges.get(key);
    const out = [];
    for (const [dx, dy] of DIRECTIONS) {
      const q = [p[0] + dx * STEP, p[1] + dy * STEP];
      if (this.clear(p, q)) out.push([q, Math.hypot(dx, dy) * STEP]);
    }
    if (this.edges.size > 60000) this.edges.clear();
    this.edges.set(key, out);
    return out;
  }

  reachable(source) {
    const key = `${source[0]},${source[1]}`;
    if (this.components.has(key)) return this.components.get(key);
    const queue = [source];
    const seen = new Set([key]);
    const points = [source];
    for (let head = 0; head < queue.length && points.length < 6000; head += 1) {
      const p = queue[head];
      for (const [q] of this.neighbors(p)) {
        const qk = `${q[0]},${q[1]}`;
        if (seen.has(qk)) continue;
        seen.add(qk);
        points.push(q);
        queue.push(q);
      }
    }
    const set = new Set(points.map((p) => `${p[0]},${p[1]}`));
    for (const p of points) this.components.set(`${p[0]},${p[1]}`, set);
    return set;
  }

  nearest(pos) {
    const key = `${pos[0]},${pos[1]}`;
    if (this.nearestCache.has(key)) return this.nearestCache.get(key);
    const center = [pyRound((pos[0] - 12) / 24) * 24 + 12,
      pyRound((pos[1] - 12) / 24) * 24 + 12];
    const cells = [];
    for (let x = -3; x <= 3; x += 1) {
      for (let y = -3; y <= 3; y += 1) {
        cells.push([center[0] + x * 24, center[1] + y * 24]);
      }
    }
    cells.sort((a, b) => distance(pos, a) - distance(pos, b)
      || a[0] - b[0] || a[1] - b[1]);
    const found = cells.find((p) => this.clear(p, p) && this.clear(pos, p)) || null;
    if (this.nearestCache.size > 2048) this.nearestCache.clear();
    this.nearestCache.set(key, found);
    return found;
  }

  path(start, goal, threats = [], blockers = []) {
    const source = this.nearest(start);
    let end = this.nearest(goal);
    if (!source) return [];
    if (!end) {
      const center = [pyRound((goal[0] - 12) / 24) * 24 + 12,
        pyRound((goal[1] - 12) / 24) * 24 + 12];
      const reachable = this.reachable(source);
      const cells = [];
      for (let x = -6; x <= 6; x += 1) {
        for (let y = -6; y <= 6; y += 1) {
          const p = [center[0] + x * 24, center[1] + y * 24];
          if (reachable.has(`${p[0]},${p[1]}`)) cells.push(p);
        }
      }
      if (!cells.length) cells.push(...[...reachable].map((s) => s.split(',').map(Number)));
      if (!cells.length) return [];
      cells.sort((a, b) => distance(goal, a) - distance(goal, b)
        || a[0] - b[0] || a[1] - b[1]);
      end = cells[0];
    }
    if (blockers.length && blockers.some((b) => distance(end, b) < 64)) {
      const reachable = this.reachable(source);
      const cells = [];
      for (let x = -6; x <= 6; x += 1) {
        for (let y = -6; y <= 6; y += 1) {
          const p = [end[0] + x * 24, end[1] + y * 24];
          if (!reachable.has(`${p[0]},${p[1]}`)) continue;
          if (blockers.some((b) => distance(p, b) < 64)) continue;
          cells.push(p);
        }
      }
      if (!cells.length) return [];
      cells.sort((a, b) => distance(goal, a) - distance(goal, b)
        || a[0] - b[0] || a[1] - b[1]);
      end = cells[0];
    }
    const estimate = (p) => {
      const dx = Math.abs(p[0] - end[0]), dy = Math.abs(p[1] - end[1]);
      return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
    };
    const heap = [{ f: estimate(source), g: 0, p: source }];
    const cost = new Map([[`${source[0]},${source[1]}`, 0]]);
    const parent = new Map();
    const push = (entry) => {
      heap.push(entry);
      let i = heap.length - 1;
      while (i > 0) {
        const parentIndex = (i - 1) >> 1;
        if (heap[parentIndex].f <= heap[i].f) break;
        [heap[parentIndex], heap[i]] = [heap[i], heap[parentIndex]];
        i = parentIndex;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const left = i * 2 + 1, right = left + 1;
          let best = i;
          if (left < heap.length && heap[left].f < heap[best].f) best = left;
          if (right < heap.length && heap[right].f < heap[best].f) best = right;
          if (best === i) break;
          [heap[best], heap[i]] = [heap[i], heap[best]];
          i = best;
        }
      }
      return top;
    };
    let best = source;
    for (let iteration = 0; iteration < 4500 && heap.length; iteration += 1) {
      const { g, p } = pop();
      const pk = `${p[0]},${p[1]}`;
      if (g !== cost.get(pk)) continue;
      if (distance(p, end) < distance(best, end)) best = p;
      if (samePoint(p, end)) break;
      for (const [q, stepCost] of this.neighbors(p)) {
        if (blockers.length && blockers.some((b) =>
          distance(q, b) < 64 && distance(q, b) < distance(p, b) - 0.001)) continue;
        const qk = `${q[0]},${q[1]}`;
        const danger = threats.length
          ? threats.reduce((total, t) => total + Math.max(0, 1 - distance(q, t) / 360), 0)
          : 0;
        const next = g + stepCost + danger * 48;
        if (next < (cost.get(qk) ?? Infinity)) {
          cost.set(qk, next);
          parent.set(qk, p);
          push({ f: next + estimate(q), g: next, p: q });
        }
      }
    }
    const route = [];
    let p = best;
    for (let guard = 0; guard < 4500 && !samePoint(p, source); guard += 1) {
      route.push(p);
      const next = parent.get(`${p[0]},${p[1]}`);
      if (!next) break;
      p = next;
    }
    route.push(source);
    return route.reverse();
  }
}

// ------------------------------------------------------------- observations
function targetKind(engine, observer, target, now) {
  if (!target || target === observer || !target.alive) return null;
  if (target.camp === observer.camp) return null;
  const info = target.info || {};
  if (info.cow_object) return null;
  if (info.map_object && !(info.base || info.map_turret || info.bomb_cart)) return null;
  if (target.turret_locked && target.turret_locked()) return null;
  if (target.isUntargetable && target.isUntargetable()) return null;
  if (target.buffTypes && target.buffTypes(now).has(26)) return null;
  return {
    structure: Boolean(info.base || info.map_turret),
    barrier: Boolean(info.map_object && !info.base && !info.map_turret && !info.bomb_cart),
    bomb_cart: Boolean(info.bomb_cart),
  };
}

function visibleLine(engine, observer, target, now, radius, pos, exclude, start = null) {
  const from = start || observer.positionAt(now);
  if (distance(from, pos) > radius) return false;
  return engine.arena.geometry.wallContact(from, pos, 0, { exclude }) === null;
}

/** server/bot_ai.observe: delayed samples from all allied observers. */
export function observe(engine, actor, brain, now) {
  const previous = new Map((brain.observations || []).map((o) => [o.id, o]));
  const scouts = [...engine.arena.actors.values()].filter((a) => a.alive
    && a.camp === actor.camp && !a.info.npc_template);
  const starts = (scouts.length ? scouts : [actor])
    .map((a) => [a, a.positionAt(now)]);
  const radius = 960;
  const seen = [];
  for (const target of engine.arena.actors.values()) {
    const kind = targetKind(engine, actor, target, now);
    if (!kind) continue;
    const pos = target.positionAt(now);
    const exclude = target.map_rect ? [target.map_rect]
      : target.mapRect ? [target.mapRect] : [];
    if (!starts.some(([scout, start]) =>
      visibleLine(engine, scout, target, now, radius, pos, exclude, start))) continue;
    const old = previous.get(target.id);
    let velocity = [0, 0];
    if (old && old.generation === target.generation) {
      const dt = Math.max(1, now - old.observed_at) / 1000;
      velocity = [clamp((pos[0] - old.pos[0]) / dt, -400, 400),
        clamp((pos[1] - old.pos[1]) / dt, -400, 400)];
    }
    const sample = {
      id: target.id, generation: target.generation, pos,
      velocity, hp: ratio(target), observed_at: now,
      objective: Boolean(kind.structure || kind.bomb_cart || kind.barrier),
      barrier: kind.barrier, structure: kind.structure, bomb_cart: kind.bomb_cart,
    };
    if (kind.structure) sample.turret_rect = target.map_rect || target.mapRect;
    seen.push(sample);
  }
  return seen;
}

/** server/bot_ai.observe_bullets: only in-flight enemy projectiles. */
export function observeBullets(engine, actor, now) {
  const pos = actor.positionAt(now);
  const seen = [];
  const ids = new Set();
  for (const entry of engine.arena.pending) {
    if (!entry.args || entry.args[0] !== 'flight') continue;
    const shot = entry.args[1] && entry.args[1][0];
    const source = entry.callback && entry.callback.__owner;
    if (!shot || shot.kind !== 'bullet' || !source || source.camp === actor.camp) continue;
    if (ids.has(shot.id)) continue;
    ids.add(shot.id);
    const point = shot.target
      ? shot.pos
      : pointAt(shot.start, shot.end, clamp(
        (now - shot.begin) / Math.max(1, shot.finish - shot.begin), 0, 1));
    if (distance(pos, point) > 600) continue;
    if (engine.arena.geometry.wallContact(pos, point) !== null) continue;
    const dx = shot.end[0] - point[0], dy = shot.end[1] - point[1];
    const length = Math.hypot(dx, dy);
    if (!length) continue;
    const speed = shot.speed || 0;
    seen.push({ pos: point, velocity: [dx / length * speed, dy / length * speed],
      observed_at: now });
  }
  return seen;
}

/** server/bot_ai.evade: coarse sidestep from a visible projectile. */
export function evade(engine, actor, brain, now) {
  const pos = actor.positionAt(now);
  for (const shot of brain.bullets || []) {
    const [vx, vy] = shot.velocity;
    const speed2 = vx * vx + vy * vy;
    if (!speed2) continue;
    const age = (now - shot.observed_at) / 1000;
    const bx = shot.pos[0] + vx * age, by = shot.pos[1] + vy * age;
    const arrival = ((pos[0] - bx) * vx + (pos[1] - by) * vy) / speed2;
    if (!(arrival > 0 && arrival < 0.7)) continue;
    if (distance(pos, [bx + vx * arrival, by + vy * arrival]) > 68) continue;
    const speed = Math.sqrt(speed2);
    const side = actor.id % 2 ? 1 : -1;
    for (const sign of [side, -side]) {
      const dest = [pyRound(pos[0] - sign * vy / speed * 96),
        pyRound(pos[1] + sign * vx / speed * 96)];
      const end = engine.arena.geometry.walkEnd(pos, dest, engine.arena.waterRects(now));
      if (samePoint(end, dest)) {
        brain.goal = dest;
        brain.repathAt = 0;
        return;
      }
    }
  }
}

// ------------------------------------------------------------------ movement
export function stop(actor, now) {
  if (actor.motion === null || actor.motionKind !== 0) return [];
  actor.position = actor.positionAt(now);
  actor.motion = null;
  return [[1554, encodeS1554(actor.sceneId, actor.id, actor.position)]];
}

export function walk(engine, actor, brain, goal, now) {
  if (!goal || actor.blocked('move', now) || actor._speed(now) <= 0) return [];
  if (actor.motion && actor.motion[3] > now) return [];
  const pos = actor.positionAt(now);
  if (distance(pos, goal) < 20) return stop(actor, now);
  if (!engine.navigation) engine.navigation = new Navigation(engine.arena.geometry);
  const nav = engine.navigation;
  const friends = [...engine.arena.actors.values()]
    .filter((a) => a.id !== actor.id && a.camp === actor.camp && a.alive
      && !a.info.map_object && !a.info.cow_object && !a.info.bomb_cart)
    .map((a) => a.positionAt(now));
  const nearby = friends.filter((p) => distance(pos, p) < 240);
  const trapChanged = false;
  if (now >= (brain.repathAt || 0) || trapChanged) {
    brain.path = nav.path(pos, goal, brain.repair_threats || [],
      now < (brain.avoid_allies_until || 0) ? nearby : []);
    brain.repathAt = now + 1000;
  }
  const path = brain.path || [];
  while (path.length && distance(pos, path[0]) < 18) path.shift();
  if (!path.length) return [];
  const water = engine.arena.waterRects(now);
  const forwardStep = (waypoint) => {
    const steps = DIRECTIONS.map(([dx, dy], index) => {
      const dest = [pos[0] + dx * STEP, pos[1] + dy * STEP];
      return { distance: distance(dest, waypoint), direction: index, dest };
    }).sort((a, b) => a.distance - b.distance || a.direction - b.direction);
    return steps.find((step) => step.distance < distance(pos, waypoint)
      && samePoint(engine.arena.geometry.walkEnd(pos, step.dest, water), step.dest)) || null;
  };
  let step = forwardStep(path[0]);
  if (!step && path.length > 1 && distance(pos, path[0]) < 24) {
    step = forwardStep(path[1]);
    if (step) path.shift();
  }
  if (!step) {
    brain.path = [];
    brain.repathAt = now + 500;
    return stop(actor, now);
  }
  if (friends.some((p) => distance(step.dest, p) < 64
    && distance(step.dest, p) < distance(pos, p) - 1)) {
    brain.avoid_allies_until = now + 2000;
    if (now >= (brain.avoid_repath_at || 0)) {
      brain.path = nav.path(pos, goal, brain.repair_threats || [], nearby);
      brain.repathAt = brain.avoid_repath_at = now + 1000;
    }
    return stop(actor, now);
  }
  const speed = actor._speed(now);
  actor.position = pos;
  actor.motion = [pos, step.dest, now,
    now + Math.max(1, pyRound(distance(pos, step.dest) * 1000 / speed))];
  actor.motionKind = 0;
  // MOVE_NORMAL: start coordinate + direction, not an arbitrary endpoint.
  return [scenePacket({ moves: [{ owner: actor.id, position: pos, speed,
    kind: 0, direction: step.direction }] })];
}

// --------------------------------------------------------------------- aim
export function aim(engine, actor, observation, now) {
  const start = actor.positionAt(now);
  const pos = observation.pos;
  const dist = distance(start, pos);
  const travel = Math.min(0.65, dist / 850);
  const lead = randFloat(engine, 0.5, 0.95);
  const error = randGauss(engine, 0, 8 + dist * 0.025);
  const angle = Math.atan2(pos[1] - start[1], pos[0] - start[0]);
  return engine.arena.geometry.clampTankPosition([
    pos[0] + observation.velocity[0] * travel * lead - Math.sin(angle) * error,
    pos[1] + observation.velocity[1] * travel * lead + Math.cos(angle) * error,
  ]);
}

// ------------------------------------------------------------------- casting
function skillRange(engine, actor, slot) {
  const skillId = actor.skillForSlot(slot);
  if (!skillId) return null;
  try {
    const row = engine.arena.data.tableRow('SkillTemplate_table.xml', { nId: skillId });
    return { skillId, range: Number(row.get('iRange', 0)), cool: Number(row.get('iCoolTime', 0)) };
  } catch { return { skillId, range: 0, cool: 0 }; }
}

export function perform(engine, actor, slot, dest, target, now) {
  if (slot !== 0 && slot !== 1 && slot !== 2 && slot !== 10 && slot !== 4) return [];
  if (actor.skillSealed && actor.skillSealed(slot, now)) return [];
  if ((actor.cooldowns[slot] ?? 0) > now) return [];
  engine.arena.damageContext = [actor.id, actor.generation, 0, engine.arena.newId(2)];
  engine.arena.current_slot = slot;
  try {
    const packets = actor.cast(slot, actor.positionAt(now), dest, target, now);
    if (packets.length) {
      actor.pk_safe_until = 0;
      if (actor.hasBuff(358902, now)) packets.push(...actor.removeBuff(358902, now));
      if (actor.hasBuff(30105, now)) packets.push(...actor.removeBuff(30105, now));
    }
    return packets;
  } finally {
    engine.arena.damageContext = null;
    engine.arena.current_slot = null;
  }
}

// Kit ranges from bot_ai01/20 and the common default (fire range - 36).
const DESIRED_RANGE = Object.freeze({
  10000056: 125, 10000031: 340, 10000003: 140, 10000029: 340,
  10000065: 300, 10000019: 360, 10000001: 420, 10000041: 380,
  10000063: 300, 10000094: 180, 10000097: 400, 10000113: 500,
});

export function desiredRange(actor) {
  const tank = Number(actor.info.tank_id);
  if (DESIRED_RANGE[tank]) return DESIRED_RANGE[tank];
  return Math.min(420, Math.max(120, Number(actor.stats.nFireRange || 420) - 36));
}

function basicRange(actor) {
  return Number(actor.stats.nFireRange || 420);
}

const SUPPORT_TANKS = new Set([10000002, 10000003, 10000029, 10000031, 10000032,
  10000054, 10000061, 10000063, 10000065, 10000073, 10000080, 10000085,
  10000107, 10000113]);

/** Small, conservative support pass (bot_ai01/02/20 shapes). */
export function support(engine, actor, allies, now) {
  if (!SUPPORT_TANKS.has(Number(actor.info.tank_id))) return [];
  const wounded = allies.filter((a) => a.id !== actor.id && a.alive
    && !a.info.map_object && !a.inStasis() && ratio(a) < 0.72)
    .sort((a, b) => ratio(a) - ratio(b) || a.id - b.id);
  if (!wounded.length) return [];
  const target = wounded[0];
  for (const slot of [1, 2, 10]) {
    const info = skillRange(engine, actor, slot);
    if (!info) continue;
    if ((actor.cooldowns[slot] ?? 0) > now) continue;
    if (actor.skillSealed && actor.skillSealed(slot, now)) continue;
    const point = target.positionAt(now);
    const reach = info.range > 0 ? info.range : basicRange(actor);
    if (distance(actor.positionAt(now), point) > reach) continue;
    const packets = perform(engine, actor, slot, point, target.id, now);
    if (packets.length) return packets;
  }
  return [];
}

export function advanceGoal(engine, actor, brain, now) {
  const start = engine.arena.geometry.spawn(actor.camp, 0);
  const end = engine.arena.geometry.spawn(3 - actor.camp, 0);
  const stage = brain.advance_stage || 0;
  const fraction = [0.5, 0.7][stage];
  const [x, y] = pointAt(start, end, fraction);
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const length = Math.max(1, Math.hypot(dx, dy));
  const lane = (actor.id % 3 - 1) * 96;
  const goal = engine.arena.geometry.clampTankPosition(
    [x - (dy / length) * lane, y + (dx / length) * lane]);
  if (distance(actor.positionAt(now), goal) < 120) brain.advance_stage = 1 - stage;
  return goal;
}

// ----------------------------------------------------------------- decision
export function decide(engine, actor, brain, seen, now) {
  const pos = actor.positionAt(now);
  const nearby = seen.filter((s) => distance(pos, s.pos) < 960);
  const allies = [...engine.arena.actors.values()].filter((a) => a.alive
    && a.camp === actor.camp && !a.info.npc_template
    && !a.info.map_object && distance(pos, a.positionAt(now)) < 600);
  const tanks = nearby.filter((s) => !s.objective);
  const objective = engine.mode ? engine.mode.goal(actor, brain, seen, now) : null;
  brain.objective = objective ? objective.kind : null;
  if (!nearby.length) {
    brain.target = null;
    if (!brain.goal || !objective) {
      brain.goal = objective ? objective.dest : advanceGoal(engine, actor, brain, now);
    } else {
      brain.goal = objective.dest;
    }
    return support(engine, actor, allies, now);
  }
  let candidates = tanks.length ? tanks : nearby;
  if (engine.mode && engine.mode.targets) {
    const filtered = engine.mode.targets(actor, brain, seen, tanks, allies,
      objective || {});
    if (filtered) candidates = filtered;
  }
  if (!candidates.length) {
    brain.target = null;
    brain.goal = objective ? objective.dest : advanceGoal(engine, actor, brain, now);
    return support(engine, actor, allies, now);
  }
  const focus = [];
  for (const [id, other] of engine.brains) {
    const a = engine.arena.actors.get(id);
    if (a && a.camp === actor.camp && other.target) focus.push(other.target);
  }
  const score = (s) => distance(pos, s.pos) + s.hp * 180
    - focus.filter((id) => id === s.id).length * 40
    + (objective ? distance(objective.dest, s.pos) * 0.4 : 0);
  const target = candidates.reduce((best, s) => (score(s) < score(best) ? s : best), candidates[0]);
  brain.target = target.id;
  const dist = distance(pos, target.pos);
  const dest = aim(engine, actor, target, now);
  const exclude = target.turret_rect ? [target.turret_rect] : [];
  const blocked = engine.arena.geometry.wallContact(pos, target.pos, 0, { exclude }) !== null;
  const outnumbered = tanks.filter((s) => distance(pos, s.pos) < 480).length > allies.length + 1;
  const hpRatio = ratio(actor);
  const retreat = hpRatio < 0.28 || (outnumbered && hpRatio < 0.55);
  const desired = desiredRange(actor);
  if (retreat) {
    brain.goal = engine.arena.geometry.spawn(actor.camp,
      actor.info.spawn_index || 0, { respawn: true });
  } else if (target.structure || target.barrier) {
    brain.goal = [...target.pos];
  } else if (objective && ['bomb_escort', 'bomb_intercept', 'flag_hold'].includes(objective.kind)) {
    brain.goal = objective.dest;
  } else if (objective && !['base_push', 'survive'].includes(objective.kind)
    && (dist > 300 || distance(target.pos, objective.dest) > 360)) {
    brain.goal = objective.dest;
  } else if (dist > desired + 50 || blocked) {
    brain.goal = blocked ? [...target.pos]
      : pointAt(target.pos, pos, desired / Math.max(1, dist));
  } else if (dist < desired - 70 && ![10000056, 10000003].includes(Number(actor.info.tank_id))) {
    brain.goal = pointAt(pos, target.pos, -120 / Math.max(1, dist));
  } else {
    const side = actor.id % 2 ? 1 : -1;
    const dx = target.pos[0] - pos[0], dy = target.pos[1] - pos[1];
    brain.goal = [pos[0] - side * dy / Math.max(1, dist) * 72,
      pos[1] + side * dx / Math.max(1, dist) * 72];
  }
  return combat(engine, actor, brain, seen, nearby, allies, target, dest,
    retreat, blocked, now);
}

function combat(engine, actor, brain, seen, nearby, allies, target, dest,
  retreat, blocked, now) {
  const pos = actor.positionAt(now);
  const dist = distance(pos, target.pos);
  const exclude = target.turret_rect ? [target.turret_rect] : [];
  const supportPackets = support(engine, actor, allies, now);
  if (supportPackets.length) return supportPackets;
  if (actor.blocked('attack', now)) return [];
  if (target.structure || target.barrier) {
    if (dist <= basicRange(actor)
      && engine.arena.geometry.wallContact(pos, dest, 0, { exclude }) === null) {
      return perform(engine, actor, 0, dest, target.id, now);
    }
    return [];
  }
  // Generic kit order: keep a real native cast behind each slot.
  const order = dist < 300 ? [1, 2, 10] : [2, 10, 1];
  for (const slot of order) {
    const info = skillRange(engine, actor, slot);
    if (!info) continue;
    if ((actor.cooldowns[slot] ?? 0) > now) continue;
    if (actor.skillSealed && actor.skillSealed(slot, now)) continue;
    if (info.range > 0 && dist > info.range) continue;
    if (info.range === 0 && dist > 320) continue;
    if (retreat && ratio(actor) > 0.5) continue;
    const packets = perform(engine, actor, slot, dest, target.id, now);
    if (packets.length) return packets;
  }
  if (dist <= basicRange(actor)
    && engine.arena.geometry.wallContact(pos, dest, 0, { exclude }) === null) {
    return perform(engine, actor, 0, dest, target.id, now);
  }
  return [];
}

/** One PvP AI tick, called by the engine at 20 Hz. */
export function tickBots(engine, now) {
  if (!engine.botsEnabled || !engine.botIds || !engine.botIds.size) return [];
  if (engine.pk.finished) return [];
  if (engine.pk.round_phase && engine.pk.round_phase !== 'playing') return [];
  const packets = [];
  for (const id of engine.botIds) {
    const actor = engine.arena.actors.get(id);
    if (!actor || !actor.alive || actor.info.npc_template) continue;
    let brain = engine.brains.get(id);
    if (!brain || brain.generation !== actor.generation) {
      brain = {
        generation: actor.generation,
        notice_at: now + randInt(engine, 180, 350),
        observations: [], bullets: [], path: [], repathAt: 0, goal: null,
        target: null,
      };
      engine.brains.set(id, brain);
    }
    if (now >= brain.notice_at) {
      const seen = brain.observations || [];
      packets.push(...decide(engine, actor, brain, seen, now));
      if (engine.pk.finished) break;
      evade(engine, actor, brain, now);
      brain.observations = observe(engine, actor, brain, now);
      brain.bullets = observeBullets(engine, actor, now);
      brain.notice_at = now + randInt(engine, 180, 350);
    }
    if (engine.pk.finished) break;
    if (brain.goal !== null && brain.goal !== undefined) {
      packets.push(...walk(engine, actor, brain, brain.goal, now));
    }
    if (engine.pk.finished) break;
  }
  return packets;
}

// ------------------------------------------------------------------- roster
const BOT_NAMES = Object.freeze({
  10000001: 'Iron Man', 10000002: 'Groot', 10000003: 'Panda',
  10000008: 'Spider Man', 10000019: 'Gundam', 10000029: 'Chopper',
  10000030: 'Dark Knight', 10000031: 'Captain', 10000032: 'Teddy Bear',
  10000033: 'Pea Shooter', 10000034: 'Hulk', 10000035: 'Pegasus',
  10000036: 'Wukong', 10000037: 'Hulu', 10000038: 'Ghost Rider',
  10000039: 'Thor', 10000040: 'Werewolf', 10000041: 'Legolas',
  10000042: 'Songoku', 10000043: 'Thanh Giong', 10000044: 'Naruto',
  10000045: 'Sponge', 10000046: 'Luffy', 10000047: 'Pikachu',
  10000048: 'Assassin', 10000049: 'Transformer', 10000050: 'Time Hunter',
  10000051: 'Son Tinh', 10000052: 'Pumpkin', 10000053: 'Superman',
  10000054: 'Noel', 10000055: 'Kakashi', 10000056: 'Quan Vu',
  10000057: 'Dracula', 10000058: 'Medusa', 10000059: 'Phoenix',
  10000060: 'Minion', 10000061: 'Angel', 10000062: 'Optimus Prime',
  10000063: 'Thach Sanh', 10000064: 'Ichigo', 10000065: 'Mermaid',
  10000066: 'Edwina Knight', 10000067: 'Zhao Yun', 10000069: 'Scorpion',
  10000070: 'Deadpool', 10000071: 'Joker', 10000072: 'Apocalypse',
  10000073: 'Baymax', 10000074: 'Diao Chan', 10000075: 'Lu Bu',
  10000076: 'Kaneki', 10000077: 'Zoro', 10000078: 'Mikasa',
  10000079: 'Thuy Tinh', 10000080: 'Doraemon', 10000081: 'Sword God',
  10000082: 'Na Tra', 10000083: 'Doctor Strange', 10000084: 'Zhuge Liang',
  10000085: 'Athena', 10000086: 'Nine-tailed Fox', 10000087: 'Erlang',
  10000088: 'Gilgamesh', 10000089: 'Star Lord', 10000090: 'Natsu',
  10000091: 'Cao Cao', 10000092: 'Hades', 10000093: 'Sasuke',
  10000094: 'Lac Long Quan', 10000095: 'Kurumi', 10000096: 'Kirito',
  10000097: 'Magneto', 10000098: 'Sima Yi', 10000099: 'Mulan',
  10000100: 'Black Panther', 10000101: 'Sniper', 10000102: 'Saitama',
  10000103: 'Ox King', 10000104: 'Falcon', 10000105: 'Fire God',
  10000106: 'Elsa', 10000107: 'Hikari', 10000108: 'Shadowblade',
  10000109: 'Stone God', 10000110: 'Aquaman', 10000111: 'Tsubasa',
  10000112: 'Chu Du', 10000113: 'Time Goddess', 10000114: 'Night Wing',
  10000115: 'Daredevil',
});

/**
 * bot_setup.make_roster: allies are the player's camp, enemies the other.
 * Returns entries without the human player; ids start at 2.
 */
export function makeRoster({
  allies = 4, enemies = 5, rng = Math.random, playerTank = null,
  levels = null, firstId = 2, camp = 1,
} = {}) {
  const engineLike = { rng };
  const roster = [];
  let objectId = firstId;
  for (const side of ['enemies', 'allies']) {
    const count = side === 'allies' ? allies : enemies;
    const used = new Set(side === 'allies' && playerTank ? [Number(playerTank)] : []);
    const pool = AI_TANKS.filter((id) => !used.has(id));
    for (let i = 0; i < count && pool.length; i += 1) {
      const pick = Math.floor(rngValue(engineLike) * pool.length);
      const tankId = pool.splice(pick, 1)[0];
      const levelList = Array.isArray(levels) ? levels : levels?.[side];
      roster.push({
        objectId, camp: side === 'allies' ? camp : 3 - camp,
        tankId, tankLevel: levelList?.[i] ?? 1,
        name: `${BOT_NAMES[tankId] || `Bot ${tankId}`} ${objectId - 1}`,
        human: false, side,
      });
      objectId += 1;
    }
  }
  return roster;
}
