// 调数值用：命令行里临时改数值表（不改文件），给 tools/balance.ts、weapon-dps.ts、coop-balance.ts 共用。
// 用法：--set '表.路径=值'，可以给好几个。值是 JSON（数、数组、对象）；以 * 开头是「乘」：数乘数、数组逐个乘（下标 0 也乘，0 乘了还是 0）。
// 路径里的 * 匹配这一层的每个键。例：
//   --set 'WAVE_CURVE.hpBase=2.6'          敌人气血整体 ×2.6
//   --set 'ENEMIES.*.speed=*1.1'           所有敌人移速 ×1.1（speed 是 [下限, 上限]）
//   --set 'FOES.cavalry.speed=320'         骁骑冲锋 320
//   --set 'WEAPONS.qiankun.dmg=*0.9'       乾坤圈单发 ×0.9
// 改完打印一行「临时改了」，免得忘了这一遍不是仓库里的数。
import { BOSS, CASTER, COOP, DROPS, ENEMIES, FOES, MIASMA, PLAYER, SKILL } from '../src/sim/config.ts';
import { RELIC, SURGE, TIER_DMG, WAVE_CURVE, WEAPONS } from '../src/sim/catalog.ts';
import { TUNE } from '../src/sim/weapons.ts';
import { JIE } from '../src/sim/jie.ts';
import { TECH } from '../src/sim/techniques.ts';
import { FOES2, TEN, YAO } from '../src/sim/ch2/config.ts';
import { FOES3, SWORDS, ZHUXIAN } from '../src/sim/ch3/config.ts';
import { AFFIX, ELITES } from '../src/sim/elites/config.ts';
import { SANJIAN, GAZE } from '../src/sim/heroes/yangjian.ts';
import { DINGHAI, JINBIAN } from '../src/sim/heroes/zhao.ts';
import { DOU, RIVER } from '../src/sim/heroes/yunxiao.ts';
import { SCORCH, ZONE, ZONE_FX } from '../src/sim/zones.ts';
import { BLEED, HUAXUE, XINGHUANG } from '../src/sim/core.ts';
import { PET } from '../src/sim/pets/huntian.ts';
import { XIAOTIAN } from '../src/sim/pets/xiaotian.ts';
import { HEIHU } from '../src/sim/pets/heihu.ts';
import { QINGLUAN } from '../src/sim/pets/qingluan.ts';
import { ECON, ELIXIR, HEROES, HUOYAN, LONGLIN, PRICE, REACT, REROLL, RUSH, ZHAOCAI } from '../src/sim/catalog.ts';
import { HEIYAN, TUJIN } from '../src/sim/heroes/mozha.ts';
import { FULONG } from '../src/sim/heroes/huizhao.ts';
import { QIANKUNTU } from '../src/sim/heroes/huiyun.ts';
import { FAXIANG, JINGU } from '../src/sim/heroes/wukong.ts';
import { MAOHOU } from '../src/sim/pets/maohou.ts';
import { STAFF, WING } from '../src/sim/heroes/leizhenzi.ts';
import { LEIPENG } from '../src/sim/pets/leipeng.ts';
import { TUNE2 } from '../src/sim/arti2.ts';
import { HUALONG, YOULONG } from '../src/sim/heroes/huiao.ts';
import { BISHUI } from '../src/sim/pets/bishui.ts';
import { POOL } from '../src/sim/bosspool.ts';
import { ECHO, ECHO_AOBING, ECHO_YUNXIAO, ECHO_ZHAO } from '../src/sim/echo/config.ts';

const TABLES: Record<string, unknown> = {
  BOSS, CASTER, COOP, DROPS, ENEMIES, FOES, MIASMA, PLAYER, SKILL,
  RELIC, SURGE, TIER_DMG, WAVE_CURVE, WEAPONS, TUNE, JIE, TECH,
  FOES2, TEN, YAO, FOES3, SWORDS, ZHUXIAN, AFFIX, ELITES,
  SANJIAN, GAZE, DINGHAI, JINBIAN, DOU, RIVER,
  ECON, ELIXIR, PRICE, REROLL, SCORCH, ZONE, ZONE_FX, BLEED, HUAXUE, XINGHUANG, PET, XIAOTIAN, HEIHU, QINGLUAN, REACT, HEIYAN, FULONG, QIANKUNTU, HEROES, ZHAOCAI, TUJIN, JINGU, FAXIANG, MAOHOU, RUSH, HUOYAN, STAFF, WING, LEIPENG, TUNE2, YOULONG, HUALONG, BISHUI, POOL, ECHO, ECHO_AOBING, ECHO_YUNXIAO, ECHO_ZHAO, LONGLIN,
};

type Obj = Record<string, unknown>;

function scale(v: unknown, k: number): unknown {
  if (typeof v === 'number') return v * k;
  if (Array.isArray(v)) return v.map((x) => scale(x, k));
  throw new Error(`「*${k}」只能乘数或数组，这里是 ${JSON.stringify(v)}`);
}

function setPath(obj: Obj, keys: string[], raw: string, path: string, done: string[], create = false) {
  const [k, ...rest] = keys;
  const names = k === '*' ? Object.keys(obj) : [k];
  for (const name of names) {
    // 「表.路径:=值」（冒号等号）才许新加一个原来没有的键（比如 HEROES.zhao.maxHp 这种可选的）：平常写错了路径要报错
    if (!(name in obj) && !(create && !rest.length)) throw new Error(`没有这一项：${path}（${name}）`);
    if (rest.length) {
      const next = obj[name];
      if (next === null || typeof next !== 'object') throw new Error(`${path}：${name} 不是表`);
      setPath(next as Obj, rest, raw, path, done, create);
      continue;
    }
    const old = obj[name];
    obj[name] = raw.startsWith('*') ? scale(old, Number(raw.slice(1))) : JSON.parse(raw);
    done.push(name);
  }
}

/** 按命令行的 --set 改数值表；返回改了的说明（没有 --set 就是空串）。 */
export function applySets(argv: string[] = process.argv): string {
  const notes: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--set') continue;
    const spec = argv[i + 1] ?? '';
    const eq = spec.indexOf('=');
    if (eq < 0) throw new Error(`--set 要写成 表.路径=值：${spec}`);
    const create = spec[eq - 1] === ':';
    const path = spec.slice(0, create ? eq - 1 : eq);
    const raw = spec.slice(eq + 1);
    const [table, ...keys] = path.split('.');
    const root = TABLES[table];
    if (!root) throw new Error(`不认识的表：${table}（有 ${Object.keys(TABLES).join(' / ')}）`);
    const done: string[] = [];
    if (!keys.length) throw new Error(`--set 要写到表里的某一项：${spec}`);
    setPath(root as Obj, keys, raw, path, done, create);
    notes.push(`${path}=${raw}`);
  }
  if (notes.length) console.log(`（临时改了：${notes.join('；')}）`);
  return notes.join('；');
}
