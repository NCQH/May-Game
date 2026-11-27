// CrystalTool.getSchemeAttrDesc/getCrystalSchemeTotalLevel: sum by (type,valueType),
// display one decimal with a trailing zero removed. This is draft preview only.
export const CRYSTAL_ATTRIBUTE_NAMES={2:'Phòng thủ',4:'Tấn công vật lý',5:'Tấn công năng lượng',6:'Giáp vật lý',7:'Giáp năng lượng',8:'Xuyên giáp vật lý',9:'Xuyên giáp năng lượng',10:'Tốc độ bắn',11:'Tốc độ di chuyển',12:'HP',16:'Hồi chiêu kỹ năng tank',26:'Hồi HP mỗi 5 giây',27:'Chí mạng đánh thường',28:'Hút máu đánh thường',29:'Hút máu kỹ năng'};
export function crystalAttributeText(type,valueType,value){
 const v=Number(value),scaled=valueType===2?v*100:v;
 return `${CRYSTAL_ATTRIBUTE_NAMES[type]||`Thuộc tính ${type}`}: ${v<0?'':'+'}${scaled.toFixed(1).replace(/\.0$/,'')}${valueType===2?'%':''}`;
}
export function crystalBoardPreview(items,catalog){
 const totals=new Map();let level=0;
 for(const id of items||[]){const item=catalog.items[id];if(!item)continue;level+=item.level;
  for(const a of item.attributes){const key=`${a.type}:${a.valueType}`,row=totals.get(key)||{type:a.type,valueType:a.valueType,value:0};row.value+=Number(a.value);totals.set(key,row);}}
 return {level,attributes:[...totals.values()],text:[...totals.values()].map(a=>crystalAttributeText(a.type,a.valueType,a.value)).join('\n')};
}

export const CRYSTAL_DIALOG_GEOMETRY=Object.freeze({
 boards:{width:974,height:580,contentWidth:954,contentHeight:550,left:10,top:20,title:'img_title_t'},
 craft:{width:1230,height:870,contentWidth:1200,contentHeight:800,left:15,top:50,title:'img_crystal_make_t'},
 exchange:{width:900,height:580,contentWidth:900,contentHeight:560,left:0,top:20,title:'img_convert_title_t'},
 sell:{width:706,height:518,contentWidth:676,contentHeight:488,left:15,top:20,title:'img_title_sell_t'}
});
// Flex TileList is virtualized: preserve its five columns / 125x185 cells in DOM.
export function crystalSaleWindow(available,catalog,scrollTop=0){
 const groups=Object.values(catalog.items).filter(i=>available[i.itemId]>0).map(item=>({item,count:available[item.itemId]}));
 const total=groups.reduce((n,g)=>n+g.count,0);scrollTop=Math.min(Math.max(0,scrollTop),Math.max(0,Math.ceil(total/5)*185-370));
 const start=Math.max(0,(Math.floor(scrollTop/185)-1)*5),end=Math.min(total,start+30),entries=[];
 let offset=0;for(const g of groups){for(let i=Math.max(0,start-offset);i<Math.min(g.count,end-offset);i++)entries.push({item:g.item,ordinal:i,index:offset+i});offset+=g.count;if(offset>=end)break;}
 return {total,height:Math.ceil(total/5)*185,scrollTop,entries};
}
