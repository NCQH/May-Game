import {renderNativePaging} from './m81_num_paging.js';
import {renderGarageWizard} from './m81_garage_wizard.js';
import {nativeGarageSkinState} from './m83_tank_presentation.js';
import {bindNativeSkillTooltip,nativeSkinGallery,SKIN_QUALITIES,SKIN_COLORS,
  renderNativeMaterialCard,materialShortageText,nativeUpgradeProgressMiddle} from './m85_tank_ui.js';
/* Native garage presentation. The controller requests existing server mutations
 * by instance UUID and renders only acknowledged meta state. Combat is untouched.
 */
import { element, actionButton, assetImage, nativeText, numberText, note } from './m8_ui_helpers.js';
import { inventoryCount } from './m8_meta_state.js';
import {M88TankLevelEffect,acknowledgedTankAdvance,prepareTankLevelEffect} from './m88_tank_level_fx.js';
import {renderHaloDialog} from './m812_halos.js';
import {TANK_SKIN_CLOSE_LAYOUT as SKIN_CLOSE} from './m81330_room_layout.js';

const GROUP = { 1: 'attack', 2: 'panzer', 3: 'assist', 4: 'panzer', 5: 'attack', 6: 'attack' };
const GROUPS = [['all', 'Tất cả'], ['attack', 'Tấn công'], ['panzer', 'Phòng thủ'], ['assist', 'Hỗ trợ']];
const STATS = [['iHp', 'HP'], ['iAttack', 'Công vật lý'], ['iEgAtk', 'Công năng lượng'],
  ['iArmor', 'Giáp'], ['iEgArmor', 'Kháng năng lượng'], ['iCentesis', 'Xuyên giáp'],
  ['iEgCtsis', 'Xuyên năng lượng'], ['iSpeed', 'Tốc độ']];
const levelKey = (tank) => `${tank.tankId}:${tank.level}`;
const strengthKey = (tank, strength = tank.strengthenLevel) => `${tank.tankId}:${tank.level}:${strength}`;

// Skins change native names/icons only; current server keeps base mechanics.
export function garageSkillDisplay(catalog,tank) {
  const ids=catalog.tanks?.[tank.tankId]?.skills||{},overrides=catalog.skinAttributes?.[tank.externalId]?.skills||{};
  return [ids.nSkill4?'nSkill4':'nSkill3','nSkill1','nSkill2'].map(key=>{
    const base=catalog.skills?.[`${ids[key]}:1`],visual=catalog.skills?.[`${overrides[key]}:1`]||base;
    return base?{...base,name:visual?.name||base.name,icon:visual?.icon||base.icon}:null;
  });
}

export function nativeUpgradeProgressFrame(strength, maximum, frameCount = 102) {
  if (!Number.isInteger(strength) || strength < 0 || !Number.isInteger(maximum) || maximum <= 0) return null;
  // TankUpWindow.TANK_PERCENT_TOTAL_FRAME=101; the source SWF contains102 frames.
  // At zero show its first original (empty) frame; do not shift all states by one.
  return Math.max(1, Math.min(frameCount, Math.floor(strength * 101 / maximum)));
}

export function tankDisplayStats(catalog, tank) {
  const level = catalog.levels?.[levelKey(tank)];
  if (!level) return null;
  const stats = { ...level.stats };
  if (tank.strengthenLevel) {
    const strength = catalog.strengthening?.[strengthKey(tank)];
    if (!strength) return null;
    // server/combat_data.tank_stats adds the current row once, not every past row.
    stats.iHp += strength.hpBonus;
    stats.iAttack += strength.attackBonus;
    stats.iEgAtk += strength.attackBonus;
  }
  return stats;
}

export function tankProgression(catalog, tank, meta) {
  const base = catalog.tanks?.[tank.tankId];
  const unavailable = (reason) => ({ kind: 'unavailable', reason, costs: [], affordable: false, nextTank: null });
  if (!base || base.deferred) return unavailable('Tank này hiện chưa mở nâng cấp.');
  if (tank.containerType !== 0) return unavailable('Chỉ nâng cấp tank đang sở hữu vĩnh viễn.');
  const current = catalog.levels?.[levelKey(tank)];
  if (!current) return unavailable('Chưa có dữ liệu nâng cấp cho cấp hiện tại.');
  const next = catalog.strengthening?.[strengthKey(tank, tank.strengthenLevel + 1)];
  let kind, recipe, rate, nextTank;
  if (next) {
    kind = 'strengthen'; recipe = next.costs; rate = next.winRate;
    nextTank = { ...tank, strengthenLevel: tank.strengthenLevel + 1 };
  } else if (tank.level >= catalog.rules.advanceMaxLevel) {
    return { kind: 'complete', reason: 'Tank đã đạt cấp và cường hóa tối đa.', costs: [], affordable: false, nextTank: null };
  } else {
    if (!catalog.levels?.[`${tank.tankId}:${tank.level + 1}`]) return unavailable('Chưa có dữ liệu cấp kế tiếp.');
    kind = 'advance'; recipe = current.advanceCosts; rate = current.advanceWinRate;
    nextTank = { ...tank, level: tank.level + 1, strengthenLevel: 0, strengthenCount: 0, exp: 0 };
  }
  if (rate !== 100 || !recipe?.length) return unavailable('Công thức nâng cấp hiện chưa được máy chủ hỗ trợ.');
  const costs = recipe.map((cost) => ({ ...cost, owned: inventoryCount(meta, cost.itemId) }));
  return { kind, reason: '', costs, affordable: costs.every((cost) => cost.owned >= cost.count), nextTank, successRate: rate };
}

export function ownedTankSkins(catalog, meta, tank) {
  const definitions = new Map((catalog.skins || []).filter((skin) => skin.tankId === tank.tankId)
    .map((skin) => [skin.itemId, skin]));
  return (meta.containers?.['6']?.items || []).filter((item) => item.count > 0 && definitions.has(item.templateId))
    .map((item) => ({ ...definitions.get(item.templateId), itemUuid: item.uuid, count: item.count,
      lifeTime: item.lifeTime, usable: definitions.get(item.templateId).ready && item.lifeTime === 0,
      name: catalog.items?.[item.templateId]?.name || `Skin ${item.templateId}`,
      icon: catalog.items?.[item.templateId]?.icon || '' }));
}

function positioned(node, x, y, width, height) {
  Object.assign(node.style, { position: 'absolute', left: `${x}px`, top: `${y}px` });
  if (width != null) node.style.width = `${width}px`;
  if (height != null) node.style.height = `${height}px`;
  return node;
}
function textBlock(text, x, y, width, extra = {}) {
  const node = positioned(element('div', text, 'm8-garage-text'), x, y, width);
  Object.assign(node.style, { color: '#fff', fontSize: '13px', lineHeight: '1.35', ...extra });
  return node;
}

// Rebuild ordinary controls while retaining the ancestors of cached artwork.
// Even Element.moveBefore can run a custom element's disconnect callbacks when
// that element has no connectedMoveCallback. Ruffle must remain attached.
function retainArtwork(parent, next, records, animations) {
  const desired=[...next.childNodes].map(child=>{
    const direct=records.find(record=>record.placeholder===child);
    if(direct){direct.used=true;direct.node.style.cssText=child.style.cssText;return direct.node;}
    const ancestors=new Set();
    for(const record of records)if(child.contains?.(record.placeholder)&&parent.contains(record.node)){
      let ancestor=record.node;
      while(ancestor.parentNode&&ancestor.parentNode!==parent)ancestor=ancestor.parentNode;
      if(ancestor.parentNode===parent)ancestors.add(ancestor);
    }
    if(ancestors.size!==1)return child;
    const retained=[...ancestors][0];
    for(const attribute of [...retained.attributes])if(!child.hasAttribute(attribute.name))retained.removeAttribute(attribute.name);
    for(const attribute of child.attributes)retained.setAttribute(attribute.name,attribute.value);
    retainArtwork(retained,child,records,animations);return retained;
  });
  const keep=new Set(desired);
  for(const old of [...parent.childNodes])if(!keep.has(old))old.remove();
  let cursor=parent.firstChild;
  for(const child of desired){
    if(child!==cursor){
      // A rare genuine reorder falls back to a verified player restart.
      if(child.isConnected)animations.beforeReparent(child);
      parent.insertBefore(child,cursor);
    }
    cursor=child.nextSibling;
  }
}

export class M8Garage {
  constructor({ host, client, catalog, assets, run, onClose, onLevelUp=()=>{} }) {
    this.host = host; this.client = client; this.catalog = catalog; this.assets = assets;
    this.run = run || ((task) => task());
    this.onClose=onClose||(()=>{});
    this.onLevelUp=onLevelUp;
    this.selectedUuid = null; this.group = 'all'; this.page = 0;
    this.pending = false; this.status = ''; this.dialog = null; this.portraits = new Map(); this.disposed = false;
    this.tooltipCleanups = [];
    this.epoch=0;this.connectionGeneration=client.generation;this.levelEffect=null;
    prepareTankLevelEffect().catch(()=>{});
  }

  update(snapshot) {
    if (this.disposed) return;
    const identity=snapshot?.accountId??snapshot?.meta?.character?.accountId??null;
    if(identity!==this.identity||this.connectionGeneration!==this.client.generation) {
      this.epoch++;this.identity=identity;this.connectionGeneration=this.client.generation;
      this.releaseLevelEffect();
    }
    this.snapshot = snapshot;
    if(snapshot?.phase!=='ready'||!['lobby','room'].includes(snapshot?.play?.phase))this.releaseLevelEffect();
    const meta = snapshot?.meta;
    if (!meta) return;
    const signature = `${this.epoch}|${meta.revision}|${snapshot.phase}|${snapshot.play?.phase}|${snapshot.play?.busy || ''}|${snapshot.play?.error || ''}`;
    if (this.signature === signature) return;
    this.signature = signature;
    if (!meta.tanks.some((tank) => tank.uuid === this.selectedUuid)) {
      this.selectedUuid = (meta.tanks.find((tank) => tank.selected) || meta.tanks[0])?.uuid || null;
      this.dialog = null;
    }
    this.render();
  }

  canMutate() {
    return !this.pending && !this.levelEffect && !this.snapshot?.play?.busy && this.snapshot?.phase === 'ready'
      && ['lobby', 'room'].includes(this.snapshot?.play?.phase);
  }

  async perform(task, successText, onAcknowledged=null) {
    if (!this.canMutate()) return;
    const epoch=this.epoch,generation=this.client.generation;
    this.pending = true; this.status = 'Đang chờ máy chủ xác nhận…'; this.render();
    try {
      await this.run(async () => {
        try {
          const result = await task();
          if(this.disposed||epoch!==this.epoch||generation!==this.client.generation)return;
          if (result == null) {
            this.status = 'Phiên đã thay đổi, vui lòng kiểm tra lại dữ liệu.';
            return;
          }
          this.status = successText;
          onAcknowledged?.(result);
        } catch (error) {
          this.status = error?.message || 'Máy chủ chưa xác nhận thao tác.';
          throw error;
        }
      });
    } catch (error) {
      this.status = error?.message || 'Máy chủ chưa xác nhận thao tác.';
    } finally {
      this.pending = false;
      if (!this.disposed) this.render();
    }
  }

  ui(key) { return this.assets?.get(key) || this.assets?.ui?.assets?.[key] || null; }
  image(key, alt = '') { return assetImage(this.ui(key), alt); }
  portrait(tankOrExternal, size, className = '') {
    const tank=typeof tankOrExternal==='object'?tankOrExternal:null;
    const externalId=tank?this.external(tank):tankOrExternal;
    const key=[tank?.uuid||externalId,externalId,tank?.level||1,tank?.haloId||0,size,className].join(':');
    let node=this.portraits.get(key);
    if(!node){
      node=this.assets.createPortrait(externalId,{size,className,tank,animate:true});
      this.portraits.set(key,node);
    }
    this.activePortraits.add(key);
    return this.portraitPlaceholder(node);
  }
  external(tank) { return this.assets.tankExternal(tank); }
  name(tank) {
    const skin=(this.catalog.skins||[]).find(row=>row.externalId===tank.externalId);
    return nativeText(this.catalog.items?.[skin?.itemId]?.name||this.catalog.tanks?.[tank.tankId]?.name||this.assets.tankName(tank.tankId));
  }
  movie(key,className='') {
    let node=this.portraits.get(key);
    if(!node){node=this.assets.menuArt(key,'',className);this.portraits.set(key,node);}
    this.activePortraits.add(key);return this.portraitPlaceholder(node);
  }
  portraitPlaceholder(node) {
    const placeholder=node.cloneNode(false);
    this.pendingPortraits.push({node,placeholder});return placeholder;
  }
  nativeButton(key, label, task, { disabled = false, testId = '' } = {}) {
    const asset = this.ui(key);
    const button = actionButton(asset ? '' : label, task, { disabled, title: label, testId, className: 'm8-native-button' });
    button.setAttribute('aria-label', label);
    if (asset) {
      Object.assign(button.style, { padding: '0', border: '0', background: 'transparent', width: `${asset.width}px`, height: `${asset.height}px` });
      button.append(assetImage(asset, ''));
    }
    return button;
  }
  releasePortraits() {
    for (const portrait of this.portraits.values()) portrait?.dispose?.();
    this.portraits.clear();
  }

  releaseLevelEffect() {
    this.levelEffect?.dispose();this.levelEffect=null;
  }
  showLevelEffect(before,packet) {
    const tank=acknowledgedTankAdvance(before,packet,this.catalog.rules.advanceMaxLevel);
    if(!tank||this.disposed||this.snapshot?.phase!=='ready'||!['lobby','room'].includes(this.snapshot?.play?.phase))return;
    this.releaseLevelEffect();
    const effect=new M88TankLevelEffect({tank,externalId:this.external(tank),assets:this.assets,
      onStart:()=>this.onLevelUp(),onFinish:()=>{
      if(this.levelEffect!==effect)return;this.levelEffect=null;if(!this.disposed)this.render();
    }});
    this.levelEffect=effect;this.host.append(effect.root);effect.start();
  }

  render() {
    if (this.disposed || !this.snapshot?.meta) return;
    const focusId=this.host.contains(document.activeElement)?document.activeElement?.dataset?.testid:null;
    for(const dispose of this.tooltipCleanups)dispose();this.tooltipCleanups=[];
    // AvatarLite keeps the loaded MovieClip when its path has not changed.
    // Reuse portrait DOM across state/UI refreshes to retain the native clock.
    this.activePortraits=new Set();this.pendingPortraits=[];
    const stage = element('section', null, 'm8-garage');
    stage.setAttribute('aria-label', 'Gara tank');
    Object.assign(stage.style, { position: 'relative', width: '1000px', height: '600px', color: '#fff' });
    stage.append(positioned(this.image('garage.background'), 0, -8), positioned(this.image('garage.title', 'Gara tank'), 409, -27));
    // A modal skin window owns its close control. Keeping the garage close
    // beneath its translucent backdrop exposes a second, displaced X.
    if (this.dialog !== 'skins') stage.append(positioned(this.nativeButton('public.close','Đóng Gara',()=>this.onClose(),
      {testId:'m83-garage-close'}),971,4));
    this.renderList(stage);
    const tank = this.snapshot.meta.tanks.find((candidate) => candidate.uuid === this.selectedUuid);
    if (tank) this.renderTank(stage, tank);
    else stage.append(textBlock('Chưa nhận được tank đang sở hữu.', 355, 230, 300));
    if (this.status) {
      const status = textBlock(this.status, 320, 577, 660, { fontSize: '12px', textAlign: 'center' });
      status.setAttribute('role', 'status'); stage.append(status);
    }
    if (tank && this.dialog === 'upgrade') this.renderUpgradeDialog(stage, tank);
    if (tank && this.dialog === 'skins') this.renderSkinDialog(stage, tank);
    if (tank && this.dialog === 'halos') renderHaloDialog(this,stage,tank);
    const liveStage=this.stage?.isConnected?this.stage:stage;
    if(liveStage!==stage)retainArtwork(liveStage,stage,this.pendingPortraits,this.assets.menuAnimations);
    else this.host.append(stage);
    for(const {node,placeholder} of this.pendingPortraits){
      if(!placeholder.isConnected)continue;
      node.style.cssText=placeholder.style.cssText;
      const parent=placeholder.parentElement;
      if(node.isConnected)this.assets.menuAnimations.beforeReparent(node);
      parent.insertBefore(node,placeholder);
      placeholder.remove();
    }
    for(const previous of [...this.host.children])if(previous!==liveStage&&previous!==this.levelEffect?.root)previous.remove();
    this.stage=liveStage;
    for(const [key,node] of this.portraits)if(!this.activePortraits.has(key)){
      node?.dispose?.();this.portraits.delete(key);
    }
    this.assets.menuAnimations.refresh();
    this.wizardPanel?.restoreFocus();
    this.pager?.restoreFocus();
    const controls=[...this.host.querySelectorAll('[data-testid]')];
    let focusNode=focusId?controls.find(node=>node.dataset.testid===focusId):null;
    const skinPanel=this.dialog==='skins'?controls.find(node=>node.dataset.testid==='garage-skins-dialog'):null;
    // The opener is still mounted underneath the modal. Restoring its focus
    // sends Escape to the garage instead of the skin overlay in real browsers.
    // Retain focus within the modal on refresh, including its quality tabs.
    if(skinPanel&&!skinPanel.contains(focusNode))
      focusNode=controls.find(node=>node.dataset.testid==='garage-dialog-close'&&!node.disabled)||skinPanel;
    else if(!skinPanel&&!focusNode&&focusId==='garage-dialog-close')
      focusNode=controls.find(node=>node.dataset.testid==='garage-skins-open');
    focusNode?.focus({preventScroll:true});
  }

  renderList(stage) {
    GROUPS.forEach(([key, label], index) => {
      const chosen = this.group === key;
      const button = this.nativeButton(`garage.${key}${chosen ? 'Active' : ''}`, label,
        () => { this.group = key; this.page = 0; this.render(); });
      button.setAttribute('aria-pressed', String(chosen));
      Object.assign(button.style, { width: '72px', height: '35px' });
      const labelAsset = this.ui(`garage.${key}${chosen ? 'Active' : ''}`);
      if (labelAsset && button.firstElementChild) positioned(button.firstElementChild,
        (72 - labelAsset.width) / 2, (35 - labelAsset.height) / 2, labelAsset.width, labelAsset.height);
      const background = this.ui(chosen ? 'garage.categoryActiveBackground' : 'garage.categoryBackground');
      if (background) button.style.background = `url("${background.url}") center/72px 35px no-repeat`;
      stage.append(positioned(button, 18 + index * 70, 42, 72, 35));
    });
    const tanks = this.snapshot.meta.tanks.filter((tank) => {
      const base = this.catalog.tanks?.[tank.tankId];
      return this.group === 'all' || GROUP[base?.classification] === this.group;
    }).sort((a, b) => (this.catalog.tanks?.[a.tankId]?.sortValue ?? 0) - (this.catalog.tanks?.[b.tankId]?.sortValue ?? 0)
      || a.tankId - b.tankId || a.uuid.localeCompare(b.uuid));
    const cells = (this.assets.ui.layouts?.garage?.descriptors || []).filter((d) => /^frmTankCell\d+$/.test(d.id || ''));
    const pageSize = cells.length || 13;
    const pages = Math.max(1, Math.ceil(tanks.length / pageSize));
    this.page = Math.min(this.page, pages - 1);
    let selectedPosition=null,onBattlePosition=null;
    tanks.slice(this.page * pageSize, (this.page + 1) * pageSize).forEach((tank, index) => {
      const position = cells[index];
      if (!position) return;
      const selected = tank.uuid === this.selectedUuid;
      const button = actionButton('', () => { this.selectedUuid = tank.uuid; this.dialog = null; this.status = ''; this.render(); },
        { title: `${this.name(tank)} · Cấp ${tank.level} · Cường hóa ${tank.strengthenLevel}`, testId: `garage-tank-${tank.tankId}`, className: 'm8-garage-cell' });
      button.setAttribute('aria-label', `${this.name(tank)}, cấp ${tank.level}${tank.selected ? ', đang xuất chiến' : ''}`);
      button.setAttribute('aria-pressed', String(selected));
      Object.assign(button.style, { padding: '0', border: '0', background: 'transparent' });
      // Current TankCellFrame is104×117 with a 200px AvatarView scaled.5 at(4,5).
      button.append(positioned(this.image('garage.cellNormal'),0,0,104,117));
      if(tank.skinFrameType===1||tank.skinFrameType===2)
        button.append(positioned(this.image(tank.skinFrameType===2?'garage.cellOrangeFrame':'garage.cellPurpleFrame'),7,6,91,104));
      const avatar=this.portrait(tank,100,'m8-garage-cell-portrait');
      avatar.style.clipPath='polygon(47px 3px,90.30127px 28px,90.30127px 78px,47px 103px,3.69873px 78px,3.69873px 28px)';
      button.append(positioned(avatar,4,5,100,100));
      button.append(positioned(this.image('m85.tank.img_cell_grid2'),31,86,41,23));
      const level=textBlock(String(tank.level),32,87,40,{fontSize:'14px',textAlign:'center',color:'#fdf83a',fontWeight:'700',
        fontFamily:'Tahoma,sans-serif',height:'24px',lineHeight:'20px',textShadow:'0 0 2px #0f578d,0 0 2px #0f578d,0 0 2px #0f578d'});
      level.classList.add('m85-tank-cell-level');button.append(level);
      if(tank.selected)onBattlePosition=position;
      stage.append(positioned(button, position.x, position.y, 104, 117));
      if(selected)selectedPosition=position;
    });
    // TankGarageFrame places selection over the cell grid, then the battle mark.
    if(selectedPosition)stage.append(positioned(this.movie('garage.cellSelection','m83-garage-selection'),selectedPosition.x,selectedPosition.y,104,117));
    if(onBattlePosition)stage.append(positioned(this.image('garage.onBattleLabel','Đang xuất chiến'),onBattlePosition.x+22,onBattlePosition.y+1));
    if (!tanks.length) stage.append(textBlock('Không tìm thấy tank phù hợp.', 25, 130, 260));
    this.pagingState ||= {};
    this.pager=renderNativePaging({assets:this.assets,page:this.page,total:pages,state:this.pagingState,
      onPage:page=>{this.page=page;this.render();}});
    stage.append(this.pager);
  }

  renderTank(stage, tank) {
    const base = this.catalog.tanks[tank.tankId] || {};
    const progress = tankProgression(this.catalog, tank, this.snapshot.meta);
    stage.append(positioned(this.image('garage.tankNameBackground'), 410, 55),
      textBlock(this.name(tank), 372, 58, 234, { fontSize: '16px', fontWeight: '700', textAlign: 'center' }),
      positioned(this.image('garage.tankStage'), 382, 240, 236, 127),
      positioned(this.portrait(tank, 200, 'm8-garage-portrait'), 400, 153, 200, 200),
      positioned(this.image(base.type===1?'garage.typePhysics':'garage.typeEnergy'),375,98,50,50));
    const levelAsset=this.ui(`tank.level${tank.level}`);
    if(levelAsset)stage.append(positioned(this.image(`tank.level${tank.level}`,`Cấp ${tank.level}`),490-levelAsset.width/2,34));
    // Native VN keeps both entry points visible. Their server-backed flows are
    // outside the supported current client actions, so preserve disabled art.
    stage.append(positioned(this.nativeButton('garage.convertItem','Đổi vật phẩm — chưa mở',null,
      {disabled:true,testId:'garage-convert-unavailable'}),618,240),
      positioned(this.nativeButton('garage.halo','Chọn vòng sáng',()=>{this.dialog='halos';this.haloPage=0;this.status='';this.render();},
      {disabled:tank.containerType!==0,testId:'garage-halo-open'}),618,300));
    if (tank.selected) stage.append(positioned(this.image('garage.currentTankLabel', 'Đang xuất chiến'), 476, 378));
    else stage.append(positioned(this.nativeButton('garage.setPrimary', 'Đặt làm tank xuất chiến',
      () => this.perform(() => this.client.setPrimaryTank(tank.uuid), 'Đã đổi tank xuất chiến.'),
      { disabled: !this.canMutate(), testId: 'garage-primary' }), 467, 371.5));

    garageSkillDisplay(this.catalog,tank).forEach((skill, index) => {
      const x = [415, 475, 534][index], y = index === 0 ? 409 : 410;
      if (skill) {
        const img = assetImage(this.assets.get(skill.icon), skill.name);
        img.tabIndex = 0;
        img.dataset.testid=`garage-skill-${index}`;
        stage.append(positioned(img, x, y, 50, 50));
        this.tooltipCleanups.push(bindNativeSkillTooltip(img,stage,skill,this.assets.tankPresentation?.texts));
      }
      const frame=positioned(this.image('garage.skillGrid'), x - 4, y - 4, 58, 57);
      frame.classList.add('m810-garage-skill-frame');
      frame.style.pointerEvents='none';
      stage.append(frame);
    });
    stage.append(positioned(this.image('garage.experienceStage'), 354, 447));
    if(tank.containerType===0)stage.append(textBlock(this.assets.presentation.texts.achievedLevel.replace('@num1@',String(tank.level)),370,510,260,
      {fontSize:'14px',fontWeight:'700',textAlign:'center'}));
    stage.append(positioned(this.nativeButton('garage.upgradeLevel', 'Xem nâng cấp tank',
      () => { this.dialog = 'upgrade'; this.render(); }, { disabled: !['advance', 'strengthen'].includes(progress.kind), testId: 'garage-upgrade-open' }), 434, 529));

    this.wizardState ||= {};
    this.wizardPanel=renderGarageWizard({host:stage,catalog:this.catalog,assets:this.assets,tank,
      stats:tankDisplayStats(this.catalog,tank),state:this.wizardState,onTab:()=>this.render()});
    stage.append(positioned(this.image('garage.skinBackground'), 690, 420));
    if(tank.skinFrameType===1||tank.skinFrameType===2)
      stage.append(positioned(this.image(tank.skinFrameType===2?'garage.skinPreviewOrange':'garage.skinPreviewPurple'),697,427));
    const clock=this.client.lastClock,serverSeconds=clock?clock.packet.serverTimeSeconds+Math.max(0,performance.now()-clock.receivedAt)/1000:null;
    const skinState=nativeGarageSkinState(this.assets.presentation,this.catalog,tank,this.snapshot.meta,serverSeconds);
    if(skinState.recommendedExternalId)stage.append(positioned(this.portrait({...tank,externalId:skinState.recommendedExternalId},100,'m8-garage-skin-preview'),712,431,100,100));
    [['A',2,836,424],['S',3,904,424],['SS',4,836,462],['SSS',5,904,462]].forEach(([label,quality,x,y])=>{
      if(!skinState.qualities.has(quality))return;
      const active=skinState.activeQualities.has(quality);
      const button=this.nativeButton(active?'garage.skinActive':'garage.skinInactive',`Trang phục ${label}`,
        ()=>{this.skinQuality=quality;this.skinScroll=0;this.dialog='skins';this.render();},{testId:`garage-skin-quality-${label}`});
      button.setAttribute('aria-pressed',String(active));
      const key=`garage.quality${label}${active?'':'Inactive'}`,icon=this.ui(key);
      if(icon)button.append(positioned(this.image(key), (66-icon.width)/2,(32-icon.height)/2,icon.width,icon.height));
      stage.append(positioned(button,x,y,66,32));
    });
    if(skinState.frameTip)stage.append(textBlock(skinState.frameTip,706,541,270,{fontSize:'14px',fontWeight:'700',textAlign:'left'}));
    stage.append(positioned(this.nativeButton('garage.skinButton', 'Chọn trang phục tank', () => { this.skinQuality=null;this.skinScroll=0;this.dialog = 'skins'; this.render(); },
      { disabled: tank.containerType !== 0, testId: 'garage-skins-open' }), 842, 501));
    if (!this.canMutate() && !this.pending) stage.append(textBlock('Về sảnh hoặc phòng chờ để đổi tank, nâng cấp và trang phục.', 705, 546, 265, { fontSize: '12px' }));
  }

  dialogFrame(stage, title, width = 720, height = 470) {
    const overlay = positioned(element('div', null, 'm8-garage-dialog-overlay'), 0, 0, 1000, 600);
    Object.assign(overlay.style, { background: 'rgba(0,20,40,.68)', zIndex: '20' });
    const dialog = positioned(element('section', null, 'm8-garage-dialog'), (1000 - width) / 2, (600 - height) / 2, width, height);
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', title);
    Object.assign(dialog.style, { boxSizing: 'border-box', padding: '25px 30px', color: '#fff', overflow: 'auto',
      background: '#126596', border: '3px solid #bfe6ed', borderRadius: '14px', boxShadow: '0 8px 40px #001b35' });
    const close = this.nativeButton('public.close', 'Đóng', () => { if (!this.pending) { this.dialog = null; this.render(); } },
      { disabled: this.pending, testId: 'garage-dialog-close' });
    dialog.append(positioned(close, width - 42, 7), element('h2', title));
    overlay.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !this.pending) { this.dialog = null; this.render(); } });
    overlay.append(dialog); stage.append(overlay);
    return dialog;
  }

  renderUpgradeDialog(stage, tank) {
    const progress = tankProgression(this.catalog, tank, this.snapshot.meta);
    const title = progress.kind === 'advance' ? `Nâng cấp ${this.name(tank)}` : `Cường hóa ${this.name(tank)}`;
    // Current GameUILayerModuleFactory/mxml.tank.TankUPFrame is 630×519.
    // Child coordinates below include cvsDisplayTank (12,50) and cvsProgress (15,240).
    const overlay = positioned(element('div', null, 'm8-garage-dialog-overlay'), 0, 0, 1000, 600);
    Object.assign(overlay.style, { background: 'rgba(0,20,40,.68)', zIndex: '20' });
    const dialog = positioned(element('section', null, 'm8-garage-upgrade-dialog'), 185, 40.5, 630, 519);
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', title);
    dialog.dataset.testid = 'garage-upgrade-dialog';
    const placeImage = (key, x, y, width, height) => dialog.append(positioned(this.image(key), x, y, width, height));
    placeImage('upgrade.background', 0, 0, 630, 519);
    placeImage('upgrade.shadow', 14, 46);
    placeImage('upgrade.light', 30, 50);
    placeImage('upgrade.title', (630 - (this.ui('upgrade.title')?.width || 80)) / 2, 19);
    placeImage('upgrade.arrow', 159, 53);
    for (const y of [78, 108, 138, 168]) placeImage('upgrade.attributeBackground', 222, y);
    placeImage('upgrade.grayShadow', 10, 345);
    placeImage('upgrade.itemTitle', 260, 340);
    dialog.append(positioned(this.nativeButton('public.close', 'Đóng cửa sổ nâng cấp',
      () => { if (!this.pending) { this.dialog = null; this.render(); } },
      { disabled: this.pending, testId: 'garage-upgrade-close' }), 589, 15));
    overlay.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !this.pending) { this.dialog = null; this.render(); } });
    overlay.append(dialog); stage.append(overlay);
    if (!['strengthen', 'advance'].includes(progress.kind)) {
      placeImage('upgrade.maxLevel', 246, 395);
      dialog.append(textBlock(progress.reason, 60, 440, 510, { textAlign: 'center' }));
      return;
    }
    const before = tankDisplayStats(this.catalog, tank), after = tankDisplayStats(this.catalog, progress.nextTank);
    dialog.append(positioned(this.portrait(tank, 200, 'm8-upgrade-portrait'), 12, 50, 200, 200));
    const badge = (key, centerOffset, label) => {
      const asset = this.ui(key);
      if (!asset) return false;
      const image = this.image(key, label); image.title = label;
      // Native cvsDisplayTank(12,50), width606/height200, verticalCenter=-85.
      dialog.append(positioned(image, 12 + 303 + centerOffset - asset.width / 2,
        50 + 100 - 85 - asset.height / 2, asset.width, asset.height));
      return true;
    };
    if (!badge(`tank.level${tank.level}`, -66, `Cấp ${tank.level}`))
      dialog.append(textBlock(`Cấp ${tank.level}`, 230, 53, 70, { fontSize: '12px' }));
    if (!badge(`upgrade.rank${tank.strengthenLevel}`, -6, `Cường hóa ${tank.strengthenLevel}`))
      dialog.append(textBlock(`+${tank.strengthenLevel}`, 300, 53, 60, { fontSize: '12px' }));
    const nextBadge = progress.kind === 'advance' ? `tank.level${progress.nextTank.level}` : `upgrade.rank${progress.nextTank.strengthenLevel}`;
    if (!badge(nextBadge, 209, `Cấp ${progress.nextTank.level} · Cường hóa ${progress.nextTank.strengthenLevel}`))
      dialog.append(textBlock(`Cấp ${progress.nextTank.level} · +${progress.nextTank.strengthenLevel}`, 465, 53, 140, { fontSize: '12px' }));
    if (before && after) {
      // TankInstanceTool.getDamage chooses nType1 physical, otherwise energy.
      const texts=this.assets.tankPresentation?.texts||{};
      const rows = [['iHp', texts.hp||'HP:'], [this.catalog.tanks[tank.tankId].type === 1 ? 'iAttack' : 'iEgAtk', texts.attack||'TC:'],
        ['iArmor', texts.armor||'Giáp:'], ['iEgArmor', texts.shield||'Khiên:']];
      rows.forEach(([key, label], index) => {
        const y = 80 + index * 30;
        dialog.append(textBlock(label, 230, y, 50, { fontSize: '14px', fontWeight: '700' }),
          textBlock(String(Math.trunc(before[key])), 280, y, 50, { fontSize: '14px', textAlign: 'right', fontWeight: '700' }),
          textBlock(String(Math.trunc(after[key])), 502, y, 50, { fontSize: '14px', fontWeight: '700', color: Math.trunc(after[key]) > Math.trunc(before[key]) ? '#defc76' : '#fff' }));
      });
    }
    placeImage('upgrade.progress', 54, 240);
    placeImage('upgrade.progressLabel', 250, 249);
    // imgNextLevelOverBar belongs to cvsProgress(15,240), at(538,30).
    if(tank.level<this.catalog.rules.advanceMaxLevel)placeImage(`tank.level${tank.level+1}`,553,270);
    const maximum = Math.max(tank.strengthenLevel, ...Object.values(this.catalog.strengthening)
      .filter((row) => row.tankId === tank.tankId && row.tankLevel === tank.level).map((row) => row.strengthenLevel));
    const percent = maximum > 0 ? Math.floor(tank.strengthenLevel * 100 / maximum) : 100;
    const nativeProgress = this.assets.ui.stateFrames?.['upgrade.progress'];
    const progressAtlas = nativeProgress ? this.ui(nativeProgress.assetKey) : null;
    const frameNumber = nativeUpgradeProgressFrame(tank.strengthenLevel, maximum, nativeProgress?.frames.length || 102);
    const frame = nativeProgress?.frames.find((candidate) => candidate.frame === frameNumber);
    if (progressAtlas && frame) {
      const fill = positioned(element('span', null, 'm8-upgrade-native-progress'), 60, 272, frame.width, frame.height);
      Object.assign(fill.style, { backgroundImage: `url("${progressAtlas.url}")`, backgroundRepeat: 'no-repeat',
        backgroundPosition: `${-frame.x}px ${-frame.y}px`, backgroundSize: `${progressAtlas.width}px ${progressAtlas.height}px` });
      const middle=nativeUpgradeProgressMiddle(this.assets.tankPresentation,frameNumber),bitmap=middle&&this.ui(middle.assetKey);
      if(bitmap){
        const nativeMiddle=positioned(element('span'),middle.x,middle.y,middle.width,middle.height);
        nativeMiddle.dataset.testid='garage-upgrade-progress-middle';nativeMiddle.setAttribute('aria-hidden','true');
        Object.assign(nativeMiddle.style,{backgroundImage:`url("${bitmap.url}")`,backgroundRepeat:'repeat-x',
          backgroundSize:`${bitmap.width}px ${bitmap.height}px`,pointerEvents:'none'});
        fill.append(nativeMiddle);
      }
      fill.dataset.nativeFrame = String(frameNumber); dialog.append(fill);
    }
    dialog.append(textBlock(`${percent}%`, 334, 247, 60, { fontSize: '14px', fontWeight: '700', textAlign: 'center' }));
    const badges = positioned(element('div', null, 'm8-upgrade-ranks'), 55, 294, 500, 18);
    Object.assign(badges.style, { display: 'flex', justifyContent: 'center', alignItems: 'center',
      gap: `${maximum ? Math.max(0, (500 - 43 * maximum) / maximum) : 0}px` });
    for (let rank = 1; rank <= Math.min(maximum, 10); rank += 1) {
      const image = this.image(`upgrade.rank${rank}`, `Cường hóa ${rank}`);
      Object.assign(image.style, { width: '43px', height: '18px', flex: 'none' }); badges.append(image);
    }
    dialog.append(badges);
    // Material boxes are centered exactly as TankUpWindow.refreshConsumItemListPos.
    const startX = (630 - progress.costs.length * 100) / 2;
    progress.costs.forEach((cost, index) => {
      const definition = this.catalog.items[cost.itemId];
      const x = startX + index * 100;
      dialog.append(renderNativeMaterialCard({assets:this.assets,definition,cost,x,onInspect:()=>{
        this.status=`${nativeText(definition?.name||`Vật phẩm ${cost.itemId}`)}: ${cost.owned}/${cost.count}. ${nativeText(definition?.description||'')}`;
        this.render();
      }}));
    });
    if(progress.costs.length<3)placeImage('upgrade.wayTip',451,371);
    const message = this.status || (!progress.affordable ? 'Chưa đủ nguyên liệu.' : '');
    const status = textBlock(message, 25, 315, 580, { fontSize: '11px', textAlign: 'center',color:'#fff',lineHeight:'14px' });
    status.classList.add('m85-upgrade-status');
    status.setAttribute('role', 'status'); dialog.append(status);
    const label = progress.kind === 'advance' ? 'Nâng cấp' : 'Cường hóa';
    // TankUpWindow enables this entry until the last level. Check the current
    // acknowledged inventory on click; shortage is visible, never an item grant.
    const disabled = !this.canMutate();
    placeImage('upgrade.buttonBackground', 250, 465);
    const submit = this.nativeButton(disabled ? 'public.gray120' : 'public.green120', label,
      () => {
        const current=this.snapshot?.meta?.tanks?.find(row=>row.uuid===tank.uuid);
        const latest=current&&tankProgression(this.catalog,current,this.snapshot.meta);
        if(!latest||!['advance','strengthen'].includes(latest.kind))return;
        if(!latest.affordable){this.status=`Chưa đủ nguyên liệu. ${materialShortageText(latest.costs,this.catalog)}`;this.render();return;}
        const before={...current};
        this.perform(()=>latest.kind==='advance'?this.client.advanceTank(tank.uuid):this.client.strengthenTank(tank.uuid),
          latest.kind==='advance'?'Máy chủ đã xác nhận nâng cấp tank.':'Máy chủ đã xác nhận cường hóa tank.',
          latest.kind==='advance'?packet=>this.showLevelEffect(before,packet):null);
      },
      { disabled, testId: 'garage-upgrade-confirm' });
    submit.append(positioned(this.image(disabled ? 'upgrade.upIconDisabled' : 'upgrade.upIcon'), 27, 6, 66, 23));
    dialog.append(positioned(submit, 254, 469, 120, 35));
  }

  renderSkinDialog(stage, tank) {
    const overlay=positioned(element('div',null,'m8-garage-dialog-overlay'),0,0,1000,600);
    Object.assign(overlay.style,{background:'rgba(0,20,40,.68)',zIndex:'20'});
    const dialog=positioned(element('section',null,'m85-tank-skins'),2,30,996,570);
    dialog.dataset.testid='garage-skins-dialog';dialog.setAttribute('role','dialog');
    dialog.tabIndex=-1;
    dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',`Trang phục · ${this.name(tank)}`);
    const art=(name,x,y)=>{const asset=this.ui(`m85.tank.${name}`);if(asset)dialog.append(positioned(this.image(`m85.tank.${name}`),x,y,asset.width,asset.height));};
    art('tank_skin_view_BG',0,0);art('tank_skin_title_t',400,-21);art('tank_skin_attr_BG',22,44);
    const close=()=>{if(!this.pending){this.dialog=null;this.status='';this.render();}};
    dialog.append(positioned(this.nativeButton('public.close','Đóng trang phục',close,
      {disabled:this.pending,testId:'garage-dialog-close'}),
      SKIN_CLOSE.frameWidth-SKIN_CLOSE.right-SKIN_CLOSE.width,SKIN_CLOSE.top,SKIN_CLOSE.width,SKIN_CLOSE.height));
    overlay.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}});
    const clock=this.client.lastClock,seconds=clock?clock.packet.serverTimeSeconds+Math.max(0,performance.now()-clock.receivedAt)/1000:null;
    const all=nativeSkinGallery(this.catalog,this.snapshot.meta,tank,this.assets.presentation,seconds);
    const quality=this.skinQuality||0,available=new Set(all.filter(row=>row.itemId).map(row=>row.quality));
    const tabs=SKIN_QUALITIES.filter(([value])=>value===0||available.has(value));
    tabs.forEach(([value,label],index)=>{
      const selected=quality===value,key=`m85.tank.btn_${selected?'seleted':'unselet'}_${label.toLowerCase()}_t`;
      const button=this.nativeButton(`m85.tank.btn_skin_${selected?'selected':'unselect'}`,label,
        ()=>{this.skinQuality=value;this.skinScroll=0;this.status='';this.render();},{testId:`garage-skin-tab-${label}`});
      button.setAttribute('role','tab');button.setAttribute('aria-selected',String(selected));
      const icon=this.ui(key);if(icon)button.append(positioned(this.image(key),(76-icon.width)/2,(39-icon.height)/2,icon.width,icon.height));
      dialog.append(positioned(button,260+index*82,50,76,39));
    });
    art('tank_skin_attr_total_t',66,51);
    dialog.append(textBlock('HP +0%  TC +0%',32,77,205,{fontSize:'14px',fontWeight:'700',textAlign:'center',color:'#ffe000'}));
    SKIN_QUALITIES.filter(([value])=>value).forEach(([value,label],index)=>{
      const owned=all.some(row=>row.itemId&&row.quality===value&&row.owned),y=99+index*49;
      dialog.append(textBlock(`Có skin cấp ${label}`,32,y,154,{fontSize:'14px',fontWeight:'700',color:owned?'#fff':'#a5c5da'}),
        textBlock('Không cộng chỉ số',32,y+25,205,{fontSize:'12px',fontWeight:'700',color:owned?'#fff':'#a5c5da'}));
      dialog.append(textBlock(owned?'Đã sở\nhữu':'Chưa sở\nhữu',204,y+2,39,{fontSize:'8px',fontWeight:'700',textAlign:'center',
        whiteSpace:'pre-line',lineHeight:'9.5px',height:'19px',overflow:'hidden',color:owned?'#ffa866':'#a5c5da'}));
    });
    art('tank_skin_attr_other_t',76,311);
    const ownedQualities=new Set(all.filter(row=>row.itemId&&row.owned).map(row=>row.quality));
    const frame=tank.skinFrameType===2?'Khung Cam':tank.skinFrameType===1?'Khung Tím':'Chưa có khung';
    dialog.append(textBlock(`Sở hữu ${ownedQualities.size} cấp skin`,32,351,207,{fontSize:'14px',fontWeight:'700',color:'#ffa866'}),
      textBlock(frame,32,378,207,{fontSize:'14px',fontWeight:'700',color:'#ffa866'}),
      textBlock('Skin thay đổi ngoại hình và hiệu ứng. Chỉ số chiến đấu giữ theo tank.',32,421,207,
        {fontSize:'13px',fontWeight:'700',lineHeight:'22px',color:'#b5d5e7'}));
    const rows=all.filter(row=>!quality||row.quality===quality);
    const maximum=Math.max(0,rows.length-3);this.skinScroll=Math.max(0,Math.min(maximum,this.skinScroll||0));
    const list=positioned(element('div',null,'m85-skin-list'),260,115,690,380);
    list.setAttribute('aria-label','Danh sách trang phục tank');
    rows.slice(this.skinScroll,this.skinScroll+3).forEach((skin,index)=>{
      const card=positioned(element('section',null,'m85-skin-card'),index*230,0,230,380);
      card.dataset.skinItemId=String(skin.itemId);
      if(skin.levelLook)card.dataset.levelLookExternalId=String(skin.externalId);
      const booth=this.ui('m85.tank.booth');if(booth)card.append(positioned(this.image('m85.tank.booth'),(230-booth.width)/2,98,booth.width,booth.height));
      card.append(positioned(this.portrait({...tank,externalId:skin.externalId},200,'m85-skin-portrait'),15,50,200,200),
        textBlock(skin.name,0,15,230,{fontSize:'14px',fontWeight:'700',textAlign:'center',color:SKIN_COLORS[skin.quality]||'#fff'}));
      if(skin.itemId){
        const image=this.ui('m85.tank.tank_skin_quality_titile_t');
        if(image)card.append(positioned(this.image('m85.tank.tank_skin_quality_titile_t'),120-image.width,246,image.width,image.height));
        card.append(textBlock(SKIN_QUALITIES.find(([value])=>value===skin.quality)?.[1]||'',126,246.5,100,
          {fontSize:'16px',fontWeight:'700',color:SKIN_COLORS[skin.quality]||'#fff'}));
      }
      if(skin.active){
        const image=this.ui('m85.tank.ico_used_t');
        if(image)card.append(positioned(this.image('m85.tank.ico_used_t','Đang dùng'),(230-image.width)/2,295,image.width,image.height));
        else card.append(textBlock('Đang dùng',65,295,100,{textAlign:'center'}));
      }else if(skin.owned){
        const button=this.nativeButton('m85.tank.button_2_ss_green','Sử dụng',()=>{
          if(!skin.usable){this.status=skin.lifeTime?'Trang phục có hạn hiện chưa được máy chủ hỗ trợ.':'Trang phục này còn thiếu tài nguyên gốc, chưa thể sử dụng.';this.render();return;}
          this.perform(()=>this.client.equipTankSkin(tank.uuid,skin.equipmentToken??skin.itemUuid),
            skin.levelLook?`Đã chọn ngoại hình ${skin.name}.`:skin.itemId?'Đã trang bị trang phục.':'Đã trở về trang phục gốc.');
        },{disabled:!this.canMutate(),testId:skin.levelLook?`garage-level-look-${skin.externalId}`:skin.itemId?`garage-skin-${skin.itemId}`:'garage-skin-remove'});
        button.append(positioned(this.image('m85.tank.w1_use_t'),15.5,5,35,19));
        card.append(positioned(button,82,295,66,29));
      }else card.append(textBlock(skin.levelLook?skin.reason:'Chưa sở hữu',15,295,200,{textAlign:'center',fontSize:'13px',color:'#c4dfed'}));
      list.append(card);
    });
    dialog.append(list);
    const scroll=positioned(element('div',null,'m85-skin-scroll'),260,516,690,19);
    const move=delta=>{this.skinScroll=Math.max(0,Math.min(maximum,this.skinScroll+delta));this.render();};
    const arrow=(part,delta,label,testId)=>{
      const button=this.nativeButton(`m85.tank.scrollbar_${part}`,label,()=>move(delta),{disabled:!maximum,testId});
      button.classList.add('m85-skin-scroll-arrow');return button;
    };
    scroll.append(positioned(arrow('up',-1,'Trang phục trước','garage-skin-prev'),0,0,19,19),
      positioned(arrow('down',1,'Trang phục sau','garage-skin-next'),671,0,19,19));
    const slider=positioned(element('input',null,'m85-skin-scroll-range'),19,0,652,19);
    slider.type='range';slider.min='0';slider.max=String(maximum);slider.step='1';slider.value=String(this.skinScroll);
    slider.disabled=maximum===0;slider.setAttribute('aria-label','Cuộn danh sách trang phục');slider.dataset.testid='garage-skin-scroll';
    const thumbWidth=Math.max(38,Math.min(652,652*3/Math.max(3,rows.length)));
    slider.style.setProperty('--m85-thumb-width',`${thumbWidth}px`);
    const track=this.ui('m85.tank.scrollbar_bk'),thumb=this.ui('m85.tank.scrollbar_block');
    // Flex rotates the same vertical scrollbar skin into the horizontal list.
    // Keep its actual image pixels instead of painting a substitute CSS bar.
    const rotated=(asset,length)=>{
      const img=assetImage(asset,'');Object.assign(img.style,{position:'absolute',left:'0',top:'19px',width:'19px',height:`${length}px`,
        transform:'rotate(-90deg)',transformOrigin:'0 0',maxWidth:'none',maxHeight:'none',pointerEvents:'none'});return img;
    };
    if(track){const visual=positioned(element('span'),19,0,652,19);visual.append(rotated(track,652));scroll.append(visual);}
    const thumbVisual=positioned(element('span',null,'m85-skin-scroll-thumb'),19,0,thumbWidth,19);
    if(thumb)thumbVisual.append(rotated(thumb,thumbWidth));
    const updateThumb=()=>{thumbVisual.style.left=`${19+(maximum?(652-thumbWidth)*Number(slider.value)/maximum:0)}px`;};
    updateThumb();scroll.append(thumbVisual);
    slider.addEventListener('input',updateThumb);
    slider.addEventListener('change',()=>{this.skinScroll=Number(slider.value);this.render();});scroll.append(slider);dialog.append(scroll);
    const message=positioned(element('div',this.status||(!rows.length?'Chưa có trang phục ở cấp này.':''),'m85-skin-status'),260,487,690,26);
    message.setAttribute('role','status');dialog.append(message);
    overlay.append(dialog);stage.append(overlay);
  }

  dispose() {
    this.disposed = true;for(const dispose of this.tooltipCleanups)dispose();this.tooltipCleanups=[];
    this.epoch++;this.releaseLevelEffect();
    this.releasePortraits(); this.host.replaceChildren(); this.snapshot = null;
  }
}
