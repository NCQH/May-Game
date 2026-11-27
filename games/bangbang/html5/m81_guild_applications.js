/* ClanApplyListFrame MANAGE / ClanApplyItemRenderer, guild_20261015.
 * The host embeds the list region with native origin (28,124); the 520×528
 * modal, tabs, recruitment and bulk actions remain outside this presentation.
 * CorpsModel.applyList returns map values: no native sort or paging controls.
 * Preserve packet order. The protocol does not expose a ladder label, so use —.
 * Receiving-team selector below the list is the existing HTML5 action adapter,
 * not a claimed native widget. All mutation/revision/permission guards stay host-owned. */
import {element,assetImage,selectInput} from './m8_ui_helpers.js';
import {createNativePanel} from './m81_native_panel.js';
export const GUILD_APPLICATION_GEOMETRY=Object.freeze({width:489,height:350,origin:[28,124],frame:[0,19,400,280,1.18],list:[5,26,463,270],row:[463,32],name:[71,7,90],ladder:[192,7,60],inviter:[260,7,60],approve:[327,3],reject:[390,3],view:[163,5]});
function at(n,x,y,w,h){Object.assign(n.style,{position:'absolute',left:`${x}px`,top:`${y}px`,...(w==null?{}:{width:`${w}px`}),...(h==null?{}:{height:`${h}px`})});return n;}
export function guildApplicationRows(account){return [...(account.applications||[])];}
export function renderGuildApplications(ui,body,account,{onApprove,onReject,onView}={}){
 const assets=ui.assets?.panels?.assets||{},guildId=account.guild?.guildId,rows=guildApplicationRows(account),fields=ui.fields ||= {};
 if(!ui.guildApplicationView||ui.guildApplicationView.guildId!==guildId)ui.guildApplicationView={guildId,selected:'',focus:'',scrollTop:0};
 const state=ui.guildApplicationView,focusNodes=new Map(),root=at(element('section',null,'m81-guild-applications'),0,0,489,350);root.style.position='relative';root.dataset.nativeScreen='guild-applications';root.setAttribute('aria-label','Đơn xin gia nhập');
 Object.assign(root.style,{font:'bold 12px "Microsoft YaHei",Tahoma,sans-serif',color:'#fff'});
 function art(host,key,x,y,w,h,alt=''){const a=assets[`guild.applications.${key}`];if(!a)return null;const n=at(assetImage(a,alt),x,y,w??a.width,h??a.height);n.style.pointerEvents='none';host.append(n);return n;}
 if(assets['box.listbk_bg']){const frame=createNativePanel({assets,kind:'box4',width:400,height:280});at(frame.root,0,19);Object.assign(frame.root.style,{transform:'scaleX(1.18)',transformOrigin:'0 0'});root.append(frame.root);}
 for(const [key,center,label] of [['level',48,'Cấp'],['name',122,'Nick người chơi'],['ladder',226,'Xếp hạng'],['inviter',295,'Người mời']]){const a=assets[`guild.applications.${key}`];if(!art(root,key,center-(a?.width||60)/2,0,undefined,undefined,label)){const n=at(element('span',label),center-30,0,60,20);n.style.textAlign='center';root.append(n);}}
 const list=at(element('div',null,'m81-guild-application-list'),5,26,463,270);Object.assign(list.style,{overflowY:'scroll',overflowX:'hidden'});list.setAttribute('role','list');list.setAttribute('aria-label','Danh sách đơn xin gia nhập');list.addEventListener('scroll',()=>{state.scrollTop=list.scrollTop;});root.append(list);
 const key=`gm-applications-team-${guildId}`,teams=account.teams||[],saved=fields[key],teamId=teams.find(t=>String(t.teamId)===String(saved))?.teamId??teams.find(t=>t.teamId===account.selfTeamId)?.teamId??teams[0]?.teamId;
 const team=selectInput(teams.map(t=>({value:t.teamId,label:t.name})),teamId,'Đội tiếp nhận');team.dataset.accountField=key;team.dataset.testid='guild-applications-team';team.disabled=!ui.canMutate?.()||!teams.length;
 function remember(node,id){focusNodes.set(id,node);node.addEventListener('focus',()=>{state.focus=id;});}
 remember(team,'guild-applications-team');team.addEventListener('change',()=>{fields[key]=team.value;});root.append(at(element('span','Đội tiếp nhận'),5,313,108,25),at(team,115,307,349,30));
 if(state.selected&&!rows.some(a=>a.charUuid===state.selected))state.selected='';
 const rowNodes=[];
 function label(row,text,x,y,w){const n=at(element('span',text),x,y,w,18);Object.assign(n.style,{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',textAlign:'center',lineHeight:'18px'});n.title=String(text);row.append(n);}
 function button(row,a,action,text,x,y,w,h,callback){if(!callback)return;const id=`guild-application-${action}-${a.charUuid}`,b=ui.button(text,()=>{if(b.disabled)return;state.selected=a.charUuid;for(const [n,id] of rowNodes)n.setAttribute('aria-selected',String(id===state.selected));callback(a,Number(team.value));},{testId:id,disabled:action!=='view'&&(!ui.canMutate?.()||(action==='approve'&&!teams.length))});at(b,x,y,w,h);b.setAttribute('aria-label',`${text}: ${a.name??a.charUuid}`);Object.assign(b.style,{padding:'0',margin:'0',minWidth:'0',minHeight:'0',border:'0',background:'transparent',boxShadow:'none',color:'inherit',font:'inherit'});if(assets[`guild.applications.${action}`]){b.textContent='';art(b,action,0,0,w,h);}remember(b,id);row.append(b);}
 for(const a of rows){const row=at(element('div',null,'m81-guild-application-row'),0,0,463,32);row.style.position='relative';row.setAttribute('role','listitem');row.setAttribute('aria-selected',String(state.selected===a.charUuid));rowNodes.push([row,a.charUuid]);list.append(row);
  label(row,a.level==null?'—':a.level,21,7,45);label(row,a.name??a.charUuid,71,7,90);label(row,'—',192,7,60);label(row,account.inviters?.find(i=>i.accountId===a.accountId)?.inviter||'—',260,7,60);
  button(row,a,'view','Quan sát',163,5,22,22,onView);button(row,a,'approve','Chấp nhận',327,3,58,26,onApprove);button(row,a,'reject','Từ chối',390,3,58,26,onReject);
  const cut=assets['guild.members.cutline'];if(cut)row.append(at(assetImage(cut),0,30,445,2));
 }
 if(!rows.length){const empty=at(element('p','Chưa có đơn xin vào.'),10,10,420,24);empty.setAttribute('role','status');list.append(empty);}
 body.append(root);list.scrollTop=state.scrollTop;
 root.restoreFocus=()=>{list.scrollTop=state.scrollTop;const active=document.activeElement;if(active&&active!==document.body&&active.isConnected&&!root.contains(active))return;const n=focusNodes.get(state.focus);if(n&&!n.disabled)n.focus?.({preventScroll:true});};
 return root;
}
