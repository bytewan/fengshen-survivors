// 游戏模拟：纯 TypeScript，固定步长，不依赖渲染与浏览器 API。
// 一局 = 若干章，每章 6 波：战斗（wave）→ 波次结束结算 → 升级与商店（shop）→ 全员准备 → 下一波；
// 每章第 6 波打首领，打赢进入下一章（法宝和等级都不重置），最后一章的首领打赢就通关。
// 输入：每个玩家的移动指令 + 商店阶段的指令（Command）；输出：新的状态和一串事件。
// 表现层只读状态、消费事件；打击感都在表现层做，不回写这里。联机时房主跑这份模拟。
import { ARENA, CASTER, COLLECT, DROPS, DT, ENEMIES, MIASMA, PLAYER, SPAWN } from './config.ts';
import { CHAPTERS, ECON, ELITE_FLOW, eliteFlowAt, HEROES, SURGE, WEAPONS, chapterOf, eliteCount, waveInChapter, isBossWave, spawnRate, waveDuration, waveScale, xpToNext } from './catalog.ts';
import { buildGrid, elementCounts, forNear, hitEnemy, hurtPlayer, tickStatus } from './core.ts';
import { createRng, range, type Rng } from './rng.ts';
import { applyCommand, makeLevelOffers, petEvolveOffer, restock, syncOffers } from './shop.ts';
import { actEnemy, sandSpeedMul, spawnKind, updatePatches } from './enemies.ts';
import { resetWeapons, updateKnives, updatePending, updateRings, updateWeapons } from './weapons.ts';
import { newPet, updatePet } from './pet.ts';
import { updateZones } from './zones.ts';
import { updateWuxing } from './wuxing.ts';
import { collectFlight, flyStep, lootRemaining, updateDrops, vacuumDrops } from './drops.ts';
import type { BossFight } from './boss.ts';
import { bossById, bossModule, chapterOfWave, chiefModule, drawCast, guestModule, terrainModule, terrainSpeedMul, type Spawn } from './chapters.ts';
import { guestAt, guestWaveEnd, movedElites, type CastSetup, type Casting } from './bosspool.ts';
import type { TenTerrain, YaoFight } from './ch2/types.ts';
import type { SwordTerrain, ZhuxianFight } from './ch3/types.ts';
import { steerOrb } from './ch3/foes.ts';
import { spawnSpot, surgeSpots } from './spawn.ts';
import { offerTechnique, techSave, techSkill, techVacuum, techWaveStart, updateTechniques } from './techniques.ts';
import { relicMiasma, relicPickup, relicSkill, relicSpeed, relicWaveEnd, relicWaveStart, updateRelics } from './relics.ts';
import { bodyHeld, castSkill, heldOff, heroIdle, heroWaveEnd, updateHero } from './heroes/index.ts';
import { fearDmgMul, feared, fleeVel, groundFree, heroGemMul, heroSpeed, heroSteady, teaseVel, teased } from './heroes/passives.ts';
import { cameras, coopWaveEnd, coopWaveStart, downPlayer, enemyHpMul, gemShares, hurtMul, reviveAtShop, scaleBoss, shopDone, spawnMul, surgeRings, updateCoop } from './coop.ts';
import { clampJie, fasterOrb, jieBossStart, jieElites, jieLingshi, jieSpawn, jieTick, jieXp } from './jie.ts';
import { applyXiuwei, xiuweiWaveEnd } from './xiuwei.ts';
import { WAVE_ELITES, spawnElites, spawnExtraElites } from './elites/index.ts';
import type { EchoFight } from './echo/types.ts';
import type { Command, Drop, Enemy, EnemyKindName, Gem, HeroId, Knife, Orb, Patch, Pending, Player, PlayerInput, Ring, SimEvent, Stats, Zone } from './types.ts';

export type { Command, Enemy, EnemyKindName, Gem, Orb, Player, PlayerInput, Ring, SimEvent } from './types.ts';

/** wave 战斗；collect 波末收灵（场上的灵石、物品飞向人物）；shop 升级与商店；over 全员倒下；win 通关。 */
export type Phase = 'wave' | 'collect' | 'shop' | 'over' | 'win';

/** 首领战 / 遭遇战的状态（池里的每一位各一种，kind 区分；公共的几样见 chapters.BossCore；回响那一族共用 EchoFight）。 */
export type Boss = BossFight | YaoFight | ZhuxianFight | EchoFight;
/** 地形的状态（每一章的地形各一种，kind 区分；第一章没有地形）。 */
export type Terrain = TenTerrain | SwordTerrain;

export interface World {
  tick: number;
  time: number; // 总时间
  rng: Rng;
  nextId: number;
  phase: Phase;
  wave: number; // 全局波次编号，1 起（第几章、本章第几波见 catalog.chapterOf / waveInChapter）
  cleared: number; // 刚打赢首领的那一章（商店阶段里表现层据此放首领对白），0 = 没有
  waveT: number; // 这一波过了多久
  collectT: number; // 波末收灵过了多久
  collectUntil: number; // 收灵最早什么时候（按 collectT 算）可以进商店：最少停留、最后一件收下之后的停顿（见 config.COLLECT）
  waveLen: number;
  players: Player[];
  enemies: Enemy[];
  rings: Ring[];
  knives: Knife[];
  pending: Pending[];
  zones: Zone[]; // 持续的地面区域（火痕、地裂、寒霜……）
  patches: Patch[]; // 敌人留在地上的东西（第二章红沙傀儡的红沙），波末清空
  drops: Drop[]; // 战场掉落（宝匣、蟠桃、聚灵符）
  gems: Gem[];
  orbs: Orb[];
  spawnAcc: number;
  eliteDone: boolean;
  eliteMore?: number; // 这一波另外陆续来的精英已经来了几批（catalog.ELITE_FLOW；老存档没有这个字段 = 0）
  surgeDone: boolean;
  boss: Boss | null; // 首领战（这一章抽到的首领，模块按 kind 在 chapters.ts 里查）：阶段、招式、预警与危险物
  terrain: Terrain | null; // 这一章的地形（第二章「十阵轮转」；第一章没有）：纯数据，模块见 chapters.ts 的 TerrainModule
  miasmaInset: { x: number; y: number }; // 魔焰焚城把魔气从四边往里压了多深（0 = 没压）
  jie: number; // 这一局的劫数 1..5（jie.ts；1 = 原来的难度）。开局时定下，整局不变
  echo: Boss | null; // 遭遇战（本章第 4 波的精英换成池里没当首领的那一位；bosspool.ts）：和刷怪并存的一只敌人的打法，状态和当首领时同一种（guest: true）
  cast: Casting[]; // 首领池抽到的（按章，[0] 是第一章）：谁当首领、谁来遭遇战。开局时定下，整局不变（bosspool.ts）
}

export function baseStats(): Stats {
  return {
    maxHp: PLAYER.maxHp,
    regen: 0,
    soul: 0,
    damage: 0,
    haste: 0,
    crit: 0.05,
    critMul: 2,
    area: 0,
    speed: 0,
    pickup: 0,
    armor: 0,
    dodge: 0,
    luck: 0,
    aff: { metal: 0, wood: 0, water: 0, fire: 0, earth: 0 },
  };
}

/** 新建一个人物：开局（createWorld）和中途加入（roster.addPlayer）都用它。id 就是他在 w.players 里的下标。 */
export function newPlayer(id: number, hero: HeroId, x: number, y: number): Player {
  return {
    id,
    hero,
    x,
    y,
    px: x,
    py: y,
    hp: PLAYER.maxHp + (HEROES[hero].maxHp ?? 0), // 魔化哪吒的气血上限低一点（catalog.HEROES；别的角色加 0）
    iframes: 0,
    facing: 1,
    moving: false,
    still: 0,
    skill: 0,
    kills: 0,
    alive: true,
    miasma: 0,
    corrode: 0,
    corrodeT: 0,
    stats: (() => {
      const st = baseStats();
      st.aff[HEROES[hero].el] += HEROES[hero].affStart; // 主五行：开局亲和
      st.maxHp += HEROES[hero].maxHp ?? 0;
      return st;
    })(),
    xp: 0,
    level: 1,
    pendingLevels: 0,
    levelOffers: [],
    lingshi: 0,
    lingshiAcc: 0,
    // 专属法宝起手自带（用户定）：哪吒 → 乾坤圈
    weapons: [{ kind: HEROES[hero].exclusive, tier: 1, spirit: null, cd: 0.6 }],
    frags: {},
    relics: {},
    charms: [],
    charmUsed: {},
    buffs: { gem: 0, rage: 0 },
    shop: [null, null, null, null],
    locked: [false, false, false, false],
    rerolls: 0,
    ready: false,
    shield: 0,
    ringOut: false,
    pet: newPet(HEROES[hero].petKind, x, y), // 宠物跟着角色走（哪吒 · 混天绫、杨戬 · 哮天犬；按种类分派见 pet.ts）
    petOffer: null,
    techs: [],
    techOffer: null,
  };
}

/**
 * 开一局时带进来的设定（纯数据，开局之后就记在世界里：角色在各人的 hero 上，劫数在 w.jie，修为在各人的 stats / lingshi / boon 上）。
 * heroes[i]：第 i 个人物的角色（没给的是哪吒）。jie：劫数 1..5（jie.ts；不给是劫一 = 原来的难度）。
 * xiuwei[i]：第 i 个人点亮的修为节点（xiuwei.ts 的 id；不给就是没有）。
 * cast：每一章的首领怎么定（bosspool.CastSetup）：'draw' 抽签（游戏里）；一串 = 指定；不给 = 加首领池之前的排法（不用随机数）。
 * sealed[i]：第 i 个人还没解锁的东西（Player.sealed 的格式；万宝阁不给他刷）。不给 = 全都能刷——测试、数值工具、机器人照旧全开；
 * 联机时各人带各人的（大厅里随名单带过来）。
 */
export interface RunSetup {
  heroes?: readonly HeroId[];
  jie?: number;
  xiuwei?: readonly (readonly string[] | undefined)[];
  cast?: CastSetup;
  sealed?: readonly (readonly string[] | undefined)[];
}

/** 记下这个人还没解锁的东西（Player.sealed；空的、没给的不加字段：快照、摘要和原来一样）。中途加入联机的人也用它。 */
export function sealFor(p: Player, list: readonly string[] | undefined) {
  const xs = (list ?? []).filter((x, i, a) => typeof x === 'string' && a.indexOf(x) === i).slice(0, 64);
  if (xs.length) p.sealed = xs;
  else delete p.sealed;
}

/** 开一局。第三个参数是开局的设定（RunSetup）；只给一串角色也行（createWorld(seed, n, ['yangjian'])，等于 { heroes }）。 */
export function createWorld(seed: number, playerCount = 1, setup: RunSetup | readonly HeroId[] = {}): World {
  const s: RunSetup = Array.isArray(setup) ? { heroes: setup as readonly HeroId[] } : (setup as RunSetup);
  const w: World = {
    tick: 0,
    time: 0,
    rng: createRng(seed),
    nextId: 1,
    phase: 'wave',
    wave: 1,
    cleared: 0,
    waveT: 0,
    collectT: 0,
    collectUntil: 0,
    waveLen: waveDuration(1),
    players: [],
    enemies: [],
    rings: [],
    knives: [],
    pending: [],
    zones: [],
    patches: [],
    drops: [],
    gems: [],
    orbs: [],
    spawnAcc: 0,
    eliteDone: false,
    surgeDone: false,
    boss: null,
    terrain: null,
    miasmaInset: { x: 0, y: 0 },
    jie: clampJie(s.jie),
    echo: null,
    cast: [],
  };
  w.cast = drawCast(w.rng, s.cast); // 首领池：抽签在所有别的随机数之前（指定了的、「原样」的不用随机数）
  for (let i = 0; i < playerCount; i++) w.players.push(newPlayer(i, s.heroes?.[i] ?? 'nezha', ARENA.w / 2 + (i - (playerCount - 1) / 2) * 24, ARENA.h / 2));
  for (const p of w.players) applyXiuwei(w, p, s.xiuwei?.[p.id]); // 修为（xiuwei.ts）：没点过的人什么都不加
  for (const p of w.players) sealFor(p, s.sealed?.[p.id]); // 还没解锁的东西（成就奖励）：万宝阁不给他刷
  return w;
}

const NO_INSET = { x: 0, y: 0 };
/** 魔气带外沿是硬边界；魔焰焚城把魔气往里压时（inset），外沿也跟着往里收。 */
const clampOuter = (o: { x: number; y: number }, r: number, inset = NO_INSET) => {
  const D = MIASMA.depth;
  o.x = Math.max(inset.x - D + r, Math.min(ARENA.w - inset.x + D - r, o.x));
  o.y = Math.max(inset.y - D + r, Math.min(ARENA.h - inset.y + D - r, o.y));
};
/** 身处魔气的深度：0 = 在仙台上，1 = 魔气带最外沿。inset：魔焰焚城压进来的魔气，边界按缩进后的算。 */
export function miasmaDepth(x: number, y: number, inset = NO_INSET) {
  const dx = Math.max(0, inset.x - x, x - (ARENA.w - inset.x));
  const dy = Math.max(0, inset.y - y, y - (ARENA.h - inset.y));
  return Math.min(1, Math.hypot(dx, dy) / MIASMA.depth);
}

/**
 * 在仙台上摆一只敌人：位置夹在仙台以内。给测试、数值工具（tools/weapon-dps.ts 等）、实验页用，行为和原来一样，
 * 量出来的数不会因为这次改刷怪而变。游戏里的刷怪不走这里，走 spawnAt（不能夹回仙台，见下）。
 */
export function spawnEnemy(w: World, kind: EnemyKindName, x: number, y: number, ev: SimEvent[]) {
  const r = ENEMIES[kind].radius;
  return spawnAt(w, kind, Math.max(ARENA.pad + r, Math.min(ARENA.w - ARENA.pad - r, x)), Math.max(ARENA.pad + r, Math.min(ARENA.h - ARENA.pad - r, y)), ev);
}

/**
 * 游戏里的刷怪：在 (x, y) 刷一只敌人。位置由调用方挑好（常规刷怪、精英、包围、首领召兵都走 spawn.ts：屏幕外、硬边界以内）；
 * 这里只做保险：出了魔气带外沿的硬边界才夹回来（和敌人移动时的边界一致）。
 * 以前刷怪也把点夹回仙台（比敌人移动的边界更严），人物靠墙时刷怪点被挪到人物身边、凭空出现在屏幕里。
 */
export function spawnAt(w: World, kind: EnemyKindName, x: number, y: number, ev: SimEvent[]) {
  const k = ENEMIES[kind];
  const sc = waveScale(w.wave);
  const hp = Math.round(k.hp * (kind === 'boss' ? 1 : sc.hp * enemyHpMul(w))); // 联机按人数加血（coop.ts；单人倍率是 1）
  const e: Enemy = {
    id: w.nextId++,
    kind,
    x,
    y,
    px: x,
    py: y,
    hp,
    maxHp: hp,
    speed: range(w.rng, k.speed[0], k.speed[1]),
    dmgMul: sc.dmg,
    kx: 0,
    ky: 0,
    cd: range(w.rng, 1, CASTER.cooldown[1]),
    cast: 0,
    burn: 0,
    burnT: 0,
    burnAcc: 0,
    burnBy: 0,
    stun: 0,
    frozen: 0,
    slow: 0,
    slowT: 0,
    vuln: 0,
    vulnT: 0,
    wrapT: 0,
    wrapMax: 0,
    fireVuln: 0,
    fireVulnT: 0,
    mark: null,
    markT: 0,
    bleed: 0,
    bleedT: 0,
    invuln: 0,
  };
  jieSpawn(w, e); // 劫数：气血、移速，劫五的精英抽一条词缀（jie.ts；劫一什么都不改）
  clampOuter(e, k.radius, w.miasmaInset);
  e.px = e.x;
  e.py = e.y;
  w.enemies.push(e);
  ev.push({ t: 'spawn', id: e.id, kind, x: e.x, y: e.y });
  return e;
}

/** 乾坤圈的放大倍数（飞得越远越大，悬停和折返时保持最大），定义在 weapons.ts。 */
export { ringGrowth } from './weapons.ts';

function startWave(w: World, ev: SimEvent[]) {
  w.phase = 'wave';
  w.waveT = 0;
  w.waveLen = waveDuration(w.wave);
  w.spawnAcc = 0;
  w.eliteDone = false;
  w.eliteMore = 0;
  w.surgeDone = false;
  w.boss = null;
  w.echo = null;
  w.miasmaInset = { x: 0, y: 0 };
  coopWaveStart(w, ev); // 联机：出局的人归队（coop.ts）
  // 用户：每波结束后人物不回原位，下一波从原地接着打
  for (const p of w.players) {
    p.px = p.x;
    p.py = p.y;
    p.charmUsed = {};
    p.ready = false;
    p.shield = 0;
    p.ringOut = false;
    p.corrode = 0; // 还没报出去的魔气掉血不跨波带着
    p.corrodeT = 0;
    for (const wpn of p.weapons) wpn.cd = 0.4 + w.rng.next() * 0.4;
    resetWeapons(p); // 上一波没打完的连击（火尖枪的第二枪）不带进这一波（weapons.ts）
    techWaveStart(w, p, ev); // 功法：吐纳术回血、计时清零（techniques.ts）
    relicWaveStart(w, p, ev); // 灵物、丹药：临时属性、乾坤袋、噬心蛊、夔牛鼓、计时清零（relics.ts）
  }
  w.cleared = 0;
  const boss = isBossWave(w.wave);
  ev.push({ t: 'waveStart', wave: w.wave, duration: boss ? 0 : w.waveLen });
  // 这一章（chapters.ts 的章节表）：地形每一波重新摆好（换章时换成新一章的，没有就清掉），首领波放出本章的首领
  const def = chapterOfWave(w.wave);
  const spawn: Spawn = (kind, x, y) => spawnAt(w, kind, x, y, ev);
  if (def.terrain) def.terrain.start(w, ev);
  else w.terrain = null;
  if (boss) {
    chiefModule(w).start(w, ev, spawn); // 这一章抽到的首领（bosspool.ts）
    scaleBoss(w); // 联机：首领气血按人数乘（coop.ts）
    jieBossStart(w); // 劫二起：首领气血也加（jie.ts）
  }
}

/** 波末收灵：每颗被吸过来的灵石按八折算（用户定）。 */
export const VACUUM_VALUE = 0.8;

/**
 * 波次结束：清场，然后进入「收灵」——场上所有灵石、掉落一口气飞向人物（灵石八折），收完再进升级与商店。
 * 用户：吸灵石、物品的画面要保留，速度不要太快也不要太慢，要有爽点；不要直接跳到商店。
 * 飞行按时间驱动（config.COLLECT）：再远的也一定飞得到；场上什么都没有也停一下（「平定」的停顿）。
 */
function endWave(w: World, ev: SimEvent[]) {
  coopWaveEnd(w, ev); // 联机：这一波打完时还倒在地上的人跟着出局，下一波开始时归队（coop.ts）
  relicWaveEnd(w, ev); // 灵物、丹药：临时属性减回去、冰心玉壶（relics.ts）
  xiuweiWaveEnd(w); // 修为「生息」（xiuwei.ts）
  const alive = w.players.filter((x) => x.alive);
  // 场上还有聚灵符：它和灵石一起飞过来，这一波收的灵石都按它吸来的算（× DROPS.magnetBonus，正好把八折补回十成）
  const magnet = w.drops.some((d) => d.kind === 'magnet') ? DROPS.magnetBonus : 1;
  for (const g of w.gems) {
    let best = alive[0] ?? w.players[0];
    for (const p of alive) if ((p.x - g.x) ** 2 + (p.y - g.y) ** 2 < (best.x - g.x) ** 2 + (best.y - g.y) ** 2) best = p;
    // 战斗中已经被聚灵符吸过的（mag）不打折、也不再加一次；功法「聚灵阵」不打折
    if (!g.vac && !g.mag) {
      g.value *= techVacuum(best, VACUUM_VALUE) * magnet;
      if (magnet !== 1) g.mag = true;
    }
    g.vac = true;
    g.pulled = best.id;
    g.fly = undefined; // 从现在的位置重新起飞（collectGems 里按到人物的距离定飞行时长）
  }
  for (const p of w.players) flushCorrode(p, ev); // 这一波最后那一点魔气掉血先报掉，不带进下一波
  terrainModule(w)?.clear(w, ev); // 地形：亮着的阵熄掉、还没落的雷取消（阵台留着）
  guestWaveEnd(w, ev); // 遭遇战：这一波没打倒的退走（bosspool.ts）
  w.enemies = [];
  for (const p of w.players) heroWaveEnd(p); // 角色身上没走完的（云霄斗里的、水里卷着的敌人）跟着清掉（heroes/）
  w.orbs = [];
  w.rings = [];
  w.knives = [];
  w.pending = [];
  w.zones = [];
  w.patches = [];
  vacuumDrops(w); // 场上的掉落（宝匣、蟠桃、聚灵符）和灵石一起飞向人物，飞到了照常生效
  ev.push({ t: 'waveEnd', wave: w.wave });
  w.phase = 'collect';
  w.collectT = 0;
  w.collectUntil = COLLECT.min;
}

/** 收灵结束：进入升级与商店。 */
function openShop(w: World, ev: SimEvent[]) {
  // 兜底（收灵超时才会走到）：还没飞到的灵石、掉落直接算给它正飞向的人
  for (const g of w.gems) gainGem(w, w.players[g.pulled] ?? w.players[0], g.value, ev);
  w.gems = [];
  lootRemaining(w, ev);
  w.phase = 'shop';
  ev.push({ t: 'shopOpen', wave: w.wave });
  for (const p of w.players) {
    p.buffs = { gem: 0, rage: 0 }; // 丹药只管一波
    p.rerolls = 0;
    p.ready = false;
    if (reviveAtShop(p)) {
      // 单人和首领同一帧倒下（打赢了）：在商店里复活。联机出局的人不在这里复活，等下一波开始时归队（coop.ts）
      p.alive = true;
      p.hp = Math.ceil(p.stats.maxHp * 0.3);
    }
    if (p.pendingLevels > 0) p.levelOffers = makeLevelOffers(w, p);
    p.petOffer = petEvolveOffer(p); // 宠物进化：到了 5 / 10 / 15 级还没进化的（shop.ts）
    offerTechnique(w, p); // 功法：到了门槛（techniques.TECH_LEVELS）就出三选一
    syncOffers(w, p, true); // 上一波锁住的货：手里那件法宝中途升过阶的，按现在的品阶重新定价（shop.ts）
    restock(w, p);
  }
}

/** 把还没报出去的魔气掉血报掉：攒够半点气血才报一条（免得满屏的「1」）；all 时不够半点的零头也清掉。 */
function flushCorrode(p: Player, ev: SimEvent[], all = true) {
  if (p.corrode >= 0.5) {
    ev.push({ t: 'corrode', owner: p.id, x: p.x, y: p.y, dmg: p.corrode, depth: p.miasma });
    p.corrode = 0;
  } else if (all) p.corrode = 0;
  p.corrodeT = 0;
}

/** 捡到一颗灵石：联机时全队每人各得一份（coop.gemShares），单人就是捡到的这个人。劫数高的灵石多几成（jie.ts；经验不变）。 */
function gainGem(w: World, p: Player, value: number, ev: SimEvent[]) {
  const ls = jieLingshi(w);
  const xs = jieXp(w); // 劫数越高，灵石、经验越少（jie.ts）
  for (const [q, v] of gemShares(w, p, value)) credit(q, v, ev, ls, xs);
}

/** 记进一个人的账：灵石（零头攒着，ls 是灵石的倍率）和经验，攒够就升级（波次结束后统一选属性）。 */
function credit(p: Player, value: number, ev: SimEvent[], ls = 1, xs = 1) {
  const v = value * (1 + p.buffs.gem);
  p.lingshiAcc += v * ls * heroGemMul(p) * ECON.lingshi; // 赵公明「招财」：灵石 +15%、经验照旧（heroes/passives.ts；别的角色乘的是 1）
  const whole = Math.floor(p.lingshiAcc + 1e-9);
  p.lingshi += whole;
  p.lingshiAcc -= whole;
  p.xp += v * xs;
  while (p.xp >= xpToNext(p.level)) {
    p.xp -= xpToNext(p.level);
    p.level++;
    p.pendingLevels++;
    p.stats.maxHp += 1; // 同土豆兄弟：每升一级气血上限 +1
    p.hp += 1;
    ev.push({ t: 'levelup', owner: p.id, level: p.level });
  }
}

/** 推进一帧（DT 秒）。inputs[i] 对应 players[i]；commands 是商店阶段的指令。返回这一帧产生的事件。 */
export function step(w: World, inputs: PlayerInput[], commands: Command[] = []): SimEvent[] {
  const ev: SimEvent[] = [];
  w.tick++;
  if (w.phase === 'over' || w.phase === 'win') return ev;
  if (w.phase === 'shop') {
    for (const c of commands) applyCommand(w, c, ev);
    if (shopDone(w)) {
      // 在场的人都按了出战（联机：掉线托管的、离开的不等，coop.ts）
      w.wave++;
      startWave(w, ev);
    }
    return ev;
  }

  if (w.phase === 'collect') {
    w.time += DT;
    w.collectT += DT;
    for (const o of [...w.players, ...w.gems]) {
      o.px = o.x;
      o.py = o.y;
    }
    for (const p of w.players) updatePet(w, p, DT, ev);
    const gems = w.gems.length;
    const drops = w.drops.length;
    collectGems(w, ev);
    updateDrops(w, DT, ev);
    // 每收下一件，进商店的时刻就往后顺一点：最后那一下（灵石入手、宝匣开盖）要看得见，不是东西一到就切走
    if (w.gems.length < gems) w.collectUntil = Math.max(w.collectUntil, w.collectT + COLLECT.tail);
    if (w.drops.length < drops) w.collectUntil = Math.max(w.collectUntil, w.collectT + COLLECT.tailDrop);
    const done = !w.gems.length && !w.drops.length && w.collectT >= w.collectUntil - 1e-9;
    if (done || w.collectT >= COLLECT.max) openShop(w, ev);
    return ev;
  }

  w.time += DT;
  w.waveT += DT;
  const rng = w.rng;
  for (const o of [...w.players, ...w.enemies, ...w.rings, ...w.gems, ...w.orbs]) {
    o.px = o.x;
    o.py = o.y;
  }

  // ---- 玩家：移动、魔气、回复、法宝、宠物、神通 ----
  for (const p of w.players) {
    if (!p.alive) {
      heroIdle(w, p, ev); // 倒下、出局、离开的人手里攥着的放掉（云霄：斗里的敌人掉出来；heroes/）
      continue;
    }
    const inp = inputs[p.id] ?? { mx: 0, my: 0, skill: false };
    let mx = inp.mx;
    let my = inp.my;
    if (p.root) {
      // 被姚天君的魂线定住：这一会儿走不动（法宝、神通照常）
      p.root = Math.max(0, p.root - DT);
      mx = my = 0;
    }
    if (bodyHeld(p)) mx = my = 0; // 神通托着身子走（雷震子「风雷翅」的俯冲；位置在 updateHero 里给）
    const m = Math.hypot(mx, my);
    if (m > 1) {
      mx /= m;
      my /= m;
    }
    p.moving = m > 0.15;
    p.still = p.moving ? 0 : p.still + DT;
    const mres = relicMiasma(p); // 灵物「桃木簪」：魔气的减速与侵蚀减半（relics.ts）
    const slow = 1 - MIASMA.slowMax * Math.pow(p.miasma, MIASMA.slowCurve) * mres;
    // relicSpeed：踏云履、遁地符、神行符的加速（relics.ts）；地形：红水阵里走不快；红沙上走不快（雷震子「生翅」不吃这两样：heroes/passives.ts）
    const fly = groundFree(p);
    const sp = PLAYER.speed * (1 + p.stats.speed + relicSpeed(p)) * slow * (w.terrain && !fly ? terrainSpeedMul(w, p) : 1) * (w.patches.length && !fly ? sandSpeedMul(w, p) : 1);
    p.x += mx * sp * DT;
    p.y += my * sp * DT;
    if ((p.blowX || p.blowY) && heroSteady(w, p)) p.blowX = p.blowY = 0; // 孙悟空「法天象地」期间站得稳，不吃吹开（heroes/passives.ts）
    if (p.blowX || p.blowY) {
      // 被风吼妖吹开：额外的速度，很快衰减
      p.x += (p.blowX ?? 0) * DT;
      p.y += (p.blowY ?? 0) * DT;
      const k = Math.exp(-DT * 7);
      p.blowX = Math.abs((p.blowX ?? 0) * k) < 1 ? 0 : (p.blowX ?? 0) * k;
      p.blowY = Math.abs((p.blowY ?? 0) * k) < 1 ? 0 : (p.blowY ?? 0) * k;
    }
    const bonus = heroSpeed(w, p); // 角色的被动给的移速（杨戬「乘隙」：暴击后加速；heroes/passives.ts），没有就是 0
    if (bonus) {
      p.x += mx * sp * bonus * DT;
      p.y += my * sp * bonus * DT;
    }
    clampOuter(p, PLAYER.radius, w.miasmaInset);
    p.miasma = miasmaDepth(p.x, p.y, w.miasmaInset);
    // 首领已经倒下（倒下的表现还在放、压进来的魔气正在退）：这一仗打完了，魔气只减速、不再掉血 —— 不能赢了又被耗死
    if (p.miasma > 0 && w.boss?.state !== 'dead') {
      const pct = MIASMA.drainMin + (MIASMA.drainMax - MIASMA.drainMin) * p.miasma * p.miasma;
      const dmg = p.stats.maxHp * pct * DT * hurtMul(p) * mres; // 联机：掉线托管中减半（coop.ts；平常是 1）
      p.hp -= dmg;
      p.corrode += dmg;
      p.corrodeT += DT;
      if (p.corrodeT >= MIASMA.report - 1e-9) {
        ev.push({ t: 'corrode', owner: p.id, x: p.x, y: p.y, dmg: p.corrode, depth: p.miasma });
        p.corrode = 0;
        p.corrodeT = 0;
      }
      if (p.hp <= 0 && !techSave(w, p, ev)) {
        // 功法「莲花化身」能救就不倒下（techniques.ts）；单人倒下就陨落，联机是倒地等人扶（coop.ts）
        flushCorrode(p, ev);
        downPlayer(w, p, ev);
        continue;
      }
    } else if (p.corrodeT > 0 || p.corrode >= 0.5) {
      // 离开魔气：短暂踏进去（不到半秒）掉的血也要报出来，不能并进下一次进魔气时的第一条。不够半点的零头留着，攒够了再报
      flushCorrode(p, ev, false);
    }
    if (mx > 0.1) p.facing = 1;
    else if (mx < -0.1) p.facing = -1;
    p.iframes = Math.max(0, p.iframes - DT);
    const ec = elementCounts(p);
    let regen = p.stats.regen + (ec.wood >= 2 ? 0.6 : 0);
    if (p.boon?.lowRegen && p.hp < p.stats.maxHp * 0.3) regen += p.boon.lowRegen; // 修为「三花聚顶」（xiuwei.ts）
    // 负的回复（血魔珠）最多把气血扣到 1 点：不会扣到 0 以下还照常打，也不会把人耗死
    const hp = Math.min(p.stats.maxHp, p.hp + regen * DT);
    p.hp = regen < 0 ? Math.max(Math.min(p.hp, 1), hp) : hp;

    updateWeapons(w, p, DT, ev);
    updatePet(w, p, DT, ev);
    updateWuxing(w, p, DT, ev); // 五行三件档：木的藤蔓冷却、土的站稳震地（wuxing.ts）
    updateTechniques(w, p, DT, ev); // 功法：风火轮火痕、五雷正法（techniques.ts）
    updateRelics(w, p, DT, ev); // 灵物、符箓：风火蒲团、照妖镜、夔牛鼓、引雷符（relics.ts）

    if (inp.skill && p.skill >= 1) {
      p.skill = 0;
      castSkill(w, p, ev); // 神通按角色分派（heroes/）：哪吒「三头六臂」、杨戬「天眼」
      relicSkill(w, p, ev); // 灵物、符箓：燃魂香、回灵符（relics.ts）
      techSkill(w, p, ev); // 功法：掌心雷、太乙真诀（techniques.ts）
    }
    updateHero(w, p, DT, ev); // 神通持续的那一部分（天眼的一扫）
  }

  // ---- 联机：倒地的人有没有队友在扶、倒计时、出局（coop.ts；单人什么都不做） ----
  updateCoop(w, DT, ev);

  // ---- 刷怪：都刷在屏幕外（所有活着的人物的镜头外）、魔气带外沿以内；位置怎么挑见 spawn.ts ----
  const alive = w.players.filter((p) => p.alive);
  const cams = cameras(w, alive); // 刷怪要躲开的镜头：活着的人，联机时再加上倒在地上等人扶的（coop.ts）
  const k = Math.min(1, w.waveT / w.waveLen);
  if (alive.length && !isBossWave(w.wave)) {
    w.spawnAcc += spawnRate(w.wave, k) * spawnMul(w) * DT; // 联机按人数多刷（coop.ts；单人倍率是 1）
    while (w.spawnAcc >= 1) {
      w.spawnAcc -= 1;
      if (w.enemies.length + heldOff(w) >= SPAWN.maxEnemies) break; // 云霄斗里的那几只也算在场（heroes/）
      const p = alive[Math.floor(rng.next() * alive.length)];
      const kind = spawnKind(w); // 出场节奏：这一波刷哪几种、各占多少（enemies.ts）
      const q = spawnSpot(w, p, cams, ENEMIES[kind].radius, SPAWN.out[0], SPAWN.out[1]);
      spawnAt(w, kind, q.x, q.y, ev);
    }
    const elites = eliteCount(w.wave) + jieElites(w) + movedElites(w); // 第一章有遭遇战时，第 4 波原来的那只精英挪到第 3 波（bosspool.ts） // 本章第 4 波（第二、三章还有第 2 波，catalog.eliteCount）；劫三起每个普通波多一只（jie.ts）
    if (elites && !w.eliteDone && k >= 0.35) {
      w.eliteDone = true;
      const guest = guestAt(w); // 本章第 4 波：池里没当首领的那一位来遭遇战（bosspool.ts）
      const gm = guest && !WAVE_ELITES[w.wave] ? bossById(guest) : null; // 按波次换精英的口子登记了的那一波，听口子的（elites/）
      if (gm) {
        // 本章原来那一两只精英换成它；劫三起多出来的那只精英照常贴着屏幕边刷（先刷，再让它现身）
        spawnExtraElites(w, alive[0], cams, elites, ev);
        gm.start(w, ev, (kind, x, y) => spawnAt(w, kind, x, y, ev), true);
      } else spawnElites(w, alive[0], cams, elites, ev); // 贴着屏幕边刷；按章挑哪一种精英、抽词缀（elites/）
    }
    // 另外陆续来的精英（catalog.ELITE_FLOW）：本章第 from 波起每个普通波在几处各来一批；有遭遇战的那一波不加
    const more = w.eliteMore ?? 0;
    const flowAt = eliteFlowAt(w.wave);
    if (waveInChapter(w.wave) >= ELITE_FLOW.from && more < flowAt.length && k >= flowAt[more] && !guestAt(w)) {
      w.eliteMore = more + 1;
      spawnElites(w, alive[0], cams, ELITE_FLOW.n, ev);
    }
    if (w.wave >= SURGE.from && !w.surgeDone && k >= 0.6) {
      w.surgeDone = true;
      // 包围：贴着屏幕外沿刷一整圈，从四边一起冲进来，冲到合围圈上再慢慢合拢（catalog.SURGE）。联机时每个活着的人各围一圈（coop.ts）
      for (const [p, n] of surgeRings(w, alive, SURGE.base + w.wave)) {
        ev.push(alive.length > 1 ? { t: 'surge', x: p.x, y: p.y, owner: p.id } : { t: 'surge', x: p.x, y: p.y });
        for (const q of surgeSpots(w, p, cams, ENEMIES.soldier.radius, n)) spawnAt(w, 'soldier', q.x, q.y, ev).rush = SURGE.rushMax;
      }
    }
  }
  // ---- 地形（这一章有的话）：轮转、落雷、红水、阵边刷兵（chapters.ts 的 TerrainModule） ----
  const spawn: Spawn = (kind, x, y) => spawnAt(w, kind, x, y, ev);
  terrainModule(w)?.update(w, alive, ev, spawn);
  // ---- 首领（按章节表分派，第一章是「魔化哪吒」，见 boss.ts）：招式、预警与判定、换阶段、零星刷兵 ----
  bossModule(w)?.update(w, alive, ev, spawn);
  jieTick(w); // 劫五：首领三阶段狂暴（jie.ts）
  guestModule(w)?.update(w, alive, ev, spawn); // 遭遇战：同一个首领模块的另一种打法（这一波没有就什么都不做）

  // ---- 敌人：状态、移动（朝最近的玩家直走，可预测）、远程怪蓄力 ----
  buildGrid(w.enemies);
  for (let i = 0; i < w.enemies.length; i++) {
    const e = w.enemies[i];
    if (e.hp <= 0) continue;
    tickStatus(w, e, DT, ev);
    if (e.hp <= 0) continue;
    if (e.kind === 'boss') continue; // 首领的移动由 boss.ts 控制
    const kd = ENEMIES[e.kind];
    let target: Player | null = null;
    let bd = 1e18;
    for (const p of alive) {
      const d = (p.x - e.x) ** 2 + (p.y - e.y) ** 2;
      if (d < bd) {
        bd = d;
        target = p;
      }
    }
    const scared = feared(w, e); // 赵公明 · 黑虎「震慑」：吓住的敌人不追人、不起手，转身往外逃（heroes/passives.ts）
    if (scared) target = null;
    let vx = 0;
    let vy = 0;
    if (e.rush) {
      // 包围的兵：还在合围圈外就冲（不吃自己的慢速，照样吃减速和控制）；进了圈、冲够了时间就恢复平常的速度
      e.rush = Math.max(0, e.rush - DT);
      if (!target || ((target.x - e.x) / SURGE.ring.x) ** 2 + ((target.y - e.y) / SURGE.ring.y) ** 2 <= 1) e.rush = 0;
    }
    if (target && e.stun <= 0) {
      const d = Math.sqrt(bd) || 1;
      const ux = (target.x - e.x) / d;
      const uy = (target.y - e.y) / d;
      const spd = (e.rush ? Math.max(e.speed, SURGE.rush) : e.speed) * (1 - e.slow) * (e.wardT ? 1 + (e.haste ?? 0) : 1); // 第二章：落魂幡手的增益走得快
      if (e.kind !== 'caster') {
        vx = ux * spd;
        vy = uy * spd;
      } else {
        const side = e.id % 2 ? 1 : -1;
        const k2 = d < CASTER.keepMin ? -1 : d > CASTER.keepMax ? 1 : 0;
        if (e.cast <= 0) {
          vx = (ux * k2 + -uy * side * 0.6) * spd;
          vy = (uy * k2 + ux * side * 0.6) * spd;
        }
        e.cd -= DT;
        if (e.cast > 0) {
          e.cast -= DT;
          if (e.cast <= 0) {
            const sx = e.x + (target.x >= e.x ? 6 : -6);
            const sy = e.y - 16;
            const dd = Math.hypot(target.x - sx, target.y - 8 - sy) || 1;
            const o: Orb = { id: w.nextId++, x: sx, y: sy, px: sx, py: sy, vx: ((target.x - sx) / dd) * CASTER.orbSpeed, vy: ((target.y - 8 - sy) / dd) * CASTER.orbSpeed, life: CASTER.orbLife, dmg: CASTER.orbDamage * e.dmgMul };
            w.orbs.push(o);
            fasterOrb(w, o); // 劫四起鬼火飞得快（jie.ts）
            ev.push({ t: 'orb', id: o.id, x: sx, y: sy });
            e.cd = range(rng, CASTER.cooldown[0], CASTER.cooldown[1]);
          }
        } else if (e.cd <= 0 && d < 260) {
          e.cast = CASTER.windup;
          ev.push({ t: 'cast', id: e.id, x: e.x, y: e.y });
        }
      }
    }
    [vx, vy] = actEnemy(w, e, target, vx, vy, ev); // 新敌人的蓄力、冲锋、引信、举盾（enemies.ts）；原有的几种原样返回
    if (scared && e.stun <= 0) [vx, vy] = fleeVel(e);
    else if (e.stun <= 0 && teased(w, e)) [vx, vy] = teaseVel(w, e, vx, vy); // 孙悟空 · 毫毛猴「戏弄」：走路乱晃（heroes/passives.ts）
    let sx = 0;
    let sy = 0;
    forNear(w.enemies, e.x, e.y, 16, (j) => {
      if (j === i) return;
      const o = w.enemies[j];
      const dx = e.x - o.x;
      const dy = e.y - o.y;
      const minD = kd.radius + ENEMIES[o.kind].radius;
      const d2 = dx * dx + dy * dy;
      if (d2 > 0 && d2 < minD * minD) {
        const d = Math.sqrt(d2);
        const push = (minD - d) / minD;
        sx += (dx / d) * push;
        sy += (dy / d) * push;
      }
    });
    e.x += (vx + (sx * 40) / kd.mass + e.kx) * DT;
    e.y += (vy + (sy * 40) / kd.mass + e.ky) * DT;
    const decay = Math.exp(-DT * 9);
    e.kx *= decay;
    e.ky *= decay;
    clampOuter(e, kd.radius, w.miasmaInset);
  }

  // ---- 鬼火：直线飞，碰到玩家造成伤害（第三章截教门徒的剑气也在这里：前一段会拐弯，见 ch3/foes.ts） ----
  for (let i = w.orbs.length - 1; i >= 0; i--) {
    const o = w.orbs[i];
    if (o.bend) steerOrb(w, o);
    o.x += o.vx * DT;
    o.y += o.vy * DT;
    o.life -= DT;
    let gone = o.life <= 0;
    for (const p of alive) {
      if (gone || !p.alive) break;
      const r = CASTER.orbRadius + PLAYER.radius;
      if ((p.x - o.x) ** 2 + (p.y - 8 - o.y) ** 2 > r * r) continue;
      gone = true;
      hurtPlayer(w, p, o.dmg, o.by ?? 'orb', ev);
    }
    if (gone) w.orbs.splice(i, 1);
  }

  // ---- 接触伤害 ----
  for (const p of alive) {
    if (p.iframes > 0 || !p.alive) continue;
    for (const e of w.enemies) {
      if (e.hp <= 0 || e.stun > 0 || e.kind === 'boss' || e.hidden) continue; // 首领的接触伤害在 boss.ts 里算；潜在水里的夜叉碰不着（elites/）
      const kd = ENEMIES[e.kind];
      if (kd.contact <= 0) continue; // 不伤人的（首领插的落魂幡、草人）
      const r = kd.radius + PLAYER.radius;
      if (Math.abs(e.x - p.x) > r || Math.abs(e.y - p.y) > r) continue;
      if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 > r * r) continue;
      hurtPlayer(w, p, kd.contact * e.dmgMul * fearDmgMul(w, e), 'contact', ev); // 被黑虎震慑的打人轻一些（heroes/passives.ts；平常是 1）
      const d = Math.hypot(e.x - p.x, e.y - p.y) || 1;
      e.kx += ((e.x - p.x) / d) * 160;
      e.ky += ((e.y - p.y) / d) * 160;
      break;
    }
  }

  // ---- 乾坤圈、飞刀、延时效果、地面区域（weapons.ts / zones.ts） ----
  updateRings(w, DT, ev);
  updateKnives(w, DT, ev);
  updatePending(w, DT, ev);
  updateZones(w, DT, ev);
  updatePatches(w, DT); // 第二章：红沙到时消失

  // 首领：这一帧的伤害都结算完了，再看要不要换阶段（跨过阈值就卡在阈值上，不跳阶段）或倒下
  bossModule(w)?.check(w, ev);
  guestModule(w)?.check(w, ev); // 遭遇战：换阶段、倒下
  // 清掉死掉的敌人
  if (w.enemies.some((e) => e.hp <= 0)) w.enemies = w.enemies.filter((e) => e.hp > 0);
  if (guestModule(w)?.defeated(w)) w.echo = null; // 遭遇战倒下的表现放完：收掉，这一波照常打完
  // 首领倒下的表现放完：最后一章就通关，否则这一章平定，收灵之后进下一章前的商店
  if (bossModule(w)?.defeated(w)) {
    w.boss = null;
    w.miasmaInset = { x: 0, y: 0 };
    const chapter = chapterOf(w.wave);
    if (chapter >= CHAPTERS) {
      w.phase = 'win';
      ev.push({ t: 'win' });
      return ev;
    }
    ev.push({ t: 'chapterClear', chapter });
    endWave(w, ev);
    w.cleared = chapter;
    return ev;
  }

  // ---- 灵石：先散开、再被吸走；战场掉落：走近自动拾取 ----
  collectGems(w, ev);
  updateDrops(w, DT, ev);

  // ---- 胜负与波次推进 ----
  // 首领已经倒下（正在放倒下的表现）就不再判负：和首领同一帧倒下也算打赢，人在之后的商店里复活（最后一章直接通关）
  if (w.players.every((p) => !p.alive) && w.boss?.state !== 'dead') {
    w.phase = 'over';
    ev.push({ t: 'over' });
    return ev;
  }
  if (!isBossWave(w.wave) && w.waveT >= w.waveLen) endWave(w, ev);
  return ev;
}

/**
 * 灵石：先散开、再被吸走；波末收灵时被一口气吸过来 —— 从静止匀加速飞向人物（近的先到、远的后到），
 * 按时间驱动（drops.collectFlight）：再远也一定飞得到，不会飞到一半商店就开了。
 */
function collectGems(w: World, ev: SimEvent[]) {
  const alive = w.players.filter((p) => p.alive);
  for (let i = w.gems.length - 1; i >= 0; i--) {
    const g = w.gems[i];
    if (g.vac) {
      const p = w.players[g.pulled] ?? w.players[0];
      if (!g.fly) {
        // 起飞：已经在朝人物飞的（正被吸过来的）接着那个速度往下加速，不会先顿一下
        const d = Math.hypot(p.x - g.x, p.y - 6 - g.y) || 1;
        g.fly = collectFlight(g.x, g.y, p.x, p.y - 6, COLLECT.gem, Math.max(0, (g.vx * (p.x - g.x) + g.vy * (p.y - 6 - g.y)) / d));
        g.vx = g.vy = 0;
      }
      if (!flyStep(g, g.fly, p.x, p.y - 6, DT)) continue;
      gainGem(w, p, g.value, ev);
      ev.push({ t: 'pickup', owner: p.id, x: g.x, y: g.y, value: g.value });
      w.gems.splice(i, 1);
      continue;
    }
    g.vx *= Math.exp(-DT * 6);
    g.vy *= Math.exp(-DT * 6);
    if (g.pulled < 0) {
      for (const p of alive) if ((p.x - g.x) ** 2 + (p.y - 4 - g.y) ** 2 < (PLAYER.magnetRadius * (1 + p.stats.pickup)) ** 2) g.pulled = p.id;
    }
    if (g.pulled >= 0) {
      const p = w.players[g.pulled];
      const dx = p.x - g.x;
      const dy = p.y - 6 - g.y;
      const d = Math.hypot(dx, dy) || 1;
      const sp = 140 + Math.max(0, 200 - d * 2);
      g.vx += ((dx / d) * sp - g.vx) * Math.min(1, DT * 10);
      g.vy += ((dy / d) * sp - g.vy) * Math.min(1, DT * 10);
      if (d < PLAYER.pickupRadius) {
        gainGem(w, p, g.value, ev);
        ev.push({ t: 'pickup', owner: p.id, x: g.x, y: g.y, value: g.value });
        relicPickup(w, p, ev); // 灵物「踏云履」（relics.ts）
        w.gems.splice(i, 1);
        continue;
      }
    }
    g.x += g.vx * DT;
    g.y += g.vy * DT;
  }
}

/** 状态摘要，测试和（以后的）联机校验用。 */
export function digest(w: World): string {
  const r = (v: number) => Math.round(v * 100);
  const parts: (string | number)[] = [w.tick, w.phase, w.wave, w.enemies.length, w.gems.length, w.rings.length, w.orbs.length, w.rng.state];
  for (const p of w.players) parts.push(r(p.x), r(p.y), r(p.hp), p.kills, r(p.xp), p.level, p.lingshi, p.weapons.map((x) => x.kind + x.tier).join('|'));
  for (const e of w.enemies) parts.push(e.id, r(e.x), r(e.y), e.hp);
  return parts.join(',');
}

export { WEAPONS };
