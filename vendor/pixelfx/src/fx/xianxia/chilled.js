// 寒气缠足（修仙版的「减速」）：改自 pixelfx 的 status/slowed（MIT，https://github.com/patch-gg/pixelfx）。
// 冰棱用的是库的 crystal（出自 Sprite Fusion 的开源 frost nova，https://www.spritefusion.com/pixel-art-vfx，
// MIT License, Copyright (c) 2026 Hugo Duprez）。
// 改了什么（封神幸存者，2026-11-10）：
// - 去掉脑后那只玻璃钟面（表盘、指针、每走一格的闪光和外扩的圆环）：钟表不是修仙的东西，而且是个大圆圈。
// - 去掉盖在人物身上的那层冷色薄膜和拖在身后的轮廓残影（要知道人物的每个像素）。
// - 「慢」的原因画在脚上：脚下一朵压扁的六出霜花，脚踝两边冻着两根小冰棱（脚被冻住了，所以走不快），
//   脚两边几团很淡的寒气（真半透明的天青软团）贴着地慢慢往外挪，几粒冰屑从脚边慢慢往上冒。
//   和冰封（xianxia/frozen）是一家：减速只冻脚，冻结是整个人封进冰里。
// - 原作「慢动作往下沉的水珠」试过换成寒露，画出来是一颗颗空心的小菱形，像界面上的图标，去掉了；雪花缩成三像素的小十字。
// - 不依赖人物剪影：按身体的宽高（选项 body，默认 12×22）摆位置，一种体型只要预烘焙一份。
// - 画布从 64×76 收到 44×48，没有辉光。颜色全部收进色阶，深的两档用来在浅色地面上勾形。
import { cycle, fit, crystal, rand, TAU } from "../../core/index.js";
import { gp, snapOf, SY } from "./_lib.js";

export const meta = {
  name: "寒气缠足 Chilled (slowed)",
  desc: "Slowed by cold: two tiny ice spikes freeze the feet to a small frost flower, a faint cold mist creeps off the ankles, ice motes rise slowly, a few snowflakes drift down.",
  tags: ["status", "slow", "cold", "chill", "frost", "debuff", "xianxia", "loop"],
  size: [44, 48],
  origin: [22, 38],
  duration: 2.4,
  loop: true,
  fps: 30,
  bg: "ground",
  options: { palette: gp("NnncCwwW"), body: [12, 22], seed: 7 },
};

const D = meta.duration;

// 脚下的霜花：六出、俯视压扁
function frostFlower(p, C, r, seed) {
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.3, len = r * (0.8 + 0.2 * rand(seed, i)), ca = Math.cos(a), sa = Math.sin(a) * SY;
    for (let d = 1; d <= len; d++) {
      p.px(ca * d, sa * d, d > len - 1.5 ? C[7] : d % 3 === 0 ? C[5] : C[4]);
      if (d === Math.round(len * 0.55))
        for (const s of [-1, 1]) {
          const b = a + s * 1.05;
          for (let k = 1; k <= 2; k++) p.px(ca * d + Math.cos(b) * k, sa * d + Math.sin(b) * k * SY, C[4]);
        }
    }
  }
  p.px(0, 0, C[7]);
}

// 一片小雪花：三像素的小十字，心是白的（浅色地面上用深一档的颜色勾）
function flake(p, x, y, C, a) {
  x = Math.round(x);
  y = Math.round(y);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) p.dot(x + dx, y + dy, C[3], a);
  p.dot(x, y, C[7], a);
}

export function drawBack(p, t, o) {
  const C = fit(o.palette, 8), [w] = o.body;
  frostFlower(p, C, w / 2 + 4, o.seed);
  snapOf(o, C)(p);
}

export function draw(p, t, o) {
  const C = fit(o.palette, 8), [w, h] = o.body, ph = t / D;
  // 寒气：几团很淡的天青软团贴着地面在脚两边慢慢往外挪、胀开、变淡（不压在身上：整个特效盖在人物前面，压在身上像一块脏玻璃）
  cycle(t, D, 6, o.seed + 3, (r) => r.range(1.4, 2), (age, life, r, i) => {
    const u = age / life, side = i % 2 ? 1 : -1, x = side * (w / 2 + r.range(0, 2) + u * r.range(2, 4)), y = r.range(-2, 1) - u * 1.5;
    const k = Math.min(1, u * 4) * Math.min(1, (1 - u) * 3);
    p.disc(x, y, r.range(1.8, 2.6) * (0.8 + u * 0.6), C[5], 0.32 * k);
  });
  // 脚踝两边的两根小冰棱（边用浅一档的颜色）；高的那根上隔一会儿滑过一道光
  const ICE = [C[3], C[1], C[2], C[3], C[4], C[5], C[6], C[7]];
  crystal(p, -w / 2 + 0.5, 2.5, 4, 3, -1, ICE, { glint: -1 });
  crystal(p, w / 2 - 0.5, 3, 5, 3.5, 1.2, ICE, { glint: ph < 0.3 ? ph / 0.3 : -1 });
  // 冰屑：从脚边慢慢往上冒、左右轻轻摆，冒到小腿高就化掉
  cycle(t, D, 5, o.seed + 6, (r) => r.range(1, 1.5), (age, life, r) => {
    const u = age / life, x = r.range(-w / 2 - 2, w / 2 + 2) + Math.sin(age * 4 + r.next() * TAU) * 0.8, y = -1 - u * r.range(7, 11);
    if (u > 0.85 && Math.sin(age * 40) < 0) return;
    p.px(x, y, u < 0.5 ? C[7] : C[5]);
  });
  // 两片小雪花慢慢飘下来
  cycle(t, D, 2, o.seed + 8, (r) => r.range(2, 2.3), (age, life, r, i) => {
    const u = age / life, x = (i ? 1 : -1) * r.range(w / 2 + 1, w / 2 + 6) + Math.sin(age * 2.2 + i * 2) * 2, y = -h * 0.8 + u * (h * 0.7);
    flake(p, x, y, C, Math.min(1, u * 5) * Math.min(1, (1 - u) * 4));
  });
  snapOf(o, C)(p);
}
