/* Local ranked matches: server-owned rating, season, history and map selection. */
import {element,actionButton} from './m8_ui_helpers.js';
import {battleMapName} from './m810_modes.js';
import {rankQueueSeconds} from './m81337_rooms_ui.js';

export function buildRankedPanel(ui,{button,art}){
  const root=element('section',null,'m813-rank-panel');root.dataset.testid='rank-panel';
  const generation=ui.client.generation,account=ui.state.accountId;
  const current=()=>root.isConnected&&generation===ui.client.generation&&account===ui.state.accountId;
  const title=element('h2','Đấu xếp hạng'),season=element('p','Đang đọc mùa giải…','m813-season');
  const card=element('div',null,'m813-rank-card'),badge=element('div',null,'m813-rank-badge'),summary=element('div');
  const rankName=element('h3',''),rating=element('p',''),record=element('p',''),progress=element('progress');
  progress.max=50;progress.setAttribute('aria-label','Tiến độ hạng');summary.append(rankName,rating,progress,record);card.append(badge,summary);
  const description=element('p','Ghép 2 người ở hai phe · Bot bổ sung đủ 5v5 · Bản đồ ngẫu nhiên','m813-rank-description');
  const rule=element('p','Thắng +150 · Thua −15 · Hòa 0 · Khởi đầu 1.000 điểm. Rời trận rank được tính là thua.','m813-rank-rule');
  const rules2=element('p','Chờ tối đa 5 giây; người lẻ đấu với bot. Loại bot tự chọn theo rank. Mỗi mùa 14 ngày.','m813-rank-rule');
  const actions=element('div',null,'m813-rank-actions'),history=element('div',null,'m813-rank-history');history.hidden=true;
  const ranking=actionButton('Bảng xếp hạng',async()=>{
    await ui.navigate('leaderboard');
    if(ui.controller?.section==='leaderboard'){ui.controller.rankKind='ranked';ui.controller.rankPage=0;ui.controller.loadSection();}
  },{testId:'rank-open-leaderboard'});
  const historyButton=actionButton('Lịch sử 20 trận',()=>{history.hidden=!history.hidden;card.hidden=!history.hidden;description.hidden=!history.hidden;rule.hidden=!history.hidden;rules2.hidden=!history.hidden;historyButton.textContent=history.hidden?'Lịch sử 20 trận':'Thông tin mùa';}, {testId:'rank-history-toggle'});
  const refresh=actionButton('Làm mới',()=>load(),{testId:'rank-status-refresh'});actions.append(ranking,historyButton,refresh);
  root.append(title,season,card,description,rule,rules2,actions,history);
  const join=button(ui,'button_red_m','Tìm trận rank',()=>ui.run(()=>ui.state.multiplayer?.queue.active?ui.client.cancelRanked():ui.client.startRanked()),546,442,{testId:'rank-play'});
  const joinCaption=element('span','Tìm trận rank','m81337-rank-caption');join.append(joinCaption);
  const hint=element('p','Ghép người thật trước; đủ thời gian sẽ tự bổ sung bot.','m813-rank-join-hint m81337-rank-hint');hint.setAttribute('role','status');
  ui.content.append(root,art(ui,'quickplay_bk_4',534,429),join,hint);
  let data=null,receivedAt=0,loading=false,stale=false;
  function render(){
    if(!data||data.error)return;
    rankName.textContent=data.challenger?'Thách Đấu':data.section.name;
    rating.textContent=`${data.rating.toLocaleString('vi-VN')} điểm · Hạng ${data.rank||'chưa xếp'}`;
    record.textContent=`${data.played} trận: ${data.wins} thắng · ${data.losses} thua · ${data.draws} hòa`;
    progress.hidden=data.section.type===6;progress.value=data.rating-data.section.threshold;
    badge.replaceChildren();const icon=ui.assets.get(ui.assets.flowPresentation?.sectionIcons?.[String(data.section.type)]);
    if(icon){const art=ui.assets.menuArt(icon,rankName.textContent,'m813-rank-emblem',{animate:false});badge.append(art);}
    history.replaceChildren();
    if(!data.history.length)history.append(element('p','Chưa có trận hoàn tất.'));
    for(const row of data.history){
      const line=element('article',null,'m813-history-row');line.dataset.matchUuid=row.match_uuid;
      const outcome={win:'Thắng',loss:'Thua',draw:'Hòa'}[row.outcome]||row.outcome;
      const when=new Date(row.ended_at*1000).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour12:false});
      const text=`${outcome}${row.forfeit?' (rời trận)':''} · ${row.ranked?'Rank':'So tài'} · ${battleMapName(row.map_id)}`;
      const points=row.ranked?(row.expired_season?'Mùa đã lưu trữ hết hạn':`${row.delta>=0?'+':''}${row.delta} điểm`):'';
      line.append(element('strong',text),element('span',`${when}${points?' · '+points:''}`));
      const self=row.roster.find(p=>p.account_id===account);if(self)line.title=`K/D/A: ${self.kills}/${self.deaths}/${self.assists}`;
      history.append(line);
    }
  }
  async function load(){
    if(loading)return;loading=true;refresh.disabled=true;
    try{
      const next=await ui.client.publicQuery('crankstatus.php',{char:ui.state.meta.character.charUuid||String(account)});
      if(!current())return;data=next;receivedAt=Date.now();stale=false;
      if(data.error)throw new Error(data.error);render();tick();
    }catch(error){if(current())season.textContent=error.message;}finally{loading=false;if(current())refresh.disabled=false;}
  }
  function tick(){
    join.disabled=ui.state.phase!=='ready'||ui.state.play.phase!=='lobby'||!!ui.state.play.busy;
    const queue=ui.state.multiplayer?.queue;
    joinCaption.textContent=queue?.active?'Hủy tìm trận':'Tìm trận rank';
    join.setAttribute('aria-label',joinCaption.textContent);join.title=joinCaption.textContent;
    hint.textContent=queue?.active?(queue.status==='reserved'?'Đã ghép trận. Đang vào chọn tank…':
      `Đang tìm đối thủ · còn ${rankQueueSeconds(ui.state)} giây trước khi ghép bot.`):'Ghép người thật trước; đủ thời gian sẽ tự bổ sung bot.';
    if(!current()||!data?.season)return;
    const now=data.server_time+(Date.now()-receivedAt)/1000,seconds=Math.max(0,Math.ceil(data.season.ends_at-now));
    const days=Math.floor(seconds/86400),hours=Math.floor(seconds%86400/3600),minutes=Math.floor(seconds%3600/60);
    season.textContent=`Mùa ${data.season.id} · Còn ${days} ngày ${hours} giờ ${minutes} phút`;
    if(!seconds&&!stale){stale=true;load();}
  }
  // Load after the complete native hall is attached. No background interval.
  queueMicrotask(load);return {root,tick,load};
}
