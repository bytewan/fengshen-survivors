// 联机：其他人（不是房主）这边的「镜像世界」。
//
// 不推进模拟：独立状态从确认基线解码，合并过时显示帧，表现层读镜像绘制：
//   - 插值：落后房主约 100 毫秒画（缓冲），画的时刻 rt 落在两份状态之间，px / py 是前一份的位置、x / y 是后一份的，
//     alpha 是两份之间走了多少——表现层本来就按 alpha 在 px → x 之间插值（单人时是两帧模拟之间），所以不用改；
//   - 事件：每个事件带着发生的帧号，画的时刻走到那一帧才交给特效、界面、音效（和画面上的位置对得上）；
//   - 自己的人物：按本地的操作先走（预测），手感不黏；收到房主的状态后，按「房主已经处理到第几个操作」算出该在哪，
//     差得不多就慢慢拉过去，差太多（被推开、穿墙）直接跳过去。
import { apply, decodePatch, diffObj, fullPatch, shiftPrev, type PlainObj } from './codec.ts';
import type { StampedEvent } from './protocol.ts';
import { MotionSmoother } from './motion.ts';
import { ARENA, MIASMA, PLAYER } from '../sim/config.ts';
import { miasmaDepth, type PlayerInput, type SimEvent, type World } from '../sim/world.ts';

/** 状态消息里镜像要用的部分。 */
export interface StateMsg {
  k: number;
  /** 传输序号独立于模拟帧：暂停、结束时也能更新状态。 */
  n?: number;
  b?: number;
  decoded?: PlainObj;
  f?: 1;
  d?: PlainObj;
  e?: StampedEvent[];
  a: number[];
  p: [number, number][];
}

/** 画面落后房主多少帧（60 帧 = 1 秒）：约 100 毫秒；网络抖得厉害时自动加一点。 */
const BASE_DELAY = 6;
const MAX_DELAY = 12;
/** 事件过了这么多帧还没放就不放了（半秒）；FLOW 里的不管多晚都放（界面的流程靠它们：横幅、商店、陨落面板、首领战后的对白）。 */
const STALE_EVENTS = 30;
const FLOW = new Set<string>(['waveStart', 'waveEnd', 'shopOpen', 'over', 'win', 'chapterClear', 'bossIntro', 'bossPhase', 'bossDeath', 'bossMiasmaWarn', 'bossMiasma', 'join', 'leave', 'away']);

/** 镜像里没有随机数（表现层不该用它；万一哪里用了，给个不会出错的）。 */
const dummyRng = { state: 0, next: () => Math.random() };

export class Mirror {
  /** 表现层读的世界（第一份整的状态到之前，是本地按同一个种子建的开局样子）。 */
  world: World;
  /** 自己是第几个人物。 */
  me: number;
  /** 收到第一份整的状态了没有。 */
  ready = false;
  /** 表现层的插值系数（px → x）。 */
  alpha = 1;
  /** 统计：缓冲里排着几份、画面落后最新那份几帧。 */
  get queued() {
    return this.queue.length;
  }
  lag = 0;
  private queue: StateMsg[] = [];
  private bases = new Map<number, PlainObj>();
  private rendered: PlainObj | null = null;
  private motion = new MotionSmoother();
  private clock = 0;
  private delay = BASE_DELAY;
  private gaps: number[] = [];
  private eventSeq = 0;
  dropped = 0;
  extrapolated = 0;
  get ack() { return this.newestSeq; }
  get bufferMs() { return Math.round(this.delay * 1000 / 60); }
  private pending: { tick: number; ev: SimEvent }[] = [];
  private rt = 0; // 画的时刻（房主的帧号，带小数）
  private A = 0; // px / py 那一份的帧号
  private B = 0; // x / y 那一份的帧号
  private newest = -1; // latest simulation tick
  private newestSeq = -1;
  private authDirty = false;
  private correction = { x: 0, y: 0 };
  private lastArrive = 0;
  private jitter = 0; // 到达间隔的抖动（毫秒，平滑过的）
  private needKey = true;
  // 自己的人物（预测）
  private pred = { x: 0, y: 0, on: false };
  private hist: { s: number; dx: number; dy: number }[] = [];
  private auth: { x: number; y: number; ack: number } | null = null;
  private speed: number | null = null;
  private physicsInset: { x: number; y: number } | null = null;

  constructor(placeholder: World, me: number) {
    this.world = placeholder;
    this.me = me;
  }

  /** 重开一局（再战、迁移之后）：先画 placeholder，等新的整份状态。 */
  reset(placeholder: World, me: number) {
    this.motion.clear();
    this.bases.clear(); this.rendered = null; this.clock = 0; this.delay = BASE_DELAY;
    this.gaps = []; this.eventSeq = 0; this.dropped = this.extrapolated = 0;
    this.world = placeholder;
    this.me = me;
    this.ready = false;
    this.needKey = true;
    this.queue = [];
    this.pending = [];
    this.newest = this.newestSeq = -1;
    this.lastArrive = this.jitter = this.lag = this.lastCorr = 0;
    this.authDirty = false;
    this.correction.x = this.correction.y = 0;
    this.alpha = 1;
    this.pred.on = false;
    this.hist = [];
    this.auth = null; this.speed = null; this.physicsInset = null;
  }

  /** 要一份整的状态（重连、出错之后）：在它到之前，差量一律丢掉。 */
  resync() {
    this.needKey = true;
    this.queue = [];
    this.bases.clear();
  }

  get waitingKey() {
    return this.needKey;
  }

  receiveEvents(q: number, k: number, events: StampedEvent[]) {
    if (!Number.isInteger(q) || q <= this.eventSeq) return;
    this.eventSeq = q;
    for (const [dk, ev] of events) this.pending.push({ tick: k - dk, ev });
    if (this.pending.length > 4000) this.pending.splice(0, this.pending.length - 4000);
  }

  /** 收到一份状态（网络那边一到就调，不等画面）。 */
  receive(m: StateMsg, now: number) {
    if (m.n !== undefined && m.n < this.newestSeq) { this.dropped++; return; }
    const independent = m.b !== undefined;
    if (independent) {
      const base = m.f ? {} : this.bases.get(m.b!);
      if (!base) { this.resync(); return; }
      m = { ...m, decoded: decodePatch(base, m.d ?? {}) };
      if (m.n !== undefined) {
        this.bases.set(m.n, m.decoded!);
        while (this.bases.size > 64) this.bases.delete(this.bases.keys().next().value!);
      }
    }
    if (m.f) {
      // 整份：从空对象建一个新的镜像，缓冲清空
      this.motion.undo();
      const w = apply({}, structuredClone(m.d ?? {})) as unknown as World;
      this.rendered = m.decoded ?? null;
      (w as { rng: unknown }).rng = dummyRng;
      this.world = w;
      this.queue = [];
      this.A = this.B = m.k; this.rt = m.k - BASE_DELAY;
      this.newest = m.k;
      this.newestSeq = m.n ?? -1;
      this.lastArrive = this.clock = now;
      this.delay = BASE_DELAY; this.gaps = [];
      this.jitter = this.lag = 0;
      this.needKey = false;
      this.ready = true;
      // 重连补全不丢掉尚未确认的本地移动；reset 已负责清理新局。
      for (const [dk, ev] of m.e ?? []) this.pending.push({ tick: m.k - dk, ev });
      this.noteAuth(m);
      return;
    }
    if (this.needKey) return;
    if (m.n !== undefined ? m.n <= this.newestSeq : m.k <= this.newest) return; // 重复、过时的
    if (!independent && m.n !== undefined && this.newestSeq >= 0 && m.n > this.newestSeq + 1) {
      // 不能跳过差量直接套下一份，否则商店和位置都会永久错位。
      this.resync();
      return;
    }
    this.queue.push(m);
    const step = Math.max(1, m.k - this.newest);
    this.newest = m.k;
    this.newestSeq = m.n ?? this.newestSeq;
    if (this.lastArrive) {
      const gap = now - this.lastArrive;
      const expect = step * 1000 / 60;
      this.gaps.push(Math.max(0, gap - expect));
      if (this.gaps.length > 40) this.gaps.shift();
      const sorted = [...this.gaps].sort((a, b) => a - b);
      this.jitter = sorted[Math.floor((sorted.length - 1) * 0.9)] ?? 0;
    }
    this.lastArrive = now;
    this.clock = Math.max(this.clock, now);
    this.noteAuth(m);
  }

  private noteAuth(m: StateMsg) {
    const p = m.p?.[this.me];
    if (!p) return;
    this.auth = { x: p[0], y: p[1], ack: m.a?.[this.me] ?? 0 };
    this.authDirty = true;
    const latest = (m.decoded?.players as PlainObj[] | undefined)?.[this.me];
    const speed = (latest?.stats as PlainObj | undefined)?.speed;
    if (typeof speed === 'number') this.speed = speed;
    const inset = m.decoded?.miasmaInset as PlainObj | undefined;
    if (typeof inset?.x === 'number' && typeof inset?.y === 'number') this.physicsInset = { x: inset.x, y: inset.y };
  }

  /**
   * 每帧：推进画的时刻，把该打的差打上，算 alpha，返回到点了的事件。
   * paused：房主暂停了（画面停住，时刻不走）。
   */
  advance(dt: number, paused = false): SimEvent[] {
    if (!this.ready) return [];
    this.motion.undo();
    this.clock += dt * 1000;
    const desired = Math.min(MAX_DELAY, BASE_DELAY + this.jitter * 60 / 1000);
    // 延迟慢慢下降、较快上升，避免包成批到达时缓冲忽大忽小。
    const tau = desired > this.delay ? 0.25 : 2;
    this.delay += (desired - this.delay) * (1 - Math.exp(-dt / tau));
    if (!paused) {
      // 时间轴在快照之间继续前进，短时缺包最多外推 100ms，不随每包到达而重置。
      const elapsed = Math.max(0, this.clock - this.lastArrive) * 60 / 1000;
      const target = this.newest + Math.min(elapsed, this.delay + 6) - this.delay;
      const gap = target - this.rt;
      if (gap > MAX_DELAY) this.rt = target;
      else this.rt += dt * 60 * (1 + Math.max(-0.08, Math.min(0.08, gap * 0.015)));
      this.rt = Math.min(this.rt, this.newest + 6);
    }
    // 商店没有移动插值需求：阶段变化、购买和选天赋的结果立即应用。
    if (this.world.phase !== 'wave' || this.queue.some(m => m.d?.phase && m.d.phase !== 'wave')) this.rt = this.newest;
    let count = 0;
    let endTick = this.B;
    while (count < this.queue.length && (endTick < this.rt || this.queue[count].k <= endTick)) {
      endTick = this.queue[count++].k;
    }
    if (count && this.queue[count - 1].decoded) {
      // 每份独立快照已解码。过时的显示帧直接合并，只处理最后一份，避免突发时反复遍历世界。
      const m = this.queue[count - 1];
      const patch = diffObj(this.rendered ?? {}, m.decoded!);
      shiftPrev(this.world);
      if (patch) apply(this.world as unknown as Record<string, unknown>, structuredClone(patch));
      this.rendered = m.decoded!;
      this.A = this.B; this.B = m.k;
      this.dropped += count - 1;
    } else {
      for (let i = 0; i < count; i++) {
        const m = this.queue[i];
        if (i === count - 1) shiftPrev(this.world);
        if (m.d) apply(this.world as unknown as Record<string, unknown>, m.d);
        this.A = this.B; this.B = m.k;
        for (const [dk, ev] of m.e ?? []) this.pending.push({ tick: m.k - dk, ev });
      }
    }
    if (count) this.queue.splice(0, count);
    this.alpha = this.B > this.A ? Math.max(0, Math.min(1, (this.rt - this.A) / (this.B - this.A))) : 1;
    this.lag = Math.max(0, this.newest + (!paused && this.world.phase === 'wave' ? Math.min(Math.max(0, this.clock - this.lastArrive) * 60 / 1000, this.delay + 6) : 0) - this.rt);
    const extra = !paused && this.world.phase === 'wave' ? Math.min(6, Math.max(0, this.rt - this.B)) : 0;
    this.extrapolated = extra * 1000 / 60;
    this.motion.draw(this.world, this.me, this.alpha, this.B - this.A, extra, count > 0, dt);
    if (!this.pending.length) return [];
    const due: SimEvent[] = [];
    let keep = 0;
    for (const p of this.pending) {
      if (p.tick > Math.min(this.rt, this.newest) + 1e-6) this.pending[keep++] = p;
      // 早就过了的（自己暂停了一阵、一下追上来）只放管流程的那几种（开波、商店、陨落、首领……），命中、击杀这些不放：不然同时炸开一大片
      else if (p.tick >= this.rt - STALE_EVENTS || FLOW.has(p.ev.t)) due.push(p.ev);
    }
    this.pending.length = keep;
    return due;
  }

  // ---------- 自己的人物：预测 ----------

  /**
   * 每帧（在 advance 之后）：按本地的操作把自己的人物往前走一步，然后把镜像里自己的位置换成预测的位置
   * （表现层所有跟着人物走的东西——法宝、光环、镜头——都跟着它）。seq 是这一帧的操作会随哪一次发给房主。
   */
  predict(inp: PlayerInput, dt: number, seq: number) {
    const w = this.world;
    const p = w.players?.[this.me];
    if (!p || !this.ready) return;
    // 一次网络突发可能有几十份旧状态，只用最新的校正一次。
    if (this.authDirty) {
      this.authDirty = false;
      this.reconcile();
    }
    const moving = w.phase === 'wave' && p.alive;
    if (!moving || !this.auth) {
      // 不在打（收灵、商店）或者倒下了：位置就是房主的
      this.pred.on = false;
      this.correction.x = this.correction.y = 0;
      this.hist = [];
      return;
    }
    if (!this.pred.on) {
      this.pred = { x: this.auth.x, y: this.auth.y, on: true };
    }
    let mx = Number.isFinite(inp.mx) ? inp.mx : 0;
    let my = Number.isFinite(inp.my) ? inp.my : 0;
    const m = Math.hypot(mx, my);
    if (m > 1) {
      mx /= m;
      my /= m;
    }
    // 和 world.ts 的 step 一样的走法：移速、魔气里的减速、魔气带外沿是硬边界
    const depth = miasmaDepth(this.pred.x, this.pred.y, this.physicsInset ?? w.miasmaInset);
    const slow = 1 - MIASMA.slowMax * Math.pow(depth, MIASMA.slowCurve);
    const sp = PLAYER.speed * (1 + (this.speed ?? p.stats.speed)) * slow;
    const ox = this.pred.x;
    const oy = this.pred.y;
    this.pred.x += mx * sp * dt;
    this.pred.y += my * sp * dt;
    clampOuter(this.pred, PLAYER.radius, this.physicsInset ?? w.miasmaInset);
    const h = this.hist[this.hist.length - 1];
    if (h && h.s === seq) {
      h.dx += this.pred.x - ox;
      h.dy += this.pred.y - oy;
    } else this.hist.push({ s: seq, dx: this.pred.x - ox, dy: this.pred.y - oy });
    if (this.hist.length > 120) this.hist.splice(0, this.hist.length - 120);
    // 镜像里自己的位置、朝向、走没走：换成本地的
    // 小误差在约 60 ms 内消化，不把每份网络校正画成一次跳步。
    const decay = Math.exp(-dt / 0.06);
    this.correction.x *= decay;
    this.correction.y *= decay;
    p.x = this.pred.x + this.correction.x;
    p.y = this.pred.y + this.correction.y;
    clampOuter(p, PLAYER.radius, this.physicsInset ?? w.miasmaInset);
    p.px = p.x;
    p.py = p.y;
    p.moving = m > 0.15;
    if (mx > 0.1) p.facing = 1;
    else if (mx < -0.1) p.facing = -1;
  }

  /** 收到房主的位置：房主已经处理到第 ack 个操作，之后的那些还没算进去——加上它们就是「现在应该在哪」。 */
  private reconcile() {
    const a = this.auth;
    if (!a || !this.pred.on) return;
    while (this.hist.length && this.hist[0].s <= a.ack) this.hist.shift();
    let ex = a.x;
    let ey = a.y;
    for (const h of this.hist) {
      ex += h.dx;
      ey += h.dy;
    }
    const dx = this.pred.x - ex;
    const dy = this.pred.y - ey;
    const d = Math.hypot(dx, dy);
    this.lastCorr = d;
    if (d > 32) {
      this.pred.x = ex;
      this.pred.y = ey;
      this.correction.x = this.correction.y = 0;
    } else {
      // 预测目标立即对齐，画面上的误差按时间平滑，网络包多少不影响平滑速度。
      this.pred.x = ex;
      this.pred.y = ey;
      this.correction.x += dx;
      this.correction.y += dy;
    }
  }

  /** 统计：最近一次校正时，预测的位置和「房主的位置加上他还没处理的那些操作」差了多少像素。 */
  lastCorr = 0;
  get predError(): number {
    return this.pred.on ? this.lastCorr : 0;
  }
}

/** 魔气带外沿是硬边界（同 world.ts 的 clampOuter；那边没导出，这里照抄三行）。 */
function clampOuter(o: { x: number; y: number }, r: number, inset = { x: 0, y: 0 }) {
  const D = MIASMA.depth;
  o.x = Math.max(inset.x - D + r, Math.min(ARENA.w - inset.x + D - r, o.x));
  o.y = Math.max(inset.y - D + r, Math.min(ARENA.h - inset.y + D - r, o.y));
}
