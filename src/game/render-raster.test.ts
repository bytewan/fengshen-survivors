// 画面底层几块纯计算的测试：闪电的快速栅格化（要和 boltGrid 逐像素一样）、像素缓冲的叠色、笔画表、画布怎么摆进窗口。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../art/ground.ts';
import { toRgba } from '../art/pixel.ts';
import { boltGrid, type BoltPath, type BoltStyle } from '../art/sprites/fx.ts';
import { boltBox, rasterBolt } from '../render/bolt-raster.ts';
import { PixelBuffer, STROKE_TABLE_SIZE, StrokeTable, packXY, packable, unpackX, unpackY } from '../render/pixel-raster.ts';
import { MAX_UPSCALE, VIEW_H, VIEW_W, viewFit } from '../render/view-fit.ts';

test('闪电：快速栅格化和 boltGrid 逐像素一样（三种配色、三种粗细、带分叉、小数坐标）', () => {
  const rnd = mulberry32(20261110);
  const r = (a: number, b: number) => a + rnd() * (b - a);
  /** 一条随机折线（坐标带小数、可以是负的）。 */
  const poly = (n: number): [number, number][] => {
    let x = r(-200, 600);
    let y = r(-200, 400);
    const pts: [number, number][] = [[x, y]];
    for (let i = 0; i < n; i++) {
      x += r(-18, 18);
      y += r(-4, 24);
      pts.push([x, y]);
    }
    return pts;
  };
  for (let round = 0; round < 300; round++) {
    const style = (['azure', 'gold', 'violet'] as BoltStyle[])[round % 3];
    const main = poly(2 + Math.floor(rnd() * 20));
    const paths: BoltPath[] = [{ pts: main, w: ([1, 2, 3] as const)[Math.floor(rnd() * 3)] }];
    // 分叉：从主干上某一点岔出去；有的和主干同样粗细（先后次序要保持）
    for (let b = Math.floor(rnd() * 4); b > 0; b--) {
      const [bx, by] = main[Math.floor(rnd() * main.length)];
      const branch = poly(1 + Math.floor(rnd() * 5)).map(([x, y], i, all) => [bx + x - all[0][0], by + y - all[0][1]] as [number, number]);
      void branch[0];
      paths.push({ pts: branch, w: ([1, 1, 2, 3] as const)[Math.floor(rnd() * 4)] });
    }
    // 标准答案：字符网格 → RGBA
    const ref = boltGrid(paths, style);
    const want = new Uint32Array(toRgba(ref.g).buffer);
    // 快速画法：画进一块更宽的缓冲（每行 stride 个像素），再把那一块抠出来比
    const box = boltBox(paths);
    assert.deepEqual([box.ox, box.oy, box.w, box.h], [ref.ox, ref.oy, ref.g.w, ref.g.h], `第 ${round} 组：包围盒不一样`);
    const stride = box.w + 7;
    const px = new Uint32Array(stride * (box.h + 3));
    rasterBolt(paths, style, box, px, stride);
    for (let y = 0; y < box.h; y++)
      for (let x = 0; x < box.w; x++)
        if (px[y * stride + x] !== want[y * box.w + x]) assert.fail(`第 ${round} 组（${style}）：像素 (${x}, ${y}) 不一样，要 ${want[y * box.w + x].toString(16)}，得 ${px[y * stride + x].toString(16)}`);
    // 那一块之外不许动
    for (let y = 0; y < box.h + 3; y++) for (let x = y < box.h ? box.w : 0; x < stride; x++) assert.equal(px[y * stride + x], 0, `第 ${round} 组：画到了范围外 (${x}, ${y})`);
  }
});

test('像素坐标打包：范围内来回不变，范围外能挡住', () => {
  for (const [x, y] of [
    [0, 0],
    [-4096, -4096],
    [4095, 4095],
    [-1, 2047],
    [960, -540],
  ]) {
    assert.ok(packable(x, y));
    const k = packXY(x, y);
    assert.deepEqual([unpackX(k), unpackY(k)], [x, y]);
  }
  assert.ok(!packable(4096, 0));
  assert.ok(!packable(0, -4097));
  assert.ok(!packable(NaN, 0));
});

test('像素缓冲：不透明的直接盖、半透明的按先后叠（和一层层往画面上画一个结果）、窗口外的丢掉、只擦画过的行', () => {
  const buf = new PixelBuffer(8, 6);
  buf.begin(100, 50);
  // 不透明的红，落在 (102, 51)；外加一个窗口外的
  buf.fill([packXY(102, 51), packXY(99, 51), packXY(108, 51), packXY(102, 56)], 4, 0xff0000, 255);
  assert.equal(buf.px[1 * 8 + 2], 0xff0000ff);
  assert.equal(buf.px.filter((v) => v !== 0).length, 1, '窗口外的像素不该画进来');
  assert.deepEqual([buf.y0, buf.y1], [1, 1]);
  // 半透明的蓝盖在红上：一半一半
  buf.fill([packXY(102, 51)], 1, 0x0000ff, 128);
  const v = buf.px[1 * 8 + 2];
  assert.equal(v >>> 24, 255, '下面是不透明的，叠完还是不透明');
  assert.ok(Math.abs((v & 255) - 127) <= 1, `红剩一半：${v & 255}`);
  assert.ok(Math.abs(((v >> 16) & 255) - 128) <= 1, `蓝占一半：${(v >> 16) & 255}`);
  // 半透明的画在空处：存的是预乘过的颜色
  buf.fill([packXY(103, 53)], 1, 0xffffff, 64);
  assert.equal(buf.px[3 * 8 + 3], 0x40404040);
  // 同一组里同一个像素出现两次：叠两遍（原来一个像素两个矩形也是画两遍）
  buf.fill([packXY(104, 53), packXY(104, 53)], 2, 0xffffff, 128);
  const twice = buf.px[3 * 8 + 4] >>> 24;
  assert.ok(Math.abs(twice - 192) <= 1, `两遍半透明叠起来约 3/4：${twice}`);
  assert.deepEqual([buf.y0, buf.y1], [1, 3]);
  // 下一帧：窗口挪了，上次画过的行被擦掉，要上传的行包含它们
  buf.begin(101, 50);
  assert.ok(buf.px.every((x) => x === 0));
  assert.ok(buf.empty);
  assert.deepEqual([buf.dirtyFrom, buf.dirtyTo], [1, 3]);
  buf.fill([packXY(101, 55)], 1, 0x00ff00, 255);
  assert.equal(buf.px[5 * 8 + 0], 0xff00ff00);
  assert.deepEqual([buf.dirtyFrom, buf.dirtyTo], [1, 5]);
});

test('笔画表：同一像素只留优先级最高的（同级留更不透明的），按第一次碰到的先后交出，放满了就拒收新像素', () => {
  const t = new StrokeTable();
  assert.ok(t.put(packXY(1, 1), 0xaa, 0.5, 2));
  assert.ok(t.put(packXY(2, 1), 0xbb, 0.5, 1));
  assert.ok(t.put(packXY(1, 1), 0xcc, 0.2, 3), '优先级更高：换上');
  assert.ok(t.put(packXY(1, 1), 0xdd, 0.9, 2), '优先级更低：不换');
  assert.ok(t.put(packXY(2, 1), 0xee, 0.8, 1), '同级、更不透明：换上');
  assert.ok(t.put(packXY(2, 1), 0xff, 0.3, 1), '同级、更透明：不换');
  const out: [number, number, number][] = [];
  const sink = { putKey: (k: number, c: number, a: number) => void out.push([k, c, a]) };
  t.drain(sink);
  assert.deepEqual(out, [
    [packXY(1, 1), 0xcc, 0.2],
    [packXY(2, 1), 0xee, 0.8],
  ]);
  assert.equal(t.n, 0);
  // 清空之后可以接着用；放满为止
  for (let i = 0; i < STROKE_TABLE_SIZE; i++) assert.ok(t.put(packXY(i % 3000, Math.floor(i / 3000)), i, 1, 1));
  assert.equal(t.put(packXY(-5, -5), 1, 1, 1), false, '满了：新像素放不进');
  assert.ok(t.put(packXY(7, 0), 0x123456, 1, 4), '满了：表里已有的像素照常更新');
  let n = 0;
  let seven = -1;
  t.drain({
    putKey: (k, c) => {
      if (k === packXY(7, 0)) seven = c;
      n++;
    },
  });
  assert.equal(n, STROKE_TABLE_SIZE);
  assert.equal(seven, 0x123456);
});

test('画布按 16:9 尽量铺满窗口；后备缓冲的放大倍数刚好不小于需要的倍数（1 到 6）', () => {
  const cases: [number, number, number, { w: number; h: number; r: number }][] = [
    // 窗口宽、高、devicePixelRatio → 画布的 CSS 大小、放大倍数
    [1920, 1080, 1, { w: 1920, h: 1080, r: 4 }], // 正好 4 倍：1:1
    [1280, 720, 1, { w: 1280, h: 720, r: 3 }], // 2.67 倍 → 画成 3 倍再缩
    [1366, 768, 1, { w: 1365, h: 768, r: 3 }], // 2.84 倍
    [844, 390, 3, { w: 693 + 1 / 3, h: 390, r: 5 }], // 手机横屏：高度占满
    [667, 375, 2, { w: 666.5, h: 375, r: 3 }], // 2.78 倍
    [480, 270, 1, { w: 480, h: 270, r: 1 }],
    [300, 200, 1, { w: 300, h: 168, r: 1 }], // 比 480×270 还小：缩着画
    [3840, 2160, 2, { w: 3840, h: 2160, r: 6 }], // 需要 16 倍：封顶 6 倍，剩下的由浏览器放大
  ];
  for (const [W, H, dpr, want] of cases) {
    const f = viewFit(W, H, dpr);
    assert.ok(Math.abs(f.cssW - want.w) < 1e-6 && Math.abs(f.cssH - want.h) < 1e-6, `${W}×${H}@${dpr}：画布 ${f.cssW}×${f.cssH}，要 ${want.w}×${want.h}`);
    assert.equal(f.r, want.r, `${W}×${H}@${dpr}：放大倍数`);
    // 铺满：宽或高至少有一边差不到一个物理像素
    assert.ok(W - f.cssW < 1 / dpr + 1e-9 || H - f.cssH < 1 / dpr + 1e-9, `${W}×${H}@${dpr}：没铺满`);
    assert.ok(f.cssW <= W + 1e-9 && f.cssH <= H + 1e-9, '不能超出窗口');
    // 画布的大小是整数个物理像素
    assert.ok(Math.abs(f.cssW * dpr - Math.round(f.cssW * dpr)) < 1e-6 && Math.abs(f.cssH * dpr - Math.round(f.cssH * dpr)) < 1e-6);
    assert.ok(f.r >= 1 && f.r <= MAX_UPSCALE);
    if (f.scale <= MAX_UPSCALE) assert.ok(f.r >= f.scale - 1e-6 && f.r < f.scale + 1, '倍数刚好不小于需要的倍数');
  }
  // 正好整数倍时是 1:1（后备缓冲的像素数 = 画布占的物理像素数）
  for (const k of [1, 2, 3, 4, 5, 6]) {
    const f = viewFit(VIEW_W * k, VIEW_H * k, 1);
    assert.deepEqual([f.cssW, f.cssH, f.r, f.scale], [VIEW_W * k, VIEW_H * k, k, k]);
  }
});
