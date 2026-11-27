import {m81338VisualExternal} from './m81338_level_looks.js';

/** Current BattleUI VIBtlMultiKillTipProxy/MultiKillTipCom presentation only.
 * The cue is already selected by nativeKillAnnouncements from server counters.
 * No scoring, streak counting, damage or voice selection occurs here.
 */
const MULTI_TEXT = Array.from({length: 9}, (_, index) => 'BATTLE_HONOR_TEXT' + String(index + 1).padStart(2, '0'));
const STREAK_TEXT = Array.from({length: 6}, (_, index) => 'BATTLE_HONOR_TEXT' + String(index + 10));
const END_TEXT = Array.from({length: 6}, (_, index) => 'BATTLE_HONOR_TEXT' + String(index + 18));
const kind = object => Number(object?.objectId) >>> 26;

function objectName(object, catalog, map) {
  if (!object || object.removed) return '';
  if (kind(object) === 0) return object.name || '';
  if (kind(object) === 5) return catalog.aiNPCs?.[String(object.templateId)]?.szName || '';
  const template = map?.npcTemplates?.[String(object.templateId)] || catalog.mapNPCs?.[String(object.templateId)];
  return (template?.raw || template)?.szName || '';
}

/** Tank avatars use the packet-time CHAR_BRIEF outlook, not a later transform. */
function objectAvatar(object, catalog, selfCamp) {
  if (!object || object.removed) return null;
  if (kind(object) === 0) {
    const externalId = m81338VisualExternal(object,Number(object.externalId) || Number(catalog.tanks?.[String(object.tankId)]
      ?.baseExternalByLevel?.[String(object.tankLevel)]));
    return externalId > 0 ? {externalId} : null;
  }
  if (kind(object) === 5) {
    const template = catalog.aiNPCs?.[String(object.templateId)];
    if (Number(template?.nType) === 6) {
      const armsId = selfCamp === 1 && Number(template.nOpCampArmsId)
        ? template.nOpCampArmsId : template.nArmsId;
      const externalId = Number(catalog.aiArms?.[String(armsId)]?.exhibitId);
      return externalId > 0 ? {externalId} : null;
    }
  }
  // Robo's central honors use player/tank portraits. Other NPC head bitmaps
  // need their native display selector and verified assets before enabling.
  return null;
}

/** Native showUp: 0.5-second linear fade, fixed y125 (deltaY defaults to0).
 * onMoveUpdate gives labels the parent's alpha as well: effective alpha².
 */
export function nativeHonorPhase(cue, now) {
  if (!cue || !Number.isFinite(cue.dispatchedAt) || !Number.isFinite(cue.expiresAt)
      || now < cue.dispatchedAt || now >= cue.expiresAt) return null;
  const alpha = Math.min(1, Math.max(0, (now - cue.dispatchedAt) / 500));
  return {alpha, labelAlpha: alpha, top: 125};
}

/** MultiKillTipCom.centerContent casts the1.1× combined text width to uint. */
export function nativeHonorLayout(nameWidth, tipWidth) {
  const a = Math.max(0, Number(nameWidth) || 0), b = Math.max(0, Number(tipWidth) || 0);
  const contentWidth = Math.floor((a + b) * 1.1);
  return {width: 180 + contentWidth, height: 85, nameX: 90, tipX: 90 + a * 1.1};
}

export function roboKillBannerPresentation(cue, catalog, bannerCatalog, map = null) {
  const source = cue?.source, snapshot = source?.announcerState;
  if (!snapshot || !bannerCatalog?.text) return null;
  const packet = source.packet || {}, selfCamp = Number(snapshot.selfCamp);
  const killer = snapshot.killer, victim = snapshot.victim, object = snapshot.object;
  let textKey = null, withVictim = false, name = '', isMate = Number(killer?.camp) === selfCamp;
  switch (cue.reason) {
    case 'first-blood': textKey = 'FIRST_BLOOD'; break;
    case 'multi-kill': textKey = MULTI_TEXT[Math.min(Math.max(0, Number(packet.multiCount) - 2), MULTI_TEXT.length - 1)]; break;
    case 'kill-no-dead': textKey = STREAK_TEXT[Math.min(Math.max(0, Number(packet.killerStreak) - 3), STREAK_TEXT.length - 1)]; break;
    case 'who-be-end':
      textKey = END_TEXT[Math.min(Math.max(0, Number(packet.victimStreak) - 3), END_TEXT.length - 1)];
      withVictim = true; break;
    case 'normal-kill-with-name': textKey = 'BATTLE_HONOR_TEXT32'; withVictim = true;
      name = objectName(killer, catalog, map); break;
    case 'normal-kill': textKey = 'BATTLE_HONOR_TEXT26'; withVictim = true; break;
    case 'destroy-cannon': textKey = Number(victim?.camp) === selfCamp ? 'BATTLE_HONOR_TEXT29' : 'BATTLE_HONOR_TEXT28'; break;
    case 'dragon-kill': textKey = 'BATTLE_HONOR_TEXT27'; break;
    case 'aced': textKey = 'BATTLE_HONOR_TEXT33'; isMate = Number(object?.camp) === selfCamp; break;
    case 'dragon-birth': textKey = 'BATTLE_HONOR_TEXT31'; isMate = Number(object?.camp) === selfCamp; break;
    case 'super-npc': isMate = Number(object?.camp) === selfCamp;
      textKey = isMate ? 'BATTLE_HONOR_TEXT34' : 'BATTLE_HONOR_TEXT35'; break;
    default: return null;
  }
  const sourceText = bannerCatalog.text[textKey];
  if (typeof sourceText !== 'string') return null;
  // The old VN string calls a deathless streak a "Triple Kill record". The
  // packet carries the defeated player's deathless count, not a new record.
  const tip = cue.reason === 'who-be-end'
    ? `Đã chấm dứt chuỗi ${Number(packet.victimStreak)} hạ gục của ${objectName(victim, catalog, map)}`
    : sourceText.replace('@name@', objectName(victim, catalog, map));
  return {eventKey: cue.eventKey, sourceSequence: cue.sourceSequence, reason: cue.reason,
    textKey, name, tip, isMate, killer: cue.reason === 'aced' ? null
      : objectAvatar(killer || object, catalog, selfCamp),
    victim: withVictim ? objectAvatar(victim, catalog, selfCamp) : null,
    dispatchedAt: cue.dispatchedAt, expiresAt: cue.expiresAt};
}
