// 联机：和中继之间的一条连接（WebSocket）。管：建房 / 进房 / 离开、名单、断线重连（带着凭据回到原来的位置）、
// 心跳与掉线检测、到中继的往返延迟。游戏消息（房主 ↔ 其他人）原样收发，不在这里解析。
//
// 用法：
//   const link = new Link(relayUrl());
//   await link.create('哪吒', { hero: 'nezha' });          // 或 await link.join('ABCD', ...)
//   link.on('roster', (members, host) => …);
//   link.on('data', (from, text) => …);                     // 房主收到其他人的；其他人收到房主的
//   link.send(text);                                        // 房主：发给其他所有人；其他人：发给房主
//   link.send(text, id);                                    // 房主点名发给一个人
// 断线后自己重连；重连上了重新进房（同一个编号），期间 state 是 'lost'。房间没了（比如大家都走了）发 'gone'。
// 不依赖页面（Node 里也能跑，测试用）；页面相关的（切回前台立刻查一下连接）有 document 才挂。
import type { Member, MemberMeta, RelayIn, RelayOut } from './protocol.ts';
import { DirectPeers } from './direct.ts';

export type LinkState = 'idle' | 'connecting' | 'open' | 'lost' | 'closed';

export interface LinkEvents {
  /** 名单变了（有人进、出、掉线、重连、改了附加信息，房主换了）。 */
  roster: (members: Member[], host: number) => void;
  /** 收到游戏消息：from 是发的人的编号。 */
  data: (from: number, text: string) => void;
  /** 房主换了（迁移）；id === prev 是原来的房主回来了。 */
  host: (id: number, prev: number, why: string) => void;
  /** 房主掉线了，中继等 wait 毫秒再迁。 */
  hostAway: (id: number, wait: number) => void;
  state: (s: LinkState) => void;
  /** 回不去了（重连时房间已经没了）。 */
  gone: (why: string) => void;
  /** 中继说的错误（发得太快之类）。 */
  error: (code: string, msg: string) => void;
  transport: () => void;
}

const HB_MS = 2000;
const SILENCE_MS = 6500;

export class Link {
  readonly url: string;
  state: LinkState = 'idle';
  room = '';
  me = 0;
  host = 0;
  members: Member[] = [];
  token = '';
  name = '';
  meta: MemberMeta = {};
  /** 到中继的往返延迟（毫秒，平滑过的）。 */
  rtt = 0;
  private ws: WebSocket | null = null;
  private direct: DirectPeers | null = null;
  private directConfiguration = 0;
  get directMode() { return this.members.find(m => m.id === this.host)?.meta.rtc === 1; }
  get autoDirect() { return this.members.find(m => m.id === this.host)?.meta.rtc === 2; }
  get dataTransport() {
    if (!this.direct || (!this.directMode && !this.autoDirect)) return 'relay';
    let peers = 0, ready = 0;
    for (const m of this.members) if (m.on && (this.me === this.host ? m.id !== this.me : m.id === this.host)) {
      peers++; if (this.direct.peerReady(m.id)) ready++;
    }
    return peers && ready === peers ? 'rtc' : ready ? 'mixed' : 'relay';
  }
  skippedStates = 0;
  get directReady() { return !this.directMode || !!this.direct?.ready; }
  get directDiagnostics() { return this.direct?.diagnostics() ?? []; }
  private updateDirect() {
    if (!this.directMode && !this.autoDirect) {
      this.direct?.close(); this.direct = null;
      if (this.meta.rtc && this.room && this.me !== this.host) {
        const next = { ...this.meta }; delete next.rtc;
        this.meta = next; this.ctl({ t: 'meta', meta: next });
      }
      return;
    }
    if (typeof RTCPeerConnection === 'undefined') {
      if (this.directMode) this.emit('error', 'direct', '当前浏览器无法使用局域网直连，请换用新版浏览器');
      return;
    }
    const mode = this.directMode ? 1 : 2;
    if (this.direct && this.directConfiguration !== mode) { this.direct.close(); this.direct = null; }
    this.directConfiguration = mode;
    if (this.meta.rtc !== mode) {
      this.meta = { ...this.meta, rtc: mode };
      this.ctl({ t: 'meta', meta: this.meta });
    }
    this.direct ??= new DirectPeers(
      (id, text) => this.relaySend(text, id),
      (id, text) => {
        if (text === '{"t":"rtc-ready"}') { if (this.directMode) this.direct?.send('{"t":"hello"}'); }
        else this.emit('data', id, text);
      },
      () => this.emit('transport'),
      msg => { if (this.directMode) this.emit('error', 'direct', msg); },
      this.autoDirect ? publicIceServers() : [],
    );
    this.direct.update(this.me, this.host, this.members);
  }
  private handlers = new Map<keyof LinkEvents, Set<(...a: never[]) => void>>();
  private waiting: { resolve: () => void; reject: (e: Error) => void } | null = null;
  private hb: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retries = 0;
  private lastSeen = 0;
  /** 把现在这条连接当作断了（心跳超时）：走一遍断线的处理、关掉它，然后重连。 */
  private down: (() => void) | null = null;
  private closed = false;
  private hiddenAt = 0;
  private onVisible = () => {
    if (typeof document !== 'undefined' && document.hidden) {
      this.hiddenAt = performance.now();
      return;
    }
    // 切回前台：在后台待了好几秒的，连接多半已经死了（手机切后台时 JS 停了，中继早把他判掉线了），直接重连；
    // 只离开了一会儿的先 ping 一下（真断了，心跳超时会接着处理）
    const away = this.hiddenAt ? performance.now() - this.hiddenAt : 0;
    this.hiddenAt = 0;
    if (!this.ws || this.ws.readyState > 1) this.reconnectSoon(0);
    else if (away > 4000 && this.room) this.down?.();
    else this.ping();
  };

  constructor(url: string) {
    this.url = url;
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisible);
  }

  on<K extends keyof LinkEvents>(ev: K, fn: LinkEvents[K]): () => void {
    let set = this.handlers.get(ev);
    if (!set) this.handlers.set(ev, (set = new Set()));
    const f = fn as (...a: never[]) => void;
    set.add(f);
    return () => set.delete(f);
  }

  private emit<K extends keyof LinkEvents>(ev: K, ...args: Parameters<LinkEvents[K]>) {
    for (const fn of this.handlers.get(ev) ?? []) {
      try {
        (fn as unknown as (...a: Parameters<LinkEvents[K]>) => void)(...args);
      } catch (e) {
        console.error(`[net] ${ev} 处理出错`, e);
      }
    }
  }

  private setState(s: LinkState) {
    if (s === this.state) return;
    this.state = s;
    this.emit('state', s);
  }

  get isHost() {
    return this.me !== 0 && this.me === this.host;
  }

  /** 建房：成为房主。连不上、中继拒绝时抛错（错误信息是给人看的中文）。 */
  async create(name: string, meta: MemberMeta) {
    this.name = name;
    this.meta = meta;
    await this.open();
    await this.request({ t: 'create', name, meta });
  }

  /** 进房：token 是上次在这个房间里的凭据（刷新页面回到原来的位置）。 */
  async join(room: string, name: string, meta: MemberMeta, token?: string) {
    this.name = name;
    this.meta = meta;
    await this.open();
    await this.request({ t: 'join', room: room.toUpperCase(), name, meta, token });
  }

  setMeta(meta: MemberMeta, name?: string) {
    this.meta = meta;
    if (name) this.name = name;
    this.ctl({ t: 'meta', meta, name });
  }

  /** 发游戏消息：房主不给 to = 发给其他所有人；其他人一律发给房主。 */
  send(text: string, to?: number, transient = false) {
    if (this.directMode) { this.direct?.send(text, to, transient); return; }
    if (transient && this.autoDirect && this.direct) {
      const targets = this.me === this.host ? this.members.filter(m => m.on && m.id !== this.me).map(m => m.id) : [this.host];
      const ids = to === undefined ? targets : targets.filter(id => id === to);
      let needsRelay = false;
      for (const id of ids) {
        if (this.direct.peerReady(id)) this.direct.send(text, id, true);
        else needsRelay = true;
      }
      // 混合连接仍只上传一份。直连端可能收到重复快照，由传输序号去重。
      if (!needsRelay) return;
    }
    this.relaySend(text, to, transient);
  }
  private relaySend(text: string, to?: number, transient = false) {
    if (this.ws?.readyState !== 1 || !this.room) return;
    // 状态可跳过，不在浏览器发送队列里堆积；可靠事件和商店指令不丢。
    if (transient && this.ws.bufferedAmount > 65536) { this.skippedStates++; return; }
    this.ws.send(`>${to ?? ''}|${text}`);
  }

  /** 房主让位（切到后台太久）。 */
  abdicate() {
    this.ctl({ t: 'abdicate' });
  }

  /** 离开房间（连接留着可以再建 / 进别的房）。 */
  leave() {
    this.direct?.close(); this.direct = null;
    this.ctl({ t: 'leave' });
    this.room = '';
    this.me = this.host = 0;
    this.members = [];
    this.token = '';
  }

  /** 离开并断开，不再重连。 */
  close() {
    if (this.closed) return;
    if (this.room) this.leave();
    this.direct?.close(); this.direct = null;
    this.closed = true;
    this.stopTimers();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisible);
    const ws = this.ws;
    this.ws = null;
    // 等「离开」发出去再关
    if (ws) setTimeout(() => ws.close(1000), 30);
    this.setState('closed');
  }

  // ---------- 内部 ----------

  private ctl(m: RelayIn) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m));
  }

  private ping() {
    this.ctl({ t: 'hb', c: Math.round(performance.now()) });
  }

  private request(m: RelayIn): Promise<void> {
    return new Promise((resolve, reject) => {
      this.waiting?.reject(new Error('被新的请求顶掉了'));
      const timer = setTimeout(() => {
        if (this.waiting === w) {
          this.waiting = null;
          reject(new Error('中继没有回应'));
        }
      }, 5000);
      const w = {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (e: Error) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      this.waiting = w;
      this.ctl(m);
    });
  }

  /** 连上中继（已经连着就直接返回）。 */
  private open(): Promise<void> {
    if (this.ws?.readyState === 1) return Promise.resolve();
    this.closed = false;
    return new Promise((resolve, reject) => {
      let settled = false;
      this.connect(
        () => {
          settled = true;
          resolve();
        },
        () => {
          if (settled) return;
          settled = true;
          // 公网（反向代理后面的 …/relay）给玩家看的话；局域网开发（:5300）提醒开中继
          reject(new Error(/\/relay\/?$/.test(this.url) ? '连不上联机：网络不通，或者正在维护，过一会儿再试' : `连不上中继（${this.url}）。中继开着吗？电脑上要先跑 npm run relay`));
        },
      );
    });
  }

  private connect(onOpen?: () => void, onFail?: () => void) {
    this.setState(this.room ? 'lost' : 'connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      onFail?.();
      this.reconnectSoon();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.retries = 0;
      this.lastSeen = performance.now();
      this.startTimers();
      if (this.room) {
        // 重连：带着凭据回到原来的位置
        this.ctl({ t: 'join', room: this.room, name: this.name, meta: this.meta, token: this.token });
      } else this.setState('open');
      onOpen?.();
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      this.lastSeen = performance.now();
      const s = typeof e.data === 'string' ? e.data : '';
      if (s[0] === '<') {
        const bar = s.indexOf('|');
        if (bar > 0) {
          const from = Number(s.slice(1, bar)), text = s.slice(bar + 1);
          if (text.startsWith('{"t":"rtc",')) { if (this.direct) void this.direct.accept(from, text); }
          else if (!this.directMode) this.emit('data', from, text);
        }
        return;
      }
      let m: RelayOut;
      try {
        m = JSON.parse(s) as RelayOut;
      } catch {
        return;
      }
      this.onCtl(m);
    };
    const down = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopTimers();
      onFail?.();
      if (this.closed) return;
      if (this.waiting && !this.room) {
        this.waiting.reject(new Error('和中继的连接断了'));
        this.waiting = null;
      }
      this.setState(this.room ? 'lost' : 'idle');
      if (this.room) this.reconnectSoon();
    };
    ws.onclose = down;
    this.down = () => {
      down();
      try {
        ws.close();
      } catch {
        /* 已经关了 */
      }
    };
    ws.onerror = () => {
      /* onclose 会接着来 */
    };
  }

  private onCtl(m: RelayOut) {
    switch (m.t) {
      case 'joined': {
        const prevHost = this.host;
        this.room = m.room;
        this.me = m.you;
        this.token = m.token;
        this.host = m.host;
        this.members = m.members;
        this.updateDirect();
        this.setState('open');
        this.waiting?.resolve();
        this.waiting = null;
        this.emit('roster', this.members, this.host);
        // 重连回来发现房主换了（断线期间迁移了，「换房主」那一条没收到）：补发一条
        if (prevHost && prevHost !== m.host) this.emit('host', m.host, prevHost, '重连时房主已经换了');
        break;
      }
      case 'room':
        this.host = m.host;
        this.members = m.members;
        this.updateDirect();
        this.emit('roster', this.members, this.host);
        break;
      case 'host':
        this.host = m.id;
        this.updateDirect();
        this.emit('host', m.id, m.prev, m.why);
        break;
      case 'hostAway':
        this.emit('hostAway', m.id, m.wait);
        break;
      case 'hb': {
        const r = performance.now() - m.c;
        if (m.c > 0 && r >= 0 && r < 10000) this.rtt = this.rtt ? this.rtt * 0.7 + r * 0.3 : r;
        break;
      }
      case 'err':
        if (this.waiting) {
          this.waiting.reject(new Error(m.code === 'no_room' ? '没有这个房间（房间码对吗？房主还在吗？）' : m.msg || '联机暂不可用，请稍后重试'));
          this.waiting = null;
        } else if (m.code === 'no_room' && this.room) {
          // 重连时房间已经没了
          const room = this.room;
          this.room = '';
          this.emit('gone', `房间 ${room} 已经没了`);
        }
        this.emit('error', m.code, m.msg);
        break;
      case 'bye': {
        // 中继要关了（更新、重启）：房间在它的内存里，重启后就没了——不再重连回这个房，直接告诉上面「房间没了」。
        // 连接留着给之后建房 / 进房用（中继回来以后 create / join 照常会重新连）
        const msg = m.msg || '联机在更新，这一局断开了：过一会儿重新建房'; // 和 server/relay.mjs 的 BYE_MSG 一样（字也要在字体子集里）
        if (this.waiting) {
          this.waiting.reject(new Error(msg));
          this.waiting = null;
        }
        if (this.room) {
          this.room = '';
          this.emit('gone', msg);
        }
        break;
      }
    }
  }

  private startTimers() {
    this.stopTimers();
    this.ping();
    this.hb = setInterval(() => {
      if (performance.now() - this.lastSeen > SILENCE_MS) {
        // 中继那边好久没动静：当作断了，关掉重连（onclose 里接着走）
        this.down?.();
        return;
      }
      this.ping();
    }, HB_MS);
  }

  private stopTimers() {
    if (this.hb) clearInterval(this.hb);
    this.hb = null;
  }

  private reconnectSoon(ms?: number) {
    if (this.closed || this.retryTimer) return;
    const wait = ms ?? Math.min(4000, 400 * 2 ** this.retries++);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.closed || (this.ws && this.ws.readyState <= 1)) return;
      this.connect();
    }, wait);
  }
}

/** relayUrl 要看的页面地址（location 的这几项；测试里传假的）。 */
export interface PageLoc {
  protocol: string;
  hostname: string;
  host: string;
  port: string;
}

/**
 * 中继的地址：
 * - 构建参数 VITE_RELAY_URL 指定独立中继；网址参数 ?relay= 优先：写完整地址（ws://…、wss://…）或者「主机:端口」。
 * - 上公网（docs/deploy.md）：页面是 https，或者是 http 但用默认端口（80）打开的——中继在反向代理后面、同一个域名的 /relay 下：
 *   https://fs.example.com/ → wss://fs.example.com/relay（deploy/ 里的 nginx、Caddy 配置把 /relay 转给中继）。
 * - 局域网开发（页面在开发服务器的端口上，http://192.168.1.23:5180/）：「打开页面的这台机器的 5300 端口」——
 *   电脑开中继，手机用电脑的地址打开页面，就自然连到电脑上。
 */
export function relayUrl(search = typeof location !== 'undefined' ? location.search : '', loc: PageLoc | undefined = typeof location !== 'undefined' ? location : undefined, configured = import.meta.env?.VITE_RELAY_URL): string {
  const p = new URLSearchParams(search).get('relay');
  const secure = loc?.protocol === 'https:';
  const selected = p || configured?.trim();
  if (selected) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(selected) && !/^wss?:\/\//.test(selected)) {
      throw new Error('中继地址格式不正确，请使用 ws:// 或 wss://');
    }
    const address = /^wss?:\/\//.test(selected) ? selected : `${secure ? 'wss' : 'ws'}://${selected}`;
    const url = new URL(address);
    if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash) {
      throw new Error('中继地址格式不正确');
    }
    if (secure && url.protocol !== 'wss:') throw new Error('HTTPS 页面需要使用 wss:// 中继');
    return address;
  }
  if (loc?.hostname && (secure || loc.port === '')) return `${secure ? 'wss' : 'ws'}://${loc.host}/relay`;
  const host = loc?.hostname ? loc.hostname : '127.0.0.1';
  return `ws://${host.includes(':') ? `[${host}]` : host}:5300`;
}

/** 中继的 http 地址（/health、/info）：ws://主机:5300 → http://主机:5300，wss://域名/relay → https://域名/relay。 */
export const relayHttp = (ws: string) => ws.replace(/^ws/, 'http');

/** 可选公网 STUN 只协助发现地址；失败时继续中继，不需要部署 TURN。 */
function publicIceServers(): RTCIceServer[] {
  const configured: string | undefined = import.meta.env?.VITE_STUN_URLS;
  const urls = (configured ?? 'stun:stun.cloudflare.com:3478,stun:stun.l.google.com:19302').split(',').map(x => x.trim()).filter(x => /^stun:[a-z0-9.-]+:\d+$/.test(x));
  return urls.length ? [{ urls }] : [];
}
