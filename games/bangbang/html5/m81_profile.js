import {renderNativePublicProfile} from './m84_profile.js';
import {renderAccountPaging,ACCOUNT_PAGER_GEOMETRY} from './m81_account_paging.js';
import {createNativePanel} from './m81_native_panel.js';
import {panelArt,characterAsset,nativeButton} from './m84_character.js';
import {nativeMilitaryView} from './m8_account_state.js';
import {militaryRankIcon} from './m81_military.js';
/* Public profile/rank presentation. Source: character_info.py and
 * PlayerInfoView / SummerRankFrame. No private inventory or computed scores. */
import {element,assetImage,actionButton,note,nativeText,numberText,textInput,selectInput} from './m8_ui_helpers.js';
export const PROFILE_STATS=[['totalmatchs','Số trận'],['winmatchs','Thắng'],['winpercent','Tỷ lệ thắng'],
 ['escapeprecent','Tỷ lệ rời trận'],['killerkingmatchs','Vua hạ gục'],['assistkingmatchs','Vua hỗ trợ'],['kda_count','KDA'],['destroyer_count','Công phá']];
export function publicProfileTanks(data){return (data?.char_tank||[]).map(t=>({tankId:t.tank_tplt_id,level:t.level,externalId:t.external_id,haloId:t.halo_id,source:t}));}
export function profileStatRows(data,kind='total'){return PROFILE_STATS.map(([key,label])=>[label,data?.char_tech?.[kind]?.[key]??0]);}
export function publicRankRows(data){return Array.isArray(data?.rank)?data.rank:[];}
function at(node,x,y,w,h){Object.assign(node.style,{position:'absolute',left:`${x}px`,top:`${y}px`});if(w!=null)node.style.width=`${w}px`;if(h!=null)node.style.height=`${h}px`;return node;}
function appearance(data){return {name:data.char_name,level:data.char_level,avatarId:data.char_avatar,decorateId:data.char_decorate};}
function metric(label,value){const node=element('div',null,'m81-profile-metric');node.append(element('span',label),element('strong',numberText(value)));return node;}
export function renderPublicProfile(ui,body){return renderNativePublicProfile(ui,body,publicProfileTanks);}
const RANK_ART='zh_CN/gui_summer/controls/rank/';
function rankLevel(ui,level,className='') {
 const host=element('span',null,`m8134-rank-level ${className}`),asset=ui.assets.get(`chrome.charLevel${Number(level)||1}`);
 host.setAttribute('aria-label',`Cấp ${Number(level)||1}`);
 if(asset)host.append(panelArt(ui,asset,0,0,80,40));
 else host.textContent=`Lv.${Number(level)||1}`;
 return host;
}
export function renderLeaderboard(ui,body){
 body.classList.add('m81-leaderboard','m813-character-rank','m8134-character-rank');
 const data=ui.cache.leaderboard,rows=publicRankRows(data),ranked=ui.rankKind==='ranked',loading=ui.loading.has('leaderboard');
 body.append(panelArt(ui,RANK_ART+'title_rank_t.png',371,1,null,null,{alt:'Bảng anh hùng'}));
 const selected=rows.find(row=>String(row.char_uuid)===ui.rankSelected)||rows[0];
 const frame=createNativePanel({assets:ui.assets.panels.assets,kind:'box4',width:420,height:336});body.append(at(frame.root,423,134));
 const header=at(element('div',null,'m8134-rank-header'),425,115,416,22);
 for(const label of ['Hạng','Nhân vật',ranked?'Huy chương':'Quân hàm',ranked?'Điểm':'Sao'])header.append(element('span',label));
 header.setAttribute('aria-hidden','true');body.append(header);
 const list=at(element('div',null,'m8134-rank-list'),425,139,416,320);list.setAttribute('role','list');
 list.setAttribute('aria-label',ranked?'Xếp hạng đấu rank':'Xếp hạng quân hàm');
 if(loading)list.append(note('Đang tải bảng xếp hạng…'));
 else if(data?.queryError)list.append(note(data.queryError,'error'));
 else for(const row of rows){
  const active=row===selected,line=ui.button('',()=>{ui.rankSelected=String(row.char_uuid);ui.render();},
    {className:'m8134-rank-row'+(active?' is-selected':''),testId:'rank-row-'+row.char_oid});
  line.setAttribute('aria-pressed',String(active));
  const order=element('span',String(row.char_rank),'m8134-rank-order');
  if(Number(row.char_rank)>=1&&Number(row.char_rank)<=5){order.textContent='';order.setAttribute('aria-label',`Hạng ${row.char_rank}`);
   order.append(panelArt(ui,`zh_CN/gui_summer/level/rank${String(row.char_rank).padStart(3,'0')}.png`,5,6,40,20));}
  const person=element('span',null,'m8134-rank-person'),name=element('span',row.char_name,'m8134-rank-name');
  name.title=row.char_name;person.append(rankLevel(ui,row.char_level),name);
  if(row.is_bot){const bot=element('small','Bot','m8134-rank-bot');person.append(bot);}
  const military=ranked?null:nativeMilitaryView(Number(row.char_point||0),ui.catalog).current;
  const medalName=ranked?row.rank_name:nativeText(military?.name||row.military_name),medal=element('span',null,'m8134-rank-medal');
  medal.title=medalName||'';
  const icon=ranked?ui.assets.get(ui.assets.flowPresentation?.sectionIcons?.[String(row.rank_type)]):
    ui.assets.get(militaryRankIcon(military?.rankId));
  if(icon){
   // The SWF bitmap includes transparent overhang outside its logical 200px
   // stage. Scale the native stage (RankPlayerRender uses .14), not the sheet.
   if(icon.renderOffset){
    const holder=element('span',null,'m8134-rank-medal-art'),art=ui.assets.menuArt(icon,medalName||'','',{animate:false});
    const scale=Math.min(26/icon.width,26/icon.height);
    Object.assign(art.style,{position:'absolute',left:`${(32-icon.width*scale)/2}px`,top:`${(27-icon.height*scale)/2}px`,transform:`scale(${scale})`,transformOrigin:'0 0'});
    holder.append(art);medal.append(holder);
   }else medal.append(assetImage(icon,medalName||'','m8134-rank-medal-art'));
  }
  medal.append(element('span',medalName||'—'));
  line.append(order,person,medal,element('span',numberText(row.char_point),'m8134-rank-points'));
  line.setAttribute('aria-label',`Hạng ${row.char_rank}, ${row.char_name}${row.is_bot?', bot':''}, ${medalName}, ${row.char_point} ${ranked?'điểm':'sao'}`);
  list.append(line);
 }
 if(!rows.length&&!loading&&!data?.queryError)list.append(note('Chưa có dữ liệu xếp hạng.'));body.append(list);
 const preview=at(element('div',null,'m8134-rank-preview'),36,120,388,350);
 preview.append(panelArt(ui,RANK_ART+'halloffame.jpg',0,0,388,350));
 if(selected&&!loading&&!data?.queryError){
  const tank={tankId:selected.char_maintank,level:selected.char_maintank_l,externalId:selected.char_maintank_e,haloId:selected.halo_id};
  const portrait=ui.assets.portraitForTank(tank,{size:200,animate:true,haloBehindBody:true});
  portrait.classList.add('m8134-rank-tank');preview.append(at(portrait,70,122,200,200));
  const avatar=characterAsset(ui,selected.char_avatar);
  if(avatar)preview.append(panelArt(ui,avatar,175,59,180,240,{className:'m8134-rank-avatar',alt:selected.char_name}));
  preview.append(at(rankLevel(ui,selected.char_level,'m8134-rank-preview-level'),3,5,80,40));
  preview.title=`${selected.char_name} · ${ui.assets.tankName(tank.tankId)}`;
  preview.append(nativeButton(ui,{skin:RANK_ART+'button_viewplayerinfo_t.png',label:selected.is_bot?'Bot trong trận':'Xem hồ sơ',
    x:297,y:303,disabled:!!selected.is_bot,testId:'rank-profile-'+selected.char_oid,
    onClick:()=>{ui.profileIdentity=String(selected.char_oid);ui.fields.profileIdentity=String(selected.char_oid);delete ui.cache.profile;ui.setSection('profile');}}));
 }
 body.append(preview);
 if(data?.amount!=null)ui.rankPages=Math.max(1,Math.ceil(Number(data.amount)/10));
 ui.accountPagerStates ||= {};ui.accountPagerRoots ||= [];
 const pager=renderAccountPaging({host:body,assets:ui.assets.panels.assets,kind:'rank',page:ui.rankPage||0,pages:ui.rankPages||1,state:ui.accountPagerStates.rank||={},onChange:page=>{
  if(ui.loading.has('leaderboard'))return;ui.rankPage=page;delete ui.cache.leaderboard;ui.loadSection();
 }});
 for(const button of pager.querySelectorAll('button')){if(button.dataset.testid==='rank-page-previous')button.dataset.testid='rank-prev';if(button.dataset.testid==='rank-page-next')button.dataset.testid='rank-next';if(loading)button.disabled=true;}
 ui.accountPagerRoots.push(pager);body.append(at(pager,ACCOUNT_PAGER_GEOMETRY.rank.x,ACCOUNT_PAGER_GEOMETRY.rank.y));
 const mine=ui.cache.ownRank,own=at(element('div',null,'m8134-rank-own'),518,481,180,30);
 own.append(element('span','Hạng của tôi:'),element('strong',mine?.total_rank?numberText(mine.total_rank):'—'));body.append(own);
 body.append(at(note(ranked?`Mùa ${data?.season_id||'—'} · 14 ngày · Thắng +150 điểm`:'Quân hàm · Tổng sao tank vĩnh viễn.'),38,487,465,24));
}
