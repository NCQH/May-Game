/* Detached, reply-only companion/PvE presentation. Inventory stays in M8. */
export const createCompanionState=()=>({revision:0,activeUuid:'',lastOperation:null});
export const createPveState=()=>({revision:0,cities:{},lastAward:null,lastRecord:null,staminaPurchaseUncertain:false});
export function applyCompanionPacket(state,packet){
  if(packet.type==='companionActive')return {...state,revision:state.revision+1,activeUuid:packet.uuid};
  if(packet.type==='companionOperation')return {...state,revision:state.revision+1,lastOperation:{
    action:packet.action,success:packet.success===1,uuid:packet.uuid,code:packet.code,
    previousValue:packet.previousValue,currentValue:packet.currentValue}};
  return state;
}
export function applyPvePacket(state,packet,{isPve=false}={}){
  // The connection, which knows identity/generation and the pending payment,
  // owns uncertainty clearing. A generic packet cannot authorize a retry.
  if(packet.type==='pveCities'){
    const cities=packet.replace?{}:{...state.cities};
    for(const row of packet.cities)cities[row.cityId]={...row};
    return {...state,revision:state.revision+1,cities};
  }
  if(packet.type==='pveRecord')return {...state,revision:state.revision+1,lastRecord:{
    mapId:packet.mapId,passTime:packet.passTime,useTime:packet.useTime,records:[],nativeStatus:packet.nativeStatus}};
  if(packet.type==='battleStart')return {...state,revision:state.revision+1,lastAward:null};
  if(packet.type==='settleAward'&&packet.kind===1&&isPve)
    return {...state,revision:state.revision+1,lastAward:structuredClone(packet.award)};
  return state;
}
export const cityUnlocked=city=>!!city&&(city.flags&15)===15;
export const cityCleared=(city,hard=false)=>!!city&&(city.flags&(hard?32:16))!==0;
export const cityHardUnlocked=city=>cityUnlocked(city)&&cityCleared(city);
// S1700's name is authoritative on reconnect too. Only the exact server-owned
// suffix in a PvE room represents the offline hard variant; mode stays native1.
export const pveRoomDifficulty=room=>Number(room?.roomType)===4
  &&typeof room.name==='string'&&room.name.endsWith(' (Khó offline)')?1:0;
export const pveGrade=value=>({3:'B',4:'A',5:'S',6:'SS',7:'SSS'}[value]||'—');
