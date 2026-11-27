import {element,actionButton,numberText,assetImage} from './m8_ui_helpers.js';
import {createNativePanel} from './m81_native_panel.js';
const date=value=>new Date(Number(value)*1000).toLocaleString('vi-VN');
export function mailLifetime(mail,now=Date.now()/1000){
  if(!mail.claimed)return 'Chưa nhận quà';
  const expiry=mail.expires_at??(mail.claimed_at==null?null:mail.claimed_at+43200);
  if(expiry==null)return 'Đã nhận quà';
  const minutes=Math.max(0,Math.ceil((expiry-now)/60));
  if(!minutes)return 'Đang dọn thư đã nhận';
  return `Tự xóa sau ${minutes>=60?`${Math.floor(minutes/60)} giờ `:''}${minutes%60?`${minutes%60} phút`:''}`.trim();
}
export class M81329Mailbox{
  constructor({host,client,assets,onClose=()=>{}}){
    Object.assign(this,{host,client,assets,onClose});this.generation=client.generation;this.accountId=client.state.accountId;
    this.snapshot=null;this.pending='';this.selected='';this.filter='all';this.notice='';this.noticeError=false;this.disposed=false;this.started=false;this.lastKey='';
    const style=element('link');style.rel='stylesheet';const url=new URL('./m81329_mail.css',import.meta.url);url.search=new URL(import.meta.url).search;style.href=url.href;
    const panelAssets={...assets?.panels?.assets,...assets?.ui?.assets};
    this.panel=createNativePanel({assets:panelAssets,width:860,height:552,kind:'box1',state:'BOTTOM_BAR'});
    this.panel.root.classList.add('m81329-mail-frame');this.panel.root.setAttribute('role','dialog');this.panel.root.setAttribute('aria-modal','true');this.panel.root.setAttribute('aria-label','Hòm thư');
    this.body=element('section',null,'m81329-mail-body');this.panel.content.append(this.body);
    this.close=actionButton('×',()=>this.requestClose(),{className:'m81329-mail-close',title:'Đóng hòm thư',testId:'mail-close'});this.close.setAttribute('aria-label','Đóng hòm thư');
    this.panel.root.append(this.close);this.host.replaceChildren(style,this.panel.root);
    this.keydown=event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.requestClose();}
      if(event.key!=='Tab')return;
      const buttons=[...this.panel.root.querySelectorAll('button:not(:disabled),[tabindex="0"]')],first=buttons[0],last=buttons.at(-1);
      if(!first){event.preventDefault();return;}
      if(!this.panel.root.contains(document.activeElement)||(event.shiftKey&&document.activeElement===first)||(!event.shiftKey&&document.activeElement===last)){
        event.preventDefault();(event.shiftKey?last:first).focus();}
    };
    this.panel.root.addEventListener('keydown',this.keydown);this.close.focus();
    this.clock=setInterval(()=>{
      if(!this.live()||document.hidden)return;
      const state=this.snapshot?.mailbox,now=(Date.now()+(state?.clockOffset||0))/1000;
      if(this.available&&state?.rows.some(row=>row.expires_at!=null&&row.expires_at<=now))this.refresh();
      else if(!this.pending)this.render();
    },30000);
  }
  live(){return !this.disposed&&this.generation===this.client.generation&&this.accountId===this.client.state.accountId;}
  get available(){return this.live()&&this.snapshot?.phase==='ready'&&['lobby','room'].includes(this.snapshot?.play?.phase)&&!this.snapshot?.play?.busy&&!this.pending;}
  update(snapshot){
    this.snapshot=snapshot;if(!this.live())return;
    const key=JSON.stringify([snapshot.mailbox?.revision,snapshot.play?.busy,snapshot.play?.phase,this.pending,this.selected,this.filter,this.notice]);
    if(key!==this.lastKey){this.lastKey=key;this.render();}
    if(!this.started&&this.available){this.started=true;queueMicrotask(()=>{if(this.live())this.refresh(0);});}
  }
  async perform(kind,work){
    if(!this.available)return null;this.pending=kind;this.notice='';this.noticeError=false;this.render();
    try{const result=await work();if(!this.live()||!result)return null;return result;}
    catch(error){if(this.live()){this.notice=error.message+(kind==='claim'&&!error.serverRejected?' Chưa rõ kết quả; hãy làm mới hoặc mở lại thư. Nhận lại cùng thư không cộng trùng.':'');this.noticeError=true;}return null;}
    finally{if(this.live()){this.pending='';this.render();}}
  }
  async refresh(offset=this.snapshot?.mailbox?.offset||0){
    const result=await this.perform('list',()=>this.client.listMailbox(offset,5,this.filter));if(!result||!this.live())return;
    if(this.selected&&!result.rows.some(row=>row.id===this.selected))this.selected='';this.render();
  }
  async select(mail_id){
    if(!this.available)return;this.selected=mail_id;
    await this.perform('read',()=>this.client.readMailbox(mail_id));if(this.live())this.render();
  }
  async claim(){
    const mail=this.snapshot?.mailbox?.details?.[this.selected];if(!mail||mail.claimed||!this.available)return;
    const result=await this.perform('claim',()=>this.client.claimMailbox(mail.id));
    if(result&&this.live()){
      if(result.removed){this.selected='';await this.refresh();}
      this.notice=result.already_claimed?'Thư đã được nhận trước đó. Không cộng thêm lần nữa.':
        result.removed?'Đã nhận toàn bộ quà và dọn thư để đưa hòm thư cũ về giới hạn 30 thư.':
          'Đã nhận toàn bộ quà. Thư sẽ tự xóa sau 12 giờ; có thể bấm × để xóa ngay.';
      this.noticeError=false;this.render();
    }
  }
  async remove(mail){
    if(!this.available)return;
    if(!mail.claimed){this.notice='Thư còn quà. Hãy nhận hết quà trước khi xóa.';this.noticeError=true;this.render();return;}
    const result=await this.perform('delete',()=>this.client.deleteMailbox(mail.id));
    if(!result||!this.live())return;
    if(this.selected===mail.id)this.selected='';await this.refresh();
    if(this.live()){this.notice='Đã xóa thư. Quà đã nhận vẫn được giữ trong tài khoản.';this.noticeError=false;this.render();}
  }
  async removeRead(){
    const result=await this.perform('delete_read',()=>this.client.deleteReadMailbox());
    if(!result||!this.live())return;
    if(result.deleted.includes(this.selected))this.selected='';await this.refresh();
    if(this.live()){
      this.notice=`Đã xóa ${result.deleted.length} thư đã đọc và nhận hết quà.`+
        (result.kept_unclaimed?` Giữ lại ${result.kept_unclaimed} thư còn quà.`:'');
      this.noticeError=false;this.render();
    }
  }
  rewardIcon(reward){
    const key=reward.kind==='currency'?{cash:'currency.money',golden:'currency.diamond',gift:'currency.coupon'}[reward.id]:
      reward.kind==='item'?this.assets?.garage?.items?.[String(reward.id)]?.icon:null;
    return key?this.assets?.resources?.get(key)||this.assets?.ui?.assets?.[key]||this.assets?.garage?.assets?.[key]:null;
  }
  requestClose(){if(this.pending){this.notice='Đang chờ server xác nhận. Vui lòng chờ thao tác kết thúc.';this.render();return;}this.onClose();}
  render(){
    if(!this.live())return;const state=this.snapshot?.mailbox||{rows:[],details:{},offset:0,limit:5,total:0,total_inbox:0,unread:0,pending:0};
    const now=(Date.now()+(state.clockOffset||0))/1000;
    const active=document.activeElement?.dataset?.testid;
    this.body.replaceChildren();this.close.disabled=!!this.pending;
    const title=element('h2','THƯ','m81329-mail-title'),stats=element('p',`${numberText(state.total_inbox??state.total)}/30 thư · ${numberText(state.unread)} chưa đọc`,'m81329-mail-count');
    const refresh=actionButton('Làm mới',()=>this.refresh(),{disabled:!this.available,testId:'mail-refresh'});
    const tabs=element('nav',null,'m81329-mail-tabs');tabs.setAttribute('aria-label','Loại thư');
    for(const [filter,label] of [['all','Hộp thư đến'],['unread','Thư chưa đọc']]){
      const tab=actionButton(label,()=>{if(!this.available)return;this.filter=filter;this.selected='';this.refresh(0);},
        {disabled:!this.available,className:'m81329-mail-tab',testId:`mail-tab-${filter}`});
      tab.setAttribute('aria-pressed',String(this.filter===filter));tabs.append(tab);
    }
    const toolbar=element('div',null,'m81329-mail-toolbar');toolbar.append(tabs,stats,refresh);this.body.append(title,toolbar);
    const main=element('div',null,'m81329-mail-main'),listPanel=element('section',null,'m81329-mail-list-panel'),list=element('div',null,'m81329-mail-list');list.setAttribute('aria-label','Danh sách thư');
    for(const mail of state.rows){
      const row=element('div',null,'m81329-mail-row-wrap');
      const button=actionButton('',()=>this.select(mail.id),{disabled:!this.available,className:'m81329-mail-row',testId:`mail-row-${mail.id}`});
      button.setAttribute('aria-pressed',String(this.selected===mail.id));button.dataset.read=String(mail.read);
      const emblem=element('span','✉','m81329-mail-envelope');emblem.setAttribute('aria-hidden','true');
      const copy=element('span',null,'m81329-mail-row-copy');
      copy.append(element('strong',mail.subject),element('small',`Từ: ${mail.sender}`),element('small',mailLifetime(mail,now),'m81329-mail-lifetime'));
      button.append(emblem,copy);
      const remove=actionButton('×',()=>this.remove(mail),{disabled:!this.available,className:'m81329-mail-delete',
        title:mail.claimed?'Xóa thư đã nhận quà':'Nhận hết quà trước khi xóa',testId:`mail-delete-${mail.id}`});
      remove.setAttribute('aria-label',`Xóa thư: ${mail.subject}`);row.append(button,remove);list.append(row);
    }
    if(!state.rows.length)list.append(element('p',this.pending==='list'?'Đang tải thư…':this.filter==='unread'?'Không có thư chưa đọc.':'Chưa có thư. Thư tiếp tế sẽ xuất hiện ở đây.','m81329-mail-empty'));
    const detail=element('article',null,'m81329-mail-detail'),mail=state.details[this.selected];
    if(mail){
      const header=element('div',null,'m81329-mail-heading');
      header.append(element('p',`Người gửi: ${mail.sender}`,'m81329-mail-sender'),element('h3',mail.subject));
      const letter=element('div',null,'m81329-mail-letter');letter.append(element('p',mail.body||'Quà tiếp tế gửi kèm bên dưới.','m81329-mail-text'),
        element('small',date(mail.created_at),'m81329-mail-date'));
      const rewards=element('ul',null,'m81329-mail-rewards');
      for(const reward of mail.rewards){
        const row=element('li'),icon=this.rewardIcon(reward);row.title=`${reward.name} × ${numberText(reward.quantity)}`;
        if(icon)row.append(assetImage(icon,reward.name));
        row.append(element('span',reward.name),element('b',`× ${numberText(reward.quantity)}`));rewards.append(row);
      }
      detail.append(header,letter,rewards,element('p',mailLifetime(mail,now),'m81329-mail-policy'));
    }else detail.append(element('p',this.pending==='read'?'Đang mở thư…':'Chọn một lá thư để xem và nhận quà.','m81329-mail-empty'));
    const bottom=element('div',null,'m81329-mail-bottom');bottom.append(
      actionButton('‹',()=>this.refresh(Math.max(0,state.offset-state.limit)),{disabled:!this.available||state.offset===0,title:'Trang trước',testId:'mail-prev'}),
      element('span',`${Math.floor(state.offset/state.limit)+1}/${Math.max(1,Math.ceil(state.total/state.limit))}`),
      actionButton('›',()=>this.refresh(state.offset+state.limit),{disabled:!this.available||state.offset+state.limit>=state.total,title:'Trang sau',testId:'mail-next'}));
    listPanel.append(list,bottom);main.append(listPanel,detail);this.body.append(main);
    const controls=element('div',null,'m81329-mail-controls');controls.append(
      actionButton('Xóa thư đã đọc',()=>this.removeRead(),{disabled:!this.available||!state.total_inbox,testId:'mail-delete-read',
        title:'Chỉ xóa thư đã đọc và nhận hết quà. Thư còn quà được giữ lại.'}),
      actionButton(mail?.claimed?'Đã nhận quà':this.pending==='claim'?'Đang nhận…':'Nhận toàn bộ quà',()=>this.claim(),
        {disabled:!mail||mail.claimed||!this.available,className:'m81329-mail-claim',testId:'mail-claim',title:'Nhận toàn bộ quà trong thư đang chọn'}));
    const policy=element('p','Tối đa 30 thư · Thư đã nhận quà tự xóa sau 12 giờ.','m81329-mail-retention');
    const notice=element('p',this.notice||(state.dirty?'Hòm thư đã thay đổi. Bấm Làm mới để xem danh sách mới.':this.pending?'Đang chờ server…':'Thư còn quà luôn được giữ lại khi dọn thư.'),`m81329-mail-notice${this.noticeError?' is-error':''}`);notice.setAttribute('role',this.noticeError?'alert':'status');
    this.body.append(controls,policy,notice);
    if(active)for(const button of this.panel.root.querySelectorAll('[data-testid]'))if(button.dataset.testid===active&&!button.disabled){button.focus();break;}
  }
  dispose(){this.disposed=true;clearInterval(this.clock);this.panel.root.removeEventListener('keydown',this.keydown);}
}
