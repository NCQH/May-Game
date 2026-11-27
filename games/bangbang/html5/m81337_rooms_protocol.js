/* Versioned small-server room extension. Native room/scene packets continue
 * to own phase transitions; this schema contains only public room metadata. */
import {Reader,Writer} from './protocol.js';
import {encodeFrame} from './sixcube.js';

export const ROOMS_REQUEST=60006,ROOMS_REPLY=60007;
export const ROOM_ACTIONS=Object.freeze(['status','subscribe','list','join','invite','accept','decline',
  'team','kick','remove_bot','add_bot','bot_policy','ready','leave','rank_queue','rank_cancel']);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const integer=(value,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(value)&&value>=0&&value<=max;
const id=value=>integer(value,0xffffffff)&&value>0;
const text=(value,max)=>typeof value==='string'&&[...value].length<=max;
const requestId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(value);
const camp=value=>value===1||value===2;
const ai=value=>value==='legacy'||value==='elite_v1';
const boolean=value=>typeof value==='boolean'||value===0||value===1;
const code=value=>typeof value==='string'&&/^[0-9]{6}$/.test(value);
function need(ok,message='Dữ liệu phòng chơi từ máy chủ không hợp lệ.'){if(!ok)throw new RangeError(message);}

export function encodeRoomsRequest(action,request_id,values={}){
  need(ROOM_ACTIONS.includes(action)&&requestId(request_id)&&object(values),'Yêu cầu phòng chơi không hợp lệ.');
  const data={v:1,request_id,action};
  if(action==='join'){
    const value=String(values.code??'').trim();need(code(value),'Nhập mã phòng gồm 6 chữ số.');data.code=value;
    if(values.camp!==undefined){need(camp(values.camp));data.camp=values.camp;}
  }else if(action==='invite'){
    need(id(values.account_id));data.account_id=values.account_id;
    if(values.camp!==undefined){need(camp(values.camp));data.camp=values.camp;}
  }else if(['accept','decline'].includes(action)){
    need(text(values.invite_id,128)&&values.invite_id.length>0);data.invite_id=values.invite_id;
  }else if(['team','kick','remove_bot','add_bot','bot_policy'].includes(action)){
    need(integer(values.revision));data.revision=values.revision;
    if(['team','add_bot','bot_policy'].includes(action)){need(camp(values.camp));data.camp=values.camp;}
    if(action==='team'&&values.account_id!==undefined){need(id(values.account_id));data.account_id=values.account_id;}
    if(['kick','remove_bot'].includes(action)){
      need(integer(values.slot,9)&&id(values.expected_account_id));
      data.slot=values.slot;data.expected_account_id=values.expected_account_id;
    }
    if(action==='add_bot'){need(integer(values.level,6)&&values.level>=1);data.level=values.level;}
    if(action==='bot_policy'){need(ai(values.bot_ai));data.bot_ai=values.bot_ai;}
  }else if(action==='ready'){need(typeof values.ready==='boolean');data.ready=values.ready;}
  return encodeFrame(ROOMS_REQUEST,new Writer().string(JSON.stringify(data)).finish());
}

function validSeat(row){
  if(!object(row)||!integer(row.slot,9)||row.camp!==(row.slot<5?1:2)
      ||!['empty','human','bot'].includes(row.kind))return false;
  if(row.kind==='empty')return row.account_id==null||row.account_id===0;
  return id(row.account_id)&&text(row.name,128)&&integer(row.level,255)
    &&integer(row.avatar_id,0xffffffff)&&integer(row.tank_id,0xffffffff)
    &&integer(row.tank_level,255)&&integer(row.external_id,0xffffffff)
    &&boolean(row.ready)&&typeof row.connected==='boolean';
}
function validRoom(room){
  if(room===null)return true;
  if(!object(room)||!id(room.room_id)||!code(room.code)||Number(room.code)!==room.room_id
      ||!id(room.owner_id)||!integer(room.revision)||!['waiting','selecting','battle'].includes(room.phase)
      ||typeof room.ranked!=='boolean'||!integer(room.map_id,0xffffffff)||!integer(room.room_type,255)
      ||!(integer(room.mode,0xffffffff)||text(room.mode,64))||!text(room.name,128)
      ||!object(room.bot_ai_camps)||!ai(room.bot_ai_camps['1'])||!ai(room.bot_ai_camps['2'])
      ||!Array.isArray(room.seats)||room.seats.length!==10||!room.seats.every(validSeat)
      ||new Set(room.seats.map(row=>row.slot)).size!==10
      ||!integer(room.human_count,10)||!integer(room.bot_count,10))return false;
  const occupied=room.seats.filter(row=>row.kind!=='empty');
  return new Set(occupied.map(row=>row.account_id)).size===occupied.length
    &&room.human_count===room.seats.filter(row=>row.kind==='human').length
    &&room.bot_count===room.seats.filter(row=>row.kind==='bot').length
    &&room.seats.some(row=>row.kind==='human'&&row.account_id===room.owner_id);
}
function validOnline(row){return object(row)&&id(row.account_id)&&text(row.name,128)
  &&integer(row.avatar_id,0xffffffff)&&integer(row.level,255)&&text(row.status,48)&&typeof row.can_invite==='boolean';}
function validInvite(row){return object(row)&&text(row.invite_id,128)&&row.invite_id.length>0
  &&id(row.room_id)&&code(row.code)&&Number(row.code)===row.room_id&&id(row.from_id)
  &&text(row.from_name,128)&&camp(row.camp)&&integer(row.expires_at_ms);}

export function decodeRoomsPacket({msgId,payload}){
  if(msgId!==ROOMS_REPLY)return null;
  const reader=new Reader(payload,msgId),value=JSON.parse(reader.string());
  need(reader.remaining===0&&object(value)&&value.v===1&&typeof value.ok==='boolean'
    &&(ROOM_ACTIONS.includes(value.action)||value.action==='changed')
    &&(value.action==='changed'?value.request_id===''&&value.ok:requestId(value.request_id)));
  need(integer(value.server_time_ms)&&validRoom(value.room)
    &&Array.isArray(value.online)&&value.online.length<=100&&value.online.every(validOnline)
    &&new Set(value.online.map(row=>row.account_id)).size===value.online.length
    &&Array.isArray(value.invites)&&value.invites.length<=100&&value.invites.every(validInvite)
    &&new Set(value.invites.map(row=>row.invite_id)).size===value.invites.length
    &&object(value.queue)&&typeof value.queue.active==='boolean'
    &&['idle','waiting','reserved'].includes(value.queue.status)&&integer(value.queue.wait_remaining_ms,3600000));
  if(!value.ok)need(object(value.error)&&text(value.error.code,100)&&text(value.error.message,2000));
  return {msgId,type:'multiplayerRooms',rooms:value};
}

export function createRoomsState(){return {revision:0,received:false,serverTimeMs:0,clockOffset:0,receivedAt:0,
  room:null,online:[],invites:[],queue:{active:false,status:'idle',wait_remaining_ms:0}};}
export function applyRoomsReply(state,value,now=Date.now()){
  const same=state.room&&value.room&&state.room.room_id===value.room.room_id;
  const room=same&&value.room.revision<state.room.revision?state.room:structuredClone(value.room);
  return {...state,revision:state.revision+1,received:true,serverTimeMs:value.server_time_ms,
    clockOffset:value.server_time_ms-now,receivedAt:now,room,
    online:structuredClone(value.online),invites:structuredClone(value.invites),queue:structuredClone(value.queue)};
}
export function roomSeat(state,accountId){return state?.room?.seats?.find(row=>row.kind!=='empty'&&row.account_id===accountId)||null;}
export function isManagedWaitingRoom(state,play){return !!state?.room&&state.room.phase==='waiting'
  &&play?.phase==='room'&&play.room?.roomId===state.room.room_id;}
