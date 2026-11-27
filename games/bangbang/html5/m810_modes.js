import {PK_MAPS,pkMapName,pkObjectiveText} from './m89_pk_maps.js';
import {DEATH_MAPS,isDeathMap} from './m811_death.js';
import {isPveMap} from './m81314_protocol.js';
import {WORLD_BOSS_MAP} from './m81330_protocol.js';

export const OBJECTIVE_MAPS=Object.freeze([
  {mapId:12,mode:'base_mineral',name:'Tranh Đoạt Tinh Khoáng',group:'Phá trụ'},
  {mapId:14,mode:'base_ruins',name:'Di Tích Maya',group:'Phá trụ'},
  {mapId:50,mode:'base_town',name:'Thị Trấn Ánh Dương',group:'Phá trụ'},
  {mapId:169,mode:'base_polar',name:'Địa Cực Dota',group:'Phá trụ'},
  {mapId:7,mode:'occupy_desert',name:'Việt Dã',group:'Chiếm cứ điểm'},
  {mapId:9,mode:'occupy_tomb',name:'Cổ Mộ',group:'Chiếm cứ điểm'},
  {mapId:10,mode:'occupy_freight',name:'Trung Tâm Vận Chuyển',group:'Chiếm cứ điểm'},
  {mapId:37,mode:'occupy_military',name:'Quân Khu Tử Thần',group:'Chiếm cứ điểm'},
  {mapId:170,mode:'occupy_quicksand',name:'Vùng Cát Lún',group:'Chiếm cứ điểm'},
  {mapId:70,mode:'escort_bomb',name:'Hộ Tống Xe Bom',group:'Hộ tống'},
]);
// Existing native test_desert room: same map7 assets, different server rules.
// Keep it out of OBJECTIVE_MAPS and the server's ranked map pool.
export const PRACTICE_MAP=Object.freeze({mapId:7,mode:'test_desert',name:'Việt Dã luyện tập',group:'Luyện tập'});
export const BATTLE_MAPS=Object.freeze([...PK_MAPS.map(row=>({...row,group:'PK'})),...OBJECTIVE_MAPS,...DEATH_MAPS,PRACTICE_MAP]);
export const isBattleMap=id=>BATTLE_MAPS.some(row=>row.mapId===Number(id))||isPveMap(id)||Number(id)===WORLD_BOSS_MAP;
export const isBattleMode=mode=>BATTLE_MAPS.some(row=>row.mode===mode);
// Read the acknowledged native room, never a next-match preference. Ordinary
// map7 and ranked map7 must retain their capture-point labels and clock.
export const isPracticeRoom=room=>Number(room?.mapId)===7&&Number(room?.roomType)===2
  &&room?.name==='Phòng test tank - Việt Dã';
export const battleMapName=(id,room=null)=>Number(id)===7&&isPracticeRoom(room)?PRACTICE_MAP.name
  :Number(id)===WORLD_BOSS_MAP?'Cứ địa Lunar · Boss Thế Giới'
  :isPveMap(id)?room?.name||`PvE · Màn ${Number(id)}`:BATTLE_MAPS.find(row=>row.mapId===Number(id))?.name||pkMapName(id);
export const battleObjectiveText=(id,room=null)=>{
  if(Number(id)===WORLD_BOSS_MAP)return 'Boss Thế Giới · HP chung toàn server · Hồi sinh 5 giây · Thu 8 năng lượng để thay kỹ năng E';
  if(Number(id)===7&&isPracticeRoom(room))return 'Luyện chiêu · 5 tank Lv6 · Hồi sinh sau 5 giây · Không giới hạn giờ';
  if(isPveMap(id))return 'PvE đơn · 3 mạng · 15 phút · Hoàn thành mục tiêu của màn';
  if(isDeathMap(id))return 'Một mạng mỗi vòng · Thắng 2 vòng';
  const row=OBJECTIVE_MAPS.find(row=>row.mapId===Number(id));
  return row?.group==='Phá trụ'?'Phá hủy căn cứ đối phương · 15 phút'
    :row?.group==='Chiếm cứ điểm'?'Giữ cứ điểm · 1.000 điểm · 10 phút'
    :Number(id)===70?'Hộ tống xe bom về đích · 15 phút':pkObjectiveText(id);
};

export async function loadModeCatalog(url='./m810_modes_catalog.json') {
  const response=await fetch(url,{cache:'no-store'});
  if(!response.ok)throw new Error('Không tải được tài nguyên các chế độ chiến đấu.');
  return response.json();
}

/** Additive native definitions. Map7 already existed as a test map; replace
 * only that definition, with the same original geometry source checksum. */
export function mergeModeCatalog(catalog,extra,baseSha256) {
  if(extra?.schemaVersion!==1||extra.source?.m6CatalogSha256!==baseSha256
      ||extra.mapChoices?.length!==OBJECTIVE_MAPS.length||OBJECTIVE_MAPS.some(m=>
        !extra.mapChoices.some(row=>row.mapId===m.mapId&&row.mode===m.mode)))
    throw new Error('Tài nguyên chế độ chiến đấu không khớp client.');
  for(const [logical,resource] of Object.entries(extra.assets||{})) {
    const previous=catalog.assets[logical];
    if(resource.reuseM6) {
      const sourceMissing=resource.sha256===null&&previous?.exists===false&&previous?.status==='source_missing';
      if(!previous||(!sourceMissing&&previous.sha256!==resource.sha256))throw new Error(`Sai tài nguyên dùng chung: ${logical}`);
    } else {
      if(previous&&previous.sha256!==resource.sha256)throw new Error(`Trùng tài nguyên khác nội dung: ${logical}`);
      catalog.assets[logical]=previous||resource;
    }
  }
  for(const [table,rows] of Object.entries(extra.bindings||{})) {
    if(!['skills','buffs','exhibits','sceneItems','aiNPCs','aiArms','mapNPCs','appearances'].includes(table))throw new Error('Bảng chế độ không hợp lệ');
    catalog[table]||={};
    for(const [id,row] of Object.entries(rows))catalog[table][id]={...catalog[table][id],...row,
      ...(row.resources?{resources:{...catalog[table][id]?.resources,...row.resources}}:{})};
  }
  for(const [id,map] of Object.entries(extra.maps||{})) {
    if(!OBJECTIVE_MAPS.some(row=>row.mapId===Number(id)))throw new Error('Bản đồ ngoài danh sách đã kiểm');
    if(catalog.maps[id]&&Number(id)!==7)throw new Error('Trùng bản đồ đã có');
    if(Number(id)===7&&catalog.maps[id]?.source?.sha256&&catalog.maps[id].source.sha256!==catalog.assets[map.source.assetRef]?.sha256)
      throw new Error('Bản đồ Việt Dã không khớp bản gốc');
    catalog.maps[id]=map;
  }
  for(const [id,row] of Object.entries(extra.dependencies||{}))catalog.dependencyManifests.maps[id]=row;
  for(const [kind,rows] of Object.entries(extra.runtime||{})) {
    const table=catalog.dependencyManifests.runtime[kind]||={};
    for(const [id,row] of Object.entries(rows))table[id]={...table[id],...row,
      logicalResources:[...new Set([...(table[id]?.logicalResources||[]),...row.logicalResources])]};
  }
  catalog.modePresentation={maps:extra.hudMaps,resources:extra.presentation,skillText:extra.skillText};
  return catalog;
}
