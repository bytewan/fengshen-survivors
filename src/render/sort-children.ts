// 按 zIndex 排前后（Pixi 的 Container.sortChildren）换成插入排序（docs/perf.md）。
// 角色层每帧都要按 y 重排（几百个精灵，每帧只挪动一点点）：原生的 Array.sort 每次都分配临时数组，满场时是垃圾回收的大头之一；
// 插入排序对「差不多已经排好」的数组只要走一遍、不分配内存。结果和原来完全一样：都是稳定排序（zIndex 相同的保持原来的先后）。
// 在 stage.ts 里引入一次，对所有容器生效。
import { Container } from 'pixi.js';

const proto = Container.prototype as unknown as { sortChildren(this: Container): void; __insertionSort?: boolean };
if (!proto.__insertionSort) {
  proto.__insertionSort = true;
  proto.sortChildren = function (this: Container) {
    if (!this.sortDirty) return;
    this.sortDirty = false;
    const a = this.children;
    for (let i = 1; i < a.length; i++) {
      const c = a[i];
      const z = c.zIndex;
      let j = i - 1;
      if (a[j].zIndex <= z) continue;
      while (j >= 0 && a[j].zIndex > z) {
        a[j + 1] = a[j];
        j--;
      }
      a[j + 1] = c;
    }
  };
}
