import {isWorldBossScene} from './m81330_protocol.js';

export const createWorldBossState=()=>({revision:0,status:null,hp:null,maxHp:null,
  ownDamage:0,ownRank:0,ranks:[],received:false,meta:null,metaAt:null,
  lastRankAt:null,lastStatusAt:null,completed:null});

/** Only accepted native state. A wall-clock estimate drives text, not entry,
 * battle outcomes, HP, rewards, or the start of another round. */
export function applyWorldBossPacket(state,packet,now=performance.now()){
  const next=()=>({...state,revision:state.revision+1});
  if(packet.type==='worldBossStatus'){
    const changed=state.status!==packet.status;
    const value={...next(),status:packet.status,lastStatusAt:now};
    if(changed&&packet.status===2&&state.status===3)
      Object.assign(value,{hp:null,maxHp:null,ownDamage:0,ownRank:0,ranks:[],received:false});
    if(changed&&packet.status===3&&state.received)
      value.completed={roundId:state.meta?.round_id??null,ownDamage:state.ownDamage,
        ownRank:state.ownRank,ranks:state.ranks.map(row=>({...row})),at:now};
    return value;
  }
  if(packet.type==='worldBossRank')return {...next(),hp:packet.hp,maxHp:packet.maxHp,
    ownDamage:packet.ownDamage,ownRank:packet.ownRank,ranks:packet.ranks.map(row=>({...row})),
    received:true,lastRankAt:now};
  if(packet.type==='worldBossMeta'){
    const meta=packet.meta,previous=state.meta;
    if(previous&&(meta.round_id<previous.round_id
        ||meta.round_id===previous.round_id&&meta.revision<previous.revision))return state;
    const value={...next(),meta:structuredClone(meta),metaAt:now};
    // A new round may be announced without an open native leaderboard view.
    // Keep a just-synchronized native rank only if its HP matches this round.
    if(previous&&meta.round_id!==previous.round_id&&!(state.status===meta.state
        &&state.hp===meta.hp&&state.lastRankAt>=state.lastStatusAt))
      Object.assign(value,{ownDamage:0,ownRank:0,ranks:[],received:false});
    return value;
  }
  return state;
}

export function worldBossClock(state,now=performance.now()){
  const meta=state?.meta;
  if(!meta||!Number.isFinite(state.metaAt))return {kind:'unknown',seconds:null,awaiting:false};
  const serverNow=meta.server_now_ms+Math.max(0,now-state.metaAt);
  const deadline=meta.state===2?meta.ends_at_ms:meta.reopens_at_ms;
  if(deadline===null)return {kind:'closed',seconds:null,awaiting:false};
  const seconds=Math.max(0,Math.ceil((deadline-serverNow)/1000));
  return {kind:meta.state===2?'ends':'reopens',seconds,awaiting:seconds===0};
}
export function worldBossView(snapshot,now=performance.now()){
  const s=snapshot?.worldBoss||createWorldBossState(),clock=worldBossClock(s,now);
  const ready=snapshot?.phase==='ready',busy=!!snapshot?.play?.busy;
  const metaFresh=s.meta&&s.metaAt!==null&&now-s.metaAt<=10000;
  const active=s.status===2&&s.meta?.state===2&&clock.kind==='ends'&&!clock.awaiting;
  return {state:s,clock,ready,active,metaFresh,
    inBattle:isWorldBossScene(snapshot?.play?.scene),
    canEnter:ready&&!busy&&snapshot?.play?.phase==='lobby'&&active&&metaFresh,
    hp:s.received?s.hp:null,maxHp:s.received?s.maxHp:null,
    fraction:s.received&&s.maxHp>0?Math.max(0,Math.min(1,s.hp/s.maxHp)):null,
    reward:s.meta?.rewards||null};
}
