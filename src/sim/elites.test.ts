// 各章的精英 + 精英词缀（sim/elites/）：按章刷哪一种、带几条词缀；东海夜叉的潜水与拍浪、金光力士的金光、截教剑侍的三柄剑；
// 五条词缀；被吸走 / 定身 / 冻住时不出岔子；整局存档存得下、恢复后接着跑逐帧一样。
// 劫一第一章完全不变由 tools/balance.ts 20 的第一章结果逐字不变来保证（改之前、改之后各跑一遍对比，见 scratch/PROGRESS.md）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, digest, spawnAt, step, type PlayerInput, type SimEvent, type World } from './world.ts';
import { DT, ENEMIES, SPAWN } from './config.ts';
import { spawnSpot } from './spawn.ts';
import { hitEnemy } from './core.ts';
import { botInput, botShop } from './bot.ts';
import { AFFIX, ELITES, WAVE_ELITES, affixCount, eliteKindFor, spawnElite, spawnElites } from './elites/index.ts';
import { bladeSpot } from './elites/jianshi.ts';
import { canonicalText, restore, snapshot } from './snapshot.ts';
import type { Enemy, HitBy } from './types.ts';
import type { EliteAffix, EliteKind } from './elites/types.ts';

const idle: PlayerInput = { mx: 0, my: 0, skill: false };
const run = (w: World, seconds: number, input: (w: World) => PlayerInput = () => idle, until?: (ev: SimEvent[]) => boolean) => {
  const events: SimEvent[] = [];
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    const ev = step(w, [input(w)]);
    events.push(...ev);
    if (until?.(ev)) break;
  }
  return events;
};
/** 干净的测试场：刷怪关掉、宠物不出手、人物不带法宝、血量很厚（会挨打，但打不死）。 */
const arena = (seed: number, wave = 3, jie = 1) => {
  const w = createWorld(seed, 1, { jie });
  w.wave = wave;
  w.waveLen = 1e9;
  w.spawnAcc = -1e12;
  w.eliteDone = true;
  w.surgeDone = true;
  w.terrain = null;
  const p = w.players[0];
  p.weapons = [];
  p.pet.cd = 1e12;
  p.pet.x = p.pet.px = -9999;
  p.hp = p.stats.maxHp = 1e6;
  return { w, p };
};
const put = (w: World, kind: EliteKind, x: number, y: number, affixes: EliteAffix[] = []) => {
  const e = spawnElite(w, kind, x, y, [], affixes);
  e.x = e.px = x;
  e.y = e.py = y;
  return e;
};
const hurts = (ev: SimEvent[], by: string) => ev.filter((e) => e.t === 'hurt' && e.by === by);
const strike = (w: World, e: Enemy, dmg: number, from: { x: number; y: number }, by: HitBy = 'ring') => {
  const ev: SimEvent[] = [];
  const d = hitEnemy(w, e, { dmg, by, owner: 0, from, canCrit: false }, ev);
  return { ev, d };
};

// ---------------------------------------------------------------- 按章刷精英

test('按章刷精英：第一章劫一只有回响校尉、不带词缀；劫二起第 2、4 波是东海夜叉；第二章金光力士；第三章截教剑侍（第 16 波两只）', () => {
  const kinds = (wave: number, jie: number, n: number) => {
    const { w, p } = arena(3, wave, jie);
    const ev: SimEvent[] = [];
    spawnElites(w, p, w.players, n, ev);
    return w.enemies.filter((e) => e.kind === 'elite').map((e) => `${e.elite ?? 'xiaowei'}:${e.affixes?.length ?? 0}`);
  };
  assert.deepEqual(kinds(4, 1, 1), ['xiaowei:0'], '第一章劫一');
  assert.deepEqual(kinds(4, 2, 1), ['yecha:1'], '第一章劫二的第 4 波');
  assert.deepEqual(kinds(4, 3, 2), ['yecha:1', 'xiaowei:1'], '劫三第 4 波多出来的那只是校尉');
  assert.deepEqual(kinds(2, 3, 1), ['yecha:1']);
  assert.deepEqual(kinds(1, 3, 1), ['xiaowei:1']);
  // 第二、三章的第 4 波（第 10、16 波）换成了回响化身遭遇战（sim/echo/），本章的精英在第 2 波（第 8、14 波）出
  assert.deepEqual(kinds(8, 1, 1), ['lishi:1'], '第二章（劫一也带一条）');
  assert.deepEqual(kinds(14, 1, 2), ['jianshi:1', 'jianshi:1'], '第三章');
  assert.deepEqual(kinds(14, 5, 2), ['jianshi:2', 'jianshi:2'], '劫五两条');
  // 第一章劫一：和原来的写法（spawnSpot + spawnAt(w, 'elite')）逐项一样，随机数一个不多用
  const a = arena(7, 4, 1);
  const b = arena(7, 4, 1);
  spawnElites(a.w, a.p, a.w.players, 2, []);
  for (let i = 0; i < 2; i++) {
    const q = spawnSpot(b.w, b.p, b.w.players, ENEMIES.elite.radius, SPAWN.eliteOut[0], SPAWN.eliteOut[1]);
    spawnAt(b.w, 'elite', q.x, q.y, []);
  }
  assert.equal(a.w.rng.state, b.w.rng.state);
  assert.equal(JSON.stringify(a.w.enemies), JSON.stringify(b.w.enemies));
  assert.equal(eliteKindFor(a.w, 0), 'xiaowei');
  assert.equal(affixCount(a.w), 0);
});

test('按波次换精英的口子：WAVE_ELITES 登记了的那一波改调登记的函数（拿到这一波本来要出几只），不刷本章的精英', () => {
  const { w, p } = arena(4, 10);
  let got = -1;
  WAVE_ELITES[10] = (_w, _p, _cams, n) => {
    got = n;
  };
  try {
    spawnElites(w, p, w.players, 2, []);
  } finally {
    delete WAVE_ELITES[10];
  }
  assert.equal(got, 2);
  assert.equal(w.enemies.filter((e) => e.kind === 'elite').length, 0);
  // 整局里：第 10 波到了出精英的时候走登记的那个
  const g = createWorld(5);
  g.wave = 9;
  g.phase = 'shop';
  g.players[0].ready = true;
  g.players[0].iframes = 1e9; // 一级的人物站着不动打第 10 波：别在出精英之前就被打倒（这条测的是口子，不是打不打得过）
  let called = 0;
  WAVE_ELITES[10] = () => called++;
  try {
    run(g, 0.05);
    assert.equal(g.wave, 10);
    run(g, g.waveLen * 0.4);
  } finally {
    delete WAVE_ELITES[10];
  }
  assert.equal(called, 1);
});

// ---------------------------------------------------------------- 东海夜叉

test('东海夜叉：潜进水里（打不着、不接触伤人），游到人物身边停住、亮出要冒出来的那一片，然后冒出水面伤人、把人震开', () => {
  const { w, p } = arena(11);
  const e = put(w, 'yecha', p.x + 120, p.y);
  e.cd = 0;
  e.cd2 = 1e9;
  const ev = run(w, 4, () => idle, (x) => x.some((y) => y.t === 'yechaBurst'));
  const di = ev.findIndex((x) => x.t === 'yechaDive');
  const ri = ev.findIndex((x) => x.t === 'yechaRise');
  const bi = ev.findIndex((x) => x.t === 'yechaBurst');
  assert.ok(di >= 0 && ri > di && bi > ri, '先潜水、再亮出那一片、再冒出来');
  const rise = ev[ri] as SimEvent & { t: 'yechaRise' };
  assert.ok(Math.hypot(rise.x - p.x, rise.y - p.y) <= ELITES.yecha.dive.near + 3, '停在人物身边');
  assert.equal(hurts(ev.slice(0, bi), 'contact').length, 0, '潜在水里时碰不着人');
  assert.equal(hurts(ev.slice(bi), 'tide').length, 1, '冒出来那一下打中站着不动的人');
  assert.ok(Math.hypot(p.blowX ?? 0, p.blowY ?? 0) > 50, '被震开');
  assert.ok(!e.hidden && e.invuln <= 0, '冒出来以后打得着');
});

test('东海夜叉：潜在水里时法宝打不着、不吃控制；预警时走出那一片就不挨打', () => {
  const { w, p } = arena(12);
  const e = put(w, 'yecha', p.x + 100, p.y);
  e.cd = 0;
  e.cd2 = 1e9;
  run(w, 0.2);
  assert.equal(e.act, 'dive');
  assert.ok(e.hidden);
  const hp = e.hp;
  assert.equal(strike(w, e, 50, p).d, 0, '打不着');
  assert.equal(e.hp, hp);
  e.stun = 2;
  e.frozen = 2;
  run(w, DT);
  assert.equal(e.stun, 0, '水里不吃晕眩、冻结');
  // 亮出来以后往外走：躲得开
  let away = false;
  const ev = run(
    w,
    4,
    (x) => {
      const en = x.enemies.find((o) => o.id === e.id);
      if (en?.act === 'rise') away = true;
      return away ? { mx: -1, my: 0, skill: false } : idle;
    },
    (x) => x.some((y) => y.t === 'yechaBurst'),
  );
  assert.ok(ev.some((x) => x.t === 'yechaBurst'));
  assert.equal(hurts(ev, 'tide').length, 0, '走出那一片就不挨打');
});

test('东海夜叉：贴近了拍浪（先亮出那一条），推到的人挨一下、顺着浪推开；预警时被晕住就打断', () => {
  const { w, p } = arena(13);
  const e = put(w, 'yecha', p.x + 30, p.y);
  e.cd = 1e9;
  e.cd2 = 0;
  const ev = run(w, 2, () => idle, (x) => x.some((y) => y.t === 'hurt'));
  const wi = ev.findIndex((x) => x.t === 'yechaSlapWarn');
  const si = ev.findIndex((x) => x.t === 'yechaSlap');
  assert.ok(wi >= 0 && si > wi);
  assert.equal(hurts(ev.slice(0, si), 'tide').length, 0, '预警时不伤人');
  assert.equal(hurts(ev, 'tide').length, 1);
  assert.ok((p.blowX ?? 0) < -50, '往浪推的方向（夜叉在右边，推向左）推开');
  // 打断
  const b = arena(13);
  const f = put(b.w, 'yecha', b.p.x + 30, b.p.y);
  f.cd = 1e9;
  f.cd2 = 0;
  run(b.w, 0.1);
  assert.equal(f.act, 'windup');
  f.stun = 0.5;
  const ev2 = run(b.w, 1.2);
  assert.equal(ev2.filter((x) => x.t === 'yechaSlap').length, 0, '被晕住就不拍');
});

// ---------------------------------------------------------------- 金光力士

test('金光力士：举旗后给身边最近的几只敌人（连它自己）套金光：挡下一下直接命中；灼烧、神通挡不住；到时散掉', () => {
  const { w, p } = arena(21);
  const e = put(w, 'lishi', p.x + 150, p.y);
  const others = [0, 1, 2].map((i) => {
    const o = spawnElite(w, 'xiaowei', p.x + 160 + i * 12, p.y + 20, [], []);
    o.speed = 0;
    return o;
  });
  e.cd = 0;
  e.speed = 0;
  const ev = run(w, 1.5, () => idle, (x) => x.some((y) => y.t === 'aegisCast'));
  const ci = ev.findIndex((x) => x.t === 'aegisRaise');
  const cast = ev.find((x) => x.t === 'aegisCast') as SimEvent & { t: 'aegisCast' };
  assert.ok(ci >= 0 && cast, '先举旗、再套金光');
  for (const o of [e, ...others]) assert.ok(cast.ids.includes(o.id), `${o.id} 套上了`);
  // 直接命中挡下
  const o = others[0];
  const hp = o.hp;
  const r1 = strike(w, o, 40, p);
  assert.equal(r1.d, 0);
  assert.equal(o.hp, hp, '挡下了');
  assert.ok(r1.ev.some((x) => x.t === 'aegisBlock'));
  assert.equal(strike(w, o, 40, p).d, 40, '只挡一下');
  // 灼烧、神通挡不住
  const o2 = others[1];
  assert.equal(strike(w, o2, 7, o2, 'burn').d, 7, '灼烧不挡');
  assert.equal(strike(w, o2, 9, p, 'skill').d, 9, '神通不挡');
  assert.ok((o2.aegis ?? 0) > 0, '没挡的那几下不耗金光');
  // 到时散掉
  w.time += ELITES.lishi.cast.hold + 0.1;
  assert.equal(strike(w, o2, 11, p).d, 11, '散掉了');
});

test('金光力士：举旗时被晕住就打断（不套金光），过一会儿再举', () => {
  const { w, p } = arena(22);
  const e = put(w, 'lishi', p.x + 150, p.y);
  e.cd = 0;
  e.speed = 0;
  run(w, 0.2);
  assert.equal(e.act, 'cast');
  e.stun = 0.4;
  const ev = run(w, 1);
  assert.equal(ev.filter((x) => x.t === 'aegisCast').length, 0);
  const ev2 = run(w, 3);
  assert.equal(ev2.filter((x) => x.t === 'aegisCast').length, 1, '晕完再举一次');
});

// ---------------------------------------------------------------- 截教剑侍

test('截教剑侍：三柄剑轮流指向人物（先亮出那条线）再射出（w.orbs 里 kind blade），射完了重新聚齐；站着不动就挨剑', () => {
  const { w, p } = arena(31);
  const e = put(w, 'jianshi', p.x + 90, p.y);
  e.cd = 0;
  e.speed = 0;
  const ev = run(w, 8, () => idle, (x) => x.some((y) => y.t === 'bladeReform'));
  const ri = ev.findIndex((x) => x.t === 'bladeReform');
  const aims = ev.slice(0, ri).filter((x) => x.t === 'bladeAim') as (SimEvent & { t: 'bladeAim' })[];
  const shots = ev.filter((x) => x.t === 'bladeShot') as (SimEvent & { t: 'bladeShot' })[];
  assert.deepEqual(
    shots.map((s) => s.k),
    [0, 1, 2],
    '按 0、1、2 的顺序射',
  );
  assert.equal(aims.length, 3);
  assert.ok(ev.some((x) => x.t === 'bladeReform'), '射完了重新聚齐');
  assert.equal(e.blades, 3);
  assert.ok(hurts(ev, 'blade').length >= 2, '站着不动挨剑');
  for (let i = 0; i < 3; i++) {
    const ai = ev.indexOf(aims[i]);
    const si = ev.indexOf(shots[i]);
    assert.ok(si > ai, '先亮线再射');
    assert.deepEqual([shots[i].x0, shots[i].y0], [aims[i].x0, aims[i].y0], '从亮线的那一点射出');
  }
});

test('截教剑侍：抬剑时被晕住就打断，冻住时三柄剑不转；被打死时飞出去的剑照样飞完', () => {
  const { w, p } = arena(32);
  const e = put(w, 'jianshi', p.x + 90, p.y);
  e.cd = 0;
  e.speed = 0;
  run(w, 0.1);
  assert.equal(e.act, 'windup');
  e.stun = 0.5;
  e.frozen = 0.5;
  const s0 = e.spin;
  const ev = run(w, 0.4);
  assert.equal(ev.filter((x) => x.t === 'bladeShot').length, 0, '晕住了不射');
  assert.equal(e.spin, s0, '冻住不转');
  assert.equal(e.blades, 3);
  // 射出去一柄以后打死它：剑照样飞
  const ev2 = run(w, 3, () => idle, (x) => x.some((y) => y.t === 'bladeShot'));
  assert.ok(ev2.some((x) => x.t === 'bladeShot'));
  strike(w, e, 1e9, p, 'skill');
  run(w, DT);
  assert.ok(w.orbs.some((o) => o.kind === 'blade'), '剑还在飞');
  const [gx] = bladeSpot(e, 0);
  assert.ok(Number.isFinite(gx));
});

// ---------------------------------------------------------------- 词缀

test('词缀：坚甲少挨四成（被「破甲」咬了就不顶用）；迅捷快一半', () => {
  const { w, p } = arena(41);
  const a = put(w, 'xiaowei', p.x + 200, p.y, ['armor']);
  const b = put(w, 'xiaowei', p.x + 200, p.y + 40, []);
  assert.equal(strike(w, a, 100, p).d, Math.round(100 * (1 - AFFIX.armor.cut)));
  assert.equal(strike(w, b, 100, p).d, 100);
  a.sunderUntil = w.time + 5;
  a.sunder = 0;
  assert.equal(strike(w, a, 100, p).d, 100, '破甲：坚甲不顶用');
  const d = spawnElite(w, 'xiaowei', p.x + 200, p.y + 80, [], ['swift']);
  const [lo, hi] = ENEMIES.elite.speed;
  assert.ok(d.speed >= lo * AFFIX.swift.speed - 1e-9 && d.speed <= hi * AFFIX.swift.speed + 1e-9, '迅捷：快一半');
});

test('词缀：分魂——死时分出两只离魂（气血是平常的三倍），从倒下的地方往外弹开', () => {
  const { w, p } = arena(42);
  const e = put(w, 'xiaowei', p.x + 150, p.y, ['split']);
  const { ev } = strike(w, e, 1e9, p, 'skill');
  const sp = ev.find((x) => x.t === 'affixSplit') as SimEvent & { t: 'affixSplit' };
  assert.ok(sp);
  assert.equal(sp.ids.length, AFFIX.split.n);
  for (const id of sp.ids) {
    const s = w.enemies.find((o) => o.id === id)!;
    assert.equal(s.kind, 'splitling');
    assert.ok(Math.hypot(s.x - e.x, s.y - e.y) < 10 && Math.hypot(s.kx, s.ky) > 50);
    assert.ok(s.maxHp >= 30, '比平常的离魂厚');
  }
});

test('词缀：反震——被身边的人打中就蓄力，到时震开身边的人；远处打它不起手；蓄力时被晕住就打断', () => {
  const { w, p } = arena(43);
  const e = put(w, 'xiaowei', p.x + 30, p.y, ['recoil']);
  e.speed = 0;
  const far = put(w, 'xiaowei', p.x + 200, p.y + 60, ['recoil']);
  far.speed = 0;
  const r1 = strike(w, far, 5, p);
  assert.ok(!r1.ev.some((x) => x.t === 'recoilWarn'), '离得远：不起手');
  const r2 = strike(w, e, 5, p);
  assert.ok(r2.ev.some((x) => x.t === 'recoilWarn'), '贴身打：起手');
  assert.equal(strike(w, e, 5, p).ev.filter((x) => x.t === 'recoilWarn').length, 0, '蓄着的时候不再起手');
  const ev = run(w, AFFIX.recoil.warn + 0.1);
  assert.ok(ev.some((x) => x.t === 'recoil'));
  assert.equal(hurts(ev, 'recoil').length, 1);
  assert.ok((p.blowX ?? 0) < -50, '往外震开');
  // 冷却好了再贴身打、马上晕住它：不震
  run(w, AFFIX.recoil.cooldown + 0.1);
  p.iframes = 0;
  p.blowX = p.blowY = 0;
  p.x = p.px = e.x - 30; // 被震开了：再走回它身边
  p.y = p.py = e.y;
  assert.ok(strike(w, e, 5, p).ev.some((x) => x.t === 'recoilWarn'));
  e.stun = 0.3;
  const ev2 = run(w, AFFIX.recoil.warn + 0.2);
  assert.equal(ev2.filter((x) => x.t === 'recoil').length, 0, '晕住就打断');
});

test('词缀：召唤——人物在附近时掐诀（先亮两处符印），从符印里冒出两只回响兵（愣一下），召出来的最多六只', () => {
  const { w, p } = arena(44);
  const e = put(w, 'xiaowei', p.x + 120, p.y, ['summon']);
  e.speed = 0;
  const ev = run(w, AFFIX.summon.first + AFFIX.summon.warn + 0.3, () => idle, (x) => x.some((y) => y.t === 'eliteCall'));
  const wi = ev.findIndex((x) => x.t === 'eliteCallWarn');
  const call = ev.find((x) => x.t === 'eliteCall') as SimEvent & { t: 'eliteCall' };
  assert.ok(wi >= 0 && call && ev.indexOf(call) > wi);
  const warn = ev[wi] as SimEvent & { t: 'eliteCallWarn' };
  assert.equal(call.ids.length, AFFIX.summon.n);
  call.ids.forEach((id, i) => {
    const s = w.enemies.find((o) => o.id === id)!;
    assert.equal(s.kind, 'soldier');
    assert.ok(Math.hypot(s.x - warn.pts[i][0], s.y - warn.pts[i][1]) < 1, '从符印里冒出来');
    assert.ok(s.stun > 0, '刚冒出来愣一下');
  });
  // 一直不打：召满六只就不再召
  for (const s of w.enemies) if (s.kind === 'soldier') s.speed = 0;
  const ev2 = run(w, AFFIX.summon.every * 4);
  for (const s of w.enemies) if (s.kind === 'soldier') s.speed = 0;
  const n = [...ev, ...ev2].filter((x) => x.t === 'eliteCall').reduce((a, x) => a + (x as SimEvent & { t: 'eliteCall' }).ids.length, 0);
  assert.equal(n, AFFIX.summon.max);
});

// ---------------------------------------------------------------- 经得起被吸走、定身、冻住

test('被混元金斗那样暂时拿出场外再放回来：精英和词缀接着做原来那一步，不出岔子；定身、冻住期间不出手', () => {
  const kinds: [EliteKind, EliteAffix[]][] = [
    ['yecha', ['summon']],
    ['lishi', ['recoil']],
    ['jianshi', ['split', 'swift']],
    ['xiaowei', ['armor', 'summon']],
  ];
  for (const [kind, affixes] of kinds) {
    const { w, p } = arena(51);
    const e = put(w, kind, p.x + 90, p.y, affixes);
    e.cd = 0;
    run(w, 0.7);
    // 拿出去（同金斗：从 w.enemies 里拿走），过 1.5 秒再放回别处
    w.enemies = w.enemies.filter((o) => o !== e);
    run(w, 1.5);
    e.x = e.px = p.x - 70;
    e.y = e.py = p.y + 10;
    e.stun = 0.8;
    w.enemies.push(e);
    const ev = run(w, 0.75);
    assert.equal(ev.filter((x) => (x.t === 'yechaSlap' || x.t === 'bladeShot' || x.t === 'aegisCast' || x.t === 'recoil' || x.t === 'eliteCall') && 'id' in x && x.id === e.id).length, 0, `${kind}：晕着不出手`);
    const ev2 = run(w, 6);
    assert.ok(e.hp > 0 && Number.isFinite(e.x) && Number.isFinite(e.y), `${kind}：还好好的`);
    assert.ok(ev2.length >= 0);
  }
});

test('被赵公明的黑虎震慑（吓住、往外逃）：召唤不起手、被贴身打也不反震，迅捷的逃得快；潜在水里的夜叉不吃震慑', () => {
  const { w, p } = arena(55);
  const scare = (e: Enemy, dur = 3) => {
    e.fearUntil = w.time + dur;
    e.fearDx = 1;
    e.fearDy = 0;
    e.fear = 0.5;
  };
  const a = put(w, 'xiaowei', p.x + 40, p.y, ['summon', 'recoil']);
  a.callCd = 0;
  scare(a);
  const ev = run(w, 1);
  assert.equal(ev.filter((x) => x.t === 'eliteCallWarn').length, 0, '吓住时不召唤');
  assert.equal(strike(w, a, 5, p).ev.filter((x) => x.t === 'recoilWarn').length, 0, '吓住时不反震');
  // 迅捷的逃得快（逃的速度按移速算）
  const b = put(w, 'xiaowei', p.x - 150, p.y + 60, ['swift']);
  const c = put(w, 'xiaowei', p.x - 150, p.y - 60, []);
  b.speed = c.speed = 22;
  b.speed *= 1.5;
  scare(b);
  scare(c);
  const bx = b.x;
  const cx = c.x;
  run(w, 0.5);
  assert.ok(b.x - bx > (c.x - cx) * 1.3, '迅捷的逃得快');
  // 潜在水里：不吃震慑
  const y = put(w, 'yecha', p.x + 120, p.y + 30);
  y.cd = 0;
  y.cd2 = 1e9;
  run(w, 0.3);
  assert.ok(y.hidden);
  scare(y);
  run(w, DT * 2);
  assert.equal(y.fearUntil, undefined, '水里不吃震慑');
});

// ---------------------------------------------------------------- 存档

test('精英和词缀都在整局存档里：带着各种精英、各种词缀打到一半存一份，恢复后接着跑逐帧一样', () => {
  const { w, p } = arena(61, 5, 5);
  const list: [EliteKind, EliteAffix[]][] = [
    ['yecha', ['recoil', 'split']],
    ['lishi', ['summon', 'armor']],
    ['jianshi', ['swift', 'summon']],
    ['xiaowei', ['recoil', 'armor']],
  ];
  list.forEach(([k, a], i) => {
    const e = put(w, k, p.x + 80 + i * 30, p.y + (i % 2 ? 50 : -50), a);
    e.cd = 0.5 * i;
  });
  for (let i = 0; i < 20; i++) spawnElite(w, 'xiaowei', p.x - 150, p.y - 60 + i * 6, []).speed = 8;
  p.weapons = createWorld(61).players[0].weapons; // 带上起手的乾坤圈，有来有往
  const frame = (x: World) => step(x, [botInput(x, 0)], x.phase === 'shop' ? botShop(x, 0) : []);
  for (let i = 0; i < 60 * 4; i++) frame(w);
  const b = restore(JSON.parse(JSON.stringify(snapshot(w))));
  for (let i = 0; i < 60 * 8; i++) {
    const ea = JSON.stringify(frame(w));
    const eb = JSON.stringify(frame(b));
    if (ea !== eb || digest(w) !== digest(b)) assert.fail(`恢复后第 ${i + 1} 帧跑岔了`);
  }
  assert.equal(canonicalText(b), canonicalText(w));
});
