import {element,actionButton,assetImage,numberText,setText} from './m8_ui_helpers.js';
import {createNativePanel} from './m81_native_panel.js';
import {worldBossView} from './m81330_state.js';

export const WORLD_BOSS_REWARDS=Object.freeze([
  {id:3700002,count:2,name:'Chip Siêu Dẫn II',icon:'icon_zhushou_jingyan02.png'},
  {id:3800001,count:1,name:'Tinh Thể Siêu Năng I',icon:'icon_zhushou_qianghua01.png'},
  {id:3800002,count:1,name:'Tinh Thể Siêu Năng II',icon:'icon_zhushou_qianghua02.png'},
  {id:4400001,count:1,name:'Lõi Vạn Năng I',icon:'icon_jiaxingcailiao01.png'},
  {id:4400002,count:1,name:'Lõi Vạn Năng II',icon:'icon_jiaxingcailiao02.png'},
  {id:3900002,count:1,name:'Dung dịch tăng tỷ lệ No.2',icon:'icon_zhushou_jinhua2.png'},
  {id:4000001,count:1,name:'Bộ Nhớ Thông Tin',icon:'icon_zhushou_zhuanyi.png'},
]);
export const worldBossTimeText=seconds=>seconds===null?'—:—'
  :`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
export function worldBossStatusText(view){
  if(!view.ready)return 'Đang chờ kết nối lại…';
  if(view.clock.awaiting)return 'Đang chờ máy chủ xác nhận lượt đấu…';
  if(view.clock.kind==='ends')return `Kết thúc sau ${worldBossTimeText(view.clock.seconds)}`;
  if(view.clock.kind==='reopens')return `Lượt mới sau ${worldBossTimeText(view.clock.seconds)}`;
  return view.state.status===3?'Lượt đấu đã kết thúc':'Đang đồng bộ Boss Thế Giới…';
}
export function worldBossRewardText(reward){
  if(!reward)return 'Gây sát thương lên boss để nhận quà khi lượt đấu kết thúc.';
  if(reward.status==='pending')return 'Quà đang được giữ chờ. Dọn túi nguyên liệu rồi đăng nhập lại để nhận đủ quà.';
  if(reward.status==='delivered')return 'Đã nhận đủ quà của lượt này vào túi nguyên liệu.';
  return reward.pending_rounds>0?`Còn ${reward.pending_rounds} lượt quà đang giữ chờ. Dọn túi rồi đăng nhập lại để nhận.`
    :'Gây sát thương lên boss để nhận quà khi lượt đấu kết thúc.';
}

/** Offline activity view: native source art, native leaderboard/rewards, no
 * invented online players, timers, entry fee, cooldown purchase or claim API. */
export class M81330WorldBoss{
  constructor({host,client,assets,run,onClose=()=>{},onInventory=()=>{}}){
    Object.assign(this,{host,client,assets,run,onClose,onInventory});
    this.disposed=false;this.snapshot=null;this.key='';this.watchedGeneration=null;
    const panelAssets={...assets.panels.assets,...assets.ui.assets};
    this.panel=createNativePanel({assets:panelAssets,width:1000,height:600,kind:'box1',state:'BOTTOM_BAR',
      close:{asset:'public.close',x:961,y:15,width:24,height:24,label:'Đóng Boss Thế Giới'},onClose:()=>this.close()});
    this.panel.root.classList.add('m81330-boss-frame');
    this.panel.root.setAttribute('aria-label','Boss Thế Giới');
    this.panel.content.append(element('h1','BOSS THẾ GIỚI','m81330-boss-title'));
    this.body=element('div',null,'m81330-boss-body');
    this.left=element('section',null,'m81330-boss-left');
    this.arena=element('div',null,'m81330-boss-arena');
    const map=assets.worldBoss?.maps?.['40002'],back=map?.background;
    if(back?.url)this.arena.style.backgroundImage=`url("${back.url}")`;
    // The Flash map ships a dedicated, transparent boss illustration. Reuse
    // it verbatim here; body/cannon timeline descriptors belong to the arena.
    if(map?.bossImage?.url){
      const figure=element('div',null,'m81330-boss-portrait');
      figure.append(assetImage(map.bossImage,'Kẻ Hủy Diệt'));
      this.arena.append(figure);
    }
    this.arena.append(element('h2','KẺ HỦY DIỆT'),element('span','Giáp 100 · Giáp năng lượng 100','m81330-boss-defense'));
    this.hp=element('div',null,'m81330-boss-hp');this.hp.setAttribute('role','progressbar');this.hp.setAttribute('aria-label','HP chung của boss');
    this.fill=element('span',null,'m81330-boss-hp-fill');this.hpLabel=element('strong','Đang đồng bộ…');this.hp.append(this.fill,this.hpLabel);
    this.clock=element('p','Đang đồng bộ…','m81330-boss-clock');
    this.mine=element('p','Sát thương của bạn: — · Hạng: —','m81330-boss-mine');
    this.left.append(this.arena,this.hp,this.clock,this.mine);
    const instructions=element('p','Mỗi người một đấu trường, cùng đánh vào HP boss toàn server. Hồi sinh sau 5 giây. Hạ gấu, nhặt đủ 8 năng lượng để dùng E siêu năng.','m81330-boss-rules');
    this.left.append(instructions);
    this.right=element('section',null,'m81330-boss-right');this.right.append(element('h2','BẢNG SÁT THƯƠNG'));
    const table=element('table',null,'m81330-boss-ranking');
    const head=element('thead'),row=element('tr');for(const label of ['Hạng','Nhân vật','Sát thương'])row.append(element('th',label));head.append(row);
    this.ranks=element('tbody');table.append(head,this.ranks);this.right.append(table);
    this.body.append(this.left,this.right);this.panel.content.append(this.body);
    this.rewards=element('section',null,'m81330-boss-rewards');this.rewards.setAttribute('aria-label','Quà tham gia: bảy loại, tám vật phẩm');
    for(const reward of WORLD_BOSS_REWARDS){
      const cell=element('div',null,'m81330-boss-reward');cell.title=`${reward.name} × ${reward.count}`;
      const source=assets.get(`zh_CN/icon/item/${reward.icon}`);
      if(source)cell.append(assetImage(source,reward.name));
      cell.append(element('strong',`×${reward.count}`),element('small',reward.name));this.rewards.append(cell);
    }
    this.rewardMessage=element('p','','m81330-boss-reward-message');this.rewardMessage.setAttribute('role','status');
    this.enter=actionButton('Vào chiến đấu',()=>this.enterBattle(),{className:'m81330-boss-enter',testId:'m30-boss-enter'});
    this.inventory=actionButton('Mở túi đồ',()=>this.onInventory(),{className:'m81330-boss-bag',testId:'m30-boss-bag'});
    this.panel.content.append(this.rewards,this.rewardMessage,this.enter,this.inventory);
    this.host.replaceChildren(this.panel.root);
    this.onKey=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.close();}};
    this.panel.root.addEventListener('keydown',this.onKey);
    this.panel.close.focus();
    this.clockHandle=setInterval(()=>this.renderClock(),250);
  }
  close(){if(this.snapshot?.play?.busy==='worldBossEnter')return;this.onClose();}
  update(snapshot){
    if(this.disposed)return;this.snapshot=snapshot;
    if(snapshot.phase==='ready'&&this.watchedGeneration!==this.client.generation){
      this.watchedGeneration=this.client.generation;this.client.watchWorldBoss('panel',true);
    }
    const view=worldBossView(snapshot),key=JSON.stringify([snapshot.worldBoss?.revision,snapshot.phase,snapshot.play?.busy]);
    this.renderClock();if(key===this.key)return;this.key=key;
    this.hp.setAttribute('aria-valuemin','0');this.hp.setAttribute('aria-valuemax',String(view.maxHp||10000000));
    if(view.hp!==null)this.hp.setAttribute('aria-valuenow',String(view.hp));else this.hp.removeAttribute('aria-valuenow');
    this.fill.style.width=`${100*(view.fraction??0)}%`;
    setText(this.hpLabel,view.hp===null?'Đang đồng bộ…':`${numberText(view.hp)} / ${numberText(view.maxHp)} HP`);
    setText(this.mine,view.state.received?`Sát thương của bạn: ${numberText(view.state.ownDamage)} · Hạng: ${view.state.ownRank||'—'}`:'Sát thương của bạn: — · Hạng: —');
    const rows=view.state.ranks.map(rank=>{
      const tr=element('tr');if(rank.uuid===snapshot.charUuid)tr.classList.add('is-self');
      for(const text of [rank.rank,rank.name,numberText(rank.damage)])tr.append(element('td',text));return tr;
    });
    if(!rows.length){const tr=element('tr'),td=element('td',view.state.received?'Chưa có người gây sát thương.':'Đang tải bảng xếp hạng…');td.colSpan=3;tr.append(td);rows.push(tr);}
    this.ranks.replaceChildren(...rows);
    setText(this.rewardMessage,worldBossRewardText(view.reward));
    this.inventory.disabled=!view.ready||!!snapshot.play?.busy;
    this.panel.close.disabled=snapshot.play?.busy==='worldBossEnter';
  }
  renderClock(){
    if(this.disposed||!this.snapshot)return;const view=worldBossView(this.snapshot);
    setText(this.clock,worldBossStatusText(view));this.enter.disabled=!view.canEnter;
    setText(this.enter,this.snapshot.play?.busy==='worldBossEnter'?'Đang vào trận…':view.state.status===3?'Chờ lượt mới':'Vào chiến đấu');
  }
  enterBattle(){
    if(this.disposed||!worldBossView(this.snapshot).canEnter)return;
    return this.run(()=>this.client.enterWorldBoss());
  }
  dispose(){
    if(this.disposed)return;this.disposed=true;clearInterval(this.clockHandle);
    this.panel.root.removeEventListener('keydown',this.onKey);
    this.client.watchWorldBoss('panel',false);
  }
}
