// 联机的规则（coop.ts）：倒地救援、出局与归队（之后的按人数加强、多人商店、中途加入、掉线托管也在这个文件里测）。
// 单人完全不变由 tools/balance.ts 20 的结果逐字不变来保证（改之前、改之后各跑一遍对比），这里另有几条单人的对照。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, spawnEnemy, step, type PlayerInput, type SimEvent, type World } from './world.ts';
import { ARENA, BOSS, COOP, DT, ENEMIES, MIASMA } from './config.ts';
import { SURGE, waveScale } from './catalog.ts';
import { outOfView } from './spawn.ts';
import { hurtPlayer } from './core.ts';
import { headcount, spawnMul } from './coop.ts';
import { addPlayer, removePlayer, setAway } from './roster.ts';
import { botInput, botShop, botTurn } from './bot.ts';
import type { Command, CoopEvent, EnemyKindName } from './types.ts';

const idle: PlayerInput = { mx: 0, my: 0, skill: false };
const idles = (w: World) => w.players.map(() => idle);

/** 不刷怪的一波：借用首领波（不按时刷小怪、没有首领），并把这一波拉得很长。 */
const quiet = (w: World) => {
  w.wave = 6;
  w.waveLen = 1e9;
};
const enemy = (w: World, kind: EnemyKindName, x: number, y: number, hp = 9999) => {
  const e = spawnEnemy(w, kind, x, y, []);
  e.hp = e.maxHp = hp;
  e.speed = 0;
  e.x = e.px = x;
  e.y = e.py = y;
  return e;
};
/** 一下打空：直接走受伤的那条路（闪避率是 0，不会闪开）。 */
const knockOut = (w: World, id: number) => {
  const ev: SimEvent[] = [];
  const p = w.players[id];
  p.iframes = 0;
  hurtPlayer(w, p, 1e6, 'contact', ev);
  return ev;
};
const place = (w: World, id: number, x: number, y: number) => {
  const p = w.players[id];
  p.x = p.px = x;
  p.y = p.py = y;
};
/** 跑 seconds 秒，inputs 每帧给（默认都站着不动），收下所有事件。 */
const run = (w: World, seconds: number, inputs: (w: World) => PlayerInput[] = idles) => {
  const ev: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) ev.push(...step(w, inputs(w)));
  return ev;
};
const coopEv = <T extends CoopEvent['t']>(ev: SimEvent[], t: T) => ev.filter((e): e is Extract<CoopEvent, { t: T }> => e.t === t);

test('单人照旧：气血打空就倒下，down 事件不带 t2，没有倒地的倒计时，下一帧全队陨落', () => {
  const w = createWorld(1);
  quiet(w);
  const ev = knockOut(w, 0);
  const down = ev.find((e) => e.t === 'down')!;
  assert.deepEqual(Object.keys(down).sort(), ['owner', 't', 'x', 'y']);
  const p = w.players[0];
  assert.equal(p.alive, false);
  assert.equal(p.down, undefined);
  assert.ok(step(w, idles(w)).some((e) => e.t === 'over'));
  assert.equal(w.phase, 'over');
});

test('联机倒地：不能动、不能出手、敌人不追他、不算全队陨落；15 秒的倒计时', () => {
  const w = createWorld(2, 2);
  quiet(w);
  place(w, 0, 300, 270);
  place(w, 1, 600, 270);
  const ev = knockOut(w, 1);
  const down = ev.find((e) => e.t === 'down');
  assert.deepEqual(down, { t: 'down', owner: 1, x: 600, y: 270, t2: COOP.downT });
  const b = w.players[1];
  assert.equal(b.alive, false);
  assert.equal(b.hp, 0);
  assert.equal(b.down, COOP.downT);
  // 敌人放在倒地的人身边，离活着的人远：它朝活着的人走
  const e = enemy(w, 'soldier', 620, 270);
  e.speed = 40;
  const out = run(w, 2, () => [idle, { mx: 1, my: 1, skill: true }]);
  assert.ok(!out.some((x) => x.t === 'over'));
  assert.equal(b.x, 600, '倒地的人不能动');
  assert.equal(b.y, 270);
  assert.ok(!out.some((x) => (x.t === 'throw' || x.t === 'skill') && x.owner === 1), '倒地的人不出手');
  assert.ok(e.x < 600, `敌人朝活着的人走了（x ${e.x.toFixed(0)}）`);
  assert.ok(Math.abs(b.down! - (COOP.downT - 2)) < 0.02, `倒计时走了 2 秒（还剩 ${b.down}）`);
});

test('扶起：队友站在身边 30 像素内持续 3 秒，回三成气血、无敌片刻；扶的时候倒计时停住', () => {
  const w = createWorld(3, 2);
  quiet(w);
  place(w, 0, 300, 270);
  place(w, 1, 400, 270);
  knockOut(w, 1);
  run(w, 1); // 先没人扶，倒计时走 1 秒
  const b = w.players[1];
  const left = b.down!;
  place(w, 0, 400 + COOP.reviveR - 2, 270); // 站到身边（刚好在半径里）
  const ev = run(w, COOP.reviveT - 0.1);
  assert.deepEqual(coopEv(ev, 'rescue').map((e) => [e.owner, e.by.join(), e.k]), [[1, '0', 0]], '开始扶的那一帧发一次');
  assert.equal(b.alive, false, '还差一点');
  assert.ok(b.rescue! > 0.9 && b.rescue! < 1);
  assert.deepEqual(b.helpers, [0]);
  assert.equal(b.down, left, '有人扶的时候倒计时不走');
  const ev2 = run(w, 0.2);
  const rv = coopEv(ev2, 'revive');
  assert.equal(rv.length, 1);
  assert.deepEqual(rv[0].by, [0]);
  assert.equal(rv[0].hp, Math.ceil(b.stats.maxHp * COOP.reviveHp));
  assert.equal(b.alive, true);
  assert.equal(b.hp, rv[0].hp);
  assert.ok(b.iframes > 1, '起身后有一小段无敌');
  assert.equal(b.down, 0);
  assert.equal(b.rescue, 0);
  // 起身后能动
  const x0 = b.x;
  run(w, 0.5, () => [idle, { mx: 1, my: 0, skill: false }]);
  assert.ok(b.x > x0 + 30);
});

test('扶的人走开：进度按一半的速度回落、倒计时接着走；再回来接着扶', () => {
  const w = createWorld(4, 2);
  quiet(w);
  place(w, 0, 410, 270);
  place(w, 1, 400, 270);
  knockOut(w, 1);
  const b = w.players[1];
  run(w, 1.5); // 扶了一半
  assert.ok(Math.abs(b.rescue! - 0.5) < 0.02);
  place(w, 0, 300, 270); // 走开
  const ev = run(w, 0.5);
  assert.deepEqual(coopEv(ev, 'rescue').map((e) => e.by.length), [0], '走开的那一帧发一次（by 为空）');
  assert.ok(Math.abs(b.rescue! - (0.5 - (0.5 / COOP.reviveT) * COOP.decay)) < 0.02, `回落到 ${b.rescue}`);
  assert.ok(Math.abs(b.down! - (COOP.downT - 0.5)) < 0.02, '没人扶时倒计时走');
  place(w, 0, 405, 268); // 回来接着扶：从回落后的进度接着涨
  const need = (1 - b.rescue!) * COOP.reviveT;
  const ev2 = run(w, need + 0.05);
  assert.equal(coopEv(ev2, 'revive').length, 1);
  assert.equal(b.alive, true);
});

test('两个人一起扶不会更快；被扶的同时扶的人也倒了 → 进度回落', () => {
  const w = createWorld(5, 3);
  quiet(w);
  place(w, 0, 390, 270);
  place(w, 1, 400, 270);
  place(w, 2, 410, 270);
  knockOut(w, 1);
  const b = w.players[1];
  const ev = run(w, 1);
  assert.deepEqual(coopEv(ev, 'rescue')[0].by, [0, 2], 'by 按 id 升序');
  assert.ok(Math.abs(b.rescue! - 1 / COOP.reviveT) < 0.02);
  knockOut(w, 0);
  knockOut(w, 2);
  const ev2 = run(w, 0.1);
  assert.deepEqual(coopEv(ev2, 'rescue').map((e) => e.by.length), [0]);
  assert.ok(ev2.some((e) => e.t === 'over'), '三个人都倒了：全队陨落');
});

test('15 秒没人扶 → 出局；出局的人这一波不回来，这一波打完就以一成气血归队、站到队友身边，和大家一起进商店（用户 11-12）', () => {
  const w = createWorld(6, 2);
  w.waveLen = 1e9; // 普通波，但不让它自己结束
  w.eliteDone = w.surgeDone = true;
  place(w, 0, 480, 270);
  place(w, 1, 200, 400);
  for (const p of w.players) p.weapons = [];
  knockOut(w, 1);
  const b = w.players[1];
  // 活着的人一直不受伤（只测出局）
  const ev = run(w, COOP.downT + 0.1, (w) => {
    w.players[0].iframes = 1;
    return idles(w);
  });
  const out = coopEv(ev, 'out');
  assert.equal(out.length, 1);
  assert.equal(out[0].owner, 1);
  assert.equal(out[0].waveEnd, undefined);
  assert.equal(b.out, true);
  assert.equal(b.down, 0);
  assert.equal(b.alive, false);
  assert.ok(!ev.some((e) => e.t === 'over'));
  // 打完这一波：收灵、商店（出局的人照常逛，也要按出战）
  w.waveLen = w.waveT + DT;
  for (const e of w.enemies) e.hp = 0;
  let guard = 0;
  const ev2: SimEvent[] = [];
  while (w.phase !== 'shop' && guard++ < 60 * 10) ev2.push(...step(w, [{ mx: 0, my: 0, skill: false }, idle]));
  assert.equal(w.phase, 'shop');
  const rj = coopEv(ev2, 'rejoin');
  assert.equal(rj.length, 1, '这一波打完就归队');
  assert.ok(ev2.findIndex((e) => e.t === 'rejoin') < ev2.findIndex((e) => e.t === 'waveEnd'), '先归队、再清场收灵');
  assert.equal(b.alive, true, '商店里已经复活');
  assert.equal(b.out, false);
  assert.ok(b.hp >= Math.ceil(b.stats.maxHp * COOP.rejoinHp));
  const a = w.players[0];
  assert.ok(Math.hypot(b.x - a.x, b.y - a.y) < 40, '站到队友身边');
  step(w, idles(w), [{ t: 'ready', player: 0 }]);
  assert.equal(w.phase, 'shop', '归队的人也要按出战');
  const ev3 = step(w, idles(w), [{ t: 'ready', player: 1 }]);
  assert.equal(w.phase, 'wave');
  assert.equal(coopEv(ev3, 'rejoin').length, 0, '开波时没有要归队的了');
});

test('这一波打完时还倒着的人跟着出局（waveEnd），下一波归队；商店里买了回春丹的按满血回来', () => {
  const w = createWorld(7, 2);
  w.eliteDone = w.surgeDone = true;
  for (const p of w.players) p.weapons = [];
  place(w, 0, 480, 270);
  place(w, 1, 300, 270);
  knockOut(w, 1);
  w.waveT = w.waveLen - 0.5;
  let ev: SimEvent[] = [];
  for (let i = 0; i < 60 && w.phase === 'wave'; i++) {
    w.players[0].iframes = 1;
    ev = ev.concat(step(w, idles(w)));
  }
  const out = coopEv(ev, 'out');
  assert.equal(out.length, 1);
  assert.equal(out[0].waveEnd, true);
  assert.ok(ev.findIndex((e) => e.t === 'out') < ev.findIndex((e) => e.t === 'waveEnd'));
  while (w.phase !== 'shop') step(w, idles(w));
  const b = w.players[1];
  b.lingshi = 999;
  b.shop[0] = { cat: 'elixir', id: 'huichun', price: 10 };
  step(w, idles(w), [{ t: 'buy', player: 1, slot: 0 }]);
  assert.equal(b.hp, b.stats.maxHp);
  step(w, idles(w), [
    { t: 'ready', player: 0 },
    { t: 'ready', player: 1 },
  ]);
  assert.equal(w.phase, 'wave');
  assert.equal(b.alive, true);
  assert.equal(b.hp, b.stats.maxHp, '回春丹的满血不被一成盖掉');
});

test('保命的先生效：替身符、莲花化身救得回来就不倒地', () => {
  const w = createWorld(8, 2);
  quiet(w);
  const b = w.players[1];
  b.charms = ['tishen'];
  const ev = knockOut(w, 1);
  assert.ok(ev.some((e) => e.t === 'blocked' && e.by === 'tishen'));
  assert.equal(b.alive, true);
  assert.equal(b.down, undefined);
  b.techs = ['lianhua'];
  const ev2 = knockOut(w, 1);
  assert.ok(ev2.some((e) => e.t === 'tech' && e.kind === 'lianhua'));
  assert.equal(b.alive, true);
  const ev3 = knockOut(w, 1); // 这一章的莲花用过了
  assert.ok(ev3.some((e) => e.t === 'down'));
  assert.equal(b.down, COOP.downT);
});

test('魔气里耗尽气血也是倒地（不是陨落）；倒在魔焰焚城压进来的边上，身子跟着挪进硬边界', () => {
  const w = createWorld(9, 2);
  quiet(w);
  const b = w.players[1];
  place(w, 0, 480, 270);
  place(w, 1, -MIASMA.depth + 6, 270);
  b.hp = 1;
  const ev = run(w, 1, () => [idle, { mx: -1, my: 0, skill: false }]);
  assert.ok(ev.some((e) => e.t === 'down' && e.owner === 1 && e.t2 === COOP.downT));
  assert.ok(!ev.some((e) => e.t === 'over'));
  w.miasmaInset = { x: 40, y: 0 };
  run(w, DT);
  assert.ok(b.x >= 40 - MIASMA.depth + 5 - 1e-9, `挪进来了（x ${b.x}）`);
  assert.ok(b.x < ARENA.w / 2);
});

test('倒地的人的镜头也算：敌人不会凭空出现在他的屏幕里（他还看着自己的身子等人扶）', () => {
  const w = createWorld(19, 2);
  w.wave = 3;
  w.waveLen = 1e9;
  w.eliteDone = w.surgeDone = true;
  for (const p of w.players) p.weapons = [];
  place(w, 0, 300, 270);
  place(w, 1, 660, 270); // 一个人的屏幕右沿外面，正是另一个人的屏幕中间
  knockOut(w, 1);
  let n = 0;
  for (let i = 0; i < 60 * 12; i++) {
    const a = w.players[0];
    a.iframes = 1;
    place(w, 0, 300, 270);
    w.players[1].down = COOP.downT; // 一直倒着
    for (const e of step(w, idles(w))) {
      if (e.t !== 'spawn') continue;
      n++;
      assert.ok(outOfView(a, e.x, e.y) > 0 && outOfView(w.players[1], e.x, e.y) > 0, `(${e.x.toFixed(0)}, ${e.y.toFixed(0)}) 落在了某个人的屏幕里`);
    }
    for (const e of w.enemies) e.hp = 0;
  }
  assert.ok(n > 30, `刷了 ${n} 只`);
});

test('机器人会去扶倒地的队友', () => {
  const w = createWorld(10, 3);
  w.eliteDone = w.surgeDone = true;
  place(w, 0, 420, 270);
  place(w, 1, 520, 270);
  place(w, 2, 470, 330);
  knockOut(w, 1);
  const ev = run(w, 8, (w) => w.players.map((_, i) => botInput(w, i)));
  assert.ok(coopEv(ev, 'revive').some((e) => e.owner === 1), '8 秒内扶起来了');
});

test('三个机器人打第一章、每 10 秒打倒一个：机器人会去扶；倒地、出局的人没有被当成活着的', () => {
  const n: Record<string, number> = { down: 0, revive: 0, out: 0, rejoin: 0 };
  for (const seed of [12, 13]) {
    const w = createWorld(seed, 3);
    let k = 0;
    for (let i = 0; i < 60 * 60 * 8 && w.phase !== 'over' && w.phase !== 'win' && w.wave <= 6; i++) {
      let ev: SimEvent[] = [];
      if (w.phase === 'wave' && i % 600 === 300) {
        const alive = w.players.filter((p) => p.alive);
        if (alive.length >= 2) ev = knockOut(w, alive[k++ % alive.length].id);
      }
      const cmds = w.phase === 'shop' ? w.players.flatMap((_, j) => botShop(w, j)) : [];
      ev = ev.concat(step(w, w.players.map((_, j) => botInput(w, j)), cmds));
      for (const e of ev) if (e.t in n) n[e.t]++;
      for (const p of w.players) {
        if (p.down) assert.equal(p.alive, false);
        if (p.out) assert.equal(p.alive, false);
        if (p.alive) assert.ok(!p.down && !p.out);
      }
    }
  }
  assert.ok(n.down >= 10 && n.revive >= n.down / 2, `机器人扶起了一半以上：${JSON.stringify(n)}`);
  assert.ok(n.rejoin <= n.out, '归队的都是出局过的');
});

// ---------------------------------------------------------------- 按人数加强

/** 让所有人在商店里按出战，开下一波（wave 是下一波的编号）。 */
const startWaveAt = (w: World, wave: number) => {
  w.phase = 'shop';
  w.wave = wave - 1;
  return step(w, idles(w), w.players.map((_, i) => ({ t: 'ready' as const, player: i })));
};

test('按人数加强：敌人气血 ×(1 + COOP.scale.hp ×(人数 − 1))、首领气血 ×(1 + COOP.scale.boss ×(人数 − 1))；单人不变', () => {
  for (const n of [1, 2, 3, 4]) {
    const w = createWorld(20, n);
    const e = spawnEnemy(w, 'soldier', 300, 300, []);
    assert.equal(e.maxHp, Math.round(ENEMIES.soldier.hp * waveScale(1).hp * (1 + COOP.scale.hp * (n - 1))), `${n} 人的回响兵`);
    const el = spawnEnemy(w, 'elite', 300, 300, []);
    assert.equal(el.maxHp, Math.round(ENEMIES.elite.hp * waveScale(1).hp * (1 + COOP.scale.hp * (n - 1))), `${n} 人的精英`);
    const b = createWorld(21, n);
    startWaveAt(b, 6);
    assert.ok(b.boss, '第 6 波是首领');
    const boss = b.enemies.find((x) => x.id === b.boss!.id)!;
    assert.equal(boss.maxHp, Math.round(BOSS.hp[1] * (1 + COOP.scale.boss * (n - 1))), `${n} 人的首领`);
    assert.equal(boss.hp, boss.maxHp);
  }
});

test('按人数加强：刷怪数 ×(1 + 0.5 ×(人数 − 1))，包围也是（联机时平分给每个活着的人，各围一圈）', () => {
  const spawned = (n: number) => {
    const w = createWorld(22, n);
    w.wave = 3;
    w.waveLen = 1e9;
    w.eliteDone = w.surgeDone = true;
    for (const p of w.players) p.weapons = [];
    let c = 0;
    for (let i = 0; i < 60 * 12; i++) {
      for (const p of w.players) p.iframes = 1;
      for (const e of w.enemies) e.hp = 0; // 场上清空，不碰同屏上限
      c += step(w, idles(w)).filter((e) => e.t === 'spawn').length;
    }
    return c;
  };
  const one = spawned(1);
  for (const n of [2, 4]) {
    const r = spawned(n) / one;
    const want = 1 + COOP.scale.spawn * (n - 1);
    assert.ok(Math.abs(r - want) < 0.03, `${n} 人刷了单人的 ${r.toFixed(3)} 倍（应为 ${want}）`);
  }
  for (const n of [1, 4]) {
    const w = createWorld(23, n);
    startWaveAt(w, 3);
    w.eliteDone = true;
    for (const p of w.players) p.weapons = [];
    let surge: SimEvent[] | null = null;
    for (let i = 0; i < 60 * 40 && !surge; i++) {
      for (const p of w.players) p.iframes = 1;
      const ev = step(w, idles(w));
      if (ev.some((e) => e.t === 'surge')) surge = ev;
    }
    assert.ok(surge);
    const rings = surge.filter((e) => e.t === 'surge');
    const ring = w.enemies.filter((e) => e.rush).length;
    const total = (SURGE.base + 3) * (1 + COOP.scale.spawn * (n - 1));
    if (n === 1) {
      assert.equal(rings.length, 1);
      assert.equal('owner' in rings[0], false, '单人的 surge 事件不带 owner');
      assert.equal(ring, total);
    } else {
      // 联机：每个活着的人各围一圈，总数平分
      assert.deepEqual(rings.map((e) => (e as { owner?: number }).owner), [0, 1, 2, 3]);
      assert.equal(ring, Math.round(total / n) * n, `${n} 人的包围`);
    }
  }
});

// ---------------------------------------------------------------- 多人商店与经济

/** 打完第 1 波进商店（场上清空、人都不受伤）。 */
const toShop = (w: World) => {
  for (const p of w.players) p.weapons = [];
  w.waveT = w.waveLen;
  for (let i = 0; i < 60 * 10 && w.phase !== 'shop'; i++) {
    for (const p of w.players) p.iframes = 1;
    step(w, idles(w));
  }
  assert.equal(w.phase, 'shop');
};

test('多人商店：每人一个货架，买、刷新、锁定互不影响；所有在场的人都按了出战才开下一波，按了还能取消', () => {
  const w = createWorld(30, 3);
  toShop(w);
  const [a, b, c] = w.players;
  for (const p of w.players) p.lingshi = 500;
  const shelf = (p: typeof a) => JSON.stringify(p.shop);
  const bShelf = shelf(b);
  const cShelf = shelf(c);
  step(w, idles(w), [
    { t: 'buy', player: 0, slot: 0 },
    { t: 'lock', player: 0, slot: 1 },
    { t: 'reroll', player: 0 },
  ]);
  assert.equal(a.shop[0] === null || a.rerolls === 1, true);
  assert.equal(a.locked[1] || a.shop[1] === null, true);
  assert.equal(shelf(b), bShelf, '别人的货架不动');
  assert.equal(shelf(c), cShelf);
  assert.equal(b.lingshi, 500);
  assert.deepEqual(b.locked, [false, false, false, false]);
  step(w, idles(w), [{ t: 'ready', player: 0 }]);
  step(w, idles(w), [{ t: 'ready', player: 2 }]);
  assert.equal(w.phase, 'shop', '还有人没按');
  assert.deepEqual(w.players.map((p) => p.ready), [true, false, true], '谁按了、谁还没好都看得到');
  step(w, idles(w), [{ t: 'unready', player: 2 }]);
  assert.equal(c.ready, false, '取消出战');
  step(w, idles(w), [{ t: 'ready', player: 1 }]);
  assert.equal(w.phase, 'shop');
  const ev = step(w, idles(w), [{ t: 'ready', player: 2 }]);
  assert.equal(w.phase, 'wave');
  assert.ok(ev.some((e) => e.t === 'waveStart' && e.wave === 2));
});

test('多人商店：掉线托管的人不等；剩下的全在托管时等机器人按', () => {
  const w = createWorld(31, 2);
  toShop(w);
  w.players[1].away = true;
  step(w, idles(w), [{ t: 'ready', player: 0 }]);
  assert.equal(w.phase, 'wave', '托管的那个没按也开波');
  const w2 = createWorld(32, 2);
  toShop(w2);
  for (const p of w2.players) p.away = true;
  step(w2, idles(w2), [{ t: 'ready', player: 0 }]);
  assert.equal(w2.phase, 'shop', '全在托管：等两个机器人都按');
  step(w2, idles(w2), [{ t: 'ready', player: 1 }]);
  assert.equal(w2.phase, 'wave');
});

test('出局的人：商店里默认要等他按出战；COOP.waitOut 改成 false 就不等', () => {
  const save = COOP.waitOut;
  try {
    for (const wait of [true, false]) {
      COOP.waitOut = wait;
      const w = createWorld(36, 2);
      toShop(w);
      w.players[1].out = true;
      w.players[1].alive = false;
      step(w, idles(w), [{ t: 'ready', player: 0 }]);
      assert.equal(w.phase, wait ? 'shop' : 'wave');
    }
  } finally {
    COOP.waitOut = save;
  }
});

test('灵石和经验全队共享：谁捡到一颗，每个人各得 value ÷ 刷怪倍率（单人原样）；聚灵丹按各自的算', () => {
  for (const n of [1, 2, 4]) {
    const w = createWorld(33, n);
    quiet(w);
    const p = w.players[0];
    place(w, 0, 400, 300);
    w.gems.push({ id: 900, x: 400, y: 294, px: 400, py: 294, vx: 0, vy: 0, value: 3, pulled: 0 });
    if (n > 1) w.players[1].buffs.gem = 0.5;
    const ev = step(w, idles(w));
    assert.ok(ev.some((e) => e.t === 'pickup' && e.owner === 0 && e.value === 3), '捡到的事件还是记在捡的人身上');
    const each = n === 1 ? 3 : 3 / (1 + COOP.scale.spawn * (n - 1));
    for (const q of w.players) {
      const got = each * (1 + q.buffs.gem);
      assert.ok(Math.abs(q.xp - got) < 1e-9, `${n} 人：${q.id} 号的经验 ${q.xp}，应为 ${got}`);
      assert.ok(Math.abs(q.lingshi + q.lingshiAcc - got) < 1e-9);
    }
    void p;
  }
});

test('转赠灵石：只在商店、只给还在房间里的队友、最多给自己有的', () => {
  const w = createWorld(34, 3);
  const [a, b, c] = w.players;
  a.lingshi = 30;
  step(w, idles(w), [{ t: 'give', player: 0, to: 1, amount: 10 }]);
  assert.equal(a.lingshi, 30, '战斗中不能转');
  toShop(w);
  a.lingshi = 30;
  b.lingshi = 0;
  const ev = step(w, idles(w), [{ t: 'give', player: 0, to: 1, amount: 12.7 }]);
  assert.deepEqual(ev.find((e) => e.t === 'gift'), { t: 'gift', owner: 0, to: 1, amount: 12 });
  assert.equal(a.lingshi, 18);
  assert.equal(b.lingshi, 12);
  step(w, idles(w), [{ t: 'give', player: 0, to: 2, amount: 100 }]);
  assert.equal(a.lingshi, 0, '最多给自己有的');
  assert.equal(c.lingshi, 18);
  step(w, idles(w), [
    { t: 'give', player: 1, to: 1, amount: 5 },
    { t: 'give', player: 1, to: 7, amount: 5 },
    { t: 'give', player: 1, to: 2, amount: -5 },
    { t: 'give', player: 1, to: 2, amount: NaN },
  ]);
  assert.equal(b.lingshi, 12, '给自己、给不存在的人、负数、NaN 都不算');
  c.left = true;
  step(w, idles(w), [{ t: 'give', player: 1, to: 2, amount: 5 }]);
  assert.equal(b.lingshi, 12, '离开的人不能收');
});

test('两个机器人打两章：每人的货架各刷各的，波次照常推进', () => {
  const w = createWorld(36, 2); // 种子要让两个机器人打得完两章（2026-11-11 数值平衡后种子 35 在第 8 波陨落）
  let shops = 0;
  let differ = 0;
  for (let i = 0; i < 60 * 60 * 12 && w.phase !== 'over' && w.phase !== 'win' && w.wave <= 12; i++) {
    const cmds = w.phase === 'shop' ? w.players.flatMap((_, k) => botShop(w, k)) : [];
    const ev = step(w, w.players.map((_, k) => botInput(w, k)), cmds);
    if (ev.some((e) => e.t === 'shopOpen')) {
      shops++;
      if (JSON.stringify(w.players[0].shop) !== JSON.stringify(w.players[1].shop)) differ++;
    }
  }
  assert.ok(w.wave > 12 || w.phase === 'win', `打到了第 ${w.wave} 波（${w.phase}）`);
  assert.ok(shops >= 11);
  assert.equal(differ, shops, '两个人的货架每次都不一样');
  assert.ok(Math.abs(w.players[0].level - w.players[1].level) <= 1, '经验共享：等级差不多');
});

// ---------------------------------------------------------------- 中途加入、离开（roster.ts）

test('中途加入只在商店：基础起手（专属法宝、宠物、1 级）、灵石是在场的人平均数的六成、货架进好货、站在队友身边；满四个人就进不来', () => {
  const w = createWorld(40, 2);
  assert.equal(addPlayer(w, 'nezha'), null, '战斗中不能进');
  toShop(w);
  const [a, b] = w.players;
  a.lingshi = 100;
  b.lingshi = 50;
  a.level = 6;
  const ev: SimEvent[] = [];
  const c = addPlayer(w, 'nezha', ev)!;
  assert.ok(c);
  assert.equal(c.id, 2);
  assert.equal(w.players[2], c);
  assert.equal(c.lingshi, Math.round(75 * COOP.joinLingshi));
  assert.equal(c.level, 1);
  assert.equal(c.xp, 0);
  assert.deepEqual(c.weapons.map((x) => [x.kind, x.tier]), [['qiankun', 1]]);
  assert.equal(c.pet.stage, 0);
  assert.equal(c.hp, c.stats.maxHp);
  assert.equal(c.alive, true);
  assert.equal(c.ready, false);
  assert.ok(c.shop.every((o) => o !== null), '货架进好了货');
  assert.deepEqual(ev, [{ t: 'join', owner: 2, hero: 'nezha', x: c.x, y: c.y, lingshi: c.lingshi }]);
  assert.ok(Math.hypot(c.x - a.x, c.y - a.y) <= 40, '站在队友身边');
  for (const q of [a, b]) assert.ok(Math.hypot(c.x - q.x, c.y - q.y) >= 14, '不和别人挤在一起');
  assert.ok(Math.hypot(c.pet.x - c.x, c.pet.y - c.y) < 40, '宠物跟在他身边');
  assert.equal(headcount(w), 3);
  // 他也要按出战才开波
  step(w, idles(w), [
    { t: 'ready', player: 0 },
    { t: 'ready', player: 1 },
  ]);
  assert.equal(w.phase, 'shop');
  assert.ok(addPlayer(w, 'nezha'), '第四个');
  assert.equal(addPlayer(w, 'nezha'), null, '满四个人了');
  step(w, idles(w), [
    { t: 'ready', player: 2 },
    { t: 'ready', player: 3 },
  ]);
  assert.equal(w.phase, 'wave');
  // 新人能动、会出手（inputs 按编号给）
  const x0 = c.x;
  run(w, 0.5, (w) => w.players.map((p) => (p === c ? { mx: 1, my: 0, skill: false } : idle)));
  assert.ok(c.x > x0 + 30);
});

test('离开：人物消失、不算人数（按人数加强跟着变）、商店不等他、指令不认；空格给下一个加入的人用', () => {
  const w = createWorld(41, 3);
  quiet(w);
  const b = w.players[1];
  place(w, 0, 300, 270);
  place(w, 1, 600, 270);
  place(w, 2, 450, 400);
  const ev: SimEvent[] = [];
  assert.equal(removePlayer(w, 1, ev), true);
  assert.equal(removePlayer(w, 1, ev), false, '已经走了');
  assert.deepEqual(ev, [{ t: 'leave', owner: 1, x: 600, y: 270 }]);
  assert.equal(b.left, true);
  assert.equal(b.alive, false);
  assert.equal(headcount(w), 2);
  assert.equal(spawnMul(w), 1 + COOP.scale.spawn, '按两个人加强');
  assert.equal(w.players.length, 3, '格子留着');
  // 场上：他不动、不出手；剩下两个人照常
  const out = run(w, 1, () => [idle, { mx: 1, my: 0, skill: true }, idle]);
  assert.equal(b.x, 600);
  assert.ok(!out.some((e) => (e.t === 'throw' || e.t === 'skill') && e.owner === 1));
  assert.ok(!out.some((e) => e.t === 'over'));

  // 商店：不等离开的人，他的指令不认；再有人加入就用他的格子
  const s = createWorld(44, 3);
  toShop(s);
  const [a, , c] = s.players;
  a.lingshi = 40;
  c.lingshi = 60;
  removePlayer(s, 1);
  const before = JSON.stringify(s.players[1].shop);
  step(s, idles(s), [{ t: 'reroll', player: 1 }]);
  assert.equal(JSON.stringify(s.players[1].shop), before, '离开的人的指令不认');
  step(s, idles(s), [
    { t: 'ready', player: 0 },
    { t: 'ready', player: 2 },
  ]);
  assert.equal(s.phase, 'wave', '不等离开的人');
  const t = createWorld(45, 3);
  toShop(t);
  t.players[0].lingshi = 40;
  t.players[2].lingshi = 60;
  removePlayer(t, 1);
  const n = addPlayer(t, 'nezha')!;
  assert.equal(n.id, 1, '复用离开的人留下的格子');
  assert.equal(t.players[1], n);
  assert.equal(t.players.length, 3);
  assert.equal(n.lingshi, Math.round(50 * COOP.joinLingshi), '平均数只算在场的人');
  assert.equal(headcount(t), 3);
  step(t, idles(t), [
    { t: 'ready', player: 0 },
    { t: 'ready', player: 2 },
  ]);
  assert.equal(t.phase, 'shop', '等新来的那个');
  step(t, idles(t), [{ t: 'ready', player: 1 }]);
  assert.equal(t.phase, 'wave');
});

test('离开时正被吸过来的灵石改给别人；剩下的人都倒着时离开 → 全队陨落', () => {
  const w = createWorld(42, 2);
  quiet(w);
  place(w, 0, 300, 270);
  place(w, 1, 600, 270);
  w.gems.push({ id: 902, x: 590, y: 262, px: 590, py: 262, vx: 0, vy: 0, value: 4, pulled: 1, vac: true });
  w.gems.push({ id: 903, x: 595, y: 262, px: 595, py: 262, vx: 0, vy: 0, value: 4, pulled: 1 });
  removePlayer(w, 1);
  assert.equal(w.gems[0].pulled, 0, '收灵的那颗改飞给 0 号');
  assert.equal(w.gems[1].pulled, -1, '战斗中被吸着的松开');
  const w2 = createWorld(43, 2);
  quiet(w2);
  knockOut(w2, 0);
  assert.ok(!step(w2, idles(w2)).some((e) => e.t === 'over'));
  removePlayer(w2, 1);
  assert.ok(step(w2, idles(w2)).some((e) => e.t === 'over'), '没人能扶了');
});

// ---------------------------------------------------------------- 掉线托管

test('掉线托管：受到的伤害减半（挨打、魔气都是）；回来就恢复', () => {
  const hit = (away: boolean) => {
    const w = createWorld(50, 2);
    quiet(w);
    if (away) setAway(w, 1, true);
    const ev: SimEvent[] = [];
    hurtPlayer(w, w.players[1], 20, 'contact', ev);
    return ev.find((e) => e.t === 'hurt')!;
  };
  const normal = hit(false);
  const half = hit(true);
  assert.equal(normal.t === 'hurt' && normal.dmg, 20);
  assert.equal(half.t === 'hurt' && half.dmg, 10);
  const drain = (away: boolean) => {
    const w = createWorld(51, 2);
    quiet(w);
    place(w, 1, -20, 270);
    if (away) setAway(w, 1, true);
    run(w, 1);
    return w.players[1].stats.maxHp - w.players[1].hp;
  };
  const d0 = drain(false);
  const d1 = drain(true);
  assert.ok(d0 > 3 && Math.abs(d1 - d0 / 2) < 1e-6, `魔气：${d0.toFixed(2)} → ${d1.toFixed(2)}`);
  const w = createWorld(52, 2);
  quiet(w);
  setAway(w, 1, true);
  setAway(w, 1, false);
  const ev: SimEvent[] = [];
  hurtPlayer(w, w.players[1], 20, 'contact', ev);
  assert.equal((ev.find((e) => e.t === 'hurt') as { dmg: number }).dmg, 20, '回来之后照常');
});

test('setAway：发 away 事件；状态没变、人不在了返回 false；在商店里回来，出战清掉、要自己按', () => {
  const w = createWorld(53, 2);
  const ev: SimEvent[] = [];
  assert.equal(setAway(w, 1, true, ev), true);
  assert.equal(setAway(w, 1, true, ev), false);
  assert.equal(setAway(w, 5, true, ev), false);
  assert.deepEqual(ev, [{ t: 'away', owner: 1, away: true }]);
  assert.equal(w.players[1].away, true);
  toShop(w);
  // 托管时机器人替他按了出战，房主自己还在逛
  step(w, idles(w), [{ t: 'ready', player: 1 }]);
  assert.equal(w.players[1].ready, true);
  assert.equal(w.phase, 'shop');
  setAway(w, 1, false, ev);
  assert.equal(w.players[1].ready, false, '回来了：自己逛、自己按');
  step(w, idles(w), [{ t: 'ready', player: 0 }]);
  assert.equal(w.phase, 'shop', '等他');
  step(w, idles(w), [{ t: 'ready', player: 1 }]);
  assert.equal(w.phase, 'wave');
  removePlayer(w, 1);
  assert.equal(setAway(w, 1, true), false, '离开的人不能托管');
});

test('botTurn：战斗时给 botInput、商店里给 botShop 的指令，收灵、倒地、离开、一局结束时原地不动', () => {
  const w = createWorld(54, 3);
  for (let i = 0; i < 300; i++) step(w, w.players.map((_, k) => botInput(w, k)));
  assert.equal(w.phase, 'wave');
  assert.deepEqual(botTurn(w, 1), { input: botInput(w, 1), commands: [] });
  knockOut(w, 2);
  assert.deepEqual(botTurn(w, 2).input, idle, '倒地的不动');
  removePlayer(w, 2);
  assert.deepEqual(botTurn(w, 2), { input: idle, commands: [] });
  assert.deepEqual(botTurn(w, 9), { input: idle, commands: [] });
  w.waveT = w.waveLen;
  step(w, idles(w));
  assert.equal(w.phase, 'collect');
  assert.deepEqual(botTurn(w, 1), { input: idle, commands: [] });
  while (w.phase !== 'shop') step(w, idles(w));
  assert.deepEqual(botTurn(w, 1), { input: idle, commands: botShop(w, 1) });
  assert.ok(botTurn(w, 1).commands.length === 1);
});

/** 房主的主循环（net-wire 照这个接）：自己和在线的人的操作是真人给的（这里用机器人代替），托管中的人每帧由 botTurn 补上。 */
function hostFrame(w: World, human: (w: World, i: number) => { input: PlayerInput; commands: Command[] }) {
  const inputs: PlayerInput[] = [];
  const commands: Command[] = [];
  for (const p of w.players) {
    const t = p.away ? botTurn(w, p.id) : human(w, p.id);
    inputs[p.id] = t.input;
    commands.push(...t.commands);
  }
  return step(w, inputs, commands);
}

test('掉线托管打一整章：托管的人物照常打、照常逛商店（机器人替他买），商店不等他，回来接着玩', () => {
  const w = createWorld(55, 2);
  setAway(w, 1, true);
  const human = (w: World, i: number) => ({ input: w.phase === 'wave' ? botInput(w, i) : idle, commands: w.phase === 'shop' ? botShop(w, i) : [] });
  let bought = 0;
  for (let i = 0; i < 60 * 60 * 8 && w.phase !== 'over' && w.phase !== 'win' && w.wave <= 4; i++) {
    for (const e of hostFrame(w, human)) if (e.t === 'bought' && e.owner === 1) bought++;
  }
  const b = w.players[1];
  assert.ok(w.wave > 4, `打到第 ${w.wave} 波`);
  assert.ok(b.kills > 20, `托管的人物在打（击杀 ${b.kills}）`);
  assert.ok(bought > 0, '机器人替他买了东西');
  setAway(w, 1, false);
  assert.equal(b.away, false);
});
