import {element, assetImage} from './m8_ui_helpers.js';

const PUBLIC='zh_CN/gui_summer/controls/public/';
const INSTRUCTOR='zh_CN/gui_summer/controls/tips/jiaoguan04.png';
const get=(assets,key)=>typeof assets?.get==='function'?assets.get(key):(assets?.assets||assets)?.[key];
function required(assets,key) {
  const asset=get(assets,key);
  if(!asset?.url||!Number.isFinite(asset.width)||!Number.isFinite(asset.height)||asset.width<=0||asset.height<=0)
    throw new Error(`Missing native AskFrame asset: ${key}`);
  return asset;
}
function place(node,x,y,width,height) {
  Object.assign(node.style,{position:'absolute',left:x+'px',top:y+'px'});
  if(width!=null)node.style.width=width+'px';if(height!=null)node.style.height=height+'px';
  return node;
}

/** Native mxml/common/MsgBox geometry. Negative Flash scales are converted to
 * the occupied rectangle before the image is flipped inside that rectangle. */
export function messageBoxGeometry(assets,width=370,height=200) {
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<198||height<102)
    throw new Error('Invalid MsgBox dimensions');
  const corner=required(assets,PUBLIC+'msg_box_r.png'),horizontal=required(assets,PUBLIC+'msg_box_h.png');
  const vertical=required(assets,PUBLIC+'msg_box_v.png'),dot=required(assets,PUBLIC+'orangedot.png');
  const layers=[];
  const add=(name,x,y,w,h,flipX=false,flipY=false)=>layers.push({key:PUBLIC+name+'.png',x,y,width:w,height:h,flipX,flipY});
  add('msg_box_r',0,0,corner.width,corner.height);
  add('msg_box_r',width-corner.width,0,corner.width,corner.height,true);
  add('msg_box_r',0,height-corner.height,corner.width,corner.height,false,true);
  add('msg_box_r',width-corner.width,height-corner.height,corner.width,corner.height,true,true);
  add('msg_box_h',99,4,width-198,horizontal.height);
  add('msg_box_h',99,height-4-horizontal.height,width-198,horizontal.height,false,true);
  add('msg_box_v',4,51,vertical.width,height-102);
  add('msg_box_v',width-4-vertical.width,51,vertical.width,height-102,true);
  for(const x of [24,width-24-dot.width])for(const y of [23,height-23-dot.height])add('orangedot',x,y,dot.width,dot.height);
  return {width,height,background:{x:16,y:16,width:width-36,height:height-34,color:'#0067b6'},layers};
}

export function createMessageBox(assets,width=370,height=200) {
  const geometry=messageBoxGeometry(assets,width,height),root=element('div',null,'m82-message-box');
  Object.assign(root.style,{width:width+'px',height:height+'px'});
  const background=place(element('div',null,'m82-message-box-background'),geometry.background.x,geometry.background.y,geometry.background.width,geometry.background.height);
  background.style.backgroundColor=geometry.background.color;
  const texture=required(assets,PUBLIC+'bk_s.png');
  background.append(place(assetImage(texture,'','m82-ask-art'),(geometry.background.width-texture.width)/2,(geometry.background.height-texture.height)/2,texture.width,texture.height));
  root.append(background);
  for(const r of geometry.layers) {
    const image=place(assetImage(required(assets,r.key),'','m82-ask-art'),r.x,r.y,r.width,r.height);
    if(r.flipX||r.flipY)image.style.transform=`scale(${r.flipX?-1:1},${r.flipY?-1:1})`;
    root.append(image);
  }
  return {root,geometry};
}

/** Retains caller-owned handlers, disabled state and test IDs. Default placement
 * follows AskFrame (450x220, inner x45, MsgBox370x200, buttons y133).
 * A third action extends the MsgBox by40px for the HTML5 unsaved-draft guard. */
export function createCommonAsk({assets,message,confirm,cancel,extra=null,label='Xác nhận',onCancel=null}) {
  const root=element('section',null,'m82-common-ask');
  root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label',label);
  root.style.width='450px';root.style.height=(extra?260:220)+'px';
  const frame=createMessageBox(assets,370,extra?240:200);place(frame.root,45,0);root.append(frame.root);
  const copy=place(element('p',message,'m82-ask-message'),102,38,270,90);root.append(copy);
  const instructor=required(assets,INSTRUCTOR);root.append(place(assetImage(instructor,'','m82-ask-art m82-ask-instructor'),450-350-instructor.width,-76,instructor.width,instructor.height));
  function button(node,x,y,color) {
    if(!node)return;
    const skin=required(assets,PUBLIC+`button_3_${color}.png`);
    node.classList.add('m82-ask-button');node.style.backgroundImage=`url("${skin.url}")`;
    place(node,x,y,skin.width,skin.height);root.append(node);
  }
  button(confirm,120,133,'green');button(cancel,240,133,'blue');button(extra,180,179,'blue');
  root.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&onCancel){event.preventDefault();event.stopPropagation();onCancel();return;}
    if(event.key!=='Tab')return;
    const buttons=[confirm,cancel,extra].filter(node=>node&&!node.disabled&&!node.hidden);
    if(!buttons.length)return;
    event.preventDefault();const index=buttons.indexOf(document.activeElement);
    buttons[(index+(event.shiftKey?-1:1)+buttons.length)%buttons.length].focus();
  });
  return {root,confirm,cancel,extra,initialFocus:extra||cancel||confirm,geometry:frame.geometry};
}
