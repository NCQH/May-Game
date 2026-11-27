import {isPveMap} from './m81314_protocol.js';
import {visualPosition} from './combat_state.js';

// Explicit OFFLINE presentation, not an extracted Flash effect. The native
// source leaves flame407 empty; death-ray136 and claw131/132 are unbound.
// Keep every working original movie/audio untouched. Never apply damage here.
export const OFFLINE_PVE_CUES = Object.freeze({
  bossMapId: 31602, bossTemplateId: 3160211, bossSkillId: 1000150,
  // Nominal server contract, not a countdown: a replayed ready1 can have less
  // than2s left. Display a pulsing full circle until authoritative ready0/stop.
  bossRadius: 300, bossChargeMs: 2000, bossReleaseMs: 500,
  chargeStaleMs: 5000, flameSkillId: 1000039, flameWidth: 24, flameMs: 300,
  clawAreaSkillId: 1000117, clawSingleSkillId: 1000118,
  clawAreaRadius: 144, clawSingleRange: 120, clawMs: 240,
});
const finitePoint = (x, y) => Number.isFinite(x) && Number.isFinite(y) ? {x, y} : null;
const owner = (state, id) => state.objects?.[String(id)] || state.actors?.[String(id)];
const activeScope = state => state?.roomType === 4 && isPveMap(state.mapId)
  && !state.result && state.finishedAt == null;
const clamp = value => Math.max(0, Math.min(1, value));
export const DOOKU_CUES = Object.freeze({
  mapId: 30103, templateId: 3110312, laserSkillId: 50334, laserWidth: 72,
  laserRange: 500, warningStaleMs: 5000, releaseMs: 250, markerRadius: 28,
  debuffs: Object.freeze({50335: 'ĐỘC', 50338: 'LÀM CHẬM', 50339: 'CHOÁNG', 50340: 'CÂM LẶNG'}),
});
export const isLocalDookuSkill = (event, state) => state?.roomType === 4
  && Number(state.mapId) === DOOKU_CUES.mapId
  && ['skill', 'skillStopped'].includes(event.kind)
  && (Number(event.packet?.skillId ?? event.skillId) === DOOKU_CUES.laserSkillId
    || Object.hasOwn(DOOKU_CUES.debuffs, Number(event.packet?.skillId ?? event.skillId)))
  && Number(owner(state, event.packet?.casterId ?? event.casterId)?.templateId) === DOOKU_CUES.templateId;
export const isOfflineBossCue = (event, state) => state?.roomType === 4
  && Number(state.mapId) === OFFLINE_PVE_CUES.bossMapId && event.kind === 'skill'
  && Number(event.packet?.skillId) === OFFLINE_PVE_CUES.bossSkillId
  && Number(owner(state, event.packet?.casterId)?.templateId) === OFFLINE_PVE_CUES.bossTemplateId;
const CLAW_TEMPLATES = Object.freeze({
  1000117: Object.freeze([3140211, 3140305]),
  1000118: Object.freeze([3140210, 3140304]),
});
const FLIGHT_SOURCES = Object.freeze({
  1000087: {exhibit: 115, color: '#b7ffd2', maps: {31201: 3120101, 31203: 3120301, 31301: 3130101, 31303: 3130301}},
  1000120: {exhibit: 133, color: '#adf1ff', maps: {31403: 3140314, 31503: 3150314}},
  // The server's native bounce keeps the same NPC owner and exhibit133.
  1001120: {exhibit: 133, color: '#adf1ff', maps: {31403: 3140314, 31503: 3150314}},
  1020022: {exhibit: 116, color: '#ffe0a8', maps: {31202: 3120209}},
});
export const isOfflineClawCue = (event, state) => state?.roomType === 4
  && [31402, 31403].includes(Number(state.mapId)) && event.kind === 'skill'
  && event.packet?.isReady === 0 && [3, 5].includes(Number(event.packet.casterId) >>> 26)
  && !!CLAW_TEMPLATES[Number(event.packet.skillId)]?.includes(
    Number(owner(state, event.packet.casterId)?.templateId));

export class OfflinePveEffects {
  constructor() { this.reset(); }
  reset() { this.sceneId = null; this.active = new Map(); this.history = []; this.nextId = 0; this.projectileMarkers = []; }
  finish(key, reason) {
    const cue = this.active.get(key);
    if (!cue) return;
    this.active.delete(key); this.history.push({...cue, reason});
    if (this.history.length > 64) this.history.shift();
  }
  clear(reason) { for (const key of this.active.keys()) this.finish(key, reason); }
  scope(state) {
    if (this.sceneId !== state?.sceneId) { this.clear('scene-changed'); this.sceneId = state?.sceneId ?? null; }
    if (!activeScope(state)) { this.clear(state?.result || state?.finishedAt != null ? 'battle-finished' : 'outside-pve'); return false; }
    return true;
  }
  add(key, cue) {
    this.finish(key, 'replaced');
    this.active.set(key, {id: ++this.nextId, presentation: 'offline-geometric-cue',
      firstDrawAt: null, lastDrawAt: null, draws: 0, ...cue});
    // Defensive bound; server timing normally permits only one boss charge.
    if (this.active.size > 64) this.finish(this.active.keys().next().value, 'bounded-capacity');
  }
  consume(events, state) {
    if (!this.scope(state)) return;
    for (const event of events) {
      if (['death', 'objectRemoved', 'skillStopped'].includes(event.kind)) {
        const casterId = event.casterId ?? event.objectId;
        for (const [key, cue] of this.active) if (cue.casterId === casterId
            && (event.kind !== 'skillStopped' || cue.skillId === event.skillId)) this.finish(key, event.kind);
        continue;
      }
      if (!Number.isFinite(event.receivedAt)) continue;
      const p = event.packet;
      if (isLocalDookuSkill(event, state)) {
        const caster = owner(state, p.casterId), from = finitePoint(p.startX, p.startY), to = finitePoint(p.x, p.y);
        if (!from || !to || ![0, 1].includes(p.isReady)) continue;
        const laser = Number(p.skillId) === DOOKU_CUES.laserSkillId, charge = p.isReady === 1;
        const key = `dooku:${p.casterId}`;
        this.finish(key, 'authoritative-release');
        if (laser && (Math.hypot(to.x - from.x, to.y - from.y) > DOOKU_CUES.laserRange + 1
            || (from.x === to.x && from.y === to.y))) continue;
        const target = owner(state, p.targetId);
        if (!laser && (!charge || !target || target.dead || target.removed)) continue;
        // The ray is locked and already clipped by the server. Debuffs lock
        // a tank, not a patch of ground: their small marker follows that tank.
        // A replayed ready1 never resets or invents a numerical countdown.
        this.add(key, {kind: laser ? (charge ? 'dooku-laser-warning' : 'dooku-laser-release') : 'dooku-target-warning',
          skillId: p.skillId, casterId: p.casterId, casterLifeEpoch: event.casterLifeEpoch ?? caster.lifeEpoch,
          targetId: p.targetId, targetLifeEpoch: event.targetLifeEpoch ?? target?.lifeEpoch,
          from, to, width: DOOKU_CUES.laserWidth, radius: DOOKU_CUES.markerRadius,
          label: DOOKU_CUES.debuffs[p.skillId], startedAt: event.receivedAt,
          durationMs: charge ? DOOKU_CUES.warningStaleMs : DOOKU_CUES.releaseMs,
          expiresAt: event.receivedAt + (charge ? DOOKU_CUES.warningStaleMs : DOOKU_CUES.releaseMs)});
      } else if (isOfflineBossCue(event, state)) {
        const caster = owner(state, p.casterId), point = finitePoint(p.x, p.y), from = finitePoint(p.startX, p.startY);
        if (!point || !from || Number(caster?.templateId) !== OFFLINE_PVE_CUES.bossTemplateId
            || ![0, 1].includes(p.isReady)) continue;
        const key = `boss:${p.casterId}`, charge = p.isReady === 1;
        // Use the locked ground point from the wire, never the current target
        // or caster position. Moving after ready must be a real escape option.
        this.add(key, {kind: charge ? 'boss-charge' : 'boss-release',
          skillId: p.skillId, casterId: p.casterId, casterLifeEpoch: event.casterLifeEpoch ?? caster.lifeEpoch,
          x: point.x, y: point.y, from, radius: OFFLINE_PVE_CUES.bossRadius,
          startedAt: event.receivedAt,
          durationMs: charge ? OFFLINE_PVE_CUES.bossChargeMs : OFFLINE_PVE_CUES.bossReleaseMs,
          expiresAt: event.receivedAt + (charge ? OFFLINE_PVE_CUES.chargeStaleMs : OFFLINE_PVE_CUES.bossReleaseMs)});
      } else if (isOfflineClawCue(event, state)) {
        const caster = owner(state, p.casterId), point = finitePoint(p.startX, p.startY);
        if (!point || p.x !== point.x || p.y !== point.y) continue;
        // Native pve_bio sends immediate caster-centered skill_event with no
        // target ID. Never infer an aim/target or manufacture a charge phase.
        const area = p.skillId === OFFLINE_PVE_CUES.clawAreaSkillId;
        this.add(`claw:${p.casterId}:${p.skillId}`, {
          kind: area ? 'claw-area' : 'claw-single', skillId: p.skillId, casterId: p.casterId,
          casterLifeEpoch: event.casterLifeEpoch ?? caster.lifeEpoch,
          x: point.x, y: point.y,
          radius: area ? OFFLINE_PVE_CUES.clawAreaRadius : OFFLINE_PVE_CUES.clawSingleRange,
          startedAt: event.receivedAt, durationMs: OFFLINE_PVE_CUES.clawMs,
          expiresAt: event.receivedAt + OFFLINE_PVE_CUES.clawMs,
        });
      } else if (event.kind === 'fire' && Number(p?.templateId) === OFFLINE_PVE_CUES.flameSkillId) {
        const from = finitePoint(p.startX, p.startY), to = finitePoint(p.destX, p.destY), caster = owner(state, p.objectId);
        // This is an NPC-only fallback, not a player/Kakashi/PvP FX override.
        if (!from || !to || !caster || ![3, 5].includes(Number(p.objectId) >>> 26)
            || (from.x === to.x && from.y === to.y)) continue;
        const key = `flame:${p.bulletId}:${event.receivedAt}`;
        if (this.active.has(key)) continue;
        this.add(key, {kind: 'flame-shot', skillId: p.templateId, casterId: p.objectId,
          casterLifeEpoch: caster.lifeEpoch, from, to, width: OFFLINE_PVE_CUES.flameWidth,
          startedAt: event.receivedAt, expiresAt: event.receivedAt + OFFLINE_PVE_CUES.flameMs,
          durationMs: OFFLINE_PVE_CUES.flameMs});
      }
    }
  }
  draw(view, state, now) {
    if (!this.scope(state) || !Number.isFinite(now)) return;
    for (const [key, cue] of this.active) {
      const caster = owner(state, cue.casterId);
      if (!caster || caster.dead || caster.removed || (caster.maxHp > 0 && caster.hp <= 0)
          || caster.lifeEpoch !== cue.casterLifeEpoch) { this.finish(key, 'caster-ended'); continue; }
      if (now >= cue.expiresAt) { this.finish(key, 'expired'); continue; }
      if (now < cue.startedAt) continue;
      if (cue.kind === 'dooku-target-warning') {
        const target = owner(state, cue.targetId);
        if (!target || target.dead || target.removed || (target.maxHp > 0 && target.hp <= 0)
            || target.lifeEpoch !== cue.targetLifeEpoch) { this.finish(key, 'target-ended'); continue; }
        const point = visualPosition(target, now);
        if (!finitePoint(point?.x, point?.y)) continue;
        cue.x = point.x; cue.y = point.y;
      }
      if (drawOfflinePveCue(view, cue, now)) {
        cue.firstDrawAt ??= now; cue.lastDrawAt = now; cue.draws++;
      }
    }
  }
  drawProjectile(view, state, bullet, exhibit, position, now) {
    if (!this.scope(state) || !Number.isFinite(now) || now < bullet.startedAt
        || state.projectiles?.[String(bullet.bulletId)] !== bullet
        || bullet.removed || bullet.blownAt != null || (Number(bullet.objectId) >>> 26) !== 5) return false;
    const rule = FLIGHT_SOURCES[Number(bullet.templateId)];
    // Capture the source NPC at FIRE. A legitimate projectile can outlive its
    // caster, so do not replace its native lifetime with the caster's HP.
    const sourceNpc = bullet.casterAppearanceState;
    if (!rule || Number(exhibit?.nBulletId) !== rule.exhibit
        || Number(sourceNpc?.objectId) !== Number(bullet.objectId)
        || !rule.maps[Number(state.mapId)]
        || Number(sourceNpc?.templateId) !== rule.maps[Number(state.mapId)]) return false;
    const original = view.store.source(exhibit.resources?.szBulletImage);
    // These three source inputs are known1x1 unavailable placeholders. Never
    // cover a newly supplied original image, even if its loading later fails.
    if (original?.exists !== false || original?.url || original?.status !== 'placeholder-unavailable'
        || original.width !== 1 || original.height !== 1) return false;
    const point = finitePoint(position?.x, position?.y), zoom = view.camera?.zoom;
    if (!point || !(zoom > 0) || !Number.isFinite(zoom)) return false;
    const screen = view.screenPoint(point.x, point.y), radius = 5 * zoom;
    if (screen.x < -radius || screen.y < -radius || screen.x > view.width + radius || screen.y > view.height + radius) return false;
    const c = view.context; if (!c) return false;
    c.save();
    try {
      // A small generic moving marker, NOT recovered syringe/box/lightning
      // artwork and NOT a damage radius. Position is the native sampler's.
      c.translate(screen.x, screen.y); c.fillStyle = rule.color; c.strokeStyle = '#4f3530';
      c.lineWidth = Math.max(1, zoom); c.beginPath(); c.arc(0, 0, radius, 0, Math.PI * 2); c.fill(); c.stroke();
    } finally { c.restore(); }
    this.projectileMarkers.push({presentation: 'offline-geometric-flight-marker',
      sceneId: state.sceneId, bulletId: bullet.bulletId, skillId: bullet.templateId,
      casterId: bullet.objectId, x: point.x, y: point.y, at: now});
    if (this.projectileMarkers.length > 64) this.projectileMarkers.shift();
    return true;
  }
  snapshot() { return {presentation: 'offline-geometric-cues', active: structuredClone([...this.active.values()]),
    history: structuredClone(this.history), projectileMarkers: structuredClone(this.projectileMarkers)}; }
}

/** Existing overlay canvas works with GPU sprites and CPU fallback alike.
 * Shape coordinates are pixels in the authoritative world, projected by the
 * same camera as the tanks. A return value reports submitted draw calls only. */
export function drawOfflinePveCue(view, cue, now) {
  const c = view.context, zoom = view.camera?.zoom;
  if (!c || !(zoom > 0) || !Number.isFinite(zoom)) return false;
  const progress = clamp((now - cue.startedAt) / cue.durationMs);
  c.save();
  try {
    if (cue.kind === 'dooku-laser-warning' || cue.kind === 'dooku-laser-release') {
      const from = view.screenPoint(cue.from.x, cue.from.y), to = view.screenPoint(cue.to.x, cue.to.y);
      const pad = cue.width * zoom;
      if (Math.max(from.x, to.x) < -pad || Math.min(from.x, to.x) > view.width + pad
          || Math.max(from.y, to.y) < -pad || Math.min(from.y, to.y) > view.height + pad) return false;
      const warning = cue.kind === 'dooku-laser-warning';
      const pulse = .5 + .5 * Math.sin((now - cue.startedAt) / 150);
      c.lineCap = 'butt'; c.strokeStyle = warning ? '#ed433d' : '#fff3aa';
      c.globalAlpha = warning ? .18 + .12 * pulse : .75 * (1 - progress);
      c.lineWidth = cue.width * zoom; c.beginPath(); c.moveTo(from.x, from.y); c.lineTo(to.x, to.y); c.stroke();
      c.globalAlpha = warning ? .8 : 1 - progress; c.strokeStyle = warning ? '#ffcf7b' : '#ffffff';
      c.lineWidth = Math.max(1, 2 * zoom); c.beginPath(); c.moveTo(from.x, from.y); c.lineTo(to.x, to.y); c.stroke();
      return true;
    }
    if (cue.kind === 'flame-shot') {
      const from = view.screenPoint(cue.from.x, cue.from.y), to = view.screenPoint(cue.to.x, cue.to.y);
      const pad = cue.width * zoom;
      if (Math.max(from.x, to.x) < -pad || Math.min(from.x, to.x) > view.width + pad
          || Math.max(from.y, to.y) < -pad || Math.min(from.y, to.y) > view.height + pad) return false;
      c.globalAlpha = 1 - progress; c.lineCap = 'butt';
      // The outer stroke is exactly the server's24px strip, already clipped
      // to walls/water in the FIRE destination. No extended ray or extra hitbox.
      for (const [width, color] of [[cue.width, '#ef641e'], [cue.width * .5, '#ffb536'], [cue.width * .18, '#fff3b0']]) {
        c.strokeStyle = color; c.lineWidth = width * zoom; c.beginPath();
        c.moveTo(from.x, from.y); c.lineTo(to.x, to.y); c.stroke();
      }
      return true;
    }
    const center = view.screenPoint(cue.x, cue.y), radius = cue.radius * zoom;
    if (center.x < -radius || center.y < -radius || center.x > view.width + radius || center.y > view.height + radius) return false;
    c.translate(center.x, center.y); c.lineWidth = Math.max(2, 3 * zoom);
    if (cue.kind === 'dooku-target-warning') {
      c.strokeStyle = '#ffd27a'; c.fillStyle = 'rgba(116,35,164,.24)';
      c.beginPath(); c.arc(0, 0, radius, 0, Math.PI * 2); c.fill(); c.stroke();
      c.font = `700 ${Math.max(11, 13 * zoom)}px Tahoma,Arial,sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'bottom'; c.lineWidth = 3;
      c.strokeStyle = '#291536'; c.fillStyle = '#fff0c4';
      c.strokeText(cue.label, 0, -radius - 4 * zoom); c.fillText(cue.label, 0, -radius - 4 * zoom);
    } else if (cue.kind === 'claw-area') {
      // Immediate native AoE is radius144. This is an impact cue, not a new
      // hitbox/telegraph, and it does not claim Flash's absent rotating art.
      c.globalAlpha = 1 - progress; c.strokeStyle = '#ffe3c8';
      c.beginPath(); c.arc(0, 0, radius, 0, Math.PI * 2); c.stroke();
      c.strokeStyle = '#f19968'; c.lineWidth = Math.max(2, 5 * zoom);
      for (let i = 0; i < 3; i++) {
        const start = i * Math.PI * 2 / 3 + progress * .35;
        c.beginPath(); c.arc(0, 0, radius * .82, start, start + .8); c.stroke();
      }
    } else if (cue.kind === 'claw-single') {
      // The120px value is single-target reach, NOT an AoE radius. Short,
      // centered slashes indicate the attack without guessing the omitted
      // native target ID or painting a misleading full damage circle.
      c.globalAlpha = 1 - progress; c.strokeStyle = '#ffe3c8';
      c.lineWidth = Math.max(2, 4 * zoom); c.lineCap = 'butt';
      for (let i = -1; i <= 1; i++) {
        const offset = i * radius * .15;
        c.beginPath(); c.moveTo(offset - radius * .15, -radius * .32);
        c.lineTo(offset + radius * .15, radius * .32); c.stroke();
      }
    } else if (cue.kind === 'boss-charge') {
      drawFinalBossCharge(c, radius, zoom, now - cue.startedAt);
    } else if (cue.kind === 'boss-release') {
      drawFinalBossRelease(c, radius, zoom, progress);
    } else return false;
    return true;
  } finally { c.restore(); }
}

// M43 local energy effect. The marked circle is still the server's exact300px
// ground hit area. Arcs, sparks and the vertical light column are decoration;
// none supplies a hitbox or guesses a countdown after reconnect. Deterministic
// drawing avoids particle objects, timers and per-frame random allocation.
function radialGlow(c, radius, colors, fallback) {
  const gradient = c.createRadialGradient?.(0, 0, 0, 0, 0, radius);
  if (!gradient?.addColorStop) return fallback;
  for (const [stop, color] of colors) gradient.addColorStop(stop, color);
  return gradient;
}

function drawFinalBossCharge(c, radius, zoom, elapsed) {
  const pulse = .5 + .5 * Math.sin(elapsed / 180), turn = elapsed / 1500;
  c.fillStyle = radialGlow(c, radius, [[0, 'rgba(255,95,128,.16)'],
    [.55, 'rgba(172,20,95,.035)'], [1, 'rgba(245,58,35,.10)']], 'rgba(245,58,35,.08)');
  c.strokeStyle = '#ff6256'; c.lineWidth = Math.max(2, 2.5 * zoom);
  c.beginPath(); c.arc(0, 0, radius, 0, Math.PI * 2); c.fill(); c.stroke();
  // Pulsing segmented rim always stays on the true boundary; its animation
  // conveys charging without promising a locally reconstructed release time.
  c.strokeStyle = '#ffd3aa'; c.lineWidth = Math.max(2, 4 * zoom);
  c.globalAlpha = .45 + .35 * pulse;
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4 + turn * .18;
    c.beginPath(); c.arc(0, 0, radius, angle, angle + .17); c.stroke();
  }
  c.globalAlpha = .72; c.strokeStyle = '#ff9fbd'; c.lineWidth = Math.max(1, 2 * zoom);
  for (let i = 0; i < 3; i++) {
    const angle = i * Math.PI * 2 / 3 - turn;
    c.beginPath(); c.arc(0, 0, radius * .19, angle, angle + 1.35); c.stroke();
  }
  c.globalAlpha = .7 + .25 * pulse; c.fillStyle = '#ffe9c8';
  c.beginPath(); c.arc(0, 0, Math.max(3, (5 + 2 * pulse) * zoom), 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#ff80b2'; c.lineWidth = Math.max(1, 2 * zoom);
  for (let i = 0; i < 10; i++) {
    const angle = i * Math.PI / 5 + .23, phase = ((elapsed / 950 + i / 10) % 1 + 1) % 1;
    const r = radius * (.08 + .7 * (1 - phase));
    c.globalAlpha = .2 + .5 * phase;
    c.beginPath(); c.moveTo(Math.cos(angle) * r, Math.sin(angle) * r);
    c.lineTo(Math.cos(angle) * (r + 10 * zoom), Math.sin(angle) * (r + 10 * zoom)); c.stroke();
  }
}

function drawFinalBossRelease(c, radius, zoom, progress) {
  const fade = Math.max(0, 1 - progress), flash = fade * fade;
  c.globalAlpha = fade;
  c.fillStyle = radialGlow(c, radius, [[0, 'rgba(255,255,238,.85)'],
    [.16, 'rgba(255,193,215,.56)'], [.52, 'rgba(235,43,107,.20)'],
    [1, 'rgba(223,32,64,0)']], 'rgba(255,130,150,.20)');
  c.beginPath(); c.arc(0, 0, radius, 0, Math.PI * 2); c.fill();
  // The column rises from the impact. No connecting danger strip is drawn
  // between boss and target: damage belongs only to the locked ground circle.
  c.lineCap = 'round';
  for (const [width, color] of [[32, '#ad216f'], [17, '#ff81bc'], [6, '#fff8df']]) {
    c.globalAlpha = flash * .85; c.lineWidth = Math.max(1, width * zoom * (.45 + flash));
    c.strokeStyle = color; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -radius * .8); c.stroke();
  }
  c.globalAlpha = fade; c.strokeStyle = '#ffd7cb'; c.lineWidth = Math.max(1, (2 + 6 * fade) * zoom);
  c.beginPath(); c.arc(0, 0, radius * (.24 + .76 * progress), 0, Math.PI * 2); c.stroke();
  c.globalAlpha = fade * .6; c.strokeStyle = '#ff588a'; c.lineWidth = Math.max(1, 2 * zoom);
  c.beginPath(); c.arc(0, 0, radius, 0, Math.PI * 2); c.stroke();
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI / 6 + .2, r = radius * (.12 + .7 * progress);
    c.strokeStyle = i % 2 ? '#ff7fbb' : '#fff2cf'; c.globalAlpha = fade;
    c.beginPath(); c.moveTo(Math.cos(angle) * r, Math.sin(angle) * r);
    c.lineTo(Math.cos(angle) * (r + 14 * zoom * fade), Math.sin(angle) * (r + 14 * zoom * fade)); c.stroke();
  }
}
