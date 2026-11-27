/** Native Sinh Tử map resources and round presentation; no client combat rules. */
export const DEATH_MAPS=Object.freeze([
  {mapId:30,mode:'death_mine',name:'Mỏ Khoáng Sụp Đổ',group:'Sinh Tử'},
  {mapId:40,mode:'death_city',name:'Thành Tận Thế',group:'Sinh Tử'},
]);
export const isDeathMap=id=>DEATH_MAPS.some(row=>row.mapId===Number(id));

export async function loadDeathCatalog(url='./m811_death_catalog.json') {
  const response=await fetch(url,{cache:'no-store'});
  if(!response.ok)throw new Error('Không tải được tài nguyên Sinh Tử.');
  return response.json();
}

export function mergeDeathCatalog(catalog,extra,baseSha256) {
  if(extra?.schemaVersion!==1||extra.source?.m6CatalogSha256!==baseSha256
      ||extra.mapChoices?.length!==2||DEATH_MAPS.some(m=>
        !extra.mapChoices.some(row=>row.mapId===m.mapId&&row.mode===m.mode)))
    throw new Error('Tài nguyên Sinh Tử không khớp client.');
  for(const [logical,resource] of Object.entries(extra.assets||{})) {
    const previous=catalog.assets[logical];
    if(resource.reuseM6) {
      const missing=resource.sha256===null&&previous?.exists===false&&previous?.status==='source_missing';
      if(!previous||(!missing&&previous.sha256!==resource.sha256))throw new Error(`Sai tài nguyên dùng chung: ${logical}`);
    } else {
      if(previous&&previous.sha256!==resource.sha256)throw new Error(`Trùng tài nguyên khác nội dung: ${logical}`);
      catalog.assets[logical]=previous||resource;
    }
  }
  for(const [table,rows] of Object.entries(extra.bindings||{})) {
    if(!['skills','buffs','exhibits','sceneItems','aiNPCs','aiArms','mapNPCs','appearances'].includes(table))
      throw new Error('Bảng Sinh Tử không hợp lệ');
    catalog[table]||={};
    for(const [id,row] of Object.entries(rows))catalog[table][id]={...catalog[table][id],...row,
      ...(row.resources?{resources:{...catalog[table][id]?.resources,...row.resources}}:{})};
  }
  for(const [id,map] of Object.entries(extra.maps||{})) {
    if(!isDeathMap(id)||catalog.maps[id])throw new Error('Bản đồ Sinh Tử trùng hoặc ngoài danh sách');
    catalog.maps[id]=map;
  }
  for(const [id,row] of Object.entries(extra.dependencies||{}))catalog.dependencyManifests.maps[id]=row;
  for(const [kind,rows] of Object.entries(extra.runtime||{})) {
    const table=catalog.dependencyManifests.runtime[kind]||={};
    for(const [id,row] of Object.entries(rows))table[id]={...table[id],...row,
      logicalResources:[...new Set([...(table[id]?.logicalResources||[]),...row.logicalResources])]};
  }
  catalog.modePresentation||={maps:{},resources:{}};
  Object.assign(catalog.modePresentation.maps,extra.hudMaps);
  Object.assign(catalog.modePresentation.resources,Object.fromEntries(
    Object.entries(extra.presentation||{}).map(([k,v])=>['death_'+k,v])));
  catalog.deathPresentation={resources:extra.presentation};
  return catalog;
}

export function deathScoreView(state) {
  if(!isDeathMap(state.mapId))return null;
  const round=state.deathRound;
  const alive=round?.alive||{};
  return {camp1:String(alive.camp1??'—'),camp2:String(alive.camp2??'—'),label:round?.number?`Vòng ${round.number}`:'Sinh Tử',
    detail:`Cúp ${state.scores.camp1??0} – ${state.scores.camp2??0}`+
      (['result','draw'].includes(round?.phase)?' · Kết thúc vòng':round?.number?` · Vòng ${round.number}`:'')};
}

export function deathBannerView(state,now,serverTimeMs) {
  if(!isDeathMap(state.mapId)||state.result)return null;
  const round=state.deathRound,self=state.actors[String(state.selfObjectId)];
  if(!round||!self)return null;
  if(round.phase==='draw'&&now-round.resultAt<5000)return {key:`draw:${round.resultAt}`,asset:null,text:'Hòa vòng · Đấu lại'};
  if(round.phase==='result'&&now-round.resultAt<5000)return {
    key:`result:${round.begin}:${round.resultAt}`,asset:round.winner===self.camp?'success_t':'fail_t',
    text:round.winner===self.camp?'Thắng vòng':'Thua vòng'};
  const elapsed=Number(serverTimeMs)-Number(round.begin)*1000;
  if(round.begin!=null&&Number.isFinite(elapsed)&&elapsed>=-4000&&elapsed<1200)return {
    key:`round:${round.begin}`,asset:elapsed<0?(round.number>=3?'roundFinal_t':`round${round.number}_t`):'start_t',
    text:elapsed<0?`Vòng ${round.number} · ${Math.max(1,Math.ceil(-elapsed/1000))}`:'Bắt đầu',
    caption:elapsed<0?String(Math.max(1,Math.ceil(-elapsed/1000))):''};
  return null;
}
