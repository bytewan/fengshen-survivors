// 角色框架与杨戬（sim/heroes/、sim/pet.ts、sim/pets/xiaotian.ts）的模拟测试：
// 按角色给起手（专属法宝、宠物种类、开局亲和），中途加入也一样；神通、被动、宠物按角色分派、哪吒的照旧；
// 三尖两刃刀凡 → 神的招式（横扫接刺、仙品劈山、器灵开天 / 回锋），只在杨戬的商店里刷；天眼定身 + 标记、首领不吃定身；
// 乘隙（暴击后加速）只有杨戬有；哮天犬不造成伤害、只上破甲、冲过去咬一口就走、不离主人太远；破甲的盾卫挡不住；
// 存档恢复后接着跑逐帧相同；同种子同输入完全确定。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, digest, spawnEnemy, step, type PlayerInput, type SimEvent, type World } from './world.ts';
import { DT, PLAYER, SKILL } from './config.ts';
import { COMMON_WEAPONS, HEROES, LINGZHU, PET_BRANCH, RUSH, WEAPONS, shopWeapons } from './catalog.ts';
import { buildGrid, hitEnemy } from './core.ts';
import { GAZE, SANJIAN } from './heroes/yangjian.ts';
import { castSkill, skillInfo } from './heroes/index.ts';
import { PET_KINDS, petKindOf, XIAOTIAN } from './pet.ts';
import { petEvolveOffer, restock } from './shop.ts';
import { addPlayer } from './roster.ts';
import { botInput, botShop } from './bot.ts';
import { canonicalText, restore, snapshot } from './snapshot.ts';
import type { EnemyKindName, HeroId, SkillId } from './types.ts';

const idle: PlayerInput = { mx: 0, my: 0, skill: false };
type Ev<T extends SimEvent['t']> = Extract<SimEvent, { t: T }>;
const evs = <T extends SimEvent['t']>(ev: SimEvent[], t: T) => ev.filter((e): e is Ev<T> => e.t === t);
const run = (w: World, seconds: number, input: (w: World) => PlayerInput = () => idle) => {
  const events: SimEvent[] = [];
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) events.push(...step(w, [input(w)]));
  return events;
};
/** 干净的测试场：普通波、刷怪关掉、人物无敌；宠物默认不出手。 */
const arena = (hero: HeroId, opts: { tier?: number; spirit?: string | null; pet?: boolean } = {}) => {
  const w = createWorld(11, 1, [hero]);
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
  p.stats.crit = 0; // 默认不暴击（要测暴击的自己打开）
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

// ---------------------------------------------------------------- 角色表与起手

test('角色表：每个角色都有名字、主五行、专属法宝（标着属于他、和主五行同一行）、宠物种类、神通；神通的说明都有', () => {
  for (const id of Object.keys(HEROES) as HeroId[]) {
    const h = HEROES[id];
    assert.ok(h.name && h.pet && h.petDesc, id);
    assert.equal(WEAPONS[h.exclusive].exclusive, id, `${id} 的专属法宝`);
    assert.equal(WEAPONS[h.exclusive].el, h.el, `${id} 的专属法宝属于主五行`);
    assert.ok(PET_KINDS[h.petKind], `${id} 的宠物种类`);
    const s = skillInfo(h.skill);
    assert.ok(s.name && s.desc, `${id} 的神通说明`);
  }
  assert.equal(HEROES.yangjian.el, 'metal');
  assert.ok(HEROES.yangjian.passive?.desc.includes('疾进'));
  for (const k of Object.keys(PET_KINDS) as (keyof typeof PET_KINDS)[]) for (const b of PET_KINDS[k].branches) assert.ok(PET_BRANCH[b].name && PET_BRANCH[b].desc, `${k} 的进化 ${b}`);
  // 神通说明：一句意象，不报充能只数（用户 2026-11-12）
  assert.ok(skillInfo('santou').desc.includes('乾坤圈') && !/\d/.test(skillInfo('santou').desc));
  assert.ok(skillInfo('gaze' as SkillId).desc.includes('定'));
});

test('起手按角色给：杨戬拿凡品三尖两刃刀、带哮天犬（蹲在脚边）、金行亲和 +10%；哪吒照旧；中途加入的杨戬也一样', () => {
  const w = createWorld(3, 2, ['yangjian', 'nezha']);
  const [y, n] = w.players;
  assert.equal(y.hero, 'yangjian');
  assert.deepEqual(y.weapons.map((x) => [x.kind, x.tier]), [['sanjian', 1]]);
  assert.equal(petKindOf(y), 'xiaotian');
  assert.ok(Math.abs(y.pet.y - (y.y + XIAOTIAN.band.rest * Math.sin(XIAOTIAN.band.down))) < 1e-9, '狗在地上（身后的距离带里），不像混天绫飘在半空');
  assert.ok(Math.abs(y.stats.aff.metal - 0.1) < 1e-9 && y.stats.aff.fire === 0);
  assert.deepEqual(n.weapons.map((x) => x.kind), ['qiankun']);
  assert.equal(petKindOf(n), 'huntian');
  assert.ok(Math.abs(n.stats.aff.fire - 0.1) < 1e-9);
  // 不给角色就是哪吒（原来的 createWorld(seed, n) 照常用）
  assert.equal(createWorld(3).players[0].hero, 'nezha');
  // 中途加入（商店阶段）
  const c = createWorld(5);
  c.phase = 'shop';
  const j = addPlayer(c, 'yangjian')!;
  assert.ok(j);
  assert.deepEqual(j.weapons.map((x) => x.kind), ['sanjian']);
  assert.equal(petKindOf(j), 'xiaotian');
});

test('专属法宝只在角色本人的商店里刷：杨戬的货架不出乾坤圈，哪吒的不出三尖两刃刀；三尖两刃刀不在公共池里', () => {
  assert.ok(!COMMON_WEAPONS.includes('sanjian') && !shopWeapons().includes('sanjian'));
  for (const hero of ['nezha', 'yangjian'] as HeroId[]) {
    const w = createWorld(7, 1, [hero]);
    w.phase = 'shop';
    const p = w.players[0];
    p.weapons[0].tier = 3; // 仙品：同名件、碎片、器灵都可能上架
    p.stats.luck = 0;
    for (let i = 0; i < 200; i++) {
      w.wave = 1 + (i % 17);
      p.locked = [false, false, false, false];
      restock(w, p);
      for (const o of p.shop) {
        if (!o || (o.cat !== 'weapon' && o.cat !== 'spirit')) continue;
        if (WEAPONS[o.kind].exclusive) assert.equal(WEAPONS[o.kind].exclusive, hero, `${hero} 的货架上出了 ${o.kind}`);
      }
    }
  }
});

test('宠物进化按种类：哮天犬两条路是天狗、金牙；混天绫照旧是缚龙、火绫', () => {
  const w = createWorld(1, 2, ['yangjian', 'nezha']);
  for (const p of w.players) p.level = 5;
  assert.deepEqual(petEvolveOffer(w.players[0]), ['pounce', 'fang']);
  assert.deepEqual(petEvolveOffer(w.players[1]), ['bind', 'fire']);
});

// ---------------------------------------------------------------- 三尖两刃刀

test('三尖两刃刀凡品：先一记横扫（扇面里的都挨一下），约 0.2 秒后朝前一刺（贯穿一串）；够不着就不出手', () => {
  const { w, p } = arena('yangjian');
  // 身前一串、身后一只（横扫只扫身前那一边）
  const front = [enemy(w, 'soldier', p.x + 24, p.y), enemy(w, 'soldier', p.x + 40, p.y + 3), enemy(w, 'soldier', p.x + 62, p.y - 2)];
  const back = enemy(w, 'soldier', p.x - 30, p.y);
  const ev = run(w, 0.5);
  const cl = evs(ev, 'cleave');
  const st = evs(ev, 'stab');
  assert.equal(cl.length, 1, '一记横扫');
  assert.equal(st.length, 1, '接一刺');
  assert.ok(Math.abs(cl[0].a) < 0.5, '朝敌人那一边扫');
  const tSweep = ev.indexOf(cl[0]);
  const tStab = ev.indexOf(st[0]);
  assert.ok(tStab > tSweep);
  const by = (by: string) => new Set(evs(ev, 'hit').filter((h) => h.by === by).map((h) => h.id));
  assert.ok(by('cleave').has(front[0].id) && by('cleave').has(front[1].id), '近的两只挨了横扫');
  assert.ok(!by('cleave').has(back.id), '身后的那只没挨');
  assert.ok(by('stab').has(front[2].id), '远一点的那只挨了刺（刺得比扫得远）');
  assert.equal(evs(ev, 'chop').length, 0, '凡品没有劈山');
  // 够不着：只有离得很远的敌人时不出手
  const far = arena('yangjian');
  enemy(far.w, 'soldier', far.p.x + 125, far.p.y);
  assert.equal(evs(run(far.w, 0.6), 'cleave').length, 0);
});

test('三尖两刃刀升阶：灵品扫得更宽、刺得更远；仙品刺完劈山（地上裂一道，裂缝上的挨一下、顿一顿，首领不顿）；神品开天三道、回锋来回两刀连刺两下', () => {
  const S = SANJIAN;
  assert.ok(S.sweep.r[2] > S.sweep.r[1] && S.sweep.arc[2] > S.sweep.arc[1] && S.stab.len[2] > S.stab.len[1] && S.stab.pierce[2] > S.stab.pierce[1]);
  // 仙品：劈山
  const t3 = arena('yangjian', { tier: 3 });
  const a = enemy(t3.w, 'soldier', t3.p.x + 30, t3.p.y);
  const far = enemy(t3.w, 'soldier', t3.p.x + 100, t3.p.y + 2); // 刺不到、劈得到
  const ev3 = run(t3.w, 0.7);
  const chops = evs(ev3, 'chop');
  assert.equal(chops.length, 1, '仙品劈一道');
  assert.ok(Math.hypot(chops[0].x1 - t3.p.x, chops[0].y1 - t3.p.y) <= 145 + 1e-6, '裂缝不超过 REACH.max');
  const chopHits = evs(ev3, 'hit').filter((h) => h.by === 'chop').map((h) => h.id);
  assert.ok(chopHits.includes(far.id), '裂缝上远处的那只也挨了');
  assert.ok(chopHits.includes(a.id));
  // 首领挨劈不顿
  const tb = arena('yangjian', { tier: 3 });
  const boss = enemy(tb.w, 'boss', tb.p.x + 40, tb.p.y, 99999);
  run(tb.w, 0.7);
  assert.equal(boss.stun, 0, '首领不吃劈山的定身');
  // 神品开天：三道
  const t4 = arena('yangjian', { tier: 4, spirit: 'rift' });
  enemy(t4.w, 'soldier', t4.p.x + 30, t4.p.y);
  const ev4 = run(t4.w, 0.7);
  assert.equal(evs(ev4, 'chop').length, 3, '开天一劈三道');
  // 神品回锋：前后两刀、两刺
  const t5 = arena('yangjian', { tier: 4, spirit: 'edge' });
  enemy(t5.w, 'soldier', t5.p.x + 30, t5.p.y);
  const ev5 = run(t5.w, 0.9);
  const cl5 = evs(ev5, 'cleave');
  assert.equal(cl5.length, 2, '回锋：横扫之后反手再扫一刀');
  assert.ok(!cl5[0].back && cl5[1].back && cl5[0].dir === -cl5[1].dir, '反手那一刀方向相反');
  assert.deepEqual(evs(ev5, 'stab').map((s) => s.seq), [1, 2], '连刺两下');
  assert.equal(evs(ev5, 'chop').length, 1, '神品也劈山');
});

test('三尖两刃刀的射程守规矩：横扫、刺都不超过 REACH（索敌 130、效果最远 145），范围加成再大也一样', () => {
  const { w, p } = arena('yangjian', { tier: 4, spirit: 'rift' });
  p.stats.area = 3; // 很大的范围加成
  enemy(w, 'soldier', p.x + 30, p.y);
  const ev = run(w, 0.8);
  for (const c of evs(ev, 'cleave')) assert.ok(c.r <= 130 + 1e-6, `横扫半径 ${c.r}`);
  for (const s of evs(ev, 'stab')) assert.ok(Math.hypot(s.x1 - p.x, s.y1 - p.y) <= 145 + 1e-6, '刺');
  for (const c of evs(ev, 'chop')) assert.ok(Math.hypot(c.x1 - p.x, c.y1 - p.y) <= 145 + 1e-6, '劈');
});

// ---------------------------------------------------------------- 天眼

test('天眼：金光在 dur 秒里扫过身前的扇面，照到的敌人定身约 1.5 秒、被标记（之后受伤 +40%）；扇面外的不受影响；首领只被标记不定身', () => {
  const { w, p } = arena('yangjian');
  p.weapons = [];
  const inFan = [enemy(w, 'soldier', p.x + 50, p.y - 20), enemy(w, 'soldier', p.x + 70, p.y + 10), enemy(w, 'soldier', p.x + 40, p.y + 30)];
  const behind = enemy(w, 'soldier', p.x - 50, p.y);
  const boss = enemy(w, 'boss', p.x + 90, p.y - 5, 99999);
  p.skill = 1;
  const ev = run(w, 0.05, () => ({ mx: 0, my: 0, skill: true }));
  const sk = evs(ev, 'skill');
  assert.equal(sk.length, 1);
  assert.equal(sk[0].kind, 'gaze');
  assert.ok(sk[0].radius <= 145);
  assert.ok(p.gaze, '开始扫');
  assert.equal(p.skill, 0, '真气耗尽');
  const ev2 = run(w, GAZE.dur + 0.1);
  assert.ok(!p.gaze, '扫完了');
  for (const e of inFan) {
    assert.ok(e.gazeUntil !== undefined && e.gazeUntil > w.time, `${e.id} 被标记`);
    assert.ok(e.stun > GAZE.stun - GAZE.dur - 0.3, `${e.id} 还定着`);
  }
  assert.equal(behind.gazeUntil, undefined, '身后的不受影响');
  assert.equal(behind.stun, 0);
  assert.ok(boss.gazeUntil !== undefined, '首领被标记');
  assert.equal(boss.stun, 0, '首领不吃定身');
  const hit = evs([...ev, ...ev2], 'hit').filter((h) => h.by === 'skill');
  assert.equal(new Set(hit.map((h) => h.id)).size, hit.length, '一扫一只只中一次');
  // 标记：受伤 +40%
  const plain = enemy(w, 'soldier', p.x + 200, p.y + 200);
  const marked = inFan[0];
  buildGrid(w.enemies);
  const d0 = hitEnemy(w, plain, { dmg: 100, by: 'ring', owner: 0, from: p, canCrit: false }, []);
  const d1 = hitEnemy(w, marked, { dmg: 100, by: 'ring', owner: 0, from: p, canCrit: false }, []);
  assert.equal(d0, 100);
  assert.equal(d1, Math.round(100 * (1 + GAZE.mark)));
});

test('天眼自动朝敌人最多的方向扫（首领算好几只）；身边没有敌人就朝面朝的方向', () => {
  const { w, p } = arena('yangjian');
  p.weapons = [];
  p.facing = 1;
  for (let i = 0; i < 5; i++) enemy(w, 'soldier', p.x - 40 - i * 6, p.y + (i % 2) * 8);
  enemy(w, 'soldier', p.x + 40, p.y);
  castSkill(w, p, []);
  assert.ok(Math.cos(p.gaze!.a0 + (p.gaze!.a1 - p.gaze!.a0) / 2) < 0, '朝左边那一群');
  assert.equal(p.facing, -1, '转身朝着扫的方向');
  const e2 = arena('yangjian');
  e2.p.weapons = [];
  e2.p.facing = -1;
  castSkill(e2.w, e2.p, []);
  assert.ok(Math.cos((e2.p.gaze!.a0 + e2.p.gaze!.a1) / 2) < 0, '没有敌人：朝面朝的方向');
});

test('神通按角色分派：哪吒放的还是三头六臂（八枚乾坤圈），杨戬放的是天眼（不掷圈）', () => {
  const n = arena('nezha');
  n.p.skill = 1;
  const evN = run(n.w, 0.05, () => ({ mx: 0, my: 0, skill: true }));
  assert.equal(evs(evN, 'skill')[0].kind, undefined);
  assert.equal(n.w.rings.length, 8);
  const y = arena('yangjian');
  y.p.skill = 1;
  const evY = run(y.w, 0.05, () => ({ mx: 0, my: 0, skill: true }));
  assert.equal(evs(evY, 'skill')[0].kind, 'gaze');
  assert.equal(y.w.rings.length, 0);
});

// ---------------------------------------------------------------- 被动「乘隙」

test('乘隙：杨戬暴击之后 1 秒内走得快 20%，过了就恢复；哪吒暴击不加速', () => {
  const { w, p } = arena('yangjian');
  p.weapons = [];
  const e = enemy(w, 'soldier', p.x + 300, p.y + 200);
  p.stats.crit = 1; // 必定暴击
  const walk = () => {
    const x0 = p.x;
    run(w, 0.25, () => ({ mx: 1, my: 0, skill: false }));
    return p.x - x0;
  };
  const base = walk();
  buildGrid(w.enemies);
  hitEnemy(w, e, { dmg: 1, by: 'ring', owner: 0, from: p }, []);
  assert.ok(p.rushUntil !== undefined && Math.abs(p.rushUntil - (w.time + RUSH.t)) < 1e-9);
  const fast = walk();
  assert.ok(Math.abs(fast / base - (1 + RUSH.speed)) < 0.02, `加速 ${fast / base}`);
  run(w, RUSH.t);
  assert.ok(Math.abs(walk() / base - 1) < 0.02, '过了就恢复');
  const n = arena('nezha');
  n.p.stats.crit = 1;
  const en = enemy(n.w, 'soldier', n.p.x + 300, n.p.y);
  buildGrid(n.w.enemies);
  hitEnemy(n.w, en, { dmg: 1, by: 'ring', owner: 0, from: n.p }, []);
  assert.equal(n.p.rushUntil, undefined, '哪吒没有这个被动');
  void PLAYER;
});

// ---------------------------------------------------------------- 哮天犬

test('哮天犬：不造成伤害、只上破甲（受伤加深、带土行印记、咬上那一下顿一顿）；冲过敌群咬一口就走，不停在敌人身上，也不离主人太远', () => {
  const { w, p } = arena('yangjian', { pet: true });
  p.weapons = [];
  // 狗在主人身后约 44 像素，出手范围以狗为圆心 90：敌群放在主人身前 25–43 像素（离狗 70–90）
  const pack = Array.from({ length: 6 }, (_, i) => enemy(w, 'soldier', p.x + 25 + (i % 3) * 9, p.y - 10 + Math.floor(i / 3) * 12));
  const modes = new Set<string>();
  let maxD = 0;
  let stick = 0; // 狗在某只敌人身上停着不动的帧数
  const ev: SimEvent[] = [];
  for (let i = 0; i < 60 * 8; i++) {
    ev.push(...step(w, [idle]));
    modes.add(p.pet.mode);
    maxD = Math.max(maxD, Math.hypot(p.pet.x - p.x, p.pet.y - p.y));
    const sp = Math.hypot(p.pet.vx, p.pet.vy);
    if (sp < 10 && pack.some((e) => Math.hypot(e.x - p.pet.x, e.y - p.pet.y) < 8)) stick++;
  }
  assert.equal(evs(ev, 'hit').length, 0, '宠物不打伤害');
  const bites = evs(ev, 'bite');
  assert.ok(bites.length >= 2, `一趟一趟地咬（${bites.length} 口）`);
  assert.ok(modes.has('sweep') && modes.has('follow'));
  assert.ok(maxD <= XIAOTIAN.band.leash + 1e-6, `离主人最远 ${maxD.toFixed(1)}`);
  assert.equal(stick, 0, '不停在敌人身上');
  const bitten = pack.filter((e) => e.sunderUntil !== undefined);
  assert.ok(bitten.length >= XIAOTIAN.targets[0], `被咬的有 ${bitten.length} 只`);
  for (const e of bitten) {
    assert.ok(e.sunder! >= XIAOTIAN.sunder[0]);
    if (e.sunderUntil! > w.time && e.markT > 0) assert.equal(e.mark, 'earth', '土行印记（哮天犬是土行宠物，用户 11-12）');
  }
  // 破甲期间受伤加深
  const e = bitten.find((x) => x.sunderUntil! > w.time) ?? bitten[0];
  e.sunderUntil = w.time + 5;
  const fresh = enemy(w, 'soldier', p.x + 300, p.y + 300);
  buildGrid(w.enemies);
  const d0 = hitEnemy(w, fresh, { dmg: 100, by: 'ring', owner: 0, from: p, canCrit: false }, []);
  const d1 = hitEnemy(w, e, { dmg: 100, by: 'ring', owner: 0, from: p, canCrit: false }, []);
  assert.equal(d1, Math.round(d0 * (1 + e.sunder!)));
});

test('破甲的盾卫：正面也挡不住；金牙那条路：破甲期间金行伤害更高、更容易被暴击；天狗：咬上先按住', () => {
  const { w, p } = arena('yangjian');
  // 盾卫：盾朝着人物，正面打过去平常减伤，破甲之后全额
  const s = enemy(w, 'shieldbearer', p.x + 30, p.y);
  s.face = Math.PI; // 盾朝左（朝着人物）
  buildGrid(w.enemies);
  const guarded = hitEnemy(w, s, { dmg: 100, by: 'ring', owner: 0, from: { x: p.x, y: p.y - 7 }, canCrit: false }, []);
  assert.ok(guarded < 100, `正面有盾：${guarded}`);
  s.sunder = 0.35;
  s.sunderUntil = w.time + 3;
  const broken = hitEnemy(w, s, { dmg: 100, by: 'ring', owner: 0, from: { x: p.x, y: p.y - 7 }, canCrit: false }, []);
  assert.equal(broken, Math.round(100 * 1.35), '破甲：盾挡不住，再加深');
  // 金牙
  const f = enemy(w, 'soldier', p.x + 60, p.y);
  f.sunder = 0.35;
  f.fang = 0.4;
  f.sunderUntil = w.time + 3;
  buildGrid(w.enemies);
  const metal = hitEnemy(w, f, { dmg: 100, by: 'stab', owner: 0, from: p, canCrit: false, el: 'metal' }, []);
  const fire = hitEnemy(w, f, { dmg: 100, by: 'thrust', owner: 0, from: p, canCrit: false, el: 'fire' }, []);
  assert.equal(metal, Math.round(100 * 1.35 * 1.4));
  assert.equal(fire, Math.round(100 * 1.35));
  // 天狗：咬上先按住（定身），首领不吃
  const t = arena('yangjian', { pet: true });
  t.p.weapons = [];
  t.p.pet.stage = 2;
  t.p.pet.branch = 'pounce';
  // 狗蹲在主人身后约 44 像素：敌人放在它的出手范围里（11-12 起出手范围以狗为圆心）
  const g = enemy(t.w, 'soldier', t.p.x + 30, t.p.y);
  const b = enemy(t.w, 'boss', t.p.x + 40, t.p.y + 4, 99999);
  let pinned = 0;
  for (let i = 0; i < 60 * 4; i++) {
    const ev = step(t.w, [idle]);
    for (const x of evs(ev, 'bite')) if (x.ids.includes(g.id)) pinned = Math.max(pinned, g.stun);
  }
  assert.ok(pinned >= XIAOTIAN.pounce.stun[2] - DT - 1e-9, `天狗按住 ${pinned}`); // 咬上的那一帧末尾敌人的状态已经走了一帧
  assert.equal(b.stun, 0, '首领不吃定身');
});

// ---------------------------------------------------------------- 存档与确定性

test('杨戬的一局：同种子同输入完全确定；中途存档恢复后接着跑逐帧相同（天眼扫到一半、刀的连招、狗冲到一半都存得下）', () => {
  const play = () => {
    const w = createWorld(77, 1, ['yangjian']);
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
  // 存档：等到天眼正在扫、刀的连招没走完、狗在冲的那一刻
  const w = createWorld(78, 1, ['yangjian']);
  w.players[0].skill = 1;
  let saved = false;
  for (let i = 0; i < 60 * 60 && !saved; i++) {
    const p = w.players[0];
    if (w.phase === 'wave' && p.gaze && (p.weapons[0].burst ?? 0) > 0) saved = true;
    else step(w, [{ ...botInput(w, 0), skill: w.enemies.length > 3 }], w.phase === 'shop' ? botShop(w, 0) : []);
  }
  if (!saved) {
    // 机器人没碰上这一刻：手动摆出来
    const p = w.players[0];
    for (let i = 0; i < 8; i++) enemy(w, 'soldier', p.x + 30 + i * 6, p.y + (i % 3) * 6 - 6, 500);
    p.skill = 1;
    step(w, [{ mx: 0, my: 0, skill: true }]);
  }
  const text = JSON.stringify(snapshot(w));
  const r = restore(JSON.parse(text));
  assert.equal(canonicalText(r), canonicalText(w));
  for (let i = 0; i < 240; i++) {
    const inp = botInput(w, 0);
    const ev1 = JSON.stringify(step(w, [inp], w.phase === 'shop' ? botShop(w, 0) : []));
    const ev2 = JSON.stringify(step(r, [botInput(r, 0)], r.phase === 'shop' ? botShop(r, 0) : []));
    assert.equal(ev2, ev1, `第 ${i + 1} 帧跑岔了`);
  }
  assert.equal(canonicalText(r), canonicalText(w));
});

test('哪吒「灵珠子」：打死敌人攒的真气 +LINGZHU.charge；杨戬没有这一条', () => {
  const got: Partial<Record<HeroId, number>> = {};
  for (const hero of ['nezha', 'yangjian'] as HeroId[]) {
    const w = createWorld(5, 1, { heroes: [hero] });
    const p = w.players[0];
    p.skill = 0;
    for (const [kind, n] of [['soldier', 3], ['elite', 1]] as [EnemyKindName, number][])
      for (let i = 0; i < n; i++) {
        const e = spawnEnemy(w, kind, 300 + i * 10, 300, []);
        buildGrid(w.enemies);
        hitEnemy(w, e, { dmg: 1e9, by: 'ring', owner: 0, from: { x: 290, y: 300 }, canCrit: false }, []);
      }
    got[hero] = p.skill;
  }
  const base = SKILL.chargePerKill * 3 + SKILL.chargePerElite;
  assert.ok(Math.abs(got.yangjian! - Math.min(1, base)) < 1e-9);
  assert.ok(Math.abs(got.nezha! - Math.min(1, base * (1 + LINGZHU.charge))) < 1e-9);
  assert.equal(HEROES.nezha.passive?.name, '灵珠子');
});
