import {element,nativeText,numberText,textInput,note} from './m8_ui_helpers.js';
import {createNativePanel} from './m81_native_panel.js';
import {at,panelArt,panelAsset,nativeLabel,nativeButton,createCharacterAppearance,characterAsset,decorationAsset,nativeCharacterBonus} from './m84_character.js';
import {normalShopType,renderNormalShopGoods,renderNormalShopRecovery} from './m81345_shop_ui.js';

const P='zh_CN/gui_summer/controls/';
export const SHOP_NATIVE_GEOMETRY=Object.freeze({size:[1020,620],avatar:[16,49,210,302],inside:[225,85,776,446],
  cards:[235,139,250,380],wallet:[21,356,204,29],pager:[301,539,616,28]});
const comma=value=>Math.max(0,Number(value)||0).toLocaleString('en-US');

export function renderNativeShop(ui,body,{purchaseState,previewAppearance,currencyName}) {
  body.classList.add('m84-shop');body.dataset.nativeFrame='ShopFrame';body.tabIndex=-1;
  const inside=createNativePanel({assets:ui.assets.panels.assets,kind:'box3',state:'DARK_BG',width:776,height:446});
  body.append(at(inside.root,225,85));
  const appearance=previewAppearance(ui.snapshot.meta?.character||{},ui.shopPreview);
  body.append(at(createCharacterAppearance(ui,appearance,{mode:'shop'}),16,49,210,302));
  const mainTabs=[
    ['normal:1','Đề cử','title/nav_recommend_t.png',15],['normal:2','Tank','title/nav_tank_t.png',113],
    ['normal:7','Skin','title/nav_tankskin_t.png',208],[4,'Thời trang','title/nav_clothe_t.png',303],
    [7,'Trang trí','title/nav_individual_t.png',396],['normal:4','Vật phẩm','title/nav_meterial_t.png',490],
    ['normal:5','Nguyên liệu','title/nav_item_t.png',581],['normal:6','Trợ thủ','shop/title_helper_t.png',672],
  ];
  for(const [id,label,word,x] of mainTabs){
    const selected=id===ui.shopType;
    const button=nativeButton(ui,{skin:P+'shop/shop_navItem'+(selected?'Selected':'')+'.png',icon:P+word,
      label,x:224+x,y:55,width:101,height:33,testId:id?`shop-type-${id}`:`shop-native-${x}`,
      disabled:id==null,title:id==null?`${label}: chưa có mặt hàng được mở trên máy chủ`:label,
      className:id==null?'m84-native-unavailable':'',module:'ShopModuleFactory',
      onClick:()=>{ui.shopType=id;ui.page=0;ui.query='';ui.shopSub='all';ui.shopSearchOpen=false;ui.render();ui.loadSection();}});
    button.setAttribute('aria-pressed',String(selected));body.append(button);
  }
  const sub=ui.shopSub||'all';
  for(const [key,label,x,shape,available] of [['all','Toàn bộ',0,'left',true],['sale','SALE',88,'center',false],['gift','Xu Khóa',176,'center',normalShopType(ui.shopType)]]){
    const button=nativeButton(ui,{skin:P+`shop/shop_subnavItem${sub===key?'Selected':''}_${shape}.png`,text:label,
      label,x:240+x,y:101,width:90,height:28,disabled:!available,className:!available?'m84-native-unavailable':'',
      title:key==='all'?'Toàn bộ (nhấn / khi ở Shop để tìm tên)':`${label}: chưa có mặt hàng thuộc nhóm này được mở`,
      testId:`shop-filter-${key}`,module:'ShopModuleFactory',onClick:()=>{ui.shopSub=key;ui.page=0;ui.query='';ui.render();}});
    button.setAttribute('aria-pressed',String(key===sub));if(key==='all')button.setAttribute('aria-keyshortcuts','/');body.append(button);
  }
  const currency=ui.snapshot.meta?.character?.currency||{};
  for(const [index,[key,label,icon]] of [['cash','Xu','money'],['silver','Xu Khóa','coupon'],['golden','Xu Bạc','diamond']].entries()){
    const y=356+index*30;
    body.append(panelArt(ui,P+'public/label200x28.png',21,y),panelArt(ui,P+`shop/${icon}.png`,29,y+2),
      nativeLabel(label,54,y+4,60,24,{align:'center'}),nativeLabel(comma(currency[key]),95,y+4,120,24,{align:'right'}));
  }
  // Both native charge buttons use this disabledSkin when no charge URL exists.
  body.append(nativeButton(ui,{skin:P+'shop/button_recharge_disabled_t.png',label:'Nạp tiền chưa mở',x:36,y:484,
    disabled:true,className:'m84-native-unavailable',testId:'shop-recharge'}));
  body.append(panelArt(ui,P+'public/window_button_blue_bk.png',57,535),nativeButton(ui,{
    skin:P+'public/button_window_blue.png',icon:P+'shop/word_mypack_t.png',label:'Kho',x:61,y:539,
    testId:'shop-inventory',onClick:()=>ui.setSection('inventory')}));
  if(normalShopType(ui.shopType))renderNormalShopGoods(ui,body);
  else {
  const rows=(ui.catalog.cosmetics||[]).filter(row=>row.containerType===ui.shopType&&nativeText(row.name).toLocaleLowerCase('vi').includes((ui.query||'').toLocaleLowerCase('vi')));
  const pages=Math.max(1,Math.ceil(rows.length/3));ui.page=Math.max(0,Math.min(Number(ui.page)||0,pages-1));
  const cards=at(element('div',null,'m84-shop-cards'),235,139,750,380);
  for(const [index,goods] of rows.slice(ui.page*3,ui.page*3+3).entries()){
    const state=purchaseState(ui.snapshot.meta,goods),name=nativeText(goods.name),card=at(element('article',null,'m84-shop-card'),index*250,0,250,380);
    card.dataset.goodsId=String(goods.goodsId);card.dataset.itemId=String(goods.itemId);
    card.append(panelArt(ui,P+'shop/bigGoodsCard.png',-2,-2));
    const title=nativeLabel(name,10,13,230,24,{align:'center',className:'m84-shop-card-name'});title.title=name;card.append(title);
    const asset=goods.containerType===4?characterAsset(ui,goods.itemId):decorationAsset(ui,goods.itemId,'icon');
    if(state.owned){
      // Preserve the existing HTML5 equip action as a transparent art hit area;
      // the current native 70M goods branch intentionally has no buy/repay row.
      const equip=ui.button('',()=>ui.perform(()=>ui.client.useCosmetic(goods.containerType,state.item.slotNo),'Đã thay đổi diện mạo.'),{
        disabled:state.equipped||!ui.canMutate(),testId:`shop-equip-${goods.itemId}`,className:'m84-native-button m84-art-hit',
        title:state.equipped?'Đang dùng':'Sử dụng '+name});
      equip.dataset.nativeSkin='true';equip.setAttribute('aria-label',state.equipped?'Đang dùng '+name:'Sử dụng '+name);
      card.append(at(equip,37,41,asset?.width||180,asset?.height||240));if(asset)equip.append(panelArt(ui,asset));
    }else if(asset)card.append(panelArt(ui,asset,37,41));
    const tryButton=nativeButton(ui,{skin:P+'title/button_view3_t.png',label:'Thử '+name,x:185,y:9,
      testId:'shop-try-'+goods.itemId,onClick:()=>{ui.shopPreview={...ui.shopPreview,[goods.containerType===4?'avatarId':'decorateId']:goods.itemId};ui.render();}});
    card.append(tryButton);
    const bonuses=nativeCharacterBonus(ui.assets.accountPresentation,{[goods.containerType===4?'avatarId':'decorateId']:goods.itemId},goods.containerType===4?'avatar':'decoration');
    if(bonuses)card.append(nativeLabel(bonuses,0,281,250,22,{align:'center',size:12,color:'#ff6600'}));
    const price=at(element('div',null,'m84-shop-price'),20,302,230,26);
    if(state.owned)price.append(element('span','Đã sở hữu'));
    else {
      const coin=panelAsset(ui,P+`shop/${goods.coinType===1?'money':goods.coinType===3?'coupon':'diamond'}.png`);
      if(coin){const image=panelArt(ui,coin);Object.assign(image.style,{position:'static',width:`${coin.width}px`,height:`${coin.height}px`});price.append(image);}
      price.append(element('span',comma(goods.price)));
      const buy=nativeButton(ui,{skin:P+'shop/button_buy_t.png',label:'Mua '+name,x:32,y:336,testId:`shop-buy-${goods.itemId}`,
        disabled:!state.affordable||!ui.canMutate(),title:state.affordable?'Mua '+name:'Chưa đủ '+currencyName(goods.coinType)+'.',
        onClick:()=>ui.confirm('Mua '+name,`Sở hữu vĩnh viễn · ${numberText(goods.price)} ${currencyName(goods.coinType)}. Số dư hiện tại: ${numberText(state.balance)} ${currencyName(goods.coinType)}.`,
          ()=>ui.client.purchaseCosmetic({...goods,kind:1,count:1}),{kind:'shop',goods,purchaseState:()=>purchaseState(ui.snapshot.meta,goods),image:asset,
            button:'Mua',success:'Đã mua. Vật phẩm đã có trong kho.'})});
      card.append(buy);
    }
    card.append(price);cards.append(card);
  }
  body.append(cards,ui.nativePager('shop',pages,body));
  if(!rows.length)body.append(at(note('Không tìm thấy vật phẩm.'),250,160,700,28));
  renderNormalShopRecovery(ui,body,{shop:true});
  }
  const showSearch=()=>{ui.shopSearchOpen=true;ui.render();ui.host.querySelector('[data-account-field="shop-search"]')?.focus();};
  body.addEventListener('keydown',event=>{if(event.key==='/'&&!['INPUT','TEXTAREA'].includes(event.target.tagName)){event.preventDefault();showSearch();}});
  const searchButton=ui.button('Tìm tên vật phẩm',showSearch,{testId:'shop-search-open',className:'m84-screen-reader-action'});
  searchButton.setAttribute('aria-keyshortcuts','/');body.append(searchButton);
  if(ui.shopSearchOpen){
    const box=at(element('div',null,'m84-shop-search'),540,97,440,34);box.setAttribute('role','search');
    const input=textInput(ui.query,{placeholder:'Tìm theo tên…',maxLength:80});input.dataset.accountField='shop-search';input.setAttribute('aria-label','Tìm vật phẩm');
    input.addEventListener('input',()=>{ui.query=input.value;ui.page=0;ui.render();});
    const close=()=>{ui.shopSearchOpen=false;ui.query='';ui.page=0;ui.render();ui.host.querySelector('[data-testid="shop-filter-all"]')?.focus();};
    box.append(input,ui.button('Đóng',close,{testId:'shop-search-close'}));box.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();event.preventDefault();close();}});body.append(box);
  }
}
