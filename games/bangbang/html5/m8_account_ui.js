import {createCharacterAppearance} from './m84_character.js';
import {renderNativeShop} from './m84_shop.js';
import {renderCosmeticInventory} from './m84_inventory.js';
import {renderAccountPaging,ACCOUNT_PAGER_GEOMETRY} from './m81_account_paging.js';
import {renderGuildMove} from './m81_guild_move.js';
import {renderGuildMemberOptions} from './m81_guild_member_options.js';
import {renderGuildTeamInfo} from './m81_guild_team_info.js';
import {renderNativeGuildMembers} from './m81_guild_members.js';
import {renderGuildInvite} from './m81_guild_invite.js';
import {renderGuildCreate} from './m81_guild_create.js';
import {renderNativeShopConfirmation} from './m81_shop_confirmation.js';
import {renderGuildDonation} from './m81_guild_donation.js';
import {renderNativeMilitary} from './m81_military.js';
import {renderNativeGuild} from './m81_guild_view.js';
import {createNativePanel} from './m81_native_panel.js';
import {createCommonAsk} from './m82_common_ask.js';
import {M81332EconomyDialog,economyProtection,economyReceiptText} from './m81332_economy_ui.js';
import {validateNormalShopCatalog,normalShopType,normalShopOffer,normalShopIcon,appendNormalShopBoxAction,
  renderNormalShopConfirmation,renderNormalShopRecovery} from './m81345_shop_ui.js';
/* Outside-battle account screens. Mutations use native requests or the explicit
 * M32 economy-v1 extension for quantity/UUID-safe sales;
 * rendered ownership, money, rank and Guild state come from accepted packets.
 * Schemas: cosmetic_shop.py, guilds.py, guild_protocol.py, character_info.py.
 */
import {element,actionButton,assetImage,field,selectInput,textInput,nativeText,numberText,note} from './m8_ui_helpers.js';
import {renderGuildManagement,renderGuildMembers,renderGuildInvitations,guildName,guildPermissions} from './m81_guild_management.js';
import {renderPublicProfile} from './m81_profile.js';
import {renderLeaderboard,loadLeaderboard,renderPublicRankDetail} from './m82_leaderboard.js';
import {renderInventoryShell,placeInventoryDetails} from './m82_account_shell.js';
import {nativeMilitaryView,ownGuildMember} from './m8_account_state.js';

const BAG_TYPES=[[2,'Vật phẩm'],[3,'Nguyên liệu'],[4,'Avatar'],[7,'Phông nền'],[6,'Skin tank'],[10,'Pha lê'],[9,'Hào quang'],[8,'Tạm giữ'],[1,'Trang bị'],[5,'Bổ trợ']];
const SECTIONS={inventory:'Kho đồ',shop:'Cửa hàng',profile:'Hồ sơ',military:'Quân hàm',leaderboard:'Xếp hạng',guild:'Guild'};
// Native guilds.SLOTS, not a guessed contiguous range. Slot 1 accepts active skills.
const GUILD_SLOTS=[1,5,6,7,8];
const MILITARY_ATTRS={1:'Công vật lý / năng lượng',3:'Xuyên giáp / năng lượng',6:'Giáp vật lý',7:'Giáp năng lượng',12:'HP',14:'Hồi chiêu đánh thường'};
const currencyField=type=>['cash','golden','silver','honor','crystal','presentPoint'][Number(type)-1];
const currencyName=type=>['Xu','Bạc','Phiếu quà','Huy chương','Pha lê','Điểm quà'][Number(type)-1]||'Tiền';
export function guildMoveState(snapshot,memberUuid,originTeamId,{teamId=0,otherUuid='',stage='choose'}={}) {
 const a=snapshot?.account||{},member=Object.values(a.members||{}).flat().find(m=>m.charUuid===memberUuid),rights=guildPermissions(a,snapshot?.meta?.character?.charUuid,member);
 const teams=(a.teams||[]).filter(t=>t.teamId!==originTeamId).map(t=>({...t,memberCount:Array.isArray(a.members?.[t.teamId])?a.members[t.teamId].length:null,leaderName:Object.values(a.buddies||{}).find(b=>b.charUuid===t.leaderUuid)?.name??'—'}));
 const dest=teams.find(t=>t.teamId===teamId),members=(a.members?.[teamId]||[]).filter(m=>m.charUuid!==dest?.leaderUuid).map(m=>({...m,name:a.buddies?.[m.accountId]?.name??m.charUuid,level:a.buddies?.[m.accountId]?.level}));
 let error='';if(!a.guild||!member||member.teamId!==originTeamId)error='Thành viên hoặc đội gốc đã thay đổi.';else if(!rights.move)error='Không còn quyền chuyển thành viên này.';else if(!dest)error='Chọn đội đích hợp lệ.';else if(dest.memberCount===null)error='Chưa có danh sách thành viên đội đích.';else if((stage==='exchange'||otherUuid)&&!rights.officer)error='Chỉ chủ/phó Guild được đổi chỗ thành viên.';else if(stage==='exchange'&&!members.some(m=>m.charUuid===otherUuid))error='Chọn thành viên đổi chỗ hợp lệ.';else if(stage==='choose'&&dest.memberCount>=10&&!rights.officer)error='Đội đích đã đầy.';
 return {valid:!error,error,canExchange:rights.officer,teams,members};
}
export function guildCreationState(snapshot,catalog,names,team=false) {
  const account=snapshot?.account||{},char=snapshot?.meta?.character||{},card=catalog.guildItems?.['2600007'];
  const cardCount=Object.values(snapshot?.meta?.containers||{}).flatMap(b=>b.items||[]).filter(i=>i.templateId===2600007).reduce((n,i)=>n+Math.max(0,i.count),0);
  const canBuy=!team&&!account.guild&&!!card&&Number(char.currency?.golden||0)>=card.silverPrice;
  let error='',normalized=null;
  try{normalized={name:guildName(names?.name),...(!team?{teamName:guildName(names?.teamName)}:{})};}catch(e){error=e.message;}
  if(team){
    const g=account.guild,cap=Number((catalog.guildLevels||[]).find(r=>r.nLevel===g?.level)?.nTeamCount||0);
    if(!g||!guildPermissions(account,char.charUuid||'').officer)error='Chỉ chủ hoặc phó Guild có thể tạo Team.';
    else if(g.coin<10000)error='Cần quỹ Guild ít nhất 10.000.';
    else if(!cap||(account.teams||[]).length>=cap)error='Đã đạt giới hạn số Team của Guild.';
  }else if(account.guild)error='Bạn đã tham gia Guild.';
  else if(cardCount<1)error='Cần 1 Thẻ Tạo Guild.';
  return {valid:!error,error,names:normalized,cardCount,canBuy,detail:team?'Cần 10.000 quỹ; tạo Team trừ 1.000 quỹ Guild.':''};
}
export function restoreAccountFieldFocus(input,selection) {
  input.focus({preventScroll:true});
  if(selection&&selection.every(Number.isInteger)&&typeof input.setSelectionRange==='function'&&(input.tagName==='TEXTAREA'||['text','search','url','tel','password'].includes(input.type)))input.setSelectionRange(...selection);
}
export function shopPreviewAppearance(character,preview={}) {
  return {...character,...(preview.avatarId!=null?{avatarId:preview.avatarId}:{}),...(preview.decorateId!=null?{decorateId:preview.decorateId}:{})};
}
export function militaryAttributeText(value,valueType) {
  // MilitaryRankView multiplies cooldown ratios by 100; -0.005 is -0.5%.
  if(valueType===2)return `${(Number(value)*100).toLocaleString('vi-VN',{minimumFractionDigits:1,maximumFractionDigits:1})}%`;
  return `${Number(value)>=0?'+':''}${numberText(value)}`;
}

export function inventoryEntries(meta,containerType) {
  return (meta?.containers?.[String(containerType)]?.items||[]).filter(item=>item.count>0)
    .slice().sort((a,b)=>a.slotNo-b.slotNo);
}
// Position is the native slot number, not the index after removing empty stacks.
// A consumed stack leaves a visible hole; later pages may contain sparse slots.
export function inventoryPage(meta,containerType,page=0,pageSize=45) {
  const rows=inventoryEntries(meta,containerType);
  const last=rows.reduce((max,row)=>Math.max(max,row.slotNo),-1);
  const capacity=containerType===2?Math.max(45,45+Number(meta?.character?.groceryAdd||0),last+1):Math.max(45,last+1);
  const pages=Math.max(1,Math.ceil(capacity/pageSize));
  page=Math.max(0,Math.min(Number.isInteger(page)?page:0,pages-1));
  const bySlot=new Map(rows.map(row=>[row.slotNo,row]));
  return {page,pages,capacity,slots:Array.from({length:pageSize},(_,i)=>bySlot.get(page*pageSize+i)||null)};
}
export function cosmeticPurchaseState(meta,goods) {
  const owned=inventoryEntries(meta,goods.containerType).find(item=>item.templateId===goods.itemId);
  const balance=Number(meta?.character?.currency?.[currencyField(goods.coinType)]||0);
  return {owned:!!owned,item:owned||null,balance,affordable:balance>=goods.price,
    equipped:Number(goods.containerType===4?meta?.character?.avatarId:meta?.character?.decorateId)===goods.itemId};
}
export function guildSkillOptions(account,catalog,slotId) {
  const active=slotId===1;
  return (catalog?.guildSkills||[]).filter(row=>row.nLevel===Math.min(account?.learned?.[row.nGuildSkillId]||0,
    account?.research?.[row.nGuildSkillId]||0) && active===[1,2].includes(row.skillType)
    && !Object.values(account?.slots||{}).some(slot=>slot.slotId!==slotId&&slot.skillId===row.nGuildSkillId))
    .map(row=>({value:row.nGuildSkillId,label:`${nativeText(row.name)} · Lv ${row.nLevel}`,level:row.nLevel}));
}
function makeTable(headers,rows) {
  const table=element('table',null,'m8-account-table'),head=element('thead'),tr=element('tr');
  for(const label of headers)tr.append(element('th',label));head.append(tr);table.append(head);
  const body=element('tbody');for(const row of rows){const tr=element('tr');for(const value of row){const td=element('td');
    if(value instanceof Node)td.append(value);else td.textContent=String(value??'—');tr.append(td);}body.append(tr);}table.append(body);return table;
}

export class M8AccountUI {
  constructor({host,client,catalog,assets,run,section='inventory',onClose=()=>{},onSection=()=>{}}) {
    this.host=host;this.client=client;this.catalog=catalog||assets?.account||{};this.assets=assets;
    this.onClose=onClose;this.onSection=onSection;this.run=run||((task)=>task());this.section=SECTIONS[section]?section:'inventory';
    this.bag=2;this.page=0;this.shopType=4;this.query='';this.selectedUuid=null;this.guildTab='overview';
    this.pending=false;this.message='';this.messageError=false;this.confirmation=null;this.disposed=false;
    this.fields={};this.cache={};this.loading=new Set();this.epoch=0;
  }
  setSection(section) {
    if(!SECTIONS[section]||this.section===section)return;
    this.economyDialog?.dispose();
    this.section=section;this.onSection?.(section);this.page=0;this.query='';this.confirmation=null;this.message='';this.render();this.loadSection();
  }
  update(snapshot) {
    if(this.disposed)return;
    const identity=String(snapshot?.meta?.character?.accountId||snapshot?.accountId||'');
    if(this.identity!==identity||this.connectionGeneration!==this.client.generation){this.economyDialog?.dispose();this.identity=identity;this.connectionGeneration=this.client.generation;
      this.epoch++;this.guildMemberView=null;this.guildApplicationView=null;this.accountPagerStates={};this.rankKind='stars';this.rankPages=1;this.recruitEdits={};this.queryTickets={};this.shopPreview={};this.inventoryDetails=false;this.inventoryMore=false;this.guildPage=0;this.guildJoinable=false;this.profileIdentity=null;this.rankPage=0;this.cache={};this.loading.clear();this.confirmation=null;this.fields={};this.pending=false;this.message='';}
    if(this.snapshot?.meta?.character?.avatarId!==snapshot?.meta?.character?.avatarId||this.snapshot?.meta?.character?.decorateId!==snapshot?.meta?.character?.decorateId)this.shopPreview={};
    this.snapshot=snapshot;
    this.economyDialog?.update(snapshot);
    const signature=[snapshot?.meta?.revision,snapshot?.account?.revision,snapshot?.companions?.revision,snapshot?.economy?.revision,snapshot?.normalShop?.revision,
      snapshot?.phase,snapshot?.play?.phase,identity,this.client.generation].join('|');
    if(signature!==this.signature){this.signature=signature;this.render();this.loadSection();}
  }
  canMutate(){return !this.pending&&!this.snapshot?.economy?.pending&&!this.snapshot?.normalShop?.pending&&this.snapshot?.phase==='ready'&&['lobby','room'].includes(this.snapshot?.play?.phase);}
  saleSelection(){const page=inventoryPage(this.snapshot?.meta,this.bag,this.page).slots;return page.find(row=>row?.uuid===this.selectedUuid)||page.find(Boolean)||null;}
  saleState(){
    if(this.snapshot?.economy?.pending)return {recover:true,enabled:!this.pending&&this.snapshot?.phase==='ready'&&['lobby','room'].includes(this.snapshot?.play?.phase),reason:'Kiểm tra biên nhận giao dịch trước; không gửi lại.'};
    const item=this.saleSelection(),reason=![2,3].includes(this.bag)?'Chỉ bán Vật phẩm và Nguyên liệu.':!item?'Chọn vật phẩm cần bán.':economyProtection(item);
    return {item,enabled:this.canMutate()&&!reason,reason:reason||'Bán vật phẩm đã chọn: 1 Xu vàng / đơn vị.'};
  }
  sellSelected(){
    if(this.disposed||this.economyDialog)return;
    const state=this.saleState();if(!state.enabled)return;
    this.economyDialog=new M81332EconomyDialog({client:this.client,kind:'sell',container:this.bag,items:state.recover?[]:[state.item],
      name:item=>nativeText(this.itemDefinition(item).name||'Vật phẩm'),
      onComplete:receipt=>{if(!this.disposed){this.message=economyReceiptText(receipt);this.messageError=false;this.inventoryDetails=false;this.render();}},
      onClose:()=>{this.economyDialog=null;}});
  }
  ui(key){return this.assets?.get?.(key)||this.assets?.ui?.assets?.[key]||null;}
  image(asset,alt='',className=''){const value=typeof asset==='string'?this.ui(asset)||this.assets?.get?.(asset):asset;return this.assets?.menuArt?this.assets.menuArt(value,alt,className):assetImage(value,alt,className);}
  itemDefinition(item){return this.assets?.garage?.items?.[item.templateId]||normalShopOffer(this,item.templateId)||{};}
  cosmetic(itemId){return (this.catalog.cosmetics||[]).find(row=>row.itemId===Number(itemId));}
  cosmeticIcon(goods){return this.ui(`cosmetic.icon.${goods?.itemId}`)||goods?.icon;}
  openCosmeticBag(containerType=4){
    if(![4,7].includes(containerType)||this.disposed)return;
    this.bag=containerType;this.page=0;this.selectedUuid=null;this.inventoryDetails=false;
    this.inventoryMore=false;
    if(this.section!=='inventory')this.setSection('inventory');else this.render();
  }
  useCosmeticItem(containerType,item,context={epoch:this.epoch,generation:this.client.generation}){
    const currentContext=()=>!this.disposed&&this.epoch===context.epoch&&this.client.generation===context.generation;
    if(![4,7].includes(containerType)||!currentContext())return;
    return this.perform(()=>{
      if(!currentContext())throw new Error('Phiên nhân vật đã thay đổi.');
      const current=(this.client.snapshot?.()||this.snapshot).meta?.containers?.[String(containerType)]?.items
        ?.find(row=>row.uuid===item.uuid&&row.slotNo===item.slotNo&&row.templateId===item.templateId&&row.count>0);
      if(!current)throw new Error('Vật phẩm trong ô này đã thay đổi. Hãy chọn lại.');
      return this.client.useCosmetic(containerType,current.slotNo);
    },containerType===4?'Đã sử dụng thời trang.':'Đã sử dụng trang trí.');
  }
  button(text,handler,options={}){return actionButton(text,handler,{...options,disabled:this.pending||!!options.disabled});}
  input(key,value='',options={}) {
    const input=textInput(this.fields[key]??value,options);input.dataset.accountField=key;
    input.addEventListener('input',()=>{this.fields[key]=input.value;});return input;
  }
  async perform(task,success='Đã cập nhật.') {
    if(!this.canMutate())return;
    const epoch=this.epoch;
    this.pending=true;this.message='Đang chờ máy chủ xác nhận…';this.messageError=false;this.confirmation=null;this.render();
    try {await this.run(async()=>{try {await task();if(!this.disposed&&epoch===this.epoch)this.message=success;}catch(error){if(!this.disposed&&epoch===this.epoch){this.message=error?.message||'Chưa cập nhật được.';this.messageError=true;}throw error;}});}
    catch(error){if(!this.disposed&&epoch===this.epoch){this.message=error?.message||'Chưa cập nhật được.';this.messageError=true;}}
    finally {if(!this.disposed&&epoch===this.epoch){this.pending=false;this.snapshot=this.client.snapshot?.()||this.snapshot;this.render();}}
  }
  confirm(title,detail,task,{image=null,button='Xác nhận',success='Đã cập nhật.',...presentation}={}) {
    this.confirmation={title,detail,task,image,button,success,...presentation,epoch:this.epoch,returnFocus:document.activeElement?.dataset?.testid};this.render();
  }
  async queryServer(key,route,params={},force=false) {
    if(this.disposed)return;
    this.queryTickets ||= {};
    const query=JSON.stringify([route,params]);
    if(!force&&this.queryTickets[key]?.query===query&&(this.loading.has(key)||Object.hasOwn(this.cache,key)))return;
    const epoch=this.epoch,ticket={query};this.queryTickets[key]=ticket;delete this.cache[key];this.loading.add(key);this.render();
    const current=()=>!this.disposed&&epoch===this.epoch&&this.queryTickets[key]===ticket;
    try {const value=await this.client.publicQuery(route,params);if(current())this.cache[key]=key==='normalShop'?validateNormalShopCatalog(value):value;}
    catch(error){if(current())this.cache[key]={queryError:error?.message||'Không đọc được dữ liệu.'};}
    finally {if(current()){this.loading.delete(key);this.render();}}
  }
  guildListParams(){return {p:this.guildPage||0,li:10,...(this.guildJoinable?{char:this.snapshot.meta?.character?.charUuid||this.identity}:{})};}
  loadSection() {
    if(!this.identity||this.snapshot?.phase!=='ready')return;
    if(this.section==='inventory')this.queryServer('inventoryProfile','observechar.php',{charoid:this.identity});
    if(this.section==='inventory'||this.section==='shop'&&normalShopType(this.shopType))this.queryServer('normalShop','capi/normalshopquery.php');
    if(this.section==='profile')this.queryServer('profile','observechar.php',{charoid:this.profileIdentity||this.identity});
    if(this.section==='leaderboard')loadLeaderboard(this);
    if(this.section==='guild'&&!this.snapshot?.account?.guild)this.queryServer('guildList','cGuildJoinList.php',this.guildListParams());
  }
  refresh() {
    if(this.section==='shop'&&normalShopType(this.shopType))this.queryServer('normalShop','capi/normalshopquery.php',{},true);
    else if(this.section==='profile')this.queryServer('profile','observechar.php',{charoid:this.profileIdentity||this.identity},true);
    else if(this.section==='leaderboard')loadLeaderboard(this,true);
    else if(this.section==='guild'&&this.snapshot?.account?.guild)this.perform(()=>this.client.guildAction('refresh'),'Đã làm mới Guild.');
    else if(this.section==='guild')this.queryServer('guildList','cGuildJoinList.php',this.guildListParams(),true);
    else this.render();
  }
  render() {
    if(this.disposed||!this.snapshot)return;
    this.profileCompanionTooltip?.reset();
    const focus=document.activeElement?.dataset?.accountField;
    const selection=focus?[document.activeElement.selectionStart,document.activeElement.selectionEnd]:null;
    const scroll=this.host.querySelector('.m8-account-scroll')?.scrollTop||0;
    const profileScroll=this.renderedProfile===this.cache.profile?.char_uuid?this.host.querySelector('.m81-profile-tank-list')?.scrollTop||0:0;
    const guildScroll=this.renderedGuildId===this.snapshot.account?.guild?.guildId
      ?this.host.querySelector('.m81-guild-workspace')?.scrollTop||0:0;
    const shell=element('section',null,'m8-account');shell.dataset.section=this.section;
    // Native modal content overlays the persistent world/underlay. Painting a
    // second 1000x600 background here would hide the live lobby around the frame.
    const nativeLayout={inventory:{width:870,height:566,kind:'box1',state:'BOTTOM_BAR',title:'zh_CN/gui_summer/controls/tankbarn/title_barn_t.png'},profile:{width:828,height:568,kind:'box1',state:'BOTTOM_BAR',title:'account.profileTitle'},leaderboard:{width:882,height:532,kind:'box2'},shop:{width:1020,height:620,kind:'box1',state:'BOTTOM_BAR',title:'account.shopTitle'}}[this.section];
    let nativePanel=null;
    if(nativeLayout){
      const assets={...this.assets.panels.assets,...this.assets.ui.assets,...this.assets.shells?.assets};
      const title=nativeLayout.title&&assets[nativeLayout.title];
      nativePanel=createNativePanel({assets,...nativeLayout,title:title?{asset:nativeLayout.title,x:this.section==='inventory'?413:(nativeLayout.width-title.width)/2,y:19,label:SECTIONS[this.section]}:undefined,
        close:{asset:'public.close',x:nativeLayout.width-39,y:nativeLayout.kind==='box2'?33:15,label:'Đóng'},onClose:()=>this.onClose()});
      Object.assign(nativePanel.root.style,{position:'absolute',left:`${(Math.max(1000,nativeLayout.width)-nativeLayout.width)/2}px`,top:`${(Math.max(600,nativeLayout.height)-nativeLayout.height)/2}px`});
      shell.classList.add('m81-account-native');
    }
    if(['guild','military'].includes(this.section))shell.classList.add('m81-account-native');
    const panel=nativePanel?.content||element('div',null,this.section==='guild'?'m81-guild-root':this.section==='military'?'m81-military-root':'m8-account-panel');const toolbar=element('div',null,'m8-account-toolbar');
    toolbar.append(element('h2',SECTIONS[this.section]));
    const tabs=element('nav',null,'m8-account-sections');tabs.setAttribute('aria-label','Tài khoản');
    for(const [key,name] of Object.entries(SECTIONS))tabs.append(this.button(name,()=>this.setSection(key),{className:key===this.section?'is-active':'',testId:`account-${key}`}));
    toolbar.append(tabs,this.button('Làm mới',()=>this.refresh(),{testId:'account-refresh'}));if(!nativePanel&&!['guild','military'].includes(this.section))panel.append(toolbar);
    this.guildMemberRoot=null;this.guildApplicationRoot=null;this.accountPagerRoots=[];
    const body=element('div',null,'m8-account-scroll');
    if(this.section==='inventory')this.renderInventory(body);
    else if(this.section==='shop')this.renderShop(body);
    else if(this.section==='profile')renderPublicProfile(this,body);
    else if(this.section==='leaderboard')renderLeaderboard(this,body);
    else if(this.section==='military')renderNativeMilitary(this,body);
    else renderNativeGuild(this,body);
    panel.append(body);const status=note(this.message||(!this.canMutate()&&!this.pending?'Về sảnh hoặc phòng chờ để thay đổi vật phẩm và Guild.':''),this.messageError?'error':'');
    status.classList.add('m8-account-status');status.setAttribute('aria-live','polite');if(!nativePanel||this.message)panel.append(status);shell.append(nativePanel?.root||panel);
    const previousConfirmation=this.renderedConfirmation;let modal=null;
    if(this.confirmation){const background=nativePanel?.root||panel;background.inert=true;modal=this.renderConfirmation();shell.append(modal);}
    this.host.replaceChildren(shell);body.scrollTop=scroll;modal?.restoreScroll?.();
    if(!this.confirmation&&previousConfirmation?.epoch===this.epoch&&previousConfirmation.returnFocus)this.host.querySelector(`[data-testid="${previousConfirmation.returnFocus}"]`)?.focus({preventScroll:true});
    this.renderedConfirmation=this.confirmation;
    if(this.afterRenderFocus){this.host.querySelector(`[data-testid="${this.afterRenderFocus}"]`)?.focus({preventScroll:true});this.afterRenderFocus=null;}
    const tankList=this.host.querySelector('.m81-profile-tank-list');if(tankList)tankList.scrollTop=profileScroll;this.renderedProfile=this.cache.profile?.char_uuid;
    const guildWorkspace=this.host.querySelector('.m81-guild-workspace');if(guildWorkspace)guildWorkspace.scrollTop=guildScroll;
    this.renderedGuildTab=this.guildTab;this.renderedGuildId=this.snapshot.account?.guild?.guildId;
    const input=focus?[...(modal||this.host).querySelectorAll('[data-account-field]')].find(node=>node.dataset.accountField===focus&&!node.disabled):null;
    if(modal){if(input)restoreAccountFieldFocus(input,selection);else modal.initialFocus?.focus({preventScroll:true});}
    else if(input&&!previousConfirmation)restoreAccountFieldFocus(input,selection);
    if(!modal){this.guildMemberRoot?.restoreFocus();this.guildApplicationRoot?.restoreFocus();for(const root of this.accountPagerRoots||[])root.restoreFocus();}
  }
  avatarPreview(className='',appearance=null) {
    return createCharacterAppearance(this,appearance||this.snapshot.meta?.character||{},{mode:'profile',className});
  }
  renderInventory(body) {
    renderInventoryShell(this,body,BAG_TYPES);
    if([4,7].includes(this.bag))return renderCosmeticInventory(this,body,inventoryEntries(this.snapshot.meta,this.bag));
    const layout=element('div',null,'m8-account-inventory'),left=element('div',null,'m8-account-bag-wrap');
    const rows=inventoryEntries(this.snapshot.meta,this.bag),view=inventoryPage(this.snapshot.meta,this.bag,this.page);
    const pageCount=view.pages;this.page=view.page;
    const page=view.slots,selected=page.find(row=>row?.uuid===this.selectedUuid)||page.find(Boolean)||null;this.selectedUuid=selected?.uuid||null;
    const grid=element('div',null,'m8-account-bag-grid');
    for(let i=0;i<45;i++){
      const item=page[i],button=this.button('',()=>{this.selectedUuid=item.uuid;this.inventoryDetails=true;this.render();},{disabled:!item,className:'m8-account-bag-slot'+(item?.uuid===selected?.uuid?' is-selected':''),testId:item?`bag-item-${item.templateId}`:''});
      button.dataset.slotNo=String(this.page*45+i);
      const background=this.ui('account.itemGrid');if(background)button.style.backgroundImage=`url("${background.url}")`;
      if(item){const definition=this.itemDefinition(item),cosmetic=this.cosmetic(item.templateId);const icon=cosmetic?this.cosmeticIcon(cosmetic):this.assets?.get?.(definition.icon);
        const title=nativeText(cosmetic?.name||definition.name||'Vật phẩm');button.title=`${title} ×${numberText(item.count)}`;button.setAttribute('aria-label',button.title);
        if(icon)button.append(this.image(icon,title));
        else {const shopIcon=normalShopIcon(normalShopOffer(this,item.templateId)?.icon,title,'',49,49);if(shopIcon){Object.assign(shopIcon.style,{position:'absolute',left:'3px',top:'3px'});button.append(shopIcon);}}
        button.append(element('span',numberText(item.count),'m8-account-stack'));
        if(item.extFlag&32)button.append(element('span','✓','m8-account-equipped'));
      }grid.append(button);
    }left.append(grid,this.nativePager('bag',pageCount,left));layout.append(left);
    const detail=element('aside',null,'m8-account-detail');
    if(selected){const definition=this.itemDefinition(selected),cosmetic=this.cosmetic(selected.templateId);const title=nativeText(cosmetic?.name||definition.name||'Vật phẩm');
      detail.append(element('h3',title));const icon=cosmetic?this.cosmeticIcon(cosmetic):this.assets?.get?.(definition.icon);
      if(icon)detail.append(this.image(icon,title,'m8-account-item-preview'));
      else {const shopIcon=normalShopIcon(normalShopOffer(this,selected.templateId)?.icon,title,'m8-account-item-preview',125,130);if(shopIcon)detail.append(shopIcon);}
      detail.append(note(nativeText(cosmetic?.description||definition.description||'')),note(`Số lượng: ${numberText(selected.count)}`));
      appendNormalShopBoxAction(this,detail,selected,this.bag);
      if(this.bag===2&&selected.templateId===2600002){
        const input=this.input('renameCharacter','',{maxLength:12,placeholder:'Tên mới (1–12 ký tự)'});
        input.setAttribute('aria-label','Tên nhân vật mới');input.dataset.testid='rename-character-name';
        detail.append(input,this.button('Đổi tên',()=>{
          const name=String(this.fields.renameCharacter||'').normalize('NFC').trim();
          if(!name)return;
          this.confirm('Đổi tên nhân vật',`Đổi thành “${name}” bằng 1 Thẻ Đổi Tên.`,async()=>{
            await this.client.renameCharacter(name);delete this.cache.profile;delete this.cache.leaderboard;
            this.fields.renameCharacter='';
          },{success:'Đã đổi tên nhân vật.',button:'Đổi tên'});
        },{disabled:!this.canMutate(),testId:'rename-character'}));
      }
      if(cosmetic){const current=cosmeticPurchaseState(this.snapshot.meta,cosmetic);
        detail.append(this.button(current.equipped?'Đang dùng':'Sử dụng',()=>this.perform(()=>this.client.useCosmetic(this.bag,selected.slotNo),'Đã thay đổi diện mạo.'),
          {disabled:current.equipped||selected.lifeTime!==0||!this.canMutate(),testId:'inventory-equip'}));
        if(this.bag===7&&this.snapshot.meta?.character?.decorateId)detail.append(this.button('Bỏ phông nền',()=>this.perform(()=>this.client.useCosmetic(7,-1),'Đã bỏ phông nền.'),{disabled:!this.canMutate(),testId:'inventory-unequip-background'}));
      }
    }else detail.append(note('Ngăn này đang trống.'));
    renderNormalShopRecovery(this,detail);
    placeInventoryDetails(this,detail,selected,page);layout.append(detail);body.append(layout);
  }
  nativePager(kind,count,host) {
    this.accountPagerStates ||= {};this.accountPagerRoots ||= [];
    const root=renderAccountPaging({host,assets:this.assets.panels.assets,kind,page:this.page,pages:count,state:this.accountPagerStates[kind]||=( {} ),onChange:page=>{this.page=page;this.render();}}),geometry=ACCOUNT_PAGER_GEOMETRY[kind];
    Object.assign(root.style,{left:`${geometry.x}px`,top:`${geometry.y}px`});this.accountPagerRoots.push(root);return root;
  }
  renderShop(body) {
    return renderNativeShop(this,body,{purchaseState:cosmeticPurchaseState,previewAppearance:shopPreviewAppearance,currencyName});
  }
  renderProfile(body) {
    const char=this.snapshot.meta?.character||{},data=this.cache.profile;const layout=element('div',null,'m8-account-profile');layout.append(this.avatarPreview());
    const content=element('div',null,'m8-account-profile-info');const military=nativeMilitaryView(Number(char.militaryStar||0),this.catalog);
    const badge=military.current?.nativeIcon?this.assets?.get?.('zh_CN/II/tank/militaryRank/rank/'+military.current.nativeIcon):null;
    const rank=element('div',null,'m8-account-rank');if(badge)rank.append(this.image(badge,'Quân hàm'));rank.append(element('h3',nativeText(military.current?.name||'Quân hàm')),note(`${numberText(military.stars)} sao tank`));content.append(rank);
    const nextRank=(this.catalog.military||[]).find(row=>row.stars>military.stars&&row.rankId!==military.current?.rankId);
    content.append(makeTable(['Thông tin','Hiện tại'],[['Cấp nhân vật',numberText(char.level)],['Tank sở hữu',numberText((this.snapshot.meta?.tanks||[]).filter(t=>t.containerType===0).length)],
      ['Guild',this.snapshot.account?.guild?.name||'Chưa tham gia'],['Quân hàm kế tiếp',nextRank?`${nativeText(nextRank.name)} · ${numberText(nextRank.stars)} sao`:'Đã đạt mốc cao nhất']]));
    const attrs=Object.entries(military.totals).map(([key,value])=>{const [type,valueType]=key.split(':').map(Number);return [MILITARY_ATTRS[type]||'Thuộc tính',militaryAttributeText(value,valueType)];});
    if(attrs.length){content.append(element('h3','Thuộc tính quân hàm'),makeTable(['Thuộc tính','Tổng cộng'],attrs));}
    if(data?.queryError)content.append(note(data.queryError,'error'));
    else if(this.loading.has('profile'))content.append(note('Đang tải hồ sơ…'));
    else if(data?.state===1){content.append(note(`Tank chủ chiến: ${this.assets?.tankName?.(data.char_tank?.[0]?.tank_tplt_id)||'—'}`));}
    layout.append(content);body.append(layout);
  }
  renderGuildLegacy(body) {
    const account=this.snapshot.account||{};
    renderGuildInvitations(this,body,account);
    if(!account.guild){this.renderGuildJoin(body);return;}
    const guild=account.guild;const char=this.snapshot.meta?.character||{};const officer=!!char.charUuid&&[guild.leaderUuid,guild.viceLeaderUuid].includes(char.charUuid);
    const member=ownGuildMember(account,Number(char.accountId||this.identity));const team=(account.teams||[]).find(row=>row.teamId===account.selfTeamId);
    const summary=element('div',null,'m8-account-guild-summary');summary.append(element('h3',`${guild.name} · Cấp ${guild.level}`),
      element('span',`Quỹ ${numberText(guild.coin)} · ${team?.name||'Đội'} · Cống hiến ${numberText(member?.merit||0)}`));body.append(summary);
    const tabs=element('div',null,'m8-account-filter');for(const [key,label] of [['overview','Thông tin'],['skills','Kỹ năng'],['members','Thành viên'],['manage','Quản lý']])tabs.append(this.button(label,()=>{this.guildTab=key;this.render();},{className:this.guildTab===key?'is-active':'',testId:`guild-tab-${key}`}));body.append(tabs);
    if(this.guildTab==='skills')this.renderGuildSkills(body,account,member,officer);
    else if(this.guildTab==='members')this.renderGuildMembers(body,account);
    else if(this.guildTab==='manage')this.renderGuildManage(body,account);
    else {
      const cols=element('div',null,'m8-account-columns'),info=element('section',null,'m8-account-card');info.append(element('h3','Thông báo'),note(nativeText(guild.notice)||'Chưa có thông báo.'));
      info.append(makeTable(['Đội','Thành viên','Quỹ'],account.teams.map(t=>[t.name,numberText((account.members?.[t.teamId]||[]).length),numberText(t.coin)])));
      const next=(this.catalog.guildLevels||[]).find(row=>row.nLevel===guild.level);
      if(officer&&next?.iNextCoin)info.append(this.button('Nâng cấp Guild',()=>this.confirm('Nâng cấp Guild',`Tiêu ${numberText(next.iNextCoin)} quỹ Guild để lên cấp ${guild.level+1}.`,()=>this.client.guildAction('upgrade'),{success:'Đã nâng cấp Guild.'}),{disabled:!this.canMutate()||guild.coin<next.iNextCoin,testId:'guild-upgrade'}));
      info.append(this.button('Rời Guild',()=>this.confirm('Rời Guild','Rời Guild hiện tại? Giới hạn tham gia lại trong ngày do máy chủ áp dụng.',()=>this.client.guildAction('leave'),{button:'Rời Guild',success:'Đã rời Guild.'}),{disabled:!this.canMutate(),testId:'guild-leave'}));cols.append(info);
      const donate=element('section',null,'m8-account-card');this.renderDonation(donate,account);cols.append(donate);body.append(cols);
    }
  }
  renderGuildJoin(body) {
    const cols=element('div',null,'m8-account-columns'),list=element('section',null,'m8-account-card');list.append(element('h3','Tìm Guild'));
    const data=this.cache.guildList;
    if(this.loading.has('guildList'))list.append(note('Đang tải danh sách Guild…'));
    else if(data?.queryError)list.append(note(data.queryError,'error'));
    const rows=data?.datas||[];
    const search=this.input('guildSearch','',{placeholder:'Tên Guild chính xác…',maxLength:80});
    list.append(search,this.button('Tìm',()=>this.queryServer('guildSearchResult','cGuildInfo.php',{gn:search.value.trim()},true),{disabled:!search.value.trim(),testId:'guild-search'}));
    search.addEventListener('input',()=>{this.fields.guildSearch=search.value;this.render();});
    const filter=element('label',null,'m8-account-inline');const joinable=element('input');joinable.type='checkbox';joinable.checked=!!this.guildJoinable;
    joinable.addEventListener('change',()=>{this.guildJoinable=joinable.checked;this.guildPage=0;this.loadSection();});filter.append(joinable,element('span','Chỉ Guild có thể gia nhập'),this.button('Làm mới',()=>this.refresh()));list.append(filter);
    if(this.loading.has('guildSearchResult'))list.append(note('Đang tìm Guild…'));
    else if(Object.hasOwn(this.cache,'guildSearchResult')){
      const found=this.cache.guildSearchResult;
      if(found?.nGuildId)list.append(note(`${found.szGuildName} · Cấp ${found.nGuildLv} · ${found.nGuildNumMember} thành viên · Chủ Guild ${found.szGuildLeader}`),this.button('Xin tham gia',()=>this.confirm('Xin tham gia Guild',found.szGuildName,()=>this.client.guildAction('apply',{guildId:found.nGuildId,inviter:'',fast:0}),{success:'Đã gửi yêu cầu tham gia.'}),{disabled:!this.canMutate(),testId:'guild-search-apply'}));
      else list.append(note(found?.queryError||'Không tìm thấy Guild có tên này.'));
    }
    if(rows.length)list.append(makeTable(['Guild','Cấp / Thành viên',''],rows.map(row=>[`${row.guild_name}\n${row.guild_notice||''}`,`${row.guild_level} · ${row.guild_number}/${row.guild_maxnum}`,
      this.button(row.auto_join?'Tham gia':'Xin vào',()=>this.confirm(row.auto_join?'Tham gia Guild':'Xin vào Guild',`${row.guild_name} · yêu cầu cấp ${row.guild_level_limit}.`,
        ()=>this.client.guildAction('apply',{guildId:row.guild_id,inviter:'',fast:0}),{success:row.auto_join?'Đã tham gia Guild.':'Đã gửi đơn xin vào Guild.'}),
        {disabled:!this.canMutate()||Number(this.snapshot.meta?.character?.level||0)<Number(row.guild_level_limit)||Number(row.guild_ladder_limit)>0,testId:`guild-join-${row.guild_id}`})])));
    else if(!this.loading.has('guildList'))list.append(note('Chưa có Guild phù hợp.'));
    const pages=Math.max(1,Math.ceil(Number(data?.amount||0)/10)),pager=element('div',null,'m8-account-pager');
    const page=this.guildPage||0;const go=delta=>{this.guildPage=Math.max(0,Math.min(pages-1,page+delta));this.loadSection();};
    pager.append(this.button('‹',()=>go(-1),{disabled:page<=0,testId:'guild-page-prev'}),element('span',`${page+1} / ${pages}`),this.button('›',()=>go(1),{disabled:page+1>=pages,testId:'guild-page-next'}));list.append(pager);cols.append(list);
    const create=element('section',null,'m8-account-card');create.append(element('h3','Tạo Guild'),note('Cần 1 Thẻ Tạo Guild. Tên Guild và tên đội tối đa 12 byte UTF-8.'));
    const card=this.catalog.guildItems?.['2600007'];
    if(card)create.append(this.button('Mua thẻ · '+numberText(card.silverPrice)+' Bạc',()=>this.buyGuildCreationCard(),{disabled:!this.canMutate()||Number(this.snapshot.meta?.character?.currency?.golden||0)<card.silverPrice,testId:'guild-buy-create-card'}));
    create.append(this.button('Tạo Guild',()=>this.openGuildCreation(false),{disabled:!this.canMutate(),testId:'guild-create'}));cols.append(create);body.append(cols);
  }
  buyGuildCreationCard() {
    const card=this.catalog.guildItems?.['2600007'];if(!card||!this.canMutate())return;
    this.confirm('Mua '+nativeText(card.name),`${numberText(card.silverPrice)} Bạc · 1 thẻ.`,()=>this.client.guildPurchase(card,{coinType:2,count:1}),{image:card.icon,success:'Đã mua Thẻ Tạo Guild.'});
  }
  openGuildCreation(team=false) {
    if(!this.canMutate())return;
    this.confirm(team?'Tạo Team':'Tạo Guild','',null,{kind:team?'team-create':'guild-create',
      creationState:names=>guildCreationState(this.snapshot,this.catalog,names,team),
      task:names=>{const s=guildCreationState(this.snapshot,this.catalog,names,team);if(!s.valid)throw new Error(s.error);return this.client.guildAction(team?'createTeam':'create',s.names);},
      ...(!team?{buyCard:()=>this.buyGuildCreationCard()}:{}),success:team?'Đã tạo Team.':'Đã tạo Guild.'});
  }
  openGuildInvite(teamId,operation='invite') {
    if(!this.canMutate()||!['invite','inviteTeam'].includes(operation))return;
    const team=this.snapshot.account?.teams?.find(t=>t.teamId===teamId);if(!team)return;
    const inviteState=value=>{
      const account=this.snapshot.account||{},uuid=this.snapshot.meta?.character?.charUuid||'',name=String(value).trim();
      if(!account.guild||!account.teams?.some(t=>t.teamId===teamId)||!guildPermissions(account,uuid).inviteTeam(teamId))return {error:'Bạn không còn quyền mời vào Team này.'};
      if(!name||name.length>100||/[\x00-\x1f]/.test(name))return {error:'Nhập tên nhân vật hợp lệ.'};
      return {error:'',name};
    };
    this.confirm(operation==='invite'?'Mời vào Guild':'Mời chuyển Team','',null,{kind:'guild-invite',teamName:team.name,inviteState,
      task:value=>{const state=inviteState(value);if(state.error)throw new Error(state.error);return this.client.guildAction(operation,{name:state.name,teamId});},
      success:'Máy chủ đã xử lý yêu cầu mời; chỉ nhận được lời mời khi người nhận hợp lệ và đang kết nối.'});
  }
  renderDonation(host,account) {
    const item=this.catalog.guildItems?.['8000002'];host.append(element('h3','Cống hiến Team'));if(!item)return;
    host.append(note(`Mỗi 10 cống hiến: ${numberText(item.silverPrice)} Bạc hoặc ${numberText(item.cashPrice)} Xu; 3 quỹ Guild, 7 quỹ Team.`));
    host.append(this.button('Cống hiến',()=>this.confirm('Cống hiến Team','',null,{kind:'donation',item}),{disabled:!this.canMutate(),testId:'guild-donate'}));
  }
  renderGuildSkills(body,account,member,officer) {
    const slots=element('div',null,'m8-account-guild-slots');
    for(const [index,slotId] of GUILD_SLOTS.entries()){
      const box=element('div',null,'m8-account-slot'),open=!!(account.slotFlags&(1<<slotId));box.append(element('strong',slotId===1?'Kỹ năng chủ động':`Bị động ${index}`));
      if(!open){const cost=750*index**2;box.append(note(`${numberText(cost)} cống hiến`),this.button('Mở ô',()=>this.confirm('Mở ô kỹ năng',`Tiêu ${numberText(cost)} cống hiến.`,()=>this.client.guildAction('unlockSlot',{slotId}),{success:'Đã mở ô kỹ năng.'}),{disabled:!this.canMutate()||Number(member?.merit||0)<cost,testId:`guild-unlock-${slotId}`}));}
      else {const options=guildSkillOptions(account,this.catalog,slotId),current=account.slots?.[slotId];const select=selectInput([{value:0,label:'Không trang bị'},...options],current?.skillId||0,`Kỹ năng ô ${slotId}`);
        box.append(select,this.button('Lưu',()=>{const skillId=Number(select.value),row=options.find(o=>Number(o.value)===skillId);this.perform(()=>this.client.guildAction('equipSkill',{slotId,skillId,level:row?.level||0}),'Đã lưu ô kỹ năng.');},{disabled:!this.canMutate(),testId:`guild-equip-${slotId}`}));}
      slots.append(box);
    }body.append(slots);
    const groups=[...new Set((this.catalog.guildSkills||[]).map(row=>row.nGuildSkillId))];const grid=element('div',null,'m8-account-skill-grid');
    for(const skillId of groups){const levels=this.catalog.guildSkills.filter(row=>row.nGuildSkillId===skillId),base=levels[0];
      const learned=Number(account.learned?.[skillId]||0),researched=Number(account.research?.[skillId]||0);
      const learn=levels.find(row=>row.nLevel===learned+1),research=levels.find(row=>row.nLevel===researched+1);const card=element('article',null,'m8-account-skill');
      card.append(this.image(base.icon,nativeText(base.name)),element('h4',nativeText(base.name)),note(`Đã học ${learned} · Guild ${researched}`),note(nativeText((levels.find(row=>row.nLevel===learned)||base).description)));
      if(learn)card.append(this.button(`Học Lv ${learn.nLevel} · ${numberText(learn.nNeedMerit)}`,()=>this.confirm('Học '+nativeText(base.name),`Lv ${learn.nLevel} · ${numberText(learn.nNeedMerit)} cống hiến.`,()=>this.client.guildAction('learn',{skillId}),{image:base.icon,success:'Đã học kỹ năng Guild.'}),
        {disabled:!this.canMutate()||learn.nLevel>researched||Number(this.snapshot.meta?.character?.level||0)<learn.nCharLevelMin||Number(member?.merit||0)<learn.nNeedMerit,testId:`guild-learn-${skillId}`,title:`Cần nhân vật cấp ${learn.nCharLevelMin}, Guild nghiên cứu cấp ${learn.nLevel}.`}));
      if(officer&&research)card.append(this.button(`Nghiên cứu Lv ${research.nLevel} · ${numberText(research.nResearchFee)}`,()=>this.confirm('Nghiên cứu '+nativeText(base.name),`Lv ${research.nLevel} · ${numberText(research.nResearchFee)} quỹ Guild.`,()=>this.client.guildAction('research',{skillId}),{image:base.icon,success:'Đã nghiên cứu kỹ năng Guild.'}),
        {disabled:!this.canMutate()||account.guild.level<research.nNeedGuildLevel||account.guild.coin<research.nResearchFee,testId:`guild-research-${skillId}`,title:`Cần Guild cấp ${research.nNeedGuildLevel}.`}));
      grid.append(card);
    }body.append(grid);
  }
  openGuildMove(memberUuid) {
    const member=Object.values(this.snapshot.account?.members||{}).flat().find(m=>m.charUuid===memberUuid);if(!member)return;
    const originTeamId=member.teamId,guildId=this.snapshot.account?.guild?.guildId;
    const creationState=selection=>{if(this.snapshot.account?.guild?.guildId!==guildId)return {valid:false,error:'Guild đã thay đổi.',teams:[],members:[]};return guildMoveState(this.snapshot,memberUuid,originTeamId,selection);};
    this.confirm('Chuyển đội','',selection=>{const state=creationState({...selection,stage:selection.otherUuid?'exchange':'choose'});if(state.error)throw new Error(state.error);return this.client.guildAction('move',{originTeamId,charUuid:memberUuid,teamId:selection.teamId,otherUuid:selection.otherUuid||''});},{kind:'guild-move',creationState,success:'Đã chuyển đội theo phản hồi máy chủ.'});
  }
  renderGuildMembers(body,account) {
    this.guildMemberRoot=renderNativeGuildMembers(this,body,account,{
      onMember:member=>this.confirm('Thành viên Guild','',null,{kind:'guild-member',memberUuid:member.charUuid}),
      onTeam:team=>this.confirm('Thông tin đội','',null,{kind:'guild-team-info',teamId:team.teamId})});
    const uuid=this.snapshot.meta?.character?.charUuid,me=Object.values(account.members||{}).flat().find(m=>m.charUuid===uuid);
    if(me&&guildPermissions(account,uuid,me).move&&account.teams.length>1){const move=this.button('Chuyển đội của tôi',()=>this.confirm('Chuyển đội','',null,{kind:'guild-member',memberUuid:uuid}),{testId:'guild-self-move'});Object.assign(move.style,{position:'absolute',top:'320px',left:'4px'});body.append(move);}
  }
  renderGuildMemberOptions(value) {
    const account=this.snapshot.account||{},member=Object.values(account.members||{}).flat().find(m=>m.charUuid===value.memberUuid);
    const charUuid=this.snapshot.meta?.character?.charUuid,p=guildPermissions(account,charUuid,member),actions=[];
    const memberAction=(op,post)=>{const fresh=()=>{const a=this.snapshot.account||{},m=Object.values(a.members||{}).flat().find(m=>m.charUuid===value.memberUuid),rights=guildPermissions(a,this.snapshot.meta?.character?.charUuid,m);if(!m||(op==='remove'?!rights.remove:!rights.posts.includes(post)))throw new Error('Quyền hoặc thành viên đã thay đổi.');return {charUuid:m.charUuid,teamId:m.teamId,...(op==='appoint'?{post}:{})};};const label=op==='remove'?'Đuổi thành viên':({10:'Chuyển chủ hội',9:'Bổ nhiệm phó hội',5:'Bổ nhiệm đội trưởng',0:'Bỏ chức vụ'})[post];this.confirm(label,op==='remove'?'Máy chủ kiểm tra phí theo cống hiến và thời gian offline; không khấu trừ trước.':`Xác nhận ${label.toLowerCase()} cho thành viên đã chọn.`,()=>this.client.guildAction(op,fresh()),{button:label,success:'Đã cập nhật Guild.'});};
    if(member){
      if(p.move&&account.teams.length>1)actions.push({id:'guild-member-move',label:'Chuyển đội',run:()=>this.openGuildMove(member.charUuid)});
      if(p.remove)actions.push({id:`guild-remove-${member.accountId}`,label:'Đuổi thành viên',run:()=>memberAction('remove')});
      for(const post of [9,5,10,0].filter(n=>p.posts.includes(n)))actions.push({id:`guild-member-post-${post}`,label:({10:'Chuyển chủ hội',9:'Bổ nhiệm phó hội',5:'Bổ nhiệm đội trưởng',0:'Bỏ chức vụ'})[post],run:()=>memberAction('appoint',post)});
      actions.push({id:'guild-member-profile',label:'Xem hồ sơ',run:()=>{this.confirmation=null;this.profileIdentity=String(member.accountId);this.fields.profileIdentity=this.profileIdentity;delete this.cache.profile;this.setSection('profile');}});
    }
    return renderGuildMemberOptions(this,value,member?{name:account.buddies?.[member.accountId]?.name||member.charUuid,actions:actions.map(a=>({...a,disabled:a.id!=='guild-member-profile'&&!this.canMutate()}))}:null);
  }
  renderGuildManage(body,account) {renderGuildManagement(this,body,account);}
  renderConfirmation() {
    if(['rank-guild-info','rank-team-info'].includes(this.confirmation?.kind))return renderPublicRankDetail(this,this.confirmation);
    if(this.confirmation?.kind==='guild-move')return renderGuildMove(this,this.confirmation);
    if(this.confirmation?.kind==='guild-team-info')return renderGuildTeamInfo(this,this.confirmation);
    if(this.confirmation?.kind==='guild-member')return this.renderGuildMemberOptions(this.confirmation);
    if(this.confirmation?.kind==='guild-invite')return renderGuildInvite(this,this.confirmation);
    if(['guild-create','team-create'].includes(this.confirmation?.kind))return renderGuildCreate(this,this.confirmation);
    if(this.confirmation?.kind==='shop')return renderNativeShopConfirmation(this,this.confirmation);
    if(this.confirmation?.kind==='normal-shop')return renderNormalShopConfirmation(this,this.confirmation);
    if(this.confirmation?.kind==='donation')return renderGuildDonation(this,this.confirmation);
    const value=this.confirmation,epoch=this.epoch,generation=this.client.generation,identity=this.identity;
    const current=()=>!this.disposed&&this.confirmation===value&&value.epoch===this.epoch&&epoch===this.epoch&&generation===this.client.generation&&identity===this.identity;
    const cancel=()=>{if(current()&&!this.pending){this.confirmation=null;this.render();}};
    const buttons={cancel:this.button('Hủy',cancel,{testId:'account-confirm-cancel'}),
      confirm:this.button(value.button,()=>{if(current())this.perform(value.task,value.success);},{disabled:!this.canMutate(),testId:'account-confirm'})};
    const ask=createCommonAsk({assets:this.assets,message:[value.title,value.detail].filter(Boolean).join('\n'),...buttons,label:value.title,onCancel:cancel});
    const overlay=element('div',null,'m8-account-modal');overlay.append(ask.root);overlay.initialFocus=ask.initialFocus;return overlay;
  }
  dispose(){this.economyDialog?.dispose();this.disposed=true;this.epoch++;this.confirmation=null;this.loading.clear();this.profileCompanionTooltip?.dispose();this.profileCompanionTooltip=null;this.host.replaceChildren();}
}
