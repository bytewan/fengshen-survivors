// 联机：房主这边。全部模拟在房主的浏览器里跑（feel.ts 的主循环照常 step），这里管：
//   - 收其他人的操作（每人最新的一份；神通按次数算，不会漏）和商店指令（指令里的「第几个人」一律改成发的人自己的位置）；
//   - 每秒约 20 次广播基于 ACK 的独立世界状态；事件单独可靠发送；有人要整份的就单独发给他；
//   - 每一波开打时（和开局、商店打开时）发一份整局存档，房主掉线迁移时新房主从这里重开这一波；
//   - 名单变了（roster.ts）：掉线的人托管（setAway，操作由机器人 bot.botTurn 给、受到的伤害减半），回来了取消；
//     退出房间的人 removePlayer；中途进房的人排到商店阶段再 addPlayer（打着的时候先告诉他等一等）。
import { botTurn } from '../sim/bot.ts';
import { addPlayer, removePlayer, setAway } from '../sim/roster.ts';
import { applyXiuwei } from '../sim/xiuwei.ts';
import { sealFor } from '../sim/world.ts';
import { allowedHeroes, pickFreeHero } from '../sim/heroes/index.ts';
import { unlocks } from '../game/profile.ts';
import type { HeroId } from '../sim/types.ts';
import { snapshot } from '../sim/snapshot.ts';
import type { Command, PlayerInput, SimEvent, World } from '../sim/world.ts';
import { diffObj, fullPatch, plain, plainWorld, type PlainObj } from './codec.ts';
import type { Link } from './link.ts';
import { PROTOCOL, parseMsg, type GuestMsg, type HostMsg, type Slot, type StampedEvent } from './protocol.ts';

/** 每秒广播几次状态。 */
export const STATE_HZ = 20;
/** 一个人的操作这么久没更新（卡了、切后台了）就当他松手了，免得人物一直往一个方向走。 */
const STALE_MS = 400;

const NO_INPUT: PlayerInput = { mx: 0, my: 0, skill: false };
const COMMANDS = new Set(['pick', 'evolve', 'rerollLevel', 'buy', 'reroll', 'lock', 'sell', 'ready', 'learn', 'unready', 'give']);
const int = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/** 商店指令的形状对不对（不信客户端：字段的类型、范围都查一遍；player 由房主填）。 */
export function cleanCommand(c: unknown, player: number): Command | null {
  if (!c || typeof c !== 'object') return null;
  const o = c as Record<string, unknown>;
  if (typeof o.t !== 'string' || !COMMANDS.has(o.t)) return null;
  switch (o.t) {
    case 'pick':
      return int(o.index, 0, 16) ? { t: 'pick', player, index: o.index as number } : null;
    case 'evolve':
      return o.branch === 'bind' || o.branch === 'fire' ? { t: 'evolve', player, branch: o.branch } : null;
    case 'buy':
    case 'lock':
      return int(o.slot, 0, 16) ? { t: o.t, player, slot: o.slot as number } : null;
    case 'sell':
      return int(o.weapon, 0, 16) ? { t: 'sell', player, weapon: o.weapon as number } : null;
    case 'learn':
      return typeof o.id === 'string' && o.id.length <= 16 ? ({ t: 'learn', player, id: o.id } as Command) : null;
    case 'give':
      return int(o.to, 0, 7) && int(o.amount, 0, 1e6) ? { t: 'give', player, to: o.to as number, amount: o.amount as number } : null;
    default:
      return { t: o.t as 'reroll' | 'rerollLevel' | 'ready' | 'unready', player };
  }
}

export class HostSide {
  readonly link: Link;
  slots: Slot[];
  /** 自己是第几个人物（迁移之后不一定是 0）。 */
  me: number;
  /** 这一局的种子（中途进来的人要用它建开局的样子）。 */
  seed = 0;
  /** 统计：最近一秒发出去多少字节（状态消息，压缩前；中继再转给每个人）、一共发了几次。 */
  bytesPerSec = 0;
  sends = 0;
  private inputs: { inp: PlayerInput; at: number; seq: number; k: number }[] = [];
  private skillQueued: boolean[] = [];
  private appliedSeq: number[] = [];
  private stateSeq = 0;
  private eventSeq = 0;
  private history = new Map<number, PlainObj>();
  private acknowledgements = new Map<number, number>();
  private lastKeyAt = -Infinity;
  private cmds: Command[] = [];
  private shadow: PlainObj = {};
  private shadowTick = 0;
  private evs: { tick: number; ev: SimEvent }[] = [];
  private lastSend = -1e9;
  private byteWin: { at: number; n: number }[] = [];
  private wantKey = new Set<number>();
  private lastSave: HostMsg | null = null;
  /** 中途进房、在等商店的人（成员编号 → 告诉过他的原因），每人只说一次。 */
  private waiting = new Map<number, 'battle' | 'full'>();
  private off: (() => void)[] = [];
  /** 有人在陨落之后按了「再战」。 */
  onAgain: (() => void) | null = null;

  constructor(link: Link, slots: Slot[], me: number) {
    this.link = link;
    this.slots = slots;
    this.me = me;
    this.off.push(link.on('data', (from, text) => this.onData(from, text)));
  }

  dispose() {
    for (const f of this.off) f();
    this.off = [];
  }

  /** 中继成员编号 → 第几个人物（不在这一局里返回 -1）。 */
  slotOf(member: number) {
    return this.slots.findIndex((s) => s.id === member);
  }

  private onData(from: number, text: string) {
    const m = parseMsg<GuestMsg>(text);
    if (!m) return;
    if ('r' in m && m.r !== undefined && m.r !== this.seed) return;
    const i = this.slotOf(from);
    if (i >= 0 && 'ack' in m && int(m.ack, 1, this.stateSeq) && this.history.has(m.ack!)) {
      this.acknowledgements.set(from, Math.max(this.acknowledgements.get(from) ?? 0, m.ack!));
    }
    switch (m.t) {
      case 'in': {
        if (i < 0 || i === this.me) return;
        const prev = this.inputs[i];
        const x = typeof m.x === 'number' && Number.isFinite(m.x) ? Math.max(-1, Math.min(1, m.x)) : 0;
        const y = typeof m.y === 'number' && Number.isFinite(m.y) ? Math.max(-1, Math.min(1, m.y)) : 0;
        const seq = int(m.s, 0, 2 ** 31) ? m.s : (prev?.seq ?? 0);
        if (prev && seq < prev.seq) return; // 乱序的旧操作
        const k = int(m.k, 0, 2 ** 31) ? m.k : (prev?.k ?? 0);
        if (prev && k > prev.k) this.skillQueued[i] = true;
        this.inputs[i] = { inp: { mx: x, my: y, skill: false }, at: performance.now(), seq, k };
        return;
      }
      case 'cmd': {
        if (i < 0) return;
        const c = cleanCommand(m.c, i);
        if (c && this.cmds.length < 64) this.cmds.push(c);
        return;
      }
      case 'ping':
        if (typeof m.c === 'number') this.link.send(JSON.stringify({ t: 'pong', c: m.c } satisfies HostMsg), from, true);
        return;
      case 'sync':
        this.acknowledgements.delete(from);
        this.wantKey.add(from);
        if (this.lastSave) this.link.send(JSON.stringify(this.lastSave), from);
        return;
      case 'again':
        this.onAgain?.();
        return;
      case 'hello':
        // 大厅里的人：原来就在这一局里（刷新了页面）就把他接回去；新来的由 syncRoster 告诉他等到商店
        if (i >= 0) {
          this.clearInput(i);
          this.send({ t: 'start', seed: this.seed, slots: this.slots, resume: true, v: PROTOCOL }, from);
        } else this.waiting.delete(from);
        return;
    }
  }

  /**
   * 第 i 个人物（不是自己）这一帧的操作和指令：托管中的（Player.away）由机器人给（bot.botTurn：战斗时走位放神通，商店里替他买、替他按出战）；
   * 离开了的原地不动；别的用网络上收到的最新一份——卡住太久的当他松手了。
   */
  turn(i: number, w: World): { input: PlayerInput; commands: Command[] } {
    const p = w.players[i];
    if (!p || p.left) return { input: NO_INPUT, commands: [] };
    if (p.away) return botTurn(w, i);
    const v = this.inputs[i];
    if (!v || performance.now() - v.at > STALE_MS) return { input: NO_INPUT, commands: [] };
    this.appliedSeq[i] = v.seq;
    if (this.skillQueued[i]) {
      this.skillQueued[i] = false;
      return { input: { ...v.inp, skill: true }, commands: [] };
    }
    return { input: v.inp, commands: [] };
  }

  private clearInput(i: number) {
    delete this.inputs[i];
    this.appliedSeq[i] = 0;
    this.skillQueued[i] = false;
  }

  /** 这一帧要交给模拟的商店指令（其他人点的）。 */
  takeCommands(): Command[] {
    return this.cmds.splice(0);
  }

  /**
   * 每帧对一遍中继的名单（roster.ts）：掉线的人托管、回来了取消；退出房间的人从场上去掉；
   * 中途进房的人：商店阶段就加进来（发给他「开局」，告诉所有人新的人物分配），打着的时候先告诉他等到商店。
   * 返回这些变动发出的事件（调用方并进这一帧的事件：自己的画面要放、也要随状态广播出去）。
   */
  syncRoster(w: World): SimEvent[] {
    const ev: SimEvent[] = [];
    const members = this.link.members;
    for (let i = 0; i < w.players.length; i++) {
      if (i === this.me) continue;
      const p = w.players[i];
      if (!p || p.left) continue;
      const s = this.slots[i];
      const m = s ? members.find((x) => x.id === s.id) : undefined;
      if (!m) removePlayer(w, i, ev);
      else setAway(w, i, !m.on, ev); // 没变时什么都不做
    }
    let joined = false;
    for (const m of members) {
      if (!m.on || m.id === this.link.me || this.slotOf(m.id) >= 0) continue;
      // 关了页面又点链接回来的人（凭据在标签页里，关了就没了，中继当他是新来的）：名号和一个掉线的人物对得上，就把那个人物还给他
      const back = this.slots.findIndex((s, i) => i !== this.me && s && s.name === m.name && !!w.players[i] && !w.players[i].left && !members.some((x) => x.id === s.id && x.on));
      if (back >= 0) {
        this.slots[back] = { ...this.slots[back], id: m.id };
        this.clearInput(back);
        setAway(w, back, false, ev);
        this.waiting.delete(m.id);
        this.send({ t: 'slots', slots: this.slots });
        this.send({ t: 'start', seed: this.seed, slots: this.slots, resume: true, v: PROTOCOL }, m.id);
        continue;
      }
      if (w.phase === 'shop') {
        // 同一房间不能重复的角色：他选的已经有人在用了，就换成没人用的（sim/heroes/index.ts 的 pickFreeHero）
        // 能选哪些按房主的解锁（回响化身要房主解锁了才能选；sim/heroes/index.ts 的 allowedHeroes）
        const p = addPlayer(w, pickFreeHero(w.players.filter((q) => !q.left).map((q) => q.hero), (m.meta.hero ?? 'nezha') as HeroId, allowedHeroes(unlocks())), ev);
        if (p) {
          applyXiuwei(w, p, m.meta.xw); // 他点亮的修为（sim/xiuwei.ts；大厅里随名单带过来）
          sealFor(p, m.meta.sl); // 他还没解锁的东西（成就奖励）：万宝阁不给他刷
          this.slots[p.id] = { id: m.id, name: m.name, hero: p.hero, xw: m.meta.xw, sl: m.meta.sl };
          this.waiting.delete(m.id);
          joined = true;
          continue;
        }
      }
      // 打着的时候进来的：告诉他等到商店（房间满了就一直等）；每人只说一次
      const why = w.phase === 'shop' ? 'full' : 'battle';
      if (this.waiting.get(m.id) !== why) {
        this.waiting.set(m.id, why);
        this.send({ t: 'wait', why }, m.id);
      }
    }
    if (joined) {
      // 新人：给他「开局」（接着打，等整份状态）；所有人：新的人物分配（名字签）
      this.send({ t: 'slots', slots: this.slots });
      for (const m of members) if (this.slotOf(m.id) >= 0 && ev.some((e) => e.t === 'join' && this.slots[e.owner]?.id === m.id)) this.send({ t: 'start', seed: this.seed, slots: this.slots, resume: true, v: PROTOCOL }, m.id);
    }
    return ev;
  }

  /** 模拟走了一帧：记下这一帧的事件（随下一份状态一起发）。 */
  record(ev: SimEvent[], tick: number) {
    for (const e of ev) this.evs.push({ tick, ev: e });
    if (this.evs.length > 4000) this.evs.splice(0, this.evs.length - 4000); // 好久没发出去（暂停时）别越攒越多
  }

  /** 新开一局 / 迁移后接手：下一份状态发整份。 */
  restart(newRun = true) {
    this.shadow = {};
    this.history.clear();
    this.acknowledgements.clear();
    this.lastKeyAt = -Infinity;
    if (newRun) {
      this.eventSeq = 0;
      this.inputs = [];
      this.appliedSeq = [];
      this.skillQueued = [];
      this.cmds = [];
      this.lastSave = null;
      this.wantKey.clear();
    }
    this.evs = [];
    this.lastSend = -1e9;
  }

  /** 每帧调：到点了就广播一份状态。force：不管到没到点都发（暂停前、开局时）。 */
  flush(w: World, force = false) {
    const now = performance.now();
    if (!force && now - this.lastSend < 1000 / STATE_HZ - 2) return;
    this.lastSend = now;
    const next = plainWorld(w);
    this.shadow = next;
    this.shadowTick = w.tick;
    const e: StampedEvent[] = this.evs.map(({ tick, ev }) => [w.tick - tick, plain(ev, 'ev') as unknown as SimEvent]);
    this.evs = [];
    // 事件始终可靠发送，快照可以丢弃或乱序，不会吞商店、击杀、拾取等事件。
    if (e.length) this.link.send(JSON.stringify({ t: 'ev', r: this.seed, q: ++this.eventSeq, k: w.tick, e } satisfies HostMsg));
    const active = this.slots.filter((slot, i) => i !== this.me && this.link.members.some(m => m.id === slot.id && m.on));
    const ids = new Set(active.map(s => s.id));
    for (const id of this.acknowledgements.keys()) if (!ids.has(id)) this.acknowledgements.delete(id);
    // 共用已确认基线，仍只向 Java 上传一份，避免四人房突破房主消息限流。
    const acknowledged = active.map(s => this.acknowledgements.get(s.id) ?? 0).filter(n => this.history.has(n));
    const recent = acknowledged.filter(n => this.stateSeq - n <= STATE_HZ);
    // 新加入或长期不确认的队友单独补全，不拖住其他人的共同基线。
    const usable = recent.length ? recent : acknowledged;
    const base = usable.length ? Math.min(...usable) : 0;
    const previous = this.history.get(base);
    const first = !previous;
    const a = w.players.map((_, i) => (i === this.me ? 0 : (this.appliedSeq[i] ?? 0)));
    const p = w.players.map(pl => [Math.round(pl.x * 100) / 100, Math.round(pl.y * 100) / 100] as [number, number]);
    // 初始可靠整份在途时不要每 50ms 重复上传，事件仍照常送达。
    if (first && !force && !this.wantKey.size && now - this.lastKeyAt < 200) return;
    const n = ++this.stateSeq;
    const d = first ? fullPatch(next) : diffObj(previous, next);
    this.history.set(n, next);
    for (const key of this.history.keys()) if (key < n - STATE_HZ - 4 && key !== base) this.history.delete(key);
    while (this.history.size > 64) this.history.delete(this.history.keys().next().value!);
    const msg: HostMsg = { t: 'st', k: w.tick, n, b: first ? 0 : base, r: this.seed, a, p, ...(first ? { f: 1 as const } : {}), ...(d ? { d } : {}) };
    const text = JSON.stringify(msg);
    this.link.send(text, undefined, !first);
    if (first) this.lastKeyAt = now;
    this.count(text.length, now);
    if (this.wantKey.size && !first) {
      const key = JSON.stringify({ t: 'st', k: w.tick, n, b: 0, r: this.seed, f: 1, d: fullPatch(next), a, p } satisfies HostMsg);
      for (const id of this.wantKey) this.link.send(key, id);
      this.count(key.length * this.wantKey.size, now);
    }
    this.wantKey.clear();
  }

  private count(n: number, now: number) {
    this.sends++;
    this.byteWin.push({ at: now, n });
    while (this.byteWin.length && now - this.byteWin[0].at > 1000) this.byteWin.shift();
    this.bytesPerSec = this.byteWin.reduce((s, x) => s + x.n, 0);
  }

  /** 发一份整局存档（每一波开打时、开局时、商店打开时）。 */
  save(w: World, seed: number) {
    const msg: HostMsg = { t: 'save', wave: w.wave, data: snapshot(w), slots: this.slots, seed };
    this.lastSave = msg;
    this.link.send(JSON.stringify(msg));
  }

  send(m: HostMsg, to?: number) {
    this.link.send(JSON.stringify(m), to);
  }
}
