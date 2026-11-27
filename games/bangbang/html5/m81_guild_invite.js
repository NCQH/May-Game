// ClanInviteFrame 358×258; the selected native team belongs to the caller.
// No fabricated friend directory. Existing invitation acknowledgement is not delivery proof.
import {element,assetImage,textInput} from './m8_ui_helpers.js';
import {createNativePanel} from './m81_native_panel.js';
function at(n,x,y,w,h){Object.assign(n.style,{position:'absolute',left:`${x}px`,top:`${y}px`,...(w?{width:`${w}px`}:{}),...(h?{height:`${h}px`}:{})});return n;}
export function renderGuildInvite(ui,value){
 const epoch=ui.epoch,generation=ui.client.generation,identity=ui.identity;let submitted=false;
 const current=()=>!ui.disposed&&!submitted&&ui.epoch===epoch&&ui.client.generation===generation&&ui.identity===identity&&ui.confirmation===value;
 const assets={...ui.assets?.panels?.assets,...ui.assets?.ui?.assets},overlay=element('div',null,'m8-account-modal');
 const close=()=>{if(current()&&!ui.pending){ui.confirmation=null;ui.render();}};
 const panel=createNativePanel({assets,width:358,height:258,state:'CONFIRM',close:{asset:'public.close',x:319,y:15,label:'Hủy'},onClose:close});
 panel.close.dataset.testid='account-confirm-cancel';panel.close.disabled=!!ui.pending;
 panel.root.setAttribute('role','dialog');panel.root.setAttribute('aria-modal','true');panel.root.setAttribute('aria-label',value.title);
 Object.assign(panel.content.style,{font:'bold 14px Tahoma,sans-serif',color:'#fff'});
 function label(key,text,y){const a=assets[key],n=a?assetImage(a):element('div',text);if(!a)n.style.textAlign='center';panel.content.append(at(n,a?(358-a.width)/2:25,y,a?.width||308,a?.height||24));}
 label('invite.title',value.title,20);label('invite.name','Nhập tên nhân vật được mời',86);
 const context=element('div',value.teamName);context.style.textAlign='center';panel.content.append(at(context,25,57,308,22));
 const name=textInput(ui.fields['gm-invite-name']||'',{maxLength:100});name.dataset.accountField='gm-invite-name';name.setAttribute('aria-label','Tên nhân vật được mời');const input=assets['dialog.inputMedium'];
 Object.assign(name.style,{boxSizing:'border-box',padding:'5px 15px',background:input?`url("${input.url}") no-repeat`:'transparent',border:'none',color:'#fff',font:'bold 16px Tahoma,sans-serif'});panel.content.append(at(name,74,121,210,35));
 const friend=ui.button('',null,{disabled:true});friend.setAttribute('aria-label','Danh sách bạn bè chưa được hỗ trợ');friend.title='Danh sách bạn bè chưa được hỗ trợ.';const friendArt=assets['invite.friends'];if(friendArt)friend.append(assetImage(friendArt));Object.assign(friend.style,{border:'none',padding:'0',background:'transparent'});panel.content.append(at(friend,288,128,friendArt?.width||32,friendArt?.height||24));
 const status=element('div');status.setAttribute('role','status');Object.assign(status.style,{fontSize:'11px',textAlign:'center',color:'#fff0ac'});panel.content.append(at(status,20,165,318,35));
 const submit=ui.button('',()=>{if(!current()||!ui.canMutate())return;const state=value.inviteState(name.value);if(state.error){refresh();return;}submitted=true;submit.disabled=true;panel.close.disabled=true;ui.fields['gm-invite-name']=name.value;ui.perform(()=>value.task(name.value),value.success);},{testId:'account-confirm'});
 submit.setAttribute('aria-label','Xác nhận mời');const icon=assets['dialog.confirm'];if(icon)submit.append(at(assetImage(icon),(120-icon.width)/2,(35-icon.height)/2,icon.width,icon.height));Object.assign(submit.style,{border:'none',padding:'0',backgroundRepeat:'no-repeat'});panel.content.append(at(submit,119,206,120,35));
 function refresh(){const state=value.inviteState(name.value);status.textContent=state.error||'';submit.disabled=!current()||!ui.canMutate()||!!state.error;submit.style.backgroundImage=`url("${assets[submit.disabled?'dialog.gray':'dialog.green'].url}")`;}
 name.addEventListener('input',()=>{if(current()){ui.fields['gm-invite-name']=name.value;refresh();}});
 overlay.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Tab'){e.preventDefault();const list=[panel.close,name,submit].filter(n=>!n.disabled),i=list.indexOf(document.activeElement);list[(i+(e.shiftKey?-1:1)+list.length)%list.length]?.focus();}});
 refresh();overlay.append(panel.root);overlay.initialFocus=name;return overlay;
}
