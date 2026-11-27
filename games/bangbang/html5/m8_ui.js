import {buildNativeHall,updateNativeHall,buildNativeRoom,updateNativeRoom} from './m84_flow.js';
import {createSelectionTankInfo} from './m81_selection_info.js';
import {createNativePanel} from './m81_native_panel.js';
import {selectionTanks,SELECTION_CATEGORIES} from './m81_flow_layout.js';
import {M86LoadingView,preloadLoadingRoster} from './m86_loading.js';
import {M8UIAssets} from './m8_assets.js';
import {element,actionButton,assetImage,field,selectInput,textInput,note,numberText,setText} from './m8_ui_helpers.js';
import {selectedPrimaryTank} from './m8_meta_state.js';
import {selectionSecondsLeft} from './m8_flow_state.js';
import {M81Settings} from './m81_settings.js';
import {createSettingsSurface} from './m85_settings_host.js';
import {M82MenuAudio} from './m82_menu_audio.js';
import {createSelectionExtras} from './m82_selection_extras.js';
import {flashOutsideLayout,outsideModalScreen} from './m83_flash_layout.js';
import {FLASH_CURRENCIES,createFlashCharacterChrome,createNativeCurrency,nativeMenuFilters} from './m83_chrome.js';
import {BATTLE_MAPS as PK_MAPS,isBattleMode as isPKMode,battleMapName as pkMapName} from './m810_modes.js';
import {M81314Pve} from './m81314_pve.js';
import {M81330WorldBoss} from './m81330_worldboss_ui.js';
import {isWorldBossScene} from './m81330_protocol.js';
import {BOT_AI_OPTIONS,createRoomInvitationBanner} from './m81337_rooms_ui.js';

const mapName=pkMapName;
const busyPhases=new Set(['web','auth','gate','sync','reconnecting']);
const screenNames={lobby:'Sảnh',hall:'Đấu trường',garage:'Tank',crystals:'Ngọc',inventory:'Túi đồ',
  shop:'Cửa hàng',profile:'Hồ sơ',military:'Quân hàm',leaderboard:'Xếp hạng',guild:'Guild',companions:'Trợ thủ',mailbox:'Hòm thư',worldboss:'Boss Thế Giới',pve:'PvE đơn',room:'Phòng',selecting:'Chọn tank',loading:'Đang vào trận'};
export function outsideStageSize(screen){return screen==='loading'?{width:1000,height:618}:screen==='shop'?{width:1020,height:620}:['guild','hall','room'].includes(screen)?{width:1018,height:618}:{width:1000,height:600};}
function place(node,x,y,width,height) {
  Object.assign(node.style,{position:'absolute',left:`${x}px`,top:`${y}px`});
  if(width!=null)node.style.width=`${width}px`;if(height!=null)node.style.height=`${height}px`;return node;
}

export class M8UI {
  constructor({host,client,run,getBattleView=()=>null}) {
    Object.assign(this,{host,client,run,getBattleView});this.assets=new M8UIAssets();
    this.state=null;this.screen='boot';this.screenToken=0;this.controller=null;this.lastKey='';
    host.className='m8-shell';host.dataset.screen='boot';this.menuAudio=new M82MenuAudio({host});
    this.viewport=element('div',null,'m8-viewport');this.stage=element('main',null,'m8-stage');
    this.worldBackground=element('div',null,'m83-world-background');
    this.underlay=element('div',null,'m83-underlay');this.underlay.hidden=true;this.underlay.inert=true;
    this.modalShade=element('div',null,'m83-outside-shade');this.modalShade.hidden=true;
    this.content=element('div',null,'m8-content');this.header=element('header',null,'m8-header');
    this.footer=element('nav',null,'m8-footer');this.footer.setAttribute('aria-label','Menu sảnh');
    this.status=element('div',null,'m8-status');this.status.setAttribute('role','status');
    this.error=element('div',null,'m8-error');this.error.setAttribute('role','alert');this.error.hidden=true;
    this.back=actionButton('Về sảnh',()=>this.navigate('lobby'),{className:'m8-back',testId:'m8-back'});
    this.stage.append(nativeMenuFilters(),this.worldBackground,this.underlay,this.content,this.header,this.footer,this.modalShade,this.back,this.status,this.error);
    this.roomInvitations=createRoomInvitationBanner(this);this.stage.append(this.roomInvitations.root);
    this.viewport.append(this.stage);host.replaceChildren(this.viewport);
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(host);this.resize();
    this.content.append(element('h1','BANG BANG','m8-boot-title'),note('Đang tải giao diện…','m8-boot-note'));
    this.ready=this.assets.load().then(()=>{this.loaded=true;this.buildChrome();this.navigate(this.state?.phase==='ready'?'lobby':'login');this.update(this.state);})
      .catch(error=>{this.status.textContent=error.message;this.content.append(actionButton('Tải lại',()=>location.reload()));});
    this.clock=setInterval(()=>this.updateCountdown(),200);
  }
  resize() {
    const width=this.host.clientWidth||innerWidth,height=this.host.clientHeight||innerHeight;
    const native=this.dialogStage||outsideStageSize(this.screen),layout=flashOutsideLayout(width,height,native);
    this.layout=layout;this.stage.style.width=`${layout.width}px`;this.stage.style.height=`${layout.height}px`;
    this.viewport.style.width=`${width}px`;this.viewport.style.height=`${height}px`;
    this.stage.style.transform=`scale(${layout.scale})`;
    place(this.content,layout.panel.x,layout.panel.y,layout.panel.width,layout.panel.height);
    const under=this.underlayStage||{width:1000,height:600};
    place(this.underlay,(layout.width-under.width)/2,(layout.height-under.height)/2,under.width,under.height);
    const chromeScreen=outsideModalScreen(this.screen)?this.underlayScreen:this.screen;
    if(this.footer){
      if(['hall','room'].includes(chromeScreen))place(this.footer,(layout.width-1018)/2+251,(layout.height-618)/2+561,760,46);
      else place(this.footer,layout.menu.x,layout.menu.y,layout.menu.width,layout.menu.height);
    }
    if(this.bottomBar){
      this.bottomBar.style.width=`${layout.width}px`;
      this.bottomBarMiddle.style.width=`${Math.max(0,layout.width-77)}px`;
      this.bottomBarRight.style.left=`${layout.width-39}px`;
    }
    if(this.back){this.back.style.right=`${layout.panel.x+20}px`;this.back.style.top=`${Math.max(4,layout.panel.y+13)}px`;}
  }
  art(key,x,y,{width,height,className=''}={}) {
    const asset=this.assets.get(key)||this.assets.ui.assets[key];
    return place(this.assets.menuArt(asset,'',`m8-art ${className}`),x,y,width??asset?.width,height??asset?.height);
  }
  imageButton(key,label,callback,x,y,options={}) {
    const asset=this.assets.ui.assets[key]||this.assets.get(key);
    const button=actionButton('',callback,{className:'m8-image-button '+(options.className||''),title:label,testId:options.testId||''});
    button.setAttribute('aria-label',label);button.append(assetImage(asset,''));
    place(button,x,y,options.width??asset?.width,options.height??asset?.height);
    if(options.caption)button.append(element('span',label,'m8-image-caption'));
    return button;
  }
  buildChrome() {
    this.worldBackground.style.backgroundImage=`url("${this.assets.get('lobby.background').url}")`;
    this.characterChrome=createFlashCharacterChrome(this.assets,()=>this.navigate('profile'));
    this.wallet=element('div',null,'m8-wallet');this.currencyViews=[];
    for(const row of FLASH_CURRENCIES) {
      this.wallet.append(this.art('currency.background',row.left,0),this.art(row.icon,row.left+4,3,{width:26,height:26}));
      const plus=this.imageButton('currency.plus',`Bổ sung ${row.label}: chưa mở`,null,row.plus,1,{className:'m83-native-unavailable'});plus.disabled=true;
      const view=createNativeCurrency(this.assets,row);this.currencyViews.push({key:row.key,...view});
      this.wallet.append(view.host,plus);
    }
    const payment=this.imageButton('currency.payment','Nạp tiền chưa mở',null,0,(31-this.assets.ui.assets['currency.payment'].height)/2,{className:'m83-native-unavailable'});payment.disabled=true;this.wallet.append(payment);
    this.settings=actionButton('Cài đặt',()=>this.showSettings(),{testId:'m8-settings'});
    this.exit=this.imageButton('public.returnSmall','Đăng xuất',()=>{
      if(this.pveRoomController?.interactionLocked)return;
      if(this.state?.play.phase==='room')return this.run(()=>this.client.leaveRoom());
      if(['hall','pve'].includes(this.screen))return this.navigate('lobby');
      return this.run(()=>this.client.logout());
    },719,7,{width:32,height:32,testId:'m8-logout'});
    this.exit.append(place(assetImage(this.assets.get('public.return'),''),-1,-1,34,34));
    this.header.append(this.characterChrome.host,this.wallet);
    this.mailboxButton=actionButton('Hòm thư',()=>this.navigate('mailbox'),{className:'m81329-mail-nav',testId:'m29-nav-mailbox',title:'Mở hòm thư và nhận quà'});
    this.header.append(place(this.mailboxButton,273,8,118,29));
    this.footer.append(this.art('navigation.backgroundLarge',341,0),this.art('navigation.backgroundXL',-15,1),this.art('navigation.background',512,0));
    for(const x of [610,643,680])this.footer.append(this.art('chrome.settingBackground',x,3, {width:38,height:39}));
    this.footer.append(this.art('public.returnBackground',713,1));
    for(const [screen,label,key,icon,x,y,w,h] of [
      ['shop','Cửa hàng','navigation.shop','navigation.shopLabel',-9,3,96,40],
      ['military','Quân hàm','navigation.militaryRank',null,177,0,104,46],
      ['crystals','Tinh thể','navigation.crystal',null,281,5,90,38],
      ['garage','Tank','navigation.blue','navigation.tankLabel',347,6,91,34],
      ['inventory','Túi đồ','navigation.blue','navigation.bagLabel',518,6,91,34]]) {
      const button=this.imageButton(key,label,()=>this.navigate(screen),x,y,{width:w,height:h,testId:'m8-nav-'+screen});button.dataset.screen=screen;
      if(icon){const asset=this.assets.get(icon);button.append(place(assetImage(asset,''),(w-asset.width)/2,(h-asset.height)/2,asset.width,asset.height));}
      this.footer.append(button);
    }
    this.footer.append(this.imageButton('chrome.helper','Trợ thủ',()=>this.navigate('companions'),432,6,
      {width:80,height:34,testId:'m81314-nav-companions'}));
    for(const [key,label,x,y,w,h] of [['chrome.friend','Bạn bè chưa mở',87,4,92,38]]) {
      const button=this.imageButton(key,label,null,x,y,{width:w,height:h,className:'m83-native-unavailable'});button.disabled=true;this.footer.append(button);
    }
    for(const [key,label,x] of [['chrome.socialIcon','Cộng đồng chưa mở',615],['chrome.questIcon','Nhiệm vụ chưa mở',649]]) {
      const button=this.imageButton('public.settings',label,null,x,10,{width:26,height:26,className:'m83-native-unavailable'}),icon=this.assets.get(key);
      button.append(place(assetImage(icon,''),(26-icon.width)/2,(26-icon.height)/2,icon.width,icon.height));button.disabled=true;this.footer.append(button);
    }
    this.settings.textContent='';this.settings.className='m8-button m8-image-button';this.settings.setAttribute('aria-label','Cài đặt');
    this.settings.append(assetImage(this.assets.get('public.settings'),''),place(assetImage(this.assets.get('public.settingsIcon'),''),-2,-2,30,30));
    this.footer.append(place(this.settings,686,10,26,26),this.exit);
    this.bottomBar=element('div',null,'m81-bottom-bar');
    this.bottomBarMiddle=this.art('chrome.bar_02',38,0,{width:923,height:64});this.bottomBarRight=this.art('chrome.bar_03',961,0);
    this.bottomBar.append(this.art('chrome.bar_01',0,0),this.bottomBarMiddle,this.bottomBarRight);this.stage.insertBefore(this.bottomBar,this.footer);this.resize();
  }

  async navigate(screen) {
    if(!this.loaded)return;
    if(this.state?.play.phase==='room'&&this.pveRoomController?.interactionLocked
        &&screen!=='room'&&this.state?.phase==='ready')return;
    if(screen==='lobby'&&outsideModalScreen(this.screen)&&['hall','pve'].includes(this.underlayScreen)&&this.state?.play.phase==='lobby')screen=this.underlayScreen;
    if(screen==='lobby'&&this.state?.play.phase==='room')screen='room';
    if(this.state?.phase==='ready'&&['room','selecting','loading','scene'].includes(this.state.play.phase)
      &&!['room','selecting','loading'].includes(screen)) {
      if(this.state.play.phase==='room'&&['garage','crystals','inventory','shop','profile','military','leaderboard','guild','companions','pve','mailbox'].includes(screen)) {}
      else return;
    }
    if(this.screen===screen)return;
    const previousScreen=this.screen,modal=outsideModalScreen(screen);
    if(this.pveRoomController&&!modal&&screen!=='room'){
      this.pveRoomController.dispose();this.pveRoomController=null;
    }
    if(this.pvePageController&&!modal&&screen!=='pve'){
      this.pvePageController.dispose();this.pvePageController=null;
    }
    // Keep both display containers in place. Moving a live custom SWF element
    // invokes disconnectedCallback even during a synchronous DOM reparent.
    // Swapping the containers' roles preserves the movie and its playback.
    const restoreUnderlay=!modal&&this.underlayScreen===screen&&this.underlay.childNodes.length>0;
    // Preserve the live chapter controller together with its DOM. Rebuilding
    // it on every companion/shop close would lose the selected chapter and
    // leave stale buttons attached to an already-disposed controller.
    if(modal&&previousScreen==='pve'){
      this.pvePageController=this.controller;this.controller=null;
    }
    this.controller?.dispose();this.controller=null;this.loadingView?.dispose();this.loadingView=null;this.selectionInfo?.dispose();this.selectionInfo=null;this.selectionExtras?.dispose();this.selectionExtras=null;this.selectionTileCleanups=[];this.createShade=null;this.createConfirm=null;this.findShade=null;
    if(modal&&['lobby','hall','room','pve'].includes(previousScreen)){
      this.modalReturnFocus=document.activeElement;
      this.underlayStage=outsideStageSize(previousScreen);this.underlayScreen=previousScreen;
      [this.content,this.underlay]=[this.underlay,this.content];
    }else if(!modal){
      if(restoreUnderlay){
        this.content.replaceChildren();
        [this.content,this.underlay]=[this.underlay,this.content];
      }else this.underlay.replaceChildren();
      this.underlayStage=null;this.underlayScreen=null;
    }
    this.content.className='m8-content';this.content.hidden=false;this.content.inert=false;
    this.underlay.className='m83-underlay';this.underlay.inert=true;
    this.underlay.hidden=!modal||!this.underlayScreen;this.modalShade.hidden=!modal;
    this.host.dataset.modalOutside=String(modal);
    this.screen=screen;this.menuAudio.setScreen(screen,this.state?.play?.phase);this.dialogStage=null;this.resize();this.lastKey='';const token=++this.screenToken;
    this.host.dataset.screen=screen;if(!restoreUnderlay)this.content.replaceChildren();
    this.updateChrome(screen);
    if(screen==='login')this.buildLogin();
    if(screen==='lobby'&&!restoreUnderlay)this.buildLobby();
    if(screen==='hall'&&!restoreUnderlay)this.buildHall();
    if(screen==='room'&&!restoreUnderlay)this.buildRoom();
    if(screen==='selecting')this.buildSelection();
    if(screen==='loading')this.buildLoading();
    try {
      if(screen==='garage'||screen==='crystals') {
        const module=await import(screen==='garage'?'./m8_garage.js':'./m8_crystals.js');
        if(this.screenToken!==token)return;
        const Constructor=screen==='garage'?module.M8Garage:module.M8Crystals;
        this.controller=new Constructor({host:this.content,client:this.client,
          catalog:screen==='garage'?this.assets.garage:this.assets.crystals,assets:this.assets,run:this.run,onClose:()=>this.navigate('lobby'),onLevelUp:()=>this.menuAudio.effect('levelUp'),onStageSize:size=>{this.dialogStage=size;this.resize();}});
      } else if(screen==='companions'||screen==='pve'){
        const Constructor=screen==='pve'?M81314Pve:(await import('./m81314_companions.js')).M81314Companions;
        if(this.screenToken!==token)return;
        if(screen==='pve'&&restoreUnderlay&&this.pvePageController){
          this.controller=this.pvePageController;this.pvePageController=null;
        }else this.controller=new Constructor({host:this.content,client:this.client,assets:this.assets,
          catalog:this.assets.pve,run:this.run,onClose:()=>this.navigate('lobby')});
      } else if(screen==='mailbox'){
        const {M81329Mailbox}=await import('./m81329_mail_ui.js');if(this.screenToken!==token)return;
        this.controller=new M81329Mailbox({host:this.content,client:this.client,assets:this.assets,onClose:()=>this.navigate('lobby')});
      } else if(screen==='worldboss'){
        this.controller=new M81330WorldBoss({host:this.content,client:this.client,assets:this.assets,run:this.run,
          onClose:()=>this.navigate('lobby'),onInventory:()=>this.navigate('inventory')});
      } else if(['inventory','shop','profile','military','leaderboard','guild'].includes(screen)) {
        const {M8AccountUI}=await import('./m8_account_ui.js');if(this.screenToken!==token)return;
        const accountReturn=previousScreen==='worldboss'?'worldboss':'lobby';
        this.controller=new M8AccountUI({host:this.content,client:this.client,catalog:this.assets.account,
          assets:this.assets,run:this.run,section:screen,onClose:()=>this.navigate(accountReturn),onSection:section=>{this.screen=section;this.menuAudio.setScreen(section,this.state?.play?.phase);this.host.dataset.screen=section;this.resize();this.updateChrome(section);}});
      }
    } catch(error){if(token===this.screenToken)this.content.append(note(error.message,'error'));}
    if(this.state)this.renderCurrent();
    if(restoreUnderlay&&this.modalReturnFocus?.isConnected)this.modalReturnFocus.focus();
    if(!modal)this.modalReturnFocus=null;
  }
  updateChrome(screen){
    const modal=outsideModalScreen(screen),chromeScreen=modal?this.underlayScreen:screen;
    this.header.hidden=chromeScreen!=='lobby';this.header.inert=modal;
    // RoomFrame.PVE uses the same native bottom toolbar coordinates as PK.
    // Only the chapter/lobby view retains the wide outside bottom dock.
    this.footer.hidden=!['lobby','hall','room','pve'].includes(chromeScreen);this.footer.inert=modal||!!this.pveRoomController?.interactionLocked;
    if(this.exit){const label=chromeScreen==='room'?'Rời phòng':['hall','pve'].includes(chromeScreen)?'Về sảnh':'Đăng xuất';this.exit.setAttribute('aria-label',label);this.exit.title=label;}
    if(this.bottomBar)this.bottomBar.hidden=this.footer.hidden||!['lobby','pve'].includes(chromeScreen);
    this.back.hidden=['hall','garage','inventory','military','crystals','guild','shop','profile','leaderboard'].includes(screen)||!['garage','crystals','inventory','shop','profile','military','leaderboard','guild','hall'].includes(screen);
    for(const node of this.footer.children)node.classList.toggle('selected',node.dataset.screen===screen);
  }
  update(state) {
    if(!state)return;const previous=this.state;this.state=state;
    if(this.settingsScope&&(this.settingsScope.generation!==this.client.generation
        ||this.settingsScope.accountId!==state.accountId||state.phase!=='ready'
        ||this.settingsScope.phase!==state.play.phase))this.closeSettings?.(false);
    this.settingsController?.update(state);
    this.roomInvitations.update();
    if(!this.loaded)return;
    const phase=state.play.phase;
    const inBattle=phase==='scene'&&state.phase==='ready';
    this.host.hidden=inBattle;this.assets.setEnabled(!inBattle);this.menuAudio.setActive(!inBattle);
    document.body.dataset.m8Battle=inBattle?'true':'false';
    if(state.phase==='ready') {
      if(['room','selecting','loading'].includes(phase)&&phase!==previous?.play.phase)this.navigate(phase);
      else if(['login','boot'].includes(this.screen))this.navigate(phase==='lobby'?'lobby':phase);
      else if(phase==='lobby'&&previous?.play.phase!=='lobby')this.navigate(isWorldBossScene(previous?.play.scene)?'worldboss':'lobby');
    } else if(['idle','error','disconnected'].includes(state.phase)&&!state.stages.web)this.navigate('login');
    const clock=this.client.lastClock,nativeSeconds=clock?clock.packet.serverTimeSeconds+Math.max(0,performance.now()-clock.receivedAt)/1000:null;
    this.characterChrome.update(state.meta.character,nativeSeconds);
    for(const view of this.currencyViews)view.update(state.meta.character.currency?.[view.key]||0);
    if(this.mailboxButton){const unread=Number(state.mailbox?.unread)||0;setText(this.mailboxButton,unread?`Hòm thư (${unread>99?'99+':unread})`:'Hòm thư');this.mailboxButton.disabled=state.phase!=='ready'||!!state.play.busy;}
    setText(this.status,state.phase==='ready'?(state.play.busy?'Đang chờ server…':''):(state.message||''));
    this.status.hidden=!this.status.textContent;
    setText(this.error,state.play.error||'');this.error.hidden=!this.error.textContent;
    this.exit.disabled=busyPhases.has(state.phase);
    this.renderCurrent();
  }
  renderCurrent() {
    const s=this.state;if(!s)return;
    this.controller?.update(s);
    if(this.underlayScreen==='pve')this.pvePageController?.update(s);
    if(this.underlayScreen==='lobby')this.updateLobby();
    if(this.underlayScreen==='room')this.updateRoom();
    if(this.screen==='login') {
      this.loginButton.disabled=busyPhases.has(s.phase);this.loginUser.disabled=this.loginButton.disabled;
      this.loginPassword.disabled=this.loginButton.disabled;return;
    }
    if(this.screen==='lobby')this.updateLobby();
    if(this.screen==='hall')this.updateHall();
    if(this.screen==='room')this.updateRoom();
    if(this.screen==='selecting')this.updateSelection();
    if(this.screen==='loading')this.updateLoading();
    this.syncPveRoomLock();
  }
  syncPveRoomLock(){
    const locked=!!this.pveRoomController?.interactionLocked;
    if(this.footer)this.footer.inert=outsideModalScreen(this.screen)||locked;
    if(this.exit)this.exit.disabled=busyPhases.has(this.state?.phase)||locked;
  }
  buildLogin() {
    this.content.append(this.art('lobby.background',0,0,{width:1000,height:600}),this.art('lobby.platform',0,0));
    const box=place(element('form',null,'m8-login m8-panel'),320,110,360,340);
    box.append(element('h1','BANG BANG'),element('p','Đăng nhập để vào sảnh','m8-subtitle'));
    this.loginUser=textInput('',{placeholder:'Tài khoản',maxLength:32});this.loginUser.autocomplete='username';
    this.loginUser.required=true;this.loginUser.dataset.testid='m8-username';
    this.loginPassword=textInput('',{placeholder:'Mật khẩu',type:'password'});this.loginPassword.autocomplete='current-password';
    this.loginPassword.required=true;this.loginPassword.dataset.testid='m8-password';
    this.loginButton=actionButton('Vào game',null,{className:'primary',testId:'m8-login'});this.loginButton.type='submit';
    box.append(field('Tài khoản',this.loginUser),field('Mật khẩu',this.loginPassword),this.loginButton);
    box.onsubmit=event=>{event.preventDefault();const username=this.loginUser.value.trim(),password=this.loginPassword.value;
      this.loginPassword.value='';this.run(()=>this.client.login(username,password));};this.content.append(box);
  }
  buildLobby() {
    this.lobbyKey='';
    this.content.append(this.art('lobby.platform',0,0));
    const worldBoss=actionButton('',()=>this.navigate('worldboss'),{className:'m81330-worldboss-nav',testId:'m30-nav-worldboss',title:'Boss Thế Giới'});
    const bossIcon=this.assets.get('zh_CN/gui_summer/controls/main/worldBoss.png');
    if(bossIcon)worldBoss.append(assetImage(bossIcon,''));
    worldBoss.append(element('span','Boss Thế Giới'));this.content.append(worldBoss);
    this.lobbyPortrait=place(actionButton('',()=>this.navigate('garage'),{className:'m83-lobby-avatar',testId:'m83-lobby-avatar',title:'Đổi tank'}),182,153,200,200);this.lobbyPortrait.setAttribute('aria-label','Đổi tank');this.content.append(this.lobbyPortrait);
    this.content.append(this.art('lobby.tankNameBackground',158,96));
    this.lobbyTankName=place(element('h2',null,'m8-lobby-tank-name'),203,97,133,29);this.content.append(this.lobbyTankName);
    this.lobbyTankLevel=place(element('span',null,'m83-lobby-tank-level'),165,100);this.content.append(this.lobbyTankLevel);
    this.content.append(this.imageButton('lobby.switchTank','Đổi tank',()=>this.navigate('garage'),342,96,{testId:'m8-switch-tank'}),
      this.imageButton('lobby.pvp','Đấu trường PK',()=>{this.hallKind='normal';return this.navigate('hall');},452,100,{testId:'m8-pvp'}),
      this.imageButton('lobby.league','Đấu xếp hạng · Ghép người chơi hoặc bot',()=>{this.hallKind='ranked';return this.navigate('hall');},488,237,{testId:'m813-lobby-ranked'}));
    // Literal Game360MainFrame coordinates from the pinned Main2edFactory.
    // Solo PvE is implemented: use Flash's active button, not the grey locked
    // artwork. Deferred Guild War below deliberately retains its disabled art.
    this.content.append(this.imageButton('lobby.pve','PvE đơn',()=>this.navigate('pve'),668,100,
      {testId:'m81314-nav-pve'}));
    for(const [key,label,x,y] of [['lobby.guildWarDisabled','Chiến Guild chưa mở',704,237]]) {
      const button=this.imageButton(key,label,()=>{},x,y,{className:'m83-native-disabled'});button.disabled=true;this.content.append(button);
    }
    this.content.append(this.imageButton('lobby.shop','Cửa hàng',()=>this.navigate('shop'),747,397),
      this.imageButton('lobby.rank','Bảng xếp hạng',()=>this.navigate('leaderboard'),527,397,{testId:'m81-leaderboard'}),
      this.imageButton('lobby.guild','Guild',()=>this.navigate('guild'),637,397,{testId:'m8-nav-guild'}));
    if(this.assets.get('lobby.shopCover'))this.content.append(this.art('lobby.shopCover',801,418));
  }
  updateLobby() {
    const tank=selectedPrimaryTank(this.state.meta),key=JSON.stringify(tank);
    if(this.lobbyKey===key)return;this.lobbyKey=key;
    this.lobbyPortrait.replaceChildren(this.assets.portraitForTank(tank,{size:200,animate:true}));
    setText(this.lobbyTankName,this.assets.tankName(tank?.tankId));
    const level=this.assets.get(`chrome.tankLevel${Math.min(11,tank?.level||1)}`);
    this.lobbyTankLevel.replaceChildren(...(level?[assetImage(level,`LV.${tank?.level||1}`)]:[]));
  }
  buildHall() {return buildNativeHall(this);}
  showCreateRoom() {
    if(this.createShade||this.state?.play.busy||this.state?.multiplayer?.queue.active)return;
    const shade=place(element('div',null,'m81-create-shade'),0,0,1018,618);this.createShade=shade;
    for(const child of this.content.children)child.inert=true;
    const close=()=>{if(this.state?.play.busy)return;shade.remove();this.createShade=null;for(const child of this.content.children)child.inert=false;this.createButton.focus();};
    const panel=createNativePanel({assets:{...this.assets.ui.assets,...this.assets.panels.assets},width:472,height:538,kind:'box1',state:'CONFIRM',
      close:{asset:'public.close',x:418,y:15,label:'Đóng'},onClose:close});
    place(panel.root,273,40,472,538);shade.append(panel.root);shade.setAttribute('role','dialog');shade.setAttribute('aria-modal','true');shade.setAttribute('aria-label','Tạo đội');
    const title=this.assets.get('hall.title_createroom_t');panel.content.append(place(assetImage(title,''),(472-title.width)/2,19));
    const setup=this.state.play.setup;
    this.pkMapSelect=selectInput(PK_MAPS.map(map=>({value:map.mode,label:`${map.group} · ${map.name}`})),isPKMode(setup?.mode)?setup.mode:'pk_robo');
    this.pkMapSelect.dataset.testid='m89-pk-map';
    this.allies=selectInput(Array.from({length:5},(_,i)=>({value:i,label:String(i)})),setup?.allies?.length??4);
    this.enemies=selectInput(Array.from({length:6},(_,i)=>({value:i,label:String(i)})),setup?.enemies?.length??5);
    this.botLevel=selectInput(Array.from({length:6},(_,i)=>({value:i+1,label:String(i+1)})),setup?.enemies?.[0]||5);
    this.allies.dataset.testid='m8-allies';this.enemies.dataset.testid='m8-enemies';this.botLevel.dataset.testid='m8-bot-level';
    this.botGuild=selectInput([{value:'0',label:'Không'},{value:'1',label:'Có · cấp tối đa'}],setup?.bot_guild?'1':'0');
    this.botGuild.title='1 kỹ năng chủ động và 4 kỹ năng bị động cấp tối đa, chọn theo vai trò tank.';
    this.botMilitary=selectInput([{value:'0',label:'Không'},{value:'1',label:'Có · cấp tối đa'}],setup?.bot_military?'1':'0');
    this.botMilitary.dataset.testid='m81340-bot-military';
    this.botCrystals=selectInput([{value:'0',label:'Không'},{value:'1',label:'Có · đủ 30 ngọc Lv5'}],setup?.bot_crystals?'1':'0');
    this.botAI=selectInput(BOT_AI_OPTIONS,setup?.bot_ai_allies||setup?.bot_ai||'legacy');
    this.botAIEnemies=selectInput(BOT_AI_OPTIONS,setup?.bot_ai_enemies||setup?.bot_ai||'legacy');
    this.botAI.dataset.testid='m81324-bot-ai';
    this.botAIEnemies.dataset.testid='m81337-bot-ai-enemies';
    this.botGuild.dataset.testid='m811-bot-guild';this.botCrystals.dataset.testid='m811-bot-crystals';
    const form=place(element('div',null,'m81-create-form m811-create-form m81337-create-form'),40,64,392,402);
    const modeNote=note('');modeNote.setAttribute('role','status');
    const normalBots={allies:this.allies.value,enemies:this.enemies.value,level:this.botLevel.value};
    let training=false;
    const syncMode=()=>{
      const next=this.pkMapSelect.value==='test_desert';
      if(next&&!training){normalBots.allies=this.allies.value;normalBots.enemies=this.enemies.value;normalBots.level=this.botLevel.value;}
      if(next){this.allies.value='0';this.enemies.value='5';this.botLevel.value='6';}
      else if(training){this.allies.value=normalBots.allies;this.enemies.value=normalBots.enemies;this.botLevel.value=normalBots.level;}
      training=next;
      for(const select of [this.allies,this.enemies,this.botLevel,this.botAI,this.botAIEnemies])select.disabled=training;
      setText(modeNote,training?'5 tank Lv6 đứng yên, hồi sinh sau 5 giây. Không giới hạn giờ. Quân hàm, Guild và ngọc chọn riêng.'
        :'Chọn bot riêng cho mỗi phe. Để 0 bot cả hai bên nếu chơi toàn người; mời bạn hoặc nhập mã phòng sau khi tạo.');
    };
    this.pkMapSelect.addEventListener('change',syncMode);syncMode();
    const counts=element('div',null,'m81337-create-pair'),policies=element('div',null,'m81337-create-pair');
    counts.append(field('Số bot cùng đội',this.allies),field('Số bot đối thủ',this.enemies));
    policies.append(field('Loại bot cùng đội',this.botAI),field('Loại bot đối thủ',this.botAIEnemies));
    const levels=element('div',null,'m81337-create-pair'),equipment=element('div',null,'m81337-create-pair');
    levels.append(field('Cấp tank của bot',this.botLevel),field('Quân hàm của bot',this.botMilitary));
    equipment.append(field('Guild: 1 chủ động, 4 bị động',this.botGuild),field('Ngọc đề cử của bot',this.botCrystals));
    form.append(field('Chế độ và bản đồ',this.pkMapSelect),counts,policies,levels,equipment,modeNote);
    this.createConfirm=actionButton('Tạo phòng',()=>this.run(async()=>{
      const generation=this.client.generation,accountId=this.state.accountId,token=this.screenToken;
      const saved=await this.client.saveBotSetup({mode:this.pkMapSelect.value,allies:Array(Number(this.allies.value)).fill(Number(this.botLevel.value)),
        enemies:Array(Number(this.enemies.value)).fill(Number(this.botLevel.value)),quanvu_execute_hint:!!this.state.play.setup?.quanvu_execute_hint,
        bot_guild:this.botGuild.value==='1',bot_crystals:this.botCrystals.value==='1',bot_military:this.botMilitary.value==='1',bot_ai:training?'legacy':this.botAI.value,
        bot_ai_allies:training?'legacy':this.botAI.value,bot_ai_enemies:training?'legacy':this.botAIEnemies.value});
      if(saved===null||generation!==this.client.generation||accountId!==this.state.accountId||token!==this.screenToken||this.createShade!==shade||this.state.phase!=='ready'||this.state.play.phase!=='lobby')return;
      await this.client.createRoom();
    }),{className:'primary',testId:'m8-create-room'});
    this.createConfirm.style.whiteSpace='nowrap';this.createConfirm.style.fontSize='15px';
    panel.content.append(form,place(this.createConfirm,177,481,118,40));
    shade.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();close();}});this.content.append(shade);this.pkMapSelect.focus();
  }
  updateHall() {return updateNativeHall(this);}
  buildRoom() {
    if(this.state?.play.room?.roomType===4){
      this.pveRoomController?.dispose();
      this.pveRoomController=new M81314Pve({host:this.content,client:this.client,assets:this.assets,
        catalog:this.assets.pve,run:this.run,onCompanions:()=>this.navigate('companions'),
        onNavigate:screen=>this.navigate(screen),
        onInteractionLock:()=>this.syncPveRoomLock(),
        onClose:()=>this.run(()=>this.client.leaveRoom())});
      return;
    }
    return buildNativeRoom(this);
  }
  updateRoom() {return this.state?.play.room?.roomType===4?this.pveRoomController?.update(this.state):updateNativeRoom(this);}
  buildSelection() {
    this.content.append(this.art('selection.background',-8,-8));
    this.selectionLeft=place(element('div',null,'m8-selection-roster'),2,36,178,490);
    this.selectionRight=place(element('div',null,'m8-selection-roster'),820,36,178,490);
    this.selectionClock=place(element('strong','60','m8-selection-clock'),257,23,142,30);
    this.selectionEnemyClock=place(element('strong','60','m8-selection-clock'),604,22,142,30);
    this.content.append(this.art('selection.allyArrow',213,24),this.art('selection.enemyArrow',737,24),this.selectionEnemyClock,
      place(element('strong','Đội bạn','m81-selection-team-label'),0,1,204,26),place(element('strong','Đối thủ','m81-selection-team-label'),796,1,204,26));
    this.selectionCategory=4;this.selectionCategories=[];
    for(const [i,category] of SELECTION_CATEGORIES.entries()){
      const button=this.imageButton('selection.'+category.key+(category.id===4?'Active':''),category.label,()=>{this.selectionCategory=category.id;this.selectionGridKey='';this.selectionGrid.scrollTop=0;this.updateSelection();},234+i*93,59,{testId:'m81-selection-category-'+category.id});
      this.selectionCategories.push({button,category});this.content.append(button);
    }
    this.selectionSearch=place(textInput('',{placeholder:'Tìm tank…',maxLength:40}),610,61,154,27);
    this.selectionSearch.dataset.testid='m8-selection-search';this.selectionSearch.oninput=()=>{this.selectionGridKey='';this.updateSelection();};
    this.selectionGrid=place(element('div',null,'m8-selection-grid'),238,104,526,296);
    this.selectionWindow=element('div',null,'m8-selection-window');this.selectionGrid.append(this.selectionWindow);
    this.selectionGrid.onscroll=()=>this.renderSelectionTiles();
    this.selectionMap=place(assetImage(this.assets.m3.maps[String(this.state?.flow?.mapId)]?.preview,mapName(this.state?.flow?.mapId)),230,438,152,68);
    this.content.append(this.selectionMap,this.art('selection.mapCover',222,430),this.art('selection.battleAttributes',392,428));
    this.selectionDetail=element('div',null,'sr-only');
    this.confirm=this.imageButton('selection.confirm','Xác nhận',()=>this.run(()=>this.client.confirmTank()),641,442,
      {testId:'m8-confirm'});
    this.confirmLabel=place(assetImage(this.assets.ui.assets['selection.confirmed'],''),15,8,106,36);this.confirm.append(this.confirmLabel);
    this.cancel=place(actionButton('Về sảnh',()=>this.run(()=>this.client.leaveRoom()),{testId:'m8-cancel-selection'}),640,516,136,32);
    this.content.append(this.selectionLeft,this.selectionRight,this.selectionClock,this.selectionSearch,this.selectionGrid,this.selectionDetail,this.confirm,this.cancel,
      place(note('Lựa chọn chỉ dùng cho trận này.'),240,530,350,26));
    this.selectionInfo=createSelectionTankInfo({host:this.content,assets:this.assets});this.selectionTileCleanups=[];
    this.selectionExtras=createSelectionExtras({host:this.content,client:this.client,assets:this.assets,run:this.run});
    this.selectionGridKey='';
  }
  updateSelection() {
    const s=this.state,selection=s.play.selection;if(!selection)return;
    const preview=this.assets.m3.maps[String(s.flow.mapId)]?.preview;
    if(preview&&this.selectionMap.getAttribute('src')!==preview.url)this.selectionMap.src=preview.url;
    this.selectionMap.alt=mapName(s.flow.mapId);
    const loadingRosterKey=JSON.stringify(s.flow.roster);
    if(this.loadingPreloadKey!==loadingRosterKey){this.loadingPreloadKey=loadingRosterKey;preloadLoadingRoster(this.assets,s);}
    this.selectionExtras?.update(s);
    const locked=s.flow.lockedAccountIds.includes(s.accountId),disabled=!!s.play.busy||locked;
    const query=this.selectionSearch.value.toLocaleLowerCase('vi');
    const gridKey=JSON.stringify([s.meta.tanks,selection.selectedTankId,disabled,query,this.selectionCategory]);
    if(gridKey!==this.selectionGridKey) {
      this.selectionGridKey=gridKey;
      this.selectionItems=selectionTanks(s.meta.tanks,this.assets.garage,this.selectionCategory,query);
      this.selectionWindow.style.height=`${Math.ceil(this.selectionItems.length/5)*102}px`;
      if(this.selectionQuery!==query){this.selectionQuery=query;this.selectionGrid.scrollTop=0;}
      this.selectionTileKey='';this.renderSelectionTiles();
      const selected=s.meta.tanks.find(t=>t.tankId===selection.selectedTankId);
      this.selectionDetail.replaceChildren(element('div',`${this.assets.tankName(selection.selectedTankId)}\nLv.${selected?.level||1}${locked?' · Đã chốt':''}`));
    }
    const rosterKey=JSON.stringify([s.flow.roster,s.flow.lockedAccountIds]);
    if(rosterKey!==this.lastKey) {
      this.lastKey=rosterKey;
      const ownCamp=s.flow.roster.find(c=>c.accountId===s.accountId)?.camp||1;
      for(const [camp,host] of [[ownCamp,this.selectionLeft],[3-ownCamp,this.selectionRight]]) {
        host.replaceChildren(...s.flow.roster.filter(c=>c.camp===camp).map(c=>{
          const card=element('article',null,'m8-selection-player');
          card.style.backgroundImage=`url("${this.assets.ui.assets[c.accountId===s.accountId?'selection.selfPlayer':camp===1?'selection.bluePlayer':'selection.redPlayer'].url}")`;
          const head=this.assets.selectionHeadForTank(c,{animate:true});
          if(head){head.classList.add('m81-selection-head');card.append(place(head,0,0));}
          else {card.dataset.headFallback='native-swf-or-missing';card.append(place(this.assets.portraitForTank(c,{size:98}),40,0,98,98));}
          card.append(place(element('strong',c.name),2,74,174,22));
          if(s.flow.lockedAccountIds.includes(c.accountId)){const cover=this.art('selection.gridCover',0,0);card.append(cover,place(element('span','✓ Đã chốt','m81-selection-locked'),12,33,154,25));}
          return card;
        }));
      }
    }
    for(const {button,category} of this.selectionCategories){button.firstChild.src=this.assets.ui.assets['selection.'+category.key+(category.id===this.selectionCategory?'Active':'')].url;button.setAttribute('aria-pressed',String(category.id===this.selectionCategory));}
    const confirmAsset=this.assets.ui.assets[locked?'selection.alreadyOn':'selection.confirmed'];this.confirmLabel.src=confirmAsset.url;Object.assign(this.confirmLabel.style,{left:(136-confirmAsset.width)/2+'px',top:(58-confirmAsset.height)/2-3+'px',width:confirmAsset.width+'px',height:confirmAsset.height+'px'});
    this.confirm.disabled=disabled;this.cancel.disabled=!!s.play.busy;this.updateCountdown();
  }
  renderSelectionTiles() {
    if(this.screen!=='selecting'||!this.selectionItems)return;
    const s=this.state,selectedId=s.play.selection?.selectedTankId;
    const disabled=!!s.play.busy||s.flow.lockedAccountIds.includes(s.accountId);
    const firstRow=Math.max(0,Math.floor(this.selectionGrid.scrollTop/102)-1);
    const start=firstRow*5,end=Math.min(this.selectionItems.length,(firstRow+5)*5);
    const key=`${this.selectionGridKey}|${start}:${end}`;if(key===this.selectionTileKey)return;this.selectionTileKey=key;
    for(const cleanup of this.selectionTileCleanups||[])cleanup();this.selectionTileCleanups=[];
    this.selectionWindow.replaceChildren(...this.selectionItems.slice(start,end).map((tank,offset)=>{
      const index=start+offset,selected=tank.tankId===selectedId;
      const button=actionButton('',()=>this.run(()=>this.client.selectTank(tank.tankId)),
        {disabled,className:'m8-select-tank'+(selected?' selected':''),title:this.assets.tankName(tank.tankId),testId:'m8-select-'+tank.tankId});
      button.dataset.tankId=String(tank.tankId);button.setAttribute('aria-pressed',String(selected));
      place(button,index%5*102,Math.floor(index/5)*102,96,96);
      button.style.backgroundImage=`url("${this.assets.ui.assets[selected?'selection.tileSelected':'selection.tileUnselected'].url}")`;
      const level=Math.max(1,Math.min(11,Math.trunc(Number(tank.level)||1)));
      button.setAttribute('aria-label',`${this.assets.tankName(tank.tankId)} · Lv.${level}`);
      button.append(this.assets.portraitForTank(tank,{size:96}));
      // TileTankRenderer: TkLvSimImg, horizontalCenter=0, y=2, above AvatarView.
      const levelArt=this.assets.get(`chrome.tankLevel${level}`);
      if(levelArt)button.append(place(assetImage(levelArt,`Lv.${level}`,'m8135-selection-level'),(96-levelArt.width)/2,2,levelArt.width,levelArt.height));
      this.selectionTileCleanups.push(this.selectionInfo.bind(button,{...tank,externalId:this.assets.tankExternal(tank)}));return button;
    }));
  }
  updateCountdown() {
    this.roomInvitations?.update();
    if(this.screen==='hall'&&this.hallKind==='ranked')this.rankedView?.tick();
    if(this.screen==='selecting'&&this.state&&this.selectionClock)
      {const remaining=selectionSecondsLeft(this.state.flow,Date.now())??'—';setText(this.selectionClock,remaining);if(this.selectionEnemyClock)setText(this.selectionEnemyClock,remaining);}
  }
  buildLoading() {this.loadingView=new M86LoadingView(this);}
  updateLoading() {this.loadingView?.update(this.state);}
  showSettings() {
    if(this.settingsDialog||!this.loaded||this.state?.phase!=='ready'||this.pveRoomController?.interactionLocked)return;
    const view=this.getBattleView(),inBattle=this.state.play.phase==='scene',focus=document.activeElement;
    if(inBattle)view?.input.releaseAll('settings');
    const surface=createSettingsSurface();
    this.settingsDialog=surface.root;
    this.settingsScope={generation:this.client.generation,accountId:this.state.accountId,phase:this.state.play.phase};
    const close=(restoreFocus=true)=>{
      const current=this.settingsScope;this.settingsScope=null;
      this.settingsController?.dispose();this.settingsController=null;
      surface.dispose();this.settingsDialog=null;this.closeSettings=null;
      if(restoreFocus&&current?.generation===this.client.generation&&this.state?.phase==='ready'){
        if(inBattle&&this.state.play.phase==='scene')view?.input.activate();
        else if(focus?.isConnected)focus.focus({preventScroll:true});
      }
    };
    this.closeSettings=close;
    try{
      this.settingsController=new M81Settings({host:surface.stage,client:this.client,assets:{...this.assets.panels.assets,...this.assets.ui.assets},run:this.run,getBattleView:this.getBattleView,menuAudio:this.menuAudio,onClose:close,onFullscreen:()=>view?.toggleFullscreen()});
      this.settingsController.update(this.state);surface.resize();
      surface.stage.querySelector('button:not(:disabled),input:not(:disabled)')?.focus({preventScroll:true});
    }catch(error){close(false);throw error;}
  }
  snapshot(){return {screen:this.screen,loaded:!!this.loaded,portraitAnimations:this.assets.animations.size,audio:this.menuAudio.snapshot()};}
  dispose(){this.closeSettings?.(false);this.menuAudio.dispose();this.selectionExtras?.dispose();this.selectionInfo?.dispose();clearInterval(this.clock);this.resizeObserver.disconnect();this.controller?.dispose();this.pvePageController?.dispose();this.pveRoomController?.dispose();this.loadingView?.dispose();this.assets.dispose();}
}
