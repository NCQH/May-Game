/* Native SelectExtraFuncProxy / SelectTankWindow / CorpsSkillSelectProxy.
 * Only the selected owned tank's C427 and active slot1 C322 are exposed here.
 * Talent/PvE, learning, research and passive-slot editing stay in their owners. */
import {element,actionButton,assetImage,selectInput,nativeText} from './m8_ui_helpers.js';
import {createNativePanel} from './m81_native_panel.js';

export const SELECTION_EXTRAS_GEOMETRY=Object.freeze({frame:[457,437,183,67],crystal:[493,447,108,20],guild:[404,435,50,50],switch:[405,485,49,21],popup:[157,448,350,132]});
export function selectionExtrasModel(snapshot,catalog={}) {
  const tank=(snapshot?.meta?.tanks||[]).find(t=>t.containerType===0&&t.tankId===snapshot?.play?.selection?.selectedTankId)||null;
  const boards=Object.values(snapshot?.crystals?.boards||{}).sort((a,b)=>a.boardId-b.boardId);
  const boardId=boards.some(b=>b.boardId===tank?.crystalSchemeId)?tank.crystalSchemeId:boards[0]?.boardId||0;
  const account=snapshot?.account||{},active=account.slots?.[1],skills=catalog.guildSkills||[];
  const used=new Set(Object.values(account.slots||{}).map(slot=>slot.skillId));
  const options=skills.filter(row=>[1,2].includes(row.skillType)&&!used.has(row.nGuildSkillId)&&
    row.nLevel===Math.min(account.learned?.[row.nGuildSkillId]||0,account.research?.[row.nGuildSkillId]||0))
    .map(row=>({...row,requestedLevel:account.learned[row.nGuildSkillId]}));
  // SelectTankWindow.refreshCorpsSkill displays the native default1100 behind
  // the lock when the player has no Guild; saved skills remain owned, not active.
  const current=skills.find(row=>row.nGuildSkillId===(account.guild?active?.skillId:1100)&&row.nLevel===(account.guild?active?.level:1))||null;
  return {tank,boards,boardId,options,current,guildOpen:!!account.guild&&!!(account.slotFlags&2),
    mutable:snapshot?.phase==='ready'&&snapshot?.play?.phase==='selecting'&&!snapshot.play.busy};
}
function at(node,[x,y,w,h]){Object.assign(node.style,{position:'absolute',left:`${x}px`,top:`${y}px`,...(w==null?{}:{width:`${w}px`}),...(h==null?{}:{height:`${h}px`})});return node;}
export function createSelectionExtras({host,client,assets,run=work=>work()}) {
  return new SelectionExtras({host,client,assets,run});
}
class SelectionExtras {
  constructor({host,client,assets,run}) {
    Object.assign(this,{host,client,assets,run,disposed:false,open:false,pending:false,notice:'',epoch:0});
    this.root=element('div',null,'m82-selection-extras');host.append(this.root);
    this.abort=new AbortController();
    host.addEventListener('pointerdown',event=>{if(this.open&&!this.root.contains(event.target)){this.open=false;this.render();}},{signal:this.abort.signal});
    this.root.addEventListener('keydown',event=>{if(event.key==='Escape'&&this.open){event.preventDefault();event.stopPropagation();this.open=false;this.render();this.root.querySelector('[data-testid="selection-guild-switch"]')?.focus({preventScroll:true});}});
    this.root.addEventListener('focusout',event=>{if(this.open&&event.relatedTarget&&!this.root.contains(event.relatedTarget)){this.open=false;this.render();}});
  }
  update(snapshot) {
    if(this.disposed)return;
    const identity=[clientIdentity(snapshot),this.client.generation,snapshot.play?.selection?.sceneId].join('|');
    if(this.identity!==identity){this.identity=identity;this.epoch++;this.pending=false;this.open=false;this.notice='';}
    this.snapshot=snapshot;
    const signature=JSON.stringify([identity,snapshot.phase,snapshot.play?.phase,snapshot.play?.busy,snapshot.play?.selection?.selectedTankId,snapshot.meta?.revision,snapshot.crystals?.revision,snapshot.account?.revision]);
    if(signature!==this.signature){this.signature=signature;if(snapshot.play?.phase!=='selecting')this.open=false;this.render();}
  }
  get model(){return selectionExtrasModel(this.snapshot,this.assets.account);}
  picture(path,rect,alt='') {
    const asset=this.assets.get?.(path)||this.assets.ui?.assets?.[path];if(!asset)return null;
    const image=this.assets.menuArt?this.assets.menuArt(asset,alt):assetImage(asset,alt);return at(image,[rect[0],rect[1],rect[2]??asset.width,rect[3]??asset.height]);
  }
  async mutate(task) {
    if(this.disposed||this.pending||!this.model.mutable)return;
    const epoch=this.epoch;this.pending=true;this.open=false;this.notice='Đang chờ xác nhận…';this.render();
    try {await this.run(async()=>{try{await task();if(!this.disposed&&epoch===this.epoch)this.notice='';}catch(error){if(!this.disposed&&epoch===this.epoch)this.notice=error.message;throw error;}});}
    catch(error){if(!this.disposed&&epoch===this.epoch)this.notice=error.message;}
    finally{if(!this.disposed&&epoch===this.epoch){this.pending=false;this.snapshot=this.client.snapshot();this.render();}}
  }
  render() {
    if(this.disposed||!this.snapshot)return;
    this.root.hidden=this.snapshot.play?.phase!=='selecting';if(this.root.hidden){this.root.replaceChildren();return;}
    const focus=this.root.contains(document.activeElement)?document.activeElement?.dataset?.selectionExtrasFocus:null;
    const model=this.model,disabled=this.pending||!model.mutable,content=[],epoch=this.epoch;
    const current=()=>!this.disposed&&epoch===this.epoch;
    const bg=this.picture('zh_CN/gui_summer/controls/pvp/extra_func_BG.png',SELECTION_EXTRAS_GEOMETRY.frame);if(bg)content.push(bg);
    const label=this.picture('zh_CN/gui_summer/controls/pvp/extra_func_crystal_t.png',[464,449]);
    if(label)content.push(label);else content.push(at(element('span','Tinh thể','m82-selection-crystal-label'),[458,432,130,16]));
    const select=selectInput(model.boards.map(board=>({value:board.boardId,label:nativeText(board.name)||`Bảng ${board.boardId}`})),model.boardId,'Bảng tinh thể của tank đang chọn');
    select.dataset.testid='selection-crystal-board';select.dataset.selectionExtrasFocus='crystal';select.disabled=disabled||!model.tank||!model.boards.length;
    select.addEventListener('change',()=>{if(!current())return;const boardId=Number(select.value),tankUuid=model.tank?.uuid;this.mutate(()=>this.client.setSelectionCrystal(boardId,tankUuid));});content.push(at(select,SELECTION_EXTRAS_GEOMETRY.crystal));
    const open=()=>{if(!current()||disabled||!model.guildOpen)return;this.open=!this.open;this.render();};
    const skill=actionButton('',open,{disabled:disabled||!model.guildOpen,className:'m82-selection-guild-icon',testId:'selection-guild-current'});
    skill.dataset.selectionExtrasFocus='guild';skill.setAttribute('aria-label',!model.guildOpen?'Kỹ năng Guild chưa mở':model.current?nativeText(model.current.name):'Kỹ năng Guild');skill.title=!model.guildOpen?'Tham gia Guild và mở ô kỹ năng chủ động để sử dụng':model.current?`${nativeText(model.current.name)} · Cấp ${model.current.nLevel}`:'Chọn kỹ năng Guild';
    if(model.current?.icon)skill.append(assetImage(model.current.icon));
    if(!model.guildOpen){const locked=this.picture('zh_CN/gui_summer/controls/public/locked.png',[10,5]);if(locked)skill.append(locked);else skill.append(element('span','🔒'));}
    else if(!model.current?.icon)skill.textContent='Guild';content.push(at(skill,SELECTION_EXTRAS_GEOMETRY.guild));
    const button=actionButton('',open,{disabled:disabled||!model.guildOpen,className:'m82-selection-guild-switch',testId:'selection-guild-switch'});button.dataset.selectionExtrasFocus='switch';button.setAttribute('aria-label','Đổi kỹ năng Guild');button.setAttribute('aria-expanded',String(this.open));
    const switchArt=this.assets.ui?.assets?.['selection.switchSkill'];if(switchArt)button.append(assetImage(switchArt));else button.textContent='Đổi';content.push(at(button,SELECTION_EXTRAS_GEOMETRY.switch));
    if(this.notice){const status=at(element('div',this.notice,'m82-selection-extra-status'),[232,512,400,36]);status.setAttribute('role','status');content.push(status);}
    if(this.open){
      const popup=at(element('div',null,'m82-selection-guild-popup'),SELECTION_EXTRAS_GEOMETRY.popup);popup.setAttribute('role','group');popup.setAttribute('aria-label','Chọn kỹ năng Guild');
      const frame=createNativePanel({assets:this.assets.panels.assets,kind:'box3',state:'LIGHT_BG',width:350,height:148});popup.append(at(frame.root,[0,-8]));
      const arrow=this.picture('zh_CN/gui_summer/controls/helper/tankhelper_arrow.png',[254,-18]);if(arrow)popup.append(arrow);
      const list=at(element('div',null,'m82-selection-guild-options'),[17,6,320,120]);list.tabIndex=0;list.dataset.selectionExtrasFocus='options';
      for(const row of model.options){const pick=actionButton('',()=>{if(current())this.mutate(()=>this.client.setSelectionGuildSkill(row.nGuildSkillId,row.requestedLevel));},{disabled,className:'m82-selection-guild-option',title:`${nativeText(row.name)} · Cấp ${row.nLevel}`,testId:`selection-guild-skill-${row.nGuildSkillId}`});pick.setAttribute('aria-label',`${nativeText(row.name)} cấp ${row.nLevel}`);pick.dataset.selectionExtrasFocus=`skill-${row.nGuildSkillId}`;if(row.icon)pick.append(assetImage(row.icon));else pick.append(element('span',nativeText(row.name)));list.append(pick);}
      if(!model.options.length)list.append(element('p','Chưa có kỹ năng khác. Hãy học kỹ năng trong Guild.'));popup.append(list);content.push(popup);
    }
    this.root.replaceChildren(...content);
    if(focus)this.root.querySelector(`[data-selection-extras-focus="${focus}"]`)?.focus({preventScroll:true});
  }
  dispose(){this.disposed=true;this.epoch++;this.abort.abort();this.root.remove();}
}
function clientIdentity(snapshot){return snapshot?.meta?.character?.accountId??snapshot?.accountId??'';}
