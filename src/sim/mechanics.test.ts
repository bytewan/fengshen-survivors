import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, digest, spawnEnemy, step, type PlayerInput, type SimEvent, type World } from './world.ts';
import { DROPS, DT } from './config.ts';
import { HEROES, MARK_T, REACT, WEAPONS } from './catalog.ts';
import { buildGrid, hitEnemy, tickStatus, XINGHUANG, BLEED, hurtPlayer } from './core.ts';
import { TUNE } from './weapons.ts';
import { loot, rollDrop } from './drops.ts';
import { botLootPull } from './bot-loot.ts';
import { botInput, botShop } from './bot.ts';
import type { Drop, DropKind, Element, Enemy, EnemyKindName, WeaponKind } from './types.ts';

const idle: PlayerInput = { mx: 0, my: 0, skill: false };
/** 跑若干秒，收集事件。 */
const run = (w: World, seconds: number, input: (w: World) => PlayerInput = () => idle) => {
  const events: SimEvent[] = [];
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) events.push(...step(w, [input(w)]));
  return events;
};
/** 普通波里关掉刷怪（不借首领波，免得首领那边的改动影响这里）。 */
const quiet = (w: World) => {
  w.wave = 3;
  w.waveLen = 1e9;
  w.spawnAcc = -1e12;
  w.eliteDone = true;
  w.surgeDone = true;
};
/** 一个干净的测试场：刷怪关掉、宠物不出手、人物无敌。 */
const arena = (seed: number, weapons: { kind: WeaponKind; tier: number; spirit?: string | null }[] = []) => {
  const w = createWorld(seed);
  quiet(w);
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
const hitsOn = (ev: SimEvent[], id: number, by?: string) => ev.filter((e) => e.t === 'hit' && e.id === id && (!by || e.by === by));

// ---------- 主五行 ----------

test('主五行：哪吒是火，乾坤圈与混天绫都是火行；开局火行亲和 +10%', () => {
  assert.equal(HEROES.nezha.el, 'fire');
  assert.equal(WEAPONS.qiankun.el, 'fire');
  const w = createWorld(1);
  assert.ok(Math.abs(w.players[0].stats.aff.fire - HEROES.nezha.affStart) < 1e-9);
});

test('乾坤圈是火行：命中留下火行印记并带轻微灼烧', () => {
  const { w, p } = arena(2, [{ kind: 'qiankun', tier: 1 }]);
  const e = enemy(w, 'soldier', p.x + 50, p.y);
  const ev = run(w, 1);
  assert.ok(hitsOn(ev, e.id, 'ring').length > 0, '乾坤圈打中了');
  assert.equal(e.mark, 'fire');
  assert.ok(e.markT > 0 && e.markT <= MARK_T);
  assert.ok(e.burn > 0 && e.burnT > 0, '轻微灼烧');
});

test('所有法宝的基础冷却不低于 1.2 秒', () => {
  for (const k of Object.keys(WEAPONS) as WeaponKind[]) assert.ok(WEAPONS[k].cd >= 1.2, `${k} 冷却 ${WEAPONS[k].cd}`);
});

// ---------- 五行相生 ----------

/** 给一只敌人打上 mark 印记，再用 el 行打一下，返回这一下的事件。 */
function react(mark: Element | null, el: Element, setup?: (w: World, e: Enemy) => void) {
  const { w, p } = arena(3);
  const e = enemy(w, 'soldier', p.x + 40, p.y, 5000);
  const near = [enemy(w, 'soldier', p.x + 60, p.y, 5000), enemy(w, 'soldier', p.x + 40, p.y + 20, 5000)];
  e.mark = mark;
  e.markT = mark ? MARK_T : 0;
  setup?.(w, e);
  buildGrid(w.enemies);
  const ev: SimEvent[] = [];
  hitEnemy(w, e, { dmg: 20, by: 'thrust', owner: 0, from: p, el, canCrit: true }, ev);
  return { w, p, e, near, ev, r: ev.filter((x) => x.t === 'react') };
}

test('相生：金生水「凝霜」——必定冻结、伤害提高，消耗金印后留下水印', () => {
  const { e, ev, r } = react('metal', 'water');
  assert.equal(r.length, 1);
  assert.equal(r[0].t === 'react' && r[0].kind, 'frost');
  assert.ok(e.frozen >= REACT.frost.freeze - 1e-9, '冻住了');
  const hit = ev.find((x) => x.t === 'hit' && x.id === e.id)!;
  assert.ok(hit.t === 'hit' && hit.dmg >= 20 * REACT.frost.dmg, `伤害提高（${hit.t === 'hit' && hit.dmg}）`);
  assert.equal(e.mark, 'water', '旧印记消耗、换成这一下的水印');
});

test('相生：水生木「导雷」——伤害提高，雷光再跳到身边的敌人（额外伤害不再相生）', () => {
  const { e, near, ev, r } = react('water', 'wood', (_w, e) => {
    void e;
  });
  assert.equal(r.length, 1);
  assert.equal(r[0].t === 'react' && r[0].kind, 'conduct');
  const rr = r[0];
  assert.ok(rr.t === 'react' && rr.pts && rr.pts.length >= 3, '雷光跳出去的落点');
  for (const o of near) assert.ok(hitsOn(ev, o.id, 'react').length === 1, '身边的敌人被导雷打到');
  assert.equal(e.mark, 'wood');
  // 额外伤害带木行但不打印记：身边的敌人没有被打上木印
  for (const o of near) assert.equal(o.mark, null);
});

test('相生：木生火「引燃」——重度灼烧，并点着身边的敌人', () => {
  const { e, near, r } = react('wood', 'fire');
  assert.equal(r[0].t === 'react' && r[0].kind, 'ignite');
  assert.ok(e.burn >= 20 * REACT.ignite.burn * 0.99 && e.burnT >= REACT.ignite.burnT - 1e-9, '重度灼烧');
  assert.ok(near.some((o) => o.burn > 0 && o.burnT > 0), '身边的敌人被引燃');
  assert.equal(e.mark, 'fire');
});

test('相生：火生土「熔岩」——晕得更久，身上的灼烧一次烧完', () => {
  const { e, ev, r } = react('fire', 'earth', (_w, e) => {
    e.burn = 10;
    e.burnT = 2;
  });
  assert.equal(r[0].t === 'react' && r[0].kind, 'lava');
  assert.equal(e.burn, 0);
  assert.equal(e.burnT, 0);
  assert.ok(e.stun >= REACT.lava.stun - 1e-9, '晕住');
  const extra = hitsOn(ev, e.id, 'react');
  assert.equal(extra.length, 1, '灼烧一次结算');
  assert.ok(extra[0].t === 'hit' && extra[0].dmg >= 10 * 2 * REACT.lava.burnMul - 1);
});

test('相生：土生金「淬锋」——必定暴击，暴击伤害更高', () => {
  const { e, ev, r, p } = react('earth', 'metal');
  assert.equal(r[0].t === 'react' && r[0].kind, 'pierce');
  const hit = ev.find((x) => x.t === 'hit' && x.id === e.id)!;
  assert.ok(hit.t === 'hit' && hit.crit);
  assert.ok(hit.t === 'hit' && hit.dmg >= Math.round(20 * (p.stats.critMul + REACT.pierce.critMul)) - 1);
});

test('相生只在「A 生 B」时触发；同行、相克、没有印记都不触发，只刷新印记', () => {
  for (const [mark, el] of [['fire', 'fire'], ['water', 'fire'], [null, 'water'], ['fire', 'wood']] as [Element | null, Element][]) {
    const { e, r } = react(mark, el);
    assert.equal(r.length, 0, `${mark} 印被 ${el} 打中不该相生`);
    assert.equal(e.mark, el);
  }
});

test('持续伤害（灼烧、流血、区域）不打印记、不触发相生', () => {
  const { w, p } = arena(4);
  const e = enemy(w, 'soldier', p.x + 40, p.y);
  e.mark = 'wood';
  e.markT = 5;
  e.burn = 20;
  e.burnT = 1;
  e.burnBy = 0;
  e.bleed = 6;
  e.bleedT = 1;
  const ev: SimEvent[] = [];
  for (let i = 0; i < 60; i++) tickStatus(w, e, DT, ev);
  assert.ok(hitsOn(ev, e.id, 'burn').length > 0 && hitsOn(ev, e.id, 'bleed').length > 0);
  assert.equal(ev.filter((x) => x.t === 'react').length, 0, '木印 + 火行灼烧不引燃');
  assert.equal(e.mark, 'wood', '印记没被持续伤害改掉');
  buildGrid(w.enemies);
  hitEnemy(w, e, { dmg: 5, by: 'zone', owner: 0, from: e, el: 'fire', canCrit: false }, ev);
  assert.equal(ev.filter((x) => x.t === 'react').length, 0, '区域伤害也不触发');
});

test('五行接力：雷公鞭（木）打过的敌人，火尖枪（火）再打就引燃', () => {
  const { w, p } = arena(5, [
    { kind: 'leigong', tier: 1 },
    { kind: 'huojian', tier: 1 },
  ]);
  p.weapons[1].cd = 0.5; // 雷先落，枪后到
  const e = enemy(w, 'soldier', p.x + 40, p.y);
  const ev = run(w, 1.2);
  assert.ok(ev.some((x) => x.t === 'react' && x.kind === 'ignite' && x.id === e.id));
});

// ---------- 法宝品阶：灵品量变、仙品质变 ----------

test('乾坤圈仙品：飞到最远处悬停旋转，悬停时反复绞杀圈里的敌人', () => {
  const { w, p } = arena(6, [{ kind: 'qiankun', tier: 3 }]);
  const e = enemy(w, 'soldier', p.x + 60, p.y);
  let hovered = false;
  const ev: SimEvent[] = [];
  for (let i = 0; i < 150; i++) {
    ev.push(...step(w, [idle]));
    if (w.rings.some((r) => r.hover > 0)) hovered = true;
  }
  assert.ok(hovered, '悬停过');
  assert.ok(hitsOn(ev, e.id, 'ring').length >= 4, `同一只被绞了多下（${hitsOn(ev, e.id, 'ring').length}）`);
  // 凡品不悬停
  const b = arena(6, [{ kind: 'qiankun', tier: 1 }]);
  enemy(b.w, 'soldier', b.p.x + 60, b.p.y);
  for (let i = 0; i < 150; i++) {
    step(b.w, [idle]);
    assert.ok(!b.w.rings.some((r) => r.hover > 0), '凡品不悬停');
  }
});

test('乾坤圈：飞行速度放慢（看得清），灵品飞得更远、圈更大', () => {
  assert.ok(TUNE.qiankun.speed <= 180 && TUNE.qiankun.back <= 220);
  assert.ok(TUNE.qiankun.range[2] > TUNE.qiankun.range[1] && TUNE.qiankun.radius[2] > TUNE.qiankun.radius[1]);
});

test('火尖枪：灵品两连刺；仙品枪芒在地上留下火痕，持续灼烧踩在上面的敌人，到时消失', () => {
  const two = arena(7, [{ kind: 'huojian', tier: 2 }]);
  enemy(two.w, 'soldier', two.p.x + 50, two.p.y);
  const ev2 = run(two.w, 0.6).filter((x) => x.t === 'thrust');
  assert.equal(ev2.length, 2, '两连刺');
  assert.ok(ev2.every((x) => x.t === 'thrust' && x.kind === 'huojian' && x.tier === 2));
  const one = arena(7, [{ kind: 'huojian', tier: 1 }]);
  enemy(one.w, 'soldier', one.p.x + 50, one.p.y);
  assert.equal(run(one.w, 0.6).filter((x) => x.t === 'thrust').length, 1, '凡品一刺');

  const { w, p } = arena(8, [{ kind: 'huojian', tier: 3 }]);
  const e = enemy(w, 'soldier', p.x + 50, p.y + 10);
  run(w, 0.1);
  const trail = w.zones.find((z) => z.kind === 'fireTrail');
  assert.ok(trail, '留下火痕');
  p.weapons = []; // 只看火痕
  const ev = run(w, 2);
  assert.ok(hitsOn(ev, e.id, 'zone').length >= 4, '站在火痕上一直被烫');
  run(w, TUNE.huojian.trail.life);
  assert.equal(w.zones.filter((z) => z.kind === 'fireTrail').length, 0, '火痕到时消失');
});

test('九龙神火罩仙品：火罩笼罩片刻，跟着人走，持续灼烧罩里的敌人', () => {
  const { w, p } = arena(9, [{ kind: 'jiulong', tier: 3 }]);
  const e = enemy(w, 'soldier', p.x + 30, p.y);
  const ev = run(w, 0.1);
  assert.ok(ev.some((x) => x.t === 'aura' && x.kind === 'jiulong' && x.tier === 3));
  const dome = w.zones.find((z) => z.kind === 'fireDome');
  assert.ok(dome, '火罩笼罩');
  p.weapons = [];
  const ev2 = run(w, 1, () => ({ mx: 1, my: 0, skill: false }));
  assert.ok(Math.abs(dome.x - p.x) < 1e-6 && Math.abs(dome.y - p.y) < 1e-6, '火罩跟着人走');
  assert.ok(hitsOn(ev2, e.id, 'zone').length >= 1);
  run(w, TUNE.jiulong.dome.life);
  assert.equal(w.zones.length, 0, '到时散去');
});

test('雷公鞭：灵品跳得更多；仙品被打中的敌人留下雷印，约 1.2 秒后再落一道雷', () => {
  const jumps = (tier: number) => {
    const { w, p } = arena(10, [{ kind: 'leigong', tier }]);
    // 十只、都摆在连跳够得着的范围里（离人物不超过 REACH.max）：2026-11-11 数值平衡以后凡品一道雷打 6 只、灵品 8 只，原来八只隔 20 像素只有 6 只够得着
    for (let i = 0; i < 10; i++) enemy(w, 'soldier', p.x + 40 + i * 10, p.y + (i % 2) * 10);
    const ch = run(w, 0.1).find((x) => x.t === 'chain');
    return ch && ch.t === 'chain' ? ch.pts.length - 1 : 0;
  };
  assert.ok(jumps(2) > jumps(1), `灵品跳得更多（${jumps(1)} → ${jumps(2)}）`);
  const { w, p } = arena(11, [{ kind: 'leigong', tier: 3 }]);
  const e = enemy(w, 'soldier', p.x + 40, p.y);
  const ev = run(w, 0.1);
  const warn = ev.find((x) => x.t === 'warn' && x.kind === 'thunder');
  assert.ok(warn && warn.t === 'warn' && warn.tier === 3 && Math.abs(warn.t2 - TUNE.leigong.mark.delay) < 1e-9, '雷印预警');
  assert.ok(w.pending.some((q) => q.kind === 'thunder' && q.target === e.id), '跟着被标记的敌人');
  p.weapons = [];
  const ev2 = run(w, TUNE.leigong.mark.delay + 0.1);
  assert.ok(ev2.some((x) => x.t === 'land' && x.kind === 'thunder'));
  assert.equal(hitsOn(ev2, e.id, 'thunder').length, 1, '再落一道雷');
});

test('番天印仙品：落地处地面龟裂一段时间，减速走过的敌人', () => {
  const { w, p } = arena(12, [{ kind: 'fantian', tier: 3 }]);
  const e = enemy(w, 'soldier', p.x + 60, p.y);
  const ev = run(w, TUNE.fantian.warn + 0.1);
  assert.ok(ev.some((x) => x.t === 'land' && x.kind === 'slam' && x.tier === 3));
  const crack = w.zones.find((z) => z.kind === 'crack');
  assert.ok(crack, '地裂');
  p.weapons = [];
  run(w, 0.3);
  assert.ok(e.slow > 0 && e.slowT > 0, '走在地裂上被减速');
  run(w, TUNE.fantian.crack.life);
  assert.equal(w.zones.length, 0, '地裂到时合上');
  run(w, 1);
  assert.equal(e.slow, 0, '离开 / 地裂消失后减速解除');
});

test('戊己杏黄旗仙品：护盾挡两次；有盾时脚下金莲让靠近的敌人减速', () => {
  const { w, p } = arena(13, [{ kind: 'xinghuang', tier: 3 }]);
  p.iframes = 0;
  const ev = run(w, 0.05);
  assert.ok(ev.some((x) => x.t === 'shieldUp' && x.tier === 3 && x.kind === 'xinghuang'));
  assert.equal(p.shield, XINGHUANG.shields[3]);
  assert.equal(p.shield, 2);
  const e = enemy(w, 'soldier', p.x + 20, p.y);
  run(w, 0.1);
  assert.ok((p.lotus ?? 0) > 0, '金莲开着');
  assert.ok(e.slow > 0, '靠近的敌人被金莲减速');
  const blk: SimEvent[] = [];
  for (let i = 0; i < 2; i++) {
    p.iframes = 0;
    hurtPlayer(w, p, 10, 'contact', blk);
  }
  assert.equal(blk.filter((x) => x.t === 'blocked' && x.by === 'shield').length, 2, '挡两次');
  assert.ok(blk.some((x) => x.t === 'shieldBreak'), '第二次挡完碎盾');
  assert.equal(p.lotus, 0);
});

test('斩仙飞刀：灵品刺得更多；仙品命中留下流血（叠层有上限、按时跳字、到时止血）', () => {
  assert.ok(TUNE.zhanxian.hits[2] > TUNE.zhanxian.hits[1]);
  assert.ok(TUNE.zhanxian.speed <= 160, '飞刀放慢了');
  const { w, p } = arena(14, [{ kind: 'zhanxian', tier: 3 }]);
  const e = enemy(w, 'soldier', p.x + 40, p.y);
  const ev = run(w, 2.5);
  assert.ok(hitsOn(ev, e.id, 'knife').length >= 2, '来回穿刺');
  assert.ok(e.bleed > 0 && e.bleedT > 0, '流血');
  const knife = p.weapons[0];
  const perStack = WEAPONS.zhanxian.dmg * WEAPONS.zhanxian.mul[3] * TUNE.zhanxian.bleed;
  assert.ok(e.bleed <= perStack * BLEED.stacks * 1.0001 + 1e-6, '叠层有上限');
  void knife;
  assert.ok(hitsOn(ev, e.id, 'bleed').length >= 2, '流血跳字');
  p.weapons = [];
  run(w, TUNE.zhanxian.bleedT + 0.6);
  assert.equal(e.bleed, 0, '到时止血');
  // 凡品不流血
  const b = arena(14, [{ kind: 'zhanxian', tier: 2 }]);
  const e2 = enemy(b.w, 'soldier', b.p.x + 40, b.p.y);
  run(b.w, 2);
  assert.equal(e2.bleed, 0);
});

test('寒冰幡：灵品冰棱更多；仙品冰棱处结出寒霜（减速），片刻后寒气冻住附近的敌人', () => {
  const spikes = (tier: number) => {
    const { w, p } = arena(15, [{ kind: 'hanbing', tier }]);
    for (let i = 0; i < 6; i++) enemy(w, 'soldier', p.x + 30 + i * 18, p.y);
    return run(w, 0.05).filter((x) => x.t === 'warn' && x.kind === 'spike').length;
  };
  assert.ok(spikes(2) > spikes(1), `冰棱更多（${spikes(1)} → ${spikes(2)}）`);
  const { w, p } = arena(16, [{ kind: 'hanbing', tier: 3 }]);
  const e = enemy(w, 'soldier', p.x + 40, p.y);
  const near = enemy(w, 'soldier', p.x + 40, p.y + 18);
  const ev = run(w, TUNE.hanbing.warn + 0.1);
  assert.ok(ev.some((x) => x.t === 'land' && x.kind === 'spike' && x.tier === 3));
  assert.ok(w.zones.some((z) => z.kind === 'frost'), '结出寒霜');
  assert.ok(ev.some((x) => x.t === 'warn' && x.kind === 'frost' && x.tier === 3), '寒气预警');
  p.weapons = [];
  e.frozen = near.frozen = 0;
  e.stun = near.stun = 0;
  const ev2 = run(w, TUNE.hanbing.chill.delay + 0.05);
  assert.ok(ev2.some((x) => x.t === 'land' && x.kind === 'frost'));
  assert.ok(near.frozen > 0 || ev2.some((x) => x.t === 'freeze' && x.id === near.id), '附近的敌人也被冻住');
  run(w, 0.2);
  assert.ok(near.slow > 0, '寒霜减速');
});

test('法宝事件都带上 kind 和 tier', () => {
  const kinds: WeaponKind[] = ['qiankun', 'huojian', 'jiulong', 'leigong', 'fantian', 'zhanxian', 'hanbing', 'xinghuang'];
  for (const k of kinds) {
    const { w, p } = arena(17, [{ kind: k, tier: 3 }]);
    for (let i = 0; i < 5; i++) enemy(w, 'soldier', p.x + 30 + i * 12, p.y + i * 3);
    const ev = run(w, 2);
    const wev = ev.filter((x) => x.t === 'thrust' || x.t === 'aura' || x.t === 'chain' || x.t === 'warn' || x.t === 'land' || x.t === 'shieldUp' || x.t === 'throw');
    assert.ok(wev.length > 0, `${k} 有法宝事件`);
    for (const x of wev) assert.equal((x as { tier?: number }).tier, 3, `${k} 的 ${x.t} 带 tier`);
    for (const x of wev) if (x.t === 'thrust' || x.t === 'aura' || x.t === 'chain' || x.t === 'shieldUp' || x.t === 'throw') assert.equal(x.kind, k, `${k} 的 ${x.t} 带 kind`);
  }
});

test('神品：每件法宝的两个器灵都能用（出手、打出伤害）', () => {
  for (const k of Object.keys(WEAPONS) as WeaponKind[])
    for (const sp of WEAPONS[k].spirits) {
      const { w, p } = arena(18, [{ kind: k, tier: 4, spirit: sp.id }]);
      if (k === 'xinghuang') p.iframes = 0;
      for (let i = 0; i < 10; i++) enemy(w, 'soldier', p.x + 20 + i * 10, p.y + (i % 3) * 8, 80, k === 'xinghuang' ? 30 : 0);
      p.hp = p.stats.maxHp = 1e6;
      const ev = run(w, 4);
      const dealt = ev.filter((x) => x.t === 'hit').reduce((a, x) => a + (x.t === 'hit' ? x.dmg : 0), 0);
      assert.ok(dealt > 0, `${k}·${sp.name} 打出了伤害`);
    }
});

// ---------- 地面区域 ----------

test('地面区域：在区域里才结算，到时消失；波次结束清空', () => {
  const { w, p } = arena(19, [{ kind: 'huojian', tier: 3 }]);
  const inside = enemy(w, 'soldier', p.x + 50, p.y + 10);
  const outside = enemy(w, 'soldier', p.x + 50, p.y + 90);
  run(w, 0.1);
  p.weapons = [];
  const ev = run(w, 1.5);
  assert.ok(hitsOn(ev, inside.id, 'zone').length > 0);
  assert.equal(hitsOn(ev, outside.id, 'zone').length, 0);
  // 叠在一起的火痕只算一块
  const z = w.zones.find((x) => x.kind === 'fireTrail')!;
  w.zones.push({ ...z, id: 99999, t: 0 });
  const ev2 = run(w, 0.9);
  assert.ok(hitsOn(ev2, inside.id, 'zone').length <= 4, '同一只每 0.3 秒最多烫一次');
  // 波次结束：清空
  w.waveLen = w.waveT + DT;
  run(w, DT * 2);
  assert.equal(w.zones.length, 0);
});

// ---------- 战场掉落 ----------

test('掉落：精英必掉乾坤宝匣（精英的），普通兵小概率掉；场上有上限', () => {
  const { w, p } = arena(20);
  const ev: SimEvent[] = [];
  const el = enemy(w, 'elite', p.x + 50, p.y, 1);
  buildGrid(w.enemies);
  hitEnemy(w, el, { dmg: 10, by: 'thrust', owner: 0, from: p }, ev);
  const d = ev.find((x) => x.t === 'drop');
  assert.ok(d && d.t === 'drop' && d.kind === 'chest' && d.rich, '精英掉宝匣');
  assert.equal(w.drops.length, 1);
  // 普通兵：掷很多次，三种都会出、总概率和配置一致，场上不超过上限
  const counts: Record<DropKind, number> = { chest: 0, peach: 0, magnet: 0 };
  let n = 0;
  for (let i = 0; i < 4000; i++) {
    const before = w.drops.length;
    rollDrop(w, { ...el, kind: 'soldier' }, ev);
    if (w.drops.length > before) {
      counts[w.drops[w.drops.length - 1].kind]++;
      n++;
    }
    assert.ok(w.drops.filter((x) => !x.rich).length <= DROPS.max);
    if (w.drops.length > 1) w.drops = w.drops.filter((x) => x.rich); // 清掉普通掉落，接着掷
  }
  const total = DROPS.chance.peach + DROPS.chance.magnet + DROPS.chance.chest;
  assert.ok(counts.peach > 0 && counts.magnet > 0 && counts.chest > 0);
  assert.ok(Math.abs(n / 4000 - total) < total * 0.5, `掉率 ${n / 4000}`);
});

const dropAt = (w: World, kind: DropKind, x: number, y: number, rich = false): Drop => {
  const d: Drop = { id: w.nextId++, kind, x, y, px: x, py: y, t: 0, life: DROPS.life, ...(rich ? { rich } : {}) };
  w.drops.push(d);
  return d;
};

test('拾取：蟠桃回 25% 气血；走近自动拾取，发 loot 事件', () => {
  const { w, p } = arena(21);
  p.hp = 40;
  dropAt(w, 'peach', p.x + 30, p.y);
  let ev = run(w, 0.2);
  assert.equal(ev.filter((x) => x.t === 'loot').length, 0, '离得远不捡');
  ev = run(w, 0.6, () => ({ mx: 1, my: 0, skill: false }));
  const l = ev.find((x) => x.t === 'loot');
  assert.ok(l && l.t === 'loot' && l.kind === 'peach' && l.reward === '气血 +25');
  assert.ok(Math.abs(p.hp - 65) < 1, `回了 25（${p.hp}）`);
  assert.equal(w.drops.length, 0);
});

test('拾取：聚灵符把场上所有灵石吸向拾取者，吸来的灵石按 1.25 倍算', () => {
  const { w, p } = arena(22);
  for (let i = 0; i < 10; i++) w.gems.push({ id: 5000 + i, x: 100 + i * 70, y: 80 + (i % 3) * 150, px: 0, py: 0, vx: 0, vy: 0, value: 1, pulled: -1 });
  const d = dropAt(w, 'magnet', p.x, p.y);
  const ev: SimEvent[] = [];
  loot(w, p, d, ev);
  w.drops = [];
  assert.ok(w.gems.every((g) => g.pulled === p.id), '全部被吸');
  const l = ev.find((x) => x.t === 'loot');
  assert.ok(l && l.t === 'loot' && l.reward === '聚来灵石 ×10');
  const before = p.lingshi;
  run(w, 6);
  assert.equal(w.gems.length, 0);
  assert.equal(p.lingshi, before + Math.floor(10 * DROPS.magnetBonus), '吸来的十颗按 1.25 倍算（零头留着）');
});

test('拾取：乾坤宝匣随机给一样——灵石 / 已有法宝的碎片（凑满三枚升阶）/ 真气充满', () => {
  const save = { ...DROPS.chest };
  try {
    const open = (weights: { lingshi: number; fragment: number; qi: number }, prep?: (w: World) => void) => {
      Object.assign(DROPS.chest, weights);
      const { w, p } = arena(23, [{ kind: 'qiankun', tier: 1 }]);
      prep?.(w);
      const ev: SimEvent[] = [];
      loot(w, p, dropAt(w, 'chest', p.x, p.y), ev);
      const l = ev.find((x) => x.t === 'loot');
      return { w, p, reward: l && l.t === 'loot' ? l.reward : '' };
    };
    const a = open({ lingshi: 1, fragment: 0, qi: 0 });
    assert.match(a.reward, /^灵石 \+\d+$/);
    assert.ok(a.p.lingshi > 0);
    const b = open({ lingshi: 0, fragment: 1, qi: 0 });
    assert.equal(b.reward, '乾坤圈碎片');
    assert.equal(b.p.frags.qiankun, 1);
    const c = open({ lingshi: 0, fragment: 1, qi: 0 }, (w) => (w.players[0].frags.qiankun = 2));
    assert.equal(c.reward, '乾坤圈碎片 · 升为灵品');
    assert.equal(c.p.weapons[0].tier, 2, '凑满三枚自动升阶');
    const d = open({ lingshi: 0, fragment: 0, qi: 1 });
    assert.equal(d.reward, '真气充满');
    assert.equal(d.p.skill, 1);
    const e = open({ lingshi: 0, fragment: 1, qi: 0 }, (w) => (w.players[0].weapons[0].tier = 3));
    assert.match(e.reward, /^灵石 \+\d+$/, '没有能升阶的法宝就换成灵石');
  } finally {
    Object.assign(DROPS.chest, save);
  }
});

test('掉落：没人捡就消失；波末收灵时场上的掉落飞向人物、照常生效，收完才进商店', () => {
  const { w, p } = arena(24);
  dropAt(w, 'chest', p.x + 300, p.y);
  run(w, DROPS.life + 0.1);
  assert.equal(w.drops.length, 0, '到时消失');
  p.hp = 50;
  dropAt(w, 'peach', p.x + 300, p.y + 100);
  w.waveLen = w.waveT + DT;
  const ev = run(w, 0.05);
  assert.equal(w.phase, 'collect');
  assert.equal(w.drops.length, 1, '收灵开始时掉落还在，正飞向人物');
  assert.equal(w.drops[0].pulled, 0);
  const ev2 = run(w, 3);
  assert.ok([...ev, ...ev2].some((x) => x.t === 'loot' && x.kind === 'peach'));
  assert.ok(p.hp >= 75 - 1e-6, '蟠桃生效');
  assert.equal(w.phase, 'shop');
  assert.equal(w.drops.length, 0);
});

test('机器人捡掉落：安全时给出朝掉落走的分量，被围或掉落被敌人守着时不去', () => {
  const { w, p } = arena(25);
  p.hp = 40;
  dropAt(w, 'peach', p.x + 80, p.y);
  const [ax, ay] = botLootPull(w, 0);
  assert.ok(ax > 0 && Math.abs(ay) < 1e-9, '朝蟠桃走');
  for (let i = 0; i < 6; i++) enemy(w, 'soldier', p.x + 80 + (i % 3) * 8, p.y + (i < 3 ? 8 : -8));
  assert.deepEqual(botLootPull(w, 0), [0, 0], '掉落被敌人守着');
});

// ---------- 宠物 ----------
// 混天绫的行为与减益见 pet.test.ts。

// ---------- 确定性 ----------

test('加上相生、区域、延时效果、流血、掉落之后：同种子同输入仍然完全确定', () => {
  const play = (seed: number) => {
    const w = createWorld(seed);
    w.wave = 10; // 第二章的精英波：兵更肉、有精英，流血、灼烧这些持续伤害才跳得出来
    w.waveLen = 30;
    const p = w.players[0];
    p.weapons = [
      { kind: 'qiankun', tier: 4, spirit: 'flame', cd: 0.5 },
      { kind: 'leigong', tier: 3, spirit: null, cd: 0.5 },
      { kind: 'hanbing', tier: 4, spirit: 'shatter', cd: 0.5 },
      { kind: 'zhanxian', tier: 3, spirit: null, cd: 0.5 },
      { kind: 'huojian', tier: 3, spirit: null, cd: 0.5 }, // 测试里借第五个位置，把火痕也跑到
    ];
    p.hp = p.stats.maxHp = 5000;
    p.stats.luck = 200; // 多掉一点，掉落的路径也走到
    const evs: SimEvent[] = [];
    for (let i = 0; i < 60 * 80; i++) {
      const [lx, ly] = botLootPull(w, 0);
      const b = botInput(w, 0);
      evs.push(...step(w, [{ ...b, mx: b.mx * 0.03 + lx, my: b.my * 0.03 + ly }], w.phase === 'shop' ? botShop(w, 0) : []));
    }
    const kinds = new Set(evs.map((e) => (e.t === 'hit' ? `hit:${e.by}` : e.t === 'react' ? `react:${e.kind}` : e.t)));
    return { d: digest(w) + '|' + w.zones.length + '|' + w.drops.length + '|' + evs.length, kinds };
  };
  const a = play(77);
  const b = play(77);
  assert.equal(a.d, b.d);
  for (const k of ['hit:zone', 'hit:bleed', 'hit:thunder', 'react:frost', 'drop', 'loot']) assert.ok(a.kinds.has(k), `这一局走到了 ${k}`);
  assert.notEqual(play(78).d, a.d);
});
