import {createNativePanel} from './m81_native_panel.js';
import {element, nativeText} from './m8_ui_helpers.js';
import {renderNativePaging} from './m81_num_paging.js';

const NAMES={5500002:'Vòng Sáng Lam',5500004:'Quán Quân Team League',5500005:'Vòng Sáng Tím',
  5500006:'Vòng Sáng Đỏ',5500007:'Vòng Sáng Vàng'};
function at(node,x,y,w,h){Object.assign(node.style,{position:'absolute',left:`${x}px`,top:`${y}px`});
  if(w!=null)node.style.width=`${w}px`;if(h!=null)node.style.height=`${h}px`;return node;}

export function haloChoices(assets,meta,tank) {
  const items=meta?.containers?.['9']?.items||[];
  return [0,...(assets.haloPresentation?.supported||[]).slice().reverse()].map(itemId=>{
    const owned=items.filter(item=>item.templateId===itemId&&item.count>0);
    return {itemId,name:itemId?NAMES[itemId]||nativeText(assets.garage.items?.[itemId]?.name):'Mặc định',
      owned:!itemId||owned.length>0,usable:!itemId||owned.some(item=>item.lifeTime===0),
      selected:(tank.haloId||0)===itemId};
  });
}

/** Original HaloFrame: Box1 NOT_SHADOW, 730x440, three 230px previews.
 * Paging replaces only the horizontal scroller; all tank/halo art is native.
 */
export function renderHaloDialog(garage,stage,tank) {
  const g=garage,close=()=>{if(!g.pending){g.dialog=null;g.status='';g.render();}};
  const overlay=at(element('div',null,'m8-garage-dialog-overlay m812-halo-overlay'),0,0,1000,600);
  overlay.style.zIndex='25';overlay.style.background='rgba(0,20,40,.68)';
  const assets={...g.assets.panels.assets,...g.assets.haloPresentation.assets,'public.close':g.ui('public.close')};
  const title=assets['halo.title'];
  const panel=createNativePanel({assets,width:730,height:440,kind:'box1',state:'NOT_SHADOW',
    title:{asset:'halo.title',x:(730-title.width)/2,y:20,label:'Vòng sáng'},
    close:{asset:'public.close',x:691,y:15,label:'Đóng vòng sáng'},onClose:close});
  at(panel.root,135,80);panel.root.dataset.testid='garage-halo-dialog';
  panel.root.setAttribute('role','dialog');panel.root.setAttribute('aria-modal','true');panel.root.setAttribute('aria-label','Vòng sáng');
  panel.close.disabled=g.pending;panel.close.dataset.testid='garage-dialog-close';
  const backdrop=g.image('halo.backdrop');at(backdrop,(730-assets['halo.backdrop'].width)/2,24);panel.frame.append(backdrop);
  const rows=haloChoices(g.assets,g.snapshot.meta,tank),pages=Math.ceil(rows.length/3);
  const page=Math.max(0,Math.min(g.haloPage||0,pages-1));g.haloPage=page;
  for(const [index,row] of rows.slice(page*3,page*3+3).entries()){
    const card=at(element('article',null,'m812-halo-card'),20+230*index,46,230,344);
    card.dataset.haloId=String(row.itemId);
    const heading=at(element('strong',row.name,'m812-halo-name'),12,15,206,24);card.append(heading);
    const booth=g.image('halo.booth');at(booth,(230-assets['halo.booth'].width)/2,98);card.append(booth);
    card.append(at(g.portrait({...tank,haloId:row.itemId},180,'m812-halo-preview'),25,65,180,180));
    const detail=row.itemId?'Trang trí tank':tank.level>=6?'Vòng sáng cấp 6 gốc':'Không trang bị vòng sáng';
    card.append(at(element('p',detail,'m812-halo-description'),20,253,190,22));
    const ownership=row.selected?'Đang sử dụng':row.usable?'Đã sở hữu':row.owned?'Chưa hỗ trợ vòng sáng có thời hạn':'Chưa sở hữu';
    card.append(at(element('p',ownership,'m812-halo-ownership'),15,279,200,25));
    if(row.selected){const used=g.image('halo.used');card.append(at(used,(230-assets['halo.used'].width)/2,313));}
    else{
      const button=g.nativeButton('halo.useButton',`Dùng ${row.name}`,()=>g.perform(
        ()=>g.client.equipHalo(tank.uuid,row.itemId),'Đã đổi vòng sáng.'),
        {disabled:!row.usable||!g.canMutate(),testId:`garage-halo-${row.itemId}`});
      const bg=assets['halo.useButton'],label=assets['halo.useLabel'];
      button.append(at(g.image('halo.useLabel'),(bg.width-label.width)/2,(bg.height-label.height)/2));
      card.append(at(button,(230-bg.width)/2,307));
    }
    panel.content.append(card);
  }
  panel.content.append(renderNativePaging({assets:g.assets,page,total:pages,
    state:g.haloPaging||(g.haloPaging={}),x:301,y:394,label:'Trang vòng sáng',
    onPage:next=>{if(!g.pending){g.haloPage=next;g.render();}}}));
  if(g.status){const status=at(element('p',g.status,'m812-halo-status'),35,399,230,18);status.setAttribute('role','status');panel.content.append(status);}
  overlay.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close();}});
  overlay.append(panel.root);stage.append(overlay);
}
