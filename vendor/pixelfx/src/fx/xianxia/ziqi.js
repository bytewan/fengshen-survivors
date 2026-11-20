// 紫气东来（功法）：封神幸存者 2026-11-12 新做（pixelfx 的画笔与做法，MIT，https://github.com/patch-gg/pixelfx）。
// 每波开始囊中余财生息的那一下：
//   起势 0–0.25 秒：东边（右上方）先浮出一缕淡紫的云气；
//   主体 0.25–0.9 秒：紫气拖成一条由淡到浓的带子，打一个弯飘到人物身后、往腰间收进去（带头是桃红，身是胭脂紫，尾是紫棠，半透明）；
//   余韵 0.9–1.6 秒：带子从尾往头收完，收进去的地方冒起几粒缃色的光点（财气），慢慢往上飘、暗下去。
// 不绕人物一圈（不成光圈），只从一侧收进去；光很淡。
import { hex, clamp, rand, ease } from "../../core/index.js";
import { gp, snapOf } from "./_lib.js";

export const meta = {
  name: "紫气东来 Purple qi from the east",
  desc: "A wisp of violet qi gathers in the east, streams in a curving band to the hero's back and sinks in at the waist, leaving gold motes drifting up.",
  tags: ["buff", "qi", "xianxia", "wealth"],
  size: [112, 64],
  origin: [36, 52],
  duration: 1.6,
  loop: false,
  fps: 30,
  bg: "ground",
  options: { seed: 1 },
};

const PURPLE = gp("Ppmw").map(hex); // 紫棠 胭脂紫 桃红 月白
const GOLD = gp("byYf").map(hex);

// 带子走的路：从右上方 (66, -38) 弯一下，收到人物腰间 (-2, -12)
function path(u) {
  const x0 = 66, y0 = -38, x1 = -2, y1 = -12;
  const cx = 30, cy = -46; // 控制点：先往上拱一点，再落下来
  const a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
  return [a * x0 + b * cx + c * x1, a * y0 + b * cy + c * y1];
}

export function draw(p, t, o) {
  if (t >= meta.duration) return;
  const s = o.seed;
  // 带头走到哪（0..1）、带尾走到哪
  const head = ease.inOutSine(clamp((t - 0.05) / 0.85));
  const tailU = ease.inOutSine(clamp((t - 0.35) / 0.95));
  const fadeIn = clamp(t / 0.25);
  for (const lane of [0, 1]) {
    const off = lane ? 4 : 0, k0 = lane ? 0.55 : 1; // 第二条细一点、淡一点、稍晚
    const h = Math.max(0, head - lane * 0.06), tl = Math.max(0, tailU - lane * 0.04);
    if (h <= tl) continue;
    const N = 46;
    for (let i = 0; i <= N; i++) {
      const u = tl + ((h - tl) * i) / N;
      const [x, y0] = path(u);
      const y = y0 + off + Math.sin(u * 9 + t * 5 + lane * 2) * 1.4;
      const k = (u - tl) / Math.max(0.001, h - tl); // 0 尾、1 头
      const w = (1 + 1.6 * Math.sin(Math.PI * Math.min(1, k * 1.15))) * k0;
      const col = k > 0.9 ? PURPLE[2] : k > 0.45 ? PURPLE[1] : PURPLE[0];
      const a = (0.3 + 0.5 * k) * fadeIn * k0;
      p.disc(x, y, w, col, a);
      if (k > 0.92 && lane === 0) p.dot(x, y, PURPLE[3], 0.7 * fadeIn);
    }
    if (lane === 0 && h < 0.999) p.light(...path(h), PURPLE[2], 0.25);
  }
  // 收进去的地方：几粒缃色的光点往上飘
  for (let m = 0; m < 7; m++) {
    const t0 = 0.8 + m * 0.07 + rand(s, m) * 0.05, life = 0.5 + rand(s, m, 1) * 0.3, a = t - t0;
    if (a < 0 || a > life) continue;
    const q = a / life;
    const x = -2 + (rand(s, m, 2) - 0.5) * 10 + Math.sin(a * 7 + m) * 1;
    const y = -12 + (rand(s, m, 3) - 0.5) * 6 - a * (18 + rand(s, m, 4) * 10);
    const col = q < 0.35 ? GOLD[3] : q < 0.7 ? GOLD[2] : GOLD[1];
    if (q > 0.8) p.dot(x, y, col, (1 - q) / 0.2);
    else p.px(x, y, col);
    p.light(x, y, GOLD[2], 0.2 * (1 - q));
  }
  snapOf(o, PURPLE, GOLD)(p);
}
