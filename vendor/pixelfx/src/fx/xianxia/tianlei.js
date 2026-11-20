// 天雷符（修仙版）：改自 pixelfx 的 lightning/lightning-strike（MIT，https://github.com/patch-gg/pixelfx）。
// 原作的雷击过程（下行先导、三次闪击、雷道冷却碎落、地裂、焦痕）出自 Sprite Fusion 的开源闪电
// (https://www.spritefusion.com/pixel-art-vfx/lightning)，MIT License, Copyright (c) 2026 Hugo Duprez。
// 改了什么（封神幸存者，2026-11-10）：
// - 去掉地面的法阵圈（一圈虚线 + 十字刻度 + 内圈）：游戏里不要光圈和西式符文阵。换成一张立在地上的黄符：
//   朱砂符文自下而上逐行亮起（蓄雷），雷落的一刻符纸化作白光，散成火星和纸灰。
// - 蓄雷的静电改从符纸周围升起，不再沿着圆圈分布。
// - 辉光收小（大范围的光晕半径约减半、强度压低）。
// - 雷落前的「天色一暗」默认关掉：它是一块局部的暗椭圆，在浅色场地上像一团暗斑（选项 veil 可以打开，0..0.5）。
// - 新增选项 paper（符纸，暗 → 亮三色）、ink（符文，未亮 / 亮）、veil。
// - 收色（fx-wire，2026-11-11）：雷库 lightning/_lib 的焦黑、热色（地裂冷下去的暗红、橘、黄）和这里写死的尘、灰、石色
//   原来约三成不透明像素不在游戏调色板里；前后两层画完都用 snapper(GAME) 收进调色板（最接近的那一色：焦黑 → 玄、暗红 → 朱 / 殷、
//   热橘 → 橘、热黄 → 缃 / 灵光、灰紫的石块 → 苍 / 黛）。半透明的烟、尘不动（要和地面混）。
import { Particles, Lights, P, Rng, fit, sparkle, clamp, smooth, ease, rand, rng, WHITE, hex, mix } from "../../core/index.js";
import { VOLT, PLASMA, SOOT, SOOT2, zigzag, bend, stroke, crackle, trace, scorch, heat } from "../lightning/_lib.js";
import { GAME, snapper } from "./_lib.js";

export const meta = {
  name: "天雷符 Heaven-thunder talisman",
  desc: "A talisman in the ground lights its cinnabar script as thunder gathers; a bolt slams into it, the paper burns to embers and ash, arcs run along the cracks.",
  tags: ["lightning", "thunder", "talisman", "xianxia", "strike", "target", "impact", "ground", "one-shot"],
  size: [240, 264],
  origin: [120, 228],
  duration: 3,
  loop: false,
  fps: 30,
  bg: "ground",
  options: { palette: VOLT, sparks: PLASMA, paper: ["#b06a28", "#e0a83a", "#f7dc7a"], ink: ["#5c1a1b", "#d9452b"], veil: 0, seed: 5 },
};

const W = 120, TOP = -224, REACH = 52, LEAD0 = 0.48, STEPS = 9, MEET = -30;
const STROKES = [{ t: 0.76, k: 1 }, { t: 1.04, k: 0.8 }, { t: 1.26, k: 0.55 }];
const FLICK = [1, 0.72, 0.3, 0.95, 0.5, 0.8, 0.22];
const level = (a) => (a < 0 ? 0 : FLICK[Math.floor(a * 30 + 1e-4)] ?? 0);
const NIGHT = hex("#04030a"), DUST = hex("#6e6382"), ASH = hex("#5b5566"), STONE = ["#655b7a", "#4a4263", "#342d45"].map(hex);
const S1 = STROKES[0].t;

// the cracks the strike splits in the floor: Lichtenberg branches lying on the floor's face
function cracks(R) {
  const out = [];
  const grow = (x, y, a, len, w, d, depth) => {
    const pts = [[x, y, d]];
    for (let s = 0; s < len; s += 1.5) {
      a += R.range(-0.32, 0.32);
      x += Math.cos(a) * 1.5;
      y = clamp(y + Math.sin(a) * 0.45, 0, 5);
      d += 1.5;
      pts.push([x, y, d]);
      if (depth < 2 && s > 3 && R.chance(0.09)) grow(x, y, a + R.sign() * R.range(0.5, 1.2), (len - s) * R.range(0.3, 0.6), w * 0.6, d, depth + 1);
    }
    out.push({ pts, w });
  };
  for (let i = 0; i < 6; i++) grow(R.range(-1, 1), R.range(0, 1), i % 2 ? R.range(-0.5, 0.7) : Math.PI + R.range(-0.7, 0.5), REACH * R.range(0.55, 1), 1, 0, 0);
  return out;
}

// 黄符：5 × 11 像素的一张符纸立在地上（底边贴着 y = 0），左亮右暗。开头从上方落下插进土里；
// 朱砂符文随蓄雷自下而上逐行亮起，蓄满时闪成雷色；雷落的一刻整张符白一下，然后没了（火星纸灰在 update 里放）。
const PW = 5, PH = 11;
// 符文：竖笔贯穿，横笔、点交替（9 行，画在符纸第 1–9 行）
const GLYPH = ["..#..", ".###.", "..#..", ".#.#.", "..#..", "#####", "..#..", ".#.#.", "..#.."];
function talisman(p, t, k, PAPER, INK, C) {
  const burnt = t > S1 ? t - S1 : -1;
  if (burnt > 0.05) return;
  const land = 1 - ease.outCubic(clamp(t / 0.16)), y0 = -PH - Math.round(8 * land), a = clamp(t / 0.1);
  const sway = k > 0.45 && Math.sin(t * 23) > 0.2 ? 1 : 0; // 雷云压下来时，符纸上半截被风吹得一抖一抖
  const lit = Math.floor(k * 1.05 * GLYPH.length); // 自下而上亮了几行
  const flash = burnt >= 0;
  for (let row = 0; row < PH; row++) {
    const dx = row < 4 ? sway : 0;
    for (let col = 0; col < PW; col++) {
      const x = col - 2 + dx, y = y0 + row;
      let c = flash ? WHITE : col === 0 || row === 0 ? PAPER[2] : col === PW - 1 || row === PH - 1 ? PAPER[0] : PAPER[1];
      const g = row - 1;
      if (!flash && g >= 0 && g < GLYPH.length && GLYPH[g][col] === "#") {
        const on = GLYPH.length - 1 - g < lit;
        c = on ? (k > 0.85 && Math.sin(t * 40) > 0 ? C[6] : INK[1]) : INK[0];
      }
      p.dot(x, y, c, a);
    }
  }
  if (!flash && t > 0.16) {
    const pulse = 0.6 + 0.4 * Math.sin(t * (10 + 30 * k));
    p.glow(0, -6, 6 + 6 * k, C[5], (0.1 + 0.25 * k) * pulse);
  }
}

// keep forks on the canvas and above the floor
function keep(b) {
  const paths = [];
  for (const q of b.paths) {
    const pts = [];
    for (const pt of q.pts) {
      if (Math.abs(pt[0]) > W - 5 || pt[1] > -3 || pt[1] < TOP + 6) break;
      pts.push(pt);
    }
    if (q.w >= 1 || pts.length > 3) paths.push({ w: q.w, pts: q.w >= 1 ? q.pts : pts });
  }
  return { paths };
}

export function create(o) {
  const C = fit(o.palette, 8), R = new Rng(o.seed), floor = () => 0;
  const col = (c) => (typeof c === "number" ? c : hex(c));
  const PAPER = (o.paper ?? meta.options.paper).map(col), INK = (o.ink ?? meta.options.ink).map(col);
  const ps = new Particles({ rng: R, ground: floor, sparks: o.sparks }), hot = new Particles({ rng: R, ground: floor }), lights = new Lights();
  const X0 = R.range(8, 18) * (R.chance(0.5) ? 1 : -1);
  const main = keep(zigzag(R, X0, TOP, 0, -1, 0.17, 0.5)), trunk = main.paths[0].pts;
  const drift = (dx) => (x, y) => [x + dx * Math.sin((Math.PI * y) / TOP), y];
  const bolts = [main, bend({ paths: [{ pts: trunk, w: 1 }] }, drift(1.5)), bend({ paths: [{ pts: trunk, w: 1 }] }, drift(3))];
  const chan = (i) => bolts[i].paths[0].pts, last = STROKES[STROKES.length - 1], end = chan(STROKES.length - 1);
  const tree = cracks(R);
  const snap = snapper(GAME);
  // the spent channel breaks up from the top down, each piece at its own moment
  const gone = end.map(([, y], i) => last.t + 0.25 + 0.75 * (0.55 * rand(o.seed, i, 5) + 0.45 * (1 - y / TOP)));
  let t = 0, struck = -1;
  const now = () => {
    for (let i = STROKES.length - 1; i >= 0; i--) if (t >= STROKES[i].t) return { i, s: STROKES[i], a: t - STROKES[i].t, k: level(t - STROKES[i].t) * STROKES[i].k };
    return null;
  };
  const charge = () => clamp(t / S1) ** 1.5;
  const heatAt = () => (struck < 0 ? 0 : Math.max(...STROKES.slice(0, struck + 1).map((s) => s.k * Math.pow(clamp(1 - (t - s.t) / 1.6), 1.4))));

  return {
    update(dt) {
      t += dt;
      for (const [i, s] of STROKES.entries()) {
        if (struck >= i || t < s.t) continue;
        struck = i;
        const k = s.k;
        lights.add(0, -50, 60, C[4], 0.45 * k, 0.35);
        if (i === 0) {
          for (let j = 0; j < 10; j++) hot.spawn(P.EMBER, R.range(-2, 2), -R.range(2, PH), R.range(-20, 20), -R.range(20, 60), R.range(0.6, 1.2));
          for (let j = 0; j < 8; j++) ps.spawn(P.MOTE, R.range(-2, 2), -R.range(2, PH), R.range(-14, 14), R.range(-10, 6), R.range(0.5, 0.9), R.pick(PAPER), R.range(0.5, 0.9));
        }
        lights.add(0, -3, 24, WHITE, 0.5 * k, 0.1);
        for (let j = 0; j < Math.round(44 * k); j++) {
          const a = -Math.PI / 2 + R.range(-1.3, 1.3), sp = R.range(110, 320) * (0.65 + 0.35 * k);
          ps.spawn(P.SPARK, R.range(-1.5, 1.5), -2, Math.cos(a) * sp, Math.sin(a) * sp, R.range(0.2, 0.55));
        }
        for (let j = 0; j < Math.round(12 * k); j++) {
          const a = -Math.PI / 2 + R.range(-1.2, 1.2), sp = R.range(70, 220);
          hot.spawn(P.SPARK, R.range(-2, 2), -1, Math.cos(a) * sp, Math.sin(a) * sp, R.range(0.5, 1));
        }
        for (let j = 0; j < Math.round(5 * k); j++) hot.spawn(P.EMBER, R.range(-4, 4), -2, R.range(-25, 25), -R.range(30, 80), R.range(0.8, 1.5));
        for (let j = 0; j < Math.round(18 * k); j++) {
          const a = -Math.PI / 2 + R.range(-1.1, 1.1), sp = R.range(50, 190);
          ps.spawn(P.GRIT, R.range(-3, 3), -1, Math.cos(a) * sp, Math.sin(a) * sp, R.range(1, 1.5), R.pick(STONE), R.chance(0.35) ? 2 : 1);
        }
        for (let j = 0; j < 8; j++) ps.spawn(P.DUST, R.range(-3, 3), -1, R.sign() * R.range(30, 110), -R.range(4, 24), R.range(0.4, 0.8), DUST, R.range(1.5, 3));
        for (let j = 0; j < Math.round(4 * k); j++) ps.spawn(P.SMOKE, R.range(-8, 8), -4, R.range(-10, 10), -R.range(10, 25), R.range(1.1, 1.6), mix(ASH, C[2], 0.3), R.range(3, 6), R.range(0.05, 0.25));
      }
      if (struck >= 0 && t < 1.7 && R.chance(6 * dt)) ps.spawn(P.SMOKE, R.range(-8, 8), -2, R.range(-4, 4), -R.range(9, 17), R.range(1, 1.3), 0, R.range(2, 3.5));
      for (let i = 0; i < gone.length - 1; i++)
        if (gone[i] <= t && gone[i] > t - dt && rand(o.seed, i, 6) < 0.5) {
          const [x, y] = end[i];
          ps.spawn(P.MOTE, x, y, R.range(-8, 8), R.range(6, 22), R.range(0.4, 0.8), R.chance(0.5) ? C[5] : C[4], R.range(0.5, 0.9));
        }
      ps.update(dt);
      hot.update(dt);
      lights.update(dt);
    },
    drawBack(p) {
      // the scene darkens a beat before the strike: a soft veil, deepest round the bolt's path, gone at the flash
      const dark = (o.veil ?? 0) * smooth(0.46, 0.66, t) * (1 - smooth(S1 - 0.01, S1 + 0.02, t));
      if (dark > 0.01)
        for (let y = -228; y < 36; y++)
          for (let x = -W; x < W; x++) {
            const d = Math.hypot(x / W, (y + 96) / 132), a = dark * (1 - smooth(0.55, 1, d));
            if (a > 0.01) p.blend(x + 0.5, y + 0.5, NIGHT, a);
          }
      if (t < S1) for (let x = -2; x <= 2; x++) p.blend(x + 0.5, 0.5, NIGHT, 0.3 * clamp(t / 0.16));
      // the cracks: arcs race out along them white, they glow with heat, cool to soot and fade
      if (struck >= 0) {
        const s = now(), front = REACH * ease.outCubic(clamp((t - S1) / 0.35)), T0 = heatAt(), fade = 1 - smooth(2.3, 2.95, t);
        const elec = s.a < 0.14 ? s.s.k * (1 - s.a / 0.14) : 0;
        for (const br of tree)
          for (const [x, y, d] of br.pts) {
            if (d > front) break;
            const q = d / REACH, n = rand(Math.round(x * 2), Math.round(y * 2), 9), fresh = d > front - 6 && front < REACH;
            const T = T0 * (1.15 - q) * (br.w < 1 ? 0.8 : 1) - n * 0.25, c = fresh || (elec > 0.3 && n < 0.85) ? (q < 0.5 ? WHITE : C[6]) : heat(T) || SOOT2;
            p.dot(x, y + 1, SOOT, fade);
            p.dot(x, y, c, fade);
            if (br.w >= 1 && d < 9) p.dot(x, y + 2, SOOT, fade);
            if ((fresh || elec > 0.3) && (Math.round(d) & 3) === 0) p.glow(x, y, 7, C[5], 0.4);
            else if (T > 0.2 && (Math.round(d) & 3) === 0) p.glow(x, y, 5, c, 0.2 * T);
          }
        scorch(p, 0, 0, 12, T0, fade);
        if (T0 > 0) p.glow(0, -2, 20, heat(0.55), 0.25 * T0);
      }
      ps.draw(p, "back");
      hot.draw(p, "back");
      snap(p);
    },
    draw(p) {
      const s = now(), f = Math.floor(t * 30 + 1e-4), k = charge();
      talisman(p, t, k, PAPER, INK, C);
      // 蓄雷的静电从符纸周围升起，越来越密
      if (t > 0.15 && t < S1) {
        const r = rng(o.seed, 61, f);
        for (let i = 0; i < Math.round(1 + 3 * k); i++) {
          const x = r.range(-6, 6), y = -r.range(1, PH) * r.range(0.4, 1);
          crackle(p, zigzag(r, x, y, x + r.range(-2.5, 2.5), y - r.range(4, 9) * (0.6 + k), 0.45, 0.3), 0.45 + 0.4 * k, C, 0.3);
        }
        p.glow(0, -6, 16, C[4], 0.06 + 0.16 * k);
      }
      // the stepped leader feels down from above; a streamer climbs off the talisman's top to meet it
      if (t >= LEAD0 && t < S1) {
        const u = clamp((t - LEAD0) / (S1 - LEAD0)), st = Math.min(STEPS, Math.floor(u * STEPS) + 1), fresh = 1 - ((u * STEPS) % 1);
        const reach = TOP + (MEET - TOP) * Math.pow(st / STEPS, 1.2), prev = TOP + (MEET - TOP) * Math.pow((st - 1) / STEPS, 1.2);
        for (const q of main.paths) {
          const tk = q.w >= 1;
          for (let i = 0; i < q.pts.length - 1; i++) {
            const [ax, ay] = q.pts[i], [bx, by] = q.pts[i + 1];
            if (by > reach) {
              if (ay <= reach && i > 0) (p.px(ax, ay, WHITE), p.glow(ax, ay, 7, C[5], 0.5 * fresh + 0.15));
              break;
            }
            const young = by > prev;
            p.line(ax, ay, bx, by, young ? (fresh > 0.4 ? (tk ? C[6] : C[5]) : C[4]) : tk ? C[3] : C[2]);
            if (i % 4 === 0 && ay > TOP + 14) p.glow(ax, ay, young ? 8 : 5, C[4], young ? 0.3 * fresh + 0.1 : 0.12);
          }
        }
        if (t > 0.62) {
          const h = (-MEET - PH) * ease.outQuad((t - 0.62) / (S1 - 0.62)), r = rng(o.seed, 77, f);
          const b = zigzag(r, 0, -PH, r.range(-2, 2), -PH - Math.max(3, h), 0.3, 0.3), tip = b.paths[0].pts.at(-1);
          crackle(p, b, 0.85, C, 0.45);
          p.px(tip[0], tip[1], WHITE);
          p.glow(tip[0], tip[1], 9, C[5], 0.5);
        }
      }
      // the strokes, the dart that runs down the channel before each flicker, the channel cooling and crumbling
      const next = STROKES.find((q) => q.t > t);
      if (next && next !== STROKES[0] && t > next.t - 0.06) {
        const tr = chan(STROKES.indexOf(next)), u = (t - (next.t - 0.06)) / 0.06, i1 = Math.floor(u * tr.length);
        trace(p, tr, C[3], 1);
        trace(p, tr, C[6], 1, i1 - 18, i1);
        for (let i = Math.max(0, i1 - 18); i < Math.min(tr.length, i1); i += 4) if (tr[i][1] > TOP + 14) p.glow(tr[i][0], tr[i][1], 9, C[4], 0.35);
      } else if (s && s.k > 0) {
        const hero = s.i === 0 && s.a < 1 / 30;
        stroke(p, bolts[s.i], s.k, C, s.i === 0 ? 1.5 : 1.2, { hero, core: s.k > 0.6 ? (hero ? 1.2 : 0.8) : 0, minY: TOP + 14 });
        const r = 4.5 * s.k;
        p.circle(0, -1, r + 1.5, C[2]);
        p.circle(0, -1, r + 0.5, C[5]);
        p.circle(0, -1, r * 0.65, WHITE);
        if (s.a < 0.07) sparkle(p, 0, -2, Math.round(12 * s.k * (1 - s.a / 0.07)), C[6], C[4], 0.25);
        p.glow(0, -16, 48, C[3], 0.3 * s.k);
        p.glow(0, -3, 22, C[5], 0.3 * s.k);
        if (hero) p.glow(X0 * 0.5, -110, 80, C[3], 0.2);
      } else if (s) {
        const crumble = s.i === STROKES.length - 1, cool = clamp((s.a - 0.23) / 0.45), tr = chan(s.i);
        for (let i = 0; i < tr.length - 1; i++) {
          if (crumble && t >= gone[i]) continue;
          const h = crumble ? 1 - clamp((t - last.t - 0.23) / (gone[i] - last.t - 0.23)) : 1 - cool;
          p.line(tr[i][0], tr[i][1], tr[i + 1][0], tr[i + 1][1], h > 0.7 ? C[5] : h > 0.4 ? C[4] : h > 0.15 ? C[3] : C[2]);
          if (i % 6 === 0 && h > 0.3 && tr[i][1] > TOP + 14) p.glow(tr[i][0], tr[i][1], 6, C[4], 0.15 * h);
        }
      }
      // arcs crawl out along the cracks as they split, and again with every flicker
      if (s && s.a < 0.4) {
        const r = rng(o.seed, 91, f), run = s.i === 0 ? REACH * ease.outCubic(clamp(s.a / 0.35)) : REACH * clamp(s.a / 0.22);
        for (const br of tree) {
          if (br.w < 1 || r.next() < 0.3) continue;
          const i1 = br.pts.findIndex(([, , d]) => d > run), j1 = i1 < 0 ? br.pts.length : i1, j0 = Math.max(0, j1 - r.int(7, 13));
          const pts = br.pts.slice(j0, j1).map(([x, y]) => [x + r.range(-0.6, 0.6), y - 1.5 - r.range(0, 2.5)]);
          if (pts.length > 1) crackle(p, { paths: [{ pts, w: 1 }] }, 0.9 * (1 - s.a / 0.4) + 0.1, C, 0.35);
        }
      }
      ps.draw(p, "front");
      hot.draw(p, "front");
      lights.draw(p);
      snap(p);
    },
  };
}
