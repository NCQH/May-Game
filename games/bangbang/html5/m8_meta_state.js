/* Pure native meta-state reducer. Nothing is optimistically granted or deducted.
 * Notify semantics follow ItemManager, PackageItemModel and TankInstanceModel.
 * Safe snapshots deliberately omit all transport/auth/query URL fields.
 */
const TANK_FIELDS = ['uuid', 'tankId', 'level', 'exp', 'extFlag', 'strengthenLevel', 'externalId',
  'warCount', 'weekWarCount', 'containerType', 'cashHireCount', 'coinHireCount', 'existTime', 'haloId',
  'skinFrameType', 'ownTime', 'strengthenCount', 'commonSkillId', 'crystalSchemeId', 'talentPageUuid',
  'proficiency', 'battleGains'];
const ITEM_FIELDS = ['uuid', 'templateId', 'lifeTime', 'extFlag', 'count', 'level', 'upgradeLevel',
  'exp', 'rank', 'upgradeCost', 'rankCost', 'createTime', 'slotNo'];
const CHARACTER_FIELDS = ['accountId', 'sex', 'level', 'vipTime', 'exp', 'tankExpDoubleTime',
  'expDoubleTime', 'tokenDoubleTime', 'materialDoubleTime', 'tokenDoubleUse', 'materialDoubleUse',
  'tankExpDoubleUse', 'militaryLevel', 'militaryExp', 'sprayId', 'vipPoints', 'vipPointsAddToday',
  'avatarId', 'decorateId', 'fizz', 'weekFizz', 'vipTankTryTime', 'superVipTime', 'actionFlag', 'thew',
  'thewBuy', 'thewVip', 'createTime', 'onlineTime', 'honorId', 'goldenPool', 'rlteStageCount', 'settingFlag',
  'cashbackTimes', 'cashbackPicked', 'prenticeCashback', 'graduateCount', 'groceryAdd', 'gmLevel',
  'hasTankSoulRankAward', 'militaryStar', 'name', 'charUuid', 'elo', 'eloSection', 'threeVThreeElo',
  'credit', 'buyTalentPageNum'];
const CURRENCY_FIELDS = ['cash', 'golden', 'silver', 'honor', 'crystal', 'presentPoint'];
const REPLACE_TANK_OPS = new Set([1, 2, 4, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
const FIELD_UPDATES = Object.freeze({ 1: 'decorateId', 6: 'elo', 8: 'eloSection', 9: 'goldenPool',
  10: 'threeVThreeElo', 20: 'credit', 25: 'vipTankTryTime', 26: 'buyTalentPageNum', 27: 'militaryStar' });
const own = (object, key) => Object.hasOwn(object || {}, key);
function pick(source, fields) {
  const result = {};
  for (const key of fields) {
    if (own(source, key) && ['number', 'string', 'boolean'].includes(typeof source[key])) result[key] = source[key];
  }
  return result;
}
function tankCopy(tank) { const result = pick(tank, TANK_FIELDS); result.selected = (result.extFlag & 2) !== 0; return result; }
function itemCopy(item) { return pick(item, ITEM_FIELDS); }
function jsonCopy(value) { return JSON.parse(JSON.stringify(value)); }
function characterCopy(character) {
  const result = pick(character, CHARACTER_FIELDS);
  if (character?.currency) result.currency = pick(character.currency, CURRENCY_FIELDS);
  return result;
}
function containerCopy(container) {
  const items = (container.items || []).map(itemCopy);
  return { containerType: container.containerType, notifyType: container.notifyType, count: items.length,
    slots: { ...(container.slots || {}) }, items };
}
function safeOptions(options) {
  return {
    // Preserve absence: missing means first-use defaults; [] is an explicit
    // native ordinary-casting choice. The UI/input adapter must distinguish them.
    ...(Array.isArray(options?.skillSlot) ? {skillSlot: options.skillSlot.filter(Number.isInteger)} : {}),
    keyBoardSet: Array.isArray(options?.keyBoardSet) ? options.keyBoardSet.filter((s) => typeof s === 'string') : [],
  };
}
function indexedContainers(containers, instances) {
  const result = {};
  for (const [key, container] of Object.entries(containers)) {
    const items = Object.values(container.slots).filter((uuid) => own(instances, uuid)).map((uuid) => itemCopy(instances[uuid]));
    result[key] = { ...container, count: items.length, items };
  }
  return result;
}
function mergeTanks(before, additions) {
  const result = before.slice();
  for (const input of additions) {
    const tank = tankCopy(input);
    const index = result.findIndex((old) => old.uuid === tank.uuid);
    if (index < 0) result.push(tank); else result[index] = tank;
  }
  return result;
}

export function createMetaState() {
  return { revision: 0, character: {}, tanks: [], containers: {}, itemInstances: {},
    settings: { settingFlag: 0, options: {} }, lastTankUpdate: null, lastCurrencyAction: null,
    lastError: null, lastSystemMessage: null };
}

export function applyMetaPacket(state, packet) {
  if (!state) state = createMetaState();
  const revision = state.revision + 1;
  switch (packet?.type) {
    case 'characterData': {
      const character = characterCopy(packet);
      return { ...state, revision, character,
        settings: { ...state.settings, settingFlag: character.settingFlag ?? state.settings.settingFlag } };
    }
    case 'garage': {
      if (![1, 2, 3].includes(packet.notifyType)) return state;
      // PLAYER_LOGIN_TANK for OWN resets the model; other login containers append.
      const before = packet.notifyType === 1 && packet.containerType === 0 ? [] : state.tanks;
      return { ...state, revision, tanks: mergeTanks(before, packet.tanks || []) };
    }
    case 'container': {
      if (![1, 2, 3, 4].includes(packet.notifyType)) return state;
      const key = String(packet.containerType);
      const reset = packet.notifyType === 1 || packet.notifyType === 3;
      const slots = reset ? {} : { ...(state.containers[key]?.slots || {}) };
      const itemInstances = { ...state.itemInstances };
      for (const input of packet.items || []) {
        const item = itemCopy(input);
        slots[String(item.slotNo)] = item.uuid;
        // Native ADD sets the absolute item; it never adds its count to an old stack.
        Object.defineProperty(itemInstances, item.uuid, { value: item, enumerable: true, configurable: true, writable: true });
      }
      const containers = { ...state.containers, [key]: { containerType: packet.containerType,
        notifyType: packet.notifyType, slots } };
      if (packet.notifyType === 4 && containers['8']) {
        const moved = new Set((packet.items || []).map((item) => item.uuid));
        const remaining = Object.fromEntries(Object.entries(containers['8'].slots).filter(([, uuid]) => !moved.has(uuid)));
        containers['8'] = { ...containers['8'], slots: remaining };
      }
      return { ...state, revision, itemInstances, containers: indexedContainers(containers, itemInstances) };
    }
    case 'itemUpdated': {
      // setItem updates the global object but does not add a missing slot index.
      const itemInstances = { ...state.itemInstances, [packet.item.uuid]: itemCopy(packet.item) };
      return { ...state, revision, itemInstances, containers: indexedContainers(state.containers, itemInstances) };
    }
    case 'itemRemoved': {
      // Native deleteItem removes each supplied slot, then its corresponding global UUID.
      // Extra UUID vector entries are not visited; no guessed slot/UUID match requirement.
      const key = String(packet.containerType), before = state.containers[key];
      if (!before) return state;
      const slots = { ...before.slots }, itemInstances = { ...state.itemInstances };
      for (let i = 0; i < packet.slotNos.length; i += 1) {
        delete slots[String(packet.slotNos[i])];
        if (typeof packet.uuids[i] === 'string') delete itemInstances[packet.uuids[i]];
      }
      const containers = { ...state.containers, [key]: { ...before, slots } };
      return { ...state, revision, itemInstances, containers: indexedContainers(containers, itemInstances) };
    }
    case 'tankInstanceUpdated': {
      const index = state.tanks.findIndex((tank) => tank.uuid === packet.tank.uuid);
      let updated = null;
      if (index >= 0) {
        const old = state.tanks[index];
        if (REPLACE_TANK_OPS.has(packet.op)) updated = tankCopy(packet.tank);
        else if (packet.op === 8) updated = { ...old, extFlag: packet.tank.extFlag, selected: (packet.tank.extFlag & 2) !== 0 };
        else if (packet.op === 3 || packet.op === 5) updated = { ...old, strengthenCount: packet.tank.strengthenCount };
        else if (packet.op === 19) updated = { ...old, crystalSchemeId: packet.tank.crystalSchemeId };
        else if (packet.op === 20) updated = { ...old, talentPageUuid: packet.tank.talentPageUuid };
      }
      const tanks = updated ? state.tanks.map((tank, i) => i === index ? updated : tank) : state.tanks;
      const clearsFailure = updated && [2, 4, 10].includes(packet.op) && state.lastError?.tankUuid === packet.tank.uuid;
      return { ...state, revision, tanks, lastError: clearsFailure ? null : state.lastError,
        lastTankUpdate: { tankUuid: packet.tank.uuid, op: packet.op, applied: !!updated, revision } };
    }
    case 'tankHaloResult': {
      if (packet.success !== 1) return state;
      const tanks = state.tanks.map(tank => tank.uuid === packet.tankUuid ? {...tank, haloId: packet.haloId} : tank);
      return {...state, revision, tanks};
    }
    case 'tankHaloInfo': {
      if (![1, 2].includes(packet.action)) return state;
      const uuids = new Set(packet.tankUuids);
      const tanks = state.tanks.map(tank => uuids.has(tank.uuid) ? {...tank, haloId: packet.action === 1 ? packet.haloId : 0} : tank);
      return {...state, revision, tanks};
    }
    case 'tankOperationFailed':
      return { ...state, revision, lastError: { type: packet.type, tankUuid: packet.tankUuid, op: packet.op, revision } };
    case 'currencyUpdated':
      return { ...state, revision, character: { ...state.character, currency: pick(packet.currency, CURRENCY_FIELDS) },
        lastCurrencyAction: { flow: packet.flow, reason: packet.reason, revision } };
    case 'pveThew':
      return { ...state, revision, character: { ...state.character,
        thew: packet.thew, thewBuy: packet.thewBuy, thewVip: packet.thewVip } };
    case 'avatarUpdated':
      return { ...state, revision, character: { ...state.character, avatarId: packet.avatarId } };
    case 'characterFieldUpdated': {
      const field = FIELD_UPDATES[packet.fieldType];
      if (!field) return state;
      return { ...state, revision, character: { ...state.character, [field]: packet.value } };
    }
    case 'settingFlagsUpdated':
      return { ...state, revision, character: { ...state.character, settingFlag: packet.settingFlag },
        settings: { ...state.settings, settingFlag: packet.settingFlag } };
    case 'playerOptionsUpdated':
      return { ...state, revision, settings: { ...state.settings, options: jsonCopy(packet.options || {}) } };
    case 'systemError':
      return { ...state, revision, lastSystemMessage: { requestId: packet.requestId,
        errorId: packet.errorId, params: (packet.params || []).filter((s) => typeof s === 'string'), revision } };
    default:
      return state;
  }
}

/** Detached, allowlisted JSON-safe data for UI/tests. Arbitrary C88 fields remain
 * private in state.settings.options so the connection can merge before saving.
 */
export function snapshotMetaState(state) {
  const containers = {};
  for (const [key, container] of Object.entries(state.containers)) containers[key] = containerCopy(container);
  return { revision: state.revision, character: characterCopy(state.character), tanks: state.tanks.map(tankCopy), containers,
    settings: { settingFlag: state.settings.settingFlag, options: safeOptions(state.settings.options) },
    lastTankUpdate: state.lastTankUpdate ? { ...state.lastTankUpdate } : null,
    lastCurrencyAction: state.lastCurrencyAction ? { ...state.lastCurrencyAction } : null,
    lastError: state.lastError ? { ...state.lastError } : null,
    lastSystemMessage: state.lastSystemMessage ? { ...state.lastSystemMessage, params: state.lastSystemMessage.params.slice() } : null };
}

export function inventoryCount(state, itemId) {
  let count = 0;
  for (const container of Object.values(state?.containers || {})) {
    for (const item of container.items || []) if (item.templateId === itemId && Number.isInteger(item.count)) count += item.count;
  }
  return count;
}
export function selectedPrimaryTank(state) {
  const tank = state?.tanks?.find((item) => (item.extFlag & 2) !== 0);
  return tank ? tankCopy(tank) : null;
}
