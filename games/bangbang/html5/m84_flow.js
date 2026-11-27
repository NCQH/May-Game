import {buildRankedPanel} from './m813_ranked.js';
import {element,assetImage,textInput,setText} from './m8_ui_helpers.js';
import {createNativePanel} from './m81_native_panel.js';
import {isBattleMap as isPKMap,isBattleMode as isPKMode,battleMapName as pkMapName} from './m810_modes.js';
import {ROOM_SIDEBAR_PLAYER_LAYOUT as SIDEBAR,roomOrnamentRect,roomNamePresentation,styleRoomPlayerName} from './m81330_room_layout.js';
import {sharedWaitingRoom,roomPerson,roomCanStart,botAIName,roomAction,createRoomsOnlineList,createRoomPolicies} from './m81337_rooms_ui.js';

// RoomFrame.FREE / FreePvePlayerFrame and SummerHallFrame. All mutations
// continue through the existing native client actions and acknowledgements.
export const NATIVE_ROOM_LAYOUT=Object.freeze({width:1018,height:618,columns:[20,177,334,491,648],
  rows:[81,239],card:[158,159],avatar:[29,51,100,100],menu:[251,561,760,46]});
const mapName=pkMapName;
const at=(node,x,y,w,h)=>{Object.assign(node.style,{position:'absolute',left:`${x}px`,top:`${y}px`});
  if(w!=null)node.style.width=`${w}px`;if(h!=null)node.style.height=`${h}px`;return node;};
const get=(ui,key)=>ui.assets.get(key.startsWith('flow.')?key:'flow.'+key);
function art(ui,key,x=0,y=0,w=null,h=null){const a=get(ui,key);return at(assetImage(a,'','m8-art'),x,y,w??a?.width,h??a?.height);}
function label(text,x,y,w,h=22,extra=''){return at(element('span',text,`m84-flow-label ${extra}`),x,y,w,h);}
function button(ui,key,title,callback,x,y,{icon=null,...options}={}){
  const b=ui.imageButton('flow.'+key,title,callback,x,y,options);
  if(icon){const a=get(ui,icon),w=options.width??get(ui,key)?.width,h=options.height??get(ui,key)?.height;
    if(a)b.append(art(ui,icon,(w-a.width)/2,(h-a.height)/2,a.width,a.height));}return b;
}
function levelBadge(ui,level,x,y,scale=.5){
  const holder=at(element('span',null,'m84-flow-level'),x,y,80,40);holder.style.transform=`scale(${scale})`;
  holder.setAttribute('aria-label',`Cấp ${level}`);
  const a=ui.assets.get(`chrome.charLevel${Number(level)||0}`);if(a)holder.append(at(assetImage(a),0,0,a.width,a.height));
  const fx=level>=11&&ui.assets.get(`chrome.charLevelEffect${Math.min(6,Math.floor((level-11)/5)+1)}`);
  if(fx)holder.append(at(ui.assets.menuArt(fx,'','',{nativePriority:0}),0,0,80,40));return holder;
}
function ornament(ui,itemId,size){
  const row=ui.assets.accountPresentation?.decorations?.[String(itemId)],key=row?.[size+'Key'];
  const a=key&&ui.assets.get(key);if(!a)return null;
  const box=roomOrnamentRect(a,size);if(!box)return null;
  const node=at(ui.assets.menuArt(a,'','m84-flow-ornament',{nativePriority:20}),box.x,box.y,box.width,box.height);
  node.dataset.fit=box.fit;
  const clip=at(element('div',null,'m81330-room-ornament-clip'),0,0,box.clipWidth,box.clipHeight);
  clip.append(node);return clip;
}
function scrollbar(ui,height,{green=false,onUp=null,onDown=null}={}){
  const prefix=green?'darkgreen_scrollbar':'scrollbar',root=at(element('div',null,'m84-flow-scrollbar'),0,0,16,height);
  root.append(art(ui,prefix+'_bk',0,16,16,height-32),button(ui,prefix+'_up','Cuộn lên',onUp,0,0),
    button(ui,prefix+'_down','Cuộn xuống',onDown,0,height-18));return root;
}
function createChat(ui,isRoom){
  const root=at(element('section',null,'m84-native-chat'),isRoom?9:10,407,464,202);
  root.setAttribute('aria-label','Khung chat');root.append(art(ui,'chatBk',0,-6));
  ['Tổng','Room','Team','Guild','Chat riêng'].forEach((text,i)=>{
    const tab=button(ui,i===0?'chat_channel_select':'chat_channel_item',text,null,31+i*71,1);
    tab.append(label(text,0,1,69,24,'m84-chat-tab-label'));tab.setAttribute('aria-disabled','true');
    tab.title='Kênh chat chưa được máy chủ hiện tại hỗ trợ';root.append(tab);
  });
  for(const [key,y,text] of [['chat_clear',53,'Xóa chat'],['chat_up',77,'Cuộn lên'],['chat_down',101,'Cuộn xuống'],['chat_downend',125,'Cuối chat']]){
    const b=button(ui,key,text,null,10,y);b.setAttribute('aria-disabled','true');root.append(b);
  }
  const log=at(element('div',null,'m84-chat-log'),30,28,398,120);log.setAttribute('role','log');root.append(log,at(scrollbar(ui,120),428,28));
  // No chat transport is available. Retain the native empty panel and channel
  // silhouette without invented messages or an enabled send action.
  const input=at(element('div',null,'m84-chat-input'),0,159,239,40);
  input.append(art(ui,'chatbghead',6,-3),art(ui,'chatbgmid',116,-3,98,43),art(ui,'chatbgtail',214,-3),
    label(isRoom?'Room':'Thế giới',31,10,70,19,'m84-chat-channel'));
  const unavailable=at(element('span','Chat chưa mở','m84-chat-unavailable'),122,10,96,19);
  unavailable.title='Chưa có máy chủ chuyển phát chat';input.append(unavailable);root.append(input);return root;
}
export {createChat as createNativeFlowChat};
/** HallPlayerRender reads PLAYER_BRIEF for the room rank. Account cosmetics
 * remain sourced from accepted character updates so wearing an item is visible
 * immediately. In particular, an explicit unranked (0) brief is not bronze.
 */
export function nativeSidebarPlayer(state,catalog){
  const accountId=state?.accountId;
  const meta=state?.meta?.character?.accountId===accountId?state.meta.character:null;
  const brief=state?.flow?.roster?.find(person=>person.accountId===accountId);
  if(!meta&&!brief)return null;
  const character={...brief,...meta,accountId};
  const sectionId=Number(brief?.eloSection??meta?.eloSection);
  const rank=Number.isInteger(sectionId)&&sectionId>0?catalog?.sections?.[String(sectionId)]:null;
  return {...character,eloSection:sectionId,rank:rank?.name?rank:null};
}
function createSidebar(ui){
  const root=at(element('section',null,'m84-native-sidebar'),813,45,194,521);root.setAttribute('aria-label','Danh sách người chơi');
  root.append(art(ui,'roomplayerlist_bk'));
  for(let i=0;i<7;i++)root.append(art(ui,'roomplayerlist_item',9,40+66*i));
  for(const [key,word,x] of [['team','Guild',15],['friend','Bạn',71],['hall','Online',127]]){
    const b=button(ui,key==='hall'?'roomplayerlist_label_selected':'roomplayerlist_label_bk',word,null,x,6,
      {width:53,height:25,icon:key==='hall'?null:'roomplayerlist_label_'+key+'_t'});
    if(key==='hall')b.append(label('Online',0,1,53,23,'m84-flow-centered'));
    b.setAttribute('aria-disabled',String(key!=='hall'));b.title=key==='hall'?'Người chơi online trong server':'Chưa có danh sách từ máy chủ';root.append(b);
  }
  const list=at(element('div',null,'m84-sidebar-players'),5,37,163,464);root.append(list,
    at(scrollbar(ui,464,{green:true,onUp:()=>list.scrollBy?.(0,-66),onDown:()=>list.scrollBy?.(0,66)}),169,37));
  let previous='';const online=createRoomsOnlineList(ui,list);
  return {root,update(){
    if(online.update()){previous='';return;}
    const c=nativeSidebarPlayer(ui.state,ui.assets.flowPresentation);if(!c)return;
    const key=JSON.stringify([c.accountId,c.name,c.level,c.avatarId,c.decorateId,c.eloSection,c.rank?.name,c.rank?.type]);if(key===previous)return;previous=key;
    const row=at(element('article',null,'m84-sidebar-player'),0,0,SIDEBAR.width,SIDEBAR.height);row.dataset.accountId=String(ui.state.accountId);
    row.title=c.name||'';row.setAttribute('aria-label',[c.name,c.rank?.name].filter(Boolean).join(' · '));
    const bg=ornament(ui,c.decorateId,'hall');if(bg)row.append(bg);
    const head=ui.assets.get(ui.assets.chrome?.avatars?.[String(c.avatarId)]);
    if(head)row.append(at(assetImage(head,c.name,'m84-sidebar-avatar'),...SIDEBAR.head));
    row.append(levelBadge(ui,c.level,...SIDEBAR.level),label(c.name||'',...SIDEBAR.name,'m86-sidebar-name'));
    if(c.rank){
      const icon=ui.assets.get(ui.assets.flowPresentation?.sectionIcons?.[String(c.rank.type)]);
      if(icon){
        const image=at(ui.assets.menuArt(icon,c.rank.name,'m86-sidebar-rank-icon',{nativePriority:20}),...SIDEBAR.rankIcon);
        image.dataset.sectionType=String(c.rank.type);row.append(image);
      }
      const name=label(c.rank.name,...SIDEBAR.rankName,'m86-sidebar-rank');name.dataset.sectionId=String(c.eloSection);row.append(name);
    }
    row.append(button(ui,'button_watch_t','Xem hồ sơ',()=>ui.navigate('profile'),...SIDEBAR.watch,{testId:'m84-sidebar-profile'}));list.replaceChildren(row);
  }};
}
/** The maintained native server encodes its waiting room as state 0. */
export function hallRoomAppearance(room){
  const full=room.playerCount>=room.maxPlayers,waiting=room.state===0||room.state===1;
  return {waiting,joinable:waiting&&!full&&isPKMap(room.mapId),
    background:waiting?'roomlisttitle_wait_bk':'roomlisttitle_pairing_bk',
    status:waiting?(full?'list_status_waitting_disable_t':'list_status_waitting_t'):
      room.state===2?'list_status_pairing_t':'list_status_running_t'};
}
export function buildNativeHall(ui){
  ui.hallPage=0;ui.hallSetupKey='';ui.lastKey='';
  ui.content.append(ui.art('room.background',1,0),art(ui,'pvpReadyRoom1000x600_shadow',18,47));
  const title=get(ui,'title_hall_t');ui.content.append(art(ui,'title_hall_t',(1018-title.width)/2,21));
  ui.content.append(ui.imageButton('public.close','Về sảnh',()=>ui.navigate('lobby'),979,15,{width:24,height:24,testId:'m84-hall-close'}));
  // Native room header; ranked opens S1721 directly without a room detour.
  const ranked=ui.hallKind==='ranked';ui.rankedView=null;ui.hallTabs=[];
  for(const [i,[key,text]] of [['sort_title_happygame_t','Sự kiện'],['sort_title_arena_selected_t','So tài PK'],
    ['icon_ladder_unselect_t','Xếp hạng'],['sort_title_teamcompetition_t','Giải Guild']].entries()){
    const selected=i===(ranked?2:1),enabled=i===1||i===2;
    const change=()=>{if(!enabled||ui.state.play.busy||selected)return;ui.hallKind=i===2?'ranked':'normal';ui.content.replaceChildren();buildNativeHall(ui);updateNativeHall(ui);};
    const icon=i===2&&selected?'icon_ladder_selected_t':key;
    const b=button(ui,selected?'sort_selected':'sort_bk',text,enabled?change:null,22+[0,113,226,339][i],51,{icon,testId:i===2?'hall-ranked-tab':i===1?'hall-normal-tab':undefined});
    b.setAttribute('aria-selected',String(selected));b.setAttribute('aria-disabled',String(!enabled));
    if(!enabled)b.title=text+' chưa mở trên máy chủ hiện tại';else ui.hallTabs.push(b);ui.content.append(b);
  }
  if(ranked){
    ui.rankedView=buildRankedPanel(ui,{button,art});ui.hallSidebar=createSidebar(ui);
    ui.content.append(createChat(ui,false),ui.hallSidebar.root);return;
  }
  ['team','name','model','map','num','status'].forEach((name,i)=>{
    const key='roomlist_caption_'+name+'_t',a=get(ui,key);ui.content.append(art(ui,key,[40,230,359,459,559,658][i],101-a.height/2));
  });
  const list=at(element('section',null,'m81-hall-list'),21,109,783,292);
  for(let i=0;i<8;i++)list.append(art(ui,'list_bk',0,i===7?251:36*i));
  ui.hallList=at(element('div',null,'m81-hall-rows'),5,5,778,288);list.append(ui.hallList);ui.content.append(list,art(ui,'pager_bk',527,394));
  ui.hallPrev=button(ui,'btn_s2_prev','Trang trước',()=>{ui.hallPage--;ui.lastKey='';ui.updateHall();},605,399,{testId:'m81-hall-prev'});
  ui.hallNext=button(ui,'btn_s2_next','Trang sau',()=>{ui.hallPage++;ui.lastKey='';ui.updateHall();},648,399,{testId:'m81-hall-next'});
  ui.hallRefresh=button(ui,'button_2_s_blue','Làm mới danh sách phòng',()=>ui.run(()=>ui.client.refreshHall()),714,398,{testId:'m81337-hall-refresh'});
  ui.hallRefresh.append(element('span','Làm mới','m81337-card-caption'));
  ui.hallPageLabel=at(element('span',null,'m84-hall-page sr-only'),535,402,65,20);ui.hallPageLabel.setAttribute('aria-live','polite');
  ui.content.append(ui.hallPrev,ui.hallNext,ui.hallRefresh,ui.hallPageLabel,art(ui,'quickplay_bk_4',534,429));
  ui.quickJoin=button(ui,'button_red_m','Gia nhập nhanh đội PK',()=>ui.run(()=>ui.client.quickJoinRoom()),546,442,{testId:'m82-quick-join'});
  ui.quickJoin.append(art(ui,'word_quickplay_onlyfont_t',69,12));ui.content.append(ui.quickJoin,art(ui,'ico_pvp',581,451));
  ui.createButton=button(ui,'btn_create_team_t','Tạo đội PK',()=>ui.showCreateRoom(),527,499,{testId:'m81-open-create-room'});
  ui.findButton=button(ui,'btn_find_team_t','Tìm đội',()=>showFindRoom(ui),650,499,{testId:'m84-find-room'});
  ui.hallSidebar=createSidebar(ui);ui.content.append(ui.createButton,ui.findButton,createChat(ui,false),ui.hallSidebar.root);
}
export function updateNativeHall(ui){
  const s=ui.state,p=s.play,busy=s.phase!=='ready'||!!p.busy,queued=!!s.multiplayer?.queue.active;
  for(const tab of ui.hallTabs||[])tab.disabled=busy;
  if(ui.hallKind==='ranked'){ui.rankedView?.tick();ui.hallSidebar?.update();return;}
  ui.createButton.disabled=busy||queued;ui.findButton.disabled=busy||queued;
  ui.hallRefresh.disabled=busy;
  ui.quickJoin.disabled=busy||queued||!isPKMode(p.setup?.mode);if(ui.createConfirm)ui.createConfirm.disabled=busy||queued;ui.hallSidebar?.update();
  const pages=Math.max(1,Math.ceil(p.rooms.length/8));ui.hallPage=Math.max(0,Math.min(ui.hallPage,pages-1));
  const key=JSON.stringify([p.rooms,p.hallReceived,p.busy,queued,ui.hallPage]);if(key===ui.lastKey)return;ui.lastKey=key;
  ui.hallPrev.disabled=busy||ui.hallPage===0;ui.hallNext.disabled=busy||ui.hallPage+1>=pages;setText(ui.hallPageLabel,`Trang ${ui.hallPage+1}/${pages}`);
  ui.hallList.replaceChildren(...p.rooms.slice(ui.hallPage*8,ui.hallPage*8+8).map(room=>{
    const view=hallRoomAppearance(room),row=element('article',null,'m84-hall-row');row.dataset.roomId=String(room.roomId);row.append(art(ui,view.background));
    for(const [text,x,w] of [[room.roomId,3,110],[room.name||'',144,171],[room.roomType===1?'Tự do':room.roomType===2?'So tài':'',323,60],
      [mapName(room.mapId),391,120],[`${room.playerCount}/${room.maxPlayers}`,523,60]]){
      const node=label(text,x,3,w,22,'m84-hall-cell');node.title=String(text);row.append(node);
    }
    const status=get(ui,view.status);row.append(art(ui,view.status,385.5+259-status.width/2,2));
    const join=button(ui,'roomlist_btn_join_t','Gia nhập đội '+room.roomId,()=>ui.run(()=>ui.client.joinRoom(room.roomId)),719,2,{testId:'m8-join-'+room.roomId});
    join.disabled=busy||queued||!view.joinable;row.append(join);return row;
  }));
}
export function showFindRoom(ui){
  if(ui.findShade||ui.state.play.busy||ui.state.multiplayer?.queue.active)return;
  const generation=ui.client.generation,accountId=ui.state.accountId,token=ui.screenToken;
  const shade=at(element('div',null,'m81-create-shade'),0,0,1018,618);ui.findShade=shade;
  for(const child of ui.content.children)child.inert=true;
  const close=()=>{if(ui.state.play.busy)return;shade.remove();ui.findShade=null;for(const child of ui.content.children)child.inert=false;ui.findButton.focus();};
  const panel=createNativePanel({assets:{...ui.assets.ui.assets,...ui.assets.panels.assets},kind:'box1',state:'CONFIRM',width:358,height:258,
    close:{asset:'public.close',x:319,y:15,label:'Đóng'},onClose:close});
  shade.setAttribute('role','dialog');shade.setAttribute('aria-modal','true');shade.setAttribute('aria-label','Tìm đội');shade.append(at(panel.root,330,180,358,258));
  const input=at(textInput('',{maxLength:6,placeholder:'Mã phòng 6 chữ số'}),74,82,210,35);input.inputMode='numeric';input.setAttribute('aria-label','Mã phòng');input.dataset.testid='m84-find-room-id';
  panel.content.append(label('Nhập mã phòng',74,55,210,23,'m84-flow-centered'),input);
  const status=label('Vào chỗ trống hoặc thay một bot. Mỗi phe tối đa 5 người.',34,125,290,60,'m84-find-status');status.setAttribute('role','status');panel.content.append(status);
  const confirm=button(ui,'button_window_green','Tìm và gia nhập',()=>ui.run(async()=>{
    const code=input.value.trim();if(!/^[0-9]{6}$/.test(code)){setText(status,'Nhập mã phòng gồm 6 chữ số.');return;}
    confirm.disabled=true;
    try{
      if(ui.findShade!==shade||ui.screenToken!==token||ui.client.generation!==generation||ui.state.accountId!==accountId||ui.state.play.phase!=='lobby')return;
      await ui.client.joinRoomCode(code);
    }catch(error){if(ui.findShade===shade)setText(status,error.message);throw error;
    }finally{if(ui.findShade===shade)confirm.disabled=false;}
  }),119,206,{icon:'title_confirm_green_t',testId:'m84-find-room-confirm'});
  panel.content.append(confirm);shade.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();close();}else if(event.key==='Enter'&&!confirm.disabled){event.preventDefault();confirm.click();}});
  ui.content.append(shade);input.focus();
}
function createRoomCard(ui,person,slot,camp,selfCamp,seat=null){
  const managed=sharedWaitingRoom(ui.state),host=managed?.owner_id===ui.state.accountId,mutations=[];
  const root=at(element('article',null,'m84-room-card'),NATIVE_ROOM_LAYOUT.columns[slot],NATIVE_ROOM_LAYOUT.rows[camp-1],158,159);
  root.dataset.camp=String(camp);root.dataset.slot=String(slot);root.dataset.accountId=person?String(person.accountId):'';
  if(seat){root.dataset.serverSlot=String(seat.slot);root.dataset.kind=seat.kind;}
  root.append(art(ui,camp===selfCamp?'pvp5v5_playerbox_blueteam':'pvp5v5_playerbox_redteam'),art(ui,'pvp5v5_playerbox'));
  if(!person){
    const a=get(ui,'avatar_card_waitplayer_t');root.append(art(ui,'avatar_card_waitplayer_t',(158-a.width)/2,(159-a.height)/2));root.setAttribute('aria-label',`Phe ${camp} · Vị trí trống`);
    if(host){const add=button(ui,'button_2_s_blue','Thêm bot phe '+camp,roomAction(ui,managed.room_id,()=>ui.client.addRoomBot(camp)),35,120,{testId:`room-add-bot-${seat.slot}`});
      add.append(element('span','+ Thêm bot','m81337-card-caption'));root.append(add);mutations.push(add);}
    return {root,mutations};
  }
  const own=person.accountId===ui.state.accountId,master=person.accountId===(managed?.owner_id||ui.state.flow.creatorAccountId);
  if(own)root.append(art(ui,'pvp5v5_playerbox_myself'));
  // The ten-slot room uses 158x159 native cards. The /small/300 art is
  // 255x288 (larger than this compact layout), so it must not replace this compact frame.
  // Retain the equipped ornament in the sidebar, profile and loading card.
  // CHAR_BRIEF.level is the character level. AvatarView takes tankLevel.
  const tank={...person,level:person.tankLevel||1};
  const portrait=ui.assets.portraitForTank(tank,{size:100});root.append(at(portrait,29,51,100,100));
  const namePresentation=roomNamePresentation(person,ui.assets,{compact:true});
  root.append(art(ui,'avatar_card_name',13,39),
    styleRoomPlayerName(label(person.name||'',...namePresentation.name,'m84-room-player-name'),namePresentation),levelBadge(ui,person.level,5,65));
  if(namePresentation.vipAsset)root.append(at(assetImage(namePresentation.vipAsset,
    `${namePresentation.vipLevel>=100?'Super VIP':'VIP'} ${namePresentation.vipLevel%100}`,
    'm8-art m81331-room-vip'),...namePresentation.vip));
  const info=button(ui,'avatar_card_button_s','Hồ sơ '+person.name,own?()=>ui.navigate('profile'):null,120,12,{icon:'avatar_card_ico_info_s',testId:'m84-room-info-'+person.accountId});
  if(!own&&managed){
    info.hidden=true;
    if(host){
      const remove=button(ui,'avatar_card_button_s',seat.kind==='bot'?'Xóa bot':'Mời '+person.name+' rời phòng',
        roomAction(ui,managed.room_id,()=>ui.client.removeRoomSeat(seat.slot,seat.account_id)),120,12,{icon:'avatar_card_ico_quit_s',testId:`room-remove-${seat.slot}`});
      root.append(remove);mutations.push(remove);
      if(seat.kind==='human'){
        const move=button(ui,'button_2_s_blue','Chuyển '+person.name+' sang phe '+(3-camp),
          roomAction(ui,managed.room_id,()=>ui.client.moveRoomPlayer(person.accountId,3-camp)),49,12,{width:64,height:24,testId:`room-move-${seat.account_id}`});
        move.append(element('span','Đổi phe','m81337-card-caption'));root.append(move);mutations.push(move);
      }
    }
  }else if(!own){
    info.style.left='89px';info.setAttribute('aria-disabled','true');info.title='Chưa có hồ sơ của nhân vật này';
    for(const [key,x,name] of [['avatar_card_ico_addfriend_s',58,'Kết bạn'],['avatar_card_ico_quit_s',120,'Mời rời phòng']]){
      const b=button(ui,'avatar_card_button_s',name,null,x,12,{icon:key});b.setAttribute('aria-disabled','true');b.title=name+' chưa được hỗ trợ';root.append(b);
    }
  }
  root.append(info);
  const ready=art(ui,'ready_s_t',19,114),owner=art(ui,'roommaster_t',19,119);root.append(ready,owner);
  if(!managed){
    const hand=button(ui,'button_interact','Tương tác',null,121,97);hand.setAttribute('aria-disabled','true');hand.title='Chưa có dữ liệu tương tác';root.append(hand);
    if(ui.state.flow.creatorAccountId===ui.state.accountId&&!own){const host=button(ui,'button_host','Chuyển chủ phòng',null,121,67);host.setAttribute('aria-disabled','true');root.append(host);}
  }
  if(seat?.kind==='bot')root.append(label(botAIName(managed.bot_ai_camps[String(camp)]),9,137,83,18,'m81337-room-bot-label'));
  const ping=label('',95,137,58,18,'m84-room-ping');root.append(ping);
  return {root,person,portrait,ready,owner,ping,own,master,mutations};
}
export function buildNativeRoom(ui){
  ui.roomKey='';ui.nativeRoomCards=new Map();ui.content.append(ui.art('room.background',0,0));
  ui.roomClose=ui.imageButton('public.close','Rời phòng',()=>ui.run(()=>ui.client.leaveRoom()),978,15,{width:24,height:24,testId:'m81-room-close'});ui.content.append(ui.roomClose);
  ui.roomTitle=label('',425,22,168,24,'m84-room-title');ui.roomId=label('',103,55,76,22);
  ui.content.append(ui.roomTitle,art(ui,'title_teamnumber_t',35,54),art(ui,'label40x20',92,53),ui.roomId);
  ui.roomPolicies=createRoomPolicies(ui);ui.roomCount=label('',650,55,141,22,'m81337-room-count');
  ui.content.append(ui.roomPolicies.root,ui.roomCount);
  ui.roomCards=at(element('section',null,'m84-room-roster'),0,0,808,399);ui.roomCards.setAttribute('aria-label','Đội hình hai phe');ui.content.append(ui.roomCards);
  ui.roomMap=at(assetImage(ui.assets.m3.maps[String(ui.state?.flow?.mapId)]?.preview,mapName(ui.state?.flow?.mapId)),509,433,168,100);ui.content.append(ui.roomMap,art(ui,'startgame_background_t',498,424));
  ui.readyButton=button(ui,'ready_button_t','Sẵn sàng',()=>ui.run(()=>{const self=ui.state.flow.roster.find(c=>c.accountId===ui.state.accountId);return ui.client.setReady(!self?.ready);}),688,440,{testId:'m8-ready'});
  ui.startButton=button(ui,'startgame_button_t','Vào game',()=>ui.run(()=>ui.client.startMatch()),688,440,{testId:'m8-start'});
  ui.ownerCancel=button(ui,'button_2_s_blue','Hủy sẵn sàng',()=>ui.run(()=>ui.client.setReady(false)),687,528,{testId:'m81-owner-cancel-ready'});
  ui.ownerCancel.append(label('Hủy sẵn sàng',0,2,86,22,'m84-cancel-label'));
  ui.changeCamp=button(ui,'button_2_blue','Đổi phe',()=>ui.run(()=>ui.client.changeRoomCamp()),595,404,{icon:'b2_changeteam_t',testId:'m82-change-camp'});
  ui.roomSidebar=createSidebar(ui);ui.content.append(ui.readyButton,ui.startButton,ui.ownerCancel,ui.changeCamp,createChat(ui,true),ui.roomSidebar.root);
}
export function updateNativeRoom(ui){
  const s=ui.state,managed=sharedWaitingRoom(s),roster=managed?managed.seats.map(row=>roomPerson(s,row)).filter(Boolean):s.flow.roster;
  const self=roster.find(c=>c.accountId===s.accountId),selfCamp=self?.camp||1;
  const busy=!!s.play.busy||s.phase!=='ready',owner=(managed?.owner_id||s.flow.creatorAccountId)===s.accountId;
  setText(ui.roomTitle,mapName(s.flow.mapId));setText(ui.roomId,String(s.play.room?.roomId||s.flow.roomId||''));
  ui.roomPolicies?.update();setText(ui.roomCount,managed?`${managed.human_count} người · ${managed.bot_count} bot`:'');
  ui.roomSidebar?.update();ui.changeCamp.disabled=busy||!isPKMap(s.flow.mapId);
  const preview=ui.assets.m3.maps[String(s.flow.mapId)]?.preview;
  if(preview&&ui.roomMap.getAttribute('src')!==preview.url)ui.roomMap.src=preview.url;
  ui.roomMap.alt=mapName(s.flow.mapId);
  for(const camp of [1,2])for(let slot=0;slot<5;slot++){
    const seat=managed?.seats.find(row=>row.slot===(camp-1)*5+slot);
    const person=managed?roomPerson(s,seat):roster.filter(c=>c.camp===camp)[slot],key=camp+':'+slot;
    // Readiness, latency and busy changes must not detach a running timeline.
    const appearance=JSON.stringify([person?.accountId,person?.name,person?.level,person?.tankId,person?.tankLevel,
      person?.externalId,person?.haloId,person?.decorateId,person?.vipLevel,selfCamp,s.flow.creatorAccountId,
      managed?.room_id,managed?.owner_id,seat?.kind,managed?.bot_ai_camps[String(camp)]]);
    let card=ui.nativeRoomCards.get(key);
    if(!card||card.appearance!==appearance){
      const next=createRoomCard(ui,person,slot,camp,selfCamp,seat);next.appearance=appearance;
      if(card)card.root.replaceWith(next.root);else ui.roomCards.append(next.root);
      ui.nativeRoomCards.set(key,next);card=next;
    }
    if(person){card.ready.hidden=card.master||!person.ready;card.owner.hidden=!card.master;
      card.ping.hidden=!card.own||!Number.isFinite(s.latencyMs);setText(card.ping,card.ping.hidden?'':`${s.latencyMs}ms`);}
    for(const control of card.mutations||[])control.disabled=busy;
  }
  ui.roomCards.dataset.camp=String(selfCamp);
  const ready=get(ui,self?.ready?'cancelready_button_t':'ready_button_t');ui.readyButton.firstChild.src=ready.url;
  ui.readyButton.setAttribute('aria-label',self?.ready?'Hủy sẵn sàng':'Sẵn sàng');
  ui.readyButton.hidden=owner&&!!self?.ready;ui.startButton.hidden=!owner||!self?.ready;
  ui.ownerCancel.hidden=!owner||!self?.ready;ui.ownerCancel.disabled=busy;
  ui.roomClose.disabled=busy;ui.readyButton.disabled=busy;ui.startButton.disabled=busy||!self?.ready||!owner||!!managed&&!roomCanStart(managed);
  ui.startButton.title=managed&&!roomCanStart(managed)?'Mỗi phe cần có người hoặc bot; mọi người chơi cần sẵn sàng.':'Bắt đầu chọn tank';
}
