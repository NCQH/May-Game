/* Versioned HTML5/offline mailbox extension, NOT an invented native Flash
 * MailMessage layout. Currency/bag/garage updates still use native packets. */
import {Reader,Writer} from './protocol.js';
import {encodeFrame} from './sixcube.js';
export const MAIL_REQUEST=60000,MAIL_REPLY=60001;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const integer=(value,max=0x7fffffff)=>Number.isSafeInteger(value)&&value>=0&&value<=max;
const utf8=new TextEncoder();
// Match Python len() for astral characters, without relaxing UTF-8 byte caps.
// Reader still validates fatal UTF-8 and the exact u16-length frame payload.
const text=(value,max,maxBytes=Infinity)=>typeof value==='string'&&[...value].length<=max
  &&(maxBytes===Infinity||utf8.encode(value).length<=maxBytes);
const mailId=value=>typeof value==='string'&&/^mail-[0-9a-f]{32}$/.test(value);
const requestId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(value);
function requireValue(ok){if(!ok)throw new RangeError('Phản hồi hòm thư không hợp lệ.');}
function brief(row){return object(row)&&mailId(row.id)&&text(row.subject,80,240)&&text(row.sender,100)
  &&integer(row.created_at,0xffffffff)&&typeof row.read==='boolean'&&typeof row.claimed==='boolean'
  &&(row.claimed_at==null||integer(row.claimed_at,0xffffffff))&&(row.expires_at==null||integer(row.expires_at,0xffffffff))
  &&integer(row.reward_count,16);}
function reward(row){return object(row)&&['currency','tank','item'].includes(row.kind)
  &&(row.kind==='currency'?['cash','gift','golden'].includes(row.id):integer(row.id,0xffffffff)&&row.id>0)
  &&integer(row.quantity,0x7fffffff)&&row.quantity>0&&text(row.name,300)&&text(row.category,40);}
function detail(row){return object(row)&&mailId(row.id)&&text(row.subject,80,240)&&text(row.body,2000,6000)
  &&text(row.sender,100)&&integer(row.created_at,0xffffffff)&&typeof row.read==='boolean'&&typeof row.claimed==='boolean'
  &&(row.claimed_at==null||integer(row.claimed_at,0xffffffff))&&object(row.recipient)&&integer(row.recipient.id,0xffffffff)
  &&(row.expires_at==null||integer(row.expires_at,0xffffffff))
  &&text(row.recipient.name,128)&&Array.isArray(row.rewards)&&row.rewards.length>0&&row.rewards.length<=16
  &&row.rewards.every(reward)&&row.claim_policy==='all_or_nothing';}
export function encodeMailboxRequest(action,request_id,values={}){
  if(!['list','read','claim','delete','delete_read'].includes(action)||!requestId(request_id))throw new RangeError('Yêu cầu hòm thư không hợp lệ.');
  const data={v:1,request_id,action};
  if(action==='list'){
    const offset=values.offset??0,limit=values.limit??5,filter=values.filter??'all';
    if(!integer(offset)||!integer(limit,50)||limit<1)throw new RangeError('Trang thư không hợp lệ.');
    if(!['all','unread'].includes(filter))throw new RangeError('Bộ lọc thư không hợp lệ.');
    Object.assign(data,{offset,limit});if(filter!=='all')data.filter=filter;
  }else if(action!=='delete_read'){
    if(!mailId(values.mail_id))throw new RangeError('Mã thư không hợp lệ.');
    data.mail_id=values.mail_id;
  }
  return encodeFrame(MAIL_REQUEST,new Writer().string(JSON.stringify(data)).finish());
}
export function decodeMailboxPacket({msgId,payload}){
  // Native Flash NotifyNoReadMailCount: one signed int32. Servers do not
  // push the HTML5-only extension until this connection has requested it.
  if(msgId===1230){const reader=new Reader(payload,msgId),unread=reader.i32();
    requireValue(reader.remaining===0&&integer(unread));return {msgId,type:'mailboxUnread',unread};}
  if(msgId!==MAIL_REPLY)return null;
  const reader=new Reader(payload,msgId),value=JSON.parse(reader.string());
  requireValue(reader.remaining===0&&object(value)&&value.v===1&&typeof value.ok==='boolean'
    &&['list','read','claim','delete','delete_read','changed'].includes(value.action));
  requireValue(value.action==='changed'?value.request_id===''&&value.ok:requestId(value.request_id));
  if(!value.ok)requireValue(object(value.error)&&text(value.error.code,100)&&text(value.error.message,2000));
  else{
    requireValue(integer(value.unread)&&integer(value.pending));
    if(value.capacity!==undefined)requireValue(value.capacity===30);
    if(value.total_inbox!==undefined)requireValue(integer(value.total_inbox));
    if(value.server_time!==undefined)requireValue(integer(value.server_time,0xffffffff));
    if(value.action==='list')requireValue(Array.isArray(value.rows)&&value.rows.length<=50&&value.rows.every(brief)
      &&new Set(value.rows.map(row=>row.id)).size===value.rows.length&&integer(value.total)
      &&integer(value.offset)&&integer(value.limit,50)&&value.limit>=1
      &&(value.filter===undefined||['all','unread'].includes(value.filter)));
    if(value.action==='read')requireValue(detail(value.mail));
    if(value.action==='claim')requireValue(typeof value.already_claimed==='boolean'
      &&(value.removed===true?mailId(value.mail_id):detail(value.mail)));
    if(['delete','delete_read'].includes(value.action))requireValue(Array.isArray(value.deleted)
      &&value.deleted.every(mailId)&&new Set(value.deleted).size===value.deleted.length
      &&(value.action!=='delete'||mailId(value.mail_id)&&value.removed===true)
      &&(value.kept_unclaimed===undefined||integer(value.kept_unclaimed)));
  }
  return {msgId,type:'mailbox',mailbox:value};
}
export const createMailboxState=()=>({revision:0,unread:0,pending:0,rows:[],total:0,total_inbox:0,capacity:30,offset:0,limit:5,filter:'all',clockOffset:0,received:false,dirty:false,details:{}});
export function applyMailboxReply(state,value){
  if(!value.ok)return state;
  const next={...state,revision:state.revision+1,unread:value.unread,pending:value.pending,
    total_inbox:value.total_inbox??state.total_inbox,capacity:value.capacity??state.capacity,
    clockOffset:value.server_time===undefined?state.clockOffset:value.server_time*1000-Date.now()};
  if(value.action==='changed')return {...next,dirty:state.received};
  if(value.action==='list'){
    const ids=new Set(value.rows.map(row=>row.id));
    return {...next,rows:value.rows.map(row=>({...row})),total:value.total,offset:value.offset,limit:value.limit,
      filter:value.filter??'all',received:true,dirty:false,
      details:Object.fromEntries(Object.entries(state.details).filter(([id])=>ids.has(id)))};
  }
  if(['delete','delete_read'].includes(value.action)||value.action==='claim'&&value.removed){
    const ids=new Set(value.deleted||[]);if(value.mail_id)ids.add(value.mail_id);
    return {...next,rows:state.rows.filter(row=>!ids.has(row.id)),dirty:true,
      details:Object.fromEntries(Object.entries(state.details).filter(([id])=>!ids.has(id)))};
  }
  if(['read','claim'].includes(value.action)){
    const mail=structuredClone(value.mail);
    return {...next,details:{...state.details,[mail.id]:mail},rows:state.rows.map(row=>row.id===mail.id?
      {...row,read:mail.read,claimed:mail.claimed,claimed_at:mail.claimed_at,expires_at:mail.expires_at}:row)};
  }
  return state;
}
