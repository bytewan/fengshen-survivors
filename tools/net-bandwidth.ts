// 带宽：N 个人的机器人局（房主权威那一份模拟），每 4 帧编一次状态消息（和 net/host.ts 的 flush 同一个格式），
// 按「发给一个人」算每秒多少字节；逐波列出平均和最大，看事件和状态各占多少。
// 用法：node tools/net-bandwidth.ts [人数] [最多打到第几波] [种子]（结果写在 docs/netcode.md「带宽与延迟」）。
// 环境变量 ZL / ZW / ZM 改压缩的等级、窗口、内存（默认 3 / 15 / 8，中继用的是 3 / 15 / 7）。
import { createWorld, step, type SimEvent } from '../src/sim/world.ts';
import { botInput, botShop } from '../src/sim/bot.ts';
import { diffObj, fullPatch, plain, plainWorld, type PlainObj } from '../src/net/codec.ts';
import zlib from 'node:zlib';

// WebSocket 的 permessage-deflate（保留上下文）：一条持续的 deflate 流，每条消息 sync flush 一次
const def = zlib.createDeflateRaw({ level: Number(process.env.ZL ?? 3), windowBits: Number(process.env.ZW ?? 15), memLevel: Number(process.env.ZM ?? 8) });
const chunks: Buffer[] = [];
def.on('data', (c: Buffer) => chunks.push(c));
function zsize(s: string): Promise<number> {
  return new Promise((r) => {
    def.write(Buffer.from(s));
    def.flush(zlib.constants.Z_SYNC_FLUSH, () => {
      const n = chunks.reduce((a, c) => a + c.length, 0);
      chunks.length = 0;
      r(n);
    });
  });
}
let zTotal = 0;
let zPeak = 0;
const zByWave: Record<string, { n: number; z: number }> = {};

const N = Number(process.argv[2] ?? 4);
const MAXW = Number(process.argv[3] ?? 18);
const seed = Number(process.argv[4] ?? 5);
const w = createWorld(seed, N);
let shadow: PlainObj = {};
let evs: { tick: number; ev: SimEvent }[] = [];
const rows: Record<string, { n: number; st: number; ev: number; max: number; enemies: number; secs: number }> = {};
let shopT = 0;
let first = true;
for (let f = 0; f < 60 * 60 * 40 && w.phase !== 'over' && w.phase !== 'win' && w.wave <= MAXW; f++) {
  const shop = w.phase === 'shop';
  shopT = shop ? shopT + 1 : 0;
  const cmds = shop && shopT % 20 === 0 ? w.players.flatMap((_, i) => botShop(w, i)) : [];
  const ev = step(w, w.players.map((_, i) => (shop ? { mx: 0, my: 0, skill: false } : botInput(w, i, 0.7))), cmds);
  for (const e of ev) evs.push({ tick: w.tick, ev: e });
  if (f % 4) continue;
  const next = plainWorld(w);
  const d = first ? fullPatch(next) : diffObj(shadow, next);
  first = false;
  shadow = next;
  const e = evs.map(({ tick, ev }) => [w.tick - tick, plain(ev, 'ev')]);
  evs = [];
  const a = w.players.map(() => 0);
  const p = w.players.map((pl) => [Math.round(pl.x * 100) / 100, Math.round(pl.y * 100) / 100]);
  const msg = JSON.stringify({ t: 'st', k: w.tick, a, p, ...(d ? { d } : {}), ...(e.length ? { e } : {}) });
  const evLen = e.length ? JSON.stringify(e).length : 0;
  const z = await zsize(msg);
  zTotal += z;
  const key = `${String(w.wave).padStart(2)} ${w.phase === 'wave' ? (w.boss ? '首领' : '战斗') : w.phase}`;
  const r = (rows[key] ??= { n: 0, st: 0, ev: 0, max: 0, enemies: 0, secs: 0 });
  r.n++;
  r.st += msg.length - evLen;
  r.ev += evLen;
  r.max = Math.max(r.max, msg.length);
  r.enemies = Math.max(r.enemies, w.enemies.length);
  const zr = (zByWave[key] ??= { n: 0, z: 0 });
  zr.n++;
  zr.z += z;
}
console.log(`${N} 人、种子 ${seed}，打到第 ${w.wave} 波（${w.phase}）。每一行：发给一个人的平均 KB/s（状态 + 事件）、最大一条、场上最多几只敌人`);
let tot = 0;
let totN = 0;
let peak = 0;
for (const [k, r] of Object.entries(rows)) {
  const kbs = ((r.st + r.ev) / r.n) * 15 / 1024;
  if (k.includes('战斗') || k.includes('首领')) peak = Math.max(peak, kbs);
  tot += r.st + r.ev;
  totN += r.n;
  console.log(`第 ${k}：${kbs.toFixed(1)} KB/s（状态 ${((r.st / r.n) * 15 / 1024).toFixed(1)} + 事件 ${((r.ev / r.n) * 15 / 1024).toFixed(1)}），最大一条 ${(r.max / 1024).toFixed(1)} KB，敌人最多 ${r.enemies}`);
}
for (const [k, r] of Object.entries(zByWave)) if (k.includes('战斗') || k.includes('首领')) zPeak = Math.max(zPeak, (r.z / r.n) * 15 / 1024);
console.log(`压缩（permessage-deflate，保留上下文）之后：整局平均 ${((zTotal / totN) * 15 / 1024).toFixed(1)} KB/s，战斗波里最高 ${zPeak.toFixed(1)} KB/s`);
console.log(`整局平均 ${((tot / totN) * 15 / 1024).toFixed(1)} KB/s（发给一个人；房主的上行 × (人数 − 1)），战斗波里最高 ${peak.toFixed(1)} KB/s`);
