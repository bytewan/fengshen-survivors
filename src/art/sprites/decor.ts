// 陈塘关场景的零碎道具：石灯（里面是回响的幽火）、残破的殷商军旗、地上的残符、枯草、鬼火。
import { compose, grid, outline, type Grid } from '../pixel.ts';

const SELOUT: Record<string, string> = { Y: 'B', f: 'B', y: 'B', l: 'G', L: 'v', v: 'G' };
const lined = (rows: string[]) => {
  const g = grid(rows);
  return outline(compose(g.w + 2, g.h + 2, [{ g, x: 1, y: 1 }]), 'k', SELOUT);
};

export const LANTERN = grid([
  '....kk....',
  '...kihk...',
  '.kkiihhkk.',
  'khiihhhggk',
  '.kkkkkkkk.',
  '..khCchk..',
  '..kgccgk..',
  '..kkkkkk..',
  '...khgk...',
  '...khgk...',
  '...khgk...',
  '..kkhgkk..',
  '.khhhgggk.',
  '.kggggggk.',
  'kkkkkkkkkk',
]);

export const BANNER = grid([
  'k...........',
  'Bkkkkkkk....',
  'BrrRrrrrk...',
  'BrRBBrrRk...',
  'BrRBrBrrk...',
  'BrrBBrRk....',
  'BRrrrRrk....',
  'Brr.rRk.....',
  'Br...k......',
  'B...........',
  'B...........',
  'b...........',
  'B...........',
  'B...........',
  'b...........',
  'B...........',
  'B...........',
  'kk..........',
]);

// 残符：细长的黄纸条，略斜，不描黑边（描了会读成小箱子），只在右下压一像素影子
const strip = (rows: string[]) => {
  const g = grid(rows);
  return compose(g.w + 1, g.h + 1, [
    { g, x: 1, y: 1, tint: 'k' },
    { g, x: 0, y: 0 },
  ]);
};
export const TALISMANS: Grid[] = [
  strip(['..jw', '.jrj', '.jrj', 'jrj.', 'jjj.', 'wj..']),
  strip(['wjj..', 'jrrjj', '.jjrj', '...jw']),
  strip(['.jw', 'jrj', 'jjj', 'jrj', 'jrj', 'wj.']),
];

export const GRASS: Grid[] = [lined(['.l.v.', 'vLlv.', '.vlv.']), lined(['l..', 'vLv', '.v.'])];

export const GHOST_FIRE: Grid[] = [
  grid(['..C..', '.CC..', '.CWC.', 'cCWCc', '.cCc.', '..c..']),
  grid(['...C.', '..CC.', '.CWC.', 'cCWCc', '.cCc.', '..c..']),
  grid(['.C...', '.CC..', '.CWCc', 'cCWCc', '.cCc.', '..c..']),
];

// 青铜鼎：三足两耳，腹部饕餮纹，带一点铜绿
export const TRIPOD = grid([
  '..kkk........kkk....',
  '..kbk........kbk....',
  '..kBk........kBk....',
  'kkkBkkkkkkkkkkBkkk..',
  'kbbybbbbbbbbbbybbk..',
  'kBBBBBBBBBBBBBBBBk..',
  '.kbBBvBBBBBBvBBBk...',
  '.kBkBkBkBkBkBkBkk...',
  '.kbBkBBBkBBBkBBBk...',
  '.kBBvBBBBBvBBBBBk...',
  '..kBBBBvBBBBBBBk....',
  '..kGBBBBBBBBBBGk....',
  '...kGGBBBBBBGGk.....',
  '...kBk..kBk..kBk....',
  '...kBk..kGk..kBk....',
  '...kkk..kkk..kkk....',
]);

// 断柱：朱漆柱身、金箍，顶部断口参差，汉白玉柱础
const PILLAR_BODY = Array.from({ length: 16 }, (_, i) => (i === 7 ? '.kRrRkerk.' : '.kRreeerk.'));
export const PILLAR = grid([
  '...k......',
  '..kek.k...',
  '.kreekek..',
  '.kRreeerk.',
  '.kyyYyyyk.',
  '.kBbbbbBk.',
  '.kyyYyyyk.',
  ...PILLAR_BODY,
  'kxzzzzzzxk',
  'kuxxxxxxuk',
  'kquuuuuuqk',
  'kkkkkkkkkk',
]);

// 插在地上的巨戟：戟刃、红缨
export const HALBERD = grid([
  '....k....',
  '...kjk...',
  '...kjk...',
  '.kkkjkkk.',
  'kjjiBijjk',
  '.kkkBkik.',
  '...kBkk..',
  '..keBek..',
  '..kerek..',
  '...kBk...',
  '...kbk...',
  '...kBk...',
  '...kBk...',
  '...kbk...',
  '...kBk...',
  '...kBk...',
  '...kBk...',
  '...kbk...',
  '...kBk...',
  '...kBk...',
  '..kqBqk..',
  '...kkk...',
]);

// ---------- 修仙道具（用户口径：修仙玄幻，不是历史考古） ----------

// 剑冢里的仙剑：剑身入地，剑刃一线天青灵光，金镡、朱缠柄
export const SWORD = grid([
  '...k...',
  '..kyk..',
  '..krk..',
  '..kek..',
  '..krk..',
  'kyyYyyk',
  '.kjwCk.',
  '.kjwCk.',
  '.kjwCk.',
  '.kjwCk.',
  '.kjwCk.',
  '.kjwCk.',
  '.kjwCk.',
  '.kjwCk.',
  '.kjwCk.',
  '..kwk..',
  '.kxxxk.',
]);

// 灵石晶簇：天青与紫晶交错，顶端高光
export const CRYSTAL = grid([
  '......k.....',
  '.....kCk....',
  '..k..kWck...',
  '.kCk.kCck.k.',
  '.kWck.kCckCk',
  '.kCcck.kCWck',
  '..kCcckpCcck',
  '..kcCcpmpcck',
  '.kpcccpmppck',
  '.kppcpmmpppk',
  '..kPppppPPk.',
  '...kPPPPPk..',
  '....kkkkk...',
]);

// 玉碑：白玉碑身、云头碑首，碑面金色符文
export const STELE = grid([
  '...kkkkkk...',
  '..kwwwwwwk..',
  '.kwjwwwwjwk.',
  '.kjjjjjjjjk.',
  '..kwwwwwwk..',
  '..kwyjjyjk..',
  '..kjjjjjjk..',
  '..kwjyyjjk..',
  '..kjjjjjjk..',
  '..kwyjjyjk..',
  '..kjjyjjjk..',
  '..kwjjjjjk..',
  '..kwyyjyjk..',
  '..kjjjjjjk..',
  '..kjjjjjxk..',
  '.kzzzzzzzzk.',
  'kxzzzzzzzzxk',
  'kkkkkkkkkkkk',
]);

// 莲花灯：漂在空中，桃红花瓣、金色灯芯
export const LOTUS = [
  grid(['....f....', '...kYk...', '.k.kfk.k.', 'kmkmwmkmk', 'kmmwmwmmk', '.kpppppk.', '..kkkkk..']),
  grid(['....Y....', '...kfk...', '.k.kYk.k.', 'kmkmwmkmk', 'kmmwmwmmk', '.kpppppk.', '..kkkkk..']),
];

// 漂浮符箓：黄纸朱砂，两帧微微卷动
export const FLOAT_TALISMAN = [
  grid(['kkkkk', 'kYfYk', 'kYrYk', 'kYrYk', 'krrrk', 'kYrYk', 'kYrYk', 'kfYYk', '.kkk.']),
  grid(['.kkkk', 'kYfYk', 'kYrYk', 'kYrYk', 'krrrk', 'kYrYk', 'kYrYk', 'kfYYk', 'kkkk.']),
];

// 白玉石灯（替换旧的灰石灯），灯室里是天青灵火
export const JADE_LANTERN = grid([
  '....kk....',
  '...kwzk...',
  '.kkwwzzkk.',
  'kwwwzzzzxk',
  '.kkkkkkkk.',
  '..kzCczk..',
  '..kxccxk..',
  '..kkkkkk..',
  '...kwxk...',
  '...kzxk...',
  '...kzxk...',
  '..kkzxkk..',
  '.kwwzzxxk.',
  '.kzzzzxxk.',
  'kkkkkkkkkk',
]);
