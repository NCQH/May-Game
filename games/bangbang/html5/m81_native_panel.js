// Geometry transcribed from mxml/common/Box1.as, Box2.as (as3_tanklib_full),
// and Box4.as (as3_tank_upgrade_native). All dimensions are native Flash pixels.
// The enclosing viewport, not this module, owns responsive scaling.
const STATES = {box1:['','BOTTOM_BAR','CONFIRM','DEL_BTN_BG','NOT_SHADOW'],box2:['','NOBG','NO_SHADOW'],box4:[''],box3:['','SHADOW','DARK_BG','LIGHT_BG']};
function assetFor(assets,key) {
  const asset=assets[key];
  if(!asset || !Number.isFinite(asset.width) || !Number.isFinite(asset.height) || asset.width<=0 || asset.height<=0 || typeof asset.url!=='string' || !/^\/(?!\/)[^\s"<>]+\.png$/.test(asset.url)) throw new Error(`Missing or invalid native panel asset: ${key}`);
  return asset;
}
export function panelGeometry({assets,width,height,kind='box1',state=''}={}) {
  assets=assets?.assets || assets;
  if(!STATES[kind]?.includes(state)) throw new Error(`Unsupported native panel: ${kind}/${state}`);
  const minimum=kind==='box3'?[36,36]:kind==='box4'?[38,38]:kind==='box2'?[268,148]:[182,state==='CONFIRM'||state==='DEL_BTN_BG'?174:state==='BOTTOM_BAR'?156:147];
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<minimum[0]||height<minimum[1]) throw new Error('Native panel dimensions are too small or invalid');
  if(!assets) throw new Error('Native panel assets are required');
  const layers=[];
  function add(name,x,y,w,h,extra={}) {
    const key=`box.${name}`,a=assetFor(assets,key);
    const rect={key,x,y,width:w??a.width,height:h??a.height,...extra};layers.push(rect);return rect;
  }
  const aw=name=>assetFor(assets,`box.${name}`).width;
  const ah=name=>assetFor(assets,`box.${name}`).height;
  let background;
  if(kind==='box1') {
    background={x:12,y:43,width:width-24,height:height-56,color:'#5db8e9',texture:state==='NOT_SHADOW'?null:'box.bk_s',center:true};
    const confirm=state==='CONFIRM'||state==='DEL_BTN_BG',bar=state==='BOTTOM_BAR';
    const bottom=confirm?90:bar?72:63,lb=confirm?'bk_bc':bar?'bk_bb':'bk_lb',rb=confirm?'bk_bc_r':bar?'bk_bb_r':'bk_rb',b=confirm?'bk_b2':bar?'bk_b3':'bk_b';
    add('bk_lt',0,0);add('bk_rt',width-aw('bk_rt'),0);
    add(lb,0,height-ah(lb));add(rb,width-aw(rb),height-ah(rb));
    add('bk',34,0,width-68);add(b,30,height-ah(b),width-60);
    add('bk_l',0,84,undefined,height-84-bottom);add('bk_r',width-aw('bk_r'),84,undefined,height-84-bottom);
    add('bk_ti',(width-aw('bk_ti'))/2,18);
    add('bk_oc',43,9,width-86);add('bk_ol',35,9);add('bk_or',width-35-aw('bk_or'),9);
    add('bk_c',width-13-aw('bk_c'),13);
    if(state==='CONFIRM')add('window_button_bk',(width-aw('window_button_bk'))/2,height-13-ah('window_button_bk'));
  } else if(kind==='box2') {
    if(state!=='NOBG')background={x:30,y:49,width:width-60,height:height-62,color:'#5db8e9',texture:state==='NO_SHADOW'?null:'box.bk_s',center:true};
    add('bk2_lt',0,16);add('bk2_rt',width-aw('bk2_rt'),16);
    add('bk2_lb',0,height-ah('bk2_lb'));add('bk2_rb',width-aw('bk2_rb'),height-ah('bk2_rb'));
    add('bk2',48,36,width-96);add('bk2_b',48,height-ah('bk2_b'),width-96);
    add('bk2_l',17,92,undefined,height-148);add('bk2_r',width-17-aw('bk2_r'),92,undefined,height-148);
    add('bk2_tt',(width-aw('bk2_tt'))/2,16);
    // Flash y=59, scaleY=-1: the image occupies 54..59, not 59..64.
    add('bk_oc',(width-aw('bk_oc')*.252)/2,59-ah('bk_oc'),aw('bk_oc')*.252,undefined,{flipY:true});
    add('bk_ol',(width-aw('bk_ol'))/2-130,59-ah('bk_ol'),undefined,undefined,{flipY:true});
    add('bk_or',(width-aw('bk_or'))/2+130,59-ah('bk_or'),undefined,undefined,{flipY:true});
  } else if(kind==='box3') {
    // Box3 color states hide cimagechecklocal1 and color canvas1 directly.
    const solid={DARK_BG:'#029ddf',LIGHT_BG:'#24a9e3'}[state];
    background={x:8,y:8,width:width-16,height:height-16,color:solid||'#0c6ba3',texture:solid?null:'box.bk3_c',textureWidth:1000,textureHeight:height-16,center:false};
    if(state==='SHADOW')background.overlay={key:'box.bk3_s',x:-340,y:-230,opacity:0.5};
    add('bk3_l',0,18,undefined,height-36);add('bk3_r',width-18,18,undefined,height-36);
    add('bk3',18,0,width-36);add('bk3_b',18,height-18,width-36);
    add('bk3_lt',0,0);add('bk3_rt',width-18,0);add('bk3_lb',0,height-18);add('bk3_rb',width-18,height-18);
  } else {
    background={x:19,y:19,width:width-38,height:height-38,color:'#0093d7',texture:'box.listbk_bg',textureWidth:1000,textureHeight:1000,center:false};
    add('listbk_radius',0,0);add('listbk_rb',width-aw('listbk_rb'),height-ah('listbk_rb'));
    add('listbk_lb',0,height-ah('listbk_lb'));add('listbk_rt',width-aw('listbk_rt'),0);
    add('listbk_tb',19,0,width-38);add('listbk_b',19,height-ah('listbk_b'),width-38);
    add('listbk_lr',0,19,undefined,height-38);add('listbk_r',width-aw('listbk_r'),19,undefined,height-38);
  }
  if(background?.texture)assetFor(assets,background.texture);
  return {kind,state,width,height,background,layers};
}
function position(node,r) {Object.assign(node.style,{position:'absolute',left:`${r.x}px`,top:`${r.y}px`,width:`${r.width}px`,height:`${r.height}px`});}
function image(assets,r) {
  const node=document.createElement('img');node.className='m81-native-panel-art';node.alt='';node.draggable=false;node.src=assetFor(assets,r.key).url;
  position(node,r);if(r.flipY)node.style.transform='scaleY(-1)';return node;
}
/** title/close: {asset: catalog key, x, y, width?, height?, label?}.
 * Coordinates belong to the caller's native screen source, not generic Box classes.
 * CSS must be linked by the host. content origin is always (0,0).
 */
export function createNativePanel(options) {
  const assets=options.assets?.assets||options.assets,geometry=panelGeometry(options);
  const root=document.createElement('div');root.className=`m81-native-panel m81-native-${geometry.kind}`;
  root.dataset.nativePanel=geometry.kind;root.dataset.nativeState=geometry.state;
  root.style.width=`${geometry.width}px`;root.style.height=`${geometry.height}px`;
  const frame=document.createElement('div');frame.className='m81-native-panel-frame';frame.setAttribute('aria-hidden','true');
  if(geometry.background) {
    const bg=geometry.background,node=document.createElement('div');node.className='m81-native-panel-background';position(node,bg);node.style.backgroundColor=bg.color;
    if(bg.texture) {
      const a=assetFor(assets,bg.texture),w=bg.textureWidth??a.width,h=bg.textureHeight??a.height;
      node.append(image(assets,{key:bg.texture,x:bg.center?(bg.width-w)/2:0,y:bg.center?(bg.height-h)/2:0,width:w,height:h}));
    }
    if(bg.overlay){const a=assetFor(assets,bg.overlay.key),overlay=image(assets,{...bg.overlay,width:a.width,height:a.height});overlay.style.opacity=String(bg.overlay.opacity);node.append(overlay);}
    frame.append(node);
  }
  for(const layer of geometry.layers)frame.append(image(assets,layer));
  const content=document.createElement('div');content.className='m81-native-panel-content';root.append(frame,content);
  function descriptor(d) {
    const a=assetFor(assets,d.asset);
    if(!Number.isFinite(d.x)||!Number.isFinite(d.y))throw new Error('Native title/close coordinates are required');
    const r={key:d.asset,x:d.x,y:d.y,width:d.width??a.width,height:d.height??a.height};
    if(!Number.isFinite(r.width)||!Number.isFinite(r.height)||r.width<=0||r.height<=0)throw new Error('Invalid native title/close size');return r;
  }
  if(options.title) {const node=image(assets,descriptor(options.title));node.className+=' m81-native-panel-title';node.alt=options.title.label||'';root.append(node);}
  let close=null;
  if(options.close) {
    const r=descriptor(options.close);close=document.createElement('button');close.type='button';close.className='m81-native-panel-close';close.setAttribute('aria-label',options.close.label||'Đóng');position(close,r);
    close.append(image(assets,{...r,x:0,y:0}));if(options.onClose)close.addEventListener('click',options.onClose);root.append(close);
  }
  return {root,content,frame,close,geometry};
}
