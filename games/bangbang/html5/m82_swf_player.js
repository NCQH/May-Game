/** Pinned offline Ruffle is used for original menu artwork.
 * UI, networking, game state and combat remain in the HTML5 client.
 */
const RUFFLE_ROOT=new URL('./vendor_m82/ruffle-0.7.1/',import.meta.url);
// Pin the delivered M84 load-cancellation build, including browser cache keys.
const RUFFLE_SCRIPT_SHA256='a4f9c0ab1ce5998844634195cccbb1b0c5ca2e7321126fbd5bb3a1f37aca3236';
// The only scripted movie is the audited double_exp display mask. Its sole
// _fla.MainTimeline.frame1 executes `this.B; mask=this.A;`. The exact derived
// bytes are pinned here; a catalog flag cannot authorize another script.
const DISPLAY_MASK_MOVIE='a72c6f5f991ab8502810bee230c06e7cc5702cd8df4dd160e3fdbca4adecb2a6';
let runtimePromise;
const playerContexts=new WeakMap();

function localRuffle() {
  const source=globalThis.RufflePlayer?.sources?.local;
  if(!/^0\.7\.1\+2026-10-07$/.test(source?.version||''))throw new Error('Unexpected menu movie runtime.');
  return source;
}

function loadRuntime() {
  if(runtimePromise)return runtimePromise;
  runtimePromise=new Promise((resolve,reject)=>{
    const previous=globalThis.RufflePlayer||{};
    previous.config={...(previous.config||{}),polyfills:false,publicPath:RUFFLE_ROOT.href};
    globalThis.RufflePlayer=previous;
    const script=document.createElement('script'),url=new URL('ruffle.js',RUFFLE_ROOT);
    url.searchParams.set('v',RUFFLE_SCRIPT_SHA256);script.src=url.href;
    script.integrity='sha256-pPnAqxzlmYhEY0GVzMuxsMXKLnMhEm+9W7Oh83rKMjY=';
    script.async=true;script.dataset.m82Runtime='ruffle-0.7.1';
    script.onload=()=>{try{resolve(localRuffle());}catch(error){reject(error);}};
    script.onerror=()=>reject(new Error('Could not load the offline menu movie runtime.'));
    document.head.append(script);
  });
  return runtimePromise;
}

async function originalBytes(movie,signal) {
  const url=new URL(movie.url,document.baseURI);
  const localMovie=/^\/html5\/(?:assets_m82\/movies|assets_m83\/portrait\/movies|assets_m84\/panels\/movies|assets\/m81314(?:_presentation)?\/native_movies)\/[a-f0-9]{64}\.swf$/.test(url.pathname);
  if(url.origin!==location.origin||!localMovie)throw new Error('Non-local menu movie.');
  if(movie.scriptTagTypes?.length&&movie.sha256!==DISPLAY_MASK_MOVIE)throw new Error('Unaudited script in menu artwork.');
  const response=await fetch(url,{signal,cache:'force-cache',credentials:'same-origin'});
  if(!response.ok)throw new Error(`Could not load menu artwork (${response.status}).`);
  const data=await response.arrayBuffer();
  if(data.byteLength!==movie.bytes)throw new Error('Menu artwork length mismatch.');
  if(!globalThis.crypto?.subtle)throw new Error('Menu artwork verification is unavailable.');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');
  if(hash!==movie.sha256)throw new Error('Menu artwork hash mismatch.');
  return data;
}

function rememberPlayerContexts(player) {
  if(!player)return [];
  // Disconnect frees the WASM player/resources but browsers can retain its
  // WebGL context until GC. Repeated selection/loading screens then evict the
  // older battle context. Release only canvases owned by this retired movie,
  // after the normal player disconnect; never touch the battle surface.
  const contexts=playerContexts.get(player)||[];
  for(const canvas of player.shadowRoot?.querySelectorAll('canvas')||[]) {
    try {
      const gl=canvas.getContext('webgl2')||canvas.getContext('webgl');
      if(gl&&!contexts.includes(gl))contexts.push(gl);
    } catch { /* A non-GL movie canvas needs no explicit GPU release. */ }
  }
  playerContexts.set(player,contexts);return contexts;
}

function destroyPlayer(player) {
  if(!player)return;
  // Capture at readiness as well: custom-element disconnect may already have
  // removed its canvas before the owner's MutationObserver disposes the item.
  const contexts=rememberPlayerContexts(player);
  try{player.ruffle(1).suspend();}catch{}
  // Ruffle 0.7.1's documented custom element disconnect lifecycle destroys its
  // WASM player. If a load completed after its parent was removed, give the
  // element one real disconnect so the newly created instance is also freed.
  if(!player.isConnected&&document.body) {
    const disposal=document.createElement('span');disposal.hidden=true;
    document.body.append(disposal);disposal.append(player);player.remove();disposal.remove();
  } else player.remove();
  for(const gl of contexts) {
    try{gl.getExtension('WEBGL_lose_context')?.loseContext();}catch{}
  }
  playerContexts.delete(player);
}

// Shared offline runtime/lifecycle only. Callers retain their own exact asset
// allowlist and must not route scripted movies through originalBytes().
export {loadRuntime as loadLocalRuffleRuntime,destroyPlayer as destroyLocalRufflePlayer,
  rememberPlayerContexts as rememberLocalRuffleContexts};

export class M82OriginalMenuMovie {
  constructor(host,asset,onState=()=>{}) {
    this.host=host;this.asset=asset;this.onState=onState;this.serial=0;
    this.active=false;this.failed=false;this.player=null;this.loading=null;
  }
  async start() {
    if(this.active||this.failed)return;
    this.active=true;const serial=++this.serial;this.controller=new AbortController();
    this.onState('loading');
    let player;
    const operation=(async()=>{
      try {
        const [runtime,data]=await Promise.all([loadRuntime(),originalBytes(this.asset.nativeMovie,this.controller.signal)]);
        if(serial!==this.serial||!this.active||!this.host.isConnected)return;
        player=runtime.createPlayer();this.player=player;
        player.tabIndex=-1;player.setAttribute('aria-hidden','true');
        Object.assign(player.style,{position:'absolute',inset:'0',display:'block',width:'100%',height:'100%',
          pointerEvents:'none',visibility:'hidden',background:'transparent'});
        this.host.append(player);
        const api=player.ruffle(1);
        const ready=()=>{
          rememberPlayerContexts(player);
          if(serial!==this.serial||!this.active||!this.host.isConnected)return;
          player.style.visibility='visible';api.volume=0;api.resume();this.onState('playing');
        };
        player.addEventListener('loadeddata',ready,{once:true});
        await api.load({data,swfFileName:this.asset.logical?.split('/').pop()||'menu.swf',
          publicPath:RUFFLE_ROOT.href,autoplay:'on',unmuteOverlay:'hidden',splashScreen:false,
          contextMenu:'off',showSwfDownload:false,allowFullscreen:false,allowScriptAccess:false,
          allowNetworking:'none',openUrlMode:'deny',polyfills:false,compatibilityRules:false,
          backgroundExecutionMode:'suspend',wmode:'transparent',letterbox:'off',
          scale:'showAll',salign:'LT',forceScale:true,forceAlign:true,logLevel:'error'});
        rememberPlayerContexts(player);
        if(serial!==this.serial||!this.active||!this.host.isConnected){destroyPlayer(player);return;}
        if(api.readyState>=2)ready();
      } catch(error) {
        if(player)destroyPlayer(player);
        if(serial!==this.serial||!this.active)return;
        this.failed=true;this.active=false;this.player=null;
        this.host.dataset.nativeMovieError=String(error?.message||error);
        this.onState('fallback');
      } finally {
        if(serial!==this.serial&&player)destroyPlayer(player);
        if(this.loading===operation)this.loading=null;
      }
    })();
    this.loading=operation;return operation;
  }
  stop() {
    if(!this.active&&!this.player)return;
    this.active=false;++this.serial;this.controller?.abort();
    const player=this.player;this.player=null;if(player)destroyPlayer(player);
    this.onState('still');
  }
  dispose(){this.stop();this.onState=()=>{};}
}
