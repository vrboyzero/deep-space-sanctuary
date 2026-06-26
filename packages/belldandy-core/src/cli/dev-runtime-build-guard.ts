import { ensureFreshWorkspaceBuildsForDevRuntime } from "./workspace-build-guard.js";

/**
 * 开发态直接运行 TS 入口时，必须在加载主 gateway 模块之前完成旧 dist 预检。
 */
export function ensureFreshWorkspaceBuildsBeforeGatewayModuleLoad(): void {
  const guard = ensureFreshWorkspaceBuildsForDevRuntime();
  if (!guard.ok) {
    throw new Error(guard.reason ?? "Workspace package build guard failed.");
  }
}
