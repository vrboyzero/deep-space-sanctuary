/**
 * WorkflowScriptLoader — 工作流脚本加载器
 *
 * 支持三种来源：
 * - file：从 stateDir/workflows/<name>.ts|.mjs|.js 加载，.ts 用 esbuild 编译到临时 .mjs
 * - builtin：从 BUILTIN_WORKFLOWS 注册表查找
 * - inline：默认拒绝；allowInlineScript=true 时做白名单 AST 扫描 + esbuild 编译
 *
 * scriptHash = sha256(脚本内容 + workflowName + workflowVersion)
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import type { WorkflowContext } from "@belldandy/agent";
import { getBuiltinWorkflow } from "./workflow-builtin-registry.js";

// ─── Types ────────────────────────────────────────────────────────────────

export type WorkflowScriptSource =
  | { kind: "file"; path: string }
  | { kind: "builtin"; name: string }
  | { kind: "inline"; code: string; name?: string };

export type LoadedWorkflowScript = {
  default: (ctx: WorkflowContext) => Promise<string>;
  scriptHash: string;
  workflowName: string;
  workflowVersion: string;
  source: WorkflowScriptSource;
};

export type LoadScriptOptions = {
  /** 是否允许 inline 脚本（默认 false） */
  allowInlineScript?: boolean;
  /** stateDir，用于 file 模式解析相对路径 */
  stateDir?: string;
};

// ─── Errors ───────────────────────────────────────────────────────────────

export class WorkflowScriptLoadError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "WorkflowScriptLoadError";
    this.code = code;
  }
}

// ─── scriptHash 计算 ──────────────────────────────────────────────────────

function computeScriptHash(content: string, workflowName: string, workflowVersion: string): string {
  return createHash("sha256")
    .update(`${content}\n${workflowName}\n${workflowVersion}`)
    .digest("hex");
}

// ─── inline 白名单 AST 扫描 ───────────────────────────────────────────────

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bimport\s+/m, reason: "import 语句禁止" },
  { pattern: /\brequire\s*\(/m, reason: "require() 禁止" },
  { pattern: /\beval\s*\(/m, reason: "eval() 禁止" },
  { pattern: /\bFunction\s*\(/m, reason: "Function() 构造禁止" },
  { pattern: /\bprocess\b/m, reason: "process 全局对象禁止" },
  { pattern: /\bglobalThis\b/m, reason: "globalThis 禁止" },
  { pattern: /\bfs\b/m, reason: "fs 模块禁止" },
  { pattern: /\bnet\b/m, reason: "net 模块禁止" },
  { pattern: /\bchild_process\b/m, reason: "child_process 模块禁止" },
  { pattern: /\bDate\.now\s*\(/m, reason: "Date.now() 非确定性，禁止" },
  { pattern: /\bMath\.random\s*\(/m, reason: "Math.random() 非确定性，禁止" },
  { pattern: /\bnew\s+Date\s*\(\s*\)/m, reason: "new Date() 无参数非确定性，禁止" },
  { pattern: /\b__dirname\b/m, reason: "__dirname 禁止" },
  { pattern: /\b__filename\b/m, reason: "__filename 禁止" },
];

export function scanInlineScriptSafety(code: string): { safe: boolean; violations: string[] } {
  const violations: string[] = [];
  for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
    if (pattern.test(code)) {
      violations.push(reason);
    }
  }
  return { safe: violations.length === 0, violations };
}

// ─── esbuild 编译 .ts → .mjs ──────────────────────────────────────────────

async function compileTsToMjs(tsCode: string, cacheDir: string, hashKey: string): Promise<string> {
  const esbuild = await import("esbuild");
  const tempPath = path.join(cacheDir, `wf-${hashKey}.mjs`);
  const result = await esbuild.transform(tsCode, {
    loader: "ts",
    format: "esm",
    target: "es2022",
    platform: "node",
  });
  fs.writeFileSync(tempPath, result.code, "utf-8");
  return tempPath;
}

function getWorkflowCacheDir(stateDir?: string): string {
  const base = stateDir ?? path.join(os.homedir(), ".star_sanctuary");
  const cacheDir = path.join(base, "workflow-cache");
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  return cacheDir;
}

// ─── 加载器 ───────────────────────────────────────────────────────────────

export async function loadWorkflowScript(
  source: WorkflowScriptSource,
  opts: LoadScriptOptions = {},
): Promise<LoadedWorkflowScript> {
  switch (source.kind) {
    case "builtin":
      return loadBuiltin(source);
    case "file":
      return loadFile(source, opts);
    case "inline":
      return loadInline(source, opts);
  }
}

async function loadBuiltin(source: { kind: "builtin"; name: string }): Promise<LoadedWorkflowScript> {
  const entry = getBuiltinWorkflow(source.name);
  if (!entry) {
    throw new WorkflowScriptLoadError("builtin_not_found", `Builtin workflow "${source.name}" not found`);
  }
  return {
    default: entry.default,
    scriptHash: entry.scriptHash,
    workflowName: entry.name,
    workflowVersion: entry.workflowVersion ?? "1.0.0",
    source,
  };
}

async function loadFile(source: { kind: "file"; path: string }, opts: LoadScriptOptions): Promise<LoadedWorkflowScript> {
  const filePath = source.path;
  if (!fs.existsSync(filePath)) {
    throw new WorkflowScriptLoadError("file_not_found", `Workflow file not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, "utf-8");
  const ext = path.extname(filePath).toLowerCase();
  const workflowName = path.basename(filePath, ext);
  const workflowVersion = "1.0.0";
  const scriptHash = computeScriptHash(content, workflowName, workflowVersion);

  let modulePath: string;
  if (ext === ".ts") {
    const cacheDir = getWorkflowCacheDir(opts.stateDir);
    modulePath = await compileTsToMjs(content, cacheDir, scriptHash.slice(0, 16));
  } else if (ext === ".mjs" || ext === ".js") {
    modulePath = filePath;
  } else {
    throw new WorkflowScriptLoadError("unsupported_extension", `Unsupported file extension: ${ext}`);
  }

  const mod = await import(modulePath);
  if (typeof mod.default !== "function") {
    throw new WorkflowScriptLoadError("no_default_export", `Workflow script must have a default export function: ${filePath}`);
  }
  return {
    default: mod.default as (ctx: WorkflowContext) => Promise<string>,
    scriptHash,
    workflowName,
    workflowVersion,
    source,
  };
}

async function loadInline(source: { kind: "inline"; code: string; name?: string }, opts: LoadScriptOptions): Promise<LoadedWorkflowScript> {
  if (!opts.allowInlineScript) {
    throw new WorkflowScriptLoadError("inline_disabled", "Inline workflow scripts are disabled. Set allowInlineScript=true to enable.");
  }
  const { safe, violations } = scanInlineScriptSafety(source.code);
  if (!safe) {
    throw new WorkflowScriptLoadError("inline_safety_violation", `Inline script safety check failed: ${violations.join("; ")}`);
  }
  const workflowName = source.name ?? "inline-workflow";
  const workflowVersion = "1.0.0";
  const scriptHash = computeScriptHash(source.code, workflowName, workflowVersion);
  const cacheDir = getWorkflowCacheDir(opts.stateDir);
  const modulePath = await compileTsToMjs(source.code, cacheDir, scriptHash.slice(0, 16));
  const mod = await import(modulePath);
  if (typeof mod.default !== "function") {
    throw new WorkflowScriptLoadError("no_default_export", "Inline workflow script must have a default export function");
  }
  return {
    default: mod.default as (ctx: WorkflowContext) => Promise<string>,
    scriptHash,
    workflowName,
    workflowVersion,
    source,
  };
}
