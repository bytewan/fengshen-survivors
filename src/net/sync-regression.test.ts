import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, step } from '../sim/world.ts';
import { fullPatch, plainWorld } from './codec.ts';
import { Mirror } from './mirror.ts';
import { GuestSide } from './guest.ts';
import { HostSide } from './host.ts';
import type { Link } from './link.ts';

function connection(me = 1) {
  const sent: any[] = [];
  let data = (_from: number, _text: string) => {};
  const link = { me, host: 1, members: [], on: (_event: string, fn: typeof data) => { data = fn; return () => {}; }, send: (s: string) => sent.push(JSON.parse(s)) } as unknown as Link;
  return { link, sent, receive: (from: number, m: object) => data(from, JSON.stringify(m)) };
}
const slots = [{ id: 1, name: '甲', hero: 'nezha' as const }, { id: 2, name: '乙', hero: 'yangjian' as const }];
const key = (w: ReturnType<typeof createWorld>, extra = {}) => ({ t: 'st', k: w.tick, f: 1 as const, d: fullPatch(plainWorld(w)), a: [0, 0], p: w.players.map(p => [p.x, p.y] as [number, number]), ...extra });

test('暂停后补全状态只发一次请求，整份到达时立即清除积压统计', () => {
  const w = createWorld(1, 2), mirror = new Mirror(w, 1);
  const c = connection(2), guest = new GuestSide(c.link, mirror);
  c.receive(1, key(w));
  for (let i = 1; i <= 100; i++) { c.receive(1, { t: 'st', k: i * 4, d: {}, a: [0, 0], p: [] }); mirror.advance(0, true); }
  for (let i = 101; i <= 110; i++) c.receive(1, { t: 'st', k: i * 4, d: {}, a: [0, 0], p: [] });
  assert.equal(c.sent.filter(m => m.t === 'sync').length, 1);
  w.tick = 444; c.receive(1, key(w));
  assert.equal(mirror.queued, 0);
  assert.equal(mirror.waitingKey, false);
  guest.dispose();
});

test('同一模拟帧结束游戏也必须应用阶段变化', () => {
  const w = createWorld(1, 2), m = new Mirror(w, 1);
  m.receive(key(w, { n: 1 }), 0);
  m.receive({ k: w.tick, n: 2, d: { phase: 'over' }, a: [0, 0], p: [], e: [[0, { t: 'over' }]] }, 67);
  const ev = m.advance(1 / 60);
  assert.equal(m.world.phase, 'over');
  assert.equal(ev[0]?.t, 'over');
});

test('商店指令结果立即显示，不经过战斗插值缓冲', () => {
  const w = createWorld(1, 2); w.phase = 'shop';
  const m = new Mirror(w, 1); m.receive(key(w), 0);
  m.receive({ k: 4, d: { players: { '#': [[1, { lingshi: 123 }]] } }, a: [0, 0], p: [] }, 67);
  m.receive({ k: 8, d: { players: { '#': [[1, { lingshi: 124 }]] } }, a: [0, 0], p: [] }, 134);
  m.advance(1 / 120);
  assert.equal(m.world.players[1].lingshi, 124);
});

test('刷新重入的队友从低序号开始，房主不沿用旧输入序号', () => {
  const c = connection(), host = new HostSide(c.link, slots, 0), w = createWorld(1, 2);
  c.receive(2, { t: 'in', s: 900, x: 1, y: 0, k: 0 }); host.turn(1, w);
  c.receive(2, { t: 'hello' });
  c.receive(2, { t: 'in', s: 1, x: -1, y: 0, k: 0 });
  assert.equal(host.turn(1, w).input.mx, -1);
});

test('房主只确认已交给模拟的输入，重开后清除旧输入和旧商店命令', () => {
  const c = connection(), host = new HostSide(c.link, slots, 0), w = createWorld(1, 2);
  c.receive(2, { t: 'in', s: 9, x: 1, y: 0, k: 0 }); host.flush(w, true);
  assert.equal(c.sent.at(-1).a[1], 0);
  const turn = host.turn(1, w); step(w, [{ mx: 0, my: 0, skill: false }, turn.input]); host.flush(w, true);
  assert.equal(c.sent.at(-1).a[1], 9);
  c.receive(2, { t: 'cmd', c: { t: 'ready' } }); host.restart();
  assert.equal(host.turn(1, w).input.mx, 0);
  assert.deepEqual(host.takeCommands(), []);
});


test('再战隔离旧局数据，新局序号归零仍能移动和选天赋', () => {
  const c = connection(), host = new HostSide(c.link, slots, 0), w = createWorld(20, 2);
  host.seed = 10; c.receive(2, { t: 'in', r: 10, s: 900, x: 1, y: 0, k: 0 });
  host.seed = 20; host.restart();
  c.receive(2, { t: 'in', r: 10, s: 901, x: -1, y: 0, k: 1 });
  c.receive(2, { t: 'cmd', r: 10, c: { t: 'ready' } });
  c.receive(2, { t: 'in', r: 20, s: 1, x: 1, y: 0, k: 0 });
  c.receive(2, { t: 'cmd', r: 20, c: { t: 'pick', index: 1 } });
  assert.equal(host.turn(1, w).input.mx, 1);
  assert.deepEqual(host.takeCommands(), [{ t: 'pick', player: 1, index: 1 }]);
  const g = connection(2), mirror = new Mirror(w, 1), guest = new GuestSide(g.link, mirror);
  guest.beginRun(20); g.receive(1, key(w, { r: 10, n: 900 })); assert.equal(mirror.ready, false);
  g.receive(1, key(w, { r: 20, n: 901 })); assert.equal(mirror.ready, true);
  guest.dispose();
});

test('网络突发只校正最新位置，补全状态保留未确认的本地移动', () => {
  const w = createWorld(1, 2), m = new Mirror(w, 1), x0 = w.players[1].x, y = w.players[1].y;
  m.receive(key(w), 0);
  for (let i = 0; i < 20; i++) m.predict({ mx: 1, my: 0, skill: false }, 1 / 60, i + 1);
  const predicted = m.world.players[1].x;
  for (let i = 1; i <= 10; i++) m.receive({ k: i * 4, d: {}, a: [0, i], p: [[0, 0], [x0 + i * 82 / 60, y]] }, 300);
  m.advance(1 / 60); m.predict({ mx: 0, my: 0, skill: false }, 0, 21);
  assert.ok(Math.abs(m.world.players[1].x - predicted) < 0.1, '过时的位置不参与回拉');
  m.resync();
  w.players[1].x = x0 + 10 * 82 / 60; w.tick = 44;
  m.receive({ ...key(w), a: [0, 10] }, 350);
  m.predict({ mx: 0, my: 0, skill: false }, 0, 21);
  assert.ok(Math.abs(m.world.players[1].x - predicted) < 0.1, '补全不把人拉回已确认位置');
});


test('快速连续变向不能突破每秒 30 份输入的限额', (t) => {
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const w = createWorld(1, 2), c = connection(2), guest = new GuestSide(c.link, new Mirror(w, 1));
  for (let frame = 0; frame < 120; frame++) {
    now = frame * 1000 / 120;
    guest.tickInput({ mx: frame % 2 ? -1 : 1, my: 0, skill: frame % 10 === 0 });
  }
  const inputs = c.sent.filter(m => m.t === 'in');
  assert.ok(inputs.length <= 30, `实际发送 ${inputs.length} 份`);
  assert.ok(inputs.at(-1).k >= 11, '神通次数随操作传送，不因限频丢失');
  guest.dispose();
});


test('差量传输序号缺口立即请求补全，不能默默丢状态', () => {
  const w = createWorld(1, 2), c = connection(2), m = new Mirror(w, 1), g = new GuestSide(c.link, m);
  c.receive(1, key(w, { n: 10 }));
  c.receive(1, { t: 'st', n: 12, k: 8, d: { phase: 'shop' }, a: [], p: [] });
  assert.equal(m.waitingKey, true);
  assert.equal(c.sent.filter(m => m.t === 'sync').length, 1);
  g.dispose();
});

test('小幅位置校正平滑消化，不在消息到达时突然跳步', () => {
  const w = createWorld(1, 2), m = new Mirror(w, 1), x = w.players[1].x, y = w.players[1].y;
  m.receive(key(w), 0);
  m.predict({ mx: 0, my: 0, skill: false }, 0, 1);
  m.receive({ k: 4, d: {}, a: [0, 1], p: [[0, 0], [x - 20, y]] }, 67);
  m.predict({ mx: 0, my: 0, skill: false }, 1 / 60, 2);
  const first = m.world.players[1].x;
  assert.ok(x - first > 0 && x - first < 6, '一次 20 像素的校正分散到多帧');
  for (let i = 0; i < 30; i++) m.predict({ mx: 0, my: 0, skill: false }, 1 / 60, 2);
  assert.ok(Math.abs(m.world.players[1].x - (x - 20)) < 0.01, '平滑不是持续偏离权威位置');
});


test('突发积压追到合理缓冲位置，不花数秒逐帧追赶', () => {
  const w = createWorld(1, 2), m = new Mirror(w, 1); m.receive(key(w), 0);
  for (let i = 1; i <= 8; i++) m.receive({ k: i * 4, d: {}, a: [], p: [] }, 400);
  m.advance(1 / 60);
  assert.ok(m.lag <= 18, `积压后落后 ${m.lag} 帧`);
});

test('仅恢复中继连接时保留房主迁移存档', () => {
  const c = connection(), host = new HostSide(c.link, slots, 0), w = createWorld(1, 2);
  host.save(w, 1); host.restart(false); c.sent.length = 0;
  c.receive(2, { t: 'sync' });
  assert.ok(c.sent.some(m => m.t === 'save'));
});
