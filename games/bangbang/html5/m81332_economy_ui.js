import {element,actionButton,numberText} from './m8_ui_helpers.js';
import {economyReference} from './m81332_economy_protocol.js';

export function economyProtection(item,activeUuid='',helper=false){
  if(!item||!Number.isInteger(item.extFlag)||item.extFlag<0)return 'Cờ vật phẩm chưa hợp lệ.';
  if(item.extFlag&2)return 'Đang khóa bảo vệ';
  if(item.extFlag&~17)return 'Đang dùng hoặc có trạng thái chưa hỗ trợ';
  if(item.lifeTime!==0)return 'Vật phẩm có thời hạn chưa hỗ trợ';
  if(helper&&item.uuid===activeUuid)return 'Đang làm chủ chiến';
  return '';
}

/** A confirmation layer outside the scaled Flash-style panel. Text is always
 * textContent, never catalog HTML. Closing the panel cannot resend an operation.
 */
export class M81332EconomyDialog{
  constructor({client,kind,items=[],container=0,name=item=>'Vật phẩm '+item.templateId,onComplete=()=>{},onClose=()=>{}}){
    this.client=client;this.kind=kind;this.items=items.map(item=>structuredClone(item));this.container=container;
    this.name=name;this.onComplete=onComplete;this.onClose=onClose;this.generation=client.generation;this.accountId=client.state.accountId;
    this.quantity=1;this.busy=false;this.stage='choose';this.notice='';this.preview=null;this.disposed=false;
    this.returnFocus=document.activeElement;this.root=element('div',null,'m81332-economy-shade');
    this.root.dataset.testid='economy-dialog';
    this.style=element('link');this.style.rel='stylesheet';const url=new URL('./m81332_economy.css',import.meta.url);url.search=new URL(import.meta.url).search;this.style.href=url.href;
    this.onKeyDown=event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!this.busy)this.dispose();}
      if(event.key==='Tab'){
        const choices=[...this.root.querySelectorAll('button:not(:disabled),input:not(:disabled),[tabindex="0"]')],first=choices[0],last=choices.at(-1);
        if(first&&(!this.root.contains(document.activeElement)||event.shiftKey&&document.activeElement===first||!event.shiftKey&&document.activeElement===last)){
          event.preventDefault();(event.shiftKey?last:first).focus();
        }
      }
    };
    this.root.addEventListener('keydown',this.onKeyDown);document.body.append(this.style,this.root);this.render();
  }
  live(){return !this.disposed&&this.generation===this.client.generation&&this.accountId===this.client.state.accountId;}
  update(snapshot){if(!this.live()||snapshot.accountId!==this.accountId||!['lobby','room'].includes(snapshot.play?.phase))this.dispose();}
  button(label,work,id,disabled=false){return actionButton(label,()=>{if(this.live()&&!this.busy)return work();},
    {disabled:this.busy||disabled,testId:id});}
  intent(){
    const items=this.items.map(item=>economyReference(item,this.kind==='dismantle'?5:this.container,
      this.kind==='dismantle'?1:this.quantity));
    return {kind:this.kind,items};
  }
  async prepare(){
    if(!this.live()||this.busy)return;
    if(this.kind==='sell'&&(!Number.isSafeInteger(this.quantity)||this.quantity<1||this.quantity>this.items[0]?.count)){
      this.notice='Nhập số lượng nguyên từ 1 đến số đang có.';this.render();return;
    }
    this.busy=true;this.notice='Đang kiểm tra UUID, số lượng, khóa và số dư tại máy chủ…';this.render();
    try{
      const preview=await this.client.prepareEconomy(this.intent());
      if(this.live()){this.preview=preview;this.stage='confirm';this.notice='';}
    }catch(error){if(this.live())this.notice=error.message;}
    finally{if(this.live()){this.busy=false;this.render();}}
  }
  async apply(){
    if(!this.live()||this.busy||!this.preview)return;
    this.busy=true;this.notice='Đang chờ biên nhận máy chủ…';this.render();
    try{
      const result=await this.client.applyEconomy(this.preview);
      if(this.live()){
        this.stage='done';this.notice=economyReceiptText(result.reply.receipt);this.onComplete(result.reply.receipt);
      }
    }catch(error){if(this.live()){this.preview=null;this.stage='choose';this.notice=error.message;}}
    finally{if(this.live()){this.busy=false;this.render();}}
  }
  async reconcile(){
    if(!this.live()||this.busy)return;
    this.busy=true;this.notice='Chỉ kiểm tra biên nhận; không gửi lại thao tác.';this.render();
    try{
      const result=await this.client.reconcileEconomy();
      if(this.live()){
        this.stage='done';this.notice=result.status==='committed'?economyReceiptText(result.receipt)
          :'Máy chủ xác nhận thao tác trước chưa được thực hiện. Túi và ví đã đồng bộ; có thể đóng rồi chọn lại.';
        this.onComplete(result.receipt||null);
      }
    }catch(error){if(this.live())this.notice=error.message;}
    finally{if(this.live()){this.busy=false;this.render();}}
  }
  render(){
    if(this.disposed)return;
    const pending=this.client.state.economy?.pending,dialog=element('section',null,'m81332-economy-dialog');
    dialog.setAttribute('role','alertdialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','m81332-economy-title');
    const title=element('h2',pending?'Kiểm tra giao dịch chưa rõ kết quả':this.kind==='sell'?'Bán vật phẩm / nguyên liệu':'Tách trợ thủ');title.id='m81332-economy-title';
    dialog.append(title);
    if(pending){
      dialog.append(element('p','Không gửi lại thao tác trước. Kiểm tra biên nhận theo mã đã lưu để biết giao dịch có hoàn tất hay chưa.'),
        this.button('Kiểm tra kết quả',()=>this.reconcile(),'economy-reconcile',!!pending.invalid));
      if(pending.invalid)dialog.append(element('p','Bản ghi cục bộ chưa đọc được; giữ nguyên để kiểm tra, không tự xóa hoặc thử lại giao dịch.'));
    }else if(this.stage!=='done'){
      const list=element('ul',null,'m81332-economy-items');
      const quoted=this.preview?.quote?.items;
      for(const item of this.items){
        const row=quoted?.find(row=>row.uuid===item.uuid),name=row?.name||this.name(item);
        const label=this.kind==='sell'?`${name} — đang có ${numberText(item.count)}`
          :`${name} — cấp ${row?.level??item.level}, cường hóa +${row?.upgrade_level??item.upgradeLevel}, ${row?.rank??item.rank} sao`;
        const li=element('li',label);li.dataset.uuid=item.uuid;list.append(li);
      }
      dialog.append(list);
      if(this.stage==='choose'&&this.kind==='sell'){
        const label=element('label','Số lượng bán '),input=element('input');input.type='number';input.min='1';input.max=String(this.items[0]?.count||0);input.step='1';input.value=String(this.quantity);
        input.disabled=this.busy;input.dataset.testid='economy-quantity';input.setAttribute('aria-label','Số lượng bán');
        input.addEventListener('input',()=>{this.quantity=Number(input.value);this.preview=null;});label.append(input);dialog.append(label,
          this.button('Chọn cả chồng',()=>{this.quantity=this.items[0].count;this.render();},'economy-all-stack'));
      }
      const q=this.preview?.quote,total=q?.gold_xu??(this.kind==='sell'?this.quantity:this.items.length*10);
      dialog.append(element('p',this.kind==='sell'?'Giá: 1 Xu vàng / đơn vị. Chỉ Vật phẩm và Nguyên liệu.':'Giá: 10 Xu vàng / trợ thủ. Không tách trợ thủ đang dùng hoặc khóa bảo vệ.'),
        element('p',`Nhận ${numberText(total)} Xu vàng (không phải Bạc hoặc Xu khóa).`,'m81332-economy-total'));
      if(this.stage==='confirm')dialog.append(element('p',this.kind==='sell'
        ?`Xác nhận bán ${numberText(q.items.reduce((n,row)=>n+row.quantity,0))} đơn vị? Vật phẩm bị trừ sau khi máy chủ xác nhận.`
        :'Xác nhận tách toàn bộ trợ thủ trong danh sách? Trợ thủ và toàn bộ tiến trình nâng của chúng sẽ bị xóa.', 'm81332-economy-warning'),
        this.button(this.kind==='sell'?'Xác nhận bán':'Xác nhận tách',()=>this.apply(),'economy-confirm'),
        this.button('Chọn lại',()=>{this.stage='choose';this.preview=null;this.render();},'economy-back'));
      else dialog.append(this.button('Xem trước tại máy chủ',()=>this.prepare(),'economy-preview',this.items.length===0));
    }
    if(this.notice){const status=element('p',this.notice,'m81332-economy-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');dialog.append(status);}
    dialog.append(this.button(this.stage==='done'?'Đóng':'Hủy',()=>this.dispose(),'economy-cancel'));
    this.root.replaceChildren(dialog);
    (dialog.querySelector('[data-testid="economy-cancel"]')||dialog.querySelector('button'))?.focus?.({preventScroll:true});
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.root.removeEventListener('keydown',this.onKeyDown);this.root.remove();this.style.remove();this.onClose();if(this.returnFocus?.isConnected)this.returnFocus.focus?.({preventScroll:true});}
}
export function economyReceiptText(receipt){
  const q=receipt?.quote;if(!q)return 'Đã đồng bộ túi và ví theo máy chủ.';
  if(q.kind==='feed')return `Đã tăng đúng 1 cấp: ${q.previous_level} → ${q.current_level}, dùng ${numberText(q.required_count)} chip; ${q.discarded_exp?`đã bỏ ${numberText(q.discarded_exp)} EXP dư theo xác nhận`:`giữ ${numberText(q.current_exp)} EXP dư`}.`;
  return `${q.kind==='sell'?'Đã bán':'Đã tách'} ${numberText(q.items.reduce((n,row)=>n+row.quantity,0))} ${q.kind==='sell'?'vật phẩm/nguyên liệu':'trợ thủ'}, nhận ${numberText(q.gold_xu)} Xu vàng theo biên nhận máy chủ.`;
}
