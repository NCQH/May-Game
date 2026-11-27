/* World Boss native packets from the user's stable Flash package. The timer
 * is a separately negotiated HTML5 extension, never a changed 1951/1952 ABI. */
import {Reader,Writer} from './protocol.js';
import {encodeFrame} from './sixcube.js';

export const WORLD_BOSS_MAP=40002,WORLD_BOSS_ACTIVITY=8,WORLD_BOSS_ROOM=7;
export const WORLD_BOSS_META_REQUEST=60002,WORLD_BOSS_META_REPLY=60003;
export const isWorldBossScene=scene=>Number(scene?.mapId)===WORLD_BOSS_MAP
  &&Number(scene?.roomType)===WORLD_BOSS_ROOM;
const empty=id=>encodeFrame(id,new Uint8Array());
export const encodeEnterWorldBoss=()=>empty(350);
export const encodeOpenWorldBoss=()=>empty(556);
export const encodeCloseWorldBoss=()=>empty(557);
export const encodeWorldBossMeta=()=>encodeFrame(WORLD_BOSS_META_REQUEST,new Writer().u8(1).finish());
const integer=(v,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const check=ok=>{if(!ok)throw new RangeError('Dữ liệu Boss Thế Giới không khớp giao thức đã kiểm.');};
const shortString=v=>typeof v==='string'&&new TextEncoder().encode(v).length<=512;

export function validateWorldBossMeta(v){
  check(object(v)&&v.version===1&&v.activity===8&&integer(v.round_id)&&v.round_id>0
    &&[2,3].includes(v.state)&&integer(v.revision)&&v.max_hp===10000000
    &&integer(v.hp,v.max_hp)&&integer(v.server_now_ms)&&integer(v.starts_at_ms)
    &&integer(v.ends_at_ms)&&v.ends_at_ms>=v.starts_at_ms
    &&(v.reopens_at_ms===null||integer(v.reopens_at_ms)));
  check(v.state!==3||v.hp===0);
  check(v.reopens_at_ms===null||v.reopens_at_ms>=v.starts_at_ms);
  const reward=v.rewards;
  check(object(reward)&&integer(reward.round_id)&&reward.round_id===v.round_id
    &&['none','pending','delivered'].includes(reward.status)&&reward.item_count===8
    &&integer(reward.pending_rounds));
  return v;
}

export function decodeWorldBossPacket({msgId,payload}){
  if(![1951,1952,WORLD_BOSS_META_REPLY].includes(msgId))return null;
  const r=new Reader(payload,msgId);let result;
  if(msgId===1951){
    const activity=r.i32(),status=r.i32(),reserved=r.u32();
    check(activity===8&&[2,3].includes(status)&&reserved===0);
    result={type:'worldBossStatus',activity,status};
  }else if(msgId===1952){
    const activity=r.i32(),hp=r.i32(),maxHp=r.i32(),ownDamage=r.i32(),ownRank=r.u32(),reserved=r.u32(),count=r.u16();
    check(activity===8&&maxHp===10000000&&integer(hp,maxHp)&&integer(ownDamage,maxHp)
      &&integer(ownRank,0xffffffff)&&reserved===0&&count<=10);
    const ranks=[];
    for(let i=0;i<count;i++){
      const uuid=r.string(),name=r.string(),damage=r.i32();
      check(shortString(uuid)&&uuid.length>0&&shortString(name)&&integer(damage,maxHp));
      check(!ranks.some(row=>row.uuid===uuid)&&(!i||ranks[i-1].damage>=damage));
      ranks.push({uuid,name,damage,rank:i+1});
    }
    result={type:'worldBossRank',activity,hp,maxHp,ownDamage,ownRank,ranks};
  }else{
    const meta=validateWorldBossMeta(JSON.parse(r.string()));
    result={type:'worldBossMeta',meta};
  }
  check(r.remaining===0);
  return {msgId,...result,byteLength:r.bytes.length,decodedBytes:r.offset,trailingBytes:0};
}
