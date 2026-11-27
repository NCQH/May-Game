import {assetImage,element} from './m8_ui_helpers.js';
import {M82OriginalMenuMovie} from './m82_swf_player.js';

/** Movie roots without animated children use lossless browser image playback.
 * Nested timelines use the exact decoded SWF in a pinned, offline asset player.
 * The original PNG/WebP remains the fallback if that player is unavailable.
 */
export function menuMovieSource(asset,{animate=true,enabled=true,reducedMotion=false,visible=true}={}) {
  if(!asset)return asset;
  const playing=Boolean(asset.animation&&animate&&enabled&&!reducedMotion&&visible);
  return {...asset,url:playing?asset.url:(asset.stillUrl||asset.url)};
}

export class M82MenuAnimations {
  constructor({maxNativeMovies=12}={}) {
    this.enabled=true;this.items=new Map();this.cleanupFrame=0;this.maxNativeMovies=maxNativeMovies;
    this.motion=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')||null;
    this.onVisibility=()=>this.refresh();this.onMotion=()=>this.refresh();
    globalThis.document?.addEventListener?.('visibilitychange',this.onVisibility);
    this.motion?.addEventListener?.('change',this.onMotion);
    if(globalThis.IntersectionObserver)this.observer=new IntersectionObserver(entries=>{
      for(const entry of entries){const item=this.items.get(entry.target);if(item)item.visible=entry.isIntersecting;}
      this.refresh();
    });
    if(globalThis.MutationObserver&&globalThis.document?.documentElement) {
      this.removals=new MutationObserver(()=>{if(this.items.size)this.scheduleCleanup();});
      this.removals.observe(document.documentElement,{childList:true,subtree:true});
    }
  }
  scheduleCleanup() {
    if(!this.cleanupFrame&&globalThis.requestAnimationFrame)this.cleanupFrame=requestAnimationFrame(()=>{
      this.cleanupFrame=0;this.refresh();
    });
  }
  image(asset,alt='',className='',{animate=true,fallbackElement=null,onFallbackState=null,nativePriority=0}={}) {
    const image=fallbackElement||assetImage(menuMovieSource(asset,{animate:false}),alt,asset?.nativeMovie&&animate?'':className);
    if(!asset?.animation||!animate)return image;
    image.loading='lazy';
    let host=image;
    if(asset.nativeMovie) {
      host=element('span',null,className);host.setAttribute('role','img');host.setAttribute('aria-label',alt);
      Object.assign(host.style,{position:'relative',display:'inline-block',width:`${asset.width}px`,height:`${asset.height}px`,
        overflow:'hidden',pointerEvents:'none'});
      Object.assign(image.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none'});
      host.append(image);
    }
    host.dataset.nativeMenuAnimation=asset.logical||asset.source?.logical||'';
    const item={host,image,asset,animate,visible:!this.observer,movie:null,state:'still',fallbackElement,onFallbackState,nativePriority};
    host.dataset.nativePriority=String(nativePriority);
    this.items.set(host,item);this.observer?.observe(host);this.scheduleCleanup();return host;
  }
  allowed(item) {
    return this.enabled&&item.animate&&item.visible&&!globalThis.document?.hidden&&!this.motion?.matches&&item.host.isConnected;
  }
  showImage(item,animate=false) {
    const source=menuMovieSource(item.asset,{animate});const url=source?.url||'';
    if(!item.fallbackElement&&item.image.getAttribute('src')!==url)item.image.src=url;
    item.image.style.visibility='';
    item.host.dataset.animationPlaying=String(animate&&Boolean(item.asset.fallbackAnimation??item.asset.animation));
    item.onFallbackState?.(animate&&Boolean(item.asset.fallbackAnimation??item.asset.animation));
  }
  nativeCount() {let n=0;for(const item of this.items.values())if(item.movie?.active)n++;return n;}
  update(item) {
    if(!this.allowed(item)) {
      item.movie?.stop();this.showImage(item,false);item.host.dataset.animationMode='still';return;
    }
    if(!item.asset.nativeMovie) {
      this.showImage(item,true);item.host.dataset.animationMode='webp';return;
    }
    if(!item.movie) {
      item.movie=new M82OriginalMenuMovie(item.host,item.asset,state=>{
        item.state=state;item.host.dataset.animationMode=state==='playing'?'native-swf':state;
        if(state==='playing'){item.image.style.visibility='hidden';item.host.dataset.animationPlaying='true';item.onFallbackState?.(false);}
        else this.showImage(item,state==='fallback'&&this.allowed(item));
      });
    }
    if(item.movie.failed) {this.showImage(item,true);item.host.dataset.animationMode='webp-fallback';return;}
    if(item.movie.active)return;
    if(item.nativeSlot!==false&&this.nativeCount()<this.maxNativeMovies)item.movie.start();
    else {this.showImage(item,true);item.host.dataset.animationMode='webp-capacity-fallback';}
  }
  refresh() {
    // Release invisible/removed players before allocating slots to new movies.
    for(const [host,item] of this.items) {
      if(!host.isConnected){item.movie?.dispose();this.showImage(item,false);this.observer?.unobserve(host);this.items.delete(host);}
      else if(!this.allowed(item))this.update(item);
    }
    const allowed=[...this.items.values()].filter(item=>this.allowed(item));
    // A selected/main portrait and a movie with masks/independent children must
    // not lose its slot merely because decorative chrome was inserted first.
    const candidates=allowed.filter(item=>item.asset.nativeMovie&&!item.movie?.failed)
      .sort((a,b)=>b.nativePriority-a.nativePriority);
    const allocated=new Set(candidates.slice(0,this.maxNativeMovies));
    for(const item of candidates){
      item.nativeSlot=allocated.has(item);
      if(!item.nativeSlot&&item.movie?.active)item.movie.stop();
    }
    for(const item of allowed)this.update(item);
  }
  setEnabled(enabled) {this.enabled=Boolean(enabled);this.refresh();}
  beforeReparent(root) {
    // A standard DOM move disconnects Ruffle's custom element and destroys its
    // player synchronously. Callers without state-preserving moveBefore must
    // explicitly rebuild it after attaching, rather than keep a blank instance.
    for(const item of this.items.values())if(root===item.host||root.contains?.(item.host))item.movie?.stop();
  }
  release(host) {
    const item=this.items.get(host);if(!item)return;
    item.movie?.dispose();this.showImage(item,false);this.observer?.unobserve(host);this.items.delete(host);
  }
  dispose() {
    if(this.cleanupFrame)cancelAnimationFrame(this.cleanupFrame);this.cleanupFrame=0;
    globalThis.document?.removeEventListener?.('visibilitychange',this.onVisibility);
    this.motion?.removeEventListener?.('change',this.onMotion);
    this.observer?.disconnect();this.removals?.disconnect();
    for(const item of this.items.values()){item.movie?.dispose();this.showImage(item,false);}this.items.clear();
  }
}
