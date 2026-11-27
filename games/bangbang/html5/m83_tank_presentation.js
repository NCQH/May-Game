/** Current TankLib InitTankAvatarProxy + AvatarLite. A missing custom halo is
 * not replaced by the master halo: the original item lookup also returns empty.
 */
export function nativeTankHalo(catalog,tank={},options={}) {
  if(options.clearEffect)return null;
  const level=Number(tank.level??tank.tankLevel??options.level??1);
  const custom=Number(tank.haloId??tank.halo_id??options.haloId??0);
  const master=level===Number(catalog?.rules?.masterLevel)||Boolean(options.forceMasterHalo);
  const id=custom||(master?Number(catalog?.rules?.masterHaloItemId):0);
  return id?(catalog?.halos?.[String(id)]||null):null;
}

/** AvatarLite.addMcBody centers using LoaderInfo dimensions before adding the
 * movie at its native origin. The expanded viewing canvas adds no new scale.
 */
export function nativePortraitViewport(record) {
  if(!record?.viewport)return null;
  const [x0,y0,x1,y1]=record.viewport,offset=record.bodyOffset||[0,0];
  return {left:x0+offset[0],top:y0+offset[1],width:x1-x0,height:y1-y0,
    fallbackLeft:-x0,fallbackTop:-y0};
}

function nativeActivePeriod(period,serverSeconds) {
  if(!period)return true;
  if(!Number.isFinite(serverSeconds))return false;
  // CTime.changeTimeToUtc constructs a local Date from numeric fields.
  const date=text=>{const parts=String(text||'').trim().split(/[- :]/).map(Number);
    return parts.length===6?new Date(parts[0],parts[1]-1,parts[2],parts[3],parts[4],parts[5]).getTime()/1000:NaN;};
  const [start,end]=period.split('#');
  return serverSeconds>date(start)&&serverSeconds<date(end);
}

/** TankSkinUtil.getRecommendSkinId / hasSkinAttrActive. This is presentation
 * only; it grants no item, skin bonus, or equipment action.
 */
export function nativeGarageSkinState(presentation,catalog,tank,meta,serverSeconds) {
  const rows=presentation?.skinCandidates?.[String(tank.tankId)]||[];
  const owned=new Set((meta.containers?.['6']?.items||[]).filter(item=>item.count>0).map(item=>Number(item.templateId)));
  const available=rows.filter(row=>owned.has(row.itemId)||nativeActivePeriod(row.activePeriod,serverSeconds));
  const baseExternal=catalog.levels?.[`${tank.tankId}:${tank.level}`]?.externalId;
  if(baseExternal)available.push({externalId:baseExternal,weight:presentation?.skinWeights?.[baseExternal]??null});
  // Match sortTankSkin's handling of absent attribute rows, including source order.
  const recommend=available.filter(row=>row.weight==null||row.weight>1).sort((a,b)=>{
    if(a.weight==null)return 1;if(b.weight==null)return -1;
    return a.weight===b.weight?(a.externalId>b.externalId?-1:1):(a.weight>b.weight?-1:1);
  })[0];
  const active=new Set(rows.filter(row=>owned.has(row.itemId)&&nativeActivePeriod(row.activePeriod,serverSeconds)).map(row=>row.quality));
  const qualities=new Set(rows.map(row=>row.quality));
  return {recommendedExternalId:recommend?.externalId||0,activeQualities:active,qualities,
    frameTip:active.size>=3&&active.has(5)?presentation.texts.orangeFrame:
      active.size>=2?presentation.texts.purpleFrame:''};
}
