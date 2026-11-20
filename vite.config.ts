// 开发服务器配置：主目录下并行改造用的 git worktree（.wt/）不进监听，
// 否则别的分支里一改文件，主目录开着的游戏页面就会被刷新。
// 注意用「本配置文件所在目录」解析出的绝对路径，不能写成 '**/.wt/**'——那样在 worktree 里起服务器时，
// worktree 自己的路径也带 /.wt/，整个项目都会被忽略、改了代码也拿不到（2026-11-09 踩过）。
//
// 生产构建（npm run build → dist/；部署、包体积见 docs/deploy.md）：
// - 分包靠代码里的 import()：首包只有标题页那一层（标题、选角、设置、致谢）；战斗（连带 PixiJS）、联机大厅（连带网络层和整套模拟）、
//   过场、实验页、pixelfx 的每个特效都按需下载（src/main.ts、src/game/title.ts、src/game/feel.ts）。
// - 不手工分 PixiJS 的包（rolldown 的 codeSplitting.groups）：试过，Pixi 的入口把所有渲染器都 re-export 了，
//   一分组就把只该按需下的 WebGPU、Canvas 渲染器连同 Vite 的预载小工具一起拽进首包。自动分包按实际用到的切，结果是对的。
// - 载入清单（tools/vite-load-plan.ts）：把首屏和后台预载各组的文件、字节数写进 index.html，首次载入画面和预载进度按它算。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { loadPlan } from './tools/vite-load-plan.ts';
import { pixiRendererOnly } from './tools/pixi-renderer-only.ts';

const wt = fileURLToPath(new URL('./.wt', import.meta.url));
/** PixiJS 和它依赖的几个小库（package.json 的 dependencies；它们也要进 pixi 那一包，不然会被打包器塞进渲染器的包里）。 */
const PIXI_PKGS = /node_modules[\\/](pixi\.js|@pixi[\\/]colord|@xmldom[\\/]xmldom|earcut|eventemitter3|gifuct-js|ismobilejs|parse-svg-path|tiny-lru)[\\/]/;
/** PixiJS 的 WebGPU、Canvas 渲染器独有的模块（tools/pixi-renderer-only.ts）。 */
const rendererOnly = pixiRendererOnly(path.dirname(fileURLToPath(import.meta.resolve('pixi.js'))));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), ['GAME_', 'VITE_']);
  const requestedBase = process.env.GAME_BASE_PATH ?? env.GAME_BASE_PATH ?? '/';
  if (!/^\/(?:[A-Za-z0-9._-]+\/)*$/.test(requestedBase)) {
    throw new Error('GAME_BASE_PATH 必须是以 / 开始和结束的站点路径，例如 /fengshen-survivors/');
  }
  const relay = process.env.VITE_RELAY_URL ?? env.VITE_RELAY_URL;
  if (relay) {
    const url = new URL(relay);
    if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash) {
      throw new Error('VITE_RELAY_URL 必须是完整的 ws:// 或 wss:// 地址，不包含凭证或片段');
    }
    if (requestedBase !== '/' && url.protocol !== 'wss:') {
      throw new Error('Pages 子目录部署的中继必须使用 wss://');
    }
  }
  return {
    base: requestedBase,
    plugins: [loadPlan()],
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              // Vite 的预载小工具单独一包（优先级最高）：不然它会被下面 pixi 那一组当作依赖带走，入口为了它整包引 PixiJS
              { name: 'preload-helper', test: /vite[\\/]preload-helper|^\0vite\/preload-helper/, priority: 30 },
              // PixiJS 除了 WebGPU、Canvas 两个渲染器独有的模块以外归一包（2026-11-12）：两个渲染器只在 autoDetectRenderer 里按需 import()，
              // 游戏总是走 WebGL（Pixi 的默认偏好），它们就不再被下载。不分组时打包器把 Pixi 的公共部分并进了 WebGPU 那一包，整包都得下。
              // 不递归收依赖：Pixi 的汇总导出（index.mjs）静态引了两个渲染器，递归收会把它们也收进来
              { name: 'pixi', test: (id: string) => PIXI_PKGS.test(id) && !rendererOnly.has(id.split('?')[0]), priority: 10, includeDependenciesRecursively: false },
            ],
          },
        },
      },
    },
    server: {
      watch: { ignored: [`${wt}/**`] },
    },
  };
});
