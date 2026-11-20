// 法宝 DPS 表：确定性场景，逐件、逐品阶（凡 / 灵 / 仙 / 神的两个器灵）量三种情况下的每秒伤害：
//   群伤：一群普通兵追着走位的机器人。场上始终 40 只：打死的从四周 250–320 像素处补上，另外每秒把最远的 3 只
//         挪到四周重新涌进来（像真实刷怪一样从四面八方来）。机器人全速绕场心走大圈（半径 200）：
//         这样身边敌人的远近和真实波次里 botInput 的一致（最近的一只中位数 50–70 像素，92 像素内 1.5–3 只），
//         而方差小得多 —— botInput 在这种人造场景里有时被围死、有时把敌群整个甩开，同一件法宝不同种子能差十倍。
//         加 --bot 改用 botInput 走位（对照用）；
//   单体：单个精英（打不死）走过来贴身，人物站着不动；
//   首领：第 6 波的魔化哪吒（打不死），人物无敌、按 botInput 躲招走位（和首领战里一样，离首领 95 像素上下）；
//         每过三分之一的时长就把它的气血压到下一个阶段的阈值，三个阶段的招式都打到；它召来的回响兵照常刷（法宝会分心去打）。
//         只算打在首领本体上的伤害，按首领能挨打的时间算（入场、换阶段时它无敌）。
// 法宝单独装备、不吃别的加成：基础属性（暴击 5%）、不带主五行亲和、宠物不出手、不放神通、不捡掉落。
// 伤害按「实际扣掉的血」算（溢出的不算），所以大招打小兵会浪费一部分 —— 这正是要量的。
// 群伤场景里普通兵的血量按游戏里量出来的定（2026-11-11 起；tools/balance.ts --tier-hp，四个角色各 20 局）：每一品阶的法宝在游戏里
// 打中的普通敌人有多少血、除掉人物这一行的伤害加成（这里的法宝不吃加成）——凡 46、灵 56、仙 58、神 50。
// 原来是按 TIER_DMG 放大的 30 / 48 / 78 / 126（「打几下死一只」各品阶不变），可游戏里仙、神品打的兵远没有那么厚：
// 敌人的气血第 9 波以后不再涨（catalog.WAVE_CURVE），成型以后一下打死一片，大招打小兵的溢出就是游戏里真有的浪费。
// 报警：群伤、单体偏离同品阶中位数超过 ±15%（2026-11-11 起单体也收到 ±15%，原来 ±25%）、首领超出中位数的 ÷1.4 … ×1.4（这样同一品阶最强最弱差不到 2 倍）。
// 防御 / 控制型（WeaponDef.role：戊己杏黄旗、青莲宝色旗、捆仙绳）单列、不参与中位数：
//   防御型在「人物会挨打、血量无限」的场景里量（气血一直压在一半，回血才算得出来），另报每分钟挡几次、回多少血、闪避几次；
//   控制型另报身边敌人被定住的时间占比，以及和一件输出法宝（火尖枪，同品阶）一起带时的增益、挨打次数的变化。
// 用法：node --no-osr-from-maglev tools/weapon-dps.ts [--seeds 16] [--secs 30] [--boss-seeds 6] [--boss-secs 60] [--no-boss]
//         [--only qiankun,huojian] [--reach] [--area 0.3] [--combo] [--elements] [--bot]
//   --reach：射程表 —— 人物站着不动、300 像素内远近都钉着兵，量每件法宝的直接命中离人物多远（中位 / 95% / 最远）、
//     打在 REACH.seek、REACH.max 以外的伤害占多少，圈 / 飞刀 / 火鸟飞到、预警与区域落到离人物最远多远（看射程规则守没守住）。
//     人物不动才量得准：群伤场景里人物一直在跑，延时落下的、持续一会儿的效果结算时人物早走开了。
//   --area：人物的范围加成（看射程的封顶），默认 0。
//   --elements：五行三件档 —— 乾坤圈 + 同一行的三件公共法宝（都按仙品）一起带，比各行的群伤、单体、挨打与回血。
//   --no-osr-from-maglev：Node 25.9 的 JIT 有缺陷（maglev 编出来的 OSR 代码在长循环里偶尔算错），同一张表跑一次变一次
//     （约一半的进程）。这里每帧的循环体都挪进了单独的函数（循环本身只剩一行调用），不加这个参数一般也稳；加上更保险。
import { createWorld, baseStats, spawnEnemy, step, type World } from '../src/sim/world.ts';
import { heldList } from '../src/sim/heroes/index.ts';
import { botInput } from '../src/sim/bot.ts';
import { bossEnemy } from '../src/sim/boss.ts';
import { ARENA, BOSS, DT, REACH } from '../src/sim/config.ts';
import { COMMON_WEAPONS, ELEMENT_BONUS, TIER_DMG, TIER_NAME, WAVES_PER_CHAPTER, WEAPONS } from '../src/sim/catalog.ts';
import { createRng } from '../src/sim/rng.ts';
import { ARTI2_BY } from '../src/sim/arti2.ts';
import { ELEMENTS, ELEMENT_NAME, type Element, type HitBy, type PlayerInput, type SimEvent, type WeaponKind } from '../src/sim/types.ts';
import { applySets } from './tune.ts';

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const SEEDS = Number(arg('--seeds', '16')); // 5 个种子时同一件法宝换一组种子能差 ±10%；8 个种子群伤还能差 ±8%（2026-11-11 量过），拉平 ±15% 不够稳，改成 16
const SECS = Number(arg('--secs', '30'));
const BOSS_SEEDS = Number(arg('--boss-seeds', '6'));
const BOSS_SECS = Number(arg('--boss-secs', '60'));
const NO_BOSS = process.argv.includes('--no-boss');
const ONLY = arg('--only', '');
const COMBO = process.argv.includes('--combo');
const ELEM = process.argv.includes('--elements');
const BOT = process.argv.includes('--bot');
const REACH_T = process.argv.includes('--reach');
const AREA = Number(arg('--area', '0'));
// --sparse N：再量一个「稀疏」的群伤场景——场上始终 N 只兵、每秒涌进 1 只（像开局几波：敌人从屏幕外一只只走进来，身边常常只有两三只）。
// 出手慢、靠一下打一团的法宝在这里吃亏，开局（凡 / 灵品）更接近这个场景
const SPARSE = Number(arg('--sparse', '0'));
const CIRCLE = 200; // 绕场心走圈的半径（纵向 ×0.75）
const HOLD = Number(arg('--hold', '0')); // 单体场景：精英离人物最近多远（0 = 不管，贴到身上）
const WARM = 3;
// 各品阶用同样大小的敌群（只有血量按 TIER_DMG 放大），这样品阶之间的倍数才可比。
const CROWD_T = [0, 40, 40, 40, 40];
const INFLOW_T = [0, 3, 3, 3, 3];
const CROWD = CROWD_T[1];
const INFLOW = INFLOW_T[1];
// 群伤场景的兵血量：--tier-hp 凡,灵,仙,神 可以临时换（量游戏里各品阶的法宝打的兵有多少血：tools/balance.ts --tier-hp）
const TIER_HP = process.argv.includes('--tier-hp') ? [0, ...arg('--tier-hp', '').split(',').map(Number)] : [0, 46, 56, 58, 50];
const ROOT_R = 90; // 控制型：看人物身边这么远内的敌人有多少时间被定住
const SIEGE = 12; // 被围场景：身边始终多少只兵
const IDLE: PlayerInput = { mx: 0, my: 0, skill: false };
const siegeCache = new Map<number, Result>();
/** 被围场景的对照：同品阶的火尖枪单带。 */
const siegeRef = (tier: number) => {
  if (!siegeCache.has(tier)) siegeCache.set(tier, avg([{ kind: 'huojian', tier, spirit: tier === 4 ? 'storm' : null }], true, TIER_HP[tier], SEEDS, SIEGE, 0, true, true));
  return siegeCache.get(tier)!;
};

interface Loadout {
  kind: WeaponKind;
  tier: number;
  spirit: string | null;
}
interface Result {
  dps: number; // 实际扣血 / 秒
  raw: number; // 跳字合计 / 秒（含溢出）
  blocks: number; // 护盾挡下的次数 / 分钟（杏黄旗）
  heal: number; // 法宝回的血 / 分钟（青莲结界、化血神刀噬魂）
  dodges: number; // 闪避次数 / 分钟（青莲「莲台」）
  hurt: number; // 挨打扣的血 / 分钟（会挨打的场景才有）
  hits: number; // 挨打次数 / 分钟
  root: number; // 身边 ROOT_R 内的敌人被定住（晕眩 / 定身 / 冻结）的时间占比
  per: number; // 每一下直接命中的平均伤害（跳字，含溢出；灼烧、流血、区域的每一跳不算）
  rate: number; // 直接命中几下 / 秒
  one: number; // 群伤场景：打死的兵里第一次挨打就死了的占比（一下打死）
}
const ZERO: Result = { dps: 0, raw: 0, blocks: 0, heal: 0, dodges: 0, hurt: 0, hits: 0, root: 0, per: 0, rate: 0, one: 0 };
/** 持续伤害：每一跳不算「一下」。 */
const DOT: ReadonlySet<HitBy> = new Set<HitBy>(['burn', 'bleed', 'zone']);

/** 法宝的直接命中（持续伤害、相生、爆炸、神通不算）：量射程用。 */
const DIRECT: ReadonlySet<HitBy> = new Set<HitBy>(['ring', 'thrust', 'aura', 'chain', 'slam', 'knife', 'spike', 'thunder', 'shield', 'lash', 'slash', 'gust', 'beam', 'wave', 'bird', 'rope', 'tide', ...(Object.keys(ARTI2_BY) as HitBy[])]);
/** --reach：射程场景里攒下的数据。 */
interface Reach {
  dists: number[]; // 每一下直接命中离人物多远
  dmg: number;
  beyondSeek: number; // 打在 REACH.seek 以外的伤害
  beyondMax: number; // 打在 REACH.max 以外的伤害
  fly: number; // 圈 / 飞刀 / 火鸟离人物最远多远
  land: number; // 预警、区域、连跳的落点离人物最远多远
}
const newReach = (): Reach => ({ dists: [], dmg: 0, beyondSeek: 0, beyondMax: 0, fly: 0, land: 0 });

const role = (k: WeaponKind) => WEAPONS[k].role;

function setup(seed: number, load: Loadout[], vulnerable: boolean): World {
  const w = createWorld(seed);
  w.wave = 3; // 普通波：刷怪关掉
  w.waveLen = 1e9;
  w.spawnAcc = -1e12;
  w.eliteDone = true;
  w.surgeDone = true;
  const p = w.players[0];
  p.stats = baseStats();
  p.stats.area = AREA;
  p.weapons = load.map((l) => ({ kind: l.kind, tier: l.tier, spirit: l.spirit, cd: 0.3 }));
  p.pet.cd = 1e12; // 宠物不出手（它的「破绽」会抬高伤害）
  if (vulnerable) {
    p.stats.maxHp = 1e9;
    p.hp = p.stats.maxHp * 0.5;
  } else p.iframes = 1e12;
  return w;
}

/**
 * 跑一个场景。crowd：保持一群普通兵；否则一只打不死的精英。vulnerable：人物会挨打（血量无限，一直压在一半）。
 * siege：被围 —— 人物站着不动，身边一圈兵（60–160 像素）围上来，打死的从 220–260 像素处补（量防御 / 控制型的价值）。
 */
function run(seed: number, load: Loadout[], crowd: boolean, hp: number, size = CROWD, inflowRate = INFLOW, vulnerable = load.some((l) => role(l.kind) === 'defense'), siege = false): Result {
  const w = setup(seed, load, vulnerable);
  const p = w.players[0];
  const dir = seed % 2 ? 1 : -1; // 顺时针 / 逆时针轮着来
  if (crowd && !BOT && !siege) {
    p.x = p.px = ARENA.w / 2 + CIRCLE;
    p.y = p.py = ARENA.h / 2;
  }
  const rng = createRng(seed * 7919 + 13);
  const spot = (near: boolean) => {
    const a = rng.next() * Math.PI * 2;
    const d = siege ? (near ? 60 + rng.next() * 100 : 220 + rng.next() * 40) : near ? 60 + rng.next() * 200 : 250 + rng.next() * 70;
    return [p.x + Math.cos(a) * d, p.y + Math.sin(a) * d * 0.75];
  };
  const add = (near: boolean) => {
    const [x, y] = spot(near);
    const e = spawnEnemy(w, 'soldier', x, y, []);
    // 血量在 hp 的 0.7–1.3 倍之间（游戏里各种敌人、各波的血量本来就有高有低，四分位约 ±25%）：
    // 全都一样厚的话，一下的伤害刚好够 / 刚好差一点打死，量出来的群伤会跳两成（出手慢、一下重的法宝尤其明显）
    e.hp = e.maxHp = Math.max(1, Math.round(hp * (0.7 + 0.6 * rng.next())));
  };
  let inflow = 0;
  if (crowd) for (let i = 0; i < size; i++) add(true);
  else {
    const e = spawnEnemy(w, 'elite', p.x + 70, p.y, []);
    e.hp = e.maxHp = 1e9;
  }
  const r: Result = { ...ZERO };
  let nearN = 0;
  let rootN = 0;
  let directDmg = 0;
  let directN = 0;
  let killN = 0;
  let oneN = 0;
  const struck = new Map<number, number>(); // 每只兵挨了几次打（含持续伤害的每一跳）：死的时候是 1 就是一下打死
  const n = Math.round((WARM + SECS) / DT);
  const hpBefore = new Map<number, number>();
  // 每一帧（单独一个函数：躲开 Node 25.9 在长循环里 OSR 的 JIT 缺陷，见文件头）
  const frame = (i: number) => {
    const measuring = i * DT >= WARM;
    hpBefore.clear();
    for (const e of [...w.enemies, ...heldList(w)]) hpBefore.set(e.id, e.hp);
    const inp: PlayerInput = !crowd || siege ? IDLE : BOT ? { ...botInput(w, 0), skill: false } : circle(p, dir);
    const ev: SimEvent[] = step(w, [inp]);
    // 每只兵挨了几次打（热身时也记：热身时挨过打、量的时候才死的不算一下打死）
    for (const e of ev) {
      if (e.t === 'hit') struck.set(e.id, (struck.get(e.id) ?? 0) + 1);
      else if (e.t === 'kill') {
        if (measuring) {
          killN++;
          if (struck.get(e.id) === 1) oneN++;
        }
        struck.delete(e.id);
      }
    }
    if (measuring) {
      const now = new Map([...w.enemies, ...heldList(w)].map((e) => [e.id, e.hp])); // 云霄的金斗里的那几只还在（只是暂时不在场上）
      for (const [id, h0] of hpBefore) r.dps += Math.max(0, h0) - Math.max(0, now.get(id) ?? 0);
      for (const e of ev) {
        if (e.t === 'hit') {
          r.raw += e.dmg;
          if (!DOT.has(e.by)) {
            directDmg += e.dmg;
            directN++;
          }
        } else if (e.t === 'blocked' && e.by === 'shield') r.blocks++;
        else if (e.t === 'heal' && e.owner === 0) r.heal += e.amount;
        else if (e.t === 'dodge') r.dodges++;
        else if (e.t === 'hurt' && e.owner === 0) {
          r.hurt += e.dmg;
          r.hits++;
        }
      }
      for (const e of w.enemies)
        if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 < ROOT_R * ROOT_R) {
          nearN++;
          if (e.stun > 0) rootN++;
        }
    }
    w.drops = []; // 不捡掉落（宝匣会开出碎片把品阶抬上去）
    w.gems = [];
    p.skill = 0;
    if (!crowd && HOLD > 0)
      for (const e of w.enemies) {
        // 精英顶在人物身前（无敌时接触不会把它弹开，不然它会整个叠到人物身上）
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d < HOLD) {
          const k = d > 1e-6 ? HOLD / d : 0;
          e.x = d > 1e-6 ? p.x + dx * k : p.x + HOLD;
          e.y = d > 1e-6 ? p.y + dy * k : p.y;
        }
      }
    if (crowd) {
      while (w.enemies.length + heldList(w).length < size) add(false);
      for (inflow += siege ? 0 : inflowRate * DT; inflow >= 1; inflow--) {
        let far = w.enemies[0];
        let fd = -1;
        for (const e of w.enemies) {
          const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
          if (d > fd) {
            fd = d;
            far = e;
          }
        }
        const [x, y] = spot(false);
        far.x = far.px = x;
        far.y = far.py = y;
        far.hp = far.maxHp;
        struck.delete(far.id); // 挪回去、回满血：当成新来的一只
      }
    }
    if (vulnerable) {
      p.hp = p.stats.maxHp * 0.5;
      p.alive = true;
    }
  };
  for (let i = 0; i < n; i++) frame(i);
  const perMin = 60 / SECS;
  return {
    dps: r.dps / SECS,
    raw: r.raw / SECS,
    blocks: r.blocks * perMin,
    heal: r.heal * perMin,
    dodges: r.dodges * perMin,
    hurt: r.hurt * perMin,
    hits: r.hits * perMin,
    root: nearN ? rootN / nearN : 0,
    per: directN ? directDmg / directN : 0,
    rate: directN / SECS,
    one: killN ? oneN / killN : 0,
  };
}

/** 全速绕场心走椭圆：切向走，偏离了半径就往回拉。 */
function circle(p: { x: number; y: number }, dir: number): PlayerInput {
  const dx = p.x - ARENA.w / 2;
  const dy = (p.y - ARENA.h / 2) / 0.75;
  const d = Math.hypot(dx, dy) || 1;
  const k = ((CIRCLE - d) / CIRCLE) * 2;
  const mx = (-dy / d) * dir + (dx / d) * k;
  const my = ((dx / d) * dir + (dy / d) * k) * 0.75;
  const m = Math.hypot(mx, my) || 1;
  return { mx: mx / m, my: my / m, skill: false };
}

function avg(load: Loadout[], crowd: boolean, hp: number, seeds = SEEDS, size = CROWD, inflowRate = INFLOW, vulnerable?: boolean, siege = false): Result {
  const rs = Array.from({ length: seeds }, (_, s) => run(100 + s, load, crowd, hp, size, inflowRate, vulnerable, siege));
  const out: Result = { ...ZERO };
  for (const k of Object.keys(ZERO) as (keyof Result)[]) out[k] = rs.reduce((a, r) => a + r[k], 0) / seeds;
  return out;
}

/**
 * 射程场景（--reach）：人物站在场心不动、不会挨打；四周 300 像素内始终钉着 60 只兵（站着不动，挨了击退、被卷被拽也钉回原处；
 * 打死的换到别处：离人物 40–300 像素、按面积均匀撒），血量按品阶。远近都有敌人，法宝挑谁、打多远就看得出来。
 * 记每一下直接命中、每个预警 / 区域 / 连跳的落点、圈与飞刀 / 火鸟离人物多远。
 */
function runReach(seed: number, load: Loadout[], reach: Reach, secs = 20) {
  const w = setup(seed, load, false);
  const p = w.players[0];
  const rng = createRng(seed * 104729 + 7);
  const home = new Map<number, [number, number]>();
  const hp = TIER_HP[load[0].tier];
  const add = () => {
    const a = rng.next() * Math.PI * 2;
    const d = Math.sqrt(40 * 40 + rng.next() * (300 * 300 - 40 * 40));
    const x = p.x + Math.cos(a) * d;
    const y = p.y + Math.sin(a) * d;
    const e = spawnEnemy(w, 'soldier', x, y, []);
    e.hp = e.maxHp = hp;
    e.speed = 0;
    home.set(e.id, [e.x, e.y]);
  };
  for (let i = 0; i < 60; i++) add();
  const dist = (x: number, y: number) => Math.hypot(x - p.x, y - p.y);
  const frame = (i: number) => {
    const ev: SimEvent[] = step(w, [IDLE]);
    if (i * DT >= 1) {
      for (const e of ev) {
        if (e.t === 'hit' && DIRECT.has(e.by)) {
          const d = dist(e.x, e.y);
          reach.dists.push(d);
          reach.dmg += e.dmg;
          if (d > REACH.seek) reach.beyondSeek += e.dmg;
          if (d > REACH.max) reach.beyondMax += e.dmg;
        } else if (e.t === 'warn' || (e.t === 'zone' && e.zone !== 'lotus' && e.zone !== 'beam' && e.zone !== 'flameWave')) reach.land = Math.max(reach.land, dist(e.x, e.y));
        else if (e.t === 'chain') for (const [x, y] of e.pts.slice(1)) reach.land = Math.max(reach.land, dist(x, y + 8));
      }
      for (const o of w.rings) reach.fly = Math.max(reach.fly, dist(o.x, o.y + 10));
      for (const o of w.knives) reach.fly = Math.max(reach.fly, dist(o.x, o.y + 12));
    }
    w.drops = [];
    w.gems = [];
    p.skill = 0;
    for (const e of w.enemies) {
      const h = home.get(e.id);
      if (!h) continue;
      e.x = e.px = h[0];
      e.y = e.py = h[1];
      e.kx = e.ky = 0;
    }
    while (w.enemies.length < 60) add();
  };
  const n = Math.round(secs / DT);
  for (let i = 0; i < n; i++) frame(i);
}
const reachAvg = (load: Loadout[]) => {
  const r = newReach();
  for (let s = 0; s < 3; s++) runReach(500 + s, load, r);
  return r;
};

/**
 * 首领场景：第 6 波开打，魔化哪吒入场后血量改成打不死；人物无敌（魔气也不掉血）、按 botInput 躲招走位，不放神通。
 * 每过 BOSS_SECS / 3 秒把首领的气血压到下一个阶段的阈值，三个阶段的招式（三头六臂、横扫、风火轮、魔焰焚城）都打到。
 * 返回打在首领本体上的伤害 ÷ 首领能挨打的秒数。
 */
function runBoss(seed: number, load: Loadout[]): number {
  const w = createWorld(seed);
  const p = w.players[0];
  p.stats = baseStats();
  p.stats.area = AREA;
  p.weapons = load.map((l) => ({ kind: l.kind, tier: l.tier, spirit: l.spirit, cd: 0.3 }));
  p.pet.cd = 1e12;
  w.wave = WAVES_PER_CHAPTER - 1;
  w.phase = 'shop';
  p.ready = false;
  step(w, [IDLE], [{ t: 'ready', player: 0 }]); // 开第 6 波：首领入场
  const b = bossEnemy(w)!;
  b.hp = b.maxHp = 1e9;
  const seg = BOSS_SECS / 3;
  let dmg = 0;
  let live = 0;
  let t = 0;
  let pushed = 1; // 已经压到第几阶段
  const frame = () => {
    p.iframes = 1e12;
    p.hp = p.stats.maxHp;
    p.alive = true;
    p.skill = 0;
    p.pet.cd = 1e12;
    w.drops = [];
    w.gems = [];
    const f = w.boss;
    // 打够一段就把首领压进下一阶段（bossCheck 会卡在阈值上换阶段）
    if (f && f.state !== 'intro' && f.state !== 'phase' && pushed < 3 && live >= seg * pushed) {
      b.hp = Math.ceil(b.maxHp * BOSS.phases[pushed - 1]);
      pushed++;
    }
    const hittable = b.invuln <= 0 && !!f && f.state !== 'intro' && f.state !== 'phase';
    const ev: SimEvent[] = step(w, [{ ...botInput(w, 0), skill: false }]);
    for (const e of ev) if (e.t === 'hit' && e.id === b.id) dmg += e.dmg;
    if (hittable) live += DT;
    t += DT;
  };
  while (live < BOSS_SECS && t < BOSS_SECS * 2) frame();
  return dmg / Math.max(1, live);
}
const bossAvg = (load: Loadout[]) => Array.from({ length: BOSS_SEEDS }, (_, s) => runBoss(300 + s, load)).reduce((a, b) => a + b, 0) / BOSS_SEEDS;

/** 给调数值的脚本用：一件法宝（某品阶、某器灵）的群伤 / 单体 / 首领 DPS（boss = false 时不量首领）。 */
export function measure(kind: WeaponKind, tier: number, spirit: string | null, seeds = SEEDS, boss = false) {
  const load = [{ kind, tier, spirit }];
  const g = avg(load, true, TIER_HP[tier], seeds, CROWD_T[tier], INFLOW_T[tier]);
  // one：群伤场景里打死的兵有多少是第一次挨打就死了（「没成型不秒杀」看凡 / 灵品的这个数）
  return { group: g.dps, one: g.one, single: avg(load, false, 0, seeds).dps, boss: boss ? bossAvg(load) : NaN };
}
export { TIER_HP };

if (import.meta.main) main();

function main() {
  applySets(); // --set '表.路径=值'：临时改数值表（tools/tune.ts）
  const kinds = (Object.keys(WEAPONS) as WeaponKind[]).filter((k) => !ONLY || ONLY.split(',').includes(k));
  const variants = (k: WeaponKind) => [
    { label: '凡', tier: 1, spirit: null as string | null },
    { label: '灵', tier: 2, spirit: null },
    { label: '仙', tier: 3, spirit: null },
    ...WEAPONS[k].spirits.map((s) => ({ label: `神·${s.name}`, tier: 4, spirit: s.id as string | null })),
  ];

  interface Row {
    kind: WeaponKind;
    label: string;
    tier: number;
    spirit: string | null;
    group: Result;
    sparse: Result | null;
    single: Result;
    boss: number;
    reach: Reach | null;
  }
  const rows: Row[] = [];
  const t0 = Date.now();
  for (const k of kinds)
    for (const v of variants(k)) {
      const load = [{ kind: k, tier: v.tier, spirit: v.spirit }];
      rows.push({
        kind: k,
        label: v.label,
        tier: v.tier,
        spirit: v.spirit,
        group: avg(load, true, TIER_HP[v.tier], SEEDS, CROWD_T[v.tier], INFLOW_T[v.tier]),
        sparse: SPARSE ? avg(load, true, TIER_HP[v.tier], SEEDS, SPARSE, 1) : null,
        single: avg(load, false, 0),
        boss: NO_BOSS ? NaN : bossAvg(load),
        reach: REACH_T ? reachAvg(load) : null,
      });
    }

  const med = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };
  const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 2 : 1), 0)));
  const lpad = (s: string, n: number) => ' '.repeat(Math.max(0, n - s.length)) + s;
  const pct = (v: number) => (Number.isNaN(v) ? '—' : `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`);
  const num = (v: number) => (Number.isNaN(v) ? '—' : v.toFixed(1));

  // 每个品阶（神品把两个器灵都算进去）的中位数：防御 / 控制型不参与
  const medGroup = new Map<number, number>();
  const medSingle = new Map<number, number>();
  const medSparse = new Map<number, number>();
  const medBoss = new Map<number, number>();
  for (const t of [1, 2, 3, 4]) {
    const xs = rows.filter((r) => r.tier === t && !role(r.kind));
    if (!xs.length) continue;
    medGroup.set(t, med(xs.map((r) => r.group.dps)));
    if (SPARSE) medSparse.set(t, med(xs.map((r) => r.sparse!.dps)));
    medSingle.set(t, med(xs.map((r) => r.single.dps)));
    medBoss.set(t, med(xs.map((r) => r.boss)));
  }
  const dmgKinds = kinds.filter((k) => !role(k));
  const roleKinds = kinds.filter((k) => role(k));
  const BOSS_BAND = 1.4; // 首领：中位数的 ÷1.4 … ×1.4
  const BAND = 0.15; // 群伤、单体（、疏群）：中位数的 ±15%（用户 2026-11-11：「DPS 都要差不多」；单体原来放宽到 ±25%）

  console.log(
    `法宝 DPS（群伤 / 单体 ${SEEDS} 个种子 × ${SECS} 秒${NO_BOSS ? '' : `，首领 ${BOSS_SEEDS} 个种子 × ${BOSS_SECS} 秒`}${AREA ? `；范围 +${Math.round(AREA * 100)}%` : ''}；群伤 = ${CROWD} 只普通兵从四面八方追着${BOT ? ' botInput 走位' : '绕场走大圈'}的机器人，单体 = 单个精英贴身、人物不动，首领 = 魔化哪吒三个阶段、botInput 躲招；只算实际扣掉的血）`,
  );
  console.log(`群伤场景的普通兵：血量 凡 ${TIER_HP[1]} / 灵 ${TIER_HP[2]} / 仙 ${TIER_HP[3]} / 神 ${TIER_HP[4]}；场上始终 ${CROWD} 只、每秒从四周涌进 ${INFLOW} 只\n`);
  console.log(`「冷却」= 基础冷却（秒）；「每下」= 单体场景里每一下直接命中的平均伤害（跳字，含溢出，不算灼烧 / 流血 / 区域）；「秒杀」= 群伤场景里打死的兵有多少是第一次挨打就死了\n`);
  console.log(`${pad('法宝', 14)}${pad('品阶', 18)}${lpad('群伤', 7)}${lpad('偏中位', 8)}${lpad('单体', 7)}${lpad('偏中位', 8)}${lpad('首领', 7)}${lpad('偏中位', 8)}${lpad('综合', 7)}${lpad('对凡品', 8)}${lpad('冷却', 6)}${lpad('每下', 7)}${lpad('秒杀', 6)}${SPARSE ? `${lpad('疏群', 7)}${lpad('偏中位', 7)}` : ''}`);
  const bad: string[] = [];
  for (const k of dmgKinds) {
    const rs = rows.filter((r) => r.kind === k);
    const base = rs.find((r) => r.tier === 1)!;
    for (const r of rs) {
      const mg = medGroup.get(r.tier) ?? 1;
      const ms = medSingle.get(r.tier) ?? 1;
      const mb = medBoss.get(r.tier) ?? NaN;
      const dg = r.group.dps / mg - 1;
      const ds = r.single.dps / ms - 1;
      const db = r.boss / mb - 1;
      const parts = [r.group.dps / mg, r.single.dps / ms, ...(NO_BOSS ? [] : [r.boss / mb])];
      const total = parts.reduce((a, b) => a + b, 0) / parts.length;
      const bparts = [r.group.dps / base.group.dps, r.single.dps / Math.max(1e-9, base.single.dps), ...(NO_BOSS ? [] : [r.boss / Math.max(1e-9, base.boss)])];
      const vsBase = bparts.reduce((a, b) => a + b, 0) / bparts.length;
      const dsp = SPARSE ? r.sparse!.dps / (medSparse.get(r.tier) ?? 1) - 1 : 0;
      const flags = [Math.abs(dg) > BAND ? '群伤' : '', Math.abs(ds) > BAND ? '单体' : '', !NO_BOSS && (r.boss > mb * BOSS_BAND || r.boss < mb / BOSS_BAND) ? '首领' : '', SPARSE && Math.abs(dsp) > BAND ? '疏群' : ''].filter(Boolean);
      if (flags.length) bad.push(`${WEAPONS[k].name}${r.label}（${flags.join('、')}）`);
      const wip = WEAPONS[k].wip && r.tier === 1 ? '（标了 wip，商店不刷）' : ''; // 现在公共法宝都在商店里，没有这一标；留给以后的新法宝
      console.log(
        `${pad(r.label === '凡' ? WEAPONS[k].name : '', 14)}${pad(r.label, 18)}${lpad(r.group.dps.toFixed(1), 7)}${lpad(pct(dg), 8)}${lpad(r.single.dps.toFixed(1), 7)}${lpad(pct(ds), 8)}${lpad(num(r.boss), 7)}${lpad(pct(db), 8)}${lpad(total.toFixed(2), 7)}${lpad(`×${vsBase.toFixed(2)}`, 8)}${lpad(WEAPONS[k].cd.toFixed(1), 6)}${lpad(r.single.per.toFixed(0), 7)}${lpad(pct(r.group.one).replace('+', ''), 6)}${SPARSE ? `${lpad(r.sparse!.dps.toFixed(1), 7)}${lpad(pct(dsp), 7)}` : ''}${flags.length ? ` ←${flags.join('、')}` : ''}${wip}`,
      );
    }
  }
  console.log(`\n各品阶中位数（${dmgKinds.length} 件输出型；神品两个器灵都算）。群伤涨得比单体快：灵品的数量 / 范围、仙品的质变、神品的器灵都是多打几只，单发按 TIER_DMG 的八五折左右涨：`);
  for (const t of [1, 2, 3, 4]) {
    if (!medGroup.has(t)) continue;
    const g = medGroup.get(t)!;
    const s = medSingle.get(t)!;
    const b = medBoss.get(t)!;
    const gg = g / medGroup.get(1)!;
    const sg = s / medSingle.get(1)!;
    const bs = rows.filter((r) => r.tier === t && !role(r.kind)).map((r) => r.boss);
    const bossTxt = NO_BOSS ? '' : `  首领 ${b.toFixed(1)}（对凡品 ×${(b / medBoss.get(1)!).toFixed(2)}；最强 / 最弱 ${(Math.max(...bs) / Math.min(...bs)).toFixed(2)} 倍）`;
    console.log(`  ${TIER_NAME[t]}品  群伤 ${g.toFixed(1)}（对凡品 ×${gg.toFixed(2)}）  单体 ${s.toFixed(1)}（对凡品 ×${sg.toFixed(2)}）${bossTxt}  群伤与单体平均 ×${((gg + sg) / 2).toFixed(2)}（TIER_DMG ×${TIER_DMG[t]}）`);
  }
  console.log(bad.length ? `\n超出范围（群伤、单体${SPARSE ? '、疏群' : ''} ±15%，首领 ÷${BOSS_BAND}…×${BOSS_BAND}）：${bad.join('、')}` : `\n同一品阶的群伤、单体${SPARSE ? '、疏群' : ''}都在中位数 ±15%、首领 ÷1.4…×1.4 以内`);

  if (REACH_T) {
    const q = (xs: number[], k: number) => {
      const s = [...xs].sort((a, b) => a - b);
      return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * k))] : 0;
    };
    console.log(`\n射程（人物站着不动、300 像素内远近都钉着兵；离人物脚下的距离，像素。REACH.seek = ${REACH.seek}、REACH.max = ${REACH.max}${AREA ? `；范围 +${Math.round(AREA * 100)}%` : ''}）：`);
    console.log(`${pad('法宝', 14)}${pad('品阶', 18)}  直接命中 中位/95%/最远   >${REACH.seek} 的伤害  >${REACH.max} 的伤害  飞行物最远  落点最远`);
    for (const r of rows) {
      const R = r.reach!;
      console.log(
        `${pad(r.label === '凡' ? WEAPONS[r.kind].name : '', 14)}${pad(r.label, 18)}  ${lpad(q(R.dists, 0.5).toFixed(0), 4)} / ${lpad(q(R.dists, 0.95).toFixed(0), 3)} / ${lpad(q(R.dists, 1).toFixed(0), 3)}   ${lpad(pct(R.beyondSeek / Math.max(1, R.dmg)).replace('+', ''), 10)}  ${lpad(pct(R.beyondMax / Math.max(1, R.dmg)).replace('+', ''), 10)}  ${lpad(R.fly ? R.fly.toFixed(0) : '—', 9)}  ${lpad(R.land ? R.land.toFixed(0) : '—', 7)}`,
      );
    }
  }

  if (roleKinds.length) {
    console.log('\n防御 / 控制型（单列，不参与中位数；「对中位」是自己打出的伤害占同品阶中位数的多少）：');
    console.log(`  被围 = 人物站着不动、身边始终 ${SIEGE} 只兵围上来，会挨打；对照是同品阶的火尖枪单带（被围时挨打的次数 / 扣的血）`);
    for (const k of roleKinds) {
      const rs = rows.filter((r) => r.kind === k);
      for (const r of rs) {
        const mg = medGroup.get(r.tier) ?? 1;
        const ms = medSingle.get(r.tier) ?? 1;
        const mb = medBoss.get(r.tier) ?? NaN;
        let extra = '';
        const sg = avg([{ kind: k, tier: r.tier, spirit: r.spirit }], true, TIER_HP[r.tier], SEEDS, SIEGE, 0, true, true);
        const ref = siegeRef(r.tier);
        const siegeTxt = `被围：挨打 ${sg.hits.toFixed(0)} 次 / 扣血 ${sg.hurt.toFixed(0)}（对照 ${ref.hits.toFixed(0)} / ${ref.hurt.toFixed(0)}）`;
        if (role(k) === 'defense') {
          const bits = [];
          if (r.group.blocks || sg.blocks) bits.push(`挡 ${r.group.blocks.toFixed(1)} / ${sg.blocks.toFixed(1)} 次`);
          if (r.group.heal || sg.heal) bits.push(`回血 ${r.group.heal.toFixed(0)} / ${sg.heal.toFixed(0)}`);
          if (r.group.dodges || sg.dodges) bits.push(`闪避 ${r.group.dodges.toFixed(1)} / ${sg.dodges.toFixed(1)} 次`);
          extra = `  每分钟（走位 / 被围）：${bits.join('，')}；${siegeTxt}`;
        } else extra = `  身边敌人被定住的时间 ${pct(r.group.root).replace('+', '')}（走位）/ ${pct(sg.root).replace('+', '')}（被围）；${siegeTxt}`;
        console.log(
          `${pad(r.label === '凡' ? WEAPONS[k].name : '', 14)}${pad(r.label, 18)}群伤 ${lpad(r.group.dps.toFixed(1), 6)}（对中位 ${lpad(pct(r.group.dps / mg - 1), 5)}）  单体 ${lpad(r.single.dps.toFixed(1), 6)}（${lpad(pct(r.single.dps / ms - 1), 5)}）  首领 ${lpad(num(r.boss), 6)}（${lpad(pct(r.boss / mb - 1), 5)}）${extra}`,
        );
      }
    }
    // 控制型的价值：和一件输出法宝一起带时，输出法宝打得更多（易伤、扎堆）、人物挨打更少（定身的不撞人）
    for (const k of roleKinds.filter((x) => role(x) === 'control')) {
      console.log(`\n${WEAPONS[k].name}和火尖枪（同品阶）一起带：群伤 / 单体 = 一起带的合计 vs 各自单带之和；被围时挨打 = 火尖枪单带 → 一起带`);
      for (const v of variants(k)) {
        const partner = { kind: 'huojian' as WeaponKind, tier: v.tier, spirit: v.tier === 4 ? 'storm' : null };
        const mine = { kind: k, tier: v.tier, spirit: v.spirit };
        const g2 = avg([partner, mine], true, TIER_HP[v.tier]).dps;
        const g1 = avg([partner], true, TIER_HP[v.tier]).dps + avg([mine], true, TIER_HP[v.tier]).dps;
        const s2 = avg([partner, mine], false, 0).dps;
        const s1 = avg([partner], false, 0).dps + avg([mine], false, 0).dps;
        const h1 = siegeRef(v.tier);
        const h2 = avg([partner, mine], true, TIER_HP[v.tier], SEEDS, SIEGE, 0, true, true);
        console.log(`  ${pad(v.label, 14)}群伤 ${g2.toFixed(1)}（${pct(g2 / g1 - 1)}）  单体 ${s2.toFixed(1)}（${pct(s2 / Math.max(1e-9, s1) - 1)}）  被围时挨打 ${h1.hits.toFixed(0)} → ${h2.hits.toFixed(0)} 次 / 分钟、扣血 ${h1.hurt.toFixed(0)} → ${h2.hurt.toFixed(0)}`);
      }
    }
  }

  if (COMBO) {
    // 五行相生的搭配：两件相生的法宝一起带，对比各自单带之和（多出来的就是相生 + 印记接力带来的）。
    // 群伤这里用更密的敌群（70 只、每秒涌进 6 只）：两件法宝一起打，40 只的场景会先没得打（打死得太快），量不出相生。
    const pairs: [WeaponKind, WeaponKind][] = [
      ['zhanxian', 'hanbing'], // 金生水：凝霜
      ['hanbing', 'leigong'], // 水生木：导雷
      ['leigong', 'huojian'], // 木生火：引燃
      ['qiankun', 'fantian'], // 火生土：熔岩
      ['fantian', 'zhanxian'], // 土生金：淬锋
      ['huaxue', 'yinyang'], // 金生水：凝霜
      ['xuanyuan', 'dingfeng'], // 水生木：导雷
      ['dingfeng', 'wuhuo'], // 木生火：引燃
      ['wuhuo', 'kunxian'], // 火生土：熔岩
      ['kunxian', 'dashen'], // 土生金：淬锋
    ];
    console.log('\n五行相生的搭配（灵品，群伤 / 单体；增益 = 一起带 ÷ 各自单带之和 − 1；群伤用 70 只的密集敌群）：');
    for (const [a, b] of pairs) {
      const la = { kind: a, tier: 2, spirit: null };
      const lb = { kind: b, tier: 2, spirit: null };
      const g = avg([la, lb], true, TIER_HP[2], SEEDS, 70, 6).dps;
      const ga = avg([la], true, TIER_HP[2], SEEDS, 70, 6).dps + avg([lb], true, TIER_HP[2], SEEDS, 70, 6).dps;
      const s = avg([la, lb], false, 0).dps;
      const sa = avg([la], false, 0).dps + avg([lb], false, 0).dps;
      console.log(`  ${WEAPONS[a].name} + ${WEAPONS[b].name}：群伤 ${g.toFixed(1)}（${pct(g / ga - 1)}）  单体 ${s.toFixed(1)}（${pct(s / Math.max(1e-9, sa) - 1)}）`);
    }
  }

  if (ELEM) elementTable(pct, pad, lpad);
  console.log(`\n（用时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒）`);
}

/**
 * 五行三件档：乾坤圈（火）+ 同一行的三件公共法宝，四件都按仙品。火行是四件火（三件档之上再多一件），
 * 其余各行是三件同行 + 一件火。对照组是「杂搭」：乾坤圈 + 雷公鞭（木）+ 寒冰幡（水）+ 番天印（土），没有任何三件档。
 * 群伤用更密的敌群（90 只、每秒涌进 8 只，兵按仙品 78 血），单体同上；另外在会挨打的场景里量每分钟挨打扣血和回血。
 * 三件档有的不是伤害（土「不动如山」减伤、木「生生不息」回血），所以三样一起看。
 */
function elementTable(pct: (v: number) => string, pad: (s: string, n: number) => string, lpad: (s: string, n: number) => string) {
  const T = 3;
  const builds: { name: string; el: Element | null; load: Loadout[] }[] = ELEMENTS.map((el) => ({
    name: `${ELEMENT_NAME[el]}行三件`,
    el,
    load: [{ kind: 'qiankun', tier: T, spirit: null }, ...COMMON_WEAPONS.filter((k) => WEAPONS[k].el === el).map((k) => ({ kind: k, tier: T, spirit: null }))],
  }));
  builds.push({ name: '杂搭（对照）', el: null, load: (['qiankun', 'leigong', 'hanbing', 'fantian'] as WeaponKind[]).map((k) => ({ kind: k, tier: T, spirit: null })) });
  const res = builds.map((b) => ({
    b,
    group: avg(b.load, true, TIER_HP[T], SEEDS, 90, 8).dps,
    single: avg(b.load, false, 0).dps,
    def: avg(b.load, true, TIER_HP[T], SEEDS, 90, 8, true),
  }));
  const ref = res[res.length - 1];
  console.log(`\n五行三件档（四件都是仙品；群伤 = 90 只兵、每秒涌进 8 只；挨打 / 回血 = 同样的敌群、人物会挨打；对照 = ${ref.b.name}）：`);
  for (const r of res) {
    const names = r.b.load.map((l) => WEAPONS[l.kind].name).join(' + ');
    const bonus = r.b.el ? `「${ELEMENT_BONUS[r.b.el][2]}」` : '';
    console.log(
      `  ${pad(r.b.name, 14)}群伤 ${lpad(r.group.toFixed(0), 4)}（${lpad(pct(r.group / ref.group - 1), 5)}）  单体 ${lpad(r.single.toFixed(0), 4)}（${lpad(pct(r.single / ref.single - 1), 5)}）  挨打扣血 ${lpad(r.def.hurt.toFixed(0), 4)} / 分钟（${lpad(pct(r.def.hurt / Math.max(1e-9, ref.def.hurt) - 1), 5)}）  回血 ${lpad(r.def.heal.toFixed(0), 3)}  ${names} ${bonus}`,
    );
  }
}
