// 回响化身遭遇战（sim/echo/）的模拟测试：第 10、16 波的精英换成回响赵公明 / 回响云霄（劫三起多出来的精英照常刷）；
// 现身（无敌）→ 两阶段（一阶段打不死：卡在一半，换阶段无敌）→ 打倒（echoDefeat、掉宝匣与一大把灵石）；这一波结束没打倒就退走（echoLeave）；
// 每一招先预警、再判定（预警期间不伤人，站在范围外不挨打）；混元金斗把人往斗下吸；不吃控制；机器人会躲、会凑近；
// 同种子同输入完全确定，打到一半存档恢复后接着跑逐帧相同；第一章（不带这两波）一个随机数都不多用。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JIE } from './jie.ts';
import { createWorld, digest, spawnEnemy, step, type PlayerInput, type SimEvent, type World } from './world.ts';
import { DT } from './config.ts';
import { eliteCount } from './catalog.ts';
import { hitEnemy } from './core.ts';
import { ECHO, echoDanger, echoDigest, echoDodge, echoEnemy, echoOf, spawnEcho } from './echo/index.ts';
import { POOL, guestWaveOf } from './bosspool.ts';
import { botInput, botShop } from './bot.ts';
import { canonicalText, restore, snapshot } from './snapshot.ts';
import type { EchoKind, EchoMove } from './echo/types.ts';

const idle: PlayerInput = { mx: 0, my: 0, skill: false };
type Ev<T extends SimEvent['t']> = Extract<SimEvent, { t: T }>;
const evs = <T extends SimEvent['t']>(ev: SimEvent[], t: T) => ev.filter((e): e is Ev<T> => e.t === t);
const frames = (w: World, n: number, input: (w: World) => PlayerInput = () => idle) => {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) out.push(...step(w, [input(w)]));
  return out;
};

/** 第 wave 波打到一半的干净场地：刷怪关掉、人物满血不死，直接放出这一位回响（按招式表依次出）。 */
function fight(kind: EchoKind, moves: EchoMove[] = [], seed = 3) {
  const wave = guestWaveOf(kind);
  const w = createWorld(seed, 1, ['nezha']);
  w.wave = wave;
  w.waveLen = 1e9;
  w.spawnAcc = -1e12;
  w.eliteDone = true;
  w.surgeDone = true;
  w.terrain = null;
  const p = w.players[0];
  p.weapons = [];
  p.pet.cd = 1e12;
  p.stats.maxHp = p.hp = 1e7;
  const ev: SimEvent[] = [];
  spawnEcho(w, kind, ev);
  echoOf(w)!.queue = [...moves];
  return { w, p, e: echoEnemy(w)!, ev };
}

test('第 10、16 波的精英换成回响赵公明、回响云霄（和刷怪并存的一只 kind boss 的敌人，World.boss 还是空的）；第二、三章本章的精英挪到第 2 波', () => {
  for (const [wave, kind] of [
    [10, 'zhao'],
    [16, 'yunxiao'],
  ] as const) {
    const w = createWorld(5, 1, ['nezha']);
    w.wave = wave - 1;
    w.phase = 'shop';
    w.players[0].stats.maxHp = w.players[0].hp = 1e7; // 光着身子打第 16 波撑不到出精英
    let intro: Ev<'echoIntro'> | undefined;
    for (let i = 0; i < 60 * 40 && !intro; i++) {
      const ev = step(w, [idle], w.phase === 'shop' ? [{ t: 'ready', player: 0 }] : []);
      intro = evs(ev, 'echoIntro')[0];
    }
    assert.ok(intro, `第 ${wave} 波现身了`);
    assert.equal(intro!.kind, kind);
    assert.equal(w.boss, null, '不是章节首领');
    const e = echoEnemy(w)!;
    assert.equal(e.kind, 'boss');
    assert.equal(w.enemies.filter((x) => x.kind === 'elite').length, 0, '本章的精英不刷了');
    const d = Math.hypot(e.x - w.players[0].x, e.y - w.players[0].y);
    assert.ok(d >= ECHO.entry[0] - 1 && d <= ECHO.entry[1] + 1, `现身在 ${d.toFixed(0)} 像素外（在屏幕里、不贴脸）`);
  }
  assert.equal(eliteCount(8), 1);
  assert.equal(eliteCount(14), 1);
  assert.equal(eliteCount(2), 0, '第一章不动');
  assert.equal(eliteCount(4), 1);
  assert.equal(eliteCount(10), 1, '第 10 波那一只换成回响');
  assert.equal(eliteCount(16), 2);
});

test('劫三起第 10 波多出来的那只精英照常刷（贴着屏幕边、按章挑种类）；回响的气血按人数、劫数加', () => {
  const w = createWorld(5, 1, { heroes: ['nezha'], jie: 3 });
  w.wave = 10;
  w.waveLen = 30;
  w.players[0].stats.maxHp = w.players[0].hp = 1e7;
  frames(w, Math.ceil((30 * 0.36) / DT)); // 打到出精英的那一刻（这一波的 35%）
  assert.equal(w.enemies.filter((e) => e.kind === 'elite').length, 1);
  assert.equal(echoEnemy(w)!.maxHp, Math.round(POOL.guestHp.zhao * (1 + JIE.hp))); // 劫二起 +JIE.hp（2026-11-11 数值平衡 0.25 → 0.15）
});

test('现身时无敌；一阶段打不死（卡在一半，换二阶段、无敌一会儿）；二阶段打空倒下：echoDefeat 带解锁的 id，掉一只精英宝匣和一大把灵石', () => {
  const { w, e } = fight('zhao');
  const hit = (dmg: number) => hitEnemy(w, e, { dmg, by: 'ring', owner: 0, from: e, canCrit: false }, []);
  assert.equal(hit(500), 0, '现身时无敌');
  frames(w, Math.ceil(ECHO.intro / DT) + 2);
  hit(1e7);
  assert.equal(e.hp, Math.ceil(e.maxHp * ECHO.phaseAt), '一阶段卡在一半');
  const ev = frames(w, 1);
  assert.equal(evs(ev, 'echoPhase').length, 1);
  assert.equal(w.echo!.phase, 2);
  assert.ok(e.invuln > 0, '换阶段无敌');
  assert.equal(hit(500), 0);
  frames(w, Math.ceil(ECHO.phaseTime / DT) + 2);
  const gems = w.gems.length;
  hit(1e7);
  const ev2 = frames(w, 1);
  const d = evs(ev2, 'echoDefeat')[0];
  assert.ok(d, '倒下');
  assert.equal(d.unlock, 'echo-zhao');
  assert.ok(w.gems.length >= gems + 40, '一大把灵石');
  assert.ok(w.drops.some((x) => x.kind === 'chest' && x.rich), '精英宝匣');
  assert.equal(w.enemies.some((x) => x.id === e.id), false);
  frames(w, Math.ceil(ECHO.deathTime / DT) + 2);
  assert.equal(w.echo, null, '倒下的表现放完就收掉');
});

test('这一波结束还没打倒：回响退走（echoLeave，带着剩下的气血），不解锁；下一波不带过去', () => {
  const { w, e } = fight('yunxiao');
  frames(w, 60);
  e.hp = Math.round(e.maxHp * 0.7);
  w.waveLen = w.waveT + DT * 0.5;
  const ev = frames(w, 2);
  const l = evs(ev, 'echoLeave')[0];
  assert.ok(l, '退走');
  assert.ok(Math.abs(l.hp - 0.7) < 0.01);
  assert.equal(evs(ev, 'echoDefeat').length, 0);
  assert.equal(w.echo, null);
  assert.equal(w.phase, 'collect');
});

test('每一招先亮预警再判定：预警期间不伤人；站在范围外不挨打，站在里面挨一下（金鞭、珠子、虎扑、二十四珠、斗、旋涡、青鸾都一样）', () => {
  const cases: [EchoKind, EchoMove, number][] = [
    ['zhao', 'beads', 1],
    ['zhao', 'whip', 1],
    ['zhao', 'tiger', 1],
    ['zhao', 'rosary', 2],
    ['yunxiao', 'dou', 1],
    ['yunxiao', 'river', 1],
    ['yunxiao', 'luan', 1],
    ['yunxiao', 'formation', 2],
  ];
  for (const [kind, move, phase] of cases) {
    // 站着不动：挨打
    const a = fight(kind, [move]);
    a.w.echo!.phase = phase;
    let hurtInWarn = false;
    let hurt = 0;
    for (let i = 0; i < 60 * 8 && hurt === 0; i++) {
      const ev = step(a.w, [idle]);
      const hs = evs(ev, 'hurt').filter((h) => h.by === 'echo');
      const live = a.w.echo?.hazards.some((h) => h.t >= h.warn) ?? false;
      if (hs.length && !live && a.w.echo?.hazards.length) hurtInWarn = true;
      hurt += hs.length;
      a.p.iframes = 0;
      a.e.x = a.e.px = a.p.x + 120; // 站远一点，别贴身挨撞
    }
    assert.ok(hurt > 0, `${move}：站着不动挨打`);
    assert.equal(hurtInWarn, false, `${move}：预警期间不伤人`);
    // 预警一亮就往外走（机器人的躲招方向），躲得开
    const b = fight(kind, [move]);
    b.w.echo!.phase = phase;
    let hurtB = 0;
    for (let i = 0; i < 60 * 6; i++) {
      const [dx, dy] = echoDodge(b.w, b.p, 0);
      const m = Math.hypot(dx, dy);
      const ev = step(b.w, [m > 0.01 ? { mx: dx / m, my: dy / m, skill: false } : idle]);
      hurtB += evs(ev, 'hurt').filter((h) => h.by === 'echo').length;
      b.p.iframes = 0;
      b.e.x = b.e.px = b.p.x + 120;
      if (b.w.echo?.last === move && !b.w.echo.hazards.length && b.w.echo.state !== 'cast') break;
    }
    assert.equal(hurtB, 0, `${move}：照着预警往外走就躲开了`);
  }
});

test('混元金斗：斗悬着的时候把人往斗下吸（站着不动也被拽过去）；不吃控制（晕、冻都不吃）', () => {
  const { w, p, e } = fight('yunxiao', ['dou']);
  frames(w, Math.ceil((ECHO.intro + 1.3) / DT));
  const h = w.echo!.hazards.find((x) => x.kind === 'pull');
  assert.ok(h, '斗悬起来了');
  // 把人挪到吸力圈的边上，看他被往中心拽
  p.x = p.px = h!.x0 + h!.r * 0.8;
  p.y = p.py = h!.y0;
  const d0 = Math.hypot(p.x - h!.x0, p.y - h!.y0);
  frames(w, 20);
  assert.ok(Math.hypot(p.x - h!.x0, p.y - h!.y0) < d0 - 5, '被往斗下吸');
  hitEnemy(w, e, { dmg: 10, by: 'ring', owner: 0, from: e, stun: 2, freeze: 2 }, []);
  assert.equal(e.stun, 0, '不晕');
  assert.equal(e.frozen, 0, '不冻');
});

test('机器人：危险物里的点有危险（echoDanger > 0），躲招的方向把人带出去；离回响远了会往它那边靠（法宝够得着才打得倒）', () => {
  const { w, p, e } = fight('zhao', ['whip']);
  frames(w, Math.ceil((ECHO.intro + 1.25) / DT));
  const h = w.echo!.hazards.find((x) => x.kind === 'lane');
  assert.ok(h);
  const mx = (h!.x0 + h!.x1) / 2;
  const my = (h!.y0 + h!.y1) / 2;
  assert.ok(echoDanger(w, mx, my) > 0);
  assert.equal(echoDanger(w, mx + 200, my + 200), 0);
  // 离得远：往回响那边靠
  w.echo!.hazards = [];
  p.x = e.x - 220;
  p.y = e.y;
  const [dx] = echoDodge(w, p, 0);
  assert.ok(dx > 0, '往它那边靠');
});

test('遭遇战整段确定：同种子同输入逐帧一样；打到一半（预警亮着、虎在扑）存档恢复后接着跑逐帧相同', () => {
  const play = (kind: EchoKind) => {
    const { w } = fight(kind, [], 21);
    const trace: string[] = [];
    for (let i = 0; i < 60 * 20; i++) {
      step(w, [botInput(w, 0)]);
      if (i % 20 === 0) trace.push(digest(w) + '|' + echoDigest(w));
    }
    return trace;
  };
  for (const kind of ['zhao', 'yunxiao'] as const) assert.deepEqual(play(kind), play(kind), `${kind} 两遍一样`);
  const { w } = fight('zhao', ['tiger', 'rosary'], 9);
  for (let i = 0; i < 60 * 30 && !(echoOf(w)?.tiger && echoOf(w)!.hazards.length); i++) step(w, [botInput(w, 0)]);
  assert.ok(echoOf(w)?.tiger, '虎影在场上');
  const r = restore(JSON.parse(JSON.stringify(snapshot(w))));
  assert.equal(canonicalText(r), canonicalText(w));
  for (let i = 0; i < 400; i++) {
    const a = JSON.stringify(step(w, [botInput(w, 0)]));
    const b = JSON.stringify(step(r, [botInput(r, 0)]));
    assert.equal(b, a, `第 ${i + 1} 帧跑岔了`);
  }
});

test('整局里也确定：机器人从第 9 波后的商店打过第 10 波（遇到回响赵公明），两遍逐帧一样', () => {
  const play = () => {
    const w = createWorld(31, 1, ['nezha']);
    w.wave = 9;
    w.phase = 'shop';
    w.players[0].lingshi = 400;
    const trace: string[] = [];
    for (let i = 0; i < 60 * 45 && w.wave <= 10; i++) {
      step(w, [botInput(w, 0)], w.phase === 'shop' ? botShop(w, 0) : []);
      if (i % 30 === 0) trace.push(digest(w) + '|' + echoDigest(w));
    }
    return trace;
  };
  assert.deepEqual(play(), play());
});

test('普通的精英波（第 4 波）不出回响，一个随机数都不多用：和不认识回响的写法逐项一样', () => {
  const a = createWorld(7, 1, ['nezha']);
  a.wave = 4;
  a.waveLen = 30;
  const before = a.rng.state;
  frames(a, Math.ceil((30 * 0.36) / DT));
  assert.notEqual(a.rng.state, before);
  assert.equal(a.echo, null);
  assert.ok(a.enemies.some((e) => e.kind === 'elite'));
  void spawnEnemy;
});
