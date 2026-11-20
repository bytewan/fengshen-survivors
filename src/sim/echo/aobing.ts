// 回响敖丙的招式（状态机、危险物的推进与判定在 index.ts）。东海龙王三太子：原著里骑避水兽、提画杆戟，在九湾河被哪吒的乾坤圈打死、抽了龙筋——
// 封神榜把他拘回了陈塘关。第一章的首领池里有他（bosspool.ts）：抽到当首领打三个阶段，没抽到就来第 4 波的遭遇战（两个阶段）。
// 一阶段：画戟（一条直线）、冰龙（冰龙沿线游过去，到尽头炸开一片冰）、海浪（几道并排的浪头推过来，当中空着一道）；
// 二阶段：连刺两下、冰炸开后结成冰面，加化龙（化成白龙沿线冲过去，一连两趟，本体跟着走）；
// 三阶段（当首领时）：连刺三下、冰龙两条、化龙三趟，加怒潮（三个方向的浪一阵接一阵）。
// 每一招都先亮淡红光（预警）、再结算；预警的形状就是判定范围（按人物脚下算）。纯函数、确定性：随机数只用 w.rng。
import { ECHO_AOBING as A } from './config.ts';
import type { EchoFight, EchoMove } from './types.ts';
import type { Enemy, Player, SimEvent } from '../types.ts';
import type { World } from '../world.ts';
import { addHazard, at, clampIn, face, type MoveScript } from './kit.ts';

/** 一阵浪：lanes 道并排的浪头沿 (ux, uy) 推过人物所在的那一片，空着第 gap 道。seq 记第几道（表现层排浪头用）。 */
function tideVolley(w: World, f: EchoFight, p: Player, ux: number, uy: number, warn: number, ev: SimEvent[]) {
  const T = A.tide;
  const nx = -uy;
  const ny = ux;
  const mid = (T.lanes - 1) / 2;
  // 空着的那一道：紧挨着人物所在的那一道（当中那道）——往哪边都行，但人物站着不动躲不过去
  const gap = mid + (w.rng.next() < 0.5 ? -1 : 1);
  for (let i = 0; i < T.lanes; i++) {
    if (i === gap) continue;
    const off = (i - mid) * T.hw * 2;
    const cx = p.x + nx * off;
    const cy = p.y + ny * off;
    const a = clampIn(cx - ux * T.reach, cy - uy * T.reach, 4);
    const b = clampIn(cx + ux * T.reach, cy + uy * T.reach, 4);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 30) continue; // 贴着场边、推不出去的那一道不要
    addHazard(w, f, { kind: 'pounce', move: 'tide', warn, live: len / T.speed, x0: a.x, y0: a.y, x1: b.x, y1: b.y, r: T.hw, dmg: T.dmg * f.mul, kb: T.kb, seq: i }, ev);
  }
}

export const AOBING_MOVES: Partial<Record<EchoMove, MoveScript>> = {
  // 画戟连刺：从他身前穿过人物的一条直线；二阶段起连刺几下，每一下重新瞄一次（上一下刺完之前，下一下的线已经亮着）
  ji(w, f, e, p, ev) {
    const J = A.ji;
    const n = J.n[f.phase];
    for (let k = 0; k < n; k++) {
      if (!at(f, k * J.gap)) continue;
      face(f, e, p.x);
      const a = Math.atan2(p.y - e.y, p.x - e.x);
      const end = clampIn(e.x + Math.cos(a) * J.len, e.y + Math.sin(a) * J.len, 4);
      addHazard(w, f, { kind: 'lane', move: 'ji', warn: J.warn, live: J.live, x0: e.x + Math.cos(a) * 8, y0: e.y + Math.sin(a) * 8, x1: end.x, y1: end.y, r: J.hw, dmg: J.dmg * f.mul, kb: 0, seq: k + 1 }, ev);
    }
    return f.t > (n - 1) * J.gap && !f.hazards.some((h) => h.move === 'ji');
  },
  // 冰龙：从戟尖游出去，沿线游到人物身后一点（撞到的挨一下），到尽头炸开一片冰；二阶段起那一片结成冰面留一会儿；三阶段两条
  icelong(w, f, e, p, ev) {
    const I = A.icelong;
    if (at(f, 0)) {
      face(f, e, p.x);
      const sx = e.x + f.facing * 10;
      const sy = e.y;
      const a0 = Math.atan2(p.y - sy, p.x - sx);
      const d = Math.hypot(p.x - sx, p.y - sy);
      const len = Math.max(70, Math.min(I.len[f.phase], d + I.over));
      for (const a of f.phase >= 3 ? [a0 - I.spread, a0 + I.spread] : [a0]) {
        const end = clampIn(sx + Math.cos(a) * len, sy + Math.sin(a) * len, 12);
        const live = Math.hypot(end.x - sx, end.y - sy) / I.speed;
        addHazard(w, f, { kind: 'pounce', move: 'icelong', warn: I.warn, live, x0: sx, y0: sy, x1: end.x, y1: end.y, r: I.hw, dmg: I.dmg * f.mul, kb: 100 }, ev);
        addHazard(w, f, { kind: 'disk', move: 'icelong', warn: I.warn + live + I.burst.after, live: 0.1, x0: end.x, y0: end.y, x1: end.x, y1: end.y, r: I.burst.r, dmg: I.burst.dmg * f.mul, kb: I.burst.kb }, ev);
        // 冰面：炸开之后才结（预警接在炸开后面：炸开那一圈就是它的范围）
        if (f.phase >= 2)
          addHazard(w, f, { kind: 'disk', move: 'icelong', warn: I.warn + live + I.burst.after + 0.35, live: I.frost.live, x0: end.x, y0: end.y, x1: end.x, y1: end.y, r: I.burst.r, dmg: I.frost.dmg * f.mul, kb: 0, tick: I.frost.tick, next: 0, ice: true }, ev);
      }
    }
    // 冰炸开就收招（冰面留着的时候他接着出别的招）
    return f.t > 0 && !f.hazards.some((h) => h.move === 'icelong' && !h.ice);
  },
  // 海浪：从他那一侧横着推过来（浪是横着走的：镜头是 16:9，横着看得全）
  tide(w, f, e, p, ev) {
    if (at(f, 0)) {
      face(f, e, p.x);
      tideVolley(w, f, p, p.x >= e.x ? 1 : -1, 0, A.tide.warn, ev);
    }
    return f.t > 0 && !f.hazards.some((h) => h.move === 'tide');
  },
  // 化龙：化成白龙沿线冲过去（本体跟着这一趟走，f.ride 记着是哪一趟），冲完重新瞄、再冲一趟
  hualong(w, f, e, p, ev) {
    const H = A.hualong;
    if (at(f, 0)) f.step = 0;
    const h = f.hazards.find((x) => x.move === 'hualong');
    if (h) {
      if (h.t >= h.warn) {
        f.ride = h.id;
        e.x = h.x;
        e.y = h.y;
        f.facing = h.x1 >= h.x0 ? 1 : -1;
      }
      return false;
    }
    f.ride = null;
    if (f.step >= H.n[f.phase]) return true;
    // 下一趟：穿过人物现在的位置再往前一截
    const d = Math.hypot(p.x - e.x, p.y - e.y) || 1;
    const ux = (p.x - e.x) / d;
    const uy = (p.y - e.y) / d;
    const len = Math.max(H.len[0], Math.min(H.len[1], d + H.over));
    const end = clampIn(e.x + ux * len, e.y + uy * len, 12);
    face(f, e, p.x);
    addHazard(w, f, { kind: 'pounce', move: 'hualong', warn: H.warn[f.step ? 1 : 0], live: Math.hypot(end.x - e.x, end.y - e.y) / H.speed, x0: e.x, y0: e.y, x1: end.x, y1: end.y, r: H.hw, dmg: H.dmg * f.mul, kb: H.kb, seq: f.step + 1 }, ev);
    f.step++;
    return false;
  },
  // 怒潮（当首领的三阶段）：三阵浪，从左右、上下一阵接一阵推过来，每阵都空着一道
  tsunami(w, f, e, p, ev) {
    const S = A.tsunami;
    for (let k = 0; k < S.waves; k++) {
      if (!at(f, k * S.every)) continue;
      face(f, e, p.x);
      const side = p.x >= e.x ? 1 : -1;
      // 第一阵从他那一侧横着来，第二阵竖着来（上下随机），第三阵从另一侧横着回来
      const [ux, uy] = k === 1 ? [0, w.rng.next() < 0.5 ? 1 : -1] : [k === 0 ? side : -side, 0];
      tideVolley(w, f, p, ux, uy, S.warn, ev);
    }
    return f.t > (S.waves - 1) * S.every && !f.hazards.some((h) => h.move === 'tide');
  },
};

/** 每一招收招多久（缺省 ECHO.recover）。 */
export const AOBING_RECOVER: Partial<Record<EchoMove, number>> = { tide: 0.4, hualong: 0.7, tsunami: 0.8 };

export type { Enemy };
