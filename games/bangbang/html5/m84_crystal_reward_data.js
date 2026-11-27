/** Data-only binding for the two audited crystal reward movies.
 * The root scripts, artwork, names, alpha, transforms and timeline stay intact.
 * Only the first placement's empty holder symbol is replaced by a pre-embedded
 * original crystal icon. No packet, result, random choice or gameplay is made.
 */
const HOLDER_DEPTHS=Object.freeze([79,93,107,121,135]);

export function crystalRewardItems(packet,catalog) {
  if(packet?.type!=='settleAward'||packet.kind!==19)return [];
  const group=packet.award?.groups?.[0];
  if(group?.type!==0||!Array.isArray(group.items))return [];
  return group.items.filter(row=>catalog?.items?.[row.itemId]&&Number.isInteger(row.count)&&row.count>0)
    .slice(0,5).map(row=>({itemId:Number(row.itemId),count:row.count}));
}

export function bindCrystalRewardIcons(input,rows,catalog) {
  if(!Array.isArray(rows)||rows.length<1||rows.length>5)throw new Error('Invalid crystal reward count.');
  const data=new Uint8Array(input).slice(),view=new DataView(data.buffer);
  if(String.fromCharCode(...data.subarray(0,3))!=='FWS'||view.getUint32(4,true)!==data.length)
    throw new Error('Invalid crystal reward movie.');
  const rectBits=data[8]>>3;
  let at=8+Math.ceil((5+4*rectBits)/8)+4;
  const offsets=new Map();
  while(at+2<=data.length) {
    const value=view.getUint16(at,true);at+=2;
    const code=value>>6;let size=value&63;
    if(size===63){if(at+4>data.length)throw new Error('Truncated crystal tag.');size=view.getUint32(at,true);at+=4;}
    if(at+size>data.length)throw new Error('Truncated crystal tag.');
    if(code===26&&size>=5&&(data[at]&2)) {
      const depth=view.getUint16(at+1,true),symbol=view.getUint16(at+3,true);
      if(HOLDER_DEPTHS.includes(depth)&&symbol===52&&!offsets.has(depth))offsets.set(depth,at+3);
    }
    at+=size;
    if(code===0)break;
  }
  if(offsets.size!==5)throw new Error('Crystal reward holder contract changed.');
  rows.forEach((row,index)=>{
    const icon=catalog?.icons?.[row.itemId];
    const id=icon?.symbolId;
    if(!Number.isInteger(id)||id<50002||id>50158||(id-50002)%3!==0)
      throw new Error('Unsupported crystal reward icon.');
    view.setUint16(offsets.get(HOLDER_DEPTHS[index]),id,true);
  });
  return data;
}

/** CMovieClipLite replays before the terminal frame becomes visible. */
export function crystalQualityFrame(ticks,resource) {
  const n=Number(resource?.cycleFrames);
  return Number.isInteger(n)&&n>0?Math.max(0,Math.floor(ticks))%n:0;
}
