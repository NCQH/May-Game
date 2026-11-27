// Visual-only repairs found by the complete native Skill/Item icon audit.
// This module cannot add an item, grant a skin, change readiness or combat data.
const loads=new Map();
const hex=value=>/^[a-f0-9]{64}$/.test(value||'');

export async function loadM81328Icons(url='./m81328_icons_catalog.json',{refresh=false}={}){
  if(refresh)loads.delete(url);
  if(!loads.has(url))loads.set(url,(async()=>{
    const response=await fetch(url,{cache:'no-store'});
    if(!response.ok)throw new Error('Không tải được danh mục icon gốc bổ sung.');
    const bytes=await response.arrayBuffer();
    const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
      .map(value=>value.toString(16).padStart(2,'0')).join('');
    const catalog=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    validateM81328Icons(catalog,catalog.source?.m6CatalogSha256);
    return {catalog,sha256,bytes:bytes.byteLength};
  })().catch(error=>{loads.delete(url);throw error;}));
  return loads.get(url);
}

export function validateM81328Icons(extra,baseSha256){
  if(extra?.schemaVersion!==1||!hex(baseSha256)||extra.source?.m6CatalogSha256!==baseSha256)
    throw new Error('Icon bổ sung không khớp bản client đã đối chiếu.');
  for(const [logical,asset]of Object.entries(extra.assets||{})){
    if(!/^zh_CN\/icon\/(skills|item)\/[^/]+\.(png|jpe?g)$/.test(logical)
        ||asset.logical!==logical||!asset.exists||asset.status!=='ready'||!hex(asset.sha256)
        ||!Number.isInteger(asset.bytes)||asset.bytes<=0||!(asset.width>2)||!(asset.height>2)
        ||!/^\/html5\/assets\/m813(?:14|19|28)\//.test(asset.url||''))
      throw new Error(`Icon chưa có nguồn ảnh hợp lệ: ${logical}.`);
  }
  for(const [table,allowed]of Object.entries({
    skills:['icon','expectedBeforeIcon','sourceOrdinal'],items:['icon','expectedBeforeIcon','sourceOrdinal'],
    hudSkills:['logical','szIconPath1','expectedBeforeLogical','expectedBeforeAssetSha256']})){
    for(const [id,row]of Object.entries(extra[table]||{})){
      if(!(/^[0-9]+(?::[0-9]+)?$/.test(id))||Object.keys(row).some(key=>!allowed.includes(key))
          ||!extra.assets[row.icon||row.logical])
        throw new Error(`Không cho danh mục icon đổi dữ liệu ngoài hiển thị: ${table}/${id}.`);
    }
  }
  return extra;
}

export function mergeM81328Hud(hud,extra,baseSha256){
  validateM81328Icons(extra,baseSha256);
  const writes=[];
  for(const [id,row]of Object.entries(extra.hudSkills||{})){
    const previous=hud.skills?.[id],asset=extra.assets[row.logical];
    const already=previous?.logical===row.logical&&previous?.asset?.sha256===asset.sha256;
    if(!previous||!already&&(previous.logical!==row.expectedBeforeLogical
        ||previous.asset?.sha256!==row.expectedBeforeAssetSha256))
      throw new Error(`Icon kỹ năng ${id} không khớp nền đã đối chiếu.`);
    writes.push(()=>{
      hud.skills[id]={...previous,logical:row.logical,szIconPath1:row.szIconPath1,asset};
      (hud.resources||={})[row.logical]=asset;
    });
  }
  for(const write of writes)write();
  hud.m81328SupplementIcons=Object.values(extra.assets);
  return hud;
}

export function mergeM81328Menus(ui,extra,baseSha256){
  validateM81328Icons(extra,baseSha256);
  const writes=[];
  for(const table of ['skills','items'])for(const [id,row]of Object.entries(extra[table]||{})){
    const previous=ui.garage[table]?.[id];
    if(!previous||![row.expectedBeforeIcon,row.icon].includes(previous.icon))
      throw new Error(`Icon ${table}/${id} không khớp nền; không thêm vật phẩm hoặc kỹ năng.`);
    writes.push(()=>{ui.garage[table][id]={...previous,icon:row.icon};});
  }
  mergeM81328Hud(ui.hud,extra,baseSha256);
  for(const write of writes)write();
  for(const [logical,asset]of Object.entries(extra.assets))ui.resources.set(logical,asset);
  return ui;
}
