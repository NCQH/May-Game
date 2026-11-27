import {projectileDestination, visualProjectilePosition, retireProjectile} from './combat_state.js';
import {sceneItemTemplate, sceneItemFrame} from './scene_items.js';
import {actorAppearance, aiNpcTemplate, mapNpcDisplayTemplate} from './tank_appearance.js';
import {nativeDeathFlight} from './m6_visuals.js';
import {nativeKillAnnouncements, NativeAnnouncerQueue} from './m6_announcer.js';
import {NativeEffectClock, isNativeEffectMovie, nativeEffectSample} from './m83_effect_timeline.js';
import {nativeFileFrame} from './m81314_file_timeline.js';
import {isPveMap} from './m81314_protocol.js';
import {OfflinePveEffects, isOfflineBossCue, isLocalDookuSkill} from './m81323_pve_effects.js';

// ProcessManager.normalTick follows the current TankLoader's 24fps stage.
// This is the source-defined nominal cadence, not a measured Flash runtime FPS.
export const NORMAL_TICK_MS = 1000 / 24;

export function timelineSample(length, elapsedMs, frameMs, loop = false) {
  if (!(length > 0) || !(frameMs > 0)) return null;
  const raw = Math.floor(Math.max(0, elapsedMs) / frameMs);
  return {index: loop ? raw % length : Math.min(length - 1, raw),
    complete: !loop && raw >= length, durationMs: length * frameMs};
}

export function bulletExhibit(catalog, bullet, state = null) {
  // CTank.getBulletExhibitId: native generic 1/17 use the actual cannon.
  if ([1, 17].includes(bullet.templateId)) {
    const appearance = bullet.casterAppearanceState
      ? actorAppearance(catalog, bullet.casterAppearanceState, state).appearance
      : catalog.appearances[String(bullet.casterExternalId)];
    const cannon = appearance?.cannon;
    return catalog.exhibits[String(cannon?.raw.iReuseA || 1)] || null;
  }
  const skill = catalog.skills[String(bullet.templateId)];
  return catalog.exhibits[String(skill?.iBulletEffectId || 0)] || null;
}

export function exhibitLifecycle(exhibit) {
  // Optional bot exhibits may still be raw table rows. The fields have the
  // same source-defined meanings; an unconverted movie cannot crash the scene.
  return exhibit.lifecycle || {layer: Number(exhibit.nEffectLayer) === 1 ? 'below-actors' : 'above-actors',
    needDirection: Boolean(Number(exhibit.iIsNeedDirection)), rotateBlow: Boolean(Number(exhibit.iIsRotateBlow))};
}

/** One sequence from the extracted source, including its native origin. */
export function resourceSequence(store, resource, {kind = 'movie', exhibit = null} = {}) {
  if (!resource) return null;
  const source = store.source(resource), derived = store.derived(resource);
  if (derived?.frames?.length) {
    return {asset: derived.asset, assets: derived.assets, frames: derived.frames,
      frameMs: (derived.timing?.nominalTickMs || NORMAL_TICK_MS)
        * (derived.timing?.ticksPerFrame || 1), derived, source};
  }
  if (/\.swf$/i.test(source?.url || '')) {
    store.recordMissing(source, 'not_converted'); return null;
  }
  if (!/\.(png|jpe?g|webp)$/i.test(source?.url || '')) return null;
  const count = Math.max(1, Number(kind === 'bullet' ? exhibit?.nBulletImageFrame
    : kind === 'explode' ? exhibit?.nExplodeTotalFrame : 1) || 1);
  const width = source.width / count, height = source.height;
  if (!(width > 0) || !(height > 0)) { store.recordMissing(source, 'image_dimensions_unbound'); return null; }
  const offsetX = kind === 'explode' ? -(Number(exhibit?.iExplodeCenterX) || 0)
    : -Math.trunc(width / 2) + (Number(exhibit?.iBulletOffsetX) || 0);
  const offsetY = kind === 'explode' ? -(Number(exhibit?.iExplodeCenterY) || 0)
    : -Math.trunc(height / 2) + (Number(exhibit?.iBulletOffsetY) || 0);
  return {asset: source, source, frames: Array.from({length: count}, (_, index) => ({
    sx: index * width, sy: 0, w: width, h: height, offsetX, offsetY, sourceFrame: index + 1})),
    frameMs: NORMAL_TICK_MS * (Number(kind === 'bullet' ? exhibit?.nBulletRefreshFrame
      : exhibit?.nExplodeRefreshFrame) || 1)};
}

export class BattleEffects {
  constructor(store, onSound = () => {}, onShake = () => {}) {
    this.store = store; this.onSound = onSound; this.onShake = onShake; this.reset();
  }

  reset() {
    this.effects = []; this.floats = []; this.feed = []; this.lastFire = new Map();
    this.history = []; this.nextId = 0; this.played = 0; this.completed = 0;
    this.normalClock = new NativeEffectClock();
    this.chargeSkills = new Map(); this.unstableSkills = new Map();
    this.pveMapMovies = new Set();
    this.offlinePve = new OfflinePveEffects();
    this.announcer = new NativeAnnouncerQueue(this.onSound);
  }

  add(resource, position, now, options = {}) {
    if (!resource || !position) return;
    const sequence = resourceSequence(this.store, resource, options);
    if (!sequence) return;
    const effect = {id: ++this.nextId, logical: sequence.source.logical, sequence,
      x: position.x, y: position.y, startedAt: now, rotation: 0, layer: 'above-actors',
      loop: false, firstDrawAt: null, lastFrame: null, framesDrawn: 0,
      nativeTimeline: isNativeEffectMovie(sequence), startNormalTick: null,
      normalTicks: 0, playbackStartedAt: null, ...options};
    if(sequence.derived?.presentationRotation==='per-instance-random')effect.rotation+=Math.random()*Math.PI*2;
    this.effects.push(effect); this.played += 1;
    // EffectLayer indexes only the caster-side CMovieClipLite, never the
    // independent destination explosion. A later movie replaces this key.
    if (effect.kind === 'skill') {
      if (effect.charge && effect.exhibitId) this.chargeSkills.set(
        `${effect.exhibitId}:${effect.casterId}`, effect);
      else if (effect.loop) this.unstableSkills.set(`${effect.skillId}:${effect.casterId}`, effect);
    }
    // Optional bot resources are loaded lazily. Required Quan Vu assets are
    // already decoded before C552, so execute movies do not start half-loaded.
    this.store.loadResource(resource).catch(() => {});
    return effect;
  }

  remove(predicate, now, reason) {
    this.effects = this.effects.filter(effect => {
      if (!predicate(effect)) return true;
      this.finish(effect, now, reason); return false;
    });
  }

  finish(effect, now, reason = 'timeline-complete') {
    const chargeKey = `${effect.exhibitId}:${effect.casterId}`;
    const unstableKey = `${effect.skillId}:${effect.casterId}`;
    if (this.chargeSkills.get(chargeKey) === effect) this.chargeSkills.delete(chargeKey);
    if (this.unstableSkills.get(unstableKey) === effect) this.unstableSkills.delete(unstableKey);
    this.history.push({id: effect.id, logical: effect.logical, kind: effect.kind,
      exhibitId: effect.exhibitId ?? null,
      skillId: effect.skillId ?? null, casterId: effect.casterId ?? null,
      targetId: effect.targetId ?? null, x: effect.x, y: effect.y,
      startedAt: effect.startedAt, endedAt: now, reason,
      firstDrawAt: effect.firstDrawAt, lastFrame: effect.lastFrame,
      frameCount: effect.sequence.frames.length, framesDrawn: effect.framesDrawn,
      nativeTimeline: effect.nativeTimeline, playbackStartedAt: effect.playbackStartedAt,
      normalTicks: effect.normalTicks,
      expectedDurationMs: effect.nativeTimeline
        ? nativeEffectSample(effect.sequence.frames.length, 0, effect.loop).durationMs
        : effect.sequence.frameMs * (['scene-item-remove', 'npc-birth'].includes(effect.kind)
        ? Math.max(0, effect.sequence.frames.length - 1) : effect.sequence.frames.length)});
    if (this.history.length > 200) this.history.shift();
    if (reason === 'timeline-complete') this.completed += 1;
  }

  removeIndexed(index, key, now, reason) {
    const effect = index.get(key);
    if (!effect) return;
    index.delete(key);
    this.remove(value => value === effect, now, reason);
  }

  consume(events, state, geometry) {
    const catalog = this.store.catalog;
    this.offlinePve.consume(events, state);
    for (const event of events) {
      const now = event.receivedAt;
      // This exact offline boss uses its explicitly labelled geometric cue.
      // Native136 has no converted movie; don't report it as a failed download
      // or borrow another tank's art. Every other native FX path is untouched.
      if (isOfflineBossCue(event, state)) continue;
      if (event.kind === 'fire') {
        this.lastFire.set(event.packet.objectId, now);
        const bullet = state.projectiles[String(event.packet.bulletId)] || event.packet;
        const exhibit = bulletExhibit(catalog, bullet, state);
        if (exhibit) {
          const lifecycle = exhibitLifecycle(exhibit);
          if (!exhibit.resources && (exhibit.szBulletImage || exhibit.szFireEffectSwf))
            this.store.recordMissing(`exhibit:${exhibit.nBulletId}`, 'binding_pending');
          this.onSound(exhibit.resources?.szFireSound, event.casterPosition,
            {eventKey: `${event.id}:fire`, kind: 'fire', casterId: event.packet.objectId,
              sourceSequence: event.sourceSequence, normalFire: Number(exhibit.iIsSkill) !== 1});
          this.add(exhibit.resources?.szFireEffectSwf, event.casterPosition, now, {
            kind: 'fire', casterId: event.packet.objectId, layer: lifecycle.layer,
            rotation: lifecycle.needDirection ? angle(event.packet.startX, event.packet.startY,
              event.packet.destX, event.packet.destY) : 0});
        }
      } else if (event.kind === 'skill') {
        const packet = event.packet, skill = catalog.skills[String(packet.skillId)];
        if (!skill) { this.store.recordMissing(`skill:${packet.skillId}`, 'binding_absent'); continue; }
        const charge = packet.isReady === 1;
        // EffectLayer.onNotifyUseSkill only enters the execute branch when
        // the primary execute exhibit exists. Charge-only swipes (including
        // Yang Jian Space1/2) keep playing after the server's ready deadline.
        const execute = !charge && !!skill.iSkillEffectId;
        const ids = charge ? [skill.iChargeEffectId]
          : execute ? [skill.iSkillEffectId, skill.iSkillEffectId2] : [];
        for (const exhibitId of ids.filter(Boolean)) {
          const exhibit = catalog.exhibits[String(exhibitId)];
          if (!exhibit) { this.store.recordMissing(`exhibit:${exhibitId}`, 'binding_absent'); continue; }
          const lifecycle = exhibitLifecycle(exhibit);
          if (!exhibit.resources && (exhibit.szFireEffectSwf || exhibit.szExplodeFileName))
            this.store.recordMissing(`exhibit:${exhibitId}`, 'binding_pending');
          const options = {kind: 'skill', exhibitId, skillId: packet.skillId, casterId: packet.casterId,
            targetId: packet.targetId, charge, loop: !charge && !!skill.willRemoveByServer,
            layer: lifecycle.layer,
            rotation: lifecycle.needDirection
              ? angle(packet.startX, packet.startY, packet.x, packet.y) : 0};
          this.add(exhibit.resources?.szFireEffectSwf, event.casterPosition, now, options);
          this.add(exhibit.resources?.szExplodeFileName, event.endPosition, now, {
            ...options, kind: 'explode', exhibit, loop: false, layer: 'above-actors',
            // Preserve EffectLayer's existing startX/startX expression for
            // rotating skill-destination movies; Quan Vu's flag is false.
            rotation: lifecycle.rotateBlow
              ? angle(packet.startX, packet.startX, packet.x, packet.y) : 0});
          this.onSound(exhibit.resources?.szFireSound, event.casterPosition,
            {eventKey: `${event.id}:skill:${exhibitId}`, kind: charge ? 'charge' : 'skill',
              casterId: packet.casterId, sourceSequence: event.sourceSequence});
        }
        if (execute && skill.iChargeEffectId) this.removeIndexed(this.chargeSkills,
          `${skill.iChargeEffectId}:${packet.casterId}`, now, 'charge-finished');
      } else if (event.kind === 'skillStopped') {
        // MSG_NOTIFY_SKILL_STOP removes the unstable execute key only. It
        // does not remove a finite charge movie or an impact at the target.
        this.removeIndexed(this.unstableSkills, `${event.skillId}:${event.casterId}`, now, 'server-stop');
        if (isLocalDookuSkill(event, state)) {
          const charge = catalog.skills[String(event.skillId)]?.iChargeEffectId;
          if (charge) this.removeIndexed(this.chargeSkills, `${charge}:${event.casterId}`, now, 'server-stop');
        }
      } else if (event.kind === 'projectileBlow') {
        const bullet = event.bullet, skill = catalog.skills[String(bullet.templateId)];
        const exhibit = bulletExhibit(catalog, bullet, state);
        const destination = projectileDestination(bullet, skill, geometry);
        const position = visualProjectilePosition(bullet, now, destination);
        if (exhibit) {
          this.add(exhibit.resources?.szExplodeFileName, position, now, {kind: 'explode', exhibit,
            rotation: exhibitLifecycle(exhibit).rotateBlow
              ? angle(bullet.startX, bullet.startY, destination.x, destination.y) : 0});
          this.onSound(exhibit.resources?.szExplodeSound, position,
            {eventKey: `${event.id}:blow`, kind: 'impact', casterId: bullet.objectId, sourceSequence: event.sourceSequence});
          this.onShake(Number(exhibit.nShakeType), bullet.objectId, now);
        }
        if (Number(exhibit?.nBulletLoopType) !== 2) retireProjectile(state, bullet.bulletId);
      } else if (event.kind === 'objectRemoved') {
        const object = event.objectState || state.objects?.[String(event.objectId)];
        this.lastFire.delete(event.objectId);
        const template = sceneItemTemplate(catalog, object);
        // EffectLayer listens to ITEM_REMOVE, never ITEM_OVERTIME. It plays
        // one movie at ObjInfo coordinates, without cover rotation/centering.
        if (event.reason === 'removed' && template?.resources?.szRemoveSwf) this.add(template.resources.szRemoveSwf,
          event.position, now, {kind: 'scene-item-remove', targetId: event.objectId,
            layer: 'above-actors', loop: false});
        if (event.reason === 'removed') this.sceneItemSound(event, object, state, 'szRemoveMp3', 'scene-item-remove');
        if (template) this.onShake(Number(template.nShakeType), object.ownerId, now, event.position);
        if(object&&(object.objectId>>>26)===3&&state.roomType===4&&isPveMap(state.mapId)){
          const npc=mapNpcDisplayTemplate(catalog,geometry.map||catalog.maps[String(state.mapId)],object,state);
          if(Number(npc?.raw?.iDestoryPlayType??npc?.iDestoryPlayType)===1){
            const lifeEpoch=event.lifeEpoch??object.lifeEpoch;
            const key=`${object.objectId}:${lifeEpoch}`;
            if(!this.pveMapMovies.has(key)){
              this.pveMapMovies.add(key);
              // MapLayerBase.onNpcRemove uses a plain CLoader at the native
              // origin, retained below actors until this map is released.
              this.add(npc.resources?.szDestorySwf,event.position,now,
                {kind:'pve-map-file',layer:'map-base',nativeFile:true,nativeTimeline:false,
                  autoCenter:false,casterId:object.objectId,lifeEpoch,loop:true});
            }
          }
        }
        if (aiNpcTemplate(catalog, object)) {
          this.actorDeath(event, state);
          const ai = aiNpcTemplate(catalog, object);
          const normalAppearance = catalog.appearances[String(catalog.aiArms[String(ai.nArmsId)]?.exhibitId)];
          this.onShake(Number(normalAppearance?.raw?.nShakeType), object.ownerId, now, event.position);
        }
      } else if (event.kind === 'hpChange' && event.position && event.packet.delta) {
        this.floats.push({startedAt: now, position: event.position,
          delta: event.packet.delta, fury: event.packet.fury});
      } else if (event.kind === 'modelHpUpdate') {
        this.modelHpSound(event, state, geometry);
        if (event.campAced) this.announcer.add([{reason: 'aced', key: 'MP3_ACED'}], event,
          catalog.battleAudio?.announcer);
      } else if (event.kind === 'sceneItemAdded') {
        this.sceneItemSound(event, event.objectState, state, 'szCoverMp3', 'scene-item-add');
      } else if (event.kind === 'selfRelive') {
        this.onSound(catalog.battleAudio?.selfRelive, null,
          {eventKey: `${event.id}:self-relive`, kind: 'self-relive', objectId: event.objectId,
            sourceSequence: event.sourceSequence});
      } else if (event.kind === 'buffAdded') {
        this.onSound(catalog.buffs[String(event.buff.templateId)]?.resources?.szBuffMp3,
          event.position, {eventKey: `${event.id}:buff:${event.buff.instanceId}`, kind: 'buff',
            casterId: event.buff.casterId, objectId: event.objectId, sourceSequence: event.sourceSequence});
      } else if (event.kind === 'npcAdd') {
        const ai = catalog.aiNPCs?.[String(event.templateId)];
        this.announcer.npcAdd(ai, event, catalog.battleAudio?.announcer);
        const external = catalog.aiArms?.[String(ai?.nArmsId)]?.exhibitId;
        const appearance = catalog.appearances[String(external)];
        // EffectLayer.onAINpcAdd uses the snapshot point, one CMovieClipLite
        // play above actors, with the original origin and no owner rotation.
        this.add(appearance?.szAppearMovie, event.position, now,
          {kind: 'npc-birth', casterId: event.objectId, layer: 'above-actors', loop: false});
        const object = state.objects?.[String(event.objectId)];
        for (const buff of event.buffs ?? Object.values(object?.buffs || {})) {
          this.onSound(catalog.buffs[String(buff.templateId)]?.resources?.szBuffMp3, event.position,
            {eventKey: `${event.id}:npc-buff:${buff.instanceId}`, kind: 'buff', casterId: buff.casterId,
              objectId: event.objectId, sourceSequence: event.sourceSequence});
        }
      } else if (event.kind === 'death') {
        const actor = state.actors[String(event.objectId)], object = state.objects[String(event.objectId)];
        const entity = actor || object;
        // AINpcObject/TankShadow death movies follow NPC_REMOVE, including
        // timeout removal with positive HP. Do not play twice on HP0+REMOVE.
        if (actor) this.actorDeath(event, state);
        else if (object && (object.objectId >>> 26) === 3) {
          const npc = mapNpcDisplayTemplate(catalog,
            geometry.map || catalog.maps[String(state.mapId)], object, state);
          const fileMovie=state.roomType===4&&isPveMap(state.mapId)
            &&Number(npc?.raw?.iDestoryPlayType??npc?.iDestoryPlayType)===1;
          if(!fileMovie)this.add(npc?.resources?.szDestorySwf, event.position, now,
            {kind: 'npc-destroy', autoCenter: true, casterId: object.objectId});
          this.onShake(Number(npc?.raw?.nShakeType ?? npc?.nShakeType), object.ownerId, now, event.position);
        }
        // Skill effects intentionally survive target death and removal. Their
        // anchors and timelines were captured before S1564 applied HP0.
      } else if (event.kind === 'killInfo') {
        this.feed.push({...event.packet, receivedAt: now});
        if (this.feed.length > 5) this.feed.shift();
        this.announcer.add(nativeKillAnnouncements(event, catalog,
          geometry.map || catalog.maps?.[String(state.mapId)]), event, catalog.battleAudio?.announcer);
      }
    }
  }

  sceneItemSound(event, object, state, field, kind) {
    const template = sceneItemTemplate(this.store.catalog, object);
    const selfCamp = event.selfCamp ?? state.actors[String(state.selfObjectId)]?.camp;
    // SoundManager's camp gate is independent of visual cover visibility.
    // A dead player following an ally is not the native observer/isLook mode.
    if (!template || !object || !(state.isLook || object.camp === 0 || object.camp === selfCamp)) return;
    this.onSound(template.resources?.[field], event.position,
      {eventKey: `${event.id}:${kind}`, kind, casterId: object.ownerId,
        objectId: object.objectId, sourceSequence: event.sourceSequence});
  }

  modelHpSound(event, state, geometry) {
    const catalog = this.store.catalog, object = event.objectState;
    if (!object) return;
    const kind = object.objectId >>> 26;
    let resource;
    if (kind === 3) {
      // SoundManager uses the received NpcTemplet, not the viewer-camp artwork
      // substitution used by BattleTool.getNpcDisplayId.
      const map = geometry.map || catalog.maps?.[String(state.mapId)];
      const npc = map?.npcTemplates?.[String(object.templateId)] || catalog.mapNPCs?.[String(object.templateId)];
      resource = npc?.resources?.[event.hp > 0 ? 'szPartSound' : 'szAllSound'];
    } else if (event.delta < 0 && (kind === 0 || kind === 5)) {
      if (kind === 5) {
        const npc = aiNpcTemplate(catalog, object);
        if (!npc || !((object.maxHp !== -1 && Number(npc.iLifeShowType) !== 1) || Number(npc.nType) === 1)) return;
      }
      const external = actorAppearance(catalog, object, state).baseExternalId;
      resource = catalog.appearances[String(external)]?.szHitMp3;
    }
    if (resource) this.onSound(resource, event.position,
      {eventKey: `${event.id}:model-hp`, kind: kind === 3 ? 'map-npc-hp' : 'hit',
        objectId: event.objectId, sourceSequence: event.sourceSequence});
  }

  actorDeath(event, state) {
    const catalog = this.store.catalog;
    const actor = state.actors[String(event.objectId)] || state.objects[String(event.objectId)];
    const {baseExternalId, appearance, shadow} = actorAppearance(catalog, event.appearanceState || actor, state);
    const position = (event.objectId >>> 26) === 5
      ? {x: Math.trunc(event.position.x), y: Math.trunc(event.position.y)} : event.position;
    for (const [key, layer] of [['strReuseB', 'below-actors'], ['strReuseC', 'above-actors']]) {
      const flight = key === 'strReuseB' && !shadow
        ? nativeDeathFlight(position, event.nativeDeathHunter, appearance?.raw?.deadFlyRange) : null;
      this.add(appearance?.body?.resources?.[key], position, event.receivedAt,
        {kind: 'death', casterId: event.objectId, layer, flight});
    }
    // TankShadowDead sends exhibitId=0, so original SoundManager emits no
    // borrowed owner death sound. Normal tanks/NPCs use their base outlook.
    if (!shadow) this.onSound(catalog.appearances[String(baseExternalId)]?.szDeadMp3, event.position,
      {eventKey: `${event.id}:death`, kind: 'death', objectId: event.objectId, sourceSequence: event.sourceSequence});
  }

  draw(layer, now, drawSequence) {
    const normalTick = this.normalClock.sample(now);
    this.effects = this.effects.filter(effect => {
      if (effect.layer !== layer) return true;
      let sample, hideAtCompletion = false;
      if(effect.nativeFile){
        if(effect.startNormalTick==null){effect.startNormalTick=normalTick;effect.playbackStartedAt=now;}
        effect.normalTicks=normalTick-effect.startNormalTick;
        sample={index:nativeFileFrame(effect.sequence,effect.normalTicks),complete:false};
      } else if (effect.nativeTimeline) {
        if (effect.startNormalTick == null) {
          effect.startNormalTick = normalTick; effect.playbackStartedAt = now;
        }
        effect.normalTicks = normalTick - effect.startNormalTick;
        sample = nativeEffectSample(effect.sequence.frames.length, effect.normalTicks, effect.loop);
        hideAtCompletion = true;
      } else if (['scene-item-remove', 'npc-birth'].includes(effect.kind)) {
        sample = sceneItemFrame(effect.sequence.frames.length, now - effect.startedAt,
          effect.sequence.frameMs, 1); hideAtCompletion = true;
      } else {
        sample = timelineSample(effect.sequence.frames.length, now - effect.startedAt,
          effect.sequence.frameMs, effect.loop);
      }
      if (hideAtCompletion && sample.complete) { this.finish(effect, now); return false; }
      const flight = effect.flight, fraction = flight ? Math.min(1, Math.max(0, (now - effect.startedAt) / flight.durationMs)) : 0;
      const x = flight ? flight.from.x + (flight.to.x - flight.from.x) * fraction : effect.x;
      const y = flight ? flight.from.y + (flight.to.y - flight.from.y) * fraction : effect.y;
      const drawn = drawSequence(effect.sequence, sample.index, x, y,
        effect.rotation, 1, {autoCenter: effect.autoCenter});
      if (drawn) {
        effect.firstDrawAt ??= now; effect.framesDrawn += 1; effect.lastFrame = sample.index;
      }
      if (sample.complete) { this.finish(effect, now); return false; }
      return true;
    });
    this.floats = this.floats.filter(value => now - value.startedAt < 900);
    this.feed = this.feed.filter(value => now - value.receivedAt < 6500);
  }

  snapshot() {
    return {active: this.effects.map(effect => ({id: effect.id, logical: effect.logical,
      exhibitId: effect.exhibitId ?? null,
      kind: effect.kind, skillId: effect.skillId ?? null, casterId: effect.casterId ?? null,
      targetId: effect.targetId ?? null, x: effect.x, y: effect.y, startedAt: effect.startedAt,
      frameCount: effect.sequence.frames.length, lastFrame: effect.lastFrame, loop: effect.loop,
      nativeTimeline: effect.nativeTimeline, playbackStartedAt: effect.playbackStartedAt,
      normalTicks: effect.normalTicks,
      expectedDurationMs: effect.nativeTimeline
        ? nativeEffectSample(effect.sequence.frames.length, 0, effect.loop).durationMs
        : effect.sequence.frames.length * effect.sequence.frameMs,
      firstDrawAt: effect.firstDrawAt, framesDrawn: effect.framesDrawn})),
      history: structuredClone(this.history), played: this.played, completed: this.completed,
      normalClock: this.normalClock.snapshot(),
      announcer: this.announcer.snapshot(), offlinePve: this.offlinePve.snapshot()};
  }
}

export function angle(x0, y0, x1, y1) { return Math.atan2(y1 - y0, x1 - x0) + Math.PI / 2; }
