/* Battle table adapter: client catalog JSON -> Python-style table_row().
 *
 * The Python server reads SQLite template rows as string dictionaries. The
 * browser build has the same data in m6_asset_catalog (tanks/skills/buffs/
 * AI NPCs/maps), m8_garage_catalog (TankUp/strengthen) and the M81314 PvE
 * catalog (maps/NPC templates/MapTemplate). This module normalises all of
 * them to the SQLite shape so a mechanical tank-action port can keep calling
 * table_row('SkillTemplate_table.xml', {nId}) and reading string fields.
 *
 * For an actual SQLite export simply call data.addRows('SkillTemplate_table.xml',
 * rows); rows may use numbers and are stringified exactly like storage.py.
 */

const TABLES = {
  tankBase: 'TankBaseTemplate_table.xml',
  tankUp: 'TankUpTemplate_table.xml',
  tankStrengthen: 'TankStrengthenTemplate_table.xml',
  skill: 'SkillTemplate_table.xml',
  buff: 'BuffTemplate_table.xml',
  aiNpc: 'AINpcTemplate_table.xml',
  aiArms: 'AINpcArmsTemplate_table.xml',
  aiNpcLevel: 'AINpcLevelTemplate_table.xml',
  npc: 'NpcTemplate_table.xml',
  exhibit: 'BulletExhibit_table.xml',
  map: 'MapTemplate_table.xml',
};

function scalar(value) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined;
    return String(value);
  }
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'bigint') return value.toString();
  return undefined; // nested arrays/objects are not SQLite scalar columns
}

/** Python-dict-like row: row.get('field', default) plus direct field access. */
export class TableRow {
  constructor(fields = {}) { Object.assign(this, fields); }
  get(key, fallback = null) {
    const value = this[key];
    return value === undefined ? fallback : value;
  }
}

function rowFromObject(source, extra = {}) {
  const fields = {};
  for (const [key, value] of Object.entries(source || {})) {
    const text = scalar(value);
    if (text !== undefined) fields[key] = text;
  }
  for (const [key, value] of Object.entries(extra)) {
    const text = scalar(value);
    if (text !== undefined) fields[key] = text;
  }
  return fields;
}

function add(map, name, rows) {
  const list = map.get(name) || [];
  for (const row of rows) list.push(row);
  map.set(name, list);
}

function flattenStats(target, stats) {
  for (const [key, value] of Object.entries(stats || {})) {
    const text = scalar(value);
    if (text !== undefined) target[key] = text;
  }
  return target;
}

function normalizeBlocks(raw) {
  const walls = [], movementWalls = [];
  if (Array.isArray(raw.blocks) && raw.blocks.length) {
    for (const [x, y, width, height, value] of raw.blocks) {
      if (width <= 0 || height <= 0) continue;
      const rect = [x - width / 2, y - height / 2, x + width / 2, y + height / 2];
      if (value === -1) walls.push(rect);
      if (value === -1 || value === -2) movementWalls.push(rect);
    }
    return { walls, movementWalls };
  }
  const cell = 24;
  const columns = raw.columns || Math.trunc(raw.width / cell);
  for (const [index, value] of raw.gridCells || []) {
    if (value !== -1 && value !== -2) continue;
    const x = (index % columns) * cell, y = Math.floor(index / columns) * cell;
    const rect = [x, y, x + cell, y + cell];
    if (value === -1) walls.push(rect);
    movementWalls.push(rect);
  }
  return { walls, movementWalls };
}

/** Convert a catalog map row to the Python battle_map definition shape. */
export function normalizeMapDefinition(raw, fallbackId = 0) {
  if (!raw || !(raw.width > 0) || !(raw.height > 0)) {
    throw new Error(`Map ${fallbackId} has no verified geometry`);
  }
  const { walls, movementWalls } = normalizeBlocks(raw);
  const npcs = raw.npcs || raw.staticNPCs || [];
  return {
    id: Number(raw.mapId ?? fallbackId),
    width: raw.width,
    height: raw.height,
    bounds: raw.bounds || [36, 36, raw.width - 36, raw.height - 36],
    walls,
    movementWalls,
    spawns: raw.spawns || { 1: [[444, 612]], 2: [[780, 804]] },
    respawns: raw.respawns || raw.spawns || { 1: [[444, 612]], 2: [[780, 804]] },
    npcs,
    robos: raw.robos || [],
    pve_barriers: raw.pve_barriers || raw.authoritativeDefinition?.pve_barriers || [],
    raw,
  };
}

/** Local map 101, the documented M2 test room (walls from the SQLite setting). */
export const MAP101 = Object.freeze({
  id: 101, width: 1440, height: 936, bounds: [252, 108, 1188, 828],
  walls: [
    [0, 0, 216, 936], [216, 864, 1224, 936], [1224, 0, 1440, 936],
    [216, 0, 1224, 72], [216, 432, 360, 504], [504, 432, 936, 504],
    [1080, 432, 1224, 504],
  ],
  movementWalls: [
    [0, 0, 216, 936], [216, 864, 1224, 936], [1224, 0, 1440, 936],
    [216, 0, 1224, 72], [216, 432, 360, 504], [504, 432, 936, 504],
    [1080, 432, 1224, 504],
  ],
  spawns: { 1: [[444, 612]], 2: [[780, 804]] },
  respawns: { 1: [[444, 612]], 2: [[780, 804]] },
  npcs: [], robos: [],
});

export class BattleData {
  constructor({ garage = null, assets = null, pve = null, extraMaps = [] } = {}) {
    this.tables = new Map();
    this.rawMaps = new Map();
    this.cache = new Map();
    this._npcTemplates = new Map();
    if (garage) this._loadGarage(garage);
    if (assets) this._loadAssets(assets);
    if (pve) this._loadPve(pve);
    add(this.tables, TABLES.npc, [...this._npcTemplates.values()]);
    for (const [id, raw] of extraMaps) this.addMap(id, raw);
  }

  _setNpcTemplate(templateId, row) {
    this._npcTemplates.set(String(templateId), rowFromObject(row, { nTemplateId: templateId }));
  }

  _loadGarage(catalog) {
    const tanks = [];
    for (const row of Object.values(catalog.levels || {})) {
      const fields = {
        nTankId: String(row.tankId), nLevel: String(row.level),
        externalId: String(row.externalId ?? ''),
      };
      tanks.push(flattenStats(fields, row.stats));
    }
    add(this.tables, TABLES.tankUp, tanks);

    const strengthen = [];
    for (const row of Object.values(catalog.strengthening || {})) {
      strengthen.push({
        nTankId: String(row.tankId), nTankLevel: String(row.tankLevel),
        nLevel: String(row.strengthenLevel),
        nHpValue: String(row.hpBonus ?? 0), nAttackValue: String(row.attackBonus ?? 0),
      });
    }
    add(this.tables, TABLES.tankStrengthen, strengthen);

    // Garage rows are TankUp only; TankBase comes from the M6 asset catalog.
    for (const [key, row] of Object.entries(catalog.skills || {})) {
      const id = row.nId ?? row.skillId ?? key.split(':')[0];
      add(this.tables, TABLES.skill, [rowFromObject(row, {
        nId: id, nLevel: row.nLevel ?? row.level ?? 1,
      })]);
    }
  }

  _loadAssets(catalog) {
    for (const [key, tank] of Object.entries(catalog.tanks || {})) {
      const id = tank.tankId ?? Number(key);
      add(this.tables, TABLES.tankBase, [rowFromObject(tank.base, {
        nTankId: id, tankId: id, szName: tank.name,
      })]);
    }
    for (const [key, row] of Object.entries(catalog.skills || {})) {
      add(this.tables, TABLES.skill, [rowFromObject(row, { nId: row.nId ?? key })]);
    }
    for (const [key, row] of Object.entries(catalog.buffs || {})) {
      add(this.tables, TABLES.buff, [rowFromObject(row, { nBuffId: row.nBuffId ?? key })]);
    }
    for (const [key, row] of Object.entries(catalog.exhibits || {})) {
      add(this.tables, TABLES.exhibit, [rowFromObject(row, { nBulletId: row.nBulletId ?? key })]);
    }
    for (const [key, row] of Object.entries(catalog.aiNPCs || {})) {
      add(this.tables, TABLES.aiNpc, [rowFromObject(row, { nTemplateId: row.nTemplateId ?? key })]);
    }
    for (const [key, row] of Object.entries(catalog.aiArms || {})) {
      add(this.tables, TABLES.aiArms, [rowFromObject(row, { nTemplateId: row.nTemplateId ?? key })]);
    }
    for (const [key, row] of Object.entries(catalog.mapNPCs || {})) {
      this._setNpcTemplate(row.nTemplateId ?? key, row);
    }
    for (const [key, raw] of Object.entries(catalog.maps || {})) {
      this.addMap(raw.mapId ?? Number(key), raw);
    }
  }

  _loadPve(catalog) {
    for (const [name, rows] of Object.entries(catalog.templates || {})) {
      const filename = name.endsWith('.xml') ? name : `${name}.xml`;
      const out = [];
      for (const row of rows) {
        const fields = rowFromObject(row);
        if (name === 'MapTemplate_table' && fields.nId === undefined) {
          const id = row.nId ?? row.nMapId;
          if (id !== undefined && id !== null) fields.nId = String(id);
        }
        out.push(fields);
      }
      add(this.tables, filename, out);
    }
    for (const [key, raw] of Object.entries(catalog.maps || {})) {
      this.addMap(raw.mapId ?? Number(key), raw);
      for (const [templateId, row] of Object.entries(raw.npcTemplates || {})) {
        this._setNpcTemplate(row.nTemplateId ?? templateId, row);
      }
    }
  }

  addRows(filename, rows) {
    const list = rows.map(row => row instanceof TableRow ? { ...row } : rowFromObject(row));
    add(this.tables, filename, list);
    this.cache.clear();
  }

  addMap(id, raw) {
    this.rawMaps.set(Number(id), raw);
  }

  hasTable(filename) {
    return this.tables.has(filename) || this.tables.has(filename.replace(/\.xml$/, ''));
  }

  _rows(filename) {
    const rows = this.tables.get(filename) ?? this.tables.get(filename.replace(/\.xml$/, ''));
    if (!rows) throw new Error(`Missing battle table ${filename}`);
    return rows;
  }

  tableRow(filename, keys = {}) {
    const entries = Object.entries(keys).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const cacheKey = `${filename}|${entries.map(([k, v]) => `${k}=${v}`).join('&')}`;
    if (this.cache.has(cacheKey)) return new TableRow({ ...this.cache.get(cacheKey) });
    const matches = this._rows(filename).filter(row =>
      entries.every(([key, value]) => row[key] === String(value)));
    if (!matches.length) {
      throw new Error(`Missing battle template ${filename}: ${entries.map(([k, v]) => `${k}=${v}`).join(',')}`);
    }
    if (matches.length > 1 && !['SkillTemplate_table.xml', 'BulletExhibit_table.xml'].includes(filename)) {
      throw new Error(`Ambiguous battle template ${filename}: ${entries.map(([k, v]) => `${k}=${v}`).join(',')}`);
    }
    // Skill/BulletExhibit follow HashMap.put XML order: the last row wins.
    const row = matches[matches.length - 1];
    this.cache.set(cacheKey, row);
    return new TableRow({ ...row });
  }

  activeBuffEffectTypes(templates) {
    const types = new Set();
    for (const template of templates || []) {
      types.add(Number(this.tableRow(TABLES.buff, { nBuffId: template }).nEffectType));
    }
    return types;
  }

  tankStats(tankId, level, strength = 0) {
    const stats = this.tableRow(TABLES.tankUp, { nTankId: tankId, nLevel: level });
    if (strength) {
      const row = this.tableRow(TABLES.tankStrengthen, {
        nTankId: tankId, nTankLevel: level, nLevel: strength,
      });
      for (const [stat, bonus] of [['iHp', 'nHpValue'], ['iAttack', 'nAttackValue'], ['iEgAtk', 'nAttackValue']]) {
        stats[stat] = String(Number(stats.get(stat, '0')) + Number(row.get(bonus, '0')));
      }
    }
    return stats;
  }

  mapDefinition(mapId) {
    if (Number(mapId) === 101) return { ...MAP101, data: MAP101, raw: MAP101 };
    const raw = this.rawMaps.get(Number(mapId));
    if (!raw) throw new Error(`Map ${mapId} has no imported geometry`);
    return normalizeMapDefinition(raw, mapId);
  }

  /** Convenience for browser callers; the tests pass parsed objects directly.
   * The m6/M81314 catalogs are split mid-JSON, so parts are concatenated as
   * text before parsing (fetch().json() cannot read a single part).
   */
  static async fetchCatalogs({ garageUrl, assetsUrls = [], pveUrls = [] } = {}) {
    const readText = async url => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Catalog fetch failed: ${url} (${response.status})`);
      return response.text();
    };
    const garage = garageUrl ? JSON.parse(await readText(garageUrl)) : null;
    const assets = assetsUrls.length
      ? JSON.parse((await Promise.all(assetsUrls.map(readText))).join('')) : null;
    const pve = pveUrls.length
      ? JSON.parse((await Promise.all(pveUrls.map(readText))).join('')) : null;
    return new BattleData({ garage, assets, pve });
  }
}

export function createData(catalogs) {
  return catalogs instanceof BattleData ? catalogs : new BattleData(catalogs);
}

// Python-name methods for mechanical tank ports using an arena's data object.
BattleData.prototype.table_row = BattleData.prototype.tableRow;
BattleData.prototype.tank_stats = BattleData.prototype.tankStats;
BattleData.prototype.active_buff_effect_types = BattleData.prototype.activeBuffEffectTypes;
BattleData.prototype.map_definition = BattleData.prototype.mapDefinition;
BattleData.prototype.add_rows = BattleData.prototype.addRows;

// Module-level equivalents of combat_data.py. The arena binds its own data so
// the ~91 ported files can keep `table_row(...)` / `tank_stats(...)` verbatim.
// One active match per JS realm, which matches the browser worker model.
let activeData = null;

export function setActiveData(data) {
  activeData = data instanceof BattleData ? data : new BattleData(data || {});
  return activeData;
}
export function getActiveData() { return activeData; }
function requireData() {
  if (!activeData) throw new Error('No active BattleData; construct a BattleArena or call setActiveData first');
  return activeData;
}
export function table_row(filename, keys = {}) { return requireData().tableRow(filename, keys); }
export function tank_stats(tankId, level, strength = 0) {
  return requireData().tankStats(tankId, level, strength);
}
export function active_buff_effect_types(templates) {
  return requireData().activeBuffEffectTypes(templates);
}

export { TABLES };
