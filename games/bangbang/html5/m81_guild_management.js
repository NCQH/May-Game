import {renderGuildApplications} from './m81_guild_applications.js';
import {renderGuildRecruitment} from './m81_guild_recruitment.js';
/* Native guilds.py management; Flash CorpsRecruitSettingProxy / GUILD_SETTING_BIT.
 * No optimistic member, wallet or role mutations: the account facade owns replies. */
import {element,field,selectInput,note,numberText,nativeText} from './m8_ui_helpers.js';
export function guildName(value) {
  const name=String(value??'').trim();
  if(!name||new TextEncoder().encode(name).length>12||/[\x00-\x1f]/.test(name))throw new Error('Tên không được trống, tối đa 12 byte UTF-8 và không chứa ký tự điều khiển.');
  return name;
}
export function recruitmentFlags(flags,bit,on) {
  let result=Number(flags)&7;
  result=on?result|bit:result&~bit;
  if(on&&bit===1)result&=~2;if(on&&bit===2)result&=~1;
  return result;
}
export function guildPermissions(account,uuid,target=null) {
  const g=account.guild||{},teams=account.teams||[],mine=Object.values(account.members||{}).flat().find(m=>m.charUuid===uuid);
  const leader=!!uuid&&g.leaderUuid===uuid,vice=!!uuid&&g.viceLeaderUuid===uuid,officer=leader||vice;
  const team=teams.find(t=>t.teamId===target?.teamId),ownTeam=teams.find(t=>t.teamId===mine?.teamId);
  const captain=!!uuid&&team?.leaderUuid===uuid;
  const protectedTarget=target&&[g.leaderUuid,g.viceLeaderUuid].includes(target.charUuid);
  return {leader,vice,officer,mine,
    remove:!!target&&target.charUuid!==uuid&&(leader||(vice&&target.charUuid!==g.leaderUuid)||(ownTeam?.leaderUuid===uuid&&mine?.teamId===target.teamId&&!protectedTarget)),
    posts:!target?[]:[10,9,5,0].filter(post=>{
      if((post===10||post===9||protectedTarget)?!leader:!(officer||captain))return false;
      return post===10?target.charUuid!==uuid:post===9||post===0?target.charUuid!==g.leaderUuid:true;
    }),
    move:!!target&&(officer||target.charUuid===uuid)&&team?.leaderUuid!==target.charUuid,
    inviteTeam:tid=>!!uuid&&(officer||teams.find(t=>t.teamId===tid)?.leaderUuid===uuid||!!(g.settings&4)),
  };
}
function section(body,title){const box=element('section',null,'m8-account-card');box.append(element('h3',title));body.append(box);return box;}
function error(ui,e){ui.message=e.message||String(e);ui.messageError=true;ui.render();}
function send(ui,label,detail,op,values,options={}) {
  return ui.button(label,()=>{if(!ui.canMutate())return;try {const data=typeof values==='function'?values():values;
    ui.confirm(label,typeof detail==='function'?detail(data):detail,()=>ui.client.guildAction(op,typeof values==='function'?values():data),{success:'Đã cập nhật Guild.',button:label});
  }catch(e){error(ui,e);}}, {disabled:!ui.canMutate(),...options});
}
function options(account,exclude=0){return (account.teams||[]).filter(t=>t.teamId!==exclude).map(t=>({value:t.teamId,label:t.name}));}
function cardCount(ui,id){return Object.values(ui.snapshot.meta?.containers||{}).flatMap(b=>b.items||[]).filter(i=>i.templateId===id).reduce((n,i)=>n+Math.max(0,i.count),0);}
function rename(ui,body,title,op,id,teamId) {
  const box=section(body,title),input=ui.input(`gm-${op}-${teamId||0}`,'',{placeholder:'Tên mới',maxLength:12});const count=cardCount(ui,id);
  box.append(field('Tên mới (tối đa 12 byte UTF-8)',input),note(`Cần 1 thẻ đổi tên · Đang có ${numberText(count)} thẻ.`));
  const item=ui.catalog.guildItems?.[id];
  if(item)box.append(ui.button(`Mua thẻ · ${numberText(item.silverPrice)} Bạc`,()=>ui.confirm('Mua thẻ đổi tên',`Thanh toán ${numberText(item.silverPrice)} Bạc.`,()=>ui.client.guildPurchase(item,{coinType:2,count:1}),{success:'Đã mua thẻ đổi tên.'}),{disabled:!ui.canMutate()||Number(ui.snapshot.meta?.character?.currency?.golden||0)<item.silverPrice,testId:`guild-buy-${id}`}));
  box.append(send(ui,'Đổi tên',data=>`Đổi thành “${data.name}”, tiêu 1 thẻ đổi tên.`,op,()=>({name:guildName(input.value),...(teamId?{teamId}:{})}),{disabled:!ui.canMutate()||count<1,testId:`guild-${op}-${teamId||0}`}));
}
export function renderGuildManagement(ui,body,account) {
  if(!account.guild)return;
  const uuid=ui.snapshot.meta?.character?.charUuid||'',p=guildPermissions(account,uuid),g=account.guild;
  if(p.officer){
    for(const [op,label,current] of [['notice','Thông báo Guild',g.notice]]){
      const box=section(body,label),input=element('textarea');input.value=ui.fields[`gm-${op}`]??current??'';input.maxLength=1000;input.dataset.accountField=`gm-${op}`;
      input.addEventListener('input',()=>ui.fields[`gm-${op}`]=input.value);box.append(input,send(ui,'Lưu '+label,'Lưu nội dung đã nhập.',op,()=>{
        if(new TextEncoder().encode(input.value).length>1000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(input.value))throw new Error('Nội dung tối đa 1.000 byte UTF-8, không chứa ký tự điều khiển.');
        return {text:input.value};},{testId:`guild-save-${op}`}));
    }
    renderGuildRecruitment(ui,body,account,send,recruitmentFlags);
    const create=section(body,'Tạo đội');
    const cap=Number((ui.catalog.guildLevels||[]).find(r=>r.nLevel===g.level)?.nTeamCount||0);
    create.append(note('Cần quỹ Guild ít nhất 10.000; máy chủ trừ 1.000 quỹ khi tạo đội.'),ui.button('Tạo đội',()=>ui.openGuildCreation(true),{disabled:!ui.canMutate()||g.coin<10000||!cap||account.teams.length>=cap,testId:'guild-create-team'}));
    const applications=section(body,'Đơn xin gia nhập');applications.style.padding='0';
    applications.append(send(ui,'Tải đơn xin vào','Tải danh sách đơn hiện tại.','applications',{}, {testId:'guild-applications-refresh'}));
    const freshApplication=(row,teamId)=>{const a=ui.snapshot.account||{},uuid=ui.snapshot.meta?.character?.charUuid;if(!guildPermissions(a,uuid).officer||!a.applications?.some(x=>x.charUuid===row.charUuid))throw new Error('Quyền hoặc đơn xin đã thay đổi.');if(teamId!=null&&!(a.teams||[]).some(t=>t.teamId===teamId))throw new Error('Đội tiếp nhận không còn tồn tại.');return a;};
    ui.guildApplicationRoot=renderGuildApplications(ui,applications,account,{
      onApprove:(row,teamId)=>ui.confirm('Chấp nhận đơn',`Tiếp nhận ${row.name}.`,()=>{freshApplication(row,teamId);return ui.client.guildAction('approve',{charUuid:row.charUuid,teamId});},{success:'Đã xử lý đơn xin.'}),
      onReject:row=>ui.confirm('Từ chối đơn',`Từ chối đơn của ${row.name}.`,()=>{freshApplication(row);return ui.client.guildAction('reject',{charUuid:row.charUuid});},{success:'Đã xử lý đơn xin.'}),
      onView:row=>{ui.profileIdentity=String(row.accountId||row.charUuid);ui.fields.profileIdentity=ui.profileIdentity;delete ui.cache.profile;ui.setSection('profile');}
    });
  }
  if(p.leader)rename(ui,body,'Đổi tên Guild','rename',2600006);
  for(const team of account.teams||[]){
    if(uuid&&team.leaderUuid===uuid)rename(ui,body,'Đổi tên đội '+team.name,'renameTeam',2600003,team.teamId);
    if(p.officer){const box=section(body,team.name);box.append(send(ui,'Giải tán đội','Chỉ giải tán đội trống; Guild phải giữ ít nhất một đội.','dissolveTeam',{teamId:team.teamId},{disabled:!ui.canMutate()||account.teams.length<=1||!Array.isArray(account.members?.[team.teamId])||account.members[team.teamId].length>0,testId:`guild-dissolve-${team.teamId}`}));}
  }
  const eligible=(account.teams||[]).filter(t=>p.inviteTeam(t.teamId));
  if(eligible.length){const box=section(body,'Mời thành viên'),team=selectInput(eligible.map(t=>({value:t.teamId,label:t.name})),ui.fields['gm-invite-team']||eligible[0].teamId,'Đội nhận');
    team.dataset.accountField='gm-invite-team';team.addEventListener('change',()=>ui.fields['gm-invite-team']=team.value);
    box.append(team,ui.button('Mời vào Guild',()=>ui.openGuildInvite(Number(team.value),'invite'),{disabled:!ui.canMutate(),testId:'guild-invite'}),ui.button('Mời chuyển đội',()=>ui.openGuildInvite(Number(team.value),'inviteTeam'),{disabled:!ui.canMutate(),testId:'guild-invite-team'}));
  }
}
export function renderGuildMembers(ui,body,account,{onlyMemberUuid=null}={}) {
  const uuid=ui.snapshot.meta?.character?.charUuid||'';
  for(const team of account.teams||[]){
    const visible=(account.members?.[team.teamId]||[]).filter(m=>!onlyMemberUuid||m.charUuid===onlyMemberUuid);if(!visible.length)continue;const box=section(body,team.name);
    for(const member of visible){const buddy=account.buddies?.[member.accountId],p=guildPermissions(account,uuid,member),row=element('div',null,'m8-account-card');
      const post=member.charUuid===account.guild.leaderUuid?'Chủ hội':member.charUuid===account.guild.viceLeaderUuid?'Phó hội':member.charUuid===team.leaderUuid?'Đội trưởng':'Thành viên';
      row.append(element('h4',buddy?.name||member.charUuid),note(`${post} · Cấp ${buddy?.level??'—'} · ${buddy?.online?'Online':'Offline'} · Cống hiến ${numberText(member.merit)} / tổng ${numberText(member.allMerit)}`));
      if(p.remove)row.append(send(ui,'Đuổi thành viên','Phí theo tổng cống hiến và số ngày offline: Guild/đội 30%/70% (<2 ngày), 20%/40% (<3), 10%/20% (<5), 5%/10% (<7), 0%/0% (≥7). Máy chủ kiểm tra quỹ và thời gian chính xác.','remove',{charUuid:member.charUuid,teamId:team.teamId},{testId:`guild-remove-${member.accountId}`}));
      if(p.posts.length){const posts=selectInput(p.posts.map(post=>({value:post,label:({10:'Chủ hội',9:'Phó hội',5:'Đội trưởng',0:'Bỏ chức vụ'})[post]})),p.posts.includes(Number(ui.fields[`member-post-${member.charUuid}`]))?ui.fields[`member-post-${member.charUuid}`]:p.posts[0],'Chức vụ');posts.dataset.accountField=`member-post-${member.charUuid}`;posts.addEventListener('change',()=>{ui.fields[posts.dataset.accountField]=posts.value;});row.append(posts,send(ui,'Đổi chức vụ','Chuyển chức vụ cho thành viên đã chọn.','appoint',()=>({charUuid:member.charUuid,teamId:team.teamId,post:Number(posts.value)}),{testId:`guild-appoint-${member.accountId}`}));}
      if(p.move&&account.teams.length>1){const dest=selectInput(options(account,team.teamId),options(account,team.teamId).some(t=>String(t.value)===String(ui.fields[`member-dest-${member.charUuid}`]))?ui.fields[`member-dest-${member.charUuid}`]:options(account,team.teamId)[0].value,'Đội đích');dest.dataset.accountField=`member-dest-${member.charUuid}`;const swap=selectInput([{value:'',label:'Không đổi chỗ'}], '','Thành viên đổi chỗ');
        const rebuild=()=>{swap.replaceChildren();for(const m of [{charUuid:'',name:'Không đổi chỗ'},...(p.officer?(account.members?.[Number(dest.value)]||[]):[])]){const option=element('option',m.name||account.buddies?.[m.accountId]?.name||m.charUuid);option.value=m.charUuid;swap.append(option);}const saved=ui.fields[`member-swap-${member.charUuid}`]||'';swap.value=(p.officer?(account.members?.[Number(dest.value)]||[]):[]).some(m=>m.charUuid===saved)?saved:'';};rebuild();swap.dataset.accountField=`member-swap-${member.charUuid}`;swap.addEventListener('change',()=>{ui.fields[swap.dataset.accountField]=swap.value;});dest.addEventListener('change',()=>{ui.fields[dest.dataset.accountField]=dest.value;ui.fields[swap.dataset.accountField]='';rebuild();});
        row.append(dest);if(p.officer)row.append(swap);row.append(send(ui,'Chuyển đội','Mỗi người chuyển mất một nửa cống hiến hiện tại (làm tròn xuống phần trừ); mỗi lần cách nhau ít nhất 1 ngày. Đội trưởng phải chuyển chức trước.','move',()=>({originTeamId:team.teamId,charUuid:member.charUuid,teamId:Number(dest.value),otherUuid:p.officer?swap.value:''}),{testId:`guild-move-${member.accountId}`}));}
      box.append(row);
    }
  }
}
export function renderGuildInvitations(ui,body,account) {
  const uuid=ui.snapshot.meta?.character?.charUuid||'';
  for(const [kind,invite] of [['invitation',account.invitation],['teamInvitation',account.teamInvitation]]){
    if(!invite||(kind==='invitation'?!!account.guild:!account.guild||invite.charUuid!==uuid||invite.teamId===account.selfTeamId||!(account.teams||[]).some(t=>t.teamId===invite.teamId)))continue;
    const key='gm-dismiss-'+kind,signature=JSON.stringify(invite);if(ui.fields[key]===signature)continue;
    const box=section(body,kind==='invitation'?'Lời mời vào Guild':'Lời mời chuyển đội');box.append(note(`${invite.guildName||account.guild?.name} · ${invite.teamName}`));
    box.append(send(ui,'Chấp nhận lời mời',kind==='invitation'?'Tham gia Guild theo lời mời.':'Chuyển đội mất một nửa cống hiến; máy chủ kiểm tra hạn 1 ngày.',kind==='invitation'?'join':'acceptTeam',kind==='invitation'?{guildId:invite.guildId,teamId:invite.teamId}:{teamId:invite.teamId,charUuid:uuid},{testId:`guild-accept-${kind}`}),ui.button('Ẩn lời mời',()=>{ui.fields[key]=signature;ui.render();},{testId:`guild-dismiss-${kind}`}));
  }
}
