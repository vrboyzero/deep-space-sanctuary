import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ToolContext } from "../../types.js";
import { PtyManager } from "../system/pty.js";
import { BridgeSessionStore } from "./sessions.js";
import { BRIDGE_ARTIFACTS_DIR } from "./types.js";
import {
  bridgeSessionCloseTool,
  bridgeSessionListTool,
  bridgeSessionReadTool,
  bridgeSessionStartTool,
  bridgeSessionStatusTool,
  bridgeSessionWriteTool,
} from "./tool-bridge-session.js";

const IS_WINDOWS = process.platform === "win32";
const INITIAL_SESSION_READ_WAIT_MS = IS_WINDOWS ? 1_200 : 150;
const SESSION_WRITE_WAIT_MS = IS_WINDOWS ? 3_000 : 200;
const STARTUP_SEQUENCE_STEP_WAIT_MS = IS_WINDOWS ? 2_500 : 250;
const STARTUP_CAPTURE_WAIT_MS = IS_WINDOWS ? 2_500 : 500;
const STARTUP_OUTPUT_READ_WAIT_MS = IS_WINDOWS ? 1_400 : 200;
const WINDOWS_SLOW_PTY_TEST_TIMEOUT_MS = IS_WINDOWS ? 12_000 : undefined;
const WINDOWS_PTY_FLOW_TEST_TIMEOUT_MS = IS_WINDOWS ? 15_000 : undefined;
const WINDOWS_RM_RETRIES = IS_WINDOWS ? 5 : 1;
const WINDOWS_RM_RETRY_DELAY_MS = 200;

async function removeDirectoryWithRetries(targetPath: string): Promise<void> {
  let lastError: NodeJS.ErrnoException | null = null;
  for (let attempt = 0; attempt < WINDOWS_RM_RETRIES; attempt += 1) {
    try {
      await fs.rm(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error as NodeJS.ErrnoException;
      if (!IS_WINDOWS || (lastError.code !== "EBUSY" && lastError.code !== "EPERM")) {
        throw error;
      }
      if (attempt < WINDOWS_RM_RETRIES - 1) {
        await new Promise((resolve) => setTimeout(resolve, WINDOWS_RM_RETRY_DELAY_MS));
      }
    }
  }
  if (lastError) {
    throw lastError;
  }
}

describe("agent bridge P1 session tools", () => {
  let tempDir: string;
  let baseContext: ToolContext;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-bridge-session-"));
    baseContext = {
      conversationId: "test-conv",
      workspaceRoot: tempDir,
      policy: {
        allowedPaths: [],
        deniedPaths: [],
        allowedDomains: [],
        deniedDomains: [],
        maxTimeoutMs: 10_000,
        maxResponseBytes: 4_096,
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
      },
    };

    const config = {
      version: "1.0.0",
      targets: [
        {
          id: "node-repl",
          category: "agent-cli",
          transport: "pty",
          enabled: true,
          entry: { binary: process.execPath },
          cwdPolicy: "workspace-only",
          sessionMode: "persistent",
          actions: {
            interactive: {
              template: ["-i"],
            },
          },
        },
      ],
    };
    await fs.writeFile(path.join(tempDir, "agent-bridge.json"), JSON.stringify(config, null, 2), "utf-8");
  });

  afterEach(async () => {
    const manager = PtyManager.getInstance();
    for (const session of manager.list()) {
      manager.kill(session.id);
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
    BridgeSessionStore.getInstance().clear();
    await removeDirectoryWithRetries(tempDir);
  });

  it("starts, writes to, inspects, lists, and closes a bridge PTY session", async () => {
    const startResult = await bridgeSessionStartTool.execute({
      targetId: "node-repl",
      action: "interactive",
    }, baseContext);

    expect(startResult.success).toBe(true);
    const started = JSON.parse(startResult.output) as {
      sessionId: string;
      targetId: string;
      status: string;
      backend: { backend: string };
    };
    expect(started.targetId).toBe("node-repl");
    expect(started.status).toBe("active");
    expect(["node-pty", "child_process"]).toContain(started.backend.backend);

    await bridgeSessionReadTool.execute({
      sessionId: started.sessionId,
      waitMs: INITIAL_SESSION_READ_WAIT_MS,
    }, baseContext);

    const writeResult = await bridgeSessionWriteTool.execute({
      sessionId: started.sessionId,
      data: "process.stdout.write('bridge-session-ok\\n')\n",
      waitMs: SESSION_WRITE_WAIT_MS,
    }, baseContext);
    expect(writeResult.success).toBe(true);
    const written = JSON.parse(writeResult.output) as { output: string; status: string };
    expect(written.output).toContain("bridge-session-ok");
    expect(written.status).toBe("active");

    const statusResult = await bridgeSessionStatusTool.execute({
      sessionId: started.sessionId,
    }, baseContext);
    expect(statusResult.success).toBe(true);
    const statusPayload = JSON.parse(statusResult.output) as { sessionId: string; status: string };
    expect(statusPayload.sessionId).toBe(started.sessionId);
    expect(statusPayload.status).toBe("active");

    const listResult = await bridgeSessionListTool.execute({}, baseContext);
    expect(listResult.success).toBe(true);
    const listed = JSON.parse(listResult.output) as {
      sessions: Array<{ sessionId: string; targetId: string; status: string }>;
    };
    expect(listed.sessions.some((item) => item.sessionId === started.sessionId && item.targetId === "node-repl")).toBe(true);

    const closeResult = await bridgeSessionCloseTool.execute({
      sessionId: started.sessionId,
    }, baseContext);
    expect(closeResult.success).toBe(true);
    const closed = JSON.parse(closeResult.output) as {
      status: string;
      closedAt?: number;
      artifactPath?: string;
      transcriptPath?: string;
    };
    expect(closed.status).toBe("closed");
    expect(typeof closed.closedAt).toBe("number");
    expect(closed.artifactPath).toBeTruthy();
    expect(closed.transcriptPath).toBeTruthy();

    const summaryRaw = await fs.readFile(closed.artifactPath!, "utf-8");
    const summary = JSON.parse(summaryRaw) as {
      closeReason?: string;
      transcriptPath?: string;
      inputEventCount: number;
      outputEventCount: number;
    };
    expect(summary.closeReason).toBe("manual");
    expect(summary.transcriptPath).toBe(closed.transcriptPath);
    expect(summary.inputEventCount).toBeGreaterThan(0);
    expect(summary.outputEventCount).toBeGreaterThan(0);

    const transcriptRaw = await fs.readFile(closed.transcriptPath!, "utf-8");
    const transcript = JSON.parse(transcriptRaw) as {
      events: Array<{ direction: string; content: string }>;
    };
    expect(transcript.events.some((event) => event.direction === "input" && event.content.includes("bridge-session-ok"))).toBe(true);
    expect(transcript.events.some((event) => event.direction === "output" && event.content.includes("bridge-session-ok"))).toBe(true);

    const readAfterClose = await bridgeSessionReadTool.execute({
      sessionId: started.sessionId,
    }, baseContext);
    expect(readAfterClose.success).toBe(false);
    expect(readAfterClose.error).toContain("已关闭");
  }, WINDOWS_PTY_FLOW_TEST_TIMEOUT_MS);

  it("submits the current input line when bridge_session_write.submitLine is true", async () => {
    const startResult = await bridgeSessionStartTool.execute({
      targetId: "node-repl",
      action: "interactive",
    }, baseContext);

    expect(startResult.success).toBe(true);
    const started = JSON.parse(startResult.output) as { sessionId: string };

    await bridgeSessionReadTool.execute({
      sessionId: started.sessionId,
      waitMs: INITIAL_SESSION_READ_WAIT_MS,
    }, baseContext);

    const stagedWrite = await bridgeSessionWriteTool.execute({
      sessionId: started.sessionId,
      data: "process.stdout.write('submit-line-ok\\n')",
      waitMs: 150,
    }, baseContext);
    expect(stagedWrite.success).toBe(true);
    const stagedPayload = JSON.parse(stagedWrite.output) as { output: string };
    expect(stagedPayload.output).not.toContain("submit-line-ok");

    const submitResult = await bridgeSessionWriteTool.execute({
      sessionId: started.sessionId,
      submitLine: true,
      waitMs: SESSION_WRITE_WAIT_MS,
    }, baseContext);
    expect(submitResult.success).toBe(true);
    const submitPayload = JSON.parse(submitResult.output) as { output: string };
    expect(submitPayload.output).toContain("submit-line-ok");
  }, WINDOWS_PTY_FLOW_TEST_TIMEOUT_MS);

  it("aborts bridge_session_read while waiting for output", async () => {
    const startResult = await bridgeSessionStartTool.execute({
      targetId: "node-repl",
      action: "interactive",
    }, baseContext);
    expect(startResult.success).toBe(true);
    const started = JSON.parse(startResult.output) as { sessionId: string };
    const controller = new AbortController();

    const readPromise = bridgeSessionReadTool.execute({
      sessionId: started.sessionId,
      waitMs: 5_000,
    }, {
      ...baseContext,
      abortSignal: controller.signal,
    });

    await new Promise((resolve) => setTimeout(resolve, 80));
    controller.abort("Stopped by user.");
    const result = await readPromise;

    expect(result.success).toBe(false);
    expect(result.error).toBe("Stopped by user.");
  });

  it("rejects bridge session start when target cwd escapes workspace scope", async () => {
    const result = await bridgeSessionStartTool.execute({
      targetId: "node-repl",
      action: "interactive",
      cwd: "../outside",
    }, baseContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain("越界");
  });

  it("returns a clear error when bridge cwd does not exist", async () => {
    const result = await bridgeSessionStartTool.execute({
      targetId: "node-repl",
      action: "interactive",
      cwd: path.join(tempDir, "missing-cwd"),
    }, baseContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Bridge cwd 不存在");
  });

  it("auto closes an idle bridge session after idleTimeoutMs", async () => {
    const idleConfig = {
      version: "1.0.0",
      targets: [
        {
          id: "node-repl-idle",
          category: "agent-cli",
          transport: "pty",
          enabled: true,
          entry: { binary: process.execPath },
          cwdPolicy: "workspace-only",
          sessionMode: "persistent",
          idleTimeoutMs: 150,
          actions: {
            interactive: {
              template: ["-i"],
            },
          },
        },
      ],
    };
    await fs.writeFile(path.join(tempDir, "agent-bridge.json"), JSON.stringify(idleConfig, null, 2), "utf-8");

    const startResult = await bridgeSessionStartTool.execute({
      targetId: "node-repl-idle",
      action: "interactive",
    }, baseContext);

    expect(startResult.success).toBe(true);
    const started = JSON.parse(startResult.output) as { sessionId: string; idleTimeoutMs?: number };
    expect(started.idleTimeoutMs).toBe(150);

    await new Promise((resolve) => setTimeout(resolve, 320));

    const statusResult = await bridgeSessionStatusTool.execute({
      sessionId: started.sessionId,
    }, baseContext);
    expect(statusResult.success).toBe(true);
    const statusPayload = JSON.parse(statusResult.output) as {
      status: string;
      closeReason?: string;
      artifactPath?: string;
    };
    expect(statusPayload.status).toBe("closed");
    expect(statusPayload.closeReason).toBe("idle-timeout");
    expect(statusPayload.artifactPath).toBeTruthy();
  }, WINDOWS_PTY_FLOW_TEST_TIMEOUT_MS);

  it("runs startupSequence after bridge session start", async () => {
    const bootstrapConfig = {
      version: "1.0.0",
      targets: [
        {
          id: "node-repl-bootstrap",
          category: "agent-cli",
          transport: "pty",
          enabled: true,
          entry: { binary: process.execPath },
          cwdPolicy: "workspace-only",
          sessionMode: "persistent",
          actions: {
            interactive: {
              template: ["-i"],
              startupSequence: [
                {
                  waitMs: STARTUP_SEQUENCE_STEP_WAIT_MS,
                  data: "globalThis.__bootstrapMarker = 'bootstrap-ok'\n",
                },
              ],
            },
          },
        },
      ],
    };
    await fs.writeFile(path.join(tempDir, "agent-bridge.json"), JSON.stringify(bootstrapConfig, null, 2), "utf-8");

    const startResult = await bridgeSessionStartTool.execute({
      targetId: "node-repl-bootstrap",
      action: "interactive",
    }, baseContext);

    expect(startResult.success).toBe(true);
    const started = JSON.parse(startResult.output) as { sessionId: string };

    const writeResult = await bridgeSessionWriteTool.execute({
      sessionId: started.sessionId,
      data: "process.stdout.write(String(globalThis.__bootstrapMarker || 'missing') + '\\n')\n",
      waitMs: SESSION_WRITE_WAIT_MS,
    }, baseContext);
    expect(writeResult.success).toBe(true);
    const payload = JSON.parse(writeResult.output) as { output: string };
    expect(payload.output).toContain("bootstrap-ok");
  }, WINDOWS_SLOW_PTY_TEST_TIMEOUT_MS);

  it("returns startupOutput from bridge_session_start when configured", async () => {
    const startupReadConfig = {
      version: "1.0.0",
      targets: [
        {
          id: "node-repl-startup-output",
          category: "agent-cli",
          transport: "pty",
          enabled: true,
          entry: { binary: process.execPath },
          cwdPolicy: "workspace-only",
          sessionMode: "persistent",
          actions: {
            interactive: {
              template: ["-i"],
              startupSequence: [
                {
                  waitMs: STARTUP_SEQUENCE_STEP_WAIT_MS,
                  data: "process.stdout.write('startup-output-ok\\n')\n",
                },
              ],
              startupReadWaitMs: STARTUP_CAPTURE_WAIT_MS,
            },
          },
        },
      ],
    };
    await fs.writeFile(path.join(tempDir, "agent-bridge.json"), JSON.stringify(startupReadConfig, null, 2), "utf-8");

    const startResult = await bridgeSessionStartTool.execute({
      targetId: "node-repl-startup-output",
      action: "interactive",
    }, baseContext);

    expect(startResult.success).toBe(true);
    const payload = JSON.parse(startResult.output) as { startupOutput?: string };
    expect(payload.startupOutput).toContain("startup-output-ok");
  }, WINDOWS_SLOW_PTY_TEST_TIMEOUT_MS);

  it("returns first-turn guidance from bridge_session_start when configured", async () => {
    const guidedConfig = {
      version: "1.0.0",
      targets: [
        {
          id: "node-repl-guided",
          category: "agent-cli",
          transport: "pty",
          enabled: true,
          entry: { binary: process.execPath },
          cwdPolicy: "workspace-only",
          sessionMode: "persistent",
          actions: {
            interactive: {
              template: ["-i"],
              allowStructuredArgs: ["prompt"],
              firstTurnStrategy: "start-args-prompt",
              firstTurnHint: "首回合建议随 start 提交 prompt。",
              recommendedReadWaitMs: 8000,
            },
          },
        },
      ],
    };
    await fs.writeFile(path.join(tempDir, "agent-bridge.json"), JSON.stringify(guidedConfig, null, 2), "utf-8");

    const startResult = await bridgeSessionStartTool.execute({
      targetId: "node-repl-guided",
      action: "interactive",
    }, baseContext);

    expect(startResult.success).toBe(true);
    const payload = JSON.parse(startResult.output) as {
      firstTurnStrategy?: string;
      firstTurnHint?: string;
      recommendedReadWaitMs?: number;
      firstTurnPromptProvided?: boolean;
      recommendedNextStep?: string;
    };
    expect(payload.firstTurnStrategy).toBe("start-args-prompt");
    expect(payload.firstTurnHint).toBe("首回合建议随 start 提交 prompt。");
    expect(payload.recommendedReadWaitMs).toBe(8000);
    expect(payload.firstTurnPromptProvided).toBe(false);
    expect(payload.recommendedNextStep).toContain("bridge_session_start.prompt");
  });

  it("maps bridge_session_start.prompt into args.prompt for first-turn targets", async () => {
    const promptConfig = {
      version: "1.0.0",
      targets: [
        {
          id: "node-first-turn-prompt",
          category: "agent-cli",
          transport: "pty",
          enabled: true,
          entry: { binary: process.execPath },
          cwdPolicy: "workspace-only",
          sessionMode: "persistent",
          actions: {
            interactive: {
              template: ["-e", "setTimeout(() => {}, 5000)"],
              allowStructuredArgs: ["prompt"],
              firstTurnStrategy: "start-args-prompt",
              firstTurnHint: "首回合建议随 start 提交 prompt。",
              recommendedReadWaitMs: 5000,
            },
          },
        },
      ],
    };
    await fs.writeFile(path.join(tempDir, "agent-bridge.json"), JSON.stringify(promptConfig, null, 2), "utf-8");

    const startResult = await bridgeSessionStartTool.execute({
      targetId: "node-first-turn-prompt",
      action: "interactive",
      prompt: "ship-it",
    }, baseContext);

    expect(startResult.success).toBe(true);
    const payload = JSON.parse(startResult.output) as {
      commandPreview: string;
      firstTurnPromptProvided?: boolean;
      recommendedNextStep?: string;
      sessionId: string;
    };
    expect(payload.commandPreview).toContain("ship-it");
    expect(payload.firstTurnPromptProvided).toBe(true);
    expect(payload.recommendedNextStep).toContain("bridge_session_start.prompt");

    const closeResult = await bridgeSessionCloseTool.execute({
      sessionId: payload.sessionId,
    }, baseContext);
    expect(closeResult.success).toBe(true);
  });

  it("returns first-turn warning when a start-args-prompt target uses write first", async () => {
    const guidedConfig = {
      version: "1.0.0",
      targets: [
        {
          id: "node-repl-guided",
          category: "agent-cli",
          transport: "pty",
          enabled: true,
          entry: { binary: process.execPath },
          cwdPolicy: "workspace-only",
          sessionMode: "persistent",
          actions: {
            interactive: {
              template: ["-i"],
              allowStructuredArgs: ["prompt"],
              firstTurnStrategy: "start-args-prompt",
              firstTurnHint: "首回合建议随 start 提交 prompt。",
              recommendedReadWaitMs: 8000,
            },
          },
        },
      ],
    };
    await fs.writeFile(path.join(tempDir, "agent-bridge.json"), JSON.stringify(guidedConfig, null, 2), "utf-8");

    const startResult = await bridgeSessionStartTool.execute({
      targetId: "node-repl-guided",
      action: "interactive",
    }, baseContext);

    expect(startResult.success).toBe(true);
    const started = JSON.parse(startResult.output) as { sessionId: string };

    await bridgeSessionReadTool.execute({
      sessionId: started.sessionId,
      waitMs: INITIAL_SESSION_READ_WAIT_MS,
    }, baseContext);

    const writeResult = await bridgeSessionWriteTool.execute({
      sessionId: started.sessionId,
      data: "process.stdout.write('guided-write-ok\\n')\n",
      waitMs: SESSION_WRITE_WAIT_MS,
    }, baseContext);

    expect(writeResult.success).toBe(true);
    const payload = JSON.parse(writeResult.output) as {
      output: string;
      firstTurnWarning?: string;
      recommendedNextStep?: string;
      firstTurnPromptProvided?: boolean;
    };
    expect(payload.output).toContain("guided-write-ok");
    expect(payload.firstTurnPromptProvided).toBe(false);
    expect(payload.firstTurnWarning).toContain("bridge_session_start.prompt");
    expect(payload.recommendedNextStep).toContain("重新 start");
  }, WINDOWS_PTY_FLOW_TEST_TIMEOUT_MS);

  it("restores a closed bridge session from persisted registry after in-memory reset", async () => {
    const startResult = await bridgeSessionStartTool.execute({
      targetId: "node-repl",
      action: "interactive",
    }, baseContext);
    expect(startResult.success).toBe(true);
    const started = JSON.parse(startResult.output) as { sessionId: string };

    const closeResult = await bridgeSessionCloseTool.execute({
      sessionId: started.sessionId,
    }, baseContext);
    expect(closeResult.success).toBe(true);

    BridgeSessionStore.resetInstanceForTests();

    const restoredStatus = await bridgeSessionStatusTool.execute({
      sessionId: started.sessionId,
    }, baseContext);
    expect(restoredStatus.success).toBe(true);
    const restoredPayload = JSON.parse(restoredStatus.output) as {
      status: string;
      closeReason?: string;
      artifactPath?: string;
      transcriptPath?: string;
    };
    expect(restoredPayload.status).toBe("closed");
    expect(restoredPayload.closeReason).toBe("manual");
    expect(restoredPayload.artifactPath).toBeTruthy();
    expect(restoredPayload.transcriptPath).toBeTruthy();
  });

  it("restores bridge session registry and live transcript snapshots with UTF-8 BOM", async () => {
    const startResult = await bridgeSessionStartTool.execute({
      targetId: "node-repl",
      action: "interactive",
    }, baseContext);
    expect(startResult.success).toBe(true);
    const started = JSON.parse(startResult.output) as { sessionId: string };

    await bridgeSessionReadTool.execute({
      sessionId: started.sessionId,
      waitMs: INITIAL_SESSION_READ_WAIT_MS,
    }, baseContext);

    const writeResult = await bridgeSessionWriteTool.execute({
      sessionId: started.sessionId,
      data: "process.stdout.write('bom-session-ok\\n')\n",
      waitMs: SESSION_WRITE_WAIT_MS,
    }, baseContext);
    expect(writeResult.success).toBe(true);

    const closeResult = await bridgeSessionCloseTool.execute({
      sessionId: started.sessionId,
    }, baseContext);
    expect(closeResult.success).toBe(true);

    const registryPath = path.join(tempDir, BRIDGE_ARTIFACTS_DIR, "sessions", "registry.json");
    const transcriptSnapshotPath = path.join(
      tempDir,
      BRIDGE_ARTIFACTS_DIR,
      "sessions",
      started.sessionId,
      "transcript.live.json",
    );
    const registryRaw = await fs.readFile(registryPath, "utf-8");
    await fs.writeFile(registryPath, `\uFEFF${registryRaw}`, "utf-8");
    const transcriptRaw = await fs.readFile(transcriptSnapshotPath, "utf-8");
    await fs.writeFile(transcriptSnapshotPath, `\uFEFF${transcriptRaw}`, "utf-8");

    BridgeSessionStore.resetInstanceForTests();

    const restoredStatus = await bridgeSessionStatusTool.execute({
      sessionId: started.sessionId,
    }, baseContext);
    expect(restoredStatus.success).toBe(true);

    await BridgeSessionStore.getInstance().ensureLoaded(tempDir);
    const restoredTranscript = BridgeSessionStore.getInstance().getTranscript(started.sessionId);
    expect(restoredTranscript.some((event) => event.direction === "output" && event.content.includes("bom-session-ok"))).toBe(true);
  }, WINDOWS_PTY_FLOW_TEST_TIMEOUT_MS);

  it("recovers an active ungoverned session as orphan after in-memory reset", async () => {
    const startResult = await bridgeSessionStartTool.execute({
      targetId: "node-repl",
      action: "interactive",
    }, baseContext);
    expect(startResult.success).toBe(true);
    const started = JSON.parse(startResult.output) as { sessionId: string };

    const writeResult = await bridgeSessionWriteTool.execute({
      sessionId: started.sessionId,
      data: "process.stdout.write('recovery-ok\\n')\n",
      waitMs: 200,
    }, baseContext);
    expect(writeResult.success).toBe(true);

    BridgeSessionStore.resetInstanceForTests();

    const restoredStatus = await bridgeSessionStatusTool.execute({
      sessionId: started.sessionId,
    }, baseContext);
    expect(restoredStatus.success).toBe(true);
    const restoredPayload = JSON.parse(restoredStatus.output) as {
      status: string;
      closeReason?: string;
      artifactPath?: string;
      transcriptPath?: string;
    };
    expect(restoredPayload.status).toBe("closed");
    expect(restoredPayload.closeReason).toBe("orphan");
    expect(restoredPayload.artifactPath).toBeTruthy();
    expect(restoredPayload.transcriptPath).toBeTruthy();
  });
});
