/**
 * WebChat 的第三方依赖由本地 hash manifest 装载。模块入口必须等待它完成，避免
 * 在 CDN 失败或供应链替换时静默降级为不受约束的全局对象。
 */
export async function awaitWebAssetsReady() {
  const ready = window.__BELLDANDY_WEB_ASSETS_READY__;
  if (!ready || typeof ready.then !== "function") {
    throw new Error("Required local Web assets were not initialized.");
  }
  await ready;

  const missing = [
    ["DOMPurify", window.DOMPurify],
    ["marked", window.marked],
    ["dagre", window.dagre],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Required local Web assets are unavailable: ${missing.join(", ")}`);
  }
}
