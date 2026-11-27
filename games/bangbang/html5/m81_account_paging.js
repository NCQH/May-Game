// Separate native account pagers, NOT Garage NumPaging or crystal II controls.
// Sources: ShopFrame/PageNumListFrame(IN_SHOP)/PageNumProxy; PackageComponent
// cvsPage in its 540x400 parent; SummerRankFrame/RankProxyBase. API is zero-based.
import {element,actionButton,assetImage} from './m8_ui_helpers.js';
export const ACCOUNT_PAGER_GEOMETRY=Object.freeze({
 shop:Object.freeze({x:301,y:539,width:616,height:28}),
 bag:Object.freeze({x:193.5,y:308.5,width:153,height:33}),
 rank:Object.freeze({x:706,y:476,width:135,height:40})
});
export function accountPageModel(kind,page,pages,first=0) {
 if(!ACCOUNT_PAGER_GEOMETRY[kind])throw new TypeError('Unknown account pager');
 pages=Math.max(1,Number.isFinite(pages)?Math.floor(pages):1);
 page=Math.max(0,Math.min(pages-1,Number.isFinite(page)?Math.floor(page):0));
 const count=kind==='shop'?Math.min(20,pages):0;
 // Native Shop has exactly twenty slots. Larger future datasets use an explicitly
 // marked overflow window, not an assertion that Flash supported arbitrary slots.
 first=Math.max(0,Math.min(pages-count,Number.isFinite(first)?Math.floor(first):0));
 if(kind==='shop') {if(page<first)first=page;else if(page>=first+count)first=page-count+1;}
 return {kind,page,pages,first,count,overflow:kind==='shop'&&pages>20,
  numbers:Array.from({length:count},(_,i)=>first+i),
  previous:kind==='shop'?(page+pages-1)%pages:Math.max(0,page-1),
  next:kind==='shop'?(page+1)%pages:Math.min(pages-1,page+1)};
}
export function renderAccountPaging({host,assets={},kind,page=0,pages=1,onChange,state={}}) {
 const model=accountPageModel(kind,page,pages,state.first);state.first=model.first;
 const old=state.node,active=typeof document!=='undefined'?document.activeElement:null;
 const focusKey=old?.contains?.(active)?active?.dataset?.pageFocus:null;
 const scroll=host?{left:host.scrollLeft,top:host.scrollTop}:null;
 const root=element('nav',null,`m81-account-paging m81-account-paging-${kind}`);
 root.setAttribute('aria-label',kind==='shop'?'Trang cửa hàng':kind==='bag'?'Trang kho':'Trang bảng xếp hạng');
 const geometry=ACCOUNT_PAGER_GEOMETRY[kind];
 Object.assign(root.style,{position:'absolute',width:`${geometry.width}px`,height:`${geometry.height}px`});
 if(model.overflow)root.dataset.nativeLimit='shop-20-overflow-window';
 const buttons=[];let requested=model.page;
 // No network/mutation here. Ignore a current page and duplicate events before a
 // rerender, including clicks delivered to a detached previous pager.
 function change(target){if(state.node!==root||target===requested||target===model.page||target<0||target>=model.pages)return;requested=target;onChange?.(target);}
 function picture(parent,key,x,y,w,h){
  const asset=assets[key];if(!asset?.url)return false;
  const img=assetImage(asset);Object.assign(img.style,{position:'absolute',left:`${x}px`,top:`${y}px`,width:`${w??asset.width}px`,height:`${h??asset.height}px`,pointerEvents:'none'});
  parent.append(img);return true;
 }
 function button(key,label,target,x,y,w=33,h=29,assetKey){
  const b=actionButton(label,()=>change(target),{disabled:target===model.page,testId:`${kind}-page-${key}`});
  b.dataset.pageFocus=key;b.setAttribute('aria-label',label);
  // Drop only the inherited button box, not the native page-circle/arrow art
  // or the common interactive/focus states.
  Object.assign(b.style,{position:'absolute',left:`${x}px`,top:`${y}px`,width:`${w}px`,height:`${h}px`,padding:'0',minWidth:'0',minHeight:'0',margin:'0',border:'0',borderRadius:'0',boxShadow:'none',background:'transparent',color:'#fff',font:'bold 12px Arial,sans-serif'});
  if(assetKey&&assets[assetKey]?.url){b.textContent='';picture(b,assetKey,0,0,w,h);}
  root.append(b);buttons.push(b);return b;
 }
 if(kind==='shop'){
  const width=model.count*28+60,left=Math.trunc((616-width)/2);
  button('previous','Trang trước',model.previous,left,0,33,29,'paging.btn_s2_prev');
  model.numbers.forEach((p,i)=>{
   const selected=p===model.page;
   const b=button(String(p),`Trang ${p+1}`,p,left+32+28*i,2,24,selected?25:24);
   b.disabled=false;
   b.textContent='';picture(b,`paging.circlepager_${selected?'selected':'blue'}`,0,0,24,selected?25:24);
   const label=element('span',String(p+1));Object.assign(label.style,{position:'absolute',left:'0',top:'3px',width:'24px',height:'24px',textAlign:'center',color:selected?'#126df6':'#fbf8f8',pointerEvents:'none'});b.append(label);
   if(selected)b.setAttribute('aria-current','page');
  });
  button('next','Trang sau',model.next,left+width-33+2.5,-1.5,33,29,'paging.btn_s2_next');
 } else {
  const rank=kind==='rank';
  picture(root,rank?'paging.pager_bk_s':'paging.pager_bk',rank?34:33.5,0,rank?66:86,rank?40:33);
  button('previous','Trang trước',model.previous,0,rank?3:2,33,29,'paging.btn_s2_prev');
  const label=element('span',`${model.page+1}/${model.pages}`);label.setAttribute('aria-current','page');label.setAttribute('aria-live','polite');label.dataset.pageFocus='current';label.tabIndex=-1;
  Object.assign(label.style,{position:'absolute',left:rank?'38px':'48px',top:rank?'6px':'6px',width:'57px',textAlign:'center',color:'#fff',font:`bold ${rank?16:15}px Arial,sans-serif`});root.append(label);
  button('next','Trang sau',model.next,rank?102:120,rank?3:2,33,29,'paging.btn_s2_next');
  buttons.push(label);
 }
 root.restoreFocus=()=>{
  if(state.node!==root)return;
  if(focusKey!=null){const target=buttons.find(b=>b.dataset.pageFocus===focusKey&&!b.disabled)||buttons.find(b=>b.dataset.pageFocus===String(model.page)||b.dataset.pageFocus==='current');if(target?.disabled)target.tabIndex=-1;target?.focus?.({preventScroll:true});}
  if(host&&scroll){host.scrollLeft=scroll.left;host.scrollTop=scroll.top;}
 };
 state.node=root;return root;
}
