// 联机的数值模拟：1–4 个机器人一起打完整的一局（倒地救援、按人数加强、灵石经验共享都按 coop.ts 的规则），
// 比各人数的通关率、打到第几波、等级，以及每局倒地 / 扶起 / 出局几次 —— 看按人数加强的倍率（config.COOP.scale）是不是让几个人一起打
// 「和单人差不多难」。数值最后统一调（docs/plan-m2-m4.md 的 M4）。
// 用法：node tools/coop-balance.ts [局数] [人数...]，例：node tools/coop-balance.ts 10 1 2 3 4（默认 10 局、1 到 4 人）。
//   角色：游戏里同一房间不能选重复角色，所以 n 个人默认是哪吒、杨戬、赵公明、云霄的前 n 个；--same 改成全是哪吒（原来的跑法）。
//   --jie N：按劫 N 打；--set '表.路径=值'：临时改数值表（tools/tune.ts）。
// 种子从 3000 起；同一个种子不同人数是不同的一局（刷怪、商店都不一样），只比整体。
import { createWorld, step, type SimEvent, type World } from '../src/sim/world.ts';
import { botInput, botShop } from '../src/sim/bot.ts';
import { COOP } from '../src/sim/config.ts';
import { HERO_IDS } from '../src/sim/heroes/index.ts';
import { clampJie } from '../src/sim/jie.ts';
import { applySets } from './tune.ts';

applySets(); // --set '表.路径=值'：临时改数值表（tools/tune.ts）

const jieAt = process.argv.indexOf('--jie');
const jie = jieAt >= 0 ? clampJie(Number(process.argv[jieAt + 1])) : 1;
const same = process.argv.includes('--same');
const args = process.argv.slice(2).filter((a, i, all) => all[i - 1] !== '--jie' && all[i - 1] !== '--set').map(Number).filter((x) => Number.isFinite(x));
const runs = args[0] ?? 10;
const counts = args.length > 1 ? args.slice(1) : [1, 2, 3, 4];

interface Row {
  win: boolean;
  wave: number;
  level: number;
  minutes: number;
  down: number;
  revive: number;
  out: number;
}

// 每一帧单独一个函数（躲开 Node 25.9 在长循环里 OSR 的 JIT 缺陷，见 tools/balance.ts 文件头）
function frame(w: World, n: Record<string, number>) {
  const cmds = w.phase === 'shop' ? w.players.flatMap((_, i) => botShop(w, i)) : [];
  const ev: SimEvent[] = step(w, w.players.map((_, i) => botInput(w, i)), cmds);
  for (const e of ev) if (e.t === 'down' || e.t === 'revive' || e.t === 'out') n[e.t]++;
}

function play(seed: number, players: number): Row {
  const w = createWorld(seed, players, { heroes: Array.from({ length: players }, (_, i) => (same ? 'nezha' : HERO_IDS[i % HERO_IDS.length])), jie });
  const n: Record<string, number> = { down: 0, revive: 0, out: 0 };
  let ticks = 0;
  while (w.phase !== 'over' && w.phase !== 'win' && ticks++ < 60 * 60 * 40) frame(w, n);
  const lv = w.players.map((p) => p.level).sort((a, b) => a - b);
  return { win: w.phase === 'win', wave: w.wave, level: lv[Math.floor(lv.length / 2)], minutes: w.time / 60, down: n.down, revive: n.revive, out: n.out };
}

const med = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : NaN);

console.log(`runs=${runs}，种子 3000–${3000 + runs - 1}；${same ? '全是哪吒' : `角色依次是 ${HERO_IDS.join('、')} 的前 n 个`}${jie > 1 ? `；劫${jie}` : ''}；按人数加强：敌人气血 +${COOP.scale.hp * 100}%/人、刷怪 +${COOP.scale.spawn * 100}%/人、首领气血 +${COOP.scale.boss * 100}%/人`);
for (const players of counts) {
  const rs = Array.from({ length: runs }, (_, r) => play(3000 + r, players));
  const wins = rs.filter((x) => x.win).length;
  const lost = rs.filter((x) => !x.win).map((x) => x.wave);
  console.log(
    `${players} 人：通关 ${wins}/${runs}  打到第几波（中位）${med(rs.map((x) => x.wave))}  等级中位 ${med(rs.map((x) => x.level))}  局长中位 ${med(rs.map((x) => x.minutes)).toFixed(1)} 分钟` +
      (players > 1 ? `  每局倒地 ${med(rs.map((x) => x.down))} / 扶起 ${med(rs.map((x) => x.revive))} / 出局 ${med(rs.map((x) => x.out))}（中位）` : '') +
      (lost.length ? `  陨落在第 ${lost.join('、')} 波` : ''),
  );
}
