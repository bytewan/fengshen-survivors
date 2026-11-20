// 无界面的数值模拟：机器人打完整的一局（每章 6 波、3 章，含商店与升级），统计通关率、打到第几波，
// 以及逐波的掉血、最低气血、阵亡、击杀、波末剩怪、捡到的战场掉落 —— 看普通波是不是「既不轻松割草、也不必死」。
// 用法：node tools/balance.ts [局数] [--skip-boss] [--only-new] [--elements] [--old-enemies] [--no-dodge] [--hero yangjian]
//   --set '表.路径=值'：临时改数值表再跑（可以给好几个；见 tools/tune.ts），比如 --set 'WAVE_CURVE.hpBase=2.6' --set 'ENEMIES.*.speed=*1.1'。
//   默认同一批种子跑两遍对比：「新法宝之后」= 和游戏里一样，公共法宝（现在 26 件，件数从 catalog 里数）加这个角色的专属法宝都在商店里
//   （另外打开 catalog.WIP.shop：以后再有标 wip 的新法宝也一起刷）；「新法宝之前」= 对照，临时把后加的公共法宝都标成 wip，
//   商店只刷最早的 7 件公共法宝（加专属 = 原来的 8 件）。逐波明细按「之后」那一遍打；另报各法宝被机器人选到时的表现、首领战打了多久。
//   --only-new：只跑「之后」那一遍（和游戏里一样的那一遍）。
//   --skip-boss：首领波一开打就把首领判死（只量普通波）。
//   --elements：五行三件档 —— 开局就给乾坤圈 + 同一行的三件公共法宝（都是凡品，之后机器人只能买同名件升阶），
//     五行各跑一组，比通关率、打到第几波、首领战用时（看哪一行的三件档明显过强 / 过弱）。
//   --old-enemies：只刷原来的三种敌人（回响兵、鬼火术士、精英），和加了新敌人的对照。
//   --no-dodge：机器人不躲新敌人的招（对照用）。--no-pet：宠物不出手（对照用）。
//   --jie N：按劫 N 打（1..5，默认劫一；词缀见 src/sim/jie.ts）。--jie all：劫一到劫五各跑一组，每劫一行小结（通关率、打到第几波、三个首领）。
//   --xw half / all：带着修为打（src/sim/xiuwei.ts）：half = 由内而外点到总花费的一半（xiuweiPreset，设计文档「难度按修为点了一半来调」），all = 点满（二选一取先写的一边）。
//   --from N：从第 N 波前的商店开始（和网址 ?wave=N 一样：带 999 灵石、按波次给几级升级），比如 --from 7 只打第二章起；
//   --to N：打完第 N 波就停（--from 7 --to 12 = 只打第二章）。第二章、第三章的通过率、掉血来源各单独报一行（--from 13 --to 18 = 只打第三章）。
//   --boss 写法：首领池（src/sim/bosspool.ts：每章的首领不固定，开局抽一个当首领、另一个来第 4 波的遭遇战）。不给 = 和游戏里一样每局按种子抽，
//     末尾多报一段「按首领分」；--boss legacy = 加首领池之前的排法（魔化哪吒 / 姚天君 + 回响赵公明 / 诛仙剑灵 + 回响云霄，不用随机数，
//     输出的格式和内容都和加首领池之前逐字相同，前后对比用它）；--boss aobing 或 --boss nezha,zhao,yunxiao = 指定这几位当他们那一章的首领
//     （池里另一位来遭遇战；没提到的章照抽）；名字后面加 .solo（nezha.solo）= 这一章只有他、没有遭遇战。
//   --hero 角色：用哪个角色打（nezha / yangjian / zhao / yunxiao / leizhenzi，回响化身 mozha / huizhao / huiyun，隐藏角色 wukong，默认哪吒）。法宝表的第一行换成这个角色的专属法宝。
// 机器人捡掉落（botLootPull）、躲新敌人的招（botEnemyDodge）都已经在 botInput 里了，这里直接用 botInput。
// Node 25.9 的 JIT 有缺陷（maglev 编出来的 OSR 代码在长循环里偶尔算错，同样的种子跑一次变一次）：每帧的循环体挪进了单独的函数，
// 循环本身只剩一行调用；要更保险就 node --no-osr-from-maglev tools/balance.ts 20。
import { createWorld, step, type SimEvent, type World } from '../src/sim/world.ts';
import { makeLevelOffers, restock } from '../src/sim/shop.ts';
import { offerTechnique } from '../src/sim/techniques.ts';
import { botInput, botShop } from '../src/sim/bot.ts';
import { BOT_DODGE } from '../src/sim/bot-dodge.ts';
import { clampJie, jieTier } from '../src/sim/jie.ts';
import { spentOn, xiuweiPreset, type XiuweiId } from '../src/sim/xiuwei.ts';
import { COMMON_WEAPONS, ELEMENT_BONUS, HEROES, TIER_NAME, WEAPONS, WIP, isBossWave, WAVES_PER_CHAPTER } from '../src/sim/catalog.ts';
import { DT, FOES } from '../src/sim/config.ts';
import { heldList } from '../src/sim/heroes/index.ts';
import { ELEMENTS, ELEMENT_NAME, type Element, type EnemyKindName, type HeroId, type HitBy, type OwnedWeapon, type WeaponKind } from '../src/sim/types.ts';
import { ARTI2_BY } from '../src/sim/arti2.ts';
import { POOL, bossName, parseCast, type BossId, type Casting } from '../src/sim/bosspool.ts';
import { applySets } from './tune.ts';

applySets(); // --set '表.路径=值'：临时改数值表（tools/tune.ts）

const runs = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 20);
const skipBoss = process.argv.includes('--skip-boss');
const onlyNew = process.argv.includes('--only-new');
const elemMode = process.argv.includes('--elements');
const dodge = !process.argv.includes('--no-dodge');
const noPet = process.argv.includes('--no-pet'); // 对照：宠物不出手（看宠物的减益对通过率、几下打死有多大影响）
BOT_DODGE.enabled = dodge;
const oldEnemies = process.argv.includes('--old-enemies');
if (oldEnemies) FOES.mix = {};
const argNum = (k: string, d: number) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? Number(process.argv[i + 1]) : d;
};
const jieArg = process.argv.includes('--jie') ? process.argv[process.argv.indexOf('--jie') + 1] : '1';
const jieAll = jieArg === 'all';
let jieN = jieAll ? 1 : clampJie(Number(jieArg));
const xwArg = process.argv.includes('--xw') ? process.argv[process.argv.indexOf('--xw') + 1] : '';
const xwNodes: XiuweiId[] = xiuweiPreset(xwArg);
const fromWave = argNum('--from', 1);
const toWave = argNum('--to', Infinity);
const bossAt = process.argv.indexOf('--boss');
const bossArg = bossAt >= 0 ? process.argv[bossAt + 1] : 'draw';
const castSetup = parseCast(bossArg); // undefined = legacy（加首领池之前的排法）
const legacyCast = castSetup === undefined;
const heroAt = process.argv.indexOf('--hero');
const hero = (heroAt >= 0 ? process.argv[heroAt + 1] : 'nezha') as HeroId;
if (!HEROES[hero]) throw new Error(`没有这个角色：${hero}（有 ${Object.keys(HEROES).join(' / ')}）`);
const tag = `${hero !== 'nezha' ? `（角色：${HEROES[hero].name}）` : ''}${skipBoss ? '（跳过首领）' : ''}${oldEnemies ? '（只有原来的三种敌人）' : ''}${dodge ? '' : '（不躲新敌人的招）'}${fromWave > 1 ? `（从第 ${fromWave} 波前的商店开始，带 999 灵石）` : ''}${toWave < Infinity ? `（打到第 ${toWave} 波）` : ''}${legacyCast ? '' : bossArg === 'draw' ? '（首领池：每局抽）' : `（首领池：${bossArg}）`}`;

interface WaveRow {
  wave: number;
  hp0: number;
  lost: number;
  minHp: number;
  died: boolean;
  kills: number;
  left: number;
  loot: number;
  secs: number; // 这一波打了多久（首领波 = 打首领用的时间）
  big: number; // 这一波挨的最重的一下（按最大气血的比例）
  bigBy: string; // 最重的那一下是什么打的
  elites: number[]; // 这一波的精英：从现身到被打死多久（秒）；没打死的记 -1
  lv0: number; // 开波时的等级
  tiers0: number; // 开波时法宝品阶的和（四件神品 = 16）
  g0: number; // 开波时的灵石
  gold: number; // 这一波（含波末收灵）进账的灵石
  build: string;
}
interface RunRow {
  wave: number;
  win: boolean;
  level: number;
  kills: number;
  minutes: number;
  build: string;
  final: OwnedWeapon[];
  ever: Set<WeaponKind>; // 这一局里拿到过的法宝（中途卖掉的也算）
  direct: Partial<Record<WeaponKind, number>>; // 直接命中的伤害（按 hit 事件的来源归到法宝，持续伤害不算）
  total: number; // 全部伤害（含持续伤害）
  hurtBy: Record<string, number>; // 第一章前 5 波：各种来源造成的掉血（按最大气血的百分比累加）
  hurtBy2: Record<string, number>; // 第二章（第 7–12 波）：同上，含红水（drain）
  ch2: 'none' | 'reached' | 'cleared'; // 第二章：没打到 / 打到了第 7 波 / 打赢了姚天君
  hurtBy3: Record<string, number>; // 第三章（第 13–18 波）：各种来源造成的掉血，含剑阵外的掉血（zxDrain）
  ch3: 'none' | 'reached' | 'cleared'; // 第三章：没打到 / 打到了第 13 波 / 打赢了诛仙剑灵（通关）
  loots: Record<string, number>;
  waves: WaveRow[];
  deaths: KillRow[]; // 普通敌人每一只的下场（「几下打死」的统计）
  dmgBy: Record<string, number>; // 打在普通敌人身上的伤害，按来源（HitBy）
  tierHp: number[][]; // 下标 = 品阶：这一品阶的法宝直接打中的普通敌人，气血 ÷ 人物这一行的伤害倍率
  echo: EchoRow[]; // 回响化身遭遇战（第 10、16 波）：遇到了没有、打倒了没有、用了多久、退走时还剩多少气血
  cast: Casting[]; // 首领池抽到的（按章）
}
interface EchoRow {
  wave: number;
  kind: BossId;
  name: string;
  killed: boolean;
  secs: number; // 从现身到打倒（没打倒：到退走）
  left: number; // 退走时还剩的气血（比例；打倒了是 0）
}

/**
 * 「几下打死」（M4 数值平衡，用户 2026-11-11：一般情况下不秒杀，成型之后才可以秒）：每一只被打死的普通敌人
 * （不含精英、首领、首领召出来的幡 / 草人；分魂鬼分出来的小鬼单列）挨了几下、最后那一下是什么、从刷出来到死多久。
 * 「一下」= 一次直接命中；灼烧、流血、地面区域每一跳不算一下（DOT_BY），只算进 events。
 */
interface KillRow {
  wave: number;
  kind: EnemyKindName;
  hits: number; // 直接命中几下（持续伤害的每一跳不算）
  events: number; // 一共挨了几次伤害（含持续伤害的每一跳）：1 = 第一次挨打就死了（一下打死）
  cause: KillCause; // 最后那一下是什么
  life: number; // 从刷出来到死（秒）
  ttk: number; // 从挨第一下到死（秒）
  first: number; // 第一次直接命中打掉最大气血的多少（没挨过直接命中 = NaN）
  killer: HitBy; // 最后那一下的来源
}
/** 最后那一下：暴击、相生（含相生追加的伤害）、神通、持续伤害、斩杀（金行三件 / 封神）、地形（第三章剑气）、别的（平常的一下）。 */
type KillCause = 'crit' | 'react' | 'skill' | 'dot' | 'execute' | 'terrain' | 'plain';
/** 持续伤害：每一跳不算「一下」。 */
const DOT_BY: ReadonlySet<HitBy> = new Set<HitBy>(['burn', 'bleed', 'zone']);
/** 不算普通敌人的：精英、首领、首领召出来的不会动的幡 / 草人。 */
const NOT_NORMAL: ReadonlySet<EnemyKindName> = new Set<EnemyKindName>(['elite', 'boss', 'soulflag', 'strawman']);
interface Track {
  kind: EnemyKindName;
  wave: number;
  t0: number;
  maxHp: number;
  hits: number;
  events: number;
  tHit: number;
  first: number;
  lastBy: HitBy | null;
  lastCrit: boolean;
  lastTick: number;
}

/**
 * hit 事件的来源 → 法宝。灼烧、流血、区域、相生、爆炸、神通算不清是哪件的，不归。
 * chain：雷公鞭，没有雷公鞭就是定风珠「风雷」；aura：九龙神火罩，没有火罩就是乾坤圈「赤焰轮」。
 */
function sourceOf(by: HitBy, owned: Set<WeaponKind>): WeaponKind | null {
  switch (by) {
    case 'ring':
      return 'qiankun';
    case 'thrust':
      return 'huojian';
    case 'aura':
      return owned.has('jiulong') ? 'jiulong' : 'qiankun';
    case 'chain':
    case 'thunder':
      return owned.has('leigong') ? 'leigong' : 'dingfeng';
    case 'slam':
      return 'fantian';
    case 'knife':
      return 'zhanxian';
    case 'spike':
      return 'hanbing';
    case 'shield':
      return 'xinghuang';
    case 'lash':
      return 'dashen';
    case 'slash':
      return 'huaxue';
    case 'cleave':
    case 'stab':
    case 'chop':
      return 'sanjian';
    case 'bead':
      return 'dinghai';
    case 'dou':
      return 'jindou';
    case 'cudgel':
      return 'huangjin';
    case 'wheel':
      return 'heiyan';
    case 'loong':
      return 'youlong';
    case 'lasso':
      return 'fulong';
    case 'scroll':
      return 'qiankuntu';
    case 'staff':
    case 'rock':
      return 'jingu';
    case 'gust':
      return 'dingfeng';
    case 'beam':
      return 'yinyang';
    case 'tide':
      return 'xuanyuan';
    case 'wave':
    case 'bird':
      return 'wuhuo';
    case 'rope':
      return 'kunxian';
    default:
      return ARTI2_BY[by] ?? null; // 再加的 11 件（sim/arti2.ts）
  }
}

const weaponLabel = (x: OwnedWeapon) => `${WEAPONS[x.kind].name}${TIER_NAME[x.tier]}${x.spirit ? '·' + WEAPONS[x.kind].spirits.find((s) => s.id === x.spirit)?.name : ''}`;

/** 跑一局。start：开局的法宝（五行三件档用）。 */
function play(seed: number, start?: OwnedWeapon[]): RunRow {
  // 角色（--hero）、劫数（--jie，sim/jie.ts）、修为（--xw，sim/xiuwei.ts）都是开局的设定
  const w: World = createWorld(seed, 1, { heroes: [hero], jie: jieN, xiuwei: [xwNodes], cast: castSetup });
  const p = w.players[0];
  if (start) p.weapons = start.map((x) => ({ ...x }));
  if (fromWave > 1) {
    // 和网址 ?wave=N 一样（game/feel.ts 的 reset）：第 N 波前的商店，带一大笔灵石和几次升级
    w.wave = fromWave - 1;
    w.phase = 'shop';
    w.enemies = [];
    p.lingshi = 999;
    p.level = 1 + Math.round(fromWave * 1.6);
    p.pendingLevels = Math.round(fromWave * 1.6);
    p.levelOffers = makeLevelOffers(w, p);
    offerTechnique(w, p);
    restock(w, p);
  }
  const hurtBy2: Record<string, number> = {};
  let ch2: RunRow['ch2'] = 'none';
  const hurtBy3: Record<string, number> = {};
  let ch3: RunRow['ch3'] = 'none';
  const waves: WaveRow[] = [];
  let cur: WaveRow | null = null;
  const loots: Record<string, number> = {};
  const echo: EchoRow[] = [];
  let echoT0 = 0;
  const ever = new Set<WeaponKind>(p.weapons.map((x) => x.kind));
  const direct: Partial<Record<WeaponKind, number>> = {};
  const hurtBy: Record<string, number> = {};
  let total = 0;
  let waveT0 = 0;
  const deaths: KillRow[] = [];
  const tierHp: number[][] = [[], [], [], [], []];
  const eliteT0 = new Map<number, number>(); // 这一波现身的精英：现身的时间
  const dmgBy: Record<string, number> = {};
  const track = new Map<number, Track>();
  /** 一只敌人的记录（刷出来时建；没赶上 spawn 事件的在第一次挨打时补建）。 */
  const rec = (id: number, kind: EnemyKindName): Track => {
    let r = track.get(id);
    if (!r) {
      const e = w.enemies.find((x) => x.id === id) ?? heldList(w).find((x) => x.id === id);
      r = { kind, wave: w.wave, t0: w.time, maxHp: e ? e.maxHp : NaN, hits: 0, events: 0, tHit: -1, first: NaN, lastBy: null, lastCrit: false, lastTick: -1 };
      track.set(id, r);
    }
    return r;
  };
  /** 这一帧的事件里普通敌人挨的打、死的（「几下打死」）。 */
  const tally = (ev: SimEvent[]) => {
    let reacted: Set<number> | null = null;
    for (const e of ev) if (e.t === 'react') (reacted ??= new Set()).add(e.id);
    for (const e of ev) {
      if (e.t === 'spawn') {
        if (!NOT_NORMAL.has(e.kind)) rec(e.id, e.kind);
      } else if (e.t === 'hit') {
        if (NOT_NORMAL.has(e.kind)) continue;
        const r = rec(e.id, e.kind);
        dmgBy[e.by] = (dmgBy[e.by] ?? 0) + e.dmg;
        if (r.events === 0) r.tHit = w.time;
        r.events++;
        if (!DOT_BY.has(e.by)) {
          if (r.hits === 0) r.first = e.dmg / r.maxHp;
          r.hits++;
          // 这一下是哪件法宝打的、那件是几品：记下敌人的气血 ÷ 人物这一行的伤害倍率（weapon-dps.ts 的群伤场景按它定兵的血量）
          const k = sourceOf(e.by, new Set(p.weapons.map((x) => x.kind)));
          const wpn = k ? p.weapons.find((x) => x.kind === k) : undefined;
          if (wpn && !Number.isNaN(r.maxHp)) tierHp[wpn.tier].push(r.maxHp / (1 + p.stats.damage + p.stats.aff[WEAPONS[wpn.kind].el]));
        }
        r.lastBy = e.by;
        r.lastCrit = e.crit;
        r.lastTick = ticks;
      } else if (e.t === 'kill') {
        const r = track.get(e.id);
        if (!r || NOT_NORMAL.has(e.kind)) continue;
        track.delete(e.id);
        const by = r.lastBy ?? 'zone';
        const cause: KillCause = e.execute
          ? 'execute'
          : DOT_BY.has(by)
            ? 'dot'
            : by === 'react' || (r.lastTick === ticks && reacted?.has(e.id))
              ? 'react'
              : by === 'skill'
                ? 'skill'
                : by === 'sword'
                  ? 'terrain'
                  : r.lastCrit
                    ? 'crit'
                    : 'plain';
        deaths.push({ wave: r.wave, kind: r.kind, hits: r.hits, events: r.events, cause, life: w.time - r.t0, ttk: r.tHit >= 0 ? w.time - r.tHit : 0, first: r.first, killer: by });
      } else if (e.t === 'waveStart') track.clear(); // 上一波没打死的（波末清场）不带过来
    }
  };
  const open = () => {
    const h0 = Math.max(0, p.hp) / p.stats.maxHp;
    cur = { wave: w.wave, hp0: h0, lost: 0, minHp: h0, died: false, kills: 0, left: 0, loot: 0, secs: 0, big: 0, bigBy: '', elites: [], lv0: p.level, tiers0: p.weapons.reduce((a, x) => a + x.tier, 0), g0: p.lingshi, gold: 0, build: p.weapons.map((x) => `${WEAPONS[x.kind].name}${TIER_NAME[x.tier]}`).join('/') };
    eliteT0.clear();
    waves.push(cur);
    waveT0 = w.time;
  };
  if (fromWave <= 1) open(); // 从中间某一波开始的：出了商店才开第一行
  let ticks = 0;
  // 每一帧（单独一个函数：躲开 Node 25.9 在长循环里 OSR 的 JIT 缺陷，见文件头）
  const frame = () => {
    const cmds = w.phase === 'shop' ? botShop(w, 0) : [];
    const before = w.phase;
    if (noPet) p.pet.cd = 1e12;
    if (skipBoss && w.phase === 'wave' && isBossWave(w.wave)) for (const e of w.enemies) if (e.kind === 'boss') e.hp = 0;
    const leftNow = w.enemies.length;
    const ev: SimEvent[] = step(w, [botInput(w, 0)], cmds);
    ticks++;
    tally(ev);
    for (const x of p.weapons) ever.add(x.kind);
    const c = cur as WaveRow | null;
    if (c && (before === 'wave' || before === 'collect')) {
      for (const e of ev) {
        if (e.t === 'loot' && e.owner === 0) {
          c.loot++;
          const key = e.kind === 'chest' ? `宝匣：${e.reward.replace(/[+\d（）/ ·]+.*$/, '').replace(/碎片.*/, '碎片')}` : e.kind === 'peach' ? '蟠桃' : '聚灵符';
          loots[key] = (loots[key] ?? 0) + 1;
        }
      }
    }
    if (before === 'wave' && c) {
      const owned = new Set(p.weapons.map((x) => x.kind));
      for (const e of ev) {
        if (e.t === 'hurt' && e.owner === 0) c.lost += e.dmg / p.stats.maxHp;
        if (e.t === 'hurt' && e.owner === 0 && e.dmg / p.stats.maxHp > c.big) {
          c.big = e.dmg / p.stats.maxHp;
          c.bigBy = e.by;
        }
        if (e.t === 'spawn' && e.kind === 'elite') eliteT0.set(e.id, w.time);
        if (e.t === 'kill' && e.kind === 'elite' && eliteT0.has(e.id)) {
          c.elites.push(w.time - eliteT0.get(e.id)!);
          eliteT0.delete(e.id);
        }
        if ((e.t === 'waveEnd' || e.t === 'chapterClear' || e.t === 'win') && eliteT0.size) {
          for (let i = 0; i < eliteT0.size; i++) c.elites.push(-1);
          eliteT0.clear();
        }
        if (e.t === 'hurt' && e.owner === 0 && c.wave <= 5) hurtBy[e.by] = (hurtBy[e.by] ?? 0) + e.dmg / p.stats.maxHp;
        if (e.t === 'corrode' && e.owner === 0 && c.wave <= 5) hurtBy.miasma = (hurtBy.miasma ?? 0) + e.dmg / p.stats.maxHp;
        if (e.t === 'corrode' && e.owner === 0) c.lost += e.dmg / p.stats.maxHp;
        if (e.t === 'drain' && e.owner === 0) c.lost += e.dmg / p.stats.maxHp; // 第二章：红水里持续掉的血
        if (e.t === 'zxDrain' && e.owner === 0) c.lost += e.dmg / p.stats.maxHp; // 第三章：诛仙剑阵外持续掉的血
        if ((e.t === 'hurt' || e.t === 'corrode' || e.t === 'zxDrain') && e.owner === 0 && c.wave >= 13 && c.wave <= 18) {
          const k = e.t === 'hurt' ? e.by : e.t === 'corrode' ? 'miasma' : 'ring';
          hurtBy3[k] = (hurtBy3[k] ?? 0) + e.dmg / p.stats.maxHp;
        }
        if (e.t === 'waveStart' && e.wave === 13) ch3 = 'reached';
        if (e.t === 'win') ch3 = 'cleared';
        if ((e.t === 'hurt' || e.t === 'corrode' || e.t === 'drain') && e.owner === 0 && c.wave >= 7 && c.wave <= 12) {
          const k = e.t === 'hurt' ? e.by : e.t === 'corrode' ? 'miasma' : e.kind === 'blood' ? 'blood' : 'water';
          hurtBy2[k] = (hurtBy2[k] ?? 0) + e.dmg / p.stats.maxHp;
        }
        if (e.t === 'waveStart' && e.wave === 7) ch2 = 'reached';
        if (e.t === 'chapterClear' && e.chapter === 2) ch2 = 'cleared';
        if (e.t === 'kill' && e.owner === 0) c.kills++;
        if (e.t === 'down') c.died = true;
        // 回响化身遭遇战（sim/echo/）
        if (e.t === 'echoIntro') {
          echo.push({ wave: w.wave, kind: e.kind, name: bossName(e.kind), killed: false, secs: 0, left: 1 });
          echoT0 = w.time;
        }
        if ((e.t === 'echoDefeat' || e.t === 'echoLeave') && echo.length) {
          const r = echo[echo.length - 1];
          r.secs = w.time - echoT0;
          r.killed = e.t === 'echoDefeat';
          r.left = e.t === 'echoLeave' ? e.hp : 0;
        }
        if (e.t === 'waveEnd' || e.t === 'chapterClear' || e.t === 'win') {
          c.left = leftNow;
          c.secs = w.time - waveT0;
        }
        if (e.t === 'hit') {
          total += e.dmg;
          const k = sourceOf(e.by, owned);
          if (k) direct[k] = (direct[k] ?? 0) + e.dmg;
        }
      }
      c.minHp = Math.min(c.minHp, Math.max(0, p.hp) / p.stats.maxHp);
      if ((w.phase as string) === 'over' && !c.secs) c.secs = w.time - waveT0;
    }
    if (c && before !== 'shop' && w.phase === 'shop') c.gold = p.lingshi - c.g0;
    if (before === 'shop' && w.phase === 'wave') {
      if (w.wave === 7) ch2 = 'reached';
      if (w.wave === 13) ch3 = 'reached';
      open();
    }
  };
  // --to N：打完第 N 波、进了它后面的商店就停（商店里 w.wave 还是刚打完的那一波），算「打到了」（不算通关）
  const done = () => w.phase === 'shop' && w.wave >= toWave;
  while (w.phase !== 'over' && w.phase !== 'win' && ticks < 60 * 60 * 40 && !done()) frame();
  const stopped = done();
  return { wave: stopped ? toWave : w.wave, win: w.phase === 'win', level: p.level, kills: p.kills, minutes: w.time / 60, build: p.weapons.map(weaponLabel).join(' / '), final: p.weapons.map((x) => ({ ...x })), ever, direct, total, hurtBy, hurtBy2, ch2, hurtBy3, ch3, loots, waves, deaths, dmgBy, tierHp, echo, cast: w.cast.map((c) => ({ ...c })) };
}

/**
 * 首领池（src/sim/bosspool.ts）：按首领分开报——每一位当首领的那几局（打到、打赢、阵亡、用时）、来遭遇战的那几局（遇到、打倒、用时、退走时还剩多少）。
 * 以后往池里加人，这里自动多一行。
 */
function bossTable(rs: RunRow[]) {
  console.log('\n首领池（每章的首领不固定；按首领分）：');
  for (const [chs, ids] of Object.entries(POOL.chapters)) {
    const ch = Number(chs);
    for (const id of ids) {
      const drawn = rs.filter((r) => r.cast[ch - 1]?.chief === id);
      const fights = drawn.map((r) => r.waves.find((x) => x.wave === ch * WAVES_PER_CHAPTER)).filter((x): x is WaveRow => !!x);
      const won = fights.filter((x) => !x.died && x.secs > 0);
      const met = rs.flatMap((r) => r.echo.filter((x) => x.kind === id));
      const killed = met.filter((x) => x.killed);
      const fled = met.filter((x) => !x.killed);
      if (!drawn.length && !met.length) continue;
      const row = rs.filter((r) => r.cast[ch - 1]?.guest === id).map((r) => r.waves.find((x) => x.wave === (ch - 1) * WAVES_PER_CHAPTER + POOL.guestWave)).filter((x): x is WaveRow => !!x);
      console.log(
        `  第${'一二三'[ch - 1]}章 ${pad(bossName(id), 16)}当首领：抽到 ${String(drawn.length).padStart(2)} 局、打到 ${String(fights.length).padStart(2)}、打赢 ${String(won.length).padStart(2)}（${fights.length ? pct(won.length / fights.length) : '—'}）、阵亡 ${fights.filter((x) => x.died).length}、` +
          `打赢用时中位 ${won.length ? med(won.map((x) => x.secs)).toFixed(0) + ' 秒' : '—'}、掉血中位 ${fights.length ? pct(med(fights.map((x) => x.lost))) : '—'}；` +
          `来遭遇战：遇到 ${String(met.length).padStart(2)} 局、打倒 ${String(killed.length).padStart(2)}（${met.length ? pct(killed.length / met.length) : '—'}）、打倒用时中位 ${killed.length ? med(killed.map((x) => x.secs)).toFixed(0) + ' 秒' : '—'}、` +
          `退走时还剩气血中位 ${fled.length ? pct(med(fled.map((x) => x.left))) : '—'}、这一波阵亡 ${row.filter((x) => x.died).length}、掉血中位 ${row.length ? pct(med(row.map((x) => x.lost))) : '—'}`,
      );
    }
  }
}

/** 最早的 7 件公共法宝（加专属乾坤圈 = 原来的 8 件）。 */
const FIRST_WEAPONS: WeaponKind[] = ['huojian', 'jiulong', 'leigong', 'fantian', 'xinghuang', 'zhanxian', 'hanbing'];
/** 后加的公共法宝（第二批 8 件、第三批 11 件……从 catalog 里数）：「新法宝之前」那一遍临时把它们标成 wip，商店就只刷最早的那 7 件。 */
const NEW_WEAPONS: WeaponKind[] = COMMON_WEAPONS.filter((k) => !FIRST_WEAPONS.includes(k));
/** 标签里的件数：公共法宝几件、连专属一共几件。 */
const SHOP_POOL = `${COMMON_WEAPONS.length} 件公共法宝 + 专属，共 ${COMMON_WEAPONS.length + 1} 件`;

/** withNew：公共法宝都刷（和游戏里一样，另外绕过 wip）；false：对照，只刷最早的 7 件。 */
function simulate(withNew: boolean, start?: (seed: number) => OwnedWeapon[]): RunRow[] {
  const save = WIP.shop;
  WIP.shop = withNew;
  const marked = withNew ? [] : NEW_WEAPONS.filter((k) => !WEAPONS[k].wip);
  for (const k of marked) WEAPONS[k].wip = true;
  try {
    return Array.from({ length: runs }, (_, r) => play(2000 + r, start?.(2000 + r)));
  } finally {
    WIP.shop = save;
    for (const k of marked) delete WEAPONS[k].wip;
  }
}

const med = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : NaN);
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const pct = (v: number) => `${Math.round(v * 100)}%`;
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 2 : 1), 0)));

/** 一组对局的一行小结：通关、打到第几波、等级、局长、三个首领各用了多久、首领战阵亡几次。 */
function summary(rs: RunRow[]) {
  const wins = rs.filter((x) => x.win).length;
  const boss = [1, 2, 3].map((ch) => {
    const xs = rs.map((r) => r.waves.find((x) => x.wave === ch * WAVES_PER_CHAPTER)).filter((x): x is WaveRow => !!x);
    return { n: xs.length, died: xs.filter((x) => x.died).length, secs: med(xs.filter((x) => !x.died).map((x) => x.secs)) };
  });
  return {
    text: `通关 ${wins}/${rs.length}  打到第几波（中位数）${med(rs.map((x) => x.wave))}  等级中位数 ${med(rs.map((x) => x.level))}  局长中位数 ${med(rs.map((x) => x.minutes)).toFixed(1)} 分钟`,
    boss: boss.map((b, i) => `第${i + 1}章首领：打到 ${b.n} 局、阵亡 ${b.died}、打赢用时中位 ${Number.isNaN(b.secs) ? '—' : b.secs.toFixed(0) + ' 秒'}`).join('；'),
    spread: rs.map((x) => (x.win ? '胜' : x.wave)).join(' '),
  };
}

function waveTable(rs: RunRow[]) {
  const all = rs.map((r) => r.waves);
  console.log('\n逐波（每章前 5 波是普通波，第 4 波有精英；掉血按最大气血的百分比，含魔气侵蚀；首领波的「用时」是打首领用了多久）：');
  console.log('波次     到达 阵亡   掉血 中位/最多   最低气血 中位/最低   开波气血  击杀  波末剩怪  捡到掉落  用时   开波等级 / 品阶和  进账灵石');
  const maxWave = Math.max(...all.map((ws) => (ws.length ? ws[ws.length - 1].wave : 0)));
  for (let n = 1; n <= maxWave; n++) {
    const xs = all.map((ws) => ws.find((x) => x.wave === n)).filter((x): x is WaveRow => !!x);
    if (!xs.length) continue;
    const tag = isBossWave(n) ? '首领' : `${Math.ceil(n / WAVES_PER_CHAPTER)}-${((n - 1) % WAVES_PER_CHAPTER) + 1}`;
    console.log(
      `${String(n).padStart(2)} ${tag.padEnd(4)}  ${String(xs.length).padStart(3)}  ${String(xs.filter((x) => x.died).length).padStart(3)}    ${pct(med(xs.map((x) => x.lost))).padStart(4)} / ${pct(Math.max(...xs.map((x) => x.lost))).padEnd(5)}      ${pct(med(xs.map((x) => x.minHp))).padStart(4)} / ${pct(Math.min(...xs.map((x) => x.minHp))).padEnd(5)}     ${pct(med(xs.map((x) => x.hp0))).padStart(5)}  ${String(med(xs.map((x) => x.kills))).padStart(4)}  ${String(med(xs.map((x) => x.left))).padStart(6)}    ${(xs.reduce((a, x) => a + x.loot, 0) / xs.length).toFixed(1).padStart(4)}  ${med(xs.map((x) => x.secs)).toFixed(0).padStart(4)}   ${String(med(xs.map((x) => x.lv0))).padStart(6)} / ${String(med(xs.map((x) => x.tiers0))).padStart(2)}   ${String(med(xs.map((x) => x.gold))).padStart(6)}`,
    );
  }
  const BIG_NAME: Record<string, string> = { contact: '贴身', orb: '鬼火', spear: '长矛', charge: '冲锋', blast: '自爆', boss: '首领', thunder: '天雷', ten: '十阵', wind: '风吼', sword: '轮斩剑气', flysword: '飞剑灵', qi: '门徒剑气', tether: '傀儡剑气线', tide: '夜叉的浪', blade: '剑侍的剑', recoil: '精英反震' };
  console.log('\n挨的最重的一下（按最大气血；每局这一波最重的那一下，中位 / 九成 / 最重，最重的是什么打的）与精英（现身到被打死多久，中位；被打死几只 / 来了几只）：');
  for (let n = 1; n <= maxWave; n++) {
    const xs = all.map((ws) => ws.find((x) => x.wave === n)).filter((x): x is WaveRow => !!x);
    if (!xs.length) continue;
    const tag = isBossWave(n) ? '首领' : `${Math.ceil(n / WAVES_PER_CHAPTER)}-${((n - 1) % WAVES_PER_CHAPTER) + 1}`;
    const bigs = xs.map((x) => x.big).sort((a, b) => a - b);
    const top = xs.reduce((a, x) => (x.big > a.big ? x : a), xs[0]);
    const el = xs.flatMap((x) => x.elites);
    const dead = el.filter((t) => t >= 0);
    console.log(
      `${String(n).padStart(2)} ${tag.padEnd(4)}  ${pct(bigs[Math.floor(bigs.length / 2)]).padStart(4)} / ${pct(bigs[Math.min(bigs.length - 1, Math.floor(bigs.length * 0.9))]).padStart(4)} / ${pct(top.big).padStart(4)}（${BIG_NAME[top.bigBy] ?? (top.bigBy || '—')}）` +
        (el.length ? `   精英 ${dead.length}/${el.length}、${dead.length ? med(dead).toFixed(1) + ' 秒' : '—'}` : ''),
    );
  }
  const ch1 = [1, 2, 3, 4, 5].map((n) => all.map((ws) => ws.find((x) => x.wave === n)).filter((x): x is WaveRow => !!x));
  const reached5 = all.filter((ws) => ws.some((x) => x.wave === 5 && !x.died)).length;
  const w12 = ch1.slice(0, 2).flat();
  const w35 = ch1.slice(2).flat();
  console.log(`\n第一章前 5 波：第 1–2 波每波掉血平均 ${pct(avg(w12.map((x) => x.lost)))}；第 3–5 波每波掉血中位 ${pct(med(w35.map((x) => x.lost)))}、平均 ${pct(avg(w35.map((x) => x.lost)))}、一波掉过半血的 ${w35.filter((x) => x.lost >= 0.5).length}/${w35.length} 次；最低气血跌破 50% 的波 ${ch1.flat().filter((x) => x.minHp < 0.5).length} 次；阵亡 ${ch1.flat().filter((x) => x.died).length} 次；打完第 5 波 ${reached5}/${rs.length}`);
  const normal = all.flat().filter((x) => !isBossWave(x.wave) && x.wave > 6);
  console.log(`第二、三章的普通波：每波掉血中位 ${pct(med(normal.map((x) => x.lost)))}、平均 ${pct(avg(normal.map((x) => x.lost)))}；阵亡 ${normal.filter((x) => x.died).length}/${normal.length} 波次`);
  const BY_NAME: Record<string, string> = { contact: '贴身', orb: '鬼火', spear: '长矛', charge: '冲锋', blast: '自爆', boss: '首领', miasma: '魔气', thunder: '天雷', ten: '十阵', water: '红水', blood: '化血', wind: '风吼', sword: '轮斩剑气', flysword: '飞剑灵', qi: '门徒剑气', tether: '傀儡剑气线', ring: '剑阵外', tide: '夜叉的浪', blade: '剑侍的剑', recoil: '精英反震', echo: '回响化身' };
  // 第二章：打到第 7 波的局里，打赢姚天君的有几局；掉血来源
  const reached = rs.filter((r) => r.ch2 !== 'none');
  const cleared = rs.filter((r) => r.ch2 === 'cleared');
  const h2: Record<string, number> = {};
  for (const r of reached) for (const [k, v] of Object.entries(r.hurtBy2)) h2[k] = (h2[k] ?? 0) + v;
  const h2Total = Object.values(h2).reduce((a, b) => a + b, 0) || 1;
  const fights = rs.map((r) => r.waves.find((x) => x.wave === 12)).filter((x): x is WaveRow => !!x);
  console.log(
    `第二章（西岐城外 · 十绝阵）：打到 ${reached.length} 局，打赢${legacyCast ? '姚天君' : '首领'} ${cleared.length} 局（通过率 ${reached.length ? pct(cleared.length / reached.length) : '—'}）；` +
      `首领战打了 ${fights.length} 次、阵亡 ${fights.filter((x) => x.died).length}、打赢用时中位 ${(med(fights.filter((x) => !x.died).map((x) => x.secs)) || 0).toFixed(0)} 秒；` +
      `第二章掉血来源（每局平均，按最大气血）：${Object.entries(h2).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${BY_NAME[k] ?? k} ${Math.round((v / reached.length) * 100)}%（${Math.round((v / h2Total) * 100)}%）`).join('，')}`,
  );
  // 第三章：打到第 13 波的局里，打赢诛仙剑灵（通关）的有几局；掉血来源
  const reached3 = rs.filter((r) => r.ch3 !== 'none');
  const cleared3 = rs.filter((r) => r.ch3 === 'cleared');
  const h3: Record<string, number> = {};
  for (const r of reached3) for (const [k, v] of Object.entries(r.hurtBy3)) h3[k] = (h3[k] ?? 0) + v;
  const h3Total = Object.values(h3).reduce((a, b) => a + b, 0) || 1;
  const fights3 = rs.map((r) => r.waves.find((x) => x.wave === 18)).filter((x): x is WaveRow => !!x);
  const died3 = reached3.filter((r) => !r.win && r.waves.some((x) => x.wave >= 13 && x.died));
  if (reached3.length)
    console.log(
      `第三章（界牌关 · 诛仙阵）：打到 ${reached3.length} 局，打赢${legacyCast ? '诛仙剑灵' : '首领'} ${cleared3.length} 局（通过率 ${pct(cleared3.length / reached3.length)}）；` +
        `死在第三章的 ${died3.length} 局（死在第 ${died3.map((r) => r.waves.find((x) => x.died && x.wave >= 13)?.wave).join('、') || '—'} 波）；` +
        `首领战打了 ${fights3.length} 次、阵亡 ${fights3.filter((x) => x.died).length}、打赢用时中位 ${(med(fights3.filter((x) => !x.died).map((x) => x.secs)) || 0).toFixed(0)} 秒；` +
        `第三章掉血来源（每局平均，按最大气血）：${Object.entries(h3).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${BY_NAME[k] ?? k} ${Math.round((v / reached3.length) * 100)}%（${Math.round((v / h3Total) * 100)}%）`).join('，')}`,
    );
  // 回响化身遭遇战（第 10、16 波的精英换成回响赵公明 / 回响云霄）：遇到几局、打倒几局、打倒用了多久、没打倒的退走时还剩多少
  for (const wv of legacyCast ? [10, 16] : []) {
    const met = rs.flatMap((r) => r.echo.filter((x) => x.wave === wv));
    if (!met.length) continue;
    const killed = met.filter((x) => x.killed);
    const fled = met.filter((x) => !x.killed);
    const row = rs.map((r) => r.waves.find((x) => x.wave === wv)).filter((x): x is WaveRow => !!x);
    console.log(
      `回响化身遭遇战（第 ${wv} 波 · ${met[0].name}）：遇到 ${met.length} 局、打倒 ${killed.length} 局（${pct(killed.length / met.length)}）、` +
        `打倒用时中位 ${(med(killed.map((x) => x.secs)) || 0).toFixed(0)} 秒（从现身算）；没打倒的 ${fled.length} 局退走时还剩气血中位 ${fled.length ? pct(med(fled.map((x) => x.left))) : '—'}；` +
        `这一波阵亡 ${row.filter((x) => x.died).length}、掉血中位 ${pct(med(row.map((x) => x.lost)))}`,
    );
  }
  const hurtBy: Record<string, number> = {};
  for (const r of rs) for (const [k, v] of Object.entries(r.hurtBy)) hurtBy[k] = (hurtBy[k] ?? 0) + v;
  const hurtTotal = Object.values(hurtBy).reduce((a, b) => a + b, 0) || 1;
  console.log(`第一章前 5 波的掉血来源：${Object.entries(hurtBy).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${BY_NAME[k] ?? k} ${Math.round((v / hurtTotal) * 100)}%`).join('，')}`);
  const lootTotal: Record<string, number> = {};
  for (const r of rs) for (const [k, v] of Object.entries(r.loots)) lootTotal[k] = (lootTotal[k] ?? 0) + v;
  console.log(`每局捡到的掉落（平均）：${Object.entries(lootTotal).map(([k, v]) => `${k} ${(v / rs.length).toFixed(1)}`).join('，')}`);
}

/** HitBy → 给人看的名字（「几下打死」的来源表）。 */
const BY_LABEL: Partial<Record<HitBy, string>> = {
  ring: '乾坤圈',
  thrust: '火尖枪',
  aura: '火罩',
  chain: '连跳的雷',
  slam: '番天印',
  knife: '斩仙飞刀',
  spike: '寒冰幡',
  burn: '灼烧',
  shield: '护盾震开 / 金刚不坏',
  explode: '爆开（燎原 / 碎冰 / 寒冰诀）',
  bleed: '流血',
  thunder: '雷印 / 五雷正法',
  zone: '区域持续伤害',
  react: '相生追加',
  lash: '打神鞭',
  slash: '化血神刀',
  gust: '定风珠',
  beam: '阴阳镜',
  wave: '七禽扇火浪',
  bird: '七禽火鸟',
  rope: '捆仙绳',
  tide: '控水旗水柱',
  relic: '灵物',
  cleave: '三尖刀横扫',
  stab: '三尖刀刺',
  chop: '三尖刀劈山',
  dou: '混元金斗',
  sword: '剑气（地形）',
  bead: '定海珠',
  skill: '神通',
  cudgel: '黄金棍',
  wheel: '黑焰轮',
  lasso: '缚龙索',
  scroll: '乾坤图',
  staff: '金箍棒',
  rock: '金箍棒石刺',
  pestle: '降魔杵',
  stone: '五光石',
  nail: '攒心钉',
  jiao: '金蛟剪',
  geyser: '焰光旗地火',
  crow: '万鸦壶',
  surge: '四海瓶',
  net: '雾露乾坤网',
  sweep: '七宝妙树',
  gem: '七宝妙树宝光',
  plague: '瘟癀伞',
  coin: '落宝金钱',
};
const CAUSE_LABEL: Record<KillCause, string> = { plain: '平常一下', crit: '暴击', react: '相生', skill: '神通', dot: '持续伤害', execute: '斩杀', terrain: '地形' };

/**
 * 「几下打死」的表（用户 2026-11-11：没成型时普通敌人要挨两到四下，一下打死的很少；成型以后可以秒）：
 * 按波次、按章（第二章分前后两半）、按敌人种类；最后那一下是什么；伤害从哪儿来。
 * 「一下打死」= 第一次挨打就死了（持续伤害的一跳也算一次挨打）；「平常」= 去掉暴击、相生、神通、斩杀、地形打死的。
 */
function killTable(rs: RunRow[]) {
  const all = rs.flatMap((r) => r.deaths);
  const main = all.filter((x) => x.kind !== 'splitling'); // 分魂鬼分出来的小鬼（气血是普通兵的一半）单列
  const q = (xs: number[], k: number) => {
    const s = xs.filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
    return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * k))] : NaN;
  };
  const p0 = (xs: KillRow[], f: (x: KillRow) => boolean) => (xs.length ? pct(xs.filter(f).length / xs.length) : '—');
  const one = (x: KillRow) => x.events === 1;
  const onePlain = (x: KillRow) => x.events === 1 && x.cause === 'plain';
  const row = (label: string, xs: KillRow[], perRun: number) => {
    const h = (a: number, b: number) => p0(xs, (x) => x.hits >= a && x.hits <= b).padStart(5);
    return (
      `${pad(label, 14)}${(perRun ? (xs.length / perRun).toFixed(0) : '0').padStart(5)}   ${p0(xs, onePlain).padStart(4)} / ${p0(xs, one).padStart(4)}   ` +
      `${h(0, 0)}${h(1, 1)}${h(2, 2)}${h(3, 3)}${h(4, 4)}${h(5, 6)}${h(7, 1e9)}   ${String(q(xs.map((x) => x.hits), 0.5)).padStart(4)}    ` +
      `${pct(q(xs.map((x) => x.first), 0.5)).padStart(5)} / ${pct(q(xs.map((x) => x.first), 0.9)).padStart(5)}    ${q(xs.map((x) => x.life), 0.5).toFixed(1).padStart(5)}  ${q(xs.map((x) => x.ttk), 0.5).toFixed(1).padStart(5)}`
    );
  };
  const wid = (t: string) => [...t].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 2 : 1), 0);
  const lp = (t: string, n: number) => ' '.repeat(Math.max(0, n - wid(t))) + t;
  const head = `${pad('波次', 14)}${lp('打死', 5)}   ${lp('平常', 4)} / ${lp('全部', 4)}   ${lp('烧死', 5)}${lp('1下', 5)}${lp('2下', 5)}${lp('3下', 5)}${lp('4下', 5)}${lp('5–6', 5)}${lp('7+', 5)}   ${lp('几下', 4)}    ${lp('首下', 5)} / ${lp('九成', 5)}    ${lp('寿命', 5)}  ${lp('挨打', 5)}`;
  console.log(
    `\n「几下打死」：普通敌人（不含精英、首领、幡 / 草人；分魂鬼的小鬼单列）。打死 = 每局这一波打死几只；一下打死 = 第一次挨打就死了（平常 = 去掉暴击、相生、神通、斩杀、地形打死的 / 全部）；` +
      `\n  挨了几下 = 直接命中几下的分布（烧死 = 一下直接命中都没挨，死于灼烧 / 流血 / 区域）；首下 = 第一下直接命中打掉最大气血的多少（中位 / 九成）；寿命 = 从刷出来到死、挨打 = 从挨第一下到死（秒，中位）：`,
  );
  console.log(head);
  const reachedW = (n: number) => rs.filter((r) => r.waves.some((x) => x.wave === n)).length;
  const maxWave = main.reduce((m, x) => Math.max(m, x.wave), 0); // 不用 Math.max(...)：一百多局有十几万只，展开会爆栈
  for (let n = 1; n <= maxWave; n++) {
    const xs = main.filter((x) => x.wave === n);
    if (!xs.length) continue;
    const tag = isBossWave(n) ? `${n} 首领` : `${n} ${Math.ceil(n / WAVES_PER_CHAPTER)}-${((n - 1) % WAVES_PER_CHAPTER) + 1}`;
    console.log(row(tag, xs, reachedW(n)));
  }
  console.log('按章（只算普通波；第二章分前后两半；「每局打死」是每局每波平均）：');
  const span = (a: number, b: number) => main.filter((x) => x.wave >= a && x.wave <= b && !isBossWave(x.wave));
  const runsIn = (a: number, b: number) => {
    let n = 0;
    for (let w = a; w <= b; w++) if (!isBossWave(w)) n += reachedW(w);
    return n;
  };
  for (const [label, a, b] of [
    ['第一章 1–5', 1, 5],
    ['第二章 7–9', 7, 9],
    ['第二章 10–11', 10, 11],
    ['第三章 13–17', 13, 17],
  ] as [string, number, number][]) {
    const xs = span(a, b);
    if (xs.length) console.log(row(label, xs, runsIn(a, b)));
  }
  const lings = all.filter((x) => x.kind === 'splitling');
  if (lings.length) console.log(`分魂鬼的小鬼：${lings.length} 只，一下打死 ${p0(lings, one)}（平常 ${p0(lings, onePlain)}）`);
  // 按敌人种类（每章的普通波）
  const KIND_NAME: Partial<Record<EnemyKindName, string>> = { soldier: '回响兵', spearman: '矛卒', shieldbearer: '盾卫', cavalry: '骁骑', bomber: '爆符鬼', splitter: '分魂鬼', caster: '鬼火术士', bannerman: '落魂幡手', golem: '红沙傀儡', windfiend: '风吼妖', flysword: '飞剑灵', disciple: '截教门徒', puppet: '阵图傀儡' };
  for (const ch of [1, 2, 3]) {
    const xs = span((ch - 1) * WAVES_PER_CHAPTER + 1, ch * WAVES_PER_CHAPTER - 1);
    if (!xs.length) continue;
    const kinds = [...new Set(xs.map((x) => x.kind))].sort((a, b) => xs.filter((x) => x.kind === b).length - xs.filter((x) => x.kind === a).length);
    console.log(
      `第${ch}章普通波按种类（只数 · 一下打死平常 / 全部 · 几下中位 · 第一下掉血中位）：` +
        kinds.map((k) => {
          const ys = xs.filter((x) => x.kind === k);
          return `${KIND_NAME[k] ?? k} ${ys.length} · ${p0(ys, onePlain)}/${p0(ys, one)} · ${q(ys.map((x) => x.hits), 0.5)} · ${pct(q(ys.map((x) => x.first), 0.5))}`;
        }).join('；'),
    );
  }
  // 最后那一下是什么、来源（每章的普通波）；一下打死的那些是被什么一下打死的
  for (const ch of [1, 2, 3]) {
    const xs = span((ch - 1) * WAVES_PER_CHAPTER + 1, ch * WAVES_PER_CHAPTER - 1);
    if (!xs.length) continue;
    const by = (ys: KillRow[], f: (x: KillRow) => string) => {
      const m: Record<string, number> = {};
      for (const x of ys) m[f(x)] = (m[f(x)] ?? 0) + 1;
      return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 9).map(([k, v]) => `${k} ${pct(v / ys.length)}`).join('，');
    };
    const ones = xs.filter(one);
    console.log(`第${ch}章普通波 最后那一下：${by(xs, (x) => CAUSE_LABEL[x.cause])}；来源：${by(xs, (x) => BY_LABEL[x.killer] ?? x.killer)}`);
    if (ones.length) console.log(`  一下打死的（${ones.length} 只）被什么打死：${by(ones, (x) => BY_LABEL[x.killer] ?? x.killer)}；${by(ones, (x) => CAUSE_LABEL[x.cause])}`);
  }
  // 没成型的那一段（第一章、第二章前半）：按最后那一下的来源，各打死多少只、其中一下打死的占多少（平常 / 全部）——看哪一件法宝秒得多
  {
    const early = main.filter((x) => x.wave <= 9 && !isBossWave(x.wave));
    const m = new Map<string, KillRow[]>();
    for (const x of early) {
      const k = BY_LABEL[x.killer] ?? x.killer;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(x);
    }
    const rows = [...m].filter(([, ys]) => ys.length >= 30).sort((a, b) => b[1].filter(onePlain).length / b[1].length - a[1].filter(onePlain).length / a[1].length);
    console.log(
      `没成型（第 1–9 波普通波）按来源：打死几只 · 其中一下打死（平常 / 全部）：` + rows.map(([k, ys]) => `${k} ${ys.length} · ${p0(ys, onePlain)}/${p0(ys, one)}`).join('；'),
    );
  }
  const dmg: Record<string, number> = {};
  for (const r of rs) for (const [k, v] of Object.entries(r.dmgBy)) dmg[BY_LABEL[k as HitBy] ?? k] = (dmg[BY_LABEL[k as HitBy] ?? k] ?? 0) + v;
  const dt = Object.values(dmg).reduce((a, b) => a + b, 0) || 1;
  console.log(`打在普通敌人身上的伤害（全程，按来源；含溢出）：${Object.entries(dmg).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v / dt)}`).join('，')}`);
}

/** 「几下打死」的一行小结（--jie all、--elements 每组一行）：各段普通波一下打死的占比（平常）、几下中位。 */
function killBrief(rs: RunRow[]) {
  const all = rs.flatMap((r) => r.deaths).filter((x) => x.kind !== 'splitling' && !isBossWave(x.wave));
  const parts = (
    [
      ['第一章', 1, 5],
      ['二章前半', 7, 9],
      ['二章后半', 10, 11],
      ['第三章', 13, 17],
    ] as [string, number, number][]
  ).map(([label, a, b]) => {
    const xs = all.filter((x) => x.wave >= a && x.wave <= b);
    if (!xs.length) return `${label} —`;
    const s = xs.map((x) => x.hits).sort((m, n) => m - n);
    return `${label} ${pct(xs.filter((x) => x.events === 1 && x.cause === 'plain').length / xs.length)}（几下中位 ${s[Math.floor(s.length / 2)]}）`;
  });
  return `一下打死（平常）：${parts.join('，')}`;
}

/** 各法宝被机器人选到时的表现：选到的局数、留到最后的平均品阶、选到时的通关率与打到第几波、直接命中的伤害占比。 */
function weaponTable(rs: RunRow[], label: string) {
  console.log(`\n各法宝被机器人选到时的表现（${label}；${rs.length} 局；「伤害占比」= 带着它的局里，它直接命中的伤害占全部伤害的多少，不含灼烧 / 流血 / 区域等算不清来源的持续伤害）：`);
  console.log(`  ${pad('法宝', 12)}${pad('五行', 5)}选到  留到最后  平均品阶  通关率  打到第几波  伤害占比`);
  const allWin = rs.filter((r) => r.win).length / rs.length;
  for (const k of [HEROES[hero].exclusive, ...COMMON_WEAPONS] as WeaponKind[]) {
    const got = rs.filter((r) => r.ever.has(k));
    const kept = rs.filter((r) => r.final.some((x) => x.kind === k));
    if (!got.length) {
      console.log(`  ${pad(WEAPONS[k].name, 12)}${pad(ELEMENT_NAME[WEAPONS[k].el], 5)}   0`);
      continue;
    }
    const tiers = kept.map((r) => r.final.find((x) => x.kind === k)!.tier);
    const win = kept.filter((r) => r.win).length / Math.max(1, kept.length);
    const share = avg(got.map((r) => (r.direct[k] ?? 0) / Math.max(1, r.total)));
    const flag = kept.length >= 3 && Math.abs(win - allWin) > 0.25 ? (win > allWin ? '  ←偏强' : '  ←偏弱') : '';
    console.log(
      `  ${pad(WEAPONS[k].name, 12)}${pad(ELEMENT_NAME[WEAPONS[k].el], 5)}${String(got.length).padStart(4)}  ${String(kept.length).padStart(8)}  ${(kept.length ? avg(tiers).toFixed(1) : '—').padStart(8)}  ${(kept.length ? pct(win) : '—').padStart(6)}  ${String(kept.length ? med(kept.map((r) => r.wave)) : '—').padStart(10)}  ${pct(share).padStart(8)}${WEAPONS[k].wip ? '  （标了 wip，商店不刷）' : ''}${flag}`,
    );
  }
  const spirits = new Map<string, { n: number; win: number }>();
  for (const r of rs)
    for (const x of r.final)
      if (x.spirit) {
        const key = `${WEAPONS[x.kind].name}·${WEAPONS[x.kind].spirits.find((s) => s.id === x.spirit)?.name}`;
        const s = spirits.get(key) ?? { n: 0, win: 0 };
        s.n++;
        if (r.win) s.win++;
        spirits.set(key, s);
      }
  if (spirits.size) console.log(`  觉醒的器灵（局数 / 通关）：${[...spirits].map(([k, v]) => `${k} ${v.n}/${v.win}`).join('，')}`);
}

/** 劫数、修为的说明（加在第一行的标签后面；劫一、没带修为时是空的，和原来的输出一样）。 */
function jieTag() {
  return `${jieN > 1 ? `（${jieTier(jieN).name} · ${jieTier(jieN).title}）` : ''}${xwNodes.length ? `（修为 ${xwArg}：${xwNodes.length} 节、${spentOn(xwNodes)} 道行）` : ''}`;
}

if (jieAll) {
  // 劫一到劫五各跑一组（同一批种子；只跑「之后」那一遍）：每劫一行小结
  console.log(`劫一到劫五${tag}${xwNodes.length ? `（修为 ${xwArg}：${xwNodes.length} 节、${spentOn(xwNodes)} 道行）` : ''}，每劫 ${runs} 局，种子 2000–${2000 + runs - 1}：`);
  for (let n = 1; n <= 5; n++) {
    jieN = n;
    const rs = simulate(true);
    const s = summary(rs);
    console.log(`\n${jieTier(n).name} · ${jieTier(n).title}：${s.text}`);
    console.log(`  ${s.boss}`);
    console.log(`  打到的波次：${s.spread}`);
    console.log(`  ${killBrief(rs)}`);
  }
} else if (elemMode) {
  // 五行三件档：每一行一组，开局就是乾坤圈 + 同一行三件凡品（位置满了，之后只能买同名件升阶）
  console.log(`五行三件档${tag}（每组 ${runs} 局；开局就给乾坤圈 + 同一行三件公共法宝的凡品，之后机器人照常买同名件升阶、选属性）：`);
  const groups: { name: string; el: Element | null; load: WeaponKind[] }[] = ELEMENTS.map((el) => ({ name: `${ELEMENT_NAME[el]}行`, el, load: COMMON_WEAPONS.filter((k) => WEAPONS[k].el === el) }));
  groups.push({ name: '杂搭（对照）', el: null, load: ['leigong', 'hanbing', 'fantian'] });
  for (const g of groups) {
    const rs = simulate(true, () => [{ kind: HEROES[hero].exclusive, tier: 1, spirit: null, cd: 0.6 }, ...g.load.map((k) => ({ kind: k, tier: 1, spirit: null, cd: 0.6 }))]);
    const s = summary(rs);
    const bonus = g.el ? `三件档「${ELEMENT_BONUS[g.el][2]}」` : '没有三件档';
    console.log(`\n  ${pad(g.name, 12)}${g.load.map((k) => WEAPONS[k].name).join(' + ')}（${bonus}）`);
    console.log(`    ${s.text}`);
    console.log(`    ${s.boss}`);
    console.log(`    打到的波次：${s.spread}`);
    console.log(`    ${killBrief(rs)}`);
  }
} else {
  const after = simulate(true);
  const before = onlyNew ? null : simulate(false);
  console.log(`runs=${runs}${tag}${jieTag()}，种子 2000–${2000 + runs - 1}`);
  if (before) {
    const sb = summary(before);
    console.log(`\n新法宝之前（对照：商店只刷最早的 ${FIRST_WEAPONS.length} 件公共法宝 + 专属）：${sb.text}`);
    console.log(`  ${sb.boss}`);
    console.log(`  打到的波次：${sb.spread}`);
  }
  const sa = summary(after);
  console.log(`\n新法宝之后（和游戏里一样：${SHOP_POOL}都在商店里）：${sa.text}`);
  console.log(`  ${sa.boss}`);
  console.log(`  打到的波次：${sa.spread}`);
  waveTable(after);
  if (!legacyCast) bossTable(after);
  killTable(after);
  if (process.argv.includes('--tier-hp')) {
    // 每一品阶的法宝在游戏里打的普通敌人有多少血（除掉人物的伤害加成：weapon-dps.ts 的法宝不吃加成），中位 / 四分位
    const q = (xs: number[], k: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length * k)] : NaN);
    console.log('\n各品阶的法宝打中的普通敌人气血 ÷ 人物伤害倍率（weapon-dps.ts 群伤场景的兵按这个定）：' + [1, 2, 3, 4].map((t) => {
      const xs = after.flatMap((r) => r.tierHp[t]);
      return ` ${TIER_NAME[t]} 中位 ${q(xs, 0.5).toFixed(0)}（四分位 ${q(xs, 0.25).toFixed(0)}–${q(xs, 0.75).toFixed(0)}，${xs.length} 下）`;
    }).join('；'));
  }
  weaponTable(after, '新法宝之后');
  if (before) weaponTable(before, '新法宝之前，对照');
  console.log('\n「之后」前 8 局的结局与构筑：');
  for (const x of after.slice(0, 8)) console.log(`  第${x.wave}波 ${x.win ? '通关' : '阵亡'}  Lv${x.level}  斩${x.kills}  ${x.build}`);
}
void DT;
