// 金光力士（第二章的精英；数值在 config.ts 的 ELITES.lishi）：十绝阵里金光阵的力士，举着一面金光阵旗。
//   走得慢、厚一点；每隔一会儿站定举旗，给身边最近的几只敌人（连它自己）各套一层金光：挡下一下伤害，过一会儿散掉。
//   挡的是直接命中（法宝打在身上的那一下）；灼烧、流血、地面区域这些持续伤害挡不住，神通也挡不住（index.eliteHit 判）。
// 金光套在被套的敌人身上（Enemy.aegis / aegisT），力士死了也照样挡、到时散；表现层在被套的敌人胸口画一枚小金符、挡下时金屑迸开。
import { DT } from '../config.ts';
import type { Enemy, Player, SimEvent } from '../types.ts';
import type { World } from '../world.ts';
import { ELITES } from './config.ts';

const startAct = (e: Enemy, act: NonNullable<Enemy['act']>, t: number) => {
  e.act = act;
  e.actT = t;
  e.actLen = t;
};
const endAct = (e: Enemy) => {
  e.act = undefined;
  e.actT = 0;
  e.actLen = 0;
};

/** 刚刷出来（index.setupElite）：第一次举旗的冷却。 */
export function setupLishi(e: Enemy) {
  e.cd = ELITES.lishi.cast.first;
}

/** 这只敌人身上还有没有金光（还能挡几下）。 */
export const aegisLeft = (w: World, e: Enemy) => (e.aegis && e.aegis > 0 && w.time < (e.aegisT ?? 0) ? e.aegis : 0);

/** 首领和首领召出来的东西不套（落魂幡、草人）；正在自爆的爆符鬼也不套。 */
const shieldable = (e: Enemy) => e.hp > 0 && e.kind !== 'boss' && e.kind !== 'soulflag' && e.kind !== 'strawman' && e.act !== 'fuse';

export function lishi(w: World, e: Enemy, t: Player | null, vx: number, vy: number, ev: SimEvent[]): [number, number] {
  const C = ELITES.lishi.cast;
  e.cd -= DT;
  if (e.act === 'cast') {
    e.actT = (e.actT ?? 0) - DT;
    if (e.stun > 0) {
      // 被打断：放下旗，过一会儿再来
      endAct(e);
      e.cd = Math.max(e.cd, 1.2);
      return [0, 0];
    }
    if (e.actT <= 0) {
      cast(w, e, ev);
      startAct(e, 'rest', C.rest);
      e.cd = C.every;
    }
    return [0, 0];
  }
  if (e.act === 'rest') {
    e.actT = (e.actT ?? 0) - DT;
    if (e.actT <= 0) endAct(e);
    return [0, 0];
  }
  if (!t || e.stun > 0) return [vx, vy];
  if (e.cd <= 0) {
    startAct(e, 'cast', C.warn);
    ev.push({ t: 'aegisRaise', id: e.id, x: e.x, y: e.y, t2: C.warn });
    return [0, 0];
  }
  return [vx, vy];
}

/** 金光护体：身边 r 以内最近的 max 只（连它自己）各套一层。 */
function cast(w: World, e: Enemy, ev: SimEvent[]) {
  const C = ELITES.lishi.cast;
  const near: { o: Enemy; d: number }[] = [];
  for (const o of w.enemies) {
    if (!shieldable(o)) continue;
    const d = (o.x - e.x) ** 2 + (o.y - e.y) ** 2;
    if (d <= C.r * C.r) near.push({ o, d });
  }
  near.sort((a, b) => a.d - b.d || a.o.id - b.o.id);
  const ids: number[] = [];
  for (const { o } of near.slice(0, C.max)) {
    o.aegis = C.hits;
    o.aegisT = w.time + C.hold;
    ids.push(o.id);
  }
  ev.push({ t: 'aegisCast', id: e.id, x: e.x, y: e.y, r: C.r, ids });
}

/** 挡一下（index.eliteHit 判过这一下挡得住）：用掉一层，发 aegisBlock。 */
export function aegisBlock(w: World, e: Enemy, ev: SimEvent[]) {
  e.aegis = Math.max(0, (e.aegis ?? 0) - 1);
  if (!e.aegis) e.aegisT = undefined;
  ev.push({ t: 'aegisBlock', id: e.id, x: e.x, y: e.y });
  void w;
}
