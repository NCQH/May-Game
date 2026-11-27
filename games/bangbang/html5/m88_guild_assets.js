/** Additional native Guild art. No gameplay values or ownership are created. */
export async function loadNativeGuildCatalog(url) {
  const response = await fetch(url, {cache: 'no-store'});
  if (!response.ok) throw new Error('Không tải được tài nguyên kỹ năng Guild.');
  const bytes = await response.arrayBuffer();
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(value => value.toString(16).padStart(2, '0')).join('');
  return {catalog: JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)),
    sha256, bytes: bytes.byteLength};
}

export function mergeNativeGuildCatalog(catalog, extra, baseSha256) {
  if (extra?.schemaVersion !== 1 || extra.source?.m6CatalogSha256 !== baseSha256)
    throw new Error('Danh mục kỹ năng Guild không khớp tài nguyên trận hiện tại.');
  for (const [logical, resource] of Object.entries(extra.assets || {})) {
    const previous = catalog.assets?.[logical];
    if (resource.reuseM6) {
      if (!previous || previous.sha256 !== resource.sha256)
        throw new Error(`Tài nguyên dùng chung của Guild không khớp: ${logical}.`);
    } else {
      if (previous && previous.sha256 !== resource.sha256)
        throw new Error(`Tài nguyên Guild trùng đường dẫn với nội dung khác: ${logical}.`);
      catalog.assets[logical] = previous || resource;
    }
  }
  for (const [kind, table] of [['skill', 'skills'], ['buff', 'buffs'], ['exhibit', 'exhibits']]) {
    for (const [id, resources] of Object.entries(extra.bindings?.[kind] || {})) {
      const row = catalog[table]?.[id];
      if (!row) throw new Error(`Thiếu dữ liệu native Guild ${kind}:${id}.`);
      row.resources ||= {};
      for (const [field, resource] of Object.entries(resources)) {
        const previous = row.resources[field];
        if (previous && (previous.logical || previous.assetRef) !== resource.logical)
          throw new Error(`Binding native Guild không khớp: ${kind}:${id}:${field}.`);
        row.resources[field] = previous || resource;
      }
    }
  }
  for (const kind of ['skill', 'buff']) {
    const table = catalog.dependencyManifests.runtime[kind] ||= {};
    for (const [id, dependency] of Object.entries(extra.runtime?.[kind] || {})) {
      const previous = table[id] || {};
      table[id] = {...previous, ...dependency,
        logicalResources: [...new Set([...(previous.logicalResources || []), ...dependency.logicalResources])]};
    }
  }
  catalog.guildPresentation = {groups: extra.groups, passivePreload: extra.passivePreload};
  return catalog;
}

/** Preload the exact active command from S1705, including its replacement and
 * secondary buffs. Passive icons are nine small native images; self snapshot
 * still decides which buffs exist. A command does not unlock any input slot.
 */
export function guildSceneManifests(catalog, scene) {
  const guild = catalog.guildPresentation;
  if (!guild) return [];
  const manifests = [guild.passivePreload].filter(Boolean);
  for (const actor of scene.characters || []) {
    const command = Number(actor.commandSkill || 0);
    if (!command) continue;
    const group = command >>> 4, level = command & 15;
    const skill = guild.groups?.[String(group)]?.levels?.[String(level)];
    const dependency = skill && catalog.dependencyManifests?.runtime?.skill?.[String(skill)];
    if (!dependency) throw new Error('Kỹ năng Guild được server chọn chưa có tài nguyên đã đối chiếu.');
    manifests.push(dependency);
  }
  return manifests;
}
