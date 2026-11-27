/** Current BattleUI VIBtlMultiKillTipProxy, zh_CN DiffConfig profile.
 * Only selects presentation cues from native KillInfo/model events; it never
 * counts kills locally or changes scores, life, respawn, AI or match rules.
 */
const MULTI = ['MP3_DOUBLE_KILL', 'MP3_TRIPLE_KILL', 'MP3_ULTRA_KILL',
  'MP3_MEGA_KILL', 'MP3_MONSTER_KILL'];
const STREAK = ['MP3_KILLING_SPREE', 'MP3_RAMPAGE', 'MP3_UNSTOPABLE',
  'MP3_DOMINATING', 'MP3_GOD_LIKE', 'MP3_LEGENDARY'];

export function nativeKillAnnouncements(event, catalog, map) {
  const packet = event.packet;
  if (packet.firstBlood) return [{reason: 'first-blood', key: 'MP3_FIRST_BLOOD'}];
  const killerKind = packet.killerId >>> 26, victimKind = packet.victimId >>> 26;
  const lookupNpc = object => {
    if (!object || object.removed) return null;
    const value = map?.npcTemplates?.[String(object.templateId)] || catalog.mapNPCs?.[String(object.templateId)];
    return value?.raw || value;
  };
  const baseMode = (map?.staticNPCs || []).some(row => {
    const value = map.npcTemplates?.[String(row.template)];
    return Number((value?.raw || value)?.iType) === 3; // NpcType.BASE
  });
  const output = [];
  const tankKillTank = () => {
    // Silent tips still occupy their original queue interval. Current native
    // DiffConfig.useDetailedKillSound=false; no invented local voice mapping.
    if (baseMode) output.push({reason: 'normal-kill-with-name', key: null});
    if (packet.multiCount >= 2) output.push({reason: 'multi-kill', key: MULTI[Math.min(packet.multiCount - 2, MULTI.length - 1)]});
    if (packet.killerStreak >= 3) output.push({reason: 'kill-no-dead', key: STREAK[Math.min(packet.killerStreak - 3, STREAK.length - 1)]});
    if (packet.victimStreak >= 3) output.push({reason: 'who-be-end', key: null});
  };
  const cannonDeath = () => {
    if (Number(lookupNpc(event.victimState)?.iType) === 4) output.push({reason: 'destroy-cannon', key: null});
  };
  if (killerKind === 0) {
    if (victimKind === 0) tankKillTank();
    else if (victimKind === 3) cannonDeath();
    else if (victimKind === 5 && event.victimState && !event.victimState.removed) {
      const ai = catalog.aiNPCs?.[String(event.victimState.templateId)];
      if (Number(ai?.nType) === 6) tankKillTank(); // AI_NPC_TYPE.AINPC_TANK
      if (baseMode && [2, 3].includes(Number(ai?.nAIType))) output.push({reason: 'dragon-kill', key: null});
    }
  } else if (baseMode && killerKind === 3 && victimKind === 0) {
    if (Number(lookupNpc(event.killerState)?.iType) === 4) output.push({reason: 'normal-kill', key: null});
  } else if (baseMode && killerKind === 5) {
    if (victimKind === 0) output.push({reason: 'normal-kill', key: null});
    else if (victimKind === 3) cannonDeath();
  }
  return output;
}

/** MultiKillTipCom.showUp starts a 2-second hide tween; onShowEnd→nextTip.
 * Even a silent native tip holds that interval. Each queued cue retains the
 * originating packet's identity, independent of a later actor snapshot.
 */
export class NativeAnnouncerQueue {
  constructor(onSound = () => {}) { this.onSound = onSound; this.reset(); }
  reset() { this.pending = []; this.readyAt = -Infinity; this.history = []; this.born = new Set(); this.active = null; }
  add(cues, event, resources) {
    // MultiKillTipCom captures names/avatar/camp when its native event arrives.
    // Keep the immutable packet-time context through delayed and silent slots.
    const source = JSON.parse(JSON.stringify({packet: event.packet || null,
      announcerState: event.announcerState || null}));
    for (const [index, cue] of cues.entries()) this.pending.push({...cue,
      source,
      resource: resources?.[cue.key] || null, eventKey: `${event.id}:announcer:${index}`,
      queuedAt: event.receivedAt, casterId: event.packet?.killerId ?? null,
      objectId: event.packet?.victimId ?? event.objectId ?? null, sourceSequence: event.sourceSequence});
  }
  npcAdd(ai, event, resources) {
    const type = Number(ai?.nAIType);
    if ([2, 3].includes(type) && !this.born.has(type)) {
      this.born.add(type);
      this.add([{reason: 'dragon-birth', key: type === 2 ? 'MP3_BORN_DALONG' : 'MP3_BORN_XIAOLONG'}], event, resources);
    } else if (type === 7) this.add([{reason: 'super-npc', key: null}], event, resources);
  }
  tick(now) {
    if (this.active && now >= this.active.expiresAt) this.active = null;
    if (!this.pending.length || now < this.readyAt) return;
    const cue = this.pending.shift(); this.readyAt = now + 2000;
    // One dispatch owns both picture and audio; silent native tips also show.
    this.active = {...cue, dispatchedAt: now, expiresAt: this.readyAt};
    this.history.push({reason: cue.reason, key: cue.key, logical: cue.resource?.logical ?? null,
      eventKey: cue.eventKey, queuedAt: cue.queuedAt, dispatchedAt: now,
      sourceSequence: cue.sourceSequence, objectId: cue.objectId, casterId: cue.casterId});
    if (this.history.length > 200) this.history.shift();
    if (cue.resource) this.onSound(cue.resource, null, {eventKey: cue.eventKey,
      kind: 'announcer', sourceSequence: cue.sourceSequence, objectId: cue.objectId, casterId: cue.casterId});
  }
  snapshot() { return {pending: this.pending.length, readyAt: Number.isFinite(this.readyAt) ? this.readyAt : null,
    active: this.active ? {reason: this.active.reason, eventKey: this.active.eventKey,
      sourceSequence: this.active.sourceSequence, dispatchedAt: this.active.dispatchedAt,
      expiresAt: this.active.expiresAt} : null,
    history: this.history.map(row => ({...row}))}; }
}
