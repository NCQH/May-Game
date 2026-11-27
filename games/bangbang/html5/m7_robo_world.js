import {visualPosition} from './combat_state.js';
import {aiNpcTemplate, actorLifeBarVisible} from './tank_appearance.js';
import {createRoboFloat, sampleRoboFloat} from './m7_robo_floats.js';
import {resourceSequence} from './battle_effects.js';
import {vietnameseNpcName} from './m81331_locale.js';

const UI = 'zh_CN/gui_summer/controls/gameplay/';
const clamp = (number, min, max) => Math.max(min, Math.min(max, number));

/** Original Robo presentation drawn at its native world coordinates.
 * Health, life epochs, visibility and identities are read from native packets.
 * Actor labels are submitted within the actor layer, before foreground props.
 */
export class RoboWorld {
  constructor(view) {
    this.view = view; this.catalog = null;
    this.textures = new Map(); this.selfLife = null; this.selfStartedAt = 0;
    this.floats = []; this.floatMutex = ''; this.floatMutexAt = 0; this.floatHistory = [];
    this.drawn = {airMarker: false, selfMarker: false, spawnArrow: false, minimap: false};
  }

  setCatalog(catalog) { this.catalog = catalog; }

  clear() {
    for (const image of this.textures.values()) this.view.surface.releaseTexture(image);
    this.textures.clear(); this.selfLife = null; this.selfStartedAt = 0;
    this.floats = []; this.floatMutex = ''; this.floatMutexAt = 0; this.floatHistory = [];
    this.drawn = {airMarker: false, selfMarker: false, spawnArrow: false, minimap: false};
  }

  asset(logical) { return this.catalog?.assets?.[logical] || null; }

  image(asset) {
    if (!asset) return null;
    const image = this.view.store.image(asset);
    if (!image) this.view.store.requestImage(asset);
    return image;
  }

  drawImage(asset, x, y, {center = false, alpha = 1} = {}) {
    if (!asset) return false;
    return this.view.drawFrame(asset, {sx: 0, sy: 0, w: asset.width, h: asset.height,
      offsetX: center ? -asset.width / 2 : 0, offsetY: center ? -asset.height / 2 : 0}, x, y, 0, alpha);
  }

  drawCanvas(image, x, y) {
    const pos = this.view.screenPoint(x + image.width / 2, y + image.height / 2);
    const zoom = this.view.camera.zoom;
    this.view.surface.draw(image, {sw: image.width, sh: image.height,
      x: pos.x, y: pos.y, width: image.width * zoom, height: image.height * zoom});
  }

  effect(name, now, start = this.view.animationStart, {loop = true} = {}) {
    const sequence = this.catalog?.effects?.[name];
    if (!sequence?.frames?.length) return null;
    const index = Math.floor(Math.max(0, now - start) / sequence.frameMs);
    if (!loop && index >= sequence.frames.length) return null;
    return {sequence, index: loop ? index % sequence.frames.length : index};
  }

  drawAirMarker() {
    const map = this.catalog?.maps?.[String(this.view.prepared?.map?.mapId)];
    this.drawn.airMarker = false;
    for (const point of map?.airPoints || []) {
      this.drawn.airMarker = this.drawImage(map.airMarker, point.x, point.y, {center: true}) || this.drawn.airMarker;
    }
  }

  grid(maxHp) {
    const key = `life-grid:${maxHp}`;
    if (!this.textures.has(key)) {
      const image = document.createElement('canvas'); image.width = 72; image.height = 14;
      const c = image.getContext('2d');
      // LifeBar.setMaxHp: Vietnamese GRID_HP=500, width72, at most15 divisions.
      const count = Math.round(maxHp / 500), step = 70 * 500 / maxHp;
      if (count > 0 && count <= 15 && step > 1) {
        c.strokeStyle = '#000'; c.lineWidth = 1;
        for (let position = step; position < 70; position += step) {
          const x = Math.round(position); c.beginPath();
          c.moveTo(x + .5, 2); c.lineTo(x + .5, 8); c.stroke();
        }
      }
      this.textures.set(key, image);
    }
    return this.textures.get(key);
  }

  nameTexture(actor, state, ai) {
    const self = actor.objectId === state.selfObjectId;
    const ownCamp = state.actors[String(state.selfObjectId)]?.camp;
    const color = self ? '#48dd3b' : actor.camp === 0 ? '#ffff00'
      : actor.camp === ownCamp ? '#28baee' : '#ff0000';
    const text = vietnameseNpcName(actor,ai);
    if (!text) return null;
    // ResModel.getSmallVipLevelImage uses VipData.SUPER_VIP_OFFSET=100.
    const vipLevel = Number(actor.vipLevel) || 0, offset = this.catalog?.vip?.superOffset || 100;
    const vip = !ai && vipLevel > 0
      ? this.catalog?.vip?.[vipLevel >= offset ? 'super' : 'normal']?.[String(vipLevel % offset)] : null;
    const vipImage = this.image(vip);
    const key = `name:${text}:${color}:${vipImage ? vip.sha256 : ''}`;
    if (!this.textures.has(key)) {
      const image = document.createElement('canvas'), c = image.getContext('2d');
      c.font = 'bold 16px Tahoma, Arial, sans-serif';
      const textWidth = c.measureText(text).width;
      image.width = Math.ceil(textWidth + (vipImage ? vip.width + 2 : 0) + 6); image.height = 30;
      c.font = 'bold 16px Tahoma, Arial, sans-serif'; c.textBaseline = 'top';
      c.strokeStyle = '#000'; c.lineWidth = 2; c.lineJoin = 'round'; c.fillStyle = color;
      c.strokeText(text, 2, 2); c.fillText(text, 2, 2);
      if (vipImage) c.drawImage(vipImage, Math.trunc(textWidth) + 4, 7);
      image.nativeOffsetX = -Math.trunc((textWidth + (vipImage ? vip.width : 0)) / 2) - 2;
      this.textures.set(key, image);
    }
    return this.textures.get(key);
  }

  drawActor(actor, state, now) {
    if (actor.dead || actor.removed) return;
    const view = this.view, ai = aiNpcTemplate(view.prepared.catalog, actor);
    const shadow = Number(ai?.nType) === 4;
    const isNpc = !!ai && !shadow;
    const self = actor.objectId === state.selfObjectId;
    const ownCamp = state.actors[String(state.selfObjectId)]?.camp;
    const position = visualPosition(actor, now);
    const x = position.x + (isNpc ? -36 : -22), y = position.y + 63;
    if (actorLifeBarVisible(view.prepared.catalog, actor) && actor.maxHp > 0) {
      const color = self ? 'green' : actor.camp === 0 ? 'yellow' : actor.camp === ownCamp ? 'blue' : 'red';
      const sequence = this.catalog?.effects?.[`life_${color}`];
      // MathScriptTemplate301 (last ordinal) defines VAL1=25 for the current client.
      if (!isNpc && Math.trunc(actor.hp * 100 / actor.maxHp) <= 25) {
        const warn = this.effect('life_warn', now);
        if (warn) view.drawSequence(warn.sequence, warn.index, x, y);
      }
      if (sequence) {
        const nativeFrame = Math.trunc(actor.hp * 70 / actor.maxHp);
        const index = clamp(nativeFrame - 1, 0, sequence.frames.length - 1);
        view.drawSequence(sequence, index, x, y);
        this.drawCanvas(this.grid(actor.maxHp), x, y);
      }
    }
    if (!isNpc && actor.maxMp > 0) {
      this.drawImage(this.asset(`${UI}img_mp_bg.png`), position.x - 22, position.y + 76);
      const progress = this.asset(`${UI}img_mp_bar.png`);
      if (progress) {
        const width = Math.max(0, Math.trunc(progress.width * clamp(actor.mp / actor.maxMp, 0, 1)));
        if (width) view.drawFrame(progress, {sx: 0, sy: 0, w: width, h: progress.height,
          offsetX: 0, offsetY: 0}, position.x - 20, position.y + 78);
      }
    }
    if (!ai || Number(ai.isShowName) === 1) {
      const name = this.nameTexture(actor, state, ai);
      if (name) this.drawCanvas(name, position.x + name.nativeOffsetX,
        position.y + (!isNpc && actor.maxMp > 0 ? 82 : 72));
    }
    if (self) {
      const life = `${actor.objectId}:${actor.lifeEpoch}`;
      if (this.selfLife !== life) { this.selfLife = life; this.selfStartedAt = actor.lastSnapshotAt ?? now; }
      const spawn = this.effect('self_tank_arrow', now, this.selfStartedAt, {loop: false});
      this.drawn.spawnArrow = spawn
        ? view.drawSequence(spawn.sequence, spawn.index, position.x, position.y, 0, 1, {autoCenter: true}) : false;
    }
  }

  drawSelfMarker(state, now) {
    const actor = state.actors[String(state.selfObjectId)];
    this.drawn.selfMarker = false;
    if (!actor || actor.dead || actor.removed) return;
    const position = visualPosition(actor, now);
    const effect = this.effect('self_mark', now, this.selfStartedAt);
    if (effect) this.drawn.selfMarker = this.view.drawSequence(effect.sequence, effect.index,
      Math.trunc(position.x - 46), position.y - 75);
  }

  drawMapNpc(object) {
    if (object.dead || object.removed || !(object.maxHp > 0)) return;
    const view = this.view, template = view.mapNpcTemplate(object)?.raw;
    const cannon = Number(template?.iType) === 4;
    if (!cannon && Number(template?.iCopItType) !== 1) return;
    const self = view.client.combat.actors[String(view.client.combat.selfObjectId)];
    const color = object.camp === 0 ? 'yellow' : object.camp === self.camp ? 'blue' : 'red';
    const sequence = this.catalog?.effects?.[`life_${color}`];
    if (!sequence) return;
    const x = object.x - 36, y = object.y + Math.trunc(Number(template.iImgHeight) / 2) - (cannon ? 30 : 16);
    view.drawSequence(sequence, clamp(Math.trunc(object.hp * 70 / object.maxHp) - 1, 0, sequence.frames.length - 1), x, y);
    this.drawCanvas(this.grid(object.maxHp), x, y);
  }

  consume(events) {
    const camera = this.view.roboCamera.snapshot();
    for (const event of events) {
      if (event.kind !== 'hpChange' || !event.position || !Number.isFinite(event.packet?.delta)) continue;
      const {x, y} = event.position;
      // Native ScrollTool.isInScroll tests a 36px margin at event creation.
      if (x < camera.beginX - 36 || x >= camera.beginX + camera.viewWidth + 36
          || y < camera.beginY - 36 || y >= camera.beginY + camera.viewHeight + 36) continue;
      const now = event.receivedAt, key = `${Math.trunc(x)},${Math.trunc(y)}`;
      // EffectLayer.bubbleNum owns one shared 84ms window, not a sliding
      // expiry per point. Keep its native string membership semantics.
      if (now - this.floatMutexAt > 84) { this.floatMutex = ''; this.floatMutexAt = now; }
      const duplicate = this.floatMutex.indexOf(key) !== -1;
      const record = createRoboFloat(event, now, {duplicate});
      if (!duplicate) this.floatMutex += `${key}$`;
      this.floats.push(record);
      this.floatHistory.push({nativeReceivedAt: now, delta: event.packet.delta, type: record.type,
        objectId: event.packet.objectId ?? null, glyphs: record.glyphs.map(glyph => glyph.logical)});
      if (this.floatHistory.length > 48) this.floatHistory.shift();
    }
  }

  drawFloats(now) {
    this.floats = this.floats.filter(record => !sampleRoboFloat(record, now).expired);
    for (const record of this.floats) {
      const sample = sampleRoboFloat(record, now);
      if (!sample.visible) continue;
      for (const glyph of sample.glyphs) {
        const asset = this.asset(glyph.logical);
        if (asset) this.view.drawFrame(asset, {sx: glyph.sx, sy: glyph.sy, w: glyph.sw, h: glyph.sh,
          offsetX: glyph.offsetX, offsetY: glyph.offsetY}, sample.x, sample.y, 0, sample.alpha);
      }
    }
  }

  drawMinimap(actors, state, now) {
    const view = this.view, surface = view.surface, self = state.actors[String(state.selfObjectId)];
    const map = this.catalog?.maps?.[String(state.mapId)], background = this.image(map?.minimap);
    if (!background || !self) return;
    const left = 0, top = view.height - 211, size = 200;
    const screenImage = (image, x, y, width = image.width, height = image.height) =>
      surface.draw(image, {sw: image.width, sh: image.height, x: x + width / 2,
        y: y + height / 2, width, height});
    screenImage(background, left, top, size, size);
    const sx = size / view.geometry.width, sy = size / view.geometry.height;
    const camera = view.roboCamera.snapshot();
    const frameWidth = Math.trunc(camera.viewWidth * sx), frameHeight = Math.trunc(camera.viewHeight * sy);
    const frameKey = `minimap-camera:${frameWidth}:${frameHeight}`;
    if (!this.textures.has(frameKey)) {
      // The native vector outline is rasterized only when viewport size changes.
      // Its per-frame movement and all map/icons use the main render backend.
      const frame = document.createElement('canvas'); frame.width = frameWidth + 8; frame.height = frameHeight + 8;
      const context = frame.getContext('2d');
      context.strokeStyle = '#ccff00'; context.lineWidth = 1;
      context.shadowColor = '#160000cc'; context.shadowBlur = 2;
      context.strokeRect(3.5, 3.5, frameWidth, frameHeight);
      this.textures.set(frameKey, frame);
    }
    screenImage(this.textures.get(frameKey), left + camera.beginX * sx - 3, top + camera.beginY * sy - 3);
    const draw = (asset, x, y) => {
      const image = this.image(asset);
      if (image) screenImage(image, left + x * sx - asset.width / 2, top + y * sy - asset.height / 2,
        asset.width, asset.height);
    };
    const modeResources=view.prepared.catalog.modePresentation?.resources||{};
    for(const definition of view.prepared.map.flags||[]) {
      const flag=state.flags?.[String(definition.index)]||definition;
      const color=!flag.camp?'null':flag.camp===self.camp?'blue':'red';
      draw(modeResources['small_flag_'+color],...definition.position);
      if(flag.locked)draw(modeResources.small_flag_lock,...definition.position);
    }
    for (const object of Object.values(state.objects)) {
      if (object.dead || object.removed || (object.maxHp > 0 && object.hp <= 0)) continue;
      if ((object.objectId >>> 26) === 3 && Number(view.mapNpcTemplate(object)?.raw.iType) === 4) {
        const color = object.camp === self.camp ? 'blue' : 'red';
        draw(this.asset(`${UI}cannon_${color}.png`), object.x, object.y);
      }
      if ((object.objectId >>> 26) === 3 && Number(view.mapNpcTemplate(object)?.raw.iType) === 3) {
        const sequence=resourceSequence(view.store,modeResources['small_base_'+(object.camp===self.camp?'blue':'red')]);
        if(sequence){
          const index=Math.max(0,Math.min(sequence.frames.length-1,Math.trunc(100*object.hp/object.maxHp)-1));
          const frame=sequence.frames[index],asset=frame.asset||(frame.assetIndex!=null?sequence.assets?.[frame.assetIndex]:null)||sequence.asset;
          const image=this.image(asset);
          if(image)surface.draw(image,{sx:frame.sx,sy:frame.sy,sw:frame.w,sh:frame.h,
            x:left+object.x*sx,y:top+object.y*sy,width:frame.w,height:frame.h});
        }
      }
    }
    for (const actor of actors) {
      if (actor.dead || actor.removed) continue;
      const position = visualPosition(actor, now), ai = aiNpcTemplate(view.prepared.catalog, actor);
      if (ai) {
        if (Number(ai.iLifeShowType) === 1 || actor.maxHp === -1) continue;
        const color = actor.camp === 0 ? 'yellow' : actor.camp === self.camp ? 'blue' : 'red';
        draw(this.asset(`zh_CN/computer_${color}.png`), position.x, position.y);
      } else {
        const color = actor.objectId === self.objectId ? 'green' : actor.camp === self.camp ? 'blue' : 'red';
        draw(this.asset(`${UI}img_micro_${color}_bg.png`), position.x, position.y);
        draw(view.prepared.catalog.tanks?.[String(actor.tankId)]?.hudIcon, position.x, position.y);
      }
    }
    this.drawn.minimap = true; this.drawn.minimapBackend = surface.backend;
  }

  snapshot() { return {...this.drawn, labelTextures: this.textures.size, activeFloats: this.floats.length,
    nativeFloatHistory: this.floatHistory.map(row => ({...row}))}; }
}
