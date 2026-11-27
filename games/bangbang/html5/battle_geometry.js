/* Client prediction mirrors the authoritative 72px walking footprint.
 * Keep native nine-cell terrain poses and accept a fully clear continuous
 * body in authored off-grid corridors. Live NPC rectangles stay exact.
 * All coordinates here are unmirrored server/world coordinates.
 */
import {nativeControlFlags, visualPosition} from './combat_state.js';

const NPC_OBJECT_TYPE = 3; // ShareTypes.GAME_OBJECT_TYPE.ZUOBJ_NPC; BattleObjectTool >>26.
const DECORATION_TYPES = new Set([51, 52, 53]);
const WALK_PADDING = 35.999;

function rectContact(start, end, rectangles, padding = WALK_PADDING) {
  const [x, y] = start, dx = end[0] - x, dy = end[1] - y;
  let first = null;
  for (const [left, top, right, bottom] of rectangles) {
    let low = 0, high = 1;
    if (dx === 0) {
      if (!(left - padding <= x && x <= right + padding)) continue;
    } else {
      let a = (left - padding - x) / dx, b = (right + padding - x) / dx;
      if (a > b) [a, b] = [b, a];
      low = Math.max(low, a); high = Math.min(high, b);
      if (low > high) continue;
    }
    if (dy === 0) {
      if (!(top - padding <= y && y <= bottom + padding)) continue;
    } else {
      let a = (top - padding - y) / dy, b = (bottom + padding - y) / dy;
      if (a > b) [a, b] = [b, a];
      low = Math.max(low, a); high = Math.min(high, b);
      if (low > high) continue;
    }
    if (first == null || low < first) first = low;
    if (first === 0) break;
  }
  return first;
}

function terrainContactIndex(map, cells) {
  // The server imports raw rectangles when present; older maps use cells.
  // Do not derive a larger/smaller footprint from the rendered skin.
  const rectangles = map.blocks?.length
    ? map.blocks.filter(row => row[4] === -1 || row[4] === -2)
      .map(([x, y, width, height]) => [x - width / 2, y - height / 2, x + width / 2, y + height / 2])
    : [...cells].filter(([, value]) => value === -1 || value === -2)
      .map(([index]) => { const x = index % map.columns * 24, y = Math.floor(index / map.columns) * 24;
        return [x, y, x + 24, y + 24]; });
  const bins = new Map();
  for (const rect of rectangles) {
    for (let x = Math.floor(rect[0] / 192); x <= Math.floor(rect[2] / 192); x += 1) {
      for (let y = Math.floor(rect[1] / 192); y <= Math.floor(rect[3] / 192); y += 1) {
        const key = `${x},${y}`;
        if (!bins.has(key)) bins.set(key, new Set());
        bins.get(key).add(rect);
      }
    }
  }
  return (start, end) => {
    const nearby = new Set();
    for (let x = Math.floor((Math.min(start[0], end[0]) - 36) / 192);
      x <= Math.floor((Math.max(start[0], end[0]) + 36) / 192); x += 1) {
      for (let y = Math.floor((Math.min(start[1], end[1]) - 36) / 192);
        y <= Math.floor((Math.max(start[1], end[1]) + 36) / 192); y += 1) {
        for (const rect of bins.get(`${x},${y}`) || []) nearby.add(rect);
      }
    }
    return rectContact(start, end, nearby);
  };
}

export function createBattleGeometry(map, catalog) {
  if (!map || map.cellSize !== 24 || !(map.width > 0) || !(map.height > 0)
      || map.columns !== Math.trunc(map.width / 24)) {
    throw new Error('Verified native 24px map geometry is required');
  }
  const cells = new Map(map.gridCells ?? []);
  const buffCatalog = catalog?.buffs ?? {}, skillCatalog = catalog?.skills ?? {};
  const initialNpcs = new Map((map.staticNPCs ?? []).map(npc => [npc.instance, npc]));
  const npcTemplates = {...(catalog?.mapNPCs || {}), ...(map.npcTemplates || {})};
  // These source gates are AINpc (type5), not static Npc (type3). Their
  // rectangles are separate from terrain and disappear with the native door
  // snapshot. Never keep a closed gate merely because it exists in the map:
  // an absent door after a resume snapshot may already have been opened.
  const scriptedDoors = (map.authoritativeDefinition?.pve_barriers || []).flatMap(barrier =>
    (map.authoritativeDefinition?.pve_spawns || []).filter(spawn => spawn.point === barrier.point
      && spawn.templates.some(id => [414, 415, 1414].includes(id))).map(spawn =>
      ({rect: barrier.rect, position: spawn.position, templates: spawn.templates})));
  const gridValueAt = (x, y) => cells.get(Math.trunc(y / 24) * map.columns + Math.trunc(x / 24)) ?? 0;
  const turfAt = (x, y) => { const value = gridValueAt(x, y); return value <= -3 ? value : 0; };
  const losRange = Number(map.raw?.nVisualrange) > 0 ? Number(map.raw.nVisualrange) : 10000;
  const bounds = map.bounds ?? [36, 36, map.width - 36, map.height - 36];
  const exterior = Number(map.mapId) === 7 ? [[0, 0, map.width, 216], [0, 0, 216, 504]] : [];
  const terrainContact = terrainContactIndex(map, cells);

  function withinBounds(point) {
    return point[0] >= bounds[0] && point[1] >= bounds[1]
      && point[0] <= bounds[2] && point[1] <= bounds[3]
      && rectContact(point, point, exterior) == null;
  }

  function gridTerrainClear(x, y) {
    const point = [Math.floor((x - 36) / 24) * 24 + 36, Math.floor((y - 36) / 24) * 24 + 36];
    return withinBounds(point) && terrainContact(point, point) == null;
  }

  function terrainClear(x, y) {
    const point = [x, y];
    return withinBounds(point) && (gridTerrainClear(x, y) || terrainContact(point, point) == null);
  }

  function npcRectangle(npc) {
    const row = npcTemplates[String(npc.templateId)]?.raw;
    const initial = initialNpcs.get(npc.objectId & 0x3ffffff);
    const type = Number(row?.iType ?? initial?.type ?? 0);
    const width = Number(row?.iWidth ?? initial?.width ?? 0);
    const height = Number(row?.iHeight ?? initial?.height ?? 0);
    if (DECORATION_TYPES.has(type) || width <= 0 || height <= 0) return null;
    return {x: npc.x, y: npc.y, width, height};
  }

  function liveNpcs(state) {
    // Native SelfMoveRule uses NpcModel.npcList, not all templates in the map.
    // In a resumed match, an absent NPC stays absent after the S1561 marker.
    if (state) return Object.values(state.objects ?? {}).filter(npc =>
      (npc.objectId >>> 26) === NPC_OBJECT_TYPE && !npc.removed && !npc.dead
      && !(npc.maxHp > 0 && npc.hp <= 0));
    // Standalone source-map inspection only; gameplay always supplies state.
    return [...initialNpcs.values()].map(npc => ({objectId: NPC_OBJECT_TYPE * 0x4000000 + npc.instance,
      templateId: npc.templateId ?? npc.template, x: npc.x, y: npc.y}));
  }

  function liveRectangles(state) {
    const rectangles = liveNpcs(state).map(npcRectangle).filter(Boolean).map(rect =>
      [rect.x - rect.width / 2, rect.y - rect.height / 2,
        rect.x + rect.width / 2, rect.y + rect.height / 2]);
    const doors = state ? scriptedDoors.filter(door => Object.values(state.objects ?? {}).some(npc =>
      (npc.objectId >>> 26) === 5 && !npc.removed && !npc.dead
      && !(npc.maxHp > 0 && npc.hp <= 0) && door.templates.includes(npc.templateId)
      && npc.x === door.position[0] && npc.y === door.position[1])) : scriptedDoors;
    return rectangles.concat(doors.map(door => door.rect));
  }

  function clearPose(point, rectangles) {
    return terrainClear(...point) && rectContact(point, point, rectangles) == null;
  }

  function canWalk(x, y, actor, state) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || (state && !state.objectsReady)) return false;
    return clearPose([x, y], liveRectangles(state));
  }

  function canStep(from, to, actor, state) {
    if (state && !state.objectsReady) return false;
    const start = [from.x, from.y], end = [to.x, to.y];
    if (![...start, ...end].every(Number.isFinite)) return false;
    const rectangles = liveRectangles(state);
    if (!clearPose(start, rectangles) || !clearPose(end, rectangles)
        || rectContact(start, end, rectangles) != null || rectContact(start, end, exterior) != null) return false;
    if (terrainContact(start, end) == null) return true;
    const cuts = new Set([0, 1]);
    for (let axis = 0; axis < 2; axis += 1) {
      const a = start[axis], b = end[axis];
      if (a === b) continue;
      const low = Math.min(a, b), high = Math.max(a, b);
      for (let cell = Math.floor((low - 36) / 24) + 1; cell < Math.ceil((high - 36) / 24); cell += 1) {
        const fraction = (36 + cell * 24 - a) / (b - a);
        if (fraction > 0 && fraction < 1) cuts.add(fraction);
      }
    }
    const sorted = [...cuts].sort((a, b) => a - b);
    const at = t => start.map((value, i) => value + (end[i] - value) * t);
    if (sorted.slice(1, -1).some(t => !clearPose(at(t), rectangles))) return false;
    for (let i = 1; i < sorted.length; i += 1) {
      const left = sorted[i - 1], right = sorted[i];
      if (!gridTerrainClear(...at((left + right) / 2)) && terrainContact(at(left), at(right)) != null) return false;
    }
    return true;
  }

  function canMoveActor(actor, state, now) {
    const flags = nativeControlFlags(actor, buffCatalog, now, skillCatalog);
    return Boolean(state?.objectsReady && !flags.movementBlocked && !flags.unknownTemplates.length);
  }

  function visibleToSelf(value, state, now) {
    if (!value || value.removed || value.dead) return false;
    const self = state.actors?.[String(state.selfObjectId)];
    if (!self) return false;
    const flags = nativeControlFlags(value, buffCatalog, now, skillCatalog);
    if (flags.disappeared) return false;
    const ally = value.objectId === self.objectId || value.camp === self.camp;
    // CTank.updateVisible handles stealth/reveal separately from GameTool LOS.
    if (flags.invisible && !ally && !flags.revealed) return false;
    if (ally) return true;
    // S1605 records the actual caster of a change to an allied tank. This is
    // visibility only; an HP delta never substitutes for S1564 absolute HP.
    if (value.lastHurtRevealAt != null && value.lastHurtRevealAt > now - 5000) return true;
    const target = visualPosition(value, now), targetTurf = turfAt(target.x, target.y);
    const probes = [...Object.values(state.actors ?? {}), ...Object.values(state.objects ?? {})];
    for (const probe of probes) {
      if (probe.camp !== self.camp || probe.removed || probe.dead || (probe.hp <= 0 && probe.maxHp > 0)) continue;
      const position = visualPosition(probe, now);
      if ((target.x - position.x) ** 2 + (target.y - position.y) ** 2 <= losRange ** 2
          && (targetTurf === 0 || targetTurf === turfAt(position.x, position.y))) return true;
    }
    return false;
  }

  return {width: map.width, height: map.height, cellSize: 24, columns: map.columns,
    bounds: [...bounds],
    cameraBounds: [0, 0, map.width, map.height], buffCatalog, skillCatalog,
    losRange, gridValueAt, turfAt, terrainClear, npcRectangle, canWalk, canStep, canMoveActor, visibleToSelf};
}
