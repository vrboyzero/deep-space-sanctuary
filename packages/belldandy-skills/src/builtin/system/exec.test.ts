import { describe, it, expect, vi } from "vitest";
import { runCommandTool } from "./exec.js";
import type { ToolContext } from "../../types.js";
import { getToolContract } from "../../tool-contract.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const workspaceRoot = process.platform === "win32"
    ? "C:\\tmp\\test-workspace"
    : "/tmp/test-workspace";

const extraWorkspaceRoot = process.platform === "win32"
    ? "E:\\extra-workspace"
    : "/tmp/extra-workspace";

const mockContext: ToolContext = {
    conversationId: "test-conv",
    workspaceRoot,
    policy: {
        allowedPaths: [],
        deniedPaths: [],
        allowedDomains: [],
        deniedDomains: [],
        maxTimeoutMs: 1000,
        maxResponseBytes: 1024,
    },
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
    },
};

const isWindows = process.platform === "win32";

describe("run_command (Platform-aware Safelist)", () => {
  it("should expose cli in contract channels", () => {
    expect(getToolContract(runCommandTool)?.channels).toEqual(expect.arrayContaining(["gateway", "web", "cli"]));
  });

  it("fails closed for a coding-run command when no sandbox backend is configured", async () => {
    const result = await runCommandTool.execute({ command: "echo must-not-run" }, {
      ...mockContext,
      launchSpec: { commandSandbox: "required" },
    });

    expect(result).toMatchObject({
      success: false,
      failureKind: "permission_or_policy",
      output: "",
      metadata: {
        commandSandboxRequirement: "required",
        commandSandboxStatus: "unavailable",
        commandSandboxPlatform: process.platform,
      },
    });
    expect(result.error).toContain("requires an OS sandbox");
  });

  // 通用命令测试（所有平台）
    it("should allow common 'pwd' command on all platforms", async () => {
        const result = await runCommandTool.execute({ command: "pwd" }, mockContext);
        // 即使执行失败，也不应该是安全错误
        if (!result.success) {
            expect(result.error).not.toContain("blocked by security policy");
            expect(result.error).not.toContain("not in the safe list");
        }
    });

    it("should close stdin so commands waiting for EOF can finish", async () => {
        const result = await runCommandTool.execute({
            command: 'node -e "process.stdin.resume(); process.stdin.on(\\"end\\", () => process.stdout.write(\\"stdin-closed\\"))"',
        }, {
            ...mockContext,
            workspaceRoot: process.cwd(),
            policy: {
                ...mockContext.policy,
                maxTimeoutMs: 5_000,
            },
        });

        expect(result.success).toBe(true);
        expect(result.output).toContain("stdin-closed");
    });

    it("should abort a running command when abortSignal is triggered", async () => {
        const controller = new AbortController();
        const resultPromise = runCommandTool.execute({
            command: 'node -e "setTimeout(() => process.stdout.write(\\"late-output\\"), 5000)"',
        }, {
            ...mockContext,
            workspaceRoot: process.cwd(),
            policy: {
                ...mockContext.policy,
                maxTimeoutMs: 10_000,
            },
            abortSignal: controller.signal,
        });

        await new Promise((resolve) => setTimeout(resolve, 120));
        controller.abort("Stopped by user.");
        const result = await resultPromise;

        expect(result.success).toBe(false);
        expect(result.error).toBe("Stopped by user.");
        expect(result.failureKind).toBe("environment_error");
        expect(result.output).not.toContain("late-output");
    });

    it("should terminate shell descendants before resolving an aborted command", async () => {
        const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-run-command-tree-"));
        const fixturePath = path.join(workspace, "spawn-descendant.mjs");
        const readyPath = path.join(workspace, "ready.txt");
        const descendantPidPath = path.join(workspace, "descendant.pid");
        const markerPath = path.join(workspace, "descendant-survived.txt");
        await fs.writeFile(fixturePath, [
            'import { spawn } from "node:child_process";',
            'const [, , readyPath, descendantPidPath, markerPath] = process.argv;',
            'const script = "const fs=require(\'node:fs\');fs.writeFileSync(process.argv[2],String(process.pid));fs.writeFileSync(process.argv[3],\'ready\');setTimeout(()=>fs.writeFileSync(process.argv[1],\'survived\'),5000)";',
            'spawn(process.execPath, ["-e", script, markerPath, descendantPidPath, readyPath], { stdio: "ignore" });',
            'setTimeout(() => {}, 6000);',
        ].join("\n"), "utf-8");
        const controller = new AbortController();

        try {
            const resultPromise = runCommandTool.execute({
                command: `node "${fixturePath}" "${readyPath}" "${descendantPidPath}" "${markerPath}"`,
            }, {
                ...mockContext,
                workspaceRoot: workspace,
                policy: {
                    ...mockContext.policy,
                    maxTimeoutMs: 5_000,
                },
                abortSignal: controller.signal,
            });
            await vi.waitFor(async () => {
                await expect(fs.readFile(readyPath, "utf-8")).resolves.toBe("ready");
            }, { timeout: 2_000 });
            const descendantPid = Number(await fs.readFile(descendantPidPath, "utf-8"));
            expect(Number.isSafeInteger(descendantPid)).toBe(true);

            controller.abort("Stopped by user.");
            const result = await resultPromise;
            await vi.waitFor(() => {
                let alive = true;
                try {
                    process.kill(descendantPid, 0);
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
                    alive = false;
                }
                expect(alive).toBe(false);
            }, { timeout: 3_000 });

            expect(result.success).toBe(false);
            expect(result.error).toBe("Stopped by user.");
            await expect(fs.access(markerPath)).rejects.toThrow();
        } finally {
            // 红灯实现会让 fixture 短暂持有 cwd；仅在锁未释放时重试清理。
            for (let attempt = 0; attempt < 5; attempt += 1) {
                try {
                    await fs.rm(workspace, { recursive: true, force: true });
                    break;
                } catch (error) {
                    if (attempt === 4) throw error;
                    await new Promise((resolve) => setTimeout(resolve, 200));
                }
            }
        }
    });

    it("should cap the requested timeout at policy.maxTimeoutMs", async () => {
        const result = await runCommandTool.execute({
            command: 'node -e "setTimeout(() => {}, 1000)"',
            timeoutMs: 5_000,
        }, {
            ...mockContext,
            workspaceRoot: process.cwd(),
            policy: {
                ...mockContext.policy,
                maxTimeoutMs: 50,
            },
        });

        expect(result.success).toBe(false);
        expect(result.failureKind).toBe("environment_error");
        expect(result.error).toContain("Timeout after 50ms");
        // Windows 需要为 taskkill 与 close drain 保留完整的有界终止预算。
        expect(result.durationMs).toBeLessThan(2_000);
        expect(result.metadata).toMatchObject({
            processTerminationReason: "timeout",
            processCloseObserved: true,
        });
    });

    it("should bound captured stdout by policy.maxResponseBytes", async () => {
        const result = await runCommandTool.execute({
            command: 'node -e "process.stdout.write(\'x\'.repeat(4096))"',
        }, {
            ...mockContext,
            workspaceRoot: process.cwd(),
            policy: {
                ...mockContext.policy,
                maxTimeoutMs: 5_000,
                maxResponseBytes: 256,
            },
        });

        expect(result.success).toBe(true);
        expect(Buffer.byteLength(result.output, "utf-8")).toBeLessThanOrEqual(256);
        expect(result.metadata).toMatchObject({
            outputTruncated: true,
            outputLimitBytes: 256,
            outputBytesObserved: 4096,
        });
    });

    it("should allow common 'git' command on all platforms", async () => {
        const result = await runCommandTool.execute({ command: "git --version" }, mockContext);
        if (!result.success) {
            expect(result.error).not.toContain("not in the safe list");
        }
    });

    // Windows 特定命令测试
    describe("Windows-specific commands", () => {
        it("should handle 'copy' based on platform", async () => {
            const result = await runCommandTool.execute({ command: "copy a.txt b.txt" }, mockContext);
            if (isWindows) {
                // Windows: 应该被允许（可能因文件不存在而失败，但不是安全错误）
                if (!result.success) {
                    expect(result.error).not.toContain("not in the safe list");
                }
            } else {
                // Unix: 应该被安全阻止
                expect(result.success).toBe(false);
                expect(result.error).toContain("not in the safe list");
            }
        });

        it("should handle 'ipconfig' based on platform", async () => {
            const result = await runCommandTool.execute({ command: "ipconfig" }, mockContext);
            if (isWindows) {
                if (!result.success) {
                    expect(result.error).not.toContain("not in the safe list");
                }
            } else {
                expect(result.success).toBe(false);
                expect(result.error).toContain("not in the safe list");
            }
        });
    });

    // Unix 特定命令测试
    describe("Unix-specific commands", () => {
        it("should handle 'ls' based on platform", async () => {
            const result = await runCommandTool.execute({ command: "ls" }, mockContext);
            if (!result.success) {
                expect(result.error).not.toContain("not in the safe list");
            }
        });

        it("should handle 'curl' based on platform", async () => {
            const result = await runCommandTool.execute({ command: "curl --version" }, mockContext);
            if (!result.success) {
                expect(result.error).not.toContain("not in the safe list");
            }
        });
    });

    // 危险参数检测（Windows del）
    describe("Dangerous argument detection", () => {
        it("should block 'del /s' on Windows (recursive blocked)", async () => {
            // 这个测试只在 Windows 上有意义，因为 del 只在 Windows 白名单中
            if (isWindows) {
                const result = await runCommandTool.execute({ command: "del /s *.log" }, mockContext);
                expect(result.success).toBe(false);
                expect(result.error).toContain("Recursive/Quiet deletion");
            }
        });

        it("should block 'del /q' on Windows (quiet blocked)", async () => {
            if (isWindows) {
                const result = await runCommandTool.execute({ command: "del /q *.log" }, mockContext);
                expect(result.success).toBe(false);
                expect(result.error).toContain("Recursive/Quiet deletion");
            }
        });

        it("should block 'rm -rf' on Unix (recursive blocked)", async () => {
            // rm 在所有平台都检测危险参数
            const result = await runCommandTool.execute({ command: "rm -rf /tmp" }, mockContext);
            expect(result.success).toBe(false);
            expect(result.error).toContain("Recursive/Force deletion");
            expect(result.failureKind).toBe("permission_or_policy");
        });

        it("should validate chained commands segment-by-segment", async () => {
            const result = await runCommandTool.execute({ command: "echo ok && rm -rf ./tmp" }, mockContext);
            expect(result.success).toBe(false);
            expect(result.error).toContain("Recursive/Force deletion");
        });

        it("should block shell redirection syntax", async () => {
            const result = await runCommandTool.execute({ command: "echo test > out.txt" }, mockContext);
            expect(result.success).toBe(false);
            expect(result.error).toContain("Redirection syntax is blocked");
            expect(result.error).toContain("run_command already captures stdout/stderr");
        });

        it("should explain Windows-friendly alternatives when Unix-style redirection is blocked", async () => {
            const result = await runCommandTool.execute({ command: 'curl -s "https://api.github.com" 2>/dev/null | head -100' }, mockContext);
            expect(result.success).toBe(false);
            expect(result.error).toContain("2>/dev/null");
            expect(result.error).toContain("head/tail");
            if (isWindows) {
                expect(result.error).toContain("On Windows");
            }
        });

        it("should block cwd outside workspace root", async () => {
            const result = await runCommandTool.execute({ command: "pwd", cwd: "../outside" }, mockContext);
            expect(result.success).toBe(false);
            expect(result.error).toContain("Working directory escapes allowed roots");
        });

        it("should enforce cwd isolation mode for command working directory boundaries", async () => {
            const isolatedContext: ToolContext = {
                ...mockContext,
                defaultCwd: path.join(workspaceRoot, "apps"),
                launchSpec: {
                    isolationMode: "cwd",
                },
            };

            const result = await runCommandTool.execute({ command: "pwd", cwd: "../outside" }, isolatedContext);
            expect(result.success).toBe(false);
            expect(result.error).toContain("Working directory escapes allowed roots");
        });

        it("should allow cwd inside extraWorkspaceRoots", async () => {
            const result = await runCommandTool.execute(
                { command: "pwd", cwd: extraWorkspaceRoot },
                { ...mockContext, extraWorkspaceRoots: [extraWorkspaceRoot] }
            );

            if (!result.success) {
                expect(result.error).not.toContain("Working directory escapes allowed roots");
            }
        });

        it("should block Windows file commands when path operand escapes allowed roots", async () => {
            if (!isWindows) return;

            const result = await runCommandTool.execute(
                { command: 'move ".\\inside.txt" "C:\\outside\\target.txt"' },
                mockContext
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("Path operand escapes allowed roots");
        });

        it("should allow Windows file commands within extraWorkspaceRoots", async () => {
            if (!isWindows) return;

            const extraFile = path.join(extraWorkspaceRoot, "inside.txt");
            const result = await runCommandTool.execute(
                { command: `move "${extraFile}" "${path.join(extraWorkspaceRoot, "renamed.txt")}"` },
                { ...mockContext, extraWorkspaceRoots: [extraWorkspaceRoot] }
            );

            if (!result.success) {
                expect(result.error).not.toContain("Path operand escapes allowed roots");
                expect(result.error).not.toContain("not in the safe list");
            }
        });

        it("should allow controlled 'if exist' builtin with safe nested command", async () => {
            if (!isWindows) return;

            const result = await runCommandTool.execute(
                { command: 'if not exist ".\\flag.txt" move ".\\inside.txt" ".\\inside.bak"' },
                mockContext
            );

            if (!result.success) {
                expect(result.error).not.toContain("not in the safe list");
                expect(result.error).not.toContain("Path operand escapes allowed roots");
            }
        });

        it("should validate grouped 'if exist' builtin commands segment-by-segment", async () => {
            if (!isWindows) return;

            const result = await runCommandTool.execute(
                { command: 'if not exist ".\\flag.txt" (echo ok && del /q *.log)' },
                mockContext
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("Recursive/Quiet deletion");
        });

        it("should allow grouped 'if exist' builtin with safe else branch", async () => {
            if (!isWindows) return;

            const result = await runCommandTool.execute(
                { command: 'if exist ".\\flag.txt" (move ".\\inside.txt" ".\\inside.bak") else (echo missing && move ".\\inside.bak" ".\\inside.txt")' },
                mockContext
            );

            if (!result.success) {
                expect(result.error).not.toContain("Only 'if [not] exist");
                expect(result.error).not.toContain("Path operand escapes allowed roots");
                expect(result.error).not.toContain("not in the safe list");
            }
        });

        it("should block grouped 'if exist' builtin when else branch has unsafe command", async () => {
            if (!isWindows) return;

            const result = await runCommandTool.execute(
                { command: 'if exist ".\\flag.txt" (echo found) else (echo missing && del /q *.log)' },
                mockContext
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("Recursive/Quiet deletion");
        });

        it("should block grouped 'if exist' builtin when else branch path escapes allowed roots", async () => {
            if (!isWindows) return;

            const result = await runCommandTool.execute(
                { command: 'if exist ".\\flag.txt" (move ".\\inside.txt" ".\\inside.bak") else (echo missing && move ".\\inside.txt" "C:\\outside\\inside.bak")' },
                mockContext
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("Path operand escapes allowed roots");
        });

        it("should block controlled 'if exist' builtin when condition path escapes allowed roots", async () => {
            if (!isWindows) return;

            const result = await runCommandTool.execute(
                { command: 'if exist "C:\\outside\\flag.txt" move ".\\inside.txt" ".\\inside.bak"' },
                mockContext
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("Path operand escapes allowed roots");
        });

        it("should allow controlled 'for' builtin with safe nested command", async () => {
            if (!isWindows) return;

            const result = await runCommandTool.execute(
                { command: 'for %f in (".\\*.txt") do move "%f" ".\\archive"' },
                mockContext
            );

            if (!result.success) {
                expect(result.error).not.toContain("not in the safe list");
                expect(result.error).not.toContain("Path operand escapes allowed roots");
            }
        });

        it("should validate grouped 'for' builtin commands segment-by-segment", async () => {
            if (!isWindows) return;

            const result = await runCommandTool.execute(
                { command: 'for %f in (".\\*.txt") do (echo %f && del /q *.log)' },
                mockContext
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("Recursive/Quiet deletion");
        });

        it("should block controlled 'for' builtin when iterable escapes allowed roots", async () => {
            if (!isWindows) return;

            const result = await runCommandTool.execute(
                { command: 'for %f in ("C:\\outside\\*.txt") do move "%f" ".\\archive"' },
                mockContext
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("Path operand escapes allowed roots");
        });
    });
});
