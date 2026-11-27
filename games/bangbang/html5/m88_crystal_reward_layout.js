/** Native VICrystalMakeView centers its1200×800 content, not its1230×870
 * outer Box1. The content sits at15,50 inside that box, so its center is15px
 * below the outer center. VICrystalMakeRewardView shares that content origin.
 * Its DefineShape2 bitmap is a crop of the craft backdrop, not a separate card:
 * source bounds[-2,105.2,540,403.2], movie placement457,59, matching the backdrop
 * at331,112.7 after the backdrop's horizontal/vertical-center offsets4,1.5.
 * Preserve this relationship for movie, icons, quality glows and the confirm.
 */
export const CRYSTAL_REWARD_VISIBLE_FRAME=Object.freeze({left:455,top:164.2,right:997,bottom:505});

export function crystalRewardLayout(width,height,content={left:(width-1200)/2,
  top:(height-870)/2+50,width:1200,height:800}) {
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)
    throw new Error('Invalid crystal reward viewport.');
  if(!content||![content.left,content.top,content.width,content.height].every(Number.isFinite)
      ||content.width<=0||content.height<=0)throw new Error('Invalid crystal content frame.');
  // Outside-UI scaling applies equally to the backdrop and every overlay.
  // Applying another fit here would change the scale of the same machine.
  return {width,height,scale:1,left:content.left+content.width/2-720,
    top:content.top+content.height/2-450};
}

export function positionCrystalRewardLayer(node,layout) {
  Object.assign(node.style,{left:layout.left+'px',top:layout.top+'px',right:'auto',bottom:'auto',
    transformOrigin:'0 0',transform:`scale(${layout.scale})`});
}
