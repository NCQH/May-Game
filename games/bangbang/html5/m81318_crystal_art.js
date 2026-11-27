// Exact 100x100 PNGs from the 02/11 Flash supplement, selected by nItemId /
// szIconPath1 (ItemTemplate SHA 66feec1f13d7db784b6aa37c69b99dbbc07e4ceccca2c7f37eefbed3115581d1).
// The legacy catalogs remain immutable. Only their 11 known transparent LV5
// placeholders are hydrated; prices, attributes, recipes and ownership stay native.
const EMPTY_SHA='43739c566e26fd7cb88f69d3864ea34740372f5ee99acac169e090beffbce5c6';
const EMPTY_LOGICAL='zh_CN/icon/item/offline_empty_crystal.png';
const SOURCES=[
  [5650101,'js_hgj05.png','e77447ec90e3e1d011f3fa644d73e09bcb149fba69eb9aef87a90e44f2f5d1e1'],
  [5650103,'js_hyh05.png','e9382fdcba01b99052c524624348c61410a0a8b83ea0e828ecab244c45eb636d'],
  [5650104,'js_hjx05.png','12e5336b28890d6b20b345c45b527b30e24ffbe9a1cf17528234309a575c403e'],
  [5650105,'js_hfg05.png','22f3f6106f628d37eb68b641b0143fc010859e6d00e82a2bf6627f881d80f2d4'],
  [5650205,'js_lwf05.png','984f7ed4c4dae78cfd147b740ce544ee42b7b84481b0c1ac30b5e07e6430bb52'],
  [5650206,'js_lss05.png','d67d38472308c5c6e27b0d656cf0f193783a6870570abd32016466ec5d363633'],
  [5650208,'js_hpx05.png','5409670b2e6ae1b28abc97b2d3f6484c7de12bbffaf5d2414005abca224206ba'],
  // Both armor files have identical bytes in the supplement. Keep their native
  // item/name mapping rather than inventing a different icon for either stat.
  [5650209,'js_lff05.png','984f7ed4c4dae78cfd147b740ce544ee42b7b84481b0c1ac30b5e07e6430bb52'],
  [5650309,'js_hsm05.png','88c8830106682746c7cc73f784ab787c893cbe506f2ad9fdea772d263f16bb9d'],
  [5650311,'js_hpb05.png','304b6fb8713156ba62c26c243b72ad829c1b20d2a34b32792391882426a97365'],
  [5650312,'js_hfc05.png','1e55a3ac6652b07a6f0b9598c1959fb0cfac0cbcf095ddfa766e5eccbc056af5'],
];

export const M81318_CRYSTAL_ICONS=Object.freeze(Object.fromEntries(SOURCES.map(([itemId,name,sha256])=>[
  itemId,Object.freeze({logical:'zh_CN/icon/item/'+name,
    url:`/html5/assets_m81318/crystals/${itemId}_${sha256}.png`,
    sourcePath:'assets_delta/www/rez/zh_CN/icon/item/'+name,
    exists:true,sha256,width:100,height:100,transparent:false}),
])));

/** Copies the presentation leaves only; never edits the parsed source catalogs. */
export function hydrateM81318CrystalArt(crystals,garage) {
  const crystalItems={...crystals?.items},garageItems={...garage?.items};
  for(const [id,icon] of Object.entries(M81318_CRYSTAL_ICONS)) {
    const crystal=crystalItems[id],item=garageItems[id];
    const oldIcon=crystal?.icon;
    const knownEmpty=oldIcon?.sha256===EMPTY_SHA&&oldIcon.logical===EMPTY_LOGICAL
      &&oldIcon.width===1&&oldIcon.height===1&&oldIcon.transparent===true;
    const alreadyHydrated=oldIcon?.sha256===icon.sha256&&oldIcon.url===icon.url;
    if(crystal?.itemId!==Number(id)||crystal.level!==5||(!knownEmpty&&!alreadyHydrated)
      ||item?.itemId!==Number(id)||item.type!==56||item.quality!==5
      ||![EMPTY_LOGICAL,icon.logical].includes(item.icon))
      throw new Error(`Nguồn hình tinh thể cấp 5 không khớp (${id}).`);
    crystalItems[id]={...crystal,icon};
    garageItems[id]={...item,icon:icon.logical};
  }
  const transparentIconItems=(crystals.transparentIconItems||[]).filter(id=>!M81318_CRYSTAL_ICONS[id]);
  return {crystals:{...crystals,items:crystalItems,transparentIconItems,
    counts:{...crystals.counts,transparentIcons:transparentIconItems.length}},
    garage:{...garage,items:garageItems}};
}

/** Register after older menu aliases so the exact native names cannot resolve
 * back to an old transparent asset. Do not remap the shared placeholder name. */
export function registerM81318CrystalArt(resources) {
  for(const icon of Object.values(M81318_CRYSTAL_ICONS)) {
    resources.set(icon.logical,icon);resources.set(icon.url,icon);
  }
}
