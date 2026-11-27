const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../games/bangbang');
const query = 'm81345-inventory-click-fix-9e251171f0314e86641a';
const cache = 'bangbang-web-v7';
const assets = new Set();
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    const rel = path.relative(root, full).split(path.sep).join('/');
    if (rel === 'README.md' || rel === 'html5/cache-manifest.json') continue;
    if (rel.startsWith('html5/')) {
      const rest = rel.slice(6);
      const url = '/games/bangbang/html5/' + rest;
      assets.add(url);
      if (!rest.includes('/') && /\.(js|css)$/i.test(rest)) assets.add(url + '?v=' + query);
    } else if (rel.startsWith('rez/')) {
      assets.add('/games/bangbang/rez/' + rel.slice(4));
    }
  }
};
walk(root);
const essential = new Set([
  '/games/bangbang/html5/cache-manifest.json',
  '/games/bangbang/html5/offline.html',
  '/games/bangbang/html5/shim.js',
  '/games/bangbang/html5/offline-worker.js',
  '/games/bangbang/html5/m8_account_catalog.json',
  '/games/bangbang/html5/bangbang-py.zip',
  '/games/bangbang/html5/pyodide/pyodide.mjs',
  '/games/bangbang/html5/pyodide/pyodide.asm.mjs',
  '/games/bangbang/html5/pyodide/pyodide.asm.wasm',
  '/games/bangbang/html5/pyodide/python_stdlib.zip',
  '/games/bangbang/html5/pyodide/pyodide-lock.json',
  '/games/bangbang/html5/pyodide/pyodide.js',
]);
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'html5/m8_account_catalog.json'), 'utf8'));
for (const row of Object.values(catalog.assets || {})) {
  if (row && typeof row.url === 'string' && row.url.startsWith('/rez/')) {
    essential.add('/games/bangbang/rez/' + row.url.slice(5));
  }
}
for (const url of assets) {
  const name = new URL('http://x' + url).pathname;
  if (name.startsWith('/games/bangbang/html5/') && !name.slice('/games/bangbang/html5/'.length).includes('/') && /\.(js|css)$/.test(name)) essential.add(url);
}
const payload = {
  cache,
  version: 'v6',
  essential: [...essential].filter((url) => assets.has(url) || url.endsWith('cache-manifest.json')),
  assets: [...assets].sort(),
};
if (!payload.essential.includes('/games/bangbang/html5/cache-manifest.json')) payload.essential.push('/games/bangbang/html5/cache-manifest.json');
fs.writeFileSync(path.join(root, 'html5/cache-manifest.json'), JSON.stringify(payload, null, 2) + '\n');
console.log('cache manifest', payload.assets.length, 'assets', payload.essential.length, 'essential');
