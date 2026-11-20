// 五行构筑的 DPS 对照（用户 11-12：「同时有 4 个不同的属性应该很厉害……3 个一样的属性也应该很厉害，当然也不要太夸张，有质变就行」）。
// 确定性场景，同一个角色（哪吒：乾坤圈火 + 混天绫水），四件法宝同一品阶，量几种固定构筑在同一群敌人上的每秒伤害：
//   散搭（火二土二 + 宠物水：三才，没有同行三件）、同行三件（五行各一组）、同行四件（火四、水四 = 三件水 + 宠物）、四象、五行俱全。
// 场景：一群普通兵（场上始终 --crowd 只，打死的从四周补上，每秒把最远的 --inflow 只挪到四周重新涌进来），
//   两种走法：「走停」人物绕场心走大圈、每走 2 秒站 2 秒；「站桩」人物一直站着让敌群围上来（土行三件「不动如山」站稳了才震地，
//   走停时敌群多半落在身后，量不出它）；宠物照常出手（它打的印记是构筑的一部分）；
//   不放神通、不捡掉落、不吃角色开局的亲和（baseStats）。兵的血量 = 品阶的基准（凡 46 / 仙 58 / 神 50，同 tools/weapon-dps.ts）× --hpx（默认 6：四件法宝一起打；3 倍时敌人不够打，量出来各构筑都挤在一起）。
// 伤害按「实际扣掉的血」算（溢出的不算）。另报每分钟相生几次、三件档的金气 / 藤蔓 / 震地 / 燎原各几次。
// --opening：开局（只带专属法宝凡品 + 宠物，第一章前两波那种稀稀落落的敌群）逐个角色量，看「宠物算一件」让开局多了多少。
// 规则改动前后对照：把改动前的源码导出到别处（git archive <提交> src tools | tar -x -C <目录>），在那边跑同一个脚本。
// 用法：node --no-osr-from-maglev tools/wuxing-dps.ts [--seeds 6] [--secs 30] [--crowd 60] [--inflow 6] [--hpx 6] [--tiers 1,3,4] [--opening]
import { createWorld, baseStats, spawnEnemy, step, type World } from '../src/sim/world.ts';
import { heldList } from '../src/sim/heroes/index.ts';
import { ARENA, DT } from '../src/sim/config.ts';
import { HEROES, TIER_NAME } from '../src/sim/catalog.ts';
import { createRng } from '../src/sim/rng.ts';
import type { HeroId, PlayerInput, SimEvent, WeaponKind } from '../src/sim/types.ts';

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const SEEDS = Number(arg('--seeds', '6'));
const SECS = Number(arg('--secs', '30'));
const CROWD = Number(arg('--crowd', '60'));
const INFLOW = Number(arg('--inflow', '6'));
const HPX = Number(arg('--hpx', '6'));
const TIERS = arg('--tiers', '1,3,4').split(',').map(Number);
const OPENING = process.argv.includes('--opening');
const TIER_HP = [0, 46, 56, 58, 50];
const WARM = 3;
const CIRCLE = 200;
const IDLE: PlayerInput = { mx: 0, my: 0, skill: false };

interface Build {
  name: string;
  hero: HeroId;
  load: WeaponKind[];
}
const B = (name: string, load: WeaponKind[], hero: HeroId = 'nezha'): Build => ({ name, hero, load });
const BUILDS: Build[] = [
  B('散搭（火二土二，三才）', ['qiankun', 'huojian', 'fantian', 'xiangmo']),
  B('金三', ['qiankun', 'zhanxian', 'dashen', 'huaxue']),
  B('木三', ['qiankun', 'leigong', 'dingfeng', 'miaoshu']),
  B('水三（两件 + 宠物）', ['qiankun', 'hanbing', 'yinyang', 'fantian']),
  B('火三', ['qiankun', 'huojian', 'jiulong', 'fantian']),
  B('土三', ['qiankun', 'fantian', 'xiangmo', 'wuguang']),
  B('火四', ['qiankun', 'huojian', 'jiulong', 'wuhuo']),
  B('水四（三件 + 宠物）', ['qiankun', 'hanbing', 'yinyang', 'xuanyuan']),
  B('四象', ['qiankun', 'huojian', 'leigong', 'fantian']),
  B('五行俱全', ['qiankun', 'zhanxian', 'leigong', 'fantian']),
];

interface Result {
  dps: number;
  react: number;
  jinqi: number;
  vine: number;
  quake: number;
  blaze: number;
}
const ZERO: Result = { dps: 0, react: 0, jinqi: 0, vine: 0, quake: 0, blaze: 0 };

function setup(seed: number, b: Build, tier: number): World {
  const w = createWorld(seed, 1, [b.hero]);
  w.wave = 3; // 普通波：刷怪关掉
  w.waveLen = 1e9;
  w.spawnAcc = -1e12;
  w.eliteDone = true;
  w.surgeDone = true;
  const p = w.players[0];
  p.stats = baseStats();
  p.weapons = b.load.map((kind) => ({ kind, tier, spirit: null, cd: 0.3 }));
  p.iframes = 1e12;
  return w;
}

function circle(p: { x: number; y: number }, dir: number): PlayerInput {
  const dx = p.x - ARENA.w / 2;
  const dy = (p.y - ARENA.h / 2) / 0.75;
  const d = Math.hypot(dx, dy) || 1;
  const k = ((CIRCLE - d) / CIRCLE) * 2;
  const mx = (-dy / d) * dir + (dx / d) * k;
  const my = ((dx / d) * dir + (dy / d) * k) * 0.75;
  const m = Math.hypot(mx, my) || 1;
  return { mx: mx / m, my: my / m, skill: false };
}

function run(seed: number, b: Build, tier: number, hp: number, crowd: number, inflowRate: number, stand = false): Result {
  const w = setup(seed, b, tier);
  const p = w.players[0];
  const dir = seed % 2 ? 1 : -1;
  p.x = p.px = ARENA.w / 2 + CIRCLE;
  p.y = p.py = ARENA.h / 2;
  const rng = createRng(seed * 7919 + 13);
  const spot = (near: boolean) => {
    const a = rng.next() * Math.PI * 2;
    const d = near ? 60 + rng.next() * 200 : 250 + rng.next() * 70;
    return [p.x + Math.cos(a) * d, p.y + Math.sin(a) * d * 0.75];
  };
  const add = (near: boolean) => {
    const [x, y] = spot(near);
    const e = spawnEnemy(w, 'soldier', x, y, []);
    e.hp = e.maxHp = Math.max(1, Math.round(hp * (0.7 + 0.6 * rng.next())));
  };
  for (let i = 0; i < crowd; i++) add(true);
  const r: Result = { ...ZERO };
  let inflow = 0;
  const before = new Map<number, number>();
  const frame = (i: number) => {
    const measuring = i * DT >= WARM;
    before.clear();
    for (const e of [...w.enemies, ...heldList(w)]) before.set(e.id, e.hp);
    const walk = !stand && Math.floor(i / 120) % 2 === 0; // 走 2 秒、站 2 秒
    const ev: SimEvent[] = step(w, [walk ? circle(p, dir) : IDLE]);
    if (measuring) {
      const now = new Map([...w.enemies, ...heldList(w)].map((e) => [e.id, e.hp]));
      for (const [id, h0] of before) r.dps += Math.max(0, h0) - Math.max(0, now.get(id) ?? 0);
      for (const e of ev) {
        if (e.t === 'react') r.react++;
        else if (e.t === 'explode') r.blaze++;
        else if (e.t === 'wx') r[e.kind]++;
      }
    }
    w.drops = [];
    w.gems = [];
    p.skill = 0;
    while (w.enemies.length + heldList(w).length < crowd) add(false);
    for (inflow += inflowRate * DT; inflow >= 1; inflow--) {
      let far = w.enemies[0];
      let fd = -1;
      for (const e of w.enemies) {
        const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
        if (d > fd) {
          fd = d;
          far = e;
        }
      }
      const [x, y] = spot(false);
      far.x = far.px = x;
      far.y = far.py = y;
      far.hp = far.maxHp;
    }
  };
  const n = Math.round((WARM + SECS) / DT);
  for (let i = 0; i < n; i++) frame(i);
  const perMin = 60 / SECS;
  return { dps: r.dps / SECS, react: r.react * perMin, jinqi: r.jinqi * perMin, vine: r.vine * perMin, quake: r.quake * perMin, blaze: r.blaze * perMin };
}

function avg(b: Build, tier: number, hp: number, crowd = CROWD, inflow = INFLOW, stand = false): Result {
  const out: Result = { ...ZERO };
  for (let s = 0; s < SEEDS; s++) {
    const r = run(100 + s, b, tier, hp, crowd, inflow, stand);
    for (const k of Object.keys(ZERO) as (keyof Result)[]) out[k] += r[k] / SEEDS;
  }
  return out;
}

const pct = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`;
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 2 : 1), 0)));
const lpad = (s: string, n: number) => ' '.repeat(Math.max(0, n - s.length)) + s;

function main() {
  const t0 = Date.now();
  if (OPENING) {
    // 开局：只带专属法宝（凡品）+ 宠物；敌群稀（场上 14 只、每秒涌进 1 只），兵 46 血
    console.log('开局（专属法宝凡品 + 宠物；场上 14 只兵、每秒涌进 1 只，兵 46 血）：');
    for (const h of Object.keys(HEROES) as HeroId[]) {
      const r = avg({ name: h, hero: h, load: [HEROES[h].exclusive] }, 1, 46, 14, 1);
      console.log(`  ${pad(HEROES[h].name, 12)}群伤 ${lpad(r.dps.toFixed(1), 6)}  相生 ${lpad(r.react.toFixed(0), 3)} / 分钟`);
    }
    console.log(`\n（用时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒）`);
    return;
  }
  for (const t of TIERS) {
    const hp = TIER_HP[t] * HPX;
    const res = BUILDS.map((b) => ({ b, r: avg(b, t, hp), st: avg(b, t, hp, CROWD, INFLOW, true) }));
    const ref = res[0].r.dps;
    const sref = res[0].st.dps;
    console.log(`\n${TIER_NAME[t]}品（四件都是${TIER_NAME[t]}品；场上 ${CROWD} 只兵、每秒涌进 ${INFLOW} 只，兵 ${hp} 血；对照 = ${res[0].b.name}）：`);
    for (const { b, r, st } of res)
      console.log(
        `  ${pad(b.name, 24)}走停 ${lpad(r.dps.toFixed(0), 5)}（${lpad(pct(r.dps / ref - 1), 5)}）  站桩 ${lpad(st.dps.toFixed(0), 5)}（${lpad(pct(st.dps / sref - 1), 5)}）  相生 ${lpad(r.react.toFixed(0), 4)}  金气 ${lpad(r.jinqi.toFixed(0), 3)}  藤 ${lpad(r.vine.toFixed(0), 3)}  震 ${lpad(r.quake.toFixed(0), 3)}  炸 ${lpad(r.blaze.toFixed(0), 4)}（每分钟）`,
      );
  }
  console.log(`\n（用时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒）`);
}
main();
