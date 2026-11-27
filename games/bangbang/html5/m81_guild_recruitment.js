// CorpsRecruitSettingFrame: native 472×359, exact embedded bitmap skins.
// Native LadderTool dropdown source is unavailable: retain explicit numeric
// native-contract limit editor (0 disables requirement), never invent ranks.
import {element,assetImage,note} from './m8_ui_helpers.js';
function at(n,x,y,w,h){Object.assign(n.style,{position:'absolute',left:`${x}px`,top:`${y}px`,...(w?{width:`${w}px`}:{}),...(h?{height:`${h}px`}:{})});return n;}
export function renderGuildRecruitment(ui,host,account,send,recruitmentFlags) {
 const edits=ui.recruitEdits ||= {level:false,description:false};
 const g=account.guild,assets=ui.assets?.panels?.assets||{},panel=element('section',null,'m81-guild-recruitment');
 Object.assign(panel.style,{position:'relative',width:'472px',height:'359px',font:'bold 14px Tahoma,sans-serif',color:'#fff'});panel.setAttribute('aria-label','Thiết lập tuyển thành viên');
 const art=(name,x,y)=>{const a=assets['recruit.'+name];if(a)panel.append(at(assetImage(a),x,y,a.width,a.height));};
 for(let i=1;i<=6;i++)art(`img_recruit_${i}_t`,27,22+40*(i-1));
 art('img_input_322x36',123,16);art('img_input_425x105',21,246);
 function skin(b,key){const a=assets['recruit.'+key];if(a){b.textContent='';b.append(assetImage(a));}Object.assign(b.style,{padding:'0',border:'none',background:'transparent'});return b;}
 const level=ui.input('gm-limit-2',g.minLevel,{type:'number'});level.min='1';level.max='100';level.setAttribute('aria-label','Cấp tối thiểu');level.readOnly=!edits.level;
 Object.assign(level.style,{background:'transparent',border:'none',color:'#fff',font:'bold 14px Tahoma,sans-serif'});panel.append(at(level,137,19,194,27));
 const levelSave=send(ui,'Lưu cấp tối thiểu','Áp dụng điều kiện cấp.','setting',()=>{const value=Number(level.value);if(!Number.isInteger(value)||value<1||value>100)throw new Error('Cấp tối thiểu: 1–100.');edits.level=false;return {kind:2,value};},{testId:'guild-level-save'});
 levelSave.hidden=!edits.level;levelSave.setAttribute('aria-label','Lưu cấp tối thiểu');panel.append(at(skin(levelSave,'btn_confirm_t'),366,18));
 const levelEdit=ui.button('Chỉnh sửa cấp tối thiểu',()=>{edits.level=true;level.readOnly=false;levelEdit.hidden=true;levelSave.hidden=false;level.focus();},{disabled:!ui.canMutate(),testId:'guild-level-edit'});levelEdit.setAttribute('aria-label','Chỉnh sửa cấp tối thiểu');levelEdit.hidden=!!edits.level;panel.append(at(skin(levelEdit,'btn_edit_t'),366,18));
 const ladder=ui.input('gm-limit-3',g.minLadder,{type:'number'});ladder.min='0';ladder.max='100000';ladder.setAttribute('aria-label','Giới hạn xếp hạng native (0: không yêu cầu)');ladder.title='Danh sách nhãn hạng gốc chưa có; giá trị lớn hơn 0 sẽ chặn gia nhập khi xếp hạng chưa mở.';
 Object.assign(ladder.style,{background:'#123b52',color:'#fff',border:'1px solid #1b91b4',font:'bold 14px Tahoma,sans-serif'});panel.append(at(ladder,130,60,225,26));
 const ladderSave=send(ui,'Lưu giới hạn xếp hạng','Xếp hạng chưa mở: giá trị lớn hơn 0 sẽ chặn gia nhập.','setting',()=>{const value=Number(ladder.value);if(!Number.isInteger(value)||value<0||value>100000)throw new Error('Giới hạn: 0–100.000.');return {kind:3,value};},{testId:'guild-ladder-save'});ladderSave.setAttribute('aria-label','Lưu giới hạn xếp hạng');panel.append(at(skin(ladderSave,'btn_confirm_t'),366,58));
 for(const [bit,label,y] of [[1,'Tự động tiếp nhận',102],[2,'Đóng đơn xin vào',142],[4,'Cho thành viên mời người',182]]){
  const on=!!(g.settings&bit),b=send(ui,(on?'Tắt: ':'Bật: ')+label,'Thay đổi quyền tuyển thành viên.','setting',()=>{const current=ui.snapshot.account?.guild,uuid=ui.snapshot.meta?.character?.charUuid;if(!current||!uuid||![current.leaderUuid,current.viceLeaderUuid].includes(uuid))throw new Error('Bạn không còn quyền chỉnh tuyển thành viên.');return {kind:1,value:recruitmentFlags(current.settings,bit,!on)};},{testId:`guild-setting-${bit}`});
  b.setAttribute('role','checkbox');b.setAttribute('aria-checked',String(on));b.setAttribute('aria-label',label);panel.append(at(skin(b,on?'checkbox_checked':'checkbox_bk'),284,y,24,24));
 }
 const desc=element('textarea');desc.value=ui.fields['gm-recruit']??g.recruitNotice??'';desc.maxLength=1000;desc.dataset.accountField='gm-recruit';desc.setAttribute('aria-label','Lời tuyển thành viên');desc.readOnly=!edits.description;
 Object.assign(desc.style,{boxSizing:'border-box',background:'transparent',border:'none',resize:'none',color:'#fff',font:'14px Tahoma,sans-serif'});desc.addEventListener('input',()=>ui.fields['gm-recruit']=desc.value);panel.append(at(desc,30,252,408,92));
 const save=send(ui,'Lưu lời tuyển thành viên','Lưu nội dung tuyển thành viên.','recruit',()=>{if(new TextEncoder().encode(desc.value).length>1000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(desc.value))throw new Error('Tối đa 1.000 byte UTF-8, không chứa ký tự điều khiển.');edits.description=false;return{text:desc.value};},{testId:'guild-save-recruit'});save.hidden=!edits.description;save.setAttribute('aria-label','Lưu lời tuyển thành viên');panel.append(at(skin(save,'btn_confirm_t'),367,201));
 const edit=ui.button('Sửa giới thiệu tuyển thành viên',()=>{edits.description=true;desc.readOnly=false;edit.hidden=true;save.hidden=false;desc.focus();},{disabled:!ui.canMutate(),testId:'guild-recruit-edit'});edit.setAttribute('aria-label','Sửa giới thiệu tuyển thành viên');edit.hidden=!!edits.description;panel.append(at(skin(edit,'btn_edit_dec_t'),346,201));
 host.append(panel,note('Xếp hạng thi đấu chưa mở: yêu cầu hạng lớn hơn 0 sẽ chặn gia nhập.'));return panel;
}
