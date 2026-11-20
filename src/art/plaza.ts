// 回响仙台：悬在云海之上的青白玉仙台，中央是发光的阵法。程序化生成（带种子）。
// 输出两层：base（玉石地 + 嵌金石缝 + 阵法刻纹）和 glow（阵法与榜裂里透出的灵光，叠加发光用）。
// 用户口径（2026-11-09）：背景要有神话史诗感、不要素、不要黑；是修仙玄幻，不是历史考古。
import { PALETTE, hexToRgba } from './palette.ts';
import { mulberry32, type Bitmap } from './ground.ts';

export interface Plaza {
  base: Bitmap;
  glow: Bitmap;
  center: { x: number; y: number };
  radius: number;
}

const TRIGRAMS = [0b111, 0b110, 0b101, 0b100, 0b011, 0b010, 0b001, 0b000]; // 八卦（阳爻 = 1）

/** goldInset：离位图边缘这么近的地方不画嵌金线（仙台边缘要被魔气吞掉，不能留一道金线当界线）。 */
export function makePlaza(w: number, h: number, seed = 11, goldInset = 0): Plaza {
  const rnd = mulberry32(seed);
  const px = new Array<string>(w * h).fill('z');
  const glow = new Float32Array(w * h); // 0..1 天青光强
  const set = (x: number, y: number, ch: string) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < w && y < h) px[y * w + x] = ch;
  };
  const get = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? px[y * w + x] : 'x');
  const lit = (x: number, y: number, v: number) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < w && y < h) glow[y * w + x] = Math.max(glow[y * w + x], v);
  };
  /** 刻槽：槽里嵌金、下沿一像素压暗，看起来是嵌进玉石里的金线。 */
  const groove = (x: number, y: number, g = 0) => {
    set(x, y, 'y');
    if (get(x, y + 1) !== 'y') set(x, y + 1, 'b');
    if (g) lit(x, y, g);
  };

  // 1. 青白玉铺地：24×24 对缝，主色在「缟 / 石白」两档间轮换；每隔三块，石缝换成嵌金线
  const S = 32;
  const broken = (x: number, y: number) => {
    // 低频的「灵草地」：玉砖之间长出灵草的区域
    const v = Math.sin(x * 0.011 + 1.3) * Math.cos(y * 0.017 + 0.4) + Math.sin((x + y) * 0.007);
    return v > 99; // 灵草地已去掉（用户：绿油油一团、没有特征）；草改成零星的手绘小簇，见 decor
  };
  for (let gy = 0; gy * S < h; gy++)
    for (let gx = 0; gx * S < w; gx++) {
      const ox = gx * S;
      const oy = gy * S;
      const body = 'z';
      const motif = rnd() < 0.025; // 偶尔有一块玉砖刻回纹（暗刻）
      const crackChance = rnd();
      const inCore = (x: number, y: number) => x > goldInset && y > goldInset && x < w - goldInset && y < h - goldInset;
      const goldRight = gx % 8 === 7 && inCore(ox + S, oy + S / 2);
      const goldBottom = gy % 8 === 7 && inCore(ox + S / 2, oy + S);
      for (let j = 0; j < S; j++)
        for (let i = 0; i < S; i++) {
          const x = ox + i;
          const y = oy + j;
          if (x >= w || y >= h) continue;
          let ch = body;
          // 石缝只画一像素、颜色只暗半档，并且断断续续（像磨平的旧缝），避免读成方格本
          // 嵌金线用暗一档的琥珀色，不抢画面
          if (i === S - 1) ch = goldRight ? 'b' : rnd() < 0.75 ? 'j' : body;
          else if (j === S - 1) ch = goldBottom ? 'b' : rnd() < 0.75 ? 'j' : body;
          else if (rnd() < 0.004) ch = 'j';
          px[y * w + x] = ch;
        }
      if (motif) {
        const cx = ox + 6;
        const cy = oy + 6;
        let x0 = 0;
        let y0 = 0;
        let x1 = 10;
        let y1 = 10;
        const pts: [number, number][] = [];
        while (x1 - x0 >= 2 && y1 - y0 >= 2) {
          for (let x = x0; x <= x1; x++) pts.push([x, y0]);
          for (let y = y0; y <= y1; y++) pts.push([x1, y]);
          for (let x = x1; x >= x0 + 2; x--) pts.push([x, y1]);
          for (let y = y1; y >= y0 + 2; y--) pts.push([x0 + 2, y]);
          x0 += 2;
          y0 += 2;
          x1 -= 2;
          y1 -= 2;
        }
        for (const [x, y] of pts) if (!broken(cx + x + 5, cy + y + 5)) set(cx + x + 5, cy + y + 5, 'j');
      }
      if (crackChance < 0.04) {
        let x = ox + 3 + Math.floor(rnd() * (S - 6));
        let y = oy + 1;
        for (let k = 0; k < S - 3; k++) {
          if (!broken(x, y)) set(x, y, 'j');
          y++;
          x += Math.floor(rnd() * 3) - 1;
        }
      }
    }

  // 2. 灵草地里的小花（桃红、灵光黄）
  for (let k = 0; k < (w * h) / 900; k++) {
    const x = Math.floor(rnd() * w);
    const y = Math.floor(rnd() * h);
    if (!broken(x, y)) continue;
    set(x, y, rnd() < 0.6 ? 'm' : 'f');
    if (rnd() < 0.5) set(x, y + 1, 'v');
  }

  // 3. 圆形祭台：台面磨光，外沿双圈刻槽；八卦、辐条、中心阵眼
  const cx = Math.round(w / 2);
  const cy = Math.round(h / 2);
  const R = 64; // 用户：背景元素不要这么大，克制一点
  for (let y = cy - R - 3; y <= cy + R + 3; y++)
    for (let x = cx - R - 3; x <= cx + R + 3; x++) {
      const d = Math.hypot(x - cx, (y - cy) * 1.0);
      if (d > R + 2) continue;
      let ch = rnd() < 0.015 ? 'j' : 'w';
      if (d > R) ch = 'x'; // 台沿外的阴影
      else if (d > R - 2 && y > cy) ch = 'j'; // 台沿下半背光
      set(x, y, ch);
    }
  const ring = (r: number, g: number, gap = 0) => {
    const n = Math.ceil(2 * Math.PI * r * 1.5);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      if (gap && Math.floor((a / (Math.PI * 2)) * gap * 2) % 2 === 1) continue;
      groove(cx + Math.cos(a) * r, cy + Math.sin(a) * r, g);
    }
  };
  ring(R - 4, 0);
  ring(R - 7, 0.3);
  ring(36, 0.5);
  ring(32, 0, 16);
  ring(13, 0.8);
  // 八卦：三爻沿切线排开，阴爻中间断开
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 - Math.PI / 2;
    const rx = Math.cos(a);
    const ry = Math.sin(a);
    const tx = -ry;
    const ty = rx;
    for (let bar = 0; bar < 3; bar++) {
      const r = 42 + bar * 4;
      const yang = (TRIGRAMS[k] >> (2 - bar)) & 1;
      for (let t = -4; t <= 4; t++) {
        if (!yang && Math.abs(t) <= 1) continue;
        groove(cx + rx * r + tx * t, cy + ry * r + ty * t, 0.4);
      }
    }
  }
  // 辐条：阵眼到内圈
  for (let k = 0; k < 8; k++) {
    const a = ((k + 0.5) / 8) * Math.PI * 2;
    for (let r = 14; r < 32; r++) groove(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0.6);
  }
  // 阵眼：中心一点实心的光
  for (let y = -4; y <= 4; y++)
    for (let x = -4; x <= 4; x++) {
      const d = Math.hypot(x, y);
      if (d <= 4) {
        set(cx + x, cy + y, d < 2 ? 'C' : 'c');
        lit(cx + x, cy + y, 1 - d / 6);
      }
    }

  // 4. 榜裂：已去掉（用户：祭台旁的几条线很丑）。主线里的「榜裂」以后用别的方式表现。

  // 5. 石缝里冒出的灵草
  for (let k = 0; k < (w * h) / 1600; k++) {
    const x0 = Math.floor(rnd() * w);
    const y0 = Math.floor(rnd() * h);
    if (Math.hypot(x0 - cx, y0 - cy) < R + 6) continue;
    for (let n = 0; n < 7; n++) {
      const x = x0 + Math.floor(rnd() * 5) - 2;
      const y = y0 + Math.floor(rnd() * 3) - 1;
      const c = get(x, y);
      if (c === 'x') set(x, y, rnd() < 0.6 ? 'l' : 'L');
    }
  }

  const base = new Uint8ClampedArray(w * h * 4);
  const lut: Record<string, [number, number, number, number]> = {};
  for (let i = 0; i < w * h; i++) base.set((lut[px[i]] ??= hexToRgba(PALETTE[px[i]])), i * 4);
  const g = new Uint8ClampedArray(w * h * 4);
  const [cr, cg, cb] = hexToRgba(PALETTE.C);
  for (let i = 0; i < w * h; i++) {
    const v = glow[i];
    if (!v) continue;
    const a = Math.round((Math.ceil(v * 3) / 3) * 255); // 分三档
    g.set([cr, cg, cb, a], i * 4);
  }
  return { base: { w, h, data: base }, glow: { w, h, data: g }, center: { x: cx, y: cy }, radius: R };
}

/**
 * 云海贴图（可无缝平铺）：从上往下看到的一团团积云顶。左上受光、右下背光，云顶镀金边；
 * far 层是深处的暗云，铺满；near 层是近处的亮云，云团之间透明，露出下面的 far 层。
 */
export function makeCloudTile(size: number, seed: number, layer: 'far' | 'near'): Bitmap {
  const rnd = mulberry32(seed);
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
  // 明暗档：far 偏紫偏暗，near 偏白、受光处镀金
  const tones = layer === 'far' ? ['P', 'p', 'i', 'j'] : ['i', 'j', 'w', 'w'];
  const lum = new Float32Array(size * size).fill(-1); // -1 = 空
  const order = Array.from({ length: layer === 'far' ? 480 : 120 }, () => ({
    x: rnd() * size,
    y: rnd() * size,
    r: layer === 'far' ? 4 + rnd() * 8 : 5 + rnd() * 10,
  })).sort((a, b) => a.y - b.y); // 后画的盖住先画的：靠下的云团在前
  const LX = -0.55;
  const LY = -0.83;
  for (const p of order) {
    const r = p.r;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        // 云团略扁、边缘带一点起伏
        const ang = Math.atan2(dy, dx);
        const rr = r * (1 + 0.12 * Math.sin(ang * 5 + p.x));
        const d = Math.hypot(dx, dy * 1.25) / rr;
        if (d > 1) continue;
        const nx = dx / rr;
        const ny = (dy * 1.25) / rr;
        const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
        let b = 0.35 + 0.65 * Math.max(0, -(nx * LX + ny * LY) * 0.7 + nz * 0.55);
        if (d > 0.86) b *= 0.8; // 云团边缘稍暗，分出一团一团
        const x = ((Math.round(p.x + dx) % size) + size) % size;
        const y = ((Math.round(p.y + dy) % size) + size) % size;
        lum[y * size + x] = b;
      }
  }
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let v = lum[y * size + x];
      if (v < 0) {
        if (layer === 'near') continue; // 透明，露出深处
        v = 0.3;
      }
      const level = Math.max(0, Math.min(3.999, v * 4));
      const lo = Math.floor(level);
      const frac = level - lo;
      const t = Math.max(0, Math.min(1, (frac - 0.5 + 0.2) / 0.4));
      const ch = t > BAYER[(y % 4) * 4 + (x % 4)] ? tones[Math.min(3, lo + 1)] : tones[lo];
      data.set(hexToRgba(PALETTE[ch]), (y * size + x) * 4);
    }
  return { w: size, h: size, data };
}

/**
 * 魔气（用户提议，替代空气墙）：仙台外一圈翻涌的紫黑魔气。
 * 用户口径：交界处不要分明；外层魔气要好看。所以：
 *  - 浓度是平滑渐变，从仙台内侧 inner 像素就开始极淡地渗进来，越往外越浓，前沿用低频噪声打散；
 *  - 外层不是纯色，而是一团团翻滚的烟团（makeMiasmaPuffs），由浓度层当遮罩露出来，没有任何直线边。
 * 返回两张位图，左上角都对应世界坐标 (-margin, -margin)：
 *  density：白色 + 透明度（给烟团层当遮罩）；base：底色（玄 → 紫棠 → 胭脂紫的渐变）。
 */
export function makeMiasma(w: number, h: number, depth: number, margin: number, seed = 21): { density: Bitmap; base: Bitmap } {
  const rnd = mulberry32(seed);
  const W = w + margin * 2;
  const H = h + margin * 2;
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
  const G = 40;
  const gw = Math.ceil(W / G) + 2;
  const gh = Math.ceil(H / G) + 2;
  const grid1 = Array.from({ length: gw * gh }, rnd);
  const fade = (t: number) => t * t * (3 - 2 * t);
  const noise = (x: number, y: number) => {
    const fx = x / G;
    const fy = y / G;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fade(fx - ix);
    const ty = fade(fy - iy);
    const v = (i: number, j: number) => grid1[(iy + j) * gw + (ix + i)];
    const a = v(0, 0) + (v(1, 0) - v(0, 0)) * tx;
    const b = v(0, 1) + (v(1, 1) - v(0, 1)) * tx;
    return a + (b - a) * ty;
  };
  const inner = 44; // 仙台内侧开始渗入的宽度（让仙台的边缘本身被魔气吞掉，看不出界线）
  const full = depth * 0.7; // 到这里浓度封顶
  const cA = hexToRgba(PALETTE.P);
  const cB = hexToRgba(PALETTE.d);
  const cC = hexToRgba(PALETTE.k);
  const LEVELS = 14;
  const density = new Uint8ClampedArray(W * H * 4);
  const base = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const wx = x - margin;
      const wy = y - margin;
      const dx = Math.max(0, -wx, wx - w);
      const dy = Math.max(0, -wy, wy - h);
      const out = dx || dy ? Math.hypot(dx, dy) : -Math.min(wx, wy, w - wx, h - wy);
      let t = (out + inner) / (full + inner);
      t += (noise(x, y) - 0.5) * 0.4;
      if (t <= 0) continue;
      t = Math.min(1, t);
      const sm = t * t * (3 - 2 * t);
      // 透明度量化成若干档再用有序抖动，保留像素感，又看不出台阶
      const av = sm * 0.99 * LEVELS;
      const lo = Math.floor(av);
      const q = (av - lo > BAYER[(y % 4) * 4 + (x % 4)] ? lo + 1 : lo) / LEVELS;
      if (q <= 0) continue;
      const i = (y * W + x) * 4;
      density.set([255, 255, 255, Math.round(q * 255)], i);
      const mix = (a: number[], b: number[], k: number) => a.map((v, n) => Math.round(v + (b[n] - v) * k));
      const c = sm < 0.5 ? mix(cA, cB, sm * 2) : mix(cB, cC, (sm - 0.5) * 2);
      base.set([c[0], c[1], c[2], Math.round(Math.min(1, q * 1.05) * 255)], i);
    }
  return { density: { w: W, h: H, data: density }, base: { w: W, h: H, data: base } };
}

/**
 * 魔气烟团（可无缝平铺）：和云海一样是一团团的积团，但配色是玄、紫棠、胭脂紫，迎光面偶有一点暗红火光。
 * near 层的烟团之间透明，露出 far 层。
 */
export function makeMiasmaPuffs(size: number, seed: number, layer: 'far' | 'near'): Bitmap {
  const rnd = mulberry32(seed);
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
  const tones = layer === 'far' ? ['k', 'k', 'd', 'd'] : ['k', 'd', 'd', 'P']; // 对比压低，读成翻滚的浓雾而不是一块块的图案
  const lum = new Float32Array(size * size).fill(-1);
  const puffs = Array.from({ length: layer === 'far' ? 420 : 170 }, () => ({
    x: rnd() * size,
    y: rnd() * size,
    r: layer === 'far' ? 5 + rnd() * 9 : 4 + rnd() * 8,
  })).sort((a, b) => a.y - b.y);
  // 光从下方的深渊里透上来：背光面朝上，受光面朝下
  const LX = 0.35;
  const LY = 0.9;
  for (const p of puffs) {
    const r = p.r;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const ang = Math.atan2(dy, dx);
        const rr = r * (1 + 0.14 * Math.sin(ang * 4 + p.x));
        const d = Math.hypot(dx, dy * 1.2) / rr;
        if (d > 1) continue;
        const nx = dx / rr;
        const ny = (dy * 1.2) / rr;
        const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
        let b = 0.25 + 0.75 * Math.max(0, (nx * LX + ny * LY) * 0.75 + nz * 0.35);
        if (d > 0.84) b *= 0.7;
        const x = ((Math.round(p.x + dx) % size) + size) % size;
        const y = ((Math.round(p.y + dy) % size) + size) % size;
        lum[y * size + x] = b;
      }
  }
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let v = lum[y * size + x];
      if (v < 0) {
        if (layer === 'near') continue;
        v = 0.1;
      }
      const level = Math.max(0, Math.min(3.999, v * 4));
      const lo = Math.floor(level);
      const frac = level - lo;
      const t = Math.max(0, Math.min(1, (frac - 0.5 + 0.2) / 0.4));
      let ch = t > BAYER[(y % 4) * 4 + (x % 4)] ? tones[Math.min(3, lo + 1)] : tones[lo];
      if (layer === 'near' && v > 0.95 && rnd() < 0.18) ch = 'R'; // 迎光面零星的暗红
      data.set(hexToRgba(PALETTE[ch]), (y * size + x) * 4);
    }
  return { w: size, h: size, data };
}
