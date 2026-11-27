import {M81314Connection} from './m81314_connection.js';
import {MAIL_REQUEST,encodeMailboxRequest,createMailboxState,applyMailboxReply} from './m81329_mail_protocol.js';
export class M81329Connection extends M81314Connection{
  emptyState(){return {...super.emptyState(),mailbox:createMailboxState()};}
  withOutside(snapshot){return {...super.withOutside(snapshot),mailbox:this.cachedView('mailbox',this.state.mailbox,structuredClone)};}
  receive(packet,role,generation){
    if(generation!==this.generation)return;
    if(role==='GATE'&&packet.type==='mailboxUnread'){
      const before=this.state.mailbox;
      this.state.mailbox={...before,revision:before.revision+1,unread:packet.unread,dirty:before.received||before.dirty};
    }
    if(role==='GATE'&&packet.type==='mailbox'){
      const value=packet.mailbox,pending=this.mailRequests?.get(value.request_id);
      const correlated=pending?.generation===generation&&pending.accountId===this.state.accountId&&pending.action===value.action
        &&(!value.ok||(!value.mail||value.mail.id===pending.mail_id&&value.mail.recipient.id===this.state.accountId)
          &&(!value.mail_id||value.mail_id===pending.mail_id));
      if(value.action==='changed'||correlated)this.state.mailbox=applyMailboxReply(this.state.mailbox,value);
    }
    super.receive(packet,role,generation);
  }
  mailboxAction(action,values={}){
    return this.action('mailbox'+action,['lobby','room'],async(gate,generation)=>{
      const request_id=globalThis.crypto.randomUUID(),accountId=this.state.accountId;
      this.mailRequests??=new Map();this.mailRequests.set(request_id,{generation,accountId,action,...values});
      const frame=encodeMailboxRequest(action,request_id,values);
      try{
        const packet=await this.request(gate,frame,p=>p.type==='mailbox'&&p.mailbox.request_id===request_id&&p.mailbox.action===action
          ||p.type==='systemError'&&p.requestId===MAIL_REQUEST,'xác nhận hòm thư',15000);
        if(generation!==this.generation||accountId!==this.state.accountId)return null;
        if(packet.type==='systemError')throw new Error(packet.params?.join('\n')||'Server từ chối thao tác hòm thư.');
        const reply=packet.mailbox;
        if(!reply.ok){const error=new Error(reply.error.message);error.code=reply.error.code;error.serverRejected=true;throw error;}
        if(reply.mail&&(reply.mail.id!==values.mail_id||reply.mail.recipient.id!==accountId))throw new Error('Phản hồi thư không khớp tài khoản hiện tại.');
        if(reply.mail_id&&reply.mail_id!==values.mail_id)throw new Error('Phản hồi xóa/nhận thư không khớp yêu cầu.');
        return reply;
      }finally{this.mailRequests.delete(request_id);}
    });
  }
  listMailbox(offset=0,limit=5,filter='all'){return this.mailboxAction('list',{offset,limit,filter});}
  readMailbox(mail_id){return this.mailboxAction('read',{mail_id});}
  claimMailbox(mail_id){return this.mailboxAction('claim',{mail_id});}
  deleteMailbox(mail_id){return this.mailboxAction('delete',{mail_id});}
  deleteReadMailbox(){return this.mailboxAction('delete_read');}
}
