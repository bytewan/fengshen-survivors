// 图鉴里的像素图：全是游戏里现成的精灵和图标——角色的待机帧（hero-views.ts）、法宝 / 灵物 / 丹药 / 符箓的图标（icons.ts）、
// 敌人和首领的走路 / 待机帧（art/sprites/、art/ch2/、art/ch3/）。四周的空白裁掉（几帧按同一个框裁，动起来不晃）。
// 新加的敌人：在 FOE_FRAMES 里加一行（没加的先用一个墨点占位）；新加的首领：在 BOSS_FRAMES 里按首领模块的 kind 加一行。
import { compose, grid, type Grid } from '../art/pixel.ts';
import { daisArt } from '../art/ch2/formations.ts';
import { CHARM_ICONS, ELIXIR_ICONS, RELIC_ICONS, WEAPON_ICONS } from '../art/sprites/icons.ts';
import { SOLDIER_FRAMES } from '../art/sprites/soldier.ts';
import { ELITE_FRAMES } from '../art/sprites/elite.ts';
import { CASTER_FRAMES } from '../art/sprites/caster.ts';
import { SPEARMAN_FRAMES } from '../art/sprites/spearman.ts';
import { SHIELD_FRAMES } from '../art/sprites/shieldbearer.ts';
import { CAVALRY_FRAMES } from '../art/sprites/cavalry.ts';
import { BOMBER_FRAMES } from '../art/sprites/bomber.ts';
import { SPLITLING_FRAMES, SPLITTER_FRAMES } from '../art/sprites/splitter.ts';
import { DEMON_FRAMES } from '../art/sprites/demon-nezha.ts';
import { BANNERMAN_FRAMES, GOLEM_FRAMES, WIND_FRAMES } from '../art/ch2/foes.ts';
import { YAO_FRAMES } from '../art/ch2/yao.ts';
import { DISCIPLE_FRAMES, FLY_FRAMES, PUPPET_FRAMES } from '../art/ch3/foes.ts';
import { ZX_FRAMES } from '../art/ch3/zhuxian.ts';
import { JIANSHI_FRAMES, LISHI_FRAMES, YECHA_FRAMES, accentize } from '../art/elites/sprites.ts';
import type { EliteAffix, EliteKind } from '../sim/elites/types.ts';
import type { CharmId, ElixirId, EnemyKindName, HeroId, RelicId, WeaponKind } from '../sim/types.ts';
import { portraitFrames } from './hero-views.ts';

/** 几帧按同一个框裁掉四周的空白（框是几帧的并集）。全透明的原样返回。 */
export function cropFrames(gs: Grid[]): Grid[] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (const g of gs)
    g.rows.forEach((r, y) => {
      for (let x = 0; x < r.length; x++) {
        if (r[x] === '.' || r[x] === ' ') continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    });
  if (x1 < 0) return gs;
  return gs.map((g) => ({ w: x1 - x0 + 1, h: y1 - y0 + 1, rows: g.rows.slice(y0, y1 + 1).map((r) => r.slice(x0, x1 + 1).padEnd(x1 - x0 + 1, '.')) }));
}

/**
 * 剪影（没见过的）：整个形压成一片淡墨，外沿深一档——像墨洗过的影子，认得出轮廓、看不出是谁。
 * 纸上用不压成黑的：背景不要黑，剪影也不要一团黑。
 */
export function silhouette(g: Grid): Grid {
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < g.w && y < g.h ? g.rows[y][x] : '.');
  const solid = (c: string) => c !== '.' && c !== ' ';
  return {
    w: g.w,
    h: g.h,
    rows: g.rows.map((r, y) =>
      [...r]
        .map((c, x) => {
          if (!solid(c)) return '.';
          const edge = !solid(at(x - 1, y)) || !solid(at(x + 1, y)) || !solid(at(x, y - 1)) || !solid(at(x, y + 1));
          return edge ? 'h' : 'i';
        })
        .join(''),
    ),
  };
}

/** 还没有画像的（新加的敌人、首领还没在下面登记）：一滴墨。 */
const BLOT: Grid = grid(['..ggg..', '.ghhhg.', 'ghhihhg', 'ghiiihg', 'ghhihhg', '.ghhhg.', '..ggg..']);

/** 每种敌人在图鉴里动的那几帧（走路 / 飘着）。 */
const FOE_FRAMES: Partial<Record<EnemyKindName, () => Grid[]>> = {
  soldier: () => SOLDIER_FRAMES.walk,
  elite: () => ELITE_FRAMES.walk,
  caster: () => CASTER_FRAMES.float,
  spearman: () => SPEARMAN_FRAMES.walk,
  shieldbearer: () => SHIELD_FRAMES.walk,
  cavalry: () => CAVALRY_FRAMES.walk,
  bomber: () => BOMBER_FRAMES.float,
  splitter: () => SPLITTER_FRAMES.float,
  splitling: () => SPLITLING_FRAMES.float[0],
  bannerman: () => BANNERMAN_FRAMES.walk,
  golem: () => GOLEM_FRAMES.walk,
  windfiend: () => WIND_FRAMES.fly,
  flysword: () => FLY_FRAMES[2], // 斜着朝右下（16 个方向里的第 2 个）
  disciple: () => DISCIPLE_FRAMES.walk,
  puppet: () => PUPPET_FRAMES.walk,
};

/** 首领（按首领模块的 kind）：待机的几帧。 */
const BOSS_FRAMES: Record<string, () => Grid[]> = {
  nezha: () => DEMON_FRAMES.idle,
  yao: () => YAO_FRAMES.idle,
  zhuxian: () => ZX_FRAMES.idle,
};

const cache = new Map<string, Grid[]>();
const cached = (key: string, make: () => Grid[]) => {
  let v = cache.get(key);
  if (!v) cache.set(key, (v = cropFrames(make())));
  return v;
};

export const heroArt = (id: HeroId) => cached(`hero:${id}`, () => portraitFrames(id));
export const weaponArt = (k: WeaponKind) => cached(`weapon:${k}`, () => [WEAPON_ICONS[k]]);
export const relicArt = (id: RelicId) => cached(`relic:${id}`, () => [RELIC_ICONS[id]]);
export const elixirArt = (id: ElixirId) => cached(`elixir:${id}`, () => [ELIXIR_ICONS[id]]);
export const charmArt = (id: CharmId) => cached(`charm:${id}`, () => [CHARM_ICONS[id]]);
/** 十绝阵（第二章的地形）：阵台亮着的样子（台子 + 叠上去的光；幡类是猎猎的几帧）。 */
export const tenArt = (k: string) =>
  cached(`ten:${k}`, () => {
    const a = daisArt(k);
    return a.flutter.map((g, i) => compose(g.w, g.h, [{ g, x: 0, y: 0 }, { g: a.litFlutter[i % a.litFlutter.length], x: 0, y: 0 }]));
  });
export const foeArt = (k: EnemyKindName) => cached(`foe:${k}`, () => FOE_FRAMES[k]?.() ?? [BLOT]);
export const bossArt = (kind: string) => cached(`boss:${kind}`, () => BOSS_FRAMES[kind]?.() ?? [BLOT]);

/** 各章的精英（按 Enemy.elite）：走路的几帧。 */
const ELITE_ART: Record<EliteKind, () => Grid[]> = {
  xiaowei: () => ELITE_FRAMES.walk,
  yecha: () => YECHA_FRAMES.walk,
  lishi: () => LISHI_FRAMES.walk,
  jianshi: () => JIANSHI_FRAMES.walk,
};
export const eliteArt = (k: EliteKind) => cached(`elite:${k}`, () => ELITE_ART[k]());
/** 精英词缀：东海夜叉的一头乱发换成这条词缀的颜色（个子紧凑、格子里画得大，头发一大片、一眼看得出颜色）。 */
export const affixArt = (a: EliteAffix) => cached(`affix:${a}`, () => YECHA_FRAMES.walk.map((g) => accentize(g, a)));
/** 剪影（按第一帧）。 */
export const silhouetteOf = (gs: Grid[]) => cached(`sil:${gs[0].rows.join('/')}`, () => [silhouette(gs[0])]);
