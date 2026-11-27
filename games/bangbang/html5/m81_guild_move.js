/* TeamChooseJoinView → ClanChooseJoinFrame / TeamExchangeView → ClanExchangeFrame.
 * Source guild_20261015; native C668 remains host-owned. No member/wallet edits.
 * creationState({stage,teamId,otherUuid}) supplies live validated choices; task
 * rechecks the original member/team/context immediately before native mutation.
 */
import {element,assetImage,numberText} from './m8_ui_helpers.js';
import {createNativePanel} from './m81_native_panel.js';
export const GUILD_MOVE_GEOMETRY=Object.freeze({choose:{width:468,height:368,list:[19,83,429,220],frame:[15.5,79,437,228]},exchange:{width:398,height:326,list:[21,78,356,180],frame:[17,74,364,188]}});
const renders=new WeakMap();
function at(n,x,y,w,h){Object.assign(n.style,{position:'absolute',left:`${x}px`,top:`${y}px`,...(w==null?{}:{width:`${w}px`}),...(h==null?{}:{height:`${h}px`})});return n;}
export function renderGuildMove(ui,value){
 if(value.kind!=='guild-move')throw new Error('Unsupported Guild move dialog');
 const epoch=ui.epoch,identity=ui.identity,generation=ui.client?.generation,token={};renders.set(value,token);
 const draft=value.moveDraft||(value.moveDraft={stage:'choose',teamId:0,otherUuid:'',scroll:{choose:0,exchange:0},focus:''});
 const current=()=>!ui.disposed&&ui.epoch===epoch&&ui.identity===identity&&ui.client?.generation===generation&&ui.confirmation===value&&renders.get(value)===token;
 let submitted=false;
 const active=()=>current()&&!submitted&&!ui.pending&&ui.canMutate();
 const input=()=>({stage:draft.stage,teamId:draft.teamId,otherUuid:draft.otherUuid});
 const state=()=>value.creationState(input());
 let s=state();
 if(!draft.initialized){draft.initialized=true;draft.teamId=s.teams?.[0]?.teamId||0;s=state();}
 if(draft.stage==='exchange'&&!draft.exchangeInitialized){draft.exchangeInitialized=true;draft.otherUuid=s.members?.[0]?.charUuid||'';s=state();}
 const exchange=draft.stage==='exchange',g=GUILD_MOVE_GEOMETRY[exchange?'exchange':'choose'];
 const assets={...ui.assets?.panels?.assets,...ui.assets?.ui?.assets},overlay=element('div',null,'m8-account-modal');
 const close=()=>{if(!current()||submitted||ui.pending)return;ui.confirmation=null;ui.render();};
 const panel=createNativePanel({assets,width:g.width,height:g.height,state:'CONFIRM',close:{asset:'public.close',x:g.width-39,y:15,label:'Hủy chuyển đội'},onClose:close}),host=panel.content;
 panel.root.dataset.nativeScreen=exchange?'guild-exchange':'guild-move';panel.root.setAttribute('role','dialog');panel.root.setAttribute('aria-modal','true');panel.root.setAttribute('aria-label',exchange?'Chọn thành viên đổi chỗ':'Chọn đội chuyển đến');
 Object.assign(host.style,{font:'bold 12px Tahoma,sans-serif',color:'#fff'});
 const controls=[panel.close];panel.close.dataset.testid='account-confirm-cancel';
 function remember(n,key){n.dataset.accountField=`guild-move-${key}`;n.addEventListener('focus',()=>{if(current())draft.focus=key;});return n;}
 remember(panel.close,'close');
 function text(parent,value,x,y,w,h=24){const n=at(element('div',value??'—'),x,y,w,h);Object.assign(n.style,{lineHeight:`${h}px`,overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis',textAlign:'center'});parent.append(n);return n;}
 function art(key,label,x,y,w){const a=assets[key];if(a){const n=at(assetImage(a,label),x+(w-a.width)/2,y,a.width,a.height);n.style.pointerEvents='none';host.append(n);}else text(host,label,x,y,w,20);}
 art(exchange?'move.exchangeTitle':'move.chooseTitle',exchange?'Chọn người đổi chỗ':'Chọn đội',40,exchange?17:20,g.width-80);
 if(exchange){art('guild.members.level','Cấp',35,55,48);art('guild.members.name','Tên',120,55,160);art('move.gender','Giới tính',289,56,65);}
 else {art('move.level','Cấp',19,59,50);art('move.name','Tên đội',63,59,120);art('move.leader','Đội trưởng',183,59,120);art('move.count','Số người',293,59,50);}
 const frame=createNativePanel({assets,width:g.frame[2],height:g.frame[3],kind:'box4'});host.append(at(frame.root,g.frame[0],g.frame[1]));
 const list=at(element('div'),...g.list);Object.assign(list.style,{overflowY:'scroll',overflowX:'hidden'});list.setAttribute('role','listbox');list.setAttribute('aria-label',exchange?'Thành viên đổi chỗ':'Đội đích');list.tabIndex=0;remember(list,'list');controls.push(list);host.append(list);
 list.addEventListener('scroll',()=>{if(current())draft.scroll[draft.stage]=list.scrollTop;});
 const rows=exchange?s.members||[]:s.teams||[],rowNodes=[];
 const selected=()=>exchange?draft.otherUuid:draft.teamId;
 const rowId=r=>exchange?r.charUuid:r.teamId;
 function choose(row){if(!active())return;const fresh=state(),available=exchange?fresh.members:fresh.teams;if(!(available||[]).some(r=>rowId(r)===rowId(row)))return;if(exchange)draft.otherUuid=row.charUuid;else {draft.teamId=row.teamId;draft.otherUuid='';draft.exchangeInitialized=false;}refresh();}
 for(const row of rows){const id=rowId(row),n=ui.button('',()=>choose(row),{testId:`guild-move-choice-${id}`});remember(n,`row-${id}`);n.setAttribute('role','option');n.setAttribute('aria-label',String(row.name??id));Object.assign(n.style,{position:'relative',display:'block',width:exchange?'330px':'400px',height:'32px',border:'none',padding:'0',background:'transparent',color:'#fff',font:'inherit'});
  if(exchange){text(n,row.level==null?'—':numberText(row.level),21,0,45,32);text(n,row.name,120,0,90,32);text(n,row.gender??'—',277,0,30,32);}
  else {text(n,row.level==null?'—':numberText(row.level),0,0,44,32);text(n,row.name,44,0,120,32);text(n,row.leaderName,164,0,110,32);text(n,row.memberCount==null?'—':`${numberText(row.memberCount)}/10`,274,0,50,32);}
  list.append(n);controls.push(n);rowNodes.push({row,node:n});
 }
 if(!rows.length)text(list,exchange?'Chưa có thành viên khả dụng':'Chưa có đội khả dụng',5,30,g.list[2]-20,32);
 const message=text(host,'',20,exchange?263:308,g.width-40,16);message.style.fontSize='10px';message.setAttribute('role','status');
 function valid(fresh){const team=(fresh.teams||[]).find(t=>t.teamId===draft.teamId);return !!fresh.valid&&!fresh.error&&!!team&&Number.isFinite(team.memberCount)&&(exchange?(fresh.members||[]).some(m=>m.charUuid===draft.otherUuid):team.memberCount<10||fresh.canExchange===true);}
 const submit=ui.button('',()=>{if(!active())return;const fresh=state();if(!valid(fresh)){refresh();return;}const team=fresh.teams.find(t=>t.teamId===draft.teamId);
  if(!exchange&&team.memberCount>=10){draft.stage='exchange';draft.focus='list';ui.render();return;}
  const captured={teamId:draft.teamId,otherUuid:exchange?draft.otherUuid:''};submitted=true;for(const c of controls)c.disabled=true;ui.perform(()=>value.task(captured),value.success);
 },{testId:'account-confirm'});remember(submit,'confirm');submit.setAttribute('aria-label',exchange?'Xác nhận đổi chỗ':'Xác nhận chọn đội');Object.assign(submit.style,{padding:'0',border:'none',backgroundRepeat:'no-repeat'});const confirm=assets['dialog.confirm'];if(confirm)submit.append(at(assetImage(confirm),(120-confirm.width)/2,(35-confirm.height)/2,confirm.width,confirm.height));else submit.textContent='Xác nhận';host.append(at(submit,(g.width-120)/2,g.height-52,120,35));controls.push(submit);
 function refresh(){const fresh=state(),enabled=active(),team=(fresh.teams||[]).find(t=>t.teamId===draft.teamId);for(const {row,node} of rowNodes){node.disabled=!enabled;node.setAttribute('aria-selected',String(rowId(row)===selected()));node.style.background=rowId(row)===selected()?'rgba(14,109,170,.65)':'transparent';}panel.close.disabled=!!ui.pending||submitted;submit.disabled=!enabled||!valid(fresh);submit.style.backgroundImage=`url("${assets[submit.disabled?'dialog.gray':'dialog.green']?.url||''}")`;message.textContent=String(fresh.error||(!exchange&&team?.memberCount>=10&&!fresh.canExchange?'Chỉ chủ/phó Guild được đổi chỗ thành viên.':''));}
 overlay.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Tab'){e.preventDefault();const available=controls.filter(c=>!c.disabled),i=available.indexOf(document.activeElement);available[(i+(e.shiftKey?-1:1)+available.length)%available.length]?.focus();}});
 refresh();overlay.append(panel.root);overlay.initialFocus=controls.find(n=>n.dataset.accountField===`guild-move-${draft.focus}`&&!n.disabled)||rowNodes.find(r=>rowId(r.row)===selected()&&!r.node.disabled)?.node||panel.close;
 overlay.restoreScroll=()=>{if(current())list.scrollTop=draft.scroll[draft.stage]||0;};return overlay;
}
