import {bindSupplementCannon} from './m81314_file_timeline.js';

// M81319's three explicitly approved native kits. This sidecar supplies art
// and typed preload bindings only; packets and the native server own unlocks,
// ownership, stats, damage, skill replacement and all other game state.
export const M81319_TANKS = Object.freeze({10000094:761,10000097:791,10000113:892});
const ids=Object.keys(M81319_TANKS),externals=new Set(Object.values(M81319_TANKS).map(String));
const loads=new Map();
const optionalMicros=new Set(['zh_CN/avatar/micro/laowan_small.png','zh_CN/avatar/micro/shiguangnvshen_small.png']);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const bindings=new Set(['skills','buffs','exhibits','sceneItems','aiNPCs','aiArms','mapNPCs','appearances']);
const visualFields=new Set(['resources','body','cannon','engine','rendererBinding','sourceOrdinal','sourceTable',
  '_ordinal','anchor','anchorSource','swfPlacement','szName','szBuffName','szBuffDesc','szBuffIcon','szBuffMp3',
  'szBuffSwf','szIconPath1','szIconPath2','szIconPath3','szSkillName','szSkillDesc','szAppearMovie','szDeadMp3',
  'szHitMp3','szExplodeSound','szFireSound','szCoverMp3','szRemoveMp3','szImageFile','szBrokenImage1',
  'szBrokenImage2','szBrokenImage3','szDestorySwf','szHeadImage','szLeftImage','szAllSound','szPartSound']);

export async function loadM81319Tanks(url='./m81319_tanks_catalog.json',{refresh=false}={}){
  if(refresh)loads.delete(url);
  if(!loads.has(url))loads.set(url,(async()=>{
    const response=await fetch(url,{cache:'no-store'});
    if(!response.ok)throw new Error('Không tải được tài nguyên ba tank bổ sung.');
    const bytes=await response.arrayBuffer();
    const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
      .map(value=>value.toString(16).padStart(2,'0')).join('');
    const catalog=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    validateM81319Tanks(catalog,catalog.source?.m6CatalogSha256);
    return {catalog,sha256,bytes:bytes.byteLength};
  })().catch(error=>{loads.delete(url);throw error;}));
  return loads.get(url);
}

export function validateM81319Tanks(extra,baseSha256){
  if(extra?.schemaVersion!==1||!/^[a-f0-9]{64}$/.test(baseSha256||'')
      ||extra.source?.m6CatalogSha256!==baseSha256)
    throw new Error('Tài nguyên ba tank không khớp bản client đã đối chiếu.');
  if(!same(Object.keys(extra.tanks||{}).sort(),ids.slice().sort())
      ||!same(Object.keys(extra.dependencyManifests?.tanks||{}).sort(),ids.slice().sort()))
    throw new Error('Danh sách ba tank bổ sung không đúng phạm vi.');
  for(const id of ids){
    const external=String(M81319_TANKS[id]),tank=extra.tanks[id],manifest=extra.dependencyManifests.tanks[id];
    if(Number(tank.tankId)!==Number(id)||!same(Object.keys(manifest.baseByExternal||{}),[external])
        ||Object.keys(manifest.skins||{}).length||manifest.baseByExternal[external].nativeSupport!=='ready'
        ||(tank.supportedSkinIds||[]).length)
      throw new Error(`Ngoại hình tank ${id} chưa được xác minh hoặc mở thêm skin ngoài phạm vi.`);
    for(const field of ['baseExternalByLevel','botExternalByLevel'])
      if(!same(Object.keys(tank[field]||{}).sort(),['1','2','3','4','5','6'])
          ||Object.values(tank[field]).some(value=>Number(value)!==Number(external)))
        throw new Error(`Ngoại hình player/bot của tank ${id} không đúng nguồn.`);
    if(!extra.bindings?.appearances?.[external])throw new Error(`Thiếu ngoại hình tank ${id}.`);
    for(const logical of manifest.baseByExternal[external].logicalResources||[]){
      const source=extra.assets?.[logical];
      if(!source?.exists||!['ready','ready-derived'].includes(source.status))
        throw new Error(`Thiếu tài nguyên bắt buộc của tank ${id}: ${logical}.`);
    }
  }
  for(const [logical,source]of Object.entries(extra.assets||{})){
    if(source.exists&&['ready','ready-derived'].includes(source.status))continue;
    // Native generic-micro originals for exactly these two tanks are absent
    // from all supplied inputs. The established minimap camp marker remains;
    // no full portrait is fabricated, scaled or relabelled as a micro icon.
    if(optionalMicros.has(logical)&&source.exists===false&&source.status==='source_missing'
        &&extra.optionalSourceGaps?.[logical]&&source.optional===true)continue;
    throw new Error(`Tài nguyên bổ sung chưa đủ nguồn hoặc chưa giải mã: ${logical}.`);
  }
  if(Object.keys(extra.optionalSourceGaps||{}).some(logical=>!optionalMicros.has(logical)))
    throw new Error('Không bỏ qua tài nguyên bắt buộc ngoài hai ảnh micro đã xác minh thiếu nguồn.');
  return extra;
}

/** Call hydrateM6Catalog(extra) BEFORE this merge. Frame references belong to
 * the supplemental namespace; never look them up in an older atlas catalog.
 */
export function mergeM81319Tanks(catalog,extra,baseSha256){
  validateM81319Tanks(extra,baseSha256);
  const writes=[];
  for(const id of ids){
    if(catalog.tanks[id]||catalog.dependencyManifests.tanks[id])
      throw new Error(`Tank ${id} đã có trong nền; không ghi đè danh mục kế thừa.`);
    writes.push(()=>{catalog.tanks[id]=extra.tanks[id];catalog.dependencyManifests.tanks[id]=extra.dependencyManifests.tanks[id];});
  }
  for(const [logical,resource] of Object.entries(extra.assets||{})){
    const previous=catalog.assets[logical];
    if(previous&&(previous.sha256??null)!==(resource.sha256??null)
        &&(resource.explicitOverride!==true||resource.expectedBeforeSha256!==(previous.sha256??null)))
      throw new Error(`Tài nguyên ba tank ghi đè nguồn chưa được duyệt: ${logical}.`);
    if(resource.status==='quarantined'&&previous?.exists)continue;
    writes.push(()=>{catalog.assets[logical]=resource;});
  }
  for(const [table,rows] of Object.entries(extra.bindings||{})){
    if(!bindings.has(table))throw new Error(`Bảng ba tank không hợp lệ: ${table}.`);
    for(const [id,row] of Object.entries(rows)){
      const previous=catalog[table]?.[id];
      if(previous)for(const [field,value]of Object.entries(row))
        if(!visualFields.has(field)&&Object.hasOwn(previous,field)&&!same(previous[field],value))
          throw new Error(`Không cho tài nguyên đổi luật combat cũ: ${table}/${id}/${field}.`);
      const merged={...previous,...row,
        ...(row.resources?{resources:{...previous?.resources,...row.resources}}:{})};
      // Validate the native root clock before committing any catalog write.
      if(table==='appearances')bindSupplementCannon(merged.cannon);
      writes.push(()=>{catalog[table]||={};catalog[table][id]=merged;});
    }
  }
  for(const [kind,rows]of Object.entries(extra.dependencyManifests.runtime||{})){
    if(!['skill','buff','scene','npc','mapNpc','appearance'].includes(kind))
      throw new Error(`Loại preload ba tank không hợp lệ: ${kind}.`);
    for(const [id,row]of Object.entries(rows))writes.push(()=>{
      const target=catalog.dependencyManifests.runtime[kind]||={},previous=target[id];
      target[id]={...previous,...row,
        logicalResources:[...new Set([...(previous?.logicalResources||[]),...(row.logicalResources||[])])]};
    });
  }
  for(const write of writes)write();
  catalog.botPool=[...new Set([...(catalog.botPool||[]),...ids.map(Number)])];
  catalog.m81319Tanks=extra;
  return catalog;
}

function sourceFor(extra,entry){
  const logical=typeof entry==='string'?entry:entry?.logical||entry?.icon||entry?.asset?.logical;
  const source=logical&&extra.assets?.[logical]||entry?.asset;
  if(!source?.exists||!['ready','ready-derived'].includes(source.status)
      ||!/^[a-f0-9]{64}$/.test(source.sha256||''))
    throw new Error(`Icon ba tank chưa được xác minh: ${logical||'không có nguồn'}.`);
  return source;
}

export function mergeM81319Hud(hud,extra,baseSha256){
  validateM81319Tanks(extra,baseSha256);
  for(const [external,row]of Object.entries(extra.ui?.portraits||{})){
    if(!externals.has(external))throw new Error('Chân dung mới nằm ngoài ba tank được duyệt.');
    if(!['ready','ready-derived'].includes(row.status))throw new Error(`Chân dung ${external} chưa đủ tài nguyên.`);
    if(hud.portraits[external])throw new Error(`Không ghi đè chân dung cũ ${external}.`);
    hud.portraits[external]=row;
  }
  const icons=[];
  for(const [id,row]of Object.entries(extra.ui?.skillIcons||{})){
    const source=sourceFor(extra,row);
    hud.skills[id]={...hud.skills[id],...(typeof row==='object'?row:{}),nId:Number(id),logical:source.logical,asset:source};
    (hud.resources||={})[source.logical]=source;
    icons.push(source);
  }
  for(const row of Object.values(extra.ui?.extraSkillIcons||{})){
    const source=sourceFor(extra,row);
    (hud.resources||={})[source.logical]=source;
    for(const [id,previous]of Object.entries(hud.skills||{}))
      if(previous.logical===source.logical)hud.skills[id]={...previous,asset:source};
    icons.push(source);
  }
  hud.m81319SupplementIcons=icons;
  return hud;
}

export function mergeM81319Menus(ui,extra,baseSha256){
  mergeM81319Hud(ui.hud,extra,baseSha256);
  for(const id of ids){
    const previous=ui.garage.tanks[id],tank=extra.tanks[id],external=M81319_TANKS[id];
    if(!previous||!ui.hud.portraits[external])throw new Error(`Thiếu giao diện gốc tank ${id}.`);
    // This removes a presentation gate only. Every button still reads actual
    // C165/C105x ownership, item UUID and native acknowledgements unchanged.
    ui.garage.tanks[id]={...previous,deferred:false};
    const logical=previous.microIcon||`zh_CN/avatar/micro/${tank.base.szMicroHead}`;
    const icon=extra.assets?.[logical];
    if(icon?.exists){ui.resources.set(logical,icon);ui.m3.tanks[id]={...ui.m3.tanks[id],icon,iconMissingReason:null};}
  }
  for(const [external,row]of Object.entries(extra.ui?.selectionHeads||{})){
    if(!externals.has(external))throw new Error('Ảnh chọn tank mới nằm ngoài phạm vi.');
    ui.panels.selectionHeads[external]=row;
  }
  for(const row of Object.values(extra.ui?.itemIcons||{})){
    const source=sourceFor(extra,row);
    ui.resources.set(source.logical,source);
    // These are filename-keyed original assets, not new item definitions.
    // Existing item/skin IDs, readiness and native ownership are untouched.
  }
  for(const row of [...Object.values(extra.ui?.skillIcons||{}),...Object.values(extra.ui?.extraSkillIcons||{})]){
    const source=sourceFor(extra,row);ui.resources.set(source.logical,source);
  }
  return ui;
}
