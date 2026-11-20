// 风火轮的火痕（一处）：封神幸存者 2026-11-12 新做，参照 pixelfx 的 status/burning、fire/campfire 的做法（MIT，https://github.com/patch-gg/pixelfx）。
// 火舌的画法（tongue）、余烬（ember）、细烟（smoke）来自库里 status/_lib.js（改编自 Sprite Fusion 的开源 fire，
// https://www.spritefusion.com/pixel-art-vfx/fire，MIT License, Copyright (c) 2026 Hugo Duprez）。
//
// 用户 2026-11-12：「风火轮特效太丑了」「这些特效都不能廉价」——原来的火痕是两道连着的火辙、辙里一排火苗。
// 现在火痕由一处一处的「余火」断续地连成：游戏每走过十来个像素在地上放一处，前后错开、偶尔空一处。
// 一处的过程（3.4 秒，和模拟里火痕的寿命一样长）：
//   起势 0–0.25 秒：地上先烫出一点红，一小簇火舌从地里窜起（两三像素宽、四五像素高，往身后歪）；
//   主体 0.25–1.4 秒：火舌越烧越矮、一跳一跳，地上的炭由橘转朱；两三粒火星被风卷着往身后、往上飘；
//   余韵 1.4–3.4 秒：火舌没了，炭由朱转殷、一粒粒暗下去，一缕很淡的烟往身后斜着散，地上的暖光慢慢收。
// 颜色只用朱砂 → 殷红一路（橘只在火舌芯、火星新的时候），不出亮黄一片；地上的暖光很小（半径 5）、很淡。
// 方向：风朝 -x 吹（火舌、火星、烟都往左后方），人物往左走时游戏 flip。
import { hex, mix, rand, clamp } from "../../core/index.js";
import { tnoise, travel, tongue, smoke, ember } from "../status/_lib.js";
import { gp, rim, snapOf } from "./_lib.js";

export const meta = {
  name: "风火轮火痕 Wheel ember",
  desc: "One patch of a fire-wheel trail: a lick of flame leaps up leaning back and flickers out, embers ride the wind back, the coal cools to dark red, a faint wisp drifts off.",
  tags: ["fire", "ember", "trail", "ground", "xianxia"],
  size: [30, 24],
  origin: [19, 18],
  duration: 3.4,
  loop: false,
  fps: 30,
  bg: "ground",
  options: { palette: gp("kRreoy"), smoke: gp("h")[0], seed: 1, height: 7.5 },
};

const D = meta.duration;
const RISE = 0.25, FADE = 1.9;
const ease = (u) => 1 - Math.pow(1 - clamp(u, 0, 1), 3);
// 火舌的几层（宽、高、色阶第几档：0 最亮）：外沿朱、身朱砂、芯橘；不要白芯、不要缃
const LAYERS = [[1, 1, 6], [0.72, 0.82, 4], [0.42, 0.56, 2]];

export function draw(p, t, o) {
  if (t >= D) return;
  const F = gp("kRreoy").map(hex).reverse(); // 0 藤黄 1 橘 2 朱砂 3 朱 4 殷 5 玄
  // tongue 要 9 档：按 0 橘、2 朱砂、4 朱、6 殷 摆
  const T9 = [F[1], F[1], F[1], F[2], F[2], F[3], F[3], F[4], F[4]];
  const s = o.seed;
  const len = 2 + Math.round(rand(s, 1) * 2); // 炭的长短（2–4 像素）
  const lean = -1.2 - rand(s, 2) * 0.8;

  // ---- 地上的暖光：起势时亮起，主体里慢慢暗，余韵里收掉 ----
  const warm = t < RISE ? ease(t / RISE) : Math.max(0, 1 - (t - RISE) / (D * 0.62));
  if (warm > 0.02) p.glow(-0.5, 0, 5, F[2], 0.22 * warm);

  // ---- 焦痕：炭底下一抹很淡的焦色（半透明，和地面混），比炭长一点，慢慢退 ----
  const sc = t < RISE ? ease(t / RISE) : Math.max(0, 1 - (t - RISE) / (D - RISE));
  if (sc > 0.02) for (let x = -len; x <= len - 1; x++) p.blend(x, 0, F[4], 0.32 * sc * (1 - Math.abs(x + 0.5) / (len + 1)));

  // ---- 炭：一小段贴地的红，橘 → 朱砂 → 朱 → 殷，最后一粒粒灭掉 ----
  const cool = clamp((t - 0.15) / (D - 0.5), 0, 1); // 0 刚烫出来，1 灭了
  for (let i = 0; i < len; i++) {
    const x = Math.round(-len / 2 + i), h = rand(s, 10, i);
    const life = 0.62 + 0.38 * h; // 每粒炭灭的早晚不一样
    if (cool > life) continue;
    const k = cool / life;
    const flick = tnoise(t, D, 6, s + i * 3) * 0.12;
    const c = k + flick < 0.18 ? F[1] : k + flick < 0.45 ? F[2] : k + flick < 0.75 ? F[3] : F[4];
    if (k > 0.85) p.dot(x, 0, c, (1 - k) / 0.15);
    else p.px(x, 0, c);
    if (h > 0.55 && k < 0.6) p.px(x + (h > 0.8 ? 1 : 0), -1, k < 0.3 ? F[2] : F[3]); // 炭上隆起的一点
  }
  if (t < 0.6 && rand(s, 4) > 0.4) p.dot(Math.round(len / 2), 1, F[3], 1 - t / 0.6); // 溅出去的一点火屑

  // ---- 火舌：一大一小两簇，往身后歪；起势窜高、主体一跳一跳地矮下去 ----
  if (t < FADE) {
    const up = t < RISE ? ease(t / RISE) : 1;
    const v = t < RISE ? 0 : (t - RISE) / (FADE - RISE);
    const down = (1 - 0.6 * Math.pow(v, 1.1)) * Math.min(1, (1 - v) / 0.25); // 慢慢矮下去，最后一小段收掉
    const H = o.height * (0.85 + 0.3 * rand(s, 5));
    for (let j = 0; j < 2; j++) {
      const big = j === 0;
      const h = H * (big ? 1 : 0.5) * up * down * (0.7 + 0.45 * (0.5 + 0.5 * tnoise(t, D, 8, s * 7 + j)));
      const x = big ? 0 : (rand(s, 6) > 0.5 ? 1.5 : -1.5);
      tongue(p, x, -0.5, h, big ? 1.15 : 0.8, lean * (h / 4), T9, t, D, s * 13 + j, LAYERS);
      // 火舌尖上偶尔撕下一点火，往上、往身后飘一小段就灭
      if (big && h > 3) {
        const ph = (t * 2.6 + rand(s, 8)) % 1;
        if (ph < 0.45) p.px(Math.round(lean * 1.2 - ph * 3), Math.round(-h - 1 - ph * 4), ph < 0.2 ? F[1] : F[2]);
      }
    }
    // 浅色的地面上，火舌外面描一圈殷红才立得住（只描火舌，不描地上的炭）
    rim(p, -6, -14, 6, -2, F[4], t > FADE - 0.3 ? (FADE - t) / 0.3 : 1);
    // 火舌根上一点亮：只在起势和主体前半
    if (t < 0.7) p.light(0, -1, F[1], 0.35 * (1 - t / 0.7));
  }

  // ---- 火星：两三粒，被风往身后、往上卷，边飘边暗 ----
  const N = 2 + (rand(s, 7) > 0.5 ? 1 : 0);
  for (let i = 0; i < N; i++) {
    const t0 = 0.12 + i * 0.32 + rand(s, 20, i) * 0.2, life = 0.9 + rand(s, 21, i) * 0.6, a = t - t0;
    if (a < 0 || a > life) continue;
    const vx = -(18 + rand(s, 22, i) * 14), vy = -(14 + rand(s, 23, i) * 10);
    const x = travel(vx, 0, 1.6, a) + Math.sin(a * 7 + i * 2) * 1.2 * a;
    const y = -2 + travel(vy, 7, 1.9, a);
    ember(p, x, y, a / life, [F[1], F[2], F[3]], a + i + s, 0.8);
  }

  // ---- 一缕细烟：余韵里从炭上升起，往身后斜着散 ----
  const sm0 = 0.9 + rand(s, 30) * 0.3, sml = 1.9;
  const sa = t - sm0;
  if (sa > 0 && sa < sml) {
    const u = sa / sml;
    const x = -1 + travel(-7, -3, 0.6, sa) + Math.sin(sa * 3 + s) * 0.8;
    const y = -3 - travel(7, 1, 0.8, sa);
    smoke(p, x, y, 1.1, u, mix(hex(o.smoke), F[4], 0.25), 0.3, F[3]);
  }

  snapOf(o, F, hex(o.smoke))(p);
}
