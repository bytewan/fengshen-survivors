// 雷震子（sim/heroes/leizhenzi.ts、sim/pets/leipeng.ts、heroes/passives.ts 里的生翅）的模拟测试：
// 起手按角色（凡品黄金棍、雷鹏、木行亲和）；黄金棍只在他本人的商店里刷；
// 黄金棍凡 → 神（凡一砸、掠过的挨轻的、正中的最重；灵品弹起再砸一处；仙品雷纹再炸；器灵奔雷连砸三处 / 碎岳一棍砸碎一片、首领更重）、射程守规矩；
// 风雷翅（腾空、连着俯冲三下、每一下砸到的晕、首领不晕、整趟无敌、不听移动输入、落地后照常走）；生翅（红沙上不减速、别的角色照样减速）；
// 雷鹏（不造成伤害、之字俯冲掠过：麻痹的一颤打断蓄力、时不时再颤、出手慢；首领只减速；掣电 / 霹雳；不离主人太远）；
// 存档恢复后接着跑逐帧相同；同种子同输入完全确定。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, spawnEnemy, step, type PlayerInput, type SimEvent, type World } from './world.ts';
import { DT, REACH } from './config.ts';
import { COMMON_WEAPONS, HEROES, PET_BRANCH, WEAPONS, shopWeapons } from './catalog.ts';
import { hitEnemy } from './core.ts';
import { STAFF, WING } from './heroes/leizhenzi.ts';
import { skillInfo } from './heroes/index.ts';
import { groundFree } from './heroes/passives.ts';
import { LEIPENG, petKindOf } from './pet.ts';
import { numbed } from './pets/leipeng.ts';
import { petEvolveOffer, restock } from './shop.ts';
import { addPlayer } from './roster.ts';
import { botInput, botShop } from './bot.ts';
import { canonicalText, restore, snapshot } from './snapshot.ts';
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
/** 干净的测试场：普通波、刷怪关掉、人物无敌；宠物默认不出手、法宝默认出手（weapon: false 关掉）。 */
const arena = (opts: { tier?: number; spirit?: string | null; pet?: boolean; weapon?: boolean; hero?: HeroId } = {}) => {
  const w = createWorld(11, 1, [opts.hero ?? 'leizhenzi']);
  w.wave = 3;
  w.waveLen = 1e9;
  w.spawnAcc = -1e12;
  w.eliteDone = true;
  w.surgeDone = true;
  const p = w.players[0];
  p.weapons[0].tier = opts.tier ?? 1;
  p.weapons[0].spirit = opts.spirit ?? null;
  p.weapons[0].cd = opts.weapon === false ? 1e12 : 0;
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
const dmgTo = (ev: SimEvent[], id: number, by?: string) => evs(ev, 'hit').filter((h) => h.id === id && (!by || h.by === by)).reduce((a, h) => a + h.dmg, 0);

// ---------------------------------------------------------------- 角色表与起手

test('雷震子的起手：凡品黄金棍、雷鹏在身后高处、木行亲和 +10%、神通风雷翅、被动生翅；中途加入的也一样', () => {
  const w = createWorld(3, 1, ['leizhenzi']);
  const p = w.players[0];
  assert.equal(HEROES.leizhenzi.el, 'wood');
  assert.equal(WEAPONS.huangjin.exclusive, 'leizhenzi');
  assert.equal(WEAPONS.huangjin.el, 'wood');
  assert.deepEqual(p.weapons.map((x) => [x.kind, x.tier]), [['huangjin', 1]]);
  assert.equal(petKindOf(p), 'leipeng');
  assert.ok(Math.abs(p.stats.aff.wood - 0.1) < 1e-9 && p.stats.aff.fire === 0 && p.stats.aff.metal === 0);
  assert.ok(p.pet.x < p.x && (p.pet.z ?? 0) >= 20, '雷鹏在身后高处');
  assert.equal(HEROES.leizhenzi.skill, 'fenglei');
  assert.ok(skillInfo('fenglei').name === '风雷翅' && skillInfo('fenglei').desc.includes('俯冲'));
  assert.ok(HEROES.leizhenzi.passive?.name === '生翅');
  assert.ok(groundFree(p) && !groundFree(createWorld(3, 1, ['nezha']).players[0]));
  const w2 = createWorld(4, 1, ['nezha']);
  w2.phase = 'shop';
  const j = addPlayer(w2, 'leizhenzi', []);
  assert.ok(j);
  assert.equal(j.weapons[0].kind, 'huangjin');
  assert.equal(petKindOf(j), 'leipeng');
});

test('黄金棍只在雷震子的商店里刷，不在公共池里；雷鹏的两条路是掣电、霹雳', () => {
  assert.ok(!COMMON_WEAPONS.includes('huangjin') && !shopWeapons().includes('huangjin'));
  const seen = (hero: HeroId) => {
    const w = createWorld(7, 1, [hero]);
    w.phase = 'shop';
    const p = w.players[0];
    p.stats.luck = 0;
    let n = 0;
    for (let i = 0; i < 200; i++) {
      restock(w, p);
      n += p.shop.filter((o) => o && (o.cat === 'weapon' || o.cat === 'spirit') && o.kind === 'huangjin').length;
    }
    return n;
  };
  assert.equal(seen('nezha'), 0);
  assert.ok(seen('leizhenzi') > 0, '他自己的商店里刷得到');
  const w = createWorld(5, 1, ['leizhenzi']);
  const p = w.players[0];
  p.level = 5;
  const offer = petEvolveOffer(p);
  assert.deepEqual(offer, ['flash', 'clap']);
  assert.ok(PET_BRANCH.flash.name === '掣电' && PET_BRANCH.clap.name === '霹雳');
});

// ---------------------------------------------------------------- 黄金棍

test('黄金棍凡品：飞出去掠过路上的敌人（挨轻的），砸在最密处（正中最重）、晕一下、震开；棍子在外面时不出下一棍', () => {
  const { w, p } = arena();
  const x0 = p.x;
  const y0 = p.y;
  const path = enemy(w, 'soldier', x0 + 40, y0); // 路上
  const core = enemy(w, 'soldier', x0 + 90, y0); // 最密的那一群
  const side = enemy(w, 'soldier', x0 + 90, y0 + 14);
  const side2 = enemy(w, 'soldier', x0 + 96, y0 - 10);
  const ev = run(w, 0.05);
  assert.equal(evs(ev, 'staff').length, 1, '飞出去一棍');
  assert.equal(w.pending.filter((q) => q.kind === 'staff').length, 2, '一个掠过、一个砸下');
  const ev2 = run(w, STAFF.fly + 0.1);
  const got = hitIds(ev2, 'cudgel');
  assert.ok(got.has(path.id), '路上的挨了一下');
  assert.ok(got.has(core.id) && got.has(side.id) && got.has(side2.id), '落点一圈都挨砸');
  const target = evs(ev, 'staff')[0];
  // 瞄的就是那一群里的一只：它吃正中的倍数，比掠过的那一下重得多
  const hitCore = [core, side, side2].map((e) => dmgTo(ev2, e.id)).sort((a, b) => b - a);
  assert.ok(hitCore[0] > dmgTo(ev2, path.id) * 3, `正中（${hitCore[0]}）比掠过（${dmgTo(ev2, path.id)}）重得多`);
  assert.ok(core.stun > 0 && side.stun > 0, '砸中的晕一下');
  assert.ok(Math.hypot(target.x - p.x, target.y - p.y) <= REACH.seek + 1);
  // 出手冷却：同一棍砸完之前不出第二棍
  assert.equal(evs(ev2, 'staff').length, 0);
});

test('黄金棍灵品：砸完弹起、再砸一处（第二处轻一些）；离人物不超过 REACH.max', () => {
  const { w, p } = arena({ tier: 2 });
  const a = [enemy(w, 'soldier', p.x + 70, p.y), enemy(w, 'soldier', p.x + 74, p.y + 10), enemy(w, 'soldier', p.x + 66, p.y - 8)];
  const b = [enemy(w, 'soldier', p.x + 70, p.y + 56), enemy(w, 'soldier', p.x + 76, p.y + 50)];
  const ev = run(w, STAFF.fly + STAFF.hop + 0.2);
  const staffs = evs(ev, 'staff');
  assert.equal(staffs.length, 2, '两砸');
  assert.deepEqual(staffs.map((s) => s.seq), [1, 2]);
  assert.ok(staffs[1].x0 === staffs[0].x || Math.hypot(staffs[1].x0 - staffs[0].x, staffs[1].y0 - staffs[0].y) < 20, '第二砸从第一砸的落点弹起');
  const got = hitIds(ev, 'cudgel');
  for (const e of [...a, ...b]) assert.ok(got.has(e.id), `${e.id} 挨砸`);
  for (const s of staffs) assert.ok(Math.hypot(s.x - p.x, s.y - p.y) <= REACH.max + 1);
});

test('黄金棍仙品「雷纹」：落处留一圈雷纹（warn），片刻后再炸一下', () => {
  const { w, p } = arena({ tier: 3 });
  const e = enemy(w, 'soldier', p.x + 80, p.y);
  const ev = run(w, STAFF.fly + 0.05);
  const warn = evs(ev, 'warn').filter((x) => x.kind === 'staff');
  assert.equal(warn.length, 1, '留下一圈雷纹');
  const before = dmgTo(ev, e.id);
  const ev2 = run(w, STAFF.sigil.delay + 0.05);
  assert.ok(evs(ev2, 'land').some((l) => l.kind === 'staff' && l.quake), '雷纹炸开');
  assert.ok(dmgTo(ev2, e.id, 'cudgel') > 0 && before > 0, '再挨一下');
});

test('黄金棍器灵：奔雷一棍连砸三处；碎岳一棍砸碎一大片、砸首领更重、首领不晕', () => {
  {
    const { w, p } = arena({ tier: 4, spirit: 'benlei' });
    for (const [dx, dy] of [
      [60, 0],
      [60, 60],
      [0, 70],
      [-60, 40],
    ])
      for (let k = 0; k < 2; k++) enemy(w, 'soldier', p.x + dx + k * 6, p.y + dy + k * 5);
    const ev = run(w, STAFF.fly + STAFF.hop * 2 + 0.3);
    assert.deepEqual(evs(ev, 'staff').map((s) => s.seq), [1, 2, 3], '连砸三处');
  }
  const small = (() => {
    const { w, p } = arena({ tier: 4, spirit: null });
    const near = enemy(w, 'soldier', p.x + 80, p.y);
    const far = enemy(w, 'soldier', p.x + 80 + STAFF.r[4] + 12, p.y);
    const ev = run(w, STAFF.fly + 0.1);
    return { near: hitIds(ev, 'cudgel').has(near.id), far: hitIds(ev, 'cudgel').has(far.id) };
  })();
  const big = (() => {
    const { w, p } = arena({ tier: 4, spirit: 'suiyue' });
    const near = enemy(w, 'soldier', p.x + 80, p.y);
    const far = enemy(w, 'soldier', p.x + 80 + STAFF.r[4] + 12, p.y);
    const ev: SimEvent[] = [];
    let stun = 0;
    for (let i = 0; i < Math.round((STAFF.fly + 0.1) / DT); i++) {
      const e = step(w, [idle]);
      ev.push(...e);
      if (e.some((x) => x.t === 'land' && x.kind === 'staff' && !x.quake)) stun = Math.max(near.stun, far.stun);
    }
    return { near: hitIds(ev, 'cudgel').has(near.id), far: hitIds(ev, 'cudgel').has(far.id), stun };
  })();
  assert.ok(small.near && !small.far, '平常的砸不到外圈');
  assert.ok(big.near && big.far && big.stun >= STAFF.suiyue.stun - 0.1, '碎岳砸得到外圈、晕得久');
  // 首领：吃碎岳的倍数，不晕
  const { w, p } = arena({ tier: 4, spirit: 'suiyue' });
  w.wave = 6;
  const boss = enemy(w, 'boss', p.x + 80, p.y, 1e7);
  boss.invuln = 0;
  const ev = run(w, STAFF.fly + 0.1);
  assert.ok(dmgTo(ev, boss.id, 'cudgel') > 0, '砸到首领');
  assert.equal(boss.stun, 0, '首领不晕');
});

// ---------------------------------------------------------------- 神通「风雷翅」

test('风雷翅：腾空、连着俯冲三下（每一下砸到的晕、往外掀），整趟无敌、不听移动输入，落地后照常走', () => {
  const { w, p } = arena({ weapon: false });
  p.iframes = 0;
  const groups = [
    [p.x + 70, p.y],
    [p.x + 70, p.y + 70],
    [p.x - 10, p.y + 80],
  ];
  const foes = groups.flatMap(([x, y]) => [enemy(w, 'soldier', x, y), enemy(w, 'soldier', x + 6, y + 6)]);
  p.skill = 1;
  const x0 = p.x;
  const ev = run(w, 0.05, () => ({ mx: -1, my: 0, skill: true }));
  assert.ok(p.wing, '飞起来了');
  assert.ok(evs(ev, 'skill').some((s) => s.kind === 'fenglei'));
  // 飞的时候往左推摇杆：不听；敌人贴身也打不到他
  const contact = enemy(w, 'soldier', p.x, p.y);
  contact.speed = 0;
  const hp0 = p.hp;
  const ev2: SimEvent[] = [];
  let at: [number, number] = [p.x, p.y];
  for (let i = 0; i < 300 && p.wing; i++) {
    ev2.push(...step(w, [{ mx: -1, my: 0, skill: false }]));
    if (p.wing) at = [p.x, p.y];
  }
  assert.equal(p.hp, hp0, '整趟无敌');
  assert.equal(evs(ev2, 'dive').length, 3, '俯冲三下');
  const slams = evs(ev2, 'wingSlam');
  assert.equal(slams.length, 3, '砸三下');
  const last = slams[slams.length - 1];
  assert.ok(Math.hypot(at[0] - last.x, at[1] - last.y) < 1, '落地前停在最后一下砸的地方（没跟着摇杆往左走）');
  assert.ok(evs(ev2, 'dive')[0].x1 > x0 + 30, '第一下扑向右边那一群');
  const hit = new Set(slams.flatMap((s) => s.ids));
  assert.ok(foes.filter((e) => hit.has(e.id)).length >= 5, `三群都砸到了（${foes.filter((e) => hit.has(e.id)).length} / 6）`);
  assert.ok(foes.some((e) => e.stun > 0), '砸到的晕一下');
  const total = WING.rise + WING.dives * WING.dive[1] + (WING.dives - 1) * WING.up + WING.land;
  assert.ok(p.iframes > 0 && w.time < total + WING.grace + 0.2, '落地后还有一小会儿无敌');
  // 落地：之后照常走
  assert.ok(!p.wing, '落地');
  const xs = p.x;
  run(w, 0.5, () => ({ mx: -1, my: 0, skill: false }));
  assert.ok(p.x < xs - 20, '落地后照常走');
});

test('风雷翅：身边没敌人也照样飞三下（朝面前飞一小段），不飞出仙台；首领不晕', () => {
  const { w, p } = arena({ weapon: false });
  p.x = p.px = 30;
  p.facing = -1;
  p.skill = 1;
  run(w, 0.05, () => ({ mx: 0, my: 0, skill: true }));
  const ev = run(w, 2);
  assert.equal(evs(ev, 'wingSlam').length, 3);
  assert.ok(p.x >= 0, '不飞进魔气');
  const a = arena({ weapon: false });
  a.w.wave = 6;
  const boss = enemy(a.w, 'boss', a.p.x + 60, a.p.y, 1e7);
  boss.invuln = 0;
  a.p.skill = 1;
  const ev2 = run(a.w, 2, () => ({ mx: 0, my: 0, skill: true }));
  assert.ok(evs(ev2, 'wingSlam').some((s) => s.ids.includes(boss.id)), '先砸首领');
  assert.equal(boss.stun, 0, '首领不晕');
});

// ---------------------------------------------------------------- 被动「生翅」

test('生翅：红沙上走路不减速（别的角色照样减速）', () => {
  const dist = (hero: HeroId) => {
    const { w, p } = arena({ hero, weapon: false });
    w.patches.push({ id: w.nextId++, kind: 'sand', x: p.x + 20, y: p.y, r: 60, t: 0, life: 99 });
    const x0 = p.x;
    run(w, 0.5, () => ({ mx: 1, my: 0, skill: false }));
    return p.x - x0;
  };
  const free = (() => {
    const { w, p } = arena({ hero: 'leizhenzi', weapon: false });
    const x0 = p.x;
    run(w, 0.5, () => ({ mx: 1, my: 0, skill: false }));
    return p.x - x0;
  })();
  assert.ok(Math.abs(dist('leizhenzi') - free) < 1e-6, '雷震子在红沙上和平地一样快');
  assert.ok(dist('nezha') < free * 0.8, '哪吒踩红沙变慢');
});

// ---------------------------------------------------------------- 雷鹏「麻痹」

test('雷鹏：不造成伤害；拔高之后之字俯冲掠过敌群，沾上的麻痹：一颤打断蓄力、时不时再颤、出手慢；不离主人太远', () => {
  const { w, p } = arena({ pet: true, weapon: false });
  p.pet.cd = 0;
  const foes = [enemy(w, 'spearman', p.x + 60, p.y), enemy(w, 'soldier', p.x + 64, p.y + 8), enemy(w, 'soldier', p.x + 56, p.y - 8)];
  foes[0].act = 'windup';
  foes[0].actT = 0.8;
  foes[0].actLen = 0.8;
  let maxD = 0;
  const ev: SimEvent[] = [];
  for (let i = 0; i < Math.round(1.6 / DT); i++) {
    ev.push(...step(w, [idle]));
    maxD = Math.max(maxD, Math.hypot(p.pet.x - p.x, p.pet.y - p.y));
  }
  assert.ok(evs(ev, 'stoop').length >= 1, '俯冲了');
  const zaps = evs(ev, 'zap');
  const got = new Set(zaps.flatMap((z) => z.ids));
  assert.ok(foes.every((e) => got.has(e.id)), '三只都麻到了');
  assert.equal(evs(ev, 'hit').length, 0, '不造成伤害');
  assert.ok(foes.every((e) => numbed(w, e)), '身上带电');
  assert.notEqual(foes[0].act, 'windup', '蓄力被打断');
  assert.ok(maxD <= LEIPENG.leash + 1, `不离主人太远（${maxD.toFixed(1)}）`);
  // 时不时再颤：麻着的这几秒里每只至少颤两下
  const ev2 = run(w, 2);
  const tw = evs(ev2, 'twitch');
  for (const e of foes) assert.ok(tw.filter((t) => t.id === e.id).length >= 2, `${e.id} 又颤了`);
  // 出手慢：冷却按 1 − atk 的速度走
  const e = foes[1];
  e.cd = 1;
  e.numbUntil = w.time + 10;
  e.stun = 0;
  const cd0 = e.cd;
  run(w, 0.1);
  assert.ok(cd0 - e.cd < 0.1 * (1 - LEIPENG.atk) + 0.02, '冷却走得慢');
});

test('雷鹏：首领不颤、不慢出手，只走得慢一点；掣电每趟多麻两只、沾上那一下定得更久；霹雳木行更疼、一颤把电传给身边的', () => {
  {
    const { w, p } = arena({ pet: true, weapon: false });
    w.wave = 6;
    p.pet.cd = 0;
    const boss = enemy(w, 'boss', p.x + 60, p.y, 1e7);
    boss.invuln = 0;
    const ev = run(w, 3);
    assert.ok(evs(ev, 'zap').some((z) => z.ids.includes(boss.id)), '首领也沾得上');
    assert.equal(boss.stun, 0, '首领不颤');
    assert.ok(boss.slow > 0, '首领走得慢一点');
    assert.ok(!evs(ev, 'twitch').some((t) => t.id === boss.id));
  }
  {
    const { w, p } = arena({ pet: true, weapon: false });
    p.pet.stage = 1;
    p.pet.branch = 'flash';
    p.pet.cd = 0;
    const foes = Array.from({ length: 9 }, (_, i) => enemy(w, 'soldier', p.x + 56 + (i % 3) * 6, p.y - 6 + Math.floor(i / 3) * 6));
    const ev = run(w, 1.6);
    const n = new Set(evs(ev, 'zap').flatMap((z) => z.ids)).size;
    assert.ok(n > LEIPENG.targets[1], `一趟多麻两只（${n}）`);
    assert.ok(foes.some((e) => e.stun > LEIPENG.jolt - 0.05) || n > 0);
  }
  {
    const { w, p } = arena({ pet: true, weapon: false });
    p.pet.stage = 1;
    p.pet.branch = 'clap';
    p.pet.cd = 0;
    const a = enemy(w, 'soldier', p.x + 60, p.y);
    const ev = run(w, 1.6);
    assert.ok(evs(ev, 'zap').some((z) => z.ids.includes(a.id)));
    // 木行更疼
    const b = enemy(w, 'soldier', p.x + 200, p.y + 100);
    const hurt = (e: typeof a) => {
      const ev3: SimEvent[] = [];
      hitEnemy(w, e, { dmg: 100, by: 'cudgel', owner: 0, from: p, el: 'wood', canCrit: false }, ev3);
      return evs(ev3, 'hit')[0].dmg;
    };
    a.mark = null;
    b.mark = null;
    assert.ok(hurt(a) > hurt(b), '麻着的挨木行更疼');
    // 一颤把电传给身边一只没麻的
    const c = enemy(w, 'soldier', a.x + 12, a.y);
    p.pet.cd = 1e12;
    const ev2 = run(w, 1.5);
    assert.ok(evs(ev2, 'twitch').some((t) => t.id === a.id && t.to === c.id), '电传过去了');
    assert.ok(numbed(w, c));
  }
});

// ---------------------------------------------------------------- 存档与确定性

test('飞到一半、棍子在外面、雷鹏俯冲到一半存档：恢复后接着跑逐帧相同；同种子同输入完全确定', () => {
  const play = () => {
    const w = createWorld(21, 1, ['leizhenzi']);
    const out: string[] = [];
    for (let i = 0; i < 60 * 40; i++) {
      if (w.phase === 'shop') {
        botShop(w, 0);
        continue;
      }
      const inp = botInput(w, 0);
      step(w, [inp]);
      if (i % 300 === 0) out.push(canonicalText(w).slice(0, 2000));
    }
    return { w, out };
  };
  const a = play();
  const b = play();
  assert.deepEqual(a.out, b.out, '同种子同输入完全确定');
  // 存档：放风雷翅的那一刻、棍子在外面、雷鹏在俯冲
  const { w, p } = arena({ pet: true });
  p.pet.cd = 0;
  for (let i = 0; i < 6; i++) enemy(w, 'soldier', p.x + 60 + i * 5, p.y + (i % 2) * 8);
  p.skill = 1;
  run(w, 0.3, () => ({ mx: 0, my: 0, skill: true }));
  assert.ok(p.wing && w.pending.some((q) => q.kind === 'staff'), '飞着、棍子在外面');
  const r = restore(JSON.parse(JSON.stringify(snapshot(w))));
  assert.equal(canonicalText(r), canonicalText(w));
  for (let i = 0; i < 120; i++) {
    step(w, [idle]);
    step(r, [idle]);
  }
  assert.equal(canonicalText(r), canonicalText(w), '恢复后逐帧相同');
});
