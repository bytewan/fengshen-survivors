// 载入清单（2026-11-12，docs/deploy.md「首次载入与后台预载」）：生产构建时算出「打开页面要下哪些文件、各多大」和
// 「标题页出来之后按什么顺序在后台下哪些文件」，写进 index.html 的 window.__FS_LOAD。
// - index.html 里的首次载入画面（#boot）按第 0 组（首屏：入口脚本连带它静态引用的各包、标题页的两份首屏字体）已经下完的字节推进度条；
// - src/game/preload.ts 按第 1 组起的各组预载、在标题页角落和「回响」按钮上画进度。
// 进度都是真的：浏览器每下完一个文件（Resource Timing），就把清单里这个文件的字节记为已到。
// 开发服务器上模块不打包、事先算不出来：注入 null，两处各自退回粗略的算法（见 preload.ts、index.html）。
//
// 分组的键和 src/game/preload.ts 的 STEPS 一一对应（改一处要改另一处）。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { Plugin, ResolvedConfig } from 'vite';

/** 后台预载的各组（顺序就是下载顺序）：模块（项目里的路径）与 public/ 下的文件。 */
export const LOAD_GROUPS: { key: string; modules?: string[]; files?: string[] }[] = [
  { key: 'select', modules: ['src/game/select.ts', 'src/game/jie-pick.ts'] },
  { key: 'ui-font', files: ['fonts/lxgw-wenkai-medium-subset.woff2', 'fonts/ma-shan-zheng-subset.woff2'] },
  { key: 'battle', modules: ['src/game/feel.ts'], files: ['fonts/fusion-pixel-12-zh_hans.woff2'] },
  { key: 'lobby', modules: ['src/game/lobby.ts'] },
  { key: 'more', modules: ['src/game/xiuwei.ts', 'src/game/codex.ts'] },
];
/** 首屏要等的 public/ 文件（index.html 里预载的两份首屏字体）。 */
const BOOT_FILES = ['fonts/ma-shan-zheng-title.woff2', 'fonts/lxgw-wenkai-medium-title.woff2'];

export interface LoadPlan {
  /** 分组的键：下标 0 是首屏，1 起是 LOAD_GROUPS。 */
  groups: string[];
  /** 网址路径 → [传输字节数（脚本按 gzip 估）, 第几组]。 */
  files: Record<string, [number, number]>;
}

interface ChunkLike {
  type: 'chunk' | 'asset';
  fileName: string;
  isEntry?: boolean;
  facadeModuleId?: string | null;
  imports?: string[];
  code?: string;
  source?: string | Uint8Array;
  viteMetadata?: { importedCss?: Set<string> };
}

export function loadPlan(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'fs-load-plan',
    configResolved(c) {
      config = c;
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        let plan: LoadPlan | null = null;
        if (ctx.bundle) plan = build(ctx.bundle as unknown as Record<string, ChunkLike>, config);
        const tag = `<script>window.__FS_LOAD = ${JSON.stringify(plan)};</script>`;
        // 放在 <head> 一开头：#boot 后面那段脚本读它
        return html.replace(/<head>/, `<head>\n    ${tag}`);
      },
    },
  };
}

function build(bundle: Record<string, ChunkLike>, config: ResolvedConfig): LoadPlan {
  const base = config.base.endsWith('/') ? config.base : `${config.base}/`;
  const files: LoadPlan['files'] = {};
  // 字节数按「传输」算：脚本、样式按 gzip 估（服务器都开着压缩，docs/deploy.md），这样进度条走的快慢和实际下载的时间一致；字体本来就是压缩过的，按原样
  const sizeOf = (c: ChunkLike) => {
    const raw = c.type === 'chunk' ? (c.code ?? '') : (c.source ?? '');
    return /\.(js|css)$/.test(c.fileName) ? zlib.gzipSync(raw, { level: 6 }).byteLength : typeof raw === 'string' ? Buffer.byteLength(raw) : raw.byteLength;
  };
  const add = (fileName: string, bytes: number, g: number) => {
    const url = base + fileName;
    if (!(url in files)) files[url] = [bytes, g];
  };
  /** 一个包连带它静态引用的各包（和它们的样式）。 */
  const closure = (start: string, g: number) => {
    const stack = [start];
    while (stack.length) {
      const f = stack.pop()!;
      const c = bundle[f];
      if (!c || base + f in files) continue;
      add(f, sizeOf(c), g);
      for (const css of c.viteMetadata?.importedCss ?? []) if (bundle[css]) add(css, sizeOf(bundle[css]), g);
      stack.push(...(c.imports ?? []));
    }
  };
  const pub = (rel: string, g: number) => {
    const p = path.join(config.publicDir, rel);
    if (fs.existsSync(p)) add(rel, fs.statSync(p).size, g);
  };
  for (const c of Object.values(bundle)) if (c.type === 'chunk' && c.isEntry) closure(c.fileName, 0);
  BOOT_FILES.forEach((f) => pub(f, 0));
  const root = config.root;
  LOAD_GROUPS.forEach((grp, i) => {
    for (const m of grp.modules ?? []) {
      const abs = path.resolve(root, m);
      const c = Object.values(bundle).find((x) => x.type === 'chunk' && x.facadeModuleId === abs);
      if (c) closure(c.fileName, i + 1);
      else config.logger.warn(`[fs-load-plan] 找不到 ${m} 的包（预载清单里少了这一项）`);
    }
    for (const f of grp.files ?? []) pub(f, i + 1);
  });
  return { groups: ['boot', ...LOAD_GROUPS.map((g) => g.key)], files };
}
