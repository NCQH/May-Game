// CorpsDonateFrame (398×326) + CorpsMemberDonateView. UI displays contribution;
// native GBT_GUILD_COIN purchase count is contribution/10. Server remains authority.
import {createNativePanel} from './m81_native_panel.js';
import {element,assetImage,numberText,textInput} from './m8_ui_helpers.js';
export function donationState(item,snapshot,coinType,value) {
 const coin=Number(coinType),amount=Number(value),char=snapshot?.meta?.character||{},account=snapshot?.account||{};
 // Native daily counters and the quantity box are contribution points. The
 // requested silver budget is 500M coins = 50M points; cash stays unchanged
 // because 500M cash would exceed the native int32 merit/fund fields.
 const cap=coin===2?50000000:10000;
 const used=Number(account.limits?.[coin===2?12:220]??0),count=amount/10;
 const price=Number(coin===2?item?.silverPrice:item?.cashPrice),balance=Number(char.currency?.[coin===2?'golden':'cash']||0);
 let error='';
 if(!account.guild)error='Bạn chưa tham gia Guild.';
 else if(![1,2].includes(coin)||!Number.isSafeInteger(amount)||amount<10||amount>999999990||amount%10)error='Cống hiến phải là bội số của 10.';
 else if(!Number.isSafeInteger(used)||used<0||amount+used>cap)error='Vượt giới hạn đóng góp hôm nay.';
 else if(!Number.isSafeInteger(price)||price<=0)error='Chưa nhận được giá đóng góp.';
 else if(count*price>balance)error='Chưa đủ '+(coin===2?'Bạc':'Xu')+'.';
 return {coinType:coin,amount,count,price,cost:count*price,cap,used,balance,
  paidToday:used/10*price,coinCap:cap/10*price,error,valid:!error};
}
function at(n,x,y,w,h){Object.assign(n.style,{position:'absolute',left:`${x}px`,top:`${y}px`,...(w!=null?{width:`${w}px`}:{}),...(h!=null?{height:`${h}px`}:{})});return n;}
export function renderGuildDonation(ui,value) {
 const epoch=ui.epoch,item=value.item,assets={...ui.assets?.panels?.assets,...ui.assets?.ui?.assets};
 const current=()=>!ui.disposed&&ui.epoch===epoch&&ui.confirmation===value;
 const close=()=>{if(current()&&!ui.pending){ui.confirmation=null;ui.render();}};
 const overlay=element('div',null,'m8-account-modal');
 const panel=createNativePanel({assets,width:398,height:326,state:'CONFIRM',title:{asset:'donate.title',x:(398-assets['donate.title'].width)/2,y:18},close:{asset:'public.close',x:359,y:15,label:'Hủy'},onClose:close});
 panel.root.setAttribute('role','dialog');panel.root.setAttribute('aria-modal','true');panel.root.setAttribute('aria-label','Cống hiến Team');
 panel.close.dataset.testid='account-confirm-cancel';panel.close.disabled=!!ui.pending;
 Object.assign(panel.content.style,{font:'bold 12px Tahoma,sans-serif',color:'#fff'});
 const host=panel.content;
 const art=(key,x,y)=>{const a=assets[key];if(a)host.append(at(assetImage(a),x,y,a.width,a.height));};
 art('donate.quantity',32,69);art('dialog.input',199,62);art('donate.today',32,107);art('dialog.limit',164,104);art('dialog.limit',164,133);art('dialog.pay',32,171);art('donate.tip',95,239);
 const amount=textInput(ui.fields.donationValue??'10',{maxLength:9});amount.inputMode='numeric';amount.dataset.accountField='donationValue';amount.setAttribute('aria-label','Số điểm cống hiến');amount.title='1 Xu hoặc 100 Bạc đổi 10 điểm cống hiến. Hạn mức bên dưới tính theo tiền đã nộp trong ngày.';
 Object.assign(amount.style,{background:'transparent',border:'none',color:'#fff352',font:'bold 20px Arial,sans-serif',textAlign:'center',padding:'0'});host.append(at(amount,219,65,60,30));
 const cashLimit=element('div'),silverLimit=element('div');
 for(const [node,coin,y] of [[cashLimit,1,109],[silverLimit,2,138]]){const s=donationState(item,ui.snapshot,coin,10);node.textContent=`${coin===1?'Xu':'Bạc'}: ${numberText(s.paidToday)} / ${numberText(s.coinCap)}`;node.title=coin===1?'Tiền Xu nộp/ngày. Giữ trần cũ: 500 triệu Xu tạo 5 tỷ điểm, vượt giới hạn giao thức.':'Tiền Bạc nộp/ngày: tối đa 500.000.000 Bạc = 50.000.000 điểm.';Object.assign(node.style,{textAlign:'right',fontSize:'11px',fontVariantNumeric:'tabular-nums'});host.append(at(node,170,y,184,20));}
 let coin=Number(ui.fields.donationCoin||2);const costs=[];
 for(const [type,label,y] of [[1,'Xu',166],[2,'Bạc',196]]){
  const row=element('label');const radio=element('input');radio.type='radio';radio.name='guild-donation-currency';radio.value=String(type);radio.checked=coin===type;radio.dataset.accountField='donationCoin'+type;radio.setAttribute('aria-label',label);Object.assign(radio.style,{appearance:'none',width:'26px',height:'26px',margin:'0 6px 0 0',verticalAlign:'middle',backgroundRepeat:'no-repeat',cursor:'pointer'});
  const cost=element('span');row.append(radio,cost);host.append(at(row,132,y,230,26));costs.push({radio,cost,type,label});
  radio.addEventListener('change',()=>{if(current()&&radio.checked){coin=type;ui.fields.donationCoin=String(type);refresh();}});
 }
 const message=element('div');message.setAttribute('role','status');Object.assign(message.style,{textAlign:'center',fontSize:'11px',color:'#fff0ac'});host.append(at(message,25,216,348,22));
 function step(delta){if(!current())return;const n=Number(amount.value),s=donationState(item,ui.snapshot,coin,10),remaining=Math.max(0,s.cap-s.used);amount.value=String(Math.min(remaining,Math.max(10,(Math.floor((Number.isFinite(n)?n:10)/10)+delta)*10)));ui.fields.donationValue=amount.value;refresh();}
 for(const [delta,key,x] of [[-1,'dialog.minus',169],[1,'dialog.plus',303]]){const b=ui.button(delta<0?'Giảm 10':'Tăng 10',()=>step(delta),{testId:delta<0?'guild-donation-minus':'guild-donation-plus'});b.textContent='';b.setAttribute('aria-label',delta<0?'Giảm 10':'Tăng 10');const a=assets[key];b.append(assetImage(a));Object.assign(b.style,{padding:'0',border:'0',background:'none'});host.append(at(b,x,68,a.width,a.height));}
 const submit=ui.button('Xác nhận',()=>{
  if(!current()||!ui.canMutate())return;
  const s=donationState(item,ui.snapshot,coin,amount.value);if(!s.valid){refresh();return;}
  ui.fields.donationValue=amount.value;
  ui.perform(()=>ui.client.guildPurchase(item,{coinType:s.coinType,count:s.count}),'Đã đóng góp cho Guild và Team.');
 },{testId:'account-confirm'});submit.setAttribute('aria-label','Xác nhận cống hiến');submit.textContent='';
 Object.assign(submit.style,{padding:'0',border:'0',background:'transparent',backgroundRepeat:'no-repeat'});const confirm=assets['dialog.confirm'];submit.append(at(assetImage(confirm),(120-confirm.width)/2,(35-confirm.height)/2,confirm.width,confirm.height));host.append(at(submit,139,274,120,35));
 function refresh(){const s=donationState(item,ui.snapshot,coin,amount.value);amount.style.fontSize=amount.value.length>6?'12px':amount.value.length>4?'15px':'20px';message.textContent=s.error;submit.disabled=!ui.canMutate()||!s.valid;submit.style.backgroundImage=`url("${assets[submit.disabled?'dialog.gray':'dialog.green'].url}")`;for(const row of costs){row.radio.checked=coin===row.type;row.radio.style.backgroundImage=`url("${assets[row.radio.checked?'dialog.radioSelected':'dialog.radio'].url}")`;row.cost.textContent=`${numberText(donationState(item,ui.snapshot,row.type,amount.value).cost)} ${row.label}`;}}
 amount.addEventListener('input',()=>{if(current()){ui.fields.donationValue=amount.value;refresh();}});
 overlay.addEventListener('keydown',event=>{
  event.stopPropagation();
  if(event.key==='Escape'){event.preventDefault();close();}
  if(event.key==='Tab'){
   const controls=[...overlay.querySelectorAll('button,input')].filter(n=>!n.disabled&&!n.hidden);
   if(!controls.length)return;const index=controls.indexOf(document.activeElement);
   event.preventDefault();controls[(index+(event.shiftKey?-1:1)+controls.length)%controls.length].focus();
  }
 });
 refresh();overlay.append(panel.root);overlay.initialFocus=amount;return overlay;
}
