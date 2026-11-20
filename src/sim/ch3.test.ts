// 第三章（界牌关 · 诛仙阵）的模拟：刷怪表、地形「四剑轮斩」、三种新敌人、首领「诛仙剑灵」。
// 测的是规则（预警 → 判定、阶段切换、危险物）、确定性（同种子同结果）、整局存档（快照恢复后接着跑相同）、机器人打不打得过。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, digest, spawnEnemy, step, type PlayerInput, type SimEvent, type World } from './world.ts';
import { DT, ENEMIES, PLAYER } from './config.ts';
import { botInput, botShop } from './bot.ts';
import { botEnemyDodge } from './bot-dodge.ts';
import { bossEnemy } from './boss.ts';
import { chapterOfWave, terrainModule } from './chapters.ts';
import { hitEnemy } from './core.ts';
import { ch3Shares, spawnShares } from './enemies.ts';
import { canonicalText, restore, snapshot } from './snapshot.ts';
import { makeLevelOffers, restock } from './shop.ts';
import { offerTechnique } from './techniques.ts';
import { outOfView } from './spawn.ts';
import { FOES3, SWORDS, ZHUXIAN } from './ch3/config.ts';
import { SWORD_TERRAIN, swordsDigest, swordsOf, wrapAngle } from './ch3/terrain.ts';
import { tetherPairs } from './ch3/foes.ts';
import { CLOSE_RATIO, ZHUXIAN_BOSS, closeR, outsideRing, wallOffset, zhuxianDigest, zhuxianOf } from './ch3/zhuxian.ts';
import type { SwordCut, ZhuxianMove } from './ch3/types.ts';
import { JIE } from './jie.ts';

const idle: PlayerInput = { mx: 0, my: 0, skill: false };
const run = (w: World, seconds: number, input: (w: World) => PlayerInput = () => idle) => {
  const ev: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) ev.push(...step(w, [input(w)]));
  return ev;
};

/** 从第 wave − 1 波后的商店开第 wave 波；人物不带法宝、宠物不出手（只看地形 / 敌人 / 首领本身），站在场心。 */
function waveWorld(seed: number, wave: number): World {
  const w = createWorld(seed);
  w.wave = wave - 1;
  w.phase = 'shop';
  const p = w.players[0];
  p.weapons = [];
  p.pet.cd = 1e12;
  p.ready = true;
  step(w, [idle]);
  return w;
}
/** 刷怪关掉（只看自己摆上去的）。 */
const quiet = (w: World) => {
  w.spawnAcc = -1e9;
  w.surgeDone = true;
  w.eliteDone = true;
  w.waveLen = 1e9;
};
/** 人物站在 (x, y)，打不死、不闪避、没有无敌时间。 */
function standAt(w: World, x: number, y: number) {
  const p = w.players[0];
  p.x = p.px = x;
  p.y = p.py = y;
  p.stats.dodge = 0;
  p.iframes = 0;
  p.hp = p.stats.maxHp = 1e6;
  return p;
}
/** 四剑轮斩先别自己出鞘（测试里手动放）。 */
const noCuts = (w: World) => (swordsOf(w)!.next = 1e9);
/** 等这一道剑气斩完（或 seconds 秒）。 */
function runCut(w: World, c: SwordCut, seconds = 4) {
  const ev: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT) && swordsOf(w)!.cuts.includes(c); i++) ev.push(...step(w, [idle]));
  return ev;
}
/** 手动放一道剑气：第 sword 把剑朝 (tx, ty)，kind 直线或扇形（扇形的方向 dir）。 */
function forceCut(w: World, sword: number, kind: 'line' | 'fan', tx: number, ty: number, dir: 1 | -1 = 1): SwordCut {
  const t = swordsOf(w)!;
  const [ax, ay] = SWORDS.altars[sword];
  const d = Math.hypot(tx - ax, ty - ay);
  const ux = (tx - ax) / d;
  const uy = (ty - ay) / d;
  const base = { id: w.nextId++, sword, kind, t: 0, warn: SWORDS.warn, x0: ax, y0: ay, head: 0, prev: 0, hit: w.players.map(() => -1), foes: [], pair: -1 };
  const c: SwordCut =
    kind === 'line'
      ? { ...base, live: 1000 / SWORDS.line.speed, x1: ax + ux * 1000, y1: ay + uy * 1000, r: SWORDS.line.hw, rad: 0, a0: 0, arc: 0, dir: 1, dmg: SWORDS.line.dmg }
      : { ...base, live: SWORDS.fan.time, x1: ax, y1: ay, r: 0, rad: Math.round((d + SWORDS.fan.over) / 16) * 16, a0: wrapAngle(Math.atan2(uy, ux) - dir * (SWORDS.fan.lead / d)), arc: SWORDS.fan.arc, dir, dmg: SWORDS.fan.dmg };
  t.cuts.push(c);
  return c;
}

// ---------------------------------------------------------------- 刷怪表

test('刷怪表：第三章第一章那几种全都出，再按本章第几波加进飞剑灵、截教门徒、阵图傀儡', () => {
  const s13 = ch3Shares(13);
  assert.ok(s13.flysword! > 0 && !s13.disciple && !s13.puppet, '第三章第 1 波：先来飞剑灵');
  assert.ok(ch3Shares(14).disciple! > 0, '第 2 波加截教门徒');
  assert.ok(ch3Shares(15).puppet! > 0, '第 3 波加阵图傀儡');
  for (let wave = 13; wave <= 17; wave++) {
    const s = ch3Shares(wave);
    const sum = Object.values(s).reduce((a, b) => a + (b ?? 0), 0);
    assert.ok(sum < 0.9, `第 ${wave} 波：回响兵还有一成多（${sum.toFixed(2)}）`);
    assert.ok((s.flysword ?? 0) + (s.disciple ?? 0) + (s.puppet ?? 0) <= FOES3.cap + 1e-9);
    assert.ok(s.spearman! > 0 && s.cavalry! > 0, '第一章的也出');
    assert.ok(Math.abs(s.caster! - spawnShares(wave).caster!) < 1e-12, '鬼火术士照原来的比例');
  }
  assert.equal(chapterOfWave(15).spawn.shares(15).puppet, ch3Shares(15).puppet);
});

// ---------------------------------------------------------------- 四剑轮斩

test('四剑轮斩：开波后按时出鞘，预警 → 斩 → 回鞘；四把剑轮着来、不连着同一把；同种子同结果，换种子不同', () => {
  const play = (seed: number) => {
    const w = waveWorld(seed, 13);
    quiet(w);
    standAt(w, 480, 270);
    const log: string[] = [];
    const warnAt: number[] = [];
    const swords: number[] = [];
    for (let i = 0; i < Math.round(40 / DT); i++) {
      const ev = step(w, [idle]);
      for (const e of ev) {
        if (e.t === 'swordWarn') {
          warnAt.push(w.waveT);
          swords.push(e.sword);
        }
        if (e.t === 'swordWarn' || e.t === 'swordCut' || e.t === 'swordHome') log.push(`${e.t}:${e.sword}`);
      }
    }
    return { log: log.join(' '), warnAt, swords, digest: swordsDigest(w) };
  };
  const a = play(5);
  const b = play(5);
  const c = play(6);
  assert.equal(a.log, b.log, '同种子同结果');
  assert.notEqual(a.log + a.digest, c.log + c.digest, '换种子不同');
  assert.ok(Math.abs(a.warnAt[0] - SWORDS.first) < 0.05, `第一次在开波 ${SWORDS.first} 秒后`);
  assert.ok(Math.abs(a.warnAt[1] - a.warnAt[0] - SWORDS.every) < 0.05, `之后每 ${SWORDS.every} 秒`);
  for (let i = 1; i < a.swords.length; i++) assert.notEqual(a.swords[i], a.swords[i - 1], '不连着同一把');
  assert.ok(new Set(a.swords.slice(0, 4)).size === 4, '四把轮着来');
  assert.ok(a.log.includes('swordCut') && a.log.includes('swordHome'));
});

test('直线剑气：预警时不伤人；斩过来时站在线上的人挨一下（只一下），让开一步就没事；线上的敌人也挨斩（首领不吃）', () => {
  const w = waveWorld(3, 13);
  quiet(w);
  noCuts(w);
  const p = standAt(w, 480, 270);
  const c = forceCut(w, 0, 'line', 480, 270);
  const foe = spawnEnemy(w, 'soldier', 0, 0, []);
  const u = { x: (c.x1 - c.x0) / Math.hypot(c.x1 - c.x0, c.y1 - c.y0), y: (c.y1 - c.y0) / Math.hypot(c.x1 - c.x0, c.y1 - c.y0) };
  foe.x = foe.px = 480 - u.x * 120; // 线上，离剑台更近
  foe.y = foe.py = 270 - u.y * 120;
  foe.stun = 1e9;
  foe.hp = foe.maxHp = 1e6;
  let ev = run(w, SWORDS.warn * 0.9);
  assert.ok(!ev.some((e) => e.t === 'hurt'), '预警不伤人');
  ev = runCut(w, c);
  const hurt = ev.filter((e) => e.t === 'hurt' && e.by === 'sword');
  assert.equal(hurt.length, 1, '斩过人物一次');
  assert.ok(p.hp < p.stats.maxHp);
  assert.ok(ev.some((e) => e.t === 'hit' && e.id === foe.id && e.by === 'sword'), '线上的敌人挨斩');
  assert.ok(ev.some((e) => e.t === 'swordCut') && ev.some((e) => e.t === 'swordHome'));
  // 让开一步：离线 r + 人物半径 + 2 像素
  const w2 = waveWorld(3, 13);
  quiet(w2);
  noCuts(w2);
  const off = SWORDS.line.hw + PLAYER.radius + 2;
  const c2 = forceCut(w2, 0, 'line', 480, 270);
  standAt(w2, 480 - u.y * off, 270 + u.x * off);
  const ev2 = runCut(w2, c2);
  assert.ok(!ev2.some((e) => e.t === 'hurt'), '让开就没事');
});

test('扇形剑气：起始边前面（人物站的地方）挨斩；退到起始边后面、或退出半径就躲开', () => {
  const play = (where: 'in' | 'behind' | 'out') => {
    const w = waveWorld(4, 13);
    quiet(w);
    noCuts(w);
    const [ax, ay] = SWORDS.altars[0];
    const tx = ax + 200;
    const ty = ay + 120;
    const c = forceCut(w, 0, 'fan', tx, ty, 1);
    const d = Math.hypot(tx - ax, ty - ay);
    const a = Math.atan2(ty - ay, tx - ax);
    let x = tx;
    let y = ty;
    if (where === 'behind') {
      // 往扫的反方向挪到起始边后面 20 像素
      const b = c.a0 - c.dir * (20 / d);
      x = ax + Math.cos(b) * d;
      y = ay + Math.sin(b) * d;
    } else if (where === 'out') {
      x = ax + Math.cos(a) * (c.rad + PLAYER.radius + 4);
      y = ay + Math.sin(a) * (c.rad + PLAYER.radius + 4);
    }
    standAt(w, x, y);
    return runCut(w, c).some((e) => e.t === 'hurt' && e.by === 'sword');
  };
  assert.equal(play('in'), true, '人物站的地方挨斩');
  assert.equal(play('behind'), false, '退到起始边后面躲开');
  assert.equal(play('out'), false, '退出半径躲开');
});

test('交叉斩：本章第 4 波起有时两把剑同时出鞘，两道直线从不同的剑台交叉着斩过人物；首领波不交叉', () => {
  let pairs = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const w = waveWorld(seed, 16);
    quiet(w);
    standAt(w, 480, 280);
    for (let i = 0; i < Math.round(60 / DT); i++) {
      const ev = step(w, [idle]);
      const warns = ev.filter((e) => e.t === 'swordWarn');
      if (warns.length === 2) {
        pairs++;
        const [a, b] = warns as Extract<SimEvent, { t: 'swordWarn' }>[];
        assert.notEqual(a.sword, b.sword);
        assert.equal(a.pair, b.id);
        const t = swordsOf(w)!;
        const ca = t.cuts.find((c) => c.id === a.id)!;
        const cb = t.cuts.find((c) => c.id === b.id)!;
        assert.equal(ca.kind, 'line');
        const diff = Math.abs(wrapAngle(Math.atan2(ca.y1 - ca.y0, ca.x1 - ca.x0) - Math.atan2(cb.y1 - cb.y0, cb.x1 - cb.x0)));
        assert.ok(diff >= SWORDS.pair.minAngle - 1e-9 && diff <= Math.PI - SWORDS.pair.minAngle + 1e-9, '交叉得够开');
      }
    }
  }
  assert.ok(pairs >= 3, `交叉斩出现了 ${pairs} 次`);
  // 第 13 波（本章第 1 波）没有
  const w = waveWorld(1, 13);
  quiet(w);
  standAt(w, 480, 280);
  for (let i = 0; i < Math.round(60 / DT); i++) assert.ok(step(w, [idle]).filter((e) => e.t === 'swordWarn').length <= 1);
});

test('四剑轮斩：波末还没斩完的收掉、剑回鞘；机器人读得到剑气的危险（线上危险、远处安全），站在线上时往外让', () => {
  const w = waveWorld(6, 14);
  quiet(w);
  noCuts(w);
  const p = standAt(w, 480, 270);
  const c = forceCut(w, 1, 'line', 480, 270);
  run(w, SWORDS.warn * 0.6);
  assert.ok(SWORD_TERRAIN.danger(w, 480, 270, 0, 6) > 0, '线上危险');
  assert.equal(SWORD_TERRAIN.danger(w, 100, 500, 0, 6), 0, '远处安全');
  const [dx, dy] = SWORD_TERRAIN.dodge(w, p, 0);
  const L = Math.hypot(c.x1 - c.x0, c.y1 - c.y0);
  const along = (dx * (c.x1 - c.x0) + dy * (c.y1 - c.y0)) / L;
  assert.ok(Math.hypot(dx, dy) > 0.05 && Math.abs(along) < 1e-6, '往线的两侧让');
  w.waveLen = w.waveT;
  const ev = run(w, DT);
  assert.ok(ev.some((e) => e.t === 'waveEnd'));
  assert.ok(ev.some((e) => e.t === 'swordHome'));
  assert.equal(swordsOf(w)!.cuts.length, 0);
});

// ---------------------------------------------------------------- 三种新敌人

test('飞剑灵：先亮出射来的直线（预警），再沿线射过去，射中人物；射空了掉头（剑尖转回来）再来；晕眩打断瞄准', () => {
  const w = waveWorld(8, 14);
  quiet(w);
  noCuts(w);
  const p = standAt(w, 480, 270);
  const f = spawnEnemy(w, 'flysword', 580, 270, []);
  f.cd = 0;
  const ev: SimEvent[] = [];
  for (let i = 0; i < 60 * 3 && !ev.some((e) => e.t === 'hurt'); i++) ev.push(...step(w, [idle]));
  const aim = ev.find((e) => e.t === 'flyAim');
  const shot = ev.find((e) => e.t === 'flyShot');
  assert.ok(aim && shot, '瞄准、射出');
  assert.ok(ev.some((e) => e.t === 'hurt' && e.by === 'flysword'), '射中');
  // 射空了掉头：冲过人物、到线的尽头，剑尖转半圈
  const a0 = f.face!;
  for (let i = 0; i < 60 * 2 && f.act !== 'rest'; i++) step(w, [idle]);
  assert.equal(f.act, 'rest', '射完掉头');
  run(w, FOES3.flysword.turn);
  assert.ok(Math.abs(wrapAngle(f.face! - a0)) > 2.5, '剑尖转回来了');
  // 再来：过一会儿又瞄准
  p.iframes = 0;
  const ev2 = run(w, 4);
  assert.ok(ev2.some((e) => e.t === 'flyAim'), '再来一次');
  // 晕眩打断瞄准
  const w2 = waveWorld(8, 14);
  quiet(w2);
  noCuts(w2);
  standAt(w2, 480, 270);
  const f2 = spawnEnemy(w2, 'flysword', 580, 270, []);
  f2.cd = 0;
  for (let i = 0; i < 60 * 3 && f2.act !== 'windup'; i++) step(w2, [idle]);
  assert.equal(f2.act, 'windup');
  f2.stun = 0.5;
  assert.ok(!run(w2, 0.8).some((e) => e.t === 'flyShot'), '被打断就不射');
});

test('截教门徒：抬手后掷出一道剑气（会拐弯：起手偏开人物，慢慢拐向人物，之后直飞），打中算剑气的伤害', () => {
  const w = waveWorld(9, 15);
  quiet(w);
  noCuts(w);
  const p = standAt(w, 480, 270);
  const d = spawnEnemy(w, 'disciple', 560, 270, []);
  d.cd = 0;
  let ev: SimEvent[] = [];
  for (let i = 0; i < 60 * 2 && !ev.some((e) => e.t === 'qiThrow'); i++) ev.push(...step(w, [idle]));
  assert.ok(ev.some((e) => e.t === 'qiCast'), '抬手');
  const thr = ev.find((e) => e.t === 'qiThrow') as Extract<SimEvent, { t: 'qiThrow' }>;
  assert.ok(thr, '掷出');
  const o = w.orbs.find((x) => x.id === thr.orb)!;
  assert.equal(o.kind, 'qi');
  const toP = (x: { x: number; y: number; vx: number; vy: number }) => Math.abs(wrapAngle(Math.atan2(x.vy, x.vx) - Math.atan2(p.y - 8 - x.y, p.x - x.x)));
  const off0 = toP(o);
  assert.ok(off0 > 0.4, `起手偏开人物（${off0.toFixed(2)} 弧度）`);
  run(w, 0.6);
  if (w.orbs.includes(o)) assert.ok(toP(o) < off0, '在拐向人物');
  ev = run(w, 3);
  assert.ok(ev.some((e) => e.t === 'hurt' && e.by === 'qi'), '打中了');
  // 拐完了就直飞
  const w2 = waveWorld(9, 15);
  quiet(w2);
  noCuts(w2);
  standAt(w2, 480, 270);
  const d2 = spawnEnemy(w2, 'disciple', 560, 270, []);
  d2.cd = 0;
  for (let i = 0; i < 60 * 2 && !w2.orbs.length; i++) step(w2, [idle]);
  const o2 = w2.orbs[0];
  standAt(w2, 100, 500); // 人物走远：剑气拐不过来
  run(w2, FOES3.disciple.bend + 0.1);
  const a1 = Math.atan2(o2.vy, o2.vx);
  run(w2, 0.5);
  assert.ok(Math.abs(wrapAngle(Math.atan2(o2.vy, o2.vx) - a1)) < 1e-9, '拐完就直飞');
});

test('阵图傀儡：刷出一只就补上另一只，两只之间连一条剑气线；线碰到人就伤人（隔一会儿才再打中）；打掉一只线就断', () => {
  const w = waveWorld(10, 15);
  quiet(w);
  noCuts(w);
  const p = standAt(w, 480, 270);
  const a = spawnEnemy(w, 'puppet', 480, 150, []);
  let ev = run(w, DT);
  assert.ok(ev.some((e) => e.t === 'tetherOn'), '配成一对');
  assert.equal(w.enemies.filter((e) => e.kind === 'puppet').length, 2);
  const b = w.enemies.find((e) => e.kind === 'puppet' && e !== a)!;
  assert.equal(a.mate, b.id);
  assert.equal(b.mate, a.id);
  assert.equal(tetherPairs(w).length, 1);
  // 两只一起朝人物挪，线横在人物面前（和「中点 → 人物」差不多垂直）、长度保持
  run(w, 2);
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const cos = Math.abs(((b.x - a.x) * (p.x - mx) + (b.y - a.y) * (p.y - my)) / (Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(p.x - mx, p.y - my)));
  assert.ok(cos < 0.35, `线横在人物面前（cos ${cos.toFixed(2)}）`);
  assert.ok(Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - FOES3.puppet.gap) < 20, '两只之间的距离差不多不变');
  // 人物站到线上：挨打；隔 rehit 秒之内不再挨
  a.stun = b.stun = 1e9;
  standAt(w, (a.x + b.x) / 2, (a.y + b.y) / 2);
  ev = run(w, 0.2);
  assert.equal(ev.filter((e) => e.t === 'hurt' && e.by === 'tether').length, 1, '线碰到人伤人');
  p.iframes = 0;
  ev = run(w, FOES3.puppet.rehit * 0.6);
  assert.ok(!ev.some((e) => e.t === 'hurt' && e.by === 'tether'), '隔一会儿才再打中');
  // 打掉一只：线断
  hitEnemy(w, b, { dmg: 1e6, by: 'ring', owner: 0, from: p, canCrit: false }, []);
  ev = run(w, DT * 2);
  assert.ok(ev.some((e) => e.t === 'tetherCut'), '线断了');
  assert.equal(a.mate, -1);
  assert.equal(tetherPairs(w).length, 0);
  p.iframes = 0;
  standAt(w, a.x + 30, a.y);
  ev = run(w, 0.3);
  assert.ok(!ev.some((e) => e.t === 'hurt' && e.by === 'tether'));
});

test('阵图傀儡：补上的那一只也刷在屏幕外（第 15 波的常规刷怪里出的傀儡，补的那只都看不见）', () => {
  const w = waveWorld(11, 15);
  const p = standAt(w, 480, 270);
  let pairs = 0;
  for (let i = 0; i < Math.round(30 / DT); i++) {
    p.x = p.px = 480;
    p.y = p.py = 270;
    p.hp = p.stats.maxHp;
    const ev = step(w, [idle]);
    for (const e of ev) {
      if (e.t !== 'tetherOn') continue;
      pairs++;
      for (const id of [e.a, e.b]) {
        const q = w.enemies.find((x) => x.id === id)!;
        assert.ok(outOfView(p, q.x, q.y) > 0, '傀儡刷在屏幕外');
      }
    }
  }
  assert.ok(pairs >= 1, `刷出了 ${pairs} 对`);
});

test('机器人躲第三章的敌人：飞剑灵瞄准线上往两侧让；站在傀儡的剑气线上往外让', () => {
  const w = waveWorld(12, 14);
  quiet(w);
  noCuts(w);
  const p = standAt(w, 480, 270);
  const f = spawnEnemy(w, 'flysword', 580, 270, []);
  f.cd = 0;
  for (let i = 0; i < 60 * 2 && f.act !== 'windup'; i++) step(w, [idle]);
  run(w, 0.3);
  const [ax, ay] = botEnemyDodge(w, 0, 0);
  assert.ok(Math.abs(ay) > 0.05 && Math.abs(ax) < Math.abs(ay), '飞剑灵从右边横着射来：往上或往下让');
  const w2 = waveWorld(12, 14);
  quiet(w2);
  noCuts(w2);
  const a = spawnEnemy(w2, 'puppet', 480, 200, []);
  run(w2, DT);
  const b = w2.enemies.find((e) => e.kind === 'puppet' && e !== a)!;
  a.stun = b.stun = 1e9;
  standAt(w2, (a.x + b.x) / 2 + 1, (a.y + b.y) / 2 + 1);
  const [bx, by] = botEnemyDodge(w2, 0, 0);
  assert.ok(Math.hypot(bx, by) > 0.05, '站在剑气线上会让开');
  void p;
});

// ---------------------------------------------------------------- 诛仙剑灵

/** 第 18 波：诛仙剑灵入场；不刷小兵、不轮斩（只测他本身），人物站在场心。 */
function zxWorld(seed = 1): World {
  const w = waveWorld(seed, 18);
  const f = zhuxianOf(w)!;
  assert.ok(f, '第 18 波开始时诛仙剑灵入场');
  f.summonT = 1e9;
  noCuts(w);
  standAt(w, 480, 270);
  return w;
}
/** 让他站到 (x, y)，下一帧就出 move。 */
function zxCast(w: World, move: ZhuxianMove, x: number, y: number, phase = 1) {
  const f = zhuxianOf(w)!;
  const b = bossEnemy(w)!;
  b.x = b.px = x;
  b.y = b.py = y;
  b.invuln = 0;
  f.phase = phase;
  f.queue = [move];
  f.state = 'idle';
  f.t = 0;
  f.lt = 0;
  f.dur = 0.001;
}

test('诛仙剑灵：入场无敌；气血跨过 60% / 30% 卡在阈值上换阶段（换阶段无敌）；三阶段打空才倒下，倒下的表现放完就通关（最后一章）', () => {
  const w = zxWorld();
  const f = zhuxianOf(w)!;
  const b = bossEnemy(w)!;
  assert.equal(b.maxHp, ZHUXIAN.hp);
  assert.equal(f.state, 'intro');
  assert.ok(b.invuln > 0, '入场无敌');
  run(w, ZHUXIAN.intro + 0.1);
  const p = w.players[0];
  let ev: SimEvent[] = [];
  hitEnemy(w, b, { dmg: b.maxHp * 0.5, by: 'ring', owner: 0, from: p, canCrit: false }, ev);
  ev = run(w, DT);
  assert.ok(ev.some((e) => e.t === 'bossPhase' && e.phase === 2));
  assert.equal(b.hp, Math.ceil(b.maxHp * ZHUXIAN.phases[0]), '一次大伤害也卡在阈值上');
  assert.ok(b.invuln > 0, '换阶段无敌');
  run(w, ZHUXIAN.phaseTime + 0.1);
  b.hp = Math.ceil(b.maxHp * 0.29);
  ev = run(w, DT);
  assert.ok(ev.some((e) => e.t === 'bossPhase' && e.phase === 3));
  assert.ok(f.close.on, '三阶段：剑阵开始收');
  run(w, ZHUXIAN.phaseTime + 0.1);
  b.invuln = 0;
  b.hp = 1;
  hitEnemy(w, b, { dmg: 999, by: 'ring', owner: 0, from: p, canCrit: false }, []);
  ev = run(w, DT);
  assert.ok(ev.some((e) => e.t === 'bossDeath'));
  assert.equal(f.close.on, false, '倒下：剑阵不再收');
  ev = run(w, ZHUXIAN.deathTime + 0.1);
  assert.ok(ev.some((e) => e.t === 'win'), '最后一章：通关');
  assert.equal(w.phase, 'win');
});

test('诛仙剑灵不吃控制：晕眩、冻结都上不去', () => {
  const w = zxWorld(2);
  run(w, ZHUXIAN.intro + 0.1);
  const b = bossEnemy(w)!;
  hitEnemy(w, b, { dmg: 10, by: 'ring', owner: 0, from: w.players[0], canCrit: false, stun: 3, freeze: 3 }, []);
  assert.equal(b.stun, 0);
  assert.equal(b.frozen, 0);
});

test('四剑环斩：四道扇形一道接一道绕他一圈（预警再斩）；半径里面挨斩，退出半径就躲开', () => {
  const play = (dist: number) => {
    const w = zxWorld(3);
    run(w, ZHUXIAN.intro + 0.1);
    standAt(w, 480 + dist, 270);
    zxCast(w, 'ring', 480, 270);
    const all = run(w, 0.05);
    const f = zhuxianOf(w)!;
    assert.equal(f.hazards.filter((h) => h.kind === 'arc').length, 1, '第一斩');
    let ev = run(w, ZHUXIAN.ring.warn * 0.5);
    assert.ok(!ev.some((e) => e.t === 'hurt'), '预警不伤人');
    all.push(...ev);
    ev = run(w, ZHUXIAN.ring.gap * 3 + ZHUXIAN.ring.warn + ZHUXIAN.ring.sweep);
    all.push(...ev);
    assert.equal(all.filter((e) => e.t === 'zxCast' && e.kind === 'arc').length, ZHUXIAN.ring.n, '四斩');
    return ev.some((e) => e.t === 'hurt' && e.by === 'boss');
  };
  assert.equal(play(80), true, '半径里面挨斩');
  assert.equal(play(ZHUXIAN.ring.rad + PLAYER.radius + 6), false, '退出半径躲开');
});

test('剑雨：人物身边一片格子分两拨落下（棋盘格）；站在第一拨的格子里挨打，躲到第二拨的格子里、第一拨落完再回来就没事', () => {
  const play = (dodge: boolean) => {
    const w = zxWorld(4);
    run(w, ZHUXIAN.intro + 0.1);
    const p = standAt(w, 480, 270);
    zxCast(w, 'rain', 600, 270);
    run(w, 0.05);
    const f = zhuxianOf(w)!;
    const A = f.hazards.filter((h) => h.kind === 'cell' && h.src === 0);
    assert.ok(A.length >= 20, `第一拨 ${A.length} 格`);
    assert.ok(A.some((h) => h.x0 === 480 && h.y0 === 270), '人物脚下那一格在第一拨');
    const C = ZHUXIAN.rain.cell;
    const ev: SimEvent[] = [];
    for (let i = 0; i < Math.round((ZHUXIAN.rain.gap + ZHUXIAN.rain.warn + 0.4) / DT); i++) {
      const t = i * DT;
      if (dodge) {
        // 第一拨落下之前挪到右边那一格（第二拨），第一拨落完再挪回来
        const there = t < ZHUXIAN.rain.warn + ZHUXIAN.rain.live + 0.02;
        p.x = p.px = there ? 480 + C : 480;
      }
      p.iframes = 0;
      ev.push(...step(w, [idle]));
    }
    return ev.filter((e) => e.t === 'hurt' && e.by === 'boss').length;
  };
  assert.ok(play(false) >= 1, '站着不动挨打');
  assert.equal(play(true), 0, '踩着节奏换格子就没事');
});

test('一剑化四：本体和三个剑影滑到人物四角，轮流放剑气直线（本体不先放）；只有本体打得到；剑气线斩过人物', () => {
  const w = zxWorld(5);
  run(w, ZHUXIAN.intro + 0.1);
  const p = standAt(w, 480, 270);
  zxCast(w, 'split', 600, 270, 2);
  let ev = run(w, 0.1);
  const all = [...ev];
  const f = zhuxianOf(w)!;
  assert.ok(ev.some((e) => e.t === 'zxSplit'));
  assert.equal(f.shadows.length, 3, '三个剑影');
  assert.equal(f.fire.length, 4);
  assert.notEqual(f.fire[0], 0, '本体不先放');
  assert.equal(w.enemies.filter((e) => e.kind === 'boss').length, 1, '剑影不是敌人（打不到）');
  ev = run(w, ZHUXIAN.split.slide - 0.1);
  all.push(...ev);
  const b = bossEnemy(w)!;
  const corners = [b, ...f.shadows].map((q) => [Math.sign(q.x - p.x), Math.sign(q.y - p.y)].join());
  assert.equal(new Set(corners).size, 4, '四个各守一角');
  assert.ok(Math.hypot(b.x - p.x, b.y - p.y) < 130, '本体在法宝够得着的地方');
  const fire = [...f.fire];
  ev = run(w, 3);
  all.push(...ev);
  const lanes = all.filter((e) => e.t === 'zxCast' && e.kind === 'lane') as Extract<SimEvent, { t: 'zxCast' }>[];
  assert.equal(lanes.length, 4, '四道剑气');
  assert.deepEqual(lanes.map((e) => e.src), fire, '照定下的先后放');
  assert.ok(all.some((e) => e.t === 'hurt' && e.by === 'boss'), '站着不动被斩到');
  assert.ok(ev.some((e) => e.t === 'zxMerge'), '放完剑影散去');
  assert.equal(f.shadows.length, 0);
});

test('四剑归阵：四角剑台亮起，两道剑气墙过场心连起对角的剑台，预警后慢慢转；碰到墙掉血（隔一会儿才再打中）', () => {
  const w = zxWorld(6);
  run(w, ZHUXIAN.intro + 0.1);
  zxCast(w, 'walls', 700, 200, 2);
  let ev = run(w, 0.05);
  assert.ok(ev.some((e) => e.t === 'zxAltars'));
  const f = zhuxianOf(w)!;
  const walls = f.hazards.filter((h) => h.kind === 'wall');
  assert.equal(walls.length, 2);
  for (const h of walls) {
    assert.ok(Math.hypot(h.x0 - 480, h.y0 - 270) < 1, '转轴在场心');
    const [ax, ay] = SWORDS.altars[h.src];
    assert.ok(Math.abs(wallOffset(h, ax, ay).side) < 1, '墙连着剑台');
  }
  const a0 = walls[0].a0;
  // 人物站在墙上：预警不伤人，墙起来之后伤人
  const h = walls[0];
  const p = standAt(w, 480 + Math.cos(h.a0) * 150, 270 + Math.sin(h.a0) * 150);
  ev = run(w, ZHUXIAN.walls.warn * 0.8);
  assert.ok(!ev.some((e) => e.t === 'hurt'), '预警不伤人');
  ev = run(w, ZHUXIAN.walls.warn * 0.3);
  assert.ok(ev.some((e) => e.t === 'hurt' && e.by === 'boss'), '碰到墙');
  run(w, 2);
  assert.ok(Math.abs(wrapAngle(h.a0 - a0)) > 0.1, '墙在转');
  assert.ok(f.state === 'cast' && f.move === 'walls', '他站着施法');
  void p;
});

test('诛仙：三阶段剑阵从包住整个场地的一圈分几步往里收（每一步先预警）；站在圈外持续掉血，圈里没事', () => {
  const w = zxWorld(7);
  run(w, ZHUXIAN.intro + 0.1);
  const b = bossEnemy(w)!;
  const f = zhuxianOf(w)!;
  f.phase = 2;
  b.hp = Math.ceil(b.maxHp * 0.29);
  run(w, DT);
  assert.ok(f.close.on);
  assert.ok(outsideRing(0, 0, f.close.rx) < 0 && outsideRing(960, 540, f.close.rx) < 0, '一开始整个场地都在圈里');
  f.queue = [];
  f.dur = 1e9; // 他别出招（只看剑阵）
  f.state = 'recover';
  b.invuln = 1e9;
  const ev = run(w, ZHUXIAN.phaseTime + ZHUXIAN.close.first + ZHUXIAN.close.every * 2 + ZHUXIAN.close.move);
  const warns = ev.filter((e) => e.t === 'zxCloseWarn');
  const closes = ev.filter((e) => e.t === 'zxClose');
  assert.ok(closes.length >= 2, `收了 ${closes.length} 步`);
  assert.ok(warns.length >= closes.length, '每一步先预警');
  assert.ok(f.close.rx < ZHUXIAN.close.r0 && Math.abs(f.close.ry - f.close.rx * CLOSE_RATIO) < 1e-6);
  // 圈外掉血（场地的角上：已经在圈外、又不在魔气里）
  const p = standAt(w, 920, 520);
  assert.ok(outsideRing(920, 520, f.close.rx) > 10, '角上已经在圈外');
  p.hp = p.stats.maxHp = 1000;
  const ev2 = run(w, 1);
  assert.ok(p.hp < 1000 - 1000 * ZHUXIAN.close.drain * 0.9, '圈外持续掉血');
  assert.ok(ev2.some((e) => e.t === 'zxDrain'));
  standAt(w, 480, 270).hp = 1000;
  p.stats.maxHp = 1000;
  run(w, 1);
  assert.equal(p.hp, 1000, '圈里没事');
  assert.ok(closeR(ZHUXIAN.close.steps) === ZHUXIAN.close.r1);
});

test('连续突进：接连冲三次，每次先亮直线；他沿线冲过去，站在线上的人挨撞', () => {
  const w = zxWorld(8);
  run(w, ZHUXIAN.intro + 0.1);
  const p = standAt(w, 480, 270);
  zxCast(w, 'rush', 600, 270, 3);
  const f = zhuxianOf(w)!;
  f.close.on = false;
  const ev = run(w, 4);
  const dashes = ev.filter((e) => e.t === 'zxCast' && e.kind === 'dash');
  assert.equal(dashes.length, ZHUXIAN.rush.n, '冲三次');
  assert.ok(ev.some((e) => e.t === 'hurt' && e.by === 'boss'), '站着不动被撞到');
  assert.ok(Math.hypot(bossEnemy(w)!.x - 600, bossEnemy(w)!.y - 270) > 40, '他冲出去了');
  void p;
});

test('机器人读诛仙剑灵的危险物：剑雨的格子里、剑气线上、墙上危险；格子外、远处安全；三阶段剑阵外危险', () => {
  const w = zxWorld(9);
  run(w, ZHUXIAN.intro + 0.1);
  zxCast(w, 'rain', 600, 270);
  run(w, 0.3);
  assert.ok(ZHUXIAN_BOSS.danger(w, 480, 270, 0, 4) > 0, '第一拨的格子里危险');
  assert.equal(ZHUXIAN_BOSS.danger(w, 480 + ZHUXIAN.rain.cell, 270, 0, 2), 0, '旁边那格（第二拨，还没亮）安全');
  assert.equal(ZHUXIAN_BOSS.danger(w, 100, 100, 0, 6), 0, '远处安全');
  const w2 = zxWorld(10);
  run(w2, ZHUXIAN.intro + 0.1);
  zxCast(w2, 'walls', 700, 200, 2);
  run(w2, 0.4);
  const h = zhuxianOf(w2)!.hazards.find((x) => x.kind === 'wall')!;
  assert.ok(ZHUXIAN_BOSS.danger(w2, 480 + Math.cos(h.a0) * 100, 270 + Math.sin(h.a0) * 100, 0, 6) > 0, '墙上危险');
  const w3 = zxWorld(11);
  run(w3, ZHUXIAN.intro + 0.1);
  const b3 = bossEnemy(w3)!;
  zhuxianOf(w3)!.phase = 2;
  b3.hp = Math.ceil(b3.maxHp * 0.29);
  run(w3, DT);
  const K = zhuxianOf(w3)!.close;
  K.rx = 300;
  K.ry = 300 * CLOSE_RATIO;
  assert.ok(ZHUXIAN_BOSS.danger(w3, 480 + 340, 270, 0, 6) > 0, '剑阵外危险');
});

test('确定性：同一种子 + 机器人打诛仙剑灵（连四剑轮斩）→ 完全相同；换个种子就不同', () => {
  const play = (seed: number) => {
    const w = zxWorld(seed);
    zhuxianOf(w)!.summonT = ZHUXIAN.summon.first;
    swordsOf(w)!.next = SWORDS.first;
    w.players[0].hp = w.players[0].stats.maxHp = 1e6;
    w.players[0].weapons = [{ kind: 'qiankun', tier: 3, spirit: null, cd: 0 }];
    const b = bossEnemy(w)!;
    for (let i = 0; i < 60 * 40; i++) {
      if (i === 60 * 12) b.hp = Math.min(b.hp, Math.ceil(b.maxHp * 0.59));
      if (i === 60 * 26) b.hp = Math.min(b.hp, Math.ceil(b.maxHp * 0.29));
      step(w, [botInput(w, 0)]);
    }
    return `${digest(w)}|${zhuxianDigest(w)}|${swordsDigest(w)}`;
  };
  assert.equal(play(11), play(11));
  assert.notEqual(play(11), play(12));
});

test('整局存档：诛仙剑灵战（剑影、剑气墙、剑阵收拢）和四剑轮斩存下来（走一趟 JSON），恢复后接着跑和不中断直接跑完全相同', () => {
  for (const [move, phase] of [
    ['split', 2],
    ['walls', 2],
    ['rush', 3],
  ] as [ZhuxianMove, number][]) {
    const w = zxWorld(13);
    run(w, ZHUXIAN.intro + 0.1);
    w.players[0].hp = w.players[0].stats.maxHp = 1e6;
    w.players[0].weapons = [{ kind: 'qiankun', tier: 2, spirit: null, cd: 0 }];
    swordsOf(w)!.next = 0.5;
    const b = bossEnemy(w)!;
    if (phase === 3) {
      zhuxianOf(w)!.phase = 2;
      b.hp = Math.ceil(b.maxHp * 0.29);
      run(w, ZHUXIAN.phaseTime + 0.5);
    }
    zxCast(w, move, b.x, b.y, phase);
    for (let i = 0; i < 60 * 1.2; i++) step(w, [botInput(w, 0)]);
    const f = zhuxianOf(w)!;
    assert.ok(f.hazards.length > 0 || f.shadows.length > 0, `${move}：招式正在放`);
    const copy = restore(JSON.parse(JSON.stringify(snapshot(w))));
    assert.equal(canonicalText(copy), canonicalText(w));
    for (let i = 0; i < 600; i++) {
      step(w, [botInput(w, 0)]);
      step(copy, [botInput(copy, 0)]);
    }
    assert.equal(canonicalText(copy), canonicalText(w), `${move}：接着跑 10 秒还一样`);
  }
});

test('整局存档：第三章普通波（飞剑灵、门徒的剑气、傀儡的剑气线、轮斩）存下来，恢复后接着跑相同', () => {
  const w = waveWorld(14, 16);
  w.players[0].hp = w.players[0].stats.maxHp = 1e6;
  w.players[0].weapons = [{ kind: 'qiankun', tier: 2, spirit: null, cd: 0 }];
  spawnEnemy(w, 'puppet', 300, 200, []);
  spawnEnemy(w, 'disciple', 600, 300, []).cd = 0;
  spawnEnemy(w, 'flysword', 560, 200, []).cd = 0;
  for (let i = 0; i < 60 * 6; i++) step(w, [botInput(w, 0)]);
  assert.ok(tetherPairs(w).length > 0 || w.orbs.some((o) => o.kind === 'qi') || swordsOf(w)!.cuts.length > 0, '有东西正在放');
  const copy = restore(JSON.parse(JSON.stringify(snapshot(w))));
  for (let i = 0; i < 600; i++) {
    step(w, [botInput(w, 0)]);
    step(copy, [botInput(copy, 0)]);
  }
  assert.equal(canonicalText(copy), canonicalText(w));
});

test('机器人打得过第三章（从第 13 波前的商店开始，带一大笔灵石，和 ?wave=13 一样）：打完六波、打赢诛仙剑灵就通关', () => {
  for (const seed of [31, 32]) {
    const w = createWorld(seed);
    const p = w.players[0];
    w.wave = 12;
    w.phase = 'shop';
    p.lingshi = 999;
    p.level = 1 + Math.round(13 * 1.6);
    p.pendingLevels = Math.round(13 * 1.6);
    p.levelOffers = makeLevelOffers(w, p);
    offerTechnique(w, p);
    restock(w, p);
    for (let i = 0; i < 60 * 60 * 14 && (w.phase as string) !== 'over' && (w.phase as string) !== 'win'; i++) step(w, [botInput(w, 0)], w.phase === 'shop' ? botShop(w, 0) : []);
    assert.equal(w.phase, 'win', `种子 ${seed}：通关（停在第 ${w.wave} 波，${w.phase}）`);
  }
  assert.ok(terrainModule(waveWorld(1, 13)) === SWORD_TERRAIN);
  void ENEMIES;
});

test('劫四：飞剑灵射得快、截教门徒的剑气飞得快（同鬼火 +25%，预警的时长不变）', () => {
  // 飞剑灵：射出去那一下（flyShot）的线长 / 时长 = 射的速度
  const fly = (jie: number) => {
    const w = waveWorld(31, 13);
    quiet(w);
    noCuts(w);
    w.jie = jie;
    w.enemies = [];
    const p = standAt(w, 480, 270);
    const e = spawnEnemy(w, 'flysword', p.x + 110, p.y, []);
    e.cd = 0;
    for (let i = 0; i < 600; i++) for (const ev of step(w, [idle])) if (ev.t === 'flyShot') return Math.hypot(ev.x1 - ev.x0, ev.y1 - ev.y0) / ev.dur;
    assert.fail('飞剑灵没射');
  };
  assert.ok(Math.abs(fly(1) - FOES3.flysword.speed) < 1e-6);
  assert.ok(Math.abs(fly(4) - FOES3.flysword.speed * (1 + JIE.shot)) < 1e-6);
  assert.ok(Math.abs(fly(3) - FOES3.flysword.speed) < 1e-6, '劫三还不快');
  // 截教门徒：剑气刚放出来的速度（之后拐弯时速度不变）
  const qi = (jie: number) => {
    const w = waveWorld(32, 14);
    quiet(w);
    noCuts(w);
    w.jie = jie;
    w.enemies = [];
    w.orbs = [];
    const p = standAt(w, 480, 270);
    const e = spawnEnemy(w, 'disciple', p.x + 90, p.y, []);
    e.cd = 0;
    for (let i = 0; i < 600 && !w.orbs.length; i++) step(w, [idle]);
    assert.equal(w.orbs.length, 1);
    const o = w.orbs[0];
    const v0 = Math.hypot(o.vx, o.vy);
    run(w, 0.5);
    if (w.orbs.length) assert.ok(Math.abs(Math.hypot(w.orbs[0].vx, w.orbs[0].vy) - v0) < 1e-6, '拐弯时速度不变');
    return v0;
  };
  assert.ok(Math.abs(qi(1) - FOES3.disciple.speed) < 1e-6);
  assert.ok(Math.abs(qi(4) - FOES3.disciple.speed * (1 + JIE.shot)) < 1e-6);
});
