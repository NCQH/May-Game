/* Read-only ClanMemberListFrame (489×320), MyCorpsListItemRenderer and
 * ClanMemberListAllianceRender (461×32), guild_20261015 decompile.
 * CorpsModel.formateTeamInfo: own team first. sortTeamMateRule depends on
 * unresolved runtime useNewCorps; retain packet order, never invent ladder/week.
 * No protocol actions here: host callbacks own all member/team operations. */
import {element,assetImage,numberText} from './m8_ui_helpers.js';
import {createNativePanel} from './m81_native_panel.js';
export const GUILD_MEMBER_GEOMETRY=Object.freeze({width:489,height:320,frame:[0,20,489,296],tree:[4,24,480,288],row:[461,32],name:[61,7,140],post:[201,5,60],contribution:[261,5,100],online:[361,5,74],setting:[435,5,22,22]});
function at(n,x,y,w,h){Object.assign(n.style,{position:'absolute',left:`${x}px`,top:`${y}px`,...(w==null?{}:{width:`${w}px`}),...(h==null?{}:{height:`${h}px`})});return n;}
const known=v=>v!=null&&Number.isFinite(Number(v));
export function guildMemberRole(account,team,member){const g=account.guild||{};return member.charUuid===g.leaderUuid?'Chủ hội':member.charUuid===g.viceLeaderUuid?'Phó hội':member.charUuid===team.leaderUuid?'Đội trưởng':'Thành viên';}
export function guildMemberTeams(account){const teams=[...(account.teams||[])],index=teams.findIndex(t=>t.teamId===account.selfTeamId);if(index>0)teams.unshift(...teams.splice(index,1));return teams;}
export function guildMemberRows(account,team){return [...(account.members?.[team.teamId]||[])];}
export function renderNativeGuildMembers(ui,body,account,{onMember,onTeam}={}){
 const assets=ui.assets?.panels?.assets||{},teams=guildMemberTeams(account),guildId=account.guild?.guildId;
 if(!ui.guildMemberView||ui.guildMemberView.guildId!==guildId)ui.guildMemberView={guildId,collapsed:{},selected:'',focus:'',scrollTop:0};
 const state=ui.guildMemberView,root=at(element('section',null,'m81-guild-member-list'),0,0,489,320),focusNodes=new Map();
 root.setAttribute('aria-label','Thành viên Guild');root.dataset.nativeScreen='guild-members';
 Object.assign(root.style,{font:'bold 13px Arial,sans-serif',color:'#fff',textShadow:'0 1px 1px #06456c'});
 function art(host,key,x,y,w,h,alt=''){const a=assets[`guild.members.${key}`];if(!a)return null;const n=at(assetImage(a,alt),x,y,w??a.width,h??a.height);n.style.pointerEvents='none';host.append(n);return n;}
 if(assets['box.listbk_bg']){const frame=createNativePanel({assets,kind:'box4',width:489,height:296});root.append(at(frame.root,0,20));}
 const headers=[['level',-211,'LV'],['name',-111,'Nick người chơi'],['post',-11,'Chức vụ'],['contribution',69,'Độ cống hiến'],['online',167,'T/G online']];
 for(const [key,offset,label] of headers){const a=assets[`guild.members.${key}`];if(!art(root,key,244.5+offset-(a?.width||60)/2,1,undefined,undefined,label))root.append(at(element('span',label),244.5+offset-30,1,60,18));}
 art(root,'dark',64,24,140,288);art(root,'dark',264,24,100,288);
 const tree=at(element('div',null,'m81-guild-member-tree'),4,24,480,288);tree.setAttribute('role','tree');tree.setAttribute('aria-label','Đội và thành viên');Object.assign(tree.style,{overflowY:'scroll',overflowX:'hidden'});root.append(tree);
 tree.addEventListener('scroll',()=>{state.scrollTop=tree.scrollTop;});
 function label(row,text,x,y,w){const n=at(element('span',text),x,y,w,23);Object.assign(n.style,{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',lineHeight:'23px',textAlign:x===61?'left':'center'});n.title=String(text);row.append(n);return n;}
 function focusable(node,id){node.dataset.testid=id;focusNodes.set(id,node);node.addEventListener('focus',()=>{state.focus=id;});}
 function button(row,id,text,x,y,w,h,key,click){const n=ui.button(text,click,{testId:id});at(n,x,y,w,h);Object.assign(n.style,{padding:'0',margin:'0',minWidth:'0',minHeight:'0',border:'0',background:'transparent',boxShadow:'none',color:'inherit'});n.setAttribute('aria-label',text);if(assets[`guild.members.${key}`]){n.textContent='';art(n,key,0,0,w,h);}focusable(n,id);row.append(n);return n;}
 const memberIds=new Set(Object.values(account.members||{}).flat().map(m=>m.charUuid));if(state.selected&&!memberIds.has(state.selected))state.selected='';
 teams.forEach((team,index)=>{
  const id=String(team.teamId);if(!Object.hasOwn(state.collapsed,id))state.collapsed[id]=index!==0;
  const group=element('div'),row=at(element('div',null,'m81-guild-team-row'),0,0,461,32);row.style.position='relative';row.style.backgroundColor='#0081c3';group.append(row);tree.append(group);
  const members=guildMemberRows(account,team),children=element('div');children.setAttribute('role','group');children.hidden=!!state.collapsed[id];group.append(children);
  row.setAttribute('role','treeitem');row.setAttribute('aria-expanded',String(!children.hidden));
  const toggle=button(row,`guild-team-toggle-${id}`,`Đội ${team.name}`,0,7,18,18,state.collapsed[id]?'closed':'open',()=>{state.collapsed[id]=!state.collapsed[id];children.hidden=state.collapsed[id];row.setAttribute('aria-expanded',String(!children.hidden));toggle.setAttribute('aria-expanded',String(!children.hidden));toggle.replaceChildren();art(toggle,state.collapsed[id]?'closed':'open',0,0,18,18);});toggle.setAttribute('aria-expanded',String(!children.hidden));
  label(row,known(team.level)?`Lv.${team.level}`:'—',22,5,60);
  label(row,`${team.name??''} (${Array.isArray(account.members?.[id])?members.length:'—'})`,82,5,240);
  if(onTeam)button(row,`guild-team-view-${id}`,'Quan sát đội',403,3,56,26,'view',()=>onTeam(team));
  art(row,'cutline',0,30,461,2);
  for(const member of members){const buddy=account.buddies?.[member.accountId],mrow=at(element('div',null,'m81-guild-member-row'),0,0,461,32);mrow.style.position='relative';mrow.setAttribute('role','treeitem');mrow.setAttribute('aria-selected',String(state.selected===member.charUuid));children.append(mrow);
   label(mrow,known(buddy?.level)?buddy.level:'—',8,6,45);
   label(mrow,buddy?.name??member.charUuid,61,7,140);label(mrow,guildMemberRole(account,team,member),201,5,60);
   label(mrow,`${member.merit==null?'—':numberText(member.merit)}/${member.allMerit==null?'—':numberText(member.allMerit)}`,261,5,100);
   label(mrow,buddy?.online==null?'—':buddy.online?'Online':'Offline',361,5,74);
   const uuid=ui.snapshot?.meta?.character?.charUuid,officer=!!uuid&&[account.guild?.leaderUuid,account.guild?.viceLeaderUuid].includes(uuid);
   if(onMember&&(officer||uuid!==member.charUuid))button(mrow,`guild-member-op-${member.accountId}`,'Thao tác thành viên',435,5,22,22,'setting',()=>{state.selected=member.charUuid;for(const n of tree.querySelectorAll('.m81-guild-member-row'))n.setAttribute('aria-selected','false');mrow.setAttribute('aria-selected','true');onMember(member,team);});
   art(mrow,'cutline',0,30,461,2);
  }
 });
 body.append(root);tree.scrollTop=state.scrollTop;
 // Call after attachment. Do not steal focus from an intervening action overlay.
 root.restoreFocus=()=>{tree.scrollTop=state.scrollTop;const active=document.activeElement;if(active&&active!==document.body&&active.isConnected&&!root.contains(active))return;const node=focusNodes.get(state.focus);if(node&&!node.closest?.('[hidden]'))node.focus?.({preventScroll:true});};
 return root;
}
