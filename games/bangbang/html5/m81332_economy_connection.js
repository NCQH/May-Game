import {M81330Connection} from './m81330_connection.js';
import {ECONOMY_REQUEST,encodeEconomyRequest,canonicalEconomyIntent,economyReference,economyIntentHash} from './m81332_economy_protocol.js';
const pendingKey=id=>'bangbang.economy.pending.v1.'+id;
const clone=value=>structuredClone(value);
export class M81332Connection extends M81330Connection{
  emptyState(){return {...super.emptyState(),economy:{revision:0,pending:null,last:null}};}
  withOutside(snapshot){return {...super.withOutside(snapshot),economy:this.cachedView('economy',this.state.economy,clone)};}
  economyState(values){this.state.economy={...this.state.economy,...values,revision:this.state.economy.revision+1};this.update();}
  async connect(credentials=null,automatic=false){
    const expected=this.generation+1,ok=await super.connect(credentials,automatic);
    if(ok&&this.generation===expected&&this.state.phase==='ready')this.restoreEconomyPending();
    return ok;
  }
  restoreEconomyPending(){
    const accountId=this.state.accountId;
    try{
      const raw=globalThis.localStorage.getItem(pendingKey(accountId));
      if(!raw){this.economyState({pending:null});return null;}
      const value=JSON.parse(raw);
      if(value?.v!==1||value.accountId!==accountId||typeof value.operationId!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(value.operationId))throw new Error('record');
      value.intent=canonicalEconomyIntent(value.intent);
      this.economyState({pending:value});return value;
    }catch{
      const value={accountId,invalid:true};this.economyState({pending:value});return value;
    }
  }
  saveEconomyPending(value){
    const raw=JSON.stringify(value);
    let previous;
    try{previous=globalThis.localStorage.getItem(pendingKey(value.accountId));}
    catch{throw new Error('Không đọc được mã đối soát trên trình duyệt. Chưa gửi thao tác.');}
    if(previous!==null){this.restoreEconomyPending();throw new Error('Đã xuất hiện giao dịch chờ khác; kiểm tra kết quả trước. Chưa gửi thao tác mới.');}
    try{
      globalThis.localStorage.setItem(pendingKey(value.accountId),raw);
      if(globalThis.localStorage.getItem(pendingKey(value.accountId))!==raw)throw new Error('readback');
    }catch{throw new Error('Không lưu được mã đối soát trên trình duyệt. Chưa gửi thao tác; cho phép lưu dữ liệu trang rồi thử lại.');}
    this.economyState({pending:clone(value)});
  }
  clearEconomyPending(operationId){
    const value=this.state.economy.pending;
    if(!value||value.operationId!==operationId||value.accountId!==this.state.accountId)return false;
    try{
      const raw=globalThis.localStorage.getItem(pendingKey(value.accountId));
      if(raw!==null){const persisted=JSON.parse(raw);
        if(persisted.v!==1||persisted.accountId!==value.accountId||persisted.operationId!==operationId)return false;
        globalThis.localStorage.removeItem(pendingKey(value.accountId));}
      if(globalThis.localStorage.getItem(pendingKey(value.accountId))!==null)throw new Error('readback');
    }catch{return false;}
    this.economyState({pending:null});return true;
  }
  requireNoEconomyPending(){
    const value=this.restoreEconomyPending();
    if(value)throw new Error(value.invalid?'Bản ghi đối soát cục bộ chưa đọc được. Không gửi thao tác mới để tránh tiêu trùng.'
      :'Có thao tác kho chưa rõ kết quả. Bấm “Kiểm tra kết quả” trước; không gửi lại việc bán/tách/nâng.');
  }
  async economyRequest(gate,generation,action,operationId,values={}){
    const accountId=this.state.accountId,requestId=crypto.randomUUID(),after=gate.sequence;
    const packet=await this.request(gate,encodeEconomyRequest(action,requestId,operationId,values),p=>p.type==='economy'
      &&p.economy.request_id===requestId&&p.economy.operation_id===operationId&&p.economy.action===action
      ||p.type==='systemError'&&p.requestId===ECONOMY_REQUEST,'xác nhận giao dịch kho',15000);
    if(generation!==this.generation||accountId!==this.state.accountId)throw new Error('Phiên nhân vật đã thay đổi; cần kiểm tra lại kết quả.');
    if(packet.type==='systemError')throw new Error(packet.params?.join('\n')||'Máy chủ từ chối giao dịch kho.');
    const reply=packet.economy;
    if(reply.profile_id!==accountId)throw new Error('Phản hồi kho không khớp tài khoản hiện tại.');
    if(!reply.ok){const error=new Error(reply.error.message);error.code=reply.error.code;error.details=reply.error.details;
      error.serverRejected=true;error.notCommitted=reply.error.not_committed;throw error;}
    return {reply,after,through:packet.sequence};
  }
  prepareEconomy(intent){
    intent=canonicalEconomyIntent(intent);
    return this.action('economyPreview',['lobby','room'],async(gate,generation)=>{
      this.requireNoEconomyPending();const accountId=this.state.accountId,operationId=crypto.randomUUID();
      const {reply}=await this.economyRequest(gate,generation,'preview',operationId,{intent});
      if(reply.status!=='preview')throw new Error('Máy chủ chưa trả xem trước hợp lệ.');
      return {accountId,generation,operationId,intent,quote:clone(reply.quote),proof:clone(reply.proof)};
    });
  }
  applyEconomy(preview){
    return this.action('economyApply',['lobby','room'],async(gate,generation)=>{
      this.requireNoEconomyPending();
      if(!preview||preview.accountId!==this.state.accountId||preview.generation!==generation)throw new Error('Phiên xem trước đã đổi; hãy xem trước lại.');
      const intent=canonicalEconomyIntent(preview.intent),intentHash=await economyIntentHash(intent),accountId=this.state.accountId;
      if(generation!==this.generation||preview.accountId!==accountId)throw new Error('Phiên nhân vật đã thay đổi.');
      const pending={v:1,accountId,operationId:preview.operationId,intent};
      // Persist the operation id BEFORE sending; never persist credentials or
      // automatically resend a mutation after reconnect/timeouts/refresh.
      this.saveEconomyPending(pending);
      try{
        const {reply,after,through}=await this.economyRequest(gate,generation,'apply',preview.operationId,{intent,proof:preview.proof});
        if(reply.status!=='committed'||reply.receipt.intent_hash!==intentHash)throw new Error('Biên nhận không khớp thao tác đã xác nhận.');
        this.economyState({last:clone(reply.receipt)});this.clearEconomyPending(preview.operationId);
        const q=reply.receipt.quote;
        const native=q.kind==='feed'&&!reply.duplicate?gate.history.find(p=>p.sequence>after&&p.sequence<through&&p.type==='companionOperation'
          &&p.action===31&&p.uuid===q.helper_uuid&&p.previousValue===q.previous_level&&p.currentValue===q.current_level&&p.success===1&&p.code===0):null;
        return {reply,native};
      }catch(error){
        if(generation===this.generation&&accountId===this.state.accountId&&error.serverRejected&&error.notCommitted)
          this.clearEconomyPending(preview.operationId);
        else if(generation===this.generation&&accountId===this.state.accountId)
          error.message='Chưa rõ kết quả giao dịch. Không gửi lại; bấm “Kiểm tra kết quả” để đối soát biên nhận. '+error.message;
        throw error;
      }
    });
  }
  reconcileEconomy(){
    return this.action('economyStatus',['lobby','room'],async(gate,generation)=>{
      const pending=this.restoreEconomyPending();
      if(!pending)return {status:'none'};
      if(pending.invalid)throw new Error('Không đọc được mã thao tác cần đối soát; giữ nguyên trạng thái, không gửi thao tác mới.');
      const expected=await economyIntentHash(pending.intent);
      const {reply}=await this.economyRequest(gate,generation,'status',pending.operationId);
      if(reply.status==='committed'&&reply.receipt.intent_hash!==expected)throw new Error('Biên nhận thuộc nội dung khác; dừng để kiểm tra, không gửi lại.');
      if(reply.status==='committed')this.economyState({last:clone(reply.receipt)});
      if(!this.clearEconomyPending(pending.operationId))throw new Error('Đã đối soát máy chủ nhưng chưa xóa được mã chờ cục bộ. Không gửi thao tác mới.');
      return reply;
    });
  }
  async levelCompanion(uuid,chipUuid,expected,discardExp=0){
    const helper=this.ownedItem(uuid,5),chip=chipUuid?this.ownedItem(chipUuid,3):null;
    const chips=chip?(this.state.meta.containers['3']?.items||[]).filter(row=>row.count>0&&row.templateId===chip.templateId
      &&row.lifeTime===0&&Number.isInteger(row.extFlag)&&(row.extFlag&~17)===0):[];
    const intent={kind:'feed',helper:economyReference(helper,5),chips:chips.map(row=>economyReference(row,3)),level:helper.level,exp:helper.exp};
    if(discardExp>0)intent.discard_exp=discardExp;
    const preview=await this.prepareEconomy(intent);if(!preview)throw new Error('Phiên trợ thủ đã đổi; kiểm tra lại trước khi tăng cấp.');
    const q=preview.quote;
    if(!expected||(q.discarded_exp||0)!==(expected.discardedExp||0)||(q.discarded_exp||0)!==discardExp||q.required_count!==expected.amount||q.current_exp!==expected.remainder||q.current_level!==expected.nextLevel
      ||q.previous_level!==helper.level||q.previous_exp!==helper.exp)throw new Error('Chi phí/tiến trình đã đổi so với màn xem trước. Chưa tiêu chip; kiểm tra lại rồi bấm tăng cấp.');
    const result=await this.applyEconomy(preview);
    return result.native?{...result.native,economyReceipt:result.reply.receipt}: {type:'economyReconciled',economyReceipt:result.reply.receipt};
  }
}
