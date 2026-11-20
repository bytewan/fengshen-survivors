import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, digest, step, type PlayerInput, type SimEvent, type World } from './world.ts';
import { ARENA, BOSS, DT, MIASMA } from './config.ts';
import { hitEnemy } from './core.ts';
import { botInput, botShop } from './bot.ts';
import { bossDigest, bossEnemy, innerRect, nezhaOf, segDist, type BossFight, type BossMove, type Hazard } from './boss.ts';

/** 这一章的首领是魔化哪吒（第一、三章）：拿它的状态。 */
const nz = (w: World): BossFight => nezhaOf(w)!;

const idle: PlayerInput = { mx: 0, my: 0, skill: false };
const CX = ARENA.w / 2;
const CY = ARENA.h / 2;

/** 从第 5 波后的商店直接开第 6 波（首领波）；玩家不带法宝（测试里手动扣首领的血），站在 (px, py)。 */
function bossWorld(seed = 1, px = CX, py = CY): World {
  const w = createWorld(seed);
  w.wave = 5;
  w.phase = 'shop';
  w.enemies = [];
  const p = w.players[0];
  p.weapons = [];
  p.x = p.px = px;
  p.y = p.py = py;
  p.ready = true;
  step(w, [idle]);
  assert.ok(nezhaOf(w), '第 6 波开始时首领入场');
  nz(w).summonT = 1e9; // 只测首领本身，不刷小兵
  return w;
}
const run = (w: World, seconds: number, input: (w: World) => PlayerInput = () => idle) => {
  const ev: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) ev.push(...step(w, [input(w)]));
  return ev;
};
/** 把首领摆到 (x, y)，下一帧就出指定的招。 */
function cast(w: World, move: BossMove, x: number, y: number, phase = 1) {
  const f = nz(w);
  const b = bossEnemy(w)!;
  b.x = b.px = x;
  b.y = b.py = y;
  b.invuln = 0;
  f.phase = phase;
  f.queue = [move];
  f.state = 'idle';
  f.t = 0;
  f.lt = 0;
  f.dur = 0;
  f.hazards = [];
  f.clones = [];
}
const hurts = (ev: SimEvent[]) => ev.filter((e) => e.t === 'hurt' && e.by === 'boss');
const smash = (w: World, frac: number) => {
  const b = bossEnemy(w)!;
  const ev: SimEvent[] = [];
  hitEnemy(w, b, { dmg: Math.ceil(b.maxHp * frac), by: 'skill', owner: 0, from: b, canCrit: false }, ev);
  return ev;
};

test('首领入场：离玩家 150–200 像素、在场地里面，不贴脸；入场期间无敌', () => {
  for (const [px, py] of [
    [CX, CY],
    [30, 30],
    [ARENA.w - 20, CY],
    [CX, ARENA.h - 15],
    [ARENA.w - 30, 25],
  ]) {
    const w = bossWorld(7, px, py);
    const b = bossEnemy(w)!;
    const d = Math.hypot(b.x - px, b.y - py);
    assert.ok(d >= 140 && d <= 210, `玩家在 (${px},${py}) 时首领离得 ${d.toFixed(0)}`);
    assert.ok(b.x > 0 && b.x < ARENA.w && b.y > 0 && b.y < ARENA.h, '首领在场地里');
    assert.ok(b.invuln > 0);
    assert.equal(w.boss!.state, 'intro');
  }
  const w = bossWorld(8);
  const b = bossEnemy(w)!;
  const hp = b.hp;
  smash(w, 0.2);
  assert.equal(b.hp, hp, '入场时打不动');
});

test('三阶段按血量切换；换阶段无敌约 2 秒；一次大伤害（哪怕致命）也只卡在阈值上，不跳阶段', () => {
  const w = bossWorld(2);
  w.players[0].iframes = 1e9;
  run(w, BOSS.intro + 0.2);
  const f = nz(w);
  const b = bossEnemy(w)!;
  assert.equal(f.phase, 1);
  smash(w, 1.5); // 一下打空：本该直接死
  const ev = run(w, DT);
  assert.equal(f.phase, 2, '只换到二阶段');
  assert.equal(b.hp, Math.ceil(b.maxHp * BOSS.phases[0]), '血卡在 60%');
  assert.ok(ev.some((e) => e.t === 'bossPhase' && e.phase === 2));
  assert.ok(w.enemies.includes(b) && w.phase === 'wave', '没有死');
  assert.ok(b.invuln > 1.9, '换阶段无敌约 2 秒');
  smash(w, 0.2);
  assert.equal(b.hp, Math.ceil(b.maxHp * BOSS.phases[0]), '无敌期间打不动');
  run(w, BOSS.phaseTime + 0.2);
  assert.equal(b.invuln, 0);
  smash(w, 0.35); // 60% → 25%：跨过 30%
  run(w, DT);
  assert.equal(f.phase, 3);
  assert.equal(b.hp, Math.ceil(b.maxHp * BOSS.phases[1]));
});

test('每一招都先预警、再结算：预警期间不伤人；站着不动挨打，提前躲开不挨打', () => {
  const cases: { move: BossMove; phase: number; dodge: (w: World) => PlayerInput }[] = [
    { move: 'ring', phase: 1, dodge: () => ({ mx: 0, my: -1, skill: false }) },
    { move: 'dash', phase: 1, dodge: () => ({ mx: 0, my: -1, skill: false }) },
    // 三头六臂：三条线都是横的，一直往上（或往下）走就全躲开
    { move: 'clones', phase: 2, dodge: () => ({ mx: 0, my: 1, skill: false }) },
    // 风火轮：哪条车道压着自己，就朝离开那条车道的方向（车道的法线）走，走出来就停
    {
      move: 'wheels',
      phase: 3,
      dodge: (w) => {
        const p = w.players[0];
        let mx = 0;
        let my = 0;
        for (const h of nz(w).hazards) {
          if (h.kind !== 'wheel') continue;
          const sx = h.t > h.warn ? h.x : h.x0;
          const sy = h.t > h.warn ? h.y : h.y0;
          if (segDist(p.x, p.y, sx, sy, h.x1, h.y1) > h.r + 5 + 3) continue;
          const len = Math.hypot(h.x1 - h.x0, h.y1 - h.y0);
          const nx = -(h.y1 - h.y0) / len;
          const ny = (h.x1 - h.x0) / len;
          const side = (p.x - h.x0) * nx + (p.y - h.y0) * ny >= 0 ? 1 : -1;
          mx += nx * side;
          my += ny * side;
        }
        return { mx, my, skill: false };
      },
    },
  ];
  for (const c of cases) {
    for (const dodge of [false, true]) {
      const w = bossWorld(11);
      run(w, BOSS.intro + 0.2);
      cast(w, c.move, CX + 120, CY - 10, c.phase);
      const ev: SimEvent[] = [];
      let strikeAt = -1;
      let castAt = -1;
      for (let i = 0; i < 60 * 4; i++) {
        const e2 = step(w, [dodge ? c.dodge(w) : idle]);
        for (const e of e2) {
          if (e.t === 'bossCast' && castAt < 0) castAt = i;
          if (e.t === 'bossStrike' && strikeAt < 0) strikeAt = i;
          if (e.t === 'hurt' && e.by === 'boss') assert.ok(strikeAt >= 0 && i >= strikeAt, `${c.move}：在预警结束前就挨打了`);
        }
        ev.push(...e2);
        if (w.boss!.state === 'idle' && castAt >= 0) nz(w).dur = 1e9; // 出完这一招就站着，不接下一招
        if (w.boss!.state !== 'cast' && castAt >= 0 && !nz(w).hazards.length) break;
      }
      assert.ok(castAt >= 0 && strikeAt > castAt, `${c.move}：先预警后出手`);
      if (dodge) assert.equal(hurts(ev).length, 0, `${c.move}：提前躲开不该挨打`);
      else assert.ok(hurts(ev).length > 0, `${c.move}：站着不动该挨打`);
    }
  }
});

test('混天绫横扫：往扫动的反方向（越过起始那条边）走一小段就躲开；顺着扫的方向跑会被追上', () => {
  for (const seed of [21, 22, 23, 24]) {
    for (const way of ['back', 'with', 'still'] as const) {
      const w = bossWorld(seed);
      run(w, BOSS.intro + 0.2);
      cast(w, 'sweep', CX + 130, CY + 20, 2);
      const ev: SimEvent[] = [];
      let h: Hazard | undefined;
      for (let i = 0; i < 60 * 3; i++) {
        h ??= nz(w).hazards.find((x) => x.kind === 'sweep');
        let inp = idle;
        if (h && way !== 'still') {
          // 起始边的方向是 a0；往反方向躲 = 朝 a0 - dir·90° 的法线走，顺着扫 = 反过来
          const n = h.a0 - h.dir * (Math.PI / 2) * (way === 'back' ? 1 : -1);
          inp = { mx: Math.cos(n), my: Math.sin(n), skill: false };
        }
        ev.push(...step(w, [inp]));
        if (h && !nz(w).hazards.includes(h)) break;
      }
      assert.ok(h, '放出了横扫');
      if (way === 'back') assert.equal(hurts(ev).length, 0, `种子 ${seed}：往反方向躲开了还挨打`);
      else assert.equal(hurts(ev).length, 1, `种子 ${seed}：${way === 'still' ? '站着不动' : '顺着扫'}该挨打一次`);
    }
  }
});

test('魔焰焚城：进入三阶段后魔气从四边往里推，原本安全的边缘开始掉血、减速；首领死了魔气退回去', () => {
  const w = bossWorld(5, 16, CY);
  const p = w.players[0];
  p.iframes = 1e9;
  p.hp = p.stats.maxHp = 1e6;
  run(w, BOSS.intro + 0.2);
  const f = nz(w);
  const b = bossEnemy(w)!;
  b.x = b.px = CX + 200; // 离远一点，免得接触伤害
  const before = p.hp;
  run(w, 1);
  assert.equal(p.miasma, 0, '站在仙台边上还没进魔气');
  assert.equal(p.hp, before);
  smash(w, 0.5); // 打进二阶段（一次只能换一个阶段）
  run(w, BOSS.phaseTime + 0.2);
  smash(w, 0.4); // 再打进三阶段
  const ev = run(w, BOSS.inferno.first + BOSS.inferno.push + 0.2);
  assert.equal(f.phase, 3);
  assert.ok(ev.some((e) => e.t === 'bossMiasma'), '换到三阶段就施放魔焰焚城');
  assert.ok(w.miasmaInset.x >= BOSS.inferno.max.x / BOSS.inferno.steps - 0.01 && w.miasmaInset.y > 0, '魔气往里推了一步');
  assert.ok(w.miasmaInset.x > w.miasmaInset.y, '左右推得多、上下推得少');
  assert.ok(p.miasma > 0, '原来站的地方被魔气吞了');
  const hp1 = p.hp;
  run(w, 1);
  assert.ok(p.hp < hp1, '在魔气里掉血');
  // 之后每隔一阵再推一步，有预警
  const ev2 = run(w, BOSS.inferno.every + 0.1);
  assert.ok(ev2.some((e) => e.t === 'bossMiasmaWarn') && ev2.some((e) => e.t === 'bossMiasma' && e.step === 2));
  assert.ok(w.miasmaInset.x > BOSS.inferno.max.x / BOSS.inferno.steps + 1);
  // 外沿硬边界也跟着往里收
  assert.ok(p.x >= w.miasmaInset.x - MIASMA.depth);
  // 首领倒下：魔气退回去
  b.invuln = 0;
  smash(w, 1);
  run(w, BOSS.deathTime - 0.1);
  assert.ok(w.miasmaInset.x < 3 && w.miasmaInset.y < 2, '魔气退回去了');
});

test('首领倒下：先放倒下的表现，再本章平定、收灵，然后进下一章前的商店；危险物和小怪都清掉', () => {
  const w = bossWorld(9);
  const p = w.players[0];
  p.iframes = 1e9;
  run(w, BOSS.intro + 0.2);
  const f = nz(w);
  f.summonT = 0; // 刷几只小兵
  run(w, 3);
  assert.ok(w.enemies.some((e) => e.kind === 'soldier'), '首领波零星刷回响兵');
  smash(w, 0.5);
  run(w, BOSS.phaseTime + 0.2);
  smash(w, 0.4);
  run(w, BOSS.phaseTime + 0.2);
  assert.equal(f.phase, 3);
  smash(w, 1);
  let ev = run(w, DT);
  assert.ok(ev.some((e) => e.t === 'bossDeath'));
  assert.equal(f.state, 'dead');
  assert.equal(f.hazards.length, 0);
  assert.equal(w.enemies.length, 0, '小怪一起散掉');
  assert.equal(w.phase, 'wave', '倒下的表现期间还在战场上');
  ev = run(w, BOSS.deathTime);
  assert.ok(ev.some((e) => e.t === 'chapterClear' && e.chapter === 1));
  assert.equal(w.boss, null);
  assert.equal(w.phase, 'collect', '先收灵');
  ev = run(w, 3.5);
  assert.equal(w.phase, 'shop');
  assert.ok(ev.some((e) => e.t === 'shopOpen'));
  assert.equal(w.cleared, 1, '表现层据此放对白');
  assert.equal(w.wave, 6);
});

test('每章的首领各是各的：第一章魔化哪吒，第二章姚天君，第三章诛仙剑灵（比前两章都厚）', () => {
  const w1 = bossWorld(3);
  const w3 = createWorld(3);
  w3.wave = 17;
  w3.phase = 'shop';
  w3.players[0].ready = true;
  step(w3, [idle]);
  assert.equal(w3.boss?.kind, 'zhuxian');
  assert.equal(w3.boss?.chapter, 3);
  assert.ok(bossEnemy(w3)!.maxHp > bossEnemy(w1)!.maxHp * 2);
  const w2 = createWorld(3);
  w2.wave = 11;
  w2.phase = 'shop';
  w2.players[0].ready = true;
  step(w2, [idle]);
  assert.equal(w2.boss?.kind, 'yao');
  assert.equal(w2.boss?.chapter, 2);
});

test('首领的弹道打不掉：玩家的乾坤圈穿过黑焰乾坤圈，它照常飞完', () => {
  const w = bossWorld(13);
  const p = w.players[0];
  p.weapons = [{ kind: 'qiankun', tier: 3, spirit: null, cd: 0 }];
  p.iframes = 1e9;
  run(w, BOSS.intro + 0.2);
  cast(w, 'ring', CX + 120, CY, 2);
  const ev = run(w, 0.75);
  const rings = nz(w).hazards.filter((h) => h.kind === 'ring');
  assert.equal(rings.length, 2, '二阶段一次两枚');
  assert.ok(ev.some((e) => e.t === 'throw'), '玩家的乾坤圈照常出手');
  run(w, 0.4);
  assert.equal(nz(w).hazards.filter((h) => h.kind === 'ring').length, 2, '两枚黑圈都还在飞');
});

test('同一种子 + 同一串输入（机器人打首领）→ 完全相同的状态；换个种子就不同', () => {
  const play = (seed: number) => {
    const w = createWorld(seed);
    w.wave = 5;
    w.phase = 'shop';
    w.enemies = [];
    w.players[0].lingshi = 400;
    for (let i = 0; i < 60 * 70; i++) {
      const shop = w.phase === 'shop';
      step(w, [shop ? idle : botInput(w, 0)], shop ? botShop(w, 0) : []);
    }
    return digest(w) + '|' + bossDigest(w);
  };
  const a = play(77);
  assert.equal(a, play(77));
  assert.notEqual(a, play(78));
});

test('能站的范围：魔气压进来以后突进线、残影、火轮都在缩小后的场地里', () => {
  const w = bossWorld(15);
  w.players[0].iframes = 1e9;
  run(w, BOSS.intro + 0.2);
  w.miasmaInset = { x: 120, y: 66 };
  const r = innerRect(w, 0);
  cast(w, 'dash', r.x1 - 30, CY, 1);
  run(w, 0.1);
  const dash = nz(w).hazards.find((h) => h.kind === 'dash')!;
  assert.ok(dash.x1 >= r.x0 - 1 && dash.x1 <= r.x1 + 1 && dash.y1 >= r.y0 - 1 && dash.y1 <= r.y1 + 1, '突进线不冲进魔气里');
  run(w, 2);
  const b = bossEnemy(w)!;
  assert.ok(b.x >= r.x0 && b.x <= r.x1, '首领自己也待在场地里');
});
