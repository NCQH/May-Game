/* AvatarBuyAskFrame native geometry. Only the current permanent cosmetic offer
 * is exposed; no legacy rental/gift/skin-stat behavior is implemented here.
 * Host owns attachment, background inertness and restoring the triggering focus. */
import {element, assetImage, nativeText, numberText} from './m8_ui_helpers.js';
import {createNativePanel} from './m81_native_panel.js';
export const SHOP_CONFIRM_GEOMETRY=Object.freeze({width:518,height:498,titleY:19,preview:[34,66,190,260],name:[240,67,152],option:[240,106],pay:[244,225],currency:[244,252],confirmBottom:17});
const currencyName=type=>['Xu','Bạc','Phiếu quà','Huy chương','Pha lê','Điểm quà'][Number(type)-1]||'Tiền';
function place(node,x,y,width,height){Object.assign(node.style,{position:'absolute',left:`${x}px`,top:`${y}px`});if(width!=null)node.style.width=`${width}px`;if(height!=null)node.style.height=`${height}px`;return node;}
export function renderNativeShopConfirmation(ui,value){
  const epoch=ui.epoch,identity=ui.identity,generation=ui.client?.generation;
  const goods=value.goods,price=goods?.price,coin=goods?.coinType;
  const assets=ui.assets?.panels?.assets||{};
  const art=key=>assets[key]||ui.ui(key);
  const overlay=element('div',null,'m8-account-modal m81-shop-confirm-overlay');
  const current=()=>!ui.disposed&&ui.epoch===epoch&&ui.identity===identity&&ui.client?.generation===generation&&ui.confirmation===value;
  let submitted=false;
  const cancel=()=>{if(!current()||submitted||ui.pending)return;ui.confirmation=null;ui.render();};
  const {root,content}=createNativePanel({assets,width:518,height:498,kind:'box1',state:'CONFIRM'});
  root.classList.add('m81-shop-confirm');root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label',nativeText(value.title));
  function imageAt(key,x,y){const a=art(key);if(!a)return null;const image=assetImage(a,'');image.setAttribute('aria-hidden','true');content.append(place(image,x,y,a.width,a.height));return image;}
  const title=art('account.shopConfirmTitle');if(title)imageAt('account.shopConfirmTitle',(518-title.width)/2,19);
  else content.append(place(element('h2',nativeText(value.title)),100,19,318));
  const closeArt=art('public.close');const close=ui.button(closeArt?'':'×',cancel,{testId:'account-confirm-cancel',className:'m81-shop-confirm-close'});
  close.setAttribute('aria-label','Hủy mua');if(closeArt)close.append(assetImage(closeArt,''));
  content.append(place(close,518-15-(closeArt?.width||24),15,closeArt?.width||24,closeArt?.height||24));
  const preview=place(element('div',null,'m81-shop-confirm-preview'),34,66,190,260);
  const icon=ui.image?ui.image(value.image||goods?.icon,nativeText(goods?.name)):assetImage(value.image||goods?.icon,nativeText(goods?.name));preview.append(icon);content.append(preview);
  content.append(place(element('h3',nativeText(goods?.name),'m81-shop-confirm-name'),240,67,152));
  const option=place(element('div',null,'m81-shop-confirm-option'),240,106,240,30);
  const radio=art('account.shopSelected');if(radio)option.append(assetImage(radio,''));option.append(element('span','Vĩnh viễn'));content.append(option);
  imageAt('account.shopPayLabel',244,225);
  const state=value.purchaseState?.();
  content.append(place(element('div',`${numberText(price)} ${currencyName(coin)}`,'m81-shop-confirm-price'),244,252,240));
  const detail=element('p',state?`Số dư: ${numberText(state.balance)} ${currencyName(coin)}. Chỉ thay đổi diện mạo.`:nativeText(value.detail),'m81-shop-confirm-detail');
  content.append(place(detail,240,294,240,104));
  const eligible=()=>{const state=value.purchaseState?.();return current()&&!submitted&&ui.canMutate()&&[4,7].includes(goods?.containerType)&&Number.isFinite(price)&&price>=0&&goods.price===price&&goods.coinType===coin&&!!state&&!state.owned&&state.affordable;};
  const submit=()=>{if(!eligible())return;submitted=true;confirm.disabled=true;close.disabled=true;ui.perform(value.task,value.success);};
  const confirm=ui.button('',submit,{disabled:!eligible(),testId:'account-confirm',className:'m81-shop-confirm-submit'});
  confirm.setAttribute('aria-label',value.button||'Xác nhận mua');const skin=art('account.shopConfirmButton'),label=art('account.shopConfirmLabel');
  if(skin){confirm.style.backgroundImage=`url("${skin.url}")`;confirm.style.width=`${skin.width}px`;confirm.style.height=`${skin.height}px`;}
  if(label)confirm.append(assetImage(label,''));else confirm.textContent=value.button||'Xác nhận mua';
  content.append(confirm);overlay.append(root);overlay.initialFocus=close;
  overlay.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();cancel();}
    if(event.key==='Tab'){const buttons=[close,confirm].filter(button=>!button.disabled);if(!buttons.length)return;event.preventDefault();const index=buttons.indexOf(document.activeElement);buttons[(index+(event.shiftKey?-1:1)+buttons.length)%buttons.length].focus();}});
  return overlay;
}
