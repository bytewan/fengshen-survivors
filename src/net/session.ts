// 联机的一局（大厅里房主按了「开始」之后，到回到标题为止）：一条和中继的连接 + 这一局的人物分配 + 自己现在是房主还是其他人。
// 大厅（lobby.ts）建好它交给游戏（feel.ts）；feel.ts 按 role 走房主的主循环或镜像的主循环，房主迁移时 role 会变。
import type { World } from '../sim/world.ts';
import { GuestSide } from './guest.ts';
import { HostSide } from './host.ts';
import type { Link } from './link.ts';
import { Mirror } from './mirror.ts';
import type { HostMsg, Member, Slot } from './protocol.ts';

export type Role = 'host' | 'guest';

export class NetSession {
  readonly link: Link;
  /** 第 i 个人物是谁（players[i]）。 */
  slots: Slot[];
  seed: number;
  /** 这一局的劫数（房主开房时选的，开局消息带过来；sim/jie.ts）。 */
  jie: number | undefined;
  host: HostSide | null = null;
  guest: GuestSide | null = null;
  /** 房主掉线了、中继在等：到这个时刻（performance.now()）还没回来就迁。 */
  hostAwayUntil = 0;
  /** 回不去了（房间没了）：显示给玩家的原因。 */
  gone = '';
  /** 房主换人了：新房主是不是自己（feel.ts 每帧看一眼，接手 / 等新房主的整份状态）。 */
  onHostChange: ((meNow: boolean) => void) | null = null;
  private off: (() => void)[] = [];

  constructor(link: Link, start: Extract<HostMsg, { t: 'start' }>) {
    this.link = link;
    this.slots = start.slots;
    this.seed = start.seed;
    this.jie = start.jie;
    this.off.push(
      link.on('host', (id, prev) => {
        this.hostAwayUntil = 0;
        if (id !== prev) this.onHostChange?.(id === link.me);
      }),
      link.on('hostAway', (_id, wait) => (this.hostAwayUntil = performance.now() + wait)),
      link.on('gone', (why) => (this.gone = why)),
    );
  }

  get role(): Role {
    return this.link.isHost ? 'host' : 'guest';
  }

  /** 自己是第几个人物（不在这一局里返回 -1：中途进来的人在商店阶段才加进来）。 */
  get me(): number {
    return this.slots.findIndex((s) => s.id === this.link.me);
  }

  names(): string[] {
    return this.slots.map((s) => s.name);
  }

  /** 第 i 个人物的人现在连着没有。 */
  online(i: number): boolean {
    const s = this.slots[i];
    return !!s && this.link.members.some((m: Member) => m.id === s.id && m.on);
  }

  /** 当房主：建房主这边（开局、迁移接手）。 */
  asHost(): HostSide {
    this.guest?.dispose();
    this.guest = null;
    if (!this.host) this.host = new HostSide(this.link, this.slots, this.me);
    this.host.slots = this.slots;
    this.host.me = this.me;
    this.host.seed = this.seed;
    return this.host;
  }

  /** 当其他人：placeholder 是第一份整的状态到之前先画的开局样子。 */
  asGuest(placeholder: World): GuestSide {
    this.host?.dispose();
    this.host = null;
    if (!this.guest) this.guest = new GuestSide(this.link, new Mirror(placeholder, this.me));
    this.guest.beginRun(this.seed);
    return this.guest;
  }

  dispose() {
    for (const f of this.off) f();
    this.off = [];
    this.host?.dispose();
    this.guest?.dispose();
    this.host = this.guest = null;
    this.link.close();
  }
}
