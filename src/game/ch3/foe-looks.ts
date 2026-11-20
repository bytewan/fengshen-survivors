// 第三章三种新敌人的画法（并进 enemy-views.ts 的 foeLooks 表）：飞剑灵、截教门徒、阵图傀儡。
// 接口照 enemy-views.FoeLook：锚点、影子、眼光、每帧的纹理、朝向、死亡帧、额外的粒子。用户口径：不画光圈、动画不要太快。
// 飞剑灵的三柄剑按剑尖朝向各画了一张（art/ch3/foes.ts 的 FLY_FRAMES），不左右镜像；剑气、瞄准线、剑气线在 ch3/foe-fx.ts。
import type { Texture } from 'pixi.js';
import { flashTextureFromGrid, textureFromGrid } from '../../render/textures.ts';
import type { Grid } from '../../art/pixel.ts';
import { DISCIPLE_ANCHOR, DISCIPLE_FRAMES, DISCIPLE_H, DISCIPLE_HAND, DISCIPLE_W, FLY_ANCHOR, FLY_FRAMES, FLY_H, FLY_HOVER, FLY_W, PUPPET_ANCHOR, PUPPET_CORE, PUPPET_FRAMES, PUPPET_H, PUPPET_W, flyDir } from '../../art/ch3/foes.ts';
import type { Enemy } from '../../sim/types.ts';
import type { FoeClock, FoeLook } from '../enemy-views.ts';

const tex = (gs: Grid[]) => ({ n: gs.map(textureFromGrid), f: gs.map(flashTextureFromGrid) });
const anchorOf = (a: { x: number; y: number }, w: number, h: number): [number, number] => [a.x / w, a.y / h];
const towardHero = (e: Enemy, hx: number): 1 | -1 => (hx >= e.x ? 1 : -1);
const moved = (e: Enemy) => Math.abs(e.x - e.px) + Math.abs(e.y - e.py) > 0.05;
const fi4 = (c: FoeClock, fps = 6) => Math.floor(c.t * fps) % 4;
const CYAN = 0x7cc4c4;
const SILVER = [0xc3ccd2, 0x8d9aa6, 0xffffff];

export { DISCIPLE_HAND, PUPPET_CORE, FLY_HOVER };

export function ch3Looks(): Record<'flysword' | 'disciple' | 'puppet', FoeLook> {
  const fly = FLY_FRAMES.map(tex);
  const dis = { walk: tex(DISCIPLE_FRAMES.walk), cast: tex(DISCIPLE_FRAMES.cast) };
  const pup = tex(PUPPET_FRAMES.walk);
  const pick = (t: { n: Texture[]; f: Texture[] }, c: FoeClock, i: number) => (c.flash > 0 ? t.f : t.n)[i];
  const flyFrame = (e: Enemy, c: FoeClock, flash: boolean) => {
    const d = flyDir(e.face ?? 0);
    const i = e.act === 'windup' ? Math.floor(c.t * 10) % 2 : Math.floor(c.t * 3) % 2;
    return (flash ? fly[d].f : fly[d].n)[i];
  };
  return {
    flysword: {
      top: 22,
      anchor: anchorOf(FLY_ANCHOR, FLY_W, FLY_H),
      shadow: 'small',
      eyes: [],
      frame: (e, c) => flyFrame(e, c, c.flash > 0),
      bob: (e, c) => (e.act ? 0 : Math.round(Math.sin(c.t * 3) * 1)),
      facing: () => 1,
      dead: (e, c) => flyFrame(e, c, true),
      decorate(s, e, c, x, y, _dir, ctx) {
        // 悬空：剑离地 FLY_HOVER 像素（画布里已经让出来了），慢慢上下浮；射出去时拖一道冷银的剑光残影
        s.y = y + (e.act ? 0 : Math.round(Math.sin(c.t * 3) * 1));
        if (e.act === 'strike') {
          c.trail -= ctx.dt;
          if (c.trail <= 0) {
            c.trail = 0.03;
            ctx.ghost(s.texture, x, s.y, 1, [s.anchor.x, s.anchor.y], 0xc3ccd2, 0.4, 0.2);
          }
        } else if (Math.random() < 0.1) {
          const a = e.face ?? 0;
          ctx.glows.emit(x - Math.cos(a) * 14, y - FLY_HOVER - Math.sin(a) * 14, 1, SILVER, [2, 8], [0.25, 0.45], { drag: 2 });
        }
      },
    },
    disciple: {
      top: 27,
      anchor: anchorOf(DISCIPLE_ANCHOR, DISCIPLE_W, DISCIPLE_H),
      shadow: 'small',
      eyes: [{ x: 1, y: -22, color: CYAN, alpha: 0.45 }],
      frame: (e, c) => (e.act === 'windup' ? pick(dis.cast, c, Math.floor(c.t * 6) % 2) : pick(dis.walk, c, moved(e) ? fi4(c, 4) : 0)),
      bob: (e, c) => (e.act === 'windup' ? 0 : moved(e) ? fi4(c, 4) % 2 : 0),
      facing: towardHero,
      dead: (e, c) => (e.act === 'windup' ? dis.cast.f[Math.floor(c.t * 6) % 2] : dis.walk.f[fi4(c, 4)]),
      decorate(_s, e, _c, x, y, dir, ctx) {
        // 抬手的时候指尖聚起一点剑气（冷银、天青的碎光往指尖收）
        if (e.act === 'windup' && Math.random() < 0.6) {
          const hx = x + dir * DISCIPLE_HAND.x;
          const hy = y + DISCIPLE_HAND.y;
          const a = Math.random() * Math.PI * 2;
          ctx.glows.emit(hx + Math.cos(a) * 6, hy + Math.sin(a) * 4, 1, [CYAN, 0xc3ccd2, 0xffffff], [8, 18], [0.15, 0.3], { dir: a + Math.PI, spread: 0.2, drag: 1 });
        }
      },
    },
    puppet: {
      top: 24,
      anchor: anchorOf(PUPPET_ANCHOR, PUPPET_W, PUPPET_H),
      shadow: 'small',
      eyes: [
        { x: -1, y: -18, color: CYAN, alpha: 0.35 },
        { x: 2, y: -18, color: CYAN, alpha: 0.35 },
      ],
      frame: (e, c) => pick(pup, c, moved(e) ? fi4(c, 3) : 0),
      bob: (e, c) => (moved(e) ? fi4(c, 3) % 2 : 0),
      facing: towardHero,
      dead: (_e, c) => pup.f[fi4(c, 3)],
    },
  };
}
