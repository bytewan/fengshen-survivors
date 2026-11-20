// 联机：其他人（不是房主）这边。不推进模拟：
//   - 收房主的状态，交给镜像世界（mirror.ts）；收存档（迁移房主时用）、暂停 / 继续、开局 / 重开；
//   - 自己的操作每秒约 30 次发给房主（摇杆方向 + 神通按了几次），商店指令随点随发；
//   - 每秒 ping 一次房主，量往返延迟（显示在战斗界面角上）。
import type { Command, PlayerInput } from '../sim/world.ts';
import type { Link } from './link.ts';
import type { Mirror, StateMsg } from './mirror.ts';
import { parseMsg, type GuestMsg, type HostMsg, type Slot } from './protocol.ts';

/** 每秒发几次操作。 */
export const INPUT_HZ = 30;

export class GuestSide {
  readonly link: Link;
  mirror: Mirror;
  /** 房主那边的往返延迟（毫秒，平滑过的；还没量到是 0）。 */
  rtt = 0;
  /** 房主暂停了（打开暂停面板、切到后台）。 */
  hostPaused: false | 'menu' | 'hidden' = false;
  /** 最近一次收到的整局存档（迁移房主时新房主从这里重开这一波）。 */
  lastSave: Extract<HostMsg, { t: 'save' }> | null = null;
  /** 最近一次收到状态的时刻（performance.now()）。 */
  lastState = 0;
  /** 统计：最近一秒收到多少字节。 */
  bytesPerSec = 0;
  /** 发出去的操作的序号（预测用：房主在状态里告诉我们处理到第几个了）。 */
  seq = 0;
  /** 收到「开局 / 重开 / 迁移后接着打」。 */
  onStart: ((m: Extract<HostMsg, { t: 'start' }>) => void) | null = null;
  /** 房主回到标题了。 */
  onEnd: (() => void) | null = null;
  /** 人物分配变了（有人中途加入）。 */
  onSlots: ((slots: Slot[]) => void) | null = null;
  private skillN = 0;
  private runSeed: number | undefined;
  private syncAt = -Infinity;
  private rtts: number[] = [];
  private lastSent = { x: 0, y: 0, k: 0, at: -1e9 };
  private lastPing = 0;
  private byteWin: { at: number; n: number }[] = [];
  private off: (() => void)[] = [];

  constructor(link: Link, mirror: Mirror) {
    this.link = link;
    this.mirror = mirror;
    this.off.push(link.on('data', (from, text) => this.onData(from, text)));
  }

  dispose() {
    for (const f of this.off) f();
    this.off = [];
  }

  private onData(from: number, text: string) {
    if (from !== this.link.host) return; // 只听房主的
    const now = performance.now();
    this.byteWin.push({ at: now, n: text.length });
    while (this.byteWin.length && now - this.byteWin[0].at > 1000) this.byteWin.shift();
    this.bytesPerSec = this.byteWin.reduce((s, x) => s + x.n, 0);
    const m = parseMsg<HostMsg>(text);
    if (!m) return;
    switch (m.t) {
      case 'st':
        if (m.r !== undefined && this.runSeed !== undefined && m.r !== this.runSeed) return;
        this.lastState = now;
        this.hostPaused = false;
        this.mirror.receive(m as StateMsg, now);
        // 好久没画（自己开着暂停面板、页面在后台）攒了一大堆没打的差：不追了，要一份整的
        if (this.mirror.waitingKey || this.mirror.queued > 30) this.sync();
        return;
      case 'ev':
        if (m.r !== this.runSeed) return;
        this.mirror.receiveEvents(m.q, m.k, m.e);
        return;
      case 'save':
        this.lastSave = m;
        return;
      case 'pause':
        this.hostPaused = m.on ? m.why : false;
        return;
      case 'pong': {
        // 最近 8 次的中位数（刚进局时页面在建画面，头几次很慢，平滑的话要很久才降下来）
        const r = now - m.c;
        if (r < 0 || r >= 10000) return;
        this.rtts.push(r);
        if (this.rtts.length > 8) this.rtts.shift();
        const s = [...this.rtts].sort((a, b) => a - b);
        this.rtt = s[s.length >> 1];
        return;
      }
      case 'start':
        this.onStart?.(m);
        return;
      case 'end':
        this.onEnd?.();
        return;
      case 'slots':
        this.onSlots?.(m.slots);
        return;
    }
  }

  /** 新局或重入：不把上一局的输入、存档和同步请求带过来。 */
  beginRun(seed: number) {
    this.runSeed = seed;
    this.seq = this.skillN = 0;
    this.lastSent = { x: 0, y: 0, k: 0, at: -1e9 };
    this.lastSave = null;
    this.hostPaused = false;
    this.syncAt = -Infinity;
  }

  /** 要一份整的状态。等待期间最多每两秒重试一次。 */
  sync() {
    const now = performance.now();
    if (this.mirror.waitingKey && now - this.syncAt < 2000) return;
    this.syncAt = now;
    this.mirror.resync();
    this.send({ t: 'sync', r: this.runSeed });
  }

  /** 按了一下神通（攒着，随下一次操作发出去）。 */
  pressSkill() {
    this.skillN++;
  }

  /**
   * 每帧调：最多每秒 30 次，神通和变向随下一份操作发出（最多等 33 毫秒）。返回输入序号，供预测使用。
   */
  tickInput(inp: PlayerInput): number {
    const now = performance.now();
    if (inp.skill) this.skillN++;
    const x = Number.isFinite(inp.mx) ? Math.round(inp.mx * 100) / 100 : 0;
    const y = Number.isFinite(inp.my) ? Math.round(inp.my * 100) / 100 : 0;
    // 快速拖摇杆不能突破发送上限，否则中继限流会断开连接，表现为卡顿和回弹。
    let predictedSeq = this.seq + 1;
    if (now - this.lastSent.at >= 1000 / INPUT_HZ) {
      this.seq++; predictedSeq = this.seq;
      this.send({ t: 'in', r: this.runSeed, s: this.seq, x, y, k: this.skillN, ack: this.mirror.ack });
      this.lastSent = { x, y, k: this.skillN, at: now };
    }
    if (this.mirror.waitingKey && now - this.syncAt >= 2000) this.sync();
    if (now - this.lastPing > 1000) {
      this.lastPing = now;
      this.send({ t: 'ping', c: Math.round(now), ack: this.mirror.ack });
    }
    return predictedSeq;
  }

  sendCommand(c: Command) {
    this.send({ t: 'cmd', r: this.runSeed, c });
  }

  again() {
    this.send({ t: 'again' });
  }

  send(m: GuestMsg) {
    this.link.send(JSON.stringify(m), undefined, m.t === 'in' || m.t === 'ping');
  }

  /** 名单里房主的那个人物是第几个（slots 里找）。 */
  static hostSlot(slots: Slot[], hostId: number) {
    return slots.findIndex((s) => s.id === hostId);
  }
}
