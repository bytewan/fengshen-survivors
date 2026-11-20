// 回响云霄的招式（敌人版的混元金斗、九曲黄河、青鸾；状态机、危险物的推进与判定在 index.ts）。
// 一阶段：混元金斗（斗悬在你头顶附近，把人往斗下吸，片刻后扣下——顶着吸力走出中间那一圈）、九曲黄河（脚下翻起一圈旋涡，一阵阵冲刷）、
// 青鸾掠过（一条直线）；二阶段：斗吸得更猛，再加黄河阵（你四周和脚下一起翻起旋涡，从斜角的空当里走出去）。
// 每一招都先亮淡红光（预警）、再结算；预警的形状就是判定范围（按人物脚下算）。纯函数、确定性：随机数只用 w.rng。
import { ECHO_YUNXIAO as Y } from './config.ts';
import type { EchoMove } from './types.ts';
import type { Player } from '../types.ts';
import { addHazard, at, clampIn, face, type MoveScript } from './kit.ts';

const vel = (p: Player): [number, number] => [(p.x - p.px) * 60, (p.y - p.py) * 60];

export const YUNXIAO_MOVES: Partial<Record<EchoMove, MoveScript>> = {
  // 混元金斗：斗悬在人物头顶（往他走的方向提前一点），预警的这一段一直把人往斗下吸，然后扣下（只打中间那一圈）
  dou(w, f, e, p, ev) {
    const D = Y.dou;
    if (at(f, 0)) {
      face(f, e, p.x);
      const [vx, vy] = vel(p);
      const c = clampIn(p.x + vx * D.lead, p.y + vy * D.lead, 20);
      addHazard(w, f, { kind: 'pull', move: 'dou', warn: D.warn, live: 0.12, x0: c.x, y0: c.y, x1: c.x, y1: c.y, r: D.r, core: D.core, pull: D.pull * D.pullMul[f.phase], dmg: D.dmg * f.mul, kb: D.kb }, ev);
    }
    return !f.hazards.some((h) => h.move === 'dou');
  },
  // 九曲黄河：脚下翻起一圈旋涡（预警），然后一阵阵冲刷（每 tick 秒打一下，被冲开一点）
  river(w, f, e, p, ev) {
    const R = Y.river;
    if (at(f, 0)) {
      face(f, e, p.x);
      const [vx, vy] = vel(p);
      const c = clampIn(p.x + vx * R.lead, p.y + vy * R.lead, 16);
      addHazard(w, f, { kind: 'disk', move: 'river', warn: R.warn, live: R.live, x0: c.x, y0: c.y, x1: c.x, y1: c.y, r: R.r, dmg: R.dmg * f.mul, kb: R.kb, tick: R.tick, next: 0 }, ev);
    }
    return f.t >= R.warn; // 旋涡翻起来就收招（冲刷着的时候她接着出别的招）
  },
  // 青鸾掠过：从她身边穿过人物的一条直线（青鸾的影子贴着地掠过去）
  luan(w, f, e, p, ev) {
    const L = Y.luan;
    if (at(f, 0)) {
      face(f, e, p.x);
      const a = Math.atan2(p.y - e.y, p.x - e.x);
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const end = clampIn(e.x + ux * L.len, e.y + uy * L.len, 4);
      addHazard(w, f, { kind: 'lane', move: 'luan', warn: L.warn, live: L.live, x0: e.x + ux * 10, y0: e.y + uy * 10, x1: end.x, y1: end.y, r: L.hw, dmg: L.dmg * f.mul, kb: 0 }, ev);
    }
    return !f.hazards.some((h) => h.move === 'luan');
  },
  // 黄河阵（二阶段）：脚下一处先翻起来，四周四处随后跟上（摆成一个转过一点的方块），只有斜角上留着空当
  formation(w, f, e, p, ev) {
    const F = Y.formation;
    if (at(f, 0)) {
      face(f, e, p.x);
      const c = clampIn(p.x, p.y, F.ring * 0.5);
      const a0 = w.rng.next() * Math.PI * 0.5;
      addHazard(w, f, { kind: 'disk', move: 'formation', warn: F.warn, live: F.live, x0: c.x, y0: c.y, x1: c.x, y1: c.y, r: F.r, dmg: F.dmg * f.mul, kb: F.kb, tick: F.tick, next: 0 }, ev);
      for (let k = 0; k < F.n; k++) {
        const a = a0 + (k / F.n) * Math.PI * 2;
        const q = clampIn(c.x + Math.cos(a) * F.ring, c.y + Math.sin(a) * F.ring, 8);
        addHazard(w, f, { kind: 'disk', move: 'formation', warn: F.warn + 0.3, live: F.live, x0: q.x, y0: q.y, x1: q.x, y1: q.y, r: F.r, dmg: F.dmg * f.mul, kb: F.kb, tick: F.tick, next: 0, seq: k + 1 }, ev);
      }
    }
    return f.t >= F.warn + 0.3;
  },
  // 九曲黄河（当首领的三阶段）：旋涡沿一条左右摆的线从她脚前一处接一处翻过去，穿过人物、再往前排几处——往线的两侧走出去。
  // 危险物记成 river（画面、声音照九曲黄河）
  jiuqu(w, f, e, p, ev) {
    const J = Y.jiuqu;
    if (at(f, 0)) {
      face(f, e, p.x);
      const a = Math.atan2(p.y - e.y, p.x - e.x);
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const side = w.rng.next() < 0.5 ? 1 : -1;
      // 第一处离她 first 远：让人物正好落在线的中段
      const d0 = Math.max(24, Math.hypot(p.x - e.x, p.y - e.y) - J.step * (J.n * 0.45));
      for (let i = 0; i < J.n; i++) {
        const along = d0 + i * J.step;
        const off = Math.sin((i / (J.n - 1)) * Math.PI * 2.5) * J.sway * side;
        const q = clampIn(e.x + ux * along - uy * off, e.y + uy * along + ux * off, 10);
        addHazard(w, f, { kind: 'disk', move: 'river', warn: J.warn + i * J.gap, live: J.live, x0: q.x, y0: q.y, x1: q.x, y1: q.y, r: J.r, dmg: J.dmg * f.mul, kb: J.kb, tick: J.tick, next: 0, seq: i + 1 }, ev);
      }
    }
    return f.t >= J.warn + (J.n - 1) * J.gap;
  },
};

/** 每一招收招多久（缺省 ECHO.recover）。 */
export const YUNXIAO_RECOVER: Partial<Record<EchoMove, number>> = { river: 0.3, formation: 0.4, jiuqu: 0.6 };
