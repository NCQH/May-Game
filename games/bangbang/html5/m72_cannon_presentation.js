import {isNativeStaticBuff, nativeStaticEventSelection} from './m72_status_presentation.js';

const turnRemoteCannon = (angle, goal, speed, elapsed) => {
  // Match IronManActions.bot_beam_dest's shortest arc, including its -180
  // degree tie. The local mouse controller remains independently unchanged.
  const delta = ((goal - angle + 180) % 360 + 360) % 360 - 180;
  const step = speed * Math.max(0, elapsed) / 1000;
  return angle + Math.max(-step, Math.min(step, delta));
};

/** Remote Iron Man's S1603 is an aim goal. Native CTank turns the cannon
 * (and its follow-cannon beam buff) at BuffTemplate.fEffectValB degrees/sec.
 * Replay the bounded aim order from buff addition or the latest native beam
 * tick's actual bearing. Human C514 turns produce actual ticks without S1603;
 * only a received goal permits extrapolation between those ticks. Rendering
 * frequency cannot change the result; no actor/input coordinate is written.
 */
export function remoteIronmanTimingAngle(actor, catalog, now, candidateAngle) {
  if (Number(actor?.tankId) !== 10000001 || actor.dead || actor.removed
      || !Number.isFinite(now)) return candidateAngle;
  const timing = Object.values(actor.buffs || {}).filter(buff =>
    Number(catalog?.buffs?.[String(buff.templateId)]?.nEffectType) === 81)
    .sort((a, b) => (actor.buffPresentation?.changes?.[String(a.templateId)]?.sequence || 0)
      - (actor.buffPresentation?.changes?.[String(b.templateId)]?.sequence || 0)).at(-1);
  const start = timing?.cannonAtAdd;
  const speed = Number(catalog?.buffs?.[String(timing?.templateId)]?.fEffectValB);
  if (!start || ![start.angle, start.at, start.aimSequence, speed].every(Number.isFinite)
      || speed <= 0 || !Array.isArray(actor.cannonAimHistory)) return candidateAngle;
  const events = actor.cannonAimHistory.filter(event =>
    event.sequence > start.aimSequence && event.receivedAt <= now);
  // Anchors retain the goal observed at their packet sequence. This also
  // avoids replaying a pruned prefix from the obsolete channel-start angle.
  const anchor = events.filter(event => event.kind === 'actual').at(-1);
  let angle = anchor?.angle ?? start.angle, goal = angle;
  let at = Math.max(start.at, anchor?.receivedAt ?? start.at);
  if (anchor?.goalSequence > start.aimSequence && Number.isFinite(anchor.goalAngle))
    goal = anchor.goalAngle;
  for (const event of events) {
    if (anchor && event.sequence <= anchor.sequence) continue;
    const due = Math.max(at, event.receivedAt);
    angle = turnRemoteCannon(angle, goal, speed, Math.max(0, due - at));
    goal = event.angle; at = due;
  }
  return turnRemoteCannon(angle, goal, speed, Math.max(0, now - at)) * Math.PI / 180;
}

const lifeOf = actor => `${actor?.objectId}:${actor?.lifeEpoch}`;
const componentKey = part => `${part?.format || 'none'}:${part?.componentId ?? 0}`;
const eventOrder = (a, b) => a.at - b.at || a.packetOrder - b.packetOrder
  || a.sequence - b.sequence || a.kindOrder - b.kindOrder;

/** TankCannon.addStaticEffect stops ONLY MCUtil.fetchMcRoot's SWF timeline.
 * Its independent nested artwork and PNG CAnimation continue normally. A
 * subsequent native fire() calls gotoAndPlay('fire'), even while the CTank
 * static flag still rejects cannon-angle setters. Removal calls play(), then
 * the native static selector may immediately stop it again.
 *
 * sample returns elapsed/fireAge for the controlled SWF root and childElapsed
 * for cannon-nested independent artwork. It never writes actor or input.
 * Candidate aim is sampled once per rendered frame and held while static;
 * this does not claim reconstruction of unrecorded subframe mouse positions.
 */
export class NativeCannonPresentation {
  constructor({ctank = true, shadow = false} = {}) {
    this.ctank = ctank; this.shadow = shadow; this.life = null;
  }

  reset({actor, catalog, baseExternalId, cannon, now, startedAt, candidateAngle}) {
    this.life = lifeOf(actor);
    const base = catalog?.appearances?.[String(baseExternalId)];
    this.cannon = base ? base.cannon || null : cannon;
    this.component = componentKey(this.cannon);
    this.componentAt = actor?.lastSnapshotAt ?? startedAt;
    this.startedAt = startedAt;
    this.clockAt = Math.min(now, startedAt, actor?.lastSnapshotAt ?? now);
    this.pausedSinceStart = 0; this.paused = false; this.staticState = false;
    this.fireAge = null; this.fireAt = null; this.buffSequence = this.fireSequence = 0;
    this.angle = Number.isFinite(candidateAngle) ? candidateAngle : 0;
    this.ready = true; this.reason = null; this.historyGap = false;
    this.lastChange = null; this.componentGeneration = 0;
    this.hasFireJournal = false;
  }

  get swf() { return this.cannon?.format === 'swf-derived'; }

  advance(at) {
    at = Math.max(this.clockAt, at);
    const delta = at - this.clockAt;
    if (this.swf && this.paused)
      this.pausedSinceStart += Math.max(0, at - Math.max(this.clockAt, this.startedAt));
    else if (this.fireAge != null) this.fireAge += delta;
    this.clockAt = at;
  }

  changeComponent(cannon, at) {
    if (componentKey(cannon) === this.component) return;
    this.cannon = cannon; this.component = componentKey(cannon);
    this.componentAt = at; this.componentGeneration += 1;
    // TankCannon object/filter survives setDisplay, but the replacement SWF
    // root loads with gotoAndPlay(0). No implicit reapplication of static stop.
    this.paused = false; this.pausedSinceStart = 0;
    this.fireAge = this.fireAt = null;
  }

  buff(event, catalog, baseExternalId) {
    const row = catalog?.buffs?.[String(event.templateId)];
    if (!row) { this.ready = false; this.reason = 'buff-template-missing'; return; }
    if (this.ctank && Number(row.nEffectType) === 55) {
      const external = event.operation === 'add' ? Number(row.fEffectValA) : baseExternalId;
      const appearance = catalog?.appearances?.[String(external)];
      if (appearance) this.changeComponent(appearance.cannon || null, event.at);
    }
    if (!isNativeStaticBuff(row)) return;
    const selected = nativeStaticEventSelection(event, catalog.buffs, {shadow: this.shadow});
    if (!selected.ready) { this.ready = false; this.reason = selected.reason; return; }
    if (event.operation === 'remove') {
      this.staticState = false; this.paused = false;
    }
    if (selected.showType) {
      this.staticState = true; this.paused = this.swf;
    }
    this.lastChange = {sequence: event.sequence, operation: event.operation,
      receivedAt: event.at, packetOrder: event.packetOrder, showType: selected.showType};
  }

  sample({actor, catalog, body, baseExternalId, cannon, now, lastFire = null,
    startedAt = actor?.lastSnapshotAt ?? now, candidateAngle = 0, staticPresentation = null}) {
    if (![now, startedAt, candidateAngle].every(Number.isFinite))
      throw new TypeError('Finite cannon presentation times and candidate angle are required');
    if (this.life !== lifeOf(actor)) this.reset({actor, catalog, baseExternalId, cannon,
      now, startedAt, candidateAngle});
    if (!actor || actor.dead || actor.removed) {
      this.reset({actor, catalog, baseExternalId, cannon, now, startedAt, candidateAngle});
      return this.snapshot(now, lastFire);
    }
    const history = actor.buffPresentation?.nativeHistory
      || (Object.keys(actor.buffs || {}).length === 0 ? [] : null);
    if (!Array.isArray(history)) {
      this.ready = false; this.reason = 'native-buff-history-missing';
      return this.snapshot(now, lastFire);
    }
    const pending = history.filter(event => event.sequence > this.buffSequence && event.receivedAt <= now);
    if (pending.length && pending[0].sequence > this.buffSequence + 1) {
      this.historyGap = true; this.ready = false; this.reason = 'native-buff-history-gap';
    }
    const events = pending.map(event => ({...event, kind: 'buff', at: event.receivedAt,
      packetOrder: event.packetOrder ?? 0, kindOrder: 1}));
    // combat_state keeps the legacy no-fire actor shape until its first fire.
    // Absence with no sequence/lastFire is an empty native history, not a gap.
    const fireHistory = actor.cannonFireHistory
      ?? ((actor.cannonFireSequence ?? 0) === 0 && lastFire == null ? [] : null);
    this.hasFireJournal = Array.isArray(fireHistory);
    if (this.hasFireJournal) {
      const fires = fireHistory.filter(event => event.sequence > this.fireSequence
        && event.receivedAt <= now && (event.lifeEpoch == null || event.lifeEpoch === actor.lifeEpoch));
      if (fires.length && fires[0].sequence > this.fireSequence + 1) {
        this.historyGap = true; this.ready = false; this.reason = 'native-cannon-fire-history-gap';
      }
      for (const event of fires) events.push({...event, kind: 'fire', at: event.receivedAt,
        packetOrder: event.packetOrder ?? 0, kindOrder: 2});
    } else if (pending.some(event => isNativeStaticBuff(catalog?.buffs?.[String(event.templateId)]))
        || this.staticState || this.pausedSinceStart) {
      this.ready = false; this.reason = 'native-cannon-fire-history-missing';
    }
    if (startedAt !== this.startedAt) {
      if (startedAt < this.clockAt) {
        this.ready = false; this.reason = 'native-cannon-start-before-retained-clock';
      }
      events.push({kind: 'start', at: startedAt, packetOrder: -1, sequence: -1, kindOrder: 0});
    }
    events.sort(eventOrder);
    for (const event of events) {
      this.advance(event.at);
      if (event.kind === 'start') {
        this.startedAt = startedAt; this.pausedSinceStart = 0;
      } else if (event.kind === 'buff') {
        this.buffSequence = Math.max(this.buffSequence, event.sequence);
        this.buff(event, catalog, baseExternalId);
      } else {
        this.fireSequence = Math.max(this.fireSequence, event.sequence);
        if (this.cannon) {
          this.fireAt = event.at; this.fireAge = 0; this.paused = false;
        }
      }
    }
    // A ready component supplied by the renderer is the final source identity.
    // This also handles non-buff component changes without inventing a fire.
    this.changeComponent(cannon, now); this.advance(now);
    if (!this.staticState) this.angle = candidateAngle;
    if (staticPresentation?.ready && staticPresentation.staticState !== this.staticState) {
      this.ready = false; this.reason = 'native-cannon-static-state-mismatch';
    }
    return this.snapshot(now, lastFire);
  }

  snapshot(now, lastFire) {
    const childElapsed = Math.max(0, now - this.startedAt);
    const rawFireAge = lastFire == null ? null : now - lastFire;
    return {ready: this.ready, reason: this.reason, historyGap: this.historyGap,
      angle: this.angle, staticState: this.staticState, paused: this.swf && this.paused,
      elapsed: this.swf ? Math.max(0, childElapsed - this.pausedSinceStart) : childElapsed,
      fireAge: this.swf && this.hasFireJournal ? this.fireAge : rawFireAge,
      childElapsed, pausedMs: this.pausedSinceStart, fireAt: this.fireAt,
      buffSequence: this.buffSequence, fireSequence: this.fireSequence,
      componentGeneration: this.componentGeneration,
      angleSampling: 'per-render-candidate-held-while-native-static',
      lastChange: this.lastChange && {...this.lastChange}};
  }
}
