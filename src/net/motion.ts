// 镜像的显示位置可短时外推；每帧先还原，永远不改 ACK 基线、伤害或碰撞。
import type { World } from '../sim/world.ts';
type Point = { x: number; y: number; px: number; py: number };
type Seen = { x: number; y: number; bx: number; by: number; extra: number };
type Tracked = { p: Point; seen: Seen; x: number; y: number; px: number; py: number };
export class MotionSmoother {
  private points: Tracked[] = [];
  private seen = new Map<string, Seen>();
  private world: World | null = null;
  private drawn = false;
  undo() {
    if (!this.drawn) return;
    for (const v of this.points) { v.p.x = v.x; v.p.y = v.y; v.p.px = v.px; v.p.py = v.py; }
    this.drawn = false;
  }
  clear() { this.undo(); this.seen.clear(); this.points = []; this.world = null; }
  private track(world: World, me: number) {
    const points: Tracked[] = [], alive = new Set<string>();
    const visit = (value: unknown, key: string) => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { value.forEach((v, i) => visit(v, key + '/' + ((v as { id?: number })?.id ?? i))); return; }
      const o = value as Record<string, unknown>;
      if (typeof o.x === 'number' && typeof o.y === 'number' && typeof o.px === 'number' && typeof o.py === 'number' && key !== 'players/' + me) {
        const p = o as unknown as Point;
        let seen = this.seen.get(key);
        if (!seen) { seen = { x: p.x, y: p.y, bx: 0, by: 0, extra: 0 }; this.seen.set(key, seen); }
        alive.add(key); points.push({ p, seen, x: p.x, y: p.y, px: p.px, py: p.py });
      }
      for (const name in o) if (o[name] && typeof o[name] === 'object' && name !== 'rng') visit(o[name], key ? key + '/' + name : name);
    };
    visit(world, '');
    for (const key of this.seen.keys()) if (!alive.has(key)) this.seen.delete(key);
    this.points = points; this.world = world;
  }
  draw(world: World, me: number, alpha: number, span: number, extra: number, changed: boolean, dt: number) {
    if (world.phase !== 'wave') { this.clear(); return; }
    // 仅收到新显示状态时重建索引；渲染帧复用记录，避免 60Hz 遍历整个世界和分配 Map。
    if (changed || world !== this.world) this.track(world, me);
    const decay = Math.exp(-dt / 0.08);
    for (const v of this.points) {
      const { p, seen } = v;
      const x = p.px + (p.x - p.px) * alpha, y = p.py + (p.y - p.py) * alpha;
      if (changed && seen.extra > 0) {
        const dx = seen.x - x, dy = seen.y - y;
        if (Math.hypot(dx, dy) < 48) { seen.bx = dx; seen.by = dy; } else seen.bx = seen.by = 0;
      }
      seen.bx *= decay; seen.by *= decay;
      const vx = span > 0 ? (p.x - p.px) / span : 0, vy = span > 0 ? (p.y - p.py) / span : 0;
      const speed = Math.hypot(vx, vy), scale = speed > 10 ? 10 / speed : 1;
      const dx = vx * scale * extra + seen.bx, dy = vy * scale * extra + seen.by;
      v.x = p.x; v.y = p.y; v.px = p.px; v.py = p.py;
      p.x += dx; p.px += dx; p.y += dy; p.py += dy;
      seen.x = x + dx; seen.y = y + dy; seen.extra = extra;
    }
    this.drawn = true;
  }
}
