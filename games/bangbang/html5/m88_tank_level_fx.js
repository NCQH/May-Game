/** UI1 PrositTankUpView. Native pixels and the audited light.swf AS2 script.
 * The effect never changes a tank, grants a skin, or infers server success.
 */
import {nativeTankHalo} from './m83_tank_presentation.js';

const CATALOG_SHA='a63803ad3154fb1b42a3a35b6907e940a31e68818093522817d9ce42f50dc766';
const ROOT=new URL('./',import.meta.url);
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),
  value=>value.toString(16).padStart(2,'0')).join('');
let catalogPromise;

export function acknowledgedTankAdvance(before,packet,maxLevel=6) {
  const after=packet?.tank;
  if(packet?.type!=='tankInstanceUpdated'||packet.op!==2||!before?.uuid||!after
      ||after.uuid!==before.uuid||after.tankId!==before.tankId
      ||!Number.isInteger(before.level)||after.level!==before.level+1
      ||after.level>maxLevel||before.containerType!==0||after.containerType!==0)return null;
  return {...after};
}

export async function prepareTankLevelEffect() {
  return catalogPromise||=(async()=>{
    const url=new URL('m88_tank_level_catalog.json',ROOT);url.searchParams.set('v',CATALOG_SHA);
    const response=await fetch(url,{cache:'force-cache',credentials:'same-origin'});
    if(!response.ok)throw new Error('Chưa tải được hiệu ứng thăng cấp gốc.');
    const bytes=await response.arrayBuffer();
    if(await digest(bytes)!==CATALOG_SHA)throw new Error('Hiệu ứng thăng cấp không khớp bản gốc.');
    return JSON.parse(new TextDecoder().decode(bytes));
  })().catch(error=>{catalogPromise=null;throw error;});
}

async function verifiedImage(asset,signal) {
  const url=new URL(asset.url,ROOT);
  if(url.origin!==location.origin||url.pathname!==`/html5/assets_m88/tank_level_up/${asset.sha256}.png`)
    throw new Error('Tài nguyên thăng cấp không hợp lệ.');
  const response=await fetch(url,{signal,cache:'force-cache',credentials:'same-origin'});
  if(!response.ok)throw new Error('Chưa tải được hình thăng cấp gốc.');
  const bytes=await response.arrayBuffer();
  if(bytes.byteLength!==asset.bytes||await digest(bytes)!==asset.sha256)
    throw new Error('Hình thăng cấp không khớp bản gốc.');
  return createImageBitmap(new Blob([bytes],{type:'image/png'}));
}

/** Port of light.swf frame1.light():59 original rays,100ms interval. */
export function updateNativeLevelRays(previous,random=Math.random) {
  const int=n=>Math.floor(Math.max(0,Math.min(1-Number.EPSILON,random()))*n);
  return Array.from({length:59},(_,index)=>previous?
    {alpha:int(60)/100,rotation:previous[index].rotation+int(10)+1}:
    {alpha:int(80)/100,rotation:int(360)});
}

function imageResources(...roots) {
  const result=[],seen=new Set();
  const visit=value=>{
    if(!value||typeof value!=='object'||seen.has(value))return;seen.add(value);
    if(value.url&&/\.(png|jpe?g|webp)(?:$|[?#])/i.test(value.url))result.push(value);
    for(const child of Object.values(value))visit(child);
  };
  roots.forEach(visit);return result;
}

export class M88TankLevelEffect {
  constructor({tank,externalId,assets,onStart=()=>{},onFinish=()=>{}}) {
    this.tank={...tank};this.externalId=externalId;this.assets=assets;this.onStart=onStart;this.onFinish=onFinish;
    this.disposed=false;this.started=false;this.controller=new AbortController();
    this.root=document.createElement('section');this.root.className='m88-tank-level-effect';
    Object.assign(this.root.style,{position:'absolute',inset:'0',width:'1000px',height:'600px',
      zIndex:'60',pointerEvents:'none',overflow:'visible',visibility:'hidden'});
    this.root.dataset.testid='garage-level-effect';this.root.dataset.state='loading';
    this.root.dataset.tankUuid=tank.uuid;this.root.dataset.level=String(tank.level);
    this.root.setAttribute('role','status');this.root.setAttribute('aria-live','polite');
    this.root.setAttribute('aria-label',`Chúc mừng thăng cấp tank lên cấp ${tank.level}!`);
  }
  async start() {
    if(this.started||this.disposed)return;this.started=true;
    let beam,label;
    try {
      const catalog=await prepareTankLevelEffect();
      if(this.disposed)return;this.catalog=catalog;
      const halo=nativeTankHalo(this.assets.presentation,this.tank);
      const portraitSource=this.assets.hud?.portraits?.[this.externalId];
      const images=await Promise.allSettled([
        verifiedImage(catalog.rays.asset,this.controller.signal),
        verifiedImage(catalog.label.asset,this.controller.signal),
        this.assets.preloadImages?.(imageResources(portraitSource,this.assets.hud?.effects?.[portraitSource?.effect],halo)),
      ]);
      beam=images[0].status==='fulfilled'?images[0].value:null;
      label=images[1].status==='fulfilled'?images[1].value:null;
      if(this.disposed){beam?.close();label?.close();return;}
      if(!beam||!label){beam?.close();label?.close();throw new Error('Chưa tải đủ hình thăng cấp.');}
      this.beam=beam;this.label=label;
      this.raysCanvas=document.createElement('canvas');this.labelCanvas=document.createElement('canvas');
      for(const canvas of [this.raysCanvas,this.labelCanvas]) {
        canvas.width=1000;canvas.height=600;canvas.setAttribute('aria-hidden','true');
        Object.assign(canvas.style,{position:'absolute',inset:'0',width:'1000px',height:'600px'});
      }
      this.raysCanvas.style.mixBlendMode='overlay';
      // A fresh view of precisely the acknowledged instance. Level6 uses the
      // existing original bottom/surface master halo through InitTankAvatarProxy.
      this.portrait=this.assets.createPortrait(this.externalId,{size:200,tank:this.tank,animate:true});
      Object.assign(this.portrait.style,{position:'absolute',left:'400px',top:'200px'});
      this.root.append(this.raysCanvas,this.portrait,this.labelCanvas);
      this.root.dataset.haloId=this.portrait.dataset.nativeHaloId||'0';
      this.root.style.visibility='visible';this.root.dataset.state='playing';
      this.assets.menuAnimations?.refresh?.();
      this.begun=performance.now();this.root.dataset.startedAt=String(this.begun);
      this.onStart();
      this.reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.draw(this.begun);
      this.timeout=setTimeout(()=>this.finish(),catalog.durationMs);
    }catch(error) {
      if(!this.disposed){this.root.dataset.presentationError=String(error?.message||error);this.finish();}
    }
  }
  draw(now) {
    if(this.disposed)return;
    const elapsed=Math.max(0,now-this.begun),catalog=this.catalog;
    const rayTick=Math.min(20,Math.floor(elapsed/100));
    if(!this.reducedMotion&&rayTick!==(this.rayTick||0)) {
      for(let tick=this.rayTick||0;tick<rayTick;tick++)this.rays=updateNativeLevelRays(this.rays);
      this.rayTick=rayTick;
      const ctx=this.raysCanvas.getContext('2d');
      if(ctx) {
        ctx.clearRect(0,0,1000,600);ctx.save();
        // SWFLoader.doScaleContent:860/400, measured LoaderInfo stage size.
        ctx.translate(70+199.5*2.15,-130+199.3*2.15);ctx.scale(2.15,2.15);
        ctx.globalCompositeOperation='overlay';
        for(const ray of this.rays||[]) {
          ctx.save();ctx.globalAlpha=ray.alpha;ctx.rotate(ray.rotation*Math.PI/180);
          ctx.drawImage(this.beam,-333.4,-253.5,333.4,253.5);ctx.restore();
        }
        ctx.restore();
      }
    }
    const frame=this.reducedMotion?14:Math.floor(elapsed*24/1000)%catalog.label.frameCount;
    if(frame!==this.labelFrame) {
      this.labelFrame=frame;this.root.dataset.sourceFrame=String(frame+1);
      const ctx=this.labelCanvas.getContext('2d');
      if(ctx){ctx.clearRect(0,0,1000,600);ctx.drawImage(this.label,(frame%7)*400,Math.floor(frame/7)*200,
        400,200,300,84,400,200);}
    }
    if(!this.reducedMotion)this.animation=requestAnimationFrame(time=>this.draw(time));
  }
  finish() {
    if(this.disposed)return;const finish=this.onFinish;this.dispose();finish();
  }
  dispose() {
    if(this.disposed)return;this.disposed=true;this.controller.abort();clearTimeout(this.timeout);
    cancelAnimationFrame(this.animation);this.portrait?.dispose?.();this.beam?.close();this.label?.close();
    this.root.remove();this.onStart=()=>{};this.onFinish=()=>{};
  }
}
