const assert = require('node:assert/strict');
const t = require('../games/tetris/game.js');
let checks = 0;
function check(name, run) { run(); checks++; console.log(`ok ${checks} - ${name}`); }
function piece(type, rotation = 0, x = 3, y = 16) { const s = t.freshState(); s.active = { type, rotation, x, y }; return s; }
check('seven-bag contains all seven types in every bag', () => {
  const s = { queue: [], bag: [] }, sequence = [];
  for (let i = 0; i < 140; i++) { t.fillQueue(s, () => .37); sequence.push(s.queue.shift()); }
  for (let i = 0; i < sequence.length; i += 7) assert.equal(new Set(sequence.slice(i,i+7)).size,7);
});
check('ghost agrees with hard drop; immediate lock and hold once per piece', () => {
  const s = piece('O',0,4,0), y = t.ghostY(s);
  assert.equal(y,18); assert.equal(t.holdPiece(s),true); assert.equal(t.holdPiece(s),false);
  s.active = { type: 'O', rotation: 0, x: 4, y: 0 };
  assert.equal(t.hardDrop(s).event,'lock'); assert.equal(s.score,36); assert.equal(s.board[19][4],'O');
  assert.equal(s.holdUsed,false); assert.equal(t.holdPiece(s),true);
});
check('SRS CW/CCW transitions and I/JLSTZ wall/floor kicks', () => {
  for (const type of ['I','J','L','S','T','Z']) {
    const s = piece(type,0,3,8);
    for (let r = 0; r < 4; r++) assert.equal(t.rotate(s),true);
    assert.equal(s.active.rotation,0);
    for (let r = 0; r < 4; r++) assert.equal(t.rotate(s,-1),true);
    assert.equal(s.active.rotation,0);
    assert.deepEqual(t.matrix(type,4),t.matrix(type,0));
  }
  const wall = piece('T',1,-1,8); assert(t.valid(wall)); assert(t.rotate(wall,-1)); assert.equal(wall.active.x,0);
  const iWall = piece('I',1,-2,8); assert(t.valid(iWall)); assert(t.rotate(iWall,-1)); assert.equal(iWall.active.x,0);
  const floor = piece('T',0,3,18); assert(t.rotate(floor)); assert.equal(floor.active.y,17);
  const iFloor = piece('I',0,3,18); assert(t.rotate(iFloor)); assert.equal(iFloor.active.y,16);
  const blocked = piece('T',0,3,8); blocked.board = blocked.board.map(row => row.map(() => 'I'));
  t.matrix('T').forEach((row,y)=>row.forEach((bit,x)=>{if(bit) blocked.board[8+y][3+x]=null;}));
  const before = JSON.stringify(blocked.active); assert.equal(t.rotate(blocked),false); assert.equal(JSON.stringify(blocked.active),before);
});
check('500ms lock delay, bounded successful resets, blocked moves do not reset', () => {
  const s = piece('O',0,4,18);
  assert.equal(t.advance(s,499),false); assert.equal(s.lock,499);
  for (let n = 0; n < 15; n++) { assert(t.move(s,n%2 ? 1 : -1,0)); assert.equal(s.lock,0); t.advance(s,20); }
  assert.equal(s.resets,15); const lock = s.lock; assert(t.move(s,1,0)); assert.equal(s.lock,lock);
  assert.equal(t.advance(s,480).event,'lock');
  const blocked = piece('O',0,0,18); t.advance(blocked,450); assert.equal(t.move(blocked,-1,0),false); assert.equal(blocked.lock,450);
  assert.equal(t.advance(blocked,50).event,'lock');
});
check('top-out does not write above the board', () => {
  const s = piece('T',0,3,-1); s.board[1][3]='I'; s.board[1][4]='I'; s.board[1][5]='I';
  assert(t.valid(s)); assert.equal(t.lockPiece(s).event,'over'); assert(s.over); assert.equal(s.active,null);
});
check('T-spin front corners, mini and fifth-kick promotion', () => {
  const s = piece('T',0,3,10); s.lastRotate = true;
  for (const [x,y] of [[3,10],[5,10],[3,12]]) s.board[y][x]='J';
  assert.equal(t.spinType(s),'full'); s.lastRotate=false; assert.equal(t.spinType(s),'');
  s.lastRotate=true; s.board[10][5]=null; s.board[12][5]='J'; assert.equal(t.spinType(s),'mini');
  s.kick=4; assert.equal(t.spinType(s),'full');
  const drop=piece('T',0,3,17); drop.lastRotate=true;
  for(const [x,y] of [[3,17],[5,17],[3,19]]) drop.board[y][x]='J';
  t.hardDrop(drop); assert(drop.message.startsWith('T-spin'));
});
check('clear scoring, combo, B2B, no-clear preservation and level scaling', () => {
  const s = t.freshState();
  assert.equal(t.scoreClear(s,4,''),800);
  assert.equal(t.scoreClear(s,4,''),1250); assert(s.message.includes('B2B'));
  assert.equal(t.scoreClear(s,0,''),0); assert(s.b2b); assert.equal(s.combo,-1);
  assert.equal(t.scoreClear(s,1,'full'),1200);
  assert.equal(t.scoreClear(s,1,''),150); assert.equal(s.b2b,false); assert.equal(s.level,2);
  assert.equal(t.scoreClear(s,0,'mini'),200);
  assert.equal(t.scoreClear(s,2,'full'),2400);
});
check('actual four-row clear removes rows and spawns next piece', () => {
  const s = piece('I',1,2,16);
  for (let y=16;y<20;y++) s.board[y]=Array.from({length:10},(_,x)=>x===4?null:'J');
  assert(t.valid(s)); const result=t.lockPiece(s); assert.equal(result.rows.length,4); assert.equal(s.lines,4); assert.equal(s.score,800);
  assert(s.board.every(row=>row.every(cell=>cell===null)));
});
check('mode timers freeze during pause; Sprint and Blitz finish correctly', () => {
  for (const mode of ['marathon','sprint','blitz']) { const s=t.freshState(mode); s.paused=true; t.advance(s,1000); assert.equal(s.elapsed,0); }
  const blitz=t.freshState('blitz'); blitz.elapsed=119950.5; assert.equal(t.advance(blitz,100).event,'over'); assert.equal(blitz.elapsed,120000); assert(blitz.won);
  const sprint=piece('I',1,2,16); sprint.mode='sprint'; sprint.lines=36; sprint.level=4;
  for(let y=16;y<20;y++) sprint.board[y]=Array.from({length:10},(_,x)=>x===4?null:'J');
  t.lockPiece(sprint); assert.equal(sprint.lines,40); assert(sprint.won); assert.equal(sprint.active,null);
});
check('final Blitz frame simulates locks before the deadline', () => {
  const s=piece('O',0,4,18); s.mode='blitz'; s.elapsed=119950; s.lock=490;
  for (let y=18;y<20;y++) s.board[y]=Array.from({length:10},(_,x)=>x===4||x===5?null:'J');
  assert.equal(t.advance(s,100).event,'over'); assert.equal(s.lines,2); assert.equal(s.score,300); assert.equal(s.elapsed,120000);
});
check('locking preserves frame remainder and records exact Sprint completion time', () => {
  const s=piece('O',0,4,18); s.lock=490;
  assert.equal(t.advance(s,1000).event,'lock'); assert.equal(s.elapsed,1000);
  assert.equal(s.active.y,0); assert.equal(s.gravity,230);
  const sprint=piece('I',1,2,16); sprint.mode='sprint'; sprint.lines=36; sprint.level=4; sprint.elapsed=1000; sprint.lock=495;
  for(let y=16;y<20;y++) sprint.board[y]=Array.from({length:10},(_,x)=>x===4?null:'J');
  assert.equal(t.advance(sprint,1000).event,'over'); assert.equal(sprint.elapsed,1005);
  const r=t.blankRecord(); t.updateRecord(r,sprint); assert.equal(r.records.sprint,1005);
});
check('impossible full-row saves are discarded without losing mode records', () => {
  const r=t.blankRecord(); r.records={marathon:123,sprint:45678,blitz:789}; r.current=piece('O',0,4,0);
  for(let y=15;y<20;y++) r.current.board[y].fill('I');
  const restored=t.readRecord(JSON.stringify(r)); assert.equal(restored.current,null); assert.deepEqual(restored.records,r.records);
});
check('mode records remain separate and Sprint records only completed times', () => {
  const r=t.blankRecord(), s=t.freshState(); s.score=123; t.updateRecord(r,s); assert.equal(r.records.marathon,123);
  s.mode='blitz'; s.score=400; t.updateRecord(r,s); assert.equal(r.records.blitz,400);
  s.mode='sprint'; s.elapsed=65432.1; t.updateRecord(r,s); assert.equal(r.records.sprint,null);
  s.won=true; t.updateRecord(r,s); assert.equal(r.records.sprint,65432.1); s.elapsed=70000; t.updateRecord(r,s); assert.equal(r.records.sprint,65432.1);
});
check('strict save validation, fractional clocks, migration and paused restoration', () => {
  const r=t.blankRecord(); r.current=t.freshState(); r.current.elapsed=1234.5; r.current.gravity=25.75; r.muted=true;
  const raw=JSON.stringify(r); const restored=t.readRecord(raw); assert(restored.current.paused); assert(restored.muted);
  assert.equal(t.readRecord('{broken').current,null);
  const old=t.readRecord(JSON.stringify({version:1,bestScore:777,current:r.current})); assert.equal(old.records.marathon,777); assert.equal(old.current,null);
  for (const mutate of [s=>s.board[0].pop(),s=>s.board[0][0]='#123456',s=>s.queue[0]='__proto__',s=>s.queue[0]=['T'],s=>s.board[0][0]=['I'],s=>s.mode=['marathon'],s=>s.active.type='constructor',s=>s.active.rotation=4,s=>s.score=-1,s=>s.score='10',s=>s.resets=16,s=>s.lock=501,s=>s.holdUsed=1,s=>s.level=99,s=>s.active.y=20,s=>s.board[0][4]='J']) {
    const bad=JSON.parse(raw); mutate(bad.current); assert.equal(t.readRecord(JSON.stringify(bad)).current,null);
  }
  const invalid=t.readRecord(JSON.stringify({version:2,records:{marathon:-1,blitz:0,sprint:null},muted:false})); assert.equal(invalid.records.marathon,0);
});
check('DAS 150ms / ARR 40ms and soft-drop 35ms repeat are frame-driven', () => {
  const h={action:'left',time:0,next:150}, actions=[];
  t.repeatInput(h,149,a=>actions.push(a)); assert.equal(actions.length,0);
  t.repeatInput(h,1,a=>actions.push(a)); assert.equal(actions.length,1);
  t.repeatInput(h,80,a=>actions.push(a)); assert.equal(actions.length,3);
  const d={action:'down',time:0,next:35}; t.repeatInput(d,105,a=>actions.push(a)); assert.equal(actions.length,6);
});
console.log(`${checks} Tetris checks passed.`);
