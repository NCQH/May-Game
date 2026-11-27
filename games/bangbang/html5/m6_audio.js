/** SoundManager.getPanning/getVol + ScrollDefine constants, current Flash.
 * Listener is the followed tank; viewport is the visible world rectangle.
 */
export function nativeSoundMix(position, space, normalFire = false) {
  if (!position || !space) return {gain: 1, pan: 0};
  const {listener, left, top, width, height} = space;
  if (position.x < left - 200 || position.x > left + width + 200
      || position.y < top - 100 || position.y > top + height + 100) return {gain: 0, pan: 0};
  const dx = Math.trunc(position.x - listener.x), dy = Math.trunc(position.y - listener.y);
  const distance = Math.trunc(Math.hypot(dx, dy));
  const gain = Math.abs(dx) < 150 && Math.abs(dy) < 150
    ? normalFire ? (1 - distance / 1200) * .6 : 1
    : (1 - distance / 1200) * (normalFire ? .3 : 1);
  return {gain: Math.max(.1, Math.min(1, gain)), pan: Math.max(-1, Math.min(1, dx / (width / 2)))};
}

/** Browser audio consumes packet-derived triggers only. No gameplay decisions. */
export class NativeBattleAudio {
  constructor(store, getSpace = () => null) {
    this.store = store; this.getSpace = getSpace;
    this.context = null; this.master = null; this.analyser = null; this.enabled = false;
    this.voices = new Map(); this.loops = new Map(); this.pendingLoops = new Map(); this.seen = new Set(); this.nextId = 0;
    this.history = []; this.generation = 0; this.stats = {played: 0, ended: 0, blocked: 0,
      duplicates: 0, offscreen: 0, decodeFailures: 0, missing: 0, limited: 0, peak: 0, rms: 0,
      samplePeak: 0, sampleRms: 0, sampleTime: 0};
    // decodeAudioData is allowed while the context is suspended. It prepares
    // original audio before entering the scene; only a user gesture resumes it.
    this.store.decodeAudio = async data => {
      try { return await this.getContext().decodeAudioData(data.slice(0)); }
      catch (error) { this.stats.decodeFailures += 1; throw error; }
    };
  }

  getContext() {
    if (this.context) return this.context;
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context) throw new Error('Trình duyệt không có AudioContext.');
    this.context = new Context();
    this.master = this.context.createGain(); this.master.gain.value = .5;
    this.analyser = this.context.createAnalyser(); this.analyser.fftSize = 1024;
    this.master.connect(this.analyser); this.analyser.connect(this.context.destination);
    this.samples = new Float32Array(this.analyser.fftSize);
    return this.context;
  }

  async setEnabled(enabled) {
    this.enabled = !!enabled;
    if (!this.enabled) { this.stopAll(); return false; }
    try {
      await this.getContext().resume();
      if (this.context.state !== 'running') throw new Error('AudioContext chưa chạy.');
      return true;
    } catch (error) { this.enabled = false; this.stats.blocked += 1; throw error; }
  }

  async play(resource, position, {eventKey = null, kind = 'effect', normalFire = false, loopId = null,
    casterId = null, objectId = null, sourceSequence = null} = {}) {
    if (!this.enabled || !resource) return null;
    const source = this.store.source(resource);
    if (!source?.exists) { this.stats.missing += 1; this.store.recordMissing(source, 'source_absent'); return null; }
    const mix = nativeSoundMix(position, this.getSpace(), normalFire);
    if (loopId && this.loops.has(loopId)) {
      const id = this.loops.get(loopId), voice = this.voices.get(id);
      if (voice) { voice.gain.gain.value = mix.gain; voice.panner.pan.value = mix.pan; }
      return id;
    }
    if (!mix.gain) { this.stats.offscreen += 1; return null; }
    const key = eventKey == null ? null : `${this.generation}:${eventKey}:${source.sha256}`;
    if (key && this.seen.has(key)) { this.stats.duplicates += 1; return null; }
    if (loopId && this.pendingLoops.has(loopId)) return null;
    if (key) {
      this.seen.add(key);
      if (this.seen.size > 4096) this.seen.delete(this.seen.values().next().value);
    }
    const generation = this.generation;
    const pendingLoop = loopId ? {} : null;
    if (loopId) this.pendingLoops.set(loopId, pendingLoop);
    try {
    let buffer = this.store.audio.get(source.url);
    try { buffer ||= await this.store.loadAudio(source); }
    catch { this.stats.missing += 1; return null; }
    if (!buffer || !this.enabled || generation !== this.generation
        || (loopId && this.pendingLoops.get(loopId) !== pendingLoop)) return null;
    const context = this.getContext();
    if (context.state !== 'running') { this.stats.blocked += 1; return null; }
    // Bound browser audio resources without merging distinct native casts.
    // Every refusal is counted, so a saturation test cannot report parity.
    if (this.voices.size >= 64) { this.stats.limited += 1; return null; }
    const node = context.createBufferSource(), gain = context.createGain(), panner = context.createStereoPanner();
    node.buffer = buffer; node.loop = loopId != null;
    gain.gain.value = mix.gain; panner.pan.value = mix.pan;
    node.connect(gain); gain.connect(panner); panner.connect(this.master);
    const id = ++this.nextId, startedAt = context.currentTime;
    const record = {id, logical: source.logical, sha256: source.sha256, kind, eventKey, casterId, objectId, sourceSequence,
      sceneId: this.store.sceneId, startedAt, duration: buffer.duration, gain: mix.gain,
      pan: mix.pan, loopId, endedAt: null, stopped: false};
    this.voices.set(id, {node, gain, panner, record});
    if (loopId) this.loops.set(loopId, id);
    this.history.push(record); if (this.history.length > 300) this.history.shift();
    node.onended = () => {
      record.endedAt = context.currentTime; this.stats.ended += 1;
      node.disconnect(); gain.disconnect(); panner.disconnect(); this.voices.delete(id);
      if (loopId && this.loops.get(loopId) === id) this.loops.delete(loopId);
    };
    node.start(); this.stats.played += 1;
    return id;
    } finally {
      if (loopId && this.pendingLoops.get(loopId) === pendingLoop) this.pendingLoops.delete(loopId);
    }
  }

  stopLoop(loopId) {
    this.pendingLoops.delete(loopId);
    const id = this.loops.get(loopId), voice = this.voices.get(id);
    if (!voice) return;
    voice.record.stopped = true;
    try { voice.node.stop(); } catch { /* Already ended. */ }
    this.loops.delete(loopId);
  }

  keepLoops(ids) {
    for (const loopId of new Set([...this.loops.keys(), ...this.pendingLoops.keys()])) {
      if (!ids.has(loopId)) this.stopLoop(loopId);
    }
  }

  stopAll() {
    this.generation += 1;
    for (const voice of this.voices.values()) {
      voice.record.stopped = true;
      try { voice.node.stop(); } catch { /* Already ended. */ }
    }
    this.loops.clear(); this.pendingLoops.clear(); this.seen.clear();
  }

  sample() {
    if (!this.analyser || !this.enabled) { this.stats.samplePeak = 0; this.stats.sampleRms = 0; return; }
    this.analyser.getFloatTimeDomainData(this.samples);
    let peak = 0, power = 0;
    for (const value of this.samples) { peak = Math.max(peak, Math.abs(value)); power += value * value; }
    this.stats.peak = Math.max(this.stats.peak, peak);
    const rms = Math.sqrt(power / this.samples.length);
    this.stats.rms = Math.max(this.stats.rms, rms);
    this.stats.samplePeak = peak; this.stats.sampleRms = rms; this.stats.sampleTime = this.context.currentTime;
  }

  snapshot() {
    this.sample();
    return {...this.stats, enabled: this.enabled, contextState: this.context?.state || 'uninitialized',
      contextTime: this.context?.currentTime || 0, active: this.voices.size, loops: this.loops.size, pendingLoops: this.pendingLoops.size,
      decodedBuffers: this.store.audio.size, history: this.history.map(record => ({...record}))};
  }
}
