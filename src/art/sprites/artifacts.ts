// 剩下 8 件公共法宝（打神鞭、化血神刀、定风珠、青莲宝色旗、阴阳镜、玄元控水旗、五火七禽扇、捆仙绳）用的像素精灵。
// 全部是字符网格（调色板见 ../palette.ts），纯函数、不依赖 DOM：游戏里转成纹理，Node 里也能直接出 PNG 自查。
// 会动、会变形的东西（鞭身、血光、旋风、光束、火浪、金绳）在 src/game/fx-new.ts 里每帧逐像素画，这里只放成形的小精灵
// 和按半径缓存的地面贴图（水域、藤环、莲纹、焦土）。
// 用户口径：不画俗气的发光圆圈；地面上的东西要有形状（莲瓣、藤蔓、水纹），不要硬直线边界、不要大面积随机像素。
import { compose, flipX, grid, outline, type Grid } from '../pixel.ts';
import { hash, lined, lotusFrames, puffFrames, Px, recolor, rotSprite } from './fx.ts';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- 画法小工具

/** 实心椭圆（可转角度）。 */
function ellipse(p: Px, cx: number, cy: number, rx: number, ry: number, rot: number, color: (u: number, v: number) => string | null) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const R = Math.ceil(Math.max(rx, ry)) + 1;
  for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++)
    for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const u = (dx * c + dy * s) / rx; // 沿长轴
      const v = (-dx * s + dy * c) / ry; // 沿短轴（正 = 下）
      if (u * u + v * v > 1) continue;
      const ch = color(u, v);
      if (ch) p.set(x, y, ch);
    }
}

/** 一笔由粗到细的线（沿折线 pts，宽度 w0 → w1），颜色按沿线的位置 t 和离中线的距离 d（0..1）挑。 */
function taper(p: Px, pts: [number, number][], w0: number, w1: number, color: (t: number, d: number) => string | null) {
  let total = 0;
  const segs: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    segs.push(l);
    total += l;
  }
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const l = segs[i] || 1e-6;
    const steps = Math.max(1, Math.ceil(l * 3));
    for (let k = 0; k <= steps; k++) {
      const f = k / steps;
      const t = (acc + l * f) / (total || 1);
      const w = w0 + (w1 - w0) * t;
      const x = x0 + (x1 - x0) * f;
      const y = y0 + (y1 - y0) * f;
      const R = Math.ceil(w / 2) + 1;
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
          const d = Math.hypot(dx, dy) / Math.max(0.35, w / 2);
          if (d > 1) continue;
          const ch = color(t, d);
          if (ch) p.set(Math.round(x + dx), Math.round(y + dy), ch);
        }
    }
    acc += l;
  }
}

// ---------------------------------------------------------------- 打神鞭：符纸

/**
 * 祥云（打神鞭的鞭根藏在里面）：扁长的一朵 —— 上沿是几团起伏的云朵，左右两头各卷成一个如意云头
 * （云头的边顺势往里卷进去一圈，卷纹和外轮廓是同一道线），底边平、收成一道浅色的云脚，右边拖一条云尾。
 * 不发光，靠云身的明暗和卷纹认出来。tone：white 月白云身、琥珀描边（凡、灵）；gold 缃黄云身、灵光白高光、赭边（仙品「打神」起）；
 * seal 月白云身、朱砂卷纹（神品「封神」）。n 帧一个循环：云朵微微起伏、卷纹慢慢转一点。
 * W：宽（默认 36；高按 36×15 的比例取整）。云朵、云头按比例缩，云脚、背光那一两像素的带子不缩（小了也还是一道一道的像素）。
 * 打神鞭用 28 宽（XIANGYUN_SMALL）：36 宽比两个人还宽（用户 2026-11-10：法宝不能画得过大）。
 */
export const XIANGYUN_W = 36;
export const XIANGYUN_H = 15;
export const XIANGYUN_SMALL = 28;
export function xiangyunFrames(tone: 'white' | 'gold' | 'seal', n = 4, W = XIANGYUN_W): Grid[] {
  const k = W / XIANGYUN_W;
  const H = Math.round(XIANGYUN_H * k);
  const C =
    tone === 'gold'
      ? { hi: 'f', body: 'Y', shade: 'y', foot: 'b', curl: 'B', edge: 'B' }
      : tone === 'seal'
        ? { hi: 'W', body: 'w', shade: 'j', foot: 'i', curl: 'e', edge: 'b' }
        : { hi: 'W', body: 'w', shade: 'j', foot: 'i', curl: 'b', edge: 'b' };
  // 云朵：[圆心 x, 圆心 y, 半径]。头两团是如意云头（边往里卷），其余是上沿的云朵和底下的云身
  const heads: [number, number, number, number][] = (
    [
      [7, 8, 5, 1], // 左云头，逆时针往里卷
      [24.5, 6.5, 5.2, -1], // 右云头，顺时针往里卷
    ] as [number, number, number, number][]
  ).map(([x, y, r, d]) => [x * k, y * k, r * k, d]);
  const puffs: [number, number, number][] = (
    [
      [13, 6.2, 4.2],
      [17.5, 5, 4.6],
      [16, 9.4, 5.2],
      [29.5, 10.2, 2.6], // 云尾
      [32.5, 11, 1.8],
    ] as [number, number, number][]
  ).map(([x, y, r]) => [x * k, y * k, Math.max(1.2, r * k)]);
  const out: Grid[] = [];
  for (let f = 0; f < n; f++) {
    const ph = (f / n) * TAU;
    const p = new Px(W, H);
    const base = H - 2.3 * k; // 云脚：底边平
    const all: [number, number, number][] = [...heads.map(([x, y, r]) => [x, y, r] as [number, number, number]), ...puffs];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const py = y + 0.5;
        if (py > base + 0.8) continue;
        let best = -1;
        let bestK = 9;
        all.forEach(([cx, cy, r], i) => {
          const rr = r + 0.28 * k * Math.sin(ph + i * 1.7);
          const q = Math.hypot(x + 0.5 - cx, (py - cy) * 1.08) / rr;
          if (q <= 1 && q < bestK) {
            bestK = q;
            best = i;
          }
        });
        if (best < 0) continue;
        const [cx, cy] = all[best];
        // 受光在左上：每一团左上亮、右下暗；贴着云脚的两行压暗
        const lit = (-(x + 0.5 - cx) * 0.55 - (py - cy)) / k;
        const ch = py > base - 0.6 ? C.foot : py > base - 2 ? C.shade : lit > 1.8 && bestK < 0.85 ? C.hi : lit < -2.2 ? C.shade : C.body;
        p.set(x, y, ch);
      }
    // 如意卷纹：从云头的外沿顺势往里卷一圈多（和外轮廓接成一道线）
    for (const [cx, cy, R, dir] of heads) {
      const a0 = dir > 0 ? Math.PI * 0.95 : Math.PI * 0.05; // 从外侧（左云头的左边、右云头的右边）起卷
      const turns = 1.25 * TAU;
      for (let th = 0; th <= turns; th += 0.05) {
        const r = R - 0.4 - (R - 1.3) * (th / turns);
        const a = a0 + dir * (th + ph * 0.06);
        p.set(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.92, C.curl);
      }
      p.set(cx, cy, C.curl);
    }
    out.push(outline(p.grid(), C.edge, { [C.foot]: C.edge }));
  }
  return out;
}

/**
 * 一张黄符（打神鞭仙品「打神」镇住精英时贴在它身上；神品「封神」抽散的敌人化成一张往天上飞的封神符）：
 * 藤黄符纸、朱砂边框、顶上一道朱砂横批，下摆两道流苏。字由表现层用像素体另外写上去（镇 / 封）。
 */
export const TALISMAN_W = 15;
export const TALISMAN_H = 21;
export function talisman(): Grid {
  const W = TALISMAN_W;
  const H = TALISMAN_H;
  const p = new Px(W, H);
  for (let y = 0; y < H - 2; y++)
    for (let x = 0; x < W; x++) {
      const edge = x === 0 || x === W - 1 || y === 0 || y === H - 3;
      p.set(x, y, edge ? 'b' : x >= W - 3 ? 'y' : 'Y');
    }
  // 朱砂边框（内缩一格）与横批
  for (let x = 2; x < W - 2; x++) {
    p.set(x, 2, 'e');
    p.set(x, 3, 'r');
    p.set(x, H - 5, 'e');
  }
  for (let y = 2; y < H - 4; y++) {
    p.set(2, y, 'e');
    p.set(W - 3, y, 'e');
  }
  // 流苏
  for (const x of [4, W - 5]) {
    p.set(x, H - 2, 'e');
    p.set(x, H - 1, 'r');
  }
  return outline(p.grid(), 'k', { b: 'B', Y: 'B', y: 'B', e: 'R', r: 'R' });
}

// ---------------------------------------------------------------- 化血神刀

/** 化血神刀（朝右，18×5）：黑檀刀柄缠红、金吞口，刀身乌钢、刃口一道血光（越往刀尖越亮）。 */
export const BLOOD_BLADE: Grid = grid([
  '.....y.....RRRr...',
  'eR.bBYyRRrrreeeo..',
  'eRbbBfrreeeoooYfWW',
  'r..bBYydddddddWj..',
  '.....b............',
]);
export const BLOOD_BLADE_TIP = { x: 17.5, y: 2.5 };
export const BLOOD_BLADE_SEL: Record<string, string> = { e: 'R', r: 'R', o: 'R', y: 'B', Y: 'B', f: 'B', b: 'B', W: 'R', d: 'k', j: 'h' };

/** 刀口：被血光斩中的一道斜斜的血痕（三帧：划开、最亮、收细）。 */
export const BLOOD_CUT: Grid[] = [
  lined(grid(['....o', '...e.', '..e..', '.....', '.....']), 'R'),
  lined(grid(['.....W', '....oe', '...oe.', '..oe..', '.oe...', 'e.....']), 'R', { W: 'R', o: 'R', e: 'R' }),
  lined(grid(['.....', '.....', '..r..', '.r...', 'r....']), 'R'),
];

/** 血雾：一团团殷红的雾（把烟团换成血色：亮处朱砂、身子朱、暗处殷、底边紫棠）。 */
export function bloodPuffFrames(r: number, seed = 1): Grid[] {
  return puffFrames(r, 6, 'smoke', seed).map((g) => recolor(g, { i: 'e', h: 'r', g: 'R', d: 'P' }));
}

/** 噬魂的血魂：一小团往人身上飘的血色魂火（四帧摇曳：头圆尾尖，芯亮），描殷红边。 */
export const SOUL_WISP: Grid[] = [
  ['.o.', 'oWo', 'eoe', '.e.', '.r.'],
  ['.o.', 'oWo', 'eoe', '.er', '..r'],
  ['.o.', 'oWo', 'eoe', '.e.', '.r.'],
  ['.o.', 'oWo', 'eoe', 're.', 'r..'],
].map((rows) => lined(grid(rows), 'R', { o: 'R', W: 'R', e: 'R', r: 'R' }));

// ---------------------------------------------------------------- 定风珠

/**
 * 定风珠（7×7）：一颗淡青玉色的珠子，里面一缕风纹在转（四帧）。描墨绿边，高光在左上。
 * 不加光晕：靠珠子本身的明暗和里面转的风纹认出来。
 */
export const PEARL: Grid[] = [0, 1, 2, 3].map((f) => {
  const p = new Px(7, 7);
  const c = 3;
  for (let y = 0; y < 7; y++)
    for (let x = 0; x < 7; x++) {
      const d = Math.hypot(x - c, y - c);
      if (d > 3.3) continue;
      const lit = -(x - c) - (y - c); // 左上亮
      p.set(x, y, d > 2.6 ? (lit > 0 ? 'L' : 'l') : lit > 2 ? 'w' : lit > -1 ? 'L' : 'l');
    }
  // 风纹：珠子里一道绕着转的弧
  for (let k = 0; k < 5; k++) {
    const a = (f / 4) * TAU + k * 0.55;
    const r = 1 + k * 0.32;
    p.set(Math.round(c + Math.cos(a) * r), Math.round(c + Math.sin(a) * r * 0.8), k < 2 ? 'W' : 'w');
  }
  p.set(2, 1, 'W');
  return outline(p.grid(), 'G', { L: 'v', l: 'G', w: 'v', W: 'v' });
});

/** 卷在风里的叶子：一片小叶转八个角度（RotSprite），描墨绿边。 */
const LEAF_BASE = grid(['.L.', 'Llv', 'lv.', 'v..']);
export const LEAVES: Grid[] = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => lined(rotSprite(LEAF_BASE, (i / 8) * TAU, 1.5, 2).g, 'G', { L: 'v', l: 'G', v: 'G' }));

/**
 * 定海：定身的敌人脚下一枚云头风纹（像一枚盖在地上的印，3/4 俯视压扁）：两朵卷云头背对着、中间一道风线连着，
 * 天青的纹、月白的高光，描黛蓝边。
 */
export const CALM_SEAL: Grid = lined(
  grid([
    '..CCCC.........CCCC..',
    '.C....C.......C....C.',
    'C..WW..C.....C..WW..C',
    'C.C..C.CCCCCCC.C..C.C',
    'C..CC.........C.CC..C',
    '.C......wwwww......C.',
    '..CCCCCC.....CCCCCC..',
  ]),
  'n',
  { C: 'n', W: 'n', w: 'n' },
);

// ---------------------------------------------------------------- 青莲宝色旗

/** 青莲：把金莲（lotusFrames）换成青色 —— 天青的瓣、月白的瓣尖、石青与黛蓝的暗面。 */
export function azureLotusFrames(n = 8, big = false): Grid[] {
  return lotusFrames(n, big).map((g) => recolor(g, { Y: 'C', f: 'w', y: 'c', b: 'n', B: 'N', W: 'W', k: 'N' }));
}

/**
 * 结界外沿的小青莲（开放的几帧：花苞 → 半开 → 全开）。3/4 俯视：中间一瓣立起，两侧瓣往外摊，莲心一点缃黄。
 */
export const LOTUS_BUD: Grid[] = [
  ['..w..', '.wCw.', '.cCc.', '..n..'],
  ['...w...', '.w.C.w.', '.CwCwC.', '..cCc..', '...n...'],
  ['....w....', '.w..C..w.', '.Cw.C.wC.', '..CwYwC..', '...cCc...', '....n....'],
  ['....w....', 'w..wCw..w', 'CwwCCCwwC', '.cCCYCCc.', '..ccncc..', '....n....'],
].map((rows) => lined(grid(rows), 'N', { w: 'n', C: 'n', c: 'N', n: 'N', Y: 'n' }));

/** 荆棘：一根带刺的青藤从地里刺出来（五帧：冒头 → 刺到最高），red 是器灵「荆棘」的朱砂刺尖。 */
export function thornFrames(red: boolean, h = 13): Grid[] {
  const out: Grid[] = [];
  for (let k = 1; k <= 5; k++) {
    const len = Math.round((h * k) / 5);
    const p = new Px(7, h + 1);
    for (let i = 0; i < len; i++) {
      const y = h - i;
      const x = 3 + Math.round(Math.sin(i * 0.5) * 0.8 * (i / h));
      const top = i >= len - 2;
      p.set(x, y, top ? (red ? 'e' : 'L') : i % 3 === 0 ? 'l' : 'v');
      if (i < len - 3) p.set(x + 1, y, 'G');
      // 刺：每三格往两侧交替伸出一根
      if (i > 1 && i % 3 === 1 && i < len - 1) {
        const s = (i / 3) % 2 < 1 ? -1 : 1;
        p.set(x + s, y - 1, red ? 'r' : 'L');
        p.set(x + s * 2, y - 2, red ? 'e' : 'j');
      }
    }
    out.push(outline(p.grid(), 'G', { v: 'G', l: 'G', L: 'v', j: 'h', e: 'R', r: 'R' }));
  }
  return out;
}

/**
 * 结界外沿的荆棘藤环（3/4 俯视的椭圆，纵向压成 0.62）：两股青藤绞在一起绕一圈，隔一段伸出一根刺、长一片叶子，
 * 沿圈还有起伏，不是一个规整的圆。返回「长出来」的几帧（从后方两头往前合拢）。style：thorn 是器灵「荆棘」（藤更粗、刺带朱砂尖、刺更密）。
 */
export function vineRingFrames(r: number, seed: number, style: 'plain' | 'leafy' | 'thorn', n = 6): Grid[] {
  const S = Math.ceil(r * 2) + 12;
  const SH = Math.ceil(r * 2 * 0.62) + 14;
  const cx = (S - 1) / 2;
  const cy = (SH - 1) / 2 + 1;
  const pts: { x: number; y: number; t: number; ch: string; prio: number }[] = [];
  const thick = style === 'thorn';
  const steps = Math.round(TAU * r * 1.4);
  const wob = (a: number) => 1 + 0.035 * Math.sin(5 * a + seed) + 0.025 * Math.sin(3 * a + seed * 2.1);
  const at = (a: number, off: number): [number, number] => {
    const R = r * wob(a) + off;
    return [cx + Math.cos(a) * R, cy + Math.sin(a) * R * 0.62];
  };
  // 从正后方（-π/2）起，两头往前长：t = 离后方的角度 / π
  const tOf = (a: number) => {
    let d = Math.abs(((a + Math.PI / 2 + Math.PI) % TAU + TAU) % TAU - Math.PI);
    return d / Math.PI;
  };
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * TAU;
    const t = tOf(a);
    const tw = Math.sin(a * 9 + seed) * (thick ? 1.6 : 1.2);
    // 两股藤：互相绕着走
    const [x1, y1] = at(a, tw);
    const [x2, y2] = at(a, -tw);
    const front = Math.sin(a) > 0; // 前半圈（离镜头近）亮一些
    pts.push({ x: x1, y: y1, t, ch: Math.cos(a * 9 + seed) > 0 ? (front ? 'l' : 'v') : 'v', prio: 2 });
    pts.push({ x: x2, y: y2, t, ch: Math.cos(a * 9 + seed) > 0 ? 'v' : front ? 'l' : 'v', prio: 2 });
    if (thick) {
      const [x3, y3] = at(a, tw + (tw > 0 ? 1 : -1));
      pts.push({ x: x3, y: y3, t, ch: 'G', prio: 1 });
    }
  }
  // 刺：沿圈每隔一段伸出一根（往外、往里交替）
  const thornEvery = thick ? 7 : 10;
  const nThorn = Math.round((TAU * r) / thornEvery);
  for (let k = 0; k < nThorn; k++) {
    const a = (k / nThorn) * TAU + hash(seed, k) * 0.2;
    const t = tOf(a);
    const out = k % 2 === 0 ? 1 : -1;
    const len = thick ? 3 : 2;
    for (let j = 1; j <= len; j++) {
      const [x, y] = at(a + 0.012 * j, out * (1.5 + j));
      const tip = j === len;
      pts.push({ x, y, t: t + 0.02, ch: tip ? (thick ? 'e' : 'L') : thick ? 'r' : 'v', prio: 3 });
    }
  }
  // 叶子：隔一段长一片（leafy / thorn 多一些）
  const nLeaf = style === 'plain' ? 6 : 10;
  for (let k = 0; k < nLeaf; k++) {
    const a = ((k + 0.5) / nLeaf) * TAU + hash(seed, k, 3) * 0.3;
    const t = tOf(a);
    const [lx, ly] = at(a, 2.5);
    const side = hash(seed, k, 5) < 0.5 ? -1 : 1;
    const leaf: [number, number, string][] = [
      [0, 0, 'l'],
      [side, -1, 'L'],
      [side * 2, -1, 'l'],
      [side * 2, -2, 'L'],
      [side, 0, 'v'],
    ];
    for (const [dx, dy, ch] of leaf) pts.push({ x: lx + dx, y: ly + dy, t: t + 0.04, ch, prio: 4 });
  }
  const out: Grid[] = [];
  for (let f = 1; f <= n; f++) {
    const lim = f / n + 0.001;
    const p = new Px(S, SH);
    const prio = new Map<number, number>();
    for (const q of pts) {
      if (q.t > lim) continue;
      const k = Math.round(q.y) * S + Math.round(q.x);
      if ((prio.get(k) ?? 0) > q.prio) continue;
      prio.set(k, q.prio);
      p.set(q.x, q.y, q.ch);
    }
    out.push(outline(p.grid(), 'G', { l: 'G', v: 'G', L: 'G', e: 'R', r: 'R' }));
  }
  return out;
}

/**
 * 结界里的莲纹：地上浮现一朵大青莲 —— petals 片尖瓣从人脚下辐射出去（瓣身天青、往瓣尖渐亮成月白，根部石青，
 * 一道瓣脉，描黛蓝边）；layers = 2 时花瓣之间再垫一层短一些、暗一些的瓣。俯视压成 0.62。
 * 精灵整体半透明地叠在地上：看得出是一朵莲花，人和敌人站在上面也看得清。
 */
export function lotusMandala(r: number, petals: number, layers: number, seed = 1): Grid {
  const S = Math.ceil(r * 2) + 6;
  const SH = Math.ceil(r * 2 * 0.62) + 8;
  const cx = (S - 1) / 2;
  const cy = (SH - 1) / 2;
  const p = new Px(S, SH);
  const a0 = -Math.PI / 2 + hash(seed, 1) * 0.2;
  // 一片瓣在 (角度差 da、半径 rr) 处是不是在瓣里，返回沿瓣的位置 u（0 根 … 1 尖），不在返回 -1
  const inPetal = (da: number, rr: number, r0: number, r1: number, half: number) => {
    const u = (rr - r0) / (r1 - r0);
    if (u < 0 || u > 1) return -1;
    const w = half * Math.sin(Math.PI * Math.min(1, u ** 0.8 * 1.02)) ** 0.65;
    return Math.abs(da) <= w ? u : -1;
  };
  const layersSpec = [
    ...(layers > 1 ? [{ off: 0.5, r0: r * 0.1, r1: r * 0.66, half: (Math.PI / petals) * 0.8, back: true }] : []),
    { off: 0, r0: r * 0.08, r1: r * 0.9, half: (Math.PI / petals) * 0.92, back: false },
  ];
  const owner = new Int8Array(S * SH).fill(-1); // 每个像素属于哪一层（outline 用）
  for (let y = 0; y < SH; y++)
    for (let x = 0; x < S; x++) {
      const dx = x - cx;
      const dy = (y - cy) / 0.62;
      const rr = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);
      layersSpec.forEach((L, li) => {
        for (let i = 0; i < petals; i++) {
          const c = a0 + ((i + L.off) / petals) * Math.PI * 2;
          let da = ang - c;
          da = Math.atan2(Math.sin(da), Math.cos(da));
          const u = inPetal(da, rr, L.r0, L.r1, L.half);
          if (u < 0) continue;
          const vein = Math.abs(da) < 0.045 * (1 - u) + 0.01 && u > 0.18 && u < 0.78;
          const ch = L.back ? (u > 0.8 ? 'C' : u > 0.4 ? 'c' : 'n') : vein ? 'c' : u > 0.84 ? 'w' : u > 0.62 ? 'C' : u > 0.3 ? 'C' : 'c';
          p.set(x, y, ch);
          owner[y * S + x] = li;
        }
      });
    }
  return outline(p.grid(), 'n', { w: 'n', C: 'n', c: 'n', n: 'N' });
}

/** 回血的灵光：一粒往人身上飘的青白灵光（两帧明灭）。 */
export const LOTUS_MOTE: Grid[] = [grid(['.L.', 'LWL', '.L.']), grid(['W'])];

/** 步步生莲：脚下开出的一朵小青莲（四帧：冒出 → 开 → 开足 → 散），不描黑边。 */
export const STEP_LOTUS: Grid[] = [grid(['.C.', 'cCc']), grid(['w.C.w', '.cCc.', '..n..']), grid(['.w.C.w.', 'Cw.C.wC', '.cCYCc.', '..cnc..']), grid(['.w...w.', 'C..C..C', '.c.Y.c.', '..c.c..'])];

// ---------------------------------------------------------------- 阴阳镜

/**
 * 阴阳镜（9×10）：一面圆铜镜，金色镜缘、下面一缕朱红穗子。阳面是亮白的镜光，阴面是玄青的镜面（一点天青反光）。
 */
const mirror = (face: 'yang' | 'yin') => {
  const p = new Px(9, 10);
  const c = 4;
  for (let y = 0; y < 9; y++)
    for (let x = 0; x < 9; x++) {
      const d = Math.hypot(x - c, y - c);
      if (d > 4.3) continue;
      const lit = -(x - c) - (y - c);
      if (d > 3.3) p.set(x, y, lit > 1 ? 'Y' : lit > -2 ? 'y' : 'b');
      else if (face === 'yang') p.set(x, y, lit > 2 ? 'W' : lit > -2 ? 'w' : 'j');
      else p.set(x, y, lit > 3 ? 'C' : lit > 0 ? 'n' : 'N');
    }
  p.set(4, 9, 'e');
  return outline(p.grid(), 'k', { Y: 'B', y: 'B', b: 'B', e: 'R' });
};
export const MIRROR = { yang: mirror('yang'), yin: mirror('yin') };

/** 太极：两道光都照到、被冻住的敌人头顶转着的一枚小太极（八帧转一圈），阴半玄青、阳半月白。 */
export const TAIJI: Grid[] = [0, 1, 2, 3, 4, 5, 6, 7].map((f) => {
  const p = new Px(9, 9);
  const c = 4;
  const rot = (f / 8) * TAU;
  for (let y = 0; y < 9; y++)
    for (let x = 0; x < 9; x++) {
      const dx = x - c;
      const dy = y - c;
      const d = Math.hypot(dx, dy);
      if (d > 4.2) continue;
      // 转到太极自己的坐标系
      const u = dx * Math.cos(rot) + dy * Math.sin(rot);
      const v = -dx * Math.sin(rot) + dy * Math.cos(rot);
      let yin = v > 0;
      if (Math.hypot(u - 2, v) < 2) yin = true;
      if (Math.hypot(u + 2, v) < 2) yin = false;
      if (Math.hypot(u - 2, v) < 0.8) yin = false;
      if (Math.hypot(u + 2, v) < 0.8) yin = true;
      p.set(x, y, yin ? 'n' : 'w');
    }
  return outline(p.grid(), 'k', { n: 'N', w: 'h' });
});

// ---------------------------------------------------------------- 玄元控水旗

export const WFLAG_W = 17;
export const WFLAG_H = 28; // 连旗杆不高于约 30 像素（人物 16×24，法宝别画得比人大太多）
export const WFLAG_FOOT = { x: 1, y: WFLAG_H - 1 };
/**
 * 玄元控水旗（插在水边，旗杆在左、旗面向右飘）：银枪头、黛蓝旗杆，玄青旗面上一道道月白的浪纹，旗心一个坎卦 ☵，
 * 天青镶边、末端燕尾。n 帧一个循环（浪峰亮、浪谷暗）。
 */
export function waterFlagFrames(n = 8): Grid[] {
  const out: Grid[] = [];
  const CW = 14;
  const CH = 10;
  const top = 3;
  for (let f = 0; f < n; f++) {
    const p = new Px(WFLAG_W, WFLAG_H);
    const ph = (f / n) * TAU;
    for (let y = 2; y < WFLAG_H; y++) p.set(1, y, y % 6 === 2 ? 'c' : 'n');
    p.set(1, 0, 'W');
    p.set(1, 1, 'j');
    p.set(0, 2, 'i');
    p.set(2, 2, 'i');
    const dy = (i: number) => Math.sin(ph - i * 0.55) * 1.5 * Math.min(1, (i + 1) / 5);
    for (let i = 0; i < CW; i++) {
      const x = 2 + i;
      const off = dy(i);
      const slope = dy(i + 1) - dy(i - 1);
      const y0 = Math.round(top + off);
      const tail = i >= CW - 3;
      const y1 = Math.round(top + CH - 1 + off - (tail ? (i - (CW - 4)) * 0.6 : 0));
      for (let y = y0; y <= y1; y++) {
        if (tail && Math.abs(y - (y0 + y1) / 2) < (i - (CW - 4)) * 0.9) continue;
        const edge = y === y0 || y === y1;
        // 浪纹：旗面上斜着的几道月白波线
        const wave = (y - y0 + Math.round(Math.sin(i * 0.9 + ph) * 1.2)) % 4 === 3 && !edge;
        const ch = edge ? 'C' : wave ? (slope < -0.4 ? 'w' : 'C') : slope < -0.5 ? 'n' : slope > 0.6 ? 'N' : 'N';
        p.set(x, y, ch);
      }
    }
    // 坎卦 ☵：断、连、断（随旗面起伏）
    const mx = 2 + 4;
    const mo = Math.round(dy(4));
    for (let r = 0; r < 3; r++)
      for (let dx = 0; dx < 5; dx++) {
        if (r !== 1 && dx === 2) continue;
        p.set(mx + dx, top + 2 + r * 2 + mo, 'W');
      }
    out.push(outline(p.grid(), 'k', { N: 'k', n: 'k', C: 'N', w: 'N', W: 'N', c: 'k', i: 'h', j: 'h' }));
  }
  return out;
}

/** 水域的轮廓：椭圆（纵向压成 0.62）加起伏的岸线，ph 让岸线慢慢波动。岸线最远到 r（判定半径），不往外凸出判定范围。 */
function shore(a: number, seed: number, ph: number) {
  return 0.895 + 0.05 * Math.sin(3 * a + seed) + 0.035 * Math.sin(5 * a + seed * 1.7 + ph) + 0.02 * Math.sin(9 * a + ph * 2);
}

/**
 * 水域的底（一张，精灵 alpha 半透明叠在地上）：越往中间越深（天青 → 石青 → 黛蓝），岸边一圈浅水。
 * deep 是器灵「寒潭」：整片更深（黛蓝 → 靛）。
 */
export function poolBody(r: number, seed: number, deep: boolean): Grid {
  const S = Math.ceil(r * 2.2) + 4;
  const SH = Math.ceil(r * 2.2 * 0.62) + 4;
  const cx = (S - 1) / 2;
  const cy = (SH - 1) / 2;
  const p = new Px(S, SH);
  for (let y = 0; y < SH; y++)
    for (let x = 0; x < S; x++) {
      const dx = x - cx;
      const dy = (y - cy) / 0.62;
      const d = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const R = r * shore(a, seed, 0);
      if (d > R) continue;
      const k = d / R;
      p.set(x, y, deep ? (k > 0.82 ? 'c' : k > 0.45 ? 'n' : 'N') : k > 0.84 ? 'C' : k > 0.5 ? 'c' : 'n');
    }
  return p.grid();
}

/**
 * 水面的纹（一组循环帧，叠在水底上面、不透明）：岸边一圈断断续续的白浪花（沿岸慢慢移动），
 * 水里两三道往外扩开的断弧水纹，几点闪动的水光。都是断开的短线，不是一个圆圈。
 */
export function poolFrames(r: number, seed: number, deep: boolean, n = 8): Grid[] {
  const S = Math.ceil(r * 2.2) + 4;
  const SH = Math.ceil(r * 2.2 * 0.62) + 4;
  const cx = (S - 1) / 2;
  const cy = (SH - 1) / 2;
  const out: Grid[] = [];
  const steps = Math.round(TAU * r * 1.3);
  for (let f = 0; f < n; f++) {
    const p = new Px(S, SH);
    const ph = (f / n) * TAU;
    // 岸边浪花：沿岸线一圈，按相位断开成一段一段（浪花在动）
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * TAU;
      const R = r * shore(a, seed, ph);
      const x = cx + Math.cos(a) * R;
      const y = cy + Math.sin(a) * R * 0.62;
      const dash = Math.sin(a * 14 - ph + seed) + 0.35 * Math.sin(a * 5 + ph * 2);
      if (dash < -0.35) continue;
      const front = Math.sin(a) > -0.2;
      p.set(x, y, dash > 0.75 ? 'W' : front ? 'w' : 'C');
      if (dash > 0.55 && front) p.set(x, y + 1, 'C');
    }
    // 水纹：三道往外扩的断弧
    for (let k = 0; k < 3; k++) {
      const u = (k + f / n) / 3; // 0..1 由内往外
      const rr = r * (0.18 + 0.68 * u);
      const n2 = Math.round(TAU * rr * 1.2);
      for (let i = 0; i < n2; i++) {
        const a = (i / n2) * TAU;
        const keep = Math.sin(a * (5 + k) + seed * (k + 1) + u * 3) > 0.25;
        if (!keep) continue;
        p.set(cx + Math.cos(a) * rr * shore(a, seed, ph), cy + Math.sin(a) * rr * 0.62 * shore(a, seed, ph), deep ? 'c' : u < 0.7 ? 'C' : 'c');
      }
    }
    // 水光：几点闪动的白
    for (let k = 0; k < Math.round(r / 6); k++) {
      if (hash(seed, k, f) < 0.45) continue;
      const a = hash(seed, k, 1) * TAU;
      const rr = Math.sqrt(hash(seed, k, 2)) * r * 0.75;
      const x = Math.round(cx + Math.cos(a) * rr);
      const y = Math.round(cy + Math.sin(a) * rr * 0.62);
      p.set(x, y, 'W');
      p.set(x + 1, y, 'w');
    }
    out.push(p.grid());
  }
  return out;
}

/** 只留椭圆半径 k（0..1）以内的部分：水域从中心铺开的那几帧。 */
export function revealed(g: Grid, k: number): Grid {
  const cx = (g.w - 1) / 2;
  const cy = (g.h - 1) / 2;
  const R = (g.w / 2) * k;
  return {
    w: g.w,
    h: g.h,
    rows: g.rows.map((row, y) => [...row].map((ch, x) => (Math.hypot(x - cx, (y - cy) / 0.62) <= R ? ch : '.')).join('')),
  };
}

/**
 * 漩涡（仙品「漩涡」）：三道往中心卷的螺旋水纹（白浪头、天青身），12 帧转过 120°（三道一样，转完正好接上）。
 */
export function vortexFrames(r: number, n = 12): Grid[] {
  const S = Math.ceil(r * 2.2) + 4;
  const SH = Math.ceil(r * 2.2 * 0.62) + 4;
  const cx = (S - 1) / 2;
  const cy = (SH - 1) / 2;
  const out: Grid[] = [];
  for (let f = 0; f < n; f++) {
    const p = new Px(S, SH);
    const rot = (f / n) * (TAU / 3);
    for (let arm = 0; arm < 3; arm++) {
      const steps = Math.round(r * 3);
      for (let i = 0; i < steps; i++) {
        const u = i / steps; // 0 外 … 1 中心
        const rr = r * 0.8 * (1 - u) + 2;
        const a = rot + (arm / 3) * TAU + u * 3.4;
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr * 0.62;
        if (u < 0.08 || (u > 0.15 && u < 0.2)) continue; // 浪头断开一下，不连成一个圈
        p.set(x, y, u < 0.3 ? 'W' : u < 0.65 ? 'w' : 'C');
        if (u > 0.2 && u < 0.6) p.under(x, y + 1, 'C');
      }
    }
    out.push(p.grid());
  }
  return out;
}

/**
 * 水柱（展开水域时中心涌起的一道）：十帧 —— 冒头、冲高、顶上翻起浪花、停一下、塌下去、落回成水花。
 * 天青的水身、月白的浪尖与高光、石青的暗面，描黛蓝边。底部居中是根。
 */
export function pillarFrames(): Grid[] {
  // 最高 32 像素（约 1.3 个人；原来冲到 46，差不多两个人高。用户 2026-11-10：法宝、特效不能画得过大）
  const H = 34;
  const W = 15;
  const heights = [6, 14, 23, 29, 32, 31, 28, 20, 10, 4];
  const out: Grid[] = [];
  heights.forEach((h, f) => {
    const p = new Px(W, H);
    const cx = (W - 1) / 2;
    const falling = f >= 6;
    for (let i = 0; i < h; i++) {
      const y = H - 1 - i;
      const t = i / Math.max(1, h - 1); // 0 根 … 1 顶
      // 根部粗、往上收；顶上翻开一朵浪花
      let hw = 3.2 - t * 1.2 + (t > 0.85 ? (t - 0.85) * 18 : 0);
      if (falling) hw += 0.8 * (1 - t);
      const sway = Math.sin(t * 5 + f * 0.9) * 0.7;
      for (let x = Math.floor(cx - hw - 1); x <= Math.ceil(cx + hw + 1); x++) {
        const d = x + 0.5 - (cx + 0.5 + sway);
        if (Math.abs(d) > hw) continue;
        const k = d / Math.max(0.5, hw);
        const crown = t > 0.85;
        if (crown && hash(x, y, f) < 0.25) continue;
        p.set(x, y, crown ? (k < 0 ? 'W' : 'w') : k < -0.45 ? 'w' : k < 0.25 ? 'C' : 'c');
      }
      // 水身上一道一道往上冲的高光
      if (!falling && i % 5 === (f % 5) && t < 0.85) p.set(Math.round(cx - 1 + sway), y, 'W');
    }
    out.push(outline(p.grid(), 'n', { W: 'n', w: 'n', C: 'n', c: 'N' }));
  });
  return out;
}

/** 水花：脚下溅起的一小朵（四帧：溅起、张开、落下、散）。 */
export const SPLASH: Grid[] = [
  ['.w.', 'wCw'],
  ['w.w.w', '.wCw.', '..c..'],
  ['W...W', '.w.w.', 'C.C.C'],
  ['C...C', '.....', 'c.c.c'],
].map((rows) => grid(rows));

/**
 * 寒潭结冰：整片水域从岸边往中心冻成冰面（五帧），冰面上几道冰裂纹、几点冰晶闪光。冰面不透明，盖在水上。
 */
export function iceSheetFrames(r: number, seed: number, n = 5): Grid[] {
  const S = Math.ceil(r * 2.2) + 4;
  const SH = Math.ceil(r * 2.2 * 0.62) + 4;
  const cx = (S - 1) / 2;
  const cy = (SH - 1) / 2;
  // 冰裂：从中心放射出去的几道折线
  const cracks: [number, number][] = [];
  for (let k = 0; k < 7; k++) {
    let a = hash(seed, k) * TAU;
    let x = cx;
    let y = cy;
    let d = 0;
    const len = r * (0.5 + hash(seed, k, 2) * 0.4);
    while (d < len) {
      a += (hash(seed, k, Math.round(d)) - 0.5) * 0.7;
      x += Math.cos(a) * 1.5;
      y += Math.sin(a) * 1.5 * 0.62;
      d += 1.5;
      cracks.push([Math.round(x), Math.round(y)]);
    }
  }
  const out: Grid[] = [];
  for (let f = 1; f <= n; f++) {
    const p = new Px(S, SH);
    const lim = 1 - f / n; // 冻到哪里（从岸边往里）
    for (let y = 0; y < SH; y++)
      for (let x = 0; x < S; x++) {
        const dx = x - cx;
        const dy = (y - cy) / 0.62;
        const d = Math.hypot(dx, dy);
        const a = Math.atan2(dy, dx);
        const R = r * shore(a, seed, 0);
        if (d > R) continue;
        const k = d / R;
        if (k < lim) continue;
        // 冰面：天青，岸边一圈月白的冰沿，几道斜斜的冰光，零星几点亮
        const glint = (x * 2 + y * 3 + seed) % 23 === 0 || (x * 2 + y * 3 + seed) % 23 === 1;
        const lit = -dx - dy * 0.6;
        p.set(x, y, k > 0.93 ? 'w' : glint && lit > -r * 0.2 && k < 0.85 ? 'W' : hash(x, y, seed) < 0.05 ? 'w' : 'C');
      }
    for (const [x, y] of cracks) if (p.get(x, y) !== '.') p.set(x, y, 'c');
    out.push(p.grid());
  }
  return out;
}

// ---------------------------------------------------------------- 五火七禽扇

/** 分层画：每一层单独描边，再按先后叠起来（翅膀和身子之间、尾羽之间都有一道分界，不糊成一团火）。 */
function layered(W: number, H: number, layers: ((p: Px) => void)[], ch: string, sel: Record<string, string>): Grid {
  return compose(
    W,
    H,
    layers.map((draw) => {
      const p = new Px(W, H);
      draw(p);
      return { g: outline(p.grid(), ch, sel), x: 0, y: 0 };
    }),
  );
}
const FIRE_SEL: Record<string, string> = { Y: 'R', f: 'R', o: 'R', e: 'R', r: 'R', y: 'B', b: 'B', k: 'R', W: 'R' };

/**
 * 五火七禽扇（朝右，17×15）：一柄羽扇 —— 金扇柄、扇根一缕朱红穗子，扇面是从扇根辐射出去的一根根火色翎羽
 * （朱砂、橘相间，翎脊缃黄），外沿一圈翎尖亮成缃黄与灵光白。转方向时用 RotSprite（朝左时先镜像）。
 */
export const FAN: Grid = layered(
  17,
  15,
  [
    (p) => {
      // 扇柄与穗子
      for (let x = 0; x <= 4; x++) p.set(x, 7, x === 4 ? 'Y' : x % 2 ? 'y' : 'b');
      p.set(0, 8, 'e');
      p.set(0, 9, 'r');
      p.set(1, 9, 'e');
    },
    (p) => {
      // 扇面：从扇根 (4.5, 7) 往外辐射的翎羽，外沿是一条胖胖的弧（羽扇的桃形）
      const ox = 4.5;
      const oy = 7;
      for (let k = 0; k <= 12; k++) {
        const a = -1.05 + (k / 12) * 2.1;
        const len = 9.6 * (1 - 0.18 * Math.abs(a) ** 2);
        for (let i = 1; i <= len; i += 0.5) {
          const x = ox + Math.cos(a) * i;
          const y = oy + Math.sin(a) * i * 1.05;
          const rim = i > len - 1.2;
          const ch = rim ? (k % 3 === 1 ? 'f' : 'Y') : k % 2 === 0 ? (i < 4 ? 'y' : 'o') : i < 3 ? 'o' : 'e';
          p.set(x, y, ch);
        }
      }
      p.set(ox, oy, 'f');
    },
  ],
  'k',
  { e: 'R', o: 'R', r: 'R', Y: 'B', y: 'B', b: 'B', f: 'B' },
);
/** 扇根（转动中心）。 */
export const FAN_PIVOT = { x: 4.5, y: 7.5 };

/**
 * 七禽火鸟（朝右，四帧扇翅：翅膀高举 → 平展 → 下压 → 平展）：缃黄的头、一点玄色的眼、金喙，头后一缕火焰冠羽；
 * 橘色的身子、身后三道往后飘的长尾羽（越往后越红）；近侧的翅膀按帧扇动，翅缘一道朱红把翅膀和身子分开；
 * 远侧的翅膀稍暗。整只只在外轮廓描一道殷红边（里面不描黑线，免得糊成一团）。游戏里只左右镜像、小角度俯仰，不整圈转。
 * k：按原来 22×18 的画法缩放。游戏里用 0.6（13×11，身子连尾巴约 12 像素长、展翅约 10 高）：原来 22×18 和人差不多大，
 * 七只一起飞出来把人物整个盖住（用户 2026-11-10：法宝、宠物、特效都不能画得过大，参照哪吒约 16×24）。
 * 缩小以后冠羽只留一缕、羽尖的分叉不画（三四像素宽的翅膀上分不出来），细的地方至少一像素宽。
 */
export function firebirdFrames(k = 1): Grid[] {
  return [0, 1, 2, 3].map((f) => {
    const W = Math.round(22 * k);
    const H = Math.round(18 * k);
    const p = new Px(W, H);
    const small = k < 0.8;
    const wingA = [-1.8, -2.75, 2.3, -2.75][f]; // 近侧翅膀的角度（0 朝右，负数往上）
    const farA = [-2.2, -2.95, 2.65, -2.95][f];
    const sh = (f === 0 ? -0.7 : f === 2 ? 0.6 : 0) * k; // 扇翅时身子也跟着起落一点
    /** 一只翅膀：沿方向 a 的弯羽形（前缘一道弧、后缘几道羽尖），按到前缘的远近分三档颜色。 */
    const wing = (bx: number, by: number, a: number, L: number, Wd: number, far: boolean) => {
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      // 后缘朝尾巴那一边（朝下或朝后）
      let nx = Math.sin(a);
      let ny = -Math.cos(a);
      if (nx > 0.2 || (Math.abs(nx) <= 0.2 && ny < 0)) {
        nx = -nx;
        ny = -ny;
      }
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const dx = x + 0.5 - bx;
          const dy = y + 0.5 - by;
          const s = (dx * ux + dy * uy) / L; // 0 根 … 1 尖
          const q = (dx * nx + dy * ny) / Wd; // 0 前缘 … 1 后缘
          if (s < 0 || s > 1) continue;
          // 前缘微微拱起，后缘在 s = 0.45 / 0.7 / 0.9 处各有一道羽尖（小了不分叉）
          const front = -0.18 * Math.sin(Math.PI * s);
          const back = (1 - s ** 1.6) * (small ? 0.95 : 0.75 + 0.25 * Math.abs(Math.sin(s * Math.PI * 3.3))) + 0.08;
          if (q < front || q > back) continue;
          const c = (q - front) / Math.max(0.05, back - front);
          p.set(x, y, far ? (c < 0.5 ? 'e' : 'r') : c < 0.3 ? 'Y' : c < 0.72 ? 'o' : 'e');
        }
    };
    wing(12.2 * k, 8.8 * k + sh, farA, 8 * k, Math.max(1.6, 3.6 * k), true); // 远侧翅膀
    // 尾羽：三道火焰长羽，按帧轻轻摆
    for (let j = 0; j < 3; j++) {
      const sway = Math.sin(f * 1.6 + j * 1.3) * 0.8 * k;
      const spread = (j - 1) * 1.7 * k;
      const pts: [number, number][] = [
        [9.5 * k, 10 * k + sh * 0.5],
        [6.5 * k, 10.6 * k + spread * 0.4 + sway * 0.3],
        [3.5 * k, 11 * k + spread + sway],
        [0.6 * k, 10.5 * k + spread * 1.5 + sway * 1.3],
      ];
      taper(p, pts, Math.max(1, (j === 1 ? 2.4 : 1.8) * k), Math.max(0.55, 0.7 * k), (t) => (t < 0.28 ? 'Y' : t < 0.58 ? 'o' : t < 0.84 ? 'e' : 'r'));
    }
    // 身子、头、冠羽
    ellipse(p, 12 * k, 9.6 * k + sh, Math.max(1.6, 3.7 * k), Math.max(1.1, 2.1 * k), -0.3, (_u, v) => (v < -0.35 ? 'Y' : v < 0.5 ? 'o' : 'e'));
    ellipse(p, 15.9 * k, 7.1 * k + sh, Math.max(1.2, 2 * k), Math.max(1.1, 1.8 * k), 0, (u, v) => (v < -0.25 && u < 0.3 ? 'f' : 'Y'));
    taper(p, [[15 * k, 5.8 * k + sh], [13.6 * k, 4 * k + sh], [11.8 * k, 3 * k + sh]], Math.max(0.9, 1.4 * k), 0.55, (t) => (t < 0.45 ? 'o' : 'e'));
    if (!small) taper(p, [[15.8, 5.5 + sh], [15.2, 3.4 + sh], [14, 2 + sh]], 1.1, 0.6, (t) => (t < 0.45 ? 'o' : 'e'));
    wing(11.6 * k, 8.4 * k + sh, wingA, 9 * k, Math.max(1.8, 4.2 * k), false); // 近侧翅膀
    // 喙、眼
    if (small) {
      p.set(17.9 * k, 7.3 * k + sh, 'y');
      p.set(16.2 * k, 6.7 * k + sh, 'k');
    } else {
      p.set(18.2, 7.2 + sh, 'y');
      p.set(19.1, 7.6 + sh, 'b');
      p.set(16.6, 6.7 + sh, 'k');
    }
    return outline(p.grid(), 'R', FIRE_SEL);
  });
}
/** 火鸟缩放到多少（见 firebirdFrames）。 */
export const FIREBIRD_K = 0.6;
export const FIREBIRD: Grid[] = firebirdFrames(FIREBIRD_K);
/** 火鸟的转动中心（身子中间）。 */
export const FIREBIRD_PIVOT = { x: 12 * FIREBIRD_K, y: 9.5 * FIREBIRD_K };

/**
 * 焚风的焦土（一道沿火浪中线的焦痕，按 (x0, y0) → (x1, y1) 的方向直接画，不用转）：烧黑的地面、两道暗红的裂口、
 * 零星还红着的炭；两头收窄、边缘参差（不是一道硬直线）。w 是半宽。返回网格和它左上角的世界坐标。
 */
export function scorchDecal(x0: number, y0: number, x1: number, y1: number, w: number, seed: number): { g: Grid; ox: number; oy: number } {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  const pad = Math.ceil(w) + 3;
  const ox = Math.floor(Math.min(x0, x1)) - pad;
  const oy = Math.floor(Math.min(y0, y1)) - pad;
  const W = Math.ceil(Math.abs(x1 - x0)) + pad * 2 + 1;
  const H = Math.ceil(Math.abs(y1 - y0)) + pad * 2 + 1;
  const p = new Px(W, H);
  const crack = (s: number, k: number) => w * (k ? 0.22 : -0.25) + Math.sin(s * 0.35 + seed + k * 2) * w * 0.18 + Math.sin(s * 0.9 + k) * w * 0.08;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = ox + x + 0.5 - x0;
      const dy = oy + y + 0.5 - y0;
      const s = dx * ux + dy * uy; // 沿线
      const d = -dx * uy + dy * ux; // 离中线
      if (s < -1 || s > len + 1) continue;
      const t = s / len;
      const taperK = Math.min(1, (t + 0.02) * 6, (1 - t + 0.02) * 4);
      const si = Math.round(s);
      const hw = w * (0.55 + 0.3 * Math.sin(si * 0.31 + seed) + 0.15 * hash(si, seed)) * taperK;
      const q = Math.abs(d) / Math.max(0.5, hw);
      if (q > 1) continue;
      const r = hash(x, y, seed);
      if (q > 0.82 && r < 0.45) continue; // 边缘参差
      let ch = q < 0.4 ? 'k' : q < 0.75 ? 'd' : 'g';
      // 两道暗红的裂口（断断续续）
      for (let k = 0; k < 2; k++) if (Math.abs(d - crack(s, k)) < 0.6 && hash(si, k, seed) > 0.2) ch = si % 7 === 0 ? 'e' : 'R';
      if (r < 0.03) ch = 'e';
      else if (r < 0.05) ch = 'r';
      p.set(x, y, ch);
    }
  return { g: p.grid(), ox, oy };
}

// ---------------------------------------------------------------- 捆仙绳

/** 绳结：捆住一只敌人时打的一个金结，两缕绳头垂下来。 */
export const ROPE_KNOT: Grid = lined(grid(['.Yy.', 'YfYb', 'byyb', '.b.y', 'y...']), 'B', { Y: 'B', y: 'B', f: 'B', b: 'B' });
/** 器灵「困龙」：金绳的绳头是一只小金龙头（朝右，咬住第一只）。 */
export const ROPE_DRAGON: Grid = outline(
  grid([
    '.YY.......',
    '..yYY.Y...',
    '...yYYyY..',
    '.byyYkYYyW',
    'byyyyyyyyY',
    '.byyRWWRR.',
    '..bby.....',
  ]),
  'k',
  { Y: 'B', y: 'B', b: 'B', W: 'B', R: 'B' },
);
export const ROPE_DRAGON_PIVOT = { x: 4.5, y: 4 };
/** 器灵「连环」：每个绳结上套的一枚小金环。 */
export const ROPE_RING: Grid = lined(grid(['.Yy.', 'Y..b', 'y..b', '.bB.']), 'B', { Y: 'B', y: 'B', b: 'B' });

// ---------------------------------------------------------------- 预览（scratch 的自查脚本用）

/** 所有成形的精灵（自查用）。 */
export function artifactSheet(): Grid[][] {
  return [
    [talisman(), BLOOD_BLADE, ...BLOOD_CUT, ...SOUL_WISP, ...bloodPuffFrames(5, 2)],
    [...PEARL, ...LEAVES, CALM_SEAL],
    [...LOTUS_BUD, ...thornFrames(false), ...thornFrames(true), ...LOTUS_MOTE, ...STEP_LOTUS],
    [...azureLotusFrames(4), ...azureLotusFrames(2, true)],
    [MIRROR.yang, MIRROR.yin, ...TAIJI],
    waterFlagFrames(8),
    [...pillarFrames(), ...SPLASH],
    [FAN, ...FIREBIRD, ...FIREBIRD.map(flipX)],
    [ROPE_KNOT, ROPE_DRAGON, ROPE_RING],
    [compose(1, 1, [])],
  ];
}
