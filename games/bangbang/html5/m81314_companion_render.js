import {isPveMap} from './m81314_protocol.js';
import {resourceSequence,timelineSample,NORMAL_TICK_MS} from './battle_effects.js';
import {isWorldBossScene} from './m81330_protocol.js';

/** CTank.initTankEquip -> TankApparatusView: one local-origin MovieClip plus
 * a separate rank MovieClip, not a simulated actor, weapon or trailing pet. */
export function companionRenderLayers(catalog,scene,actor){
  if(!(Number(scene?.roomType)===4&&isPveMap(scene?.mapId))&&!isWorldBossScene(scene)||!actor||actor.dead)return [];
  const brief=scene.characters?.find(row=>Number(row.accountId??row.player?.accountId)===Number(actor.accountId));
  const itemId=Number(brief?.btItemId??brief?.other?.btItemId??0);
  const rank=Number(brief?.btRank??brief?.other?.btRank??0);
  const pet=catalog?.companions?.[String(itemId)];
  if(!pet||pet.status!=='ready'||!pet.source||!pet.component)return [];
  const offsetX=Number(pet.component.iOffsetX||0),offsetY=Number(pet.component.iOffsetY||0);
  const layers=[{kind:'companion',itemId,rank,source:pet.source,offsetX,offsetY}];
  const star=catalog.companionStarEffects?.[String(rank)];
  if(star)layers.push({kind:'companionStars',itemId,rank,source:star.source||star,offsetX,offsetY});
  return layers;
}

export function drawCompanion(view,actor,position,now,alpha=1){
  const scene=view.client.state.play.scene,catalog=view.prepared.catalog;
  const layers=companionRenderLayers(catalog,scene,actor);
  if(!layers.length)return [];
  const key=`${actor.objectId}:${actor.lifeEpoch}`;
  view.companionClocks||=new Map();
  if(!view.companionClocks.has(key))view.companionClocks.set(key,now);
  const elapsed=now-view.companionClocks.get(key),result=[];
  for(const layer of layers){
    const sequence=resourceSequence(view.store,layer.source);
    if(!sequence)continue;
    const frame=timelineSample(sequence.frames.length,elapsed,NORMAL_TICK_MS,true).index;
    const drawn=view.drawSequence(sequence,frame,position.x+layer.offsetX,position.y+layer.offsetY,0,alpha);
    view.recordResourceDraw(`${layer.kind}:${key}`,sequence,frame,now,drawn,
      {kind:layer.kind,objectId:actor.objectId,lifeEpoch:actor.lifeEpoch,itemId:layer.itemId,rank:layer.rank});
    result.push({...layer,source:undefined,frame,drawn});
  }
  return result;
}
