import {isWorldBossScene} from './m81330_protocol.js';
import {worldBossClock} from './m81330_state.js';
const number=value=>new Intl.NumberFormat('vi-VN').format(value);
const time=seconds=>seconds===null?'—:—':`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;

export function worldBossHudRow(state,worldBoss,now=performance.now()){
  if(!isWorldBossScene(state)||!worldBoss?.received)return null;
  const {hp,maxHp,ownDamage,ownRank}=worldBoss;
  const clock=worldBossClock(worldBoss,now);
  return {hp,maxHp,ownDamage,ownRank,clock,
    frameIndex:Math.max(0,Math.min(99,Math.trunc(hp*100/maxHp)-1))};
}

/** WorldBossHPProxy uses the same native bossBloodBar.swf as PvE. The source
 * PveObjManager places its whole frame above worldHeight−120. */
export function drawWorldBossHud(view,state,now){
  const row=worldBossHudRow(state,view.client.state.worldBoss,now);
  const bar=view.prepared?.pveBossCatalog?.bossBar;
  if(!row||!bar)return;
  const frame=bar.frames[row.frameIndex],asset=frame?.asset||bar.asset;
  const image=view.store.image(asset);if(!frame||!image)return;
  const left=Math.trunc((view.width-bar.width)/2),top=view.height-120-66;
  view.surface.draw(image,{sx:frame.sx,sy:frame.sy,sw:frame.w,sh:frame.h,
    x:left+frame.offsetX+frame.w/2,y:top+frame.offsetY+frame.h/2,width:frame.w,height:frame.h});
  const c=view.context;c.save();c.textAlign='center';c.textBaseline='top';
  c.font='bold 15px Tahoma, sans-serif';c.fillStyle='#fff';c.strokeStyle='#173847';c.lineWidth=3;
  const write=(text,y)=>{c.strokeText(text,view.width/2,y);c.fillText(text,view.width/2,y);};
  write(`Kẻ Hủy Diệt · ${number(row.hp)} / ${number(row.maxHp)} HP`,top+6);
  c.font='bold 13px Tahoma, sans-serif';c.fillStyle='#fff49a';
  write(`Sát thương: ${number(row.ownDamage)} · Hạng: ${row.ownRank||'—'} · ${row.clock.awaiting?'Chờ xác nhận kết thúc':time(row.clock.seconds)}`,top+37);
  c.restore();
}
