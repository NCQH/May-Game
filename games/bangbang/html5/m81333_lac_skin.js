import {m81333ValueSha} from './m81333_skins.js';

// Exact source-complete cosmetic pack. Native Lạc Long Quân keeps its387 kit;
// the server's owner-scoped presentation aliases are the only609 wire source.
export const M81333_LAC_SHA256='9d35cdc41a37545b1bc5ea1b77251e43fe32985ef7a8ec89d215f85940fbf794';
const HYDRATED_SHA256='2eb661437614930d45dc34295bd884bd994569238a56d360c5cf819ef3aeadb1';
const TANK=10000094,EXTERNAL=10689,ITEM=2909413;
const loads=new Map();
const fail=message=>{throw Error(`Skin Hàm Chúc Long chưa khớp nguồn đã kiểm tra: ${message}.`);};
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
  .map(value=>value.toString(16).padStart(2,'0')).join('');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

function bindLacCannon(part){
  const derived=part?.derived;
  // The new authored cannon has the same audited two root frame controls as
  // its native base. This is a separate source pin, never a filename fallback.
  if(part?.source?.sha256!=='7f23365e7079bfbf3a83aaf8f185808fc9f1c948c3071e735f0482b63a09ac6b'
      ||derived?.mode!=='cannon-nested'||derived.rootFrameCount!==10
      ||derived.frames?.length!==16||derived.labels?.idle!==1||derived.labels?.fire!==3
      ||derived.nativeFrameActions?.tagPayloadSha256!=='6156662a9c692c0a228960fc32f2fc7f13d5ab694f73c27e3c6ec8e6e55812b6'
      ||!same(derived.animation?.idleRootFrames,[0])
      ||!same(derived.animation?.fireRootFrames,[2,3,4,5,6,7,8])
      ||!same(derived.rootFireTransforms?.map(row=>row.y),[0,0,0,20,20,16,12,8,4,0]))
    fail('timeline pháo nguồn gốc');
  derived.rootAnimation={idleFrames:[0],fireFrames:[2,3,4,5,6,7,8],ticksPerFrame:1,
    source:'Exact source longtaizi_pf01 cannon root frames2/10 gotoAndPlay(1); independent16-frame artwork'};
}

export async function loadM81333LacSkin(url='./m81333_lac_skin_catalog.json',{refresh=false}={}){
  if(refresh)loads.delete(url);
  if(!loads.has(url))loads.set(url,(async()=>{
    const response=await fetch(url,{cache:'no-store'});
    if(!response.ok)fail('không tải được danh mục');
    const bytes=await response.arrayBuffer(),sha256=await digest(bytes);
    if(sha256!==M81333_LAC_SHA256)fail('hash danh mục');
    return {catalog:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),sha256,bytes:bytes.byteLength};
  })().catch(error=>{loads.delete(url);throw error;}));
  return loads.get(url);
}

async function validate(extra,pins,required){
  if(extra?.schemaVersion!==1||extra.tankId!==TANK||extra.externalId!==EXTERNAL||extra.itemId!==ITEM)
    fail('định danh tank/skin/vật phẩm');
  // This also catches a hydrated assetRef resolved in the wrong catalog. The
  // whole exact descriptor graph is checked before any runtime write.
  if(await m81333ValueSha(extra)!==HYDRATED_SHA256)fail('nội dung hoặc namespace atlas');
  for(const name of required)if(!pins?.[name]||pins[name]!==extra.source.baselineCatalogSha256[name])
    fail(`phiên bản ${name}`);
  const sizes={skills:13,buffs:32,exhibits:3,sceneItems:11,appearances:1,aiNPCs:0,aiArms:0,mapNPCs:0};
  for(const [name,count]of Object.entries(sizes))if(Object.keys(extra.bindings[name]||{}).length!==count)
    fail(`phạm vi ${name}`);
  if(extra.dependency.nativeSupport!=='ready'||extra.dependency.missing.length
      ||!same(extra.dependency.typedIds.appearance,[EXTERNAL]))fail('preload ngoại hình');
  for(const logical of extra.dependency.logicalResources){
    const asset=extra.assets[logical];
    if(!asset?.exists||!['ready','ready-derived','intentional-invisible'].includes(asset.status)
        ||!asset.url||!asset.sha256||(/\.swf$/i.test(asset.url)&&!asset.derived?.frames?.length))
      fail(`phụ thuộc ${logical}`);
  }
}

async function guard(value,expected,label){
  if((value==null?null:await m81333ValueSha(value))!==expected)fail(`nền ${label}`);
}

export async function mergeM81333LacBattle(catalog,extra,pins){
  await validate(extra,pins,['m6_asset_catalog.json','m81314_assets_catalog.json','m81319_tanks_catalog.json']);
  if(catalog.m81333LacSkin===M81333_LAC_SHA256)return catalog;
  const tank=catalog.dependencyManifests?.tanks?.[TANK];
  await guard(tank?.baseByExternal?.[761],extra.guards.baseManifestSha256,'native387');
  if(tank?.skins?.[EXTERNAL])fail('skin đã có trong nền');
  for(const [logical,expected]of Object.entries(extra.guards.assets))
    await guard(catalog.assets[logical],expected,logical);
  for(const [table,rows]of Object.entries(extra.guards.bindings))for(const [id,expected]of Object.entries(rows))
    await guard(catalog[table]?.[id],expected,`${table}/${id}`);
  for(const [kind,rows]of Object.entries(extra.guards.runtime))for(const [id,expected]of Object.entries(rows))
    await guard(catalog.dependencyManifests.runtime[kind]?.[id],expected,`runtime/${kind}/${id}`);
  const appearance=structuredClone(extra.bindings.appearances[EXTERNAL]);
  bindLacCannon(appearance.cannon);
  // Clone supplemental bindings so later consumers cannot mutate its pinned
  // namespace, nor the shared M14/M19 data used by menu/HUD loaders.
  for(const [logical,asset]of Object.entries(extra.assets))catalog.assets[logical]=structuredClone(asset);
  for(const [table,rows]of Object.entries(extra.bindings))for(const [id,row]of Object.entries(rows)){
    catalog[table]||={};catalog[table][id]=table==='appearances'?appearance:structuredClone(row);
  }
  catalog.dependencyManifests.tanks[TANK]={...tank,skins:{...tank.skins,[EXTERNAL]:structuredClone(extra.dependency)}};
  for(const [kind,rows]of Object.entries(extra.runtime))
    catalog.dependencyManifests.runtime[kind]={...catalog.dependencyManifests.runtime[kind],...structuredClone(rows)};
  catalog.m81333LacSkin=M81333_LAC_SHA256;
  return catalog;
}

async function guardHud(hud,extra){
  if(hud.portraits?.[EXTERNAL])fail('avatar đã có trong nền');
  for(const [id,expected]of Object.entries(extra.guards.hudSkills))await guard(hud.skills?.[id],expected,`HUD/${id}`);
}
function writeHud(hud,extra){
  hud.portraits[EXTERNAL]=structuredClone(extra.ui.portrait);
  const icons=[];
  for(const [id,row]of Object.entries(extra.ui.skillIcons)){
    hud.skills[id]={...hud.skills[id],...structuredClone(row)};
    const asset=structuredClone(row.asset);
    (hud.resources||={})[row.logical]=asset;icons.push(asset);
  }
  hud.m81333LacIcons=icons;
  hud.m81333LacSkin=M81333_LAC_SHA256;
}

export async function mergeM81333LacHud(hud,extra,pins){
  await validate(extra,pins,['m7_robo_ui_catalog.json','m81314_assets_catalog.json','m81319_tanks_catalog.json']);
  if(hud.m81333LacSkin===M81333_LAC_SHA256)return hud;
  await guardHud(hud,extra);writeHud(hud,extra);return hud;
}

export async function mergeM81333LacMenus(ui,extra,pins){
  await validate(extra,pins,['m8_garage_catalog.json','m81314_assets_catalog.json','m81319_tanks_catalog.json']);
  if(ui.m81333LacSkin===M81333_LAC_SHA256)return ui;
  const rows=ui.garage.skins.filter(row=>row.tankId===TANK&&row.externalId===EXTERNAL);
  if(rows.length!==1||rows[0].itemId!==ITEM)fail('vật phẩm trong kho');
  await guard(rows[0],extra.guards.skinSha256,'trạng thái item2909413');
  await guard(ui.garage.items[ITEM],extra.guards.itemSha256,'item2909413');
  await guard(ui.garage.skinAttributes[EXTERNAL],extra.guards.skinAttributesSha256,'kỹ năng skin');
  await guard(ui.panels.selectionHeads[EXTERNAL],extra.guards.selectionHeadSha256,'head gốc');
  for(const [logical,expected]of Object.entries(extra.guards.menuAssets))
    await guard(ui.resources.get(logical),expected,`menu/${logical}`);
  await guardHud(ui.hud,extra);
  writeHud(ui.hud,extra);
  for(const [logical,asset]of Object.entries(extra.assets))ui.resources.set(logical,structuredClone(asset));
  ui.garage.skins=ui.garage.skins.map(row=>row.itemId===ITEM?{...row,ready:true,support:'ready',reason:''}:row);
  ui.m81333LacSkin=M81333_LAC_SHA256;
  return ui;
}
