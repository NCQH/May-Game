/* Native Booster/Chapter wire contracts from the supplied Python handlers and
 * CITY_INFO / Request*Booster AS3. No ownership, costs, rolls or unlocks here. */
import {Reader,Writer} from './protocol.js';
import {encodeFrame} from './sixcube.js';

export const PVE_MAP_IDS=Object.freeze([201,204,205,203,206,211,212,213,401,402,403,
  404,405,406,301,302,303,701,702,703,304,305,306,501,502,503,504,505,506,
  601,602,603,30101,30102,30103,31201,31202,31203,31301,31302,31303,
  31401,31402,31403,31501,31502,31503,31601,31602]);
export const isPveMap=value=>PVE_MAP_IDS.includes(Number(value));
// Native CityTemplate nHeroMapId pairs. Requests use these IDs, while the
// offline server acknowledges the existing normal scene geometry. Keep the
// 49-map asset/renderer allowlist above unchanged. Chapter one has no hard IDs.
export const PVE_HARD_TO_NORMAL=Object.freeze({
  5211:211,5212:212,5213:213,5401:401,5402:402,5403:403,5404:404,5405:405,5406:406,
  5301:301,5302:302,5303:303,5701:701,5702:702,5703:703,5304:304,5305:305,5306:306,
  5501:501,5502:502,5503:503,5504:504,5505:505,5506:506,5601:601,5602:602,5603:603,
  31101:30101,31102:30102,31103:30103,32201:31201,32202:31202,32203:31203,
  32301:31301,32302:31302,32303:31303,32401:31401,32402:31402,32403:31403,
  32501:31501,32502:31502,32503:31503,32601:31601,32602:31602,
});
const hardByNormal=Object.freeze(Object.fromEntries(Object.entries(PVE_HARD_TO_NORMAL)
  .map(([hard,normal])=>[normal,Number(hard)])));
export const pveNormalMapId=value=>isPveMap(value)?Number(value):PVE_HARD_TO_NORMAL[Number(value)]||0;
export const pveHardMapId=value=>hardByNormal[Number(value)]||0;
export const isPveRequestMap=value=>pveNormalMapId(value)!==0;
const frame=(id,writer)=>encodeFrame(id,writer.finish());
const slot=value=>{if(!Number.isInteger(value)||value<0||value>=135)throw new RangeError('Ô trợ thủ/nguyên liệu không hợp lệ.');return value;};
const map=value=>{if(!Number.isInteger(value)||!isPveRequestMap(value))throw new RangeError('Màn PvE chưa được hỗ trợ.');return value;};
export function encodeEquipCompanion(uuid){
  if(typeof uuid!=='string'||!uuid||new TextEncoder().encode(uuid).length>200)throw new TypeError('UUID trợ thủ không hợp lệ.');
  return frame(166,new Writer().string(uuid));
}
export const encodeFeedCompanion=(pet,chip)=>frame(156,new Writer().i16(slot(pet)).i32(slot(chip)));
export const encodeStrengthenCompanion=pet=>frame(157,new Writer().i16(slot(pet)));
export function encodeRankCompanion(pet,materials=[]){
  if(!Array.isArray(materials)||materials.length>3)throw new RangeError('Chỉ chọn tối đa ba liều tăng tỷ lệ.');
  const w=new Writer().i16(slot(pet)).u16(materials.length);
  for(const material of materials)w.i16(slot(material));
  return frame(158,w);
}
export function encodeTransferCompanion(pet,other){
  if(pet===other)throw new RangeError('Cần hai trợ thủ khác nhau.');
  return frame(159,new Writer().i16(slot(pet)).i16(slot(other)));
}
export const encodeEnterPve=mapId=>frame(304,new Writer().u32(map(mapId)));
export const encodePveRecord=mapId=>frame(558,new Writer().u32(map(mapId)));
// Native RequestBuyThew. Offline policy is one pack: 100 thew for 1 Xu.
// COIN_CASH=1 is Xu; COIN_GOLDEN=2 is Bạc in this Flash client.
export const encodeBuyThew=()=>frame(78,new Writer().u16(1).u32(1).i32(1));

export function decodePvePacket({msgId,payload}){
  if(![1027,1056,1106,1303,1304,1516].includes(msgId))return null;
  const r=new Reader(payload,msgId),byteLength=r.bytes.length;
  let result;
  if(msgId===1027){
    result={type:'pveThew',thew:r.i32(),thewBuy:r.i32(),thewVip:r.i32()};
    if([result.thew,result.thewBuy,result.thewVip].some(value=>value<0||value>32767))
      throw new RangeError('Thể lực nằm ngoài giới hạn native CHAR_BASIC.');
  }else if(msgId===1056)result={type:'companionActive',uuid:r.string()};
  else if(msgId===1106){
    result={type:'companionOperation',action:r.u32(),success:r.u8(),code:r.u32(),
      uuid:r.string(),previousValue:r.i32(),currentValue:r.i32()};
    if(![31,32,33,34].includes(result.action)||![0,1].includes(result.success))
      throw new RangeError('Kết quả trợ thủ không đúng hợp đồng native.');
  }else if(msgId===1303||msgId===1304){
    result={type:'pveCities',replace:msgId===1303,cities:r.vector(18,p=>({
      cityId:p.u32(),flags:p.u32(),grade:p.u8(),hardGrade:p.u8(),hardPasses:p.u32(),resetTime:p.u32()}))};
    if(result.cities.length>52||new Set(result.cities.map(c=>c.cityId)).size!==result.cities.length)
      throw new RangeError('Danh sách chương bị trùng hoặc vượt giới hạn.');
  }else{
    const mapId=r.u32(),passTime=r.u32(),useTime=r.u32(),count=r.u16();
    // Current native server explicitly implements the empty-record branch only.
    // Do not fabricate a ranking or pretend to understand absent RECORD_BRIEFs.
    if(count!==0)throw new RangeError('Kỷ lục PvE có dữ liệu chưa được hỗ trợ.');
    result={type:'pveRecord',mapId,passTime,useTime,records:[],nativeStatus:r.u8()};
  }
  const decodedBytes=r.offset,tail=r.rest();
  return {msgId,...result,byteLength,decodedBytes,tail,trailingBytes:tail.length};
}
