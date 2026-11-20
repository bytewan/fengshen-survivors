/** 下载和初始化期间立即显示，使用系统字体，不依赖尚未到达的字体文件。 */
export function showLoadingStatus(message: string, options: { canReturn?: boolean } = {}) {
  const root = document.createElement('div');
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  root.dataset.loadingStatus = '';
  root.style.cssText = 'position:fixed;inset:0;z-index:40;display:grid;place-content:center;gap:12px;text-align:center;padding:24px;background:rgba(26,21,32,.92);color:#f2e8d5;font:16px/1.6 system-ui,serif';
  const text = document.createElement('div');
  text.textContent = message;
  const detail = document.createElement('div');
  detail.style.cssText = 'font-size:13px;color:#c9bca7';
  detail.textContent = '首次打开需要加载资源';
  root.append(text, detail);
  let returned = false;
  let returnNow = () => {};
  const cancelled = new Promise<void>(resolve => { returnNow = resolve; });
  const actions = document.createElement('div');
  actions.style.cssText = 'display:none;justify-content:center;gap:16px;margin-top:12px';
  const button = (label: string, action: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = 'font:inherit;color:#f2e8d5;background:#4c414a;border:1px solid #c9bca7;border-radius:4px;padding:10px 24px;cursor:pointer;min-height:44px';
    b.onclick = action;
    actions.appendChild(b);
  };
  if (options.canReturn) button('返回', () => { returned = true; returnNow(); });
  button('刷新', () => location.reload());
  root.appendChild(actions);
  document.body.appendChild(root);
  const slow = setTimeout(() => {
    detail.textContent = '加载较慢，请稍候；如果长时间没有变化，可刷新重试';
    actions.style.display = 'flex';
  }, 8000);
  return {
    get returned() { return returned; },
    /** import() 无法中止；超时后退出等待，晚到的模块不再自动打开大厅。 */
    async waitFor<T>(task: Promise<T>, timeoutMs = 20000): Promise<T> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          task,
          cancelled.then(() => { throw new Error('已返回'); }),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('载入超时')), timeoutMs); }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
    close() { clearTimeout(slow); root.remove(); },
  };
}
