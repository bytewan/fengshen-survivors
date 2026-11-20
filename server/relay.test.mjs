// 中继的测试：起服务（随便挑一个空闲端口）、两个客户端进同一个房、互发消息、断开与重连、房主掉线后迁移、限流。
// 运行：npm test（或 node --test server/relay.test.mjs）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { BYE_MSG, CODE_RE, cleanName, configFromEnv, makeLogger, normOrigin, startRelay } from './relay.mjs';

const quiet = () => {};

/** 一个测试用的客户端：收到的帧都排进队列，next() 等下一条（可以按条件挑）。o.path：连哪个路径；其余给 ws（origin、headers）。 */
async function client(port, o = {}) {
  const { path = '', ...wsOpts } = o;
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, wsOpts);
  const inbox = [];
  const waiters = [];
  const closed = new Promise((r) => ws.once('close', (code) => r(code)));
  ws.on('message', (d) => {
    const s = d.toString();
    const m = s[0] === '{' ? JSON.parse(s) : { raw: s };
    const i = waiters.findIndex((w) => w.pred(m));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(m);
    else inbox.push(m);
  });
  await new Promise((r, j) => {
    ws.once('open', r);
    ws.once('error', j);
  });
  return {
    ws,
    send: (o) => ws.send(typeof o === 'string' ? o : JSON.stringify(o)),
    /** 等一条满足条件的帧（队列里已经有就直接拿）。 */
    next(pred = () => true, ms = 2000) {
      const i = inbox.findIndex(pred);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const k = waiters.indexOf(w);
          if (k >= 0) {
            waiters.splice(k, 1);
            reject(new Error('等不到想要的帧；队列里有：' + JSON.stringify(inbox).slice(0, 400)));
          }
        }, ms);
        const w = {
          pred,
          resolve: (m) => {
            clearTimeout(timer);
            resolve(m);
          },
        };
        waiters.push(w);
      });
    },
    close: (code) => ws.close(code),
    /** 连接关掉时的关闭码。 */
    closed,
  };
}

const t = (type) => (m) => m.t === type;

test('中继：/health、/info', async () => {
  const relay = await startRelay({ port: 0, host: '127.0.0.1', log: quiet });
  try {
    const r = await fetch(`http://127.0.0.1:${relay.port}/health`);
    assert.equal(await r.text(), 'ok');
    const info = await (await fetch(`http://127.0.0.1:${relay.port}/info`)).json();
    assert.ok(Array.isArray(info.lan));
    assert.equal(info.max, 4);
  } finally {
    await relay.close();
  }
});

test('中继：建房、进房、互发消息、点名发、断开', async () => {
  const relay = await startRelay({ port: 0, host: '127.0.0.1', log: quiet });
  try {
    const a = await client(relay.port);
    a.send({ t: 'create', name: '甲', meta: { hero: 'nezha' } });
    const ja = await a.next(t('joined'));
    assert.match(ja.room, CODE_RE);
    assert.equal(ja.you, ja.host, '建房的人是房主');
    const b = await client(relay.port);
    b.send({ t: 'join', room: ja.room.toLowerCase(), name: '乙', meta: { hero: 'nezha', ready: false } }); // 小写也认
    const jb = await b.next(t('joined'));
    assert.equal(jb.room, ja.room);
    assert.notEqual(jb.you, ja.you);
    assert.equal(jb.members.length, 2);
    // 房主看到名单变成两个人
    const ra = await a.next((m) => m.t === 'room' && m.members.length === 2);
    assert.deepEqual(ra.members.map((m) => m.name), ['甲', '乙']);
    assert.equal(ra.members[1].meta.hero, 'nezha');
    // 房主广播 → 乙；乙 → 房主；房主点名发给乙
    a.send(`>|{"hello":1}`);
    assert.equal((await b.next((m) => m.raw)).raw, `<${ja.you}|{"hello":1}`);
    b.send(`>|ping`);
    assert.equal((await a.next((m) => m.raw)).raw, `<${jb.you}|ping`);
    a.send(`>${jb.you}|only-you`);
    assert.equal((await b.next((m) => m.raw)).raw, `<${ja.you}|only-you`);
    // 改附加信息（准备）：名单跟着变
    b.send({ t: 'meta', meta: { hero: 'nezha', ready: true } });
    const rr = await a.next((m) => m.t === 'room' && m.members.some((x) => x.meta.ready));
    assert.equal(rr.members.find((x) => x.id === jb.you).meta.ready, true);
    // 心跳回声
    b.send({ t: 'hb', c: 42 });
    assert.equal((await b.next(t('hb'))).c, 42);
    // 乙断开（不是「离开」）：位置留着，名单上显示掉线；带着凭据重连回到原来的位置
    b.ws.terminate();
    const lost = await a.next((m) => m.t === 'room' && m.members.some((x) => x.id === jb.you && !x.on));
    assert.equal(lost.members.length, 2);
    const b2 = await client(relay.port);
    b2.send({ t: 'join', room: ja.room, name: '乙', token: jb.token });
    const jb2 = await b2.next(t('joined'));
    assert.equal(jb2.you, jb.you, '重连回到原来的编号');
    await a.next((m) => m.t === 'room' && m.members.every((x) => x.on));
    // 乙离开：名单上就没有他了
    b2.send({ t: 'leave' });
    const left = await a.next((m) => m.t === 'room' && m.members.length === 1);
    assert.equal(left.members[0].id, ja.you);
    // 房主也离开：删房
    a.send({ t: 'leave' });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(relay.rooms.size, 0);
    a.close();
    b2.close();
  } finally {
    await relay.close();
  }
});

test('中继：没有的房间、房间码不对、房间满了', async () => {
  const relay = await startRelay({ port: 0, host: '127.0.0.1', log: quiet, maxMembers: 2 });
  try {
    const a = await client(relay.port);
    a.send({ t: 'join', room: 'ZZZZ', name: 'x' });
    assert.equal((await a.next(t('err'))).code, 'no_room');
    a.send({ t: 'join', room: 'AB0O', name: 'x' }); // 0 和 O 不会出现在房间码里
    assert.equal((await a.next(t('err'))).code, 'bad');
    a.send({ t: 'create', name: 'a' });
    const j = await a.next(t('joined'));
    const b = await client(relay.port);
    b.send({ t: 'join', room: j.room, name: 'b' });
    await b.next(t('joined'));
    const c = await client(relay.port);
    c.send({ t: 'join', room: j.room, name: 'c' });
    assert.equal((await c.next(t('err'))).code, 'full');
    // 没进房就发数据：不转发（也不出错）
    c.send('>|nothing');
    for (const x of [a, b, c]) x.close();
  } finally {
    await relay.close();
  }
});

test('中继：房主关页面（1001）立刻迁给下一个人；房主掉线先通知、等一会儿再迁；回来得及就不迁', async () => {
  const relay = await startRelay({ port: 0, host: '127.0.0.1', log: quiet, hostGraceMs: 250 });
  try {
    const a = await client(relay.port);
    a.send({ t: 'create', name: 'a' });
    const ja = await a.next(t('joined'));
    const b = await client(relay.port);
    b.send({ t: 'join', room: ja.room, name: 'b' });
    const jb = await b.next(t('joined'));
    const c = await client(relay.port);
    c.send({ t: 'join', room: ja.room, name: 'c' });
    const jc = await c.next(t('joined'));
    // 关页面：浏览器发 1001
    a.close(1001);
    const h = await b.next(t('host'));
    assert.equal(h.id, jb.you, '按进房顺序：b 接手');
    assert.equal((await c.next(t('host'))).id, jb.you);
    // b 是房主了：b 的数据发给 c
    b.send('>|state');
    assert.equal((await c.next((m) => m.raw)).raw, `<${jb.you}|state`);
    // b 掉线（不是正常关闭）：c 先收到「房主不在」，等 hostGraceMs 之后 c 当房主
    b.ws.terminate();
    const away = await c.next(t('hostAway'));
    assert.equal(away.id, jb.you);
    const h2 = await c.next(t('host'), 2000);
    assert.equal(h2.id, jc.you);
    // c 掉线又在等待期内回来：不迁
    const d = await client(relay.port);
    d.send({ t: 'join', room: ja.room, name: 'd' });
    const jd = await d.next(t('joined'));
    c.ws.terminate();
    await d.next(t('hostAway'));
    const c2 = await client(relay.port);
    c2.send({ t: 'join', room: ja.room, name: 'c', token: jc.token });
    assert.equal((await c2.next(t('joined'))).host, jc.you);
    const back = await d.next(t('host'));
    assert.equal(back.id, jc.you, '房主回来了，还是他');
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(relay.rooms.get(ja.room).host, jc.you, '等待期过了也不迁');
    // 房主让位
    c2.send({ t: 'abdicate' });
    assert.equal((await d.next(t('host'))).id, jd.you);
    for (const x of [c2, d]) x.close();
  } finally {
    await relay.close();
  }
});

test('中继：心跳超时算掉线；发得太快被限流', async () => {
  const relay = await startRelay({ port: 0, host: '127.0.0.1', log: quiet, silenceMs: 300, guestBurst: 20, guestRate: 10 });
  try {
    const a = await client(relay.port);
    a.send({ t: 'create', name: 'a' });
    const ja = await a.next(t('joined'));
    const b = await client(relay.port);
    b.send({ t: 'join', room: ja.room, name: 'b' });
    const jb = await b.next(t('joined'));
    // a 一直发心跳，b 不吭声：b 被判掉线
    const keep = setInterval(() => a.send({ t: 'hb' }), 80);
    const lost = await a.next((m) => m.t === 'room' && m.members.some((x) => x.id === jb.you && !x.on), 2000);
    assert.ok(lost);
    clearInterval(keep);
    // 限流：一口气发 60 条，后面的被丢掉、收到一次提醒
    const c = await client(relay.port);
    for (let i = 0; i < 60; i++) c.send({ t: 'hb', c: i });
    const err = await c.next(t('err'));
    assert.equal(err.code, 'rate');
    a.close();
    c.close();
  } finally {
    await relay.close();
  }
});

test('中继：名字清洗', () => {
  assert.equal(cleanName('  哪吒\u200b\u0007  '), '哪吒');
  assert.equal(cleanName('一二三四五六七八九十甲乙丙丁'), '一二三四五六七八九十甲乙');
  assert.equal(cleanName(42), '');
});

// ---------- 上线版的选项（docs/deploy.md「中继」） ----------

/** 试着连一下：连上了返回 'open'（并关掉），被拒返回 HTTP 状态码，连上后被关返回 'close:关闭码'。 */
function tryConnect(port, o = {}) {
  const { path = '', ...wsOpts } = o;
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, wsOpts);
    ws.once('unexpected-response', (_req, res) => {
      resolve(res.statusCode);
      ws.terminate();
    });
    ws.once('open', () => {
      // 连上之后马上被关（连接数超了）的要等一下才知道
      const timer = setTimeout(() => {
        resolve('open');
        ws.close();
      }, 80);
      ws.once('close', (code) => {
        clearTimeout(timer);
        resolve(`close:${code}`);
      });
    });
    ws.once('error', () => {});
  });
}

test('中继：环境变量读配置；写错了起不来', () => {
  assert.deepEqual(configFromEnv({}), {}, '什么都不设 = 全用默认值');
  const c = configFromEnv({
    RELAY_PORT: '5310',
    RELAY_HOST: '127.0.0.1',
    RELAY_ORIGINS: 'https://FS.example.com/, https://www.fs.example.com:443',
    RELAY_MAX_ROOMS: '50',
    RELAY_MAX_CONNS: '300',
    RELAY_MAX_CONNS_PER_IP: '8',
    RELAY_TRUST_PROXY: '1',
    RELAY_BASE: '/relay/',
    RELAY_LAN: '0',
    RELAY_LOG: 'json',
    RELAY_SHUTDOWN_MS: '2000',
  });
  assert.deepEqual(c, {
    port: 5310,
    host: '127.0.0.1',
    maxRooms: 50,
    maxConns: 300,
    maxConnsPerIp: 8,
    trustProxy: true,
    lan: false,
    shutdownMs: 2000,
    origins: ['https://fs.example.com', 'https://www.fs.example.com'],
    base: '/relay',
    logFormat: 'json',
  });
  assert.equal(configFromEnv({ RELAY_BASE: '' }).base, '', '前缀可以关掉');
  assert.throws(() => configFromEnv({ RELAY_PORT: 'abc' }), /RELAY_PORT/);
  assert.throws(() => configFromEnv({ RELAY_MAX_ROOMS: '0' }), /RELAY_MAX_ROOMS/);
  assert.throws(() => configFromEnv({ RELAY_TRUST_PROXY: 'maybe' }), /RELAY_TRUST_PROXY/);
  assert.throws(() => configFromEnv({ RELAY_ORIGINS: 'fs.example.com' }), /RELAY_ORIGINS/, '来源要写成完整的 https://域名');
  assert.throws(() => configFromEnv({ RELAY_LOG: 'xml' }), /RELAY_LOG/);
  assert.equal(normOrigin('http://localhost:5242/'), 'http://localhost:5242');
  assert.equal(normOrigin('*'), '*');
  assert.equal(normOrigin('nope'), null);
});

test('中继：来源白名单——别的网页、没带来源的连不上；HTTP 的跨域头也只给允许的来源', async () => {
  const relay = await startRelay({ port: 0, host: '127.0.0.1', log: quiet, origins: ['https://fs.example.com'] });
  try {
    assert.equal(await tryConnect(relay.port, { origin: 'https://fs.example.com' }), 'open');
    assert.equal(await tryConnect(relay.port, { origin: 'https://FS.example.com:443' }), 'open', '大小写、默认端口不算不同');
    assert.equal(await tryConnect(relay.port, { origin: 'https://evil.example.com' }), 403);
    assert.equal(await tryConnect(relay.port, { origin: 'http://fs.example.com' }), 403, 'http 和 https 是两个来源');
    assert.equal(await tryConnect(relay.port), 403, '没带来源（不是浏览器）');
    const ok = await fetch(`http://127.0.0.1:${relay.port}/info`, { headers: { origin: 'https://fs.example.com' } });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://fs.example.com');
    const no = await fetch(`http://127.0.0.1:${relay.port}/info`, { headers: { origin: 'https://evil.example.com' } });
    assert.equal(no.headers.get('access-control-allow-origin'), null);
  } finally {
    await relay.close();
  }
  // 不设白名单（局域网开发）：谁都能连
  const open = await startRelay({ port: 0, host: '127.0.0.1', log: quiet });
  try {
    assert.equal(await tryConnect(open.port, { origin: 'http://192.168.1.23:5180' }), 'open');
    assert.equal(await tryConnect(open.port), 'open');
  } finally {
    await open.close();
  }
});

test('中继：反向代理把 /relay 原样转过来——/relay/health、/relay/info、wss://域名/relay 都认，不带前缀的照旧', async () => {
  const relay = await startRelay({ port: 0, host: '127.0.0.1', log: quiet, lan: false });
  try {
    for (const p of ['/relay/health', '/health', '/relay/health?x=1']) assert.equal(await (await fetch(`http://127.0.0.1:${relay.port}${p}`)).text(), 'ok', p);
    const info = await (await fetch(`http://127.0.0.1:${relay.port}/relay/info`)).json();
    assert.deepEqual(info.lan, [], '公网上不报本机的局域网地址');
    assert.equal((await fetch(`http://127.0.0.1:${relay.port}/relay/nope`)).status, 404);
    const a = await client(relay.port, { path: '/relay' });
    a.send({ t: 'create', name: '甲' });
    const ja = await a.next(t('joined'));
    const b = await client(relay.port, { path: '/relay' });
    b.send({ t: 'join', room: ja.room, name: '乙' });
    await b.next(t('joined'));
    // /stats：公网上只给合计，不列房间码（房间码是进房的唯一凭据）
    const st = await (await fetch(`http://127.0.0.1:${relay.port}/relay/stats`)).json();
    assert.deepEqual(st.rooms, []);
    assert.equal(st.total.rooms, 1);
    assert.equal(st.total.online, 2);
    assert.ok(!JSON.stringify(st).includes(ja.room));
    a.close();
    b.close();
  } finally {
    await relay.close();
  }
  // 局域网开发（lan 默认开）：/stats 照旧列出各房间（tools/net-run.mjs 读它）
  const lan = await startRelay({ port: 0, host: '127.0.0.1', log: quiet });
  try {
    const a = await client(lan.port);
    a.send({ t: 'create', name: '甲' });
    const ja = await a.next(t('joined'));
    const st = await (await fetch(`http://127.0.0.1:${lan.port}/stats`)).json();
    assert.equal(st.rooms[0].room, ja.room);
    assert.ok(Array.isArray((await (await fetch(`http://127.0.0.1:${lan.port}/info`)).json()).lan));
    a.close();
  } finally {
    await lan.close();
  }
});

test('中继：在反向代理后面按 X-Forwarded-For 认 IP（每个 IP 的连接上限）；不信代理时这个头不算数', async () => {
  const xff = (ip) => ({ headers: { 'x-forwarded-for': `6.6.6.6, ${ip}` } }); // 前面那个可能是客户端伪造的，认最右边代理加的
  const relay = await startRelay({ port: 0, host: '127.0.0.1', log: quiet, trustProxy: true, maxConnsPerIp: 2 });
  try {
    const keep = [await client(relay.port, xff('1.1.1.1')), await client(relay.port, xff('1.1.1.1'))];
    assert.equal(await tryConnect(relay.port, xff('1.1.1.1')), 'close:1013', '同一个 IP 第三条被拒');
    assert.equal(await tryConnect(relay.port, xff('2.2.2.2')), 'open', '别的 IP 不受影响（代理后面大家的 TCP 来源都是代理）');
    assert.equal(await tryConnect(relay.port, { headers: { 'x-real-ip': '3.3.3.3' } }), 'open');
    for (const k of keep) k.close();
  } finally {
    await relay.close();
  }
  const direct = await startRelay({ port: 0, host: '127.0.0.1', log: quiet, maxConnsPerIp: 2 });
  try {
    const keep = [await client(direct.port, xff('1.1.1.1')), await client(direct.port, xff('2.2.2.2'))];
    assert.equal(await tryConnect(direct.port, xff('3.3.3.3')), 'close:1013', '不信代理：都算 127.0.0.1，伪造头绕不过上限');
    for (const k of keep) k.close();
  } finally {
    await direct.close();
  }
});

test('中继：房间数、总连接数上限', async () => {
  const relay = await startRelay({ port: 0, host: '127.0.0.1', log: quiet, maxRooms: 1, maxConns: 3 });
  try {
    const a = await client(relay.port);
    a.send({ t: 'create', name: 'a' });
    await a.next(t('joined'));
    const b = await client(relay.port);
    b.send({ t: 'create', name: 'b' });
    assert.equal((await b.next(t('err'))).code, 'full', '房间数到顶');
    const c = await client(relay.port);
    assert.equal(await tryConnect(relay.port), 'close:1013', '第四条连接被拒');
    for (const x of [a, b, c]) x.close();
  } finally {
    await relay.close();
  }
});

test('中继：收到 SIGTERM（shutdown）——先告诉房里每个人「要关了」、/health 回 503、不接新连接，再用 1012 关掉', async () => {
  const relay = await startRelay({ port: 0, host: '127.0.0.1', log: quiet, shutdownMs: 150 });
  const a = await client(relay.port);
  a.send({ t: 'create', name: '甲' });
  const ja = await a.next(t('joined'));
  const b = await client(relay.port);
  b.send({ t: 'join', room: ja.room, name: '乙' });
  await b.next(t('joined'));
  await a.next((m) => m.t === 'room' && m.members.length === 2); // 乙进房的那份名单先到（不然它晚到一点会被算进下面）
  const roster = [];
  a.ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    if (m.t === 'room') roster.push(m);
  });
  const done = relay.shutdown('SIGTERM');
  assert.equal((await a.next(t('bye'))).msg, BYE_MSG);
  assert.equal((await b.next(t('bye'))).msg, BYE_MSG);
  const h = await fetch(`http://127.0.0.1:${relay.port}/health`);
  assert.equal(h.status, 503);
  assert.equal(await tryConnect(relay.port), 503, '正在关：不接新连接');
  assert.equal(await a.closed, 1012, '服务重启');
  assert.equal(await b.closed, 1012);
  await done;
  assert.equal(roster.length, 0, '关的时候不再挨个推「某某掉线」的名单');
});

test('中继：日志一行一个事件，不记名号、附加信息、游戏内容和 IP', async () => {
  const lines = [];
  const log = makeLogger('text', (l) => lines.push(l));
  const relay = await startRelay({ port: 0, host: '127.0.0.1', log, hostGraceMs: 50, trustProxy: true });
  try {
    const a = await client(relay.port, { headers: { 'x-forwarded-for': '9.8.7.6' } });
    a.send({ t: 'create', name: '机密名号甲', meta: { hero: 'secret-hero' } });
    const ja = await a.next(t('joined'));
    const b = await client(relay.port);
    b.send({ t: 'join', room: ja.room, name: '机密名号乙', meta: { note: 'secret-meta' } });
    await b.next(t('joined'));
    a.send('>|{"t":"st","secret":"game-content"}');
    await b.next((m) => m.raw);
    b.send({ t: 'meta', meta: { ready: true }, name: '改了的名号' });
    await a.next((m) => m.t === 'room' && m.members.some((x) => x.meta.ready));
    a.ws.terminate(); // 房主掉线 → 等一会儿迁给乙
    await b.next(t('host'));
    b.send({ t: 'leave' });
    await new Promise((r) => setTimeout(r, 60));
    a.close();
    b.close();
  } finally {
    await relay.close();
  }
  const all = lines.join('\n');
  for (const secret of ['机密名号', '改了的名号', 'secret-hero', 'secret-meta', 'game-content', '9.8.7.6', '127.0.0.1:']) assert.ok(!all.includes(secret), `日志里不该有 ${secret}`);
  for (const l of lines) assert.match(l, /^\d{4}-\d\d-\d\dT[\d:.]+Z [a-z.]+( |$)/, `一行一个事件：${l}`);
  const evs = lines.map((l) => l.split(' ')[1]);
  for (const ev of ['listen', 'create', 'join', 'lost', 'host.wait', 'host', 'leave']) assert.ok(evs.includes(ev), `应该有 ${ev}：${evs.join(',')}`);
  // json 格式：每行都是一个 JSON 对象
  const js = [];
  makeLogger('json', (l) => js.push(l))('create', { room: 'ABCD', member: 1 });
  assert.deepEqual(Object.keys(JSON.parse(js[0])), ['time', 'ev', 'room', 'member']);
});
