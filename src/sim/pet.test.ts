import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, spawnEnemy, step, type PlayerInput, type SimEvent, type World } from './world.ts';
import { DT } from './config.ts';
import { PET } from './pet.ts';
import type { EnemyKindName, PetMode } from './types.ts';

// 混天绫（src/sim/pet.ts）：一直在飞，掠过敌群时顺路缠住扫到的敌人；不打伤害，只上减益。

const idle: PlayerInput = { mx: 0, my: 0, skill: false };
/** 一个干净的测试场：普通波里关掉刷怪，人物不带法宝、打不死（只看宠物）。 */
function arena(seed: number) {
  const w = createWorld(seed);
  w.wave = 3;
  w.waveLen = 1e9;
  w.spawnAcc = -1e12;
  w.eliteDone = true;
  w.surgeDone = true;
  const p = w.players[0];
  p.weapons = [];
  p.iframes = 1e12;
  p.hp = p.stats.maxHp = 1e9;
  return { w, p };
}
const enemy = (w: World, kind: EnemyKindName, x: number, y: number, hp = 500, speed = 0) => {
  const e = spawnEnemy(w, kind, x, y, []);
  e.hp = e.maxHp = hp;
  e.speed = speed;
  e.x = e.px = x;
  e.y = e.py = y;
  return e;
};
/** 一群（cols 列 × rows 行，间距 12 像素），左上角在 (x, y)。 */
const group = (w: World, x: number, y: number, cols = 3, rows = 3) =>
  Array.from({ length: cols * rows }, (_, i) => enemy(w, 'soldier', x + (i % cols) * 12, y + Math.floor(i / cols) * 12));

interface Frame {
  t: number;
  x: number; // 绸带头
  y: number;
  vx: number;
  vy: number;
  mode: PetMode;
  mx: number; // 主人
  my: number;
  ev: SimEvent[];
  hit: { id: number; x: number; y: number }[]; // 这一帧被缠住的敌人当时的位置
}
/** 跑 seconds 秒，逐帧记下宠物的位置、速度、状态、主人的位置和这一帧的事件。 */
function fly(w: World, seconds: number, input: (w: World) => PlayerInput = () => idle): Frame[] {
  const out: Frame[] = [];
  const p = w.players[0];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const ev = step(w, [input(w)]);
    const hit: Frame['hit'] = [];
    for (const e of ev)
      if (e.t === 'wrap')
        for (const id of e.ids) {
          const en = w.enemies.find((o) => o.id === id)!;
          hit.push({ id, x: en.x, y: en.y });
        }
    const pet = p.pet;
    out.push({ t: w.time, x: pet.x, y: pet.y, vx: pet.vx, vy: pet.vy, mode: pet.mode, mx: p.x, my: p.y, ev, hit });
  }
  return out;
}
const wraps = (fs: Frame[]) => fs.flatMap((f) => f.ev.filter((e) => e.t === 'wrap'));
/** 每一趟掠过开始的时刻。 */
const sweepStarts = (fs: Frame[]) => fs.filter((f, i) => f.mode === 'sweep' && (i === 0 || fs[i - 1].mode !== 'sweep')).map((f) => f.t);
/** 绸带头正下方的地面离主人多远。 */
const fromMaster = (f: Frame) => Math.hypot(f.x - f.mx, f.y + PET.hover - f.my);

// 几种场景：没有敌人；右前方一群；左上一群；四面八方慢慢逼近；主人绕着圈跑、敌人散在四周
type Scene = { name: string; setup: (w: World) => void; input?: (w: World) => PlayerInput; still?: boolean };
const SCENES: Scene[] = [
  { name: '没有敌人', setup: () => {}, still: true },
  { name: '右前方一群', setup: (w) => void group(w, w.players[0].x + 58, w.players[0].y - 16), still: true },
  { name: '左上一群', setup: (w) => void group(w, w.players[0].x - 86, w.players[0].y - 70), still: true },
  {
    name: '四面八方逼近',
    setup: (w) => {
      const p = w.players[0];
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2 + 0.3;
        const d = 72 + (i % 3) * 13;
        enemy(w, 'soldier', p.x + Math.cos(a) * d, p.y + Math.sin(a) * d * 0.75, 500, 6);
      }
    },
  },
  {
    name: '主人绕圈跑',
    setup: (w) => {
      const p = w.players[0];
      for (let i = 0; i < 24; i++) enemy(w, 'soldier', p.x - 200 + (i % 8) * 50, p.y + (Math.floor(i / 8) - 1) * 40, 500, 20);
    },
    input: (w) => ({ mx: Math.cos(w.time * 0.5), my: Math.sin(w.time * 0.5) * 0.6, skill: false }),
  },
];

test('混天绫一直在动：空闲、掠过、主人跑动时都不停；转弯有上限，走的是平滑的弧线', () => {
  for (const sc of SCENES) {
    const { w } = arena(31);
    sc.setup(w);
    const fs = fly(w, 9, sc.input);
    let minSp = Infinity;
    let maxTurn = 0;
    for (let i = 1; i < fs.length; i++) {
      const a = fs[i - 1];
      const b = fs[i];
      minSp = Math.min(minSp, Math.hypot(b.x - a.x, b.y - a.y) / DT);
      if (sc.still) {
        // 主人不动时：速度方向每帧转过的角度不超过转向上限（主人跑起来时会被拴绳拽一下，不算在内）
        const d = Math.atan2(a.vx * b.vy - a.vy * b.vx, a.vx * b.vx + a.vy * b.vy);
        maxTurn = Math.max(maxTurn, Math.abs(d) / DT);
      }
    }
    assert.ok(minSp > 8, `${sc.name}：最慢 ${minSp.toFixed(1)} 像素/秒，不该停下`);
    if (sc.still) assert.ok(maxTurn <= 7 + 1e-6, `${sc.name}：转得最快 ${maxTurn.toFixed(2)} 弧度/秒`);
  }
});

test('混天绫从不停在敌人身上：绸带头正下方离同一只敌人 12 像素以内，最多连续 0.4 秒', () => {
  for (const sc of SCENES.slice(1, 3)) {
    const { w } = arena(32);
    sc.setup(w);
    const fs = fly(w, 10);
    const near = new Map<number, number>();
    let worst = 0;
    for (const f of fs)
      for (const e of w.enemies) {
        const t = Math.hypot(e.x - f.x, e.y - (f.y + PET.hover)) < 12 ? (near.get(e.id) ?? 0) + DT : 0;
        near.set(e.id, t);
        worst = Math.max(worst, t);
      }
    assert.ok(worst <= 0.4, `${sc.name}：在一只敌人上方连续待了 ${worst.toFixed(2)} 秒`);
    assert.ok(wraps(fs).length > 0, `${sc.name}：掠过时缠到了`);
  }
});

test('掠过时缠住路径附近的敌人：缠住的那一刻绸带头正下方离它不超过 16 像素、正在高速飞；一趟能缠好几只、同一只一趟只缠一次', () => {
  const { w, p } = arena(33);
  group(w, p.x + 58, p.y - 16);
  const fs = fly(w, 9);
  const starts = sweepStarts(fs);
  assert.ok(starts.length >= 3, `9 秒里掠了 ${starts.length} 趟`);
  for (const f of fs)
    for (const h of f.hit) {
      const d = Math.hypot(h.x - f.x, h.y - (f.y + PET.hover));
      assert.ok(d <= PET.hitR + 1e-6, `缠住时离绸带头 ${d.toFixed(1)} 像素`);
      assert.notEqual(f.mode, 'follow', '只在掠过（和顺势兜回来的那一段）时缠');
      assert.ok(Math.hypot(f.vx, f.vy) >= 100, '缠住时正在高速飞（穿过去，不停下）');
    }
  // 每一趟：缠了几只、有没有重复
  for (let k = 0; k < starts.length; k++) {
    const seg = fs.filter((f) => f.t >= starts[k] && (k + 1 >= starts.length || f.t < starts[k + 1]));
    const ids = seg.flatMap((f) => f.hit.map((h) => h.id));
    assert.equal(new Set(ids).size, ids.length, '同一只一趟只缠一次');
    assert.ok(ids.length <= PET.targets[0], '一趟最多缠 PET.targets 只');
    if (k < starts.length - 1) assert.ok(ids.length >= 3, `第 ${k + 1} 趟穿过一群九只，缠到了 ${ids.length} 只`);
  }
});

test('只缠主人身边 100 像素内的敌人；混天绫离主人不超过 110 像素（主人跑动时也一样）', () => {
  const { w, p } = arena(34);
  const far = [...group(w, p.x + 106, p.y - 14, 3, 2), ...group(w, p.x - 140, p.y - 30, 2, 2), ...group(w, p.x - 10, p.y + 104, 2, 1)];
  const near = enemy(w, 'soldier', p.x + 40, p.y + 46);
  const fs = fly(w, 12);
  const got = new Set(wraps(fs).flatMap((e) => (e.t === 'wrap' ? e.ids : [])));
  for (const e of far) assert.ok(!got.has(e.id), '100 像素外的不缠');
  assert.ok(got.has(near.id), '100 像素内的缠');
  for (const sc of [...SCENES, { name: '敌人都在 100 像素的边上', setup: (w: World) => {
    const p = w.players[0];
    for (let i = 0; i < 8; i++) enemy(w, 'soldier', p.x + Math.cos(i * 0.785) * 97, p.y + Math.sin(i * 0.785) * 97);
  } }] as Scene[]) {
    const { w: w2 } = arena(35);
    sc.setup(w2);
    const worst = Math.max(...fly(w2, 12, sc.input).map(fromMaster));
    assert.ok(worst <= PET.leash + 1e-6, `${sc.name}：离主人最远 ${worst.toFixed(1)} 像素`);
  }
});

test('混天绫不打伤害，只上减益：缠住的敌人减速约七成、易伤（破绽）、身上绑着红绫、带水行印记', () => {
  const { w, p } = arena(36);
  const es = group(w, p.x + 58, p.y - 16);
  const fs = fly(w, 6);
  assert.equal(fs.flatMap((f) => f.ev).filter((e) => e.t === 'hit' || e.t === 'kill').length, 0, '宠物不打伤害');
  for (const e of es) assert.equal(e.hp, 500);
  const wrapped = es.filter((e) => e.wrapT > 0);
  assert.ok(wrapped.length >= 3, `缠住了 ${wrapped.length} 只`);
  for (const e of wrapped) {
    assert.ok(Math.abs(e.slow - Math.min(0.85, PET.slow * 1.15)) < 1e-9 && e.slowT > 0, '减速（混天绫自己算一件水行：水行一件减速 ×1.15）');
    assert.ok(e.vuln >= PET.vuln[0] && e.vulnT > 0, '破绽');
    assert.equal(e.mark, 'water', '水行印记（混天绫是水行宠物，用户 11-12）');
    assert.ok(e.wrapMax >= e.wrapT);
  }
  // 敌人都没了：回到主人身后飘着
  w.enemies = [];
  const back = fly(w, 3);
  const last = back[back.length - 1];
  assert.equal(last.mode, 'follow');
  assert.ok(Math.hypot(last.x - p.x, last.y - p.y) < 50);
});

test('节奏：主人身边一直有敌人时一趟一趟地掠，两趟之间约 2.7 秒（三阶缩到 85%）', () => {
  for (const stage of [0, 3]) {
    const { w, p } = arena(37);
    p.pet.stage = stage;
    group(w, p.x + 58, p.y - 16);
    group(w, p.x - 90, p.y + 10, 2, 2);
    const starts = sweepStarts(fly(w, 12));
    assert.ok(starts.length >= 4, `12 秒里掠了 ${starts.length} 趟`);
    const want = PET.cd * (stage >= 3 ? 0.85 : 1);
    for (let i = 1; i < starts.length; i++) {
      const gap = starts[i] - starts[i - 1];
      assert.ok(gap >= want - 0.05 && gap <= want + 0.5, `第 ${i} 趟和上一趟隔了 ${gap.toFixed(2)} 秒`);
    }
  }
});

test('空闲：在主人身后稍远处（离上半身 26–34 像素上下）沿「8」字慢慢飘，主人转身时它绕到另一边', () => {
  const { w, p } = arena(38);
  fly(w, 2);
  const fs = fly(w, 6);
  for (const f of fs) {
    const d = Math.hypot(f.x - f.mx, f.y - (f.my - PET.idle.lift));
    assert.ok(d >= 20 && d <= 40, `离主人上半身 ${d.toFixed(1)} 像素`);
    assert.equal(f.mode, 'follow');
  }
  const behind = fs.filter((f) => (f.x - f.mx) * p.facing < 0).length / fs.length;
  assert.ok(behind > 0.9, `在身后的时间占 ${(behind * 100).toFixed(0)}%`);
  const sp = fs.slice(1).map((f, i) => Math.hypot(f.x - fs[i].x, f.y - fs[i].y) / DT);
  assert.ok(Math.max(...sp) < 45, `空闲时飘得慢（最快 ${Math.max(...sp).toFixed(1)} 像素/秒）`);
  // 转身：往左走两秒，它飘到右边（新的身后）
  fly(w, 2, () => ({ mx: -1, my: 0, skill: false }));
  const turned = fly(w, 2.5);
  assert.ok(turned.slice(-60).every((f) => f.x > f.mx), '转身之后飘到另一边');
});

test('进化分支：缚龙定身更久（首领不吃）；火绫「引火」只给小怪，不给首领（免得变成打首领的一档伤害加成）', () => {
  for (const branch of [null, 'bind', 'fire'] as const) {
    const { w, p } = arena(39);
    p.pet.stage = 1;
    p.pet.branch = branch;
    const s = enemy(w, 'soldier', p.x + 60, p.y - 10);
    const b = enemy(w, 'boss', p.x + 66, p.y + 4, 9999);
    let stun = 0;
    let fireS = false;
    let fireB = false;
    let bossWrapped = false;
    for (let i = 0; i < 8 / DT; i++) {
      step(w, [idle]);
      stun = Math.max(stun, s.stun);
      if (s.fireVulnT > 0) fireS = true;
      if (b.fireVulnT > 0) fireB = true;
      if (b.wrapT > 0) bossWrapped = true;
      assert.ok(b.stun <= 0, '首领不被定身');
    }
    assert.ok(bossWrapped, '首领也会被缠（减速、破绽照常）');
    assert.ok(stun > 0, '缠上那一下勒住（定身一小会儿）');
    if (branch === 'bind') assert.ok(stun > PET.jolt + 0.3, `缚龙：定身更久（${stun.toFixed(2)} 秒）`);
    else assert.ok(stun <= PET.jolt + 1e-9, '别的分支只勒住一下');
    assert.equal(fireS, branch === 'fire', '只有火绫引火');
    assert.ok(!fireB, '首领不引火');
  }
});

test('确定性：同种子同输入，混天绫的轨迹和缠住的敌人完全一样；换个种子（敌人速度不同）就不一样', () => {
  const play = (seed: number) => {
    const w = createWorld(seed);
    w.wave = 3;
    w.waveLen = 1e9;
    w.spawnAcc = -1e12;
    w.eliteDone = true;
    w.surgeDone = true;
    const p = w.players[0];
    p.weapons = [];
    p.iframes = 1e12;
    // 30 只（多于 16 只时挑群会用 w.rng 抽样），速度按种子随机
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2;
      const e = spawnEnemy(w, 'soldier', p.x + Math.cos(a) * (60 + (i % 4) * 12), p.y + Math.sin(a) * (50 + (i % 4) * 10), []);
      e.hp = e.maxHp = 1e6;
    }
    const fs = fly(w, 10, (w) => ({ mx: Math.sin(w.time * 0.7), my: Math.cos(w.time * 0.4) * 0.5, skill: false }));
    return fs.map((f) => `${f.x.toFixed(4)},${f.y.toFixed(4)},${f.mode},${f.hit.map((h) => h.id).join('/')}`).join(';');
  };
  const a = play(51);
  assert.equal(a, play(51));
  assert.notEqual(a, play(52));
});
