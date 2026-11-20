// 首领池（sim/bosspool.ts）在表现层的公共小件：池里的每一位都有两种打法（当首领 / 来遭遇战），画面是同一套，
// 只是流程的事件不一样（当首领 bossIntro / bossPhase / bossDeath，来遭遇战 echoIntro / echoPhase / echoDefeat / echoLeave）。
// 各位的画面模块（boss-fx、ch2/yao-fx、ch3/zhuxian-fx）在 onEvent 开头用 guestAsBoss 把「自己来遭遇战」的三个事件
// 换成当首领时的那三个，原来的入场、换阶段、倒下的画面原样用；退走（echoLeave）用下面的 Leaving 淡出去。
import type { Sprite } from 'pixi.js';
import { bossChapter, type BossId } from '../sim/bosspool.ts';
import type { SimEvent } from '../sim/types.ts';
import type { Particles } from '../render/juice.ts';

/** 遭遇战的三个流程事件（是 kind 这一位的）换成首领战的写法；别的事件原样返回。 */
export function guestAsBoss(e: SimEvent, kind: BossId): SimEvent {
  switch (e.t) {
    case 'echoIntro':
      return e.kind === kind ? { t: 'bossIntro', id: e.id, kind, x: e.x, y: e.y, chapter: bossChapter(kind) } : e;
    case 'echoPhase':
      return e.kind === kind ? { t: 'bossPhase', id: e.id, phase: e.phase, x: e.x, y: e.y } : e;
    case 'echoDefeat':
      return e.kind === kind ? { t: 'bossDeath', id: e.id, kind, x: e.x, y: e.y, facing: e.facing, chapter: bossChapter(kind) } : e;
    default:
      return e;
  }
}

/**
 * 退走：这一波结束还没打倒。身子不是一下没了——留在原地慢慢淡下去、往上散成一缕烟（用户口径：出现和消失都有过程）。
 * 把还在场上的精灵交给它（之后归它销毁）。
 */
export class Leaving {
  private items: { parts: Sprite[]; x: number; y: number; t: number; colors: number[] }[] = [];
  private sparks: Particles;
  constructor(sparks: Particles) {
    this.sparks = sparks;
  }
  /** parts：身子、影子、身后的剑……（null 的不管）；colors：散开的烟的颜色。 */
  add(parts: (Sprite | null | undefined)[], x: number, y: number, colors: number[]) {
    const ps = parts.filter((p): p is Sprite => !!p);
    if (!ps.length) return;
    this.items.push({ parts: ps, x, y, t: 0, colors });
    for (let i = 0; i < 14; i++) this.sparks.emit(x + (Math.random() - 0.5) * 14, y - Math.random() * 22, 1, colors, [4, 14], [0.6, 1.1], { up: 16, drag: 1.4 });
  }
  update(dt: number) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      const was = it.t;
      it.t += dt;
      const k = Math.min(1, it.t / 0.9);
      for (const p of it.parts) p.alpha = Math.min(p.alpha, 1 - k * k);
      if (Math.floor(it.t / 0.07) !== Math.floor(was / 0.07)) this.sparks.emit(it.x + (Math.random() - 0.5) * 12, it.y - 4 - Math.random() * 20, 1, it.colors, [3, 9], [0.5, 0.9], { up: 14, drag: 1.2 });
      if (k >= 1) {
        for (const p of it.parts) p.destroy();
        this.items.splice(i, 1);
      }
    }
  }
  clear() {
    for (const it of this.items) for (const p of it.parts) p.destroy();
    this.items = [];
  }
}
