// Overlay only verified presentation fields. The 88-tank roster and all combat
// rules continue to come from the inherited catalogs and native server.
let pending;
export async function loadPvePresentation(assetCatalogSha256){
  if(!pending)pending=(async()=>{
    const response=await fetch('./m81314_presentation_catalog.json',{cache:'no-store'});
    if(!response.ok)throw new Error('Không tải được danh mục icon và skin bổ sung.');
    const bytes=await response.arrayBuffer();
    const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
      .map(value=>value.toString(16).padStart(2,'0')).join('');
    const catalog=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(catalog.schemaVersion!==1)throw new Error('Danh mục hiển thị bổ sung không hợp lệ.');
    return {catalog,sha256};
  })().catch(error=>{pending=null;throw error;});
  const result=await pending;
  if(result.catalog.source.assetCatalogSha256!==assetCatalogSha256)
    throw new Error('Danh mục icon và tài nguyên PvE không cùng phiên bản.');
  return result;
}

function readyAsset(extra,logical){
  const source=extra.assets?.[logical];
  if(!source?.exists||source.status!=='ready')throw new Error(`Icon bổ sung chưa được xác minh: ${logical}.`);
  return source;
}

export function mergePveHud(hud,extra,presentation){
  for(const [external,row] of Object.entries(extra.ui?.portraits||{})){
    // Preserve the 325 pre-existing exact HUD records, including two skins
    // that already had a portrait but previously lacked combat dependencies.
    if(!hud.portraits[external]&&['ready','ready-derived'].includes(row.status))hud.portraits[external]=row;
  }
  const icons=[];
  for(const [id,row] of Object.entries(presentation.hudSkills)){
    const asset=readyAsset(extra,row.logical);
    hud.skills[id]={...hud.skills[id],...row,asset};icons.push(asset);
  }
  hud.pveSupplementIcons=icons;
  hud.localizedText={...hud.localizedText,...extra.localizedText};
  return hud;
}

export function mergePveMenus(ui,extra,presentation){
  mergePveHud(ui.hud,extra,presentation);
  for(const [id,fields] of Object.entries(presentation.items)){
    readyAsset(extra,fields.icon);
    if(!ui.garage.items[id])throw new Error('Không thêm vật phẩm ngoài danh mục tank hiện có.');
    ui.garage.items[id]={...ui.garage.items[id],icon:fields.icon};
  }
  const skillFields=new Set(['icon','description','description2','nativeDescription','nativeDescription2']);
  for(const [key,fields] of Object.entries(presentation.skills)){
    if(!ui.garage.skills[key]||Object.keys(fields).some(field=>!skillFields.has(field)))
      throw new Error('Bổ sung hiển thị kỹ năng có trường chưa được duyệt.');
    if(fields.icon)readyAsset(extra,fields.icon);
    Object.assign(ui.garage.skills[key],fields);
  }
  for(const skin of presentation.newReadySkins){
    if(extra.supportedSkins?.[skin.tankId]?.[skin.externalId]?.status!=='ready')
      throw new Error('Skin chưa đủ tài nguyên để mở.');
    const row=ui.garage.skins.find(value=>value.tankId===skin.tankId&&value.externalId===skin.externalId);
    if(!row)throw new Error('Không thêm tank/skin ngoài danh mục kế thừa.');
    row.ready=true;row.support='ready';
  }
  for(const [external,row] of Object.entries(extra.ui?.selectionHeads||{})){
    if(row.url&&['ready','ready-derived'].includes(row.status))ui.panels.selectionHeads[external]=row;
  }
  for(const [external,row] of Object.entries(presentation.nativePortraits))
    if(!ui.presentation.portraits[external])ui.presentation.portraits[external]=row;
  ui.garage.localizedText={...ui.garage.localizedText,...extra.localizedText};
}
