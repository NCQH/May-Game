/* Shared helpers for the batch-E ports (no core edits).
 *
 * `acceptWaterReclip` mirrors melee_common.accept_water_reclip for the two
 * kits that accept a recorded water-wall continuation. `maxHpPacket` is the
 * missing base `_max_hp_packet`. Python random.choice takes a function RNG on
 * the JS core, so `choose` wraps arena.rng().
 */
import { encodeS1560 } from '../protocol.js';

export function acceptWaterReclip(target, cast) {
  const record = target.water_motion_reclip;
  if (!record || record.generation !== target.generation
    || !target.motion || target.motion !== record.motion) return false;
  const origin = record.origin;
  const expected = cast.water_motion_origin?.motion ?? cast.motion;
  if (!origin || expected !== origin.motion) return false;
  cast.water_motion_origin = origin;
  return true;
}

export function maxHpPacket(actor) {
  return [1560, encodeS1560(actor.info.acct_id, 3, actor.maxHp.ceil())];
}

export function choose(rng, items) {
  return items[Math.floor(rng() * items.length)];
}

export function keyOf(value) {
  return Array.isArray(value) ? value.join(',') : String(value);
}
