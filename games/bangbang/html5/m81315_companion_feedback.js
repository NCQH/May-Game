import {menuAudioPreferences} from './m82_menu_audio.js';

// ItemManager.onNotifyBoosterResult -> PrositHelperUpView / UILayer. The
// 200×200 native component is centred on the 1000×600 stage and lives 900ms,
// even though each source movie has 24 frames at 24Hz. No gameplay is here.
export const COMPANION_FEEDBACK_MS = 900;
const MOVIES = Object.freeze({31: 'helperLevelUp_t.swf', 32: 'HelperStthUp_t.swf', 33: 'helperStarUp_t.swf'});
const MOVIE_ROOT = 'zh_CN/gui_summer/controls/swf/';
const SOUND_ROOT = 'zh_CN/sound/ui/';
const AUDIO_SETTINGS = 'bangbang.html5.audio.v1';

/** A result is meaningful only for the operation just acknowledged, not an
 * old lastOperation snapshot. Failed rolls may have a native consolation cue
 * but must never get a successful-level movie. */
export function companionFeedbackPlan(packet, {action, uuid} = {}) {
  if (packet?.type !== 'companionOperation' || ![31, 32, 33, 34].includes(action)
      || packet.action !== action || packet.uuid !== uuid || !uuid || packet.code !== 0
      || ![0, 1].includes(packet.success) || !Number.isInteger(packet.previousValue)
      || !Number.isInteger(packet.currentValue)) return null;
  if (packet.success === 0) return [32, 33].includes(action)
    ? {action, movie: null, sound: SOUND_ROOT + 'small_happy.mp3', durationMs: 0} : null;
  if (action === 34) return {action, movie: null, sound: SOUND_ROOT + 'very_happy.mp3', durationMs: 0};
  if (packet.currentValue <= packet.previousValue) return null;
  return {action, movie: MOVIE_ROOT + MOVIES[action], durationMs: COMPANION_FEEDBACK_MS,
    sound: SOUND_ROOT + (action === 31 ? 'helper_level_up.mp3' : 'very_happy.mp3')};
}

export class M81315CompanionFeedback {
  constructor({host, catalog, isCurrent = () => true, onUnavailable = () => {}}) {
    this.host = host; this.catalog = catalog; this.isCurrent = isCurrent; this.onUnavailable = onUnavailable;
    this.epoch = 0; this.disposed = false; this.seenRequests = new Set(); this.images = new Map();
    this.blobs = new Map(); this.voices = new Set(); this.abort = new AbortController();
    this.stats = {confirmed: 0, duplicateRequests: 0, moviesStarted: 0, soundsStarted: 0,
      audioBlocked: 0, missing: 0, lateIgnored: 0};
    this.root = document.createElement('div'); this.root.className = 'm81315-companion-feedback';
    this.root.setAttribute('aria-hidden', 'true'); this.root.dataset.testid = 'companion-feedback';
    this.host.append(this.root);
    this.onVisibility = () => { if (document.hidden) { this.epoch++; this.clearPlayback(); } };
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  current(epoch) { return !this.disposed && epoch === this.epoch && this.isCurrent() && this.host.isConnected && !document.hidden; }
  async verified(asset) {
    if (!asset || !/^[a-f0-9]{64}$/i.test(asset.sha256 || '') || !Number.isInteger(asset.bytes)
        || asset.bytes <= 0 || asset.bytes > 10 * 1024 * 1024) throw new Error('Thiếu nguồn hiệu ứng đã đối chiếu.');
    const url = new URL(asset.url, location.href);
    if (url.origin !== location.origin || url.search || url.hash
        || !(/^\/html5\/assets\/m81314\/(?:atlas\/[a-f0-9]{20}_root_\d+\.png|original\/[a-f0-9]{64}\.mp3)$/.test(url.pathname)
          || url.pathname === '/rez/zh_CN/sound/ui/very_happy.mp3')) throw new Error('Nguồn hiệu ứng ngoài danh mục.');
    const key = asset.url + ':' + asset.sha256;
    if (!this.blobs.has(key)) {
      const task = (async () => {
        url.searchParams.set('v', asset.sha256);
        const response = await fetch(url, {cache: 'force-cache', redirect: 'error', signal: this.abort.signal});
        if (!response.ok) throw new Error('Không tải được hiệu ứng gốc.');
        const data = await response.arrayBuffer();
        if (data.byteLength !== asset.bytes) throw new Error('Kích thước hiệu ứng gốc không khớp.');
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))]
          .map(value => value.toString(16).padStart(2, '0')).join('');
        if (hash !== asset.sha256.toLowerCase()) throw new Error('Hash hiệu ứng gốc không khớp.');
        return data;
      })();
      this.blobs.set(key, task);
      task.catch(() => { if (this.blobs.get(key) === task) this.blobs.delete(key); });
    }
    return this.blobs.get(key);
  }
  async image(asset) {
    const key = asset.url + ':' + asset.sha256;
    if (!this.images.has(key)) {
      const task = (async () => {
        const bytes = await this.verified(asset), image = await createImageBitmap(new Blob([bytes], {type: 'image/png'}));
        if (this.disposed || image.width !== asset.width || image.height !== asset.height) {
          image.close(); throw new Error('Atlas hiệu ứng không đúng kích thước hoặc đã đóng.');
        }
        return image;
      })();
      this.images.set(key, task);
      task.catch(() => { if (this.images.get(key) === task) this.images.delete(key); });
    }
    return this.images.get(key);
  }
  sequence(logical) {
    const asset = this.catalog?.assets?.[logical];
    const sequence = asset?.derived || this.catalog?.derivedAssets?.[asset?.derivedRef];
    if (asset?.status !== 'ready' || sequence?.sourceSha256 !== asset.sha256
        || sequence.mode !== 'root-timeline' || sequence.rootFrameCount !== 24
        || sequence.headerFps !== 24 || sequence.frames?.length !== 24) throw new Error('Thiếu timeline trợ thủ gốc.');
    return sequence;
  }
  async soundAsset(logical) {
    if (logical !== SOUND_ROOT + 'very_happy.mp3') return this.catalog?.assets?.[logical];
    if (!this.audioCatalog) this.audioCatalog = fetch(new URL('./m82_audio_catalog.json', import.meta.url),
      {cache: 'no-store', signal: this.abort.signal}).then(response => {
      if (!response.ok) throw new Error('Không tải được danh mục âm báo gốc.');
      return response.json();
    }).then(value => {
      const asset = value.assets?.levelUp;
      if (asset?.url !== '/rez/zh_CN/sound/ui/very_happy.mp3') throw new Error('Âm báo trợ thủ không đúng nguồn.');
      return asset;
    }).catch(error => { this.audioCatalog = null; throw error; });
    return this.audioCatalog;
  }
  // Start fetching only the selected action's small fixed resources while the
  // server is processing. A missing cosmetic never blocks or retries a spend.
  prepare(action) {
    if (this.disposed || !MOVIES[action]) return;
    try { for (const asset of this.sequence(MOVIE_ROOT + MOVIES[action]).assets) this.image(asset).catch(() => {}); }
    catch { /* Report only if an acknowledged result actually needs this art. */ }
  }
  unavailable(epoch) {
    if (!this.current(epoch)) return;
    this.stats.missing++;
    this.onUnavailable('Kết quả máy chủ đã giữ; một hiệu ứng hoặc âm báo gốc chưa tải được.');
  }
  preferences() {
    try { return menuAudioPreferences(JSON.parse(localStorage.getItem(AUDIO_SETTINGS) || '{}')); }
    catch { return menuAudioPreferences(); }
  }
  async sound(logical, epoch) {
    const prefs = this.preferences();
    if (!this.current(epoch) || !prefs.effectsOn || !prefs.effectsVolume) return;
    const asset = await this.soundAsset(logical), bytes = await this.verified(asset);
    const latest = this.preferences();
    if (!this.current(epoch) || !latest.effectsOn || !latest.effectsVolume) return;
    const url = URL.createObjectURL(new Blob([bytes], {type: 'audio/mpeg'})), voice = new Audio(url);
    voice.volume = latest.effectsVolume / 100;
    const entry = {voice, end: () => {
      if (!this.voices.has(entry)) return;
      this.voices.delete(entry); voice.pause(); voice.removeAttribute('src'); voice.load(); URL.revokeObjectURL(url);
      if (!this.voices.size) { clearInterval(this.audioMonitor); this.audioMonitor = 0; }
    }};
    const end = entry.end;
    this.voices.add(entry); voice.addEventListener('ended', end, {once: true}); voice.addEventListener('error', end, {once: true});
    // The main menu owns the preferences UI, but not this short-lived voice.
    // Re-read the same preference contract while audio is alive; do not leave
    // a cue playing after effects are muted or keep a permanent polling timer.
    this.audioMonitor ||= setInterval(() => {
      const current = this.preferences();
      for (const entry of [...this.voices]) {
        if (!this.current(epoch) || !current.effectsOn || !current.effectsVolume) entry.end();
        else entry.voice.volume = current.effectsVolume / 100;
      }
    }, 100);
    try { await voice.play(); if (!this.current(epoch)) end(); else this.stats.soundsStarted++; }
    catch { this.stats.audioBlocked++; end(); }
  }
  async movie(logical, started, epoch) {
    const sequence = this.sequence(logical), images = new Map();
    await Promise.all(sequence.assets.map(async asset => images.set(asset.url, await this.image(asset))));
    if (!this.current(epoch) || performance.now() - started >= COMPANION_FEEDBACK_MS) { this.stats.lateIgnored++; return; }
    // Preserve native origin and overhang: do not shrink the original art into
    // the component's nominal 200px box or discard trimmed negative offsets.
    const bounds = sequence.frames.filter(frame => !frame.empty).reduce((out, frame) => [
      Math.min(out[0], frame.offsetX || 0), Math.min(out[1], frame.offsetY || 0),
      Math.max(out[2], (frame.offsetX || 0) + frame.w), Math.max(out[3], (frame.offsetY || 0) + frame.h)], [0, 0, 200, 200]);
    const canvas = document.createElement('canvas'); canvas.width = bounds[2] - bounds[0]; canvas.height = bounds[3] - bounds[1];
    canvas.style.left = `${400 + bounds[0]}px`; canvas.style.top = `${200 + bounds[1]}px`;
    const context = canvas.getContext('2d'); if (!context) throw new Error('Không mở được lớp hiệu ứng trợ thủ.');
    this.root.append(canvas); this.root.dataset.active = 'true'; this.root.dataset.logical = logical;
    this.stats.moviesStarted++;
    const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    let last = -1;
    const draw = now => {
      if (!this.current(epoch) || now - started >= COMPANION_FEEDBACK_MS) return;
      // Reduced motion keeps one nonempty native frame, never invented art.
      const index = reduced ? sequence.frames.findIndex(frame => !frame.empty)
        : Math.min(23, Math.floor(Math.max(0, now - started) * 24 / 1000));
      if (last !== index) {
        const frame = sequence.frames[index], asset = frame.asset || sequence.assets[frame.assetIndex || 0];
        context.clearRect(0, 0, canvas.width, canvas.height);
        if (!frame.empty) context.drawImage(images.get(asset.url), frame.sx, frame.sy, frame.w, frame.h,
          (frame.offsetX || 0) - bounds[0], (frame.offsetY || 0) - bounds[1], frame.w, frame.h);
        canvas.dataset.sourceFrame = String(frame.sourceFrame); last = index;
      }
      if (!reduced) this.raf = requestAnimationFrame(draw);
    };
    draw(performance.now());
  }
  confirm(packet, expected, requestId) {
    if (!this.current(this.epoch) || !Number.isSafeInteger(requestId) || requestId <= 0) return false;
    if (this.seenRequests.has(requestId)) { this.stats.duplicateRequests++; return false; }
    this.seenRequests.add(requestId);
    if (this.seenRequests.size > 64) this.seenRequests.delete(this.seenRequests.values().next().value);
    const plan = companionFeedbackPlan(packet, expected); if (!plan) return false;
    this.clearPlayback(); const epoch = ++this.epoch, started = performance.now();
    this.stats.confirmed++; this.root.dataset.action = String(plan.action);
    if (plan.movie) {
      this.timer = setTimeout(() => { if (epoch === this.epoch) this.clearMovie(); }, COMPANION_FEEDBACK_MS);
      this.movie(plan.movie, started, epoch).catch(() => this.unavailable(epoch));
    }
    if (plan.sound) this.sound(plan.sound, epoch).catch(() => this.unavailable(epoch));
    return true;
  }
  clearMovie() {
    clearTimeout(this.timer); this.timer = 0; cancelAnimationFrame(this.raf); this.raf = 0;
    this.root.replaceChildren(); delete this.root.dataset.active; delete this.root.dataset.logical;
  }
  clearPlayback() { this.clearMovie(); for (const entry of [...this.voices]) entry.end(); }
  reset() { this.epoch++; this.clearPlayback(); this.seenRequests.clear(); }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.reset(); this.abort.abort(); this.root.remove();
    document.removeEventListener('visibilitychange', this.onVisibility);
    for (const task of this.images.values()) task.then(image => image.close()).catch(() => {});
    this.images.clear(); this.blobs.clear();
  }
}
