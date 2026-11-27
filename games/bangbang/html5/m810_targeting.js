import {visualPosition} from './combat_state.js';
import {resourceSequence} from './battle_effects.js';

/** SelfTank.showSkillRange; ranges are presentation metadata, never hit tests. */
export function nativeSkillPreview(skill,from,to) {
  if(!skill||!(Number(skill.iRange)>0)||!from||!to)return null;
  const type=Number(skill.iSRangeType)||0,target=Number(skill.iSType),radius=Number(skill.iSelectRange)||0;
  const param=Number(skill.iSRangeParam)||0,range=Number(skill.iRange)+(type===2?36:0);
  const dx=to.x-from.x,dy=to.y-from.y,distance=Math.hypot(dx,dy),heading=Math.atan2(dy,dx);
  const result={from,to,range,maxRing:distance>range,shape:null,heading};
  if(![0,1,10,11].includes(target))return result;
  if(type===0&&target===0)result.shape={kind:'circle',radius};
  else if(type===3)result.shape={kind:'asset',asset:'select_arrow',x:from.x,y:from.y,rotation:heading+Math.PI/2,
    scaleX:param>0&&radius>0?param/48:1,scaleY:param>0&&radius>0?radius/165:Math.min(range,Math.max(165,distance))/165};
  else if(type===1||type===5)result.shape={kind:'asset',asset:param?'select_rect':'select_arrow',x:from.x,y:from.y,
    rotation:heading+Math.PI/2,scaleX:param?param/70:1,scaleY:param?radius/225:range/165};
  else if(type===2)result.shape={kind:'sector',radius,angle:param,rotation:heading-Math.PI/2};
  else if(type===6)result.shape={kind:'asset',asset:'select_vertical_dir',x:to.x,y:to.y,
    rotation:heading-Math.PI/2,scaleX:param/215,scaleY:1};
  return result;
}

export function drawNativeTargeting(view,state,now) {
  const input=view.input.snapshot(),self=state.actors[String(state.selfObjectId)];
  if(!self||self.dead||self.removed||self.hp<=0||state.result)return;
  const slots=state.skills?.[String(self.objectId)]||{};
  // Feedback and inspection are presentation-only. Never select a slot or
  // substitute their aim for the live input/cast path.
  const current=preview=>preview&&preview.skillId>0&&slots[String(preview.slot)]?.skillId===preview.skillId;
  const warning=current(input.rangeFeedback)&&input.rangeFeedback.expiresAt>now;
  const hover=!warning&&current(input.hoveredSkill);
  if(!warning&&!hover&&(!input.active||!input.selectedSlot||!input.aim))return;
  const slot=warning?input.rangeFeedback.slot:hover?input.hoveredSkill.slot:input.selectedSlot;
  const entry=slots[String(slot)];
  const skill=view.prepared.catalog.skills[String(entry?.skillId)];
  const from=visualPosition(self,now);
  let aim=input.aim;
  if(warning||hover){
    aim=input.lastMapAim||aim;
    if(!aim||!Number.isFinite(aim.x)||!Number.isFinite(aim.y)
        ||Math.hypot(aim.x-from.x,aim.y-from.y)<.001){
      const angle=(Number(self.cannonAngle)||0)*Math.PI/180,range=Number(skill?.iRange)||0;
      aim={x:from.x+Math.sin(angle)*range,y:from.y-Math.cos(angle)*range};
    }
  }
  const value=nativeSkillPreview(skill,from,aim);
  if(!value)return;
  const c=view.context,origin=view.screenPoint(value.from.x,value.from.y),zoom=view.camera.zoom;
  c.save();c.translate(origin.x,origin.y);c.scale(zoom,zoom);
  if(warning||hover||value.maxRing){c.strokeStyle=warning?'#ff0000':'#02f0ff';c.lineWidth=2;c.beginPath();c.arc(0,0,value.range,0,Math.PI*2);c.stroke();}
  const shape=warning?null:value.shape;
  if(shape?.kind==='circle'){c.fillStyle=hover?'rgba(2,240,255,.3)':'rgba(255,0,0,.3)';c.beginPath();c.arc(0,0,shape.radius,0,Math.PI*2);c.fill();}
  if(shape?.kind==='sector'){
    c.rotate(shape.rotation);c.beginPath();c.moveTo(0,36);
    for(let i=0;i<shape.angle;i++){const a=((180-shape.angle)/2+i)*Math.PI/180;c.lineTo(shape.radius*Math.cos(a),shape.radius*Math.sin(a)+36);}
    c.closePath();c.fillStyle='rgba(2,240,255,.4)';c.strokeStyle='rgba(2,240,255,.5)';c.lineWidth=3;c.fill();c.stroke();
  }
  c.restore();
  if(shape?.kind==='asset'){
    const sequence=resourceSequence(view.store,view.prepared.catalog.modePresentation?.resources?.[shape.asset]);
    if(sequence)view.drawSequence(sequence,Math.floor(Math.max(0,now-view.animationStart)/sequence.frameMs)%sequence.frames.length,
      shape.x,shape.y,shape.rotation,1,{scaleX:shape.scaleX,scaleY:shape.scaleY});
  }
}
