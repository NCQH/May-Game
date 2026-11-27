import {visualPosition} from './combat_state.js';
import {worldBossDirectSceneVisual} from './m81330_assets.js';

// BattleObjectTool.getObjectType and TankActions.add_object: top six bits are
// the native object kind. A table/template ID alone is not an object kind.
export function sceneItemTemplate(catalog, object) {
  if (!object || (object.objectId >>> 26) !== 4) return null;
  return catalog.sceneItems?.[String(object.templateId)] || null;
}

export function sceneItemCoverField(object, selfCamp, isLook = false) {
  if (isLook || object.camp === 0) return 'szCoverNeutralSwf';
  return object.camp === selfCamp ? 'szCoverSwf' : 'szCoverEnemySwf';
}

export function sceneItemAllowed(template, object, selfCamp, isLook = false) {
  // ActiveObjectLayer requires the separate gameplay PropTemplet row. Its
  // isEnemyInvisible flag also applies while a dead player watches a teammate.
  return template?.prop?.exists === true
    && (isLook || !template.prop.isEnemyInvisible || object.camp === selfCamp);
}

export function sceneItemRotation(template, object, state, now) {
  if (!Number(template.isRotateByOwner)) return 0;
  let point;
  if (Object.hasOwn(object, 'ownerPositionAtSnapshot')) point = object.ownerPositionAtSnapshot;
  else {
    const owner = state.actors[String(object.ownerId)] || state.objects[String(object.ownerId)];
    point = owner && !owner.removed ? visualPosition(owner, now) : null;
  }
  if (!point) return 0;
  // CMath.getRotation accepts ints and returns int degrees, zero facing north.
  const dx = Math.trunc(object.x) - Math.trunc(point.x);
  const dy = Math.trunc(object.y) - Math.trunc(point.y);
  const degrees = dx === 0 ? (dy < 0 ? 0 : 180)
    : Math.trunc(Math.atan2(dy, dx) * 180 / Math.PI + 90);
  return (degrees + (Number(template.nRotateOffset) || 0)) * Math.PI / 180;
}

export function sceneItemFrame(length, elapsedMs, frameMs, count) {
  if (!(length > 0) || !(frameMs > 0)) return null;
  if (length === 1) return {index: 0, complete: false};
  // CMovieClipLite starts on frame 1, increments on normalTick, and either
  // stops on the last frame or immediately replays frame 1 at that tick.
  const ticks = Math.floor(Math.max(0, elapsedMs) / frameMs), cycle = length - 1;
  const complete = count > 0 && ticks >= cycle * count;
  return {index: complete ? length - 1 : ticks % cycle, complete};
}

export function campEncircleSpec(camp, selfCamp, radius) {
  if (!(radius > 0)) return null;
  const color = camp === 0 ? 16776960 : camp === selfCamp ? 2669294 : 16653067;
  const detail = camp === 0 ? 16776960 : camp === selfCamp ? 8364525 : 15570047;
  const outerRadius = radius + 1.5, fraction = 3 / outerRadius * 2;
  return {radius, outerRadius, color, detail,
    stops: [[0, color, 0], [Math.max(0, 1 - fraction), detail, 0],
      [Math.max(0, 1 - fraction / 2), color, 1], [1, detail, .1]]};
}

/** Only displays S1556/snapshot objects; no collision, lifespan or skill rules. */
export class SceneItemRenderer {
  constructor(store, sequenceFor) {
    this.store = store; this.sequenceFor = sequenceFor;
    this.circleSources = new Map(); this.reset();
  }

  reset() {
    this.entries = new Map(); this.history = []; this.missing = new Set();
    this.stats = {created: 0, removed: 0, coverDraws: 0, iconDraws: 0, ringDraws: 0};
  }

  circle(spec) {
    const key = `${spec.radius}:${spec.color}:${spec.detail}`;
    if (this.circleSources.has(key)) return this.circleSources.get(key);
    const canvas = document.createElement('canvas'), edge = Math.ceil(spec.outerRadius * 2 + 2);
    canvas.width = canvas.height = edge;
    const c = canvas.getContext('2d'), center = edge / 2;
    const gradient = c.createRadialGradient(center, center, 0, center, center, spec.outerRadius);
    for (const [at, color, alpha] of spec.stops) {
      gradient.addColorStop(at, `rgba(${color >> 16 & 255},${color >> 8 & 255},${color & 255},${alpha})`);
    }
    c.fillStyle = gradient; c.beginPath(); c.arc(center, center, spec.outerRadius, 0, Math.PI * 2); c.fill();
    this.circleSources.set(key, canvas); return canvas;
  }

  draw(state, now, {isVisible, drawSequence, drawCircle}) {
    const catalog = this.store.catalog, selfCamp = state.actors[String(state.selfObjectId)]?.camp;
    const live = new Set();
    for (const object of Object.values(state.objects)) {
      if (object.removed || (object.objectId >>> 26) !== 4) continue;
      const template = sceneItemTemplate(catalog, object);
      if (!template) {
        if (!this.missing.has(object.templateId)) {
          this.missing.add(object.templateId); this.store.recordMissing(`sceneItem:${object.templateId}`, 'binding_absent');
        }
        continue;
      }
      if (!sceneItemAllowed(template, object, selfCamp)
          && !worldBossDirectSceneVisual(catalog,template,object,state)) {
        if (template.prop?.exists !== true && !this.missing.has(object.templateId)) {
          this.missing.add(object.templateId);
          this.store.recordMissing(`sceneItem:${object.templateId}`, 'native_prop_row_absent');
        }
        continue;
      }
      live.add(object.objectId);
      let entry = this.entries.get(object.objectId);
      if (!entry || entry.lifeEpoch !== object.lifeEpoch) {
        const coverField = sceneItemCoverField(object, selfCamp);
        entry = {objectId: object.objectId, templateId: object.templateId, lifeEpoch: object.lifeEpoch,
          coverField, coverLogical: template.resources?.[coverField]?.logical || null,
          rotation: sceneItemRotation(template, object, state, now),
          playCount: Math.max(0, Number(template.nCoverSwfPlayTime) || 0),
          startedAt: object.lastSnapshotAt ?? now, visible: null, lastFrame: null,
          drawnFrames: 0, coverFramesDrawn: 0, iconFramesDrawn: 0, ringFramesDrawn: 0,
          cover: this.sequenceFor(template.resources?.[coverField]),
          icon: this.sequenceFor(template.resources?.szFileName),
          ring: campEncircleSpec(object.camp, selfCamp, Number(template.nCampRadius))};
        this.entries.set(object.objectId, entry); this.stats.created += 1;
      }
      const visible = isVisible(object.x, object.y, 32);
      // SceneItemView stops offscreen and replays its declared count on reentry.
      if (visible && entry.visible === false) entry.startedAt = now;
      entry.visible = visible;
      if (!visible) continue;
      let drawn = false;
      if (entry.ring) {
        drawCircle(this.circle(entry.ring), object.x, object.y);
        entry.ringFramesDrawn += 1; this.stats.ringDraws += 1; drawn = true;
      }
      if (entry.icon && drawSequence(entry.icon, 0, object.x, object.y, entry.rotation, 1)) {
        entry.iconFramesDrawn += 1; this.stats.iconDraws += 1; drawn = true;
      }
      if (entry.cover) {
        const sample = sceneItemFrame(entry.cover.frames.length, now - entry.startedAt,
          entry.cover.frameMs, entry.playCount);
        if (drawSequence(entry.cover, sample.index, object.x, object.y, entry.rotation, 1, {autoCenter: true})) {
          entry.lastFrame = sample.index; entry.coverFramesDrawn += 1;
          this.stats.coverDraws += 1; drawn = true;
        }
      }
      if (drawn) entry.drawnFrames += 1;
    }
    for (const [id, entry] of this.entries) {
      if (live.has(id)) continue;
      this.history.push({...this.describe(entry), removedAt: now});
      if (this.history.length > 100) this.history.shift();
      this.entries.delete(id); this.stats.removed += 1;
    }
  }

  describe({cover, icon, ring, ...entry}) {
    return {...entry, campRadius: ring?.radius || 0, coverFrameCount: cover?.frames.length || 0};
  }

  snapshot() {
    return {active: [...this.entries.values()].map(entry => this.describe(entry)),
      history: structuredClone(this.history), stats: {...this.stats}};
  }
}
