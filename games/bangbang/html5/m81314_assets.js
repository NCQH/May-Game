import {PVE_MAP_IDS,isPveMap} from './m81314_protocol.js';
import {bindSupplementCannon} from './m81314_file_timeline.js';
import {isWorldBossScene} from './m81330_protocol.js';

// Share the immutable source document between outside menus and the battle
// loader. Hydration resolves this sidecar's own atlas namespace before merge.
const loads=new Map();
export async function loadPveCatalog(url='./m81314_assets_catalog.json',{refresh=false}={}){
  if(refresh)loads.delete(url);
  if(!loads.has(url))loads.set(url,(async()=>{
    const response=await fetch(url,{cache:'no-store'});
    if(!response.ok)throw new Error('Không tải được tài nguyên trợ thủ và PvE.');
    const bytes=await response.arrayBuffer();
    const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
      .map(value=>value.toString(16).padStart(2,'0')).join('');
    const catalog=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(catalog.schemaVersion!==1||!catalog.source?.m6CatalogSha256)
      throw new Error('Danh mục trợ thủ và PvE không đúng phiên bản.');
    catalog.rawTemplates=catalog.rawTemplates||catalog.templates;
    return {catalog,sha256,bytes:bytes.byteLength};
  })().catch(error=>{loads.delete(url);throw error;}));
  return loads.get(url);
}

const bindingTables=new Set(['skills','buffs','exhibits','sceneItems','aiNPCs','aiArms','mapNPCs','appearances']);
const visualFields=new Set(['resources','body','cannon','engine','raw','rendererBinding','szName','szBuffName','szBuffDesc',
  'szBuffIcon','szBuffMp3','szBuffSwf','szIconPath1','szIconPath2','szIconPath3','szSkillName','szSkillDesc',
  'szAppearMovie','szDeadMp3','szHitMp3','szExplodeSound','szFireSound','szCoverMp3','szRemoveMp3',
  'szImageFile','szBrokenImage1','szBrokenImage2','szBrokenImage3','szDestorySwf','szHeadImage','szLeftImage',
  'szAllSound','szPartSound','anchor','anchorSource','swfPlacement','sourceOrdinal','sourceTable']);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function mergePveCatalog(catalog,extra,baseSha256){
  if(extra?.schemaVersion!==1||extra.source?.m6CatalogSha256!==baseSha256)
    throw new Error('Tài nguyên PvE không khớp bản client đã đối chiếu.');
  if(Object.keys(extra.maps||{}).length!==PVE_MAP_IDS.length||PVE_MAP_IDS.some(id=>!extra.maps[id]))
    throw new Error('Danh sách 49 màn PvE không khớp.');
  for(const [logical,resource] of Object.entries(extra.assets||{})){
    const previous=catalog.assets[logical];
    if(previous&&(previous.sha256??null)!==(resource.sha256??null)){
      if(resource.explicitOverride!==true||resource.expectedBeforeSha256!==(previous.sha256??null))
        throw new Error(`Tài nguyên mới ghi đè nguồn khác chưa được duyệt: ${logical}.`);
    }
    // Broken input never displaces a valid inherited image.
    if(resource.status==='quarantined'&&previous?.exists)continue;
    catalog.assets[logical]=resource;
  }
  for(const [table,rows] of Object.entries(extra.bindings||{})){
    if(!bindingTables.has(table))throw new Error(`Bảng tài nguyên PvE không hợp lệ: ${table}.`);
    catalog[table]||={};
    for(const [id,row] of Object.entries(rows)){
      const previous=catalog[table][id];
      if(previous)for(const [key,value] of Object.entries(row)){
        if(!visualFields.has(key)&&Object.hasOwn(previous,key)&&!same(previous[key],value))
          throw new Error(`Không cho sidecar thay luật combat cũ: ${table}/${id}/${key}.`);
      }
      catalog[table][id]={...previous,...row,
        ...(row.resources?{resources:{...previous?.resources,...row.resources}}:{})};
      if(table==='appearances')bindSupplementCannon(catalog[table][id].cannon);
    }
  }
  for(const [id,map] of Object.entries(extra.maps)){
    if(!isPveMap(id)||catalog.maps[id])throw new Error('PvE ghi đè map đã có.');
    catalog.maps[id]=map;
  }
  for(const [id,row] of Object.entries(extra.dependencies||{})){
    if(!isPveMap(id)||!catalog.maps[id])throw new Error('Thiếu định nghĩa map PvE.');
    catalog.dependencyManifests.maps[id]=row;
  }
  for(const [kind,rows] of Object.entries(extra.runtime||{})){
    const target=catalog.dependencyManifests.runtime[kind]||={};
    for(const [id,row] of Object.entries(rows))target[id]={...target[id],...row,
      logicalResources:[...new Set([...(target[id]?.logicalResources||[]),...(row.logicalResources||[])])]};
  }
  for(const [tankId,rows] of Object.entries(extra.skinDependencies||{})){
    const tank=catalog.dependencyManifests.tanks[tankId];
    if(!tank)continue; // Never add the three deferred tanks via an art sidecar.
    tank.skins||={};
    for(const [externalId,row] of Object.entries(rows)){
      if(row.nativeSupport!=='ready'||extra.supportedSkins?.[tankId]?.[externalId]?.status!=='ready')continue;
      const previous=tank.skins[externalId]||{};
      tank.skins[externalId]={...previous,...row,
        logicalResources:[...new Set([...(previous.logicalResources||[]),...(row.logicalResources||[])])]};
    }
  }
  if(extra.linkBindings){
    catalog.linkBindings||={};
    for(const [kind,rows] of Object.entries(extra.linkBindings))
      catalog.linkBindings[kind]={...catalog.linkBindings[kind],...rows};
  }
  catalog.companions=extra.companions||{};
  catalog.companionStarEffects=extra.companionStarEffects||{};
  catalog.pvePresentation={maps:Object.fromEntries(Object.entries(extra.maps).map(([id,map])=>[id,
    {mapId:Number(id),name:map.name,minimap:map.minimap,width:map.width,height:map.height}]))};
  catalog.pveCatalog=extra;
  return catalog;
}

export function companionSceneManifests(catalog,scene){
  if(!(Number(scene.roomType)===4&&isPveMap(scene.mapId))&&!isWorldBossScene(scene))return [];
  const logicalResources=[];
  for(const actor of scene.characters||[]){
    const companion=catalog.companions?.[String(actor.btItemId||actor.other?.btItemId||0)];
    if(!companion)continue;
    const rank=Number(actor.btRank??actor.other?.btRank??0);
    for(const source of [companion.source,catalog.companionStarEffects?.[String(rank)]?.source
        ||catalog.companionStarEffects?.[String(rank)]]){
      const logical=source?.logical||source?.assetRef;
      if(logical)logicalResources.push(logical);
    }
  }
  return logicalResources.length?[{logicalResources:[...new Set(logicalResources)],missing:[]}]:[];
}
