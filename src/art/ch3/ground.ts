// 第三章 · 界牌关前的山谷，夜。程序化生成（带种子），输出 RGBA 位图，表现层（render/scene-jiepai.ts）铺成地面和山崖。
// 用户口径：精致克制、修仙玄幻不是考古；背景不要黑（最暗的一档也是青黑，不是黑）；地面不要像方格本、不要大面积随机像素铺成没有形状的一团、
// 不要一像素的细裂缝线条；背景元素不要大。所以：
//  - 青黑石台：两层低频噪声分三档成片（青黑 / 青石 / 浅青石，只差一点），没有砖缝；
//  - 剑痕：一道道两像素宽的斩痕（槽是玄岩，下唇一线冷银），三两道一簇、交叉着，剑台附近和对角线上更密——诛仙四剑斩了一百年；
//    不是一像素的细裂缝：每道都是有头有尾、两头收尖的「斩」；
//  - 阵纹：对角的剑台之间各一道暗刻的阵线（嵌着磨掉大半的暗金），在场心交成一个阵心——一圈刻槽、四个方位的刻记，中间一块圆石；
//    四剑归阵时剑气墙就沿着这两道线起来，诛仙剑灵倒下后门缝也在阵心裂开；
//  - 剑台：四角各一座两层的圆石台（青黑石，左上受月光），台面嵌一圈暗金，中间一个剑气的孔（悬着的剑是活的，表现层画）。
// 山崖单独一张透明位图（makeJiepaiCliffs）：场地北边、魔气里，一道黑色的山崖（受月光的崖顶一线雾蓝），后面隔着雾还有一层更远的山。
import { PALETTE, hexToRgba } from '../palette.ts';
import { mulberry32, type Bitmap } from '../ground.ts';

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

export interface JiepaiGroundOpts {
  /** 位图左上角对应的世界坐标是 (-ext, -ext)（地面往魔气带里多铺一截）。 */
  ext: number;
  /** 场地的大小（世界坐标）。 */
  worldW: number;
  worldH: number;
  /** 四座剑台的世界坐标、剑台的半径。 */
  altars: [number, number][];
  dais: number;
}

/** 阵心（场心那一块圆石刻）的半径：外圈刻槽。 */
export const SEAL_R = 44;

/** 地面：青黑石底、剑痕、对角的阵线与阵心、四座剑台。w / h 是位图大小（场地加两边的 ext）。 */
export function makeJiepaiGround(w: number, h: number, o: JiepaiGroundOpts, seed = 37): Bitmap {
  const rnd = mulberry32(seed);
  const px = new Array<string>(w * h).fill('V');
  const set = (x: number, y: number, ch: string) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < w && y < h) px[y * w + x] = ch;
  };
  const get = (x: number, y: number) => {
    x = Math.round(x);
    y = Math.round(y);
    return x >= 0 && y >= 0 && x < w && y < h ? px[y * w + x] : 'V';
  };
  const E = o.ext;
  const altars = o.altars.map(([x, y]) => [x + E, y + E] as [number, number]);
  const cx = o.worldW / 2 + E;
  const cy = o.worldH / 2 + E;
  const nearAltar = (x: number, y: number, pad: number) => altars.some(([ax, ay]) => Math.hypot((x - ax) / 1.25, y - ay) < o.dais + pad);
  const nearSeal = (x: number, y: number, pad: number) => Math.hypot(x - cx, (y - cy) * 1.25) < SEAL_R + pad;

  // 1. 青黑石底：三档成片（青黑 / 青石 / 浅青石，只差一点），大部分是中间那档；边界是自然的石面起伏，不抖动
  const n1 = valueNoise(rnd, 120, w, h);
  const n2 = valueNoise(rnd, 30, w, h);
  const n3 = valueNoise(rnd, 5, w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = n1(x, y) * 0.76 + n2(x, y) * 0.22 + n3(x, y) * 0.02;
      px[y * w + x] = v < 0.22 ? 'O' : v > 0.75 ? 'X' : 'V';
    }

  // 2. 剑痕：两像素宽的斩痕（槽暗两档、下唇亮一线冷银），两头收尖；三两道一簇、交叉着
  const scar = (x0: number, y0: number, a: number, len: number, faint: boolean) => {
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    // 下唇在法线朝下（屏幕 y 正方向）的那一侧
    let nx = -uy;
    let ny = ux;
    if (ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const n = Math.max(2, Math.round(len * 1.5));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x0 + ux * len * (t - 0.5);
      const y = y0 + uy * len * (t - 0.5);
      if (nearAltar(x, y, 4) || nearSeal(x, y, 2)) continue;
      // 一道斩痕是中间宽、两头尖的一条（像刃口切进石头）：中间三像素（上沿暗一档、槽、下唇亮一线），往两头收成一像素
      const wide = Math.sin(t * Math.PI);
      const c = get(x, y);
      set(x, y, faint ? (c === 'X' ? 'V' : 'O') : 'K');
      if (wide > 0.35) {
        const c2 = get(x + nx, y + ny);
        set(x + nx, y + ny, faint ? (c2 === 'O' ? 'V' : 'X') : 'T');
      }
      if (wide > 0.7 && !faint) {
        const c3 = get(x - nx, y - ny);
        if (c3 !== 'K') set(x - nx, y - ny, c3 === 'X' ? 'V' : 'O');
      }
    }
  };
  const W0 = o.worldW;
  const H0 = o.worldH;
  for (let k = 0; k < (w * h) / 7200; k++) {
    // 簇的位置：一半随便落，一半往剑台、对角线上靠（剑气斩得最多的地方）
    let x = rnd() * w;
    let y = rnd() * h;
    if (rnd() < 0.35) {
      const [ax, ay] = altars[Math.floor(rnd() * altars.length)];
      const r = 24 + rnd() * 110;
      const t = rnd() * Math.PI * 2;
      x = ax + Math.cos(t) * r * 1.3;
      y = ay + Math.sin(t) * r;
    } else if (rnd() < 0.3) {
      const d = rnd() < 0.5 ? 0 : 1;
      const [ax, ay] = altars[d];
      const [bx, by] = altars[d + 2];
      const t = rnd();
      x = ax + (bx - ax) * t + (rnd() - 0.5) * 60;
      y = ay + (by - ay) * t + (rnd() - 0.5) * 40;
    }
    const n = 1 + Math.floor(rnd() * 3);
    const a0 = rnd() * Math.PI;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i ? (rnd() < 0.5 ? 1 : -1) * (0.5 + rnd() * 0.9) : 0);
      const len = 9 + rnd() * 17;
      // 一半是淡的旧痕（只暗一档），剑台附近的新痕才是深槽 + 冷银的唇
      const fresh = altars.some(([ax, ay]) => Math.hypot(x - ax, y - ay) < 150) ? rnd() < 0.6 : rnd() < 0.3;
      scar(x + (rnd() - 0.5) * 10, y + (rnd() - 0.5) * 8, a, len, !fresh);
    }
  }
  // 剑台往场心方向的长斩痕（淡的，一台三两道）
  for (const [ax, ay] of altars) {
    const base = Math.atan2(cy - ay, cx - ax);
    for (let i = 0; i < 3; i++) {
      const a = base + (rnd() - 0.5) * 0.9;
      const r = 40 + rnd() * 70;
      const len = 30 + rnd() * 40;
      scar(ax + Math.cos(a) * r, ay + Math.sin(a) * r, a + (rnd() - 0.5) * 0.15, len, true);
    }
  }

  // 3. 阵线：对角的剑台之间各一道暗刻，磨了一百年，只在剑台脚下和阵心外圈附近还看得出一截（暗一档，靠阵心的那截嵌着一点暗金）；
  //    中间那一大段已经磨平了——不画一条横穿全场的直线
  for (const [i, j] of [
    [0, 2],
    [1, 3],
  ]) {
    const [ax, ay] = altars[i];
    const [bx, by] = altars[j];
    const L = Math.hypot(bx - ax, by - ay);
    const ux = (bx - ax) / L;
    const uy = (by - ay) / L;
    for (let d = o.dais + 12; d < L - o.dais - 12; d += 1) {
      const x = ax + ux * d;
      const y = ay + uy * d;
      if (nearSeal(x, y, 3)) continue;
      const fromAltar = Math.min(d, L - d) - o.dais;
      const fromSeal = Math.hypot(x - cx, (y - cy) * 1.25) - SEAL_R;
      const keep = Math.max(1 - fromAltar / 70, 1 - fromSeal / 46); // 离剑台、阵心越远越淡、越断
      if (keep <= 0 || n2(x * 3, y * 3) > 0.25 + keep * 0.55) continue;
      const c = get(x, y);
      set(x, y, fromSeal < 30 && rnd() < 0.35 ? 'M' : c === 'X' ? 'V' : 'O');
      if (keep > 0.5 && rnd() < 0.5) set(x, y + 1, get(x, y + 1) === 'O' ? 'V' : 'X');
    }
  }

  // 4. 阵心：一圈双刻槽（外圈下唇冷银、内圈嵌一点暗金），四个方位各一道短刻，中间一块微微隆起的圆石（门缝以后在这里裂开）
  const ring = (r: number, inner: boolean) => {
    const n = Math.ceil(2 * Math.PI * r * 1.6);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r * 0.8;
      if (n2(x * 2, y * 2) < 0.22) continue; // 磨断的地方
      set(x, y, inner && k % 5 === 0 ? 'M' : 'K');
      if (Math.sin(a) > -0.2) set(x, y + 1, 'T');
    }
  };
  ring(SEAL_R, false);
  ring(SEAL_R - 6, true);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    for (let r = SEAL_R - 4; r <= SEAL_R + 7; r++) {
      set(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8, 'K');
      set(cx + Math.cos(a) * r + 1, cy + Math.sin(a) * r * 0.8, 'T');
    }
  }
  // 中间的圆石：顶面浅、左上受光、右下背光，边上一圈暗金
  const sr = 11;
  for (let y = -sr; y <= sr + 2; y++)
    for (let x = -sr - 1; x <= sr + 1; x++) {
      const d = Math.hypot(x / sr, y / (sr * 0.62));
      const wall = Math.hypot(x / sr, (y - 2) / (sr * 0.62));
      if (d <= 1) set(cx + x, cy + y, d > 0.86 ? 'U' : x + y * 1.6 < -5 ? 'T' : x + y * 1.6 > 6 ? 'V' : 'X');
      else if (wall <= 1 && y > 0) set(cx + x, cy + y, 'O');
    }
  set(cx, cy, 'M');
  set(cx + 1, cy, 'K');

  // 5. 剑台：两层低矮的圆石台（下层宽一圈、暗一档；上层顶面扁圆，正面露出两三像素高的石壁），左上沿受月光，
  //    台面嵌一圈暗金，中间一个剑气的孔（剑悬在上面，表现层画）
  const disc = (dx: number, dy: number, rx: number, ry: number, side: number, topC: string, wallC: string, rim: boolean) => {
    for (let y = -ry; y <= ry + side; y++)
      for (let x = -rx - 1; x <= rx + 1; x++) {
        const top = (x / rx) ** 2 + (y / ry) ** 2 <= 1;
        const wall = !top && y > 0 && (x / rx) ** 2 + ((y - side) / ry) ** 2 <= 1;
        if (wall) set(dx + x, dy + y, y >= ry + side - 1 || Math.abs(x) >= rx - 1 ? 'K' : wallC);
      }
    for (let y = -ry; y <= ry; y++)
      for (let x = -rx; x <= rx; x++) {
        const d = (x / rx) ** 2 + (y / ry) ** 2;
        if (d > 1) continue;
        let ch = topC;
        if (rim && d > 0.66 && x + y * 1.7 < -3) ch = 'T';
        else if (d > 0.72 && x + y * 1.7 > 4) ch = 'O';
        set(dx + x, dy + y, ch);
      }
  };
  for (const [ax, ay] of altars) {
    const rx = o.dais;
    const ry = Math.round(o.dais * 0.6);
    // 影子：石台脚下往右下压一圈玄岩
    for (let x = -rx; x <= rx + 6; x++) {
      const y = Math.round((ry + 3) * Math.sqrt(Math.max(0, 1 - (x / (rx + 5)) ** 2))) + 6;
      set(ax + x, ay + y, 'K');
      if (x > 0 && x < rx) set(ax + x, ay + y + 1, 'O');
    }
    disc(ax, ay + 3, rx + 4, ry + 3, 2, 'V', 'O', false); // 下层
    disc(ax, ay, rx, ry, 3, 'X', 'V', true); // 上层
    // 台面一圈暗金（断断续续）
    const n = Math.ceil(2 * Math.PI * rx);
    for (let i = 0; i < n; i++) {
      if (i % 6 === 5) continue;
      const a = (i / n) * Math.PI * 2;
      set(ax + Math.cos(a) * (rx - 3), ay + Math.sin(a) * (ry - 2), i % 3 === 0 ? 'M' : 'U');
    }
    // 剑气的孔
    set(ax, ay, 'K');
    set(ax - 1, ay, 'K');
    set(ax + 1, ay, 'O');
  }

  void W0;
  void H0;
  return toBitmap(px, w, h);
}

/**
 * 北边的山崖（透明底）：一道黑色的山崖（崖面青黑、竖着几道岩纹，崖顶受月光一线雾蓝，几处尖峰），
 * 后面隔着一层雾还有一排更远、更淡的山（雾蓝）。崖脚往下慢慢淡没在魔气里（没有一条直直的崖脚线）。
 * 宽 w、高 h；近崖的崖顶大致在 crestY 上下起伏，往下 fade 像素淡完。
 */
export function makeJiepaiCliffs(w: number, h: number, crestY: number, fade: number, seed = 41): Bitmap {
  const rnd = mulberry32(seed);
  const px = new Array<string>(w * h).fill('.');
  const set = (x: number, y: number, ch: string) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < w && y < h) px[y * w + x] = ch;
  };
  const nFar = valueNoise(rnd, 46, w, 4);
  const nFar2 = valueNoise(rnd, 13, w, 4);
  const nNear = valueNoise(rnd, 34, w, 4);
  const nNear2 = valueNoise(rnd, 9, w, 4);
  // 远山：更高、更淡（雾蓝、浅青石），顶部圆钝；只露在近崖上面
  const farTop: number[] = [];
  for (let x = 0; x < w; x++) farTop.push(Math.round(crestY - 30 + (nFar(x, 1) - 0.5) * 34 + (nFar2(x, 2) - 0.5) * 8));
  // 近崖：崖顶起伏、几处尖峰
  const nearTop: number[] = [];
  for (let x = 0; x < w; x++) {
    let y = crestY + (nNear(x, 1) - 0.5) * 22 + (nNear2(x, 2) - 0.5) * 7;
    // 尖峰：每隔一段一处，两侧陡
    const k = (x % 170) / 170;
    if (k > 0.42 && k < 0.58) y -= (1 - Math.abs(k - 0.5) / 0.08) * 16 * (0.6 + 0.4 * nNear2(x, 3));
    nearTop.push(Math.round(y));
  }
  for (let x = 0; x < w; x++) {
    for (let y = Math.max(0, farTop[x]); y < h; y++) set(x, y, y === farTop[x] ? 'J' : y < farTop[x] + 3 ? 'X' : 'J');
    for (let y = Math.max(0, nearTop[x]); y < h; y++) {
      // 崖面：青黑底，竖着几道岩纹（玄岩），崖顶一线雾蓝、下面一线青石（受月光）
      const strata = (x * 7 + Math.floor((y - nearTop[x]) / 9) * 3) % 23 === 0 || (x % 31 === 0 && y > nearTop[x] + 4);
      let ch = 'O';
      if (y === nearTop[x]) ch = 'J';
      else if (y === nearTop[x] + 1) ch = 'X';
      else if (y === nearTop[x] + 2) ch = 'V';
      else if (strata) ch = 'K';
      else if (nNear2(x, y * 0.3) > 0.72) ch = 'V';
      set(x, y, ch);
    }
  }
  const b = toBitmap(px, w, h);
  // 崖脚往下淡没：从平均崖顶往下 fade 像素，透明度平滑地降到 0；远山整体再淡一些
  for (let y = 0; y < h; y++) {
    const k = Math.max(0, Math.min(1, (y - (crestY + 8)) / fade));
    const a = 1 - k * k * (3 - 2 * k);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4 + 3;
      if (!b.data[i]) continue;
      const far = y < nearTop[x];
      b.data[i] = Math.round(b.data[i] * a * (far ? 0.55 : 1));
    }
  }
  return b;
}
