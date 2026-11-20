// 氛围（修仙版：第一章桃花、第二章黄沙、第三章夜雾）：参照 pixelfx 的 weather/cherry-blossoms、weather/fog、weather/falling-leaves（MIT，
// https://github.com/patch-gg/pixelfx）新做的画面层循环。花瓣翻飞、雾带分几层错开走的做法参照了这几个特效。
// 为什么新做（封神幸存者，2026-11-10）：
// - 库里的天气是侧视的整屏 320×180：自带一层半透明的天色（把地面压灰一层），花瓣、落叶落到画面底边那一条「地面」上堆着，
//   雾是月夜里的三层雾带。游戏是俯视、480×270、背景不要黑，这些都不合用。
// - 这里只画「飘在空中的东西」，没有底色、没有地面线，盖在战场上面（镜头坐标的一层；接的时候按镜头位移给偏移）：
//   kind "petal"：桃花瓣斜着往下飘，翻面（正面桃红、背面月白），左右摆，偶尔一阵风；
//   kind "sand"：黄沙——细沙粒成股地横着刮过去，几片很淡的沙幕跟着风走；
//   kind "mist"：夜雾——两层很淡的雾带慢慢横移、一明一暗，前面几缕细雾丝滑过。
//   都很淡（氛围，不能盖住敌人和预警），循环无缝。
import { cycle, fit, TAU } from "../../core/index.js";
import { gp } from "./_lib.js";

export const meta = {
  name: "氛围 Ambient drift",
  desc: "Ambient drift over the battlefield, no sky and no floor: peach petals tumbling down on the breeze, or streams of fine sand and veils of dust, or slow banks of night mist.",
  tags: ["weather", "ambient", "petal", "sand", "mist", "loop", "xianxia"],
  size: [480, 270],
  origin: [0, 0],
  duration: 10,
  loop: true,
  fps: 30,
  bg: "sky",
  options: { kind: "petal", palette: gp("pmw"), count: 40, seed: 4 },
};

const W = 480, H = 270, D = meta.duration;

function petals(p, t, o, C) {
  // 每片从画面上方、左上方进来，斜着往右下飘出画面；一个周期里飘完一程（周期 D 的整数倍，循环才无缝）
  cycle(t, D, o.count, o.seed, (r) => D * (r.next() < 0.5 ? 0.5 : 1), (age, life, r) => {
    const u = age / life, x0 = r.range(-80, W), y0 = -10, sp = r.range(0.75, 1.15), drift = r.range(60, 120) * (life / D) * 2 * sp;
    const x = x0 + u * drift + Math.sin(age * r.range(0.8, 1.4) + r.next() * TAU) * 10, y = y0 + u * (H + 20);
    if (x < 1 || x >= W - 3 || y < 1 || y >= H - 2) return;
    // 翻面：正面一片 3×2 的桃红花瓣（下沿一像素胭脂、尖上一像素月白），转到侧面只剩斜着的两像素、再侧只剩一像素，
    // 背面是月白的——翻过来的那一下像一闪
    const f = Math.sin(age * r.range(2.2, 4) + r.next() * TAU), af = Math.abs(f), X = Math.round(x), Y = Math.round(y);
    if (af < 0.2) p.px(X, Y, C[0]);
    else if (af < 0.55) (p.px(X, Y + 1, C[1]), p.px(X + 1, Y, C[1]));
    else if (f > 0) (p.px(X + 1, Y, C[1]), p.px(X + 2, Y, C[2]), p.px(X, Y + 1, C[0]), p.px(X + 1, Y + 1, C[1]), p.px(X + 2, Y + 1, C[1]));
    else (p.px(X + 1, Y, C[2]), p.px(X + 2, Y, C[2]), p.px(X, Y + 1, C[1]), p.px(X + 1, Y + 1, C[2]), p.px(X + 2, Y + 1, C[1]));
  });
}

function sand(p, t, o, C) {
  // 沙幕：几片很淡的沙色横着走（真半透明的长椭圆），慢
  cycle(t, D, 6, o.seed + 1, D, (age, life, r) => {
    const u = age / life, y = r.range(20, H - 20), x = -120 + u * (W + 240), rx = r.range(60, 110), ry = r.range(10, 18);
    // 一串边缘软掉的圆（透明度从圆心往外降到零），叠起来是一片没有边的长条；硬边的圆叠出来像一串珠子
    for (let i = -4; i <= 4; i++) p.disc(x + i * rx * 0.2, y + Math.sin(i * 0.7 + u * 6) * 3, ry * (1 - Math.abs(i) * 0.1), C[1], (d) => 0.09 * Math.pow(1 - d, 1.5));
  });
  // 沙粒：成股地横着刮过去，有快有慢，一像素（近的两像素长）
  cycle(t, D, o.count * 3, o.seed, (r) => D / (1 + Math.floor(r.next() * 3)), (age, life, r) => {
    const u = age / life, band = Math.floor(r.next() * 5), y0 = 30 + band * 50 + r.range(-18, 18), near = r.next() < 0.4;
    const x = -20 + u * (W + 40), y = y0 + Math.sin(age * 2 + r.next() * TAU) * 4 + u * r.range(-8, 8);
    if (x < 3 || x >= W - 1 || y < 0 || y >= H - 1) return;
    // 近的拉成三像素的一小道（风刮得快），远的一粒
    p.px(x, y, near ? C[2] : C[1]);
    if (near) (p.px(x - 1, y, C[1]), p.px(x - 2, y, C[0]));
  });
}

function mist(p, t, o, C) {
  // 两层雾带：远的一层慢、大、更淡，近的一层快一点；每团是几个叠着的软圆，一明一暗
  for (const [layer, n, speed, a0] of [[0, 4, 1, 0.08], [1, 3, 2, 0.1]]) {
    cycle(t, D, n, o.seed + layer * 7, D / speed, (age, life, r) => {
      const u = age / life, y = r.range(30, H - 30), x = -140 + u * (W + 280), R0 = r.range(34, 52) * (layer ? 0.8 : 1);
      const k = a0 * (0.75 + 0.25 * Math.sin(age * 0.8 + r.next() * TAU));
      for (let i = -2; i <= 2; i++) p.disc(x + i * R0 * 0.5, y + Math.sin(i * 1.7 + r.next()) * R0 * 0.15, R0 * (0.9 - Math.abs(i) * 0.12), C[layer ? 2 : 1], (d) => k * 0.8 * Math.pow(1 - d, 1.4));
    });
  }
  // 细雾丝：前面几道很细的长条滑过
  cycle(t, D, 5, o.seed + 3, D / 2, (age, life, r) => {
    const u = age / life, y = r.range(20, H - 20), x = -100 + u * (W + 200), L = r.range(50, 90);
    for (let i = 0; i < L; i += 2) p.blend(x + i, y + Math.sin((x + i) * 0.03) * 2, C[2], 0.12 * Math.sin((Math.PI * i) / L));
  });
}

export function draw(p, t, o) {
  const C = fit(o.palette, 3);
  if (o.kind === "sand") sand(p, t, o, C);
  else if (o.kind === "mist") mist(p, t, o, C);
  else petals(p, t, o, C);
}
