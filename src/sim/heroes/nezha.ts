// 哪吒（主五行火）的神通与被动。神通「三头六臂」原来写在 world.ts 的主循环里，原样搬到这里（随机数的用法、先后一点没变）。
// 被动暂时没有（设计文档里四个基础角色各有一条被动，哪吒的还没定；见 catalog.HEROES）。
import { SKILL } from '../config.ts';
import { buildGrid, enemiesWithin, hitEnemy } from '../core.ts';
import { techSkillRadius } from '../techniques.ts';
import { throwRing } from '../weapons.ts';
import type { Player, SimEvent } from '../types.ts';
import type { World } from '../world.ts';

/** 神通·三头六臂：以自身为中心的冲击波（震开、伤害）+ 向八方各掷一枚乾坤圈。数值在 config.SKILL。 */
export function santou(w: World, p: Player, ev: SimEvent[]) {
  const r = SKILL.radius * (1 + p.stats.area * 0.5) * techSkillRadius(p); // 功法「混元一气」：神通范围更大
  ev.push({ t: 'skill', owner: p.id, x: p.x, y: p.y, radius: r });
  buildGrid(w.enemies);
  const dmg = SKILL.damage * (1 + p.stats.damage);
  for (const e of enemiesWithin(w, p.x, p.y, r)) hitEnemy(w, e, { dmg, by: 'skill', owner: p.id, from: p, kb: SKILL.knockback }, ev);
  const ring = p.weapons.find((x) => x.kind === 'qiankun') ?? null;
  for (let k = 0; k < SKILL.rings; k++) {
    const a = (k / SKILL.rings) * Math.PI * 2;
    throwRing(w, p, ring, p.x + Math.cos(a) * 100, p.y - 10 + Math.sin(a) * 100, false, ev);
  }
}
