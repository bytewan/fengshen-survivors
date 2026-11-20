// 联机的消息格式（TypeScript 类型）。两层：
//   1. 和中继之间的控制帧（RelayIn / RelayOut）：建房、进房、名单、心跳、房主变更……中继只认这些（server/relay.mjs）。
//   2. 房主和其他人之间的游戏消息（HostMsg / GuestMsg）：装在数据帧里，中继原样转发、不解析。
// 编码：都是 JSON 文本。状态消息里的世界状态是差量（codec.ts）。
import type { Command, HeroId, SimEvent } from '../sim/types.ts';
import type { PlainObj } from './codec.ts';
import type { WorldSnapshot } from '../sim/snapshot.ts';

/** 名单上每个人的附加信息（自己设置，中继原样转给房里的人）。 */
export interface MemberMeta {
  /** 房主选择浏览器直连，成员沿用这个传输方式。 */
  rtc?: 1 | 2; // 1：必须直连；2：后台尝试公网直连，随时回退中继
  hero?: HeroId;
  ready?: boolean;
  /** 客户端版本（以后协议改了，大厅里能提示「版本不一样」）。 */
  v?: number;
  /** 自己点亮的修为（sim/xiuwei.ts 的节点 id）：房主开局时按它给每个人加上（各带各的）。 */
  xw?: string[];
  /** 房主选的劫数（只有房主的有；大厅里其他人照着它显示「这一局是劫几」）。 */
  jie?: number;
  /** 解锁了的回响化身、隐藏角色（存档里的解锁 id）：房间里能选哪些角色按房主的这一份（只看房主的；设计文档「选角规则」）。 */
  un?: string[];
  /** 自己还没解锁的东西（成就奖励，game/achievements.ts 的 sealedItems）：房主开局时按它给每个人的万宝阁去掉这几样（各带各的）。 */
  sl?: string[];
}

export interface Member {
  id: number;
  name: string;
  meta: MemberMeta;
  /** 连着没有（掉线的人位置还留着，等他重连）。 */
  on: boolean;
  /** 进房顺序（房主掉线时按它挑下一个房主）。 */
  order: number;
  host: boolean;
}

/** 协议版本：房主和其他人不一样时，大厅提示并阻止混用。 */
export const PROTOCOL = 5;

/** 房间码的字符（和 server/relay.mjs 的 CODE_CHARS 一致）：去掉容易看混的 0 / O、1 / I / L。 */
export const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// ---------- 和中继之间 ----------

export type RelayIn =
  | { t: 'create'; name: string; meta: MemberMeta }
  | { t: 'join'; room: string; name: string; meta: MemberMeta; token?: string }
  | { t: 'leave' }
  | { t: 'meta'; meta: MemberMeta; name?: string }
  | { t: 'hb'; c: number }
  | { t: 'abdicate' };

export type RelayOut =
  | { t: 'joined'; room: string; you: number; token: string; host: number; members: Member[] }
  | { t: 'room'; room: string; host: number; members: Member[] }
  | { t: 'host'; id: number; prev: number; why: string }
  | { t: 'hostAway'; id: number; wait: number }
  | { t: 'hb'; c: number }
  | { t: 'err'; code: 'no_room' | 'full' | 'bad' | 'busy' | 'rate' | 'size'; msg: string }
  /** 中继要关了（更新、重启）：房间都在中继的内存里，重启后就没了，收到的人不再重连回这个房（docs/deploy.md）。 */
  | { t: 'bye'; msg: string };

// ---------- 房主 ↔ 其他人 ----------

/** 一局里的一个人物位置（players[i]）是谁。 */
export interface Slot {
  /** 中继给的成员编号。 */
  id: number;
  name: string;
  hero: HeroId;
  /** 他点亮的修为（开局时从名单上的 meta.xw 抄过来；房主开局按它给他加上）。 */
  xw?: string[];
  /** 他还没解锁的东西（开局时从名单上的 meta.sl 抄过来；万宝阁不给他刷，sim/world.ts 的 RunSetup.sealed）。 */
  sl?: string[];
}

/** 状态消息里的一个事件：[距这一份状态的帧数（≥ 0，越大越早）, 事件]。 */
export type StampedEvent = [number, SimEvent];

export type HostMsg =
  /**
   * 开局（或重开、迁移后从存档接着打）：种子、人物位置的分配。其他人收到就建好画面，等第一份整的状态。
   * resume：迁移房主之后从这一波开始时的存档接着打（不是新开一局）。jie：这一局的劫数（房主开房时选的，sim/jie.ts；没有 = 劫一）。
   */
  | { t: 'start'; seed: number; slots: Slot[]; resume?: boolean; v: number; jie?: number }
  /**
   * 状态（约 20 次 / 秒）：k 房主模拟帧号；f 是整份；b 是已确认基线，d 是相对该基线的差量；
   * n 递增的传输序号（模拟停住时也递增），r 本局种子（过滤上一局滞留的消息）。
   * a[i] 房主交给模拟的第 i 个人最新的操作序号（其他人据此校正自己预走的位置）；p[i] 第 i 个人此刻的位置（[x, y]，没取整）。
   * 没有变化时 d 省略。
   */
  | { t: 'st'; k: number; n?: number; b?: number; r?: number; f?: 1; d?: PlainObj; e?: StampedEvent[]; a: number[]; p: [number, number][] }
  /** 事件使用可靠通道，序号防止重连、传输切换时重复播放。 */
  | { t: 'ev'; r: number; q: number; k: number; e: StampedEvent[] }
  /** 每一波开打时的整局存档（sim/snapshot.ts，逐位精确；迁移房主时，新房主从这里重开这一波）。 */
  | { t: 'save'; wave: number; data: WorldSnapshot; slots: Slot[]; seed: number }
  /** 人物分配变了（有人中途加入）：名字签跟着变。 */
  | { t: 'slots'; slots: Slot[] }
  /** 房主暂停 / 继续（切到后台、打开暂停面板）。 */
  | { t: 'pause'; on: boolean; why: 'menu' | 'hidden' }
  | { t: 'pong'; c: number }
  /** 这一局正在打、现在进不来：等商店（中途加入只能在商店阶段）或这一局结束。 */
  | { t: 'wait'; why: 'battle' | 'full' }
  /** 房主回到标题了：这一局结束，大家回到大厅。 */
  | { t: 'end' };

export type GuestMsg =
  /** 操作（约 30 次 / 秒）：s 序号；x / y 摇杆方向（-1..1）；k 一共按过几次神通（数字涨了就是又按了一次，丢包也不会漏）。 */
  | { t: 'in'; r?: number; s: number; x: number; y: number; k: number; ack?: number }
  /** 商店指令（player 字段房主会改成发的人自己的位置，不信客户端填的）。 */
  | { t: 'cmd'; r?: number; c: Command }
  | { t: 'ping'; c: number; ack?: number }
  /** 要一份整的状态（刚进来、重连、出错时）。 */
  | { t: 'sync'; r?: number }
  /** 陨落之后按了「再战」。 */
  | { t: 'again' }
  /** 刚进房（在大厅里）：这一局已经在打的话，原来就在这一局里的直接接回去，新来的等到商店。 */
  | { t: 'hello' };

/** 解析一条游戏消息（坏的返回 null）。 */
export function parseMsg<T extends { t: string }>(text: string): T | null {
  try {
    const m = JSON.parse(text) as T;
    return m && typeof m === 'object' && typeof m.t === 'string' ? m : null;
  } catch {
    return null;
  }
}
