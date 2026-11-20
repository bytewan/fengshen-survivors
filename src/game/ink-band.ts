// 叠在战场上的那几条墨底（横幅、陨落 / 通关面板、对白框、跳过小签、气泡、解锁卡）共用的画法。
//
// 用户口径：不要「框」、不要硬直线边界。所以墨底四边都是软的：
// - 左右两头按余弦淡出（band，画在背景里）；
// - 上下两头也羽化（feather，当遮罩用：mask-image 会连同里面的字一起裁，所以字要离上下边比羽化的高度远）；
// - 需要收边的地方压一道两头渐隐的细线（hairline），画在羽化区里面一点——像墨晕里压的一道金线，不是边框。

/** 余弦缓动：第 i 段（共 n 段）的不透明度，0 → 1。 */
const ease = (i: number, n: number) => 0.5 - 0.5 * Math.cos((Math.PI * i) / n);

/** 左右两头渐隐的一条底：中间实、两头按余弦淡出。edge 是每一头淡出占多宽（%）。 */
export function band(rgb: string, a: number, edge: number): string {
  const n = 6;
  const stops: string[] = [];
  for (let i = 0; i <= n; i++) stops.push(`rgba(${rgb},${(a * ease(i, n)).toFixed(3)}) ${((edge * i) / n).toFixed(1)}%`);
  for (let i = n; i >= 0; i--) stops.push(`rgba(${rgb},${(a * ease(i, n)).toFixed(3)}) ${(100 - (edge * i) / n).toFixed(1)}%`);
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

/** 上下两头的羽化遮罩：f 是每一头羽化的高度（CSS 长度，如 '.4em'）。 */
export function feather(f: string): string {
  const n = 5;
  const stops: string[] = [];
  for (let i = 0; i <= n; i++) stops.push(`rgba(0,0,0,${ease(i, n).toFixed(3)}) calc(${f} * ${(i / n).toFixed(2)})`);
  for (let i = n; i >= 0; i--) stops.push(`rgba(0,0,0,${ease(i, n).toFixed(3)}) calc(100% - ${f} * ${(i / n).toFixed(2)})`);
  return `linear-gradient(180deg, ${stops.join(', ')})`;
}

/** 给一个元素加上下羽化的 CSS 声明（遮罩）。 */
export const featherCss = (f: string) => `-webkit-mask-image: ${feather(f)}; mask-image: ${feather(f)};`;

/** 一道两头渐隐的细线（当背景图用）。inset：两头各淡出多宽（%）。 */
export const hairline = (rgb: string, a: number, inset = 22) =>
  `linear-gradient(90deg, rgba(${rgb},0), rgba(${rgb},${a}) ${inset}%, rgba(${rgb},${a}) ${100 - inset}%, rgba(${rgb},0))`;

/**
 * 上下各一道细线的 CSS 声明（背景图，铺在一个 inset: 0 的伪元素上）：线在离上下边 at 处、两头各缩进 side。
 * 线宽不小于 1 个 CSS 像素。
 */
export const hairlinesCss = (rgb: string, a: number, at: string, side = '8%', inset = 22) => {
  const line = hairline(rgb, a, inset);
  const w = `calc(100% - ${side} * 2)`;
  return `background: ${line} ${side} ${at} / ${w} max(1px, .07em) no-repeat, ${line} ${side} calc(100% - ${at}) / ${w} max(1px, .07em) no-repeat;`;
};
