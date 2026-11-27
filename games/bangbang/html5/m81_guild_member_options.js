/* ClanMemberOptionFrame: native 180×320 VBox and LinkButton palette.
 * Host supplies freshly validated existing actions; no protocol ownership. */
import {element} from './m8_ui_helpers.js';
export function renderGuildMemberOptions(ui,value,model){
 const overlay=element('div',null,'m8-account-modal'),card=element('div');
 const generation=ui.client?.generation,identity=ui.identity;
 const current=()=>!ui.disposed&&ui.confirmation===value&&ui.epoch===value.epoch&&ui.client?.generation===generation&&ui.identity===identity;
 const close=()=>{if(current()&&!ui.pending){ui.confirmation=null;ui.render();}};
 Object.assign(card.style,{width:'180px',maxHeight:'320px',overflowY:'auto',boxSizing:'border-box',padding:'4px 8px',background:'rgba(233,249,255,.98)',border:'2px solid #fff',borderRadius:'10px',font:'bold 14px Tahoma,sans-serif',color:'#086da5',display:'flex',flexDirection:'column',gap:'2px'});
 card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');card.setAttribute('aria-label','Thành viên Guild');card.dataset.nativeScreen='guild-member-options';
 const name=element('strong',model?.name||'Thành viên không còn trong Guild.');Object.assign(name.style,{fontSize:'16px',color:'#f16422',overflowWrap:'anywhere'});card.append(name);
 const line=element('div');Object.assign(line.style,{height:'2px',background:'#008ec5',opacity:'.8'});card.append(line);
 const nodes=[];
 for(const action of model?.actions||[]){const button=ui.button(action.label,()=>{if(current()&&!ui.pending)action.run();},{disabled:!!action.disabled,testId:action.id});button.dataset.accountField=`member-option-${value.memberUuid}-${action.id}`;Object.assign(button.style,{minHeight:'22px',padding:'0',border:'0',borderRadius:'2px',background:'transparent',color:'#086da5',font:'bold 14px Tahoma,sans-serif',textAlign:'left'});card.append(button);nodes.push(button);}
 const cancel=ui.button('Đóng',close,{testId:'account-confirm-cancel',disabled:!!ui.pending});cancel.dataset.accountField=`member-option-close-${value.memberUuid}`;card.append(cancel);nodes.push(cancel);
 overlay.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Tab'){e.preventDefault();const available=nodes.filter(n=>!n.disabled),i=available.indexOf(document.activeElement);available[(i+(e.shiftKey?-1:1)+available.length)%available.length]?.focus();}});
 overlay.append(card);overlay.initialFocus=nodes.find(n=>!n.disabled)||cancel;return overlay;
}
