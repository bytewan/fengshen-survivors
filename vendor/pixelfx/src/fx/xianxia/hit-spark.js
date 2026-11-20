// 命中火星（修仙版）：改自 pixelfx 的 impacts/hit-spark（MIT，https://github.com/patch-gg/pixelfx）。
// 原作的两色火星和落点那一亮改编自 Sprite Fusion 的开源 impact (https://www.spritefusion.com/pixel-art-vfx/impact)，
// MIT License, Copyright (c) 2026 Hugo Duprez。
// 改了什么（封神幸存者，2026-11-10）：
// - 整体缩小（选项 scale，默认 0.42）：原作的星芒有 35 像素长，比 16–24 像素高的人物还大；现在星芒约 20 像素宽，
//   火星溅出去也不超过人物身侧二十来像素。
// - 节奏放慢：原作 0.5 秒、星芒只亮 3 帧（一闪就没）。现在星芒白 2 帧、冷下去收短 3 帧、顺着这一下留一道余光 4 帧，
//   火星多飘一会儿，总长 0.6 秒。
// - 星芒只留四道（顺着这一下一长、背后一短、两侧斜着两道），不摆成正十字；原作夹着的第五道太细，缩小以后成了碎点。
// - 辉光：原作三盏半径 22–38 像素的灯（浅色地面上是一团黄晕），只留一盏半径 8 像素的。
// - 星芒外面描一圈色阶里的深色（选项 edge）：金白色的星芒在浅色的仙台地面上不描边会发飘。
// - 火星是金铁的火（白 → 缃 → 藤黄 → 琥珀），不带朱红：朱红留给火行和血。颜色全部收进色阶。
// - 画布左右对称（原点在正中）：aim 可以朝任何方向，不会被画布裁掉。
import { Particles, Lights, P, Rng, fit, WHITE, hex } from "../../core/index.js";
import { gp, snapper, rim } from "./_lib.js";

export const meta = {
  name: "命中火星 Hit spark",
  desc: "Metal on metal: a small lopsided four-ray star round a white diamond cools and shrinks, a streak lingers along the blow, gold sparks and hot chips fall and tick off the floor.",
  tags: ["impact", "hit", "spark", "combat", "directional", "xianxia", "one-shot"],
  size: [96, 72],
  origin: [48, 58],
  duration: 0.6,
  loop: false,
  fps: 30,
  bg: "ground",
  options: { palette: gp("BbyYYfW"), sparks: gp("WYyb"), edge: gp("b")[0], height: 10, aim: 0.1, scale: 0.42, seed: 4 },
};

// 星芒的一道：根部粗、尖上细，白往外冷下去；from..1 只画靠外的一段
function ray(p, x, y, a, L, w, C, from = 0) {
  const c = Math.cos(a), s = Math.sin(a);
  for (let d = from * L; d <= L; d += 0.5) {
    const u = d / L, hw = w * Math.pow(1 - u, 1.6);
    const col = u < 0.3 ? C[6] : u < 0.62 ? C[5] : u < 0.88 ? C[4] : C[2];
    p.px(x + c * d, y + s * d, col);
    if (hw > 0.45) for (let o = 0.5; o <= hw; o += 0.5) for (const e of [-o, o]) p.px(x + c * d - s * e, y + s * d + c * e, u < 0.3 && o < 1 ? C[5] : C[4]);
  }
}

// 星芒的心：一粒白菱形
function diamond(p, x, y, r) {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.abs(dx) + Math.abs(dy) <= r) p.px(x + dx, y + dy, WHITE);
}

export function create(o) {
  const C = fit(o.palette, 7), R = new Rng(o.seed), K = o.scale, X = 0, Y = -o.height, A = o.aim, floor = () => 0;
  const S = fit(o.sparks, 4), EDGE = hex(o.edge), snap = snapper(C, S, EDGE);
  const ps = new Particles({ rng: R, ground: floor, sparks: S }), lights = new Lights();
  // 星芒：顺着这一下的方向一道长的，背后一截短的，两侧各一道斜着的短芒（不摆成正十字）
  const tilt = R.range(-0.08, 0.08);
  const rays = [
    { a: A + tilt, L: R.range(33, 37) * K, w: 2.6 * K },
    { a: A + Math.PI + tilt, L: R.range(10, 12) * K, w: 2.6 * K },
    { a: A - 1.25 + tilt, L: R.range(15, 17) * K, w: 2.8 * K },
    { a: A + 1.9 + tilt, L: R.range(11, 13) * K, w: 2.6 * K },
  ];
  const B = 44 * K + 4; // 星芒占的范围（描边用）

  lights.add(X, Y, 8, C[4], 0.5, 0.16);
  // 顺着这一下溅出去的一锥火星：飞出去、落下、在地上弹一下
  for (let i = 0; i < 7; i++) {
    const a = A + R.range(-0.6, 0.6) - 0.15, v = R.range(130, 270) * K;
    ps.spawn(P.SPARK, X + 1, Y, Math.cos(a) * v, Math.sin(a) * v - 30, R.range(0.3, 0.5), WHITE, 1, i > 4 ? R.range(0.03, 0.07) : 0);
  }
  // 崩下来的几粒热碎屑，翻着落到地上
  for (let i = 0; i < 4; i++) {
    const a = A + R.range(-1.1, 0.5) - 0.3, v = R.range(70, 150) * K;
    ps.spawn(P.GRIT, X + 1, Y, Math.cos(a) * v, Math.sin(a) * v - R.range(30, 70), R.range(0.4, 0.55), R.pick([C[5], C[4], C[4], C[2]]), 1);
  }

  let t = 0;
  return {
    update(dt) {
      t += dt;
      ps.update(dt);
      lights.update(dt);
    },
    draw(p) {
      if (t < 0.067) {
        // 亮的两帧：整个星芒围着一粒白菱形
        for (const r of rays) ray(p, X, Y, r.a, r.L, r.w, C);
        diamond(p, X, Y, t < 0.034 ? 2 : 1);
        rim(p, X - B, Y - B, X + B, Y + B, EDGE);
      } else if (t < 0.167) {
        // 冷下去（白 → 缃 → 藤黄）、收短、变细，只有心上那一粒还白着
        const u = (t - 0.067) / 0.1, cool = [C[0], C[1], C[1], C[2], C[3], C[4], C[5]];
        for (const r of rays) ray(p, X, Y, r.a, r.L * (1 - 0.35 * u), r.w * (0.75 - 0.3 * u), cool);
        p.px(X, Y, WHITE);
        rim(p, X - B, Y - B, X + B, Y + B, EDGE, 1 - 0.5 * u);
      } else if (t < 0.3) {
        // 只剩顺着这一下的那道余光，从根上烧掉、冷下去
        const r = rays[0], u = (t - 0.167) / 0.133;
        ray(p, X, Y, r.a, r.L * 1.2, 0.5, [C[0], C[1], C[1], C[1], C[1], C[2], C[3]], 0.3 + 0.55 * u);
      }
      ps.draw(p);
      lights.draw(p);
      snap(p);
    },
  };
}
