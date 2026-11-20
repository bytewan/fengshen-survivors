// 预烘焙图集（pixelfx-pack.ts）：裁空白、排版、还原出来要和直接画的一模一样。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearFrame, composite, createFrame, createFx, type FxModule } from '../../vendor/pixelfx/src/core/index.js';
import { bakeAtlas, packBest, packShelves, trimBounds, type Atlas } from './pixelfx-pack.ts';
import { XFX } from './pixelfx-xianxia.ts';

// 特效文件是没有类型声明的 JS，按路径动态载入再当成 FxModule 用
const load = async (id: string) => (await import(new URL(`../../vendor/pixelfx/src/fx/${id}.js`, import.meta.url).href)) as FxModule;
const tianlei = await load('xianxia/tianlei');
const burning = await load('status/burning');

const rgba = (w: number, h: number, on: [number, number][]) => {
  const b = new Uint8Array(w * h * 4);
  for (const [x, y] of on) b[(y * w + x) * 4 + 3] = 255;
  return b;
};

test('trimBounds：空帧是 null，否则是包住所有不透明像素的最小矩形', () => {
  assert.equal(trimBounds(rgba(8, 6, []), 8, 6), null);
  assert.deepEqual(trimBounds(rgba(8, 6, [[3, 2]]), 8, 6), { x: 3, y: 2, w: 1, h: 1 });
  assert.deepEqual(trimBounds(rgba(8, 6, [[1, 4], [6, 1], [3, 3]]), 8, 6), { x: 1, y: 1, w: 6, h: 4 });
  assert.deepEqual(trimBounds(rgba(8, 6, [[0, 0], [7, 5]]), 8, 6), { x: 0, y: 0, w: 8, h: 6 });
});

test('packShelves：按顺序排，不重叠、不出界、留出间隔；排不下就换行、换张；空帧原样留空', () => {
  const sizes = [{ w: 30, h: 10 }, null, { w: 30, h: 20 }, { w: 50, h: 5 }, { w: 64, h: 64 }, { w: 10, h: 40 }, null, { w: 20, h: 30 }];
  const { pages, at } = packShelves(sizes, 64, 1);
  assert.equal(at.length, sizes.length);
  assert.equal(at[1], null);
  assert.equal(at[6], null);
  const rects = sizes.flatMap((s, i) => (s && at[i] ? [{ ...at[i], w: s.w, h: s.h }] : []));
  assert.equal(rects.length, 6);
  for (const r of rects) {
    const p = pages[r.page];
    assert.ok(p, `第 ${r.page} 张不存在`);
    assert.ok(p.w <= 64 && p.h <= 64, `大图 ${p.w}×${p.h} 超过上限`);
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= p.w && r.y + r.h <= p.h, `出界：${JSON.stringify(r)} 在 ${p.w}×${p.h} 里`);
  }
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      if (a.page !== b.page) continue;
      // 留了 1 像素间隔：把 a 四周各扩 1 像素后仍然不和 b 相交
      const apart = a.x + a.w + 1 <= b.x || b.x + b.w + 1 <= a.x || a.y + a.h + 1 <= b.y || b.y + b.h + 1 <= a.y;
      assert.ok(apart, `挨在一起了：${JSON.stringify(a)} 和 ${JSON.stringify(b)}`);
    }
  assert.ok(pages.length >= 2, '64×64 的那一帧应该把后面的挤到新的一张');
  for (let i = 1; i < rects.length; i++) assert.ok(rects[i].page >= rects[i - 1].page, '页码应该按顺序递增');
  assert.throws(() => packShelves([{ w: 65, h: 1 }], 64), /比图集上限/);
  assert.deepEqual(packShelves([], 64), { pages: [], at: [] });
  assert.deepEqual(packShelves([null, null], 64), { pages: [], at: [null, null] });
});

test('packBest：挑最省的行宽——60 个差不多大的帧不该比不裁还费（最后一行排不满的浪费要小）', () => {
  const sizes = Array.from({ length: 60 }, (_, i) => ({ w: 70 + (i % 3), h: 118 + (i % 2) }));
  const raw = 60 * 72 * 120;
  const naive = packShelves(sizes, 2048, 1).pages.reduce((t, g) => t + g.w * g.h, 0);
  const best = packBest(sizes, 2048, 1);
  const area = best.pages.reduce((t, g) => t + g.w * g.h, 0);
  assert.equal(best.pages.length, 1);
  assert.ok(area <= naive, `挑出来的 ${area} 不该比固定行宽的 ${naive} 大`);
  assert.ok(area < raw * 1.06, `60 帧排好是 ${area} 像素，不裁是 ${raw}：浪费不该超过 6%`);
  // 位置仍然不重叠、不出界
  const rects = sizes.map((s, i) => ({ ...best.at[i]!, w: s.w, h: s.h }));
  for (const r of rects) assert.ok(r.x + r.w <= best.pages[0].w && r.y + r.h <= best.pages[0].h);
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      assert.ok(a.x + a.w + 1 <= b.x || b.x + b.w + 1 <= a.x || a.y + a.h + 1 <= b.y || b.y + b.h + 1 <= a.y, `重叠：${i} 和 ${j}`);
    }
  assert.deepEqual(packBest([], 64), { pages: [], at: [] });
  assert.deepEqual(packBest([null], 64), { pages: [], at: [null] });
  assert.throws(() => packBest([{ w: 65, h: 1 }], 64), /比图集上限/);
});

/** 直接把第 i 帧画出来（和 bakeAtlas 走同样的步子）。 */
function direct(mod: FxModule, opts: Record<string, unknown>, upTo: number) {
  const [w, h] = mod.meta.size;
  const [ox0, oy0] = mod.meta.origin;
  const fps = mod.meta.fps ?? 30;
  const fx = createFx(mod, { ...opts, x: ox0, y: oy0 });
  const frame = createFrame(w, h, 0, 0);
  const out: Uint8Array[] = [];
  for (let i = 0; i <= upTo; i++) {
    if (i > 0) fx.update(1 / fps);
    clearFrame(frame);
    fx.draw(frame);
    out.push(composite(frame, new Uint8Array(w * h * 4), null, 1));
  }
  return out;
}

/** 从图集把第 i 帧还原成原画布大小的 RGBA。 */
function restore(a: Atlas, i: number) {
  const out = new Uint8Array(a.w * a.h * 4);
  const f = a.frames[i];
  if (!f) return out;
  const page = a.pages[f.page];
  for (let y = 0; y < f.h; y++) {
    const from = ((f.y + y) * page.w + f.x) * 4;
    out.set(page.data.subarray(from, from + f.w * 4), ((f.dy + y) * a.w + f.dx) * 4);
  }
  return out;
}

/** 两帧「看起来」一样：透明的像素不管颜色，其余逐字节相同。 */
function sameVisible(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] !== b[i + 3]) return false;
    if (a[i + 3] === 0) continue;
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) return false;
  }
  return true;
}

test('bakeAtlas（天雷符）：每一帧从图集还原出来和直接画的一样；省显存；一次性的特效最后收干净', () => {
  const mod = tianlei;
  const opts = XFX.thunder.opts;
  const a = bakeAtlas(mod, opts);
  assert.equal(a.frames.length, 90); // 3 秒 × 30 帧
  assert.equal(a.loop, false);
  assert.deepEqual([a.w, a.h, a.ox0, a.oy0], [240, 264, 120, 228]);
  const ref = direct(mod, opts, a.frames.length - 1);
  for (let i = 0; i < a.frames.length; i++) assert.ok(sameVisible(restore(a, i), ref[i]), `第 ${i} 帧和直接画的不一样`);
  for (const p of a.pages) assert.ok(p.w <= 2048 && p.h <= 2048 && p.data.length === p.w * p.h * 4);
  const full = a.frames.length * a.w * a.h;
  assert.ok(a.pixels < full / 2, `图集 ${a.pixels} 像素，不裁是 ${full}：应该省掉一半以上`);
  assert.ok(a.pages.length <= 2, `天雷符应该一两张大图就放得下，实际 ${a.pages.length} 张`);
  const last = a.frames[a.frames.length - 1];
  assert.ok(!last || last.w * last.h < 400, '最后一帧应该已经（几乎）收干净');
});

test('bakeAtlas：同样的输入得到同样的图集（确定）；换种子就不一样', () => {
  const mod = tianlei;
  const a = bakeAtlas(mod, XFX.thunder.opts);
  const b = bakeAtlas(mod, XFX.thunder.opts);
  assert.deepEqual(a.frames, b.frames);
  assert.equal(a.pages.length, b.pages.length);
  for (let i = 0; i < a.pages.length; i++) assert.ok(Buffer.from(a.pages[i].data).equals(Buffer.from(b.pages[i].data)), `第 ${i} 张两次不一样`);
  const c = bakeAtlas(mod, { ...XFX.thunder.opts, seed: 9 });
  assert.notDeepEqual(a.frames, c.frames);
});

test('bakeAtlas（灼烧，循环的）：帧数是一圈的长度，每帧都有内容，还原出来和直接画的一样', () => {
  const mod = burning;
  const opts = XFX.burning.opts;
  const a = bakeAtlas(mod, opts);
  assert.equal(a.loop, true);
  assert.equal(a.frames.length, Math.round((mod.meta.duration ?? 1) * (mod.meta.fps ?? 30)));
  assert.ok(a.frames.every((f) => f !== null), '循环的特效不该有空帧');
  const ref = direct(mod, opts, a.frames.length - 1);
  for (let i = 0; i < a.frames.length; i++) assert.ok(sameVisible(restore(a, i), ref[i]), `第 ${i} 帧和直接画的不一样`);
});
