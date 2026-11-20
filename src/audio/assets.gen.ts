// 由 tools/audio/build.ts 生成，不要手改：public/audio/ 下每个文件的时长、首个声音的位置、音乐的循环点、响度。
export interface AssetMeta {
  dur: number;
  onset: number;
  loopStart?: number;
  loopEnd?: number;
  lufs: number;
  peak: number;
}

export const ASSETS: Record<string, AssetMeta> = {
  "music/battle": {
    "dur": 89.6,
    "onset": 0,
    "loopStart": 6.4,
    "loopEnd": 89.6,
    "lufs": -17,
    "peak": -3.7
  },
  "music/battle.ch2": {
    "dur": 110.012993,
    "onset": 0.0014,
    "loopStart": 7.218004535147393,
    "loopEnd": 110.01299319727892,
    "lufs": -17,
    "peak": -2.4
  },
  "music/battle.ch3": {
    "dur": 154.819002,
    "onset": 0.0041,
    "loopStart": 51.85,
    "loopEnd": 154.8190022675737,
    "lufs": -17,
    "peak": -7.4
  },
  "music/boss": {
    "dur": 100.845011,
    "onset": 0.0858,
    "loopStart": 13.828004535147393,
    "loopEnd": 100.84501133786848,
    "lufs": -20.3,
    "peak": -1
  },
  "music/boss.ch2": {
    "dur": 98.079297,
    "onset": 0.0105,
    "loopStart": 12.36501133786848,
    "loopEnd": 98.07929705215419,
    "lufs": -24,
    "peak": -1
  },
  "music/boss.ch3": {
    "dur": 103.176803,
    "onset": 0.0138,
    "loopStart": 13.593696145124717,
    "loopEnd": 103.17680272108844,
    "lufs": -17,
    "peak": -4.5
  },
  "music/calm": {
    "dur": 83.8,
    "onset": 0,
    "loopStart": 1.8,
    "loopEnd": 83.8,
    "lufs": -17.1,
    "peak": -1
  },
  "music/ending": {
    "dur": 79.8,
    "onset": 1.0359,
    "loopStart": 1.6,
    "loopEnd": 79.8,
    "lufs": -17,
    "peak": -3.8
  },
  "music/shop": {
    "dur": 106.3,
    "onset": 0.3016,
    "loopStart": 1.85,
    "loopEnd": 106.3,
    "lufs": -18.1,
    "peak": -1
  },
  "sfx/boss.clone": {
    "dur": 1.208481,
    "onset": 0.001,
    "lufs": -13.8,
    "peak": -1
  },
  "sfx/boss.dash": {
    "dur": 0.807959,
    "onset": 0.001,
    "lufs": -16.9,
    "peak": -1
  },
  "sfx/boss.dash.charge": {
    "dur": 2.519841,
    "onset": 0.002,
    "lufs": -19.2,
    "peak": -1
  },
  "sfx/boss.death": {
    "dur": 4.000023,
    "onset": 0.0003,
    "lufs": -15.4,
    "peak": -1
  },
  "sfx/boss.hurt.1": {
    "dur": 0.381882,
    "onset": 0.0007,
    "lufs": -18.1,
    "peak": -1
  },
  "sfx/boss.hurt.2": {
    "dur": 0.306122,
    "onset": 0.0007,
    "lufs": -19.5,
    "peak": -1
  },
  "sfx/boss.intro": {
    "dur": 3.500023,
    "onset": 0.0006,
    "lufs": -14,
    "peak": -1
  },
  "sfx/boss.miasma": {
    "dur": 2.600023,
    "onset": 0.0014,
    "lufs": -16.1,
    "peak": -1
  },
  "sfx/boss.phase": {
    "dur": 3.000023,
    "onset": 0.0004,
    "lufs": -12,
    "peak": -2.3
  },
  "sfx/boss.ring.throw": {
    "dur": 0.815782,
    "onset": 0.0013,
    "lufs": -23.6,
    "peak": -1
  },
  "sfx/boss.ring.warn": {
    "dur": 2.24746,
    "onset": 0.0004,
    "lufs": -12.4,
    "peak": -1
  },
  "sfx/boss.roar": {
    "dur": 2.200023,
    "onset": 0.0005,
    "lufs": -12,
    "peak": -3.6
  },
  "sfx/boss.sweep": {
    "dur": 1.000023,
    "onset": 0.0013,
    "lufs": -23.2,
    "peak": -1
  },
  "sfx/boss.sweep.warn": {
    "dur": 1.400023,
    "onset": 0.0012,
    "lufs": -13.2,
    "peak": -1
  },
  "sfx/boss.wheel": {
    "dur": 1.600023,
    "onset": 0.0007,
    "lufs": -14,
    "peak": -1
  },
  "sfx/boss.wheel.warn": {
    "dur": 1.600023,
    "onset": 0.0008,
    "lufs": -12.5,
    "peak": -1
  },
  "sfx/cast": {
    "dur": 0.635692,
    "onset": 0.0015,
    "lufs": -12,
    "peak": -1.3
  },
  "sfx/dashen.lash.1": {
    "dur": 0.598912,
    "onset": 0.0003,
    "lufs": -19,
    "peak": -1
  },
  "sfx/dashen.lash.2": {
    "dur": 0.6,
    "onset": 0.0004,
    "lufs": -22,
    "peak": -1
  },
  "sfx/dashen.shock": {
    "dur": 0.999025,
    "onset": 0.0008,
    "lufs": -13.8,
    "peak": -1
  },
  "sfx/dialogue.blip.1": {
    "dur": 0.142721,
    "onset": 0.0007,
    "lufs": -17.7,
    "peak": -1
  },
  "sfx/dialogue.blip.2": {
    "dur": 0.142721,
    "onset": 0.0005,
    "lufs": -17.9,
    "peak": -1
  },
  "sfx/dingfeng.gust": {
    "dur": 1.123764,
    "onset": 0.0019,
    "lufs": -14.3,
    "peak": -1
  },
  "sfx/dingfeng.thunder": {
    "dur": 1.005624,
    "onset": 0.0012,
    "lufs": -17.5,
    "peak": -1
  },
  "sfx/dingfeng.whirl": {
    "dur": 1.346984,
    "onset": 0.0015,
    "lufs": -12,
    "peak": -1.1
  },
  "sfx/dinghai.land.1": {
    "dur": 0.868639,
    "onset": 0.0003,
    "lufs": -20.2,
    "peak": -1
  },
  "sfx/dinghai.land.2": {
    "dur": 0.868549,
    "onset": 0.0005,
    "lufs": -20.9,
    "peak": -1
  },
  "sfx/dinghai.quake": {
    "dur": 1.000023,
    "onset": 0.0005,
    "lufs": -12,
    "peak": -1.9
  },
  "sfx/dispel": {
    "dur": 0.741655,
    "onset": 0.0009,
    "lufs": -13.3,
    "peak": -1
  },
  "sfx/dot.bleed.1": {
    "dur": 0.274739,
    "onset": 0.0014,
    "lufs": -19.4,
    "peak": -1
  },
  "sfx/dot.bleed.2": {
    "dur": 0.300023,
    "onset": 0.0016,
    "lufs": -25.1,
    "peak": -1
  },
  "sfx/drop.chest": {
    "dur": 1.191655,
    "onset": 0.0012,
    "lufs": -21.9,
    "peak": -1
  },
  "sfx/drop.magnet": {
    "dur": 1.795964,
    "onset": 0.0009,
    "lufs": -22.3,
    "peak": -1
  },
  "sfx/drop.peach": {
    "dur": 1.000023,
    "onset": 0.0011,
    "lufs": -21.5,
    "peak": -1
  },
  "sfx/drop.spawn": {
    "dur": 0.800023,
    "onset": 0.0023,
    "lufs": -18.8,
    "peak": -1
  },
  "sfx/drum": {
    "dur": 0.900023,
    "onset": 0.0008,
    "lufs": -18.5,
    "peak": -1
  },
  "sfx/enemy.charge": {
    "dur": 0.900023,
    "onset": 0.0002,
    "lufs": -13.6,
    "peak": -1
  },
  "sfx/enemy.charge.warn": {
    "dur": 0.850023,
    "onset": 0.0125,
    "lufs": -15.4,
    "peak": -1
  },
  "sfx/enemy.explode": {
    "dur": 0.992063,
    "onset": 0.0018,
    "lufs": -17,
    "peak": -1
  },
  "sfx/enemy.fuse": {
    "dur": 0.832472,
    "onset": 0.0064,
    "lufs": -23,
    "peak": -1
  },
  "sfx/enemy.guard.1": {
    "dur": 0.33737,
    "onset": 0.0002,
    "lufs": -22,
    "peak": -1
  },
  "sfx/enemy.guard.2": {
    "dur": 0.233333,
    "onset": 0.0002,
    "lufs": -21.5,
    "peak": -1
  },
  "sfx/enemy.spear.1": {
    "dur": 0.230363,
    "onset": 0.0003,
    "lufs": -18.8,
    "peak": -1
  },
  "sfx/enemy.spear.2": {
    "dur": 0.144989,
    "onset": 0.0002,
    "lufs": -16,
    "peak": -1
  },
  "sfx/enemy.spear.warn": {
    "dur": 0.63161,
    "onset": 0.0389,
    "lufs": -15.7,
    "peak": -1
  },
  "sfx/enemy.split": {
    "dur": 0.45102,
    "onset": 0.0015,
    "lufs": -16.3,
    "peak": -1
  },
  "sfx/fantian.land.1": {
    "dur": 1.200023,
    "onset": 0.0008,
    "lufs": -17.4,
    "peak": -1
  },
  "sfx/fantian.land.2": {
    "dur": 1.051973,
    "onset": 0.0005,
    "lufs": -18.4,
    "peak": -1
  },
  "sfx/fly.aim": {
    "dur": 1.123764,
    "onset": 0.0038,
    "lufs": -12,
    "peak": -2.5
  },
  "sfx/fly.shot.1": {
    "dur": 0.241769,
    "onset": 0.0019,
    "lufs": -22.3,
    "peak": -1
  },
  "sfx/fly.shot.2": {
    "dur": 0.305465,
    "onset": 0.0016,
    "lufs": -19.8,
    "peak": -1
  },
  "sfx/hanbing.frost": {
    "dur": 1.53415,
    "onset": 0.0234,
    "lufs": -16.3,
    "peak": -1
  },
  "sfx/heihu.broke": {
    "dur": 0.79542,
    "onset": 0.0015,
    "lufs": -17,
    "peak": -1
  },
  "sfx/heihu.dash": {
    "dur": 0.41229,
    "onset": 0.0016,
    "lufs": -17.1,
    "peak": -1
  },
  "sfx/heihu.evolve": {
    "dur": 2.400023,
    "onset": 0.0013,
    "lufs": -13.5,
    "peak": -1
  },
  "sfx/heihu.roar": {
    "dur": 0.634195,
    "onset": 0.0012,
    "lufs": -15,
    "peak": -1
  },
  "sfx/hit.crit": {
    "dur": 0.600023,
    "onset": 0.0008,
    "lufs": -12,
    "peak": -1.1
  },
  "sfx/huanghe.crash": {
    "dur": 0.571723,
    "onset": 0.0003,
    "lufs": -21.7,
    "peak": -1
  },
  "sfx/huanghe.rise": {
    "dur": 1.695125,
    "onset": 0.0037,
    "lufs": -14,
    "peak": -1
  },
  "sfx/huanghe.slam": {
    "dur": 1.571474,
    "onset": 0.0009,
    "lufs": -14.5,
    "peak": -1
  },
  "sfx/huaxue.drain": {
    "dur": 0.900023,
    "onset": 0.0022,
    "lufs": -14.2,
    "peak": -1
  },
  "sfx/huaxue.slash.1": {
    "dur": 0.749184,
    "onset": 0.0011,
    "lufs": -17.2,
    "peak": -1
  },
  "sfx/huaxue.slash.2": {
    "dur": 0.560295,
    "onset": 0.0007,
    "lufs": -18.6,
    "peak": -1
  },
  "sfx/hurt": {
    "dur": 0.413878,
    "onset": 0.0002,
    "lufs": -16.5,
    "peak": -1
  },
  "sfx/jie.pick": {
    "dur": 3.000023,
    "onset": 0.0004,
    "lufs": -12,
    "peak": -1.5
  },
  "sfx/jie.rage": {
    "dur": 2.400023,
    "onset": 0.0008,
    "lufs": -14.4,
    "peak": -1
  },
  "sfx/jie.split": {
    "dur": 0.800023,
    "onset": 0.0009,
    "lufs": -12.8,
    "peak": -1
  },
  "sfx/jinbian.crack": {
    "dur": 1.234739,
    "onset": 0.0005,
    "lufs": -17.4,
    "peak": -1
  },
  "sfx/jinbian.raise": {
    "dur": 0.951383,
    "onset": 0.0089,
    "lufs": -18,
    "peak": -1
  },
  "sfx/jinbian.strike": {
    "dur": 1.299161,
    "onset": 0.0002,
    "lufs": -20.3,
    "peak": -1
  },
  "sfx/jindou.fly": {
    "dur": 0.600023,
    "onset": 0.0012,
    "lufs": -16.3,
    "peak": -1
  },
  "sfx/jindou.land": {
    "dur": 1.159569,
    "onset": 0.0003,
    "lufs": -18.1,
    "peak": -1
  },
  "sfx/jindou.pour": {
    "dur": 0.845215,
    "onset": 0.0016,
    "lufs": -21.3,
    "peak": -1
  },
  "sfx/jindou.spit": {
    "dur": 0.951814,
    "onset": 0.0002,
    "lufs": -19.4,
    "peak": -1
  },
  "sfx/jindou.suck": {
    "dur": 1.059456,
    "onset": 0.0017,
    "lufs": -14.5,
    "peak": -1
  },
  "sfx/jinjiao.snip": {
    "dur": 0.279342,
    "onset": 0.0003,
    "lufs": -20.2,
    "peak": -1
  },
  "sfx/jiulong.burst.1": {
    "dur": 0.82093,
    "onset": 0.0018,
    "lufs": -16.4,
    "peak": -1
  },
  "sfx/jiulong.burst.2": {
    "dur": 1.097415,
    "onset": 0.0013,
    "lufs": -12.9,
    "peak": -1
  },
  "sfx/kill.0": {
    "dur": 0.900023,
    "onset": 0.001,
    "lufs": -20.4,
    "peak": -1
  },
  "sfx/kill.1": {
    "dur": 0.900023,
    "onset": 0.0009,
    "lufs": -19.3,
    "peak": -1
  },
  "sfx/kill.2": {
    "dur": 0.900023,
    "onset": 0.0009,
    "lufs": -18.7,
    "peak": -1
  },
  "sfx/kill.3": {
    "dur": 0.900023,
    "onset": 0.001,
    "lufs": -19.3,
    "peak": -1
  },
  "sfx/kill.4": {
    "dur": 0.900023,
    "onset": 0.0007,
    "lufs": -19.5,
    "peak": -1
  },
  "sfx/kill.5": {
    "dur": 0.900023,
    "onset": 0.0009,
    "lufs": -19.9,
    "peak": -1
  },
  "sfx/kill.6": {
    "dur": 0.900023,
    "onset": 0.001,
    "lufs": -19.6,
    "peak": -1
  },
  "sfx/kill.7": {
    "dur": 0.72551,
    "onset": 0.001,
    "lufs": -20,
    "peak": -1
  },
  "sfx/kill.8": {
    "dur": 0.900023,
    "onset": 0.001,
    "lufs": -19.5,
    "peak": -1
  },
  "sfx/kill.9": {
    "dur": 0.364966,
    "onset": 0.0009,
    "lufs": -19.3,
    "peak": -1
  },
  "sfx/kill.elite": {
    "dur": 1.69517,
    "onset": 0.0006,
    "lufs": -16.6,
    "peak": -1
  },
  "sfx/kunxian.bind": {
    "dur": 0.804059,
    "onset": 0.001,
    "lufs": -14.6,
    "peak": -1
  },
  "sfx/kunxian.clash": {
    "dur": 0.322676,
    "onset": 0.0004,
    "lufs": -17.6,
    "peak": -1
  },
  "sfx/leigong.strike.1": {
    "dur": 1.403741,
    "onset": 0.0016,
    "lufs": -22.7,
    "peak": -1
  },
  "sfx/leigong.strike.2": {
    "dur": 1.045941,
    "onset": 0.0021,
    "lufs": -18.2,
    "peak": -1
  },
  "sfx/lobby.copy": {
    "dur": 0.600023,
    "onset": 0.0008,
    "lufs": -14.6,
    "peak": -1
  },
  "sfx/lobby.join": {
    "dur": 1.648163,
    "onset": 0.0004,
    "lufs": -12,
    "peak": -3.5
  },
  "sfx/lobby.leave": {
    "dur": 1.202834,
    "onset": 0.0021,
    "lufs": -18.7,
    "peak": -1
  },
  "sfx/lobby.ready": {
    "dur": 0.536531,
    "onset": 0.0006,
    "lufs": -20.7,
    "peak": -1
  },
  "sfx/lobby.start": {
    "dur": 2.200023,
    "onset": 0.0009,
    "lufs": -15.7,
    "peak": -1
  },
  "sfx/orb": {
    "dur": 0.150499,
    "onset": 0.0018,
    "lufs": -16.7,
    "peak": -1
  },
  "sfx/pet.evolve": {
    "dur": 2.400023,
    "onset": 0.0013,
    "lufs": -13.8,
    "peak": -1
  },
  "sfx/pet.fly.1": {
    "dur": 0.284694,
    "onset": 0.0022,
    "lufs": -18.7,
    "peak": -1
  },
  "sfx/pet.fly.2": {
    "dur": 0.276054,
    "onset": 0.0014,
    "lufs": -19.5,
    "peak": -1
  },
  "sfx/pet.wrap.1": {
    "dur": 0.416349,
    "onset": 0.0004,
    "lufs": -22.2,
    "peak": -1
  },
  "sfx/pet.wrap.2": {
    "dur": 0.332494,
    "onset": 0.0004,
    "lufs": -19.8,
    "peak": -1
  },
  "sfx/pickup.hi": {
    "dur": 0.400023,
    "onset": 0.0012,
    "lufs": -14.1,
    "peak": -1
  },
  "sfx/pickup.lo": {
    "dur": 0.450023,
    "onset": 0.0008,
    "lufs": -12,
    "peak": -4.6
  },
  "sfx/pickup.mid": {
    "dur": 0.450023,
    "onset": 0.0008,
    "lufs": -12.9,
    "peak": -1
  },
  "sfx/qi.cast": {
    "dur": 0.635669,
    "onset": 0.0003,
    "lufs": -12,
    "peak": -1.1
  },
  "sfx/qi.throw": {
    "dur": 0.436395,
    "onset": 0.0015,
    "lufs": -19.3,
    "peak": -1
  },
  "sfx/qiankun.hover.1": {
    "dur": 0.68068,
    "onset": 0.0015,
    "lufs": -17.5,
    "peak": -1
  },
  "sfx/qiankun.hover.2": {
    "dur": 1.000023,
    "onset": 0.0018,
    "lufs": -15.6,
    "peak": -1
  },
  "sfx/qiankun.throw.1": {
    "dur": 0.302721,
    "onset": 0.0014,
    "lufs": -20.7,
    "peak": -1
  },
  "sfx/qiankun.throw.2": {
    "dur": 0.340635,
    "onset": 0.0019,
    "lufs": -21,
    "peak": -1
  },
  "sfx/qiankun.throw.3": {
    "dur": 0.265873,
    "onset": 0.0032,
    "lufs": -18.6,
    "peak": -1
  },
  "sfx/qinglian.bloom": {
    "dur": 1.783832,
    "onset": 0.0008,
    "lufs": -13.4,
    "peak": -1
  },
  "sfx/qinglian.heal": {
    "dur": 1.234739,
    "onset": 0.0013,
    "lufs": -12,
    "peak": -2.5
  },
  "sfx/qingluan.dive": {
    "dur": 0.334875,
    "onset": 0.0018,
    "lufs": -20.3,
    "peak": -1
  },
  "sfx/qingluan.evolve": {
    "dur": 2.542744,
    "onset": 0.0014,
    "lufs": -12.1,
    "peak": -1
  },
  "sfx/qingluan.frost": {
    "dur": 1.010249,
    "onset": 0.0007,
    "lufs": -12.3,
    "peak": -1
  },
  "sfx/react.conduct": {
    "dur": 1.130998,
    "onset": 0.0009,
    "lufs": -18.1,
    "peak": -1
  },
  "sfx/react.frost": {
    "dur": 1.048617,
    "onset": 0.0005,
    "lufs": -20.6,
    "peak": -1
  },
  "sfx/react.ignite": {
    "dur": 0.655601,
    "onset": 0.0021,
    "lufs": -14.6,
    "peak": -1
  },
  "sfx/react.lava": {
    "dur": 0.959773,
    "onset": 0.0012,
    "lufs": -15.4,
    "peak": -1
  },
  "sfx/react.pierce": {
    "dur": 0.506825,
    "onset": 0.0004,
    "lufs": -21.8,
    "peak": -1
  },
  "sfx/relic.dingshen": {
    "dur": 0.651247,
    "onset": 0.0002,
    "lufs": -16.3,
    "peak": -1
  },
  "sfx/relic.drum": {
    "dur": 1.100023,
    "onset": 0.0008,
    "lufs": -16.6,
    "peak": -1
  },
  "sfx/relic.dundi": {
    "dur": 0.881451,
    "onset": 0.0024,
    "lufs": -14,
    "peak": -1
  },
  "sfx/relic.gu": {
    "dur": 0.610227,
    "onset": 0.0005,
    "lufs": -19.9,
    "peak": -1
  },
  "sfx/relic.huiling": {
    "dur": 1.483265,
    "onset": 0.0014,
    "lufs": -12,
    "peak": -2.3
  },
  "sfx/relic.icevase": {
    "dur": 1.010249,
    "onset": 0.0005,
    "lufs": -13.6,
    "peak": -1
  },
  "sfx/relic.incense": {
    "dur": 0.953537,
    "onset": 0.0008,
    "lufs": -17.5,
    "peak": -1
  },
  "sfx/relic.jadedragon": {
    "dur": 1.186735,
    "onset": 0.0022,
    "lufs": -15.8,
    "peak": -1
  },
  "sfx/relic.mirror": {
    "dur": 1.059433,
    "onset": 0.0007,
    "lufs": -12,
    "peak": -6
  },
  "sfx/relic.pouch": {
    "dur": 0.700023,
    "onset": 0.002,
    "lufs": -19.5,
    "peak": -1
  },
  "sfx/relic.stormfeather": {
    "dur": 0.571837,
    "onset": 0.0007,
    "lufs": -18.1,
    "peak": -1
  },
  "sfx/relic.umbrella": {
    "dur": 0.352358,
    "onset": 0.0002,
    "lufs": -19.1,
    "peak": -1
  },
  "sfx/relic.yinlei": {
    "dur": 1.229819,
    "onset": 0.0011,
    "lufs": -15.2,
    "peak": -1
  },
  "sfx/relic.zhuo": {
    "dur": 0.673492,
    "onset": 0.0014,
    "lufs": -16.3,
    "peak": -1
  },
  "sfx/relic.zhuo.land": {
    "dur": 0.900023,
    "onset": 0.0002,
    "lufs": -19.2,
    "peak": -1
  },
  "sfx/sand.burst": {
    "dur": 1.307732,
    "onset": 0.0003,
    "lufs": -18.8,
    "peak": -1
  },
  "sfx/sanjian.chop": {
    "dur": 1.100023,
    "onset": 0.004,
    "lufs": -19.7,
    "peak": -1
  },
  "sfx/sanjian.rift": {
    "dur": 1.199229,
    "onset": 0.0003,
    "lufs": -13.7,
    "peak": -1
  },
  "sfx/sanjian.sweep.1": {
    "dur": 1.01288,
    "onset": 0.0017,
    "lufs": -23,
    "peak": -1
  },
  "sfx/sanjian.sweep.2": {
    "dur": 1.048844,
    "onset": 0.0007,
    "lufs": -13.5,
    "peak": -1
  },
  "sfx/skill": {
    "dur": 3.200023,
    "onset": 0.0007,
    "lufs": -15.3,
    "peak": -1
  },
  "sfx/sword.altars": {
    "dur": 2.015896,
    "onset": 0.0015,
    "lufs": -12,
    "peak": -2
  },
  "sfx/sword.cut.1": {
    "dur": 0.833946,
    "onset": 0.001,
    "lufs": -16,
    "peak": -1
  },
  "sfx/sword.cut.2": {
    "dur": 0.989977,
    "onset": 0.0007,
    "lufs": -15.5,
    "peak": -1
  },
  "sfx/sword.sweep": {
    "dur": 1.423424,
    "onset": 0.0011,
    "lufs": -23.2,
    "peak": -1
  },
  "sfx/sword.warn.1": {
    "dur": 0.977188,
    "onset": 0.0016,
    "lufs": -12,
    "peak": -1.5
  },
  "sfx/sword.warn.2": {
    "dur": 0.935329,
    "onset": 0.0018,
    "lufs": -12,
    "peak": -3.6
  },
  "sfx/sword.warn.3": {
    "dur": 1.034807,
    "onset": 0.0025,
    "lufs": -12,
    "peak": -2.8
  },
  "sfx/tech.breath": {
    "dur": 1.979932,
    "onset": 0.0022,
    "lufs": -14.8,
    "peak": -1
  },
  "sfx/tech.learn": {
    "dur": 2.616281,
    "onset": 0.0021,
    "lufs": -13.6,
    "peak": -1
  },
  "sfx/tech.lotus": {
    "dur": 3.000023,
    "onset": 0.0017,
    "lufs": -12.2,
    "peak": -1
  },
  "sfx/tech.reflect": {
    "dur": 0.800023,
    "onset": 0.0002,
    "lufs": -19.4,
    "peak": -1
  },
  "sfx/tech.shatter": {
    "dur": 1.048844,
    "onset": 0.0002,
    "lufs": -21.4,
    "peak": -1
  },
  "sfx/tech.spread": {
    "dur": 0.540091,
    "onset": 0.001,
    "lufs": -18,
    "peak": -1
  },
  "sfx/tech.thunder": {
    "dur": 1.180045,
    "onset": 0.0008,
    "lufs": -15.3,
    "peak": -1
  },
  "sfx/tech.thunder.warn": {
    "dur": 0.650023,
    "onset": 0.0029,
    "lufs": -16.3,
    "peak": -1
  },
  "sfx/ten.bolt": {
    "dur": 1.700023,
    "onset": 0.0009,
    "lufs": -14.7,
    "peak": -1
  },
  "sfx/ten.bolt.warn": {
    "dur": 0.8,
    "onset": 0.003,
    "lufs": -12.9,
    "peak": -1
  },
  "sfx/ten.gold": {
    "dur": 2.536213,
    "onset": 0.0022,
    "lufs": -12,
    "peak": -2.9
  },
  "sfx/ten.spawn": {
    "dur": 0.325986,
    "onset": 0.0005,
    "lufs": -22.7,
    "peak": -1
  },
  "sfx/ten.thunder.on": {
    "dur": 1.346803,
    "onset": 0.0008,
    "lufs": -12.3,
    "peak": -1
  },
  "sfx/ten.warn": {
    "dur": 1.6,
    "onset": 0.0005,
    "lufs": -18,
    "peak": -1
  },
  "sfx/ten.water": {
    "dur": 1.801111,
    "onset": 0.0022,
    "lufs": -12,
    "peak": -1.6
  },
  "sfx/tether.cut": {
    "dur": 0.445692,
    "onset": 0.0002,
    "lufs": -18.8,
    "peak": -1
  },
  "sfx/tether.on": {
    "dur": 0.500023,
    "onset": 0.0003,
    "lufs": -17,
    "peak": -1
  },
  "sfx/tianyan.gaze": {
    "dur": 1.49805,
    "onset": 0.0017,
    "lufs": -12,
    "peak": -1
  },
  "sfx/ui.buy": {
    "dur": 0.897982,
    "onset": 0.0012,
    "lufs": -22.2,
    "peak": -1
  },
  "sfx/ui.click": {
    "dur": 0.200023,
    "onset": 0.0008,
    "lufs": -19,
    "peak": -1
  },
  "sfx/ui.denied": {
    "dur": 0.363333,
    "onset": 0.0003,
    "lufs": -16.9,
    "peak": -1
  },
  "sfx/ui.levelup": {
    "dur": 1.800023,
    "onset": 0.001,
    "lufs": -13.3,
    "peak": -1
  },
  "sfx/ui.lock": {
    "dur": 0.240952,
    "onset": 0.0014,
    "lufs": -21.3,
    "peak": -1
  },
  "sfx/ui.ready": {
    "dur": 1.797982,
    "onset": 0.0006,
    "lufs": -15.1,
    "peak": -1
  },
  "sfx/ui.reroll": {
    "dur": 0.785737,
    "onset": 0.0016,
    "lufs": -15.7,
    "peak": -1
  },
  "sfx/wanya.boom": {
    "dur": 0.718345,
    "onset": 0.0019,
    "lufs": -14.8,
    "peak": -1
  },
  "sfx/wanya.pour": {
    "dur": 0.7022,
    "onset": 0.0016,
    "lufs": -18.7,
    "peak": -1
  },
  "sfx/wave.end": {
    "dur": 2.72288,
    "onset": 0.0002,
    "lufs": -13.2,
    "peak": -1
  },
  "sfx/wave.start": {
    "dur": 1.399025,
    "onset": 0.0009,
    "lufs": -16,
    "peak": -1
  },
  "sfx/wind.dash": {
    "dur": 1.346644,
    "onset": 0.0021,
    "lufs": -17.8,
    "peak": -1
  },
  "sfx/wind.warn": {
    "dur": 1.348458,
    "onset": 0.0001,
    "lufs": -14.3,
    "peak": -1
  },
  "sfx/wuhuo.fan": {
    "dur": 1.000023,
    "onset": 0.0014,
    "lufs": -15.6,
    "peak": -1
  },
  "sfx/wuhuo.scorch": {
    "dur": 0.952902,
    "onset": 0.001,
    "lufs": -17.8,
    "peak": -1
  },
  "sfx/xiangmo.land": {
    "dur": 0.773855,
    "onset": 0.0002,
    "lufs": -20.5,
    "peak": -1
  },
  "sfx/xiaotian.bite": {
    "dur": 0.401429,
    "onset": 0.0002,
    "lufs": -17.6,
    "peak": -1
  },
  "sfx/xiaotian.dash": {
    "dur": 0.26415,
    "onset": 0.0015,
    "lufs": -17.6,
    "peak": -1
  },
  "sfx/xiaotian.evolve": {
    "dur": 2.542744,
    "onset": 0.0009,
    "lufs": -12.5,
    "peak": -1
  },
  "sfx/xinghuang.block.1": {
    "dur": 0.597778,
    "onset": 0.0003,
    "lufs": -21.3,
    "peak": -1
  },
  "sfx/xinghuang.block.2": {
    "dur": 0.690045,
    "onset": 0.0003,
    "lufs": -21.3,
    "peak": -1
  },
  "sfx/xinghuang.break": {
    "dur": 1.308866,
    "onset": 0.0006,
    "lufs": -18.9,
    "peak": -1
  },
  "sfx/xinghuang.up": {
    "dur": 2.13576,
    "onset": 0.0012,
    "lufs": -14.3,
    "peak": -1
  },
  "sfx/xiuwei.light": {
    "dur": 1.377324,
    "onset": 0.0002,
    "lufs": -14.5,
    "peak": -1
  },
  "sfx/xiuwei.reset": {
    "dur": 2.00229,
    "onset": 0.0002,
    "lufs": -16.6,
    "peak": -1
  },
  "sfx/xuanyuan.freeze": {
    "dur": 1.120635,
    "onset": 0.0008,
    "lufs": -19.2,
    "peak": -1
  },
  "sfx/xuanyuan.pool": {
    "dur": 1.189229,
    "onset": 0.0012,
    "lufs": -15.5,
    "peak": -1
  },
  "sfx/xuanyuan.vortex": {
    "dur": 1.300023,
    "onset": 0.0019,
    "lufs": -14.9,
    "peak": -1
  },
  "sfx/yanguang.erupt": {
    "dur": 0.847596,
    "onset": 0.0007,
    "lufs": -16.1,
    "peak": -1
  },
  "sfx/yanguang.plant": {
    "dur": 0.496145,
    "onset": 0.0002,
    "lufs": -20.1,
    "peak": -1
  },
  "sfx/yao.appear": {
    "dur": 1.059478,
    "onset": 0.0004,
    "lufs": -12,
    "peak": -3.8
  },
  "sfx/yao.banners": {
    "dur": 1.267846,
    "onset": 0.0011,
    "lufs": -17.9,
    "peak": -1
  },
  "sfx/yao.bell": {
    "dur": 2.669705,
    "onset": 0.0011,
    "lufs": -12,
    "peak": -1.4
  },
  "sfx/yao.burst": {
    "dur": 1.571474,
    "onset": 0.0016,
    "lufs": -13.5,
    "peak": -1
  },
  "sfx/yao.burst.warn": {
    "dur": 1.3,
    "onset": 0.0154,
    "lufs": -12.3,
    "peak": -1
  },
  "sfx/yao.curse": {
    "dur": 1.111746,
    "onset": 0.0011,
    "lufs": -12.6,
    "peak": -1
  },
  "sfx/yao.flag": {
    "dur": 0.408005,
    "onset": 0.0001,
    "lufs": -21.9,
    "peak": -1
  },
  "sfx/yao.formations": {
    "dur": 2.536213,
    "onset": 0.0041,
    "lufs": -12,
    "peak": -1.2
  },
  "sfx/yao.intro": {
    "dur": 3.400023,
    "onset": 0.0034,
    "lufs": -12,
    "peak": -2
  },
  "sfx/yao.line": {
    "dur": 0.700023,
    "onset": 0.0009,
    "lufs": -14.8,
    "peak": -1
  },
  "sfx/yao.linebreak": {
    "dur": 0.376054,
    "onset": 0.0003,
    "lufs": -21.5,
    "peak": -1
  },
  "sfx/yao.phase": {
    "dur": 3.000023,
    "onset": 0.0005,
    "lufs": -13.3,
    "peak": -1
  },
  "sfx/yao.root": {
    "dur": 0.861224,
    "onset": 0.001,
    "lufs": -17,
    "peak": -1
  },
  "sfx/yao.straw": {
    "dur": 1.116145,
    "onset": 0.0012,
    "lufs": -21.1,
    "peak": -1
  },
  "sfx/yao.vanish": {
    "dur": 1.1,
    "onset": 0.0013,
    "lufs": -15,
    "peak": -1
  },
  "sfx/yao.wave": {
    "dur": 1.797982,
    "onset": 0.0004,
    "lufs": -13.9,
    "peak": -1
  },
  "sfx/yinyang.beam": {
    "dur": 0.799048,
    "onset": 0.0015,
    "lufs": -12,
    "peak": -2.6
  },
  "sfx/yinyang.freeze": {
    "dur": 1.059478,
    "onset": 0.0004,
    "lufs": -13,
    "peak": -1
  },
  "sfx/zanxin.drill": {
    "dur": 0.827211,
    "onset": 0.0009,
    "lufs": -14.8,
    "peak": -1
  },
  "sfx/zhanxian.fly.1": {
    "dur": 0.081723,
    "onset": 0.0011,
    "lufs": -15.3,
    "peak": -1
  },
  "sfx/zhanxian.fly.2": {
    "dur": 0.062971,
    "onset": 0.0017,
    "lufs": -15.1,
    "peak": -1
  },
  "sfx/zhanxian.fly.3": {
    "dur": 0.084762,
    "onset": 0.0016,
    "lufs": -12,
    "peak": -2.2
  },
  "sfx/zhanxian.fly.4": {
    "dur": 0.080272,
    "onset": 0.0015,
    "lufs": -13.2,
    "peak": -1
  },
  "sfx/zhanxian.hit.1": {
    "dur": 0.297868,
    "onset": 0.0009,
    "lufs": -18.1,
    "peak": -1
  },
  "sfx/zhanxian.hit.2": {
    "dur": 0.398073,
    "onset": 0.0012,
    "lufs": -18.1,
    "peak": -1
  },
  "sfx/zhanxian.hit.3": {
    "dur": 0.449524,
    "onset": 0.0008,
    "lufs": -16,
    "peak": -1
  },
  "sfx/zone.crack": {
    "dur": 1.07381,
    "onset": 0.0008,
    "lufs": -14.8,
    "peak": -1
  },
  "sfx/zone.fire": {
    "dur": 0.811202,
    "onset": 0.0009,
    "lufs": -21.9,
    "peak": -1
  },
  "sfx/zone.frost": {
    "dur": 1.650476,
    "onset": 0.0008,
    "lufs": -19.6,
    "peak": -1
  },
  "sfx/zx.arc.1": {
    "dur": 1.067891,
    "onset": 0.0016,
    "lufs": -19.7,
    "peak": -1
  },
  "sfx/zx.arc.2": {
    "dur": 1.067891,
    "onset": 0.0007,
    "lufs": -12,
    "peak": -1.6
  },
  "sfx/zx.cell.1": {
    "dur": 0.70712,
    "onset": 0.0003,
    "lufs": -16.9,
    "peak": -1
  },
  "sfx/zx.cell.2": {
    "dur": 0.70712,
    "onset": 0.0004,
    "lufs": -18.2,
    "peak": -1
  },
  "sfx/zx.close": {
    "dur": 1.7622,
    "onset": 0.0005,
    "lufs": -17.1,
    "peak": -1
  },
  "sfx/zx.close.warn": {
    "dur": 1.427029,
    "onset": 0.0078,
    "lufs": -12,
    "peak": -2
  },
  "sfx/zx.dash": {
    "dur": 0.764308,
    "onset": 0.0021,
    "lufs": -19.1,
    "peak": -1
  },
  "sfx/zx.dash.warn": {
    "dur": 0.617347,
    "onset": 0.0263,
    "lufs": -17.9,
    "peak": -1
  },
  "sfx/zx.intro": {
    "dur": 3.600023,
    "onset": 0.0021,
    "lufs": -12.7,
    "peak": -1
  },
  "sfx/zx.lane": {
    "dur": 0.832472,
    "onset": 0.0014,
    "lufs": -17,
    "peak": -1
  },
  "sfx/zx.phase": {
    "dur": 3.178413,
    "onset": 0.0003,
    "lufs": -12,
    "peak": -1.2
  },
  "sfx/zx.rain.warn": {
    "dur": 1.797982,
    "onset": 0.0003,
    "lufs": -24.3,
    "peak": -1
  },
  "sfx/zx.ring.warn": {
    "dur": 1.259955,
    "onset": 0.0014,
    "lufs": -17.2,
    "peak": -1
  },
  "sfx/zx.rush.warn": {
    "dur": 1.427029,
    "onset": 0.0002,
    "lufs": -14.5,
    "peak": -1
  },
  "sfx/zx.split": {
    "dur": 1.571383,
    "onset": 0.0009,
    "lufs": -12,
    "peak": -1.8
  },
  "sfx/zx.wall": {
    "dur": 0.974558,
    "onset": 0.0003,
    "lufs": -21.3,
    "peak": -1
  },
  "sfx/zx.walls": {
    "dur": 1.6,
    "onset": 0.0036,
    "lufs": -12,
    "peak": -3.6
  }
};
