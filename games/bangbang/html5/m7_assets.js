import {M6Assets} from './m6_assets.js';
import {isBattleMap as isPKMap} from './m810_modes.js';
import {loadPveCatalog} from './m81314_assets.js';
import {loadM81319Tanks,mergeM81319Hud} from './m81319_tanks.js';
import {hydrateM6Catalog} from './m6_assets.js';
import {loadPvePresentation,mergePveHud} from './m81314_presentation.js';
import {isPveMap} from './m81314_protocol.js';
import {loadM81328Icons,mergeM81328Hud} from './m81328_icons.js';
import {loadWorldBossCatalog,mergeWorldBossHud} from './m81330_assets.js';
import {isWorldBossScene} from './m81330_protocol.js';
import {loadM81331Locale,mergeM81331HudLocale} from './m81331_locale.js';
import {loadM81333LacSkin,mergeM81333LacHud} from './m81333_lac_skin.js';
import {loadM81334Skins,mergeM81334Hud} from './m81334_skins.js';
import {loadM81335Skins,mergeM81335Hud} from './m81335_skins.js';
import {loadM81338LevelLooks,mergeM81338LevelLooksHud,m81338VisualExternal} from './m81338_level_looks.js';

const LEGACY_HIT_LOGICAL = 'zh_CN/sound/tank/hitbody.mp3';
const NATIVE_HIT_LOGICAL = 'zh_CN/sound/death/hitbody.mp3';

// M7 adds original Flash presentation dependencies for Robo only. M6's
// source catalog, native server, map geometry and gameplay remain unchanged.
export class M7Assets extends M6Assets {
  constructor(options = {}) {
    super(options);
    this.roboCatalog = null; this.roboCatalogTask = null;
    this.roboCatalogSha256 = null; this.roboCatalogBytes = 0;
    this.roboActive = false;
    this.roboLazyPages = new Set(); this.roboCssUrls = new Map(); this.roboPageUsedAt = new Map();
    this.roboHudFramePages = null;
    this.roboExtensionTask = null; this.roboExtensionHashes = {};
    this.roboNativeHitSound = null;
    this.pveBossCatalogTask = null;
  }

  source(resource) {
    const source = super.source(resource);
    const logical = typeof source === 'string' ? source : source?.logical ?? source?.assetRef;
    if (this.roboActive && this.roboNativeHitSound && logical === LEGACY_HIT_LOGICAL)
      return this.roboNativeHitSound.asset;
    return source;
  }

  async prepareNativeHitSound(binding, generation = this.sceneGeneration) {
    if (generation !== this.sceneGeneration) throw new Error('Âm thanh thuộc trận trước đã đóng.');
    this.roboNativeHitSound = null;
    const asset = {...binding?.asset};
    if (binding?.replacesLogical !== LEGACY_HIT_LOGICAL || asset.logical !== NATIVE_HIT_LOGICAL
        || asset.url !== `/rez/${NATIVE_HIT_LOGICAL}` || asset.exists !== true
        || !/^[a-f0-9]{64}$/.test(asset.sha256 || '') || !(asset.bytes > 0))
      throw new Error('Đường dẫn âm trúng đạn chưa khớp source gốc.');
    try {
      if (typeof this.decodeAudio !== 'function')
        throw new DOMException('Chưa có bộ giải mã âm thanh.', 'EncodingError');
      // The inherited catalog remains immutable. Only publish this binding
      // after the native /sound/death/ bytes pass SHA verification and decode.
      // An older URL-only audio cache is not proof of this descriptor's hash.
      const previous = this.audio.get(asset.url);
      if (previous) {
        const bytes = previous.numberOfChannels ? previous.length * previous.numberOfChannels * 4
          : previous.byteLength || 0;
        this.audioBytes = Math.max(0, this.audioBytes - bytes);
        this.audio.delete(asset.url);
      }
      const encoded = await this.binary(asset);
      if (generation !== this.sceneGeneration) throw new Error('Âm thanh thuộc trận trước đã đóng.');
      if (encoded.byteLength !== asset.bytes) throw new Error('Kích thước âm trúng đạn không khớp source.');
      const buffer = await this.decodeAudio(encoded);
      if (generation !== this.sceneGeneration) throw new Error('Âm thanh thuộc trận trước đã đóng.');
      if (!buffer || typeof buffer.getChannelData !== 'function' || !(buffer.numberOfChannels > 0)
          || !(buffer.length > 0) || !(buffer.duration > 0))
        throw new DOMException('Âm trúng đạn chưa giải mã thành AudioBuffer.', 'EncodingError');
      this.audio.set(asset.url, buffer);
      this.audioBytes += buffer.length * buffer.numberOfChannels * 4;
      this.roboNativeHitSound = Object.freeze({replacesLogical: LEGACY_HIT_LOGICAL,
        asset: Object.freeze(asset)});
      this.activeLogical.add(asset.logical);
      this.missing.delete(LEGACY_HIT_LOGICAL);
      this.missing.delete(asset.logical);
      return this.roboNativeHitSound;
    } catch (error) {
      if (generation === this.sceneGeneration && error.name !== 'AbortError') this.recordMissing(asset,
        this.missing.get(asset.logical)?.reason || (error.name === 'EncodingError'
          ? 'audio_decode_failed' : 'audio_load_failed'));
      throw error;
    }
  }

  async loadRoboExtensions() {
    if (!this.roboExtensionTask) this.roboExtensionTask = (async () => {
      const files = ['m71_kill_banner_catalog.json', 'm71_skill_name_catalog.json',
        'm72_status_catalog.json', 'm72_buff_texts.json'];
      const values = await Promise.all(files.map(async file => {
        const response = await fetch(`./${file}`, {cache: 'no-store'});
        if (!response.ok) throw new Error('Không tải được phần hiển thị bổ sung cho Robo.');
        const bytes = await response.arrayBuffer();
        this.roboExtensionHashes[file] = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
          .map(value => value.toString(16).padStart(2, '0')).join('');
        return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
      }));
      return {killBannerCatalog: values[0], skillNameCatalog: values[1],
        statusCatalog: values[2], buffTextCatalog: values[3]};
    })().catch(error => { this.roboExtensionTask = null; throw error; });
    return this.roboExtensionTask;
  }

  async loadRoboCatalog() {
    if (!this.roboCatalogTask) this.roboCatalogTask = (async () => {
      const response = await fetch('./m7_robo_ui_catalog.json', {cache: 'no-store'});
      if (!response.ok) throw new Error('Không tải được tài nguyên giao diện Robo.');
      const bytes = await response.arrayBuffer();
      this.roboCatalogSha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
        .map(value => value.toString(16).padStart(2, '0')).join('');
      this.roboCatalogBytes = bytes.byteLength;
      this.roboCatalog = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
      const extra=await loadPveCatalog();
      const presentation=await loadPvePresentation(extra.sha256);
      mergePveHud(this.roboCatalog,hydrateM6Catalog(extra.catalog),presentation.catalog);
      const tanks=await loadM81319Tanks();
      mergeM81319Hud(this.roboCatalog,hydrateM6Catalog(tanks.catalog),extra.catalog.source.m6CatalogSha256);
      const icons=await loadM81328Icons();
      mergeM81328Hud(this.roboCatalog,icons.catalog,extra.catalog.source.m6CatalogSha256);
      const boss=await loadWorldBossCatalog();
      mergeWorldBossHud(this.roboCatalog,hydrateM6Catalog(boss.catalog),extra.catalog.source.m6CatalogSha256);
      mergeM81331HudLocale(this.roboCatalog,await loadM81331Locale());
      const lac=await loadM81333LacSkin();
      await mergeM81333LacHud(this.roboCatalog,hydrateM6Catalog(lac.catalog),{
        'm7_robo_ui_catalog.json':this.roboCatalogSha256,'m81314_assets_catalog.json':extra.sha256,'m81319_tanks_catalog.json':tanks.sha256});
      const skins34=await loadM81334Skins();
      await mergeM81334Hud(this.roboCatalog,hydrateM6Catalog(skins34.catalog),{
        'm7_robo_ui_catalog.json':this.roboCatalogSha256,'m81314_assets_catalog.json':extra.sha256,
        'm81319_tanks_catalog.json':tanks.sha256,'m81333_lac_skin_catalog.json':lac.sha256});
      const skins35=await loadM81335Skins();
      await mergeM81335Hud(this.roboCatalog,hydrateM6Catalog(skins35.catalog),{
        'm7_robo_ui_catalog.json':this.roboCatalogSha256,'m81314_assets_catalog.json':extra.sha256,
        'm81319_tanks_catalog.json':tanks.sha256,'m81333_lac_skin_catalog.json':lac.sha256,
        'm81334_skins_catalog.json':skins34.sha256});
      const levelLooks=await loadM81338LevelLooks();
      await mergeM81338LevelLooksHud(this.roboCatalog,levelLooks.catalog,{
        'm7_robo_ui_catalog.json':this.roboCatalogSha256,'m81319_tanks_catalog.json':tanks.sha256,
        'm81335_skins_catalog.json':skins35.sha256});
      const inspect = value => {
        if (!value || typeof value !== 'object') return;
        if (value.lazyPages) for (const page of value.pages || []) this.roboLazyPages.add(page.url);
        for (const [key, child] of Object.entries(value)) if (key !== 'frames' && child && typeof child === 'object') inspect(child);
      };
      inspect(this.roboCatalog.effects);
      return this.roboCatalog;
    })().catch(error => { this.roboCatalogTask = null; throw error; });
    return this.roboCatalogTask;
  }

  async loadRoboImages(value, {pin = false} = {}) {
    const images = new Map(), seen = new WeakSet();
    const visit = item => {
      if (!item || typeof item !== 'object' || seen.has(item)) return;
      seen.add(item);
      if (typeof item.url === 'string' && /\.(png|jpe?g|webp)$/i.test(item.url)
          && /^[a-f0-9]{64}$/i.test(item.sha256 || '')) images.set(item.url, item);
      if (item.lazyPages) {
        // A 5040-frame native portrait is paged. Only warm its first page;
        // the HUD requests the current and next page at their actual phase.
        visit(item.pages?.[0] || item.asset);
        return;
      }
      for (const [key, child] of Object.entries(item)) {
        if (key !== 'frames' && child && typeof child === 'object') visit(child);
      }
    };
    visit(value);
    const queue = [...images.values()];
    await Promise.all(Array.from({length: Math.min(4, queue.length)}, async () => {
      while (queue.length) {
        const asset = queue.shift();
        if (pin && !this.roboLazyPages.has(asset.url)) this.pinnedUrls.add(asset.url);
        await this.loadImage(asset);
      }
    }));
  }

  async loadImage(asset) {
    if (!this.roboLazyPages?.has(asset?.url)) return super.loadImage(asset);
    const old = this.imageMeta.get(asset.url);
    if (old && old.sha256 !== asset.sha256) this.evictImage(asset.url);
    if (this.images.has(asset.url)) return this.images.get(asset.url);
    if (this.imageTasks.has(asset.url)) return this.imageTasks.get(asset.url);
    const generation = this.sceneGeneration;
    const task = (async () => {
      this.pending += 1;
      const data = await this.binary(asset);
      if (generation !== this.sceneGeneration) throw new Error('Chân dung thuộc trận trước đã đóng.');
      const reservation = Number(asset.width) * Number(asset.height) * 4;
      if (!(reservation > 0) || !this.makeRoom(reservation)) throw new Error('Chưa đủ bộ nhớ trang chân dung; sẽ thử lại.');
      this.reservedDecodedBytes += reservation;
      let reserved = true;
      let url = null;
      try {
        url = URL.createObjectURL(new Blob([data], {type: 'image/png'}));
        const image = new Image(); image.decoding = 'async';
        await new Promise((resolve, reject) => {
          image.onload = resolve; image.onerror = () => reject(new Error(`Không giải mã được ${asset.logical || asset.url}.`));
          image.src = url;
        });
        await image.decode();
        if (generation !== this.sceneGeneration) throw new Error('Chân dung thuộc trận trước đã đóng.');
        const decoded = image.naturalWidth * image.naturalHeight * 4;
        this.reservedDecodedBytes = Math.max(0, this.reservedDecodedBytes - reservation);
        reserved = false;
        if (!this.makeRoom(decoded)) throw new Error('Chưa đủ bộ nhớ trang chân dung; sẽ thử lại.');
        this.images.set(asset.url, image); this.roboCssUrls.set(asset.url, url);
        this.imageMeta.set(asset.url, {sha256: asset.sha256, decodedBytes: decoded, bytes: data.byteLength,
          lastFrame: this.frameIndex, loadedAt: performance.now()});
        this.roboPageUsedAt.set(asset.url, performance.now());
        this.decodedBytes += decoded; this.bytesLoaded += data.byteLength;
        this.peakDecodedBytes = Math.max(this.peakDecodedBytes, this.decodedBytes);
        this.missing.delete(asset.logical || asset.url);
        // Retain this verified blob URL for CSS as well. Both consumers use
        // the identical decoded resource; no second unverified URL fetch.
        return image;
      } catch (error) {
        if (url) URL.revokeObjectURL(url);
        throw error;
      } finally {
        if (reserved && generation === this.sceneGeneration) this.reservedDecodedBytes = Math.max(0,
          this.reservedDecodedBytes - reservation);
      }
    })();
    this.imageTasks.set(asset.url, task);
    try { return await task; }
    catch (error) {
      if (generation === this.sceneGeneration && error.name !== 'AbortError') this.recordMissing(asset, error.message);
      throw error;
    } finally {
      if (generation === this.sceneGeneration) this.pending = Math.max(0, this.pending - 1);
      if (this.imageTasks.get(asset.url) === task) this.imageTasks.delete(asset.url);
    }
  }

  resolveRoboFrameAsset(asset) {
    if (!asset?.url) return false;
    if (!this.roboLazyPages.has(asset.url)) return true;
    this.roboHudFramePages?.add(asset.url);
    const old = this.imageMeta.get(asset.url);
    if (old && old.sha256 !== asset.sha256) this.evictImage(asset.url);
    const now = performance.now();
    this.roboPageUsedAt.set(asset.url, now);
    const image = this.image(asset);
    if (!image) this.requestImage(asset);
    // Multiple HUD instances can show the same portrait at different phases.
    // Retain their actual current/prefetch pages, not an arbitrary global two.
    if (!this.roboHudFramePages)
      for (const [url, usedAt] of this.roboPageUsedAt) if (now - usedAt > 1500) this.evictImage(url);
    return image ? this.roboCssUrls.get(asset.url) || false : false;
  }

  beginRoboHudFrame() { this.roboHudFramePages = new Set(); }

  endRoboHudFrame() {
    const pages = this.roboHudFramePages; this.roboHudFramePages = null;
    if (!pages) return;
    // All HUD instances have now named their actual current and next page.
    // Revoke pages no instance uses after its DOM has moved to the new page.
    for (const url of this.roboCssUrls.keys()) if (!pages.has(url)) this.evictImage(url);
  }

  evictImage(url) {
    const blob = this.roboCssUrls?.get(url);
    if (blob) URL.revokeObjectURL(blob);
    this.roboCssUrls?.delete(url); this.roboPageUsedAt?.delete(url);
    super.evictImage(url);
  }

  async prepareScene(scene, accountId) {
    this.roboActive = false;
    const prepared = await super.prepareScene(scene, accountId);
    if (!prepared.supported || !isPKMap(scene.mapId)) return prepared;
    const generation = this.sceneGeneration;
    const [catalog, extensions] = await Promise.all([this.loadRoboCatalog(), this.loadRoboExtensions()]);
    const maps = {...catalog.maps,...prepared.catalog.pkPresentation?.maps,...prepared.catalog.modePresentation?.maps,
      ...prepared.catalog.pvePresentation?.maps,...prepared.catalog.worldBossPresentation?.maps};
    const map = maps[String(scene.mapId)];
    if (!map?.minimap) throw new Error('Thiếu minimap gốc của bản đồ PK.');
    const roster = new Set((scene.characters || []).map(character => character.tankId));
    const nameResources = Object.values(extensions.skillNameCatalog.skills || {})
      .filter(binding => binding.tankIds?.some(id => roster.has(id)))
      .map(binding => extensions.skillNameCatalog.resources[binding.logical]);
    const portraits = (scene.characters || []).map(character => catalog.portraits?.[String(m81338VisualExternal(character,character.externalId))])
      .filter(Boolean);
    await this.loadRoboImages({bitmaps: catalog.bitmaps, namedBitmaps: catalog.namedBitmaps,
      effects: Object.fromEntries(Object.entries(catalog.effects || {}).filter(([name]) => !name.startsWith('zh_CN/avatar/'))),
      map, portraits, resources: catalog.resources, supplementIcons:catalog.pveSupplementIcons,
      tanksSupplementIcons:catalog.m81319SupplementIcons,
      auditedNativeIcons:catalog.m81328SupplementIcons,
      worldBossIcons:catalog.m81330SupplementIcons,
      microHeads: (scene.characters || []).map(character =>
        prepared.catalog.tanks?.[String(character.tankId)]?.hudIcon).filter(Boolean)}, {pin: true});
    await this.loadRoboImages({banner: extensions.killBannerCatalog.bitmaps, nameResources,
      speedTrail: extensions.statusCatalog.speedTrail}, {pin: true});
    await this.prepareNativeHitSound(extensions.statusCatalog.nativeHitSound, generation);
    let pveBossCatalog = null;
    if (Number(scene.roomType) === 4 && isPveMap(scene.mapId) || isWorldBossScene(scene)) {
      if (!this.pveBossCatalogTask) this.pveBossCatalogTask = (async () => {
        const response = await fetch('./m81315_pve_hud_catalog.json', {cache: 'no-store'});
        if (!response.ok) throw new Error('Không tải được thanh HP boss PvE gốc.');
        const value = await response.json();
        if (value.schemaVersion !== 1 || value.scope !== 'native-solo-pve-boss-hud'
          || value.bossBar?.frames?.length !== 100 || value.bossBar.width !== 458
          || value.bossBar.height !== 33 || value.source?.swf?.sha256 !==
            'c01969c0c558bba3f9d1794e0ab1243ae493fe26dc027423fb4b0ec99917aafd')
          throw new Error('Thanh HP boss PvE không khớp nguồn đã kiểm.');
        return value;
      })().catch(error => { this.pveBossCatalogTask = null; throw error; });
      pveBossCatalog = await this.pveBossCatalogTask;
      if (generation !== this.sceneGeneration) throw new Error('Giao diện thuộc trận trước đã đóng.');
      await this.loadRoboImages(pveBossCatalog.bossBar, {pin: true});
    }
    if (generation !== this.sceneGeneration) throw new Error('Giao diện thuộc trận trước đã đóng.');
    this.roboActive = true;
    const graphicsWarmUrls = pveBossCatalog
      ? [...new Set([...(prepared.graphicsWarmUrls || []), ...pveBossCatalog.bossBar.assets.map(asset => asset.url)])]
      : prepared.graphicsWarmUrls;
    return {...prepared, graphicsWarmUrls, roboHudCatalog: {...catalog, maps, localizedText: {
      ...catalog.localizedText, ...extensions.buffTextCatalog.localizedText}}, pveBossCatalog, ...extensions};
  }

  preparePacket(packet) {
    const nativeTask = super.preparePacket(packet);
    if (!this.roboActive || !this.roboCatalog) return nativeTask;
    const ids = new Set();
    if (['skillChanged', 'skillCooldown'].includes(packet.type)) ids.add(packet.skill?.skillId);
    if (packet.type === 'sceneSelf') for (const skill of packet.skills || []) ids.add(skill.skillId);
    const icons = [...ids].map(id => this.roboCatalog.skills?.[String(id)]).filter(Boolean);
    return Promise.all([nativeTask, this.loadRoboImages(icons).catch(error => {
      this.recordMissing('M7:skill-icons', error.message);
    })]);
  }

  stats() {
    return {...super.stats(), roboCatalogSha256: this.roboCatalogSha256,
      roboCatalogBytes: this.roboCatalogBytes, roboActive: this.roboActive,
      roboExtensionHashes: {...this.roboExtensionHashes},
      roboNativeHitSound: this.roboNativeHitSound ? {
        logical: this.roboNativeHitSound.asset.logical, sha256: this.roboNativeHitSound.asset.sha256,
        bytes: this.roboNativeHitSound.asset.bytes} : null,
      roboResidentPortraitPages: this.roboCssUrls.size};
  }

  releaseScene() {
    this.roboActive = false;
    this.roboNativeHitSound = null;
    super.releaseScene();
    this.roboCssUrls?.clear(); this.roboPageUsedAt?.clear();
    this.roboHudFramePages = null;
  }
}
