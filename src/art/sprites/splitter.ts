// 分魂鬼（分裂鬼）：一件兜帽长袍里裹着两道残魂 —— 袍子从中间分成靛青和紫棠两半，接缝处透出一道天青的魂光，
// 帽檐下并排两张白骨面具（各一只天青眼），袍摆化成两缕魂尾。打死它，两道残魂就各自散成一只小鬼「离魂」。
// 离魂：一只小小的兜帽魂，一张面具；靛青、紫棠两种颜色（分别是分魂鬼的两半）。
// 朝右绘制。分魂鬼画布 20×22，脚底锚点 (9, 21)；离魂画布 12×13，脚底锚点 (5, 12)。帧：飘浮 4。
import { compose, grid, outline, type Grid, type Layer } from '../pixel.ts';

export const SPLITTER_W = 20;
export const SPLITTER_H = 22;
export const SPLITTER_ANCHOR = { x: 9, y: 21 };
export const SPLITLING_W = 12;
export const SPLITLING_H = 13;
export const SPLITLING_ANCHOR = { x: 5, y: 12 };

const SELOUT: Record<string, string> = { j: 'h', w: 'h', p: 'P', P: 'k', n: 'N', N: 'k', C: 'c', c: 'n' };

type Soul = 'indigo' | 'plum';
/** 两道残魂的颜色：受光、本色、背光。 */
const TONE: Record<Soul, [string, string, string]> = { indigo: ['n', 'N', 'd'], plum: ['p', 'P', 'd'] };

/** 兜帽长袍的剪影（cx 是中线；tail：两缕魂尾的摆动相位）。 */
function robe(w: number, h: number, cx: number, scale: number, phase: number, tails: number) {
  const hood = { x: cx + 0.5 * scale, y: 6 * scale, r: 5.2 * scale };
  return (x: number, y: number) => {
    if ((x - hood.x) ** 2 + ((y - hood.y) * 1.05) ** 2 <= hood.r * hood.r) return true;
    // 帽尖：往后上方翘起一点
    const px = hood.x - 3.2 * scale;
    const py = hood.y - 4.6 * scale;
    if (y >= py && y < hood.y - 2 * scale && x >= px - 0.5 && x <= hood.x - 1 * scale && (x - px) >= (y - py) * -0.2 && (y - py) >= (hood.x - 1 * scale - x) * 0.55 - 0.5) return true;
    const top = hood.y;
    const bottom = 13.5 * scale;
    if (y >= top && y <= bottom) {
      const hw = (5 + (y - top) * 0.12) * scale;
      return Math.abs(x - (cx + 0.5 * scale)) <= hw;
    }
    // 魂尾：一缕或两缕，往后（左下）飘
    if (y > bottom && y < h) {
      const t = (y - bottom) / (h - bottom);
      for (let k = 0; k < tails; k++) {
        const base = tails === 2 ? (k === 0 ? cx - 2.5 * scale : cx + 3 * scale) : cx;
        const tx = base - t * 2.5 * scale + Math.sin(t * 5 + phase * 1.7 + k * 2) * 0.9;
        if (Math.abs(x - tx) <= (1 - t) * (tails === 2 ? 3 : 3.4) * scale) return true;
      }
    }
    void w;
    return false;
  };
}

/** 按剪影上色：上沿受光、下沿背光；split 时以 seam 为界左右两种颜色、接缝透出魂光。 */
function paint(w: number, h: number, inside: (x: number, y: number) => boolean, soul: (x: number, y: number) => Soul, seamAt?: (y: number) => number): Grid {
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    let r = '';
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) {
        r += '.';
        continue;
      }
      if (seamAt && x === seamAt(y) && y > 2 && inside(x, y + 1)) {
        r += y % 4 === 3 ? 'W' : 'C';
        continue;
      }
      const [lit, mid, dark] = TONE[soul(x, y)];
      r += !inside(x, y - 1) || !inside(x - 1, y - 1) ? lit : !inside(x, y + 1) ? dark : mid;
    }
    rows.push(r);
  }
  return grid(rows);
}

/** 一张白骨面具（天青眼）。 */
const MASK = grid(['jjw', 'kCj', 'jkj']);

function splitterFrame(i: number): Grid {
  const bob = [0, 1, 1, 0][i];
  const inside = robe(SPLITTER_W, SPLITTER_H, 9, 1, i, 2);
  // 接缝：一道微微曲折的裂口（不是一条直线）
  const seamAt = (y: number) => 10 + ([0, 0, 0, 0, 0, 0, -1, -1, 0, 0, 1, 1, 0, 0, -1, -1, 0, 0, 1, 1, 0, 0][y] ?? 0);
  const body = paint(SPLITTER_W, SPLITTER_H, inside, (x, y) => (x < seamAt(y) ? 'indigo' : 'plum'), seamAt);
  const layers: Layer[] = [
    { g: body, x: 0, y: bob },
    // 帽檐下两张面具，朝前并排
    { g: MASK, x: 7, y: 6 + bob },
    { g: MASK, x: 12, y: 6 + bob },
    // 帽檐：一道背光的阴影压在面具上沿
    { g: grid(['ddd..ddd']), x: 7, y: 5 + bob },
  ];
  return outline(compose(SPLITTER_W, SPLITTER_H, layers), 'k', SELOUT);
}

function splitlingFrame(i: number, soul: Soul): Grid {
  const bob = [0, 1, 1, 0][i];
  const inside = robe(SPLITLING_W, SPLITLING_H, 5, 0.58, i, 1);
  const body = paint(SPLITLING_W, SPLITLING_H, inside, () => soul);
  const layers: Layer[] = [
    { g: body, x: 0, y: bob },
    { g: MASK, x: 6, y: 3 + bob },
  ];
  return outline(compose(SPLITLING_W, SPLITLING_H, layers), 'k', SELOUT);
}

export const SPLITTER_FRAMES = { float: [0, 1, 2, 3].map(splitterFrame) };
/** 离魂的两种颜色：0 靛青（分魂鬼的左半）、1 紫棠（右半）。 */
export const SPLITLING_FRAMES = { float: [[0, 1, 2, 3].map((i) => splitlingFrame(i, 'indigo')), [0, 1, 2, 3].map((i) => splitlingFrame(i, 'plum'))] };
