#!/usr/bin/env node
// Static first-load measurement for the BangBang HTML5 client.
// Usage: node games/bangbang/html5/static-server/perf/measure.cjs
const fs = require('node:fs');
const path = require('node:path');

const here = __dirname;
const html5 = path.resolve(here, '../..');
const bangbang = path.resolve(html5, '..');
const root = path.resolve(bangbang, '../..');

const fileOf = (url) => path.join(bangbang, url.replace(/^\/games\/bangbang\//, '').split('?')[0]);
const bytes = (file) => { try { return fs.statSync(file).size; } catch { return 0; } };
const mib = (n) => Number((n / 1048576).toFixed(2));

function graph(entry, seen = new Set()) {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  let text = '';
  try { text = fs.readFileSync(entry, 'utf8'); } catch { return seen; }
  // Static imports/exports only; dynamic import() is lazy and not first load.
  const re = /(?:^|\n)\s*(?:import\s+(?:[^'"\n]*?\s+from\s+)?|export\s+[^'"\n]*?\s+from\s+)['"]([^'"]+)['"]/g;
  for (const match of text.matchAll(re)) {
    const spec = match[1];
    if (!spec.startsWith('.')) continue;
    const resolved = path.resolve(path.dirname(entry), spec);
    if (fs.existsSync(resolved)) graph(resolved, seen);
  }
  return seen;
}

const graphSize = (entry) => {
  const files = [...graph(path.resolve(entry))];
  return { files: files.length, bytes: files.reduce((sum, file) => sum + bytes(file), 0) };
};

const manifest = JSON.parse(fs.readFileSync(path.join(html5, 'cache-manifest.json'), 'utf8'));
const sum = (urls) => urls.reduce((total, url) => total + bytes(fileOf(url)), 0);
const common = manifest.essential || [];
const pyodide = manifest.pyodide || [];

const workerCatalogs = [
  path.join(html5, 'static-server/engine/pve-compact.json'),
  ...manifest.assets.filter((url) => /^\/games\/bangbang\/html5\/m6_asset_catalog\.json\.part\d+\.json$/.test(url)).map(fileOf),
  path.join(html5, 'm8_garage_catalog.json'),
  ...fs.readdirSync(path.join(html5, 'static-server/engine/tanks'))
    .filter((name) => /^batch-.*-data\.json$/.test(name))
    .map((name) => path.join(html5, 'static-server/engine/tanks', name)),
];
const workerCatalogBytes = workerCatalogs.reduce((total, file) => total + bytes(file), 0);

const report = {
  cache: manifest.cache,
  assets: manifest.assets.length,
  essential: { files: common.length, bytes: sum(common), mib: mib(sum(common)) },
  pyodide: { files: pyodide.length, bytes: sum(pyodide), mib: mib(sum(pyodide)) },
  worker: {
    moduleGraph: graphSize(path.join(html5, 'static-server/worker.js')),
    pveCatalogsBytes: workerCatalogBytes,
    pveCatalogsMib: mib(workerCatalogBytes),
  },
  app: { moduleGraph: graphSize(path.join(html5, 'app.js')) },
};
console.log(JSON.stringify(report, null, 2));

if (process.argv.includes('--check')) {
  const failures = [];
  const essential = manifest.essential || [];
  if (!essential.includes('/games/bangbang/html5/shim.js')) failures.push('shim.js missing from essential');
  if (!essential.includes('/games/bangbang/html5/index.html')) failures.push('index.html missing from essential');
  if (essential.some((url) => /\/pyodide\/|bangbang-py\.zip/.test(url))) failures.push('Pyodide leaked into essential');
  if (!pyodide.some((url) => url.endsWith('bangbang-py.zip'))) failures.push('bangbang-py.zip missing from pyodide');
  if (!pyodide.some((url) => url.includes('/pyodide/pyodide.asm.wasm'))) failures.push('Pyodide wasm missing from pyodide');
  const sw = fs.readFileSync(path.resolve(root, 'sw.js'), 'utf8');
  if (!sw.includes(`'${manifest.cache}'`)) failures.push(`sw.js does not default to ${manifest.cache}`);
  if (failures.length) {
    console.error('perf checks failed:\n- ' + failures.join('\n- '));
    process.exit(1);
  }
  console.log('perf checks passed');
}

