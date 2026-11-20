// 图鉴「十绝阵」一组的说明（敌人页签里，排在精英词缀后面）：每座阵一条——叫什么、阵台什么样、亮起来放什么招、怎么躲 / 怎么用。
// 招式的数值以 sim/ch2/config.ts 的 TEN 为准；这里只写玩家看得懂的说法。
import type { SiteKind } from '../../sim/ch2/types.ts';

export const TEN_ORDER: SiteKind[] = ['thunder', 'quake', 'wind', 'ice', 'gold', 'blood', 'fire', 'soul', 'water', 'sand'];

export const TEN_NOTES: Record<SiteKind, { name: string; look: string; move: string; dodge: string }> = {
  thunder: { name: '天绝阵', look: '铜鼓雷台，鼓面刻着云雷纹', move: '阵中天雷连落，多劈阵中之人，敌人亦不能免。', dodge: '落点先现红光，移出即可。' },
  quake: { name: '地烈阵', look: '从中间裂开的一块大石', move: '阵心向外裂开地缝，喷涌岩火，一次三道。', dodge: '地缝先现红线，立于两缝之间或走出阵外。' },
  wind: { name: '风吼阵', look: '细高的风幡，三条飘带', move: '阵风外推，风刃绕阵心扫过扇面，人敌皆被吹出。', dodge: '扇面先现红光，顺风出阵最快。' },
  ice: { name: '寒冰阵', look: '一簇冰晶冻在台上', move: '冰锥内外两圈轮番冒出，中者迟滞，敌人亦然。', dodge: '冰锥先现红点：内圈冒时立于外环，外圈冒时退入内圈。' },
  gold: { name: '金光阵', look: '嵌金的台上一面青铜圆镜', move: '阵中金光加持，法宝威力大增，阵边则不断涌出回响兵。', dodge: '此阵为你所用：气血充足时入阵而战，兵多则出。' },
  blood: { name: '化血阵', look: '一面殷红的血幡，幡上一个黑的符印', move: '阵中血雾弥漫，人敌皆持续掉血，敌人尤甚。', dodge: '勿入其中；引敌入雾，任其自化。' },
  fire: { name: '烈焰阵', look: '三足青铜火盆', move: '火柱自预警处窜起，落地后余火不熄，亦焚阵中之敌。', dodge: '落点先现红光；余火之处勿踏。' },
  soul: { name: '落魂阵', look: '缟白的落魂幡，杆头一点魂火（姚天君的阵）', move: '魂火自阵边冒出，追人而飘；阵中行迟，真气渐散。姚天君「十阵齐鸣」时必亮此阵。', dodge: '魂火出前阵边先现红光；魂火较人为慢，勿停阵边。' },
  water: { name: '红水阵', look: '宽口的青铜水盆，盛着一盆暗红的水', move: '阵中红水涨起，入者迟滞掉血，敌人亦被拖慢。', dodge: '勿入其中；借之拖慢追敌。' },
  sand: { name: '红沙阵', look: '一口大肚陶瓮，瓮口溢着红沙', move: '沙暴将人敌拖向阵心，阵心沙眼连番研磨。', dodge: '沙眼先现红光；被拖入则向外硬走。敌聚一处，正好合击。' },
};
