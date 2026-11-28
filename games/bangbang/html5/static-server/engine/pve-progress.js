// M4 PvE progression: rewards, grading, settlement, city progress and thew.
//
// Ported from BangBang_Offline server/pve_progress.py, pve_scoring.py,
// pve_stamina.py, pve_catalog.py and pve_rules.settlement(). The JSON profile
// store is injected so a browser worker (localStorage/SAB), a Node test and a
// future SQLite adapter share one implementation.
//
// Deliberate scope: no inventory bag model. `deliver()` takes a `grant(id,
// count, level)` sink and only clears `pending*` after it succeeds, so a
// worker that has no bag yet keeps the claim pending (never silently loses it).
import { Writer } from '../../protocol.js';
import { D, ZERO } from './math.js';
import {
  CITIES, MAP_IDS, NORMAL_TO_HARD, CHAPTER_IDS, resolveRequest,
} from './pve-data.js';
import { GRADING } from './pve-rules.js';
import { stats21 } from './pve-engine.js';
import { encodeS1104, encodeS1708 } from './protocol.js';

// pve_progress.py: REWARD / REWARD_V3 / SECOND_PET. REWARD_V3 already contains
// the legacy ids, so every v3 win ships the full eight-id set.
export const REWARD = Object.freeze([3700002, 3700002, 3800001]);
export const REWARD_V3 = Object.freeze([...REWARD, 3800002, 4400001, 4400002, 3900002, 4000001]);
export const SECOND_PET = 4300000;

// pve_stamina.py: C78 buys 100 thew for 1 Xu (COIN_CASH); no entry spend.
export const STAMINA = Object.freeze({
  request: 78, notify: 1027, profile: 'pve_stamina', cash: 1, price: 1,
  gain: 100, max: 32767, thewOffset: 76,
});

export const AWARD_KIND = 1;
export const CITY_UPDATE = 1304;
export const CITY_LIST = 1303;

export function defaultProfile() {
  return {
    clears: 0, last_run: '', pending: 0, best_grade: 0, pending_v3: 0,
    second_pet_earned: false, second_pet_pending: false,
    maps: {}, hard_maps: {}, receipts: {},
  };
}

/** Apply pve_progress.profile() defaults without discarding extra fields. */
export function normalizeProfile(data = {}) {
  const profile = { ...defaultProfile(), ...(data && typeof data === 'object' ? data : {}) };
  for (const key of ['clears', 'pending', 'best_grade', 'pending_v3']) {
    const value = Number(profile[key]);
    profile[key] = Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  }
  profile.last_run = typeof profile.last_run === 'string' ? profile.last_run : '';
  profile.second_pet_earned = Boolean(profile.second_pet_earned);
  profile.second_pet_pending = Boolean(profile.second_pet_pending);
  for (const key of ['maps', 'hard_maps', 'receipts']) {
    if (!profile[key] || typeof profile[key] !== 'object' || Array.isArray(profile[key])) {
      profile[key] = {};
    }
  }
  return profile;
}

/**
 * Pluggable JSON profile store. `load` returns JSON text or null; `save`
 * accepts JSON text. Wire it to localStorage, a worker SAB, or (later) SQLite.
 */
export class ProfileStore {
  constructor({ load = () => null, save = () => {} } = {}) {
    this._load = load;
    this._save = save;
  }

  load() {
    const raw = this._load();
    if (raw == null) return defaultProfile();
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return normalizeProfile(value);
  }

  save(profile) { this._save(JSON.stringify(profile)); }
}

/** In-memory store for tests and one-process worker fallbacks. */
export function memoryStore(initial = null) {
  let text = initial == null ? null
    : (typeof initial === 'string' ? initial : JSON.stringify(initial));
  return new ProfileStore({ load: () => text, save: (value) => { text = value; } });
}

// --------------------------------------------------------------- grading
// pve_scoring.metrics, using the exact frozen M29 rules in pve-rules.GRADING.

function integer(value, name, { minimum = 0, maximum = 2 ** 32 - 1 } = {}) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`Invalid PvE grading ${name}`);
  }
  return value;
}

/**
 * Pure pve_scoring.metrics. `damage` is credited damage, `damageTotal` the
 * eligible enemy HP pool. Both accept Dec or integers; Dec comparisons keep the
 * Pyte Decimal semantics for fractional HP.
 */
export function evaluate({
  helperPower = 0, recommendedPower = 489, targetSeconds = 360,
  won = false, damage = 0, damageTotal = 0, deaths = 0, elapsed = 0,
} = {}) {
  const helper = integer(helperPower, 'helper power');
  const recommendation = integer(recommendedPower, 'recommended power', { minimum: 1 });
  const target = integer(targetSeconds, 'target seconds', { minimum: 1, maximum: 900 });
  const deathCount = integer(deaths, 'deaths', { maximum: 2 ** 31 - 1 });
  const elapsedSeconds = integer(elapsed, 'elapsed seconds', { maximum: 2 ** 31 - 1 });
  const totalHp = D(damageTotal);
  const effective = totalHp.min(D(damage)).max(0);

  let helperGrade;
  let helperPoints;
  if (helper) {
    const row = GRADING.helper.find(([percent]) => helper * 100 >= recommendation * percent);
    [helperGrade, helperPoints] = row.slice(1);
  } else {
    [helperGrade, helperPoints] = GRADING.noHelper;
  }
  const [harmGrade, harmPoints] = GRADING.harm.find(([percent]) =>
    (totalHp.gt(0) && effective.mul(100).ge(totalHp.mul(percent))) || percent === 0).slice(1);
  const [deadGrade, deadPoints] = GRADING.dead.find(([count]) =>
    deathCount <= count || count === GRADING.dead[GRADING.dead.length - 1][0]).slice(1);
  const timeRow = GRADING.time.find(([percent]) =>
    elapsedSeconds * 100 <= target * percent);
  const [timeGrade, timePoints] = timeRow ? timeRow.slice(1) : GRADING.slowTime;

  const points = helperPoints + harmPoints + deadPoints + timePoints;
  const sss = GRADING.sss;
  const eligibleSss = Boolean(won && totalHp.gt(0)
    && effective.mul(100).ge(totalHp.mul(sss.damagePercent))
    && deathCount <= sss.maxDeaths
    && elapsedSeconds * 100 <= target * sss.timePercent);
  let totalGrade = GRADING.total.find(([threshold]) => points >= threshold)[1];
  if (!eligibleSss) totalGrade = Math.min(totalGrade, 6);

  return {
    version: 1, policy: GRADING.policy, helperPower: helper,
    recommendedPower: recommendation, targetSeconds: target,
    effectiveDamage: effective.toString(), eligibleHp: totalHp.toString(),
    deaths: deathCount, elapsedSeconds, points: won ? points : 0,
    componentPoints: { helper: helperPoints, harm: harmPoints, dead: deadPoints, time: timePoints },
    eligibleSss,
    grades: won ? [totalGrade, harmGrade, deadGrade, timeGrade, helperGrade] : [0, 0, 0, 0, 0],
  };
}

/** pve_scoring.eligible: finite hostile combat NPCs only. */
function eligibleNpc(npc, playerCamp) {
  const info = (npc && npc.info) || {};
  if (!info.pve_npc || npc.camp === playerCamp) return false;
  if (info.pve_unscored || info.pve_loop || info.pve_hostage || info.pve_trap) return false;
  if (npc.hostage || npc.trap) return false;
  return D(npc.maxHp ?? 0).gt(0);
}

/**
 * pve_scoring.damage_totals over the engine's retained `npcs` map. PveEngine
 * keeps dead NPC actors, so this sees the same denominator as Python.
 * ponytail: current HP substitutes for the Python per-actor lowest-HP ledger;
 * identical unless a target heals (no map-201 NPC does). Add the ledger in
 * PveNpcActor if a later map heals enemies mid-fight.
 */
export function damageTotals(engine) {
  const camp = engine.player ? engine.player.camp : 1;
  let total = ZERO;
  let damage = ZERO;
  for (const npc of (engine.npcs ? engine.npcs.values() : [])) {
    if (!eligibleNpc(npc, camp)) continue;
    const max = D(npc.maxHp ?? 0);
    const hp = D(npc.hp ?? max).min(max).max(0);
    total = total.add(max);
    damage = damage.add(max.sub(hp).max(0));
  }
  return { damage: damage.min(total), damageTotal: total };
}

/** Freeze-then-evaluate a finished engine run (pve_scoring._result). */
export function gradeRun(engine, { won = false, now = null, scoring = null } = {}) {
  const at = now == null ? engine.now : now;
  const elapsed = Math.max(0, Math.floor((Number(at) - engine.introUntil) / 1000));
  const deaths = Number(engine.deaths ?? 0);
  const totals = damageTotals(engine);
  const native = (engine.map && engine.map.native) || {};
  const helperPower = Number(scoring?.helperPower ?? 0) || 0;
  const recommendedPower = Number(scoring?.recommendedPower)
    || Number(native.nBoosterAttack) || 489;
  const targetSeconds = Number(scoring?.targetSeconds)
    || Number(engine.rules && engine.rules.targetSeconds)
    || GRADING.targetSeconds(native.nPassTime);
  const result = evaluate({
    helperPower, recommendedPower, targetSeconds, won,
    damage: totals.damage, damageTotal: totals.damageTotal, deaths, elapsed,
  });
  return { ...result, elapsed, deaths, damage: totals.damage, damageTotal: totals.damageTotal };
}

// --------------------------------------------------------------- rewards

/** pve_progress.reward_packet item list (duplicates preserved). */
export function rewardItems(rule = {}) {
  const items = rule.version === 3 ? [...REWARD_V3] : [...REWARD];
  if (rule.version === 3 && rule.second_pet) items.push(SECOND_PET);
  return items;
}

/** Python Counter(): insertion order kept, duplicate ids stacked. */
export function coalesce(ids) {
  const counts = new Map();
  for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
  return [...counts.entries()].map(([itemId, count]) => ({ itemId, count }));
}

/**
 * pve_progress.reward_packet -> S1104. Python always emits one group, even on
 * a loss (kind=1, type=0, zero rows); isShow is 1.
 */
export function awardPacket(won, rule = {}) {
  const items = won ? coalesce(rewardItems(rule)) : [];
  return [1104, encodeS1104({
    kind: AWARD_KIND, isShow: 1, award: { groups: [{ type: 0, items }] },
  })];
}

/**
 * pve_progress.deliver. `grant(itemId, count, level)` must throw if the bag is
 * full; pending claims are then preserved for the next login. Without a grant
 * sink the claim stays pending instead of being lost.
 */
export function deliver(profile, grant = null) {
  const pending = Number(profile.pending || 0);
  const pendingV3 = Number(profile.pending_v3 || 0);
  const second = Boolean(profile.second_pet_pending);
  if (!pending && !pendingV3 && !second) return { ok: true, granted: [], packets: [] };
  if (typeof grant !== 'function') {
    return { ok: false, granted: [], packets: [], error: 'no grant sink' };
  }
  const granted = [];
  try {
    for (const [ids, count] of [[REWARD, pending], [REWARD_V3, pendingV3]]) {
      if (!count) continue;
      for (const entry of coalesce(ids)) {
        const total = entry.count * count;
        grant(entry.itemId, total, 0);
        granted.push({ itemId: entry.itemId, count: total, level: 0 });
      }
    }
    if (second) {
      grant(SECOND_PET, 1, 1);
      granted.push({ itemId: SECOND_PET, count: 1, level: 1 });
    }
  } catch (error) {
    return {
      ok: false, granted: [], error: String((error && error.message) || error),
      packets: [tipPacket(0, 'Túi nguyên liệu/trợ thủ đầy. Thưởng PvE đã lưu; dọn túi rồi đăng nhập lại để nhận.')],
    };
  }
  profile.pending = 0;
  profile.pending_v3 = 0;
  profile.second_pet_pending = false;
  return { ok: true, granted, packets: [] };
}

// -------------------------------------------------------- map / city progress
// pve_progress.map_progress / unlocked / city_record / city_body.

export function mapProgress(profile, mapId, difficulty = 0) {
  const key = String(mapId);
  if (difficulty) return profile.hard_maps[key] || { clears: 0, best_grade: 0 };
  return Number(mapId) === 201
    ? profile
    : profile.maps[key] || { clears: 0, best_grade: 0 };
}

export function unlocked(profile, mapId) {
  let resolved;
  try {
    resolved = resolveRequest(Number(mapId));
  } catch {
    return false;
  }
  if (resolved.difficulty) return mapProgress(profile, resolved.mapId).clears > 0;
  const normal = resolved.mapId;
  if (normal === 201) return true;
  const index = MAP_IDS.indexOf(normal);
  return index > 0 && mapProgress(profile, MAP_IDS[index - 1]).clears > 0;
}

/** Native CityTemplate record: flags bit3=unlocked, bit4=normal, bit5=hard. */
export function cityRecord(clears, bestGrade = 0, mapId = 201, isUnlocked = true,
  { hardClears = 0, hardGrade = 0 } = {}) {
  const flags = (isUnlocked ? 15 : 7) | (clears ? 16 : 0) | (hardClears ? 32 : 0);
  return { cityId: CITIES[mapId], flags, bestGrade, hardGrade };
}

/** S1303/S1304 body: uint16 map count + <IIBBII> rows in MAPS order. */
export function cityBody(profile) {
  const writer = new Writer();
  writer.u16(MAP_IDS.length);
  for (const mapId of MAP_IDS) {
    const normal = mapProgress(profile, mapId);
    const hard = NORMAL_TO_HARD[mapId] != null ? mapProgress(profile, mapId, 1) : null;
    const record = cityRecord(normal.clears, normal.best_grade, mapId, unlocked(profile, mapId), {
      hardClears: hard ? hard.clears : 0, hardGrade: hard ? hard.best_grade : 0,
    });
    writer.u32(record.cityId).u32(record.flags).u8(record.bestGrade)
      .u8(record.hardGrade).u32(0).u32(0);
  }
  return writer.finish();
}

export function cityPacket(profile) { return [CITY_LIST, cityBody(profile)]; }
export function cityUpdate(profile) { return [CITY_UPDATE, cityBody(profile)]; }

/** Chapter completion summary (the native packet has no chapter field). */
export function chapterProgress(profile) {
  const out = {};
  for (const [chapter, maps] of Object.entries(CHAPTER_IDS)) {
    out[chapter] = {
      chapter: Number(chapter),
      total: maps.length,
      cleared: maps.filter((mapId) => mapProgress(profile, mapId).clears > 0).length,
    };
  }
  return out;
}

/**
 * pve_progress.complete: receipt-idempotent progress. Returns a summary; the
 * profile is mutated in place so the caller can persist it once.
 */
export function completeRun(profile, {
  mapId, difficulty = 0, runId, won = false, rule = {}, grades = null,
} = {}) {
  if (!MAP_IDS.includes(Number(mapId))) return { changed: false, summary: null };
  if (typeof runId !== 'string' || !runId || runId.length > 128) {
    throw new RangeError('Invalid persistent PvE run identity');
  }
  // ponytail: receipts grow one key per completed run. Cap/expire them only if
  // a profile ever holds thousands of runs; the save is a single JSON blob.
  const receipts = profile.receipts || (profile.receipts = {});
  if (receipts[runId] || profile.last_run === runId) return { changed: false, summary: null };
  receipts[runId] = 1;
  profile.last_run = runId;

  const summary = { mapId: Number(mapId), difficulty, runId, won: Boolean(won) };
  if (won) {
    const current = mapProgress(profile, mapId, difficulty);
    current.clears += 1;
    if (difficulty) profile.hard_maps[String(mapId)] = current;
    else if (Number(mapId) !== 201) profile.maps[String(mapId)] = current;
    if (rule.version === 3) profile.pending_v3 += 1;
    else profile.pending += 1;
    if (Number(mapId) === 201 && rule.version === 3
      && rule.second_pet && !profile.second_pet_earned) {
      profile.second_pet_earned = true;
      profile.second_pet_pending = true;
      summary.secondPet = true;
    }
    if (Array.isArray(grades) && grades.length) {
      current.best_grade = Math.max(current.best_grade, grades[0]);
    }
    summary.clears = current.clears;
    summary.bestGrade = current.best_grade;
  }
  return { changed: true, summary };
}

// ------------------------------------------------------------- settlement
// pve_rules.settlement(): pve.total/harm/dead/time/booster are the five
// grading values, not raw kills (client field names are historical).

export function settlementPayload({
  sceneId = 0, mapId = 0, battleTime = 0, won = false, lives = 0,
  accountId = 0, tankId = 0, tankLevel = 1, stats = null,
  grades = [0, 0, 0, 0, 0], sceneUuid = '',
} = {}) {
  const rowStats = Array.isArray(stats) && stats.length === 21
    ? stats.map((value) => Math.round(Number(value) || 0))
    : Array(21).fill(0);
  return {
    sceneId: Number(sceneId) >>> 0, mapId: Number(mapId) >>> 0,
    battleTime: Math.max(0, Math.floor(Number(battleTime) || 0)),
    roomType: 4, winCamp: won ? 1 : 0, winType: 1,
    redLifeCount: Number(lives) || 0, blueLifeCount: 0,
    actors: [{
      accountId: Number(accountId) >>> 0, tankId: Number(tankId) >>> 0, stats: rowStats,
      teamMerit: 0, oldElo: 0, newElo: 0, tankGains: 0, newTankGains: 0,
      award: 0, isWin: won ? 1 : 0, robotType: 0, eloSection: 0,
      battleLevel: Number(tankLevel) || 1, roomCount: 1, camp: 1,
      exp: [], coins: [], tankExp: [], items: [],
      pve: {
        total: grades[0] || 0, harm: grades[1] || 0, dead: grades[2] || 0,
        time: grades[3] || 0, booster: grades[4] || 0,
      },
    }],
    escaped: [],
    serverExpRate: 1, tokenGoldRate: 1, bpvpActOpen: 0, itemDropRate: 0,
    killerId: 0, assisterId: 0, kdaId: 0, destroyerId: 0,
    victoryMvpId: 0, defeatMvpId: 0, sceneUuid: String(sceneUuid || ''),
  };
}

export function settlementPayloadFromEngine(engine, {
  won = false, now = null, grades = null, scoring = null,
} = {}) {
  const player = engine.player;
  const at = now == null ? engine.now : now;
  const battleTime = Math.max(0, Math.floor((Number(at) - engine.introUntil) / 1000));
  const evaluated = grades || gradeRun(engine, { won, now, scoring }).grades;
  return settlementPayload({
    sceneId: engine.sceneId, mapId: engine.map.id, battleTime, won,
    lives: engine.lives, accountId: engine.accountId ?? player.info.acct_id,
    tankId: player.info.tank_id, tankLevel: player.info.tank_level ?? 1,
    stats: stats21(player), grades: evaluated, sceneUuid: engine.runId,
  });
}

export function encodeSettlement(payload) { return [1708, encodeS1708(payload)]; }

// ----------------------------------------------------------------- stamina

export function defaultStamina(thew = 0, thewBuy = 0, thewVip = 0) {
  return { version: 1, thew, thew_buy: thewBuy, thew_vip: thewVip };
}

export function validateStamina(value) {
  if (!value || typeof value !== 'object' || value.version !== 1) {
    throw new RangeError('Dữ liệu thể lực chưa hợp lệ; chưa trừ xu.');
  }
  for (const name of ['thew', 'thew_buy', 'thew_vip']) {
    const number = value[name];
    if (!Number.isInteger(number) || number < 0 || number > STAMINA.max) {
      throw new RangeError('Dữ liệu thể lực ngoài giới hạn native; chưa trừ xu.');
    }
  }
  return value;
}

/** Bootstrap from the native 1016 login frame (header offset 8 + 76). */
export function staminaFromLoginFrame(frame) {
  const bytes = bytesOf(frame);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = 8 + STAMINA.thewOffset;
  if (bytes.length < offset + 4) throw new RangeError('Không có dữ liệu thể lực native.');
  return validateStamina(defaultStamina(
    view.getInt16(offset, true), view.getInt16(offset + 2, true), 0));
}

export function staminaNotify(value) {
  const current = validateStamina(value);
  return [STAMINA.notify, new Writer()
    .i32(current.thew).i32(current.thew_buy).i32(current.thew_vip).finish()];
}

export function currencyPacket(currency) {
  const writer = new Writer().u16(2).u16(0);
  for (const value of currency) writer.i32(value);
  return [1039, writer.finish()];
}

/** cosmetic_shop.tip: S1501 <IiHH> mid, 3997, 1, len + message. */
export function tipPacket(mid, message) {
  const raw = new TextEncoder().encode(String(message));
  return [1501, new Writer().u32(mid).i32(3997).u16(1).u16(raw.length).add(raw).finish()];
}

function bytesOf(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError('Protocol payload must be bytes');
}

/** pve_stamina.apply: lobby-only purchase, atomic wallet + thew update. */
export function purchaseStamina({ stamina, wallet, payload, state = null } = {}) {
  const fail = (message) => ({
    ok: false, error: message, packets: [tipPacket(STAMINA.request, message)],
  });
  try {
    if (state && (state.battle || state.tank_selection
      || (state.room && Number(state.room.state) !== 0))) {
      return fail('Chỉ mua thể lực ở sảnh hoặc phòng chờ.');
    }
    const body = bytesOf(payload);
    if (body.length !== 10) return fail('Mỗi lần mua 100 thể lực giá 1 xu vàng.');
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    if (view.getUint16(0, true) !== 1 || view.getUint32(2, true) !== STAMINA.cash
      || view.getInt32(6, true) !== STAMINA.price) {
      return fail('Mỗi lần mua 100 thể lực giá 1 xu vàng.');
    }
    const current = validateStamina(stamina);
    const currency = wallet && wallet.currency;
    if (!Array.isArray(currency) || currency.length !== 6
      || currency.some((value) => !Number.isInteger(value)
        || value < -0x80000000 || value > 0x7fffffff)) {
      return fail('Dữ liệu xu chưa hợp lệ; chưa trừ xu.');
    }
    if (currency[0] < STAMINA.price) {
      return fail('Bạn không đủ 1 xu vàng để mua 100 thể lực.');
    }
    if (current.thew > STAMINA.max - STAMINA.gain || current.thew_buy === STAMINA.max) {
      return fail('Thể lực đã gần giới hạn native (32767); chưa trừ xu.');
    }
    const next = { ...current, thew: current.thew + STAMINA.gain, thew_buy: current.thew_buy + 1 };
    const nextCurrency = [...currency];
    nextCurrency[0] -= STAMINA.price;
    return {
      ok: true, stamina: next, wallet: { ...wallet, currency: nextCurrency },
      packets: [currencyPacket(nextCurrency), staminaNotify(next)],
    };
  } catch (error) {
    return fail(error instanceof RangeError ? error.message : 'Yêu cầu mua thể lực không hợp lệ.');
  }
}

/** Offline entry cost: every supported MapTemplate row has null consume fields. */
export function entryCost(map) {
  const consume = map && map.stamina ? map.stamina : null;
  if (!consume || consume.entryItem == null) return 0;
  return Number(consume.entryCount) || 0;
}

export function spendEntry(stamina, map) {
  const current = validateStamina(stamina);
  const cost = entryCost(map);
  if (cost > current.thew) return { ok: false, error: 'Không đủ thể lực để vào màn PvE.' };
  return { ok: true, cost, stamina: cost ? { ...current, thew: current.thew - cost } : current };
}

// ---------------------------------------------------------- worker adapter

/**
 * PveProgress freezes the run rule before the battle and settles once after.
 * `hooks` plugs into PveEngine ({ start, complete }); `settle` returns the
 * authoritative S1104/S1708/S1304 packets. Use `replaceSettlement` on the raw
 * [msgId, payload] frames PveEngine emits to swap engine defaults for these.
 */
export class PveProgress {
  constructor({ store = null, profile = null, grant = null, scoring = null } = {}) {
    this.store = store;
    this.profile = normalizeProfile(profile ?? (store ? store.load() : defaultProfile()));
    this.grant = grant;
    this.scoring = { helperPower: 0, recommendedPower: 489, targetSeconds: 360, ...(scoring || {}) };
    this.rule = null;
    this.runId = '';
    this.mapId = null;
    this.difficulty = 0;
  }

  beginRun({
    requestedMapId = null, mapId = null, difficulty = 0, runId = '',
    version = 3, secondPet = null, scoring = null,
  } = {}) {
    let canonical = mapId;
    let level = difficulty;
    if (requestedMapId != null) {
      const resolved = resolveRequest(Number(requestedMapId));
      canonical = resolved.mapId;
      level = resolved.difficulty;
    }
    this.mapId = canonical == null ? null : Number(canonical);
    this.difficulty = Number(level) || 0;
    if (scoring) this.scoring = { ...this.scoring, ...scoring };
    this.rule = {
      version,
      second_pet: secondPet ?? (this.mapId === 201 && !this.profile.second_pet_earned),
    };
    this.runId = String(runId ?? '');
    return this.rule;
  }

  get hooks() {
    return {
      start: (engine) => {
        if (!this.rule) {
          this.beginRun({
            mapId: engine.map && engine.map.id, runId: engine.runId, scoring: this.scoring,
          });
        }
      },
      // PveEngine's map rules own the win/lose decision. Keep the hook so the
      // worker can pass one object for both start and completion.
      complete: () => undefined,
    };
  }

  save() { if (this.store) this.store.save(this.profile); }

  settlementPayload(engine, { won = false, now = null, grades = null } = {}) {
    return settlementPayloadFromEngine(engine, {
      won, now, grades, scoring: this.scoring,
    });
  }

  settle(engine, { won = false, now = null } = {}) {
    const mapId = Number((engine.map && engine.map.id) ?? this.mapId);
    if (!this.rule) this.beginRun({ mapId, runId: engine.runId });
    const finished = Boolean(won);
    const grade = gradeRun(engine, { won: finished, now, scoring: this.scoring });
    const { changed, summary } = completeRun(this.profile, {
      mapId, difficulty: this.difficulty, runId: this.runId, won: finished,
      rule: this.rule, grades: grade.grades,
    });
    if (!changed) {
      return { changed: false, packets: [], grades: grade, delivered: { ok: true, granted: [] }, summary };
    }
    const packets = [awardPacket(finished, this.rule)];
    const delivered = finished
      ? deliver(this.profile, this.grant)
      : { ok: true, granted: [], packets: [] };
    packets.push(...delivered.packets);
    packets.push(encodeSettlement(this.settlementPayload(engine, {
      won: finished, now, grades: grade.grades,
    })));
    packets.push(cityUpdate(this.profile));
    this.save();
    return { changed: true, packets, grades: grade, delivered, summary };
  }
}

/**
 * Replace PveEngine's default S1104/S1708 raw frames with this run's progress
 * packets (order follows Python: 1104 -> 1708 -> 1304, after 1707).
 */
export function replaceSettlement(frames, result) {
  if (!result || !result.changed) return frames;
  const out = frames.filter((frame) => {
    const id = Array.isArray(frame) ? frame[0] : (frame[2] | (frame[3] << 8));
    return id !== 1104 && id !== 1708;
  });
  out.push(...result.packets);
  return out;
}

/** Make PveEngine._finish's `this.settlement()` produce progress-authoritative S1708. */
export function bindEngine(engine, progress) {
  engine.settlement = (won, now) => progress.settlementPayload(engine, { won, now });
  return engine;
}
