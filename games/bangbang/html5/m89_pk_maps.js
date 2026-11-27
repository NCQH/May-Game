/** The existing native PK modes, not a client-side game-rule implementation. */
export const PK_MAPS = Object.freeze([
  {mapId:19,mode:'pk_robo',name:'Robo – Star Wars'},
  {mapId:1,mode:'pk_maya',name:'Lời Tiên Tri Maya'},
  {mapId:4,mode:'pk_snow',name:'Băng Thiên Tuyết Địa'},
  {mapId:17,mode:'pk_fastfood',name:'Quán Ăn Vui Vẻ'},
  {mapId:18,mode:'pk_totem',name:'Vật Tổ'},
  {mapId:20,mode:'pk_cow',name:'Dắt Bò'},
  {mapId:21,mode:'pk_lightning',name:'Điện Chớp Sấm Rền'},
  {mapId:34,mode:'pk_polar',name:'Tiền Đồn Cực Địa'},
  {mapId:35,mode:'pk_fortress',name:'Pháo Đài Không Gian'},
  {mapId:36,mode:'pk_mine',name:'Khu Mỏ Phóng Xạ'},
]);
export const isPKMap = id => PK_MAPS.some(map => map.mapId === Number(id));
export const isPKMode = mode => PK_MAPS.some(map => map.mode === mode);
export const pkMapName = id => PK_MAPS.find(map => map.mapId === Number(id))?.name
  || ({0:'Bản đồ ngẫu nhiên',7:'Sân tập sa mạc'}[id]) || `Bản đồ ${id}`;

export const pkObjectiveText = id => ({
  1:'Diệt đối thủ, hoàn thành nhiệm vụ Tù Trưởng',
  17:'Diệt đối thủ, tận dụng trụ hồi phục',
  18:'Diệt đối thủ, tranh đoạt Vật Tổ',
  20:'Dẫn bò đối phương về chuồng đội mình',
  21:'Diệt đối thủ, kiểm soát trụ năng lượng',
  35:'Diệt đối thủ, tận dụng cổng dịch chuyển',
  36:'Hộ tống xe mỏ về căn cứ',
}[Number(id)] || 'Tiêu diệt đối thủ, kiếm điểm');

/** Native PortalPointView, 24 Hz. The audited cd.swf stops at frame 23. */
export function portalFrame(sequence, elapsedMs) {
  const count = sequence.frames.length;
  const tick = Math.max(0, Math.floor(elapsedMs / (1000 / 24)));
  const stop = sequence.derived?.nativeStopFrame;
  return stop ? Math.min(count - 1, stop - 1, tick) : tick % count;
}

export async function loadPKCatalog(url = './m89_pk_catalog.json') {
  const response = await fetch(url, {cache:'no-store'});
  if (!response.ok) throw new Error('Không tải được tài nguyên bản đồ PK.');
  const bytes = await response.arrayBuffer();
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
    .map(value => value.toString(16).padStart(2,'0')).join('');
  return {catalog:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),sha256,bytes:bytes.byteLength};
}

export function mergePKCatalog(catalog, extra, baseSha256) {
  if (extra?.schemaVersion !== 1 || extra.source?.m6CatalogSha256 !== baseSha256)
    throw new Error('Tài nguyên PK không khớp bản client hiện tại.');
  if (extra.mapChoices?.length !== PK_MAPS.length || PK_MAPS.some(map =>
    !extra.mapChoices.some(row => row.mapId === map.mapId && row.mode === map.mode)))
    throw new Error('Danh sách bản đồ PK không khớp.');
  for (const [logical, resource] of Object.entries(extra.assets || {})) {
    const previous = catalog.assets[logical];
    if (resource.reuseM6) {
      if (!previous || (previous.sha256 ?? null) !== resource.sha256)
        throw new Error(`Tài nguyên PK dùng chung không khớp: ${logical}.`);
    } else {
      if (previous && previous.sha256 !== resource.sha256)
        throw new Error(`Tài nguyên PK trùng với nội dung khác: ${logical}.`);
      catalog.assets[logical] = previous || resource;
    }
  }
  for (const [table, rows] of Object.entries(extra.bindings || {})) {
    if (!['skills','buffs','exhibits','sceneItems','aiNPCs','aiArms','mapNPCs','appearances'].includes(table))
      throw new Error('Bảng tài nguyên PK không hợp lệ.');
    catalog[table] ||= {};
    for (const [id,row] of Object.entries(rows)) {
      const previous = catalog[table][id];
      // Preserve Guild bindings merged earlier and the existing renderer
      // contracts. This sidecar only adds native map resource fields.
      catalog[table][id] = {...previous,...row,
        ...(row.resources ? {resources:{...previous?.resources,...row.resources}} : {})};
    }
  }
  for (const [id,map] of Object.entries(extra.maps || {})) {
    if (!isPKMap(id) || Number(id) === 19 || catalog.maps[id])
      throw new Error('Bản đồ PK mới ghi đè bản đồ đã có.');
    catalog.maps[id] = map;
  }
  for (const [id,dependency] of Object.entries(extra.dependencies || {})) {
    if (!isPKMap(id) || !catalog.maps[id]) throw new Error('Thiếu định nghĩa map PK.');
    const previous = catalog.dependencyManifests.maps[id] || {};
    catalog.dependencyManifests.maps[id] = {...previous,...dependency,
      logicalResources:[...new Set([...(previous.logicalResources || []),...dependency.logicalResources])]};
  }
  for (const [kind,rows] of Object.entries(extra.runtime || {})) {
    const table = catalog.dependencyManifests.runtime[kind] ||= {};
    for (const [id,dependency] of Object.entries(rows)) {
      const previous = table[id] || {};
      table[id] = {...previous,...dependency,
        logicalResources:[...new Set([...(previous.logicalResources || []),...dependency.logicalResources])]};
    }
  }
  catalog.pkPresentation = {maps:extra.hudMaps};
  return catalog;
}
