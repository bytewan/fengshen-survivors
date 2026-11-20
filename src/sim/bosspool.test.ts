// 首领池（sim/bosspool.ts）的模拟测试：开局抽签（按种子确定、能指定、不给就是加首领池之前的排法且不用随机数）、整局存档存下抽到了谁；
// 池里的每一位都有两种打法——当首领（World.boss：三个阶段、倒下后本章平定）和来遭遇战（World.echo：气血少、两个阶段、不清场、波末退走）；
// 第一章有遭遇战时原来第 4 波的精英挪到第 3 波；回响敖丙的每一招先预警再判定、照着预警走躲得开；整段确定、存档恢复后逐帧相同。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, digest, spawnAt, step, type PlayerInput, type SimEvent, type World } from './world.ts';
import { DT } from './config.ts';
import { CHAPTERS, ELITE_FLOW } from './catalog.ts';
import { hitEnemy } from './core.ts';
import { createRng } from './rng.ts';
import { BOSS_INFO, LEGACY, POOL, chiefWaveOf, fightEnemy, fightOf, guestHp, guestWaveOf, parseCast, type BossId } from './bosspool.ts';
import { bossById, drawCast, poolOf } from './chapters.ts';
import { echoDigest, echoDodge, echoOf } from './echo/index.ts';
import { botInput, botShop } from './bot.ts';
import { canonicalText, restore, snapshot } from './snapshot.ts';
import type { EchoMove } from './echo/types.ts';

const idle: PlayerInput = { mx: 0, my: 0, skill: false };
type Ev<T extends SimEvent['t']> = Extract<SimEvent, { t: T }>;
const evs = <T extends SimEvent['t']>(ev: SimEvent[], t: T) => ev.filter((e): e is Ev<T> => e.t === t);
const frames = (w: World, n: number, input: (w: World) => PlayerInput = () => idle) => {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) out.push(...step(w, [input(w)], w.phase === 'shop' ? [{ t: 'ready', player: 0 }] : []));
  return out;
};
const ALL = Object.keys(BOSS_INFO) as BossId[];

/** 干净的场地里直接放出 id 来遭遇战：刷怪关掉、人物满血不死。 */
function guestFight(id: BossId, seed = 3) {
  const w = createWorld(seed, 1, ['nezha']);
  w.wave = guestWaveOf(id);
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
  bossById(id)!.start(w, ev, (k, x, y) => spawnAt(w, k, x, y, ev), true);
  return { w, p, e: fightEnemy(w)!, ev };
}

/** 指定 id 当他那一章的首领，从首领波前的商店开打（人物满血不死、不带法宝）。 */
function chiefFight(id: BossId, seed = 3) {
  const w = createWorld(seed, 1, { heroes: ['nezha'], cast: parseCast(id) });
  w.wave = chiefWaveOf(id) - 1;
  w.phase = 'shop';
  const p = w.players[0];
  p.weapons = [];
  p.pet.cd = 1e12;
  p.stats.maxHp = p.hp = 1e7;
  const ev = frames(w, 2);
  return { w, p, e: fightEnemy(w)!, ev };
}

test('抽签：每章从池子里抽一个当首领、另一个来遭遇战；同一个种子抽到的一样；不同的种子两种都抽得到', () => {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 40; seed++) {
    const a = drawCast(createRng(seed), 'draw');
    assert.deepEqual(a, drawCast(createRng(seed), 'draw'), '同一个种子一样');
    assert.equal(a.length, CHAPTERS);
    a.forEach((c, i) => {
      const pool = poolOf(i + 1);
      assert.ok(pool.includes(c.chief), `第 ${i + 1} 章的首领在池子里`);
      assert.ok(c.guest && pool.includes(c.guest) && c.guest !== c.chief, '另一位来遭遇战');
      seen.add(c.chief);
    });
  }
  for (const id of ALL) assert.ok(seen.has(id), `${id} 当过首领`);
  for (let ch = 1; ch <= CHAPTERS; ch++) assert.deepEqual(poolOf(ch), POOL.chapters[ch], '池子里的每一位都登记了模块');
});

test('指定：给一个名字 = 他当首领、另一位来遭遇战，那一章不用随机数；.solo = 没有遭遇战；不给 = 加首领池之前的排法，一个随机数都不用', () => {
  const r = createRng(9);
  const c = drawCast(r, parseCast('aobing,yao,yunxiao'));
  assert.deepEqual(c, [
    { chief: 'aobing', guest: 'nezha' },
    { chief: 'yao', guest: 'zhao' },
    { chief: 'yunxiao', guest: 'zhuxian' },
  ]);
  assert.equal(r.state, createRng(9).state, '三章都指定：不用随机数');
  assert.deepEqual(drawCast(createRng(9), parseCast('nezha.solo'))[0], { chief: 'nezha', guest: null });
  assert.equal(parseCast('legacy'), undefined);
  assert.equal(parseCast(null), 'draw');
  const w = createWorld(77);
  assert.deepEqual(w.cast, LEGACY);
  assert.equal(w.rng.state, createRng(77).state, '「原样」不动随机数（所以别的测试、数值工具的结果和加首领池之前逐字相同）');
  const d = createWorld(77, 1, { cast: 'draw' });
  assert.notEqual(d.rng.state, createRng(77).state, '抽签用了随机数');
});

test('抽到了谁存在整局存档里：恢复出来一样，之后首领波放出的是抽到的那一位', () => {
  const w = createWorld(5, 1, { heroes: ['nezha'], cast: parseCast('aobing,zhao,yunxiao') });
  const r = restore(JSON.parse(JSON.stringify(snapshot(w))));
  assert.deepEqual(r.cast, w.cast);
  r.wave = 5;
  r.phase = 'shop';
  r.players[0].stats.maxHp = r.players[0].hp = 1e7;
  const ev = frames(r, 2);
  const intro = evs(ev, 'bossIntro')[0];
  assert.ok(intro);
  assert.equal(intro.kind, 'aobing');
  assert.equal(r.boss?.kind, 'aobing');
});

test('池里的每一位都能来遭遇战：状态在 World.echo（World.boss 是空的），气血少、现身无敌；一阶段打不死（卡在一半）→ 二阶段打空倒下：echoDefeat、掉宝匣，场上别的敌人不动；倒下的表现放完槽清空', () => {
  for (const id of ALL) {
    const { w, e, ev } = guestFight(id);
    assert.equal(w.boss, null, `${id}：不是章节首领`);
    assert.equal(w.echo?.kind, id);
    assert.equal(w.echo?.guest, true);
    assert.equal(evs(ev, 'echoIntro')[0]?.kind, id);
    assert.equal(evs(ev, 'bossIntro').length, 0);
    assert.equal(e.kind, 'boss');
    assert.equal(e.maxHp, guestHp(w, id));
    const other = spawnAt(w, 'soldier', e.x + 200, e.y, []);
    other.hp = other.maxHp = 1e9;
    const hit = (dmg: number) => hitEnemy(w, e, { dmg, by: 'ring', owner: 0, from: e, canCrit: false }, []);
    assert.equal(hit(100), 0, `${id}：现身时无敌`);
    frames(w, Math.ceil(2.5 / DT));
    e.invuln = 0;
    hit(1e7);
    assert.equal(e.hp, Math.ceil(e.maxHp * POOL.guestPhaseAt), `${id}：一阶段卡在一半`);
    const ev2 = frames(w, 1);
    assert.equal(evs(ev2, 'echoPhase')[0]?.kind, id);
    assert.equal(evs(ev2, 'bossPhase').length, 0);
    assert.equal(w.echo!.phase, 2);
    assert.ok(e.invuln > 0, `${id}：换阶段无敌`);
    frames(w, Math.ceil(3 / DT));
    e.invuln = 0;
    hit(1e7);
    const ev3 = frames(w, 1);
    const d = evs(ev3, 'echoDefeat')[0];
    assert.ok(d, `${id}：倒下`);
    assert.equal(d.unlock, BOSS_INFO[id].unlock ?? '');
    assert.equal(evs(ev3, 'bossDeath').length + evs(ev3, 'chapterClear').length, 0, `${id}：不放结局、不换章`);
    assert.ok(w.drops.some((x) => x.kind === 'chest' && x.rich), `${id}：精英宝匣`);
    assert.ok(w.enemies.includes(other), `${id}：场上别的敌人不动`);
    assert.equal(w.phase, 'wave');
    frames(w, Math.ceil(POOL.guestDeath / DT) + 3);
    assert.equal(w.echo, null, `${id}：倒下的表现放完就收掉`);
    assert.equal(w.phase, 'wave', '这一波照常打');
  }
});

test('遭遇战这一波结束还没打倒：退走（echoLeave，带着剩下的气血），下一波不带过去', () => {
  for (const id of ALL) {
    const { w, e } = guestFight(id);
    frames(w, 90);
    e.hp = Math.round(e.maxHp * 0.8);
    w.waveLen = w.waveT + DT * 0.5;
    const ev = frames(w, 2);
    const l = evs(ev, 'echoLeave')[0];
    assert.ok(l, `${id}：退走`);
    assert.equal(l.kind, id);
    assert.ok(Math.abs(l.hp - 0.8) < 0.02);
    assert.equal(evs(ev, 'echoDefeat').length, 0);
    assert.equal(w.echo, null);
    assert.equal(w.phase, 'collect');
  }
});

test('池里的每一位都能当首领：bossIntro 带着是哪一位，状态在 World.boss；三个阶段（六成、三成各卡一次），打空倒下：bossDeath → 本章平定（最后一章通关）', () => {
  for (const id of ALL) {
    const { w, e, ev } = chiefFight(id);
    assert.equal(evs(ev, 'bossIntro')[0]?.kind, id);
    assert.equal(w.boss?.kind, id);
    assert.equal(w.boss?.guest, false);
    assert.equal(w.echo, null);
    const hit = () => {
      e.invuln = 0;
      hitEnemy(w, e, { dmg: 1e9, by: 'ring', owner: 0, from: e, canCrit: false }, []);
    };
    frames(w, Math.ceil(3 / DT));
    for (const [n, k] of [
      [2, 0.6],
      [3, 0.3],
    ]) {
      hit();
      const pe = frames(w, 1);
      assert.equal(e.hp, Math.ceil(e.maxHp * k), `${id}：卡在 ${k}（一次大伤害也不跳阶段）`);
      assert.equal(evs(pe, 'bossPhase')[0]?.phase, n, `${id}：换第 ${n} 阶段`);
      assert.equal(evs(pe, 'echoPhase').length, 0);
      frames(w, Math.ceil(3.2 / DT));
    }
    hit();
    const de = frames(w, 1);
    const d = evs(de, 'bossDeath')[0];
    assert.ok(d, `${id}：倒下`);
    assert.equal(d.kind, id);
    assert.equal(evs(de, 'echoDefeat').length, 0);
    const end = frames(w, Math.ceil(3 / DT));
    if (d.chapter >= CHAPTERS) assert.equal(evs(end, 'win').length, 1, `${id}：通关`);
    else assert.equal(evs(end, 'chapterClear')[0]?.chapter, d.chapter, `${id}：本章平定`);
    assert.equal(w.boss, null);
  }
});

test('整局里：第一章抽到敖丙当首领时，第 4 波出精英的那一刻魔化哪吒来遭遇战（本章的精英不刷）；原来第 4 波的那只精英挪到第 3 波', (t) => {
  // 只看本章原来那一批精英怎么挪（另外陆续来的精英 catalog.ELITE_FLOW 先关掉）
  const from0 = ELITE_FLOW.from;
  ELITE_FLOW.from = 99;
  t.after(() => void (ELITE_FLOW.from = from0));
  const w = createWorld(5, 1, { heroes: ['nezha'], cast: parseCast('aobing') });
  w.players[0].stats.maxHp = w.players[0].hp = 1e7;
  w.wave = 2;
  w.phase = 'shop';
  let elite3 = false;
  let intro: Ev<'echoIntro'> | undefined;
  for (let i = 0; i < 60 * 80 && !intro; i++) {
    const ev = step(w, [idle], w.phase === 'shop' ? botShop(w, 0) : []);
    if (w.wave === 3 && w.enemies.some((e) => e.kind === 'elite')) elite3 = true;
    intro = evs(ev, 'echoIntro')[0];
  }
  assert.ok(elite3, '第 3 波出了精英');
  assert.ok(intro, '第 4 波现身了');
  assert.equal(intro!.kind, 'nezha');
  assert.equal(w.wave, 4);
  assert.equal(w.boss, null);
  assert.equal(w.echo?.kind, 'nezha');
  assert.equal(w.enemies.filter((e) => e.kind === 'elite').length, 0, '第 4 波本章的精英不刷了');
  // 「原样」的第一章：没有遭遇战，精英照旧在第 4 波
  const o = createWorld(5, 1, ['nezha']);
  o.players[0].stats.maxHp = o.players[0].hp = 1e7;
  o.wave = 2;
  o.phase = 'shop';
  let e3 = false;
  let e4 = false;
  for (let i = 0; i < 60 * 80 && o.wave <= 4; i++) {
    step(o, [idle], o.phase === 'shop' ? botShop(o, 0) : []);
    if (o.enemies.some((e) => e.kind === 'elite')) (o.wave === 3 ? (e3 = true) : (e4 = true));
    assert.equal(o.echo, null);
  }
  assert.equal(e3, false);
  assert.equal(e4, true);
});

test('回响敖丙：每一招先亮预警再判定（预警期间不伤人）；站着不动挨打，照着预警往外走就躲开了（画戟、冰龙、海浪、化龙、怒潮）', () => {
  const cases: [EchoMove, number][] = [
    ['ji', 1],
    ['icelong', 1],
    ['tide', 1],
    ['ji', 2],
    ['icelong', 2],
    ['hualong', 2],
    ['tsunami', 3],
    ['hualong', 3],
  ];
  for (const [move, phase] of cases) {
    const setup = () => {
      const a = guestFight('aobing');
      const f = echoOf(a.w)!;
      f.phase = phase;
      f.queue = [move];
      delete a.e.hpFloor;
      return { ...a, f };
    };
    // 站着不动：挨打
    const a = setup();
    let hurtInWarn = false;
    let hurt = 0;
    for (let i = 0; i < 60 * 9 && hurt === 0; i++) {
      const ev = step(a.w, [idle]);
      const hs = evs(ev, 'hurt').filter((h) => h.by === 'echo');
      if (hs.length && a.f.hazards.length && !a.f.hazards.some((h) => h.t >= h.warn)) hurtInWarn = true;
      hurt += hs.length;
      a.p.iframes = 0;
      if (a.f.ride === null) a.e.x = a.e.px = a.p.x + 110; // 站远一点，别贴身挨撞
    }
    assert.ok(hurt > 0, `${move}（${phase} 阶段）：站着不动挨打`);
    assert.equal(hurtInWarn, false, `${move}：预警期间不伤人`);
    // 预警一亮就照机器人的躲招方向走：躲得开
    const b = setup();
    let hurtB = 0;
    for (let i = 0; i < 60 * 9; i++) {
      const [dx, dy] = echoDodge(b.w, b.p, 0);
      const m = Math.hypot(dx, dy);
      const ev = step(b.w, [m > 0.01 ? { mx: dx / m, my: dy / m, skill: false } : idle]);
      hurtB += evs(ev, 'hurt').filter((h) => h.by === 'echo').length;
      b.p.iframes = 0;
      if (b.f.ride === null && b.f.state !== 'cast') b.e.x = b.e.px = b.p.x + 110;
      if (b.f.last === move && !b.f.hazards.length && b.f.state !== 'cast') break;
    }
    assert.equal(hurtB, 0, `${move}（${phase} 阶段）：照着预警往外走就躲开了`);
  }
});

test('回响敖丙的海浪：几道并排的浪里空着一道，空的那一道紧挨着人物所在的那一道；化龙时本体跟着白龙走', () => {
  const { w, p, e } = guestFight('aobing');
  const f = echoOf(w)!;
  f.queue = ['tide'];
  for (let i = 0; i < 60 * 6 && !f.hazards.length; i++) step(w, [idle]);
  const seqs = f.hazards.map((h) => h.seq!).sort((x, y) => x - y);
  assert.equal(seqs.length, 4, '五道里出四道');
  const missing = [0, 1, 2, 3, 4].find((i) => !seqs.includes(i))!;
  assert.ok(missing === 1 || missing === 3, '空的那一道紧挨着当中');
  assert.ok(f.hazards.every((h) => Math.abs(h.y0 - p.y) > 1 || h.seq === 2), '当中那一道穿过人物');
  // 化龙
  const g = guestFight('aobing', 4);
  const gf = echoOf(g.w)!;
  gf.phase = 2;
  gf.queue = ['hualong'];
  delete g.e.hpFloor;
  let rode = 0;
  const x0 = g.e.x;
  for (let i = 0; i < 60 * 8; i++) {
    step(g.w, [idle]);
    g.p.iframes = 0;
    if (gf.ride !== null) {
      rode++;
      const h = gf.hazards.find((x) => x.id === gf.ride);
      if (h) assert.ok(Math.hypot(g.e.x - h.x, g.e.y - h.y) < 14, '本体在龙头的位置');
    }
    if (gf.last === 'hualong' && gf.state !== 'cast') break;
  }
  assert.ok(rode > 10, '冲了一阵');
  assert.equal(gf.ride, null, '冲完变回人');
  assert.notEqual(Math.round(g.e.x), Math.round(x0), '人跟着龙走到了别处');
  void e;
});

test('首领池整段确定：按种子抽签、机器人从头打到第一章首领，两遍逐帧一样；敖丙的遭遇战、首领战打到一半存档恢复后接着跑逐帧相同', () => {
  const play = (seed: number) => {
    const w = createWorld(seed, 1, { heroes: ['nezha'], cast: 'draw' });
    const trace: string[] = [w.cast.map((c) => c.chief + '/' + c.guest).join(',')];
    for (let i = 0; i < 60 * 150 && w.phase !== 'over' && w.wave <= 4; i++) {
      step(w, [botInput(w, 0)], w.phase === 'shop' ? botShop(w, 0) : []);
      if (i % 60 === 0) trace.push(digest(w) + '|' + echoDigest(w));
    }
    return trace;
  };
  assert.deepEqual(play(41), play(41));
  for (const mk of [() => guestFight('aobing', 9), () => chiefFight('aobing', 9), () => guestFight('nezha', 9), () => chiefFight('zhao', 9)]) {
    const { w } = mk();
    const f = fightOf(w)!;
    for (let i = 0; i < 60 * 30 && !(f.state === 'cast' && (f as { hazards: unknown[] }).hazards.length); i++) step(w, [botInput(w, 0)]);
    for (let i = 0; i < 20; i++) step(w, [botInput(w, 0)]);
    const r = restore(JSON.parse(JSON.stringify(snapshot(w))));
    assert.equal(canonicalText(r), canonicalText(w));
    for (let i = 0; i < 500; i++) {
      const a = JSON.stringify(step(w, [botInput(w, 0)]));
      const b = JSON.stringify(step(r, [botInput(r, 0)]));
      assert.equal(b, a, `${f.kind} 第 ${i + 1} 帧跑岔了`);
    }
  }
});
