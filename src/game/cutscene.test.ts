// 剧情过场：台词数据表和镜头对得上，每个镜头在几种画布尺寸下都建得起来、动得起来（不渲染，只跑每帧的更新），
// 波间旁白的取法对（首领波没有、没写台词的章节没有）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOSS_AFTER, CHAPTER_CUTSCENES, CUTSCENES, WAVE_LINES, beforeCut, waveLine } from './story.ts';
import { HERO_BOSS_AFTER, HERO_VIEWS, HERO_WAVE_LINES, heroCutLine, heroWaveLine } from './hero-views.ts';
import { HEROES } from '../sim/catalog.ts';
import type { HeroId } from '../sim/types.ts';
import { SHOTS, ShotKit } from './cutscene-shots.ts';
import { narrColumns } from './cutscene.ts';

test('过场的每一镜都有画面；字最多一种；竖排旁白每列不超过九个字', () => {
  for (const [id, beats] of Object.entries(CUTSCENES)) {
    assert.ok(beats.length > 0, id);
    for (const b of beats) {
      assert.ok(SHOTS[b.shot], `${id}：没有这个镜头 ${b.shot}`);
      assert.ok([b.narr, b.say || b.heroSay, b.title].filter(Boolean).length <= 1, `${id} / ${b.shot}：字只能有一种`);
      if (b.narr) for (const col of narrColumns(b.narr)) assert.ok([...col].length <= 9, `${id} / ${b.shot}：这一列太长「${col}」`);
    }
  }
  for (const c of Object.values(CHAPTER_CUTSCENES)) for (const id of [c.intro, c.end]) if (id) assert.ok(CUTSCENES[id], id);
});

test('旁白按标点和换行分列，标点、引号不画', () => {
  assert.deepEqual(narrColumns('榜上的魂\n被拘回旧日的战场，一遍又一遍，重演自己的死。'), ['榜上的魂', '被拘回旧日的战场', '一遍又一遍', '重演自己的死']);
  assert.deepEqual(narrColumns('「东海之滨，陈塘关。」'), ['东海之滨', '陈塘关']);
});

test('每个镜头在 480×270、640×360、960×540 的画布上都建得起来，动 4 秒不出错', () => {
  for (const [W, H] of [
    [480, 270],
    [640, 360],
    [960, 540],
  ]) {
    for (const [name, make] of Object.entries(SHOTS)) {
      const kit = new ShotKit(W, H, (W - 480) >> 1, (H - 270) >> 1);
      const shot = make(kit);
      let t = 0;
      for (let i = 0; i < 120; i++) {
        t += 1 / 30;
        shot.update(1 / 30, t);
      }
      assert.ok(shot.root.children.length > 0, `${name} @ ${W}×${H}`);
      shot.root.destroy({ children: true });
      kit.destroy();
    }
  }
});

test('波间旁白：三章的第 1–5 波各一句，首领波没有，没写台词的章节（第四章起）没有', () => {
  for (let w = 1; w <= 5; w++) assert.equal(waveLine(w), WAVE_LINES[1][w - 1]);
  assert.equal(waveLine(6), null);
  for (let w = 7; w <= 11; w++) assert.equal(waveLine(w), WAVE_LINES[2][w - 7]);
  assert.equal(waveLine(12), null);
  for (let w = 13; w <= 17; w++) assert.equal(waveLine(w), WAVE_LINES[3][w - 13]);
  assert.equal(waveLine(18), null);
  assert.equal(waveLine(19), null);
  assert.equal(waveLine(0), null);
});

test('有收尾过场时对白框只放散去那一句之前的；过场里角色自己的那一句按角色取得到（四个角色都有，取不到的用哪吒的那一句）', () => {
  // 第一、三章散去的那一句就是最后一句：和原来去掉那一句一样
  assert.deepEqual(beforeCut(BOSS_AFTER[1]), BOSS_AFTER[1].slice(0, 3));
  assert.deepEqual(beforeCut(BOSS_AFTER[3]), BOSS_AFTER[3].slice(0, 2));
  // 第二章：对白框只放姚天君的那一句，发现残页的两句交给过场
  assert.deepEqual(beforeCut(BOSS_AFTER[2]).map((l) => l.who), ['姚天君']);
  assert.equal(beforeCut<{ who: string; cue?: string }>([{ who: '哪吒' }]).length, 1); // 没有散去那一句的整套都放
  for (const [id, beats] of Object.entries(CUTSCENES))
    for (const b of beats) {
      if (!b.heroSay) continue;
      assert.ok(b.say, `${id} / ${b.shot}：heroSay 要带一句哪吒的 say 兜底`);
      for (const h of Object.keys(HERO_VIEWS) as HeroId[]) {
        const l = heroCutLine(h, b.heroSay);
        const own = HERO_BOSS_AFTER[h]?.[b.heroSay];
        // 写了这一章战后对白的角色都要取得到他自己的那一句（名字是他的）
        if (own || h === 'nezha') assert.ok(l && l.who === HEROES[h].name && l.text.length > 0, `${id} / ${b.shot}：${h} 取不到自己的那一句`);
      }
    }
});

test('角色自己的波间旁白：写了的章每章五句；杨戬第三章用他自己的五句，首领波没有，没写的章（第二章）用通用的那一套', () => {
  for (const [h, chs] of Object.entries(HERO_WAVE_LINES)) for (const [ch, lines] of Object.entries(chs!)) assert.equal(lines.length, 5, `${h} 第 ${ch} 章`);
  for (let w = 13; w <= 17; w++) assert.equal(heroWaveLine('yangjian', w), HERO_WAVE_LINES.yangjian![3][w - 13]);
  assert.equal(heroWaveLine('yangjian', 18), null);
  assert.equal(heroWaveLine('yangjian', 8), undefined); // 调用方（feel.ts）这时用 story.ts 的 waveLine
});
