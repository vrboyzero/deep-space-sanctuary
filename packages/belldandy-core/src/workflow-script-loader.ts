/**
 * WorkflowScriptLoader — 工作流脚本加载器
 *
 * 支持三种来源：
 * - file：从 stateDir/workflows/<name>.ts|.mjs|.js 加载，.ts 用 esbuild 编译到临时 .mjs
 * - builtin：从 BUILTIN_WORKFLOWS 注册表查找
 * - inline：默认拒绝；仅启动期 WorkflowExecutionPolicy 允许时做白名单 AST 扫描 + esbuild 编译
 *
 * scriptHash = sha256(脚本内容 + workflowName + workflowVersion)
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import * as ts from "typescript";

import { FilesystemCapability } from "@belldandy/protocol";
import type { WorkflowContext } from "@belldandy/agent";
import { getBuiltinWorkflow } from "./workflow-builtin-registry.js";
import type { WorkflowExecutionPolicy } from "./workflow-execution-policy.js";

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
  sourceIdentity?: {
    relativePath: string;
    contentSha256: string;
  };
};

export type LoadScriptOptions = {
  /** stateDir，用于 file 模式解析相对路径 */
  stateDir?: string;
  /** 启动期确定的 source trust policy，调用参数不能覆盖。 */
  policy?: WorkflowExecutionPolicy;
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
  { pattern: /\bDate\.now\s*\(/m, reason: "Date.now() 非确定性，禁止" },
  { pattern: /\bMath\.random\s*\(/m, reason: "Math.random() 非确定性，禁止" },
  { pattern: /\bnew\s+Date\s*\(\s*\)/m, reason: "new Date() 无参数非确定性，禁止" },
];

export function scanInlineScriptSafety(code: string): { safe: boolean; violations: string[] } {
  const violations = new Set<string>();
  for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
    if (pattern.test(code)) {
      violations.add(reason);
    }
  }
  const sourceFile = ts.createSourceFile("inline-workflow.ts", code, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const addViolation = (reason: string) => {
    violations.add(reason);
  };
  const isIdentifierNamed = (node: ts.Node, name: string): boolean => ts.isIdentifier(node) && node.text === name;
  const isPropertyAccess = (node: ts.Node, objectName: string, propertyName: string): boolean => (
    ts.isPropertyAccessExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === objectName
    && node.name.text === propertyName
  );

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        addViolation("dynamic import() 禁止");
      } else if (isIdentifierNamed(node.expression, "require")) {
        addViolation("require() 禁止");
      } else if (isIdentifierNamed(node.expression, "eval")) {
        addViolation("eval() 禁止");
      } else if (isPropertyAccess(node.expression, "Date", "now")) {
        addViolation("Date.now() 非确定性，禁止");
      } else if (isPropertyAccess(node.expression, "Math", "random")) {
        addViolation("Math.random() 非确定性，禁止");
      }
    } else if (ts.isNewExpression(node)) {
      if (isIdentifierNamed(node.expression, "Function")) {
        addViolation("Function() 构造禁止");
      }
      if (isIdentifierNamed(node.expression, "Date") && (!node.arguments || node.arguments.length === 0)) {
        addViolation("new Date() 无参数非确定性，禁止");
      }
    } else if (ts.isIdentifier(node)) {
      if (node.text === "process") addViolation("process 全局对象禁止");
      if (node.text === "globalThis") addViolation("globalThis 禁止");
      if (node.text === "__dirname") addViolation("__dirname 禁止");
      if (node.text === "__filename") addViolation("__filename 禁止");
    } else if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) {
      addViolation("import 语句禁止");
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { safe: violations.size === 0, violations: [...violations] };
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
  if (!opts.policy) {
    throw new WorkflowScriptLoadError("file_policy_required", "Workflow file execution requires a startup policy.");
  }
  let workflowRoot: FilesystemCapability;
  try {
    workflowRoot = new FilesystemCapability({
      rootPath: opts.policy.workflowRoot,
      label: "workflow source root",
      maxBytes: opts.policy.maxFileBytes,
    });
  } catch {
    throw new WorkflowScriptLoadError("file_root_unavailable", "Workflow source root is unavailable.");
  }

  let filePath: string;
  try {
    filePath = workflowRoot.resolveExistingPath(source.path, "workflow source");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      throw new WorkflowScriptLoadError("file_not_found", "Workflow file was not found in the approved root.");
    }
    throw new WorkflowScriptLoadError("file_outside_root", "Workflow file is outside the approved source root.");
  }
  const relativePath = path.relative(workflowRoot.rootPath, filePath).split(path.sep).join("/");
  const content = fs.readFileSync(filePath, "utf-8");
  workflowRoot.assertByteLength(Buffer.byteLength(content), "workflow source");
  const ext = path.extname(filePath).toLowerCase();
  const workflowName = path.basename(filePath, ext);
  const workflowVersion = "1.0.0";
  const scriptHash = computeScriptHash(content, workflowName, workflowVersion);
  const contentSha256 = createHash("sha256").update(content).digest("hex");
  const approvedHash = opts.policy.approvedFileHashes.get(relativePath);
  if (!opts.policy.allowLegacyFiles && approvedHash !== contentSha256) {
    throw new WorkflowScriptLoadError("file_not_approved", "Workflow file is not approved for execution.");
  }

  let modulePath: string;
  if (ext === ".ts") {
    const cacheDir = getWorkflowCacheDir(opts.stateDir);
    modulePath = await compileTsToMjs(content, cacheDir, scriptHash.slice(0, 16));
  } else if (ext === ".mjs" || ext === ".js") {
    modulePath = filePath;
  } else {
    throw new WorkflowScriptLoadError("unsupported_extension", `Unsupported file extension: ${ext}`);
  }

  const mod = await import(pathToFileURL(modulePath).href);
  if (typeof mod.default !== "function") {
    throw new WorkflowScriptLoadError("no_default_export", `Workflow script must have a default export function: ${filePath}`);
  }
  return {
    default: mod.default as (ctx: WorkflowContext) => Promise<string>,
    scriptHash,
    workflowName,
    workflowVersion,
    source: { kind: "file", path: filePath },
    sourceIdentity: { relativePath, contentSha256 },
  };
}

async function loadInline(source: { kind: "inline"; code: string; name?: string }, opts: LoadScriptOptions): Promise<LoadedWorkflowScript> {
  if (!opts.policy?.allowInline) {
    throw new WorkflowScriptLoadError("inline_disabled", "Inline workflow scripts are disabled by startup policy.");
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
  const mod = await import(pathToFileURL(modulePath).href);
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
