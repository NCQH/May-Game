import {element,nativeText,note} from './m8_ui_helpers.js';
import {createNativePanel} from './m81_native_panel.js';
import {openPublicGuild,openPublicTeam} from './m82_leaderboard.js';
import {at,panelArt,panelAsset,nativeLabel,nativeButton,createCharacterAppearance} from './m84_character.js';
import {PANEL_ART} from './m81316_panel_art.js';
import {companionTooltipData,createCompanionTooltip,M81317TooltipLayer} from './m81317_companion_tooltip.js';

const P='zh_CN/gui_summer/controls/';
export const PROFILE_NATIVE_GEOMETRY=Object.freeze({size:[828,568],avatar:[20,48,214,306],history:[237,80,570],honors:[234,173,570,90],report:[237,260,570,270],list:[4,22,241,228],row:[220,76],main:[246,15,324,250]});
export function profileVisibleRange(scrollTop,count){const start=Math.max(0,Math.min(Math.floor(Math.max(0,scrollTop)/76),Math.max(0,count-3)));return [start,Math.min(count,start+4)];}
export function publicProfileAppearance(data,character={}){
  const own=!!character.charUuid&&String(data.char_uuid)===String(character.charUuid),self=own?character:{};
  // The public query may predate a C153 equip acknowledgement. For self, the
  // current native S1023/S85 selection takes precedence over that cached query.
  // Other players retain only their public appearance; ID 0 is not an outfit.
  return {...self,name:data.char_name,level:data.char_level,
    avatarId:own&&Object.hasOwn(self,'avatarId')?self.avatarId:data.char_avatar,
    decorateId:own&&Object.hasOwn(self,'decorateId')?self.decorateId:data.char_decorate,
    vipTime:own?self.vipTime:data.char_vip_time,superVipTime:own?self.superVipTime:data.char_super_vip_time,
    vipPoints:own?self.vipPoints:data.char_vippoint};
}
export function publicProfileCompanion(data,snapshot={}){
  const own=!!snapshot.meta?.character?.charUuid
    &&String(data?.char_uuid)===String(snapshot.meta.character.charUuid);
  if(own&&Number(snapshot.companions?.revision)>0){
    // S1056 is authoritative after equip/unequip. An empty acknowledged slot
    // must not resurrect a pet from an older observechar.php response.
    const active=snapshot.companions.activeUuid;
    const items=snapshot.meta?.containers?.['5']?.items;
    const matches=(Array.isArray(items)?items:[])
      .filter(item=>active&&item&&typeof item==='object'&&item.uuid===active&&item.count===1);
    return matches.length===1?{...matches[0]}:null;
  }
  const source=data?.booster;
  if(!source||typeof source!=='object')return null;
  const fields={templateId:'booster_tid',rank:'booster_r',rankCost:'booster_rcost',
    level:'booster_l',upgradeLevel:'booster_ul',upgradeCost:'booster_ulcost'};
  if(Object.values(fields).some(key=>!Number.isSafeInteger(source[key])||source[key]<0)
    ||!source.booster_tid)return null;
  // Presentation identity only. Public WatchHelperInfo has no private UUID,
  // slot number, EXP or lifetime; never invent or send an inventory operation.
  return {uuid:`public-companion:${data.char_uuid}`,count:1,
    ...Object.fromEntries(Object.entries(fields).map(([key,field])=>[key,source[field]]))};
}
function profileCompanionBadge(ui){
  const item=publicProfileCompanion(ui.cache.profile,ui.snapshot);
  let data;
  try{data=companionTooltipData({catalog:ui.assets.pve,assets:ui.assets,item,activeUuid:item?.uuid});}
  catch{return null;}
  if(!data?.icon)return null;
  // PlayerInfoFrame.helperBox: (243,50), HelperBoxFrameState.MIN (68x68).
  const badge=at(element('button',null,'m84-art-hit m81317-profile-companion'),243,50,68,68);
  badge.type='button';badge.dataset.testid='profile-companion';badge.dataset.templateId=String(data.templateId);
  badge.dataset.nativeFrame='HelperBoxFrame.MIN';
  badge.setAttribute('aria-label',`Trợ thủ chủ chiến: ${data.name}, LV.${data.level}, sao ${data.rank}/${data.rankCap}`);
  badge.append(panelArt(ui,PANEL_ART['helper.box_60'],0,0,68,68),
    panelArt(ui,PANEL_ART['helper.box_totem_60'],9,8,49,51),
    panelArt(ui,data.icon,5,5,58,58),
    nativeLabel(String(data.aptitude),4,1,26,18,{size:14,color:'#ffdf25'}),
    panelArt(ui,PANEL_ART['personpve.star'],5,49,15,15),
    nativeLabel(`${data.rank}/${data.rankCap}`,20,49,40,16,{size:12,color:'#ffdf25'}));
  const progress=at(element('span',null,'m81317-profile-companion-progress'),58,10,5,42);
  progress.setAttribute('aria-hidden','true');
  const fill=element('span');fill.style.height=`${data.strengthCap>0?Math.min(100,data.strength/data.strengthCap*100):0}%`;
  progress.append(fill);badge.append(progress);
  if(!ui.profileCompanionTooltip){
    ui.profileCompanionTooltip=new M81317TooltipLayer({host:ui.host,
      scaleRoot:ui.host.closest?.('.m83-stage')||ui.host,
      isCurrent:()=>!ui.disposed&&ui.section==='profile'&&!ui.confirmation
        &&ui.connectionGeneration===ui.client.generation});
  }
  ui.profileCompanionTooltip.bind(badge,()=>createCompanionTooltip({data}));
  return badge;
}
function number(value){return String(Math.max(0,Math.trunc(Number(value)||0)));}
function valueBox(ui,value,x,y,{width=82,size=13,align='right',padding=8}={}){
  const host=at(element('span',null,'m84-native-value'),x,y,width,27);
  host.append(panelArt(ui,P+`public/label${width}x27.png`,0,0,width,27));
  const text=element('span',String(value??''));Object.assign(text.style,{fontSize:`${size}px`,textAlign:align,left:`${padding}px`,right:`${padding}px`});host.append(text);return host;
}
function rankName(ui,tank){
  const skin=ui.assets.garage?.skins?.find(row=>row.tankId===tank.tankId&&row.externalId===tank.externalId);
  return nativeText(ui.assets.garage?.items?.[String(skin?.itemId)]?.name||ui.assets.tankName(tank.tankId));
}
function levelArt(ui,level,x,y){const asset=ui.assets.get?.(`chrome.tankLevel${Math.max(1,Math.min(11,Number(level)||1))}`);if(!asset)return null;const art=panelArt(ui,asset,x,y);art.classList.add('m8133-profile-tank-level');return art;}

export function renderNativePublicProfile(ui,body,tankRows){
  body.classList.add('m84-public-profile');body.dataset.nativeFrame='PlayerInfoFrame';
  const data=ui.cache.profile,native=ui.assets.accountPresentation?.nativeText||{};
  body.append(panelArt(ui,P+'player/word_char_id_t.png',236,56));
  const query=at(ui.button(data?.state===1?String(data.char_oid??''):'',()=>{ui.profileQueryOpen=!ui.profileQueryOpen;ui.render();},{testId:'profile-query-toggle',title:'Tra cứu ID hoặc UUID nhân vật',className:'m84-id-query m84-art-hit'}),305,57,170,27);
  query.setAttribute('aria-label','Tra cứu ID hoặc UUID nhân vật');query.setAttribute('aria-expanded',String(!!ui.profileQueryOpen));body.append(query);
  if(ui.profileQueryOpen){
    const toolbar=element('div',null,'m84-profile-query');toolbar.setAttribute('role','search');
    const identity=ui.input('profileIdentity',ui.profileIdentity||ui.identity,{placeholder:'ID hoặc UUID nhân vật',maxLength:200});identity.setAttribute('aria-label','ID hoặc UUID nhân vật');
    toolbar.append(identity,ui.button('Xem hồ sơ',()=>{ui.profileIdentity=identity.value.trim()||ui.identity;delete ui.cache.profile;ui.profileQueryOpen=false;ui.loadSection();},{testId:'profile-inspect'}),
      ui.button('Hồ sơ của tôi',()=>{ui.profileIdentity=ui.identity;ui.fields.profileIdentity=ui.identity;delete ui.cache.profile;ui.profileQueryOpen=false;ui.loadSection();},{testId:'profile-self'}),
      ui.button('Đóng',()=>{ui.profileQueryOpen=false;ui.afterRenderFocus='profile-query-toggle';ui.render();},{testId:'profile-query-close'}));
    toolbar.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();event.preventDefault();ui.profileQueryOpen=false;ui.afterRenderFocus='profile-query-toggle';ui.render();}});body.append(toolbar);
  }
  if(ui.loading.has('profile')){body.append(at(note('Đang tải hồ sơ…'),245,80));return;}
  if(data?.queryError||data?.state!==1){body.append(at(note(data?.queryError||data?.msg||'Chưa có dữ liệu hồ sơ.'),245,80));return;}
  const own=!!ui.snapshot.meta?.character?.charUuid&&String(data.char_uuid)===String(ui.snapshot.meta.character.charUuid);
  const appearance=publicProfileAppearance(data,ui.snapshot.meta?.character);
  body.append(at(createCharacterAppearance(ui,appearance,{mode:'profile',onChooseAvatar:own?()=>ui.openCosmeticBag(4):null}),20,48,214,306));
  for(const [word,y,value] of [['glamour',353,data.char_charm],['romantic',386,data.char_romantic]])body.append(panelArt(ui,P+'item/icon_text.png',20,y+7),panelArt(ui,P+`player/${word}_t.png`,34,y+5),valueBox(ui,number(value),82,y));
  for(const [kind,label,y] of [['guild','Legion',425],['team','Clan',467]]){
    body.append(panelArt(ui,P+`clan/w3_${label}_t.png`,21,y+4),valueBox(ui,data[`${kind}_name`]??native.CONTROL_TEXT32??'',58,y,{width:152,align:'left'}),
      nativeLabel(`${native.CONTROL_TEXT8||'LV.'}${number(data[`${kind}_level`])}`,kind==='guild'?90:88,y+3,106,23,{size:13,align:'right'}));
    const id=Number(data[`${kind}_id`]);
    if(id>0)body.append(nativeButton(ui,{skin:P+'clan/button_view.png',label:kind==='guild'?'Xem Guild':'Xem đội',x:210,y:y+3,width:22,height:22,
      testId:`profile-watch-${kind}`,onClick:()=>kind==='guild'?openPublicGuild(ui,id):openPublicTeam(ui,id)}));
  }
  body.append(nativeLabel(native.profileRefreshHint||'',21,499,216,27,{size:12,color:'#016597'}));
  const kind=['total','pvp','league','ladderpvp'].includes(ui.profileTab)?ui.profileTab:'total';
  body.append(panelArt(ui,P+'public/option_bk_320.png',483,49,322,36));
  for(const [key,label,word,x] of [['total','Tổng thành tích','TotalGrade',486.5],['pvp','So tài','RandomGame',563.5],['ladderpvp','Xếp hạng','LadderGame',640.5],['league','Giải Guild','ClanGame',716.5]]){
    const selected=kind===key,button=at(ui.button('',()=>{ui.profileTab=key;ui.render();},{testId:'profile-tab-'+key,title:label,className:'m84-art-hit m84-profile-tab'}),x,54,85,26);
    button.setAttribute('aria-label',label);button.setAttribute('aria-pressed',String(selected));
    if(selected)button.append(panelArt(ui,P+'public/option_seleted_bk.png',0,0,85,26));
    const icon=panelAsset(ui,P+`player/word_${word}${selected&&['TotalGrade','ClanGame'].includes(word)?'_selected':''}_t.png`);
    if(icon)button.append(panelArt(ui,icon,(85-icon.width)/2,(26-icon.height)/2));body.append(button);
  }
  const history=at(element('section',null,'m84-profile-history'),237,80,570,90),stats=data.char_tech?.[kind]||{};
  history.append(panelArt(ui,P+'player/word_HistoryReport_t.png'));
  for(const [x,y] of [[2,25],[142,25],[285,25]])history.append(panelArt(ui,P+'item/icon_text.png',x,y));
  history.append(panelArt(ui,P+'player/word_section_t.png',18,22),panelArt(ui,P+'player/word_WinStage_t.png',161,24),panelArt(ui,P+'player/word_Escape_t.png',307,25));
  const section=Number(data.elo_section_id)>0?String(data.elo_section_id):(native.LAADER_SECTION_TEXT4||'');
  history.append(valueBox(ui,section,51,21),valueBox(ui,number(stats.winmatchs),194,21),valueBox(ui,`${number(stats.escapeprecent)}%`,340,21));
  for(const [key,icon,x,iconX] of [['killerkingmatchs','kill',51,19],['assistkingmatchs','assist',194,163],['kda_count','allRound',340,307],['destroyer_count','demolish',479,448]])history.append(panelArt(ui,P+`technique/${icon}.png`,iconX,48,28,28),valueBox(ui,number(stats[key]),x,49));
  body.append(history,panelArt(ui,P+'player/word_honour_t.png',242,154));
  const honors=createNativePanel({assets:ui.assets.panels.assets,kind:'box3',state:'LIGHT_BG',width:570,height:90});body.append(at(honors.root,234,173));
  const report=at(element('section',null,'m84-profile-tank-report'),237,260,570,270),tanks=tankRows(data),selected=tanks.find(row=>row.tankId===ui.profileTankId)||tanks[0];
  report.append(panelArt(ui,P+'player/word_TankReport_t.png'),nativeLabel((native.CONTROL_TEXT399||'@num1@').replace('@num1@',String(tanks.length)),79,0,400,23,{size:14,color:'#ffea00'}));
  const listFrame=createNativePanel({assets:ui.assets.panels.assets,kind:'box4',width:249,height:236});report.append(at(listFrame.root,0,18),panelArt(ui,P+'rank/row_dark_bk.png',4,98,241,76));
  const list=at(element('div',null,'m81-profile-tank-list m84-profile-tank-list'),4,22,241,228);list.setAttribute('aria-label','Tank của nhân vật');
  const spacer=element('div',null,'m84-profile-tank-spacer');spacer.style.height=`${tanks.length*76}px`;list.append(spacer);
  const live=new Map();let previous='';
  const paint=()=>{
    const [start,end]=profileVisibleRange(list.scrollTop,tanks.length),range=`${start}:${end}`;
    if(range===previous)return;previous=range;
    for(const [index,node] of live)if(index<start||index>=end){node.remove();live.delete(index);}
    for(let index=start;index<end;index++){
      if(live.has(index))continue;const tank=tanks[index],name=rankName(ui,tank);
      const row=at(ui.button('',()=>{ui.profileTankId=tank.tankId;ui.render();},{testId:`profile-tank-${tank.tankId}`,title:name,className:'m84-profile-tank-row m84-art-hit'}),0,index*76,220,76);
      row.setAttribute('aria-label',name);row.setAttribute('aria-pressed',String(tank===selected));
      if(tank===selected)row.append(panelArt(ui,P+'player/img_tank_selected_bg.png'));
      row.append(nativeLabel(name,132,6,78,23,{size:14,color:'#00ffff',className:'m84-profile-tank-name'}));
      const level=levelArt(ui,tank.level,82,7);if(level)row.append(level);
      row.append(nativeLabel((native.TIP_398||'@num1@').replace('@num1@',number(tank.source.fightScore)),80,31,140,20,{size:12}),
        nativeLabel((native.TIP_397||'@num1@').replace('@num1@',number(tank.source.winmatchs)),80,50,140,20,{size:12}));
      if([1,2].includes(Number(tank.source.skin_frame_type)))row.append(panelArt(ui,`zh_CN/skinframe/tankinfo/${Number(tank.source.skin_frame_type)===1?'purple':'orange'}.png`,1,3));
      row.append(at(ui.assets.portraitForTank(tank,{size:60,animate:true,haloBehindBody:true}),8,8,60,60));spacer.append(row);live.set(index,row);
    }
  };
  list.addEventListener('scroll',paint,{passive:true});paint();report.append(list);
  if(selected){
    const detail=at(element('section',null,'m84-profile-tank-detail'),246,15,324,250);
    detail.append(at(ui.assets.portraitForTank(selected,{size:200,animate:true,haloBehindBody:true}),0,0,200,200),nativeLabel(ui.assets.tankName(selected.tankId),74,175,180,28,{size:12}));
    const level=levelArt(ui,selected.level,30,179);if(level)detail.append(level);
    const companion=profileCompanionBadge(ui);if(companion)detail.append(companion);
    for(const [index,[key,word]] of [['fightScore','tankscore'],['winmatchs','WinStage'],['totalkill','Kill'],['totalassist','Assist']].entries()){
      const asset=panelAsset(ui,P+`player/word_${word}_t.png`);
      if(asset)detail.append(panelArt(ui,asset,236-asset.width,128+29*index));
      detail.append(valueBox(ui,number(selected.source[key]),237,123+29*index));
    }
    detail.append(panelArt(ui,P+'public/help.png',240,129));report.append(detail);
  }
  body.append(report);
}
