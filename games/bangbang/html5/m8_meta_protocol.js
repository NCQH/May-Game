/* Native outside-battle packets, read against the current Python handlers and
 * extracted AS3. No economy, combat, RNG, or ownership decisions run here.
 * Encoders return complete Sixcube frames. Unknown messages return null.
 */
import { Reader, Writer } from './protocol.js';
import { encodeFrame } from './sixcube.js';

const UTF8 = new TextEncoder();
const TANK_INSTANCE = [
  ['uuid', 'string'], ['tankId', 'u32'], ['level', 'u8'], ['exp', 'u32'], ['extFlag', 'u32'],
  ['strengthenLevel', 'u8'], ['externalId', 'u32'], ['warCount', 'u32'], ['weekWarCount', 'u32'],
  ['containerType', 'u8'], ['cashHireCount', 'u8'], ['coinHireCount', 'u8'], ['existTime', 'u32'],
  ['haloId', 'u32'], ['skinFrameType', 'u8'], ['ownTime', 'u32'], ['strengthenCount', 'u8'],
  ['commonSkillId', 'u32'], ['crystalSchemeId', 'u8'], ['talentPageUuid', 'string'],
  ['proficiency', 'u32'], ['battleGains', 'i32'],
];
const ITEM_INSTANCE = [
  ['uuid', 'string'], ['templateId', 'u32'], ['lifeTime', 'u32'], ['extFlag', 'u32'],
  ['count', 'i32'], ['level', 'u8'], ['upgradeLevel', 'u8'], ['exp', 'i32'], ['rank', 'u8'],
  ['upgradeCost', 'i32'], ['rankCost', 'i32'], ['createTime', 'u32'], ['slotNo', 'i16'],
];
const CURRENCY = ['cash', 'golden', 'silver', 'honor', 'crystal', 'presentPoint']
  .map((name) => [name, 'i32']);
const HANDLED = new Set([85, 1023, 1036, 1039, 1047, 1102, 1151, 1153, 1160, 1161, 1501]);

function frame(id, writer) { return encodeFrame(id, writer.finish()); }
// C75 RequestChangeName. Native SEX_NONE=0; account/login identity is unchanged.
export function encodeRenameCharacter(value) {
  const name=String(value).normalize('NFC').trim();
  if(!name||[...name].length>12||/[<>\u0026\p{C}]/u.test(name))throw new Error('Tên cần từ 1–12 ký tự hợp lệ.');
  return frame(75,new Writer().string(name).i32(0));
}
function uuid(value, allowEmpty = false) {
  if (typeof value !== 'string') throw new TypeError('Tank/item UUID must be a string');
  const length = UTF8.encode(value).length;
  if ((!allowEmpty && length === 0) || length > 200) throw new RangeError('Tank/item UUID must be 1–200 UTF-8 bytes');
  return value;
}
function optionsObject(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Character options must be an object');
  }
  for (const key of ['skillSlot', 'keyBoardSet']) {
    if (Object.hasOwn(options, key) && !Array.isArray(options[key])) {
      throw new TypeError(`Character option ${key} must be an array`);
    }
  }
  return options;
}

// C200: ChangeBattleTank. Primary changes may produce two S1151/op8 packets.
export function encodePrimaryTank(tankUuid) { return frame(200, new Writer().string(uuid(tankUuid))); }
// C204: RequestTankStrengthen, native material mode is zero.
export function encodeStrengthenTank(tankUuid) { return frame(204, new Writer().string(uuid(tankUuid)).u32(0)); }
// C203: RequestTankUp. The server checks completion of this level's strengthen steps.
export function encodeAdvanceTank(tankUuid) { return frame(203, new Writer().string(uuid(tankUuid))); }
// C207: RequestChangeSkin. Empty item UUID is the native unequip request.
export function encodeEquipSkin(tankUuid, skinUuid = '', containerType = 0) {
  if (containerType !== 0) throw new RangeError('Skins require an owned tank in container 0');
  return frame(207, new Writer().string(uuid(tankUuid)).string(uuid(skinUuid, true)).u8(containerType));
}
export function encodeEquipHalo(tankUuid, haloId = 0) {
  if (!Number.isInteger(haloId) || haloId < 0 || haloId > 0xffffffff) throw new RangeError('Invalid halo ID');
  return frame(210, new Writer().string(uuid(tankUuid)).u32(haloId));
}
// C153: use an owned cosmetic item on self. Container 7, slot -1 removes the background.
export function encodeUseCosmetic(containerType, slotNo) {
  if (containerType !== 4 && containerType !== 7) throw new RangeError('Cosmetic container must be 4 or 7');
  if (!Number.isInteger(slotNo) || slotNo < (containerType === 7 ? -1 : 0) || slotNo > 32767) {
    throw new RangeError('Invalid cosmetic slot');
  }
  return frame(153, new Writer().u32(containerType).i16(slotNo).string('').i32(1).u8(0));
}
export function encodePlayerSettingFlags(settingFlag) { return frame(79, new Writer().u32(settingFlag)); }
export function encodePlayerOptions(options) {
  const value = JSON.stringify(optionsObject(options));
  if (typeof value !== 'string' || UTF8.encode(value).length > 16384) {
    throw new RangeError('Character options exceed 16384 UTF-8 bytes');
  }
  // Verify the serialized shape too; a custom toJSON must not bypass the native schema.
  optionsObject(JSON.parse(value));
  return frame(88, new Writer().string(value));
}

export function decodeMetaPacket({ msgId, payload }) {
  if (!Number.isInteger(msgId) || msgId < 0 || msgId > 65535) throw new RangeError('Invalid message ID');
  if (!HANDLED.has(msgId)) return null;
  const r = new Reader(payload, msgId);
  const byteLength = r.bytes.length;
  let result;
  switch (msgId) {
    case 85:
      result = { type: 'characterFieldUpdated', fieldType: r.u8(), value: r.u32(), text: r.string() };
      break;
    case 1023:
      result = { type: 'avatarUpdated', avatarId: r.u32() };
      break;
    case 1036:
      result = { type: 'settingFlagsUpdated', settingFlag: r.u32() };
      break;
    case 1039:
      result = { type: 'currencyUpdated', flow: r.u16(), reason: r.u16(), currency: r.fields(CURRENCY) };
      break;
    case 1047: {
      const optionsText = r.string();
      if (UTF8.encode(optionsText).length > 16384) throw new RangeError('Character options exceed 16384 UTF-8 bytes');
      // Native bootstrap can carry an empty string; SystemSetModel resets both arrays.
      const options = optionsText === '' ? {} : optionsObject(JSON.parse(optionsText));
      result = { type: 'playerOptionsUpdated', optionsText, options };
      break;
    }
    case 1102:
      result = { type: 'itemUpdated', containerType: r.u32(), item: r.fields(ITEM_INSTANCE) };
      break;
    case 1151: {
      const tank = r.fields(TANK_INSTANCE);
      tank.selected = (tank.extFlag & 2) !== 0;
      result = { type: 'tankInstanceUpdated', tank, op: r.u8() };
      break;
    }
    case 1153:
      result = { type: 'tankOperationFailed', tankUuid: r.string(), op: r.u32() };
      break;
    case 1160:
      result = { type: 'tankHaloResult', success: r.u8(), tankUuid: r.string(), haloId: r.u32() };
      break;
    case 1161:
      result = { type: 'tankHaloInfo', action: r.u32(), haloId: r.u32(), tankUuids: r.vector(2, p => p.string()) };
      break;
    case 1501:
      // This native message also carries informational/success tips. Its ID alone
      // must never be treated as proof that a mutation failed.
      result = { type: 'systemError', requestId: r.u32(), errorId: r.i32(), params: r.vector(2, (p) => p.string()) };
      break;
  }
  const decodedBytes = r.offset;
  const tail = r.rest();
  return { msgId, ...result, byteLength, decodedBytes, tail, trailingBytes: tail.length };
}
