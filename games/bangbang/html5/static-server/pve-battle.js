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
import { GiongActions } from './engine/tanks/giong.js';
import { AssassinActions } from './engine/tanks/assassin.js';
import { SonTinhActions } from './engine/tanks/sontinh.js';
import { ThachSanhActions } from './engine/tanks/thachsanh.js';
import { PantherActions } from './engine/tanks/panther.js';
import { SpongeActions } from './engine/tanks/sponge.js';
import { ScorpionActions } from './engine/tanks/scorpion.js';
import { StarLordActions } from './engine/tanks/starlord.js';
import { NatsuActions } from './engine/tanks/natsu.js';
import { MermaidActions } from './engine/tanks/mermaid.js';
import { OxActions } from './engine/tanks/ox.js';
import { HikariActions } from './engine/tanks/hikari.js';
import { FireGodActions } from './engine/tanks/firegod.js';
import { ChuDuActions } from './engine/tanks/chudu.js';
import { HuluActions } from './engine/tanks/hulu.js';
import { BaymaxActions } from './engine/tanks/baymax.js';
import { AthenaActions } from './engine/tanks/athena.js';
import { HulkActions } from './engine/tanks/hulk.js';
import { TimeHunterActions } from './engine/tanks/timehunter.js';
import { PegasusActions } from './engine/tanks/pegasus.js';
import { PhoenixActions } from './engine/tanks/phoenix.js';
import { DiaoChanActions } from './engine/tanks/diaochan.js';
import { ThuyTinhActions } from './engine/tanks/thuytinh.js';
import { TransformerActions } from './engine/tanks/transformer.js';
import { SupermanActions } from './engine/tanks/superman.js';
import { MedusaActions } from './engine/tanks/medusa.js';
import { JokerActions } from './engine/tanks/joker.js';
import { FoxActions } from './engine/tanks/fox.js';
import { FalconActions } from './engine/tanks/falcon.js';
import { WukongActions } from './engine/tanks/wukong.js';
import { OptimusActions } from './engine/tanks/optimus.js';
import { NezhaActions } from './engine/tanks/nezha.js';
import { AngelActions } from './engine/tanks/angel.js';
import { DeadpoolActions } from './engine/tanks/deadpool.js';
import { KanekiActions } from './engine/tanks/kaneki.js';
import { HadesActions } from './engine/tanks/hades.js';
import { SasukeActions } from './engine/tanks/sasuke.js';
import { PumpkinActions } from './engine/tanks/pumpkin.js';
import { KurumiActions } from './engine/tanks/kurumi.js';
import { DarkKnightActions } from './engine/tanks/darkknight.js';
import { WolfActions } from './engine/tanks/wolf.js';
import { ShadowbladeActions } from './engine/tanks/shadowblade.js';
import { StoneGodActions } from './engine/tanks/stonegod.js';
import { AquamanActions } from './engine/tanks/aquaman.js';
import { NightWingActions } from './engine/tanks/nightwing.js';

export const TANKS = {
  10000044: NarutoActions,
  10000056: QuanVuActions,
  10000019: GundamActions,
  10000001: IronManActions,
  10000003: PandaActions,
  10000043: GiongActions,
  10000048: AssassinActions,
  10000051: SonTinhActions,
  10000063: ThachSanhActions,
  10000100: PantherActions,
  10000045: SpongeActions,
  10000069: ScorpionActions,
  10000089: StarLordActions,
  10000090: NatsuActions,
  10000065: MermaidActions,
  10000103: OxActions,
  10000107: HikariActions,
  10000105: FireGodActions,
  10000112: ChuDuActions,
  10000037: HuluActions,
  10000073: BaymaxActions,
  10000085: AthenaActions,
  10000034: HulkActions,
  10000050: TimeHunterActions,
  10000035: PegasusActions,
  10000059: PhoenixActions,
  10000074: DiaoChanActions,
  10000079: ThuyTinhActions,
  10000049: TransformerActions,
  10000053: SupermanActions,
  10000058: MedusaActions,
  10000071: JokerActions,
  10000086: FoxActions,
  10000104: FalconActions,
  10000036: WukongActions,

  10000062: OptimusActions,
  10000082: NezhaActions,
  10000061: AngelActions,
  10000070: DeadpoolActions,
  10000076: KanekiActions,
  10000092: HadesActions,
  10000093: SasukeActions,
  10000052: PumpkinActions,
  10000095: KurumiActions,
  10000030: DarkKnightActions,
  10000040: WolfActions,
  10000108: ShadowbladeActions,
  10000109: StoneGodActions,
  10000110: AquamanActions,
  10000114: NightWingActions,};

const BASE = new URL('../', import.meta.url);
const TANK_DATA = ['batch-a1-data.json', 'batch-b-data.json', 'batch-c-data.json', 'batch-e-data.json'].map((name) => new URL('./engine/tanks/' + name, import.meta.url));
let cached = null;

async function readParts(parts) {
  const responses = await Promise.all(parts.map((name) => fetch(new URL(name, BASE))));
  for (const response of responses) if (!response.ok) throw new Error(`Catalog ${response.url}: HTTP ${response.status}`);
  return (await Promise.all(responses.map((response) => response.text()))).join('');
}

async function catalogs() {
  if (cached) return cached;
  const [pveText, m6Text, garage, ...fixtures] = await Promise.all([
    readParts(M81314_PARTS),
    readParts(M6_PARTS),
    fetch(new URL('m8_garage_catalog.json', BASE)).then((r) => r.json()),
    ...TANK_DATA.map((url) => fetch(url).then((r) => r.json())),
  ]);
  const pve = JSON.parse(pveText);
  const m6 = JSON.parse(m6Text);
  const index = buildPveIndex(pve);
  const data = createData({ garage, assets: m6, pve });
  for (const fixture of fixtures) for (const [table, key] of [
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
