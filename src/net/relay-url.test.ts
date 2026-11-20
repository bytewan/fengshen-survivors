// 中继地址（src/net/link.ts 的 relayUrl）：局域网开发连「同一台机器的 5300」，上公网连同一个域名的 /relay，?relay= 优先。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relayHttp, relayUrl, type PageLoc } from './link.ts';

const page = (href: string): PageLoc => {
  const u = new URL(href);
  return { protocol: u.protocol, hostname: u.hostname, host: u.host, port: u.port };
};

test('中继地址：局域网开发（页面在开发服务器的端口上）照旧连同一台机器的 5300', () => {
  assert.equal(relayUrl('', page('http://192.168.1.23:5180/')), 'ws://192.168.1.23:5300');
  assert.equal(relayUrl('?room=ABCD', page('http://localhost:5180/?room=ABCD')), 'ws://localhost:5300');
  assert.equal(relayUrl('', page('http://localhost:5242/')), 'ws://localhost:5300', 'vite preview 也是');
  assert.equal(relayUrl('', undefined), 'ws://127.0.0.1:5300', '没有页面（Node 里）');
});

test('中继地址：https 页面连同一个域名的 wss://…/relay（反向代理后面）', () => {
  assert.equal(relayUrl('', page('https://fs.example.com/')), 'wss://fs.example.com/relay');
  assert.equal(relayUrl('?room=ABCD', page('https://fs.example.com/?room=ABCD')), 'wss://fs.example.com/relay');
  assert.equal(relayUrl('', page('https://localhost:5311/')), 'wss://localhost:5311/relay', '非默认端口的 https 也走反向代理（本机的 Caddy 测试）');
  assert.equal(relayUrl('', page('http://fs.example.com/')), 'ws://fs.example.com/relay', 'http 但用默认端口：也是反向代理（还没配证书的时候）');
  assert.equal(relayHttp(relayUrl('', page('https://fs.example.com/'))), 'https://fs.example.com/relay', '大厅问 /info 的地址');
});

test('中继地址：?relay= 优先（完整地址，或者主机:端口——跟着页面用 ws / wss）', () => {
  assert.equal(relayUrl('?relay=ws://10.0.0.2:5310', page('http://localhost:5242/')), 'ws://10.0.0.2:5310');
  assert.equal(relayUrl('?relay=10.0.0.2:5310', page('http://localhost:5242/')), 'ws://10.0.0.2:5310');
  assert.equal(relayUrl('?relay=relay.example.com', page('https://fs.example.com/')), 'wss://relay.example.com');
  assert.equal(relayUrl('?relay=wss://fs.example.com/relay', page('http://localhost:5180/')), 'wss://fs.example.com/relay');
});


test('中继地址：Pages 使用构建配置，房间链接参数仍可覆盖', () => {
  const loc = page('https://player.github.io/fengshen-survivors/?room=ABCD');
  assert.equal(relayUrl('?room=ABCD', loc, 'wss://relay.example.com/fengshen/relay'), 'wss://relay.example.com/fengshen/relay');
  assert.equal(relayUrl('?relay=wss://backup.example.com/relay', loc, 'wss://relay.example.com/fengshen/relay'), 'wss://backup.example.com/relay');
  assert.equal(relayHttp(relayUrl('', loc, 'wss://relay.example.com/fengshen/relay')), 'https://relay.example.com/fengshen/relay');
});

test('中继地址：HTTPS 页面拒绝不安全连接和带凭证的地址', () => {
  const loc = page('https://player.github.io/fengshen-survivors/');
  assert.throws(() => relayUrl('', loc, 'ws://relay.example.com'), /wss/);
  assert.throws(() => relayUrl('', loc, 'wss://user:password@relay.example.com'), /格式/);
});

test('中继地址：拒绝把 HTTP 地址误当作主机名', () => {
  for (const address of ['https://relay.example.com/relay', 'http://relay.example.com/relay']) {
    assert.throws(() => relayUrl(`?relay=${encodeURIComponent(address)}`, page('https://bytewan.github.io/')), /格式/);
  }
});
