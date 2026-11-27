import {element,actionButton,assetImage,nativeText,numberText,setText} from './m8_ui_helpers.js';
import {isPveMap} from './m81314_protocol.js';
import {pveGrade} from './m81314_state.js';
import {resourceSequence,NORMAL_TICK_MS} from './battle_effects.js';
import {characterProgress} from './m83_chrome.js';
import {RESULT_ART} from './m81316_result_art.js';

export const PVE_RESULT_BITMAPS=Object.values(RESULT_ART).filter(asset=>asset!==RESULT_ART.boss201);
const nonnegative=value=>Number.isFinite(Number(value))?Math.max(0,Math.trunc(Number(value))):0;

export function pveResultModel(result,state={}){
  if(Number(result?.roomType)!==4||!isPveMap(result?.mapId))return null;
  const self=result.actors?.find(row=>Number(row.accountId)===Number(state.accountId));
  if(!self)return null;
  const scene=state.play?.scene;
  if(scene&&Number(scene.sceneId)!==Number(result.sceneId))return null;
  const awards=new Map();
  for(const group of state.pve?.lastAward?.groups||[])for(const item of group.items||[]){
    const itemId=Number(item.itemId),count=Number(item.count),total=(awards.get(itemId)||0)+count;
    if(Number.isSafeInteger(itemId)&&itemId>0&&Number.isSafeInteger(count)&&count>0&&Number.isSafeInteger(total))
      awards.set(itemId,total);
  }
  const brief=scene?.characters?.find(row=>Number(row.accountId??row.player?.accountId)===Number(state.accountId));
  const power=brief?.btAttack??brief?.other?.btAttack;
  return {won:Number(result.winCamp)===1,self,grade:self.pve||{},time:nonnegative(result.battleTime),
    deaths:nonnegative(self.stats?.[0]),damage:nonnegative(self.stats?.[6]),
    helperPower:power!=null&&Number.isFinite(Number(power))?nonnegative(power):null,
    rewards:[...awards].map(([itemId,count])=>({itemId,count})),
    awardAcknowledged:state.pve?.lastAward!==null&&state.pve?.lastAward!==undefined};
}

const at=(node,x,y,width,height)=>{Object.assign(node.style,{position:'absolute',left:`${x}px`,top:`${y}px`});
  if(width!=null)node.style.width=`${width}px`;if(height!=null)node.style.height=`${height}px`;return node;};
const label=(value,x,y,width,height,className='')=>at(element('span',value,className),x,y,width,height);
const resolve=(catalog,value)=>typeof value==='string'?catalog?.assets?.[value]:value?.assetRef?catalog?.assets?.[value.assetRef]:value;

export function preloadPveResultArt(view){
  const catalog=view.ui?.assets?.pve,art=catalog?.ui?.pveResults||{},store=view.ui?.getBattleView?.()?.store;
  const sources=[...Object.values(art.assets||{}),...Object.values(art.grades||{}),...Object.values(art.largeGrades||{})].map(value=>resolve(catalog,value)).filter(Boolean);
  const images=new Map();
  for(const source of sources){
    if(/\.swf$/i.test(source.url||'')){
      const sequence=store&&resourceSequence(store,source);
      for(const asset of [sequence?.asset,...(sequence?.assets||[]),...(sequence?.frames||[]).map(frame=>frame.asset)].filter(Boolean))images.set(asset.url,asset);
    }else if(source.url)images.set(source.url,source);
  }
  // Starts with the outcome movie; no readiness, outcome or reward is delayed
  // or invented by this presentation-only decode warmup.
  return Promise.all([...images.values()].map(asset=>store?.loadImage?store.loadImage(asset).catch(()=>null):null));
}

// Native alpha-trimmed frames/origins, never redrawn UI artwork. Static movies
// draw once; decode completion redraws without a permanent RAF polling loop.
export function originalPveResultArt(view,source,x,y,{center=false}={}){
  if(!source)return null;
  const store=view.ui?.getBattleView?.()?.store;
  if(!/\.swf$/i.test(source.url||''))return at(assetImage(source,'','m81314-result-art'),
    x-(center?source.width/2:0),y,source.width,source.height);
  const sequence=store&&resourceSequence(store,source);if(!sequence?.frames?.length)return null;
  const bounds=sequence.frames.reduce((r,f)=>[Math.min(r[0],f.offsetX||0),Math.min(r[1],f.offsetY||0),
    Math.max(r[2],(f.offsetX||0)+f.w),Math.max(r[3],(f.offsetY||0)+f.h)],[0,0,1,1]);
  const width=Math.ceil(bounds[2]-bounds[0]),height=Math.ceil(bounds[3]-bounds[1]);
  const canvas=element('canvas',null,'m81314-result-art');canvas.width=width;canvas.height=height;
  at(canvas,x+(center?-width/2:bounds[0]),y+bounds[1],width,height);
  const ctx=canvas.getContext('2d'),media=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const requested=new Set();let raf=0,disposed=false,last=-1,started=performance.now(),pausedAt=0;
  const still=Math.max(0,sequence.frames.findIndex(frame=>!frame.empty));
  const draw=now=>{
    raf=0;if(disposed||document.hidden)return;
    const moving=sequence.frames.length>1&&!media?.matches;
    const index=moving?Math.floor(Math.max(0,now-started)/(sequence.frameMs||NORMAL_TICK_MS))%sequence.frames.length:still;
    const frame=sequence.frames[index],asset=frame.asset||(frame.assetIndex!=null?sequence.assets?.[frame.assetIndex]:null)||sequence.asset;
    const image=store.image(asset);
    if(!image&&!requested.has(asset?.url)){
      requested.add(asset?.url);
      Promise.resolve(store.loadImage(asset)).then(()=>{if(!disposed&&!document.hidden){last=-1;if(!raf)draw(performance.now());}})
        .catch(()=>{if(!disposed)canvas.dataset.assetError='true';});
    }
    if(ctx&&image&&index!==last){ctx.clearRect(0,0,width,height);if(!frame.empty)
      ctx.drawImage(image,frame.sx,frame.sy,frame.w,frame.h,(frame.offsetX||0)-bounds[0],(frame.offsetY||0)-bounds[1],frame.w,frame.h);
      last=index;}
    if(moving&&!raf)raf=requestAnimationFrame(draw);
  };
  const visibility=()=>{
    if(document.hidden){pausedAt=performance.now();if(raf)cancelAnimationFrame(raf);raf=0;}
    else{if(pausedAt)started+=performance.now()-pausedAt;pausedAt=0;draw(performance.now());}
  };
  const motion=()=>{if(raf)cancelAnimationFrame(raf);raf=0;last=-1;draw(performance.now());};
  document.addEventListener('visibilitychange',visibility);media?.addEventListener?.('change',motion);
  view.disposables.push({dispose(){disposed=true;if(raf)cancelAnimationFrame(raf);
    document.removeEventListener('visibilitychange',visibility);media?.removeEventListener?.('change',motion);}});
  draw(performance.now());return canvas;
}

function prepare(view,kind){
  const stage=view.stage,catalog=view.ui?.assets?.pve,art=catalog?.ui?.pveResults||{},assets=art.assets||{};
  const style=element('link');style.rel='stylesheet';
  const url=new URL('./m81314_result.css',import.meta.url);url.search=new URL(import.meta.url).search;style.href=url.href;
  stage.append(style);stage.dataset.layout='pve';stage.dataset.pvePage=kind;
  stage.classList.add('m81314-pve-result',`m81316-pve-${kind}`);
  const addArt=(value,x,y,options)=>{const node=originalPveResultArt(view,resolve(catalog,value),x,y,options);if(node)stage.append(node);return node;};
  return {stage,catalog,art,assets,addArt};
}

function installCountdown(view,button,phase){
  const key=view.flow.key;let timer=0,disposed=false;
  const tick=()=>{
    timer=0;if(disposed||view.flow.key!==key||view.flow.phase!==phase||document.hidden)return;
    if(phase==='results'&&view.refreshPveAward?.())return;
    const seconds=Math.max(0,Math.ceil(view.flow.remainingMs()/1000));
    const message=phase==='evaluation'?(seconds?`Phần thưởng sau ${seconds} s`:'Xem phần thưởng'):
      view.flow.error?'Thử trở về PvE':seconds?`Trả về sau ${seconds} s`:'Trở về PvE';
    setText(button.querySelector('.pve-result-back-label'),message);button.setAttribute('aria-label',message);
    timer=setTimeout(tick,250);
  };
  const visibility=()=>{if(timer)clearTimeout(timer);timer=0;if(!document.hidden)tick();};
  document.addEventListener('visibilitychange',visibility);
  view.disposables.push({dispose(){disposed=true;if(timer)clearTimeout(timer);document.removeEventListener('visibilitychange',visibility);}});
  // Phase scheduling is owned by PostmatchFlow after the render callback.
  timer=setTimeout(tick,0);
}

function returnButton(view,phase){
  const button=at(actionButton('',()=>phase==='evaluation'?view.flow.skipEvaluation():view.returnToLobby(),
    {testId:phase==='evaluation'?'pve-result-show-rewards':'postmatch-return-lobby',className:'pve-result-back'}),343,543,156,47);
  if(phase==='results')button.dataset.returnLobby='true';
  button.append(view.art(RESULT_ART.backButton,0,0,156,47),element('span',phase==='evaluation'?'Xem phần thưởng':'Trở về PvE','pve-result-back-label'));
  view.stage.append(button);installCountdown(view,button,phase);return button;
}

/** ResultPveFrame: the original four evaluation rows and total native grade. */
export function renderPveEvaluation(view){
  const data=view.flow.model.soloPve,{stage,catalog,art,assets,addArt}=prepare(view,'evaluation');
  addArt(assets['Result_bk.swf'],500,82,{center:true});addArt(assets['Result_bg3.swf'],100,82);
  addArt(assets['t2_performance_t.png'],500,0,{center:true});
  const seconds=`${String(Math.floor(data.time/60)).padStart(2,'0')}:${String(data.time%60).padStart(2,'0')}`;
  const rows=[['Chiến lực trợ thủ',data.helperPower,'booster','w3_droidscore_t.png',164],
    ['Gây sát thương',data.damage,'harm','w3_damaged_t.png',228],['Lần tử vong',data.deaths,'dead','w3_deathtimes_t.png',286],
    ['Thời gian qua màn',seconds,'time','w3_passtime_t.png',344]];
  for(const [title,value,field,file,y] of rows){
    const bitmap=resolve(catalog,assets[file]);
    if(bitmap){const node=addArt(bitmap,300-bitmap.width,y);node?.setAttribute('aria-label',title);}
    else stage.append(label(title,102,y,198,40,'pve-result-label'));
    const display=value==null?'—':typeof value==='number'?numberText(value):value;
    const node=label(display,309,y-7,215,50,'pve-result-value');node.dataset.metric=field;node.title=title+': '+display;
    node.style.fontSize=`${Math.min(39,205/(Math.max(1,display.length)*.67))}px`;stage.append(node);
    const grade=resolve(catalog,art.grades?.[data.grade[field]]);
    if(grade)addArt(grade,559,y-7);
    else stage.append(label(pveGrade(data.grade[field]),559,y-7,80,48,'pve-result-grade-small'));
  }
  const grade=resolve(catalog,art.largeGrades?.[data.grade.total]);addArt(assets['scoreBg.swf'],648,176);
  if(grade){const node=addArt(grade,745,224,{center:true});node?.setAttribute('aria-label','Đánh giá '+pveGrade(data.grade.total));}
  else stage.append(label(pveGrade(data.grade.total),650,225,200,100,'pve-result-grade'));
  returnButton(view,'evaluation');
}

export function pveRewardItem(catalog,uiAssets,reward){
  const item=(catalog?.rawTemplates||catalog?.templates)?.ItemTemplate_table?.findLast(row=>Number(row.nItemId)===reward.itemId);
  const garage=uiAssets?.garage?.items?.[String(reward.itemId)];
  const icon=resolve(catalog,catalog?.assets?.[`zh_CN/icon/item/${item?.szIconPath1||''}`])||uiAssets?.get?.(garage?.icon);
  return {...reward,icon,name:nativeText(garage?.name||catalog?.localizedText?.[item?.szName]||item?.szName)||`Vật phẩm ${reward.itemId}`};
}

/** ResultPveSecondFrame: avatar + exact 477x421 original reward panel. All
 * quantities remain the S1708 statistics and S1104 awarded item vector. */
export function renderPveResults(view){
  const data=view.flow.model.soloPve,model=view.flow.model,{stage,catalog,assets,addArt}=prepare(view,'rewards');
  const player=model.self||model.players?.find(row=>row.accountId===model.selfAccountId),reward=model.rewards||{};
  addArt(assets['Result_bk.swf'],500,102,{center:true});addArt(assets['Result_bg3.swf'],100,102);
  stage.append(view.art(data.won?RESULT_ART.win:RESULT_ART.lose,441.5,0));
  const mapName=nativeText(catalog?.maps?.[String(model.result.mapId)]?.name)||`Màn ${model.result.mapId}`;
  stage.append(label(mapName,160,66,680,25,'pve-result-map-name'));
  if(player){
    const avatarRow=view.ui?.assets?.accountPresentation?.characters?.[String(player.avatarId)];
    const avatar=view.ui?.assets?.get?.(avatarRow?.assetKey);
    if(avatar){const node=view.art(avatar,170,110,200,210,player.name);node.classList.add('pve-result-avatar');stage.append(node);}
    else stage.append(view.portrait(player.tank,170,112,200));
    stage.append(label(player.name,175,324,194,30,'pve-result-player-name'));
    const grade=pveGrade(data.grade.total);stage.append(label(grade,175,354,194,32,'pve-result-player-grade'));
    for(const [i,[name,value]] of [['Điểm',nonnegative(data.self.stats?.[2])],['EXP',nonnegative(reward.exp)],
      ['Bạc',nonnegative(reward.coins)],['Cống hiến',nonnegative(reward.teamMerit)]].entries()){
      const row=at(element('div',null,'pve-result-player-stat'),176,388+i*28,191,25);
      row.append(element('span',name),element('strong',numberText(value)));stage.append(row);
    }
  }
  stage.append(view.art(RESULT_ART.rewardPanel,371,86));
  stage.append(view.art('results.expHeader',382,107),view.art('results.rewardShadow',392,166),view.art('results.rewardHeading',566,156));
  const character=view.client.state.meta?.character,chrome=view.ui?.assets?.chrome;
  if(character&&chrome?.levels&&chrome?.vip){
    const progress=characterProgress(character,chrome),current=view.ui.assets.get(`chrome.charLevel${progress.level}`),next=view.ui.assets.get(`chrome.charLevel${progress.level+1}`);
    if(current)stage.append(view.art(current,375,111,64,32));if(next)stage.append(view.art(next,777,111,64,32));
    const fill=view.asset('results.expFill'),fraction=progress.need>0?Math.max(0,Math.min(1,progress.exp/progress.need)):1;
    if(fill){const clip=at(element('span',null,'pve-result-exp-fill'),445,134,fill.width*fraction,fill.height);clip.append(view.art(fill));stage.append(clip);}
    const summary=progress.need<0?'MAX':`${(fraction*100).toFixed(2)}%   ${numberText(progress.exp)} / ${numberText(progress.need)}`;
    stage.append(label(summary,460,111,300,24,'pve-result-exp-summary'));
  }
  const itemHost=at(element('div',null,'pve-result-items'),389,182,440,164);itemHost.setAttribute('aria-label','Vật phẩm máy chủ đã ghi nhận');stage.append(itemHost);
  const items=data.rewards.map(item=>pveRewardItem(catalog,view.ui?.assets,item)),pages=Math.max(1,Math.ceil(items.length/10));let page=0;
  let pager=null,previous=null,next=null;
  const renderItems=()=>{
    itemHost.replaceChildren();itemHost.dataset.page=String(page+1);
    for(let index=0;index<10;index++){
      const item=items[page*10+index],slot=at(element('div',null,'pve-result-item'),index%5*87.6,Math.floor(index/5)*82,87.6,82);
      slot.append(view.art('results.itemBox',0,0,87.6,81));
      if(item){
        slot.dataset.itemId=String(item.itemId);slot.title=`${item.name} ×${item.count}`;
        if(item.icon?.url)slot.append(view.art(item.icon,8,5,68,68,item.name));
        else slot.append(label(item.name,7,10,72,50,'pve-result-item-name'));
        const count=label(`×${item.count}`,3,55,77,22,'pve-result-item-count');
        count.style.fontSize=`${Math.min(17,75/(Math.max(1,count.textContent.length)*.65))}px`;slot.append(count);
      }else slot.setAttribute('aria-label','Ô trống');
      itemHost.append(slot);
    }
    if(pager){setText(pager,`${page+1}/${pages}`);previous.disabled=page===0;next.disabled=page===pages-1;}
  };
  if(pages>1){
    previous=at(actionButton('‹',()=>changePage(-1),{className:'pve-reward-page',title:'Trang trước'}),704,150,25,25);
    next=at(actionButton('›',()=>changePage(1),{className:'pve-reward-page',title:'Trang sau'}),801,150,25,25);
    pager=label('',731,153,68,22,'pve-reward-page-number');stage.append(previous,pager,next);
  }
  function changePage(step){page=Math.max(0,Math.min(pages-1,page+step));view.flow.cancelAfter();renderItems();}
  renderItems();
  for(const [kind,key,y,total] of [['coins','results.coinLabel',355,nonnegative(reward.coins)],['exp','results.expLabel',411,nonnegative(reward.exp)]]){
    stage.append(view.art(key,402,y),label(numberText(total),711,y-2,100,24,'pve-result-reward-total'));
    const progress=at(element('div',null,'pve-result-reward-progress'),400,y+19,416,30);progress.dataset.reward=kind;
    progress.append(view.art('results.progress.green',3,3,410,24),view.art('results.progressBackground',0,0,416,30),label(`+${numberText(total)}`,3,3,410,24,'pve-result-reward-value'));
    stage.append(progress);
  }
  stage.append(view.art('results.meritLabel',402,466),label(numberText(nonnegative(reward.teamMerit)),711,463,100,24,'pve-result-reward-total'));
  const status=!data.awardAcknowledged?'Đang chờ gói thưởng từ máy chủ.':!items.length?'Không có vật phẩm thưởng trong lượt này.':'Thưởng đã ghi nhận. Nếu túi đầy, vật phẩm được giữ chờ.';
  stage.append(label(status,175,510,660,25,'pve-result-delivery'));returnButton(view,'results');
}
