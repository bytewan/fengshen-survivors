// PixiJS 的 WebGPU、Canvas 两个渲染器「独有」的模块（vite.config.ts 的分包用，2026-11-12 瘦身）。
// 游戏总是走 WebGL（Pixi 的默认偏好：autoDetectRenderer 先试 WebGL），这两个渲染器只在 autoDetectRenderer 里按需 import()。
// 不分组时打包器把 Pixi 的公共部分并进了 WebGPU 那一包（327 KB），进局前整包都得下；分组时又不能简单地按 gpu/ 目录排除——
// 公共部分（Shader、Filter、Graphics……）静态引用了 gpu/ 下的 GpuProgram、BindGroup 这些。
// 所以这里按 import 关系算：从两个渲染器的入口出发能走到、而从「渲染器目录以外的模块」出发走不到的，才是它们独有的。
// 只认静态的 import / export ... from（动态 import() 不算依赖）；index.mjs 这类汇总导出的文件不算起点（它把 gpu/ 全导出了）。
import fs from 'node:fs';
import path from 'node:path';

const STATIC = /(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]|(?:^|[\s;])import\s*['"](\.[^'"]+)['"]/g;

export function pixiRendererOnly(lib: string): Set<string> {
  const deps = new Map<string, string[]>();
  const all: string[] = [];
  const walkDir = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walkDir(p);
      else if (e.name.endsWith('.mjs')) all.push(p);
    }
  };
  walkDir(lib);
  const depsOf = (f: string) => {
    let d = deps.get(f);
    if (d) return d;
    const src = fs.readFileSync(f, 'utf8');
    d = [];
    for (const m of src.matchAll(STATIC)) d.push(path.resolve(path.dirname(f), m[1] ?? m[2]));
    deps.set(f, d);
    return d;
  };
  const closure = (starts: string[]) => {
    const seen = new Set<string>();
    const stack = [...starts];
    while (stack.length) {
      const f = stack.pop()!;
      if (seen.has(f) || !fs.existsSync(f)) continue;
      seen.add(f);
      stack.push(...depsOf(f));
    }
    return seen;
  };
  const renderer = /[\\/]rendering[\\/]renderers[\\/](gpu|canvas)[\\/]/;
  const own = closure([path.join(lib, 'rendering/renderers/gpu/WebGPURenderer.mjs'), path.join(lib, 'rendering/renderers/canvas/CanvasRenderer.mjs')]);
  const shared = closure(all.filter((f) => !renderer.test(f) && path.basename(f) !== 'index.mjs'));
  return new Set([...own].filter((f) => !shared.has(f)));
}
