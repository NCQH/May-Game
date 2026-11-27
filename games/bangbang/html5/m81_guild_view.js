/* Presentation only. Source: guild_20261015/mxml/clan/CorpsFrame.as:
 * frame 1018×618; ready-room shadow (16,46); join list (20,50) 788×350;
 * member canvas (23,51), ClanMyInfo (514,51) 298×394; close right/top 15.
 * Mutation/permission/confirmation ownership stays in M8AccountUI and
 * m81_guild_management. No synthetic members, ranks, chat or currencies. */
import {element,assetImage,numberText,nativeText} from './m8_ui_helpers.js';
import {renderGuildInvitations} from './m81_guild_management.js';
import {ownGuildMember} from './m8_account_state.js';
import {createNativePanel} from './m81_native_panel.js';
import {GUILD_ART,renderNativeGuildSkills} from './m81343_guild_skills.js';
export const GUILD_GEOMETRY=Object.freeze({width:1018,height:618,shadow:[16,46,794,512],join:[20,50,788,350],members:[23,51,489,343],info:[514,51,298,394],close:[15,15],navigationButton:[124,46]});
function rect(node,[x,y,w,h]) {Object.assign(node.style,{left:`${x}px`,top:`${y}px`,width:`${w}px`,height:`${h}px`});return node;}
function panel(root,name,geometry,label) {const n=element('section',null,`m81-guild-${name}`);n.setAttribute('aria-label',label);rect(n,geometry);root.append(n);return n;}
function art(ui,root,key,x,y) {const a=ui.assets?.ui?.assets?.[key]||ui.assets?.get?.(key);if(!a)return;const n=assetImage(a,'','m81-guild-art');rect(n,[x,y,a.width,a.height]);root.append(n);}
function blueFrame(ui,host,width,height,state='SHADOW') {
  const frame=createNativePanel({assets:ui.assets.panels.assets,kind:'box3',state,width,height});
  frame.root.classList.add('m43-guild-panel');rect(frame.root,[0,0,width,height]);host.append(frame.root);return frame.content;
}
function styleNavigation(button,active=false){button.style.backgroundImage=`url("${GUILD_ART[active?'navGreen':'navBlue'].url}")`;}
function nativeJoinList(list) {
  const heading=list.querySelector('h3'),search=list.querySelector('input'),find=list.querySelector('[data-testid="guild-search"]'),filter=list.querySelector('label'),table=list.querySelector('.m8-account-table'),pager=list.querySelector('.m8-account-pager');
  const fixed=new Set([heading,search,find,filter,table,pager]),status=element('div',null,'m43-guild-join-status');
  for(const node of [...list.children])if(!fixed.has(node))status.append(node);
  const toolbar=element('div',null,'m43-guild-join-toolbar');if(search)toolbar.append(search);if(find)toolbar.append(find);if(filter)toolbar.append(filter);
  const viewport=element('div',null,'m43-guild-join-list');if(table)viewport.append(table);
  list.replaceChildren();if(heading)list.append(heading);list.append(toolbar,status,viewport);if(pager)list.append(pager);list.classList.add('m43-guild-join-card');
}
function nativeInfo(ui,host,account,overview) {
  const body=blueFrame(ui,host,298,394),g=account.guild,team=(account.teams||[]).find(t=>t.teamId===account.selfTeamId);
  const leader=Object.values(account.members||{}).flat().find(m=>m.charUuid===g.leaderUuid),name=leader?account.buddies?.[leader.accountId]?.name:null;
  const rows=[['Tên Guild',g.name],['Chủ Guild',name||'—'],['Đội của bạn',team?.name||'—'],['Quỹ Guild',numberText(g.coin)],['Quỹ Team',numberText(team?.coin||0)],['Cấp Guild',numberText(g.level)]];
  for(const [i,[label,value]] of rows.entries()){
    const row=element('div',null,'m43-guild-info-row');rect(row,[18,18+i*34,262,29]);
    row.append(element('strong',label),element('span',value));row.lastElementChild.title=String(value);body.append(row);
  }
  const notice=element('section',null,'m43-guild-notice');rect(notice,[18,226,262,98]);notice.append(element('strong','Thông báo Guild'),element('p',nativeText(g.notice)||'Chưa có thông báo.'));body.append(notice);
  const actions=element('div',null,'m43-guild-info-actions');rect(actions,[18,337,262,39]);
  for(const button of overview?.querySelectorAll('button')||[])actions.append(button);body.append(actions);
}
/** Host supplies stage scaling, status/confirmation overlay and CSS. */
export function renderNativeGuild(ui,body) {
  const account=ui.snapshot.account||{},root=element('div',null,'m81-guild-view');root.dataset.nativeScreen='guild';rect(root,[0,0,1018,618]);
  art(ui,root,'room.background',0,0);art(ui,root,'account.guildShadow',16,46);art(ui,root,'account.guildTitle',487,21);
  const close=ui.button('×',()=>ui.onClose(),{testId:'guild-close',className:'m81-guild-close'});close.setAttribute('aria-label','Đóng Guild');
  const closeArt=ui.assets?.ui?.assets?.['public.close'];if(closeArt){close.textContent='';close.style.width=`${closeArt.width}px`;close.style.height=`${closeArt.height}px`;close.append(assetImage(closeArt,''));}root.append(close);
  const refresh=ui.button('Làm mới',()=>ui.refresh(),{testId:'guild-refresh',disabled:!!ui.pending});refresh.style.position='absolute';rect(refresh,[840,565,124,30]);root.append(refresh);
  const rail=panel(root,'navigation',[823,60,178,480],'Điều hướng Guild');
  rail.classList.add('m43-guild-navigation');
  const invites=panel(root,'invitations',[823,325,178,220],'Lời mời Guild');renderGuildInvitations(ui,invites,account);
  if(!account.guild) {
    const delegated=element('div');ui.renderGuildJoin(delegated);
    const columns=delegated.querySelector('.m8-account-columns');
    const list=columns?.children[0],create=columns?.children[1];
    const content=panel(root,'join',GUILD_GEOMETRY.join,'Danh sách Guild');if(list){nativeJoinList(list);content.append(list);}
    const creation=panel(root,'create',[500,410,300,140],'Tạo Guild');const createBody=blueFrame(ui,creation,300,140);if(create){const note=create.querySelector('.m8-note');if(note)note.textContent='Dùng Thẻ Tạo Guild để lập Guild và đội của bạn.';createBody.append(create);}
    const welcome=panel(root,'welcome',[23,409,449,178],'Hướng dẫn Guild'),welcomeBody=blueFrame(ui,welcome,449,178,'LIGHT_BG');
    const welcomeText=element('div',null,'m43-guild-welcome-content');welcomeText.append(element('h3','Cùng đồng đội xây dựng Guild'),element('p','Tìm Guild phù hợp rồi gửi đơn xin gia nhập. Guild mở tự do sẽ tiếp nhận ngay khi bạn đủ điều kiện.'),element('p','Tên ngắn, tối đa 12 ký tự không dấu; chữ có dấu có thể dùng ít ký tự hơn.'));welcomeBody.append(welcomeText);
    rail.append(element('h3','Guild'),element('p','Tìm Guild, xin gia nhập hoặc tạo Guild của bạn.'));
    const search=ui.button('Tìm Guild',()=>content.querySelector('input')?.focus(),{testId:'guild-native-search',className:'m81-guild-nav'});
    const make=ui.button('Tạo Guild',()=>ui.openGuildCreation(false),{testId:'guild-native-create',className:'m81-guild-nav'});styleNavigation(search);styleNavigation(make,true);rail.append(search,make);
  } else {
    // Reuse the authoritative overview's upgrade/leave and donation handlers.
    // Temporary view selection is restored even when the renderer throws.
    const delegated=element('div'),tab=ui.guildTab;
    try {ui.guildTab='overview';ui.renderGuildLegacy(delegated);} finally {ui.guildTab=tab;}
    const info=panel(root,'info',GUILD_GEOMETRY.info,'Thông tin Guild');
    const columns=delegated.querySelector('.m8-account-columns');const overview=columns?.children[0],donation=columns?.children[1];nativeInfo(ui,info,account,overview);
    const donate=panel(root,'donation',[23,409,449,178],'Cống hiến Team'),donateBody=blueFrame(ui,donate,449,178,'LIGHT_BG');if(donation)donateBody.append(donation);
    const workspace=panel(root,'workspace',GUILD_GEOMETRY.members,'Nội dung Guild');
    const panels=new Map(),buttons=new Map();
    const char=ui.snapshot.meta?.character||{},member=ownGuildMember(account,Number(char.accountId||ui.identity));
    function show(key) {
      if(key==='skills'){ui.guildTab='skills';ui.afterRenderFocus='guild-skills-tab-'+(ui.fields.guildSkillsTab==='research'?'research':'learn');ui.render();return;}
      if(ui.guildTab!==key)workspace.scrollTop=0;
      ui.guildTab=key;
      const panelKey=key==='overview'?'members':key;
      for(const [id,node] of panels)node.hidden=id!==panelKey;
      for(const [id,node] of buttons){node.setAttribute('aria-selected',String(id===key));node.classList.toggle('is-active',id===key);styleNavigation(node,id===key);}
      if(panels.has(panelKey))return;
      const node=element('div',null,'m81-guild-tabpanel');node.setAttribute('role','tabpanel');node.setAttribute('aria-label',key==='skills'?'Kỹ năng':key==='manage'?'Quản lý':'Thành viên');workspace.append(node);panels.set(panelKey,node);
      if(key==='manage'){node.style.padding='0';ui.renderGuildManage(node,account);}
      else ui.renderGuildMembers(node,account);
    }
    rail.append(element('h3',account.guild.name),element('p',`Cấp ${numberText(account.guild.level)}`));rail.setAttribute('role','tablist');
    for(const [key,label] of [['overview','Thông tin'],['members','Thành viên'],['skills','Kỹ năng'],['manage','Quản lý']]) {
      const button=ui.button(label,()=>show(key),{testId:`guild-tab-${key}`,className:'m81-guild-nav'});button.setAttribute('role','tab');rail.append(button);buttons.set(key,button);
    }
    show(['overview','members','manage'].includes(tab)?tab:'overview');
    if(tab==='skills'){
      ui.guildTab='skills';for(const [key,button] of buttons){button.setAttribute('aria-selected',String(key==='skills'));button.classList.toggle('is-active',key==='skills');styleNavigation(button,key==='skills');}
      for(const node of [...root.children])node.inert=true;
      renderNativeGuildSkills(ui,root,account,member,{onClose:()=>{delete ui.fields.guildSkillPickerSlot;ui.guildTab='members';ui.afterRenderFocus='guild-tab-skills';ui.render();}});
    }
  }
  body.append(root);return root;
}
