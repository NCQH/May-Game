import {SpriteSurface, rendererPreference, saveRendererPreference} from './sprite_surface.js';
import {createBattleGeometry} from './battle_geometry.js';
import {BattleInput} from './battle_input.js';
import {visualPosition, visualProjectilePosition, projectileDestination,
  takeCombatEffects, nativeControlFlags, cooldownView, serverTimeAt} from './combat_state.js';
import {BattleEffects, bulletExhibit, resourceSequence, timelineSample, angle,
  NORMAL_TICK_MS, exhibitLifecycle} from './battle_effects.js';
import {NativeBodyTimeline, nativeCannonFrame} from './battle_timeline.js';
import {SpectatorCamera} from './spectator.js';
import {BattleTeamHud} from './battle_team.js';
import {selfKdaView} from './team_hud_state.js';
import {SceneItemRenderer} from './scene_items.js';
import {actorAppearance, aiNpcTemplate, actorLifeBarVisible, mapNpcDisplayTemplate,
  nativeNpcImageField} from './tank_appearance.js';
import {distanceFrame, nativeLinkRotation, NativeScreenShake} from './m6_visuals.js';
import {NativeBattleAudio} from './m6_audio.js';
import {RoboCamera} from './m7_robo_camera.js';
import {RoboHud} from './m7_robo_hud.js';
import {RoboWorld} from './m7_robo_world.js';
import {NativeBodyDisplay} from './m71_body_display.js';
import {nativeSkillPresentation} from './m7_skill_presentation.js';
import {M7SkillNames} from './m7_skill_names.js';
import {NativeStatusPresentation, isNativeSpeedBuff} from './m72_status_presentation.js';
import {NativeSpeedTrail} from './m72_speed_trail.js';
import {NativeCannonPresentation, remoteIronmanTimingAngle} from './m72_cannon_presentation.js';
import {nativeHaloBuffVector, nativeHaloSample} from './m83_battle_halo.js';
import {BattleRenderRecovery, battleReloadUrl} from './m84_battle_recovery.js';
import {M86Postmatch} from './m86_postmatch.js';
import {portalFrame} from './m89_pk_maps.js';
import {battleMapName as pkMapName,battleObjectiveText as pkObjectiveText,isPracticeRoom} from './m810_modes.js';
import {drawNativeFlags} from './m810_objectives.js';
import {drawNativeTargeting} from './m810_targeting.js';
import {drawCompanion} from './m81314_companion_render.js';
import {PveBossHud} from './m81315_pve_hud.js';
import {isPveMap} from './m81314_protocol.js';
import {isWorldBossScene,WORLD_BOSS_MAP} from './m81330_protocol.js';
import {drawWorldBossHud} from './m81330_worldboss_hud.js';
import {nativeSequenceAdditive} from './m81332_visual_fixes.js';

const $ = id => document.getElementById(id);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const radians = degrees => degrees * Math.PI / 180;
const bodyAngle = direction => direction === 8 ? 0 : ((direction + 7) % 8) * Math.PI / 4;
const signName = (catalog, actor) => actor?.tankId === 10000056 ? 'Quan Vũ'
  : catalog?.tanks[String(actor?.tankId)]?.name
    || aiNpcTemplate(catalog, actor)?.szName || 'Tank';
const timeText = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

// Center Viet Da (including its practice room) on axes that fit the viewport,
// using the same native-scale camera/input/minimap path as PvE and World Boss.
// Other maps retain their existing scrolling and minimum viewport behavior.
export const centerSmallBattleMap = (mapId, scene) => isPveMap(mapId)
  || Number(mapId) === 7
  || Number(mapId) === WORLD_BOSS_MAP && isWorldBossScene(scene);

export function actorNameVisible(catalog, actor) {
  const ai = aiNpcTemplate(catalog, actor);
  // AINpcData parses the direct isShowName field with == 1; absent is false.
  return !ai || Number(ai.isShowName) === 1;
}

export function battleActorEntities(catalog, state) {
  return [...Object.values(state.actors), ...Object.values(state.objects)
    .filter(object => aiNpcTemplate(catalog, object))];
}

/** Renderer and HUD. All health, deaths, targets and outcomes come from packets. */
export class BattleView {
  async prepareSceneGraphics(prepared,scene,progress){
    if(!prepared?.supported)return prepared;
    const generation=this.client.generation,sceneGeneration=this.store.sceneGeneration;
    const current=()=>generation===this.client.generation&&scene===this.client.state.play.scene
      &&sceneGeneration===this.store.sceneGeneration;
    await this.surface.prepareTextures(prepared.graphicsWarmUrls,this.store.images,{current,progress});
    if(!current())throw new DOMException('Đợt tải trận đã thay đổi.','AbortError');
    return prepared;
  }
  constructor(client, store, run) {
    this.client = client; this.store = store; this.run = run;
    this.canvas = $('battle-canvas'); this.overlay = $('battle-overlay');
    this.context = this.overlay.getContext('2d');
    this.surface = new SpriteSurface(this.canvas, {forceCanvas: rendererPreference() === 'canvas', onContextLost: event => {
      this.input.releaseAll(); this.message(event?.reason === 'webgl-restoration-failed'
        ? 'Chưa khôi phục được hình ảnh. Chọn Cài đặt → Đồ họa → Tương thích để kết nối lại.'
        : 'Bề mặt hiển thị đang khôi phục; hãy bấm vào bản đồ sau khi tải lại.');
    }});
    this.canvas = this.surface.canvas;
    this.camera = {x: 0, y: 0, zoom: 1}; this.geometry = null; this.prepared = null;
    this.roboActive = false; this.roboCamera = new RoboCamera(); this.roboWorld = new RoboWorld(this);
    this.roboInputLife = null; this.roboSoundWanted = true;
    this.shake = new NativeScreenShake(); this.shakeOffset = {x: 0, y: 0};
    this.linkFrames = new Map(); this.linkDiagnostics = []; this.mapNpcDiagnostics = new Map();
    this.drawnResources = new Map();
    this.audio = new NativeBattleAudio(store, () => this.soundSpace());
    store.onEvictImage = image => this.surface.releaseTexture(image);
    this.combatSeen = null; this.effects = new BattleEffects(store,
      (source, position, options) => this.playSound(source, position, options),
      (type, owner, now, position) => {
        if (position) {
          const screen = this.screenPoint(position.x, position.y);
          if (screen.x < 0 || screen.y < 0 || screen.x > this.width || screen.y > this.height) return;
        }
        this.shake.trigger(type, owner, this.client.combat?.selfObjectId, now);
      });
    this.sceneItems = new SceneItemRenderer(store, resource => resourceSequence(store, resource));
    this.frameTimes = []; this.drawTimes = []; this.frames = 0; this.lastFrameAt = null;
    this.lastHudAt = 0; this.resultSeen = null; this.error = null; this.animationStart = 0;
    this.positions = new Map(); this.buffFirstSeen = new Map(); this.bodyTimelines = new Map(); this.metrics = {};
    this.nativeBodies = new Map(); this.skillNames = null;
    this.companionClocks=new Map();
    this.pveBossHud=new PveBossHud();
    this.nativeStatuses = new Map(); this.nativeSpeedTrails = new Map(); this.nativeCannons = new Map();
    this.spectator = new SpectatorCamera();
    this.teamHud = new BattleTeamHud($('battle-team-roster'), accountId => {
      if (this.client.state.phase === 'ready'
          && this.spectator.selectAccount(this.client.combat, accountId, performance.now())) this.input.releaseAll();
    });
    this.input = new BattleInput({canvas: this.canvas, client,
      worldPoint: (x, y) => this.worldPoint(x, y), getGeometry: () => this.geometry,
      onMessage: text => this.message(text)});
    this.postmatch = new M86Postmatch({host: $('battle-stage'), client,
      releaseInput: () => this.input.releaseAll(),
      playSound: (resource, position, options) => this.playSound(resource, position, options)});
    this.resultViewport = null;
    this.recovery = new BattleRenderRecovery({host: $('battle-panel'),
      onReload: () => { this.input.releaseAll(); window.location.replace(battleReloadUrl(window.location.href)); },
      onLeave: async () => { this.input.releaseAll(); await client.leaveRoom(); }});
    this.roboHud = new RoboHud({host: $('robo-hud-host'),
      resolveFrameAsset: asset => this.store.resolveRoboFrameAsset(asset),
      onCast: slot => this.input.castFromButton(slot),
      onSkillHover: slot => this.input.hoverSkill(slot),
      castAvailability: (slot, now) => this.input.castAvailability(slot, now),
      onPortraitHover: accountId => this.input.hoverPortrait(accountId),
      portraitCopyAvailability: (accountId, now) => this.input.portraitCopyAvailability(accountId, now),
      onExit: () => this.run(async () => { this.input.releaseAll(); await client.leaveRoom(); }),
      onSettings: () => {
        if(this.onOpenSettings){this.input.releaseAll('settings');this.onOpenSettings();return;}
        this.input.releaseAll(); $('robo-settings').hidden = !$('robo-settings').hidden;
        $('robo-sound').textContent = this.audio.enabled ? 'Tắt âm thanh' : 'Bật âm thanh';
      },
      onSelectAccount: accountId => {
        if (this.client.state.phase === 'ready' && this.input.castFromPortrait(accountId)) return;
        if (this.client.state.phase === 'ready'
            && this.spectator.selectAccount(this.client.combat, accountId, performance.now())) this.input.releaseAll();
      }});
    client.getAim = () => { const input = this.input.snapshot(); return input.active ? input.aim : null; };
    const nextSpectator = () => {
      if (this.client.state.phase === 'ready'
          && this.spectator.next(this.client.combat, performance.now())) this.input.releaseAll();
    };
    $('spectate-next').onclick = nextSpectator;
    this.canvas.addEventListener('click', () => {
      const self = this.client.combat?.actors?.[String(this.client.combat?.selfObjectId)];
      if (self?.dead) nextSpectator();
    });
    $('battle-zoom').onchange = () => { this.camera.zoom = Number($('battle-zoom').value); };
    $('battle-sound').onclick = () => run(async () => {
      await this.audio.setEnabled(!this.audio.enabled);
      this.roboSoundWanted = this.audio.enabled;
      $('battle-sound').textContent = this.audio.enabled ? 'Tắt âm thanh' : 'Bật âm thanh';
      $('battle-sound').setAttribute('aria-pressed', String(this.audio.enabled));
    });
    this.toggleFullscreen = async () => {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await $('battle-panel').requestFullscreen();
    };
    $('battle-fullscreen').onclick = () => run(()=>this.toggleFullscreen());
    $('robo-sound').onclick = () => run(async () => {
      await this.audio.setEnabled(!this.audio.enabled);
      this.roboSoundWanted = this.audio.enabled;
      $('robo-sound').textContent = this.audio.enabled ? 'Tắt âm thanh' : 'Bật âm thanh';
      $('battle-sound').textContent = $('robo-sound').textContent;
      $('battle-sound').setAttribute('aria-pressed', String(this.audio.enabled));
    });
    $('robo-fullscreen').onclick = $('battle-fullscreen').onclick;
    $('robo-renderer').value = rendererPreference();
    $('robo-renderer-apply').onclick = () => this.run(async () => {
      saveRendererPreference($('robo-renderer').value);
      this.input.releaseAll(); window.location.reload();
    });
    $('robo-settings-close').onclick = () => { $('robo-settings').hidden = true; this.input.activate(); };
    $('robo-exit').onclick = () => run(async () => {
      this.input.releaseAll(); $('robo-settings').hidden = true; await client.leaveRoom();
    });
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this.roboActive) $('robo-settings').hidden = true;
    });
    const unlockRoboSound = () => {
      if (this.roboActive && this.roboSoundWanted && this.input.active && !this.audio.enabled) {
        this.audio.setEnabled(true).catch(error => this.message(error.message));
      }
    };
    this.canvas.addEventListener('pointerdown', unlockRoboSound);
    window.addEventListener('keydown', event => {
      if (/^(Key[WASDER]|Space|Arrow(Up|Down|Left|Right))$/.test(event.code)) unlockRoboSound();
    });
    for (const node of document.querySelectorAll('[data-skill-slot]')) {
      node.onclick = () => this.input.castFromButton(Number(node.dataset.skillSlot));
      let pointerInside=false;
      node.onpointerenter=()=>{pointerInside=true;this.input.hoverSkill(Number(node.dataset.skillSlot));};
      node.onpointerleave=node.onpointercancel=()=>{pointerInside=false;this.input.hoverSkill(null);};
      node.onfocus=()=>this.input.hoverSkill(Number(node.dataset.skillSlot));
      // A HUD click focuses the canvas to cast. That focus change must not
      // cancel an inspection while the pointer is still over the skill.
      node.onblur=()=>{if(!pointerInside)this.input.hoverSkill(null);};
    }
    $('close-result').onclick = () => this.postmatch.returnToLobby();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe($('battle-stage'));
    this.drawSequence = this.drawSequence.bind(this);
    this.frame = this.frame.bind(this); this.raf = requestAnimationFrame(this.frame);
  }

  message(text) { $('battle-input-message').textContent = text; this.messageAt = performance.now(); }

  update(state) {
    const render = state.play.render, inScene = ['loading', 'scene'].includes(state.play.phase);
    $('battle-panel').hidden = !inScene || (!render?.supported && render?.phase !== 'loading');
    if (render?.phase === 'error' || (render?.phase === 'ready' && !render.supported)) {
      $('battle-scope').textContent = render.message;
    }
    $('battle-loading').hidden = !this.surface.lost && state.phase === 'ready' && render?.phase === 'ready' && state.play.phase === 'scene';
    $('battle-loading').textContent = this.surface.lost ? 'Đang khôi phục hình ảnh…' : state.phase !== 'ready' ? state.message : render?.message || 'Đang nhận scene…';
    if (!clientReady(state)) this.input.releaseAll();
    if (this.client.sceneAssets?.supported && this.prepared !== this.client.sceneAssets) {
      this.prepared = this.client.sceneAssets;
      this.geometry = createBattleGeometry(this.prepared.map, this.prepared.catalog);
      this.setRoboActive(!!this.prepared.roboHudCatalog?.maps?.[String(state.play.scene?.mapId)]);
      this.roboWorld.setCatalog(this.prepared.roboHudCatalog);
      this.skillNames = this.roboActive ? new M7SkillNames(this.prepared.catalog.skills,
        this.prepared.skillNameCatalog) : null;
      const cursor = this.prepared.roboHudCatalog?.cursors?.normal;
      if (this.roboActive && cursor?.asset?.url) $('battle-panel').style.setProperty('--m7-native-cursor',
        `url("${cursor.asset.url}") ${cursor.hotspot.x} ${cursor.hotspot.y}, auto`);
      this.resize();
    }
    if (!inScene) {
      this.recovery.clear(); this.error = null;
      this.setRoboActive(false); this.roboWorld.clear(); this.roboHud.clear();
      this.geometry = null; this.prepared = null; this.combatSeen = null;
      this.spectator.reset(); this.teamHud.clear();
      this.positions.clear(); this.buffFirstSeen.clear(); this.bodyTimelines.clear();
      this.nativeBodies.clear(); this.companionClocks.clear(); this.skillNames?.reset();
      this.pveBossHud.reset();
      this.nativeStatuses.clear(); this.nativeSpeedTrails.clear(); this.nativeCannons.clear();
      this.lastFrameAt = null;
      this.effects.reset(); this.sceneItems.reset();
      this.surface.clear(); this.context.clearRect(0, 0, this.width || 1, this.height || 1);
      $('battle-result').hidden = true; this.resultSeen = null; this.resultViewport = null;
      this.postmatch.reset();
      this.audio.stopAll(); this.shake.reset(); this.shakeOffset = {x: 0, y: 0};
      this.linkFrames.clear(); this.linkDiagnostics = []; this.mapNpcDiagnostics.clear();
      this.drawnResources.clear();
      if (this.store.sceneId != null) this.store.releaseScene?.();
      this.surface.dispose();
    }
  }

  setRoboActive(active) {
    if (active === this.roboActive) return;
    this.roboActive = active;
    $('battle-panel').classList.toggle('robo-native', active);
    document.body.classList.toggle('m7-robo-active', active);
    $('robo-hud-host').hidden = !active; $('robo-settings').hidden = true;
    if (!active) {
      $('battle-panel').style.removeProperty('--m7-native-cursor');
      this.roboHud.clearSkillHover();this.input.hoverSkill(null);
    }
    if (active) { this.camera.zoom = 1; $('battle-zoom').value = '1'; this.roboCamera.reset(); }
  }

  resize() {
    const rect = $('battle-stage').getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return;
    this.width = rect.width; this.height = rect.height;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    this.surface.resize(this.width, this.height, ratio);
    this.overlay.width = Math.round(this.width * ratio); this.overlay.height = Math.round(this.height * ratio);
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (this.roboActive) {
      const native = this.roboCamera.resize(this.width, this.height,
        this.geometry?.width || 2400, this.geometry?.height || 2400,
        {centerSmallMap: centerSmallBattleMap(this.prepared?.map?.mapId, this.client.state?.play?.scene)});
      // Update the input transform immediately, not one animation frame later.
      this.camera.x = native.centerX; this.camera.y = native.centerY; this.camera.zoom = native.zoom;
      this.roboHud.resize(this.width, this.height);
    }
  }

  worldPoint(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return {x: this.camera.x + (clientX - rect.left - this.width / 2 - this.shakeOffset.x) / this.camera.zoom,
      y: this.camera.y + (clientY - rect.top - this.height / 2 - this.shakeOffset.y) / this.camera.zoom};
  }

  screenPoint(x, y) { return {x: (x - this.camera.x) * this.camera.zoom + this.width / 2 + this.shakeOffset.x,
    y: (y - this.camera.y) * this.camera.zoom + this.height / 2 + this.shakeOffset.y}; }

  frame(now) {
    this.raf = requestAnimationFrame(this.frame);
    const state = this.client.combat;
    if (!state || !this.geometry || $('battle-panel').hidden || !this.prepared?.supported) {
      this.lastFrameAt = null; return;
    }
    // Do not count blank frames or auto-reactivate movement while the browser
    // is restoring a real GL loss. Native networking continues unchanged.
    if (this.surface.lost) {
      this.input.releaseAll('graphics');this.lastFrameAt=null;
      $('battle-loading').hidden=false;$('battle-loading').textContent='Đang khôi phục hình ảnh…';
      return;
    }
    if (this.combatSeen !== state) {
      this.recovery.clear();
      this.combatSeen = state; this.effects.reset(); this.sceneItems.reset();
      this.positions.clear(); this.buffFirstSeen.clear(); this.bodyTimelines.clear();
      this.nativeBodies.clear(); this.companionClocks.clear(); this.skillNames?.reset();
      this.pveBossHud.reset();
      this.nativeStatuses.clear(); this.nativeSpeedTrails.clear(); this.nativeCannons.clear();
      this.error = null; this.resultSeen = null; this.animationStart = now;
      this.postmatch.reset(); this.resultViewport = null;
      this.spectator.reset(); this.teamHud.clear();
      this.roboCamera.reset(); this.roboWorld.clear(); this.roboHud.clear(); this.roboInputLife = null;
      this.audio.stopAll(); this.shake.reset(); this.linkFrames.clear();
      this.drawnResources.clear();
      this.frameTimes = []; this.drawTimes = []; this.frames = 0; this.lastFrameAt = null;
    }
    // Freeze the final rendered battlefield behind the native honors. A real
    // resize still renders once at the finished timestamp. S1708 redelivery
    // refreshes the data without replaying the title/medal timer chain.
    if (state.result && this.resultSeen) {
      if (this.resultSeen !== state.result) this.drawResult(state);
      const viewport = `${this.width}:${this.height}`;
      if (this.resultViewport === viewport) return;
      this.resultViewport = viewport;
      now = this.postmatch.flow.startedAt || now;
    }
    if (this.error) return;
    const begun = performance.now();
    try {
      const self = state.actors[String(state.selfObjectId)];
      if (!self) return;
      if (this.roboActive) {
        this.roboWorld.drawn.spawnArrow = false;
        const inputLife = `${self.objectId}:${self.lifeEpoch}`;
        if (!self.dead && this.roboInputLife !== inputLife && this.client.canControl()
            && !document.hidden && document.hasFocus()) {
          this.input.activate(now); this.roboInputLife = inputLife;
        }
      }
      const spectator = this.spectator.update(state, now);
      const followed = state.actors[String(spectator.followObjectId)] || self;
      const position = visualPosition(followed, now), zoom = this.camera.zoom;
      if (this.roboActive) {
        const native = this.roboCamera.follow(position.x, position.y);
        this.camera.x = native.centerX; this.camera.y = native.centerY; this.camera.zoom = native.zoom;
      } else {
        this.camera.x = clamp(position.x, Math.min(this.width / zoom / 2, this.geometry.width / 2),
          Math.max(this.geometry.width - this.width / zoom / 2, this.geometry.width / 2));
        this.camera.y = clamp(position.y, Math.min(this.height / zoom / 2, this.geometry.height / 2),
          Math.max(this.geometry.height - this.height / zoom / 2, this.geometry.height / 2));
      }
      this.input.tick(now);
      const events = takeCombatEffects(state);
      this.pveBossHud.consume(events, state, this.prepared.catalog);
      if (this.roboActive) this.roboWorld.consume(events);
      this.skillNames?.consume(events, state);
      this.effects.consume(events, state, this.geometry);
      this.effects.announcer.tick(now);
      this.shakeOffset = this.shake.sample(now);
      this.store.beginFrame?.(); this.linkDiagnostics = [];
      this.audio.sample();
      const liveBuffKeys = new Set([...Object.values(state.actors), ...Object.values(state.objects)]
        .flatMap(actor => nativeHaloBuffVector(actor, state, this.prepared)
          .map(buff => `${actor.objectId}:${actor.lifeEpoch}:${buff.templateId}`)));
      for (const key of this.buffFirstSeen.keys()) if (!liveBuffKeys.has(key)) this.buffFirstSeen.delete(key);
      this.surface.clear(); this.context.clearRect(0, 0, this.width, this.height);
      this.drawMap();
      this.effects.draw('map-base', now, this.drawSequence);
      drawNativeFlags(this,state,now);
      this.effects.draw('below-actors', now, this.drawSequence);
      this.drawProjectiles(state, now, 'below-actors');
      this.drawPortals(state, now);
      // ActiveObjectLayer puts itemLayer under tankLayer. Native zero-HP
      // SceneItems stay until a server deletion vector; no local expiry.
      this.sceneItems.draw(state, now, {
        isVisible: (x, y, halfEdge) => {
          const screen = this.screenPoint(x, y), edge = halfEdge * this.camera.zoom;
          return screen.x >= -edge && screen.y >= -edge
            && screen.x <= this.width + edge && screen.y <= this.height + edge;
        },
        drawSequence: this.drawSequence,
        drawCircle: (source, x, y) => {
          const screen = this.screenPoint(x, y);
          this.surface.draw(source, {sw: source.width, sh: source.height,
            x: screen.x, y: screen.y, width: source.width * this.camera.zoom,
            height: source.height * this.camera.zoom});
        },
      });
      const actors = battleActorEntities(this.prepared.catalog, state)
        .filter(actor => this.geometry.visibleToSelf(actor, state, now));
      const npcs = Object.values(state.objects).filter(object => (object.objectId >>> 26) === 3
        && !object.removed && !object.dead
        && !(object.maxHp > 0 && object.hp <= 0)
        && this.mapNpcTemplate(object));
      this.mapNpcDiagnostics.clear();
      const underSky = npcs.filter(object => [52, 53].includes(Number(this.mapNpcTemplate(object).raw.iType)));
      const active = [...actors, ...npcs.filter(object => !underSky.includes(object))]
        .sort((a, b) => this.sortWeight(a) - this.sortWeight(b)
          || visualPosition(a, now).y - visualPosition(b, now).y
          || visualPosition(a, now).x - visualPosition(b, now).x || a.objectId - b.objectId);
      for (const object of active) {
        if ((object.objectId >>> 26) === 3 && this.mapNpcTemplate(object)) this.drawNpc(object, now);
        else this.drawActor(object, state, now);
      }
      for (const object of underSky.sort((a, b) => a.y - b.y || a.x - b.x)) this.drawNpc(object, now);
      if (this.prepared.map.sky) this.drawMapImage(this.prepared.map.sky);
      this.drawProjectiles(state, now, 'above-actors');
      this.effects.draw('above-actors', now, this.drawSequence);
      this.skillNames?.draw(now, this.drawSequence);
      this.drawLinkBuffs(state, now);
      drawNativeFlags(this,state,now,true);
      drawNativeTargeting(this,state,now);
      this.effects.offlinePve.draw(this,state,now);
      if (this.roboActive) { this.roboWorld.drawFloats(now); this.roboWorld.drawSelfMarker(state, now); }
      const liveLinkKeys = new Set(this.linkDiagnostics.map(link => link.key));
      for (const key of this.linkFrames.keys()) if (!liveLinkKeys.has(key)) this.linkFrames.delete(key);
      const liveActorIds = new Set(actors.map(actor => actor.objectId));
      for (const id of this.positions.keys()) if (!liveActorIds.has(id)) this.positions.delete(id);
      for (const key of this.bodyTimelines.keys()) {
        const [id, epoch, change] = String(key).split(':').map(Number);
        const actor = state.actors[String(id)] || state.objects[String(id)];
        if (!liveActorIds.has(id) || actor?.lifeEpoch !== epoch
            || (actorAppearance(this.prepared.catalog, actor, state).transition?.sequence ?? 0) !== change) this.bodyTimelines.delete(key);
      }
      for (const records of [this.nativeBodies, this.nativeStatuses, this.nativeSpeedTrails, this.nativeCannons,this.companionClocks]) for (const key of records.keys()) {
        const [id, epoch] = String(key).split(':').map(Number);
        const actor = state.actors[String(id)] || state.objects[String(id)];
        // Native updateVisible hides the actor without releasing its body.
        // Keep stopped frames/tweens through temporary invisibility or fog.
        if (!actor || actor.removed || actor.dead || actor.lifeEpoch !== epoch) records.delete(key);
      }
      this.syncEngineSounds(actors, state, now);
      this.drawOverlays(actors, state, now);
      this.pveBossHud.draw(this, state);
      drawWorldBossHud(this,state,now);
      if (this.roboActive) this.store.beginRoboHudFrame();
      try {
        if (this.roboActive) this.roboHud.updateAnnouncement(this.effects.announcer.active,
          this.prepared.catalog, this.prepared.killBannerCatalog, now);
        if (now - this.lastHudAt >= 80 || state.result !== this.resultSeen) {
          this.lastHudAt = now; this.drawHud(state, self, now);
        }
        if (this.roboActive) this.roboHud.animate?.(now);
      } finally {
        if (this.roboActive) this.store.endRoboHudFrame();
      }
      if (this.lastFrameAt != null && now - this.lastFrameAt < 1000) this.frameTimes.push(now - this.lastFrameAt);
      this.lastFrameAt = now; this.frames += 1; this.drawTimes.push(performance.now() - begun);
      if (this.frameTimes.length > 1200) this.frameTimes.shift();
      if (this.drawTimes.length > 1200) this.drawTimes.shift();
    } catch (error) {
      this.error = error.message; this.input.releaseAll(); this.message(`Hiển thị trận cần kiểm tra: ${error.message}`);
      this.recovery.show(error);
      console.error('Battle render failed', error);
    }
  }

  drawMap() {
    this.drawMapImage(this.prepared.map.background);
    if (this.roboActive) this.roboWorld.drawAirMarker();
  }

  drawMapImage(source) {
    const image = this.store.image(source);
    if (!image) throw new Error('Ảnh bản đồ chưa được giải mã.');
    const zoom = this.camera.zoom;
    const left = Math.max(0, this.camera.x - this.width / zoom / 2);
    const top = Math.max(0, this.camera.y - this.height / zoom / 2);
    const right = Math.min(this.geometry.width, this.camera.x + this.width / zoom / 2);
    const bottom = Math.min(this.geometry.height, this.camera.y + this.height / zoom / 2);
    const pos = this.screenPoint((left + right) / 2, (top + bottom) / 2);
    this.surface.draw(image, {sx: left, sy: top, sw: right - left, sh: bottom - top,
      x: pos.x, y: pos.y, width: (right - left) * zoom, height: (bottom - top) * zoom});
  }

  drawPortals(state, now) {
    for (const point of this.prepared.map.portals || []) {
      const status = state.portals[String(point.index)];
      if (!status) continue; // Never invent portal availability before S1589.
      const sequence = resourceSequence(this.store, point.resources[String(status.state)]);
      if (!sequence?.frames?.length) continue;
      const index = portalFrame(sequence, now - status.changedAt);
      // Native loader sits at (-ICON_EDGE/2, -ICON_EDGE/2), not at the
      // alpha-bounds centre of each differently-sized animation frame.
      const drawn = this.drawSequence(sequence, index,
        point.position[0] - point.iconEdge / 2, point.position[1] - point.iconEdge / 2);
      this.recordResourceDraw(`portal:${point.index}:${status.changedAt}`, sequence, index, now, drawn,
        {kind: 'portal', objectId: point.index, templateId: point.template, nativeReceivedAt: status.changedAt});
    }
  }

  drawFrame(asset, frame, x, y, rotation = 0, alpha = 1, placement = null, additive = false) {
    const image = this.store.image(asset);
    if (!image) { this.store.requestImage?.(asset); return false; }
    if (!frame || !frame.w || !frame.h) return false;
    const zoom = this.camera.zoom;
    const cos = Math.cos(rotation), sin = Math.sin(rotation);
    const matrix = [cos, sin, -sin, cos];
    // A body/shadow's native placement is outside its independent rotation.
    // The SWF converter retains this placement rather than flattening it.
    if (placement) {
      if (placement.preserveMatrix) {
        const {a = 1, b = 0, c = 0, d = 1} = placement;
        matrix[0] = cos * a - sin * b; matrix[1] = sin * a + cos * b;
        matrix[2] = cos * c - sin * d; matrix[3] = sin * c + cos * d;
      } else {
        const scaleX = Math.hypot(placement.a ?? 1, placement.b ?? 0);
        const determinant = (placement.a ?? 1) * (placement.d ?? 1) - (placement.b ?? 0) * (placement.c ?? 0);
        const scaleY = Math.hypot(placement.c ?? 0, placement.d ?? 1) * (determinant < 0 ? -1 : 1);
        matrix[0] *= scaleX; matrix[1] *= scaleX; matrix[2] *= scaleY; matrix[3] *= scaleY;
      }
      x += placement.x || 0; y += placement.y || 0;
    }
    // Exact source pixels can carry a native scaled destination rectangle.
    // Keep the fractional bitmap crop unchanged; scaling belongs to the draw,
    // not to a pre-rasterized replacement image. Old frames use w/h unchanged.
    const drawWidth=frame.drawWidth??frame.w,drawHeight=frame.drawHeight??frame.h;
    if(!Number.isFinite(drawWidth)||!Number.isFinite(drawHeight)||drawWidth<=0||drawHeight<=0)return false;
    const offsetX = (frame.offsetX ?? 0) + drawWidth / 2;
    const offsetY = (frame.offsetY ?? 0) + drawHeight / 2;
    const pos = this.screenPoint(x + matrix[0] * offsetX + matrix[2] * offsetY,
      y + matrix[1] * offsetX + matrix[3] * offsetY);
    // Cull by a conservative rotated bound, keeping large execute movies.
    const transform = this.surface.transform || {scale: 1, x: 0, y: 0};
    const radius = (Math.abs(drawWidth) * Math.hypot(matrix[0],matrix[1])
      + Math.abs(drawHeight) * Math.hypot(matrix[2],matrix[3])) * zoom * transform.scale;
    const drawX = pos.x * transform.scale + transform.x, drawY = pos.y * transform.scale + transform.y;
    if (drawX < -radius || drawY < -radius || drawX > this.width + radius || drawY > this.height + radius) return false;
    this.surface.draw(image, {sx: frame.sx, sy: frame.sy, sw: frame.w, sh: frame.h,
      x: pos.x, y: pos.y, width: drawWidth * zoom, height: drawHeight * zoom, matrix, alpha, additive,
      // Native SWF bitmap fills 0x42/0x43 explicitly disable interpolation.
      // Older descriptors have no fill tag and retain their established path.
      ...([0x42,0x43].includes(frame.sourceFillType)?{bitmapSmoothing:false}:{})});
    return true;
  }

  drawSequence(sequence, index, x, y, rotation = 0, alpha = 1, {autoCenter = false,scaleX=1,scaleY=1} = {}) {
    let frame = sequence.frames[index];
    if (!frame) return false;
    if(frame.nativeLayers){
      // One separately audited static display list: bitmap-only, at most
      // three depth-ordered leaves, alpha multipliers only, no scripts/masks.
      if(sequence.derived?.mode!=='m81335-static-layers'
          ||sequence.derived.nativeAffineSchema!=='m81335-static-layers/v1'
          ||sequence.derived.sourceSha256!=='262bc15387f04339b16f67c0d283ac2ce7afab43e799a09800268404364dd7e7'
          ||!Array.isArray(frame.nativeLayers)||frame.nativeLayers.length>3)return false;
      let ox=0,oy=0;
      if(autoCenter){
        const offset=sequence.derived.autoCenterOffset,rect=sequence.derived.originalStageRect;
        if(offset){ox=offset.x??offset[0]??0;oy=offset.y??offset[1]??0;}
        else if(rect){if(rect[2]-rect[0]>1)ox=Math.floor(-(rect[2]-rect[0])/2);
          if(rect[3]-rect[1]>1)oy=Math.floor(-(rect[3]-rect[1])/2);}
      }
      // Validate the complete frame before submitting any partial draw.
      let depth=-1;
      for(const layer of frame.nativeLayers){
        if(!Number.isInteger(layer.sourceDepth)||layer.sourceDepth<=depth
            ||!Number.isFinite(layer.nativeAlpha)||layer.nativeAlpha<0||layer.nativeAlpha>1
            ||!['a','b','c','d','x','y'].every(key=>Number.isFinite(layer.nativeAffineMatrix?.[key])))return false;
        depth=layer.sourceDepth;
      }
      const cos=Math.cos(rotation),sin=Math.sin(rotation);let drawn=false;
      for(const layer of frame.nativeLayers){
        if(layer.empty||layer.nativeAlpha===0)continue;
        const matrix=layer.nativeAffineMatrix,tx=scaleX*(ox+matrix.x),ty=scaleY*(oy+matrix.y);
        const placement={a:scaleX*matrix.a,b:scaleY*matrix.b,c:scaleX*matrix.c,d:scaleY*matrix.d,
          x:cos*tx-sin*ty,y:sin*tx+cos*ty,preserveMatrix:true};
        const asset=layer.asset||(layer.assetIndex!=null?sequence.assets?.[layer.assetIndex]:null)||sequence.asset;
        drawn=this.drawFrame(asset,layer,x,y,rotation,alpha*layer.nativeAlpha,placement,nativeSequenceAdditive(sequence))||drawn;
      }
      return drawn;
    }
    const affine = frame.nativeAffineMatrix;
    if(affine&&(sequence.derived?.mode!=='m81335-static-affine'
        ||sequence.derived.nativeAffineSchema!=='m81335-static-affine/v1'
        ||sequence.derived.sourceSha256!=='93aba04be8474053b640f413fa550e0d3784525a9a13bebd7f701ca4aca549e7'
        ||!['a','b','c','d','x','y'].every(key=>Number.isFinite(affine[key]))))return false;
    if(sequence.derived?.mode==='m81335-static-affine'&&frame.empty===true)return false;
    let offsetX = 0, offsetY = 0;
    if (autoCenter && sequence.derived) {
      const offset = sequence.derived.autoCenterOffset;
      if (offset) {
        offsetX = offset.x ?? offset[0] ?? 0; offsetY = offset.y ?? offset[1] ?? 0;
      } else {
        const rect = sequence.derived.originalStageRect;
        const width = rect ? rect[2] - rect[0] : 1, height = rect ? rect[3] - rect[1] : 1;
        if (width > 1) offsetX = Math.floor(-width / 2);
        if (height > 1) offsetY = Math.floor(-height / 2);
      }
      // The one source-pinned affine movie keeps auto-centering in the parent
      // stage, not in the bitmap's local coordinates. Old movies are unchanged.
      if(!affine)frame = {...frame, offsetX: frame.offsetX + offsetX, offsetY: frame.offsetY + offsetY};
    }
    const asset = frame.asset || (frame.assetIndex != null ? sequence.assets?.[frame.assetIndex] : null) || sequence.asset;
    if (sequence.derived?.mode !== 'distance-frames') {
      const ahead = sequence.frames[Math.min(sequence.frames.length - 1, index + 6)];
      if (ahead) this.store.requestImage?.(ahead.asset
        || (ahead.assetIndex != null ? sequence.assets?.[ahead.assetIndex] : null) || sequence.asset);
    }
    let placement=scaleX===1&&scaleY===1?null:{a:scaleX,d:scaleY,preserveMatrix:true};
    if(affine){
      // T(world) R(follow) S(consumer) T(autoCenter) M(source). drawFrame's
      // legacy body placement translation is world-space, so transform this
      // source translation explicitly instead of changing old consumers.
      const cos=Math.cos(rotation),sin=Math.sin(rotation);
      const tx=scaleX*(offsetX+affine.x),ty=scaleY*(offsetY+affine.y);
      placement={a:scaleX*affine.a,b:scaleY*affine.b,c:scaleX*affine.c,d:scaleY*affine.d,
        x:cos*tx-sin*ty,y:sin*tx+cos*ty,preserveMatrix:true};
    }
    return this.drawFrame(asset, frame, x, y, rotation, alpha,placement,nativeSequenceAdditive(sequence));
  }

  recordResourceDraw(key, sequence, index, now, drawn, identity) {
    // Observation only, after a decoded source frame was submitted. This is
    // bounded scene evidence for continuous bullets/buffs which do not enter
    // the transient BattleEffects pool. Empty native SWF frames stay explicit.
    if (!drawn) return;
    let row = this.drawnResources.get(key);
    if (!row) {
      row = {key, ...identity, logical: sequence.source?.logical ?? null,
        sha256: sequence.source?.sha256 ?? null, firstDrawAt: now, framesDrawn: 0};
      this.drawnResources.set(key, row);
      if (this.drawnResources.size > 96) this.drawnResources.delete(this.drawnResources.keys().next().value);
    }
    row.framesDrawn += 1; row.lastDrawAt = now; row.lastFrame = index;
    row.lastFrameEmpty = sequence.frames[index]?.empty === true;
  }

  drawPart(part, x, y, rotation, moving, now, lastFire, alpha, bodyState = {}) {
    if (!part) return null;
    const submitted = {logical: part.source?.logical || null, drawn: false, frames: []};
    const elapsed = Math.max(0, now - (bodyState.startedAt ?? this.animationStart));
    if (part.format === 'png-sheet') {
      const animation = part.animation || {}, layout = part.directionLayout || {};
      let index = 0, residual = rotation;
      if (layout.mode === 'eight-groups') {
        const group = ((Math.round(rotation * 180 / Math.PI / 45) % 8) + 8) % 8;
        const count = layout.framesPerDirection || 1;
        let frame = moving || animation.idleAnimated
          ? Math.floor(elapsed / (NORMAL_TICK_MS * (animation.ticksPerFrame || 1))) % count : 0;
        if (this.roboActive && part.kind === 'body' && bodyState.native?.timeline) {
          frame = bodyState.native.frame;
          submitted.timeline = bodyState.native.timeline;
        }
        index = group * count + frame;
        residual = rotation - Math.round(rotation / (Math.PI / 4)) * Math.PI / 4;
      } else if (part.kind === 'cannon' && lastFire != null) {
        const sequence = animation.fireFrames || [0];
        const frame = Math.floor((now - lastFire) / (NORMAL_TICK_MS * (animation.ticksPerFrame || 1)));
        index = frame < sequence.length ? sequence[Math.max(0, frame)] : animation.idleFrame || 0;
      } else if (animation.idleAnimated) {
        index = Math.floor(elapsed / (NORMAL_TICK_MS * (animation.ticksPerFrame || 1))) % part.frames.length;
      }
      if (Number(layout.fixedAngle)) residual = radians(layout.fixedAngle);
      const frame = part.frames[index];
      // Supplied Loạn Chiến bitmap clips are cropped, multi-page WebP atlases.
      // Keep the original JSON source identity, and submit the exact page for
      // each frame. Existing native single-sheet PNG parts retain their path.
      const asset = part.atlasFrames
        ? frame?.asset || part.derived?.assets?.[frame?.assetIndex] : part.source;
      submitted.drawn = this.drawFrame(asset, frame, x, y, residual, alpha);
      submitted.frames.push({index, drawn: submitted.drawn});
      return submitted;
    }
    const derived = part.derived;
    if (!derived) { this.store.recordMissing(part.source, 'not_converted'); return submitted; }
    const cannonClock = part.kind === 'cannon' ? bodyState.cannon : null;
    const rootElapsed = cannonClock?.elapsed ?? elapsed;
    const fireAge = cannonClock ? cannonClock.fireAge : lastFire == null ? null : now - lastFire;
    if (derived.mode === 'm81335-cannon-clips') {
      // The supplied Godot source exposes a baked fire clip and a separately
      // looping idle child, not the original Flash ABC controller. Use those
      // explicit ranges without guessing frame actions. The idle child keeps
      // its elapsed phase while hidden by fire, including off-screen time.
      const tickMs = (derived.timing?.nominalTickMs || NORMAL_TICK_MS)
        * (derived.animation?.ticksPerFrame || 1);
      const fireIndex = fireAge == null ? -1 : Math.floor(fireAge / tickMs);
      const firing = fireIndex >= 0 && fireIndex < derived.clips.fire.frames.length;
      const clip = firing ? derived.clips.fire : derived.clips.idle;
      const phase = firing ? fireIndex
        : Math.floor((cannonClock?.childElapsed ?? elapsed) / tickMs) % clip.frames.length;
      const index = clip.frames[phase], frame = derived.frames[index];
      const asset = frame?.asset || derived.assets?.[frame?.assetIndex] || derived.asset;
      submitted.clock = cannonClock;
      submitted.drawn = !!frame && this.drawFrame(asset, frame, x, y, rotation, alpha, clip.placement);
      submitted.frames.push({layer:firing?'source-fire':'source-idle',index,drawn:submitted.drawn});
      return submitted;
    }
    // MCUtil.fetchMcRoot.stop() pauses the root only. The independently
    // playing artwork of a cannon-nested conversion continues to animate.
    const artworkElapsed = cannonClock
      ? derived.mode === 'cannon-nested' ? cannonClock.childElapsed : rootElapsed : elapsed;
    if (cannonClock) submitted.clock = cannonClock;
    const layers = derived.layers?.length ? derived.layers : [{...derived, name: part.kind}];
    let bodyTimeline = null;
    if (derived.mode === 'body-layers' && derived.animation?.nativeEndExclusive && !bodyState.native) {
      bodyTimeline = this.bodyTimelines.get(bodyState.key);
      if (!bodyTimeline) {
        bodyTimeline = new NativeBodyTimeline(derived.animation.nativeEndExclusive, derived.timing?.nominalTickMs,
          {includeLastFrame:derived.sourceFormat==='loan-chien-godot-atlas-v1' && derived.animation.loopIncludesLastFrame===true});
        this.bodyTimelines.set(bodyState.key, bodyTimeline);
      }
      bodyTimeline.sample(now, {moving, rushing: bodyState.rushing, frozen: bodyState.frozen});
    }
    for (const layer of layers) {
      const animation = layer.animation || derived.animation || part.animation || {};
      const frameMs = (derived.timing?.nominalTickMs || NORMAL_TICK_MS) * (animation.ticksPerFrame || 1);
      const frames = layer.frames || derived.frames;
      const playing = animation.idleAnimated !== false || moving || part.kind === 'cannon';
      let index = playing ? Math.floor(artworkElapsed / frameMs) % frames.length : 0;
      if (bodyTimeline) index = bodyTimeline.layerIndex(frames.length);
      if (bodyState.native?.timeline && derived.mode === 'body-layers') {
        index = Math.max(0, Math.min(frames.length - 1, bodyState.native.frame));
        submitted.timeline = bodyState.native.timeline;
      }
      if (part.kind === 'cannon' && animation.idleFrames?.length) {
        index = nativeCannonFrame(animation, rootElapsed, fireAge, frameMs);
      }
      let placement = layer.placement;
      if (part.kind === 'cannon' && derived.rootFireTransforms?.length) {
        const idleIndex = (derived.labels?.idle || 1) - 1;
        const fireIndex = fireAge == null ? -1 : (derived.labels?.fire || 1) - 1 + Math.floor(fireAge / frameMs);
        const rootIndex=derived.rootAnimation
          ?nativeCannonFrame(derived.rootAnimation,rootElapsed,fireAge,frameMs)
          :fireIndex >= 0 && fireIndex < derived.rootFireTransforms.length?fireIndex:idleIndex;
        const transform = derived.rootFireTransforms[rootIndex];
        const tx = transform.x || 0, ty = transform.y || 0;
        placement = {...transform, preserveMatrix: true,
          x: tx * Math.cos(rotation) - ty * Math.sin(rotation),
          y: tx * Math.sin(rotation) + ty * Math.cos(rotation)};
      }
      if (!animation.idleFrames?.length && animation.fireFrames?.length && fireAge != null) {
        const fireIndex = Math.floor(fireAge / frameMs);
        if (fireIndex < animation.fireFrames.length) index = animation.fireFrames[fireIndex];
      }
      const frame = frames[index];
      const asset = frame?.asset || (frame?.assetIndex != null ? (layer.assets || derived.assets)?.[frame.assetIndex] : null)
        || layer.asset || derived.asset;
      const drawn = !!frame && this.drawFrame(asset, frame, x, y, rotation, alpha, placement);
      submitted.frames.push({layer: layer.name || part.kind, index, drawn});
      submitted.drawn ||= drawn;
    }
    return submitted;
  }

  drawActor(actor, state, now) {
    const catalog = this.prepared.catalog;
    const {visualBaseExternalId: baseExternalId, externalId: external, appearance, transition, shadow} = actorAppearance(catalog, actor, state);
    if (!appearance) { this.store.recordMissing(`appearance:${external}`, 'binding_absent'); return; }
    const position = visualPosition(actor, now);
    const inheritedFacing = shadow && actor.verifiedPosition?.source === 'snapshot';
    const bodyKey = `${actor.objectId}:${actor.lifeEpoch}:${transition?.sequence ?? 0}`;
    let facing = bodyAngle(inheritedFacing ? actor.ownerBodyDirectionAtSnapshot ?? 8 : position.direction);
    const flags = nativeControlFlags(actor, catalog.buffs, now, catalog.skills);
    const lifeKey = `${actor.objectId}:${actor.lifeEpoch}`;
    const ctank = !aiNpcTemplate(catalog, actor) || shadow;
    let bodyTurn = null, nativeBody = null, nativeStatus = null, speedTrail = null;
    if (this.roboActive) {
      if (this.prepared.statusCatalog) {
      let status = this.nativeStatuses.get(lifeKey), trail = this.nativeSpeedTrails.get(lifeKey);
      if (!status) {
        status = new NativeStatusPresentation({ctank, shadow}); this.nativeStatuses.set(lifeKey, status);
      }
      nativeStatus = status.sample({actor, catalog, body: appearance.body, baseExternalId, now});
      if (!trail) {
        const speed = this.prepared.statusCatalog.speedTrail;
        trail = new NativeSpeedTrail({body: catalog.appearances[String(baseExternalId)]?.body || appearance.body,
          direction: shadow ? actor.ownerBodyDirectionAtSnapshot ?? 8 : actor.bodyDirection ?? 8,
          at: actor.lastSnapshotAt ?? now, ctank, frameCount: speed.frameCount, tickMs: speed.frameMs});
        this.nativeSpeedTrails.set(lifeKey, trail);
      }
      speedTrail = trail.sample({actor, position, body: appearance.body, catalog, baseExternalId, now});
      }
      let record = this.nativeBodies.get(lifeKey);
      if (!record) {
        const direction = inheritedFacing ? actor.ownerBodyDirectionAtSnapshot ?? 8 : position.bodyDirection;
        record = new NativeBodyDisplay(appearance.body, direction,
          Math.min(now, transition?.receivedAt ?? actor.lastSnapshotAt ?? now),
          {facingCommands: position.bodyFacingCommands, buffSequence: actor.buffPresentation?.sequence || 0});
        this.nativeBodies.set(lifeKey, record);
      }
      nativeBody = record.sample({actor, position, body: appearance.body, baseExternalId,
        catalog, now, frozen: nativeStatus?.staticState ?? flags.staticState});
      facing = nativeBody.angle; bodyTurn = nativeBody.turn;
    }
    const alpha = flags.invisible || this.geometry.turfAt(position.x, position.y) !== 0 ? .6 : 1;
    let cannon = radians(inheritedFacing ? actor.ownerCannonAngleAtSnapshot || 0 : actor.cannonAngle || 0);
    const input = this.input.snapshot();
    if (actor.objectId === state.selfObjectId && input.aim && !flags.cannonLocked) {
      cannon = input.channelActive && input.cannonAngle != null ? radians(input.cannonAngle)
        : angle(position.x, position.y, input.aim.x, input.aim.y);
    }
    if (ctank && !shadow && !state.result && actor.objectId !== state.selfObjectId)
      cannon = remoteIronmanTimingAngle(actor, catalog, now, cannon);
    this.positions.set(actor.objectId, {...position, bodyAngle: facing, cannonAngle: cannon,
      bodyTurn, bodyGeneration: nativeBody?.generation ?? null,
      externalId: external, appearanceChangeSequence: transition?.sequence ?? 0,
      bodyLogical: appearance.body?.source?.logical ?? null,
      cannonLogical: appearance.cannon?.source?.logical ?? null,
      nativeStatus: nativeStatus && {...nativeStatus, drawn: {body: false, cannon: false},
        applied: {body: null, cannon: null}}, speedTrail: speedTrail && {...speedTrail, drawn: false}});
    const lastFire = this.effects.lastFire.get(actor.objectId);
    const formExternal = transition && catalog.buffs[String(transition.templateId)]?.fEffectValA;
    const formCannon = catalog.appearances[String(formExternal)]?.cannon?.componentId ?? 0;
    const baseCannon = catalog.appearances[String(baseExternalId)]?.cannon?.componentId ?? 0;
    // The scoped native form clears the cannon (5525 -> 0 -> 5525).
    // Restoring it creates an idle component, without replaying an older fire.
    // Existing muzzle/recoil effects keep their own lifetime.
    const componentFire = transition && formCannon !== baseCannon
      && lastFire < transition.receivedAt ? null : lastFire;
    let nativeCannon = null;
    if (this.roboActive && this.prepared.statusCatalog) {
      let record = this.nativeCannons.get(lifeKey);
      if (!record) { record = new NativeCannonPresentation({ctank, shadow}); this.nativeCannons.set(lifeKey, record); }
      nativeCannon = record.sample({actor, catalog, body: appearance.body, baseExternalId,
        cannon: appearance.cannon, now, lastFire: componentFire,
        startedAt: transition?.receivedAt ?? this.animationStart, candidateAngle: cannon,
        staticPresentation: nativeStatus});
      cannon = nativeCannon.angle;
      this.positions.get(actor.objectId).cannonAngle = cannon;
      this.positions.get(actor.objectId).nativeCannon = nativeCannon;
    }
    const presentation = this.roboActive ? nativeSkillPresentation(actor, catalog.buffs, now,
      {ctank}) : {componentScale: 1, objectScale: 1};
    this.positions.get(actor.objectId).presentation = presentation;
    const screen = this.roboActive ? this.screenPoint(position.x, position.y) : null;
    const transform = (scale, draw) => this.roboActive ? this.surface.withTransform(screen.x, screen.y, scale, draw) : draw();
    const bodyMoving = nativeBody ? nativeBody.moving : position.moving;
    transform(presentation.objectScale, () => {
      this.drawBuffs(actor, position, facing, cannon, now, true, alpha);
      transform(presentation.componentScale, () => {
        let bodyDraw, engineDraw, cannonDraw;
        const row = this.positions.get(actor.objectId);
        const filtered = (component, draw) => {
          const filter = nativeStatus?.[`${component}Filter`];
          if (filter?.rendererReady && filter.matrix) {
            const result = this.surface.withColorMatrix(filter.matrix, () => draw(1), {alpha, key: `${lifeKey}:${component}`});
            row.nativeStatus.drawn[component] = result.drawn && result.applied;
            row.nativeStatus.applied[component] = result.applied ? filter.kind : null;
          } else draw(alpha);
        };
        const drawTrail = drawAlpha => {
          if (!speedTrail?.visible) return;
          const speed = this.prepared.statusCatalog.speedTrail;
          row.speedTrail.drawn = this.drawFrame(speed.asset, speed.frames[speedTrail.frame],
            position.x, position.y, speedTrail.rotation, drawAlpha);
          this.recordResourceDraw(`speed:${lifeKey}:${speedTrail.generation}`,
            {...speed, source: speed.asset}, speedTrail.frame, now, row.speedTrail.drawn,
            {kind: 'speedTrail', objectId: actor.objectId, lifeEpoch: actor.lifeEpoch,
              nativeReceivedAt: speedTrail.createdAt, generation: speedTrail.generation});
        };
        filtered('body', drawAlpha => {
          if (speedTrail?.layer === 'under-body') drawTrail(drawAlpha);
          bodyDraw = this.drawPart(appearance.body, position.x, position.y, facing, bodyMoving, now,
            lastFire, drawAlpha, {key: bodyKey, startedAt: transition?.receivedAt,
              native: nativeBody, rushing: nativeBody?.rushing, frozen: nativeStatus?.staticState ?? flags.staticState});
          engineDraw = appearance.engine ? this.drawPart(appearance.engine, position.x, position.y, facing, bodyMoving, now,
            null, drawAlpha, {startedAt: transition?.receivedAt ?? actor.lastSnapshotAt}) : null;
          if (speedTrail?.layer !== 'under-body') drawTrail(drawAlpha);
        });
        filtered('cannon', drawAlpha => {
          cannonDraw = this.drawPart(appearance.cannon, position.x, position.y, cannon, position.moving, now,
            componentFire, drawAlpha, {startedAt: transition?.receivedAt, cannon: nativeCannon});
        });
        this.positions.get(actor.objectId).components = {body: bodyDraw, engine: engineDraw, cannon: cannonDraw};
      });
      if(ctank&&!shadow)this.positions.get(actor.objectId).companion=drawCompanion(this,actor,position,now,alpha);
      this.drawBuffs(actor, position, facing, cannon, now, false, alpha);
      if (this.roboActive) this.roboWorld.drawActor(actor, state, now);
    });
  }

  drawBuffs(actor, position, facing, cannon, now, bottom, alpha, staticNpc = false) {
    const unique = new Map();
    for (const buff of nativeHaloBuffVector(actor, this.client.combat, this.prepared)) {
      const old = unique.get(buff.templateId);
      if (!old || buff.receivedAt < old.receivedAt) unique.set(buff.templateId, buff);
    }
    for (const buff of unique.values()) {
      const row = this.prepared.catalog.buffs[String(buff.templateId)];
      // Both CTank and ordinary AINpcObject route qualifying speed buffs to
      // the native body child. Their generic szBuffSwf branch is not executed.
      if (this.roboActive && !staticNpc && isNativeSpeedBuff(row)) continue;
      if (Number(row?.nEffectType) === 61) continue; // SceneBuffModel owns separate links by instance.
      const isBottom = staticNpc ? Number(row?.iBuffLayer) !== 0 : [1, 2].includes(Number(row?.iBuffLayer));
      if (!row?.resources?.szBuffSwf || isBottom !== bottom) continue;
      const sequence = resourceSequence(this.store, row.resources.szBuffSwf);
      if (!sequence) continue;
      const key = `${actor.objectId}:${actor.lifeEpoch}:${buff.templateId}`;
      if (!this.buffFirstSeen.has(key)) {
        let castRotation = 0;
        if (!staticNpc && Number(row.nFollowType) === 4) {
          const caster = this.client.combat.actors[String(buff.casterId)] || this.client.combat.objects[String(buff.casterId)];
          if (caster) { const from = visualPosition(caster, now); castRotation = angle(from.x, from.y, position.x, position.y); }
        }
        this.buffFirstSeen.set(key, {at: buff.receivedAt ?? now, castRotation});
        this.store.loadResource(row.resources.szBuffSwf).catch(() => {});
      }
      const first = this.buffFirstSeen.get(key);
      const nativeHalo = nativeHaloSample(sequence, first, this.effects.normalClock.sample(now));
      const sample = nativeHalo || timelineSample(sequence.frames.length, now - first.at, sequence.frameMs, true);
      let rotation = Number(row.nFollowType) === 1 ? facing : Number(row.nFollowType) === 2 ? cannon : 0;
      if (Number(row.nFollowType) === 4) rotation = first.castRotation;
      if (staticNpc) rotation = 0; // NpcObject's AutoCenterLoader has no follow transform.
      const drawn = this.drawSequence(sequence, sample.index, position.x, position.y, rotation, alpha, {autoCenter: true});
      const drawKey = `buff:${key}:${buff.instanceId}:${buff.receivedAt}`;
      this.recordResourceDraw(drawKey, sequence, sample.index, now, drawn,
        {kind: 'buff', objectId: actor.objectId, lifeEpoch: actor.lifeEpoch,
          instanceId: buff.instanceId, templateId: buff.templateId, casterId: buff.casterId,
          nativeReceivedAt: buff.receivedAt});
      const observed = this.drawnResources.get(drawKey);
      if (observed && nativeHalo) Object.assign(observed, {
        timelineConsumer: 'AutoCenterLoader', normalTicks: nativeHalo.normalTicks,
        cycleFrames: nativeHalo.cycleFrames, cycleMs: nativeHalo.cycleMs,
        nativeLayer: Number(row.iBuffLayer), presentationSource: buff.presentationSource || 'native-buff',
      });
    }
  }

  sortWeight(object) {
    const npc = (object.objectId >>> 26) === 3 && BattleView.prototype.mapNpcTemplate.call(this, object);
    if (npc) return Number(npc.raw.nSortWeight) || 0;
    const catalog = this.prepared.catalog;
    const external = actorAppearance(catalog, object, this.client?.combat).baseExternalId;
    // CTank.initTankEquip installs the base sort weight before initBuff;
    // changeTankOutlook replaces components without changing that weight.
    return Number(catalog.appearances[String(external)]?.raw.nSortWeight) || 0;
  }

  drawNpc(object, now) {
      const template = this.mapNpcTemplate(object);
      if (!template) return;
      const field = nativeNpcImageField(object.hp, object.maxHp);
      const resource = template.resources[field] || template.resources.szImageFile;
      const sequence = resourceSequence(this.store, resource);
      const position = {x: object.x, y: object.y};
      this.drawBuffs(object, position, 0, 0, now, true, 1, true);
      let drawn = false;
      if (sequence) {
        const sample = timelineSample(sequence.frames.length, now - this.animationStart, sequence.frameMs, true);
        drawn = this.drawSequence(sequence, sample.index, object.x, object.y, 0, 1,
          {autoCenter: /\.swf$/i.test(resource.url)});
      }
      this.mapNpcDiagnostics.set(object.objectId, {templateId: object.templateId,
        displayTemplateId: template.raw.nTemplateId, camp: object.camp,
        field, logical: resource?.logical, drawn, hp: object.hp, maxHp: object.maxHp});
      const gun = resourceSequence(this.store, template.resources[`${field}Gun`] || template.resources.szImageFileGun);
      if (gun) {
        const rotation = radians(object.cannonAngle || 0);
        this.drawSequence(gun, 0, object.x, object.y, rotation);
        const fire = this.prepared.map.turretFireEffect, lastFire = this.effects.lastFire.get(object.objectId);
        if (fire && lastFire != null) {
          const frameMs = fire.animation.nominalTickMs * fire.animation.ticksPerFrame;
          const sample = timelineSample(fire.frames.length, now - lastFire, frameMs);
          if (!sample.complete) this.drawSequence({asset: fire.source, frames: fire.frames}, sample.index,
            object.x, object.y, rotation);
        }
      }
      this.drawBuffs(object, position, 0, 0, now, false, 1, true);
      if (this.roboActive) this.roboWorld.drawMapNpc(object);
  }

  drawProjectiles(state, now, layer) {
    for (const bullet of Object.values(state.projectiles)) {
      const exhibit = bulletExhibit(this.prepared.catalog, bullet, state);
      if (!exhibit || exhibitLifecycle(exhibit).layer !== layer) continue;
      const sequence = resourceSequence(this.store, exhibit.resources?.szBulletImage, {kind: 'bullet', exhibit});
      const destination = projectileDestination(bullet, this.prepared.catalog.skills[String(bullet.templateId)], this.geometry);
      const position = visualProjectilePosition(bullet, now, destination);
      if (!sequence) {
        this.effects.offlinePve.drawProjectile(this, state, bullet, exhibit, position, now);
        continue;
      }
      const rotation = angle(bullet.startX, bullet.startY, destination.x, destination.y);
      let index;
      if (Number(exhibit.nBulletLoopType) === 2) {
        const caster = state.actors[String(bullet.objectId)] || state.objects[String(bullet.objectId)];
        if (!caster || caster.dead || caster.removed || caster.lifeEpoch !== bullet.casterLifeEpoch) continue;
        if (sequence.derived?.mode !== 'distance-frames') {
          this.store.recordMissing(`link-exhibit:${exhibit.nBulletId}`, 'distance_descriptor_required'); continue;
        }
        const from = visualPosition(caster, now), distance = Math.hypot(position.x - from.x, position.y - from.y);
        const key = `bullet:${bullet.bulletId}:${bullet.startedAt}`;
        index = distanceFrame(sequence.frames.length, distance, this.linkFrames.get(key) || 0);
        this.linkFrames.set(key, index);
        const drawn = this.drawSequence(sequence, index, from.x, from.y, nativeLinkRotation(from, position));
        this.recordResourceDraw(key, sequence, index, now, drawn,
          {kind: 'projectile-link', objectId: bullet.bulletId, templateId: bullet.templateId,
            casterId: bullet.objectId, nativeReceivedAt: bullet.startedAt});
        this.linkDiagnostics.push({key, kind: 'bullet', objectId: bullet.bulletId, templateId: bullet.templateId,
          from, to: position, rotation:nativeLinkRotation(from,position),sourceFrame: index + 1, distance, blown: bullet.blownAt != null, drawn});
        continue;
      }
      if (Number(exhibit.nBulletLoopType) === 0 && sequence.frames.length > 1) {
        const total = Math.hypot(destination.x - bullet.startX, destination.y - bullet.startY);
        const travelled = Math.hypot(position.x - bullet.startX, position.y - bullet.startY);
        index = Math.min(sequence.frames.length - 1, Math.floor(total ? travelled / total * (sequence.frames.length - 1) : 0));
      } else index = timelineSample(sequence.frames.length, now - bullet.startedAt, sequence.frameMs, true).index;
      const drawn = this.drawSequence(sequence, index, position.x, position.y, rotation);
      this.recordResourceDraw(`bullet:${bullet.bulletId}:${bullet.startedAt}`, sequence, index, now, drawn,
        {kind: 'projectile', objectId: bullet.bulletId, templateId: bullet.templateId,
          casterId: bullet.objectId, nativeReceivedAt: bullet.startedAt});
    }
  }

  mapNpcTemplate(object) {
    return mapNpcDisplayTemplate(this.prepared?.catalog, this.prepared?.map,
      object, this.client?.combat);
  }

  drawLinkBuffs(state, now) {
    const seen = new Set(), catalog = this.prepared.catalog;
    for (const target of [...Object.values(state.actors), ...Object.values(state.objects)]) {
      if (target.removed) continue;
      for (const buff of Object.values(target.buffs || {})) {
        const row = catalog.buffs[String(buff.templateId)];
        if (Number(row?.nEffectType) !== 61 || seen.has(buff.instanceId)) continue;
        seen.add(buff.instanceId);
        const caster = state.actors[String(buff.casterId)] || state.objects[String(buff.casterId)];
        if (!caster || caster.removed) continue;
        const sequence = resourceSequence(this.store, row.resources?.szBuffSwf);
        if (!sequence) continue;
        if (sequence.derived?.mode !== 'distance-frames') {
          this.store.recordMissing(`link-buff:${buff.templateId}`, 'distance_descriptor_required'); continue;
        }
        const from = visualPosition(caster, now), to = visualPosition(target, now);
        const distance = Math.hypot(to.x - from.x, to.y - from.y), key = `buff:${buff.instanceId}`;
        const index = distanceFrame(sequence.frames.length, distance, this.linkFrames.get(key) || 0, Number(row.nReuseA));
        this.linkFrames.set(key, index);
        const drawn = this.drawSequence(sequence, index, from.x, from.y, angle(from.x, from.y, to.x, to.y));
        this.recordResourceDraw(`link:${key}:${target.lifeEpoch}:${buff.receivedAt}`, sequence, index, now, drawn,
          {kind: 'buff-link', objectId: target.objectId, lifeEpoch: target.lifeEpoch,
            instanceId: buff.instanceId, templateId: buff.templateId, casterId: buff.casterId,
            nativeReceivedAt: buff.receivedAt});
        this.linkDiagnostics.push({key, kind: 'buff', instanceId: buff.instanceId,
          templateId: buff.templateId, casterId: buff.casterId, targetId: target.objectId,
          from, to, distance, sourceFrame: index + 1, drawn});
      }
    }
  }

  soundSpace() {
    if (!this.geometry || !this.client.combat || !this.width) return null;
    const state = this.client.combat;
    const actor = state.actors[String(this.spectator.snapshot().followObjectId)]
      || state.actors[String(state.selfObjectId)];
    if (!actor) return null;
    const width = this.width / this.camera.zoom, height = this.height / this.camera.zoom;
    return {listener: visualPosition(actor, performance.now()),
      left: this.camera.x - width / 2, top: this.camera.y - height / 2, width, height};
  }

  syncEngineSounds(actors, state, now) {
    const active = new Set();
    for (const actor of actors) {
      const {appearance} = actorAppearance(this.prepared.catalog, actor, state);
      const engine = appearance?.engine, sound = engine?.resources?.strReuseB || engine?.resources?.engineSound;
      if (!sound) continue;
      const loopId = `${actor.objectId}:${actor.lifeEpoch}:engine:${engine.componentId}`;
      active.add(loopId);
      this.audio.play(sound, visualPosition(actor, now), {loopId, kind: 'engine'});
    }
    this.audio.keepLoops(active);
  }

  drawOverlays(actors, state, now) {
    if (this.roboActive) {
      this.roboWorld.drawMinimap(actors, state, now);
      return;
    }
    const c = this.context, self = state.actors[String(state.selfObjectId)], input = this.input.snapshot();
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = '600 11px system-ui';
    for (const actor of actors) {
      const position = visualPosition(actor, now), screen = this.screenPoint(position.x, position.y);
      if (screen.x < -90 || screen.x > this.width + 90 || screen.y < -90 || screen.y > this.height + 90) continue;
      const ally = actor.camp === self.camp, color = actor.objectId === self.objectId ? '#86efad' : ally ? '#90caff' : '#ff9e93';
      const width = 48, top = screen.y + 51 * this.camera.zoom;
      if (actorLifeBarVisible(this.prepared.catalog, actor)) {
        c.fillStyle = '#07101cdd'; c.fillRect(screen.x - width / 2 - 1, top - 1, width + 2, 8);
        c.fillStyle = color; c.fillRect(screen.x - width / 2, top, width * clamp(actor.hp / actor.maxHp, 0, 1), 6);
        if (actor.shield > 0) { c.fillStyle = '#e7e6ff'; c.fillRect(screen.x - width / 2, top - 4,
        width * clamp(actor.shield / actor.maxHp, 0, 1), 2); }
      }
      c.lineWidth = 3; c.strokeStyle = '#07101c'; c.fillStyle = color;
      if (actorNameVisible(this.prepared.catalog, actor)) {
        const name = `${actor.objectId === self.objectId ? 'Bạn · ' : ''}${signName(this.prepared.catalog, actor)}`;
        c.strokeText(name, screen.x, top + 17); c.fillText(name, screen.x, top + 17);
      }
      if (actor.objectId === input.targetId) {
        c.strokeStyle = '#ffd176'; c.lineWidth = 1.5; c.beginPath();
        c.ellipse(screen.x, screen.y + 20 * this.camera.zoom, 37 * this.camera.zoom, 18 * this.camera.zoom, 0, 0, Math.PI * 2); c.stroke();
      }
    }
    for (const value of this.effects.floats) {
      const screen = this.screenPoint(value.position.x, value.position.y), age = now - value.startedAt;
      c.globalAlpha = Math.min(1, (900 - age) / 250); c.font = `${value.fury ? '800 20' : '700 16'}px system-ui`;
      c.fillStyle = value.delta > 0 ? '#8ffa97' : '#ffe2bc'; c.strokeStyle = '#352119'; c.lineWidth = 3;
      const text = value.delta > 0 ? `+${value.delta}` : String(value.delta);
      c.strokeText(text, screen.x, screen.y - 48 - age / 22); c.fillText(text, screen.x, screen.y - 48 - age / 22);
    }
    c.globalAlpha = 1; c.font = '600 11px system-ui'; c.textAlign = 'right';
    for (const [index, event] of this.effects.feed.entries()) {
      const killer = state.actors[String(event.killerId)] || state.objects[String(event.killerId)];
      const victim = state.actors[String(event.victimId)] || state.objects[String(event.victimId)];
      const text = `${signName(this.prepared.catalog, killer)}  ›  ${signName(this.prepared.catalog, victim)}`;
      c.fillStyle = '#0b1724dd'; c.fillRect(this.width - 275, 10 + index * 25, 265, 22);
      c.fillStyle = '#e5eaf2'; c.fillText(text, this.width - 20, 21 + index * 25);
    }
    if (self.dead) {
      const respawn = state.respawns[String(self.accountId)];
      const seconds = respawn ? Math.max(0, Math.ceil((respawn.expiresAt - now) / 1000)) : null;
      c.textAlign = 'center'; c.font = '700 23px system-ui'; c.fillStyle = '#eff4fa';
      c.strokeStyle = '#142231'; c.lineWidth = 5;
      const text = seconds == null || !seconds ? 'Đang chờ hồi sinh' : `Hồi sinh sau ${seconds}s`;
      c.strokeText(text, this.width / 2, this.height / 2); c.fillText(text, this.width / 2, this.height / 2);
    }
    this.drawMinimap(actors, self, now);
  }

  drawMinimap(actors, self, now) {
    const c = this.context, size = 112, left = this.width - size - 12, top = this.height - size - 12;
    const image = this.store.image(this.prepared.map.background);
    c.globalAlpha = .9; c.drawImage(image, left, top, size, size); c.globalAlpha = 1;
    c.strokeStyle = '#a9bbc5'; c.lineWidth = 1; c.strokeRect(left, top, size, size);
    const scale = size / this.geometry.width;
    c.strokeStyle = '#e3f9ff'; c.strokeRect(left + (this.camera.x - this.width / this.camera.zoom / 2) * scale,
      top + (this.camera.y - this.height / this.camera.zoom / 2) * scale,
      this.width / this.camera.zoom * scale, this.height / this.camera.zoom * scale);
    for (const actor of actors) {
      const pos = visualPosition(actor, now); c.fillStyle = actor.objectId === self.objectId ? '#80ffb7'
        : actor.camp === self.camp ? '#89caff' : '#ff9386';
      c.beginPath(); c.arc(left + pos.x * scale, top + pos.y * scale, 2.3, 0, Math.PI * 2); c.fill();
    }
  }

  drawHud(state, self, now) {
    if (this.roboActive) {
      const input = this.input.snapshot(), clock = serverTimeAt(state, now);
      const room=this.client.state.play.room,practice=Number(state.mapId)===7&&isPracticeRoom(room);
      const remaining = clock && state.startedAt != null ? Math.max(0,
        ([30,40].includes(Number(state.mapId))?150:Number(this.prepared.map.raw.iTime)) - (Number(clock) / 1000 - state.startedAt)) : null;
      this.roboHud.update({state, catalog: this.prepared.catalog, hudCatalog: this.prepared.roboHudCatalog,
        now, selectedSlot:input.selectedSlot, keyBindings:this.input.inputOptions?.mapping, connected: this.client.state.phase === 'ready', spectator: this.spectator.snapshot(),
        killFeed: this.effects.feed, pingMs: this.client.state.latencyMs,
        practiceMode: practice, remainingSeconds: practice?null:['result','draw'].includes(state.deathRound?.phase)?0:remaining, serverTimeMs:clock, targetScore: practice?null:Number(this.prepared.map.raw.iWinParam),
        mapTitle: pkMapName(state.mapId,room), objectiveText: pkObjectiveText(state.mapId,room),
        message: this.messageAt != null && now - this.messageAt < 2500 ? $('battle-input-message').textContent
          : state.mapNotice && now - state.mapNotice.receivedAt < 8000 ? state.mapNotice.text : '',
        soundEnabled: this.audio.enabled});
      this.roboHud.score.hidden=isWorldBossScene(state);
      $('battle-paused').hidden = input.active || self.dead || !!state.result || !this.client.canControl()
        || !$('robo-settings').hidden || !!document.querySelector('.m85-settings-surface');
      if (state.result && this.resultSeen !== state.result) this.drawResult(state);
      return;
    }
    const input = this.input.snapshot(), controls = nativeControlFlags(self, this.prepared.catalog.buffs, now, this.prepared.catalog.skills);
    const spectator = this.spectator.snapshot();
    const rows = this.teamHud.update(state, this.prepared.catalog, now, spectator,
      this.client.state.phase === 'ready');
    $('battle-team-count').textContent = `${rows.filter(row => !row.dead).length}/${rows.length} đang sống`;
    $('spectate-next').hidden = !self.dead || !!state.result;
    $('spectate-next').disabled = !spectator.canSwitch || this.client.state.phase !== 'ready';
    const watched = state.actors[String(spectator.followObjectId)];
    $('spectate-status').textContent = spectator.mode === 'spectating'
      ? `Đang theo dõi ${signName(this.prepared.catalog, watched)} · Bấm bản đồ hoặc chọn đồng đội để đổi góc nhìn.`
      : spectator.mode === 'death-delay' ? 'Đang chờ chuyển góc nhìn sang đồng đội…'
        : spectator.mode === 'waiting' && self.dead ? 'Chưa có đồng đội còn sống để theo dõi.'
          : 'HP, MP, khiên và hồi Space riêng của từng tank.';
    $('score-blue').textContent = state.scores.camp1 ?? '—'; $('score-red').textContent = state.scores.camp2 ?? '—';
    const clock = serverTimeAt(state, now);
    const remaining = clock && state.startedAt != null ? Math.max(0,
      Number(this.prepared.map.raw.iTime) - (Number(clock) / 1000 - state.startedAt)) : null;
    $('battle-clock').textContent = state.result ? timeText(state.result.battleTime)
      : remaining == null ? '—:—' : timeText(Math.ceil(remaining));
    $('battle-clock').title = 'Thời gian hiển thị theo đồng hồ server; kết quả chỉ mở khi server kết thúc trận.';
    $('battle-tank-name').textContent = signName(this.prepared.catalog, self);
    for (const [field, max, label] of [['hp', 'maxHp', 'HP'], ['mp', 'maxMp', 'MP']]) {
      $(`battle-${field}`).textContent = `${self[field]} / ${self[max]} ${label}`;
      $(`battle-${field}-fill`).style.width = `${clamp(self[field] / Math.max(1, self[max]), 0, 1) * 100}%`;
    }
    const flags = [];
    if (self.shield > 0) flags.push(`Khiên ${self.shield}`);
    if (self.dead) flags.push('Đang chờ hồi sinh');
    else if (controls.movementBlocked) flags.push('Đang bị hạn chế di chuyển');
    if (controls.blockedSlots.length) flags.push('Một số kỹ năng đang bị khóa');
    if (controls.unknownTemplates.length) flags.push('Đang chờ đối chiếu buff');
    $('battle-self-status').textContent = flags.join(' · ');
    for (const [id, slot] of [['skill-e', 1], ['skill-r', 10], ['skill-space', 2]]) {
      const node = $(id), skill = cooldownView(state, self.objectId, slot, now);
      const row = this.prepared.catalog.skills[String(skill?.skillId)];
      const key = slot === 1 ? 'E' : slot === 10 ? 'R' : 'Space';
      const label = `${key} · ${row?.szName || 'Chưa có kỹ năng'}`;
      node.querySelector('.skill-name').textContent = label;
      node.title = row?.szDesc2 || row?.szName || label;
      const availability = this.input.castAvailability(slot, now), ready = availability.ready;
      node.disabled = !ready; node.classList.toggle('ready', ready);
      node.querySelector('.skill-timer').textContent = skill?.remainingMs == null ? '—'
        : availability.cooldownIgnored && ready ? 'Sẵn sàng'
          : skill.remainingMs > 0 ? `${(skill.remainingMs / 1000).toFixed(1)}s` : ready ? 'Sẵn sàng' : '—';
      node.querySelector('.skill-charge').textContent = skill?.count >= 0
        ? `${skill.count} lượt${skill.nextChargeRemainingMs > 0 ? ` · +1 sau ${(skill.nextChargeRemainingMs / 1000).toFixed(1)}s` : ''}` : '';
    }
    const target = state.actors[String(input.targetId)] || state.objects[String(input.targetId)];
    $('battle-target-name').textContent = target ? signName(this.prepared.catalog, target) : 'Trỏ chuột để chọn mục tiêu';
    $('battle-target-hp').textContent = target ? `${target.hp}/${target.maxHp} HP${target.shield ? ` · Khiên ${target.shield}` : ''}`
      : 'Giữ Shift khi dùng kỹ năng hỗ trợ để chọn bản thân.';
    const kda = selfKdaView(state);
    $('battle-kda').textContent = `${kda.kills} tổng diệt · ${kda.deaths} chết · ${kda.assists} hỗ trợ`;
    $('battle-kda').title = 'Tổng diệt gồm Robo theo trạng thái server; bảng kết quả ghi riêng số tank bị hạ.';
    $('battle-paused').hidden = input.active || self.dead || !!state.result || !this.client.canControl();
    const assets = this.store.stats();
    $('battle-asset-status').textContent = `${this.surface.backend} · ${assets.loadedImages} ảnh đã tải`
      + (assets.missing.length ? ` · ${assets.missing.length} tài nguyên hoặc cách hiển thị chưa được hỗ trợ trong bản này.` : '');
    $('battle-asset-status').title = assets.missing.slice(0, 20).map(item => `${item.logical}: ${item.reason}`).join('\n');
    if (state.result && this.resultSeen !== state.result) this.drawResult(state);
  }

  drawResult(state) {
    const first = !this.resultSeen;
    this.resultSeen = state.result; this.input.releaseAll();
    $('battle-result').hidden = true;
    if (first) this.audio.stopAll();
    this.postmatch.show(state);
    this.resultViewport = `${this.width}:${this.height}`;
  }

  playSound(resource, position, options) { return this.audio.play(resource, position, options); }

  snapshot() {
    const percentile = (values, fraction) => {
      if (!values.length) return null;
      const sorted = [...values].sort((a, b) => a - b);
      return Math.round(sorted[Math.floor((sorted.length - 1) * fraction)] * 100) / 100;
    };
    return {backend: this.surface.backend, renderer: this.surface.snapshot(), error: this.error, camera: {...this.camera},
      viewport: {width: this.width, height: this.height}, frames: this.frames,
      frameIntervalMs: {p50: percentile(this.frameTimes, .5), p95: percentile(this.frameTimes, .95), p99: percentile(this.frameTimes, .99)},
      drawMs: {p50: percentile(this.drawTimes, .5), p95: percentile(this.drawTimes, .95), p99: percentile(this.drawTimes, .99)},
      drawCalls: this.surface.drawCalls, textureBytes: this.surface.textureBytes,
      positions: Object.fromEntries(this.positions), input: this.input.snapshot(), assets: this.store.stats(),
      mapNpcs: Object.fromEntries(this.mapNpcDiagnostics),
      effects: this.effects.snapshot(), skillNames: this.skillNames?.snapshot() ?? null, sceneItems: this.sceneItems.snapshot(),
      drawnResources: [...this.drawnResources.values()].map(row => ({...row})),
      audio: this.audio.snapshot(), links: this.linkDiagnostics.map(link => ({...link})),
      shake: this.shake.snapshot(performance.now()),
      pveBoss: this.pveBossHud.snapshot(this.client.combat),
      robo: this.roboActive ? {camera: this.roboCamera.snapshot(), hud: this.roboHud.snapshot(),
        world: this.roboWorld.snapshot()} : null,
      spectator: this.spectator.snapshot(), team: this.teamHud.snapshot(), postmatch: this.postmatch.snapshot()};
  }
}

function clientReady(state) { return state.phase === 'ready' && state.play.phase === 'scene' && state.play.render?.supported; }
