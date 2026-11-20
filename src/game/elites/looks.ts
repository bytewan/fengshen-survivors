// 各章精英的画面（查表，接口同 enemy-views.ts 的 FoeLook）：回响校尉、东海夜叉、金光力士、截教剑侍。
// enemy-views 遇到 kind 'elite' 的敌人就按 Enemy.elite 来这里取（eliteLook）；帧按动作挑，身上那一处词缀色按第一条词缀换（ACCENT）。
// 东海夜叉沉进水里 / 冒出水面时，精灵从脚下往上一截一截地「没进地里」（按像素行裁掉下半截、往下挪），没有遮罩也不会露到地面以下；
// 潜在水里的那一段（hidden）enemy-views 整只藏起来，水下的涟漪、背鳍在 elites/fx.ts 里画。只读模拟状态，不回写。
import type { Sprite, Texture } from 'pixi.js';
import { flashTextureFromGrid, textureFromGrid } from '../../render/textures.ts';
import type { Grid } from '../../art/pixel.ts';
import { ELITE_ANCHOR, ELITE_H, ELITE_W, eliteFlagFrames } from '../../art/sprites/elite.ts';
import {
  ACCENT,
  JIANSHI_ANCHOR,
  JIANSHI_EYE,
  JIANSHI_FRAMES,
  JIANSHI_H,
  JIANSHI_W,
  LISHI_ANCHOR,
  LISHI_EYES,
  LISHI_FRAMES,
  LISHI_H,
  LISHI_W,
  YECHA_ANCHOR,
  YECHA_EYE,
  YECHA_FRAMES,
  YECHA_H,
  YECHA_W,
  accentize,
  type AccentKey,
} from '../../art/elites/sprites.ts';
import { ELITES } from '../../sim/elites/config.ts';
import type { Enemy } from '../../sim/types.ts';
import type { EliteKind } from '../../sim/elites/types.ts';
import type { FoeClock, FoeLook } from '../enemy-views.ts';

const CYAN = 0x7cc4c4;
type Tex = { n: Texture[]; f: Texture[] };
const tex = (gs: Grid[]): Tex => ({ n: gs.map(textureFromGrid), f: gs.map(flashTextureFromGrid) });
const anchorOf = (a: { x: number; y: number }, w: number, h: number): [number, number] => [a.x / w, a.y / h];
const towardHero = (e: Enemy, hx: number): 1 | -1 => (hx >= e.x ? 1 : -1);
const prog = (e: Enemy) => (e.actLen ? 1 - Math.max(0, e.actT ?? 0) / e.actLen : 0);
const moved = (e: Enemy) => Math.abs(e.x - e.px) + Math.abs(e.y - e.py) > 0.05;
const fi4 = (c: FoeClock, fps = 6) => Math.floor(c.t * fps) % 4;
const pick = (t: Tex, c: FoeClock, i: number) => (c.flash > 0 ? t.f : t.n)[i];

/** 这只精英身上的词缀色按哪一条（两条时按第一条；不带 = none）。 */
export const accentOf = (e: Enemy): AccentKey => e.affixes?.[0] ?? 'none';

/** 每种词缀色一套帧（第一次用到才生成）。 */
function perAccent<T>(make: (k: AccentKey) => T): (k: AccentKey) => T {
  const cache = new Map<AccentKey, T>();
  return (k) => {
    let v = cache.get(k);
    if (!v) cache.set(k, (v = make(k)));
    return v;
  };
}

/**
 * 「没进地里」：把一张帧从下往上裁掉 n 行，精灵整体往下挪 n 像素（看起来是一截一截沉进地面）；锚点跟着改，脚底那一行始终在地面上。
 * 返回裁好的纹理和这张纹理该用的锚点 y。
 */
function sunk(cache: Map<string, { t: Texture; ay: number }>, key: string, g: Grid, n: number, anchorY: number): { t: Texture; ay: number } {
  const k = `${key}:${n}`;
  let v = cache.get(k);
  if (!v) {
    const h = Math.max(1, g.h - n);
    const cut: Grid = { w: g.w, h, rows: g.rows.slice(0, h) };
    v = { t: textureFromGrid(cut), ay: (anchorY - n) / h };
    cache.set(k, v);
  }
  return v;
}

let cache: Record<EliteKind, FoeLook> | null = null;

/** 这只精英的画法（按 Enemy.elite；没有 = 回响校尉）。第一次调用时生成纹理（要在 Pixi 起来之后）。 */
export function eliteLook(e: Enemy): FoeLook {
  return eliteLooks()[e.elite ?? 'xiaowei'];
}

export function eliteLooks(): Record<EliteKind, FoeLook> {
  if (cache) return cache;
  // ---- 回响校尉：只换靠旗的颜色 ----
  // 带了词缀：旗面用这条词缀的中档、外缘那一道用亮档（整面旗都换了颜色，不再是朱砂旗面金边）
  const captain = perAccent((k) => {
    if (k === 'none') return tex(eliteFlagFrames('e', 'y').walk);
    const [light, mid] = ACCENT[k];
    return tex(eliteFlagFrames(mid, light).walk);
  });
  // ---- 东海夜叉 ----
  const yecha = perAccent((k) => {
    const map = (gs: Grid[]) => gs.map((g) => accentize(g, k));
    return { walk: tex(map(YECHA_FRAMES.walk)), raise: tex(map(YECHA_FRAMES.raise)), slam: tex(map(YECHA_FRAMES.slam)), crouch: tex(map(YECHA_FRAMES.crouch)), grids: { crouch: map(YECHA_FRAMES.crouch)[0] } };
  });
  const sinkCache = new Map<string, { t: Texture; ay: number }>();
  const YA = anchorOf(YECHA_ANCHOR, YECHA_W, YECHA_H);
  type YPose = 'walk' | 'raise' | 'slam' | 'crouch';
  const yPose = (e: Enemy, c: FoeClock): [YPose, number] => {
    if (e.act === 'windup') return ['raise', prog(e) < 0.5 ? 0 : 1];
    if (e.act === 'strike') return ['slam', 0];
    if (e.act === 'rest' || e.act === 'dive' || e.act === 'under' || e.act === 'rise') return ['crouch', 0];
    return ['walk', moved(e) ? fi4(c) : 0];
  };
  // ---- 金光力士 ----
  const lishi = perAccent((k) => ({ walk: tex(LISHI_FRAMES.walk.map((g) => accentize(g, k))), cast: tex(LISHI_FRAMES.cast.map((g) => accentize(g, k))) }));
  // ---- 截教剑侍 ----
  const jianshi = perAccent((k) => ({ walk: tex(JIANSHI_FRAMES.walk.map((g) => accentize(g, k))), cast: tex(JIANSHI_FRAMES.cast.map((g) => accentize(g, k))) }));

  cache = {
    xiaowei: {
      top: 40,
      big: true,
      anchor: anchorOf(ELITE_ANCHOR, ELITE_W, ELITE_H),
      shadow: 'big',
      eyes: [{ x: 0, y: -25, color: 0xd9452b, alpha: 0.7 }],
      bar: 40,
      frame: (e, c) => pick(captain(accentOf(e)), c, fi4(c)),
      bob: (_e, c) => fi4(c) % 2,
      facing: towardHero,
      dead: (e, c) => captain(accentOf(e)).f[fi4(c)],
    },
    yecha: {
      top: 34,
      big: true,
      anchor: YA,
      shadow: 'big',
      eyes: [{ x: YECHA_EYE.x, y: YECHA_EYE.y, color: CYAN, alpha: 0.65 }],
      bar: 35,
      frame(e, c) {
        const [pose, i] = yPose(e, c);
        return pick(yecha(accentOf(e))[pose], c, i);
      },
      bob: (e, c) => (yPose(e, c)[0] === 'walk' ? fi4(c) % 2 : yPose(e, c)[0] === 'crouch' ? 2 : yPose(e, c)[0] === 'slam' ? 1 : 0),
      facing: (e, hx) => (e.act === 'windup' || e.act === 'strike' ? ((e.aimX ?? 1) >= 0 ? 1 : -1) : towardHero(e, hx)),
      dead(e, c) {
        const [pose, i] = yPose(e, c);
        return yecha(accentOf(e))[pose].f[i];
      },
      decorate(s, e, c, x, y, _dir, ctx) {
        s.anchor.set(YA[0], YA[1]);
        // 沉进水里（dive 的 sink 秒）：从脚下往上一截一截没进地里；冒出水面后的第一段（rest 的前 0.3 秒）反过来升上来
        const D = ELITES.yecha.dive;
        let n = 0;
        if (e.act === 'dive') n = Math.round(Math.min(1, prog(e)) * (YECHA_ANCHOR.y - 2));
        else if (e.act === 'rest' && e.actLen && Math.abs(e.actLen - D.rest) < 1e-6) {
          const t = (e.actLen - (e.actT ?? 0)) / 0.3;
          if (t < 1) n = Math.round((1 - t) * (YECHA_ANCHOR.y - 2));
        }
        if (n > 0) {
          const v = sunk(sinkCache, accentOf(e), yecha(accentOf(e)).grids.crouch, n, YECHA_ANCHOR.y);
          s.texture = v.t;
          s.anchor.set(YA[0], v.ay);
          if (Math.random() < 0.5) ctx.glows.emit(x + (Math.random() - 0.5) * 16, y - 1, 1, [CYAN, 0xf2e8d5], [10, 30], [0.25, 0.45], { up: 14, drag: 3 });
        }
        // 拍浪举叉的第二段：叉头上聚着的水往下滴
        if (e.act === 'windup' && prog(e) > 0.5 && Math.random() < 0.4) ctx.glows.emit(x + _dir * 9, y - 32, 1, [CYAN, 0xffffff], [6, 16], [0.2, 0.35], { g: 60 });
        void c;
      },
    },
    lishi: {
      top: 40,
      big: true,
      anchor: anchorOf(LISHI_ANCHOR, LISHI_W, LISHI_H),
      shadow: 'big',
      eyes: LISHI_EYES.map((p) => ({ x: p.x, y: p.y, color: CYAN, alpha: 0.6 })),
      bar: 42,
      frame(e, c) {
        if (e.act === 'cast') return pick(lishi(accentOf(e)).cast, c, prog(e) < 0.5 ? 0 : 1);
        if (e.act === 'rest') return pick(lishi(accentOf(e)).cast, c, 1);
        return pick(lishi(accentOf(e)).walk, c, moved(e) ? fi4(c, 5) : 0);
      },
      bob: (e, c) => (e.act ? 0 : moved(e) ? fi4(c, 5) % 2 : 0),
      facing: towardHero,
      dead: (e, c) => (e.act === 'cast' || e.act === 'rest' ? lishi(accentOf(e)).cast.f[1] : lishi(accentOf(e)).walk.f[fi4(c, 5)]),
      decorate(_s, e, _c, x, y, dir, ctx) {
        // 举旗：旗面上的方胜亮起来，金屑从旗面往上飘（不画光圈）
        if (e.act === 'cast' && Math.random() < 0.5) ctx.glows.emit(x + dir * (9 - Math.random() * 9), y - 34 - Math.random() * 6, 1, [0xf7dc7a, 0xffe9a8, 0xe0a83a], [8, 20], [0.3, 0.6], { up: 16, drag: 2 });
      },
    },
    jianshi: {
      top: 31,
      big: true,
      anchor: anchorOf(JIANSHI_ANCHOR, JIANSHI_W, JIANSHI_H),
      shadow: 'big',
      eyes: [{ x: JIANSHI_EYE.x, y: JIANSHI_EYE.y, color: CYAN, alpha: 0.6 }],
      bar: 31,
      frame(e, c) {
        if (e.act === 'windup') return pick(jianshi(accentOf(e)).cast, c, prog(e) < 0.5 ? 0 : 1);
        return pick(jianshi(accentOf(e)).walk, c, moved(e) ? fi4(c, 4) : 0);
      },
      bob: (e, c) => (e.act === 'windup' ? 0 : moved(e) ? fi4(c, 4) % 2 : 0),
      facing: (e, hx) => (e.act === 'windup' ? ((e.aimX ?? 1) >= 0 ? 1 : -1) : towardHero(e, hx)),
      dead: (e, c) => (e.act === 'windup' ? jianshi(accentOf(e)).cast.f[1] : jianshi(accentOf(e)).walk.f[fi4(c, 4)]),
    },
  };
  return cache;
}

/** 精英身上点缀词缀的几处（相对脚底，朝右时；朝左镜像）：两肩、胸口——坚甲的金甲片在这里一闪一闪。 */
export const ELITE_BODY: Record<EliteKind, { chest: [number, number]; shoulders: [number, number][]; feet: number; hand: [number, number] }> = {
  xiaowei: { chest: [0, -19], shoulders: [[-6, -22], [6, -22]], feet: 7, hand: [8, -18] },
  yecha: { chest: [0, -18], shoulders: [[-5, -21], [5, -21]], feet: 6, hand: [7, -16] },
  lishi: { chest: [0, -15], shoulders: [[-6, -18], [6, -18]], feet: 7, hand: [9, -13] },
  jianshi: { chest: [1, -14], shoulders: [[-3, -17], [3, -17]], feet: 6, hand: [4, -14] },
};

export type { Sprite };
