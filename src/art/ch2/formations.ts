// 第二章「十绝阵」的像素图：阵里出的招（冰锥、火柱、地上的小火苗、魂火）。程序生成（不用随机数，同样的参数每次都一样），朝右绘制。
// 尺寸照「法宝的尺寸」一行的口径：竖着往上的东西离地不过约 1.5 个人（火柱 30 像素），宽不超过它的判定（冰锥一簇 ≤ 判定直径）。
// 只用游戏调色板（src/art/palette.ts）。
import { grid, type Grid } from '../pixel.ts';

const blank = (w: number, h: number) => Array.from({ length: h }, () => Array<string>(w).fill('.'));
const toGrid = (rows: string[][]) => grid(rows.map((r) => r.join('')));
/** 0..1 的确定性「噪声」（整数输入）。 */
const hash = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * 一簇冰锥（寒冰阵）：中间一根高的、两边各一根矮的往外斜，受光的左面月白 / 霜白，背光的右面雾蓝、根部石青。
 * 宽 w（≤ 判定直径），高 h。底边正中是锚点（脚下）。
 */
export function iceSpike(w = 15, h = 16, seed = 0): Grid {
  const rows = blank(w, h);
  const set = (x: number, y: number, c: string) => {
    if (x >= 0 && y >= 0 && x < w && y < h) rows[y][x] = c;
  };
  // [顶点 x, 顶点离地多高, 底的半宽, 往右斜（每行挪多少）]
  const c = (w - 1) / 2;
  const shards: [number, number, number, number][] = [
    [c - 4 - (seed % 2), Math.round(h * 0.55), 2.2, -0.18],
    [c + 4, Math.round(h * 0.62) - (seed % 3), 2.2, 0.2],
    [c + (seed % 2 ? 0.5 : -0.5), h - 1, 3, 0],
  ];
  for (const [ax, top, hw, lean] of shards) {
    for (let y = h - 1 - top; y < h; y++) {
      const k = (y - (h - 1 - top)) / Math.max(1, top);
      const mid = ax + lean * (h - 1 - y);
      const half = hw * k + 0.15;
      for (let x = Math.floor(mid - half); x <= Math.ceil(mid + half); x++) {
        const u = (x - mid) / Math.max(0.5, half); // -1 左沿 .. 1 右沿
        if (Math.abs(u) > 1.05) continue;
        let col = u < -0.45 ? 'w' : u < 0.1 ? 'Z' : u < 0.6 ? 'J' : 'n';
        if (y >= h - 2) col = u < 0 ? 'J' : 'c'; // 根部发青（从地里拱出来）
        if (k < 0.18) col = 'w'; // 尖上一点亮
        set(x, y, col);
      }
    }
  }
  return toGrid(rows);
}

/**
 * 火柱（烈焰阵）的一帧：从地上窜起的一股三昧真火，宽 w、高 h；中下段是缃到月白的芯，往外橘、朱砂，边上和窜起的火舌是朱、殷。
 * f 是第几帧（火舌摆动、往上跳），四帧一循环。底边正中是锚点。
 */
export function flamePillar(f: number, w = 13, h = 30): Grid {
  const rows = blank(w, h);
  const c = (w - 1) / 2;
  for (let y = 0; y < h; y++) {
    const k = y / (h - 1); // 0 顶 .. 1 底
    const sway = Math.sin(k * 7 + f * 1.6) * (1 - k) * 1.6; // 越往上摆得越厉害
    const base = (w / 2) * (0.25 + 0.75 * Math.pow(k, 0.55)) * (0.92 + 0.08 * Math.sin(f * 2.1 + y * 0.7));
    const mid = c + sway;
    for (let x = 0; x < w; x++) {
      const u = Math.abs(x - mid) / Math.max(0.6, base);
      // 火舌：边缘按噪声缺几块，顶上几缕往上蹿
      const ragged = hash(x + f * 13, y + f * 7) * 0.35 * (1 - k * 0.6);
      if (u > 1 - ragged) continue;
      const heat = (1 - u) * (0.35 + 0.65 * k); // 中下段最热
      const col = heat > 0.72 ? 'w' : heat > 0.58 ? 'Y' : heat > 0.44 ? 'y' : heat > 0.3 ? 'o' : heat > 0.17 ? 'e' : k < 0.3 ? 'r' : 'e';
      rows[y][x] = col;
    }
  }
  // 顶上跳起的火星（两三粒）
  for (let n = 0; n < 3; n++) {
    const x = Math.round(c + (hash(n, f) - 0.5) * w * 0.8);
    const y = Math.round(hash(f, n + 9) * 4);
    if (rows[y]?.[x] === '.') rows[y][x] = n % 2 ? 'o' : 'y';
  }
  return toGrid(rows);
}

/** 地上烧着的小火苗（烈焰阵的火柱落下之后烧地）：5×7，三帧。底边正中是锚点。 */
export function flameTongue(f: number): Grid {
  const shapes = [
    ['..y..', '..o..', '.oyo.', '.eyo.', 'eoYoe', 'eoYoe', '.rer.'],
    ['.y...', '.oo..', '.oy..', 'eoyo.', 'eyYoe', 'eoYoe', '.rer.'],
    ['...o.', '..oy.', '..yo.', '.oyoe', 'eoYye', 'eoYoe', '.rer.'],
  ];
  return grid(shapes[f % 3]);
}

/** 魂火（落魂阵）：一团惨绿的鬼火，芯是葱黄到月白，外层石绿、松，尾巴往上飘；7×11，三帧。底边正中是锚点（离地飘着）。 */
export function soulWisp(f: number): Grid {
  const shapes = [
    ['...l...', '...l...', '..lL...', '..lLl..', '.lLwLl.', '.lLwLl.', 'vlLwLlv', 'vlLLLlv', '.vlLlv.', '..vlv..', '...v...'],
    ['....l..', '...ll..', '..lL...', '.llLl..', '.lLwLl.', 'vlLwLl.', 'vlLwLlv', 'vlLLLlv', '.vlLlv.', '..vlv..', '...v...'],
    ['..l....', '..ll...', '...Ll..', '..lLl..', '.lLwLl.', '.lLwLlv', 'vlLwLlv', 'vlLLLlv', '.vlLlv.', '..vlv..', '...v...'],
  ];
  return grid(shapes[f % 3]);
}

// ---------------------------------------------------------------- 十座阵台

/** 阵台画布的大小和锚点：锚点（画布里的 AX, AY）就是阵眼的中心（模拟里 TEN.sites[i]）。 */
export const DAIS_W = 35;
export const DAIS_H = 42;
export const DAIS_AX = 17;
export const DAIS_AY = 35;

type Px = string[][];
const newPx = (): Px => blank(DAIS_W, DAIS_H);
const put = (c: Px, x: number, y: number, ch: string) => {
  x = Math.round(x);
  y = Math.round(y);
  if (x >= 0 && y >= 0 && x < DAIS_W && y < DAIS_H) c[y][x] = ch;
};
const get = (c: Px, x: number, y: number) => (x >= 0 && y >= 0 && x < DAIS_W && y < DAIS_H ? c[y][x] : '.');
/** 实心椭圆，按像素问 fn(dx, dy, d) 要颜色（d 是椭圆里的归一化距离 0..1；返回 null 不画）。 */
function ellipse(c: Px, cx: number, cy: number, rx: number, ry: number, fn: (dx: number, dy: number, d: number) => string | null) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const d = dx * dx + dy * dy;
      if (d > 1) continue;
      const ch = fn(dx, dy, Math.sqrt(d));
      if (ch) put(c, x, y, ch);
    }
}
function line(c: Px, x0: number, y0: number, x1: number, y1: number, ch: string) {
  const n = Math.max(1, Math.round(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  for (let i = 0; i <= n; i++) put(c, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, ch);
}
/** 在有色像素外面描一圈（只描透明处）；ch 为描边色。下沿留给台子，不描。 */
function rim(c: Px, ch: string, keep: (x: number, y: number) => boolean = () => true) {
  const add: [number, number][] = [];
  for (let y = 0; y < DAIS_H; y++)
    for (let x = 0; x < DAIS_W; x++) {
      if (c[y][x] !== '.' || !keep(x, y)) continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => get(c, x + dx, y + dy) !== '.' && get(c, x + dx, y + dy) !== ch)) add.push([x, y]);
    }
  for (const [x, y] of add) c[y][x] = ch;
}

/** 石台的配色：台面、台面左上沿受光、右下沿背光、上层石壁、石壁最下一行、下层台面、下层石壁。 */
interface Stone { t: string; hi: string; sh: string; w: string; wd: string; l: string; ld: string; trim?: string }
const STONE: Record<string, Stone> = {
  grey: { t: 'Q', hi: 'i', sh: 'h', w: 'h', wd: 'g', l: 'h', ld: 'g' }, // 灰紫石（天绝、红水）
  ochre: { t: 'S', hi: 's', sh: 'B', w: 'B', wd: 'd', l: 'B', ld: 'd' }, // 赭石（红沙）
  rust: { t: 'B', hi: 'S', sh: 'd', w: 'd', wd: 'k', l: 'D', ld: 'd' }, // 焦赭（地烈）
  pale: { t: 'i', hi: 'j', sh: 'h', w: 'h', wd: 'g', l: 'h', ld: 'g' }, // 银鼠（风吼）
  frost: { t: 'X', hi: 'T', sh: 'V', w: 'V', wd: 'O', l: 'V', ld: 'O' }, // 青石带霜（寒冰）
  gilt: { t: 'h', hi: 'i', sh: 'g', w: 'g', wd: 'd', l: 'g', ld: 'd', trim: 'U' }, // 黛石嵌金（金光）
  plum: { t: 'P', hi: 'p', sh: 'd', w: 'd', wd: 'k', l: 'g', ld: 'd' }, // 紫棠（化血）
  char: { t: 'g', hi: 'h', sh: 'd', w: 'd', wd: 'k', l: 'g', ld: 'd' }, // 烧黑的石（烈焰）
  cold: { t: 'V', hi: 'X', sh: 'O', w: 'O', wd: 'K', l: 'O', ld: 'K' }, // 青黑（落魂）
};

/** 两层的圆石台：下层宽一圈、矮一截；上层顶面扁圆，左上沿受光、右下沿背光，顶面一圈刻槽。 */
function platform(c: Px, s: Stone) {
  const cx = DAIS_AX;
  const by = DAIS_AY + 1;
  // 下层：台面 + 2 像素石壁
  for (let k = 2; k >= 1; k--) ellipse(c, cx, by + k, 15, 4.4, () => (k === 2 ? s.ld : s.ld));
  ellipse(c, cx, by, 15, 4.4, (dx, dy, d) => (d > 0.8 && dx + dy * 1.4 < -0.6 ? s.t : s.l));
  // 上层
  for (let k = 2; k >= 1; k--) ellipse(c, cx, by - 2 + k, 12, 3.6, (dx) => (k === 2 ? s.wd : Math.abs(dx) > 0.86 ? s.wd : s.w));
  ellipse(c, cx, by - 2, 12, 3.6, (dx, dy, d) => {
    if (d > 0.72 && dx + dy * 1.6 < -0.5) return s.hi;
    if (d > 0.78 && dx + dy * 1.6 > 0.7) return s.sh;
    if (d > 0.55 && d < 0.68 && Math.floor(Math.atan2(dy, dx) * 3) % 3 !== 0) return s.trim ?? s.sh; // 刻槽（金光阵嵌金）
    return s.t;
  });
  if (s.trim) for (let x = cx - 13; x <= cx + 13; x += 3) put(c, x, by + 3 + (Math.abs(x - cx) > 10 ? -1 : 0), s.trim); // 下层石壁上一排金钉
}

const finish = (c: Px) => toGrid(c);

/** 天绝阵 · 铜鼓雷台：台上立一面青铜鼓（鼓身两道箍、一排鼓钉，鼓面一圈云雷纹），亮起来鼓面的雷纹透出紫白的光。 */
function thunderDais(lit: boolean): Grid {
  const c = newPx();
  if (!lit) platform(c, STONE.grey);
  const cx = DAIS_AX;
  const top = 20;
  const bot = 32;
  if (!lit) {
    // 鼓身：上下略收（腰鼓的弧），左受光右背光
    for (let y = top; y <= bot; y++) {
      const k = (y - top) / (bot - top);
      const hw = 6.5 + Math.sin(k * Math.PI) * 1;
      for (let x = Math.round(cx - hw); x <= Math.round(cx + hw); x++) {
        const u = (x - cx) / hw;
        let ch = u < -0.6 ? 'y' : u < 0.2 ? 'b' : u < 0.75 ? 'B' : 'S';
        if (y === top + 2 || y === bot - 2) ch = u < -0.5 ? 'Y' : 'M'; // 两道箍
        if ((y === top + 3 || y === bot - 3) && (x - cx + 20) % 3 === 0) ch = 'Y'; // 鼓钉
        put(c, x, y, ch);
      }
    }
    // 鼓面
    ellipse(c, cx, top, 6.5, 2, (dx, dy, d) => (d > 0.78 ? 'B' : d > 0.45 ? 'y' : 'b'));
    // 鼓脚：三只短脚踩在台上
    for (const dx of [-5, 0, 5]) put(c, cx + dx, bot + 1, 'd');
    rim(c, 'd', (x, y) => y < bot);
  } else {
    // 雷纹：鼓面一圈回纹 + 中心一点；鼓身两道箍上的钉
    ellipse(c, cx, top, 4.6, 1.3, (dx, dy, d) => (d > 0.6 ? (Math.floor((Math.atan2(dy, dx) + 4) * 2.2) % 2 ? 'w' : null) : d < 0.25 ? 'W' : null));
    for (let x = cx - 6; x <= cx + 6; x++) if ((x - cx + 20) % 3 === 0) { put(c, x, top + 3, 'w'); put(c, x, bot - 3, 'w'); }
    line(c, cx - 2, top + 5, cx + 1, top + 7, 'm'); // 鼓身上一道细雷纹
    line(c, cx + 1, top + 7, cx - 1, top + 9, 'm');
  }
  return finish(c);
}

/** 烈焰阵 · 火盆：三足青铜火盆，盆里一层炭火；亮起来窜起三昧真火（lit 的三帧是火苗）。 */
function fireDais(lit: boolean, f = 0): Grid {
  const c = newPx();
  const cx = DAIS_AX;
  const rimY = 24;
  if (!lit) {
    platform(c, STONE.char);
    // 三足
    line(c, cx - 5, rimY + 4, cx - 7, DAIS_AY - 1, 'B');
    line(c, cx + 5, rimY + 4, cx + 7, DAIS_AY - 1, 'S');
    line(c, cx, rimY + 5, cx, DAIS_AY - 1, 'B');
    // 盆身：往下收
    for (let y = rimY; y <= rimY + 5; y++) {
      const hw = 8 - (y - rimY) * 0.8;
      for (let x = Math.round(cx - hw); x <= Math.round(cx + hw); x++) {
        const u = (x - cx) / hw;
        put(c, x, y, y === rimY + 1 ? 'M' : u < -0.55 ? 'y' : u < 0.3 ? 'b' : 'B');
      }
    }
    // 盆口：外沿亮、里面是暗红的炭
    ellipse(c, cx, rimY, 8, 2.2, (dx, dy, d) => (d > 0.72 ? (dy < 0 ? 'Y' : 'y') : (Math.round(dx * 7) + Math.round(dy * 3)) % 3 === 0 ? 'r' : 'R'));
    rim(c, 'd', (x, y) => y < DAIS_AY - 2);
  } else {
    // 火苗：盆口窜起的三簇火，三帧
    const tongues = [[-4, 7], [0, 10], [4, 7]];
    tongues.forEach(([dx, h], n) => {
      const hh = h + ((f + n) % 3) - 1;
      for (let k = 0; k < hh; k++) {
        const y = rimY - 1 - k;
        const sway = Math.round(Math.sin(k * 0.8 + f * 2 + n) * (k / hh) * 1.5);
        const half = Math.max(0, Math.round((1 - k / hh) * 2.2));
        for (let x = -half; x <= half; x++) put(c, cx + dx + x + sway, y, k < hh * 0.35 && Math.abs(x) < half ? 'Y' : k < hh * 0.7 ? 'o' : 'e');
      }
    });
    ellipse(c, cx, rimY, 6.5, 1.5, () => 'o');
  }
  return finish(c);
}

/** 寒冰阵 · 冰台：台上冻起一簇冰晶（中间一根高的，两边矮的斜出去）；平时冷灰发青，亮起来晶体里透出冰蓝的寒光。 */
function iceDais(lit: boolean): Grid {
  const c = newPx();
  const cx = DAIS_AX;
  const base = DAIS_AY - 1;
  // [顶点 x, 高, 底半宽, 斜]
  const shards: [number, number, number, number][] = [
    [cx - 6, 10, 2.4, -0.3],
    [cx + 6, 12, 2.6, 0.28],
    [cx - 2, 15, 2.8, -0.08],
    [cx + 2, 19, 3.2, 0.06],
  ];
  if (!lit) platform(c, STONE.frost);
  for (const [ax, h, hw, lean] of shards) {
    for (let k = 0; k <= h; k++) {
      const y = base - h + k;
      const mid = ax + lean * (h - k);
      const half = (hw * k) / h + 0.2;
      for (let x = Math.floor(mid - half); x <= Math.ceil(mid + half); x++) {
        const u = (x - mid) / Math.max(0.5, half);
        if (Math.abs(u) > 1.05) continue;
        if (!lit) put(c, x, y, k < 2 ? 'T' : u < -0.4 ? 'T' : u < 0.15 ? 'X' : u < 0.6 ? 'V' : 'O');
        else if (Math.abs(u) < 0.35 && k > 1 && k < h - 1) put(c, x, y, k < h * 0.5 ? 'w' : 'C'); // 晶心的光
        else if (lit && k < 2) put(c, x, y, 'w');
      }
    }
  }
  if (!lit) rim(c, 'O', (x, y) => y < base - 1);
  return finish(c);
}

/** 红沙阵 · 沙瓮：一口大肚陶瓮（赭红，两道暗红的箍纹），瓮口溢出一点红沙；亮起来瓮口、箍上的点透出橘红。 */
function sandDais(lit: boolean): Grid {
  const c = newPx();
  const cx = DAIS_AX;
  const cy = 26;
  if (!lit) {
    platform(c, STONE.ochre);
    ellipse(c, cx, cy, 7.5, 6.5, (dx, dy) => {
      if (Math.abs(dy * 6.5 + 1.5) < 0.6 || Math.abs(dy * 6.5 - 2.5) < 0.6) return Math.round(dx * 8) % 2 ? 'R' : 'r'; // 箍纹
      return dx < -0.55 ? 's' : dx < 0.25 ? 'S' : 'B';
    });
    for (let y = cy - 9; y <= cy - 6; y++) for (let x = cx - 2; x <= cx + 2; x++) put(c, x, y, x === cx - 2 ? 's' : x === cx + 2 ? 'B' : 'S'); // 瓮颈
    ellipse(c, cx, cy - 9, 3.6, 1.2, (dx, dy, d) => (d > 0.6 ? 's' : 'k')); // 瓮口
    // 溢出来的红沙：顺着瓮肩往下淌两道
    line(c, cx + 2, cy - 8, cx + 4, cy - 5, 'b');
    line(c, cx + 4, cy - 5, cx + 5, cy - 2, 'b');
    put(c, cx - 3, cy - 7, 'b');
    rim(c, 'd', (x, y) => y < DAIS_AY - 2);
  } else {
    ellipse(c, cx, cy - 9, 2.4, 0.8, () => 'o');
    for (let x = cx - 6; x <= cx + 6; x += 2) put(c, x, cy - 1, 'o');
    put(c, cx + 4, cy - 5, 'y');
    put(c, cx + 5, cy - 3, 'o');
  }
  return finish(c);
}

/** 金光阵 · 金镜：嵌金的台上立一面青铜圆镜（镜框暗金、镜面藤黄，顶上一颗宝珠），亮起来镜面放出金光。 */
function goldDais(lit: boolean): Grid {
  const c = newPx();
  const cx = DAIS_AX;
  const my = 19;
  if (!lit) {
    platform(c, STONE.gilt);
    // 镜座：两只弯脚 + 一根短柱
    line(c, cx - 4, DAIS_AY - 1, cx - 1, my + 8, 'M');
    line(c, cx + 4, DAIS_AY - 1, cx + 1, my + 8, 'M');
    for (let y = my + 6; y <= my + 10; y++) put(c, cx, y, 'U');
    // 镜：圆框（暗金，左上亮）+ 镜面
    ellipse(c, cx, my, 6.5, 6.5, (dx, dy, d) => {
      if (d > 0.8) return dx + dy < -0.5 ? 'y' : dx + dy > 0.6 ? 'M' : 'U';
      if (d > 0.68) return 'M';
      return dx + dy < -0.6 ? 'Y' : dx + dy < 0.2 ? 'y' : 'b';
    });
    put(c, cx, my - 8, 'Y'); // 宝珠
    put(c, cx, my - 7, 'U');
    rim(c, 'd', (x, y) => y < DAIS_AY - 2);
  } else {
    ellipse(c, cx, my, 4.4, 4.4, (dx, dy, d) => (d < 0.35 ? 'W' : dx + dy < 0 ? 'f' : 'Y'));
    put(c, cx, my - 8, 'W');
  }
  return finish(c);
}

/** 红水阵 · 水盆：宽口的青铜水盆（两只环耳），盛着一盆暗红的水；亮起来水面泛起朱砂的波光（lit 两帧）。 */
function waterDais(lit: boolean, f = 0): Grid {
  const c = newPx();
  const cx = DAIS_AX;
  const rimY = 26;
  if (!lit) {
    platform(c, STONE.grey);
    for (let y = rimY; y <= rimY + 5; y++) {
      const hw = 9.5 - (y - rimY) * 0.7;
      for (let x = Math.round(cx - hw); x <= Math.round(cx + hw); x++) {
        const u = (x - cx) / hw;
        put(c, x, y, y === rimY + 2 ? 'M' : u < -0.55 ? 'y' : u < 0.3 ? 'b' : 'B');
      }
    }
    for (let x = cx - 3; x <= cx + 3; x++) put(c, x, rimY + 6, 'B'); // 圈足
    // 环耳
    for (const s of [-1, 1]) {
      put(c, cx + s * 10, rimY + 1, 'b');
      put(c, cx + s * 11, rimY + 2, 'B');
      put(c, cx + s * 10, rimY + 3, 'b');
    }
    ellipse(c, cx, rimY, 9.5, 2.4, (dx, dy, d) => (d > 0.78 ? (dy < 0 ? 'Y' : 'y') : d > 0.6 ? 'r' : 'R'));
    rim(c, 'd', (x, y) => y < DAIS_AY - 2);
  } else {
    ellipse(c, cx, rimY, 7, 1.6, (dx, dy) => ((Math.round(dx * 7) + f * 2 + Math.round(dy * 2) * 3) % 5 === 0 ? 'o' : (Math.round(dx * 7) + f) % 4 === 1 ? 'e' : null));
  }
  return finish(c);
}

/** 地烈阵 · 裂石台：台上一块从中间裂开的大石（赭石，裂口里黑），亮起来裂口里透出岩火。 */
function quakeDais(lit: boolean): Grid {
  const c = newPx();
  const cx = DAIS_AX;
  const base = DAIS_AY - 1;
  // 左右两半：各一个歪的多边形（按每行的左右边界画）
  const half = (x0: number, x1: number, top: number, slant: number, lite: boolean, seed: number) => {
    for (let y = top; y <= base; y++) {
      const k = (y - top) / (base - top);
      const n = y - top;
      const inset = n === 0 ? 3 : n === 1 ? 1.6 : n === 2 ? 0.8 : 0; // 顶上磨圆
      const bump = Math.round(Math.sin(y * 1.3 + seed) * 0.7); // 石边不平
      const a = Math.round(x0 - k * 1.5 + (1 - k) * slant + (lite ? inset : 0) + bump);
      const b = Math.round(x1 + (1 - k) * slant * 0.6 - (lite ? 0 : inset) - bump);
      for (let x = a; x <= b; x++) {
        const u = (x - a) / Math.max(1, b - a);
        const facet = (x * 3 + y * 5 + seed) % 11 === 0; // 零星的石棱
        let ch = lite ? (u < 0.35 ? 's' : u < 0.8 ? 'S' : 'B') : u < 0.3 ? 'S' : u < 0.75 ? 'B' : 'D';
        if (n <= 1) ch = lite ? 's' : 'S';
        if (facet) ch = lite ? 'B' : 'd';
        put(c, x, y, ch);
      }
    }
  };
  if (!lit) {
    platform(c, STONE.rust);
    half(cx - 8, cx - 1, 17, 1, true, 1);
    half(cx + 1, cx + 8, 19, -1, false, 4);
    // 裂口
    for (let y = 18; y <= base; y++) put(c, cx + (y % 3 === 0 ? 1 : 0), y, 'k');
    // 台面上也裂了两道
    line(c, cx - 3, base + 2, cx - 9, base + 4, 'd');
    line(c, cx + 2, base + 2, cx + 7, base + 3, 'd');
    rim(c, 'd', (x, y) => y < base - 1);
  } else {
    for (let y = 19; y <= base - 1; y++) put(c, cx + (y % 3 === 0 ? 1 : 0), y, y < 24 ? 'o' : 'y');
    line(c, cx - 4, DAIS_AY + 1, cx - 8, DAIS_AY + 3, 'o');
    line(c, cx + 3, DAIS_AY + 1, cx + 6, DAIS_AY + 2, 'o');
  }
  return finish(c);
}

/**
 * 幡（落魂幡、血幡）的一帧：一根旗杆（顶上杆头），横杆下挂一条竖着的幡。phase 0..1 摆动的相位，wind 0 平时 / 1 猎猎。
 *  - soul 落魂幡：窄长、缟白的幡，下摆撕成几缕，幡上一道墨写的符；杆头一点魂火（lit 里）；
 *  - blood 血幡：宽一点的殷红的幡，下摆燕尾，幡上一个黑的符印，往下滴血（lit 里符印透红）。
 */
function bannerDais(kind: 'soul' | 'blood', lit: boolean, phase: number, wind: number): Grid {
  const c = newPx();
  const pole = DAIS_AX - 4;
  const top = 6;
  const bar = 9;
  const x0 = pole + 2;
  const bw = kind === 'soul' ? 6 : 8;
  const bh = kind === 'soul' ? 16 : 14;
  if (!lit) platform(c, kind === 'soul' ? STONE.cold : STONE.plum);
  for (let y = 0; y < bh; y++) {
    const k = y / (bh - 1);
    const shift = Math.round(Math.sin(phase * TAU2 + k * 2.2) * k * (wind > 0.5 ? 2.2 : 1) + (wind > 0.5 ? k * 2.5 : 0));
    for (let i = 0; i < bw; i++) {
      const x = x0 + i + shift;
      const yy = bar + 1 + y;
      // 下摆：落魂幡撕成几缕（每隔一列长短不一），血幡是燕尾
      if (kind === 'soul' && y > bh - 5 && (i % 2 === (Math.floor(phase * 4) % 2) || y > bh - 2 - (i % 3))) continue;
      if (kind === 'blood' && y > bh - 4 && Math.abs(i - (bw - 1) / 2) < (y - (bh - 4)) * 0.9) continue;
      if (!lit) {
        let ch = kind === 'soul' ? (i === 0 ? 'w' : i === bw - 1 ? 'i' : 'j') : i === 0 ? 'r' : i === bw - 1 ? 'R' : 'R';
        if (kind === 'blood' && i > 0 && i < bw - 1 && (i + y) % 4 === 0) ch = 'r';
        // 符：落魂幡一道竖写的墨符；血幡中间一个黑的符印
        if (kind === 'soul' && i === Math.floor(bw / 2) && y > 1 && y < bh - 5 && y % 3 !== 0) ch = 'g';
        if (kind === 'blood' && BLOOD_SIGIL.has(y * 10 + i)) ch = 'k';
        put(c, x, yy, ch);
      } else {
        if (kind === 'soul' && i === Math.floor(bw / 2) && y > 1 && y < bh - 5 && y % 3 !== 0) put(c, x, yy, 'l');
        if (kind === 'blood' && BLOOD_SIGIL.has(y * 10 + i)) put(c, x, yy, 'e');
        if (kind === 'blood' && y === bh - 1 && (i === 1 || i === bw - 2)) put(c, x, yy + 1 + (Math.floor(phase * 4) % 2), 'e'); // 滴血
      }
    }
  }
  if (!lit) {
    for (let y = top; y < DAIS_AY - 1; y++) put(c, pole, y, y % 5 === 0 ? 'b' : 'B'); // 旗杆
    for (let x = pole; x <= x0 + bw; x++) put(c, x, bar, 'B'); // 横杆
    put(c, pole, top - 1, kind === 'soul' ? 'L' : 'y'); // 杆头
    if (kind === 'blood') {
      put(c, pole + 1, top + 1, 'r'); // 红缨
      put(c, pole + 1, top + 2, 'R');
    }
    rim(c, 'd', (x, y) => y < DAIS_AY - 3);
  } else if (kind === 'soul') {
    // 杆头的魂火
    put(c, pole, top - 1, 'w');
    put(c, pole, top - 2, 'L');
    put(c, pole + (Math.floor(phase * 4) % 2 ? 1 : -1), top - 3, 'l');
  }
  return finish(c);
}

/** 风吼阵 · 风幡：一根细高的杆，杆头挂三条长长的飘带（缟白，梢上天青），平时垂着轻摆，猎猎时绷直、往右扯成波浪。 */
function windDais(lit: boolean, phase: number, wind: number): Grid {
  const c = newPx();
  const pole = DAIS_AX - 5;
  const top = 6;
  if (!lit) platform(c, STONE.pale);
  const streams = [
    [top + 1, 13],
    [top + 4, 11],
    [top + 7, 9],
  ];
  streams.forEach(([y0, len], n) => {
    for (let i = 0; i < len; i++) {
      const k = i / (len - 1);
      const droop = wind > 0.5 ? k * 1.5 : k * k * 9; // 平时往下垂，猎猎时平着飘
      const wave = Math.sin(phase * TAU2 * (wind > 0.5 ? 1 : 0.5) - k * 4 + n) * (wind > 0.5 ? 1.3 : 0.8) * k;
      const x = pole + 1 + Math.round(i * (wind > 0.5 ? 1 : 0.55));
      const y = y0 + Math.round(droop + wave);
      if (!lit) {
        put(c, x, y, k > 0.75 ? 'C' : n === 0 ? 'w' : 'j');
        if (k < 0.45) put(c, x, y + 1, 'i'); // 飘带根部宽一点
      } else if (k > 0.6) put(c, x, y, 'C');
    }
  });
  if (!lit) {
    for (let y = top; y < DAIS_AY - 1; y++) put(c, pole, y, y % 4 === 0 ? 'h' : 'i'); // 细竹杆
    put(c, pole, top - 1, 'C');
    put(c, pole, top - 2, 'w');
    rim(c, 'g', (x, y) => y < DAIS_AY - 3);
  }
  return finish(c);
}
const TAU2 = Math.PI * 2;
/** 血幡上的符印（第 y 行第 i 列；一个上面开口的「凵」托着一点，像一滴血落进碗里）。 */
const BLOOD_SIGIL = new Set([3 * 10 + 3, 3 * 10 + 4, 4 * 10 + 3, 4 * 10 + 4, 5 * 10 + 1, 5 * 10 + 6, 6 * 10 + 1, 6 * 10 + 6, 7 * 10 + 1, 7 * 10 + 2, 7 * 10 + 3, 7 * 10 + 4, 7 * 10 + 5, 7 * 10 + 6, 8 * 10 + 3, 8 * 10 + 4]);

/**
 * 一座阵台的画：base 平时的样子（几帧：幡类是摆动、猎猎各四帧，其余一帧），lit 亮起来叠加上去的光（同样几帧；火盆、水盆是火苗 / 波光的三帧），
 * flag：这座阵台旁边另插一面小阵旗（幡类自己就是旗，不插）；flagAt：旗插在台面的哪里（相对锚点）。
 */
export interface DaisArt {
  idle: Grid[];
  flutter: Grid[];
  litIdle: Grid[];
  litFlutter: Grid[];
  flag: boolean;
  flagAt: [number, number];
}
export function daisArt(kind: string): DaisArt {
  const P = [0, 0.25, 0.5, 0.75];
  const one = (fn: (lit: boolean) => Grid, flagAt: [number, number] = [-9, -2]): DaisArt => {
    const g = fn(false);
    const l = fn(true);
    return { idle: [g], flutter: [g], litIdle: [l], litFlutter: [l], flag: true, flagAt };
  };
  switch (kind) {
    case 'thunder':
      return one(thunderDais);
    case 'gold':
      return one(goldDais, [-10, -1]);
    case 'ice':
      return one(iceDais, [-10, -1]);
    case 'sand':
      return one(sandDais);
    case 'quake':
      return one(quakeDais, [-11, -1]);
    case 'fire': {
      const g = fireDais(false);
      const l = [0, 1, 2].map((f) => fireDais(true, f));
      return { idle: [g], flutter: [g], litIdle: l, litFlutter: l, flag: true, flagAt: [-11, -1] };
    }
    case 'water': {
      const g = waterDais(false);
      const l = [0, 1, 2].map((f) => waterDais(true, f));
      return { idle: [g], flutter: [g], litIdle: l, litFlutter: l, flag: true, flagAt: [-11, -2] };
    }
    case 'wind':
      return { idle: P.map((p) => windDais(false, p, 0)), flutter: P.map((p) => windDais(false, p, 1)), litIdle: P.map((p) => windDais(true, p, 0)), litFlutter: P.map((p) => windDais(true, p, 1)), flag: false, flagAt: [0, 0] };
    default: {
      const k = kind as 'soul' | 'blood';
      return { idle: P.map((p) => bannerDais(k, false, p, 0)), flutter: P.map((p) => bannerDais(k, false, p, 1)), litIdle: P.map((p) => bannerDais(k, true, p, 0)), litFlutter: P.map((p) => bannerDais(k, true, p, 1)), flag: false, flagAt: [0, 0] };
    }
  }
}
