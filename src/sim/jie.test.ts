// 劫数（jie.ts）：劫一和原来一样；劫二到劫五每一条词缀都生效；劫数的世界存档能存能恢复、接着跑逐帧一样。
// 劫一完全不变还由 tools/balance.ts 20 的结果逐字不变来保证（改之前、改之后各跑一遍对比，见 scratch/PROGRESS.md）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, digest, spawnEnemy, step, type PlayerInput, type RunSetup, type SimEvent, type World } from './world.ts';
import { botInput, botShop } from './bot.ts';
import { hitEnemy, hurtPlayer } from './core.ts';
import { BOSS, CASTER, DT, ENEMIES, FOES } from './config.ts';
import { JIE, bossEnraged, clampJie, jieInferno, jieRewardText, jieTick, jieTier } from './jie.ts';
import { AFFIX, AFFIXES, affixCount, spawnElite } from './elites/index.ts';
import { canonicalText, restore, snapshot } from './snapshot.ts';
import type { EliteAffix } from './types.ts';

const idle: PlayerInput = { mx: 0, my: 0, skill: false };

/** 机器人打一帧（商店里的指令也由机器人给）。帧循环体单独一个函数（见 tools/balance.ts 开头的 JIT 说明）。 */
function frame(w: World): SimEvent[] {
  const inputs = w.players.map((_, i) => botInput(w, i));
  const cmds = w.phase === 'shop' ? w.players.flatMap((_, i) => botShop(w, i)) : [];
  return step(w, inputs, cmds);
}

/** 一直打到 cond 成立；打输了、通关了还没到就算没到。顺便把一路上的事件交给 seen。 */
function until(w: World, cond: (w: World) => boolean, seen?: (ev: SimEvent[]) => void, max = 60 * 60 * 10): boolean {
  for (let i = 0; i < max; i++) {
    if (w.phase === 'over' || w.phase === 'win') return false;
    const ev = frame(w);
    seen?.(ev);
    if (cond(w)) return true;
  }
  return false;
}

/** 从第 wave 波开打（跳过前面：放进它前面那一波的商店，人物准备好，走一帧就开波）。 */
function startAt(seed: number, wave: number, setup: RunSetup = {}): World {
  const w = createWorld(seed, 1, setup);
  w.wave = wave - 1;
  w.phase = 'shop';
  w.enemies = [];
  w.players[0].ready = true;
  step(w, [idle]);
  assert.equal(w.phase, 'wave');
  assert.equal(w.wave, wave);
  return w;
}

test('劫数的表：五档，名字、称号、词缀都有；夹数：不认识的当劫一，越界的夹在 1..5', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((n) => jieTier(n).name),
    ['劫一', '劫二', '劫三', '劫四', '劫五'],
  );
  for (let n = 1; n <= 5; n++) assert.ok(jieTier(n).title && jieTier(n).adds.length);
  assert.equal(clampJie(undefined), 1);
  assert.equal(clampJie('3'), 1);
  assert.equal(clampJie(Number.NaN), 1);
  assert.equal(clampJie(0), 1);
  assert.equal(clampJie(9), 5);
  assert.equal(clampJie(3.7), 3);
  assert.equal(createWorld(1, 1, { jie: 7 }).jie, 5);
  assert.equal(createWorld(1).jie, 1);
  assert.equal(jieRewardText(1), '灵石、经验、道行如常');
  assert.equal(jieRewardText(5), '灵石、经验 −20% · 道行 ×2.2');
});

test('劫一就是原来的难度：不给劫数和给劫一，机器人打两波多逐帧一样', () => {
  const a = createWorld(11);
  const b = createWorld(11, 1, { jie: 1 });
  for (let i = 0; i < 60 * 110; i++) {
    const ea = JSON.stringify(frame(a));
    const eb = JSON.stringify(frame(b));
    if (ea !== eb || digest(a) !== digest(b)) assert.fail(`第 ${i + 1} 帧不一样`);
  }
  assert.equal(canonicalText(a), canonicalText(b));
  assert.ok(a.wave >= 3, '打到了第 3 波');
});

test('劫二：敌人（刷出来那一刻）和首领（上场时）的气血 +JIE.hp（2026-11-11 起 +15%），别的不变', () => {
  const w1 = createWorld(5);
  const w2 = createWorld(5, 1, { jie: 2 });
  for (const kind of ['soldier', 'elite', 'caster', 'cavalry'] as const) {
    const e1 = spawnEnemy(w1, kind, 400, 300, []);
    const e2 = spawnEnemy(w2, kind, 400, 300, []);
    assert.equal(e2.maxHp, Math.round(e1.maxHp * (1 + JIE.hp)), kind);
    assert.equal(e2.hp, e2.maxHp);
    assert.equal(e2.speed, e1.speed, '劫二不加移速');
    assert.equal(e2.affixes, undefined);
  }
  assert.equal(w1.rng.state, w2.rng.state, '劫二不多用随机数');
  const b1 = startAt(8, 6);
  const b2 = startAt(8, 6, { jie: 2 });
  const boss1 = b1.enemies.find((e) => e.kind === 'boss')!;
  const boss2 = b2.enemies.find((e) => e.kind === 'boss')!;
  assert.ok(boss1 && boss2);
  assert.equal(boss2.maxHp, Math.round(boss1.maxHp * (1 + JIE.hp)));
  // 第二章的首领（姚天君）也一样
  const y1 = startAt(8, 12);
  const y2 = startAt(8, 12, { jie: 2 });
  assert.equal(y2.boss!.kind, 'yao');
  assert.equal(y2.enemies.find((e) => e.kind === 'boss')!.maxHp, Math.round(y1.enemies.find((e) => e.kind === 'boss')!.maxHp * (1 + JIE.hp)));
});

test('劫三：每个普通波多一只精英（第 1 波也来；第 4 波来两只），敌人移速 +8%', () => {
  const elites = (w: World) => {
    let n = 0;
    const ok = until(w, (x) => x.waveT >= x.waveLen * 0.5, (ev) => (n += ev.filter((e) => e.t === 'spawn' && e.kind === 'elite').length));
    assert.ok(ok, '打到了这一波的一半');
    return n;
  };
  assert.equal(elites(startAt(3, 1)), 0, '劫一的第 1 波没有精英');
  assert.equal(elites(startAt(3, 1, { jie: 3 })), 1);
  assert.equal(elites(startAt(3, 4)), 1, '劫一的第 4 波一只');
  assert.equal(elites(startAt(3, 4, { jie: 3 })), 2);
  assert.equal(elites(startAt(3, 4, { jie: 2 })), 1, '劫二不多');
  // 移速：同一个随机数抽出来的速度，劫三的乘 1.08
  const w1 = createWorld(6);
  const w3 = createWorld(6, 1, { jie: 3 });
  for (const kind of ['soldier', 'spearman', 'bomber'] as const) {
    const e1 = spawnEnemy(w1, kind, 300, 300, []);
    const e3 = spawnEnemy(w3, kind, 300, 300, []);
    assert.ok(Math.abs(e3.speed - e1.speed * (1 + JIE.speed)) < 1e-9, kind);
  }
});

test('劫四：鬼火飞得快、骑兵冲得快 25%，首领打人 +20%，魔焰焚城推进的间隔 ×0.75', () => {
  // 鬼火：术士放出来的那一团
  const orbSpeed = (setup: RunSetup) => {
    const w = startAt(4, 3, setup);
    w.spawnAcc = -1e12;
    w.eliteDone = w.surgeDone = true;
    w.enemies = [];
    const p = w.players[0];
    p.weapons = [];
    p.iframes = 1e9;
    const c = spawnEnemy(w, 'caster', p.x + 110, p.y, []);
    c.cd = 0;
    for (let i = 0; i < 120 && !w.orbs.length; i++) step(w, [idle]);
    assert.equal(w.orbs.length, 1);
    return Math.hypot(w.orbs[0].vx, w.orbs[0].vy);
  };
  assert.ok(Math.abs(orbSpeed({}) - CASTER.orbSpeed) < 1e-6);
  assert.ok(Math.abs(orbSpeed({ jie: 4 }) - CASTER.orbSpeed * (1 + JIE.shot)) < 1e-6);
  assert.ok(Math.abs(orbSpeed({ jie: 3 }) - CASTER.orbSpeed) < 1e-6, '劫三还不快');
  // 骑兵冲锋：冲锋线的长度 / 冲锋时长 = 冲锋速度
  const charge = (setup: RunSetup) => {
    const w = startAt(4, 3, setup);
    w.spawnAcc = -1e12;
    w.eliteDone = w.surgeDone = true;
    w.enemies = [];
    const p = w.players[0];
    p.weapons = [];
    p.iframes = 1e9;
    const c = spawnEnemy(w, 'cavalry', p.x + 160, p.y, []);
    c.cd = 0;
    c.speed = 0;
    for (let i = 0; i < 300; i++) {
      for (const e of step(w, [idle])) if (e.t === 'foeStrike' && e.kind === 'cavalry') return Math.hypot(e.x1 - e.x0, e.y1 - e.y0) / e.dur;
    }
    assert.fail('骑兵没冲');
  };
  assert.ok(Math.abs(charge({}) - FOES.cavalry.speed) < 1e-6);
  assert.ok(Math.abs(charge({ jie: 4 }) - FOES.cavalry.speed * (1 + JIE.shot)) < 1e-6);
  // 首领的伤害（来源是 'boss' 的）+20%，别的来源不变
  const hurt = (jie: number, by: 'boss' | 'contact') => {
    const w = createWorld(2, 1, { jie });
    const p = w.players[0];
    const ev: SimEvent[] = [];
    hurtPlayer(w, p, 30, by, ev);
    return p.stats.maxHp - p.hp;
  };
  assert.equal(hurt(1, 'boss'), 30);
  assert.equal(hurt(4, 'boss'), 36);
  assert.equal(hurt(5, 'boss'), 36);
  assert.equal(hurt(4, 'contact'), 30);
  assert.equal(jieInferno(createWorld(1, 1, { jie: 3 })), 1);
  assert.equal(jieInferno(createWorld(1, 1, { jie: 4 })), JIE.inferno);
});

test('劫四：魔焰焚城（第一章首领的三阶段）每一步推进的间隔缩短', () => {
  const gaps = (jie: number) => {
    const w = startAt(9, 6, { jie });
    const p = w.players[0];
    p.iframes = 1e12;
    p.hp = p.stats.maxHp = 1e9;
    p.weapons = [];
    const b = w.enemies.find((e) => e.kind === 'boss')!;
    // 直接打到三阶段：气血压到 30% 以下，下一帧换阶段
    b.invuln = 0;
    const pushes: number[] = [];
    for (let i = 0; i < 60 * 40 && pushes.length < 3; i++) {
      if (w.boss && w.boss.phase < 3 && w.boss.state !== 'phase' && w.boss.state !== 'intro') {
        b.invuln = 0;
        b.hp = Math.min(b.hp, Math.floor(b.maxHp * (w.boss.phase === 1 ? 0.59 : 0.29)));
      }
      for (const e of step(w, [idle])) if (e.t === 'bossMiasma') pushes.push(w.time);
    }
    assert.equal(pushes.length, 3, `劫${jie}推进了三步`);
    return [pushes[1] - pushes[0], pushes[2] - pushes[1]];
  };
  const g1 = gaps(1);
  const g4 = gaps(4);
  // 推进本身要 push 秒，间隔是推完之后再等 every 秒
  for (let i = 0; i < 2; i++) assert.ok(Math.abs(g4[i] - (g1[i] - BOSS.inferno.every * (1 - JIE.inferno))) < 0.05, `第 ${i + 1} 个间隔：劫一 ${g1[i].toFixed(2)}、劫四 ${g4[i].toFixed(2)}`);
});

test('劫五：精英带两条不重样的词缀（五条都会出），迅捷快一半；劫一第一章不带、别的一条（词缀的细节在 elites.test.ts）', () => {
  const w3 = createWorld(12, 1, { jie: 3 });
  const w5 = createWorld(12, 1, { jie: 5 });
  w3.wave = w5.wave = 2;
  assert.equal(affixCount(w5), 2);
  assert.equal(affixCount(w3), 1);
  assert.equal(affixCount(createWorld(1)), 0, '劫一第一章不带');
  const w1 = createWorld(1);
  w1.wave = 7;
  assert.equal(affixCount(w1), 1, '劫一第二章起带一条');
  const seen = new Set<EliteAffix>();
  const base = spawnElite(w3, 'xiaowei', 300, 300, [], []);
  for (let i = 0; i < 40; i++) {
    const e = spawnElite(w5, 'xiaowei', 300, 300, []);
    assert.equal(e.affixes?.length, 2);
    assert.notEqual(e.affixes![0], e.affixes![1], '不重样');
    for (const a of e.affixes!) seen.add(a);
    const [lo, hi] = ENEMIES.elite.speed;
    const k = 1 + JIE.speed;
    const sw = e.affixes!.includes('swift') ? AFFIX.swift.speed : 1;
    assert.ok(e.speed >= lo * k * sw - 1e-9 && e.speed <= hi * k * sw + 1e-9);
    assert.equal(e.maxHp, base.maxHp, '词缀不加气血（坚甲是减伤）');
  }
  assert.deepEqual([...seen].sort(), [...AFFIXES].sort());
  assert.equal(spawnEnemy(w5, 'soldier', 300, 300, []).affixes, undefined, '只有精英带词缀');
});

test('劫五：首领进了三阶段狂暴，两招之间的空闲、收招快 1.6 倍；出招时不动', () => {
  const w = startAt(9, 6, { jie: 5 });
  const b = w.boss!;
  b.phase = 3;
  b.state = 'idle';
  b.t = 0;
  jieTick(w);
  assert.ok(Math.abs(b.t - DT * (JIE.rage - 1)) < 1e-12);
  assert.equal(bossEnraged(w), true);
  b.state = 'cast';
  b.t = 0;
  jieTick(w);
  assert.equal(b.t, 0, '出招的计时不动（预警照原来的节奏）');
  b.phase = 2;
  b.state = 'recover';
  jieTick(w);
  assert.equal(b.t, 0, '二阶段不狂暴');
  const w4 = startAt(9, 6, { jie: 4 });
  w4.boss!.phase = 3;
  w4.boss!.state = 'idle';
  w4.boss!.t = 0;
  jieTick(w4);
  assert.equal(w4.boss!.t, 0, '劫四不狂暴');
  assert.equal(bossEnraged(w4), false);
});

test('劫数越高，灵石、经验越少（劫五各 −20%；用户 11-12）', () => {
  const pick = (jie: number) => {
    const w = startAt(14, 2, { jie });
    w.spawnAcc = -1e12;
    w.eliteDone = w.surgeDone = true;
    w.enemies = [];
    const p = w.players[0];
    const xp0 = p.xp;
    const ls0 = p.lingshi + p.lingshiAcc;
    w.gems.push({ id: w.nextId++, x: p.x + 2, y: p.y - 6, px: p.x + 2, py: p.y - 6, vx: 0, vy: 0, value: 10, pulled: -1 });
    for (let i = 0; i < 30 && w.gems.length; i++) step(w, [idle]);
    assert.equal(w.gems.length, 0);
    return { ls: p.lingshi + p.lingshiAcc - ls0, xp: p.xp - xp0 };
  };
  const a = pick(1);
  const b = pick(5);
  assert.ok(Math.abs(a.ls - 10) < 1e-9);
  assert.ok(Math.abs(b.ls - 10 * (1 + JIE.lingshi * 4)) < 1e-9);
  assert.ok(Math.abs(b.xp - a.xp * (1 + JIE.xp * 4)) < 1e-9);
  assert.ok(b.ls < a.ls && b.xp < a.xp);
});

test('劫五的世界存档能存能恢复：打到有带词缀的精英时存一份，恢复后接着跑逐帧一样（劫数、词缀都在存档里）', () => {
  const w = createWorld(21, 1, { jie: 5 });
  assert.ok(until(w, (x) => x.enemies.some((e) => !!e.affixes?.length) && x.waveT > 9), '第 1 波就来了带词缀的精英');
  const s = JSON.parse(JSON.stringify(snapshot(w)));
  const b = restore(s);
  assert.equal(b.jie, 5);
  assert.deepEqual(
    b.enemies.filter((e) => e.affixes).map((e) => e.affixes),
    w.enemies.filter((e) => e.affixes).map((e) => e.affixes),
  );
  for (let i = 0; i < 60 * 25; i++) {
    const ea = JSON.stringify(frame(w));
    const eb = JSON.stringify(frame(b));
    if (ea !== eb || digest(w) !== digest(b)) assert.fail(`恢复后第 ${i + 1} 帧跑岔了`);
  }
  assert.equal(canonicalText(b), canonicalText(w));
});
