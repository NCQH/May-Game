import {SHOP_REQUEST,encodeShopRequest,canonicalShopIntent,shopIntentHash,shopQuoteMatchesIntent,validShopProof} from './m81345_shop_protocol.js';

const pendingKey=id=>'bangbang.shop.pending.v1.'+id;
const clone=value=>structuredClone(value);
const operationId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export const createNormalShopState=()=>({revision:0,pending:null,last:null});

/** Durable account-local operation identity. Only apply mutates; restore/status
 * never replay a purchase, including after refresh, timeout or account switch. */
export class NormalShopTransactions{
  constructor(client){this.client=client;}
  state(values){
    const c=this.client,previous=c.state.normalShop||createNormalShopState();
    if(Object.entries(values).every(([key,value])=>JSON.stringify(previous[key])===JSON.stringify(value)))return;
    c.state.normalShop={...previous,...values,revision:previous.revision+1};c.update();
  }
  restore(){
    const accountId=this.client.state.accountId;
    if(!Number.isSafeInteger(accountId)||accountId<1)return null;
    try{
      const raw=globalThis.localStorage.getItem(pendingKey(accountId));
      if(raw===null){this.state({pending:null});return null;}
      const value=JSON.parse(raw);
      if(value?.v!==1||value.accountId!==accountId||!operationId(value.operationId)||!hash(value.intentHash))throw new Error('record');
      const pending={v:1,accountId,operationId:value.operationId,intent:canonicalShopIntent(value.intent),intentHash:value.intentHash};
      this.state({pending});return pending;
    }catch{
      const pending={accountId,invalid:true};this.state({pending});return pending;
    }
  }
  requireIdle(){
    const pending=this.restore();
    if(pending)throw new Error(pending.invalid?'Chưa đọc được mã đối soát cửa hàng trên trình duyệt. Giữ nguyên bản ghi để kiểm tra.'
      :'Có giao dịch cửa hàng chưa rõ kết quả. Bấm “Kiểm tra kết quả” trước khi thực hiện giao dịch mới.');
    if(this.client.state.economy?.pending)throw new Error('Hãy kiểm tra kết quả giao dịch kho đang chờ trước.');
  }
  save(pending){
    const key=pendingKey(pending.accountId),raw=JSON.stringify(pending);
    let previous;
    try{previous=globalThis.localStorage.getItem(key);}catch{throw new Error('Không đọc được mã đối soát. Chưa gửi giao dịch.');}
    if(previous!==null){this.restore();throw new Error('Đã có giao dịch chờ khác. Chưa gửi giao dịch mới.');}
    try{
      globalThis.localStorage.setItem(key,raw);
      if(globalThis.localStorage.getItem(key)!==raw)throw new Error('readback');
    }catch{this.restore();throw new Error('Không lưu được mã đối soát. Chưa gửi giao dịch; hãy cho phép trình duyệt lưu dữ liệu trang.');}
    this.state({pending:clone(pending)});
  }
  clear(expected){
    const c=this.client,pending=c.state.normalShop?.pending;
    if(!pending||pending.accountId!==c.state.accountId||pending.operationId!==expected.operationId||pending.intentHash!==expected.intentHash)return false;
    try{
      const key=pendingKey(pending.accountId),raw=globalThis.localStorage.getItem(key);
      if(raw!==null){const stored=JSON.parse(raw);
        if(stored.v!==1||stored.accountId!==pending.accountId||stored.operationId!==pending.operationId||stored.intentHash!==pending.intentHash)return false;
        globalThis.localStorage.removeItem(key);}
      if(globalThis.localStorage.getItem(key)!==null)throw new Error('readback');
    }catch{return false;}
    this.state({pending:null});return true;
  }
  async request(gate,generation,action,operation,values={}){
    const c=this.client,accountId=c.state.accountId,request=crypto.randomUUID();
    const packet=await c.request(gate,encodeShopRequest(action,request,operation,values),packet=>
      packet.type==='normalShop'&&packet.normalShop.request_id===request&&packet.normalShop.operation_id===operation
        &&packet.normalShop.action===action&&packet.normalShop.profile_id===accountId
      ||packet.type==='systemError'&&packet.requestId===SHOP_REQUEST,'xác nhận giao dịch cửa hàng',15000);
    if(generation!==c.generation||accountId!==c.state.accountId)throw new Error('Phiên nhân vật đã thay đổi; kiểm tra lại kết quả trên đúng tài khoản.');
    if(packet.type==='systemError')throw new Error(packet.params?.join('\n')||'Máy chủ chưa xác nhận giao dịch cửa hàng.');
    const reply=packet.normalShop;
    if(!reply||reply.profile_id!==accountId||reply.request_id!==request||reply.operation_id!==operation||reply.action!==action)
      throw new Error('Phản hồi cửa hàng không khớp giao dịch.');
    if(!reply.ok){const error=new Error(reply.error.message);error.code=reply.error.code;error.serverRejected=true;
      error.notCommitted=reply.error.not_committed;throw error;}
    return reply;
  }
  prepare(value){
    const c=this.client,intent=canonicalShopIntent(value);
    return c.action('shopPreview',['lobby'],async(gate,generation)=>{
      this.requireIdle();const accountId=c.state.accountId,operation=crypto.randomUUID(),intentHash=await shopIntentHash(intent);
      if(generation!==c.generation||accountId!==c.state.accountId)throw new Error('Phiên nhân vật đã thay đổi.');
      const reply=await this.request(gate,generation,'preview',operation,{intent});
      if(reply.status==='committed'){
        if(reply.receipt?.intent_hash!==intentHash||!shopQuoteMatchesIntent(reply.receipt.quote,intent))
          throw new Error('Biên nhận đã lưu không khớp nội dung đang xem.');
        this.state({last:clone(reply.receipt)});
        return {...reply,accountId,generation,intent:clone(intent),intentHash};
      }
      if(reply.status!=='preview'||reply.intent_hash!==intentHash||!shopQuoteMatchesIntent(reply.quote,intent)||!validShopProof(reply.proof))
        throw new Error('Bản xem trước không khớp mặt hàng hoặc số lượng đã chọn.');
      return {accountId,generation,operationId:operation,intent:clone(intent),intentHash,quote:clone(reply.quote),proof:clone(reply.proof)};
    });
  }
  apply(preview){
    const c=this.client;
    return c.action('shopApply',['lobby'],async(gate,generation)=>{
      this.requireIdle();const accountId=c.state.accountId;
      if(!preview||preview.accountId!==accountId||preview.generation!==generation||!operationId(preview.operationId)
        ||!validShopProof(preview.proof)||preview.proof.expires<=Date.now()/1000)throw new Error('Bản xem trước đã hết hạn hoặc đổi phiên. Hãy xem trước lại.');
      const intent=canonicalShopIntent(preview.intent),intentHash=await shopIntentHash(intent);
      if(generation!==c.generation||accountId!==c.state.accountId||intentHash!==preview.intentHash||!shopQuoteMatchesIntent(preview.quote,intent))
        throw new Error('Nội dung xác nhận đã thay đổi. Hãy chọn lại mặt hàng.');
      const pending={v:1,accountId,operationId:preview.operationId,intent,intentHash};
      // No packet is sent until its account-bound operation identity is durable.
      this.save(pending);
      try{
        const reply=await this.request(gate,generation,'apply',pending.operationId,{intent,proof:preview.proof});
        if(reply.status!=='committed'||reply.receipt?.intent_hash!==intentHash||!shopQuoteMatchesIntent(reply.receipt.quote,intent))
          throw new Error('Biên nhận không khớp giao dịch đã xác nhận.');
        this.state({last:clone(reply.receipt)});
        const cleared=this.clear(pending);
        return {...reply,pendingClearFailed:!cleared};
      }catch(error){
        if(generation===c.generation&&accountId===c.state.accountId){
          if(error.serverRejected&&error.notCommitted){if(!this.clear(pending))error.message+=' Chưa xóa được mã chờ; hãy kiểm tra kết quả.';}
          else error.message='Chưa rõ kết quả giao dịch. Bấm “Kiểm tra kết quả” để đối soát; không gửi lại giao dịch. '+error.message;
        }
        throw error;
      }
    });
  }
  reconcile(){
    const c=this.client;
    return c.action('shopStatus',['lobby','room','selecting','loading','scene'],async(gate,generation)=>{
      const pending=this.restore();
      if(!pending)return {status:'none'};
      if(pending.invalid)throw new Error('Chưa đọc được mã giao dịch đã lưu. Giữ nguyên bản ghi; chưa thể đối soát tự động.');
      const expected=await shopIntentHash(pending.intent);
      if(expected!==pending.intentHash)throw new Error('Bản ghi đối soát không khớp nội dung giao dịch. Giữ nguyên để kiểm tra.');
      if(generation!==c.generation||pending.accountId!==c.state.accountId)throw new Error('Phiên nhân vật đã thay đổi.');
      const reply=await this.request(gate,generation,'status',pending.operationId);
      if(reply.status==='committed'){
        if(reply.receipt?.intent_hash!==expected||!shopQuoteMatchesIntent(reply.receipt.quote,pending.intent))
          throw new Error('Biên nhận không khớp nội dung đã lưu. Giữ nguyên mã đối soát.');
        this.state({last:clone(reply.receipt)});
      }else if(reply.status!=='not_committed')throw new Error('Máy chủ chưa xác nhận trạng thái giao dịch.');
      if(!this.clear(pending))throw new Error('Đã kiểm tra máy chủ nhưng chưa xóa được mã chờ trên trình duyệt. Giữ nguyên để kiểm tra lại.');
      return reply;
    });
  }
}
