// 劫数在局里的画面（sim/jie.ts）。只读模拟状态与事件，不回写；用户口径：不画光圈，出现、消失都有过程。
//   - 首领进了三阶段狂暴：等换阶段的横幅淡下去，出一条「狂暴」横幅；之后身边一直冒暗红的火星（普通混合的小粒子，不发光）。
// 精英的词缀（原来劫五的那一条）2026-11-11 起归精英那一摊：词缀字、分魂裂开的画面都在 game/elites/affix-fx.ts（分魂裂开的声音借这里的 jie.split）。
// 接进 feel.ts：new JieFx(stage, sparks, glows, banner, sfx)；每帧 update(dt, world, alpha)；重开时 clear()。
import type { Sfx } from '../audio/sfx.ts';
import type { Stage } from '../render/stage.ts';
import type { Particles } from '../render/juice.ts';
import { bossEnraged } from '../sim/jie.ts';
import type { World } from '../sim/world.ts';

/** 狂暴的横幅等多久再出：换阶段的横幅（约 2.8 秒）和首领那句台词（换阶段 1.5 秒后说、停约 3 秒）都放完再出。 */
const RAGE_DELAY = 4.8;

export class JieFx {
  private sparks: Particles;
  private banner: (text: string, kind: 'skill' | 'warn' | 'boss', sub?: string) => void;
  private rage: { id: number; wait: number } | null = null;
  private raged = new Set<number>();
  private ember = 0;
  /** 声音（名字见 docs/audio.md「劫数」）；不给就不出声。 */
  private sfx: Sfx | null;

  constructor(stage: Stage, sparks: Particles, glows: Particles, banner: (text: string, kind: 'skill' | 'warn' | 'boss', sub?: string) => void, sfx?: Sfx) {
    void stage;
    void glows;
    this.sparks = sparks;
    this.banner = banner;
    this.sfx = sfx ?? null;
  }

  update(dt: number, w: World, alpha: number) {
    void alpha;
    // 首领狂暴：进三阶段时记下，等换阶段的横幅淡下去再出「狂暴」；之后一直冒暗红的火星
    const b = w.boss;
    if (b && bossEnraged(w)) {
      if (!this.raged.has(b.id)) {
        this.raged.add(b.id);
        this.rage = { id: b.id, wait: RAGE_DELAY };
      }
      const body = w.enemies.find((e) => e.id === b.id);
      if (body && b.state !== 'phase') {
        this.ember = Math.max(-0.2, this.ember - dt); // 切回标签页时 dt 很大：最多补三粒，不一下子喷一大团
        while (this.ember <= 0) {
          this.ember += 0.07;
          const x = body.x + (Math.random() - 0.5) * 14;
          const y = body.y - 6 - Math.random() * 16;
          this.sparks.emit(x, y, 1, [0x9c2a22, 0x5c1a1b, 0xd9452b], [8, 22], [0.5, 0.9], { up: 26, drag: 2 });
        }
      }
    }
    if (this.rage) {
      this.rage.wait -= dt;
      if (this.rage.wait <= 0) {
        if (w.boss?.id === this.rage.id && w.boss.state !== 'dead') {
          this.banner('狂 暴', 'boss', '劫五 · 两招之间不再喘息');
          this.sfx?.play('jie.rage');
        }
        this.rage = null;
      }
    }
  }

  clear() {
    this.rage = null;
    this.raged.clear();
    this.ember = 0;
  }
}
