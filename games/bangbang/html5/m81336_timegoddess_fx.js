import {m81333ValueSha} from './m81333_skins.js';

// Only the supplied Time Goddess presentation changes. Native skill IDs,
// guardian identity, skin readiness, combat parameters and audio are retained.
export const M81336_TIMEGODDESS_FX_SHA256='85b6f52cdd386dca5cc8d3d0ecdd7c74ff98ee17f719c81cc1752147dd366476';
const VALUE_SHA256='547d63a34d3add3e0c06ae738c148b03cece3cb81c1e04a08cc8c43d44f2fb72';
const INPUT_SHA256='35b77d59e29457d583caff8ede371ebb7458d3f1e2740446e940632f77d658c3';
const loads=new Map();
const fail=reason=>{throw Error(`Hiệu ứng Nữ Thần Thời Gian chưa khớp nguồn: ${reason}.`);};
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
  .map(value=>value.toString(16).padStart(2,'0')).join('');

export async function loadM81336TimegoddessFx(url='./m81336_timegoddess_fx_catalog.json',{refresh=false}={}){
  if(refresh)loads.delete(url);
  if(!loads.has(url))loads.set(url,(async()=>{
    const response=await fetch(url,{cache:'no-store'});
    if(!response.ok)fail('không tải được danh mục');
    const bytes=await response.arrayBuffer(),sha256=await digest(bytes);
    if(sha256!==M81336_TIMEGODDESS_FX_SHA256)fail('hash danh mục');
    return {catalog:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),sha256,bytes:bytes.byteLength};
  })().catch(error=>{loads.delete(url);throw error;}));
  return loads.get(url);
}

const typedTables={skill:'skills',buff:'buffs',exhibit:'exhibits',scene:'sceneItems',
  npc:'aiNPCs',arms:'aiArms',mapNpc:'mapNPCs',appearance:'appearances'};
const manifestHas=(manifest,change)=>(manifest.typedIds?.[change.table==='buffs'?'buff':'exhibit']||[])
  .some(id=>Number(id)===change.id);

function imageAssets(source){
  if(/\.(png|jpe?g|webp)$/i.test(source?.url||''))return [source];
  const d=source?.derived;
  return [d?.asset,...(d?.assets||[]),...(d?.layers||[]).flatMap(layer=>[layer.asset,...(layer.assets||[])])]
    .filter(Boolean);
}

/** Rebuild only manifests that actually refer to one of the changed typed
 * bindings. A shared historical logical stays preloaded if another consumer
 * in the same manifest still uses it (for example another reload buff).
 */
function updatedManifest(manifest,catalog,extra){
  const changes=extra.changes.filter(change=>manifestHas(manifest,change));
  if(!changes.length)return null;
  const oldLogicals=new Set(changes.map(change=>change.before.logical)),keep=new Set();
  const changedFields=new Set(changes.map(change=>`${change.table}/${change.id}/${change.field}`));
  for(const[kind,ids]of Object.entries(manifest.typedIds||{})){
    const table=typedTables[kind];if(!table)continue;
    for(const id of ids)for(const[field,resource]of Object.entries(catalog[table]?.[id]?.resources||{})){
      const logical=typeof resource==='string'?resource:resource?.logical;
      if(oldLogicals.has(logical)&&!changedFields.has(`${table}/${id}/${field}`))keep.add(logical);
    }
  }
  const logicalResources=[...new Set([...(manifest.logicalResources||[])
    .filter(logical=>!oldLogicals.has(logical)||keep.has(logical)),...changes.map(change=>change.logical)])].sort();
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

export async function mergeM81336TimegoddessFx(catalog,extra,pins){
  if(extra?.schemaVersion!==1||extra.tankId!==10000113||extra.baseExternalId!==892
      ||extra.source?.inputZipSha256!==INPUT_SHA256||extra.source.cosmeticOnly!==true
      ||await m81333ValueSha(extra)!==VALUE_SHA256)fail('nội dung hoặc namespace');
  for(const[name,expected]of Object.entries(extra.source.baselineCatalogSha256))
    if(pins?.[name]!==expected)fail(`phiên bản ${name}`);
  if(catalog.m81336TimegoddessFx===M81336_TIMEGODDESS_FX_SHA256)return catalog;

  const tank=catalog.dependencyManifests?.tanks?.[10000113];
  if(tank?.baseByExternal?.[892]?.nativeSupport!=='ready')fail('tank cơ sở');
  for(const[id,fields]of Object.entries(extra.nativeSkills)){
    if(!catalog.skills?.[id])fail(`thiếu skill ${id}`);
    for(const[field,value]of Object.entries(fields))
      if((catalog.skills[id][field]??null)!==value)fail(`liên kết skill ${id}/${field}`);
  }
  const arms=catalog.aiArms?.[389401];
  if(Number(arms?.exhibitId)!==51||Number(arms?.iBuffId1)!==389402)fail('vệ binh native');
  for(const logical of Object.keys(extra.assets))if(catalog.assets[logical])fail(`trùng tài nguyên ${logical}`);

  // Validate every affected source and render-control preimage before making
  // any catalog mutation. Locale display strings are intentionally excluded.
  for(const change of extra.changes){
    const row=catalog[change.table]?.[change.id],resource=row?.resources?.[change.field];
    for(const[field,value]of Object.entries(change.nativeFields))
      if((row?.[field]??null)!==value)fail(`${change.table}/${change.id}/${field}`);
    const before=change.before;
    if(resource?.logical!==before.logical||resource.sha256!==before.sha256||resource.url!==before.url
        ||(resource.derived?await m81333ValueSha(resource.derived):null)!==before.derivedSha256)
      fail(`nguồn cũ ${change.table}/${change.id}/${change.field}`);
  }
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

  // Resources are placed in their own namespace. Do not overwrite a shared
  // old PNG/SWF or import any donor gameplay/template/appearance table.
  for(const[logical,source]of Object.entries(extra.assets))catalog.assets[logical]=structuredClone(source);
  for(const change of extra.changes){
    const row=catalog[change.table][change.id];
    catalog[change.table][change.id]={...row,resources:{...row.resources,
      [change.field]:catalog.assets[change.logical]}};
  }
  for(const{parent,id,updated}of manifestWrites)parent[id]=updated;
  catalog.m81336TimegoddessFx=M81336_TIMEGODDESS_FX_SHA256;
  return catalog;
}
