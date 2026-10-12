const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../games/flappy-bird/game.js'), 'utf8');
const core = vm.createContext({});
vm.runInContext(source.split('// Browser wiring')[0] + `
  globalThis.game = { newState, update, collide, readRecord, revive, STEP, GRAVITY, FLAP_SPEED };
`, core);
const { newState, update, collide, readRecord, revive, STEP, GRAVITY, FLAP_SPEED } = core.game;
const clone = (value) => JSON.parse(JSON.stringify(value));
const flying = () => ({ ...newState(), phase: 'playing', birdV: FLAP_SPEED });

const bird = flying();
const startY = bird.birdY;
for (let i = 0; i < 24; i++) update(bird);
assert.ok(Math.abs(bird.birdV - (FLAP_SPEED + GRAVITY * STEP * 24)) < 1e-8);
assert.ok(Math.abs(bird.birdY - (startY + FLAP_SPEED * STEP * 24 + GRAVITY * STEP ** 2 * 24 * 25 / 2)) < 1e-8);
assert.equal(bird.phase, 'playing');
bird.paused = true;
const paused = clone(bird);
update(bird);
assert.deepEqual(clone(bird), paused);

const scoring = flying();
scoring.birdY = 160;
scoring.pipes = [{ x: .5, gapY: 100, scored: false }, { x: 190.5, gapY: 100, scored: false }];
assert.deepEqual(Array.from(update(scoring)), ['point']);
assert.equal(scoring.score, 1);
update(scoring);
assert.equal(scoring.score, 1);
const fatal = { ...flying(), birdY: 380, birdV: 0, pipes: clone(scoring.pipes) };
fatal.pipes[0].scored = false;
assert.deepEqual(Array.from(update(fatal)), ['hit', 'die']);
assert.equal(fatal.score, 0);
const wall = flying();
wall.pipes[0] = { x: 70, gapY: 70, scored: false };
assert.equal(collide(wall), true);
assert.deepEqual(Array.from(update(wall)), ['hit', 'die']);
const frozenX = wall.pipes[0].x;
const deathEvents = [];
for (let i = 0; i < 240; i++) deathEvents.push(...update(wall));
assert.equal(wall.phase, 'results');
assert.equal(wall.birdY, 376);
assert.equal(wall.pipes[0].x, frozenX);
assert.deepEqual(deathEvents, ['swoosh']);
for (const y of [-4, 380]) assert.equal(collide({ ...flying(), birdY: y }), true);
assert.equal(collide({ ...flying(), birdY: 150, pipes: [{ x: 60, gapY: 100 }] }), false);

const saved = { version: 3, bestScore: 2, muted: true, current: flying() };
const load = (value) => readRecord(JSON.stringify(value));
assert.equal(load(saved).current.paused, true);
assert.equal(load(saved).muted, true);
for (const raw of ['null', '[]', '42', '{broken']) assert.equal(readRecord(raw).current, null);
for (const change of [
  { birdY: -20 }, { birdY: 999 }, { birdV: 601 }, { birdV: null },
  { score: -1 }, { score: 1.5 }, { score: 1000000 }, { paused: 'false' },
  { baseOffset: 1 }, { phase: 'dying' }, { pipes: [] },
  { pipes: [{ x: 238, gapY: 0, scored: false }, saved.current.pipes[1]] },
  { pipes: [{ ...saved.current.pipes[0], scored: true }, saved.current.pipes[1]] },
  { pipes: [saved.current.pipes[0], { ...saved.current.pipes[1], x: 440 }] },
]) assert.equal(load({ ...saved, current: { ...saved.current, ...change } }).current, null);
assert.equal(load({ ...saved, version: 2 }).current, null);
assert.equal(load({ ...saved, bestScore: '999', muted: 'true' }).bestScore, 0);
assert.equal(load({ ...saved, bestScore: '999', muted: 'true' }).muted, false);
// Every generated live snapshot must be accepted, including pipe spawn/removal boundaries.
const live = flying();
let points = 0;
for (let i = 0; i < 2400; i++) {
  live.birdY = 150;
  live.birdV = 0;
  live.pipes.forEach((p) => { p.gapY = 100; });
  points += update(live).filter((event) => event === 'point').length;
  assert.ok(load({ ...saved, current: live }).current, `Rejected live save at tick ${i}`);
}
assert.equal(live.score, points);
assert.ok(points > 5);
const comeback = { ...clone(wall), score: 7 };
comeback.pipes.unshift({ x: -30, gapY: 100, scored: true });
assert.equal(revive(comeback), true);
assert.equal(comeback.score, 7);
assert.equal(comeback.paused, true);
assert.equal(comeback.revived, true);
assert.equal(collide(comeback), false);
assert.equal(comeback.pipes[0].x, 238);
assert.ok(comeback.pipes.every(p => !p.scored));
assert.equal(load({ ...saved, current: comeback }).current.revived, true);
comeback.phase = 'results';
const used = clone(comeback);
assert.equal(revive(comeback), false);
assert.deepEqual(clone(comeback), used);
for (const phase of ['ready', 'playing', 'dying']) assert.equal(revive({ ...newState(), phase }), false);
assert.equal(newState().revived, false);
for (const revived of [1, 'false', null]) assert.equal(load({ ...saved, current: { ...saved.current, revived } }).current, null);
const legacy = clone(saved); delete legacy.current.revived;
assert.equal(load(legacy).current.revived, false);
console.log('PASS: physics, scoring, death, one revival per run and bounded save validation.');
