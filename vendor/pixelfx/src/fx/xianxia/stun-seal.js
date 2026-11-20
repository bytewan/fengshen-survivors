// 镇住（修仙版的「眩晕」：番天印的晕眩、打神鞭的「打神」、定身）：参照 pixelfx 的 status/stunned（MIT，https://github.com/patch-gg/pixelfx）重做，
// 没有沿用它的代码（原作头顶转圈的星星，这里只留了「几粒星沿压扁的轨道转」这个意思）。
// 为什么重做（封神幸存者，2026-11-10）：
// - 原作是头顶一圈转着的大星星和一道发光的轨道环（「光圈」），再把人物晃来晃去（要知道人物的每个像素）。
// - 修仙版：额头上贴着一张小黄符（朱砂画的「镇」字三笔），下半截被风吹得一摆一摆；头顶三粒很小的金星沿着一条压扁的
//   看不见的轨道慢慢转（转到前面的那粒亮、大一点，到后面暗、小），不画轨道。不碰人物，按身体宽高（body）摆位置。
//   回响兵本来就是殷商的残魂，「镇魂符」贴在额头上一看就懂。循环 1.2 秒，没有辉光。
import { fit, TAU, WHITE } from "../../core/index.js";
import { gp, snapOf } from "./_lib.js";

export const meta = {
  name: "镇住 Sealed (stunned)",
  desc: "Stunned by a seal: a small yellow talisman with a cinnabar glyph sticks to the brow, its tail fluttering, while three tiny gold stars wheel slowly above the head.",
  tags: ["status", "stun", "daze", "seal", "talisman", "debuff", "xianxia", "loop"],
  size: [40, 44],
  origin: [20, 36],
  duration: 1.2,
  loop: true,
  fps: 30,
  bg: "ground",
  options: { palette: gp("BbyYfW"), ink: gp("Rr"), body: [12, 22], side: 1, seed: 1 },
};

const D = meta.duration;

export function draw(p, t, o) {
  const C = fit(o.palette, 6), INK = fit(o.ink, 2), [w, h] = o.body, ph = (t / D) * TAU, s = o.side >= 0 ? 1 : -1;
  // 小黄符：3 像素宽、7 像素长，上端贴在额头（略偏向脸朝的那边），下面两行随风摆
  const fx = Math.round(s * w * 0.12), fy = Math.round(-h + 3);
  const sway = (row) => (row < 4 ? 0 : Math.round(Math.sin(ph * 2 + row * 0.6) * (row - 3) * 0.55));
  const rows = ["byb", "yYy", "YrY", "yRy", "YrY", "yYy", "byb"];
  rows.forEach((r, j) => {
    const dx = sway(j);
    for (let i = 0; i < 3; i++) {
      const ch = r[i], c = ch === "b" ? C[1] : ch === "y" ? C[2] : ch === "Y" ? C[3] : ch === "R" ? INK[0] : INK[1];
      p.px(fx - 1 + i + dx, fy + j, c);
    }
  });
  // 三粒金星：沿压扁的轨道慢慢转；转到前面（sin > 0）的亮、带一像素的小十字，转到后面的暗、只有一点
  const cx = 0, cy = -h - 2, rx = w * 0.5 + 1, ry = 2;
  for (let i = 0; i < 3; i++) {
    const a = ph + (i * TAU) / 3, x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry, front = Math.sin(a) > 0;
    if (front) {
      p.px(x, y, WHITE);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) p.px(x + dx, y + dy, C[3]);
    } else p.px(x, y, C[2]);
  }
  snapOf(o, C, INK)(p);
}
