/* Readonly TankInfoFrame / TankInfoProxy (prebattle_select_20261017).
 * Parent owns the native 1000x600 stage and viewport scaling. No stat projection,
 * leveling, skin bonuses, packet sends, or inferred weekly-free counters here.
 */
import {element, assetImage, nativeText} from './m8_ui_helpers.js';

export const SELECTION_INFO_GEOMETRY = Object.freeze({x:780,y:34,width:220,height:540});
// GameText TIP_676/677; exact translations from rez/vi_VN/mo/game.mo.
const TYPE_TEXT = {1:'Tank Vật Lý',2:'Tank Năng Lượng'};
let serial=0;

export function selectionTankInfo(catalog,tank) {
  const base=catalog?.tanks?.[tank?.tankId];
  if(!base)return null;
  const ids={...base.skills};
  const overrides=catalog.skinAttributes?.[tank.externalId]?.skills;
  const skin=catalog.skins?.find(row=>row.externalId===tank.externalId&&row.tankId===tank.tankId);
  const name=catalog.items?.[skin?.itemId]?.name||base.name||'';
  const role=catalog.localizedText?.[base.nativeRole]??base.nativeRole??'';
  // SkillData keys by ID, not tank level. Preserve source last-row-wins semantics.
  const byId=new Map();
  for(const skill of Object.values(catalog.skills||{})) {
    const prior=byId.get(skill.skillId);
    if(!prior||(skill.sourceOrdinal??0)>=(prior.sourceOrdinal??0))byId.set(skill.skillId,skill);
  }
  return {name:nativeText(name),intro:nativeText([TYPE_TEXT[base.type],role].filter(Boolean).join('\n')),
    // Current native server makes skins appearance-only. Keep base mechanics,
    // while retaining the skin's native icon/name for the same existing slot.
    skills:[ids.nSkill4>0?'nSkill4':'nSkill3','nSkill1','nSkill2'].map(key=>{
      const id=ids[key],skill=byId.get(id),appearance=byId.get(overrides?.[key])||skill;
      return {id:id||0,name:nativeText(appearance?.name),description:nativeText(skill?.description2),icon:appearance?.icon||null};
    })};
}

export function createSelectionTankInfo({host,assets,catalog=assets.garage}) {
  const frame=element('aside',null,'m81-selection-info');
  frame.id=`m81-selection-info-${++serial}`;frame.hidden=true;frame.setAttribute('role','tooltip');
  host.append(frame);
  const cleanups=new Set();let disposed=false,timer=null,active=null;
  const clearTimer=()=>{if(timer!==null){clearTimeout(timer);timer=null;}};
  function hide(){clearTimer();frame.hidden=true;active=null;}
  function show(tank){
    clearTimer();if(disposed)return;
    const info=selectionTankInfo(catalog,tank);
    if(!info){hide();return;}
    frame.replaceChildren();frame.setAttribute('aria-label',info.name);
    frame.append(assetImage(assets.ui?.assets?.['selection.tankInfoBackground'],'','m81-selection-info-bg'),
      element('div',info.name,'m81-selection-info-name'),element('div',info.intro,'m81-selection-info-intro'));
    info.skills.forEach((skill,index)=>{
      const row=element('section',null,`m81-selection-info-skill slot-${index}`);
      row.append(element('div',skill.name,'m81-selection-info-skill-name'),
        assetImage(skill.icon?assets.get(skill.icon):null,'','m81-selection-info-icon'),
        assetImage(assets.ui?.assets?.['selection.skillGrid'],'','m81-selection-info-grid'),
        element('div',skill.description,'m81-selection-info-description'));
      frame.append(row);
    });
    frame.hidden=false;
  }
  function bind(trigger,tankOrGetter){
    if(disposed)return ()=>{};
    let hovered=false,focused=false,dismissed=false;
    const previous=trigger.getAttribute('aria-describedby');
    trigger.setAttribute('aria-describedby',[previous,frame.id].filter(Boolean).join(' '));
    const refresh=()=>{
      if(!hovered&&!focused){dismissed=false;if(active===trigger)hide();return;}
      if(dismissed)return;
      clearTimer();active=trigger;
      // SelectTankWindow's native timeout is 0.5 milliseconds, not 500ms.
      timer=setTimeout(()=>{timer=null;if(active===trigger&&trigger.isConnected!==false)show(typeof tankOrGetter==='function'?tankOrGetter():tankOrGetter);},0.5);
    };
    const events={pointerenter:()=>{hovered=true;refresh();},pointerleave:()=>{hovered=false;refresh();},
      focus:()=>{focused=true;refresh();},blur:()=>{focused=false;refresh();},
      keydown:event=>{if(event.key==='Escape'){dismissed=true;if(active===trigger)hide();}}};
    for(const [type,fn] of Object.entries(events))trigger.addEventListener(type,fn);
    const cleanup=()=>{
      for(const [type,fn] of Object.entries(events))trigger.removeEventListener(type,fn);
      if(previous===null)trigger.removeAttribute('aria-describedby');else trigger.setAttribute('aria-describedby',previous);
      if(active===trigger)hide();cleanups.delete(cleanup);
    };
    cleanups.add(cleanup);return cleanup;
  }
  function dispose(){if(disposed)return;hide();disposed=true;for(const cleanup of [...cleanups])cleanup();frame.remove();}
  return {show,hide,bind,dispose,destroy:dispose};
}
