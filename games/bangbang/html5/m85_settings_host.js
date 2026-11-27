// A single settings surface for the lobby and battle. It lives outside the
// hidden lobby stage and inside the active fullscreen element when necessary.
export function createSettingsSurface({document:doc=globalThis.document,width=726,height=510}={}) {
  const parent=doc.fullscreenElement||doc.body;
  const root=doc.createElement('div');root.className='m8-shell m85-settings-surface';
  root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','Cài đặt');
  const stage=doc.createElement('div');stage.className='m85-settings-stage';root.append(stage);
  const inert=[];
  for(const node of parent.children)if('inert' in node){inert.push([node,node.inert]);node.inert=true;}
  parent.append(root);
  const view=doc.defaultView;
  const resize=()=>{
    const scale=Math.min(1,(root.clientWidth||view.innerWidth)/width,(root.clientHeight||view.innerHeight)/height);
    stage.style.width=`${width}px`;stage.style.height=`${height}px`;
    stage.style.transform=`translate(-50%, -50%) scale(${scale})`;
  };
  const observer=new view.ResizeObserver(resize);observer.observe(root);resize();
  root.addEventListener('keydown',event=>{
    if(event.key!=='Tab')return;
    const controls=[...stage.querySelectorAll('button,input,select,textarea,[tabindex]')]
      .filter(node=>!node.disabled&&node.tabIndex>=0&&node.getClientRects().length);
    if(!controls.length){event.preventDefault();return;}
    const first=controls[0],last=controls.at(-1),active=doc.activeElement;
    if(event.shiftKey&&(active===first||!stage.contains(active))){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&(active===last||!stage.contains(active))){event.preventDefault();first.focus();}
  });
  let disposed=false;
  return {root,stage,resize,dispose(){
    if(disposed)return;disposed=true;observer.disconnect();root.remove();
    for(const [node,previous] of inert)if(node.isConnected)node.inert=previous;
  }};
}
