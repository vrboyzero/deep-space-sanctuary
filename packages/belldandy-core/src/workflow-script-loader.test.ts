import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  registerBuiltinWorkflow,
  getBuiltinWorkflow,
  listBuiltinWorkflows,
  clearBuiltinWorkflows,
} from "./workflow-builtin-registry.js";
import {
  scanInlineScriptSafety,
  loadWorkflowScript,
  WorkflowScriptLoadError,
} from "./workflow-script-loader.js";
import type { WorkflowExecutionPolicy } from "./workflow-execution-policy.js";

function createWorkflowPolicy(root: string, overrides: Partial<WorkflowExecutionPolicy> = {}): WorkflowExecutionPolicy {
  return {
    workflowRoot: root,
    allowInline: false,
    allowLegacyFiles: true,
    approvedFileHashes: new Map(),
    maxFileBytes: 1024 * 1024,
    ...overrides,
  };
}

describe("workflow script runtime dependency contract", () => {
  it("将 TypeScript 编译器声明为 core 的生产依赖", async () => {
    const packageJson = JSON.parse(
      await fs.readFile(new URL("../package.json", import.meta.url), "utf-8"),
    );

    expect(packageJson.dependencies).toMatchObject({
      esbuild: expect.any(String),
      typescript: expect.any(String),
    });
  });
});

describe("BUILTIN_WORKFLOWS registry", () => {
  beforeEach(() => clearBuiltinWorkflows());
  afterEach(() => clearBuiltinWorkflows());

  it("注册和查找 builtin workflow", () => {
    registerBuiltinWorkflow({
      name: "test-wf",
      description: "test",
      scriptHash: "hash-123",
      default: async () => "result",
    });
    const entry = getBuiltinWorkflow("test-wf");
    expect(entry).toBeDefined();
    expect(entry?.name).toBe("test-wf");
    expect(entry?.scriptHash).toBe("hash-123");
  });

  it("listBuiltinWorkflows 返回所有注册项", () => {
    registerBuiltinWorkflow({ name: "a", scriptHash: "h1", default: async () => "a" });
    registerBuiltinWorkflow({ name: "b", scriptHash: "h2", default: async () => "b" });
    const list = listBuiltinWorkflows();
    expect(list).toHaveLength(2);
    expect(list.map((e) => e.name).sort()).toEqual(["a", "b"]);
  });

  it("查找不存在的 builtin 返回 undefined", () => {
    expect(getBuiltinWorkflow("nonexistent")).toBeUndefined();
  });

  it("clearBuiltinWorkflows 清空注册表", () => {
    registerBuiltinWorkflow({ name: "x", scriptHash: "h", default: async () => "x" });
    clearBuiltinWorkflows();
    expect(listBuiltinWorkflows()).toHaveLength(0);
  });
});

describe("scanInlineScriptSafety", () => {
  it("安全脚本通过检查", () => {
    const code = `export default async function(ctx) { return ctx.agent("hello"); }`;
    const result = scanInlineScriptSafety(code);
    expect(result.safe).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("检测 import 语句", () => {
    const code = `import fs from "fs"; export default async function(ctx) { return "x"; }`;
    const result = scanInlineScriptSafety(code);
    expect(result.safe).toBe(false);
    expect(result.violations.some((v) => v.includes("import"))).toBe(true);
  });

  it("检测 require()", () => {
    const code = `const fs = require("fs"); export default async function(ctx) { return "x"; }`;
    const result = scanInlineScriptSafety(code);
    expect(result.safe).toBe(false);
    expect(result.violations.some((v) => v.includes("require"))).toBe(true);
  });

  it("检测 eval()", () => {
    const code = `export default async function(ctx) { return eval("1+1"); }`;
    const result = scanInlineScriptSafety(code);
    expect(result.safe).toBe(false);
    expect(result.violations.some((v) => v.includes("eval"))).toBe(true);
  });

  it("检测 process 全局对象", () => {
    const code = `export default async function(ctx) { return process.env.HOME; }`;
    const result = scanInlineScriptSafety(code);
    expect(result.safe).toBe(false);
    expect(result.violations.some((v) => v.includes("process"))).toBe(true);
  });

  it("检测 Date.now()", () => {
    const code = `export default async function(ctx) { return String(Date.now()); }`;
    const result = scanInlineScriptSafety(code);
    expect(result.safe).toBe(false);
    expect(result.violations.some((v) => v.includes("Date.now"))).toBe(true);
  });

  it("检测 Math.random()", () => {
    const code = `export default async function(ctx) { return String(Math.random()); }`;
    const result = scanInlineScriptSafety(code);
    expect(result.safe).toBe(false);
    expect(result.violations.some((v) => v.includes("Math.random"))).toBe(true);
  });

  it("检测动态 import()，即使 specifier 是拼接表达式", () => {
    const code = `export default async function(ctx) { const mod = await import("node:" + "f" + "s"); return String(mod); }`;
    const result = scanInlineScriptSafety(code);
    expect(result.safe).toBe(false);
    expect(result.violations.some((v) => v.includes("dynamic import"))).toBe(true);
  });

  it("不会把普通字符串字面量误判为受限模块访问", () => {
    const code = `export default async function(ctx) { return "child_process"; }`;
    const result = scanInlineScriptSafety(code);
    expect(result.safe).toBe(true);
    expect(result.violations).toHaveLength(0);
  });
});

describe("loadWorkflowScript", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-wf-loader-"));
    clearBuiltinWorkflows();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    clearBuiltinWorkflows();
  });

  it("builtin 模式加载成功", async () => {
    registerBuiltinWorkflow({
      name: "test-builtin",
      scriptHash: "builtin-hash",
      default: async () => "builtin result",
    });
    const script = await loadWorkflowScript({ kind: "builtin", name: "test-builtin" });
    expect(script.workflowName).toBe("test-builtin");
    expect(script.scriptHash).toBe("builtin-hash");
    expect(typeof script.default).toBe("function");
  });

  it("builtin 模式找不到时抛错", async () => {
    await expect(loadWorkflowScript({ kind: "builtin", name: "nonexistent" })).rejects.toThrow(WorkflowScriptLoadError);
  });

  it("file 模式加载 .mjs 文件", async () => {
    const filePath = path.join(tempDir, "test-wf.mjs");
    await fs.writeFile(filePath, `export default async function(ctx) { return "file result"; }\n`, "utf-8");
    const script = await loadWorkflowScript({ kind: "file", path: filePath }, { stateDir: tempDir, policy: createWorkflowPolicy(tempDir) });
    expect(script.workflowName).toBe("test-wf");
    expect(script.scriptHash).toMatch(/^[0-9a-f]{64}$/);
    const result = await script.default({} as any);
    expect(result).toBe("file result");
  });

  it("file 模式支持 slash-separated 绝对路径导入", async () => {
    const filePath = path.join(tempDir, "slash-path-wf.mjs");
    await fs.writeFile(filePath, `export default async function(ctx) { return "slash path result"; }\n`, "utf-8");
    const slashSeparatedPath = filePath.replace(/\\/g, "/");
    const script = await loadWorkflowScript({ kind: "file", path: slashSeparatedPath }, { stateDir: tempDir, policy: createWorkflowPolicy(tempDir) });
    const result = await script.default({} as any);
    expect(result).toBe("slash path result");
  });

  it("file 模式文件不存在抛错", async () => {
    await expect(
      loadWorkflowScript({ kind: "file", path: "/nonexistent/path.mjs" }, { policy: createWorkflowPolicy(tempDir) }),
    ).rejects.toThrow(WorkflowScriptLoadError);
  });

  it("file 模式不支持扩展名抛错", async () => {
    const filePath = path.join(tempDir, "test.txt");
    await fs.writeFile(filePath, "hello", "utf-8");
    await expect(
      loadWorkflowScript({ kind: "file", path: filePath }, { policy: createWorkflowPolicy(tempDir) }),
    ).rejects.toThrow(/Unsupported file extension/);
  });

  it("file 模式无 default export 抛错", async () => {
    const filePath = path.join(tempDir, "no-default.mjs");
    await fs.writeFile(filePath, `export const foo = "bar";\n`, "utf-8");
    await expect(
      loadWorkflowScript({ kind: "file", path: filePath }, { policy: createWorkflowPolicy(tempDir) }),
    ).rejects.toThrow(/default export/);
  });

  it("file 模式加载 .ts 文件（esbuild 编译）", async () => {
    const filePath = path.join(tempDir, "ts-wf.ts");
    await fs.writeFile(
      filePath,
      `export default async function(ctx: any): Promise<string> { return "ts result"; }\n`,
      "utf-8",
    );
    const script = await loadWorkflowScript({ kind: "file", path: filePath }, { stateDir: tempDir, policy: createWorkflowPolicy(tempDir) });
    expect(script.workflowName).toBe("ts-wf");
    const result = await script.default({} as any);
    expect(result).toBe("ts result");
  });

  it("inline 模式默认拒绝", async () => {
    await expect(
      loadWorkflowScript({ kind: "inline", code: `export default async function(ctx) { return "x"; }` }),
    ).rejects.toThrow(WorkflowScriptLoadError);
  });

  it("inline 模式显式启用后加载成功", async () => {
    const code = `export default async function(ctx) { return "inline result"; }`;
    const script = await loadWorkflowScript(
      { kind: "inline", code, name: "my-inline" },
      { stateDir: tempDir, policy: createWorkflowPolicy(tempDir, { allowInline: true }) },
    );
    expect(script.workflowName).toBe("my-inline");
    const result = await script.default({} as any);
    expect(result).toBe("inline result");
  });

  it("inline 模式安全检查失败时抛错", async () => {
    const code = `import fs from "fs"; export default async function(ctx) { return "x"; }`;
    await expect(
      loadWorkflowScript({ kind: "inline", code }, { stateDir: tempDir, policy: createWorkflowPolicy(tempDir, { allowInline: true }) }),
    ).rejects.toThrow(/safety check failed/);
  });

  it("file source 必须位于 canonical root 内且匹配批准内容哈希", async () => {
    const workflowsDir = path.join(tempDir, "workflows");
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-wf-outside-"));
    const content = `export default async function(ctx) { return "approved"; }\n`;
    const approvedPath = path.join(workflowsDir, "approved.mjs");
    const outsidePath = path.join(outsideDir, "outside.mjs");
    await fs.mkdir(workflowsDir, { recursive: true });
    await fs.writeFile(approvedPath, content, "utf-8");
    await fs.writeFile(outsidePath, content, "utf-8");
    const contentHash = createHash("sha256").update(content).digest("hex");
    const policy = createWorkflowPolicy(workflowsDir, {
      allowLegacyFiles: false,
      approvedFileHashes: new Map([["approved.mjs", contentHash]]),
    });

    try {
      await expect(loadWorkflowScript({ kind: "file", path: approvedPath }, { stateDir: tempDir, policy }))
        .resolves.toMatchObject({ sourceIdentity: { relativePath: "approved.mjs", contentSha256: contentHash } });
      await expect(loadWorkflowScript({ kind: "file", path: outsidePath }, { stateDir: tempDir, policy }))
        .rejects.toMatchObject({ code: "file_outside_root" });
      await fs.writeFile(approvedPath, `${content}// changed\n`, "utf-8");
      await expect(loadWorkflowScript({ kind: "file", path: approvedPath }, { stateDir: tempDir, policy }))
        .rejects.toMatchObject({ code: "file_not_approved" });
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("相同内容 file 的 scriptHash 稳定", async () => {
    const filePath = path.join(tempDir, "stable-hash.mjs");
    await fs.writeFile(filePath, `export default async function(ctx) { return "stable"; }\n`, "utf-8");
    const s1 = await loadWorkflowScript({ kind: "file", path: filePath }, { policy: createWorkflowPolicy(tempDir) });
    const s2 = await loadWorkflowScript({ kind: "file", path: filePath }, { policy: createWorkflowPolicy(tempDir) });
    expect(s1.scriptHash).toBe(s2.scriptHash);
  });

  it("不同内容 file 的 scriptHash 不同", async () => {
    const f1 = path.join(tempDir, "v1.mjs");
    const f2 = path.join(tempDir, "v2.mjs");
    await fs.writeFile(f1, `export default async function(ctx) { return "v1"; }\n`, "utf-8");
    await fs.writeFile(f2, `export default async function(ctx) { return "v2"; }\n`, "utf-8");
    const s1 = await loadWorkflowScript({ kind: "file", path: f1 }, { policy: createWorkflowPolicy(tempDir) });
    const s2 = await loadWorkflowScript({ kind: "file", path: f2 }, { policy: createWorkflowPolicy(tempDir) });
    expect(s1.scriptHash).not.toBe(s2.scriptHash);
  });
});
