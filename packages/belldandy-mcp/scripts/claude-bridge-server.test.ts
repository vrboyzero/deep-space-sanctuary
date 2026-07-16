import { EventEmitter } from "node:events";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("cross-spawn", () => ({
  default: spawnMock,
}));

import {
  buildClaudeTaskPrompt,
  executeClaudeExecOnce,
  executeClaudeTaskOnce,
  parseArgs,
  resolveCwd,
  runClaudeExec,
} from "./claude-bridge-server-core.ts";

type MockChild = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
};

function createMockChild(): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  return child;
}

afterEach(() => {
  spawnMock.mockReset();
  vi.useRealTimers();
});

describe("claude-bridge-server", () => {
  it("parses launch arguments and resolves defaults", () => {
    const parsed = parseArgs([
      "--workspace-root",
      "E:/project/star-sanctuary",
      "--default-cwd",
      "packages",
      "--extra-workspace-root",
      "E:/other-project",
      "--claude-command",
      "claude.cmd",
      "--git-bash-path",
      "C:/Program Files/Git/bin/bash.exe",
      "--timeout-ms",
      "12345",
    ]);

    expect(parsed.workspaceRoot).toMatch(/star-sanctuary$/);
    expect(parsed.defaultCwd).toBe(path.join(parsed.workspaceRoot, "packages"));
    expect(parsed.extraWorkspaceRoots).toEqual([
      expect.stringMatching(/other-project$/),
    ]);
    expect(parsed.claudeCommand).toBe("claude.cmd");
    expect(parsed.gitBashPath).toMatch(/Git[\\/]bin[\\/]bash\.exe$/);
    expect(parsed.timeoutMs).toBe(12345);
  });

  it("rejects cwd outside the declared workspace root", () => {
    expect(() => resolveCwd("../outside", "E:/project/star-sanctuary", "E:/project/star-sanctuary")).toThrow(
      /cwd 越界/,
    );
  });

  it("allows cwd inside extra workspace roots", () => {
    expect(resolveCwd(
      "E:/other-project",
      "E:/project/star-sanctuary",
      "E:/project/star-sanctuary",
      ["E:/other-project"],
    )).toMatch(/other-project$/);
  });

  it("executes one-shot Claude requests and returns structured content", async () => {
    const child = createMockChild();
    spawnMock.mockReturnValue(child);

    const promise = executeClaudeExecOnce({
      workspaceRoot: "E:/project/star-sanctuary",
      defaultCwd: "E:/project/star-sanctuary",
      extraWorkspaceRoots: ["E:/other-project"],
      claudeCommand: "claude",
      gitBashPath: "C:/Program Files/Git/bin/bash.exe",
      timeoutMs: 1000,
    }, {
      prompt: "Summarize the bridge implementation.",
      model: "sonnet",
      cwd: "packages",
    });

    queueMicrotask(() => {
      child.stdout.write('{"result":"ok"}');
      child.stderr.write("");
      child.emit("close", 0);
    });

    const result = await promise;

    expect(spawnMock).toHaveBeenCalledWith(
      "claude",
      [
        "--print",
        "--output-format",
        "json",
        "--dangerously-skip-permissions",
        "--add-dir",
        "E:/other-project",
        "--model",
        "sonnet",
        "Summarize the bridge implementation.",
      ],
      expect.objectContaining({
        cwd: expect.stringMatching(/star-sanctuary[\\/]+packages$/),
        shell: false,
        env: expect.objectContaining({
          CLAUDE_CODE_GIT_BASH_PATH: expect.stringMatching(/Git[\\/]bin[\\/]bash\.exe$/),
        }),
      }),
    );
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({
      success: true,
      exitCode: 0,
      stdout: '{"result":"ok"}',
      stderr: "",
    });
  });

  it("builds structured task prompts for narrowed task_once mode", async () => {
    const child = createMockChild();
    spawnMock.mockReturnValue(child);

    const prompt = buildClaudeTaskPrompt({
      mode: "patch",
      objective: "只修改一个小文件并给出验证说明",
      scope: ["examples/skills/claude-code-exec-mcp/SKILL.md"],
      constraints: ["不要改无关文件"],
      expectedOutput: ["说明改动点", "给出简短验证说明"],
    });
    expect(prompt).toContain("模式：小范围改动");
    expect(prompt).toContain("只允许在给定范围内做小范围修改");

    const promise = executeClaudeTaskOnce({
      workspaceRoot: "E:/project/star-sanctuary",
      defaultCwd: "E:/project/star-sanctuary",
      extraWorkspaceRoots: [],
      claudeCommand: "claude",
      timeoutMs: 1000,
    }, {
      mode: "patch",
      objective: "只修改一个小文件并给出验证说明",
      scope: ["examples/skills/claude-code-exec-mcp/SKILL.md"],
      constraints: ["不要改无关文件"],
      expectedOutput: ["说明改动点", "给出简短验证说明"],
      cwd: "examples",
    });

    queueMicrotask(() => {
      child.stdout.write('{"result":"ok"}');
      child.stderr.write("");
      child.emit("close", 0);
    });

    const result = await promise;

    expect(spawnMock).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining([
        "--print",
        "--output-format",
        "json",
        "--dangerously-skip-permissions",
        expect.stringContaining("模式：小范围改动"),
      ]),
      expect.any(Object),
    );
    expect(result.isError).toBe(false);
  });

  it("marks non-zero exits as MCP tool errors while keeping structured output", async () => {
    const child = createMockChild();
    spawnMock.mockReturnValue(child);

    const promise = executeClaudeExecOnce({
      workspaceRoot: "E:/project/star-sanctuary",
      defaultCwd: "E:/project/star-sanctuary",
      extraWorkspaceRoots: [],
      claudeCommand: "claude",
      timeoutMs: 1000,
    }, {
      prompt: "Run review.",
    });

    queueMicrotask(() => {
      child.stdout.write("partial");
      child.stderr.write("failed");
      child.emit("close", 2);
    });

    const result = await promise;

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      success: false,
      exitCode: 2,
      stdout: "partial",
      stderr: "failed",
    });
  });

  it("kills the child process when Claude execution times out", async () => {
    vi.useFakeTimers();
    const child = createMockChild();
    spawnMock.mockReturnValue(child);

    const promise = runClaudeExec({
      claudeCommand: "claude",
      cwd: "E:/project/star-sanctuary",
      prompt: "Long task",
      timeoutMs: 10,
    });
    const rejection = expect(promise).rejects.toThrow(/Claude 执行超时/);

    await vi.advanceTimersByTimeAsync(11);

    await rejection;
    expect(child.kill).toHaveBeenCalledTimes(1);
  });
});
