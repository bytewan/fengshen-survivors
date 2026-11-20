// 第三章精灵的对照图清单（node tools/render-sheet.ts <名字>），并进 src/art/sprites/index.ts 的 SHEETS。
import type { Grid } from '../pixel.ts';
import { BOSS_SWORD_FRAMES, STONES, STUBS, SWORD_DIRS, SWORD_FRAMES } from './decor.ts';
import { DISCIPLE_FRAMES, FLY_FRAMES, PUPPET_FRAMES, QI_FRAMES } from './foes.ts';
import { ZX_FRAMES } from './zhuxian.ts';

interface Sheet {
  frames: { label: string; g: Grid }[];
  bg?: string;
  big?: number;
  cols?: number;
}
const label = (prefix: string, gs: Grid[]) => gs.map((g, i) => ({ label: `${prefix}${i}`, g }));

export const CH3_SHEETS: Record<string, Sheet> = {
  ch3decor: {
    frames: [
      // 四把剑：剑尖朝下（悬在台上）、寒光走过的五帧；再挑几个方向
      ...SWORD_FRAMES.map((dirs, i) => ({ label: `sword${i}`, g: dirs[SWORD_DIRS / 4][0] })),
      ...label('glint', SWORD_FRAMES[1][SWORD_DIRS / 4].slice(1)),
      ...[0, 2, 6, 10, 14].map((d) => ({ label: `dir${d}`, g: SWORD_FRAMES[0][d][0] })),
      ...BOSS_SWORD_FRAMES.map((dirs, i) => ({ label: `bsword${i}`, g: dirs[12] })),
      ...label('stub', STUBS),
      ...label('stone', STONES),
    ],
    bg: 'V',
    big: 8,
    cols: 8,
  },
  ch3foes: {
    frames: [
      ...[0, 2, 4, 8, 12].map((d) => ({ label: `fly${d}`, g: FLY_FRAMES[d][0] })),
      ...label('dis', DISCIPLE_FRAMES.walk),
      ...label('cast', DISCIPLE_FRAMES.cast),
      ...label('pup', PUPPET_FRAMES.walk),
      ...[0, 4, 8, 12].map((d) => ({ label: `qi${d}`, g: QI_FRAMES[d] })),
    ],
    bg: 'V',
    big: 6,
    cols: 8,
  },
  zhuxian: {
    frames: Object.entries(ZX_FRAMES).flatMap(([k, gs]) => label(k, gs)),
    bg: 'V',
    big: 6,
    cols: 8,
  },
};
