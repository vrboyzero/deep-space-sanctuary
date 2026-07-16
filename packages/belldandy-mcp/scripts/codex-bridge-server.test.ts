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
  buildCodexTaskPrompt,
  executeCodexExecOnce,
  executeCodexTaskOnce,
  parseArgs,
  resolveCwd,
  runCodexExec,
} from "./codex-bridge-server-core.ts";

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

describe("codex-bridge-server", () => {
  it("parses launch arguments and resolves defaults", () => {
    const workspaceRoot = path.join(process.cwd(), "bridge-test-workspace");
    const extraWorkspaceRoot = path.join(process.cwd(), "bridge-test-extra");
    const parsed = parseArgs([
      "--workspace-root",
      workspaceRoot,
      "--default-cwd",
      "packages",
      "--extra-workspace-root",
      extraWorkspaceRoot,
      "--codex-command",
      "codex.cmd",
      "--timeout-ms",
      "12345",
    ]);

    expect(parsed.workspaceRoot).toBe(workspaceRoot);
    expect(parsed.defaultCwd).toBe(path.join(workspaceRoot, "packages"));
    expect(parsed.extraWorkspaceRoots).toEqual([extraWorkspaceRoot]);
    expect(parsed.codexCommand).toBe("codex.cmd");
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

  it("executes one-shot Codex requests and returns structured content", async () => {
    const child = createMockChild();
    spawnMock.mockReturnValue(child);

    const promise = executeCodexExecOnce({
      workspaceRoot: "E:/project/star-sanctuary",
      defaultCwd: "E:/project/star-sanctuary",
      extraWorkspaceRoots: ["E:/other-project"],
      codexCommand: "codex.cmd",
      timeoutMs: 1000,
    }, {
      prompt: "Summarize the bridge implementation.",
      model: "gpt-5",
      cwd: "packages",
    });

    queueMicrotask(() => {
      child.stdout.write("ok");
      child.stderr.write("");
      child.emit("close", 0);
    });

    const result = await promise;

    expect(spawnMock).toHaveBeenCalledWith(
      "codex.cmd",
      [
        "exec",
        "--sandbox",
        "workspace-write",
        "--add-dir",
        "E:/other-project",
        "--model",
        "gpt-5",
        "Summarize the bridge implementation.",
      ],
      expect.objectContaining({
        cwd: expect.stringMatching(/star-sanctuary[\\/]+packages$/),
        shell: false,
      }),
    );
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({
      success: true,
      exitCode: 0,
      stdout: "ok",
      stderr: "",
    });
  });

  it("builds structured task prompts for narrowed task_once mode", async () => {
    const child = createMockChild();
    spawnMock.mockReturnValue(child);

    const prompt = buildCodexTaskPrompt({
      mode: "review",
      objective: "总结桥接层本轮改动的风险",
      scope: ["packages/belldandy-skills/src/builtin/agent-bridge"],
      constraints: ["不要修改文件", "不要运行 git"],
      expectedOutput: ["给出 3 条结论"],
    });
    expect(prompt).toContain("模式：代码审查");
    expect(prompt).toContain("范围：");
    expect(prompt).toContain("packages/belldandy-skills/src/builtin/agent-bridge");

    const promise = executeCodexTaskOnce({
      workspaceRoot: "E:/project/star-sanctuary",
      defaultCwd: "E:/project/star-sanctuary",
      extraWorkspaceRoots: [],
      codexCommand: "codex.cmd",
      timeoutMs: 1000,
    }, {
      mode: "review",
      objective: "总结桥接层本轮改动的风险",
      scope: ["packages/belldandy-skills/src/builtin/agent-bridge"],
      constraints: ["不要修改文件", "不要运行 git"],
      expectedOutput: ["给出 3 条结论"],
      cwd: "packages",
    });

    queueMicrotask(() => {
      child.stdout.write("ok");
      child.stderr.write("");
      child.emit("close", 0);
    });

    const result = await promise;

    expect(spawnMock).toHaveBeenCalledWith(
      "codex.cmd",
      expect.arrayContaining([
        "exec",
        "--sandbox",
        "workspace-write",
        expect.stringContaining("模式：代码审查"),
      ]),
      expect.any(Object),
    );
    expect(result.isError).toBe(false);
  });

  it("marks non-zero exits as MCP tool errors while keeping structured output", async () => {
    const child = createMockChild();
    spawnMock.mockReturnValue(child);

    const promise = executeCodexExecOnce({
      workspaceRoot: "E:/project/star-sanctuary",
      defaultCwd: "E:/project/star-sanctuary",
      extraWorkspaceRoots: [],
      codexCommand: "codex",
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

  it("kills the child process when Codex execution times out", async () => {
    vi.useFakeTimers();
    const child = createMockChild();
    spawnMock.mockReturnValue(child);

    const promise = runCodexExec({
      codexCommand: "codex",
      cwd: "E:/project/star-sanctuary",
      prompt: "Long task",
      timeoutMs: 10,
    });
    const rejection = expect(promise).rejects.toThrow(/Codex 执行超时/);

    await vi.advanceTimersByTimeAsync(11);

    await rejection;
    expect(child.kill).toHaveBeenCalledTimes(1);
  });
});
