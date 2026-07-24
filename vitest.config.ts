import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const availableTestWorkers = Math.max(
  1,
  (typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length) - 1,
);

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
  server: {
    fs: {
      // Runtime workflow tests load generated ESM modules from the OS temp root.
      allow: [configDir, os.tmpdir()],
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
    // 全量套件包含 SQLite、子进程和大文本用例；高核心机器默认 fork 过多会饿死 worker RPC。
    maxWorkers: Math.min(8, availableTestWorkers),
    minWorkers: 1,
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
