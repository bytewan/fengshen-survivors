// 头部造型对照（试验用，不进游戏）。12×12，脸朝右，三分之四侧。
import { grid } from '../pixel.ts';

export const HEAD_VARIANTS = {
  // D：双髻扎红绳，两只细长眼（远眼 1 像素、近眼 2 像素）
  D: grid([
    '...kk...kk..',
    '..kdgk.kdgk.',
    '..kerkkkrek.',
    '.kddddddddk.',
    'kdgggdddddk.',
    'kddddddddddk',
    'kddddtdttdtk',
    'kdddtkttkktk',
    'kddsttttttsk',
    '.kddsttSttk.',
    '..kkssttsk..',
    '....kkkkk...',
  ]),
  // E：刘海压住远眼，只露一只细长近眼，冷感
  E: grid([
    '...kk...kk..',
    '..kdgk.kdgk.',
    '..kerkkkrek.',
    '.kddddddddk.',
    'kdgggdddddk.',
    'kddddddddddk',
    'kddddddddtdk',
    'kddddddtkktk',
    'kddddsttttsk',
    '.kdddsttStk.',
    '..kkkssttk..',
    '....kkkkk...',
  ]),
  // G：E + 后髻垂下两缕红绳，剪影更有动势
  G: grid([
    '...kk...kk..',
    '..kdgk.kdgk.',
    'eekerkkkrek.',
    '.rkddddddddk',
    'kdgggdddddk.',
    'kddddddddddk',
    'kddddddddtdk',
    'kddddddtkktk',
    'kddddsttttsk',
    '.kdddsttStk.',
    '..kkkssttk..',
    '....kkkkk...',
  ]),
};
