/* Shell geometry from the served CharModuleFactory CharFrame/PackageComponent
 * and TankLib II.mxml.com.CommonBGCvs. Native embedded images come through
 * M8UIAssets.get; no bitmap is substituted when its source is unavailable. */
import {element,assetImage,numberText} from './m8_ui_helpers.js';
import {createNativePanel} from './m81_native_panel.js';
import {panelArt,panelAsset,nativeLabel,nativeButton,createCharacterAppearance,nativeServerSeconds} from './m84_character.js';
import {characterProgress} from './m83_chrome.js';
export const INVENTORY_SHELL=Object.freeze({width:870,height:566,avatar:[19,50],inner:[229,84,622,438],package:[270,103,540,400],grid:[15,10,522,292]});
const GRID='zh_CN/II/common/grid9_';
function at(node,x,y,w,h){Object.assign(node.style,{position:'absolute',left:`${x}px`,top:`${y}px`,...(w==null?{}:{width:`${w}px`}),...(h==null?{}:{height:`${h}px`})});return node;}
function image(ui,host,path,x,y,w,h){const asset=ui.assets?.get?.(path);if(!asset)return null;const node=assetImage(asset);host.append(at(node,x,y,w??asset.width,h??asset.height));return node;}
export function commonBackgroundGeometry(width,height){return {clip:[2,2,width-4,height-4],source:[-2-(1000-width)/2,-2-(600-height)/2,1000,600]};}
export function renderCommonBackground(ui,width,height,{title=true,small=false}={}) {
  const root=at(element('div',null,'m82-common-background'),0,0,width,height);root.setAttribute('aria-hidden','true');
  const geometry=commonBackgroundGeometry(width,height),clip=at(element('div',null,'m82-common-background-crop'),...geometry.clip);root.append(clip);
  image(ui,clip,GRID+'middle_center.jpg',...geometry.source);
  for(const [name,x,y,w,h] of [['top_left',0,0,30,5],['top_center',30,0,width-60,5],['top_right',width-30,0,30,5],['middle_left',0,5,5,height-10],['middle_right',width-5,5,5,height-10],['bottom_left',0,height-5,30,5],['bottom_center',30,height-5,width-60,5],['bottom_right',width-30,height-5,30,5]])image(ui,root,GRID+name+'.png',x,y,w,h);
  if(title){const path=GRID+(small?'title_samll.png':'title_big.png'),asset=ui.assets?.get?.(path);if(asset)image(ui,root,path,(width-asset.width)/2,small?-6:-17);}
  return root;
}
export function nativeMilitaryClose(ui,onClose,width,testId,title) {
  const asset=ui.assets?.get?.('zh_CN/II/common/btn_normal_close.png');
  const button=ui.button(asset?'':'×',onClose,{className:'m82-native-close',testId,title});button.setAttribute('aria-label',title);
  if(asset)button.append(assetImage(asset));return at(button,width-(asset?.width||23),0,asset?.width||23,asset?.height||23);
}
export function renderInventoryShell(ui,body,types) {
  body.classList.add('m82-native-inventory','m84-inventory');body.dataset.nativeFrame='CharFrame';
  const inner=createNativePanel({assets:ui.assets?.panels?.assets||{},kind:'box3',state:'DARK_BG',width:622,height:438});body.append(at(inner.root,229,84));
  body.append(at(createCharacterAppearance(ui,ui.snapshot.meta?.character),19,50,210,302));
  const P='zh_CN/gui_summer/controls/';
  const change=id=>{ui.bag=id;ui.page=0;ui.selectedUuid=null;ui.inventoryDetails=false;ui.inventoryMore=false;ui.render();};
  for(const [index,[id,label,word]] of [[2,'Vật phẩm','meterial'],[3,'Nguyên liệu','item'],[4,'Thời trang','clothe'],[7,'Trang trí','individual'],[null,'Thành tích','achievement'],[null,'Phun','paintword']].entries()){
    const button=nativeButton(ui,{skin:P+'shop/shop_navItem'+(ui.bag===id?'Selected':'')+'.png',icon:P+`title/nav_${word}_t.png`,
      label,x:244+98*index,y:54,width:101,height:33,onClick:()=>change(id),disabled:id==null,
      title:id==null?`${label}: chưa mở trên máy chủ`:label,testId:id?`bag-type-${id}`:`bag-native-${index}`,module:'CharModuleFactory',
      className:id==null?'m84-native-unavailable':''});
    button.setAttribute('aria-pressed',String(ui.bag===id));body.append(button);
  }
  const extra=types.filter(([id])=>![2,3,4,7].includes(id));
  const extraButton=nativeButton(ui,{skin:P+'public/button_3_blue.png',text:extra.find(([id])=>id===ui.bag)?.[1]||'Ngăn khác',
    label:'Các ngăn khác đã hỗ trợ',x:735,y:528,width:100,height:33,onClick:()=>{ui.inventoryMore=!ui.inventoryMore;ui.render();},testId:'bag-more'});
  extraButton.setAttribute('aria-expanded',String(!!ui.inventoryMore));extraButton.setAttribute('aria-haspopup','true');body.append(extraButton);
  if(ui.inventoryMore){const menu=at(element('nav',null,'m84-bag-extra-menu'),636,310,200);menu.setAttribute('aria-label','Các ngăn khác');for(const [id,label] of extra)menu.append(ui.button(label,()=>change(id),{testId:`bag-type-${id}`,className:ui.bag===id?'is-active':''}));body.append(menu);}
  const char=ui.snapshot.meta?.character||{},profile=ui.cache.inventoryProfile,stats=profile?.state===1?profile.char_tech?.total:null;
  body.append(panelArt(ui,P+'tankbarn/char_infoBk_t.png',30,357));
  const progress=characterProgress(char,ui.assets.chrome||{levels:{},vip:{}},nativeServerSeconds(ui));
  const exp=at(element('span',null,'m84-bag-exp'),82,358,136,16),fill=at(element('span',null,'m84-bag-exp-fill'),0,0,136*Math.max(0,Math.min(1,progress.need>0?progress.exp/progress.need:1)),16);
  exp.append(panelArt(ui,P+'tankbarn/exptrack.png',0,0,136,16));fill.append(panelArt(ui,P+'tankbarn/expbar.png',0,0,136,16));
  exp.append(fill,nativeLabel(`${progress.exp}/${progress.need>0?progress.need:progress.exp}`,0,0,136,16,{size:14,bold:false,align:'center',className:'m84-bag-exp-label'}));body.append(exp);
  const native=ui.assets.accountPresentation?.nativeText||{};
  // CorpsModel resets clanPlace to zero when no ranked Guild is present.
  const rank=profile?.clan_place??ui.snapshot.account?.guild?.rank??0;
  const values=[ui.snapshot.account?.guild?.name||native.CONTROL_TEXT101||'',stats?String(stats.winmatchs??0):'',stats?`${Math.trunc(Number(stats.escapeprecent)||0)}%`:'',(native.TIP_395||'').replace('@num1@',String(rank))];
  values.forEach((value,index)=>{body.append(panelArt(ui,P+'public/label138x21.png',82,382+index*29,138,21),nativeLabel(value,90,383+index*29,126,20,{size:12}));});
  if(![4,7].includes(ui.bag)){
    for(const [i,[key,icon]] of [['cash','money'],['silver','coupon'],['golden','diamond']].entries())body.append(panelArt(ui,P+`shop/${icon}.png`,284,401+i*25),nativeLabel(Number(char.currency?.[key]||0).toLocaleString('en-US'),314,404+i*25,190,25,{size:16}));
    body.append(nativeButton(ui,{skin:P+'public/button_2_green.png',icon:P+'tankbarn/title_itemsorting_t.png',label:'Sắp xếp',x:700,y:413,width:96,height:28,disabled:true,title:'Sắp xếp: thao tác này chưa mở trong HTML5'}));
    const sale=ui.saleState?.()||{enabled:false,reason:'Chờ mô-đun giao dịch kho đồng bộ.'};
    body.append(nativeButton(ui,{skin:P+'public/button_2_orange.png',...(sale.recover?{text:'Kiểm tra kết quả'}:{icon:P+'tankbarn/title_sell_t.png'}),
      label:sale.recover?'Kiểm tra kết quả giao dịch':'Bán',x:700,y:445,width:96,height:28,disabled:!sale.enabled,title:sale.reason,
      onClick:()=>ui.sellSelected(),testId:sale.recover?'inventory-economy-reconcile':'inventory-sell'}));
    body.append(nativeButton(ui,{skin:P+'public/button_2_orange.png',icon:P+'tankbarn/word_goshop_t.png',label:'Cửa hàng',x:700,y:475,width:96,height:28,onClick:()=>ui.setSection('shop'),testId:'inventory-shop'}));
  }
}
export function placeInventoryDetails(ui,detail,selected,page) {
  const index=Math.max(0,page.findIndex(row=>row?.uuid===selected?.uuid));
  const x=285+(index%9)*57,y=113+Math.floor(index/9)*57;
  detail.classList.add('m82-bag-item-detail');detail.hidden=!ui.inventoryDetails;
  if(!ui.inventoryDetails)return;
  detail.setAttribute('role','region');detail.setAttribute('aria-label','Chi tiết vật phẩm');
  at(detail,x>570?x-246:x+58,Math.max(93,Math.min(248,y)),238,268);
  const close=ui.button('×',()=>{ui.inventoryDetails=false;ui.render();},{testId:'inventory-detail-close',title:'Đóng chi tiết vật phẩm'});close.classList.add('m82-bag-detail-close');detail.prepend(close);
  detail.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();ui.inventoryDetails=false;ui.afterRenderFocus=selected?`bag-item-${selected.templateId}`:null;ui.render();}});
}
