/* Outside-battle presentation from the current native room protocol.
 * No transport, timers, asset loading, combat decisions or database writes.
 * Existing M3/M4 own the authoritative transition and C605=100 -> C552 gate.
 */

const uint = value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const finite = value => typeof value === 'number' && Number.isFinite(value);

export function createFlowPresentation(generation = 0) {
  return {generation, revision: 0, roomId: null, mapId: null, roomType: null,
    creatorAccountId: null, roster: [], observers: [], selection: null, scene: null,
    selectedByAccount: {}, lockedAccountIds: [], nativeLoads: {},
    localLoadAttempt: 0, localLoad: null, exitAcknowledged: null, lastRoomOperation: null};
}

/** Safe display metadata; deliberately excludes UUID, IP and native session data. */
export function flowBrief(value) {
  const p = value?.player || {}, o = value?.other || {};
  return {accountId: p.accountId, name: p.name, level: p.level, sex: p.sex,
    vipLevel: p.vipLevel, avatarId: p.avatarId, decorateId: p.decorateId,
    militaryStar: p.militaryStar, teamName: p.teamName, teamPlace: p.teamPlace,
    eloSection: p.eloSection, preEloSection: p.preEloSection, elo: p.elo,
    tankId: o.tankId, tankLevel: o.tankLevel, externalId: o.externalId,
    haloId: o.haloId, skinFrameType: o.skinFrameType, commandSkill: o.commandSkill,
    honorId: o.honorId, tryTank: o.tryTank, btItemId: o.btItemId,
    camp: value.camp, ready: value.ready ?? 0, battle: value.battle ?? 0};
}

function selectedRoster(roster) {
  return Object.fromEntries(roster.map(c => [c.accountId, {accountId: c.accountId,
    tankId: c.tankId, externalId: c.externalId, skinFrameType: c.skinFrameType,
    commandSkill: c.commandSkill}]));
}

function clearRoom(state, lastRoomOperation = null) {
  return {...createFlowPresentation(state.generation), revision: state.revision + 1,
    localLoadAttempt: state.localLoadAttempt, lastRoomOperation};
}

/**
 * context.generation must identify the current connection. context.accountId is
 * the bound native character. For S1721 pass an explicitly derived deadlineAt
 * in the caller's display-clock domain (the packet itself contains seconds).
 * A missing deadline produces no invented countdown. sceneAccepted=false lets
 * the caller reject an unaccepted S1705 before applying any presentation.
 */
export function reduceFlowPacket(state, packet, context = {}) {
  if (!state || context.generation !== state.generation || !packet) return state;
  const mine = context.accountId;
  switch (packet.type) {
    case 'roomEntered': {
      const roster = packet.characters.map(flowBrief);
      if (mine != null && !roster.some(c => c.accountId === mine)) return state;
      return {...clearRoom(state), roomId: packet.roomId, mapId: packet.config.mapId,
        roomType: packet.roomType, creatorAccountId: packet.creatorAccountId,
        roster, observers: packet.observers.map(flowBrief), selectedByAccount: selectedRoster(roster)};
    }
    case 'roomOp': {
      const operation = {op: packet.op, startAccountId: packet.startAccountId, target: packet.target};
      if ([1, 20].includes(packet.op) && packet.target === mine) return clearRoom(state, operation);
      if (state.roomId == null || state.scene || state.selection) return state;
      if ([1, 20].includes(packet.op)) {
        const roster = state.roster.filter(c => c.accountId !== packet.target);
        return {...state, roster, observers: state.observers.filter(c => c.accountId !== packet.target),
          selectedByAccount: selectedRoster(roster), lastRoomOperation: operation};
      }
      if (![2, 3, 4].includes(packet.op)) return state;
      const who = packet.op === 4 ? packet.startAccountId : packet.target;
      if (!state.roster.some(c => c.accountId === who)) return state;
      const roster = state.roster.map(c => c.accountId !== who ? c : packet.op === 4
        ? (c.camp === 1 || c.camp === 2 ? {...c, camp: 3 - c.camp} : c)
        : {...c, ready: packet.op === 2 ? 1 : 0});
      return {...state, roster, lastRoomOperation: operation};
    }
    case 'roomMap':
      return state.roomId == null || state.scene || state.selection ? state : {...state, mapId: packet.mapId};
    case 'prebattle': {
      if (state.scene) return state;
      const roster = packet.characters.map(flowBrief);
      if (mine != null && !roster.some(c => c.accountId === mine)) return state;
      const known = new Set(roster.map(c => c.accountId));
      return {...state, revision: state.revision + 1, roomId: packet.sceneId,
        mapId: packet.mapId, roomType: packet.roomType, roster,
        selectedByAccount: selectedRoster(roster),
        lockedAccountIds: [...new Set(packet.lockedAccountIds.filter(id => known.has(id)))],
        selection: {sceneId: packet.sceneId, remainingSeconds: packet.remainingSeconds,
          deadlineAt: finite(context.deadlineAt) ? context.deadlineAt : null},
        scene: null, nativeLoads: {}, localLoad: null, exitAcknowledged: null};
    }
    case 'roomCharChanged': {
      if (state.roomId == null || state.scene) return state;
      const who = packet.player.accountId;
      if (!state.roster.some(c => c.accountId === who)) return state;
      const roster = state.roster.map(c => c.accountId !== who ? c
        : flowBrief({...packet, camp: c.camp, ready: c.ready, battle: c.battle}));
      return {...state, roster, selectedByAccount: {...state.selectedByAccount,
        [who]: selectedRoster(roster)[who]}};
    }
    case 'tankSelected': {
      if (!state.selection || !state.roster.some(c => c.accountId === packet.accountId)) return state;
      const selected = {accountId: packet.accountId, tankId: packet.tankId,
        containerType: packet.containerType, externalId: packet.externalId,
        skinFrameType: packet.skinFrameType, commandSkill: packet.commandSkill};
      return {...state, selectedByAccount: {...state.selectedByAccount, [packet.accountId]: selected},
        roster: state.roster.map(c => c.accountId === packet.accountId
          ? {...c, tankId: packet.tankId, externalId: packet.externalId,
            skinFrameType: packet.skinFrameType, commandSkill: packet.commandSkill} : c)};
    }
    case 'tankLocked':
      if (!state.selection || !state.roster.some(c => c.accountId === packet.accountId)
          || state.lockedAccountIds.includes(packet.accountId)) return state;
      return {...state, lockedAccountIds: [...state.lockedAccountIds, packet.accountId]};
    case 'battleStart': {
      if (context.sceneAccepted === false) return state;
      if (state.scene?.sceneId === packet.sceneId && state.scene.mapId === packet.mapId) return state;
      const roster = packet.characters.map(flowBrief);
      if (mine != null && !roster.some(c => c.accountId === mine)) return state;
      const revision = state.revision + 1;
      return {...state, revision, roomId: packet.sceneId, mapId: packet.mapId,
        roomType: packet.roomType, roster, selectedByAccount: selectedRoster(roster),
        selection: null, scene: {sceneId: packet.sceneId, mapId: packet.mapId,
          enterType: packet.enterType, revision}, nativeLoads: {}, localLoad: null,
        exitAcknowledged: null};
    }
    case 'roomLoaded': {
      // S1709 has no scene ID: bind it only to the accepted S1705 lifecycle.
      if (!state.scene || state.exitAcknowledged || !uint(packet.loaded) || packet.loaded > 100
          || !uint(packet.delay) || !state.roster.some(c => c.accountId === packet.accountId)) return state;
      return {...state, nativeLoads: {...state.nativeLoads, [packet.accountId]: {
        accountId: packet.accountId, loaded: packet.loaded, delay: packet.delay}}};
    }
    case 'sceneExit':
      return state.scene && packet.accountId === mine && packet.sceneId === state.scene.sceneId
        && packet.errorId === 0 ? {...state, exitAcknowledged: {sceneId: packet.sceneId,
          accountId: packet.accountId, exitType: packet.exitType}} : state;
    case 'backToMain': return clearRoom(state);
    default: return state;
  }
}

/** Display only. Zero does not lock a tank, send a packet or start a scene. */
export function selectionSecondsLeft(state, now) {
  const selection = state?.selection;
  if (!selection || !finite(selection.deadlineAt) || !finite(now)) return null;
  return Math.min(selection.remainingSeconds, Math.max(0, Math.ceil((selection.deadlineAt - now) / 1000)));
}

export function beginLocalLoad(state, {generation, sceneId, mapId} = {}) {
  if (generation !== state.generation || !state.scene || state.exitAcknowledged
      || sceneId !== state.scene.sceneId || mapId !== state.scene.mapId) return {state, token: null};
  const attempt = state.localLoadAttempt + 1;
  const token = Object.freeze({generation, sceneId, mapId, revision: state.revision, attempt});
  return {token, state: {...state, localLoadAttempt: attempt,
    localLoad: {token, stage: 'assets', completed: null, total: null, error: ''}}};
}

const LOAD_STAGES = new Set(['catalog', 'assets', 'interface', 'graphics', 'waiting-server', 'ready', 'error']);

/** Counts must describe observed work; null total keeps the UI indeterminate. */
export function updateLocalLoad(state, token, update = {}) {
  const current = state?.localLoad?.token;
  if (!current || !token || state.exitAcknowledged || !state.scene
      || !['generation', 'sceneId', 'mapId', 'revision', 'attempt'].every(k => current[k] === token[k])
      || state.generation !== token.generation || state.revision !== token.revision) return state;
  const next = {...state.localLoad};
  if (update.stage != null) {
    if (!LOAD_STAGES.has(update.stage)) throw new RangeError('Unknown asset loading stage');
    next.stage = update.stage;
  }
  for (const field of ['completed', 'total']) {
    if (Object.hasOwn(update, field)) {
      if (update[field] !== null && !uint(update[field])) throw new RangeError('Invalid observed load count');
      next[field] = update[field];
    }
  }
  if (next.total !== null && next.completed !== null && next.completed > next.total)
    throw new RangeError('Completed load count exceeds observed total');
  if (Object.hasOwn(update, 'error')) next.error = String(update.error || '');
  // Reaching an observed total does not synthesize a ready stage or native 100%.
  return {...state, localLoad: next};
}
