// Native schemas: server/guild_protocol.py, server/guilds.py,
// server/cosmetic_shop.py and the current GuildInfo/TeamInfo AS3 classes.
import {Reader, Writer} from './protocol.js';
import {encodeFrame} from './sixcube.js';

function readGuild(r) {
  return r.fields([['guildId','u32'],['name','string'],['level','u32'],
    ['leaderUuid','string'],['viceLeaderUuid','string'],['notice','string'],
    ['activeCount','u32'],['coin','i32'],['createdAt','u32'],['settings','i32'],
    ['minLevel','u32'],['minLadder','u32'],['recruitNotice','string'],
    ['weekLiveness','u32'],['monthLiveness','u32']]);
}
function readTeam(r) {
  return r.fields([['teamId','u32'],['guildId','u32'],['name','string'],
    ['leaderUuid','string'],['place','u32'],['honorId','u32'],['createdAt','u32'],
    ['level','u32'],['coin','i32'],['glory','i32'],['merit','i32'],
    ['flags','u32'],['overdueCount','i32']]);
}
function readMember(r) {
  return r.fields([['teamId','u32'],['charUuid','string'],['accountId','u32'],
    ['joinedAt','u32'],['transferredAt','u32'],['merit','i32'],['allMerit','i32'],
    ['reserved1','u32'],['reserved2','u32']]);
}
function readBuddy(r) {
  const value = r.fields([['accountId','u32'],['charUuid','string'],['name','string'],['remark','string']]);
  const flags = Array.from({length: 8}, () => r.u8());
  const relation = r.i16(), fields = Array.from({length: 6}, () => r.u32());
  return {...value, level: flags[0], sex: flags[1], online: !!flags[2], vipLevel: flags[5],
    relation, lastSeen: fields[1], avatarId: fields[2], decorateId: fields[3]};
}
const packetIds = new Set([1508,1800,1801,1802,1804,1816,1830,1831,1832]);
export function decodeAccountPacket(frame) {
  if (!packetIds.has(frame.msgId)) return null;
  const r = new Reader(frame.payload, frame.msgId); let value;
  switch (frame.msgId) {
    case 1508: value = {type:'guildBuddies', buddies:r.vector(44, readBuddy)}; break;
    case 1800: value = {type:'guildInfo', guild:readGuild(r), teams:r.vector(48,readTeam), selfTeamId:r.u32()}; break;
    case 1801: case 1802: value = {type:'guildMemberLeft', charUuid:r.string(), kicked:frame.msgId===1802}; break;
    case 1804: value = {type:'guildInvitation', inviter:r.string(), guildId:r.u32(), guildName:r.string(),
      teamId:r.u32(), teamName:r.string(), invitationType:r.u8()}; break;
    case 1816: value = {type:'guildApplications', applicants:r.vector(44,readBuddy),
      inviters:r.vector(6,p=>({accountId:p.u32(),inviter:p.string()}))}; break;
    case 1830: value = {type:'guildTeamInvitation', inviterUuid:r.string(), charUuid:r.string(),
      teamId:r.u32(), teamName:r.string()}; break;
    case 1831: value = {type:'guildMembers', contestId:r.u32(), guildId:r.u32(), teamId:r.u32(),
      members:r.vector(34,readMember)}; break;
    case 1832: value = {type:'guildResearch', skills:r.vector(8,p=>({skillId:p.u32(),level:p.u32()})), opType:r.u32()}; break;
  }
  const decodedBytes = r.offset, tail = r.rest();
  return {msgId:frame.msgId,...value,byteLength:r.bytes.length,decodedBytes,tail,trailingBytes:tail.length};
}

// Request fields are ordered exactly as Guilds.mutate reads them. Unsupported
// Boss/war/gifts/maintenance requests are intentionally absent from this map.
export const GUILD_OPERATIONS = Object.freeze({
  create:{id:69,fields:[['name','string'],['teamName','string']]},
  createTeam:{id:68,fields:[['name','string']]},
  rename:{id:77,fields:[['name','string']]},
  renameTeam:{id:76,fields:[['name','string'],['teamId','u32']]},
  join:{id:651,fields:[['guildId','u32'],['teamId','u32']]},
  apply:{id:656,fields:[['guildId','u32'],['inviter','string'],['fast','u8']]},
  leave:{id:652,fields:[]}, refresh:{id:666,fields:[]}, applications:{id:657,fields:[]},
  research:{id:672,fields:[['skillId','u32']]}, learn:{id:320,fields:[['skillId','u32']]},
  unlockSlot:{id:321,fields:[['slotId','u32']]},
  equipSkill:{id:322,fields:[['slotId','u32'],['skillId','u32'],['level','u32']]},
  upgrade:{id:660,fields:[]}, notice:{id:662,fields:[['text','string']]},
  recruit:{id:663,fields:[['text','string']]}, channel:{id:661,fields:[['text','string']]},
  setting:{id:655,fields:[['kind','i32'],['value','i32']]},
  remove:{id:653,fields:[['charUuid','string'],['teamId','u32']]},
  appoint:{id:654,fields:[['charUuid','string'],['post','i32'],['teamId','u32']]},
  approve:{id:658,fields:[['charUuid','string'],['teamId','u32']]},
  reject:{id:659,fields:[['charUuid','string']]},
  dissolveTeam:{id:665,fields:[['teamId','u32']]},
  move:{id:668,fields:[['originTeamId','u32'],['charUuid','string'],['teamId','u32'],['otherUuid','string']]},
  invite:{id:778,fields:[['name','string'],['teamId','u32']]},
  inviteTeam:{id:669,fields:[['teamId','u32'],['name','string']]},
  acceptTeam:{id:670,fields:[['teamId','u32'],['charUuid','string']]},
});
export function encodeGuildAction(operation, values = {}) {
  const spec = GUILD_OPERATIONS[operation];
  if (!spec) throw new Error('Thao tác Bang hội chưa được hỗ trợ.');
  const w = new Writer();
  for (const [name,kind] of spec.fields) w[kind](values[name] ?? (kind==='string'?'':0));
  return encodeFrame(spec.id,w.finish());
}
export function encodePurchase({kind=1,goodsId,coinType,price,count=1}) {
  if (!Number.isInteger(count)||count<1||!Number.isInteger(price)||price<0) throw new RangeError('Giá hoặc số lượng không hợp lệ.');
  const total = price*count;
  if (!Number.isSafeInteger(total)||total>0x7fffffff) throw new RangeError('Tổng tiền quá lớn.');
  return encodeFrame(250,new Writer().i32(kind).u32(goodsId).u32(coinType).i32(price).i32(count)
    .u16(1).u32(coinType).i32(total).finish());
}
