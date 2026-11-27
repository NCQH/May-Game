/* M43 native Guild skill presentation. ClanSkillFrame/ClanSkillItemFrame/
 * ClanSkillRender from guild_20261015: 720×442, 260×90 cards, 71×56 slots.
 * Images are unchanged original PNGs resolved through fileList e0cf9afc…;
 * source and per-image SHA proof accompany the release. No catalog/gameplay edits.
 * Accepted account snapshots own levels, funds, costs, slots and permissions. */
import {element,assetImage,nativeText,numberText} from './m8_ui_helpers.js';
import {createNativePanel} from './m81_native_panel.js';
export const GUILD_ART = Object.freeze({
  "title": {
    "url": "/html5/assets/m81343/guild/title.png",
    "width": 79,
    "height": 27
  },
  "active": {
    "url": "/html5/assets/m81343/guild/active.png",
    "width": 69,
    "height": 18
  },
  "passive": {
    "url": "/html5/assets/m81343/guild/passive.png",
    "width": 65,
    "height": 18
  },
  "slot": {
    "url": "/html5/assets/m81343/guild/slot.png",
    "width": 71,
    "height": 56
  },
  "learn": {
    "url": "/html5/assets/m81343/guild/learn.png",
    "width": 31,
    "height": 18
  },
  "research": {
    "url": "/html5/assets/m81343/guild/research.png",
    "width": 38,
    "height": 19
  },
  "unlock": {
    "url": "/html5/assets/m81343/guild/unlock.png",
    "width": 30,
    "height": 17
  },
  "merit": {
    "url": "/html5/assets/m81343/guild/merit.png",
    "width": 80,
    "height": 18
  },
  "fund": {
    "url": "/html5/assets/m81343/guild/fund.png",
    "width": 60,
    "height": 17
  },
  "label": {
    "url": "/html5/assets/m81343/guild/label.png",
    "width": 82,
    "height": 27
  },
  "progress": {
    "url": "/html5/assets/m81343/guild/progress.png",
    "width": 138,
    "height": 29
  },
  "progressFill": {
    "url": "/html5/assets/m81343/guild/progressFill.png",
    "width": 128,
    "height": 19
  },
  "greenButton": {
    "url": "/html5/assets/m81343/guild/greenButton.png",
    "width": 66,
    "height": 29
  },
  "blueButton": {
    "url": "/html5/assets/m81343/guild/blueButton.png",
    "width": 66,
    "height": 29
  },
  "arrow": {
    "url": "/html5/assets/m81343/guild/arrow.png",
    "width": 23,
    "height": 17
  },
  "help": {
    "url": "/rez/zh_CN/gui_summer/controls/public/93c3eb002f4070b939e29d0a31a90faa.png",
    "width": 16,
    "height": 16
  },
  "learnTab": {
    "url": "/html5/assets/m81343/guild/learnTab.png",
    "width": 34,
    "height": 19
  },
  "researchTab": {
    "url": "/html5/assets/m81343/guild/researchTab.png",
    "width": 37,
    "height": 19
  },
  "tab": {
    "url": "/rez/zh_CN/gui_summer/controls/shop/aad3e32e1bb1a045b0fbe7944bb28556.png",
    "width": 101,
    "height": 33
  },
  "tabSelected": {
    "url": "/rez/zh_CN/gui_summer/controls/shop/ee65004e050b8485cd97ad2013369f3c.png",
    "width": 101,
    "height": 33
  },
  "empty": {
    "url": "/html5/assets/m81343/guild/empty.png",
    "width": 42,
    "height": 42
  },
  "navBlue": {
    "url": "/html5/assets/m81343/guild/navBlue.png",
    "width": 124,
    "height": 46
  },
  "navGreen": {
    "url": "/html5/assets/m81343/guild/navGreen.png",
    "width": 124,
    "height": 46
  }
});
export const GUILD_SKILL_SLOTS = Object.freeze([1,5,6,7,8]);
export const GUILD_SKILL_GEOMETRY = Object.freeze({width:720,height:442,list:[29,90,548,290],card:[260,90],slot:[71,56],slotY:[80,168,228,288,348]});
const at=(n,x,y,w,h)=>{Object.assign(n.style,{position:'absolute',left:`${x}px`,top:`${y}px`,...(w==null?{}:{width:`${w}px`}),...(h==null?{}:{height:`${h}px`})});return n;};
export function guildArt(host,key,x,y,w,h,alt='') {
  const a=GUILD_ART[key],n=at(assetImage(a,alt,'m43-guild-art'),x,y,w??a.width,h??a.height);host.append(n);return n;
}
export function nativeGuildButton(ui,label,handler,{kind='greenButton',icon='',...options}={}) {
  const a=GUILD_ART[kind],button=ui.button(label,handler,{...options,className:`m43-guild-button ${options.className||''}`.trim()});
  button.setAttribute('aria-label',label);button.style.backgroundImage=`url("${a.url}")`;button.style.width=`${a.width}px`;button.style.height=`${a.height}px`;
  if(icon){button.textContent='';const image=assetImage(GUILD_ART[icon],label);image.style.pointerEvents='none';button.append(image);}
  return button;
}
export function guildSkillGroups(catalog) {
  const groups=new Map();
  for(const row of catalog?.guildSkills||[]){const id=Number(row.nGuildSkillId);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(row);}
  // CorpsSkillData.sortIndex orders by native display weight, then skill id.
  return [...groups].map(([id,rows])=>({id,levels:rows.slice().sort((a,b)=>a.nLevel-b.nLevel)}))
    .sort((a,b)=>Number(b.levels[0].nWeight||0)-Number(a.levels[0].nWeight||0)||a.id-b.id);
}
export function availableGuildSkills(account,catalog,slotId) {
  if(!GUILD_SKILL_SLOTS.includes(slotId)||!(account.slotFlags&(1<<slotId)))return [];
  return (catalog?.guildSkills||[]).filter(row=>row.nLevel===Math.min(Number(account.learned?.[row.nGuildSkillId]||0),Number(account.research?.[row.nGuildSkillId]||0))
    && (slotId===1)===[1,2].includes(row.skillType)
    && !Object.values(account.slots||{}).some(slot=>Number(slot.slotId)!==slotId&&Number(slot.skillId)===row.nGuildSkillId));
}
const isOfficer=(ui,account)=>{const id=ui.snapshot.meta?.character?.charUuid;return !!id&&[account.guild?.leaderUuid,account.guild?.viceLeaderUuid].includes(id);};
function currentGuild(ui,guildId) {
  const account=ui.snapshot.account||{};
  if(!account.guild||account.guild.guildId!==guildId)throw new Error('Guild đã thay đổi. Hãy mở lại bảng kỹ năng.');
  return account;
}
function focusTrap(root,event) {
  if(event.key!=='Tab')return;
  const nodes=[...root.querySelectorAll('button,input,select,[tabindex]')].filter(n=>!n.disabled&&!n.hidden&&n.tabIndex!==-1&&!n.closest?.('[hidden]'));
  if(!nodes.length)return;
  if(event.shiftKey&&(document.activeElement===nodes[0]||!root.contains(document.activeElement))){event.preventDefault();nodes.at(-1).focus();}
  else if(!event.shiftKey&&(document.activeElement===nodes.at(-1)||!root.contains(document.activeElement))){event.preventDefault();nodes[0].focus();}
}

/** Sibling of the Guild screen. Host confirmation overlays remain authoritative. */
export function renderNativeGuildSkills(ui,host,account,member,{onClose}={}) {
  const guildId=account.guild.guildId,assets={...ui.assets.panels.assets,...ui.assets.ui.assets,'m43.guildTitle':GUILD_ART.title};
  const mode=ui.fields.guildSkillsTab==='research'?'research':'learn';
  const shade=element('div',null,'m43-guild-skill-shade');
  const panel=createNativePanel({assets,kind:'box1',width:720,height:442,title:{asset:'m43.guildTitle',x:320.5,y:20,label:'Kỹ năng Guild'},
    close:{asset:'public.close',x:681,y:15,label:'Đóng kỹ năng Guild'},onClose});
  const root=panel.root;root.classList.add('m43-guild-skills');root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','Kỹ năng Guild');
  root.dataset.nativeScreen='guild-skills';at(root,149,70,720,442);panel.close.dataset.testid='guild-skills-close';
  const body=panel.content;
  const frame=createNativePanel({assets,kind:'box3',state:'LIGHT_BG',width:570,height:314});at(frame.root,17,78,570,314);body.append(frame.root);
  for(const [key,x,label,icon] of [['learn',35,'Học','learnTab'],['research',133,'Nghiên cứu','researchTab']]){
    const tab=nativeGuildButton(ui,label,()=>{ui.fields.guildSkillsTab=key;delete ui.fields.guildSkillPickerSlot;ui.afterRenderFocus=`guild-skills-tab-${key}`;ui.render();},{kind:key===mode?'tabSelected':'tab',icon,testId:`guild-skills-tab-${key}`,className:'m43-guild-skill-tab'});
    at(tab,x,48,101,33);tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(key===mode));body.append(tab);
  }
  const grid=at(element('div',null,'m43-guild-skill-grid'),29,90,548,290);grid.setAttribute('role','tabpanel');grid.setAttribute('aria-label',mode==='learn'?'Học kỹ năng':'Nghiên cứu kỹ năng');body.append(grid);
  const scrollKey=`guildSkillsScroll-${mode}`;grid.addEventListener('scroll',()=>{ui.fields[scrollKey]=grid.scrollTop;});
  for(const group of guildSkillGroups(ui.catalog)){
    const {id,levels}=group,base=levels[0],learned=Number(account.learned?.[id]||0),researched=Number(account.research?.[id]||0),value=mode==='learn'?learned:researched;
    const max=levels.at(-1).nLevel,next=levels.find(row=>row.nLevel===value+1),current=levels.find(row=>row.nLevel===value)||base;
    const cost=Number(next?.[mode==='learn'?'nNeedMerit':'nResearchFee']||0),coin=Number(mode==='learn'?member?.merit:account.guild.coin),officer=isOfficer(ui,account);
    const card=element('article',null,'m43-guild-skill-card');card.dataset.skillId=String(id);card.tabIndex=0;
    card.title=`${nativeText(base.name)}\n${nativeText(current.description)}\nĐã học: ${learned}/${max} · Guild: ${researched}/${max}`;
    const icon=at(ui.image(base.icon,nativeText(base.name)),7,5,50,50);icon.classList.add('m43-guild-skill-icon');card.append(icon);
    const name=at(element('strong',nativeText(base.name),'m43-guild-skill-name'),63,7,187,20);card.append(name);
    guildArt(card,'progress',59,29);
    if(mode==='learn'&&researched<max){const unavailable=at(element('div',null,'m43-guild-research-cap'),63+128*Math.max(0,Math.min(1,researched/max)),33,128*(1-Math.max(0,Math.min(1,researched/max))),19);card.append(unavailable);}
    const fill=at(element('div',null,'m43-guild-progress-fill'),63,33,128*Math.max(0,Math.min(1,value/max)),19);guildArt(fill,'progressFill',0,0);card.append(fill);
    const progress=at(element('span',`${value}/${max}`,'m43-guild-progress-value'),195,32,55,20);card.append(progress);
    let reason='';
    if(!next)reason='Đã đạt cấp tối đa.';
    else if(mode==='research'&&!officer)reason='Chỉ Chủ hoặc Phó Guild được nghiên cứu.';
    else if(mode==='learn'&&next.nLevel>researched)reason=`Guild cần nghiên cứu cấp ${next.nLevel}.`;
    else if(mode==='learn'&&Number(ui.snapshot.meta?.character?.level||0)<next.nCharLevelMin)reason=`Cần nhân vật cấp ${next.nCharLevelMin}.`;
    else if(mode==='research'&&account.guild.level<next.nNeedGuildLevel)reason=`Cần Guild cấp ${next.nNeedGuildLevel}.`;
    else if(coin<cost)reason=mode==='learn'?'Không đủ cống hiến.':'Không đủ quỹ Guild.';
    else if(!ui.canMutate())reason='Về sảnh hoặc phòng chờ để thay đổi kỹ năng.';
    const costNode=at(element('span',next?`${numberText(cost)} ${mode==='learn'?'cống hiến':'quỹ'}`:'Đã đạt tối đa','m43-guild-skill-cost'),8,62,179,18);
    costNode.classList.toggle('is-short',!!next&&coin<cost);card.append(costNode);
    const button=nativeGuildButton(ui,mode==='learn'?'Học':'Nghiên cứu',()=>{
      if(!next||!ui.canMutate())return;
      ui.confirm(`${mode==='learn'?'Học':'Nghiên cứu'} ${nativeText(base.name)}`,`Lv ${next.nLevel} · ${numberText(cost)} ${mode==='learn'?'cống hiến':'quỹ Guild'}.`,()=>{
        const fresh=currentGuild(ui,guildId),actual=Number((mode==='learn'?fresh.learned:fresh.research)?.[id]||0);
        if(actual!==value)throw new Error('Cấp kỹ năng đã thay đổi. Hãy xác nhận lại cấp mới.');
        if(mode==='research'&&!isOfficer(ui,fresh))throw new Error('Không còn quyền nghiên cứu Guild.');
        return ui.client.guildAction(mode,{skillId:id});
      },{image:base.icon,success:mode==='learn'?'Đã học kỹ năng Guild.':'Đã nghiên cứu kỹ năng Guild.'});
    },{icon:mode==='learn'?'learn':'research',disabled:!!reason,testId:`guild-${mode}-${id}`,title:reason||(mode==='learn'?`Cần nhân vật cấp ${next?.nCharLevelMin}; Guild nghiên cứu cấp ${next?.nLevel}.`:`Cần Guild cấp ${next?.nNeedGuildLevel}.`)});
    at(button,191,57,66,29);card.append(button);grid.append(card);
  }
  guildArt(body,'active',601,56);guildArt(body,'passive',600,144);
  for(const [index,slotId] of GUILD_SKILL_SLOTS.entries()){
    const open=!!(account.slotFlags&(1<<slotId)),y=GUILD_SKILL_GEOMETRY.slotY[index],slot=at(element('div',null,'m43-guild-skill-slot'),600,y,71,56);
    slot.dataset.slotId=String(slotId);guildArt(slot,'slot',0,0);body.append(slot);
    if(!open){
      guildArt(slot,'empty',10,7);const cost=750*index**2;
      const unlock=nativeGuildButton(ui,'Mở ô kỹ năng',()=>ui.confirm('Mở ô kỹ năng',`Tiêu ${numberText(cost)} cống hiến.`,()=>{
        const fresh=currentGuild(ui,guildId);if(fresh.slotFlags&(1<<slotId))throw new Error('Ô kỹ năng đã được mở.');return ui.client.guildAction('unlockSlot',{slotId});
      },{success:'Đã mở ô kỹ năng.'}),{icon:'unlock',disabled:!ui.canMutate()||Number(member?.merit||0)<cost,testId:`guild-unlock-${slotId}`,title:`Mở ô: ${numberText(cost)} cống hiến.`});at(unlock,2.5,13.5,66,29);slot.append(unlock);
    }else{
      const current=account.slots?.[slotId],row=(ui.catalog.guildSkills||[]).find(r=>r.nGuildSkillId===Number(current?.skillId)&&r.nLevel===Number(current?.level));
      const label=slotId===1?'Chọn kỹ năng chủ động':`Chọn kỹ năng bị động ${index}`;
      const choose=ui.button('',()=>{ui.fields.guildSkillPickerSlot=slotId;ui.afterRenderFocus='guild-skill-pick-0';ui.render();},{disabled:!ui.canMutate(),testId:`guild-equip-${slotId}`,className:'m43-guild-slot-button',title:row?`${nativeText(row.name)} · Lv ${row.nLevel}\n${nativeText(row.description)}`:label});at(choose,0,0,71,56);choose.setAttribute('aria-label',label);
      if(row){const image=at(ui.image(row.icon,nativeText(row.name)),3,3,50,50);choose.append(image);}
      guildArt(choose,'arrow',53,25,17.25,12.75);slot.append(choose);
    }
  }
  guildArt(body,'merit',32,400);guildArt(body,'label',115,395);const merit=at(element('span',numberText(member?.merit||0),'m43-guild-currency'),115,399,82,22);merit.setAttribute('aria-label','Cống hiến cá nhân');body.append(merit);
  const help=guildArt(body,'help',203,402);help.title='Cống hiến dùng để học kỹ năng và mở ô bị động.';help.style.pointerEvents='auto';
  guildArt(body,'fund',275,400);guildArt(body,'label',338,395);const fund=at(element('span',numberText(account.guild.coin),'m43-guild-currency'),338,399,82,22);fund.setAttribute('aria-label','Quỹ Guild');body.append(fund);
  let picker=null;
  const selected=Number(ui.fields.guildSkillPickerSlot);
  if(GUILD_SKILL_SLOTS.includes(selected)&&(account.slotFlags&(1<<selected))&&ui.canMutate()){
    picker=renderPicker(ui,body,account,selected,guildId,assets);
    for(const node of [...body.children])if(node!==picker)node.inert=true;
  }
  root.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(picker){delete ui.fields.guildSkillPickerSlot;ui.afterRenderFocus=`guild-equip-${selected}`;ui.render();}else onClose?.();}
    else focusTrap(picker||root,event);
  });
  shade.append(root);host.append(shade);grid.scrollTop=Number(ui.fields[scrollKey]||0);
  return {root,grid,shade,picker};
}
function renderPicker(ui,body,account,slotId,guildId,assets) {
  const index=GUILD_SKILL_SLOTS.indexOf(slotId),panel=createNativePanel({assets,kind:'box3',state:'DARK_BG',width:350,height:164});
  const root=panel.root;root.classList.add('m43-guild-skill-picker');at(root,330,Math.min(250,GUILD_SKILL_GEOMETRY.slotY[index]+32),350,164);
  root.setAttribute('role','dialog');root.setAttribute('aria-label',slotId===1?'Trang bị kỹ năng chủ động':'Trang bị kỹ năng bị động');
  const grid=at(element('div',null,'m43-guild-pick-grid'),16,23,320,120);panel.content.append(grid);
  const close=ui.button('×',()=>{delete ui.fields.guildSkillPickerSlot;ui.afterRenderFocus=`guild-equip-${slotId}`;ui.render();},{testId:'guild-skill-picker-close',className:'m43-guild-picker-close'});at(close,321,1,24,24);close.setAttribute('aria-label','Đóng chọn kỹ năng');panel.content.append(close);
  const title=at(element('strong',slotId===1?'Kỹ năng chủ động':'Kỹ năng bị động'),17,3,275,20);panel.content.append(title);
  const rows=[null,...availableGuildSkills(account,ui.catalog,slotId)];
  for(const row of rows){
    const id=row?.nGuildSkillId||0,label=row?`${nativeText(row.name)} · Lv ${row.nLevel}`:'Bỏ kỹ năng';
    const button=ui.button('',()=>{
      if(!ui.canMutate())return;
      ui.perform(()=>{
        const fresh=currentGuild(ui,guildId);if(!(fresh.slotFlags&(1<<slotId)))throw new Error('Ô kỹ năng chưa mở.');
        const actual=id?availableGuildSkills(fresh,ui.catalog,slotId).find(r=>r.nGuildSkillId===id):null;
        if(id&&!actual)throw new Error('Kỹ năng hoặc ô trang bị đã thay đổi. Hãy chọn lại.');
        delete ui.fields.guildSkillPickerSlot;
        return ui.client.guildAction('equipSkill',{slotId,skillId:id,level:actual?.nLevel||0});
      },'Đã lưu ô kỹ năng.');
    },{testId:`guild-skill-pick-${id}`,className:'m43-guild-pick-option',title:row?`${label}\n${nativeText(row.description)}`:label});
    button.setAttribute('aria-label',label);button.setAttribute('aria-pressed',String(Number(account.slots?.[slotId]?.skillId||0)===id));
    button.append(row?ui.image(row.icon,label):assetImage(GUILD_ART.empty,label));grid.append(button);
  }
  body.append(root);return root;
}
