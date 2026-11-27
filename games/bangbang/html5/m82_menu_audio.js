// SettingsAudioProxy defaults; SystemSetModel keeps these preferences locally.
export const MENU_AUDIO_DEFAULTS=Object.freeze({musicOn:true,effectsOn:true,musicVolume:50,effectsVolume:60});
const STORAGE_KEY='bangbang.html5.audio.v1';
export function menuAudioPreferences(value={}) {
  const volume=(key)=>Number.isFinite(Number(value[key]))?Math.max(0,Math.min(100,Math.round(Number(value[key])))):MENU_AUDIO_DEFAULTS[key];
  return {musicOn:typeof value.musicOn==='boolean'?value.musicOn:true,effectsOn:typeof value.effectsOn==='boolean'?value.effectsOn:true,
    musicVolume:volume('musicVolume'),effectsVolume:volume('effectsVolume')};
}
export class M82MenuAudio {
  constructor({host,storage}={}) {
    this.host=host;this.disposed=false;this.active=true;this.unlocked=false;this.screen='boot';this.phase='lobby';this.voices=new Set();
    this.stats={musicStarts:0,effectsPlayed:0,blocked:0,missing:0};this.storageSaved=true;
    try{this.storage=storage??globalThis.localStorage;this.preferences=menuAudioPreferences(JSON.parse(this.storage?.getItem(STORAGE_KEY)||'{}'));}
    catch{this.preferences={...MENU_AUDIO_DEFAULTS};this.storageSaved=false;}
    this.onGesture=()=>{if(!this.active||this.disposed)return;this.unlocked=true;this.sync();};
    this.onClick=event=>{const button=event.target?.closest?.('button');if(button&&!button.disabled&&this.host?.contains(button))this.effect('common');};
    this.onVisibility=()=>{this.sync();if(globalThis.document?.hidden)this.stopEffects();};
    host?.addEventListener('pointerdown',this.onGesture,{capture:true});host?.addEventListener('keydown',this.onGesture,{capture:true});host?.addEventListener('click',this.onClick,{capture:true});
    globalThis.document?.addEventListener('visibilitychange',this.onVisibility);
    this.ready=typeof globalThis.document==='undefined'?Promise.resolve():fetch('./m82_audio_catalog.json',{cache:'no-store'}).then(async response=>{
      if(!response.ok)throw new Error('Audio catalog unavailable');this.catalog=await response.json();if(!this.disposed)this.sync();
    }).catch(()=>{this.stats.missing++;});
  }
  setScreen(screen,phase='lobby'){this.screen=screen;this.phase=phase;this.sync();}
  setActive(active){if(this.active===!!active)return;this.active=!!active;this.sync();if(!this.active)this.stopEffects();}
  setPreferences(changes) {
    this.preferences=menuAudioPreferences({...this.preferences,...changes});
    try{this.storage?.setItem(STORAGE_KEY,JSON.stringify(this.preferences));this.storageSaved=!!this.storage;}catch{this.storageSaved=false;}
    this.sync();for(const voice of this.voices)voice.volume=this.preferences.effectsVolume/100;
    if(!this.preferences.effectsOn)this.stopEffects();return this.storageSaved;
  }
  reset(){return this.setPreferences(MENU_AUDIO_DEFAULTS);}
  canPlay(){return !this.disposed&&this.active&&this.unlocked&&!globalThis.document?.hidden;}
  track() {
    const key=this.catalog?.screens?.[this.screen]??this.catalog?.phases?.[this.phase];
    return key?this.catalog?.assets?.[key]:null;
  }
  sync() {
    if(this.disposed)return;
    const track=this.track();
    if(this.musicUrl!==track?.url){
      if(this.music){this.music.pause();this.music.removeAttribute('src');this.music.load();}
      this.music=null;this.musicUrl=track?.url||null;
      if(track&&typeof globalThis.Audio==='function'){this.music=new Audio(track.url);this.music.loop=true;this.music.preload='none';}
    }
    if(!this.music)return;
    // SoundTool.playBGMMusic base volume is .5, then musicVolRatio /100.
    this.music.volume=.5*this.preferences.musicVolume/100;
    if(!this.canPlay()||!this.preferences.musicOn||!this.preferences.musicVolume){this.music.pause();return;}
    if(this.music.paused){const current=this.music;current.play().then(()=>{if(this.disposed||current!==this.music||!this.canPlay()||!this.preferences.musicOn)current.pause();else this.stats.musicStarts++;}).catch(()=>{this.stats.blocked++;});}
  }
  effect(key='common') {
    if(!this.canPlay()||!this.preferences.effectsOn||!this.preferences.effectsVolume||this.voices.size>=4)return;
    const asset=this.catalog?.assets?.[key];if(!asset||typeof globalThis.Audio!=='function')return;
    const voice=new Audio(asset.url);voice.volume=this.preferences.effectsVolume/100;this.voices.add(voice);
    const end=()=>{voice.pause();voice.removeAttribute('src');voice.load();this.voices.delete(voice);};
    voice.addEventListener('ended',end,{once:true});voice.addEventListener('error',()=>{this.stats.missing++;end();},{once:true});
    voice.play().then(()=>{if(!this.canPlay()||!this.preferences.effectsOn)end();else this.stats.effectsPlayed++;}).catch(()=>{this.stats.blocked++;end();});
  }
  stopEffects(){for(const voice of this.voices){voice.pause();voice.removeAttribute('src');voice.load();}this.voices.clear();}
  snapshot(){return {...this.preferences,active:this.active,unlocked:this.unlocked,screen:this.screen,musicUrl:this.musicUrl,musicPaused:this.music?.paused??true,musicTime:this.music?.currentTime||0,voices:this.voices.size,storageSaved:this.storageSaved,...this.stats};}
  dispose(){this.disposed=true;this.host?.removeEventListener('pointerdown',this.onGesture,{capture:true});this.host?.removeEventListener('keydown',this.onGesture,{capture:true});this.host?.removeEventListener('click',this.onClick,{capture:true});globalThis.document?.removeEventListener('visibilitychange',this.onVisibility);if(this.music){this.music.pause();this.music.removeAttribute('src');this.music.load();}this.music=null;this.stopEffects();}
}
