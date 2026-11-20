// 对照图清单：工具和测试按名字取帧。
import type { Grid } from '../pixel.ts';
import { makeNezhaFrames, NEZHA_FRAMES, RING_PROJECTILE, type HairStyle } from './nezha.ts';
import { HEAD_VARIANTS } from './head-study.ts';
import { SOLDIER_FRAMES } from './soldier.ts';
import { ELITE_FRAMES } from './elite.ts';
import { CASTER_FRAMES, ORB } from './caster.ts';
import { CRYSTAL, FLOAT_TALISMAN, GHOST_FIRE, JADE_LANTERN, LOTUS, PILLAR, STELE, SWORD } from './decor.ts';
import { SPEARMAN_FRAMES } from './spearman.ts';
import { SHIELD_FRAMES } from './shieldbearer.ts';
import { CAVALRY_FRAMES } from './cavalry.ts';
import { BOMBER_FRAMES } from './bomber.ts';
import { SPLITLING_FRAMES, SPLITTER_FRAMES } from './splitter.ts';
import { CH2_SHEETS } from '../ch2/sheets.ts';
import { CH3_SHEETS } from '../ch3/sheets.ts';
import { ELITE_SHEETS } from '../elites/sheets.ts';

export interface Sheet {
  frames: { label: string; g: Grid }[];
  bg?: string;
  big?: number;
  cols?: number;
}

const label = (prefix: string, gs: Grid[]) => gs.map((g, i) => ({ label: `${prefix}${i}`, g }));

export const SHEETS: Record<string, Sheet> = {
  nezha: {
    frames: [
      ...label('idle', NEZHA_FRAMES.idle),
      ...label('move', NEZHA_FRAMES.move),
      ...label('windup', NEZHA_FRAMES.windup),
      ...label('throw', NEZHA_FRAMES.throw),
      ...label('follow', NEZHA_FRAMES.follow),
      ...label('ring', RING_PROJECTILE),
    ],
    cols: 6,
  },
  hair: {
    frames: (['backsingle', 'backtwin', 'round'] as HairStyle[]).flatMap((h) => {
      const f = makeNezhaFrames(h);
      return [
        { label: `${h}-idle`, g: f.idle[0] },
        { label: `${h}-move`, g: f.move[1] },
      ];
    }),
    big: 10,
    cols: 6,
  },
  heads: {
    frames: Object.entries(HEAD_VARIANTS).map(([k, g]) => ({ label: k, g })),
    big: 16,
  },
  soldier: { frames: label('walk', SOLDIER_FRAMES.walk), big: 10 },
  enemies: {
    frames: [
      ...label('soldier', SOLDIER_FRAMES.walk.slice(0, 2)),
      ...label('elite', ELITE_FRAMES.walk.slice(0, 2)),
      ...label('caster', CASTER_FRAMES.float.slice(0, 2)),
      ...label('cast', CASTER_FRAMES.cast.slice(0, 1)),
      ...label('orb', ORB),
    ],
    big: 8,
    cols: 9,
  },
  decor: {
    frames: [
      { label: 'jade-lantern', g: JADE_LANTERN },
      { label: 'stele', g: STELE },
      { label: 'sword', g: SWORD },
      { label: 'crystal', g: CRYSTAL },
      { label: 'pillar', g: PILLAR },
      ...label('lotus', LOTUS),
      ...label('talisman', FLOAT_TALISMAN),
      ...label('ghostfire', GHOST_FIRE),
    ],
    big: 8,
    cols: 9,
  },
  // ---- 第一章新敌人（node tools/render-sheet.ts <名字>）----
  spearman: {
    frames: [
      ...label('walk', SPEARMAN_FRAMES.walk),
      ...label('windup', SPEARMAN_FRAMES.windup),
      ...label('strike', SPEARMAN_FRAMES.strike),
      ...label('rest', SPEARMAN_FRAMES.rest),
    ],
    big: 8,
    cols: 5,
  },
  shieldbearer: {
    frames: [...label('walk', SHIELD_FRAMES.walk), ...label('guard', SHIELD_FRAMES.guard)],
    big: 8,
    cols: 6,
  },
  cavalry: {
    frames: [
      ...label('walk', CAVALRY_FRAMES.walk),
      ...label('warn', CAVALRY_FRAMES.warn),
      ...label('charge', CAVALRY_FRAMES.charge),
      ...label('rest', CAVALRY_FRAMES.rest),
    ],
    big: 7,
    cols: 5,
  },
  bomber: {
    frames: [...label('float', BOMBER_FRAMES.float), ...label('fuse', BOMBER_FRAMES.fuse), ...label('hot', BOMBER_FRAMES.hot)],
    big: 8,
    cols: 5,
  },
  splitter: {
    frames: [...label('float', SPLITTER_FRAMES.float), ...label('lingA', SPLITLING_FRAMES.float[0]), ...label('lingB', SPLITLING_FRAMES.float[1])],
    big: 8,
    cols: 4,
  },
  // 第一章的 8 种敌人放在一起对照（同一调色板、描边、天青眼光）
  foes: {
    frames: [
      { label: 'soldier', g: SOLDIER_FRAMES.walk[0] },
      { label: 'spearman', g: SPEARMAN_FRAMES.walk[0] },
      { label: 'shieldbearer', g: SHIELD_FRAMES.walk[0] },
      { label: 'caster', g: CASTER_FRAMES.float[0] },
      { label: 'bomber', g: BOMBER_FRAMES.float[0] },
      { label: 'splitter', g: SPLITTER_FRAMES.float[0] },
      { label: 'splitling', g: SPLITLING_FRAMES.float[0][0] },
      { label: 'splitling', g: SPLITLING_FRAMES.float[1][0] },
      { label: 'cavalry', g: CAVALRY_FRAMES.walk[0] },
      { label: 'elite', g: ELITE_FRAMES.walk[0] },
    ],
    big: 6,
    cols: 5,
  },
  // 第二章（西岐城外）的道具、新敌人、首领：清单在 src/art/ch2/sheets.ts
  ...CH2_SHEETS,
  // 第三章（界牌关）的道具与四剑、新敌人、首领：清单在 src/art/ch3/sheets.ts
  ...CH3_SHEETS,
  // 各章的精英（东海夜叉、金光力士、截教剑侍）和词缀着色：清单在 src/art/elites/sheets.ts
  ...ELITE_SHEETS,
};
