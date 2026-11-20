// 射程规则（用户 2026-11-10：「各种武器、法宝、宠物的攻击距离不能太大」；规则见 config.REACH 与 docs/design.md）：
// 索敌半径 REACH.seek —— 只有更远处有敌人时，16 件法宝的每个品阶、每个器灵都不出手；
// 效果的最远处 REACH.max —— 落点在索敌半径里，圈、飞刀、火鸟、连跳、枪芒、光束、火浪都在射程里，215 像素外的敌人一只都打不到（范围加成堆高了也一样）。
// 另外两条和法宝有关的修正：火尖枪两连刺的第二枪不带进下一波；同一个人同一种区域最多 ZONE_CAP 块（加上正在淡出的几块）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, spawnEnemy, step, type PlayerInput, type SimEvent, type World } from './world.ts';
import { DT, REACH } from './config.ts';
import { WEAPONS } from './catalog.ts';
import { hurtPlayer } from './core.ts';
import { TUNE } from './weapons.ts';
import { ZONE_CAP, ZONE_FADE, addZone } from './zones.ts';
import type { Enemy, HitBy, TechniqueId, WeaponKind } from './types.ts';

const idle: PlayerInput = { mx: 0, my: 0, skill: false };
const KINDS = Object.keys(WEAPONS) as WeaponKind[];
/** 每件法宝的凡 / 灵 / 仙 / 神（两个器灵）。 */
const variants = (k: WeaponKind) => [
  { tier: 1, spirit: null as string | null },
  { tier: 2, spirit: null },
  { tier: 3, spirit: null },
  ...WEAPONS[k].spirits.map((s) => ({ tier: 4, spirit: s.id as string | null })),
];
/** 干净的测试场：普通波、刷怪关掉、宠物不出手、人物无敌、满血、站着不动。 */
function arena(seed: number, kind: WeaponKind | null, tier = 1, spirit: string | null = null, areaBonus = 0) {
  const w = createWorld(seed);
  w.wave = 3;
  w.waveLen = 1e9;
  w.spawnAcc = -1e12;
  w.eliteDone = true;
  w.surgeDone = true;
  const p = w.players[0];
  p.weapons = kind ? [{ kind, tier, spirit, cd: 0 }] : [];
  p.pet.cd = 1e12;
  p.iframes = 1e12;
  p.stats.area = areaBonus;
  return { w, p };
}
/** 钉在原地的敌人（挨了击退、被卷被拽也钉回原处）：一圈 n 只，离人物 d0–d1 像素。 */
function ring(w: World, n: number, d0: number, d1: number, phase = 0): Enemy[] {
  const p = w.players[0];
  return Array.from({ length: n }, (_, i) => {
    const a = phase + (i / n) * Math.PI * 2;
    const d = d0 + ((i * 7) % n) * ((d1 - d0) / Math.max(1, n - 1));
    const e = spawnEnemy(w, 'soldier', p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, []);
    e.hp = e.maxHp = 1e6;
    e.speed = 0;
    return e;
  });
}
/** 跑 secs 秒，每帧把敌人钉回原处；每帧调 look（看圈、飞刀这些飞行物）。 */
function run(w: World, pinned: Enemy[], secs: number, look?: () => void) {
  const home = pinned.map((e) => [e.x, e.y] as const);
  const ev: SimEvent[] = [];
  for (let i = 0; i < Math.round(secs / DT); i++) {
    ev.push(...step(w, [idle]));
    pinned.forEach((e, j) => {
      e.x = e.px = home[j][0];
      e.y = e.py = home[j][1];
      e.kx = e.ky = 0;
    });
    look?.();
  }
  return ev;
}
const dist = (p: { x: number; y: number }, x: number, y: number) => Math.hypot(x - p.x, y - p.y);
/** 法宝出手发的事件（杏黄旗套盾不算：它不挑目标）。 */
const FIRED: ReadonlySet<SimEvent['t']> = new Set<SimEvent['t']>(['throw', 'thrust', 'aura', 'chain', 'warn', 'zone', 'slash', 'lash', 'hit']);

test('射程：只有索敌半径以外（140–195 像素）有敌人时，16 件法宝的每个品阶、每个器灵都不出手（范围加成 +60% 也一样）', () => {
  for (const areaBonus of [0, 0.6])
    for (const k of KINDS)
      for (const v of variants(k)) {
        const { w } = arena(81, k, v.tier, v.spirit, areaBonus);
        const foes = ring(w, 24, 140, 195);
        const ev = run(w, foes, 4);
        const fired = ev.filter((e) => FIRED.has(e.t));
        assert.equal(fired.length, 0, `${WEAPONS[k].name}${v.tier}${v.spirit ?? ''}（范围 +${areaBonus * 100}%）打了索敌半径以外的敌人：${fired.slice(0, 3).map((e) => e.t).join('、')}`);
      }
});

/** 法宝的直接命中（灼烧、流血、区域的持续伤害只落在被直接打中的敌人身上）。 */
const DIRECT: ReadonlySet<HitBy> = new Set<HitBy>(['ring', 'thrust', 'aura', 'chain', 'slam', 'knife', 'spike', 'thunder', 'shield', 'lash', 'slash', 'gust', 'beam', 'wave', 'bird', 'rope', 'tide']);

test('射程：索敌半径里（40–128 像素）和远处（215–290 像素）都有敌人时，远处的一只都不挨打；落点都在索敌半径里，圈、飞刀、火鸟、连跳、枪芒、光束、火浪都在射程里', () => {
  for (const areaBonus of [0, 0.6])
    for (const k of KINDS)
      for (const v of variants(k)) {
        const { w, p } = arena(82, k, v.tier, v.spirit, areaBonus);
        p.hp = p.stats.maxHp * 0.5; // 青莲结界：气血不满才展开
        const near = ring(w, 9, 40, 128, 0.3);
        const far = ring(w, 16, 215, 290);
        const farIds = new Set(far.map((e) => e.id));
        const name = `${WEAPONS[k].name}${v.tier}${v.spirit ?? ''}（范围 +${areaBonus * 100}%）`;
        let fly = 0;
        const ev = run(w, [...near, ...far], 5, () => {
          for (const r of w.rings) fly = Math.max(fly, Math.hypot(r.x - p.x, r.y - (p.y - 10)) - TUNE.qiankun.leash - 5); // 圈心离胸口不超过 leash（折返拐弯时多冲出去几像素）
          for (const kn of w.knives) fly = Math.max(fly, dist(p, kn.x, kn.y + 12) - (REACH.max + 10)); // 飞刀 / 火鸟在胸口高度，追的时候会冲过一点
          for (const z of w.zones)
            if ((z.kind === 'beam' || z.kind === 'flameWave') && (z.len ?? 0) > REACH.max) fly = Math.max(fly, (z.len ?? 0) - REACH.max);
        });
        assert.ok(fly <= 3, `${name}：飞出去 / 伸出去超出射程 ${fly.toFixed(1)} 像素`);
        const farHits = ev.filter((e) => e.t === 'hit' && farIds.has(e.id));
        assert.equal(farHits.length, 0, `${name}：打到了 215 像素外的敌人（${farHits.map((e) => (e.t === 'hit' ? e.by : '')).slice(0, 3).join('、')}）`);
        for (const e of ev) {
          // 落点：大印、冰棱（会散开一点）、鞭子、雷印、寒气、旋风、水域、金绳都落在索敌半径里的敌人身上
          if (e.t === 'warn') assert.ok(dist(p, e.x, e.y) <= REACH.seek + 4, `${name}：${e.kind} 落在 ${dist(p, e.x, e.y).toFixed(0)} 像素外`);
          else if (e.t === 'zone') assert.ok(dist(p, e.x, e.y) <= REACH.seek + 4, `${name}：区域 ${e.zone} 放在 ${dist(p, e.x, e.y).toFixed(0)} 像素外`);
          else if (e.t === 'chain') for (const [x, y] of e.pts.slice(1)) assert.ok(dist(p, x, y + 8) <= REACH.max + 1, `${name}：雷跳到 ${dist(p, x, y + 8).toFixed(0)} 像素外`);
          else if (e.t === 'thrust') assert.ok(dist(p, e.x1, e.y1 + 10) <= REACH.max + 1, `${name}：枪芒 / 火龙伸到 ${dist(p, e.x1, e.y1 + 10).toFixed(0)} 像素外`);
          else if (e.t === 'aura' && e.kind === 'jiulong') assert.ok(e.r <= REACH.seek, `${name}：火罩半径 ${e.r.toFixed(0)}`);
          else if (e.t === 'slash') assert.ok(e.r <= REACH.seek, `${name}：血光斩半径 ${e.r.toFixed(0)}`);
          else if (e.t === 'hit' && DIRECT.has(e.by) && e.by !== 'slam' && e.by !== 'lash' && e.by !== 'gust' && e.by !== 'aura')
            // 落点处的范围（大印、震波、鞭痕、风眼、赤焰轮的火环）以落点为中心；别的直接命中都在 REACH.max 再加身子以内
            assert.ok(dist(p, e.x, e.y) <= REACH.max + 10, `${name}：${e.by} 打在 ${dist(p, e.x, e.y).toFixed(0)} 像素外`);
        }
        assert.ok(ev.some((e) => e.t === 'hit' && !farIds.has(e.id)) || k === 'xinghuang', `${name}：近处的敌人照样打得到`);
      }
});

test('射程：功法也守索敌半径 —— 五雷正法只劈 130 像素以内血最厚的；金刚不坏被远处打中时只反弹给 130 像素以内的', () => {
  const learned = (id: TechniqueId) => {
    const a = arena(83, null);
    a.p.techs = [id];
    return a;
  };
  // 五雷正法：只有 140–195 像素处有敌人（血更厚），劈不到；近处来了一只，就劈它
  const a = learned('wulei');
  const foes = ring(a.w, 16, 140, 195);
  for (const e of foes) e.hp = e.maxHp = 5e6;
  const ev = run(a.w, foes, 3);
  assert.equal(ev.filter((e) => e.t === 'tech' && e.kind === 'wulei').length, 0, '索敌半径外的不劈');
  const close = spawnEnemy(a.w, 'soldier', a.p.x + 100, a.p.y, []);
  close.speed = 0;
  const ev2 = run(a.w, [...foes, close], 7);
  assert.ok(ev2.some((e) => e.t === 'tech' && e.kind === 'wulei' && e.act === 'warn' && e.id === close.id), '近处的照样劈');
  // 金刚不坏：身边（46 像素内）没有敌人，远处的只在 140–195 像素：不反弹
  const b = learned('jingang');
  b.p.iframes = 0;
  b.p.stats.maxHp = b.p.hp = 1e6;
  ring(b.w, 16, 140, 195);
  const evB: SimEvent[] = [];
  for (let i = 0; i < 60; i++) {
    b.p.iframes = 0;
    hurtPlayer(b.w, b.p, 8, 'orb', evB);
  }
  assert.equal(evB.filter((e) => e.t === 'tech' && e.kind === 'jingang').length, 0, '远处的不反弹');
});

test('火尖枪：两连刺的第二枪不带进下一波（波末刚刺出第一枪，下一波开场不会对着空地补一枪、留火痕）', () => {
  for (const tier of [2, 3]) {
    const { w, p } = arena(84, 'huojian', tier);
    const e = spawnEnemy(w, 'soldier', p.x + 50, p.y, []);
    e.hp = e.maxHp = 1e6;
    e.speed = 0;
    let fired = false;
    for (let i = 0; i < 60 && !fired; i++) fired = step(w, [idle]).some((x) => x.t === 'thrust');
    assert.ok(fired && (p.weapons[0].burst ?? 0) > 0, '刺出第一枪，第二枪还没补');
    w.waveLen = w.waveT + DT; // 这一波马上结束
    for (let i = 0; i < 600 && w.phase !== 'shop'; i++) step(w, [idle]);
    assert.equal(w.phase, 'shop');
    p.levelOffers = [];
    p.pendingLevels = 0;
    step(w, [idle], [{ t: 'ready', player: 0 }]);
    assert.equal(w.phase, 'wave');
    w.spawnAcc = -1e12; // 场上一只敌人都没有
    const ev: SimEvent[] = [];
    for (let i = 0; i < 40; i++) ev.push(...step(w, [idle]));
    assert.equal(ev.filter((x) => x.t === 'thrust').length, 0, `${tier} 品：开波没对着空地刺`);
    assert.equal(w.zones.filter((z) => z.kind === 'fireTrail').length, 0, '也没留火痕');
  }
});

test('区域上限：同一个人同一种区域，没在收尾的最多 ZONE_CAP 块（多了一次收掉最早的几块，淡出 ZONE_FADE 秒），高攻速也铺不满地', () => {
  const { w } = arena(85, null);
  let most = 0;
  let mostAll = 0;
  for (let i = 0; i < 60; i++) {
    addZone(w, { owner: 0, kind: 'fireTrail', x: 100 + i, y: 100, x2: 140 + i, y2: 100, r: 8, life: 3, dmg: 1, tier: 3 });
    for (let j = 0; j < 6; j++) step(w, [idle]); // 每 0.1 秒放一块
    const mine = w.zones.filter((z) => z.owner === 0 && z.kind === 'fireTrail');
    most = Math.max(most, mine.filter((z) => z.life - z.t > ZONE_FADE).length);
    mostAll = Math.max(mostAll, mine.length);
  }
  assert.ok(most <= ZONE_CAP, `没在收尾的最多 ${most} 块`);
  assert.ok(mostAll <= ZONE_CAP + Math.ceil(ZONE_FADE / 0.1) + 1, `连同正在淡出的最多 ${mostAll} 块（原来稳定在 30 块）`);
  // 梨花枪、攻速到上限、身前一直有敌人：火痕不超过上限太多（原来最多 27 道）
  const { w: w2, p } = arena(86, 'huojian', 4, 'storm');
  p.stats.haste = 1;
  const foes = ring(w2, 8, 40, 90);
  let trails = 0;
  run(w2, foes, 10, () => (trails = Math.max(trails, w2.zones.filter((z) => z.kind === 'fireTrail' && z.life - z.t > ZONE_FADE).length)));
  assert.ok(trails <= ZONE_CAP, `梨花枪同时最多 ${trails} 道火痕`);
});
