import {loadLocalRuffleRuntime,destroyLocalRufflePlayer,rememberLocalRuffleContexts} from './m82_swf_player.js';
import {bindCrystalRewardIcons,crystalQualityFrame} from './m84_crystal_reward_data.js';
import {NativeEffectClock} from './m83_effect_timeline.js';
import {crystalRewardLayout,positionCrystalRewardLayer} from './m88_crystal_reward_layout.js';

// Catalog flags cannot authorize an arbitrary scripted SWF. These exact two
// source-audited viewing copies differ only in the native consumer's branch.
// M18 replaces the eleven empty LV5 bitmap/shape pairs with supplied Flash
// PNGs; every script, placement, sprite and timeline byte remains unchanged.
// M30 adds only three display tags: the exact existing craft backdrop PNG,
// its bitmap shape and unused depth0 placement. Native ADD/OVERLAY artwork
// must blend against that backdrop, not an isolated transparent WebGL canvas.
// Every M18 script, sprite, holder and frame remains byte-identical.
const CATALOG_SHA='ab7f7b6e293a2c329bf0b526ae70e8940501113896dbdfb707f4b78eef38e506';
const MOVIE_PINS=Object.freeze({
  one:'28c3c82b1fe05957256c54fcbff32501e3406c0637d31a4832dbd48e10d8deed',
  five:'3fcf6cf897b85cf0d3d23e762dc1c40c9a8091a5fdb9f9ec9db422cbede88cc0',
});
const COMPLETE='M84_CRYSTAL_REWARD_COMPLETE';
const ROOT=new URL('./',import.meta.url);
const RUFFLE_ROOT=new URL('./vendor_m82/ruffle-0.7.1/',import.meta.url);
let catalogPromise;

async function digest(data){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');}
async function verifiedBytes(asset,kind,signal,pin=asset.sha256) {
  const url=new URL(asset.url,ROOT);
  const suffix=kind==='movies'?'swf':'png';
  const namespace=kind==='movies'?'assets/m81330/crystals':'assets_m84/crystals';
  if(url.origin!==location.origin||url.pathname!==`/html5/${namespace}/${kind}/${pin}.${suffix}`||asset.sha256!==pin)
    throw new Error('Unexpected crystal presentation resource.');
  const response=await fetch(url,{signal,cache:'force-cache',credentials:'same-origin'});
  if(!response.ok)throw new Error('Crystal presentation resource is unavailable.');
  const bytes=await response.arrayBuffer();
  if(bytes.byteLength!==asset.bytes||await digest(bytes)!==pin)throw new Error('Crystal presentation resource changed.');
  return bytes;
}
function rewardCatalog() {
  return catalogPromise ||= (async()=>{
    const url=new URL('m81330_crystal_reward_catalog.json',ROOT);url.searchParams.set('v',CATALOG_SHA);
    const response=await fetch(url,{cache:'force-cache',credentials:'same-origin'});
    if(!response.ok)throw new Error('Crystal reward catalog is unavailable.');
    const bytes=await response.arrayBuffer();
    if(await digest(bytes)!==CATALOG_SHA)throw new Error('Crystal reward catalog changed.');
    return JSON.parse(new TextDecoder().decode(bytes));
  })().catch(error=>{catalogPromise=null;throw error;});
}

export const M84_CRYSTAL_REWARD_STYLE=`
.m84-crystal-reward{position:absolute;left:0;top:0;width:1440px;height:900px;z-index:40;outline:0;pointer-events:auto}
.m84-crystal-reward .cr-reward-movie,.m84-crystal-reward-quality{position:absolute;inset:0;width:1440px;height:900px;pointer-events:none}
.m84-crystal-reward-quality{mix-blend-mode:plus-lighter;z-index:41}
.m84-crystal-reward .cr-reward-confirm{position:absolute;top:478px;left:50%;transform:translateX(-50%);padding:0;border:0;border-radius:0;background-color:transparent;background-size:100% 100%;box-shadow:none;color:transparent;font-size:0;cursor:pointer}
.m84-crystal-reward .cr-reward-confirm:focus-visible{outline:2px solid #ffe88a;outline-offset:2px}
.m84-crystal-reward .cr-reward-status{position:absolute;left:580px;top:540px;width:280px;text-align:center;color:white;font:14px Tahoma,sans-serif;text-shadow:0 1px 3px #001c2d}
.m84-crystal-reward .cr-reward-item-hit{position:absolute;width:75px;height:75px;padding:0;border:0;background:transparent;pointer-events:auto}
.m84-crystal-reward .cr-reward-fallback-icon{position:absolute;pointer-events:none}
`;

/** One accepted native craft result. Owns a stable ancestor tree until close. */
export class M84CrystalReward {
  constructor({items,catalog,assets,onClose=()=>{}}) {
    this.items=items.map(row=>({...row}));this.itemCatalog=catalog;this.assets=assets;this.onClose=onClose;
    this.disposed=false;this.started=false;this.complete=false;this.serial=0;this.qualityImages=new Map();
    this.root=document.createElement('section');this.root.className='m84-crystal-reward';
    this.root.setAttribute('role','dialog');this.root.setAttribute('aria-modal','true');
    this.root.setAttribute('aria-label','Tinh thể vừa chế tạo');this.root.tabIndex=-1;
    this.root.dataset.testid='cr-reward';this.root.dataset.state='loading';
    this.root.dataset.awards=JSON.stringify(this.items);this.root.dataset.branch=items.length>1?'five':'one';
    this.movieHost=document.createElement('div');this.movieHost.className='cr-reward-movie';
    this.status=document.createElement('div');this.status.className='cr-reward-status';
    this.status.setAttribute('role','status');this.status.setAttribute('aria-live','polite');this.status.textContent='Đang mở tinh thể…';
    this.confirm=document.createElement('button');this.confirm.type='button';this.confirm.className='cr-reward-confirm';
    this.confirm.dataset.testid='cr-reward-confirm';this.confirm.textContent='Nhận';this.confirm.setAttribute('aria-label','Nhận');
    const art=assets?.get?.('crystal.rewardConfirm');
    if(art)Object.assign(this.confirm.style,{backgroundImage:`url("${art.url}")`,width:art.width+'px',height:art.height+'px'});
    else Object.assign(this.confirm.style,{fontSize:'14px',color:'white',width:'100px',height:'30px',backgroundColor:'#176493'});
    this.confirm.hidden=true;this.confirm.addEventListener('click',()=>{if(this.complete&&!this.disposed)this.onClose();});
    this.root.append(this.movieHost,this.status,this.confirm);
    this.root.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.stopPropagation();if(this.complete)this.onClose();}
      if(event.key==='Tab'){event.preventDefault();(this.complete?this.confirm:this.root).focus({preventScroll:true});}
    });
  }

  async start() {
    if(this.started||this.disposed||!this.root.isConnected)return;
    this.started=true;const serial=++this.serial;this.controller=new AbortController();
    let player;
    try {
      const [catalog,runtime]=await Promise.all([rewardCatalog(),loadLocalRuffleRuntime()]);
      if(this.disposed||serial!==this.serial)return;
      this.catalog=catalog;const branch=this.root.dataset.branch,template=catalog.templates[branch];
      const input=await verifiedBytes(template,'movies',this.controller.signal,MOVIE_PINS[branch]);
      if(this.disposed||serial!==this.serial)return;
      const bytes=bindCrystalRewardIcons(input,this.items,catalog);
      this.root.dataset.sourceStartFrame=String(template.sourceStartFrame);
      this.root.dataset.sourceEndFrame=String(template.sourceEndFrame);
      this.root.dataset.sourceSha256=catalog.source.rootSourceSha256;
      player=runtime.createPlayer();this.player=player;player.tabIndex=-1;player.setAttribute('aria-hidden','true');
      Object.assign(player.style,{position:'absolute',inset:'0',width:'100%',height:'100%',display:'block',
        visibility:'hidden',pointerEvents:'none',background:'transparent'});
      this.movieHost.append(player);const api=player.ruffle(1);let readyOnce=false;
      const observe=value=>{if(String(value).trim()===COMPLETE&&!this.disposed&&serial===this.serial)this.finish('native-complete');};
      const ready=()=>{
        if(readyOnce||this.disposed||serial!==this.serial)return;readyOnce=true;
        api.traceObserver=observe;api.volume=0;player.style.visibility='visible';api.resume();
        this.root.dataset.state='playing';this.root.dataset.startedAt=String(performance.now());
        this.status.textContent='';this.root.focus({preventScroll:true});
      };
      player.addEventListener('loadeddata',()=>{rememberLocalRuffleContexts(player);ready();},{once:true});
      await api.load({data:bytes,swfFileName:'crystal_reward.swf',publicPath:RUFFLE_ROOT.href,
        autoplay:'off',unmuteOverlay:'hidden',splashScreen:false,contextMenu:'off',showSwfDownload:false,
        allowFullscreen:false,allowScriptAccess:false,allowNetworking:'none',openUrlMode:'deny',
        polyfills:false,compatibilityRules:false,backgroundExecutionMode:'suspend',wmode:'transparent',
        letterbox:'off',scale:'showAll',salign:'LT',forceScale:true,forceAlign:true,logLevel:'error'});
      rememberLocalRuffleContexts(player);
      if(this.disposed||serial!==this.serial){destroyLocalRufflePlayer(player);return;}
      api.traceObserver=observe;if(api.readyState>=2)ready();
      // Quality is decorative and never delays or changes the accepted reward.
      this.prepareQuality(serial).catch(error=>{if(!this.disposed)this.root.dataset.qualityError=String(error.message||error);});
    }catch(error){
      if(player)destroyLocalRufflePlayer(player);
      if(!this.disposed&&serial===this.serial){this.player=null;this.fallback(error);}
    }
  }

  setViewport(width,height,content) {
    this.layout=crystalRewardLayout(width,height,content);
    positionCrystalRewardLayer(this.root,this.layout);
    if(this.qualityCanvas)positionCrystalRewardLayer(this.qualityCanvas,this.layout);
    this.root.dataset.viewport=`${width}x${height}`;
  }

  async prepareQuality(serial) {
    const levels=[...new Set(this.items.map(row=>this.itemCatalog.items[row.itemId]?.level).filter(level=>level>=4))];
    for(const level of levels) {
      const resource=this.catalog.quality[level];if(!resource)continue;
      const bytes=await verifiedBytes(resource.atlas,'quality',this.controller.signal);
      const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
      if(this.disposed||serial!==this.serial){bitmap.close();return;}
      this.qualityImages.set(level,bitmap);
    }
    if(this.complete)this.startQuality();
  }

  finish(state) {
    if(this.disposed||this.complete)return;
    this.complete=true;this.root.dataset.state=state;this.root.dataset.completedAt=String(performance.now());
    this.confirm.hidden=false;this.status.textContent='';
    if(this.catalog)for(const [index,row] of this.items.entries()) {
      const holder=this.catalog.holders[index],item=this.itemCatalog.items[row.itemId];
      const hit=document.createElement('span');hit.className='cr-reward-item-hit';
      hit.title=`${item.name} ×${row.count}\n${item.description||''}`;hit.setAttribute('aria-label',`${item.name} ×${row.count}`);
      Object.assign(hit.style,{left:(457+holder.x)+'px',top:(59+holder.y)+'px'});this.root.append(hit);
    }
    this.startQuality();this.confirm.focus({preventScroll:true});
  }

  startQuality() {
    if(this.disposed||this.qualityFrame||!this.qualityImages.size)return;
    const canvas=document.createElement('canvas');canvas.width=1440;canvas.height=900;canvas.className='m84-crystal-reward-quality';
    // Blend with the real craft backdrop as well as the movie. A canvas inside
    // the modal's stacking context would composite additive black against
    // transparency outside the SWF, producing dark rectangles on the stage.
    canvas.setAttribute('aria-hidden','true');this.root.parentElement.append(canvas);this.qualityCanvas=canvas;
    if(this.layout)positionCrystalRewardLayer(canvas,this.layout);
    const ctx=canvas.getContext('2d');if(!ctx)return;
    const clock=new NativeEffectClock();let drawnTick=-1;
    const draw=now=>{
      if(this.disposed)return;
      const ticks=document.hidden?drawnTick:clock.sample(now);
      if(ticks!==drawnTick){
        ctx.clearRect(0,0,1440,900);ctx.globalCompositeOperation='lighter';
        for(const [index,row] of this.items.entries()) {
          const level=this.itemCatalog.items[row.itemId]?.level,image=this.qualityImages.get(level),resource=this.catalog.quality[level];
          if(!image||!resource)continue;
          const frame=resource.frames[crystalQualityFrame(ticks,resource)],holder=this.catalog.holders[index];
          ctx.drawImage(image,frame.x,frame.y,frame.width,frame.height,
            457+holder.x+resource.viewport[0],59+holder.y+resource.viewport[1],frame.width,frame.height);
        }
        drawnTick=ticks;this.root.dataset.qualityTicks=String(ticks);
      }
      this.qualityFrame=requestAnimationFrame(draw);
    };
    this.qualityFrame=requestAnimationFrame(draw);
  }

  fallback(error) {
    this.root.dataset.presentationError=String(error?.message||error);
    const holders=this.catalog?.holders||[{x:223,y:134},{x:86.5,y:208},{x:359.45,y:206.8},{x:33.05,y:335.95},{x:427.5,y:335.05}];
    for(const [index,row] of this.items.entries()) {
      const item=this.itemCatalog.items[row.itemId],img=document.createElement('img'),holder=holders[index];
      img.src=item.icon.url;img.alt=`${item.name} ×${row.count}`;img.className='cr-reward-fallback-icon';
      Object.assign(img.style,{left:(457+holder.x)+'px',top:(59+holder.y)+'px',width:(item.icon.width*.75)+'px',height:(item.icon.height*.75)+'px'});
      this.movieHost.append(img);
    }
    this.finish('still-fallback');
  }

  dispose() {
    if(this.disposed)return;this.disposed=true;++this.serial;this.controller?.abort();
    if(this.qualityFrame)cancelAnimationFrame(this.qualityFrame);this.qualityFrame=0;
    this.qualityCanvas?.remove();this.qualityCanvas=null;
    destroyLocalRufflePlayer(this.player);this.player=null;
    for(const image of this.qualityImages.values())image.close?.();this.qualityImages.clear();
    this.root.remove();this.onClose=()=>{};
  }
}
