// Browser bridge: PvP-with-bots battle using the ported PvP engine.
import { M6_PARTS } from './engine/pve-data.js';
import { createData } from './engine/data.js';
import { PvpEngine } from './engine/pvp/pvp-engine.js';
import { frame } from './engine/protocol.js';

const BASE = new URL('../', import.meta.url);
const CATALOGS = ['m89_pk_catalog.json', 'm810_modes_catalog.json',
  'm811_death_catalog.json', 'm81330_worldboss_catalog.json'];
let cached = null;

function merge(assets, catalog) {
  for (const [table, rows] of Object.entries(catalog.bindings || {})) {
    assets[table] = { ...(assets[table] || {}), ...rows };
  }
  for (const [id, map] of Object.entries(catalog.maps || {})) assets.maps[id] = map;
}

async function readParts(parts) {
  const responses = await Promise.all(parts.map((name) => fetch(new URL(name, BASE))));
  for (const response of responses) if (!response.ok) throw new Error(`${response.url}: HTTP ${response.status}`);
  return (await Promise.all(responses.map((response) => response.text()))).join('');
}

async function catalogs() {
  if (cached) return cached;
  const [m6Text, garage, ...extra] = await Promise.all([
    readParts(M6_PARTS),
    fetch(new URL('m8_garage_catalog.json', BASE)).then((r) => r.json()),
    ...CATALOGS.map((name) => fetch(new URL(name, BASE)).then((r) => r.json())),
  ]);
  const m6 = JSON.parse(m6Text);
  for (const catalog of extra) merge(m6, catalog);
  cached = { data: createData({ garage, assets: m6 }), maps: m6.maps || {} };
  return cached;
}

export function preloadPvpCatalogs() { return catalogs(); }

export async function createPvpBattle({
  mapId = 19, sceneId = 1, player = {}, bots = [], charId = 30000797, name = '',
} = {}) {
  const { data, maps } = await catalogs();
  const raw = maps[String(mapId)];
  if (!raw) throw new Error('Unknown PvP map ' + mapId);
  const engine = new PvpEngine({
    map: raw, data, bots, sceneId: Number(sceneId) || 1,
    charId: Number(charId) || 30000797, name,
    player: { tankId: Number(player.tankId) || 10000044, tankLevel: 1, human: true, name: player.name || name },
    runId: 'pvp-' + mapId,
  });
  const pack = (frames) => frames.map(([id, payload]) => frame(id, payload));
  return {
    engine,
    start: pack(engine.drain()),
    tick(deltaMs = 50) { return pack(engine.advance(deltaMs)); },
    handle(msgId, payload) { return pack(engine.handle(msgId, payload)); },
    get finished() { return engine.finished; },
  };
}
