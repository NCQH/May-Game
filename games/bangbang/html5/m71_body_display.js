import {NativeBodyTurn, NativeBitmapBodyTimeline, nativeForwardBodyDirection}
  from './m7_body_motion.js';
import {NativeBodyTimeline} from './battle_timeline.js';

const identity = body => `${body?.format || 'none'}:${body?.componentId ?? 0}`;
const isBitmap = body => body?.format === 'png-sheet';
const stateFlags = state => ({moving: state === 'move', rushing: state === 'rush'});

/** Source body-view state, separate from ground movement and cannon aim.
 * A bounded command history lets a slow RAF apply every intervening native
 * begin/stop. Neither this class nor its clocks can change the actor or motion.
 */
export class NativeBodyDisplay {
  constructor(body, direction, at, {facingCommands = [], buffSequence = 0} = {}) {
    this.turn = new NativeBodyTurn(direction ?? 8);
    this.faceSeen = new Set(facingCommands.map(command => command.key));
    this.animationSeen = new Set();
    this.buffSequence = buffSequence; this.skillKey = null;
    this.generation = 0; this.frozen = false; this.lastAt = at;
    this.loadBody(body, at, false);
  }

  loadBody(body, at, resetRotation = true) {
    const changed = this.body && identity(this.body) !== identity(body);
    if (changed && resetRotation && (!isBitmap(body) || !isBitmap(this.body))) {
      // A new SWF load snaps setFront(direction,true). A PNG/SWF class change
      // constructs TankBodyBase with NONE8/defaultRotation0, without copying
      // the old facing. Same-class PNG init leaves Rotate running.
      this.turn = new NativeBodyTurn(isBitmap(body) === isBitmap(this.body) ? this.turn.direction : 8);
    }
    this.body = body; this.loadedAt = at; this.animationState = 'idle';
    this.animationKey = null; this.lastAt = at; this.generation += 1;
    const derived = body?.derived;
    this.timeline = isBitmap(body) && body.directionLayout?.mode === 'eight-groups'
      ? new NativeBitmapBodyTimeline(body.directionLayout.framesPerDirection || 1, body.animation || {})
      : derived?.mode === 'body-layers' && derived.animation?.nativeEndExclusive
        ? new NativeBodyTimeline(derived.animation.nativeEndExclusive, derived.timing?.nominalTickMs,
          {includeLastFrame:derived.sourceFormat==='loan-chien-godot-atlas-v1' && derived.animation.loopIncludesLastFrame===true}) : null;
    if (this.timeline) this.advance(at, false);
  }

  advance(at, frozen = this.frozen) {
    at = Math.max(at, this.lastAt);
    const flags = {...stateFlags(this.animationState), frozen};
    if (this.timeline instanceof NativeBitmapBodyTimeline) {
      this.timeline.sample(at, {...flags, commandKey: this.animationKey, commandAt: this.lastAt});
    } else this.timeline?.sample(at, flags);
    this.lastAt = at; this.frozen = frozen;
  }

  animation(command) {
    if (command.at < this.loadedAt) return;
    const at = Math.max(this.lastAt, command.at);
    this.advance(at);
    this.animationState = command.state; this.animationKey = command.key;
    if (this.timeline instanceof NativeBitmapBodyTimeline) {
      this.timeline.setState(this.frozen ? 'freeze' : command.state, at);
      this.timeline.commandKey = command.key;
    }
    // SWF MOVE/IDLE/RUSH changes interval/delta without resetting its counter.
  }

  sample({actor, position, body, baseExternalId, catalog, now, frozen = false}) {
    const events = [];
    const faces = position.bodyFacingCommands || [];
    for (const command of faces) if (!this.faceSeen.has(command.key)) {
      events.push({kind: 'face', at: command.startedAt, order: command.sequence, command});
      this.faceSeen.add(command.key);
    }
    const animations = position.bodyAnimationCommands || [];
    for (const command of animations) if (!this.animationSeen.has(command.key)) {
      events.push({kind: 'animation', at: command.at, order: command.sequence, command});
      this.animationSeen.add(command.key);
    }
    const changes = actor.buffPresentation?.history
      || Object.values(actor.buffPresentation?.changes || {}).sort((a, b) => a.sequence - b.sequence);
    for (const change of changes) {
      if (change.sequence <= this.buffSequence) continue;
      this.buffSequence = change.sequence;
      const buff = catalog.buffs?.[String(change.templateId)];
      if (Number(buff?.nEffectType) !== 55) continue;
      const external = change.operation === 'add' ? Number(buff.fEffectValA) : baseExternalId;
      const nextBody = catalog.appearances?.[String(external)]?.body;
      if (nextBody) events.push({kind: 'body', at: change.receivedAt, order: change.sequence, body: nextBody});
    }
    const direction = (actor.objectId >>> 26) === 0
      ? nativeForwardBodyDirection(actor.lastSkillAim, catalog.skills) : null;
    const skillKey = direction == null ? null : `${actor.lastSkillAim.receivedAt}:${actor.lastSkillAim.sourceSequence}`;
    if (skillKey && skillKey !== this.skillKey) events.push({kind: 'face',
      at: actor.lastSkillAim.receivedAt, order: actor.lastSkillAim.sourceSequence ?? 0,
      command: {direction, delayFactor: 1}});
    this.skillKey = skillKey;
    events.sort((a, b) => a.at - b.at || a.order - b.order);
    for (const event of events) {
      if (event.at > now) continue;
      if (event.kind === 'face') this.turn.setFront(event.command.direction, event.at,
        {delayFactor: event.command.delayFactor || 1, noTween: Number(this.body?.raw?.iReuseD) === 1});
      else if (event.kind === 'animation') this.animation(event.command);
      else if (identity(event.body) !== identity(this.body)) this.loadBody(event.body, event.at);
    }
    // A hidden actor can outlive the bounded native history. Reconcile the
    // actual current component without guessing discarded intermediate forms.
    if (identity(body) !== identity(this.body)) this.loadBody(body, now);
    this.advance(now, frozen);
    // The source histories are bounded64; retain only their keys, not a log
    // growing with every rendered frame or every step of a long match.
    this.faceSeen = new Set(faces.map(command => command.key));
    this.animationSeen = new Set(animations.map(command => command.key));
    const bitmap = this.timeline instanceof NativeBitmapBodyTimeline;
    const timeline = bitmap ? this.timeline.snapshot() : this.timeline ? {
      frame: this.timeline.frame - 1, state: frozen ? 'freeze' : this.animationState,
      counter: this.timeline.counter, totalFrames: this.timeline.totalFrames,
      lastTick: this.timeline.lastTick, commandKey: this.animationKey} : null;
    return {angle: this.turn.angleAt(now), turn: this.turn.snapshot(now),
      moving: this.animationState === 'move' || this.animationState === 'rush',
      rushing: this.animationState === 'rush', frame: timeline?.frame ?? null, timeline,
      componentId: this.body?.componentId ?? null, generation: this.generation, loadedAt: this.loadedAt};
  }
}
