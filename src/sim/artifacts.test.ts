// 剩下 8 件公共法宝（打神鞭、化血神刀、定风珠、青莲宝色旗、阴阳镜、玄元控水旗、五火七禽扇、捆仙绳）的模拟测试：
// 凡品能出手、灵品量变、仙品质变、神品两个器灵各自生效、首领不吃控制（定身 / 冻结 / 拉扯）、不碰敌人的弹道、
// 16 件都进商店（wip 机制留着给以后的新法宝）、同种子同输入完全确定。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, digest, spawnEnemy, step, type PlayerInput, type SimEvent, type World } from './world.ts';
import { DT } from './config.ts';
import { COMMON_WEAPONS, WEAPONS, WIP, shopWeapons } from './catalog.ts';
import { BLEED, HUAXUE, buildGrid, hitEnemy, hurtPlayer } from './core.ts';
import { TUNE } from './weapons.ts';
import { SCORCH, ZONE_FX } from './zones.ts';
import { restock } from './shop.ts';
import { botInput, botShop } from './bot.ts';
import type { Enemy, EnemyKindName, HitBy, WeaponKind, Zone } from './types.ts';

const NEW: WeaponKind[] = ['dashen', 'huaxue', 'dingfeng', 'qinglian', 'yinyang', 'xuanyuan', 'wuhuo', 'kunxian'];
const idle: PlayerInput = { mx: 0, my: 0, skill: false };
const run = (w: World, seconds: number, input: (w: World) => PlayerInput = () => idle) => {
  const events: SimEvent[] = [];
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) events.push(...step(w, [input(w)]));
  return events;
};
/** 干净的测试场：普通波、刷怪关掉、宠物不出手、人物无敌。 */
const arena = (seed: number, weapons: { kind: WeaponKind; tier: number; spirit?: string | null }[] = []) => {
  const w = createWorld(seed);
  w.wave = 3;
  w.waveLen = 1e9;
  w.spawnAcc = -1e12;
  w.eliteDone = true;
  w.surgeDone = true;
  const p = w.players[0];
  p.weapons = weapons.map((x) => ({ kind: x.kind, tier: x.tier, spirit: x.spirit ?? null, cd: 0 }));
  p.pet.cd = 1e12;
  p.iframes = 1e12;
  return { w, p };
};
const enemy = (w: World, kind: EnemyKindName, x: number, y: number, hp = 9999, speed = 0) => {
  const e = spawnEnemy(w, kind, x, y, []);
  e.hp = e.maxHp = hp;
  e.speed = speed;
  e.x = e.px = x;
  e.y = e.py = y;
  return e;
};
/** 一小群站着不动的兵（cx, cy 附近）。 */
const pack = (w: World, cx: number, cy: number, n: number, hp = 9999, spread = 10) =>
  Array.from({ length: n }, (_, i) => enemy(w, 'soldier', cx + ((i % 3) - 1) * spread, cy + (Math.floor(i / 3) - 1) * spread, hp));
const hitsOn = (ev: SimEvent[], id: number, by?: string) => ev.filter((e) => e.t === 'hit' && e.id === id && (!by || e.by === by));
const dealt = (ev: SimEvent[], by?: string) => ev.reduce((a, e) => a + (e.t === 'hit' && (!by || e.by === by) ? e.dmg : 0), 0);
const zonesOf = (w: World, kind: Zone['kind']) => w.zones.filter((z) => z.kind === kind);
type Ev<T extends SimEvent['t']> = Extract<SimEvent, { t: T }>;
const evs = <T extends SimEvent['t']>(ev: SimEvent[], t: T) => ev.filter((e): e is Ev<T> => e.t === t);

// ---------- 图鉴 ----------

test('图鉴：8 件都有名字、五行、价格、冷却 ≥ 1.2 秒、伤害、说明、三个品阶的说明和两个器灵；五行每行 3 件公共法宝', () => {
  for (const k of NEW) {
    const d = WEAPONS[k];
    assert.ok(d.name && d.desc && d.price > 0 && d.dmg > 0, k);
    assert.ok(d.cd >= 1.2, `${k} 冷却 ${d.cd}`);
    assert.equal(d.mul.length, 5, `${k} 各品阶倍率`);
    assert.ok(d.tiers[1] && d.tiers[2] && d.tiers[3], `${k} 品阶说明`);
    assert.equal(d.spirits.length, 2);
    for (const s of d.spirits) assert.ok(s.id && s.name && s.desc, `${k} 器灵`);
    assert.ok(!d.wip, `${k} 画面已做完，不再标 wip`);
  }
  // 原来的 15 件公共法宝五行每行 3 件（arti2 分支再加的 11 件在 arti2.test.ts 里查）
  const first15 = COMMON_WEAPONS.slice(0, 15);
  assert.ok(COMMON_WEAPONS.length >= 15);
  for (const el of ['metal', 'wood', 'water', 'fire', 'earth'] as const) assert.equal(first15.filter((k) => WEAPONS[k].el === el).length, 3, `${el} 行 3 件`);
  assert.deepEqual(
    (Object.keys(WEAPONS) as WeaponKind[]).filter((k) => WEAPONS[k].role),
    ['xinghuang', 'qinglian', 'kunxian'],
    '防御 / 控制型是杏黄旗、青莲宝色旗、捆仙绳',
  );
});

// ---------- 凡品：每件都能出手，事件带 kind 和 tier ----------

test('凡品：8 件都能出手打出伤害（青莲是回血 + 荆棘），法宝事件带 kind 和 tier', () => {
  for (const k of NEW) {
    const { w, p } = arena(31, [{ kind: k, tier: 1 }]);
    pack(w, p.x + 40, p.y, 6, 200);
    p.hp = 50; // 青莲：气血不满才回得出来
    const ev = run(w, 3);
    assert.ok(dealt(ev) > 0, `${k} 打出了伤害`);
    const mine = ev.filter((e) => ('kind' in e && e.kind === k) || ((e.t === 'warn' || e.t === 'land') && e.kind === 'lash'));
    assert.ok(mine.length > 0, `${k} 发了自己的事件`);
    for (const e of mine) assert.equal((e as { tier?: number }).tier, 1, `${k} 的 ${e.t} 带 tier`);
    for (const e of ev) if ((e.t === 'zone' || e.t === 'zoneEnd') && e.kind === k) assert.ok(w.zones.length >= 0 && e.zone, `${k} 的区域事件带区域种类`);
  }
});

// ---------- 打神鞭 ----------

test('打神鞭：先预警、跟着目标落下，抽血最厚的那只，对精英翻倍；鞭痕上的也挨一下', () => {
  const { w, p } = arena(32, [{ kind: 'dashen', tier: 1 }]);
  const thin = enemy(w, 'soldier', p.x + 30, p.y, 50);
  const fat = enemy(w, 'soldier', p.x + 80, p.y, 400);
  const behind = enemy(w, 'soldier', p.x + 96, p.y, 400); // 在鞭痕上（鞭痕顺着人物 → 目标的方向）
  const ev0 = run(w, 0.05);
  const warn = evs(ev0, 'warn').find((e) => e.kind === 'lash');
  assert.ok(warn && warn.tier === 1, '先预警');
  assert.ok(w.pending.some((q) => q.kind === 'lash' && q.target === fat.id), '抽血最厚的那只');
  const ev = run(w, TUNE.dashen.delay + 0.05);
  const lash = evs(ev, 'lash')[0];
  assert.ok(lash && lash.target === fat.id && lash.kind === 'dashen' && lash.tier === 1 && lash.ring === 0, 'lash 事件（凡品没有震波）');
  assert.ok(hitsOn(ev, fat.id, 'lash').length === 1);
  assert.ok(hitsOn(ev, behind.id, 'lash').length === 1, '鞭痕上的也挨一下');
  assert.equal(hitsOn(ev, thin.id).length, 0);
  // 对精英翻倍：同一下打精英和打兵比一比（不暴击）
  const a = arena(33, [{ kind: 'dashen', tier: 1 }]);
  a.p.stats.crit = 0;
  const el = enemy(a.w, 'elite', a.p.x + 60, a.p.y, 5000);
  const evA = run(a.w, 0.5);
  const b = arena(33, [{ kind: 'dashen', tier: 1 }]);
  b.p.stats.crit = 0;
  const so = enemy(b.w, 'soldier', b.p.x + 60, b.p.y, 5000);
  const evB = run(b.w, 0.5);
  const ha = hitsOn(evA, el.id, 'lash')[0];
  const hb = hitsOn(evB, so.id, 'lash')[0];
  assert.ok(ha?.t === 'hit' && hb?.t === 'hit' && Math.abs(ha.dmg / hb.dmg - TUNE.dashen.elite) < 0.05, `对精英翻倍（${ha && ha.t === 'hit' && ha.dmg} / ${hb && hb.t === 'hit' && hb.dmg}）`);
});

test('打神鞭灵品：一次抽两只（两只都抽中）', () => {
  const { w, p } = arena(34, [{ kind: 'dashen', tier: 2 }]);
  const x = enemy(w, 'soldier', p.x + 60, p.y - 40, 300);
  const y = enemy(w, 'soldier', p.x + 60, p.y + 40, 300);
  const ev = run(w, 0.7);
  assert.equal(evs(ev, 'lash').length, 2);
  assert.ok(hitsOn(ev, x.id, 'lash').length >= 1 && hitsOn(ev, y.id, 'lash').length >= 1);
});

test('打神鞭仙品「打神」：抽中精英镇住约 1 秒；首领不吃控制、倍率比凡 / 灵品高一档；落点震出一圈波及周围的小怪', () => {
  const { w, p } = arena(35, [{ kind: 'dashen', tier: 3 }]);
  p.stats.crit = 0;
  const el = enemy(w, 'elite', p.x + 70, p.y, 99999);
  const near = enemy(w, 'soldier', p.x + 70, p.y + 26, 999); // 不在鞭痕上、在震波里
  const ev = run(w, TUNE.dashen.delay + 0.05);
  const lash = evs(ev, 'lash')[0];
  assert.ok(lash && lash.ring > 0, '仙品有震波');
  assert.ok(el.stun >= TUNE.dashen.stunElite - 0.1, `精英被镇住（${el.stun.toFixed(2)}）`);
  assert.ok(hitsOn(ev, near.id, 'lash').length >= 1, '震波打到周围的小怪');
  // 首领：不晕，吃的是首领的倍率（boss[3]），不是精英的（elite）；仙品起首领的倍率比凡 / 灵品高一档
  const b = arena(35, [{ kind: 'dashen', tier: 3 }]);
  b.p.stats.crit = 0;
  const boss = enemy(b.w, 'boss', b.p.x + 70, b.p.y, 99999);
  const evB = run(b.w, TUNE.dashen.delay + 0.05);
  assert.equal(boss.stun, 0, '首领不吃控制');
  const hb = hitsOn(evB, boss.id, 'lash')[0];
  const he = hitsOn(ev, el.id, 'lash')[0];
  assert.ok(hb?.t === 'hit' && he?.t === 'hit' && Math.abs(hb.dmg / he.dmg - TUNE.dashen.boss[3] / TUNE.dashen.elite) < 0.05, '首领吃首领的倍率');
  assert.ok(TUNE.dashen.boss[3] > TUNE.dashen.boss[2], '仙品对首领的倍率更高一档');
  // 凡品不晕
  const c = arena(35, [{ kind: 'dashen', tier: 2 }]);
  const el2 = enemy(c.w, 'elite', c.p.x + 70, c.p.y, 99999);
  run(c.w, TUNE.dashen.delay + 0.05);
  assert.equal(el2.stun, 0);
});

test('打神鞭神品：「封神」抽散残血（非首领）；「九节」同一目标连抽三鞭', () => {
  const { w, p } = arena(36, [{ kind: 'dashen', tier: 4, spirit: 'seal' }]);
  p.stats.crit = 0;
  const e = enemy(w, 'elite', p.x + 60, p.y, 1000);
  e.hp = 300; // 30%：这一鞭打下来就低于 25%
  const ev = run(w, TUNE.dashen.delay + 0.05);
  const kill = evs(ev, 'kill').find((k) => k.id === e.id);
  assert.ok(kill && kill.execute, '残血被直接抽散');
  const boss = arena(36, [{ kind: 'dashen', tier: 4, spirit: 'seal' }]);
  boss.p.stats.crit = 0;
  const bo = enemy(boss.w, 'boss', boss.p.x + 60, boss.p.y, 100000);
  bo.hp = 22000;
  run(boss.w, TUNE.dashen.delay + 0.05);
  assert.ok(bo.hp > 0, '首领不会被抽散');
  const nine = arena(37, [{ kind: 'dashen', tier: 4, spirit: 'nine' }]);
  const t = enemy(nine.w, 'elite', nine.p.x + 60, nine.p.y, 1e6);
  const ev2 = run(nine.w, 0.05);
  const warns = evs(ev2, 'warn').filter((x) => x.kind === 'lash');
  assert.ok(warns.length >= 3, '三鞭');
  const ids = new Set(warns.map((x) => x.id));
  assert.ok([...nine.w.pending].filter((q) => ids.has(q.id) && q.target === t.id).length >= 3, '都抽同一只');
  const ev3 = run(nine.w, 1.2);
  assert.ok(evs(ev3, 'lash').some((x) => x.seq === 3), 'seq 记着是第几鞭');
  assert.ok(hitsOn(ev3, t.id, 'lash').length >= 3);
});

// ---------- 化血神刀 ----------

test('化血神刀：身前一道月牙血光（扇面），斩中的留下流血；灵品更宽、一斩叠两层', () => {
  const { w, p } = arena(38, [{ kind: 'huaxue', tier: 1 }]);
  const front = enemy(w, 'soldier', p.x + 40, p.y, 999);
  enemy(w, 'soldier', p.x + 46, p.y + 12, 999); // 身前两只、身后一只：朝身前斩
  const back = enemy(w, 'soldier', p.x - 40, p.y, 999);
  const ev = run(w, 0.05);
  const s = evs(ev, 'slash')[0];
  assert.ok(s && s.kind === 'huaxue' && s.tier === 1 && s.r > 0 && s.arc > 0);
  assert.equal(hitsOn(ev, front.id, 'slash').length, 1);
  assert.equal(hitsOn(ev, back.id, 'slash').length, 0, '扇面只在身前');
  const per = WEAPONS.huaxue.dmg * WEAPONS.huaxue.mul[1] * HUAXUE.bleed[1];
  assert.ok(Math.abs(front.bleed - per) < 0.2, '一层流血');
  const two = arena(38, [{ kind: 'huaxue', tier: 2 }]);
  const f2 = enemy(two.w, 'soldier', two.p.x + 40, two.p.y, 999);
  const ev2 = run(two.w, 0.05);
  const s2 = evs(ev2, 'slash')[0];
  assert.ok(s2.arc > s.arc, '灵品更宽');
  const per2 = WEAPONS.huaxue.dmg * WEAPONS.huaxue.mul[2] * HUAXUE.bleed[2];
  assert.ok(Math.abs(f2.bleed - per2 * 2) < 0.3, '一斩两层');
  assert.ok(HUAXUE.cap[2] > BLEED.stacks || HUAXUE.cap[3] > BLEED.stacks, '化血神刀的流血叠得比斩仙飞刀深');
});

test('化血神刀仙品「化血」：带着流血死掉的敌人化成血雾，把流血传给身边的；一斩斩死的不算', () => {
  const { w, p } = arena(39, [{ kind: 'huaxue', tier: 3 }]);
  const v = enemy(w, 'soldier', p.x + 40, p.y, 999);
  const nb = enemy(w, 'soldier', p.x + 40, p.y + 16, 999);
  p.weapons[0].cd = 1e9; // 不让刀自己出手，手动安排
  v.bleed = 5;
  v.bleedT = 3;
  v.bleedBy = 0;
  v.hp = 3;
  const ev: SimEvent[] = [];
  buildGrid(w.enemies);
  hitEnemy(w, v, { dmg: 10, by: 'thrust', owner: 0, from: p }, ev);
  const mist = evs(ev, 'mist')[0];
  assert.ok(mist && mist.kind === 'huaxue' && mist.tier === 3 && mist.ids.includes(nb.id), '化成血雾');
  assert.ok(nb.bleed > 0 && nb.bleedT > 0, '传上流血');
  // 一斩斩死（之前没流血）：不化血雾
  const b = arena(40, [{ kind: 'huaxue', tier: 3 }]);
  enemy(b.w, 'soldier', b.p.x + 40, b.p.y, 1);
  enemy(b.w, 'soldier', b.p.x + 40, b.p.y + 16, 999);
  const evB = run(b.w, 0.05);
  assert.ok(evs(evB, 'kill').length === 1 && evs(evB, 'mist').length === 0, '一斩斩死的不化血雾');
  // 灵品没有血雾
  const c = arena(41, [{ kind: 'huaxue', tier: 2 }]);
  const cv = enemy(c.w, 'soldier', c.p.x + 40, c.p.y, 999);
  c.p.weapons[0].cd = 1e9;
  cv.bleed = 5;
  cv.bleedT = 3;
  cv.bleedBy = 0;
  cv.hp = 2;
  const evC: SimEvent[] = [];
  buildGrid(c.w.enemies);
  hitEnemy(c.w, cv, { dmg: 10, by: 'thrust', owner: 0, from: c.p }, evC);
  assert.equal(evs(evC, 'mist').length, 0);
});

test('化血神刀神品：「血海」斩击范围更大；「噬魂」流血每跳给人物回血', () => {
  const r = (spirit: string | null, tier: number) => {
    const { w, p } = arena(42, [{ kind: 'huaxue', tier, spirit }]);
    enemy(w, 'soldier', p.x + 40, p.y, 999);
    return evs(run(w, 0.05), 'slash')[0];
  };
  const sea = r('sea', 4);
  const xian = r(null, 3);
  assert.ok(sea.r > xian.r && sea.arc > xian.arc, '血海更远更宽');
  const { w, p } = arena(43, [{ kind: 'huaxue', tier: 4, spirit: 'soul' }]);
  pack(w, p.x + 40, p.y, 6, 5000);
  p.hp = 40;
  const ev = run(w, 3);
  const heals = evs(ev, 'heal').filter((h) => h.kind === 'huaxue' && h.tier === 4);
  assert.ok(heals.length > 0 && p.hp > 40, `噬魂回血（${p.hp.toFixed(1)}）`);
  const total = heals.reduce((a, h) => a + h.amount, 0);
  assert.ok(total <= TUNE.huaxue.soul.cap * 3 + 1e-6, '每秒回血有上限');
  const plain = arena(43, [{ kind: 'huaxue', tier: 4, spirit: 'sea' }]);
  pack(plain.w, plain.p.x + 40, plain.p.y, 6, 5000);
  plain.p.hp = 40;
  run(plain.w, 3);
  assert.equal(plain.p.hp, 40, '血海不回血');
});

// ---------- 定风珠 ----------

test('定风珠：在敌人最密处起旋风，把卷住的往中心卷，约 1.5 秒后吹散（伤害 + 击退）；灵品更大、卷得更久', () => {
  const { w, p } = arena(44, [{ kind: 'dingfeng', tier: 1 }]);
  const g = pack(w, p.x + 90, p.y, ZONE_FX.whirl.cap[1] + 3, 9999, 14); // 比一次卷得住的（cap + 木行一件的 1）多两只：「卷满了的不再卷」
  const ev = run(w, 0.05);
  const z = evs(ev, 'zone').find((e) => e.zone === 'whirl');
  assert.ok(z && z.kind === 'dingfeng' && z.tier === 1 && Math.abs(z.life - TUNE.dingfeng.life[1]) < 1e-9);
  const whirl = zonesOf(w, 'whirl')[0];
  const d0 = g.map((e) => Math.hypot(e.x - whirl.x, e.y - whirl.y));
  run(w, 1);
  const caught = g.filter((e) => whirl.ids!.includes(e.id));
  assert.ok(caught.length >= 3 && caught.length <= ZONE_FX.whirl.cap[1] + 1, `卷住几只（${caught.length}）`);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const d1 = caught.map((e) => Math.hypot(e.x - whirl.x, e.y - whirl.y));
  assert.ok(mean(d1) < mean(caught.map((e) => d0[g.indexOf(e)])) - 3, `往中心卷（${mean(caught.map((e) => d0[g.indexOf(e)])).toFixed(1)} → ${mean(d1).toFixed(1)}）`);
  assert.ok(g.some((e) => !whirl.ids!.includes(e.id)), '卷满了的不再卷');
  p.weapons = [];
  const ev2: SimEvent[] = [];
  for (let i = 0; i < 120 && !ev2.some((e) => e.t === 'zoneEnd'); i++) ev2.push(...step(w, [idle]));
  const end = evs(ev2, 'zoneEnd').find((e) => e.zone === 'whirl');
  assert.ok(end && end.effect === 'gust' && end.ids && end.ids.length === caught.length, '吹散');
  for (const e of caught) assert.ok(hitsOn(ev2, e.id, 'gust').length === 1, '卷住的都挨了一下');
  assert.ok(caught.every((e) => Math.hypot(e.kx, e.ky) > 20), '击退');
  assert.ok(TUNE.dingfeng.r[2] > TUNE.dingfeng.r[1] && TUNE.dingfeng.life[2] > TUNE.dingfeng.life[1] && ZONE_FX.whirl.cap[2] > ZONE_FX.whirl.cap[1], '灵品更大、更久、卷得更多');
});

test('定风珠仙品「定风」：旋风追着敌群移动、持续更久、期间反复伤害', () => {
  const { w, p } = arena(45, [{ kind: 'dingfeng', tier: 3 }]);
  const g = pack(w, p.x + 90, p.y, 6, 9999, 12);
  run(w, 0.05);
  const z = zonesOf(w, 'whirl')[0];
  assert.ok(z.life > TUNE.dingfeng.life[2]);
  // 把敌群整体挪开一点，旋风会跟过去
  for (const e of g) e.x += 50;
  const x0 = z.x;
  const ev = run(w, 1.2);
  assert.ok(z.x > x0 + 10, `旋风追着敌群走（${(z.x - x0).toFixed(1)}）`);
  assert.ok(ev.some((e) => e.t === 'hit' && e.by === 'zone'), '期间反复伤害');
  const b = arena(45, [{ kind: 'dingfeng', tier: 2 }]);
  pack(b.w, b.p.x + 90, b.p.y, 6, 9999, 12);
  const evB = run(b.w, 1.2);
  assert.ok(!evB.some((e) => e.t === 'hit' && e.by === 'zone'), '灵品期间不伤人');
});

test('定风珠神品：「风雷」旋风里不断落雷（连跳、吃木行连锁）；「定海」吹散改成定身、不击退', () => {
  const { w, p } = arena(46, [{ kind: 'dingfeng', tier: 4, spirit: 'thunder' }]);
  pack(w, p.x + 90, p.y, 6, 9999, 12);
  const ev = run(w, 2);
  const chains = evs(ev, 'chain').filter((c) => c.kind === 'dingfeng' && c.tier === 4);
  assert.ok(chains.length >= 2, `落雷（${chains.length}）`);
  assert.ok(chains.some((c) => c.pts.length >= 3), '雷光连跳');
  const calm = arena(47, [{ kind: 'dingfeng', tier: 4, spirit: 'calm' }]);
  pack(calm.w, calm.p.x + 90, calm.p.y, 6, 9999, 12);
  const evC = run(calm.w, TUNE.dingfeng.life[4] + 0.2);
  const end = evs(evC, 'zoneEnd').find((e) => e.zone === 'whirl')!;
  assert.ok(end.effect === 'root' && end.ids!.length > 0);
  for (const id of end.ids!) {
    const e = calm.w.enemies.find((x) => x.id === id)!;
    assert.ok(e.stun > 1, '定身');
    assert.ok(Math.hypot(e.kx, e.ky) < 1, '不击退');
  }
});

// ---------- 青莲宝色旗 ----------

test('青莲宝色旗：脚下展开结界，站在里面回血，进来的敌人被荆棘刺伤；灵品更大更久', () => {
  const { w, p } = arena(48, [{ kind: 'qinglian', tier: 1 }]);
  p.hp = 50;
  const e = enemy(w, 'soldier', p.x + 20, p.y, 999);
  const far = enemy(w, 'soldier', p.x + 100, p.y, 999);
  const ev = run(w, 2);
  const z = evs(ev, 'zone').find((x) => x.zone === 'lotus');
  assert.ok(z && z.kind === 'qinglian' && z.tier === 1);
  assert.ok(p.hp > 52, `回血（${p.hp.toFixed(1)}）`);
  assert.ok(evs(ev, 'heal').some((h) => h.kind === 'qinglian'), 'heal 事件');
  assert.ok(hitsOn(ev, e.id, 'zone').length >= 3, '荆棘');
  assert.equal(hitsOn(ev, far.id).length, 0);
  // 凡品结界不跟着走
  const lotus = zonesOf(w, 'lotus')[0];
  const x0 = lotus.x;
  run(w, 0.5, () => ({ mx: 1, my: 0, skill: false }));
  assert.equal(lotus.x, x0, '凡品不跟着走');
  assert.ok(TUNE.qinglian.r[2] > TUNE.qinglian.r[1] && TUNE.qinglian.life[2] > TUNE.qinglian.life[1]);
  // 满血又没敌人：不展开
  const idleW = arena(49, [{ kind: 'qinglian', tier: 1 }]);
  assert.equal(evs(run(idleW.w, 1), 'zone').length, 0);
});

test('青莲宝色旗仙品「步步生莲」：结界跟着人物走；神品「莲台」回血更多、闪避更高；「荆棘」荆棘伤害大幅提高', () => {
  const { w, p } = arena(50, [{ kind: 'qinglian', tier: 3 }]);
  p.hp = 50;
  enemy(w, 'soldier', p.x + 20, p.y, 999);
  run(w, 0.1);
  const z = zonesOf(w, 'lotus')[0];
  run(w, 1, () => ({ mx: 1, my: 0, skill: false }));
  assert.ok(Math.abs(z.x - p.x) < 1e-6 && Math.abs(z.y - p.y) < 1e-6, '跟着人走');
  // 莲台：回血 ×1.8、闪避提高（core.hurtPlayer 里算）
  const dais = arena(51, [{ kind: 'qinglian', tier: 4, spirit: 'dais' }]);
  dais.p.hp = 30;
  enemy(dais.w, 'soldier', dais.p.x + 20, dais.p.y, 999);
  run(dais.w, 0.1);
  const dz = zonesOf(dais.w, 'lotus')[0];
  assert.ok(dz.dodge && dz.dodge > 0 && dz.heal! > TUNE.qinglian.heal[4] * 1.5);
  const dodges = (inside: boolean) => {
    const { w: ww, p: pp } = arena(52, [{ kind: 'qinglian', tier: 4, spirit: 'dais' }]);
    pp.hp = 30;
    enemy(ww, 'soldier', pp.x + 20, pp.y, 999);
    run(ww, 0.1);
    pp.stats.maxHp = pp.hp = 1e9; // 挨 400 下也不倒
    if (!inside) ww.zones = [];
    let n = 0;
    for (let i = 0; i < 400; i++) {
      pp.iframes = 0;
      const ev: SimEvent[] = [];
      hurtPlayer(ww, pp, 1, 'contact', ev);
      if (ev.some((e) => e.t === 'dodge')) n++;
    }
    return n;
  };
  assert.ok(dodges(true) > dodges(false) + 20, `结界里闪避更高（${dodges(true)} vs ${dodges(false)}）`);
  const thorn = (spirit: string) => {
    const { w: ww, p: pp } = arena(53, [{ kind: 'qinglian', tier: 4, spirit }]);
    pp.hp = 30;
    enemy(ww, 'soldier', pp.x + 20, pp.y, 99999);
    return dealt(run(ww, 2), 'zone');
  };
  assert.ok(thorn('thorn') > thorn('dais') * 2, '荆棘伤害大幅提高');
});

// ---------- 阴阳镜 ----------

test('阴阳镜：朝敌人最密的方向扫出一道光束（扫过的各打一次），伤害并减速；灵品更长、扫得更宽', () => {
  const { w, p } = arena(54, [{ kind: 'yinyang', tier: 1 }]);
  const g = pack(w, p.x + 60, p.y, 3, 9999, 12);
  const other = enemy(w, 'soldier', p.x - 60, p.y, 9999);
  const ev = run(w, 0.05);
  const z = evs(ev, 'zone').filter((x) => x.zone === 'beam');
  assert.equal(z.length, 1, '凡品一道');
  const beam = zonesOf(w, 'beam')[0];
  assert.ok(Math.abs((beam.to ?? 0) - (beam.from ?? 0)) - TUNE.yinyang.sweep[1] < 1e-9);
  const ev2 = run(w, TUNE.yinyang.dur[1] + 0.1);
  for (const e of g) assert.equal(hitsOn([...ev, ...ev2], e.id, 'beam').length, 1, '扫过的各打一次');
  assert.equal(hitsOn([...ev, ...ev2], other.id).length, 0, '只扫最密的那一边');
  assert.ok(g.every((e) => e.slow > 0), '减速');
  assert.ok(TUNE.yinyang.len[2] > TUNE.yinyang.len[1] && TUNE.yinyang.sweep[2] > TUNE.yinyang.sweep[1]);
});

test('阴阳镜仙品「阴阳」：一阴一阳两道光束反向扫，同时被两道照到的冻住（首领不冻）', () => {
  const { w, p } = arena(55, [{ kind: 'yinyang', tier: 3 }]);
  const g = pack(w, p.x + 60, p.y, 3, 9999, 12);
  const boss = enemy(w, 'boss', p.x + 70, p.y + 30, 99999);
  const ev = run(w, 0.05);
  const beams = zonesOf(w, 'beam');
  assert.equal(beams.length, 2);
  const [a, b] = beams;
  assert.ok(a.yin !== b.yin && a.twin === b.id && b.twin === a.id, '一阴一阳，互为 twin');
  assert.ok(Math.sign((a.to ?? 0) - (a.from ?? 0)) === -Math.sign((b.to ?? 0) - (b.from ?? 0)), '反向扫');
  const ev2 = run(w, TUNE.yinyang.dur[3] + 0.1);
  const all = [...ev, ...ev2];
  for (const e of g) {
    assert.equal(hitsOn(all, e.id, 'beam').length, 2, '两道都照到');
    assert.ok(e.frozen > 0 || all.some((x) => x.t === 'freeze' && x.id === e.id), '冻住');
  }
  assert.equal(boss.frozen, 0, '首领不冻');
});

test('阴阳镜神品：「照妖」对精英伤害更高；「乾坤」两道各扫整整一圈（身后的也照到）', () => {
  const vs = (spirit: string) => {
    const { w, p } = arena(56, [{ kind: 'yinyang', tier: 4, spirit }]);
    p.stats.crit = 0;
    const e = enemy(w, 'elite', p.x + 50, p.y, 1e6);
    const ev = run(w, 1);
    return hitsOn(ev, e.id, 'beam').reduce((s, h) => s + (h.t === 'hit' ? h.dmg : 0), 0) / WEAPONS.yinyang.spirits.find((s) => s.id === spirit)!.mul!;
  };
  assert.ok(vs('demon') > vs('cosmos') * (1 + (ZONE_FX.beam.demon - 1) * 0.8), '照妖对精英更狠');
  const { w, p } = arena(57, [{ kind: 'yinyang', tier: 4, spirit: 'cosmos' }]);
  const front = pack(w, p.x + 50, p.y, 2, 9999, 12);
  const back = enemy(w, 'soldier', p.x - 50, p.y, 9999);
  run(w, 0.05);
  for (const z of zonesOf(w, 'beam')) assert.ok(Math.abs(Math.abs((z.to ?? 0) - (z.from ?? 0)) - Math.PI * 2) < 1e-9, '整整一圈');
  const ev = run(w, TUNE.yinyang.cosmos + 0.1);
  assert.ok(hitsOn(ev, back.id, 'beam').length >= 1, '身后的也照到');
  void front;
});

// ---------- 玄元控水旗 ----------

test('玄元控水旗：在敌人最密处展开水域：中心先涌起水柱，里面的敌人大幅减速并持续受伤；灵品更大更久', () => {
  const { w, p } = arena(58, [{ kind: 'xuanyuan', tier: 1 }]);
  const g = pack(w, p.x + 80, p.y, 5, 9999, 12);
  const ev = run(w, 0.05);
  const z = evs(ev, 'zone').find((x) => x.zone === 'water');
  assert.ok(z && z.kind === 'xuanyuan' && z.tier === 1);
  assert.ok(ev.some((x) => x.t === 'hit' && x.by === 'tide'), '水柱');
  p.weapons = []; // 只看这一片
  const ev2 = run(w, 1.5);
  for (const e of g) {
    assert.ok(hitsOn(ev2, e.id, 'zone').length >= 3, '持续受伤');
    assert.ok(e.slow >= 0.5, '大幅减速');
  }
  run(w, TUNE.xuanyuan.life[1]);
  assert.equal(zonesOf(w, 'water').length, 0, '到时退去');
  assert.ok(TUNE.xuanyuan.r[2] > TUNE.xuanyuan.r[1] && TUNE.xuanyuan.life[2] > TUNE.xuanyuan.life[1]);
});

test('玄元控水旗仙品「漩涡」：把敌人慢慢吸向中心、持续更久；首领不被吸', () => {
  const { w, p } = arena(59, [{ kind: 'xuanyuan', tier: 3 }]);
  const c = pack(w, p.x + 80, p.y, 3, 9999, 8); // 最密的一小团：水域落在这里
  const edge = enemy(w, 'soldier', p.x + 80, p.y + 34, 9999);
  run(w, 0.05);
  p.weapons = [];
  const z = zonesOf(w, 'water')[0];
  assert.ok(Math.hypot(z.x - (p.x + 80), z.y - (p.y - 8)) < 10, '落在最密处');
  const boss = enemy(w, 'boss', z.x, z.y - 38, 99999); // 水域展开之后才走进来的首领
  assert.ok(z.pull && z.pull > 0 && z.life > TUNE.xuanyuan.life[2]);
  const d0 = Math.hypot(edge.x - z.x, edge.y - z.y);
  const b0 = { x: boss.x, y: boss.y };
  run(w, 1.5);
  assert.ok(Math.hypot(edge.x - z.x, edge.y - z.y) < d0 - 10, '往中心吸');
  assert.ok(Math.hypot(boss.x - b0.x, boss.y - b0.y) < 1, '首领不被吸');
  void c;
});

test('玄元控水旗神品：「水淹」同时两片；「寒潭」水域结束时冻住里面的（首领不冻）', () => {
  const { w, p } = arena(60, [{ kind: 'xuanyuan', tier: 4, spirit: 'flood' }]);
  pack(w, p.x + 80, p.y, 3, 9999, 10);
  pack(w, p.x - 80, p.y, 3, 9999, 10);
  run(w, 0.05);
  assert.equal(zonesOf(w, 'water').length, 2, '两片');
  const ab = arena(61, [{ kind: 'xuanyuan', tier: 4, spirit: 'abyss' }]);
  const g = pack(ab.w, ab.p.x + 80, ab.p.y, 3, 9999, 10);
  const boss = enemy(ab.w, 'boss', ab.p.x + 80, ab.p.y + 22, 99999);
  ab.p.weapons[0].cd = 0;
  run(ab.w, 0.05);
  ab.p.weapons = [];
  const ev = run(ab.w, TUNE.xuanyuan.life[4] + 0.1);
  const end = evs(ev, 'zoneEnd').find((e) => e.zone === 'water');
  assert.ok(end && end.effect === 'freeze' && end.ids!.length >= 3);
  for (const e of g) assert.ok(e.frozen > 1, '冻住');
  assert.equal(boss.frozen, 0, '首领不冻');
});

// ---------- 五火七禽扇 ----------

test('五火七禽扇：朝最近的敌人扇出扇形火浪（推到谁烧谁一次），击退并点燃；灵品扇面更宽、更远', () => {
  const { w, p } = arena(62, [{ kind: 'wuhuo', tier: 1 }]);
  const g = pack(w, p.x + 50, p.y, 3, 9999, 10);
  const back = enemy(w, 'soldier', p.x - 50, p.y, 9999);
  const ev = run(w, 0.05);
  const z = evs(ev, 'zone').find((x) => x.zone === 'flameWave');
  assert.ok(z && z.kind === 'wuhuo' && z.tier === 1);
  const ev2 = run(w, 0.6);
  for (const e of g) {
    assert.equal(hitsOn([...ev, ...ev2], e.id, 'wave').length, 1, '烧一次');
    assert.ok(e.burnT > 0, '点燃');
  }
  assert.ok(g.some((e) => e.x > p.x + 50 + 3), '击退');
  assert.equal(hitsOn([...ev, ...ev2], back.id, 'wave').length, 0, '扇面只朝一边');
  assert.ok(TUNE.wuhuo.arc[2] > TUNE.wuhuo.arc[1] && TUNE.wuhuo.reach[2] > TUNE.wuhuo.reach[1]);
});

test('五火七禽扇仙品「七禽」：火浪里飞出七只火鸟，各追一个敌人；火鸟不当成飞刀', () => {
  const { w, p } = arena(63, [{ kind: 'wuhuo', tier: 3 }]);
  const g = Array.from({ length: 8 }, (_, i) => enemy(w, 'soldier', p.x + 40 + (i % 4) * 25, p.y - 40 + Math.floor(i / 4) * 80, 9999));
  const ev = run(w, 0.05);
  const birds = w.knives.filter((k) => k.kind === 'wuhuo');
  assert.equal(birds.length, TUNE.wuhuo.bird.n, '七只');
  assert.equal(new Set(birds.map((k) => k.target)).size, 7, '各追一个');
  assert.ok(evs(ev, 'throw').some((t) => t.kind === 'wuhuo' && t.tier === 3));
  const ev2 = run(w, 2.5);
  assert.ok(ev2.filter((e) => e.t === 'hit' && e.by === 'bird').length >= 6, '火鸟打中');
  assert.equal(ev2.filter((e) => e.t === 'hit' && e.by === 'knife').length, 0, '不当成斩仙飞刀');
  void g;
  const b = arena(63, [{ kind: 'wuhuo', tier: 2 }]);
  enemy(b.w, 'soldier', b.p.x + 40, b.p.y, 9999);
  run(b.w, 0.05);
  assert.equal(b.w.knives.length, 0, '灵品没有火鸟');
});

test('五火七禽扇神品：「五火」一圈五道火浪（身后的也烧到）；「焚风」推得更远，留下焦土持续灼烧', () => {
  const { w, p } = arena(64, [{ kind: 'wuhuo', tier: 4, spirit: 'five' }]);
  enemy(w, 'soldier', p.x + 50, p.y, 9999);
  const back = enemy(w, 'soldier', p.x - 50, p.y, 9999);
  const ev = run(w, 0.05);
  assert.equal(evs(ev, 'zone').filter((x) => x.zone === 'flameWave').length, 5, '五道');
  const ev2 = run(w, 0.6);
  assert.equal(hitsOn([...ev, ...ev2], back.id, 'wave').length, 1, '身后的也烧到（一圈只挨一道）');
  const g = arena(65, [{ kind: 'wuhuo', tier: 4, spirit: 'gale' }]);
  const e = enemy(g.w, 'soldier', g.p.x + 60, g.p.y, 99999);
  const evG = run(g.w, 0.05);
  const wave = g.w.zones.find((z) => z.kind === 'flameWave')!;
  assert.ok(wave.len! > TUNE.wuhuo.reach[4] * 1.1, '推得更远');
  const evG2 = run(g.w, wave.life + 0.1);
  const sc = evs([...evG, ...evG2], 'zone').find((x) => x.zone === 'scorch');
  assert.ok(sc && sc.kind === 'wuhuo' && sc.tier === 4, '留下焦土');
  g.p.weapons = [];
  const scorch = zonesOf(g.w, 'scorch')[0];
  // 火鸟会把它撞开：摆回焦土上再看
  e.x = e.px = (scorch.x + scorch.x2) / 2;
  e.y = e.py = (scorch.y + scorch.y2) / 2;
  e.kx = e.ky = 0;
  e.burn = 0;
  e.burnT = 0;
  const evG3 = run(g.w, 1);
  assert.ok(hitsOn(evG3, e.id, 'zone').length >= 2, '焦土持续灼烧');
  run(g.w, SCORCH.life);
  assert.equal(zonesOf(g.w, 'scorch').length, 0, '焦土到时熄灭');
});

// ---------- 捆仙绳 ----------

test('捆仙绳：金绳射向最近的敌人，把一串（3 只）捆在一起：定身 + 易伤；精英与首领捆不住；灵品捆 4 只、更久', () => {
  const { w, p } = arena(66, [{ kind: 'kunxian', tier: 1 }]);
  const line = Array.from({ length: 5 }, (_, i) => enemy(w, 'soldier', p.x + 40 + i * 30, p.y, 9999));
  const el = enemy(w, 'elite', p.x + 30, p.y + 20, 9999);
  const ev = run(w, 0.05);
  const z = evs(ev, 'zone').find((x) => x.zone === 'rope');
  assert.ok(z && z.kind === 'kunxian' && z.tier === 1);
  const rope = zonesOf(w, 'rope')[0];
  assert.equal(rope.ids!.length, 3, '捆 3 只');
  assert.ok(!rope.ids!.includes(el.id) && el.stun === 0, '精英捆不住');
  assert.ok(hitsOn(ev, el.id, 'rope').length === 1 && el.vulnT > 0, '金绳照样抽它一下、让它易伤');
  for (const id of rope.ids!) {
    const e = w.enemies.find((x) => x.id === id)!;
    assert.ok(e.stun > 1 && e.vuln >= TUNE.kunxian.vuln[1] && e.vulnT > 1, '定身 + 易伤');
  }
  assert.deepEqual(rope.ids, line.slice(0, 3).map((e) => e.id), '从最近的起，一串（途中的精英不占名额）');
  const two = arena(67, [{ kind: 'kunxian', tier: 2 }]);
  Array.from({ length: 6 }, (_, i) => enemy(two.w, 'soldier', two.p.x + 40 + i * 30, two.p.y, 9999));
  run(two.w, 0.05);
  const r2 = zonesOf(two.w, 'rope')[0];
  assert.equal(r2.ids!.length, 4, '灵品 4 只');
  assert.ok(r2.life > rope.life, '捆得更久');
});

test('捆仙绳仙品「缚仙」：捆住的敌人被拽到一起、互相撞伤，易伤更高', () => {
  const { w, p } = arena(68, [{ kind: 'kunxian', tier: 3 }]);
  const line = Array.from({ length: 4 }, (_, i) => enemy(w, 'soldier', p.x + 40 + i * 30, p.y, 9999)); // 都在射程里（REACH.max）
  run(w, 0.05);
  const rope = zonesOf(w, 'rope')[0];
  assert.equal(rope.ids!.length, 4);
  assert.ok(rope.pull && rope.pull > 0);
  const spread0 = Math.max(...line.map((e) => e.x)) - Math.min(...line.map((e) => e.x));
  const ev = run(w, 1.2);
  const spread1 = Math.max(...line.map((e) => e.x)) - Math.min(...line.map((e) => e.x));
  assert.ok(spread1 < spread0 * 0.5, `拽到一起（${spread0.toFixed(0)} → ${spread1.toFixed(0)}）`);
  assert.ok(ev.filter((e) => e.t === 'hit' && e.by === 'rope').length >= 3, '互相撞伤');
  assert.ok(TUNE.kunxian.vuln[3] > TUNE.kunxian.vuln[2], '易伤更高');
});

test('捆仙绳神品：「困龙」精英也捆住、首领改为大幅减速（不定身）；「连环」一次捆 8 只', () => {
  const { w, p } = arena(69, [{ kind: 'kunxian', tier: 4, spirit: 'dragon' }]);
  const el = enemy(w, 'elite', p.x + 40, p.y, 9999);
  const boss = enemy(w, 'boss', p.x + 80, p.y, 99999);
  run(w, 0.05);
  const rope = zonesOf(w, 'rope')[0];
  assert.ok(rope.ids!.includes(el.id) && el.stun > 1, '精英捆住');
  assert.ok(rope.ids!.includes(boss.id) && boss.stun === 0 && boss.slow >= TUNE.kunxian.bossSlow - 1e-9, '首领只减速');
  const b0 = { x: boss.x, y: boss.y };
  run(w, 1);
  assert.ok(Math.hypot(boss.x - b0.x, boss.y - b0.y) < 1, '缚仙拽不动首领');
  const ch = arena(70, [{ kind: 'kunxian', tier: 4, spirit: 'chain' }]);
  Array.from({ length: 10 }, (_, i) => enemy(ch.w, 'soldier', ch.p.x + 30 + (i % 5) * 26, ch.p.y + Math.floor(i / 5) * 26, 9999));
  run(ch.w, 0.05);
  assert.equal(zonesOf(ch.w, 'rope')[0].ids!.length, TUNE.kunxian.chain, '连环 8 只');
});

// ---------- 首领不吃控制 ----------

test('首领不吃控制：定身、冻结、晕眩都对首领无效；旋风、漩涡、金绳拉不动它，击退也大幅减弱', () => {
  const kits: { kind: WeaponKind; spirit: string | null }[] = [
    { kind: 'dashen', spirit: 'seal' },
    { kind: 'dingfeng', spirit: 'calm' },
    { kind: 'yinyang', spirit: 'cosmos' },
    { kind: 'xuanyuan', spirit: 'abyss' },
    { kind: 'wuhuo', spirit: 'five' },
    { kind: 'kunxian', spirit: 'dragon' },
    { kind: 'huaxue', spirit: 'sea' },
    { kind: 'qinglian', spirit: 'thorn' },
  ];
  for (const kit of kits) {
    const { w, p } = arena(71, [{ kind: kit.kind, tier: 4, spirit: kit.spirit }]);
    const boss = enemy(w, 'boss', p.x + 50, p.y, 1e7);
    const b0 = { x: boss.x, y: boss.y };
    let maxStun = 0;
    let maxFrozen = 0;
    for (let i = 0; i < 60 * 5; i++) {
      step(w, [idle]);
      maxStun = Math.max(maxStun, boss.stun);
      maxFrozen = Math.max(maxFrozen, boss.frozen);
    }
    assert.equal(maxStun, 0, `${kit.kind} 不让首领晕 / 定身`);
    assert.equal(maxFrozen, 0, `${kit.kind} 不冻首领`);
    assert.ok(Math.hypot(boss.x - b0.x, boss.y - b0.y) < 12, `${kit.kind} 拉 / 推不动首领（${Math.hypot(boss.x - b0.x, boss.y - b0.y).toFixed(1)}）`);
    assert.ok(boss.hp < 1e7, `${kit.kind} 照样打得到首领`);
  }
});

// ---------- 不碰敌人的弹道 ----------

test('8 件法宝（神品、两个器灵）都不碰敌人的弹道：鬼火照常飞', () => {
  for (const k of NEW)
    for (const sp of WEAPONS[k].spirits) {
      const { w, p } = arena(72, [{ kind: k, tier: 4, spirit: sp.id }]);
      p.hp = 50;
      pack(w, p.x + 50, p.y, 6, 9999, 12);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        w.orbs.push({ id: 90000 + i, x: p.x + Math.cos(a) * 45, y: p.y + Math.sin(a) * 30, px: 0, py: 0, vx: Math.cos(a) * 4, vy: Math.sin(a) * 4, life: 100, dmg: 1 });
      }
      const start = w.orbs.map((o) => ({ ...o }));
      const secs = 2;
      run(w, secs);
      assert.equal(w.orbs.length, 8, `${k}·${sp.name} 没打散鬼火`);
      for (const o of w.orbs) {
        const s = start.find((x) => x.id === o.id)!;
        assert.ok(Math.abs(o.x - (s.x + s.vx * secs)) < 0.01 && Math.abs(o.y - (s.y + s.vy * secs)) < 0.01, `${k}·${sp.name} 没改鬼火的轨迹`);
      }
    }
});

// ---------- 商店 ----------

test('16 件公共法宝（含后加的 8 件）都进商店；wip 机制留着：标成 wip 的不刷，打开 WIP.shop（数值工具、测试用）才刷得到', () => {
  const offered = (allow: boolean) => {
    const save = WIP.shop;
    WIP.shop = allow;
    try {
      const w = createWorld(73);
      const p = w.players[0];
      const seen = new Set<WeaponKind>();
      for (let i = 0; i < 400; i++) {
        restock(w, p);
        for (const o of p.shop) if (o && (o.cat === 'weapon' || o.cat === 'spirit')) seen.add(o.kind);
      }
      return seen;
    } finally {
      WIP.shop = save;
    }
  };
  // 原来的 15 件都没有标 wip：商店的候选是全部画面做完了的公共法宝，后加的 8 件也刷得到（arti2 再加的那批做完一件去掉一件 wip）
  const ready = COMMON_WEAPONS.filter((k) => !WEAPONS[k].wip);
  assert.ok(COMMON_WEAPONS.slice(0, 15).every((k) => !WEAPONS[k].wip), '原来的 15 件没有标 wip 的');
  assert.deepEqual([...shopWeapons()].sort(), [...ready].sort());
  const all = offered(false);
  for (const k of ready) assert.ok(all.has(k), `${k} 商店刷得到`);
  for (const k of NEW) assert.ok(all.has(k), `后加的 ${k} 商店刷得到`);
  // 机制本身：临时把一件标成 wip，它就不刷；打开 WIP.shop 又刷得到
  const def = WEAPONS.dashen;
  def.wip = true;
  try {
    assert.ok(!shopWeapons().includes('dashen'));
    const off = offered(false);
    assert.ok(!off.has('dashen'), '标成 wip 的不该出现在商店里');
    assert.ok(off.size >= 7, '别的法宝照常刷');
    assert.ok(offered(true).has('dashen'), '打开 WIP.shop 之后刷得到');
  } finally {
    delete def.wip;
  }
});

// ---------- 确定性 ----------

test('加上 8 件新法宝：同种子同输入完全确定', () => {
  const play = (seed: number) => {
    const w = createWorld(seed);
    w.wave = 10;
    w.waveLen = 26;
    const p = w.players[0];
    p.weapons = [
      { kind: 'qiankun', tier: 3, spirit: null, cd: 0.5 },
      { kind: 'dashen', tier: 4, spirit: 'nine', cd: 0.5 },
      { kind: 'huaxue', tier: 3, spirit: null, cd: 0.5 },
      { kind: 'dingfeng', tier: 4, spirit: 'thunder', cd: 0.5 },
      { kind: 'qinglian', tier: 4, spirit: 'dais', cd: 0.5 },
      { kind: 'yinyang', tier: 3, spirit: null, cd: 0.5 },
      { kind: 'xuanyuan', tier: 4, spirit: 'abyss', cd: 0.5 },
      { kind: 'wuhuo', tier: 4, spirit: 'gale', cd: 0.5 },
      { kind: 'kunxian', tier: 3, spirit: null, cd: 0.5 },
    ]; // 测试里借多的位置，把 8 件都跑到
    p.stats.maxHp = 5000;
    p.hp = 4000; // 开局先缺一截血：青莲结界一定回得出血（heal 事件），不靠这一局碰巧挨打
    const ev: SimEvent[] = [];
    for (let i = 0; i < 60 * 40; i++) ev.push(...step(w, [botInput(w, 0)], w.phase === 'shop' ? botShop(w, 0) : []));
    const kinds = new Set(ev.map((e) => (e.t === 'hit' ? `hit:${e.by}` : e.t === 'zone' ? `zone:${e.zone}` : e.t)));
    return { d: `${digest(w)}|${w.zones.length}|${w.knives.length}|${ev.length}`, kinds };
  };
  const a = play(92);
  const b = play(92);
  assert.equal(a.d, b.d);
  for (const k of ['hit:lash', 'hit:slash', 'hit:gust', 'hit:beam', 'hit:tide', 'hit:wave', 'hit:bird', 'hit:rope', 'mist', 'heal', 'lash', 'zone:whirl', 'zone:lotus', 'zone:water', 'zone:scorch', 'zone:rope', 'zoneEnd'])
    assert.ok(a.kinds.has(k), `这一局走到了 ${k}`);
  assert.notEqual(play(93).d, a.d);
});

// ---------- 小工具自查 ----------

test('区域伤害不打印记：水域、荆棘、焦土、旋风期间的伤害（by zone）不留印记，光束 / 火浪 / 鞭子 / 金绳会留', () => {
  const { w, p } = arena(74, [{ kind: 'xuanyuan', tier: 1 }]);
  const e = enemy(w, 'soldier', p.x + 80, p.y, 9999);
  e.mark = 'fire';
  e.markT = 99;
  run(w, 0.05);
  // 水柱是直接命中：火印被换成水印
  assert.equal(e.mark, 'water');
  e.mark = 'fire';
  e.markT = 99;
  p.weapons = [];
  run(w, 1);
  assert.equal(e.mark, 'fire', '水域的持续伤害不改印记');
  const marks = (k: WeaponKind, el: string) => {
    const a = arena(75, [{ kind: k, tier: 1 }]);
    const t: Enemy = enemy(a.w, 'soldier', a.p.x + 50, a.p.y, 9999);
    run(a.w, 1);
    assert.equal(t.mark, el, `${k} 留下${el}印`);
  };
  marks('yinyang', 'water');
  marks('wuhuo', 'fire');
  marks('dashen', 'metal');
  marks('kunxian', 'earth');
  marks('huaxue', 'metal');
});

// ---------- 和第一章新敌人的配合 ----------

test('新敌人：盾兵正面挡得住光束、火浪、血光斩、火鸟，挡不住从天抽下的鞭子、脚下的水柱、旋风、金绳；点着引信的爆符鬼卷不动、捆不住', () => {
  const { w, p } = arena(76);
  p.stats.crit = 0;
  const s = enemy(w, 'shieldbearer', p.x + 40, p.y, 99999);
  const from = { x: p.x, y: p.y - 8 };
  s.face = Math.atan2(from.y - (s.y - 7), from.x - s.x); // 盾正对着人物
  const dmgOf = (by: HitBy) => {
    const ev: SimEvent[] = [];
    buildGrid(w.enemies);
    hitEnemy(w, s, { dmg: 100, by, owner: 0, from, canCrit: false }, ev);
    const h = ev.find((e) => e.t === 'hit');
    return h && h.t === 'hit' ? h.dmg : 0;
  };
  for (const by of ['beam', 'wave', 'slash', 'bird'] as const) assert.ok(dmgOf(by) <= 30, `正面的 ${by} 被盾挡下大半`);
  for (const by of ['lash', 'tide', 'gust', 'rope'] as const) assert.equal(dmgOf(by), 100, `${by} 不吃正面减伤`);
  // 点着了引信的爆符鬼：无敌、不吃控制 —— 旋风卷不动、金绳捆不住
  const lit = (wpn: WeaponKind) => {
    const a = arena(77, [{ kind: wpn, tier: 1 }]);
    const g = pack(a.w, a.p.x + 90, a.p.y, 3, 9999, 12);
    const b = enemy(a.w, 'bomber', a.p.x + 90, a.p.y + 14, 9999);
    b.act = 'fuse';
    b.actT = 5;
    b.invuln = 5;
    a.w.enemies.forEach((e) => (e.speed = 0));
    run(a.w, 0.3);
    return { w: a.w, b, g };
  };
  const wh = lit('dingfeng');
  const whirl = zonesOf(wh.w, 'whirl')[0];
  assert.ok(whirl && !whirl.ids!.includes(wh.b.id) && whirl.ids!.length > 0, '旋风不卷点着的爆符鬼');
  const ro = lit('kunxian');
  const rope = zonesOf(ro.w, 'rope')[0];
  assert.ok(!rope || !rope.ids!.includes(ro.b.id), '金绳捆不住点着的爆符鬼');
});

test('首领战：挑落点 / 方向时首领优先 —— 水旗、旋风落在首领身上，扇面朝首领，不去追它召来的小兵', () => {
  for (const k of ['xuanyuan', 'dingfeng'] as WeaponKind[]) {
    const { w, p } = arena(78, [{ kind: k, tier: 1 }]);
    pack(w, p.x - 90, p.y, 4, 9999, 10); // 一小撮小兵
    const boss = enemy(w, 'boss', p.x + 100, p.y, 1e7);
    const ev = run(w, 0.05);
    const z = evs(ev, 'zone')[0];
    assert.ok(z && Math.hypot(z.x - boss.x, z.y - boss.y) < 1, `${k} 落在首领身上`);
  }
  for (const k of ['wuhuo', 'yinyang', 'huaxue'] as WeaponKind[]) {
    const { w, p } = arena(79, [{ kind: k, tier: 1 }]);
    pack(w, p.x - 40, p.y, 3, 9999, 8);
    const boss = enemy(w, 'boss', p.x + 44, p.y, 1e7);
    const ev = run(w, 0.8);
    assert.ok(hitsOn(ev, boss.id).length >= 1, `${k} 朝首领出手`);
  }
});
