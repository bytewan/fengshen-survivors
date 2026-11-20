// 第二章精灵的对照图清单（node tools/render-sheet.ts <名字>），并进 src/art/sprites/index.ts 的 SHEETS。
import type { Grid } from '../pixel.ts';
import { FLAG, ROCKS, STAKE } from './decor.ts';
import { BANNERMAN_FRAMES, GOLEM_FRAMES, WIND_FRAMES } from './foes.ts';
import { SOULFLAG_FRAMES, STRAW_FRAMES, YAO_FRAMES } from './yao.ts';

interface Sheet {
  frames: { label: string; g: Grid }[];
  bg?: string;
  big?: number;
  cols?: number;
}
const label = (prefix: string, gs: Grid[]) => gs.map((g, i) => ({ label: `${prefix}${i}`, g }));

export const CH2_SHEETS: Record<string, Sheet> = {
  ch2decor: {
    frames: [...label('flag', FLAG.idle), ...label('flutter', FLAG.flutter), { label: 'stake', g: STAKE }, ...label('rock', ROCKS)],
    bg: 'a',
    big: 10,
    cols: 6,
  },
  ch2foes: {
    frames: [
      ...label('ban', BANNERMAN_FRAMES.walk),
      ...label('golem', GOLEM_FRAMES.walk),
      ...label('wind', WIND_FRAMES.fly),
      ...label('windup', WIND_FRAMES.windup),
      ...label('dash', WIND_FRAMES.dash),
    ],
    bg: 'a',
    big: 7,
    cols: 8,
  },
  yao: {
    frames: [
      ...Object.entries(YAO_FRAMES).flatMap(([k, gs]) => label(k, gs)),
      ...label('flag', SOULFLAG_FRAMES),
      ...label('straw', STRAW_FRAMES),
    ],
    bg: 'a',
    big: 6,
    cols: 8,
  },
};
