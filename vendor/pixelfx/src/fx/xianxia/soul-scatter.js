// 魂散（修仙版）：改自 pixelfx 的 spawn/soul-rise（MIT，https://github.com/patch-gg/pixelfx）。
// 原作那个淡色的身形和它洒落的光点参照了 Sprite Fusion 的开源 movement 与 heal
// (https://www.spritefusion.com/pixel-art-vfx/movement)，MIT License, Copyright (c) 2026 Hugo Duprez。
// 改了什么（封神幸存者，2026-11-10）：
// - 用途换了：原作是「身体留在原地、魂升天」，3.2 秒。游戏里敌人一死精灵就撤掉，所以这里是整个身形化成一缕天青的灵气散掉：
//   先白一下（两帧），变成半透明的魂影往上飘、拉长、下半截化成一缕摆动的细烟，再从脚往头顶淡掉（真半透明的软分界，不抖动），
//   散开的地方冒出几团很淡的灵气、几缕弯曲的细烟和单像素的光点往上飘。总长 1.4 秒。
// - 光点不用库的 MOTE（它拖着一截压暗的尾巴，收进色阶以后是一粒粒深靛色的脏点），只用单像素的星。
// - 去掉魂离体时地面上那一圈光环，去掉脚下那一汪光和两盏大灯（半径 24–50），身形上只留一团很淡的小光。
// - 飘起的高度从 50 像素改成 22（选项 height）：人物只有 16–24 像素高。
// - 颜色：魂影用色阶里偏深的两档打底、亮的两档勾边，浅色的仙台地面上也看得清；全部收进色阶。
// - 不带角色动作（act）：游戏有自己的人物。要传 o.actor（敌人这一帧的剪影和颜色）；不传就用库里的假人。
import { Particles, Lights, P, Rng, fit, clamp, smooth, ease, rand, WHITE, luma } from "../../core/index.js";
import { bodyOf, rimOf } from "../spawn/_lib.js";
import { gp, snapper } from "./_lib.js";

export const meta = {
  name: "魂散 Soul scatter",
  desc: "A slain echo: the body flashes white, turns to a teal shade that lifts and stretches, its legs unravelling into a wisp, then thins from the feet up into curling strands and motes.",
  tags: ["spawn", "death", "soul", "ghost", "spirit", "wisp", "xianxia", "one-shot"],
  size: [72, 88],
  origin: [36, 76],
  duration: 1.4,
  loop: false,
  fps: 30,
  bg: "ground",
  actor: 2,
  options: { palette: gp("NnccCCw"), height: 22, seed: 27 },
};

const LEAVE = 0.07, TOP = 0.85, GONE = 1.05;

export function create(o) {
  const C = fit(o.palette, 7), R = new Rng(o.seed);
  // Hh 取剪影最下面一行（精灵帧下面可能留着空行，按帧高算的话腿和那缕烟之间会断开一截）
  const body = bodyOf(o.actor, C), rim = rimOf(body), W = body.w, Hh = body.list.reduce((m, b) => Math.max(m, b.my + 1), 1), waist = Math.round(Hh * 0.6);
  const snap = snapper(C);
  // 魂影是身体自己的样子换成灵气的颜色：每个像素按原来的明暗取色阶里的一档，轮廓取最亮的一档
  const tone = body.list.map((b) => (b.edge ? 6 : 2 + Math.min(2, Math.floor(luma(b.c) * 3.4))));
  const toneAt = new Int8Array(W * Hh).fill(-1);
  body.list.forEach((b, i) => (toneAt[b.my * W + b.mx] = tone[i]));
  const ps = new Particles({ rng: R, sparks: [WHITE, C[6], C[5], C[3]] }), lights = new Lights();
  // 几缕灵气：散的时候从身形里抽出来，弯弯曲曲地往上走（云气的样子，不是直线）
  const wisps = Array.from({ length: 4 }, (_, i) => ({
    t0: 0.5 + i * 0.1 + R.range(0, 0.05), life: R.range(0.5, 0.62), x: R.range(-0.3, 0.3) * W, y: R.range(0.25, 0.7), vy: -R.range(26, 38), amp: R.range(1.6, 2.8) * (i % 2 ? 1 : -1), w: R.range(7, 10), ph: R.range(0, 6.28), len: R.int(7, 10),
  }));
  let t = 0, left = false;

  const lift = () => o.height * ease.inOutSine(clamp((t - LEAVE) / (TOP - LEAVE)));
  const stretch = () => 1 + 0.22 * ease.inOutSine(clamp((t - LEAVE) / (TOP - LEAVE)));
  const sway = (row) => Math.sin(t * 5 - row * 0.16) * 1.8 * smooth(LEAVE, LEAVE + 0.3, t);
  const melt = () => smooth(LEAVE + 0.05, LEAVE + 0.5, t);
  const thin = () => smooth(0.5, GONE, t); // 升到一半就开始从下往上散

  return {
    update(dt) {
      t += dt;
      if (!left && t >= LEAVE) {
        left = true;
        lights.add(0, body.y * 0.5, 12, C[5], 0.5, 0.3);
        for (let i = 0; i < 6; i++) {
          const c = R.pick(rim);
          ps.spawn(P.STAR, c.x, c.y, R.range(-16, 16), -R.range(14, 40), R.range(0.35, 0.6), R.pick([C[6], C[5]]), R.range(0.6, 0.95));
        }
      }
      // 上升时边上掉光点，散的时候成片地洒
      if (t > LEAVE && t < GONE) {
        const s = stretch(), y0 = body.y * s - lift(), th = thin();
        for (let n = 0; n < (th > 0 ? 2 : 1); n++) {
          if (!R.chance(th > 0 ? 0.75 : 0.4)) continue;
          const c = R.pick(rim), row = c.my;
          if (row / Hh < 1 - th * 1.1 - 0.05 && th > 0) continue;
          const x = c.x * (1 - 0.12 * (s - 1) * 4) + sway(row), y = y0 + c.my * s;
          // 不留到特效结束之后，也不飘出画布顶
          const life = Math.min(R.range(0.35, 0.7), meta.duration - 0.08 - t, (y + meta.origin[1] - 4) / 45);
          // 光点只用单像素的星（STAR 小于 1 号）：库的 MOTE 拖着一截压暗的尾巴，收进色阶以后是一粒粒深靛色的脏点
          if (life > 0.1) ps.spawn(P.STAR, x, y, R.range(-10, 10), -R.range(18, 42), life, R.pick([C[6], C[5], C[5], C[4]]), R.range(0.5, 0.95));
        }
        // 散开的地方冒出几团很淡的灵气（真半透明的软团），慢慢往上飘、胀开、变淡
        if (th > 0.05 && th < 0.9 && R.chance(0.3)) {
          const c = R.pick(body.list), x = c.x * (1 - 0.12 * (s - 1) * 4) + sway(c.my), y = y0 + c.my * s;
          const life = Math.min(R.range(0.45, 0.7), meta.duration - 0.06 - t);
          if (life > 0.15) ps.spawn(P.VAPOUR, x, y, R.range(-5, 5), -R.range(10, 22), life, R.pick([C[5], C[5], C[6]]), R.range(1.8, 3));
        }
      }
      ps.update(dt);
      lights.update(dt);
    },
    draw(p) {
      if (t < LEAVE) {
        // 白的那两帧：整个身形一亮，轮廓外面一圈灵气色
        for (const b of body.list) p.px(b.x, b.y, b.edge ? C[6] : WHITE);
        for (const c of rim) p.px(c.x, c.y, C[4]);
      } else if (t <= GONE + 0.05) {
        // 魂影：从屏幕这边倒着取样（拉长了也不会出洞）；里面半透明，轮廓实
        const s = stretch(), L = lift(), m = melt(), th = thin(), top = body.y * s - L, sx = 1 - 0.12 * (s - 1) * 4;
        const tail = Math.round(12 * m), y1 = top + (Hh + tail) * s, young = t < LEAVE + 0.07;
        for (let y = Math.floor(top); y <= Math.ceil(y1); y++) {
          const my = Math.floor((y + 0.5 - top) / s);
          if (my < 0) continue;
          // 腰以下往一条摆动的中线收：两条腿化成一缕烟
          const k = my >= waist ? (my - waist + 1) / (Hh - waist + tail) : 0, narrow = 1 - k * m * 0.95;
          if (narrow <= 0.05) continue;
          const cx = sway(my) + Math.sin(my * 0.7 - t * 9) * 1.8 * k * m, a = my >= waist ? 1 - k * 0.45 : 1;
          for (let x = Math.floor(cx - W / 2 - 4); x <= Math.ceil(cx + W / 2 + 4); x++) {
            const mx = Math.floor((x + 0.5 - cx) / (sx * narrow) - body.x);
            // 散的时候下面的行先淡：一条软的分界从脚往头顶推（真半透明，不用抖动，免得散成一片零星的像素）
            const fade = th > 0 ? clamp((1 - th * 1.3 + 0.12 - my / (Hh + tail)) / 0.3) * (1 - 0.45 * th) : 1;
            if (fade <= 0.04) continue;
            let ti;
            if (my < Hh) {
              if (mx < 0 || mx >= W) continue;
              ti = toneAt[my * W + mx];
              if (ti < 0) continue;
            } else {
              // 脚下面的那缕烟：越往下越细
              const w = (1 - (my - Hh) / Math.max(1, tail)) * 2.6 * m, d = Math.abs(x + 0.5 - cx);
              if (d > w) continue;
              ti = d > w - 1 ? 5 : 4;
            }
            if (young) p.px(x, y, ti >= 6 ? WHITE : C[5]);
            else if (ti >= 5) {
              const ea = Math.min(1, a * 1.3) * fade;
              if (ea > 0.7) p.px(x, y, ti >= 6 ? C[6] : C[5]);
              else p.blend(x, y, ti >= 6 ? C[6] : C[5], ea * 1.1);
            } else p.blend(x, y, C[ti], a * 0.82 * fade);
          }
        }
        const cy = top + Hh * s * 0.45;
        p.glow(sway(10), cy, 8, C[5], 0.2 * (1 - th));
      }
      for (const w of wisps) {
        const age = t - w.t0;
        if (age <= 0 || age >= w.life) continue;
        const k = 1 - age / w.life, y0 = body.y * (1 - w.y) - o.height * 0.75;
        for (let j = 0; j < w.len; j++) {
          const a = age - j * 0.028;
          if (a < 0) break;
          const x = w.x + w.amp * Math.sin(a * w.w + w.ph) * Math.min(1, a * 5), y = y0 + w.vy * a - 4 * a * a;
          p.blend(x, y, j < 2 ? C[6] : j < 5 ? C[5] : C[4], Math.min(1, k * (1.5 - j / w.len)));
        }
      }
      ps.draw(p);
      lights.draw(p);
      snap(p);
    },
  };
}

/** 假人从头到尾都不画：身形由特效自己画（游戏里敌人一死精灵就撤掉了）。 */
export const actorAlpha = () => 0;
