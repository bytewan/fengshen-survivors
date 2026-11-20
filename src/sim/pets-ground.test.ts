// 贴地跑的四只宠物（哮天犬、黑虎、避水兽、毫毛猴）的跟随与出手（用户 2026-11-12 的口径，pets/heel.ts）：
// 空闲时离主人在距离带里（不小于最近距离，不贴脚边）；它自己的出手范围里有敌人就出手（哪怕那只离主人超过 100 像素）；
// 范围里没有敌人、离主人远了就跑回来；冲完一趟不停在敌人身上（毫毛猴自己不冲，分身窜过去就散，猴子不离开距离带）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, spawnEnemy, step, type PlayerInput, type SimEvent, type World } from './world.ts';
import { DT } from './config.ts';
import { BISHUI, HEIHU, MAOHOU, XIAOTIAN } from './pet.ts';
import type { Heel } from './pets/heel.ts';
import type { HeroId } from './types.ts';

const idle: PlayerInput = { mx: 0, my: 0, skill: false };
/** 四只：主人是谁、距离带、出手时发的事件。 */
const PETS: { name: string; hero: HeroId; band: Heel; act: SimEvent['t'] }[] = [
  { name: '哮天犬', hero: 'yangjian', band: XIAOTIAN.band, act: 'bite' },
  { name: '黑虎', hero: 'zhao', band: HEIHU.band, act: 'roar' },
  { name: '避水兽', hero: 'huiao', band: BISHUI.band, act: 'splash' },
  { name: '毫毛猴', hero: 'wukong', band: MAOHOU.band, act: 'hair' },
];

/** 干净的测试场：刷怪关掉，人物不带法宝、打不死；宠物冷却先拉满（要测出手的自己放开）。 */
function arena(hero: HeroId) {
  const w = createWorld(7, 1, [hero]);
  w.wave = 3;
  w.waveLen = 1e9;
  w.spawnAcc = -1e12;
  w.eliteDone = true;
  w.surgeDone = true;
  const p = w.players[0];
  p.weapons = [];
  p.iframes = 1e12;
  p.pet.cd = 1e12;
  return { w, p };
}
const foe = (w: World, x: number, y: number) => {
  const e = spawnEnemy(w, 'soldier', x, y, []);
  e.hp = e.maxHp = 1e7;
  e.speed = 0;
  e.x = e.px = x;
  e.y = e.py = y;
  return e;
};
const dist = (w: World) => {
  const p = w.players[0];
  return Math.hypot(p.pet.x - p.x, p.pet.y - p.y);
};

for (const P of PETS) {
  const B = P.band;
  test(`${P.name}：空闲时离主人在距离带里（不小于 ${B.min}、不远过 ${B.far}），主人走的时候跟在带里`, () => {
    const { w } = arena(P.hero);
    // 站着 2 秒 → 往右走 3 秒 → 站 2 秒 → 掉头往左走 3 秒 → 站 2 秒；量站着、走直线时（过了头 0.8 秒的起步）的距离
    const plan: [number, number][] = [
      [0, 2],
      [1, 3],
      [0, 2],
      [-1, 3],
      [0, 2],
    ];
    let lo = 1e9;
    let hi = 0;
    let anyLo = 1e9;
    for (const [mx, secs] of plan) {
      const n = Math.round(secs / DT);
      for (let i = 0; i < n; i++) {
        step(w, [{ mx, my: 0, skill: false }]);
        const d = dist(w);
        anyLo = Math.min(anyLo, d);
        if (i * DT > 0.8) {
          lo = Math.min(lo, d);
          hi = Math.max(hi, d);
        }
      }
    }
    assert.ok(lo >= B.min - 1e-6, `站着 / 走直线时最近 ${lo.toFixed(1)}`);
    assert.ok(hi <= B.far + 1e-6, `站着 / 走直线时最远 ${hi.toFixed(1)}`);
    assert.ok(anyLo >= B.min * 0.75, `掉头绕过去的时候也不贴脚边：最近 ${anyLo.toFixed(1)}`);
    // 主人站着的时候它也停住（不来回抖）
    const p = w.players[0];
    const v = Math.hypot(p.pet.vx, p.pet.vy);
    assert.ok(v < 20, `站定以后慢下来了：${v.toFixed(1)}`);
  });

  test(`${P.name}：它自己的出手范围（${B.range}）里有敌人就出手，哪怕那只离主人超过 100 像素`, () => {
    const { w, p } = arena(P.hero);
    p.pet.cd = 0;
    // 宠物在主人身后（左边）约 rest 远：敌人放在左边 118 像素处（离主人 > 100，离宠物 < range）
    const e = foe(w, p.x - 118, p.y);
    assert.ok(Math.hypot(e.x - p.pet.x, e.y - p.pet.y) < B.range, '在宠物的出手范围里');
    const ev: SimEvent[] = [];
    for (let i = 0; i < Math.round(1.5 / DT); i++) ev.push(...step(w, [idle]));
    assert.ok(ev.some((x) => x.t === P.act), `出手了（${P.act}）`);
    // 对照：离宠物远过出手范围的（主人身前 60 像素，离宠物一百来像素）不出手
    const c = arena(P.hero);
    c.p.pet.cd = 0;
    const far = foe(c.w, c.p.x + 60, c.p.y);
    assert.ok(Math.hypot(far.x - c.p.pet.x, far.y - c.p.pet.y) > B.range);
    const ev2: SimEvent[] = [];
    for (let i = 0; i < Math.round(1.5 / DT); i++) ev2.push(...step(c.w, [idle]));
    assert.equal(ev2.filter((x) => x.t === P.act).length, 0, '范围外的不出手');
  });

  test(`${P.name}：范围里没有敌人、离主人远了（超过回归距离 ${B.back}）就跑回距离带`, () => {
    const { w, p } = arena(P.hero);
    p.pet.x = p.pet.px = p.x + 125;
    p.pet.y = p.pet.py = p.y + 10;
    const modes = new Set<string>();
    for (let i = 0; i < Math.round(2.5 / DT); i++) {
      step(w, [idle]);
      modes.add(p.pet.mode);
    }
    assert.ok(modes.has('return'), '快跑回来');
    const d = dist(w);
    assert.ok(d >= B.min && d <= B.far, `回到带里：${d.toFixed(1)}`);
    assert.equal(p.pet.mode, 'follow');
  });

  test(`${P.name}：一趟一趟地出手，冲完不停在敌人身上，也不离主人超过拴绳（${B.leash}）`, () => {
    const { w, p } = arena(P.hero);
    p.pet.cd = 0;
    const pack = Array.from({ length: 6 }, (_, i) => foe(w, p.x - 100 + (i % 3) * 9, p.y - 8 + Math.floor(i / 3) * 14));
    let stick = 0;
    let maxD = 0;
    let acts = 0;
    for (let i = 0; i < Math.round(6 / DT); i++) {
      const ev = step(w, [idle]);
      acts += ev.filter((x) => x.t === P.act).length;
      maxD = Math.max(maxD, dist(w));
      const sp = Math.hypot(p.pet.vx, p.pet.vy);
      if (sp < 10 && pack.some((e) => Math.hypot(e.x - p.pet.x, e.y - p.pet.y) < 10)) stick++;
    }
    // 冷却约 1.5–1.8 秒：6 秒里出手不止两趟（毫毛猴算吹了几次）
    assert.ok(acts >= 3, `出手 ${acts} 次`);
    assert.equal(stick, 0, '不停在敌人身上');
    assert.ok(maxD <= B.leash + 1e-6, `离主人最远 ${maxD.toFixed(1)}`);
    if (P.hero === 'wukong') assert.ok(maxD <= B.far + 1e-6, `毫毛猴自己不冲进敌群：最远 ${maxD.toFixed(1)}`);
  });
}
