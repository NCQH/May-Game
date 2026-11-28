/* Shared helpers for the batch-D ports (no core edits).
 *
 * Core shape notes: arena.actors / arena.objects and active buffs are JS Maps
 * (Python dicts), arena.rng is a function (Python Random.uniform lives in the
 * caller), and EffectTemplate_table.xml is not read by any batch-D kit.
 */

export function samePosition(a, b) {
  return Boolean(a && b && a[0] === b[0] && a[1] === b[1]);
}

/** melee_common.accept_water_reclip. ThuyTinh records the lineage; the JS core
 * has no recorder, so this only accepts a record that already exists. */
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
