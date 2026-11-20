// 3×5 像素数字（伤害飘字用），外描一圈玄色，读得清。另有灵石（经验）小精灵。
import { compose, grid, outline, type Grid } from '../pixel.ts';

const DIGITS: Record<string, string[]> = {
  '0': ['WWW', 'W.W', 'W.W', 'W.W', 'WWW'],
  '1': ['.W.', 'WW.', '.W.', '.W.', 'WWW'],
  '2': ['WWW', '..W', 'WWW', 'W..', 'WWW'],
  '3': ['WWW', '..W', '.WW', '..W', 'WWW'],
  '4': ['W.W', 'W.W', 'WWW', '..W', '..W'],
  '5': ['WWW', 'W..', 'WWW', '..W', 'WWW'],
  '6': ['WWW', 'W..', 'WWW', 'W.W', 'WWW'],
  '7': ['WWW', '..W', '..W', '.W.', '.W.'],
  '8': ['WWW', 'W.W', 'WWW', 'W.W', 'WWW'],
  '9': ['WWW', 'W.W', 'WWW', '..W', 'WWW'],
};

/** style：normal 白字、crit 金字、skill 橘字、corrode 魔气侵蚀的桃紫字。返回带描边的 5×7 字形。 */
export function digitGlyph(d: string, style: 'normal' | 'crit' | 'skill' | 'corrode'): Grid {
  const ch = style === 'crit' ? 'Y' : style === 'skill' ? 'o' : style === 'corrode' ? 'm' : 'W';
  const g = grid(DIGITS[d].map((r) => r.replace(/W/g, ch)));
  return outline(compose(g.w + 2, g.h + 2, [{ g, x: 1, y: 1 }]), 'k');
}

// 灵石：小小的天青晶粒，两帧闪烁
export const GEM = [grid(['.k.', 'kCk', 'kWk', 'kck', '.k.']), grid(['.k.', 'kCk', 'kCk', 'kck', '.k.'])];
export const GEM_BIG = [grid(['.kk.', 'kCWk', 'kCCk', 'kccC', '.kk.']), grid(['.kk.', 'kWCk', 'kCCk', 'kcck', '.kk.'])];
