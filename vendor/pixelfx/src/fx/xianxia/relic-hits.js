// 灵物打中时的几样画面（修仙版，新做；封神幸存者 2026-11-12，用户：「照妖镜等特效都太廉价了」）。
// 原来这几处是一像素的小尘、一道 24 像素高的小雷精灵、一团桃红的雷纹（看着像一团粉色的光），廉价在：单色、一两个像素、没有过程。
//   storm  风雷羽：那只头顶浮出一枚紫翎（白的翎管），一道紫白的雷从翎尖劈到它胸口（两帧劈下、闪两下、松开），
//          胸口一小团细电弧和几粒会拐弯的电火花；紫翎被雷震得打着旋飘落、淡掉。0.9 秒。
//   jade   九龙玉佩：一缕玉色的龙气从它身上盘旋着升起（龙首亮、身子一节一节，尾巴慢慢散成玉屑），0.9 秒。
//          相生的五行色的碎屑另由 relic-fx.ts 放（随相生的种类变）。
//   zhuo   金刚琢砸中：一点金白的星芒，四五块石屑崩起落地、一小团尘，几粒金屑上飘。0.7 秒。
// 选项 height = 胸口离脚多高。颜色都收进调色板。
import { Particles, Bits, Lights, P, B, Rng, clamp, sparkle, rand, TAU, WHITE, hex } from "../../core/index.js";
import { zigzag, stroke, crackle } from "../lightning/_lib.js";
import { gp, snapper, GAME } from "./_lib.js";

export const meta = {
  name: "灵物命中 Relic hits",
  desc: "Relic hits: a violet feather above the foe calls down a small bolt and drifts away; a jade dragon wisp coils up out of the foe; a golden bangle lands with grit and dust.",
  tags: ["relic", "lightning", "feather", "dragon", "jade", "impact", "xianxia", "one-shot"],
  size: [64, 80],
  origin: [32, 64],
  duration: 0.95,
  loop: false,
  fps: 30,
  bg: "ground",
  options: { kind: "storm", height: 11, seed: 4 },
};

const VIOLET = gp("PPppmwWW").map(hex); // stroke / crackle 取 2 晕、4 身、5、7 芯
const JADE = gp("GvlLfW").map(hex);
const GOLD = gp("BbyYfW").map(hex);
const STONE = gp("ghij").map(hex);
const FEATHER = ["..W..", ".pWm.", "pPWmm", "pPWmm", "PpWm.", ".PWm.", "..W..", "..P.."];
const FPAL = { P: "#4b2a4f", p: "#8a4a7a", m: "#d47aa0", W: "#f2e8d5" };

export function create(o) {
  const R = new Rng(o.seed), H = -o.height, K = o.kind, snap = snapper(GAME);
  const floor = () => 0;
  const ps = new Particles({ rng: R, ground: floor, sparks: K === "storm" ? [WHITE, VIOLET[5], VIOLET[4], VIOLET[2]] : [WHITE, GOLD[4], GOLD[3], GOLD[1]] });
  const bits = new Bits({ ground: floor });
  const lights = new Lights();
  let t = 0, struck = false;
  const FY = H - 15; // 紫翎浮在头顶上面一点
  // 雷劈下来的那一刻（紫翎先浮出来 0.12 秒）
  const STRIKE = 0.12;
  const kinked = K === "storm" ? Array.from({ length: 6 }, () => {
    const a = R.range(0, TAU), sp = R.range(50, 90);
    return { x: 0, y: H, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20, life: R.range(0.18, 0.32), age: -STRIKE, next: R.range(0.02, 0.05), trail: [] };
  }) : [];
  // 九龙玉佩：龙气的路径（螺旋上升），龙首走过 0..1
  const coil = (u) => {
    const r = 4 + u * 5, a = u * TAU * 1.3 + 0.6;
    return [Math.cos(a) * r, H + 3 - u * 19 + Math.sin(a) * r * 0.35, Math.sin(a)];
  };
  if (K === "zhuo") {
    lights.add(0, H + 3, 8, GOLD[3], 0.4, 0.2);
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + R.range(-1.2, 1.2), v = R.range(30, 55);
      bits.add({ kind: B.CHUNK, x: R.range(-2, 2), y: -1, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 0.7, drag: 0.6, bounce: 0.3, life: R.range(0.45, 0.6), a: R.range(0, TAU), va: R.range(-16, 16), s: R.range(1.1, 1.6), ramp: gp("ghij") });
    }
    for (let i = 0; i < 3; i++) ps.spawn(P.DUST, R.range(-4, 4), 0, R.range(-14, 14), -R.range(2, 6), R.range(0.45, 0.65), STONE[3], R.range(2, 2.8), R.range(0, 0.05));
    for (let i = 0; i < 4; i++) ps.spawn(P.STAR, R.range(-4, 4), H + R.range(-2, 4), R.range(-6, 6), -R.range(10, 20), R.range(0.35, 0.55), GOLD[R.int(3, 4)], R.range(0.6, 0.9), R.range(0.04, 0.12));
  }
  return {
    update(dt) {
      t += dt;
      if (K === "storm" && !struck && t >= STRIKE) {
        struck = true;
        lights.add(0, H, 9, VIOLET[4], 0.45, 0.25);
      }
      for (const s of kinked) {
        if ((s.age += dt) < 0 || s.age >= s.life) continue;
        if ((s.next -= dt) <= 0) {
          s.next = R.range(0.03, 0.06);
          const sp = Math.hypot(s.vx, s.vy), a = Math.atan2(s.vy, s.vx) + R.sign() * R.range(0.6, 1.3);
          s.vx = Math.cos(a) * sp;
          s.vy = Math.sin(a) * sp;
          s.trail.push([s.x, s.y]);
          if (s.trail.length > 3) s.trail.shift();
        }
        s.vx -= s.vx * 3 * dt;
        s.vy -= s.vy * 3 * dt - 90 * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
      }
      ps.update(dt);
      bits.update(dt);
      lights.update(dt);
    },
    draw(p) {
      if (K === "storm") {
        // 紫翎：浮出来（0.1 秒），雷劈下后打着旋往一边飘落、淡掉
        const ft = t;
        const fa = clamp(ft / 0.1) * (1 - clamp((ft - 0.55) / 0.35));
        if (fa > 0) {
          const k = clamp((ft - STRIKE) / 0.75);
          const x = Math.round(-2 + Math.sin(k * 7) * 3 * k + k * 8), y = Math.round(FY - 3 + k * 14);
          p.sprite(FEATHER, FPAL, x, y, { a: fa, flip: Math.sin(k * 7) < 0 && k > 0 });
        }
        // 雷：两帧劈下、闪两下、松开
        if (t >= STRIKE - 0.05 && t < STRIKE + 0.24) {
          const f = Math.floor(t * 30 + 1e-4), r = new Rng(o.seed * 17 + (t < STRIKE + 0.1 ? 0 : f)), b = zigzag(r, 0, FY + 4, 0, H, 0.35, 0.3);
          const u = clamp((t - STRIKE + 0.05) / 0.05), k = t < STRIKE + 0.06 ? 1 : t < STRIKE + 0.14 ? (f % 2 ? 0.6 : 1) : 0.5 * (1 - (t - STRIKE - 0.14) / 0.1);
          stroke(p, u < 1 ? { paths: [b.paths[0]] } : b, k, VIOLET, 0.75, { upTo: u, hero: t >= STRIKE && t < STRIKE + 0.04, light: 0.2 });
        }
        // 胸口的细电弧
        if (t >= STRIKE && t < STRIKE + 0.3) {
          const f = Math.floor(t * 30 + 1e-4), r = new Rng(o.seed * 7 + f), a = 1 - (t - STRIKE) / 0.3;
          for (let i = 0; i < 2; i++) {
            const a0 = r.range(0, TAU), a1 = a0 + r.range(1, 2), rr = r.range(3, 5);
            crackle(p, zigzag(r, Math.cos(a0) * rr, H + Math.sin(a0) * rr, Math.cos(a1) * rr, H + Math.sin(a1) * rr, 0.45, 0), Math.min(0.44, a), VIOLET, 0.06);
          }
          if (t < STRIKE + 0.08) sparkle(p, 0, H, 2, VIOLET[5], VIOLET[4], 0.2);
        }
        for (const s of kinked) {
          if (s.age < 0 || s.age >= s.life) continue;
          const k = 1 - s.age / s.life, path = [...s.trail, [s.x, s.y]];
          for (let i = 0; i < path.length - 1; i++) p.line(path[i][0], path[i][1], path[i + 1][0], path[i + 1][1], k > 0.5 ? VIOLET[5] : VIOLET[4]);
          p.px(s.x, s.y, k > 0.4 ? WHITE : VIOLET[5]);
        }
      }
      if (K === "jade") {
        // 龙气：龙首沿螺旋往上走（0.55 秒），身子拖在后面约三成，尾巴从后往前散；龙首两粒白的眼、一缕须
        const head = 1 - Math.pow(1 - clamp(t / 0.6), 2), len = 0.38, tailCut = clamp((t - 0.45) / 0.4);
        const from = Math.max(0, head - len) + tailCut * len, n = 22;
        for (let i = 0; i <= n; i++) {
          const u = from + ((head - from) * i) / n;
          if (head - from <= 0.01) break;
          const [x, y, z] = coil(u), w = i / n; // w：0 尾巴 → 1 龙首
          const back = z < 0; // 转到后面的那一段暗一点
          p.px(x, y + 1, JADE[back ? 1 : 2]);
          p.px(x, y + 2, JADE[0], back ? 0.5 : 0.8);
          p.px(x, y, w > 0.85 ? JADE[4] : back ? JADE[2] : JADE[3]);
          if (w > 0.4 && w < 0.85 && (i & 1) === 0) p.px(x + 1, y, JADE[back ? 1 : 2]); // 背鳍：隔节一点
        }
        if (head - from > 0.02 && t < 0.85) {
          const [hx, hy] = coil(head);
          p.px(hx, hy - 1, JADE[3]);
          p.px(hx + 1, hy, JADE[3]);
          p.px(hx, hy, WHITE);
          p.px(hx - 1, hy - 1, JADE[2]); // 须
          p.px(hx - 2, hy - 2, JADE[2], 0.7);
        }
        // 散掉的地方落几粒玉屑（确定的：按时间和种子）
        if (t > 0.45)
          for (let i = 0; i < 6; i++) {
            const u0 = rand(o.seed, i) * 0.6 + 0.1, born = 0.45 + i * 0.05, age = t - born;
            if (age < 0 || age > 0.4) continue;
            const [x, y] = coil(u0);
            p.px(x + Math.sin(i + age * 6) * 2, y + age * 10, age < 0.2 ? JADE[4] : JADE[2], 1 - age / 0.4);
          }
      }
      if (K === "zhuo" && t < 0.1) sparkle(p, 0, H + 3, t < 0.05 ? 3 : 2, GOLD[4], GOLD[3], 0.2);
      bits.draw(p);
      ps.draw(p);
      lights.draw(p);
      snap(p);
    },
  };
}
