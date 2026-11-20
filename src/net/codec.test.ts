// 状态编码的测试：两个人的机器人局跑几波，每 4 帧（15Hz）编一次差量、过一遍 JSON、打到镜像上，镜像必须和房主那边的纯数据一致；
// 顺带量一下每秒多少字节（结果打在测试输出里）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, step, type SimEvent } from '../sim/world.ts';
import { botInput, botShop } from '../sim/bot.ts';
import { apply, diffObj, fullPatch, plain, plainWorld, shiftPrev, type Plain, type PlainObj } from './codec.ts';

/** 去掉镜像自己补的 px / py / pa，再和房主的纯数据比。 */
function strip(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(strip);
  if (typeof v !== 'object' || v === null) return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) if (k !== 'px' && k !== 'py' && k !== 'pa') out[k] = strip(x);
  return out;
}

test('状态差量：镜像和房主一致（波中、收灵、商店、首领战），并量带宽', () => {
  const w = createWorld(11, 2);
  let shadow: PlainObj = {};
  const mirror: Record<string, unknown> = {};
  let bytes = 0;
  let evBytes = 0;
  let sends = 0;
  let maxMsg = 0;
  let evs: SimEvent[] = [];
  const phases = new Set<string>();
  let shopT = 0;
  for (let f = 0; f < 60 * 60 * 6 && w.phase !== 'over' && w.phase !== 'win'; f++) {
    const shop = w.phase === 'shop';
    shopT = shop ? shopT + 1 : 0;
    const cmds = shop && shopT % 20 === 0 ? w.players.flatMap((_, i) => botShop(w, i)) : [];
    const ev = step(w, w.players.map((_, i) => (shop ? { mx: 0, my: 0, skill: false } : botInput(w, i, 0.6))), cmds);
    evs.push(...ev);
    if (f % 4) continue;
    const next = plainWorld(w);
    const d = sends === 0 ? fullPatch(next) : diffObj(shadow, next);
    shadow = next;
    const msg = JSON.stringify({ k: w.tick, d: d ?? null, e: plain(evs, 'ev') });
    evBytes += JSON.stringify(plain(evs, 'ev')).length;
    evs = [];
    bytes += msg.length;
    maxMsg = Math.max(maxMsg, msg.length);
    sends++;
    const got = JSON.parse(msg) as { d: PlainObj | null };
    shiftPrev(mirror);
    if (got.d) apply(mirror, got.d);
    phases.add(w.phase + (w.boss ? '+boss' : ''));
    if (sends % 50 === 0 || w.boss) assert.deepEqual(strip(mirror), strip(shadow), `第 ${w.tick} 帧（${w.phase}）镜像和房主不一致`);
  }
  assert.deepEqual(strip(mirror), strip(shadow));
  const secs = sends / 15;
  console.log(`[codec] ${Math.round(secs)} 秒、${sends} 次广播：平均每秒 ${(bytes / secs / 1024).toFixed(1)} KB（其中事件 ${(evBytes / secs / 1024).toFixed(1)} KB），最大一条 ${(maxMsg / 1024).toFixed(1)} KB；整份 ${(JSON.stringify(fullPatch(shadow)).length / 1024).toFixed(1)} KB；经过的阶段 ${[...phases].join(' ')}`);
  for (const p of ['wave', 'collect', 'shop']) assert.ok([...phases].some((x) => x.startsWith(p)), `没跑到 ${p}`);
});

test('状态差量：对象数组按 id 增删改、整份换掉的数组、删掉的键', () => {
  const a: PlainObj = { enemies: [{ id: 1, x: 1, y: 2 }, { id: 2, x: 5, y: 5 }], shop: [{ k: 'a' }, null], boss: { hp: 3, t: 1 }, gone: 1 };
  const b: PlainObj = { enemies: [{ id: 2, x: 6, y: 5 }, { id: 3, x: 0, y: 0 }], shop: [null, null], boss: { hp: 2, t: 1 } };
  const d = diffObj(a, b)!;
  // 位置打包在 '@' 里：[id, x×10, y×10]
  assert.deepEqual(d.enemies, { '#': [[3, { id: 3, x: 0, y: 0 }]], '@': [2, 60, 50], '~': [1] });
  assert.deepEqual(d.shop, [null, null]);
  assert.deepEqual(d.boss, { hp: 2 });
  assert.deepEqual(d['-'], ['gone']);
  const m = apply(structuredClone(a) as Record<string, unknown>, JSON.parse(JSON.stringify(d)));
  assert.deepEqual(strip(m), b);
  // 没变就没有差
  assert.equal(diffObj(b, structuredClone(b)), undefined);
  // 插值：shiftPrev 之后 px = 旧的 x
  const mm = apply({}, fullPatch(a)) as { enemies: { px: number; x: number }[] };
  shiftPrev(mm);
  apply(mm as Record<string, unknown>, d);
  const e2 = mm.enemies.find((e) => (e as unknown as { id: number }).id === 2)!;
  assert.equal(e2.px, 5);
  assert.equal(e2.x, 6);
});

test('纯数据：取整、跳过 Set / Map / 随机数 / 内部字段', () => {
  const p = plain({ x: 1.23456, t: 0.123456, s: new Set([1]), m: new Map(), f: () => 1, n: NaN, i: Infinity, px: 3 }) as Record<string, Plain>;
  assert.deepEqual(p, { x: 1.2, t: 0.12, n: 0, i: 1e9 });
  const w = createWorld(3, 1);
  const pw = plainWorld(w);
  assert.ok(!('rng' in pw));
  assert.ok(!('px' in (pw.players as PlainObj[])[0]));
  assert.ok(!('seekT' in ((pw.players as PlainObj[])[0].pet as PlainObj)));
});

test('状态差量：前面掉几个、后面接几个的数组（风火轮的火痕）只发变的那一头', () => {
  const pts = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => ({ x: a + i, y: 1, t: (a + i) / 10 }));
  const a: PlainObj = { trail: pts(0, 20) };
  const b: PlainObj = { trail: pts(3, 22) };
  const d = diffObj(a, b)!;
  assert.deepEqual(d.trail, { '<': 3, '+': pts(20, 22) });
  const m = apply(structuredClone(a) as Record<string, unknown>, JSON.parse(JSON.stringify(d)));
  assert.deepEqual(strip(m), b);
  // 对不上这个样子：整个换掉
  const c: PlainObj = { trail: pts(50, 60) };
  assert.deepEqual(diffObj(a, c)!.trail, c.trail);
});
