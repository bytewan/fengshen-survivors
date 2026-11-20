// 过场里的远景：云海里冒出来的远峰（石笋一样的仙山）、海面、魔气云堤。纯函数，输出调色板颜色的位图。
// 口径同标题页：分档平涂、交界处一两像素的抖动；远处的东西颜色淡、对比小（大气透视），不用大片随机像素。
import { blank, bayer, mulberry32, put, rgbaOf, smooth, valueNoise, type Bitmap } from './common.ts';

/**
 * 一排远峰：石笋一样的仙山，从云海里直直地冒出来（山脚埋在云里，另由云堤盖住）。光从左边来：左半边亮一档。
 * tones：[亮面, 本色, 暗面, 山顶的一点高光]；peaks：[中心 x, 高度, 宽度] 的列表（位图坐标，脚在位图底边）。
 */
export function makeSpires(w: number, h: number, peaks: [number, number, number][], tones: [string, string, string, string], seed: number): Bitmap {
  const b = blank(w, h);
  const rnd = mulberry32(seed);
  for (const [cx, ph, pw] of peaks) {
    // 每座峰：轮廓是上窄下宽的一根，两边各自有几道凹凸（岩层），顶上歪一点
    const lean = (rnd() - 0.5) * 0.25;
    const bumpsL = Array.from({ length: 6 }, () => rnd());
    const bumpsR = Array.from({ length: 6 }, () => rnd());
    for (let y = 0; y < ph; y++) {
      const u = y / ph; // 0 顶，1 脚
      const half = (pw / 2) * (0.22 + 0.78 * Math.pow(u, 0.62));
      const bi = Math.min(5, Math.floor(u * 6));
      const jl = (bumpsL[bi] - 0.5) * 2.2 * (0.4 + u);
      const jr = (bumpsR[bi] - 0.5) * 2.2 * (0.4 + u);
      const c = cx + lean * (ph - y);
      const x0 = Math.round(c - half + jl);
      const x1 = Math.round(c + half + jr);
      const Y = h - ph + y;
      for (let x = x0; x <= x1; x++) {
        const v = (x - x0) / Math.max(1, x1 - x0); // 0 左（亮）… 1 右（暗）
        let ch = v < 0.32 ? tones[0] : v < 0.78 ? tones[1] : tones[2];
        // 岩层：每隔几行一道暗缝，只在亮面和本色上，断断续续
        if ((y + Math.round(cx)) % 9 === 0 && v > 0.1 && v < 0.85 && bayer(x, y) < 0.6) ch = tones[2];
        if (y < 2 && v < 0.6) ch = tones[3];
        put(b, x, Y, ch);
      }
    }
    // 峰顶的几棵松：一两像素的墨绿点，偶尔有
    if (rnd() < 0.6) {
      const tx = Math.round(cx + lean * ph);
      put(b, tx - 1, h - ph - 1, 'G');
      put(b, tx, h - ph - 2, 'G');
      put(b, tx + 1, h - ph - 1, 'v');
    }
  }
  return b;
}

/**
 * 魔气幕（横向可平铺）：和战场边上的魔气同一个画法——浓度是平滑的，按有序抖动量化成十几档透明度，颜色从上沿的紫棠往下到乌、玄；
 * 上沿被两层噪声打散成一团团往上翻的烟头（不是一条线，也不是一排菜花一样的云包）。
 * top：上沿平均在第几行；rise：烟头往上冒多高；solid：从上沿往下多深浓到不透明。
 */
export function makeMiasmaVeil(
  tw: number,
  h: number,
  seed: number,
  top: number | ((x: number) => number),
  rise: number,
  solid: number,
  tones: [string, string, string] = ['P', 'd', 'k'],
  wrap = true,
  fadeBottom = 0,
): Bitmap {
  const b = blank(tw, h);
  const n1 = valueNoise(seed, 40, tw, h, wrap ? tw : 0);
  const n2 = valueNoise(seed + 1, 13, tw, h, wrap ? tw : 0);
  const topAt = typeof top === 'number' ? () => top : top;
  const c0 = rgbaOf(tones[0]);
  const c1 = rgbaOf(tones[1]);
  const c2 = rgbaOf(tones[2]);
  const LEVELS = 12;
  const mix = (a: number[], c: number[], k: number) => a.map((v, i) => Math.round(v + (c[i] - v) * k));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < tw; x++) {
      // 上沿：大起伏（烟头）+ 小起伏（毛边）
      const edge = topAt(x) - rise * (n1(x, y * 0.35) - 0.35) * 1.6 - (n2(x, y) - 0.5) * 6;
      const t = (y - edge) / solid;
      if (t <= 0) continue;
      let k = Math.min(1, t);
      // 下沿也渐隐（一条横着漫过去的魔气，不是一整块压到底）
      if (fadeBottom > 0) k *= Math.min(1, Math.max(0, (h - 1 - y + (n2(x + 50, y) - 0.5) * 8) / fadeBottom));
      if (k <= 0) continue;
      const sm = k * k * (3 - 2 * k);
      const av = sm * 0.999 * LEVELS;
      const lo = Math.floor(av);
      const q = (av - lo > bayer(x, y) ? lo + 1 : lo) / LEVELS;
      if (q <= 0) continue;
      // 颜色：越深越暗；烟头的边上带一点紫棠（被身后的暗光照着）
      const d = Math.min(1, Math.max(0, (y - edge) / (solid * 2.2)));
      const c = d < 0.5 ? mix(c0, c1, d * 2) : mix(c1, c2, (d - 0.5) * 2);
      const i = (y * tw + x) * 4;
      b.data[i] = c[0];
      b.data[i + 1] = c[1];
      b.data[i + 2] = c[2];
      b.data[i + 3] = Math.round(q * 255);
    }
  return b;
}

/**
 * 海（横向可平铺）：远处（上）一道映着天光的胭脂紫，往近处黛蓝、靛，按行分档、交界处两三行抖动；
 * 水面上一道道横的波纹（亮一档的短线，越近越长越稀）。glints 另外给一组「暗光」的位置，调用方每帧让它们明灭、慢慢漂。
 */
export function makeSeaBands(tw: number, h: number, seed: number, tones: [string, string, string, string]): { b: Bitmap; glints: { x: number; y: number; len: number; ph: number }[] } {
  const b = blank(tw, h);
  const rnd = mulberry32(seed);
  const stops: [number, string][] = [
    [0, tones[0]],
    [0.06, tones[1]],
    [0.22, tones[2]],
    [0.55, tones[3]],
  ];
  // 档线：每一列上下起伏一点（长长的涌），交界处四五行有序抖动——海面上没有横贯全屏的直线
  const swell = valueNoise(seed + 5, 46, tw, h, tw);
  const SEAM = 2.5;
  for (let x = 0; x < tw; x++)
    for (let y = 0; y < h; y++) {
      const off = (swell(x, y * 0.2) - 0.5) * 6 + Math.sin((x / tw) * Math.PI * 6) * 1.2;
      let i = 0;
      while (i + 1 < stops.length && y >= stops[i + 1][0] * h + off * (i ? 1 : 0.3) + SEAM) i++;
      let ch = stops[i][1];
      if (i + 1 < stops.length) {
        const line = stops[i + 1][0] * h + off * (i + 1 > 1 ? 1 : 0.3);
        if (y >= line - SEAM) ch = (y - (line - SEAM)) / (SEAM * 2) > bayer(x, y) ? stops[i + 1][1] : stops[i][1];
      }
      put(b, x, y, ch);
    }
  // 波纹：亮一档的短横线
  const lighter: Record<string, string> = { [tones[1]]: tones[0], [tones[2]]: tones[1], [tones[3]]: tones[2] };
  for (let y = 2; y < h; y++) {
    const u = y / h;
    const n = Math.round((tw / 22) * (1.2 - u * 0.6));
    for (let k = 0; k < n; k++) {
      if (rnd() < 0.45) continue;
      const len = Math.max(2, Math.round(2 + u * 10 * (0.4 + rnd())));
      const x0 = Math.floor(rnd() * tw);
      for (let q = 0; q < len; q++) {
        const X = (x0 + q) % tw;
        const i = (y * tw + X) * 4;
        const cur = Object.keys(lighter).find((ch) => {
          const c = rgbaOf(ch);
          return b.data[i] === c[0] && b.data[i + 1] === c[1] && b.data[i + 2] === c[2];
        });
        if (cur) put(b, X, y, lighter[cur]);
      }
    }
  }
  const glints = Array.from({ length: Math.round(tw / 5) }, () => {
    const y = 1 + Math.floor(Math.pow(rnd(), 1.25) * (h - 2));
    return { x: Math.floor(rnd() * tw), y, len: 1 + Math.round((y / h) * 7 * rnd()), ph: rnd() * 6 };
  });
  return { b, glints };
}

/** 浪花：岸边一道一像素宽的白沫，返回几帧（拍岸、退去）。 */
export function surfFrames(w: number, seed: number, n = 4): Bitmap[] {
  const rnd = mulberry32(seed);
  const pts = Array.from({ length: Math.round(w / 3) }, () => ({ x: Math.floor(rnd() * w), ph: rnd() }));
  return Array.from({ length: n }, (_, f) => {
    const b = blank(w, 4);
    for (const p of pts) {
      const k = (p.ph + f / n) % 1;
      const y = Math.round(smooth(k) * 3);
      put(b, p.x, y, k < 0.5 ? 'w' : 'j');
      if (k < 0.3) put(b, p.x + 1, y, 'j');
    }
    return b;
  });
}
