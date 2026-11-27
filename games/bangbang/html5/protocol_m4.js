import {decodePacket as decodePriorPacket} from './protocol_m3.js';
import {decodeCombatPacket} from './combat_protocol.js';

// Unknown packets still follow the proven M2/M3 stream path. Every newly
// registered schema is exact, so a malformed payload cannot silently shift
// subsequent combat fields.
export function decodePacket(frame) {
  const packet = decodeCombatPacket(frame.msgId, frame.payload);
  if (!packet) return decodePriorPacket(frame);
  if (packet.trailingBytes) throw new RangeError(`Unexpected trailing bytes in S${packet.msgId}`);
  return packet;
}
