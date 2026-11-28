/* Tank kit registry: tank id -> ported TankActions subclass (engine/tanks).
 * Generated from the 91 ported *_actions.js modules by their header tank id.
 * New PvP bots use these classes so their casts/share the same kit behaviour as
 * the Python server. Unknown ids fall back to the neutral TankActions base.
 */
import { TankActions } from '../arena.js';
import { IronManActions } from '../tanks/ironman.js';
import { GrootActions } from '../tanks/groot.js';
import { PandaActions } from '../tanks/panda.js';
import { SpiderActions } from '../tanks/spider.js';
import { GundamActions } from '../tanks/gundam.js';
import { ChopperActions } from '../tanks/chopper.js';
import { DarkKnightActions } from '../tanks/darkknight.js';
import { CaptainActions } from '../tanks/captain.js';
import { TeddyActions } from '../tanks/teddy.js';
import { PeaActions } from '../tanks/pea.js';
import { HulkActions } from '../tanks/hulk.js';
import { PegasusActions } from '../tanks/pegasus.js';
import { WukongActions } from '../tanks/wukong.js';
import { HuluActions } from '../tanks/hulu.js';
import { GhostActions } from '../tanks/ghost.js';
import { ThorActions } from '../tanks/thor.js';
import { WolfActions } from '../tanks/wolf.js';
import { LegolasActions } from '../tanks/legolas.js';
import { SongokuActions } from '../tanks/songoku.js';
import { GiongActions } from '../tanks/giong.js';
import { NarutoActions } from '../tanks/naruto.js';
import { SpongeActions } from '../tanks/sponge.js';
import { LuffyActions } from '../tanks/luffy.js';
import { PikachuActions } from '../tanks/pikachu.js';
import { AssassinActions } from '../tanks/assassin.js';
import { TransformerActions } from '../tanks/transformer.js';
import { TimeHunterActions } from '../tanks/timehunter.js';
import { SonTinhActions } from '../tanks/sontinh.js';
import { PumpkinActions } from '../tanks/pumpkin.js';
import { SupermanActions } from '../tanks/superman.js';
import { NoelActions } from '../tanks/noel.js';
import { KakashiActions } from '../tanks/kakashi.js';
import { QuanVuActions } from '../tanks/quanvu.js';
import { DraculaActions } from '../tanks/dracula.js';
import { MedusaActions } from '../tanks/medusa.js';
import { PhoenixActions } from '../tanks/phoenix.js';
import { MinionActions } from '../tanks/minion.js';
import { AngelActions } from '../tanks/angel.js';
import { OptimusActions } from '../tanks/optimus.js';
import { ThachSanhActions } from '../tanks/thachsanh.js';
import { IchigoActions } from '../tanks/ichigo.js';
import { MermaidActions } from '../tanks/mermaid.js';
import { EdwinaActions } from '../tanks/edwina.js';
import { ZhaoYunActions } from '../tanks/zhaoyun.js';
import { ScorpionActions } from '../tanks/scorpion.js';
import { DeadpoolActions } from '../tanks/deadpool.js';
import { JokerActions } from '../tanks/joker.js';
import { ApocalypseActions } from '../tanks/apocalypse.js';
import { BaymaxActions } from '../tanks/baymax.js';
import { DiaoChanActions } from '../tanks/diaochan.js';
import { LuBuActions } from '../tanks/lubu.js';
import { KanekiActions } from '../tanks/kaneki.js';
import { ZoroActions } from '../tanks/zoro.js';
import { MikasaActions } from '../tanks/mikasa.js';
import { ThuyTinhActions } from '../tanks/thuytinh.js';
import { DoraemonActions } from '../tanks/doraemon.js';
import { SwordGodActions } from '../tanks/swordgod.js';
import { NezhaActions } from '../tanks/nezha.js';
import { StrangeActions } from '../tanks/strange.js';
import { ZhugeActions } from '../tanks/zhuge.js';
import { AthenaActions } from '../tanks/athena.js';
import { FoxActions } from '../tanks/fox.js';
import { ErlangActions } from '../tanks/erlang.js';
import { GilgameshActions } from '../tanks/gilgamesh.js';
import { StarLordActions } from '../tanks/starlord.js';
import { NatsuActions } from '../tanks/natsu.js';
import { CaoCaoActions } from '../tanks/caocao.js';
import { HadesActions } from '../tanks/hades.js';
import { SasukeActions } from '../tanks/sasuke.js';
import { LacLongQuanActions } from '../tanks/laclongquan.js';
import { KurumiActions } from '../tanks/kurumi.js';
import { KiritoActions } from '../tanks/kirito.js';
import { MagnetoActions } from '../tanks/magneto.js';
import { SimayiActions } from '../tanks/simayi.js';
import { MulanActions } from '../tanks/mulan.js';
import { PantherActions } from '../tanks/panther.js';
import { SniperActions } from '../tanks/sniper.js';
import { SaitamaActions } from '../tanks/saitama.js';
import { OxActions } from '../tanks/ox.js';
import { FalconActions } from '../tanks/falcon.js';
import { FireGodActions } from '../tanks/firegod.js';
import { ElsaActions } from '../tanks/elsa.js';
import { HikariActions } from '../tanks/hikari.js';
import { ShadowbladeActions } from '../tanks/shadowblade.js';
import { StoneGodActions } from '../tanks/stonegod.js';
import { AquamanActions } from '../tanks/aquaman.js';
import { TsubasaActions } from '../tanks/tsubasa.js';
import { ChuDuActions } from '../tanks/chudu.js';
import { TimeGoddessActions } from '../tanks/timegoddess.js';
import { NightWingActions } from '../tanks/nightwing.js';
import { DaredevilActions } from '../tanks/daredevil.js';

export const TANK_CLASSES = Object.freeze({
  10000001: IronManActions,
  10000002: GrootActions,
  10000003: PandaActions,
  10000008: SpiderActions,
  10000019: GundamActions,
  10000029: ChopperActions,
  10000030: DarkKnightActions,
  10000031: CaptainActions,
  10000032: TeddyActions,
  10000033: PeaActions,
  10000034: HulkActions,
  10000035: PegasusActions,
  10000036: WukongActions,
  10000037: HuluActions,
  10000038: GhostActions,
  10000039: ThorActions,
  10000040: WolfActions,
  10000041: LegolasActions,
  10000042: SongokuActions,
  10000043: GiongActions,
  10000044: NarutoActions,
  10000045: SpongeActions,
  10000046: LuffyActions,
  10000047: PikachuActions,
  10000048: AssassinActions,
  10000049: TransformerActions,
  10000050: TimeHunterActions,
  10000051: SonTinhActions,
  10000052: PumpkinActions,
  10000053: SupermanActions,
  10000054: NoelActions,
  10000055: KakashiActions,
  10000056: QuanVuActions,
  10000057: DraculaActions,
  10000058: MedusaActions,
  10000059: PhoenixActions,
  10000060: MinionActions,
  10000061: AngelActions,
  10000062: OptimusActions,
  10000063: ThachSanhActions,
  10000064: IchigoActions,
  10000065: MermaidActions,
  10000066: EdwinaActions,
  10000067: ZhaoYunActions,
  10000069: ScorpionActions,
  10000070: DeadpoolActions,
  10000071: JokerActions,
  10000072: ApocalypseActions,
  10000073: BaymaxActions,
  10000074: DiaoChanActions,
  10000075: LuBuActions,
  10000076: KanekiActions,
  10000077: ZoroActions,
  10000078: MikasaActions,
  10000079: ThuyTinhActions,
  10000080: DoraemonActions,
  10000081: SwordGodActions,
  10000082: NezhaActions,
  10000083: StrangeActions,
  10000084: ZhugeActions,
  10000085: AthenaActions,
  10000086: FoxActions,
  10000087: ErlangActions,
  10000088: GilgameshActions,
  10000089: StarLordActions,
  10000090: NatsuActions,
  10000091: CaoCaoActions,
  10000092: HadesActions,
  10000093: SasukeActions,
  10000094: LacLongQuanActions,
  10000095: KurumiActions,
  10000096: KiritoActions,
  10000097: MagnetoActions,
  10000098: SimayiActions,
  10000099: MulanActions,
  10000100: PantherActions,
  10000101: SniperActions,
  10000102: SaitamaActions,
  10000103: OxActions,
  10000104: FalconActions,
  10000105: FireGodActions,
  10000106: ElsaActions,
  10000107: HikariActions,
  10000108: ShadowbladeActions,
  10000109: StoneGodActions,
  10000110: AquamanActions,
  10000111: TsubasaActions,
  10000112: ChuDuActions,
  10000113: TimeGoddessActions,
  10000114: NightWingActions,
  10000115: DaredevilActions,
});

export const AI_TANKS = Object.freeze([10000001, 10000002, 10000003, 10000008, 10000019, 10000029, 10000030, 10000031, 10000032, 10000033, 10000034, 10000035, 10000036, 10000037, 10000038, 10000039, 10000040, 10000041, 10000042, 10000043, 10000044, 10000045, 10000046, 10000047, 10000048, 10000049, 10000050, 10000051, 10000052, 10000053, 10000054, 10000055, 10000056, 10000057, 10000058, 10000059, 10000060, 10000061, 10000062, 10000063, 10000064, 10000065, 10000066, 10000067, 10000069, 10000070, 10000071, 10000072, 10000073, 10000074, 10000075, 10000076, 10000077, 10000078, 10000079, 10000080, 10000081, 10000082, 10000083, 10000084, 10000085, 10000086, 10000087, 10000088, 10000089, 10000090, 10000091, 10000092, 10000093, 10000094, 10000095, 10000096, 10000097, 10000098, 10000099, 10000100, 10000101, 10000102, 10000103, 10000104, 10000105, 10000106, 10000107, 10000108, 10000109, 10000110, 10000111, 10000112, 10000113, 10000114, 10000115]);

export function tankClass(tankId) {
  return TANK_CLASSES[Number(tankId)] || TankActions;
}

export default TANK_CLASSES;
