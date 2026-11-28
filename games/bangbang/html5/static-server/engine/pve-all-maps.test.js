// Runnable self-check: all 49 PvE maps have normalized data and their
// background/sky/minimap/gui assets exist on disk and are marked ready.
// Run: node games/bangbang/html5/static-server/engine/pve-all-maps.test.js
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { MAP_IDS, M81314_PARTS, buildPveIndex, parseCatalogText } from './pve-data.js';

const html5 = new URL('../../', import.meta.url);
const texts = await Promise.all(M81314_PARTS.map((name) => readFile(new URL(name, html5), 'utf8')));
const catalog = parseCatalogText(texts);
const index = buildPveIndex(catalog);

const logicalOf = (descriptor) => {
  if (!descriptor) return null;
  if (typeof descriptor === 'string') return descriptor;
  return descriptor.logical || descriptor.assetRef || null;
};
const fileOf = (url) => {
  assert.match(url, /^\/html5\//, `asset URL ${url}`);
  return new URL(url.slice('/html5/'.length), html5);
};

let assets = 0;
for (const id of MAP_IDS) {
  const map = index.maps.get(id);
  assert.ok(map, `map ${id} normalized`);
  assert.equal(map.id, id, `map ${id} id`);
  assert.ok(map.name, `map ${id} name`);
  assert.ok(map.width > 0 && map.height > 0, `map ${id} size`);
  assert.ok(map.spawns.length > 0, `map ${id} spawns`);
  assert.equal(map.rectangleFormat, 'x1,y1,x2,y2', `map ${id} rect format`);

  assert.ok(map.assets.background, `map ${id} background`);
  for (const kind of ['background', 'sky', 'minimap', 'gui']) {
    const logical = logicalOf(map.assets[kind]);
    if (!logical) continue;
    const row = catalog.assets[logical];
    assert.ok(row?.url, `map ${id} ${kind} catalog row`);
    assert.equal(row.exists, true, `map ${id} ${kind} exists`);
    assert.equal(row.status, 'ready', `map ${id} ${kind} status`);
    assert.ok(existsSync(fileOf(row.url)), `map ${id} ${kind} file ${row.url}`);
    assets += 1;
  }
}

console.log('pve-all-maps self-check OK');
console.log(JSON.stringify({ maps: MAP_IDS.length, assets }));
