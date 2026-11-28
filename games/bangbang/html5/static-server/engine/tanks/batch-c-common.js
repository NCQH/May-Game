/* Shared helpers for the batch-C ports (no core edits).
 *
 * The JS arena has no fog/observer model, so `teamVisible` keeps the native
 * wall line-of-sight and 960px radius but skips server-side fog bookkeeping.
 * Python writes raw ObjInfo bodies; `objectPacket` goes through objectInfo.
 */
import { D, pyRound } from '../math.js';
import { encodeS1556, objectInfo } from '../protocol.js';

/** bot_ai.team_visible approximation: alive, in range, no wall between. */
export function teamVisible(actor, target, now, radius = 960) {
  if (!target || !target.alive || target.isUntargetable()) return false;
  const start = actor.positionAt(now), end = target.positionAt(now);
  if (Math.hypot(end[0] - start[0], end[1] - start[1]) > radius) return false;
  const rect = target.map_rect || target.mapRect;
  return actor.arena.geometry.wallContact(start, end, 0, { exclude: rect ? [rect] : [] }) === null;
}

/** Add an arena object (same shape as TankActions.addObject) with options. */
export function objectPacket(actor, template, position, {
  ident = null, hp = 0, maxHp = null, camp = null, ownerId = null, buffs = [],
} = {}) {
  const id = ident === null ? actor._newId(5) : ident;
  const info = {
    objectId: id, templateId: template, x: position[0], y: position[1], hp,
    camp: camp === null ? actor.camp : camp, maxHp: maxHp === null ? hp : maxHp,
    ownerId: ownerId === null ? actor.id : ownerId, shield: 0, buffs,
  };
  actor.arena.objects.set(id, objectInfo(info));
  return [id, [1556, encodeS1556(actor.sceneId, info)]];
}

/** D(base) ** exponent for nonnegative integer exponents. */
export function powD(base, exponent) {
  let out = D(1);
  for (let i = 0; i < exponent; i += 1) out = out.mul(base);
  return out;
}

/** Stable key for tuple/array switch-flight identity sets. */
export function flightKey(key) { return Array.isArray(key) ? key.join(',') : String(key); }

/** Python struct.pack('<IhhhhIB', ...) for S1578 (pull/throw). */
export function encodeS1578(objectId, start, dest, duration, throwType = 0) {
  const out = new Uint8Array(17), view = new DataView(out.buffer);
  view.setUint32(0, objectId, true);
  view.setInt16(4, pyRound(start[0]), true);
  view.setInt16(6, pyRound(start[1]), true);
  view.setInt16(8, pyRound(dest[0]), true);
  view.setInt16(10, pyRound(dest[1]), true);
  view.setUint32(12, duration, true);
  view.setUint8(16, throwType);
  return out;
}

/** HuluTurret/JokerClone tombstone cleanup; no core edit. */
export function retireSummon(actor, now, generation) {
  const refers = (value, seen) => {
    if (typeof value === 'number') return value === actor.id;
    if (!value || typeof value !== 'object' || seen.has(value)) return false;
    seen.add(value);
    const items = value instanceof Map ? [...value.values()]
      : value instanceof Set ? [...value.values()] : Object.values(value);
    return items.some(item => refers(item, seen));
  };
  const busy = actor.arena.pending.some(entry => {
    // A summon's own respawn retry is not an external reference.
    if (entry.args?.[0] === 'respawn') return false;
    return entry.callback?.__owner?.id === actor.id || refers(entry.args, new Set());
  });
  if (busy) actor._queue(now + 1000, 'respawn', generation);
  else actor.arena.actors.delete(actor.id);
  return [];
}
