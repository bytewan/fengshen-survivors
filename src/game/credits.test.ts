// 致谢页读的 audio/CREDITS.txt：按音频工具生成的格式解析，每首配乐的署名（CC-BY 4.0，必须署名）一行不少。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MUSIC_ATTRIBUTION_FALLBACK, parseAudioCredits } from './credits.ts';

test('解析随游戏发布的 audio/CREDITS.txt：署名原文完整、CC0 素材逐条列出', () => {
  const text = readFileSync(new URL('../../public/audio/CREDITS.txt', import.meta.url), 'utf8');
  const c = parseAudioCredits(text);
  assert.ok(c, '解析失败');
  for (const line of MUSIC_ATTRIBUTION_FALLBACK) assert.ok(c.attribution.lines.includes(line), `少了署名：${line}`);
  assert.match(c.attribution.title, /CC-BY/);
  assert.ok(c.thanks.items.length >= 10);
  for (const i of c.thanks.items) {
    assert.ok(i.name && i.by, JSON.stringify(i));
    assert.doesNotMatch(i.url ?? '', /^https?:/);
  }
});

test('格式不对时返回 null（致谢页就用内置的署名）', () => {
  assert.equal(parseAudioCredits('随便一段话'), null);
  assert.equal(parseAudioCredits(''), null);
});
