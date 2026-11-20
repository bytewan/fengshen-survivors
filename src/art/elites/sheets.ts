// 精英精灵的对照图清单（node tools/render-sheet.ts <名字>），并进 src/art/sprites/index.ts 的 SHEETS。
import type { Grid } from '../pixel.ts';
import { ACCENT_KEYS, BLADE_FRAMES, JIANSHI_FRAMES, LISHI_FRAMES, YECHA_FRAMES, accentize } from './sprites.ts';

interface Sheet {
  frames: { label: string; g: Grid }[];
  bg?: string;
  big?: number;
  cols?: number;
}
const label = (prefix: string, gs: Grid[]) => gs.map((g, i) => ({ label: `${prefix}${i}`, g }));

export const ELITE_SHEETS: Record<string, Sheet> = {
  yecha: {
    frames: [
      ...Object.entries(YECHA_FRAMES).flatMap(([k, gs]) => label(k, gs)),
      ...ACCENT_KEYS.map((k) => ({ label: `accent-${k}`, g: accentize(YECHA_FRAMES.walk[0], k) })),
    ],
    big: 8,
    cols: 8,
  },
  lishi: {
    frames: [
      ...Object.entries(LISHI_FRAMES).flatMap(([k, gs]) => label(k, gs)),
      ...ACCENT_KEYS.map((k) => ({ label: `accent-${k}`, g: accentize(LISHI_FRAMES.walk[0], k) })),
    ],
    bg: 'a',
    big: 8,
    cols: 6,
  },
  jianshi: {
    frames: [
      ...Object.entries(JIANSHI_FRAMES).flatMap(([k, gs]) => label(k, gs)),
      ...ACCENT_KEYS.map((k) => ({ label: `accent-${k}`, g: accentize(JIANSHI_FRAMES.walk[0], k) })),
      ...label('blade', [0, 2, 4, 6, 8, 12].map((d) => BLADE_FRAMES[d])),
    ],
    bg: 'V',
    big: 8,
    cols: 6,
  },
};
