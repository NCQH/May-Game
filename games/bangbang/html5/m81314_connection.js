import {M8Connection} from './m8_connection.js';
import {encodeCreateRoom,encodeRoomOp} from './room_protocol.js';
import {encodeEquipCompanion,encodeFeedCompanion,encodeStrengthenCompanion,
  encodeRankCompanion,encodeTransferCompanion,encodeEnterPve,encodePveRecord,encodeBuyThew,isPveRequestMap,pveNormalMapId} from './m81314_protocol.js';
import {createCompanionState,createPveState,applyCompanionPacket,applyPvePacket,pveRoomDifficulty} from './m81314_state.js';

export class M81314Connection extends M8Connection{
  emptyState(){return {...super.emptyState(),companions:createCompanionState(),pve:createPveState()};}
  withOutside(snapshot){return {...super.withOutside(snapshot),
    companions:this.cachedView('companions',this.state.companions,structuredClone),
    pve:this.cachedView('pve',this.state.pve,structuredClone)};}
  receive(packet,role,generation){
    if(generation!==this.generation)return;
    if(role==='GATE'){
      this.state.companions=applyCompanionPacket(this.state.companions,packet);
      this.state.pve=applyPvePacket(this.state.pve,packet,{isPve:this.state.play.scene?.roomType===4});
    }
    super.receive(packet,role,generation);
    if(role==='GATE'&&this.state.pve.staminaPurchaseUncertain){
      const pending=this.staminaOutcome;
      const synchronized=packet.type==='characterData'&&packet.accountId===this.state.accountId;
      const accepted=pending?.generation===generation&&pending.accountId===this.state.accountId
        &&packet.type==='pveThew'&&this.staminaAccepted(packet,pending);
      if(synchronized||accepted){
        this.state.pve={...this.state.pve,revision:this.state.pve.revision+1,staminaPurchaseUncertain:false};
        this.staminaOutcome=null;this.update();
      }
    }
  }
  ownedItem(uuid,container){
    // UI selection is a persistent UUID. Translate only from the latest native
    // inventory immediately before sending the legacy slot-based request.
    const item=this.state.meta.containers[String(container)]?.items.find(row=>row.uuid===uuid);
    if(!item||item.count<=0)throw new Error('Vật phẩm đã đổi vị trí hoặc không còn trong túi.');
    return item;
  }
  equipCompanion(uuid){
    this.ownedItem(uuid,5);
    const expected=this.state.companions.activeUuid===uuid?'':uuid;
    return this.metaAction('companionEquip',encodeEquipCompanion(uuid),
      p=>p.type==='companionActive'&&p.uuid===expected,'trang bị/tháo trợ thủ');
  }
  companionOperation(uuid,frame,action){
    return this.metaAction('companionUpgrade',frame,
      p=>p.type==='companionOperation'&&p.uuid===uuid&&p.action===action,'kết quả nuôi trợ thủ');
  }
  feedCompanion(uuid,chipUuid){
    return this.companionOperation(uuid,encodeFeedCompanion(this.ownedItem(uuid,5).slotNo,
      this.ownedItem(chipUuid,3).slotNo),31);
  }
  strengthenCompanion(uuid){return this.companionOperation(uuid,
    encodeStrengthenCompanion(this.ownedItem(uuid,5).slotNo),32);}
  rankCompanion(uuid,materialUuids=[]){
    if(!Array.isArray(materialUuids)||materialUuids.length>3)throw new Error('Chỉ chọn tối đa ba liều tăng tỷ lệ.');
    const counts=new Map();
    for(const id of materialUuids)counts.set(id,(counts.get(id)||0)+1);
    for(const [id,count] of counts)if(this.ownedItem(id,3).count<count)throw new Error('Không đủ liều đã chọn.');
    return this.companionOperation(uuid,encodeRankCompanion(this.ownedItem(uuid,5).slotNo,
      materialUuids.map(id=>this.ownedItem(id,3).slotNo)),33);
  }
  transferCompanion(uuid,otherUuid){return this.companionOperation(uuid,
    encodeTransferCompanion(this.ownedItem(uuid,5).slotNo,this.ownedItem(otherUuid,5).slotNo),34);}
  async pveRequest(gate,frame,accept,label){
    const requestId=frame[2]|frame[3]<<8;
    const packet=await this.request(gate,frame,p=>accept(p)||p.type==='systemError'&&p.requestId===requestId,label);
    if(packet.type==='systemError'){
      const error=new Error(packet.params?.join('\n')||'Máy chủ từ chối yêu cầu.');
      error.serverRejected=true;error.requestId=requestId;throw error;
    }
    return packet;
  }
  staminaAccepted(packet,expected){
    const current=this.state.meta.character;
    return current?.accountId===expected.accountId&&packet.thew===expected.thew+100
      &&packet.thewBuy===expected.thewBuy+1&&current.currency?.cash===expected.cash-1;
  }
  buyPveStamina(){
    return this.action('pveStaminaBuy',['lobby','room'],async(gate,generation)=>{
      const character=this.state.meta.character,accountId=this.state.accountId;
      if(this.state.pve.staminaPurchaseUncertain)
        throw new Error('Chưa rõ kết quả mua thể lực trước. Chờ đồng bộ hoặc kết nối lại; không gửi lại yêu cầu.');
      if(!character||character.accountId!==accountId||![character.thew,character.thewBuy,character.currency?.cash]
          .every(value=>Number.isSafeInteger(value)&&value>=0))
        throw new Error('Thể lực và Xu vàng chưa được máy chủ đồng bộ.');
      if(character.currency.cash<1)throw new Error('Cần 1 Xu vàng để mua 100 thể lực.');
      if(character.thew>32667||character.thewBuy>=32767)throw new Error('Thể lực đã gần giới hạn native 32.767.');
      const expected={generation,accountId,thew:character.thew,thewBuy:character.thewBuy,cash:character.currency.cash};
      this.staminaOutcome=expected;
      try{
        const packet=await this.pveRequest(gate,encodeBuyThew(),p=>p.type==='pveThew'
          &&this.staminaAccepted(p,expected),'mua 100 thể lực với 1 Xu vàng');
        if(generation===this.generation)this.staminaOutcome=null;
        return packet;
      }catch(error){
        if(generation===this.generation&&this.state.accountId===accountId){
          if(error.serverRejected&&error.requestId===78)this.staminaOutcome=null;
          else{
            this.state.pve={...this.state.pve,revision:this.state.pve.revision+1,staminaPurchaseUncertain:true};
            throw new Error('Chưa rõ kết quả mua thể lực: chưa nhận đủ xác nhận máy chủ. Không tự gửi lại; hãy chờ đồng bộ hoặc kết nối lại.');
          }
        }
        throw error;
      }
    });
  }
  enterPve(mapId,{waitingRoom=false}={}){
    if(!isPveRequestMap(mapId)||!Number.isInteger(mapId))throw new Error('Màn PvE chưa được hỗ trợ.');
    const normalMapId=pveNormalMapId(mapId),difficulty=mapId===normalMapId?0:1;
    return this.action('pveEnter',['lobby'],gate=>this.pveRequest(gate,
      waitingRoom?encodeCreateRoom({roomType:4,mode:1,mapId,name:'PvE đơn'}):encodeEnterPve(mapId),
      p=>waitingRoom?p.type==='roomEntered'&&p.roomType===4&&p.config.mapId===normalMapId
          &&pveRoomDifficulty(p)===difficulty
        :p.type==='battleStart'&&p.roomType===4&&p.mapId===normalMapId,'vào màn PvE'));
  }
  changePveRoom(mapId){
    if(!isPveRequestMap(mapId)||!Number.isInteger(mapId))throw new Error('Màn PvE chưa được hỗ trợ.');
    if(this.state.play.room?.roomType!==4)throw new Error('Chỉ đổi màn trong phòng chờ PvE đơn.');
    const normalMapId=pveNormalMapId(mapId),difficulty=mapId===normalMapId?0:1;
    // C603 is explicitly refused for solo PvE by the native server. Its C600
    // branch already validates the source alias, balance profile and city flags
    // before atomically replacing a waiting room. It preserves the equipped
    // tank/companion and never starts a battle. Do not leave the current room
    // first, invent a difficulty flag, or treat a successful send as an ACK.
    return this.action('pveRoomChange',['room'],gate=>this.pveRequest(gate,
      encodeCreateRoom({roomType:4,mode:1,mapId,name:'PvE đơn'}),
      p=>p.type==='roomEntered'&&p.roomType===4&&p.config?.mapId===normalMapId
        &&pveRoomDifficulty(p)===difficulty,'đổi màn / độ khó PvE'));
  }
  startPveRoom(){
    if(this.state.play.room?.roomType!==4)throw new Error('Không ở phòng PvE đơn.');
    return this.action('pveStart',['room'],gate=>this.pveRequest(gate,encodeRoomOp(24,0),
      p=>p.type==='battleStart'&&p.roomType===4,'bắt đầu PvE'));
  }
  startMatch(){return this.state.play.room?.roomType===4?this.startPveRoom():super.startMatch();}
  requestPveRecord(mapId){return this.metaAction('pveRecord',encodePveRecord(mapId),
    p=>p.type==='pveRecord'&&p.mapId===mapId,'đọc kỷ lục PvE');}
}
