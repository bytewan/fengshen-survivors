// 功法的数值对照：机器人打完整的一局（同 tools/balance.ts 的打法与种子），比较「有功法 / 没有功法 / 只悟某一门」
// 的通关率、首领战时长、每秒伤害、掉血，以及每门功法被挑中几次、各自触发了多少次。
// 用法：node tools/technique-balance.ts [局数] [--no-tech] [--only <功法 id>] [--each] [--seed <起始种子>]
//   --no-tech：到了门槛也不悟（三选一出了就扔掉），作为对照；
//   --only X：第一次到门槛（第 3 级）就悟 X，之后不再悟别的 —— 量单门功法的分量；
//   --each：没有功法 + 12 门各自 --only，各跑一遍，列一张表（慢：13 × 局数）。
import { createWorld, step, type SimEvent, type World } from '../src/sim/world.ts';
import { botInput, botShop } from '../src/sim/bot.ts';
import { botLootPull } from '../src/sim/bot-loot.ts';
import { DT } from '../src/sim/config.ts';
import { isBossWave, chapterOf } from '../src/sim/catalog.ts';
import { TECHNIQUES, TECH_IDS } from '../src/sim/techniques.ts';
import type { PlayerInput, TechniqueId } from '../src/sim/types.ts';

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const runs = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 20);
const seed0 = Number(arg('--seed') ?? 2000);
const LOOT_SCALE = 0.03; // 同 tools/balance.ts

type Mode = { kind: 'all' } | { kind: 'none' } | { kind: 'only'; id: TechniqueId };

interface RunResult {
  win: boolean;
  wave: number;
  level: number;
  techs: TechniqueId[];
  boss: { chapter: number; secs: number; won: boolean }[]; // 每场首领战：打了多久、赢没赢
  dmg: Record<'c1' | 'c2' | 'c3' | 'boss', [number, number]>; // [伤害合计, 秒数]
  lost: number[]; // 普通波每波掉血（按最大气血的比例）
  fx: Record<string, number>; // 功法触发次数
}

function play(seed: number, mode: Mode): RunResult {
  const w: World = createWorld(seed);
  const p = w.players[0];
  const res: RunResult = { win: false, wave: 0, level: 0, techs: [], boss: [], dmg: { c1: [0, 0], c2: [0, 0], c3: [0, 0], boss: [0, 0] }, lost: [], fx: {} };
  let bossT = -1;
  let waveLost = 0;
  let ticks = 0;
  while (w.phase !== 'over' && w.phase !== 'win' && ticks < 60 * 60 * 40) {
    if (w.phase === 'shop' && p.techOffer) {
      if (mode.kind === 'none' || (mode.kind === 'only' && p.techs.length)) p.techOffer = null;
      else if (mode.kind === 'only') p.techOffer = [mode.id];
    }
    const cmds = w.phase === 'shop' ? botShop(w, 0) : [];
    let inp: PlayerInput = botInput(w, 0);
    const [lx, ly] = botLootPull(w, 0);
    if (lx || ly) {
      const mx = inp.mx * LOOT_SCALE + lx;
      const my = inp.my * LOOT_SCALE + ly;
      const m = Math.hypot(mx, my) || 1;
      inp = { ...inp, mx: mx / m, my: my / m };
    }
    const phase = w.phase;
    const boss = isBossWave(w.wave);
    const ev: SimEvent[] = step(w, [inp], cmds);
    ticks++;
    if (phase === 'wave') {
      const key = boss ? 'boss' : (`c${Math.min(3, chapterOf(w.wave))}` as 'c1' | 'c2' | 'c3');
      res.dmg[key][1] += DT;
      for (const e of ev) {
        if (e.t === 'hit') res.dmg[key][0] += e.dmg;
        if (e.t === 'hurt' && e.owner === 0) waveLost += e.dmg / p.stats.maxHp;
        if (e.t === 'corrode' && e.owner === 0) waveLost += e.dmg / p.stats.maxHp;
        if (e.t === 'tech') res.fx[`${e.kind}${e.act ? '.' + e.act : ''}`] = (res.fx[`${e.kind}${e.act ? '.' + e.act : ''}`] ?? 0) + 1;
      }
      if (boss && bossT < 0) bossT = w.time - DT;
    }
    for (const e of ev) {
      if (e.t === 'waveEnd' && !boss) {
        res.lost.push(waveLost);
        waveLost = 0;
      }
      if ((e.t === 'chapterClear' || e.t === 'win') && bossT >= 0) {
        res.boss.push({ chapter: chapterOf(w.wave), secs: w.time - bossT, won: true });
        bossT = -1;
        waveLost = 0;
      }
      if (e.t === 'over' && bossT >= 0) {
        res.boss.push({ chapter: chapterOf(w.wave), secs: w.time - bossT, won: false });
        bossT = -1;
      }
    }
  }
  res.win = w.phase === 'win';
  res.wave = w.wave;
  res.level = p.level;
  res.techs = [...p.techs];
  return res;
}

const med = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : NaN);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pct = (v: number) => `${Math.round(v * 100)}%`;

function batch(mode: Mode) {
  const rs: RunResult[] = [];
  for (let r = 0; r < runs; r++) rs.push(play(seed0 + r, mode));
  return rs;
}

function summary(rs: RunResult[]) {
  const dps = (k: 'c1' | 'c2' | 'c3' | 'boss') => {
    const d = rs.reduce((a, r) => a + r.dmg[k][0], 0);
    const t = rs.reduce((a, r) => a + r.dmg[k][1], 0);
    return t > 0 ? d / t : NaN;
  };
  const boss = (ch: number) => {
    const fights = rs.flatMap((r) => r.boss.filter((b) => b.chapter === ch));
    const won = fights.filter((b) => b.won);
    return { n: fights.length, won: won.length, secs: med(won.map((b) => b.secs)), mean: avg(won.map((b) => b.secs)) };
  };
  return {
    wins: rs.filter((r) => r.win).length,
    wave: med(rs.map((r) => r.wave)),
    level: med(rs.map((r) => r.level)),
    b1: boss(1),
    b2: boss(2),
    b3: boss(3),
    dps: { c1: dps('c1'), c2: dps('c2'), c3: dps('c3'), boss: dps('boss') },
    lost: avg(rs.flatMap((r) => r.lost)),
  };
}

const fmtBoss = (b: { n: number; won: number; secs: number; mean: number }) => (b.n ? `${b.won}/${b.n} 胜 ${Number.isNaN(b.secs) ? '—' : `${b.secs.toFixed(0)}s`}` : '—');

if (process.argv.includes('--each')) {
  const modes: [string, Mode][] = [['没有功法', { kind: 'none' }], ...TECH_IDS.map((id) => [TECHNIQUES[id].name, { kind: 'only', id }] as [string, Mode])];
  console.log(`runs=${runs}（每行一种：第 3 级悟这一门，之后不再悟；首领战时长取打赢的中位数）`);
  console.log('功法          通关   第几波  等级   首领一          首领二          首领三          每秒伤害 一章/二章/三章/首领   普通波每波掉血');
  for (const [name, mode] of modes) {
    const s = summary(batch(mode));
    console.log(
      `${name.padEnd(8, '　')}  ${String(s.wins).padStart(2)}/${runs}  ${String(s.wave).padStart(4)}  ${String(s.level).padStart(4)}   ${fmtBoss(s.b1).padEnd(14)}  ${fmtBoss(s.b2).padEnd(14)}  ${fmtBoss(s.b3).padEnd(14)}  ${[s.dps.c1, s.dps.c2, s.dps.c3, s.dps.boss].map((v) => (Number.isNaN(v) ? '—' : v.toFixed(0))).join(' / ').padEnd(22)}  ${pct(s.lost)}`,
    );
  }
} else {
  const mode: Mode = process.argv.includes('--no-tech') ? { kind: 'none' } : arg('--only') ? { kind: 'only', id: arg('--only') as TechniqueId } : { kind: 'all' };
  const rs = batch(mode);
  const s = summary(rs);
  console.log(`runs=${runs} 种子 ${seed0}–${seed0 + runs - 1}  ${mode.kind === 'none' ? '（不悟功法）' : mode.kind === 'only' ? `（只悟 ${TECHNIQUES[mode.id].name}）` : '（机器人按构筑悟功法）'}`);
  console.log(`通关 ${s.wins}/${runs}  打到第几波（中位数）${s.wave}  等级中位数 ${s.level}`);
  console.log(`首领战（打赢的那几场，时长中位数 / 平均）：一章 ${fmtBoss(s.b1)}（平均 ${s.b1.mean.toFixed(0)}s）  二章 ${fmtBoss(s.b2)}（平均 ${s.b2.mean.toFixed(0)}s）  三章 ${fmtBoss(s.b3)}（平均 ${s.b3.mean.toFixed(0)}s）`);
  console.log(`每秒伤害（跳字合计 / 战斗秒数）：第一章普通波 ${s.dps.c1.toFixed(0)}  第二章 ${s.dps.c2.toFixed(0)}  第三章 ${s.dps.c3.toFixed(0)}  首领战 ${s.dps.boss.toFixed(0)}；普通波每波掉血平均 ${pct(s.lost)}`);
  if (mode.kind !== 'none') {
    const picks: Record<string, number> = {};
    for (const r of rs) r.techs.forEach((id, i) => (picks[id] = (picks[id] ?? 0) + 1 + i * 0));
    console.log(`悟了几门（中位数）${med(rs.map((r) => r.techs.length))}；被挑中的次数：${Object.entries(picks).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${TECHNIQUES[k as TechniqueId].name} ${v}`).join('，')}`);
    const fx: Record<string, number> = {};
    for (const r of rs) for (const [k, v] of Object.entries(r.fx)) fx[k] = (fx[k] ?? 0) + v;
    console.log(`每局触发（平均）：${Object.entries(fx).map(([k, v]) => `${k} ${(v / runs).toFixed(1)}`).join('，')}`);
    console.log('前 6 局：');
    for (const r of rs.slice(0, 6)) console.log(`  ${r.win ? '通关' : `第${r.wave}波阵亡`}  Lv${r.level}  ${r.techs.map((id) => TECHNIQUES[id].name).join('、') || '（没有功法）'}`);
  }
}
