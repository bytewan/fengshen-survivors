// 爆符鬼（自爆鬼）：一只小小的紫棠色残魂，戴着白骨面具（天青眼），两只骨手把一道大爆符抱在怀里。
// 贴近人物时点燃爆符：符纸从上往下烧（火星），鬼身一档一档鼓胀、身上裂开一道道火纹，并且越来越快地泛红闪烁
// （表现层在 fuse 与 hot 两组帧之间切换）—— 全是手画的帧，不缩放、不画光圈。
// 朝右绘制，画布 22×22，脚底锚点 (10, 21)。帧：飘浮 4；引信 3（鼓胀三档）；hot 3（同样三档的泛红闪烁）。
import { compose, grid, outline, type Grid, type Layer } from '../pixel.ts';
import { recolor, sketch } from './foe-kit.ts';

export const BOMBER_W = 22;
export const BOMBER_H = 22;
export const BOMBER_ANCHOR = { x: 10, y: 21 };

const SELOUT: Record<string, string> = { j: 'h', w: 'h', p: 'P', P: 'k', Y: 'b', y: 'B', r: 'R', e: 'R', o: 'R' };

/** 鬼身：圆头往下收成往后飘的尾巴；上沿胭脂紫受光、下沿乌色。swell 0..2：鼓胀的档。 */
function body(swell: number, phase: number): Grid {
  const cx = 9;
  const cy = 10;
  const rx = 5.2 + swell * 0.9;
  const ry = 4.6 + swell * 0.8;
  const inside = (x: number, y: number) => {
    if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) return true;
    // 尾巴：从身子下面往后（左下）收成一缕
    const t = (y - cy) / (ry + 4);
    if (t <= 0 || t > 1) return false;
    const tx = cx - 1.5 - t * 4 + Math.sin(t * 5 + phase * 1.6) * 0.9;
    return Math.abs(x - tx) <= (1 - t) * rx * 0.7;
  };
  const rows: string[] = [];
  for (let y = 0; y < BOMBER_H; y++) {
    let r = '';
    for (let x = 0; x < BOMBER_W; x++) {
      if (!inside(x, y)) {
        r += '.';
        continue;
      }
      const up = inside(x, y - 1);
      const down = inside(x, y + 1);
      r += !up || !inside(x - 1, y - 1) ? 'p' : !down ? 'd' : 'P';
    }
    rows.push(r);
  }
  return grid(rows);
}

/** 鼓胀时身上裂开的火纹（朱、橘）：档越高裂得越多、越亮。 */
function cracks(swell: number): Grid {
  const s = sketch(BOMBER_W, BOMBER_H);
  if (swell >= 1) {
    s.line(4, 9, 6, 11, (i) => (i === 1 ? 'e' : 'r'));
    s.line(7, 5, 8, 7, 'r');
    s.line(5, 13, 7, 14, (i) => (i === 1 ? 'e' : 'r'));
  }
  if (swell >= 2) {
    s.line(3, 11, 4, 13, (i) => (i === 1 ? 'o' : 'e'));
    s.line(14, 4, 15, 6, (i) => (i === 0 ? 'o' : 'e'));
    s.set(5, 10, 'o');
    s.set(6, 6, 'o');
    s.line(8, 15, 9, 16, 'e');
  }
  return s.grid();
}

/** 白骨面具：天青的眼；鼓得最狠时眼里也冒白光。 */
function mask(swell: number): Grid {
  const eye = swell >= 2 ? 'W' : 'C';
  return grid(['.jjjw', `jk${eye}jk${eye}`, 'jjjwjj', '.jkjkj']);
}

/** 爆符：黄纸朱文，顶上一截乌色引线；burn 0..3：烧掉了几格（符纸从上往下变成火）。 */
function talisman(burn: number): Grid {
  const rows = ['.B..', 'yYYY', 'yrrY', 'yYrY', 'yrYY', 'yYrY', 'yYYY'];
  const fire = ['W', 'Y', 'o', 'e'];
  return grid(
    rows.map((r, i) => {
      if (i === 0) return burn ? '.o..' : r;
      if (i <= burn) return r.replace(/[yYr]/g, (_c, k: number) => fire[(i + k) % fire.length]);
      return r;
    }),
  );
}

function frame(i: number, swell: number, hot: boolean): Grid {
  const bob = swell ? 0 : [0, 1, 1, 0][i];
  const lift = swell; // 鼓起来时整个往上浮一点
  const by = bob - lift;
  const tal = talisman(swell === 0 ? 0 : swell);
  const layers: Layer[] = [
    { g: body(swell, i), x: 0, y: by },
    { g: cracks(swell), x: 0, y: by },
    { g: mask(swell), x: 9 + swell, y: 6 + by - Math.round(swell * 0.5) },
    { g: tal, x: 10 + swell, y: 11 + by },
    // 抱着爆符的两只骨手
    { g: grid(['jj']), x: 8 + swell, y: 13 + by },
    { g: grid(['j']), x: 14 + swell, y: 14 + by },
  ];
  let g = outline(compose(BOMBER_W, BOMBER_H, layers), 'k', SELOUT);
  // 泛红闪烁：鬼身、面具都被体内的火映红（描边和火纹不变）
  if (hot) g = recolor(g, { P: 'r', p: 'e', d: 'R', j: 'o', w: 'Y', h: 'r' });
  return g;
}

export const BOMBER_FRAMES = {
  float: [0, 1, 2, 3].map((i) => frame(i, 0, false)),
  fuse: [0, 1, 2].map((s) => frame(0, s, false)),
  hot: [0, 1, 2].map((s) => frame(0, s, true)),
};
