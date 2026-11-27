// The supplied November source already contains this art. M33 completes only
// two approved HTML5 skin bindings; original catalogs/assets remain untouched.
// No inventory, ownership, skin-quality stats or native combat state lives here.
export const M81333_SKINS_SHA256='bea7b09f1e139635ce2acf17f96e08120cbc9b647be2c1c7a899de4295fdc6c2';
const PAIRS=Object.freeze({'10000008:10142':[2900802,2910002],'10000107:865':[2970211]});
const loads=new Map();
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=message=>{throw new Error(`Skin M33 chưa khớp dữ liệu đã đối chiếu: ${message}.`);};

function sorted(value){
  return Array.isArray(value)?value.map(sorted):value&&typeof value==='object'
    ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])])):value;
}
async function bytesSha(bytes){
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
    .map(value=>value.toString(16).padStart(2,'0')).join('');
}
export async function m81333ValueSha(value){
  return bytesSha(new TextEncoder().encode(JSON.stringify(sorted(value))));
}

export async function loadM81333Skins(url='./m81333_skins_catalog.json',{refresh=false}={}){
  if(refresh)loads.delete(url);
  if(!loads.has(url))loads.set(url,(async()=>{
    const response=await fetch(url,{cache:'no-store'});
    if(!response.ok)fail('không tải được danh mục bổ sung');
    const bytes=await response.arrayBuffer(),sha256=await bytesSha(bytes);
    if(sha256!==M81333_SKINS_SHA256)fail('hash danh mục bổ sung');
    const catalog=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    validateTargets(catalog);
    return {catalog,sha256,bytes:bytes.byteLength};
  })().catch(error=>{loads.delete(url);throw error;}));
  return loads.get(url);
}

function validateTargets(extra){
  if(extra?.schemaVersion!==1||!Array.isArray(extra.targets)||extra.targets.length!==2)fail('phạm vi skin');
  const keys=extra.targets.map(row=>`${row.tankId}:${row.externalId}`).sort();
  if(!same(keys,Object.keys(PAIRS).sort()))fail('tank hoặc ngoại hình ngoài phạm vi');
  for(const target of extra.targets){
    const expected=PAIRS[`${target.tankId}:${target.externalId}`];
    if(!same(target.items.map(row=>row.itemId).sort((a,b)=>a-b),expected))fail('mã vật phẩm');
    const dep=target.dependency;
    if(dep?.tankId!==target.tankId||dep.externalId!==target.externalId||dep.nativeSupport!=='ready'
        ||dep.kind!=='skin'||dep.missing?.length||dep.unavailableVisuals?.length)fail('phụ thuộc skin');
    if(!same(dep.typedIds?.appearance,[target.externalId]))fail('ngoại hình trong phụ thuộc');
  }
  const spider=extra.targets.find(row=>row.externalId===10142);
  if(!same(spider.dependency.presentationRemap,{tank:10000008,skill:{303100:403100},buff:{},scene:{}}))
    fail('chỉ ánh xạ đòn thường Spider Man');
  if(!same(extra.targets.find(row=>row.externalId===865).dependency.presentationRemap,{}))fail('Hikari giữ kỹ năng cơ sở');
  if(extra.skillPresentationPatch?.id!==403100||extra.garageSkillPatch?.externalId!==10142)fail('bản vá kỹ năng');
  if(!same(extra.skillPresentationPatch.fields,{iFlyRange:{before:480,after:408},iLifeTime:{before:850,after:700},iRange:{before:480,after:408}}))
    fail('chỉ ba trường hiển thị đòn thường đã đối chiếu');
  if(!same(extra.garageSkillPatch.after,{nSkill1:303201,nSkill2:303301,nSkill3:303101,nSkill4:303401,nSkill5:0}))
    fail('bộ kỹ năng cơ sở Spider Man');
}

function validateSource(extra,pins){
  validateTargets(extra);
  for(const [name,actual] of Object.entries(pins))
    if(!actual||extra.source?.baselineCatalogSha256?.[name]!==actual)fail(`phiên bản ${name}`);
}

async function validateAsset(asset,expected,label){
  if(!asset||asset.exists===false||!asset.url||!asset.sha256)fail(`thiếu ${label}`);
  for(const key of ['sha256','url','bytes','status'])
    if(asset[key]!==expected[key])fail(`${label}/${key}`);
  for(const key of ['width','height'])if((asset[key]??null)!==expected[key])fail(`${label}/${key}`);
  const actualDerived=asset.derived?await m81333ValueSha(asset.derived):null;
  if(actualDerived!==expected.derivedSha256)fail(`${label}/atlas`);
}

async function validateAppearance(appearance,target){
  if(!appearance||await m81333ValueSha(appearance.raw)!==target.expectedAppearanceRawSha256)
    fail(`ngoại hình ${target.externalId}`);
  if(appearance.raw.szResource!==target.declarationBefore)fail(`preload ${target.externalId}`);
  for(const key of ['body','cannon'])
    await validateAsset(appearance[key]?.source,target.expectedAppearanceSources[key],`${target.externalId}/${key}`);
}

/** Called after the already-pinned M14/M19/M30 catalogs have been hydrated in
 * their own namespaces. This sidecar contains logical IDs and guards, never
 * cross-catalog assetRef/derivedRef objects that could hydrate against M6.
 */
export async function mergeM81333BattleSkins(catalog,extra,baseSha256,pveSha256){
  validateSource(extra,{'m6_asset_catalog.json':baseSha256,'m81314_assets_catalog.json':pveSha256});
  if(catalog.m81333SkinRelease?.sha256===M81333_SKINS_SHA256)return catalog;
  for(const [logical,expected] of Object.entries(extra.requiredBattleAssets))
    await validateAsset(catalog.assets?.[logical],expected,logical);
  for(const target of extra.targets){
    const tank=catalog.dependencyManifests?.tanks?.[target.tankId];
    const base=tank?.baseByExternal?.[target.sourceBaseExternalId];
    if(base?.nativeSupport!=='ready'||await m81333ValueSha(base.typedIds)!==target.expectedBaseTypedIdsSha256)
      fail(`bộ kỹ năng native ${target.tankId}`);
    const previous=tank.skins?.[target.externalId];
    if((previous?await m81333ValueSha(previous):null)!==target.expectedPreviousSkinManifestSha256)
      fail(`trạng thái cũ ${target.externalId}`);
    await validateAppearance(catalog.appearances?.[target.externalId],target);
    for(const logical of target.dependency.logicalResources)
      if(!extra.requiredBattleAssets[logical])fail(`nguồn chưa ghim ${logical}`);
  }
  const patch=extra.skillPresentationPatch,skill=catalog.skills?.[patch.id];
  if(!skill)fail('đòn thường 403100');
  for(const [key,change] of Object.entries(patch.fields))if(skill[key]!==change.before)fail(`403100/${key}`);
  for(const [key,value] of Object.entries(patch.unchangedBindings))if(skill[key]!==value)fail(`403100/${key}`);
  // All guards finish before the first mutation. Retain every original row
  // and every non-target skin, including the six deliberately closed skins.
  catalog.skills[patch.id]={...skill,...Object.fromEntries(Object.entries(patch.fields).map(([key,change])=>[key,change.after]))};
  for(const target of extra.targets){
    const old=catalog.dependencyManifests.tanks[target.tankId];
    catalog.dependencyManifests.tanks[target.tankId]={...old,skins:{...old.skins,
      [target.externalId]:structuredClone(target.dependency)}};
    if(target.declarationBefore!==target.declarationAfter){
      const appearance=catalog.appearances[target.externalId];
      catalog.appearances[target.externalId]={...appearance,raw:{...appearance.raw,szResource:target.declarationAfter}};
    }
  }
  catalog.m81333SkinRelease={sha256:M81333_SKINS_SHA256,ready:extra.targets.map(({tankId,externalId})=>({tankId,externalId})),
    scope:'presentation-only; native base-kit combat and ownership unchanged'};
  return catalog;
}

export async function mergeM81333MenuSkins(ui,extra,garageSha256,pveSha256){
  validateSource(extra,{'m8_garage_catalog.json':garageSha256,'m81314_assets_catalog.json':pveSha256});
  if(ui.m81333SkinRelease?.sha256===M81333_SKINS_SHA256)return ui;
  for(const [logical,expected] of Object.entries(extra.requiredMenuAssets))
    await validateAsset(ui.resources.get(logical),expected,logical);
  for(const target of extra.targets){
    await validateAppearance(ui.pve.bindings?.appearances?.[target.externalId],target);
    const rows=ui.garage.skins.filter(row=>row.tankId===target.tankId&&row.externalId===target.externalId);
    if(!same(rows.map(row=>row.itemId).sort((a,b)=>a-b),PAIRS[`${target.tankId}:${target.externalId}`]))fail('đủ các mã skin trong kho');
    for(const expected of target.items){
      const row=rows.find(value=>value.itemId===expected.itemId),item=ui.garage.items[expected.itemId];
      if(row.ready||item?.type!==29||item.containerType!==6||item.reuse?.iReuseA!==target.tankId
          ||item.reuse?.iReuseB!==target.externalId||item.name!==expected.expectedName
          ||item.icon!==expected.expectedIcon||item.description!==expected.expectedDescription
          ||item.nativeDescription!==expected.expectedNativeDescription)fail(`vật phẩm ${expected.itemId}`);
    }
    const portrait=ui.hud.portraits[target.externalId],head=ui.panels.selectionHeads[target.externalId];
    if(!portrait?.asset?.url||!head?.url)fail(`avatar/head ${target.externalId}`);
    for(const asset of [portrait.asset,head]){
      const expected=extra.requiredBattleAssets[asset.logical];
      if(!expected)fail(`avatar chưa ghim ${target.externalId}`);
      await validateAsset(asset,expected,`${target.externalId}/avatar`);
    }
  }
  const skillPatch=extra.garageSkillPatch,skinAttr=ui.garage.skinAttributes?.[skillPatch.externalId];
  if(!same(skinAttr?.skills,skillPatch.before))fail('kỹ năng trong kho Spider Man');
  const enabled=new Set(extra.targets.flatMap(target=>target.items.map(item=>item.itemId)));
  ui.garage.skins=ui.garage.skins.map(row=>enabled.has(row.itemId)?{...row,ready:true,support:'ready',reason:''}:row);
  ui.garage.skinAttributes={...ui.garage.skinAttributes,
    [skillPatch.externalId]:{...skinAttr,skills:{...skillPatch.after}}};
  for(const target of extra.targets)for(const item of target.items)if(item.description){
    ui.garage.items[item.itemId]={...ui.garage.items[item.itemId],description:item.description,nativeDescription:item.description};
  }
  ui.m81333SkinRelease={sha256:M81333_SKINS_SHA256,itemIds:[...enabled],scope:'Owned permanent skins only; no grants or purchases'};
  return ui;
}
