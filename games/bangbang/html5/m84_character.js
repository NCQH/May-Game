import {element,assetImage,nativeText} from './m8_ui_helpers.js';
import {characterProgress} from './m83_chrome.js';

// Literal native geometry comes from CharAvatarFrame and PlayerInfoFrame. The
// outer caller owns stage scale; these helpers always use native Flash pixels.
export function at(node,x,y,width,height) {
  Object.assign(node.style,{position:'absolute',left:`${x}px`,top:`${y}px`});
  if(width!=null)node.style.width=`${width}px`;
  if(height!=null)node.style.height=`${height}px`;
  return node;
}
export function panelAsset(ui,key,module='') {
  const catalog=ui.assets?.accountPresentation;
  const resolved=catalog?.modules?.[module]?.embedded?.[key]||key;
  return catalog?.assets?.[resolved]||ui.assets?.get?.(resolved)||ui.ui?.(resolved)||null;
}
export function panelArt(ui,key,x=0,y=0,width=null,height=null,{module='',className='',alt='',priority=0}={}) {
  const asset=typeof key==='string'?panelAsset(ui,key,module):key;
  const node=ui.assets?.menuArt?ui.assets.menuArt(asset,alt,`m84-native-art ${className}`,{nativePriority:priority}):assetImage(asset,alt,`m84-native-art ${className}`);
  at(node,x,y,width??asset?.width,height??asset?.height);
  if(!asset)node.dataset.nativeAssetMissing=String(typeof key==='string'?key:'');
  return node;
}
export function nativeLabel(text,x,y,width,height,{className='',size=14,align='left',color='#fff',bold=true}={}) {
  const node=at(element('span',text,`m84-native-label ${className}`),x,y,width,height);
  Object.assign(node.style,{fontSize:`${size}px`,textAlign:align,color,fontWeight:bold?'700':'400'});
  return node;
}
export function nativeButton(ui,{skin,icon=null,text='',label=text,x=0,y=0,width=null,height=null,
    onClick=null,disabled=false,testId='',title='',className='',module='',iconOffset=null}) {
  const asset=panelAsset(ui,skin,module),button=ui.button('',onClick,{disabled,testId,title:title||label,
    className:`m8-native-button m84-native-button ${className}`});
  button.dataset.nativeSkin='true';button.setAttribute('aria-label',label||'');
  const w=width??asset?.width??0,h=height??asset?.height??0;at(button,x,y,w,h);
  if(asset)button.append(panelArt(ui,asset,0,0,w,h));
  const word=icon&&panelAsset(ui,icon,module);
  if(word)button.append(panelArt(ui,word,iconOffset?.[0]??(w-word.width)/2,iconOffset?.[1]??(h-word.height)/2,word.width,word.height));
  else if(text)button.append(nativeLabel(text,0,0,w,h,{align:'center',className:'m84-button-label'}));
  return button;
}
export function nativeServerSeconds(ui) {
  const clock=ui.client?.lastClock;
  return clock?clock.packet.serverTimeSeconds+Math.max(0,performance.now()-clock.receivedAt)/1000:null;
}
export function nativeCharacterBonus(catalog,appearance,kind) {
  const id=Number(kind==='avatar'?appearance?.avatarId:appearance?.decorateId);
  const row=(kind==='avatar'?catalog?.characters:catalog?.decorations)?.[String(id)];
  if(!row)return '';
  const entries=kind==='avatar'?[['CONTROL_TEXT271',row.reuseD],['CONTROL_TEXT272',row.reuseC]]:
    [['CONTROL_TEXT349',row.reuseC],['CONTROL_TEXT350',row.reuseD]];
  return entries.filter(([,value])=>value>0).map(([key,value])=>(catalog.nativeText?.[key]||'').replace('@num1@',String(value))).filter(Boolean).join(' ');
}
export function characterAsset(ui,itemId) {
  const row=ui.assets?.accountPresentation?.characters?.[String(Number(itemId))];
  return panelAsset(ui,row?.assetKey)||ui.cosmeticIcon?.(ui.cosmetic?.(itemId));
}
export function decorationAsset(ui,itemId,size='big') {
  const row=ui.assets?.accountPresentation?.decorations?.[String(Number(itemId))];
  return panelAsset(ui,row?.[size==='big'?'bigKey':'iconKey'])||ui.ui?.(`cosmetic.${size}.${itemId}`)||
    (size==='icon'?ui.cosmeticIcon?.(ui.cosmetic?.(itemId)):null);
}
export function createCharacterAppearance(ui,appearance,{mode='account',className='',onChooseAvatar=null}={}) {
  const character=appearance||ui.snapshot?.meta?.character||{},profile=mode==='profile';
  const width=profile?214:210,height=profile?306:302;
  const host=at(element('div',null,`m84-character-appearance ${className}`),0,0,width,height);
  host.dataset.nativeCharacterMode=mode;
  host.dataset.avatarId=String(character.avatarId??0);host.dataset.decorateId=String(character.decorateId??0);
  host.append(panelArt(ui,`zh_CN/gui_summer/controls/${profile?'public/charAvatarBk':'char/avatar_bk'}.png`,0,0,width,height));
  const decoration=decorationAsset(ui,character.decorateId,'big');
  // Both native callers center OrnateImg on (105,151), independent of the
  // backing bitmap's 214x306 or 210x302 dimensions. clipContent is false.
  if(decoration)host.append(panelArt(ui,decoration,105-decoration.width/2,151-decoration.height/2,null,null,
    {className:'m84-character-decoration',alt:'Phông nền nhân vật',priority:50}));
  const level=Math.max(0,Math.trunc(Number(character.level)||0));
  const badge=at(element('span',null,'m84-character-level'),profile?-9:-2,profile?7:10,80,40);
  badge.style.transform=`scale(${profile?0.8:0.7})`;
  const levelAsset=ui.assets?.get?.(`chrome.charLevel${level}`);
  if(levelAsset)badge.append(panelArt(ui,levelAsset));
  const effect=level>=11&&ui.assets?.get?.(`chrome.charLevelEffect${Math.min(6,Math.floor((level-11)/5)+1)}`);
  if(effect)badge.append(panelArt(ui,effect,0,0,80,40));
  badge.setAttribute('aria-label',`Cấp ${level}`);host.append(badge);
  const name=nativeLabel(character.name||'',profile?49:48,13,152,24,{align:'center',className:'m84-character-name'});
  name.title=character.name||'';host.append(name);
  let localBody=null;try{localBody=localStorage.getItem('bb-character-body');}catch{}
  const bodyAsset=localBody?panelAsset(ui,localBody):null;
  const avatar=bodyAsset||characterAsset(ui,character.avatarId);
  if(avatar)host.append(panelArt(ui,avatar,profile?12:15,profile?46:44,180,240,{className:'m84-character-body',alt:character.name||'Nhân vật'}));
  else if(Number(character.avatarId)===0){
    host.dataset.nativeAppearanceEmpty='true';
    host.append(nativeLabel('Chưa chọn thời trang',15,143,180,24,{size:12,align:'center',className:'m85-character-empty'}));
    if(onChooseAvatar){
      const choose=nativeButton(ui,{skin:'zh_CN/gui_summer/controls/public/button_3_green.png',text:'Mở túi đồ',
        label:'Chọn thời trang trong túi',x:55,y:177,width:100,height:33,onClick:onChooseAvatar,testId:'profile-choose-outfit'});
      choose.style.pointerEvents='auto';host.append(choose);
    }
  }
  const now=nativeServerSeconds(ui),vip=characterProgress(character,ui.assets.chrome||{levels:{},vip:{}},now);
  if(vip.vip){
    const vipKey=`zh_CN/gui_summer/controls/vip/${vip.superVip?'super/SVIP':'VIP'}${vip.vip}.png`;
    host.append(panelArt(ui,vipKey,profile?133:141,profile?51:45,null,null,{alt:`VIP ${vip.vip}`}));
    const colors=vip.vip<3?[15990034,4495616]:vip.vip<6?[16762622,11141375]:[16777028,16720384];
    name.style.backgroundImage=`linear-gradient(#${colors[0].toString(16).padStart(6,'0')},#${colors[1].toString(16).padStart(6,'0')})`;
    name.classList.add('m84-native-vip-name');
  }
  if(!profile){
    // The source TRY handlers replace only art. Bonus labels continue to show
    // the equipped items until the native notify updates character state.
    const bonusCharacter=mode==='shop'?ui.snapshot?.meta?.character||character:character;
    for(const [kind,y] of [['avatar',273],['decoration',255]]){
      const value=nativeCharacterBonus(ui.assets?.accountPresentation,bonusCharacter,kind);
      if(value)host.append(nativeLabel(value,8.5,y,193,24,{size:13,align:'center',color:'#ffafa3',className:'m84-character-bonus'}));
    }
    for(const [kind,x] of [['material',15],['token',45]]){
      const time=Number(character[`${kind}DoubleTime`])||0,uses=Number(character[`${kind}DoubleUse`])||0;
      if(uses>0||(now!=null&&time>now)){
        const key=`zh_CN/gui_summer/controls/shop/ico_${kind==='material'?'meterial':'golden'}_plus.png`;
        if(panelAsset(ui,key))host.append(panelArt(ui,key,x,50));
      }
    }
  }
  return host;
}
