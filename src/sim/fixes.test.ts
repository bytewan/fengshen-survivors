// 这一轮审查发现（SIM-01 … UX-03）的回归测试：每条修复至少一个用例，名字前面带发现的编号。
// 都是模拟层的测试（纯 TS，不碰浏览器）；数值从 config / catalog 里取，改数值不用改这里。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createWorld, spawnAt, spawnEnemy, step, VACUUM_VALUE, type Phase, type PlayerInput, type SimEvent, type World } from './world.ts';
import { ARENA, BOSS, COLLECT, DROPS, DT, ENEMIES, MIASMA, SPAWN, VIEW } from './config.ts';
import { ECON, ELITE_FLOW, PET_BRANCH, RELICS, SURGE, WEAPONS, priceScale, waveDuration } from './catalog.ts';
import { buildGrid, hitEnemy, tickStatus } from './core.ts';
import { collectFlight, loot } from './drops.ts';
import { addFragment, applyCommand, buy, PET_LEVELS, petEvolveOffer, restock, spiritPair } from './shop.ts';
import { canSpawnAt, inBounds, outOfView, spawnSpot, surgeSpots } from './spawn.ts';
import { bossEnemy } from './boss.ts';
import { botInput, botShop } from './bot.ts';
import { TECH_LEVELS, TECHNIQUES } from './techniques.ts';
import type { Drop, DropKind, Enemy, EnemyKindName, Gem, Player, ShopOffer, TechniqueId } from './types.ts';

const idle: PlayerInput = { mx: 0, my: 0, skill: false };
/** 现在在哪个阶段（经函数读一下：断言过 w.phase 之后 TS 会把它收窄成那个值，后面再比别的阶段就报错）。 */
const phaseOf = (w: World): Phase => w.phase;
const run = (w: World, seconds: number, input: (w: World) => PlayerInput = () => idle) => {
  const events: SimEvent[] = [];
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) events.push(...step(w, [input(w)]));
  return events;
};
/** 普通波里关掉刷怪。 */
const quiet = (w: World) => {
  w.wave = 3;
  w.waveLen = 1e9;
  w.spawnAcc = -1e12;
  w.eliteDone = true;
  w.surgeDone = true;
};
/** 干净的测试场：刷怪关掉、不带法宝、宠物不出手、人物无敌。 */
const arena = (seed: number) => {
  const w = createWorld(seed);
  quiet(w);
  const p = w.players[0];
  p.weapons = [];
  p.pet.cd = 1e12;
  p.iframes = 1e12;
  return { w, p };
};
const enemy = (w: World, kind: EnemyKindName, x: number, y: number, hp = 9999) => {
  const e = spawnEnemy(w, kind, x, y, []);
  e.hp = e.maxHp = hp;
  e.speed = 0;
  e.x = e.px = x;
  e.y = e.py = y;
  return e;
};
const gemAt = (w: World, x: number, y: number, value = 1): Gem => {
  const g: Gem = { id: w.nextId++, x, y, px: x, py: y, vx: 0, vy: 0, value, pulled: -1 };
  w.gems.push(g);
  return g;
};
const dropAt = (w: World, kind: DropKind, x: number, y: number, rich = false): Drop => {
  const d: Drop = { id: w.nextId++, kind, x, y, px: x, py: y, t: 0, life: DROPS.life, ...(rich ? { rich } : {}) };
  w.drops.push(d);
  return d;
};
/** 让这一波下一帧就结束（进入收灵）。 */
const endWaveNow = (w: World) => {
  w.waveLen = w.waveT + DT;
};
/** 从波末跑到商店打开：返回全部事件、收灵用了多久，以及商店打开前一帧场上还剩几件没收完的（应该是 0：没有东西被凭空结算）。 */
function collect(w: World) {
  const ev: SimEvent[] = [];
  const at: { t: string; time: number; e: SimEvent }[] = [];
  let leftover = -1;
  let frames = 0;
  for (let i = 0; i < 60 * 20 && w.phase !== 'shop'; i++) {
    const before = w.gems.length + w.drops.length;
    const phase = w.phase;
    const out = step(w, [idle]);
    if (phase === 'collect') frames++;
    for (const e of out) at.push({ t: e.t, time: w.collectT, e });
    if (out.some((e) => e.t === 'shopOpen')) leftover = before - out.filter((e) => e.t === 'pickup' || e.t === 'loot').length;
    ev.push(...out);
  }
  assert.equal(w.phase, 'shop', '收灵之后进了商店');
  return { ev, at, leftover, seconds: frames * DT };
}
/** 敌人站在 (x, y) 时在不在镜头里（按镜头本身的矩形算，不带余量）。 */
const onScreen = (p: { x: number; y: number }, x: number, y: number) => Math.abs(x - p.x) < VIEW.w / 2 && y > p.y - VIEW.lift - VIEW.h / 2 && y < p.y - VIEW.lift + VIEW.h / 2;

// ---------------------------------------------------------------- SIM-01 刷怪不能凭空出现在屏幕里

const STANDS: [string, number, number][] = [
  ['场心', ARENA.w / 2, ARENA.h / 2],
  ['离左墙 40 像素', 54, 270],
  ['贴左墙', 22, 270],
  ['左上角', 30, 30],
  ['右下角', ARENA.w - 30, ARENA.h - 30],
  ['上边缘', 480, 8],
  ['魔气里（左外沿）', -60, 270],
];

test('SIM-01 常规刷怪、精英、包围都刷在屏幕外、魔气带外沿以内：人物在场心、靠墙、贴墙、角落、魔气里都一样；没有一只刷在身边', () => {
  for (const [label, x, y] of STANDS) {
    const w = createWorld(71);
    const p = w.players[0];
    p.weapons = [];
    p.pet.cd = 1e12;
    p.iframes = 1e12;
    w.wave = 4; // 第 4 波：有精英（三成半时）、有包围（六成时），兵种也多
    w.waveLen = waveDuration(4);
    let n = 0;
    let elites = 0;
    let surge = 0;
    let nearest = Infinity;
    for (let i = 0; i < Math.round((w.waveLen - 0.5) / DT); i++) {
      p.x = p.px = x; // 人物站住不动
      p.y = p.py = y;
      p.hp = p.stats.maxHp;
      const ev = step(w, [idle]);
      const surged = ev.some((e) => e.t === 'surge');
      for (const e of ev) {
        if (e.t !== 'spawn') continue;
        n++;
        if (e.kind === 'elite') elites++;
        if (surged) surge++;
        const r = ENEMIES[e.kind].radius;
        assert.ok(!onScreen(p, e.x, e.y), `${label}：${e.kind} 刷在了镜头里 (${e.x.toFixed(0)}, ${e.y.toFixed(0)})`);
        assert.ok(outOfView(p, e.x, e.y) > 0, `${label}：${e.kind} 的精灵还露在屏幕里`);
        assert.ok(inBounds(w, e.x, e.y, r), `${label}：${e.kind} 刷到了硬边界外面`);
        nearest = Math.min(nearest, Math.hypot(e.x - x, e.y - y));
      }
    }
    assert.ok(n > 60, `${label}：刷了 ${n} 只`);
    assert.equal(elites, 1 + ELITE_FLOW.at[0].length * ELITE_FLOW.n, `${label}：精英照常来（另加陆续来的几批）`);
    assert.equal(surge, SURGE.base + 4, `${label}：包围的兵一只不少`);
    assert.ok(nearest > 150, `${label}：最近的一只也在 150 像素外（${nearest.toFixed(0)}），刷出来那一帧不可能撞人`);
  }
});

test('SIM-01 人物贴墙站着（不无敌）：没有哪只兵刷出来的那一帧就撞上人', () => {
  const w = createWorld(71);
  const p = w.players[0];
  p.weapons = [];
  p.pet.cd = 1e12;
  w.wave = 3;
  w.waveLen = 1e9;
  w.eliteDone = w.surgeDone = true;
  let spawns = 0;
  for (let i = 0; i < 60 * 60; i++) {
    p.x = p.px = 22;
    p.y = p.py = 270;
    p.hp = p.stats.maxHp;
    p.iframes = 0;
    const ev = step(w, [idle]);
    const born = ev.filter((e) => e.t === 'spawn');
    spawns += born.length;
    if (born.length) assert.ok(!ev.some((e) => e.t === 'hurt'), '刷怪的这一帧没有挨打');
    w.enemies = []; // 只看刚刷出来的
  }
  assert.ok(spawns > 80);
});

test('SIM-01 包围：贴着屏幕外沿刷一整圈、四面都有，冲到原来那么大的合围圈上就恢复平常的速度；靠墙、在角落时数量不少、都在界内', () => {
  const { w, p } = arena(72);
  w.wave = 2;
  w.waveLen = waveDuration(2);
  w.surgeDone = false;
  w.waveT = w.waveLen * 0.6;
  const ev = step(w, [idle]);
  assert.ok(ev.some((e) => e.t === 'surge'));
  const n = SURGE.base + 2;
  const ring = w.enemies.filter((e) => e.kind === 'soldier');
  assert.equal(ring.length, n);
  for (const e of ring) {
    assert.ok(outOfView(p, e.x, e.y) > 0 && !onScreen(p, e.x, e.y), '包围的兵刷在屏幕外');
    assert.ok((e.rush ?? 0) > 0, '带着冲刺');
  }
  // 四面都有：按方向排好，相邻两只之间的夹角不超过 60°
  const angs = ring.map((e) => Math.atan2(e.y - p.y, e.x - p.x)).sort((a, b) => a - b);
  for (let i = 0; i < angs.length; i++) {
    const gap = i ? angs[i] - angs[i - 1] : angs[0] + Math.PI * 2 - angs[angs.length - 1];
    assert.ok(gap < Math.PI / 3, `包围圈有缺口（${((gap * 180) / Math.PI).toFixed(0)}°）`);
  }
  // 冲进来：一秒多之后都到了合围圈上（原来就刷在这个 170 × 128 的椭圆上），之后按平常的速度合拢
  const norm = (e: Enemy) => Math.hypot((e.x - p.x) / SURGE.ring.x, (e.y - p.y) / SURGE.ring.y);
  let fastest = 0;
  for (let i = 0; i < Math.round(1.15 / DT); i++) {
    step(w, [idle]);
    for (const e of ring) fastest = Math.max(fastest, Math.hypot(e.x - e.px, e.y - e.py) / DT);
  }
  assert.ok(fastest > SURGE.rush * 0.9, `冲进来时跑得快（${fastest.toFixed(0)} 像素 / 秒）`);
  for (const e of ring) {
    assert.equal(e.rush, 0, '冲到了就不再冲');
    assert.ok(norm(e) <= 1.01 && norm(e) > 0.7, `停在合围圈上（${norm(e).toFixed(2)}）`);
  }
  step(w, [idle]);
  for (const e of ring) assert.ok(Math.hypot(e.x - e.px, e.y - e.py) / DT < e.speed + 45, '之后是平常的速度（加上互相挤开的那一点）');

  // 靠墙、在角落：一只不少，都在界内、都在屏幕外，不叠在同一个点上
  for (const [label, x, y] of STANDS.slice(1)) {
    const b = arena(73);
    b.p.x = b.p.px = x;
    b.p.y = b.p.py = y;
    const spots = surgeSpots(b.w, b.p, [b.p], ENEMIES.soldier.radius, 35);
    assert.equal(spots.length, 35, label);
    for (const q of spots) assert.ok(canSpawnAt(b.w, [b.p], q.x, q.y, ENEMIES.soldier.radius), `${label}：包围的兵要在界内、屏幕外`);
    assert.equal(new Set(spots.map((q) => `${q.x.toFixed(2)},${q.y.toFixed(2)}`)).size, 35, `${label}：没有两只叠在一起`);
  }
});

test('SIM-01 首领波的零星回响兵也刷在屏幕外：魔焰焚城把场地压小以后，从魔气里走出来', () => {
  for (const [px, py, inset] of [
    [480, 270, { x: 0, y: 0 }],
    [30, 270, { x: 0, y: 0 }],
    [480, 270, BOSS.inferno.max],
    [BOSS.inferno.max.x + 10, BOSS.inferno.max.y + 10, BOSS.inferno.max],
  ] as [number, number, { x: number; y: number }][]) {
    const w = createWorld(74);
    w.wave = 5;
    w.phase = 'shop';
    const p = w.players[0];
    p.weapons = [];
    p.pet.cd = 1e12;
    p.ready = true;
    step(w, [idle]);
    const f = w.boss!;
    assert.ok(f, '首领入场');
    run(w, BOSS.intro + 0.1);
    let n = 0;
    for (let i = 0; i < 60 * 8; i++) {
      w.miasmaInset = { ...inset };
      p.x = p.px = px;
      p.y = p.py = py;
      p.hp = p.stats.maxHp;
      p.iframes = 1e9;
      f.summonT = 0; // 每帧都召
      const ev = step(w, [idle]);
      for (const e of ev) {
        if (e.t !== 'spawn' || e.kind !== 'soldier') continue;
        n++;
        assert.ok(outOfView(p, e.x, e.y) > 0 && !onScreen(p, e.x, e.y), `人物在 (${px}, ${py})：首领召来的兵刷在了屏幕里`);
        assert.ok(inBounds(w, e.x, e.y, ENEMIES.soldier.radius), '在魔气带外沿以内（外沿跟着魔焰焚城往里收）');
      }
      w.enemies = w.enemies.filter((e) => e.kind === 'boss');
    }
    assert.ok(n > 50, `召了 ${n} 只`);
  }
});

test('SIM-01 刷怪点：随便站在哪儿都找得到屏幕外、界内的点；几个人的镜头把场地盖满时退而求其次，也不出界', () => {
  const w = createWorld(75);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 3000; i++) {
    const p = { x: -MIASMA.depth + 5 + rnd() * (ARENA.w + 2 * MIASMA.depth - 10), y: -MIASMA.depth + 5 + rnd() * (ARENA.h + 2 * MIASMA.depth - 10) };
    const r = i % 5 ? ENEMIES.soldier.radius : ENEMIES.elite.radius;
    const q = spawnSpot(w, p, [p], r, SPAWN.out[0], SPAWN.out[1]);
    assert.ok(canSpawnAt(w, [p], q.x, q.y, r), `人物在 (${p.x.toFixed(0)}, ${p.y.toFixed(0)})：刷怪点 (${q.x.toFixed(0)}, ${q.y.toFixed(0)}) 要在屏幕外、界内`);
  }
  // 魔焰焚城压到底、四个人把剩下的场地都看住了：没有谁都看不见的地方，取离镜头边最近（陷得最浅）的，仍然在界内
  w.miasmaInset = { ...BOSS.inferno.max };
  const four = [
    { x: 300, y: 190 },
    { x: 660, y: 190 },
    { x: 300, y: 350 },
    { x: 660, y: 350 },
  ];
  for (let i = 0; i < 50; i++) {
    const q = spawnSpot(w, four[i % 4], four, 6, SPAWN.out[0], SPAWN.out[1]);
    assert.ok(Number.isFinite(q.x) && Number.isFinite(q.y) && inBounds(w, q.x, q.y, 6), '退而求其次的点也在界内');
  }
});

test('SIM-01 刷怪点贴着屏幕外沿：各个方向来的差不多一样多（左、右、上、下都有），都是刚出屏幕、走几步就进来', () => {
  const w = createWorld(78);
  const p = { x: ARENA.w / 2, y: ARENA.h / 2 };
  const side = VIEW.w / 2 + SPAWN.margin.x;
  const up = VIEW.h / 2 + VIEW.lift + SPAWN.margin.top;
  const down = VIEW.h / 2 - VIEW.lift + SPAWN.margin.bottom;
  const from = { left: 0, right: 0, up: 0, down: 0 };
  const N = 4000;
  let dist = 0;
  for (let i = 0; i < N; i++) {
    const q = spawnSpot(w, p, [p], ENEMIES.soldier.radius, SPAWN.out[0], SPAWN.out[1]);
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const beyond = outOfView(p, q.x, q.y);
    assert.ok(beyond > 0 && beyond <= SPAWN.out[1] + 1e-6, `离屏幕外沿 ${beyond.toFixed(1)} 像素：在屏幕外、又不远`);
    dist += Math.hypot(dx, dy);
    // 从哪条边进来：沿着朝人物的方向先碰到哪条屏幕边
    if (Math.abs(dx) / side >= (dy < 0 ? -dy / up : dy / down)) from[dx < 0 ? 'left' : 'right']++;
    else from[dy < 0 ? 'up' : 'down']++;
  }
  for (const k of ['left', 'right'] as const) assert.ok(from[k] / N > 0.13 && from[k] / N < 0.22, `从${k === 'left' ? '左' : '右'}边来的 ${Math.round((from[k] / N) * 100)}%`);
  for (const k of ['up', 'down'] as const) assert.ok(from[k] / N > 0.27 && from[k] / N < 0.39, `从${k === 'up' ? '上' : '下'}边来的 ${Math.round((from[k] / N) * 100)}%`);
  assert.ok(dist / N > 235 && dist / N < 262, `平均离人物 ${(dist / N).toFixed(0)} 像素（原来刷在 250–320 的椭圆环上，平均约 242）`);
});

test('SIM-01 联机：谁的屏幕里都不能凭空冒出来 —— 在一个人身边挑的刷怪点，也不落在另一个人的镜头里', () => {
  const w = createWorld(77, 2);
  const [a, b] = w.players;
  a.x = a.px = 380;
  b.x = b.px = 620; // 两个人左右相隔 240：一个人的屏幕右沿外面，正是另一个人的屏幕中间
  a.y = a.py = b.y = b.py = 270;
  for (const p of [a, b]) {
    for (let i = 0; i < 400; i++) {
      const q = spawnSpot(w, p, w.players, ENEMIES.soldier.radius, SPAWN.out[0], SPAWN.out[1]);
      assert.ok(outOfView(a, q.x, q.y) > 0 && outOfView(b, q.x, q.y) > 0, `(${q.x.toFixed(0)}, ${q.y.toFixed(0)}) 落在了某个人的屏幕里`);
    }
    for (const q of surgeSpots(w, p, w.players, ENEMIES.soldier.radius, 24)) assert.ok(outOfView(a, q.x, q.y) > 0 && outOfView(b, q.x, q.y) > 0, '包围的兵也一样');
  }
  // 真跑一段：两个人各站一边不动，刷出来的兵都在两个人的镜头外
  w.wave = 3;
  w.waveLen = 1e9;
  w.eliteDone = w.surgeDone = true;
  let n = 0;
  for (let i = 0; i < 60 * 20; i++) {
    for (const p of w.players) {
      p.hp = p.stats.maxHp;
      p.iframes = 1e9;
      p.weapons = [];
      p.y = p.py = 270;
    }
    a.x = a.px = 380;
    b.x = b.px = 620;
    for (const e of step(w, [idle, idle])) {
      if (e.t !== 'spawn') continue;
      n++;
      assert.ok(outOfView(a, e.x, e.y) > 0 && outOfView(b, e.x, e.y) > 0);
    }
    w.enemies = [];
  }
  assert.ok(n > 25, `刷了 ${n} 只`);
});

test('SIM-01 游戏里的刷怪（spawnAt）只在出了魔气带外沿（硬边界）时才把点夹回来：魔气带里的刷怪点原样保留，不再被挪回仙台', () => {
  const w = createWorld(76);
  const r = ENEMIES.soldier.radius;
  const a = spawnAt(w, 'soldier', -40, 600, []);
  assert.deepEqual([a.x, a.y], [-40, 600], '魔气带里的点不动（原来会被夹到仙台边上 (20, 520)）');
  const b = spawnAt(w, 'soldier', -500, 2000, []);
  assert.deepEqual([b.x, b.y], [-MIASMA.depth + r, ARENA.h + MIASMA.depth - r], '出了硬边界的夹回外沿');
  w.miasmaInset = { x: 100, y: 60 }; // 魔焰焚城：外沿跟着往里收
  const c = spawnAt(w, 'soldier', -500, 270, []);
  assert.equal(c.x, 100 - MIASMA.depth + r);
  // 测试、数值工具、实验页用的 spawnEnemy 还是把敌人摆在仙台上（行为没变，工具量出来的数不受这次改动影响）
  w.miasmaInset = { x: 0, y: 0 };
  const d = spawnEnemy(w, 'soldier', -40, 600, []);
  assert.deepEqual([d.x, d.y], [ARENA.pad + r, ARENA.h - ARENA.pad - r]);
});

test('SIM-01 模拟里的镜头大小和表现层一致（render/stage.ts 的 VIEW_W × VIEW_H、feel.ts 镜头往上抬的像素）', () => {
  const read = (rel: string) => {
    const f = fileURLToPath(new URL(rel, import.meta.url));
    return existsSync(f) ? readFileSync(f, 'utf8') : '';
  };
  const stage = read('../render/stage.ts');
  const vw = /export const VIEW_W = (\d+)/.exec(stage);
  const vh = /export const VIEW_H = (\d+)/.exec(stage);
  // 表现层的写法改了、找不到这几个数时不拦（那时由改的人对一下）；找得到就必须一致
  if (vw) assert.equal(VIEW.w, Number(vw[1]), 'config.VIEW.w 要等于 stage.ts 的 VIEW_W');
  if (vh) assert.equal(VIEW.h, Number(vh[1]), 'config.VIEW.h 要等于 stage.ts 的 VIEW_H');
  const lift = /stage\.lookAt\(Math\.round\(cx\), Math\.round\(cy\) - (\d+)/.exec(read('../game/feel.ts'));
  if (lift) assert.equal(VIEW.lift, Number(lift[1]), 'config.VIEW.lift 要等于 feel.ts 里镜头往上抬的像素');
  // 余量够不够：最高的精灵（精英约 40 像素）刷在镜头下边之外也要整只看不见
  assert.ok(SPAWN.margin.bottom >= 40 && SPAWN.margin.x >= 25);
});

// ---------------------------------------------------------------- SIM-02 / UX-03 收灵

test('SIM-02 收灵：再远的灵石和掉落也飞得到人物身上（不是商店一开就凭空结算），近的先到、远的后到', () => {
  const { w, p } = arena(41);
  // 人物站在左上角的魔气里，东西撒到最远的右下角：灵石最远约 1280 像素，掉落最远约 1150 像素
  p.x = p.px = -60;
  p.y = p.py = -60;
  p.hp = 50;
  const far = [100, 300, 600, 900, 1280];
  const gems = far.map((d) => gemAt(w, p.x + (d * 1080) / 1270, p.y + (d * 660) / 1270));
  const drops = [100, 420, 700, 1150].map((d, i) => dropAt(w, (['peach', 'chest', 'magnet', 'chest'] as DropKind[])[i], p.x + (d * 990) / 1150, p.y + (d * 570) / 1150 + 8, i === 3));
  endWaveNow(w);
  const { ev, at, leftover, seconds } = collect(w);
  assert.equal(leftover, 0, '商店打开之前，场上的灵石和掉落都已经收完');
  const picks = at.filter((x) => x.t === 'pickup');
  const loots = at.filter((x) => x.t === 'loot');
  assert.equal(picks.length, gems.length, '每颗灵石都是飞到了才收下');
  assert.equal(loots.length, drops.length, '每件掉落都是飞到了才生效');
  for (const x of picks) if (x.e.t === 'pickup') assert.ok(Math.hypot(x.e.x - p.x, x.e.y - (p.y - 6)) < 1, '灵石收下的位置就在人物身上');
  for (const x of loots) if (x.e.t === 'loot') assert.ok(Math.hypot(x.e.x - p.x, x.e.y - (p.y - 8)) < 1, '掉落生效的位置就在人物身上');
  // 近的先到、远的后到（事件按时间排，灵石是倒着遍历的，所以按时间比）
  const times = picks.map((x) => x.time);
  assert.deepEqual([...times].sort((a, b) => a - b), times.slice().sort((a, b) => a - b));
  assert.ok(Math.max(...times) <= COLLECT.gem.max + 2 * DT, `最远的灵石也在 ${COLLECT.gem.max} 秒内到（${Math.max(...times).toFixed(2)}）`);
  assert.ok(Math.max(...loots.map((x) => x.time)) <= COLLECT.drop.max + 2 * DT, `最远的掉落也在 ${COLLECT.drop.max} 秒内到`);
  assert.ok(seconds <= COLLECT.drop.max + COLLECT.tailDrop + 0.1 && seconds < COLLECT.max, `整个收灵 ${seconds.toFixed(2)} 秒`);
  assert.ok(ev.findIndex((e) => e.t === 'shopOpen') > ev.findLastIndex((e) => e.t === 'pickup' || e.t === 'loot'));
});

test('SIM-02 收灵的飞行：从静止起步、越飞越快，速度不太快也不太慢（100 像素约 0.9 秒、300 约 1.5 秒、900 约 2.6 秒），掉落比灵石慢一点', () => {
  const time = (d: number, what: 'gem' | 'drop') => {
    const { w, p } = arena(42);
    p.x = p.px = 40;
    if (what === 'gem') gemAt(w, p.x + d, p.y - 6);
    else dropAt(w, 'chest', p.x + d, p.y - 8);
    endWaveNow(w);
    const speeds: number[] = [];
    let t = -1;
    for (let i = 0; i < 600 && t < 0; i++) {
      const o = what === 'gem' ? w.gems[0] : w.drops[0];
      const x0 = o?.x;
      const ev = step(w, [idle]);
      if (ev.some((e) => e.t === 'pickup' || e.t === 'loot')) t = w.collectT;
      else if (o && w.phase === 'collect' && x0 !== undefined && w.collectT > DT * 1.5) speeds.push((x0 - o.x) / DT);
    }
    return { t, speeds };
  };
  const g100 = time(100, 'gem');
  const g300 = time(300, 'gem');
  const g900 = time(900, 'gem');
  assert.ok(g100.t > 0.75 && g100.t < 1.05, `100 像素 ${g100.t.toFixed(2)} 秒`);
  assert.ok(g300.t > 1.35 && g300.t < 1.7, `300 像素 ${g300.t.toFixed(2)} 秒`);
  assert.ok(g900.t > 2.4 && g900.t < 2.8, `900 像素 ${g900.t.toFixed(2)} 秒`);
  // 先慢后快：每一帧都比上一帧快，起步很慢
  for (let i = 1; i < g300.speeds.length; i++) assert.ok(g300.speeds[i] > g300.speeds[i - 1], '越飞越快');
  assert.ok(g300.speeds[0] < 30 && g300.speeds[g300.speeds.length - 1] > 300, '从静止起步，到手时最快');
  for (const d of [100, 300, 900]) {
    const a = time(d, 'gem').t;
    const b = time(d, 'drop').t;
    assert.ok(b > a && b < a * 1.25, `掉落比灵石慢一点（${d} 像素：${a.toFixed(2)} / ${b.toFixed(2)} 秒）`);
  }
  // 飞行时长的公式：T = √(2d / accel)，夹在 [min, max]
  assert.ok(Math.abs(collectFlight(0, 0, 300, 400, COLLECT.gem).dur - Math.sqrt((2 * 500) / COLLECT.gem.accel)) < 1e-9);
  assert.equal(collectFlight(0, 0, 1, 0, COLLECT.gem).dur, COLLECT.gem.min);
  assert.equal(collectFlight(0, 0, 5000, 0, COLLECT.drop).dur, COLLECT.drop.max);
});

test('SIM-02 波末时已经在朝人物飞的灵石（被聚灵符、拾取范围吸着的）接着那个速度往下加速，不会先顿一下再起步', () => {
  const fly = (v0: number) => {
    const { w, p } = arena(47);
    const g = gemAt(w, p.x + 300, p.y - 6);
    if (v0) g.pulled = p.id; // 正被吸着、朝人物飞
    g.vx = -v0;
    endWaveNow(w);
    const speeds: number[] = [];
    let t = -1;
    for (let i = 0; i < 600 && t < 0; i++) {
      const x0 = w.gems[0]?.x;
      const ev = step(w, [idle]);
      if (ev.some((e) => e.t === 'pickup')) t = w.collectT;
      else if (w.phase === 'collect' && w.gems[0] && x0 !== undefined) speeds.push((x0 - w.gems[0].x) / DT);
    }
    return { t, speeds };
  };
  const rest = fly(0);
  const moving = fly(140);
  // speeds[0] 是波次最后一帧（照旧被吸着飞），speeds[1] 起是收灵
  assert.ok(moving.speeds[0] > 120, `波末那一帧正在飞（${moving.speeds[0].toFixed(0)} 像素 / 秒）`);
  assert.ok(moving.speeds[1] > moving.speeds[0] && moving.speeds[1] < moving.speeds[0] + 10, `起飞时接着原来的速度（${moving.speeds[0].toFixed(0)} → ${moving.speeds[1].toFixed(0)}）`);
  for (let i = 2; i < moving.speeds.length; i++) assert.ok(moving.speeds[i] > moving.speeds[i - 1], '之后越飞越快，没有顿一下');
  assert.ok(rest.speeds[1] < 20, '静止的灵石从头起步');
  assert.ok(moving.t < rest.t - 0.2, `本来就在飞的到得更早（${moving.t.toFixed(2)} / ${rest.t.toFixed(2)} 秒）`);
  // 背着人物飞的（刚从敌人身上迸出来）：只算朝人物的那一份速度，等于从头起步
  const { w, p } = arena(48);
  const g = gemAt(w, p.x + 300, p.y - 6);
  g.vx = 80;
  endWaveNow(w);
  step(w, [idle]);
  step(w, [idle]);
  assert.ok(w.gems[0].x <= p.x + 300 + 80 * DT + 1e-6, '不会接着往外飞');
});

test('UX-03 波末场上什么都没有：收灵阶段也停约一秒（「平定」的停顿），不是一帧就切进商店', () => {
  assert.ok(COLLECT.min >= 0.8 && COLLECT.min <= 1.5);
  const { w } = arena(43);
  endWaveNow(w);
  const { at, seconds } = collect(w);
  assert.ok(Math.abs(seconds - COLLECT.min) <= DT * 1.5, `收灵阶段 ${seconds.toFixed(2)} 秒`);
  const end = at.find((x) => x.t === 'waveEnd')!;
  const open = at.find((x) => x.t === 'shopOpen')!;
  assert.ok(open.time - end.time >= COLLECT.min - DT * 1.5, '波末到商店打开之间隔着这一段');
});

test('UX-03 最后一件收下之后再停一下才进商店：灵石之后停一小会儿；宝匣、蟠桃、聚灵符之后多停一会儿（看得清开出了什么）', () => {
  // 远处的一颗灵石：到手之后 tail 秒才开商店
  const a = arena(44);
  gemAt(a.w, a.p.x + 420, a.p.y);
  endWaveNow(a.w);
  const ra = collect(a.w);
  const pick = ra.at.find((x) => x.t === 'pickup')!;
  const openA = ra.at.find((x) => x.t === 'shopOpen')!;
  assert.ok(pick.time > COLLECT.min, '这颗灵石比最少停留飞得久');
  assert.ok(Math.abs(openA.time - pick.time - COLLECT.tail) <= DT * 1.5, `灵石到手 ${COLLECT.tail} 秒后开商店（实际 ${(openA.time - pick.time).toFixed(2)}）`);
  // 远处的一个宝匣：开出来之后 tailDrop 秒才开商店
  const b = arena(45);
  dropAt(b.w, 'chest', b.p.x + 420, b.p.y);
  endWaveNow(b.w);
  const rb = collect(b.w);
  const got = rb.at.find((x) => x.t === 'loot')!;
  const openB = rb.at.find((x) => x.t === 'shopOpen')!;
  assert.ok(Math.abs(openB.time - got.time - COLLECT.tailDrop) <= DT * 1.5, `宝匣开出来 ${COLLECT.tailDrop} 秒后开商店（实际 ${(openB.time - got.time).toFixed(2)}）`);
  assert.ok(COLLECT.tailDrop > COLLECT.tail);
  // 身边的一颗灵石（很快到手）：还是要停满最少的那一秒
  const c = arena(46);
  gemAt(c.w, c.p.x + 20, c.p.y);
  endWaveNow(c.w);
  const rc = collect(c.w);
  assert.ok(Math.abs(rc.seconds - COLLECT.min) <= DT * 1.5);
});

// ---------------------------------------------------------------- SIM-03 首领倒下之后不会再输

/** 开到第 wave 波的首领战（wave 是每章第 6 波），首领已经在三阶段、可以挨打。 */
function bossFight(seed: number, wave: number) {
  const w = createWorld(seed);
  w.wave = wave - 1;
  w.phase = 'shop';
  w.enemies = [];
  const p = w.players[0];
  p.weapons = [];
  p.pet.cd = 1e12;
  p.ready = true;
  step(w, [idle]);
  const f = w.boss!;
  const b = bossEnemy(w)!;
  assert.ok(f && b, '首领入场');
  f.summonT = 1e9;
  f.phase = 3;
  f.state = 'idle';
  f.t = 0;
  f.lt = 0;
  f.dur = 1e9; // 一直站着，不出招
  b.invuln = 0;
  b.x = b.px = ARENA.w / 2 + 250;
  b.y = b.py = ARENA.h / 2;
  return { w, p, f, b };
}

test('SIM-03 首领倒下的表现期间，压进来的魔气不再掉血：残血站在魔气深处也不会被耗死，打赢就是打赢（第三章通关、第一章进商店）', () => {
  for (const wave of [18, 6]) {
    const { w, p, f, b } = bossFight(51, wave);
    w.miasmaInset = { ...BOSS.inferno.max }; // 魔焰焚城压到底
    p.x = p.px = BOSS.inferno.max.x - MIASMA.depth * 0.93; // 人物站在魔气深处
    p.y = p.py = ARENA.h / 2;
    p.iframes = 0;
    p.hp = p.stats.maxHp * 0.03;
    b.hp = 0; // 这一帧首领被打空
    const hp0 = p.hp;
    const ev: SimEvent[] = [];
    // 这一帧：魔气照常掉血（首领还没判倒下），然后首领倒下
    ev.push(...step(w, [idle]));
    assert.equal(f.state, 'dead');
    assert.ok(p.hp < hp0 && p.alive, '首领倒下之前魔气照常掉血');
    const hp1 = p.hp;
    for (let i = 0; i < Math.round(BOSS.deathTime / DT) + 2 && w.phase === 'wave'; i++) {
      ev.push(...step(w, [idle]));
      assert.ok(p.hp >= hp1 - 1e-9, '倒下的表现期间不再掉血');
    }
    assert.ok(!ev.some((e) => e.t === 'down' || e.t === 'over'), '没有倒下、没有判负');
    assert.ok(!ev.some((e) => e.t === 'corrode' && e.dmg > hp0), '也没有再跳侵蚀的数字');
    if (wave === 18) {
      assert.equal(w.phase, 'win');
      assert.ok(ev.some((e) => e.t === 'win'));
    } else {
      assert.ok(ev.some((e) => e.t === 'chapterClear' && e.chapter === 1));
      assert.equal(w.phase, 'collect');
    }
    // 对照：首领没倒下时，同样的位置和气血撑不过这几秒
    const c = bossFight(51, wave);
    c.w.miasmaInset = { ...BOSS.inferno.max };
    c.p.x = c.p.px = p.x;
    c.p.y = c.p.py = p.y;
    c.p.hp = c.p.stats.maxHp * 0.03;
    const ev2 = run(c.w, 1);
    assert.ok(ev2.some((e) => e.t === 'down') && c.w.phase === 'over', '首领还在时，魔气照常能把人耗死');
  }
});

test('SIM-03 首领和人物同一帧倒下也算打赢：不判负；第三章直接通关，第一章收灵后进商店、人在商店里复活', () => {
  for (const wave of [18, 6]) {
    const { w, p, f, b } = bossFight(52, wave);
    w.miasmaInset = { x: 100, y: 60 };
    p.x = p.px = 70; // 在魔气里
    p.y = p.py = ARENA.h / 2;
    p.iframes = 0;
    p.hp = 0.01; // 这一帧被魔气耗死
    b.hp = 0; // 同一帧首领也被打空
    const ev = step(w, [idle]);
    assert.deepEqual(
      ev.filter((e) => ['down', 'bossDeath', 'over', 'win'].includes(e.t)).map((e) => e.t),
      ['down', 'bossDeath'],
    );
    assert.equal(p.alive, false);
    assert.equal(f.state, 'dead');
    assert.equal(w.phase, 'wave', '不判负，接着放首领倒下的表现');
    const rest: SimEvent[] = [];
    for (let i = 0; i < 60 * 12 && !['shop', 'win', 'over'].includes(phaseOf(w)); i++) rest.push(...step(w, [idle]));
    assert.ok(!rest.some((e) => e.t === 'over'));
    if (wave === 18) assert.equal(phaseOf(w), 'win');
    else {
      assert.equal(phaseOf(w), 'shop');
      assert.ok(p.alive && p.hp === Math.ceil(p.stats.maxHp * 0.3), '在商店里复活');
    }
  }
  // 对照：首领还活着时全员倒下照常判负
  const c = bossFight(52, 6);
  c.w.miasmaInset = { x: 100, y: 60 };
  c.p.x = c.p.px = 70;
  c.p.hp = 0.01;
  const ev = step(c.w, [idle]);
  assert.ok(ev.some((e) => e.t === 'over') && c.w.phase === 'over');
});

// ---------------------------------------------------------------- SIM-06 锁住的同名件

/** 第 1 波的商店，手里多一件凡品火尖枪，货架第 0 格放上 offer 并锁住。 */
function lockedShop(seed: number, offer: (price: number) => ShopOffer) {
  const w = createWorld(seed);
  w.phase = 'shop';
  const p = w.players[0];
  p.iframes = 1e12;
  p.pet.cd = 1e12;
  p.weapons.push({ kind: 'huojian', tier: 1, spirit: null, cd: 1e9 });
  p.weapons[0].cd = 1e9;
  p.lingshi = 10000;
  restock(w, p);
  p.shop[0] = offer(Math.round(WEAPONS.huojian.price * priceScale(1)));
  p.locked[0] = true;
  return { w, p };
}
/** 出战，这一波里给火尖枪加 n 枚碎片（宝匣开出来的那种），打完进下一个商店。 */
function nextShop(w: World, p: Player, frags: number) {
  applyCommand(w, { t: 'ready', player: 0 }, []);
  step(w, [idle]);
  assert.equal(w.phase, 'wave');
  w.spawnAcc = -1e12;
  w.surgeDone = w.eliteDone = true;
  for (let i = 0; i < frags; i++) addFragment(p, 'huojian');
  endWaveNow(w);
  for (let i = 0; i < 60 * 10 && phaseOf(w) !== 'shop'; i++) step(w, [idle]);
  assert.equal(phaseOf(w), 'shop');
}

test('SIM-06 锁住的同名件：手里那件中途靠碎片升了阶，下一个商店里它按现在的品阶重新定价，不能再用旧价升阶', () => {
  const { w, p } = lockedShop(61, (price) => ({ cat: 'weapon', kind: 'huojian', form: 'full', tier: 1, price }));
  const p1 = (p.shop[0] as ShopOffer).price;
  applyCommand(w, { t: 'reroll', player: 0 }, []);
  assert.deepEqual(p.shop[0], { cat: 'weapon', kind: 'huojian', form: 'full', tier: 1, price: p1 }, '锁住的货刷新之后还在');
  nextShop(w, p, 3);
  assert.equal(p.weapons[1].tier, 2, '三枚碎片把火尖枪升到了灵品');
  const want = Math.round(WEAPONS.huojian.price * ECON.upPrice[2] * priceScale(w.wave));
  assert.deepEqual(p.shop[0], { cat: 'weapon', kind: 'huojian', form: 'full', tier: 2, price: want }, '锁住的同名件改成了灵品的价');
  assert.ok(want > p1 * 2 - 1 && p.locked[0], '价钱涨到灵品的价（物价也涨了），还锁着');
  const before = p.lingshi;
  assert.equal(buy(w, p, 0), 'upgraded');
  assert.equal(p.weapons[1].tier, 3);
  assert.equal(before - p.lingshi, want, '按灵品的价收钱');
});

test('SIM-06 锁住的碎片同理按现在的品阶改价；手里那件已经到仙品、用不上的同名件和碎片，下一个商店自动解锁、换成别的货', () => {
  const a = lockedShop(62, (price) => ({ cat: 'weapon', kind: 'huojian', form: 'fragment', tier: 1, price: Math.max(3, Math.round(price * 0.3)) }));
  nextShop(a.w, a.p, 3);
  const full = Math.round(WEAPONS.huojian.price * ECON.upPrice[2] * priceScale(a.w.wave));
  assert.deepEqual(a.p.shop[0], { cat: 'weapon', kind: 'huojian', form: 'fragment', tier: 2, price: Math.max(3, Math.round(full * 0.3)) });
  assert.equal(buy(a.w, a.p, 0), 'fragment');
  // 升到仙品：锁着的同名件用不上了
  const b = lockedShop(63, (price) => ({ cat: 'weapon', kind: 'huojian', form: 'full', tier: 1, price }));
  nextShop(b.w, b.p, 6);
  assert.equal(b.p.weapons[1].tier, 3);
  assert.equal(b.p.locked[0], false, '解锁了');
  const o = b.p.shop[0];
  assert.ok(o && !(o.cat === 'weapon' && o.kind === 'huojian'), '这一格换成了别的货（可以是火尖枪的器灵）');
});

test('SIM-06 买的时候再把一道关：品阶对不上的同名件、碎片不卖；同一次商店里买别的货让法宝升了阶，货架上同一件的货当场改价', () => {
  const w = createWorld(64);
  w.phase = 'shop';
  const p = w.players[0];
  p.lingshi = 10000;
  p.weapons.push({ kind: 'huojian', tier: 2, spirit: null, cd: 0 });
  p.shop[0] = { cat: 'weapon', kind: 'huojian', form: 'full', tier: 1, price: 20 }; // 旧品阶、旧价
  p.shop[1] = { cat: 'weapon', kind: 'huojian', form: 'fragment', tier: 1, price: 6 };
  assert.equal(buy(w, p, 0), null, '旧品阶的同名件不卖');
  assert.equal(buy(w, p, 1), null, '旧品阶的碎片不卖');
  assert.equal(p.lingshi, 10000);
  assert.equal(p.weapons[1].tier, 2);
  // 同一次商店：碎片凑满三枚升了阶，另一格的同名件当场按新品阶改价
  const v = createWorld(65);
  v.phase = 'shop';
  const q = v.players[0];
  q.lingshi = 10000;
  q.weapons.push({ kind: 'huojian', tier: 1, spirit: null, cd: 0 });
  q.frags.huojian = 2;
  q.shop[0] = { cat: 'weapon', kind: 'huojian', form: 'full', tier: 1, price: 20 };
  q.shop[1] = { cat: 'weapon', kind: 'huojian', form: 'fragment', tier: 1, price: 6 };
  assert.equal(buy(v, q, 1), 'upgraded');
  assert.deepEqual(q.shop[0], { cat: 'weapon', kind: 'huojian', form: 'full', tier: 2, price: Math.round(WEAPONS.huojian.price * ECON.upPrice[2] * priceScale(v.wave)) });
  assert.equal(buy(v, q, 0), 'upgraded');
  assert.equal(q.weapons[1].tier, 3);
});

// ---------------------------------------------------------------- SIM-07 易伤到时清零

test('SIM-07 易伤到时就清零：之后再上一个更小的易伤，按它自己的数算（原来一直按旧的大值算）；「引火」同理', () => {
  const { w, p } = arena(66);
  const e = enemy(w, 'soldier', p.x + 40, p.y, 1e6);
  e.vuln = 0.4; // 混天绫三阶缠过
  e.vulnT = 0.5;
  e.fireVuln = 0.5;
  e.fireVulnT = 0.5;
  for (let i = 0; i < 40; i++) tickStatus(w, e, DT, []);
  assert.equal(e.vulnT, 0);
  assert.equal(e.vuln, 0, '到时清零');
  assert.equal(e.fireVulnT, 0);
  assert.equal(e.fireVuln, 0);
  // 再上一个 20% 的易伤（写入的地方都取 max(旧值, 新值)）
  e.vuln = Math.max(e.vuln, 0.2);
  e.vulnT = Math.max(e.vulnT, 2);
  buildGrid(w.enemies);
  assert.equal(hitEnemy(w, e, { dmg: 100, by: 'thrust', owner: 0, from: p, canCrit: false }, []), 120, '按 +20% 算');
  // 没到时的易伤不受影响
  e.vuln = 0.4;
  e.vulnT = 1;
  tickStatus(w, e, DT, []);
  assert.equal(e.vuln, 0.4);
});

// ---------------------------------------------------------------- SIM-08 空间网格的初值

test('SIM-08 空间网格：第一次 buildGrid 之前就查询也立刻返回（原来会原地打转、把页面卡死）', () => {
  // 网格是模块级的，别的测试一跑就建过了：开一个新进程，保证是「这个页面里第一次查询」
  const core = new URL('./core.ts', import.meta.url).href;
  const world = new URL('./world.ts', import.meta.url).href;
  const code = `
    import { enemiesWithin, forNear, nearestEnemy } from ${JSON.stringify(core)};
    import { createWorld } from ${JSON.stringify(world)};
    const w = createWorld(1);
    let n = 0;
    forNear(w.enemies, 480, 270, 300, () => n++);
    const near = enemiesWithin(w, 480, 270, 300);
    console.log('ok', n, near.length, nearestEnemy(w, 480, 270, 300));
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], { timeout: 15000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  assert.match(out, /^ok 0 0 null/);
});

// ---------------------------------------------------------------- SIM-10 一波里连跨两个宠物进化门槛

test('SIM-10 一波里连跨两个宠物进化门槛：同一次商店里接连进化两次（第二次沿着已经选定的路），都选完才能出战', () => {
  assert.deepEqual(PET_LEVELS, [5, 10, 15]);
  const toShop = (level: number) => {
    const w = createWorld(67);
    const p = w.players[0];
    p.level = level;
    p.iframes = 1e9;
    p.weapons = [];
    quiet(w);
    w.wave = 1;
    endWaveNow(w);
    for (let i = 0; i < 60 * 10 && w.phase !== 'shop'; i++) step(w, [idle]);
    assert.equal(w.phase, 'shop');
    return { w, p };
  };
  const { w, p } = toShop(11); // 这一波里从 4 级升到 11 级：5 级、10 级两个门槛都过了
  assert.deepEqual(p.petOffer, ['bind', 'fire']);
  const ev: SimEvent[] = [];
  applyCommand(w, { t: 'evolve', player: 0, branch: 'fire' }, ev);
  assert.equal(p.pet.stage, 1);
  assert.deepEqual(p.petOffer, ['fire'], '接着给第二次进化，只能沿着火绫走');
  applyCommand(w, { t: 'ready', player: 0 }, ev);
  assert.equal(p.ready, false, '还有一次进化没选，不能出战');
  applyCommand(w, { t: 'evolve', player: 0, branch: 'bind' }, ev);
  assert.equal(p.pet.stage, 1, '不能改走另一条路');
  applyCommand(w, { t: 'evolve', player: 0, branch: 'fire' }, ev);
  assert.equal(p.pet.stage, 2);
  assert.equal(p.pet.branch, 'fire');
  assert.equal(p.petOffer, null, '两次都进化完了');
  assert.deepEqual(
    ev.filter((e) => e.t === 'evolve').map((e) => (e.t === 'evolve' ? e.stage : 0)),
    [1, 2],
  );
  // 一口气过了三个门槛也一样；进化完三次就没有了
  const b = toShop(16);
  for (let i = 0; i < 3; i++) {
    assert.ok(b.p.petOffer, `第 ${i + 1} 次进化`);
    applyCommand(b.w, { t: 'evolve', player: 0, branch: 'bind' }, []);
  }
  assert.equal(b.p.pet.stage, 3);
  assert.equal(b.p.petOffer, null);
  assert.equal(petEvolveOffer(b.p), null);
  assert.ok(PET_BRANCH.bind && PET_BRANCH.fire);
});

// ---------------------------------------------------------------- SIM-11 魔气的侵蚀跳字

test('SIM-11 短暂踏进魔气（不到半秒）掉的血，离开时就报出来，不并进下一次进魔气的第一条；零头不跨波带着', () => {
  const { w, p } = arena(81);
  p.iframes = 0;
  let lost = 0;
  const at = (x: number, frames: number) => {
    let reported = 0;
    for (let i = 0; i < frames; i++) {
      p.x = p.px = x;
      const hp0 = p.hp;
      for (const e of step(w, [idle])) if (e.t === 'corrode') reported += e.dmg;
      lost += hp0 - p.hp;
    }
    return reported;
  };
  assert.equal(at(-20, 18), 0, '还在魔气里、不到半秒：先不报');
  const first = lost;
  assert.ok(first > 0.5);
  const out = at(200, 60);
  assert.ok(Math.abs(out - first) < 1e-9, `回到仙台时把刚才掉的 ${first.toFixed(2)} 报出来（报了 ${out.toFixed(2)}）`);
  assert.equal(p.corrode, 0);
  lost = 0;
  const again = at(-20, 30);
  assert.ok(Math.abs(again - lost) < 1e-9, `再进魔气半秒，报的就是这半秒掉的（${again.toFixed(2)} / ${lost.toFixed(2)}），没有并进之前的`);
  // 只蹭了一两帧：掉的血不到半点，不单独报（免得满屏的 1），先攒着；攒够了下一次离开时报
  lost = 0;
  let rep = 0;
  for (let k = 0; k < 40; k++) {
    rep += at(-2, 1);
    rep += at(200, 2);
  }
  assert.ok(rep > 0 && Math.abs(rep + p.corrode - lost) < 1e-9, `蹭边掉的血都报得出来（掉了 ${lost.toFixed(2)}，报了 ${rep.toFixed(2)}，还攒着 ${p.corrode.toFixed(2)}）`);
  assert.ok(p.corrode < 0.5);
  // 零头不跨波：开下一波时清掉
  at(-2, 1);
  at(200, 1);
  assert.ok(p.corrode > 0);
  w.phase = 'shop';
  p.ready = true;
  step(w, [idle]);
  assert.equal(w.phase, 'wave');
  assert.equal(p.corrode, 0);
});

// ---------------------------------------------------------------- BAL-03 负的回复不会把气血扣到 0 以下

test('BAL-03 血魔珠的负回复最多把气血扣到 1 点：不会扣到 0 以下还照常打，也不会把人耗死；正的回复照旧', () => {
  const { w, p } = arena(82);
  RELICS.blooddemon.apply(p.stats);
  RELICS.blooddemon.apply(p.stats);
  assert.ok(p.stats.regen < 0);
  p.hp = 3;
  let min = Infinity;
  for (let i = 0; i < 60 * 20; i++) {
    step(w, [idle]);
    min = Math.min(min, p.hp);
    assert.ok(p.alive && p.hp > 0, '活着的人气血一定大于 0');
  }
  assert.equal(p.hp, 1, '扣到 1 点为止');
  assert.equal(min, 1);
  // 已经不到 1 点（魔气扣的是小数）：不再往下扣，也不会被抬回 1
  p.hp = 0.4;
  run(w, 1);
  assert.equal(p.hp, 0.4);
  // 血魔珠的代价是真的：气血高的时候照常往下掉
  p.hp = 50;
  run(w, 2);
  assert.ok(Math.abs(p.hp - (50 + 2 * p.stats.regen)) < 0.05, `两秒掉了 ${(50 - p.hp).toFixed(2)}`);
  // 正的回复：照旧回到上限为止
  const b = arena(83);
  b.p.stats.regen = 2;
  b.p.hp = b.p.stats.maxHp - 1;
  run(b.w, 2);
  assert.equal(b.p.hp, b.p.stats.maxHp);
});

// ---------------------------------------------------------------- BAL-10 聚灵符与蟠桃

test('BAL-10 聚灵符：收灵时飞过来的那张也有用 —— 这一波收的灵石按 1.25 倍算（正好把八折补回十成）；没有聚灵符照常八折', () => {
  const end = (magnet: boolean, techs: TechniqueId[] = []) => {
    const { w, p } = arena(84);
    for (const id of techs) {
      p.techs.push(id);
      TECHNIQUES[id].apply?.(p.stats);
    }
    for (let i = 0; i < 10; i++) gemAt(w, p.x + 150 + i * 20, p.y - 100 + i * 15);
    if (magnet) dropAt(w, 'magnet', p.x - 200, p.y + 60);
    const before = p.lingshi;
    endWaveNow(w);
    const { ev, leftover } = collect(w);
    assert.equal(leftover, 0);
    return { gain: p.lingshi + p.lingshiAcc - before, ev };
  };
  assert.ok(Math.abs(end(false).gain - 10 * VACUUM_VALUE) < 1e-9, '没有聚灵符：八折');
  const m = end(true);
  assert.ok(Math.abs(m.gain - 10 * VACUUM_VALUE * DROPS.magnetBonus) < 1e-9, `有聚灵符：${m.gain}`);
  assert.ok(Math.abs(VACUUM_VALUE * DROPS.magnetBonus - 1) < 1e-9, '八折 × 1.25 正好是十成');
  const l = m.ev.find((e) => e.t === 'loot' && e.kind === 'magnet');
  assert.ok(l && l.t === 'loot' && l.reward === '收灵灵石 +25%', '聚灵符飞到时说明它做了什么');
  // 功法「聚灵阵」本来就不打折：聚灵符再加 25%
  assert.ok(Math.abs(end(true, ['lingzhen']).gain - 10 * DROPS.magnetBonus) < 1e-9);
});

test('BAL-10 聚灵符：战斗中吸来的灵石按 1.25 倍算，每颗只加一次；吸到一半波次结束也不再打八折', () => {
  const { w, p } = arena(85);
  for (let i = 0; i < 8; i++) gemAt(w, 100 + i * 90, 100 + (i % 3) * 120);
  const ev: SimEvent[] = [];
  loot(w, p, dropAt(w, 'magnet', p.x, p.y), ev);
  w.drops = [];
  assert.ok(w.gems.every((g) => g.pulled === p.id && g.mag && g.value === DROPS.magnetBonus));
  loot(w, p, dropAt(w, 'magnet', p.x, p.y), ev); // 第二张：同一批灵石不再加一次
  w.drops = [];
  assert.ok(w.gems.every((g) => g.value === DROPS.magnetBonus), '每颗只加一次');
  // 还在半路上波次就结束了：这些已经算聚灵符吸来的，不打八折
  run(w, 0.5);
  const flying = w.gems.length;
  assert.ok(flying > 0);
  const before = p.lingshi + p.lingshiAcc;
  endWaveNow(w);
  collect(w);
  assert.ok(Math.abs(p.lingshi + p.lingshiAcc - before - flying * DROPS.magnetBonus) < 1e-9, '波末收下时还是 1.25 倍，没有再打八折');
});

test('BAL-10 蟠桃：满血时拿到不白吃，改成气血上限 +2（收灵时飞来的蟠桃有一半是这样）；不满血照常回 25%', () => {
  const { w, p } = arena(86);
  const max0 = p.stats.maxHp;
  const ev: SimEvent[] = [];
  loot(w, p, dropAt(w, 'peach', p.x, p.y), ev);
  assert.equal(p.stats.maxHp, max0 + DROPS.peachOver);
  assert.equal(p.hp, p.stats.maxHp, '还是满血');
  const l = ev.find((e) => e.t === 'loot');
  assert.ok(l && l.t === 'loot' && l.reward === `气血上限 +${DROPS.peachOver}`);
  p.hp = 40;
  loot(w, p, dropAt(w, 'peach', p.x, p.y), ev);
  assert.equal(p.stats.maxHp, max0 + DROPS.peachOver, '不满血时不加上限');
  assert.equal(p.hp, 40 + Math.round(p.stats.maxHp * DROPS.peachHeal));
  // 收灵时飞过来、人是满血：同样加上限
  w.drops = [];
  p.hp = p.stats.maxHp;
  dropAt(w, 'peach', p.x + 200, p.y);
  endWaveNow(w);
  const { ev: ev2 } = collect(w);
  assert.ok(ev2.some((e) => e.t === 'loot' && e.kind === 'peach' && e.reward === `气血上限 +${DROPS.peachOver}`));
  assert.equal(p.stats.maxHp, max0 + 2 * DROPS.peachOver);
});

// ---------------------------------------------------------------- BAL-12 器灵二选一

/** 商店里：乾坤圈和火尖枪都是仙品（都能出器灵），灵石管够。 */
function spiritShop(seed: number) {
  const w = createWorld(seed);
  w.phase = 'shop';
  w.wave = 12;
  const p = w.players[0];
  p.lingshi = 1e6;
  p.weapons = [
    { kind: 'qiankun', tier: 3, spirit: null, cd: 0 },
    { kind: 'huojian', tier: 3, spirit: null, cd: 0 },
  ];
  return { w, p };
}
const spiritsOn = (p: Player) => p.shop.map((o, i) => ({ o, i })).filter((x): x is { o: ShopOffer & { cat: 'spirit' }; i: number } => !!x.o && x.o.cat === 'spirit');

test('BAL-12 器灵二选一：刷出器灵时，同一件法宝的两个器灵紧挨着一起上架、价钱一样；先后顺序是随机的', () => {
  const { w, p } = spiritShop(91);
  let shelves = 0;
  let two = 0;
  const firsts = new Set<string>();
  for (let k = 0; k < 400; k++) {
    restock(w, p);
    assert.equal(p.shop.filter(Boolean).length, 4, '四格都有货');
    const sp = spiritsOn(p);
    if (!sp.length) continue;
    shelves++;
    if (sp.length === 4) two++;
    for (const { o, i } of sp) {
      const j = spiritPair(p, i);
      assert.ok(j >= 0, `器灵 ${o.kind}·${o.spirit} 的另一个也在货架上`);
      assert.equal(Math.abs(i - j), 1, '两个紧挨着');
      const other = p.shop[j] as ShopOffer & { cat: 'spirit' };
      assert.equal(other.kind, o.kind);
      assert.notEqual(other.spirit, o.spirit);
      assert.equal(other.price, o.price, '一样的价');
      assert.deepEqual([o.spirit, other.spirit].sort(), WEAPONS[o.kind].spirits.map((s) => s.id).sort(), '正好是这件法宝的两个器灵');
      if (i < j) firsts.add(`${o.kind}:${o.spirit}`);
    }
    assert.equal(new Set(sp.map(({ o }) => `${o.kind}:${o.spirit}`)).size, sp.length, '同一个器灵不重复上架');
  }
  assert.ok(shelves > 60, `400 次进货里 ${shelves} 次刷出了器灵`);
  assert.ok(two > 0, '两件仙品法宝的两对器灵也能同时上架');
  assert.equal(firsts.size, 4, '哪个器灵排在前面是随机的（机器人买第一个，等于随机挑）');
});

test('BAL-12 器灵二选一：买下一个，另一个随之下架（锁着的也一样）；法宝升到神品、觉醒的就是买的那个', () => {
  for (const lockOther of [false, true]) {
    const { w, p } = spiritShop(92);
    let sp = spiritsOn(p);
    for (let k = 0; k < 200 && !sp.length; k++) {
      restock(w, p);
      sp = spiritsOn(p);
    }
    assert.ok(sp.length >= 2);
    const { o, i } = sp[1];
    const j = spiritPair(p, i);
    if (lockOther) applyCommand(w, { t: 'lock', player: 0, slot: j }, []);
    const others = p.shop.map((x, k) => (k !== i && k !== j ? JSON.stringify(x) : ''));
    const ev: SimEvent[] = [];
    applyCommand(w, { t: 'buy', player: 0, slot: i }, ev);
    assert.ok(ev.some((e) => e.t === 'bought' && e.result === 'awakened'));
    const wpn = p.weapons.find((x) => x.kind === o.kind)!;
    assert.equal(wpn.tier, 4);
    assert.equal(wpn.spirit, o.spirit, '觉醒的是买的那个');
    assert.equal(p.shop[i], null, '买走的那格空了');
    assert.equal(p.shop[j], null, '另一个器灵随之下架');
    assert.equal(p.locked[j], false);
    assert.deepEqual(
      p.shop.map((x, k) => (k !== i && k !== j ? JSON.stringify(x) : '')),
      others,
      '别的货不动',
    );
    // 之后再怎么刷新，这件法宝的器灵都不会再出现
    for (let k = 0; k < 100; k++) {
      restock(w, p);
      assert.ok(!spiritsOn(p).some((x) => x.o.kind === o.kind));
    }
  }
});

test('BAL-12 器灵二选一：只空着一格时不单独上架一个器灵；锁住其中一个，它留着、不会再刷出重复的', () => {
  // 三格锁着别的货、只剩一格：放不下一对，这一格不出器灵
  const a = spiritShop(93);
  restock(a.w, a.p);
  for (let i = 0; i < 3; i++) {
    a.p.shop[i] = { cat: 'relic', id: (['peach', 'lingzhi', 'gourd'] as const)[i], price: 10 };
    a.p.locked[i] = true;
  }
  for (let k = 0; k < 300; k++) {
    restock(a.w, a.p);
    assert.ok(a.p.shop[3] && a.p.shop[3].cat !== 'spirit', '单独一格不出器灵');
  }
  // 两格空着：可以出一对
  a.p.locked[2] = false;
  let pair = false;
  for (let k = 0; k < 300 && !pair; k++) {
    restock(a.w, a.p);
    pair = spiritsOn(a.p).length === 2;
  }
  assert.ok(pair, '空着两格时能出一对');
  // 锁住一对里的一个：刷新之后它还在，货架上不会出现第二个同样的器灵
  const b = spiritShop(94);
  let sp = spiritsOn(b.p);
  for (let k = 0; k < 200 && !sp.length; k++) {
    restock(b.w, b.p);
    sp = spiritsOn(b.p);
  }
  const keep = sp[0];
  applyCommand(b.w, { t: 'lock', player: 0, slot: keep.i }, []);
  for (let k = 0; k < 200; k++) {
    applyCommand(b.w, { t: 'reroll', player: 0 }, []);
    assert.deepEqual(b.p.shop[keep.i], keep.o, '锁住的器灵留着');
    const same = spiritsOn(b.p).filter((x) => x.o.kind === keep.o.kind && x.o.spirit === keep.o.spirit);
    assert.equal(same.length, 1, '不重复');
  }
  assert.equal(buy(b.w, b.p, keep.i), 'awakened');
});

// ---------------------------------------------------------------- BAL-13 功法门槛

test('BAL-13 功法门槛：四门，都不和混天绫的进化（5 / 10 / 15 级）撞在同一级，最后一门不晚于 14 级', () => {
  assert.equal(TECH_LEVELS.length, 4);
  for (let i = 1; i < TECH_LEVELS.length; i++) assert.ok(TECH_LEVELS[i] > TECH_LEVELS[i - 1]);
  for (const l of TECH_LEVELS) assert.ok(!PET_LEVELS.includes(l), `${l} 级和宠物进化撞了`);
  assert.ok(TECH_LEVELS[3] <= 14, '机器人打到最后一个商店时等级中位 17、最低的一成 16：18 级基本够不到，14 级都够得到');
});

test('BAL-13 整局巡检（机器人打完三章）：四门功法在打最终首领之前都悟到了；一路上没有兵刷在屏幕里，活着就有血，收灵没有东西被凭空结算', () => {
  const w = createWorld(2003);
  const p = w.players[0];
  let learnedAt = 0;
  let spawns = 0;
  let collects = 0;
  let leftover = 0;
  let collectStart = -1;
  for (let ticks = 0; ticks < 60 * 60 * 40 && w.phase !== 'over' && w.phase !== 'win'; ticks++) {
    const phase = w.phase;
    const left = w.gems.length + w.drops.length;
    if (phase === 'wave') p.hp = Math.max(p.hp, p.stats.maxHp * 0.5); // 半无敌：这条测的是流程，不是这个种子打不打得过
    const ev = step(w, [botInput(w, 0)], phase === 'shop' ? botShop(w, 0) : []);
    // 第二章金光阵阵边冒出来的回响兵是设计上的例外（兵从阵里冒出来，见 sim/ch2/terrain.ts），不算「凭空出现在屏幕里」；
    // 精英词缀「召唤」从精英身边的符印里叫出来的回响兵也是（先亮符印、再冒出来，见 sim/elites/affixes.ts）
    // 第三章阵图傀儡补上的另一只（pairUp，同一帧有 tetherOn）：先挑谁都看不见的位置，人物贴着场边、角落时实在没有才挑最不显眼的（设计如此，sim/ch3/foes.ts；
    // 2026-11-11 敌人移速调快以后这个种子第 16、17 波各碰到一次）
    const fromSite = new Set(ev.flatMap((x) => (x.t === 'siteSpawn' ? [x.id] : x.t === 'eliteCall' ? x.ids : x.t === 'tetherOn' ? [x.a, x.b] : [])));
    for (const e of ev) {
      // 首领插下的落魂幡、立起的草人也是（插在人物身边，设计如此）
      if (e.t === 'spawn' && e.kind !== 'boss' && e.kind !== 'splitling' && e.kind !== 'soulflag' && e.kind !== 'strawman' && !fromSite.has(e.id)) {
        spawns++;
        assert.ok(outOfView(p, e.x, e.y) > 0, `第 ${w.wave} 波：${e.kind} 刷在了屏幕里`);
      }
      if (e.t === 'waveEnd') collectStart = w.time;
      if (e.t === 'shopOpen') {
        collects++;
        leftover += left - ev.filter((x) => x.t === 'pickup' || x.t === 'loot').length;
        assert.ok(w.time - collectStart >= COLLECT.min - DT * 1.5, '每次收灵都停够了');
      }
      if (e.t === 'learn' && p.techs.length === 4 && !learnedAt) learnedAt = w.wave;
    }
    if (p.alive) assert.ok(p.hp > 0, '活着的人气血大于 0');
  }
  assert.equal(w.phase, 'win', '半无敌的机器人打完了三章');
  assert.ok(spawns > 1500 && collects === 17);
  assert.equal(leftover, 0, '17 次收灵，没有一件东西是商店打开时凭空结算的');
  assert.equal(p.techs.length, 4, '四门功法都悟到了');
  assert.ok(learnedAt > 0 && learnedAt <= 17, `第四门在第 ${learnedAt} 波后的商店悟到（打最终首领之前）`);
});
