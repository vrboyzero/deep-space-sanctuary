
import spawn from "cross-spawn";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

export function parseArgs(argv) {
  const result = {
    workspaceRoot: process.cwd(),
    defaultCwd: process.cwd(),
    extraWorkspaceRoots: [],
    codexCommand: "codex",
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  let configuredDefaultCwd: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    switch (token) {
      case "--workspace-root":
        if (next) {
          result.workspaceRoot = path.resolve(next);
          index += 1;
        }
        break;
      case "--default-cwd":
        if (next) {
          configuredDefaultCwd = next;
          index += 1;
        }
        break;
      case "--extra-workspace-root":
        if (next) {
          result.extraWorkspaceRoots.push(path.resolve(next));
          index += 1;
        }
        break;
      case "--codex-command":
        if (next) {
          result.codexCommand = next;
          index += 1;
        }
        break;
      case "--timeout-ms":
        if (next && Number.isFinite(Number(next)) && Number(next) > 0) {
          result.timeoutMs = Math.trunc(Number(next));
          index += 1;
        }
        break;
      default:
        break;
    }
  }

  if (configuredDefaultCwd) {
    // 相对 cwd 必须锚定已声明的 workspace，而不是 bridge 进程自身的 cwd。
    result.defaultCwd = path.isAbsolute(configuredDefaultCwd)
      ? path.resolve(configuredDefaultCwd)
      : path.resolve(result.workspaceRoot, configuredDefaultCwd);
  }

  return result;
}

export function isUnderRoot(targetPath, rootPath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath));
  return !(relative.startsWith("..") || path.isAbsolute(relative));
}

function isUnderAllowedRoots(targetPath, workspaceRoot, extraWorkspaceRoots = []) {
  if (isUnderRoot(targetPath, workspaceRoot)) {
    return true;
  }
  return extraWorkspaceRoots.some((rootPath) => isUnderRoot(targetPath, rootPath));
}

export function resolveCwd(requestedCwd, workspaceRoot, defaultCwd, extraWorkspaceRoots = []) {
  const source = typeof requestedCwd === "string" && requestedCwd.trim()
    ? requestedCwd.trim()
    : defaultCwd;
  const resolved = path.isAbsolute(source)
    ? path.resolve(source)
    : path.resolve(workspaceRoot, source);

  if (!isUnderAllowedRoots(resolved, workspaceRoot, extraWorkspaceRoots)) {
    throw new Error(`cwd 越界: ${requestedCwd}`);
  }

  return resolved;
}

export function runCodexExec({
  codexCommand,
  cwd,
  extraWorkspaceRoots,
  model,
  prompt,
  timeoutMs,
}) {
  return new Promise((resolve, reject) => {
    const args = ["exec", "--sandbox", "workspace-write"];
    for (const root of extraWorkspaceRoots ?? []) {
      args.push("--add-dir", root);
    }
    if (typeof model === "string" && model.trim()) {
      args.push("--model", model.trim());
    }
    args.push(prompt);

    const child = spawn(codexCommand, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`Codex 执行超时: ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 0,
        stdout,
        stderr,
      });
    });
  });
}

export async function executeCodexExecOnce(launch, { prompt, model, cwd }) {
  const resolvedCwd = resolveCwd(cwd, launch.workspaceRoot, launch.defaultCwd, launch.extraWorkspaceRoots);
  const result = await runCodexExec({
    codexCommand: launch.codexCommand,
    cwd: resolvedCwd,
    extraWorkspaceRoots: launch.extraWorkspaceRoots,
    model,
    prompt,
    timeoutMs: launch.timeoutMs,
  });

  const structuredContent = {
    success: result.exitCode === 0,
    exitCode: result.exitCode,
    cwd: resolvedCwd,
    stdout: result.stdout,
    stderr: result.stderr,
  };

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(structuredContent, null, 2),
      },
    ],
    structuredContent,
    isError: result.exitCode !== 0,
  };
}

export function buildCodexTaskPrompt({
  mode,
  objective,
  scope,
  constraints,
  expectedOutput,
}) {
  const lines = [
    `模式：${mode === "analyze" ? "只读分析" : mode === "review" ? "代码审查" : "小范围改动"}`,
    `目标：${objective.trim()}`,
  ];

  if (Array.isArray(scope) && scope.length > 0) {
    lines.push("范围：");
    for (const item of scope) {
      lines.push(`- ${item}`);
    }
  }

  lines.push("限制：");
  if (Array.isArray(constraints) && constraints.length > 0) {
    for (const item of constraints) {
      lines.push(`- ${item}`);
    }
  }
  if (mode === "analyze" || mode === "review") {
    lines.push("- 不要修改文件");
  } else {
    lines.push("- 只允许在给定范围内做小范围修改");
    lines.push("- 不要改无关文件");
  }

  if (Array.isArray(expectedOutput) && expectedOutput.length > 0) {
    lines.push("输出：");
    for (const item of expectedOutput) {
      lines.push(`- ${item}`);
    }
  }

  return lines.join("\n");
}

export async function executeCodexTaskOnce(
  launch,
  {
    mode,
    objective,
    scope,
    constraints,
    expectedOutput,
    model,
    cwd,
  },
) {
  const prompt = buildCodexTaskPrompt({
    mode,
    objective,
    scope,
    constraints,
    expectedOutput,
  });
  return executeCodexExecOnce(launch, {
    prompt,
    model,
    cwd,
  });
}

function registerStructuredCodexTool(server, launch, name, mode, description) {
  server.registerTool(name, {
    description,
    inputSchema: {
      objective: z.string().min(1).describe("本次任务的目标"),
      scope: z.array(z.string().min(1)).optional().describe("限定的文件或目录范围"),
      constraints: z.array(z.string().min(1)).optional().describe("附加限制，例如不要运行 git"),
      expectedOutput: z.array(z.string().min(1)).optional().describe("期望输出，例如 3 到 5 条结论或简短验证说明"),
      model: z.string().optional().describe("可选模型名"),
      cwd: z.string().optional().describe("可选工作目录，必须位于启动时声明的 workspaceRoot 或 extraWorkspaceRoots 内"),
    },
    outputSchema: {
      success: z.boolean(),
      exitCode: z.number(),
      cwd: z.string(),
      stdout: z.string(),
      stderr: z.string(),
    },
  }, async (input) => executeCodexTaskOnce(launch, {
    ...input,
    mode,
  }));
}

export function createCodexBridgeServer(launch) {
  const server = new McpServer({
    name: "codex-bridge-server",
    version: "1.0.0",
  });

  server.registerTool("exec_once", {
    description: "受控调用 Codex CLI 的一次性执行工具。适合 bridge mcp transport 试点，不提供交互式会话。",
    inputSchema: {
      prompt: z.string().min(1).describe("要提交给 Codex CLI 的任务指令"),
      model: z.string().optional().describe("可选模型名"),
      cwd: z.string().optional().describe("可选工作目录，必须位于启动时声明的 workspaceRoot 或 extraWorkspaceRoots 内"),
    },
    outputSchema: {
      success: z.boolean(),
      exitCode: z.number(),
      cwd: z.string(),
      stdout: z.string(),
      stderr: z.string(),
    },
  }, async ({ prompt, model, cwd }) => executeCodexExecOnce(launch, {
    prompt,
    model,
    cwd,
  }));

  server.registerTool("task_once", {
    description: "受控调用 Codex CLI 的结构化一次性执行工具。适合只读分析、代码审查和小范围改单文件。",
    inputSchema: {
      mode: z.enum(["analyze", "review", "patch"]).describe("任务模式：只读分析、代码审查或小范围改动"),
      objective: z.string().min(1).describe("本次任务的目标"),
      scope: z.array(z.string().min(1)).optional().describe("限定的文件或目录范围"),
      constraints: z.array(z.string().min(1)).optional().describe("附加限制，例如不要运行 git"),
      expectedOutput: z.array(z.string().min(1)).optional().describe("期望输出，例如 3 到 5 条结论或简短验证说明"),
      model: z.string().optional().describe("可选模型名"),
      cwd: z.string().optional().describe("可选工作目录，必须位于启动时声明的 workspaceRoot 或 extraWorkspaceRoots 内"),
    },
    outputSchema: {
      success: z.boolean(),
      exitCode: z.number(),
      cwd: z.string(),
      stdout: z.string(),
      stderr: z.string(),
    },
  }, async (input) => executeCodexTaskOnce(launch, input));

  registerStructuredCodexTool(
    server,
    launch,
    "analyze_once",
    "analyze",
    "受控调用 Codex CLI 的只读分析工具。适合一次性结构化分析任务。",
  );
  registerStructuredCodexTool(
    server,
    launch,
    "review_once",
    "review",
    "受控调用 Codex CLI 的代码审查工具。适合一次性 review 和结论输出。",
  );
  registerStructuredCodexTool(
    server,
    launch,
    "patch_once",
    "patch",
    "受控调用 Codex CLI 的小范围改单文件工具。适合一次性有限修改任务。",
  );

  return server;
}

export async function main(argv = process.argv.slice(2)) {
  const launch = parseArgs(argv);
  const server = createCodexBridgeServer(launch);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[codex-bridge-server] running on stdio (workspaceRoot=${launch.workspaceRoot}, extraWorkspaceRoots=${launch.extraWorkspaceRoots.join(",")})`);
}

const isMainModule = process.argv[1]
  ? pathToFileURL(process.argv[1]).href === import.meta.url
  : false;

if (isMainModule) {
  main().catch((error) => {
    console.error("[codex-bridge-server] fatal:", error);
    process.exit(1);
  });
}
