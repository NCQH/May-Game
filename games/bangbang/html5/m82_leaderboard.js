/* Native public lists: RankModuleFactory CorpsRankProxy / TeamRankProxy,
 * guild_protocol.py ranked_list/detail/team_members. Rank page is zero-based
 * in the UI and one-based on these two HTTP routes; military rt11 stays zero.
 * Public rows are never sorted, scored or supplemented with private state. */
import {element,note,numberText} from './m8_ui_helpers.js';
import {createNativePanel} from './m81_native_panel.js';
import {nativeButton,panelArt} from './m84_character.js';
import {renderAccountPaging,ACCOUNT_PAGER_GEOMETRY} from './m81_account_paging.js';
import {renderLeaderboard as renderMilitaryLeaderboard} from './m81_profile.js';

export const LEADERBOARD_KINDS=Object.freeze([['ranked','Đấu rank'],['stars','Quân hàm'],['guild','Guild'],['team','Đội']]);
export function leaderboardRequest(kind='stars',page=0,season='current',identity='') {
  page=Math.max(0,Math.trunc(Number(page)||0));
  if(kind==='guild')return {route:'cGuildList.php',params:{p:page+1,li:10}};
  if(kind==='team')return {route:'cTeamServerList.php',params:{p:page+1,li:10,s:'level'}};
  return {route:'crankquery.php',params:{rt:kind==='ranked'?4:11,rd:0,p:page,limit:10,
    ...(kind==='ranked'?{season,char:identity}:{})}};
}
export function publicListRows(data){return Array.isArray(data?.datas)?data.datas:[];}
export function publicTeamMembers(data){return Array.isArray(data)?data:[];}
export async function loadLeaderboard(ui,force=false) {
  const kind=ui.rankKind||'stars',page=ui.rankPage||0,epoch=ui.epoch,identity=ui.snapshot.meta.character.charUuid||ui.identity,
    request=leaderboardRequest(kind,page,ui.rankSeason||'current',identity);
  const loading=ui.queryServer('leaderboard',request.route,request.params,force);
  if(kind==='stars'||kind==='ranked')ui.queryServer('ownRank','ccharrankquery.php',
    {rt:kind==='ranked'?4:11,char:identity,...(kind==='ranked'?{season:ui.rankSeason||'current'}:{})},force);
  await loading;
  if(ui.disposed||epoch!==ui.epoch||(ui.rankKind||'stars')!==kind||ui.rankPage!==page||ui.loading.has('leaderboard'))return;
  const amount=Number(ui.cache.leaderboard?.amount);
  if(Number.isFinite(amount)&&amount>=0){const last=Math.max(0,Math.ceil(amount/10)-1);if(page>last){ui.rankPage=last;await loadLeaderboard(ui);}}
}
function at(node,x,y,w,h){Object.assign(node.style,{position:'absolute',left:`${x}px`,top:`${y}px`,...(w==null?{}:{width:`${w}px`}),...(h==null?{}:{height:`${h}px`})});return node;}
function listAssets(ui){return {...ui.assets?.panels?.assets,...ui.assets?.ui?.assets};}
function openProfile(ui,ident){ui.confirmation=null;ui.profileIdentity=String(ident);ui.fields.profileIdentity=String(ident);delete ui.cache.profile;ui.setSection('profile');}
function rankTabs(ui,body) {
  const tabs=at(element('nav',null,'m8134-rank-tabs'),37,71,460,39);tabs.setAttribute('aria-label','Bảng xếp hạng');
  const art='zh_CN/gui_summer/controls/';
  for(const [index,[kind,label]] of LEADERBOARD_KINDS.entries()){
    const selected=(ui.rankKind||'stars')===kind;
    const skin=art+(kind==='stars'?`rank/btn_military${selected?'_select':''}_t.png`:`gameroom/sort_${selected?'selected':'bk'}.png`);
    const icon=kind==='stars'?null:art+(kind==='ranked'?`gameroom/icon_ladder_${selected?'selected':'unselect'}_t.png`:
      `rank/word_${kind==='guild'?'crops':'clangame'}${selected?'_selected':''}_t.png`);
    const button=nativeButton(ui,{skin,icon,label,x:index*115,y:0,width:109,height:39,testId:`rank-tab-${kind}`,
      onClick:()=>{
        if(ui.disposed||(ui.rankKind||'stars')===kind)return;
        ui.rankKind=kind;ui.rankPage=0;ui.rankPages=1;ui.rankSelected=null;ui.confirmation=null;
        ui.afterRenderFocus=`rank-tab-${kind}`;loadLeaderboard(ui);
      }});
    button.setAttribute('aria-pressed',String(selected));tabs.append(button);
  }
  body.append(tabs);
  body.append(at(ui.button('Làm mới',()=>loadLeaderboard(ui,true),{disabled:ui.loading.has('leaderboard'),testId:'rank-refresh'}),744,75,96,30));
}
export function openPublicGuild(ui,guildId) {
  if(ui.disposed||!Number.isSafeInteger(Number(guildId))||Number(guildId)<=0)return;
  ui.confirm('Thông tin Guild','',null,{kind:'rank-guild-info',guildId:Number(guildId)});
  ui.queryServer('rankGuildInfo','cGuildInfo.php',{gid:Number(guildId)},true);
}
export function openPublicTeam(ui,teamId,backGuildId=0) {
  if(ui.disposed||!Number.isSafeInteger(Number(teamId))||Number(teamId)<=0)return;
  ui.confirm('Thông tin đội','',null,{kind:'rank-team-info',teamId:Number(teamId),backGuildId});
  ui.queryServer('rankTeamInfo','cTeamInfo.php',{tid:Number(teamId)},true);
  ui.queryServer('rankTeamMembers','cTeamMember.php',{tid:Number(teamId)},true);
}
export function renderLeaderboard(ui,body) {
  const kind=ui.rankKind||'stars';
  if(kind==='stars'||kind==='ranked'){
    renderMilitaryLeaderboard(ui,body);
    // Keep the four supported categories on the original rank frame.
    for(const node of [...body.children])if(node.tagName==='BUTTON'&&node.textContent==='Quân hàm')node.remove();
    if(kind==='ranked'){
      const picker=at(element('select',null,'m813-season-picker'),515,73,207,29);
      picker.setAttribute('aria-label','Mùa xếp hạng');picker.dataset.testid='rank-season';
      for(const [value,text] of [['current','Mùa hiện tại'],['previous','Mùa trước']]){
        const option=element('option',text);option.value=value;option.selected=(ui.rankSeason||'current')===value;picker.append(option);
      }
      picker.addEventListener('change',()=>{ui.rankSeason=picker.value;ui.rankPage=0;ui.rankSelected=null;loadLeaderboard(ui,true);});body.append(picker);
    }
    rankTabs(ui,body);return;
  }
  body.classList.add('m81-leaderboard','m82-group-rank');
  body.append(panelArt(ui,'zh_CN/gui_summer/controls/rank/title_rank_t.png',371,1,null,null,{alt:'Bảng anh hùng'}));rankTabs(ui,body);
  const data=ui.cache.leaderboard,rows=publicListRows(data),loading=ui.loading.has('leaderboard');
  const frame=createNativePanel({assets:listAssets(ui),kind:'box4',width:788,height:318});body.append(at(frame.root,47,141));
  const table=at(element('div',null,`m82-rank-table m82-rank-table-${kind}`),47,119,788,340);table.setAttribute('role','table');table.setAttribute('aria-label',kind==='guild'?'Guild theo cấp':'Đội theo cấp');
  const labels=kind==='guild'?['Hạng','Guild','Cấp','Chủ Guild','Thành viên','Quỹ','']:['Hạng','Đội','Cấp','Đội trưởng','Guild',''];
  const header=element('div',null,'m82-rank-header');header.setAttribute('role','row');
  for(const label of labels){const cell=element('span',label);cell.setAttribute('role','columnheader');header.append(cell);}table.append(header);
  if(loading)table.append(note('Đang tải bảng xếp hạng…'));
  else if(data?.queryError)table.append(note(data.queryError,'error'));
  else if(!rows.length)table.append(note(kind==='guild'?'Chưa có Guild.':'Chưa có đội.'));
  else for(const row of rows){
    const line=element('div',null,'m82-rank-entry');line.setAttribute('role','row');
    const values=kind==='guild'?[row.rank,row.guild_name,row.guild_level,row.guild_leader,`${numberText(row.guild_number)}/${numberText(row.guild_maxnum)}`,numberText(row.guild_coin)]:[row.rank,row.team_name,row.team_level,row.team_leader,row.guild_name];
    for(const value of values){const cell=element('span',value??'—');cell.setAttribute('role','cell');cell.title=String(value??'—');line.append(cell);}
    const ident=kind==='guild'?row.guild_id:row.team_id;
    const view=ui.button('Xem',()=>kind==='guild'?openPublicGuild(ui,ident):openPublicTeam(ui,ident),{testId:`rank-${kind}-${ident}`});view.setAttribute('aria-label',`Xem ${kind==='guild'?'Guild':'đội'} ${kind==='guild'?row.guild_name:row.team_name}`);line.append(view);table.append(line);
  }
  body.append(table);
  if(data?.amount!=null)ui.rankPages=Math.max(1,Math.ceil(Number(data.amount)/10));
  ui.accountPagerStates ||= {};ui.accountPagerRoots ||= [];
  const pager=renderAccountPaging({host:body,assets:ui.assets.panels.assets,kind:'rank',page:ui.rankPage||0,pages:ui.rankPages||1,state:ui.accountPagerStates.rank||={},onChange:page=>{
    if(ui.loading.has('leaderboard'))return;ui.rankPage=page;loadLeaderboard(ui);
  }});
  for(const button of pager.querySelectorAll('button')){if(button.dataset.testid==='rank-page-previous')button.dataset.testid='rank-prev';if(button.dataset.testid==='rank-page-next')button.dataset.testid='rank-next';if(loading)button.disabled=true;}
  ui.accountPagerRoots.push(pager);body.append(at(pager,ACCOUNT_PAGER_GEOMETRY.rank.x,ACCOUNT_PAGER_GEOMETRY.rank.y),at(note(kind==='guild'?'Xếp theo cấp Guild.':'Xếp theo cấp đội.'),47,476,470,28));
}
function modal(ui,value,{width=458,height=508,label}) {
  const epoch=ui.epoch,generation=ui.client?.generation,identity=ui.identity;
  const current=()=>!ui.disposed&&epoch===ui.epoch&&generation===ui.client?.generation&&identity===ui.identity&&ui.confirmation===value;
  const close=()=>{if(current()){ui.confirmation=null;ui.render();}};
  const overlay=element('div',null,'m8-account-modal m82-public-rank-modal');
  const panel=createNativePanel({assets:listAssets(ui),width,height,state:'CONFIRM',close:{asset:'public.close',x:width-39,y:15,label:'Đóng '+label},onClose:close});
  panel.root.setAttribute('role','dialog');panel.root.setAttribute('aria-modal','true');panel.root.setAttribute('aria-label',label);panel.root.dataset.nativeScreen=value.kind;
  panel.close.dataset.testid='account-confirm-cancel';panel.close.dataset.accountField='rank-detail-close';
  const heading=at(element('h3',label),70,20,width-140,25);heading.className='m82-rank-detail-title';panel.content.append(heading);
  const inner=createNativePanel({assets:listAssets(ui),width:width-40,height:height-124,kind:'box3',state:'SHADOW'});panel.content.append(at(inner.root,20,54));
  const content=at(element('div',null,'m82-rank-detail-content'),36,66,width-72,height-148);panel.content.append(content);
  const actions=at(element('div',null,'m82-rank-detail-actions'),20,height-52,width-40,35);
  const dismiss=ui.button('Đóng',close,{testId:'account-confirm'});dismiss.dataset.accountField='rank-detail-dismiss';actions.append(dismiss);panel.content.append(actions);
  overlay.addEventListener('keydown',event=>{
    event.stopPropagation();if(event.key==='Escape'){event.preventDefault();close();}
    if(event.key==='Tab'){
      const nodes=[...panel.root.querySelectorAll('button,input,[tabindex="0"]')].filter(node=>!node.disabled&&!node.hidden);
      if(nodes.length){event.preventDefault();const index=nodes.indexOf(document.activeElement);nodes[(index+(event.shiftKey?-1:1)+nodes.length)%nodes.length].focus({preventScroll:true});}
    }
  });
  overlay.append(panel.root);overlay.initialFocus=panel.close;return {overlay,content,actions,heading,current};
}
function metric(host,label,value){const line=element('div',null,'m82-rank-detail-metric');line.append(element('span',label),element('strong',value??'—'));host.append(line);}
export function renderPublicRankDetail(ui,value) {
  if(value.kind==='rank-guild-info'){
    const view=modal(ui,value,{label:'Thông tin Guild'}),data=ui.cache.rankGuildInfo;
    if(ui.loading.has('rankGuildInfo'))view.content.append(note('Đang tải Guild…'));
    else if(data?.queryError||Number(data?.nGuildId)!==value.guildId)view.content.append(note(data?.queryError||'Guild không còn trong danh sách.','error'));
    else {
      view.heading.textContent=data.szGuildName||'Thông tin Guild';metric(view.content,'Chủ Guild',data.szGuildLeader);metric(view.content,'Cấp Guild',numberText(data.nGuildLv));metric(view.content,'Thành viên',numberText(data.nGuildNumMember));
      view.content.append(element('h4','Các đội'));
      const list=element('div',null,'m82-public-team-list');list.tabIndex=0;list.dataset.accountField='rank-guild-teams';list.setAttribute('aria-label','Các đội trong Guild');
      for(const team of data.allTeams||[]){const row=element('div',null,'m82-public-team');row.append(element('strong',team.szTeamName),element('span',`${team.szTeamLeader||'—'} · ${numberText(team.nTeamNumMember)} thành viên`),ui.button('Xem',()=>{if(view.current())openPublicTeam(ui,team.nTeamId,value.guildId);},{testId:`rank-guild-team-${team.nTeamId}`}));list.append(row);}
      if(!data.allTeams?.length)list.append(note('Chưa có đội.'));view.content.append(list);
    }
    return view.overlay;
  }
  const view=modal(ui,value,{label:'Thông tin đội'}),data=ui.cache.rankTeamInfo,members=ui.cache.rankTeamMembers;
  if(value.backGuildId)view.actions.prepend(ui.button('Về Guild',()=>{if(view.current())openPublicGuild(ui,value.backGuildId);},{testId:'rank-team-back'}));
  if(ui.loading.has('rankTeamInfo'))view.content.append(note('Đang tải đội…'));
  else if(data?.queryError||Number(data?.team_id)!==value.teamId)view.content.append(note(data?.queryError||'Đội không còn trong danh sách.','error'));
  else {
    view.heading.textContent=data.team_name||'Thông tin đội';
    const fields=element('div',null,'m82-public-team-fields');
    for(const [label,key] of [['Guild','guild_name'],['Đội trưởng','team_leader'],['Cấp đội','team_level'],['Quỹ','team_coin'],['Uy vọng','team_glory'],['Cống hiến','team_merit']])metric(fields,label,typeof data[key]==='number'?numberText(data[key]):data[key]);view.content.append(fields);
    view.content.append(element('h4','Thành viên'));
    const list=element('div',null,'m82-public-member-list');list.tabIndex=0;list.dataset.accountField='rank-team-members';list.setAttribute('aria-label','Thành viên đội');
    if(ui.loading.has('rankTeamMembers'))list.append(note('Đang tải thành viên…'));
    else if(members?.queryError)list.append(note(members.queryError,'error'));
    else if(!publicTeamMembers(members).length)list.append(note('Chưa có thành viên.'));
    else for(const member of publicTeamMembers(members)){
      const row=element('div',null,'m82-public-member');row.append(element('strong',member.char_name),element('span',`Cấp ${numberText(member.char_level)} · ${member.team_post===5?'Đội trưởng':'Thành viên'}`),element('span',`${numberText(member.team_merit)} cống hiến`));
      const inspect=ui.button('Hồ sơ',()=>{if(view.current())openProfile(ui,member.char_oid||member.char_uuid);},{testId:`rank-member-${member.char_oid}`});inspect.dataset.accountField=`rank-member-${member.char_oid}`;row.append(inspect);list.append(row);
    }
    view.content.append(list);
  }
  return view.overlay;
}
