import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inviteUrl } from './invite.ts';

test('局域网邀请同时替换网页和中继的回环地址，并保留自定义端口', () => {
  const u = new URL(inviteUrl('http://localhost:5181/?online&network=lan&relay=ws://localhost:5310&bot#test', 'ABCD', '192.168.1.10'));
  assert.equal(u.host, '192.168.1.10:5181');
  assert.equal(u.searchParams.get('relay'), 'ws://192.168.1.10:5310/');
  assert.equal(u.searchParams.get('network'), 'lan');
  assert.equal(u.searchParams.get('room'), 'ABCD');
  assert.equal(u.searchParams.has('bot'), false);
  assert.equal(u.hash, '');
});
test('公网邀请保留 Pages 路径与指定中继', () => {
  const u = new URL(inviteUrl('https://bytewan.github.io/fengshen-survivors/?relay=wss://example.com/relay&perf', 'ABCD'));
  assert.equal(u.pathname, '/fengshen-survivors/');
  assert.equal(u.searchParams.get('relay'), 'wss://example.com/relay');
  assert.equal(u.searchParams.has('perf'), false);
});
test('问不到内网 IP 时仍保留可用的原地址', () => {
  const u = new URL(inviteUrl('http://192.168.1.10:5181/?network=lan&relay=192.168.1.10:5310', 'ABCD'));
  assert.equal(u.hostname, '192.168.1.10');
  assert.equal(u.searchParams.get('relay'), 'ws://192.168.1.10:5310/');
});
test('公网默认中继的邀请无需增加覆盖参数', () => {
  assert.equal(inviteUrl('https://bytewan.github.io/fengshen-survivors/?online', 'ABCD'), 'https://bytewan.github.io/fengshen-survivors/?room=ABCD');
});

test('浏览器局域网邀请保留直连方式，清除自动建房参数', () => {
  const u = new URL(inviteUrl('https://bytewan.github.io/fengshen-survivors/?network=lan&transport=rtc&create=1', 'ABCD'));
  assert.equal(u.searchParams.get('transport'), 'rtc');
  assert.equal(u.searchParams.get('network'), 'lan');
  assert.equal(u.searchParams.has('create'), false);
});
