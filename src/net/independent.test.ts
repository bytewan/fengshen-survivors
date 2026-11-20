import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, step } from '../sim/world.ts';
import { decodePatch, diffObj, fullPatch, plainWorld, type PlainObj } from './codec.ts';
import { Mirror } from './mirror.ts';
import { GuestSide } from './guest.ts';
import { HostSide } from './host.ts';
import type { Link } from './link.ts';

const message = (w: ReturnType<typeof createWorld>, n: number, b: number, d: PlainObj, f?: 1) => ({ k: w.tick, n, b, d, f, a: [0, 0], p: w.players.map(p => [p.x, p.y] as [number, number]) });

test('独立差量复制变化分支，包含位置、删除、嵌套和数组两端，基线永不修改', () => {
  const a: PlainObj = { enemies: [{ id: 1, x: 10, y: 20, hp: 5 }, { id: 2, x: 2, y: 3 }], pet: { x: 2, y: 1, kind: 'a' }, tail: [1, 2, 3, 4, 5], keep: { value: 1 } };
  const b: PlainObj = { enemies: [{ id: 1, x: 12.3, y: 21, hp: 4 }, { id: 3, x: 0, y: 0 }], pet: { x: 3, y: 1 }, tail: [2, 3, 4, 5, 6], keep: { value: 1 } };
  const saved = structuredClone(a), result = decodePatch(a, diffObj(a, b)!);
  assert.deepEqual(result, b); assert.deepEqual(a, saved);
  assert.equal(result.keep, a.keep, '未变化分支不复制');
});

test('漏掉中间快照、乱序和重复包后，已确认基线仍可解出完整新状态', () => {
  const w = createWorld(7, 2), m = new Mirror(createWorld(7, 2), 1);
  const base = plainWorld(w); m.receive(message(w, 1, 0, fullPatch(base), 1), 0);
  for (let i = 0; i < 3; i++) step(w, w.players.map(() => ({ mx: 1, my: 0, skill: false })));
  const dropped = message(w, 2, 1, diffObj(base, plainWorld(w))!);
  for (let i = 0; i < 3; i++) step(w, w.players.map(() => ({ mx: 1, my: 0, skill: false })));
  const latest = message(w, 3, 1, diffObj(base, plainWorld(w))!);
  m.receive(latest, 150); m.receive(dropped, 151); m.receive(latest, 152);
  for (let i = 0; i < 20; i++) m.advance(1 / 60);
  assert.equal(m.waitingKey, false); assert.equal(m.ack, 3);
  assert.equal(m.world.tick, w.tick); assert.equal(m.world.players[1].x, (plainWorld(w).players as PlainObj[])[1].x);
  assert.ok(m.dropped > 0);
});

test('缺失 ACK 基线要求补全，不把差量套在错误的世界上', () => {
  const w = createWorld(7, 2), m = new Mirror(w, 1);
  m.receive(message(w, 1, 0, fullPatch(plainWorld(w)), 1), 0);
  m.receive(message(w, 3, 999, { phase: 'over' }), 50);
  assert.equal(m.waitingKey, true); assert.notEqual(m.world.phase, 'over');
});

test('独立显示快照积压合并，可靠事件不随过时快照一起丢弃', () => {
  const w = createWorld(7, 2), m = new Mirror(w, 1), base = plainWorld(w);
  m.receive(message(w, 1, 0, fullPatch(base), 1), 0);
  m.receiveEvents(1, 6, [[0, { t: 'waveStart', wave: 2, duration: 20 }]]);
  m.receiveEvents(1, 6, [[0, { t: 'waveStart', wave: 2, duration: 20 }]]);
  for (let n = 2; n <= 12; n++) { w.tick += 3; m.receive(message(w, n, 1, diffObj(base, plainWorld(w))!), 550); }
  const events = m.advance(1 / 60);
  assert.equal(events.filter(e => e.t === 'waveStart').length, 1);
  assert.ok(m.dropped >= 5); assert.ok(m.queued <= 4);
  assert.ok(m.bufferMs >= 100 && m.bufferMs <= 200);
});

test('短时断包外推至多100ms，还原后基线及玩家伤害数据不被显示预测改变', () => {
  const w = createWorld(7, 2), m = new Mirror(w, 1), base = plainWorld(w);
  w.enemies.push({ id: 500, x: 20, y: 20, hp: 5 } as never);
  const first = plainWorld(w); m.receive(message(w, 1, 0, fullPatch(first), 1), 0);
  w.tick = 3; w.enemies[0].x = 23;
  m.receive(message(w, 2, 1, diffObj(first, plainWorld(w))!), 50);
  let furthest = 0;
  for (let i = 0; i < 90; i++) { m.advance(1 / 60); furthest = Math.max(furthest, m.world.enemies[0].x); assert.ok(m.extrapolated <= 100.0001); }
  assert.ok(furthest > 23, '空窗里仍有短时连续运动'); assert.ok(furthest <= 29.01, '外推有界');
  assert.equal(m.world.enemies[0].hp, 5);
  w.tick = 6; w.enemies[0].x = 24;
  m.receive(message(w, 3, 1, diffObj(first, plainWorld(w))!), 1600);
  assert.equal(m.waitingKey, false); assert.equal(m.ack, 3);
  assert.equal((base.players as PlainObj[])[1].hp, w.players[1].hp);
});

test('三名队友共用最慢已确认基线，事件与状态每轮仅各上传一份', () => {
  const w = createWorld(7, 4), sent: any[] = [];
  let onData = (_from: number, _text: string) => {};
  const slots = w.players.map((p, i) => ({ id: i + 1, name: String(i), hero: p.hero }));
  const members = slots.map(s => ({ ...s, on: true, host: s.id === 1, order: s.id, meta: { v: 5 } }));
  const link = { me: 1, host: 1, members, on: (_ev: string, fn: typeof onData) => { onData = fn; return () => {}; }, send: (text: string, to?: number, transient?: boolean) => sent.push({ m: JSON.parse(text), to, transient }) } as unknown as Link;
  const host = new HostSide(link, slots, 0); host.seed = 7;
  host.flush(w, true); const n = sent.find(s => s.m.t === 'st').m.n;
  for (const id of [2, 3, 4]) onData(id, JSON.stringify({ t: 'in', r: 7, s: 1, x: 0, y: 0, k: 0, ack: n }));
  sent.length = 0; w.tick += 3; host.record([{ t: 'waveStart', wave: 1, duration: 20 }], w.tick); host.flush(w, true);
  assert.equal(sent.length, 2); assert.equal(sent[0].m.t, 'ev'); assert.equal(sent[1].m.b, n);
  assert.equal(sent[1].transient, true); assert.ok(sent.every(s => s.to === undefined));
  host.dispose();
});


test('尚未发送的转向归到下一份输入，旧 ACK 不撤销本地最新操作', () => {
  let now = 0; const clock = mock.method(performance, 'now', () => now);
  try {
    const w = createWorld(7, 2), m = new Mirror(w, 1), initial = plainWorld(w);
    m.receive(message(w, 1, 0, fullPatch(initial), 1), 0);
    const link = { on: () => () => {}, send: () => {} } as unknown as Link;
    const guest = new GuestSide(link, m);
    const first = guest.tickInput({ mx: 1, my: 0, skill: false });
    m.predict({ mx: 1, my: 0, skill: false }, 1 / 60, first);
    const processed = m.world.players[1].x, y = m.world.players[1].y;
    now = 16;
    const pending = guest.tickInput({ mx: -1, my: 0, skill: false });
    assert.equal(pending, first + 1);
    m.predict({ mx: -1, my: 0, skill: false }, 1 / 60, pending);
    m.receive({ k: 3, n: 2, b: 1, d: {}, a: [0, first], p: [[0, 0], [processed, y]] }, 20);
    m.predict({ mx: 0, my: 0, skill: false }, 0, pending);
    assert.ok(m.predError < 0.001, '旧 ACK 只确认已发送输入，未发送转向仍保留');
    guest.dispose();
  } finally { clock.mock.restore(); }
});
