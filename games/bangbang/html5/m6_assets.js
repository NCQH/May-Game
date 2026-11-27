import {BattleAssets} from './battle_assets.js';
import {loadNativeGuildCatalog, mergeNativeGuildCatalog, guildSceneManifests} from './m88_guild_assets.js';
import {loadPKCatalog, mergePKCatalog} from './m89_pk_maps.js';
import {isBattleMap,loadModeCatalog,mergeModeCatalog} from './m810_modes.js';
import {loadDeathCatalog,mergeDeathCatalog} from './m811_death.js';
import {loadPveCatalog,mergePveCatalog,companionSceneManifests} from './m81314_assets.js';
import {loadM81319Tanks,mergeM81319Tanks} from './m81319_tanks.js';
import {loadWorldBossCatalog,mergeWorldBossCatalog} from './m81330_assets.js';
import {isWorldBossScene,WORLD_BOSS_MAP} from './m81330_protocol.js';
import {loadM81331Locale,mergeM81331BattleLocale} from './m81331_locale.js';
import {loadM81333Skins,mergeM81333BattleSkins} from './m81333_skins.js';
import {loadM81333LacSkin,mergeM81333LacBattle} from './m81333_lac_skin.js';
import {loadM81334Skins,mergeM81334Battle} from './m81334_skins.js';
import {loadM81335Skins,mergeM81335Battle} from './m81335_skins.js';
import {loadM81336TimegoddessFx,mergeM81336TimegoddessFx} from './m81336_timegoddess_fx.js';
import {loadM81336MagnetoFx,mergeM81336MagnetoFx} from './m81336_magneto_fx.js';
import {loadM81338LevelLooks,mergeM81338LevelLooksBattle,m81338VisualExternal} from './m81338_level_looks.js';

/** Restore shared descriptors without copying atlas frame arrays per consumer. */
export function hydrateM6Catalog(catalog) {
  const sources = catalog.assets || {}, derived = catalog.derivedAssets || {};
  const seen = new WeakSet();
  function hydrate(value) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    if (value.assetRef) {
      const source = sources[value.assetRef];
      if (!source) throw new Error(`Tham chiếu tài nguyên không hợp lệ: ${value.assetRef}.`);
      return hydrate(source);
    }
    seen.add(value);
    if (value.derivedRef && !value.derived) {
      if (!derived[value.derivedRef]) throw new Error(`Thiếu descriptor atlas ${value.derivedRef}.`);
      value.derived = derived[value.derivedRef];
    }
    if (value.framesRef && !value.frames) {
      if (!derived[value.framesRef]?.frames) throw new Error(`Thiếu khung hình ${value.framesRef}.`);
      value.frames = derived[value.framesRef].frames;
    }
    for (const [key, child] of Object.entries(value)) {
      // The serialization block documents the reference syntax; it is not a
      // resource binding. Actual dangling assetRef/derivedRef still fail closed.
      if (['derived', 'derivedAssets', 'frames', 'serialization'].includes(key)) continue;
      if (child && typeof child === 'object') value[key] = hydrate(child);
    }
    return value;
  }
  return hydrate(catalog);
}

// The three optional bridgehead allies never occur in the original spawn
// list. Register their source rows after the existing, hash-pinned catalogs
// have merged; no old catalog/artwork or combat row is replaced.
export function mergeLocalPveSupport(catalog, extra, sourceHashes) {
  const expected = {3140311:4040201,3140312:2010301,3140313:2200101};
  const donors = {3140311:521,3140312:237,3140313:2679};
  const ids = Object.keys(expected), rows = extra?.bindings?.aiNPCs;
  const runtime = extra?.runtime?.npc, addition = extra?.maps?.['31403'];
  const sameKeys = (object, keys) => Object.keys(object || {}).sort().join(',') === [...keys].sort().join(',');
  const sameValues = (left,right) => Array.isArray(left) && Array.isArray(right)
    && JSON.stringify([...new Set(left)].sort())===JSON.stringify([...new Set(right)].sort());
  if (extra?.schemaVersion !== 1 || !sameKeys(rows,ids) || !sameKeys(runtime,ids)
      || !sameKeys(extra.bindings,['aiNPCs']) || !sameKeys(extra.runtime,['npc'])
      || !sameKeys(extra.maps,['31403']) || !sameKeys(extra.source,Object.keys(sourceHashes))
      || Object.entries(sourceHashes).some(([name,sha])=>extra.source[name]!==sha)
      || !addition || !catalog.dependencyManifests?.maps?.['31403'])
    throw new Error('Danh mục quân hỗ trợ PvE không khớp dữ liệu gốc.');
  const typed={}, resources=[];
  for (const id of ids) {
    const row=rows[id], manifest=runtime[id];
    const donor=catalog.dependencyManifests.runtime.npc[String(donors[id])];
    const donorTypes={...donor?.typedIds,npc:[Number(id)]};
    if (row.nTemplateId!==Number(id) || row.nArmsId!==expected[id] || row.nOpCampArmsId
        || !catalog.aiArms?.[String(row.nArmsId)] || manifest.missing?.length
        || catalog.aiNPCs[String(donors[id])]?.nArmsId!==row.nArmsId || !donor || donor.missing?.length
        || !sameKeys(manifest.typedIds,Object.keys(donorTypes))
        || Object.entries(donorTypes).some(([kind,values])=>!sameValues(manifest.typedIds[kind],values))
        || !sameValues(manifest.logicalResources,donor.logicalResources)
        || manifest.typedIds?.npc?.length!==1 || manifest.typedIds.npc[0]!==Number(id)
        || (catalog.aiNPCs[id] && JSON.stringify(catalog.aiNPCs[id])!==JSON.stringify(row))
        || (catalog.dependencyManifests.runtime.npc[id]
          && JSON.stringify(catalog.dependencyManifests.runtime.npc[id])!==JSON.stringify(manifest))
        || !Array.isArray(manifest.logicalResources)
        || manifest.logicalResources.some(logical=>!catalog.assets?.[logical]?.exists))
      throw new Error(`Thiếu liên kết tài nguyên gốc của quân hỗ trợ ${id}.`);
    resources.push(...manifest.logicalResources);
    for(const [kind,values] of Object.entries(manifest.typedIds)) {
      if(!Array.isArray(values) || values.some(value=>!Number.isInteger(value)))
        throw new Error('Liên kết quân hỗ trợ PvE không hợp lệ.');
      (typed[kind] ||= []).push(...values);
    }
  }
  if(!sameKeys(addition.typedIds,Object.keys(typed)) || !sameValues(addition.logicalResources,resources)
      || Object.entries(typed).some(([kind,values])=>!sameValues(addition.typedIds[kind],values)))
    throw new Error('Phụ thuộc tải trước không khớp ba quân hỗ trợ PvE.');
  // The scene preload receives the same closure as runtime NPC arrivals.
  // Clone additions so repeat loads do not mutate the source document cache.
  for (const id of ids) {
    catalog.aiNPCs[id]=structuredClone(rows[id]);
    catalog.dependencyManifests.runtime.npc[id]=structuredClone(runtime[id]);
  }
  // mergePveCatalog may share this node with its cached source document.
  // Copy the target map as well as the additions before extending it.
  const map=structuredClone(catalog.dependencyManifests.maps['31403']);
  for (const [kind,values] of Object.entries(addition.typedIds || {}))
    map.typedIds[kind]=[...new Set([...(map.typedIds[kind] || []),...values])];
  map.logicalResources=[...new Set([...map.logicalResources,...addition.logicalResources])];
  catalog.dependencyManifests.maps['31403']=map;
  return catalog;
}

async function loadLocalPveSupport(catalog, sourceHashes) {
  const response=await fetch('./m81342_local_pve_catalog.json',{cache:'no-store'});
  if(!response.ok)throw new Error('Không tải được danh mục quân hỗ trợ PvE.');
  return mergeLocalPveSupport(catalog,await response.json(),sourceHashes);
}

function imageAssets(source, descriptor) {
  if (!source) return [];
  if (/\.(png|jpe?g|webp)$/i.test(source.url || '')) return [source];
  return [descriptor?.asset, ...(descriptor?.assets || []),
    ...(descriptor?.layers || []).flatMap(layer => [layer.asset, ...(layer.assets || [])])].filter(Boolean);
}

export function sceneDependencies(catalog, scene, accountId) {
  const map = catalog.maps?.[String(scene.mapId)];
  const self = scene.characters.find(actor => actor.accountId === accountId);
  const manifests = catalog.dependencyManifests;
  if(Number(scene.mapId)===WORLD_BOSS_MAP&&!isWorldBossScene(scene))
    return {supported:false,map,manifests:[],message:'Map boss không khớp loại phòng native.'};
  if (!map || !isBattleMap(scene.mapId) || !self || !manifests?.tanks?.[self.tankId]
      || !manifests.maps?.[String(scene.mapId)]) {
    return {supported: false, map, manifests: [],
      message: 'Bản đồ hoặc tank này chưa có tài nguyên đã đối chiếu.'};
  }
  const selected = [manifests.maps[String(scene.mapId)]];
  for (const actor of scene.characters) {
    const tank = manifests.tanks[String(actor.tankId)];
    const visualExternal=m81338VisualExternal(actor,actor.externalId);
    const dependency = tank?.levelLooks?.[String(visualExternal)]
      || tank?.baseByExternal?.[String(visualExternal)] || tank?.skins?.[String(visualExternal)];
    if (!dependency || dependency.nativeSupport !== 'ready') {
      return {supported: false, map, manifests: [],
        message: `Ngoại hình ${actor.externalId} của tank ${actor.tankId} chưa được hỗ trợ trong M6.`};
    }
    selected.push(dependency);
  }
  selected.push(...guildSceneManifests(catalog, scene));
  selected.push(...companionSceneManifests(catalog, scene));
  return {supported: true, map, manifests: selected.filter(Boolean)};
}

/** M6 scene cache. The native server still owns every game-state transition. */
export class M6Assets extends BattleAssets {
  constructor({catalogUrl = './m6_asset_catalog.json', maxDecodedBytes = 768 * 1024 * 1024,
    guildCatalogUrl = './m88_guild_catalog.json', pkCatalogUrl = './m89_pk_catalog.json',modeCatalogUrl='./m810_modes_catalog.json',deathCatalogUrl='./m811_death_catalog.json',pveCatalogUrl='./m81314_assets_catalog.json',tanksCatalogUrl='./m81319_tanks_catalog.json',worldBossCatalogUrl='./m81330_worldboss_catalog.json'} = {}) {
    super({catalogUrl});
    this.guildCatalogUrl = guildCatalogUrl; this.guildCatalogSha256 = null; this.guildCatalogBytes = 0;
    this.pkCatalogUrl = pkCatalogUrl; this.pkCatalogSha256 = null;
    this.modeCatalogUrl=modeCatalogUrl;this.deathCatalogUrl=deathCatalogUrl;
    this.pveCatalogUrl=pveCatalogUrl;this.pveCatalogSha256=null;
    this.tanksCatalogUrl=tanksCatalogUrl;this.tanksCatalogSha256=null;
    this.worldBossCatalogUrl=worldBossCatalogUrl;this.worldBossCatalogSha256=null;
    this.maxDecodedBytes = maxDecodedBytes;
    this.imageMeta = new Map(); this.audioTasks = new Map(); this.binaryTasks = new Map();
    this.runtimeTasks = new Map(); this.sceneGeneration = 0; this.sceneId = null;
    this.decodedBytes = 0; this.audioBytes = 0; this.peakDecodedBytes = 0;
    this.integrityChecks = 0; this.integrityFailures = 0; this.releases = 0;
    this.decodeAudio = null; this.onEvictImage = () => {};
    this.activeLogical = new Set(); this.pending = 0;
    this.pinnedUrls = new Set(); this.frameIndex = 0; this.evictions = 0;
    this.reservedDecodedBytes = 0; this.imageMisses = 0; this.retryAt = new Map();
    this.abortController = new AbortController();
    this.catalogSha256 = null; this.catalogBytes = 0;
  }

  async loadCatalog({refresh = false} = {}) {
    if (refresh) { this.catalogGeneration += 1; this.catalogPromise = null; }
    const generation = this.catalogGeneration;
    if (!this.catalogPromise) {
      this.catalogPromise = (async () => {
        const response = await fetch(this.catalogUrl, {cache: 'no-store'});
        if (!response.ok) throw new Error('Không tải được danh mục tài nguyên trận.');
        const bytes = await response.arrayBuffer();
        // Hash precisely the bytes this page parses. The runtime audit can
        // verify large catalogs without relying on DevTools response caches.
        const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
          .map(value => value.toString(16).padStart(2, '0')).join('');
        const rawCatalog = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
        const guild = this.guildCatalogUrl ? await loadNativeGuildCatalog(this.guildCatalogUrl) : null;
        if (guild) mergeNativeGuildCatalog(rawCatalog, guild.catalog, sha256);
        const pk = this.pkCatalogUrl ? await loadPKCatalog(this.pkCatalogUrl) : null;
        if (pk) mergePKCatalog(rawCatalog, pk.catalog, sha256);
        if(this.modeCatalogUrl)mergeModeCatalog(rawCatalog,await loadModeCatalog(this.modeCatalogUrl),sha256);
        if(this.deathCatalogUrl)mergeDeathCatalog(rawCatalog,await loadDeathCatalog(this.deathCatalogUrl),sha256);
        const pve=this.pveCatalogUrl?await loadPveCatalog(this.pveCatalogUrl,{refresh}):null;
        if(pve)mergePveCatalog(rawCatalog,hydrateM6Catalog(pve.catalog),sha256);
        const tanks=this.tanksCatalogUrl?await loadM81319Tanks(this.tanksCatalogUrl,{refresh}):null;
        if(tanks)mergeM81319Tanks(rawCatalog,hydrateM6Catalog(structuredClone(tanks.catalog)),sha256);
        const boss=this.worldBossCatalogUrl?await loadWorldBossCatalog(this.worldBossCatalogUrl,{refresh}):null;
        if(boss)mergeWorldBossCatalog(rawCatalog,hydrateM6Catalog(boss.catalog),sha256);
        const catalog = hydrateM6Catalog(rawCatalog);
        mergeM81331BattleLocale(catalog,await loadM81331Locale(undefined,{refresh}));
        if(pve){
          const skins=await loadM81333Skins(undefined,{refresh});
          await mergeM81333BattleSkins(catalog,skins.catalog,sha256,pve.sha256);
          if(tanks){
            const lac=await loadM81333LacSkin(undefined,{refresh});
            await mergeM81333LacBattle(catalog,hydrateM6Catalog(lac.catalog),{
              'm6_asset_catalog.json':sha256,'m81314_assets_catalog.json':pve.sha256,'m81319_tanks_catalog.json':tanks.sha256});
            const skins34=await loadM81334Skins(undefined,{refresh});
            await mergeM81334Battle(catalog,hydrateM6Catalog(skins34.catalog),{
              'm6_asset_catalog.json':sha256,'m81314_assets_catalog.json':pve.sha256,'m81319_tanks_catalog.json':tanks.sha256,
              'm81333_skins_catalog.json':skins.sha256,'m81333_lac_skin_catalog.json':lac.sha256});
            const skins35=await loadM81335Skins(undefined,{refresh});
            await mergeM81335Battle(catalog,hydrateM6Catalog(skins35.catalog),{
              'm6_asset_catalog.json':sha256,'m81314_assets_catalog.json':pve.sha256,'m81319_tanks_catalog.json':tanks.sha256,
              'm81333_skins_catalog.json':skins.sha256,'m81333_lac_skin_catalog.json':lac.sha256,
              'm81334_skins_catalog.json':skins34.sha256});
            const timeFx=await loadM81336TimegoddessFx(undefined,{refresh});
            await mergeM81336TimegoddessFx(catalog,timeFx.catalog,{
              'm6_asset_catalog.json':sha256,'m81319_tanks_catalog.json':tanks.sha256,
              'm81335_skins_catalog.json':skins35.sha256});
            const magnetoFx=await loadM81336MagnetoFx(undefined,{refresh});
            await mergeM81336MagnetoFx(catalog,magnetoFx.catalog,{
              'm6_asset_catalog.json':sha256,'m81319_tanks_catalog.json':tanks.sha256,
              'm81335_skins_catalog.json':skins35.sha256});
            const levelLooks=await loadM81338LevelLooks(undefined,{refresh});
            await mergeM81338LevelLooksBattle(catalog,levelLooks.catalog,{
              'm6_asset_catalog.json':sha256,'m81319_tanks_catalog.json':tanks.sha256,
              'm81335_skins_catalog.json':skins35.sha256,
              'm81336_timegoddess_fx_catalog.json':timeFx.sha256,
              'm81336_magneto_fx_catalog.json':magnetoFx.sha256});
          }
        }
        if(pve)await loadLocalPveSupport(catalog,{
          'm6_asset_catalog.json':sha256,'m81314_assets_catalog.json':pve.sha256});
        Object.defineProperty(catalog, 'm6Hydrated', {value: true});
        if (generation === this.catalogGeneration) {
          this.catalog = catalog; this.catalogSha256 = sha256; this.catalogBytes = bytes.byteLength;
          this.guildCatalogSha256 = guild?.sha256 || null; this.guildCatalogBytes = guild?.bytes || 0;
          this.pkCatalogSha256 = pk?.sha256 || null;
          this.pveCatalogSha256=pve?.sha256||null;
          this.tanksCatalogSha256=tanks?.sha256||null;
          this.worldBossCatalogSha256=boss?.sha256||null;
        }
        return catalog;
      })().catch(error => { if (generation === this.catalogGeneration) this.catalogPromise = null; throw error; });
    }
    return this.catalogPromise;
  }

  async binary(asset) {
    if (!asset?.url || !/^[a-f0-9]{64}$/i.test(asset.sha256 || '')) {
      throw new Error(`Tài nguyên chưa có hash xác minh: ${asset?.logical || asset?.url || 'unknown'}.`);
    }
    const key = `${asset.url}:${asset.sha256}`;
    if (this.binaryTasks.has(key)) return this.binaryTasks.get(key);
    const signal = this.abortController.signal;
    const requestUrl = `${asset.url}${asset.url.includes('?') ? '&' : '?'}v=${asset.sha256}`;
    const task = (async () => {
      const response = await fetch(requestUrl, {cache: 'force-cache', signal});
      if (!response.ok) throw new Error(`Không tải được ${asset.logical || asset.url} (${response.status}).`);
      const data = await response.arrayBuffer();
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))]
        .map(value => value.toString(16).padStart(2, '0')).join('');
      if (hash !== asset.sha256) {
        this.integrityFailures += 1;
        this.recordMissing(asset, 'hash_mismatch');
        throw new Error(`Hash tài nguyên không khớp: ${asset.logical || asset.url}.`);
      }
      this.integrityChecks += 1;
      return data;
    })();
    this.binaryTasks.set(key, task);
    try { return await task; }
    finally { if (this.binaryTasks.get(key) === task) this.binaryTasks.delete(key); }
  }

  async loadImage(asset) {
    if (!asset?.url) throw new Error('Ảnh chưa có đường dẫn đã đối chiếu.');
    const old = this.imageMeta.get(asset.url);
    if (old && old.sha256 !== asset.sha256) this.evictImage(asset.url);
    if (this.images.has(asset.url)) return this.images.get(asset.url);
    if (this.imageTasks.has(asset.url)) return this.imageTasks.get(asset.url);
    const generation = this.sceneGeneration;
    const task = (async () => {
      this.pending += 1;
      const data = await this.binary(asset);
      if (generation !== this.sceneGeneration) throw new Error('Tài nguyên thuộc scene cũ.');
      const reservation = Math.max(0, Number(asset.width) * Number(asset.height) * 4) || 0;
      if (!this.makeRoom(reservation)) throw new Error('Chưa đủ chỗ giải mã atlas đang cần; sẽ thử lại sau khi hiệu ứng cũ kết thúc.');
      this.reservedDecodedBytes += reservation;
      const image = new Image(); image.decoding = 'async';
      const url = URL.createObjectURL(new Blob([data]));
      try {
        await new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = () => reject(new Error(`Không giải mã được ${asset.logical || asset.url}.`));
          image.src = url;
        });
        await image.decode();
      } finally {
        URL.revokeObjectURL(url);
        if (generation === this.sceneGeneration) this.reservedDecodedBytes = Math.max(0, this.reservedDecodedBytes - reservation);
      }
      if (generation !== this.sceneGeneration) throw new Error('Tài nguyên thuộc scene cũ.');
      const bytes = (image.naturalWidth || image.width) * (image.naturalHeight || image.height) * 4;
      if (!this.makeRoom(bytes)) {
        this.recordMissing(asset, 'decoded_memory_limit');
        throw new Error('Đội hình cần nhiều bộ nhớ ảnh hơn giới hạn hiện tại. Hãy đóng trận và tải lại.');
      }
      this.images.set(asset.url, image);
      this.imageMeta.set(asset.url, {sha256: asset.sha256, decodedBytes: bytes, bytes: data.byteLength,
        lastFrame: -1, loadedAt: performance.now()});
      this.decodedBytes += bytes; this.bytesLoaded += data.byteLength;
      this.peakDecodedBytes = Math.max(this.peakDecodedBytes, this.decodedBytes);
      return image;
    })();
    this.imageTasks.set(asset.url, task);
    try { return await task; }
    catch (error) {
      if (generation === this.sceneGeneration && error.name !== 'AbortError') this.recordMissing(asset,
        this.missing.get(asset.logical || asset.url)?.reason || 'load_or_decode_failed');
      throw error;
    } finally {
      if (generation === this.sceneGeneration) this.pending = Math.max(0, this.pending - 1);
      if (this.imageTasks.get(asset.url) === task) this.imageTasks.delete(asset.url);
    }
  }

  evictImage(url) {
    const image = this.images.get(url), meta = this.imageMeta.get(url);
    if (image) this.onEvictImage(image);
    this.decodedBytes = Math.max(0, this.decodedBytes - (meta?.decodedBytes || 0));
    this.images.delete(url); this.imageMeta.delete(url);
    if (image) this.evictions += 1;
  }

  makeRoom(bytes) {
    const candidates = [...this.imageMeta.entries()].filter(([url, meta]) =>
      !this.pinnedUrls.has(url) && (meta.lastFrame < 0 || meta.lastFrame < this.frameIndex - 1))
      .sort((a, b) => a[1].lastFrame - b[1].lastFrame || a[1].loadedAt - b[1].loadedAt);
    while (this.decodedBytes + this.reservedDecodedBytes + bytes > this.maxDecodedBytes && candidates.length) {
      this.evictImage(candidates.shift()[0]);
    }
    return this.decodedBytes + this.reservedDecodedBytes + bytes <= this.maxDecodedBytes;
  }

  beginFrame() { this.frameIndex += 1; }

  image(asset) {
    const value = super.image(asset);
    if (value) {
      const meta = this.imageMeta.get(asset.url);
      if (meta) meta.lastFrame = this.frameIndex;
    }
    return value;
  }

  requestImage(asset) {
    if (!asset?.url || this.images.has(asset.url) || this.imageTasks.has(asset.url)
        || (this.retryAt.get(asset.url) || 0) > performance.now()) return;
    this.imageMisses += 1;
    this.loadImage(asset).catch(() => { this.retryAt.set(asset.url, performance.now() + 250); });
  }

  async loadPart(part) {
    if (!part) return;
    const assets = imageAssets(this.source(part.source), part.derived || this.derived(part.source));
    for (const asset of assets) this.pinnedUrls.add(asset.url);
    await Promise.all(assets.map(asset => this.loadImage(asset)));
  }

  async loadAudio(resource) {
    const source = this.source(resource);
    if (this.audio.has(source.url)) return this.audio.get(source.url);
    if (this.audioTasks.has(source.url)) return this.audioTasks.get(source.url);
    const generation = this.sceneGeneration;
    const task = (async () => {
      const encoded = await this.binary(source);
      const buffer = this.decodeAudio ? await this.decodeAudio(encoded) : encoded;
      if (generation !== this.sceneGeneration) return null;
      this.audio.set(source.url, buffer);
      this.audioBytes += buffer.numberOfChannels ? buffer.length * buffer.numberOfChannels * 4 : encoded.byteLength;
      return buffer;
    })();
    this.audioTasks.set(source.url, task);
    try { return await task; }
    finally { if (this.audioTasks.get(source.url) === task) this.audioTasks.delete(source.url); }
  }

  async loadResource(resource, required = false) {
    if (!resource) return;
    const source = this.source(resource);
    if (source?.exists && (/\.swf$/i.test(source.url || '')
        || (['m81335-atlas-metadata','m81338-atlas-metadata'].includes(source.category) && /\.json$/i.test(source.url || '')))) {
      const descriptor = this.derived(resource);
      const all = imageAssets(source, descriptor);
      if (!all.length) return super.loadResource(resource, required);
      // Multi-page effects can be hundreds of MiB decoded. Warm their first
      // page; drawSequence requests and prefetches the actual active pages.
      const first = descriptor.layers?.length
        ? descriptor.layers.map(layer => layer.frames?.[0]?.asset || layer.asset).filter(Boolean)
        : [descriptor.frames?.[0]?.asset || descriptor.asset || descriptor.assets?.[0]].filter(Boolean);
      try { await Promise.all(first.map(asset => this.loadImage(asset))); }
      catch (error) { if (required && this.pinnedUrls.has(first[0]?.url)) throw error; }
      return;
    }
    if (source?.exists && /\.(mp3|ogg|wav)$/i.test(source.url || '')) {
      try { return await this.loadAudio(source); }
      catch (error) {
        this.recordMissing(source, error.name === 'EncodingError' ? 'audio_decode_failed' : 'audio_load_failed');
        if (required) throw error;
        return;
      }
    }
    return super.loadResource(resource, required);
  }

  async loadLogicalResources(logicals, {strict = true} = {}) {
    const resources = [...new Set(logicals)].map(name => this.catalog.assets[name]).filter(Boolean);
    const queue = resources.slice();
    await Promise.all(Array.from({length: Math.min(4, queue.length)}, async () => {
      while (queue.length) {
        const resource = queue.shift(); this.activeLogical.add(resource.logical);
        // The four resources absent from the original source stay classified
        // and visible in diagnostics. They are never silently substituted.
        await this.loadResource(resource, strict && resource.exists);
      }
    }));
  }

  async prepareScene(scene, accountId) {
    const begun = performance.now();
    // A release drops decoded images, buffers and GPU textures; the browser's
    // hash-versioned HTTP cache can still serve identical verified bytes.
    this.releaseScene(); this.sceneId = scene.sceneId; this.missing.clear();
    const catalog = await this.loadCatalog();
    const selected = sceneDependencies(catalog, scene, accountId);
    if (!selected.supported) return {...selected, catalog};
    this.pinnedUrls.add(selected.map.background.url);
    await this.loadResource(selected.map.background, true);
    if (selected.map.sky) {
      this.pinnedUrls.add(selected.map.sky.url);
      await this.loadResource(selected.map.sky, true);
    }
    for (const character of scene.characters) {
      const appearance = catalog.appearances[String(m81338VisualExternal(character,character.externalId))];
      for (const part of [appearance?.body, appearance?.engine, appearance?.cannon]) await this.loadPart(part);
    }
    for (const manifest of selected.manifests) {
      for (const missing of manifest.missing || []) {
        if (missing.logical) this.recordMissing(missing.logical, missing.reason);
      }
    }
    const logicals = selected.manifests.flatMap(item => item.logicalResources || []);
    logicals.push(...Object.values(catalog.modePresentation?.resources||{}).map(row=>row.logical).filter(Boolean));
    await this.loadLogicalResources(logicals);
    this.loadDurationMs = performance.now() - begun;
    return {supported: true, map: selected.map, catalog, sceneId: scene.sceneId,
      graphicsWarmUrls:[...this.images.keys()],
      message: 'Đã tải tài nguyên của bản đồ và đội hình; đang nhận snapshot trận.'};
  }

  ensureRuntime(kind, id) {
    const key = `${kind}:${id}`, manifest = this.catalog?.dependencyManifests?.runtime?.[kind]?.[String(id)];
    if (!manifest) return Promise.resolve(false);
    if (this.runtimeTasks.has(key)) return this.runtimeTasks.get(key);
    const task = this.loadLogicalResources(manifest.logicalResources || [], {strict: false})
      .then(() => true).catch(error => { this.recordMissing(key, error.message); return false; });
    this.runtimeTasks.set(key, task);
    return task;
  }

  preparePacket(packet) {
    if (!this.catalog || this.sceneId == null) return;
    const tasks = [], ensure = (kind, id) => { if (id != null) tasks.push(this.ensureRuntime(kind, id)); };
    if (packet.type === 'skillChanged' || packet.type === 'skillCooldown') ensure('skill', packet.skill?.skillId);
    if (packet.type === 'sceneSelf') for (const skill of packet.skills || []) ensure('skill', skill.skillId);
    if (packet.type === 'buffAdd') ensure('buff', packet.buff?.templateId);
    if (packet.type === 'sceneObjectAdd') {
      const object = packet.object, kind = ({3: 'mapNpc', 4: 'scene', 5: 'npc'})[object?.objectId >>> 26];
      if (kind) ensure(kind, object.templateId);
      for (const buff of object?.buffs || []) ensure('buff', buff.templateId);
    }
    if (packet.type === 'sceneUpdate') {
      for (const skill of packet.skills || []) ensure('skill', skill.skillId);
      for (const bullet of packet.fires || []) ensure('skill', bullet.templateId);
    }
    return Promise.all(tasks);
  }

  releaseScene() {
    this.sceneGeneration += 1; this.sceneId = null;
    this.abortController.abort(); this.abortController = new AbortController();
    for (const url of this.images.keys()) this.evictImage(url);
    this.imageTasks.clear(); this.audioTasks.clear(); this.binaryTasks.clear(); this.runtimeTasks.clear();
    this.audio.clear(); this.audioBytes = 0; this.bytesLoaded = 0; this.activeLogical.clear();
    this.reservedDecodedBytes = 0; this.pending = 0;
    this.pinnedUrls.clear(); this.retryAt.clear(); this.frameIndex = 0;
    this.releases += 1;
  }

  stats() {
    return {...super.stats(), decodedImageBytes: this.decodedBytes, decodedAudioBytes: this.audioBytes,
      maxDecodedImageBytes: this.maxDecodedBytes, peakDecodedImageBytes: this.peakDecodedBytes,
      integrityChecks: this.integrityChecks, integrityFailures: this.integrityFailures,
      catalogSha256: this.catalogSha256, catalogBytes: this.catalogBytes,
      guildCatalogSha256: this.guildCatalogSha256, guildCatalogBytes: this.guildCatalogBytes,
      pkCatalogSha256: this.pkCatalogSha256,
      pveCatalogSha256: this.pveCatalogSha256,
      tanksCatalogSha256: this.tanksCatalogSha256,
      sceneId: this.sceneId, sceneGeneration: this.sceneGeneration,
      activeLogicalResources: this.activeLogical.size, pending: this.pending, releases: this.releases,
      cacheEvictions: this.evictions, pageRequests: this.imageMisses,
      reservedDecodedBytes: this.reservedDecodedBytes, pinnedImages: this.pinnedUrls.size};
  }
}

export {imageAssets};
