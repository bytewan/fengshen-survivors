// 试玩机器人捡战场掉落（乾坤宝匣、蟠桃、聚灵符）：安全的时候朝附近的掉落物走。
// 只读状态、给出一个方向分量；不改 botInput（首领分支在改），合并时接到 botInput 里：
//   const [lx, ly] = botLootPull(w, idx);  ax += lx;  ay += ly;   // 加在归一化之前
// 分量的大小和 botInput 里躲一只敌人的分量同一个量级（躲距离 d 处的一只敌人 ≈ 1/d）：
// 想要的掉落离得近、周围没什么敌人时最大约 0.04（相当于躲一只 25 像素外的敌人），危险时为 0。
import type { Drop } from './types.ts';
import type { World } from './world.ts';

export const BOT_LOOT = {
  seek: 200, // 多远以内的掉落才去捡
  crowd: 40, // 掉落周围这么远内的敌人算「守着」它
  maxGuard: 3, // 掉落周围超过这么多只敌人就不去
  selfR: 46, // 自己身边这么远内的敌人算「被围」
  maxSelf: 5, // 自己被围超过这么多只就先跑，不捡
  pull: 0.04, // 最大分量
};

/** 这件掉落对机器人值多少（0 = 不想要）。 */
function want(w: World, idx: number, d: Drop): number {
  const p = w.players[idx];
  if (d.kind === 'peach') return p.hp < p.stats.maxHp * 0.85 ? 2 - p.hp / p.stats.maxHp : 0.15; // 血少才想吃
  if (d.kind === 'magnet') return w.gems.length >= 6 ? 1.2 : 0.4;
  return d.rich ? 2 : 1.4; // 宝匣
}

/** 安全时朝附近的掉落物走的分量 [ax, ay]；没有值得捡的或太危险时返回 [0, 0]。 */
export function botLootPull(w: World, idx = 0): [number, number] {
  const p = w.players[idx];
  if (!p?.alive || !w.drops.length || w.phase !== 'wave') return [0, 0];
  const B = BOT_LOOT;
  let around = 0;
  for (const e of w.enemies) if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 < B.selfR * B.selfR) around += e.kind === 'elite' || e.kind === 'boss' ? 3 : 1;
  if (around > B.maxSelf) return [0, 0];
  let best: Drop | null = null;
  let bs = 0;
  for (const d of w.drops) {
    if (d.pulled !== undefined || d.life - d.t < 0.6) continue; // 正被吸走的、快消失的不追
    const dist = Math.hypot(d.x - p.x, d.y - p.y);
    if (dist > B.seek) continue;
    let guard = 0;
    for (const e of w.enemies) if ((e.x - d.x) ** 2 + (e.y - d.y) ** 2 < B.crowd * B.crowd) guard += e.kind === 'elite' || e.kind === 'boss' ? 3 : 1;
    if (guard > B.maxGuard) continue;
    const s = (want(w, idx, d) / (1 + dist / 70)) * (1 - guard / (B.maxGuard + 1));
    if (s > bs) {
      bs = s;
      best = d;
    }
  }
  if (!best || bs <= 0.05) return [0, 0];
  const dx = best.x - p.x;
  const dy = best.y - p.y;
  const dist = Math.hypot(dx, dy) || 1;
  const mag = B.pull * Math.min(1, bs);
  return [(dx / dist) * mag, (dy / dist) * mag];
}
