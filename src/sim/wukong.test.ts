// 孙悟空（sim/heroes/wukong.ts、sim/pets/maohou.ts、heroes/passives.ts 里的火眼金睛与戏弄）的模拟测试：
// 起手按角色（凡品金箍棒、毫毛猴、木行亲和）；隐藏角色没解锁不会被换到身上；不给他出同名的功法「法天象地」；
// 金箍棒凡 → 神（横扫一圈接竖劈、灵品更长、仙品「定海」石刺、器灵擎天 / 搅海）；
// 法天象地（长足一踏、棒子扫得更远打得更重、不吃吹开、到点变回、不带进下一波）；火眼金睛（打精英、首领 +15%，别人不加）；
// 毫毛猴（不造成伤害、吹出小猴分身掠过敌群就散、戏弄：出手变慢、走路乱晃、首领不吃；定身法 / 瞌睡虫）；
// 标题页的裂缝只在通关之后出现；同种子同输入完全确定、存档恢复后接着跑逐帧相同。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, digest, spawnEnemy, step, type PlayerInput, type SimEvent, type World } from './world.ts';
import { DT, REACH } from './config.ts';
import { COMMON_WEAPONS, HEROES, HIDDEN, HUOYAN, PET_BRANCH, WEAPONS, shopWeapons } from './catalog.ts';
import { FAXIANG, JINGU } from './heroes/wukong.ts';
import { hitEnemy } from './core.ts';
import { HERO_IDS, OPEN_IDS, allowedHeroes, pickFreeHero, skillInfo } from './heroes/index.ts';
import { faxiangOn, teaseVel, teased } from './heroes/passives.ts';
import { MAOHOU, petKindOf } from './pet.ts';
import { petEvolveOffer } from './shop.ts';
import { offerTechnique } from './techniques.ts';
import { addPlayer } from './roster.ts';
import { botInput, botShop } from './bot.ts';
import { canonicalText, restore, snapshot } from './snapshot.ts';
import { riftDue, WUKONG_UNLOCK, defaultProfile } from '../game/profile.ts';
import type { EnemyKindName, HeroId } from './types.ts';

const idle: PlayerInput = { mx: 0, my: 0, skill: false };
type Ev<T extends SimEvent['t']> = Extract<SimEvent, { t: T }>;
const evs = <T extends SimEvent['t']>(ev: SimEvent[], t: T) => ev.filter((e): e is Ev<T> => e.t === t);
const run = (w: World, seconds: number, input: (w: World) => PlayerInput = () => idle) => {
  const events: SimEvent[] = [];
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) events.push(...step(w, [input(w)]));
  return events;
};
/** 干净的测试场：普通波、刷怪关掉、人物无敌、不暴击；宠物默认不出手。 */
const arena = (opts: { tier?: number; spirit?: string | null; pet?: boolean; hero?: HeroId } = {}) => {
  const w = createWorld(11, 1, [opts.hero ?? 'wukong']);
  w.wave = 3;
  w.waveLen = 1e9;
  w.spawnAcc = -1e12;
  w.eliteDone = true;
  w.surgeDone = true;
  const p = w.players[0];
  p.weapons[0].tier = opts.tier ?? 1;
  p.weapons[0].spirit = opts.spirit ?? null;
  p.weapons[0].cd = 0;
  if (!opts.pet) p.pet.cd = 1e12;
  p.iframes = 1e12;
  p.stats.crit = 0;
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
const hitIds = (ev: SimEvent[], by: string) => new Set(evs(ev, 'hit').filter((h) => h.by === by).map((h) => h.id));

// ---------------------------------------------------------------- 角色表与起手

test('孙悟空的起手：凡品金箍棒、毫毛猴蹲在身后、金行亲和 +10%、神通法天象地、被动火眼金睛；中途加入的也一样', () => {
  const w = createWorld(3, 1, ['wukong']);
  const p = w.players[0];
  assert.equal(HEROES.wukong.el, 'metal'); // 用户 11-12：金箍棒是金
  assert.equal(WEAPONS.jingu.exclusive, 'wukong');
  assert.equal(WEAPONS.jingu.el, 'metal');
  assert.deepEqual(p.weapons.map((x) => [x.kind, x.tier]), [['jingu', 1]]);
  assert.equal(petKindOf(p), 'maohou');
  assert.ok(Math.abs(p.stats.aff.metal - 0.1) < 1e-9 && p.stats.aff.wood === 0);
  assert.ok(p.pet.x < p.x && Math.abs(p.pet.y - p.y) < 8, '毫毛猴在身后脚边');
  assert.equal(HEROES.wukong.skill, 'faxiang');
  assert.equal(skillInfo('faxiang').name, '法天象地');
  assert.equal(HEROES.wukong.passive?.name, '火眼金睛');
  assert.ok(!COMMON_WEAPONS.includes('jingu') && !shopWeapons().includes('jingu'), '金箍棒不进公共商店');
  const w2 = createWorld(4, 1, ['nezha']);
  w2.phase = 'shop';
  const j = addPlayer(w2, 'wukong', []);
  assert.ok(j);
  assert.equal(j.weapons[0].kind, 'jingu');
  assert.equal(petKindOf(j), 'maohou');
  w.players[0].level = 5;
  assert.deepEqual(petEvolveOffer(w.players[0]), ['hold', 'drowse']);
  assert.ok(PET_BRANCH.hold.name === '定身法' && PET_BRANCH.drowse.name === '瞌睡虫');
});

test('隐藏角色：解锁 id 和存档里的同一个；换角色时（重复了、人比角色多）不会被换成谁都没解锁的孙悟空；不给他出同名的功法', () => {
  assert.equal(HIDDEN.wukong?.unlock, WUKONG_UNLOCK);
  assert.ok(HERO_IDS.includes('wukong') && !OPEN_IDS.includes('wukong'));
  const base = OPEN_IDS.filter((h) => h !== 'nezha');
  assert.notEqual(pickFreeHero([...OPEN_IDS], 'nezha'), 'wukong', '一开始就能选的都被选了：照旧给想要的，不塞孙悟空');
  assert.equal(pickFreeHero(['nezha'], 'nezha'), base[0]);
  assert.equal(pickFreeHero(['nezha', 'wukong'], 'wukong', [...OPEN_IDS, 'wukong']), 'yangjian', '房主解锁了才在这一房里换得到');
  // 和回响化身同一套判断（allowedHeroes）：房主的解锁里有他的 id 才能选；选了房主没解锁的他，换成能选的
  assert.ok(!allowedHeroes([]).includes('wukong') && !allowedHeroes(['demon-nezha', 'echo-zhao', 'echo-yunxiao']).includes('wukong'));
  assert.ok(allowedHeroes([WUKONG_UNLOCK]).includes('wukong'));
  assert.equal(pickFreeHero([], 'wukong', allowedHeroes([])), 'nezha');
  assert.equal(pickFreeHero([], 'wukong', allowedHeroes([WUKONG_UNLOCK])), 'wukong');
  // 功法：孙悟空的神通就叫法天象地，三选一里不出同名的那门；哪吒照旧出
  const offers = (hero: HeroId) => {
    const w = createWorld(21, 1, [hero]);
    const p = w.players[0];
    p.level = 20;
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      p.techs = [];
      p.techOffer = null;
      offerTechnique(w, p);
      for (const t of p.techOffer ?? []) seen.add(t);
    }
    return seen;
  };
  assert.ok(!offers('wukong').has('fatian'));
  assert.ok(offers('nezha').has('fatian'));
});

// ---------------------------------------------------------------- 金箍棒

test('金箍棒凡品：横扫一圈（身前身后贴身的都挨、往外震开），约 0.26 秒后朝敌人最多的方向竖劈一棒（线上的挨一下、顿一顿）；够不着就不出手', () => {
  const { w, p } = arena();
  const front = enemy(w, 'soldier', p.x + 24, p.y - 4);
  const back = enemy(w, 'soldier', p.x - 22, p.y + 2);
  const line = [enemy(w, 'soldier', p.x + 78, p.y), enemy(w, 'soldier', p.x + 90, p.y + 2)];
  const ev = run(w, 0.1);
  const sw = evs(ev, 'staffSweep');
  assert.equal(sw.length, 1);
  assert.equal(sw[0].spin, 1);
  assert.ok(Math.abs(sw[0].r - JINGU.sweep.r[1]) < 1e-6, '凡品的半径');
  const swept = hitIds(ev, 'staff');
  assert.ok(swept.has(front.id) && swept.has(back.id), '一整圈：身后的也挨');
  assert.ok(!line.some((e) => swept.has(e.id)), '远的扫不到');
  const ev2 = run(w, 0.3);
  const sm = evs(ev2, 'staffSmash');
  assert.equal(sm.length, 1, '接一记竖劈');
  assert.ok(sm[0].x1 > p.x + 40 && Math.abs(sm[0].y1 - p.y) < 20, '朝敌人最多的那边劈');
  const smashed = hitIds(ev2, 'staff');
  for (const e of line) assert.ok(smashed.has(e.id), '线上的都挨');
  assert.ok(line.every((e) => e.stun > 0), '顿一顿');
  assert.equal(evs([...ev, ...ev2], 'warn').filter((x) => x.kind === 'rock').length, 0, '凡品没有石刺');
  // 够不着：只有索敌半径外的
  const far = arena();
  enemy(far.w, 'soldier', far.p.x + REACH.seek + 12, far.p.y);
  assert.equal(evs(run(far.w, 0.6), 'staffSweep').length, 0);
});

test('金箍棒升阶：灵品棒子更长（扫得更远、劈得更远）；仙品「定海」竖劈落地震出一圈石刺（先 warn，再 land，扎到的挨一下、顿一顿，首领不顿）', () => {
  assert.ok(JINGU.sweep.r[2] > JINGU.sweep.r[1] && JINGU.smash.len[2] > JINGU.smash.len[1]);
  const lens = [1, 2].map((tier) => {
    const { w, p } = arena({ tier });
    enemy(w, 'soldier', p.x + 30, p.y);
    const ev = run(w, 0.5);
    const sm = evs(ev, 'staffSmash')[0];
    return [evs(ev, 'staffSweep')[0].r, Math.hypot(sm.x1 - p.x, sm.y1 - p.y)];
  });
  assert.ok(lens[1][0] > lens[0][0] && lens[1][1] > lens[0][1], '灵品扫得更远、劈得更远');
  const { w, p } = arena({ tier: 3 });
  // 两只都站在竖劈的落点（劈的长度那么远）那一圈石刺里：位置按 JINGU 的数算（2026-11-11 数值平衡把劈的长度、石刺的半径改过，原来写死在 92 / 84）
  const tip = JINGU.smash.len[3];
  const boss = enemy(w, 'boss', p.x + tip - 18, p.y + 2, 99999);
  const near = enemy(w, 'soldier', p.x + tip - 24, p.y - 8);
  const ev = run(w, 0.33);
  const warn = evs(ev, 'warn').filter((x) => x.kind === 'rock');
  assert.equal(warn.length, 1, '仙品：落点一圈石刺');
  assert.ok(Math.hypot(warn[0].x - p.x, warn[0].y - p.y) <= REACH.seek + 1e-6, '落点在索敌半径里');
  const ev2 = run(w, 0.4);
  assert.equal(evs(ev2, 'land').filter((x) => x.kind === 'rock').length, 1);
  const rocked = hitIds(ev2, 'rock');
  assert.ok(rocked.has(near.id) && rocked.has(boss.id), '石刺扎到落点一圈的');
  assert.ok(near.stun > 0 && boss.stun <= 0, '小兵顿一顿，首领不吃控制');
});

test('金箍棒神品：「擎天」劈得又远又重，一路从近到远震出几簇石刺；「搅海」横扫连转三圈、把身边的往里卷，再接竖劈', () => {
  const a = arena({ tier: 4, spirit: 'qingtian' });
  enemy(a.w, 'soldier', a.p.x + 50, a.p.y);
  enemy(a.w, 'soldier', a.p.x + 100, a.p.y + 4);
  const ev = run(a.w, 0.5);
  const sm = evs(ev, 'staffSmash');
  assert.equal(sm.length, 1);
  assert.equal(sm[0].spirit, 'qingtian');
  assert.ok(Math.hypot(sm[0].x1 - a.p.x, sm[0].y1 - a.p.y) > JINGU.smash.len[4], '擎天劈得比神品平常远');
  assert.ok(Math.hypot(sm[0].x1 - a.p.x, sm[0].y1 - a.p.y) <= REACH.max + 1e-6, '照样不出效果最远');
  const rocks = evs(ev, 'warn').filter((x) => x.kind === 'rock');
  assert.equal(rocks.length, JINGU.pillar.rocks);
  const d = rocks.map((r) => Math.hypot(r.x - a.p.x, r.y - a.p.y));
  assert.ok(d.every((v, i) => i === 0 || v >= d[i - 1] - 1e-6), '从近到远');
  assert.ok(rocks.every((r, i) => i === 0 || r.t2 > rocks[i - 1].t2), '一簇接一簇');
  // 搅海
  const b = arena({ tier: 4, spirit: 'jiaohai' });
  const ring = [enemy(b.w, 'soldier', b.p.x + 40, b.p.y), enemy(b.w, 'soldier', b.p.x - 38, b.p.y + 6)];
  const d0 = ring.map((e) => Math.hypot(e.x - b.p.x, e.y - b.p.y));
  const evb = run(b.w, 0.9);
  const spins = evs(evb, 'staffSweep');
  assert.deepEqual(spins.map((s) => s.spin), [1, 2, 3], '连转三圈');
  assert.equal(evs(evb, 'staffSmash').length, 1, '再接竖劈');
  const d1 = ring.map((e) => Math.hypot(e.x - b.p.x, e.y - b.p.y));
  assert.ok(d1.some((v, i) => v < d0[i] - 1), '往里卷');
});

// ---------------------------------------------------------------- 法天象地

test('法天象地：身形长大、长足那一下脚下一震（震开身边的、首领不晕）；这几秒棒子扫得更远打得更重、不吃吹开；到点变回原样，不带进下一波', () => {
  const { w, p } = arena();
  p.weapons[0].cd = 1e9; // 先只看神通
  const near = enemy(w, 'soldier', p.x + 30, p.y);
  const boss = enemy(w, 'boss', p.x - 34, p.y, 99999);
  p.skill = 1;
  const ev = run(w, 0.1, () => ({ mx: 0, my: 0, skill: true }));
  const sk = evs(ev, 'skill');
  assert.equal(sk.length, 1);
  assert.equal(sk[0].kind, 'faxiang');
  assert.ok(p.faxiang && faxiangOn(w, p));
  assert.equal(evs(ev, 'stomp').length, 0, '还在长');
  const ev2 = run(w, 0.4);
  const st = evs(ev2, 'stomp');
  assert.equal(st.length, 1, '长足那一下一震（只震一次）');
  assert.ok(st[0].ids.includes(near.id) && st[0].ids.includes(boss.id));
  assert.ok(near.stun > 0 && boss.stun <= 0);
  // 棒子：同一只敌人、同一个品阶，大身形时扫得更远、打得更重
  const swing = (big: boolean) => {
    const a = arena();
    if (big) a.p.faxiang = { t0: a.w.time, until: a.w.time + 5, stomped: true, wave: a.w.wave };
    const e = enemy(a.w, 'soldier', a.p.x + 20, a.p.y);
    const ev = run(a.w, 0.05);
    return { r: evs(ev, 'staffSweep')[0].r, big: evs(ev, 'staffSweep')[0].big, dmg: evs(ev, 'hit').find((h) => h.id === e.id)!.dmg };
  };
  const s0 = swing(false);
  const s1 = swing(true);
  assert.ok(s1.r > s0.r && s1.big && !s0.big, '扫得更远（画面上棒子画大）');
  assert.ok(s1.dmg > s0.dmg * (FAXIANG.dmg - 0.05), '打得更重');
  // 不吃风吼妖的吹开
  const x0 = p.x;
  p.blowX = 300;
  run(w, 0.2);
  assert.ok(Math.abs(p.x - x0) < 1e-6, '站得稳');
  // 到点变回来
  run(w, FAXIANG.dur);
  assert.ok(!p.faxiang && !faxiangOn(w, p));
  // 不带进下一波：上一波放的、下一波开头就收掉
  p.faxiang = { t0: w.time, until: w.time + 5, stomped: true, wave: w.wave - 1 };
  assert.ok(!faxiangOn(w, p));
  run(w, DT);
  assert.ok(!p.faxiang);
});

// ---------------------------------------------------------------- 火眼金睛

test('火眼金睛：孙悟空打精英、首领 +HUOYAN.elite（2026-11-11 起 +10%；同一下打小兵不加）；别的角色打精英不加', () => {
  const dmgOf = (hero: HeroId, kind: EnemyKindName) => {
    const { w, p } = arena({ hero });
    const e = enemy(w, kind, p.x + 40, p.y, 1e6);
    return hitEnemy(w, e, { dmg: 100, by: 'staff', owner: 0, from: p, canCrit: false }, []);
  };
  const base = dmgOf('wukong', 'soldier');
  assert.equal(dmgOf('wukong', 'elite'), Math.round(base * (1 + HUOYAN.elite)));
  assert.equal(dmgOf('wukong', 'boss'), Math.round(base * (1 + HUOYAN.elite)));
  assert.equal(dmgOf('nezha', 'elite'), dmgOf('nezha', 'soldier'));
});

// ---------------------------------------------------------------- 毫毛猴

test('毫毛猴：不造成伤害；吹出几只小猴分身掠过敌群就散（不停下、不离主人太远），被戏弄的出手变慢、走路乱晃、带土行印记；首领不吃戏弄只沾印记', () => {
  const { w, p } = arena({ pet: true });
  p.weapons = [];
  // 毫毛猴蹲在主人身后约 40 像素，出手范围以它为圆心 85（11-12 起）：身前那一群放在主人身前 34–40 像素
  const foes = [enemy(w, 'soldier', p.x + 34, p.y), enemy(w, 'soldier', p.x + 40, p.y + 8), enemy(w, 'caster', p.x - 52, p.y - 6), enemy(w, 'soldier', p.x - 46, p.y + 4)];
  const boss = enemy(w, 'boss', p.x + 30, p.y - 30, 99999);
  foes[2].cd = 5;
  const ev: SimEvent[] = [];
  let maxD = 0;
  let caught = -1;
  const marks: (string | null)[] = [];
  for (let i = 0; i < Math.round(4 / DT); i++) {
    const e1 = step(w, [idle]);
    ev.push(...e1);
    for (const imp of p.pet.imps ?? []) maxD = Math.max(maxD, Math.hypot(imp.x - p.x, imp.y - p.y));
    if (caught < 0 && teased(w, foes[2])) caught = i;
    for (const t of evs(e1, 'tease')) for (const id of t.ids) marks.push(w.enemies.find((x) => x.id === id)?.mark ?? null);
  }
  assert.equal(evs(ev, 'hit').length, 0, '宠物不打伤害');
  assert.ok(evs(ev, 'hair').length >= 1, '吹了毫毛');
  assert.ok(evs(ev, 'hair')[0].imps.length >= MAOHOU.n[0], '一次吹出几只');
  assert.ok(evs(ev, 'impEnd').length >= MAOHOU.n[0], '窜完就散');
  assert.ok(maxD <= MAOHOU.band.leash + 1e-6, '分身不离主人太远');
  const teasedIds = new Set(evs(ev, 'tease').flatMap((t) => t.ids));
  assert.ok(foes.filter((e) => teasedIds.has(e.id)).length >= 3, '掠过的那几群都被戏弄了');
  assert.ok(!teasedIds.has(boss.id) || (boss.teaseUntil ?? 0) <= 0, '首领不吃戏弄');
  assert.ok(boss.teaseUntil === undefined);
  assert.ok(marks.length > 0 && marks.every((m) => m === 'earth'), '被戏弄的那一刻带上土行印记（毫毛猴是土行宠物，用户 11-12）');
  // 出手变慢：被戏弄的那一会儿，术士的冷却按 1 − tease 的速度走
  assert.ok(caught >= 0, '术士被戏弄过');
  const w2 = arena().w;
  const c = enemy(w2, 'caster', 400, 400);
  c.cd = 3;
  c.teaseUntil = w2.time + 10;
  c.tease = MAOHOU.atk;
  c.teaseWalk = MAOHOU.walk;
  const p2 = w2.players[0];
  p2.pet.cd = 1e12;
  run(w2, 1);
  assert.ok(Math.abs(3 - c.cd - (1 - MAOHOU.atk)) < 0.05, `冷却走慢了：${(3 - c.cd).toFixed(3)}`);
  // 走路乱晃：同一个想走的速度，方向偏开、速度只剩几成
  const e = foes[0];
  e.teaseUntil = w.time + 5;
  e.teaseWalk = MAOHOU.walk;
  const vs = [0, 0.3, 0.6, 0.9].map((dt) => {
    w.time += dt;
    return teaseVel(w, e, 50, 0);
  });
  assert.ok(vs.every(([vx, vy]) => Math.abs(Math.hypot(vx, vy) - 50 * MAOHOU.walk) < 1e-6));
  assert.ok(new Set(vs.map(([, vy]) => Math.sign(Math.round(vy)))).size > 1, '左右乱摆');
});

test('毫毛猴进化：定身法——被戏弄的先定住片刻、一次多吹一只；瞌睡虫——出手、走路更慢，戏弄更久', () => {
  const tease = (branch: 'hold' | 'drowse' | null, stage: number) => {
    const { w, p } = arena({ pet: true });
    p.weapons = [];
    p.pet.branch = branch;
    p.pet.stage = stage;
    p.pet.cd = 0;
    const es = [enemy(w, 'soldier', p.x + 34, p.y), enemy(w, 'soldier', p.x + 38, p.y + 6), enemy(w, 'soldier', p.x - 50, p.y)];
    const ev: SimEvent[] = [];
    let maxStun = 0;
    for (let i = 0; i < Math.round(1.6 / DT); i++) {
      ev.push(...step(w, [idle]));
      for (const e of es) maxStun = Math.max(maxStun, e.stun);
    }
    const t = evs(ev, 'tease');
    const got = es.find((e) => t.some((x) => x.ids.includes(e.id)))!;
    return { n: evs(ev, 'hair')[0].imps.length, dur: t[0].dur, tease: got.tease!, walk: got.teaseWalk!, maxStun };
  };
  const base = tease(null, 0);
  const hold = tease('hold', 2);
  const drowse = tease('drowse', 2);
  assert.equal(hold.n, MAOHOU.n[2] + MAOHOU.hold.extra, '定身法多吹一只');
  assert.ok(hold.maxStun >= MAOHOU.hold.root[2] - DT && base.maxStun <= MAOHOU.flinch + 1e-6, '定身法先定住片刻');
  assert.ok(drowse.tease > base.tease && drowse.walk < base.walk && drowse.dur > tease(null, 2).dur, '瞌睡虫更慢、更久');
});

// ---------------------------------------------------------------- 标题页的裂缝（game/wukong-rift.ts 按它决定要不要下那一块）

test('标题页天上的金色裂缝：通关过一次（通关次数、最快通关、劫数进度任何一处）才出现，孙悟空解锁了就不再出现', () => {
  const fresh = defaultProfile();
  assert.equal(riftDue(fresh), false, '没通关过');
  assert.equal(riftDue({ ...fresh, best: { ...fresh.best, chapter: 3, wave: 6 } }), false, '打到第三章首领、没打赢也不算');
  assert.equal(riftDue({ ...fresh, stats: { ...fresh.stats, clears: 1 } }), true);
  assert.equal(riftDue({ ...fresh, best: { ...fresh.best, clearTime: 900 } }), true);
  assert.equal(riftDue({ ...fresh, jie: { cleared: 1, last: 1 } }), true);
  assert.equal(riftDue({ ...fresh, stats: { ...fresh.stats, clears: 2 }, unlocks: [WUKONG_UNLOCK] }), false, '解锁了就合上');
  assert.equal(riftDue({ ...fresh, stats: { ...fresh.stats, clears: 2 }, unlocks: ['demon-nezha'] }), true, '别的解锁不算');
});

// ---------------------------------------------------------------- 存档与确定性

test('孙悟空的一局：同种子同输入完全确定；中途存档恢复后接着跑逐帧相同（分身窜到一半、法天象地大着、石刺还没扎出来都存得下）', () => {
  const play = () => {
    const w = createWorld(77, 1, ['wukong']);
    const trace: string[] = [];
    for (let i = 0; i < 60 * 40 && w.phase !== 'over'; i++) {
      const cmds = w.phase === 'shop' ? botShop(w, 0) : [];
      step(w, [botInput(w, 0)], cmds);
      if (i % 30 === 0) trace.push(digest(w));
    }
    return { w, trace };
  };
  const a = play();
  const b = play();
  assert.deepEqual(a.trace, b.trace, '两遍跑出来一样');
  const w = createWorld(78, 1, ['wukong']);
  const p = w.players[0];
  p.weapons[0].tier = 3;
  for (let i = 0; i < 60 * 30 && !(w.phase === 'wave' && (p.pet.imps?.length ?? 0) > 0); i++) step(w, [botInput(w, 0)], w.phase === 'shop' ? botShop(w, 0) : []);
  assert.ok((p.pet.imps?.length ?? 0) > 0, '分身窜到一半');
  for (let i = 0; i < 8; i++) enemy(w, 'soldier', p.x + 26 + i * 6, p.y + (i % 3) * 6 - 6, 500);
  p.skill = 1;
  step(w, [{ mx: 0, my: 0, skill: true }]);
  assert.ok(p.faxiang, '法天象地大着');
  const text = JSON.stringify(snapshot(w));
  const r = restore(JSON.parse(text));
  assert.equal(canonicalText(r), canonicalText(w));
  for (let i = 0; i < 300; i++) {
    const ev1 = JSON.stringify(step(w, [botInput(w, 0)], w.phase === 'shop' ? botShop(w, 0) : []));
    const ev2 = JSON.stringify(step(r, [botInput(r, 0)], r.phase === 'shop' ? botShop(r, 0) : []));
    assert.equal(ev2, ev1, `第 ${i + 1} 帧跑岔了`);
  }
  assert.equal(canonicalText(r), canonicalText(w));
});
