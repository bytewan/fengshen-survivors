// 回响赵公明的招式（敌人版的定海珠、金鞭、黑虎；状态机、危险物的推进与判定在 index.ts）。
// 一阶段：定海珠砸地（三颗砸在你脚下和身边）、金鞭裂地（一条直线）、黑虎扑吼（虎影沿线扑过来，扑到尽头吼一声震开一圈）；
// 二阶段：珠子五颗、金鞭两条叉开成 V、虎扑得更远，再加二十四珠（一圈珠子围着你依次砸下，最后整圈一起再震）。
// 每一招都先亮淡红光（预警）、再结算；预警的形状就是判定范围（按人物脚下算）。纯函数、确定性：随机数只用 w.rng。
import { ECHO_ZHAO as Z } from './config.ts';
import type { EchoFight, EchoMove } from './types.ts';
import type { Enemy, Player, SimEvent } from '../types.ts';
import type { World } from '../world.ts';
import { addHazard, at, clampIn, face, type MoveScript } from './kit.ts';

/** 人物这一帧的速度（像素 / 秒）：珠子、斗往他走的方向提前一点落。 */
const vel = (p: Player): [number, number] => [(p.x - p.px) * 60, (p.y - p.py) * 60];

export const ZHAO_MOVES: Partial<Record<EchoMove, MoveScript>> = {
  // 定海珠砸地：第一颗砸在人物脚下（往他走的方向提前 lead 秒），其余的绕着它均匀撒开；一颗接一颗砸下（飞的这一段就是预警）
  beads(w, f, e, p, ev) {
    const B = Z.bead;
    if (at(f, 0)) {
      face(f, e, p.x);
      const [vx, vy] = vel(p);
      const c = clampIn(p.x + vx * B.lead, p.y + vy * B.lead, 12);
      const n = B.n[f.phase];
      const a0 = w.rng.next() * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        const q = i === 0 ? c : clampIn(c.x + Math.cos(a0 + ((i - 1) / (n - 1)) * Math.PI * 2) * B.spread, c.y + Math.sin(a0 + ((i - 1) / (n - 1)) * Math.PI * 2) * B.spread * 0.7, 12);
        addHazard(w, f, { kind: 'disk', move: 'beads', warn: B.warn + i * B.gap, live: 0.1, x0: q.x, y0: q.y, x1: e.x, y1: e.y - 14, r: B.r, dmg: B.dmg * f.mul, kb: B.kb }, ev);
      }
    }
    return !f.hazards.some((h) => h.move === 'beads');
  },
  // 金鞭裂地：从他脚前穿过人物的一条直线（二阶段两条，叉开成一个 V：站到两条中间、或者躲到外面）
  whip(w, f, e, p, ev) {
    const W = Z.whip;
    if (at(f, 0)) {
      face(f, e, p.x);
      const a = Math.atan2(p.y - e.y, p.x - e.x);
      const angles = f.phase >= 2 ? [a - W.spread, a + W.spread] : [a];
      for (const b of angles) {
        const ux = Math.cos(b);
        const uy = Math.sin(b);
        const end = clampIn(e.x + ux * W.len, e.y + uy * W.len, 4);
        addHazard(w, f, { kind: 'lane', move: 'whip', warn: W.warn, live: W.live, x0: e.x + ux * 8, y0: e.y + uy * 8, x1: end.x, y1: end.y, r: W.hw, dmg: W.dmg * f.mul, kb: 0 }, ev);
      }
    }
    // 三阶段（当首领时）：V 字之后再补一鞭——重新瞄一次，穿过人物现在的位置
    if (f.phase >= 3 && at(f, W.again)) {
      face(f, e, p.x);
      const a = Math.atan2(p.y - e.y, p.x - e.x);
      const end = clampIn(e.x + Math.cos(a) * W.len, e.y + Math.sin(a) * W.len, 4);
      addHazard(w, f, { kind: 'lane', move: 'whip', warn: W.warn, live: W.live, x0: e.x + Math.cos(a) * 8, y0: e.y + Math.sin(a) * 8, x1: end.x, y1: end.y, r: W.hw, dmg: W.dmg * f.mul, kb: 0 }, ev);
    }
    return (f.phase < 3 || f.t > W.again) && !f.hazards.some((h) => h.move === 'whip');
  },
  // 黑虎扑吼：虎影先在他身边现形（appear 秒），亮出扑的那条线和尽头吼的那一圈；扑过去（撞到的挨一下），到尽头吼一声震开
  tiger(w, f, e, p, ev) {
    const T = Z.tiger;
    if (at(f, 0)) {
      face(f, e, p.x);
      const x = e.x + f.facing * 14;
      const y = e.y + 3;
      f.tiger = { x, y, px: x, py: y, facing: f.facing };
    }
    if (at(f, T.appear) && f.tiger) {
      const tg = f.tiger;
      const d = Math.hypot(p.x - tg.x, p.y - tg.y) || 1;
      const len = Math.max(60, Math.min(T.len[f.phase], d + T.over));
      const end = clampIn(tg.x + ((p.x - tg.x) / d) * len, tg.y + ((p.y - tg.y) / d) * len, 10);
      const live = Math.hypot(end.x - tg.x, end.y - tg.y) / T.speed;
      tg.facing = end.x >= tg.x ? 1 : -1;
      addHazard(w, f, { kind: 'pounce', move: 'tiger', warn: T.warn, live, x0: tg.x, y0: tg.y, x1: end.x, y1: end.y, r: T.hw, dmg: T.dmg * f.mul, kb: 120 }, ev);
      addHazard(w, f, { kind: 'disk', move: 'tiger', warn: T.warn + live + T.roar.after, live: 0.1, x0: end.x, y0: end.y, x1: end.x, y1: end.y, r: T.roar.r, dmg: T.roar.dmg * f.mul, kb: T.roar.kb }, ev);
    }
    if (f.t > T.appear && !f.hazards.some((h) => h.move === 'tiger')) {
      f.tiger = null;
      return true;
    }
    return false;
  },
  // 二十四珠：一圈珠子围着人物（定下就不跟），从靠他那一侧起依次砸下；整圈的震在一开始就亮着，最后一颗砸完再震
  rosary(w, f, e, p, ev) {
    const R = Z.rosary;
    if (at(f, 0)) {
      face(f, e, p.x);
      const c = clampIn(p.x, p.y, R.R * 0.6);
      const a0 = Math.atan2(e.y - c.y, e.x - c.x);
      const dir = w.rng.next() < 0.5 ? 1 : -1;
      for (let i = 0; i < R.n; i++) {
        const a = a0 + dir * (i / R.n) * Math.PI * 2;
        addHazard(w, f, { kind: 'disk', move: 'rosary', warn: R.first + i * R.gap, live: 0.1, x0: c.x + Math.cos(a) * R.R, y0: c.y + Math.sin(a) * R.R, x1: e.x, y1: e.y - 14, r: R.r, dmg: R.dmg * f.mul, kb: 80, seq: i + 1 }, ev);
      }
      addHazard(w, f, { kind: 'disk', move: 'rosary', warn: R.first + (R.n - 1) * R.gap + R.quake.after, live: 0.12, x0: c.x, y0: c.y, x1: c.x, y1: c.y, r: R.R, dmg: R.quake.dmg * f.mul, kb: 150, quake: true }, ev);
    }
    return !f.hazards.some((h) => h.move === 'rosary');
  },
  // 珠落如雨（当首领的三阶段）：他举着手，定海珠一阵接一阵落下——每阵一颗追着人物砸（往他走的方向提前一点），另外几颗撒在他身边；
  // 一直走就躲得开，停下来、往回折就挨砸。危险物记成 beads（画面、声音照定海珠）
  storm(w, f, e, p, ev) {
    const S = Z.storm;
    for (let k = 0; k < S.volleys; k++) {
      if (!at(f, k * S.every)) continue;
      face(f, e, p.x);
      const [vx, vy] = vel(p);
      const c = clampIn(p.x + vx * S.lead, p.y + vy * S.lead, 12);
      for (let i = 0; i <= S.extra; i++) {
        const a = w.rng.next() * Math.PI * 2;
        const d = i === 0 ? 0 : S.r + w.rng.next() * (S.spread - S.r);
        const q = clampIn(c.x + Math.cos(a) * d, c.y + Math.sin(a) * d * 0.7, 12);
        addHazard(w, f, { kind: 'disk', move: 'beads', warn: S.warn + i * 0.1, live: 0.1, x0: q.x, y0: q.y, x1: e.x, y1: e.y - 14, r: S.r, dmg: S.dmg * f.mul, kb: S.kb }, ev);
      }
    }
    return f.t > (S.volleys - 1) * S.every && !f.hazards.some((h) => h.move === 'beads');
  },
};

/** 每一招收招多久（缺省 ECHO.recover）。 */
export const ZHAO_RECOVER: Partial<Record<EchoMove, number>> = { tiger: 0.4, rosary: 0.6, storm: 0.7 };

/** 黑虎扑的时候跟着扑的那一道走（表现层画虎影）；扑完吼过就散。 */
export function zhaoTick(f: EchoFight) {
  const tg = f.tiger;
  if (!tg) return;
  tg.px = tg.x;
  tg.py = tg.y;
  const h = f.hazards.find((x) => x.kind === 'pounce');
  if (h && h.t >= h.warn) {
    tg.x = h.x;
    tg.y = h.y;
  }
}

export type { Enemy, SimEvent };
