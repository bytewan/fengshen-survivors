// 功法的 DPS 对照：确定性场景，同一套中期构筑，逐门功法量「多打了百分之几」。
//   群伤：一群普通兵追着绕场心走大圈的人物（同 tools/weapon-dps.ts 的群伤场景：场上始终 40 只，打死的从四周补上，
//         每秒把最远的 3 只挪到四周重新涌进来）；普通兵的血量 --hp（默认 150：要打几下才死，加的伤害才量得出来）。
//         功法自己的伤害按第 --wave 波放大（默认 9）。
//   首领：一只打不死、不吃控制的首领站在人物身边 60 像素，人物站着不动（只量单体输出）。
// 构筑：乾坤圈仙、火尖枪灵、九龙神火罩灵、番天印灵（火三土一，哪吒的常见走法），伤害 +30%、攻速 +15%、范围 +10%、火行亲和 +30%；
// 宠物不出手；不放神通（--skill：真气满了就放，量掌心雷、混元一气这类和神通有关的）。伤害按「实际扣掉的血」算（溢出的不算）。
// 用法：node tools/technique-dps.ts [--seeds 4] [--secs 30] [--wave 9] [--build fire|mixed] [--skill]
import { createWorld, spawnEnemy, step, type World } from '../src/sim/world.ts';
import { ARENA, DT } from '../src/sim/config.ts';
import { TECHNIQUES, TECH_IDS } from '../src/sim/techniques.ts';
import { createRng } from '../src/sim/rng.ts';
import type { PlayerInput, SimEvent, TechniqueId, WeaponKind } from '../src/sim/types.ts';

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const SEEDS = Number(arg('--seeds', '4'));
const SECS = Number(arg('--secs', '30'));
const WAVE = Number(arg('--wave', '9'));
const BUILD = arg('--build', 'fire');
const HP = Number(arg('--hp', '150')); // 群伤场景普通兵的血量：要够厚，不然这套构筑一下一只，加的伤害全成了溢出
const SKILL_ON = process.argv.includes('--skill');
const CIRCLE = 200;
const WARM = 3;

const BUILDS: Record<string, [WeaponKind, number][]> = {
  fire: [
    ['qiankun', 3],
    ['huojian', 2],
    ['jiulong', 2],
    ['fantian', 2],
  ],
  // 五行搭配：火木土水各一（相生多，量五行轮转、寒冰诀、五雷正法）
  mixed: [
    ['qiankun', 3],
    ['leigong', 2],
    ['fantian', 2],
    ['hanbing', 2],
  ],
};

function setup(seed: number, tech: TechniqueId | null): World {
  const w = createWorld(seed);
  w.wave = WAVE;
  w.waveLen = 1e9;
  w.spawnAcc = -1e12;
  w.eliteDone = true;
  w.surgeDone = true;
  const p = w.players[0];
  p.weapons = BUILDS[BUILD].map(([kind, tier]) => ({ kind, tier, spirit: null, cd: 0.3 }));
  p.stats.damage += 0.3;
  p.stats.haste += 0.15;
  p.stats.area += 0.1;
  p.stats.aff.fire += 0.3;
  p.pet.cd = 1e12;
  p.iframes = 1e12;
  if (tech) {
    p.techs.push(tech);
    TECHNIQUES[tech].apply?.(p.stats);
  }
  return w;
}

/** 群伤场景：返回每秒实际伤害。 */
function crowd(seed: number, tech: TechniqueId | null) {
  const w = setup(seed, tech);
  const p = w.players[0];
  p.x = p.px = ARENA.w / 2 + CIRCLE;
  p.y = p.py = ARENA.h / 2;
  const rng = createRng(seed * 7919 + 13);
  const hp = HP;
  const spot = () => {
    const a = rng.next() * Math.PI * 2;
    const d = 250 + rng.next() * 70;
    return [p.x + Math.cos(a) * d, p.y + Math.sin(a) * d * 0.7] as const;
  };
  const add = () => {
    const [x, y] = spot();
    const e = spawnEnemy(w, 'soldier', x, y, []);
    e.hp = e.maxHp = hp;
  };
  for (let i = 0; i < 40; i++) add();
  let dealt = 0;
  let t = 0;
  let relocate = 0;
  const dir = seed % 2 ? 1 : -1;
  const before = new Map<number, number>();
  for (let i = 0; i < Math.round((SECS + WARM) / DT); i++) {
    const cx = ARENA.w / 2;
    const cy = ARENA.h / 2;
    const a = Math.atan2((p.y - cy) / 0.75, p.x - cx);
    const tx = cx + Math.cos(a + dir * 0.35) * CIRCLE;
    const ty = cy + Math.sin(a + dir * 0.35) * CIRCLE * 0.75;
    const m = Math.hypot(tx - p.x, ty - p.y) || 1;
    const inp: PlayerInput = { mx: (tx - p.x) / m, my: (ty - p.y) / m, skill: SKILL_ON && p.skill >= 1 };
    before.clear();
    for (const e of w.enemies) before.set(e.id, e.hp);
    step(w, [inp]);
    t += DT;
    if (t > WARM) for (const [id, h0] of before) dealt += Math.max(0, h0 - Math.max(0, w.enemies.find((e) => e.id === id)?.hp ?? 0));
    while (w.enemies.length < 40) add();
    relocate += DT;
    if (relocate >= 1) {
      relocate -= 1;
      const far = [...w.enemies].sort((a2, b2) => (b2.x - p.x) ** 2 + (b2.y - p.y) ** 2 - ((a2.x - p.x) ** 2 + (a2.y - p.y) ** 2)).slice(0, 3);
      for (const e of far) {
        const [x, y] = spot();
        e.x = e.px = x;
        e.y = e.py = y;
      }
    }
  }
  return dealt / SECS;
}

/** 单体场景（首领）：返回每秒伤害。 */
function single(seed: number, tech: TechniqueId | null) {
  const w = setup(seed, tech);
  const p = w.players[0];
  const e = spawnEnemy(w, 'boss', p.x + 60, p.y, []);
  e.hp = e.maxHp = 1e9;
  let dealt = 0;
  let t = 0;
  for (let i = 0; i < Math.round((SECS + WARM) / DT); i++) {
    const h0 = e.hp;
    const ev: SimEvent[] = step(w, [{ mx: 0, my: 0, skill: SKILL_ON && p.skill >= 1 }]);
    void ev;
    t += DT;
    if (t > WARM) dealt += h0 - e.hp;
  }
  return dealt / SECS;
}

const avg = (f: (s: number) => number) => {
  let s = 0;
  for (let k = 0; k < SEEDS; k++) s += f(1 + k);
  return s / SEEDS;
};
const base = { crowd: avg((s) => crowd(s, null)), single: avg((s) => single(s, null)) };
console.log(`构筑 ${BUILD}，第 ${WAVE} 波（普通兵 ${HP} 血），${SEEDS} 个种子 × ${SECS} 秒${SKILL_ON ? '，放神通' : ''}`);
console.log(`没有功法：群伤 ${base.crowd.toFixed(0)}/秒  单体（首领）${base.single.toFixed(0)}/秒`);
const pct = (v: number, b: number) => `${v >= b ? '+' : ''}${Math.round((v / b - 1) * 100)}%`;
for (const id of TECH_IDS) {
  const c = avg((s) => crowd(s, id));
  const s1 = avg((s) => single(s, id));
  console.log(`${TECHNIQUES[id].name.padEnd(4, '　')}  群伤 ${c.toFixed(0).padStart(5)}（${pct(c, base.crowd).padStart(5)}）  单体 ${s1.toFixed(0).padStart(5)}（${pct(s1, base.single).padStart(5)}）`);
}
