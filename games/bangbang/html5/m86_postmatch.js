import {element, assetImage, nativeText} from './m8_ui_helpers.js';
import {M8UIAssets} from './m8_assets.js';
import {characterProgress} from './m83_chrome.js';
import {pveResultModel,renderPveResults,renderPveEvaluation,preloadPveResultArt,PVE_RESULT_BITMAPS} from './m81314_result.js';

const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const id = value => Math.max(0, Math.trunc(finite(value)));
const stat = (actor, index) => finite(actor?.stats?.[index]);
const BASE_MAPS = new Set([12, 14, 50, 169]);
const MEDALS = Object.freeze([
  {field:'killerId', kind:'kill', label:'Kẻ tàn sát', frame:2},
  {field:'assisterId', kind:'assist', label:'Trợ công', frame:3},
  {field:'kdaId', kind:'kda', label:'MVP', frame:1},
]);

export function postmatchKey(result, generation, selfAccountId) {
  return `${generation}:${id(result.sceneId)}:${result.sceneUuid || ''}:${id(selfAccountId)}`;
}

/** Server-selected awards only. Original MV groups repeated IDs onto one actor.
 * The structure award is deliberately settlement-only (AGENTS 2026-10-09).
 */
export function nativeHonorGroups(result, players, selfAccountId, selfCamp) {
  const byId = new Map(players.map(player => [id(player.accountId), player]));
  const awards = MEDALS.map(row => ({...row, accountId:id(result[row.field])}))
    .filter(row => row.accountId && byId.has(row.accountId));
  // BattleResultMVProxy.initModel: descending accountId, then rotate the last
  // winner to the front when the second and third winners differ.
  // Preserve KILL / ASSIST / KDA for a shared winner, as the native reference
  // shows. AS3's comparator returns -1 for equal IDs; copying it literally into
  // JavaScript reverses the shared medals (ASSIST / MVP) in V8.
  awards.sort((a,b) => b.accountId-a.accountId);
  if (awards.length === 3 && awards[1].accountId !== awards[2].accountId) awards.unshift(awards.pop());
  const groups = [];
  for (const award of awards) {
    let group = groups.find(row => row.accountId === award.accountId);
    if (!group) {
      const player = byId.get(award.accountId);
      group = {accountId:award.accountId, player, awards:[],
        color:award.accountId === id(selfAccountId) ? 'green' : id(player.camp) === id(selfCamp) ? 'blue' : 'red'};
      groups.push(group);
    }
    group.awards.push(award);
  }
  return groups;
}

export function settlementAwards(result, accountId) {
  const awards = MEDALS.filter(row => id(result[row.field]) !== 0 && id(result[row.field]) === id(accountId));
  if (BASE_MAPS.has(id(result.mapId)) && id(result.destroyerId) && id(result.destroyerId) === id(accountId))
    awards.push({field:'destroyerId', kind:'destroyer', label:'Công phá'});
  return awards;
}

export function nativeSettlementOrder(players, selfAccountId, selfCamp) {
  const compare = (a,b) => stat(b,2)-stat(a,2) || stat(b,1)-stat(a,1) || stat(a,0)-stat(b,0)
    || id(a.accountId)-id(b.accountId);
  const own = players.filter(row => id(row.camp) === id(selfCamp)).map(row=>({...row})).sort(compare);
  const enemy = players.filter(row => id(row.camp) !== id(selfCamp)).map(row=>({...row})).sort(compare);
  // Native rank is calculated before moving the current player to the first row.
  for (const rows of [own,enemy]) rows.forEach((row,index) => {row.resultRank=index+1;});
  const self = own.findIndex(row => id(row.accountId) === id(selfAccountId));
  if (self > 0) own.unshift(...own.splice(self,1));
  return {own,enemy};
}

export function nativeRewardSegments(groups = []) {
  // BATTLE_SETTLE_TYPE and AwardPercentProgress. No advertised/potential VIP
  // value is added to authoritative rewards in the HTML5 client.
  const values = [0,0,0,0,0,0,0];
  for (const group of groups) {
    const value = Math.max(0,finite(group.value));
    switch (Math.trunc(finite(group.type))) {
      case 0: case 7: values[0] += value; break;
      case 1: values[1] = value; break;
      case 3: case 20: values[2] = value; break;
      case 5: values[3] = value; break;
      case 6: values[4] = value; break;
      case 4: values[5] = value; break;
      case 2: values[6] = value; break;
    }
  }
  const total = values.reduce((a,b) => a+b,0);
  if (!total) return [{kind:'base',color:'green',label:'',value:0,fraction:1}];
  const count = values.filter(Boolean).length, each = Math.min(.2,.8/count), rest = 1-each*count;
  const fractions = values.map(value => value ? each + value/total*rest : 0);
  if (fractions.some(value => value > 0 && value < .2)) {
    for (let i=0;i<fractions.length;i++) if (fractions[i] > .5) {
      const others = fractions.map((value,index) => value > 0 && value < .5 ? index : -1).filter(index => index >= 0);
      for (const index of others) fractions[index] += (fractions[i]-.5)/others.length;
      fractions[i] = .5;
    }
  }
  return [
    ['base','green','Cơ bản'],['event','orange','Sự kiện'],['double','cyan','Nhân đôi'],
    ['avatar','red','Thời trang'],['decoration','blue','Trang trí'],['daily','pink','Hằng ngày'],['vip','pink','VIP'],
  ].map(([kind,color,label],index) => ({kind,color,label,value:values[index],fraction:fractions[index]})).filter(row => row.value);
}

/** Preserve full S1457/S1700 brief appearance data that the combat reducer does
 * not need. Never recover account cosmetics from another player's own garage.
 */
export function postmatchModel(combat, state = {}, assets = null) {
  const result = combat.result, selfAccountId = id(combat.selfAccountId || state.accountId);
  const briefs = new Map();
  const flowRoster = !state.flow?.scene || id(state.flow.scene.sceneId) === id(result.sceneId) ? state.flow?.roster : [];
  for (const source of [combat.characters, state.play?.room?.characters, flowRoster, state.play?.scene?.characters]) {
    for (const brief of source || []) {
      const accountId = id(brief.accountId || brief.player?.accountId);
      briefs.set(accountId, {...(briefs.get(accountId)||{}),...brief,
        player:{...(briefs.get(accountId)?.player||{}),...(brief.player||{})},
        other:{...(briefs.get(accountId)?.other||{}),...(brief.other||{})}});
    }
  }
  const players = [...(result.actors||[]),...(result.escaped||[]).map(row => ({...row,escaped:true}))].map(actor => {
    const accountId = id(actor.accountId), brief = briefs.get(accountId)||{};
    const own = accountId === selfAccountId ? state.meta?.character||{} : {};
    const other = brief.other||{}, player = brief.player||{};
    const tank = {tankId:id(actor.tankId||other.tankId||brief.tankId),
      tankLevel:id(other.tankLevel||brief.tankLevel||1), level:id(other.tankLevel||brief.tankLevel||1),
      externalId:id(other.externalId||brief.externalId), haloId:id(other.haloId||brief.haloId),
      skinFrameType:id(other.skinFrameType||brief.skinFrameType)};
    return {...actor,accountId,tank,name:nativeText(player.name||brief.name||own.name||`Người chơi ${accountId}`),
      level:id(player.level??brief.level??own.level), avatarId:id(player.avatarId??brief.avatarId??own.avatarId),
      tankName:nativeText(assets?.tankName?.(tank.tankId)||`Tank ${tank.tankId}`),
      kills:stat(actor,1),deaths:stat(actor,0),assists:stat(actor,3),elo:finite(actor.newElo),
      eloDelta:finite(actor.newElo)-finite(actor.oldElo)};
  });
  const self = players.find(row => row.accountId === selfAccountId);
  const selfCamp = id(self?.camp || combat.actors?.[String(combat.selfObjectId)]?.camp);
  const honorPlayers = players.filter(row => !row.escaped);
  const honors = nativeHonorGroups(result,honorPlayers,selfAccountId,selfCamp);
  const winner = players.find(row => row.accountId === id(result.victoryMvpId));
  const loser = players.find(row => row.accountId === id(result.defeatMvpId));
  // Original compares the two server nominated MVPs by score. The current
  // native server can omit defeatMvpId; retain its supplied winner/KDA nominee.
  const featured = winner && loser ? stat(winner,2)>=stat(loser,2)?winner:loser : winner||loser||
    players.find(row => id(result.kdaId) && row.accountId === id(result.kdaId))||null;
  const soloPve=pveResultModel(result,state);
  const outcome = soloPve?(soloPve.won?'win':'lose'):!id(result.winCamp) ? 'draw' : id(result.winCamp)===selfCamp ? 'win' : 'lose';
  return {result,players,self,selfAccountId,selfCamp,honors:soloPve?[]:honors,featured,outcome,soloPve,
    outcomeText:outcome==='draw'?'Hòa':outcome==='win'?'Chiến thắng':'Thất bại',
    teams:nativeSettlementOrder(players,selfAccountId,selfCamp),
    rewards:{coins:stat(self,11),exp:stat(self,10),teamMerit:finite(self?.teamMerit),
      coinSegments:nativeRewardSegments(self?.coins),expSegments:nativeRewardSegments(self?.exp),
      items:(self?.items||[]).filter(row => id(row.templateId) && finite(row.count)>0).map(row => ({...row}))}};
}

export function nativePostmatchDurations(model, catalog) {
  const native = catalog?.honors;
  const fps = native?.fps||24, kind = model.outcome === 'win' ? 'win' : 'lose';
  const start = native?.labels?.[kind==='win'?'label_shengli':'label_shibai'] ?? (kind==='win'?2:96);
  const end = native?.titleComplete?.[kind] ?? (kind==='win'?95:190);
  const count = model.honors.length;
  const branch = native?.branches?.[count] || ({1:{start:503,end:646},2:{start:351,end:502},3:{start:191,end:350}})[count];
  return {titleMs:(end-start)*1000/fps, honorsMs:branch?(branch.end-branch.start)*1000/fps+(native?.afterMovieMs??1000):0,
    ...(model.soloPve?{evaluationMs:model.soloPve.won?5000:0,rewardsMs:5000}:{})};
}

/** A result identity may be redelivered after a network pause. It is one
 * presentation and one C613 action, never a second timer chain or local exit.
 */
export class PostmatchFlow {
  constructor({onPhase=()=>{},onAutoReturn=()=>{},setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=timer=>clearTimeout(timer),now=()=>performance.now()}={}) {
    this.onPhase=onPhase;this.setTimer=setTimer;this.clearTimer=clearTimer;this.now=now;
    this.onAutoReturn=onAutoReturn;this.pending=null;this.paused=false;
    this.phase='idle';this.key=null;this.epoch=0;this.timer=null;this.model=null;this.error='';
  }
  setPhase(phase) {this.phase=phase;this.phaseAt=this.now();this.onPhase(phase,this);}
  cancelAfter() {
    if(this.timer!=null)this.clearTimer(this.timer);this.timer=null;this.pending=null;
  }
  after(ms,callback) {
    this.cancelAfter();
    const epoch=this.epoch;
    this.pending={ms:Math.max(0,ms),deadline:this.now()+Math.max(0,ms),callback,epoch};
    if(!this.paused)this.arm();
  }
  arm() {
    const pending=this.pending;if(!pending)return;
    pending.deadline=this.now()+pending.ms;
    this.timer=this.setTimer(()=>{
      this.timer=null;if(pending!==this.pending||pending.epoch!==this.epoch)return;
      this.pending=null;pending.callback();
    },pending.ms);
  }
  remainingMs() {return this.pending?(this.paused?this.pending.ms:Math.max(0,this.pending.deadline-this.now())):0;}
  setPaused(value) {
    // Background tabs must not consume the player's five-second PvE review.
    // The established PvP timeline is deliberately untouched.
    if(!this.model?.soloPve||this.paused===!!value)return;
    if(value){
      if(this.pending)this.pending.ms=this.remainingMs();
      this.paused=true;this.pausedAt=this.now();
      if(this.timer!=null)this.clearTimer(this.timer);this.timer=null;
    }else{
      this.phaseAt+=Math.max(0,this.now()-this.pausedAt);this.paused=false;
      if(this.pending)this.arm();
    }
  }
  pveRewards() {
    if(!this.model?.soloPve)return false;
    this.cancelAfter();this.setPhase('results');
    // S1104 normally precedes S1708. If it is missing, leave the review open
    // instead of hiding an unacknowledged award behind an automatic return.
    if(this.model.soloPve.awardAcknowledged)this.after(this.durations.rewardsMs,()=>this.onAutoReturn());
    return true;
  }
  skipEvaluation() {
    return this.phase==='evaluation'?this.pveRewards():false;
  }
  open(key,model,durations) {
    if(key===this.key&&this.phase!=='idle'){
      const acknowledged=this.model?.soloPve?.awardAcknowledged;
      this.model=model;
      if(model.soloPve&&this.phase==='results'&&!acknowledged&&model.soloPve.awardAcknowledged&&!this.error)
        this.after(this.durations.rewardsMs,()=>this.onAutoReturn());
      return false;
    }
    this.reset();this.key=key;this.model=model;this.startedAt=this.now();this.error='';
    this.durations={...durations,evaluationMs:durations.evaluationMs??(model.soloPve?.won?5000:0),rewardsMs:durations.rewardsMs??5000};
    this.setPhase('title');
    this.after(durations.titleMs,()=>{
      if(model.soloPve){
        if(this.durations.evaluationMs>0){this.setPhase('evaluation');this.after(this.durations.evaluationMs,()=>this.pveRewards());}
        else this.pveRewards();
      }else if(durations.honorsMs>0){this.setPhase('honors');this.after(durations.honorsMs,()=>this.setPhase('results'));}
      else this.setPhase('results');
    });
    return true;
  }
  async returnToLobby(action) {
    if(this.phase!=='results')return false;
    const epoch=this.epoch;this.cancelAfter();this.error='';this.setPhase('returning');
    try {await action();return epoch===this.epoch;}
    catch(error) {
      if(epoch!==this.epoch)return false;
      this.error=String(error?.message||'Chưa thể về sảnh. Hãy thử lại.');this.setPhase('results');return false;
    }
  }
  reset() {
    this.epoch+=1;this.cancelAfter();this.paused=false;
    this.key=null;this.model=null;this.error='';this.setPhase('idle');
  }
  snapshot(){return {phase:this.phase,key:this.key,epoch:this.epoch,error:this.error,
    winners:this.model?.honors.map(row=>({accountId:row.accountId,medals:row.awards.map(award=>award.kind)}))||[]};}
}

function at(node,x,y,width,height) {
  Object.assign(node.style,{position:'absolute',left:`${x}px`,top:`${y}px`});
  if(width!=null)node.style.width=`${width}px`;if(height!=null)node.style.height=`${height}px`;
  return node;
}
function text(value,x,y,width,height,className='') {
  return at(element('span',value,`m86-result-text ${className}`),x,y,width,height);
}
/** Samples are the original SWF ShowFrames, including Flash's authored easing.
 * Interpolate only their transform/color values at display refresh rate. Do not
 * stretch the 24fps timeline or interpolate bitmap title/symbol frames.
 */
export function sampleNativeMotion(frames,position) {
  if(!frames?.length)return {};
  const bounded=Math.max(0,Math.min(frames.length-1,Number.isFinite(position)?position:0));
  const index=Math.floor(bounded),first=frames[index],next=frames[Math.min(index+1,frames.length-1)],mix=bounded-index;
  if(!mix||first===next)return first;
  const sample={};
  for(const [key,a] of Object.entries(first)) {
    const b=next[key];
    // A named instance's appearance/removal is a discrete ShowFrame event.
    if(!b){sample[key]=a;continue;}
    sample[key]={matrix:a.matrix.map((value,i)=>value+(b.matrix[i]-value)*mix),
      alpha:a.alpha+(b.alpha-a.alpha)*mix,white:a.white+(b.white-a.white)*mix,
      rgbMultiplier:(a.rgbMultiplier??(1-a.white))+((b.rgbMultiplier??(1-b.white))-(a.rgbMultiplier??(1-a.white)))*mix};
  }
  return sample;
}

export function nativeColorFilter(sample) {
  const white=Math.max(0,Math.min(1,sample.white||0)),mult=sample.rgbMultiplier??(1-white);
  if(!white)return mult===1?'':`brightness(${mult})`;
  if(white===1)return 'brightness(0) invert(1)';
  // Flash uses rgb' = rgb * multiplier + offset. The old brightness(1+12*w)
  // clipped saturated colors and could never whiten black. This equivalent
  // neutral CSS filter preserves alpha without extra image/filter surfaces.
  const remaining=1-white;
  return `brightness(${mult/remaining}) invert(1) brightness(${remaining}) invert(1)`;
}

const frameStyles=new WeakMap();
function initializeNativeFrame(node,sample) {
  if(!node||!sample)return;
  // A native portrait sets visibility on its own child after loading. Its
  // ancestor must already have both the authored transform and alpha before
  // it is connected; inherited visibility alone cannot hide that child.
  const styles={opacity:String(sample.alpha),transform:`matrix(${sample.matrix.join(',')})`,filter:nativeColorFilter(sample)};
  Object.assign(node.style,styles);frameStyles.set(node,styles);
}
export function applyNativeFrame(node,sample) {
  if(!node||!sample)return;
  let previous=frameStyles.get(node);
  if(!previous){previous={};frameStyles.set(node,previous);}
  const opacity=String(sample.alpha);
  if(previous.opacity!==opacity){node.style.opacity=opacity;previous.opacity=opacity;}
  // Hidden tracks need neither transform nor filter work until they appear.
  if(sample.alpha<=0)return;
  const transform=`matrix(${sample.matrix.join(',')})`,filter=nativeColorFilter(sample);
  if(previous.transform!==transform){node.style.transform=transform;previous.transform=transform;}
  if(previous.filter!==filter){node.style.filter=filter;previous.filter=filter;}
}

export class M86Postmatch {
  constructor({host,client,releaseInput=()=>{},playSound=()=>{}}) {
    this.host=host;this.client=client;this.releaseInput=releaseInput;this.playSound=playSound;
    this.ui=null;this.catalog=null;this.raf=0;this.disposables=[];this.sounds=new Set();
    this.portraits=new M8UIAssets();this.portraits.setEnabled(false);
    this.root=element('div',null,'m86-postmatch');this.root.hidden=true;
    this.root.setAttribute('role','dialog');this.root.setAttribute('aria-modal','true');this.root.tabIndex=-1;
    this.root.dataset.testid='postmatch';host.append(this.root);
    this.stage=element('div',null,'m86-postmatch-stage');this.root.append(this.stage);
    this.status=element('div',null,'m86-postmatch-status');this.status.setAttribute('role','status');this.root.append(this.status);
    this.flow=new PostmatchFlow({onPhase:phase=>this.renderPhase(phase),onAutoReturn:()=>this.returnToLobby()});
    this.onVisibility=()=>{
      this.flow.setPaused(document.hidden);
      if(this.flow.model?.soloPve){
        this.portraits.setEnabled(!document.hidden);
        if(document.hidden){if(this.raf)cancelAnimationFrame(this.raf);this.raf=0;}
        else if(this.flow.phase==='title'){
          this.sound(`sound.${this.flow.model.outcome}`,'title');this.animate(performance.now());
        }
      }
    };
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(host);
    this.animate=this.animate.bind(this);
  }
  setUI(ui) {
    this.ui=ui;this.catalog=ui?.assets?.postmatchPresentation||null;
    for(const name of ['hud','presentation','garage','resources','panels','ui','chrome','accountPresentation'])
      this.portraits[name]=ui?.assets?.[name];
    // Decoding starts on scene entry/setup, so a final blow never reveals blank
    // first frames while a large native title atlas is downloading.
    this.preload=Promise.all([...Object.values(this.catalog?.assets||{}),...PVE_RESULT_BITMAPS].filter(asset=>asset.width&&asset.height).map(asset=>{
      const image=new Image();image.src=asset.url;return image.decode().catch(()=>{});
    }));
  }
  asset(key){return this.catalog?.assets?.[key]||this.ui?.assets?.get?.(key)||null;}
  art(key,x=0,y=0,width=null,height=null,alt='') {
    const asset=typeof key==='string'?this.asset(key):key;
    return at(assetImage(asset,alt,'m86-native-art'),x,y,width??asset?.width,height??asset?.height);
  }
  portrait(tank,x,y,size=200) {
    const portrait=this.portraits.portraitForTank(tank,{size,animate:true,preferNative:size>=160});
    this.disposables.push(portrait);return at(portrait,x,y,size,size);
  }
  sound(key,eventKey) {
    if(this.flow.model?.soloPve&&document.hidden)return;
    if(this.sounds.has(eventKey))return;this.sounds.add(eventKey);
    this.playSound(this.asset(key),null,{kind:'postmatch',eventKey:`${this.flow.key}:${eventKey}`});
  }
  show(combat) {
    if(!combat?.result)return false;
    const model=postmatchModel(combat,this.client.state,this.ui?.assets),key=postmatchKey(combat.result,this.client.generation,model.selfAccountId);
    this.releaseInput();
    const opened=this.flow.open(key,model,nativePostmatchDurations(model,this.catalog));
    this.flow.setPaused(document.hidden);
    if(!opened&&this.flow.phase==='results')this.renderPhase('results');
    return opened;
  }
  refreshPveAward() {
    const model=this.flow.model,combat=this.client.combat;
    if(!model?.soloPve||this.flow.phase!=='results'||!combat?.result
      ||postmatchKey(combat.result,this.client.generation,model.selfAccountId)!==this.flow.key)return false;
    const data=pveResultModel(combat.result,this.client.state);if(!data)return false;
    if(JSON.stringify([data.awardAcknowledged,data.rewards])===JSON.stringify([model.soloPve.awardAcknowledged,model.soloPve.rewards]))return false;
    this.flow.open(this.flow.key,{...model,soloPve:data},this.flow.durations);
    this.renderPhase('results');return true;
  }
  clearStage() {
    if(this.raf)cancelAnimationFrame(this.raf);this.raf=0;
    for(const node of this.disposables)node.dispose?.();this.disposables=[];
    this.stage.replaceChildren();this.players=[];this.medals=[];this.titleFrame=null;this.titleFrameIndex=-1;
    delete this.stage.dataset.pvePage;
    this.stage.classList.remove('m81314-pve-result','m81316-pve-evaluation','m81316-pve-rewards');
  }
  renderPhase(phase) {
    if(!this.stage)return;
    this.root.dataset.phase=phase;
    if(phase==='idle') {
      document.removeEventListener('visibilitychange',this.onVisibility);
      this.clearStage();this.root.hidden=true;this.portraits.setEnabled(false);this.sounds.clear();
      this.host.classList.remove('m86-postmatch-active');return;
    }
    if(this.flow.model.soloPve)document.addEventListener('visibilitychange',this.onVisibility);
    if(this.flow.model.soloPve&&['evaluation','results'].includes(phase)){
      const current=pveResultModel(this.flow.model.result,this.client.state);
      if(current)this.flow.model.soloPve=current;
    }
    this.root.hidden=false;this.host.classList.add('m86-postmatch-active');this.portraits.setEnabled(true);
    this.root.setAttribute('aria-label',phase==='title'?this.flow.model.outcomeText:phase==='honors'?'Vinh danh':phase==='evaluation'?'Đánh giá PvE':'Kết quả trận đấu');
    this.status.textContent=phase==='returning'?'Đang về sảnh…':this.flow.error;
    if(phase==='returning') {
      for(const button of this.stage.querySelectorAll('[data-return-lobby]'))button.disabled=true;
      return;
    }
    this.clearStage();
    if(phase==='title') {
      this.stage.dataset.layout='honors';this.renderTitle();
      this.root.focus({preventScroll:true});
    }else if(phase==='honors') {
      this.stage.dataset.layout='honors';this.renderHonors();
    }else if(phase==='evaluation') {
      renderPveEvaluation(this);
    }else {
      this.stage.dataset.layout='results';this.renderResults();
      this.stage.querySelector('[data-testid="postmatch-return-lobby"]')?.focus({preventScroll:true});
    }
    this.resize();
    if(phase==='title'||phase==='honors')this.animate(performance.now());
  }
  resize() {
    const pve=this.stage?.dataset.layout==='pve',results=this.stage?.dataset.layout==='results',width=pve?1000:results?977:550,height=pve?600:results?618:400;
    const bounds=this.host.getBoundingClientRect();
    const scale=Math.max(.1,Math.min(1,(bounds.width-12)/(pve?1000:results?977:850),(bounds.height-12)/(pve?600:results?618:560)));
    Object.assign(this.stage.style,{width:`${width}px`,height:`${height}px`,
      transform:`translate(-50%,-50%) scale(${scale})`});
  }
  renderTitle() {
    const model=this.flow.model;
    if(model.soloPve)this.pveArtPreload=preloadPveResultArt(this);
    if(model.outcome==='draw')this.stage.append(text('HÒA',25,130,500,100,'m86-draw-title'));
    else {
      const sequence=this.catalog?.titles?.[model.outcome],asset=sequence&&this.asset(sequence.assetKey);
      if(sequence&&asset){
        this.titleFrame=element('span',null,'m86-native-title');this.titleFrame.style.backgroundImage=`url("${asset.url}")`;
        this.titleFrame.setAttribute('role','img');this.titleFrame.setAttribute('aria-label',model.outcomeText);this.stage.append(this.titleFrame);
      }else this.stage.append(text(model.outcomeText,25,130,500,100,'m86-draw-title'));
      this.sound(`sound.${model.outcome}`,'title');
    }
  }
  renderHonors() {
    const groups=this.flow.model.honors,native=this.catalog?.honors;
    const branch=native?.branches?.[groups.length];
    if(!branch)return;
    let medalIndex=0;
    groups.forEach((group,index)=>{
      const player=group.player,base=at(element('div',null,'m86-honor-player'),branch.playerX[index],native.playerY,0,0);
      base.dataset.accountId=String(group.accountId);base.dataset.color=group.color;
      base.style.opacity='0';base.style.visibility='hidden';
      const nodes={};
      nodes.mc_juesedikuang=this.art(`honor.podium.${group.color}`);
      nodes.mc_tankemingzidi=this.art(`honor.tankName.${group.color}`);
      nodes.cvs_tankemingzi=at(element('span',player.tankName,'m86-honor-tank-name'),-100,-10,200,20);
      nodes.cvs_juesetanke=this.portrait(player.tank,0,0,200);
      // BattleResultMVProxy's original avatar0 fallback is display-only. Keep it
      // stable across packet redelivery, without changing equipped/owned items.
      const avatarId=player.avatarId||(player.accountId%2?2801001:2802001);
      const row=this.ui?.assets?.accountPresentation?.characters?.[String(avatarId)];
      const avatar=this.ui?.assets?.get?.(row?.assetKey)||this.ui?.assets?.accountPresentation?.assets?.[row?.assetKey];
      const avatarHost=at(element('div',null,'m86-honor-avatar-mask'),-170,-392.95,371,215);
      nodes.cvs_jueserenwu=at(element('span',null,'m86-honor-avatar'),170,392.95,0,0);
      nodes.cvs_jueserenwu.append(this.art(avatar,-(avatar?.width||180)/2,-(avatar?.height||240)/2));
      avatarHost.append(nodes.cvs_jueserenwu);base.append(avatarHost);
      nodes.mc_juesemingzidi=this.art(`honor.name.${group.color}`);
      nodes.cvs_juesemingzi=at(element('span',player.name,'m86-honor-name'),-120,-13,240,26);
      base.prepend(nodes.mc_juesedikuang,nodes.mc_tankemingzidi,nodes.cvs_tankemingzi,nodes.cvs_juesetanke);
      base.append(nodes.mc_juesemingzidi,nodes.cvs_juesemingzi);
      for(const [key,node] of Object.entries(nodes))initializeNativeFrame(node,native.player[0]?.[key]);
      this.stage.append(base);this.players.push({nodes,start:branch.playerFrames[index]-branch.start,base,visible:false});
      group.awards.forEach((award,within)=>{
        let position=branch.medals[medalIndex];
        if(groups.reduce((sum,g)=>sum+g.awards.length,0)<3)position=[branch.playerX[index]+(within-(group.awards.length-1)/2)*114.5,8];
        const medal=at(element('div',null,'m86-honor-medal'),position[0],position[1],0,0);
        medal.dataset.award=award.kind;medal.dataset.accountId=String(group.accountId);
        medal.style.opacity='0';medal.style.visibility='hidden';
        const picture=at(element('span',null,'m86-medal-picture'),0,0,0,0);
        picture.append(this.art(`honor.medal.${award.kind}`,-50,-50,100,100,award.label));
        const word=at(element('span',null,'m86-medal-word'),0,0,0,0),asset=this.asset(`honor.word.${award.kind}`);
        word.append(this.art(asset,-(asset?.width||0)/2,-(asset?.height||0)/2));
        initializeNativeFrame(picture,native.medal[0]?.mc_xunzhangtupian);
        initializeNativeFrame(word,native.medal[0]?.cvs_xunzhangmingzi);
        medal.append(picture,word);this.stage.append(medal);
        this.medals.push({picture,word,start:branch.medalFrames[medalIndex]-branch.start,index:medalIndex,visible:false});medalIndex+=1;
      });
    });
  }
  animate(now) {
    const elapsed=Math.max(0,now-this.flow.phaseAt),native=this.catalog?.honors;
    const position=elapsed*(native?.fps||24)/1000,frame=Math.floor(position);
    let needsFrame=false;
    if(this.flow.phase==='title'&&this.titleFrame) {
      if(this.flow.model.soloPve&&document.hidden){this.raf=0;return;}
      const reduced=!!this.flow.model.soloPve&&globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const sequence=this.catalog.titles[this.flow.model.outcome],index=reduced?sequence.frames.length-1:Math.min(frame,sequence.frames.length-1);
      if(index!==this.titleFrameIndex) {
        const sample=sequence.frames[index];
        at(this.titleFrame,sample.left,sample.top,sample.width,sample.height);
        this.titleFrame.style.backgroundPosition=`${-sample.x}px ${-sample.y}px`;this.titleFrameIndex=index;
      }
      needsFrame=index<sequence.frames.length-1;
    }
    if(this.flow.phase==='honors'&&native) {
      for(const [index,player] of this.players.entries()) {
        if(player.settled)continue;
        const local=position-player.start,visible=local>=0;
        if(player.visible!==visible){
          player.base.style.opacity=visible?'1':'0';player.base.style.visibility=visible?'visible':'hidden';player.visible=visible;
        }
        if(!visible){needsFrame=true;continue;}
        this.sound('sound.podium',`podium-${index}`);
        const sample=sampleNativeMotion(native.player,local+1);
        for(const [key,node] of Object.entries(player.nodes))applyNativeFrame(node,sample[key]);
        player.settled=local+1>=native.player.length-1;needsFrame ||= !player.settled;
      }
      for(const medal of this.medals) {
        if(medal.settled)continue;
        const local=position-medal.start,visible=local>=0;
        if(medal.visible!==visible){
          const holder=medal.picture.parentElement;holder.style.opacity=visible?'1':'0';
          holder.style.visibility=visible?'visible':'hidden';medal.visible=visible;
        }
        if(!visible){needsFrame=true;continue;}
        const sample=sampleNativeMotion(native.medal,local+1);
        applyNativeFrame(medal.picture,sample.mc_xunzhangtupian);applyNativeFrame(medal.word,sample.cvs_xunzhangmingzi);
        if(local>=7)this.sound('sound.medal',`medal-${medal.index}`);
        medal.settled=local+1>=native.medal.length-1;needsFrame ||= !medal.settled;
      }
    }
    // Phase timers, not RAF, own title→honors→results. Nothing has to repaint
    // throughout the native end hold; returning/reset still cancels the timer.
    this.raf=needsFrame?requestAnimationFrame(this.animate):0;
  }
  nativeButton({key,word,label,x,y,width,height,testId}) {
    const button=at(element('button',null,'m86-result-button'),x,y,width,height);button.type='button';
    button.setAttribute('aria-label',label);button.title=label;button.dataset.returnLobby='true';button.dataset.testid=testId;
    button.append(this.art(key,0,0,width,height));
    const asset=word&&this.asset(word);
    if(asset)button.append(this.art(asset,(width-asset.width)/2,(height-asset.height)/2));
    else if(!this.asset(key))button.textContent=label;
    button.addEventListener('click',()=>this.returnToLobby());return button;
  }
  renderResults() {
    if(this.flow.model.soloPve)return renderPveResults(this);
    const model=this.flow.model,stage=this.stage;
    const kda=this.asset('results.kdaLabel'),elo=this.asset('results.eloLabel');
    // The unused chat occupied a third of the original settlement. Give that
    // space to the complete two-team roster instead of nesting scrollbars.
    stage.append(this.art('results.background',0,0,977,618),this.art('results.roster',14,41,494,567),
      this.art('results.kdaShade',321,43,92,562),this.art('results.playerLabel',141,22),
      this.art(elo,486-(elo?.width||0),23),this.art(kda,366.5-(kda?.width||0)/2,29-(kda?.height||0)/2));
    this.renderTeam(model.teams.own,16,82,true);this.renderTeam(model.teams.enemy,16,354,false);
    stage.append(this.art('results.cutline',16,315,490,1),
      text('Đội của bạn',26,51,245,22,'m86-result-team-heading'),
      text('Đội đối thủ',26,323,245,22,'m86-result-team-heading'));
    if(id(model.result.winCamp))stage.append(this.art('results.winStamp',254,id(model.result.winCamp)===model.selfCamp?45:317,34,34));
    this.renderReward();this.renderFeatured();
    stage.append(this.nativeButton({key:'results.exitSkin',label:'Về sảnh',x:585,y:563,width:70,height:47,testId:'postmatch-exit'}),
      this.nativeButton({key:'results.backSkin',word:'results.backWord',label:'Về sảnh',x:715,y:562,width:116,height:47,testId:'postmatch-return-lobby'}));
    const minutes=Math.floor(finite(model.result.battleTime)/60),seconds=Math.floor(finite(model.result.battleTime)%60);
    stage.append(text(`${model.outcomeText} · ${minutes}:${String(seconds).padStart(2,'0')}`,25,588,477,18,'m86-result-summary'));
  }
  renderTeam(players,x,y,own) {
    const list=at(element('div',null,'m86-result-team'),x,y,490,225);list.setAttribute('role','table');
    list.setAttribute('aria-label',own?'Đội của bạn':'Đội đối thủ');
    const rowHeight=Math.min(45,225/Math.max(1,players.length));
    for(const [index,player] of players.entries()) {
      // Normal 5v5 has 45px rows. If the server supplies an uneven team, fit all
      // authoritative rows into the same area instead of clipping any player.
      const row=at(element('div',null,`m86-result-player${player.accountId===this.flow.model.selfAccountId?' is-self':''}`),0,index*rowHeight,490,45);
      if(rowHeight<45){row.style.transform=`scaleY(${rowHeight/45})`;row.style.transformOrigin='0 0';}
      row.dataset.accountId=String(player.accountId);row.setAttribute('role','row');
      row.append(this.portrait(player.tank,5,3,38));
      const level=player.level&&this.ui?.assets?.get?.(`chrome.charLevel${player.level}`);
      if(level)row.append(this.art(level,43,12,32,16));
      else if(player.level)row.append(text(player.level,43,12,29,22,'m86-result-level'));
      const name=text(player.name,79,5,204,20,'m86-result-player-name');name.title=player.name;row.append(name);
      const awards=settlementAwards(this.flow.model.result,player.accountId);
      awards.forEach((award,i)=>row.append(this.art(`medal.${award.kind}`,79+i*20,26,18,18,award.label)));
      const tankX=79+awards.length*20;
      row.append(text(player.tankName,tankX,27,283-tankX,16,'m86-result-tank-name'),
        text(`${player.kills} / ${player.deaths} / ${player.assists}`,293,12,116,22,'m86-result-kda'),
        text(player.elo,412,5,72,24,'m86-result-elo'),this.art('results.cutline',0,44,490,1));
      if(player.eloDelta)row.append(text(`${player.eloDelta>0?'+':''}${player.eloDelta}`,412,28,72,16,`m86-result-elo-delta ${player.eloDelta<0?'negative':''}`));
      if(player.escaped){row.classList.add('is-escaped');row.title='Đã rời trận';}
      list.append(row);
    }
    this.stage.append(list);
  }
  renderReward() {
    const model=this.flow.model,reward=model.rewards,host=at(element('section',null,'m86-result-reward'),506,11,460,324);
    host.setAttribute('aria-label','Phần thưởng từ server');
    const bg=this.asset('results.rewardBackground');host.append(this.art(bg,7,(324-(bg?.height||0)*.8)/2,bg?.width,(bg?.height||0)*.8),
      this.art('results.expHeader',11,7),this.art('results.rewardShadow',17,69),this.art('results.rewardHeading',191,59));
    const character=this.client.state.meta?.character,chrome=this.ui?.assets?.chrome;
    if(character&&chrome) {
      const progress=characterProgress(character,chrome),current=this.ui.assets.get(`chrome.charLevel${progress.level}`),next=this.ui.assets.get(`chrome.charLevel${progress.level+1}`);
      if(current)host.append(this.art(current,3,15,64,32));if(next)host.append(this.art(next,395,15,64,32));
      const fill=this.asset('results.expFill'),fraction=progress.need>0?Math.max(0,Math.min(1,progress.exp/progress.need)):1;
      if(fill){
        const clip=at(element('span',null,'m86-native-exp-progress'),64,34,fill.width*Math.round(fraction*100)/100,fill.height);
        clip.style.overflow='hidden';clip.append(this.art(fill));host.append(clip);
      }
      const percent=progress.need>0?(progress.exp*100/progress.need).toFixed(2):'100.00';
      if(progress.need>=0)host.append(text(percent,145,16,48,25,'m86-result-exp-rate'),text('%',188,16,16,25,'m86-result-exp-divider'));
      const currentExp=text(progress.need<0?'MAX':progress.exp,201,17,49,24,'m86-result-exp-number current');
      const nextExp=text(progress.need<0?'MAX':progress.need,257,17,49,24,'m86-result-exp-number next');
      for(const number of [currentExp,nextExp]) {
        number.title=number.textContent;
        // Keep the native49px field; long server values stay fully legible.
        number.style.fontSize=`${Math.min(12,49/(Math.max(1,number.textContent.length)*.62))}px`;
      }
      host.append(currentExp,nextExp,text('/',242,16,16,25,'m86-result-exp-divider'));
    }
    const items=at(element('div',null,'m86-reward-items'),12,89,438,82);
    const pages=Math.max(1,Math.ceil(reward.items.length/5));let page=0;
    let pager=null,previous=null,next=null;
    const renderItems=()=>{
      items.replaceChildren();items.dataset.page=String(page+1);
      // Native settlement shows five empty original boxes for an empty vector.
      // Additional server rewards use pages; every item remains accessible.
      for(let index=0;index<5;index++) {
        const item=reward.items[page*5+index],slot=at(element('div',null,'m86-reward-item'),index*87.6,0,87.6,82);
        const box=this.asset('results.itemBox'),boxWidth=78,boxHeight=boxWidth*(box?.height||87)/(box?.width||94);
        slot.append(this.art(box,(87.6-boxWidth)/2,5,boxWidth,boxHeight));
        if(item) {
          const def=this.ui?.assets?.garage?.items?.[String(item.templateId)]||{},icon=this.ui?.assets?.get?.(def.icon);
          if(icon)slot.append(this.art(icon,11.8,8,64,64,nativeText(def.name||`Vật phẩm ${item.templateId}`)));
          else slot.append(text(nativeText(def.name||`#${item.templateId}`),6,20,76,38,'m86-reward-item-label'));
          slot.append(text(`×${item.count}`,8,57,67,20,'m86-reward-item-count'));
          slot.title=`${nativeText(def.name||`Vật phẩm ${item.templateId}`)} ×${item.count}`;slot.dataset.templateId=String(item.templateId);
        }
        items.append(slot);
      }
      if(pager){pager.textContent=`${page+1}/${pages}`;previous.disabled=page===0;next.disabled=page===pages-1;}
    };
    if(pages>1) {
      previous=at(element('button','‹','m86-reward-page'),337,57,25,25);
      next=at(element('button','›','m86-reward-page'),420,57,25,25);
      pager=text('',363,61,54,20,'m86-reward-page-number');pager.setAttribute('aria-live','polite');
      for(const [button,label,step] of [[previous,'Trang vật phẩm trước',-1],[next,'Trang vật phẩm sau',1]]) {
        button.type='button';button.setAttribute('aria-label',label);
        button.addEventListener('click',()=>{page=Math.max(0,Math.min(pages-1,page+step));renderItems();});
      }
      host.append(previous,pager,next);
    }
    renderItems();host.append(items);
    for(const [kind,labelKey,y,total,segments] of [
      ['coins','results.coinLabel',190,reward.coins,reward.coinSegments],
      ['exp','results.expLabel',243,reward.exp,reward.expSegments],
    ]) {
      const label=this.asset(labelKey);host.append(this.art(label,38,y-(label?.height||0)/2),text(total,343,y-9,100,25,'m86-reward-total'));
      const progress=at(element('div',null,'m86-reward-progress'),29,y+11,416,30);progress.dataset.reward=kind;
      let left=3;
      for(const segment of segments) {
        const width=410*segment.fraction;
        progress.append(this.art(`results.progress.${segment.color}`,left,3,width,24),
          text(`${segment.label?segment.label+' ':''}+${segment.value}`,left,3,width,24,'m86-reward-segment'));
        left+=width;
      }
      progress.append(this.art('results.progressBackground',0,0,416,30));host.append(progress);
    }
    const merit=this.asset('results.meritLabel');host.append(this.art(merit,38,300-(merit?.height||0)/2),text(reward.teamMerit,343,290,100,25,'m86-reward-total'));
    this.stage.append(host);
  }
  renderFeatured() {
    const model=this.flow.model,player=model.featured,host=at(element('section',null,'m86-result-featured'),507,330,460,216);
    const background=this.asset('results.featureBackground');
    host.append(this.art(background,(460-(background?.width||448))/2,(216-(background?.height||209))/2));
    if(player) {
      host.append(this.portrait(player.tank,31,14,200),text(player.tankName,31,30,200,42,'m86-feature-tank-name'),
        text(player.name,253,95,192,34,'m86-feature-player-name'));
      const awards=settlementAwards(model.result,player.accountId).filter(award=>award.kind!=='destroyer');
      awards.forEach((award,index)=>{
        const x=250+index*67,bg=this.asset('featured.labelBackground'),word=this.asset(`featured.word.${award.kind}`),medal=this.asset(`featured.medal.${award.kind}`);
        host.append(this.art(bg,x+(67-(bg?.width||0))/2,67),this.art(word,x+(67-(word?.width||0))/2,69),
          this.art(medal,x+34.5-(medal?.width||0)/2,23,null,null,award.label));
      });
    }else host.append(text('Không có danh hiệu trong trận này',230,88,215,54,'m86-feature-empty'));
    this.stage.append(host);
  }
  async returnToLobby() {
    this.releaseInput();const generation=this.client.generation,pve=!!this.flow.model?.soloPve;
    return this.flow.returnToLobby(async()=>{
      await this.client.closeResult();
      if(generation===this.client.generation&&this.client.state.phase==='ready'&&this.client.state.play.phase==='lobby'){
        if(pve){
          // app.js batches state rendering by 80 ms. Apply the ACKed snapshot
          // before navigate(), otherwise its old scene state rejects PvE and
          // the later batch shows only the lobby. No optimistic state change.
          if(this.ui?.update&&this.client.snapshot)this.ui.update(this.client.snapshot());
          await this.ui?.navigate('pve');
        }else await this.client.refreshHall();
      }
    });
  }
  reset(){this.flow.reset();}
  snapshot(){return {...this.flow.snapshot(),catalogLoaded:!!this.catalog,nativeTimeline:true};}
}
