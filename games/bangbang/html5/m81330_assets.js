import {bindSupplementCannon} from './m81314_file_timeline.js';
import {WORLD_BOSS_MAP,isWorldBossScene} from './m81330_protocol.js';

const loads=new Map(),digest=/^[a-f0-9]{64}$/;
const tables=new Set(['skills','buffs','exhibits','sceneItems','aiNPCs','aiArms','mapNPCs','appearances']);
const kinds=new Set(['skill','buff','scene','npc','appearance','mapNpc']);
const visual=new Set(['resources','body','cannon','engine','raw','rendererBinding','sourceOrdinal','sourceTable','_ordinal',
  'anchor','anchorSource','swfPlacement','szName','szBuffName','szBuffDesc','szBuffIcon','szBuffMp3','szBuffSwf',
  'szIconPath1','szIconPath2','szIconPath3','szSkillName','szSkillDesc','szAppearMovie','szDeadMp3','szHitMp3',
  'szExplodeSound','szFireSound','szCoverMp3','szRemoveMp3','szImageFile','szBrokenImage1','szBrokenImage2',
  'szBrokenImage3','szDestorySwf','szHeadImage','szLeftImage','szAllSound','szPartSound']);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const requireValue=(value,message)=>{if(!value)throw new Error(message);};
// Four exact fixes from the user's stable Flash boss package. These are not
// a general permission to overwrite combat rows. In particular effect36 is
// root-only; retaining the old effect30 would also silence the player's gun.
// Source template_changes.json SHA256:
// 44e4d43be823097bd53d627b8841a0e353af8f45d81bd5feee2fe30098261dd6
const bossCorrections=Object.freeze({
  'buffs/10200973/iAspect':[1,-1],
  'buffs/10200973/iPersistTime':[5000,2000],
  'buffs/10200973/nEffectType':[30,36],
  'buffs/10200994/iPersistTime':[1500,3530],
});
function sourceCorrection(extra,table,id,key,before,after){
  const change=bossCorrections[`${table}/${id}/${key}`];
  return change&&same(change,[before,after])
    &&extra.source.packageSha256==='9a4f2583ea63b6e3b21e3f3b585ab6031fbf74afffb1277c555cf1d434b33dda'
    &&extra.source.configHashes?.['BuffTemplate_table.json']==='2b09c72a36d3e26e89e23aa1811f3cbd6437948158475e16fdd4037d957c507b';
}

export function validateWorldBossCatalog(extra,baseSha256){
  requireValue(extra?.schemaVersion===1&&digest.test(baseSha256||'')&&extra.source?.m6CatalogSha256===baseSha256,
    'Tài nguyên Boss Thế Giới không khớp bản HTML5 nền.');
  for(const [field,[before,after]] of Object.entries(bossCorrections)){
    const [table,id,key]=field.split('/');
    requireValue(extra.bindings?.[table]?.[id]?.[key]===after
      &&sourceCorrection(extra,table,id,key,before,after),`Sửa lỗi Flash boss không khớp nguồn: ${field}.`);
  }
  requireValue(same(Object.keys(extra.maps||{}),[String(WORLD_BOSS_MAP)])
      &&same(Object.keys(extra.dependencyManifests?.maps||{}),[String(WORLD_BOSS_MAP)]),
    'Danh mục Boss Thế Giới chỉ được bổ sung map 40002.');
  const map=extra.maps[WORLD_BOSS_MAP];
  requireValue(map.width===1440&&map.height===1008&&map.background&&map.minimap,
    'Bản đồ Boss Thế Giới không khớp hình học gốc.');
  for(const [logical,source] of Object.entries(extra.assets||{})){
    requireValue(source?.exists===true&&['ready','ready-derived'].includes(source.status)
      &&digest.test(source.sha256||'')&&source.url?.startsWith('/'),`Tài nguyên boss chưa sẵn sàng: ${logical}.`);
  }
  for(const [id,row] of Object.entries(extra.dependencyManifests.maps)){
    requireValue(!row.missing?.length&&row.logicalResources?.length>0,`Thiếu preload map boss ${id}.`);
    for(const logical of row.logicalResources)requireValue(!!extra.assets[logical],`Thiếu tài nguyên boss ${logical}.`);
  }
  return extra;
}

export async function loadWorldBossCatalog(url='./m81330_worldboss_catalog.json',{refresh=false}={}){
  if(refresh)loads.delete(url);
  if(!loads.has(url))loads.set(url,(async()=>{
    const response=await fetch(url,{cache:'no-store'});
    if(!response.ok)throw new Error('Không tải được tài nguyên Boss Thế Giới.');
    const bytes=await response.arrayBuffer();
    const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
    const catalog=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    validateWorldBossCatalog(catalog,catalog.source?.m6CatalogSha256);
    return {catalog,sha256,bytes:bytes.byteLength};
  })().catch(error=>{loads.delete(url);throw error;}));
  return loads.get(url);
}

/** Hydrate this sidecar in its own asset namespace before calling. No existing
 * map, player tank, skin ownership, bot pool or gameplay statistic is replaced. */
export function mergeWorldBossCatalog(catalog,extra,baseSha256){
  validateWorldBossCatalog(extra,baseSha256);
  requireValue(!catalog.maps[WORLD_BOSS_MAP], 'Map boss đã tồn tại; không ghi đè bản đồ nền.');
  const writes=[];
  for(const [logical,resource] of Object.entries(extra.assets)){
    const previous=catalog.assets[logical];
    requireValue(!previous||previous.sha256===resource.sha256
      ||resource.explicitOverride===true&&resource.expectedBeforeSha256===(previous.sha256??null),
      `Boss định ghi đè tài nguyên không cùng nguồn: ${logical}.`);
    writes.push(()=>{catalog.assets[logical]=resource;});
  }
  for(const [table,rows] of Object.entries(extra.bindings||{})){
    requireValue(tables.has(table),`Bảng boss không được hỗ trợ: ${table}.`);
    for(const [id,row] of Object.entries(rows)){
      const previous=catalog[table]?.[id];
      if(previous)for(const [key,value] of Object.entries(row))
        requireValue(visual.has(key)||!Object.hasOwn(previous,key)||same(previous[key],value)
          ||sourceCorrection(extra,table,id,key,previous[key],value),
          `Sidecar boss không được đổi luật cũ: ${table}/${id}/${key}.`);
      const merged={...previous,...row,...(row.resources?{resources:{...previous?.resources,...row.resources}}:{})};
      if(table==='appearances')bindSupplementCannon(merged.cannon);
      writes.push(()=>{(catalog[table]||={})[id]=merged;});
    }
  }
  for(const [kind,rows] of Object.entries(extra.dependencyManifests.runtime||{})){
    requireValue(kinds.has(kind),`Preload boss không được hỗ trợ: ${kind}.`);
    for(const [id,row] of Object.entries(rows)){
      requireValue(!row.missing?.length,`Preload boss ${kind}/${id} còn thiếu nguồn.`);
      writes.push(()=>{const target=catalog.dependencyManifests.runtime[kind]||={},previous=target[id];
        target[id]={...previous,...row,logicalResources:[...new Set([...(previous?.logicalResources||[]),...(row.logicalResources||[])])]};});
    }
  }
  for(const write of writes)write();
  catalog.maps[WORLD_BOSS_MAP]=extra.maps[WORLD_BOSS_MAP];
  catalog.dependencyManifests.maps[WORLD_BOSS_MAP]=extra.dependencyManifests.maps[WORLD_BOSS_MAP];
  catalog.worldBossPresentation={maps:extra.hudMaps};catalog.worldBossCatalog=extra;
  return catalog;
}

function iconSource(extra,row){
  const logical=typeof row==='string'?row:row?.logical||row?.asset?.logical;
  const source=logical&&extra.assets[logical]||row?.asset||row;
  requireValue(source?.exists&&digest.test(source.sha256||'')&&source.url,
    `Icon Boss Thế Giới chưa được kiểm: ${logical||'unknown'}.`);
  return source;
}
export function mergeWorldBossHud(hud,extra,baseSha256){
  validateWorldBossCatalog(extra,baseSha256);
  const images=[];
  for(const row of extra.ui?.skillIcons||[]){
    const source=iconSource(extra,row);
    (hud.skills||={})[row.nId]={...hud.skills?.[row.nId],...row,asset:source,logical:source.logical};
    (hud.resources||={})[source.logical]=source;images.push(source);
  }
  for(const [id,row] of Object.entries(extra.ui?.buffIcons||{})){
    const source=iconSource(extra,row);
    (hud.resources||={})[source.logical]=source;images.push(source);
  }
  hud.m81330SupplementIcons=images;return hud;
}
export function mergeWorldBossMenus(ui,extra,baseSha256){
  mergeWorldBossHud(ui.hud,extra,baseSha256);ui.worldBoss=extra;
  for(const [logical,source] of Object.entries(extra.assets))ui.resources.set(logical,source);
  const map=extra.maps[WORLD_BOSS_MAP],miniKey='loading.map40002Mini';
  ui.loadingPresentation.assets[miniKey]=map.minimap;
  ui.loadingPresentation.maps[WORLD_BOSS_MAP]={name:'Cứ địa Lunar [Boss Thế Giới]',miniKey};
  ui.m3.maps[WORLD_BOSS_MAP]={name:'Cứ địa Lunar',preview:map.gui||map.minimap};
  return ui;
}

/** Stable Flash server spawns this scene-only visual directly through S1556.
 * It is not a pickup/usable Prop, so never manufacture a gameplay Prop row or
 * relax ActiveObjectLayer's visibility rule for any other template/map. */
export function worldBossDirectSceneVisual(catalog,template,object,state){
  const extra=catalog?.worldBossCatalog;
  return isWorldBossScene(state)&&Number(object?.templateId)===10200971
    &&(object.objectId>>>26)===4&&Number(template?.nItemId)===10200971
    &&extra?.source?.packageSha256==='9a4f2583ea63b6e3b21e3f3b585ab6031fbf74afffb1277c555cf1d434b33dda'
    &&extra.bindings?.sceneItems?.['10200971']?.nItemId===10200971
    &&['szCoverSwf','szCoverEnemySwf','szCoverNeutralSwf'].every(key=>
      template.resources?.[key]?.sha256==='d0d684ecde2762b14e3c7bb4dcec2974f73250818e3106ae271c50f7e93c2d20');
}
