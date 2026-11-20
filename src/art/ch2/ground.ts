// 第二章 · 西岐城外：黄昏的旷野。程序化生成（带种子），输出 RGBA 位图，表现层（render/scene-xiqi.ts）铺成地面。
// 用户口径：精致克制、修仙玄幻不是考古；背景不要黑，底色落在中间调以上；地面不要像方格本、不要大面积随机像素铺成没有形状的一团、
// 不要一像素的细裂缝线条；背景元素不要大。所以：
//  - 黄土底：两层低频噪声分三档（深黄土 / 黄土 / 浅黄土），只在明暗交界的窄带里抖动，其余是干净的色块；
//  - 被反复践踏：一团一团压实的深色土（脚印、蹄印一样的小斑块），不画车辙线；
//  - 残草：零星的小簇枯草（背光、受光两档，脚下压一像素影子），越靠场边越多；
//  - 阵纹：每座阵台（阵眼）周围刻一圈淡淡的阵（双圈、八组爻纹、辐条），是暗刻——槽里只暗一档、下沿偶尔亮一点，断断续续，
//    不发光、不描边、不是框；外圈就是阵亮起来时的判定边界（sim/ch2/config.ts 的 TEN.r），没亮的时候也看得出阵有多大；
//  - 阵台：只在地上压一块影子；阵台本身各阵各一个样子（铜鼓、火盆、冰晶……），是表现层按 y 排序的精灵（art/ch2/formations.ts）。
// 城墙剪影单独一张透明位图（makeXiqiWall），放在场地北边、魔气里，隔着魔气看得见一道城墙和城楼。
import { PALETTE, hexToRgba } from '../palette.ts';
import { mulberry32, type Bitmap } from '../ground.ts';

const TRIGRAMS = [0b111, 0b110, 0b101, 0b100, 0b011, 0b010, 0b001, 0b000];

/** 平滑插值的格点值噪声，范围约 [0, 1]。 */
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

function toBitmap(px: string[], w: number, h: number): Bitmap {
  const data = new Uint8ClampedArray(w * h * 4);
  const lut: Record<string, [number, number, number, number]> = {};
  for (let i = 0; i < w * h; i++) {
    const ch = px[i];
    if (ch === '.') continue;
    data.set((lut[ch] ??= hexToRgba(PALETTE[ch])), i * 4);
  }
  return { w, h, data };
}

export interface XiqiGroundOpts {
  /** 位图左上角对应的世界坐标是 (-ext, -ext)（地面往魔气带里多铺一截）。 */
  ext: number;
  /** 阵台的世界坐标、阵的半径、阵台的半径。 */
  sites: [number, number][];
  r: number;
  dais: number;
}

/** 阵纹的一个像素：相对阵台中心的位置；lip：下沿亮一点（刻槽的下唇受光）；part：rim 外圈（阵的边界）/ glyph 里面的爻纹、内圈、辐条。 */
export interface GlyphPx {
  x: number;
  y: number;
  lip: boolean;
  part: 'rim' | 'glyph';
}

/**
 * 第 i 座阵眼的阵纹（地面刻的槽和阵亮起来时的光用同一份，一个像素都不差）：外圈就是阵的边界（半径 r），
 * 内圈分 12 段，两圈之间八组爻纹（三爻沿切线排开，阴爻中间断开），阵台边到爻纹之间八根辐条；磨了一百年，断断续续。
 * 按阵眼编号定种子，同一座阵每次都一样。
 */
export function siteGlyph(i: number, R: number, dais: number): GlyphPx[] {
  const rnd = mulberry32(4099 + i * 977);
  const out: GlyphPx[] = [];
  const seen = new Set<number>();
  const put = (x: number, y: number, keep: number, part: GlyphPx['part']) => {
    if (rnd() > keep) return;
    const X = Math.round(x);
    const Y = Math.round(y);
    const k = (Y + 512) * 1024 + X + 512;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ x: X, y: Y, lip: rnd() < 0.35, part });
  };
  const ring = (r: number, keep: number, part: GlyphPx['part'], gaps = 0) => {
    const n = Math.ceil(2 * Math.PI * r * 1.4);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      if (gaps && Math.floor((a / (Math.PI * 2)) * gaps * 2) % 2 === 1) continue;
      put(Math.cos(a) * r, Math.sin(a) * r, keep, part);
    }
  };
  ring(R, 0.8, 'rim');
  ring(R - 5, 0.6, 'glyph', 12);
  const rot = rnd() * Math.PI * 2;
  for (let k = 0; k < 8; k++) {
    const a = rot + (k / 8) * Math.PI * 2;
    const rx = Math.cos(a);
    const ry = Math.sin(a);
    for (let bar = 0; bar < 3; bar++) {
      const r = R - 10 - bar * 3;
      const yang = (TRIGRAMS[k] >> (2 - bar)) & 1;
      for (let t = -3; t <= 3; t++) {
        if (!yang && t === 0) continue;
        put(rx * r - ry * t, ry * r + rx * t, 0.75, 'glyph');
      }
    }
  }
  for (let k = 0; k < 8; k++) {
    const a = rot + ((k + 0.5) / 8) * Math.PI * 2;
    for (let r = dais + 4; r < R - 19; r += 1) put(Math.cos(a) * r, Math.sin(a) * r, 0.55, 'glyph');
  }
  return out;
}

/** 地面：黄土底、践踏的斑块、残草、阵纹、阵台。w / h 是位图大小（场地加两边的 ext）。 */
export function makeXiqiGround(w: number, h: number, o: XiqiGroundOpts, seed = 23): Bitmap {
  const rnd = mulberry32(seed);
  const px = new Array<string>(w * h).fill('a');
  const set = (x: number, y: number, ch: string) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < w && y < h) px[y * w + x] = ch;
  };
  const get = (x: number, y: number) => {
    x = Math.round(x);
    y = Math.round(y);
    return x >= 0 && y >= 0 && x < w && y < h ? px[y * w + x] : 'a';
  };
  const sites = o.sites.map(([x, y]) => [x + o.ext, y + o.ext] as [number, number]);
  const nearSite = (x: number, y: number, pad: number) => sites.some(([sx, sy]) => Math.hypot(x - sx, y - sy) < o.r + pad);

  // 1. 黄土底：三档成片（深黄土 / 黄土 / 浅黄土，三档只差一点），大部分是中间那档；边界是自然的土块边，不用抖动（抖动的过渡像纱窗）
  const n1 = valueNoise(rnd, 110, w, h);
  const n2 = valueNoise(rnd, 26, w, h);
  const n3 = valueNoise(rnd, 4, w, h); // 一点点高频：土块的边不那么圆滑
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = n1(x, y) * 0.69 + n2(x, y) * 0.26 + n3(x, y) * 0.05;
      px[y * w + x] = v < 0.33 ? 'A' : v > 0.67 ? 'E' : 'a';
    }

  // 2. 被反复践踏：压实的地方一道道短短的蹭痕（两三个像素，暗一档），成片出现在践踏多的地方；不撒满屏的碎点
  const trod = valueNoise(rnd, 52, w, h);
  for (let k = 0; k < (w * h) / 260; k++) {
    const x0 = Math.floor(rnd() * w);
    const y0 = Math.floor(rnd() * h);
    if (trod(x0, y0) < 0.6) continue;
    const n = 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) {
      const c = get(x0 + i, y0);
      set(x0 + i, y0, c === 'E' ? 'a' : c === 'a' ? 'A' : rnd() < 0.3 ? 'D' : 'A');
    }
  }

  // 3. 碎石：亮一档的小点，偶尔带一像素影子
  for (let k = 0; k < (w * h) / 1800; k++) {
    const x = Math.floor(rnd() * w);
    const y = Math.floor(rnd() * h);
    if (nearSite(x, y, 2)) continue;
    set(x, y, rnd() < 0.7 ? 'E' : 'j');
    if (rnd() < 0.6) set(x, y + 1, 'D');
  }

  // 4. 阵纹：暗刻的槽（只暗一档：黄土上是深黄土，深黄土上是褐），下沿偶尔亮一点；断断续续（磨了一百年）
  sites.forEach(([cx, cy], i) => {
    for (const q of siteGlyph(i, o.r, o.dais)) {
      const x = cx + q.x;
      const y = cy + q.y;
      const c = get(x, y);
      set(x, y, c === 'A' || c === 'D' ? 'D' : 'A');
      if (q.lip && get(x, y + 1) !== 'D') set(x, y + 1, 'E');
    }
  });

  // 5. 残草：零星的小簇枯草，越靠场边越多；阵里不长（阵纹要看得清）
  const W0 = w - o.ext * 2;
  const H0 = h - o.ext * 2;
  for (let k = 0; k < (w * h) / 1500; k++) {
    const x0 = Math.floor(rnd() * w);
    const y0 = Math.floor(rnd() * h);
    const wx = x0 - o.ext;
    const wy = y0 - o.ext;
    const edge = Math.min(wx, wy, W0 - wx, H0 - wy);
    if (edge > 120 && rnd() < 0.6) continue; // 场心少一些
    if (nearSite(x0, y0, 6)) continue;
    const blades = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < blades; i++) {
      const bx = x0 + i * 2 - blades + Math.floor(rnd() * 2);
      const tall = 2 + Math.floor(rnd() * 3);
      const lean = rnd() < 0.5 ? 0 : rnd() < 0.5 ? -1 : 1;
      for (let j = 0; j < tall; j++) set(bx + (j === tall - 1 ? lean : 0), y0 - j, j === tall - 1 ? 'F' : j === 0 ? 'H' : rnd() < 0.5 ? 'F' : 'H');
    }
    for (let i = -blades; i <= blades; i++) if (rnd() < 0.7 && get(x0 + i, y0 + 1) !== 'H') set(x0 + i, y0 + 1, 'D');
  }

  // 6. 阵台脚下的影子（阵台本身是按 y 排序的精灵，各阵各一个样子，见 art/ch2/formations.ts 的 daisArt）：往右下压一圈褐
  for (const [cx, cy] of sites) {
    const rx = o.dais + 3;
    for (let y = -2; y <= 7; y++)
      for (let x = -rx; x <= rx + 5; x++) {
        const d = ((x - 2) / (rx + 2)) ** 2 + ((y - 3) / 5) ** 2;
        if (d > 1) continue;
        set(cx + x, cy + y, d > 0.6 ? 'A' : 'D');
      }
  }

  return toBitmap(px, w, h);
}

/**
 * 城墙（透明底）：一道带垛口的城墙，正中一座两层城楼、两边各一座角楼，檐角起翘；黄昏的余光从背后照过来，墙是一片灰紫（不是黑的），
 * 垛口、檐口的上沿亮一线；城楼里零星亮着两三点暖光。墙脚往下慢慢淡没在魔气里（没有一条直直的墙脚线）。
 * 宽 w、高 h；垛口的上沿在 crestY，往下 fade 像素淡完。
 */
export function makeXiqiWall(w: number, h: number, crestY: number, fade: number, towers: { x: number; big: boolean }[], seed = 31): Bitmap {
  const rnd = mulberry32(seed);
  const px = new Array<string>(w * h).fill('.');
  const set = (x: number, y: number, ch: string) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < w && y < h) px[y * w + x] = ch;
  };
  const top = crestY + 3; // 墙顶（垛口下沿）
  // 墙身：灰紫，墙顶一线浅；墙面偶有一块暗砖；越往下越淡（下面按 alpha 淡出）
  for (let x = 0; x < w; x++) {
    for (let y = top; y < h; y++) set(x, y, y === top ? 'i' : y === top + 1 ? 'Q' : rnd() < 0.04 ? 'g' : 'h');
    // 垛口：每 7 像素一个 4 像素宽、3 像素高的垛，上沿亮一线
    if (x % 7 < 4) for (let y = crestY; y < top; y++) set(x, y, y === crestY ? 'i' : 'Q');
  }
  // 城楼：楼身 + 一到两重曲檐（檐角起翘）
  const roof = (cx: number, cy: number, half: number, rise: number) => {
    for (let x = -half - 4; x <= half + 4; x++) {
      const k = Math.min(1, Math.abs(x) / (half + 4));
      const top = cy - Math.round(rise * (1 - k * k) + (Math.abs(x) > half ? (Math.abs(x) - half) * 0.8 : 0)); // 屋面拱起，檐角往上翘
      const bottom = cy + 1 - (Math.abs(x) > half ? Math.round((Math.abs(x) - half) * 0.6) : 0);
      for (let y = top; y <= Math.max(top, bottom); y++) set(cx + x, y, y === top ? 'i' : 'g');
    }
  };
  for (const t of towers) {
    const bw = t.big ? 44 : 24; // 楼身宽
    const bh = t.big ? 14 : 10; // 楼身高
    const x0 = Math.round(t.x - bw / 2);
    const y1 = crestY;
    const y0 = y1 - bh;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x0 + bw; x++) set(x, y, x === x0 ? 'Q' : 'h');
    // 柱子（楼身上几道暗竖线）和窗里的暖光
    for (let c = 1; c < (t.big ? 6 : 3); c++) for (let y = y0 + 2; y <= y1; y++) set(x0 + Math.round((bw * c) / (t.big ? 6 : 3)), y, 'g');
    const lit = t.big ? 3 : 1;
    for (let i = 0; i < lit; i++) {
      const wx = Math.round(x0 + bw * (0.25 + 0.5 * (lit > 1 ? i / (lit - 1) : 0.5)));
      set(wx, y0 + 5, rnd() < 0.5 ? 'o' : 'y');
      set(wx + 1, y0 + 5, 'b');
    }
    roof(t.x, y0, Math.round(bw / 2) + 1, t.big ? 5 : 3);
    if (t.big) {
      const uw = 24;
      for (let y = y0 - 13; y <= y0 - 5; y++) for (let x = t.x - uw / 2; x <= t.x + uw / 2; x++) set(x, y, 'h');
      set(t.x, y0 - 9, 'o');
      roof(t.x, y0 - 13, uw / 2 + 1, 4);
    }
  }
  const b = toBitmap(px, w, h);
  // 墙脚往下淡没：从墙顶往下 fade 像素，透明度平滑地降到 0
  for (let y = 0; y < h; y++) {
    const k = Math.max(0, Math.min(1, (y - top) / fade));
    const a = 1 - k * k * (3 - 2 * k);
    if (a >= 1) continue;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4 + 3;
      if (b.data[i]) b.data[i] = Math.round(b.data[i] * a);
    }
  }
  return b;
}
