// 章节表：每一章叫什么、六波各刷什么、首领、地形、场景、台词，都在这里登记（docs/story/ch2-ch3.md「共用的做法」）。
// world.ts、bot.ts 只通过这里拿「这一章的首领模块 / 地形模块 / 刷怪表」，不直接认识哪一章。
//
// 状态放哪：首领的状态在 World.boss、地形的状态在 World.terrain，都是纯数据（数字、字符串、数组、普通对象，带 kind 区分是哪一种），
// 整局存档（联机的快照）能原样存下；模块（下面的 BossModule / TerrainModule）是代码，不进世界，按 kind 在这张表里查。
//
// 加一章怎么接（第三章就是这么接的）：
//   1. src/sim/chN/ 里写首领模块（实现 BossModule，状态类型带自己的 kind）和地形模块（实现 TerrainModule）；
//   2. 新敌人：types.ts 的 FoeKind、config.ts 的 ENEMIES、enemies.ts 的 actEnemy 分派 + 这一章的刷怪表（行为可以放在 chN/ 里）；
//   3. 下面 table() 里登记这一行；world.ts 的 Boss / Terrain 联合类型加上新状态；
//   4. 表现层：render/stage.ts 的 SCENES 里加场景，game/feel.ts 按 boss.kind 建首领画面，story.ts 按章节号加台词。
//
// 首领池（bosspool.ts）：每章的首领不固定——一章登记一个池子（pool），开局抽一个当首领（第 6 波）、另一个来遭遇战（第 4 波）。
// 往池里加一位：写好首领模块（两种打法都要有，见 BossModule）、在 table() 里那一章的 pool 加上它、bosspool.ts 的 BossId / POOL / BOSS_INFO 各加一行。
import { CHAPTERS, chapterOf } from './catalog.ts';
import { NEZHA_BOSS } from './boss.ts';
import { LEGACY, type BossId, type CastSetup, type Casting } from './bosspool.ts';
import { echoBoss } from './echo/index.ts';
import type { Rng } from './rng.ts';
import { CH1_SPAWN, CH2_SPAWN, CH3_SPAWN } from './enemies.ts';
import { TEN_TERRAIN } from './ch2/terrain.ts';
import { YAO_BOSS } from './ch2/yao.ts';
import { SWORD_TERRAIN } from './ch3/terrain.ts';
import { ZHUXIAN_BOSS } from './ch3/zhuxian.ts';
import type { Enemy, EnemyKindName, Player, SimEvent } from './types.ts';
import type { World } from './world.ts';

/** 在 (x, y) 刷一只敌人（world.spawnAt：只做硬边界的保险，位置由调用方挑）。 */
export type Spawn = (kind: EnemyKindName, x: number, y: number) => Enemy;

/**
 * 首领模块：池里的一位。两种打法（bosspool.ts 文件头）：当首领时状态放在 w.boss，来遭遇战时放在 w.echo（状态里 guest: true）；
 * 状态是纯数据（kind 是 BossModule.kind），这里只有代码。模块里找自己的状态用 bosspool.fightOf(w)（一个波次里两个槽最多占一个）。
 * 每一个首领的状态都要有 BossCore 的几样（world、机器人、表现层只用这几样），其余各自扩展。
 */
export interface BossModule {
  /** 和状态的 kind 对应（bosspool.BossId）。 */
  kind: BossId;
  /**
   * 开打。当首领（guest 不给）：首领波开始（world.startWave 里，waveStart 事件之后），放出首领，设好 w.boss，发 bossIntro。
   * 来遭遇战（guest = true）：这一波出精英的那一刻（world.step），在屏幕里、不贴脸的地方现身，设好 w.echo，发 echoIntro；
   * 气血 bosspool.guestHp、只有两个阶段（一半换阶段，换阶段之前打不死）、不刷零星的回响兵、倒下时不清场（发 echoDefeat、掉宝匣）。
   */
  start(w: World, ev: SimEvent[], spawn: Spawn, guest?: boolean): void;
  /** 每帧推进（玩家之后、敌人之前）：状态机、危险物的推进与判定、零星刷兵。 */
  update(w: World, alive: Player[], ev: SimEvent[], spawn: Spawn): void;
  /** 每帧的伤害都结算完之后（清理死敌人之前）：跨过阈值换阶段、打空倒下。 */
  check(w: World, ev: SimEvent[]): void;
  /** 倒下的表现放完了（world 据此进「本章平定 → 收灵 → 商店」或通关）。 */
  defeated(w: World): boolean;
  /**
   * 机器人躲招：(x, y) 有多危险（0 = 安全）。落在一个危险物里算 1 再加「陷得多深」，所以一时躲不出去也知道往哪边躲最近。
   * react：出现不到这么久的预警当作还没看见；jitter：每个预警被看见的早晚不一样（按编号定，确定性）；margin：想离危险边缘多远。
   */
  danger(w: World, x: number, y: number, react?: number, margin?: number, jitter?: number): number;
  /** 机器人的站位偏好：站在 (x, y) 的代价（越小越想站；和 danger 一起比较 16 个方向）。 */
  prefer(w: World, x: number, y: number): number;
  /**
   * 机器人在遭遇战里躲招的方向分量（普通波那一套：加在归一化之前，量级同 bot-dodge.botEnemyDodge）。
   * 不给就用通用的（bot.ts 的 guestDodge：按 danger 试走几个方向）。
   */
  dodge?(w: World, p: Player, react: number): [number, number];
}

/** 所有首领的状态都有的几样（w.boss 的公共部分）。 */
export interface BossCore {
  kind: BossId;
  id: number; // 首领本体在 w.enemies 里的 id（kind 'boss' 的敌人，法宝照常打它）
  /** 这一场是遭遇战（状态在 w.echo：两个阶段、波末退走）还是首领战（w.boss：三个阶段、倒下后本章平定）。 */
  guest: boolean;
  chapter: number;
  phase: number; // 1..3（遭遇战 1..2）
  facing: 1 | -1;
  /** 状态机的状态；'intro' 入场（无敌）、'dead' 倒下的表现（这一仗已经打赢，魔气不掉血、不判负）是每个首领都有的。 */
  state: string;
  t: number; // 进入当前状态多久了
  dur: number; // 当前状态打算持续多久（dead 放完就是 defeated）
}

/**
 * 地形模块：一章的地形机制（第二章「十阵轮转」）。只在本章的普通波和首领波生效，换章时清掉。
 * 状态放在 w.terrain（纯数据，kind 是 TerrainModule.kind）；每一波开始时 start 重新摆好，波末 clear 收掉还在进行的东西
 * （阵台这些不动的留着，收灵时场上照样看得见）。
 */
export interface TerrainModule {
  kind: string;
  /** 本章的每一波开始时（waveStart 之后、首领入场之前）。 */
  start(w: World, ev: SimEvent[]): void;
  /** 每帧推进（玩家移动之后、首领之前）：轮转、落雷、红水、阵边刷兵。 */
  update(w: World, alive: Player[], ev: SimEvent[], spawn: Spawn): void;
  /** 波末（收灵之前）：亮着的阵熄掉、还没落的雷取消。 */
  clear(w: World, ev: SimEvent[]): void;
  /** 机器人躲招：(x, y) 有多危险（口径同 BossModule.danger）。 */
  danger(w: World, x: number, y: number, react?: number, margin?: number): number;
  /** 站在地形上的玩家：法宝伤害倍率（1 = 没有；金光阵 > 1）。core.hitEnemy 乘上。 */
  dmgMul(w: World, p: Player): number;
  /** 站在地形上的玩家：移速倍率（1 = 没有；红水阵 < 1）。 */
  speedMul(w: World, p: Player): number;
  /** 机器人在普通波里躲地形的方向分量（和 bot-dodge.botEnemyDodge 同一个量级，加在归一化之前）。 */
  dodge(w: World, p: Player, react: number): [number, number];
}

/** 所有地形的状态都有的几样（w.terrain 的公共部分）。 */
export interface TerrainCore {
  kind: string;
}

/** 一章的刷怪表：按 order 的顺序抽（每只只抽一次随机数），shares 是第 wave 波（全局编号）各种怪占的比例，没列出来的是回响兵。 */
export interface SpawnTable {
  order: readonly EnemyKindName[];
  shares(wave: number): Partial<Record<EnemyKindName, number>>;
}

export interface ChapterDef {
  n: number;
  /** 场景 id（表现层 render/stage.ts 按它换场景）：'plaza' 陈塘关的回响仙台，'xiqi' 西岐城外，'jiepai' 界牌关前的山谷。 */
  scene: string;
  /** 本章台词的 id（game/story.ts 按章节号查，这里记一份方便对照）。 */
  story: string;
  /** 「原来的首领」（剧情默认写的那一位；= pool[0]）。这一局实际是谁要看抽签：chiefModule(w)。 */
  boss: BossModule;
  /** 这一章的首领池（bosspool.ts）：第一个是「原来的首领」。开局抽一个当首领，另一个来遭遇战。 */
  pool: BossModule[];
  terrain: TerrainModule | null;
  spawn: SpawnTable;
}

// ---------- 登记 ----------
// 模块之间有循环引用（world ↔ chapters ↔ boss / enemies）：表在第一次用到时才建（那时所有模块都已加载完），不在加载时建。
let defs: ChapterDef[] | null = null;
let bosses: Record<string, BossModule> | null = null;
let terrains: Record<string, TerrainModule> | null = null;

function table(): ChapterDef[] {
  if (defs) return defs;
  const row = (d: Omit<ChapterDef, 'boss'>): ChapterDef => ({ ...d, boss: d.pool[0] });
  defs = [
    row({ n: 1, scene: 'plaza', story: 'ch1', pool: [NEZHA_BOSS, echoBoss('aobing')], terrain: null, spawn: CH1_SPAWN }),
    // 第二章（西岐城外 · 十绝阵）：地形「十阵轮转」（ch2/terrain.ts）、三种新敌人（enemies.ts 的 CH2_SPAWN）、首领姚天君（ch2/yao.ts）
    row({ n: 2, scene: 'xiqi', story: 'ch2', pool: [YAO_BOSS, echoBoss('zhao')], terrain: TEN_TERRAIN, spawn: CH2_SPAWN }),
    // 第三章（界牌关 · 诛仙阵）：地形「四剑轮斩」（ch3/terrain.ts）、三种新敌人（ch3/foes.ts，刷怪表 enemies.ts 的 CH3_SPAWN）、首领诛仙剑灵（ch3/zhuxian.ts）
    row({ n: 3, scene: 'jiepai', story: 'ch3', pool: [ZHUXIAN_BOSS, echoBoss('yunxiao')], terrain: SWORD_TERRAIN, spawn: CH3_SPAWN }),
  ];
  bosses = {};
  terrains = {};
  for (const d of defs) {
    for (const b of d.pool) bosses[b.kind] = b;
    if (d.terrain) terrains[d.terrain.kind] = d.terrain;
  }
  return defs;
}

/** 池里的这一位的模块（还没登记的是 undefined）。 */
export function bossById(id: BossId): BossModule | undefined {
  table();
  return bosses![id];
}

/** 第 n 章的池子里登记了模块的那几位（按 POOL.chapters 的顺序）。 */
export const poolOf = (n: number): BossId[] => chapterDef(n).pool.map((b) => b.kind);

/**
 * 开局定下每一章的首领和遭遇战（world.createWorld；怎么给见 bosspool.CastSetup）。
 * 抽签每章最多用两个随机数（池里只有一位、指定了的不用）；不给就是「原样」，一个随机数都不用。
 */
export function drawCast(rng: Rng, setup: CastSetup | undefined): Casting[] {
  const out: Casting[] = [];
  for (let ch = 1; ch <= CHAPTERS; ch++) {
    const pool = poolOf(ch);
    const fx = setup === 'draw' ? undefined : setup ? setup[ch - 1] : LEGACY[ch - 1];
    if (fx && typeof fx === 'object') {
      // 两样都指定：没登记的那一位不要（这一章就没有遭遇战 / 首领换成池里第一位）
      const chief = pool.includes(fx.chief) ? fx.chief : pool[0];
      out.push({ chief, guest: fx.guest && fx.guest !== chief && pool.includes(fx.guest) ? fx.guest : null });
      continue;
    }
    const chief = fx && pool.includes(fx) ? fx : pool.length > 1 ? pool[Math.floor(rng.next() * pool.length)] : pool[0];
    const rest = pool.filter((id) => id !== chief);
    out.push({ chief, guest: rest.length > 1 ? rest[Math.floor(rng.next() * rest.length)] : (rest[0] ?? null) });
  }
  return out;
}

/** 这一章（第 wave 波所在的那一章）的首领模块：抽到的那一位（存档里没有的按池里第一位）。 */
export function chiefModule(w: World, wave = w.wave): BossModule {
  const def = chapterOfWave(wave);
  const id = w.cast[def.n - 1]?.chief;
  return (id && bossById(id)) || def.pool[0];
}

/** 第 n 章（1 起；超出的按最后一章）。 */
export function chapterDef(n: number): ChapterDef {
  const t = table();
  return t[Math.max(0, Math.min(t.length - 1, n - 1))];
}

/** 第 wave 波（全局编号）所在的那一章。 */
export const chapterOfWave = (wave: number) => chapterDef(chapterOf(wave));

/** 现在这场首领战的模块（按 w.boss.kind 查；没有首领时是 null）。 */
export function bossModule(w: World): BossModule | null {
  if (!w.boss) return null;
  table();
  return bosses![w.boss.kind] ?? null;
}

/** 现在这场遭遇战的模块（按 w.echo.kind 查；这一波没有遭遇战时是 null）。 */
export function guestModule(w: World): BossModule | null {
  if (!w.echo) return null;
  table();
  return bosses![w.echo.kind] ?? null;
}

/** 现在的地形模块（按 w.terrain.kind 查；这一章没有地形时是 null）。 */
export function terrainModule(w: World): TerrainModule | null {
  if (!w.terrain) return null;
  table();
  return terrains![w.terrain.kind] ?? null;
}

/** 站在地形上的玩家的法宝伤害倍率（没有地形就是 1）。 */
export function terrainDmgMul(w: World, p: Player): number {
  const t = terrainModule(w);
  return t ? t.dmgMul(w, p) : 1;
}

/** 站在地形上的玩家的移速倍率（没有地形就是 1）。 */
export function terrainSpeedMul(w: World, p: Player): number {
  const t = terrainModule(w);
  return t ? t.speedMul(w, p) : 1;
}
