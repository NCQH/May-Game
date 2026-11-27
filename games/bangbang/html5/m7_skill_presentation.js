// Presentation-only transforms from the current Flash CTank/ObjThrowProxy.
// No movement target, damage, buff lifetime or cannon angle is changed here.
export const NATIVE_BUFF_SHOW = Object.freeze({SHRINK: 4, ENLARGE: 6});

function latestSizeTransition(actor, buffCatalog) {
  let latest = null;
  for (const change of Object.values(actor?.buffPresentation?.changes || {})) {
    const show = Number(buffCatalog?.[String(change.templateId)]?.nBuffShowType);
    if (![NATIVE_BUFF_SHOW.SHRINK, NATIVE_BUFF_SHOW.ENLARGE].includes(show)) continue;
    if (!['add', 'remove'].includes(change.operation) || !Number.isFinite(change.sequence)) continue;
    if (!latest || change.sequence > latest.sequence) latest = {...change, show};
  }
  return latest;
}

/** CTank applies size to its body/engine container and cannon, not its buffs,
 * name/HP or hitbox. Removing either size buff explicitly restores 1, even if
 * another size buff remains; use the received transition order, not a reduction
 * of active buffs. The wire owns removal; a countdown reaching zero does not.
 */
export function nativeComponentScale(actor, buffCatalog) {
  const transition = latestSizeTransition(actor, buffCatalog);
  const scale = transition?.operation === 'add'
    ? transition.show === NATIVE_BUFF_SHOW.SHRINK ? 0.7 : 1.3 : 1;
  return {scale, transition};
}

/** Both TT_NORMAL and TT_JUMP use ObjThrowProxy. TT_JUMP's body facing is a
 * separate CTank operation. A type-4 SceneMove without S1578's throwType does
 * not create this visual proxy. Its linear ground movement stays in combat_state.
 */
export function nativeThrowPresentation(motion, now) {
  if (Number(motion?.moveType) !== 4 || motion?.throwType == null
      || !Number.isFinite(now) || !Number.isFinite(motion.startedAt)
      || !(motion.durationMs > 0) || !Number.isFinite(motion.durationMs)
      || now < motion.startedAt || now >= motion.startedAt + motion.durationMs) return null;
  const from = motion.from, to = motion.to;
  if (![from?.x, from?.y, to?.x, to?.y].every(Number.isFinite)) return null;
  // ObjThrowProxy assigns CMath.getDistance to an int before the scale formula.
  const distance = Math.trunc(Math.hypot(to.x - from.x, to.y - from.y));
  const maxScale = distance > 480 ? 0.6 : 0.2 * (1 - distance / 480) + 0.6;
  const fraction = (now - motion.startedAt) / motion.durationMs;
  return {scale: 1 + maxScale * Math.sin(fraction * Math.PI), fraction,
    maxScale, distance, startedAt: motion.startedAt,
    endsAt: motion.startedAt + motion.durationMs, throwType: Number(motion.throwType)};
}

/** objectScale belongs to the complete CTank subtree (parts, attached buffs,
 * name, HP), around the actor's current origin. componentScale is nested only
 * around body/engine/cannon. World effects and minimap keep their own transforms.
 */
export function nativeSkillPresentation(actor, buffCatalog, now,
    {ctank = (Number(actor?.objectId) >>> 26) === 0} = {}) {
  if (!actor || actor.dead || actor.removed) return {componentScale: 1, objectScale: 1,
    sizeTransition: null, throw: null};
  // TankShadow inherits CTank and must pass ctank:true. Ordinary AINpcObject
  // explicitly ignores ENLARGE and has no SHRINK handler; it still uses throws.
  const component = ctank ? nativeComponentScale(actor, buffCatalog) : {scale: 1, transition: null};
  const thrown = nativeThrowPresentation(actor.motion, now);
  return {componentScale: component.scale, objectScale: thrown?.scale ?? 1,
    sizeTransition: component.transition, throw: thrown};
}
