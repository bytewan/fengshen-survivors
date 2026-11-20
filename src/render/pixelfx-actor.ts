// 游戏的人物、敌人 → pixelfx 的 actor（剪影 + 自己的颜色，脚在 (0, 0)）。
// 魂散这类特效要知道「被打散的那个人」长什么样（选项 actor）；状态类按体型摆（选项 body）。
// xfx.ts（战斗里）和 tools/pixelfx-lab.html（实验页换「被打的人」）共用这一份。
import { toRgba, type Grid } from '../art/pixel.ts';
import { SOLDIER_ANCHOR, SOLDIER_FRAMES } from '../art/sprites/soldier.ts';
import { ELITE_ANCHOR, ELITE_FRAMES } from '../art/sprites/elite.ts';
import { CASTER_ANCHOR, CASTER_FRAMES } from '../art/sprites/caster.ts';
import { SPEARMAN_ANCHOR, SPEARMAN_FRAMES } from '../art/sprites/spearman.ts';
import { SHIELD_ANCHOR, SHIELD_FRAMES } from '../art/sprites/shieldbearer.ts';
import { CAVALRY_ANCHOR, CAVALRY_FRAMES } from '../art/sprites/cavalry.ts';
import { BOMBER_ANCHOR, BOMBER_FRAMES } from '../art/sprites/bomber.ts';
import { SPLITLING_ANCHOR, SPLITLING_FRAMES, SPLITTER_ANCHOR, SPLITTER_FRAMES } from '../art/sprites/splitter.ts';
import { BANNERMAN_ANCHOR, BANNERMAN_FRAMES, GOLEM_ANCHOR, GOLEM_FRAMES, WIND_ANCHOR, WIND_FRAMES } from '../art/ch2/foes.ts';
import { NEZHA_ANCHOR, NEZHA_FRAMES } from '../art/sprites/nezha.ts';
import { DEMON_ANCHOR, DEMON_FRAMES } from '../art/sprites/demon-nezha.ts';
import type { EnemyKindName } from '../sim/types.ts';

/** 身上的状态按体型摆：一种体型烘一份（docs/pixelfx-presets.md：回响兵 [12, 22]、精英 [16, 30]）。 */
export type Body = 'tiny' | 'small' | 'mid' | 'big';
export const BODY: Record<Body, [number, number]> = { tiny: [8, 12], small: [12, 17], mid: [12, 22], big: [16, 30] };

/**
 * 每种敌人：剪影（走路的第一帧）和锚点（脚底）、体型、命中点比一般的高（+）或低（−）几像素、魂往上飘多高。
 * soul: false 的不放魂散（红沙傀儡碎成红沙，第二章 foe-fx.ts 自己画）。
 */
export interface FoeArt {
  g: Grid;
  a: { x: number; y: number };
  body: Body;
  dy: number;
  rise: number;
  soul?: false;
}
export const FOE_ART: Partial<Record<EnemyKindName, FoeArt>> = {
  soldier: { g: SOLDIER_FRAMES.walk[0], a: SOLDIER_ANCHOR, body: 'mid', dy: 0, rise: 22 },
  caster: { g: CASTER_FRAMES.float[0], a: CASTER_ANCHOR, body: 'mid', dy: 0, rise: 22 },
  spearman: { g: SPEARMAN_FRAMES.walk[0], a: SPEARMAN_ANCHOR, body: 'mid', dy: 1, rise: 22 },
  splitter: { g: SPLITTER_FRAMES.float[0], a: SPLITTER_ANCHOR, body: 'mid', dy: 0, rise: 20 },
  bomber: { g: BOMBER_FRAMES.float[0], a: BOMBER_ANCHOR, body: 'small', dy: -3, rise: 18 },
  splitling: { g: SPLITLING_FRAMES.float[0][0], a: SPLITLING_ANCHOR, body: 'tiny', dy: -5, rise: 14 },
  shieldbearer: { g: SHIELD_FRAMES.walk[0], a: SHIELD_ANCHOR, body: 'big', dy: 2, rise: 24 },
  cavalry: { g: CAVALRY_FRAMES.walk[0], a: CAVALRY_ANCHOR, body: 'big', dy: 5, rise: 24 },
  elite: { g: ELITE_FRAMES.walk[0], a: ELITE_ANCHOR, body: 'big', dy: 8, rise: 26 },
  // 第二章：落魂幡手、风吼妖散成魂；红沙傀儡碎成红沙（不放魂散）
  bannerman: { g: BANNERMAN_FRAMES.walk[0], a: BANNERMAN_ANCHOR, body: 'mid', dy: 2, rise: 24 },
  windfiend: { g: WIND_FRAMES.fly[0], a: WIND_ANCHOR, body: 'small', dy: -4, rise: 18 },
  golem: { g: GOLEM_FRAMES.walk[0], a: GOLEM_ANCHOR, body: 'big', dy: 2, rise: 0, soul: false },
};

/** 人物（实验页比大小、拾取类效果的「被打的人」）。 */
export const HERO_ART = {
  nezha: { g: NEZHA_FRAMES.idle[0], a: NEZHA_ANCHOR },
  demon: { g: DEMON_FRAMES.idle[0], a: DEMON_ANCHOR },
};

/** 一张精灵网格 → pixelfx 的 actor：mask（有颜色的格子）、pixels（每格自己的颜色，库的 RGBA 整数）、左上角相对脚底的位置。 */
export function actorOf(g: Grid, a: { x: number; y: number }) {
  const rgba = toRgba(g);
  const data = new Uint8Array(g.w * g.h);
  const pixels = new Uint32Array(g.w * g.h);
  for (let i = 0; i < g.w * g.h; i++) {
    if (!rgba[i * 4 + 3]) continue;
    data[i] = 1;
    pixels[i] = ((255 << 24) | (rgba[i * 4 + 2] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4]) >>> 0;
  }
  return { mask: { w: g.w, h: g.h, data }, pixels, x: -a.x, y: -a.y, w: g.w, h: g.h, k: 2, head: [0, -a.y], chest: [0, -Math.round(a.y * 0.5)] };
}
