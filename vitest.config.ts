import path from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const configDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  resolve: {
    alias: {
      "@": path.resolve(configDir, "GW", "src"),
    },
  },
  test: {
    exclude: [
      ...configDefaults.exclude,
      "**/.belldandy/**",
      "**/artifacts/**",
      "GW/**",
      "**/openclaw/**",
      "Star_Weaver_Engine/**",
      "**/UI-TARS-desktop-main/**",
      // Root-level temp/reference mirrors can contain tens of thousands of files
      // and make targeted discovery time out on Windows before test execution starts.
      "tmp/**",
      ".tmp/**",
      ".tmp-codex/**",
      ".playwright-mcp/**",
    ],
    // 使用 Node 环境以支持 node:sqlite 等内置模块
    environment: "node",
    // 使用 forks 而非 threads，node:sqlite 在 worker_threads 中可能有问题
    pool: "forks",
    deps: {
      interopDefault: true,
    },
    server: {
      deps: {
        inline: [],
        external: ["node:sqlite"],
      },
    },
  },
});
