// 联机中继（Node + ws）：只转发，不跑游戏、不存任何用户数据、不解析游戏内容。
//
// 架构见 docs/netcode.md：房主权威——全部模拟在房主的浏览器里跑，中继只把房主的状态转给其他人、把其他人的操作转给房主。
// 中继自己只管三件事：房间（房间码、名单、谁是房主）、转发、心跳与掉线（含房主掉线后按进房顺序指定下一个房主）。
//
// 线上格式（WebSocket 文本帧）：
//   控制帧是 JSON 对象（以 { 开头），见下面 handle() 里的 case；
//   数据帧不解析，原样转发：客户端发 `>目标|内容`（目标为空 = 房主发给其他所有人 / 其他人发给房主；数字 = 房主发给那一个人），
//   中继发出去的是 `<来源|内容`。内容是什么中继不管（游戏协议在 src/net/protocol.ts）。
//
// 启动：npm run relay（局域网开发：端口 5300，监听 0.0.0.0）。上公网放在反向代理后面（docs/deploy.md、deploy/）：
//   页面是 https://域名/ 时，客户端连 wss://域名/relay（src/net/link.ts 的 relayUrl），反向代理把 /relay 原样转过来。
// 环境变量（都可以不设；表格和推荐值见 docs/deploy.md「中继」）：
//   RELAY_PORT、RELAY_HOST                    监听的端口、地址（默认 5300、0.0.0.0）
//   RELAY_ORIGINS                              允许哪些网页来连（逗号分隔，如 https://fs.example.com）；不设 = 不限（局域网开发）
//   RELAY_MAX_ROOMS、RELAY_MAX_CONNS、RELAY_MAX_CONNS_PER_IP   房间数、总连接数、每个 IP 的连接数上限
//   RELAY_TRUST_PROXY=1                        在反向代理后面：按代理加的 X-Forwarded-For（最右一个）/ X-Real-IP 认来访的 IP
//   RELAY_BASE                                 路径前缀（默认 /relay；/relay/health 和 /health 都认）
//   RELAY_LAN=0                                公网上关掉局域网的方便：/info 不报本机地址、/stats 不列房间码（否则谁都能看到房间码进房）
//   RELAY_LOG=json                             日志一行一个 JSON（默认一行「时间 事件 键=值…」）
//   RELAY_SHUTDOWN_MS                          收到 SIGTERM 后先通知房间里的人，等多久再关连接（默认 1500）
//   RELAY_SILENCE_MS、RELAY_HOST_GRACE_MS      测试用：多久没动静算掉线、房主掉线后等多久再迁
// HTTP：GET /health（ok；正在关的时候 503）、/info（大厅拼分享链接用的局域网地址）、/stats（各房间实际流量）。
// 日志一行一个事件，只有房间码、编号、人数、原因这些中继自己产生的东西——不记名号、附加信息、游戏内容，也不记 IP。
import http from 'node:http';
import os from 'node:os';
import { randomBytes, randomInt } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';

/** 房间码的字符：去掉容易看混的 0 / O、1 / I / L。 */
export const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_RE = new RegExp(`^[${CODE_CHARS}]{4}$`);

export const DEFAULTS = {
  maxMembers: 4,
  maxRooms: 500,
  maxConns: 2000,
  maxConnsPerIp: 24,
  /** 心跳：客户端约 2 秒发一次；这么久什么都没收到就算掉线。 */
  silenceMs: 6000,
  /** 房主掉线（不是自己退出）之后等多久再把房主迁给下一个人（设计文档：全房暂停最多约 30 秒，含掉线检测的 6 秒）。 */
  hostGraceMs: 24000,
  /** 房里一个连着的人都没有了：这么久之后删房（期间有人重连回来就不删）。 */
  roomIdleMs: 60000,
  /** 掉线的人的位置保留多久（超过就从名单上去掉，腾出位置）。 */
  memberKeepMs: 10 * 60000,
  /** 一帧最大字节数：房主发的整局快照可能几十 KB；其他人只发操作，限得紧。 */
  maxFrame: 1 << 20,
  maxGuestFrame: 16 << 10,
  /** 频率限制（令牌桶）：其他人每秒约 30 次操作 + 零星指令；房主每秒约 15 次状态 × 人数 + 心跳。 */
  guestRate: 80,
  guestBurst: 160,
  hostRate: 300,
  hostBurst: 600,
  maxName: 12,
  maxMeta: 300,
  /** 允许的来源（网页的 origin，如 'https://fs.example.com'）；空 = 不限。 */
  origins: [],
  /** 在反向代理后面：来访的 IP 按代理加的头算（不在代理后面时别开，不然谁都能伪造 IP 绕过每个 IP 的连接上限）。 */
  trustProxy: false,
  /** 路径前缀：反向代理把 https://域名/relay/... 原样转过来。不带前缀的也认（局域网里直接连 :5300）。 */
  base: '/relay',
  /** 局域网的方便：/info 报本机的局域网地址、/stats 列出各房间（带房间码）。公网上关掉。 */
  lan: true,
  /** 收到 SIGTERM（shutdown）后：先发「中继要关了」，等这么久再关连接。 */
  shutdownMs: 1500,
};

/** 中继要关（更新、重启）时发给每个人的话：房间都在中继的内存里，重启之后就没了。 */
export const BYE_MSG = '联机在更新，这一局断开了：过一会儿重新建房';

const now = () => Date.now();
/** 定时器不拖住进程（测试里关掉中继之后进程能马上退出）。 */
const later = (fn, ms) => {
  const h = setTimeout(fn, ms);
  h.unref?.();
  return h;
};

/** 名字：去掉控制字符和首尾空白，最多 maxName 个字（按码位算）。 */
export function cleanName(v, max = DEFAULTS.maxName) {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '').trim(); // 控制字符、零宽字符、方向控制符
  return [...s].slice(0, max).join('');
}

/** 各人自己的附加信息（选的角色、准备了没有）：只要是小于 maxMeta 字节的 JSON 对象就原样存着、原样发给房里的人。 */
function cleanMeta(v, max = DEFAULTS.maxMeta) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const s = JSON.stringify(v);
  return s.length <= max ? JSON.parse(s) : null;
}

/** 来源写法统一：'https://FS.example.com/' → 'https://fs.example.com'（默认端口去掉）。写错了返回 null。 */
export function normOrigin(v) {
  if (typeof v !== 'string' || !v.trim()) return null;
  if (v.trim() === '*') return '*';
  try {
    const u = new URL(v.trim());
    return u.origin === 'null' ? null : u.origin;
  } catch {
    return null;
  }
}

/** 日志：一行一个事件。text = `时间 事件 键=值 …`（值里有空格、引号的加引号），json = 一行一个 JSON 对象。 */
export function makeLogger(format = 'text', write = (line) => console.log(line)) {
  const val = (v) => {
    const s = String(v);
    return /^[^\s"=]+$/.test(s) ? s : JSON.stringify(s);
  };
  return (ev, fields = {}) => {
    const time = new Date().toISOString();
    if (format === 'json') write(JSON.stringify({ time, ev, ...fields }));
    else write([time, ev, ...Object.entries(fields).map(([k, v]) => `${k}=${val(v)}`)].join(' '));
  };
}

/**
 * 从环境变量读配置（npm run relay、Docker 里用）。没设的不出现（用 DEFAULTS），写错了抛错（起不来，比悄悄用默认值好）。
 */
export function configFromEnv(env = process.env) {
  const has = (k) => env[k] !== undefined && env[k] !== '';
  const int = (k, min) => {
    if (!has(k)) return undefined;
    const n = Number(env[k]);
    if (!Number.isInteger(n) || n < min) throw new Error(`环境变量 ${k}=${env[k]} 不对：要不小于 ${min} 的整数`);
    return n;
  };
  const flag = (k) => {
    if (!has(k)) return undefined;
    if (/^(1|true|yes|on)$/i.test(env[k])) return true;
    if (/^(0|false|no|off)$/i.test(env[k])) return false;
    throw new Error(`环境变量 ${k}=${env[k]} 不对：要 1 / 0`);
  };
  const out = {
    port: int('RELAY_PORT', 0),
    host: has('RELAY_HOST') ? env.RELAY_HOST : undefined,
    maxRooms: int('RELAY_MAX_ROOMS', 1),
    maxConns: int('RELAY_MAX_CONNS', 1),
    maxConnsPerIp: int('RELAY_MAX_CONNS_PER_IP', 1),
    trustProxy: flag('RELAY_TRUST_PROXY'),
    lan: flag('RELAY_LAN'),
    shutdownMs: int('RELAY_SHUTDOWN_MS', 0),
    silenceMs: int('RELAY_SILENCE_MS', 100),
    hostGraceMs: int('RELAY_HOST_GRACE_MS', 0),
  };
  if (has('RELAY_ORIGINS')) {
    const list = env.RELAY_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
    const bad = list.filter((s) => !normOrigin(s));
    if (bad.length) throw new Error(`环境变量 RELAY_ORIGINS 里这几个不是网址：${bad.join(', ')}（要写成 https://域名）`);
    out.origins = list.map(normOrigin);
  }
  if (env.RELAY_BASE !== undefined) {
    const b = env.RELAY_BASE.trim().replace(/\/+$/, '');
    if (b && !/^\/[\w\-/.]*$/.test(b)) throw new Error(`环境变量 RELAY_BASE=${env.RELAY_BASE} 不对：要以 / 开头，比如 /relay`);
    out.base = b;
  }
  if (has('RELAY_LOG')) {
    if (!['text', 'json'].includes(env.RELAY_LOG)) throw new Error(`环境变量 RELAY_LOG=${env.RELAY_LOG} 不对：text 或 json`);
    out.logFormat = env.RELAY_LOG;
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}

/**
 * 起一个中继。返回 { server, port, close, shutdown, rooms }（rooms 只给测试看）。
 * opts：port（0 = 随便挑一个空闲端口）、host、log（函数 (事件, 字段) => void，默认按 logFormat 打到控制台）、以及 DEFAULTS 里的任何一项。
 * close()：马上关（测试用）；shutdown()：先告诉房间里的人「中继要关了」、等 shutdownMs，再关（收到 SIGTERM 时用）。
 */
export function startRelay(opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const log = opts.log ?? makeLogger(opts.logFormat);
  const origins = new Set((cfg.origins ?? []).map(normOrigin).filter(Boolean));
  const anyOrigin = origins.size === 0 || origins.has('*');
  const base = (cfg.base ?? '').replace(/\/+$/, '');
  /** @type {Map<string, Room>} */
  const rooms = new Map();
  const conns = new Set();
  const perIp = new Map();
  let draining = false;

  /** 来访的 IP：在反向代理后面时取代理加的头（X-Forwarded-For 最右一个是代理自己看到的来源，前面的可能是客户端伪造的）。 */
  function clientIp(req) {
    if (cfg.trustProxy) {
      const xff = req.headers['x-forwarded-for'];
      const last = typeof xff === 'string' ? xff.split(',').pop().trim() : '';
      if (last) return last;
      const real = req.headers['x-real-ip'];
      if (typeof real === 'string' && real.trim()) return real.trim();
    }
    return req.socket.remoteAddress ?? '?';
  }
  const originOk = (o) => anyOrigin || (typeof o === 'string' && origins.has(normOrigin(o)));
  /** 去掉路径前缀和查询串：/relay/info?x → /info。 */
  const route = (url) => {
    const p = (url ?? '/').split('?')[0];
    if (base && (p === base || p.startsWith(base + '/'))) return p.slice(base.length) || '/';
    return p;
  };

  const server = http.createServer((req, res) => {
    const url = route(req.url);
    // 跨域：局域网开发时页面在开发服务器的端口上、中继在 5300，大厅要跨域读 /info；公网上只给允许的来源
    const origin = req.headers.origin;
    const cors = { 'cache-control': 'no-store', vary: 'Origin' };
    if (anyOrigin) cors['access-control-allow-origin'] = '*';
    else if (originOk(origin)) cors['access-control-allow-origin'] = normOrigin(origin);
    if (url === '/health') {
      res.writeHead(draining ? 503 : 200, { ...cors, 'content-type': 'text/plain' });
      res.end(draining ? 'draining' : 'ok');
    } else if (url === '/info') {
      res.writeHead(200, { ...cors, 'content-type': 'application/json' });
      res.end(JSON.stringify({ lan: cfg.lan ? lanAddresses() : [], rooms: rooms.size, max: cfg.maxMembers }));
    } else if (url === '/stats') {
      // 每个房间实际走了多少字节（TCP 层的计数，压缩之后、含帧头）：最近几秒的平均。只有数字，没有内容。
      // 公网上（lan 关掉）只给合计：房间码是进房的唯一凭据，列出来谁都能进别人的房
      const list = [...rooms.values()].map((r) => ({ room: r.code, members: r.members.length, online: r.members.filter((m) => m.sock).length, inKBs: +((r.rate?.in ?? 0) / 1024).toFixed(1), outKBs: +((r.rate?.out ?? 0) / 1024).toFixed(1) }));
      const total = { rooms: list.length, members: 0, online: 0, conns: conns.size, inKBs: 0, outKBs: 0 };
      for (const r of list) {
        total.members += r.members;
        total.online += r.online;
        total.inKBs += r.inKBs;
        total.outKBs += r.outKBs;
      }
      total.inKBs = +total.inKBs.toFixed(1);
      total.outKBs = +total.outKBs.toFixed(1);
      res.writeHead(200, { ...cors, 'content-type': 'application/json' });
      res.end(JSON.stringify({ rooms: cfg.lan ? list : [], total }));
    } else {
      res.writeHead(404, { ...cors, 'content-type': 'text/plain' });
      res.end('not found');
    }
  });
  // 压缩（permessage-deflate，浏览器都支持，自动协商）：状态是很啰嗦的 JSON，压缩后只剩三成左右（docs/netcode.md「带宽」）。
  // 小帧（操作、心跳）不压。deflate: false 可以关掉（测试里比对用）
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: cfg.maxFrame,
    perMessageDeflate: cfg.deflate === false ? false : { zlibDeflateOptions: { level: 3, memLevel: 7 }, threshold: 256 },
  });
  /** 升级成 WebSocket 之前先查来源、是不是正在关：不让的直接回 HTTP 错误，连握手都不做。 */
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    const refuse = (status, text, reason, extra = {}) => {
      log('reject', { reason, ...extra });
      socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    };
    if (draining) return refuse(503, 'Service Unavailable', 'draining');
    const origin = req.headers.origin;
    if (!originOk(origin)) return refuse(403, 'Forbidden', 'origin', { origin: typeof origin === 'string' ? origin.slice(0, 80) : 'none' });
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  // ---------- 房间 ----------
  /**
   * @typedef {{ id: number, order: number, name: string, meta: object, token: string, sock: Conn | null, lost: number }} Member
   * @typedef {{ code: string, members: Member[], host: number, nextId: number, order: number, graceTimer: any, idleTimer: any }} Room
   */
  function newCode() {
    for (let i = 0; i < 200; i++) {
      let c = '';
      for (let k = 0; k < 4; k++) c += CODE_CHARS[randomInt(CODE_CHARS.length)];
      if (!rooms.has(c)) return c;
    }
    return null;
  }
  const memberView = (r, m) => ({ id: m.id, name: m.name, meta: m.meta, on: !!m.sock, order: m.order, host: m.id === r.host });
  function roster(r) {
    return { t: 'room', room: r.code, host: r.host, members: r.members.map((m) => memberView(r, m)) };
  }
  function sendCtl(c, msg) {
    if (c && c.ws.readyState === 1) c.ws.send(JSON.stringify(msg));
  }
  function broadcastCtl(r, msg, except = null) {
    const s = JSON.stringify(msg);
    for (const m of r.members) if (m.sock && m.sock !== except && m.sock.ws.readyState === 1) m.sock.ws.send(s);
  }
  const pushRoster = (r) => broadcastCtl(r, roster(r));

  function deleteRoom(r, why) {
    clearTimeout(r.graceTimer);
    clearTimeout(r.idleTimer);
    for (const m of r.members) if (m.sock) m.sock.member = m.sock.room = null;
    rooms.delete(r.code);
    log('room.delete', { room: r.code, why, rooms: rooms.size });
  }

  /**
   * 把房主换成下一个人：按进房顺序，第一个连着的（不是现在的房主）。
   * why 是发给客户端的话（中文，大厅、局里会显示），code 是日志里的原因。
   */
  function migrate(r, why, code) {
    clearTimeout(r.graceTimer);
    r.graceTimer = null;
    const prev = r.host;
    const next = r.members.filter((m) => m.sock && m.id !== prev).sort((a, b) => a.order - b.order)[0];
    if (!next) {
      log('host.none', { room: r.code, member: prev, why: code });
      return;
    }
    r.host = next.id;
    log('host', { room: r.code, from: prev, to: next.id, why: code });
    broadcastCtl(r, { t: 'host', id: next.id, prev, why });
    pushRoster(r);
  }

  /** 一个人的连接断了（没有说「离开」）：留着位置等他重连；是房主就等一会儿再迁。 */
  function memberLost(c, code) {
    const r = c.room;
    const m = c.member;
    c.room = c.member = null;
    if (!r || !m || m.sock !== c) return;
    m.sock = null;
    m.lost = now();
    const goingAway = code === 1001; // 关页面、刷新：浏览器发 1001，不用等
    log('lost', { room: r.code, member: m.id, code: code ?? 'silence' });
    if (r.members.every((x) => !x.sock)) {
      clearTimeout(r.graceTimer);
      r.graceTimer = null;
      clearTimeout(r.idleTimer);
      r.idleTimer = later(() => deleteRoom(r, 'idle'), cfg.roomIdleMs);
      return;
    }
    if (m.id === r.host) {
      if (goingAway) migrate(r, '房主关了页面', 'closed');
      else {
        log('host.wait', { room: r.code, member: m.id, ms: cfg.hostGraceMs });
        broadcastCtl(r, { t: 'hostAway', id: m.id, wait: cfg.hostGraceMs });
        clearTimeout(r.graceTimer);
        r.graceTimer = later(() => migrate(r, '房主掉线超时', 'timeout'), cfg.hostGraceMs);
      }
    }
    pushRoster(r);
  }

  function memberLeave(c) {
    const r = c.room;
    const m = c.member;
    c.room = c.member = null;
    if (!r || !m) return;
    r.members = r.members.filter((x) => x !== m);
    log('leave', { room: r.code, member: m.id, size: r.members.length });
    if (!r.members.length) return deleteRoom(r, 'empty');
    if (m.id === r.host) migrate(r, '房主离开', 'left');
    if (r.members.every((x) => !x.sock)) {
      clearTimeout(r.idleTimer);
      r.idleTimer = later(() => deleteRoom(r, 'idle'), cfg.roomIdleMs);
    }
    pushRoster(r);
  }

  function attach(c, r, m) {
    if (m.sock && m.sock !== c) {
      // 同一个人重连上来了，旧的连接（多半已经死了）关掉
      const old = m.sock;
      old.room = old.member = null;
      try {
        old.ws.terminate();
      } catch {
        /* 已经关了 */
      }
    }
    m.sock = c;
    m.lost = 0;
    c.room = r;
    c.member = m;
    clearTimeout(r.idleTimer);
    r.idleTimer = null;
    sendCtl(c, { ...roster(r), t: 'joined', you: m.id, token: m.token });
    if (m.id === r.host && r.graceTimer) {
      clearTimeout(r.graceTimer);
      r.graceTimer = null;
      log('host.back', { room: r.code, member: m.id });
      broadcastCtl(r, { t: 'host', id: m.id, prev: m.id, why: '房主回来了' });
    }
    pushRoster(r);
  }

  /** 清掉掉线太久的人（腾位置）。 */
  function prune(r) {
    const t = now();
    const keep = r.members.filter((m) => m.sock || t - m.lost < cfg.memberKeepMs);
    if (keep.length !== r.members.length) r.members = keep;
  }

  // ---------- 一条控制帧 ----------
  function handle(c, msg) {
    switch (msg.t) {
      case 'hb':
        return sendCtl(c, { t: 'hb', c: typeof msg.c === 'number' ? msg.c : 0 });
      case 'create': {
        if (c.room) return sendCtl(c, { t: 'err', code: 'busy', msg: '已经在房间里了' });
        if (rooms.size >= cfg.maxRooms) {
          log('reject', { reason: 'rooms', rooms: rooms.size });
          return sendCtl(c, { t: 'err', code: 'full', msg: '中继的房间满了' });
        }
        const code = newCode();
        if (!code) return sendCtl(c, { t: 'err', code: 'full', msg: '房间码用完了' });
        const meta = cleanMeta(msg.meta, cfg.maxMeta);
        if (meta === null) return sendCtl(c, { t: 'err', code: 'bad', msg: '附加信息太大' });
        /** @type {Room} */
        const r = { code, members: [], host: 1, nextId: 1, order: 0, graceTimer: null, idleTimer: null };
        const m = { id: r.nextId++, order: r.order++, name: cleanName(msg.name, cfg.maxName) || '道友', meta, token: randomBytes(12).toString('hex'), sock: null, lost: 0 };
        r.members.push(m);
        rooms.set(code, r);
        log('create', { room: code, member: m.id, rooms: rooms.size });
        return attach(c, r, m);
      }
      case 'join': {
        if (c.room) return sendCtl(c, { t: 'err', code: 'busy', msg: '已经在房间里了' });
        const code = typeof msg.room === 'string' ? msg.room.toUpperCase() : '';
        if (!CODE_RE.test(code)) return sendCtl(c, { t: 'err', code: 'bad', msg: '房间码不对' });
        const r = rooms.get(code);
        if (!r) return sendCtl(c, { t: 'err', code: 'no_room', msg: '没有这个房间' });
        prune(r);
        // 带着上次的凭据：回到原来的位置（掉线重连、刷新页面）
        const back = typeof msg.token === 'string' && msg.token.length <= 64 ? r.members.find((m) => m.token === msg.token) : null;
        if (back) {
          const meta = cleanMeta(msg.meta, cfg.maxMeta);
          if (meta) back.meta = meta;
          log('rejoin', { room: code, member: back.id });
          return attach(c, r, back);
        }
        if (r.members.length >= cfg.maxMembers) return sendCtl(c, { t: 'err', code: 'full', msg: '房间满了' });
        const meta = cleanMeta(msg.meta, cfg.maxMeta);
        if (meta === null) return sendCtl(c, { t: 'err', code: 'bad', msg: '附加信息太大' });
        const m = { id: r.nextId++, order: r.order++, name: cleanName(msg.name, cfg.maxName) || '道友', meta, token: randomBytes(12).toString('hex'), sock: null, lost: 0 };
        r.members.push(m);
        log('join', { room: code, member: m.id, size: r.members.length });
        return attach(c, r, m);
      }
      case 'leave':
        return memberLeave(c);
      case 'meta': {
        if (!c.member) return;
        const meta = cleanMeta(msg.meta, cfg.maxMeta);
        if (meta === null) return sendCtl(c, { t: 'err', code: 'bad', msg: '附加信息太大' });
        c.member.meta = meta;
        if (typeof msg.name === 'string') c.member.name = cleanName(msg.name, cfg.maxName) || c.member.name;
        return pushRoster(c.room);
      }
      case 'abdicate':
        // 房主自己让位（比如切到后台太久）：只有现在的房主能这么做
        if (c.room && c.member && c.member.id === c.room.host) migrate(c.room, '房主让位', 'abdicate');
        return;
      default:
        return sendCtl(c, { t: 'err', code: 'bad', msg: '不认识的指令' });
    }
  }

  /** 数据帧：`>目标|内容`。房主发：目标为空 = 其他所有人，数字 = 那一个人；其他人发：一律给房主。 */
  function forward(c, text) {
    const r = c.room;
    const m = c.member;
    if (!r || !m) return;
    const bar = text.indexOf('|');
    if (bar < 0 || bar > 8) return;
    const to = text.slice(1, bar);
    const out = `<${m.id}|${text.slice(bar + 1)}`;
    if (m.id === r.host) {
      if (to === '') {
        for (const x of r.members) if (x !== m && x.sock && x.sock.ws.readyState === 1) x.sock.ws.send(out);
      } else {
        const id = Number(to);
        const x = r.members.find((y) => y.id === id);
        if (x?.sock && x.sock.ws.readyState === 1) x.sock.ws.send(out);
      }
    } else {
      if (text.length > cfg.maxGuestFrame) return;
      const h = r.members.find((y) => y.id === r.host);
      if (h?.sock && h.sock.ws.readyState === 1) h.sock.ws.send(out);
    }
  }

  // ---------- 连接 ----------
  /** @typedef {{ ws: any, ip: string, room: Room | null, member: Member | null, seen: number, tokens: number, refill: number, warned: number }} Conn */
  wss.on('connection', (ws, req) => {
    const ip = clientIp(req);
    if (conns.size >= cfg.maxConns || (perIp.get(ip) ?? 0) >= cfg.maxConnsPerIp) {
      log('reject', { reason: conns.size >= cfg.maxConns ? 'conns' : 'per_ip', conns: conns.size });
      ws.close(1013, 'busy');
      return;
    }
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    /** @type {Conn} */
    const c = { ws, ip, room: null, member: null, seen: now(), tokens: cfg.guestBurst, refill: now(), warned: 0 };
    conns.add(c);
    ws.on('message', (data, isBinary) => {
      c.seen = now();
      if (isBinary) return;
      const host = !!c.member && !!c.room && c.member.id === c.room.host;
      // 令牌桶：超了的帧丢掉，每秒最多提醒一次
      const t = now();
      const rate = host ? cfg.hostRate : cfg.guestRate;
      const burst = host ? cfg.hostBurst : cfg.guestBurst;
      c.tokens = Math.min(burst, c.tokens + ((t - c.refill) / 1000) * rate);
      c.refill = t;
      if (c.tokens < 1) {
        if (t - c.warned > 1000) {
          c.warned = t;
          log('rate', { room: c.room?.code ?? '-', member: c.member?.id ?? 0 });
          sendCtl(c, { t: 'err', code: 'rate', msg: '发得太快了' });
        }
        return;
      }
      c.tokens -= 1;
      const text = data.toString();
      if (text[0] === '>') return forward(c, text);
      if (text.length > 4096) return sendCtl(c, { t: 'err', code: 'size', msg: '控制帧太大' });
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        return sendCtl(c, { t: 'err', code: 'bad', msg: '不是 JSON' });
      }
      if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return sendCtl(c, { t: 'err', code: 'bad', msg: '格式不对' });
      handle(c, msg);
    });
    /** 连接没了（关闭、出错、心跳超时）：只生效一次。 */
    c.gone = (code) => {
      if (!conns.has(c)) return;
      conns.delete(c);
      const n = (perIp.get(ip) ?? 1) - 1;
      if (n > 0) perIp.set(ip, n);
      else perIp.delete(ip);
      if (!draining) memberLost(c, code);
    };
    ws.on('close', (code) => c.gone(code));
    ws.on('error', () => c.gone(undefined));
  });

  // 流量统计（/stats）：每 5 秒按 TCP 的计数算一次各房间每秒进出多少字节
  let lastRate = now();
  const rates = () => {
    const t = now();
    const dt = (t - lastRate) / 1000;
    if (dt < 5) return;
    lastRate = t;
    for (const r of rooms.values()) {
      let i = 0;
      let o = 0;
      for (const m of r.members) {
        const s = m.sock?.ws._socket;
        if (!s) continue;
        const c = m.sock;
        i += s.bytesRead - (c.bin ?? s.bytesRead);
        o += s.bytesWritten - (c.bout ?? s.bytesWritten);
        c.bin = s.bytesRead;
        c.bout = s.bytesWritten;
      }
      r.rate = { in: i / dt, out: o / dt };
    }
  };
  // 掉线检测：这么久什么都没收到就断开（手机切到后台、断网时 TCP 不一定马上断）
  const sweep = setInterval(() => {
    rates();
    const t = now();
    for (const c of conns)
      if (t - c.seen > cfg.silenceMs) {
        try {
          c.ws.terminate();
        } catch {
          /* 已经关了 */
        }
        c.gone(undefined); // terminate 之后 close 事件也会来，gone 只生效一次
      }
  }, Math.min(1000, cfg.silenceMs / 3));

  /** 马上停：清定时器、断掉所有连接、关监听。 */
  const stop = () =>
    new Promise((done) => {
      clearInterval(sweep);
      for (const r of rooms.values()) {
        clearTimeout(r.graceTimer);
        clearTimeout(r.idleTimer);
      }
      for (const c of conns) c.ws.terminate();
      wss.close();
      server.close(() => done());
      server.closeAllConnections?.();
    });

  /**
   * 体面地关（收到 SIGTERM：docker stop、更新部署）：不再接新连接（/health 回 503），告诉连着的每个人「中继要关了」，
   * 等 shutdownMs 让这句话发出去，再用 1012（服务重启）关掉连接。房间都在内存里，关了就没了——客户端收到之后不再重连回这个房。
   */
  let shutting = null;
  function shutdown(signal = 'shutdown') {
    if (shutting) return shutting;
    draining = true;
    log('shutdown', { signal, rooms: rooms.size, conns: conns.size, wait: cfg.shutdownMs });
    const bye = JSON.stringify({ t: 'bye', msg: BYE_MSG });
    for (const c of conns) if (c.ws.readyState === 1) c.ws.send(bye);
    shutting = new Promise((done) => {
      later(() => {
        for (const c of conns) if (c.ws.readyState === 1) c.ws.close(1012, 'restart');
        // 关不掉的（对面不回关闭帧）再等一会儿直接断
        later(() => stop().then(() => (log('closed', {}), done())), 300);
      }, cfg.shutdownMs);
    });
    return shutting;
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(cfg.port ?? 5300, cfg.host ?? '0.0.0.0', () => {
      const port = server.address().port;
      log('listen', {
        host: cfg.host ?? '0.0.0.0',
        port,
        base: base || '-',
        origins: anyOrigin ? 'any' : [...origins].join(','),
        trustProxy: cfg.trustProxy ? 1 : 0,
        lan: cfg.lan ? 1 : 0,
        maxRooms: cfg.maxRooms,
        maxConns: cfg.maxConns,
        maxConnsPerIp: cfg.maxConnsPerIp,
      });
      resolve({ server, port, rooms, close: stop, shutdown });
    });
  });
}

/** 本机的局域网 IPv4 地址（手机连同一个 Wi-Fi 时用这个地址打开页面）。 */
export function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  // 192.168 / 10 / 172.16-31 的私网地址排前面（家里的 Wi-Fi 一般是这些）
  const rank = (ip) => (/^192\.168\./.test(ip) ? 0 : /^10\./.test(ip) ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b));
}

// 直接运行（npm run relay、Docker 里的 node server/relay.mjs）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let cfg;
  try {
    cfg = configFromEnv();
  } catch (e) {
    console.error(`[relay] 起不来：${e.message}`);
    process.exit(1);
  }
  const log = makeLogger(cfg.logFormat);
  startRelay({ ...cfg, log }).then(
    (relay) => {
      const lan = lanAddresses();
      if ((cfg.lan ?? true) && lan.length) console.log(`[relay] 局域网里：ws://${lan[0]}:${relay.port}（页面用 http://${lan[0]}:<开发服务器端口>/ 打开，会自动连这个地址）`);
      let stopping = false;
      for (const sig of ['SIGINT', 'SIGTERM'])
        process.on(sig, () => {
          if (stopping) process.exit(1); // 再按一次：不等了
          stopping = true;
          relay.shutdown(sig).then(() => process.exit(0));
        });
    },
    (e) => {
      console.error('[relay] 起不来：', e.message);
      process.exit(1);
    },
  );
  process.on('uncaughtException', (e) => {
    log('crash', { msg: String(e?.message ?? e).slice(0, 200) });
    process.exit(1);
  });
}
