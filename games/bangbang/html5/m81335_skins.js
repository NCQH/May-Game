import {m81333ValueSha} from './m81333_skins.js';

// Cosmetic presentation only, pinned to exact M34. This module has no network
// mutation, player database, pricing, ownership, or native combat authority.
export const M81335_SKINS_SHA256='387cdd7107272d7a14d79f45532553578d104c1f574a24c6091062c34813c9fc';
const HYDRATED_SHA256='aaffb5badcdf8764332787984690a059d04aee2238fb8c7c058139dd336f20b5';
const SOURCE_SHA256='23d1b846b35367e5c91b25e048cabc72bccdf5ea5e397763be6f80868d646554';
const TARGETS=[{"tankId":10000038,"externalId":10380,"itemId":2903813,"kind":"newGeometry"},{"tankId":10000040,"externalId":10400,"itemId":2904014,"kind":"newGeometry"},{"tankId":10000067,"externalId":10718,"itemId":2906714,"kind":"alias"},{"tankId":10000067,"externalId":10719,"itemId":2906715,"kind":"alias"},{"tankId":10000047,"externalId":10716,"itemId":2904714,"kind":"alias"},{"tankId":10000048,"externalId":10720,"itemId":2904813,"kind":"alias"},{"tankId":10000075,"externalId":10723,"itemId":2907515,"kind":"alias"},{"tankId":10000051,"externalId":10636,"itemId":2905122,"kind":"druid"},{"tankId":10000107,"externalId":866,"itemId":2970212,"kind":"hikari"},{"tankId":10000074,"externalId":3007415,"itemId":2907415,"kind":"fire"}];
const COUNTS={"skills":25,"buffs":86,"exhibits":17,"sceneItems":5,"appearances":10,"aiNPCs":0,"aiArms":0,"mapNPCs":0};
const loads=new Map();
const fail=reason=>{throw Error(`Skin M81335 không khớp nguồn đã đối chiếu: ${reason}.`);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
  .map(value=>value.toString(16).padStart(2,'0')).join('');

export async function loadM81335Skins(url='./m81335_skins_catalog.json',{refresh=false}={}){
  if(refresh)loads.delete(url);
  if(!loads.has(url))loads.set(url,(async()=>{
    const response=await fetch(url,{cache:'no-store'});
    if(!response.ok)fail('không tải được danh mục');
    const bytes=await response.arrayBuffer(),sha256=await digest(bytes);
    if(sha256!==M81335_SKINS_SHA256)fail('hash danh mục');
    return{catalog:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),sha256,bytes:bytes.byteLength};
  })().catch(error=>{loads.delete(url);throw error;}));
  return loads.get(url);
}

async function validate(extra,pins,required){
  if(extra?.schemaVersion!==1||extra.source?.inputZipSha256!==SOURCE_SHA256
      ||extra.source.excludesRazor!==true||extra.source.cosmeticOnly!==true
      ||!same(extra.targets?.map(({tankId,externalId,itemId,kind})=>({tankId,externalId,itemId,kind})),TARGETS))
    fail('nguồn hoặc phạm vi');
  if(await m81333ValueSha(extra)!==HYDRATED_SHA256)fail('nội dung hoặc namespace atlas');
  for(const name of required)if(!pins?.[name]||pins[name]!==extra.source.baselineCatalogSha256[name])
    fail(`phiên bản ${name}`);
  for(const[table,count]of Object.entries(COUNTS))if(Object.keys(extra.bindings[table]||{}).length!==count)
    fail(`phạm vi ${table}`);
  for(const target of extra.targets){
    if(target.tankId===10000068||[685,686].includes(target.externalId)||target.ready!==true
        ||target.dependency.nativeSupport!=='ready'||target.dependency.missing.length
        ||target.dependency.tankId!==target.tankId||target.dependency.externalId!==target.externalId)
      fail(`định danh ${target.externalId}`);
    for(const logical of target.dependency.logicalResources){
      const asset=extra.assets[logical];
      if(!asset?.exists||!['ready','ready-derived','intentional-invisible'].includes(asset.status)
          ||!asset.url||!asset.sha256||(/\.swf$/i.test(asset.url)&&!asset.derived?.frames?.length))
        fail(`phụ thuộc ${logical}`);
    }
  }
  for(const item of Object.values(extra.ui.items))if(item.type!==29||item.containerType!==6
      ||item.reuse?.iReuseA===10000068||!extra.targets.some(t=>t.itemId===item.itemId
        &&t.externalId===item.reuse.iReuseB&&t.tankId===item.reuse.iReuseA))fail(`vật phẩm ${item.itemId}`);
}
async function guard(value,expected,label){
  if((value==null?null:await m81333ValueSha(value))!==expected)fail(`nền ${label}`);
}
const battlePins=['m6_asset_catalog.json','m81314_assets_catalog.json','m81319_tanks_catalog.json',
  'm81333_skins_catalog.json','m81333_lac_skin_catalog.json','m81334_skins_catalog.json'];
const hudPins=['m7_robo_ui_catalog.json','m81314_assets_catalog.json','m81319_tanks_catalog.json',
  'm81333_lac_skin_catalog.json','m81334_skins_catalog.json'];
const menuPins=['m8_garage_catalog.json','m81314_assets_catalog.json','m81319_tanks_catalog.json',
  'm81333_skins_catalog.json','m81333_lac_skin_catalog.json','m81334_skins_catalog.json'];

export async function mergeM81335Battle(catalog,extra,pins){
  await validate(extra,pins,battlePins);
  if(catalog.m81335Skins===M81335_SKINS_SHA256)return catalog;
  for(const target of extra.targets){
    const key=`${target.tankId}/${target.externalId}`,tank=catalog.dependencyManifests?.tanks?.[target.tankId];
    await guard(tank?.baseByExternal?.[target.baseExternal],extra.guards.baseManifests[key],`base/${key}`);
    await guard(tank?.skins?.[target.externalId],extra.guards.oldSkinManifests[key],`skin/${key}`);
  }
  for(const[logical,expected]of Object.entries(extra.guards.assets))await guard(catalog.assets[logical],expected,logical);
  for(const[table,rows]of Object.entries(extra.guards.bindings))for(const[id,expected]of Object.entries(rows))
    await guard(catalog[table]?.[id],expected,`${table}/${id}`);
  for(const[kind,rows]of Object.entries(extra.guards.runtime))for(const[id,expected]of Object.entries(rows))
    await guard(catalog.dependencyManifests.runtime[kind]?.[id],expected,`runtime/${kind}/${id}`);
  // No mutation above this point. Existing immutable asset bytes are merely
  // reused; changed descriptors and new IDs are scoped by exact preimages.
  for(const[logical,asset]of Object.entries(extra.assets))catalog.assets[logical]=structuredClone(asset);
  for(const[table,rows]of Object.entries(extra.bindings)){
    catalog[table]||={};for(const[id,row]of Object.entries(rows))catalog[table][id]=structuredClone(row);
  }
  for(const target of extra.targets){
    const tank=catalog.dependencyManifests.tanks[target.tankId];
    tank.skins={...tank.skins,[target.externalId]:structuredClone(target.dependency)};
  }
  for(const[kind,rows]of Object.entries(extra.runtime))catalog.dependencyManifests.runtime[kind]
    ={...catalog.dependencyManifests.runtime[kind],...structuredClone(rows)};
  catalog.m81335Skins=M81335_SKINS_SHA256;return catalog;
}

async function guardHud(hud,extra){
  for(const[id,expected]of Object.entries(extra.guards.portraits))await guard(hud.portraits?.[id],expected,`portrait/${id}`);
  for(const[id,expected]of Object.entries(extra.guards.hudSkills))await guard(hud.skills?.[id],expected,`HUD/${id}`);
}
function writeHud(hud,extra){
  hud.portraits||={};hud.skills||={};hud.resources||={};
  Object.assign(hud.portraits,structuredClone(extra.ui.portraits));
  Object.assign(hud.skills,structuredClone(extra.ui.skillIcons));
  for(const row of Object.values(extra.ui.skillIcons))hud.resources[row.logical]=structuredClone(row.asset);
  hud.m81335Skins=M81335_SKINS_SHA256;
}
export async function mergeM81335Hud(hud,extra,pins){
  await validate(extra,pins,hudPins);
  if(hud.m81335Skins===M81335_SKINS_SHA256)return hud;
  await guardHud(hud,extra);writeHud(hud,extra);return hud;
}

export async function mergeM81335Menus(ui,extra,pins){
  await validate(extra,pins,menuPins);
  if(ui.m81335Skins===M81335_SKINS_SHA256)return ui;
  for(const target of extra.targets){
    await guard(ui.garage.items[target.itemId],extra.guards.items[target.itemId],`item/${target.itemId}`);
    await guard(ui.garage.skins.filter(row=>row.itemId===target.itemId),extra.guards.skins[target.itemId],`skin item/${target.itemId}`);
  }
  for(const[id,expected]of Object.entries(extra.guards.skinAttributes))await guard(ui.garage.skinAttributes[id],expected,`skin slots/${id}`);
  for(const[id,expected]of Object.entries(extra.guards.garageSkills))await guard(ui.garage.skills[id],expected,`garage skills/${id}`);
  for(const[logical,expected]of Object.entries(extra.guards.menuAssets))await guard(ui.resources.get(logical),expected,`menu/${logical}`);
  await guardHud(ui.hud,extra);
  writeHud(ui.hud,extra);
  for(const[logical,asset]of Object.entries(extra.assets))ui.resources.set(logical,structuredClone(asset));
  Object.assign(ui.garage.items,structuredClone(extra.ui.items));
  Object.assign(ui.garage.skinAttributes,structuredClone(extra.ui.skinAttributes));
  Object.assign(ui.garage.skills,structuredClone(extra.ui.garageSkills));
  const replacements=new Map(extra.ui.skins.map(row=>[row.itemId,row]));
  const existingIds=new Set(ui.garage.skins.map(row=>row.itemId));
  ui.garage.skins=[...ui.garage.skins.map(row=>replacements.has(row.itemId)?structuredClone(replacements.get(row.itemId)):row),
    ...extra.ui.skins.filter(row=>!existingIds.has(row.itemId)).map(row=>structuredClone(row))];
  ui.m81335Skins=M81335_SKINS_SHA256;return ui;
}
