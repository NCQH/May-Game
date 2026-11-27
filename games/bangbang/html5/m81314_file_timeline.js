// Plain CLoader movies, unlike CMovieClipLite, own their root playback state.
// Read only audited numeric stop/play/goto controls; never evaluate ActionScript.
// M81316: these six inherited atlases predate nativeFrameActions metadata. The
// original SWF root SymbolClass/addFrameScript/method bytes were audited again
// (qa/pve_flash_20261104/hatches/audit_file_actions.py). door003 has byte-identical
// DoABC/SymbolClass tags to the already audited door001/002: frame15 -> stop16.
// Bind by original SHA, not filename or frame count. Preserve authored idle
// segments of gate2/monsterhome; freezing every USE_FILE movie is incorrect.
const inheritedFileControls=new Map([
  ['f8d9da90aa72d34298f8ba280f23ceb5f8f9113496f0cfac49b7f074afbb3aae',
    {length:16,frame:15,call:'gotoAndStop',target:16}], // door003open
  ['7a3a791894d9a2c89e8620371423e0289254d05114ce940f4b0b88f6e46fc066',
    {length:10,frame:10,call:'stop',target:null}], // gate1_6_close
  ['c36a2f98897305175a4a6554b3e79c0f5b921d4f1746cfe3d8e4e88de52a63a1',
    {length:30,frame:30,call:'gotoAndPlay',target:10}], // gate2_12_open
  ['2374e1e514d1628bedcf8cec82ed6667a2f6cbc89a132a55108bb24332e0e6ac',
    {length:30,frame:30,call:'gotoAndPlay',target:10}], // gate2_3_open
  ['a37f1d198f7ec9b7e27a91fec5614e097429372585df5baf94a354a87130526e',
    {length:30,frame:30,call:'gotoAndPlay',target:10}], // gate2_9_open
  ['e450c314b312553492d64ab341729418754c516a61344d2a112ee58b38f05cbf',
    {length:34,frame:34,call:'gotoAndPlay',target:11}], // monsterhome_open
]);
const compiled=new WeakMap();
function compile(sequence){
  const derived=sequence.derived,length=sequence.frames.length;
  const inherited=inheritedFileControls.get(derived.sourceSha256);
  // Validate before consulting the descriptor cache. A partial/wrong export
  // must not silently receive a held frame outside its decoded timeline.
  if(inherited&&(derived.mode!=='root-timeline'||length!==inherited.length
      ||derived.rootFrameCount!==inherited.length
      ||(sequence.source?.sha256!=null&&sequence.source.sha256!==derived.sourceSha256)))
    throw new Error('Timeline cửa PvE không khớp nguồn gốc đã đối chiếu.');
  if(compiled.has(derived))return compiled.get(derived);
  const controls=new Map(),audit=derived?.nativeFrameActions;
  // An explicit, audited descriptor remains authoritative. This fallback is
  // used only by the six exact older sources whose metadata was omitted.
  if(inherited&&!audit)controls.set(inherited.frame,[[inherited.call,inherited.target]]);
  for(const row of audit?.frameControls||[]){
    if(row.characterId!==0)continue; // Child timelines remain baked artwork.
    if(row.unclassifiedBody)throw new Error('Điều khiển movie chưa được xác minh.');
    const frames=[];
    for(const binding of row.nativeBindings||[])
      for(const match of binding.matchAll(/(\d+)\s*,\s*this\.(\w+)/g))
        if(match[2]===row.method)frames.push(Number(match[1])+1);
    if(!frames.length)throw new Error('Movie thiếu ánh xạ frame gốc.');
    const calls=row.calls.map(([name,arg])=>{
      if(!['stop','play','gotoAndStop','gotoAndPlay'].includes(name))throw new Error('Movie có lệnh ngoài phạm vi.');
      const target=name.startsWith('goto')?Number(String(arg).trim()):null;
      if(target!==null&&(!/^\d+$/.test(String(arg).trim())||!Number.isInteger(target)||target<1||target>length))
        throw new Error('Movie có frame đích ngoài phạm vi.');
      return [name,target];
    });
    for(const frame of frames)controls.set(frame,[...(controls.get(frame)||[]),...calls]);
  }
  function enter(frame,playing){
    const visited=new Set();
    while(true){
      if(visited.has(frame))throw new Error('Movie có vòng nhảy frame tức thời chưa được hỗ trợ.');
      visited.add(frame);let jump=null;
      for(const [name,target] of controls.get(frame)||[]){
        if(name==='stop')playing=false;
        else if(name==='play')playing=true;
        else {jump=target;playing=name==='gotoAndPlay';}
      }
      if(jump===null||jump===frame)return {frame,playing};
      frame=jump;
    }
  }
  const frames=[],seen=new Map();let state=enter(1,true),loopStart=0;
  for(let n=0;n<=length*2+2;n++){
    const key=`${state.frame}:${state.playing}`;
    if(seen.has(key)){loopStart=seen.get(key);break;}
    seen.set(key,frames.length);frames.push(state.frame-1);
    if(!state.playing){loopStart=frames.length-1;break;}
    state=enter(state.frame%length+1,true);
  }
  if(!frames.length)throw new Error('Movie không có frame hiển thị.');
  const value={frames,loopStart};compiled.set(derived,value);return value;
}

export function nativeFileFrame(sequence,ticks){
  if(!Number.isFinite(ticks))throw new Error('Đồng hồ movie không hợp lệ.');
  if(!sequence?.frames?.length)throw new Error('Movie không có timeline đã giải mã.');
  if(!sequence.derived){
    if(sequence.frames.length===1)return 0;
    throw new Error('Movie nhiều frame thiếu mô tả gốc.');
  }
  const {frames,loopStart}=compile(sequence),index=Math.max(0,Math.floor(ticks));
  return frames[index<frames.length?index:loopStart+(index-loopStart)%(frames.length-loopStart)];
}

// Verified Medusa04/05 root scripts: frame12/21 gotoAndPlay(1), fire label13.
const MEDUSA_CANNONS=new Set([
  'ab8bf19ce69d328b3818cb15f18e2dbb0d813e64f07c08edd677493b6b843c0e',
  '33944c4c52f82204b9450d988d5511932687bdd06610115383da17d51497d443']);
const LONG_CANNON='1e1552d37888a9089f016c7ad63dcd3a1603b17bdb49a4aca5c0d75bae58798e';
export function bindSupplementCannon(part){
  if(part?.source?.sha256===LONG_CANNON){
    const derived=part.derived;
    if(derived?.mode!=='cannon-nested'||derived.rootFrameCount!==10
        ||derived.labels?.idle!==1||derived.labels?.fire!==3||derived.rootFireTransforms?.length!==10)
      throw new Error('Timeline pháo Lạc Long Quân không khớp nguồn đã đối chiếu.');
    // Root frames2 and10 execute gotoAndPlay(1) before display. Only the root
    // recoil follows this clock; the nested sixteen-frame artwork keeps its
    // own continuous timeline, including while the root rests on idle frame1.
    derived.rootAnimation={idleFrames:[0],fireFrames:[2,3,4,5,6,7,8],ticksPerFrame:1,
      source:'Native longtaizi01 root addFrameScript(1,frame2,9,frame10); both gotoAndPlay(1)'};
    return;
  }
  if(!MEDUSA_CANNONS.has(part?.source?.sha256))return;
  const derived=part.derived;
  if(derived?.mode!=='root-timeline'||derived.rootFrameCount!==21||derived.labels?.fire!==13)
    throw new Error('Timeline pháo Medusa không khớp bản đã đối chiếu.');
  derived.animation={...derived.animation,idleFrames:Array.from({length:11},(_,i)=>i),
    fireFrames:Array.from({length:8},(_,i)=>i+12),ticksPerFrame:1,
    source:'TankCannon fire label13; native root jump frames12/21 omitted before display'};
}
