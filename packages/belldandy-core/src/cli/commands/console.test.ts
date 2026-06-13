import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AgentRegistry, MockAgent } from "@belldandy/agent";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { startGatewayServer } from "../../server.js";
import { withEnv, resolveWebRoot, cleanupGlobalMemoryManagersForTest } from "../../server-testkit.js";
import { SubTaskRuntimeStore } from "../../task-runtime.js";
import {
  buildConsoleSnapshot,
  extractConsoleRuntimeHeadline,
  renderConsoleSnapshot,
  renderConsoleWatchStatusBar,
} from "./console.js";

beforeAll(() => {
  if (!process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = "test-placeholder-key";
  }
});

afterEach(async () => {
  await cleanupGlobalMemoryManagersForTest();
});

describe("bdd console renderer", () => {
  it("renders the four core sections for D2-MVP", () => {
    const output = renderConsoleSnapshot({
      generatedAt: "2026-04-13 22:00:00",
      stateDir: "C:/Users/admin/.star_sanctuary",
      daemon: {
        running: true,
        pid: 12345,
        uptime: 3723,
        logFile: "gateway.log",
        pidFile: "gateway.pid",
      },
      gateway: {
        wsUrl: "ws://127.0.0.1:28889",
        connected: true,
        paired: false,
      },
      checks: [
        {
          name: "Model connectivity",
          status: "warn",
          message: "HTTP 429",
        },
      ],
      checkSummary: {
        pass: 0,
        warn: 1,
        fail: 0,
      },
      agents: [
        {
          id: "coder",
          displayName: "代码专家",
          model: "MiniMax-M2.5",
          status: "running",
          mainConversationId: "agent:coder:main",
          observabilityHeadline: "running, latest-task=Fix runtime bridge",
          warnings: ["digest-refresh-recommended:4"],
        },
      ],
      agentSummary: {
        total: 1,
        running: 1,
        background: 0,
        idle: 0,
        error: 0,
        other: 0,
        warningAgents: 1,
      },
      subtasks: [
        {
          id: "task_1",
          agentId: "coder",
          status: "queued",
          summary: "Investigate runtime bridge",
          updatedAt: 1_776_087_200_000,
        },
      ],
      subtaskSummary: {
        total: 1,
        active: 0,
        pending: 0,
        running: 0,
        failed: 0,
        done: 0,
        stopped: 0,
        archived: 0,
      },
      runtime: {
        resilienceHeadline: "degraded=1, repeated_failure=0",
        cronHeadline: "2 jobs, next in 5m",
        backgroundHeadline: "1 failed background run",
        delegationHeadline: "1 active, protocol=1",
      },
      sourceErrors: {},
      hints: [
        "Model connectivity: HTTP 429",
      ],
    });

    expect(output).toContain("Belldandy Console");
    expect(output).toContain("Gateway");
    expect(output).toContain("Agents");
    expect(output).toContain("Runtime");
    expect(output).toContain("Hints");
    expect(output).toContain("State Dir");
    expect(output).toContain("Port");
    expect(output).toContain("gateway.log");
    expect(output).toContain("Checks: pass 0, warn 1, fail 0");
    expect(output).toContain("Summary: total 1, running 1, background 0, idle 0, error 0, warnings 1");
    expect(output).toContain("Subtasks: total 1");
    expect(output).toContain("coder");
    expect(output).toContain("Investigate runtime bridge");
  });

  it("renders source error hints when roster or subtasks are unavailable", () => {
    const output = renderConsoleSnapshot({
      generatedAt: "2026-04-13 22:10:00",
      stateDir: "C:/Users/admin/.star_sanctuary",
      daemon: {
        running: false,
        pid: null,
        uptime: null,
        logFile: "gateway.log",
        pidFile: "gateway.pid",
      },
      gateway: {
        wsUrl: "ws://127.0.0.1:28889",
        connected: true,
        paired: false,
      },
      checks: [],
      checkSummary: {
        pass: 0,
        warn: 0,
        fail: 0,
      },
      agents: [],
      agentSummary: {
        total: 0,
        running: 0,
        background: 0,
        idle: 0,
        error: 0,
        other: 0,
        warningAgents: 0,
      },
      subtasks: [],
      subtaskSummary: {
        total: 0,
        active: 0,
        pending: 0,
        running: 0,
        failed: 0,
        done: 0,
        stopped: 0,
        archived: 0,
      },
      runtime: {},
      sourceErrors: {
        roster: "roster unavailable",
        subtasks: "subtasks unavailable",
      },
      hints: [
        "agents roster: roster unavailable",
        "subtasks: subtasks unavailable",
      ],
    });

    expect(output).toContain("Roster: ");
    expect(output).toContain("roster unavailable");
    expect(output).toContain("Subtasks: ");
    expect(output).toContain("subtasks unavailable");
    expect(output).toContain("agents roster: roster unavailable");
  });

  it("accepts runtime headline from both top-level headline and summary.headline", () => {
    expect(extractConsoleRuntimeHeadline({
      headline: "enabled; jobs=1/1; activeRuns=1",
    })).toBe("enabled; jobs=1/1; activeRuns=1");

    expect(extractConsoleRuntimeHeadline({
      summary: {
        headline: "no protocol-backed subtasks observed; active=1; completed=0",
      },
    })).toBe("no protocol-backed subtasks observed; active=1; completed=0");

    expect(extractConsoleRuntimeHeadline({
      headline: "   ",
      summary: {
        headline: "summary fallback",
      },
    })).toBe("summary fallback");
  });

  it("renders a lightweight watch status bar", () => {
    const statusBar = renderConsoleWatchStatusBar({
      generatedAt: "2026-04-13 22:45:00",
      stateDir: "C:/Users/admin/.star_sanctuary",
      daemon: {
        running: true,
        pid: 123,
        uptime: 10,
        logFile: "gateway.log",
        pidFile: "gateway.pid",
      },
      gateway: {
        wsUrl: "ws://127.0.0.1:28889",
        connected: true,
        paired: false,
      },
      checks: [],
      checkSummary: {
        pass: 0,
        warn: 0,
        fail: 0,
      },
      agents: [],
      agentSummary: {
        total: 0,
        running: 0,
        background: 0,
        idle: 0,
        error: 0,
        other: 0,
        warningAgents: 0,
      },
      subtasks: [],
      subtaskSummary: {
        total: 0,
        active: 0,
        pending: 0,
        running: 0,
        failed: 0,
        done: 0,
        stopped: 0,
        archived: 0,
      },
      runtime: {},
      sourceErrors: {},
      hints: [],
    }, 5);

    expect(statusBar).toContain("refresh 5s");
    expect(statusBar).toContain("snapshot 2026-04-13 22:45:00");
    expect(statusBar).toContain("doctor ok");
    expect(statusBar).toContain("roster ok");
    expect(statusBar).toContain("subtasks ok");
    expect(statusBar).toContain("Ctrl+C to exit");
  });

  it("builds a live gateway snapshot with resident agents and subtasks", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-console-"));
    const registry = new AgentRegistry(() => new MockAgent());
    registry.register({
      id: "default",
      displayName: "Belldandy",
      model: "primary",
    });
    registry.register({
      id: "coder",
      displayName: "Coder",
      model: "primary",
      kind: "resident",
      memoryMode: "isolated",
      sessionNamespace: "coder-main",
      workspaceBinding: "current",
      workspaceDir: "coder",
    });

    const subTaskRuntimeStore = new SubTaskRuntimeStore(stateDir);
    await subTaskRuntimeStore.load();
    await subTaskRuntimeStore.createTask({
      launchSpec: {
        parentConversationId: "agent:coder:main",
        agentId: "coder",
        instruction: "Investigate console success path",
        channel: "subtask",
      },
    });

    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentRegistry: registry,
      subTaskRuntimeStore,
      getCronRuntimeDoctorReport: async () => ({
        scheduler: {
          enabled: true,
          running: true,
          activeRuns: 1,
          lastTickAtMs: Date.now(),
        },
        totals: {
          totalJobs: 1,
          enabledJobs: 1,
          disabledJobs: 0,
          staggeredJobs: 0,
          invalidNextRunJobs: 0,
        },
        sessionTargetCounts: {
          main: 1,
          isolated: 0,
        },
        deliveryModeCounts: {
          user: 1,
          none: 0,
        },
        failureDestinationModeCounts: {
          user: 0,
          none: 1,
        },
        recentJobs: [],
        headline: "enabled; jobs=1/1; session main=1; delivery user=1; activeRuns=1",
      }),
      getBackgroundContinuationRuntimeDoctorReport: async () => ({
        totals: {
          totalRuns: 1,
          runningRuns: 1,
          failedRuns: 0,
          skippedRuns: 0,
          conversationLinkedRuns: 1,
          recoverableFailedRuns: 0,
          recoveryAttemptedRuns: 0,
          recoverySucceededRuns: 0,
        },
        kindCounts: {
          cron: 1,
          heartbeat: 0,
          subtask: 0,
        },
        sessionTargetCounts: {
          main: 1,
          isolated: 0,
        },
        recentEntries: [],
        headline: "runs=1; running=1; failed=0; cron=1; linked=1; main=1",
      }),
    });

    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(server.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        const snapshot = await buildConsoleSnapshot(stateDir);
        const rendered = renderConsoleSnapshot(snapshot);

        expect(snapshot.gateway.connected).toBe(true);
        expect(snapshot.gateway.error).toBeUndefined();
        expect(snapshot.sourceErrors.doctor).toBeUndefined();
        expect(snapshot.sourceErrors.subtasks).toBeUndefined();
        expect(snapshot.agents).toEqual(expect.arrayContaining([
          expect.objectContaining({
            id: "default",
            mainConversationId: "agent:default:main",
          }),
          expect.objectContaining({
            id: "coder",
            mainConversationId: "agent:coder:main",
          }),
        ]));
        expect(snapshot.sourceErrors.roster === undefined || snapshot.sourceErrors.roster === "pairing code not found or expired").toBe(true);
        expect(snapshot.subtasks).toEqual(expect.arrayContaining([
          expect.objectContaining({
            agentId: "coder",
            status: "pending",
            summary: "Investigate console success path",
          }),
        ]));
        expect(rendered).toContain("WS: ");
        expect(rendered).toContain("connected");
        expect(rendered).toContain("Summary: total 2");
        expect(rendered).toContain("Subtasks: total 1");
        expect(rendered).toContain("Investigate console success path");
      });
    } finally {
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
