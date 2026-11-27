/* Native crystal transport. Source: server/crystals.py and the 2026-10-14
 * AS3 ItemMessage / SettleAwardInfo exports. No inventory or wallet mutations.
 * Existing S1045/S1454/S1455 remain decoded by protocol.js.
 */
import {Reader, Writer} from './protocol.js';
import {encodeFrame} from './sixcube.js';

const frame = (id, writer) => encodeFrame(id, writer.finish());
const HANDLED = new Set([1103, 1104, 1456, 1457, 1459]);

function boardId(value) {
  if (!Number.isInteger(value) || value < 1 || value > 255) throw new RangeError('Bảng tinh thể không hợp lệ.');
  return value;
}

export function encodeCrystalList() { return encodeFrame(423); }

export function encodeCrystalSave(id, items) {
  if (!Array.isArray(items) || items.length !== 30) throw new RangeError('Bảng phải có đúng 30 ô.');
  const w = new Writer().u32(boardId(id));
  for (const item of items) w.u32(item);
  return frame(424, w);
}

export function encodeCrystalRename(id, name) {
  if (typeof name !== 'string' || [...name].length > 32 || [...name].some(c => c.codePointAt(0) < 32))
    throw new RangeError('Tên bảng tối đa 32 ký tự và không chứa ký tự điều khiển.');
  // Empty names are permitted by the current server, including adding a board.
  return frame(425, new Writer().u32(boardId(id)).string(name));
}

export function encodeCrystalAssign(id, tankUuid) {
  if (typeof tankUuid !== 'string' || !tankUuid.length) throw new TypeError('Cần chọn tank sở hữu.');
  return frame(427, new Writer().u32(boardId(id)).string(tankUuid));
}

export function encodeCrystalCraft(kind) {
  if (![3, 4, 5, 6].includes(kind)) throw new RangeError('Gói chế tạo chưa được mở.');
  return frame(430, new Writer().u32(kind));
}

/** C426 sells a vector of individual owned crystals; repeated IDs mean copies. */
export function encodeCrystalSell(itemIds) {
  if (!Array.isArray(itemIds) || !itemIds.length || itemIds.length > 1000)
    throw new RangeError('Chọn từ 1 đến 1000 tinh thể để bán.');
  const w = new Writer().u32(1).u16(itemIds.length);
  for (const id of itemIds) w.u32(id);
  return frame(426, w);
}

/** C155 exchanges fragments using native recipe IDs, never crystal item IDs. */
export function encodeCrystalExchange(requests) {
  if (!Array.isArray(requests) || !requests.length || requests.length > 100)
    throw new RangeError('Số công thức đổi không hợp lệ.');
  const w = new Writer().u16(requests.length);
  for (const request of requests) {
    if (!Number.isInteger(request.count) || request.count < 1 || request.count > 999)
      throw new RangeError('Số lượng đổi phải từ 1 đến 999.');
    w.u32(request.recipeId).u32(request.count);
  }
  return frame(155, w.u16(0)); // Native empty coin vector: fragments only.
}

export function decodeCrystalPacket({msgId, payload}) {
  if (!Number.isInteger(msgId) || msgId < 0 || msgId > 65535) throw new RangeError('Invalid message ID');
  if (!HANDLED.has(msgId)) return null;
  const r = new Reader(payload, msgId), byteLength = r.bytes.length;
  let result;
  switch (msgId) {
    case 1103:
      result = {type: 'itemRemoved', containerType: r.u32(),
        slotNos: r.vector(2, p => p.i16()), uuids: r.vector(2, p => p.string())};
      break;
    case 1104:
      result = {type: 'settleAward', kind: r.u32(), award: {
        cash: r.i32(), gift: r.i32(), golden: r.i32(), glory: r.i32(),
        groups: r.vector(6, p => ({type: p.u32(),
          items: p.vector(8, q => ({itemId: q.u32(), count: q.i32()}))})),
        tankIds: r.vector(4, p => p.u32()), exp: r.i32(), fizz: r.u16(),
      }, isShow: r.u8(), extra: r.u32()};
      break;
    case 1456:
      result = {type: 'crystalSaveResult', result: r.u32()};
      break;
    case 1457:
      result = {type: 'crystalNameResult', result: r.u32()};
      break;
    case 1459:
      // AS3 calls this NotifyUpgradeCrystalResult.m_itemId. Current Python's
      // successful C426 branch sends itemId=0; it is not a generic error code.
      result = {type: 'crystalSellNotified', itemId: r.u32()};
      break;
  }
  const decodedBytes = r.offset, tail = r.rest();
  return {msgId, ...result, byteLength, decodedBytes, tail, trailingBytes: tail.length};
}
