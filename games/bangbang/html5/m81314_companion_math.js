/* Read-only HelperTool / server.boosters formulas. No inventory mutation or RNG.
 * Fractional strength/rank is truncated to hundredths BEFORE evaluating stats.
 * Native Python uses Decimal's 28-significant-digit, half-even arithmetic. Its
 * intermediate rounding matters at some integer boundaries, so display mode
 * reproduces that order with BigInt fractions, not JS binary floating point.
 * The unrounded rational export is retained as an independent audit reference. */
const integer = (value, name = 'value') => {
  const result = Number(value ?? 0);
  if (!Number.isSafeInteger(result)) throw new Error(`Cấu hình trợ thủ không hợp lệ: ${name}.`);
  return result;
};
const nonnegative = (value, name) => {
  const result = integer(value, name);
  if (result < 0) throw new Error(`Tiến trình trợ thủ không hợp lệ: ${name}.`);
  return result;
};
const gcd = (a, b) => { a = a < 0n ? -a : a; while (b) [a, b] = [b, a % b]; return a || 1n; };
const fraction = (n, d = 1n) => {
  if (!d) throw new Error('Mẫu số cấu hình trợ thủ bằng 0.');
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d); return [n / g, d / g];
};
const add = (a, b) => fraction(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
const mul = (a, b) => fraction(a[0] * b[0], a[1] * b[1]);
const trunc = a => {
  const value = Number(a[0] / a[1]);
  if (!Number.isSafeInteger(value)) throw new Error('Chỉ số trợ thủ vượt miền hiển thị an toàn.');
  return value;
};
const one = [1n, 1n];

function decimal28(value) {
  if (!value[0]) return value;
  const sign = value[0] < 0n ? -1n : 1n, n = value[0] * sign, d = value[1];
  let exponent = n.toString().length - d.toString().length;
  if (exponent >= 0 ? n < d * 10n ** BigInt(exponent) : n * 10n ** BigInt(-exponent) < d) exponent--;
  const places = 27 - exponent, factor = 10n ** BigInt(Math.abs(places));
  const numerator = places >= 0 ? n * factor : n, denominator = places >= 0 ? d : d * factor;
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder * 2n > denominator || (remainder * 2n === denominator && quotient % 2n)) quotient++;
  return places >= 0 ? fraction(sign * quotient, factor) : fraction(sign * quotient * factor);
}

export function companionTables(catalog = {}) {
  const tables = catalog.rawTemplates || catalog.templates || {};
  const index = (name, key) => new Map((tables[name] || []).map(row => [key(row), row]));
  return {
    items: index('ItemTemplate_table', row => integer(row.nItemId)),
    boosters: index('BoosterTemplate_table', row => integer(row.nId)),
    levels: index('BoosterLevelTemplate_table', row => integer(row.nLevel)),
    costs: index('ConsumeLevelTemplate_table', row => `${integer(row.nType)}:${integer(row.nLevel)}`),
  };
}

export function companionProgress(item) {
  return {
    level: nonnegative(item?.level, 'level'), exp: nonnegative(item?.exp, 'exp'),
    upgradeLevel: nonnegative(item?.upgradeLevel, 'upgradeLevel'),
    upgradeCost: nonnegative(item?.upgradeCost, 'upgradeCost'),
    rank: nonnegative(item?.rank, 'rank'), rankCost: nonnegative(item?.rankCost, 'rankCost'),
  };
}

export function companionConfig(catalog, tables, item) {
  if (!item || item.count !== 1 || !item.uuid) return null;
  const entry = catalog?.companions?.[String(item.templateId)];
  const rawItem = entry?.rawItem || tables.items.get(Number(item.templateId));
  const booster = entry?.rawBooster || tables.boosters.get(Number(rawItem?.iReuseA));
  // Keep invalid source joins visible but unusable. Never substitute a different pet.
  if (!entry || entry.status !== 'ready' || !entry.component || !entry.source || !entry.icon
      || integer(rawItem?.nType) !== 36 || !booster) return null;
  for (const field of ['iLevelLimit', 'iUpLevelLimit', 'iRankLimit', 'nAptitude']) {
    if (!Number.isSafeInteger(Number(booster[field])) || Number(booster[field]) < 0) return null;
  }
  return {entry, rawItem, booster};
}

function progressFraction(tables, kind, level, consumed) {
  const maximum = nonnegative(tables.costs.get(`${kind}:${level + 1}`)?.iCostMax, 'iCostMax');
  const hundredths = maximum ? BigInt(consumed) * 100n / BigInt(maximum) : 0n;
  return fraction(BigInt(level) * 100n + hundredths, 100n);
}

function attributesWithArithmetic(tables, item, booster, nativeDecimal) {
  const rounded = value => nativeDecimal ? decimal28(value) : value;
  const plus = (a, b) => rounded(add(a, b)), times = (a, b) => rounded(mul(a, b));
  const divided = (a, divisor) => rounded(fraction(a[0], a[1] * BigInt(divisor)));
  const whole = value => fraction(BigInt(integer(value)));
  const p = companionProgress(item);
  const rank = progressFraction(tables, 2, p.rank, p.rankCost);
  const up = progressFraction(tables, 1, p.upgradeLevel, p.upgradeCost);
  const levelFactor = fraction(BigInt(20 + p.level), 20n);
  const rankSquareTerm = divided(times(rank, rank), 120), rankTerm = divided(rank, 12);
  const rankFactor = plus(rankSquareTerm, rankTerm);
  const result = {};
  for (const [name, type, field] of [['hp', 4, 'iHp'], ['attack', 1, 'iAttack'],
    ['armor', 3, 'iArmor'], ['penetration', 2, 'iCtsis']]) {
    const base = times(whole(booster[field]), levelFactor);
    let extra = [0n, 1n];
    for (const suffix of ['A', 'B']) {
      if (type !== integer(booster[`nType${suffix}`])) continue;
      const bonus = plus(times(up, whole(booster[`iAdd${suffix}`])), whole(booster[`iValue${suffix}`]));
      extra = divided(times(base, bonus), 10000000); break;
    }
    result[name] = trunc(plus(plus(base, extra), times(base, rankFactor)));
  }
  const aptitudeFactor = plus(one, divided(times(whole(booster.nAptitude), whole(4)), 50));
  // Match the left-to-right native expression; do not regroup rankFactor here.
  const scoreFactor = plus(plus(plus(fraction(41n, 40n), rankSquareTerm), rankTerm), times(fraction(1n, 80n), up));
  result.score = trunc(times(times(times(whole(1000), levelFactor), aptitudeFactor), scoreFactor));
  return result;
}

export const companionAttributes = (tables, item, booster) => attributesWithArithmetic(tables, item, booster, true);
export const companionAttributesExact = (tables, item, booster) => attributesWithArithmetic(tables, item, booster, false);

export function itemCount(bag, templateId) {
  return (bag || []).filter(item => Number(item.templateId) === Number(templateId))
    .reduce((sum, item) => sum + Math.max(0, integer(item.count)), 0);
}

export function companionFeedQuote(tables, item, booster, chip, bag = chip ? [chip] : []) {
  const progress = companionProgress(item), cap = integer(booster.iLevelLimit);
  const row = chip && tables.items.get(Number(chip.templateId));
  const need = integer(tables.levels.get(progress.level)?.iExp);
  const gain = integer(row?.iReuseA);
  const remaining = Math.max(0, need - progress.exp);
  const stacks = chip ? bag.filter(value => value.templateId === chip.templateId && value.count > 0
    && value.lifeTime === 0 && Number.isInteger(value.extFlag) && (value.extFlag & ~17) === 0) : [];
  const available = stacks.reduce((sum, value) => sum + integer(value.count), 0);
  const amount = remaining && gain > 0 ? Math.ceil(remaining / gain) : 0;
  const remainder = progress.exp + amount * gain - need;
  let reason = '';
  if (progress.level >= cap) reason = 'Đã đạt cấp tối đa; không tiêu chip.';
  else if (need <= 0) reason = 'Thiếu cấu hình EXP; không gửi yêu cầu.';
  else if (integer(item.extFlag) & 2) reason = 'Trợ thủ đang khóa bảo vệ; chưa tiêu chip hoặc EXP.';
  else if (!Number.isInteger(item.extFlag) || (item.extFlag & ~49) !== 0 || item.lifeTime !== 0)
    reason = 'Trợ thủ có thời hạn/trạng thái chưa hỗ trợ; chưa tiêu chip hoặc EXP.';
  else if (remaining && (!chip || integer(chip.count) < 1 || integer(row?.nType) !== 37 || gain <= 0
    || chip.lifeTime !== 0 || (integer(chip.extFlag) & ~17) !== 0))
    reason = 'Chọn chip EXP không khóa, còn trong túi nguyên liệu.';
  else if (amount > available) reason = `Cần ${amount.toLocaleString('vi-VN')} chip, có ${available.toLocaleString('vi-VN')}; chưa tiêu chip hoặc EXP.`;
  else if (!Number.isSafeInteger(remainder) || remainder < 0 || remainder > 0x7fffffff) reason = 'EXP dư vượt miền an toàn; chưa tiêu chip.';
  const discardedExp = progress.level + 1 === cap ? Math.max(0, remainder) : 0;
  return {allowed: !reason, reason, cap, gain, need, exp: progress.exp, amount, available, remainder: remainder - discardedExp, discardedExp,
    nextLevel: progress.level + 1, nextNeed: integer(tables.levels.get(progress.level + 1)?.iExp)};
}

export function companionRateBonus(tables, bag, rank, materialUuids = []) {
  if (!Array.isArray(materialUuids) || materialUuids.length > 3)
    return {allowed: false, reason: 'Chỉ chọn tối đa 3 liều tăng tỷ lệ.', extra: 0, qualified: 0};
  const available = new Map((bag || []).map(item => [item.uuid, item]));
  const selected = new Map();
  for (const uuid of materialUuids) selected.set(uuid, (selected.get(uuid) || 0) + 1);
  let extra = 0, qualified = 0;
  for (const [uuid, count] of selected) {
    const item = available.get(uuid), row = item && tables.items.get(Number(item.templateId));
    if (!item || integer(item.count) < count || integer(row?.nType) !== 39)
      return {allowed: false, reason: 'Liều tăng tỷ lệ đã hết hoặc không hợp lệ.', extra: 0, qualified: 0};
    const tier = integer(row.iReuseB), gap = Math.max(0, Math.floor(rank / 2) - tier);
    if (gap > 1024) throw new Error('Bậc vật liệu vượt miền cấu hình an toàn.');
    const perDose = BigInt(nonnegative(row.iReuseA, 'iReuseA')) / (2n ** BigInt(gap));
    extra += Number(perDose) * count;
    if (tier >= Math.floor(rank / 2)) qualified += count;
  }
  extra += ({2: 2000000, 3: 6000000}[qualified] || 0);
  return {allowed: true, reason: '', extra, qualified};
}

export function companionUpgradeQuote(tables, item, booster, kind, bag, silver, materialUuids = []) {
  if (![1, 2].includes(kind)) throw new Error('Loại nâng trợ thủ không hợp lệ.');
  const p = companionProgress(item), level = kind === 1 ? p.upgradeLevel : p.rank;
  const progress = kind === 1 ? p.upgradeCost : p.rankCost;
  const cap = integer(booster[kind === 1 ? 'iUpLevelLimit' : 'iRankLimit']);
  const row = tables.costs.get(`${kind}:${level + 1}`);
  const base = {allowed: false, capped: level >= cap, cap, level, progress, kind};
  if (base.capped) return {...base, reason: 'Đã đạt giới hạn; không tiêu nguyên liệu.'};
  if (!row) return {...base, reason: 'Thiếu cấu hình chi phí; không gửi yêu cầu.'};
  const coin = integer(row.iCoin), amount = integer(row.iItemCount), rate = integer(row.iRate);
  const gain = integer(row.iCost), maximum = integer(row.iCostMax), itemId = integer(row.nItemId);
  if (coin < 0 || amount <= 0 || gain <= 0 || maximum <= 0 || rate < 0 || rate > 10000000)
    return {...base, reason: 'Cấu hình nâng không hợp lệ; không gửi yêu cầu.'};
  const bonus = companionRateBonus(tables, bag, p.rank, materialUuids);
  const owned = itemCount(bag, itemId), totalRate = Math.min(10000000, rate + bonus.extra);
  const guaranteed = progress + gain >= maximum;
  let reason = bonus.reason;
  if (kind === 1 && materialUuids.length) reason = 'Cường hóa không dùng liều tăng tỷ lệ.';
  if (!reason && nonnegative(silver, 'silver') < coin) reason = 'Không đủ bạc.';
  if (!reason && owned < amount) reason = 'Không đủ nguyên liệu nâng.';
  return {...base, allowed: !reason, reason, row, coin, amount, itemId, owned, rate, bonus: bonus.extra,
    totalRate, gain, maximum, guaranteed, remaining: Math.max(0, maximum - progress),
    attemptsToGuarantee: Math.max(1, Math.ceil((maximum - progress) / gain))};
}

export function companionTransferQuote(tables, left, leftBooster, right, rightBooster, bag) {
  const result = {allowed: false, itemId: 4000001, amount: 0, owned: itemCount(bag, 4000001)};
  if (!left || !right || left.uuid === right.uuid || !leftBooster || !rightBooster)
    return {...result, reason: 'Chọn hai trợ thủ khác nhau.'};
  const a = companionProgress(left), b = companionProgress(right);
  const aptitude = Math.max(integer(leftBooster.nAptitude), integer(rightBooster.nAptitude));
  result.amount = aptitude <= 10 ? 1 : aptitude <= 20 ? 10 : aptitude <= 50 ? Math.floor(aptitude / 5) - 1 : 10;
  for (const [source, target] of [[a, rightBooster], [b, leftBooster]]) {
    for (const [level, partial, limit] of [['level', 'exp', 'iLevelLimit'],
      ['upgradeLevel', 'upgradeCost', 'iUpLevelLimit'], ['rank', 'rankCost', 'iRankLimit']]) {
      const cap = integer(target[limit]);
      if (source[level] > cap || (source[level] === cap && source[partial] > 0))
        return {...result, reason: 'Tiến trình chuyển vượt giới hạn trợ thủ nhận.'};
    }
  }
  if (result.owned < result.amount) return {...result, reason: 'Không đủ nguyên liệu chuyển đổi.'};
  return {...result, allowed: true, reason: '', leftProgress: a, rightProgress: b};
}

/** Rates are native ten-millionths. Keep all five possible decimal places. */
export function companionPercent(rate) {
  const value = nonnegative(rate, 'rate');
  const whole = Math.floor(value / 100000), fraction = String(value % 100000).padStart(5, '0').replace(/0+$/, '');
  return `${whole}${fraction ? `,${fraction}` : ''}%`;
}
