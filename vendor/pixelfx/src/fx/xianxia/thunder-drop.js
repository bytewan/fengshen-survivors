// 小天雷（修仙版 · 五雷正法 / 雷公鞭的落雷）：天雷符（xianxia/tianlei，改自 pixelfx 的 lightning/lightning-strike）的小号。
// 雷的画法用的是库的 lightning/_lib（出自 Sprite Fusion 的开源 lightning，https://www.spritefusion.com/pixel-art-vfx/lightning，
// MIT License, Copyright (c) 2026 Hugo Duprez）。
// 和天雷符不一样的地方（封神幸存者，2026-11-10）：
// - 小：天雷符的雷有 220 像素高、画布 240×264，是大招。这一道从头顶四十几像素（选项 height）的一小团雷云里落下来，
//   画布 96×88，给五雷正法每 6 秒一道的雷、雷公鞭的第一下、雷印的延时落雷用。
// - 不立黄符，改成「聚云」：两团云气从两边合到一起、云里亮两下，然后落雷（五雷正法的设定就是「头顶聚云、落一道天雷」）。
// - 两次闪击（天雷符三次），雷道冷下去以后从上往下碎掉；落点一小片焦痕、几道贴地爬开的电弧、火星和一缕烟。总长 1.5 秒。
// - 云是真半透明的软团（压暗的底、身、受光的顶），淡出时整团变淡；原来是实心的深色圆，最后抖成一片棋盘格。
//   雷道碎掉时落下的光点只用单像素的星（库的 MOTE 拖着压暗的尾巴，收进色阶后是深色的脏点）。
//   落点那两小团烟去掉了：库的烟越老越灰，缩成一颗灰球浮在焦痕上。
// - 没有地面的圈，没有大范围的光：沿雷道的光半径约 6，落点一盏半径 14 的灯。颜色全部收进色阶。
import { Particles, Lights, P, Rng, fit, sparkle, clamp, smooth, rand, rng, WHITE } from "../../core/index.js";
import { VOLT, PLASMA, zigzag, bend, stroke, crackle, trace, scorch } from "../lightning/_lib.js";
import { gp, snapper, SY } from "./_lib.js";

export const meta = {
  name: "小天雷 Small thunderbolt",
  desc: "A small heaven-thunder: two soft clouds close overhead and flicker, a bolt drops in two strokes, sparks and arcs skitter off a small scorch, the channel crumbles, the cloud thins.",
  tags: ["lightning", "thunder", "strike", "cloud", "target", "impact", "xianxia", "one-shot"],
  size: [96, 88],
  origin: [48, 70],
  duration: 1.5,
  loop: false,
  fps: 30,
  bg: "ground",
  options: { palette: VOLT, sparks: PLASMA, cloud: gp("ghij"), ember: gp("kdRreoyY"), stone: gp("hij"), height: 46, seed: 5 },
};

const S1 = 0.34, S2 = 0.62, FLICK = [1, 0.72, 0.3, 0.95, 0.5, 0.25];
const level = (a) => (a < 0 ? 0 : FLICK[Math.floor(a * 30 + 1e-4)] ?? 0);

export function create(o) {
  const C = fit(o.palette, 8), S = fit(o.sparks, 4), CL = fit(o.cloud, 4), EM = fit(o.ember, 8), STONE = fit(o.stone, 3), R = new Rng(o.seed), H = o.height;
  const snap = snapper(C, S, CL, EM, STONE);
  const ps = new Particles({ rng: R, ground: () => 0, sparks: S }), lights = new Lights();
  const X0 = R.range(-4, 4), main = zigzag(R, X0, -H + 3, 0, -1, 0.2, 0.5), trunk = main.paths[0].pts;
  const second = bend({ paths: [{ pts: trunk, w: 1 }] }, (x, y) => [x + 2 * Math.sin((Math.PI * y) / -H), y]);
  const bolts = [main, second], STROKES = [{ t: S1, k: 1 }, { t: S2, k: 0.62 }];
  const gone = trunk.map(([, y], i) => S2 + 0.22 + 0.42 * (0.55 * rand(o.seed, i, 5) + 0.45 * (1 - y / -H)));
  // 云：左右各两团，合到一起；每团是几个叠着的圆
  const lumps = [
    { side: -1, dx: -7, dy: 1, r: 4.2 }, { side: -1, dx: -2.5, dy: -1.5, r: 5 }, { side: -1, dx: -11.5, dy: 2.2, r: 2.6 },
    { side: 1, dx: 3, dy: -0.5, r: 4.4 }, { side: 1, dx: 8, dy: 1.5, r: 3.4 }, { side: 1, dx: 12.5, dy: 2.6, r: 2.2 },
  ];
  const D = meta.duration, cap = (life, delay = 0) => Math.max(0.05, Math.min(life, D - 0.06 - t - delay));
  let t = 0, struck = -1;
  const now = () => {
    for (let i = STROKES.length - 1; i >= 0; i--) if (t >= STROKES[i].t) return { i, s: STROKES[i], a: t - STROKES[i].t, k: level(t - STROKES[i].t) * STROKES[i].k };
    return null;
  };
  const heatAt = () => (struck < 0 ? 0 : Math.max(...STROKES.slice(0, struck + 1).map((s) => s.k * Math.pow(clamp(1 - (t - s.t) / 1.0), 1.4))));

  function cloud(p) {
    const inn = 1 - smooth(0, S1 - 0.06, t), out = smooth(S2 + 0.25, 1.3, t), a = clamp(t / 0.12) * (1 - smooth(1.0, 1.36, t));
    if (a <= 0) return;
    // 云里的电光：落雷前闪两下，每次闪击时整团亮一下
    const s = now(), lit = (t > 0.2 && t < 0.24) || (t > 0.28 && t < 0.31) || (s && s.a < 0.07);
    // 云是真半透明的（压暗的底、身、受光的顶三层软圆），淡出时整团变淡，不抖成棋盘格；上沿受光的一圈在闪电时亮成缃色
    for (const pass of [0, 1, 2])
      for (const l of lumps) {
        const x = X0 * 0.5 + l.dx + l.side * (14 * inn + 9 * out), y = -H + l.dy - 2 * out, r = l.r * (1 - 0.35 * out);
        if (pass === 0) p.disc(x, y + 1.2, r, CL[0], a * 0.6);
        else if (pass === 1) p.disc(x, y, r - 0.4, (d, ang) => (Math.sin(ang) < -0.25 && d > 0.55 ? (lit ? C[5] : CL[2]) : CL[1]), (d, ang) => (Math.sin(ang) < -0.25 && d > 0.55 ? a * 0.9 : a * 0.72));
        else if (r > 3.5) p.disc(x - r * 0.25, y - r * 0.35, r * 0.4, lit ? C[6] : CL[3], a * 0.65);
      }
    if (lit) p.glow(X0 * 0.5, -H, 9, C[4], 0.35);
  }

  return {
    update(dt) {
      t += dt;
      for (const [i, s] of STROKES.entries()) {
        if (struck >= i || t < s.t) continue;
        struck = i;
        const k = s.k;
        lights.add(0, -4, 14, C[5], 0.55 * k, 0.25);
        for (let j = 0; j < Math.round(16 * k); j++) {
          const a = -Math.PI / 2 + R.range(-1.35, 1.35), sp = R.range(70, 190) * (0.65 + 0.35 * k);
          ps.spawn(P.SPARK, R.range(-1.5, 1.5), -2, Math.cos(a) * sp, Math.sin(a) * sp, R.range(0.22, 0.5));
        }
        for (let j = 0; j < Math.round(6 * k); j++) {
          const a = -Math.PI / 2 + R.range(-1.1, 1.1), sp = R.range(40, 120);
          ps.spawn(P.GRIT, R.range(-3, 3), -1, Math.cos(a) * sp, Math.sin(a) * sp, cap(R.range(0.6, 0.85)), R.pick(STONE), 1);
        }
      }
      for (let i = 0; i < gone.length - 1; i++)
        if (gone[i] <= t && gone[i] > t - dt && rand(o.seed, i, 6) < 0.4) {
          const [x, y] = trunk[i];
          ps.spawn(P.STAR, x, y, R.range(-6, 6), R.range(5, 16), cap(R.range(0.3, 0.5)), R.chance(0.5) ? C[5] : C[4], R.range(0.5, 0.9));
        }
      ps.update(dt);
      lights.update(dt);
    },
    drawBack(p) {
      // 焦痕：落点一小片烧热的地，冷成焦黑，最后抖掉
      if (struck >= 0) scorch(p, 0, 0, 7, heatAt(), 1 - smooth(1.05, 1.4, t), 7 * SY * 0.6);
      ps.draw(p, "back");
      snap(p);
    },
    draw(p) {
      const s = now(), f = Math.floor(t * 30 + 1e-4);
      // 先导：落雷前两帧，一道暗的细线从云底探下来
      if (t >= S1 - 0.07 && t < S1) trace(p, trunk, C[3], 1, 0, Math.ceil(trunk.length * clamp((t - (S1 - 0.07)) / 0.06)));
      const next = STROKES.find((q) => q.t > t);
      if (next && next !== STROKES[0] && t > next.t - 0.05) trace(p, bolts[1].paths[0].pts, C[3], 1);
      else if (s && s.k > 0) {
        const hero = s.a < 1 / 30;
        stroke(p, bolts[s.i], s.k, C, s.i === 0 ? 0.95 : 0.8, { hero, core: s.k > 0.6 && hero ? 0.9 : 0, light: 0.22 });
        const r = 3 * s.k;
        p.circle(0, -1, r + 1, C[5]);
        p.circle(0, -1, r * 0.65, WHITE);
        if (s.a < 0.07) sparkle(p, 0, -2, Math.round(6 * s.k * (1 - s.a / 0.07)), C[6], C[4], 0.25);
      } else if (s) {
        // 雷道冷下去；最后一次闪击之后从上往下碎掉
        const crumble = s.i === STROKES.length - 1, cool = clamp((s.a - 0.2) / 0.3), tr = bolts[s.i].paths[0].pts;
        for (let i = 0; i < tr.length - 1; i++) {
          if (crumble && t >= gone[i]) continue;
          const h = crumble ? 1 - clamp((t - S2 - 0.2) / (gone[i] - S2 - 0.2)) : 1 - cool;
          p.line(tr[i][0], tr[i][1], tr[i + 1][0], tr[i + 1][1], h > 0.7 ? C[5] : h > 0.4 ? C[4] : h > 0.15 ? C[3] : C[2]);
        }
      }
      // 每次闪击后，几道电弧贴着地面往外爬
      if (s && s.a < 0.26) {
        const r = rng(o.seed, 91, f), run = 16 * clamp(s.a / 0.2);
        for (let i = 0; i < 4; i++) {
          if (r.next() < 0.3) continue;
          const a = (i / 4) * Math.PI * 2 + 0.5, x0 = Math.cos(a) * Math.max(1, run - 7), y0 = Math.sin(a) * Math.max(1, run - 7) * SY, x1 = Math.cos(a) * run, y1 = Math.sin(a) * run * SY;
          crackle(p, zigzag(r, x0, y0 - 1, x1 + r.range(-1, 1), y1 - 1 - r.range(0, 2), 0.4, 0), 0.9 * (1 - s.a / 0.26) + 0.1, C, 0.2);
        }
      }
      cloud(p);
      ps.draw(p, "front");
      lights.draw(p);
      snap(p);
    },
  };
}
