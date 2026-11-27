import {cooldownView, nativeControlFlags} from './combat_state.js';

export const tankDisplayName = (catalog, actor) => actor?.tankId === 10000056 ? 'Quan Vũ'
  : catalog?.tanks?.[String(actor?.tankId)]?.name || 'Tank';

// battle_entry.self_snapshot uses index2 for total kills (including Robo).
// Result rows use index1 for tank kills. Keep these displays distinct.
export function selfKdaView(state) {
  const stats = state.stats?.[String(state.selfAccountId)]?.stats;
  return stats ? {kills: stats[2], deaths: stats[0], assists: stats[3]}
    : {...(state.selfKda || {kills: 0, deaths: 0, assists: 0})};
}

/** A read-only team projection. Account IDs bind portraits and S1553;
 * object IDs bind HP/MP/shield, buffs and S1572. Never reuse self hotbar data
 * for another member, and never infer life or readiness from a countdown.
 */
export function teamHudRows(state, catalog, now) {
  const self = state?.actors?.[String(state.selfObjectId)];
  if (!self) return [];
  const actors = Object.values(state.actors).filter(actor => actor.camp === self.camp
    && Number.isInteger(actor.accountId) && !actor.removed)
    .sort((a, b) => Number(b.objectId === self.objectId) - Number(a.objectId === self.objectId)
      || a.objectId - b.objectId);
  return actors.map(actor => {
    const respawn = state.respawns[String(actor.accountId)];
    const rawSpace = cooldownView(state, actor.objectId, 2, now);
    const controls = nativeControlFlags(actor, catalog?.buffs || {}, now, catalog?.skills || {});
    const buffs = Object.values(actor.buffs || {}).map(buff => {
      const template = catalog?.buffs?.[String(buff.templateId)];
      if (!template?.hudVisible) return null;
      return {instanceId: buff.instanceId, templateId: buff.templateId,
        name: template.szName || 'Hiệu ứng', description: template.szDesc || template.szDesc2 || '',
        icon: template.resources?.szBuffIcon || null, stackCount: buff.stackCount ?? null,
        hideExistTime: !!template.hudHideExistTime, showStackCount: !!template.hudStackCountVisible,
        remainingMs: buff.expiresAt == null ? null : Math.max(0, buff.expiresAt - now)};
    }).filter(Boolean);
    return {accountId: actor.accountId, objectId: actor.objectId, tankId: actor.tankId,
      externalId: actor.externalId, camp: actor.camp, self: actor.objectId === self.objectId,
      name: tankDisplayName(catalog, actor), icon: catalog?.tanks?.[String(actor.tankId)]?.hudIcon || null,
      hp: actor.hp, maxHp: actor.maxHp, mp: actor.mp, maxMp: actor.maxMp,
      shield: actor.shield ?? 0, dead: actor.dead || actor.hp <= 0, lifeEpoch: actor.lifeEpoch,
      respawnRemainingMs: actor.dead && respawn?.expiresAt != null
        ? Math.max(0, respawn.expiresAt - now) : null,
      space: rawSpace ? {...rawSpace, ownerId: actor.objectId} : null,
      controls, buffs};
  });
}
