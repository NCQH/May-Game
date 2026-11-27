// NumPaging.as + NumPagingProxy.as: 34px pitch, four visible pages in Garage.
// Page numbers below are zero-based internally; labels preserve native one-based values.
import {element,actionButton,assetImage} from './m8_ui_helpers.js';
export function nativePageWindow(page,total,first=0,maximum=4) {
  total=Math.max(1,Number.isFinite(total)?Math.floor(total):1);
  maximum=Math.max(1,Math.min(16,Number.isFinite(maximum)?Math.floor(maximum):4));
  page=Math.max(0,Math.min(total-1,Number.isFinite(page)?Math.floor(page):0));
  const count=Math.min(total,maximum);
  first=Math.max(0,Math.min(total-count,Number.isFinite(first)?Math.floor(first):0));
  if(page>=first+count) first=page-count+1;
  else if(page<first) first=page;
  return {page,total,first,count,width:60+34*count,height:30,pages:Array.from({length:count},(_,i)=>first+i)};
}
export function renderNativePaging({assets,page,total,state={},onPage,label='Trang tank',x=70,y=552}) {
  const model=nativePageWindow(page,total,state.first);state.first=model.first;
  const active=typeof document!=='undefined'?document.activeElement:null;
  const focusKey=state.node?.contains?.(active)?active?.dataset?.pageFocus:null;
  const nav=element('nav',null,'m81-num-paging');nav.setAttribute('aria-label',label);
  Object.assign(nav.style,{position:'absolute',left:`${x}px`,top:`${y}px`,width:`${model.width}px`,height:'30px'});
  const buttons=[];
  function button(text,key,left,width,asset,change,hidden=false) {
    const b=actionButton(text,()=>onPage?.(change),{disabled:hidden,testId:`garage-page-${key}`});
    b.dataset.pageFocus=key;b.hidden=hidden;b.setAttribute('aria-label',text);
    // Only the native circle/arrow is visible. Reset the generic .m8-button
    // frame, while retaining its hover/active/disabled and keyboard focus rules.
    Object.assign(b.style,{position:'absolute',left:`${left}px`,top:'0',width:`${width}px`,height:'29px',padding:'0',border:'0',borderRadius:'0',boxShadow:'none',margin:'0',background:'transparent',minWidth:'0',minHeight:'0',color:'#fff',font:'bold 12px Tahoma,sans-serif'});
    if(asset){b.textContent='';const img=assetImage(asset);Object.assign(img.style,{position:'absolute',left:width===26?'1px':'0',top:width===26?'1px':'0',width:`${asset.width}px`,height:`${asset.height}px`,pointerEvents:'none'});b.append(img);}
    nav.append(b);buttons.push(b);return b;
  }
  const a=assets?.panels?.assets||assets||{};
  button('Trang trước','previous',0,33,a['paging.btn_s2_prev'],model.page-1,model.page===0);
  model.pages.forEach((p,i)=>{
    const b=button(`Trang ${p+1}`,String(p),34*(i+1),26,a[`paging.circlepager_${p===model.page?'selected':'blue'}`],p);
    if(!a[`paging.circlepager_${p===model.page?'selected':'blue'}`])b.textContent='';
    const text=element('span',String(p+1));Object.assign(text.style,{position:'absolute',left:'0',top:'4px',width:'26px',height:'20px',textAlign:'center',pointerEvents:'none'});b.append(text);
    if(p===model.page)b.setAttribute('aria-current','page');
  });
  button('Trang sau','next',model.width-33,33,a['paging.btn_s2_next'],model.page+1,model.page===model.total-1);
  nav.restoreFocus=()=>{if(focusKey!=null)(buttons.find(b=>b.dataset.pageFocus===focusKey&&!b.hidden)||buttons.find(b=>b.dataset.pageFocus===String(model.page)))?.focus();};
  state.node=nav;return nav;
}
