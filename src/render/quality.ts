// 画质档（docs/perf.md、docs/design.md「画质」）：设置里的「画质」——自动 / 高 / 低。
//
// 高档就是原来的画面。低档只动不影响判断的东西：
//   - 画布的后备缓冲按「不超过需要的整数倍」放大（view-fit.ts 的 lowRes：比如手机横屏 844×390@3 从 2400×1350 降到 1920×1080，
//     剩下那一点由浏览器放大，像素边上略软一点），显卡每帧少填三成多像素；
//   - 魔气里翻滚的烟团不画（要多画一遍离屏贴图再用遮罩合上去；魔气的底色、浓淡照旧，边界一样看得清）；
//   - 装饰性的粒子成团迸出时少一些（一次三粒以内的照旧：预警、拖尾这类一粒一粒冒的不减），打死、命中、暴击的修仙版特效同屏上限减半。
// 判定、预警、减益的提示（地上的红光、冻住 / 减速 / 眩晕 / 破甲、灼烧的火苗、首领的出招……）任何档都不减；屏幕震动照旧。
//
// 自动：先按高档；这台设备上打着打着掉帧（连着两段、每段三秒里超过一成五的帧间隔超过 22 毫秒）就换成低档，并记在这台设备上
// （localStorage，不进存档码），以后自动就直接是低档；在设置里手动选一次高 / 低就以手动的为准。内存很小的设备（deviceMemory ≤ 2）一开始就是低档。
// 另外不管哪一档，掉帧时装饰粒子的倍率（decor）会往下压、帧率回来再慢慢放回去（不掉帧的电脑上永远是 1，画面和原来一样）。

export type QualitySetting = 'auto' | 'high' | 'low';
export type Tier = 'high' | 'low';

/** 设置里选的（这台设备自己的，不进存档码：电脑和手机该用的档不一样）。 */
const SETTING_KEY = 'fs.v1.quality';
/** 自动档在这台设备上量出来的结果。 */
const AUTO_KEY = 'fs.v1.autoQuality';
/** 一帧的间隔超过这么多毫秒算掉帧（60 Hz 下至少掉了一帧）。 */
const SLOW_MS = 22;
/** 一段多长（秒）。 */
const WINDOW = 3;

function savedSetting(): QualitySetting {
  try {
    const v = localStorage.getItem(SETTING_KEY);
    return v === 'high' || v === 'low' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

function stored(): Tier | null {
  try {
    const v = localStorage.getItem(AUTO_KEY);
    return v === 'low' || v === 'high' ? v : null;
  } catch {
    return null;
  }
}

/** 没量过的设备一开始用哪一档：内存很小的（安卓 Chrome 才报 deviceMemory）直接低档，其余先高档、掉帧了再降。 */
function guess(): Tier {
  const mem = typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory : undefined;
  return mem !== undefined && mem <= 2 ? 'low' : 'high';
}

export class Quality {
  setting: QualitySetting = 'auto';
  tier: Tier = 'high';
  /** 装饰粒子的倍率：高档 1、低档 0.6；掉帧时再往下压（最低 0.25）。 */
  decor = 1;
  private listeners = new Set<(q: Quality) => void>();
  private t = 0;
  private frames = 0;
  private slow = 0;
  private strikes = 0;

  /** 按设置定档（设置变了、开局时调）。 */
  apply(setting: QualitySetting) {
    this.setting = setting;
    const tier = setting === 'auto' ? (stored() ?? guess()) : setting;
    this.setTier(tier);
  }

  private setTier(tier: Tier) {
    if (tier === this.tier) return;
    this.tier = tier;
    this.decor = this.base();
    for (const fn of this.listeners) fn(this);
  }

  private base() {
    return this.tier === 'low' ? 0.6 : 1;
  }

  /** 档位变了就通知（返回取消订阅）。 */
  onChange(fn: (q: Quality) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** 打着的时候每帧调一次：dtMs 是这一帧和上一帧的间隔（万宝阁里、暂停时、过场里不要调）。 */
  frame(dtMs: number) {
    if (!(dtMs > 0) || dtMs > 250) return; // 切到后台回来的那一帧不算
    this.t += dtMs / 1000;
    this.frames++;
    if (dtMs > SLOW_MS) this.slow++;
    if (this.t < WINDOW) return;
    const frac = this.slow / Math.max(1, this.frames);
    this.t = this.frames = this.slow = 0;
    if (frac > 0.15) {
      this.strikes++;
      this.decor = Math.max(0.25, this.decor * 0.7); // 先减装饰
      if (this.setting === 'auto' && this.tier === 'high' && this.strikes >= 2) {
        // 自动档：连着两段都掉帧——这台设备就用低档，记下来
        try {
          localStorage.setItem(AUTO_KEY, 'low');
        } catch {}
        this.setTier('low');
        this.strikes = 0;
      }
    } else {
      this.strikes = 0;
      if (frac < 0.03) this.decor = Math.min(this.base(), this.decor + 0.1);
    }
  }

  /** 设置里选了一档：记在这台设备上并马上换。选了高 / 低，自动档以前量下的作废（以后选回自动重新量）。 */
  choose(setting: QualitySetting) {
    try {
      localStorage.setItem(SETTING_KEY, setting);
      if (setting !== 'auto') localStorage.removeItem(AUTO_KEY);
    } catch {}
    this.apply(setting);
  }
}

/** 整个页面共用一个；一载入就按这台设备上存的设置定档。 */
export const quality = new Quality();
quality.apply(savedSetting());
