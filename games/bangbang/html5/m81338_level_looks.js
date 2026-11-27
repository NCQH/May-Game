import {m81333ValueSha} from './m81333_skins.js';

// Source artwork only. M40 makes these appearances explicit level-unlocked
// choices through the existing equipment transaction; no inventory item or
// combat statistic is created. Saved external IDs own the displayed form.
export const M81338_LEVEL_LOOKS_SHA256='1bd396bd747ab6b480a4a1e28b81b864c868df46d11370986ad8c61373c431c0';
const VALUE_SHA256='4f12028eb0ca3f3468a4a208fa275165f9b6d5463dd4b068cdbb2a4b3bdbf5cb';
const SOURCE_SHA256='464296ad54a909d35ddeb0d1c3c88848461d74daab5d57db8973001ca5cc0fa1';
export const M81338_LEVEL_LOOKS=Object.freeze({
  10000094:Object.freeze({base:761,4:762,5:763,6:763}),
  10000097:Object.freeze({base:791,4:792,5:793,6:793}),
  10000113:Object.freeze({base:892,4:893,5:894,6:894}),
});

/** Explicit equipment owns the appearance, including the base form. A zero
 * default resolves to base; level now unlocks choices instead of overriding
 * a selected form. Other tanks, skins and transformation externals are intact.
 */
export function m81338VisualExternal(tank,nativeExternal=tank?.externalId??0){
  const external=Number(nativeExternal)||0;
  const rule=M81338_LEVEL_LOOKS[Number(tank?.tankId)];
  return rule&&external===0?rule.base:external;
}

/** Portrait choices, not inventory skin definitions. Availability is advisory;
 * C207 validates the same three-tank/level allowlist against the owned record.
 */
export function m81340LevelLookChoices(tank,name=''){
  const rule=M81338_LEVEL_LOOKS[Number(tank?.tankId)];
  if(!rule)return [];
  const level=Number(tank?.tankLevel??tank?.level);
  const current=m81338VisualExternal(tank);
  return [[rule.base,1,'Gốc'],[rule[4],4,'II'],[rule[5],5,'III']].map(([externalId,requiredLevel,label])=>{
    const unlocked=Number.isInteger(level)&&level>=requiredLevel;
    return {itemId:0,itemUuid:'',equipmentToken:`level-look:${externalId}`,levelLook:true,
      externalId,requiredLevel,quality:0,owned:unlocked,ready:true,usable:unlocked,lifeTime:0,
      active:current===externalId,name:`${name} · ${label}`,reason:`Mở ở cấp tank ${requiredLevel}.`};
  });
}

const loads=new Map();
const fail=reason=>{throw Error(`Ngoại hình theo cấp M38 chưa khớp nguồn: ${reason}.`);};
const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
  .map(value=>value.toString(16).padStart(2,'0')).join('');
export async function loadM81338LevelLooks(url='./m81338_level_looks_catalog.json',{refresh=false}={}){
  if(refresh)loads.delete(url);
  if(!loads.has(url))loads.set(url,(async()=>{
    const response=await fetch(url,{cache:'no-store'});
    if(!response.ok)fail('không tải được danh mục');
    const bytes=await response.arrayBuffer(),sha256=await sha(bytes);
    if(sha256!==M81338_LEVEL_LOOKS_SHA256)fail('hash danh mục');
    return {catalog:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),sha256,bytes:bytes.byteLength};
  })().catch(error=>{loads.delete(url);throw error;}));
  return loads.get(url);
}

async function validate(extra,pins,required){
  if(extra?.schemaVersion!==1||extra.source?.inputZipSha256!==SOURCE_SHA256
      ||extra.source.cosmeticOnly!==true||extra.source.nativeIdsAndOwnershipUnchanged!==true
      ||extra.targets?.length!==6||Object.keys(extra.assets||{}).length!==37
      ||Object.keys(extra.appearances||{}).length!==6||Object.keys(extra.portraits||{}).length!==6
      ||await m81333ValueSha(extra)!==VALUE_SHA256)fail('nội dung hoặc phạm vi');
  for(const name of required)if(!pins?.[name]||pins[name]!==extra.source.baselineCatalogSha256[name])
    fail(`phiên bản ${name}`);
  for(const target of extra.targets){
    const rule=M81338_LEVEL_LOOKS[target.tankId];
    if(!rule||target.nativeBaseExternalId!==rule.base||rule[target.level]!==target.externalId
        ||target.dependency.nativeSupport!=='ready'||target.dependency.missing.length
        ||target.dependency.kind!=='level-look')fail(`ngoại hình ${target.externalId}`);
  }
}
async function guard(value,expected,label){
  if((value==null?null:await m81333ValueSha(value))!==expected)fail(`nền ${label}`);
}

export async function mergeM81338LevelLooksBattle(catalog,extra,pins){
  await validate(extra,pins,['m6_asset_catalog.json','m81319_tanks_catalog.json',
    'm81335_skins_catalog.json','m81336_timegoddess_fx_catalog.json','m81336_magneto_fx_catalog.json']);
  if(catalog.m81338LevelLooks===M81338_LEVEL_LOOKS_SHA256)return catalog;
  for(const[base,expected]of Object.entries(extra.guards.baseAppearances))
    await guard(catalog.appearances[base],expected,`base appearance/${base}`);
  for(const[tankId,expected]of Object.entries(extra.guards.baseManifests)){
    const tank=catalog.dependencyManifests.tanks[tankId],base=M81338_LEVEL_LOOKS[tankId].base;
    await guard(tank?.baseByExternal?.[base],expected,`base manifest/${tankId}`);
    if(tank?.levelLooks&&Object.keys(tank.levelLooks).length)fail(`level looks/${tankId}`);
  }
  for(const[id,expected]of Object.entries(extra.guards.appearances))
    await guard(catalog.appearances[id],expected,`appearance/${id}`);
  for(const[id,expected]of Object.entries(extra.guards.runtime))
    await guard(catalog.dependencyManifests.runtime.appearance[id],expected,`runtime/${id}`);
  for(const key of Object.keys(extra.assets))if(catalog.assets[key])fail(`namespace ${key}`);
  // Validate every preimage before changing this private merged catalog.
  Object.assign(catalog.assets,structuredClone(extra.assets));
  Object.assign(catalog.appearances,structuredClone(extra.appearances));
  for(const target of extra.targets){
    const tank=catalog.dependencyManifests.tanks[target.tankId];
    tank.levelLooks={...tank.levelLooks,[target.externalId]:structuredClone(target.dependency)};
    catalog.dependencyManifests.runtime.appearance[target.externalId]=structuredClone(target.dependency);
  }
  catalog.m81338LevelLooks=M81338_LEVEL_LOOKS_SHA256;
  return catalog;
}

async function guardHud(hud,extra){
  for(const[id,expected]of Object.entries(extra.guards.portraits))
    await guard(hud.portraits?.[id],expected,`portrait/${id}`);
}
function writeHud(hud,extra){
  hud.portraits||={};Object.assign(hud.portraits,structuredClone(extra.portraits));
  hud.m81338LevelLooks=M81338_LEVEL_LOOKS_SHA256;
}
export async function mergeM81338LevelLooksHud(hud,extra,pins){
  await validate(extra,pins,['m7_robo_ui_catalog.json','m81319_tanks_catalog.json','m81335_skins_catalog.json']);
  if(hud.m81338LevelLooks===M81338_LEVEL_LOOKS_SHA256)return hud;
  await guardHud(hud,extra);writeHud(hud,extra);return hud;
}
export async function mergeM81338LevelLooksMenus(ui,extra,pins){
  await validate(extra,pins,['m8_garage_catalog.json','m81319_tanks_catalog.json','m81335_skins_catalog.json']);
  if(ui.m81338LevelLooks===M81338_LEVEL_LOOKS_SHA256)return ui;
  await guardHud(ui.hud,extra);
  for(const key of Object.keys(extra.assets))if(ui.resources.has(key))fail(`menu namespace ${key}`);
  writeHud(ui.hud,extra);
  for(const[key,value]of Object.entries(extra.assets))ui.resources.set(key,structuredClone(value));
  ui.m81338LevelLooks=M81338_LEVEL_LOOKS_SHA256;
  return ui;
}
