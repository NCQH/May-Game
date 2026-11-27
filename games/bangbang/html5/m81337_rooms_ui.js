import {element,actionButton,assetImage,selectInput,setText} from './m8_ui_helpers.js';
import {isManagedWaitingRoom} from './m81337_rooms_protocol.js';
import {ROOM_SIDEBAR_PLAYER_LAYOUT as SIDEBAR,roomOrnamentRect} from './m81330_room_layout.js';

export const BOT_AI_OPTIONS=Object.freeze([{value:'legacy',label:'Bot gốc'},{value:'elite_v1',label:'ProV3'}]);
export const botAIName=value=>value==='elite_v1'?'ProV3':'Bot gốc';
export function sharedWaitingRoom(state){return isManagedWaitingRoom(state?.multiplayer,state?.play)?state.multiplayer.room:null;}
export function roomCanStart(room){return !!room&&[1,2].every(camp=>room.seats.some(row=>row.camp===camp&&row.kind!=='empty'))
  &&room.seats.filter(row=>row.kind==='human').every(row=>row.ready&&row.connected);}
export function campAcceptsHuman(room,camp){return !!room&&room.seats.some(row=>row.camp===camp&&row.kind!=='human');}
export function roomPerson(state,seat){
  if(!seat||seat.kind==='empty')return null;
  const native=state.flow.roster.find(row=>row.accountId===seat.account_id)||{};
  return {accountId:seat.account_id,name:seat.name,level:seat.level,avatarId:seat.avatar_id,
    tankId:seat.tank_id,tankLevel:seat.tank_level,externalId:seat.external_id,...native,camp:seat.camp,ready:seat.ready};
}
const onlineLabel=status=>({lobby:'Ở sảnh',waiting:'Trong phòng',selecting:'Chọn tank',battle:'Đang đấu',
  rank_queue:'Tìm trận rank',rank_reserved:'Đang ghép rank'}[status]||'Đang bận');
const uiBusy=ui=>ui.state?.phase!=='ready'||!!ui.state?.play.busy;
export function roomAction(ui,roomId,operation){
  const generation=ui.client.generation,accountId=ui.state.accountId;
  return ()=>ui.run(()=>{
    if(generation!==ui.client.generation||accountId!==ui.state.accountId||sharedWaitingRoom(ui.state)?.room_id!==roomId)return;
    return operation();
  });
}

const at=(node,x,y,w,h)=>{
  Object.assign(node.style,{position:'absolute',left:`${x}px`,top:`${y}px`});
  if(w!=null)node.style.width=`${w}px`;if(h!=null)node.style.height=`${h}px`;return node;
};

/** Presence has no cosmetic IDs. Retain accepted native cosmetics for this
 * account, never borrow the signed-in character's decoration for a peer. */
export function onlinePlayerPresentation(state,person){
  const accountId=person.account_id;
  const brief=state.flow?.roster?.find(row=>row.accountId===accountId)||{};
  const meta=accountId===state.accountId&&state.meta?.character?.accountId===accountId?state.meta.character:{};
  return {...brief,name:person.name,level:person.level,avatarId:person.avatar_id,...meta,accountId};
}

function onlineOrnament(ui,character){
  const decoration=ui.assets.accountPresentation?.decorations?.[String(character.decorateId)];
  const asset=decoration?.hallKey&&ui.assets.get(decoration.hallKey);
  const box=asset&&roomOrnamentRect(asset,'hall');if(!box)return null;
  const art=at(ui.assets.menuArt(asset,'','m84-flow-ornament',{nativePriority:20}),box.x,box.y,box.width,box.height);
  art.dataset.fit=box.fit;
  const clip=at(element('div',null,'m81330-room-ornament-clip'),0,0,box.clipWidth,box.clipHeight);
  clip.append(art);return clip;
}

function onlineLevelBadge(ui,level){
  const [x,y,scale]=SIDEBAR.level,holder=at(element('span',null,'m84-flow-level'),x,y,80,40);
  holder.style.transform=`scale(${scale})`;holder.setAttribute('aria-label',`Cấp ${level}`);
  const badge=ui.assets.get(`chrome.charLevel${Number(level)||0}`);
  if(badge)holder.append(at(assetImage(badge,''),0,0,badge.width,badge.height));
  const effect=level>=11&&ui.assets.get(`chrome.charLevelEffect${Math.min(6,Math.floor((level-11)/5)+1)}`);
  if(effect)holder.append(at(ui.assets.menuArt(effect,'','',{nativePriority:0}),0,0,80,40));
  return holder;
}

/** The roster is public presence, never a synthetic friend list. */
export function createRoomsOnlineList(ui,list){
  let previous='',controls=[];
  return {update(){
    const state=ui.state,mp=state.multiplayer,room=sharedWaitingRoom(state);
    if(!mp?.received){list.classList.remove('m81337-online-list');previous='';controls=[];return false;}
    list.classList.add('m81337-online-list');
    const owner=room?.owner_id===state.accountId;
    const people=[...mp.online].sort((a,b)=>(b.account_id===state.accountId)-(a.account_id===state.accountId)||a.name.localeCompare(b.name,'vi'));
    const characters=people.map(person=>onlinePlayerPresentation(state,person));
    const key=JSON.stringify([mp.online,characters.map(c=>[c.accountId,c.name,c.level,c.avatarId,c.decorateId]),
      room?.room_id,room?.owner_id,room?.seats.map(row=>[row.slot,row.kind,row.account_id]),state.accountId]);
    if(key!==previous){
      previous=key;controls=[];
      const rows=people.map((person,index)=>{
        const character=characters[index];
        const own=person.account_id===state.accountId,seat=room?.seats.find(row=>row.account_id===person.account_id&&row.kind==='human');
        const row=element('article',null,'m84-sidebar-player m81337-online-player');row.dataset.accountId=String(person.account_id);
        row.style.width=`${SIDEBAR.width}px`;row.style.height=`${SIDEBAR.height}px`;
        const ornament=onlineOrnament(ui,character);if(ornament)row.append(ornament);
        const head=ui.assets.get(ui.assets.chrome?.avatars?.[String(character.avatarId)]);
        if(head)row.append(at(assetImage(head,character.name,'m84-sidebar-avatar m81337-online-avatar'),...SIDEBAR.head));
        const name=at(element('strong',character.name,'m84-flow-label m86-sidebar-name m81337-online-name'),...SIDEBAR.name);name.title=character.name;
        const statusText=seat?`Phe ${seat.camp} · Trong phòng`:onlineLabel(person.status);
        const status=at(element('span',statusText,'m84-flow-label m81337-online-status'),...SIDEBAR.detail);status.title=statusText;
        row.setAttribute('aria-label',[character.name,own?'Bạn':null,statusText].filter(Boolean).join(' · '));
        row.append(onlineLevelBadge(ui,character.level),name,status);
        if(own){
          row.append(ui.imageButton('flow.button_watch_t','Xem hồ sơ',()=>ui.navigate('profile'),...SIDEBAR.watch,
            {testId:'m84-sidebar-profile',className:'m81337-online-profile'}));
        }else if(owner&&!seat&&person.can_invite===true){
          const actions=at(element('div',null,'m81337-online-actions'),SIDEBAR.watch[0],SIDEBAR.watch[1],104,18);
          for(const camp of [1,2]){
            const title=`Mời ${character.name} vào phe ${camp}`;
            const invite=ui.imageButton('flow.button_2_s_blue',title,
              roomAction(ui,room.room_id,()=>ui.client.inviteRoomPlayer(person.account_id,camp)),(camp-1)*54,0,
              {width:50,height:18,className:'m81337-online-invite',testId:`room-invite-${person.account_id}-${camp}`});
            invite.title=title;invite.append(element('span',`Mời phe ${camp}`,'m81337-online-invite-caption'));
            actions.append(invite);controls.push({button:invite,camp});
          }
          row.append(actions);
        }
        return row;
      });
      if(!rows.length)rows.push(element('p','Chưa có người chơi online.','m81337-online-empty'));
      list.replaceChildren(...rows);
    }
    for(const control of controls)control.button.disabled=uiBusy(ui)||!owner||!campAcceptsHuman(room,control.camp);
    return true;
  }};
}

export function createRoomPolicies(ui){
  const root=element('div',null,'m81337-room-policies'),selectors=[];
  for(const camp of [1,2]){
    const label=element('label'),select=selectInput(BOT_AI_OPTIONS,'legacy',`Loại bot phe ${camp}`);
    select.dataset.testid=`room-bot-ai-${camp}`;
    select.addEventListener('change',()=>{const room=sharedWaitingRoom(ui.state),policy=select.value;
      if(room)return roomAction(ui,room.room_id,()=>ui.client.setRoomBotAI(camp,policy))();});
    label.append(element('span',`Bot phe ${camp}`),select);root.append(label);selectors.push({camp,select});
  }
  return {root,update(){
    const room=sharedWaitingRoom(ui.state);root.hidden=!room;
    for(const {camp,select} of selectors){
      select.value=room?.bot_ai_camps[String(camp)]||'legacy';
      select.disabled=uiBusy(ui)||!room||room.owner_id!==ui.state.accountId;
    }
  }};
}

/** One actionable invite at a time; expiry uses the server clock offset. */
export function createRoomInvitationBanner(ui){
  const root=element('aside',null,'m81337-invitation');root.hidden=true;root.setAttribute('aria-label','Lời mời vào phòng');
  const title=element('strong','Lời mời chơi cùng'),message=element('p'),status=element('span',null,'m81337-invite-clock');
  const actions=element('div',null,'m81337-invite-actions');
  let active=null,scope=null;
  const valid=(invite,renderScope)=>invite&&renderScope?.generation===ui.client.generation&&renderScope.accountId===ui.state?.accountId
    &&ui.state?.multiplayer.invites.some(row=>row.invite_id===invite.invite_id)
    &&invite.expires_at_ms>Date.now()+(ui.state.multiplayer.clockOffset||0);
  const act=method=>()=>{const invite=active,renderScope=scope;return ui.run(()=>{if(valid(invite,renderScope))return ui.client[method](invite.invite_id);});};
  const accept=actionButton('Vào phòng',act('acceptRoomInvitation'),{testId:'room-invite-accept'});
  const decline=actionButton('Từ chối',act('declineRoomInvitation'),{testId:'room-invite-decline'});
  actions.append(accept,decline,status);root.append(title,message,actions);
  return {root,update(){
    const state=ui.state,mp=state?.multiplayer,now=Date.now()+(mp?.clockOffset||0);
    const invites=(mp?.invites||[]).filter(row=>row.expires_at_ms>now);
    active=invites[0]||null;scope={generation:ui.client.generation,accountId:state?.accountId};
    root.hidden=!active||state?.phase!=='ready'||!['lobby','room'].includes(state?.play.phase);
    if(root.hidden)return;
    setText(message,`${active.from_name} mời bạn vào phòng ${active.code} · Phe ${active.camp}.`);
    const seconds=Math.max(0,Math.ceil((active.expires_at_ms-now)/1000));
    setText(status,`${seconds}s${invites.length>1?` · +${invites.length-1} lời mời`:''}`);
    accept.disabled=uiBusy(ui)||state.play.phase!=='lobby'||!!mp.queue.active;
    accept.title=mp.queue.active?'Hủy tìm trận rank để nhận lời mời.':state.play.phase!=='lobby'?'Rời phòng hiện tại để nhận lời mời.':'Vào phòng cùng bạn';
    decline.disabled=uiBusy(ui);
  }};
}

export function rankQueueSeconds(state,now=Date.now()){
  const mp=state?.multiplayer;return Math.max(0,Math.ceil(((mp?.queue.wait_remaining_ms||0)-Math.max(0,now-(mp?.receivedAt||now)))/1000));
}
