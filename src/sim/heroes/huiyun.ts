// 回响云霄（回响化身，主五行水；第三章第 4 波的遭遇战，打倒解锁。用户 11-11 确认：法宝、神通、被动都和云霄不同）。
// 玩法一眼看得懂：先控后打——
// - 专属法宝「乾坤图」（黄河阵被破那天，老子抖开乾坤图把她裹去、压在麒麟崖下；回响里她反过来用）：朝敌人最多的方向铺开一卷图，
//   卷在图上的被裹住（定身片刻，首领只挨伤害）；凡一卷、灵更长更宽裹得更久，仙品「镇山」裹够了一座山影压下来重创，
//   神品器灵「裹天」一次两卷交叉 /「麒麟崖」山影压整卷图上的敌人、裹得更久。（金蛟剪已经是公共法宝，换成乾坤图。）
// - 神通「黄河阵 · 削顶」：在敌人最多的地方摆下一座黄河阵，阵里的敌人被削去顶上三花——受到的伤害加深、打人变轻，摆下时先冲一下。
// - 被动「截教」：身边每有一只被定住、冻住、晕住的敌人，法宝出手快一点（有上限）。
// 宠物玄鸾就是青鸾（pets/qingluan.ts），只换了颜色（game/pets/qingluan-fx.ts 按角色换）。
// 状态都挂在人物身上（Player.scrolls / formation，纯数据）：图跟着法宝推进（weapons.updateWeapons 调 updateScrolls），阵在 updateHuiyun 里。
// 射程守 config.REACH：图的长度、阵心都在索敌半径里。数值是初值（2026-11-11），最后统一调。
import { ENEMIES, REACH, SKILL } from '../config.ts';
import { buildGrid, enemiesWithin, hitEnemy, segDist, weaponDamage } from '../core.ts';
import { densest } from '../weapons.ts';
import { techSkillRadius } from '../techniques.ts';
import type { Enemy, OwnedWeapon, Player, ScrollCast, SimEvent } from '../types.ts';
import type { World } from '../world.ts';

const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const BOSS_WEIGHT = 6;
const bossFirst = (e: Enemy) => (e.kind === 'boss' ? BOSS_WEIGHT : 1);

// ---------------------------------------------------------------- 专属法宝「乾坤图」

/** 打法参数。数组按品阶取（下标 1 凡 … 4 神）；伤害都是相对这件法宝单发伤害（core.weaponDamage）的倍数。 */
export const QIANKUNTU = {
  len: [0, 115, 125, 125, 125], // 2026-11-11 数值平衡（没成型不秒杀）：冷却 1.6 → 1.2 秒、单发倍率 1.2 / 1.3 / 0.66 / 0.95 → 0.8 / 1.07 / 0.5 / 0.79、裹住 0.8 / 1 / 1.1 → 0.6 / 0.75 / 0.8 秒、凡品铺 105 → 115 长、半宽 10 → 11（凡品一下打死 88% → 11%、灵品 57% → 22%）。铺多长（吃范围加成，最多 REACH.max）
  hw: [0, 11, 11, 12, 12], // 半宽（2026-11-11 灵 12 → 11：灵品群伤偏高、单体偏低）（判定再加敌人身子的一半）
  wrap: [0, 0.6, 0.75, 0.8, 0.8], // 裹住（定身）多久
  bigWrap: 1.6, // 器灵「麒麟崖」裹得更久
  press: 1.6, // 仙品「镇山」：山影压下的伤害（2026-11-11 1.3 → 1.6，仙品起单发倍率跟着低一点）
  pressStun: 0.4,
  cross: 0.85, // 器灵「裹天」：第二卷（交叉的那一卷）长度
};

/** 挑方向：在最近的十只（和够得着的首领）里挑一个方向，让那一卷罩住最多的敌人（首领算 BOSS_WEIGHT 只）。 */
function aimScroll(w: World, p: Player, len: number, hw: number): number {
  const near = enemiesWithin(w, p.x, p.y, len + 8).sort((a, b) => dist2(a, p) - dist2(b, p));
  if (!near.length) return NaN;
  const boss = near.find((e) => e.kind === 'boss');
  const pool = boss && near.indexOf(boss) >= 10 ? [...near.slice(0, 10), boss] : near.slice(0, 10);
  let best = Math.atan2(near[0].y - p.y, near[0].x - p.x);
  let bestN = -1;
  for (const c of pool) {
    const a = Math.atan2(c.y - p.y, c.x - p.x);
    const x1 = p.x + Math.cos(a) * len;
    const y1 = p.y + Math.sin(a) * len;
    let n = 0;
    for (const e of near) if (segDist(e.x, e.y, p.x, p.y, x1, y1) <= hw + ENEMIES[e.kind].radius * 0.5) n += bossFirst(e);
    if (n > bestN) {
      bestN = n;
      best = a;
    }
  }
  return best;
}

/** 铺开一卷：图上的被裹住（定身，首领不吃），挨一下。 */
function unroll(w: World, p: Player, wpn: OwnedWeapon, a: number, len: number, hw: number, dmg: number, ev: SimEvent[]) {
  const Q = QIANKUNTU;
  const x0 = p.x + Math.cos(a) * 6;
  const y0 = p.y + Math.sin(a) * 6;
  const x1 = p.x + Math.cos(a) * len;
  const y1 = p.y + Math.sin(a) * len;
  const wrap = wpn.spirit === 'qilin' ? Q.bigWrap : Q.wrap[wpn.tier];
  const ids: number[] = [];
  for (const e of enemiesWithin(w, (x0 + x1) / 2, (y0 + y1) / 2, len / 2 + hw + 14)) {
    if (segDist(e.x, e.y, x0, y0, x1, y1) > hw + ENEMIES[e.kind].radius * 0.5) continue;
    hitEnemy(w, e, { dmg, by: 'scroll', owner: p.id, from: p, el: 'water', stun: wrap }, ev);
    ids.push(e.id);
  }
  const id = w.nextId++;
  const s: ScrollCast = { id, x0, y0, x1, y1, hw, ids, t: 0, wrap, dmg, tier: wpn.tier, spirit: wpn.spirit, pressed: false, wave: w.wave };
  (p.scrolls ??= []).push(s);
  ev.push({ t: 'scroll', owner: p.id, id, x0, y0, x1, y1, hw, ids, wrap, tier: wpn.tier, spirit: wpn.spirit });
}

/** 出手（weapons.ts 的 FIRE 表调）。返回 false = 这次没出手（身边没有够得着的敌人）。 */
export function fireQiankuntu(w: World, p: Player, wpn: OwnedWeapon, ev: SimEvent[]): boolean {
  const Q = QIANKUNTU;
  buildGrid(w.enemies);
  if (!densest(w, p, REACH.seek, 1, [], 0, bossFirst).length) return false;
  const len = Math.min(REACH.max, Q.len[wpn.tier] * (1 + p.stats.area));
  const hw = Q.hw[wpn.tier];
  const a = aimScroll(w, p, len, hw);
  if (Number.isNaN(a)) return false;
  const dmg = weaponDamage(p, wpn, p.buffs.rage);
  p.facing = Math.cos(a) >= 0 ? 1 : -1;
  unroll(w, p, wpn, a, len, hw, dmg, ev);
  if (wpn.spirit === 'cross') {
    buildGrid(w.enemies);
    unroll(w, p, wpn, a + Math.PI / 2, len * Q.cross, hw, dmg, ev); // 裹天：交叉的第二卷
  }
  return true;
}

/** 每帧推进乾坤图（weapons.updateWeapons 调）：裹够了，仙品起山影压下来；压完（或品阶不到）就收起。 */
export function updateScrolls(w: World, p: Player, dt: number, ev: SimEvent[]) {
  const ss = p.scrolls;
  if (!ss) return;
  const Q = QIANKUNTU;
  for (let i = ss.length - 1; i >= 0; i--) {
    const s = ss[i];
    if (s.wave !== w.wave) {
      ss.splice(i, 1);
      continue;
    }
    s.t += dt;
    if (!s.pressed && s.tier >= 3 && s.t >= s.wrap - 1e-9) {
      s.pressed = true;
      const big = s.spirit === 'qilin';
      buildGrid(w.enemies);
      // 镇山：压的是裹住的那几只；麒麟崖：整卷图上的都压
      const ids: number[] = [];
      const pool = big
        ? enemiesWithin(w, (s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, Math.hypot(s.x1 - s.x0, s.y1 - s.y0) / 2 + s.hw + 14).filter(
            (e) => segDist(e.x, e.y, s.x0, s.y0, s.x1, s.y1) <= s.hw + ENEMIES[e.kind].radius * 0.5,
          )
        : s.ids.map((id) => w.enemies.find((e) => e.id === id && e.hp > 0)).filter((e): e is Enemy => !!e);
      for (const e of pool) {
        hitEnemy(w, e, { dmg: s.dmg * Q.press, by: 'scroll', owner: p.id, from: { x: e.x, y: e.y - 20 }, el: 'water', stun: Q.pressStun }, ev);
        ids.push(e.id);
      }
      ev.push({ t: 'scrollPress', owner: p.id, id: s.id, ids, big });
    }
    if (s.t >= s.wrap + 0.3) ss.splice(i, 1);
  }
  if (!ss.length) delete p.scrolls;
}

// ---------------------------------------------------------------- 神通「黄河阵 · 削顶」

export const XUEDING = {
  r: 78, // 阵的半径（吃一点范围加成和功法「混元一气」）
  dur: 6, // 摆多久
  vuln: 0.3, // 阵里的敌人受到的伤害 +30%
  weak: 0.35, // 阵里的敌人打人 −35%
  pulse: 0.8, // 摆下时冲一下（相对 SKILL.damage）
};

/** 放黄河阵：摆在敌人最多的地方（首领在就摆在首领那里），摆下时冲一下。 */
export function xueding(w: World, p: Player, ev: SimEvent[]) {
  const X = XUEDING;
  buildGrid(w.enemies);
  const t = densest(w, p, REACH.seek, 1, [], 0, bossFirst)[0];
  const x = t ? t.x : p.x;
  const y = t ? t.y : p.y;
  const r = X.r * (1 + Math.min(REACH.area, p.stats.area)) * techSkillRadius(p);
  p.formation = { x, y, r, t0: w.time, until: w.time + X.dur, wave: w.wave };
  ev.push({ t: 'skill', owner: p.id, x: p.x, y: p.y, radius: r, kind: 'xueding', dur: X.dur });
  ev.push({ t: 'formation', owner: p.id, x, y, r, dur: X.dur });
  const dmg = SKILL.damage * X.pulse * (1 + p.stats.damage);
  for (const e of enemiesWithin(w, x, y, r)) hitEnemy(w, e, { dmg, by: 'skill', owner: p.id, from: { x, y }, el: 'water', kb: 60 }, ev);
}

/** 每帧（heroes/index.ts 的 KITS 调）：阵里的敌人削去三花（受伤加深、打人变轻），到时散掉。 */
export function updateHuiyun(w: World, p: Player, _dt: number, _ev: SimEvent[]) {
  const f = p.formation;
  if (!f) return;
  if (f.wave !== w.wave || w.time >= f.until) {
    delete p.formation;
    return;
  }
  const X = XUEDING;
  buildGrid(w.enemies);
  for (const e of enemiesWithin(w, f.x, f.y, f.r)) {
    e.vuln = Math.max(e.vuln, X.vuln);
    e.vulnT = Math.max(e.vulnT, 0.25);
    e.weak = X.weak;
    e.weakUntil = w.time + 0.25;
  }
}

// 被动「截教」（身边被定住、冻住的敌人越多，法宝出手越快）在 passives.ts（weapons.updateWeapons 乘进攻速）
