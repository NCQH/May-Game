import {visualPosition} from './combat_state.js';
import {resourceSequence} from './battle_effects.js';
import {deathScoreView} from './m811_death.js';

/** Display only. Ownership, capture seconds and score are S1565/S1731/S1732. */
export function drawNativeFlags(view,state,now,progressOnly=false) {
  const resources=view.prepared.catalog.modePresentation?.resources;
  if(!resources)return;
  const self=state.actors[String(state.selfObjectId)];
  for(const definition of view.prepared.map.flags||[]) {
    const flag=state.flags?.[String(definition.index)]||definition;
    const [x,y]=definition.position;
    if(progressOnly){
      if(!flag.progress)continue;
      const camp=flag.progress<0?1:2,color=camp===self?.camp?'blue':'red';
      const sequence=resourceSequence(view.store,resources['capture_'+color]);
      if(sequence){
        const frame=Math.trunc(Math.abs(flag.progress)*100/(definition.capture_ms/1000));
        view.drawSequence(sequence,Math.max(0,Math.min(sequence.frames.length-1,frame-1)),x,y,0,1,{autoCenter:true});
      }
      continue;
    }
    const ground=resources.flag_ground;
    if(ground)view.drawFrame(ground,{sx:0,sy:0,w:ground.width,h:ground.height,
      offsetX:-ground.width/2,offsetY:-ground.height/2},x,y);
    const color=!flag.camp?'null':flag.camp===self?.camp?'blue':'red';
    const sequence=resourceSequence(view.store,resources['flag_'+color]);
    if(sequence)view.drawSequence(sequence,Math.floor(Math.max(0,now-(flag.changedAt??0))/sequence.frameMs)%sequence.frames.length,x-36,y-60);
  }
}

export function routeProgress(route,point) {
  let total=0,best=Infinity,travel=0,at=0;
  for(let i=1;i<(route?.length||0);i++) {
    const [ax,ay]=route[i-1],[bx,by]=route[i],dx=bx-ax,dy=by-ay,length=Math.hypot(dx,dy);
    if(!length)continue;
    const t=Math.max(0,Math.min(1,((point.x-ax)*dx+(point.y-ay)*dy)/(length*length)));
    const distance=(point.x-ax-dx*t)**2+(point.y-ay-dy*t)**2;
    if(distance<best){best=distance;at=travel+length*t;}
    travel+=length;total+=length;
  }
  return total?Math.max(0,Math.min(1,at/total)):0;
}

export function modeScoreView(state,catalog,now) {
  const death=deathScoreView(state);if(death)return death;
  const map=catalog.maps?.[String(state.mapId)],objects=Object.values(state.objects||{});
  if(map?.flags?.length){
    const count=camp=>Object.values(state.flags||{}).filter(flag=>flag.camp===camp).length;
    return {style:'occupy',progress:[(state.scores.camp1??0)/1000,(state.scores.camp2??0)/1000],
      flagCounts:[count(1),count(2)],camp1:`${state.scores.camp1??0}`,camp2:`${state.scores.camp2??0}`,label:'1000',
      detail:`Cứ điểm: ${count(1)} / ${count(2)}`};
  }
  if(map?.bombCarts?.length){
    const value=camp=>{
      const cart=objects.find(row=>!row.removed&&row.camp===camp&&Number(row.templateId)===1601);
      const route=map.bombCarts.find(row=>row.camp===camp)?.route;
      return cart?(cart.dead?'0%':`${Math.floor(routeProgress(route,visualPosition(cart,now))*100)}%`):'—';
    };
    const camp1=value(1),camp2=value(2);
    return {style:'home',progress:[parseFloat(camp1)/100,parseFloat(camp2)/100],camp1,camp2,label:'Xe bom'};
  }
  if([12,14,50,169].includes(Number(state.mapId))){
    const value=camp=>{
      const base=objects.find(row=>row.camp===camp&&Number(map.npcTemplates?.[String(row.templateId)]?.raw?.iType)===3);
      // HomeModeProxy truncates the percentage, keeping 1% while HP is positive.
      return base&&base.maxHp>0?`${Math.max(base.hp>0?1:0,Math.min(100,Math.floor(base.hp/base.maxHp*100)))}%`:'—';
    };
    const camp1=value(1),camp2=value(2);
    return {style:'home',progress:[parseFloat(camp1)/100,parseFloat(camp2)/100],camp1,camp2,label:'Căn cứ'};
  }
  return null;
}
