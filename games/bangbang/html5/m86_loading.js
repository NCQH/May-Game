/* Native NewBattlePlayerLoadingFrame / PlayerLoadingProxy presentation.
 * Layout and artwork come from the original preload module. No fake readiness,
 * equipment, rank, reward, bot progress or additional loading delay is created.
 */
import {LOADING_CAMP_POSITIONS} from './m81_flow_layout.js';
import {element,assetImage,actionButton,setText,nativeText} from './m8_ui_helpers.js';
import {isPveMap} from './m81314_protocol.js';
import {RESULT_ART} from './m81316_result_art.js';
import {isWorldBossScene,WORLD_BOSS_MAP} from './m81330_protocol.js';

const at=(node,x,y,w,h)=>{Object.assign(node.style,{position:'absolute',left:`${x}px`,top:`${y}px`});
  if(w!=null)node.style.width=`${w}px`;if(h!=null)node.style.height=`${h}px`;return node;};
const finite=value=>typeof value==='number'&&Number.isFinite(value);

export function loadingProgress(flow,accountId) {
  const native=flow?.nativeLoads?.[accountId];
  // S1709/NotifyLoadedRate is the displayed authority for every player,
  // including self. Local verified reads only describe the text below the map.
  if(!native||!finite(native.loaded)||native.loaded<0||native.loaded>100)return {loaded:null,delay:null};
  return {loaded:native.loaded,delay:finite(native.delay)&&native.delay>=0?native.delay:null};
}

export function loadingCardModel(character,selfCamp,catalog={},ranks={},guildSkills=[]) {
  const sameCamp=character.camp===selfCamp;
  const section=sameCamp&&character.preEloSection>0?ranks.sections?.[character.preEloSection]:null;
  const thresholds=Object.keys(catalog.military||{}).map(Number).filter(Number.isFinite).sort((a,b)=>b-a);
  const militaryThreshold=sameCamp?thresholds.find(stars=>stars<=(character.militaryStar??0)):null;
  const command=character.commandSkill>>>0;
  const skill=guildSkills.find(row=>row.nGuildSkillId===(command>>>4)&&row.nLevel===(command&15))
    ||guildSkills.find(row=>row.nSkillTpltPvpId===command)||null;
  return {
    // Character level is unrelated to the equipped tank's appearance or halo.
    tank:{...character,level:character.tankLevel||1},
    decorationKey:catalog.decorations?.[character.decorateId]||null,
    borderKey:section?ranks.sectionBorders?.[section.type]||null:null,
    military:militaryThreshold==null?null:catalog.military[militaryThreshold],
    vipKey:catalog.vip?.[character.vipLevel]||null,
    honor:catalog.honors?.[character.honorId]||null,
    guildKey:catalog.guildRanks?.[character.teamPlace]||null,
    skill,
  };
}

export function loadingNameColors(vipLevel) {
  if(!vipLevel)return null;
  const level=vipLevel%100;
  return level<3?[15990034,4495616]:level<6?[16762622,11141375]:[16777028,16720384];
}

/** BattleLoadingView.initPve uses MapTemplate.szBossImage, not the first NPC
 * spawned or a random tank. An unavailable original image stays unavailable;
 * the chapter's original sign is a labelled fallback, never another boss. */
export function pveLoadingModel(flow,catalog={}) {
  if(Number(flow?.roomType)!==4||!isPveMap(flow?.mapId))return null;
  const map=catalog.maps?.[String(flow.mapId)];if(!map)return null;
  const resolve=value=>typeof value==='string'?catalog.assets?.[value]:value?.assetRef?catalog.assets?.[value.assetRef]:value;
  const source=String(map.raw?.szBossImage||'');
  const boss=source&&(resolve(catalog.assets?.[`zh_CN/map/${source}`])
    ||(source==='stage116_boss.png'?RESULT_ART.boss201:null));
  const chapter=resolve(catalog.ui?.chapters?.[String(map.cityId)]);
  const usable=asset=>!!asset?.url&&/\.(png|jpe?g|webp)(?:[?#]|$)/i.test(asset.url);
  return {mapId:Number(flow.mapId),name:nativeText(map.name)||`Màn ${flow.mapId}`,
    asset:usable(boss)?boss:usable(chapter)?chapter:null,
    kind:usable(boss)?'boss':'chapter',source};
}

/** One enemy portrait for finite solo PvE or the released World Boss room.
 * Reuse the donor MapTemplate.szBossImage binding already verified by M30;
 * never substitute the arena/minimap or manufacture a player/bot for it. */
export function battleLoadingEnemyModel(flow,assets={}) {
  const pve=pveLoadingModel(flow,assets.pve);
  if(pve)return {...pve,mode:'pve',title:pve.name,
    description:'Phụ bản đơn · Thưởng được xác nhận khi kết trận'};
  if(!isWorldBossScene(flow))return null;
  const catalog=assets.worldBoss,map=catalog?.maps?.[String(WORLD_BOSS_MAP)];
  if(!map)return null;
  const logical=map.bossImage?.assetRef||map.bossImage?.logical;
  const source=String(map.raw?.szBossImage||'');
  const boss=logical?catalog.assets?.[logical]||map.bossImage:map.bossImage;
  const usable=!!boss?.url&&/\.(png|jpe?g|webp)(?:[?#]|$)/i.test(boss.url)
    &&(!source||logical===`zh_CN/map/${source}`);
  return {mapId:WORLD_BOSS_MAP,name:'Kẻ Hủy Diệt',mode:'worldboss',kind:'boss',source,
    title:nativeText(assets.loadingPresentation?.maps?.[WORLD_BOSS_MAP]?.name)||'Cứ địa Lunar · Boss Thế Giới',
    asset:usable?boss:null,description:'Boss Thế Giới · Cùng đánh vào HP chung toàn máy chủ'};
}

export function preloadLoadingRoster(assets,state) {
  const roster=state.flow?.roster||[],selfCamp=roster.find(c=>c.accountId===state.accountId)?.camp;
  const keys=[];
  for(const c of roster){
    const model=loadingCardModel(c,selfCamp,assets.loadingPresentation,assets.flowPresentation,assets.account?.guildSkills);
    keys.push(model.decorationKey,model.borderKey,model.military?.key,model.vipKey,model.honor?.key,model.guildKey,model.skill?.icon);
  }
  const enemy=battleLoadingEnemyModel(state.flow,assets);if(enemy?.asset)keys.push(enemy.asset);
  return assets.preloadImages(keys);
}

export class M86LoadingView {
  constructor(ui) {
    this.ui=ui;this.assets=ui.assets;this.bars=new Map();this.cleanups=[];this.cardCleanups=[];
    this.root=at(element('section',null,'m86-loading'),0,0,1000,618);
    this.root.setAttribute('aria-label','Đang tải trận');ui.content.append(this.root);
    this.root.append(this.art('loading.background',-300,-74.5),this.art('loading.shadow',-300,-174.5));
    const vs=this.assets.get('loading.versus');
    this.root.append(this.art('loading.versus',(1000-vs.width)/2,(618-vs.height)/2));
    this.roster=element('div',null,'m86-loading-roster');this.root.append(this.roster);
    this.enemy=at(element('section',null,'m86-loading-pve-enemy'),610,185,330,295);
    this.enemy.hidden=true;this.enemy.setAttribute('aria-label','Đối thủ PvE');this.root.append(this.enemy);
    this.map=at(element('img',null,'m81-loading-map'),432,13.5,136,136);this.map.alt='Bản đồ';
    this.title=at(element('span',null,'m86-loading-map-title'),370,152.5,260,22);
    this.status=at(element('div',null,'m86-loading-status'),385,411,230,58);this.status.setAttribute('role','status');
    this.exit=at(actionButton('Về sảnh',()=>ui.run(()=>ui.client.leaveRoom()),{className:'m86-loading-exit',testId:'m8-leave-loading'}),454,527,92,27);
    this.exit.title='Rời trận đang tải và về sảnh';
    this.root.append(this.map,this.title,this.status,this.exit);
    this.chat=at(element('div',null,'m86-loading-chat'),272,579,456,38);
    this.chat.setAttribute('aria-label','Chat phe ta chưa khả dụng');this.chat.title='Chat trong trận chưa được kết nối';
    for(const [key,x,w] of [['flow.chatbghead',0,110],['flow.chatbgmid',110,322],['flow.chatbgtail',432,24]]) {
      const a=this.assets.get(key);if(a)this.chat.append(this.art(key,x,0,w,38));
    }
    const channel=at(element('span','Phe ta','m86-loading-chat-channel'),8,6,85,22);
    const input=at(element('input',null,'m86-loading-chat-input'),112,8,274,20);
    input.placeholder='Chat chưa khả dụng';input.disabled=true;input.setAttribute('aria-label','Chat chưa khả dụng');
    const send=this.assets.get('flow.chat_enter');if(send)this.chat.append(at(assetImage(send),385,11,25,16));
    this.chat.append(channel,input);this.root.append(this.chat);
  }
  art(key,x,y,w,h,card=false) {
    const a=this.assets.get(key);
    const node=this.assets.menuArt(a,'','m8-art',{nativePriority:20});
    (card?this.cardCleanups:this.cleanups).push(()=>node.dispose?node.dispose():this.assets.menuAnimations.release(node));
    return at(node,x,y,w??a?.width,h??a?.height);
  }
  centered(key,cx,cy,scale=1,card=true) {
    const a=key&&this.assets.get(key);if(!a)return null;
    return this.art(key,Math.round(cx-a.width*scale/2),Math.round(cy-a.height*scale/2),a.width*scale,a.height*scale,card);
  }
  renderRoster(state) {
    for(const cleanup of this.cardCleanups)cleanup();this.cardCleanups=[];this.bars.clear();this.roster.replaceChildren();
    const selfCamp=state.flow.roster.find(row=>row.accountId===state.accountId)?.camp;
    const catalog=this.assets.loadingPresentation||{},ranks=this.assets.flowPresentation||{};
    for(const camp of [1,2])for(const [i,c] of state.flow.roster.filter(c=>c.camp===camp).slice(0,5).entries()) {
      const solo=battleLoadingEnemyModel(state.flow,this.assets);
      const [x,y]=solo&&camp===selfCamp&&i===0?[125,205]:LOADING_CAMP_POSITIONS[camp][i],model=loadingCardModel(c,selfCamp,catalog,ranks,this.assets.account.guildSkills);
      const card=at(element('article',null,'m8-loading-player m86-loading-player'),x,y,235,190);
      card.dataset.accountId=String(c.accountId);card.dataset.camp=String(camp);card.dataset.self=String(c.accountId===state.accountId);
      const border=this.centered(model.borderKey,117.5,95);if(border)card.append(border);
      if(c.accountId===state.accountId)card.append(this.art('loading.selfHexagon',-3,-3,null,null,true));
      card.append(this.art('loading.hexagon',0,0,null,null,true));
      const decoration=this.centered(model.decorationKey,117.5,95);if(decoration){decoration.dataset.loadingDecoration=String(c.decorateId);card.append(decoration);}
      const tank=this.assets.portraitForTank(model.tank,{size:160,preferNative:true});
      card.append(at(tank,38,4,160,160));this.cardCleanups.push(()=>tank.dispose?.());
      card.append(this.art('loading.progressTrack',51.5,166,null,null,true));
      const progress=at(element('div',null,'m81-loading-progress'),52.5,167,0,14);
      progress.setAttribute('role','progressbar');progress.setAttribute('aria-label','Tiến độ tải của '+c.name);
      progress.setAttribute('aria-valuemin','0');progress.setAttribute('aria-valuemax','100');
      progress.append(this.art('loading.progress',0,0,130,14,true));progress.style.overflow='hidden';
      const label=at(element('span','…','m8-load-percent'),51.5,164,132,23);card.append(progress,label);
      if(c.teamName) {
        const guild=at(element('div',null,'m86-loading-guild'),30,0,175,28);
        const guildName=element('span',c.teamName);guildName.title=c.teamName;
        const badge=this.assets.get(model.guildKey);if(badge)guild.append(assetImage(badge));
        guild.append(guildName);card.append(guild);
      }
      const name=at(element('span',c.name,'m86-loading-name'),78,143,145,22);name.title=c.name||'';
      const colors=loadingNameColors(c.vipLevel);
      if(colors){name.classList.add('m86-loading-vip-name');name.style.backgroundImage=`linear-gradient(#${colors[0].toString(16).padStart(6,'0')},#${colors[1].toString(16).padStart(6,'0')})`;name.style.paddingRight='20px';}
      card.append(name);
      const vip=this.assets.get(model.vipKey);if(vip)card.append(this.art(model.vipKey,43,143+(22-vip.height*36/vip.width)/2,36,vip.height*36/vip.width,true));
      const honor=this.centered(model.honor?.key,35.5,66);if(honor){honor.title=model.honor.name||'';card.append(honor);}
      const rank=this.centered(model.military?.key,52.5,37,.4);if(rank){rank.title=model.military.name||'';card.append(rank);}
      if(model.skill?.icon){const skill=at(assetImage(model.skill.icon),195,80,30,30);skill.title=nativeText(model.skill.name);card.append(skill);}
      const ping=c.accountId===state.accountId?at(element('span',null,'m86-loading-ping'),158,127,51,22):null;
      if(ping)card.append(ping);
      this.bars.set(c.accountId,{progress,label,ping});this.roster.append(card);
    }
  }
  update(state) {
    const flow=state.flow,pve=battleLoadingEnemyModel(flow,this.assets),signature=JSON.stringify([state.accountId,flow.roster,flow.roomType,flow.mapId]);
    if(signature!==this.signature){this.signature=signature;this.renderRoster(state);}
    const enemySignature=pve?`${pve.mode}:${pve.mapId}:${pve.asset?.url||''}`:'';
    if(enemySignature!==this.enemySignature){
      this.enemySignature=enemySignature;this.enemy.replaceChildren();this.enemy.hidden=!pve;
      this.root.classList.toggle('m86-loading-pve',!!pve);this.chat.hidden=!!pve;
      this.root.classList.toggle('m86-loading-worldboss',pve?.mode==='worldboss');
      this.enemy.setAttribute('aria-label',pve?.mode==='worldboss'?'Đối thủ Boss Thế Giới':'Đối thủ PvE');
      if(pve){
        this.enemy.dataset.artKind=pve.kind;this.enemy.dataset.mapId=String(pve.mapId);
        if(pve.asset){
          const art=assetImage(pve.asset,pve.kind==='boss'?`Đối thủ: ${pve.name}`:`Biểu tượng chương: ${pve.name}`,'m86-loading-boss');
          this.enemy.append(art);
        }
        const caption=element('div',null,'m86-loading-enemy-caption');
        caption.append(element('strong',pve.name),element('span',pve.description));
        this.enemy.append(caption);
      }
    }
    for(const [id,row] of this.bars) {
      const value=loadingProgress(flow,id);row.progress.style.width=`${130*(value.loaded??0)/100}px`;
      if(value.loaded==null){row.progress.removeAttribute('aria-valuenow');setText(row.label,'…');}
      else {row.progress.setAttribute('aria-valuenow',String(value.loaded));setText(row.label,`${value.loaded}%`);}
      if(row.ping)setText(row.ping,value.delay==null?'':`${value.delay}ms`);
    }
    const map=this.assets.loadingPresentation?.maps?.[flow.mapId];
    const mapAsset=this.assets.get(map?.miniKey||(flow.mapId===19?'loading.map19Mini':''));
    if(mapAsset&&this.map.getAttribute('src')!==mapAsset.url)this.map.src=mapAsset.url;
    this.map.hidden=!mapAsset;setText(this.title,pve?.title||map?.name||(flow.mapId===19?'Robo':`Bản đồ ${flow.mapId??''}`));
    const load=flow.localLoad;
    const stage={catalog:'Đang đọc dữ liệu trận…',assets:'Đang tải hình ảnh và âm thanh…',interface:'Đang chuẩn bị trận…',graphics:'Đang chuẩn bị hiệu ứng…',
      'waiting-server':'Đang chờ người chơi…',ready:'Sẵn sàng vào trận',error:'Không tải được trận'}[load?.stage]||'Đang chuẩn bị trận…';
    setText(this.status,load?.error?stage+'\n'+load.error:stage);
    this.status.classList.toggle('m86-loading-error',!!load?.error);
    this.status.title=load?.completed!=null?`${load.completed} / ${load.total} tài nguyên đã tải và kiểm tra`:'';
    this.exit.disabled=!!state.play.busy;
  }
  snapshot(){return {players:this.bars.size,nativeProgress:Object.fromEntries([...this.bars].map(([id,r])=>[id,r.progress.getAttribute('aria-valuenow')]))};}
  dispose(){for(const cleanup of [...this.cardCleanups,...this.cleanups])cleanup();this.cardCleanups=[];this.cleanups=[];this.bars.clear();this.root.remove();}
}
