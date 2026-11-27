import {element, actionButton, field, selectInput, note} from './m8_ui_helpers.js';
import {createNativePanel} from './m81_native_panel.js';
import {rendererPreference, saveRendererPreference} from './sprite_surface.js';
import {nativeEventKey,quickcastSlots,DEFAULT_QUICKCAST_SLOTS} from './m81_input_options.js';
import {M85_SETTINGS_ASSETS} from './m85_settings_assets.js';
import {nativeMenuFilters} from './m83_chrome.js';

let settingsFilterSequence=0;

// SystemSetModel.ARR_DEFAULT_KEY / ARR_CAN_SET_KEY; SettingsBattleProxy.initView.
// These are native action identities, not the keyboard's current bindings.
export const SETTINGS_KEYS = Object.freeze([
  [82,'Skill 1'],[69,'Skill 2'],[32,'Tuyệt chiêu'],[81,'Skill Guild'],
  [1000,'Xạ kích'],[1001,'Tự động bắn'],[71,'Thông tin chiến trường'],
  [70,'Phun sơn xe'],[90,'Công'],[88,'Rút lui'],[67,'Tập hợp'],[66,'Về thành'],[72,'Thuộc tính Tank'],
].map(([code,label])=>Object.freeze({code,label})));
export const ALLOWED_SETTING_KEYS = Object.freeze([
  ...'BCEFGHIJKLMNOPQRTUVXYZ'.split('').map(k=>k.charCodeAt(0)),
  ...Array.from({length:10},(_,i)=>48+i),32,1000,1001,...Array.from({length:10},(_,i)=>96+i),
]);
export const QUICKCAST_SLOTS = Object.freeze([10,1,2,4]);
export const SETTINGS_FLAGS = Object.freeze([
  {bit:65536,label:'Chỉ nhận lời mời từ bạn bè'},
  {bit:2097152,label:'Chỉ nhận lời mời Guild từ bạn bè'},
]);
export function settingKeyName(code) {
  if(code===0)return 'Chưa gán';
  if(code===32)return 'Space';
  if(code===1000)return 'Chuột trái';
  if(code===1001)return 'Chuột phải';
  if(code>=96&&code<=105)return `Num ${code-96}`;
  return ALLOWED_SETTING_KEYS.includes(code)?String.fromCharCode(code):`Phím ${code}`;
}
export function settingsBindings(keyBoardSet=[]) {
  const result=Object.fromEntries(SETTINGS_KEYS.map(row=>[row.code,row.code]));
  for(const pair of keyBoardSet) {
    const match=/^(\d+)-(\d+)$/.exec(pair);
    if(match && Object.hasOwn(result,Number(match[1])))result[Number(match[1])]=Number(match[2]);
  }
  return result;
}
export function bindSettingsKey(pairs,action,key) {
  if(!SETTINGS_KEYS.some(row=>row.code===action)||!ALLOWED_SETTING_KEYS.includes(key))throw new Error('Phím không được phép sử dụng.');
  const bindings=settingsBindings(pairs);
  const conflict=SETTINGS_KEYS.find(row=>row.code!==action&&bindings[row.code]===key);
  if(conflict)throw new Error(`${settingKeyName(key)} đang dùng cho ${conflict.label}. Hãy đổi phím đó trước.`);
  // Keep unknown action mappings from newer native clients unchanged.
  return [...pairs.filter(pair=>!new RegExp(`^${action}-`).test(pair)),...(action===key?[]:[`${action}-${key}`])];
}
export function toggleQuickcast(slots,slot,enabled) {
  if(!QUICKCAST_SLOTS.includes(slot))throw new Error('Ô kỹ năng không hợp lệ.');
  return enabled?[...new Set([...slots,slot])]:slots.filter(value=>value!==slot);
}
export function setSettingsFlag(flags,bit,enabled) {
  if(!SETTINGS_FLAGS.some(row=>row.bit===bit))throw new Error('Thiết lập không hợp lệ.');
  return (enabled?(flags|bit):(flags&~bit))>>>0;
}
export const DEFAULT_SUPPORTED_ACTIONS = Object.freeze([82,69,32,1000]);
export const DEFAULT_SUPPORTED_QUICKCAST = DEFAULT_QUICKCAST_SLOTS;
export function visibleSettingsKeys(supported=DEFAULT_SUPPORTED_ACTIONS){return SETTINGS_KEYS.filter(row=>supported.includes(row.code));}
export function visibleQuickcastSlots(supported=DEFAULT_SUPPORTED_QUICKCAST){return QUICKCAST_SLOTS.filter(slot=>supported.includes(slot));}
// MathScriptTemplate_table.xml nId129; SystemSetModel.setInitKey evaluates by index.
// Native reset is NOT identity: native action F(70) resets to T(84).
export const NATIVE_RESET_KEYS = Object.freeze([82,69,32,81,1000,1001,71,84,90,88,67,66,72]);
/** Reset supported bindings; preserve unsupported mappings and passive slot3. */
export function resetSupportedSettings(options={},supportedActions=DEFAULT_SUPPORTED_ACTIONS,supportedQuickcast=DEFAULT_SUPPORTED_QUICKCAST){
  const actions=new Set(supportedActions);
  if([...actions].some(code=>!SETTINGS_KEYS.some(row=>row.code===code))||supportedQuickcast.some(slot=>!QUICKCAST_SLOTS.includes(slot)))throw new Error('Điều khiển khôi phục không hợp lệ.');
  const next={keyBoardSet:[...(options.keyBoardSet||[])],skillSlot:[...(options.skillSlot||[])]};
  next.keyBoardSet=next.keyBoardSet.filter(pair=>{const match=/^(\d+)-/.exec(pair);return !match||!actions.has(Number(match[1]));});
  SETTINGS_KEYS.forEach(({code},index)=>{if(actions.has(code)&&code!==NATIVE_RESET_KEYS[index])next.keyBoardSet.push(`${code}-${NATIVE_RESET_KEYS[index]}`);});
  const bindings=settingsBindings(next.keyBoardSet);
  for(const row of SETTINGS_KEYS.filter(row=>actions.has(row.code))){
    const conflict=SETTINGS_KEYS.find(other=>other.code!==row.code&&bindings[other.code]===bindings[row.code]);
    if(conflict)throw new Error(`Không thể khôi phục: ${settingKeyName(bindings[row.code])} đang dùng cho ${conflict.label}. Các thiết lập chưa thay đổi.`);
  }
  for(const slot of supportedQuickcast)if(!next.skillSlot.includes(slot))next.skillSlot.push(slot);
  return next;
}
// SystemSetFrame CImageCheckLocal center offsets, and tab x/y from native MXML.
export function settingsSkinGeometry(assets={}) {
  return [['bg',0,0],['inner',66,-9],['title',0,-221]].flatMap(([name,dx,dy])=>{
    const asset=assets[`settings.${name}`];
    return asset&&Number.isFinite(asset.width)&&Number.isFinite(asset.height)?[{key:`settings.${name}`,x:Math.round((726-asset.width)/2)+dx,y:Math.round((510-asset.height)/2)+dy,width:asset.width,height:asset.height}]:[];
  });
}
function skinImage(asset,rect={}) {
  const node=element('img',null,'m81-settings-art');node.alt='';node.draggable=false;node.src=asset.url;
  for(const [name,value] of Object.entries({left:rect.x,top:rect.y,width:rect.width??asset.width,height:rect.height??asset.height}))if(value!=null)node.style[name]=`${value}px`;
  return node;
}
const copyOptions=options=>({keyBoardSet:[...(options?.keyBoardSet||[])],skillSlot:quickcastSlots(options)});
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

// Literal BattleSettings descriptor coordinates. B/H are hidden by the active
// locale/configuration; native action identities remain in SETTINGS_KEYS.
export const NATIVE_SETTINGS_ROWS=Object.freeze([
  [82,30,137,258,136],[69,30,160,258,160],[32,30,185,258,184],[81,30,209,258,209],
  [1000,30,232,120,235],[1001,30,257,120,259],[71,30,280,120,283],
  [70,30,306,120,307],[90,210,232,300,234],[88,210,257,300,259],[67,210,280,300,282],
].map(([code,labelX,labelY,keyX,keyY])=>Object.freeze({code,labelX,labelY,keyX,keyY})));
export function setAllQuickcast(slots,enabled,supported=DEFAULT_SUPPORTED_QUICKCAST){
  return supported.reduce((next,slot)=>toggleQuickcast(next,slot,enabled),[...slots]);
}
function position(node,x,y,width,height){
  Object.assign(node.style,{position:'absolute',left:`${x}px`,top:`${y}px`});
  if(width!=null)node.style.width=`${width}px`;if(height!=null)node.style.height=`${height}px`;
  return node;
}
function displayKeyName(code){return code===32?'P. Cách':code===1000?'Chuột Trái':code===1001?'Chuột Phải':settingKeyName(code);}

/** Server data is authoritative. Editing never updates battle input directly. */
export class M81Settings {
  constructor({host,client,run=work=>work(),getBattleView=()=>null,menuAudio=null,onClose=()=>{},onFullscreen=null,supportedActions=DEFAULT_SUPPORTED_ACTIONS,supportedQuickcast=DEFAULT_SUPPORTED_QUICKCAST,assets=null}) {
    Object.assign(this,{host,client,run,getBattleView,menuAudio,onClose,onFullscreen,
      assets:assets?{...(assets.assets||assets),...M85_SETTINGS_ASSETS}:null,
      supportedActions:[...supportedActions],supportedQuickcast:[...supportedQuickcast]});
    this.disposed=false;this.epoch=0;this.identity=null;this.generation=client.generation;
    this.snapshot=null;this.base=null;this.draft=null;this.pending=false;this.leaving=false;this.notice='';this.tab='battle';this.captureAction=null;
    this.content=element('section',null,'m81-settings');
    this.content.setAttribute('aria-label','Cài đặt');
    this.content.tabIndex=-1;
    this.handleKeyDown=event=>{
      event.stopPropagation();
      if(event.key==='Escape'){
        event.preventDefault();
        if(this.captureAction!=null){this.captureAction=null;this.notice='';this.render();}
        else if(!this.pending)this.close();
        return;
      }
      if(this.captureAction!=null){
        event.preventDefault();
        if(!event.repeat&&!event.ctrlKey&&!event.metaKey&&!event.altKey)this.captureKey(nativeEventKey(event));
        return;
      }
      if(event.key==='Tab'){
        const list=[...this.host.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')].filter(node=>!node.hidden);
        if(!list.length){event.preventDefault();return;}
        const index=list.indexOf(document.activeElement);
        if(event.shiftKey&&(index<=0)||!event.shiftKey&&(index<0||index===list.length-1)){
          event.preventDefault();list[event.shiftKey?list.length-1:0].focus({preventScroll:true});
        }
      }
    };
    this.host.addEventListener('keydown',this.handleKeyDown);
    this.stopKeyUp=event=>event.stopPropagation();this.host.addEventListener('keyup',this.stopKeyUp);
    // Firefox cannot reliably paint an HTML button through a filter whose SVG
    // lives under the hidden lobby. Mount the identical native +30 RGB filter
    // in this visible surface, including when the battle is fullscreen.
    const filters=nativeMenuFilters(),prefix=`m85-settings-${++settingsFilterSequence}-`;
    for(const filter of filters.querySelectorAll('filter'))filter.id=filter.id.replace('m83-native-',prefix);
    this.host.style.setProperty('--m85-settings-highlight',`url("#${prefix}highlight")`);
    const css=element('link'),cssUrl=new URL('./m81_settings.css',import.meta.url);
    cssUrl.search=new URL(import.meta.url).search;
    css.rel='stylesheet';css.href=cssUrl.href;
    if(this.assets){
      this.panel=createNativePanel({assets:this.assets,width:726,height:510,kind:'box1',
        close:this.assets['public.close']?{asset:'public.close',x:687,y:14,label:'Đóng'}:undefined,onClose:()=>this.close()});
      this.content.classList.add('m81-settings-skinned');
      const geometry=settingsSkinGeometry(this.assets);
      if(this.assets['settings.bg'])this.panel.frame.replaceChildren();
      for(const rect of geometry)this.panel.frame.append(skinImage(this.assets[rect.key],rect));
      this.panel.content.append(this.content);host.replaceChildren(css,filters,this.panel.root);
    }else host.replaceChildren(css,filters,this.content);
  }
  get mutable(){return !this.disposed&&!this.pending&&this.snapshot?.phase==='ready'&&!this.snapshot?.play?.busy&&['lobby','room','scene'].includes(this.snapshot?.play?.phase);}
  get changed(){return this.base&&(!equal(this.base.options,this.draft.options)||this.base.settingFlag!==this.draft.settingFlag);}
  update(snapshot) {
    if(this.disposed)return;
    const identity=snapshot?.accountId??snapshot?.meta?.character?.accountId??null;
    if(identity!==this.identity||this.generation!==this.client.generation){
      this.epoch++;this.identity=identity;this.generation=this.client.generation;this.base=null;this.draft=null;this.pending=false;this.leaving=false;this.notice='';this.captureAction=null;
    }
    this.snapshot=snapshot;
    const settings=snapshot?.meta?.settings;
    // Combat packets update the outer snapshot frequently. Only actual server
    // settings, input availability or battle sound state affect this update.
    // Local audio controls paint their own edits; including their preferences
    // here would replace a range input mid-drag on the next combat packet.
    const updateKey=JSON.stringify([identity,this.generation,snapshot?.phase,snapshot?.play?.phase,
      snapshot?.play?.busy,settings,this.getBattleView?.()?.roboSoundWanted]);
    if(updateKey===this.lastSettingsUpdateKey)return;
    this.lastSettingsUpdateKey=updateKey;
    if(settings){
      const next={settingFlag:settings.settingFlag>>>0,options:copyOptions(settings.options)};
      if(!this.base){this.base=next;this.draft={settingFlag:next.settingFlag,options:copyOptions(next.options)};}
      else if(!this.pending){
        const changedBits=(this.draft.settingFlag^this.base.settingFlag)>>>0;
        this.draft.settingFlag=((next.settingFlag&~changedBits)|(this.draft.settingFlag&changedBits))>>>0;
        for(const key of ['keyBoardSet','skillSlot'])if(equal(this.draft.options[key],this.base.options[key]))this.draft.options[key]=[...next.options[key]];
        this.base=next;
      }
    }
    this.render();
  }
  close(){if(!this.pending&&!this.disposed)this.run(()=>this.applyAndClose());}
  async applyAndClose(){
    if(this.pending||this.disposed)return;
    const epoch=this.epoch;
    if(this.changed){if(!this.mutable)return;await this.save();}
    if(!this.disposed&&epoch===this.epoch&&!this.changed)this.onClose();
  }
  async leaveBattle(){
    if(!this.mutable||this.snapshot?.play?.phase!=='scene'||typeof this.client.leaveRoom!=='function')return;
    const epoch=this.epoch,generation=this.client.generation;
    if(this.changed)await this.save();
    if(this.disposed||epoch!==this.epoch||generation!==this.client.generation||this.changed||!this.mutable||this.snapshot?.play?.phase!=='scene')return;
    // Preserve the old battle settings menu's ordinary native leave path. Some
    // native room types deliberately hide the separate HUD exit button.
    this.pending=true;this.leaving=true;this.notice='Đang rời trận…';this.render();
    try{
      this.getBattleView?.()?.input?.releaseAll('leave-settings');
      await this.client.leaveRoom();
      if(!this.disposed&&epoch===this.epoch&&generation===this.client.generation)this.onClose();
    }catch(error){
      if(!this.disposed&&epoch===this.epoch&&generation===this.client.generation)this.notice=error.message;
      throw error;
    }finally{
      if(!this.disposed&&epoch===this.epoch&&generation===this.client.generation){this.pending=false;this.leaving=false;this.render();}
    }
  }
  toggleFullscreen(){
    if(!this.mutable||this.changed||this.snapshot?.play?.phase!=='scene'||typeof this.onFullscreen!=='function')return;
    // Keep the click's transient activation. Closing before the fullscreen
    // request also prevents a body-level modal being left outside its subtree.
    const action=this.onFullscreen;this.onClose();return action();
  }
  editKey(action,key){if(!this.mutable)return;try{this.draft.options.keyBoardSet=bindSettingsKey(this.draft.options.keyBoardSet,action,key);this.notice='';}catch(error){this.notice=error.message;}this.render();}
  resetDisplayed(){
    if(!this.mutable||!this.draft)return;
    try{this.draft.options=resetSupportedSettings(this.draft.options,this.supportedActions,this.supportedQuickcast);this.notice='Đã khôi phục phím và bật thi triển nhanh. Bấm OK để lưu.';}
    catch(error){this.notice=error.message;}
    this.render();
  }
  async save(){
    if(!this.mutable||!this.changed)return;
    const epoch=this.epoch;
    const desired={settingFlag:this.draft.settingFlag,options:copyOptions(this.draft.options)};
    const before={settingFlag:this.base.settingFlag,options:copyOptions(this.base.options)};
    this.pending=true;this.notice='';this.render();
    try{
      const changes={};for(const key of ['keyBoardSet','skillSlot'])if(!equal(before.options[key],desired.options[key]))changes[key]=desired.options[key];
      if(Object.keys(changes).length){
        await this.client.savePlayerOptions(changes);
        if(this.disposed||epoch!==this.epoch)return;
        const actual=this.snapshot?.meta?.settings?.options;
        if(!Object.keys(changes).every(key=>equal(actual?.[key],changes[key])))throw new Error('Chưa nhận được thiết lập phím khớp từ máy chủ.');
        for(const key of Object.keys(changes))this.base.options[key]=[...changes[key]];
      }
      if(before.settingFlag!==desired.settingFlag){
        const mask=(before.settingFlag^desired.settingFlag)>>>0;
        const current=this.snapshot.meta.settings.settingFlag>>>0;
        const flags=((current&~mask)|(desired.settingFlag&mask))>>>0;
        await this.client.saveSettingFlags(flags);
        if(this.disposed||epoch!==this.epoch)return;
        if((this.snapshot?.meta?.settings?.settingFlag>>>0)!==flags)throw new Error('Chưa nhận được thiết lập khớp từ máy chủ.');
        this.base.settingFlag=flags;this.draft.settingFlag=flags;
      }
      this.notice='Đã lưu cài đặt.';
    }catch(error){if(!this.disposed&&epoch===this.epoch)this.notice=error.message;throw error;}
    finally{if(!this.disposed&&epoch===this.epoch){this.pending=false;this.render();}}
  }
  button(label,work,options={}){return actionButton(label,()=>this.run(work),options);}
  artwork(key,x,y){const asset=this.assets?.[`settings.${key}`];return asset?skinImage(asset,{x,y}):null;}
  artButton(key,label,x,y,work,{icon=null,disabled=false,testId=''}={}){
    const asset=this.assets?.[`settings.${key}`],button=this.button(asset?'':label,work,{disabled,className:'m85-settings-button',testId});
    button.setAttribute('aria-label',label);button.title=label;
    position(button,x,y,asset?.width,asset?.height);
    if(asset)button.append(skinImage(asset,{x:0,y:0}));
    const word=this.assets?.[`settings.${icon}`];if(word)button.append(skinImage(word,{x:(asset.width-word.width)/2,y:(asset.height-word.height)/2}));
    return button;
  }
  nativeCheck(label,checked,x,y,change,{disabled=!this.mutable,testId='',local=false}={}){
    const asset=this.assets?.['settings.unchecked'],mark=this.assets?.['settings.checked'];
    const host=position(element('label',null,'m85-settings-check'),x,y,Math.max(asset?.width||24,mark?.width||24),Math.max(asset?.height||24,mark?.height||24));
    const input=element('input');input.type='checkbox';input.checked=checked;input.disabled=disabled;
    input.setAttribute('aria-label',label);input.dataset.focusKey=testId||label;if(testId)input.dataset.testid=testId;
    const image=this.artwork(checked?'checked':'unchecked',0,0);if(image)host.append(image);
    host.append(input);host.title=label;
    input.addEventListener('change',()=>{if(!input.disabled&&(local||this.mutable)){change(input.checked);this.render();}});
    return host;
  }
  startCapture(action){if(this.mutable&&this.supportedActions.includes(action)){this.captureAction=action;this.notice='';this.render();}}
  captureKey(key){
    if(!this.mutable||this.captureAction==null)return;
    try{this.draft.options.keyBoardSet=bindSettingsKey(this.draft.options.keyBoardSet,this.captureAction,key);this.captureAction=null;this.notice='';}
    catch(error){this.notice=error.message;}
    this.render();
  }
  renderBattle(body){
    body.classList.add('m85-settings-battle');
    for(const [key,x,y,center] of [
      ['hotkey',20,9,false],['battleInner1',0,49,true],['keyHeader',29,112,true],
      ['quickHeader',111,111,true],['battleInner2',-45,134,true],['castingBackground',32,60,true],['help',428,108,false],
    ]){
      const asset=this.assets?.[`settings.${key}`];if(!asset)continue;
      const node=this.artwork(key,center?Math.round((531-asset.width)/2)+x:x,y);body.append(node);
    }
    const help=position(element('span',null,'m85-settings-help'),428,108,24,24);
    help.tabIndex=0;help.setAttribute('aria-label','Hướng dẫn thi triển nhanh');help.title='Bật thi triển nhanh để dùng kỹ năng ngay theo vị trí chuột. Bỏ chọn để ngắm rồi bấm chuột trái.';body.append(help);
    const reset=this.assets?.['settings.reset'];
    body.append(this.artButton('reset','Về mặc định',531-(reset?.width||110),9,()=>this.resetDisplayed(),{disabled:!this.mutable,testId:'m81-settings-reset'}));
    for(const [enabled,key,icon,x,label] of [[false,'normalButton','normalLabel',148,'Thi triển thường hết'],[true,'fastButton','fastLabel',296,'Thi triển nhanh hết']]){
      body.append(this.artButton(key,label,x,61,()=>{
        if(!this.mutable)return;this.draft.options.skillSlot=setAllQuickcast(this.draft.options.skillSlot,enabled,this.supportedQuickcast);this.notice='';this.render();
      },{icon,disabled:!this.mutable,testId:enabled?'m85-all-fast':'m85-all-normal'}));
    }
    const bindings=settingsBindings(this.draft.options.keyBoardSet),frame=this.assets?.['settings.keyFrame'];
    for(const row of NATIVE_SETTINGS_ROWS){
      const setting=SETTINGS_KEYS.find(item=>item.code===row.code),supported=this.supportedActions.includes(row.code);
      const label=position(element('span',setting.label,'m85-settings-row-label'),row.labelX,row.labelY,100,22);label.title=setting.label;body.append(label);
      const key=this.artButton('keyFrame',`Đổi phím ${setting.label}`,row.keyX,row.keyY,()=>this.startCapture(row.code),{disabled:!this.mutable||!supported,testId:`m81-key-${row.code}`});
      key.classList.add('m85-settings-key');key.dataset.focusKey=`m81-key-${row.code}`;
      key.append(position(element('span',displayKeyName(bindings[row.code]),'m85-settings-key-label'),0,0,frame?.width||76,frame?.height||18));
      if(!supported){key.classList.add('m85-settings-unavailable');key.title=`${setting.label}: chức năng chưa mở`;}
      body.append(key);
    }
    QUICKCAST_SLOTS.forEach((slot,index)=>body.append(this.nativeCheck(`Thi triển nhanh ${SETTINGS_KEYS[index].label}`,this.draft.options.skillSlot.includes(slot),364,[131,155,180,204][index],enabled=>{
      this.draft.options.skillSlot=toggleQuickcast(this.draft.options.skillSlot,slot,enabled);this.notice='';
    },{disabled:!this.mutable||!this.supportedQuickcast.includes(slot),testId:`m85-quick-${slot}`})));
  }
  renderCapture(){
    const shade=element('div',null,'m85-settings-capture-shade'),dialog=element('div',null,'m85-settings-capture');
    dialog.tabIndex=-1;dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','Đổi phím');
    const row=SETTINGS_KEYS.find(item=>item.code===this.captureAction);
    dialog.append(element('strong',`Bấm phím cho ${row.label}`),element('span','Bấm Esc để hủy'),element('p',this.notice||'','m85-settings-capture-error'));
    shade.append(dialog);shade.addEventListener('mousedown',event=>{event.preventDefault();event.stopPropagation();this.captureKey(nativeEventKey(event));});
    shade.addEventListener('contextmenu',event=>event.preventDefault());
    return {shade,dialog};
  }
  renderAudio(body){
    body.classList.add('m85-settings-audio');
    if(!this.menuAudio){body.append(note('Âm thanh giao diện chưa sẵn sàng.'));return;}
    const preferences=this.menuAudio.preferences;
    const apply=changes=>{
      this.menuAudio.setPreferences(changes);
      this.notice=this.menuAudio.storageSaved?'Đã lưu âm thanh.':'Đã áp dụng âm thanh; trình duyệt hiện không cho lưu lựa chọn.';
    };
    for(const [key,x,y] of [['musicLabel',67,83],['musicVolumeLabel',67,140],['effectsLabel',67,228],['effectsVolumeLabel',67,278]]){
      const art=this.artwork(key,x,y);if(art)body.append(art);
    }
    for(const [kind,label,y,sliderY] of [['music','Nhạc nền',80,132],['effects','Hiệu ứng âm thanh',226,271]]){
      body.append(this.nativeCheck(label,preferences[kind+'On'],198,y,enabled=>apply({[kind+'On']:enabled}),{disabled:this.pending,local:true,testId:`m82-audio-${kind}-on`}));
      const slider=element('input');slider.type='range';slider.min='0';slider.max='100';slider.step='1';slider.value=String(preferences[kind+'Volume']);slider.disabled=!preferences[kind+'On'];slider.dataset.testid=`m82-audio-${kind}-volume`;slider.setAttribute('aria-label','Âm lượng '+label.toLocaleLowerCase('vi'));
      const row=position(element('div',null,'m85-settings-slider'),177,sliderY,272,24),track=element('span',null,'m85-settings-slider-track'),fill=element('span',null,'m85-settings-slider-fill');
      const trackArt=this.assets?.['settings.sliderTrack'],fillArt=this.assets?.['settings.sliderFill'],thumb=this.assets?.['settings.sliderThumb'];
      if(trackArt)track.style.backgroundImage=`url("${trackArt.url}")`;
      if(fillArt)fill.append(skinImage(fillArt,{x:0,y:0}));
      if(thumb)row.style.setProperty('--settings-slider-thumb',`url("${thumb.url}")`);
      const output=element('output',slider.value+'%');const refresh=()=>{fill.style.width=`${45/2+(272-45)*Number(slider.value)/100}px`;output.textContent=slider.value+'%';};refresh();
      row.append(track,fill,slider,output);body.append(row);
      slider.addEventListener('input',()=>{apply({[kind+'Volume']:Number(slider.value)});refresh();});slider.addEventListener('change',()=>this.render());
    }
    const reset=this.assets?.['settings.reset'];body.append(this.artButton('reset','Về mặc định',531-(reset?.width||112),9,()=>{this.menuAudio.reset();this.notice='Đã khôi phục nhạc 50%, hiệu ứng 60%.';this.render();},{testId:'m82-audio-reset'}));
    const view=this.getBattleView();
    if(view){const button=this.button(view.roboSoundWanted?'Tắt âm thanh trong trận':'Bật âm thanh trong trận',async()=>{
      const current=this.getBattleView();if(!current)return;
      const wanted=!current.roboSoundWanted;await current.audio.setEnabled(wanted);current.roboSoundWanted=wanted;this.render();
    },{testId:'m8-sound'});body.append(position(button,177,324,272,30));}
  }
  checkbox(label,checked,change){
    const input=element('input');input.type='checkbox';input.dataset.focusKey=label;input.checked=checked;input.disabled=!this.mutable;
    input.addEventListener('change',()=>{if(this.mutable){change(input.checked);this.render();}});
    return field(label,input);
  }
  render(){
    if(this.disposed||!this.content)return;
    const renderKey=JSON.stringify([this.tab,this.draft,this.pending,this.leaving,this.notice,this.mutable,this.changed,this.captureAction,this.supportedActions,this.supportedQuickcast,this.getBattleView()?.roboSoundWanted,this.menuAudio?.preferences]);
    if(renderKey===this.lastRenderKey)return;this.lastRenderKey=renderKey;
    const active=this.content.contains(document.activeElement)?document.activeElement:null;
    const focusKey=active?.dataset?.focusKey||active?.dataset?.testid;
    const header=element('header',null,'m81-settings-header');
    // The active source and the user's Flash reference both use this original
    // title bitmap, even though its localized pixels read FULL SCREEN.
    const heading=element('h2','Cài đặt');if(this.assets?.['settings.title'])heading.className='m85-settings-sr-only';header.append(heading);
    if(this.panel?.close){this.panel.close.disabled=this.pending;this.panel.close.dataset.testid='m81-settings-close';}
    else header.append(actionButton('Đóng',()=>this.close(),{disabled:this.pending,testId:'m81-settings-close'}));
    const tabs=element('nav',null,'m81-settings-tabs');tabs.setAttribute('aria-label','Nhóm cài đặt');
    for(const [id,label] of [['battle','Chiến đấu'],['graphics','Đồ họa'],['audio','Âm thanh'],['other','Khác']]){
      const button=actionButton(label,()=>{this.tab=id;this.captureAction=null;this.render();});button.dataset.focusKey=`tab-${id}`;button.setAttribute('aria-pressed',String(this.tab===id));const tabSkin=this.assets?.[this.tab===id?'settings.tabDown':'settings.tabUp'];
      if(tabSkin){
        button.classList.add('m81-settings-native-tab');button.style.width=`${tabSkin.width}px`;button.style.height=`${tabSkin.height}px`;
        button.style.backgroundImage=`url("${tabSkin.url}")`;
        const name={battle:'battle',graphics:'picture',audio:'audio',other:'other'}[id];
        const word=this.assets[`settings.${name}${this.tab===id?'Down':'Up'}`];
        if(word){button.textContent='';button.setAttribute('aria-label',label);button.append(skinImage(word,{x:(tabSkin.width-word.width)/2,y:(tabSkin.height-word.height)/2}));}
      }
      tabs.append(button);
    }
    const body=element('div',null,'m81-settings-body');
    if(!this.draft)body.append(note('Đang chờ dữ liệu cài đặt…'));
    else if(this.tab==='battle'){
      this.renderBattle(body);
    }else if(this.tab==='other'){
      for(const row of SETTINGS_FLAGS)body.append(this.checkbox(row.label,!!(this.draft.settingFlag&row.bit),enabled=>{this.draft.settingFlag=setSettingsFlag(this.draft.settingFlag,row.bit,enabled);}));
      if(this.snapshot?.play?.phase==='scene')body.append(this.button(this.leaving?'Đang rời trận…':'Rời trận & về sảnh',()=>this.leaveBattle(),{
        disabled:!this.mutable||typeof this.client.leaveRoom!=='function',testId:'m85-settings-leave'}));
    }else if(this.tab==='graphics'){
      const heading=this.artwork('pictureHeading',20,9);if(heading)body.append(heading);
      const renderer=selectInput([{value:'auto',label:'Tự động · ưu tiên GPU'},{value:'canvas',label:'Tương thích · Canvas 2D'}],rendererPreference());renderer.dataset.testid='m8-renderer';
      body.append(field('Đồ họa trong trận',renderer),note('Lưu tại trình duyệt này. Tải lại trang để áp dụng chế độ đồ họa.'));
      body.append(this.button('Lưu đồ họa và tải lại',()=>{saveRendererPreference(renderer.value);globalThis.location.reload();},{disabled:this.pending||!!this.changed,testId:'m8-renderer-save'}));
      if(this.snapshot?.play?.phase==='scene'&&typeof this.onFullscreen==='function')body.append(this.button(document.fullscreenElement?'Thoát toàn màn hình':'Toàn màn hình',()=>this.toggleFullscreen(),{
        disabled:!this.mutable||!!this.changed,testId:'m85-settings-fullscreen',title:this.changed?'Bấm OK để lưu thay đổi trước khi chuyển toàn màn hình.':''}));
    }else if(this.tab==='audio')this.renderAudio(body);
    const footer=element('footer',null,'m81-settings-footer');
    const busyLabel=this.leaving?'Đang rời trận…':'Đang lưu…';
    const save=this.button(this.pending?busyLabel:'OK',()=>this.applyAndClose(),{disabled:this.pending||!!this.changed&&!this.mutable,testId:'m81-settings-save'});
    const confirm=this.assets?.['settings.confirm'];
    if(confirm){save.textContent='';save.setAttribute('aria-label',this.pending?busyLabel:'OK');save.title='Lưu cài đặt và đóng';save.classList.add('m81-settings-native-confirm');save.style.width=`${confirm.width}px`;save.style.height=`${confirm.height}px`;save.append(skinImage(confirm,{x:0,y:0}));}
    footer.append(save);
    const status=note(this.captureAction!=null?'':this.notice|| (this.changed?'Có thay đổi chưa lưu.':' '));status.setAttribute('role','status');footer.append(status);
    this.content.replaceChildren(header,tabs,body,footer);
    if(this.captureAction!=null){const {shade,dialog}=this.renderCapture();this.content.append(shade);dialog.focus({preventScroll:true});}
    else if(focusKey){const restored=[...this.content.querySelectorAll('[data-focus-key],[data-testid]')].find(node=>(node.dataset.focusKey||node.dataset.testid)===focusKey);if(restored&&!restored.disabled)restored.focus({preventScroll:true});else this.content.focus({preventScroll:true});}
    else if(!this.host.contains(document.activeElement))this.content.focus({preventScroll:true});
  }
  dispose(){this.disposed=true;this.epoch++;this.captureAction=null;this.host.removeEventListener('keydown',this.handleKeyDown);this.host.removeEventListener('keyup',this.stopKeyUp);this.host.style.removeProperty('--m85-settings-highlight');this.host.replaceChildren();}
}
