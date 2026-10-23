const assert = require("node:assert/strict");
const g = require("../games/snake/game.js");
let checks = 0;
function check(name, run) { run(); checks++; console.log(`ok ${checks} - ${name}`); }
function playing(walls = true) { const s = g.freshState(walls, () => 0); s.phase = "playing"; return s; }

check("fresh state is valid, food never spawns on the snake", () => {
  for (const r of [0, .3, .999]) {
    const s = g.freshState(true, () => r);
    assert(g.validState(s));
    assert(!s.snake.some(([x, y]) => x === s.food[0] && y === s.food[1]));
  }
});
check("reverse turns are ignored and at most two turns are buffered", () => {
  const s = playing();
  assert.equal(g.turn(s, "left"), false);
  assert.equal(g.turn(s, "up"), true);
  assert.equal(g.turn(s, "down"), false);
  assert.equal(g.turn(s, "left"), true);
  assert.equal(g.turn(s, "down"), false);
  g.step(s); assert.equal(s.dir, "up");
  g.step(s); assert.equal(s.dir, "left");
});
check("eating grows the snake, scores 10 and speeds up", () => {
  const s = playing();
  const [hx, hy] = s.snake[0];
  s.food = [hx + 1, hy];
  const before = g.delay(s);
  assert.equal(g.step(s, () => 0), "eat");
  assert.equal(s.snake.length, 4);
  assert.equal(s.score, 10);
  assert(g.delay(s) < before);
  assert(g.validState(s));
});
check("walls end the run; without walls the snake wraps", () => {
  const walled = playing(true);
  walled.food = [0, 0];
  for (let i = 0; i < g.SIZE; i++) if (g.step(walled) === "die") break;
  assert.equal(walled.phase, "over");
  const open = playing(false);
  open.food = [0, 0];
  for (let i = 0; i < g.SIZE; i++) assert.notEqual(g.step(open), "die");
  assert.equal(open.phase, "playing");
  assert(g.validState(open));
});
check("running into the body ends the run but chasing the tail is allowed", () => {
  const s = playing();
  s.snake = [[5, 5], [6, 5], [6, 6], [5, 6], [4, 6]];
  s.dir = "left"; s.score = 20; s.food = [0, 0];
  g.turn(s, "down");
  assert.equal(g.step(s), "die");
  const tail = playing();
  tail.snake = [[5, 5], [6, 5], [6, 6], [5, 6]];
  tail.dir = "left"; tail.score = 10; tail.food = [0, 0];
  g.turn(tail, "down");
  assert.equal(g.step(tail), null);
  assert.deepEqual(tail.snake[0], [5, 6]);
});
check("eating the last free cell is a win", () => {
  const cells = [];
  for (let y = 0; y < g.SIZE; y++) for (let x = 0; x < g.SIZE; x++) cells.push(y % 2 ? [g.SIZE - 1 - x, y] : [x, y]);
  const s = playing();
  s.snake = cells.slice(1);
  s.dir = "left"; s.food = cells[0]; s.score = (s.snake.length - 3) * 10;
  assert(g.validState(s));
  assert.equal(g.step(s), "win");
  assert.equal(s.phase, "over");
  assert.equal(s.won, true);
});
check("save validation rejects corrupt or inconsistent states", () => {
  const ok = playing();
  assert(g.validState(ok));
  for (const mutate of [
    (s) => { s.phase = "over"; },
    (s) => { s.snake[1] = [s.snake[0][0] + 3, s.snake[0][1]]; },
    (s) => { s.snake.push(s.snake[0]); },
    (s) => { s.food = s.snake[0]; },
    (s) => { s.score = 999; },
    (s) => { s.dir = "north"; },
    (s) => { s.queue = ["up", "left", "down"]; },
    (s) => { s.queue = ["left"]; },
    (s) => { s.queue = ["right"]; },
    (s) => { s.queue = ["up", "down"]; },
    (s) => { s.queue = ["up", "up"]; },
    (s) => { s.walls = "yes"; },
  ]) {
    const s = structuredClone(ok);
    mutate(s);
    assert.equal(g.validState(s), false);
  }
});
console.log(`${checks} Snake checks passed.`);
