// 试玩机器人躲新敌人的招：长矛兵的刺击线、骑兵的冲锋线、自爆鬼的炸开范围；第三章飞剑灵的瞄准线、阵图傀儡的剑气线。
// 只读状态、给出一个方向分量 [ax, ay]；botInput 的普通波那段把它加在归一化之前（首领战那一支不用）：
//   const [dx, dy] = botEnemyDodge(w, idx, react);  ax += dx;  ay += dy;
// 分量的量级和 botInput 里的一致：躲一只 d 像素外的敌人 ≈ 1/d（30 像素 ≈ 0.033），绕场心转 ≈ 0.013。
// 站在线上 / 炸开范围里时最大约 0.24，压过别的分量（先躲招）；离危险边缘越远越小，危险之外为 0。
// skill 越低反应越慢：预警亮出来之后要过 react 秒才「看见」（tools/balance.ts 用默认值，接近人的反应）。
import { ARENA, FOES, PLAYER } from './config.ts';
import { FOES2 } from './ch2/config.ts';
import { FOES3 } from './ch3/config.ts';
import { ch3Dodge } from './ch3/foes.ts';
import { eliteDodge } from './elites/index.ts';
import type { World } from './world.ts';

export const BOT_DODGE = {
  enabled: true, // 关掉 = 不躲（tools/balance.ts --no-dodge 对照用）
  react: 0.18, // 预警亮出来多久之后才看见（botInput 按 skill 传进来，这是默认值）
  margin: 7, // 离危险的边这么近也要让开
  pull: 0.2, // 最大分量（再加 base）
  base: 0.04,
  bomberNear: 40, // 还没点燃的自爆鬼离这么近，就先往外让一点（别让它贴上来）
  bomberPull: 0.03,
};

export function botEnemyDodge(w: World, idx = 0, react = BOT_DODGE.react): [number, number] {
  const p = w.players[idx];
  if (!BOT_DODGE.enabled || !p?.alive || w.phase !== 'wave') return [0, 0];
  const B = BOT_DODGE;
  let ax = 0;
  let ay = 0;
  for (const e of w.enemies) {
    if (e.hp <= 0 || e.kind === 'elite') continue; // 精英的招在下面 eliteDodge 里躲（elites/）
    if (!e.act) {
      // 没点燃的自爆鬼：贴近之前就先让开一点
      if (e.kind !== 'bomber') continue;
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < B.bomberNear) {
        ax += (dx / d) * B.bomberPull * (1 - d / B.bomberNear);
        ay += (dy / d) * B.bomberPull * (1 - d / B.bomberNear);
      }
      continue;
    }
    const seen = (e.actLen ?? 0) - (e.actT ?? 0) >= react;
    if (e.act === 'fuse') {
      if (!seen) continue;
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      const R = FOES.bomber.radius + B.margin;
      if (d >= R) continue;
      const k = B.base + B.pull * (1 - d / R);
      ax += (dx / d) * k;
      ay += (dy / d) * k;
      continue;
    }
    const line = e.act === 'windup' ? seen : e.act === 'strike' && (e.kind === 'cavalry' || e.kind === 'windfiend' || e.kind === 'flysword');
    if (!line || e.aimX === undefined || e.ox === undefined) continue;
    // 刺击线 / 冲锋线：看自己离这条线多远，站在线上就往线的两侧让（往离场心近的那一侧，别让进魔气里）
    const half = (e.kind === 'spearman' ? FOES.spearman.width : e.kind === 'windfiend' ? FOES2.windfiend.width : e.kind === 'flysword' ? FOES3.flysword.width : FOES.cavalry.width) + PLAYER.radius + B.margin;
    const ux = e.aimX;
    const uy = e.aimY!;
    const rx = p.x - e.ox;
    const ry = p.y - e.oy!;
    const along = rx * ux + ry * uy;
    const side = -rx * uy + ry * ux;
    const from = e.act === 'strike' ? (e.x - e.ox) * ux + (e.y - e.oy!) * uy : 0; // 冲锋时，骑兵已经冲过的那一段不用躲
    if (along < from - B.margin || along > (e.reach ?? 0) + B.margin || Math.abs(side) > half) continue;
    // 正好站在线上时，往场心那一侧让
    const toCenter = -(ARENA.w / 2 - e.ox) * uy + (ARENA.h / 2 - e.oy!) * ux;
    const s = Math.abs(side) > 0.5 ? Math.sign(side) : toCenter >= 0 ? 1 : -1;
    const k = B.base + B.pull * (1 - Math.abs(side) / half);
    ax += -uy * s * k;
    ay += ux * s * k;
  }
  // 第三章：阵图傀儡的剑气线（一直连着，不预警）
  const [tx, ty] = ch3Dodge(w, p, B.margin, B.base, B.pull);
  // 精英：夜叉要冒出来的那一片和拍浪、剑侍抬剑的那条线、词缀「反震」蓄力的那一圈
  const [ex, ey] = eliteDodge(w, p, react, B.margin, B.base, B.pull);
  return [ax + tx + ex, ay + ty + ey];
}
