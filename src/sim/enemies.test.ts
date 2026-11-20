// 第一章新敌人：行为（蓄力后才出手、站在线外不挨打、盾牌正面减伤背面全额、自爆引信前打死不爆、分裂一次）、
// 出场节奏、确定性。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, digest, spawnEnemy, step, type PlayerInput, type SimEvent, type World } from './world.ts';
import { DT, ENEMIES, FOES } from './config.ts';
import { ELITE_FLOW, waveDuration } from './catalog.ts';
import { hitEnemy } from './core.ts';
import { ENEMY_NAME, spawnShares } from './enemies.ts';
import { botEnemyDodge } from './bot-dodge.ts';
import { botInput, botShop } from './bot.ts';
import type { Enemy, EnemyKindName, HitBy } from './types.ts';

const idle: PlayerInput = { mx: 0, my: 0, skill: false };
/** 跑若干秒（或直到 until 成立），收集事件。input 每帧给出玩家的输入。 */
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
const arena = (seed: number) => {
  const w = createWorld(seed);
  w.wave = 3;
  w.waveLen = 1e9;
  w.spawnAcc = -1e12;
  w.eliteDone = true;
  w.surgeDone = true;
  const p = w.players[0];
  p.weapons = [];
  p.pet.cd = 1e12;
  p.hp = p.stats.maxHp = 1e6;
  return { w, p };
};
const put = (w: World, kind: EnemyKindName, x: number, y: number) => {
  const e = spawnEnemy(w, kind, x, y, []);
  e.x = e.px = x;
  e.y = e.py = y;
  return e;
};
const hurts = (ev: SimEvent[], by: string) => ev.filter((e) => e.t === 'hurt' && e.by === by);
const idx = (ev: SimEvent[], t: string, id?: number) => ev.findIndex((e) => e.t === t && (id === undefined || ('id' in e && e.id === id)));
/** 打一下（不暴击，方便算账）。 */
const strike = (w: World, e: Enemy, dmg: number, from: { x: number; y: number }, by: HitBy = 'ring') => {
  const ev: SimEvent[] = [];
  hitEnemy(w, e, { dmg, by, owner: 0, from, canCrit: false }, ev);
  return ev;
};

// ---------- 回响矛卒 ----------

test('长矛兵：走到离人物约 30 像素处停下，蓄力 0.5 秒后才刺出；站着不动就挨一矛', () => {
  const { w, p } = arena(1);
  const e = put(w, 'spearman', p.x + 90, p.y);
  e.cd = 0;
  const ev = run(w, 5, () => idle, (x) => x.some((y) => y.t === 'foeStrike'));
  const wi = idx(ev, 'foeWindup', e.id);
  const si = idx(ev, 'foeStrike', e.id);
  assert.ok(wi >= 0 && si > wi, '先蓄力、再出手');
  const d = Math.hypot(e.x - p.x, e.y - p.y);
  assert.ok(d >= FOES.spearman.back - 1 && d <= FOES.spearman.hold + 3, `停在约 30 像素处，实际 ${d.toFixed(1)}`);
  // 蓄力期间没有挨刺
  assert.equal(hurts(ev.slice(0, si), 'spear').length, 0, '蓄力时不伤人');
  const w0 = ev[wi] as SimEvent & { t: 'foeWindup' };
  const s0 = ev[si] as SimEvent & { t: 'foeStrike' };
  assert.deepEqual([s0.x0, s0.y0, s0.x1, s0.y1], [w0.x0, w0.y0, w0.x1, w0.y1], '出手沿预警的那条线');
  const after = run(w, 0.3);
  assert.equal(hurts([...ev.slice(si), ...after], 'spear').length, 1, '站在线上挨一矛（只挨一下）');
  // 蓄力时长 = 0.5 秒
  const { w: w2, p: p2 } = arena(1);
  const e2 = put(w2, 'spearman', p2.x + 29, p2.y);
  e2.cd = 0;
  let t = 0;
  let started = -1;
  for (; t < 3; t += DT) {
    const x = step(w2, [idle]);
    if (x.some((y) => y.t === 'foeWindup')) started = t;
    if (x.some((y) => y.t === 'foeStrike')) break;
  }
  assert.ok(started >= 0 && Math.abs(t - started - FOES.spearman.windup) < 2 * DT, `蓄力 ${(t - started).toFixed(3)} 秒`);
});

test('长矛兵：蓄力时往旁边让开（站在刺击线外）就不挨打；刺击线不跟踪；冷却约 2 秒后再刺', () => {
  const { w, p } = arena(2);
  const e = put(w, 'spearman', p.x + 29, p.y);
  e.cd = 0;
  const ev0 = run(w, 1, () => idle, (x) => x.some((y) => y.t === 'foeWindup'));
  assert.ok(ev0.some((x) => x.t === 'foeWindup'));
  const aim = [e.aimX, e.aimY];
  // 线是横的：往下走 0.3 秒（约 25 像素）就到线外了
  const ev = run(w, 0.6, () => ({ mx: 0, my: 1, skill: false }));
  assert.ok(ev.some((x) => x.t === 'foeStrike'));
  assert.deepEqual([e.aimX, e.aimY], aim, '刺击线定下就不跟踪');
  assert.equal(hurts(ev, 'spear').length, 0, '让开了就刺不中');
  // 人物站定：冷却从出手算起约 2 秒，之后再蓄力 0.5 秒刺出
  const times: number[] = [];
  for (let t = 0; t < 8 && times.length < 2; t += DT) if (step(w, [idle]).some((x) => x.t === 'foeStrike')) times.push(t);
  assert.equal(times.length, 2);
  const gap = times[1] - times[0];
  const S = FOES.spearman;
  assert.ok(gap >= S.cooldown + S.windup - 0.05 && gap <= S.cooldown + S.windup + 0.5, `两次出手间隔 ${gap.toFixed(2)} 秒`);
});

test('长矛兵：蓄力时被晕住就打断，这一矛不刺出', () => {
  const { w, p } = arena(3);
  const e = put(w, 'spearman', p.x + 29, p.y);
  e.cd = 0;
  run(w, 1, () => idle, (x) => x.some((y) => y.t === 'foeWindup'));
  e.stun = 0.4;
  const ev = run(w, 0.6);
  assert.ok(!ev.some((x) => x.t === 'foeStrike'), '被打断');
  assert.equal(hurts(ev, 'spear').length, 0);
});

// ---------- 玄符盾卫 ----------

test('盾兵：正面受到的伤害大幅降低，侧面和背后全额；砸地、持续伤害不吃减伤', () => {
  const { w, p } = arena(4);
  const e = put(w, 'shieldbearer', p.x + 60, p.y);
  e.hp = e.maxHp = 1e6;
  run(w, 0.1); // 举盾朝向人物
  assert.ok(e.face !== undefined && Math.abs(Math.cos(e.face) + 1) < 0.05, '盾朝着人物（左边）');
  const front = strike(w, e, 40, { x: e.x - 30, y: e.y - 7 });
  const hitF = front.find((x) => x.t === 'hit') as SimEvent & { t: 'hit' };
  assert.equal(hitF.dmg, Math.round(40 * FOES.shieldbearer.guard), '正面：× guard');
  assert.ok(front.some((x) => x.t === 'foeGuard' && x.id === e.id), '正面挡下有 foeGuard 事件');
  const back = strike(w, e, 40, { x: e.x + 30, y: e.y - 7 });
  assert.equal((back.find((x) => x.t === 'hit') as SimEvent & { t: 'hit' }).dmg, 40, '背后：全额');
  assert.ok(!back.some((x) => x.t === 'foeGuard'));
  const side = strike(w, e, 40, { x: e.x, y: e.y + 30 });
  assert.equal((side.find((x) => x.t === 'hit') as SimEvent & { t: 'hit' }).dmg, 40, '侧面：全额');
  const slam = strike(w, e, 40, { x: e.x - 30, y: e.y }, 'slam');
  assert.equal((slam.find((x) => x.t === 'hit') as SimEvent & { t: 'hit' }).dmg, 40, '番天印从天而降：全额');
  const burn = strike(w, e, 40, { x: e.x - 30, y: e.y }, 'burn');
  assert.equal((burn.find((x) => x.t === 'hit') as SimEvent & { t: 'hit' }).dmg, 40, '灼烧：全额');
  // 别的敌人不受影响
  const s = put(w, 'soldier', p.x - 60, p.y);
  s.hp = s.maxHp = 1e6;
  const so = strike(w, s, 40, { x: p.x, y: p.y });
  assert.equal((so.find((x) => x.t === 'hit') as SimEvent & { t: 'hit' }).dmg, 40);
});

test('盾兵：走得慢、难击退；盾慢慢转向，绕到背后就是全额', () => {
  const { w, p } = arena(5);
  const e = put(w, 'shieldbearer', p.x + 60, p.y);
  const s = put(w, 'soldier', p.x - 60, p.y);
  assert.ok(e.speed < s.speed, '比回响兵慢');
  assert.ok(ENEMIES.shieldbearer.mass >= 5 * ENEMIES.soldier.mass, '难击退');
  e.hp = e.maxHp = 1e6;
  run(w, 0.1);
  // 人物瞬间绕到它背后：盾要过一阵才转得过来，这期间从人物这边打是全额
  p.x = p.px = e.x + 40;
  step(w, [idle]);
  const ev = strike(w, e, 40, { x: p.x, y: p.y });
  assert.equal((ev.find((x) => x.t === 'hit') as SimEvent & { t: 'hit' }).dmg, 40, '盾还没转过来：全额');
  run(w, 2.5);
  const ev2 = strike(w, e, 40, { x: p.x, y: p.y - 7 });
  assert.equal((ev2.find((x) => x.t === 'hit') as SimEvent & { t: 'hit' }).dmg, Math.round(40 * FOES.shieldbearer.guard), '转过来之后又挡住了');
});

// ---------- 阴马骁骑 ----------

test('骑兵：离人物 120–200 像素时先预警 0.8 秒、再沿线冲锋；站在线上挨撞，冲完喘息约 1 秒', () => {
  const { w, p } = arena(6);
  const e = put(w, 'cavalry', p.x + 170, p.y);
  e.cd = 0;
  let warnAt = -1;
  let strikeAt = -1;
  const ev: SimEvent[] = [];
  for (let t = 0; t < 3 && strikeAt < 0; t += DT) {
    const x = step(w, [idle]);
    ev.push(...x);
    if (x.some((y) => y.t === 'foeWindup' && y.id === e.id)) warnAt = t;
    if (x.some((y) => y.t === 'foeStrike' && y.id === e.id)) strikeAt = t;
  }
  assert.ok(warnAt >= 0 && strikeAt > warnAt, '先预警、再冲锋');
  assert.ok(Math.abs(strikeAt - warnAt - FOES.cavalry.warn) < 2 * DT, `预警 ${(strikeAt - warnAt).toFixed(2)} 秒`);
  const w0 = ev.find((x) => x.t === 'foeWindup') as SimEvent & { t: 'foeWindup' };
  assert.ok(Math.hypot(w0.x1 - w0.x0, w0.y1 - w0.y0) > 170, '冲锋线穿过人物再延伸一段');
  assert.equal(hurts(ev, 'charge').length, 0, '预警时不伤人');
  const ev2 = run(w, 1.5, () => idle, (x) => x.some((y) => y.t === 'hurt' && y.by === 'charge'));
  assert.equal(hurts(ev2, 'charge').length, 1, '站在冲锋线上被撞');
  // 冲到线尽头后喘息：站定约 1 秒
  run(w, 1.5, () => idle, () => e.act === 'rest');
  assert.equal(e.act, 'rest');
  const x0 = e.x;
  run(w, FOES.cavalry.rest * 0.8);
  assert.ok(Math.abs(e.x - x0) < 3, '喘息时站着不动');
});

test('骑兵：冲锋线不跟踪 —— 预警时走出线外就撞不到', () => {
  const { w, p } = arena(7);
  const e = put(w, 'cavalry', p.x + 160, p.y);
  e.cd = 0;
  run(w, 2, () => idle, (x) => x.some((y) => y.t === 'foeWindup'));
  assert.equal(e.act, 'windup');
  const aim = [e.aimX, e.aimY];
  const ev = run(w, 2, () => ({ mx: 0, my: -1, skill: false }));
  assert.ok(ev.some((x) => x.t === 'foeStrike'));
  assert.deepEqual([e.aimX, e.aimY], aim, '方向没变');
  assert.equal(hurts(ev, 'charge').length, 0, '走开了就撞不到');
});

// ---------- 爆符鬼 ----------

test('自爆鬼：贴近点燃引信 0.8 秒后自爆，炸到人；点燃后打不死；自爆不算击杀、不掉灵石', () => {
  const { w, p } = arena(8);
  const e = put(w, 'bomber', p.x + 100, p.y);
  const ev = run(w, 4, () => idle, (x) => x.some((y) => y.t === 'foeFuse'));
  assert.ok(ev.some((x) => x.t === 'foeFuse' && x.id === e.id), '点燃引信');
  const d = Math.hypot(e.x - p.x, e.y - p.y);
  assert.ok(d <= FOES.bomber.light + 1, `贴近才点燃（${d.toFixed(1)}）`);
  // 点燃之后打不死
  const hit = strike(w, e, 9999, p);
  assert.ok(!hit.some((x) => x.t === 'kill'), '引信点燃后打不死');
  assert.ok(e.hp > 0);
  const gems = w.gems.length;
  const ev2 = run(w, FOES.bomber.fuse + 0.1);
  const blast = idx(ev2, 'foeBlast', e.id);
  assert.ok(blast >= 0, '炸开');
  assert.equal(hurts(ev2, 'blast').length, 1, '站在旁边被炸到');
  assert.ok(!w.enemies.includes(e), '炸完就没了');
  assert.ok(!ev2.some((x) => x.t === 'kill' && x.id === e.id), '自爆不算击杀');
  assert.equal(w.gems.length, gems, '不掉灵石');
});

test('自爆鬼：引信点燃前被打死就不炸；点燃后走开就炸不到', () => {
  const { w, p } = arena(9);
  const e = put(w, 'bomber', p.x + 100, p.y);
  run(w, 0.3);
  const ev = strike(w, e, 9999, p);
  assert.ok(ev.some((x) => x.t === 'kill' && x.id === e.id), '还没点燃，打得死');
  const ev2 = run(w, 2);
  assert.ok(!ev2.some((x) => x.t === 'foeFuse' || x.t === 'foeBlast'), '死了就不炸');
  assert.equal(hurts(ev2, 'blast').length, 0);
  // 点燃后往反方向跑开
  const { w: w2, p: p2 } = arena(10);
  put(w2, 'bomber', p2.x + 100, p2.y);
  run(w2, 4, () => idle, (x) => x.some((y) => y.t === 'foeFuse'));
  const ev3 = run(w2, 1.2, () => ({ mx: -1, my: 0, skill: false }));
  assert.ok(ev3.some((x) => x.t === 'foeBlast'));
  assert.equal(hurts(ev3, 'blast').length, 0, '跑开了就炸不到');
});

// ---------- 分魂鬼 ----------

test('分魂鬼：死时分成两只小鬼；小鬼再死不再分', () => {
  const { w, p } = arena(11);
  const e = put(w, 'splitter', p.x + 80, p.y);
  const ev = strike(w, e, 9999, p);
  const split = ev.find((x) => x.t === 'foeSplit') as (SimEvent & { t: 'foeSplit' }) | undefined;
  assert.ok(split && split.id === e.id && split.ids.length === 2, '分成两只');
  const kids = w.enemies.filter((x) => split!.ids.includes(x.id));
  assert.equal(kids.length, 2);
  assert.ok(kids.every((k) => k.kind === 'splitling' && k.hp > 0));
  assert.ok(kids.every((k) => Math.hypot(k.x - e.x, k.y - e.y) < 10), '就在原地分出来');
  for (const k of kids) {
    const ev2 = strike(w, k, 9999, p);
    assert.ok(ev2.some((x) => x.t === 'kill' && x.id === k.id));
    assert.ok(!ev2.some((x) => x.t === 'foeSplit'), '小鬼不再分');
  }
  run(w, 0.1);
  assert.equal(w.enemies.filter((x) => x.kind === 'splitling').length, 0);
});

// ---------- 出场节奏 ----------

test('出场节奏：第 1 波只有回响兵，2 波加长矛兵，3 波加自爆鬼和鬼火术士，4 波加盾兵，5 波加骑兵和分魂鬼；第二章起全都出', () => {
  const kinds = (wave: number) => Object.keys(spawnShares(wave)).sort();
  assert.deepEqual(kinds(1), []);
  assert.deepEqual(kinds(2), ['spearman']);
  assert.deepEqual(kinds(3), ['bomber', 'caster', 'spearman']);
  assert.deepEqual(kinds(4), ['bomber', 'caster', 'shieldbearer', 'spearman']);
  assert.deepEqual(kinds(5), ['bomber', 'caster', 'cavalry', 'shieldbearer', 'spearman', 'splitter']);
  for (const wave of [7, 9, 13, 17]) assert.deepEqual(kinds(wave), kinds(5), `第 ${wave} 波全都出`);
  const sum = (wave: number) => Object.entries(spawnShares(wave)).reduce((a, [k, v]) => a + (k === 'caster' ? 0 : v!), 0);
  assert.ok(sum(7) > sum(5) - 1e-9, '第二章的比例不低于第一章第 5 波');
  assert.ok(sum(17) <= FOES.cap + 1e-9, '回响兵始终是大头');
  for (const k of Object.keys(ENEMIES) as EnemyKindName[]) assert.ok(ENEMY_NAME[k], `${k} 有名字`);
});

test('出场节奏：实际刷出来的种类按波次来（精英照旧在第 4 波）', () => {
  const seen = (wave: number) => {
    const w = createWorld(100 + wave);
    w.wave = wave;
    w.waveLen = waveDuration(wave);
    const p = w.players[0];
    p.iframes = 1e9;
    p.weapons = [];
    p.pet.cd = 1e12;
    const kinds = new Set<string>();
    for (let i = 0; i < Math.round(w.waveLen / DT) - 2; i++) for (const e of step(w, [idle])) if (e.t === 'spawn') kinds.add(e.kind);
    return [...kinds].sort();
  };
  assert.deepEqual(seen(1), ['soldier']);
  // 本章第 ELITE_FLOW.from 波起每波另外陆续来精英（用户 11-12）
  assert.equal(ELITE_FLOW.from, 2);
  assert.deepEqual(seen(2), ['elite', 'soldier', 'spearman']);
  assert.deepEqual(seen(3), ['bomber', 'caster', 'elite', 'soldier', 'spearman']);
  assert.deepEqual(seen(4), ['bomber', 'caster', 'elite', 'shieldbearer', 'soldier', 'spearman']);
  const s5 = seen(5);
  for (const k of ['cavalry', 'splitter', 'shieldbearer', 'bomber', 'spearman', 'caster', 'soldier']) assert.ok(s5.includes(k), `第 5 波有 ${k}`);
});

// ---------- 确定性 ----------

test('确定性：新敌人都在场时，同一种子 + 同一串输入 → 完全相同的状态', () => {
  const play = (seed: number) => {
    const w = createWorld(seed);
    w.wave = 5;
    w.waveLen = waveDuration(5);
    const p = w.players[0];
    p.hp = p.stats.maxHp = 400;
    // 开场就放一只打不死的自爆鬼在旁边，保证这一局里各种出手都出现过
    const b = spawnEnemy(w, 'bomber', p.x + 40, p.y, []);
    b.hp = b.maxHp = 1e5;
    const evs: SimEvent[] = [];
    for (let i = 0; i < 60 * 40; i++) {
      const cmds = w.phase === 'shop' ? botShop(w, 0) : [];
      // 前 3 秒站着不动（让自爆鬼贴上来），之后交给机器人（botInput 里已经叠上了 botEnemyDodge）
      evs.push(...step(w, [i < 180 ? idle : botInput(w, 0)], cmds));
    }
    return { w, evs };
  };
  const a = play(77);
  const b = play(77);
  assert.equal(digest(a.w), digest(b.w));
  assert.equal(a.evs.length, b.evs.length);
  const c = play(78);
  // 各种出手都出现过（两个种子合起来看：哪一局里正好有没有分魂鬼被打死，跟着别的规则改动会变——宠物算一件以后 77 这一局就没打死分魂鬼）
  for (const t of ['foeWindup', 'foeStrike', 'foeFuse', 'foeSplit']) assert.ok([...a.evs, ...c.evs].some((e) => e.t === t), `跑出了 ${t}`);
  assert.notEqual(digest(a.w), digest(c.w));

});

test('机器人躲招：站在刺击线、冲锋线上往两侧让；在自爆鬼炸开范围里往外跑；预警刚亮时还没「看见」', () => {
  const { w, p } = arena(12);
  // 长矛兵在右边、朝左刺：人物站在线上偏下一点 → 往下（+y）让
  const s = put(w, 'spearman', p.x + 30, p.y - 1);
  s.cd = 0;
  run(w, 0.5, () => idle, (x) => x.some((y) => y.t === 'foeWindup'));
  assert.equal(s.act, 'windup');
  p.y += 3; // 线是朝人物定下的；人物往下挪了一点，站在线的下半边
  const [, early] = botEnemyDodge(w, 0, 10);
  assert.equal(early, 0, '反应时间没到：还没看见');
  s.actT = (s.actLen ?? 0) - 0.3; // 预警亮了 0.3 秒
  const [dx, dy] = botEnemyDodge(w, 0, 0.18);
  assert.ok(dy > 0.05 && Math.abs(dx) < Math.abs(dy), `往线外（下方）让：${dx.toFixed(3)}, ${dy.toFixed(3)}`);
  // 自爆鬼点燃：往远离它的方向
  const { w: w2, p: p2 } = arena(13);
  const b = put(w2, 'bomber', p2.x + 60, p2.y);
  run(w2, 3, () => idle, (x) => x.some((y) => y.t === 'foeFuse'));
  b.actT = (b.actLen ?? 0) - 0.3;
  const [bx] = botEnemyDodge(w2, 0, 0.18);
  assert.ok(bx < -0.05, '往左跑开');
  // botInput 叠上了躲招：站在线上时朝线外走
  const inp = botInput(w, 0);
  assert.ok(inp.my > 0.3, `botInput 往线外走：my = ${inp.my.toFixed(2)}`);
});
