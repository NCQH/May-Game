import {element,actionButton,assetImage,setText} from './m8_ui_helpers.js';

// CoinProxy's active vi_VN "silver" state: cash, gift(m_iSilver), gold(m_iGolden).
export const FLASH_CURRENCIES=Object.freeze([
  {key:'cash',label:'Xu',icon:'currency.money',left:107,right:207,type:1,plus:209},
  {key:'silver',label:'Xu khóa',icon:'currency.coupon',left:245,right:346,type:2,plus:348},
  {key:'golden',label:'Bạc',icon:'currency.diamond',left:383,right:484,type:4,plus:486},
]);

// GUITools.getHighLightFilter(30)/getRemoveColorFiler, in Flash's sRGB space.
export function nativeMenuFilters() {
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
  svg.classList.add('m83-native-filters');svg.setAttribute('aria-hidden','true');
  svg.setAttribute('width','0');svg.setAttribute('height','0');
  const defs=document.createElementNS(ns,'defs');svg.append(defs);
  for(const [id,matrix] of [
    ['m83-native-highlight',[1,0,0,0,30/255,0,1,0,0,30/255,0,0,1,0,30/255,0,0,0,1,0]],
    ['m83-native-grayscale',[.3086,.6094,.082,0,0,.3086,.6094,.082,0,0,.3086,.6094,.082,0,0,0,0,0,1,0]],
  ]) {
    const filter=document.createElementNS(ns,'filter');filter.id=id;filter.setAttribute('color-interpolation-filters','sRGB');
    const color=document.createElementNS(ns,'feColorMatrix');color.setAttribute('type','matrix');color.setAttribute('values',matrix.join(' '));
    filter.append(color);defs.append(filter);
  }
  return svg;
}

function place(node,x,y,width,height) {
  Object.assign(node.style,{position:'absolute',left:`${x}px`,top:`${y}px`});
  if(width!=null)node.style.width=`${width}px`;if(height!=null)node.style.height=`${height}px`;
  return node;
}

export function nativeProgressFrame(value,maximum,frameCount=100) {
  const percent=maximum>0?Math.trunc(Number(value)*100/Number(maximum)):100;
  return Math.max(1,Math.min(frameCount,Number.isFinite(percent)?percent:1));
}

export function characterProgress(character,catalog,nowSeconds=null) {
  const level=Math.max(0,Math.trunc(Number(character.level)||0));
  const exp=Math.max(0,Math.trunc(Number(character.exp)||0));
  const need=catalog.levels[String(level)]?.needExp??-1;
  const percent=need>0?Math.trunc(exp*100/need):100;
  let vip=0;
  for(const [key,row] of Object.entries(catalog.vip))if(Number(character.vipPoints||0)>=row.point)vip=Math.max(vip,Number(key));
  const activeVip=nowSeconds!=null&&Number(character.vipTime)>nowSeconds;
  const maxThew=200+(activeVip?(catalog.vip[String(vip)]?.extraThew||0):0);
  const thew=Math.max(0,Math.trunc(Number(character.thew)||0));
  return {level,exp,need,percent,thew,maxThew,vip:activeVip?vip:0,
    superVip:activeVip&&Number(character.superVipTime)>nowSeconds,
    expText:need<0?'MAX/MAX(100%)':level<=24?`${exp}/${need}(${percent}%)`:`${percent}%`,
    thewText:`${thew}/${maxThew}(${Math.trunc(thew*100/maxThew)}%)`};
}

export function createNativeCurrency(assets,row) {
  const host=element('span',null,'m83-native-currency');
  host.setAttribute('role','img');host.dataset.currency=row.key;
  const atlas=assets.get('chrome.currencyNumbers'),width=Math.floor(atlas.width/10),height=Math.floor(atlas.height/4);
  let previous=null;
  return {host,update(value) {
    const text=String(Math.max(0,Math.trunc(Number(value)||0)));
    if(previous===text)return;previous=text;
    host.setAttribute('aria-label',`${row.label}: ${text}`);host.title=`${row.label}: ${text}`;
    host.dataset.value=text;host.style.left=`${row.right-text.length*10}px`;
    host.style.top='8px';host.style.width=`${text.length*10}px`;host.style.height=`${height}px`;
    host.replaceChildren(...Array.from(text,(digit,index)=>{
      const node=place(element('span',null,'m83-native-digit'),index*10,0,width,height);
      node.style.backgroundImage=`url("${atlas.url}")`;
      node.style.backgroundPosition=`${-Number(digit)*width}px ${-(row.type-1)*height}px`;
      return node;
    }));
  }};
}

/** Literal CharInfo360Frame + CharInfo360Proxy/CharLevelProxy geometry. */
export function createFlashCharacterChrome(assets,onProfile) {
  const catalog=assets.chrome,host=element('div',null,'m83-character-chrome');
  const art=(key,x,y,w,h)=>place(assets.menuArt(assets.get(key),'','m8-art'),x,y,w??assets.get(key)?.width,h??assets.get(key)?.height);
  host.append(art('chrome.headerBackground',0,0));
  const avatar=place(actionButton('',onProfile,{className:'m8-image-button m83-character-avatar',testId:'m8-profile',title:'Hồ sơ nhân vật'}),2,2,60,60);
  avatar.setAttribute('aria-label','Hồ sơ nhân vật');host.append(avatar);
  const vip=place(element('span',null,'m83-character-vip'),6,9);host.append(vip);
  const rank=place(element('span',null,'m83-character-rank'),64,6,80,40);host.append(rank);
  const name=place(element('span',null,'m83-character-name'),108,7,78,18);host.append(name);
  host.append(art('chrome.expLabel',69,31),art('chrome.thewLabel',69,47));
  const bars={};
  for(const [key,y,labelY] of [['exp',32,29],['thew',48,45]]) {
    const states=catalog.stateFrames[key],atlas=assets.get(states.assetKey);
    const bar=place(element('span',null,'m83-character-bar'),109,y,states.nativeWidth,states.nativeHeight);
    bar.style.backgroundImage=`url("${atlas.url}")`;
    const label=place(element('span',null,'m83-character-progress'),104,labelY,120,18);
    host.append(bar,label);bars[key]={bar,label,states};
  }
  for(const [key,x,y,label] of [['chrome.expPlus',217,26,'Mua EXP chưa mở'],['chrome.thewPlus',218,44,'Mua thể lực chưa mở']]) {
    const asset=assets.get(key),button=actionButton('',null,{className:'m8-image-button m83-native-unavailable',title:label});
    button.disabled=true;button.setAttribute('aria-label',label);button.append(assetImage(asset,''));
    host.append(place(button,x,y,asset.width*.75,asset.height*.75));
  }
  const doubleExp=place(element('span',null,'m83-double-exp'),62,11);host.append(doubleExp);
  let doubleExpVisible=false;
  let appearanceKey='';
  return {host,name,update(character,nowSeconds) {
    const data=characterProgress(character,catalog,nowSeconds);
    setText(name,character.name||'');name.title=character.name||'';
    const key=[character.avatarId,data.level,data.vip,data.superVip].join(':');
    if(key!==appearanceKey) {
      appearanceKey=key;
      const avatarAsset=assets.get(catalog.avatars[String(character.avatarId)]);
      avatar.replaceChildren(...(avatarAsset?[assetImage(avatarAsset,'')]:[]));
      if(avatarAsset){avatar.style.width=`${avatarAsset.width}px`;avatar.style.height=`${avatarAsset.height}px`;}
      const levelAsset=assets.get(`chrome.charLevel${data.level}`);
      const effectIndex=data.level<11?0:Math.min(6,Math.floor((data.level-11)/5)+1);
      const effect=effectIndex&&assets.get(`chrome.charLevelEffect${effectIndex}`);
      rank.replaceChildren(...(levelAsset?[place(assetImage(levelAsset,''),0,0)]:[]),...(effect?[place(assets.menuArt(effect,'','m8-art'),0,0,80,40)]:[]));
      const vipAsset=assets.get(`chrome.${data.superVip?'superVip':'vip'}${data.vip}`);vip.replaceChildren(...(vipAsset?[assetImage(vipAsset,'')]:[]));
    }
    const hasDoubleExp=nowSeconds!=null&&Number(character.expDoubleTime)>=nowSeconds;
    if(hasDoubleExp!==doubleExpVisible) {
      doubleExpVisible=hasDoubleExp;const effect=assets.get('chrome.doubleExp');
      doubleExp.replaceChildren(...(hasDoubleExp&&effect?[assets.menuArt(effect,'','m8-art')]:[]));
    }
    for(const [key,value,maximum,text] of [['exp',data.need<0?100:data.exp,data.need<0?100:data.need,data.expText],['thew',data.thew,data.maxThew,data.thewText]]) {
      const {bar,label,states}=bars[key],frame=nativeProgressFrame(value,maximum,states.frames.length);
      const record=states.frames[frame-1];bar.dataset.frame=String(frame);
      bar.style.backgroundPosition=`${-record.x}px ${-record.y}px`;setText(label,text);label.title=text;
    }
  }};
}
