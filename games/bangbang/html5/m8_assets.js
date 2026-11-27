import {M7Assets} from './m7_assets.js';
import {nativeHudFrames,nativeHudFrameGeometry} from './m7_robo_hud.js';
import {element,assetImage} from './m8_ui_helpers.js';
import {M82MenuAnimations} from './m82_menu_animation.js';
import {nativeTankHalo,nativePortraitViewport} from './m83_tank_presentation.js';
import {prepareM83BattleHalo} from './m83_battle_halo.js';
import {fitSelectionPreview,selectionHeadIsSheet} from './m8132_selection_preview.js';
import {loadPveCatalog} from './m81314_assets.js';
import {hydrateM6Catalog} from './m6_assets.js';
import {loadPvePresentation,mergePveMenus} from './m81314_presentation.js';
import {hydrateM81318CrystalArt,registerM81318CrystalArt} from './m81318_crystal_art.js';
import {loadM81319Tanks,mergeM81319Menus} from './m81319_tanks.js';
import {loadM81328Icons,mergeM81328Menus} from './m81328_icons.js';
import {loadWorldBossCatalog,mergeWorldBossMenus} from './m81330_assets.js';
import {loadM81331Locale,mergeM81331MenuLocale} from './m81331_locale.js';
import {loadM81333Skins,mergeM81333MenuSkins} from './m81333_skins.js';
import {loadM81333LacSkin,mergeM81333LacMenus} from './m81333_lac_skin.js';
import {loadM81334Skins,mergeM81334Menus} from './m81334_skins.js';
import {loadM81335Skins,mergeM81335Menus} from './m81335_skins.js';
import {loadM81335Icons,mergeM81335IconsMenus} from './m81335_icons.js';
import {loadM81338LevelLooks,mergeM81338LevelLooksMenus,m81338VisualExternal} from './m81338_level_looks.js';

/** Counts completed native hash-verified reads during the inherited asset gate.
 * The discovered total can grow. No timer or native progress packet is invented.
 */
export class M8BattleAssets extends M7Assets {
  prepareScene(scene,accountId,progress=()=>{}) {
    const ticket=this.outsidePrepareSerial=(this.outsidePrepareSerial||0)+1;
    const operation=(this.outsidePrepareQueue||Promise.resolve()).catch(()=>{}).then(()=>{
      if(ticket!==this.outsidePrepareSerial)throw new DOMException('Đợt tải cũ đã được thay thế.','AbortError');
      return this.prepareOutsideScene(scene,accountId,progress);
    });
    this.outsidePrepareQueue=operation;return operation;
  }
  async prepareOutsideScene(scene,accountId,progress) {
    const load={progress,seen:new Set(),done:new Set(),at:0};this.outsideLoad=load;
    progress({stage:'catalog',completed:null,total:null});
    try {
      const result=await super.prepareScene(scene,accountId);
      await prepareM83BattleHalo(this,result,scene);
      if(this.outsideLoad===load)progress({stage:'interface',completed:load.done.size,total:load.seen.size});
      return result;
    } finally {if(this.outsideLoad===load)this.outsideLoad=null;}
  }
  async binary(asset) {
    const load=this.outsideLoad,key=asset?.url+':'+asset?.sha256;
    if(load)load.seen.add(key);
    const result=await super.binary(asset);
    if(load&&this.outsideLoad===load) {
      load.done.add(key);
      if(performance.now()-load.at>70) {
        load.at=performance.now();
        load.progress({stage:'assets',completed:load.done.size,total:load.seen.size});
      }
    }
    return result;
  }
}

export class M8UIAssets {
  constructor(){
    this.animations=new Set();this.raf=0;this.resources=new Map();this.preloadedImages=new Map();this.enabled=true;this.menuAnimations=new M82MenuAnimations();
    this.onPortraitMotion=()=>{
      if(document.hidden||this.menuAnimations.motion?.matches){
        if(this.raf)cancelAnimationFrame(this.raf);this.raf=0;
        if(this.menuAnimations.motion?.matches)for(const entry of this.animations)this.drawPortrait(entry,0);
      }else this.schedule();
    };
    document.addEventListener('visibilitychange',this.onPortraitMotion);
    this.menuAnimations.motion?.addEventListener?.('change',this.onPortraitMotion);
  }
  async load() {
    const names=['m8_ui_catalog','m8_garage_catalog','m8_crystal_catalog','m8_account_catalog',
      'm7_robo_ui_catalog','m3_asset_catalog','m81_panel_catalog','m82_shell_catalog','m82_animation_catalog',
      'm83_presentation_catalog','m83_chrome_catalog','m84_crystal_catalog','m84_panels_catalog','m84_flow_catalog','m85_tank_catalog',
      'm86_loading_catalog','m86_postmatch_catalog','m89_pk_catalog','m810_modes_catalog'];
    const data=await Promise.all(names.map(async name=>{
      const response=await fetch(`./${name}.json`,{cache:'no-store'});
      if(!response.ok)throw new Error(`Không tải được giao diện (${name}).`);
      if(name==='m8_garage_catalog'){
        const bytes=await response.arrayBuffer();
        this.garageCatalogSha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
          .map(value=>value.toString(16).padStart(2,'0')).join('');
        return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      }
      return response.json();
    }));
    [this.ui,this.garage,this.crystals,this.account,this.hud,this.m3,this.panels,this.shells,this.movies,this.presentation,this.chrome,this.crystalPresentation,this.accountPresentation,this.flowPresentation,this.tankPresentation,this.loadingPresentation,this.postmatchPresentation,this.pk]=data;
    this.modes=data.at(-1);
    const crystalArt=hydrateM81318CrystalArt(this.crystals,this.garage);
    this.crystals=data[2]=crystalArt.crystals;this.garage=data[1]=crystalArt.garage;
    const pve=await loadPveCatalog();this.pve=hydrateM6Catalog(pve.catalog);this.pveCatalogSha256=pve.sha256;
    for(const [id,map] of Object.entries(this.pve.maps)){
      const key=`loading.map${id}Mini`;
      this.loadingPresentation.assets[key]=map.minimap;
      this.loadingPresentation.maps[id]={name:`${map.name} [PvE đơn]`,miniKey:key};
      this.m3.maps[id]={...(this.m3.maps[id]||{}),name:map.name,preview:map.gui||map.minimap};
    }
    data.push(this.pve);
    const tanks=await loadM81319Tanks();this.m81319Tanks=hydrateM6Catalog(tanks.catalog);this.m81319TanksSha256=tanks.sha256;
    data.push(this.m81319Tanks);
    const haloResponse=await fetch('./m812_halo_catalog.json',{cache:'no-store'});
    if(!haloResponse.ok)throw new Error('Không tải được giao diện vòng sáng.');
    this.haloPresentation=await haloResponse.json();
    if(this.haloPresentation.schemaVersion!==1)throw new Error('Giao diện vòng sáng không hợp lệ.');
    data.push(this.haloPresentation);
    for(const [key,value] of Object.entries(this.haloPresentation.assets))this.resources.set(key,value);
    for(const map of [...this.pk.mapChoices,...this.modes.mapChoices]){
      const mini=(this.pk.hudMaps[String(map.mapId)]||this.modes.hudMaps[String(map.mapId)])?.minimap,key=`loading.map${map.mapId}Mini`;
      if(!mini)throw new Error('Thiếu ảnh bản đồ PK ở màn tải trận.');
      this.loadingPresentation.assets[key]=mini;
      const mode=map.mode.startsWith('base_')?'Phá trụ':map.mode.startsWith('occupy_')?'Chiếm cứ điểm':map.mode==='escort_bomb'?'Hộ tống':'Tính Điểm';
      this.loadingPresentation.maps[String(map.mapId)]={name:`${map.name} [${mode}]`,miniKey:key};
    }
    const visited=new WeakSet();
    const collect=value=>{
      if(!value||typeof value!=='object'||visited.has(value))return;
      visited.add(value);
      if(value.url&&/\.(?:png|jpg|jpeg|webp)(?:$|[?#])/i.test(value.url)) {
        for(const key of [value.logical,value.logicalPath,value.url])if(key)this.resources.set(key,value);
      }
      for(const [key,child] of Object.entries(value))if(!['frames','source','derived'].includes(key))collect(child);
    };
    for(const catalog of data)collect(catalog);
    for(const [logical,value] of Object.entries(this.account.assets||{}))this.resources.set(logical,value);
    for(const [key,value] of Object.entries(this.panels.assets||{}))this.resources.set(key,value);
    for(const [key,value] of Object.entries(this.ui.assets||{})) {
      this.resources.set(key,value);
      if(value.source?.logical)this.resources.set(value.source.logical,value);
    }
    // Native embedded sources override missing or corrupt external aliases.
    for(const [key,value] of Object.entries(this.shells.assets||{}))this.resources.set(key,value);
    for(const [key,value] of Object.entries(this.movies.assets||{})) {
      this.resources.set(key,value);
      if(value.logical)this.resources.set(value.logical,value);
    }
    for(const catalog of [this.presentation,this.chrome,this.crystalPresentation,this.accountPresentation,this.flowPresentation,this.tankPresentation,this.loadingPresentation,this.postmatchPresentation])for(const [key,value] of Object.entries(catalog.assets||{})) {
      this.resources.set(key,value);
      if(value.logical)this.resources.set(value.logical,value);
    }
    Object.assign(this.panels.selectionHeads||(this.panels.selectionHeads={}),this.movies.selectionHeads||{});
    const supplement=await loadPvePresentation(this.pveCatalogSha256);
    mergePveMenus(this,this.pve,supplement.catalog);
    this.pvePresentationSha256=supplement.sha256;
    // Native/embedded aliases above remain untouched. The approved 11 item
    // icons and 69 skill icons resolve to the exact supplemental source bytes.
    for(const row of [...Object.values(supplement.catalog.items),...Object.values(supplement.catalog.skills)]){
      if(row.icon)this.resources.set(row.icon,this.pve.assets[row.icon]);
    }
    registerM81318CrystalArt(this.resources);
    mergeM81319Menus(this,this.m81319Tanks,this.pve.source.m6CatalogSha256);
    const icons=await loadM81328Icons();
    mergeM81328Menus(this,icons.catalog,this.pve.source.m6CatalogSha256);
    this.m81328IconsSha256=icons.sha256;
    const boss=await loadWorldBossCatalog();
    mergeWorldBossMenus(this,hydrateM6Catalog(boss.catalog),this.pve.source.m6CatalogSha256);
    this.worldBossCatalogSha256=boss.sha256;
    mergeM81331MenuLocale(this,await loadM81331Locale());
    const skins=await loadM81333Skins();
    await mergeM81333MenuSkins(this,skins.catalog,this.garageCatalogSha256,this.pveCatalogSha256);
    const lac=await loadM81333LacSkin();
    await mergeM81333LacMenus(this,hydrateM6Catalog(lac.catalog),{
      'm8_garage_catalog.json':this.garageCatalogSha256,'m81314_assets_catalog.json':this.pveCatalogSha256,'m81319_tanks_catalog.json':this.m81319TanksSha256});
    const skins34=await loadM81334Skins();
    await mergeM81334Menus(this,hydrateM6Catalog(skins34.catalog),{
      'm8_garage_catalog.json':this.garageCatalogSha256,'m81314_assets_catalog.json':this.pveCatalogSha256,
      'm81319_tanks_catalog.json':this.m81319TanksSha256,'m81333_skins_catalog.json':skins.sha256,
      'm81333_lac_skin_catalog.json':lac.sha256});
    const skins35=await loadM81335Skins();
    await mergeM81335Menus(this,hydrateM6Catalog(skins35.catalog),{
      'm8_garage_catalog.json':this.garageCatalogSha256,'m81314_assets_catalog.json':this.pveCatalogSha256,
      'm81319_tanks_catalog.json':this.m81319TanksSha256,'m81333_skins_catalog.json':skins.sha256,
      'm81333_lac_skin_catalog.json':lac.sha256,'m81334_skins_catalog.json':skins34.sha256});
    const icons35=await loadM81335Icons();
    await mergeM81335IconsMenus(this,icons35.catalog,{'m8_garage_catalog.json':this.garageCatalogSha256});
    const levelLooks=await loadM81338LevelLooks();
    await mergeM81338LevelLooksMenus(this,levelLooks.catalog,{
      'm8_garage_catalog.json':this.garageCatalogSha256,'m81319_tanks_catalog.json':this.m81319TanksSha256,
      'm81335_skins_catalog.json':skins35.sha256});
    // Flash's preload module already has its embedded artwork when the screen
    // opens. Decode its small fixed image set at UI startup as well, avoiding a
    // first loading frame containing tanks floating over an empty background.
    await this.preloadImages(['loading.background','loading.shadow','loading.versus',
      'loading.hexagon','loading.selfHexagon','loading.progress','loading.progressTrack','loading.map19Mini']);
    return this;
  }
  get(logical) {return this.resources.get(logical)||null;}
  preloadImages(keys) {
    return Promise.all(keys.filter(Boolean).map(key=>{
      const asset=typeof key==='string'?this.get(key):key,url=asset?.stillUrl||asset?.url;
      if(!url||!/\.(?:png|jpg|jpeg|webp)(?:$|[?#])/i.test(url))return null;
      if(!this.preloadedImages.has(url)){
        const image=new Image();image.decoding='async';image.src=url;
        this.preloadedImages.set(url,{image,ready:image.decode().catch(()=>null)});
      }
      return this.preloadedImages.get(url).ready;
    }));
  }
  menuArt(logical,alt='',className='',options={}) {
    const asset=typeof logical==='string'?this.get(logical):logical;
    options={nativePriority:asset?.logical==='zh_CN/gui_summer/controls/main/360/plat.swf'?80:0,...options};
    if(!asset?.renderOffset)return this.menuAnimations.image(asset,alt,className,options);
    // Flash loads movie contents without clipping to the SWF header rectangle.
    // Keep the component's logical size while the viewing canvas can overhang it.
    const host=element('span',null,className);
    Object.assign(host.style,{position:'relative',display:'inline-block',width:`${asset.width}px`,height:`${asset.height}px`,overflow:'visible',pointerEvents:'none'});
    const movie=this.menuAnimations.image({...asset,width:asset.renderWidth,height:asset.renderHeight},alt,'',options);
    Object.assign(movie.style,{position:'absolute',left:`${asset.renderOffset[0]}px`,top:`${asset.renderOffset[1]}px`,
      width:`${asset.renderWidth}px`,height:`${asset.renderHeight}px`,maxWidth:'none',maxHeight:'none'});
    host.append(movie);host.dataset.nativeMovieViewport=asset.renderOffset.join(',');
    host.dispose=()=>this.menuAnimations.release(movie);return host;
  }
  selectionHeadForTank(tank,{animate=true,className=''}={}) {
    const externalId=this.tankExternal(tank),row=this.hud?.portraits?.[String(externalId)]?.presentationOnlyLevelLook
      ?null:this.panels?.selectionHeads?.[String(externalId)];
    let content,bounds;
    if(row&&!selectionHeadIsSheet(row)) {
      content=this.menuArt(row,'',className,{animate});
      content.style.width=`${row.width}px`;content.style.height=`${row.height}px`;
      bounds={left:row.renderOffset?.[0]||0,top:row.renderOffset?.[1]||0,
        width:row.renderWidth||row.width,height:row.renderHeight||row.height};
    } else {
      if(!this.hud?.portraits?.[String(externalId)])return null;
      content=this.portraitForTank(tank,{size:200,animate,clearEffect:true});
      bounds=nativePortraitViewport(this.presentation?.portraits?.[String(externalId)])
        ||{left:0,top:0,width:200,height:200};
    }
    return fitSelectionPreview(content,bounds);
  }
  tankName(id) {return this.garage?.tanks?.[id]?.name||`Tank ${id}`;}
  tankExternal(tank) {
    const nativeExternal=tank?.externalId||this.garage?.levels?.[`${tank?.tankId}:${tank?.level||tank?.tankLevel||1}`]?.externalId
      ||this.garage?.levels?.[`${tank?.tankId}:${tank?.level||tank?.tankLevel||1}`]?.defaultExternal||0;
    return m81338VisualExternal(tank,nativeExternal);
  }
  portraitForTank(tank,options={}) {return this.createPortrait(this.tankExternal(tank),{...options,tank});}
  createPortrait(externalId,{size=200,className='',animate=true,tank=null,preferNative=size>=160,haloBehindBody=false,...options}={}) {
    if(tank)externalId=m81338VisualExternal(tank,externalId);
    const host=element('span',null,`m8-portrait ${className}`);host.style.width=`${size}px`;host.style.height=`${size}px`;
    // AvatarView is not a 200px clipping mask. TankCellProxy adds its own hex mask.
    host.style.overflow='visible';host.style.contain='layout';
    host.dataset.externalId=String(externalId);
    const content=element('span',null,'m8-portrait-content');
    content.style.transform=`scale(${size/200})`;host.append(content);
    const entries=[],movieHosts=[],begun=performance.now();
    const makeSequence=(sequence,className,offset=[0,0])=>{
      const layer=element('span',null,className);
      Object.assign(layer.style,{position:'absolute',left:'0',top:'0',width:'200px',height:'200px'});
      const entry={host,content:layer,sequence,offset,layers:[],begun,lastTick:-1};entries.push(entry);
      this.drawPortrait(entry,0);if(animate){this.animations.add(entry);this.schedule();}
      return {layer,entry};
    };
    const halo=nativeTankHalo(this.presentation,tank||{},options);
    if(halo){
      host.dataset.nativeHaloId=String(halo.itemId);
      const bottom=makeSequence(halo.bottom,'m83-halo-bottom',halo.bottomAnchor);
      content.append(bottom.layer);
      if(haloBehindBody){
        const surface=makeSequence(halo.surface,'m83-halo-surface',halo.surfaceAnchor);
        content.append(surface.layer);host.dataset.haloLayer='behind-body';
      }
    }
    const portrait=this.hud?.portraits?.[String(externalId)];
    if(!portrait) {host.dataset.missingPortrait='true';host.title='Chưa có ảnh tank từ gói gốc';}
    const sequence=portrait&&(portrait.animation||this.hud.effects?.[portrait.effect]);
    if(sequence) {
      const native=this.presentation?.portraits?.[String(externalId)];
      const viewport=animate&&(preferNative||native?.requiresNativeTimeline||sequence.mode==='independent-layers')?nativePortraitViewport(native):null;
      const body=makeSequence(sequence,'m83-body-fallback',viewport?[0,0]:(portrait.bitmapOffset||[0,0]));
      if(viewport){
        const fallback=element('span',null,'m83-native-body-fallback');fallback.append(body.layer);
        Object.assign(body.layer.style,{left:`${viewport.fallbackLeft}px`,top:`${viewport.fallbackTop}px`});
        const movie=this.menuAnimations.image(native,'','m83-native-body',{
          animate:true,nativePriority:preferNative?100:90,fallbackElement:fallback,onFallbackState:playing=>{
            if(playing&&animate)this.animations.add(body.entry);else this.animations.delete(body.entry);
            if(!playing)this.drawPortrait(body.entry,0);this.schedule();
          }});
        Object.assign(movie.style,{position:'absolute',left:`${viewport.left}px`,top:`${viewport.top}px`,
          width:`${viewport.width}px`,height:`${viewport.height}px`});
        content.append(movie);movieHosts.push(movie);
      }else content.append(body.layer);
    } else if(portrait) {
      const image=assetImage(portrait.asset||portrait.source,'','m8-portrait-bitmap');
      image.style.left=`${portrait.bitmapOffset?.[0]||0}px`;image.style.top=`${portrait.bitmapOffset?.[1]||0}px`;
      image.style.width=`${(portrait.asset||portrait.source)?.width||200}px`;
      image.style.height=`${(portrait.asset||portrait.source)?.height||200}px`;
      content.append(image);
    }
    if(halo&&!haloBehindBody){const surface=makeSequence(halo.surface,'m83-halo-surface',halo.surfaceAnchor);content.append(surface.layer);}
    host.dispose=()=>{for(const entry of entries)this.animations.delete(entry);for(const movie of movieHosts)this.menuAnimations.release(movie);};
    return host;
  }
  drawPortrait(entry,elapsed) {
    const samples=nativeHudFrames(entry.sequence,elapsed,true);
    samples.forEach((sample,index)=>{
      const geometry=nativeHudFrameGeometry(sample,entry.offset||[0,0]);
      let layer=entry.layers[index];
      if(!layer){layer=element('span',null,'m8-portrait-layer');entry.content.append(layer);entry.layers[index]=layer;}
      layer.hidden=!geometry;if(!geometry)return;
      layer.dataset.nativeFrame=String(sample.frame.sourceFrame??'');
      Object.assign(layer.style,{width:`${geometry.width}px`,height:`${geometry.height}px`,
        transform:`translate(${geometry.left}px,${geometry.top}px)`,
        backgroundImage:`url("${geometry.url}")`,backgroundPosition:`${geometry.backgroundX}px ${geometry.backgroundY}px`,
        backgroundSize:geometry.backgroundWidth?`${geometry.backgroundWidth}px ${geometry.backgroundHeight}px`:''});
    });
  }
  schedule() {
    if(this.raf||!this.enabled||!this.animations.size||document.hidden||this.menuAnimations.motion?.matches)return;
    this.raf=requestAnimationFrame(now=>{
      this.raf=0;
      for(const entry of this.animations) {
        if(!entry.host.isConnected){this.animations.delete(entry);continue;}
        if(document.hidden||!entry.host.getClientRects().length)continue;
        const interval=Math.min(...(entry.sequence.layers||[entry.sequence]).map(layer=>layer.frameMs||entry.sequence.frameMs||1000/24));
        const tick=Math.floor((now-entry.begun)/interval);
        if(tick!==entry.lastTick){entry.lastTick=tick;this.drawPortrait(entry,now-entry.begun);}
      }
      this.schedule();
    });
  }
  setEnabled(enabled) {
    this.enabled=enabled;
    this.menuAnimations.setEnabled(enabled);
    if(!enabled&&this.raf){cancelAnimationFrame(this.raf);this.raf=0;}
    if(enabled)this.schedule();
  }
  dispose(){
    if(this.raf)cancelAnimationFrame(this.raf);this.raf=0;this.animations.clear();
    document.removeEventListener('visibilitychange',this.onPortraitMotion);
    this.menuAnimations.motion?.removeEventListener?.('change',this.onPortraitMotion);this.menuAnimations.dispose();
  }
}
