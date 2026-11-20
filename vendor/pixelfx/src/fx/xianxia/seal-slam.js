// 砸地（修仙版 · 番天印落地）：改自 pixelfx 的 impacts/ground-slam（MIT，https://github.com/patch-gg/pixelfx）。
// 原作的石块、碎屑、贴地滚的尘和尘柱改编自 Sprite Fusion 的开源 explosion
// (https://www.spritefusion.com/pixel-art-vfx/explosion)，MIT License, Copyright (c) 2026 Hugo Duprez。
// 改了什么（封神幸存者，2026-11-10）：
// - 去掉冲击波：原作有一圈贴地的亮环，和左右两道立着的月牙形激波一路冲出去（游戏里不要冲击波圆环）。
//   换成一圈尘团从落点四周被推开，后面再跟一圈小的；看得出「震开」，但没有环线。
// - 侧视改成俯视 3/4：原作的尘和裂纹只沿着一条地平线左右跑。现在地面是一片（纵向压扁，见 _lib 的 SY）：
//   裂纹朝四面八方放射，尘团绕着落点一圈（远的半圈画在后层），石块各自落在远近不同的地方。
// - 裂纹照游戏里的画法：不画一像素的细线（用户否过），每道是两像素的暗缝，下沿一道受光的石唇、上沿压暗；
//   刚裂开时缝里透着土黄的光，冷下去。
// - 整体缩小：原作画布 288×208、尘柱近 100 像素高。现在按选项 reach（番天印的半径，默认 28）定大小，尘柱约 35 像素。
// - 节奏：3.2 秒收到 2.2 秒（番天印落得勤，尘不能一直糊着）；闪光从 2 帧加到 3 帧。
// - 辉光：原作两盏灯（半径 50–96）、一条 160 像素宽的贴地光带、裂缝上一团半径 46 的光，只留落地那一下半径 14 的一盏。
// - 裂纹五道、长短角度都不匀，暗缝用乌、黛（玄色的、匀称放射的六道像一只黑蜘蛛）；收尾时从尖上往回合上，不抖着淡掉。
// - 尘：浅暖灰（银鼠、缟、月白），一圈从四周推开、中间留空（游戏里大印落地后还压在那儿停一下）；去掉正中的尘柱。
//   深褐的尘（檀色）在浅色的仙台上像一团泥。石块是仙台的玉石色；颜色全部收进色阶。
import { Particles, Lights, P, PF, Rng, fit, clamp, smooth, ease, TAU, WHITE, hex } from "../../core/index.js";
import { star, rock, rockShape } from "../impacts/_lib.js";
import { gp, snapper, rim, SY } from "./_lib.js";

export const meta = {
  name: "砸地 Seal slam",
  desc: "A great seal lands: a flat flash, cracks split the floor every way with earth light in them, dust is shoved outward all round, stone chunks pop up and land near and far.",
  tags: ["impact", "ground", "slam", "seal", "cracks", "rocks", "dust", "xianxia", "one-shot"],
  size: [144, 116],
  origin: [72, 82],
  duration: 2.2,
  loop: false,
  fps: 30,
  bg: "ground",
  options: {
    palette: gp("BbyYYfW"), // 落地那一下的光和缝里的热：暗 → 亮
    sparks: gp("Yyoe"),
    stone: gp("ghijw"), // 石块：描边、暗面、身、亮面、棱（描边用黛：玄色描边的石块在浅色地面上像一颗颗黑疙瘩）
    dust: gp("ijw"), // 尘：压暗的底、身、受光的顶（浅色的仙台上用浅暖灰的尘；深褐的尘像一团泥）
    crack: gp("ghijw"), // 裂纹：暗缝、暗缝的第二像素、坑底、上沿、受光的石唇（暗缝不用玄色：玄色的放射状裂纹像一只黑蜘蛛）
    reach: 28,
    seed: 5,
  },
};

// 一道裂纹：从落点往 a 方向走 len 远（地面坐标，画的时候纵向压扁），偶尔分叉。点是 [x, y, 离落点多远]
function crackPath(R, a, len, out, main = true, x = Math.cos(a) * 2.5, y = Math.sin(a) * 2.5, d0 = 2.5) {
  const pts = [[x, y * SY, d0]];
  let d = 0, cur = a;
  while (d < len) {
    const st = R.range(2, 4);
    cur = a + R.range(-0.7, 0.7);
    x += Math.cos(cur) * st;
    y += Math.sin(cur) * st;
    d += st;
    pts.push([x, y * SY, d0 + d]);
    if (main && d > len * 0.3 && d < len * 0.85 && R.chance(0.32)) crackPath(R, cur + R.sign() * R.range(0.6, 1.1), R.range(3, 8), out, false, x, y, d0 + d);
  }
  out.push({ pts, main });
}

export function create(o) {
  const C = fit(o.palette, 7), S = fit(o.sparks, 4), ST = fit(o.stone, 5), DU = fit(o.dust, 3), CR = fit(o.crack, 5);
  const REACH = o.reach, K = REACH / 28, R = new Rng(o.seed), D = meta.duration;
  const snap = snapper(C, S, ST, DU, CR);
  const st = { light: ST[3], body: ST[2], shade: ST[1], lip: ST[4] };
  // 三条「纵深」：碎屑和火星各自落在远、中、近三条地平线上（俯视的地面是一片，不是一条线）
  const LANE = [-0.42, 0, 0.42].map((k) => k * REACH * SY);
  const lanes = LANE.map((gy) => new Particles({ rng: R, ground: () => gy, sparks: S }));
  const far = new Particles({ rng: R }), near = new Particles({ rng: R }), lights = new Lights();
  // 裂纹：五道，长短、角度都不匀（匀称的放射状像蜘蛛）
  const cracks = [], n = 5, a0 = R.range(0, TAU);
  for (let i = 0; i < n; i++) crackPath(R, a0 + (i / n) * TAU + R.range(-0.45, 0.45), REACH * [0.95, 0.5, 0.8, 0.6, 0.85][i] * R.range(0.85, 1.05), cracks);
  // 落地那一下的光：贴地的半颗星，往两边的长、往上的短
  const burst = [
    { a: -0.08, len: R.range(13, 16) * K, w: 1.5 }, { a: Math.PI + 0.08, len: R.range(13, 16) * K, w: 1.5 },
    { a: -0.5 + R.range(-0.08, 0.08), len: R.range(7, 9) * K, w: 1.2 }, { a: -Math.PI + 0.5 + R.range(-0.08, 0.08), len: R.range(7, 9) * K, w: 1.2 },
    { a: -Math.PI / 2 + R.range(-0.15, 0.15), len: R.range(8, 11) * K, w: 1.4 },
  ];
  const dustCol = () => R.pick([DU[1], DU[1], DU[0], DU[2]]);
  // 尘：一圈尘团从落点四周被推开（远的半圈在后层），稍后再跟一圈小的。
  // 不用库的 SMOKE：它越老越往库自己的灰色烟色阶里混，浅色地面上成了一团团灰烟。这里自己画：
  // 三层真半透明的圆（压暗的底、身、受光的顶），颜色一直是尘的色阶。
  const dusts = [];
  const puff = (a, r0, sp, size, life, delay) =>
    dusts.push({ x: Math.cos(a) * r0, y: Math.sin(a) * r0 * SY - 1, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * SY - 3, size, life, delay, age: 0, back: Math.sin(a) < 0 });
  const drawDust = (p, back) => {
    for (const d of dusts) {
      if (d.back !== back || d.age <= 0 || d.age >= d.life) continue;
      const u = d.age / d.life, r = d.size * (0.7 + 0.8 * Math.pow(u, 0.6)), a = Math.min(1, u * 10) * Math.pow(1 - u, 1.2) * 0.8;
      p.disc(d.x, d.y + r * 0.18, r, DU[0], a * 0.5);
      p.disc(d.x, d.y, r * 0.84, DU[1], a * 0.72);
      p.disc(d.x - r * 0.22, d.y - r * 0.3, r * 0.5, DU[2], a * 0.75);
    }
  };
  // 中间留空（游戏里大印落地后还压在那儿停一下，尘不能把它糊住），所以没有正中的尘柱
  for (let i = 0; i < 13; i++) puff((i / 13) * TAU + R.range(-0.15, 0.15), REACH * R.range(0.36, 0.48), R.range(26, 40) * K, R.range(3.2, 4.8) * Math.sqrt(K), R.range(0.75, 1.05), R.range(0, 0.03));
  for (let i = 0; i < 7; i++) puff((i / 7) * TAU + R.range(-0.2, 0.2), REACH * R.range(0.62, 0.8), R.range(12, 20) * K, R.range(2, 3) * Math.sqrt(K), R.range(0.55, 0.8), R.range(0.1, 0.18));
  // 火星和碎屑
  for (let i = 0; i < 9; i++) {
    const low = i < 4, s = R.sign(), a = low ? (s > 0 ? -R.range(0.05, 0.5) : Math.PI + R.range(0.05, 0.5)) : -Math.PI / 2 + R.range(-1.1, 1.1), sp = (low ? R.range(110, 240) : R.range(130, 300)) * Math.sqrt(K), L = i % 3;
    lanes[L].spawn(P.SPARK, R.range(-3, 3), LANE[L] - 1, Math.cos(a) * sp, Math.sin(a) * sp, low ? R.range(0.25, 0.5) : R.range(0.3, 0.6), WHITE, 1, low ? 0 : R.range(0, 0.05));
  }
  for (let i = 0; i < 16; i++) {
    const u = R.range(-1, 1), a = -Math.PI / 2 + u * 0.75, sp = R.range(80, 230) * Math.sqrt(K) * (1 - 0.35 * Math.abs(u)), L = i % 3;
    lanes[L].spawn(P.GRIT, u * 5, LANE[L] - 1, Math.cos(a) * sp, Math.sin(a) * sp, R.range(0.8, 1.5), R.pick([ST[3], ST[2], ST[2], ST[1], ST[4]]), R.chance(0.3) ? 2 : 1);
  }
  // 石块：从坑里崩起来，各自落在远近不同的地方，弹一下，停住
  const rocks = Array.from({ length: 7 }, (_, i) => {
    const a = (i / 7) * TAU + R.range(-0.35, 0.35), dist = REACH * R.range(0.3, 0.95);
    return { lx: Math.cos(a) * dist, ly: Math.sin(a) * dist * SY, T: R.range(0.4, 0.62), H: R.range(10, 24) * Math.sqrt(K), s: [1, 1, 1.2, 1.5, 1.5, 2, 1][i], a: R.range(0, TAU), va: R.range(-14, 14), pts: rockShape(R), max: R.range(1.3, 1.9), d: R.range(0, 0.05), landed: false, x: 0, y: 0, life: 9 };
  });
  lights.add(0, -4, 14, C[5], 0.6, 0.2);

  let t = 0;
  const heat = () => Math.pow(clamp(1 - t / 0.7), 1.4);
  return {
    update(dt) {
      t += dt;
      for (const b of rocks) {
        const u = (t - b.d) / b.T;
        if (u < 0) continue;
        if (u < 1) {
          b.x = b.lx * u;
          b.y = b.ly * u - 4 * b.H * u * (1 - u) - 1;
          b.a += b.va * dt;
        } else {
          // 落地：扬一点尘，小弹一下再停
          if (!b.landed) {
            b.landed = true;
            const sys = b.ly < 0 ? far : near;
            for (let i = 0; i < 2; i++) sys.spawn(P.DUST, b.lx + R.range(-1.5, 1.5), b.ly - 0.5, R.sign() * R.range(8, 26), -R.range(2, 12), R.range(0.3, 0.55), DU[1], R.range(1.2, 2) * (0.7 + b.s * 0.2));
          }
          const v = clamp((t - b.d - b.T) / 0.2);
          b.x = b.lx * (1 + 0.08 * v);
          b.y = b.ly * (1 + 0.08 * v) - 4 * b.H * 0.16 * v * (1 - v) - 1;
          if (v < 1) b.a += b.va * 0.5 * dt;
        }
        b.life = b.max - (t - b.d); // rock() 在最后半秒把它抖掉
      }
      for (const l of lanes) l.update(dt);
      for (const d of dusts) {
        if (t < d.delay) continue;
        d.age += dt;
        d.vx -= d.vx * 3 * dt;
        d.vy -= d.vy * 3 * dt + 5 * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
      }
      far.update(dt);
      near.update(dt);
      lights.update(dt);
    },
    drawBack(p) {
      // 收尾：裂纹从尖上往回收（合上），不抖着淡掉（抖出来是一片棋盘格）
      const fade = 1, close = 1 - ease.inOutSine(smooth(D - 1, D - 0.2, t)), H = heat(), G = ease.outCubic(clamp(t / 0.14)) * close;
      if (close > 0.02 && t > 0.02) {
        const seg = (fn) => {
          for (const c of cracks) {
            const lim = 2.5 + (c.pts[c.pts.length - 1][2] - 2.5) * G + (c.main ? 0 : -2);
            for (let i = 1; i < c.pts.length; i++) {
              const [x0, y0, d0] = c.pts[i - 1], [x1, y1, d1] = c.pts[i];
              if (d0 >= lim) break;
              const f = d1 > lim ? (lim - d0) / (d1 - d0) : 1, ex = x0 + (x1 - x0) * f, ey = y0 + (y1 - y0) * f, flat = Math.abs(ex - x0) >= Math.abs(ey - y0);
              fn(c, x0, y0, ex, ey, flat ? 0 : 1, flat ? 1 : 0, d0);
            }
          }
        };
        // 先画缝两边：下沿（或右沿）一道受光的石唇，上沿压暗；再画暗缝，免得被别的缝的石唇盖住
        // 缝越往外越细：靠近落点是两像素的暗缝加石唇和压暗的上沿，外面一截只剩一像素的缝和石唇
        const inner = (c, d) => c.main && d < REACH * 0.45;
        seg((c, x0, y0, x1, y1, nx, ny, d) => {
          const w = inner(c, d) ? 2 : 1;
          if (c.main) p.line(x0 + nx * w, y0 + ny * w, x1 + nx * w, y1 + ny * w, CR[4], fade);
          if (inner(c, d)) p.line(x0 - nx, y0 - ny, x1 - nx, y1 - ny, CR[3], fade * 0.75);
        });
        seg((c, x0, y0, x1, y1, nx, ny, d) => {
          // 刚裂开时缝里透着土黄的光：离落点越近越热，冷了就是暗缝
          const h = H * clamp(1.25 - d / (REACH * 0.8)), hot = h > 0.6 ? C[5] : h > 0.35 ? C[3] : h > 0.15 ? C[1] : 0;
          p.line(x0, y0, x1, y1, CR[0], fade);
          if (inner(c, d)) p.line(x0 + nx, y0 + ny, x1 + nx, y1 + ny, hot || CR[1], fade);
          else if (hot) p.line(x0, y0, x1, y1, hot, fade);
        });
        // 正中砸出的浅坑：远沿压暗、近沿受光，一圈翻起的碎石边；跟着裂纹一起收小
        const rx = (5 * Math.sqrt(K) + 1) * (0.4 + 0.6 * close), ry = rx * SY + 0.5;
        p.ellipse(0, 0, rx, ry, (d, ang) => (d > 0.72 ? (Math.sin(ang) < 0 ? CR[2] : CR[4]) : d > 0.4 ? (H > 0.5 ? C[1] : CR[3]) : H > 0.5 ? C[3] : CR[2]), fade);
      }
      drawDust(p, true);
      far.draw(p);
      snap(p);
    },
    draw(p) {
      for (const b of rocks) if (t >= b.d && b.life > 0) rock(p, b, st);
      drawDust(p, false);
      near.draw(p);
      for (const l of lanes) l.draw(p);
      // 落地那一下：一片贴地的白光加半颗星，三帧收掉
      const BX = 20 * K + 6;
      if (t < 0.03) {
        p.ellipse(0, 0, 13 * K, 13 * K * SY * 0.55, (d) => (d > 0.8 ? C[4] : d > 0.5 ? C[6] : WHITE));
        star(p, 0, -1, burst, 1, 1, [C[4], C[6], WHITE, WHITE], 1, 2);
        rim(p, -BX, -BX, BX, BX * 0.6, C[1]);
      } else if (t < 0.1) {
        const u = (t - 0.03) / 0.07;
        star(p, 0, -1, burst, 1.2 + 0.1 * u, 0.55 - 0.2 * u, [C[1], C[3], C[5], C[6]], 1, 1.6);
      }
      lights.draw(p);
      snap(p);
    },
  };
}
