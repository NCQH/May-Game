import {m81338VisualExternal} from './m81338_level_looks.js';

/** CTank.changeTankOutlook presentation only. Native packets own buff changes.
 * A type-55 add replaces the complete component set; removing any type-55
 * restores the character's base external ID, without restoring a prior buff.
 */
export function aiNpcTemplate(catalog, actor) {
  // ObjectManager dispatches native type 5 to AINpcModel. Template numbers
  // are not globally unique: Sima's type-4 SceneItem also uses 373201.
  return actor && (actor.objectId >>> 26) === 5
    ? catalog.aiNPCs?.[String(actor.templateId)] || null : null;
}

export function aiNpcArms(catalog, actor, state = null) {
  const ai = aiNpcTemplate(catalog, actor);
  if (!ai) return null;
  const self = state?.actors?.[String(state.selfObjectId)];
  // BattleTool.getAiNpcDisplayArmId intentionally tests the viewer's camp,
  // not the summoned object's camp. Preserve that current Flash behavior.
  const armsId = self?.camp === 1 && Number(ai.nOpCampArmsId)
    ? ai.nOpCampArmsId : ai.nArmsId;
  return catalog.aiArms?.[String(armsId)] || null;
}

export function mapNpcDisplayTemplate(catalog, map, object, state = null) {
  if (!object || (object.objectId >>> 26) !== 3) return null;
  const lookup = id => map?.npcTemplates?.[String(id)] || catalog?.mapNPCs?.[String(id)] || null;
  const original = lookup(object.templateId);
  const row = original?.raw || original;
  const self = state?.actors?.[String(state.selfObjectId)];
  // BattleTool.getNpcDisplayId uses the viewer's camp, even for neutral
  // objects. This chooses artwork only; native template/camp/geometry stay
  // unchanged. Both members of each map's nOpCampId pair are in its manifest.
  return self?.camp === 1 && Number(row?.nOpCampId)
    ? lookup(row.nOpCampId) : original;
}

export function nativeNpcImageField(hp, maxHp) {
  // NpcObject.setHp first assigns hp/maxHp*100 to an AS3 int.
  const percent = maxHp > 0 ? Math.trunc(hp / maxHp * 100) : 100;
  return percent <= 25 ? 'szBrokenImage3' : percent <= 50 ? 'szBrokenImage2'
    : percent <= 75 ? 'szBrokenImage1' : 'szImageFile';
}

export function actorAppearance(catalog, actor, state = null) {
  if (!actor) return {baseExternalId: null, visualBaseExternalId: null, externalId: null, transition: null, appearance: null};
  const ai = aiNpcTemplate(catalog, actor), shadow = Number(ai?.nType) === 4;
  const owner=shadow?state?.actors?.[String(actor.ownerId)]:null;
  const baseExternalId = shadow
    ? actor.ownerExternalIdAtSnapshot ?? owner?.externalId
    : actor.externalId ?? aiNpcArms(catalog, actor, state)?.exhibitId;
  const visualBaseExternalId=ai&&!shadow?baseExternalId:m81338VisualExternal(shadow
    ?{tankId:actor.ownerTankIdAtSnapshot??owner?.tankId,tankLevel:actor.ownerTankLevelAtSnapshot??owner?.tankLevel}
    :{tankId:actor.tankId,tankLevel:actor.tankLevel},baseExternalId);
  let transition = null;
  for (const change of Object.values(actor.buffPresentation?.changes || {})) {
    const buff = catalog.buffs?.[String(change.templateId)];
    if (Number(buff?.nEffectType) !== 55) continue;
    if (!transition || change.sequence > transition.sequence) transition = change;
  }
  const externalId = transition?.operation === 'add'
    ? Number(catalog.buffs[String(transition.templateId)].fEffectValA) : visualBaseExternalId;
  return {baseExternalId, visualBaseExternalId, externalId, transition, shadow,
    appearance: catalog.appearances?.[String(externalId)] || null};
}

export function actorLifeBarVisible(catalog, actor) {
  const ai = aiNpcTemplate(catalog, actor);
  // TankShadow extends CTank and inherits its life bar. AINpcObject instead
  // uses AINpcTemplate.iLifeShowType (0 always, 1 hidden, 2 hidden when full).
  if (!ai || Number(ai.nType) === 4) return true;
  const type = Number(ai.iLifeShowType ?? 0);
  return type === 0 || (type === 2 && actor.hp < actor.maxHp);
}
