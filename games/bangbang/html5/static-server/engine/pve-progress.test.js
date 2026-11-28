// Runnable self-check for engine/pve-progress.js.
// Run: node games/bangbang/html5/static-server/engine/pve-progress.test.js
import assert from 'node:assert/strict';
import { decodeCrystalPacket } from '../../m8_crystal_protocol.js';
import { decodeCombatPacket } from '../../combat_protocol.js';
import { D } from './math.js';
import {
  REWARD, REWARD_V3, SECOND_PET, STAMINA, defaultProfile, normalizeProfile,
  ProfileStore, memoryStore, evaluate, damageTotals, gradeRun,
  rewardItems, coalesce, awardPacket, deliver, completeRun,
  mapProgress, unlocked, cityRecord, cityBody, chapterProgress,
  settlementPayloadFromEngine, encodeSettlement,
  defaultStamina, staminaNotify, purchaseStamina, entryCost, spendEntry,
  PveProgress, replaceSettlement,
} from './pve-progress.js';

let checks = 0;
const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks += 1; };
const ok = (value, label) => { assert.ok(value, label); checks += 1; };

// ------------------------------------------------------- 1. Python constants
eq([...REWARD], [3700002, 3700002, 3800001], 'legacy reward ids');
eq([...REWARD_V3], [3700002, 3700002, 3800001, 3800002, 4400001, 4400002, 3900002, 4000001],
  'v3 reward ids');
eq(SECOND_PET, 4300000, 'second pet id');
eq([STAMINA.price, STAMINA.gain, STAMINA.max], [1, 100, 32767], 'stamina price/gain/max');
eq(defaultProfile(), {
  clears: 0, last_run: '', pending: 0, best_grade: 0, pending_v3: 0,
  second_pet_earned: false, second_pet_pending: false,
  maps: {}, hard_maps: {}, receipts: {},
}, 'default profile');

// -------------------------------------------------------------- 2. grading
const perfect = evaluate({
  helperPower: 0, recommendedPower: 489, targetSeconds: 180, won: true,
  damage: 1950, damageTotal: 1950, deaths: 0, elapsed: 100,
});
eq(perfect.grades, [6, 5, 5, 5, 3], 'SSS-eligible but helper-less total capped');
eq(perfect.points, 80, 'grading points');
ok(perfect.eligibleSss, 'SSS eligible');
eq(evaluate({ won: true, damage: 1950, damageTotal: 1950, deaths: 0, elapsed: 100,
  targetSeconds: 180, recommendedPower: 489 }).grades.length, 5, 'five grades');

const withHelper = evaluate({
  helperPower: 489, recommendedPower: 489, targetSeconds: 180, won: true,
  damage: 1950, damageTotal: 1950, deaths: 0, elapsed: 100,
});
eq(withHelper.grades, [7, 5, 5, 5, 6], 'matching helper earns grade 6');

eq(evaluate({ won: false, damage: 1950, damageTotal: 1950, deaths: 0, elapsed: 100 }).grades,
  [0, 0, 0, 0, 0], 'loss zeros every grade');
eq(evaluate({ won: false, damage: 1950, damageTotal: 1950, deaths: 0, elapsed: 100 }).points,
  0, 'loss zero points');

// hostiles only: hostage HP is excluded from the denominator
const npcs = new Map([
  [1, { id: 1, camp: 0, hp: D(0), maxHp: D(1000), info: { pve_npc: true } }],
  [2, { id: 2, camp: 0, hp: D(500), maxHp: D(1000), info: { pve_npc: true } }],
  [3, { id: 3, camp: 0, hp: D(1000), maxHp: D(1000), info: { pve_npc: true, pve_hostage: true } }],
]);
const engine = fakeEngine({ npcs });
const totals = damageTotals(engine);
eq(totals.damageTotal.toString(), '2000', 'eligible HP excludes hostage');
eq(totals.damage.toString(), '1500', 'credited damage from current HP');
const graded = gradeRun(engine, { won: true, now: 34000 });
eq(graded.elapsed, 31, 'elapsed from introUntil');
eq(graded.deaths, 1, 'death count');
eq(graded.grades, [4, 4, 4, 5, 3], '75% damage / 1 death / 31s / no helper');

// -------------------------------------------------------------- 3. rewards
const winRule = { version: 3, second_pet: true };
const [awardId, awardBody] = awardPacket(true, winRule);
eq(awardId, 1104, 'award message id');
const decoded = decodeCrystalPacket({ msgId: awardId, payload: awardBody });
eq(decoded.kind, 1, 'award kind 1');
eq(decoded.isShow, 1, 'award isShow');
eq(decoded.trailingBytes, 0, 'award fully decoded');
// Python: <I4iHIH> 28 + 8 rows * <Ii> 8 + <HiHBI> 13 = 105 bytes.
eq(awardBody.byteLength, 105, 'S1104 byte length matches Python struct');
eq(decoded.award.groups, [{
  type: 0,
  items: [
    { itemId: 3700002, count: 2 }, { itemId: 3800001, count: 1 },
    { itemId: 3800002, count: 1 }, { itemId: 4400001, count: 1 },
    { itemId: 4400002, count: 1 }, { itemId: 3900002, count: 1 },
    { itemId: 4000001, count: 1 }, { itemId: 4300000, count: 1 },
  ],
}], 'S1104 real item ids/counts via client decoder');

const [, loseBody] = awardPacket(false, winRule);
const loseAward = decodeCrystalPacket({ msgId: 1104, payload: loseBody });
eq(loseAward.award.groups, [{ type: 0, items: [] }], 'loss still ships one empty group');

const [, legacyBody] = awardPacket(true, { version: 1 });
eq(decodeCrystalPacket({ msgId: 1104, payload: legacyBody }).award.groups[0].items,
  [{ itemId: 3700002, count: 2 }, { itemId: 3800001, count: 1 }], 'legacy reward');
eq(coalesce([5, 5, 6]), [{ itemId: 5, count: 2 }, { itemId: 6, count: 1 }],
  'Counter order + stacking');
eq(rewardItems({ version: 3, second_pet: false }).length, 8, 'v3 without pet');

// ---------------------------------------------------- 4. progress deltas
const profile = defaultProfile();
let result = completeRun(profile, {
  mapId: 201, runId: 'run-201', won: true, rule: winRule, grades: [6, 5, 5, 5, 3],
});
ok(result.changed, 'first completion changes progress');
eq(profile.clears, 1, 'map 201 clears +1');
eq(profile.best_grade, 6, 'best grade updated');
eq(profile.pending_v3, 1, 'v3 pending +1');
eq(profile.pending, 0, 'legacy pending untouched');
eq(profile.second_pet_earned, true, 'second pet earned');
eq(profile.second_pet_pending, true, 'second pet pending');
eq(profile.last_run, 'run-201', 'last run pointer');

const replay = completeRun(profile, {
  mapId: 201, runId: 'run-201', won: true, rule: winRule, grades: [7, 7, 7, 7, 7],
});
eq(replay.changed, false, 'same run receipt is idempotent');
eq(profile.clears, 1, 'idempotent clears');
eq(profile.pending_v3, 1, 'idempotent pending');
eq(profile.best_grade, 6, 'idempotent best grade');

const lossProfile = defaultProfile();
const loss = completeRun(lossProfile, {
  mapId: 201, runId: 'run-lose', won: false, rule: winRule, grades: [0, 0, 0, 0, 0],
});
ok(loss.changed, 'loss records a receipt');
eq(lossProfile.clears, 0, 'loss no clear');
eq(lossProfile.pending_v3, 0, 'loss no pending');
eq(lossProfile.best_grade, 0, 'loss no grade');
eq(lossProfile.second_pet_earned, false, 'loss no second pet');

const secondPetRule = { version: 3, second_pet: true };
const noDouble = completeRun(profile, {
  mapId: 201, runId: 'run-201b', won: true, rule: secondPetRule, grades: [5, 5, 5, 5, 5],
});
eq(profile.clears, 2, 'second 201 win clears');
ok(noDouble.changed, 'second run is a new receipt');
eq(profile.second_pet_earned, true, 'second pet stays earned');
const petGrants = [];
deliver(profile, (itemId, count, level) => petGrants.push({ itemId, count, level }));
eq(petGrants.filter((item) => item.itemId === SECOND_PET),
  [{ itemId: SECOND_PET, count: 1, level: 1 }], 'two clears still grant exactly one second pet');

// --------------------------------------------------------------- 5. deliver
const delivery = defaultProfile();
completeRun(delivery, { mapId: 201, runId: 'deliver-run', won: true, rule: winRule, grades: [5, 5, 5, 5, 5] });
const granted = [];
const delivered = deliver(delivery, (itemId, count, level) => granted.push({ itemId, count, level }));
ok(delivered.ok, 'deliver succeeds with a grant sink');
eq(delivered.granted.length, 8, 'v3 items + second pet granted');
eq(granted.filter((item) => item.itemId === 3700002), [{ itemId: 3700002, count: 2, level: 0 }],
  'duplicate id stacked');
eq(granted.find((item) => item.itemId === SECOND_PET), { itemId: SECOND_PET, count: 1, level: 1 },
  'second pet granted at level 1');
eq([delivery.pending_v3, delivery.second_pet_pending], [0, false], 'pending cleared after delivery');

const kept = defaultProfile();
completeRun(kept, { mapId: 201, runId: 'keep-run', won: true, rule: winRule, grades: [5, 5, 5, 5, 5] });
const noSink = deliver(kept, null);
eq(noSink.ok, false, 'no grant sink leaves the claim pending');
eq([kept.pending_v3, kept.second_pet_pending], [1, true], 'pending preserved without a bag');

const full = defaultProfile();
completeRun(full, { mapId: 201, runId: 'full-run', won: true, rule: winRule, grades: [5, 5, 5, 5, 5] });
const fullBag = deliver(full, () => { throw new Error('full'); });
eq(fullBag.ok, false, 'full bag fails delivery');
eq(fullBag.packets[0][0], 1501, 'full bag returns a tip packet');
eq([full.pending_v3, full.second_pet_pending], [1, true], 'full bag preserves pending');

// ------------------------------------------------------- 6. city / chapters
const cityProfile = defaultProfile();
eq(unlocked(cityProfile, 201), true, 'map 201 starts unlocked');
eq(unlocked(cityProfile, 204), false, 'map 204 locked before 201');
cityProfile.clears = 1;
eq(unlocked(cityProfile, 204), true, 'map 204 unlocks after 201');
eq(unlocked(cityProfile, 5211), false, 'hard 5211 needs normal 211 first');
completeRun(cityProfile, {
  mapId: 211, runId: 'run-211', won: true, rule: { version: 3 }, grades: [5, 5, 5, 5, 5],
});
eq(unlocked(cityProfile, 5211), true, 'hard 5211 unlocks after normal 211');
eq(mapProgress(cityProfile, 211), { clears: 1, best_grade: 5 }, 'normal map record stored');
eq(mapProgress(cityProfile, 211, 1), { clears: 0, best_grade: 0 }, 'hard record independent');

const body = cityBody(cityProfile);
const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
eq(view.getUint16(0, true), 49, '49 city rows');
const record = (index) => {
  const off = 2 + index * 18;
  return {
    cityId: view.getUint32(off, true), flags: view.getUint32(off + 4, true),
    best: view.getUint8(off + 8), hard: view.getUint8(off + 9),
  };
};
eq(record(0), { cityId: 10100, flags: 31, best: 0, hard: 0 }, '1101 cleared record');
eq(record(1).flags, 15, 'unlocked-but-uncleared neighbour');
// Sequential progression: 211 is cleared but still locked (206 is its gate).
eq(record(5), { cityId: 20100, flags: 23, best: 5, hard: 0 }, '211 clear-but-locked record');
eq(cityRecord(0, 0, 201, false).flags, 7, 'locked flags');
eq(cityRecord(1, 3, 201, true, { hardClears: 1, hardGrade: 4 }).flags, 63, 'clear+hard flags');
const chapters = chapterProgress(cityProfile);
eq(chapters['2'], { chapter: 2, total: 6, cleared: 1 }, 'chapter 2 completion');

// -------------------------------------------------- 7. S1708 round-trip
const settlement = settlementPayloadFromEngine(engine, {
  won: true, now: 34000, grades: [7, 5, 4, 5, 6],
});
const [settleId, settleBody] = encodeSettlement(settlement);
eq(settleId, 1708, 'settlement message id');
const battleEnd = decodeCombatPacket(settleId, settleBody);
eq(battleEnd.trailingBytes, 0, 'S1708 fully decoded');
// Python: header 21 + TankSettleInfo 126 + tail 41 + uuid ('run-1') 5 = 193.
eq(settleBody.byteLength, 193, 'S1708 byte length matches Python struct');
eq(battleEnd.sceneId, 901, 'scene id');
eq(battleEnd.mapId, 201, 'map id');
eq(battleEnd.battleTime, 31, 'elapsed seconds');
eq(battleEnd.roomType, 4, 'PvE room type');
eq(battleEnd.winCamp, 1, 'win camp');
eq(battleEnd.winType, 1, 'win type');
eq([battleEnd.redLifeCount, battleEnd.blueLifeCount], [2, 0], 'life counts');
eq(battleEnd.actors.length, 1, 'one settlement row');
eq(battleEnd.actors[0].accountId, 30000791, 'account id');
eq(battleEnd.actors[0].tankId, 10000044, 'tank id');
eq(battleEnd.actors[0].stats.length, 21, '21 stats');
eq(battleEnd.actors[0].isWin, 1, 'actor won');
eq(battleEnd.actors[0].battleLevel, 3, 'tank level');
eq(battleEnd.actors[0].pve, { total: 7, harm: 5, dead: 4, time: 5, booster: 6 }, 'grading row');
eq([battleEnd.actors[0].exp, battleEnd.actors[0].coins, battleEnd.actors[0].tankExp],
  [[], [], []], 'empty exp/coins/tankExp vectors');
eq(battleEnd.escaped, [], 'no escaped rows');
eq(battleEnd.sceneUuid, 'run-1', 'run uuid');
eq([battleEnd.serverExpRate, battleEnd.tokenGoldRate], [1, 1], 'rates');
eq(battleEnd.bpvpActOpen, 0, 'bpvp flag');

const lossSettlement = settlementPayloadFromEngine(engine, {
  won: false, now: 34000, grades: [0, 0, 0, 0, 0],
});
const lossEnd = decodeCombatPacket(1708, encodeSettlement(lossSettlement)[1]);
eq([lossEnd.winCamp, lossEnd.actors[0].isWin], [0, 0], 'loss settlement flags');
eq(lossEnd.actors[0].pve, { total: 0, harm: 0, dead: 0, time: 0, booster: 0 }, 'loss zero grades');

// ------------------------------------------- 8. worker adapter / idempotency
const store = memoryStore();
const runEngine = fakeEngine({ runId: 'class-run' });
const manager = new PveProgress({
  store,
  scoring: { helperPower: 0, recommendedPower: 489, targetSeconds: 360 },
  grant: (itemId, count, level) => granted.push({ itemId, count, level }),
});
eq(manager.hooks.complete(runEngine), undefined, 'complete hook defers to engine');
manager.beginRun({ requestedMapId: 201, runId: 'class-run' });
const settled = manager.settle(runEngine, { won: true, now: 34000 });
ok(settled.changed, 'class settle changes progress');
eq(settled.packets.map((packet) => packet[0]), [1104, 1708, 1304], 'authoritative packet order');
eq(store.load().clears, 1, 'profile persisted');
eq(store.load().pending_v3, 0, 'delivery persisted');
const settledAgain = manager.settle(runEngine, { won: true, now: 34000 });
eq(settledAgain.changed, false, 'class settle is idempotent');
eq(settledAgain.packets, [], 'idempotent settle emits nothing');

const engineFrames = [[1707, new Uint8Array([0])], [1104, new Uint8Array([1])],
  [1708, new Uint8Array([2])]];
const merged = replaceSettlement(engineFrames, settled);
eq(merged.map((frame) => frame[0]), [1707, 1104, 1708, 1304], 'engine defaults replaced');

// -------------------------------------------------------------- 9. stamina
const buyBody = new Uint8Array(10);
new DataView(buyBody.buffer).setUint16(0, 1, true);
new DataView(buyBody.buffer).setUint32(2, STAMINA.cash, true);
new DataView(buyBody.buffer).setInt32(6, STAMINA.price, true);

const stamina = defaultStamina(100, 2, 0);
const wallet = { currency: [5, 0, 0, 0, 0, 0] };
const bought = purchaseStamina({ stamina, wallet, payload: buyBody });
ok(bought.ok, 'stamina purchase succeeds');
eq([bought.stamina.thew, bought.stamina.thew_buy], [200, 3], '100 thew / +1 purchase');
eq(bought.wallet.currency, [4, 0, 0, 0, 0, 0], '1 Xu deducted');
eq([bought.packets[0][0], bought.packets[1][0]], [1039, 1027], 'wallet + thew notifications');
const currencyView = new DataView(bought.packets[0][1].buffer);
eq([currencyView.getUint16(0, true), currencyView.getUint16(2, true)],
  [2, 0], 'S1039 header');
eq([currencyView.getInt32(4, true), currencyView.getInt32(8, true)], [4, 0], 'S1039 currency');
const notifyView = new DataView(bought.packets[1][1].buffer);
eq([notifyView.getInt32(0, true), notifyView.getInt32(4, true), notifyView.getInt32(8, true)],
  [200, 3, 0], 'S1027 thew snapshot');
eq([stamina.thew, wallet.currency[0]], [100, 5], 'inputs not mutated');

const poor = { currency: [0, 0, 0, 0, 0, 0] };
const broke = purchaseStamina({ stamina, wallet: poor, payload: buyBody });
eq(broke.ok, false, 'insufficient Xu rejected');
ok(/không đủ 1 xu vàng/.test(broke.error), 'insufficient error message');
eq(broke.packets[0][0], 1501, 'insufficient returns a tip');
eq([poor.currency[0], stamina.thew], [0, 100], 'insufficient leaves balances');

const nearMax = purchaseStamina({
  stamina: defaultStamina(32700, 0, 0), wallet, payload: buyBody,
});
eq(nearMax.ok, false, 'near-max thew rejected');
ok(/gần giới hạn native/.test(nearMax.error), 'near-max error message');

const badBody = purchaseStamina({
  stamina: defaultStamina(0, 0, 0), wallet, payload: new Uint8Array(10),
});
eq(badBody.ok, false, 'zero request rejected');
ok(/100 thể lực/.test(badBody.error), 'invalid request message');

const inBattle = purchaseStamina({
  stamina: defaultStamina(0, 0, 0), wallet, payload: buyBody, state: { battle: {} },
});
ok(/sảnh hoặc phòng chờ/.test(inBattle.error), 'lobby-only guard');

eq(entryCost({ stamina: { entryItem: null, entryCount: null } }), 0, 'offline entry is free');
eq(spendEntry(defaultStamina(50, 0, 0), { stamina: { entryItem: null } }),
  { ok: true, cost: 0, stamina: defaultStamina(50, 0, 0) }, 'entry spend is a no-op');

eq(normalizeProfile({ maps: null, hard_maps: [] }).maps, {}, 'normalizer repairs maps');
eq(new ProfileStore({ load: () => '{"clears":3}', save: () => {} }).load().clears, 3,
  'store parses JSON');

console.log(`PvE progress self-check OK (${checks} assertions)`);
console.log(JSON.stringify({
  grades: perfect.grades,
  reward: decodeCrystalPacket({ msgId: awardId, payload: awardBody }).award.groups[0].items,
  settlement: battleEnd.actors[0].pve,
  stamina: bought.stamina,
}));

function fakeEngine(overrides = {}) {
  return {
    map: { id: 201, native: { nPassTime: 900, nBoosterAttack: null } },
    sceneId: 901, now: 34000, introUntil: 3000, lives: 2, deaths: 1,
    accountId: 30000791, runId: 'run-1', rules: { targetSeconds: 360 },
    player: {
      camp: 1,
      info: { tank_id: 10000044, tank_level: 3 },
      stats: {
        iHp: '1000', iAttack: '100', iEgAtk: '50', iArmor: '20', iEgArmor: '10',
        iCentesis: '5', iEgCtsis: '4', iFireInterv: '1000', iSpeed: '120', nFireRange: '600',
      },
    },
    npcs: new Map(),
    ...overrides,
  };
}
