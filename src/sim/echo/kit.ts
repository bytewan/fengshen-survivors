// 回响化身遭遇战的公共小工具（招式脚本 zhao.ts / yunxiao.ts 和状态机 index.ts 共用）。
import { ARENA } from '../config.ts';
import type { EchoFight, EchoHazard } from './types.ts';
import type { Enemy, Player, SimEvent } from '../types.ts';
import type { World } from '../world.ts';

/** 一招的脚本：每帧调一次（cast 状态里），返回 true = 这一招出完了、进收招。 */
export type MoveScript = (w: World, f: EchoFight, e: Enemy, p: Player, ev: SimEvent[]) => boolean;

/** 招式脚本里的「到了第 T 秒」：每个时间点只触发一次。 */
export const at = (f: EchoFight, T: number) => f.lt < T && f.t >= T;

/** 朝向：目标在左还是在右（差得很少时不转，免得来回抖）。 */
export function face(f: EchoFight, from: { x: number }, toX: number) {
  if (Math.abs(toX - from.x) > 2) f.facing = toX >= from.x ? 1 : -1;
}

/** 把一个点收进仙台里（往里再收 pad 像素）：招式不落进魔气里。 */
export function clampIn(x: number, y: number, pad = 0) {
  return { x: Math.max(ARENA.pad + pad, Math.min(ARENA.w - ARENA.pad - pad, x)), y: Math.max(ARENA.pad + pad, Math.min(ARENA.h - ARENA.pad - pad, y)) };
}

/** 加一个危险物（开始预警），发 echoCast。 */
export function addHazard(w: World, f: EchoFight, h: Omit<EchoHazard, 'id' | 't' | 'x' | 'y' | 'px' | 'py' | 'hits'>, ev: SimEvent[]): EchoHazard {
  const hz: EchoHazard = { ...h, id: w.nextId++, t: 0, x: h.x0, y: h.y0, px: h.x0, py: h.y0, hits: 0 };
  f.hazards.push(hz);
  ev.push({ t: 'echoCast', id: f.id, hazard: hz.id, move: hz.move, shape: hz.kind, x: hz.x0, y: hz.y0 });
  return hz;
}
