// PvE NPC stats from AINpcLevelTemplate_table + AINpcArms coefficients.
// Mirrors /tmp/bang-poc/BangBang_Offline-main/server/pve_balance.py.
import { NPC_LEVELS, PVE_CONFIG } from './npc-levels.js';
import { D } from './math.js';

const STATS = [
  ['iHp', 'iHp', 'fHpCoef', 'hp_multiplier'],
  ['iAttack', 'iBdAtk', 'fBdAtkCoef', 'attack_multiplier'],
  ['iEgAtk', 'iEgAtk', 'fEgAtkCoef', 'attack_multiplier'],
  ['iArmor', 'iBdArmor', 'fBdArmorCoef', 'armor_multiplier'],
  ['iEgArmor', 'iEgArmor', 'fEgArmorCoef', 'armor_multiplier'],
  ['iCentesis', 'iBdCtsis', 'fBdCtsisCoef', 'penetration_multiplier'],
  ['iEgCtsis', 'iEgCtsis', 'fEgCtsisCoef', 'penetration_multiplier'],
];

/** Create the PveEngine npcStats hook for a map quality (0..100). */
export function npcStatsAtQuality(quality = 0) {
  return function npcStats(template, profile) {
    const role = Math.max(1, Math.min(5, Number(profile && profile.levelId) || 1));
    const row = NPC_LEVELS[String(role * 100000 + Number(quality))];
    if (!row) return null;
    const arms = (profile && profile.arms) || {};
    const out = {};
    for (const [stat, field, coef, mult] of STATS) {
      let value = D(row[field] || '0').mul(D(arms[coef] || '1')).mul(D(PVE_CONFIG[mult] || '1'));
      if (stat === 'iHp') value = value.mul(D(PVE_CONFIG.enemy_hp_multiplier || '1'));
      out[stat] = value.toString();
    }
    out.iK = String(row.iK || '100');
    out.iFireInterv = String((profile && profile.fireInterval) ?? 1000);
    out.iSpeed = String((profile && profile.speed) ?? 0);
    out.nFireRange = String((profile && profile.fireRange) ?? 0);
    return out;
  };
}

export function mapQuality(map) {
  const native = (map && map.native) || {};
  const value = Number(native.nQuality ?? native.quality ?? 0);
  return Number.isFinite(value) ? value : 0;
}
