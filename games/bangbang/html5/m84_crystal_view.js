import {CRYSTAL_ATTRIBUTE_NAMES} from './m81_crystal_view.js';

/** VICrystalRmdLstProxy / TankUtil.getTankInstTheBest. A recommendation is
 * presentation state; choosing it never changes the primary tank or a build. */
export function crystalRecommendationTanks(meta) {
  const byTemplate=new Map();
  for(const tank of meta?.tanks||[]) {
    if(tank.containerType!==0)continue;
    const old=byTemplate.get(tank.tankId);
    if(!old||tank.level>old.level)byTemplate.set(tank.tankId,tank);
  }
  return [...byTemplate.values()];
}

export function crystalRecommendationTank(meta,tankId=null) {
  const tanks=meta?.tanks||[];
  const id=tankId??tanks.find(t=>t.selected)?.tankId??crystalRecommendationTanks(meta)[0]?.tankId;
  return tanks.filter(t=>t.tankId===id).reduce((best,tank)=>
    !best||tank.level>best.level||tank.level===best.level&&tank.containerType<best.containerType?tank:best,null);
}

export function crystalRecommendationRows(presentation,tankId,level,items,owned) {
  const used={};for(const id of items||[])if(id)used[id]=(used[id]||0)+1;
  return (presentation?.recommendations?.[tankId]?.[level]||[]).map(itemId=>({itemId,
    count:Math.max(0,(owned[itemId]||0)-(used[itemId]||0))}));
}

// CrystalTool.getCrystalAttrDesc: value precedes the translated attribute name.
export function crystalItemAttributeText(item) {
  return (item?.attributes||[]).map(a=>{
    const value=Number(a.value)*(a.valueType===2?100:1);
    const number=value.toFixed(1).replace(/\.0$/,'')+(a.valueType===2?'%':'');
    return `${value<0?'':'+'}${number} ${CRYSTAL_ATTRIBUTE_NAMES[a.type]||`Thuộc tính ${a.type}`}`;
  }).join('\n');
}

export function crystalGuaranteeText(presentation,tier,remaining) {
  if(remaining===null)return '';
  const key=(remaining===1?'guaranteed':'guarantee')+(tier?'High':'Low');
  const fallback=remaining===1?`Chế tạo ra Tinh Thể Lv${tier?'4~5':'2~3'}`:
    `Chế tạo ${remaining} lần, sẽ có Tinh Thể Lv${tier?'4~5':'2~3'}`;
  return presentation?.labels?.[key]?.replace('@num1@',String(remaining))||fallback;
}

export const M84_CRYSTAL_STYLE=`
.cr-native .cr-page-boards [data-testid=cr-recommend]{position:absolute;left:88px;top:37px}
.cr-native .cr-page-boards .cr-recommendations{top:114px;height:387px;color:#bddde6}
.cr-recommendations .cr-rmd-name{color:#fff;font-size:16px;font-weight:bold;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cr-recommendations .cr-rmd-label,.cr-recommendations .cr-rmd-role{font-size:14px;font-weight:bold;color:#5d8dba;white-space:nowrap}
.cr-recommendations .cr-rmd-role{overflow:hidden;text-overflow:ellipsis}
.cr-recommendations .cr-rmd-list{position:absolute;left:0;top:197px;width:250px;height:190px;overflow:auto}
.cr-native .cr-rmd-item{position:relative;width:250px;height:50px;color:#bddde6}
.cr-native .cr-rmd-item>button.cr-rmd-use{display:block;position:absolute;inset:0;width:250px;height:50px;padding:0;border:0;background:transparent;box-shadow:none;color:inherit;text-align:left;font:12px Tahoma,sans-serif}
.cr-native .cr-rmd-item .cr-rmd-item-bg{position:absolute;left:0;top:50%;transform:translateY(-50%);pointer-events:none}
.cr-native .cr-rmd-item .cr-rmd-item-over{visibility:hidden}.cr-native .cr-rmd-item:hover .cr-rmd-item-over{visibility:visible}
.cr-native .cr-rmd-item .cr-rmd-icon{position:absolute;left:3px;top:3px;width:44px;height:44px;pointer-events:none}
.cr-native .cr-rmd-item .cr-rmd-description{position:absolute;left:48px;top:50%;transform:translateY(-50%);width:113px;font-weight:bold;line-height:16px;white-space:pre-line;pointer-events:none}
.cr-native .cr-rmd-item .cr-rmd-count{position:absolute;right:53px;top:50%;transform:translateY(-50%);font-weight:bold;pointer-events:none}
.cr-native .cr-rmd-item .cr-rmd-count.is-empty{color:#f00}.cr-native .cr-rmd-item>button.cr-rmd-buy{position:absolute;right:3px;top:11px}
.cr-native .cr-rmd-item>button.cr-rmd-buy:disabled{opacity:1;cursor:default}
.cr-native .cr-rmd-level{position:absolute;top:163px}.cr-native .cr-rmd-level[aria-pressed=true]{outline:0}
.cr-native .cr-page-boards .cr-native-name input{background-color:transparent;border:0;color:#bddde6;font-size:16px;font-weight:bold;padding-left:2px;padding-top:2px;background-size:100% 100%;border-radius:0}
.cr-native .cr-page-boards .cr-assign{display:none}
.cr-native .cr-assign-open{position:absolute;left:820px;top:502px;width:110px;height:28px;padding:0;border:0;color:#fff;font-weight:bold;background-size:100% 100%;background-color:transparent;box-shadow:none}
.cr-native .cr-page-craft>.cr-heading,.cr-native .cr-page-craft>.cr-dialog-back,.cr-native .cr-page-craft>.cr-awards,.cr-native .cr-page-craft>h4{display:none}
.cr-native .cr-page-craft .cr-craft-counter{margin:0;font-size:14px;font-weight:bold;color:#59e695;line-height:22px;white-space:nowrap}
.cr-native .cr-price{position:absolute;width:90px;height:22px;border:1px solid #46568f;box-sizing:border-box;background:rgba(12,42,78,.75)}
.cr-native .cr-price img{position:absolute;left:0;top:-6px;pointer-events:none}.cr-native .cr-price span{position:absolute;left:26px;top:-1px;width:70px;font-size:14px;font-weight:bold;color:#fff;line-height:22px}
.cr-native .cr-price.is-short span{color:#ff1514}.cr-native .cr-craft-heading{font-size:9px;font-weight:bold;text-align:center;line-height:21px;color:#fff;background:#572946;pointer-events:none}
.cr-native .cr-craft-art{pointer-events:none}.cr-native .cr-page-craft>.cr-status{left:270px;top:702px;width:650px;text-align:center;max-height:44px;overflow:auto}
.cr-native .cr-page-boards>.cr-status:empty{display:none}
.cr-native .m84-crystal-overlay{position:absolute;inset:-50px -15px -20px;z-index:30;background:#0008;display:grid;place-items:center}
.cr-native .m84-crystal-dialog{position:relative;color:#fff;width:420px;height:250px;font:14px Tahoma,sans-serif}
.cr-native .m84-crystal-dialog>.m82-message-box{position:absolute;inset:0;pointer-events:none}
.cr-native .m84-crystal-dialog h3{position:absolute;left:45px;top:25px;width:330px;text-align:center;margin:0;font-size:16px}
.cr-native .m84-crystal-dialog .cr-dialog-copy{position:absolute;left:45px;top:65px;width:330px;margin:0;white-space:pre-line;font-size:13px;line-height:20px}
.cr-native .m84-crystal-dialog select{position:absolute;left:60px;top:100px;width:300px;height:32px;background:#075d8d;color:white;border:1px solid #83c8e2;font:14px Tahoma,sans-serif}
.cr-native .m84-crystal-dialog .cr-dialog-action{position:absolute;top:185px;width:110px;height:32px;padding:0;border:0;color:#fff;font-weight:bold;background-size:100% 100%;background-color:transparent;box-shadow:none}
.cr-native .m84-crystal-dialog .cr-dialog-action:first-of-type{left:90px}.cr-native .m84-crystal-dialog .cr-dialog-action:last-of-type{left:220px}
`;
