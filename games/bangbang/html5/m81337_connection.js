import {M81332Connection} from './m81332_economy_connection.js';
import {ROOMS_REQUEST,encodeRoomsRequest,createRoomsState,applyRoomsReply,roomSeat,isManagedWaitingRoom} from './m81337_rooms_protocol.js';

const allPhases=['lobby','room','selecting','loading','scene'];
const actionsPhases=action=>['status','subscribe','list'].includes(action)?allPhases
  :['join','accept','rank_queue','rank_cancel'].includes(action)?['lobby']
    :action==='decline'?['lobby','room']:['room'];

/** Shared-room metadata and commands. Only native packets move play.phase. */
export class M81337Connection extends M81332Connection{
  emptyState(){return {...super.emptyState(),multiplayer:createRoomsState()};}
  withOutside(snapshot){return {...super.withOutside(snapshot),multiplayer:this.cachedView('multiplayer',this.state.multiplayer,structuredClone)};}
  async connect(credentials=null,automatic=false){
    const expected=this.generation+1,ok=await super.connect(credentials,automatic);
    if(ok&&this.generation===expected&&this.state.phase==='ready'){
      try{
        await this.roomCommand('status');
        if(this.generation===expected&&this.state.phase==='ready'&&this.state.play.phase==='lobby')await this.refreshHall();
      }
      catch(error){if(this.generation===expected){this.state.play.error=error.message;this.update();}}
    }
    return ok;
  }
  receive(packet,role,generation){
    if(generation!==this.generation)return;
    if(role==='GATE'&&packet.type==='multiplayerRooms'){
      const value=packet.rooms,pending=this.roomRequests?.get(value.request_id);
      if(value.action==='changed'||pending?.generation===generation
          &&pending.accountId===this.state.accountId&&pending.action===value.action)
        this.state.multiplayer=applyRoomsReply(this.state.multiplayer,value);
    }
    if(role==='GATE'){
      const old=this.state.multiplayer,mine=this.state.accountId;
      if(packet.type==='backToMain'||packet.type==='roomOp'
          &&([1,20].includes(packet.op)&&packet.target===mine||packet.op===1&&packet.startAccountId===mine))
        this.state.multiplayer={...old,revision:old.revision+1,room:null,queue:{active:false,status:'idle',wait_remaining_ms:0}};
      else if(['prebattle','battleStart'].includes(packet.type))
        this.state.multiplayer={...old,revision:old.revision+1,room:old.room?{...old.room,phase:packet.type==='prebattle'?'selecting':'battle'}:null,
          queue:{active:false,status:'idle',wait_remaining_ms:0}};
    }
    super.receive(packet,role,generation);
  }
  async roomRequest(gate,generation,action,values={}){
    const request_id=globalThis.crypto.randomUUID(),accountId=this.state.accountId,after=gate.sequence;
    const frame=encodeRoomsRequest(action,request_id,values);
    this.roomRequests??=new Map();this.roomRequests.set(request_id,{generation,accountId,action});
    try{
      const packet=await this.request(gate,frame,p=>p.type==='multiplayerRooms'&&p.rooms.request_id===request_id&&p.rooms.action===action
        ||p.type==='systemError'&&p.requestId===ROOMS_REQUEST,'xác nhận phòng chơi',15000);
      if(generation!==this.generation||accountId!==this.state.accountId)return null;
      if(packet.type==='systemError')throw new Error(packet.params?.join('\n')||'Máy chủ từ chối thao tác phòng.');
      if(!packet.rooms.ok){const error=new Error(packet.rooms.error.message);error.code=packet.rooms.error.code;throw error;}
      if(['join','accept'].includes(action)&&packet.rooms.room){
        const roomId=packet.rooms.room.room_id;
        await gate.until(history=>history.find(p=>p.sequence>after&&p.type==='roomEntered'&&p.roomId===roomId),
          'xác nhận vào phòng từ máy chủ');
      }
      if(action==='leave'&&this.state.play.phase==='room')
        await gate.until(history=>history.find(p=>p.sequence>after&&(p.type==='backToMain'
          ||p.type==='roomOp'&&p.op===1&&(p.startAccountId===accountId||p.target===accountId))),
        'xác nhận rời phòng từ máy chủ');
      return packet.rooms;
    }finally{this.roomRequests.delete(request_id);}
  }
  roomCommand(action,values={}){
    return this.action('rooms-'+action,actionsPhases(action),(gate,generation)=>this.roomRequest(gate,generation,action,values));
  }
  async ensureRoomSupport(){if(!this.state.multiplayer.received)await this.roomCommand('status');}
  requireNoRankQueue(){if(this.state.multiplayer.queue.active)throw new Error('Hủy tìm trận rank trước khi vào phòng thường.');}
  async createRoom(){this.requireNoRankQueue();await this.ensureRoomSupport();return super.createRoom();}
  async quickJoinRoom(){this.requireNoRankQueue();await this.ensureRoomSupport();return super.quickJoinRoom();}
  async joinRoom(roomId){this.requireNoRankQueue();await this.ensureRoomSupport();return super.joinRoom(roomId);}
  async joinRoomCode(code,camp){this.requireNoRankQueue();await this.ensureRoomSupport();return this.roomCommand('join',{code,...(camp==null?{}:{camp})});}
  setReady(ready){return isManagedWaitingRoom(this.state.multiplayer,this.state.play)?this.roomCommand('ready',{ready:!!ready}):super.setReady(ready);}
  async leaveRoom(){
    if(!isManagedWaitingRoom(this.state.multiplayer,this.state.play))return super.leaveRoom();
    const generation=this.generation;await this.roomCommand('leave');
    if(generation===this.generation&&this.state.phase==='ready'&&this.state.play.phase==='lobby')await this.refreshHall();
  }
  changeRoomCamp(){
    if(!isManagedWaitingRoom(this.state.multiplayer,this.state.play))return super.changeRoomCamp();
    const self=roomSeat(this.state.multiplayer,this.state.accountId);
    if(!self)throw new Error('Không tìm thấy chỗ của bạn trong phòng.');
    return this.moveRoomPlayer(self.account_id,3-self.camp);
  }
  currentManagedRoom(){
    if(!isManagedWaitingRoom(this.state.multiplayer,this.state.play))throw new Error('Phòng không còn ở bước chờ.');
    return this.state.multiplayer.room;
  }
  moveRoomPlayer(account_id,camp){const room=this.currentManagedRoom();return this.roomCommand('team',{account_id,camp,revision:room.revision});}
  removeRoomSeat(slot,expectedAccountId){
    const room=this.currentManagedRoom(),seat=room.seats.find(row=>row.slot===slot);
    if(!seat||seat.kind==='empty'||seat.account_id!==expectedAccountId)throw new Error('Vị trí đã thay đổi; hãy chọn lại.');
    return this.roomCommand(seat.kind==='bot'?'remove_bot':'kick',{slot,expected_account_id:expectedAccountId,revision:room.revision});
  }
  addRoomBot(camp){
    const room=this.currentManagedRoom(),setup=this.state.play.setup;
    return this.roomCommand('add_bot',{camp,level:Number(setup?.enemies?.[0]||setup?.allies?.[0]||5),revision:room.revision});
  }
  setRoomBotAI(camp,bot_ai){const room=this.currentManagedRoom();return this.roomCommand('bot_policy',{camp,bot_ai,revision:room.revision});}
  inviteRoomPlayer(account_id,camp){this.currentManagedRoom();return this.roomCommand('invite',{account_id,camp});}
  acceptRoomInvitation(invite_id){this.requireNoRankQueue();return this.roomCommand('accept',{invite_id});}
  declineRoomInvitation(invite_id){return this.roomCommand('decline',{invite_id});}
  async startRanked(){await this.ensureRoomSupport();return this.roomCommand('rank_queue');}
  cancelRanked(){return this.roomCommand('rank_cancel');}
}
