/* CreateCorpsFrame 398×326 / CreateClanFrame 358×230, original guild source.
 * CreateTeamView can grow its 230px base by tip text height; this compact copy
 * fits its native tip area. Host owns modal inertness/focus restoration and all
 * permission/card/funds/UTF-8 validation through creationState(names).
 * No optimistic success: perform owns the actual native reply and rejection. */
import {element,assetImage,textInput,numberText} from './m8_ui_helpers.js';
import {createNativePanel} from './m81_native_panel.js';
export const GUILD_CREATE_GEOMETRY=Object.freeze({guild:{width:398,height:326,nameY:93,teamY:170},team:{width:358,height:230,nameY:91}});
function at(node,x,y,w,h){Object.assign(node.style,{position:'absolute',left:`${x}px`,top:`${y}px`,...(w!=null?{width:`${w}px`}:{}),...(h!=null?{height:`${h}px`}:{})});return node;}
export function renderGuildCreate(ui,value){
 if(!['guild-create','team-create'].includes(value.kind))throw new Error('Unsupported Guild creation dialog');
 const guild=value.kind==='guild-create',g=GUILD_CREATE_GEOMETRY[guild?'guild':'team'];
 const epoch=ui.epoch,identity=ui.identity,generation=ui.client?.generation;
 const assets={...ui.assets?.panels?.assets,...ui.assets?.ui?.assets};
 const current=()=>!ui.disposed&&ui.epoch===epoch&&ui.identity===identity&&ui.client?.generation===generation&&ui.confirmation===value;
 let submitted=false;
 const active=()=>current()&&!submitted&&!ui.pending&&ui.canMutate();
 const close=()=>{if(!current()||submitted||ui.pending)return;ui.confirmation=null;ui.render();};
 const overlay=element('div',null,'m8-account-modal');
 const panel=createNativePanel({assets,width:g.width,height:g.height,state:'CONFIRM'}),host=panel.content;
 panel.root.setAttribute('role','dialog');panel.root.setAttribute('aria-modal','true');panel.root.setAttribute('aria-label',guild?'Tạo Guild':'Tạo Team');
 Object.assign(host.style,{font:'bold 12px Tahoma,sans-serif',color:'#fff'});
 function art(key,x,y){const a=assets[key];if(a){host.append(at(assetImage(a),x,y,a.width,a.height));return true;}return false;}
 function centered(key,text,y){const a=assets[key];if(a)art(key,(g.width-a.width)/2,y);else{const label=element('div',text);Object.assign(label.style,{textAlign:'center',lineHeight:'20px'});host.append(at(label,30,y,g.width-60,20));}}
 centered(guild?'creation.guildTitle':'creation.teamTitle',guild?'Tạo Guild':'Tạo Team',guild?18:20);
 const cancel=ui.button('',close,{testId:'account-confirm-cancel'});cancel.setAttribute('aria-label','Hủy');const ca=assets['public.close'];if(ca)cancel.append(assetImage(ca));else cancel.textContent='×';Object.assign(cancel.style,{padding:'0',border:'none',background:'none'});host.append(at(cancel,g.width-15-(ca?.width||24),15,ca?.width||24,ca?.height||24));
 const controls=[cancel];
 function input(field,label,y){const n=textInput(ui.fields[field]??'',{maxLength:12});n.dataset.accountField=field;n.setAttribute('aria-label',label);n.autocomplete='off';n.spellcheck=false;
  const a=assets['dialog.inputMedium'];Object.assign(n.style,{boxSizing:'border-box',padding:'5px 15px',border:'none',background:a?`url("${a.url}") no-repeat`:'transparent',color:'#fff',font:'bold 16px Tahoma,sans-serif'});
  host.append(at(n,(g.width-210)/2,y,210,35));controls.push(n);n.addEventListener('input',()=>{if(!active())return;ui.fields[field]=n.value;refresh();});return n;
 }
 centered(guild?'creation.guildName':'creation.teamName',guild?'Tên Guild':'Tên Team',guild?71:61);
 const name=input(guild?'guildName':'gm-create-team',guild?'Tên Guild':'Tên Team',g.nameY);
 let team=null;if(guild){centered('creation.firstTeamName','Tên Team đầu tiên',148);team=input('guildTeamName','Tên Team đầu tiên',170);}
 const names=()=>({name:name.value,teamName:team?.value||''});
 art('creation.tip',guild?29:33,guild?213:136);
 const detail=element('div');Object.assign(detail.style,{lineHeight:'16px'});host.append(at(detail,guild?60:67,guild?216:136,guild?250:266,guild?32:40));
 const message=element('div');message.setAttribute('role','status');Object.assign(message.style,{fontSize:'11px',lineHeight:'13px',textAlign:'center',color:'#fff0ac'});host.append(at(message,25,guild?245:136,g.width-50,guild?26:40));
 let buy=null;if(guild&&typeof value.buyCard==='function'){
  buy=ui.button('',()=>{if(!active())return;const s=value.creationState(names());if(!s.canBuy||Number(s.cardCount)>0)return;save();submitted=true;lock();value.buyCard();},{testId:'guild-create-buy-card'});buy.setAttribute('aria-label','Mua thẻ tạo Guild');const a=assets['creation.buy'];if(a)buy.append(assetImage(a));else buy.textContent='Mua';Object.assign(buy.style,{padding:'0',border:'none',background:'none'});host.append(at(buy,314,211,a?.width||60,a?.height||32));controls.push(buy);
 }
 function save(){ui.fields[guild?'guildName':'gm-create-team']=name.value;if(team)ui.fields.guildTeamName=team.value;}
 function lock(){for(const c of controls)c.disabled=true;}
 const submit=ui.button('',()=>{if(!active())return;const captured=names(),s=value.creationState(captured);if(!s.valid||s.error){refresh();return;}save();submitted=true;lock();ui.perform(()=>value.task(captured),value.success);},{testId:'account-confirm'});
 submit.setAttribute('aria-label',guild?'Xác nhận tạo Guild':'Xác nhận tạo Team');Object.assign(submit.style,{padding:'0',border:'none',backgroundRepeat:'no-repeat'});const label=assets['dialog.confirm'];if(label)submit.append(at(assetImage(label),(120-label.width)/2,(35-label.height)/2,label.width,label.height));else submit.textContent='Xác nhận';host.append(at(submit,(g.width-120)/2,g.height-52,120,35));controls.push(submit);
 function refresh(){const s=value.creationState(names()),enabled=active();for(const n of [name,team].filter(Boolean))n.disabled=!enabled;cancel.disabled=!!ui.pending||submitted;submit.disabled=!enabled||!s.valid||!!s.error;submit.style.backgroundImage=`url("${assets[submit.disabled?'dialog.gray':'dialog.green']?.url||''}")`;detail.textContent=guild?`Cần 1 thẻ tạo Guild. Hiện có: ${numberText(s.cardCount)}.`:(s.error?'':String(s.detail||''));message.textContent=String(s.error||'');if(buy){buy.hidden=Number(s.cardCount)>0;buy.disabled=!enabled||!s.canBuy;}}
 overlay.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();close();}if(event.key==='Tab'){const available=controls.filter(c=>!c.disabled&&!c.hidden);if(!available.length)return;event.preventDefault();const i=available.indexOf(document.activeElement);available[(i+(event.shiftKey?-1:1)+available.length)%available.length].focus();}});
 refresh();overlay.append(panel.root);overlay.initialFocus=name.disabled?cancel:name;return overlay;
}
