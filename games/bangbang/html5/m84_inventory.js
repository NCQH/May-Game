import {element,nativeText} from './m8_ui_helpers.js';
import {at,panelArt,panelAsset,nativeButton,nativeLabel,characterAsset,decorationAsset,nativeCharacterBonus,nativeServerSeconds} from './m84_character.js';

const P='zh_CN/gui_summer/controls/';
export const COSMETIC_BAG_GEOMETRY=Object.freeze({cards:[279,111,178,166,326],image:[14,45,180,240,.8],pager:[390,441,300,29]});
const timeStarted=item=>(Number(item.extFlag)&4)!==0;
export function nativeCosmeticExpired(item,nowSeconds){return timeStarted(item)&&nowSeconds!=null&&Number(item.lifeTime)<=nowSeconds;}
export function cosmeticBagPage(items,page=0,nowSeconds=null){
  const rows=items.filter(item=>Number(item.count)>0).slice().sort((a,b)=>{
    const expiredA=nativeCosmeticExpired(a,nowSeconds),expiredB=nativeCosmeticExpired(b,nowSeconds);
    if(!((expiredA&&expiredB)||(!expiredA&&!expiredB&&a.lifeTime===0&&b.lifeTime===0))){
      if(a.lifeTime===0)return -1;if(b.lifeTime===0)return 1;
      if(!expiredA)return -1;if(!expiredB)return 1;
    }
    return a.slotNo-b.slotNo;
  });
  const pages=Math.max(1,Math.ceil(rows.length/3));page=Math.max(0,Math.min(Number.isInteger(page)?page:0,pages-1));
  return {page,pages,items:rows.slice(page*3,page*3+3)};
}
export function cosmeticLifetimeText(item,native,nowSeconds){
  if(nativeCosmeticExpired(item,nowSeconds))return native.TIP_9||'';
  if(Number(item.lifeTime)===0)return native.CONTROL_TEXT104||'';
  const days=timeStarted(item)?(nowSeconds==null?null:Math.max(0,Math.ceil((Number(item.lifeTime)-nowSeconds)/86400))):Number(item.lifeTime);
  if(days==null)return '';
  const time=(native.TIME_TEXT10||'@day@').replace('@day@',String(days));
  const result=(native.CONTROL_TEXT30||'@time@').replace('@time@',time);
  return !timeStarted(item)?`${result} ${native.CONTROL_TEXT27||''}`.trim():result;
}

export function renderCosmeticInventory(ui,body,items){
  const now=nativeServerSeconds(ui),view=cosmeticBagPage(items,ui.page,now),containerType=ui.bag,decor=containerType===7;
  const context={epoch:ui.epoch,generation:ui.client.generation};
  ui.page=view.page;const catalog=ui.assets.accountPresentation,native=catalog?.nativeText||{};
  const equippedId=Number(decor?ui.snapshot.meta?.character?.decorateId:ui.snapshot.meta?.character?.avatarId);
  body.dataset.nativeBagPresentation=decor?'CharIndividualProxy':'PlayerVisualizeProxy';
  for(let index=0;index<3;index++){
    const item=view.items[index],card=at(element('article',null,'m84-cosmetic-card'),279+178*index,111,166,326);
    card.append(panelArt(ui,P+'tankbarn/fash_sBK.png'),panelArt(ui,P+'tankbarn/fash_sBK_texture.png',0,20),panelArt(ui,P+'tankbarn/fash_name.png',5,7));
    if(item){
      const row=(decor?catalog?.decorations:catalog?.characters)?.[String(item.templateId)],fallback=ui.cosmetic?.(item.templateId);
      const title=nativeText(row?.name||fallback?.name||ui.itemDefinition(item)?.name||'');
      card.append(nativeLabel(title,27,11,113,23,{size:14,align:'center',className:'m84-cosmetic-name'}));
      const asset=decor?decorationAsset(ui,item.templateId,'icon'):characterAsset(ui,item.templateId);
      const equipped=equippedId===Number(item.templateId),expired=nativeCosmeticExpired(item,now);
      const timed=Number(item.lifeTime)!==0,supported=!!fallback;
      const disabled=equipped||expired||timed||!supported||!ui.canMutate();
      const reason=equipped?'Đang dùng':expired?'Đã hết hạn':timed?'Vật phẩm có thời hạn chưa hỗ trợ sử dụng':!supported?'Chưa đủ tài nguyên để sử dụng':`Sử dụng ${title}`;
      const use=()=>ui.useCosmeticItem(containerType,item,context);
      const button=at(ui.button('',use,
        {disabled,testId:`bag-item-${item.templateId}`,className:'m84-art-hit',title:reason}),14,45,180,240);
      button.style.transform='scale(.8)';button.style.transformOrigin='0 0';button.dataset.slotNo=String(item.slotNo);
      button.dataset.nativeAction='inventory-equip';button.setAttribute('aria-label',button.title);button.setAttribute('aria-pressed',String(equipped));
      if(asset)button.append(panelArt(ui,asset,0,0,180,240,{alt:title}));card.append(button);
      if(equipped)card.append(panelArt(ui,P+'public/tip_fighting.png',122,6));
      const bonus=nativeCharacterBonus(catalog,decor?{decorateId:item.templateId}:{avatarId:item.templateId},decor?'decoration':'avatar');
      if(bonus)card.append(nativeLabel(bonus,0,237,166,24,{size:12,align:'center',color:'#ffbc86',className:'m84-character-bonus'}));
      card.append(nativeLabel(cosmeticLifetimeText(item,native,now),0,260,166,40,{size:13,align:'center',className:'m84-cosmetic-time'}));
      if(item.lifeTime!==0||timeStarted(item))card.append(nativeButton(ui,{skin:P+'public/button_4_red.png',icon:P+'tankbarn/title_overtimefee_t.png',label:'Phí duy trì',x:40,y:287,width:81,height:28,disabled:true,title:'Phí duy trì: thao tác này chưa mở trong HTML5'}));
      else {
        // Permanent items have no renewal row in the source. Expose the same
        // native C153 image-click action here too, using the existing green
        // button art, so the usable action is visible and keyboard reachable.
        const action=nativeButton(ui,{skin:P+'public/button_2_green.png',text:equipped?'Đang dùng':'Sử dụng',
          label:equipped?`Đang dùng ${title}`:`Sử dụng ${title}`,x:35,y:287,width:96,height:28,
          disabled,testId:`inventory-equip-${item.templateId}`,title:reason,onClick:use});
        action.dataset.nativeAction='inventory-equip';action.dataset.slotNo=String(item.slotNo);
        action.setAttribute('aria-pressed',String(equipped));card.append(action);
      }
    }
    body.append(card);
  }
  if(!items.some(item=>Number(item.count)>0)){
    const empty=nativeLabel(decor?'Chưa có trang trí trong túi.':'Chưa có thời trang trong túi.',293,208,488,28,{size:16,align:'center'});
    empty.dataset.testid='inventory-cosmetic-empty';body.append(empty);
    body.append(nativeButton(ui,{skin:P+'public/button_3_green.png',text:'Vào Shop',label:decor?'Chọn trang trí trong Shop':'Chọn thời trang trong Shop',
      x:490,y:252,width:100,height:33,testId:'inventory-cosmetic-shop',onClick:()=>{ui.shopType=containerType;ui.setSection('shop');}}));
  }
  const pager=at(element('nav',null,'m84-cosmetic-pager'),390,decor?441:453,300,29);pager.setAttribute('aria-label','Trang vật phẩm');
  pager.append(panelArt(ui,P+'public/pager_bk.png',107,-2,86,33),nativeLabel(`${view.page+1}/${view.pages}`,121.5,3,57,24,{size:15,align:'center'}));
  for(const [key,center,target] of [['first',-100,0],['previous',-60,view.page-1],['next',60,view.page+1],['last',100,view.pages-1]]){
    const logical=P+`public/btn_s2_${key==='previous'?'prev':key}.png`,asset=panelAsset(ui,logical),width=asset?.width||(key==='first'||key==='last'?46:33),height=asset?.height||29;
    pager.append(nativeButton(ui,{skin:logical,label:{first:'Trang đầu',previous:'Trang trước',next:'Trang sau',last:'Trang cuối'}[key],
      x:150+center-width/2,y:(29-height)/2,width,height,disabled:target<0||target>=view.pages||target===view.page,
      testId:`bag-page-${key}`,onClick:()=>{ui.page=target;ui.render();}}));
  }
  body.append(pager);
  if(decor)body.append(nativeButton(ui,{skin:P+'public/button_3_blue.png',icon:P+'title/title_roolback_t.png',label:'Bỏ phông nền',
    x:490,y:476,width:100,height:33,testId:'inventory-unequip-background',disabled:!equippedId||!ui.canMutate(),
    onClick:()=>ui.perform(()=>ui.client.useCosmetic(7,-1),'Đã bỏ phông nền.')}));
}
