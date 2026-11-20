// 等级分布：机器人打完整的一局，记下每次进商店时的等级 —— 定「到了第几级给什么」（功法、混天绫进化）用。
// 用法：node tools/levels.ts [局数] [门槛，如 3,8,12,14 …]
//   不给门槛就看现在的功法门槛（techniques.TECH_LEVELS）；可以给几组候选一起比。
//   报：各波后商店里的等级（中位、最低的一成、最高的一成）；每个门槛在第几波后的商店够到、之后还剩几波可用、
//   打到最后一个商店都没够到的局数；悟功法和宠物进化撞在同一次商店的比例。
// 经验曲线是 (等级 + 3)²（catalog.xpToNext），灵石就是经验：等级主要看一局能捡到多少灵石，改了刷怪、掉落、收灵之后要重量。
import { createWorld, step, type World } from '../src/sim/world.ts';
import { botInput, botShop } from '../src/sim/bot.ts';
import { TOTAL_WAVES } from '../src/sim/catalog.ts';
import { PET_LEVELS } from '../src/sim/shop.ts';
import { TECH_LEVELS } from '../src/sim/techniques.ts';

const args = process.argv.slice(2);
const runs = Number(args.find((a) => /^\d+$/.test(a)) ?? 40);
const sets = args.filter((a) => /^\d+(,\d+)+$/.test(a)).map((a) => a.split(',').map(Number));
if (!sets.length) sets.push(TECH_LEVELS);
const LAST = TOTAL_WAVES - 1; // 最后一个商店：最终首领之前

/** 每局：第 n 波后的商店里是几级（下标 n；没打到的是 undefined）。 */
const games: number[][] = [];
let wins = 0;
for (let r = 0; r < runs; r++) {
  const w: World = createWorld(2000 + r);
  const p = w.players[0];
  const lv: number[] = [];
  let seen = -1;
  for (let ticks = 0; w.phase !== 'over' && w.phase !== 'win' && ticks < 60 * 60 * 40; ticks++) {
    if (w.phase === 'shop' && seen !== w.wave) {
      seen = w.wave;
      lv[w.wave] = p.level;
    }
    step(w, [botInput(w, 0)], w.phase === 'shop' ? botShop(w, 0) : []);
  }
  if (w.phase === 'win') wins++;
  games.push(lv);
}

const full = games.filter((lv) => lv[LAST] !== undefined);
const q = (xs: number[], f: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * f))] : NaN);
/** 第一次在商店里够到 L 级是第几波后（没够到 = Infinity）。 */
const firstShop = (lv: number[], L: number) => {
  for (let n = 1; n <= LAST; n++) if ((lv[n] ?? 0) >= L) return n;
  return Infinity;
};

console.log(`${runs} 局（种子 2000 起），通关 ${wins}，打到最后一个商店（第 ${LAST} 波后）的 ${full.length} 局`);
console.log('各波后商店里的等级 中位（最低的一成–最高的一成）：');
console.log('  ' + Array.from({ length: LAST }, (_, i) => i + 1).map((n) => `${n}:${q(full.map((lv) => lv[n]), 0.5)}(${q(full.map((lv) => lv[n]), 0.1)}–${q(full.map((lv) => lv[n]), 0.9)})`).join(' '));
console.log(`宠物进化（${PET_LEVELS.join(' / ')} 级）分别在第 ${PET_LEVELS.map((L) => q(full.map((lv) => firstShop(lv, L)).filter(Number.isFinite), 0.5)).join('、')} 波后`);
for (const set of sets) {
  console.log(`\n门槛 ${set.join(' / ')}${set === TECH_LEVELS ? '（现在的功法门槛）' : ''}：`);
  for (const L of set) {
    const at = full.map((lv) => firstShop(lv, L));
    const got = at.filter(Number.isFinite);
    const m = q(got, 0.5);
    console.log(`  ${String(L).padStart(2)} 级：第 ${m} 波后够到（九成的局不晚于第 ${q(got, 0.9)} 波）；之后还能用 ${TOTAL_WAVES - m} 波；到最后都没够到 ${at.length - got.length}/${full.length}`);
  }
  let shops = 0;
  let clash = 0;
  let twice = 0;
  for (const lv of full) {
    const at = set.map((L) => firstShop(lv, L)).filter(Number.isFinite);
    const pet = new Set(PET_LEVELS.map((L) => firstShop(lv, L)));
    for (const n of new Set(at)) {
      shops++;
      if (pet.has(n)) clash++;
    }
    if (new Set(at).size < at.length) twice++;
  }
  console.log(`  和宠物进化撞在同一次商店：${clash}/${shops}；一次商店里连过两个门槛的局：${twice}/${full.length}`);
}
