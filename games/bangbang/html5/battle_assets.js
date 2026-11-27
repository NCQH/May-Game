// Resolves only assets extracted from the current source pack. Missing resources
// are reported by their logical names; there is no substitute tank/effect art.
export class BattleAssets {
  constructor({catalogUrl = './m4_asset_catalog.json'} = {}) {
    this.catalogUrl = catalogUrl; this.catalogGeneration = 0;
    this.catalog = null; this.catalogPromise = null;
    this.images = new Map(); this.imageTasks = new Map(); this.audio = new Map();
    this.missing = new Map(); this.bytesLoaded = 0; this.loadDurationMs = 0;
  }

  async loadCatalog({refresh = false} = {}) {
    if (refresh) { this.catalogGeneration += 1; this.catalogPromise = null; }
    const generation = this.catalogGeneration;
    if (!this.catalogPromise) this.catalogPromise = fetch(this.catalogUrl, {cache: 'no-store'})
      .then(response => {
        if (!response.ok) throw new Error('Không tải được danh mục tài nguyên trận.');
        return response.json();
      }).then(value => { if (generation === this.catalogGeneration) this.catalog = value; return value; })
      .catch(error => { if (generation === this.catalogGeneration) this.catalogPromise = null; throw error; });
    return this.catalogPromise;
  }

  source(resource) {
    return resource?.logical && this.catalog?.assets?.[resource.logical] || resource;
  }

  recordMissing(resource, reason) {
    const name = typeof resource === 'string' ? resource : resource?.logical || resource?.url || 'unbound';
    this.missing.set(name, {logical: name, reason});
  }

  async loadImage(asset) {
    if (!asset?.url) throw new Error('Tài nguyên ảnh chưa có đường dẫn đã đối chiếu.');
    if (this.imageTasks.has(asset.url)) return this.imageTasks.get(asset.url);
    const task = new Promise((resolve, reject) => {
      const image = new Image(); image.decoding = 'async';
      image.onload = async () => {
        try { await image.decode(); } catch { /* onload already decoded a valid image */ }
        this.images.set(asset.url, image); this.bytesLoaded += asset.bytes || 0; resolve(image);
      };
      image.onerror = () => {
        this.imageTasks.delete(asset.url);
        this.recordMissing(asset, 'load_failed');
        reject(new Error(`Không tải được ${asset.logical || asset.url}.`));
      };
      image.src = asset.url;
    });
    this.imageTasks.set(asset.url, task);
    return task;
  }

  image(asset) { return this.images.get(asset?.url) || null; }

  derived(resource) { return resource?.derived || this.source(resource)?.derived || null; }

  async loadResource(resource, required = false) {
    if (!resource) return;
    const source = this.source(resource);
    if (!source?.exists && !source?.category?.startsWith('derived')) {
      this.recordMissing(resource, 'source_absent');
      if (required) throw new Error(`Thiếu tài nguyên gốc: ${resource.logical || resource.url}.`);
      return;
    }
    if (/\.(png|jpe?g|webp)$/i.test(source.url)) {
      try { return await this.loadImage(source); }
      catch (error) { if (required) throw error; return; }
    }
    if (/\.swf$/i.test(source.url)) {
      const derived = this.derived(resource);
      if (!derived?.asset && !derived?.layers?.length && !derived?.assets?.length) {
        this.recordMissing(resource, 'not_converted');
        if (required) throw new Error(`Chưa có atlas cho ${source.logical}.`);
        return;
      }
      const atlases = [derived.asset, ...(derived.assets || []),
        ...(derived.layers || []).flatMap(layer => [layer.asset, ...(layer.assets || [])])].filter(Boolean);
      const results = await Promise.allSettled(atlases.map(asset => this.loadImage(asset)));
      const failure = results.find(result => result.status === 'rejected');
      if (failure && required) throw failure.reason;
      return;
    }
    if (/\.(mp3|ogg|wav)$/i.test(source.url)) {
      if (!this.audio.has(source.url)) {
        const audio = new Audio(); audio.preload = 'auto'; audio.src = source.url;
        this.audio.set(source.url, audio);
      }
    }
  }

  async loadPart(part) {
    if (!part) return;
    if (part.format === 'png-sheet') return this.loadResource(part.source, true);
    return this.loadResource({...part.source, derived: part.derived}, true);
  }

  async prepareScene(scene, accountId) {
    // A later native roster may have just gained scoped converted FX. Refresh
    // metadata per scene, while retaining successful content-addressed images.
    const begun = performance.now(), catalog = await this.loadCatalog({refresh: true});
    const map = catalog.maps[String(scene.mapId)];
    const self = scene.characters.find(actor => actor.accountId === accountId);
    this.missing.clear();
    // Preserve the verified M3 room/scene flow for maps/tanks outside this slice.
    if (!map || scene.mapId !== 19 || self?.tankId !== catalog.quanVu.tankId
        || ![catalog.quanVu.greenExternal, catalog.quanVu.phaQuanExternal].includes(self.externalId)) {
      return {supported: false, map, catalog,
        message: 'HTML5 hiện mở điều khiển Quan Vũ xanh hoặc Phá Quân ở Robo. Scene này chưa thuộc phạm vi điều khiển đã kiểm chứng.'};
    }
    const tasks = [this.loadResource(map.background, true)];
    const appearances = new Set([...scene.characters.map(actor => actor.externalId),
      ...(catalog.conversionScope?.extraAppearanceIds || [])]);
    // Summoned type-5 NPCs use the same typed appearance chain as map AI.
    // A source-audited summon is a preload dependency, not a map spawn/tank.
    const npcIds = new Set([...(map.robos || []).map(npc => npc.template),
      ...(catalog.conversionScope?.extraNpcIds || [])]);
    for (const id of npcIds) {
      const ai = catalog.aiNPCs[String(id)], arms = catalog.aiArms[String(ai?.nArmsId)];
      if (!arms?.exhibitId) throw new Error(`Thiếu tài nguyên ngoại hình NPC ${id} theo AIArms gốc.`);
      appearances.add(arms.exhibitId);
    }
    for (const id of appearances) {
      const appearance = catalog.appearances[String(id)];
      if (!appearance) throw new Error(`Chưa có ngoại hình gốc ${id} trong danh mục tài nguyên.`);
      for (const part of [appearance.body, appearance.cannon]) tasks.push(this.loadPart(part));
      for (const field of ['szDeadMp3', 'szHitMp3', 'szAppearMovie']) if (appearance[field]) tasks.push(this.loadResource(appearance[field]));
      for (const resource of Object.values(appearance.body?.resources || {})) tasks.push(this.loadResource(resource));
    }
    for (const template of Object.values(map.npcTemplates)) {
      for (const [field, resource] of Object.entries(template.resources || {})) {
        tasks.push(this.loadResource(resource, field === 'szImageFile'));
      }
    }
    const requiredSkills = new Set(map.skillIds || []);
    const requiredBuffs = new Set(map.buffIds || []);
    for (const actor of scene.characters.filter(actor => actor.tankId === catalog.quanVu.tankId)) {
      const bindings = catalog.quanVu.resourcesByExternal?.[String(actor.externalId)];
      if (!bindings) throw new Error(`Chưa đối chiếu tài nguyên kỹ năng ngoại hình ${actor.externalId}.`);
      for (const id of bindings.skillIds) requiredSkills.add(id);
      for (const id of bindings.buffIds) requiredBuffs.add(id);
      for (const logical of bindings.resourceKeys) tasks.push(this.loadResource(catalog.assets[logical], true));
    }
    if (map.turretFireEffect) tasks.push(this.loadResource(map.turretFireEffect.source, true));
    const skillIds = new Set([...requiredSkills, ...(catalog.conversionScope?.extraSkillIds || [])]);
    const buffIds = new Set([...requiredBuffs, ...(catalog.conversionScope?.extraBuffIds || [])]);
    const sceneItemIds = new Set(catalog.conversionScope?.extraSceneItemIds || []);
    for (const actor of scene.characters) {
      const tank = catalog.tanks[String(actor.tankId)];
      for (const skill of tank?.skillIds || []) skillIds.add(skill);
      for (const buff of tank?.buffIdsByExternal?.[String(actor.externalId)] || tank?.buffIds || []) buffIds.add(buff);
      for (const item of tank?.sceneItemIds || []) sceneItemIds.add(item);
      if (tank?.hudIcon) tasks.push(this.loadResource(tank.hudIcon));
    }
    for (const id of npcIds) {
      const ai = catalog.aiNPCs[String(id)], arms = catalog.aiArms[String(ai?.nArmsId)];
      if (arms?.nSkillId) skillIds.add(arms.nSkillId);
    }
    const exhibitsToLoad = new Map((map.exhibitIds || []).map(id => [id, true]));
    for (const skillId of skillIds) {
      if (!catalog.skills[String(skillId)]) this.recordMissing(`skill:${skillId}`, 'skill_row_missing');
      for (const exhibitId of catalog.skills[String(skillId)]?.exhibitIds || []) {
        exhibitsToLoad.set(exhibitId, exhibitsToLoad.get(exhibitId) || requiredSkills.has(skillId));
      }
    }
    for (const [id, required] of exhibitsToLoad) {
      if (!catalog.exhibits[String(id)]) this.recordMissing(`exhibit:${id}`, 'exhibit_row_missing');
      for (const resource of Object.values(catalog.exhibits[String(id)]?.resources || {})) tasks.push(this.loadResource(resource, required));
    }
    for (const id of buffIds) {
      if (!catalog.buffs[String(id)]) this.recordMissing(`buff:${id}`, 'buff_row_missing');
      for (const resource of Object.values(catalog.buffs[String(id)]?.resources || {})) tasks.push(this.loadResource(resource, requiredBuffs.has(id)));
    }
    for (const id of sceneItemIds) {
      if (!catalog.sceneItems?.[String(id)]) this.recordMissing(`sceneItem:${id}`, 'scene_item_row_missing');
      for (const resource of Object.values(catalog.sceneItems?.[String(id)]?.resources || {})) tasks.push(this.loadResource(resource));
    }
    const results = await Promise.allSettled(tasks);
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    this.loadDurationMs = performance.now() - begun;
    return {supported: true, map, catalog, sceneId: scene.sceneId,
      message: 'Đã tải bản đồ và đội hình; đang nhận snapshot trận.'};
  }

  stats() {
    return {loadedImages: this.images.size, loadedBytes: this.bytesLoaded,
      loadDurationMs: Math.round(this.loadDurationMs), missing: [...this.missing.values()]};
  }
}
