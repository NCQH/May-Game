// Browser bridge: load the real PvE catalogs, build the core arena, and expose
// frame-ready packets for the local JS worker. Map 201 is the first target;
// other maps use the same data-driven hooks.
import { M81314_PARTS, M6_PARTS, buildPveIndex } from './engine/pve-data.js';
import { createData } from './engine/data.js';
import { PveEngine } from './engine/pve-engine.js';
import { npcStatsAtQuality, mapQuality } from './engine/pve-balance.js';
import { frame } from './engine/protocol.js';
import { NarutoActions } from './engine/tanks/naruto.js';
import { QuanVuActions } from './engine/tanks/quanvu.js';
import { GundamActions } from './engine/tanks/gundam.js';
import { IronManActions } from './engine/tanks/ironman.js';
import { PandaActions } from './engine/tanks/panda.js';

export const TANKS = {
  10000044: NarutoActions,
  10000056: QuanVuActions,
  10000019: GundamActions,
  10000001: IronManActions,
  10000003: PandaActions,
};

const BASE = new URL('../', import.meta.url);
const TANK_DATA = new URL('./engine/tanks/batch-a1-data.json', import.meta.url);
let cached = null;

async function readParts(parts) {
  const responses = await Promise.all(parts.map((name) => fetch(new URL(name, BASE))));
  for (const response of responses) if (!response.ok) throw new Error(`Catalog ${response.url}: HTTP ${response.status}`);
  return (await Promise.all(responses.map((response) => response.text()))).join('');
}

async function catalogs() {
  if (cached) return cached;
  const [pveText, m6Text, garage, fixture] = await Promise.all([
    readParts(M81314_PARTS),
    readParts(M6_PARTS),
    fetch(new URL('m8_garage_catalog.json', BASE)).then((r) => r.json()),
    fetch(TANK_DATA).then((r) => r.json()),
  ]);
  const pve = JSON.parse(pveText);
  const m6 = JSON.parse(m6Text);
  const index = buildPveIndex(pve);
  const data = createData({ garage, assets: m6, pve });
  for (const [table, key] of [
    ['TankBaseTemplate_table.xml', 'tankBase'],
    ['TankUpTemplate_table.xml', 'tankUp'],
    ['SkillTemplate_table.xml', 'skills'],
    ['BuffTemplate_table.xml', 'buffs'],
    ['EffectTemplate_table.xml', 'effects'],
  ]) if (fixture[key]) data.addRows(table, fixture[key]);
  cached = { index, data };
  return cached;
}

export function preloadPveCatalogs() { return catalogs(); }

export function s1586(startTime = 0, overtime = 0) {
  const payload = new Uint8Array(5);
  new DataView(payload.buffer).setUint32(0, startTime >>> 0, true);
  payload[4] = overtime & 255;
  return frame(1586, payload);
}

export async function createPveBattle({ mapId = 201, tankId = 10000044, name = '', sceneId = 1, level = 1 } = {}) {
  const { index, data } = await catalogs();
  const map = index.maps.get(Number(mapId));
  if (!map) throw new Error('Unknown PvE map ' + mapId);
  const engine = new PveEngine({
    map, data, npcProfiles: index.npcProfiles,
    npcStats: npcStatsAtQuality(mapQuality(map)),
    npcArmorConstant: 100,
    tank: { tankId: Number(tankId), level: Number(level) || 1 },
    name, sceneId: Number(sceneId) || 1, runId: 'js-pve-' + Number(mapId),
    classes: TANKS,
  });
  const pack = (frames) => frames.map(([id, payload]) => frame(id, payload));
  return {
    engine,
    start: pack(engine.drain()),
    tick(deltaMs = 50) { return pack(engine.advance(deltaMs)); },
    handle(msgId, payload) { return pack(engine.handle(msgId, payload)); },
    finish(won) { return pack(engine.finish(won)); },
    get finished() { return engine.finished; },
    get won() { return engine.won; },
  };
}
