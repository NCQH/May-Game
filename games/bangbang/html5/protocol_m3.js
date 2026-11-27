import {decodePacket as decodeLobbyPacket} from './protocol.js';
import {decodeRoomPacket} from './room_protocol.js';
import {decodeScenePacket} from './scene_protocol.js';

/** Native legacy S1724 in C72 may have a retained suffix. Only the session
 * layer knows whether this is the old bootstrap or a fresh C607 response.
 * All other M3 schemas are exact; unknown IDs retain M2 framing behavior.
 */
export function decodePacket(frame) {
  const packet = decodeRoomPacket(frame.msgId, frame.payload)
    || decodeScenePacket(frame.msgId, frame.payload);
  if (!packet) return decodeLobbyPacket(frame);
  if (packet.msgId !== 1724 && packet.trailingBytes) {
    throw new RangeError(`Unexpected trailing bytes in S${packet.msgId}`);
  }
  return packet;
}
