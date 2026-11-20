# 音效与音乐

用户（2026-11-09）：音效、音乐先用免费公开的素材，以后有需要再自己做。所以：

- 素材只用许可清楚、可商用的：CC0 / 公有领域优先；需要署名的（CC-BY）要在下方「来源与许可」里写清楚，并在游戏的「致谢」里列出。
  不用需要登录才能下载的来源，不用许可不明的（例：qubodup 的「Energy Drain」页面写 CC0、包里附的却是 CC-BY-SA 3.0，就没用）。
- 素材放在 `public/audio/`（音效 `sfx/`、音乐 `music/`），都是 `.m4a`：音效单声道 AAC-LC 48kbps，音乐立体声 HE-AAC 48kbps（2026-11-12 瘦身前是 80 / 96kbps 的 AAC-LC，见下「瘦身」）。合计多大见 `node tools/audio/check.ts` 的最后一行（2026-11-12：九首曲子 5.6 MB、246 个音效文件 1.7 MB，合计 7.3 MB；瘦身前 10.9 + 3.4 = 14.3 MB）。随游戏发布的致谢文件是 `public/audio/CREDITS.txt`（同一命令生成）。
- 代码里按**名字**播放：`sfx.play('名字', 音量倍数)`、`sfx.music('曲名' | null)`（曲名见下面名字表的「音乐」；按章的战斗曲、首领曲用 `chapterMusic(章, 是不是首领战)` 取）。素材缺失或还没加载好时用旧的合成音效顶上（见 `src/audio/bank.ts` 每个名字的 `synth`），都没有就不出声。

## 怎么用

- `sfx.unlock()` 必须在用户的第一次按键或点击里调用（iOS / 微信的要求）；解锁之后才开始懒加载：先加载战斗里最常响的音效，再加载其余，最后把第一章的三首曲子（`battle` `boss` `shop`）的文件预先下下来。别的曲子在放到它的前一首时才下：每首曲子在 `bank.ts` 的 `MUSIC[曲名].next` 里写着接下来多半要切到哪几首（第一章首领 → 第二章战斗 → 第二章首领 → ……），这一首的文件下完就顺带把它们下下来（不解码）。
- `sfx.play(name, volume = 1)`：每次随机偏一点音高（默认往下最多 0.6 半音、往上最多 0.5 半音，见下「尖锐度」）和音量（±1.5 dB），同名有最短间隔（默认 50ms，一帧打死几十只时只响一两声），同名同时最多几声（默认 4，超出时最早的一声快速淡出）。各名字的响度、间隔、声部数在 `src/audio/bank.ts`，素材自身的响度差由 `src/audio/assets.gen.ts` 记录的测量值自动抹平。
- `sfx.music(track)`：循环播放，切换时交叉淡入淡出（新曲 1.2 秒淡入、旧曲 1.5 秒淡出）；战斗和整理再切回来时接着上次的地方放，首领战每次从头。音乐比音效低，大音效（受伤、神通、首领登场）时让位。还没解锁时调用也行，解锁后自动开始。有音乐时，原来合成的鼓点层自动停下，音乐停了它才接着响。
- 原有的方法（`hit` `kill` `pickup` `throw` `hurt` `skill` `drumHit` `levelUp` `waveStart` `waveEnd` `coin` `thrust` `flame` `thunder` `slam` `ice` `shield` `block` `silk` `cast` `orb` `dispel`）都改用素材，合成留作后备。`setMiasma`（魔气嗡鸣）是持续的参数化声音，仍用合成。
- 拾取灵石现在不出声（2026-11-12，用户嫌刺耳）；`sfx.pickup` 还留着：手钟在一个八度里沿五声音阶打转、只往下变速。击杀的古筝按连斩选音，同调（B 宫五声）。
- 音量（设置里的三条滑块，存在本地存档里）：`sfx.setVolumes({ master, sfx, music })`，值是滑块的位置 0..1（只传要改的），平方后换成增益，立即生效；还没解锁时先记下，解锁时按它建总线。总线分三级：主音量管所有声音；音效一级下面是素材、合成音效和魔气的嗡鸣；音乐一级下面是配乐和（没有配乐时的）合成鼓点。`sfx.volumes` 读现在的三个值。
- 暂停与后台：`sfx.pauseMusic()` 把配乐很快淡出、停在原处（合成鼓点也停，界面音效照常能响），`sfx.resumeMusic()` 从停下的地方接着放（首领曲也是接着放，不从头）；暂停期间 `sfx.music()` 换曲子只记下，继续时再放。暂停面板（`src/game/pause.ts`）打开、关上时调它们。`sfx.suspend()` / `sfx.resume()` 停下、恢复整个音频（`AudioContext`）：页面切到后台时用——桌面浏览器的后台标签页不会自己停。全游戏共用的那个音效对象（`front-ui.ts` 的 `uiSfx()`）已经挂好了页面可见性的监听，别处不用再管。
- 调试：控制台里 `__sfx.play('boss.roar')`、`__sfx.music('boss')` 可以直接试听，`__sfx.stats()` 看加载情况（也带着三个音量、各级增益、配乐是不是停着）。

## 名字表

各处特效调用的名字。要新名字就在这里加一行，再按下面「怎么加、换一个声音」补素材。

| 分组 | 名字 |
|---|---|
| 法宝 | `qiankun.throw` `qiankun.hit` `qiankun.hover` `huojian.thrust` `jiulong.burst` `leigong.strike` `leigong.mark` `fantian.fall` `fantian.land` `xinghuang.up` `xinghuang.block` `xinghuang.break` `zhanxian.fly` `zhanxian.hit` `hanbing.frost` `hanbing.spike` |
| 法宝（后加的 8 件：画面在 `src/game/fx-new.ts`，事件见 `src/sim/types.ts`；2026-11-11 起各有各的素材） | `dashen.fall`（打神鞭从天落下：细的高破风）`dashen.lash`（抽中：硬木一声脆响、一点雷的余韵）`dashen.shock`（仙品落点震波：闷的低音）`huaxue.slash`（化血神刀血光斩：湿的刃声）`huaxue.mist`（血雾：低的嘶声）`huaxue.drain`（噬魂回血：倒放的鬼声往回收、暖的铃）`dingfeng.whirl`（定风珠起旋风：转着的风）`dingfeng.gust`（吹散 / 定海：一阵猛风）`dingfeng.thunder`（风雷落雷）`qinglian.bloom`（青莲结界展开：筝上滑、铃树）`qinglian.thorn`（荆棘刺：细枝一折）`qinglian.heal`（结界回血：轻的手铃）`yinyang.beam`（阴阳镜光束扫出：镜面擦出来的亮音）`yinyang.freeze`（两道照到冻住）`xuanyuan.pool`（玄元控水旗水柱涌起：一泼水）`xuanyuan.vortex`（漩涡：转着的水声）`xuanyuan.freeze`（寒潭封冻）`wuhuo.fan`（五火七禽扇扇出火浪：风 + 腾起的火）`wuhuo.bird`（七禽火鸟：扑翅似的布声带火苗）`wuhuo.scorch`（焚风焦土）`kunxian.throw`（捆仙绳金绳射出）`kunxian.bind`（捆住：绳子一勒的吱声）`kunxian.clash`（缚仙互撞：闷响） |
| 法宝（再加的 11 件：画面在 `src/game/fx-new2.ts`，事件见 `src/sim/types.ts`；前 6 件各有各的素材；四海瓶起先借现有法宝的素材：倾瓶 `sihai.pour` 借 `dot.bleed`，浪头 `sihai.surge` 借 `zhanxian.fly`（压低），砸下 `sihai.crash` 借 `dot.bleed`（更低更重），翻浪 `sihai.freeze` 借 `zone.frost`；撒网 `wulu.cast` 借 `kunxian.throw`，收网 `wulu.spring` 借 `kunxian.bind`，乾坤水球砸下 `wulu.slam` 借 `xuanyuan.pool`；一刷 `miaoshu.sweep` 借 `dingfeng.gust`，刷中 `miaoshu.whack`、宝打中 `miaoshu.hit` 借 `qiankun.hit`，七宝飞出 `miaoshu.gems` 借 `qinglian.heal`；撑伞 `wenhuang.open` 借 `qinglian.bloom`，滴瘟液 `wenhuang.drip`、瘟传出去 `wenhuang.spread` 借 `huaxue.mist`，瘟倒 `wenhuang.down` 借 `huaxue.drain`；金钱飞 `luobao.fly` 借 `qiankun.throw`，敲一下 `luobao.knock` 借 `jinbian.ingot`，落宝 `luobao.drop` 借 `relic.pouch`） | `xiangmo.fall`（降魔杵脱手飞出，warn）`xiangmo.land`（砸地，land）`wuguang.throw`（五光石掷出，throw）`wuguang.hit`（石子打中 / 五色光打中）`zanxin.shot`（攒心钉连发，throw）`zanxin.hit`（钉进去）`zanxin.drill`（钉满钻心）`jinjiao.dart`（金蛟扑出去）`jinjiao.snip`（交剪）`yanguang.plant`（焰光旗插下 / 重插）`yanguang.erupt`（地火窜起）`wanya.pour`（倾壶放出鸦群）`wanya.peck`（火鸦啄中）`wanya.boom`（仙品火鸦自焚）`sihai.pour`（倾瓶，throw）`sihai.surge`（浪头涌起，zone）`sihai.crash`（浪头砸下）`sihai.freeze`（仙品翻浪冻住）`wulu.cast`（撒网，throw）`wulu.spring`（收网）`wulu.slam`（仙品乾坤水球砸下）`miaoshu.sweep`（绕身一刷，zone）`miaoshu.whack`（刷中）`miaoshu.gems`（七宝飞出）`miaoshu.hit`（一宝打中）`wenhuang.open`（撑伞，zone）`wenhuang.drip`（伞尖滴瘟液）`wenhuang.spread`（瘟传给身边的）`wenhuang.down`（仙品叠满瘟倒）`luobao.fly`（金钱飞出 / 飞向下一只）`luobao.knock`（敲一下）`luobao.drop`（落宝多掉灵石） |
| 地面区域与持续伤害 | `zone.fire` `zone.crack` `zone.frost` `dot.bleed` |
| 五行相生 | `react.frost` `react.conduct` `react.ignite` `react.lava` `react.pierce` |
| 宠物 | `pet.fly` `pet.wrap` `pet.evolve` |
| 掉落 | `drop.spawn` `drop.chest` `drop.peach` `drop.magnet` |
| 敌人（第一章；`src/game/enemy-fx.ts`） | `enemy.spear.warn`（长矛兵蓄力：矛杆一绷）`enemy.spear`（一矛刺出）`enemy.charge.warn`（骑兵亮出冲锋线：马打响鼻、蹄子刨地）`enemy.charge`（冲锋：一串马蹄）`enemy.fuse`（自爆鬼点燃爆符：符纸嗤嗤地烧）`enemy.explode`（炸开：爆竹似的一声炸）`enemy.split`（分魂鬼分裂：轻的鬼声裂开）`enemy.guard`（盾兵正面挡下：木盾一挡） |
| 首领 | `boss.intro` `boss.roar` `boss.phase` `boss.ring.warn` `boss.ring.throw` `boss.dash.charge` `boss.dash` `boss.clone` `boss.sweep.warn` `boss.sweep` `boss.wheel.warn` `boss.wheel` `boss.miasma` `boss.hurt` `boss.death` |
| 第二章：姚天君（`src/game/ch2/yao-fx.ts`；落魂阵：阴森、摇铃） | `yao.intro`（入场：锣、铃摇几下、一缕鬼声）`yao.bell`（摇铃：一只手铃按铃舌来回撞的节奏叠六下）`yao.banners`（插幡：布声、低的破风）`yao.flag`（一面幡插进地里）`yao.straw`（草人：干草窸窣）`yao.formations`（起阵：擦镲、刮锣、低鼓滚）`yao.burst.warn`（聚魂）`yao.burst`（魂爆）`yao.wave`（魂波：铃声荡开）`yao.line`（魂线）`yao.linebreak`（魂线断）`yao.curse`（拜魂：草人烧掉、鬼叫扑过来）`yao.root`（定魂：链子一收）`yao.vanish`（隐进雾里）`yao.appear`（显形）`yao.phase`（换阶段：大锣、乱摇的铃、长的鬼哭）；受击、倒下沿用 `boss.hurt` `boss.death` |
| 第二章：地形「十阵轮转」（`src/game/ch2/terrain-fx.ts`） | `ten.warn`（阵要亮了：阵旗猎猎、低鼓滚起来）`ten.thunder.on`（天绝阵亮起：电光噼啪）`ten.bolt.warn`（天雷要落：电光往上聚）`ten.bolt`（天雷落下：从天上劈下来的炸雷，比雷公鞭重、尾巴长）`ten.water`（红水阵涨起：水声涌上来、冒泡）`ten.gold`（金光阵亮起：风铃、铃树、手铃）`ten.spawn`（金光阵边冒兵：一蓬土） |
| 第二章：敌人（`src/game/ch2/foe-fx.ts`） | `wind.warn`（风吼妖蓄风：倒放的风声往里收）`wind.dash`（风吼妖冲出去：呼啸的风）`sand.burst`（红沙傀儡碎开：碎石、沙土）；落魂幡手的魂光没有单独的声音 |
| 第三章：地形「四剑轮斩」（`src/game/ch3/terrain-fx.ts`） | `sword.warn`（出鞘：拔剑、剑身一声轻鸣）`sword.cut`（剑气沿直线飞过：快的刃风）`sword.sweep`（剑光扫过扇面：更沉的破风）`sword.altars`（四剑归阵：四把剑先后出鞘、一口低的钟） |
| 第三章：敌人（`src/game/ch3/foe-fx.ts`） | `fly.aim`（飞剑灵瞄准：剑身发颤的细鸣）`fly.shot`（飞剑灵射出）`qi.cast`（截教门徒聚气）`qi.throw`（掷出月牙剑气）`tether.on`（阵图傀儡连上剑气线：很轻的「叮」）`tether.cut`（剑气线断） |
| 第三章：首领诛仙剑灵（`src/game/ch3/zhuxian-fx.ts`；最终战：剑鸣、刃风、钟） | `zx.intro`（入场：倒放的刮刃声往上收、钟、大锣）`zx.ring.warn`（四剑环斩：剑绕身转）`zx.rain.warn`（剑雨：剑往天上升）`zx.split`（一剑化四）`zx.walls`（四剑归阵：低的金属长鸣）`zx.rush.warn`（连续突进：刮刃声由弱到强）`zx.dash.warn`（每一冲之前）`zx.arc`（环斩一剑）`zx.lane`（剑气直线）`zx.dash`（突进）`zx.wall`（剑气墙扫过）`zx.cell`（剑雨里一柄剑插进地里）`zx.close.warn`（诛仙剑阵要收一圈）`zx.close`（收一圈：一圈剑同时落下）`zx.phase`（换阶段：大锣、剑鸣、钟）；受击、倒下沿用 `boss.hurt` `boss.death` |
| 对白与界面 | `dialogue.blip` `ui.click` `ui.buy` `ui.lock` `ui.reroll` `ui.ready` `ui.denied` `ui.levelup` |
| 功法（`src/game/technique-fx.ts`；没素材时的后备见各处的 `play(名字, 后备)`） | `tech.learn`（悟得一门：清的手铃、铃树、很轻的锣，和升级的筝分开）`tech.thunder.warn`（五雷正法聚云：云里的闷雷由弱到强）`tech.thunder`（天雷落下：炸雷、电火花、一点三角铁的亮）`tech.lotus`（莲花化身重生：低锣、筝缓缓上滑、手铃与风铃）`tech.reflect`（金刚不坏反弹：一口铃、金属的「当」）`tech.shatter`（寒冰诀冰碎：细的冰碴）`tech.spread`（三昧真火传火：火苗「呼」地窜过去）`tech.breath`（吐纳术每波回气：长长的吸气似的风、很轻的手铃） |
| 杨戬（`src/game/heroes/sanjian-fx.ts`、`gaze-fx.ts`、`src/game/pets/xiaotian-fx.ts`） | `sanjian.sweep`（三尖两刃刀横扫：长兵器抡开的沉破风）`sanjian.stab`（刺）`sanjian.chop`（劈山落刀：重破风、砸进地里）`sanjian.rift`（地上裂开：岩石崩裂、地底闷响）`tianyan.gaze`（天眼的金光：亮的长音扫过去）`xiaotian.dash`（哮天犬冲出去：一声短吠）`xiaotian.bite`（咬一口：咬合、低吼）`xiaotian.evolve`（进化：一声长嚎、筝上滑） |
| 赵公明（`src/game/heroes/dinghai-fx.ts`、`jinbian-fx.ts`、`src/game/pets/heihu-fx.ts`；土行：石、金、虎） | `dinghai.throw`（定海珠飞出：沉的珠子破风、珠串一碰）`dinghai.land`（珠子砸地：闷砸、碎石、珠子「笃」的一声）`dinghai.quake`（石纹再震）`jinbian.raise`（金鞭虚影扬起：往上走的亮）`jinbian.strike`（拍下：沉的金属砸地、大鼓、轻锣）`jinbian.crack`（金缝裂开：岩石崩开、缝里一串金色的铃）`jinbian.ingot`（金元宝蹦出）`heihu.dash`（黑虎扑出去：短的低吼）`heihu.roar`（吼一声震慑：低沉的大吼）`heihu.broke`（破财多掉灵石：一把钱撒出来）`heihu.evolve`（进化：长的大吼、锣、筝上滑） |
| 云霄（`src/game/heroes/dou-fx.ts`、`river-fx.ts`、`src/game/pets/qingluan-fx.ts`，还在分支 yunxiao 上；合进 main 就用上） | `jindou.fly`（混元金斗飞出：沉的破风、金斗低低一嗡）`jindou.suck`（吸住一片：风往斗口里卷）`jindou.pour`（浇下去：倒水声）`jindou.spit`（喷出：一股水猛地喷出）`jindou.land`（落地：水花、闷的一砸）`huanghe.rise`（九曲黄河涌起：大水由远及近）`huanghe.slam`（黄河拍下：一大片水砸下来）`huanghe.crash`（浪头打在敌人身上）`qingluan.dive`（青鸾俯冲：快的扑翅）`qingluan.feather`（寒羽：轻风、细的冰响）`qingluan.frost`（冻住）`qingluan.evolve`（进化：筝上滑、手铃、风铃） |
| 回响化身（还没有素材；括号里是没素材时先借的现有声音，见 `src/game/heroes/heiyan-fx.ts`、`huizhao-fx.ts`、`huiyun-fx.ts` 的 `play`） | 魔化哪吒：`heiyan.roll`（黑焰轮滚出去 → `boss.wheel`）`heiyan.lotus`（红莲炸开 → `jiulong.burst`）`tujin.charge`（火尖枪突进蓄力 → `boss.dash.charge`）`tujin.dash`（冲出去 → `boss.dash`）；回响赵公明：`fulong.throw`（缚龙索甩出 → `kunxian.throw`）`fulong.clash`（拽到一起撞一下 → `kunxian.clash`）`fulong.slam`（千钧砸下 → `fantian.land`）`dingtou.nail`（钉上草人符 → `leigong.mark`）`dingtou.strike`（七箭落下 → `leigong.strike`）`yuanli.burst`（怨力震开 → `boss.roar`）；回响云霄：`qiankuntu.unroll`（乾坤图铺开 → `yinyang.beam`）`qiankuntu.press`（山影压下 → `fantian.land`）`xueding.cast`（黄河阵摆下 → `xuanyuan.vortex`）；宠物黑绫、魂虎、玄鸾用本人宠物的声音 |
| 回响化身遭遇战（还没有素材；括号里是先借的，见 `src/game/echo-fx.ts` 的 `play`） | `echo.intro`（现身 → `boss.intro`）`echo.phase`（换二阶段 → `boss.phase`）`echo.defeat`（打倒 → `boss.death`）`echo.throw`（回响赵公明的珠子飞出 → `qiankun.throw`）`echo.bead`（珠子砸地 → `fantian.land`）`echo.whip`（金鞭裂地 → `dashen.lash`）`echo.tiger`（黑虎现形 → `boss.roar`）`echo.pounce`（虎扑 → `enemy.charge`）`echo.roar`（虎吼 → `boss.roar`）`echo.dou`（回响云霄的金斗扣下 → `xuanyuan.pool`）`echo.river`（旋涡翻起 → `xuanyuan.vortex`）`echo.luan`（青鸾掠过 → `pet.fly`） |
| 孙悟空（src/game/heroes/jingu-fx.ts、faxiang-fx.ts、src/game/pets/maohou-fx.ts、src/game/wukong-rift.ts、wukong-shots.ts；分支 wukong；**还没有自己的素材，先借现有的**：代码里是 play(名字, 后备)，名字表里有了素材就自动换上） | `jingu.sweep`（金箍棒横扫一圈：长棍抡开的沉破风；先借 sanjian.sweep）`jingu.smash`（竖劈砸地；先借 sanjian.chop）`jingu.rock`（定海的石刺扎出来；先借 dinghai.quake）`jingu.pillar`（擎天柱的虚影压下来；先借 jinbian.strike）`jingu.churn`（搅海翻卷的水声；先借 xuanyuan.vortex）`faxiang.grow`（法天象地长大；先借 jinbian.raise）`faxiang.stomp`（长足一踏；先借 fantian.land）`faxiang.end`（缩回原样；先借 tech.breath）`maohou.blow`（毫毛猴吹毫毛；先借 dingfeng.gust）`maohou.tease`（小猴分身拍一下；先借 pet.wrap）`maohou.evolve`（进化；先借 pet.evolve）`wukong.rift`（标题页点开天上的裂缝；先借 jinbian.crack）。解锁过场里的几声直接放现有的（jinbian.crack 裂缝撕开、zhanxian.fly 棒子落下、fantian.land 插在峰顶、pet.fly 猴子翻出来、dinghai.land 落地、qiankun.hover 裂缝合上），解锁卡是 ui.levelup |
| 法宝（再加的 11 件，分支 arti2） | 已经定了名字的先做好了素材（public/audio/sfx 下同名的文件，配方在 recipes.ts），arti2 的 bank.ts 已经从借来的声音指到这些文件；四海瓶起还在借（借了什么见上面名字表里「再加的 11 件」那一行）：降魔杵 xiangmo.fall / xiangmo.land、五光石 wuguang.throw / wuguang.hit、攒心钉 zanxin.shot / zanxin.hit / zanxin.drill、金蛟剪 jinjiao.dart / jinjiao.snip、离地焰光旗 yanguang.plant / yanguang.erupt、万鸦壶 wanya.pour / wanya.peck / wanya.boom |
| 灵物、符箓（`src/game/relic-fx.ts`） | `relic.zhuo`（金刚琢飞出：金属环转着飞）`relic.zhuo.land`（砸中）`relic.jadedragon`（九龙玉佩龙息：长风、低的兽息、玉佩一声清）`relic.mirror`（照妖镜照出：镜光一闪）`relic.umbrella`（混元伞挡下鬼火：伞面一兜）`relic.pouch`（乾坤袋生灵石：袋子一抖、宝石叮当）`relic.stormfeather`（风雷羽小雷）`relic.icevase`（冰心玉壶无伤：玉壶一声清、冷的冰裂）`relic.gu`（噬心蛊噬血：虫子一口）`relic.drum`（夔牛鼓擂鼓：大鼓咚咚两下）`relic.incense`（燃魂香燃血：香头一亮）`relic.dingshen`（定身符：符纸「啪」地贴上、一声铃）`relic.yinlei`（引雷符：符纸一燃、雷劈下来）`relic.dundi`（遁地符：钻进地里）`relic.huiling`（回灵符：符纸一展、暖的手铃、筝一拨） |
| 劫数（`src/game/jie-pick.ts`、`src/game/jie-fx.ts`） | `jie.pick`（选定一劫入局：一口低的钟、很轻的锣、远处的闷雷）`jie.rage`（劫五首领狂暴，跟着「狂暴」横幅：两下沉的大鼓、锣边一刮、往下沉的不祥的响）`jie.split`（劫五带「分裂」的精英裂开：撕开似的鬼声） |
| 各章的精英与词缀（`src/game/elites/fx.ts`、`affix-fx.ts`；还没有自己的素材，`src/audio/bank.ts` 里先指向括号里那个现有的文件，有了素材换掉文件名就行） | `elite.yecha.dive`（东海夜叉沉进水里 → `xuanyuan.pool`）`elite.yecha.rise`（水下停住、亮出要冒出来的那一片 → `xuanyuan.vortex`）`elite.yecha.burst`（冒出水面 → `xuanyuan.pool`）`elite.yecha.slap.warn`（举叉 → `enemy.spear.warn`）`elite.yecha.slap`（砸下、浪推过去 → `dingfeng.gust`）`elite.lishi.raise`（金光力士举旗 → `cast`）`elite.lishi.aegis`（套上金光 → `xinghuang.up`）`elite.lishi.block`（金光挡下一下 → `enemy.guard`）`elite.jianshi.aim`（截教剑侍的剑指向人物 → `enemy.spear.warn`）`elite.jianshi.shot`（射出 → `zhanxian.fly`）`elite.jianshi.reform`（三柄重新聚齐 → `zhanxian.hit`）`affix.recoil.warn`（反震蓄力 → `enemy.charge.warn`）`affix.recoil`（震开 → `fantian.land`）`affix.summon.warn`（召唤掐诀 → `cast`）`affix.summon`（回响兵冒出来 → `enemy.split`）`affix.split`（分魂 → `jie.split`） |
| 雷震子（`src/game/heroes/staff-fx.ts`、`wing-fx.ts`、`src/game/pets/leipeng-fx.ts`；还没有自己的素材，`src/audio/bank.ts` 里先指向括号里那个现有的文件） | `huangjin.throw`（黄金棍掷出 → `zhanxian.fly`）`huangjin.slam`（砸下 → `fantian.land`）`huangjin.thunder`（落在棍头的雷 → `leigong.strike`）`huangjin.sigil`（雷纹再炸 → `dingfeng.thunder`）`fenglei.rise`（双翅一展腾空 → `dingfeng.gust`）`fenglei.dive`（俯冲 → `wind.dash`）`fenglei.slam`（俯冲砸下 → `fantian.land`）`leipeng.stoop`（雷鹏俯冲 → `qingluan.dive`）`leipeng.zap`（麻到 → `react.conduct`）`leipeng.twitch`（麻着的一颤，很轻 → `leigong.mark`）`leipeng.evolve`（进化 → `pet.evolve`） |
| 修为页、联机大厅（`src/game/xiuwei.ts`、`src/game/lobby.ts`；别的按钮照旧用 `ui.*`） | `xiuwei.light`（点亮一节：木印按在纸上、一声清的手铃）`xiuwei.reset`（重置：揭纸、风铃往下走）`lobby.join`（有人进房：铃树一颗铃、风铃往上）`lobby.leave`（有人走了 / 掉线：风铃往下、木鱼低的一声）`lobby.ready`（准备：拍板两下、手铃）`lobby.start`（房主开局：大鼓、锣）`lobby.copy`（链接复制好了） |
| 通用（原有方法用的，也可以直接 play） | `kill`（古筝，按连斩选音）`kill.elite` `pickup`（手钟，按连拾选音；现在拾灵石不调它）`hit.crit` `hurt` `skill` `drum` `wave.start` `wave.end` `levelup` `cast` `orb` `dispel` |
| 音乐 | `battle`（第一章战斗）`boss`（第一章首领战）`shop`（波间整理、标题页）`battle.ch2`（第二章战斗）`boss.ch2`（第二章首领姚天君）`battle.ch3`（第三章战斗）`boss.ch3`（第三章首领诛仙剑灵）`ending`（通关、致谢页）`calm`（修为页、联机大厅） |

`node tools/audio/check.ts` 列出每个名字有没有素材、缺素材时的合成后备（`--md` 输出表格），并核对文件与 `assets.gen.ts` 是否一致。

## 怎么加、换一个声音

1. 找素材：许可要清楚（见开头）。每个来源单独下载到 `scratch/downloads/<来源>/` 的新目录（不进 git），只解压、挑出音频文件，不执行里面的任何东西。
2. 在 `tools/audio/recipes.ts` 的 `SOURCES` 里登记来源（标题、作者、许可、网址），在 `SFX` / `MUSIC` 里写配方：取哪段、变速、滤波、和别的素材怎么叠（层上写 `norm: 0` 先把这一层的峰值拉齐再按 `gain` 叠，各素材录音的电平差得多时好估）。
   机器上只有 macOS 的 `afconvert`（能读 wav / ogg / mp3 / flac，能写 AAC），裁剪、淡出、混合、响度归一在 `tools/audio/build.ts` 里用 JS 做。
3. `node tools/audio/build.ts`（`--only sfx/名字` 只重做一部分）：生成 `public/audio/` 下的 `.m4a` 和 `src/audio/assets.gen.ts`。
4. 在 `src/audio/bank.ts` 里把名字指到文件，调响度 `db`（相对值，频繁的小声音约 -30，首领登场这类大事件约 -10）。
5. `node tools/audio/check.ts` 检查（`--measure` 把成品逐个解码，复量时长、响度、峰值，音乐另外量循环接缝）；`node tools/audio/build.ts --credits --write` 重新生成下面的来源与许可表和 `public/audio/CREDITS.txt`。
6. 开着开发服务器跑 `node tools/audio/verify.mjs --port <端口>`：浏览器里点一下解锁，确认每个名字的素材都加载、放得出来，九首配乐都能解码开始放（`--chapters` 再看换章换曲、`--pages` 再看修为 / 致谢 / 大厅的换曲）。听不见，只能这样看状态。

## 瘦身（2026-11-12，分支 soften）

用户：「开始瘦身」。音频是包里最大的一块（`node tools/bundle-size.mjs` 量 `dist/`：改前音频 281 个文件 14.6 MB，占全部 20.5 MB 的七成）。

| | 改前 | 改后 |
|---|---|---|
| 配乐（9 首） | 10.9 MB（AAC-LC 96kbps 立体声） | **5.6 MB**（HE-AAC 48kbps 立体声；循环段不剪，长度、循环点照旧，第三章换的新曲长了 48 秒） |
| 音效 | 3.4 MB（272 个，AAC-LC 80kbps 单声道） | **1.7 MB**（246 个，AAC-LC 48kbps 单声道） |
| `dist/` 里的音频合计 | 14.6 MB | **7.4 MB** |
| `dist/` 全部 | 20.5 MB | 12.4 MB（字体那一块是 feat/loading 合进来的瘦身） |

做法（`tools/audio/build.ts`）：

- **配乐改用 HE-AAC**（`recipes.ts` 的 `codec: 'aach'`，macOS 的 `afconvert -d aach`）：低频部分照常编码、高频用 SBR 参数化重建，48kbps 的听感接近原来 96kbps 的 AAC-LC，体积约一半。**解码**（`node tools/audio/codec-probe.mjs`，Playwright 的三个内核各解一遍）：Chromium（Chrome、Edge、安卓上的 Chrome 和多数套壳）、WebKit（Safari、iOS 上所有浏览器、微信）、Firefox 三个内核都解得了，时长对得上（WebKit 把编码延迟和结尾补的样本都去掉了，时长与构建时一字不差；Chromium 多出约 0.07 秒、Firefox 约 0.1 秒的开头延迟），三个内核里也都实际让 `__sfx.music()` 放过三首、量到的开头延迟和上面一致、音效全部加载；所以**全部换成 HE-AAC，没有留 AAC-LC 的后备**。（Playwright 的 WebKit 是 macOS 上的 WebKit，用的是系统的 AAC 解码器，和 iOS 一样；安卓 Chrome 用的是 Chromium 自带的解码器。没有真机试过。）
  HE-AAC 的编码延迟比 AAC-LC 长，播放器按「第一个响的样本比构建时晚了多少」自动对齐（`player.ts` 的 `measureShift`，上限从 0.1 秒放到 0.18 秒），循环点照样对得上；`check.ts --measure` 复量九首的接缝都在门槛内。
- **音效降到 48kbps**：音效都去过尖锐，8 kHz 以上本来就几乎没有，48kbps 的 AAC-LC 编码器在这个码率下的低通（约 11 kHz）切不到什么。
- **去掉 m4a 里的空白**（`tools/audio/m4a.ts`）：`afconvert` 写的 `.m4a` 顶层留着约 2.5 KB 的 `free` 填充，几百个只有几 KB 的音效里它占了快三分之一；去掉它、把 `stco` 里的块偏移跟着减，音频数据一个字节不动。`moov` 里的 `udta`（约 250 B，里面的 iTunSMPB 记着编码延迟和结尾补的样本数）留着。
- **尾巴截得更紧**：音效在峰值以下 40dB 就截（原来 45dB），淡出照旧。
- **不再用的音效直接删**：「武器少出声」里标了 `off` 的名字只用到的 26 个文件（`build.ts` 只做被名字表引用的成品）。

**音质上可能听得出差别的**：HE-AAC 的高频是重建出来的，镲、铜管顶上的「空气感」会比原来略「平」一点——但配乐本来就压了 5 kHz 以上（去尖锐），最可能听出来的是第三章首领的「Hitman」（合唱、镲最多）和第一章的「Aggressor」（镲多）；安静的「Ripples」古筝独奏、「Nu Flute」笛子几乎不受影响。音效 48kbps 对重低音的大事件（首领登场、神通的锣）没有影响，最可能听出颗粒的是长的风声、水声（`huanghe.rise`、`dingfeng.whirl`）。

## 武器少出声、音效压到配乐之下（2026-11-12，分支 soften）

用户（2026-11-12）：「音效也不需要所有武器都有，武器打击的音效不应该盖过背景音乐。」

**规则**（`src/audio/bank.ts`）：

- **不出声**（名字上标 `off: true`，35 个）：快而密的法宝**出手与命中**、一招里打出很多下的那几下——乾坤圈出手与命中、火尖枪刺、雷公鞭的标记、番天印下落的破风、斩仙飞刀飞出与命中、寒冰幡冰刺、打神鞭下落、化血神刀的血雾、青莲的荆棘、七禽火鸟、捆仙绳射出与捆住、降魔杵脱手、五光石、攒心钉、金蛟剪扑出、万鸦壶的啄、雾露乾坤网撒网、七宝妙树刷中与打中、瘟癀伞滴液与传瘟、落宝金钱敲一下、持续伤害、三尖两刃刀连刺、定海珠飞出、金元宝蹦出、青鸾寒羽、黄金棍掷出、雷鹏麻着的一颤、毫毛猴拍一下。名字和配方都留着，去掉 `off` 再跑 `node tools/audio/build.ts` 就回来（`build.ts` 只做被引用的成品，`check.ts` 把它们列成「不出声（off）」）。它们的 26 个成品文件已经删掉，不进包。
- **很稀地响**（同名间隔拉到 0.9–2 秒、同时只一声、再轻 2–3dB）：慢一点的法宝的出手、一招只响一下的（雷公鞭落雷 1.5 秒一声、九龙神火罩 0.9 秒、定风珠、阴阳镜、玄元控水旗、五火七禽扇、灵物……）、五行相生、宠物的飞与缠、刷得最密的几种敌人（鬼火术士蓄力 0.6 秒、鬼火 0.5 秒、骑兵、飞剑灵）。
- **留着、只把间隔拉开一点**（0.35–0.5 秒）：有分量的时刻——几件慢而重的法宝落地（番天印、降魔杵、定海珠、金鞭、打神鞭的震波、三尖两刃刀劈山与裂地、黄河拍下）、神通、首领出招与登场、精英、劫数、进化、升级、界面。
- **暴击**：命中本身不响，暴击时偶尔一声手钟（`hit.crit` 同名间隔 2.5 秒）。**击杀的古筝**留着，但同名间隔 34 → 140ms、同时 6 → 3 声、轻 3dB。

**混音**（`src/audio/sfx.ts`）：

- 音效总线电平 0.9 → 0.5（−5dB），配乐的目标响度整体抬 3.5dB（`MUSIC[*].db`）。
- **越密越轻**（`updateDensity`）：记最近一秒里出了几声（指数衰减，τ = 1 秒），超过 3 声以后每多一声整条音效总线压 0.6dB，最多压 6dB；稀下来 0.3 秒的时间常数慢慢回来。
- 音量滑块的默认值没改（主 0.8、音效 1、音乐 1）：上面两条已经把比例摆好，玩家存过的设置也照样有效。

**量**（`node tools/audio/usage.mjs --wave 10 --secs 20 --runs 2`：第 10 波、机器人打两局各 20 秒，音效总线在兜底之后、配乐总线在音乐音量之前各接一个 K 加权的分析器）：

| | 每秒几声（平均 / 最密的一秒） | 音效 − 配乐，瞬时（400ms）中位 / 90 分位 | 音效 − 配乐，短时（3 秒）中位 / 90 分位 |
|---|---|---|---|
| 改前（main） | 12.7 / 21 | +7.1 / +14.8 LU | +7.3 / +11.3 LU |
| 只少出声 + 越密越轻 | 6.1 / 12 | +2.3 / +11.0 LU | +3.5 / +6.0 LU |
| 再加电平 | 6.3 / 12 | −5.6 / +2.9 LU | **−5.0 / −1.5 LU** |
| 再换了第二章的战斗曲、配乐 HE-AAC（现在） | 6.7 / 16 | −7.8 / +0.9 LU | **−5.9 / +0.7 LU** |

密集战斗里音效的短时响度比配乐低约 5 LU，最响的 10% 时刻也还在配乐之下；单独一声大事件（首领登场、神通、受伤）瞬时还会冒到配乐上面一点，这是想要的。

## 尖锐度：去掉一切刺耳的声音（2026-11-12，分支 soften）

用户（2026-11-12）：「现在捡东西的音效太刺耳了……所有尖锐的声音都不应该存在。需要降调或者是别的方法。」没法试听，就量。

**怎么量**（`node tools/audio/sharp.ts`，`--md` 出下表，`--legacy --dir <改前的成品目录>` 按改前的规则量改前的文件，`--before` 两份对照）：每个名字取它几个变体里最刺的那个，按播放时**往上最多偏几个半音**换算（频率乘上那个变速）后量：

- **尖锐度 S**（acum，近似 Zwicker / DIN 45692）：能量加权的平均频谱按 A 计权分 24 个临界频带，特定响度按 0.23 次方律（假定最响的频带高出听阈 60dB），3 kHz 往上的频带按 g(z) 加重。
- **8k+**：8 kHz 以上能量占比（嘶、咝）；**2–5k**：2–5 kHz 的能量占比（耳朵最敏感、最「扎」的一段；钟琴、三角铁、金属的「叮」都在这里，S 对它们不敏感，所以单列）。都按 A 计权之后的能量算。
- **起音**：包络从峰值的 10% 升到 90% 的毫秒数；**一局次数**：`node tools/audio/usage.mjs`（`?wave=N&bot`，量 20 秒模拟时间里每个名字真正出声的次数）第 4、10、15 波各一局合起来；界面、商店里的声音机器人在战斗里量不到，按一局约 20 分钟、18 次整理估了每分钟的次数（`ui.click` 8、`ui.buy` 5、`levelup` 3……）。排序按「刺耳分 ×（1 + log₂(1 + 次数)）」，刺耳分 = S ×（1 + 2·2–5k + 4·8k+），起音短于 3ms 再乘 1.15。

**门槛**（暂定）：**温和** = S ≤ 1.8 且 8k+ ≤ 2% 且 2–5k ≤ 35%；**刺** = S > 2.3 或 8k+ > 6% 或 2–5k > 60%；夹在中间是**偏亮**。参照：大鼓 1.1、古筝（`kill`）1.4、木鱼似的 `ui.click` 1.4 都是温和；改前的钟琴（拾灵石、暴击）、三角铁、电火花、冰碴、剑鸣都在 3–5。

**结果**：改前 285 个素材里温和 83、偏亮 78、刺 124；改后 **285 个全部温和**（构建时的目标再留余量：S ≤ 1.7、8k+ ≤ 1.5%、2–5k ≤ 32%）。合成后备 22 个改前刺 6、偏亮 6，改后全部温和。下表按改前的排名列前 30 个（改前是旧的变调规则：对称的 ±pitch，拾灵石最高往上爬约 11 个半音）：

| # | 名字 | 一局次数 | 尖锐度 S（acum） | 重心 Hz | 8k+ | 2–5k | 起音 ms | 往上半音 | 档 | 改前 S | 改前重心 | 改前 8k+ | 改前 2–5k | 改前往上 | 改前档 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | pickup | — | 1.21 | 845 | 0.0% | 0.1% | 7.1 | 0.0 | 温和 | 4.90 | 8081 | 99.3% | 0.0% | 11.1 | 刺 |
| 2 | hanbing.spike | 7 | 1.46 | 1702 | 0.0% | 29.3% | 16.9 | 0.5 | 温和 | 3.55 | 6464 | 39.2% | 27.3% | 1.0 | 刺 |
| 3 | leipeng.twitch | — | 1.46 | 1841 | 0.0% | 31.7% | 0.1 | 0.5 | 温和 | 5.10 | 8717 | 60.2% | 13.6% | 2.0 | 刺 |
| 4 | hit.crit | 7 | 1.21 | 867 | 0.0% | 0.1% | 7.1 | 0.5 | 温和 | 3.07 | 3304 | 0.8% | 99.1% | 0.5 | 刺 |
| 5 | leigong.mark | — | 1.46 | 1841 | 0.0% | 31.7% | 0.1 | 0.5 | 温和 | 4.90 | 8190 | 52.8% | 14.7% | 0.6 | 刺 |
| 6 | kunxian.bind | 25 | 1.12 | 1439 | 0.0% | 4.4% | 17.4 | 0.5 | 温和 | 2.57 | 2776 | 2.7% | 65.5% | 1.0 | 刺 |
| 7 | fly.shot | 10 | 1.63 | 1326 | 0.2% | 15.4% | 16.1 | 0.5 | 温和 | 2.75 | 4143 | 28.5% | 19.2% | 2.0 | 刺 |
| 8 | lobby.leave | — | 1.51 | 1466 | 0.1% | 16.4% | 4.7 | 0.5 | 温和 | 3.69 | 7960 | 73.7% | 6.4% | 0.5 | 刺 |
| 9 | dispel | — | 1.53 | 1295 | 0.0% | 0.3% | 4.9 | 0.5 | 温和 | 4.84 | 6520 | 26.8% | 25.2% | 0.6 | 刺 |
| 10 | sword.warn | 3 | 1.35 | 1801 | 0.0% | 21.1% | 131.1 | 0.5 | 温和 | 3.74 | 5268 | 7.0% | 53.7% | 0.8 | 刺 |
| 11 | fly.aim | 10 | 1.19 | 1682 | 0.0% | 30.8% | 776.6 | 0.5 | 温和 | 2.17 | 3414 | 0.1% | 77.3% | 2.0 | 刺 |
| 12 | sihai.freeze | — | 1.27 | 1730 | 0.0% | 28.7% | 1.8 | 0.5 | 温和 | 3.93 | 5613 | 17.2% | 48.6% | 1.0 | 刺 |
| 13 | zx.rain.warn | — | 1.25 | 1628 | 0.0% | 26.0% | 21.2 | 0.0 | 温和 | 4.43 | 7010 | 33.0% | 19.8% | 0.0 | 刺 |
| 14 | zone.frost | — | 1.27 | 1730 | 0.0% | 28.7% | 1.8 | 0.5 | 温和 | 3.87 | 5518 | 16.3% | 49.3% | 0.6 | 刺 |
| 15 | xinghuang.block | 3 | 1.09 | 1479 | 0.0% | 21.3% | 29.7 | 0.5 | 温和 | 3.26 | 5987 | 15.1% | 35.8% | 0.6 | 刺 |
| 16 | xiangmo.fall | 9 | 1.06 | 1703 | 0.0% | 0.5% | 33.2 | 0.5 | 温和 | 2.05 | 2689 | 0.9% | 75.0% | 1.5 | 刺 |
| 17 | tech.shatter | — | 1.24 | 1600 | 0.0% | 22.8% | 2.3 | 0.5 | 温和 | 3.37 | 5176 | 20.8% | 52.5% | 1.5 | 刺 |
| 18 | cast | 49 | 1.38 | 1628 | 0.0% | 30.4% | 124.8 | 0.5 | 温和 | 1.66 | 2139 | 0.0% | 49.2% | 0.6 | 偏亮 |
| 19 | ten.gold | — | 1.69 | 1023 | 0.0% | 6.4% | 18.4 | 0.3 | 温和 | 4.30 | 5497 | 32.6% | 7.3% | 0.3 | 刺 |
| 20 | xinghuang.up | — | 1.69 | 2237 | 0.0% | 31.7% | 8.1 | 0.5 | 温和 | 3.84 | 4843 | 15.4% | 56.2% | 0.6 | 刺 |
| 21 | elite.lishi.aegis | — | 1.69 | 2237 | 0.0% | 31.7% | 8.1 | 0.5 | 温和 | 3.84 | 4843 | 15.4% | 56.2% | 0.6 | 刺 |
| 22 | react.frost | — | 1.45 | 1737 | 0.0% | 30.7% | 1.2 | 0.5 | 温和 | 3.24 | 4947 | 19.1% | 45.7% | 0.6 | 刺 |
| 23 | jinjiao.snip | — | 1.53 | 1109 | 0.0% | 10.1% | 1.8 | 0.5 | 温和 | 4.28 | 5239 | 28.3% | 8.4% | 2.0 | 刺 |
| 24 | dialogue.blip | 4 | 1.54 | 1713 | 0.0% | 12.7% | 6.2 | 0.5 | 温和 | 2.53 | 2622 | 0.4% | 66.4% | 3.0 | 刺 |
| 25 | ui.buy | 5 | 1.56 | 1228 | 0.0% | 15.2% | 7.9 | 0.5 | 温和 | 2.43 | 4392 | 3.4% | 41.0% | 0.6 | 刺 |
| 26 | yao.root | — | 1.20 | 1668 | 0.0% | 32.6% | 7.4 | 0.5 | 温和 | 3.41 | 7265 | 36.3% | 20.0% | 0.6 | 刺 |
| 27 | enemy.fuse | 3 | 1.55 | 1707 | 0.1% | 21.5% | 1.6 | 0.5 | 温和 | 2.77 | 4025 | 15.7% | 34.0% | 1.5 | 刺 |
| 28 | wind.warn | 2 | 1.05 | 1449 | 0.0% | 23.8% | 144.6 | 0.5 | 温和 | 2.57 | 4866 | 7.4% | 63.0% | 1.5 | 刺 |
| 29 | tether.cut | 1 | 1.52 | 1884 | 0.0% | 27.4% | 5.1 | 0.5 | 温和 | 3.01 | 5294 | 26.1% | 37.9% | 1.5 | 刺 |
| 30 | miaoshu.sweep | — | 1.15 | 1545 | 0.0% | 23.9% | 41.7 | 0.5 | 温和 | 2.95 | 6260 | 31.5% | 28.2% | 3.0 | 刺 |

（这张表是第一件做完时量的。之后「武器少出声」把其中 `hanbing.spike`、`leipeng.twitch`、`leigong.mark`、`kunxian.bind`、`xiangmo.fall` 等设成了不出声，「瘦身」把音效降到 48kbps；降完复量 250 个还在响的名字仍然全部温和。）

**怎么改的**（几种手段一起用）：

- **成品逐个去尖锐**（`tools/audio/build.ts` 的 `SOFT_LADDER`）：每个音效混好之后过一道「两级低通 + 3.5 kHz 起高架衰减 + 3 kHz 一带削一点 + 整体降调（重采样，`maxLen` 和淡出跟着放长，截的还是原来那段内容）」，从第 0 档（低通 11 kHz、高架 −2dB、削 −1.5dB、不降调）起逐档加重到第 8 档（低通 2.6 kHz、高架 −10dB、削 −5dB、降 7 个半音），量到温和为止；同一个名字的几个变体用同一档（古筝的十个音、拾灵石的三个音之间的音程不变）。响度归一在去尖锐之后，所以每个音效播放时的响度和原来一样（K 加权的最大瞬时响度对齐到 −12）。档位分布（现在的 246 个成品）：第 0 档 122 个、1 档 25、2 档 24、3 档 18、4 档 9、5 档 10、6 档 11、7 档 11、8 档 16（第 8 档的：杏黄旗格挡与破碎、首领掷环蓄力、姚天君魂波与定魂、风吼妖蓄风、红沙傀儡、剑阵剑雨、化血神刀、定风珠猛风、三尖两刃刀横扫、混元金斗喷出与落地）。开头的淡入从 2ms 直线改成 4ms 半余弦，起音不再是一道硬边。配方可以写 `soft: { min, max, pitch: false }` 指定起点、上限、只滤不降调。
- **换素材**：钟琴全部换成 VCSL 的手钟（Hand Chimes，同一个 CC0 来源）低两个八度左右：`hit.crit`、`pickup.*`、`ui.buy`、`drop.chest`、`jinbian.ingot`、`heihu.broke`、`wuguang.hit`、`relic.pouch`、`lobby.copy`；`dispel`（乾坤圈打散鬼火）原来是铃树 + 三角铁，改成手钟为主、铃树压到很轻。剑鸣、刀剑相击那几层（`metal-ringing` 16 处、剑气、出鞘、拔剑）在配方里先低通到 1.8–3.5 kHz、金属余音再放慢三成。
- **去掉**：拾灵石（含收灵）不出声（`feel.ts`，之前已改）；`pickupNote` 不再往高八度爬，只在一个八度里、只往下变速。
- **变调只往下**：`bank.ts` 的 `pitch` 改成「往下最多 pitch、往上最多 `UP_MAX` = 0.5 个半音」，调用方给的变速也不让它往上超过 0.5 个半音；要整体更高 / 更低用新的 `shift`。原来写 `pitch: 3`、`pitch: 4` 想让借来的声音「高一点、脆一点」的几个（`miaoshu.hit`、`luobao.fly`、`zanxin.*` 等）现在平均反而略低。
- **音效总线兜底**（`sfx.ts` 的 `tameBus`）：所有音效（素材、合成后备、魔气）进主音量之前再过 4.5 kHz 起高架衰减 4dB、3 kHz 削 2dB、10 kHz 低通、一道软限幅（门限 −16dB、拐点 12dB、4:1、起 4ms、放 200ms），叠在一起的尖峰也压住。
- **合成后备**（素材没加载好时现场合成的）：单独再过一道 2.4 kHz 低通 + 2 kHz 起高架 −5dB（`synBus`）；方波、锯齿换成三角波 / 正弦，频率降下来（冰 2093→1047 Hz、打散鬼火 1568→784、铜钱 1975/2637→988/1319、拾取 1319→659、挡下 880→440、升级的拨弦低一个八度、雷的高通噪声改成 1 kHz 带通、鼓点层的「嚓」从 4 kHz 高通改成 1.8 kHz 带通）。

**响度没掉**：`node tools/audio/usage.mjs --wave 10`（同一波、机器人打 20 秒）量音效总线（改后在兜底之后、主音量之前）的瞬时响度：改前中位 −23.0、90 分位 −17.4；改后中位 −23.0、90 分位 −19.4——整体一样响，叠起来的尖峰低了约 2 LU。成品逐个的响度、峰值和 `assets.gen.ts` 一致（`node tools/audio/check.ts --measure`）。

**拿不准、待试听的**：降得最多的第 8 档那 16 个（尤其杏黄旗格挡、三尖两刃刀横扫、化血神刀：低通到 2.6 kHz、降 7 个半音之后会闷、拖长约一半，可能不像刀剑了）；手钟换钟琴之后的暴击、买东西、金元宝（从「叮」变成柔和的「咚——」）；乾坤圈打散鬼火。听着太闷就在配方里给它写 `soft: { max: 4 }` 之类的上限。

## 音乐

| 曲目 | 用作 | 乐器 | 循环 |
|---|---|---|---|
| 自作「破阵」（150 BPM，2026-11-13 用户选定；`tools/audio/compose/`） | 战斗 `battle`（第一章） | 太鼓、锣、木鼓（VCSL 采样）、古筝领奏、合成低音、低音弦乐 | 前奏 4 小节（6.4 秒）只放一次，之后 6.4–89.6 秒（52 小节）循环 |
| Kevin MacLeod「Big Mojo」（171 BPM） | 首领战 `boss` | 打击乐、筝（koto）、笛、弦乐、电子低音 | 原曲开头 30 秒几乎无声，从 31.3 秒（鼓点进来前的上扬）截起；之后 13.8–100.8 秒（62 小节）循环 |
| Kevin MacLeod「Guzheng City」 | 波间整理、标题页 `shop` | 古筝、手鼓 | 整首循环，结尾 1.5 秒与开头交叉淡化 |
| Kevin MacLeod「Black Vortex」（7/8 拍，2026-11-12 换） | 第二章战斗 `battle.ch2` | 铜管（含低音号、钦巴索）、弦乐、木管、合成器：管弦与电子的混合 | 原曲前 40 秒是慢的铺垫：从 40 秒那一下全奏截起，47.22–150.01 秒循环（中间有一段收着的，再推上去） |
| Kevin MacLeod「Himalayan Atmosphere」（112 BPM） | 第二章首领 `boss.ch2`（姚天君：阴森、摇铃） | 颂钵、打击乐 | 12.37–98.08 秒（40 小节）循环（曲子本身就是这一段的逐字重复，接缝前 0.4 秒波形互相关 0.997） |
| Kevin MacLeod「Volatile Reaction」（7/4 拍、155 BPM，2026-11-12 换） | 第三章战斗 `battle.ch3`（诛仙阵：暗、凶） | 铜管轰鸣、低音木管、弦乐、打击乐 | 首次从头放；51.85–154.82 秒（38 小节）循环 |
| Kevin MacLeod「Hitman」（75 BPM） | 第三章首领 `boss.ch3`（诛仙剑灵，最终战） | 合唱、弦乐、低音、打击乐 | 前 50 秒有一段收着的过门：从 48.7 秒（51 秒那一下全奏之前）截起，之后 62.27–151.85 秒（28 小节）循环；这首没有逐字重复的段落，接缝按频带能量最像的一对挑，交叉放长到 0.35 秒 |
| Kevin MacLeod「Nu Flute」 | 通关、致谢页 `ending` | 笛子（曲子说明里写的是 dizi）、弦乐 | 整首循环，结尾 1.5 秒的余音与开头交叉淡化 |
| Kevin MacLeod「Ripples」 | 修为页、联机大厅 `calm`（安静） | 古筝独奏 | 独奏的速度是松的，不按小节：在两处乐句之间的空隙（都低于 -50dB）里截，51.4–133.4 秒循环，接缝两边都是空隙里的余音，交叉 1 秒 |

循环点用 `node tools/audio/loopfind.ts <音频> <起点范围> <终点范围>` 找：在候选区间里找两处，使它们之前的一段声音（频带能量和起音）最像，找出来的长度正好是整小节；构建时把循环终点前 0.12 秒混回循环起点之前的同长片段，播放时两段之间再做 50ms 交叉，接缝处波形连续、没有咔哒声（没法试听，接缝是按波形和频谱检查的）。

第二、三章那几首另外做了两件事：终点在 ±25ms 里按「两边之前 0.4 秒的波形互相关」逐样本细调（鼓点、拨弦的起音对得上）；构建时的交叉按两段的相关系数 ρ 归一
（配方里 `loop.match`：两段加起来的功率恒定，逐字重复的段落不会像等功率交叉那样在中间鼓起约 3dB）。

**量接缝**：`node tools/audio/check.ts --measure` 把成品逐个解码，按播放器的接法拼出接缝，和「顺着放过循环起点」对照，量三样：每 50ms 的包络偏离（dB，只比够响的格子）、
接缝附近的高频（咔哒）比、循环终点和起点之前各 1 秒的频谱相似。2026-11-11 量的结果：九首都在「包络偏离 ≤ 2.7dB、咔哒比 ≤ 1.7、频谱相似 ≥ 0.97」以内
（新加的六首：包络 0.0–1.8dB、咔哒比 0.24–1.40）。

挑选时没法试听，是按曲目说明里的乐器和风格、加上频谱和响度分析选的。听着不合适就换：首领战的备选有「Mountain Emperor」（太鼓 + 甘美兰，战鼓味重），整理的备选有「Ripples」（古筝独奏，更静）、「Nu Flute」（笛子）。

第二、三章的曲子（2026-11-11，暂拟，待试听确认）也是这样挑的：在 incompetech 的曲目表（1443 首，带乐器、风格标签和说明）里按「东方 / 黑暗 / 史诗 / 打击乐」筛出二十来首，下下来逐首量每 6–8 秒的响度、低频占比、起音密度、立体声宽度，再看频谱图。
备选（不合适就换，配方在 `tools/audio/recipes.ts`）：第二章战斗「Mountain Emperor」（只有太鼓和甘美兰，鼓点重、没有苍凉的弦乐）、「Tabuk」（中东味）；
第二章首领「Mystic Force」（甘美兰，更密、更有推进感，但标签里有「Calming」）、「Asian Drums」（只有鼓，阴森，没有铃）；
第三章战斗「The Descent」（铜管行进，更「史诗」、没那么压抑）；第三章首领「Five Armies」（铜管、弦乐，结尾很亮）；结局「Long Road Ahead」（合唱、铜管，西洋味重）。
`scratch/` 里留着找循环点的工具（按小节、比较两边各 6 秒前、3 秒后的频带能量与起音）；循环点也都用 `node tools/audio/check.ts --measure` 量过接缝（见下）。

### 换战斗曲（2026-11-12，分支 soften）

用户：「战斗歌曲可以选一些流行的」，后来说清楚：「我的意思是适合当前游戏的配乐，不要限制国风、电子、古典，也可以是古风的。」——要适合封神、洪荒、割草爽快，节奏有劲、气势足，不要人声歌词。

**换了三首战斗曲**，首领曲、整理、结局、安静页面的没换（首领的「Big Mojo」171 BPM 本来就猛，姚天君、诛仙剑灵的两首合场景）。三首都是 Kevin MacLeod（CC-BY 4.0，和原来九首同一作者同一许可，署名已进致谢、`CREDITS.txt` 与 `src/game/credits.ts` 的内置署名）：

| 章 | 原来 | 换成 | 为什么 |
|---|---|---|---|
| 第一章 `battle` | 「Shenyang」二胡、琵琶、扬琴，130 BPM，曲目说明写的是「Bright, Relaxed」，每秒起音 2–4 个 | 「Aggressor」管弦速度金属，150 BPM，「Action, Driving」，每秒起音 5–6 个、从头到尾一直是满的 | 割草要一上来就冲；鼓组配上整个管弦乐团，有「神话大战」的气势，又不是西洋流行歌 |
| 第二章 `battle.ch2` | 「Eastern Thought」99 BPM，「Mystical, Relaxed」，每秒起音约 2 个 | 「Black Vortex」7/8 拍的管弦 + 合成器，「Action, Aggressive, Epic, Intense」，进入快段后每秒起音约 6 个 | 史诗、一刻不停；7/8 拍的错落正合十绝阵的诡谲 |
| 第三章 `battle.ch3` | 「Oppressive Gloom」59 BPM，近乎送葬的行进 | 「Volatile Reaction」7/4 拍、155 BPM，铜管轰鸣、打击乐砸下来，「Action, Aggressive, Dark, Intense」 | 诛仙阵要暗、凶，但不能拖；原曲太慢 |

怎么挑的（没法试听）：在 incompetech 的曲目表（1443 首，带 BPM、乐器、风格标签、说明）里按「Action / Driving / Epic / Intense」、BPM ≥ 115、不含人声筛出几十首，按说明和乐器挑十来首下下来，量每 8 秒的响度和起音密度（`scratch` 里的小脚本）、整体尖锐度。也翻了 OpenGameArt 上东方、史诗战斗的曲子。
**备选**（不合适就换，下好的和量过的）：「Movement Proposition」（打击乐、低音、圆号，126 BPM，「fight scenes」，最密但偏亮）、「Undaunted」（大鼓、钢琴、合成器的电影感，95 BPM）、「Death and Axes」（铜管史诗，140 BPM）、「Heroic Age」（明亮的管弦，129 BPM，只有 1 分 37 秒）、「Mountain Emperor」（太鼓 + 甘美兰，最「东方」但没有旋律）；
OpenGameArt 上 Matthew Pablo 的「Blackmoor Ninjas」（CC-BY 3.0，摇滚吉他 + 太鼓，有不带喊声的版本，最贴「东方 + 爽快」，包 10 MB，这里网速太慢没下完）、hitctrl 的「Views From Atop the Jade Kings Throne」（CC-BY 3.0，东方风）、cynicmusic 的「Battle Theme A」（CC0，管弦史诗）。

新曲也按「不尖锐」处理了：所有配乐构建时过一道 5 kHz 起高架 −3dB、3 kHz 削 1.5dB、12 kHz 低通（`build.ts`），量下来九首的尖锐度 S 都在 1.1–1.75（音效「温和」的门槛是 1.8）。接缝都用 `check.ts --measure` 量过：三首新曲包络偏离 2.9 / 0.7 / 1.2 dB、咔哒比 1.64 / 1.00 / 0.97、频谱相似 1.00 / 0.86 / 1.00（门槛 3dB、3、0.8）。

## 自作配乐（2026-11-12，分支 compose，项目自作配乐，待试听选择）

用户（2026-11-12）：「第一首歌不好听（第一章战斗曲 Aggressor）……东方风，但是没这么喜庆，要战斗风格……你可以自己创作一首适合当前游戏的么？」（用户也嫌过旧曲 Shenyang「喜庆」，曲库标签就是 Bright / Relaxed。）
所以要**东方、战斗、不喜庆**。自己作了两首，乐谱、配器、混音都是代码，**没有替换游戏里现有的配乐**，先供试听。

**试听**：开发服务器上打开 `/?music=compose-a` 或 `/?music=compose-b`，点一下解锁音频——标题页、整理（万宝阁）、第一章战斗都换成那一首（`sfx.ts` 的 `previewTrack`：只在要放 `shop` / `battle` 时换）。可以 `/?music=compose-a&bot` 直接看机器人打第一章时配上它。
**2026-11-13 用户选定 A「破阵」**，已换成第一章战斗曲 `music/battle.m4a`（替下 Aggressor）；B「列阵」的成品和 `?music=` 试听入口已删（乐谱 `piece-b.ts` 留着）。原来的说明：成品 `public/audio/music/compose-a.m4a`、`compose-b.m4a`（各约 0.55 MB，HE-AAC 48kbps）；用户选定一首后：配方里把它的 `out` 改成 `music/battle.m4a`（Aggressor 那条删掉、致谢里去掉 Aggressor），`bank.ts` 删掉 `PreviewTrack` 两个名字和 `sfx.ts` 的 `previewTrack`，另一首的成品删掉。

### 两版

| | A「破阵」 | B「列阵」 |
|---|---|---|
| 调式 | G# 羽（G# B C# D# F#） | C# 商（C# D# F# G# B），和声上加 E 成小调 |
| 和声 | 只用空五度（不放三度，不往大调的明亮那边走）：G#5 – C#5 – E5 / F#5 – D#；B 段借清角 E 和和声小调的 F##（写作 G）、属和弦 D#（D# G A#）添紧张 | 小调的史诗走法 C#m – B – E – C#m、C#m – B – A（i – ♭VII – ♭VI），句尾落属和弦 G#（带 B#，和声小调的导音） |
| 速度 / 拍子 | 150 拍/分，4/4，重音 3+3+2 | 140 拍/分，4/4；过门四小节 7/8（2+2+3 的抢拍） |
| 结构（小节） | 前奏 4 → A 16 → B 16 → 过门 4 → A' 16 → 绕回 A；89.6 秒，循环 6.4–89.6 | 同左；95.1 秒，循环 6.857–95.143 |
| 领奏 | 古筝（VCSL 的越南筝采样，按音滑上来、揉弦只往上揉、轮指：G#、C#、F# 一带用录好的真轮指） | 二胡（合成：带限锯齿 + 三个共振峰 + 弓噪，换音带滑、长音揉弦）唱主题；B 段琵琶轮指唱旋律、二胡对位 |
| 伴奏 | 太鼓（大太鼓 = 音乐会大鼓放慢截短 + 垫一声下落的正弦、中太鼓、小手鼓、木鼓），段首大锣；低音合成器八分音符跟着大鼓的 3+3+2；B 段与 A' 加低八度拨弦（KS）和低音弦乐的空五度 | 低音弦乐顿弓（八分音符、3+3+2）、弦乐铺底、琵琶扫弦（KS 物理建模：正扫、反扫）、定音鼓、太鼓（比 A 稀）、段首大锣 |
| 情绪 | 紧、凶、一路往前砍 | 宽、苍凉、有推进 |

两首都用游戏里击杀古筝、拾取手钟那一组五声音（B 宫五声：B C# D# F# G#），只是落在小调一侧（G# 羽 / C# 商）——战斗里一路响的击杀古筝和配乐同调。
不用笛子高音，不用人声。

### 怎么做的（`tools/audio/compose/`）

- `score.ts`：小节时间轴和记谱法（`G#3/.5 C#4/1s D#4/2v | …`：音名 / 拍数 + 记号，s 按音滑上来、v 揉弦、t 轮指、x / u 正反扫弦；鼓谱一小节 16 格 `X.....x.....X...`）；每小节的拍数写错了直接报错。
- `synth.ts`：采样重采样（三次插值、随时间变调）、Karplus-Strong 拨弦（延迟线长度随时间变 = 滑音，弦还在响时再拨 = 轮指）、拉弦、弦乐群（每个音五把失谐锯齿）、低音、Freeverb、总线压缩、前瞻限幅。全部在 Node 里逐样本算，随机数固定种子，同样的乐谱每次渲出的文件完全一样。
- `kit.ts`：乐器（音高、力度、滑音落成声音）；`piece-a.ts`、`piece-b.ts`：两首的乐谱。
- `render.ts`：`node tools/audio/compose/render.ts` 渲出 `scratch/downloads/compose/compose-{a,b}.wav`（44.1k 立体声），再 `node tools/audio/build.ts --only music/compose` 做成品（和其他配乐同一条流水线：去尖锐的 EQ、响度归一到 −17、HE-AAC）。乐谱改了循环点变了，render 会提示配方里的数要怎么改。
- **无缝循环**：循环段（前奏之后的全部）按「环」渲——音符的尾巴、混响超出循环终点的部分绕回循环起点叠上；混响、压缩、限幅把循环段连着处理两遍取第二遍。前奏单独渲，它的最后 0.5 秒交叉过渡到循环段最后 0.5 秒的声音，所以第一次从前奏进来和每次从结尾绕回来，循环起点听到的完全一样（构建时量到交叉两段的相关 ρ = 1.000）；为此循环段最后一小节和前奏最后一小节写成同一个鼓的过门。`check.ts --measure` 复量接缝：A 包络偏离 1.0dB、咔哒比 0.77，B 0.6dB、1.00（门槛 3dB、3）。
- **音准**：自相关量各乐器单音的基频（scratch 里的小脚本）：KS 拨弦、二胡、低音都在 ±0.1 音分；VCSL 的筝采样本身音准有偏差（`C#3_mf` 高约 38 音分、`F#3_mf` 低 13），`kit.ts` 按量到的表逐个校正。另外 VCSL 筝的文件名比实际音高低一个八度（`G#3_mf` 实际是 G#4）。有音高的鼓和锣按量到的主频调到 G# / D#，不和旋律打架。整首的音级分布前五位就是五声的五个音。
- **不尖锐**：筝采样低通 8 kHz、琵琶 2.5 kHz 起高架 −6dB、鼓总线 3 kHz 起 −3dB、母带 4.5 kHz 起 −2.5dB，再加构建时配乐都有的那道；成品尖锐度 S 1.1 / 1.0（音效「温和」的门槛 1.8；Aggressor 1.73）。
- 素材：打击乐、筝、锣、镲用 VCSL（CC0，已有的下载，拷到本 worktree 的 `scratch/downloads/vcsl`），其余全是合成；来源登记在 `recipes.ts` 的 `SOURCES.compose`。

### 量（没法试听）

`node tools/audio/compose/measure.ts --md --curve --png 目录 文件…`：成品解码后量的（和 Aggressor、Big Mojo 同一条流水线出来的成品比）。

| 曲子 | 时长 s | 响度 LUFS | 峰值 dBFS | 峰值−响度 dB | 动态（短时 10–95%）dB | <60 Hz | 60–250 Hz | 250–1k Hz | 1–4k Hz | 4k+ Hz | 重心 Hz | 尖锐度 S | 8k+ | 2–5k | 每秒起音 | 立体声宽（侧/中） |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Aggressor（`battle`，第一章战斗，现在的） | 109.7 | -17.2 | -2.7 | 14.5 | 3.0 | 6.8% | 65.2% | 19.9% | 7.1% | 1.0% | 368 | 1.73 | 0.4% | 13.5% | 5.63 | 0.49 |
| Big Mojo（`boss`，第一章首领） | 100.8 | -20.5 | -0.5 | 19.9 | 2.2 | 30.8% | 65.8% | 2.4% | 0.8% | 0.1% | 93 | 1.45 | 0.1% | 12.6% | 5.64 | 0.04 |
| **A「破阵」**（`compose-a`） | 89.6 | -17.1 | -3.1 | 14.0 | 1.8 | 9.6% | 53.2% | 33.6% | 3.4% | 0.2% | 286 | 1.13 | 0.0% | 2.7% | 5.29 | 0.07 |
| **B「列阵」**（`compose-b`） | 95.1 | -17.1 | -3.7 | 13.4 | 2.8 | 7.6% | 44.9% | 38.1% | 9.4% | 0.0% | 396 | 0.97 | 0.0% | 1.6% | 3.74 | 0.24 |

每 8 秒一格的响度 / 每秒起音（看段落的起伏）：

- battle 每 8 秒（响度/每秒起音）：-19/6.1 -17/5.8 -18/5.6 -18/5.3 -17/5.6 -17/6.0 -17/6.1 -19/6.0 -17/5.9 -16/4.8 -17/5.3 -17/5.3 -17/5.5
- boss 每 8 秒（响度/每秒起音）：-21/4.5 -21/6.5 -20/6.4 -21/6.0 -21/6.1 -20/5.0 -21/3.4 -21/6.0 -21/6.0 -19/5.5 -21/5.5 -21/6.4
- compose-a 每 8 秒（响度/每秒起音）：-19/3.8 -17/4.5 -17/5.0 -17/5.4 -17/5.8 -17/6.1 -17/6.3 -18/5.1 -17/5.4 -17/5.5 -17/5.3
- compose-b 每 8 秒（响度/每秒起音）：-20/3.5 -17/2.8 -17/3.0 -16/2.9 -18/7.0 -19/8.5 -17/2.8 -17/3.1 -17/2.5 -17/3.3 -16/2.5

读法：A 的起音密度（每秒 5.3）和两首原曲（5.6）相当，从头到尾都满；低频（<60 Hz）10%，介于 Aggressor（7%）和 Big Mojo（31%）之间；重心 286 Hz，比 Aggressor 暗（没有铜管和镲）。B 的 A 段每秒起音约 3（二胡长音 + 顿弓），B 段琵琶轮指时 7–8.5，整体比 A 疏、更「宽」；1–4 kHz 的能量（9%）比 A 多，是二胡和琵琶。两首尖锐度都比原曲低。立体声都比 Aggressor 窄（A 0.07 很窄：领奏、鼓大多在中间）。

### 最可能不好听的地方（请重点听）

1. **B 的二胡**是合成的（锯齿过共振峰），最可能听着像电子琴的「二胡音色」、发假；不行就把二胡换成筝的长轮指或去掉。
2. **筝的轮指**：G#、C#、F# 附近用 VCSL 录好的真轮指（A 每个乐句末的 G# 长音就是），其余音（B 段的 D#、B 长音）是同一个采样每秒重打 14 次，可能有「机关枪」感。
3. **A 太鼓的低频**：大太鼓是音乐会大鼓截短再垫正弦，手机外放听不出低频时可能只剩「噗噗」声；耳机里可能偏轰。
4. **A 的和声**只用空五度、旋律在五声里打转，可能听着单薄或「太像练习曲」；A 段 16 小节一个鼓型，可能嫌重复。
5. **B 的速度感**：A 段每秒起音只有 3 左右，割草时可能嫌不够「冲」。
6. 7/8 的过门（B）、借和声小调的 G 音（A 的 B 段）是故意添的紧张，可能听着「走音」。

## 来源与许可

### 需要署名（进游戏的「致谢」）

九首音乐都是 Kevin MacLeod 的作品，许可 CC-BY 4.0，必须署名（incompetech 的许可页给的署名块就是这个格式）。游戏的「致谢」里按作者要求的格式写：

```
"Aggressor" Kevin MacLeod (incompetech.com)
"Big Mojo" Kevin MacLeod (incompetech.com)
"Guzheng City" Kevin MacLeod (incompetech.com)
"Black Vortex" Kevin MacLeod (incompetech.com)
"Himalayan Atmosphere" Kevin MacLeod (incompetech.com)
"Volatile Reaction" Kevin MacLeod (incompetech.com)
"Hitman" Kevin MacLeod (incompetech.com)
"Nu Flute" Kevin MacLeod (incompetech.com)
"Ripples" Kevin MacLeod (incompetech.com)
Licensed under Creative Commons: By Attribution 4.0 License
http://creativecommons.org/licenses/by/4.0/
```

致谢页读的是 `public/audio/CREDITS.txt`（下面的命令生成）；读不到时用 `src/game/credits.ts` 里内置的同一段（`MUSIC_ATTRIBUTION_FALLBACK`，`credits.test.ts` 核对两边一行不少）。

（我们对曲子做了截取与循环处理，属于 CC-BY 允许的改编；致谢里可以加一句「已截取、循环处理」。）

### 不需要署名（CC0）

音效全部是 CC0（公有领域），不要求署名（2026-11-11 新用的几个来源也都是 CC0，许可在各自的 OpenGameArt 页面、Kenney 包里的 License.txt、VCSL 仓库的 LICENSE 上核对过）。致谢页照样把它们列出来：Kenney（kenney.nl）、Versilian Studios（VCSL）、OpenGameArt 上的 rubberduck、qubodup、artisticdude、LEGIT Audio 等作者。没用的：要登录才能下的、许可不明的、CC-BY-SA / NC 的；名字不雅的作者的素材也没用（会出现在致谢里）。

### 逐个来源与文件

<!-- 下面两张表由 `node tools/audio/build.ts --credits --write` 生成 -->

| 编号 | 素材 | 作者 | 许可 | 网址 |
|---|---|---|---|---|
| S1 | "Aggressor" | Kevin MacLeod (incompetech.com) | CC-BY 4.0 | <https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1700051> |
| S2 | "Big Mojo" | Kevin MacLeod (incompetech.com) | CC-BY 4.0 | <https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100306> |
| S3 | "Guzheng City" | Kevin MacLeod (incompetech.com) | CC-BY 4.0 | <https://incompetech.com/music/royalty-free/index.html?isrc=USUAN2100001> |
| S4 | "Black Vortex" | Kevin MacLeod (incompetech.com) | CC-BY 4.0 | <https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1300037> |
| S5 | "Himalayan Atmosphere" | Kevin MacLeod (incompetech.com) | CC-BY 4.0 | <https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100204> |
| S6 | "Volatile Reaction" | Kevin MacLeod (incompetech.com) | CC-BY 4.0 | <https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1400039> |
| S7 | "Hitman" | Kevin MacLeod (incompetech.com) | CC-BY 4.0 | <https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1300013> |
| S8 | "Nu Flute" | Kevin MacLeod (incompetech.com) | CC-BY 4.0 | <https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100680> |
| S9 | "Ripples" | Kevin MacLeod (incompetech.com) | CC-BY 4.0 | <https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100691> |
| S10 | Swish - bamboo stick weapon swhoshes | qubodup | CC0 | <https://opengameart.org/content/swish-bamboo-stick-weapon-swhoshes> |
| S11 | Versilian Community Sample Library（VCSL） | Versilian Studios | CC0 | <https://github.com/sgossner/VCSL> |
| S12 | Fire Staff Sound Effects | LEGIT Audio | CC0 | <https://opengameart.org/content/fire-staff-sound-effects> |
| S13 | Catching fire（改编自 freesound qubodup #159725（CC0）） | themightyglider | CC0 | <https://opengameart.org/content/catching-fire> |
| S14 | Fireball（原始：freesound Julien Matthey #105016（CC0）） | Julien Matthey（diligentcircle 转载） | CC0 | <https://opengameart.org/content/fireball-1> |
| S15 | Electricity Game Sound Pack | faxcorp | CC0 | <https://opengameart.org/content/electricity-game-sound-pack> |
| S16 | 100 CC0 SFX #2 | rubberduck | CC0 | <https://opengameart.org/content/100-cc0-sfx-2> |
| S17 | 100 CC0 SFX | rubberduck | CC0 | <https://opengameart.org/content/100-cc0-sfx> |
| S18 | 75 CC0 breaking / falling / hit sfx | rubberduck | CC0 | <https://opengameart.org/content/75-cc0-breaking-falling-hit-sfx> |
| S19 | Impact Sounds | Kenney | CC0 | <https://kenney.nl/assets/impact-sounds> |
| S20 | 20 Sword Sound Effects (Attacks and Clashes) | StarNinjas | CC0 | <https://opengameart.org/content/20-sword-sound-effects-attacks-and-clashes> |
| S21 | Ice breaking/shattering | ignasd | CC0 | <https://opengameart.org/content/ice-breakingshattering> |
| S22 | Swishes Sound Pack | artisticdude | CC0 | <https://opengameart.org/content/swishes-sound-pack> |
| S23 | 80 CC0 RPG SFX | rubberduck | CC0 | <https://opengameart.org/content/80-cc0-rpg-sfx> |
| S24 | RPG Audio | Kenney | CC0 | <https://kenney.nl/assets/rpg-audio> |
| S25 | Freeze Spell | artisticdude | CC0 | <https://opengameart.org/content/freeze-spell-0> |
| S26 | Flare ignition | qubodup | CC0 | <https://opengameart.org/content/flare-ignition> |
| S27 | Earth Element Magic Spell | qubodup | CC0 | <https://opengameart.org/content/earth-element-magic-spell> |
| S28 | Ice spells | bart | CC0 | <https://opengameart.org/content/ice-spells> |
| S29 | 40 CC0 water / splash / slime SFX | rubberduck | CC0 | <https://opengameart.org/content/40-cc0-water-splash-slime-sfx> |
| S30 | Fantasy Sound Effects (Tinysized SFX) | Vehicle（Jan Schupke） | CC0 | <https://opengameart.org/content/fantasy-sound-effects-tinysized-sfx> |
| S31 | Sci-fi Sounds | Kenney | CC0 | <https://kenney.nl/assets/sci-fi-sounds> |
| S32 | Bell dings/chimes | PWL | CC0 | <https://opengameart.org/content/bell-dingschimes> |
| S33 | Big scary troll sounds | darsycho | CC0 | <https://opengameart.org/content/big-scary-troll-sounds> |
| S34 | CC0 Deep Monster Roar | trazzz123 | CC0 | <https://opengameart.org/content/cc0-deep-monster-roar> |
| S35 | Earthquake and Open sesame | mieki256 | CC0 | <https://opengameart.org/content/earthquake-and-open-sesame> |
| S36 | 3 Melee sounds | remaxim | CC0 | <https://opengameart.org/content/3-melee-sounds> |
| S37 | 3 dark magic spells | qubodup | CC0 | <https://opengameart.org/content/3-dark-magic-spells> |
| S38 | Low Rumbling | musheran | CC0 | <https://opengameart.org/content/low-rumbling> |
| S39 | 25 CC0 bang / firework SFX | rubberduck | CC0 | <https://opengameart.org/content/25-cc0-bang-firework-sfx> |
| S40 | 80 CC0 creture SFX #2 | rubberduck | CC0 | <https://opengameart.org/content/80-cc0-creture-sfx-2> |
| S41 | Casino Audio | Kenney | CC0 | <https://kenney.nl/assets/casino-audio> |
| S42 | Magic Spell SFX | jaggedstone | CC0 | <https://opengameart.org/content/magic-spell-sfx> |
| S43 | 80 CC0 creature SFX | rubberduck | CC0 | <https://opengameart.org/content/80-cc0-creature-sfx> |
| S44 | Fire Crackling | AntumDeluge | CC0 | <https://opengameart.org/content/fire-crackling> |
| S45 | RPG Sound Pack | artisticdude | CC0 | <https://opengameart.org/content/rpg-sound-pack> |
| S46 | 10 Impact/Shield Blocks | StarNinjas | CC0 | <https://opengameart.org/content/10-impactshield-blocks> |
| S47 | Ghost Monster Voice Moaning & Growling | qubodup | CC0 | <https://opengameart.org/content/ghost-monster-voice-moaning-growling> |
| S48 | Teleport（原始：freesound fins #172206（CC0）） | fins | CC0 | <https://opengameart.org/content/teleport> |
| S49 | Air whoosh | pyranostudios | CC0 | <https://opengameart.org/content/air-whoosh> |
| S50 | 100 CC0 metal and wood SFX | rubberduck | CC0 | <https://opengameart.org/content/100-cc0-metal-and-wood-sfx> |
| S51 | Game Over - Bad chest SFX | Oiboo | CC0 | <https://opengameart.org/content/game-over-bad-chest-sfx> |
| S52 | 自作配乐「破阵」「列阵」（本项目作曲、程序合成；打击乐与筝的采样来自 VCSL） | 本项目 | CC0 | <https://github.com/sgossner/VCSL> |

| 文件（public/audio/） | 用到的素材（来源编号：原始文件） | 许可 |
|---|---|---|
| `sfx/qiankun.throw.1.m4a` | S10：swosh-14 | CC0 |
| `sfx/qiankun.throw.2.m4a` | S10：swosh-17 | CC0 |
| `sfx/qiankun.throw.3.m4a` | S10：swosh-22 | CC0 |
| `sfx/hit.crit.m4a` | S11：sus_G#4_r01_main | CC0 |
| `sfx/qiankun.hover.1.m4a` | S10：swosh-24 | CC0 |
| `sfx/qiankun.hover.2.m4a` | S10：swosh-23 | CC0 |
| `sfx/jiulong.burst.1.m4a` | S12：LEGIT_FIR_Fire_Staff 6-Audio；S13：flame_0 | CC0 |
| `sfx/jiulong.burst.2.m4a` | S14：105016__julien-matthey__jm-fx-fireball-01；S12：LEGIT_FIR_Fire_Staff 11-Audio | CC0 |
| `sfx/leigong.strike.1.m4a` | S15：groundhit、hit；S16：sfx100v2_thunder_01 | CC0 |
| `sfx/leigong.strike.2.m4a` | S15：killconfirmed、groundhit；S16：sfx100v2_thunder_01 | CC0 |
| `sfx/fantian.land.1.m4a` | S11：bassdrum_hit_ff；S17：slam_02；S18：bfh1_rock_falling_01 | CC0 |
| `sfx/fantian.land.2.m4a` | S11：BDrumNew_hit_v7_rr1_Sum；S19：impactMining_000；S18：bfh1_rock_falling_03 | CC0 |
| `sfx/xinghuang.up.m4a` | S11：BellTree_Stroke_3_Mid、HB_2 | CC0 |
| `sfx/xinghuang.block.1.m4a` | S20：sword_clash.2；S19：impactPlate_light_000 | CC0 |
| `sfx/xinghuang.block.2.m4a` | S20：sword_clash.5；S19：impactPlate_light_002 | CC0 |
| `sfx/xinghuang.break.m4a` | S18：bfh1_glass_breaking_01；S21：LedasLuzta；S11：BDrumNew_hit_v5_rr1_Sum | CC0 |
| `sfx/zhanxian.fly.1.m4a` | S22：swish-1 | CC0 |
| `sfx/zhanxian.fly.2.m4a` | S22：swish-2 | CC0 |
| `sfx/zhanxian.fly.3.m4a` | S22：swish-3 | CC0 |
| `sfx/zhanxian.fly.4.m4a` | S22：swish-4 | CC0 |
| `sfx/zhanxian.hit.1.m4a` | S23：blade_01；S19：impactPunch_medium_001 | CC0 |
| `sfx/zhanxian.hit.2.m4a` | S23：blade_02；S19：impactPunch_medium_002 | CC0 |
| `sfx/zhanxian.hit.3.m4a` | S24：knifeSlice；S19：impactPunch_medium_000 | CC0 |
| `sfx/hanbing.frost.m4a` | S25：freeze；S17：glass_04 | CC0 |
| `sfx/zone.fire.m4a` | S12：LEGIT_FIR_Fire_Staff 7-Audio；S26：ignition | CC0 |
| `sfx/zone.crack.m4a` | S18：bfh1_rock_breaking_01；S27：Earth Element Magic Spell_0；S17：slam_02 | CC0 |
| `sfx/zone.frost.m4a` | S28：ice、coldsnap | CC0 |
| `sfx/dot.bleed.1.m4a` | S29：slime_04 | CC0 |
| `sfx/dot.bleed.2.m4a` | S29：slime_06 | CC0 |
| `sfx/react.frost.m4a` | S21：LedasLuzta5；S17：glass_05；S11：Triangle6_HitM_v1_rr1_Mid | CC0 |
| `sfx/react.conduct.m4a` | S15：killconfirmed；S30：paralyzer-discharge-02；S11：Triangle6_HitM_v1_rr1_Mid | CC0 |
| `sfx/react.ignite.m4a` | S13：flame_0；S12：LEGIT_FIR_Fire_Staff 6-Audio；S11：Triangle6_HitM_v1_rr1_Mid | CC0 |
| `sfx/react.lava.m4a` | S31：lowFrequency_explosion_001；S12：LEGIT_FIR_Fire_Staff 3-Audio；S26：ignition | CC0 |
| `sfx/react.pierce.m4a` | S11：Anvil_Hit2_v3_rr1_Mid；S19：impactMetal_heavy_001、impactPlate_heavy_000 | CC0 |
| `sfx/pet.fly.1.m4a` | S10：swosh-12；S24：cloth2 | CC0 |
| `sfx/pet.fly.2.m4a` | S10：swosh-11；S24：cloth4 | CC0 |
| `sfx/pet.wrap.1.m4a` | S10：swosh-10；S24：clothBelt2；S19：impactSoft_medium_000 | CC0 |
| `sfx/pet.wrap.2.m4a` | S10：swosh-16；S24：clothBelt；S19：impactSoft_medium_001 | CC0 |
| `sfx/pet.evolve.m4a` | S11：Gliss_Up_Slw_mf_1、BellTree_Stroke_1_Mid | CC0 |
| `sfx/drop.spawn.m4a` | S32：bell_ding2 | CC0 |
| `sfx/drop.chest.m4a` | S17：wooded_box_open；S23：item_coins_02；S11：sus_G#4_r01_main、windchimes_asc1 | CC0 |
| `sfx/drop.peach.m4a` | S30：apple-cut-02；S32：bell_ding3 | CC0 |
| `sfx/drop.magnet.m4a` | S24：bookFlip1；S11：windchimes_asc1；S10：swosh-12 | CC0 |
| `sfx/boss.intro.m4a` | S11：hit_full2_loudest_ST、bassdrum_hit_ff | CC0 |
| `sfx/boss.roar.m4a` | S33：troll-roars_0；S34：monster_roar | CC0 |
| `sfx/boss.phase.m4a` | S11：gong_2_f、cymbal_crash1_mf1；S35：shake | CC0 |
| `sfx/boss.ring.warn.m4a` | S11：susCymb1_cresc_1.5s、scrape1 | CC0 |
| `sfx/boss.ring.throw.m4a` | S10：swosh-03；S11：hit_light1 | CC0 |
| `sfx/boss.dash.charge.m4a` | S11：susCymb1_cresc_2s；S12：LEGIT_FIR_Fire_Staff 14-Audio | CC0 |
| `sfx/boss.dash.m4a` | S36：melee sound；S12：LEGIT_FIR_Fire_Staff 6-Audio；S14：105016__julien-matthey__jm-fx-fireball-01 | CC0 |
| `sfx/boss.clone.m4a` | S11：windchimes_desc1；S37：fout-02；S10：swosh-13 | CC0 |
| `sfx/boss.sweep.warn.m4a` | S11：F#3_Trem_1、bassdrum_roll_ff | CC0 |
| `sfx/boss.sweep.m4a` | S10：swosh-03、swosh-28；S24：cloth1 | CC0 |
| `sfx/boss.wheel.warn.m4a` | S11：bassdrum_roll_ff；S12：LEGIT_FIR_Fire_Staff 18-Audio | CC0 |
| `sfx/boss.wheel.m4a` | S12：LEGIT_FIR_Fire_Staff 2-Audio；S31：thrusterFire_000 | CC0 |
| `sfx/boss.miasma.m4a` | S38：low-rumbling-176033；S37：fout-01 | CC0 |
| `sfx/boss.hurt.1.m4a` | S19：impactPunch_heavy_000、impactPlate_heavy_000 | CC0 |
| `sfx/boss.hurt.2.m4a` | S19：impactPunch_heavy_002、impactPlate_heavy_001 | CC0 |
| `sfx/boss.death.m4a` | S39：cannon_02；S11：hit_full2_loudest_ST、cymbal_crash1_mf1；S40：die_03 | CC0 |
| `sfx/dialogue.blip.1.m4a` | S11：wood_click_pp_rr1 | CC0 |
| `sfx/dialogue.blip.2.m4a` | S11：wood_click3_vl1 | CC0 |
| `sfx/ui.click.m4a` | S11：wood_click_mp | CC0 |
| `sfx/ui.buy.m4a` | S23：item_coins_01；S11：sus_C4_r01_main | CC0 |
| `sfx/ui.lock.m4a` | S24：metalLatch | CC0 |
| `sfx/ui.reroll.m4a` | S41：card-fan-1；S11：wood_click_pp_rr1 | CC0 |
| `sfx/ui.ready.m4a` | S11：HB_1、wood_click_mp | CC0 |
| `sfx/ui.denied.m4a` | S11：LogDrumLo_MedM_v2_rr1_Sum | CC0 |
| `sfx/ui.levelup.m4a` | S11：Gliss_Up_Med_mf_1 | CC0 |
| `sfx/kill.0.m4a` | S11：C#3_mf_1；S19：impactPunch_medium_001 | CC0 |
| `sfx/kill.1.m4a` | S11：D#3_mf_1；S19：impactPunch_medium_001 | CC0 |
| `sfx/kill.2.m4a` | S11：F#3_mf_1；S19：impactPunch_medium_001 | CC0 |
| `sfx/kill.3.m4a` | S11：G#3_mf_1；S19：impactPunch_medium_001 | CC0 |
| `sfx/kill.4.m4a` | S11：B3_mf_1；S19：impactPunch_medium_001 | CC0 |
| `sfx/kill.5.m4a` | S11：C#4_mf_1；S19：impactPunch_medium_001 | CC0 |
| `sfx/kill.6.m4a` | S11：D#4_mf_1；S19：impactPunch_medium_001 | CC0 |
| `sfx/kill.7.m4a` | S11：F#4_mf_1；S19：impactPunch_medium_001 | CC0 |
| `sfx/kill.8.m4a` | S11：G#4_mf_1；S19：impactPunch_medium_001 | CC0 |
| `sfx/kill.9.m4a` | S11：B4_mf_1；S19：impactPunch_medium_001 | CC0 |
| `sfx/kill.elite.m4a` | S11：F#2_f_1、C#3_mf_1、G#3_mf_1、BDrumNew_hit_v5_rr1_Sum、cymbal_crash1_short2 | CC0 |
| `sfx/pickup.lo.m4a` | S11：sus_C4_r01_main | CC0 |
| `sfx/pickup.mid.m4a` | S11：sus_G#4_r01_main | CC0 |
| `sfx/pickup.hi.m4a` | S11：sus_C5_r01_main | CC0 |
| `sfx/hurt.m4a` | S19：impactPunch_heavy_001、impactSoft_heavy_001 | CC0 |
| `sfx/skill.m4a` | S11：gong_2_f、bassdrum_hit_ff；S10：swosh-03；S12：LEGIT_FIR_Fire_Staff 18-Audio | CC0 |
| `sfx/drum.m4a` | S11：bassdrum_hit_f、HDrumL_Hit_v3_rr1_Sum | CC0 |
| `sfx/wave.start.m4a` | S11：bassdrum_hit_f、HDrumL_Hit_v3_rr1_Sum、bassdrum_hit_ff | CC0 |
| `sfx/wave.end.m4a` | S11：hit_light1 | CC0 |
| `sfx/cast.m4a` | S42：magical_1_0；S37：fout-02 | CC0 |
| `sfx/orb.m4a` | S30：water-drop-01；S17：plop_02 | CC0 |
| `sfx/dispel.m4a` | S11：sus_E5_r01_main、BellTree_Hit_E5_rr1_Mid | CC0 |
| `sfx/enemy.spear.warn.m4a` | S24：creak2；S30：metal-knife-scrape-01 | CC0 |
| `sfx/enemy.spear.1.m4a` | S22：swish-10；S19：impactWood_light_003、impactMetal_light_004 | CC0 |
| `sfx/enemy.spear.2.m4a` | S22：swish-11；S19：impactWood_light_004、impactMetal_light_004 | CC0 |
| `sfx/enemy.charge.warn.m4a` | S43：nose；S19：impactSoft_heavy_000、impactSoft_heavy_001、impactSoft_heavy_002 | CC0 |
| `sfx/enemy.charge.m4a` | S19：impactSoft_heavy_000、impactSoft_heavy_001、impactSoft_heavy_002、impactSoft_heavy_003、impactSoft_heavy_004；S10：swosh-03 | CC0 |
| `sfx/enemy.fuse.m4a` | S30：match-light-01、compressed-air-spray-01；S44：fire-1 | CC0 |
| `sfx/enemy.explode.m4a` | S39：bang_07；S31：lowFrequency_explosion_000；S17：paper_02 | CC0 |
| `sfx/enemy.split.m4a` | S45：shade4；S10：swosh-13 | CC0 |
| `sfx/enemy.guard.1.m4a` | S46：impact.1；S19：impactWood_medium_001、impactPlate_light_003 | CC0 |
| `sfx/enemy.guard.2.m4a` | S46：impact.8；S19：impactWood_medium_002、impactPlate_light_003 | CC0 |
| `sfx/yao.intro.m4a` | S11：gong_mf、HB_2；S47：qubodup-GhostMoan03；S10：swosh-03 | CC0 |
| `sfx/yao.bell.m4a` | S11：HB_2、HB_1、sleighbell2_hit_2、gong_p | CC0 |
| `sfx/yao.banners.m4a` | S24：cloth1、cloth3；S45：cloth-heavy；S10：swosh-13；S11：hit_light1 | CC0 |
| `sfx/yao.flag.m4a` | S19：impactWood_heavy_002；S24：cloth4；S18：bfh1_rock_hit_01 | CC0 |
| `sfx/yao.straw.m4a` | S30：cloth-pouch-shake-01、wood-twigs-break-01、wood-twigs-break-02；S45：shade11 | CC0 |
| `sfx/yao.formations.m4a` | S11：susCymb1_bow_7、gong_scrape_mf、bassdrum_roll_mf | CC0 |
| `sfx/yao.burst.warn.m4a` | S45：shade7；S11：glass3_A#4_Slow_1_Main、susCymb1_bow_13 | CC0 |
| `sfx/yao.burst.m4a` | S37：fout-03；S31：lowFrequency_explosion_000；S45：shade6；S10：swosh-03 | CC0 |
| `sfx/yao.wave.m4a` | S11：HB_1；S10：swosh-24；S45：shade2 | CC0 |
| `sfx/yao.line.m4a` | S48：172206__fins__teleport；S11：glass1_D#4_Slow_1_Decay；S22：swish-5 | CC0 |
| `sfx/yao.linebreak.m4a` | S19：impactGlass_light_001；S11：HB_2；S45：shade14 | CC0 |
| `sfx/yao.curse.m4a` | S45：shade9；S44：fire-1；S13：flame_0；S10：swosh-12 | CC0 |
| `sfx/yao.root.m4a` | S23：chain_01、chain_02；S47：qubodup-GhostMoan05；S24：clothBelt | CC0 |
| `sfx/yao.vanish.m4a` | S10：swosh-24；S37：fout-01；S38：low-rumbling-176033 | CC0 |
| `sfx/yao.appear.m4a` | S11：HB_3；S10：swosh-24 | CC0 |
| `sfx/yao.phase.m4a` | S11：hit_full2_loudest_ST、HB_2；S45：shade8；S47：qubodup-GhostMoan04 | CC0 |
| `sfx/ten.warn.m4a` | S24：cloth2、cloth4；S11：bassdrum_roll_mf、susCymb1_cresc_1.5s | CC0 |
| `sfx/ten.thunder.on.m4a` | S15：crackleelectricityloop、chargestart | CC0 |
| `sfx/ten.bolt.warn.m4a` | S15：charge；S30：paralyzer-discharge-02 | CC0 |
| `sfx/ten.bolt.m4a` | S16：sfx100v2_thunder_01；S15：hit；S31：lowFrequency_explosion_000 | CC0 |
| `sfx/ten.water.m4a` | S11：OceanDrum_Sus_2_Mid；S29：loop_bubbles_1、splash_05 | CC0 |
| `sfx/ten.gold.m4a` | S11：windchimes_asc1、BellTree_Stroke_4_Mid、sus_C5_r01_main | CC0 |
| `sfx/ten.spawn.m4a` | S18：bfh1_rock_falling_02；S19：impactSoft_medium_002；S16：sfx100v2_stones_02 | CC0 |
| `sfx/wind.warn.m4a` | S16：sfx100v2_air_01；S10：swosh-30 | CC0 |
| `sfx/wind.dash.m4a` | S16：sfx100v2_air_02；S10：swosh-03；S49：whoosh2_0 | CC0 |
| `sfx/sand.burst.m4a` | S18：bfh1_rock_breaking_02；S16：sfx100v2_stones_01；S30：soil-steps-01；S19：impactSoft_heavy_002 | CC0 |
| `sfx/sword.warn.1.m4a` | S45：sword-unsheathe、metal-ringing | CC0 |
| `sfx/sword.warn.2.m4a` | S45：sword-unsheathe3、metal-ringing | CC0 |
| `sfx/sword.warn.3.m4a` | S45：sword-unsheathe4、metal-ringing | CC0 |
| `sfx/sword.cut.1.m4a` | S20：sword.3；S22：swish-1；S45：metal-ringing | CC0 |
| `sfx/sword.cut.2.m4a` | S20：sword.2；S22：swish-2；S45：metal-ringing | CC0 |
| `sfx/sword.sweep.m4a` | S10：swosh-03；S20：sword.9；S19：impactMetal_light_003 | CC0 |
| `sfx/sword.altars.m4a` | S45：sword-unsheathe、sword-unsheathe3、sword-unsheathe4、sword-unsheathe2；S11：susCymb1_bow_13、chimes_G#3_ff_rr1 | CC0 |
| `sfx/fly.aim.m4a` | S11：susCymb1_bow_7；S50：metal_spring_01 | CC0 |
| `sfx/fly.shot.1.m4a` | S22：swish-2；S20：sword.6 | CC0 |
| `sfx/fly.shot.2.m4a` | S22：swish-6；S20：sword.4 | CC0 |
| `sfx/qi.cast.m4a` | S42：magical_2；S22：swish-8 | CC0 |
| `sfx/qi.throw.m4a` | S22：swish-4；S45：metal-ringing；S42：magical_3 | CC0 |
| `sfx/tether.on.m4a` | S19：impactMetal_light_001；S11：glass1_D#4_Slow_1_Decay | CC0 |
| `sfx/tether.cut.m4a` | S50：metal_spring_02；S19：impactGlass_light_003；S45：metal-small1 | CC0 |
| `sfx/zx.intro.m4a` | S30：metal-knife-scrape-01；S11：hit_full2_loudest_ST、chimes_G#3_ff_rr1、susCymb1_bow_13 | CC0 |
| `sfx/zx.ring.warn.m4a` | S10：swosh-20、swosh-21、swosh-22；S45：metal-ringing | CC0 |
| `sfx/zx.rain.warn.m4a` | S30：sword-clash-01；S11：windchimes_asc1；S45：sword-unsheathe5 | CC0 |
| `sfx/zx.split.m4a` | S48：172206__fins__teleport；S11：susCymb1_bow_13、windchimes_desc1；S45：metal-ringing | CC0 |
| `sfx/zx.walls.m4a` | S11：BrakeDrum1_Bowed_rr2_Mid、susCymb1_bow_7、gong_scrape_mf | CC0 |
| `sfx/zx.rush.warn.m4a` | S30：metal-knife-scrape-02；S11：susCymb1_cresc_1.5s、bassdrum_roll_mf | CC0 |
| `sfx/zx.dash.warn.m4a` | S30：metal-knife-scrape-03；S22：swish-9 | CC0 |
| `sfx/zx.arc.1.m4a` | S10：swosh-03；S20：sword.1；S45：metal-ringing | CC0 |
| `sfx/zx.arc.2.m4a` | S10：swosh-28；S20：sword.8；S45：metal-ringing | CC0 |
| `sfx/zx.lane.m4a` | S22：swish-3；S20：sword.10；S19：impactMetal_light_002 | CC0 |
| `sfx/zx.dash.m4a` | S36：melee sound；S20：sword.5；S19：impactMetal_heavy_002；S10：swosh-03 | CC0 |
| `sfx/zx.wall.m4a` | S10：swosh-03；S20：sword_clash.5；S19：impactPlate_heavy_002；S11：hit_light1 | CC0 |
| `sfx/zx.cell.1.m4a` | S19：impactMining_000；S45：metal-ringing；S18：bfh1_rock_hit_01 | CC0 |
| `sfx/zx.cell.2.m4a` | S19：impactMining_002；S45：metal-ringing；S18：bfh1_rock_hit_01 | CC0 |
| `sfx/zx.close.warn.m4a` | S11：susCymb1_bow_13、gong_scrape_mf | CC0 |
| `sfx/zx.close.m4a` | S19：impactPlate_heavy_000；S11：hit_light1、bassdrum_hit_ff；S45：metal-ringing | CC0 |
| `sfx/zx.phase.m4a` | S11：hit_full2_loudest_ST、susCymb1_hit_bell_fff1、chimes_G#3_ff_rr1；S45：sword-unsheathe、sword-unsheathe3、metal-ringing | CC0 |
| `sfx/dashen.lash.1.m4a` | S19：impactPlank_medium_002；S39：bang_05；S16：sfx100v2_thunder_01 | CC0 |
| `sfx/dashen.lash.2.m4a` | S19：impactPlank_medium_004；S39：shot_02；S16：sfx100v2_thunder_01 | CC0 |
| `sfx/dashen.shock.m4a` | S31：lowFrequency_explosion_001；S35：shake；S11：bassdrum_hit_f | CC0 |
| `sfx/huaxue.slash.1.m4a` | S20：sword.1；S29：slime_02；S22：swish-6 | CC0 |
| `sfx/huaxue.slash.2.m4a` | S20：sword.7；S29：slime_05；S22：swish-7 | CC0 |
| `sfx/huaxue.drain.m4a` | S45：shade3；S11：sus_G#4_r01_main | CC0 |
| `sfx/dingfeng.whirl.m4a` | S49：whoosh2_0；S10：swosh-24 | CC0 |
| `sfx/dingfeng.gust.m4a` | S16：sfx100v2_air_02；S10：swosh-31 | CC0 |
| `sfx/dingfeng.thunder.m4a` | S15：hit；S16：sfx100v2_thunder_01、sfx100v2_air_03 | CC0 |
| `sfx/qinglian.bloom.m4a` | S11：Gliss_Up_Med_mf_1、BellTree_Stroke_4_Mid；S24：cloth2 | CC0 |
| `sfx/qinglian.heal.m4a` | S11：sus_C5_r01_main、windchimes_asc1 | CC0 |
| `sfx/yinyang.beam.m4a` | S11：susCymb1_bow_7、glass4_D5_Slow_2_Main；S22：swish-5 | CC0 |
| `sfx/yinyang.freeze.m4a` | S28：coldsnap；S11：glass1_D#4_Slow_1_Decay；S19：impactGlass_medium_001 | CC0 |
| `sfx/xuanyuan.pool.m4a` | S29：splash_12、splash_09；S11：OceanDrum_Sus_3_Mid | CC0 |
| `sfx/xuanyuan.vortex.m4a` | S29：loop_water_02、loop_bubbles_02；S10：swosh-24 | CC0 |
| `sfx/xuanyuan.freeze.m4a` | S28：ice；S29：splash_09；S25：freeze | CC0 |
| `sfx/wuhuo.fan.m4a` | S10：swosh-31；S12：LEGIT_FIR_Fire_Staff 12-Audio；S13：flame_0 | CC0 |
| `sfx/wuhuo.scorch.m4a` | S26：ignition；S44：fire-1；S12：LEGIT_FIR_Fire_Staff 4-Audio | CC0 |
| `sfx/kunxian.bind.m4a` | S24：creak1、clothBelt2、dropLeather | CC0 |
| `sfx/kunxian.clash.m4a` | S19：impactPunch_heavy_003、impactWood_medium_003；S45：metal-small2 | CC0 |
| `sfx/tech.learn.m4a` | S11：sus_E5_r01_main、BellTree_Stroke_6_Mid、HB_1、gong_p | CC0 |
| `sfx/tech.thunder.warn.m4a` | S16：sfx100v2_thunder_01；S15：charge | CC0 |
| `sfx/tech.thunder.m4a` | S16：sfx100v2_thunder_01；S15：groundhit；S11：Triangle6_HitM_v1_rr1_Mid | CC0 |
| `sfx/tech.lotus.m4a` | S11：gong_mf、Gliss_Up_Swl_mf_1、sus_C5_r01_main、sus_G#4_r01_main、windchimes_asc1 | CC0 |
| `sfx/tech.reflect.m4a` | S19：impactBell_heavy_001、impactMetal_medium_002；S11：HB_2 | CC0 |
| `sfx/tech.shatter.m4a` | S21：LedasLuzta4；S18：bfh1_glass_breaking_03；S19：impactGlass_light_000 | CC0 |
| `sfx/tech.spread.m4a` | S12：LEGIT_FIR_Fire_Staff 9-Audio；S22：swish-12；S26：ignition | CC0 |
| `sfx/tech.breath.m4a` | S16：sfx100v2_air_01；S11：sus_E5_r01_main | CC0 |
| `sfx/sanjian.sweep.1.m4a` | S10：swosh-03；S20：sword.2；S24：cloth1 | CC0 |
| `sfx/sanjian.sweep.2.m4a` | S10：swosh-28；S20：sword.8；S24：cloth1 | CC0 |
| `sfx/sanjian.chop.m4a` | S10：swosh-03；S11：bassdrum_hit_ff；S19：impactMining_003；S18：bfh1_rock_falling_04 | CC0 |
| `sfx/sanjian.rift.m4a` | S18：bfh1_rock_breaking_03；S35：shake；S27：Earth Element Magic Spell_0 | CC0 |
| `sfx/tianyan.gaze.m4a` | S11：susCymb1_bow_13、sus_F#5_r01_main、glass4_D5_Slow_2_Main；S22：swish-5 | CC0 |
| `sfx/xiaotian.dash.m4a` | S43：barking_01；S10：swosh-12 | CC0 |
| `sfx/xiaotian.bite.m4a` | S45：bite-small2、wolfman；S19：impactSoft_medium_003 | CC0 |
| `sfx/xiaotian.evolve.m4a` | S43：howl；S11：Gliss_Up_Med_ff_1、BellTree_Stroke_1_Mid | CC0 |
| `sfx/dinghai.land.1.m4a` | S19：impactMining_000；S11：bassdrum_hit_f；S23：item_stone_01；S18：bfh1_rock_falling_06 | CC0 |
| `sfx/dinghai.land.2.m4a` | S19：impactMining_004；S11：bassdrum_hit_f；S23：item_stone_03；S18：bfh1_rock_falling_06 | CC0 |
| `sfx/dinghai.quake.m4a` | S35：shake；S18：bfh1_rock_breaking_01；S11：BDrumNew_hit_v5_rr1_Sum | CC0 |
| `sfx/jinbian.raise.m4a` | S10：swosh-24；S11：windchimes_asc1、Triangle6_HitM_v1_rr1_Mid | CC0 |
| `sfx/jinbian.strike.m4a` | S19：impactMetal_heavy_003、impactMining_001；S11：bassdrum_hit_ff、hit_light1 | CC0 |
| `sfx/jinbian.crack.m4a` | S18：bfh1_rock_breaking_02；S27：Earth Element Magic Spell_0；S11：BellTree_Stroke_3_Mid | CC0 |
| `sfx/heihu.dash.m4a` | S45：mnstr2；S10：swosh-12 | CC0 |
| `sfx/heihu.roar.m4a` | S45：giant2、mnstr7；S43：roar_02 | CC0 |
| `sfx/heihu.broke.m4a` | S23：item_coins_04；S11：sus_G#4_r01_main | CC0 |
| `sfx/heihu.evolve.m4a` | S45：giant2；S11：gong_2_f、Gliss_Up_Med_ff_1 | CC0 |
| `sfx/jie.pick.m4a` | S11：chimes_E3_pp_rr1、gong_p；S16：sfx100v2_thunder_01 | CC0 |
| `sfx/jie.rage.m4a` | S11：bassdrum_hit_ff、gong_scrape_mf；S51：game_over_bad_chest | CC0 |
| `sfx/jie.split.m4a` | S45：shade12；S37：fout-02；S10：swosh-13 | CC0 |
| `sfx/xiuwei.light.m4a` | S19：impactWood_medium_001；S17：paper_01；S11：sus_E5_r01_main、HB_3 | CC0 |
| `sfx/xiuwei.reset.m4a` | S17：paper_03；S11：windchimes_desc1；S19：impactSoft_medium_001 | CC0 |
| `sfx/lobby.join.m4a` | S11：BellTree_Hit_C5_rr1_Mid、windchimes_asc1 | CC0 |
| `sfx/lobby.leave.m4a` | S11：windchimes_desc1、LogDrumLo_MedM_v2_rr1_Sum | CC0 |
| `sfx/lobby.ready.m4a` | S11：wood_click_ff、wood_click_mp、HB_2 | CC0 |
| `sfx/lobby.start.m4a` | S11：bassdrum_hit_ff、HDrumL_Hit_v3_rr1_Sum、gong_2_f、HB_1 | CC0 |
| `sfx/lobby.copy.m4a` | S11：wood_click_mp、sus_C5_r01_main | CC0 |
| `sfx/jindou.fly.m4a` | S10：swosh-15；S45：metal-ringing | CC0 |
| `sfx/jindou.suck.m4a` | S49：whoosh2_0；S10：swosh-24；S31：lowFrequency_explosion_001 | CC0 |
| `sfx/jindou.pour.m4a` | S30：water-pour-01；S29：splash_09 | CC0 |
| `sfx/jindou.spit.m4a` | S29：splash_12；S10：swosh-03；S19：impactSoft_medium_000 | CC0 |
| `sfx/jindou.land.m4a` | S29：splash_05；S19：impactSoft_heavy_001；S11：bassdrum_hit_f | CC0 |
| `sfx/huanghe.rise.m4a` | S11：OceanDrum_Sus_3_Mid；S29：loop_water_02；S35：shake | CC0 |
| `sfx/huanghe.slam.m4a` | S29：splash_01；S31：lowFrequency_explosion_000；S11：bassdrum_hit_ff、OceanDrum_Sus_2_Mid | CC0 |
| `sfx/huanghe.crash.m4a` | S29：splash_14；S18：bfh1_rock_falling_07；S19：impactSoft_heavy_004 | CC0 |
| `sfx/qingluan.dive.m4a` | S24：cloth2、cloth4；S10：swosh-12 | CC0 |
| `sfx/qingluan.frost.m4a` | S28：coldsnap；S11：glass1_D#4_Slow_1_Decay | CC0 |
| `sfx/qingluan.evolve.m4a` | S11：Gliss_Up_Swl_mf_1、sus_F#5_r01_main、windchimes_asc1、glass4_D5_Slow_2_Main | CC0 |
| `sfx/xiangmo.land.m4a` | S19：impactMetal_heavy_004；S11：bassdrum_hit_f；S18：bfh1_rock_falling_08 | CC0 |
| `sfx/zanxin.drill.m4a` | S30：metal-knife-scrape-02；S11：Anvil_Hit2_v3_rr1_Mid | CC0 |
| `sfx/jinjiao.snip.m4a` | S30：scissors-close-01；S19：impactMetal_medium_001；S20：sword.6 | CC0 |
| `sfx/yanguang.plant.m4a` | S19：impactWood_heavy_003；S24：cloth3；S26：ignition | CC0 |
| `sfx/yanguang.erupt.m4a` | S12：LEGIT_FIR_Fire_Staff 20-Audio；S26：ignition；S31：lowFrequency_explosion_001 | CC0 |
| `sfx/wanya.pour.m4a` | S24：cloth2、cloth4、cloth3；S12：LEGIT_FIR_Fire_Staff 16-Audio | CC0 |
| `sfx/wanya.boom.m4a` | S14：105016__julien-matthey__jm-fx-fireball-01；S12：LEGIT_FIR_Fire_Staff 6-Audio | CC0 |
| `sfx/relic.zhuo.m4a` | S10：swosh-14；S45：metal-ringing | CC0 |
| `sfx/relic.zhuo.land.m4a` | S19：impactBell_heavy_000；S11：bassdrum_hit_f；S18：bfh1_rock_falling_05 | CC0 |
| `sfx/relic.jadedragon.m4a` | S16：sfx100v2_air_02；S43：breath；S23：item_gem_02 | CC0 |
| `sfx/relic.mirror.m4a` | S11：glass3_A#4_Slow_1_Main、BellTree_Hit_G#5_rr1_Mid；S22：swish-6 | CC0 |
| `sfx/relic.umbrella.m4a` | S45：cloth-heavy；S19：impactSoft_heavy_003；S30：compressed-air-spray-01 | CC0 |
| `sfx/relic.pouch.m4a` | S30：cloth-pouch-shake-02；S23：item_gem_01；S11：sus_G#4_r01_main | CC0 |
| `sfx/relic.stormfeather.m4a` | S15：hit；S30：arrow-feathers-01、paralyzer-discharge-01 | CC0 |
| `sfx/relic.icevase.m4a` | S11：sus_E5_r01_main；S21：LedasLuzta5；S19：impactGlass_light_004 | CC0 |
| `sfx/relic.gu.m4a` | S45：bite-small；S29：slime_09；S43：bug_02 | CC0 |
| `sfx/relic.drum.m4a` | S11：bassdrum_hit_ff、HDrumL_Hit_v3_rr1_Sum、bassdrum_hit_f | CC0 |
| `sfx/relic.incense.m4a` | S30：match-light-01；S44：fire-1；S11：HB_3 | CC0 |
| `sfx/relic.dingshen.m4a` | S17：paper_02；S19：impactSoft_medium_004；S11：HB_2 | CC0 |
| `sfx/relic.yinlei.m4a` | S30：match-light-01；S16：sfx100v2_thunder_01；S15：killconfirmed | CC0 |
| `sfx/relic.dundi.m4a` | S27：Earth Element Magic Spell_0；S10：swosh-03；S19：impactSoft_heavy_004 | CC0 |
| `sfx/relic.huiling.m4a` | S17：paper_04；S11：sus_G#4_r01_main、G#4_mf_1 | CC0 |
| `music/battle.m4a` | S1：Aggressor | CC-BY 4.0 |
| `music/boss.m4a` | S2：Big Mojo | CC-BY 4.0 |
| `music/shop.m4a` | S3：Guzheng City | CC-BY 4.0 |
| `music/battle.ch2.m4a` | S4：Black Vortex | CC-BY 4.0 |
| `music/boss.ch2.m4a` | S5：Himalayan Atmosphere | CC-BY 4.0 |
| `music/battle.ch3.m4a` | S6：Volatile Reaction | CC-BY 4.0 |
| `music/boss.ch3.m4a` | S7：Hitman | CC-BY 4.0 |
| `music/ending.m4a` | S8：Nu Flute | CC-BY 4.0 |
| `music/calm.m4a` | S9：Ripples | CC-BY 4.0 |
| `music/compose-a.m4a` | S52：compose-a | CC0 |
| `music/compose-b.m4a` | S52：compose-b | CC0 |

<!-- 生成的表到此为止 -->
