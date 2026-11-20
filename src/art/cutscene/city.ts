// 陈塘关：东海之滨的关城（第 4 镜的远景）、关门近景（第 5 镜）、关内的街（第 6 镜）。纯函数，输出调色板颜色的位图。
// 造型口径：修仙玄幻的关城，不是考古复原——青灰的城墙、朱漆的柱、黛瓦飞檐，窗里透出回响的天青魂火；
// 光从左上来（远景里天边那一线暗光在城后，所以城的轮廓上沿镶一道胭脂紫的亮边）。像素整齐、分档平涂，不铺随机噪点。
import { blank, bayer, mulberry32, put, rect, type Bitmap } from './common.ts';

/** 屋顶（侧立面）：檐口两头起翘，屋面一垄垄的瓦，正脊两头鸱吻。eaveY 是檐口那一行，halfW 是檐口半宽（含翘角）。 */
export function roof(b: Bitmap, cx: number, eaveY: number, halfW: number, height: number, ridgeHalf: number, tone: { tile: string; dark: string; lit: string; ridge: string; gold?: string }) {
  for (let y = 0; y <= height; y++) {
    const u = y / height; // 0 檐口 … 1 正脊
    // 屋面的轮廓往里凹：檐口宽、往上收得快、到正脊收成 ridgeHalf
    const half = ridgeHalf + (halfW - ridgeHalf) * Math.pow(1 - u, 1.7);
    const Y = eaveY - y;
    for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++) {
      const v = (x - (cx - half)) / Math.max(1, half * 2);
      let ch = (x - Math.round(cx)) % 3 === 0 ? tone.dark : tone.tile; // 一垄垄的瓦
      if (v < 0.12) ch = tone.lit;
      if (v > 0.9) ch = tone.dark;
      if (y === 0) ch = tone.dark; // 檐口的阴影
      put(b, x, Y, ch);
    }
  }
  // 翘角：檐口两头各往上挑两三像素
  for (const s of [-1, 1]) {
    const x = Math.round(cx + s * halfW);
    put(b, x, eaveY - 1, tone.lit);
    put(b, x + s, eaveY - 2, tone.lit);
    put(b, x + s, eaveY - 3, tone.ridge);
  }
  // 正脊
  const ry = eaveY - height;
  for (let x = Math.round(cx - ridgeHalf - 1); x <= Math.round(cx + ridgeHalf + 1); x++) {
    put(b, x, ry, tone.ridge);
    put(b, x, ry - 1, tone.dark);
  }
  // 鸱吻
  for (const s of [-1, 1]) {
    const x = Math.round(cx + s * (ridgeHalf + 1));
    put(b, x, ry - 2, tone.gold ?? tone.ridge);
    put(b, x + s, ry - 3, tone.gold ?? tone.ridge);
    put(b, x, ry - 3, tone.dark);
  }
}

export interface City {
  b: Bitmap;
  /** 透出魂火的窗、城门洞（位图坐标）：调用方让它们明灭。 */
  lights: { x: number; y: number; w: number; h: number }[];
  /** 城墙顶（垛口）那一行、城门的中心。 */
  wallTop: number;
  gate: { x: number; y: number };
}

/**
 * 远景的关城：岬角上一道长城墙，左端一座角楼，城门上一座两层的城楼；墙后露出几重屋顶。
 * 城墙的立面只分几道横的砌缝（不画方格），垛口一个个整齐地排开。
 */
export function makeCity(width = 420): City {
  const W = Math.max(420, width);
  const H = 150;
  const b = blank(W, H);
  const rnd = mulberry32(77);
  const lights: City['lights'] = [];
  const wallTop = 78;
  const wallBot = 100;
  const wallX0 = 40;
  // 1. 墙后的屋顶：几重，越远越淡（黛 → 苍），窗里偶有天青的魂火
  const backs: [number, number, number, number][] = [
    [120, 70, 22, 9],
    [175, 64, 26, 11],
    [300, 66, 30, 12],
    [360, 71, 22, 9],
    [250, 72, 18, 8],
    [90, 74, 16, 7],
  ];
  // 画面更宽时，墙后往右再排几重屋顶
  for (let x = 430; x < W + 30; x += 46 + Math.floor(rnd() * 30)) backs.push([x, 66 + Math.floor(rnd() * 8), 16 + Math.floor(rnd() * 14), 7 + Math.floor(rnd() * 5)]);
  for (const [x, ey, hw, hh] of backs) {
    roof(b, x, ey, hw, hh, Math.round(hw * 0.35), { tile: 'g', dark: 'd', lit: 'h', ridge: 'h' });
    // 屋檐下的一截墙和窗
    rect(b, x - hw + 4, ey + 1, hw * 2 - 8, wallTop - ey - 1, 'd');
    if (rnd() < 0.8) {
      const wx = x - 3 + Math.round((rnd() - 0.5) * hw);
      rect(b, wx, ey + 2, 2, 2, 'c');
      lights.push({ x: wx, y: ey + 2, w: 2, h: 2 });
    }
  }
  // 远处一座高塔（七重檐，只露上半截）
  for (let k = 0; k < 5; k++) {
    const ey = 60 - k * 9;
    roof(b, 210, ey, 13 - k * 2, 5, 3, { tile: 'g', dark: 'd', lit: 'h', ridge: 'h' });
    rect(b, 210 - (8 - k * 1.5), ey + 1, Math.round((8 - k * 1.5) * 2), 3, 'd');
    if (k < 3) {
      put(b, 209, ey + 2, 'c');
      lights.push({ x: 209, y: ey + 2, w: 1, h: 1 });
    }
  }
  rect(b, 209, 60 - 5 * 9 - 6, 2, 4, 'h'); // 塔刹
  put(b, 210, 60 - 5 * 9 - 8, 'i');
  // 2. 城墙：立面苍色，上沿一像素银鼠受光，下沿压暗；三道断续的横砌缝；左端连着角楼
  for (let y = wallTop; y <= wallBot; y++)
    for (let x = wallX0; x < W; x++) {
      const d = y - wallTop;
      let ch = 'h';
      if (d === 0) ch = 'i';
      else if (d >= wallBot - wallTop - 2) ch = 'g';
      else if ((d === 6 || d === 12 || d === 17) && bayer(x, y) < 0.7 && (x + d * 3) % 11 !== 0) ch = 'g';
      put(b, x, y, ch);
    }
  // 垛口：垛 4 宽、缺 2 宽，垛顶一像素银鼠
  for (let x = wallX0; x < W - 2; x += 6) {
    rect(b, x, wallTop - 4, 4, 4, 'h');
    rect(b, x, wallTop - 4, 4, 1, 'i');
    put(b, x + 3, wallTop - 3, 'g');
    put(b, x + 3, wallTop - 2, 'g');
    // 垛上的箭窗：一像素暗
    if ((x / 6) % 3 === 1) put(b, x + 1, wallTop - 2, 'd');
  }
  // 墙上的马面（凸出的墩台）：隔一段一座，左亮右暗
  const bastions = [110, 175, 320, 385];
  for (let x = 455; x < W; x += 70) bastions.push(x);
  for (const mx of bastions) {
    for (let y = wallTop - 4; y <= wallBot; y++) {
      put(b, mx - 6, y, 'i');
      for (let x = mx - 5; x <= mx + 5; x++) put(b, x, y, x > mx + 2 ? 'g' : y === wallTop - 4 ? 'i' : 'h');
    }
  }
  // 3. 城门：城楼正下方一个圆拱门洞，洞里黑沉沉的、深处一点天青
  const gx = 250;
  const archW = 18;
  const archTop = wallTop + 4;
  for (let y = archTop; y <= wallBot; y++)
    for (let x = gx - archW / 2; x < gx + archW / 2; x++) {
      const dx = (x + 0.5 - gx) / (archW / 2);
      const dy = (y - (archTop + archW / 2)) / (archW / 2);
      if (y < archTop + archW / 2 && dx * dx + dy * dy > 1) continue;
      const edge = Math.abs(dx) > 0.8 || (y < archTop + archW / 2 && dx * dx + dy * dy > 0.7);
      put(b, x, y, edge ? 'g' : y > wallBot - 5 ? 'n' : 'd');
    }
  rect(b, gx - 3, wallBot - 6, 6, 3, 'c');
  lights.push({ x: gx - 3, y: wallBot - 6, w: 6, h: 3 });
  // 4. 城楼：墙顶上一座两层的楼——朱柱、黛瓦、上层窗里魂火
  const ty = wallTop - 4; // 楼的地面
  rect(b, gx - 30, ty - 3, 60, 3, 'i'); // 台基
  rect(b, gx - 30, ty - 1, 60, 1, 'h');
  // 下层：四根朱柱、柱间暗
  rect(b, gx - 24, ty - 13, 48, 10, 'd');
  for (const cx of [-22, -8, 7, 21]) {
    rect(b, gx + cx, ty - 13, 2, 10, 'r');
    put(b, gx + cx + 1, ty - 13, 'R');
  }
  for (const wx of [-16, 0, 13]) {
    rect(b, gx + wx - 1, ty - 10, 3, 3, 'c');
    lights.push({ x: gx + wx - 1, y: ty - 10, w: 3, h: 3 });
  }
  roof(b, gx, ty - 13, 36, 9, 18, { tile: 'g', dark: 'd', lit: 'i', ridge: 'h', gold: 'y' });
  // 上层
  rect(b, gx - 15, ty - 30, 30, 8, 'd');
  for (const cx of [-13, -1, 11]) rect(b, gx + cx, ty - 30, 2, 8, 'r');
  for (const wx of [-7, 5]) {
    rect(b, gx + wx - 1, ty - 28, 3, 3, 'C');
    lights.push({ x: gx + wx - 1, y: ty - 28, w: 3, h: 3 });
  }
  roof(b, gx, ty - 30, 26, 8, 9, { tile: 'g', dark: 'd', lit: 'i', ridge: 'h', gold: 'y' });
  // 5. 角楼：城墙左端，一座小的单檐楼
  const kx = wallX0 + 10;
  rect(b, kx - 14, ty - 2, 28, 2, 'i');
  rect(b, kx - 11, ty - 11, 22, 9, 'd');
  for (const cx of [-10, -1, 8]) rect(b, kx + cx, ty - 11, 2, 9, 'r');
  rect(b, kx - 6, ty - 9, 2, 2, 'c');
  lights.push({ x: kx - 6, y: ty - 9, w: 2, h: 2 });
  roof(b, kx, ty - 11, 20, 8, 7, { tile: 'g', dark: 'd', lit: 'i', ridge: 'h', gold: 'y' });
  // 角楼下的墩台：墙的左端
  for (let y = wallTop - 4; y <= wallBot + 2; y++) for (let x = wallX0 - 8; x < wallX0 + 2; x++) put(b, x, y, x < wallX0 - 6 ? 'i' : y === wallTop - 4 ? 'i' : 'h');
  // 6. 岬角：城下的崖，往左斜着落进海里。岩面分成一片片不规则的岩块（最近点划分、横向拉长，读成一层层的岩），
  //    每块一个色阶（越往下越暗），块的上沿受光一像素、块缝压暗；崖顶贴着墙脚一道暗影。
  const cliffTop = wallBot + 1;
  const leftAt = (y: number) => {
    const u = (y - cliffTop) / (H - cliffTop);
    return wallX0 - 8 - Math.pow(u, 1.25) * 74 + Math.sin(y * 0.55) * 2 + Math.sin(y * 1.7) * 1.2;
  };
  rockFace(b, (x, y) => y >= cliffTop && x >= leftAt(y), wallX0 - 90, cliffTop, W - 1, H - 1, 79, (y) => (y - cliffTop) / (H - cliffTop));
  for (let x = wallX0 - 8; x < W; x++) put(b, x, cliffTop, 'd');
  // 崖上几簇草
  for (let y = cliffTop + 2; y < H - 8; y += 3) {
    if (rnd() < 0.55) continue;
    const x = Math.round(leftAt(y)) + 1 + Math.floor(rnd() * 3);
    put(b, x, y - 1, 'G');
    put(b, x + 1, y - 1, 'v');
    put(b, x + 1, y - 2, 'G');
  }
  return { b, lights, wallTop, gate: { x: gx, y: wallBot } };
}

/**
 * 岩面：mask 里的区域分成一片片不规则的岩块——撒一层抖动过的格点，每个像素归最近的那个点（横向的距离打折，块是扁长的，
 * 读成一层层的岩）；每块一个色阶，deep(y) 越大越暗；块的上沿（上面一格属于别的块）亮一档，块缝（离两个点差不多远）压暗。
 */
export function rockFace(b: Bitmap, mask: (x: number, y: number) => boolean, x0: number, y0: number, x1: number, y1: number, seed: number, deep: (y: number) => number) {
  const rnd = mulberry32(seed);
  const CW = 15;
  const CH = 7;
  const pts: { x: number; y: number; tone: number }[] = [];
  for (let gy = y0 - CH; gy <= y1 + CH; gy += CH)
    for (let gx = x0 - CW; gx <= x1 + CW; gx += CW) pts.push({ x: gx + rnd() * CW, y: gy + rnd() * CH, tone: rnd() });
  const cols = Math.ceil((x1 - x0 + CW * 2) / CW) + 1;
  const owner = new Int32Array((x1 - x0 + 1) * (y1 - y0 + 1)).fill(-1);
  const at = (x: number, y: number) => (x < x0 || y < y0 || x > x1 || y > y1 ? -1 : owner[(y - y0) * (x1 - x0 + 1) + (x - x0)]);
  const near = (x: number, y: number) => {
    let best = -1;
    let bd = 1e9;
    let second = 1e9;
    const gx = Math.floor((x - (x0 - CW)) / CW);
    const gy = Math.floor((y - (y0 - CH)) / CH);
    for (let j = gy - 2; j <= gy + 2; j++)
      for (let i = gx - 2; i <= gx + 2; i++) {
        const p = pts[j * cols + i];
        if (!p) continue;
        const d = Math.hypot((x - p.x) * 0.55, y - p.y);
        if (d < bd) {
          second = bd;
          bd = d;
          best = j * cols + i;
        } else if (d < second) second = d;
      }
    return { best, gap: second - bd };
  };
  const gaps = new Float32Array(owner.length);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (!mask(x, y)) continue;
      const n = near(x, y);
      owner[(y - y0) * (x1 - x0 + 1) + (x - x0)] = n.best;
      gaps[(y - y0) * (x1 - x0 + 1) + (x - x0)] = n.gap;
    }
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const o = at(x, y);
      if (o < 0) continue;
      const g = gaps[(y - y0) * (x1 - x0 + 1) + (x - x0)];
      const dv = Math.max(0, Math.min(1, deep(y)));
      const p = pts[o];
      // 这一块的色阶：苍 / 黛 / 乌，越往下越暗
      const v = p.tone * 0.7 + dv * 0.75;
      let ch = v < 0.42 ? 'h' : v < 0.95 ? 'g' : 'd';
      const above = at(x, y - 1);
      if (g < 0.9) ch = 'd'; // 块缝
      else if (above !== o && above >= 0 && g > 1.4) ch = ch === 'd' ? 'g' : ch === 'g' ? 'h' : 'i'; // 上沿受光
      else if (above < 0) ch = ch === 'd' ? 'g' : 'h'; // 崖顶 / 崖边
      put(b, x, y, ch);
    }
}

// ---------- 第 5 镜：关门近景 ----------

export interface GateWall {
  b: Bitmap;
  /** 门洞（位图坐标）：门洞的中心 x、门洞底（地面）y、宽、拱顶。 */
  arch: { cx: number; ground: number; w: number; top: number };
  /** 地面那一行。 */
  ground: number;
}

/**
 * 关门近景：一面高大的青石城墙铺满画面，正中偏右一个大拱门，两扇朱漆门、金门钉，门楣上一块黑底金字的匾（字是笔画团）；
 * 墙的石块大小不一、错缝砌，受光的上沿亮一档、下沿压暗（不是方格）；墙脚是石板路，往前铺到画面底。
 * w×h：铺满画布；archX：门洞的中心。
 */
export function makeGateWall(w: number, h: number, archX: number, ground: number, wallTop = -40): GateWall {
  const b = blank(w, h);
  const rnd = mulberry32(91);
  // 0. 墙顶之上：城楼的底层压在门洞正上方（一截台基、几根朱柱，檐口在画面上方以外）；城楼两边是天（透明，另画）
  if (wallTop > 0) {
    const tw = 150;
    const tx0 = Math.round(archX - tw / 2);
    // 柱子之间是暗的楼身，窗里透出魂火
    for (let y = 0; y < wallTop - 6; y++)
      for (let x = tx0 + 6; x < tx0 + tw - 6; x++) put(b, x, y, (x - tx0) % 30 < 4 ? 'r' : y % 9 === 0 ? 'g' : 'd');
    for (let x = tx0 + 6; x < tx0 + tw - 6; x += 30) for (let y = 0; y < wallTop - 6; y++) put(b, x, y, 'R'), put(b, x + 1, y, 'r'), put(b, x + 2, y, 'e'), put(b, x + 3, y, 'r');
    for (let x = tx0 + 16; x < tx0 + tw - 18; x += 30) for (let y = Math.max(0, wallTop - 26); y < wallTop - 14; y++) for (let i = 0; i < 8; i++) put(b, x + i, y, (i + y) % 3 === 0 ? 'g' : 'n');
    // 台基：两层石
    for (let x = tx0; x < tx0 + tw; x++) {
      put(b, x, wallTop - 6, 'i');
      put(b, x, wallTop - 5, 'h');
      put(b, x, wallTop - 4, 'h');
      put(b, x, wallTop - 3, 'g');
    }
  }
  // 1. 墙：一层层的大条石（层高 18–26、块宽 34–76），错缝砌。块面苍色，上沿与左沿一像素银鼠（受光的倒角）、
  //    下沿与右沿一像素黛，块与块之间一像素乌的灰缝。越往上越隐进夜色里（上面几层的块面压一档成黛）。
  let y = ground;
  let row = 0;
  while (y > Math.max(-30, wallTop)) {
    const rh = 18 + Math.floor(rnd() * 9);
    let x = -Math.floor(rnd() * 60);
    const high = (ground - y) / Math.max(1, ground);
    while (x < w) {
      const bw = 34 + Math.floor(rnd() * 43);
      const dim = rnd() < Math.min(1, Math.max(0, (high - 0.3) / 0.45)) ** 1.2; // 越往上越多压暗的块：慢慢隐进夜色，没有一条明暗分界线
      const body = dim ? 'g' : 'h';
      const lit = dim ? 'h' : 'i';
      const shade = dim ? 'd' : 'g';
      const pits = Math.floor(rnd() * 4);
      const pitAt = Array.from({ length: pits }, () => [2 + Math.floor(rnd() * (bw - 5)), 3 + Math.floor(rnd() * (rh - 6))]);
      for (let j = 0; j < rh; j++)
        for (let i = 0; i < bw; i++) {
          const X = x + i;
          const Y = y - rh + j;
          if (X < 0 || X >= w || Y < 0 || Y >= h || Y < wallTop) continue;
          let ch = body;
          if (j === 0 || i === 0) ch = 'd'; // 灰缝
          else if (j === 1 || (i === 1 && j < rh - 2)) ch = lit; // 受光的倒角
          else if (j === rh - 1 || i === bw - 1) ch = shade;
          put(b, X, Y, ch);
        }
      // 风化的小坑：两三像素一团，左上亮、右下暗
      for (const [px, py] of pitAt) {
        put(b, x + px, y - rh + py, shade);
        put(b, x + px + 1, y - rh + py, shade);
        put(b, x + px, y - rh + py - 1, lit);
      }
      // 墙脚两层的上沿长着青苔
      if (row < 2 && rnd() < 0.5)
        for (let k = 0; k < 9; k++) {
          const mx = x + 2 + Math.floor(rnd() * (bw - 4));
          put(b, mx, y - rh + 1, rnd() < 0.6 ? 'v' : 'G');
          if (rnd() < 0.4) put(b, mx, y - rh + 2, 'G');
        }
      x += bw;
    }
    y -= rh;
    row++;
  }
  // 墙顶：一排垛口（垛 18 宽、缺 8 宽），垛顶一像素受光；城楼底下那一段不开垛口
  if (wallTop > 0) {
    for (let x = 0; x < w; x++) {
      put(b, x, wallTop, 'h');
      put(b, x, wallTop + 1, 'g');
    }
    for (let x = -6; x < w; x += 26) {
      if (Math.abs(x + 9 - archX) < 84) continue;
      for (let j = 1; j <= 12; j++)
        for (let i = 0; i < 18; i++) {
          const X = x + i;
          const Y = wallTop - j;
          let ch = 'g';
          if (j === 12) ch = 'h';
          else if (i === 0) ch = 'h';
          else if (i === 17) ch = 'd';
          put(b, X, Y, ch);
        }
    }
  }
  // 2. 门洞：圆拱，一圈大券石（放射的灰缝），洞里乌黑；两扇朱漆门半掩，门钉金色
  const aw = 80;
  const top = ground - 110;
  const r = aw / 2;
  const cy = top + r;
  for (let Y = top - 12; Y <= ground; Y++)
    for (let X = archX - r - 12; X <= archX + r + 12; X++) {
      const dx = X + 0.5 - archX;
      const dy = Y < cy ? Y + 0.5 - cy : 0;
      const d = Math.hypot(dx, dy);
      if (d > r + 10) continue;
      if (d > r) {
        const ang = Math.atan2(dy, dx);
        const seg = (ang / Math.PI) * 13;
        const joint = Y < cy && Math.abs(seg - Math.round(seg)) < 0.09;
        let ch = d > r + 9 ? 'd' : d > r + 8 ? 'g' : d < r + 1.5 ? 'g' : 'h';
        if (d > r + 1.5 && d < r + 3) ch = 'i';
        if (joint && d < r + 9) ch = 'd';
        if (Y >= cy) ch = d > r + 9 ? 'd' : d < r + 1.5 ? 'g' : d < r + 3 ? 'i' : 'h'; // 门垛
        put(b, X, Y, ch);
        continue;
      }
      put(b, X, Y, Y > ground - 3 ? 'd' : 'k');
    }
  // 门扇：左扇关着、右扇开了一道缝（缝里透出天青的魂光）
  const doorTop = cy - 6;
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? archX - r + 3 : archX + 2;
    const x1 = side < 0 ? archX - 2 : archX + r - 3;
    for (let Y = doorTop; Y < ground - 1; Y++)
      for (let X = x0; X <= x1; X++) {
        const dx = X + 0.5 - archX;
        const dy = Y < cy ? Y + 0.5 - cy : 0;
        if (Math.hypot(dx, dy) > r - 3) continue;
        // 门在门洞的阴影里：殷红为主，只有靠门缝（魂光照着）的一边亮一档；门钉是暗金
        let ch = 'R';
        if (X === x0 || X === x1) ch = 'k';
        else if (Y === ground - 2) ch = 'k';
        else if ((X - x0) % 8 === 3 && (Y - doorTop) % 8 === 3) ch = 'b'; // 门钉
        else if ((X - x0) % 8 === 4 && (Y - doorTop) % 8 === 4) ch = 'k';
        else if ((side < 0 && X > x1 - 4) || (side > 0 && X < x0 + 4)) ch = 'r';
        put(b, X, Y, ch);
      }
  }
  // 门缝里的魂光
  for (let Y = doorTop + 6; Y < ground - 2; Y++) put(b, archX, Y, Y % 3 === 0 ? 'C' : 'c');
  // 铺首（门环）
  for (const sx of [archX - 9, archX + 8]) {
    const ry = cy + 20;
    put(b, sx, ry - 2, 'B');
    put(b, sx, ry - 1, 'Y');
    put(b, sx - 1, ry, 'y');
    put(b, sx + 1, ry, 'y');
    put(b, sx - 1, ry + 1, 'b');
    put(b, sx + 1, ry + 1, 'b');
    put(b, sx, ry + 2, 'b');
  }
  // 3. 匾：门楣上一块乌底金边的横匾，三个金色的笔画团（读成「陈塘关」三个字，不必认得）
  const pw = 60;
  const ph = 19;
  const px = Math.round(archX - pw / 2);
  const py = top - 34;
  rect(b, px - 2, py - 2, pw + 4, ph + 4, 'd');
  rect(b, px - 1, py - 1, pw + 2, ph + 2, 'B');
  rect(b, px, py, pw, ph, 'y');
  rect(b, px, py, pw, 1, 'Y');
  rect(b, px + 2, py + 2, pw - 4, ph - 4, 'k');
  rect(b, px + 3, py + 3, pw - 6, ph - 6, 'd');
  const glyphs = [
    ['.YYY.Y.', 'Y.Y.YYY', 'YYY..Y.', 'Y.YYYYY', 'YYY..Y.', 'Y.Y.Y.Y', 'Y..Y..Y'],
    ['.Y.YYYY', 'YYY..Y.', '.Y.YYYY', '.YYY..Y', 'YY.YYYY', '.Y.Y..Y', 'YYYYYYY'],
    ['Y.....Y', '.Y...Y.', 'YYYYYYY', '...Y...', 'YYYYYYY', '..Y.Y..', 'YY...YY'],
  ];
  glyphs.forEach((g, k) => g.forEach((rw, j) => [...rw].forEach((ch, i) => ch !== '.' && put(b, px + 10 + k * 15 + i, py + 6 + j, j > 4 ? 'y' : ch))));
  // 4. 地面：墙脚一道暗影，往前是一行行的大石板（越近越宽越高：透视），每块上沿一像素受光，灰缝黛色
  for (let X = 0; X < w; X++) {
    put(b, X, ground, 'd');
    put(b, X, ground + 1, 'g');
  }
  let gy = ground + 2;
  let rh = 5;
  let k = 0;
  while (gy < h) {
    const sw = rh * 5;
    let gx = -Math.floor(rnd() * sw);
    while (gx < w) {
      const ww = Math.round(sw * (0.7 + rnd() * 0.8));
      const near = (gy - ground) / Math.max(1, h - ground);
      const body = near < 0.18 ? 'g' : 'h';
      for (let j = 0; j < rh && gy + j < h; j++)
        for (let i = 0; i < ww; i++) {
          const X = gx + i;
          if (X < 0 || X >= w) continue;
          let ch = body;
          if (j === 0 || i === 0) ch = near < 0.18 ? 'd' : 'g';
          else if (j === 1) ch = near < 0.18 ? 'h' : 'i';
          put(b, X, gy + j, ch);
        }
      gx += ww;
    }
    gy += rh;
    rh = Math.round(rh * 1.45) + 1;
    k++;
  }
  return { b, arch: { cx: archX, ground, w: aw, top }, ground };
}

// ---------- 第 6 镜：关内的街 ----------

export interface Street {
  b: Bitmap;
  /** 窗里透出魂火的格子（位图坐标），调用方让它们明灭。 */
  lights: { x: number; y: number; w: number; h: number }[];
}

/**
 * 关内的一条街（回响兵列队的地方）：一排两层的木楼，黛瓦飞檐、乌木的柱与额枋，格子窗里透出天青的魂火；
 * 楼前是夯土的街面。w×h 铺满画布，eave：楼的檐口在第几行，ground：街面从第几行开始。
 */
export function makeStreet(w: number, h: number, eave: number, ground: number): Street {
  const b = blank(w, h);
  const rnd = mulberry32(131);
  const lights: Street['lights'] = [];
  let x = -Math.floor(rnd() * 40);
  while (x < w + 40) {
    const bw = 70 + Math.floor(rnd() * 50);
    const cx = x + bw / 2;
    const ey = eave + Math.floor((rnd() - 0.5) * 10);
    // 上层：一排格子窗
    for (let Y = ey + 1; Y < ground; Y++)
      for (let X = x + 3; X < x + bw - 3; X++) {
        const d = Y - ey;
        let ch = 'd';
        if (d === 1 || d === 14) ch = 'g'; // 额枋
        else if ((X - x - 3) % 16 === 0) ch = 'g'; // 柱
        put(b, X, Y, ch);
      }
    // 上层的窗（ey+3 … ey+12）
    for (let wx = x + 7; wx + 10 < x + bw - 4; wx += 16) {
      const lit = rnd() < 0.55;
      for (let j = 0; j < 9; j++)
        for (let i = 0; i < 10; i++) {
          const lattice = i % 3 === 0 || j % 3 === 0;
          put(b, wx + i, ey + 3 + j, lattice ? 'g' : lit ? 'n' : 'k');
        }
      if (lit) lights.push({ x: wx, y: ey + 3, w: 10, h: 9 });
    }
    // 下层的门脸（ey+16 … ground）：几扇板门（关着）
    for (let dx = x + 6; dx + 12 < x + bw - 4; dx += 16)
      for (let Y = ey + 18; Y < ground - 1; Y++) for (let i = 0; i < 12; i++) put(b, dx + i, Y, i === 0 || i === 11 || i === 6 ? 'g' : 'd');
    // 屋顶
    roof(b, cx, ey, bw / 2 + 4, 13, Math.round(bw * 0.18), { tile: 'g', dark: 'd', lit: 'h', ridge: 'h', gold: 'B' });
    x += bw + 2 + Math.floor(rnd() * 6);
  }
  // 街面：夯土，从楼脚往前慢慢亮一点；楼脚一道暗影
  for (let Y = ground; Y < h; Y++) {
    const u = (Y - ground) / Math.max(1, h - ground);
    for (let X = 0; X < w; X++) {
      let ch = u < 0.08 ? 'd' : u < 0.35 ? 'g' : 'h';
      const seam = u < 0.35 ? Math.abs(u - 0.08) * (h - ground) < 1.5 : Math.abs(u - 0.35) * (h - ground) < 2;
      if (seam && bayer(X, Y) < 0.5) ch = u < 0.2 ? 'g' : 'g';
      put(b, X, Y, ch);
    }
  }
  return { b, lights };
}
