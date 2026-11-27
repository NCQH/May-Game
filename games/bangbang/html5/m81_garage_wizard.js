/* Readonly TankWizardPanel. Geometry/art from the native garage, data from the
 * current base-tank catalog. No skin bonuses, weekly counters or mutation API. */
import {element, assetImage} from './m8_ui_helpers.js';
export const GARAGE_WIZARD_GEOMETRY = Object.freeze({x:687,y:45,width:286,height:348});
export const GARAGE_WIZARD_TABS = Object.freeze([
  ['summary','Mô tả','lbl_tank_dec_t','lbl_tank_dec_down_t'],
  ['attribute','Chi tiết','lbl_attr_detail_t','lbl_attr_details_up_t'],
  ['backstory','Bối cảnh','lbl_story_t','lbl_story_down_t'],
  ['tips','Tips','lbl_tips_t','lbl_tips_down_t'],
]);
const STATS = [['iHp','HP'],['iAttack','Công vật lý'],['iEgAtk','Công năng lượng'],
  ['iArmor','Giáp'],['iEgArmor','Kháng năng lượng'],['iCentesis','Xuyên giáp'],
  ['iEgCtsis','Xuyên năng lượng'],['iSpeed','Tốc độ'],['nFireRange','Tầm bắn']];
export function wizardTab(value) { return GARAGE_WIZARD_TABS.some(t=>t[0]===value)?value:'summary'; }
// Native TextTool color wildcards become text spans, never executable HTML.
export function wizardTextRuns(value, rich = true) {
  const source=String(value??'').replace(/#ENTER#/g,'\n');
  if (!rich) return [{text:source,color:null}];
  const runs=[]; const pattern=/#COLOR_([\da-fA-F]{6})_([\s\S]*?)_END#/g;
  let cursor=0, match;
  while ((match=pattern.exec(source))) {
    if(match.index>cursor) runs.push({text:source.slice(cursor,match.index),color:null});
    runs.push({text:match[2],color:`#${match[1]}`}); cursor=pattern.lastIndex;
  }
  if(cursor<source.length || !runs.length) runs.push({text:source.slice(cursor),color:null});
  return runs;
}
export function garageWizardData(catalog,tank,stats,wizardTank) {
  const base=catalog?.tanks?.[tank?.tankId];
  if(!base) return null;
  const local=value=>catalog.localizedText?.[value]??value??'';
  const rows=STATS.map(([key,label])=>({key,label,value:typeof stats?.[key]==='number'&&Number.isFinite(stats[key])?stats[key]:null}));
  const interval=stats?.iFireInterv;
  rows.push({key:'fireRate',label:'Tốc độ bắn / phút',value:typeof interval==='number'&&interval>0&&Number.isFinite(interval)?Math.floor(60000/interval):null});
  return {tankId:tank.tankId,role:local(wizardTank?.nativeRole??base.nativeRole),description:base.description||local(base.nativeDescription),
    story:local(base.nativeStory),tips:local(base.nativeTips),
    difficulty:Number.isInteger(wizardTank?.difficulty)&&wizardTank.difficulty>=0?wizardTank.difficulty:null,
    radar:radarPoints(wizardTank?.radarRatios),rows};
}
// RadarPanel.calculatePos accepts uint radius: preserve truncation, not a CSS approximation.
export function radarPoints(ratios) {
  if(!Array.isArray(ratios)||ratios.length!==6||ratios.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0)) return null;
  return ratios.map((ratio,index)=>{
    const radius=Math.floor(74*ratio), angle=(270+index*60)*Math.PI/180;
    return {x:144+radius*Math.cos(angle),y:234+radius*Math.sin(angle)};
  });
}
export function wizardScroll(state, tab, value) {
  state.scrollByTab??={};
  if(value!==undefined) state.scrollByTab[wizardTab(tab)]=Number.isFinite(value)?Math.max(0,value):0;
  return state.scrollByTab[wizardTab(tab)]||0;
}
function position(node,x,y,width,height) {
  Object.assign(node.style,{position:'absolute',left:`${x}px`,top:`${y}px`,width:`${width}px`,height:`${height}px`}); return node;
}
function richText(node,text,rich=true) {
  for(const run of wizardTextRuns(text,rich)) {
    const span=element('span',run.text); if(run.color) span.style.color=run.color; node.append(span);
  }
}
export function renderGarageWizard({host,catalog,assets,tank,stats,tab,onTab,state={}}) {
  const old=state.panel, active=typeof document!=='undefined'?document.activeElement:null;
  const focusKey=old?.contains?.(active)?active.dataset.wizardFocus:null;
  // TankWizardPanelProxy.initDiff hides Story/Tips for the Vietnamese client.
  const visibleTabs=GARAGE_WIZARD_TABS.slice(0,2);
  const requested=wizardTab(tab??state.tab),selected=visibleTabs.some(t=>t[0]===requested)?requested:'summary';state.tab=selected;
  const panel=element('section',null,'m81-garage-wizard'); panel.setAttribute('aria-label','Thông tin tank');
  position(panel,687,45,286,348);
  const get=key=>assets?.get?.(`wizard.${key}`)||null;
  panel.append(position(assetImage(get('img_tips_back'),'','m81-wizard-background'),0,31,286,317));
  const buttons=[];
  const tabs=element('div',null,'m81-wizard-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Thông tin tank');
  visibleTabs.forEach(([key,label,normal,chosen],index)=>{
    const button=element('button',null,'m81-wizard-tab');button.type='button';
    button.setAttribute('role','tab');button.setAttribute('aria-label',label);button.setAttribute('aria-selected',String(selected===key));
    button.tabIndex=selected===key?0:-1;button.dataset.wizardFocus=key;
    position(button,index*71,0,72,35);
    const skin=get(selected===key?'btn_title_down':'btn_title');
    if(skin?.url) button.style.backgroundImage=`url("${skin.url}")`;
    const icon=get(selected===key?chosen:normal);
    if(icon?.url) button.append(assetImage(icon,''));else button.textContent=label;
    const choose=()=>{state.tab=key;onTab?.(key);}; button.addEventListener('click',choose);
    button.addEventListener('keydown',event=>{
      let next=index;
      if(event.key==='ArrowRight') next=(index+1)%visibleTabs.length;else if(event.key==='ArrowLeft') next=(index+visibleTabs.length-1)%visibleTabs.length;
      else if(event.key==='Home') next=0;else if(event.key==='End') next=visibleTabs.length-1;else return;
      event.preventDefault();buttons[next].focus();buttons[next].click();
    });
    buttons.push(button);tabs.append(button);
  });panel.append(tabs);
  const content=element('div',null,'m81-wizard-content');position(content,5,43,276,257);
  content.setAttribute('role','tabpanel');content.setAttribute('aria-label',GARAGE_WIZARD_TABS.find(t=>t[0]===selected)[1]);
  content.tabIndex=0;content.dataset.wizardFocus='content';
  const data=garageWizardData(catalog,tank,stats,assets?.panels?.wizardTanks?.[tank?.tankId]);
  if(!data) content.textContent='Chưa có dữ liệu tank.';
  else if(selected==='attribute') {
    for(const row of data.rows) {
      const line=element('div',null,'m81-wizard-stat');line.append(element('span',row.label),element('strong',row.value===null?'—':String(row.value)));content.append(line);
    }
  } else if(selected==='summary') {
    content.hidden=true;
    const art=(key,x,y)=>{const asset=get(key);if(asset)panel.append(position(assetImage(asset,''),x,y,asset.width,asset.height));};
    art('lbl_pos_t',26,45);art('lbl_star_dec_t',26,75);
    art('cut_line',33,71);art('cut_line',33,100);art('lbl_attr_t',124,104);
    const role=element('div',data.role,'m81-wizard-role');position(role,116,45,160,24);panel.append(role);
    const difficulty=element('div',null,'m81-wizard-difficulty');
    difficulty.setAttribute('aria-label',`Độ khó: ${data.difficulty??'chưa có dữ liệu'}`);position(difficulty,117,75,82,24);
    // QuestDifferStarFrame.TANK_DEC: three background stars at(-1,-2),
    // (27,-2),(55,-2), with the original lit glyph at(0,0),(28,0),(56,0).
    const starBackground=assets.get('garage.questStarBackground'),star=assets.get('garage.questStar');
    for(let index=0;index<3;index++){
      if(starBackground)difficulty.append(position(assetImage(starBackground,''),index*28-1,-2,starBackground.width,starBackground.height));
      if(data.difficulty>index&&star)difficulty.append(position(assetImage(star,''),index*28,0,star.width,star.height));
    }
    panel.append(difficulty);
    if(data.radar) {
      art('img_r_bg',76,158);
      [[128,138],[210,180],[210,268],[128,314],[43,268],[43,180]].forEach(([x,y],i)=>art(`lbl_r${i+1}_t`,x,y));
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
      svg.setAttribute('viewBox','0 0 286 348');svg.setAttribute('aria-label','Biểu đồ thuộc tính gốc');svg.setAttribute('role','img');
      position(svg,0,0,286,348);svg.style.pointerEvents='none';
      const shape=document.createElementNS('http://www.w3.org/2000/svg','polygon');
      shape.setAttribute('points',data.radar.map(p=>`${p.x},${p.y}`).join(' '));
      shape.setAttribute('fill','#00ff00');shape.setAttribute('fill-opacity','0.4');shape.setAttribute('stroke','#00ff00');shape.setAttribute('stroke-width','1');
      svg.append(shape);panel.append(svg);
    } else panel.append(position(element('p','Chưa có dữ liệu biểu đồ thuộc tính.','m81-wizard-unavailable'),10,138,266,60));
  } else richText(content,(selected==='tips'?data.tips:data.story)||'Chưa có nội dung.',selected==='tips');
  content.scrollTop=wizardScroll(state,selected);
  content.addEventListener('scroll',()=>wizardScroll(state,selected,content.scrollTop));
  panel.append(content); state.panel=panel;
  panel.restoreFocus=()=>{
    content.scrollTop=wizardScroll(state,selected);
    if(focusKey) (focusKey==='content'?content:buttons.find(b=>b.dataset.wizardFocus===focusKey))?.focus({preventScroll:true});
  };
  host.append(panel);return panel;
}
