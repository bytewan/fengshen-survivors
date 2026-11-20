// 战场掉落（用户：对战中偶尔掉宝箱、蟠桃、磁铁，做成修仙化的替代品）：
// 普通兵小概率掉蟠桃 / 聚灵符 / 乾坤宝匣，精英必掉宝匣（多半开出碎片）；人物靠近自动拾取，过一会儿没人捡就消失；
// 波末收灵时，场上剩下的掉落和灵石一起飞向人物、照常生效。掉出来发 'drop'，拾取发 'loot'（reward 是给玩家看的中文短句）。
import { ARENA, COLLECT, DROPS } from './config.ts';
import { TIER_NAME, WEAPONS, priceScale } from './catalog.ts';
import { addFragment } from './shop.ts';
import type { Drop, DropKind, Enemy, Flight, Player, SimEvent } from './types.ts';
import type { World } from './world.ts';

const KINDS: DropKind[] = ['peach', 'magnet', 'chest'];

/** 敌人死时掷一次掉落（core.onKill 调用）。首领不掉（首领有自己的结算）。 */
export function rollDrop(w: World, e: Enemy, ev: SimEvent[]) {
  if (e.kind === 'boss') return;
  let kind: DropKind | null = null;
  const rich = e.kind === 'elite';
  if (rich) kind = 'chest';
  else {
    const r = w.rng.next();
    if (w.drops.filter((d) => !d.rich && d.pulled === undefined).length >= DROPS.max) return;
    const luck = 1 + Math.max(0, ...w.players.map((p) => p.stats.luck)) * 0.01;
    let acc = 0;
    for (const k of KINDS) {
      acc += DROPS.chance[k] * luck;
      if (r < acc) {
        kind = k;
        break;
      }
    }
  }
  if (!kind) return;
  // 掉在仙台上（魔气里的掉到边上），免得捡不到
  const pad = ARENA.pad + 10;
  const x = Math.max(pad, Math.min(ARENA.w - pad, e.x));
  const y = Math.max(pad, Math.min(ARENA.h - pad, e.y));
  const d: Drop = { id: w.nextId++, kind, x, y, px: x, py: y, t: 0, life: DROPS.life };
  if (rich) d.rich = true;
  w.drops.push(d);
  ev.push({ t: 'drop', id: d.id, kind, x, y, ...(rich ? { rich: true } : {}) });
}

/**
 * 波末收灵的一趟飞行（灵石和掉落共用，按时间驱动）：从 (x, y) 飞向 (tx, ty)，从静止匀加速，
 * 飞行时长 T = √(2 × 距离 / accel)，夹在 [min, max] 秒。再远也在 max 秒内飞到。
 * 原来是「速度去追目标速度」的两次插值，实际加速度只有写出来的六分之一、还封顶：远处的东西收灵结束都飞不到，只能凭空结算。
 * v0：这件东西现在已经在朝人物飞的速度（正被吸过来的灵石）。接着这个速度往下加速、不从头起步 ——
 * 等效成「从更远处静止起飞、已经飞了一段」：起点往后挪 v0² / (2 × accel)，已飞时间 v0 / accel。
 */
export function collectFlight(x: number, y: number, tx: number, ty: number, k: { accel: number; min: number; max: number }, v0 = 0): Flight {
  const d = Math.hypot(tx - x, ty - y);
  const back = (v0 * v0) / (2 * k.accel);
  const T = Math.sqrt((2 * (d + back)) / k.accel);
  const dur = Math.max(k.min, Math.min(k.max, T));
  const ux = d > 1e-9 ? (tx - x) / d : 0;
  const uy = d > 1e-9 ? (ty - y) / d : 0;
  return { x: x - ux * back, y: y - uy * back, t: T > 0 ? (v0 / k.accel) * (dur / T) : 0, dur };
}

/** 把一件东西沿它的这趟飞行推进 dt 秒，朝人物现在的位置 (tx, ty) 飞（先慢后快）。飞到了返回 true（位置正好落在目标上）。 */
export function flyStep(o: { x: number; y: number }, f: Flight, tx: number, ty: number, dt: number): boolean {
  f.t += dt;
  const k = Math.min(1, f.t / f.dur);
  const e = k * k;
  o.x = f.x + (tx - f.x) * e;
  o.y = f.y + (ty - f.y) * e;
  return k >= 1;
}

/** 波末收灵：场上的掉落一起飞向最近的活着的人物（没人活着就飞向第一个人：他会在商店里复活）。 */
export function vacuumDrops(w: World) {
  const alive = w.players.filter((p) => p.alive);
  for (const d of w.drops) {
    let best = alive[0] ?? w.players[0];
    for (const p of alive) if ((p.x - d.x) ** 2 + (p.y - d.y) ** 2 < (best.x - d.x) ** 2 + (best.y - d.y) ** 2) best = p;
    d.pulled = best.id;
    d.fly = undefined; // 从现在的位置起飞（updateDrops 里按到人物的距离定飞行时长）
  }
}

/** 每帧：收灵时飞向人物；人物走近就自动拾取；没人捡的到时消失。 */
export function updateDrops(w: World, dt: number, ev: SimEvent[]) {
  for (let i = w.drops.length - 1; i >= 0; i--) {
    const d = w.drops[i];
    d.px = d.x;
    d.py = d.y;
    d.t += dt;
    if (d.pulled !== undefined) {
      // 收灵：由慢到快飞向人物（比灵石慢一点，看得清飞过来的是什么），飞到了照常生效
      const p = w.players[d.pulled] ?? w.players[0];
      d.fly ??= collectFlight(d.x, d.y, p.x, p.y - 8, COLLECT.drop);
      if (flyStep(d, d.fly, p.x, p.y - 8, dt)) {
        w.drops.splice(i, 1);
        loot(w, p, d, ev);
      }
      continue;
    }
    let taker: Player | null = null;
    for (const p of w.players) {
      if (!p.alive) continue;
      const r = DROPS.pickR * (1 + p.stats.pickup * 0.5);
      if ((p.x - d.x) ** 2 + (p.y - 4 - d.y) ** 2 <= r * r) {
        taker = p;
        break;
      }
    }
    if (taker) {
      w.drops.splice(i, 1);
      loot(w, taker, d, ev);
    } else if (d.t >= d.life) w.drops.splice(i, 1);
  }
}

/** 兜底（收灵超时才会走到；正常情况下掉落都飞得到）：还没飞到的掉落直接算给它正飞向的人。 */
export function lootRemaining(w: World, ev: SimEvent[]) {
  for (const d of w.drops) {
    const p = w.players[d.pulled ?? 0] ?? w.players[0];
    if (p) loot(w, p, d, ev);
  }
  w.drops = [];
}

const pickW = <K extends string>(w: World, weights: Record<K, number>): K => {
  const keys = Object.keys(weights) as K[];
  const total = keys.reduce((s, k) => s + weights[k], 0);
  let r = w.rng.next() * total;
  for (const k of keys) {
    r -= weights[k];
    if (r < 0) return k;
  }
  return keys[keys.length - 1];
};

/** 拾取：结算效果，发 loot 事件。 */
export function loot(w: World, p: Player, d: Drop, ev: SimEvent[]) {
  let reward = '';
  if (d.kind === 'peach') {
    if (p.hp >= p.stats.maxHp) {
      // 满血时拿到（波末收灵飞来的蟠桃有一半是这样）：不白吃，化作气血上限
      p.stats.maxHp += DROPS.peachOver;
      p.hp += DROPS.peachOver;
      reward = `气血上限 +${DROPS.peachOver}`;
    } else {
      const heal = Math.round(p.stats.maxHp * DROPS.peachHeal);
      p.hp = Math.min(p.stats.maxHp, p.hp + heal);
      reward = `气血 +${heal}`;
    }
  } else if (d.kind === 'magnet') {
    if (w.phase === 'collect') {
      // 波末收灵时飞过来的聚灵符：那时灵石已经全在往人物飞了，world.endWave 看到场上有聚灵符，就已经把这一波收的灵石按它算过
      reward = `收灵灵石 +${Math.round((DROPS.magnetBonus - 1) * 100)}%`;
    } else {
      // 聚灵符：把场上所有灵石吸向拾取者，吸来的按 magnetBonus 倍算（每颗只加一次）
      let n = 0;
      for (const g of w.gems) {
        if (!g.mag) {
          g.value *= DROPS.magnetBonus;
          g.mag = true;
        }
        if (g.pulled !== p.id) {
          g.pulled = p.id;
          n++;
        }
      }
      reward = n ? `聚来灵石 ×${n}` : '四方灵气归一';
    }
  } else reward = openChest(w, p, !!d.rich);
  ev.push({ t: 'loot', id: d.id, owner: p.id, kind: d.kind, x: d.x, y: d.y, reward });
}

/** 乾坤宝匣：随机给一样（精英的宝匣多半开出碎片、灵石也更多）。 */
function openChest(w: World, p: Player, rich: boolean): string {
  let pick = pickW(w, rich ? DROPS.richChest : DROPS.chest);
  if (pick === 'qi' && p.skill >= 1) pick = 'lingshi'; // 真气已满就换成灵石
  if (pick === 'fragment') {
    const can = p.weapons.filter((x) => x.tier < 3);
    if (can.length) {
      const wpn = can[Math.floor(w.rng.next() * can.length)];
      const name = WEAPONS[wpn.kind].name;
      const r = addFragment(p, wpn.kind);
      if (r === 'upgraded') return `${name}碎片 · 升为${TIER_NAME[wpn.tier]}品`;
      if (r === 'fragment') return `${name}碎片`;
    }
    pick = 'lingshi'; // 手里的法宝都到仙品了：换成灵石
  }
  if (pick === 'qi') {
    p.skill = 1;
    return '真气充满';
  }
  const [a, b] = DROPS.chestLingshi;
  const n = Math.round((a + (b - a) * w.rng.next()) * priceScale(w.wave) * (rich ? DROPS.richMul : 1));
  p.lingshi += n;
  return `灵石 +${n}`;
}
