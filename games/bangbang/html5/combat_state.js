/* M4/M5 presentation state for the current Python battle server.
 * No damage, hit tests, bots, cooldown completion, respawn or match rules run here.
 * Native references: BattleManager.onSyncSceneData; CTank/SelfTank movement;
 * TankModel/BuffManager; SkillTool; EffectLayer; BulletTool.
 * All `now` arguments are monotonic milliseconds (performance.now()).
 */

import {nativeBodyDirectionForVector} from './m7_body_motion.js';

export const MOVE_DIRECTIONS = Object.freeze([
  [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [0, 0],
]);

const clone = value => structuredClone(value);
const packetData = ({tail, ...packet}) => clone(packet);
const point = (x, y) => ({x, y});
const key = value => String(value);
const FORCED_MOVES = new Set([1, 3, 4]);
const BODY_COMMAND_HISTORY_LIMIT = 64;
const BUFF_PRESENTATION_HISTORY_LIMIT = 128;
const PACKET_TYPES = new Set(['tick', 'sceneEntered', 'sceneSelf', 'sceneOthers', 'sceneAdd',
  'sceneStop', 'sceneUpdate', 'tankRelive', 'sceneObjectAdd', 'buffAdd', 'buffRemove',
  'tankAttr', 'sceneStats', 'killInfo', 'skillCooldown', 'skillChanged', 'buffTime',
  'skillStopped', 'campScore', 'battleEnd', 'bulletOrbit', 'objectThrow', 'skillDest',
  'battleExp', 'battleLevel', 'autoBulletRequest', 'hpChange', 'portalStates', 'systemError','occupyState','occupyAddScore',
  'roundScore','roundStart','roundResult','roundAlive']);

function requireTime(now) {
  if (!Number.isFinite(now)) throw new TypeError('A finite monotonic time is required');
}

function normalizeCharacter(char) {
  return {accountId: char.accountId ?? char.player?.accountId,
    name: char.name ?? char.player?.name, tankId: char.tankId ?? char.other?.tankId ?? null,
    tankLevel: char.tankLevel ?? char.other?.tankLevel ?? null,
    externalId: char.externalId ?? char.other?.externalId ?? null,
    skinFrameType: char.skinFrameType ?? char.other?.skinFrameType ?? null,
    vipLevel: char.vipLevel ?? char.player?.vipLevel ?? 0,
    camp: char.camp};
}

/** Maps use decimal object/account IDs as keys and contain only JSON data. */
export function createCombatState(scene, accountId, now) {
  requireTime(now);
  if (!scene || !Number.isInteger(scene.sceneId) || !Number.isInteger(accountId)) {
    throw new TypeError('An accepted scene and authenticated account are required');
  }
  const state = {schemaVersion: 1, sceneId: scene.sceneId, mapId: scene.mapId,
    roomType: scene.roomType, selfAccountId: accountId, selfObjectId: null,
    characters: (scene.characters ?? []).map(normalizeCharacter),
    actors: {}, objects: {}, actorOrder: [], objectOrder: [],
    objectsReady: false, accountObjects: {}, projectiles: {}, effects: [],
    portals: {}, flags:{}, mapNotice: null, deathRound:null,
    effectSequence: 0, skills: {}, respawns: {}, stats: {}, scores: {camp1: null, camp2: null},
    result: null, finishedAt: null, startedAt: scene.startedAt ?? null,
    selfSpeed: null, selfFireRate: null, fireReadyAt: null, selfSnapshotReceived: false,
    clock: {serverTimeMs: null, receivedAt: null},
    revision: 0, sourceSequence: null, receivedPackets: 0, lastPacketAt: null,
    eventCounts: {}, diagnostics: {unknownEntities: 0, rejectedScenePackets: 0,
      predictionSteps: 0, authoritativeStops: 0, discardedAfterFinish: 0,
      rejectedCooldowns: 0, cooldownRejections: {unknownOwner: 0, removedOwner: 0,
        enemyOwner: 0, remoteSlot: 0}}};
  for (const actor of scene.actors ?? []) replaceActor(state, actor, now);
  if (scene.self) replaceActor(state, scene.self, now, true);
  return state;
}

function buffMap(buffs, now) {
  const result = {};
  for (const buff of buffs ?? []) result[key(buff.instanceId)] = {...clone(buff),
    receivedAt: now, durationMs: null, expiresAt: null};
  return result;
}

function buffPresentation(buffs, now, packetOrder = 0, ownerNativeOrderSnapshot = undefined) {
  const value = {sequence: 0, changes: {}};
  // CTank.initBuff follows the received vector, not numeric instance-ID order.
  if (buffs?.length) value.nativeOrder = buffs.map(buff => buff.instanceId);
  const nativeVector = (buffs ?? []).map(({instanceId, templateId}) => ({instanceId, templateId}));
  for (const buff of buffs ?? []) {
    recordBuffPresentation(value, buff.templateId, 'add', now);
    recordNativeBuffPresentation(value, buff, 'add', now, packetOrder, 'snapshot', nativeVector,
      ownerNativeOrderSnapshot);
  }
  return value;
}

function recordNativeBuffPresentation(value, buff, operation, now, packetOrder, reason, nativeOrderSnapshot,
  ownerNativeOrderSnapshot = undefined) {
  // This is a second, instance-aware presentation journal. Existing gameplay
  // and M5/M7.1 template-level consumers keep their established contract.
  value.nativeHistory ??= [];
  value.nativeSequence = (value.nativeSequence ?? 0) + 1;
  value.nativeHistory.push({sequence: value.nativeSequence, operation,
    instanceId: buff.instanceId, templateId: buff.templateId,
    receivedAt: now, packetOrder, reason, nativeOrderSnapshot,
    ...(ownerNativeOrderSnapshot !== undefined ? {ownerNativeOrderSnapshot} : {})});
  if (value.nativeHistory.length > 256)
    value.nativeHistory.splice(0, value.nativeHistory.length - 256);
}

function nativeBuffVector(actor) {
  return (actor.buffPresentation.nativeOrder ?? []).map(id => actor.buffs[key(id)])
    .filter(Boolean).map(({instanceId, templateId}) => ({instanceId, templateId}));
}

function ownerNativeBuffVector(state, actor) {
  if ((actor.objectId >>> 26) !== 5) return undefined;
  const owner = entity(state, actor.ownerId);
  return owner && !owner.removed ? nativeBuffVector(owner) : null;
}

function legacyBuffPresentation(value) {
  // Audio/appearance event snapshots do not replay the M7.2 status journal.
  // Keep their prior shape and avoid cloning the bounded vector history for
  // every HP/fire event. These references are cloned by pushEffect as before.
  return {sequence: value.sequence, changes: value.changes,
    ...(value.history ? {history: value.history} : {})};
}

function recordBuffPresentation(value, templateId, operation, now) {
  // Keep the latest native transition per template, bounded by the templates
  // seen in this life. Removing a change-external buff restores the base even
  // when another such buff remains, so an active-buff reduction is incorrect.
  const change = {templateId, operation,
    sequence: ++value.sequence, receivedAt: now};
  value.changes[key(templateId)] = change;
  // Preserve A -> B -> A before a slow render while keeping the existing
  // latest-per-template contract. Component IDs remain a renderer concern.
  value.history ??= [];
  value.history.push(change);
  if (value.history.length > BUFF_PRESENTATION_HISTORY_LIMIT)
    value.history.splice(0, value.history.length - BUFF_PRESENTATION_HISTORY_LIMIT);
}

function buffTimer(durationMs, now) {
  // TankActions._buff and resume_packets encode -1 as unsigned 0xffffffff.
  // A zero-duration visual is already due; neither case authorizes removing
  // the buff locally. S1559 (or a new lifecycle snapshot) owns that transition.
  return {receivedAt: now, durationMs,
    expiresAt: durationMs === 0xffffffff ? null : now + durationMs};
}

function setVerifiedPosition(actor, x, y, now, source) {
  actor.x = x; actor.y = y;
  actor.verifiedPosition = {x, y, receivedAt: now, source};
}

function replaceActor(state, raw, now, isSelf = false) {
  if (isSelf && raw.accountId !== state.selfAccountId) {
    throw new Error('S1550 account does not match the authenticated account');
  }
  const old = state.actors[key(raw.objectId)];
  state.actorOrder ??= [];
  if (!old || old.removed) {
    state.actorOrder = state.actorOrder.filter(id => id !== raw.objectId);
    state.actorOrder.push(raw.objectId);
  }
  const character = state.characters.find(c => c.accountId === raw.accountId);
  const actor = {...clone(raw), tankId: character?.tankId ?? null,
    tankLevel: raw.tankLevel ?? character?.tankLevel ?? null,
    externalId: character?.externalId ?? null, skinFrameType: character?.skinFrameType ?? null,
    vipLevel: character?.vipLevel ?? 0,
    buffs: buffMap(raw.buffs, now), buffPresentation: buffPresentation(raw.buffs, now, state.presentationOrder ?? 0),
    position: point(raw.x, raw.y), predictedPosition: null,
    motion: null, moveQueue: [], lifeEpoch: (old?.lifeEpoch ?? 0) + 1,
    bodyDirection: old?.bodyDirection ?? 8, cannonAngle: old?.cannonAngle ?? 0,
    cannonFireSequence: 0, cannonFireHistory: [], cannonAimSequence: 0, cannonAimHistory: [],
    removed: false, dead: raw.hp <= 0,
    deathAt: raw.hp <= 0 ? (old?.dead ? old.deathAt ?? now : now) : null,
    lastSnapshotAt: now};
  initBodyCommands(actor, now, state.presentationOrder ?? 0);
  setVerifiedPosition(actor, raw.x, raw.y, now, 'snapshot');
  state.actors[key(raw.objectId)] = actor;
  if (Number.isInteger(raw.accountId)) state.accountObjects[key(raw.accountId)] = raw.objectId;
  if (isSelf || raw.accountId === state.selfAccountId) state.selfObjectId = raw.objectId;
  // present_packets emits fresh S1572 Space after S1550/S1551/S1552. A fresh
  // TankInfo invalidates this owner's old-life cache; sceneSelf immediately
  // installs all embedded PropsInfo slots before subsequent S1572 packets.
  state.skills[key(raw.objectId)] = {};
  if (raw.hp > 0) delete state.respawns[key(raw.accountId)];
  if (old?.dead && raw.hp > 0) pushEffect(state, 'respawn', now, {objectId: raw.objectId,
    accountId: raw.accountId, position: point(raw.x, raw.y), lifeEpoch: actor.lifeEpoch});
  // TankModel.setSelfTankInfo emits SELF_TANK_RELIVE for a subsequent self
  // snapshot in the same model. A first entry/reconnect creates a fresh model.
  if (isSelf) {
    if (state.selfSnapshotReceived) pushEffect(state, 'selfRelive', now,
      {objectId: raw.objectId, accountId: raw.accountId, position: point(raw.x, raw.y)});
    state.selfSnapshotReceived = true;
  }
  return actor;
}

function replaceObject(state, raw, now) {
  const old = state.objects[key(raw.objectId)];
  state.objectOrder ??= [];
  if (!old || old.removed) {
    state.objectOrder = state.objectOrder.filter(id => id !== raw.objectId);
    state.objectOrder.push(raw.objectId);
  }
  const owner = entity(state, raw.ownerId);
  const ownerPosition = owner && !owner.removed ? visualPosition(owner, now) : null;
  const object = {...clone(raw), buffs: buffMap(raw.buffs, now),
    buffPresentation: buffPresentation(raw.buffs, now, state.presentationOrder ?? 0,
      ownerNativeBuffVector(state, raw)), position: point(raw.x, raw.y),
    predictedPosition: null, motion: null, moveQueue: [], lifeEpoch: (old?.lifeEpoch ?? 0) + 1,
    bodyDirection: old?.bodyDirection ?? 8, cannonAngle: old?.cannonAngle ?? 0,
    cannonFireSequence: 0, cannonFireHistory: [], cannonAimSequence: 0, cannonAimHistory: [],
    removed: false, dead: false, lastSnapshotAt: now,
    // SceneItemView resolves its owner's displayed point during ITEM_ADD.
    // Later packets in this batch must not rotate it from a future owner pose.
    ownerPositionAtSnapshot: ownerPosition ? point(ownerPosition.x, ownerPosition.y) : null,
    // TankShadow constructs CTank from the owner's CHAR_BRIEF/base outlook at
    // NPC_ADD. It does not borrow a later transform or a future owner life.
    ownerExternalIdAtSnapshot: owner?.externalId ?? null,
    ownerTankIdAtSnapshot: owner?.tankId ?? null,
    ownerTankLevelAtSnapshot: owner?.tankLevel ?? null,
    ownerBodyDirectionAtSnapshot: ownerPosition?.bodyDirection ?? owner?.bodyDirection ?? 8,
    ownerCannonAngleAtSnapshot: owner?.cannonAngle ?? 0};
  initBodyCommands(object, now, state.presentationOrder ?? 0);
  setVerifiedPosition(object, raw.x, raw.y, now, 'snapshot');
  state.objects[key(raw.objectId)] = object;
  // Native AINpcModel.addNpc dispatches NPC_ADD for every accepted type-5
  // snapshot, including a repeated add or a new connection's resume snapshot.
  if ((raw.objectId >>> 26) === 5) pushEffect(state, 'npcAdd', now,
    {objectId: raw.objectId, templateId: raw.templateId, position: point(raw.x, raw.y),
      hp: raw.hp, maxHp: raw.maxHp,
      buffs: raw.buffs || [], announcerState: {selfCamp: state.actors[key(state.selfObjectId)]?.camp,
        object: announcerObjectState(state, object)}});
  // SceneItemModel.addItemFromList dispatches ITEM_ADD for each accepted
  // snapshot. Retain its typed identity/camp even if this ID is reused before
  // the next animation frame consumes the presentation queue.
  if ((raw.objectId >>> 26) === 4) pushEffect(state, 'sceneItemAdded', now,
    {objectId: raw.objectId, objectState: objectSoundState(object),
      selfCamp: state.actors[key(state.selfObjectId)]?.camp,
      position: point(raw.x, raw.y)});
  return object;
}

function objectSoundState(actor) {
  if (!actor) return null;
  return {objectId: actor.objectId, templateId: actor.templateId,
    ownerId: actor.ownerId, camp: actor.camp, hp: actor.hp, maxHp: actor.maxHp,
    removed: actor.removed,
    externalId: actor.externalId, tankId: actor.tankId, tankLevel: actor.tankLevel,
    ownerExternalIdAtSnapshot: actor.ownerExternalIdAtSnapshot,
    ownerTankIdAtSnapshot: actor.ownerTankIdAtSnapshot, ownerTankLevelAtSnapshot: actor.ownerTankLevelAtSnapshot,
    buffPresentation: legacyBuffPresentation(actor.buffPresentation)};
}

function announcerObjectState(state, actor) {
  if (!actor) return null;
  const character = state.characters.find(value => value.accountId === actor.accountId);
  return {objectId: actor.objectId, camp: actor.camp, name: actor.name ?? character?.name ?? null,
    templateId: actor.templateId ?? null, tankId: character?.tankId ?? actor.tankId ?? null, removed: actor.removed,
    // BattleObjectTool reads CHAR_BRIEF.otherData.tankExternal for tank heads,
    // independent of any current change-external buff on the in-world actor.
    externalId: (actor.objectId >>> 26) === 0 ? character?.externalId ?? null : actor.externalId ?? null,
    tankLevel: character?.tankLevel ?? actor.tankLevel ?? null};
}

function entity(state, objectId) {
  return state.actors[key(objectId)] ?? state.objects[key(objectId)] ?? null;
}

function knownEntity(state, objectId) {
  const value = entity(state, objectId);
  if (!value || value.removed) { state.diagnostics.unknownEntities += 1; return null; }
  return value;
}

function pushEffect(state, kind, now, value) {
  state.effects.push({id: ++state.effectSequence, kind, receivedAt: now,
    sourceSequence: state.sourceSequence, ...clone(value)});
}

/** Drain every RAF. The renderer owns each drained animation's complete timeline. */
export function takeCombatEffects(state) {
  const effects = state.effects;
  state.effects = [];
  return effects;
}

function moveDuration(from, to, speed) {
  if (!(speed > 0)) return 0;
  // CTank.doMove uses an int distance, then an int duration. In particular,
  // a diagonal 24px step uses 33px here, matching the native presentation.
  return Math.max(1, Math.floor(Math.floor(Math.hypot(to.x - from.x, to.y - from.y)) * 1000 / speed));
}

function initBodyCommands(actor, now, packetOrder = 0) {
  actor.bodyCommandSequence = 0;
  actor.bodyFacingCommands = [];
  actor.bodyAnimationCommands = [{key: `${actor.lifeEpoch}:0:idle`, sequence: 0,
    state: 'idle', at: now, packetOrder, reason: 'snapshot'}];
}

function bodyCommandOrder(a, b) {
  return (a.at ?? a.startedAt) - (b.at ?? b.startedAt) || a.sequence - b.sequence;
}

function appendBodyCommand(commands, command) {
  if (commands.some(value => value.key === command.key)) return;
  commands.push(command);
  commands.sort(bodyCommandOrder);
  if (commands.length > BODY_COMMAND_HISTORY_LIMIT)
    commands.splice(0, commands.length - BODY_COMMAND_HISTORY_LIMIT);
}

function annotateBodyMotion(actor, motion, nativeMove = true, packetOrder = 0) {
  // A serial identifies one native begin command, not a rendering frame.
  // A queued step keeps this identity when its native speed is adjusted.
  motion.bodyCommandSequence = ++actor.bodyCommandSequence;
  motion.nativeMove = nativeMove;
  motion.packetOrder = packetOrder;
  motion.bodyAnimationState = nativeMove
    ? motion.moveType === 3 ? 'rush' : [0, 5].includes(motion.moveType) ? 'move' : null
    : null;
  return motion;
}

function sampleBodyCommands(actor, motions, now) {
  const bodyFacingCommands = [...(actor.bodyFacingCommands ?? [])];
  const bodyAnimationCommands = [...(actor.bodyAnimationCommands ?? [])];
  for (let index = 0; index < motions.length; index += 1) {
    const motion = motions[index];
    if (now < motion.startedAt) break;
    const serial = motion.bodyCommandSequence;
    if (!Number.isSafeInteger(serial)) continue;
    const prefix = `${actor.lifeEpoch}:${serial}`;
    if (motion.turnsBody !== false) appendBodyCommand(bodyFacingCommands,
      {...bodyCommand(motion), key: `${prefix}:front`, sequence: serial * 3,
        packetOrder: motion.packetOrder ?? 0, delayFactor: motion.moveType === 3 ? 2 : 1});
    if (motion.bodyAnimationState) appendBodyCommand(bodyAnimationCommands,
      {key: `${prefix}:begin`, sequence: serial * 3 + 1, at: motion.startedAt,
        state: motion.bodyAnimationState, packetOrder: motion.packetOrder ?? 0,
        reason: motion.moveType === 3 ? 'begin-dash' : 'begin-move'});
    // CTank/AINpcObject.moveEndHandle enters NONE only with no next step.
    // ObjThrowProxy instead calls releaseThrowProxy: no body state change.
    if (now >= motion.endsAt && motion.nativeMove !== false && !motions[index + 1])
      appendBodyCommand(bodyAnimationCommands,
        {key: `${prefix}:end`, sequence: serial * 3 + 2, at: motion.endsAt,
          state: 'idle', packetOrder: motion.packetOrder ?? 0, reason: 'move-end'});
  }
  return {bodyCommandEpoch: actor.lifeEpoch, bodyFacingCommands, bodyAnimationCommands,
    bodyAnimationCommand: bodyAnimationCommands.at(-1) ?? null};
}

function retainBodyCommands(actor, position) {
  if (position.bodyFacingCommands) actor.bodyFacingCommands = clone(position.bodyFacingCommands);
  if (position.bodyAnimationCommands) actor.bodyAnimationCommands = clone(position.bodyAnimationCommands);
}

function stopBodyAnimation(actor, now, reason, packetOrder = 0) {
  const serial = ++actor.bodyCommandSequence;
  appendBodyCommand(actor.bodyAnimationCommands,
    {key: `${actor.lifeEpoch}:${serial}:stop`, sequence: serial * 3 + 1,
      state: 'idle', at: now, packetOrder, reason});
}

function makeMotion(from, to, speed, startedAt, moveType, direction, predicted = false) {
  const durationMs = moveDuration(from, to, speed);
  return {from: clone(from), to: clone(to), speed, startedAt,
    endsAt: startedAt + durationMs, durationMs, moveType, direction, predicted,
    bodyDirection: direction, turnsBody: [0, 3, 5].includes(moveType)};
}

function bodyCommand(motion) {
  return {direction: motion.bodyDirection ?? motion.direction, startedAt: motion.startedAt,
    endsAt: motion.endsAt, moveType: motion.moveType, throwType: motion.throwType ?? null};
}

function interpolate(motion, now) {
  const fraction = motion.durationMs <= 0 ? 1 : Math.max(0, Math.min(1,
    (now - motion.startedAt) / motion.durationMs));
  return {x: motion.from.x + (motion.to.x - motion.from.x) * fraction,
    y: motion.from.y + (motion.to.y - motion.from.y) * fraction};
}

/** Samples presentation only. It never changes authoritative positions or HP. */
export function visualPosition(actor, now) {
  requireTime(now);
  if (!actor) return null;
  let pos = actor.position ?? point(actor.x, actor.y);
  let direction = actor.bodyDirection ?? 8, predicted = actor.predictedPosition != null;
  let bodyDirection = direction, bodyFacingCommand = actor.bodyFacingCommand ?? null;
  let motionStartedAt = null, motionEndsAt = null, throwType = null;
  let moveType = null, moving = false, nativeMoveActive = false;
  const motions = actor.motion ? [actor.motion, ...(actor.moveQueue ?? [])] : [];
  for (const motion of motions) {
    if (now < motion.startedAt) break;
    pos = interpolate(motion, now); direction = motion.direction;
    bodyDirection = motion.bodyDirection ?? direction;
    if (motion.turnsBody !== false) bodyFacingCommand = bodyCommand(motion);
    motionStartedAt = motion.startedAt; motionEndsAt = motion.endsAt; throwType = motion.throwType ?? null;
    predicted = motion.predicted; moveType = motion.moveType;
    moving = now < motion.endsAt;
    nativeMoveActive = moving && motion.nativeMove !== false;
    if (moving) break;
  }
  return {...pos, direction, bodyDirection, bodyFacingCommand, moveType, moving, predicted,
    motionStartedAt, motionEndsAt, throwType, nativeMoveActive,
    ...sampleBodyCommands(actor, motions, now)};
}

function settleMotion(actor, now) {
  if (actor.motion && now >= actor.motion.endsAt)
    retainBodyCommands(actor, visualPosition(actor, now));
  while (actor.motion && now >= actor.motion.endsAt) {
    actor.position = clone(actor.motion.to);
    actor.bodyDirection = actor.motion.bodyDirection ?? actor.motion.direction;
    if (actor.motion.turnsBody !== false) actor.bodyFacingCommand = bodyCommand(actor.motion);
    actor.motion = actor.moveQueue.shift() ?? null;
  }
}

function cancelMotion(actor, pos) {
  retainBodyCommands(actor, pos);
  actor.position = point(pos.x, pos.y);
  if (Number.isInteger(pos.bodyDirection)) actor.bodyDirection = pos.bodyDirection;
  if (pos.bodyFacingCommand) actor.bodyFacingCommand = clone(pos.bodyFacingCommand);
  actor.motion = null; actor.moveQueue = []; actor.predictedPosition = null;
}

/** Native angle convention: zero points north, then clockwise. */
export function directionForVector(dx, dy) {
  if (dx === 0 && dy === 0) return 8;
  const angle = Math.trunc(Math.atan2(dy, dx) * 180 / Math.PI + 90);
  const normalized = ((angle + 22) % 360 + 360) % 360;
  return (Math.floor(normalized / 45) + 1) % 8;
}

function handleMove(state, move, now) {
  const actor = knownEntity(state, move.objectId);
  if (!actor || actor.dead) return;
  // Current presentation converts these to S1554; retain the same semantics if
  // the native structured event is inspected before that conversion.
  if (move.moveType === 5 && move.direction === 8 && move.speed === 0) {
    const before = visualPosition(actor, now);
    setVerifiedPosition(actor, move.x, move.y, now, 'server-stop');
    cancelMotion(actor, {...before, x: move.x, y: move.y});
    if (before.nativeMoveActive) stopBodyAnimation(actor, now, 'server-stop', state.presentationOrder);
    state.diagnostics.authoritativeStops += 1; return;
  }
  const forced = FORCED_MOVES.has(move.moveType);
  setVerifiedPosition(actor, move.x, move.y, now, forced ? 'move-destination' : 'move-start');
  // Ordinary self walking is locally projected by Flash and has no positive
  // C501 ACK in the present server. Never use it to undo an active local step.
  if (move.objectId === state.selfObjectId && !forced && move.moveType !== 5) return;
  settleMotion(actor, now);
  if (forced) {
    const from = visualPosition(actor, now), to = point(move.x, move.y);
    const direction = directionForVector(to.x - from.x, to.y - from.y);
    cancelMotion(actor, from);
    actor.motion = annotateBodyMotion(actor, makeMotion(from, to, move.speed, now, move.moveType, direction), true, state.presentationOrder);
    // CTank.moveArbitrary only turns/animates the lower body for MOVE_DASH3.
    // BEAT_BACK1 and THROW4 change ground position without facing the shove.
    actor.motion.bodyDirection = move.moveType === 3 ? nativeBodyDirectionForVector(to.x - from.x, to.y - from.y) : from.bodyDirection;
    actor.bodyDirection = actor.motion.bodyDirection;
    return;
  }
  const delta = MOVE_DIRECTIONS[move.direction];
  if (!delta) return;
  if (move.direction === 8 || move.speed <= 0) {
    cancelMotion(actor, {...visualPosition(actor, now), x: move.x, y: move.y});
    stopBodyAnimation(actor, now, 'direction-none', state.presentationOrder); return;
  }
  const from = point(move.x, move.y), to = point(move.x + delta[0] * 24, move.y + delta[1] * 24);
  if (!actor.motion) {
    actor.position = from; actor.bodyDirection = move.direction;
    actor.motion = annotateBodyMotion(actor, makeMotion(from, to, move.speed, now, move.moveType, move.direction), true, state.presentationOrder);
  } else {
    actor.moveQueue.push(annotateBodyMotion(actor,
      makeMotion(from, to, move.speed, now, move.moveType, move.direction), true, state.presentationOrder));
    // CTank.addToMoveList accelerates queued steps when packets accumulate.
    const speed = move.speed * actor.moveQueue.length;
    let start = actor.motion.endsAt;
    actor.moveQueue = actor.moveQueue.map(item => {
      const queued = makeMotion(item.from, item.to, speed, start, item.moveType, item.direction);
      queued.bodyCommandSequence = item.bodyCommandSequence;
      queued.nativeMove = item.nativeMove;
      queued.bodyAnimationState = item.bodyAnimationState;
      queued.packetOrder = item.packetOrder;
      start = queued.endsAt; return queued;
    });
  }
}

function setHp(state, objectId, hp, now, modelEvent = true) {
  const actor = knownEntity(state, objectId);
  if (!actor) return;
  const before = actor.hp;
  actor.hp = hp;
  // SoundManager listens to model HP_UPDATE from absolute native HP, not
  // NotifyHpVary's floating text (S1605). Preserve even delta0 for map NPCs;
  // the sound consumer applies each native model's own eligibility rule.
  if (modelEvent) pushEffect(state, 'modelHpUpdate', now, {objectId,
    delta: hp - before, hp, position: visualPosition(actor, now),
    // BattleTool.isAced examines current TankModel HP at TANK_DEAD dispatch,
    // before a later update/respawn in the same rendering batch.
    campAced: hp === 0 && !!state.actors[key(objectId)]
      && Object.values(state.actors).every(value => value.removed || value.camp !== actor.camp || value.hp === 0),
    objectState: objectSoundState(actor), announcerState: {
      selfCamp: state.actors[key(state.selfObjectId)]?.camp, object: announcerObjectState(state, actor)}});
  if (hp <= 0 && before > 0) {
    const position = visualPosition(actor, now);
    cancelMotion(actor, position); actor.dead = true; actor.deathAt = now; actor.buffs = {};
    actor.cannonAimHistory = [];
    pushEffect(state, 'death', now, {objectId, accountId: actor.accountId ?? null,
      position, lifeEpoch: actor.lifeEpoch,
      // ActiveObjectLayer captures CTank.getBodyComponentId at death. Keep
      // the native buff transitions at this event, before a later packet can
      // restore an appearance or replace the same object's next life.
      appearanceState: {objectId: actor.objectId, externalId: actor.externalId, templateId: actor.templateId,
        tankId: actor.tankId, tankLevel: actor.tankLevel,
        ownerId: actor.ownerId, ownerExternalIdAtSnapshot: actor.ownerExternalIdAtSnapshot,
        ownerTankIdAtSnapshot: actor.ownerTankIdAtSnapshot, ownerTankLevelAtSnapshot: actor.ownerTankLevelAtSnapshot,
        buffPresentation: legacyBuffPresentation(actor.buffPresentation)}});
  } else if (hp > 0) { actor.dead = false; actor.deathAt = null; }
}

function handleFire(state, fire, now) {
  const caster = entity(state, fire.objectId);
  const bullet = {...clone(fire), startedAt: now, blownAt: null, removed: false,
    casterLifeEpoch: caster?.lifeEpoch ?? null,
    casterTankId: caster?.tankId ?? null, casterExternalId: caster?.externalId ?? null,
    casterCamp: caster?.camp ?? null,
    casterAppearanceState: caster ? {objectId: caster.objectId, templateId: caster.templateId,
      tankId: caster.tankId, tankLevel: caster.tankLevel,
      externalId: caster.externalId, ownerId: caster.ownerId,
      ownerExternalIdAtSnapshot: caster.ownerExternalIdAtSnapshot,
      ownerTankIdAtSnapshot: caster.ownerTankIdAtSnapshot, ownerTankLevelAtSnapshot: caster.ownerTankLevelAtSnapshot,
      buffPresentation: clone(legacyBuffPresentation(caster.buffPresentation))} : null};
  state.projectiles[key(fire.bulletId)] = bullet;
  if (caster) {
    caster.cannonAngle = Math.atan2(fire.destY - fire.startY,
      fire.destX - fire.startX) * 180 / Math.PI + 90;
    // TankCannon.fire() may restart a stopped SWF root. Preserve every native
    // fire callback and its packet order for presentation through a slow RAF.
    caster.cannonFireSequence = (caster.cannonFireSequence ?? 0) + 1;
    caster.cannonFireHistory ??= [];
    caster.cannonFireHistory.push({sequence: caster.cannonFireSequence, receivedAt: now,
      packetOrder: state.presentationOrder ?? 0, objectId: caster.objectId, lifeEpoch: caster.lifeEpoch});
    if (caster.cannonFireHistory.length > 128) caster.cannonFireHistory.splice(0, caster.cannonFireHistory.length - 128);
  }
  if (fire.objectId === state.selfObjectId
      && state.skills[key(state.selfObjectId)]?.['0']?.skillId === fire.templateId
      && state.selfFireRate != null) state.fireReadyAt = now + state.selfFireRate;
  pushEffect(state, 'fire', now, {packet: fire, casterPosition: caster ? visualPosition(caster, now) : null});
}

function recordCannonAim(actor, angle, now, kind = 'goal') {
  actor.cannonAimSequence = (actor.cannonAimSequence || 0) + 1;
  actor.cannonAimHistory ??= [];
  const event = {sequence: actor.cannonAimSequence, angle, receivedAt: now, kind};
  if (kind === 'actual') {
    // Keep the goal at this actual bearing even when an older goal leaves the
    // bounded journal. A goal preceding the channel's buff is not a new aim.
    event.goalAngle = actor.lastServerAim?.angle;
    event.goalSequence = actor.lastServerAim?.aimSequence;
  }
  actor.cannonAimHistory.push(event);
  if (actor.cannonAimHistory.length > 128)
    actor.cannonAimHistory.splice(0, actor.cannonAimHistory.length - 128);
  return event;
}

function handleSkill(state, skill, now) {
  const caster = entity(state, skill.casterId), target = entity(state, skill.targetId);
  if (caster) {
    caster.lastSkillAim = {x: skill.x, y: skill.y, startX: skill.startX, startY: skill.startY,
      skillId: skill.skillId, isReady: skill.isReady, receivedAt: now, sourceSequence: state.sourceSequence,
      packetOrder: state.presentationOrder ?? 0};
    if (skill.isReady === 1) caster.readyCast = {skillId: skill.skillId, receivedAt: now};
    else if (caster.readyCast?.skillId === skill.skillId) caster.readyCast = null;
    // IronManActions sends the actual channel bearing in scene.skills, not
    // scene.fires. Humans have no S1603 goal: SelfTimmingSkillCaster already
    // limits their C514 aim. Preserve their ticks, and re-anchor bot goals to
    // the same server bearing used for damage. Self input remains untouched.
    if (caster.objectId !== state.selfObjectId && Number(caster.tankId) === 10000001
        && skill.isReady === 0 && [363301, 363501, 663301, 663501].includes(skill.skillId)) {
      caster.cannonAngle = Math.atan2(skill.y - skill.startY,
        skill.x - skill.startX) * 180 / Math.PI + 90;
      recordCannonAim(caster, caster.cannonAngle, now, 'actual');
    }
  }
  // EffectLayer anchors the cast movie at the caster's *current* view position,
  // after movement/snaps, and uses wire start coordinates only for its angle.
  pushEffect(state, 'skill', now, {packet: skill,
    casterPosition: caster ? visualPosition(caster, now) : point(skill.startX, skill.startY),
    targetPosition: target ? visualPosition(target, now) : point(skill.x, skill.y),
    startPosition: point(skill.startX, skill.startY), endPosition: point(skill.x, skill.y),
    casterLifeEpoch: caster?.lifeEpoch ?? null, targetLifeEpoch: target?.lifeEpoch ?? null,
    casterTankId: caster?.tankId ?? null, casterExternalId: caster?.externalId ?? null});
}

function removeObject(state, objectId, now, reason) {
  const bullet = state.projectiles[key(objectId)];
  if (bullet) {
    pushEffect(state, 'projectileRemoved', now, {bullet: clone(bullet), reason});
    delete state.projectiles[key(objectId)]; return;
  }
  const actor = entity(state, objectId);
  if (!actor || actor.removed) { state.diagnostics.unknownEntities += 1; return; }
  cancelMotion(actor, visualPosition(actor, now));
  actor.removed = true; actor.removedAt = now;
  actor.cannonAimHistory = [];
  if (state.actors[key(objectId)]) state.actorOrder = (state.actorOrder || []).filter(id => id !== objectId);
  else state.objectOrder = (state.objectOrder || []).filter(id => id !== objectId);
  // Keep the snapshot for result/identity joins; no skill FX is attached to its
  // lifetime. Both native deletion vectors contain generic object IDs.
  pushEffect(state, 'objectRemoved', now, {objectId, position: actor.position, reason,
    objectState: objectSoundState(actor), selfCamp: state.actors[key(state.selfObjectId)]?.camp,
    lifeEpoch: actor.lifeEpoch, wasDead: actor.dead, nativeDeathHunter: actor.nativeDeathHunter ?? null,
    appearanceState: {objectId: actor.objectId, externalId: actor.externalId, templateId: actor.templateId,
      tankId: actor.tankId, tankLevel: actor.tankLevel,
      ownerId: actor.ownerId, ownerExternalIdAtSnapshot: actor.ownerExternalIdAtSnapshot,
      ownerTankIdAtSnapshot: actor.ownerTankIdAtSnapshot, ownerTankLevelAtSnapshot: actor.ownerTankLevelAtSnapshot,
      buffPresentation: legacyBuffPresentation(actor.buffPresentation)}});
}

function applyUpdate(state, packet, now) {
  // Preserve native dispatch order, especially skill before HP/death/removal.
  for (const value of packet.moves ?? []) handleMove(state, value, now);
  for (const value of packet.fires ?? []) handleFire(state, value, now);
  for (const value of packet.skills ?? []) handleSkill(state, value, now);
  for (const value of packet.hp ?? []) setHp(state, value.objectId, value.hp, now);
  for (const value of packet.shields ?? []) {
    const actor = knownEntity(state, value.objectId); if (actor) actor.shield = value.shield;
  }
  for (const value of packet.mp ?? []) {
    const actor = knownEntity(state, value.objectId); if (actor) actor.mp = value.mp;
  }
  for (const bulletId of packet.blownBullets ?? []) {
    const bullet = state.projectiles[key(bulletId)];
    if (!bullet) { state.diagnostics.unknownEntities += 1; continue; }
    bullet.blownAt = now;
    // LinkBulletView keeps its rope after blow until an explicit removal. The
    // renderer resolves link/non-link from the asset catalog; retain wire data.
    pushEffect(state, 'projectileBlow', now, {bullet: clone(bullet)});
  }
  for (const value of packet.npcDeaths ?? []) {
    // AINpcModel.setAINpcDeadInfo stores the hunter point. This vector neither
    // relocates the victim nor removes it; m_delVec dispatches NPC_REMOVE.
    // Current Python scene() emits this metadata vector empty. Never infer it
    // from damage credit, an arbitrary projectile or the victim's position.
    const actor = state.objects[key(value.npcId)];
    if (actor && (value.npcId >>> 26) === 5) actor.nativeDeathHunter = point(value.x, value.y);
  }
  for (const id of packet.removedObjects ?? []) removeObject(state, id, now, 'removed');
  for (const id of packet.expiredBullets ?? []) removeObject(state, id, now, 'expired');
}

function setSkill(state, ownerId, skill) {
  // Native team_space_cooldowns presents all self slots, but only Space for
  // allied tank objects. Account IDs, enemies and NPC owners are not portraits.
  const actor = state.actors[key(ownerId)], self = state.actors[key(state.selfObjectId)];
  let rejection = null;
  if (!actor || !self) rejection = 'unknownOwner';
  else if (actor.removed) rejection = 'removedOwner';
  else if (ownerId !== state.selfObjectId) {
    if (actor.camp !== self.camp) rejection = 'enemyOwner';
    else if (skill.slot !== 2) rejection = 'remoteSlot';
  }
  if (rejection) {
    state.diagnostics.rejectedCooldowns += 1;
    state.diagnostics.cooldownRejections[rejection] += 1;
    return;
  }
  const owner = state.skills[key(ownerId)] ??= {};
  owner[key(skill.slot)] = clone(skill);
}

function attrChange(state, packet, now) {
  const objectId = state.accountObjects[key(packet.accountId)];
  const actor = state.actors[key(objectId)];
  if (!actor) { state.diagnostics.unknownEntities += 1; return; }
  const fields = {1: 'speed', 2: 'star', 3: 'maxHp', 4: 'fireRate',
    5: 'lifeCount', 6: 'hardness', 7: 'hp', 8: 'maxMp'};
  const field = fields[packet.attrType];
  if (!field) return;
  // ObjectManager has no ATTR_HP sound dispatch in this source version.
  if (field === 'hp') setHp(state, objectId, packet.value, now, false);
  else actor[field] = packet.value;
  if (packet.accountId === state.selfAccountId) {
    if (field === 'speed') state.selfSpeed = packet.value;
    if (field === 'fireRate') state.selfFireRate = packet.value;
  }
}

/** Applies one decoded, generation-checked native packet; returns whether owned.
 * Callers bind packets without scene IDs to the accepted connection/scene.
 * No packet sequence is synthesized; sourceSequence is copied only if supplied.
 */
export function applyCombatPacket(state, packet, now) {
  requireTime(now);
  if (!packet || !PACKET_TYPES.has(packet.type)) return false;
  // Only the native informational battle notice. Other S1501 responses
  // remain errors owned by the request/session UI.
  if (packet.type === 'systemError' && !(packet.requestId === 0 && packet.errorId === 3996
      && packet.params?.length === 1 && typeof packet.params[0] === 'string')) return false;
  if (packet.sceneId != null && packet.sceneId !== state.sceneId) {
    state.diagnostics.rejectedScenePackets += 1; return false;
  }
  if (packet.type === 'sceneSelf' && packet.actor.accountId !== state.selfAccountId) {
    throw new Error('S1550 account does not match the authenticated account');
  }
  state.revision += 1; state.receivedPackets += 1; state.lastPacketAt = now;
  // Arrival order also includes successful local walking commands. Unlike a
  // wall-clock timestamp this distinguishes equal-time buff and beginMoving.
  state.presentationOrder = (state.presentationOrder ?? 0) + 1;
  if (Number.isSafeInteger(packet.sequence)) state.sourceSequence = packet.sequence;
  state.eventCounts[packet.type] = (state.eventCounts[packet.type] ?? 0) + 1;
  if (state.result && ['sceneUpdate', 'sceneStop', 'sceneSelf', 'sceneOthers', 'sceneAdd',
    'sceneObjectAdd', 'bulletOrbit', 'objectThrow', 'portalStates', 'occupyState', 'occupyAddScore',
    'campScore', 'systemError','roundScore','roundStart','roundResult','roundAlive'].includes(packet.type)) {
    state.diagnostics.discardedAfterFinish += 1; return true;
  }
  switch (packet.type) {
    case 'tick': {
      const value = String(packet.serverTimeMs);
      if (/^\d+$/.test(value)) state.clock = {serverTimeMs: value, receivedAt: now};
      break;
    }
    case 'sceneEntered':
      state.startedAt = packet.startTime; state.overtime = packet.overtime; break;
    case 'sceneSelf': {
      const actor = replaceActor(state, packet.actor, now, true);
      state.selfSpeed = actor.speed = packet.speed;
      state.selfFireRate = actor.fireRate = packet.fireRate;
      state.fireReadyAt = null;
      for (const skill of packet.skills ?? []) setSkill(state, actor.objectId, skill);
      state.selfItems = clone(packet.items ?? []);
      state.selfKda = {kills: packet.kills, deaths: packet.deaths, assists: packet.assists};
      break;
    }
    case 'sceneOthers': for (const actor of packet.actors) replaceActor(state, actor, now); break;
    case 'sceneAdd': replaceActor(state, packet.actor, now); break;
    case 'sceneObjectAdd': replaceObject(state, packet.object, now); break;
    case 'sceneStop': {
      const actor = knownEntity(state, packet.objectId);
      if (actor) { const before = visualPosition(actor, now);
        setVerifiedPosition(actor, packet.x, packet.y, now, 'server-stop');
        cancelMotion(actor, {...before, x: packet.x, y: packet.y});
        // stopMoveAt stops the body only when a native doMove is active.
        // Releasing a throw-only proxy leaves its inherited body state alone.
        if (before.nativeMoveActive) stopBodyAnimation(actor, now, 'server-stop', state.presentationOrder);
        state.diagnostics.authoritativeStops += 1; }
      break;
    }
    case 'sceneUpdate': applyUpdate(state, packet, now); break;
    case 'tankRelive':
      state.respawns[key(packet.accountId)] = {remainingMs: packet.remainingMs,
        receivedAt: now, expiresAt: packet.remainingMs < 0 ? null : now + packet.remainingMs}; break;
    case 'buffAdd': {
      const actor = knownEntity(state, packet.objectId);
      if (actor) {
        const replacing = actor.buffs[key(packet.buff.instanceId)] != null;
        const presentation = actor.buffPresentation;
        presentation.nativeOrder ??= Object.values(actor.buffs).map(buff => buff.instanceId);
        if (!replacing) presentation.nativeOrder.push(packet.buff.instanceId);
        actor.buffs[key(packet.buff.instanceId)] = {...clone(packet.buff),
          ...buffTimer(packet.durationMs, now),
          // S1603 before a timing buff restores the current bearing; later
          // S1603 packets are goals for native UniformRotater, not snaps.
          cannonAtAdd: {angle: actor.cannonAngle || 0,
            aimSequence: actor.cannonAimSequence || 0, at: now}};
        const nativeVector = nativeBuffVector(actor);
        const ownerVector = ownerNativeBuffVector(state, actor);
        if (replacing && (actor.objectId >>> 26) === 0) {
          // Current TankBuffModel replaces the vector element first; BOTH
          // notifications carry the NEW BuffInfo, even if its template differs.
          recordNativeBuffPresentation(presentation, packet.buff, 'remove', now,
            state.presentationOrder, 'replace-instance', nativeVector, ownerVector);
        }
        // AINpcModel silently replaces an existing instance (including Shadow
        // objects). It does not dispatch another presentation ADD in that case.
        if (!replacing || (actor.objectId >>> 26) !== 5)
          recordNativeBuffPresentation(presentation, packet.buff, 'add', now,
            state.presentationOrder, replacing ? 'replace-instance' : 'native-add', nativeVector, ownerVector);
        recordBuffPresentation(actor.buffPresentation, packet.buff.templateId, 'add', now);
        // TankBuffModel replaces an existing instance by REMOVE then ADD too.
        // A real native refresh is a new trigger; the renderer deduplicates the
        // same drained event instead of suppressing legitimate refreshes.
        pushEffect(state, 'buffAdded', now,
          {objectId: actor.objectId, lifeEpoch: actor.lifeEpoch, buff: packet.buff,
            position: visualPosition(actor, now)});
      }
      break;
    }
    case 'buffRemove': {
      const actor = knownEntity(state, packet.objectId);
      const buff = actor?.buffs[key(packet.instanceId)];
      if (buff) {
        actor.buffPresentation.nativeOrder ??= Object.values(actor.buffs).map(value => value.instanceId);
        actor.buffPresentation.nativeOrder = actor.buffPresentation.nativeOrder.filter(id => id !== packet.instanceId);
        recordNativeBuffPresentation(actor.buffPresentation, buff, 'remove', now,
          state.presentationOrder, 'native-remove', nativeBuffVector(actor), ownerNativeBuffVector(state, actor));
        recordBuffPresentation(actor.buffPresentation, buff.templateId, 'remove', now);
        delete actor.buffs[key(packet.instanceId)];
      }
      break;
    }
    case 'buffTime': {
      const actor = state.actors[key(state.selfObjectId)], buff = actor?.buffs[key(packet.instanceId)];
      if (buff) {
        Object.assign(buff, buffTimer(packet.remainingMs, now), {stackCount: packet.stackCount});
        // S1581 refreshes the HUD clock/stack without replaying a native
        // ADD/REMOVE callback or restarting body/skill presentation.
        actor.buffPresentation.hudSequence = (actor.buffPresentation.hudSequence ?? 0) + 1;
      }
      break;
    }
    case 'tankAttr': attrChange(state, packet, now); break;
    case 'skillCooldown': setSkill(state, packet.ownerId, packet.skill); break;
    case 'skillChanged':
      if (packet.ownerId != null && packet.ownerId !== state.selfObjectId)
        throw new RangeError('S1579 explicit owner does not match the native self object');
      setSkill(state, state.selfObjectId, packet.skill); break;
    case 'skillStopped': {
      const caster = entity(state, packet.casterId);
      if (caster) caster.readyCast = null;
      pushEffect(state, 'skillStopped', now,
        {casterId: packet.casterId, skillId: packet.skillId}); break;
    }
    case 'bulletOrbit': {
      const bullet = state.projectiles[key(packet.bulletId)];
      if (bullet) Object.assign(bullet, {startX: packet.startX, startY: packet.startY,
        destX: packet.destX, destY: packet.destY, startedAt: now, blownAt: null});
      break;
    }
    case 'objectThrow': {
      const actor = knownEntity(state, packet.objectId);
      if (!actor || actor.dead) break;
      const from = point(packet.startX, packet.startY), to = point(packet.destX, packet.destY);
      const before = visualPosition(actor, now);
      cancelMotion(actor, {...before, ...from});
      setVerifiedPosition(actor, packet.destX, packet.destY, now, 'throw-destination');
      const direction = directionForVector(to.x - from.x, to.y - from.y);
      actor.motion = annotateBodyMotion(actor, {from, to, speed: null, startedAt: now,
        endsAt: now + packet.durationMs, durationMs: packet.durationMs,
        moveType: 4, throwType: packet.throwType, direction, predicted: false,
        turnsBody: packet.throwType === 1 && (actor.objectId >>> 26) === 0,
        bodyDirection: packet.throwType === 1 && (actor.objectId >>> 26) === 0
          ? nativeBodyDirectionForVector(to.x - from.x, to.y - from.y) : before.bodyDirection}, false, state.presentationOrder);
      break;
    }
    case 'skillDest': {
      const actor = knownEntity(state, packet.objectId);
      if (actor) { const pos = visualPosition(actor, now);
        actor.cannonAngle = Math.atan2(packet.y - pos.y, packet.x - pos.x) * 180 / Math.PI + 90;
        const event = recordCannonAim(actor, actor.cannonAngle, now);
        actor.lastServerAim = {x: packet.x, y: packet.y, receivedAt: now, sourceSequence: state.sourceSequence,
          angle: actor.cannonAngle, aimSequence: event.sequence}; }
      break;
    }
    case 'battleExp': {
      const actor = state.actors[key(state.selfObjectId)];
      if (actor) actor.battleExp = packet.currentExp;
      pushEffect(state, 'battleExp', now, {packet: packetData(packet)}); break;
    }
    case 'battleLevel': {
      const actor = state.actors[key(packet.objectId)];
      if (actor) actor.battleLevel = packet.battleLevel;
      else state.diagnostics.unknownEntities += 1;
      // Do not derive stats, heal, reset EXP, or change the garage tank level.
      // Native S1560/S1564/S1585 own those independent state transitions.
      break;
    }
    case 'autoBulletRequest': pushEffect(state, 'autoBulletRequest', now, {}); break;
    case 'hpChange': {
      const self = state.actors[key(state.selfObjectId)];
      for (const change of packet.changes) {
        const target = entity(state, change.objectId), caster = entity(state, change.casterId);
        // EffectLayer.onHpChange -> BattleTool.updateHarmLOS, including heals.
        // It is the actual caster affecting an allied *tank*, not any nearby actor.
        if (caster && self && state.actors[key(change.objectId)] && target.camp === self.camp) {
          caster.lastHurtRevealAt = now;
        }
        pushEffect(state, 'hpChange', now, {packet: change,
          position: target ? visualPosition(target, now) : null});
      }
      break;
    }
    case 'sceneStats':
      // Current entry_packets sends all live static S1556 before S1561. This
      // ordered marker prevents map-catalog NPCs resurrecting after reconnect.
      state.objectsReady = true;
      for (const actor of packet.actors) state.stats[key(actor.accountId)] = clone(actor); break;
    case 'killInfo': pushEffect(state, 'killInfo', now, {packet: packetData(packet),
      killerState: objectSoundState(entity(state, packet.killerId)),
      victimState: objectSoundState(entity(state, packet.victimId)),
      announcerState: {selfCamp: state.actors[key(state.selfObjectId)]?.camp,
        killer: announcerObjectState(state, entity(state, packet.killerId)),
        victim: announcerObjectState(state, entity(state, packet.victimId))}}); break;
    case 'roundScore':
      if(![30,40].includes(Number(state.mapId)))break;
      state.scores={camp1:packet.camp1,camp2:packet.camp2};
      // A reconnect has an absolute trophy snapshot, never an increment.
      state.deathRound||={number:packet.camp1+packet.camp2+1,begin:null,phase:'playing',alive:null};
      break;
    case 'roundStart': {
      if(![30,40].includes(Number(state.mapId)))break;
      if(state.deathRound?.begin===packet.startTime&&state.deathRound.number===packet.number)break;
      state.deathRound={number:packet.number,begin:packet.startTime,phase:'playing',
        alive:state.deathRound?.alive||null,receivedAt:now};
      state.startedAt=packet.startTime;state.mapNotice=null;
      break;
    }
    case 'roundResult': {
      if(![30,40].includes(Number(state.mapId))||state.deathRound?.phase==='result')break;
      const row=state.deathRound||{number:1,begin:null,alive:null};
      state.scores['camp'+packet.winner]=(state.scores['camp'+packet.winner]||0)+1;
      state.deathRound={...row,phase:'result',winner:packet.winner,resultAt:now};
      break;
    }
    case 'roundAlive':
      if(![30,40].includes(Number(state.mapId)))break;
      state.deathRound||={number:null,begin:null,phase:'playing'};
      state.deathRound.alive={camp1:packet.camp1,camp2:packet.camp2};
      break;
    case 'campScore': state.scores = {camp1: packet.camp1, camp2: packet.camp2}; break;
    case 'occupyState':
      state.flags=Object.fromEntries(packet.flags.map(flag=>[key(flag.index),{...flag,receivedAt:now,
        changedAt:state.flags[key(flag.index)]?.camp===flag.camp?state.flags[key(flag.index)].changedAt:now}]));
      break;
    case 'occupyAddScore':
      state.scores['camp'+packet.camp]=(state.scores['camp'+packet.camp]||0)+packet.score;
      break;
    case 'portalStates':
      for (const portal of packet.portals) {
        const previous = state.portals[key(portal.index)];
        if (!previous || previous.state !== portal.state)
          state.portals[key(portal.index)] = {...portal, changedAt: now};
      }
      break;
    case 'systemError':
      state.mapNotice = {text: packet.params[0], receivedAt: now};
      if([30,40].includes(Number(state.mapId))&&packet.params[0].startsWith('Hòa vòng —'))
        state.deathRound={...(state.deathRound||{}),phase:'draw',winner:0,resultAt:now};
      break;
    case 'battleEnd': {
      state.result = packetData(packet); state.finishedAt = now;
      for (const actor of [...Object.values(state.actors), ...Object.values(state.objects)]) {
        cancelMotion(actor, visualPosition(actor, now));
      }
      for (const bullet of Object.values(state.projectiles)) bullet.frozenAt = now;
      for (const actor of packet.actors ?? []) state.stats[key(actor.accountId)] = clone(actor);
      pushEffect(state, 'battleEnd', now, {sceneId: state.sceneId, winCamp: packet.winCamp});
      break;
    }
  }
  return true;
}

/** Epoch milliseconds as an exact decimal string, anchored only to S1003. */
export function serverTimeAt(state, now) {
  requireTime(now);
  if (state.clock.serverTimeMs == null || state.clock.receivedAt == null) return null;
  return (BigInt(state.clock.serverTimeMs) + BigInt(Math.floor(Math.max(0,
    now - state.clock.receivedAt)))).toString();
}

function remaining(deadline, current) {
  if (BigInt(deadline ?? '0') === 0n) return 0;
  if (current == null) return null;
  const value = BigInt(deadline) - BigInt(current);
  if (value <= 0n) return 0;
  return value > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(value);
}

/** Count/skill IDs remain server-owned even when the displayed timer reaches 0. */
export function cooldownView(state, ownerId, slot, now) {
  const skill = state.skills[key(ownerId)]?.[key(slot)];
  if (!skill) return null;
  const serverNow = serverTimeAt(state, now);
  const end = BigInt(skill.endTime), charge = BigInt(skill.nextChargeTime);
  const selected = skill.count === 0 && charge > end ? charge : end;
  const remainingMs = remaining(selected.toString(), serverNow);
  return {...clone(skill), remainingMs,
    nextChargeRemainingMs: remaining(skill.nextChargeTime, serverNow),
    clockSynchronized: serverNow != null,
    ready: skill.count !== 0 && remainingMs === 0};
}

/** One native 24px self step, or a stop-only request for an invalid old pose.
 * The latter never predicts a position; only the server can repair overlap.
 * geometry.canWalk(x,y,actor,state) must use the extracted map grid/NPC bounds.
 * Key release/changes take effect at the next completed step, as in Flash.
 */
export function beginPredictedStep(state, direction, now, geometry) {
  requireTime(now);
  if (!Number.isInteger(direction) || direction < 0 || direction > 7 || state.result) return null;
  const actor = state.actors[key(state.selfObjectId)];
  if (!actor || actor.dead || actor.removed || actor.hp <= 0 || !(state.selfSpeed >= 12)
      || typeof geometry?.canWalk !== 'function') return null;
  const controls = nativeControlFlags(actor, geometry.buffCatalog ?? {}, now, geometry.skillCatalog ?? {});
  if (controls.movementBlocked || controls.unknownTemplates.length
      || (geometry.canMoveActor && geometry.canMoveActor(actor, state, now) !== true)) return null;
  if (controls.chaos) direction = (direction + 4) % 8;
  settleMotion(actor, now);
  if (actor.motion) return null;
  const start = visualPosition(actor, now);
  const canWalk = (x, y) => geometry.canWalk(x, y, actor, state) === true;
  if (!canWalk(start.x, start.y)) {
    // A saved/previously interrupted pose can have no legal adjacent step.
    // Ask for an authoritative stop at most twice a second while movement is
    // held, instead of silently never sending input or moving through a wall.
    const previous = actor.walkRecoveryRequest;
    if (previous && previous.x === start.x && previous.y === start.y && now - previous.at < 500) return null;
    actor.walkRecoveryRequest = {x: start.x, y: start.y, at: now};
    return {sceneId: state.sceneId, startX: Math.trunc(start.x), startY: Math.trunc(start.y),
      direction: 8, endX: start.x, endY: start.y, durationMs: 0, recoveryRequest: true};
  }
  actor.walkRecoveryRequest = null;
  const canStep = (from, to) => typeof geometry.canStep === 'function'
    ? geometry.canStep(from, to, actor, state) === true : canWalk(to.x, to.y);
  const [dx, dy] = MOVE_DIRECTIONS[direction];
  let actual = direction;
  if (!canStep(start, {x: start.x + dx * 24, y: start.y + dy * 24})) {
    const choices = dx && dy ? [dy < 0 ? 1 : 5, dx < 0 ? 7 : 3]
      : dx === 0 ? [7, 3] : [1, 5];
    actual = choices.find(candidate => {
      const [sx, sy] = MOVE_DIRECTIONS[candidate];
      const x = start.x + sx * 24, y = start.y + sy * 24;
      return canStep(start, {x, y}) && (dx && dy || canStep({x, y}, {x: x + dx * 24, y: y + dy * 24}));
    });
    if (actual == null) return null;
  }
  const [ax, ay] = MOVE_DIRECTIONS[actual];
  const to = point(start.x + ax * 24, start.y + ay * 24);
  actor.bodyDirection = actual;
  actor.predictedPosition = {...to, startedAt: now};
  state.presentationOrder = (state.presentationOrder ?? 0) + 1;
  actor.motion = annotateBodyMotion(actor, makeMotion(start, to, state.selfSpeed, now, 0, actual, true), true, state.presentationOrder);
  state.diagnostics.predictionSteps += 1;
  return {sceneId: state.sceneId, startX: Math.trunc(start.x), startY: Math.trunc(start.y),
    direction: actual, endX: to.x, endY: to.y, durationMs: actor.motion.durationMs};
}

function catalogRow(catalog, id) {
  if (Array.isArray(catalog)) return catalog.find(row => Number(row.nBuffId ?? row.nSkillId ?? row.id) === id);
  return catalog?.[key(id)];
}

/** Input/visibility presentation from verified BUFF_TYPE and BUFF_SHOW_TYPE,
 * CTank/SelfTank, SkillTool.getBanSlots and current TankActions.blocked/sealed.
 * Buff countdown display never removes a control flag before S1559 arrives.
 * Server-side targeting/damage/immunity still decide the actual outcome.
 */
export function nativeControlFlags(actor, buffCatalog, now, skillCatalog = {}) {
  requireTime(now);
  const flags = {movementBlocked: !actor || actor.dead || actor.removed || actor.hp <= 0,
    attackBlocked: !actor || actor.dead || actor.removed || actor.hp <= 0,
    hardBlocked: !actor || actor.dead || actor.removed || actor.hp <= 0,
    blockedSlots: [], chaos: false, invisible: false, sneak: false, revealed: false,
    disappeared: false, cannonLocked: false, flying: false, staticState: false,
    autoMove: false, ready: false, unknownTemplates: []};
  if (!actor) return flags;
  const banned = new Set();
  for (const buff of Object.values(actor.buffs ?? {})) {
    const row = catalogRow(buffCatalog, buff.templateId);
    if (!row) { flags.unknownTemplates.push(buff.templateId); continue; }
    const effect = Number(row.nEffectType), show = Number(row.nBuffShowType);
    // Current Python state guards have explicit wire markers beyond generic
    // buff effects. canonical IDs for skin variants come from skin_effect_maps.
    const nativeIds = [buff.templateId, ...(row.canonicalNativeBuffIds || [])];
    if (nativeIds.some(id => [357402, 332311, 332313, 366801, 366802, 366803, 366804, 366805,
      329304, 329305, 329306, 354404].includes(id))) flags.hardBlocked = true;
    if (nativeIds.includes(314303)) for (const slot of [0, 1, 2, 10, 4]) banned.add(slot);
    if (nativeIds.includes(320311)) flags.attackBlocked = true;
    if (effect === 26) { flags.invisible = true; if (Number(row.fEffectValA) === 1) flags.sneak = true; }
    if (effect === 32) flags.revealed = true;
    if (effect === 39) flags.chaos = true;
    if (effect === 45) flags.autoMove = true;
    if (effect === 56) flags.disappeared = true;
    if (effect === 80) flags.cannonLocked = true;
    if (show === 1) flags.flying = true;
    if ([2, 3, 7].includes(show)) flags.staticState = true;
    // The current server silently ignores C501 on stun/charm/root. Do not
    // create a local step in these cases and wait for a correction that cannot arrive.
    if ([30, 36, 62].includes(effect)) flags.movementBlocked = true;
    if ([30, 62].includes(effect)) flags.attackBlocked = true;
    if (effect === 35 || effect === 66) {
      const mask = Number(row.fEffectValB) || 0;
      for (const [slot, bit] of [[0, 1], [1, 2], [2, 4], [10, 8], [4, 16]]) {
        if (effect === 35 && slot === 0) continue;
        if (mask === 0 || mask & bit) banned.add(slot);
      }
    }
  }
  if (actor.readyCast) {
    const row = catalogRow(skillCatalog, actor.readyCast.skillId);
    if (!row) flags.ready = true;
    else if (!(row.isGuide === true || Number(row.iGuide) === 1)) {
      flags.ready = now <= actor.readyCast.receivedAt + Math.max(0, Number(row.iReadyTime) || 0);
    }
  }
  const forced = actor.motion && now < actor.motion.endsAt && FORCED_MOVES.has(actor.motion.moveType);
  flags.movementBlocked ||= Boolean(forced || flags.autoMove || flags.disappeared
    || flags.flying || flags.staticState || flags.ready);
  flags.attackBlocked ||= Boolean(flags.disappeared || flags.flying || flags.staticState || flags.ready);
  if (flags.hardBlocked) {
    flags.movementBlocked = true; flags.attackBlocked = true;
    for (const slot of [0, 1, 2, 10, 4]) banned.add(slot);
  }
  flags.blockedSlots = [...banned].sort((a, b) => a - b);
  return flags;
}

/** Renderer calls this after a non-link bullet's blow/disappear is consumed.
 * This only releases presentation data; a link remains until server removal.
 */
export function retireProjectile(state, bulletId) { delete state.projectiles[key(bulletId)]; }

/** BulletTool.getDestPos: REACH/TRACE use the wire target; other projectiles
 * travel along the reported ray to the map edge until a server removal/blow.
 * Requires actual skill metadata; missing metadata leaves the wire target.
 */
export function projectileDestination(projectile, skill, geometry) {
  const target = point(projectile.destX, projectile.destY);
  const condition = Number(skill?.fCondition ?? 0);
  if (!skill || !Number.isFinite(condition) || (condition & 6)
      || !(geometry?.width > 0) || !(geometry?.height > 0)) return target;
  const dx = target.x - projectile.startX, dy = target.y - projectile.startY;
  if (!dx && !dy) return target;
  const times = [];
  if (dx > 0) times.push((geometry.width - projectile.startX) / dx);
  else if (dx < 0) times.push(-projectile.startX / dx);
  if (dy > 0) times.push((geometry.height - projectile.startY) / dy);
  else if (dy < 0) times.push(-projectile.startY / dy);
  const t = Math.min(...times.filter(value => value >= 0));
  if (!Number.isFinite(t)) return target;
  return point(Math.trunc(projectile.startX + dx * t), Math.trunc(projectile.startY + dy * t));
}

export function visualProjectilePosition(projectile, now, destination = null) {
  requireTime(now);
  if (!projectile) return null;
  const from = point(projectile.startX, projectile.startY);
  const to = destination ?? point(projectile.destX, projectile.destY);
  const duration = projectile.speed > 0
    ? Math.floor(Math.hypot(to.x - from.x, to.y - from.y)) * 1000 / projectile.speed : 0;
  const time = Math.min(now, projectile.frozenAt ?? now, projectile.blownAt ?? now);
  const fraction = duration > 0 ? Math.max(0, Math.min(1, (time - projectile.startedAt) / duration)) : 1;
  return {x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction,
    complete: fraction >= 1, blown: projectile.blownAt != null};
}
