#!/usr/bin/env node
// COOP/COEP local server for the BangBang perf smoke. The Playwright dev server
// does not send cross-origin isolation headers, so SharedArrayBuffer is absent.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../../../..');
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
  '.zip': 'application/zip', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

function resolvePath(pathname) {
  let url = decodeURIComponent(pathname.split('?')[0]);
  if (url === '/sw.js') return path.join(root, 'sw.js');
  if (url.startsWith('/games/bangbang/')) return path.join(root, url.slice(1));
  if (url.startsWith('/html5/')) return path.join(root, 'games/bangbang/html5', url.slice(7));
  if (url.startsWith('/rez/')) return path.join(root, 'games/bangbang/rez', url.slice(5));
  return path.join(root, url.slice(1));
}

function createServer() {
  return http.createServer((request, response) => {
    let file = resolvePath(request.url || '/');
    if (file.endsWith(path.sep) || (fs.existsSync(file) && fs.statSync(file).isDirectory())) file = path.join(file, 'index.html');
    file = path.resolve(file);
    if (!file.startsWith(root + path.sep) && file !== root) { response.writeHead(403).end(); return; }
    fs.stat(file, (error, stat) => {
      if (error || !stat.isFile()) { response.writeHead(404).end('not found'); return; }
      const ext = path.extname(file).toLowerCase();
      const headers = {
        'Content-Type': types[ext] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Cache-Control': /\.(html|webmanifest)$/.test(file) || file.endsWith('/sw.js')
          ? 'no-cache' : 'public, max-age=3600',
      };
      if (file.endsWith('/sw.js')) headers['Service-Worker-Allowed'] = '/';
      response.writeHead(200, headers);
      fs.createReadStream(file).pipe(response);
    });
  });
}

if (require.main === module) {
  const port = Number(process.env.PERF_PORT || 4199);
  createServer().listen(port, '127.0.0.1', () => console.log('perf server http://127.0.0.1:' + port));
}

module.exports = { createServer, root };
