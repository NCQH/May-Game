const http=require('http'),fs=require('fs'),path=require('path');
const root=require('path').resolve(__dirname, '../..');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.wasm':'application/wasm','.zip':'application/zip','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.mp3':'audio/mpeg','.ogg':'audio/ogg','.swf':'application/x-shockwave-flash','.xml':'application/xml','.txt':'text/plain; charset=utf-8','.ico':'image/x-icon'};
http.createServer((req,res)=>{
 let p=decodeURIComponent((req.url||'/').split('?')[0]);
 let file;
 if(p==='/sw.js') file=path.join(root,'sw.js');
 else if(p.startsWith('/html5/')) file=path.join(root,'games/bangbang/html5',p.slice(7));
 else if(p.startsWith('/rez/')) file=path.join(root,'games/bangbang/rez',p.slice(5));
 else file=path.join(root,'.'+p);
 if(p.endsWith('/')) file=path.join(file,'index.html');
 file=path.resolve(file);
 if(!file.startsWith(path.resolve(root))){res.writeHead(403);res.end();return;}
 fs.stat(file,(err,st)=>{
  if(err||!st.isFile()){res.writeHead(404);res.end('not found');return;}
  const h={'Content-Type':types[path.extname(file).toLowerCase()]||'application/octet-stream','Content-Length':st.size,'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'cross-origin','Cache-Control':'no-store'};
  if(p==='/sw.js') h['Service-Worker-Allowed']='/';
  res.writeHead(200,h); fs.createReadStream(file).pipe(res);
 });
}).listen(18086,'127.0.0.1',()=>console.log('trim2 18086'));
