import assert from 'node:assert/strict';
import { npcStatsAtQuality, mapQuality } from './pve-balance.js';
const stats = npcStatsAtQuality(0);
const arms = { fHpCoef: '1', fBdAtkCoef: '1', fEgAtkCoef: '1', fBdArmorCoef: '1', fEgArmorCoef: '1', fBdCtsisCoef: '1', fEgCtsisCoef: '1' };
for (const role of [1, 2, 3, 4, 5]) {
  const s = stats(0, { levelId: role, arms, fireInterval: 1000, speed: 110, fireRange: 600 });
  assert(s && s.iHp && s.iAttack && s.iK, 'role ' + role + ' stats');
  console.log('role', role, 'hp', s.iHp, 'atk', s.iAttack, 'armor', s.iArmor, 'k', s.iK);
}
const hp1 = Number(stats(0, { levelId: 1, arms }).iHp);
assert.equal(hp1, 29 * 2 * 1.5, 'level 1 HP matches pve_balance multipliers');
assert.equal(mapQuality({ native: { nQuality: 0 } }), 0);
console.log('pve-balance self-check OK');
