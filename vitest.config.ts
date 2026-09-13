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
      // Vitest 4 把默认 exclude 简化为仅 `**/node_modules/**` 与 `**/.git/**`。
      // 这里补回 v3 时代默认排除的构建产物与工具配置，避免把 dist/ 下
      // 编译后的测试副本再跑一遍（当前约 571 个重复文件）。
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*",
      "**/.belldandy/**",
      "**/artifacts/**",
      "GW/**",
      "**/openclaw/**",
      "Star_Weaver_Engine/**",
      "**/UI-TARS-desktop-main/**",
      // `参考项目/` 是本地参考镜像（已 gitignore、无跟踪文件），内含 7000+ 个
      // 无关测试文件，不排除会让本地全量发现阶段耗时暴涨。
      "参考项目/**",
      "Void/**",
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
    // 全量套件包含 SQLite、Gateway 子进程和大文本用例；高核心机器 fork 过多会饿死 worker RPC。
    maxWorkers: Math.min(2, availableTestWorkers),
    // Vitest 4 移除了 minWorkers，非 watch 模式下由 Vitest 自行决定。
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
