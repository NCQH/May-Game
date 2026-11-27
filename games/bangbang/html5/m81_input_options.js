/* Native action identities from SystemSetModel, separate from DOM event codes.
 * Unknown/unsupported actions retain their bindings but do not acquire invented
 * gameplay behavior. Duplicate imported mappings are disabled, never double-fire.
 */
const ACTIONS=[82,69,32,81,1000,1001,71,70,90,88,67,66,72];
const ALLOWED=new Set([...'BCEFGHIJKLMNOPQRTUVXYZ'.split('').map(k=>k.charCodeAt(0)),
 ...Array.from({length:10},(_,i)=>48+i),32,1000,1001,...Array.from({length:10},(_,i)=>96+i)]);
export const INPUT_ACTION_SLOTS=Object.freeze({82:10,69:1,32:2,81:4,1000:0});
// M8.5's user-selected first-use default. An explicit empty native array means
// the player chose ordinary casting and must never be replaced by this default.
export const DEFAULT_QUICKCAST_SLOTS=Object.freeze([10,1,2,4]);
export function quickcastSlots(options) {
 return Array.isArray(options?.skillSlot)?options.skillSlot.filter(Number.isInteger):[...DEFAULT_QUICKCAST_SLOTS];
}
export function nativeEventKey(event) {
 if(event.type?.startsWith('pointer')||event.type?.startsWith('mouse'))return event.button===0?1000:event.button===2?1001:null;
 const code=event.code||'';
 if(/^Key[A-Z]$/.test(code))return code.charCodeAt(3);
 if(/^Digit[0-9]$/.test(code))return Number(code.slice(5))+48;
 if(/^Numpad[0-9]$/.test(code))return Number(code.slice(6))+96;
 if(code==='Space'||event.key===' ')return 32;
 if(!code&&/^[A-Za-z0-9]$/.test(event.key||''))return event.key.toUpperCase().charCodeAt(0);
 return null;
}
export function nativeInputOptions(settings) {
 const mapping=Object.fromEntries(ACTIONS.map(action=>[action,action]));
 for(const pair of settings?.options?.keyBoardSet||[]) {
  const m=/^(\d+)-(\d+)$/.exec(pair);if(!m)continue;
  const action=Number(m[1]),key=Number(m[2]);
  if(Object.hasOwn(mapping,action))mapping[action]=ALLOWED.has(key)?key:null;
 }
 const counts=new Map();for(const key of Object.values(mapping))if(key!==null)counts.set(key,(counts.get(key)||0)+1);
 const byKey=new Map();for(const [action,key] of Object.entries(mapping))if(key!==null&&counts.get(key)===1)byKey.set(key,Number(action));
 const quickcast=new Set(quickcastSlots(settings?.options));
 return {mapping,byKey,quickcast,signature:JSON.stringify([mapping,[...quickcast]])};
}
