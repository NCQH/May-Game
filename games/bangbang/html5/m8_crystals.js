import {crystalBoardPreview,crystalAttributeText,CRYSTAL_DIALOG_GEOMETRY,crystalSaleWindow} from './m81_crystal_view.js';
import {createNativePanel} from './m81_native_panel.js';
import {createCommonAsk,createMessageBox} from './m82_common_ask.js';
import {M84_CRYSTAL_STYLE,crystalRecommendationTank,crystalRecommendationTanks,
  crystalRecommendationRows,crystalItemAttributeText,crystalGuaranteeText} from './m84_crystal_view.js';
import {M84CrystalReward,M84_CRYSTAL_REWARD_STYLE} from './m84_crystal_reward.js';
import {crystalRewardItems} from './m84_crystal_reward_data.js';
import {syncCrystalRewardChrome,releaseCrystalRewardChrome} from './m81330_crystal_chrome.js';
import {encodeCrystalList, encodeCrystalSave, encodeCrystalRename, encodeCrystalAssign,
  encodeCrystalCraft, encodeCrystalSell, encodeCrystalExchange} from './m8_crystal_protocol.js';
import {createCrystalState, crystalOwnedCounts, crystalSellableCounts, validateCrystalBoard,
  createCrystalDraft, crystalDraftChanged, reconcileCrystalDraft, acknowledgeCrystalDraft,
  crystalGuaranteeRemaining} from './m8_crystal_state.js';
import {element, actionButton, assetImage, field, nativeText, numberText,
  selectInput, textInput, note} from './m8_ui_helpers.js';

const TYPE_NAMES = {0: 'Tất cả', 2: 'Đỏ', 3: 'Vàng', 4: 'Lam'};
const STYLE = `
.m8-crystals{color:inherit;min-width:0;height:100%;overflow:auto;padding:12px 20px;box-sizing:border-box}.m8-crystals h3{margin:.4rem 0 .7rem}
.m8-crystals .cr-toolbar,.m8-crystals .cr-tabs,.m8-crystals .cr-actions{display:flex;flex-wrap:wrap;align-items:end;gap:.55rem;margin:.55rem 0}
.m8-crystals .cr-tabs .is-active{outline:2px solid #efca68;outline-offset:-2px}
.m8-crystals .cr-workspace{display:grid;grid-template-columns:minmax(300px,526px) minmax(220px,1fr);gap:1rem;align-items:start}
.m8-crystals .cr-board{position:relative;aspect-ratio:526/360;width:100%;max-width:526px;isolation:isolate}
.m8-crystals .cr-board-art{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:100%;max-height:100%;object-fit:contain;pointer-events:none}
.m8-crystals .cr-slot{position:absolute;display:grid;place-items:center;padding:0;min-width:0;border:0;border-radius:0;background:none;box-shadow:none;overflow:visible;cursor:pointer}
.m8-crystals .cr-slot:disabled{cursor:default;opacity:.75}.m8-crystals .cr-slot:focus-visible,.m8-crystals .cr-slot.is-selected{outline:2px solid #ffe88a;outline-offset:1px;z-index:2}
.m8-crystals .cr-grid,.m8-crystals .cr-slot-icon{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none}
.m8-crystals .cr-slot-level{position:absolute;bottom:8%;left:0;right:0;text-align:center;font-size:10px;font-weight:bold;color:white;text-shadow:0 1px 2px black;pointer-events:none}
.m8-crystals .cr-library{display:grid;grid-template-columns:repeat(auto-fill,minmax(126px,1fr));gap:.45rem;max-height:390px;overflow:auto;align-content:start}
.m8-crystals .cr-card{display:flex;align-items:center;gap:.4rem;padding:.5rem;border:1px solid #63878d55;border-radius:5px;background:#061d2790;min-width:0}
.m8-crystals button.cr-card{color:inherit;text-align:left;cursor:pointer}.m8-crystals button.cr-card:disabled{opacity:.46;cursor:default}
.m8-crystals .cr-icon{width:48px;height:48px;object-fit:contain;flex:0 0 48px}.m8-crystals .cr-card-copy{min-width:0;font-size:12px;line-height:1.4}
.m8-crystals .cr-count{display:block;color:#ffe59c}.m8-crystals .cr-name{font-weight:600}.m8-crystals .cr-description{white-space:pre-line;font-size:13px;line-height:1.5}
.m8-crystals .cr-tier{padding:1rem;border:1px solid #63878d66;background:#061d2766;border-radius:6px;flex:1;min-width:220px}
.m8-crystals .cr-tiers{display:flex;flex-wrap:wrap;gap:1rem}.m8-crystals .cr-awards{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:1rem}
.m8-crystals .cr-awards .cr-card{width:180px}.m8-crystals .cr-sell-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(245px,1fr));gap:.5rem;max-height:420px;overflow:auto}
.m8-crystals .cr-sell-row{display:flex;align-items:center;gap:.6rem;padding:.5rem;border:1px solid #63878d55;background:#061d2755}
.m8-crystals .cr-sell-row .cr-card-copy{flex:1}.m8-crystals .cr-quantity{max-width:86px}.m8-crystals .cr-status{min-height:1.3em}
.m8-crystals .cr-summary{color:#ffe59c}.m8-crystals .cr-empty{padding:1rem;opacity:.8}.m8-crystals .cr-exchange-detail{max-width:630px}
@media(max-width:760px){.m8-crystals .cr-workspace{grid-template-columns:1fr}.m8-crystals .cr-library{max-height:240px}.m8-crystals .cr-slot-level{font-size:9px}}
/* Native NewCrystalFrame coordinate space; outer stage scales as a whole. */
.m8-crystals.cr-native{position:absolute;left:10px;top:20px;width:954px;height:550px;padding:0;overflow:visible;color:#fff;font:12px Tahoma,sans-serif}
.cr-native .cr-page{position:relative;width:954px;height:550px}.cr-native .cr-page>.cr-heading{position:absolute;left:280px;top:500px;margin:0;max-width:500px}.cr-native .cr-page>.cr-heading h3{display:none}
.cr-native .cr-tabs{position:absolute;left:10px;top:37px;margin:0;z-index:2}.cr-native .cr-page-boards .cr-tabs{display:contents}
.cr-native .cr-native-button{padding:0;border:0;box-shadow:none;border-radius:0;background-color:transparent;background-size:100% 100%;color:transparent;font-size:0;min-width:0;cursor:pointer}.cr-native .cr-native-button:disabled{opacity:.5;cursor:default}
.cr-native .cr-native-background{position:absolute;left:8.5px;top:64px;width:937px;height:472px;pointer-events:none}
.cr-native .cr-page-boards [data-testid=cr-tab-boards]{position:absolute;left:10px;top:37px}.cr-native .cr-page-boards [data-testid=cr-tab-exchange]{position:absolute;left:16px;top:502px}.cr-native .cr-page-boards [data-testid=cr-tab-sell]{position:absolute;left:98px;top:502px}.cr-native .cr-page-boards [data-testid=cr-tab-craft]{position:absolute;left:180px;top:502px}
.cr-native .cr-page-boards .cr-board-toolbar{position:absolute;inset:0;margin:0;display:block;pointer-events:none}.cr-native .cr-page-boards .cr-board-toolbar>*{position:absolute;pointer-events:auto;margin:0}.cr-native .cr-page-boards .cr-control-0{left:270px;top:72px;width:410px}.cr-native .cr-page-boards .cr-control-1{left:697px;top:78px}.cr-native .cr-page-boards .cr-control-2{left:10px;top:78px;width:180px}.cr-native .cr-control-2>span{position:absolute;clip-path:inset(50%);width:1px;height:1px;overflow:hidden}.cr-native .cr-control-2 input{width:180px;height:30px}.cr-native .cr-page-boards .cr-control-3{left:198px;top:90px;max-width:62px}
.cr-native .cr-page-boards .cr-workspace{display:block}.cr-native .cr-page-boards .cr-board-wrap{position:static}.cr-native .cr-page-boards .cr-board{position:absolute;left:259px;top:130px;width:526px;height:360px}.cr-native .cr-page-boards .cr-board-wrap>p{display:none}
.cr-native .cr-page-boards .cr-actions{position:absolute;left:800px;top:78px;width:134px;display:flex;flex-direction:column;align-items:center;gap:16px;margin:0}.cr-native .cr-page-boards .cr-actions p{position:absolute;left:-260px;top:422px;width:240px;max-width:240px;max-height:32px;overflow:auto;margin:0;line-height:16px;color:#153e5a}.cr-native .cr-page-boards>.cr-heading{max-width:250px;color:#153e5a}.cr-native .cr-page-boards>.cr-heading .cr-summary{color:#153e5a;font-weight:bold}
.cr-native .cr-page-boards .cr-inventory{position:absolute;left:10px;top:110px;width:250px;height:382px}.cr-native .cr-page-boards .cr-inventory>label{display:block;margin:0 0 5px}.cr-native .cr-page-boards .cr-library{display:block;position:absolute;top:37px;width:250px;height:350px;max-height:350px}.cr-native .cr-page-boards .cr-card{width:250px;height:50px;padding:0;border:0;border-radius:0;box-sizing:border-box;position:relative;display:block;background:transparent}.cr-native .cr-page-boards .cr-icon{position:absolute;left:3px;top:3px;width:44px;height:44px}.cr-native .cr-page-boards .cr-card-copy{position:absolute;left:48px;top:50%;transform:translateY(-50%);width:107px;font-size:12px;font-weight:bold;white-space:pre-line}.cr-native .cr-page-boards .cr-count{position:absolute;left:114px;top:50%;transform:translateY(-50%);font-size:12px;white-space:nowrap}
.cr-native .cr-page-boards .cr-assign{position:absolute;left:270px;top:535px;width:665px;height:40px;margin:0;gap:6px;align-items:center;flex-wrap:nowrap}.cr-native .cr-page-boards .cr-assign label{display:flex;gap:5px;align-items:center;white-space:nowrap}.cr-native .cr-page-boards .cr-assign select{max-width:180px}.cr-native .cr-page-boards .cr-assign p{max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cr-native .cr-status{position:absolute;left:270px;top:112px;width:500px;margin:0;z-index:2;pointer-events:none}
.cr-native .cr-page:not(.cr-page-boards):not(.cr-native-dialog)>:not(.cr-tabs):not(.cr-toolbar):not(.cr-status){position:relative;top:85px;margin:0 25px;max-height:425px;overflow:auto}.cr-native .cr-page:not(.cr-page-boards):not(.cr-native-dialog) .cr-status{top:535px}.cr-native .cr-page:not(.cr-page-boards):not(.cr-native-dialog)>.cr-toolbar:not(:first-child){position:relative;top:85px;margin:0 25px 10px}
.cr-native-filters{position:absolute;left:0;top:3px;width:250px;height:24px}.cr-native-filters button{position:absolute}.cr-native-attributes{position:absolute;left:792px;top:170px;width:150px;height:350px;overflow:auto;white-space:pre-line;line-height:1.5}.cr-native-attributes strong{display:block;text-align:center;margin-bottom:76px}
.cr-dialog-back{position:absolute;left:25px;top:0;z-index:3}.cr-native .cr-page:not(.cr-page-boards):not(.cr-native-dialog) .cr-tabs{display:none}.cr-close-prompt{position:absolute;z-index:20;left:200px;top:170px;width:500px;padding:25px;background:#064d70;border:2px solid #86e8ff;box-shadow:0 0 0 2000px #0009;display:flex;gap:10px;flex-wrap:wrap}.cr-close-prompt p{width:100%}
.cr-native .cr-native-dialog>*{margin:0!important}.cr-native-dialog>.cr-tabs{display:none}.cr-native-dialog>.cr-heading{left:25px!important;top:720px!important}.cr-native-dialog>.cr-status{left:250px;top:695px;width:700px}.cr-native-dialog .cr-dialog-art{pointer-events:none}.cr-native-dialog .cr-craft-counter,.cr-native-dialog .cr-craft-price{text-align:center;color:white;font-weight:bold}.cr-native-dialog>.cr-awards{position:absolute;left:280px;top:720px;width:650px;height:75px;overflow:auto}.cr-native-dialog>.cr-awards .cr-card{width:120px}.cr-native-dialog>h4{display:none}
.cr-native .cr-native-dialog>.cr-dialog-back{position:absolute;left:25px;top:0}.cr-native-exchange-card{text-align:center}.cr-native-exchange-card>img:first-child{pointer-events:none}.cr-native-exchange-card strong{font-size:12px}.cr-exchange-levels,.cr-exchange-pages{display:flex;gap:7px;align-items:center}.cr-exchange-levels label{display:flex;gap:2px}.cr-native .cr-page-exchange>.cr-status{left:300px;top:540px;width:580px}.cr-native .cr-page-exchange>.cr-toolbar:first-child{display:none}
.cr-native .cr-page-sell>.cr-toolbar:first-child{display:none}.cr-native .cr-page-sell>.cr-status{left:25px;top:490px;width:600px}.cr-native-sell-card{text-align:center;cursor:pointer}.cr-native-sell-card>span{font-size:12px;font-weight:bold;white-space:pre-line;line-height:15px}.cr-native-sell-card>img{pointer-events:none}.cr-sell-levels{display:flex;gap:14px;flex-wrap:wrap}.cr-sell-levels label{display:flex;align-items:center;gap:3px}.cr-native-sell-list{scrollbar-color:#54b7df #124f72}

.cr-native .cr-page-boards .cr-board-toolbar>.cr-scheme-selector{left:262px;top:72px;width:520px;height:39px}
.cr-native .cr-page-boards .cr-board-toolbar>.cr-native-name{left:10px;top:78px;width:240px}.cr-native .cr-native-name>span{display:none}.cr-native .cr-native-name input{box-sizing:border-box;width:240px;height:30px;padding-right:38px}
.cr-native .cr-page-boards .cr-board-toolbar>.cr-native-rename{left:217px;top:78px}
.cr-native .cr-scheme-name{font-size:12px;color:#fdfdfd;font-weight:bold;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.cr-scheme-label{text-align:right;font-size:16px;font-weight:bold;color:#bddde6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cr-scheme-list{overflow:hidden}
.cr-native .cr-native-check{appearance:none;border:0;border-radius:0;padding:0;margin:0;background-color:transparent;background-size:100% 100%;cursor:pointer}.cr-native .cr-native-check:disabled{opacity:.5;cursor:default}.cr-native .cr-native-check:focus-visible,.cr-native .cr-native-button:focus-visible{outline:2px solid #ffe88a;outline-offset:1px}
`;

/** Mounted outside the battle renderer. All mutations use the authenticated
 * native transport supplied by M8Connection; local boards remain drafts until
 * the actual acknowledgement and matching native board snapshot arrive.
 */
export class M8Crystals {
  constructor({host, client, catalog, assets, run, onClose = () => {}, onStageSize = () => {}}) {
    this.onClose = onClose; this.onStageSize=onStageSize; this.host = host; this.client = client; this.catalog = catalog; this.assets = assets;
    this.run = run || (work => work()); this.snapshot = null; this.disposed = false;
    this.epoch = 0; this.identity = null; this.pending = ''; this.notice = '';
    this.connectionGeneration = client.generation;
    this.tab = 'boards'; this.boardId = null; this.drafts = {}; this.names = {};
    this.selectedSlot = null; this.itemType = 0; this.tankUuid = '';
    this.recommendation=false;this.recommendLevel=3;this.recommendTankId=null;
    this.presentation=assets?.crystalPresentation||null;this.auxDialog=null;
    this.recommendPortrait=null;this.recommendPortraitKey='';
    this.reward=null;
    this.sellCounts = {}; this.recipeId = null; this.exchangeCount = 1; this.exchangeLevel = 4;
    this.content = element('section', null, 'm8-crystals');
    this.content.setAttribute('aria-label', 'Tinh thể');
    this.style = element('style', STYLE+M84_CRYSTAL_STYLE+M84_CRYSTAL_REWARD_STYLE);
    this.panelAssets={...assets?.panels?.assets,...assets?.ui?.assets};
    if(this.panelAssets['box.bk_lt'])this.ensureNativePanel();
    else host.replaceChildren(this.style,this.content);
  }

  ensureNativePanel() {
    if(!this.panelAssets?.['box.bk_lt']||this.panelTab===this.tab)return;
    const g=CRYSTAL_DIALOG_GEOMETRY[this.tab],assets=this.panelAssets,title=assets['crystal.'+g.title];
    this.nativePanel=createNativePanel({assets,width:g.width,height:g.height,kind:'box1',
      title:{asset:'crystal.'+g.title,x:(g.width-title.width)/2,y:20,label:'Tinh thể'},
      close:{asset:'public.close',x:g.width-39,y:15,label:'Đóng'},onClose:()=>this.requestClose()});
    Object.assign(this.content.style,{left:g.left+'px',top:g.top+'px',width:g.contentWidth+'px',height:g.contentHeight+'px'});
    this.content.classList.add('cr-native');this.nativePanel.content.append(this.content);
    this.host.replaceChildren(this.style,this.nativePanel.root);this.panelTab=this.tab;this.resizeNativeStage();
  }
  resizeNativeStage() {
    if(!this.nativePanel)return;
    const g=CRYSTAL_DIALOG_GEOMETRY[this.tab];
    const size={width:Math.max(1000,g.width),height:Math.max(600,g.height)};
    Object.assign(this.nativePanel.root.style,{position:'absolute',left:`${(size.width-g.width)/2}px`,top:`${(size.height-g.height)/2}px`});
    this.reward?.setViewport(size.width,size.height,{left:(size.width-g.width)/2+g.left,
      top:(size.height-g.height)/2+g.top,width:g.contentWidth,height:g.contentHeight});
    this.onStageSize(size);
  }
  requestClose() {
    if(this.reward){if(this.reward.complete)this.closeCraftReward();return;}
    if(this.pending)return;
    if(this.auxDialog){this.auxDialog=null;this.render();return;}
    if(this.tab!=='boards'){this.tab='boards';this.render();return;}
    const dirty=this.dirtyBoardIds();
    if(dirty.length){this.boardId=dirty[0];this.closePrompt=true;this.render();return;}
    this.onClose();
  }

  dirtyBoardIds() {
    return Object.keys(this.crystals.boards).map(Number).filter(id=>
      (this.drafts[id]&&crystalDraftChanged(this.drafts[id]))||
      (this.names[id]&&this.names[id].value!==this.names[id].base));
  }
  async saveClosingBoard() {
    const epoch=this.epoch,id=this.boardId;
    await this.saveBoard();
    if(this.disposed||epoch!==this.epoch)return;
    if(this.names[id]&&this.names[id].value!==this.names[id].base)await this.renameBoard();
    if(this.disposed||epoch!==this.epoch)return;
    this.closePrompt=false;this.requestClose();
  }
  get crystals() { return this.snapshot?.crystals || createCrystalState(); }
  get meta() { return this.snapshot?.meta || {}; }
  get mutable() {
    return !this.disposed && !this.pending && !this.reward && this.snapshot?.phase === 'ready'
      && !this.snapshot?.play?.busy && ['lobby', 'room'].includes(this.snapshot?.play?.phase)
      && this.crystals.namesReady && this.crystals.detailsReady;
  }
  get board() { return this.crystals.boards[this.boardId]; }
  get draft() { return this.drafts[this.boardId] || null; }
  tankName(id) { return this.assets?.tankName?.(id) || this.catalog.tankNames?.[id] || `Tank ${id}`; }
  boardName(board) { return nativeText(board?.name) || `Bảng ${board?.boardId ?? ''}`; }
  get pieces() {
    return (this.meta.containers?.[this.catalog.piece.containerType]?.items || [])
      .filter(i => i.templateId === this.catalog.piece.itemId).reduce((sum, i) => sum + i.count, 0);
  }

  update(snapshot) {
    if (this.disposed) return;
    const identity = snapshot.accountId ?? snapshot.meta?.character?.accountId ?? null;
    if (identity !== this.identity || this.client.generation !== this.connectionGeneration) {
      this.epoch += 1; this.identity = identity; this.boardId = null; this.drafts = {};
      this.names = {}; this.sellCounts = {}; this.sellSelection=null; this.closePrompt=false; this.pending = ''; this.notice = ''; this.tankUuid = '';
      this.recommendation=false;this.recommendLevel=3;this.recommendTankId=null;this.auxDialog=null;
      this.releaseRecommendationPortrait();
      this.releaseCraftReward();
      this.connectionGeneration = this.client.generation;
    }
    this.snapshot = snapshot;
    if(this.reward&&(snapshot.phase!=='ready'||!['lobby','room'].includes(snapshot.play?.phase)))this.releaseCraftReward();
    for (const board of Object.values(this.crystals.boards)) {
      this.drafts[board.boardId] = reconcileCrystalDraft(this.drafts[board.boardId], board);
      const name = this.names[board.boardId];
      if (!name || name.value === name.base) this.names[board.boardId] = {value: board.name, base: board.name};
    }
    const owned = (this.meta.tanks || []).filter(t => t.containerType === 0);
    if (!this.crystals.boards[this.boardId]) {
      const primary=(this.meta.tanks||[]).find(t=>t.selected);
      this.boardId=this.crystals.boards[primary?.crystalSchemeId]?.boardId??Object.values(this.crystals.boards)[0]?.boardId??null;
    }
    if (!owned.some(t => t.uuid === this.tankUuid)) this.tankUuid = (owned.find(t => t.selected) || owned[0])?.uuid || '';
    const recommendation=crystalRecommendationTank(this.meta,this.recommendTankId);
    this.recommendTankId=recommendation?.tankId??null;
    const renderKey=JSON.stringify([identity,this.client.generation,snapshot.phase,snapshot.play?.phase,snapshot.play?.busy,
      this.crystals,this.meta.character?.currency,this.meta.tanks,this.meta.containers?.[10],this.meta.containers?.[this.catalog.piece.containerType]]);
    if(renderKey!==this.updateRenderKey){this.updateRenderKey=renderKey;this.render();}
  }

  dispose() {
    this.disposed = true; this.epoch += 1;
    this.releaseRecommendationPortrait();
    this.releaseCraftReward();
    this.host.replaceChildren(); this.snapshot = null;
  }

  button(text, work, options = {}) {
    const button=actionButton(text, () => this.run(async () => work()), options);
    if(options.testId)button.dataset.crFocus=options.testId;
    return button;
  }

  /** Also guard direct calls: a stale UI control cannot mutate a running match. */
  async mutate(label, frame, predicate, description, after = null) {
    if (!this.mutable) throw new Error('Về sảnh hoặc phòng chờ và đợi đồng bộ xong để đổi tinh thể.');
    const epoch = this.epoch;
    let observed = null;
    this.pending = label; this.notice = ''; this.render();
    try {
      await this.client.metaAction(label, frame, packet => {
        if (!predicate(packet)) return false;
        observed = packet; return true;
      }, description);
      if (this.disposed || epoch !== this.epoch) return;
      if (!observed) throw new Error('Chưa nhận xác nhận tinh thể từ máy chủ.');
      if (after) await after(observed);
    } catch (error) {
      if (!this.disposed && epoch === this.epoch) this.notice = error.message;
      throw error;
    } finally {
      if (!this.disposed && epoch === this.epoch) { this.pending = ''; this.render(); }
    }
  }

  async refresh() {
    await this.mutate('Đang tải bảng', encodeCrystalList(), p => p.type === 'crystalBoards',
      'Đồng bộ bảng tinh thể', () => { this.notice = 'Đã nhận dữ liệu bảng tinh thể.'; });
  }

  async saveBoard() {
    const draft = this.draft;
    if (!draft || !crystalDraftChanged(draft)) return;
    if (draft.conflict) throw new Error('Bảng đã đổi ở phiên khác. Tải lại bảng trước khi sửa tiếp.');
    const validation = validateCrystalBoard(draft.items, this.meta, this.catalog);
    if (!validation.valid) throw new Error(validation.errors[0]);
    const id = draft.boardId;
    await this.mutate('Đang lưu bảng', encodeCrystalSave(id, draft.items), p => p.type === 'crystalSaveResult',
      'Lưu bảng tinh thể', packet => {
        if (packet.result !== 0) throw new Error('Máy chủ từ chối lưu bảng tinh thể.');
        const current = this.drafts[id];
        const accepted = acknowledgeCrystalDraft(current, this.crystals.boards[id], packet);
        if (accepted === current) throw new Error('Chưa nhận được bảng đã lưu khớp với yêu cầu.');
        this.drafts[id] = accepted; this.notice = 'Đã lưu bảng tinh thể.';
      });
  }

  async renameBoard() {
    const id = this.boardId, value = this.names[id]?.value ?? '';
    await this.mutate('Đang đổi tên', encodeCrystalRename(id, value), p => p.type === 'crystalNameResult',
      'Đổi tên bảng tinh thể', packet => {
        if (packet.result !== 0 || this.crystals.boards[id]?.name !== value)
          throw new Error('Tên bảng chưa được máy chủ xác nhận.');
        this.names[id] = {value, base: value}; this.notice = 'Đã đổi tên bảng.';
      });
  }

  async addBoard() {
    const id = Object.keys(this.crystals.boards).length + 1;
    if (id > this.catalog.maximumBoards) throw new Error('Đã đủ số bảng tinh thể.');
    await this.mutate('Đang thêm bảng', encodeCrystalRename(id, ''), p => p.type === 'crystalNameResult',
      'Thêm bảng tinh thể', packet => {
        if (packet.result !== 0 || !this.crystals.boards[id]?.items)
          throw new Error('Bảng mới chưa được máy chủ xác nhận.');
        this.boardId = id; this.drafts[id] = createCrystalDraft(this.crystals.boards[id]);
        this.notice = 'Đã thêm bảng tinh thể trống.';
      });
  }

  async assignBoard() {
    const id = this.boardId, uuid = this.tankUuid;
    if (crystalDraftChanged(this.draft)) throw new Error('Lưu bảng trước khi gán cho tank.');
    if (!(this.meta.tanks || []).some(t => t.uuid === uuid && t.containerType === 0))
      throw new Error('Cần chọn tank sở hữu.');
    await this.mutate('Đang gán bảng', encodeCrystalAssign(id, uuid),
      p => p.type === 'tankInstanceUpdated' && p.op === 19 && p.tank.uuid === uuid && p.tank.crystalSchemeId === id,
      'Gán bảng tinh thể cho tank', () => { this.notice = 'Tank đã dùng bảng tinh thể này.'; });
  }

  addCrystal(id) {
    if (!this.mutable || !this.draft) return;
    const item = this.catalog.items[id], items = [...this.draft.items];
    if (!item) return;
    const preferred = this.catalog.slots.find(s => s.position === this.selectedSlot
      && s.type === item.type && items[s.position - 1] === 0);
    const slot = preferred || this.catalog.slots.find(s => s.type === item.type && items[s.position - 1] === 0);
    if (!slot) { this.notice = 'Không còn ô trống cùng màu.'; this.render(); return; }
    items[slot.position - 1] = id;
    const validation = validateCrystalBoard(items, this.meta, this.catalog);
    if (!validation.valid) { this.notice = validation.errors[0]; this.render(); return; }
    this.drafts[this.boardId] = {...this.draft, items}; this.selectedSlot = null; this.notice = ''; this.render();
  }

  addRecommendedCrystal(id) {
    if(!this.mutable||!this.draft)return;
    const item=this.catalog.items[id];if(!item)return;
    const items=[...this.draft.items];
    const slot=this.catalog.slots.find(s=>s.type===item.type&&items[s.position-1]===0);
    if(!slot){this.notice='Không còn ô trống cùng màu.';this.render();return;}
    // Native onCrystalRmdClick inserts a preview before attempting quick buy.
    // Missing ownership stays a draft; the existing save validator and ACK gate
    // remain authoritative. There is no native crystal shop in this server.
    items[slot.position-1]=id;this.drafts[this.boardId]={...this.draft,items};
    this.selectedSlot=null;
    this.notice=validateCrystalBoard(items,this.meta,this.catalog).valid?'':
      'Chưa đủ tinh thể sở hữu để lưu bảng. Có thể chế tạo hoặc đổi từ mảnh.';
    this.render();
  }

  clickSlot(position) {
    if (!this.mutable || !this.draft) return;
    const items = [...this.draft.items];
    if (items[position - 1]) {
      items[position - 1] = 0; this.drafts[this.boardId] = {...this.draft, items}; this.selectedSlot = null;
    } else {
      this.selectedSlot = position; this.itemType = this.catalog.slots.find(s => s.position === position)?.type || 0;
    }
    this.notice = ''; this.render();
  }

  async craft(kind) {
    const pack = this.catalog.packages.find(p => p.kind === kind);
    if (!pack || !(this.meta.character?.currency?.[pack.currency] >= pack.price))
      throw new Error('Không đủ xu khóa để chế tạo gói này.');
    await this.mutate('Đang chế tạo', encodeCrystalCraft(kind), p => p.type === 'settleAward' && p.kind === 19,
      'Chế tạo tinh thể', packet => {
        const count = packet.award.groups.filter(g => g.type === 0).reduce((sum, g) => sum + g.items.length, 0);
        this.notice = `Đã nhận kết quả chế tạo ${count} tinh thể.`;
        this.showCraftReward(packet);
      });
  }

  showCraftReward(packet) {
    if(!this.nativePanel)return;
    const items=crystalRewardItems(packet,this.catalog);if(!items.length)return;
    this.releaseCraftReward();
    this.reward=new M84CrystalReward({items,catalog:this.catalog,assets:this.assets,onClose:()=>this.closeCraftReward()});
    this.resizeNativeStage();
  }
  releaseCraftReward() {
    releaseCrystalRewardChrome(this.reward);
    this.reward?.dispose?.();this.reward=null;
    if(this.nativePanel){this.nativePanel.root.inert=false;if(!this.disposed)this.resizeNativeStage();}
  }
  closeCraftReward() {
    if(!this.reward?.complete)return;
    this.releaseCraftReward();this.render();
    this.content.querySelector('[data-testid="cr-craft-5"]')?.focus({preventScroll:true});
  }

  sale() {
    const available = crystalSellableCounts(this.meta, this.crystals), ids = [];
    let fragments = 0, valid = true;
    for (const [key, count] of Object.entries(this.sellCounts)) {
      if (!count) continue;
      const id = Number(key), item = this.catalog.items[id];
      if (!item || !Number.isInteger(count) || count < 0 || count > (available[id] || 0)) { valid = false; continue; }
      if (ids.length + count > 1000) { valid = false; continue; }
      ids.push(...Array(count).fill(id)); fragments += item.sellPieces * count;
    }
    return {ids, fragments, valid: valid && ids.length > 0};
  }

  async sell() {
    const sale = this.sale();
    if (!sale.valid) throw new Error('Chọn đúng số tinh thể chưa dùng trong bảng (tối đa 1000 viên).');
    await this.mutate('Đang bán tinh thể', encodeCrystalSell(sale.ids),
      p => p.type === 'crystalSellNotified' && p.itemId === 0, 'Bán tinh thể', () => {
        this.sellCounts = {}; this.sellSelection=new Set(); this.notice = `Đã bán ${sale.ids.length} tinh thể, nhận ${numberText(sale.fragments)} mảnh.`;
      });
  }

  async exchange() {
    const recipe = this.catalog.recipes.find(r => r.recipeId === this.recipeId), count = this.exchangeCount;
    if (!recipe || !Number.isInteger(count) || count < 1 || count > 999)
      throw new Error('Chọn công thức và số lượng đổi hợp lệ.');
    if (recipe.pieceCost * count > this.pieces) throw new Error('Không đủ mảnh tinh thể.');
    await this.mutate('Đang đổi tinh thể', encodeCrystalExchange([{recipeId: recipe.recipeId, count}]),
      p => p.type === 'settleAward' && p.kind === 8, 'Đổi mảnh lấy tinh thể', () => {
        this.notice = 'Đã nhận tinh thể đổi từ mảnh.';
      });
  }

  render() {
    if (this.disposed) return;
    if(this.tab!=='boards'||!this.recommendation)this.releaseRecommendationPortrait();
    this.ensureNativePanel();
    const oldScroll=this.renderedBoard===this.boardId?this.content.querySelector('.cr-library')?.scrollTop||0:0;
    const focused = document.activeElement;
    const focusKey = this.content.contains(focused) ? focused.dataset.crFocus : null;
    const caret = focusKey && typeof focused.selectionStart === 'number' ? focused.selectionStart : null;
    const section = element('div',null,'cr-page cr-page-'+this.tab);
    if(this.nativePanel){const g=CRYSTAL_DIALOG_GEOMETRY[this.tab];section.style.width=g.contentWidth+'px';section.style.height=g.contentHeight+'px';}
    const heading = element('div', null, 'cr-toolbar cr-heading');
    heading.append(element('h3', 'Tinh thể'), element('span',
      `Xu khóa: ${numberText(this.meta.character?.currency?.silver)} · Mảnh: ${numberText(this.pieces)}`, 'cr-summary'));
    section.append(heading);
    const tabs = element('div', null, 'cr-tabs');
    for (const [id, label] of [['boards', 'Bảng tinh thể'], ['craft', 'Chế tạo'], ['exchange', 'Đổi tinh thể'], ['sell', 'Bán tinh thể']]) {
      const b = this.button(label, () => { this.tab = id;if(id==='boards')this.recommendation=false; this.notice = ''; this.render(); },
        {className: this.tab === id ? 'is-active' : '', testId: `cr-tab-${id}`});
      b.setAttribute('aria-pressed', String(this.tab === id)); tabs.append(b);
    }
    section.append(tabs);
    if (!this.crystals.namesReady || !this.crystals.detailsReady) {
      section.append(note('Đang đồng bộ các bảng tinh thể từ máy chủ.'));
    } else {
      if (!['lobby', 'room'].includes(this.snapshot?.play?.phase))
        section.append(note('Về sảnh hoặc phòng chờ để thay bảng, chế tạo và đổi tinh thể.'));
      if (this.tab === 'boards') this.renderBoards(section);
      if (this.tab === 'craft') this.renderCraft(section);
      if (this.tab === 'exchange') this.renderExchange(section);
      if (this.tab === 'sell') this.renderSell(section);
    }
    const status = note(this.pending || this.notice, 'cr-status');
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); section.append(status);
    if(this.nativePanel&&this.tab!=='boards')section.append(this.button('Về bảng tinh thể',()=>{this.tab='boards';this.render();},{className:'cr-dialog-back',testId:'cr-dialog-back'}));
    this.content.replaceChildren(section);
    if(this.reward){
      this.nativePanel.root.inert=true;
      if(this.reward.root.parentElement!==this.host)this.host.append(this.reward.root);
      syncCrystalRewardChrome(this.reward,section);
      this.reward.start();
    }
    if(this.auxDialog&&!this.closePrompt)this.renderAuxDialog(section);
    if(this.closePrompt){
      section.inert=true;
      const cancelClose=()=>{if(this.pending)return;this.closePrompt=false;this.render();this.focusBoardSelector();};
      const save=this.button('Lưu bảng này',()=>this.saveClosingBoard(),{disabled:!this.mutable||!this.draft||!validateCrystalBoard(this.draft.items,this.meta,this.catalog).valid,testId:'cr-close-save'});
      const discard=this.button('Bỏ tất cả thay đổi',()=>{this.closePrompt=false;this.onClose();},{disabled:!!this.pending,testId:'cr-close-discard'});
      const cancel=this.button('Tiếp tục sửa',cancelClose,{disabled:!!this.pending,testId:'cr-close-cancel'});
      const message=`Còn ${this.dirtyBoardIds().length} bảng chưa lưu. Lưu bảng “${this.board?.name||this.boardId}” trước khi đóng?`;
      const overlay=element('div',null,this.nativePanel?'m82-ask-overlay':'cr-close-prompt');
      if(this.nativePanel)overlay.append(createCommonAsk({assets:this.assets,message,confirm:save,cancel:discard,extra:cancel,label:'Bảng tinh thể chưa lưu',onCancel:cancelClose}).root);
      else{overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.append(note(message),save,discard,cancel);overlay.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();cancelClose();}});}
      this.content.append(overlay);
      this.content.querySelector('[data-testid="cr-close-cancel"]')?.focus({preventScroll:true});
    }
    const saleList=this.content.querySelector('.cr-native-sell-list');if(saleList)saleList.scrollTop=this.sellScroll||0;
    const library=this.content.querySelector('.cr-library');if(library)library.scrollTop=oldScroll;this.renderedBoard=this.boardId;
    if (focusKey && !this.closePrompt&&!this.auxDialog&&!this.reward) {
      const next = [...this.content.querySelectorAll('[data-cr-focus]')].find(n => n.dataset.crFocus === focusKey);
      if (next && !next.disabled) {
        next.focus({preventScroll: true});
        if (caret !== null && typeof next.setSelectionRange === 'function' && next.type !== 'number')
          next.setSelectionRange(caret, caret);
      }
    }
  }

  focusBoardSelector() {
    const key=this.nativePanel?`board-${this.boardId}`:'board';
    this.content.querySelector(`[data-cr-focus="${key}"]`)?.focus({preventScroll:true});
  }

  releaseRecommendationPortrait() {
    this.recommendPortrait?.dispose?.();this.recommendPortrait?.remove?.();
    this.recommendPortrait=null;this.recommendPortraitKey='';
  }

  renderRecommendations(container) {
    container.classList.add('cr-recommendations');
    const tank=crystalRecommendationTank(this.meta,this.recommendTankId);
    const p=this.presentation;
    if(!tank){container.append(note('Chưa có tank để xem đề cử.'));return;}
    const background=this.assets.get('crystal.recommendTankName');
    if(background)container.append(this.position(assetImage(background,''),178-background.width/2,30));
    const key=JSON.stringify([tank.uuid,tank.tankId,tank.level,tank.externalId,tank.haloId]);
    if(key!==this.recommendPortraitKey){
      this.releaseRecommendationPortrait();this.recommendPortraitKey=key;
      this.recommendPortrait=this.assets.portraitForTank?.(tank,{size:100,animate:true})||element('span');
    }
    if(this.nativePanel){
      // Ruffle custom elements destroy their player on disconnect. Keep the
      // loaded ancestor tree stable while rows, levels and draft counts change.
      this.position(this.recommendPortrait,25,139,100,100);
      this.recommendPortrait.style.pointerEvents='none';
      this.recommendPortrait.style.zIndex='2';
      if(this.recommendPortrait.parentElement!==this.nativePanel.content)this.nativePanel.content.append(this.recommendPortrait);
    }else container.append(this.position(this.recommendPortrait,5,5,100,100));
    const skin=this.assets.garage?.skins?.find(row=>row.externalId===tank.externalId);
    const name=nativeText(this.assets.garage?.items?.[skin?.itemId]?.name||this.tankName(tank.tankId));
    const title=this.position(element('span',name,'cr-rmd-name'),108,31.5,140);title.title=name;container.append(title);
    const change=this.button('Đổi tank xem đề cử',()=>{this.pickerTankId=tank.tankId;this.auxDialog='recommend';this.render();},
      {testId:'cr-recommend-tank',disabled:!!this.pending});
    this.skin(change,'btn_change_tank_t');container.append(this.position(change,141,67));
    const role=(p?.labels?.role||'Định vị: ')+(p?.roles?.[tank.tankId]?.text||'');
    const roleNode=this.position(element('span',role,'cr-rmd-role'),0,110,250);roleNode.title=role;container.append(roleNode);
    container.append(this.position(element('span',p?.labels?.recommended||'Đề cử:','cr-rmd-label'),0,132));
    for(const level of [1,2,3,4,5]) {
      const button=this.button(`Tinh thể đề cử cấp ${level}`,()=>{this.recommendLevel=level;this.render();},
        {testId:`cr-recommend-level-${level}`,className:'cr-rmd-level',disabled:!!this.pending});
      button.setAttribute('aria-pressed',String(level===this.recommendLevel));
      this.skin(button,level===this.recommendLevel?`btn_selectLevel${level}_t`:`btn_level${level}_t`);
      container.append(this.position(button,(level-1)*46,163));
    }
    const list=element('div',null,'cr-rmd-list');list.setAttribute('aria-label','Tinh thể đề cử');
    const rows=crystalRecommendationRows(p,tank.tankId,this.recommendLevel,this.draft.items,crystalOwnedCounts(this.meta));
    for(const row of rows) {
      const item=this.catalog.items[row.itemId];if(!item)continue;
      const card=element('div',null,'cr-rmd-item');card.dataset.itemId=String(row.itemId);
      const use=this.button('',()=>this.addRecommendedCrystal(row.itemId),{testId:`cr-recommend-item-${row.itemId}`,
        className:'cr-rmd-use',disabled:!this.mutable,title:`${nativeText(item.name)}\n${nativeText(item.description)}`});
      use.setAttribute('aria-label',`Khảm thử ${nativeText(item.name)}, còn ${row.count} viên`);
      for(const [key,className] of [['crystal.itemBackground',''],['crystal.itemSelected',' cr-rmd-item-over']]) {
        const art=this.assets.get(key);if(art)use.append(assetImage(art,'','cr-rmd-item-bg'+className));
      }
      use.append(assetImage(item.icon,'','cr-rmd-icon'),element('span',crystalItemAttributeText(item),'cr-rmd-description'),
        element('span',`x${row.count}`,'cr-rmd-count'+(row.count?'':' is-empty')));
      const buy=this.button('Mua tinh thể',()=>{}, {testId:`cr-recommend-buy-${row.itemId}`,className:'cr-rmd-buy',
        disabled:true,title:'Tinh thể chưa được bán trong cửa hàng. Có thể chế tạo hoặc đổi từ mảnh.'});
      this.skin(buy,'btn_buy');card.append(use,buy);list.append(card);
    }
    if(!rows.length)list.append(note('Chưa có đề cử cho tank và cấp này.'));
    container.append(list);
  }

  renderAuxDialog(section) {
    section.inert=true;
    const kind=this.auxDialog,info=kind==='craft-info',height=info?330:250;
    const overlay=element('div',null,'m84-crystal-overlay'),dialog=element('section',null,'m84-crystal-dialog');
    dialog.style.height=height+'px';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
    const title=info?'Chế tạo tinh thể':kind==='recommend'?'Xem đề cử cho tank':'Gán bảng tinh thể';
    dialog.setAttribute('aria-label',title);dialog.append(createMessageBox(this.assets,420,height).root,element('h3',title));
    const cancel=()=>{if(this.pending)return;this.auxDialog=null;this.render();};
    const controls=[];
    if(info) {
      const low=this.catalog.packages.filter(p=>p.tier===0),high=this.catalog.packages.filter(p=>p.tier===1);
      dialog.append(element('p',`Gói thường: ${low.map(p=>`${p.count} lần / ${p.price} xu khóa`).join(' · ')}.\nNhận tinh thể Lv1–3; lượt thứ 5 bảo đảm Lv2–3.\n\nGói cao: ${high.map(p=>`${p.count} lần / ${p.price} xu khóa`).join(' · ')}.\nNhận tinh thể Lv2–5; lượt thứ 5 bảo đảm Lv4–5.\n\nHai gói đếm lượt riêng. Chế tạo 5 lần là 5 lượt liên tiếp.`,'cr-dialog-copy'));
    } else {
      const recommend=kind==='recommend',tanks=recommend?crystalRecommendationTanks(this.meta):(this.meta.tanks||[]).filter(t=>t.containerType===0);
      const select=selectInput(tanks.map(t=>({value:recommend?t.tankId:t.uuid,label:`${this.tankName(t.tankId)} · Lv${t.level}`})),
        recommend?this.pickerTankId:this.tankUuid,recommend?'Tank xem đề cử':'Tank dùng bảng');
      select.dataset.crFocus=recommend?'recommend-tank':'assign-tank';select.disabled=!!this.pending;
      select.addEventListener('change',()=>{if(recommend)this.pickerTankId=Number(select.value);else{this.tankUuid=select.value;this.render();}});
      dialog.append(element('p',recommend?'Chọn tank để xem ba tinh thể được đề cử.':`Bảng “${this.boardName(this.board)}”${crystalDraftChanged(this.draft)?' cần được lưu trước khi gán.':'.'}`,'cr-dialog-copy'),select);
      controls.push(select);
      const current=tanks.find(t=>t.uuid===this.tankUuid);
      const confirm=this.button(recommend?'Xem đề cử':'Dùng bảng này',async()=>{
        if(recommend){this.recommendTankId=this.pickerTankId;this.auxDialog=null;this.render();}
        else{await this.assignBoard();if(!this.disposed){this.auxDialog=null;this.render();}}
      },{className:'cr-dialog-action',testId:recommend?'cr-recommend-tank-confirm':'cr-assign',
        disabled:!this.mutable||!tanks.length||(!recommend&&(crystalDraftChanged(this.draft)||current?.crystalSchemeId===this.boardId))});
      this.dialogButtonSkin(confirm,'green');dialog.append(confirm);controls.push(confirm);
    }
    const close=this.button(info?'Đóng':'Hủy',cancel,{className:'cr-dialog-action',testId:'cr-dialog-cancel',disabled:!!this.pending});
    this.dialogButtonSkin(close,'blue');if(info)Object.assign(close.style,{left:'155px',top:'275px'});
    dialog.append(close);controls.push(close);overlay.append(dialog);this.content.append(overlay);
    dialog.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancel();}
      if(event.key==='Tab'){event.preventDefault();const available=controls.filter(c=>!c.disabled),i=available.indexOf(document.activeElement);available[(i+(event.shiftKey?-1:1)+available.length)%available.length]?.focus();}
    });
    (controls.find(c=>!c.disabled)||close).focus?.({preventScroll:true});
  }

  dialogButtonSkin(button,color) {
    const asset=this.assets.get(`zh_CN/gui_summer/controls/public/button_3_${color}.png`);
    if(asset)button.style.backgroundImage=`url("${asset.url}")`;
  }

  renderBoards(section) {
    const toolbar = element('div', null, 'cr-toolbar cr-board-toolbar');
    const boardSelect = selectInput(Object.values(this.crystals.boards).map(b =>
      ({value: b.boardId, label: this.boardName(b)})), this.boardId, 'Bảng tinh thể');
    boardSelect.dataset.crFocus = 'board'; boardSelect.disabled = !!this.pending;
    boardSelect.addEventListener('change', () => { this.boardId = Number(boardSelect.value); this.selectedSlot = null; this.render(); });
    toolbar.append(field('Bảng', boardSelect), this.button('Thêm bảng', () => this.addBoard(),
      {disabled: !this.mutable || Object.keys(this.crystals.boards).length >= this.catalog.maximumBoards, testId: 'cr-add-board'}));
    const name = textInput(this.names[this.boardId]?.value || '', {maxLength: 64, placeholder: 'Tên bảng'});
    name.dataset.crFocus = 'name'; name.disabled = !this.mutable;
    name.addEventListener('input', () => { this.names[this.boardId].value = name.value; });
    toolbar.append(field('Tên bảng', name), this.button('Đổi tên', () => this.renameBoard(), {disabled: !this.mutable, testId: 'cr-rename'}));
    section.append(toolbar);
    if (!this.draft) { section.append(note('Chưa nhận được nội dung bảng này.')); return; }
    const workspace = element('div', null, 'cr-workspace');
    const boardWrap = element('div',null,'cr-board-wrap'), board = element('div', null, 'cr-board');
    board.setAttribute('aria-label', '30 ô tinh thể');
    board.append(assetImage(this.catalog.layout.background, '', 'cr-board-art'));
    for (const slot of this.catalog.slots) {
      const id = this.draft.items[slot.position - 1], item = this.catalog.items[id];
      const label = item ? `Ô ${slot.position}: ${nativeText(item.name)}. Bấm để gỡ.`
        : `Ô ${slot.position}, màu ${TYPE_NAMES[slot.type]}, trống.`;
      const button = this.button('', () => this.clickSlot(slot.position), {disabled: !this.mutable,
        className: `cr-slot${this.selectedSlot === slot.position ? ' is-selected' : ''}`, title: label, testId: `cr-slot-${slot.position}`});
      button.setAttribute('aria-label', label);
      Object.assign(button.style, {left: `${slot.x / this.catalog.layout.width * 100}%`, top: `${slot.y / this.catalog.layout.height * 100}%`,
        width: `${this.catalog.layout.slotWidth / this.catalog.layout.width * 100}%`, height: `${this.catalog.layout.slotHeight / this.catalog.layout.height * 100}%`});
      button.append(assetImage(this.catalog.layout.grids[slot.type], '', 'cr-grid'));
      if (item) button.append(assetImage(item.icon, '', 'cr-slot-icon'), element('span', `Lv${item.level}`, 'cr-slot-level'));
      board.append(button);
    }
    boardWrap.append(board, note('Bấm tinh thể trong túi để lắp. Bấm ô đã lắp để gỡ, rồi lưu bảng.'));
    const validation = validateCrystalBoard(this.draft.items, this.meta, this.catalog);
    const actions = element('div', null, 'cr-actions');
    actions.append(this.button('Lưu bảng', () => this.saveBoard(), {disabled: !this.mutable || !crystalDraftChanged(this.draft)
      || !validation.valid || this.draft.conflict, testId: 'cr-save'}),
    this.button(this.draft.conflict ? 'Tải lại bảng' : 'Hoàn tác', () => {
      this.drafts[this.boardId] = createCrystalDraft(this.board); this.selectedSlot = null; this.notice = ''; this.render();
    }, {disabled: !!this.pending || !crystalDraftChanged(this.draft), testId: 'cr-reset'}));
    if (this.draft.conflict) actions.append(note('Bảng đã thay đổi ở phiên khác. Tải lại trước khi sửa tiếp.'));
    else if (!validation.valid) actions.append(note(validation.errors[0]));
    else actions.append(note(crystalDraftChanged(this.draft) ? 'Có thay đổi chưa lưu.' : 'Bảng đã đồng bộ.'));
    boardWrap.append(actions); workspace.append(boardWrap);
    const inventory = element('div',null,'cr-inventory'), filter = selectInput(Object.entries(TYPE_NAMES).map(([value, label]) =>
      ({value, label})), this.itemType, 'Lọc màu tinh thể');
    filter.dataset.crFocus = 'item-type'; filter.addEventListener('change', () => { this.itemType = Number(filter.value); this.render(); });
    if(this.nativePanel&&!this.recommendation){
      const filters=element('div',null,'cr-native-filters');
      for(const [i,type] of [0,2,3,4].entries()){
        const b=this.button(TYPE_NAMES[type],()=>{this.itemType=type;this.render();},{testId:`cr-filter-${type}`});
        b.setAttribute('aria-pressed',String(this.itemType===type));
        this.skin(b,type===0?`btn_all${this.itemType===type?'_selected':''}_t`:`btn_type${i}${this.itemType===type?'_selected':''}_t`);
        b.style.left=(i*46)+'px';filters.append(b);
      }
      inventory.append(filters);
    }else if(!this.recommendation)inventory.append(field('Tinh thể sở hữu', filter));
    const list = element('div', null, 'cr-library'), counts = crystalOwnedCounts(this.meta);
    const shown = Object.values(this.catalog.items).filter(i => counts[i.itemId] && (!this.itemType || i.type === this.itemType))
      .sort((a, b) => b.level - a.level || a.itemId - b.itemId);
    for (const item of shown) {
      const used = validation.counts[item.itemId] || 0, available = Math.max(0, counts[item.itemId] - used);
      const button = this.button('', () => this.addCrystal(item.itemId), {disabled: !this.mutable || !available,
        className: 'cr-card', title: `${nativeText(item.name)}\n${nativeText(item.description)}`, testId: `cr-item-${item.itemId}`});
      button.append(assetImage(item.icon, '', 'cr-icon'));
      const copy = element('span', this.nativePanel?item.attributes.map(a=>crystalAttributeText(a.type,a.valueType,a.value)).join('\n'):nativeText(item.name), 'cr-card-copy');
      copy.append(element('span', this.nativePanel?`x${available}`:`${available}/${counts[item.itemId]} còn để lắp`, 'cr-count')); button.append(copy); list.append(button);
    }
    if (!shown.length) list.append(note('Chưa có tinh thể màu này trong túi.', 'cr-empty'));
    if(this.recommendation)this.renderRecommendations(inventory);
    else{inventory.append(list);this.releaseRecommendationPortrait();}
    workspace.append(inventory); section.append(workspace);
    const tanks = (this.meta.tanks || []).filter(t => t.containerType === 0);
    const tank = selectInput(tanks.map(t => ({value: t.uuid, label: `${this.tankName(t.tankId)} · Lv${t.level}`})),
      this.tankUuid, 'Tank dùng bảng tinh thể');
    tank.dataset.crFocus = 'tank'; tank.disabled = !this.mutable;
    tank.addEventListener('change', () => { this.tankUuid = tank.value; this.render(); });
    const currentTank = tanks.find(t => t.uuid === this.tankUuid), currentId = currentTank?.crystalSchemeId || 1;
    const assign = element('div', null, 'cr-toolbar cr-assign');
    assign.append(field('Gán cho tank', tank), this.button('Dùng bảng này', () => this.assignBoard(),
      {disabled: !this.mutable || !currentTank || crystalDraftChanged(this.draft) || currentId === this.boardId,
        testId: 'cr-assign', title: crystalDraftChanged(this.draft) ? 'Lưu bảng trước khi gán.' : ''}),
    note(currentTank ? `Đang dùng: ${this.boardName(this.crystals.boards[currentId] || {boardId: currentId})}` : 'Chưa có tank sở hữu.'));
    if(!this.nativePanel)section.append(assign);
    if(this.nativePanel)this.layoutNativeBoards(section,toolbar,actions);
  }

  layoutNativeBoards(section,toolbar,actions) {
    // NewCrystalFrame 954x550; scheme horizontalCenter=45,y=130;
    // left inventory x10,y110,w250; right actions x784,y72,w166.
    const background=this.assets.get('crystal.background');
    if(background){const img=assetImage(background,'','cr-native-background');section.prepend(img);}
    const preview=crystalBoardPreview(this.draft.items,this.catalog);
    const summary=element('div',null,'cr-native-attributes');summary.append(element('strong',`Tổng cấp: ${preview.level}`),note(preview.text||'Chưa lắp tinh thể.'));section.append(summary);
    this.renderNativeSchemeSelector(toolbar);
    const controls=[...toolbar.children];
    controls.forEach((node,i)=>node.classList.add('cr-control-'+i));
    const save=actions.querySelector('[data-testid="cr-save"]'),reset=actions.querySelector('[data-testid="cr-reset"]');
    this.skin(save,'btn_save_scheme_t');this.skin(reset,'btn_reset_scheme_t');
    this.skin(toolbar.querySelector('[data-testid="cr-rename"]'),'btn_edit');
    for(const [tab,key] of [['boards',this.recommendation?'btn_set_crystal_t':'btn_set_crystal_selected_t'],['craft','btn_crystal_make_t'],['exchange','btn_crystal_convert_t'],['sell','btn_crystal_sell_t']])
      this.skin(section.querySelector(`[data-testid="cr-tab-${tab}"]`),key);
    const boardsButton=section.querySelector('[data-testid="cr-tab-boards"]');
    boardsButton.setAttribute('aria-pressed',String(!this.recommendation));
    if(this.recommendation)boardsButton.className=boardsButton.className.replace(/\bis-active\b/g,'');
    const recommend=this.button('Phương án đề cử',()=>{this.recommendation=true;this.notice='';this.render();},{testId:'cr-recommend'});
    recommend.setAttribute('aria-pressed',String(this.recommendation));
    this.skin(recommend,this.recommendation?'btn_rmd_crystal_selected_t':'btn_rmd_crystal_t');section.append(recommend);
    const name=toolbar.querySelector('[data-cr-focus="name"]'),nameBackground=this.assets.get('crystal.nameBackground');
    if(name&&nameBackground)name.style.backgroundImage=`url("${nameBackground.url}")`;
    const assign=this.button('Gán bảng',()=>{this.auxDialog='assign';this.render();},
      {testId:'cr-assign-open',className:'cr-assign-open',disabled:!this.mutable,title:'Chọn tank dùng bảng tinh thể'});
    const skin=this.assets.get('zh_CN/gui_summer/controls/public/button_3_blue.png');
    if(skin)assign.style.backgroundImage=`url("${skin.url}")`;
    section.append(assign);
  }
  renderNativeSchemeSelector(toolbar) {
    // NewCrystalFrame: 520x39 at center+45,y72; five 68x35 cells.
    const boards=Object.values(this.crystals.boards), count=boards.length+(boards.length<this.catalog.maximumBoards?1:0);
    const selected=boards.findIndex(b=>b.boardId===this.boardId);
    if(this.schemeBoard!==this.boardId){if(this.schemeStart==null||selected<this.schemeStart||selected>=this.schemeStart+5)this.schemeStart=Math.max(0,selected-4);this.schemeBoard=this.boardId;}
    this.schemeStart=Math.max(0,Math.min(this.schemeStart||0,Math.max(0,count-5)));
    const root=element('div',null,'cr-scheme-selector');root.setAttribute('aria-label','Bảng tinh thể');
    root.append(this.position(element('span','Bảng tinh thể','cr-scheme-label'),-4,9,114));
    for(const [direction,x,key] of [[-1,109,'btn_left_t'],[1,478,'btn_right_t']]){
      const b=this.button(direction<0?'Các bảng trước':'Các bảng tiếp',()=>{this.schemeStart+=direction;this.render();},
        {disabled:!!this.pending||(direction<0?this.schemeStart===0:this.schemeStart+5>=count),testId:direction<0?'cr-board-prev':'cr-board-next'});
      this.skin(b,key);root.append(this.position(b,x,5));
    }
    const list=this.position(element('div',null,'cr-scheme-list'),140,2,340,35);
    for(let index=this.schemeStart;index<Math.min(count,this.schemeStart+5);index++){
      const board=boards[index],isSelected=board?.boardId===this.boardId;
      const b=this.button(board?this.boardName(board):'Thêm bảng',()=>{if(!board)return this.addBoard();this.boardId=board.boardId;this.selectedSlot=null;this.render();},
        {disabled:board?!!this.pending:!this.mutable,testId:board?`cr-board-${board.boardId}`:'cr-add-board'});
      this.skin(b,board?(isSelected?'btn_scheme_selected':'btn_scheme'):'btn_add_scheme');
      if(board){b.classList.add('cr-scheme-name');b.setAttribute('aria-pressed',String(isSelected));b.dataset.crFocus=`board-${board.boardId}`;}
      list.append(this.position(b,(index-this.schemeStart)*68-3,1.5));
    }
    root.append(list);toolbar.replaceChildren(root,toolbar.children[2],toolbar.children[3]);
    // Keep existing name input, rename callback and dirty-name close guard intact.
    toolbar.children[1].classList.add('cr-native-name');toolbar.children[2].classList.add('cr-native-rename');
  }
  skinCheckbox(check,key) {
    const a=this.assets?.get?.('crystal.'+key);if(!a)return;
    check.classList.add('cr-native-check');Object.assign(check.style,{backgroundImage:`url("${a.url}")`,width:a.width+'px',height:a.height+'px'});
  }
  renderNativePager(section,pages) {
    // IINumPaging / NumPagingProxy, not GarageNumPaging: ten numbered cells,
    // 30px pitch, hidden boundary arrows and a sliding page-number window.
    const count=Math.min(10,pages),page=this.exchangePage+1;
    let first=Math.min(this.exchangeFirstPage||1,Math.max(1,pages-count+1));
    if(page>=first+count)first=page-count+1;else if(page<first)first=page;
    this.exchangeFirstPage=first;
    const width=(count+2)*30,pager=this.position(element('div',null,'cr-exchange-pages'),(900-width)/2,509,width,26);
    pager.setAttribute('aria-label','Trang đổi tinh thể');
    const add=(label,target,key,x,id,hidden=false)=>{
      const b=this.button(label,()=>{this.exchangePage=target-1;this.render();},{disabled:!!this.pending||hidden,testId:id});
      this.skin(b,key);if(hidden)b.style.visibility='hidden';pager.append(this.position(b,x,(26-(this.assets.get('crystal.'+key)?.height||26))/2));return b;
    };
    add('Trang trước',page-1,'paging_btn_pre_page',0,'cr-exchange-prev',page===1);
    for(let i=0;i<count;i++){const n=first+i,b=add(`Trang ${n}`,n,`paging_btn_num${n}${n===page?'_select':''}`,30+i*30,`cr-exchange-page-${n}`);if(n===page)b.setAttribute('aria-current','page');}
    add('Trang tiếp',page+1,'paging_btn_next_page',width-30,'cr-exchange-next',page===pages);section.append(pager);
  }
  skin(button,key) {
    const a=this.assets?.get?.('crystal.'+key);if(!button||!a)return;
    button.setAttribute('aria-label',button.textContent);button.title=button.title||button.textContent;
    button.style.backgroundImage=`url("${a.url}")`;button.style.width=a.width+'px';button.style.height=a.height+'px';button.classList.add('cr-native-button');
  }

  renderAwards(section, kind) {
    const award = this.crystals.lastAward;
    if (!award || award.kind !== kind) return;
    const list = element('div', null, 'cr-awards'); list.setAttribute('aria-label', 'Tinh thể vừa nhận');
    for (const group of award.award.groups) for (const row of group.items) {
      const item = this.catalog.items[row.itemId];
      if (!item) continue;
      const card = element('div', null, 'cr-card');
      card.append(assetImage(item.icon, '', 'cr-icon'), element('span', `${nativeText(item.name)} ×${row.count}`, 'cr-card-copy'));
      list.append(card);
    }
    if (list.childElementCount) section.append(element('h4', 'Kết quả vừa nhận'), list);
  }

  position(node,x,y,width,height) {
    Object.assign(node.style,{position:'absolute',left:x+'px',top:y+'px'});
    if(width!=null)node.style.width=width+'px';if(height!=null)node.style.height=height+'px';return node;
  }
  renderNativeCraft(section) {
    section.classList.add('cr-native-dialog');
    const art=this.assets.get('crystal.img_crystal_make_bk_t');
    if(art)section.append(this.position(assetImage(art,'','cr-dialog-art'),(1200-art.width)/2,(800-art.height)/2));
    for(const [key,x,y] of [['img_send_1_t',338,513],['img_send_2_t',678,513],['word_discount_t',854,617]]) {
      const asset=this.assets.get('crystal.'+key);if(asset)section.append(this.position(assetImage(asset,'','cr-craft-art'),x,y));
    }
    section.append(this.position(element('span','CHẾ TẠO TINH THỂ - XU KHÓA','cr-craft-heading'),699,490.5,165,21));
    const info=this.button('Hướng dẫn chế tạo tinh thể',()=>{this.auxDialog='craft-info';this.render();},{testId:'cr-craft-info'});
    this.skin(info,'btnInfo');section.append(this.position(info,744,28));
    for(const tier of [0,1]){
      const remaining=crystalGuaranteeRemaining(this.crystals,284+tier);
      section.append(this.position(note(crystalGuaranteeText(this.presentation,tier,remaining),'cr-craft-counter'),tier===0?270:617,592,300));
      for(const pack of this.catalog.packages.filter(p=>p.tier===tier)){
        const x=(tier===0?328:673)+(pack.count===5?111:0);
        const b=this.button(`Chế tạo ${pack.count} lần`,()=>this.craft(pack.kind),{disabled:!this.mutable||!(this.meta.character?.currency?.[pack.currency]>=pack.price),testId:`cr-craft-${pack.kind}`});
        this.skin(b,pack.count===5?'btn_make_five_t':'btn_make_one_t');section.append(this.position(b,x,634));
        const price=element('div',null,'cr-price'+(this.meta.character?.currency?.[pack.currency]>=pack.price?'':' is-short'));
        price.setAttribute('aria-label',`${pack.price} xu khóa`);const coin=this.assets.get('crystal.currencyGift');
        if(coin)price.append(assetImage(coin,''));price.append(element('span',numberText(pack.price)));
        section.append(this.position(price,tier===0?x-9:x-8,665,90,22));
      }
    }
    this.renderAwards(section,19);
  }
  renderNativeExchange(section) {
    section.classList.add('cr-native-dialog');
    this.exchangeLevels ||= [1,2,3,4,5];
    const recipes=this.catalog.recipes.filter(r=>this.exchangeLevels.includes(this.catalog.items[r.itemId].level));
    const pages=Math.max(1,Math.ceil(recipes.length/8));this.exchangePage=Math.min(this.exchangePage||0,pages-1);
    for(const [i,recipe] of recipes.slice(this.exchangePage*8,this.exchangePage*8+8).entries()){
      const item=this.catalog.items[recipe.itemId],card=this.position(element('div',null,'cr-native-exchange-card'),30+(i%4)*210,38+Math.floor(i/4)*232,204,224);
      const bg=this.assets.get('crystal.img_convert_bk');if(bg)card.append(this.position(assetImage(bg),0,0));
      card.append(this.position(element('strong',nativeText(item.name)),4,3,196),this.position(assetImage(item.icon,'','cr-exchange-icon'),52,40,100,100),this.position(note(`${numberText(recipe.pieceCost)} mảnh`),2,154,200));
      const b=this.button('Đổi tinh thể',()=>{this.recipeId=recipe.recipeId;this.exchangeCount=1;return this.exchange();},{disabled:!this.mutable||recipe.pieceCost>this.pieces,testId:`cr-exchange-${recipe.recipeId}`,title:nativeText(item.description)});
      this.skin(b,'btn_convert_t');card.append(this.position(b,66.5,185));section.append(card);
    }
    const filterTitle=this.assets.get('crystal.word_filter_level_t');if(filterTitle)section.append(this.position(assetImage(filterTitle,''),30,508.5));
    for(const level of [1,2,3,4,5]){const check=element('input');check.type='checkbox';check.checked=this.exchangeLevels.includes(level);check.disabled=!!this.pending;check.dataset.crFocus='exchange-level-'+level;check.setAttribute('aria-label','Lọc cấp '+level);
      this.skinCheckbox(check,`btn_${level}_${check.checked?'selected':'unselected'}`);
      check.addEventListener('change',()=>{this.exchangeLevels=check.checked?[...this.exchangeLevels,level]:this.exchangeLevels.filter(x=>x!==level);this.exchangePage=0;this.render();});section.append(this.position(check,101+(level-1)*33,505));}
    this.renderNativePager(section,pages);
    section.append(this.position(note(`${numberText(this.pieces)} mảnh`),731,505,150));
  }

  renderCraft(section) {
    if(this.nativePanel)return this.renderNativeCraft(section);
    const tiers = element('div', null, 'cr-tiers');
    for (const tier of [0, 1]) {
      const panel = element('div', null, 'cr-tier'), remaining = crystalGuaranteeRemaining(this.crystals, 284 + tier);
      panel.append(element('h4', tier === 0 ? 'Chế tạo I' : 'Chế tạo II'),
        note(remaining === null ? 'Đang đồng bộ lượt bảo đảm.' : `Còn ${remaining} lượt đến lượt bảo đảm.`));
      const actions = element('div', null, 'cr-actions');
      for (const pack of this.catalog.packages.filter(p => p.tier === tier)) {
        actions.append(this.button(`${pack.count} lần · ${pack.price} xu khóa`, () => this.craft(pack.kind),
          {disabled: !this.mutable || !(this.meta.character?.currency?.[pack.currency] >= pack.price), testId: `cr-craft-${pack.kind}`}));
      }
      panel.append(actions); tiers.append(panel);
    }
    section.append(tiers, note('Hai gói đếm lượt bảo đảm riêng. Mỗi lần chế tạo nhận một tinh thể.'));
    this.renderAwards(section, 19);
  }

  renderExchange(section) {
    if(this.nativePanel)return this.renderNativeExchange(section);
    const options = this.catalog.recipes.filter(r => this.catalog.items[r.itemId].level === this.exchangeLevel);
    if (!options.some(r => r.recipeId === this.recipeId)) this.recipeId = options[0]?.recipeId ?? null;
    const toolbar = element('div', null, 'cr-toolbar');
    const level = selectInput([{value: 4, label: 'Cấp 4'}, {value: 5, label: 'Cấp 5'}], this.exchangeLevel, 'Cấp tinh thể đổi');
    level.dataset.crFocus = 'exchange-level'; level.disabled = !!this.pending;
    level.addEventListener('change', () => { this.exchangeLevel = Number(level.value); this.render(); });
    const recipes = selectInput(options.map(r => ({value: r.recipeId, label: nativeText(this.catalog.items[r.itemId].name)})), this.recipeId, 'Tinh thể muốn đổi');
    recipes.dataset.crFocus = 'recipe'; recipes.disabled = !!this.pending;
    recipes.addEventListener('change', () => { this.recipeId = Number(recipes.value); this.render(); });
    const count = textInput(this.exchangeCount, {type: 'number'}); count.min = '1'; count.max = '999'; count.step = '1';
    count.className = 'cr-quantity'; count.dataset.crFocus = 'exchange-count'; count.disabled = !!this.pending;
    count.addEventListener('input', () => { this.exchangeCount = Number(count.value); this.render(); });
    toolbar.append(field('Cấp', level), field('Công thức', recipes), field('Số lượng', count)); section.append(toolbar);
    const recipe = this.catalog.recipes.find(r => r.recipeId === this.recipeId);
    if (!recipe) return;
    const item = this.catalog.items[recipe.itemId], detail = element('div', null, 'cr-card cr-exchange-detail');
    detail.append(assetImage(item.icon, '', 'cr-icon'), element('p', nativeText(item.description), 'cr-description')); section.append(detail);
    const price = recipe.pieceCost * this.exchangeCount, valid = Number.isInteger(this.exchangeCount)
      && this.exchangeCount >= 1 && this.exchangeCount <= 999;
    section.append(note(`Cần ${numberText(valid ? price : NaN)} mảnh · Đang có ${numberText(this.pieces)} mảnh`, 'cr-summary'),
      this.button('Đổi tinh thể', () => this.exchange(), {disabled: !this.mutable || !valid || price > this.pieces, testId: 'cr-exchange'}));
    this.renderAwards(section, 8);
  }

  renderNativeSell(section) {
    section.classList.add('cr-native-dialog');
    const available=crystalSellableCounts(this.meta,this.crystals);
    this.sellSelection ||= new Set(Object.entries(this.sellCounts).flatMap(([id,n])=>Array.from({length:Math.max(0,n)},(_,i)=>`${id}:${i}`)));
    // A changed authoritative reservation/ownership invalidates individual surplus entries.
    for(const key of this.sellSelection){const [id,n]=key.split(':').map(Number);if(n>=(available[id]||0))this.sellSelection.delete(key);}
    const updateCounts=()=>{this.sellCounts={};for(const key of this.sellSelection){const id=key.split(':')[0];this.sellCounts[id]=(this.sellCounts[id]||0)+1;}};
    updateCounts();
    const list=this.position(element('div',null,'cr-native-sell-list'),23,40,650,370);list.style.overflow='auto';
    const canvas=element('div',null,'cr-native-sell-canvas');canvas.style.position='relative';canvas.style.width='625px';list.append(canvas);
    const draw=(at=null)=>{
      const view=crystalSaleWindow(available,this.catalog,typeof at==='number'?at:list.scrollTop);this.sellScroll=view.scrollTop;canvas.style.height=view.height+'px';canvas.replaceChildren();
      for(const {item,ordinal,index} of view.entries){
        const key=`${item.itemId}:${ordinal}`,card=this.position(element('label',null,'cr-native-sell-card'),(index%5)*125,Math.floor(index/5)*185,121,176);
        const bg=this.assets.get('crystal.img_sell_item_bk');if(bg)card.append(this.position(assetImage(bg),0,0));
        card.append(this.position(assetImage(item.icon,nativeText(item.name)),10.5,4,100,100),this.position(element('span',item.attributes.map(a=>crystalAttributeText(a.type,a.valueType,a.value)).join('\n')),5.5,110,110));
        const check=element('input');check.type='checkbox';check.checked=this.sellSelection.has(key);check.disabled=!this.mutable;check.dataset.crFocus='sale-'+key;check.setAttribute('aria-label','Bán '+nativeText(item.name)+' '+(ordinal+1));
        check.addEventListener('change',()=>{if(!this.mutable)return;if(check.checked)this.sellSelection.add(key);else this.sellSelection.delete(key);updateCounts();this.render();});this.skinCheckbox(check,check.checked?'cb_icon':'cb_skin');card.append(this.position(check,(121-(this.assets.get('crystal.cb_skin')?.width||20))/2,176-5-(this.assets.get('crystal.cb_skin')?.height||18)));canvas.append(card);
      }
      if(!view.total)canvas.append(note('Không có tinh thể dư để bán.'));
    };
    list.addEventListener('scroll',draw);section.append(list);draw(this.sellScroll||0);
    this.sellLevels ||= [1,2,3,4,5];
    const levels=this.position(element('div',null,'cr-sell-levels'),0,409,260,70);
    for(const level of [1,2,3,4,5]){
      const check=element('input');check.type='checkbox';check.checked=this.sellLevels.includes(level);check.disabled=!this.mutable;
      check.addEventListener('change',()=>{if(!this.mutable)return;this.sellLevels=check.checked?[...this.sellLevels,level]:this.sellLevels.filter(l=>l!==level);this.sellSelection.clear();for(const item of Object.values(this.catalog.items))if(this.sellLevels.includes(item.level))for(let i=0;i<(available[item.itemId]||0);i++)this.sellSelection.add(`${item.itemId}:${i}`);updateCounts();this.render();});
      check.dataset.crFocus='sale-level-'+level;check.setAttribute('aria-label','Chọn bán cấp '+level);this.skinCheckbox(check,check.checked?'cb_icon':'cb_skin');
      const x=79+((level-1)%3)*75-(this.assets.get('crystal.cb_skin')?.width||20),y=level<=3?0:36;levels.append(this.position(check,x,y),this.position(element('span','Lv'+level),x+25,y+6));
    }section.append(levels);
    const sale=this.sale(),sell=this.button('Bán tinh thể đã chọn',()=>this.sell(),{disabled:!this.mutable||!sale.valid,testId:'cr-sell'});this.skin(sell,'btn_sell_t');section.append(this.position(sell,533,445),this.position(note(`${numberText(sale.fragments)} mảnh`),490,412,160));
    section.append(this.position(note(`${sale.ids.length} viên đã chọn · Tối đa 1000/lần`),25,472,450));
  }

  renderSell(section) {
    if(this.nativePanel)return this.renderNativeSell(section);
    section.append(note('Chỉ bán tinh thể chưa dùng trong bảng. Một viên có thể dùng lại ở nhiều bảng; số giữ lại là mức cao nhất giữa các bảng.'));
    const available = crystalSellableCounts(this.meta, this.crystals), list = element('div', null, 'cr-sell-list');
    for (const item of Object.values(this.catalog.items).filter(i => available[i.itemId] > 0)) {
      const row = element('div', null, 'cr-sell-row');
      const copy = element('div', nativeText(item.name), 'cr-card-copy');
      copy.append(element('span', `Có thể bán ${available[item.itemId]} · ${item.sellPieces} mảnh/viên`, 'cr-count'));
      const count = textInput(this.sellCounts[item.itemId] || 0, {type: 'number'});
      count.className = 'cr-quantity'; count.dataset.crFocus = `sell-${item.itemId}`;
      count.min = '0'; count.max = String(Math.min(1000, available[item.itemId])); count.step = '1'; count.disabled = !this.mutable;
      count.setAttribute('aria-label', `Số ${nativeText(item.name)} muốn bán`);
      count.addEventListener('input', () => { this.sellCounts[item.itemId] = Number(count.value); this.render(); });
      row.append(assetImage(item.icon, '', 'cr-icon'), copy, count); list.append(row);
    }
    if (!list.childElementCount) list.append(note('Không có tinh thể dư để bán.', 'cr-empty'));
    const sale = this.sale();
    section.append(list, note(`Đã chọn ${sale.ids.length} viên · Nhận ${numberText(sale.fragments)} mảnh`, 'cr-summary'),
      this.button('Bán tinh thể đã chọn', () => this.sell(), {disabled: !this.mutable || !sale.valid, testId: 'cr-sell'}));
  }
}
