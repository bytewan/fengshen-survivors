// 字体子集的兜底（2026-11-12 瘦身，tools/fonts/subset.py）：三套字体都只收了会显示出来的字，新加了字却忘了重跑 subset.py，
// 正文体、像素体缺字会显示成方块，书法体缺字会落到文楷。这里核对 tools/fonts/chars.gen.json（subset.py 写的「各收了哪些字」）：
// ① 源码里所有字符串（跳过注释）的字都在正文体 / 像素体那一套里；② 各张名字表（角色、法宝、道具、敌人、首领、功法、成就、修为……）
// 的名字都在书法体那一套里（名字是用书法体写的）。不过的话：跑 `.venv/bin/python -I tools/fonts/subset.py` 再提交生成的文件。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAPTER_NAME, CHARMS, ELIXIRS, HEROES, RELICS, WEAPONS } from '../sim/catalog.ts';
import { ENEMY_NAME } from '../sim/enemies.ts';
import { BOSS_INFO } from '../sim/bosspool.ts';
import { TECHNIQUES } from '../sim/techniques.ts';
import { AFFIX_INFO, ELITE_INFO } from '../sim/elites/index.ts';
import { PATH_NAME, REALMS, XIUWEI_NODES } from '../sim/xiuwei-table.ts';
import { ACHIEVEMENTS, ACH_GROUPS } from './achievements.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const gen = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/fonts/chars.gen.json'), 'utf8')) as { text: string; brush: string; title: string };
const TEXT = new Set(gen.text);
const BRUSH = new Set(gen.brush);
const RERUN = '跑 .venv/bin/python -I tools/fonts/subset.py 重裁字体子集';

/** TS 源码里字符串的内容（跳过注释），和 subset.py 的 ts_string_list 一个算法。 */
function strings(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (src.startsWith('//', i)) {
      const j = src.indexOf('\n', i);
      i = j < 0 ? n : j;
    } else if (src.startsWith('/*', i)) {
      const j = src.indexOf('*/', i + 2);
      i = j < 0 ? n : j + 2;
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') j++;
        else if (c !== '`' && src[j] === '\n') break;
        j++;
      }
      out.push(src.slice(i + 1, j).replace(/\/\*[\s\S]*?\*\//g, ''));
      i = j + 1;
    } else i++;
  }
  return out;
}

const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

test('源码字符串里的字都收进了正文体 / 像素体', () => {
  const miss = new Map<string, string>();
  for (const f of walk(path.join(ROOT, 'src')).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
    for (const s of strings(fs.readFileSync(f, 'utf8'))) for (const ch of s) if (ch.charCodeAt(0) > 0x7f && !TEXT.has(ch) && !miss.has(ch)) miss.set(ch, path.relative(ROOT, f));
  }
  assert.equal(miss.size, 0, `缺 ${[...miss].map(([c, f]) => `${c}（${f}）`).join('、')}：${RERUN}`);
});

test('名字表的字都收进了书法体', () => {
  const names: [string, string][] = [];
  const add = (where: string, list: Iterable<string>) => {
    for (const n of list) names.push([where, n]);
  };
  add('章节', CHAPTER_NAME);
  add('角色', Object.values(HEROES).map((h) => h.name));
  add('法宝', Object.values(WEAPONS).map((w) => w.name));
  add('灵物', Object.values(RELICS).map((r) => r.name));
  add('丹药', Object.values(ELIXIRS).map((e) => e.name));
  add('符箓', Object.values(CHARMS).map((c) => c.name));
  add('敌人', Object.values(ENEMY_NAME));
  add('首领', Object.values(BOSS_INFO).map((b) => b.name));
  add('功法', Object.values(TECHNIQUES).map((t) => t.name));
  add('精英', Object.values(ELITE_INFO).map((e) => e.name));
  add('词缀', Object.values(AFFIX_INFO).map((a) => a.name));
  add('修为', XIUWEI_NODES.map((x) => x.name));
  add('境界', REALMS);
  add('路线', Object.values(PATH_NAME));
  add('成就', ACHIEVEMENTS.map((a) => a.name));
  add('成就分组', ACH_GROUPS.map((g) => g.name));
  const miss = names.flatMap(([where, n]) => [...n].filter((ch) => ch.charCodeAt(0) > 0x7f && !BRUSH.has(ch)).map((ch) => `${ch}（${where}「${n}」）`));
  assert.deepEqual(miss, [], `书法体缺字：${RERUN}；还缺的话在 subset.py 的书法体规则里补上这张表`);
});
