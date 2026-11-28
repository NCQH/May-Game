/* Shared melee helpers: port of server/melee_common.py plus the packet/table
 * conveniences the batch-A1 kits use (struct.pack pairs, EffectTemplate rows).
 *
 * No core edits: the effect rows ship inside batch-a1-data.json; when a caller
 * supplies EffectTemplate_table.xml the live table wins and this fallback is
 * never read. Values below are copied from the original SQLite export.
 */
import { TableRow } from '../data.js';
import { scene, stop_move } from '../protocol.js';
import { actorContact, pointAt, pyRound } from '../math.js';

/** Python struct.pack('<II', a, b). */
export function packII(a, b) {
  const out = new Uint8Array(8);
  const view = new DataView(out.buffer);
  view.setUint32(0, a, true);
  view.setUint32(4, b, true);
  return out;
}

/** Python struct.pack('<Ihh', a, b, c). */
export function packIhh(a, b, c) {
  const out = new Uint8Array(8);
  const view = new DataView(out.buffer);
  view.setUint32(0, a, true);
  view.setInt16(4, b, true);
  view.setInt16(6, c, true);
  return out;
}

const EFFECT_FALLBACK = Object.freeze({
  331201: { nId: '331201', fEffectVal: '960' },
  331203: { nId: '331203', fAddVal: '2.0' },
  331221: { nId: '331221', fAddVal: '1.5', iRange1: '240' },
  331301: { nId: '331301', fEffectVal: '0.3' },
  331302: { nId: '331302', fAddVal: '3.6' },
  331303: { nId: '331303', fEffectVal: '480', nEffectValB: '72' },
  302600: { nId: '302600', fAddVal: '1.5' },
  302611: { nId: '302611', fAddVal: '1.5' },
  302701: { nId: '302701', fAddVal: '0.90' },
  302801: { nId: '302801', fAddVal: '4.45', iRange1: '528', iRange2: '72' },
  302902: { nId: '302902', fEffectVal: '960', nEffectValB: '300' },
  302911: { nId: '302911', fAddVal: '1.22' },
});

export function effectRow(actor, id) {
  const data = actor.arena.data;
  if (data.hasTable('EffectTemplate_table.xml')) {
    return data.tableRow('EffectTemplate_table.xml', { nId: id });
  }
  const row = EFFECT_FALLBACK[id];
  if (!row) throw new Error(`Missing EffectTemplate row ${id}`);
  return new TableRow({ ...row });
}

export function effectRows(actor, ids) {
  const out = {};
  for (const id of ids) out[id] = effectRow(actor, id);
  return out;
}

/** melee_common.prepare_displacement. Returns [position, packets]. */
export function prepareDisplacement(target, now, { interrupt = true, cancelMotion = false } = {}) {
  const packets = [];
  const motion = target.motion;
  const forcedUntil = target.forcedUntil;
  if (cancelMotion && motion) {
    let position = target.positionAt(now);
    if ((target.motionKind || forcedUntil > now) && motion[3] > now) position = target.stopPosition(now);
    target.position = position;
    target.motion = null;
    packets.push(stop_move(target.sceneId, target.id, position));
    if (forcedUntil > now && forcedUntil === motion[3]) target.forcedUntil = now;
  } else if (motion && (target.motionKind || forcedUntil > now) && motion[3] > now) {
    const current = target.positionAt(now);
    const stopped = target.stopPosition(now);
    if (stopped[0] !== current[0] || stopped[1] !== current[1]) {
      target.position = stopped;
      target.motion = null;
      packets.push(stop_move(target.sceneId, target.id, stopped));
    }
  }
  if (interrupt) packets.push(...target.interrupt(now));
  return [target.positionAt(now), packets];
}

/** melee_common.aimed. */
export function aimed(start, dest, distance, { fixed = false } = {}) {
  const length = Math.hypot(dest[0] - start[0], dest[1] - start[1]);
  if (!length) return start;
  return pointAt(start, dest, fixed ? distance / length : Math.min(1, distance / length)).map(pyRound);
}

export function enemies(actor, { area = false } = {}) {
  return [...actor.arena.actors.values()].filter(a => a.alive && a.camp !== actor.camp
    && (area ? a.isAreaTargetable() : !a.isUntargetable()));
}

export function inCone(pos, start, dest, radius, degrees) {
  if (Math.hypot(start[0] - pos[0], start[1] - pos[1]) > radius) return false;
  const angle = Math.atan2(pos[1] - start[1], pos[0] - start[0])
    - Math.atan2(dest[1] - start[1], dest[0] - start[0]);
  return Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle))) <= (degrees / 2) * Math.PI / 180;
}

export function inStrip(pos, start, dest, length, width) {
  const dx = dest[0] - start[0], dy = dest[1] - start[1];
  const span = Math.hypot(dx, dy);
  if (!span) return false;
  const x = pos[0] - start[0], y = pos[1] - start[1];
  return 0 <= (x * dx + y * dy) / span && (x * dx + y * dy) / span <= length
    && Math.abs(x * dy - y * dx) / span <= width / 2;
}

/** melee_common.piercing_step. */
export function piercingStep(actor, flight, now, onHit, { pierce = true, contactRadius = 36 } = {}) {
  const start = pointAt(flight.start, flight.end,
    (flight.previous - flight.begin) / (flight.finish - flight.begin));
  const end = pointAt(flight.start, flight.end,
    Math.min(1, (now - flight.begin) / (flight.finish - flight.begin)));
  const wall = flight.through_walls ? null : actor.arena.geometry.wallContact(start, end);
  const contacts = [];
  for (const target of enemies(actor)) {
    const key = `${target.id},${target.generation}`;
    if (flight.hits.has(key)) continue;
    const hit = actorContact(start, end, target, flight.previous, now, contactRadius);
    if (hit !== null && (wall === null || hit < wall)) contacts.push([hit, target.id, target, key]);
  }
  contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const packets = [];
  for (const [, , target, key] of contacts) {
    if (actor.projectileBlocked(target, now)) {
      return packets.concat([scene({ expiredBullets: [flight.id] })]);
    }
    flight.hits.add(key);
    packets.push(...onHit(flight, target, now));
    if (!pierce) return packets.concat([scene({ blownBullets: [flight.id] })]);
  }
  if (wall !== null || now >= flight.finish) {
    return packets.concat([scene(wall !== null
      ? { blownBullets: [flight.id] } : { expiredBullets: [flight.id] })]);
  }
  flight.previous = now;
  actor._queue(Math.min(now + 20, flight.finish), 'flight', flight);
  return packets;
}

/** MedusaActions._drain_mp, used by Naruto's approved basic-hit rider. */
export function drainMp(target, amount, now) {
  if (typeof target._resource !== 'function') return [];
  return target.info.tank_id === 10000033
    ? target._resource(-amount, now) : target._resource(-amount);
}
