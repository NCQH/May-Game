/* Active Flash TankSkinAttrView and MouseHintBase presentation helpers.
 * Source text is current native catalog data. No gameplay formula is evaluated,
 * no item is granted, and a visual choice is never an equipment acknowledgement.
 */
import {element, assetImage, nativeText} from './m8_ui_helpers.js';
import {m81340LevelLookChoices} from './m81338_level_looks.js';

export const NATIVE_SKIN_GEOMETRY = Object.freeze({width:996,height:570,listX:260,listY:115,
  listWidth:690,listHeight:420,cardWidth:230,cardHeight:380,portraitX:15,portraitY:50});
export const SKIN_QUALITIES = Object.freeze([[0,'ALL'],[2,'A'],[3,'S'],[4,'SS'],[5,'SSS']]);
// ItemTool.getItemNameQualityColor, including the exact original VI colors.
export const SKIN_COLORS = Object.freeze({0:'#ffffff',1:'#ffffff',2:'#15ee19',3:'#06fffc',4:'#ff6eff',5:'#f18819'});
let tooltipSerial=0;

/** The middle of progress_1.swf is a7twip bitmap shape, enlarged by each native
 * frame's matrix. Use that exact recorded geometry, never percent-derived art.
 */
export function nativeUpgradeProgressMiddle(presentation,frameNumber) {
  const source=presentation?.progressFill,frame=source?.frames?.find(row=>row.frame===frameNumber);
  return frame?.visible?{...frame,assetKey:source.assetKey}:null;
}

/** TextTool's #COLOR, #PH, #EN and #ENTER presentation. Build text nodes, never
 * innerHTML: even a malformed or hostile catalog string stays inert text.
 * Native resources contain spaces/one stray ¬ in some color parameters; only
 * the six hexadecimal digits are accepted as CSS, with a plain-text fallback.
 */
export function nativeSkillTextRuns(value, attackSuffix='X Tấn Công') {
  const source=String(value??'').replace(/#ENTER#/g,'\n');
  const runs=[], pattern=/#COLOR_([^_]*?)_([\s\S]*?)_END#|#PH_([^#]*?)_IC#|#EN_([^#]*?)_ER#/g;
  let cursor=0,match;
  while((match=pattern.exec(source))) {
    if(match.index>cursor)runs.push({text:source.slice(cursor,match.index),color:null});
    if(match[1]!==undefined) {
      const color=match[1].replace(/[\s¬]/g,'');
      const outer=/^[\da-f]{6}$/i.test(color)?`#${color}`:null;
      for(const run of nativeSkillTextRuns(match[2],attackSuffix))runs.push({text:run.text,color:run.color||outer});
    } else runs.push({text:`(${match[3]??match[4]}${attackSuffix})`,color:match[3]!==undefined?'#ffae0d':'#df84f3'});
    cursor=pattern.lastIndex;
  }
  if(cursor<source.length||!runs.length)runs.push({text:source.slice(cursor),color:null});
  return runs;
}

export function nativeSkillTooltipData(skill,texts={}) {
  const cooldown=Number(skill?.cooldownMs),mp=Number(skill?.mpCost);
  return {name:nativeText(skill?.name),
    cooldown:cooldown>0?(texts.cooldown||'Thời gian CD @num1@ s').replace('@num1@',String(Number((cooldown/1000).toFixed(1)))):'',
    mp:mp>0?(texts.mp||'MP tiêu hao: @num1@').replace('@num1@',String(mp)):'',
    introduction:texts.introduction||'[Giới thiệu]',
    runs:nativeSkillTextRuns(skill?.description,texts.attackSuffix||'X Tấn Công')};
}

function position(node,x,y,width,height) {
  Object.assign(node.style,{position:'absolute',left:`${x}px`,top:`${y}px`});
  if(width!=null)node.style.width=`${width}px`;
  if(height!=null)node.style.height=`${height}px`;
  return node;
}

/** Keep the original252px black/80% panel inside the logical1000×600 stage.
 * Pointer and keyboard users share the same actual text. The browser title is
 * deliberately absent, so it cannot obscure the native tooltip a second time.
 */
export function bindNativeSkillTooltip(trigger,stage,skill,texts={},geometry=null) {
  const data=nativeSkillTooltipData(skill,texts);
  const tooltip=element('aside',null,'m85-skill-tooltip');
  tooltip.setAttribute('role','tooltip');tooltip.setAttribute('aria-label',data.name);
  tooltip.hidden=true;
  const id=`m85-skill-tip-${skill.skillId||'slot'}-${++tooltipSerial}`;
  tooltip.id=id;trigger.setAttribute('aria-describedby',id);trigger.removeAttribute('title');
  tooltip.append(element('div',data.name,'m85-skill-tooltip-title'));
  if(data.cooldown)tooltip.append(element('div',data.cooldown,'m85-skill-tooltip-cooldown'));
  if(data.mp)tooltip.append(element('div',data.mp,'m85-skill-tooltip-mp'));
  tooltip.append(element('div',data.introduction,'m85-skill-tooltip-heading'));
  const body=element('div',null,'m85-skill-tooltip-body');
  for(const run of data.runs){const span=element('span',run.text);if(run.color)span.style.color=run.color;body.append(span);}
  tooltip.append(body);stage.append(tooltip);
  let timer=null,disposed=false;
  const cancel=()=>{if(timer!==null){clearTimeout(timer);timer=null;}};
  const hide=()=>{cancel();tooltip.hidden=true;};
  const show=()=>{
    cancel();if(disposed||!trigger.isConnected)return;tooltip.hidden=false;
    // Garage retains the connected artwork tree while moving new controls out
    // of a temporary stage. Resolve the actual ancestor after that reconciliation.
    const liveStage=trigger.closest('.m8-garage')||stage;
    const bounds=liveStage.getBoundingClientRect(),anchor=trigger.getBoundingClientRect();
    const logicalWidth=geometry?geometry().width:1000,logicalHeight=geometry?geometry().height:600;
    const sx=bounds.width/logicalWidth||1,sy=bounds.height/logicalHeight||1;
    const width=tooltip.offsetWidth||252,height=tooltip.offsetHeight||200;
    const left=Math.min(logicalWidth-width-5,Math.max(5,(anchor.left-bounds.left)/sx-width+20));
    const top=Math.max(5,Math.min(logicalHeight-height-5,(anchor.top-bounds.top)/sy-height-6));
    position(tooltip,left,top);
  };
  const leave=()=>{cancel();timer=setTimeout(hide,90);};
  const escape=event=>{if(event.key==='Escape'&&!tooltip.hidden){hide();event.preventDefault();event.stopPropagation();}};
  const events={pointerenter:show,pointerleave:leave,focus:show,blur:leave,keydown:escape};
  for(const [type,fn]of Object.entries(events))trigger.addEventListener(type,fn);
  tooltip.addEventListener('pointerenter',cancel);tooltip.addEventListener('pointerleave',hide);
  return ()=>{disposed=true;hide();for(const [type,fn]of Object.entries(events))trigger.removeEventListener(type,fn);tooltip.remove();};
}

/** Match active source list inclusion (owned, or a currently visible definition)
 * and source SSS-first/ascending-quality order. Unowned rows can be inspected,
 * but never acquire a made-up price or purchase action.
 */
export function nativeSkinGallery(catalog,meta,tank,presentation={},serverSeconds=null) {
  const items=(meta?.containers?.['6']?.items||[]).filter(item=>item.count>0);
  const owned=new Map(items.map(item=>[Number(item.templateId),item]));
  const definitions=new Map((catalog?.skins||[]).filter(row=>row.tankId===tank.tankId).map(row=>[row.itemId,row]));
  const activePeriod=period=>{
    if(!period)return true;if(!Number.isFinite(serverSeconds))return false;
    const date=value=>{const p=String(value||'').trim().split(/[- :]/).map(Number);return p.length===6?new Date(p[0],p[1]-1,p[2],p[3],p[4],p[5]).getTime()/1000:NaN;};
    const [start,end]=period.split('#');return serverSeconds>date(start)&&serverSeconds<date(end);
  };
  const levelLooks=m81340LevelLookChoices(tank,nativeText(catalog.tanks?.[tank.tankId]?.name));
  const levelExternals=new Set(levelLooks.map(row=>row.externalId));
  const candidates=presentation?.skinCandidates?.[String(tank.tankId)]||[];
  const rows=[];
  for(const candidate of candidates) {
    if(levelExternals.has(Number(candidate.externalId)))continue;
    const item=owned.get(candidate.itemId),definition=definitions.get(candidate.itemId),template=catalog.items?.[candidate.itemId];
    if(!item&&(template?.reuse?.iReuseF===1||!activePeriod(candidate.activePeriod)))continue;
    if(!template)continue;
    rows.push({...candidate,itemUuid:item?.uuid||'',owned:!!item,ready:!!definition?.ready,
      lifeTime:item?.lifeTime??0,active:tank.externalId===candidate.externalId,
      name:nativeText(template.name),reason:definition?.reason||'Trang phục này còn thiếu tài nguyên gốc.',
      icon:template.icon||'',usable:!!item&&!!definition?.ready&&item.lifeTime===0});
  }
  // Native table/candidate gaps must not hide an actually owned supported skin.
  for(const [id,item]of owned)if(definitions.has(id)&&!levelExternals.has(Number(definitions.get(id).externalId))&&!rows.some(row=>row.itemId===id)) {
    const definition=definitions.get(id),template=catalog.items?.[id]||{};
    rows.push({...definition,itemId:id,itemUuid:item.uuid,owned:true,lifeTime:item.lifeTime,
      quality:template.quality||0,active:tank.externalId===definition.externalId,name:nativeText(template.name),
      usable:!!definition.ready&&item.lifeTime===0,icon:template.icon||''});
  }
  const externalId=catalog.levels?.[`${tank.tankId}:${tank.level}`]?.externalId||0;
  if(levelLooks.length)rows.push(...levelLooks);
  else if(externalId)rows.push({itemId:0,itemUuid:'',externalId,quality:0,owned:true,ready:true,usable:true,
    active:!tank.externalId||tank.externalId===externalId,name:nativeText(catalog.tanks?.[tank.tankId]?.name)});
  return rows.map((row,index)=>({...row,sourceOrder:index})).sort((a,b)=>
    ((a.quality===5?-1:a.quality)-(b.quality===5?-1:b.quality))||a.sourceOrder-b.sourceOrder);
}

export function nativeMaterialQualityKey(quality) {
  return 'm85.tank.bg2_'+(quality<=1?'white':({2:'green',3:'blue',4:'purple'}[quality]||'orange'));
}

export function materialShortageText(costs,catalog) {
  return costs.filter(cost=>cost.owned<cost.count).map(cost=>
    `${nativeText(catalog?.items?.[cost.itemId]?.name||`Vật phẩm ${cost.itemId}`)}: ${cost.owned}/${cost.count}`).join('; ');
}

export function renderNativeMaterialCard({assets,definition,cost,x,y=353,onInspect}) {
  const card=position(element('button',null,'m85-upgrade-material'),x,y,91,110);
  card.type='button';card.dataset.testid=`garage-material-${cost.itemId}`;
  const name=nativeText(definition?.name||`Vật phẩm ${cost.itemId}`);
  card.setAttribute('aria-label',`${name}: ${cost.owned}/${cost.count}`);
  card.title=nativeText(definition?.description||name);
  const frame=assets.get('m85.tank.itembox2');
  if(frame)card.append(position(assetImage(frame,''),Math.round((91-frame.width)/2),8,frame.width,frame.height));
  const quality=assets.get(nativeMaterialQualityKey(definition?.quality||0));
  if(quality)card.append(position(assetImage(quality,''),9,11,quality.width,quality.height));
  card.append(position(assetImage(assets.get(definition?.icon),''),7.5,10,76,76));
  const label=position(element('span',name,'m85-material-name'),7.5,0,76);
  // RewardItemFrame uses auto-height Text anchored24px above the bottom.
  // Multi-line names therefore expand upward over the icon, never into lblNum.
  Object.assign(label.style,{top:'auto',bottom:'24px'});
  const count=position(element('span',`${cost.owned}/${cost.count}`,'m85-material-count'),.5,88,90,20);
  if(cost.owned<cost.count)count.classList.add('short');
  card.append(label,count);card.addEventListener('click',()=>onInspect?.(cost,definition));
  return card;
}
