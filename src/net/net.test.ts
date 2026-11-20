// 联机客户端逻辑的单元测试（不起网络）：商店指令的检查、房主对名单的处理（掉线托管、回来、退出、中途加入、同名号回来拿回人物）、
// 镜像世界的时序（插值、事件按帧号放、过时的事件、整份重来）和自己人物的预测校正。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, step, type World } from '../sim/world.ts';
import { cleanCommand, HostSide } from './host.ts';
import { Mirror, type StateMsg } from './mirror.ts';
import { fullPatch, diffObj, plain, plainWorld, type PlainObj } from './codec.ts';
import type { Link } from './link.ts';
import type { Member, Slot } from './protocol.ts';

/** 假的连接：名单可以随便改，发出去的消息记下来。 */
function fakeLink(members: Member[], me = 1) {
  const sent: { to?: number; m: Record<string, unknown> }[] = [];
  const link = {
    me,
    host: me,
    members,
    on: () => () => {},
    send: (text: string, to?: number) => sent.push({ to, m: JSON.parse(text) }),
  } as unknown as Link;
  return { link, sent };
}
const member = (id: number, name: string, on = true, order = id): Member => ({ id, name, meta: { hero: 'nezha' }, on, order, host: id === 1 });

test('商店指令：字段的类型、范围不对的不收；player 一律换成发的人', () => {
  assert.deepEqual(cleanCommand({ t: 'buy', player: 3, slot: 2 }, 1), { t: 'buy', player: 1, slot: 2 });
  assert.equal(cleanCommand({ t: 'buy', slot: 99 }, 1), null);
  assert.equal(cleanCommand({ t: 'buy', slot: 1.5 }, 1), null);
  assert.equal(cleanCommand({ t: 'evolve', branch: 'evil' }, 1), null);
  assert.deepEqual(cleanCommand({ t: 'evolve', branch: 'fire' }, 2), { t: 'evolve', player: 2, branch: 'fire' });
  assert.equal(cleanCommand({ t: 'eval', code: 'x' }, 1), null);
  assert.equal(cleanCommand('ready', 1), null);
  assert.deepEqual(cleanCommand({ t: 'ready' }, 0), { t: 'ready', player: 0 });
  assert.deepEqual(cleanCommand({ t: 'give', to: 1, amount: 5 }, 0), { t: 'give', player: 0, to: 1, amount: 5 });
  assert.equal(cleanCommand({ t: 'give', to: 1, amount: -5 }, 0), null);
  assert.equal(cleanCommand({ t: 'learn', id: 'x'.repeat(40) }, 0), null);
});

test('房主对名单：掉线托管、回来取消、退出去掉；打着的时候进来的等商店，商店里加进来；关了页面同名号回来拿回人物', () => {
  const w = createWorld(3, 3);
  const slots: Slot[] = [
    { id: 1, name: '甲', hero: 'nezha' },
    { id: 2, name: '乙', hero: 'nezha' },
    { id: 3, name: '丙', hero: 'nezha' },
  ];
  const members = [member(1, '甲'), member(2, '乙'), member(3, '丙')];
  const { link, sent } = fakeLink(members);
  const host = new HostSide(link, slots, 0);
  assert.deepEqual(host.syncRoster(w), []);
  // 乙掉线 → 托管；回来 → 取消
  members[1].on = false;
  assert.deepEqual(host.syncRoster(w).map((e) => e.t), ['away']);
  assert.equal(w.players[1].away, true);
  assert.deepEqual(host.syncRoster(w), [], '没变就不再发');
  members[1].on = true;
  host.syncRoster(w);
  assert.equal(w.players[1].away, false);
  // 丙退出（名单上没有了）→ 人物离开
  members.splice(2, 1);
  assert.deepEqual(host.syncRoster(w).map((e) => e.t), ['leave']);
  assert.equal(w.players[2].left, true);
  // 打着的时候丁进房：告诉他等商店，不加人物
  members.push(member(4, '丁'));
  host.syncRoster(w);
  assert.equal(w.players.filter((p) => !p.left).length, 2);
  assert.ok(sent.some((s) => s.to === 4 && s.m.t === 'wait' && s.m.why === 'battle'));
  sent.length = 0;
  host.syncRoster(w);
  assert.ok(!sent.some((s) => s.to === 4 && s.m.t === 'wait'), '每人只说一次');
  // 到了商店：丁加进来（复用丙留下的格子），他收到「开局」，所有人收到新的人物分配
  w.phase = 'shop';
  const ev = host.syncRoster(w);
  assert.ok(ev.some((e) => e.t === 'join' && e.owner === 2));
  assert.equal(host.slots[2].id, 4);
  assert.ok(sent.some((s) => s.to === 4 && s.m.t === 'start' && s.m.resume === true));
  assert.ok(sent.some((s) => s.to === undefined && s.m.t === 'slots'));
  // 乙关了页面（掉线），又以新成员（编号 5）同一个名号进来：把乙的人物还给他
  members[1].on = false;
  host.syncRoster(w);
  assert.equal(w.players[1].away, true);
  members.push(member(5, '乙'));
  sent.length = 0;
  host.syncRoster(w);
  assert.equal(host.slots[1].id, 5);
  assert.equal(w.players[1].away, false);
  assert.ok(sent.some((s) => s.to === 5 && s.m.t === 'start'));
});

test('房主：其他人的操作按序号用最新的；神通按次数算，按一次放一次；停了 400 毫秒当松手；托管的由机器人给', async () => {
  const w = createWorld(3, 2);
  const members = [member(1, '甲'), member(2, '乙')];
  let onData: (from: number, text: string) => void = () => {};
  const link = { me: 1, host: 1, members, on: (_e: string, fn: typeof onData) => ((onData = fn), () => {}), send: () => {} } as unknown as Link;
  const host = new HostSide(link, [{ id: 1, name: '甲', hero: 'nezha' }, { id: 2, name: '乙', hero: 'nezha' }], 0);
  onData(2, JSON.stringify({ t: 'in', s: 5, x: 1, y: 0, k: 0 }));
  onData(2, JSON.stringify({ t: 'in', s: 4, x: -1, y: 0, k: 0 })); // 乱序的旧操作：不要
  assert.equal(host.turn(1, w).input.mx, 1);
  onData(2, JSON.stringify({ t: 'in', s: 6, x: 1, y: 0, k: 1 })); // 按了一次神通
  assert.equal(host.turn(1, w).input.skill, true);
  assert.equal(host.turn(1, w).input.skill, false, '只放一次');
  onData(2, JSON.stringify({ t: 'in', s: 7, x: 9, y: -9, k: 1 })); // 越界的方向夹回 -1..1
  assert.deepEqual(host.turn(1, w).input, { mx: 1, my: -1, skill: false });
  await new Promise((r) => setTimeout(r, 450));
  assert.deepEqual(host.turn(1, w).input, { mx: 0, my: 0, skill: false }, '好久没更新：当他松手');
  w.players[1].away = true;
  const t = host.turn(1, w);
  assert.ok(Number.isFinite(t.input.mx), '托管：机器人给操作');
});

/** 房主那边跑一份模拟，每 4 帧出一条状态消息（和 host.flush 同一个格式）。 */
function hostStream(w: World, frames: number) {
  let shadow: PlainObj = {};
  const out: StateMsg[] = [];
  for (let f = 0; f < frames; f++) {
    const ev = step(w, w.players.map(() => ({ mx: 0.5, my: 0, skill: false })));
    if (f % 4) continue;
    const next = plainWorld(w);
    const first = !Object.keys(shadow).length;
    const d = first ? fullPatch(next) : diffObj(shadow, next);
    shadow = next;
    out.push({ k: w.tick, ...(first ? { f: 1 as const } : {}), ...(d ? { d } : {}), e: ev.map((e) => [0, plain(e, 'ev')] as never), a: [0, 0], p: w.players.map((p) => [p.x, p.y] as [number, number]) });
  }
  return out;
}

test('镜像：落后约 6 帧画、alpha 在两份状态之间、整份重来；过时的命中不放、开波这类照放', () => {
  const host = createWorld(9, 2);
  const msgs = hostStream(host, 240);
  const m = new Mirror(createWorld(9, 2), 1);
  // 收到第一份（整份）
  m.receive(msgs[0], 0);
  assert.ok(m.ready);
  // 每 1/15 秒到一份，画面每 1/60 秒推一次
  let t = 0;
  let next = 1;
  const alphas: number[] = [];
  for (let frame = 0; frame < 200; frame++) {
    t += 1000 / 60;
    while (next < msgs.length && next * (1000 / 15) <= t) m.receive(msgs[next++], t);
    m.advance(1 / 60);
    alphas.push(m.alpha);
  }
  assert.ok(m.lag >= 3 && m.lag <= 12, `画面落后 ${m.lag} 帧`);
  const mid = alphas.slice(60).filter((a) => a > 0.05 && a < 0.95).length;
  assert.ok(mid > 40, `插值真的在两份之间（${mid} 帧的 alpha 在 0..1 中间）`);
  // 过时的事件：手动塞一份很久以前的「命中」和「开波」，追上来时命中不放、开波照放
  const m2 = new Mirror(createWorld(9, 2), 1);
  m2.receive(msgs[0], 0);
  const late: StateMsg = { ...msgs[1], k: msgs[1].k + 600, d: {}, e: [[590, { t: 'hit', id: 1, kind: 'soldier', x: 0, y: 0, dmg: 1, crit: false, by: 'ring' } as never], [590, { t: 'waveStart', wave: 2, duration: 20 } as never]] };
  m2.receive(late, 0);
  const got = m2.advance(1 / 60);
  assert.deepEqual(got.map((e) => e.t), ['waveStart']);
  // 整份重来：缓冲清空，画的时刻跳到整份那一帧
  const key: StateMsg = { ...msgs[5], f: 1, d: fullPatch(plainWorld(host)) };
  m2.receive(key, 0);
  assert.equal(m2.queued, 0);
});

test('镜像：自己的人物按本地操作预走，房主的位置一到就拉回去，最后对上', () => {
  const w = createWorld(4, 2);
  const m = new Mirror(createWorld(4, 2), 1);
  const base = plainWorld(w);
  m.receive({ k: w.tick, f: 1, d: fullPatch(base), a: [0, 0], p: w.players.map((p) => [p.x, p.y]) }, 0);
  m.advance(1 / 60);
  const x0 = w.players[1].x;
  // 本地往右推 30 帧（序号 1）
  for (let i = 0; i < 30; i++) m.predict({ mx: 1, my: 0, skill: false }, 1 / 60, 1);
  const predicted = m.world.players[1].x;
  assert.ok(predicted > x0 + 30, `预走了（${(predicted - x0).toFixed(1)} 像素）`);
  // 房主说：序号 1 已经处理完，人在 x0 + 20（比本地少走一截，比如被墙挡住）
  m.receive({ k: w.tick + 4, d: {}, a: [0, 1], p: [[w.players[0].x, w.players[0].y], [x0 + 20, w.players[1].y]] }, 100);
  for (let i = 0; i < 12; i++) {
    m.receive({ k: w.tick + 8 + i * 4, d: {}, a: [0, 1], p: [[w.players[0].x, w.players[0].y], [x0 + 20, w.players[1].y]] }, 100 + i);
    m.predict({ mx: 0, my: 0, skill: false }, 1 / 60, 2);
  }
  assert.ok(Math.abs(m.world.players[1].x - (x0 + 20)) < 1, `拉回到房主的位置（差 ${(m.world.players[1].x - (x0 + 20)).toFixed(2)}）`);
});
