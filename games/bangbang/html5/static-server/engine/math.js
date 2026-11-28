/* Decimal + geometry core, ported from server/combat_math.py and combat_geometry.py.
 *
 * Decimal is a fixed-point BigInt at 12 fractional digits. Python uses
 * decimal.Context(prec=60, ROUND_HALF_UP); all battle values are far smaller
 * than 1e12, so 12 digits is enough for the final 0.001 HP quantum and for
 * every intermediate product/quotient in the V1 damage formula.
 *
 * ponytail: one global precision instead of per-operation context. Add a
 * context object only if a formula needs >12 fractional digits.
 */

const SCALE_DIGITS = 12;
const SCALE = 10n ** BigInt(SCALE_DIGITS);
const MILLI = 10n ** BigInt(SCALE_DIGITS - 3); // 1 milli-unit in internal units

export const PERMANENT = Number.MAX_SAFE_INTEGER;

/** Python ROUND_HALF_UP integer division: ties away from zero. */
function divHalfUp(n, d) {
  if (d === 0n) throw new RangeError('Decimal division by zero');
  const negative = (n < 0n) !== (d < 0n);
  const a = n < 0n ? -n : n;
  const b = d < 0n ? -d : d;
  let q = a / b;
  if ((a % b) * 2n >= b) q += 1n;
  return negative ? -q : q;
}

function pow10(n) {
  return 10n ** BigInt(n);
}

function parseScaled(source) {
  const text = source.trim();
  if (!text || text === 'NaN' || /inf/i.test(text)) throw new TypeError('Non-finite numeric input.');
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match || (!match[2] && !match[3])) throw new TypeError(`Invalid decimal: ${source}`);
  const sign = match[1] === '-' ? -1n : 1n;
  const whole = match[2] || '';
  const frac = match[3] || '';
  const exp = match[4] ? Number(match[4]) : 0;
  const digits = BigInt((whole + frac) || '0');
  const shift = SCALE_DIGITS + exp - frac.length;
  const units = shift >= 0 ? digits * pow10(shift) : divHalfUp(digits, pow10(-shift));
  return sign * units;
}

/** Fixed-point decimal with Python Decimal quantize semantics at 0.001. */
export class Dec {
  constructor(units) { this.units = units; }

  add(other) { return new Dec(this.units + D(other).units); }
  sub(other) { return new Dec(this.units - D(other).units); }
  mul(other) { return new Dec(divHalfUp(this.units * D(other).units, SCALE)); }
  div(other) {
    const b = D(other);
    if (b.units === 0n) throw new RangeError('Decimal division by zero');
    return new Dec(divHalfUp(this.units * SCALE, b.units));
  }
  neg() { return new Dec(-this.units); }
  abs() { return new Dec(this.units < 0n ? -this.units : this.units); }

  cmp(other) {
    const b = D(other).units;
    return this.units < b ? -1 : this.units > b ? 1 : 0;
  }
  eq(other) { return this.units === D(other).units; }
  ne(other) { return this.units !== D(other).units; }
  lt(other) { return this.units < D(other).units; }
  le(other) { return this.units <= D(other).units; }
  gt(other) { return this.units > D(other).units; }
  ge(other) { return this.units >= D(other).units; }
  max(other) { return this.ge(other) ? this : D(other); }
  min(other) { return this.le(other) ? this : D(other); }
  isZero() { return this.units === 0n; }
  isNegative() { return this.units < 0n; }

  /** Integer ceiling, identical to math.ceil(Decimal). */
  ceil() {
    const q = this.units / SCALE, r = this.units % SCALE;
    return Number(r > 0n ? q + 1n : q);
  }
  floor() {
    const q = this.units / SCALE, r = this.units % SCALE;
    return Number(r < 0n ? q - 1n : q);
  }

  /** ROUND_HALF_UP to the 0.001 quantum, Python quantize(Q). */
  quantize() { return quantize(this); }

  toNumber() { return Number(this.units) / Number(SCALE); }

  toString() {
    const negative = this.units < 0n;
    const magnitude = negative ? -this.units : this.units;
    const whole = magnitude / SCALE;
    let frac = (magnitude % SCALE).toString().padStart(SCALE_DIGITS, '0').replace(/0+$/, '');
    return `${negative ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
  }

  toFixed(digits = 3) {
    if (!Number.isInteger(digits) || digits < 0 || digits > SCALE_DIGITS) {
      throw new RangeError('toFixed digits out of range');
    }
    const factor = pow10(SCALE_DIGITS - digits);
    const rounded = divHalfUp(this.units, factor);
    const negative = rounded < 0n;
    const magnitude = negative ? -rounded : rounded;
    const whole = magnitude / pow10(digits);
    const frac = digits ? `.${(magnitude % pow10(digits)).toString().padStart(digits, '0')}` : '';
    return `${negative ? '-' : ''}${whole}${frac}`;
  }

  toJSON() { return this.toString(); }
}

export const ZERO = new Dec(0n);
export const ONE = new Dec(SCALE);
export const Q = new Dec(MILLI);
export const K = new Dec(300n * SCALE);

/** Python D(): int, str, Decimal. Fractional JS numbers are rejected like floats. */
export function D(value) {
  if (value instanceof Dec) return value;
  if (typeof value === 'bigint') return new Dec(value * SCALE);
  if (typeof value === 'string') return new Dec(parseScaled(value));
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError('Use int/str/Decimal; floats, bool and missing values are not accepted.');
    }
    return new Dec(BigInt(value) * SCALE);
  }
  throw new TypeError('Use int/str/Decimal; floats, bool and missing values are not accepted.');
}

export function positive(value, { allowZero = true } = {}) {
  const n = D(value);
  if (n.lt(0) || (!allowZero && n.isZero())) {
    throw new RangeError(allowZero ? 'Expected a nonnegative number.' : 'Expected a positive number.');
  }
  return n;
}

export function fraction(value) {
  const n = D(value);
  if (n.lt(0) || n.gt(1)) throw new RangeError('Expected a fraction in [0, 1], e.g. "0.25" for 25%.');
  return n;
}

export function intMs(n, { positiveOnly = false } = {}) {
  if (!Number.isInteger(n) || n < (positiveOnly ? 1 : 0)) {
    throw new RangeError('Time is integer milliseconds with a valid nonnegative range.');
  }
  return n;
}

export function quantize(value) {
  const milli = divHalfUp(D(value).units, MILLI);
  return new Dec(milli * MILLI);
}

export function sumDec(values, start = ZERO) {
  let total = D(start);
  for (const value of values) total = total.add(value);
  return total;
}

export function effectiveArmor(armor, {
  reductionPct = 0, reductionFlat = 0, penetrationPct = 0, penetrationFlat = 0,
} = {}) {
  const a = D(armor).mul(ONE.sub(fraction(reductionPct))).sub(positive(reductionFlat));
  const pp = fraction(penetrationPct), pf = positive(penetrationFlat);
  return a.lt(0) ? a : a.mul(ONE.sub(pp)).sub(pf).max(0);
}

export function armorMultiplier(effective, { armorConstant = K } = {}) {
  const a = D(effective);
  const k = positive(armorConstant, { allowZero: false });
  return a.ge(0) ? k.div(k.add(a)) : D(2).sub(k.div(k.sub(a)));
}

/** Port of combat_math.damage_amount. Returns potential damage before shields/HP. */
export function damageAmount(raw, {
  school, armor = 0, reductionPct = 0, reductionFlat = 0,
  penetrationPct = 0, penetrationFlat = 0,
  sourceConditionMultiplier = 1, targetClassMultiplier = 1,
  outgoingBonus = 0, incomingBonus = 0, reductions = [], critical = false,
  canCritical = false, criticalMultiplier = 2, immune = false, inverseArmor = false,
  armorConstant = K,
} = {}) {
  if (!['physical', 'energy', 'true'].includes(school)) {
    throw new RangeError('School must be physical, energy, or true.');
  }
  raw = positive(raw);
  const armorK = positive(armorConstant, { allowZero: false });
  const cm = positive(criticalMultiplier);
  if (cm.lt(1)) throw new RangeError('Critical multiplier must be >=1.');
  if (critical && (!canCritical || school === 'true')) {
    throw new RangeError('This packet is not eligible to critical strike.');
  }
  const armorValue = effectiveArmor(armor, {
    reductionPct, reductionFlat, penetrationPct, penetrationFlat,
  });
  const rs = [...reductions].map(fraction);
  let value = raw.mul(positive(sourceConditionMultiplier)).mul(positive(targetClassMultiplier));
  const outFactor = ONE.add(D(outgoingBonus)).max(0);
  const inFactor = ONE.add(D(incomingBonus)).max(0);
  if (immune) return quantize(0);
  if (school !== 'true') {
    value = value.mul(critical ? cm : ONE);
    const armorFactor = inverseArmor
      // Q69: use reduced armor before penetration; replace this stage.
      ? ONE.add(effectiveArmor(armor, { reductionPct, reductionFlat }).max(0)
        .div(armorK.add(effectiveArmor(armor, { reductionPct, reductionFlat }).max(0))))
      : armorMultiplier(armorValue, { armorConstant: armorK });
    value = value.mul(outFactor).mul(armorFactor).mul(inFactor);
    for (const reduction of rs) value = value.mul(ONE.sub(reduction));
  }
  return quantize(value);
}

export class Shield {
  constructor(shieldId, remaining, school = 'all', expiresMs = PERMANENT) {
    if (!shieldId) throw new RangeError('Shield IDs must be nonempty.');
    if (!['all', 'physical', 'energy', 'true'].includes(school)) {
      throw new RangeError('Unknown shield school.');
    }
    this.shield_id = shieldId;
    this.remaining = remaining;
    this.school = school;
    this.expires_ms = expiresMs;
  }
}

export class HitResult {
  constructor(potentialDamage, shieldAbsorbed, hpLoss, hpAfter, overkill, killed, shields, brokenShieldIds) {
    this.potential_damage = potentialDamage;
    this.shield_absorbed = shieldAbsorbed;
    this.hp_loss = hpLoss;
    this.hp_after = hpAfter;
    this.overkill = overkill;
    this.killed = killed;
    this.shields = shields;
    this.broken_shield_ids = brokenShieldIds;
  }
}

/** Port of combat_math.apply_damage. Pure reducer; no combat triggers. */
export function applyDamage(amount, hp, shields = [], {
  school, nowMs = 0, hpFloor = 0,
} = {}) {
  if (!['physical', 'energy', 'true'].includes(school)) throw new RangeError('Unknown damage school.');
  intMs(nowMs);
  const potential = quantize(positive(amount));
  const health = quantize(positive(hp));
  const floor = quantize(positive(hpFloor));
  if (health.gt(0) && floor.gt(health)) throw new RangeError('HP floor must not increase current HP.');

  const remaining = new Map();
  const seen = new Set();
  for (const original of shields) {
    const s = original instanceof Shield ? original
      : new Shield(original.shield_id ?? original.shieldId, original.remaining,
        original.school ?? 'all', original.expires_ms ?? original.expiresMs ?? PERMANENT);
    if (seen.has(s.shield_id)) throw new RangeError('Shield IDs must be unique and nonempty.');
    seen.add(s.shield_id);
    intMs(s.expires_ms);
    const value = quantize(positive(s.remaining));
    if (s.expires_ms > nowMs && value.gt(0)) {
      remaining.set(s.shield_id, new Shield(s.shield_id, value, s.school, s.expires_ms));
    }
  }
  if (health.isZero()) {
    return new HitResult(potential, quantize(0), quantize(0), health, quantize(0), false,
      [...remaining.values()], []);
  }

  const matching = [...remaining.values()]
    .filter(s => s.school === 'all' || s.school === school)
    .sort((a, b) => (Number(a.school === 'all') - Number(b.school === 'all'))
      || (a.expires_ms - b.expires_ms)
      || (a.shield_id < b.shield_id ? -1 : a.shield_id > b.shield_id ? 1 : 0));
  let left = potential;
  let absorbed = ZERO;
  const broken = [];
  for (const s of matching) {
    const used = D(s.remaining).min(left);
    left = left.sub(used);
    absorbed = absorbed.add(used);
    const next = D(s.remaining).sub(used);
    if (next.isZero() && used.gt(0)) {
      broken.push(s.shield_id);
      remaining.delete(s.shield_id);
    } else {
      remaining.set(s.shield_id, new Shield(s.shield_id, next, s.school, s.expires_ms));
    }
    if (left.isZero()) break;
  }
  const lost = left.min(health.sub(floor).max(0));
  const after = health.sub(lost);
  return new HitResult(potential, absorbed, lost, after, left.sub(lost),
    after.isZero() && health.gt(0), [...remaining.values()], broken);
}

export class HealResult {
  constructor(potentialHeal, effectiveHeal, hpAfter, overheal) {
    this.potential_heal = potentialHeal;
    this.effective_heal = effectiveHeal;
    this.hp_after = hpAfter;
    this.overheal = overheal;
  }
}

export function heal(raw, hp, maxHp, { outgoingBonus = 0, incomingBonus = 0, woundReductions = [] } = {}) {
  let amount = positive(raw);
  const current = quantize(positive(hp));
  const maximum = quantize(positive(maxHp, { allowZero: false }));
  if (maximum.le(0) || current.gt(maximum)) throw new RangeError('Invalid HP state.');
  amount = amount.mul(ONE.add(D(outgoingBonus)).max(0)).mul(ONE.add(D(incomingBonus)).max(0));
  for (const r of woundReductions) amount = amount.mul(ONE.sub(fraction(r)));
  amount = quantize(amount);
  const effective = current.gt(0) ? amount.min(maximum.sub(current)) : quantize(0);
  return new HealResult(amount, effective, current.add(effective), amount.sub(effective));
}

export function cooldownMs(baseMs, cdrAdd = []) {
  intMs(baseMs);
  const cdr = sumDec(cdrAdd).min(D('0.50')).max(0);
  if (!baseMs) return 0;
  return D(baseMs).mul(ONE.sub(cdr)).ceil();
}

export function fireIntervalMs(baseMs, speedBonusAdd = []) {
  intMs(baseMs, { positiveOnly: true });
  const factor = ONE.add(sumDec(speedBonusAdd)).max(D('0.25')).min(D(3));
  return Math.max(1, D(baseMs).div(factor).ceil());
}

export function splitTotal(total, count) {
  if (!Number.isInteger(count) || count < 1 || count > 100000) {
    throw new RangeError('Count must be an integer in [1, 100000].');
  }
  const units = quantize(positive(total)).units / MILLI;
  const q = units / BigInt(count), r = units % BigInt(count);
  return Array.from({ length: count }, (_, i) => new Dec((q + (BigInt(i) < r ? 1n : 0n)) * MILLI));
}

export function tickOffsets(durationMs, intervalMs, { immediate = false } = {}) {
  intMs(durationMs);
  intMs(intervalMs, { positiveOnly: true });
  if (Math.floor(durationMs / intervalMs) > 100000) throw new RangeError('Unreasonable tick count.');
  const out = immediate ? [0] : [];
  for (let t = intervalMs; t <= durationMs; t += intervalMs) out.push(t);
  return out;
}

// ---------------------------------------------------------------------------
// Geometry (combat_geometry.py). All positions are [x, y] arrays.

/** Python round(): halves go to the nearest even integer. */
export function pyRound(value) {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

export function pointAt(start, end, fraction) {
  return [start[0] + (end[0] - start[0]) * fraction,
    start[1] + (end[1] - start[1]) * fraction];
}

export function distance(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** Swept contact with axis-aligned rectangles. Returns earliest fraction. */
export function rectContact(start, end, rectangles, padding = 0) {
  const [x, y] = start;
  const dx = end[0] - x, dy = end[1] - y;
  let first = null;
  for (const [left, top, right, bottom] of rectangles) {
    let low = 0, high = 1;
    if (dx === 0) {
      if (!(left - padding <= x && x <= right + padding)) continue;
    } else {
      let t1 = (left - padding - x) / dx, t2 = (right + padding - x) / dx;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > low) low = t1;
      if (t2 < high) high = t2;
      if (low > high) continue;
    }
    if (dy === 0) {
      if (!(top - padding <= y && y <= bottom + padding)) continue;
    } else {
      let t1 = (top - padding - y) / dy, t2 = (bottom + padding - y) / dy;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > low) low = t1;
      if (t2 < high) high = t2;
      if (low > high) continue;
    }
    if (first === null || low < first) first = low;
    if (first === 0) return first;
  }
  return first;
}

/** First contact fraction of two linearly moving centers, or null. */
export function circleContact(start, end, centerStart, centerEnd, radius = 36) {
  const x = start[0] - centerStart[0], y = start[1] - centerStart[1];
  const dx = (end[0] - start[0]) - (centerEnd[0] - centerStart[0]);
  const dy = (end[1] - start[1]) - (centerEnd[1] - centerStart[1]);
  const c = x * x + y * y - radius * radius;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy, b = 2 * (x * dx + y * dy);
  const discriminant = b * b - 4 * a * c;
  if (a === 0 || discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

/** Static map NPCs use an exact rectangle; tanks use the 36px circle. */
export function actorContact(start, end, actor, previous, now, radius = 36) {
  const mapRect = actor.mapRect || actor.map_rect;
  if (mapRect) {
    const hit = rectContact(start, end, [mapRect], Math.max(0, radius - 36));
    return hit === null ? null : Math.max(0, hit - 1e-7);
  }
  const previousPos = actor.positionAt(previous);
  const nowPos = actor.positionAt(now);
  return circleContact(start, end, previousPos, nowPos, radius);
}
