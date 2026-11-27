import {guildMutationConfirmed} from './m81_guild_ack.js';
import {M4Connection} from './m4.js';
import {createMetaState,applyMetaPacket,snapshotMetaState} from './m8_meta_state.js';
import {createCrystalState,applyCrystalPacket,snapshotCrystalState} from './m8_crystal_state.js';
import {createAccountState,applyAccountPacket} from './m8_account_state.js';
import {createFlowPresentation,reduceFlowPacket,beginLocalLoad,updateLocalLoad} from './m8_flow_state.js';
import {encodePrimaryTank,encodeStrengthenTank,encodeAdvanceTank,encodeEquipSkin,encodeEquipHalo,encodeRenameCharacter,
  encodeUseCosmetic,encodePlayerSettingFlags,encodePlayerOptions} from './m8_meta_protocol.js';
import {encodePurchase,encodeGuildAction} from './m8_account_protocol.js';
import {encodeJoinRoom,encodeRoomOp,encodeStartMatch} from './room_protocol.js';
import {encodeCrystalAssign} from './m8_crystal_protocol.js';
import {isBattleMap as isPKMap,isBattleMode as isPKMode} from './m810_modes.js';
import {NormalShopTransactions,createNormalShopState} from './m81345_shop_transactions.js';

const outside = ['lobby','room'];
const tip = packet => packet.params?.join('\n') || `Server từ chối yêu cầu (${packet.errorId}).`;
function freezeView(value) {
  if(value&&typeof value==='object'&&!Object.isFrozen(value)) {
    for(const child of Object.values(value))freezeView(child);
    Object.freeze(value);
  }
  return value;
}

/** Adds native outside-battle views. M4 still owns scene preparation, native
 * combat state and the C605=100 -> C552 gate. Economy never updates optimistically.
 */
export class M8Connection extends M4Connection {
  constructor(onChange=()=>{},prepareScene=async()=>({supported:false})) {
    super(()=>{},prepareScene);
    this.safeViews=new Map();
    this.normalShopTransactions=new NormalShopTransactions(this);
    this.onChange=snapshot=>onChange(this.withOutside(snapshot));
    this.prepareSceneAssets=async(scene,accountId)=>{
      const generation=this.generation;
      const begun=beginLocalLoad(this.state.flow,{generation:this.generation,
        sceneId:scene.sceneId,mapId:scene.mapId});
      this.state.flow=begun.state;this.update();
      const token=begun.token;
      const progress=values=>{
        if(generation!==this.generation||scene!==this.state.play.scene)return;
        const next=updateLocalLoad(this.state.flow,token,values);
        if(next!==this.state.flow){this.state.flow=next;this.update();}
      };
      try {
        const prepared=await prepareScene(scene,accountId,progress);
        progress({stage:'waiting-server',completed:null,total:null});
        return prepared;
      } catch(error) {progress({stage:'error',error:error.message});throw error;}
    };
  }
  emptyState() {
    return {...super.emptyState(),meta:createMetaState(),crystals:createCrystalState(),
      account:createAccountState(),flow:createFlowPresentation(this.generation||0),normalShop:createNormalShopState()};
  }
  cachedView(key,value,copy) {
    const cached=this.safeViews?.get(key);
    if(cached?.source===value)return cached.value;
    const result=freezeView(copy(value));this.safeViews?.set(key,{source:value,value:result});return result;
  }
  withOutside(snapshot) {
    const s=this.state;
    const meta=this.cachedView('meta',s.meta,snapshotMetaState);
    return {...snapshot,tanks:meta.tanks,meta,
      crystals:this.cachedView('crystals',s.crystals,snapshotCrystalState),
      account:this.cachedView('account',s.account,structuredClone),
      normalShop:this.cachedView('normalShop',s.normalShop,structuredClone),
      flow:this.cachedView('flow',s.flow,structuredClone)};
  }
  snapshot() {return this.withOutside(super.snapshot());}
  async connect(credentials=null,automatic=false){
    const expected=this.generation+1,ok=await super.connect(credentials,automatic);
    if(ok&&this.generation===expected&&this.state.phase==='ready')this.restoreShopPending();
    return ok;
  }
  restoreShopPending(){return this.normalShopTransactions.restore();}
  prepareShop(intent){return this.normalShopTransactions.prepare(intent);}
  applyShop(preview){return this.normalShopTransactions.apply(preview);}
  reconcileShop(){return this.normalShopTransactions.reconcile();}
  receive(packet,role,generation) {
    if(generation!==this.generation)return;
    if(role==='GATE') {
      this.state.meta=applyMetaPacket(this.state.meta,packet);
      this.state.crystals=applyCrystalPacket(this.state.crystals,packet);
      this.state.account=applyAccountPacket(this.state.account,packet,{charUuid:this.state.charUuid});
    }
    super.receive(packet,role,generation);
    // The inherited battle selection API reads state.tanks, including S1151.
    if(role==='GATE'&&['garage','tankInstanceUpdated'].includes(packet.type))
      this.state.tanks=this.state.meta.tanks;
  }
  receivePlay(packet,generation) {
    const oldScene=this.state.play.scene;
    this.state.flow=reduceFlowPacket(this.state.flow,packet,{generation,
      accountId:this.state.accountId,deadlineAt:packet.type==='prebattle'
        ?Date.now()+packet.remainingSeconds*1000:undefined,
      sceneAccepted:!(packet.type==='battleStart'&&oldScene?.sceneId===packet.sceneId
        &&oldScene.mapId===packet.mapId&&['loading','scene'].includes(this.state.play.phase))});
    super.receivePlay(packet,generation);
    if(packet.type==='roomOp'&&packet.op===4&&this.state.play.room&&!this.state.play.scene)
      this.state.play.room.characters=this.state.flow.roster.map(row=>({...row}));
    if(this.state.play.phase==='scene'&&this.state.flow.localLoad?.stage==='waiting-server')
      this.state.flow=updateLocalLoad(this.state.flow,this.state.flow.localLoad.token,{stage:'ready'});
  }
  quickJoinRoom() {
    // PvpHallView.onQuickJoinClick / RoomTool.reqJoinRoom: freely=1,
    // random mode=0, room/map/password/contest=0. The existing native server
    // applies this profile's saved Robo setup; it does not match human users.
    return this.action('join',['lobby'],gate=>{
      if(!isPKMode(this.state.play.setup?.mode))throw new Error('Chọn bản đồ và lưu thiết lập trước khi gia nhập nhanh.');
      return this.request(gate,encodeJoinRoom({roomId:0,roomType:1,mode:0,mapId:0}),
        p=>p.type==='roomEntered','xác nhận gia nhập nhanh');
    });
  }
  startRanked() {
    return this.action('ranked',['lobby'],gate=>this.request(gate,encodeStartMatch(9),
      p=>p.type==='prebattle'&&p.roomType===9,'chọn tank đấu rank'));
  }
  renameCharacter(value) {
    const name=String(value).normalize('NFC').trim();
    return this.metaAction('rename',encodeRenameCharacter(name),
      p=>p.type==='characterData'&&p.name===name,'đổi tên nhân vật');
  }
  changeRoomCamp() {
    return this.action('camp',['room'],gate=>{
      const roster=this.state.flow.roster.map(c=>({accountId:c.accountId,camp:c.camp}));
      const self=roster.find(c=>c.accountId===this.state.accountId);
      if(!isPKMap(this.state.flow.mapId)||!self||![1,2].includes(self.camp))
        throw new Error('Chỉ đổi phe trong phòng đang chờ.');
      const after=gate.sequence;
      gate.send(encodeRoomOp(4,this.state.accountId));
      // Native Robo swaps the entire roster and emits one S1701 per member.
      // Keep the action locked until all native replies arrive, including bots.
      return gate.until(history=>{
        const replies=history.filter(p=>p.sequence>after&&p.type==='roomOp'&&p.op===4&&p.startAccountId===p.target);
        return roster.every(c=>replies.some(p=>p.startAccountId===c.accountId))
          ?replies.find(p=>p.startAccountId===this.state.accountId):null;
      },'xác nhận đổi phe cả đội');
    });
  }
  metaAction(label,frame,accept,description=label) {
    const requestId=frame[2]|frame[3]<<8;
    // Native preferences may be edited during play. Economy, Garage and
    // other outside actions keep their original phase restrictions.
    const phases=label==='settings'&&[79,88].includes(requestId)?[...outside,'scene']:outside;
    return this.action(label,phases,async(gate)=>{
      const after=gate.sequence;
      gate.send(frame);
      const informational=p=>p.type==='systemError'&&p.params?.length===1&&(
        p.requestId===656&&p.params[0]==='Đã gửi đơn xin vào Guild.'
        ||p.requestId===250&&p.params[0]==='Đã mua vĩnh viễn. Vào Túi đồ để chọn sử dụng.');
      const packet=await gate.until(history=>history.find(p=>p.sequence>after&&(
        accept(p)||p.type==='systemError'&&p.requestId===requestId&&!informational(p)
        ||p.type==='tankOperationFailed'&&[203,204].includes(requestId))),description);
      if(packet.type==='tankOperationFailed')throw new Error('Server từ chối nâng tank. Kiểm tra nguyên liệu và cấp nâng hiện tại.');
      if(packet.type==='systemError'&&!accept(packet)) {
        // Native board failures finish with a resync and a result packet. Keep
        // the action lock until that tail is drained so a subsequent request
        // cannot consume the previous operation's uncorrelated acknowledgement.
        const tailType={424:'crystalSaveResult',425:'crystalNameResult'}[requestId];
        if(tailType)await gate.until(history=>history.find(p=>p.sequence>packet.sequence&&p.type===tailType),
          'đồng bộ bảng tinh thể sau khi từ chối');
        throw new Error(tip(packet));
      }
      return packet;
    });
  }
  setPrimaryTank(uuid) {
    return this.metaAction('primary',encodePrimaryTank(uuid),p=>p.type==='tankInstanceUpdated'
      &&p.op===8&&p.tank.uuid===uuid&&(p.tank.extFlag&2)!==0,'đặt tank chủ chiến');
  }
  strengthenTank(uuid) {
    return this.metaAction('strengthen',encodeStrengthenTank(uuid),p=>p.type==='tankInstanceUpdated'
      &&p.op===4&&p.tank.uuid===uuid,'cường hóa tank');
  }
  advanceTank(uuid) {
    return this.metaAction('advance',encodeAdvanceTank(uuid),p=>p.type==='tankInstanceUpdated'
      &&p.op===2&&p.tank.uuid===uuid,'nâng sao tank');
  }
  equipTankSkin(uuid,skinUuid='') {
    return this.metaAction('skin',encodeEquipSkin(uuid,skinUuid),p=>p.type==='tankInstanceUpdated'
      &&p.tank.uuid===uuid&&p.op===10,'đổi ngoại hình tank');
  }
  useCosmetic(containerType,slotNo) {
    return this.metaAction('cosmetic',encodeUseCosmetic(containerType,slotNo),p=>
      containerType===4?p.type==='avatarUpdated':p.type==='characterFieldUpdated'&&p.fieldType===1,'đổi trang phục nhân vật');
  }
  purchaseCosmetic(goods) {
    return this.metaAction('purchase',encodePurchase(goods),p=>p.type==='container'
      &&p.items.some(item=>item.templateId===goods.itemId),'mua vật phẩm');
  }
  equipHalo(uuid, haloId) {
    return this.metaAction('halo',encodeEquipHalo(uuid,haloId),p=>p.type==='tankHaloResult'
      &&p.success===1&&p.tankUuid===uuid&&p.haloId===haloId,'đổi vòng sáng');
  }
  saveSettingFlags(flags) {
    return this.metaAction('settings',encodePlayerSettingFlags(flags),p=>p.type==='settingFlagsUpdated'
      &&p.settingFlag===flags,'lưu thiết lập');
  }
  savePlayerOptions(changes) {
    // Full native options stay private. Only the known UI keys may be replaced.
    const next={...this.state.meta.settings.options};
    for(const key of ['keyBoardSet','skillSlot'])if(Object.hasOwn(changes,key))next[key]=changes[key];
    return this.metaAction('settings',encodePlayerOptions(next),p=>p.type==='playerOptionsUpdated','lưu phím tắt');
  }
  guildAction(operation,values={}) {
    const before=structuredClone(this.state.account);
    return this.metaAction('guild',encodeGuildAction(operation,values),p=>
      p.type==='limits'&&[2,12,220].every(id=>p.limits.some(row=>row.limitId===id))
      &&guildMutationConfirmed(operation,values,before,this.state.account,this.state.charUuid), 'cập nhật Guild');
  }
  setSelectionCrystal(boardId,tankUuid) {
    return this.action('selectionCrystal',['selecting'],async gate=>{
      const selected=this.state.meta.tanks.find(t=>t.containerType===0&&t.tankId===this.state.play.selection?.selectedTankId);
      if(!selected||selected.uuid!==tankUuid)throw new Error('Tank đang chọn đã thay đổi.');
      if(!this.state.crystals.boards[boardId])throw new Error('Bảng tinh thể không còn tồn tại.');
      const after=gate.sequence;gate.send(encodeCrystalAssign(boardId,tankUuid));
      const packet=await gate.until(history=>history.find(p=>p.sequence>after&&(
        p.type==='tankInstanceUpdated'&&p.op===19&&p.tank.uuid===tankUuid&&p.tank.crystalSchemeId===boardId
        ||p.type==='systemError'&&p.requestId===427||p.type==='battleStart'||p.type==='backToMain')),'đổi bảng tinh thể cho tank đang chọn');
      if(packet.type==='systemError')throw new Error(tip(packet));
      if(packet.type!=='tankInstanceUpdated')return null;
      return packet;
    });
  }
  setSelectionGuildSkill(skillId,level) {
    return this.action('selectionGuild',['selecting'],async gate=>{
      const account=this.state.account;
      if(!account.guild||!(account.slotFlags&2))throw new Error('Cần mở ô kỹ năng chủ động trong Guild trước.');
      if(!Number.isInteger(skillId)||skillId<=0||!Number.isInteger(level)||level<=0||
         level>(account.learned[skillId]||0)||!(account.research[skillId]>0))throw new Error('Kỹ năng Guild chưa được học hoặc nghiên cứu đủ cấp.');
      const values={slotId:1,skillId,level},before=structuredClone(account),after=gate.sequence;
      gate.send(encodeGuildAction('equipSkill',values));
      const packet=await gate.until(history=>{
        const slots=history.find(p=>p.sequence>after&&p.type==='guildSlots'&&p.slots.some(row=>
          row.slotId===1&&row.skillId===skillId&&row.level===Math.min(level,this.state.account.research[skillId]||0)));
        return history.find(p=>p.sequence>after&&(
          p.type==='limits'&&slots&&p.sequence>slots.sequence&&[2,12,220].every(id=>p.limits.some(row=>row.limitId===id))&&
            guildMutationConfirmed('equipSkill',values,before,this.state.account,this.state.charUuid)
          ||p.type==='systemError'&&p.requestId===322||p.type==='battleStart'||p.type==='backToMain'));
      },'đổi kỹ năng Guild trước trận');
      if(packet.type==='systemError')throw new Error(tip(packet));
      if(packet.type!=='limits')return null;
      return packet;
    });
  }
  guildPurchase(item,{coinType=2,count=1}={}) {
    const price=coinType===1?item.cashPrice:item.silverPrice;
    const field=coinType===1?'cash':'golden',balance=this.state.meta.character.currency?.[field];
    if(price==null)throw new Error('Vật phẩm không bán bằng loại tiền này.');
    return this.metaAction('guildPurchase',encodePurchase({kind:item.kind,goodsId:item.goodsId,coinType,price,count}),p=>
      item.kind===8?p.type==='limits'&&[12,220].every(id=>p.limits.some(row=>row.limitId===id))
          &&this.state.meta.character.currency?.[field]===balance-price*count
        :p.type==='container'&&p.items.some(row=>row.templateId===item.itemId),'mua vật phẩm Guild');
  }
  async publicQuery(route,params={}) {
    const allowed=['capi/normalshopquery.php','goodsshopquery.php','observechar.php','crankquery.php','ccharrankquery.php','crankstatus.php',
      'cGuildJoinList.php','cGuildInfo.php','cTeamInfo.php','cTeamMember.php','cGuildList.php','cTeamServerList.php'];
    if(!allowed.includes(route))throw new Error('Danh mục chưa được hỗ trợ.');
    const generation=this.generation;
    const response=await fetch('/'+route+'?'+new URLSearchParams(params),{credentials:'same-origin',cache:'no-store'});
    if(!response.ok)throw new Error(`Không đọc được dữ liệu (${response.status}).`);
    const body=await response.text();
    if(generation!==this.generation)throw new Error('Phiên đã thay đổi. Vui lòng mở lại màn này.');
    if(!body.trim())return null; // Native missing Guild/team lookups return an empty JSON response.
    if(body.trim().startsWith('<')) {
      const xml=new DOMParser().parseFromString(body,'application/xml');
      if(xml.querySelector('parsererror'))throw new Error('Dữ liệu danh mục không hợp lệ.');
      return {amount:Number(xml.documentElement.getAttribute('amount')||xml.querySelector('amount')?.textContent||0),
        rows:[...xml.querySelectorAll('row')].map(row=>Object.fromEntries([...row.children].map(c=>[c.tagName,c.textContent])))};
    }
    return JSON.parse(body);
  }
}
