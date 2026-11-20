// 素材配方：public/audio/ 下每个 .m4a 由哪些公开素材、怎样裁剪混合而成，以及每个来源的许可。
// 改了这里之后跑 `node tools/audio/build.ts` 重新生成；`--credits` 打印 docs/audio.md 的「来源与许可」表。
// 下载的原始素材放在 scratch/downloads/<来源>/（不进 git），来源网址见下面的 SOURCES。

export interface Layer {
  src: string; // 相对下载目录的路径，第一段是来源（SOURCES 的键）
  at?: number; // 在成品里的起点（秒）
  from?: number; // 取素材的片段（秒）
  to?: number;
  gain?: number; // dB
  rate?: number; // 变速（同时变调），<1 更低更慢
  reverse?: boolean;
  lowpass?: number; // Hz
  highpass?: number;
  fadeIn?: number; // 秒
  fadeOut?: number;
  /** 先把这一层（滤波之后）的峰值拉到 norm dBFS，gain 再在这之上加减（不写就按素材原来的电平）。 */
  norm?: number;
}

export interface Recipe {
  out: string; // 相对 public/audio/
  layers: Layer[];
  stereo?: boolean; // 音效默认单声道，音乐立体声
  keepLead?: boolean; // 保留开头的静音（默认去掉，让音效一触即发）
  maxLen?: number; // 成品最长多少秒（超出淡出截断）
  fadeOut?: number; // 结尾淡出（秒）
  loud?: number; // 响度归一的目标（dB，K 加权的最大瞬时响度；音乐按整体平均）
  kbps?: number;
  /** 编码：'aac' 是 AAC-LC（默认），'aach' 是 HE-AAC（配乐用，同样的听感体积约一半，docs/audio.md「瘦身」）。 */
  codec?: 'aac' | 'aach';
  /**
   * 音乐循环：成品截到 end，并把 end 之前 xfade 秒与 start 之前的同长片段交叉混合，运行时 loopStart=start、loopEnd=end 无缝循环。
   * match：按两段的相关系数 ρ 定交叉的曲线（两段加起来的功率恒定）：逐字重复的段落（ρ≈1）近于等幅交叉，不相关的（ρ≈0）是等功率交叉。
   * 不写 match 是原来的等功率交叉（两段一样时中间会鼓起约 3dB）；第一章的三首没改，免得成品平白变动。
   */
  loop?: { start: number; end: number; xfade: number; match?: boolean };
  /**
   * 去尖锐（只对音效；build.ts 的 SOFT_LADDER，docs/audio.md「尖锐度」）：每个音效从第 0 档起逐档加重（低通、高架衰减、2–5 kHz 削一点、整体降调），
   * 量到「温和」为止。min：至少从第几档起；max：最多到第几档；pitch: false：只滤波、不降调（音高本身有用的，例如古筝按连斩选音）。
   */
  soft?: { min?: number; max?: number; pitch?: false };
}

export interface Source {
  title: string;
  author: string;
  license: string;
  url: string;
  note?: string;
}

export const SOURCES: Record<string, Source> = {
  'kenney-impact-sounds': { title: 'Impact Sounds', author: 'Kenney', license: 'CC0', url: 'https://kenney.nl/assets/impact-sounds' },
  'kenney-rpg-audio': { title: 'RPG Audio', author: 'Kenney', license: 'CC0', url: 'https://kenney.nl/assets/rpg-audio' },
  'kenney-interface-sounds': { title: 'Interface Sounds', author: 'Kenney', license: 'CC0', url: 'https://kenney.nl/assets/interface-sounds' },
  'kenney-sci-fi-sounds': { title: 'Sci-fi Sounds', author: 'Kenney', license: 'CC0', url: 'https://kenney.nl/assets/sci-fi-sounds' },
  'kenney-casino-audio': { title: 'Casino Audio', author: 'Kenney', license: 'CC0', url: 'https://kenney.nl/assets/casino-audio' },
  vcsl: { title: 'Versilian Community Sample Library（VCSL）', author: 'Versilian Studios', license: 'CC0', url: 'https://github.com/sgossner/VCSL' },
  // 自作配乐（docs/audio.md「自作配乐」）：tools/audio/compose/ 里的乐谱与合成器离线渲出的 WAV（先跑 node tools/audio/compose/render.ts），
  // 打击乐、筝用的是上面 VCSL 的采样（CC0），琵琶、二胡、弦乐、低音是合成的。本项目自己的作品，按 CC0 一样处理（致谢里照列）
  compose: { title: '自作配乐「破阵」（本项目作曲、程序合成；打击乐与筝的采样来自 VCSL）', author: '本项目', license: 'CC0', url: 'https://github.com/sgossner/VCSL' },
  'oga-80-cc0-rpg-sfx': { title: '80 CC0 RPG SFX', author: 'rubberduck', license: 'CC0', url: 'https://opengameart.org/content/80-cc0-rpg-sfx' },
  'oga-100-cc0-sfx': { title: '100 CC0 SFX', author: 'rubberduck', license: 'CC0', url: 'https://opengameart.org/content/100-cc0-sfx' },
  'oga-100-cc0-sfx-2': { title: '100 CC0 SFX #2', author: 'rubberduck', license: 'CC0', url: 'https://opengameart.org/content/100-cc0-sfx-2' },
  'oga-75-cc0-breaking-falling-hit-sfx': { title: '75 CC0 breaking / falling / hit sfx', author: 'rubberduck', license: 'CC0', url: 'https://opengameart.org/content/75-cc0-breaking-falling-hit-sfx' },
  'oga-80-cc0-creature-sfx': { title: '80 CC0 creature SFX', author: 'rubberduck', license: 'CC0', url: 'https://opengameart.org/content/80-cc0-creature-sfx' },
  'oga-80-cc0-creture-sfx-2': { title: '80 CC0 creture SFX #2', author: 'rubberduck', license: 'CC0', url: 'https://opengameart.org/content/80-cc0-creture-sfx-2' },
  'oga-25-cc0-bang-firework-sfx': { title: '25 CC0 bang / firework SFX', author: 'rubberduck', license: 'CC0', url: 'https://opengameart.org/content/25-cc0-bang-firework-sfx' },
  'oga-40-cc0-water-splash-slime-sfx': { title: '40 CC0 water / splash / slime SFX', author: 'rubberduck', license: 'CC0', url: 'https://opengameart.org/content/40-cc0-water-splash-slime-sfx' },
  'oga-swishes-sound-pack': { title: 'Swishes Sound Pack', author: 'artisticdude', license: 'CC0', url: 'https://opengameart.org/content/swishes-sound-pack' },
  'oga-swish-bamboo-stick-weapon-swhoshes': { title: 'Swish - bamboo stick weapon swhoshes', author: 'qubodup', license: 'CC0', url: 'https://opengameart.org/content/swish-bamboo-stick-weapon-swhoshes' },
  'oga-3-melee-sounds': { title: '3 Melee sounds', author: 'remaxim', license: 'CC0', url: 'https://opengameart.org/content/3-melee-sounds' },
  'oga-fire-staff-sound-effects': { title: 'Fire Staff Sound Effects', author: 'LEGIT Audio', license: 'CC0', url: 'https://opengameart.org/content/fire-staff-sound-effects' },
  'oga-catching-fire': { title: 'Catching fire', author: 'themightyglider', license: 'CC0', url: 'https://opengameart.org/content/catching-fire', note: '改编自 freesound qubodup #159725（CC0）' },
  'oga-flare-ignition': { title: 'Flare ignition', author: 'qubodup', license: 'CC0', url: 'https://opengameart.org/content/flare-ignition' },
  'oga-fireball-1': { title: 'Fireball', author: 'Julien Matthey（diligentcircle 转载）', license: 'CC0', url: 'https://opengameart.org/content/fireball-1', note: '原始：freesound Julien Matthey #105016（CC0）' },
  'oga-freeze-spell-0': { title: 'Freeze Spell', author: 'artisticdude', license: 'CC0', url: 'https://opengameart.org/content/freeze-spell-0' },
  'oga-ice-spells': { title: 'Ice spells', author: 'bart', license: 'CC0', url: 'https://opengameart.org/content/ice-spells' },
  'oga-ice-breakingshattering': { title: 'Ice breaking/shattering', author: 'ignasd', license: 'CC0', url: 'https://opengameart.org/content/ice-breakingshattering' },
  'oga-electricity-game-sound-pack': { title: 'Electricity Game Sound Pack', author: 'faxcorp', license: 'CC0', url: 'https://opengameart.org/content/electricity-game-sound-pack' },
  'oga-earthquake-and-open-sesame': { title: 'Earthquake and Open sesame', author: 'mieki256', license: 'CC0', url: 'https://opengameart.org/content/earthquake-and-open-sesame' },
  'oga-earth-element-magic-spell': { title: 'Earth Element Magic Spell', author: 'qubodup', license: 'CC0', url: 'https://opengameart.org/content/earth-element-magic-spell' },
  'oga-low-rumbling': { title: 'Low Rumbling', author: 'musheran', license: 'CC0', url: 'https://opengameart.org/content/low-rumbling' },
  'oga-bell-dingschimes': { title: 'Bell dings/chimes', author: 'PWL', license: 'CC0', url: 'https://opengameart.org/content/bell-dingschimes' },
  'oga-big-scary-troll-sounds': { title: 'Big scary troll sounds', author: 'darsycho', license: 'CC0', url: 'https://opengameart.org/content/big-scary-troll-sounds' },
  'oga-cc0-deep-monster-roar': { title: 'CC0 Deep Monster Roar', author: 'trazzz123', license: 'CC0', url: 'https://opengameart.org/content/cc0-deep-monster-roar' },
  'oga-fantasy-sound-effects-tinysized-sfx': { title: 'Fantasy Sound Effects (Tinysized SFX)', author: 'Vehicle（Jan Schupke）', license: 'CC0', url: 'https://opengameart.org/content/fantasy-sound-effects-tinysized-sfx' },
  'oga-3-dark-magic-spells': { title: '3 dark magic spells', author: 'qubodup', license: 'CC0', url: 'https://opengameart.org/content/3-dark-magic-spells' },
  'oga-20-sword-sound-effects-attacks-and-clashes': { title: '20 Sword Sound Effects (Attacks and Clashes)', author: 'StarNinjas', license: 'CC0', url: 'https://opengameart.org/content/20-sword-sound-effects-attacks-and-clashes' },
  'oga-magic-spell-sfx': { title: 'Magic Spell SFX', author: 'jaggedstone', license: 'CC0', url: 'https://opengameart.org/content/magic-spell-sfx' },
  // 2026-11-11 加的（新内容的音效）：许可都在各自的页面上核对过
  'oga-rpg-sound-pack': { title: 'RPG Sound Pack', author: 'artisticdude', license: 'CC0', url: 'https://opengameart.org/content/rpg-sound-pack' },
  'oga-100-cc0-metal-and-wood-sfx': { title: '100 CC0 metal and wood SFX', author: 'rubberduck', license: 'CC0', url: 'https://opengameart.org/content/100-cc0-metal-and-wood-sfx' },
  'oga-ghost-monster-voice-moaning-growling': { title: 'Ghost Monster Voice Moaning & Growling', author: 'qubodup', license: 'CC0', url: 'https://opengameart.org/content/ghost-monster-voice-moaning-growling' },
  'oga-monster-sound-pack-volume-1': { title: 'Monster Sound Pack, Volume 1', author: 'Ogrebane', license: 'CC0', url: 'https://opengameart.org/content/monster-sound-pack-volume-1' },
  'oga-37-hitspunches': { title: '37 hits/punches', author: 'Independent.nu', license: 'CC0', url: 'https://opengameart.org/content/37-hitspunches' },
  'oga-10-impactshield-blocks': { title: '10 Impact/Shield Blocks', author: 'StarNinjas', license: 'CC0', url: 'https://opengameart.org/content/10-impactshield-blocks' },
  'oga-air-whoosh': { title: 'Air whoosh', author: 'pyranostudios', license: 'CC0', url: 'https://opengameart.org/content/air-whoosh' },
  'oga-fire-crackling': { title: 'Fire Crackling', author: 'AntumDeluge', license: 'CC0', url: 'https://opengameart.org/content/fire-crackling' },
  'oga-teleport': { title: 'Teleport', author: 'fins', license: 'CC0', url: 'https://opengameart.org/content/teleport', note: '原始：freesound fins #172206（CC0）' },
  'oga-game-over-bad-chest-sfx': { title: 'Game Over - Bad chest SFX', author: 'Oiboo', license: 'CC0', url: 'https://opengameart.org/content/game-over-bad-chest-sfx' },
  'oga-monster-snarls': { title: 'Monster snarls', author: 'Darsycho', license: 'CC0', url: 'https://opengameart.org/content/monster-snarls' },
  'kenney-ui-audio': { title: 'UI Audio', author: 'Kenney', license: 'CC0', url: 'https://kenney.nl/assets/ui-audio' },
  'kenney-digital-audio': { title: 'Digital Audio', author: 'Kenney', license: 'CC0', url: 'https://kenney.nl/assets/digital-audio' },
  'incompetech/Shenyang.mp3': { title: '"Shenyang"', author: 'Kevin MacLeod (incompetech.com)', license: 'CC-BY 4.0', url: 'https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1600066' },
  'incompetech/Big Mojo.mp3': { title: '"Big Mojo"', author: 'Kevin MacLeod (incompetech.com)', license: 'CC-BY 4.0', url: 'https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100306' },
  'incompetech/Guzheng City.mp3': { title: '"Guzheng City"', author: 'Kevin MacLeod (incompetech.com)', license: 'CC-BY 4.0', url: 'https://incompetech.com/music/royalty-free/index.html?isrc=USUAN2100001' },
  // 第二、三章与结局、安静页面的配乐（同一位作者、同一许可；isrc 见 incompetech 的曲目表）
  ...km('Eastern Thought', 'USUAN1100682'),
  ...km('Himalayan Atmosphere', 'USUAN1100204'),
  ...km('Oppressive Gloom', 'USUAN1100885'),
  ...km('Hitman', 'USUAN1300013'),
  ...km('Nu Flute', 'USUAN1100680'),
  ...km('Ripples', 'USUAN1100691'),
  // 2026-11-12 换的三首战斗曲（用户：「适合当前游戏的配乐……不要限制国风、电子、古典」，要节奏有劲、气势足；docs/audio.md「换战斗曲」）
  ...km('Black Vortex', 'USUAN1300037'),
  ...km('Volatile Reaction', 'USUAN1400039'),
};

/** Kevin MacLeod 的一首（CC-BY 4.0，需署名）：下载到 incompetech/<曲名>.mp3。 */
function km(title: string, isrc: string): Record<string, Source> {
  return { [`incompetech/${title}.mp3`]: { title: `"${title}"`, author: 'Kevin MacLeod (incompetech.com)', license: 'CC-BY 4.0', url: `https://incompetech.com/music/royalty-free/index.html?isrc=${isrc}` } };
}

// ---------- 路径简写 ----------
const KI = (f: string) => `kenney-impact-sounds/x/Audio/${f}.ogg`;
const KR = (f: string) => `kenney-rpg-audio/x/Audio/${f}.ogg`;
const KF = (f: string) => `kenney-interface-sounds/x/Audio/${f}.ogg`;
const KS = (f: string) => `kenney-sci-fi-sounds/x/Audio/${f}.ogg`;
const KC = (f: string) => `kenney-casino-audio/x/Audio/${f}.ogg`;
const ZH = (f: string) => `vcsl/Chordophones/Zithers/Dan Tranh/${f}.wav`; // 越南筝（古筝的近亲），音是五声音阶
const ID = (f: string) => `vcsl/Idiophones/Struck Idiophones/${f}`;
const MB = (f: string) => `vcsl/Membranophones/Struck Membranophones/${f}`;
const R1 = (f: string) => `oga-80-cc0-rpg-sfx/x/${f}.ogg`;
const R2 = (f: string) => `oga-100-cc0-sfx/x/${f}.ogg`;
const R3 = (f: string) => `oga-100-cc0-sfx-2/x/sfx100v2_${f}.ogg`;
const RB = (f: string) => `oga-75-cc0-breaking-falling-hit-sfx/x/bfh1_${f}.ogg`;
const RC = (f: string) => `oga-80-cc0-creature-sfx/x/${f}.ogg`;
const RC2 = (f: string) => `oga-80-cc0-creture-sfx-2/x/${f}.ogg`;
const RF = (f: string) => `oga-25-cc0-bang-firework-sfx/x/${f}.ogg`;
const RW = (f: string) => `oga-40-cc0-water-splash-slime-sfx/x/${f}.ogg`;
const SWI = (n: number) => `oga-swishes-sound-pack/x/swishes/swish-${n}.wav`;
const SWO = (n: number) => `oga-swish-bamboo-stick-weapon-swhoshes/x/swosh-${String(n).padStart(2, '0')}.flac`;
const MEL = (f: string) => `oga-3-melee-sounds/x/melee sounds/${f}.wav`;
const FS = (n: number) => `oga-fire-staff-sound-effects/x/LEGIT Audio_FIRE STAFF - FREE/Wavs/LEGIT_FIR_Fire_Staff ${n}-Audio.wav`;
const TS = (f: string) => `oga-fantasy-sound-effects-tinysized-sfx/x/sfx-cc0/${f}.wav`;
const EL = (f: string) => `oga-electricity-game-sound-pack/${f}.wav`;
const ICE = (f: string) => `oga-ice-breakingshattering/x/IceShatters/${f}.ogg`;
const FLAME = 'oga-catching-fire/flame_0.ogg';
const FLARE = 'oga-flare-ignition/ignition.flac';
const FIREBALL = 'oga-fireball-1/105016__julien-matthey__jm-fx-fireball-01.wav';
const FREEZE = 'oga-freeze-spell-0/freeze.wav';
const ICESP = (f: string) => `oga-ice-spells/x/${f}.wav`;
const QUAKE = 'oga-earthquake-and-open-sesame/shake.flac';
const EARTH = 'oga-earth-element-magic-spell/Earth Element Magic Spell_0.flac';
const RUMBLE = 'oga-low-rumbling/low-rumbling-176033.mp3';
const DING = (n: number) => `oga-bell-dingschimes/bell_ding${n}.wav`;
const TROLL = 'oga-big-scary-troll-sounds/troll-roars_0.ogg';
const DEEP = 'oga-cc0-deep-monster-roar/monster_roar.wav';
const DARK = (n: number) => `oga-3-dark-magic-spells/x/dark_magic/fout-0${n}.flac`;
const CLASH = (n: number) => `oga-20-sword-sound-effects-attacks-and-clashes/x/sword_clash.${n}.ogg`;
const MAGIC = (f: string) => `oga-magic-spell-sfx/${f}.ogg`;

const GONG_BIG = ID('Gong 2/hit_full2_loudest_ST.mp3');
const GONG_F = ID('Gong 1/gong_2_f.wav');
const GONG_LIGHT = ID('Gong 2/hit_light1.mp3');
const DRUM_FF = MB('Bass Drum 2/bassdrum_hit_ff.wav');
const DRUM_F = MB('Bass Drum 2/bassdrum_hit_f.wav');
const DRUM_ROLL = MB('Bass Drum 2/bassdrum_roll_ff.wav');
const FRAME = MB('Frame Drum/HDrumL_Hit_v3_rr1_Sum.wav');
const CRESC = (s: '1.5s' | '2s') => ID(`Suspended Cymbal 1/susCymb1_cresc_${s}.wav`);
const CRASH = (f: string) => ID(`Clash Cymbals 1/${f}.wav`);
const GLOCK = (f: string) => ID(`Glockenspiel/${f}.wav`);
const BELLTREE = (n: number) => ID(`Bell Tree/Stroke/BellTree_Stroke_${n}_Mid.wav`);
const WIND = (f: 'asc1' | 'desc1') => ID(`Mark Trees/Legacy/windchimes_${f}.wav`);
const HB = (n: number) => ID(`Hand Bells, Nepalese/HB_${n}.wav`);
const TRI = ID('Triangles/Triangle6_HitM_v1_rr1_Mid.wav');
const WOOD = (f: string) => ID(`Woodblock/${f}.wav`);
const LOG = (f: 'Hi' | 'Lo') => ID(`Slit Drum/LogDrum${f}_MedM_v2_rr1_Sum.wav`);
const ANVIL = ID('Anvil/Anvil_Hit2_v3_rr1_Mid.wav');
// 2026-11-11 加的来源
const RP = (f: string) => `oga-rpg-sound-pack/x/RPG Sound Pack/${f}.wav`;
const MW = (f: string) => `oga-100-cc0-metal-and-wood-sfx/x/${f}.ogg`;
const GHOST = (n: number) => `oga-ghost-monster-voice-moaning-growling/x/qubodup-GhostMoans/wav/qubodup-GhostMoan0${n}.wav`;
const MON = (f: string) => `oga-monster-sound-pack-volume-1/x/Monster-Sounds-Volume-2/${f}.wav`;
const HITS = (n: number) => `oga-37-hitspunches/x/hits/hit${String(n).padStart(2, '0')}.mp3.flac`;
const SHIELD = (n: number) => `oga-10-impactshield-blocks/x/impact.${n}.ogg`;
const SWORD = (n: number) => `oga-20-sword-sound-effects-attacks-and-clashes/x/sword - StarNinjas/sword.${n}.ogg`;
const AIR = 'oga-air-whoosh/whoosh2_0.wav';
const CRACKLE = 'oga-fire-crackling/fire-1.wav';
const TELE = 'oga-teleport/172206__fins__teleport.wav';
const BADCHEST = 'oga-game-over-bad-chest-sfx/game_over_bad_chest.wav';
const SNARL = (f: string) => `oga-monster-snarls/${f}.ogg`;
const KU = (f: string) => `kenney-ui-audio/x/Audio/${f}.ogg`;
const KD = (f: string) => `kenney-digital-audio/x/Audio/${f}.ogg`;
const ZT = (f: string) => `vcsl/Chordophones/Zithers/${f}.wav`; // 越南筝之外的弦鸣：擦弦扬琴（Bowed Psaltery）
const FG = (f: string) => `vcsl/Idiophones/Friction Idiophones/Wine Glasses/${f}.wav`; // 酒杯（擦出来的长音，阴）
const OCEAN = (n: 2 | 3) => `vcsl/Membranophones/Other Membranophones/Ocean Drum/OceanDrum_Sus_${n}_Mid.wav`;
const SLEIGH = (f: string) => ID(`Sleigh Bells/${f}.wav`);
const CHIME = (f: string) => ID(`Hand Chimes/sus_${f}_r01_main.wav`);
const TUBE = (f: string) => ID(`Tubular Bells 1/chimes_${f}.wav`);
const BOWCYM = (n: 7 | 13) => ID(`Suspended Cymbal 1/susCymb1_bow_${n}.wav`);
const GONG_P = ID('Gong 1/gong_p.wav');
const GONG_MF = ID('Gong 1/gong_mf.wav');
const GONG_SCRAPE = ID('Gong 1/gong_scrape_mf.wav');

/** 摇一只手铃：同一下敲击按 times 次、约 dt 秒一下叠起来，一次比一次轻、音高轻轻错开（铃舌来回撞的样子）；最后一下留着余音。 */
const shakeBell = (src: string, at: number, times: number, dt: number, gain = 0): Layer[] =>
  Array.from({ length: times }, (_, i): Layer => ({
    src,
    at: at + i * dt * (1 + 0.12 * Math.sin(i * 2.1)),
    norm: 0,
    gain: gain - i * 1.6,
    rate: 1 + 0.018 * Math.sin(i * 3.7),
    ...(i < times - 1 ? { to: 0.5, fadeOut: 0.32 } : {}),
  }));

// 击杀的古筝音：越南筝本身按五声音阶定弦，C# D# F# G# B 两个八度
export const KILL_NOTES = ['C#3', 'D#3', 'F#3', 'G#3', 'B3', 'C#4', 'D#4', 'F#4', 'G#4', 'B4'];

export const SFX: Recipe[] = [
  // ---------- 法宝 ----------
  // 乾坤圈：掷出是竹竿破风（中等长度），命中是闷闷的「咚」加低频（用户：之前太尖），所以命中都过低通
  ...[14, 17, 22].map((n, i): Recipe => ({ out: `sfx/qiankun.throw.${i + 1}.m4a`, layers: [{ src: SWO(n), highpass: 140 }] })),
  { out: 'sfx/qiankun.hit.1.m4a', maxLen: 0.34, fadeOut: 0.2, layers: [{ src: KI('impactBell_heavy_004'), lowpass: 3200 }, { src: KI('impactPunch_medium_000'), gain: -5, lowpass: 2500 }] },
  { out: 'sfx/qiankun.hit.2.m4a', maxLen: 0.34, fadeOut: 0.22, layers: [{ src: KI('impactBell_heavy_002'), lowpass: 3000 }, { src: KI('impactPunch_medium_001'), gain: -4, lowpass: 2500 }] },
  { out: 'sfx/qiankun.hit.3.m4a', maxLen: 0.34, fadeOut: 0.22, layers: [{ src: KI('impactBell_heavy_003'), lowpass: 3000, rate: 0.94 }, { src: KI('impactPunch_medium_002'), gain: -4, lowpass: 2500 }] },
  { out: 'sfx/hit.crit.m4a', maxLen: 0.6, fadeOut: 0.4, layers: [{ src: CHIME('G#4') }] },
  { out: 'sfx/qiankun.hover.1.m4a', layers: [{ src: SWO(24), highpass: 120 }] },
  { out: 'sfx/qiankun.hover.2.m4a', maxLen: 1.0, fadeOut: 0.3, layers: [{ src: SWO(23), highpass: 120 }] },
  // 火尖枪：短促破风 + 擦火柴的「嗤」+ 一点火苗
  { out: 'sfx/huojian.thrust.1.m4a', maxLen: 0.45, fadeOut: 0.2, layers: [{ src: SWI(10), gain: -2 }, { src: TS('match-light-01'), gain: -5, at: 0.01 }, { src: FS(7), gain: -10, to: 0.4, fadeOut: 0.2 }] },
  { out: 'sfx/huojian.thrust.2.m4a', maxLen: 0.45, fadeOut: 0.2, layers: [{ src: SWI(11), gain: -2 }, { src: TS('lighter-light-01'), gain: -6, at: 0.01 }, { src: FS(8), gain: -10, to: 0.4, fadeOut: 0.2 }] },
  // 九龙神火罩：呼地腾起的火
  { out: 'sfx/jiulong.burst.1.m4a', maxLen: 1.1, fadeOut: 0.45, layers: [{ src: FS(6) }, { src: FLAME, gain: -6 }] },
  { out: 'sfx/jiulong.burst.2.m4a', maxLen: 1.1, fadeOut: 0.45, layers: [{ src: FIREBALL, to: 1.2, fadeOut: 0.5, gain: -2 }, { src: FS(11), gain: -4 }] },
  // 雷公鞭：电火花的噼啪 + 雷声余韵
  { out: 'sfx/leigong.strike.1.m4a', maxLen: 1.2, fadeOut: 0.5, layers: [{ src: EL('groundhit') }, { src: EL('hit'), to: 0.7, fadeOut: 0.3, gain: -7 }, { src: R3('thunder_01'), from: 0.1, to: 1.3, fadeIn: 0.02, fadeOut: 0.5, lowpass: 1600, gain: -6 }] },
  { out: 'sfx/leigong.strike.2.m4a', maxLen: 1.2, fadeOut: 0.5, layers: [{ src: EL('killconfirmed'), to: 0.7, fadeOut: 0.3 }, { src: EL('groundhit'), gain: -4 }, { src: R3('thunder_01'), from: 1.6, to: 2.8, fadeIn: 0.02, fadeOut: 0.5, lowpass: 1600, gain: -6 }] },
  { out: 'sfx/leigong.mark.m4a', maxLen: 0.45, fadeOut: 0.2, layers: [{ src: TS('paralyzer-discharge-01'), to: 0.4, highpass: 700 }, { src: EL('crackleelectricityloop'), gain: -4, highpass: 700 }] },
  // 番天印：下坠的低沉破风，落地是大鼓 + 砸地 + 碎石
  { out: 'sfx/fantian.fall.m4a', layers: [{ src: SWO(3), rate: 0.8, lowpass: 2200 }] },
  { out: 'sfx/fantian.land.1.m4a', maxLen: 1.2, fadeOut: 0.6, layers: [{ src: DRUM_FF, to: 1.4 }, { src: R2('slam_02'), gain: -4 }, { src: RB('rock_falling_01'), at: 0.04, gain: -12 }] },
  { out: 'sfx/fantian.land.2.m4a', maxLen: 1.2, fadeOut: 0.6, layers: [{ src: MB('Bass Drum 1/BDrumNew_hit_v7_rr1_Sum.wav'), to: 1.4 }, { src: KI('impactMining_000'), gain: -4 }, { src: RB('rock_falling_03'), at: 0.05, gain: -13 }] },
  // 杏黄旗：护盾升起是一串铃，挡下一击是金属的「叮」，破碎是碎玻璃 + 闷响
  { out: 'sfx/xinghuang.up.m4a', maxLen: 1.6, fadeOut: 0.8, layers: [{ src: BELLTREE(3), to: 1.8 }, { src: HB(2), at: 0.12, gain: -6 }] },
  { out: 'sfx/xinghuang.block.1.m4a', maxLen: 0.55, fadeOut: 0.35, layers: [{ src: CLASH(2), lowpass: 3200 }, { src: KI('impactPlate_light_000'), gain: -6 }] },
  { out: 'sfx/xinghuang.block.2.m4a', maxLen: 0.55, fadeOut: 0.35, layers: [{ src: CLASH(5), lowpass: 3200 }, { src: KI('impactPlate_light_002'), gain: -6 }] },
  { out: 'sfx/xinghuang.break.m4a', maxLen: 1.0, fadeOut: 0.45, layers: [{ src: RB('glass_breaking_01') }, { src: ICE('LedasLuzta'), gain: -5 }, { src: MB('Bass Drum 1/BDrumNew_hit_v5_rr1_Sum.wav'), to: 0.9, gain: -3 }] },
  // 斩仙飞刀：很短的轻破风；命中是刀刃入肉的「嚓」（压掉刺耳的高频）
  ...[1, 2, 3, 4].map((n, i): Recipe => ({ out: `sfx/zhanxian.fly.${i + 1}.m4a`, layers: [{ src: SWI(n), rate: 1.15, highpass: 250 }] })),
  { out: 'sfx/zhanxian.hit.1.m4a', maxLen: 0.3, fadeOut: 0.15, layers: [{ src: R1('blade_01'), lowpass: 5500 }, { src: KI('impactPunch_medium_001'), gain: -9, lowpass: 2000 }] },
  { out: 'sfx/zhanxian.hit.2.m4a', maxLen: 0.3, fadeOut: 0.15, layers: [{ src: R1('blade_02'), lowpass: 5500 }, { src: KI('impactPunch_medium_002'), gain: -9, lowpass: 2000 }] },
  { out: 'sfx/zhanxian.hit.3.m4a', maxLen: 0.3, fadeOut: 0.15, layers: [{ src: KR('knifeSlice'), lowpass: 5500 }, { src: KI('impactPunch_medium_000'), gain: -9, lowpass: 2000 }] },
  // 寒冰幡：冰棱刺出是碎冰，寒气蔓延是细碎的冰裂声
  { out: 'sfx/hanbing.spike.1.m4a', maxLen: 0.5, fadeOut: 0.25, layers: [{ src: ICE('LedasLuzta2') }, { src: KI('impactGlass_light_002'), gain: -5 }] },
  { out: 'sfx/hanbing.spike.2.m4a', maxLen: 0.5, fadeOut: 0.25, layers: [{ src: ICE('LedasLuzta'), to: 0.55 }, { src: KI('impactGlass_light_003'), gain: -5 }] },
  { out: 'sfx/hanbing.frost.m4a', maxLen: 1.4, fadeOut: 0.6, layers: [{ src: FREEZE, to: 1.5, fadeIn: 0.15 }, { src: R2('glass_04'), at: 0.1, gain: -12 }] },

  // ---------- 地面区域与持续伤害 ----------
  { out: 'sfx/zone.fire.m4a', maxLen: 0.9, fadeOut: 0.45, layers: [{ src: FS(7) }, { src: FLARE, to: 0.9, gain: -10, fadeOut: 0.4 }] },
  { out: 'sfx/zone.crack.m4a', maxLen: 1.1, fadeOut: 0.5, layers: [{ src: RB('rock_breaking_01') }, { src: EARTH, to: 1.1, gain: -4, fadeOut: 0.4 }, { src: R2('slam_02'), gain: -12 }] },
  { out: 'sfx/zone.frost.m4a', maxLen: 1.2, fadeOut: 0.5, layers: [{ src: ICESP('ice'), lowpass: 3500 }, { src: ICESP('coldsnap'), to: 1.2, gain: -6, lowpass: 3500 }] },
  { out: 'sfx/dot.bleed.1.m4a', maxLen: 0.3, fadeOut: 0.15, layers: [{ src: RW('slime_04'), lowpass: 2500 }] },
  { out: 'sfx/dot.bleed.2.m4a', maxLen: 0.3, fadeOut: 0.15, layers: [{ src: RW('slime_06'), lowpass: 2500 }] },

  // ---------- 五行相生（各带一声清亮的三角铁，听得出「相生」触发了）----------
  { out: 'sfx/react.frost.m4a', maxLen: 1.0, fadeOut: 0.5, layers: [{ src: ICE('LedasLuzta5') }, { src: R2('glass_05'), gain: -6 }, { src: TRI, gain: -10 }] },
  { out: 'sfx/react.conduct.m4a', maxLen: 0.9, fadeOut: 0.4, layers: [{ src: EL('killconfirmed'), to: 0.9 }, { src: TS('paralyzer-discharge-02'), to: 0.5, gain: -9, highpass: 800 }, { src: TRI, gain: -10 }] },
  { out: 'sfx/react.ignite.m4a', maxLen: 0.9, fadeOut: 0.45, layers: [{ src: FLAME }, { src: FS(6), gain: -4 }, { src: TRI, gain: -12 }] },
  { out: 'sfx/react.lava.m4a', maxLen: 1.2, fadeOut: 0.6, layers: [{ src: KS('lowFrequency_explosion_001') }, { src: FS(3), to: 1.2, gain: -4, fadeOut: 0.5 }, { src: FLARE, to: 1.0, gain: -11 }] },
  { out: 'sfx/react.pierce.m4a', maxLen: 0.8, fadeOut: 0.45, layers: [{ src: ANVIL, lowpass: 7000 }, { src: KI('impactMetal_heavy_001'), gain: -4 }, { src: KI('impactPlate_heavy_000'), gain: -6 }] },

  // ---------- 宠物：混天绫 ----------
  { out: 'sfx/pet.fly.1.m4a', layers: [{ src: SWO(12), rate: 1.15, highpass: 200 }, { src: KR('cloth2'), gain: -9 }] },
  { out: 'sfx/pet.fly.2.m4a', layers: [{ src: SWO(11), rate: 1.15, highpass: 200 }, { src: KR('cloth4'), gain: -8 }] },
  { out: 'sfx/pet.wrap.1.m4a', maxLen: 0.5, fadeOut: 0.25, layers: [{ src: SWO(10), rate: 1.1, highpass: 200 }, { src: KR('clothBelt2'), to: 0.45, gain: -7, fadeOut: 0.2 }, { src: KI('impactSoft_medium_000'), gain: -12 }] },
  { out: 'sfx/pet.wrap.2.m4a', maxLen: 0.5, fadeOut: 0.25, layers: [{ src: SWO(16), rate: 1.1, highpass: 200 }, { src: KR('clothBelt'), to: 0.45, gain: -8, fadeOut: 0.2 }, { src: KI('impactSoft_medium_001'), gain: -12 }] },
  { out: 'sfx/pet.evolve.m4a', maxLen: 2.4, fadeOut: 1.0, layers: [{ src: ZH('Gliss/Gliss_Up_Slw_mf_1'), to: 2.6 }, { src: BELLTREE(1), at: 0.5, to: 2.0, gain: -6 }] },

  // ---------- 掉落 ----------
  { out: 'sfx/drop.spawn.m4a', maxLen: 0.8, fadeOut: 0.5, layers: [{ src: DING(2) }] },
  { out: 'sfx/drop.chest.m4a', maxLen: 1.4, fadeOut: 0.7, layers: [{ src: R2('wooded_box_open') }, { src: R1('item_coins_02'), at: 0.12, gain: -4 }, { src: CHIME('G#4'), at: 0.2, to: 1.0, gain: -8 }, { src: WIND('asc1'), at: 0.15, to: 1.4, gain: -10 }] },
  { out: 'sfx/drop.peach.m4a', maxLen: 1.0, fadeOut: 0.5, layers: [{ src: TS('apple-cut-02') }, { src: DING(3), at: 0.1, gain: -5 }] },
  { out: 'sfx/drop.magnet.m4a', maxLen: 1.6, fadeOut: 0.6, layers: [{ src: KR('bookFlip1'), gain: -3 }, { src: WIND('asc1'), at: 0.05, to: 1.7, gain: -2 }, { src: SWO(12), at: 0.05, rate: 0.9, gain: -8 }] },

  // ---------- 首领 ----------
  { out: 'sfx/boss.intro.m4a', maxLen: 3.5, fadeOut: 2.0, layers: [{ src: GONG_BIG, to: 4 }, { src: DRUM_FF, to: 2.5, gain: -3 }] },
  { out: 'sfx/boss.roar.m4a', maxLen: 2.2, fadeOut: 0.7, layers: [{ src: TROLL, to: 2.3 }, { src: DEEP, from: 0.25, to: 2.5, lowpass: 700, gain: -7 }] },
  { out: 'sfx/boss.phase.m4a', maxLen: 3.0, fadeOut: 1.6, layers: [{ src: GONG_F, to: 3.2 }, { src: CRASH('cymbal_crash1_mf1'), to: 2.5, gain: -7 }, { src: QUAKE, to: 2.5, lowpass: 900, gain: -6, fadeOut: 1 }] },
  { out: 'sfx/boss.ring.warn.m4a', keepLead: true, maxLen: 1.5, fadeOut: 0.12, layers: [{ src: CRESC('1.5s'), to: 1.5 }, { src: ID('Gong 2/scrape1.mp3'), to: 1.5, gain: -12, fadeIn: 0.5 }] },
  { out: 'sfx/boss.ring.throw.m4a', maxLen: 0.9, fadeOut: 0.4, layers: [{ src: SWO(3), rate: 0.7, lowpass: 2500 }, { src: GONG_LIGHT, to: 0.9, gain: -10 }] },
  { out: 'sfx/boss.dash.charge.m4a', keepLead: true, maxLen: 2.0, fadeOut: 0.15, layers: [{ src: CRESC('2s'), to: 2.0 }, { src: FS(14), to: 2.0, gain: -7 }] },
  { out: 'sfx/boss.dash.m4a', maxLen: 1.0, fadeOut: 0.45, layers: [{ src: MEL('melee sound'), rate: 0.85, lowpass: 3000 }, { src: FS(6), gain: -3 }, { src: FIREBALL, to: 0.9, gain: -7, fadeOut: 0.4 }] },
  { out: 'sfx/boss.clone.m4a', maxLen: 1.6, fadeOut: 0.7, layers: [{ src: WIND('desc1'), to: 1.7, gain: -2 }, { src: DARK(2), gain: -5 }, { src: SWO(13), rate: 0.85, gain: -8 }] },
  { out: 'sfx/boss.sweep.warn.m4a', maxLen: 1.4, fadeOut: 0.4, layers: [{ src: ZH('Tremolo/F#3_Trem_1'), from: 0.1, to: 1.6 }, { src: DRUM_ROLL, to: 1.5, gain: -6 }] },
  { out: 'sfx/boss.sweep.m4a', maxLen: 1.0, fadeOut: 0.4, layers: [{ src: SWO(3), rate: 0.75, lowpass: 3000 }, { src: SWO(28), gain: -5, rate: 0.9 }, { src: KR('cloth1'), gain: -8 }] },
  { out: 'sfx/boss.wheel.warn.m4a', maxLen: 1.6, fadeOut: 0.5, layers: [{ src: DRUM_ROLL, to: 1.7 }, { src: FS(18), to: 1.7, gain: -9, fadeIn: 0.3 }] },
  { out: 'sfx/boss.wheel.m4a', maxLen: 1.6, fadeOut: 0.6, layers: [{ src: FS(2), to: 1.7 }, { src: KS('thrusterFire_000'), to: 1.7, gain: -8, fadeIn: 0.1 }] },
  { out: 'sfx/boss.miasma.m4a', maxLen: 2.6, fadeOut: 1.0, layers: [{ src: RUMBLE, from: 1, to: 3.8, fadeIn: 0.4 }, { src: DARK(1), to: 2.6, gain: -9, fadeIn: 0.3 }] },
  { out: 'sfx/boss.hurt.1.m4a', maxLen: 0.5, fadeOut: 0.3, layers: [{ src: KI('impactPunch_heavy_000') }, { src: KI('impactPlate_heavy_000'), gain: -8 }] },
  { out: 'sfx/boss.hurt.2.m4a', maxLen: 0.5, fadeOut: 0.3, layers: [{ src: KI('impactPunch_heavy_002') }, { src: KI('impactPlate_heavy_001'), gain: -8 }] },
  { out: 'sfx/boss.death.m4a', maxLen: 4.0, fadeOut: 2.2, layers: [{ src: RF('cannon_02') }, { src: GONG_BIG, at: 0.05, to: 4.5, gain: -2 }, { src: CRASH('cymbal_crash1_mf1'), at: 0.05, to: 3, gain: -6 }, { src: RC2('die_03'), gain: -8, rate: 0.8 }] },

  // ---------- 对白与界面 ----------
  { out: 'sfx/dialogue.blip.1.m4a', maxLen: 0.12, fadeOut: 0.07, layers: [{ src: WOOD('wood_click_pp_rr1'), highpass: 300 }] },
  { out: 'sfx/dialogue.blip.2.m4a', maxLen: 0.12, fadeOut: 0.07, layers: [{ src: WOOD('wood_click3_vl1'), rate: 1.2, highpass: 300 }] },
  { out: 'sfx/ui.click.m4a', maxLen: 0.2, fadeOut: 0.1, layers: [{ src: WOOD('wood_click_mp') }] },
  { out: 'sfx/ui.buy.m4a', maxLen: 0.8, fadeOut: 0.4, layers: [{ src: R1('item_coins_01') }, { src: CHIME('C4'), at: 0.05, to: 0.8, gain: -9 }] },
  { out: 'sfx/ui.lock.m4a', layers: [{ src: KR('metalLatch') }] },
  { out: 'sfx/ui.reroll.m4a', maxLen: 0.7, fadeOut: 0.3, layers: [{ src: KC('card-fan-1') }, { src: WOOD('wood_click_pp_rr1'), at: 0.02, gain: -8 }] },
  { out: 'sfx/ui.ready.m4a', maxLen: 1.2, fadeOut: 0.7, layers: [{ src: HB(1), to: 1.3 }, { src: WOOD('wood_click_mp'), gain: -6 }] },
  { out: 'sfx/ui.denied.m4a', maxLen: 0.4, fadeOut: 0.2, layers: [{ src: LOG('Lo'), to: 0.3, fadeOut: 0.1 }, { src: LOG('Lo'), at: 0.11, to: 0.3, fadeOut: 0.15, gain: -2 }] },
  { out: 'sfx/ui.levelup.m4a', maxLen: 1.8, fadeOut: 0.8, layers: [{ src: ZH('Gliss/Gliss_Up_Med_mf_1'), from: 0.1, to: 2.1 }] },

  // ---------- 通用（现有方法改用素材）----------
  ...KILL_NOTES.map((n, i): Recipe => ({
    out: `sfx/kill.${i}.m4a`,
    maxLen: 0.9,
    fadeOut: 0.6,
    layers: [{ src: ZH(`Normal/${n}_mf_1`), to: 1.0 }, { src: KI('impactPunch_medium_001'), gain: -14, lowpass: 1200 }],
  })),
  { out: 'sfx/kill.elite.m4a', maxLen: 1.6, fadeOut: 0.9, layers: [{ src: ZH('Normal/F#2_f_1'), to: 1.8 }, { src: ZH('Normal/C#3_mf_1'), at: 0.004, to: 1.8, gain: -2 }, { src: ZH('Normal/G#3_mf_1'), at: 0.008, to: 1.8, gain: -3 }, { src: MB('Bass Drum 1/BDrumNew_hit_v5_rr1_Sum.wav'), to: 1.2, gain: -4 }, { src: CRASH('cymbal_crash1_short2'), to: 1.2, gain: -12 }] },
  { out: 'sfx/pickup.lo.m4a', maxLen: 0.45, fadeOut: 0.3, layers: [{ src: CHIME('C4'), to: 0.6 }] },
  { out: 'sfx/pickup.mid.m4a', maxLen: 0.45, fadeOut: 0.3, layers: [{ src: CHIME('G#4'), to: 0.6 }] },
  { out: 'sfx/pickup.hi.m4a', maxLen: 0.4, fadeOut: 0.28, layers: [{ src: CHIME('C5'), to: 0.6 }] },
  { out: 'sfx/hurt.m4a', maxLen: 0.5, fadeOut: 0.3, layers: [{ src: KI('impactPunch_heavy_001') }, { src: KI('impactSoft_heavy_001'), gain: -4 }] },
  { out: 'sfx/skill.m4a', maxLen: 3.2, fadeOut: 2.0, layers: [{ src: GONG_F, to: 3.4 }, { src: DRUM_FF, to: 1.8, gain: -2 }, { src: SWO(3), rate: 0.7, gain: -7 }, { src: FS(18), to: 1.5, gain: -12, fadeOut: 0.6 }] },
  { out: 'sfx/drum.m4a', maxLen: 0.9, fadeOut: 0.5, layers: [{ src: DRUM_F, to: 1.0 }, { src: FRAME, gain: -7 }] },
  { out: 'sfx/wave.start.m4a', maxLen: 1.4, fadeOut: 0.7, layers: [{ src: DRUM_F, to: 1.0, fadeOut: 0.4 }, { src: FRAME, gain: -7 }, { src: DRUM_FF, at: 0.2, to: 1.2 }, { src: FRAME, at: 0.2, gain: -6 }] },
  { out: 'sfx/wave.end.m4a', maxLen: 2.6, fadeOut: 1.6, layers: [{ src: GONG_LIGHT, to: 2.8 }] },
  { out: 'sfx/cast.m4a', maxLen: 0.6, fadeOut: 0.25, layers: [{ src: MAGIC('magical_1_0'), to: 0.7, gain: -2 }, { src: DARK(2), to: 0.6, gain: -10, fadeIn: 0.1 }] },
  { out: 'sfx/orb.m4a', maxLen: 0.3, fadeOut: 0.15, layers: [{ src: TS('water-drop-01'), lowpass: 2500, rate: 0.85 }, { src: R2('plop_02'), gain: -8, lowpass: 2000 }] },
  { out: 'sfx/dispel.m4a', maxLen: 0.7, fadeOut: 0.4, layers: [{ src: CHIME('E5'), to: 0.8, norm: 0 }, { src: ID('Bell Tree/Individual/BellTree_Hit_E5_rr1_Mid.wav'), to: 0.8, norm: 0, gain: -14, lowpass: 3000 }] }, // 2026-11-12：原来是铃树 + 三角铁，太亮，改成手钟为主

  // ======== 2026-11-11 新内容：每一层都先 norm 到 0dBFS 再按 gain 叠（层与层的轻重好估），成品照旧按响度归一 ========

  // ---------- 第一章的敌人（原来借着首领、法宝的声音）----------
  // 长矛兵蓄力：矛杆一绷（木头的吱声）、矛尖一点刮擦
  { out: 'sfx/enemy.spear.warn.m4a', keepLead: true, maxLen: 0.55, fadeOut: 0.12, layers: [{ src: KR('creak2'), from: 0.2, to: 0.75, norm: 0, fadeIn: 0.15 }, { src: TS('metal-knife-scrape-01'), from: 0.3, to: 0.8, norm: 0, gain: -12, fadeIn: 0.2, lowpass: 6000 }] },
  // 一矛刺出：短的破风、矛杆一震、矛尖一点金属（两种）
  ...([10, 11] as const).map((w, i): Recipe => ({ out: `sfx/enemy.spear.${i + 1}.m4a`, maxLen: 0.4, fadeOut: 0.2, layers: [{ src: SWI(w), rate: 0.95, norm: 0 }, { src: KI(`impactWood_light_00${i + 3}`), norm: 0, gain: -6 }, { src: KI('impactMetal_light_004'), at: 0.03, norm: 0, gain: -14 }] })),
  // 骑兵亮出冲锋线：马打一个响鼻、蹄子刨地三下（一下比一下快）
  { out: 'sfx/enemy.charge.warn.m4a', keepLead: true, maxLen: 0.85, fadeOut: 0.15, layers: [{ src: RC('nose'), rate: 0.75, norm: 0, gain: -2 }, { src: KI('impactSoft_heavy_000'), at: 0.3, norm: 0, gain: -6, lowpass: 1500 }, { src: KI('impactSoft_heavy_001'), at: 0.5, norm: 0, gain: -5, lowpass: 1500 }, { src: KI('impactSoft_heavy_002'), at: 0.65, norm: 0, gain: -4, lowpass: 1500 }] },
  // 冲锋：一串马蹄、一道破风
  { out: 'sfx/enemy.charge.m4a', maxLen: 0.9, fadeOut: 0.4, layers: [...[0, 0.11, 0.2, 0.3, 0.39, 0.48].map((at, k): Layer => ({ src: KI(`impactSoft_heavy_00${k % 5}`), at, norm: 0, gain: -3 - k * 0.8, lowpass: 1500 })), { src: SWO(3), rate: 0.85, norm: 0, gain: -4, lowpass: 3000 }] },
  // 自爆鬼点燃爆符：擦火、符纸「嗤嗤」地烧
  { out: 'sfx/enemy.fuse.m4a', keepLead: true, maxLen: 0.7, fadeOut: 0.15, layers: [{ src: TS('match-light-01'), norm: 0 }, { src: CRACKLE, from: 0.4, to: 1.1, norm: 0, gain: -6, fadeIn: 0.1 }, { src: TS('compressed-air-spray-01'), from: 0.1, to: 0.7, norm: 0, gain: -14, lowpass: 5000, fadeIn: 0.2 }] },
  // 炸开：爆竹似的一声炸、低的轰、碎纸
  { out: 'sfx/enemy.explode.m4a', maxLen: 1.0, fadeOut: 0.5, layers: [{ src: RF('bang_07'), norm: 0 }, { src: KS('lowFrequency_explosion_000'), norm: 0, gain: -7 }, { src: R2('paper_02'), at: 0.05, norm: 0, gain: -14 }] },
  // 分魂鬼分裂：一声轻的鬼声裂开、一道小破风
  { out: 'sfx/enemy.split.m4a', maxLen: 0.6, fadeOut: 0.3, layers: [{ src: RP('NPC/shade/shade4'), rate: 1.15, norm: 0, gain: -2 }, { src: SWO(13), rate: 1.2, norm: 0, gain: -9 }] },
  // 盾兵正面挡下：木盾一挡（两种），盾边一点金属
  ...([1, 8] as const).map((n, i): Recipe => ({ out: `sfx/enemy.guard.${i + 1}.m4a`, maxLen: 0.45, fadeOut: 0.22, layers: [{ src: SHIELD(n), norm: 0, lowpass: 5000 }, { src: KI(`impactWood_medium_00${i + 1}`), norm: 0, gain: -5 }, { src: KI('impactPlate_light_003'), norm: 0, gain: -12 }] })),

  // ---------- 第二章：姚天君（落魂阵：阴森、摇铃）----------
  // 入场：一声沉的锣、铃摇几下，底下一缕往上走的鬼声（鬼哭的录音调高、压掉低频）
  { out: 'sfx/yao.intro.m4a', maxLen: 3.4, fadeOut: 1.8, layers: [{ src: GONG_MF, to: 3.6, norm: 0, lowpass: 2400 }, ...shakeBell(HB(2), 0.25, 5, 0.1, -5), { src: GHOST(3), from: 0.4, to: 3.2, rate: 1.5, norm: 0, gain: -11, highpass: 250, fadeIn: 0.6, fadeOut: 1.0 }, { src: SWO(3), rate: 0.6, norm: 0, gain: -12, lowpass: 1800 }] },
  // 摇铃（bossMove bell）：一只手铃按铃舌来回撞的节奏叠六下（一下比一下轻、音高轻轻错开），末了一只大些的铃长长地响，底下压一声很轻的锣
  { out: 'sfx/yao.bell.m4a', maxLen: 2.0, fadeOut: 1.0, layers: [...shakeBell(HB(2), 0, 6, 0.09), { src: HB(1), at: 0.52, to: 2.2, norm: 0, gain: -6 }, { src: SLEIGH('sleighbell2_hit_2'), at: 0.02, norm: 0, gain: -18, highpass: 2500 }, { src: GONG_P, to: 2.2, norm: 0, gain: -14, lowpass: 900 }] },
  // 插幡（bossMove banners）：几面幡同时抖开（布声）、一道低的破风，末了轻轻一声锣
  { out: 'sfx/yao.banners.m4a', maxLen: 1.3, fadeOut: 0.6, layers: [{ src: KR('cloth1'), norm: 0 }, { src: KR('cloth3'), at: 0.12, norm: 0, gain: -2 }, { src: RP('inventory/cloth-heavy'), at: 0.05, norm: 0, gain: -3 }, { src: SWO(13), rate: 0.75, norm: 0, gain: -6, lowpass: 2400 }, { src: GONG_LIGHT, at: 0.2, to: 1.3, norm: 0, gain: -12 }] },
  // 一面幡插进地里（yaoFlag）：闷的一下（木头杵地）、幡布一抖
  { out: 'sfx/yao.flag.m4a', maxLen: 0.5, fadeOut: 0.25, layers: [{ src: KI('impactWood_heavy_002'), norm: 0, lowpass: 2500 }, { src: KR('cloth4'), at: 0.03, norm: 0, gain: -8 }, { src: RB('rock_hit_01'), norm: 0, gain: -14 }] },
  // 草人（bossMove straw）：干草窸窣、细枝折断，底下一缕压低的鬼声
  { out: 'sfx/yao.straw.m4a', maxLen: 1.1, fadeOut: 0.5, layers: [{ src: TS('cloth-pouch-shake-01'), norm: 0 }, { src: TS('wood-twigs-break-01'), at: 0.08, norm: 0, gain: -5 }, { src: TS('wood-twigs-break-02'), at: 0.3, norm: 0, gain: -8 }, { src: RP('NPC/shade/shade11'), at: 0.1, rate: 0.7, norm: 0, gain: -10, lowpass: 2500 }] },
  // 起阵（bossMove formations）：擦出来的镲长音由弱到强、锣边刮一下、低鼓滚一阵
  { out: 'sfx/yao.formations.m4a', keepLead: true, maxLen: 1.9, fadeOut: 0.7, layers: [{ src: BOWCYM(7), to: 2.2, norm: 0, fadeIn: 0.5 }, { src: GONG_SCRAPE, to: 1.9, norm: 0, gain: -5 }, { src: MB('Bass Drum 2/bassdrum_roll_mf.wav'), to: 1.9, norm: 0, gain: -9, fadeIn: 0.4 }] },
  // 聚魂（yaoCast burst，要炸开了）：倒放的鬼声往上收、酒杯擦出来的长音渐强
  { out: 'sfx/yao.burst.warn.m4a', keepLead: true, maxLen: 1.3, fadeOut: 0.12, layers: [{ src: RP('NPC/shade/shade7'), reverse: true, norm: 0, gain: -2 }, { src: FG('Sustains/Slow/glass3_A#4_Slow_1_Main'), from: 3, to: 4.3, norm: 0, gain: -6, fadeIn: 0.9 }, { src: BOWCYM(13), from: 2.5, to: 3.8, norm: 0, gain: -10, fadeIn: 0.8 }] },
  // 魂爆（yaoStrike burst）：闷的爆响 + 阴法术 + 一声尖的鬼叫往四面散开
  { out: 'sfx/yao.burst.m4a', maxLen: 1.4, fadeOut: 0.6, layers: [{ src: DARK(3), norm: 0 }, { src: KS('lowFrequency_explosion_000'), norm: 0, gain: -5 }, { src: RP('NPC/shade/shade6'), at: 0.03, norm: 0, gain: -7 }, { src: SWO(3), rate: 0.7, norm: 0, gain: -9, lowpass: 2500 }] },
  // 魂波（yaoStrike wave）：一声铃荡开（压掉刺耳的高频），底下一阵低的破风和一点鬼声
  { out: 'sfx/yao.wave.m4a', maxLen: 1.2, fadeOut: 0.6, layers: [{ src: HB(1), to: 1.3, norm: 0, lowpass: 2800 }, { src: SWO(24), rate: 0.8, norm: 0, gain: -8, lowpass: 2500 }, { src: RP('NPC/shade/shade2'), rate: 0.8, norm: 0, gain: -15 }] },
  // 魂线（yaoStrike line）：一道细的「咻」沿线过去，带一点玻璃似的余音
  { out: 'sfx/yao.line.m4a', maxLen: 0.7, fadeOut: 0.35, layers: [{ src: TELE, norm: 0, gain: -2, highpass: 300 }, { src: FG('Releases/Slow/glass1_D#4_Slow_1_Decay'), norm: 0, gain: -10 }, { src: SWI(5), rate: 1.2, norm: 0, gain: -10, highpass: 400 }] },
  // 魂线断（yaoLineBreak）：玻璃似的脆响、铃声往上一挑
  { out: 'sfx/yao.linebreak.m4a', maxLen: 0.8, fadeOut: 0.4, layers: [{ src: KI('impactGlass_light_001'), norm: 0 }, { src: HB(2), rate: 1.3, norm: 0, gain: -8 }, { src: RP('NPC/shade/shade14'), rate: 1.2, norm: 0, gain: -16 }] },
  // 拜魂（yaoCurse）：草人烧掉（噼啪的火）、一声鬼叫扑过来
  { out: 'sfx/yao.curse.m4a', maxLen: 1.2, fadeOut: 0.5, layers: [{ src: RP('NPC/shade/shade9'), norm: 0 }, { src: CRACKLE, from: 0.6, to: 1.5, norm: 0, gain: -5, fadeIn: 0.05 }, { src: FLAME, norm: 0, gain: -8 }, { src: SWO(12), norm: 0, gain: -9 }] },
  // 定魂（yaoRoot）：一串链子一收、一声低的鬼哼
  { out: 'sfx/yao.root.m4a', maxLen: 0.9, fadeOut: 0.4, layers: [{ src: R1('chain_01'), norm: 0, lowpass: 7000 }, { src: R1('chain_02'), at: 0.16, norm: 0, gain: -6, lowpass: 7000 }, { src: GHOST(5), from: 0.2, to: 1.1, rate: 1.6, norm: 0, gain: -10, highpass: 200, fadeIn: 0.1 }, { src: KR('clothBelt'), norm: 0, gain: -10 }] },
  // 隐进雾里（yaoMist vanish）：倒放的破风往里一收、阴法术
  { out: 'sfx/yao.vanish.m4a', keepLead: true, maxLen: 1.1, fadeOut: 0.4, layers: [{ src: SWO(24), reverse: true, norm: 0 }, { src: DARK(1), to: 1.1, norm: 0, gain: -6 }, { src: RUMBLE, from: 1, to: 2.1, norm: 0, gain: -14, fadeIn: 0.2 }] },
  // 从雾里显形（yaoMist appear）：一声轻铃、一缕破风
  { out: 'sfx/yao.appear.m4a', maxLen: 1.0, fadeOut: 0.5, layers: [{ src: HB(3), to: 1.1, norm: 0 }, { src: SWO(24), norm: 0, gain: -8, highpass: 300 }] },
  // 换阶段（bossPhase）：大锣、铃乱摇、一声长的鬼哭
  { out: 'sfx/yao.phase.m4a', maxLen: 3.0, fadeOut: 1.6, layers: [{ src: GONG_BIG, to: 3.2, norm: 0 }, ...shakeBell(HB(2), 0.05, 7, 0.07, -4), { src: RP('NPC/shade/shade8'), at: 0.1, rate: 0.85, norm: 0, gain: -6 }, { src: GHOST(4), from: 0.3, to: 2.6, norm: 0, gain: -9, fadeIn: 0.3, fadeOut: 0.8 }] },

  // ---------- 第二章：地形「十阵轮转」----------
  // 阵要亮了（siteWarn）：阵旗猎猎（布声两下）、低鼓由弱到强地滚
  { out: 'sfx/ten.warn.m4a', keepLead: true, maxLen: 1.6, fadeOut: 0.3, layers: [{ src: KR('cloth2'), norm: 0, gain: -2 }, { src: KR('cloth4'), at: 0.35, norm: 0, gain: -4 }, { src: MB('Bass Drum 2/bassdrum_roll_mf.wav'), to: 1.6, norm: 0, gain: -4, fadeIn: 0.9 }, { src: CRESC('1.5s'), to: 1.5, norm: 0, gain: -12 }] },
  // 天绝阵亮起（siteOn thunder）：阵纹里电光噼啪、低低的电嗡
  { out: 'sfx/ten.thunder.on.m4a', maxLen: 1.2, fadeOut: 0.5, layers: [{ src: EL('crackleelectricityloop'), to: 1.3, norm: 0, fadeIn: 0.15, highpass: 300 }, { src: EL('chargestart'), from: 0.5, to: 1.7, norm: 0, gain: -8, lowpass: 3000 }] },
  // 天雷要落（boltWarn）：电光往上聚（压得很轻：落雷一阵接一阵）
  { out: 'sfx/ten.bolt.warn.m4a', keepLead: true, maxLen: 0.8, fadeOut: 0.12, layers: [{ src: EL('charge'), from: 2.9, to: 3.7, norm: 0, fadeIn: 0.3 }, { src: TS('paralyzer-discharge-02'), to: 0.6, norm: 0, gain: -12, highpass: 900, fadeIn: 0.3 }] },
  // 天雷落下（bolt）：从天上劈下来的一声炸雷，比雷公鞭重、尾巴长，底下一记闷的低音
  { out: 'sfx/ten.bolt.m4a', maxLen: 1.7, fadeOut: 0.8, layers: [{ src: R3('thunder_01'), from: 0.66, to: 2.4, norm: 0, fadeIn: 0.01 }, { src: EL('hit'), to: 0.35, norm: 0, gain: -8, fadeOut: 0.15 }, { src: KS('lowFrequency_explosion_000'), norm: 0, gain: -6 }] },
  // 红水阵涨起（siteOn water）：一片水声涌上来、底下咕嘟冒泡
  { out: 'sfx/ten.water.m4a', maxLen: 1.7, fadeOut: 0.7, layers: [{ src: OCEAN(2), from: 2.5, to: 4.4, norm: 0, fadeIn: 0.4 }, { src: RW('loop_bubbles_1'), to: 1.7, norm: 0, gain: -8, fadeIn: 0.3, lowpass: 2500 }, { src: RW('splash_05'), at: 0.15, norm: 0, gain: -12, lowpass: 4000 }] },
  // 金光阵亮起（siteOn gold）：一串往上走的风铃、铃树和一声清的手铃
  { out: 'sfx/ten.gold.m4a', maxLen: 1.9, fadeOut: 0.9, layers: [{ src: WIND('asc1'), to: 2.0, norm: 0, gain: -2 }, { src: BELLTREE(4), at: 0.1, to: 2.0, norm: 0, gain: -6 }, { src: CHIME('C5'), at: 0.35, to: 2.0, norm: 0, gain: -10 }] },
  // 金光阵边冒兵（siteSpawn）：一蓬土、碎石落下
  { out: 'sfx/ten.spawn.m4a', maxLen: 0.6, fadeOut: 0.3, layers: [{ src: RB('rock_falling_02'), norm: 0, lowpass: 5000 }, { src: KI('impactSoft_medium_002'), norm: 0, gain: -5 }, { src: R3('stones_02'), at: 0.05, norm: 0, gain: -10 }] },

  // ---------- 第二章：三种敌人 ----------
  // 风吼妖蓄风（windWarn）：风往里收（倒放的风声）
  { out: 'sfx/wind.warn.m4a', keepLead: true, maxLen: 0.9, fadeOut: 0.1, layers: [{ src: R3('air_01'), from: 0.2, to: 1.1, reverse: true, norm: 0, lowpass: 2500 }, { src: SWO(30), reverse: true, norm: 0, gain: -8, lowpass: 3000 }] },
  // 风吼妖冲出去（windDash）：一阵呼啸的风、竹竿破风
  { out: 'sfx/wind.dash.m4a', maxLen: 0.9, fadeOut: 0.45, layers: [{ src: R3('air_02'), norm: 0, lowpass: 6000 }, { src: SWO(3), rate: 0.8, norm: 0, gain: -4, lowpass: 3000 }, { src: AIR, from: 4.0, to: 4.9, norm: 0, gain: -10, fadeIn: 0.05 }] },
  // 红沙傀儡碎开（sandBurst）：碎石崩开、沙土泼一地
  { out: 'sfx/sand.burst.m4a', maxLen: 0.9, fadeOut: 0.45, layers: [{ src: RB('rock_breaking_02'), norm: 0 }, { src: R3('stones_01'), at: 0.04, norm: 0, gain: -5 }, { src: TS('soil-steps-01'), at: 0.06, norm: 0, gain: -9 }, { src: KI('impactSoft_heavy_002'), norm: 0, gain: -8, lowpass: 1500 }] },

  // ---------- 第三章：地形「四剑轮斩」（剑台上的四把剑）----------
  // 出鞘（swordWarn）：拔剑出鞘、剑身一声轻鸣（三种拔剑轮着用）
  ...(['sword-unsheathe', 'sword-unsheathe3', 'sword-unsheathe4'] as const).map((f, i): Recipe => ({ out: `sfx/sword.warn.${i + 1}.m4a`, maxLen: 0.8, fadeOut: 0.4, layers: [{ src: RP(`battle/${f}`), norm: 0, lowpass: 3500 }, { src: RP('inventory/metal-ringing'), lowpass: 1800, at: 0.06, norm: 0, gain: -7, rate: 0.7 * [1, 1.06, 0.95][i] }] })),
  // 剑气沿直线飞过去（swordCut line）：一道快的刃风、尾上一点剑鸣
  ...([3, 2] as const).map((n, i): Recipe => ({ out: `sfx/sword.cut.${i + 1}.m4a`, maxLen: 0.7, fadeOut: 0.35, layers: [{ src: SWORD(n), norm: 0, lowpass: 2000 }, { src: SWI(i + 1), norm: 0, gain: -4, lowpass: 2500 }, { src: RP('inventory/metal-ringing'), lowpass: 1800, at: 0.08, rate: 0.84, norm: 0, gain: -13 }] })),
  // 剑光扫过扇面（swordCut fan）：更沉的一道破风、刃声拖得长
  { out: 'sfx/sword.sweep.m4a', maxLen: 0.95, fadeOut: 0.45, layers: [{ src: SWO(3), rate: 0.8, norm: 0, lowpass: 3500 }, { src: SWORD(9), norm: 0, gain: -3, lowpass: 2000 }, { src: KI('impactMetal_light_003'), at: 0.05, norm: 0, gain: -11 }] },
  // 四剑归阵（zxAltars）：四把剑先后出鞘、一齐低鸣，底下一口低的钟
  { out: 'sfx/sword.altars.m4a', maxLen: 1.6, fadeOut: 0.8, layers: [{ src: RP('battle/sword-unsheathe'), norm: 0 }, { src: RP('battle/sword-unsheathe3'), at: 0.09, norm: 0, gain: -2 }, { src: RP('battle/sword-unsheathe4'), at: 0.19, norm: 0, gain: -3 }, { src: RP('battle/sword-unsheathe2'), at: 0.27, norm: 0, gain: -4 }, { src: BOWCYM(13), from: 2.2, to: 3.8, norm: 0, gain: -9, fadeIn: 0.3 }, { src: TUBE('G#3_ff_rr1'), at: 0.3, to: 1.4, norm: 0, gain: -12, lowpass: 3000 }] },

  // ---------- 第三章：三种敌人（飞剑灵最多九只、两秒一射，都压低）----------
  // 飞剑灵瞄准（flyAim）：剑身发颤的细鸣（擦出来的镲长音，只留高的那部分）
  { out: 'sfx/fly.aim.m4a', keepLead: true, maxLen: 0.75, fadeOut: 0.12, layers: [{ src: BOWCYM(7), from: 1.0, to: 1.8, norm: 0, highpass: 1800, fadeIn: 0.25 }, { src: MW('metal_spring_01'), at: 0.05, norm: 0, gain: -12, highpass: 1500 }] },
  // 飞剑灵射出（flyShot）：一道很快的细刃风
  ...([2, 6] as const).map((n, i): Recipe => ({ out: `sfx/fly.shot.${i + 1}.m4a`, maxLen: 0.45, fadeOut: 0.22, layers: [{ src: SWI(n), rate: 1.3, norm: 0, highpass: 400 }, { src: SWORD([6, 4][i]), norm: 0, gain: -5, lowpass: 8000 }] })),
  // 截教门徒聚气（qiCast）：一点法术的光、倒放的风往里收
  { out: 'sfx/qi.cast.m4a', keepLead: true, maxLen: 0.6, fadeOut: 0.12, layers: [{ src: MAGIC('magical_2'), to: 0.6, norm: 0, gain: -2, fadeIn: 0.15 }, { src: SWI(8), reverse: true, norm: 0, gain: -8, highpass: 300 }] },
  // 截教门徒掷出剑气（qiThrow）：月牙似的刃风，带一点剑鸣
  { out: 'sfx/qi.throw.m4a', maxLen: 0.55, fadeOut: 0.28, layers: [{ src: SWI(4), norm: 0 }, { src: RP('inventory/metal-ringing'), lowpass: 1800, rate: 0.98, norm: 0, gain: -12 }, { src: MAGIC('magical_3'), to: 0.4, norm: 0, gain: -12, fadeOut: 0.2 }] },
  // 阵图傀儡连上剑气线（tetherOn）：一下很轻的「叮」
  { out: 'sfx/tether.on.m4a', maxLen: 0.5, fadeOut: 0.3, layers: [{ src: KI('impactMetal_light_001'), rate: 1.25, norm: 0 }, { src: FG('Releases/Slow/glass1_D#4_Slow_1_Decay'), norm: 0, gain: -10, rate: 1.5 }] },
  // 剑气线断（tetherCut）：弹簧似的一崩、碎玻璃似的脆
  { out: 'sfx/tether.cut.m4a', maxLen: 0.55, fadeOut: 0.28, layers: [{ src: MW('metal_spring_02'), norm: 0 }, { src: KI('impactGlass_light_003'), norm: 0, gain: -5 }, { src: RP('inventory/metal-small1'), norm: 0, gain: -8 }] },

  // ---------- 第三章：首领诛仙剑灵（最终战：剑鸣、刃风、钟）----------
  // 入场：剑光往一点聚拢（倒放的刮刃声往上收）、一声钟、一声大锣
  { out: 'sfx/zx.intro.m4a', maxLen: 3.6, fadeOut: 2.0, layers: [{ src: TS('metal-knife-scrape-01'), to: 1.3, reverse: true, norm: 0, gain: -3, lowpass: 8000 }, { src: GONG_BIG, at: 1.0, to: 4.4, norm: 0 }, { src: TUBE('G#3_ff_rr1'), at: 1.0, to: 4.4, norm: 0, gain: -5 }, { src: BOWCYM(13), from: 1.5, to: 4.0, at: 0.2, norm: 0, gain: -10, fadeIn: 0.6 }] },
  // 四剑环斩要来了（bossMove ring）：剑绕着身子转起来——三道越来越快的破风、两声剑鸣
  { out: 'sfx/zx.ring.warn.m4a', maxLen: 1.0, fadeOut: 0.3, layers: [{ src: SWO(20), rate: 1.1, norm: 0, gain: -2, lowpass: 5000 }, { src: SWO(21), at: 0.22, rate: 1.2, norm: 0, gain: -2, lowpass: 5000 }, { src: SWO(22), at: 0.4, rate: 1.3, norm: 0, lowpass: 5000 }, { src: RP('inventory/metal-ringing'), lowpass: 1800, rate: 0.7, at: 0.1, norm: 0, gain: -9 }, { src: RP('inventory/metal-ringing'), lowpass: 1800, at: 0.5, rate: 0.784, norm: 0, gain: -9 }] },
  // 剑雨要落（bossMove rain）：剑往天上升——倒放的剑鸣往上走、一串细的风铃
  { out: 'sfx/zx.rain.warn.m4a', keepLead: true, maxLen: 1.2, fadeOut: 0.2, layers: [{ src: TS('sword-clash-01'), to: 1.0, reverse: true, norm: 0, gain: -2, lowpass: 2000 }, { src: WIND('asc1'), to: 1.2, norm: 0, gain: -12 }, { src: RP('battle/sword-unsheathe5'), at: 0.85, norm: 0, gain: -6, lowpass: 3500 }] },
  // 一剑化四（bossMove split）：身子一晃分出三个剑影——擦镲的长音、一道「咻」、往下走的风铃
  { out: 'sfx/zx.split.m4a', maxLen: 1.4, fadeOut: 0.7, layers: [{ src: TELE, norm: 0, gain: -2, highpass: 250 }, { src: BOWCYM(13), from: 2.5, to: 3.9, norm: 0, gain: -7, fadeIn: 0.1 }, { src: WIND('desc1'), to: 1.4, norm: 0, gain: -9 }, { src: RP('inventory/metal-ringing'), lowpass: 1800, at: 0.12, norm: 0, gain: -10, rate: 0.63 }] },
  // 四剑归阵（bossMove walls）：两道剑气墙立起来——低的金属长鸣（擦刹车鼓、擦镲）、锣边刮一下
  { out: 'sfx/zx.walls.m4a', keepLead: true, maxLen: 1.6, fadeOut: 0.6, layers: [{ src: ID('Brake Drum/BrakeDrum1_Bowed_rr2_Mid.wav'), from: 2.0, to: 3.6, norm: 0, gain: -3, fadeIn: 0.3 }, { src: BOWCYM(7), from: 1.0, to: 2.6, norm: 0, gain: -6, lowpass: 3500, fadeIn: 0.3 }, { src: GONG_SCRAPE, to: 1.6, norm: 0, gain: -8 }] },
  // 连续突进要来了（bossMove rush）：剑刃一路刮过去的声音由弱到强、低鼓滚
  { out: 'sfx/zx.rush.warn.m4a', keepLead: true, maxLen: 1.2, fadeOut: 0.12, layers: [{ src: TS('metal-knife-scrape-02'), to: 1.2, norm: 0, gain: -3, fadeIn: 0.5, lowpass: 7000 }, { src: CRESC('1.5s'), to: 1.2, norm: 0, gain: -6 }, { src: MB('Bass Drum 2/bassdrum_roll_mf.wav'), to: 1.2, norm: 0, gain: -10, fadeIn: 0.4 }] },
  // 每一冲之前（zxCast dash）：短的一道刮刃，往上收
  { out: 'sfx/zx.dash.warn.m4a', keepLead: true, maxLen: 0.55, fadeOut: 0.1, layers: [{ src: TS('metal-knife-scrape-03'), to: 0.55, norm: 0, fadeIn: 0.3, lowpass: 7000 }, { src: SWI(9), reverse: true, norm: 0, gain: -8 }] },
  // 环斩一剑（zxStrike arc）：沉的破风 + 刃声 + 一点剑鸣
  ...([1, 8] as const).map((n, i): Recipe => ({ out: `sfx/zx.arc.${i + 1}.m4a`, maxLen: 0.8, fadeOut: 0.4, layers: [{ src: SWO([3, 28][i]), rate: 0.85, norm: 0, lowpass: 4000 }, { src: SWORD(n), norm: 0, gain: -3, lowpass: 3500 }, { src: RP('inventory/metal-ringing'), lowpass: 1800, at: 0.06, norm: 0, gain: -11, rate: 0.7 * [1, 0.92][i] }] })),
  // 剑气直线（zxStrike lane，剑影放的）：快的刃风、一点金属的「叮」
  { out: 'sfx/zx.lane.m4a', maxLen: 0.7, fadeOut: 0.35, layers: [{ src: SWI(3), rate: 0.95, norm: 0 }, { src: SWORD(10), norm: 0, gain: -4, lowpass: 7000 }, { src: KI('impactMetal_light_002'), at: 0.04, norm: 0, gain: -13 }] },
  // 突进（zxStrike dash）：一道重的破风、刃风、金属一撞
  { out: 'sfx/zx.dash.m4a', maxLen: 0.95, fadeOut: 0.45, layers: [{ src: MEL('melee sound'), rate: 0.9, norm: 0, lowpass: 4000 }, { src: SWORD(5), norm: 0, gain: -4, lowpass: 6500 }, { src: KI('impactMetal_heavy_002'), at: 0.05, norm: 0, gain: -7 }, { src: SWO(3), rate: 0.7, norm: 0, gain: -7, lowpass: 2500 }] },
  // 剑气墙扫过（zxStrike wall）：很沉的破风、剑相击、一声轻锣
  { out: 'sfx/zx.wall.m4a', maxLen: 1.1, fadeOut: 0.5, layers: [{ src: SWO(3), rate: 0.7, norm: 0, lowpass: 3000 }, { src: CLASH(5), norm: 0, gain: -5, lowpass: 6000 }, { src: KI('impactPlate_heavy_002'), norm: 0, gain: -6 }, { src: GONG_LIGHT, to: 1.1, norm: 0, gain: -12 }] },
  // 剑雨里一柄剑插进地里（cellImpact）：一下扎进土里、剑身轻颤
  ...([0, 2] as const).map((n, i): Recipe => ({ out: `sfx/zx.cell.${i + 1}.m4a`, maxLen: 0.5, fadeOut: 0.28, layers: [{ src: KI(`impactMining_00${n}`), norm: 0, lowpass: 3000 }, { src: RP('inventory/metal-ringing'), lowpass: 1800, at: 0.02, rate: 0.7 * [1.1, 0.96][i], norm: 0, gain: -9 }, { src: RB('rock_hit_01'), norm: 0, gain: -12 }] })),
  // 诛仙剑阵要收一圈（zxCloseWarn）：擦镲的长音由弱到强、锣边刮
  { out: 'sfx/zx.close.warn.m4a', keepLead: true, maxLen: 1.2, fadeOut: 0.15, layers: [{ src: BOWCYM(13), from: 2.0, to: 3.2, norm: 0, fadeIn: 0.8 }, { src: GONG_SCRAPE, to: 1.2, norm: 0, gain: -8, fadeIn: 0.4 }] },
  // 收一圈（zxClose）：一圈剑同时落下——沉的金属一砸、锣、大鼓、几声剑鸣
  { out: 'sfx/zx.close.m4a', maxLen: 1.4, fadeOut: 0.7, layers: [{ src: KI('impactPlate_heavy_000'), norm: 0 }, { src: GONG_LIGHT, to: 1.4, norm: 0, gain: -6 }, { src: DRUM_FF, to: 1.4, norm: 0, gain: -5 }, { src: RP('inventory/metal-ringing'), lowpass: 1800, rate: 0.7, at: 0.03, norm: 0, gain: -9 }, { src: RP('inventory/metal-ringing'), lowpass: 1800, at: 0.07, rate: 0.805, norm: 0, gain: -11 }] },
  // 换阶段（bossPhase）：剑光迸开——大锣、四声剑鸣、镲心一敲、一口钟
  { out: 'sfx/zx.phase.m4a', maxLen: 3.0, fadeOut: 1.6, layers: [{ src: GONG_BIG, to: 3.2, norm: 0 }, { src: ID('Suspended Cymbal 1/susCymb1_hit_bell_fff1.wav'), to: 2.6, norm: 0, gain: -6 }, { src: TUBE('G#3_ff_rr1'), to: 3.2, norm: 0, gain: -7 }, { src: RP('battle/sword-unsheathe'), norm: 0, gain: -4 }, { src: RP('battle/sword-unsheathe3'), at: 0.07, norm: 0, gain: -5 }, { src: RP('inventory/metal-ringing'), lowpass: 1800, rate: 0.7, at: 0.12, norm: 0, gain: -7 }, { src: RP('inventory/metal-ringing'), lowpass: 1800, at: 0.2, rate: 0.833, norm: 0, gain: -8 }] },

  // ---------- 后加的 8 件法宝（fx-new.ts）：原来借着前 8 件的声音，现在各有各的 ----------
  // 打神鞭：从天落下（细的高破风）、抽中（硬木一声脆响 + 一点雷的余韵）、仙品落点的震波（闷的低音、地面一震）
  { out: 'sfx/dashen.fall.m4a', maxLen: 0.6, fadeOut: 0.3, layers: [{ src: SWO(24), rate: 1.35, norm: 0, highpass: 700 }, { src: SWO(25), at: 0.1, rate: 1.25, norm: 0, gain: -3, highpass: 600 }] },
  ...([2, 4] as const).map((n, i): Recipe => ({ out: `sfx/dashen.lash.${i + 1}.m4a`, maxLen: 0.75, fadeOut: 0.4, layers: [{ src: KI(`impactPlank_medium_00${n}`), norm: 0 }, { src: RF(['bang_05', 'shot_02'][i]), norm: 0, gain: -6, lowpass: 5000 }, { src: R3('thunder_01'), from: 0.8, to: 1.4, norm: 0, gain: -10, lowpass: 1400, fadeIn: 0.01 }] })),
  { out: 'sfx/dashen.shock.m4a', maxLen: 1.0, fadeOut: 0.5, layers: [{ src: KS('lowFrequency_explosion_001'), norm: 0 }, { src: QUAKE, to: 1.0, norm: 0, gain: -6, lowpass: 900 }, { src: DRUM_F, to: 1.0, norm: 0, gain: -6 }] },
  // 化血神刀：血光斩（湿的刃声）、血雾（低的嘶声）、噬魂回血（倒放的鬼声往回收、一声暖的铃）
  ...([1, 7] as const).map((n, i): Recipe => ({ out: `sfx/huaxue.slash.${i + 1}.m4a`, maxLen: 0.5, fadeOut: 0.25, layers: [{ src: SWORD(n), norm: 0, lowpass: 6000 }, { src: RW(['slime_02', 'slime_05'][i]), norm: 0, gain: -6, lowpass: 3500 }, { src: SWI(i + 6), norm: 0, gain: -8 }] })),
  { out: 'sfx/huaxue.mist.m4a', maxLen: 0.8, fadeOut: 0.4, layers: [{ src: TS('compressed-air-spray-02'), from: 0.2, to: 1.0, norm: 0, lowpass: 2500, fadeIn: 0.1 }, { src: RW('bubble_02'), norm: 0, gain: -10 }] },
  { out: 'sfx/huaxue.drain.m4a', maxLen: 0.9, fadeOut: 0.45, layers: [{ src: RP('NPC/shade/shade3'), reverse: true, norm: 0, gain: -4, lowpass: 3500 }, { src: CHIME('G#4'), at: 0.3, to: 0.9, norm: 0, gain: -6 }] },
  // 定风珠：起旋风（转着的风，持续时隔一阵响一次）、吹散 / 定海（一阵猛风）、风雷（风里一道雷）
  { out: 'sfx/dingfeng.whirl.m4a', maxLen: 1.2, fadeOut: 0.5, layers: [{ src: AIR, from: 1.0, to: 2.3, norm: 0, fadeIn: 0.2, highpass: 200 }, { src: SWO(24), rate: 1.2, norm: 0, gain: -8, highpass: 300 }] },
  { out: 'sfx/dingfeng.gust.m4a', maxLen: 0.75, fadeOut: 0.35, layers: [{ src: R3('air_02'), norm: 0, lowpass: 7000 }, { src: SWO(31), rate: 1.2, norm: 0, gain: -6 }] },
  { out: 'sfx/dingfeng.thunder.m4a', maxLen: 0.95, fadeOut: 0.45, layers: [{ src: EL('hit'), to: 0.5, norm: 0, fadeOut: 0.2 }, { src: R3('thunder_01'), from: 0.75, to: 1.7, norm: 0, gain: -6, lowpass: 2000, fadeIn: 0.005 }, { src: R3('air_03'), norm: 0, gain: -10 }] },
  // 青莲宝色旗：结界展开（筝上滑、铃树、旗面一展）、荆棘刺（细枝一折、木头一扎）、结界回血（一声轻的手铃）
  { out: 'sfx/qinglian.bloom.m4a', maxLen: 1.5, fadeOut: 0.7, layers: [{ src: ZH('Gliss/Gliss_Up_Med_mf_1'), from: 0.1, to: 1.6, norm: 0 }, { src: BELLTREE(4), at: 0.15, to: 1.5, norm: 0, gain: -7 }, { src: KR('cloth2'), norm: 0, gain: -9 }] },
  { out: 'sfx/qinglian.thorn.m4a', maxLen: 0.3, fadeOut: 0.15, layers: [{ src: TS('wood-twigs-break-02'), norm: 0, lowpass: 7000 }, { src: KI('impactWood_light_002'), norm: 0, gain: -5 }] },
  { out: 'sfx/qinglian.heal.m4a', maxLen: 1.1, fadeOut: 0.55, layers: [{ src: CHIME('C5'), to: 1.2, norm: 0 }, { src: WIND('asc1'), from: 0.3, to: 1.4, norm: 0, gain: -12 }] },
  // 阴阳镜：光束扫出（镜面擦出来的亮音）、两道照到冻住（冻住的冰响、玻璃似的余音）
  { out: 'sfx/yinyang.beam.m4a', maxLen: 0.8, fadeOut: 0.35, layers: [{ src: BOWCYM(7), from: 1.2, to: 2.0, norm: 0, highpass: 900, fadeIn: 0.05 }, { src: FG('Sustains/Slow/glass4_D5_Slow_2_Main'), from: 3, to: 3.8, norm: 0, gain: -8, fadeIn: 0.05 }, { src: SWI(5), norm: 0, gain: -10 }] },
  { out: 'sfx/yinyang.freeze.m4a', maxLen: 1.0, fadeOut: 0.5, layers: [{ src: ICESP('coldsnap'), to: 1.0, norm: 0 }, { src: FG('Releases/Slow/glass1_D#4_Slow_1_Decay'), norm: 0, gain: -6 }, { src: KI('impactGlass_medium_001'), norm: 0, gain: -10 }] },
  // 玄元控水旗：水柱涌起（一泼水、海浪鼓）、漩涡（转着的水声）、寒潭封冻（水一下子冻住）
  { out: 'sfx/xuanyuan.pool.m4a', maxLen: 1.0, fadeOut: 0.5, layers: [{ src: RW('splash_12'), norm: 0, lowpass: 6000 }, { src: OCEAN(3), from: 1.5, to: 2.6, norm: 0, gain: -5, fadeIn: 0.15 }, { src: RW('splash_09'), norm: 0, gain: -6 }] },
  { out: 'sfx/xuanyuan.vortex.m4a', maxLen: 1.3, fadeOut: 0.55, layers: [{ src: RW('loop_water_02'), from: 2.0, to: 3.4, norm: 0, fadeIn: 0.25, lowpass: 3500 }, { src: RW('loop_bubbles_02'), to: 1.3, norm: 0, gain: -9, fadeIn: 0.2 }, { src: SWO(24), rate: 0.8, norm: 0, gain: -12, lowpass: 2000 }] },
  { out: 'sfx/xuanyuan.freeze.m4a', maxLen: 1.1, fadeOut: 0.5, layers: [{ src: ICESP('ice'), norm: 0 }, { src: RW('splash_09'), norm: 0, gain: -6, lowpass: 2000 }, { src: FREEZE, from: 0.6, to: 1.6, norm: 0, gain: -8, fadeIn: 0.05 }] },
  // 五火七禽扇：扇出火浪（一扇的风 + 火呼地腾起）、七禽火鸟（扑翅似的布声 + 火苗）、焚风焦土（地上一片火燎）
  { out: 'sfx/wuhuo.fan.m4a', maxLen: 1.0, fadeOut: 0.45, layers: [{ src: SWO(31), rate: 0.9, norm: 0, gain: -2 }, { src: FS(12), at: 0.08, to: 1.1, norm: 0, fadeOut: 0.4 }, { src: FLAME, at: 0.05, norm: 0, gain: -8 }] },
  { out: 'sfx/wuhuo.bird.m4a', maxLen: 0.7, fadeOut: 0.35, layers: [{ src: KR('cloth3'), rate: 1.3, norm: 0 }, { src: KR('cloth4'), at: 0.12, rate: 1.4, norm: 0, gain: -3 }, { src: FS(16), to: 0.7, norm: 0, gain: -6, fadeOut: 0.3 }] },
  { out: 'sfx/wuhuo.scorch.m4a', maxLen: 0.9, fadeOut: 0.45, layers: [{ src: FLARE, to: 0.9, norm: 0 }, { src: CRACKLE, from: 0.3, to: 1.2, norm: 0, gain: -6 }, { src: FS(4), to: 0.9, norm: 0, gain: -9, lowpass: 2000 }] },
  // 捆仙绳：金绳射出（绳子破风、皮扣一响）、捆住（绳子一勒的吱声）、缚仙互撞（两个撞在一起的闷响）
  { out: 'sfx/kunxian.throw.m4a', maxLen: 0.45, fadeOut: 0.22, layers: [{ src: SWI(9), norm: 0 }, { src: KR('beltHandle1'), at: 0.02, norm: 0, gain: -8 }] },
  { out: 'sfx/kunxian.bind.m4a', maxLen: 0.65, fadeOut: 0.3, layers: [{ src: KR('creak1'), norm: 0, gain: -2 }, { src: KR('clothBelt2'), norm: 0, gain: -3 }, { src: KR('dropLeather'), norm: 0, gain: -10 }] },
  { out: 'sfx/kunxian.clash.m4a', maxLen: 0.5, fadeOut: 0.25, layers: [{ src: KI('impactPunch_heavy_003'), norm: 0, lowpass: 3500 }, { src: KI('impactWood_medium_003'), norm: 0, gain: -6 }, { src: RP('inventory/metal-small2'), norm: 0, gain: -14 }] },

  // ---------- 功法（technique-fx.ts）----------
  // 悟得一门（万宝阁里学会）：一声清的手铃、铃树、底下一口很轻的锣——和升级（筝的上滑音）分开
  { out: 'sfx/tech.learn.m4a', maxLen: 2.2, fadeOut: 1.1, layers: [{ src: CHIME('E5'), to: 2.4, norm: 0 }, { src: BELLTREE(6), at: 0.05, to: 2.2, norm: 0, gain: -6 }, { src: HB(1), at: 0.25, to: 2.2, norm: 0, gain: -10 }, { src: GONG_P, to: 2.4, norm: 0, gain: -14, lowpass: 800 }] },
  // 五雷正法聚云（0.6 秒后落雷）：云里的闷雷由弱到强
  { out: 'sfx/tech.thunder.warn.m4a', keepLead: true, maxLen: 0.65, fadeOut: 0.1, layers: [{ src: R3('thunder_01'), from: 1.7, to: 2.4, norm: 0, lowpass: 1200, fadeIn: 0.35 }, { src: EL('charge'), from: 3.0, to: 3.7, norm: 0, gain: -10, fadeIn: 0.3 }] },
  // 天雷落下（金色的雷）：炸雷、电火花、一点三角铁似的亮
  { out: 'sfx/tech.thunder.m4a', maxLen: 1.3, fadeOut: 0.6, layers: [{ src: R3('thunder_01'), from: 0.72, to: 1.9, norm: 0, fadeIn: 0.005 }, { src: EL('groundhit'), norm: 0, gain: -5 }, { src: TRI, norm: 0, gain: -14 }] },
  // 莲花化身（倒下时重生）：低锣托底、筝缓缓往上滑、两声手铃、风铃
  { out: 'sfx/tech.lotus.m4a', maxLen: 3.0, fadeOut: 1.4, layers: [{ src: GONG_MF, to: 3.2, norm: 0, gain: -4, lowpass: 1500 }, { src: ZH('Gliss/Gliss_Up_Swl_mf_1'), to: 2.8, norm: 0 }, { src: CHIME('C5'), at: 0.6, to: 3.0, norm: 0, gain: -6 }, { src: CHIME('G#4'), at: 0.9, to: 3.0, norm: 0, gain: -8 }, { src: WIND('asc1'), at: 0.3, to: 2.4, norm: 0, gain: -10 }] },
  // 金刚不坏（挨打时反弹）：金身一震——一口铃、金属的「当」
  { out: 'sfx/tech.reflect.m4a', maxLen: 0.8, fadeOut: 0.45, layers: [{ src: KI('impactBell_heavy_001'), norm: 0, lowpass: 5000 }, { src: KI('impactMetal_medium_002'), norm: 0, gain: -6 }, { src: HB(2), rate: 0.8, norm: 0, gain: -12 }] },
  // 寒冰诀冰碎：冻住的敌人碎成冰碴（比寒冰幡的冰棱碎得细）
  { out: 'sfx/tech.shatter.m4a', maxLen: 0.7, fadeOut: 0.35, layers: [{ src: ICE('LedasLuzta4'), norm: 0, highpass: 300 }, { src: RB('glass_breaking_03'), norm: 0, gain: -6 }, { src: KI('impactGlass_light_000'), norm: 0, gain: -9 }] },
  // 三昧真火传火：一串火苗「呼」地窜过去
  { out: 'sfx/tech.spread.m4a', maxLen: 0.6, fadeOut: 0.3, layers: [{ src: FS(9), to: 0.7, norm: 0, fadeOut: 0.3 }, { src: SWI(12), norm: 0, gain: -6 }, { src: FLARE, to: 0.5, norm: 0, gain: -12 }] },
  // 吐纳术（每波开始回气）：一口长长的吸气似的风、一声很轻的手铃
  { out: 'sfx/tech.breath.m4a', maxLen: 1.4, fadeOut: 0.7, layers: [{ src: R3('air_01'), from: 0.1, to: 1.4, norm: 0, lowpass: 3000, fadeIn: 0.4 }, { src: CHIME('E5'), at: 0.45, to: 1.4, norm: 0, gain: -8 }] },

  // ---------- 杨戬：三尖两刃刀、天眼、哮天犬 ----------
  // 横扫：长兵器抡开的一道沉破风、刃声（两种）
  ...([[3, 2], [28, 8]] as const).map(([w, n], i): Recipe => ({ out: `sfx/sanjian.sweep.${i + 1}.m4a`, maxLen: 0.7, fadeOut: 0.35, layers: [{ src: SWO(w), rate: 0.85, norm: 0, lowpass: 4000 }, { src: SWORD(n), norm: 0, gain: -5, lowpass: 6500 }, { src: KR('cloth1'), norm: 0, gain: -12 }] })),
  // 刺：短的一道破风、刃尖一点金属（两种）
  ...([10, 11] as const).map((w, i): Recipe => ({ out: `sfx/sanjian.stab.${i + 1}.m4a`, maxLen: 0.4, fadeOut: 0.2, layers: [{ src: SWI(w), norm: 0, gain: -1 }, { src: SWORD([4, 6][i]), norm: 0, gain: -6, lowpass: 7000 }, { src: KI('impactMetal_light_000'), at: 0.04, norm: 0, gain: -12 }] })),
  // 劈山：刀从上往下的重破风、砸进地里（大鼓 + 碎石）
  { out: 'sfx/sanjian.chop.m4a', maxLen: 1.1, fadeOut: 0.5, layers: [{ src: SWO(3), rate: 0.7, norm: 0, gain: -2, lowpass: 3000 }, { src: DRUM_FF, at: 0.12, to: 1.2, norm: 0 }, { src: KI('impactMining_003'), at: 0.12, norm: 0, gain: -4 }, { src: RB('rock_falling_04'), at: 0.16, norm: 0, gain: -12 }] },
  // 地上裂开：岩石崩裂、地底一阵闷响（和地裂区域的声音分开：更长、更沉）
  { out: 'sfx/sanjian.rift.m4a', maxLen: 1.2, fadeOut: 0.55, layers: [{ src: RB('rock_breaking_03'), norm: 0 }, { src: QUAKE, to: 1.2, norm: 0, gain: -6, lowpass: 900 }, { src: EARTH, from: 0.2, to: 1.2, norm: 0, gain: -8 }] },
  // 天眼的金光：一道亮的长音扫过去（擦镲 + 手铃 + 酒杯的泛音）
  { out: 'sfx/tianyan.gaze.m4a', maxLen: 1.5, fadeOut: 0.7, layers: [{ src: BOWCYM(13), from: 2.4, to: 3.9, norm: 0, fadeIn: 0.12 }, { src: CHIME('F#5'), to: 1.5, norm: 0, gain: -6 }, { src: FG('Sustains/Slow/glass4_D5_Slow_2_Main'), from: 2, to: 3.5, norm: 0, gain: -10, fadeIn: 0.1 }, { src: SWI(5), norm: 0, gain: -10 }] },
  // 哮天犬冲出去：一声短吠、一道破风
  { out: 'sfx/xiaotian.dash.m4a', maxLen: 0.6, fadeOut: 0.3, layers: [{ src: RC('barking_01'), norm: 0 }, { src: SWO(12), rate: 1.1, norm: 0, gain: -6, highpass: 200 }] },
  // 咬一口：一下咬合、低吼
  { out: 'sfx/xiaotian.bite.m4a', maxLen: 0.5, fadeOut: 0.25, layers: [{ src: RP('NPC/beetle/bite-small2'), norm: 0, lowpass: 6000 }, { src: RP('NPC/misc/wolfman'), rate: 1.15, norm: 0, gain: -8 }, { src: KI('impactSoft_medium_003'), norm: 0, gain: -10 }] },
  // 进化：一声长嚎、筝往上滑、铃树
  { out: 'sfx/xiaotian.evolve.m4a', maxLen: 2.4, fadeOut: 1.1, layers: [{ src: RC('howl'), norm: 0 }, { src: ZH('Gliss/Gliss_Up_Med_ff_1'), at: 0.35, to: 2.4, norm: 0, gain: -4 }, { src: BELLTREE(1), at: 0.6, to: 2.4, norm: 0, gain: -8 }] },

  // ---------- 赵公明：定海珠、金鞭、黑虎（土行：石、金、虎）----------
  // 定海珠飞出：沉的珠子破风、珠串一碰
  { out: 'sfx/dinghai.throw.m4a', maxLen: 0.5, fadeOut: 0.25, layers: [{ src: SWO(17), rate: 0.8, norm: 0, lowpass: 3000 }, { src: RP('inventory/beads'), at: 0.02, norm: 0, gain: -8 }] },
  // 珠子砸地：石头一样的闷砸、碎石，珠子自己「笃」的一声（两种）
  ...([0, 4] as const).map((n, i): Recipe => ({ out: `sfx/dinghai.land.${i + 1}.m4a`, maxLen: 0.8, fadeOut: 0.4, layers: [{ src: KI(`impactMining_00${n}`), norm: 0, lowpass: 4000 }, { src: DRUM_F, to: 0.8, norm: 0, gain: -5 }, { src: R1(['item_stone_01', 'item_stone_03'][i]), norm: 0, gain: -6 }, { src: RB('rock_falling_06'), at: 0.03, norm: 0, gain: -14 }] })),
  // 石纹再震：地面一阵闷的震颤、石头崩开
  { out: 'sfx/dinghai.quake.m4a', maxLen: 1.0, fadeOut: 0.5, layers: [{ src: QUAKE, from: 0.2, to: 1.2, norm: 0, lowpass: 1200 }, { src: RB('rock_breaking_01'), at: 0.05, norm: 0, gain: -4 }, { src: MB('Bass Drum 1/BDrumNew_hit_v5_rr1_Sum.wav'), to: 1.0, norm: 0, gain: -6 }] },
  // 金鞭虚影扬起：一道往上走的亮（倒放的破风 + 风铃往上）
  { out: 'sfx/jinbian.raise.m4a', keepLead: true, maxLen: 0.8, fadeOut: 0.12, layers: [{ src: SWO(24), reverse: true, norm: 0, highpass: 300 }, { src: WIND('asc1'), to: 0.8, norm: 0, gain: -6 }, { src: TRI, at: 0.6, norm: 0, gain: -12 }] },
  // 金鞭拍下：沉的金属砸地、大鼓、一声轻锣
  { out: 'sfx/jinbian.strike.m4a', maxLen: 1.3, fadeOut: 0.6, layers: [{ src: KI('impactMetal_heavy_003'), norm: 0, lowpass: 5000 }, { src: DRUM_FF, to: 1.3, norm: 0, gain: -2 }, { src: KI('impactMining_001'), norm: 0, gain: -5 }, { src: GONG_LIGHT, to: 1.3, norm: 0, gain: -10 }] },
  // 金缝裂开：岩石崩开、缝里一串金色的铃
  { out: 'sfx/jinbian.crack.m4a', maxLen: 1.1, fadeOut: 0.5, layers: [{ src: RB('rock_breaking_02'), norm: 0 }, { src: EARTH, to: 1.0, norm: 0, gain: -6 }, { src: BELLTREE(3), at: 0.1, to: 1.1, norm: 0, gain: -10 }] },
  // 金元宝蹦出：钱币一响、钟琴一点
  { out: 'sfx/jinbian.ingot.m4a', maxLen: 0.5, fadeOut: 0.3, layers: [{ src: R1('item_coins_03'), norm: 0, gain: -2 }, { src: CHIME('C5'), to: 0.5, norm: 0, gain: -8 }] },
  // 黑虎扑出去：一声短的低吼、扑的破风
  { out: 'sfx/heihu.dash.m4a', maxLen: 0.6, fadeOut: 0.3, layers: [{ src: RP('NPC/gutteral beast/mnstr2'), rate: 0.9, norm: 0, gain: -2 }, { src: SWO(12), rate: 0.9, norm: 0, gain: -5 }] },
  // 黑虎吼一声（震慑）：低沉的大吼、喉咙里的粗声，底下一点更低的
  { out: 'sfx/heihu.roar.m4a', maxLen: 1.2, fadeOut: 0.5, layers: [{ src: RP('NPC/giant/giant2'), rate: 1.05, norm: 0 }, { src: RP('NPC/gutteral beast/mnstr7'), at: 0.04, rate: 0.9, norm: 0, gain: -6 }, { src: RC('roar_02'), norm: 0, gain: -9 }] },
  // 破财（被咬的多掉灵石）：一把钱撒出来
  { out: 'sfx/heihu.broke.m4a', maxLen: 0.8, fadeOut: 0.4, layers: [{ src: R1('item_coins_04'), to: 0.8, norm: 0 }, { src: CHIME('G#4'), at: 0.05, to: 0.7, norm: 0, gain: -10 }] },
  // 黑虎进化：一声长的大吼、锣、筝往上滑
  { out: 'sfx/heihu.evolve.m4a', maxLen: 2.4, fadeOut: 1.1, layers: [{ src: RP('NPC/giant/giant2'), rate: 0.95, norm: 0 }, { src: GONG_F, at: 0.2, to: 2.4, norm: 0, gain: -6 }, { src: ZH('Gliss/Gliss_Up_Med_ff_1'), at: 0.45, to: 2.4, norm: 0, gain: -6 }] },

  // ---------- 劫数（jie-pick.ts、jie-fx.ts）----------
  // 选定一劫入局：一口低的钟、很轻的锣、远处一阵闷雷（应劫）
  { out: 'sfx/jie.pick.m4a', maxLen: 3.0, fadeOut: 1.5, layers: [{ src: TUBE('E3_pp_rr1'), to: 3.2, norm: 0 }, { src: GONG_P, to: 3.2, norm: 0, gain: -8, lowpass: 900 }, { src: R3('thunder_01'), at: 0.4, from: 2.4, to: 4.2, norm: 0, gain: -12, lowpass: 600, fadeIn: 0.3 }] },
  // 首领狂暴（劫五的「狂暴」横幅）：两下沉的大鼓、锣边一刮、一声往下沉的不祥的响
  { out: 'sfx/jie.rage.m4a', maxLen: 2.4, fadeOut: 1.2, layers: [{ src: DRUM_FF, to: 1.6, norm: 0 }, { src: DRUM_FF, at: 0.28, to: 1.8, norm: 0, gain: -2, rate: 0.94 }, { src: GONG_SCRAPE, at: 0.1, to: 2.4, norm: 0, gain: -6 }, { src: BADCHEST, from: 0.2, to: 2.4, norm: 0, gain: -9, lowpass: 3000 }] },
  // 带「分裂」的精英裂开（劫五）：一声撕开似的鬼声、阴法术
  { out: 'sfx/jie.split.m4a', maxLen: 0.8, fadeOut: 0.4, layers: [{ src: RP('NPC/shade/shade12'), norm: 0, gain: -2 }, { src: DARK(2), to: 0.8, norm: 0, gain: -6 }, { src: SWO(13), rate: 0.9, norm: 0, gain: -9 }] },

  // ---------- 修为页（xiuwei.ts）----------
  // 点亮一节（盖印）：木印「笃」地按在纸上、纸一响、一声清的手铃
  { out: 'sfx/xiuwei.light.m4a', maxLen: 1.3, fadeOut: 0.65, layers: [{ src: KI('impactWood_medium_001'), norm: 0, lowpass: 3500 }, { src: R2('paper_01'), norm: 0, gain: -10 }, { src: CHIME('E5'), at: 0.06, to: 1.3, norm: 0, gain: -7 }, { src: HB(3), at: 0.08, to: 1.2, norm: 0, gain: -14 }] },
  // 重置（散功）：一张纸揭下来、风铃往下走
  { out: 'sfx/xiuwei.reset.m4a', maxLen: 1.5, fadeOut: 0.7, layers: [{ src: R2('paper_03'), norm: 0 }, { src: WIND('desc1'), at: 0.05, to: 1.5, norm: 0, gain: -5 }, { src: KI('impactSoft_medium_001'), norm: 0, gain: -12 }] },

  // ---------- 联机大厅（lobby.ts）----------
  // 有人进房：铃树上一颗铃、一串往上的风铃
  { out: 'sfx/lobby.join.m4a', maxLen: 1.1, fadeOut: 0.55, layers: [{ src: ID('Bell Tree/Individual/BellTree_Hit_C5_rr1_Mid.wav'), to: 1.2, norm: 0 }, { src: WIND('asc1'), from: 0.2, to: 1.2, norm: 0, gain: -10 }] },
  // 有人离开：风铃往下走、木鱼一声低的
  { out: 'sfx/lobby.leave.m4a', maxLen: 1.0, fadeOut: 0.5, layers: [{ src: WIND('desc1'), to: 1.0, norm: 0, gain: -3 }, { src: LOG('Lo'), at: 0.08, to: 0.4, norm: 0, gain: -6, fadeOut: 0.15 }] },
  // 准备：拍板两下、一声手铃
  { out: 'sfx/lobby.ready.m4a', maxLen: 1.0, fadeOut: 0.5, layers: [{ src: WOOD('wood_click_ff'), norm: 0 }, { src: WOOD('wood_click_mp'), at: 0.09, norm: 0, gain: -3 }, { src: HB(2), at: 0.12, to: 1.0, norm: 0, gain: -8 }] },
  // 房主开局：大鼓、锣，一声手铃收尾
  { out: 'sfx/lobby.start.m4a', maxLen: 2.2, fadeOut: 1.2, layers: [{ src: DRUM_FF, to: 1.6, norm: 0 }, { src: FRAME, norm: 0, gain: -6 }, { src: GONG_F, at: 0.05, to: 2.4, norm: 0, gain: -6 }, { src: HB(1), at: 0.25, to: 2.2, norm: 0, gain: -12 }] },
  // 链接复制好了：木鱼轻轻一敲、钟琴一点
  { out: 'sfx/lobby.copy.m4a', maxLen: 0.6, fadeOut: 0.35, layers: [{ src: WOOD('wood_click_mp'), norm: 0, gain: -2 }, { src: CHIME('C5'), at: 0.03, to: 0.6, norm: 0, gain: -6 }] },

  // ---------- 云霄：混元金斗、九曲黄河、青鸾（水行；分支 yunxiao 的调用是「名字表里有素材就放它」，合进来就用上）----------
  // 金斗飞出：一道沉的破风、金斗低低地一嗡
  { out: 'sfx/jindou.fly.m4a', maxLen: 0.6, fadeOut: 0.3, layers: [{ src: SWO(15), rate: 0.9, norm: 0, highpass: 150 }, { src: RP('inventory/metal-ringing'), lowpass: 1800, rate: 0.49, norm: 0, gain: -10 }] },
  // 吸住一片：风往斗口里卷（倒放的风）、低的闷响、尘土
  { out: 'sfx/jindou.suck.m4a', keepLead: true, maxLen: 1.0, fadeOut: 0.15, layers: [{ src: AIR, from: 2.5, to: 3.5, reverse: true, norm: 0, fadeIn: 0.2 }, { src: SWO(24), reverse: true, norm: 0, gain: -5, lowpass: 3000 }, { src: KS('lowFrequency_explosion_001'), reverse: true, to: 1.0, norm: 0, gain: -12 }] },
  // 浇下去（斗口倒出一股水）：倒水声、一点泼溅
  { out: 'sfx/jindou.pour.m4a', maxLen: 0.9, fadeOut: 0.45, layers: [{ src: TS('water-pour-01'), to: 0.9, norm: 0 }, { src: RW('splash_09'), at: 0.25, norm: 0, gain: -6 }] },
  // 喷出（把吸进去的抛出去）：一股水猛地喷出、破风
  { out: 'sfx/jindou.spit.m4a', maxLen: 0.9, fadeOut: 0.45, layers: [{ src: RW('splash_12'), norm: 0 }, { src: SWO(3), rate: 0.9, norm: 0, gain: -6, lowpass: 3000 }, { src: KI('impactSoft_medium_000'), norm: 0, gain: -10 }] },
  // 落地：水花、闷的一砸
  { out: 'sfx/jindou.land.m4a', maxLen: 0.8, fadeOut: 0.4, layers: [{ src: RW('splash_05'), norm: 0, lowpass: 5000 }, { src: KI('impactSoft_heavy_001'), norm: 0, gain: -3, lowpass: 2000 }, { src: DRUM_F, to: 0.8, norm: 0, gain: -9 }] },
  // 九曲黄河涌起（神通）：大水由远及近涌上来、低的轰鸣
  { out: 'sfx/huanghe.rise.m4a', keepLead: true, maxLen: 1.6, fadeOut: 0.5, layers: [{ src: OCEAN(3), from: 0.5, to: 2.1, norm: 0, fadeIn: 0.6 }, { src: RW('loop_water_02'), from: 1.0, to: 2.6, norm: 0, gain: -6, fadeIn: 0.5 }, { src: QUAKE, to: 1.6, norm: 0, gain: -10, lowpass: 600, fadeIn: 0.5 }] },
  // 黄河拍下：一大片水砸下来、大鼓、低的轰
  { out: 'sfx/huanghe.slam.m4a', maxLen: 1.4, fadeOut: 0.7, layers: [{ src: RW('splash_01'), norm: 0 }, { src: KS('lowFrequency_explosion_000'), norm: 0, gain: -4 }, { src: DRUM_FF, to: 1.4, norm: 0, gain: -5 }, { src: OCEAN(2), from: 6, to: 7.4, norm: 0, gain: -10, fadeIn: 0.05 }] },
  // 浪头打在敌人身上：泼溅、碎石
  { out: 'sfx/huanghe.crash.m4a', maxLen: 0.8, fadeOut: 0.4, layers: [{ src: RW('splash_14'), norm: 0 }, { src: RB('rock_falling_07'), norm: 0, gain: -10 }, { src: KI('impactSoft_heavy_004'), norm: 0, gain: -8, lowpass: 1500 }] },
  // 青鸾俯冲：扑翅（布声，快）、一道细风
  { out: 'sfx/qingluan.dive.m4a', maxLen: 0.6, fadeOut: 0.3, layers: [{ src: KR('cloth2'), rate: 1.4, norm: 0 }, { src: KR('cloth4'), at: 0.09, rate: 1.5, norm: 0, gain: -3 }, { src: SWO(12), rate: 1.2, norm: 0, gain: -6, highpass: 300 }] },
  // 寒羽（拂过敌人，降攻速移速）：一道轻风、细的冰响
  { out: 'sfx/qingluan.feather.m4a', maxLen: 0.6, fadeOut: 0.3, layers: [{ src: SWI(13), rate: 1.3, norm: 0, highpass: 500 }, { src: ICE('LedasLuzta5'), norm: 0, gain: -10, highpass: 1500 }, { src: KI('impactGlass_light_002'), norm: 0, gain: -14 }] },
  // 冻住：冷的冰裂、酒杯似的余音
  { out: 'sfx/qingluan.frost.m4a', maxLen: 0.9, fadeOut: 0.45, layers: [{ src: ICESP('coldsnap'), to: 0.9, norm: 0 }, { src: FG('Releases/Slow/glass1_D#4_Slow_1_Decay'), rate: 1.2, norm: 0, gain: -8 }] },
  // 青鸾进化：筝往上滑、手铃与风铃、一缕亮的长音
  { out: 'sfx/qingluan.evolve.m4a', maxLen: 2.4, fadeOut: 1.1, layers: [{ src: ZH('Gliss/Gliss_Up_Swl_mf_1'), to: 2.4, norm: 0 }, { src: CHIME('F#5'), at: 0.4, to: 2.4, norm: 0, gain: -6 }, { src: WIND('asc1'), at: 0.2, to: 2.2, norm: 0, gain: -9 }, { src: FG('Sustains/Slow/glass4_D5_Slow_2_Main'), from: 1, to: 3.2, at: 0.3, norm: 0, gain: -12, fadeIn: 0.4 }] },

  // ---------- 再加的 11 件法宝（分支 arti2 还在做：先把已经定了名字的做好，合进来时 bank.ts 指过来）----------
  // 降魔杵：脱手飞出（沉的破风、杵身一点金属的嗡）、砸地（金属与土的一砸）
  { out: 'sfx/xiangmo.fall.m4a', maxLen: 0.55, fadeOut: 0.28, layers: [{ src: SWO(3), rate: 1.1, norm: 0, lowpass: 4000 }, { src: RP('inventory/metal-ringing'), lowpass: 1800, rate: 0.56, norm: 0, gain: -10 }] },
  { out: 'sfx/xiangmo.land.m4a', maxLen: 0.8, fadeOut: 0.4, layers: [{ src: KI('impactMetal_heavy_004'), norm: 0, lowpass: 4500 }, { src: DRUM_F, to: 0.8, norm: 0, gain: -5 }, { src: RB('rock_falling_08'), at: 0.02, norm: 0, gain: -12 }] },
  // 五光石：掷出（小石子破风）、打中（石子「笃」一下、一点亮的钟琴）
  { out: 'sfx/wuguang.throw.m4a', maxLen: 0.35, fadeOut: 0.18, layers: [{ src: SWI(1), rate: 1.2, norm: 0, highpass: 250 }, { src: SWO(14), rate: 1.3, norm: 0, gain: -6, highpass: 300 }, { src: R1('item_stone_02'), norm: 0, gain: -10 }] },
  { out: 'sfx/wuguang.hit.m4a', maxLen: 0.45, fadeOut: 0.25, layers: [{ src: R1('item_stone_04'), norm: 0 }, { src: KI('impactGeneric_light_002'), norm: 0, gain: -5 }, { src: CHIME('G#4'), to: 0.45, norm: 0, gain: -12 }] },
  // 攒心钉：连发（极细的「咻」）、钉进去（金属一点）、钉满钻心（刮的金属声 + 砧子一敲）
  { out: 'sfx/zanxin.shot.m4a', maxLen: 0.25, fadeOut: 0.12, layers: [{ src: SWI(7), rate: 1.35, norm: 0, highpass: 500 }, { src: SWO(25), rate: 1.4, norm: 0, gain: -7, highpass: 600 }] },
  { out: 'sfx/zanxin.hit.m4a', maxLen: 0.25, fadeOut: 0.12, layers: [{ src: KI('impactMetal_light_002'), rate: 1.2, norm: 0 }, { src: KI('impactWood_light_001'), norm: 0, gain: -8 }] },
  { out: 'sfx/zanxin.drill.m4a', maxLen: 0.8, fadeOut: 0.4, layers: [{ src: TS('metal-knife-scrape-02'), to: 0.6, norm: 0, gain: -2, lowpass: 3000 }, { src: ANVIL, at: 0.12, norm: 0, gain: -4, lowpass: 3000 }] },
  // 金蛟剪：扑出去（刃风、金属的嗡）、交剪（剪子一合、金属一碰）
  { out: 'sfx/jinjiao.dart.m4a', maxLen: 0.5, fadeOut: 0.25, layers: [{ src: SWI(2), norm: 0 }, { src: RP('inventory/metal-ringing'), lowpass: 1800, rate: 0.77, norm: 0, gain: -11 }] },
  { out: 'sfx/jinjiao.snip.m4a', maxLen: 0.5, fadeOut: 0.25, layers: [{ src: TS('scissors-close-01'), norm: 0 }, { src: KI('impactMetal_medium_001'), norm: 0, gain: -6 }, { src: SWORD(6), norm: 0, gain: -10, lowpass: 7000 }] },
  // 离地焰光旗：插下（旗杆一杵、旗面一抖）、地火窜起（火呼地蹿上来、低的一闷）
  { out: 'sfx/yanguang.plant.m4a', maxLen: 0.6, fadeOut: 0.3, layers: [{ src: KI('impactWood_heavy_003'), norm: 0, lowpass: 3000 }, { src: KR('cloth3'), at: 0.03, norm: 0, gain: -5 }, { src: FLARE, to: 0.5, norm: 0, gain: -12 }] },
  { out: 'sfx/yanguang.erupt.m4a', maxLen: 0.8, fadeOut: 0.4, layers: [{ src: FS(20), to: 0.9, norm: 0, fadeOut: 0.3 }, { src: FLARE, to: 0.7, norm: 0, gain: -6 }, { src: KS('lowFrequency_explosion_001'), norm: 0, gain: -12 }] },
  // 万鸦壶：倾壶（壶口一倾、一群扑翅）、火鸦啄中（轻的一下带一点火）、仙品火鸦自焚（小的一团火炸开）
  { out: 'sfx/wanya.pour.m4a', maxLen: 0.9, fadeOut: 0.4, layers: [...[0, 0.07, 0.15, 0.24, 0.33].map((at, k): Layer => ({ src: KR(['cloth2', 'cloth4', 'cloth3'][k % 3]), at, rate: 1.4 + 0.05 * k, norm: 0, gain: -2 - k })), { src: FS(16), to: 0.8, norm: 0, gain: -8, fadeOut: 0.3 }] },
  { out: 'sfx/wanya.peck.m4a', maxLen: 0.3, fadeOut: 0.15, layers: [{ src: KI('impactPunch_medium_003'), norm: 0, lowpass: 3000 }, { src: TS('lighter-light-01'), norm: 0, gain: -10 }] },
  { out: 'sfx/wanya.boom.m4a', maxLen: 0.8, fadeOut: 0.4, layers: [{ src: FIREBALL, to: 0.8, norm: 0, fadeOut: 0.3 }, { src: FS(6), norm: 0, gain: -6 }] },

  // ---------- 灵物、符箓（relic-fx.ts）----------
  // 金刚琢飞出：金属环呼呼地转着飞
  { out: 'sfx/relic.zhuo.m4a', maxLen: 0.6, fadeOut: 0.3, layers: [{ src: SWO(14), norm: 0, highpass: 150 }, { src: RP('inventory/metal-ringing'), lowpass: 1800, at: 0.04, rate: 0.595, norm: 0, gain: -6 }] },
  // 金刚琢砸中：沉的金属一砸、地面一震
  { out: 'sfx/relic.zhuo.land.m4a', maxLen: 0.9, fadeOut: 0.45, layers: [{ src: KI('impactBell_heavy_000'), norm: 0, lowpass: 3500 }, { src: DRUM_F, to: 0.9, norm: 0, gain: -4 }, { src: RB('rock_falling_05'), at: 0.03, norm: 0, gain: -14 }] },
  // 九龙玉佩的龙息：一口长的风、低的兽息、玉佩一声清
  { out: 'sfx/relic.jadedragon.m4a', maxLen: 0.9, fadeOut: 0.45, layers: [{ src: R3('air_02'), norm: 0, lowpass: 4500 }, { src: RC('breath'), rate: 0.7, norm: 0, gain: -5 }, { src: R1('item_gem_02'), at: 0.05, norm: 0, gain: -9 }] },
  // 照妖镜照出：镜光一闪（酒杯的泛音、铃树一点、一道细风）
  { out: 'sfx/relic.mirror.m4a', maxLen: 1.0, fadeOut: 0.5, layers: [{ src: FG('Sustains/Slow/glass3_A#4_Slow_1_Main'), from: 5, to: 6, norm: 0, fadeIn: 0.05 }, { src: ID('Bell Tree/Individual/BellTree_Hit_G#5_rr1_Mid.wav'), to: 1.0, norm: 0, gain: -6 }, { src: SWI(6), rate: 1.2, norm: 0, gain: -10 }] },
  // 混元伞挡下鬼火：伞面一兜（布声 + 软的闷响）、鬼火灭掉的一点嘶
  { out: 'sfx/relic.umbrella.m4a', maxLen: 0.6, fadeOut: 0.3, layers: [{ src: RP('inventory/cloth-heavy'), norm: 0 }, { src: KI('impactSoft_heavy_003'), norm: 0, gain: -4 }, { src: TS('compressed-air-spray-01'), to: 0.35, norm: 0, gain: -14, highpass: 1500 }] },
  // 乾坤袋生灵石：袋子一抖、宝石叮当
  { out: 'sfx/relic.pouch.m4a', maxLen: 0.7, fadeOut: 0.35, layers: [{ src: TS('cloth-pouch-shake-02'), norm: 0 }, { src: R1('item_gem_01'), at: 0.12, norm: 0, gain: -3 }, { src: CHIME('G#4'), at: 0.14, to: 0.7, norm: 0, gain: -12 }] },
  // 风雷羽的小雷：细的电火花、羽毛似的轻风
  { out: 'sfx/relic.stormfeather.m4a', maxLen: 0.6, fadeOut: 0.3, layers: [{ src: EL('hit'), to: 0.45, norm: 0, fadeOut: 0.2, highpass: 400 }, { src: TS('arrow-feathers-01'), norm: 0, gain: -6 }, { src: TS('paralyzer-discharge-01'), to: 0.3, norm: 0, gain: -12, highpass: 800 }] },
  // 冰心玉壶（挡下一次伤害）：玉壶一声清、冷的冰裂
  { out: 'sfx/relic.icevase.m4a', maxLen: 0.9, fadeOut: 0.45, layers: [{ src: CHIME('E5'), to: 1.0, norm: 0 }, { src: ICE('LedasLuzta5'), norm: 0, gain: -8, highpass: 800 }, { src: KI('impactGlass_light_004'), norm: 0, gain: -10 }] },
  // 噬心蛊噬血：虫子一口、吸的声音
  { out: 'sfx/relic.gu.m4a', maxLen: 0.6, fadeOut: 0.3, layers: [{ src: RP('NPC/beetle/bite-small'), norm: 0 }, { src: RW('slime_09'), at: 0.05, norm: 0, gain: -6, lowpass: 3000 }, { src: RC('bug_02'), norm: 0, gain: -12 }] },
  // 夔牛鼓擂鼓：大鼓咚咚两下
  { out: 'sfx/relic.drum.m4a', maxLen: 1.1, fadeOut: 0.6, layers: [{ src: DRUM_FF, to: 1.0, norm: 0, fadeOut: 0.5 }, { src: FRAME, norm: 0, gain: -7 }, { src: DRUM_F, at: 0.22, to: 1.1, norm: 0, gain: -2 }, { src: FRAME, at: 0.22, norm: 0, gain: -8 }] },
  // 燃魂香燃血：香头一亮（细的火嘶）、一点噼啪、一声很轻的铃
  { out: 'sfx/relic.incense.m4a', maxLen: 0.9, fadeOut: 0.45, layers: [{ src: TS('match-light-01'), norm: 0, gain: -2 }, { src: CRACKLE, from: 1.0, to: 1.8, norm: 0, gain: -8, fadeIn: 0.05 }, { src: HB(3), at: 0.1, to: 0.9, norm: 0, gain: -12 }] },
  // 定身符：符纸「啪」地贴上、一声定住的铃
  { out: 'sfx/relic.dingshen.m4a', maxLen: 0.8, fadeOut: 0.4, layers: [{ src: R2('paper_02'), norm: 0 }, { src: KI('impactSoft_medium_004'), norm: 0, gain: -6 }, { src: HB(2), at: 0.06, rate: 0.9, norm: 0, gain: -8 }] },
  // 引雷符：符纸一燃、一道雷劈下来
  { out: 'sfx/relic.yinlei.m4a', maxLen: 1.3, fadeOut: 0.6, layers: [{ src: TS('match-light-01'), norm: 0, gain: -6 }, { src: R3('thunder_01'), at: 0.08, from: 0.75, to: 1.9, norm: 0, fadeIn: 0.005 }, { src: EL('killconfirmed'), at: 0.08, to: 0.6, norm: 0, gain: -8, fadeOut: 0.3 }] },
  // 遁地符：钻进地里（一阵闷的土声、往下收的破风）
  { out: 'sfx/relic.dundi.m4a', maxLen: 0.9, fadeOut: 0.45, layers: [{ src: EARTH, to: 0.9, norm: 0 }, { src: SWO(3), rate: 0.75, reverse: true, norm: 0, gain: -8, lowpass: 2500 }, { src: KI('impactSoft_heavy_004'), at: 0.3, norm: 0, gain: -8 }] },
  // 回灵符（回气血）：符纸一展、一声暖的手铃、筝轻轻一拨
  { out: 'sfx/relic.huiling.m4a', maxLen: 1.4, fadeOut: 0.7, layers: [{ src: R2('paper_04'), norm: 0, gain: -6 }, { src: CHIME('G#4'), at: 0.05, to: 1.4, norm: 0 }, { src: ZH('Normal/G#4_mf_1'), at: 0.12, to: 1.3, norm: 0, gain: -8 }] },
];

// 音乐：Kevin MacLeod（CC-BY 4.0，需署名）。循环点用 tools/audio/loopfind.ts 找的：E 之前一段和 S 之前一段最像，
// 长度都是整小节（Shenyang 64 小节 @130BPM，Big Mojo 62 小节 @171BPM）。Guzheng City 段落重复少，整首循环：
// 结尾 1.5 秒和开头 1.5 秒交叉淡化，听起来是余音里重新起头。
// 配乐一律 HE-AAC 48kbps 立体声（2026-11-12 瘦身：原来 AAC-LC 96kbps，听感接近、体积约一半；三个浏览器内核都解得了，见 docs/audio.md「瘦身」）。
export const MUSIC: Recipe[] = [
  // 第一章战斗（2026-11-13 用户选定）：自作「破阵」——太鼓 + 古筝，G# 羽，150 拍/分；前奏 4 小节（6.4 秒），之后 52 小节循环。
  // 先 node tools/audio/compose/render.ts 渲出 WAV（scratch/downloads/compose/）。原来是「Aggressor」（用户：不好听），更早是「Shenyang」（喜庆）。
  { out: 'music/battle.m4a', stereo: true, keepLead: true, kbps: 48, codec: 'aach', loud: -17, layers: [{ src: 'compose/compose-a.wav' }], loop: { start: 6.4, end: 89.6, xfade: 0.02, match: true } },
  // Big Mojo 开头 30 秒几乎无声（-50dB 上下），首领战要一上来就有劲：从 31.3 秒（鼓点进来前的一小段上扬）截起
  { out: 'music/boss.m4a', stereo: true, keepLead: true, kbps: 48, codec: 'aach', loud: -17, layers: [{ src: 'incompetech/Big Mojo.mp3', from: 31.3, to: 133.5, fadeIn: 0.15 }], loop: { start: 45.128 - 31.3, end: 132.145 - 31.3, xfade: 0.12 } },
  { out: 'music/shop.m4a', stereo: true, keepLead: true, kbps: 48, codec: 'aach', loud: -17, layers: [{ src: 'incompetech/Guzheng City.mp3', to: 108 }], loop: { start: 1.85, end: 106.3, xfade: 1.5 } },
  // ---- 按章 ----
  // 循环点用 scratch 里的工具找：先在长段里精确估速度；S 取在拍点上，E = S + 整数小节，在 ±25ms 里按「两边之前 0.4 秒的波形互相关」逐样本细调
  // （鼓点、拨弦的起音对得上），再参考两边各 6 秒前、3 秒后的频带能量像不像。check.ts --measure 复量了接缝。
  // 第二章战斗（西岐城外黄昏旷野：苍凉、鼓点）：「Eastern Thought」弦乐 + 金属打击乐，99 BPM。原曲前 50 秒是慢慢铺开的弦乐垫底，
  // 鼓在 54 秒才进来：从 44.2 秒截起（鼓进来前五小节），之后 56.96–146.64 秒（37 小节，接缝前 0.4 秒波形互相关 0.83）循环
  // （2026-11-12 换掉，原来的配方留作参考）{ out: 'music/battle.ch2.m4a', … layers: [{ src: 'incompetech/Eastern Thought.mp3', from: 44.211, to: 148, fadeIn: 0.15 }], loop: { start: 56.9592 - 44.211, end: 146.6435 - 44.211, xfade: 0.12, match: true } },
  // 第二章战斗（2026-11-12 换）：「Black Vortex」管弦与合成器的混合，7/8 拍，铜管领着、一刻不停。原曲前 40 秒是慢的铺垫：
  // 从 40 秒那一下全奏截起，47.22–150.01 秒（约 103 秒）循环（中间有一段收着的，再推上去）
  { out: 'music/battle.ch2.m4a', stereo: true, keepLead: true, kbps: 48, codec: 'aach', loud: -17, layers: [{ src: 'incompetech/Black Vortex.mp3', from: 40, to: 151.5, fadeIn: 0.05 }], loop: { start: 47.218 - 40, end: 150.013 - 40, xfade: 0.2, match: true } },
  // 第二章首领（姚天君：阴森、摇铃）：「Himalayan Atmosphere」颂钵与打击乐，112 BPM；12.37–98.08 秒（40 小节）循环：曲子本身就是这一段的重复（互相关 0.997）
  { out: 'music/boss.ch2.m4a', stereo: true, keepLead: true, kbps: 48, codec: 'aach', loud: -17, layers: [{ src: 'incompetech/Himalayan Atmosphere.mp3', to: 100 }], loop: { start: 12.365, end: 98.0793, xfade: 0.12, match: true } },
  // 第三章战斗（诛仙阵夜谷：压抑、史诗）：「Oppressive Gloom」弦乐、低音单簧管、打击乐，59 BPM 的行进；9.13–106.80 秒（24 小节）循环，首次从头放
  // （2026-11-12 换掉）{ out: 'music/battle.ch3.m4a', … layers: [{ src: 'incompetech/Oppressive Gloom.mp3', to: 108 }], loop: { start: 9.1252, end: 106.8048, xfade: 0.12, match: true } },
  // 第三章战斗（2026-11-12 换）：「Volatile Reaction」7/4 拍、铜管轰鸣、打击乐砸下来，155 BPM，暗而凶（诛仙阵）。首次从头放；51.85–154.82 秒（38 小节）循环
  { out: 'music/battle.ch3.m4a', stereo: true, keepLead: true, kbps: 48, codec: 'aach', loud: -17, layers: [{ src: 'incompetech/Volatile Reaction.mp3', to: 156.5 }], loop: { start: 51.85, end: 154.819, xfade: 0.12, match: true } },
  // 第三章首领（诛仙剑灵，最终战）：「Hitman」合唱、弦乐、打击乐，75 BPM。前 50 秒有一段收着的过门：从 48.7 秒截起（51 秒那一下全奏之前），
  // 之后 62.27–151.85 秒（28 小节）循环。这首没有逐字重复的段落（波形互相关只有 0.3），接缝按频带能量最像的一对挑，交叉放长到 0.35 秒
  { out: 'music/boss.ch3.m4a', stereo: true, keepLead: true, kbps: 48, codec: 'aach', loud: -17, layers: [{ src: 'incompetech/Hitman.mp3', from: 48.675, to: 153.5, fadeIn: 0.1 }], loop: { start: 62.2687 - 48.675, end: 151.8518 - 48.675, xfade: 0.35, match: true } },
  // 结局与致谢：「Nu Flute」笛子与弦乐，整首循环：结尾 1.5 秒的余音和开头交叉淡化
  { out: 'music/ending.m4a', stereo: true, keepLead: true, kbps: 48, codec: 'aach', loud: -17, layers: [{ src: 'incompetech/Nu Flute.mp3', to: 80.2 }], loop: { start: 1.6, end: 79.8, xfade: 1.5, match: true } },
  // 修为树、联机大厅（安静）：「Ripples」古筝独奏。独奏的速度是松的，不按小节：在两处乐句间的空隙里截（49.5–52.0 秒、132.4–133.5 秒都低于 -50dB），
  // 从 49.6 秒截起，51.4–133.4 秒循环，接缝处两边都是空隙里的余音，交叉 1 秒
  { out: 'music/calm.m4a', stereo: true, keepLead: true, kbps: 48, codec: 'aach', loud: -17, layers: [{ src: 'incompetech/Ripples.mp3', from: 49.6, to: 134.2 }], loop: { start: 51.4 - 49.6, end: 133.4 - 49.6, xfade: 1.0, match: true } },
];
