// 封神台（开场第一镜）：云海之上的一座三层白玉台，侧面看过去。每层台面一线月白（从略高处望下去看得到一点台面）、
// 立面是缟色的玉，镶一道金线、隔一段一根倚柱；台沿上一排白玉栏杆（望柱 + 扶手）；正中一道大台阶从云里一直通到台顶；
// 台顶正中一方小坛，两角各一盏莲花灯。光从左上来：立面右端暗一档，台阶两边的垂带压暗。
// 底下一层的下半截埋在云里（近处的云堤另画，盖在台子前面）。金榜悬在台顶上方（另画）。
import { blank, put, rect, type Bitmap } from './common.ts';

export interface Altar {
  b: Bitmap;
  /** 台顶的中心（位图坐标）：金榜悬在这上面。 */
  top: { x: number; y: number };
  /** 两盏莲花灯的灯芯（位图坐标）：火苗另画（会跳）。 */
  lamps: { x: number; y: number }[];
}

interface Tier {
  w: number; // 立面宽
  face: number; // 立面高
  y: number; // 台面所在的行（立面从这里往下）
}

export function makeAltar(): Altar {
  const W = 240;
  const H = 82;
  const b = blank(W, H);
  const cx = W >> 1;
  const tiers: Tier[] = [
    { w: 100, face: 10, y: 22 },
    { w: 156, face: 12, y: 40 },
    { w: 220, face: 14, y: 60 },
  ];
  // 台阶：顶宽 20，往下放宽到 32
  const stairW = (y: number) => Math.round(20 + ((y - tiers[0].y) / (H - tiers[0].y)) * 12);

  // 1. 各层（从下往上画，上一层压住下一层的台面）
  for (let ti = tiers.length - 1; ti >= 0; ti--) {
    const t = tiers[ti];
    const x0 = cx - (t.w >> 1);
    const x1 = cx + (t.w >> 1) - 1;
    // 台面：三像素（靠后一像素缟、中间月白、台沿一像素月白高光）
    for (let x = x0 + 3; x <= x1 - 3; x++) {
      put(b, x, t.y - 2, 'j');
      put(b, x, t.y - 1, 'w');
      put(b, x, t.y, x > x1 - 8 ? 'w' : 'W');
    }
    // 立面
    for (let y = t.y + 1; y <= t.y + t.face; y++)
      for (let x = x0; x <= x1; x++) {
        const d = y - t.y;
        let ch = 'j';
        if (d === 1) ch = 'w'; // 台沿的亮边
        else if (d === 2) ch = 'i'; // 台沿下的一道阴影
        else if (d === 4) ch = 'y'; // 金线
        else if (d === 5) ch = 'b';
        else if (d >= t.face - 1) ch = d === t.face ? 'h' : 'i'; // 脚下压暗
        // 右端背光
        if (x > x1 - 5) ch = ch === 'j' ? 'i' : ch === 'w' ? 'j' : ch === 'y' ? 'b' : ch === 'i' ? 'h' : ch;
        if (x === x0) ch = d === 1 ? 'W' : 'w';
        if (x === x1) ch = 'g';
        put(b, x, y, ch);
      }
    // 倚柱：隔一段一根两像素的柱（左亮右暗），把立面分成一格一格的；格子中间一枚暗刻的小团花
    const half = stairW(t.y) >> 1;
    for (let x = x0 + 12; x < x1 - 8; x += 18) {
      if (Math.abs(x - cx) < half + 4) continue;
      for (let y = t.y + 6; y < t.y + t.face - 1; y++) {
        put(b, x, y, 'w');
        put(b, x + 1, y, 'i');
      }
      const mx = x + 9;
      const my = t.y + 6 + ((t.face - 7) >> 1);
      if (mx < x1 - 8 && Math.abs(mx - cx) > half + 5 && my < t.y + t.face - 1) {
        // 暗刻的小菱花：四个点围成一个菱形，中间留白
        put(b, mx - 1, my, 'i');
        put(b, mx + 1, my, 'i');
        put(b, mx, my - 1, 'i');
        put(b, mx, my + 1, 'i');
      }
    }
    // 栏杆：扶手一像素月白（右端缟）；栏板一行隔一像素镂空；望柱每 8 像素一根，柱头一粒月白
    const ry = t.y - 4;
    for (let x = x0 + 2; x <= x1 - 2; x++) {
      if (Math.abs(x - cx) < half + 1) continue;
      put(b, x, ry, x > x1 - 6 ? 'j' : 'w');
      put(b, x, ry + 1, x % 2 ? 'j' : 'i');
    }
    for (let x = x0 + 2; x <= x1 - 2; x += 8) {
      if (Math.abs(x - cx) < half + 2) continue;
      put(b, x, ry - 2, 'W');
      put(b, x, ry - 1, 'w');
      put(b, x + 1, ry - 1, 'j');
      put(b, x, ry + 1, 'w');
      put(b, x + 1, ry + 1, 'i');
    }
  }
  // 2. 台阶：踏面月白、踢面缟，越往下越宽；两侧垂带（左亮右暗），带上一道扶手
  for (let y = tiers[0].y - 2; y < H; y++) {
    const w = stairW(y);
    const x0 = cx - (w >> 1);
    const x1 = cx + (w >> 1) - 1;
    const step = (y - tiers[0].y + 30) % 2 === 0;
    for (let x = x0 + 2; x <= x1 - 2; x++) put(b, x, y, step ? 'w' : 'j');
    put(b, x0, y, 'w');
    put(b, x0 + 1, y, 'j');
    put(b, x1 - 1, y, 'i');
    put(b, x1, y, 'h');
  }
  // 台阶正中的御路（斜坡石上的云纹）：缟底，一道道斜着的银鼠云头
  for (let y = tiers[0].y; y < H; y++) {
    const w = 6 + Math.round(((y - tiers[0].y) / (H - tiers[0].y)) * 4);
    for (let x = cx - (w >> 1); x < cx + (w >> 1); x++) {
      const k = (((x - cx + Math.round(Math.sin(y * 0.5) * 2) + 40) % 5) + 5) % 5;
      put(b, x, y, k === 0 ? 'i' : 'j');
    }
  }
  // 3. 台顶正中的小坛：两层的方台（月白顶、缟身、金边），正对台阶
  const ay = tiers[0].y - 3;
  rect(b, cx - 15, ay - 6, 30, 1, 'w');
  rect(b, cx - 15, ay - 5, 30, 1, 'y');
  rect(b, cx - 14, ay - 4, 28, 4, 'j');
  rect(b, cx + 10, ay - 4, 4, 4, 'i');
  rect(b, cx - 11, ay - 9, 22, 1, 'W');
  rect(b, cx - 11, ay - 8, 22, 2, 'w');
  rect(b, cx + 8, ay - 8, 3, 2, 'j');
  for (let x = cx - 12; x <= cx + 11; x += 6) put(b, x, ay - 2, 'b');
  // 4. 两角的莲花灯：灯座月白、灯盘一圈桃红的莲瓣（火苗另画）
  const lamps: { x: number; y: number }[] = [];
  for (const side of [-1, 1]) {
    const lx = cx + side * 40;
    const ly = tiers[0].y - 5;
    rect(b, lx - 1, ly, 3, 4, 'w');
    put(b, lx + 1, ly + 1, 'j');
    put(b, lx + 1, ly + 2, 'j');
    rect(b, lx - 2, ly + 3, 5, 1, 'j');
    // 莲瓣
    put(b, lx - 3, ly - 2, 'm');
    put(b, lx - 2, ly - 1, 'm');
    put(b, lx - 1, ly - 1, 'p');
    put(b, lx, ly - 1, 'm');
    put(b, lx + 1, ly - 1, 'p');
    put(b, lx + 2, ly - 1, 'm');
    put(b, lx + 3, ly - 2, 'm');
    put(b, lx - 1, ly - 2, 'm');
    put(b, lx + 1, ly - 2, 'm');
    lamps.push({ x: lx, y: ly - 3 });
  }
  // 5. 外描边：只描在空处，用暗一档的苍（不用纯黑）——白玉台在浅色的天上要靠这一圈读出形状
  const out = blank(W, H);
  out.data.set(b.data);
  const has = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && b.data[(y * W + x) * 4 + 3] > 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (has(x, y)) continue;
      if (has(x, y - 1) || has(x - 1, y) || has(x + 1, y) || has(x, y + 1)) put(out, x, y, has(x + 1, y) || has(x, y + 1) ? 'i' : 'h');
    }
  return { b: out, top: { x: cx, y: ay - 9 }, lamps };
}

/**
 * 回响仙台的边（收尾那一镜，侧面看）：青白玉的台面往远处铺开（从略高处看下去，台面是几行越远越窄的玉砖，
 * 隔几块一道嵌金线），台沿一道月白的亮边，立面缟色、镶金线、脚下压暗，再往下收进云里。w 宽，返回位图和台面所在的行。
 */
export function makeTerraceEdge(w: number): { b: Bitmap; top: number; lip: number } {
  const lip = 40; // 台沿那一行
  const H = lip + 26;
  const b = blank(w, H);
  const top = 0;
  // 台面：从远（上）到近（下）一行行玉砖，越近越高、砖越宽（透视）；砖缝只暗半档、断断续续（磨平的旧缝）
  let y = top;
  let rh = 2;
  let row = 0;
  while (y < lip) {
    const seg = 18 + row * 10;
    const off = (row * 11) % seg;
    for (let j = 0; j < rh && y + j < lip; j++)
      for (let x = 0; x < w; x++) {
        let ch = row % 2 ? 'z' : 'w';
        if (j === 0 && (x + row * 3) % 7 !== 0) ch = 'j'; // 横缝
        else if ((x + off) % seg === 0 && j > 0) ch = 'j'; // 竖缝
        if (row === 4 && j === Math.floor(rh / 2)) ch = 'y'; // 一道嵌金线
        if (row === 4 && j === Math.floor(rh / 2) + 1) ch = 'b';
        put(b, x, y + j, ch);
      }
    y += rh;
    rh = Math.min(8, rh + 1);
    row++;
  }
  // 台沿与立面
  for (let x = 0; x < w; x++) {
    put(b, x, lip, 'W');
    put(b, x, lip + 1, 'w');
    for (let yy = lip + 2; yy < H; yy++) {
      const d = yy - lip;
      let ch = 'j';
      if (d === 2) ch = 'i';
      else if (d === 5) ch = 'y';
      else if (d === 6) ch = 'b';
      else if (d > 14) ch = d > 20 ? 'h' : 'i';
      put(b, x, yy, ch);
    }
  }
  // 立面上隔一段一枚暗刻的团花（菱形四点）
  for (let x = 16; x < w - 4; x += 36) {
    const yy = lip + 11;
    put(b, x, yy - 1, 'i');
    put(b, x - 1, yy, 'i');
    put(b, x + 1, yy, 'i');
    put(b, x, yy + 1, 'i');
  }
  return { b, top, lip };
}
