/* Presentation only: current TankLib BuffTool, CTank/TankBodyBase/TankCannon.
 * Buff vectors and native callbacks, not elapsed countdowns, own this state.
 * Current source exports/hashes: M72 evidence/filter_source/provenance.json.
 */
export const NATIVE_STATIC_SHOW = Object.freeze({NONE: 0, STONE: 2, FREEZE: 3, GOLDEN: 7});
export const NATIVE_STATIC_MATRICES = Object.freeze({
  freeze: Object.freeze([.3086, .6094, .082, -.5, 0, .3086, .6094, .082, -.1, 20,
    .3086, .6094, .082, .1, 30, 0, 0, 0, 1, 0]),
  golden: Object.freeze([1, 0, 0, 0, 107, 0, 1, 0, 0, 73, 0, 0, 1, 0, -111, 0, 0, 0, 1, 0]),
});
export const NATIVE_STONE_SOURCE = Object.freeze({matrixX: 3, matrixY: 3,
  matrix: Object.freeze([-2, -1, -1, 0, 1, 0, 1, 2]), divisor: 5, bias: 100,
  preserveAlpha: true, clamp: true,
  grayMatrix: Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0]),
  rendererReady: false, unresolved: 'native-3x3-convolution-has-eight-coefficients'});

export function isNativeSpeedBuff(row) {
  // BuffTool.isSpeedBuff + CTank.addBuff: do not infer from name, ID or value.
  return !!row && Number(row.nEffectType) === 201 && Number(row.nTypeParam) === 11
    && Number(row.iAspect) === 1;
}

export function isNativeStaticBuff(row) {
  return [2, 3, 7].includes(Number(row?.nBuffShowType));
}

export function nativeStaticFilter(showType) {
  showType = Number(showType) || 0;
  if (showType === 2) return {showType, kind: 'stone', rendererReady: false,
    matrix: null, source: NATIVE_STONE_SOURCE, unresolved: NATIVE_STONE_SOURCE.unresolved};
  const kind = showType === 3 ? 'freeze' : showType === 7 ? 'golden' : 'none';
  return {showType: kind === 'none' ? 0 : showType, kind, rendererReady: true,
    matrix: NATIVE_STATIC_MATRICES[kind] || null, unresolved: null};
}

/** TankInfo.m_buffVec preserves server vector/insertion order. An integer-keyed
 * JS object cannot supply that order. Never silently sort by instance or ID.
 */
export function orderedNativeBuffs(actor) {
  const buffs = actor?.buffs || {}, order = actor?.buffPresentation?.nativeOrder;
  if (!Array.isArray(order)) return Object.keys(buffs).length
    ? {ready: false, reason: 'native-buff-order-missing', buffs: []}
    : {ready: true, reason: null, buffs: []};
  const result = [], seen = new Set();
  for (const id of order) {
    const key = String(id);
    if (seen.has(key) || !buffs[key]) return {ready: false, reason: 'native-buff-order-inconsistent', buffs: []};
    seen.add(key); result.push(buffs[key]);
  }
  if (seen.size !== Object.keys(buffs).length)
    return {ready: false, reason: 'native-buff-order-inconsistent', buffs: []};
  return {ready: true, reason: null, buffs: result};
}

/** BuffTool.getStaticShowType: first STONE/GOLDEN wins; FREEZE is a fallback. */
export function selectNativeStaticBuff(vector, buffCatalog) {
  let frozen = null;
  for (const buff of vector || []) {
    const row = buffCatalog?.[String(buff.templateId)];
    if (!row) return {ready: false, reason: 'buff-template-missing', showType: 0, instanceId: null};
    const showType = Number(row.nBuffShowType) || 0;
    if ([2, 7].includes(showType)) return {ready: true, reason: null, showType,
      instanceId: buff.instanceId ?? null, templateId: buff.templateId};
    if (showType === 3) frozen = buff;
  }
  return {ready: true, reason: null, showType: frozen ? 3 : 0,
    instanceId: frozen?.instanceId ?? null, templateId: frozen?.templateId ?? null};
}

export function nativeStaticPresentation(actor, buffCatalog) {
  const vector = orderedNativeBuffs(actor);
  if (!vector.ready) return {...nativeStaticFilter(0), ready: false, reason: vector.reason};
  const selected = selectNativeStaticBuff(vector.buffs, buffCatalog);
  return {...nativeStaticFilter(selected.showType), ...selected};
}

/** TankShadow inherits CTank's owner m_tankObjId, although the callbacks
 * originate from its own AINpc buff vector. It therefore checks the OWNER's
 * vector at callback time, not its own vector or the owner's latest state.
 */
export function nativeStaticEventSelection(event, buffCatalog, {shadow = false} = {}) {
  const vector = shadow ? event.ownerNativeOrderSnapshot : event.nativeOrderSnapshot;
  if (!Array.isArray(vector) || vector.some(value => !value || typeof value !== 'object'))
    return {ready: false, reason: shadow ? 'native-static-owner-vector-snapshot-missing'
      : 'native-static-vector-snapshot-missing', showType: 0};
  return selectNativeStaticBuff(vector, buffCatalog);
}

const bodyClass = body => body?.format === 'png-sheet' ? 'bitmap'
  : body?.format === 'swf-derived' ? 'swf' : 'none';
const lifeOf = actor => `${actor?.objectId}:${actor?.lifeEpoch}`;

/** Native ADD/REMOVE callbacks determine when a filter is applied. In
 * particular AINpcModel same-instance replacement emits neither callback.
 * nativeOrderSnapshot on static callbacks must contain ordered compact rows
 * {instanceId, templateId} from the vector AS IT EXISTS at callback time.
 * This class never mutates actor, buffs, native movement or cannon aim.
 */
export class NativeStatusPresentation {
  constructor({ctank = true, shadow = false} = {}) {
    this.ctank = ctank; this.shadow = shadow; this.reset();
  }

  reset(life = null, body = null) {
    this.life = life; this.bodyClass = bodyClass(body); this.sequence = 0;
    this.showType = this.bodyShowType = this.cannonShowType = 0;
    this.ready = true; this.reason = null; this.historyGap = false;
    this.lastChange = null;
  }

  sample({actor, catalog, body, baseExternalId, now}) {
    if (!Number.isFinite(now)) throw new TypeError('A finite presentation time is required');
    if (this.life !== lifeOf(actor)) this.reset(lifeOf(actor),
      catalog?.appearances?.[String(baseExternalId)]?.body || body);
    if (!actor || actor.dead || actor.removed) {
      this.reset(lifeOf(actor), body); return this.snapshot();
    }
    const history = actor.buffPresentation?.nativeHistory
      || (Object.keys(actor.buffs || {}).length === 0 ? [] : null);
    if (!Array.isArray(history)) {
      this.ready = false; this.reason = 'native-buff-history-missing'; return this.snapshot();
    }
    const pending = history.filter(event => event.sequence > this.sequence && event.receivedAt <= now)
      .sort((a, b) => a.sequence - b.sequence);
    if (pending.length && pending[0].sequence > this.sequence + 1) {
      // An offscreen view may miss a bounded history. Do not invent callbacks
      // from the current active set (AINpc replacement makes that incorrect).
      this.historyGap = true; this.ready = false; this.reason = 'native-buff-history-gap';
      this.showType = this.bodyShowType = this.cannonShowType = 0;
    }
    for (const event of pending) {
      this.sequence = event.sequence;
      const row = catalog?.buffs?.[String(event.templateId)];
      if (!row) { this.ready = false; this.reason = 'buff-template-missing'; continue; }
      // CTank processes nEffectType before nBuffShowType. A row may replace
      // the body view and then apply its static filter to that new view.
      if (this.ctank && Number(row.nEffectType) === 55) {
        const external = event.operation === 'add' ? Number(row.fEffectValA) : baseExternalId;
        const next = catalog?.appearances?.[String(external)]?.body;
        if (next) this.changeBody(next);
      }
      if (isNativeStaticBuff(row)) {
        const selected = nativeStaticEventSelection(event, catalog.buffs, {shadow: this.shadow});
        if (!selected.ready) { this.ready = false; this.reason = selected.reason; continue; }
        if (event.operation === 'remove') this.showType = this.bodyShowType = this.cannonShowType = 0;
        if (selected.showType) this.showType = this.bodyShowType = this.cannonShowType = selected.showType;
        if (event.operation === 'remove' || selected.showType) { this.ready = true; this.reason = null; }
        this.lastChange = {sequence: event.sequence, receivedAt: event.receivedAt,
          packetOrder: event.packetOrder ?? null, operation: event.operation, templateId: event.templateId,
          selectedTemplateId: selected.templateId, showType: this.showType};
      }
    }
    if (body) this.changeBody(body);
    return this.snapshot();
  }

  changeBody(body) {
    const next = bodyClass(body);
    // CTank creates a new TankBodyBase only on PNG/SWF class changes. The
    // existing TankCannon and m_isStaticState survive that body replacement.
    if (next !== this.bodyClass) this.bodyShowType = 0;
    this.bodyClass = next;
  }

  snapshot() {
    return {ready: this.ready, reason: this.reason, historyGap: this.historyGap,
      sequence: this.sequence, showType: this.showType, staticState: this.showType !== 0,
      bodyShowType: this.bodyShowType, cannonShowType: this.cannonShowType,
      bodyFilter: nativeStaticFilter(this.bodyShowType),
      cannonFilter: nativeStaticFilter(this.cannonShowType), lastChange: this.lastChange && {...this.lastChange}};
  }
}
