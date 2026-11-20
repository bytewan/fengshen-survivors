// 第二章三种新敌人的画法（并进 enemy-views.ts 的 foeLooks 表）：落魂幡手、红沙傀儡、风吼妖。
// 接口照 enemy-views.FoeLook：锚点、影子、眼光、每帧的纹理、朝向、死亡帧、额外的粒子。用户口径：不画光圈、动画不要太快。
import type { Texture } from 'pixi.js';
import { flashTextureFromGrid, textureFromGrid } from '../../render/textures.ts';
import type { Grid } from '../../art/pixel.ts';
import { BANNERMAN_ANCHOR, BANNERMAN_FRAMES, BANNERMAN_H, BANNERMAN_W, BANNER_TIP, GOLEM_ANCHOR, GOLEM_FRAMES, GOLEM_H, GOLEM_W, WIND_ANCHOR, WIND_FRAMES, WIND_H, WIND_W } from '../../art/ch2/foes.ts';
import { SOULFLAG_ANCHOR, SOULFLAG_FRAMES, SOULFLAG_H, SOULFLAG_TIP, SOULFLAG_W, STRAW_ANCHOR, STRAW_FRAMES, STRAW_H, STRAW_W } from '../../art/ch2/yao.ts';
import type { Enemy } from '../../sim/types.ts';
import type { FoeClock, FoeLook } from '../enemy-views.ts';

const tex = (gs: Grid[]) => ({ n: gs.map(textureFromGrid), f: gs.map(flashTextureFromGrid) });
const anchorOf = (a: { x: number; y: number }, w: number, h: number): [number, number] => [a.x / w, a.y / h];
const towardHero = (e: Enemy, hx: number): 1 | -1 => (hx >= e.x ? 1 : -1);
const moved = (e: Enemy) => Math.abs(e.x - e.px) + Math.abs(e.y - e.py) > 0.05;
const fi4 = (c: FoeClock, fps = 6) => Math.floor(c.t * fps) % 4;
const CYAN = 0x7cc4c4;

/** 幡头（魂光的出处）相对脚底的位置（朝右；朝左时 x 取反）。表现层画魂光用。 */
export const BANNER_TOP = BANNER_TIP;

export function ch2Looks(): Record<'bannerman' | 'golem' | 'windfiend' | 'soulflag' | 'strawman', FoeLook> {
  const ban = tex(BANNERMAN_FRAMES.walk);
  const gol = tex(GOLEM_FRAMES.walk);
  const wind = { fly: tex(WIND_FRAMES.fly), windup: tex(WIND_FRAMES.windup), dash: tex(WIND_FRAMES.dash) };
  const windPose = (e: Enemy, c: FoeClock): [keyof typeof wind, number] => {
    if (e.act === 'windup') return ['windup', Math.floor(c.t * 8) % 2];
    if (e.act === 'strike') return ['dash', Math.floor(c.t * 14) % 2];
    return ['fly', Math.floor(c.t * 7) % 4];
  };
  const pick = (t: { n: Texture[]; f: Texture[] }, c: FoeClock, i: number) => (c.flash > 0 ? t.f : t.n)[i];
  const flag = tex(SOULFLAG_FRAMES);
  const straw = tex(STRAW_FRAMES);
  return {
    // 姚天君插的落魂幡：不动，幡面慢慢摆，幡头的魂火往上飘（魂线由 ch2/yao-fx.ts 画）
    soulflag: {
      top: 31,
      anchor: anchorOf(SOULFLAG_ANCHOR, SOULFLAG_W, SOULFLAG_H),
      shadow: 'small',
      eyes: [],
      frame: (_e, c) => pick(flag, c, Math.floor(c.t * 2.5) % 2),
      bob: () => 0,
      facing: () => 1,
      dead: (_e, c) => flag.f[Math.floor(c.t * 2.5) % 2],
      decorate(_s, _e, _c, x, y, _dir, ctx) {
        if (Math.random() < 0.3) ctx.glows.emit(x + SOULFLAG_TIP.x, y + SOULFLAG_TIP.y - 1, 1, [CYAN, 0xffffff], [4, 10], [0.3, 0.6], { up: 12 });
      },
    },
    // 草人：不动，稻草微微抖（倒计时由 ch2/yao-fx.ts 画在头顶）
    strawman: {
      top: 22,
      anchor: anchorOf(STRAW_ANCHOR, STRAW_W, STRAW_H),
      shadow: 'small',
      eyes: [],
      frame: (e, c) => pick(straw, c, (e.actT ?? 9) < 2.5 ? Math.floor(c.t * 10) % 2 : Math.floor(c.t * 2) % 2),
      bob: () => 0,
      facing: () => 1,
      dead: (_e, c) => straw.f[Math.floor(c.t * 2) % 2],
    },
    bannerman: {
      top: 31,
      anchor: anchorOf(BANNERMAN_ANCHOR, BANNERMAN_W, BANNERMAN_H),
      shadow: 'small',
      eyes: [{ x: -2, y: -14, color: CYAN, alpha: 0.5 }],
      frame: (e, c) => pick(ban, c, moved(e) ? fi4(c, 4) : 0),
      bob: (e, c) => (moved(e) ? fi4(c, 4) % 2 : 0),
      facing: towardHero,
      dead: (_e, c) => ban.f[fi4(c, 4)],
      decorate(_s, e, _c, x, y, dir, ctx) {
        // 幡头的魂火往上飘几粒（连着几只就飘得密一点）
        const n = e.links?.length ?? 0;
        if (Math.random() < 0.12 + n * 0.05) ctx.glows.emit(x + dir * BANNER_TIP.x, y + BANNER_TIP.y, 1, [CYAN, 0xffffff, 0x8a4a7a], [4, 12], [0.3, 0.6], { up: 10 });
      },
    },
    golem: {
      top: 27,
      big: true,
      anchor: anchorOf(GOLEM_ANCHOR, GOLEM_W, GOLEM_H),
      shadow: 'big',
      eyes: [
        { x: -1, y: -19, color: 0xf2814a, alpha: 0.35 },
        { x: 2, y: -19, color: 0xf2814a, alpha: 0.35 },
      ],
      frame: (e, c) => pick(gol, c, moved(e) ? fi4(c, 3) : 0),
      bob: (e, c) => (moved(e) ? fi4(c, 3) % 2 : 0),
      facing: towardHero,
      dead: (_e, c) => gol.f[fi4(c, 3)],
      decorate(_s, e, _c, x, y, dir, ctx) {
        // 身上往下漏的沙粒
        if (moved(e) && Math.random() < 0.3) ctx.sparks.emit(x + (Math.random() - 0.5) * 16, y - 6 - Math.random() * 12, 1, [0xb06a28, 0x9c2a22, 0xa48e6d], [2, 8], [0.3, 0.6], { g: 60, drag: 1 });
        void dir;
      },
    },
    windfiend: {
      top: 18,
      anchor: anchorOf(WIND_ANCHOR, WIND_W, WIND_H),
      shadow: 'small',
      eyes: [],
      frame(e, c) {
        const [pose, i] = windPose(e, c);
        return pick(wind[pose], c, i);
      },
      bob: (e, c) => (e.act ? 0 : [0, -1, -1, 0][Math.floor(c.t * 7) % 4]),
      facing: (e, hx) => (e.act && e.aimX !== undefined ? (e.aimX >= 0 ? 1 : -1) : e.x !== e.px ? (e.x > e.px ? 1 : -1) : towardHero(e, hx)),
      dead(e, c) {
        const [pose, i] = windPose(e, c);
        return wind[pose].f[i];
      },
      decorate(s, e, _c, x, y, dir, ctx) {
        // 飘在半空：身子离地 4 像素，身后拖一缕风
        s.y = y - 4 + Math.round(Math.sin(_c.t * 5) * 1);
        if (Math.random() < (e.act === 'strike' ? 0.9 : 0.35)) ctx.glows.emit(x - dir * 8, y - 9 + (Math.random() - 0.5) * 4, 1, [0xf2e8d5, 0xc9bcae, CYAN], [6, 20], [0.2, 0.45], { dir: dir > 0 ? Math.PI : 0, spread: 0.5, drag: 2 });
        if (e.act === 'strike') {
          _c.trail -= ctx.dt;
          if (_c.trail <= 0) {
            _c.trail = 0.04;
            ctx.ghost(s.texture, x, s.y, dir, [s.anchor.x, s.anchor.y], 0xc9bcae, 0.35, 0.22);
          }
        }
      },
    },
  };
}
