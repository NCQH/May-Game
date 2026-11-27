/* Explicit shop-v1 transport. Legacy C250 cosmetic/Guild purchases stay intact. */
import {Reader,Writer} from './protocol.js';
import {encodeFrame} from './sixcube.js';
export const SHOP_REQUEST=60008,SHOP_REPLY=60009;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const integer=(value,max=0x7fffffff)=>Number.isSafeInteger(value)&&value>=0&&value<=max;
const positive=(value,max=0x7fffffff)=>integer(value,max)&&value>0;
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const text=(value,max)=>typeof value==='string'&&[...value].length<=max;
const exact=(value,keys)=>object(value)&&Object.keys(value).sort().join('|')===keys.slice().sort().join('|');
const utf8=new TextEncoder();
const assert=(value,message='Dữ liệu giao dịch cửa hàng không hợp lệ.')=>{if(!value)throw new RangeError(message);};

export function shopItemReference(item,container){
  assert(positive(container,10)&&text(item?.uuid,128)&&item.uuid.length>0&&utf8.encode(item.uuid).length<=128
    &&!/[\u0000-\u001f]/.test(item.uuid)&&positive(item.templateId,0xffffffff)&&integer(item.slotNo,32767)&&positive(item.count));
  return {container,uuid:item.uuid,template_id:item.templateId,count:item.count,slot_no:item.slotNo};
}
export function canonicalShopIntent(value){
  assert(object(value));
  if(value.kind==='buy'){
    assert(exact(value,['kind','goods_id','payment','quantity'])&&positive(value.goods_id,0xffffffff)
      &&typeof value.payment==='string'&&['primary','alternate'].includes(value.payment)&&positive(value.quantity,99));
    return {kind:'buy',goods_id:value.goods_id,payment:value.payment,quantity:value.quantity};
  }
  assert(value.kind==='open_box'&&exact(value,['kind','item'])&&exact(value.item,['container','uuid','template_id','count','slot_no']));
  const row=value.item,item=shopItemReference({uuid:row.uuid,templateId:row.template_id,count:row.count,slotNo:row.slot_no},row.container);
  return {kind:'open_box',item};
}
export function validShopProof(value){
  return exact(value,['generation','revision','expires','token'])&&typeof value.generation==='string'&&/^[a-f0-9]{32}$/.test(value.generation)
    &&hash(value.revision)&&hash(value.token)&&positive(value.expires,Number.MAX_SAFE_INTEGER);
}
export function encodeShopRequest(action,request_id,operation_id,values={}){
  assert(['preview','apply','status'].includes(action)&&id(request_id)&&id(operation_id));
  const data={v:1,request_id,operation_id,action};
  if(action!=='status')data.intent=canonicalShopIntent(values.intent);
  if(action==='apply'){assert(validShopProof(values.proof));data.proof={...values.proof};}
  const raw=JSON.stringify(data);assert(utf8.encode(raw).length<=32768,'Giao dịch vượt giới hạn dữ liệu.');
  return encodeFrame(SHOP_REQUEST,new Writer().string(raw).finish());
}
function validReward(row){
  return object(row)&&text(row.kind,64)&&row.kind.length>0&&positive(row.id,0xffffffff)&&text(row.name,500)
    &&positive(row.quantity)&&text(row.category,100)&&(row.container===undefined||integer(row.container,255));
}
const rewards=value=>Array.isArray(value)&&value.length<=256&&value.every(validReward);
export function validShopQuote(value){
  if(!object(value)||!['buy','open_box'].includes(value.kind)||value.policy!=='all_or_nothing'
    ||!positive(value.profile_id,0xffffffff)||!positive(value.item_id,0xffffffff)||!text(value.name,500)||!positive(value.quantity,99))return false;
  if(value.kind==='buy')return positive(value.goods_id,0xffffffff)&&['primary','alternate'].includes(value.payment)
    &&[1,2,3].includes(value.coin_type)&&integer(value.unit_price)&&integer(value.total_price)
    &&value.total_price===value.unit_price*value.quantity&&rewards(value.rewards)&&value.rewards.length>0;
  const box=value.box;
  if(value.quantity!==1||!object(box)||!text(box.duplicate_policy,2000))return false;
  if(box.mode==='fixed')return rewards(box.fixed_rewards)&&box.fixed_rewards.length>0;
  return box.mode==='random'&&box.main_percent===10&&box.material_percent===90&&rewards(box.main_rewards)
    &&box.main_rewards.length>0&&rewards(box.material_rewards)&&box.material_rewards.length>0;
}
export function validShopReceipt(value){
  return object(value)&&id(value.operation_id)&&positive(value.profile_id,0xffffffff)&&hash(value.intent_hash)
    &&positive(value.committed_at,Number.MAX_SAFE_INTEGER)&&validShopQuote(value.quote)&&value.quote.profile_id===value.profile_id
    &&rewards(value.rewards)&&value.rewards.length>0&&['purchase','main','material','fixed'].includes(value.outcome)
    &&(value.quote.kind==='buy'?value.outcome==='purchase':value.outcome!=='purchase');
}
export function decodeShopPacket({msgId,payload}){
  if(msgId!==SHOP_REPLY)return null;
  assert(payload?.byteLength<=60002);
  const reader=new Reader(payload,msgId),value=JSON.parse(reader.string());
  assert(reader.remaining===0&&object(value)&&value.v===1&&typeof value.ok==='boolean'&&integer(value.profile_id,0xffffffff));
  if(!value.ok)assert(text(value.request_id,64)&&text(value.operation_id,64)&&text(value.action,20)&&object(value.error)
    &&text(value.error.code,100)&&text(value.error.message,2000)&&typeof value.error.not_committed==='boolean');
  else{
    assert(id(value.request_id)&&id(value.operation_id)&&['preview','apply','status'].includes(value.action)&&value.profile_id>0);
    if(value.status==='preview')assert(value.action==='preview'&&hash(value.intent_hash)&&validShopProof(value.proof)
      &&validShopQuote(value.quote)&&value.quote.profile_id===value.profile_id);
    else if(value.status==='committed')assert(validShopReceipt(value.receipt)
      &&value.receipt.operation_id===value.operation_id&&value.receipt.profile_id===value.profile_id);
    else assert(value.action==='status'&&value.status==='not_committed'&&value.receipt===null);
  }
  return {msgId,type:'normalShop',normalShop:value};
}
export function stableShopText(value){
  if(Array.isArray(value))return '['+value.map(stableShopText).join(',')+']';
  if(object(value))return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stableShopText(value[key])).join(',')+'}';
  return JSON.stringify(value);
}
export async function shopIntentHash(intent){
  const raw=utf8.encode(stableShopText(canonicalShopIntent(intent)));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',raw))].map(value=>value.toString(16).padStart(2,'0')).join('');
}
export function shopQuoteMatchesIntent(quote,intent){
  if(!validShopQuote(quote))return false;
  return quote.kind===intent.kind&&(intent.kind==='buy'?quote.goods_id===intent.goods_id&&quote.payment===intent.payment
    &&quote.quantity===intent.quantity:quote.item_id===intent.item.template_id&&quote.quantity===1);
}
