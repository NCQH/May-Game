// PvE NPC decision loop, ported from server/pve_tactics.py, pve_movement.py
// and the map-201 branch of pve_npc.py / pve_rules.py.
//
// This module is geometry-agnostic. The battle core supplies `world` hooks:
//   world.map                 normalized pve-data map (paths + logic graph)
//   world.actors              array of actors ({id,generation,template,camp,alive,x,y,...})
//   world.playerCamp          hostile camp (usually 1)
//   world.rng.choice(array)   deterministic RNG (defaults to Math.random)
//   world.lineClear(a,from,to,now)        LOS / wall sweep
//   world.walkable(actor,point)           tank footprint fits
//   world.walkEnd(actor,from,to,water)    one 24px step, or null
//   world.inPlayable(point)               optional
//   world.waterRects(now)                 optional [x,y,w,h][]
//   world.weaponLine(actor,from,to,now)   optional projectile/water check
//   world.clipFraction(actor,from,to,now) optional 0..1 for map-201 laser 1115
//   world.blocked(actor,kind,now)         optional attack/move lock
//   world.skillSealed(actor,now)          optional
//   world.observableHook(actor,target,now,range) optional
//   world.finished, world.tactics (false disables pve_tactics v1)
//
// tickNpc() returns {actions, state, goal, patrolling}. Actions are intents:
//   {type:'move', from,to,direction,speed,duration,goal}
//   {type:'cast', slot, template, skillId, start,dest,targetId,targetGeneration,laser}
//   {type:'stop'}
// The core remains responsible for damage, projectiles, animation and packets.

export const PERCEPTION_MS = 200;
export const PLAN_MS = 800;
export const MEMORY_MS = 1800;
export const NOTICE_RANGE = 600;
export const STEP = 24;
export const DIRECTIONS = Object.freeze([
  [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0],
]);

// pve_tactics.SCRIPTED / SPECIAL_WEAPONS (trap, transport, support, bosses).
export const SCRIPTED = new Set([
  255, 261, 263, 264, 265, 266,
  409, 414, 415, 416, 440, 612, 613,
  1409, 1414, 1416, 1440, 353, 342,
  1350, 1351, 1353, 1354, 2612, 2613, 2673, 2676,
  517, 518, 519, 520, 522, 524, 525, 526, 527, 567, 578,
  717, 718, 719, 720, 721, 3110112, 3110113, 3110310, 3110312,
  3130108, 3130210, 3130211, 3140212, 3160203,
  3150209, 3150210, 3160111, 3160112, 3160113, 3160115, 3160116, 3160211,
]);
export const SPECIAL_WEAPONS = new Set([
  0, 1000034, 1000062, 1000122,
  1000054, 1000055, 1000057, 1000060, 1000061, 1000134, 50332,
]);
export const LOB_WEAPONS = new Set([1000010, 1000017, 1000037, 1000065, 1000069]);

const posOf = (a) => [Number(a.x), Number(a.y)];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const samePoint = (a, b) => a[0] === b[0] && a[1] === b[1];
const roundPoint = (p) => [Math.round(p[0]), Math.round(p[1])];
const moving = (a, now) => Number(a.motionUntil || 0) > now;
const choice = (world, list) => {
  if (!list.length) return null;
  if (world.rng && typeof world.rng.choice === 'function') return world.rng.choice(list);
  return list[Math.floor((world.rng ? world.rng.next() : Math.random()) * list.length)];
};

// ------------------------------------------------------------ geometry hooks
export function lineClear(world, actor, from, to, now) {
  return world.lineClear ? world.lineClear(actor, from, to, now) : true;
}
/** combat_geometry.rect_contact: first swept fraction, [l,t,r,b] rects. */
export function rectContact(start, end, rectangles, padding = 0) {
  const [x, y] = start;
  const dx = end[0] - x, dy = end[1] - y;
  let first = null;
  for (const [left, top, right, bottom] of rectangles || []) {
    let low = 0, high = 1;
    if (dx === 0) {
      if (!(left - padding <= x && x <= right + padding)) continue;
    } else {
      let t1 = (left - padding - x) / dx, t2 = (right + padding - x) / dx;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > low) low = t1;
      if (t2 < high) high = t2;
      if (low > high) continue;
    }
    if (dy === 0) {
      if (!(top - padding <= y && y <= bottom + padding)) continue;
    } else {
      let t1 = (top - padding - y) / dy, t2 = (bottom + padding - y) / dy;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > low) low = t1;
      if (t2 < high) high = t2;
      if (low > high) continue;
    }
    if (first === null || low < first) first = low;
    if (first === 0) return first;
  }
  return first;
}

export function weaponLine(world, actor, from, to, now) {
  if (world.weaponLine) return world.weaponLine(actor, from, to, now);
  if (!lineClear(world, actor, from, to, now)) return false;
  if (LOB_WEAPONS.has(Number(actor.skill || 0))) return true;
  const water = world.waterRects ? world.waterRects(now) : null;
  return !water || rectContact(from, to, water) === null;
}
function walkEnd(world, actor, from, to, now) {
  if (!world.inPlayable || world.inPlayable(to)) {
    if (world.walkEnd) {
      return world.walkEnd(actor, from, to, world.waterRects ? world.waterRects(now) : null);
    }
    if (!world.walkable || world.walkable(actor, to)) return [...to];
  }
  return null;
}
export function observable(world, actor, target, now, range = NOTICE_RANGE) {
  if (!target || target === actor || target.alive === false) return false;
  if (target.camp === actor.camp) return false;
  const start = posOf(actor); const end = posOf(target);
  if (dist(start, end) > range) return false;
  if (world.observableHook) return !!world.observableHook(actor, target, now, range);
  return lineClear(world, actor, start, end, now);
}

// pve_tactics.eligible / extended_eligible.
export function tacticsEligible(actor, { modern = false, playerCamp = 1 } = {}) {
  if (!actor || actor.pveNpc === false || actor.camp === playerCamp) return false;
  if (SCRIPTED.has(Number(actor.template))) return false;
  if (actor.hostage || actor.trap || actor.fortification
      || actor.localForklift || actor.mapObject) return false;
  if (SPECIAL_WEAPONS.has(Number(actor.skill || 0))) return false;
  if (!(Number(actor.fireRange) > 0)) return false;
  if (modern) return !!(actor.stationary || Number(actor.speed) > 0);
  if (actor.stationary || actor.flying) return false;
  return Number(actor.speed) > 0;
}

// ---------------------------------------------------------- goal selection
export function chooseGoal(world, actor, targetPos, now, opts = {}) {
  const pos = posOf(actor);
  const radius = Number(opts.fireRange ?? actor.fireRange);
  const melee = radius <= 180;
  let ideal = melee ? Math.max(48, radius * 0.65) : Math.min(360, Math.max(144, radius * 0.66));
  if (opts.preferredRange != null) ideal = Math.max(24, Math.min(radius, Number(opts.preferredRange)));
  const distance = dist(pos, targetPos);
  const friends = (world.actors || [])
    .filter((a) => a !== actor && a.alive !== false && a.camp === actor.camp
      && !a.mapObject && dist(pos, posOf(a)) < 240)
    .sort((a, b) => dist(pos, posOf(a)) - dist(pos, posOf(b)))
    .slice(0, 8).map(posOf);
  const dx = targetPos[0] - pos[0], dy = targetPos[1] - pos[1];
  const length = Math.max(1, Math.hypot(dx, dy));
  const side = opts.strafeSide == null ? (actor.id % 2 ? 1 : -1) : (opts.strafeSide >= 0 ? 1 : -1);
  const choices = [pos];
  for (const step of [48, 96]) {
    for (const [ux, uy] of DIRECTIONS) {
      const p = roundPoint([pos[0] + ux * step, pos[1] + uy * step]);
      const end = walkEnd(world, actor, pos, p, now);
      if (end && samePoint(end, p)) choices.push(p);
    }
  }
  const score = (p) => {
    const gap = dist(p, targetPos);
    let spacing = Math.abs(gap - ideal);
    if (melee && gap <= radius) spacing *= 0.35;
    const clear = weaponLine(world, actor, p, targetPos, now);
    const obstruction = clear ? 0 : 300;
    const crowd = friends.reduce((n, f) => n + Math.max(0, 84 - dist(p, f)) * 2, 0);
    const travel = dist(pos, p) * 0.07;
    const lateral = ((p[1] - pos[1]) * dx - (p[0] - pos[0]) * dy) / length;
    const orbit = (opts.strafe && !melee && distance <= radius)
      ? -Math.min(24, Math.max(0, side * lateral) * 0.35) : 0;
    return spacing + obstruction + crowd + travel + orbit;
  };
  const current = score(pos);
  const pick = (list, rank) => list.reduce((best, p) => {
    const s = rank(p), bs = rank(best);
    if (s !== bs) return s < bs ? p : best;
    const dp = dist(pos, p), db = dist(pos, best);
    if (dp !== db) return dp < db ? p : best;
    if (p[0] !== best[0]) return p[0] < best[0] ? p : best;
    return p[1] < best[1] ? p : best;
  });
  const goal = pick(choices, score);
  if (!weaponLine(world, actor, pos, targetPos, now)) {
    const clear = choices.filter((p) => weaponLine(world, actor, p, targetPos, now));
    if (clear.length) return pick(clear, score);
    const limit = Math.min(NOTICE_RANGE - 24, Math.max(radius * 1.15, distance + 24));
    const probes = choices.filter((p) => !samePoint(p, pos) && dist(p, targetPos) <= limit);
    const probeScore = (p) => {
      const lateral = ((p[1] - pos[1]) * dx - (p[0] - pos[0]) * dy) / length;
      const crowd = friends.reduce((n, f) => n + Math.max(0, 84 - dist(p, f)) * 2, 0);
      return Math.abs(dist(p, targetPos) - ideal) * 0.2 + crowd - Math.abs(lateral)
        - (side * lateral > 0 ? 16 : 0);
    };
    if (probes.length) return pick(probes, probeScore);
  }
  if (score(goal) < current - 2) return goal;
  if (distance > radius * 0.9) return [...targetPos];
  return pos;
}

export function chooseAirGoal(world, actor, targetPos, now, opts = {}) {
  const pos = posOf(actor);
  const radius = Number(actor.fireRange);
  const ideal = opts.preferredRange == null ? Math.min(360, Math.max(144, radius * 0.66))
    : Math.max(24, Math.min(radius, Number(opts.preferredRange)));
  const distance = dist(pos, targetPos);
  const friends = (world.actors || [])
    .filter((a) => a !== actor && a.alive !== false && a.camp === actor.camp
      && !a.mapObject && dist(pos, posOf(a)) < 240)
    .sort((a, b) => dist(pos, posOf(a)) - dist(pos, posOf(b)))
    .slice(0, 8).map(posOf);
  const dx = targetPos[0] - pos[0], dy = targetPos[1] - pos[1];
  const length = Math.max(1, Math.hypot(dx, dy));
  const side = opts.strafeSide == null ? (actor.id % 2 ? 1 : -1) : (opts.strafeSide >= 0 ? 1 : -1);
  const choices = [pos];
  for (const step of [48, 96]) {
    for (const [ux, uy] of DIRECTIONS) {
      const p = roundPoint([pos[0] + ux * step, pos[1] + uy * step]);
      if (world.clamp && !samePoint(world.clamp(p), p)) continue;
      if (world.inPlayable && !world.inPlayable(p)) continue;
      choices.push(p);
    }
  }
  const score = (p) => {
    const spacing = Math.abs(dist(p, targetPos) - ideal);
    const crowd = friends.reduce((n, f) => n + Math.max(0, 84 - dist(p, f)) * 2, 0);
    const lateral = ((p[1] - pos[1]) * dx - (p[0] - pos[0]) * dy) / length;
    const orbit = (opts.strafe && distance <= radius)
      ? -Math.min(24, Math.max(0, side * lateral) * 0.35) : 0;
    return spacing + crowd + dist(pos, p) * 0.07 + orbit;
  };
  const clear = choices.filter((p) => weaponLine(world, actor, p, targetPos, now));
  if (clear.length) {
    const best = clear.reduce((b, p) => (score(p) < score(b) ? p : b), clear[0]);
    if (!weaponLine(world, actor, pos, targetPos, now) || score(best) < score(pos) - 2) return best;
  } else if (choices.length > 1) {
    const probes = choices.filter((p) => !samePoint(p, pos)
      && dist(p, targetPos) <= Math.max(NOTICE_RANGE - 24, distance + 24));
    if (probes.length) {
      const probe = (p) => {
        const lateral = ((p[1] - pos[1]) * dx - (p[0] - pos[0]) * dy) / length;
        return score(p) * 0.2 - Math.abs(lateral) - (side * lateral > 0 ? 16 : 0);
      };
      return probes.reduce((b, p) => (probe(p) < probe(b) ? p : b), probes[0]);
    }
  }
  if (distance > radius * 0.9) {
    return world.clamp ? world.clamp(targetPos) : [...targetPos];
  }
  return pos;
}

export function chooseTarget(world, actor, state, now, { modern = false } = {}) {
  const pos = posOf(actor);
  const choices = (world.actors || []).filter((t) => t !== actor && t.alive !== false
    && !t.mapObject && !t.hostage && observable(world, actor, t, now, NOTICE_RANGE));
  if (!choices.length) return null;
  const shootable = (t) => t && dist(pos, posOf(t)) <= Number(actor.fireRange)
    && weaponLine(world, actor, pos, posOf(t), now);
  const nearest = choices.reduce((b, t) => {
    const kb = modern && !shootable(b) ? 1 : 0;
    const kt = modern && !shootable(t) ? 1 : 0;
    if (kt !== kb) return kt < kb ? t : b;
    return (dist(pos, posOf(t)) < dist(pos, posOf(b))
      || (dist(pos, posOf(t)) === dist(pos, posOf(b)) && t.id < b.id)) ? t : b;
  });
  const current = choices.find((t) => t.id === state.target
    && t.generation === state.targetGeneration);
  if (current && (!modern || shootable(current) || !shootable(nearest))
      && dist(pos, posOf(current)) <= dist(pos, posOf(nearest)) + 96) return current;
  return nearest;
}

function setGoal(brain, goal) {
  const g = [Number(goal[0]), Number(goal[1])];
  if (brain.goal == null || dist(g, brain.goal) >= 24) {
    brain.path = [];
    brain.repathAt = 0;
  }
  brain.goal = g;
  brain.patrolling = false;
}

// ------------------------------------------------------------- patrol graph
function logicPoints(map, logicId) {
  if (!map || !map.logic) return null;
  if (map.logic.flat && (logicId == null || logicId === 0)) {
    return map.logic.flat;
  }
  const graph = (map.logic.graphs || []).find((g) => g.id === logicId);
  return graph ? graph.points : null;
}
function edgePoints(map, from, to) {
  const edge = (map.paths || []).find((p) => p.ends.length === 2
    && p.ends.includes(from) && p.ends.includes(to));
  if (!edge) return null;
  return edge.ends[0] === from ? edge.points : [...edge.points].reverse();
}

/** Advance one authored patrol edge; mutates routeQueue/routePoint like Python. */
export function advancePatrol(world, actor) {
  const map = world.map;
  if (!actor.routeQueue) actor.routeQueue = [];
  if (actor.routeQueue.length) return actor.routeQueue[0];
  const nodes = logicPoints(map, actor.logic);
  const node = nodes && nodes.find((n) => n.id === actor.routePoint);
  if (!node || !node.next || !node.next.length) return null;
  const options = node.next.filter((i) => i !== actor.routePrevious);
  const end = choice(world, options.length ? options : node.next);
  const points = edgePoints(map, actor.routePoint, end);
  if (!points) return null;
  actor.routeQueue = points
    .map((p) => [Number(p[0]), Number(p[1])])
    .filter((p) => actor.flying || !world.walkable || world.walkable(actor, p));
  actor.routePrevious = actor.routePoint;
  actor.routePoint = end;
  return actor.routeQueue[0] || null;
}

export function patrolGoal(world, actor, now, { airArrival = 12 } = {}) {
  const pos = posOf(actor);
  if (actor.trap) return advancePatrol(world, actor) || pos;
  if (moving(actor, now) || (world.blocked && world.blocked(actor, 'move', now))
      || actor.stationary || !(Number(actor.speed) > 0)) {
    return actor.goal ? [...actor.goal] : pos;
  }
  const visited = new Set();
  for (let guard = 0; guard < 64; guard += 1) {
    if (!actor.routeQueue) actor.routeQueue = [];
    if (!actor.routeQueue.length) {
      const edgeKey = `${actor.routePrevious}:${actor.routePoint}`;
      if (visited.has(edgeKey)) return pos;
      visited.add(edgeKey);
      if (!advancePatrol(world, actor)) return pos;
    }
    const goal = actor.routeQueue[0];
    if (dist(pos, goal) >= (actor.flying ? airArrival : 20)) return [...goal];
    actor.routeQueue.shift();
  }
  return pos;
}

// --------------------------------------------------------------- movement
function walkablePoint(world, actor, p) {
  if (world.inPlayable && !world.inPlayable(p)) return false;
  return !world.walkable || world.walkable(actor, p);
}

/** First legal 24px step toward goal: greedy, then a bounded BFS around walls. */
export function nextWalkStep(world, actor, goal, now) {
  if (!goal || moving(actor, now) || actor.stationary || !(Number(actor.speed) > 0)) return null;
  if (world.blocked && world.blocked(actor, 'move', now)) return null;
  const start = posOf(actor);
  if (dist(start, goal) <= 12) return null;
  const options = [];
  for (let direction = 0; direction < 8; direction += 1) {
    const [ux, uy] = DIRECTIONS[direction];
    const to = [start[0] + ux * STEP, start[1] + uy * STEP];
    const end = walkEnd(world, actor, start, to, now);
    if (!end || !samePoint(end, to)) continue;
    options.push({ to, direction, distance: dist(to, goal) });
  }
  if (options.length) {
    options.sort((a, b) => a.distance - b.distance || a.direction - b.direction);
    if (options[0].distance < dist(start, goal)) return options[0];
  }
  // Bounded BFS: reconstruct the first step of a route around a corner.
  const key = (p) => `${p[0]},${p[1]}`;
  const queue = [{ p: start, first: null }];
  const seen = new Set([key(start)]);
  for (let head = 0; head < queue.length && head < 512; head += 1) {
    const { p, first } = queue[head];
    if (dist(p, goal) <= STEP) return first;
    for (let direction = 0; direction < 8; direction += 1) {
      const [ux, uy] = DIRECTIONS[direction];
      const next = [p[0] + ux * STEP, p[1] + uy * STEP];
      if (seen.has(key(next))) continue;
      const end = walkEnd(world, actor, p, next, now);
      if (!end || !samePoint(end, next)) continue;
      seen.add(key(next));
      queue.push({ p: next, first: first || { to: next, direction, distance: dist(next, goal) } });
    }
  }
  return options.length ? options[0] : null;
}

/** One 24px air step: bounds/clamp only; flying ignores terrain (M44). */
export function nextAirStep(world, actor, goal, now) {
  if (!goal || moving(actor, now) || actor.stationary || !(Number(actor.speed) > 0)) return null;
  if (world.blocked && world.blocked(actor, 'move', now)) return null;
  const start = posOf(actor);
  const distance = dist(start, goal);
  if (distance <= 12) return null;
  const options = [];
  for (let direction = 0; direction < 8; direction += 1) {
    const [ux, uy] = DIRECTIONS[direction];
    const to = [start[0] + ux * STEP, start[1] + uy * STEP];
    if (world.clamp && !samePoint(world.clamp(to), to)) continue;
    if (world.inPlayable && !world.inPlayable(to)) continue;
    if (dist(to, goal) >= distance) continue;
    options.push({ to, direction, distance: dist(to, goal) });
  }
  if (!options.length) return null;
  options.sort((a, b) => a.distance - b.distance || a.direction - b.direction);
  return options[0];
}

export function applyMove(actor, action, now = 0) {
  actor.x = action.to[0];
  actor.y = action.to[1];
  actor.direction = action.direction;
  actor.motionUntil = now + Number(action.duration || 0);
  return action;
}

// ------------------------------------------------------------- cast / queue
function clipLaser(world, actor, start, end, now) {
  // PveNpc._shot: point_at(start, dest, 360/dist) -> a full 360px ray; a
  // nearer target does not shorten it. Wall/water then clips the far point.
  const d = dist(start, end);
  const far = d ? [start[0] + (end[0] - start[0]) * 360 / d,
    start[1] + (end[1] - start[1]) * 360 / d] : [...start];
  const fraction = world.clipFraction ? Number(world.clipFraction(actor, start, far, now)) : 1;
  const clamped = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 1));
  return [start[0] + (far[0] - start[0]) * clamped,
    start[1] + (far[1] - start[1]) * clamped];
}

function blocked(world, actor, kind, now) {
  return world.blocked ? !!world.blocked(actor, kind, now) : false;
}
function sealed(world, actor, now) {
  return world.skillSealed ? !!world.skillSealed(actor, now) : false;
}

export function castAction(actor, target, world, now, state) {
  if (!actor.skill || !target || target.alive === false || target.camp === actor.camp) return null;
  if (blocked(world, actor, 'attack', now) || sealed(world, actor, now)) return null;
  actor.cooldowns = actor.cooldowns || {};
  if (Number(actor.cooldowns[0] || 0) > now) return null;
  const template = Number(actor.template);
  const start = posOf(actor);
  const dest = posOf(target);
  if (samePoint(start, dest) && actor.skill !== 1000034) return null;
  const boss = template === 1120;
  actor.cooldowns[0] = now + (boss ? 4000 : Math.max(1, Number(actor.fireInterval || 1000)));
  const action = {
    type: 'cast', slot: 0, template, skillId: Number(actor.skill),
    start, dest, targetId: target.id, targetGeneration: target.generation, laser: false,
  };
  if (boss) {
    // pve_npc.cast() map-201 boss: two queued bursts at +1s/+2s, 4s cadence.
    state.queue = state.queue || [];
    for (const delayMs of [1000, 2000]) {
      state.queue.push({
        due: now + delayMs, targetId: target.id, targetGeneration: target.generation,
        generation: actor.generation, template,
      });
    }
    action.burstCount = 2;
  } else if (Number(actor.skill) === 1000009 || template === 1115) {
    // PveNpc._shot map-201 1115: instant 360px strip, clipped by wall/water.
    action.laser = true;
    action.dest = clipLaser(world, actor, start, dest, now);
  }
  return action;
}

function dueBursts(world, actor, state, now) {
  if (!state.queue || !state.queue.length) return [];
  const actions = [];
  const rest = [];
  for (const event of state.queue) {
    if (event.due > now) { rest.push(event); continue; }
    const target = (world.actors || []).find((t) => t.id === event.targetId
      && t.generation === event.targetGeneration && t.alive !== false && t.camp !== actor.camp);
    if (!target || actor.generation !== event.generation || actor.alive === false
        || blocked(world, actor, 'attack', now) || sealed(world, actor, now)
        || dist(posOf(actor), posOf(target)) > Number(actor.fireRange)
        || !observable(world, actor, target, now, Number(actor.fireRange))) continue;
    actions.push({
      type: 'cast', slot: 0, template: Number(actor.template), skillId: Number(actor.skill),
      start: posOf(actor), dest: posOf(target), targetId: target.id,
      targetGeneration: target.generation, laser: false, burst: true,
    });
  }
  state.queue = rest;
  return actions;
}

// ------------------------------------------------------------------ tick
export function createBrain() {
  return { path: [], repathAt: 0, noticeAt: 0, goal: null, patrolling: false, pveTactics: null };
}

function ensureState(brain, actor, modern) {
  let state = brain.pveTactics;
  if (!state || state.generation !== actor.generation
      || state.version !== (modern ? 2 : 1)) {
    state = {
      version: modern ? 2 : 1, generation: actor.generation,
      noticeAt: 0, nextTickAt: 0, end: 0, maneuver: 0,
      target: null, targetGeneration: null, position: null, observedAt: 0, queue: [],
    };
    brain.pveTactics = state;
    brain.path = [];
    brain.repathAt = 0;
  }
  return state;
}

function moveAction(world, actor, goal, now) {
  const step = nextWalkStep(world, actor, goal, now);
  if (!step) return [];
  const from = posOf(actor);
  const speed = Math.max(1, Number(actor.speed));
  const duration = Math.max(1, Math.round(dist(from, step.to) * 1000 / speed));
  return [{ type: 'move', from, to: step.to, direction: step.direction, speed, duration, goal }];
}

/** pve_rules.tick / chapter fallback loop (no pve_tactics). */
export function fallbackTick(actor, brain, world, now) {
  const actions = [];
  if (world.finished || actor.alive === false) return { actions, goal: brain.goal, patrolling: !!brain.patrolling };
  if (now >= (brain.noticeAt || 0)) {
    brain.noticeAt = now + PERCEPTION_MS;
    brain.patrolling = false;
    const pos = posOf(actor);
    let target = null;
    let best = Infinity;
    for (const a of world.actors || []) {
      if (a === actor || a.alive === false || a.mapObject || a.hostage) continue;
      if (!observable(world, actor, a, now, NOTICE_RANGE)) continue;
      const d = dist(pos, posOf(a));
      if (d < best || (d === best && a.id < (target ? target.id : Infinity))) { best = d; target = a; }
    }
    if (target) {
      const dest = posOf(target);
      const inRange = dist(pos, dest) <= Number(actor.fireRange);
      brain.goal = inRange ? pos : dest;
      if (inRange) {
        actions.push({ type: 'stop' });
        const cast = castAction(actor, target, world, now, brain.pveTactics || {});
        if (cast) actions.push(cast);
      }
    } else {
      brain.goal = patrolGoal(world, actor, now);
      brain.patrolling = true;
    }
  }
  if (brain.patrolling) brain.goal = patrolGoal(world, actor, now);
  actions.push(...moveAction(world, actor, brain.goal, now));
  return { actions, goal: brain.goal, patrolling: !!brain.patrolling };
}

/**
 * One NPC tick. Faithful to pve_tactics.tick v1 (map 201) with the modern v2
 * extended-eligibility branch available for chapters 2-9.
 */
export function tickNpc(actor, brainIn, world, now, { modern = false } = {}) {
  const brain = brainIn || createBrain();
  brain.path = brain.path || [];
  brain.noticeAt = Number(brain.noticeAt || 0);
  if (world.finished || actor.alive === false) {
    return { actions: [], state: brain.pveTactics || null, goal: brain.goal, patrolling: !!brain.patrolling };
  }
  const state = ensureState(brain, actor, modern);
  const actions = dueBursts(world, actor, state, now);

  if (world.tactics === false || !tacticsEligible(actor, { modern, playerCamp: world.playerCamp ?? 1 })) {
    const fallback = fallbackTick(actor, brain, world, now);
    fallback.actions.unshift(...actions);
    return fallback;
  }

  if (now >= state.noticeAt) {
    state.noticeAt = now + PERCEPTION_MS;
    brain.noticeAt = state.noticeAt;
    const target = chooseTarget(world, actor, state, now, { modern });
    if (target) {
      const changed = state.target !== target.id || state.targetGeneration !== target.generation;
      const point = posOf(target);
      state.target = target.id;
      state.targetGeneration = target.generation;
      state.position = point;
      state.observedAt = now;
      state.end = now + MEMORY_MS;
      const boundary = !moving(actor, now);
      if (boundary && (changed || now >= state.nextTickAt)) {
        state.maneuver += 1;
        const strafe = Number(actor.cooldowns && actor.cooldowns[0] || 0) > now + PERCEPTION_MS
          && state.maneuver % 3 !== 0;
        const goal = actor.stationary ? posOf(actor)
          : actor.flying ? chooseAirGoal(world, actor, point, now, { strafe })
            : chooseGoal(world, actor, point, now, { strafe });
        setGoal(brain, goal);
        state.nextTickAt = now + PLAN_MS;
      }
      const pos = posOf(actor);
      if (dist(pos, point) <= Number(actor.fireRange) && weaponLine(world, actor, pos, point, now)) {
        const cast = castAction(actor, target, world, now, state);
        if (cast) actions.push(cast);
      }
    } else {
      const prior = (world.actors || []).find((t) => t.id === state.target);
      const validMemory = prior && prior.alive !== false
        && prior.generation === state.targetGeneration
        && now < state.end && state.position;
      if (validMemory) {
        if (!moving(actor, now) && now >= state.nextTickAt) {
          // Only the saved observation point, never the hidden target position.
          setGoal(brain, actor.stationary ? posOf(actor) : state.position);
          state.nextTickAt = now + PLAN_MS;
        }
      } else {
        state.target = null;
        state.end = 0;
        state.nextTickAt = now;
        brain.goal = patrolGoal(world, actor, now, { airArrival: modern ? 24 : 12 });
        brain.patrolling = true;
      }
    }
  }

  if (world.finished) return { actions, state, goal: brain.goal, patrolling: !!brain.patrolling };
  if (modern && actor.flying) {
    if (brain.patrolling) brain.goal = patrolGoal(world, actor, now, { airArrival: 24 });
    const target = brain.goal;
    if (target && !moving(actor, now) && !actor.stationary && Number(actor.speed) > 0) {
      const step = nextAirStep(world, actor, target, now);
      if (step) {
        const speed = Number(actor.speed);
        actions.push({ type: 'move', from: posOf(actor), to: step.to, direction: step.direction,
          speed, duration: Math.max(1, Math.round(dist(posOf(actor), step.to) * 1000 / speed)),
          goal: target, flying: true });
      }
    }
  } else {
    if (brain.patrolling) brain.goal = patrolGoal(world, actor, now);
    actions.push(...moveAction(world, actor, brain.goal, now));
  }
  return { actions, state, goal: brain.goal, patrolling: !!brain.patrolling };
}

/** Convenience: tick every hostile NPC with its brain from world.brains. */
export function tickAll(world, now, { modern = false } = {}) {
  world.brains = world.brains || new Map();
  const actions = [];
  for (const actor of world.actors || []) {
    if (actor.alive === false || !actor.pveNpc) continue;
    let brain = world.brains.get(actor.id);
    if (!brain) { brain = createBrain(); world.brains.set(actor.id, brain); }
    const result = tickNpc(actor, brain, world, now, { modern });
    if (result.actions.length) actions.push({ actorId: actor.id, actions: result.actions });
  }
  return actions;
}
