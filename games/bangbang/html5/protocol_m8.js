import {decodePacket as decodeBattlePacket} from './protocol_m4.js';
import {decodeMetaPacket} from './m8_meta_protocol.js';
import {decodeCrystalPacket} from './m8_crystal_protocol.js';
import {decodeAccountPacket} from './m8_account_protocol.js';
import {decodePvePacket} from './m81314_protocol.js';
import {decodeMailboxPacket} from './m81329_mail_protocol.js';
import {decodeWorldBossPacket} from './m81330_protocol.js';
import {decodeEconomyPacket} from './m81332_economy_protocol.js';
import {decodeRoomsPacket} from './m81337_rooms_protocol.js';
import {decodeShopPacket} from './m81345_shop_protocol.js';
export function decodePacket(frame) {
  return decodeShopPacket(frame) || decodeRoomsPacket(frame) || decodeEconomyPacket(frame) || decodeWorldBossPacket(frame) || decodeMailboxPacket(frame) || decodePvePacket(frame) || decodeMetaPacket(frame) || decodeCrystalPacket(frame)
    || decodeAccountPacket(frame) || decodeBattlePacket(frame);
}
