// 五行印记（敌人头顶，表示最近一次被哪一行的法宝打中；fx.ts 的 WeaponFx 画）。2026-11-12 fxpolish 重画：
// 原来是 3×4 的小色块（ELEMENT_MARK），看不出是什么、像系统默认的标记。现在每一行一个小物件，5×5，同色系描边，
// 亮部一两个像素、暗部压住：金一颗切面的金晶、木一株两叶的嫩芽、水一滴水珠、火一朵火苗、土一座小山。
// 换成新的一行时先白一帧、从小弹到原大（fx.ts 里按 markAge 做），平时只是上下浮一像素。
import { grid, type Grid } from '../pixel.ts';
import { lined } from './fx.ts';

export const WUXING_MARK: Record<'metal' | 'wood' | 'water' | 'fire' | 'earth', Grid> = {
  metal: lined(grid(['..W..', '.WfY.', 'WfYyb', '.Yyb.', '..b..']), 'B'),
  wood: lined(grid(['L...L', 'LL.lL', '.lLl.', '..v..', '..v..']), 'G'),
  water: lined(grid(['..C..', '.CWC.', 'CWCCc', 'CCCcc', '.ccc.']), 'N'),
  fire: lined(grid(['..o..', '.oY..', '.oYe.', 'eYWYe', '.eYe.']), 'R'),
  earth: lined(grid(['..y..', '.yYb.', 'yYybb', 'Bbbbb']), 'B'),
};
