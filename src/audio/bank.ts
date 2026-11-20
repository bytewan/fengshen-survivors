// 音效名字表（docs/audio.md）对应的素材与播放参数。纯数据，不碰浏览器 API（tools/audio/check.ts 也读它）。
// 文件在 public/audio/sfx/ 与 public/audio/music/，由 tools/audio/build.ts 按 tools/audio/recipes.ts 生成。

/** 现有的合成音效（Sfx 上的方法），素材缺失或还没加载好时用它顶上。 */
export type SynthName =
  | 'hit'
  | 'kill'
  | 'eliteKill'
  | 'pickup'
  | 'throw'
  | 'hurt'
  | 'skill'
  | 'drumHit'
  | 'cast'
  | 'orb'
  | 'dispel'
  | 'thrust'
  | 'flame'
  | 'thunder'
  | 'slam'
  | 'ice'
  | 'shield'
  | 'block'
  | 'silk'
  | 'levelUp'
  | 'waveEnd'
  | 'coin';

export interface SfxDef {
  /** public/audio/sfx/ 下的文件名（不含 .m4a）；多个时随机挑一个，不连续重复同一个 */
  files: string[];
  /** 目标响度（大致是 LUFS，越大越响）。素材各自的响度记在 assets.gen.ts，播放时自动换算增益 */
  db: number;
  /**
   * 每次随机偏的音高（半音）：往下最多偏 pitch，往上最多偏 UP_MAX（不论 pitch 多大），默认 0.6。
   * 2026-11-12 起只往下偏为主（用户：「所有尖锐的声音都不应该存在」），要整体更高、更低用 shift。
   */
  pitch?: number;
  /** 整体移调（半音，负数更低），在随机偏移之外；借别的素材又要它低一点 / 高一点时用 */
  shift?: number;
  /** 每次随机偏的音量（dB，±），默认 1.5 */
  jitter?: number;
  /** 同名最短间隔（毫秒），默认 50：一帧打死几十只时只响一两声，不糊成一片 */
  gap?: number;
  /** 同名同时最多几声，超出时让最早的一声快速淡出，默认 4 */
  voices?: number;
  /**
   * 不出声（docs/audio.md「武器少出声」，用户 2026-11-12：「音效也不需要所有武器都有，武器打击的音效不应该盖过背景音乐」）：
   * 快而密的法宝出手、命中。名字和原来的素材配方都留着，去掉 off 就恢复（成品文件要重新生成：tools/audio/build.ts 只做被引用的）。
   */
  off?: true;
  /** 素材缺失或还没加载好时用的合成音效；没有就不出声 */
  synth?: SynthName;
  /** 让背景音乐和鼓点让位多少（0..1） */
  duck?: number;
}

/** 随机变调往上最多几个半音（docs/audio.md「尖锐度」：往上偏的多半是更刺的那一下）。 */
export const UP_MAX = 0.5;

const v = (base: string, n: number) => Array.from({ length: n }, (_, i) => `${base}.${i + 1}`);

export const BANK: Record<string, SfxDef> = {
  // ---------- 法宝 ----------
  'qiankun.throw': { off: true, files: v('qiankun.throw', 3), db: -35, pitch: 1, gap: 60, voices: 3, synth: 'throw' },
  'qiankun.hit': { off: true, files: v('qiankun.hit', 3), db: -30.5, pitch: 1, gap: 30, voices: 5, synth: 'hit' },
  'qiankun.hover': { files: v('qiankun.hover', 2), db: -31.5, gap: 1500, voices: 1, synth: 'throw' },
  'huojian.thrust': { off: true, files: v('huojian.thrust', 2), db: -33.5, gap: 70, voices: 3, synth: 'thrust' },
  'jiulong.burst': { files: v('jiulong.burst', 2), db: -30.5, gap: 900, voices: 1, synth: 'flame' },
  'leigong.strike': { files: v('leigong.strike', 2), db: -32, gap: 1500, voices: 1, synth: 'thunder' },
  'leigong.mark': { off: true, files: ['leigong.mark'], db: -29, gap: 120, voices: 3 },
  'fantian.fall': { off: true, files: ['fantian.fall'], db: -32.5, gap: 120, voices: 2 },
  'fantian.land': { files: v('fantian.land', 2), db: -19, gap: 350, voices: 1, synth: 'slam', duck: 0.15 },
  'xinghuang.up': { files: ['xinghuang.up'], db: -30, gap: 1200, voices: 1, synth: 'shield' },
  'xinghuang.block': { files: v('xinghuang.block', 2), db: -33.5, gap: 900, voices: 1, synth: 'block' },
  'xinghuang.break': { files: ['xinghuang.break'], db: -21, gap: 400, voices: 1, synth: 'slam', duck: 0.2 },
  'zhanxian.fly': { off: true, files: v('zhanxian.fly', 4), db: -29, pitch: 2, gap: 50, voices: 3, synth: 'throw' },
  'zhanxian.hit': { off: true, files: v('zhanxian.hit', 3), db: -28.5, pitch: 1, gap: 35, voices: 4, synth: 'hit' },
  'hanbing.frost': { files: ['hanbing.frost'], db: -27.5, gap: 1200, voices: 1, synth: 'ice' },
  'hanbing.spike': { off: true, files: v('hanbing.spike', 2), db: -31, pitch: 1, gap: 70, voices: 3, synth: 'ice' },
  // ---------- 后加的 8 件法宝（fx-new.ts）：各有各的素材，音量压在原来 8 件之下（满屏法宝一起出手时不抢）----------
  // 打神鞭：从天落下是一道细的高破风，抽中是硬木一声脆响带一点雷的余韵，仙品落点的震波是闷的低音
  'dashen.fall': { off: true, files: ['dashen.fall'], db: -36, pitch: 2, gap: 120, voices: 2, synth: 'throw' },
  'dashen.lash': { files: v('dashen.lash', 2), db: -35, pitch: 1.5, gap: 900, voices: 1, synth: 'thunder' },
  'dashen.shock': { files: ['dashen.shock'], db: -28, pitch: 1, gap: 500, voices: 1, synth: 'slam' },
  // 化血神刀：血光斩是湿的刃声，血雾是低的嘶声，噬魂回血是倒放的鬼声往回收、一声暖的铃
  'huaxue.slash': { files: v('huaxue.slash', 2), db: -34, pitch: 1, gap: 900, voices: 1, synth: 'hit' },
  'huaxue.mist': { off: true, files: ['huaxue.mist'], db: -35, pitch: 2, gap: 150, voices: 2 },
  'huaxue.drain': { files: ['huaxue.drain'], db: -33, pitch: 1.5, gap: 1500, voices: 1 },
  // 定风珠：旋风是转着的风，吹散 / 定海是一阵猛风，风雷是风里一道雷
  'dingfeng.whirl': { files: ['dingfeng.whirl'], db: -35, pitch: 1, gap: 1500, voices: 1, synth: 'throw' },
  'dingfeng.gust': { files: ['dingfeng.gust'], db: -33, pitch: 1.5, gap: 1200, voices: 1, synth: 'throw' },
  'dingfeng.thunder': { files: ['dingfeng.thunder'], db: -35, pitch: 1, gap: 1200, voices: 1, synth: 'thunder' },
  // 青莲宝色旗：结界展开是筝上滑和铃树，荆棘是细枝一折、木头一扎，回血是一声轻的手铃
  'qinglian.bloom': { files: ['qinglian.bloom'], db: -32, pitch: 1, gap: 2000, voices: 1, synth: 'shield' },
  'qinglian.thorn': { off: true, files: ['qinglian.thorn'], db: -36, pitch: 2.5, gap: 150, voices: 2 },
  'qinglian.heal': { files: ['qinglian.heal'], db: -35, pitch: 1.5, gap: 2000, voices: 1 },
  // 阴阳镜：光束是镜面擦出来的亮音，两道照到冻住是冻住的冰响
  'yinyang.beam': { files: ['yinyang.beam'], db: -35, pitch: 1.5, gap: 1200, voices: 1 },
  'yinyang.freeze': { files: ['yinyang.freeze'], db: -32, pitch: 1.5, gap: 1200, voices: 1, synth: 'ice' },
  // 玄元控水旗：水柱涌起是一泼水，漩涡是转着的水声，寒潭封冻是水一下子冻住
  'xuanyuan.pool': { files: ['xuanyuan.pool'], db: -34, pitch: 1.5, gap: 1200, voices: 1 },
  'xuanyuan.vortex': { files: ['xuanyuan.vortex'], db: -36, pitch: 1, gap: 2000, voices: 1 },
  'xuanyuan.freeze': { files: ['xuanyuan.freeze'], db: -32, pitch: 1, gap: 1500, voices: 1, synth: 'ice' },
  // 五火七禽扇：扇出火浪是一扇的风和腾起的火，七禽是扑翅似的布声带火苗，焚风焦土是地上一片火燎
  'wuhuo.fan': { files: ['wuhuo.fan'], db: -33, pitch: 1, gap: 1200, voices: 1, synth: 'flame' },
  'wuhuo.bird': { off: true, files: ['wuhuo.bird'], db: -35, pitch: 2, gap: 200, voices: 1, synth: 'silk' },
  'wuhuo.scorch': { files: ['wuhuo.scorch'], db: -36, gap: 1500, voices: 1, synth: 'flame' },
  // 捆仙绳：金绳射出是绳子的破风，捆住是绳子一勒的吱声，缚仙互撞是两个撞在一起的闷响
  'kunxian.throw': { off: true, files: ['kunxian.throw'], db: -33, pitch: 1, gap: 100, voices: 2, synth: 'throw' },
  'kunxian.bind': { off: true, files: ['kunxian.bind'], db: -33, pitch: 1, gap: 100, voices: 2, synth: 'silk' },
  'kunxian.clash': { files: ['kunxian.clash'], db: -35, pitch: 1.5, gap: 1200, voices: 1, synth: 'hit' },
  // ---------- 再加的 11 件法宝（arti2 分支）：前 6 件各有各的素材（配方在 tools/audio/recipes.ts），四海瓶起先借现有法宝的素材 ----------
  'xiangmo.fall': { off: true, files: ['xiangmo.fall'], db: -35, pitch: 1.5, gap: 120, voices: 2, synth: 'throw' },
  'xiangmo.land': { files: ['xiangmo.land'], db: -29, pitch: 2, gap: 450, voices: 1, synth: 'slam' },
  'wuguang.throw': { off: true, files: ['wuguang.throw'], db: -37, pitch: 2, gap: 80, voices: 2, synth: 'throw' },
  'wuguang.hit': { off: true, files: ['wuguang.hit'], db: -33, pitch: 2.5, gap: 40, voices: 4, synth: 'hit' },
  'zanxin.shot': { off: true, files: ['zanxin.shot'], db: -38, pitch: 3, gap: 60, voices: 3, synth: 'throw' },
  'zanxin.hit': { off: true, files: ['zanxin.hit'], db: -36, pitch: 3, gap: 40, voices: 3, synth: 'hit' },
  'zanxin.drill': { files: ['zanxin.drill'], db: -31, pitch: 1, gap: 1200, voices: 1, synth: 'block' },
  'jinjiao.dart': { off: true, files: ['jinjiao.dart'], db: -34, pitch: 1, gap: 150, voices: 2, synth: 'throw' },
  'jinjiao.snip': { files: ['jinjiao.snip'], db: -32, pitch: 2, gap: 1000, voices: 1, synth: 'hit' },
  'yanguang.plant': { files: ['yanguang.plant'], db: -36, pitch: 1, gap: 1500, voices: 1, synth: 'shield' },
  'yanguang.erupt': { files: ['yanguang.erupt'], db: -37, pitch: 2, gap: 1200, voices: 1, synth: 'flame' },
  'wanya.pour': { files: ['wanya.pour'], db: -35, pitch: -2, gap: 1500, voices: 1, synth: 'throw' },
  'wanya.peck': { off: true, files: ['wanya.peck'], db: -37, pitch: 3, gap: 50, voices: 3, synth: 'hit' },
  'wanya.boom': { files: ['wanya.boom'], db: -35, pitch: 1.5, gap: 1000, voices: 1, synth: 'flame' },
  // 四海瓶：倾瓶借玄元控水旗的水声，浪头涌起借飞刀破风（压低），砸下借水柱涌起（更低更重），翻浪冻住借寒潭封冻
  'sihai.pour': { files: v('dot.bleed', 2), db: -35, pitch: 2, gap: 1500, voices: 1 },
  'sihai.surge': { files: v('zhanxian.fly', 4), db: -38, pitch: -4, gap: 1200, voices: 1, synth: 'throw' },
  'sihai.crash': { files: v('dot.bleed', 2), db: -33, pitch: -2, gap: 900, voices: 1 },
  'sihai.freeze': { files: ['zone.frost'], db: -34, pitch: 1, gap: 1500, voices: 1, synth: 'ice' },
  // 雾露乾坤网：撒网借捆仙绳射出的绳子破风（轻），收网借捆仙绳一勒，乾坤水球砸下借玄元控水旗的一泼水
  'wulu.cast': { off: true, files: ['kunxian.throw'], db: -37, pitch: 2, gap: 200, voices: 1, synth: 'throw' },
  'wulu.spring': { files: ['kunxian.bind'], db: -36, pitch: 1.5, gap: 1200, voices: 1, synth: 'silk' },
  'wulu.slam': { files: ['xuanyuan.pool'], db: -32, pitch: -1, gap: 900, voices: 1 },
  // 七宝妙树：一刷借定风珠的一阵猛风（短、高一点），刷中借乾坤圈打中（闷一点），七宝飞出借青莲宝色旗回血的那声手铃，宝打中借乾坤圈打中（脆、高）
  'miaoshu.sweep': { files: ['dingfeng.gust'], db: -36, pitch: 3, gap: 1200, voices: 1, synth: 'throw' },
  'miaoshu.whack': { off: true, files: v('qiankun.hit', 3), db: -36, pitch: -1, gap: 50, voices: 3, synth: 'hit' },
  'miaoshu.gems': { files: ['qinglian.heal'], db: -35, pitch: 2, gap: 1500, voices: 1 },
  'miaoshu.hit': { off: true, files: v('qiankun.hit', 3), db: -38, pitch: 4, gap: 40, voices: 3, synth: 'hit' },
  // 瘟癀伞：撑伞借青莲宝色旗结界展开（低一点），滴瘟液借化血神刀的血雾（短），瘟传出去借化血神刀的血雾（更轻），瘟倒借化血神刀的噬魂
  'wenhuang.open': { files: ['qinglian.bloom'], db: -36, pitch: -3, gap: 2000, voices: 1, synth: 'shield' },
  'wenhuang.drip': { off: true, files: ['huaxue.mist'], db: -38, pitch: 3, gap: 80, voices: 2 },
  'wenhuang.spread': { off: true, files: ['huaxue.mist'], db: -40, pitch: 1, gap: 150, voices: 2 },
  'wenhuang.down': { files: ['huaxue.drain'], db: -37, pitch: -2, gap: 1500, voices: 1 },
  // 落宝金钱：金钱飞出 / 飞向下一只借乾坤圈出手（轻、高），敲一下借赵公明金鞭蹦出的金元宝（叮），落宝借乾坤袋生灵石的叮当
  'luobao.fly': { files: v('qiankun.throw', 3), db: -40, pitch: 4, gap: 1500, voices: 1, synth: 'throw' },
  'luobao.knock': { off: true, files: ['jinbian.ingot'], db: -37, pitch: 3, gap: 60, voices: 3, synth: 'coin' },
  'luobao.drop': { files: ['relic.pouch'], db: -33, pitch: 2, gap: 1200, voices: 1, synth: 'coin' },
  // ---------- 地面区域与持续伤害 ----------
  'zone.fire': { files: ['zone.fire'], db: -34, gap: 1500, voices: 1, synth: 'flame' },
  'zone.crack': { files: ['zone.crack'], db: -26.5, gap: 900, voices: 1, synth: 'slam' },
  'zone.frost': { files: ['zone.frost'], db: -33, gap: 1500, voices: 1, synth: 'ice' },
  'dot.bleed': { off: true, files: v('dot.bleed', 2), db: -35.5, pitch: 1.5, gap: 150, voices: 2 },
  // ---------- 五行相生 ----------
  'react.frost': { files: ['react.frost'], db: -24.5, gap: 900, voices: 1, synth: 'ice' },
  'react.conduct': { files: ['react.conduct'], db: -27.5, gap: 900, voices: 1, synth: 'thunder' },
  'react.ignite': { files: ['react.ignite'], db: -23.5, gap: 900, voices: 1, synth: 'flame' },
  'react.lava': { files: ['react.lava'], db: -25.5, gap: 900, voices: 1, synth: 'slam' },
  'react.pierce': { files: ['react.pierce'], db: -27.5, gap: 900, voices: 1, synth: 'block' },
  // ---------- 宠物 ----------
  'pet.fly': { files: v('pet.fly', 2), db: -36.5, gap: 1500, voices: 1, synth: 'silk' },
  'pet.wrap': { files: v('pet.wrap', 2), db: -35.5, gap: 1200, voices: 1, synth: 'silk' },
  'pet.evolve': { files: ['pet.evolve'], db: -16.5, pitch: 0, gap: 1000, voices: 1, synth: 'levelUp' },
  // ---------- 掉落 ----------
  'drop.spawn': { files: ['drop.spawn'], db: -31.5, gap: 200, voices: 2 },
  'drop.chest': { files: ['drop.chest'], db: -19.5, pitch: 0.3, gap: 300, voices: 1, synth: 'coin' },
  'drop.peach': { files: ['drop.peach'], db: -21.5, gap: 200, voices: 1 },
  'drop.magnet': { files: ['drop.magnet'], db: -22.5, pitch: 0.3, gap: 500, voices: 1 },
  // ---------- 首领 ----------
  'boss.intro': { files: ['boss.intro'], db: -11, pitch: 0, gap: 2000, voices: 1, synth: 'drumHit', duck: 0.4 },
  'boss.roar': { files: ['boss.roar'], db: -13, pitch: 0.5, gap: 1500, voices: 1, duck: 0.3 },
  'boss.phase': { files: ['boss.phase'], db: -10, pitch: 0, gap: 2000, voices: 1, synth: 'skill', duck: 0.4 },
  'boss.ring.warn': { files: ['boss.ring.warn'], db: -18, pitch: 0, gap: 500, voices: 1 },
  'boss.ring.throw': { files: ['boss.ring.throw'], db: -21.5, gap: 300, voices: 2, synth: 'throw' },
  'boss.dash.charge': { files: ['boss.dash.charge'], db: -18, pitch: 0, gap: 500, voices: 2 },
  'boss.dash': { files: ['boss.dash'], db: -18.5, gap: 200, voices: 3, synth: 'flame' },
  'boss.clone': { files: ['boss.clone'], db: -17, gap: 500, voices: 1 },
  'boss.sweep.warn': { files: ['boss.sweep.warn'], db: -18, pitch: 0, gap: 500, voices: 1 },
  'boss.sweep': { files: ['boss.sweep'], db: -19, gap: 300, voices: 1, synth: 'silk' },
  'boss.wheel.warn': { files: ['boss.wheel.warn'], db: -18, pitch: 0, gap: 500, voices: 1 },
  'boss.wheel': { files: ['boss.wheel'], db: -18, gap: 250, voices: 3, synth: 'flame' },
  'boss.miasma': { files: ['boss.miasma'], db: -17.5, pitch: 0, gap: 1000, voices: 1 },
  'boss.hurt': { files: v('boss.hurt', 2), db: -29, gap: 120, voices: 2, synth: 'hit' },
  'boss.death': { files: ['boss.death'], db: -9.5, pitch: 0, gap: 3000, voices: 1, synth: 'skill', duck: 0.6 },
  // ---------- 第一章的敌人（各有各的素材；满场小怪，音量压低）----------
  'enemy.spear.warn': { files: ['enemy.spear.warn'], db: -31, pitch: 1.5, gap: 300, voices: 2 },
  'enemy.spear': { files: v('enemy.spear', 2), db: -31, pitch: 1, gap: 300, voices: 2, synth: 'thrust' },
  'enemy.charge.warn': { files: ['enemy.charge.warn'], db: -27, pitch: 0.5, gap: 600, voices: 1 },
  'enemy.charge': { files: ['enemy.charge'], db: -27, gap: 500, voices: 1, synth: 'flame' },
  'enemy.fuse': { files: ['enemy.fuse'], db: -28, pitch: 1.5, gap: 200, voices: 2 },
  'enemy.explode': { files: ['enemy.explode'], db: -23, pitch: 1, gap: 150, voices: 2, synth: 'slam', duck: 0.1 },
  'enemy.split': { files: ['enemy.split'], db: -29, pitch: 1.5, gap: 120, voices: 2 },
  'enemy.guard': { files: v('enemy.guard', 2), db: -32, pitch: 1.5, gap: 400, voices: 1, synth: 'block' },
  // ---------- 功法（technique-fx.ts 的调用带着音量倍数：传火 0.5）----------
  'tech.learn': { files: ['tech.learn'], db: -20, pitch: 0, gap: 300, voices: 1, synth: 'levelUp' },
  'tech.thunder.warn': { files: ['tech.thunder.warn'], db: -28, pitch: 0.5, gap: 300, voices: 2 },
  'tech.thunder': { files: ['tech.thunder'], db: -23, pitch: 1, gap: 150, voices: 2, synth: 'thunder' },
  'tech.lotus': { files: ['tech.lotus'], db: -14, pitch: 0, gap: 2000, voices: 1, synth: 'levelUp', duck: 0.3 },
  'tech.reflect': { files: ['tech.reflect'], db: -27, pitch: 1, gap: 150, voices: 2, synth: 'block' },
  'tech.shatter': { files: ['tech.shatter'], db: -30, pitch: 1.5, gap: 90, voices: 3, synth: 'ice' },
  'tech.spread': { files: ['tech.spread'], db: -26, pitch: 1.5, gap: 100, voices: 3, synth: 'flame' },
  'tech.breath': { files: ['tech.breath'], db: -24, pitch: 0, gap: 1000, voices: 1 },
  // ---------- 杨戬（调用的倍数：横扫回手 0.8、连刺 0.8、劈山 0.9、裂地 0.8、哮天犬冲 0.8）----------
  'sanjian.sweep': { files: v('sanjian.sweep', 2), db: -31, pitch: 1, gap: 700, voices: 1, synth: 'throw' },
  'sanjian.stab': { off: true, files: v('sanjian.stab', 2), db: -30, pitch: 1.5, gap: 50, voices: 3, synth: 'thrust' },
  'sanjian.chop': { files: ['sanjian.chop'], db: -21, gap: 400, voices: 1, synth: 'slam', duck: 0.1 },
  'sanjian.rift': { files: ['sanjian.rift'], db: -25, gap: 500, voices: 1, synth: 'slam' },
  'tianyan.gaze': { files: ['tianyan.gaze'], db: -20, pitch: 0, gap: 500, voices: 1 },
  'xiaotian.dash': { files: ['xiaotian.dash'], db: -31, pitch: 1, gap: 1200, voices: 1, synth: 'silk' },
  'xiaotian.bite': { files: ['xiaotian.bite'], db: -32, pitch: 1.5, gap: 1000, voices: 1 },
  'xiaotian.evolve': { files: ['xiaotian.evolve'], db: -16.5, pitch: 0, gap: 1000, voices: 1, synth: 'levelUp' },
  // ---------- 赵公明（调用的倍数：定海珠出手 0.35–0.55、落地 0.25–0.8、再震 0.5–0.8、金鞭扬起 0.8、裂缝 0.7、元宝 0.3、黑虎冲 0.7、吼 0.35、破财 0.5）----------
  'dinghai.throw': { off: true, files: ['dinghai.throw'], db: -32, pitch: 1.5, gap: 60, voices: 3, synth: 'throw' },
  'dinghai.land': { files: v('dinghai.land', 2), db: -24, pitch: 1, gap: 400, voices: 1, synth: 'slam' },
  'dinghai.quake': { files: ['dinghai.quake'], db: -27, pitch: 1, gap: 500, voices: 1, synth: 'slam' },
  'jinbian.raise': { files: ['jinbian.raise'], db: -27, pitch: 0, gap: 300, voices: 1 },
  'jinbian.strike': { files: ['jinbian.strike'], db: -18, pitch: 0.5, gap: 400, voices: 1, synth: 'slam', duck: 0.2 },
  'jinbian.crack': { files: ['jinbian.crack'], db: -24, pitch: 1, gap: 200, voices: 1, synth: 'slam' },
  'jinbian.ingot': { off: true, files: ['jinbian.ingot'], db: -30, pitch: 2, gap: 60, voices: 4, synth: 'coin' },
  'heihu.dash': { files: ['heihu.dash'], db: -33, pitch: 1, gap: 1200, voices: 1, synth: 'silk' },
  'heihu.roar': { files: ['heihu.roar'], db: -15, pitch: 0.5, gap: 1000, voices: 1, duck: 0.15 },
  'heihu.broke': { files: ['heihu.broke'], db: -32, pitch: 1.5, gap: 1200, voices: 1, synth: 'coin' },
  'heihu.evolve': { files: ['heihu.evolve'], db: -16.5, pitch: 0, gap: 1000, voices: 1, synth: 'levelUp' },
  // ---------- 云霄（分支 yunxiao；调用的倍数：金斗飞 0.7、吸 0.8、浇 0.6、喷 0.7、落地 0.4–0.6、黄河浪打 0.7、青鸾冲 0.6、寒羽 0.7、冻住 0.6）----------
  'jindou.fly': { files: ['jindou.fly'], db: -32, pitch: 1, gap: 1200, voices: 1, synth: 'throw' },
  'jindou.suck': { files: ['jindou.suck'], db: -26, pitch: 0.5, gap: 300, voices: 1 },
  'jindou.pour': { files: ['jindou.pour'], db: -27, pitch: 1, gap: 200, voices: 1 },
  'jindou.spit': { files: ['jindou.spit'], db: -26, pitch: 1, gap: 200, voices: 1 },
  'jindou.land': { files: ['jindou.land'], db: -24, pitch: 1.5, gap: 400, voices: 1, synth: 'slam' },
  'huanghe.rise': { files: ['huanghe.rise'], db: -20, pitch: 0, gap: 600, voices: 1 },
  'huanghe.slam': { files: ['huanghe.slam'], db: -18, pitch: 0.3, gap: 500, voices: 1, synth: 'slam', duck: 0.2 },
  'huanghe.crash': { files: ['huanghe.crash'], db: -25, pitch: 1.5, gap: 500, voices: 1 },
  'qingluan.dive': { files: ['qingluan.dive'], db: -31, pitch: 1, gap: 1500, voices: 1, synth: 'silk' },
  'qingluan.feather': { off: true, files: ['qingluan.feather'], db: -29, pitch: 1.5, gap: 150, voices: 2 },
  'qingluan.frost': { files: ['qingluan.frost'], db: -28, pitch: 1, gap: 1200, voices: 1, synth: 'ice' },
  'qingluan.evolve': { files: ['qingluan.evolve'], db: -16.5, pitch: 0, gap: 1000, voices: 1, synth: 'levelUp' },
  // ---------- 灵物、符箓（relic-fx.ts 的调用都带着 0.3–0.8 的倍数，这里的响度按倍数之后落在 -24 ~ -33 一档）----------
  'relic.zhuo': { files: ['relic.zhuo'], db: -29.5, pitch: 1, gap: 1500, voices: 1, synth: 'throw' },
  'relic.zhuo.land': { files: ['relic.zhuo.land'], db: -21, pitch: 1, gap: 900, voices: 1, synth: 'slam' },
  'relic.jadedragon': { files: ['relic.jadedragon'], db: -21, pitch: 1, gap: 200, voices: 2 },
  'relic.mirror': { files: ['relic.mirror'], db: -22, pitch: 1, gap: 300, voices: 1 },
  'relic.umbrella': { files: ['relic.umbrella'], db: -26, pitch: 1, gap: 1000, voices: 1, synth: 'block' },
  'relic.pouch': { files: ['relic.pouch'], db: -25.5, pitch: 1, gap: 1500, voices: 1, synth: 'coin' },
  'relic.stormfeather': { files: ['relic.stormfeather'], db: -24.5, pitch: 1.5, gap: 1200, voices: 1 },
  'relic.icevase': { files: ['relic.icevase'], db: -22, pitch: 0.5, gap: 300, voices: 1, synth: 'ice' },
  'relic.gu': { files: ['relic.gu'], db: -29.5, pitch: 1.5, gap: 1500, voices: 1 },
  'relic.drum': { files: ['relic.drum'], db: -21, pitch: 0.3, gap: 300, voices: 1, synth: 'drumHit' },
  'relic.incense': { files: ['relic.incense'], db: -26, pitch: 1, gap: 1500, voices: 1 },
  'relic.dingshen': { files: ['relic.dingshen'], db: -22, pitch: 1, gap: 900, voices: 1 },
  'relic.yinlei': { files: ['relic.yinlei'], db: -22, pitch: 1, gap: 900, voices: 1, synth: 'thunder' },
  'relic.dundi': { files: ['relic.dundi'], db: -20, pitch: 0.5, gap: 300, voices: 1 },
  'relic.huiling': { files: ['relic.huiling'], db: -19, pitch: 0, gap: 400, voices: 1 },
  // ---------- 第二章：姚天君（落魂阵：阴森、摇铃）。招式的提示音与第一章首领的同一档（约 -18），一招里打出好几下的压低 ----------
  'yao.intro': { files: ['yao.intro'], db: -11.5, pitch: 0, gap: 2000, voices: 1, synth: 'drumHit', duck: 0.4 },
  'yao.bell': { files: ['yao.bell'], db: -18, pitch: 0.3, gap: 600, voices: 1 },
  'yao.banners': { files: ['yao.banners'], db: -20, gap: 600, voices: 1 },
  'yao.flag': { files: ['yao.flag'], db: -27, pitch: 1.5, gap: 90, voices: 3 },
  'yao.straw': { files: ['yao.straw'], db: -21, gap: 600, voices: 1 },
  'yao.formations': { files: ['yao.formations'], db: -18.5, pitch: 0, gap: 600, voices: 1 },
  'yao.burst.warn': { files: ['yao.burst.warn'], db: -20, pitch: 0, gap: 400, voices: 2 },
  'yao.burst': { files: ['yao.burst'], db: -18, gap: 300, voices: 2, duck: 0.15 },
  'yao.wave': { files: ['yao.wave'], db: -25, pitch: 1, gap: 150, voices: 3 },
  'yao.line': { files: ['yao.line'], db: -29, pitch: 1.5, gap: 120, voices: 3 },
  'yao.linebreak': { files: ['yao.linebreak'], db: -25, pitch: 1.5, gap: 150, voices: 2 },
  'yao.curse': { files: ['yao.curse'], db: -18.5, gap: 400, voices: 1 },
  'yao.root': { files: ['yao.root'], db: -21, gap: 300, voices: 1 },
  'yao.vanish': { files: ['yao.vanish'], db: -21, gap: 500, voices: 1 },
  'yao.appear': { files: ['yao.appear'], db: -25, gap: 500, voices: 1 },
  'yao.phase': { files: ['yao.phase'], db: -10, pitch: 0, gap: 2000, voices: 1, synth: 'skill', duck: 0.4 },
  // ---------- 第二章：地形「十阵轮转」（落雷每座阵约 1 秒一道，压着）----------
  'ten.warn': { files: ['ten.warn'], db: -25, pitch: 0.5, gap: 800, voices: 1 },
  'ten.thunder.on': { files: ['ten.thunder.on'], db: -28, gap: 800, voices: 1 },
  'ten.bolt.warn': { files: ['ten.bolt.warn'], db: -34, pitch: 1, gap: 250, voices: 2 },
  'ten.bolt': { files: ['ten.bolt'], db: -24, pitch: 1, gap: 200, voices: 2, synth: 'thunder' },
  'ten.water': { files: ['ten.water'], db: -27, gap: 800, voices: 1 },
  'ten.gold': { files: ['ten.gold'], db: -26, pitch: 0.3, gap: 800, voices: 1 },
  'ten.spawn': { files: ['ten.spawn'], db: -31, pitch: 1.5, gap: 150, voices: 2 },
  // ---------- 第二章：敌人（风吼妖最多八只、红沙傀儡碎得勤，都压低）----------
  'wind.warn': { files: ['wind.warn'], db: -32, pitch: 1.5, gap: 150, voices: 2 },
  'wind.dash': { files: ['wind.dash'], db: -28, pitch: 1.5, gap: 120, voices: 3, synth: 'throw' },
  'sand.burst': { files: ['sand.burst'], db: -28, pitch: 1, gap: 300, voices: 2, synth: 'slam' },
  // ---------- 第三章：地形「四剑轮斩」----------
  'sword.warn': { files: v('sword.warn', 3), db: -24, pitch: 0.8, gap: 300, voices: 2 },
  'sword.cut': { files: v('sword.cut', 2), db: -21.5, pitch: 0.8, gap: 150, voices: 2, synth: 'throw' },
  'sword.sweep': { files: ['sword.sweep'], db: -21.5, pitch: 0.5, gap: 200, voices: 2, synth: 'throw' },
  'sword.altars': { files: ['sword.altars'], db: -20, pitch: 0, gap: 1000, voices: 1 },
  // ---------- 第三章：敌人（飞剑灵最多九只、两秒一射，压得很低）----------
  'fly.aim': { files: ['fly.aim'], db: -36, pitch: 2, gap: 500, voices: 1 },
  'fly.shot': { files: v('fly.shot', 2), db: -32.5, pitch: 2, gap: 400, voices: 2, synth: 'throw' },
  'qi.cast': { files: ['qi.cast'], db: -33, pitch: 1.5, gap: 500, voices: 1, synth: 'cast' },
  'qi.throw': { files: ['qi.throw'], db: -30, pitch: 1.5, gap: 400, voices: 2, synth: 'throw' },
  'tether.on': { files: ['tether.on'], db: -37, pitch: 2, gap: 200, voices: 2 },
  'tether.cut': { files: ['tether.cut'], db: -30, pitch: 1.5, gap: 150, voices: 2 },
  // ---------- 第三章：首领诛仙剑灵（剑鸣、刃风、钟；招式提示同第一章首领那一档）----------
  'zx.intro': { files: ['zx.intro'], db: -11.5, pitch: 0, gap: 2000, voices: 1, synth: 'drumHit', duck: 0.4 },
  'zx.ring.warn': { files: ['zx.ring.warn'], db: -19, pitch: 0, gap: 500, voices: 1 },
  'zx.rain.warn': { files: ['zx.rain.warn'], db: -19, pitch: 0, gap: 500, voices: 1 },
  'zx.split': { files: ['zx.split'], db: -18.5, pitch: 0, gap: 600, voices: 1 },
  'zx.walls': { files: ['zx.walls'], db: -19, pitch: 0, gap: 600, voices: 1 },
  'zx.rush.warn': { files: ['zx.rush.warn'], db: -18.5, pitch: 0, gap: 500, voices: 1 },
  'zx.dash.warn': { files: ['zx.dash.warn'], db: -25, pitch: 0.5, gap: 150, voices: 2 },
  'zx.arc': { files: v('zx.arc', 2), db: -21, pitch: 1, gap: 120, voices: 3, synth: 'throw' },
  'zx.lane': { files: ['zx.lane'], db: -23, pitch: 1.5, gap: 120, voices: 3, synth: 'throw' },
  'zx.dash': { files: ['zx.dash'], db: -19, gap: 150, voices: 2, synth: 'flame' },
  'zx.wall': { files: ['zx.wall'], db: -19.5, gap: 250, voices: 2, synth: 'slam' },
  'zx.cell': { files: v('zx.cell', 2), db: -29, pitch: 2, gap: 70, voices: 4 },
  'zx.close.warn': { files: ['zx.close.warn'], db: -21, pitch: 0, gap: 800, voices: 1 },
  'zx.close': { files: ['zx.close'], db: -18, pitch: 0, gap: 800, voices: 1, synth: 'slam', duck: 0.15 },
  'zx.phase': { files: ['zx.phase'], db: -10, pitch: 0, gap: 2000, voices: 1, synth: 'skill', duck: 0.4 },
  // ---------- 劫数（选劫页、劫五的狂暴与分裂）----------
  'jie.pick': { files: ['jie.pick'], db: -19, pitch: 0, gap: 500, voices: 1 },
  'jie.rage': { files: ['jie.rage'], db: -13, pitch: 0, gap: 2000, voices: 1, synth: 'drumHit', duck: 0.35 },
  'jie.split': { files: ['jie.split'], db: -26, pitch: 1.5, gap: 150, voices: 2 },
  // ---------- 各章的精英与词缀（src/game/elites/）：还没有自己的素材，先借现有的文件（docs/audio.md「各章的精英与词缀」一行）----------
  'elite.yecha.dive': { files: ['xuanyuan.pool'], db: -34, pitch: 1.5, gap: 300, voices: 2 },
  'elite.yecha.rise': { files: ['xuanyuan.vortex'], db: -37, pitch: 1, gap: 400, voices: 1 },
  'elite.yecha.burst': { files: ['xuanyuan.pool'], db: -29, pitch: 1, gap: 200, voices: 2 },
  'elite.yecha.slap.warn': { files: ['enemy.spear.warn'], db: -33, pitch: 1.5, gap: 300, voices: 2 },
  'elite.yecha.slap': { files: ['dingfeng.gust'], db: -33, pitch: 1.5, gap: 200, voices: 2 },
  'elite.lishi.raise': { files: ['cast'], db: -36, gap: 300, voices: 1 },
  'elite.lishi.aegis': { files: ['xinghuang.up'], db: -33, gap: 400, voices: 1 },
  'elite.lishi.block': { files: v('enemy.guard', 2), db: -34, pitch: 1.5, gap: 120, voices: 2 },
  'elite.jianshi.aim': { files: ['enemy.spear.warn'], db: -35, pitch: 1.5, gap: 250, voices: 2 },
  'elite.jianshi.shot': { files: v('zhanxian.fly', 4), db: -32, pitch: 2, gap: 80, voices: 2 },
  'elite.jianshi.reform': { files: v('zhanxian.hit', 3), db: -36, pitch: 1, gap: 300, voices: 1 },
  'affix.recoil.warn': { files: ['enemy.charge.warn'], db: -32, pitch: 1, gap: 400, voices: 1 },
  'affix.recoil': { files: v('fantian.land', 2), db: -27, gap: 200, voices: 2, duck: 0.1 },
  'affix.summon.warn': { files: ['cast'], db: -35, gap: 300, voices: 1 },
  'affix.summon': { files: ['enemy.split'], db: -31, pitch: 1.5, gap: 200, voices: 2 },
  'affix.split': { files: ['jie.split'], db: -27, pitch: 1.5, gap: 150, voices: 2 },
  // ---------- 雷震子（分支 leizhenzi；src/game/heroes/staff-fx.ts、wing-fx.ts、pets/leipeng-fx.ts）：还没有自己的素材，先借现有的文件
  // （docs/audio.md「雷震子」一行），有了素材换掉文件名就行 ----------
  'huangjin.throw': { off: true, files: v('zhanxian.fly', 4), db: -29, pitch: 1, gap: 120, voices: 2, synth: 'throw' },
  'huangjin.slam': { files: v('fantian.land', 2), db: -21, gap: 120, voices: 2, synth: 'slam', duck: 0.1 },
  'huangjin.thunder': { files: v('leigong.strike', 2), db: -33, gap: 1500, voices: 1, synth: 'thunder' },
  'huangjin.sigil': { files: ['dingfeng.thunder'], db: -34, gap: 1000, voices: 1, synth: 'thunder' },
  'fenglei.rise': { files: ['dingfeng.gust'], db: -26, pitch: 0.5, gap: 600, voices: 1, synth: 'throw' },
  'fenglei.dive': { files: ['wind.dash'], db: -26, pitch: 1, gap: 600, voices: 1, synth: 'throw' },
  'fenglei.slam': { files: v('fantian.land', 2), db: -17, gap: 150, voices: 2, synth: 'slam', duck: 0.2 },
  'leipeng.stoop': { files: ['qingluan.dive'], db: -31, pitch: 1.5, gap: 1500, voices: 1, synth: 'silk' },
  'leipeng.zap': { files: ['react.conduct'], db: -32, pitch: 1.5, gap: 1200, voices: 1, synth: 'thunder' },
  'leipeng.twitch': { off: true, files: ['leigong.mark'], db: -38, pitch: 2, gap: 160, voices: 2 },
  'leipeng.evolve': { files: ['pet.evolve'], db: -16.5, pitch: 0, gap: 1000, voices: 1, synth: 'levelUp' },
  // ---------- 孙悟空（src/game/heroes/jingu-fx.ts、faxiang-fx.ts、pets/maohou-fx.ts、wukong-rift.ts）：还没有自己的素材，先借现有的文件（docs/audio.md「孙悟空」一行）----------
  'jingu.sweep': { files: v('sanjian.sweep', 2), db: -30, pitch: 1, gap: 700, voices: 1, synth: 'throw' },
  'jingu.smash': { files: ['sanjian.chop'], db: -21, pitch: 0.5, gap: 150, voices: 2, synth: 'slam', duck: 0.1 },
  'jingu.rock': { files: ['dinghai.quake'], db: -27, pitch: 1, gap: 500, voices: 1, synth: 'slam' },
  'jingu.pillar': { files: ['jinbian.strike'], db: -19, pitch: 0.5, gap: 200, voices: 1, synth: 'slam', duck: 0.2 },
  'jingu.churn': { files: ['xuanyuan.vortex'], db: -34, pitch: 1, gap: 200, voices: 2 },
  'faxiang.grow': { files: ['jinbian.raise'], db: -24, pitch: 0, gap: 1000, voices: 1 },
  'faxiang.stomp': { files: v('fantian.land', 2), db: -18, pitch: 0, gap: 500, voices: 1, synth: 'slam', duck: 0.2 },
  'faxiang.end': { files: ['tech.breath'], db: -25, pitch: 0, gap: 1000, voices: 1 },
  'maohou.blow': { files: ['dingfeng.gust'], db: -33, pitch: 2, gap: 1500, voices: 1 },
  'maohou.tease': { off: true, files: v('pet.wrap', 2), db: -35, pitch: 2, gap: 150, voices: 2 },
  'maohou.evolve': { files: ['pet.evolve'], db: -16.5, pitch: 0, gap: 1000, voices: 1, synth: 'levelUp' },
  'wukong.rift': { files: ['jinbian.crack'], db: -24, pitch: 0.5, gap: 1000, voices: 1 },
  // ---------- 修为页、联机大厅（界面声，和 ui.* 同一档）----------
  'xiuwei.light': { files: ['xiuwei.light'], db: -21, pitch: 0.5, gap: 120, voices: 2, synth: 'coin' },
  'xiuwei.reset': { files: ['xiuwei.reset'], db: -22, pitch: 0, gap: 300, voices: 1 },
  'lobby.join': { files: ['lobby.join'], db: -23, pitch: 0.5, gap: 300, voices: 1 },
  'lobby.leave': { files: ['lobby.leave'], db: -25, pitch: 0.5, gap: 300, voices: 1 },
  'lobby.ready': { files: ['lobby.ready'], db: -23, pitch: 0, gap: 150, voices: 1 },
  'lobby.start': { files: ['lobby.start'], db: -17, pitch: 0, gap: 1000, voices: 1, synth: 'drumHit' },
  'lobby.copy': { files: ['lobby.copy'], db: -25, pitch: 0.5, gap: 150, voices: 1 },
  // ---------- 对白与界面 ----------
  'dialogue.blip': { files: v('dialogue.blip', 2), db: -28.5, pitch: 3, gap: 45, voices: 2 },
  'ui.click': { files: ['ui.click'], db: -24.5, pitch: 1, gap: 40, voices: 2 },
  'ui.buy': { files: ['ui.buy'], db: -28.5, gap: 60, voices: 2, synth: 'coin' },
  'ui.lock': { files: ['ui.lock'], db: -23, gap: 60, voices: 1 },
  'ui.reroll': { files: ['ui.reroll'], db: -23.5, gap: 100, voices: 1 },
  'ui.ready': { files: ['ui.ready'], db: -23, pitch: 0, gap: 300, voices: 1 },
  'ui.denied': { files: ['ui.denied'], db: -23, pitch: 0, gap: 100, voices: 1 },
  'ui.levelup': { files: ['ui.levelup'], db: -20, pitch: 0, gap: 200, voices: 1, synth: 'levelUp' },
  // ---------- 通用（现有方法 hit / kill / pickup ... 改用素材，合成留作后备）----------
  kill: { files: Array.from({ length: 10 }, (_, i) => `kill.${i}`), db: -27.5, pitch: 0, jitter: 1, gap: 140, voices: 3, synth: 'kill' },
  'kill.elite': { files: ['kill.elite'], db: -14, pitch: 0, gap: 200, voices: 1, synth: 'eliteKill', duck: 0.2 },
  pickup: { files: ['pickup.lo', 'pickup.mid', 'pickup.hi'], db: -30.5, pitch: 0, jitter: 1, gap: 40, voices: 6, synth: 'pickup' },
  'hit.crit': { files: ['hit.crit'], db: -30, pitch: 0.5, gap: 2500, voices: 1 },
  hurt: { files: ['hurt'], db: -26.5, gap: 120, voices: 1, synth: 'hurt', duck: 0.35 },
  skill: { files: ['skill'], db: -10, pitch: 0, gap: 300, voices: 1, synth: 'skill', duck: 0.5 },
  drum: { files: ['drum'], db: -18, pitch: 0.3, gap: 150, voices: 2, synth: 'drumHit' },
  'wave.start': { files: ['wave.start'], db: -16, pitch: 0, gap: 500, voices: 1, synth: 'drumHit' },
  'wave.end': { files: ['wave.end'], db: -19.5, pitch: 0, gap: 500, voices: 1, synth: 'waveEnd' },
  levelup: { files: ['ui.levelup'], db: -22, pitch: 0, gap: 200, voices: 1, synth: 'levelUp' },
  cast: { files: ['cast'], db: -36.5, gap: 600, voices: 1, synth: 'cast' },
  orb: { files: ['orb'], db: -32, gap: 500, voices: 1, synth: 'orb' },
  dispel: { files: ['dispel'], db: -28.5, gap: 60, voices: 2, synth: 'dispel' },
};

/**
 * 配乐的名字。第一章是原来的三首（battle 战斗、boss 首领战、shop 波间整理，标题页也用 shop）；
 * 第二、三章各有自己的战斗曲与首领曲（battle.ch2 …，按章换用 chapterMusic）；ending 结局与致谢；calm 修为树、联机大厅（安静）。
 */
export type MusicTrack = 'battle' | 'boss' | 'shop' | 'battle.ch2' | 'boss.ch2' | 'battle.ch3' | 'boss.ch3' | 'ending' | 'calm';


export interface MusicDef {
  file: string; // public/audio/music/ 下的文件名（不含 .m4a）
  db: number; // 目标响度（2026-11-12 起整体抬了 3.5dB：密集战斗时配乐要压过音效，docs/audio.md「混音」）
  resume: boolean; // 再次切回来时从上次停下的地方接着放（首领战每次从头）
  /** 放这一首时，等它的文件下完再把这几首的文件也下下来（接下来多半要切过去的），到时候不用等下载。 */
  next?: MusicTrack[];
}

export const MUSIC: Record<MusicTrack, MusicDef> = {
  battle: { file: 'battle', db: -21.5, resume: true, next: ['boss'] },
  boss: { file: 'boss', db: -22.5, resume: false, next: ['battle.ch2'] },
  shop: { file: 'shop', db: -23.5, resume: true },
  'battle.ch2': { file: 'battle.ch2', db: -21.5, resume: true, next: ['boss.ch2'] },
  'boss.ch2': { file: 'boss.ch2', db: -22, resume: false, next: ['battle.ch3'] },
  'battle.ch3': { file: 'battle.ch3', db: -21.5, resume: true, next: ['boss.ch3'] },
  'boss.ch3': { file: 'boss.ch3', db: -22.5, resume: false, next: ['ending'] },
  ending: { file: 'ending', db: -22.5, resume: false },
  calm: { file: 'calm', db: -24.5, resume: true },
};

/** 有自己配乐的最后一章（再往后的章沿用它的）。 */
const MUSIC_CHAPTERS = 3;

/** 第 chapter 章的战斗曲（boss = false）或首领曲（boss = true）：第一章是原来的 battle / boss。 */
export function chapterMusic(chapter: number, boss: boolean): MusicTrack {
  const ch = Math.max(1, Math.min(MUSIC_CHAPTERS, Math.floor(chapter) || 1));
  if (ch === 1) return boss ? 'boss' : 'battle';
  return `${boss ? 'boss' : 'battle'}.ch${ch}` as MusicTrack;
}

/** 五声音阶（宫商角徵羽）的半音位置。 */
export const PENTA = [0, 2, 4, 7, 9];

/**
 * 拾取灵石的音高：连续拾取时沿五声音阶往上走一个八度，之后在这一个八度里打转（2026-11-12 起不再往高八度爬：用户嫌拾取声刺耳，
 * 现在拾灵石本身不出声，这里留给以后别处要用）。
 * 返回用哪个素材（pickup 的 files 下标：0 = 手钟 C4，1 = G#4，2 = C5）和变速倍率（只往下变：从高一点的素材往下放，不升调）。
 * 音阶是 B 宫五声（C# D# F# G# B），与击杀的古筝同调。
 */
export function pickupNote(streak: number): { file: number; rate: number } {
  const semis = [1, 3, 6, 8, 11][streak % 5]; // 相对 C4
  const [file, root] = semis <= 8 ? [1, 8] : [2, 12];
  return { file, rate: Math.pow(2, (semis - root) / 12) };
}
