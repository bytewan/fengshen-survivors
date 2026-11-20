// 开局时把「打着打着才第一次用到」的着色器先编译好（docs/perf.md）：着色器第一次用到时要当场编译、链接，
// 电脑上几毫秒，低端手机上几十毫秒——正打着的时候突然一顿。量下来局里会晚到的有三个：
//   - 预警层（warn-fx.ts）的 AlphaFilter：第一次有敌人出招预警的那一刻；
//   - 顶点多、不进批处理的 Graphics（Pixi 超过约 200 个顶点的 Graphics 走另一套着色器）：第一次有大的线、弧的时候。
//   - 粒子层（ParticleContainer：火星、灵石、影子……）：开打后第一粒火星出来的时候。
// 这里往一张 4×4 的离屏贴图里各画一次（画面上看不到），着色器就在开局载入时编好了，跟着这个渲染器一直用到这一局结束。
import { AlphaFilter, Container, Graphics, Particle, ParticleContainer, RenderTexture, Sprite, Texture, type Renderer } from 'pixi.js';

export function warmShaders(renderer: Renderer) {
  const rt = RenderTexture.create({ width: 4, height: 4 });
  const root = new Container();
  const filtered = new Container();
  filtered.filters = [new AlphaFilter({ alpha: 1 })];
  const dot = new Sprite(Texture.WHITE);
  dot.setSize(2, 2);
  filtered.addChild(dot);
  const big = new Graphics();
  big.context.batchMode = 'no-batch';
  big.rect(0, 0, 2, 2).fill({ color: 0xffffff });
  const parts = new ParticleContainer({ texture: Texture.WHITE });
  parts.addParticle(new Particle({ texture: Texture.WHITE, x: 1, y: 1 }));
  root.addChild(filtered, big, parts);
  try {
    renderer.render({ container: root, target: rt, clear: true });
  } finally {
    root.destroy({ children: true });
    rt.destroy(true);
  }
}
