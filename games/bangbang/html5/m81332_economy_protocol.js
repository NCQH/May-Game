/* M32 explicit HTML5 economy-v1. Native C151/C156/C162 and Flash stay intact. */
import {Reader,Writer} from './protocol.js';
import {encodeFrame} from './sixcube.js';
export const ECONOMY_REQUEST=60004,ECONOMY_REPLY=60005;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const integer=(v,max=0x7fffffff)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(v);
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const text=(v,max)=>typeof v==='string'&&[...v].length<=max;
const utf8=new TextEncoder();
const assert=(v,message='Dữ liệu giao dịch kho không hợp lệ.')=>{if(!v)throw new RangeError(message);};
export function economyReference(item,container,quantity){
  assert(item&&[2,3,5].includes(container)&&text(item.uuid,128)&&item.uuid.length>0
    &&utf8.encode(item.uuid).length<=128&&!/[\u0000-\u001f]/.test(item.uuid)
    &&integer(item.templateId,0xffffffff)&&item.templateId>0&&integer(item.slotNo,32767)
    &&integer(item.count)&&item.count>0);
  const value={container,uuid:item.uuid,template_id:item.templateId,count:item.count,slot_no:item.slotNo};
  if(quantity!==undefined){assert(integer(quantity)&&quantity>0&&quantity<=item.count);value.quantity=quantity;}
  return value;
}
export function canonicalEconomyIntent(value){
  assert(object(value)&&['sell','dismantle','feed'].includes(value.kind));
  const reference=(row,quantity)=>{
    assert(object(row));
    const copy=economyReference({uuid:row.uuid,templateId:row.template_id,count:row.count,slotNo:row.slot_no},row.container,
      quantity?row.quantity:undefined);
    assert(Object.keys(row).sort().join('|')===Object.keys(copy).sort().join('|'));
    return copy;
  };
  const codepointCompare=(left,right)=>{const a=[...left],b=[...right];for(let i=0;i<Math.min(a.length,b.length);i++){
    const delta=a[i].codePointAt(0)-b[i].codePointAt(0);if(delta)return delta;}return a.length-b.length;};
  const ordered=rows=>rows.sort((a,b)=>a.container-b.container||a.slot_no-b.slot_no||codepointCompare(a.uuid,b.uuid));
  if(value.kind==='feed'){
    assert(['chips|exp|helper|kind|level','chips|discard_exp|exp|helper|kind|level'].includes(Object.keys(value).sort().join('|'))&&Array.isArray(value.chips)&&value.chips.length<=135
      &&integer(value.level,255)&&integer(value.exp));
    if('discard_exp' in value)assert(integer(value.discard_exp)&&value.discard_exp>0);
    const helper=reference(value.helper,false),chips=value.chips.map(row=>reference(row,false));
    assert(helper.container===5&&chips.every(row=>row.container===3)
      &&new Set(chips.map(row=>row.uuid)).size===chips.length&&new Set(chips.map(row=>row.template_id)).size<=1);
    return {kind:value.kind,helper,chips:ordered(chips),level:value.level,exp:value.exp,...('discard_exp' in value?{discard_exp:value.discard_exp}:{})};
  }
  assert(Object.keys(value).sort().join('|')==='items|kind'&&Array.isArray(value.items)&&value.items.length>0&&value.items.length<=135);
  const items=value.items.map(row=>reference(row,true));
  assert(new Set(items.map(row=>row.uuid)).size===items.length&&items.every(row=>value.kind==='sell'
    ?[2,3].includes(row.container):row.container===5&&row.quantity===1));
  return {kind:value.kind,items:ordered(items)};
}
export function encodeEconomyRequest(action,request_id,operation_id,values={}){
  assert(['preview','apply','status'].includes(action)&&id(request_id)&&id(operation_id));
  const data={v:1,request_id,action,operation_id};
  if(action!=='status')data.intent=canonicalEconomyIntent(values.intent);
  if(action==='apply'){assert(validProof(values.proof));data.proof={...values.proof};}
  const raw=JSON.stringify(data);assert(utf8.encode(raw).length<=32768,'Danh sách quá lớn cho một giao dịch.');
  return encodeFrame(ECONOMY_REQUEST,new Writer().string(raw).finish());
}
function validProof(p){return object(p)&&typeof p.generation==='string'&&/^[a-f0-9]{32}$/.test(p.generation)
  &&hash(p.revision)&&hash(p.token)&&integer(p.expires,Number.MAX_SAFE_INTEGER)&&p.expires>0;}
function validQuote(q){
  if(!object(q)||!['sell','dismantle','feed'].includes(q.kind)||q.currency!=='cash'||q.policy!=='all_or_nothing'
    ||!integer(q.gold_xu)||!integer(q.profile_id,0xffffffff)||!integer(q.unit_price,10)
    ||!Array.isArray(q.items)||q.items.length>135||!q.items.every(row=>object(row)&&[2,3,5].includes(row.container)
      &&text(row.uuid,128)&&row.uuid.length>0&&integer(row.template_id,0xffffffff)&&row.template_id>0
      &&integer(row.slot_no,32767)&&integer(row.count)&&row.count>0&&integer(row.quantity)&&row.quantity>0
      &&row.quantity<=row.count&&text(row.name,300)))return false;
  if(q.kind==='feed')return text(q.helper_uuid,128)&&q.helper_uuid.length>0&&text(q.helper_name,300)
    &&['previous_level','current_level','cap'].every(key=>integer(q[key],255))&&q.current_level===q.previous_level+1
    &&q.current_level<=q.cap&&['previous_exp','current_exp','exp_threshold','chip_exp','required_count','next_exp_threshold'].every(key=>integer(q[key]))
    &&(!('discarded_exp' in q)||integer(q.discarded_exp))
    &&integer(q.available_count,Number.MAX_SAFE_INTEGER)&&q.gold_xu===0&&q.unit_price===0
    &&q.items.every(row=>row.container===3)&&q.items.reduce((n,row)=>n+row.quantity,0)===q.required_count;
  const unit=q.kind==='sell'?1:10;
  return q.unit_price===unit&&q.items.length>0&&q.items.every(row=>q.kind==='sell'?[2,3].includes(row.container):row.container===5&&row.quantity===1)
    &&q.gold_xu===q.items.reduce((n,row)=>n+row.quantity*unit,0);
}
function validReceipt(r){return object(r)&&id(r.operation_id)&&integer(r.profile_id,0xffffffff)&&hash(r.intent_hash)
  &&integer(r.committed_at,Number.MAX_SAFE_INTEGER)&&validQuote(r.quote)&&r.quote.profile_id===r.profile_id;}
export function decodeEconomyPacket({msgId,payload}){
  if(msgId!==ECONOMY_REPLY)return null;
  const reader=new Reader(payload,msgId),value=JSON.parse(reader.string());
  assert(reader.remaining===0&&object(value)&&value.v===1&&typeof value.ok==='boolean'&&integer(value.profile_id,0xffffffff));
  if(!value.ok)assert(text(value.request_id,64)&&text(value.operation_id,64)&&text(value.action,20)&&object(value.error)
    &&text(value.error.code,100)&&text(value.error.message,2000)&&typeof value.error.not_committed==='boolean');
  else{
    assert(id(value.request_id)&&id(value.operation_id)&&['preview','apply','status'].includes(value.action));
    if(value.status==='preview')assert(value.action==='preview'&&validProof(value.proof)&&validQuote(value.quote)&&value.quote.profile_id===value.profile_id);
    else if(value.status==='committed')assert(validReceipt(value.receipt)&&value.receipt.operation_id===value.operation_id&&value.receipt.profile_id===value.profile_id);
    else assert(value.action==='status'&&value.status==='not_committed'&&value.receipt===null);
  }
  return {msgId,type:'economy',economy:value};
}
export function stableEconomyText(value){
  if(Array.isArray(value))return '['+value.map(stableEconomyText).join(',')+']';
  if(object(value))return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stableEconomyText(value[key])).join(',')+'}';
  return JSON.stringify(value);
}
export async function economyIntentHash(intent){
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',utf8.encode(stableEconomyText(canonicalEconomyIntent(intent)))))]
    .map(b=>b.toString(16).padStart(2,'0')).join('');
}
