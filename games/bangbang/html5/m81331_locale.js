// M31 exact Vietnamese display overrides. Never translate player names,
// filenames, IDs, stats, raw templates or source audit/native* fields.
const displayFields=new Set(['name','description','description2','title','text','tips','story','role',
  'szName','szDesc','szDesc2','szBuffName','szBuffDesc','szSkillName','szSkillDesc',
  'szMapName','szMapDesc','szTip','szTips','szDescription']);
const loads=new Map();
const sourceNames=new WeakMap();

export async function loadM81331Locale(url='./m81331_locale_catalog.json',{refresh=false}={}){
  if(refresh)loads.delete(url);
  if(!loads.has(url))loads.set(url,(async()=>{
    const response=await fetch(url,{cache:'no-store'});
    if(!response.ok)throw new Error('Không tải được bản dịch tiếng Việt M31.');
    const value=await response.json();
    if(value?.schemaVersion!==1||value.locale!=='vi-VN'||!value.translations||!value.scoped)
      throw new Error('Bản dịch tiếng Việt không đúng phiên bản.');
    return value;
  })().catch(error=>{loads.delete(url);throw error;}));
  return loads.get(url);
}

export function exactVietnamese(locale,text){
  return typeof text==='string'&&Object.hasOwn(locale?.translations||{},text)
    ?locale.translations[text]:text;
}

function applyRows(rows,overrides){
  for(const [id,fields] of Object.entries(overrides||{})){
    const previous=rows?.[id];if(!previous||typeof previous!=='object')continue;
    let next=null;
    for(const [field,entry] of Object.entries(fields)){
      if(!displayFields.has(field)||typeof entry?.source!=='string'||typeof entry.text!=='string'
          ||previous[field]!==entry.source)continue;
      next||={...previous};next[field]=entry.text;
      if(field==='szName')sourceNames.set(next,entry.source);
    }
    if(next)rows[id]=next;
  }
}

function translateNamedRows(rows,locale){
  if(!rows||typeof rows!=='object')return;
  for(const [id,row] of Object.entries(rows)){
    if(!row||typeof row!=='object')continue;
    let next=null;
    for(const field of displayFields){
      const text=row[field],translated=exactVietnamese(locale,text);
      if(typeof text==='string'&&translated!==text){next||={...row};next[field]=translated;}
    }
    if(next)rows[id]=next;
  }
}

export function mergeM81331BattleLocale(catalog,locale){
  for(const [table,overrides] of Object.entries(locale.scoped.battle||{}))
    if(['skills','buffs','aiNPCs','aiArms','sceneItems','mapNPCs'].includes(table))applyRows(catalog[table],overrides);
  // M32: the battle hotbar prefers the native mode skill-text sidecar over
  // skills[]. Translate that actual display source after all catalog merges;
  // IDs, cooldowns, costs and raw/native fields still remain untouched.
  translateNamedRows(catalog.modePresentation?.skillText,locale);
  // These records are static catalog identities, not actor/player names.
  translateNamedRows(catalog.tanks,locale);
  for(const [id,row] of Object.entries(catalog.tanks||{})){
    if(!row.base)continue;
    const translated=exactVietnamese(locale,row.base.szName);
    if(translated!==row.base.szName)catalog.tanks[id]={...row,base:{...row.base,szName:translated}};
  }
  catalog.localizedText={...catalog.localizedText,...locale.translations};
  return catalog;
}

export function mergeM81331HudLocale(hud,locale){
  applyRows(hud.skills,locale.scoped.menu?.hudSkills);
  hud.localizedText={...hud.localizedText,...locale.translations};
  return hud;
}

export function mergeM81331MenuLocale(ui,locale){
  for(const table of ['items','skills','tanks'])applyRows(ui.garage?.[table],locale.scoped.menu?.[table]);
  ui.garage.localizedText={...ui.garage.localizedText,...locale.translations};
  if(ui.pve)ui.pve.localizedText={...ui.pve.localizedText,...locale.translations};
  mergeM81331HudLocale(ui.hud,locale);
  for(const table of ['cosmetics','guildItems','guildLevels','guildSkills','military'])
    translateNamedRows(ui.account?.[table],locale);
  return ui;
}

/** NPC actor names can arrive from the native wire. Translate only when they
 * exactly equal that NPC template's original name; human/user text is untouched. */
export function vietnameseNpcName(actor,template){
  const name=actor?.name||'';
  return template&&sourceNames.get(template)===name?template.szName:name||template?.szName||'';
}
