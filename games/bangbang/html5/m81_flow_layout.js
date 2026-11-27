// Literal SelectTankFrameNew + BattleLoadingView.initPvpCell / loading MXML.
// No transport or native gameplay state is modified here.
export const SELECTION_CATEGORIES=[{id:4,key:'all',label:'Tất cả'},{id:1,key:'attack',label:'Tấn công'},{id:2,key:'panzer',label:'Phòng thủ'},{id:3,key:'assist',label:'Hỗ trợ'}];
export function selectionTanks(tanks,catalog,category=4,query=''){
 const q=query.toLocaleLowerCase('vi');return tanks.filter(t=>t.containerType===0&&!catalog.tanks[t.tankId]?.deferred&&(category===4||catalog.tanks[t.tankId]?.classification===category)&&`${catalog.tanks[t.tankId]?.name||''} ${t.tankId}`.toLocaleLowerCase('vi').includes(q)).sort((a,b)=>(b.level||1)-(a.level||1)||b.tankId-a.tankId);
}
export const LOADING_CAMP_POSITIONS=Object.freeze({1:[[-10,205],[190,101],[190,308],[-10,0],[-10,409]],2:[[778,205],[575,101],[575,308],[778,0],[778,409]]});
