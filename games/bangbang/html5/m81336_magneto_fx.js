import {m81333ValueSha} from './m81333_skins.js';

// Restore the source two-bar R removal movie without changing the native
// prop, its 100 ms removal event, either damage pulse or any accepted skin.
export const M81336_MAGNETO_FX_SHA256='08de158996fe294202612096d43c68de26dd197e5422a2164fe8ceac29f214cc';
const VALUE_SHA256='68a6b6ae4fbd58eb8671b1c737ea85ff464f2b6bcbe495227c679f8c62d65370';
const RECORD_SHA256='30e527b58cf339e71df442a50156c453b62596c2f19a4d1d920441ebcf917ea3';
const loads=new Map();
const fail=reason=>{throw Error(`Hiệu ứng Magneto chưa khớp nguồn: ${reason}.`);};
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
  .map(value=>value.toString(16).padStart(2,'0')).join('');

export async function loadM81336MagnetoFx(url='./m81336_magneto_fx_catalog.json',{refresh=false}={}){
  if(refresh)loads.delete(url);
  if(!loads.has(url))loads.set(url,(async()=>{
    const response=await fetch(url,{cache:'no-store'});
    if(!response.ok)fail('không tải được danh mục');
    const bytes=await response.arrayBuffer(),sha256=await digest(bytes);
    if(sha256!==M81336_MAGNETO_FX_SHA256)fail('hash danh mục');
    return {catalog:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),sha256,bytes:bytes.byteLength};
  })().catch(error=>{loads.delete(url);throw error;}));
  return loads.get(url);
}

const typedTables={skill:'skills',buff:'buffs',exhibit:'exhibits',scene:'sceneItems',
  npc:'aiNPCs',arms:'aiArms',mapNpc:'mapNPCs',appearance:'appearances'};
function imageAssets(source){
  if(/\.(png|jpe?g|webp)$/i.test(source?.url||''))return [source];
  const d=source?.derived;
  return [d?.asset,...(d?.assets||[]),...(d?.layers||[]).flatMap(layer=>[layer.asset,...(layer.assets||[])])]
    .filter(Boolean);
}

function updatedManifest(manifest,catalog,extra){
  if(!(manifest.typedIds?.scene||[]).some(id=>Number(id)===372403))return null;
  const change=extra.changes[0],oldLogical=change.before.logical;
  let keepOld=false;
  for(const[kind,ids]of Object.entries(manifest.typedIds||{})){
    const table=typedTables[kind];if(!table)continue;
    for(const id of ids)for(const[field,resource]of Object.entries(catalog[table]?.[id]?.resources||{})){
      const logical=typeof resource==='string'?resource:resource?.logical;
      if(logical===oldLogical&&!(table==='sceneItems'&&Number(id)===372403&&field==='szRemoveSwf'))keepOld=true;
    }
  }
  const logicalResources=[...new Set([...(manifest.logicalResources||[])
    .filter(logical=>logical!==oldLogical||keepOld),change.logical])].sort();
  const images=new Map(),audio=new Set(),counts={};
  for(const logical of logicalResources){
    const source=extra.assets[logical]||catalog.assets[logical];
    if(!source)fail(`phụ thuộc ${logical}`);
    counts[source.status||'unknown']=(counts[source.status||'unknown']||0)+1;
    for(const image of imageAssets(source))images.set(image.url,image);
    if(/\.(mp3|ogg|wav)$/i.test(source.url||''))audio.add(source.url);
  }
  const imageUrls=[...images.keys()].sort(),audioUrls=[...audio].sort();
  return {...manifest,logicalResources,imageUrls,audioUrls,assetUrls:[...imageUrls,...audioUrls].sort(),
    statusCounts:counts,decodedImageBytes:[...images.values()].reduce((sum,a)=>sum+(Number(a.width)||0)*(Number(a.height)||0)*4,0),
    availableImageAccountingComplete:[...images.values()].every(a=>a.width>0&&a.height>0)};
}

export async function mergeM81336MagnetoFx(catalog,extra,pins){
  if(extra?.schemaVersion!==1||extra.tankId!==10000097||extra.baseExternalId!==791
      ||extra.source?.recordSha256!==RECORD_SHA256||extra.source.cosmeticOnly!==true
      ||await m81333ValueSha(extra)!==VALUE_SHA256)fail('nội dung hoặc namespace');
  for(const[name,expected]of Object.entries(extra.source.baselineCatalogSha256))
    if(pins?.[name]!==expected)fail(`phiên bản ${name}`);
  if(catalog.m81336MagnetoFx===M81336_MAGNETO_FX_SHA256)return catalog;
  const tank=catalog.dependencyManifests?.tanks?.[10000097];
  if(tank?.baseByExternal?.[791]?.nativeSupport!=='ready')fail('tank cơ sở');
  for(const logical of Object.keys(extra.assets))if(catalog.assets[logical])fail(`trùng tài nguyên ${logical}`);
  const change=extra.changes[0],row=catalog.sceneItems?.[372403],resource=row?.resources?.szRemoveSwf;
  for(const[field,value]of Object.entries(change.nativeFields))
    if((row?.[field]??null)!==value)fail(`sceneItems/372403/${field}`);
  if(!row?.prop||await m81333ValueSha(row.prop)!==change.propSha256)fail('prop native372403');
  const before=change.before;
  if(resource?.logical!==before.logical||resource.sha256!==before.sha256||resource.url!==before.url
      ||(resource.derived?await m81333ValueSha(resource.derived):null)!==before.derivedSha256)
    fail('nguồn cũ sceneItems/372403/szRemoveSwf');

  // Build every changed preload before any mutation; preserve any other
  // typed consumer of the old shared SWF instead of deleting it globally.
  const manifestWrites=[];
  for(const manifests of Object.values(catalog.dependencyManifests.tanks))
    for(const kind of ['baseByExternal','skins'])for(const[id,manifest]of Object.entries(manifests[kind]||{})){
      const updated=updatedManifest(manifest,catalog,extra);
      if(updated)manifestWrites.push({parent:manifests[kind],id,updated});
    }
  for(const rows of Object.values(catalog.dependencyManifests.runtime))
    for(const[id,manifest]of Object.entries(rows)){
      const updated=updatedManifest(manifest,catalog,extra);
      if(updated)manifestWrites.push({parent:rows,id,updated});
    }
  for(const[logical,source]of Object.entries(extra.assets))catalog.assets[logical]=structuredClone(source);
  catalog.sceneItems[372403]={...row,resources:{...row.resources,szRemoveSwf:catalog.assets[change.logical]}};
  for(const{parent,id,updated}of manifestWrites)parent[id]=updated;
  catalog.m81336MagnetoFx=M81336_MAGNETO_FX_SHA256;
  return catalog;
}
