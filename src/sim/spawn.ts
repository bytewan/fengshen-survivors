// 刷怪点怎么挑。铁律：敌人不能凭空出现在屏幕里 —— 刷怪点一定在所有活着的人物的镜头外，同时在敌人能待的范围
// （魔气带的外沿，硬边界）以内。
// 以前是先在人物周围的椭圆环上取点、再夹回仙台：人物靠墙 / 在角落时，夹回来的点落在屏幕里，甚至贴在人物身上、
// 刷出来那一帧就撞人；环的内沿在斜角上本来也落进镜头（场心也有一成多刷在屏幕里）。
// 现在：随便挑一个方向，从人物沿这个方向走到屏幕外沿（镜头矩形加上精灵的余量），再往外一小段 —— 各个方向来的一样多，
// 都是刚出屏幕、走几步就进来。出了硬边界、或落在别人屏幕里就换个方向重抽；随机抽不到就把一整圈扫一遍、在合格的里面挑；
// 实在没有（几个人的镜头把能刷的地方盖满了）才退而求其次，取离所有镜头最远的那个候选。
// 纯函数、确定性：随机数只用 w.rng。常规刷怪、精英、包围（world.ts）和首领波的零星回响兵（boss.ts）都走这里。
import { ARENA, MIASMA, SPAWN, VIEW } from './config.ts';
import { range } from './rng.ts';
import type { World } from './world.ts';

export interface Spot {
  x: number;
  y: number;
}

const TAU = Math.PI * 2;

/** 半径 r 的敌人站在 (x, y) 待不待得住：在魔气带外沿以内（魔焰焚城把魔气往里压时，外沿跟着往里收；和敌人移动时的边界一致）。 */
export function inBounds(w: World, x: number, y: number, r: number): boolean {
  const D = MIASMA.depth;
  const i = w.miasmaInset;
  return x >= i.x - D + r && x <= ARENA.w - i.x + D - r && y >= i.y - D + r && y <= ARENA.h - i.y + D - r;
}

/**
 * 「屏幕外沿」：镜头以人物为中心、看向脚下往上 VIEW.lift 像素；按整只精灵都看不见算（SPAWN.margin）——
 * 左右各让出朝人物伸出来的那一截，精灵从脚底往上画、所以下边要让出一个身高。返回人物脚下到左右 / 上 / 下外沿各多远。
 */
function viewEdge() {
  const M = SPAWN.margin;
  return { side: VIEW.w / 2 + M.x, up: VIEW.h / 2 + VIEW.lift + M.top, down: VIEW.h / 2 - VIEW.lift + M.bottom };
}

/** 从人物出发沿单位向量 (ux, uy) 走多远正好到屏幕外沿。 */
function edgeDist(ux: number, uy: number): number {
  const E = viewEdge();
  const tx = Math.abs(ux) > 1e-9 ? E.side / Math.abs(ux) : Infinity;
  const ty = Math.abs(uy) > 1e-9 ? (uy > 0 ? E.down : E.up) / Math.abs(uy) : Infinity;
  return Math.min(tx, ty);
}

/** 站在 (x, y) 的敌人离人物 p 的屏幕外沿有多远：> 0 在屏幕外（值是到外沿的距离），≤ 0 在屏幕里（值是往里陷了多深）。 */
export function outOfView(p: Spot, x: number, y: number): number {
  const E = viewEdge();
  const dx = Math.abs(x - p.x) - E.side;
  const dy = y < p.y ? p.y - E.up - y : y - (p.y + E.down);
  if (dx > 0 || dy > 0) return Math.hypot(Math.max(0, dx), Math.max(0, dy));
  return Math.max(dx, dy);
}

/** 候选点的好坏：离每个活着的人物的屏幕外沿最近的那个距离（> 0 才是谁都看不见）；出了硬边界是 -Infinity。 */
function score(w: World, alive: readonly Spot[], x: number, y: number, r: number): number {
  if (!inBounds(w, x, y, r)) return -Infinity;
  let s = Infinity;
  for (const q of alive) s = Math.min(s, outOfView(q, x, y));
  return s;
}

/** (x, y) 能不能刷一只半径 r 的敌人：在硬边界以内，而且不在任何一个活着的人物的屏幕里。 */
export const canSpawnAt = (w: World, alive: readonly Spot[], x: number, y: number, r: number) => score(w, alive, x, y, r) > 0;

/**
 * 在人物 p 的屏幕外找一个刷怪点：随便一个方向，屏幕外沿再往外 out0–out1 像素；要在硬边界以内、别人也看不见。
 * alive：所有活着的人物（联机时谁的屏幕里都不能凭空冒出来）；r：要刷的敌人的半径。
 */
export function spawnSpot(w: World, p: Spot, alive: readonly Spot[], r: number, out0: number, out1: number): Spot {
  const rng = w.rng;
  const at = (a: number, out: number): Spot => {
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const d = edgeDist(ux, uy) + out;
    return { x: p.x + ux * d, y: p.y + uy * d };
  };
  for (let i = 0; i < SPAWN.tries; i++) {
    const q = at(rng.next() * TAU, range(rng, out0, out1));
    if (score(w, alive, q.x, q.y, r) > 0) return q;
  }
  // 随机抽不到（人物在角落，能刷的方向只剩一小段）：把一整圈扫一遍（近、中、远三档，再往外加两档），在合格的候选里随机挑一个
  const a0 = rng.next() * TAU;
  const N = 32;
  const outs = [out0, (out0 + out1) / 2, out1, out1 + 40, out1 + 100];
  const ok: Spot[] = [];
  let best: Spot | null = null;
  let bs = -Infinity;
  for (let k = 0; k < N; k++) {
    for (const out of outs) {
      const q = at(a0 + (k / N) * TAU, out);
      const s = score(w, alive, q.x, q.y, r);
      if (s > 0) ok.push(q);
      else if (s > bs) {
        bs = s;
        best = q;
      }
    }
  }
  if (ok.length) return ok[Math.floor(rng.next() * ok.length)];
  // 哪儿都在某个人的屏幕里（几个人的镜头把能刷的地方盖满了）：取陷得最浅的；一个在界内的候选都没有就夹回界内
  return best ?? clampBounds(w, at(a0, out0), r);
}

function clampBounds(w: World, q: Spot, r: number): Spot {
  const D = MIASMA.depth;
  const i = w.miasmaInset;
  return { x: Math.max(i.x - D + r, Math.min(ARENA.w - i.x + D - r, q.x)), y: Math.max(i.y - D + r, Math.min(ARENA.h - i.y + D - r, q.y)) };
}

/**
 * 包围：在人物 p 四周刷一整圈 n 只，按方向均匀分布，都贴着屏幕外沿（再往外 SPAWN.surgeGap 像素）—— 从屏幕四边一起压进来。
 * 出了硬边界、或落在别人屏幕里的方向不要，n 只匀到剩下的方向上（人物靠墙时，合围从场内那几面压过来，数量不少）。
 */
export function surgeSpots(w: World, p: Spot, alive: readonly Spot[], r: number, n: number): Spot[] {
  const steps = Math.max(144, n * 6);
  const ok: Spot[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * TAU;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const d = edgeDist(ux, uy) + SPAWN.surgeGap;
    const x = p.x + ux * d;
    const y = p.y + uy * d;
    if (score(w, alive, x, y, r) > 0) ok.push({ x, y });
  }
  if (!ok.length) return Array.from({ length: n }, () => spawnSpot(w, p, alive, r, SPAWN.out[0], SPAWN.out[1]));
  const out: Spot[] = [];
  let last = -1;
  let rep = 0;
  for (let j = 0; j < n; j++) {
    const k = Math.floor(((j + 0.5) * ok.length) / n);
    // 合格的方向比要刷的还少（人物缩在角落里）：同一个点上的第二只起往外错开一点，别叠成一只
    rep = k === last ? rep + 1 : 0;
    last = k;
    const q = ok[k];
    const d = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    out.push(rep ? { x: q.x + ((q.x - p.x) / d) * rep * 2 * r, y: q.y + ((q.y - p.y) / d) * rep * 2 * r } : q);
  }
  return out;
}
