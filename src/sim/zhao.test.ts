// 赵公明（sim/heroes/zhao.ts、sim/pets/heihu.ts、heroes/passives.ts 里的招财与震慑）的模拟测试：
// 起手按角色（凡品定海珠、黑虎、土行亲和）；定海珠只在他本人的商店里刷；
// 定海珠凡 → 神（凡一颗、灵两颗各砸一群、仙品石纹再震、器灵二十四珠绕成一圈依次砸下 / 镇海巨珠定身，首领不吃定身）、射程守规矩；
// 金鞭（鞭影举起再砸下一条线、线上的晕、金缝减速、迸出金元宝、首领不晕）；招财（灵石 +15%、经验照旧、别的角色不变）；
// 黑虎（不造成伤害、扑过敌群吼一声：被吓住的往外逃、打人轻一些、首领不吃、打断蓄力；啸风 / 破财；不离主人太远）；
// 存档恢复后接着跑逐帧相同；同种子同输入完全确定。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, digest, spawnEnemy, step, type PlayerInput, type SimEvent, type World } from './world.ts';
import { DT, ENEMIES, REACH } from './config.ts';
import { COMMON_WEAPONS, HEROES, PET_BRANCH, WEAPONS, ZHAOCAI, shopWeapons } from './catalog.ts';
import { DINGHAI, JINBIAN } from './heroes/zhao.ts';
import { hitEnemy } from './core.ts';
import { skillInfo } from './heroes/index.ts';
import { fearDmgMul, feared } from './heroes/passives.ts';
import { HEIHU, petKindOf } from './pet.ts';
import { petEvolveOffer, restock } from './shop.ts';
import { addPlayer } from './roster.ts';
import { botInput, botShop } from './bot.ts';
import { canonicalText, restore, snapshot } from './snapshot.ts';
import type { EnemyKindName } from './types.ts';

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
const arena = (opts: { tier?: number; spirit?: string | null; pet?: boolean } = {}) => {
  const w = createWorld(11, 1, ['zhao']);
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

test('赵公明的起手：凡品定海珠、黑虎卧在身后、土行亲和（按角色表，2026-11-11 起 +25%）、神通金鞭、被动招财；中途加入的也一样', () => {
  const w = createWorld(3, 1, ['zhao']);
  const p = w.players[0];
  assert.equal(HEROES.zhao.el, 'earth');
  assert.equal(WEAPONS.dinghai.exclusive, 'zhao');
  assert.equal(WEAPONS.dinghai.el, 'earth');
  assert.deepEqual(p.weapons.map((x) => [x.kind, x.tier]), [['dinghai', 1]]);
  assert.equal(petKindOf(p), 'heihu');
  assert.ok(Math.abs(p.stats.aff.earth - HEROES.zhao.affStart) < 1e-9 && p.stats.aff.fire === 0 && p.stats.aff.metal === 0);
  assert.ok(p.pet.x < p.x && Math.abs(p.pet.y - p.y) < 8, '黑虎在身后脚边');
  assert.equal(HEROES.zhao.skill, 'jinbian');
  assert.ok(skillInfo('jinbian').name === '金鞭' && skillInfo('jinbian').desc.includes('金元宝'));
  assert.ok(HEROES.zhao.passive?.name === '招财');
  // 联机中途加入
  const w2 = createWorld(4, 1, ['nezha']);
  w2.phase = 'shop';
  const j = addPlayer(w2, 'zhao', []);
  assert.ok(j);
  assert.equal(j.weapons[0].kind, 'dinghai');
  assert.equal(petKindOf(j), 'heihu');
});

test('定海珠只在赵公明的商店里刷，不在公共池里；黑虎的两条路是啸风、破财', () => {
  assert.ok(!COMMON_WEAPONS.includes('dinghai') && !shopWeapons().includes('dinghai'));
  for (const hero of ['nezha', 'yangjian', 'zhao'] as const) {
    const w = createWorld(7, 1, [hero]);
    w.phase = 'shop';
    const p = w.players[0];
    p.weapons[0].tier = 3;
    p.stats.luck = 0;
    let mine = 0;
    for (let i = 0; i < 200; i++) {
      w.wave = 1 + (i % 17);
      p.locked = [false, false, false, false];
      restock(w, p);
      for (const o of p.shop) {
        if (!o || (o.cat !== 'weapon' && o.cat !== 'spirit')) continue;
        if (o.kind === 'dinghai') {
          assert.equal(hero, 'zhao', `${hero} 的货架上出了定海珠`);
          mine++;
        }
      }
    }
    if (hero === 'zhao') assert.ok(mine > 0, '赵公明自己的货架上刷得到定海珠');
  }
  const w = createWorld(1, 1, ['zhao']);
  w.players[0].level = 5;
  assert.deepEqual(petEvolveOffer(w.players[0]), ['gale', 'broke']);
  assert.ok(PET_BRANCH.gale.name && PET_BRANCH.broke.name);
});

// ---------------------------------------------------------------- 定海珠

test('定海珠凡品：一颗珠子飞出去（先发 bead，约 0.42 秒后落地），砸在敌群里：落点一圈的挨一下、晕一下、被往外震开；够不着就不出手', () => {
  const { w, p } = arena();
  const near = [enemy(w, 'soldier', p.x + 60, p.y), enemy(w, 'soldier', p.x + 70, p.y + 6), enemy(w, 'soldier', p.x + 64, p.y - 8)];
  const off = enemy(w, 'soldier', p.x - 60, p.y + 40); // 另一边、单独一只：不是最密的那一群
  const x0 = near.map((e) => e.x);
  const ev = run(w, 0.3);
  const b = evs(ev, 'bead');
  assert.equal(b.length, 1, '凡品一次一颗');
  assert.ok(Math.hypot(b[0].x - (p.x + 64), b[0].y - p.y) < 20, '砸向最密的那一群');
  assert.equal(evs(ev, 'land').length, 0, '还在飞');
  const ev2 = run(w, 0.25);
  assert.equal(evs(ev2, 'land').filter((l) => l.kind === 'bead').length, 1);
  const got = hitIds(ev2, 'bead');
  for (const e of near) assert.ok(got.has(e.id), '那一群都挨了');
  assert.ok(!got.has(off.id));
  assert.ok(near.every((e) => e.stun > 0), '晕一下');
  run(w, 0.2);
  assert.ok(near.some((e, i) => Math.abs(e.x - x0[i]) > 2), '被震开');
  // 够不着
  const far = arena();
  enemy(far.w, 'soldier', far.p.x + REACH.seek + 20, far.p.y);
  assert.equal(evs(run(far.w, 0.6), 'bead').length, 0);
});

test('定海珠升阶：灵品一次两颗各砸一群、圈更大；仙品落地留下石纹，片刻后再震一次（发 warn，再 land quake）；首领不晕', () => {
  const D = DINGHAI;
  assert.ok(D.r[2] > D.r[1] && D.volley[2] > D.volley[1] && D.orbit[2] > D.orbit[1]);
  // 灵品：两群各一颗
  {
    const { w, p } = arena({ tier: 2 });
    for (const [dx, dy] of [[60, -30], [66, -24], [60, 34], [68, 40]]) enemy(w, 'soldier', p.x + dx, p.y + dy);
    const b = evs(run(w, 0.2), 'bead');
    assert.equal(b.length, 2);
    assert.ok(Math.abs(b[0].y - b[1].y) > 30, '两颗砸在两群里');
  }
  // 仙品：落地之后再震
  {
    const { w, p } = arena({ tier: 3 });
    const e = enemy(w, 'soldier', p.x + 60, p.y);
    const boss = enemy(w, 'boss', p.x + 90, p.y + 30);
    const ev = run(w, 0.6);
    const warn = evs(ev, 'warn').filter((x) => x.kind === 'bead');
    const landed = evs(ev, 'land').filter((x) => x.kind === 'bead' && !x.quake);
    assert.ok(warn.length >= 1 && warn.length === landed.length, '每颗落地的都留一圈石纹');
    assert.ok(Math.abs(warn[0].t2 - D.after.delay) < 1e-9);
    assert.equal(boss.stun, 0, '首领不晕');
    // 石纹这一圈里后走进来的也挨再震（站到第一圈石纹的圆心上）
    const late = enemy(w, 'soldier', warn[0].x, warn[0].y);
    const ev2 = run(w, D.after.delay + 0.05);
    const quake = evs(ev2, 'land').filter((x) => x.kind === 'bead' && x.quake);
    assert.equal(quake.length, warn.length, '每圈石纹各再震一次');
    assert.ok(hitIds(ev2, 'bead').has(late.id) && late.stun > 0, '后走进来的也挨再震');
    void e;
    assert.ok(Math.abs(quake[0].r - warn[0].r) < 1e-9 && warn[0].r > D.r[3]);
  }
});

test('定海珠神品：二十四珠绕着敌群围成一圈依次砸下（24 颗，先后错开），砸完整圈再震；上一圈没砸完不出下一圈；镇海一颗巨珠、定身更久，首领只吃伤害', () => {
  const D = DINGHAI;
  {
    const { w, p } = arena({ tier: 4, spirit: 'rosary' });
    const pack = [enemy(w, 'soldier', p.x + 70, p.y), enemy(w, 'soldier', p.x + 76, p.y + 6), enemy(w, 'soldier', p.x + 66, p.y - 6)];
    const ev = run(w, 0.05);
    const b = evs(ev, 'bead');
    assert.equal(b.length, D.rosary.n);
    assert.ok(b.every((x, i) => x.spirit === 'rosary' && x.seq === i + 1));
    assert.ok(b[23].t2 > b[0].t2 + 0.7, '依次砸下');
    const cx = b[0].cx!;
    const cy = b[0].cy!;
    assert.ok(Math.hypot(cx - (p.x + 70), cy - p.y) < 12, '围着那一群');
    for (const x of b) assert.ok(Math.abs(Math.hypot(x.x - cx, (x.y - cy) / D.rosary.flat) - D.rosary.R) < 0.5, '绕成一圈');
    // 圈上摆一只（被珠子砸到），圈里那一群挨整圈的再震
    const ring = enemy(w, 'soldier', cx - D.rosary.R, cy);
    const inside = pack[0];
    // 冷却早就好了，但整圈还没再震之前不出下一圈
    const ev2 = run(w, D.rosary.first + D.rosary.n * D.rosary.gap + D.rosary.delay - 0.15);
    assert.equal(evs(ev2, 'bead').length, 0, '上一圈没砸完，不出下一圈');
    assert.ok(hitIds(ev2, 'bead').has(ring.id), '圈上的挨了珠子');
    const ev3 = run(w, 0.3);
    const quake = evs(ev3, 'land').filter((x) => x.kind === 'bead' && x.quake);
    assert.equal(quake.length, 1, '整圈再震');
    assert.ok(evs(ev3, 'hit').some((h) => h.id === inside.id && h.by === 'bead'), '圈里的被整圈的再震震到');
    assert.equal(evs(ev3, 'bead').length, D.rosary.n, '砸完了才出下一圈');
  }
  {
    const { w, p } = arena({ tier: 4, spirit: 'anchor' });
    const e = enemy(w, 'soldier', p.x + 60, p.y);
    const boss = enemy(w, 'boss', p.x + 66, p.y + 6);
    const ev = run(w, 0.6);
    const b = evs(ev, 'bead');
    assert.equal(b.length, 1);
    assert.ok(b[0].spirit === 'anchor' && b[0].r > D.r[4], '一颗巨珠，压得更大');
    assert.ok(e.stun > D.stun[4] + 0.3, '定身更久');
    assert.equal(boss.stun, 0);
    const hb = evs(ev, 'hit').find((h) => h.id === boss.id && h.by === 'bead');
    const he = evs(ev, 'hit').find((h) => h.id === e.id && h.by === 'bead');
    assert.ok(hb && he && hb.dmg > he.dmg, '对首领的倍率');
  }
});

test('定海珠的射程守规矩：落点都在索敌半径里（敌人站在边上、范围加成再大也一样）', () => {
  for (const [tier, spirit] of [[1, null], [2, null], [3, null], [4, 'rosary'], [4, 'anchor']] as const) {
    const { w, p } = arena({ tier, spirit });
    p.stats.area = 2;
    for (let i = 0; i < 8; i++) enemy(w, 'soldier', p.x + Math.cos(i) * (REACH.seek - 4), p.y + Math.sin(i) * (REACH.seek - 4));
    const ev = run(w, 2.5);
    for (const b of evs(ev, 'bead')) assert.ok(Math.hypot(b.x - p.x, b.y - p.y) <= REACH.seek + 0.5, `${tier}${spirit ?? ''}：落在 ${Math.hypot(b.x - p.x, b.y - p.y).toFixed(0)} 像素外`);
    for (const x of evs(ev, 'warn')) assert.ok(Math.hypot(x.x - p.x, x.y - p.y) <= REACH.seek + 4);
  }
});

// ---------------------------------------------------------------- 金鞭

test('金鞭：鞭影举起约 0.34 秒后砸下一条线（朝敌人最多的方向），线上的挨一下、晕约 1 秒、首领只挨打；地上的金缝让踩上去的减速，到时合上；缝里迸出金元宝', () => {
  const { w, p } = arena();
  p.weapons = [];
  const line = [enemy(w, 'soldier', p.x + 30, p.y + 2), enemy(w, 'soldier', p.x + 60, p.y - 3), enemy(w, 'soldier', p.x + 95, p.y + 1)];
  const side = enemy(w, 'soldier', p.x - 40, p.y + 50);
  const boss = enemy(w, 'boss', p.x + 75, p.y);
  p.skill = 1;
  const ev = run(w, 0.1, () => ({ mx: 0, my: 0, skill: true }));
  const sk = evs(ev, 'skill');
  assert.equal(sk.length, 1);
  assert.equal(sk[0].kind, 'jinbian');
  assert.ok(Math.abs(sk[0].a ?? 9) < 0.3, '朝右边那一串砸');
  assert.equal(evs(ev, 'whip').length, 0, '还没砸下');
  assert.ok(p.whip && !p.whip.struck);
  const ev2 = run(w, JINBIAN.delay);
  const wh = evs(ev2, 'whip');
  assert.equal(wh.length, 1);
  for (const e of line) assert.ok(wh[0].ids.includes(e.id) && e.stun > 0.5, '线上的都砸中、晕了');
  assert.ok(!wh[0].ids.includes(side.id));
  assert.ok(wh[0].ids.includes(boss.id) && boss.stun === 0, '首领挨打不晕');
  assert.equal(wh[0].ingots.length, JINBIAN.ingots);
  const ingots = w.gems.filter((g) => g.ingot);
  assert.equal(ingots.length, JINBIAN.ingots);
  assert.ok(ingots.every((g) => g.value === JINBIAN.ingot));
  // 金缝：踩在缝上的减速
  line[1].stun = 0;
  run(w, 0.1);
  assert.ok(line[1].slow >= JINBIAN.crack.slow - 1e-9 && line[1].slowT > 0, '缝上的减速');
  run(w, JINBIAN.crack.life);
  assert.equal(p.whip, undefined, '金缝合上了');
});

test('招财：赵公明拾到的灵石 +15%（金元宝也算），经验照旧；哪吒拾到的不变', () => {
  const pick = (hero: 'zhao' | 'nezha') => {
    const w = createWorld(5, 1, [hero]);
    w.wave = 3;
    w.waveLen = 1e9;
    w.spawnAcc = -1e12;
    const p = w.players[0];
    for (let i = 0; i < 20; i++) w.gems.push({ id: w.nextId++, x: p.x + 3, y: p.y - 4, px: p.x + 3, py: p.y - 4, vx: 0, vy: 0, value: 1, pulled: -1 });
    run(w, 0.5);
    return { ls: p.lingshi + p.lingshiAcc, xp: p.xp + 0 };
  };
  const z = pick('zhao');
  const n = pick('nezha');
  assert.ok(Math.abs(n.ls - 20) < 1e-6, '哪吒 20');
  assert.ok(Math.abs(z.ls - 20 * (1 + ZHAOCAI.gem)) < 1e-6, `赵公明 ${z.ls}`);
  // 经验：两人都升过级（xp 归零重算）就比总经验；20 颗都不够升一级时直接比
  assert.ok(Math.abs(z.xp - n.xp) < 1e-6, '经验一样');
});

// ---------------------------------------------------------------- 黑虎

test('黑虎：不造成伤害；扑过敌群吼一声，半径里的敌人被震慑（先顿一下，再背着人物往外逃，打人的伤害降低，带木行印记）；首领不会被吓住', () => {
  const { w, p } = arena({ pet: true });
  p.weapons = [];
  p.pet.cd = 0;
  // 黑虎卧在主人身后约 46 像素，出手范围以它为圆心 75（11-12 起）：敌群放在主人身前约 20 像素（离黑虎 64–72）
  const pack = [enemy(w, 'soldier', p.x + 20, p.y), enemy(w, 'soldier', p.x + 26, p.y + 8), enemy(w, 'soldier', p.x + 18, p.y - 9)];
  for (const e of pack) e.speed = 30;
  const boss = enemy(w, 'boss', p.x + 30, p.y + 2);
  const hp0 = pack.map((e) => e.hp);
  const ev = run(w, 1.2);
  p.pet.cd = 1e12; // 只看这一吼
  const r = evs(ev, 'roar');
  assert.equal(r.length, 1, '吼了一声');
  assert.ok(Math.hypot(r[0].x - (p.x + 22), r[0].y - p.y) < 22, '扑到那一群中间才吼');
  for (const e of pack) {
    assert.ok(r[0].ids.includes(e.id), '那一群都被吓住');
    assert.equal(e.mark, 'wood'); // 黑虎是木行宠物（寅虎属木，用户 11-12）
  }
  assert.ok(!r[0].ids.includes(boss.id) && !feared(w, boss), '首领不会被吓住');
  assert.equal(boss.mark, 'wood', '首领只沾印记');
  assert.equal(evs(ev, 'hit').length, 0, '黑虎不造成伤害');
  assert.deepEqual(pack.map((e) => e.hp), hp0);
  const d0 = pack.map((e) => Math.hypot(e.x - p.x, e.y - p.y));
  // 震慑期间：打人的伤害打折、往外逃（离人物越来越远）
  assert.ok(pack.every((e) => feared(w, e) && fearDmgMul(w, e) < 1));
  run(w, 0.8);
  pack.forEach((e, i) => assert.ok(Math.hypot(e.x - p.x, e.y - p.y) > d0[i] + 8, `第 ${i} 只往外逃了`));
  // 吓完就恢复
  run(w, 2);
  assert.ok(pack.every((e) => !feared(w, e) && fearDmgMul(w, e) === 1));
  // 不离主人太远
  let far = 0;
  const { w: w2, p: p2 } = arena({ pet: true });
  p2.weapons = [];
  p2.pet.cd = 0;
  for (let i = 0; i < 10; i++) enemy(w2, 'soldier', p2.x + 40 + i * 6, p2.y + ((i % 3) - 1) * 14).speed = 40;
  run(w2, 6, (w) => {
    far = Math.max(far, Math.hypot(w.players[0].pet.x - w.players[0].x, w.players[0].pet.y - w.players[0].y));
    return idle;
  });
  assert.ok(far <= HEIHU.band.leash + 1, `离主人最远 ${far.toFixed(0)}`);
});

test('震慑打断蓄力：被吓住的长矛兵收枪、骑兵停下，吓住的这一会儿不起手；接触伤害打折', () => {
  const { w, p } = arena({ pet: true });
  p.weapons = [];
  const sp = enemy(w, 'spearman', p.x + 26, p.y);
  sp.speed = 30;
  sp.cd = 0;
  // 让它先起手蓄力（蓄力 0.5 秒）
  run(w, 0.05);
  assert.equal(sp.act, 'windup', '先在蓄力');
  // 黑虎就在它身边，马上扑过去吼它
  p.pet.cd = 0;
  p.pet.x = p.pet.px = p.x + 14;
  p.pet.y = p.pet.py = p.y + 2;
  const ev = run(w, 0.6);
  assert.ok(evs(ev, 'roar').some((r) => r.ids.includes(sp.id)));
  assert.notEqual(sp.act, 'strike');
  assert.equal(evs(ev, 'foeStrike').length, 0, '没刺出来');
  // 接触伤害：被吓住的贴脸也打得轻
  const w2 = createWorld(9, 1, ['zhao']);
  w2.wave = 3;
  w2.waveLen = 1e9;
  w2.spawnAcc = -1e12;
  const q = w2.players[0];
  q.weapons = [];
  q.pet.cd = 1e12;
  const e = enemy(w2, 'soldier', q.x + 4, q.y);
  e.fearUntil = w2.time + 5;
  e.fear = 0.5;
  e.fearDx = 1;
  e.fearDy = 0;
  const hurt = evs(run(w2, 0.05), 'hurt');
  const w3 = createWorld(9, 1, ['zhao']);
  w3.wave = 3;
  w3.waveLen = 1e9;
  w3.spawnAcc = -1e12;
  w3.players[0].weapons = [];
  w3.players[0].pet.cd = 1e12;
  enemy(w3, 'soldier', w3.players[0].x + 4, w3.players[0].y);
  const hurt2 = evs(run(w3, 0.05), 'hurt');
  assert.ok(hurt.length && hurt2.length && hurt[0].dmg < hurt2[0].dmg, `被吓住的打人轻（${hurt[0]?.dmg} < ${hurt2[0]?.dmg}）`);
});

test('黑虎进化：啸风吼声更大、多吓几只、把敌人吼退一步；破财：被吓住时被打死的多掉一颗灵石（几率），没走这条路的不动随机数', () => {
  const H = HEIHU;
  const roarR = (branch: 'gale' | 'broke' | null) => {
    const { w, p } = arena({ pet: true });
    p.weapons = [];
    p.pet.cd = 0;
    p.pet.stage = 1;
    p.pet.branch = branch;
    for (let i = 0; i < 12; i++) enemy(w, 'soldier', p.x + 12 + (i % 4) * 9, p.y + Math.floor(i / 4) * 10 - 10);
    return evs(run(w, 1.2), 'roar')[0];
  };
  const g = roarR('gale');
  const b = roarR('broke');
  assert.ok(g.r > b.r, '啸风的吼声更大');
  assert.ok(g.ids.length > b.ids.length, '啸风多吓几只');
  assert.ok(g.dur > b.dur, '啸风吓得更久');
  // 破财：被吓住时打死的，按几率多掉一颗灵石（多出来的那颗就在尸首旁边，照常去捡）；没被吓住的、没走这条路的不掉
  const w = createWorld(21, 1, ['zhao']);
  const p = w.players[0];
  const kill = (broke: number | undefined, scared: boolean) => {
    const e = enemy(w, 'soldier', p.x + 60, p.y, 5);
    if (scared) {
      e.fearUntil = w.time + 5;
      e.fearDx = 1;
      e.fearDy = 0;
    }
    if (broke !== undefined) e.broke = broke;
    const ev: SimEvent[] = [];
    const gems = w.gems.length;
    hitEnemy(w, e, { dmg: 999, by: 'skill', owner: 0, from: p }, ev);
    const k = evs(ev, 'broke');
    if (k.length) {
      const g = w.gems.find((x) => x.id === k[0].gem);
      assert.ok(g && g.value === 1 && Math.hypot(g.x - e.x, g.y - e.y) < 1, '多掉的那颗在尸首旁边');
      assert.equal(w.gems.length, gems + ENEMIES.soldier.gems + 1);
    }
    return k.length;
  };
  let extra = 0;
  for (let i = 0; i < 300; i++) extra += kill(H.broke[3], true);
  assert.ok(extra > 300 * H.broke[3] * 0.75 && extra < 300 * H.broke[3] * 1.25, `破财掉了 ${extra} 颗`);
  let none = 0;
  for (let i = 0; i < 50; i++) none += kill(0.9, false) + kill(undefined, true);
  assert.equal(none, 0, '没被吓住的、没走破财的不掉');
});

// ---------------------------------------------------------------- 存档与确定性

test('赵公明的一局：同种子同输入完全确定；中途存档恢复后接着跑逐帧相同（珠子在飞、金鞭举到一半、黑虎扑到一半都存得下）', () => {
  const play = () => {
    const w = createWorld(77, 1, ['zhao']);
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
  const w = createWorld(78, 1, ['zhao']);
  const p = w.players[0];
  for (let i = 0; i < 60 * 30 && !(w.phase === 'wave' && w.pending.some((q) => q.kind === 'bead')); i++) step(w, [botInput(w, 0)], w.phase === 'shop' ? botShop(w, 0) : []);
  for (let i = 0; i < 8; i++) enemy(w, 'soldier', p.x + 30 + i * 6, p.y + (i % 3) * 6 - 6, 500);
  p.skill = 1;
  step(w, [{ mx: 0, my: 0, skill: true }]);
  assert.ok(p.whip, '金鞭举到一半');
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
