// Native source: military_rank_20261015/decompiled/scripts/II/{mxml,view}/tank/militaryRank.
// Display only. Accepted militaryStar and catalog are authoritative; server/military_rank.py
// owns star counting and cumulative combat bonuses. Outer viewport owns scaling.
import {nativeMilitaryView} from './m8_account_state.js';
import {element,assetImage,nativeText,numberText} from './m8_ui_helpers.js';
import {renderCommonBackground,nativeMilitaryClose} from './m82_account_shell.js';
const ROOT='zh_CN/II/tank/militaryRank/';
export const MILITARY_GEOMETRY=Object.freeze({width:1000,height:576,current:[73,43],next:[499,43],progress:[188,84,276,23],
 nodes:[[29,217,6,'phy_arm'],[109,361,7,'eng_arm'],[269,266,3,'ctsis_arm'],[348,408,12,'hpmax'],[503,297,1,'atk']],
 labels:[[6,304],[86,443],[246,348],[325,490],[498,410]]});
const ATTRS={6:'Giáp vật lý',7:'Giáp năng lượng',3:'Xuyên giáp / năng lượng',12:'HP',1:'Công vật lý / năng lượng',14:'Hồi chiêu đánh thường'};
export function militaryRankIcon(rankId){return ROOT+'rank/Junxian'+String(Math.min(33,Math.max(1,Number(rankId)||1))).padStart(2,'0')+'.png';}
export function militaryValue(value,type){return type===2?`${(Number(value)*100).toLocaleString('vi-VN',{minimumFractionDigits:1,maximumFractionDigits:1})}%`:`${Number(value)>=0?'+':''}${numberText(value)}`;}
export function militaryPresentation(stars,catalog){
 const view=nativeMilitaryView(stars,catalog),rows=catalog?.military||[];
 const nextRank=rows.find(row=>row.rankId===view.current?.rankId+1)||null;
 const special=rows.filter(row=>row.attributes.some(a=>a.type===14));
 return {...view,nextRank,target:nextRank||view.current,group:rows.filter(row=>row.rankId===view.current?.rankId).slice(0,5),
  nextActive:rows.find(row=>row.stars>stars&&row.attributes.some(a=>a.type!==14))||null,
  special:special.find(row=>row.stars>stars)||special.at(-1)||null};
}
function at(node,x,y,w,h){Object.assign(node.style,{position:'absolute',left:x+'px',top:y+'px'});if(w!=null)node.style.width=w+'px';if(h!=null)node.style.height=h+'px';return node;}
function art(ui,parent,path,x,y,w,h){const asset=ui.assets?.get?.(path);if(!asset)return null;const img=assetImage(asset,'','m81-military-art');parent.append(at(img,x,y,w??asset.width,h??asset.height));return img;}
function label(parent,text,x,y,w,cls=''){const n=at(element('div',text,'m81-military-label '+cls),x,y,w);parent.append(n);return n;}
function attrDescription(row,special=false){return (row?.attributes||[]).filter(a=>(a.type===14)===special).map(a=>(ATTRS[a.type]||'Thuộc tính')+' '+militaryValue(a.value,a.valueType)).join('\n');}
function node(ui,parent,x,y,kind,active,large=false){
 const w=large?129:94,h=large?114:83,box=at(element('div',null,'m81-military-node'),x,y,w,h);parent.append(box);
 const centered=path=>{const a=ui.assets?.get?.(ROOT+path);if(a)art(ui,box,ROOT+path,(w-a.width)/2,(h-a.height)/2);};
 centered('img_mr_attr_item_'+(large?'b':'m')+'_bk.png');
 if(active)centered('img_mr_attr_item_'+(large?'b':'m')+'_lbk.png');
 const inactive=['atk','ctsis_arm'].includes(kind)?'un_active':'no_active';
 centered('attrIcon/img_'+kind+'_'+(active?'active':inactive)+'.png');
 return box;
}
export function renderNativeMilitary(ui,body){
 body.classList.add('m81-military');body.setAttribute('aria-label','Quân hàm');
 const stars=Number(ui.snapshot.meta?.character?.militaryStar||0),view=militaryPresentation(stars,ui.catalog);
 body.append(renderCommonBackground(ui,1000,576));
 // MilitaryRankFrame inner CommonBG(no_border) keeps its source half-alpha.
 const inner=at(element('div',null,'m81-military-inner'),10,32,980,530);inner.setAttribute('aria-hidden','true');body.append(inner);
 art(ui,body,ROOT+'img_mr_attr_list_bk.png',18,29);art(ui,body,ROOT+'img_mr_attr_bk.png',648,31);
 const title=ui.assets?.get?.(ROOT+'title_mr_sys_t.png');
 if(title)art(ui,body,ROOT+'title_mr_sys_t.png',(1000-title.width)/2,-7);else label(body,'Quân hàm',400,0,200,'is-heading');
 body.append(nativeMilitaryClose(ui,()=>ui.onClose?.(),1000,'military-close','Đóng Quân hàm'));
 if(!view.current){label(body,'Chưa có dữ liệu quân hàm.',40,70,550);return;}
 art(ui,body,militaryRankIcon(view.current.rankId),73,43);art(ui,body,militaryRankIcon(view.target.rankId),499,43);
 label(body,nativeText(view.current.name),53,134,120,'is-centered');label(body,nativeText(view.target.name),479,134,120,'is-centered');
 label(body,'Quân hàm hiện tại',188,62,200,'is-heading');label(body,'Kế tiếp',267,62,200,'is-heading is-right');
 const pgBG=ui.assets?.get?.(ROOT+'img_mr_pr_bk_big.png');
 if(pgBG)art(ui,body,ROOT+'img_mr_pr_bk_big.png',188,84+(23-pgBG.height)/2);
 const ratio=view.target.stars===0?1:stars/view.target.stars;
 // CommonPGBar.imgPG scaleContent=false: reveal native pixels, do not stretch fill.
 const fill=at(element('div',null,'m81-military-progress-fill'),188,84,276*ratio,23);fill.style.overflow='hidden';body.append(fill);
 const pg=ui.assets?.get?.(ROOT+'img_mr_pr_big.png');if(pg)art(ui,fill,ROOT+'img_mr_pr_big.png',0,(23-pg.height)/2);
 label(body,`${numberText(stars)} / ${numberText(view.target.stars)}`,188,84,276,'is-centered');
 const preview=ui.button('Danh sách quân hàm',()=>{ui.militaryPreview=true;ui.militaryPage=0;ui.render();},{testId:'military-preview'});
 const previewArt=ui.assets?.get?.(ROOT+'btn_watch_mr_list_t.png');
 if(previewArt){preview.textContent='';preview.setAttribute('aria-label','Danh sách quân hàm');preview.classList.add('m81-military-preview');preview.append(assetImage(previewArt,''));}
 body.append(at(preview,281,123,previewArt?.width||160,previewArt?.height||27));
 for(const [i,[x,y,type,kind]] of MILITARY_GEOMETRY.nodes.entries()){
  const row=view.group[i];if(!row)continue;
  const n=node(ui,body,x,y,kind,stars>=row.stars,i===4);n.title=`${numberText(row.stars)} sao · ${attrDescription(row)}`;
  label(body,attrDescription(row),...MILITARY_GEOMETRY.labels[i],140,'is-centered');
 }
 label(body,'Thuộc tính quân hàm',722,63,200,'is-heading');
 for(const [i,type] of [6,7,3,12,1,14].entries()){
  label(body,ATTRS[type],646,94+35*i,175,'is-right');
  const total=Object.entries(view.totals).filter(([key])=>Number(key.split(':')[0])===type).reduce((sum,[,v])=>sum+v,0);
  const text=type===14?militaryValue(total,2):type===12?'+'+numberText(total):'+'+total.toFixed(2);
  label(body,text,840,94+35*i,150,'is-total');
 }
 label(body,'Sao quân hàm được máy chủ tính từ sao tank vĩnh viễn trong Garage. Thuộc tính cộng dồn theo các mốc đã đạt.',665,305,305,'is-description');
 if(view.special){art(ui,body,militaryRankIcon(view.special.rankId),674,418);node(ui,body,876,409,'common_cool',false);
  label(body,'Kích hoạt',767,418,110,'is-heading');label(body,attrDescription(view.special,true),853,491,140,'is-centered');
  label(body,stars>=view.special.stars?'Đã kích hoạt toàn bộ mốc đặc biệt.':`Kích hoạt tại ${nativeText(view.special.name)} · ${numberText(view.special.stars)} sao`,651,539,330,'is-centered is-special-trigger');}
 if(view.nextActive)label(body,`Mốc thuộc tính kế tiếp: ${numberText(view.nextActive.stars)} sao`,250,516,360,'is-right');
 if(ui.militaryPreview)renderMilitaryList(ui,body,stars);
}


// MilitaryRankLstFrame: 822×530, eight ranks/page; MilitaryRankItem: 180×197.
export function militaryRankPage(catalog,page=0){
 const rows=[];for(const row of catalog?.military||[])if(!rows.some(r=>r.rankId===row.rankId))rows.push(row);
 const pages=Math.max(1,Math.ceil(rows.length/8));page=Math.max(0,Math.min(pages-1,Math.trunc(Number(page)||0)));
 return {page,pages,rows:rows.slice(page*8,page*8+8)};
}
function renderMilitaryList(ui,body,stars){
 for(const child of body.children)child.inert=true;
 const shade=at(element('div',null,'m81-military-shade'),0,0,1000,576);body.append(shade);
 const frame=at(element('section',null,'m81-military-list'),89,23,822,530);shade.append(frame);frame.setAttribute('role','dialog');frame.setAttribute('aria-label','Danh sách quân hàm');frame.setAttribute('aria-modal','true');
 frame.append(renderCommonBackground(ui,822,530),at(element('div',null,'m81-military-inner'),21,33,780,450));
 const close=()=>{ui.militaryPreview=false;ui.afterRenderFocus='military-preview';ui.render();};
 const title=ui.assets?.get?.(ROOT+'title_mr_list_t.png');if(title)art(ui,frame,ROOT+'title_mr_list_t.png',(822-title.width)/2,-7);
 const closeButton=nativeMilitaryClose(ui,close,822,'military-list-close','Đóng danh sách quân hàm');frame.append(closeButton);
 frame.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();close();}});
 const page=militaryRankPage(ui.catalog,ui.militaryPage);
 for(const [i,row] of page.rows.entries()){
  const card=at(element('div',null,'m81-military-list-item'),39+(i%4)*188,53+Math.floor(i/4)*213,180,197);frame.append(card);
  art(ui,card,ROOT+'img_mr_render_active.png',0,0);const icon=ui.assets?.get?.(militaryRankIcon(row.rankId));if(icon)art(ui,card,militaryRankIcon(row.rankId),(180-icon.width)/2,50);
  label(card,nativeText(row.name),20,177,140,'is-centered');
  if(stars<row.stars){art(ui,card,ROOT+'img_mr_render_no_active.png',0,0);label(card,`Đạt ${numberText(row.stars)} sao để mở`,0,80,180,'is-centered is-total');}
 }
 const move=delta=>{ui.militaryPage=page.page+delta;ui.render();};
 frame.append(at(ui.button('‹',()=>move(-1),{disabled:page.page===0,testId:'military-list-prev'}),339,491,30,28));
 label(frame,`${page.page+1} / ${page.pages}`,374,495,74,'is-centered');
 frame.append(at(ui.button('›',()=>move(1),{disabled:page.page+1===page.pages,testId:'military-list-next'}),453,491,30,28));
 ui.afterRenderFocus='military-list-close';
}
