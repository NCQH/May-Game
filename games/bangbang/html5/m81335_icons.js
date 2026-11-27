// Reviewed item artwork only. No item/skin is added or unlocked by this module.
// Source IDs are matched to HTML5 tank+exterior identities, not copied as keys.
export const M81335_ICONS_SHA256='281191ced394273bf0b25d771ece60cb778917cda60489742b278158cfcd0489';
const VALUE_SHA256='d158f0b4fccb79dc0505a06f315c25009e29e6a98314e4a8cf3257b108ae0fb0';
const SOURCE_SHA256='23d1b846b35367e5c91b25e048cabc72bccdf5ea5e397763be6f80868d646554';
const loads=new Map();
const hex=value=>/^[a-f0-9]{64}$/.test(value||'');
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
  .map(value=>value.toString(16).padStart(2,'0')).join('');
const fail=reason=>{throw new Error(`Icon M35 không khớp nguồn đã đối chiếu: ${reason}.`);};

export async function validateM81335Icons(extra){
  if(extra?.schemaVersion!==1||extra.release!=='M81335'||extra.source?.zipSha256!==SOURCE_SHA256
      ||extra.source.liveRevision!=='135cd8ada880'||!hex(extra.source.m8GarageCatalogSha256))fail('nguồn');
  if(await digest(new TextEncoder().encode(JSON.stringify(ordered(extra))))!==VALUE_SHA256)fail('hash cấu trúc');
  if(Object.keys(extra.items||{}).length!==65||Object.keys(extra.assets||{}).length!==64
      ||Object.keys(extra.sharedNonSkinConsumers||{}).length!==120)fail('số mục');
  for(const [logical,asset]of Object.entries(extra.assets)){
    if(!/^zh_CN\/icon\/item\/[^/]+\.png$/.test(logical)||asset.logical!==logical
        ||asset.format!=='webp'||!asset.exists||asset.status!=='ready'||asset.fit!=='contain'
        ||!/^\/html5\/assets\/m81335\/icons\/[a-zA-Z0-9_./-]+\.webp$/.test(asset.url||'')
        ||asset.url.includes('..')||!hex(asset.sha256)||!(asset.bytes>0)
        ||!(asset.width>1)||!(asset.height>1))fail(logical);
    if(asset.animation){
      if(logical!=='zh_CN/icon/item/yadianna_pf_lock11.png'||asset.width!==100||asset.height!==100
          ||asset.animation.frames!==12||asset.animation.durationMs!==1000
          ||asset.stillUrl!==asset.stillAsset?.url||asset.sourceTimeline?.fps!==24)fail('hoạt ảnh Athena');
    }
  }
  for(const [id,row]of Object.entries(extra.items)){
    const keys=['itemId','tankId','allowedExternalIds','icon','expectedBeforeIcon','expectedType','expectedContainerType','expectedQuality'];
    if(String(row.itemId)!==id||row.tankId===10000068||id==='2900121'
        ||Object.keys(row).some(key=>!keys.includes(key))||!extra.assets[row.icon]
        ||!Array.isArray(row.allowedExternalIds)||!row.allowedExternalIds.length
        ||row.allowedExternalIds.some(value=>!Number.isInteger(value)||value===685||value===686))fail(`vật phẩm ${id}`);
  }
  for(const [id,row]of Object.entries(extra.sharedNonSkinConsumers)){
    if(String(row.itemId)!==id||row.type===29||extra.items[id]||!extra.assets[row.icon]
        ||Object.keys(row).some(key=>!['itemId','icon','type','containerType','quality'].includes(key)))fail(`mục dùng chung ${id}`);
  }
  return extra;
}

export async function loadM81335Icons(url='./m81335_icons_catalog.json',{refresh=false}={}){
  if(refresh)loads.delete(url);
  if(!loads.has(url))loads.set(url,(async()=>{
    const response=await fetch(url,{cache:'no-store'});
    if(!response.ok)fail('không tải được danh mục');
    const bytes=await response.arrayBuffer(),sha256=await digest(bytes);
    if(sha256!==M81335_ICONS_SHA256)fail('hash tệp');
    const catalog=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    await validateM81335Icons(catalog);
    return {catalog,sha256,bytes:bytes.byteLength};
  })().catch(error=>{loads.delete(url);throw error;}));
  return loads.get(url);
}

export async function mergeM81335IconsMenus(ui,extra,pins){
  await validateM81335Icons(extra);
  if(pins?.['m8_garage_catalog.json']!==extra.source.m8GarageCatalogSha256)fail('bản nền gara');
  if(ui.m81335Icons===M81335_ICONS_SHA256)return ui;
  // Complete validation before any mutation. Keep ItemTemplate economics,
  // native names, quality, ownership, readiness, and all skill tables untouched.
  for(const [id,row]of Object.entries(extra.items)){
    const item=ui.garage?.items?.[id];
    const skin=ui.garage?.skins?.find(value=>value.itemId===row.itemId&&value.tankId===row.tankId);
    if(!item||item.itemId!==row.itemId||item.icon!==row.expectedBeforeIcon||!skin
        ||!row.allowedExternalIds.includes(skin.externalId)
        ||item.reuse?.iReuseA!==row.tankId||!row.allowedExternalIds.includes(item.reuse?.iReuseB)
        ||item.reuse.iReuseB!==skin.externalId
        ||item.type!==row.expectedType||item.containerType!==row.expectedContainerType
        ||item.quality!==row.expectedQuality)fail(`cặp tank/skin của item ${id}`);
  }
  for(const [id,row]of Object.entries(extra.sharedNonSkinConsumers)){
    const item=ui.garage?.items?.[id];
    if(!item||Object.entries(row).some(([key,value])=>item[key]!==value))fail(`vật phẩm dùng chung icon ${id}`);
  }
  for(const [logical,asset]of Object.entries(extra.assets))ui.resources.set(logical,structuredClone(asset));
  ui.m81335Icons=M81335_ICONS_SHA256;
  return ui;
}
