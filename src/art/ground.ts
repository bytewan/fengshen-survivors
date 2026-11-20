// 地面：陈塘关旧战场。程序化生成（带种子），直接输出 RGBA。
// 原则：地面的明度和饱和度都压低、对比放小，让角色与特效从地面上「跳出来」。
// 结构：夯土底（低频噪声分三档明暗：黛 / 苍 / 银鼠，交界处用有序抖动过渡）+ 成片的残破石板 + 裂纹、碎石、苔藓。
// 用户口径（2026-11-09）：地图背景不要是黑的——底色落在中间调，暗只留给阴影和暗角。
import { PALETTE, hexToRgba } from './palette.ts';

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Bitmap {
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

/** 平滑插值的格点值噪声，范围约 [0,1]。 */
function valueNoise(rnd: () => number, cell: number, w: number, h: number) {
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const g = Array.from({ length: gw * gh }, rnd);
  const fade = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const fx = x / cell;
    const fy = y / cell;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fade(fx - ix);
    const ty = fade(fy - iy);
    const v = (i: number, j: number) => g[(iy + j) * gw + (ix + i)];
    const a = v(0, 0) + (v(1, 0) - v(0, 0)) * tx;
    const b = v(0, 1) + (v(1, 1) - v(0, 1)) * tx;
    return a + (b - a) * ty;
  };
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

/** 地面配色：底色三档 + 石板（主色、受光、背光、石缝）。 */
export interface GroundTheme {
  tones: [string, string, string];
  stone: string;
  stoneHi: string;
  stoneLo: string;
  crack: string;
}
export const GROUND_THEMES: Record<'mauve' | 'stone', GroundTheme> = {
  mauve: { tones: ['g', 'h', 'i'], stone: 'i', stoneHi: 'j', stoneLo: 'h', crack: 'g' },
  stone: { tones: ['q', 'u', 'x'], stone: 'x', stoneHi: 'z', stoneLo: 'u', crack: 'q' },
};

export function makeGround(w: number, h: number, seed = 7, theme: GroundTheme = GROUND_THEMES.mauve): Bitmap {
  const rnd = mulberry32(seed);
  const px = new Array<string>(w * h);
  const set = (x: number, y: number, ch: string) => {
    if (x >= 0 && y >= 0 && x < w && y < h) px[y * w + x] = ch;
  };
  const get = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? px[y * w + x] : theme.tones[0]);

  // 1. 夯土底：两层噪声叠加，分三档（玄 / 乌 / 黛），交界用 4×4 有序抖动
  const n1 = valueNoise(rnd, 64, w, h);
  const n2 = valueNoise(rnd, 17, w, h);
  const tones = theme.tones;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = n1(x, y) * 0.72 + n2(x, y) * 0.28; // 0..1
      const level = 0.55 + v * 1.25; // 大部分落在中档，亮、暗两档只成小片
      const lo = Math.max(0, Math.min(1, Math.floor(level)));
      const frac = level - lo;
      // 只在明暗交界的窄带里抖动，其余是干净的色块（大面积抖动会像纱窗）
      const band = 0.14;
      const t = Math.max(0, Math.min(1, (frac - 0.5 + band) / (2 * band)));
      const ch = t > BAYER4[(y % 4) * 4 + (x % 4)] ? tones[Math.min(2, lo + 1)] : tones[lo];
      px[y * w + x] = ch;
    }

  // 2. 成片的残破石板：在若干团块区域内按大方格铺石，随机缺块、错位
  const pave = valueNoise(rnd, 90, w, h);
  const S = 16; // 石板边长
  for (let gy = 0; gy * S < h; gy++)
    for (let gx = 0; gx * S < w; gx++) {
      const cx = gx * S + S / 2;
      const cy = gy * S + S / 2;
      if (pave(cx, cy) < 0.55) continue; // 不在铺石区
      if (rnd() < 0.18) continue; // 缺块
      const ox = gx * S + Math.floor(rnd() * 3) - 1;
      const oy = gy * S + Math.floor(rnd() * 3) - 1;
      const sw = S - 1 - Math.floor(rnd() * 2);
      const sh = S - 1 - Math.floor(rnd() * 2);
      const worn = rnd(); // 磨损程度：越大越碎
      for (let j = 0; j < sh; j++)
        for (let i = 0; i < sw; i++) {
          const x = ox + i;
          const y = oy + j;
          // 碎角：靠边的像素按磨损程度随机缺失
          const edge = Math.min(i, j, sw - 1 - i, sh - 1 - j);
          if (edge < 2 && rnd() < worn * 0.35) continue;
          let ch = theme.stone;
          if (j === 0 && rnd() < 0.6) ch = theme.stoneHi; // 上沿受光（只给一部分像素，避免整齐的亮线）
          else if (j === sh - 1 || i === sw - 1) ch = theme.stoneLo;
          else if (rnd() < 0.03) ch = theme.stoneHi;
          else if (rnd() < 0.04) ch = theme.stoneLo;
          set(x, y, ch);
        }
      // 裂纹
      if (rnd() < 0.35) {
        let cx2 = ox + 2 + Math.floor(rnd() * (sw - 4));
        let cy2 = oy + 1;
        for (let k = 0; k < sh; k++) {
          set(cx2, cy2, theme.crack);
          cy2 += 1;
          cx2 += Math.floor(rnd() * 3) - 1;
          if (cy2 >= oy + sh - 1) break;
        }
      }
    }

  // 3. 碎石：亮一档的小点，偶尔带一像素阴影
  for (let k = 0; k < (w * h) / 260; k++) {
    const x = Math.floor(rnd() * w);
    const y = Math.floor(rnd() * h);
    if (get(x, y) === tones[0]) continue;
    set(x, y, rnd() < 0.8 ? theme.stoneHi : 'j');
    if (rnd() < 0.6) set(x, y + 1, tones[0]);
  }

  // 4. 苔藓：长在暗处
  for (let k = 0; k < (w * h) / 1400; k++) {
    const cx = Math.floor(rnd() * w);
    const cy = Math.floor(rnd() * h);
    for (let n = 0; n < 7; n++) {
      const x = cx + Math.floor(rnd() * 5) - 2;
      const y = cy + Math.floor(rnd() * 3) - 1;
      if (get(x, y) === tones[0] || get(x, y) === tones[1]) set(x, y, rnd() < 0.6 ? 'v' : 'l');
    }
  }

  const data = new Uint8ClampedArray(w * h * 4);
  const lut: Record<string, [number, number, number, number]> = {};
  for (let i = 0; i < w * h; i++) {
    const ch = px[i];
    data.set((lut[ch] ??= hexToRgba(PALETTE[ch])), i * 4);
  }
  return { w, h, data };
}
