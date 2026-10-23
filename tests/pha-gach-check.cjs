const assert = require('node:assert/strict');
const g = require('../games/pha-gach/game.js');
let checks = 0;
function check(name, run) { run(); checks++; console.log(`ok ${checks} - ${name}`); }
const never = () => .99, always = () => 0;
// A playing state with a custom brick layout (list of [index, code]) and the ball in flight.
function playing(bricks = [], ball = {}) {
  const s = g.freshState(); s.phase = 'playing'; s.bricks = new Array(g.COLS * g.ROWS).fill(0);
  for (const [i, code] of bricks) s.bricks[i] = code;
  Object.assign(s.ball, { stuck: false, ...ball });
  return s;
}
const run = (s, steps, random = never) => { const events = []; for (let i = 0; i < steps && s.phase === 'playing'; i++) events.push(...g.step(s, 0, random)); return events; };

check('all levels are 12 columns wide, fit the grid and use known symbols', () => {
  assert(g.LEVELS.length >= 6);
  for (const { map } of g.LEVELS) {
    assert(map.length <= g.ROWS);
    for (const row of map) assert(row === '' || (row.length === g.COLS && /^[.12#]+$/.test(row)), row);
  }
  assert.equal(new Set(g.LEVELS.map(l => l.map.join('|'))).size, g.LEVELS.length);
});
check('every breakable brick is reachable (unbreakable bricks never seal a level)', () => {
  for (let level = 1; level <= g.LEVELS.length; level++) {
    const bricks = g.levelBricks(level), seen = new Set(), queue = [];
    assert(g.remaining(bricks) > 0);
    // Open space surrounds the grid; flood fill over cells that are not steel.
    for (let x = 0; x < g.COLS; x++) queue.push((g.ROWS - 1) * g.COLS + x, x);
    for (let y = 0; y < g.ROWS; y++) queue.push(y * g.COLS, y * g.COLS + g.COLS - 1);
    while (queue.length) {
      const i = queue.pop();
      if (seen.has(i) || bricks[i] === g.STEEL) continue;
      seen.add(i);
      const x = i % g.COLS, y = Math.floor(i / g.COLS);
      if (x > 0) queue.push(i - 1); if (x < g.COLS - 1) queue.push(i + 1);
      if (y > 0) queue.push(i - g.COLS); if (y < g.ROWS - 1) queue.push(i + g.COLS);
    }
    bricks.forEach((code, i) => { if (code && code !== g.STEEL) assert(seen.has(i), `level ${level} brick ${i}`); });
  }
});
check('paddle bounce angle depends on hit position and stays within bounds', () => {
  const speed = 400;
  for (let o = -3; o <= 3; o += .05) {
    const [vx, vy] = g.bounceVelocity(o, speed);
    assert(vy < 0); assert(Math.abs(Math.hypot(vx, vy) - speed) < 1e-9);
    assert(Math.abs(Math.atan2(vx, -vy)) <= g.MAX_ANGLE + 1e-9);
    assert(Math.abs(vy) >= speed * .49, 'never near-horizontal');
  }
  assert.equal(g.bounceVelocity(0, speed)[0], 0);
  assert(g.bounceVelocity(.8, speed)[0] > g.bounceVelocity(.3, speed)[0]);
  assert(g.bounceVelocity(-.5, speed)[0] < 0);
  assert.deepEqual(g.bounceVelocity(NaN, speed), [0, -speed]);
  // Real paddle hit near the right edge sends the ball up and right.
  const s = playing([], { x: g.W / 2 + 36, y: g.PADDLE_Y - 30, vx: 0, vy: 300 });
  const events = run(s, 30);
  assert(events.includes('paddle')); assert(s.ball.vy < 0 && s.ball.vx > 0);
});
check('speed grows with level, is capped, and launch uses the level speed', () => {
  assert(g.speedFor(2) > g.speedFor(1)); assert(g.speedFor(7) > g.speedFor(6));
  assert.equal(g.speedFor(500), g.MAX_SPEED);
  const s = g.freshState(3); s.phase = 'playing';
  assert(g.launch(s)); assert(!g.launch(s));
  assert(Math.abs(Math.hypot(s.ball.vx, s.ball.vy) - g.speedFor(3)) < 1e-9);
});
check('fast ball never tunnels through a brick or the paddle', () => {
  const target = 5 * g.COLS + 6, r = g.brickRect(target);
  for (const speed of [g.MAX_SPEED, 4000, 20000]) {
    const s = playing([[target, g.NORMAL]], { x: (r.left + r.right) / 2, y: 400, vx: 0, vy: -speed });
    const events = g.step(s, 0, never).concat(run(s, 60));
    assert(events.includes('brick'), `speed ${speed}`);
    assert.equal(s.bricks[target], 0);
    // The ball bounced back down off the brick instead of passing through to the top wall.
    assert(!events.slice(0, events.indexOf('brick')).includes('wall'));
    const p = playing([], { x: g.W / 2, y: 300, vx: 0, vy: speed });
    assert(run(p, 60).includes('paddle'), `paddle at ${speed}`);
    assert.equal(p.lives, g.START_LIVES);
  }
});
check('brick hits, strong bricks need two hits and cracked state is visible in data', () => {
  const normal = 4 * g.COLS + 2, strong = 4 * g.COLS + 8;
  const a = g.brickRect(normal), b = g.brickRect(strong);
  const s = playing([[normal, g.NORMAL], [0, g.NORMAL]], { x: (a.left + a.right) / 2, y: 300, vx: 0, vy: -400 });
  run(s, 120); assert.equal(s.bricks[normal], 0); assert.equal(s.score, 10);
  const t = playing([[strong, g.STRONG], [0, g.NORMAL]], { x: (b.left + b.right) / 2, y: 300, vx: 0, vy: -400 });
  const first = run(t, 60);
  assert(first.includes('crack')); assert.equal(t.bricks[strong], g.CRACKED); assert.equal(t.score, 5);
  t.ball = { ...t.ball, x: (b.left + b.right) / 2, y: 300, vx: 0, vy: -400, stuck: false };
  assert(run(t, 60).includes('brick')); assert.equal(t.bricks[strong], 0); assert.equal(t.score, 25);
});
check('unbreakable bricks bounce the ball, never break and do not block a level clear', () => {
  const steel = 3 * g.COLS + 5, last = 0, r = g.brickRect(steel);
  const s = playing([[steel, g.STEEL], [last, g.NORMAL]], { x: (r.left + r.right) / 2, y: 300, vx: 0, vy: -400 });
  const events = run(s, 60);
  assert(events.includes('steel')); assert.equal(s.bricks[steel], g.STEEL); assert(s.ball.vy > 0);
  assert.equal(g.remaining(s.bricks), 1);
  const l = g.brickRect(last);
  s.ball = { x: (l.left + l.right) / 2, y: 300, vx: 0, vy: -400, stuck: false };
  const clear = run(s, 120);
  assert(clear.includes('clear')); assert.equal(s.phase, 'cleared'); assert.equal(s.bricks[steel], g.STEEL);
  assert.equal(s.score, 10 + 100);
});
check('losing the ball costs a life and re-sticks it; last life ends the game', () => {
  const s = playing([[0, g.NORMAL]], { x: 20, y: g.H - 20, vx: 0, vy: 400 });
  s.paddle.x = g.W - 60; s.drops = [{ x: 100, y: 100, type: 'life' }]; s.wideTime = 5; s.paddle.w = g.WIDE_W;
  assert(run(s, 30).includes('lost'));
  assert.equal(s.lives, 2); assert(s.ball.stuck); assert.equal(s.ball.x, s.paddle.x); assert.equal(s.phase, 'playing');
  assert.equal(s.drops.length, 0); assert.equal(s.paddle.w, g.PADDLE_W);
  // Stuck ball follows the paddle.
  g.step(s, -1); assert.equal(s.ball.x, s.paddle.x);
  s.lives = 1; s.ball = { x: 20, y: g.H - 20, vx: 0, vy: 400, stuck: false };
  assert(run(s, 30).includes('over')); assert.equal(s.phase, 'over'); assert.equal(s.lives, 0);
  assert.equal(g.toCurrent(s), null);
});
check('walls reflect the ball and keyboard direction moves a clamped paddle', () => {
  const s = playing([[119, g.NORMAL]], { x: 10, y: 400, vx: -400, vy: -300 });
  assert(run(s, 10).includes('wall')); assert(s.ball.vx > 0);
  for (let i = 0; i < 400; i++) g.step(s, 1);
  assert.equal(s.paddle.x, g.W - s.paddle.w / 2);
  g.setPaddle(s, -100); assert.equal(s.paddle.x, s.paddle.w / 2);
});
check('level advance loads the next map, loops after the last level faster', () => {
  const s = g.freshState(); s.phase = 'cleared'; s.score = 300;
  g.nextLevel(s);
  assert.equal(s.level, 2); assert.equal(s.phase, 'playing'); assert(s.ball.stuck); assert.equal(s.paddle.x, g.W / 2);
  assert.deepEqual(s.bricks, g.levelBricks(2));
  const last = g.freshState(g.LEVELS.length); last.phase = 'cleared';
  g.nextLevel(last);
  assert.equal(last.level, g.LEVELS.length + 1); assert.deepEqual(last.bricks, g.levelBricks(1));
  assert(g.speedFor(last.level) > g.speedFor(1));
});
check('power-ups drop deterministically, are caught, and expire', () => {
  const target = 2 * g.COLS + 6, r = g.brickRect(target);
  const s = playing([[target, g.NORMAL], [0, g.NORMAL]], { x: (r.left + r.right) / 2, y: 300, vx: 0, vy: -400 });
  const events = run(s, 60, always);
  assert(events.includes('drop')); assert.equal(s.drops.length, 1); assert.equal(s.drops[0].type, 'wide');
  const n = playing([[target, g.NORMAL], [0, g.NORMAL]], { x: (r.left + r.right) / 2, y: 300, vx: 0, vy: -400 });
  assert(!run(n, 60, never).includes('drop'));
  // Catch the wide drop with a parked stuck ball.
  s.ball.stuck = true; g.setPaddle(s, s.drops[0].x);
  const caught = []; for (let i = 0; i < 600 && s.drops.length; i++) caught.push(...g.step(s));
  assert(caught.includes('power-wide')); assert.equal(s.paddle.w, g.WIDE_W); assert.equal(s.wideTime, g.WIDE_TIME);
  const expiry = []; for (let i = 0; i < Math.ceil(g.WIDE_TIME / g.DT) + 2; i++) expiry.push(...g.step(s));
  assert(expiry.includes('wide-end')); assert.equal(s.paddle.w, g.PADDLE_W); assert.equal(s.wideTime, 0);
  // Extra life, capped.
  const life = playing(); life.ball.stuck = true;
  assert.equal(g.applyPower(life, 'life'), 'power-life'); assert.equal(life.lives, 4);
  life.lives = g.MAX_LIVES; g.applyPower(life, 'life'); assert.equal(life.lives, g.MAX_LIVES);
  // A missed drop falls away.
  life.drops = [{ x: 20, y: g.H - 5, type: 'life' }]; g.setPaddle(life, g.W - 50);
  for (let i = 0; i < 30; i++) g.step(life); assert.equal(life.drops.length, 0);
});
check('simulation is frame-rate independent: same steps give the same state', () => {
  const a = g.freshState(); a.phase = 'playing'; g.launch(a);
  const b = JSON.parse(JSON.stringify(a));
  run(a, 600, never); run(b, 600, never);
  assert.deepEqual(a, b);
  assert.equal(g.step(g.freshState(), 1).length, 0, 'ready state does not move');
});
check('save keeps progress only and validates strictly', () => {
  const s = g.freshState(2); s.phase = 'playing'; s.score = 120; s.lives = 2; s.bricks[s.bricks.indexOf(g.NORMAL)] = 0;
  const firstStrong = s.bricks.indexOf(g.STRONG); s.bricks[firstStrong] = g.CRACKED;
  g.launch(s);
  const c = g.toCurrent(s);
  assert.deepEqual(Object.keys(c).sort(), ['bricks', 'level', 'lives', 'phase', 'score']);
  assert.equal(c.phase, 'paused'); assert(g.validCurrent(JSON.parse(JSON.stringify(c))));
  const r = g.fromCurrent(c);
  assert.equal(r.phase, 'paused'); assert(r.ball.stuck); assert.equal(r.paddle.x, g.W / 2); assert.equal(r.ball.x, g.W / 2);
  assert.equal(r.bricks[firstStrong], g.CRACKED); assert.equal(r.score, 120); assert.equal(r.lives, 2);
  const bad = (patch) => assert.equal(g.validCurrent({ ...c, ...patch }), false, JSON.stringify(patch).slice(0, 60));
  bad({ phase: 'playing' }); bad({ phase: 'over' }); bad({ level: 0 }); bad({ level: 1.5 }); bad({ level: '2' });
  bad({ score: -1 }); bad({ score: 1.2 }); bad({ lives: 0 }); bad({ lives: g.MAX_LIVES + 1 });
  bad({ bricks: c.bricks.slice(1) }); bad({ bricks: 'x' });
  const steelLevel = g.toCurrent(Object.assign(g.freshState(3), { phase: 'paused' }));
  assert(g.validCurrent(steelLevel));
  const steelAt = steelLevel.bricks.indexOf(g.STEEL);
  assert.equal(g.validCurrent({ ...steelLevel, bricks: steelLevel.bricks.map((v, i) => i === steelAt ? 0 : v) }), false, 'steel removed');
  assert.equal(g.validCurrent({ ...c, bricks: c.bricks.map((v, i) => i === c.bricks.indexOf(0) ? 1 : v) }), false, 'brick added');
  assert.equal(g.validCurrent({ ...c, bricks: c.bricks.map((v) => v === g.NORMAL ? g.CRACKED : v) }), false, 'normal cannot crack');
  assert.equal(g.validCurrent({ ...c, bricks: c.bricks.map((v) => v === g.STEEL ? v : 0) }), false, 'cleared board');
  assert.equal(g.validCurrent(null), false); assert.equal(g.validCurrent([]), false);
  // A cleared level is saved as the start of the next one.
  const cleared = g.freshState(6); cleared.phase = 'cleared';
  const next = g.toCurrent(cleared); assert.equal(next.level, 7); assert(g.validCurrent(next));
  assert.equal(g.toCurrent(g.freshState()), null, 'untouched ready game is not a run to continue');
});
check('an autopilot paddle clears every level without the ball leaving the field', () => {
  for (let level = 1; level <= g.LEVELS.length + 1; level++) {
    const s = g.freshState(level); s.phase = 'playing'; g.launch(s);
    let seed = level * 7, steps = 0;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    while (s.phase === 'playing' && steps < 120 * 600) {
      if (s.ball.stuck) g.launch(s);
      g.setPaddle(s, s.ball.x - Math.sin(steps / 997) * s.paddle.w * .4);
      g.step(s, 0, random); steps++;
      const b = s.ball;
      assert(Number.isFinite(b.x + b.y) && b.x >= 0 && b.x <= g.W && b.y >= 0, `level ${level} ball escaped`);
    }
    assert.equal(s.phase, 'cleared', `level ${level}`);
  }
});
console.log(`# ${checks} checks passed`);
