// EffectLayer.showSkillName, using original named SWF timelines. This does not
// invent a skill-use event for normal/projectile fire or alter the skill itself.
export const SKILL_NAME_TICK_MS = 1000 / 24;

export function nativeSkillNameCue(event, skillCatalog, namesCatalog) {
  if (event?.kind !== 'skill' || event.packet?.count !== 1) return null;
  const packet = event.packet, skill = skillCatalog?.[String(packet.skillId)];
  const binding = namesCatalog?.skills?.[String(packet.skillId)];
  if (!skill?.szSkillNameSwf || !binding || binding.sourceName !== skill.szSkillNameSwf) return null;
  if (Number(skill.iChargeEffectId) && packet.isReady !== 1) return null;
  const position = event.casterPosition;
  if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) return null;
  const sequence = namesCatalog.resources?.[binding.logical];
  if (!sequence?.frames?.length) return null;
  return {eventId: event.id, skillId: packet.skillId, casterId: packet.casterId,
    casterLifeEpoch: event.casterLifeEpoch ?? null, sourceSequence: event.sourceSequence ?? null,
    // Native onNotifyUseSkill stores CTank.x/y in int locals before showSkillName.
    x: Math.trunc(position.x), y: Math.trunc(position.y), startedAt: event.receivedAt,
    logical: binding.logical, sequence};
}

/** CMovieClipLite advances frame1 at tick0 to frameN at tickN-1, dispatching
 * PLAY_COMPLETE synchronously; showSkillName's listener hides it at that tick.
 * The two converted source movies have more than one root frame.
 */
export function nativeSkillNameFrame(sequence, elapsedMs) {
  const count = sequence?.frames?.length || 0;
  const tick = Number(sequence?.frameMs) || SKILL_NAME_TICK_MS;
  const durationMs = Math.max(0, count - 1) * tick;
  return {index: Math.min(Math.max(0, count - 1), Math.floor(Math.max(0, elapsedMs) / tick)),
    complete: count < 2 || elapsedMs >= durationMs, durationMs};
}

export class M7SkillNames {
  constructor(skillCatalog, namesCatalog) {
    this.skillCatalog = skillCatalog; this.namesCatalog = namesCatalog; this.reset();
  }

  reset() { this.active = []; this.history = []; this.seen = new Set(); this.shown = 0; this.completed = 0; }

  consume(events, state) {
    for (const event of events) {
      if (event.kind !== 'skill') continue;
      const casterId = event.packet?.casterId;
      if (!state?.actors?.[String(casterId)] && !state?.objects?.[String(casterId)]) continue;
      const cue = nativeSkillNameCue(event, this.skillCatalog, this.namesCatalog);
      if (!cue || this.seen.has(cue.eventId)) continue;
      this.seen.add(cue.eventId);
      if (this.seen.size > 256) this.seen.delete(this.seen.values().next().value);
      this.active.push({...cue, firstDrawAt: null, lastFrame: null, framesDrawn: 0});
      this.shown += 1;
    }
  }

  draw(now, drawSequence) {
    this.active = this.active.filter(cue => {
      const sample = nativeSkillNameFrame(cue.sequence, now - cue.startedAt);
      if (sample.complete) {
        const {sequence, ...record} = cue;
        this.history.push({...record, endedAt: now, reason: 'native-play-complete',
          frameCount: sequence.frames.length, expectedDurationMs: sample.durationMs});
        if (this.history.length > 32) this.history.shift();
        this.completed += 1; return false;
      }
      if (drawSequence(cue.sequence, sample.index, cue.x, cue.y, 0, 1)) {
        cue.firstDrawAt ??= now; cue.lastFrame = sample.index; cue.framesDrawn += 1;
      }
      return true;
    });
  }

  snapshot() {
    return {shown: this.shown, completed: this.completed,
      active: this.active.map(({sequence, ...cue}) => ({...cue, frameCount: sequence.frames.length})),
      history: structuredClone(this.history)};
  }
}
