import {element} from './m8_ui_helpers.js';

// These three legacy head aliases are direction/animation sprite sheets,
// verified against the original PNG bytes. Use the existing tank portrait
// for them instead of displaying or shrinking an entire sheet.
const SHEET_HEADS=new Set([
  '872a6e8cd61cbef9adf438c5be6a9c75062b7f6977dfc02ddfe20b93456e4265',
  '2c4284dac2ace34473cb4865233324cbabd0fd6e82803662f07138bc51310963',
  '1a7f74301f1b2f1b7b38177f49c678da2d99c0976ee7377ce0312dce752ea9d2',
]);
export function selectionHeadIsSheet(asset){return SHEET_HEADS.has(asset?.sha256);}

/** Keep the complete movie/bitmap at its original aspect and frame rate.
 * Scale a fixed viewport once, not individual animation frames (no pumping).
 * Names start at y=74 in the 178x98 team card and remain outside this clip.
 */
export function fitSelectionPreview(content,bounds={left:0,top:0,width:200,height:200}) {
  const {left=0,top=0,width,height}=bounds;
  if(!content||![left,top,width,height].every(Number.isFinite)||width<=0||height<=0)return null;
  const host=element('span',null,'m8132-selection-preview');
  const scale=Math.min(1,170/width,70/height);
  Object.assign(host.style,{position:'relative',display:'inline-block',width:'178px',height:'74px',overflow:'hidden',pointerEvents:'none'});
  Object.assign(content.style,{position:'absolute',left:`${(178-width*scale)/2-left*scale}px`,
    top:`${(74-height*scale)/2-top*scale}px`,transformOrigin:'0 0',transform:`scale(${scale})`,
    maxWidth:'none',maxHeight:'none',pointerEvents:'none'});
  host.dataset.previewScale=String(scale);host.append(content);
  host.dispose=()=>content.dispose?.();
  return host;
}
