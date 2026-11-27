import {m81333ValueSha} from './m81333_skins.js';

// Only the source-complete Hải Linh cosmetic is enabled. The five other
// supplied exteriors remain staged, with their original item identity/status.
export const M81334_SKINS_SHA256='5730a6146233eaa820d0a4f987b8b766b281272d1fdb66fcd407a2077f1eccc3';
const HYDRATED_SHA256='3e4edb94bcc22160c1269c525038488caf2fc107c15633d98eb828bb172200f2';
const TANK=10000079,EXTERNAL=10651,BASE=613,ITEM=2907913;
const SPIDER='zh_CN/tank/bullet/lightning02.png';
const SPIDER_SHA='873202feade182d9c7db25b70f23a6cdc0ccaf0928d24d782c36bb4c6e7c3956';
const NPC='zh_CN/npc/si_haiyao01_pf01.swf';
const NPC_SHA='4ac6b051defd4e563b77e620226914d4ca0275f9bb16bb487c935dc69925ea68';
const loads=new Map();
const fail=message=>{throw Error(`Gói Hải Linh/Nhện M81334 chưa khớp nguồn đã kiểm tra: ${message}.`);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
  .map(value=>value.toString(16).padStart(2,'0')).join('');

export async function loadM81334Skins(url='./m81334_skins_catalog.json',{refresh=false}={}){
  if(refresh)loads.delete(url);
  if(!loads.has(url))loads.set(url,(async()=>{
    const response=await fetch(url,{cache:'no-store'});
    if(!response.ok)fail('không tải được danh mục');
    const bytes=await response.arrayBuffer(),sha256=await digest(bytes);
    if(sha256!==M81334_SKINS_SHA256)fail('hash danh mục');
    return {catalog:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),sha256,bytes:bytes.byteLength};
  })().catch(error=>{loads.delete(url);throw error;}));
  return loads.get(url);
}

async function validate(extra,pins,required){
  const target=extra?.targets?.[0];
  if(extra?.schemaVersion!==1||extra.targets.length!==1||target.tankId!==TANK
      ||target.externalId!==EXTERNAL||target.baseExternal!==BASE||target.itemId!==ITEM||target.ready!==true)
    fail('định danh tank/skin/vật phẩm');
  // Hash the hydrated graph too: resolving assetRef against another namespace
  // must fail before any live catalog writes, even if the raw JSON is genuine.
  if(await m81333ValueSha(extra)!==HYDRATED_SHA256)fail('nội dung hoặc namespace atlas');
  for(const name of required)if(!pins?.[name]||pins[name]!==extra.source.baselineCatalogSha256[name])
    fail(`phiên bản ${name}`);
  const counts={skills:7,buffs:6,exhibits:4,sceneItems:3,appearances:1,mapNPCs:1,aiNPCs:0,aiArms:0};
  for(const [name,count]of Object.entries(counts))if(Object.keys(extra.bindings[name]||{}).length!==count)
    fail(`phạm vi ${name}`);
  const dependency=target.dependency;
  if(dependency.nativeSupport!=='ready'||dependency.missing.length
      ||!same(dependency.typedIds.appearance,[EXTERNAL])||dependency.typedIds.npc.length||dependency.typedIds.arms.length)
    fail('preload ngoại hình');
  for(const logical of dependency.logicalResources){
    const asset=extra.assets[logical];
    if(!asset?.exists||!['ready','ready-derived','intentional-invisible'].includes(asset.status)
        ||!asset.url||!asset.sha256||(/\.swf$/i.test(asset.url)&&!asset.derived?.frames?.length))
      fail(`phụ thuộc ${logical}`);
  }
  const spider=extra.assets[SPIDER];
  if(extra.spider.skillId!==403100||extra.spider.exhibitId!==525||spider?.sha256!==SPIDER_SHA
      ||spider.width!==50||spider.height!==128
      ||extra.bindings.exhibits[525].resources.szBulletImage.sha256!==SPIDER_SHA)
    fail('ảnh đạn Nhện nguồn đã xoay');
  const npc=extra.assets[NPC],movie=npc?.derived;
  if(npc?.sha256!==NPC_SHA||movie?.mode!=='passive-npc-child-timeline'
      ||movie.rootFrameCount!==1||movie.childFrameCount!==192||movie.frames?.length!==192
      ||!same(movie.originalStageRect,[0,0,72,72])||!same(movie.autoCenterOffset,{x:-36,y:-36})
      ||movie.animation?.timelineDurationMs!==8000)
    fail('timeline hoặc tâm gốc của màn chắn');
}

async function guard(value,expected,label){
  if((value==null?null:await m81333ValueSha(value))!==expected)fail(`nền ${label}`);
}

function guardSpiderConsumers(catalog){
  const consumers=[];
  const references=value=>{
    if(typeof value==='string')return value===SPIDER||value==='lightning02.png';
    if(!value||typeof value!=='object')return false;
    return Object.entries(value).some(([key,child])=>
      !['derived','derivedAssets','frames','sourceBitmapAudit'].includes(key)&&references(child));
  };
  for(const table of ['skills','buffs','exhibits','sceneItems','appearances','mapNPCs','aiNPCs','aiArms'])
    for(const [id,row]of Object.entries(catalog[table]||{}))if(references(row))consumers.push(`${table}/${id}`);
  if(!same(consumers,['exhibits/525']))fail('ảnh đạn đang được bộ khác dùng');
  const skillIds=Object.entries(catalog.skills||{}).filter(([,row])=>
    row.iBulletEffectId===525||row.iChargeEffectId===525).map(([id])=>id);
  if(!same(skillIds,['403100']))fail('hiệu ứng 525 đang được kỹ năng khác dùng');
}

export async function mergeM81334Battle(catalog,extra,pins){
  await validate(extra,pins,['m6_asset_catalog.json','m81314_assets_catalog.json','m81319_tanks_catalog.json',
    'm81333_skins_catalog.json','m81333_lac_skin_catalog.json']);
  if(catalog.m81334Skins===M81334_SKINS_SHA256)return catalog;
  const tank=catalog.dependencyManifests?.tanks?.[TANK];
  await guard(tank?.baseByExternal?.[BASE],extra.guards.baseManifestSha256,'native353');
  await guard(tank?.skins?.[EXTERNAL],extra.guards.previousSkinManifestSha256,'skin10651');
  await guard(catalog.skills?.[403100],extra.guards.spiderSkillSha256,'đạn Nhện403100');
  for(const [logical,expected]of Object.entries(extra.guards.assets))
    await guard(catalog.assets[logical],expected,logical);
  for(const [table,rows]of Object.entries(extra.guards.bindings))for(const [id,expected]of Object.entries(rows))
    await guard(catalog[table]?.[id],expected,`${table}/${id}`);
  for(const [kind,rows]of Object.entries(extra.guards.runtime))for(const [id,expected]of Object.entries(rows))
    await guard(catalog.dependencyManifests.runtime[kind]?.[id],expected,`runtime/${kind}/${id}`);
  guardSpiderConsumers(catalog);
  const spiderExhibit=structuredClone(catalog.exhibits[525]);
  spiderExhibit.resources.szBulletImage=structuredClone(extra.assets[SPIDER]);
  // Existing shared assets are left byte-for-byte and descriptor-for-descriptor
  // alone. New bindings have clones from this independently hydrated namespace.
  for(const [logical,asset]of Object.entries(extra.assets))
    if(!catalog.assets[logical]||logical===SPIDER)catalog.assets[logical]=structuredClone(asset);
  for(const [table,rows]of Object.entries(extra.bindings))for(const [id,row]of Object.entries(rows)){
    catalog[table]||={};catalog[table][id]=table==='exhibits'&&id==='525'?spiderExhibit:structuredClone(row);
  }
  catalog.dependencyManifests.tanks[TANK]={...tank,skins:{...tank.skins,[EXTERNAL]:structuredClone(extra.targets[0].dependency)}};
  for(const [kind,rows]of Object.entries(extra.runtime))
    catalog.dependencyManifests.runtime[kind]={...catalog.dependencyManifests.runtime[kind],...structuredClone(rows)};
  catalog.m81334Skins=M81334_SKINS_SHA256;
  return catalog;
}

async function guardHud(hud,extra){
  await guard(hud.portraits?.[EXTERNAL],extra.guards.hudPortraitSha256,'avatar10651');
  for(const [id,expected]of Object.entries(extra.guards.hudSkills))await guard(hud.skills?.[id],expected,`HUD/${id}`);
}
function writeHud(hud,extra){
  hud.portraits[EXTERNAL]=structuredClone(extra.ui.portraits[EXTERNAL]);
  const icons=[];
  for(const [id,row]of Object.entries(extra.ui.skillIcons)){
    hud.skills[id]={...hud.skills[id],...structuredClone(row)};
    const asset=structuredClone(row.asset);
    (hud.resources||={})[row.logical]=asset;icons.push(asset);
  }
  hud.m81334Icons=icons;
  hud.m81334Skins=M81334_SKINS_SHA256;
}

export async function mergeM81334Hud(hud,extra,pins){
  await validate(extra,pins,['m7_robo_ui_catalog.json','m81314_assets_catalog.json','m81319_tanks_catalog.json',
    'm81333_lac_skin_catalog.json']);
  if(hud.m81334Skins===M81334_SKINS_SHA256)return hud;
  await guardHud(hud,extra);writeHud(hud,extra);return hud;
}

export async function mergeM81334Menus(ui,extra,pins){
  await validate(extra,pins,['m8_garage_catalog.json','m81314_assets_catalog.json','m81319_tanks_catalog.json',
    'm81333_skins_catalog.json','m81333_lac_skin_catalog.json']);
  if(ui.m81334Skins===M81334_SKINS_SHA256)return ui;
  const rows=ui.garage.skins.filter(row=>row.tankId===TANK&&row.externalId===EXTERNAL);
  if(rows.length!==1||rows[0].itemId!==ITEM)fail('vật phẩm trong kho');
  await guard(rows[0],extra.guards.skinSha256,'trạng thái item2907913');
  await guard(ui.garage.items[ITEM],extra.guards.itemSha256,'item2907913');
  await guard(ui.garage.skinAttributes[EXTERNAL],extra.guards.skinAttributesSha256,'kỹ năng skin');
  await guard(ui.panels.selectionHeads[EXTERNAL],extra.guards.selectionHeadSha256,'head gốc');
  for(const [logical,expected]of Object.entries(extra.guards.menuAssets))
    await guard(ui.resources.get(logical),expected,`menu/${logical}`);
  await guardHud(ui.hud,extra);
  // All guards have passed. No old source, item cost/name/ownership, Fire Dance
  // identity, or old/shared native kit is changed by these writes.
  writeHud(ui.hud,extra);
  for(const [logical,asset]of Object.entries(extra.assets))
    if(!ui.resources.has(logical)||logical===SPIDER)ui.resources.set(logical,structuredClone(asset));
  ui.garage.items[ITEM]={...ui.garage.items[ITEM],...structuredClone(extra.ui.itemText[ITEM])};
  ui.garage.skins=ui.garage.skins.map(row=>row.itemId===ITEM?{...row,ready:true,support:'ready',reason:''}:row);
  ui.m81334Skins=M81334_SKINS_SHA256;
  return ui;
}
