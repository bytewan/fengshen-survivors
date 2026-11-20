// 客户端连接（src/net/link.ts）和中继一起测：建房、进房、收发、断线后自己重连回到原来的位置、房主走了换人、房间没了。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BYE_MSG, startRelay } from './relay.mjs';
import { Link } from '../src/net/link.ts';

const quiet = () => {};
const until = async (cond, ms = 3000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('等不到');
    await new Promise((r) => setTimeout(r, 15));
  }
};

test('客户端连接：建房、进房、收发、断线重连、换房主', async () => {
  const relay = await startRelay({ port: 0, host: '127.0.0.1', log: quiet, hostGraceMs: 200 });
  const url = `ws://127.0.0.1:${relay.port}`;
  const a = new Link(url);
  const b = new Link(url);
  try {
    await a.create('甲', { hero: 'nezha' });
    assert.ok(a.isHost);
    assert.match(a.room, /^[A-Z2-9]{4}$/);
    await b.join(a.room.toLowerCase(), '乙', { hero: 'nezha', ready: true });
    assert.equal(b.room, a.room);
    assert.ok(!b.isHost);
    await until(() => a.members.length === 2);
    // 收发
    const gotA = [];
    const gotB = [];
    a.on('data', (from, s) => gotA.push([from, s]));
    b.on('data', (from, s) => gotB.push([from, s]));
    a.send('{"t":"st"}');
    b.send('{"t":"in"}');
    await until(() => gotA.length && gotB.length);
    assert.deepEqual(gotB[0], [a.me, '{"t":"st"}']);
    assert.deepEqual(gotA[0], [b.me, '{"t":"in"}']);
    // 往返延迟有了（心跳回声）
    await until(() => a.rtt > 0);
    // 乙的连接断了（不是离开）：自己重连、回到原来的编号
    const meB = b.me;
    const states = [];
    b.on('state', (s) => states.push(s));
    b['ws'].close();
    await until(() => states.includes('lost'));
    await until(() => b.state === 'open' && states.at(-1) === 'open', 5000);
    assert.equal(b.me, meB);
    await until(() => a.members.every((m) => m.on));
    // 重连之后照样收得到
    a.send('again');
    await until(() => gotB.some(([, s]) => s === 'again'));
    // 房主离开：乙接手
    const hosts = [];
    b.on('host', (id) => hosts.push(id));
    a.close();
    await until(() => hosts.length > 0);
    assert.equal(hosts[0], b.me);
    assert.ok(b.isHost);
  } finally {
    a.close();
    b.close();
    await relay.close();
  }
});

test('客户端连接：连不上、没有这个房间', async () => {
  const relay = await startRelay({ port: 0, host: '127.0.0.1', log: quiet });
  const url = `ws://127.0.0.1:${relay.port}`;
  const c = new Link(url);
  try {
    await assert.rejects(c.join('ZZZZ', '丙', {}), /没有这个房间/);
  } finally {
    c.close();
    await relay.close();
  }
  const d = new Link('ws://127.0.0.1:1');
  await assert.rejects(d.create('丁', {}), /连不上中继/);
  d.close();
});

test('客户端连接：中继要关了（bye）——告诉上面「房间没了」，不再重连回这个房', async () => {
  const relay = await startRelay({ port: 0, host: '127.0.0.1', log: quiet, shutdownMs: 100 });
  const url = `ws://127.0.0.1:${relay.port}`;
  const a = new Link(url);
  const b = new Link(url);
  try {
    await a.create('甲', {});
    await b.join(a.room, '乙', {});
    const gone = [];
    a.on('gone', (why) => gone.push(['a', why]));
    b.on('gone', (why) => gone.push(['b', why]));
    await relay.shutdown('SIGTERM');
    await until(() => gone.length === 2);
    assert.deepEqual(gone.map(([, w]) => w), [BYE_MSG, BYE_MSG]);
    assert.equal(a.room, '');
    // 连接关了也不重连（房间没了，重连回去只会收到「没有这个房间」）
    await until(() => a.state === 'idle' && b.state === 'idle');
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(a.state, 'idle');
    assert.equal(b.state, 'idle');
  } finally {
    a.close();
    b.close();
    await relay.close();
  }
});
