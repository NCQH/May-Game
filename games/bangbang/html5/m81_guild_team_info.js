/* Read-only TeamInfoFrame/ClanMemberRender, guild_20261015 native source.
 * The host owns snapshots and all mutations. Missing ladder/maintenance data
 * stays unavailable; no HTTP request, dungeon, reward or renamed-team action. */
import {element,assetImage,numberText} from './m8_ui_helpers.js';
import {createNativePanel} from './m81_native_panel.js';
import {guildMemberRole} from './m81_guild_members.js';
export const GUILD_TEAM_INFO_GEOMETRY=Object.freeze({width:458,height:508,inner:[20,54,418,384],list:[44,212,332,121],row:[314,30]});
const contexts=new WeakMap();
const numeric=v=>v==null?'—':numberText(v);
function at(n,x,y,w,h){Object.assign(n.style,{position:'absolute',left:`${x}px`,top:`${y}px`,...(w==null?{}:{width:`${w}px`}),...(h==null?{}:{height:`${h}px`})});return n;}
export function guildTeamInfoModel(account,teamId){
 const team=account?.guild&&(account.teams||[]).find(t=>t.teamId===teamId&&(t.guildId==null||t.guildId===account.guild.guildId));
 if(!team)return null;
 const members=account.members?.[teamId],leaderMember=(members||[]).find(m=>m.charUuid===team.leaderUuid);
 const leader=Object.values(account.buddies||{}).find(b=>b.charUuid===team.leaderUuid)||account.buddies?.[leaderMember?.accountId];
 return {team,leader:leader?.name??'—',members:Array.isArray(members)?members:null};
}
export function renderGuildTeamInfo(ui,value){
 const epoch=ui.epoch,generation=ui.client?.generation,identity=ui.identity,account=ui.snapshot?.account;
 if(!contexts.has(value))contexts.set(value,{identity,generation,guildId:account?.guild?.guildId,scrollTop:0});
 const context=contexts.get(value),same=context.identity===identity&&context.generation===generation&&context.guildId===account?.guild?.guildId;
 const model=same?guildTeamInfoModel(account,value.teamId):null;
 const current=()=>!ui.disposed&&ui.epoch===epoch&&ui.client?.generation===generation&&ui.identity===identity&&ui.confirmation===value;
 const close=()=>{if(current()){ui.confirmation=null;ui.render();}};
 const assets={...ui.assets?.panels?.assets,...ui.assets?.ui?.assets},overlay=element('div',null,'m8-account-modal');
 const panel=createNativePanel({assets,width:458,height:508,state:'CONFIRM',close:{asset:'public.close',x:419,y:15,label:'Đóng thông tin đội'},onClose:close});
 panel.close.dataset.testid='account-confirm-cancel';panel.close.dataset.accountField=`team-info-close-${value.teamId}`;panel.root.dataset.nativeScreen='guild-team-info';panel.root.setAttribute('role','dialog');panel.root.setAttribute('aria-modal','true');panel.root.setAttribute('aria-label','Thông tin đội');
 Object.assign(panel.content.style,{font:'bold 13px Tahoma,sans-serif',color:'#fff'});
 function text(host,value,x,y,w,h=24,id){const n=at(element('div',value),x,y,w,h);Object.assign(n.style,{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',lineHeight:`${h}px`});n.title=String(value);if(id)n.dataset.testid=id;host.append(n);return n;}
 function art(host,key,x,y,label){const a=assets[`team.${key}`];if(!a)return null;const n=at(assetImage(a,label),x,y,a.width,a.height);n.style.pointerEvents='none';host.append(n);return n;}
 text(panel.content,model?.team.name??'Thông tin đội',144,19,170,25).style.textAlign='center';
 const inner=createNativePanel({assets,width:418,height:384,kind:'box3',state:'SHADOW'});panel.content.append(at(inner.root,20,54));
 const body=inner.content;
 if(!model){const unavailable=text(body,'Thông tin đội không còn khả dụng.',22,130,374,40,'guild-team-unavailable');unavailable.setAttribute('role','status');}
 else {
  const {team,members}=model;
  for(const [key,label,x,y] of [['name','Tên đội',50,22],['leader','Đội trưởng',50,56],['glory','Uy vọng',221,91],['merit','Cống hiến',221,124],['level','Cấp đội',50,91],['fund','Quỹ đội',50,124]])if(!art(body,key,x,y,label))text(body,label,x,y,62,20);
  text(body,'Duy trì',50,157,62,20);
  function field(key,label,value,x,y,w){art(body,w===264?'inputLong':'inputShort',x,y,'');const n=text(body,value,x+10,y+5,w-20,22,`guild-team-${key}`);n.setAttribute('aria-label',`${label}: ${value}`);if(w===94)n.style.textAlign='center';}
  field('name','Tên đội',team.name??'—',112,17,264);field('leader','Đội trưởng',model.leader,112,51,264);
  field('level','Cấp đội',numeric(team.level),112,84,94);field('fund','Quỹ đội',numeric(team.coin),112,117,94);
  field('glory','Uy vọng',numeric(team.glory),281,84,94);field('merit','Cống hiến',numeric(team.merit),281,117,94);
  field('maintenance','Phí duy trì chưa có dữ liệu','—',112,150,94);
  text(body,'Chưa có dữ liệu phí duy trì',213,153,184,22).style.fontSize='11px';
  text(body,'Thành viên',50,189,136,22);text(body,'Điểm',186,189,70,22);text(body,'C.hiến',256,189,50,22);text(body,'Chức vụ',306,189,70,22);
  art(body,'list',42,211,'');const list=at(element('div',null,'m81-team-info-list'),44,212,332,121);list.setAttribute('role','list');list.setAttribute('aria-label','Thành viên đội');Object.assign(list.style,{overflowY:'scroll',overflowX:'hidden'});list.tabIndex=0;list.dataset.accountField=`team-info-list-${value.teamId}`;body.append(list);list.addEventListener('scroll',()=>{if(current())context.scrollTop=list.scrollTop;});
  if(members===null)text(list,'Chưa có dữ liệu thành viên',8,0,306,30);
  else if(!members.length)text(list,'Chưa có thành viên',8,0,306,30);
  else for(const member of members){const buddy=account.buddies?.[member.accountId],row=at(element('div',null,'m81-team-info-member'),0,0,314,30);row.style.position='relative';row.setAttribute('role','listitem');list.append(row);text(row,numeric(buddy?.level),5,0,39,30);text(row,buddy?.name??member.charUuid,44,0,100,30);text(row,'—',142,0,70,30).style.textAlign='center';text(row,numeric(member.merit),212,0,50,30).style.textAlign='center';text(row,guildMemberRole(account,team,member),262,0,50,30);}
  list.scrollTop=context.scrollTop;
  // The host calls this after attachment; detached DOM has no scroll layout.
  overlay.restoreScroll=()=>{if(current())list.scrollTop=context.scrollTop;};
 }
 const confirm=ui.button('Đóng',close,{testId:'account-confirm'});confirm.dataset.accountField=`team-info-confirm-${value.teamId}`;confirm.setAttribute('aria-label','Đóng thông tin đội');Object.assign(confirm.style,{border:'none',padding:'0',background:assets['dialog.green']?`url("${assets['dialog.green'].url}") no-repeat`:'',color:'#fff'});panel.content.append(at(confirm,169,456,120,35));
 overlay.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Tab'){e.preventDefault();const nodes=[panel.close,...(model?[body.querySelector?.('.m81-team-info-list')].filter(Boolean):[]),confirm],i=nodes.indexOf(document.activeElement);nodes[(i+(e.shiftKey?-1:1)+nodes.length)%nodes.length]?.focus();}});
 overlay.append(panel.root);overlay.initialFocus=panel.close;return overlay;
}
