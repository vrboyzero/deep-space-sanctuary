import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationStore, type BelldandyAgent } from "@belldandy/agent";
import { CODING_RUN_PROTOCOL_VERSION } from "../../../coding-run/contracts.js";
import { CodingRunReconciliationJournal } from "../../../coding-run/reconciliation-journal.js";
import { CodingRunRecoveryMarkerStore } from "../../../coding-run/recovery-marker-store.js";
import { ConversationRunRegistry } from "../../../conversation-run-registry.js";
import { startGatewayServer } from "../../../server.js";
import { cleanupGlobalMemoryManagersForTest, resolveWebRoot, waitFor, withEnv } from "../../../server-testkit.js";
import { cancelAgentRunCommand } from "./cancel.js";
import { continueAgentRunCommand } from "./continue.js";
import { followUpAgentRunCommand } from "./follow-up.js";
import { followUpStatusAgentRunCommand } from "./follow-up-status.js";
import { inspectAgentConversation, inspectAgentProjectRules } from "./inspect.js";
import { replaceAgentRunCommand } from "./replace.js";
import { runAgentRunCommand } from "./run.js";
import { statusAgentRunCommand } from "./status.js";
import { steerAgentRunCommand } from "./steer.js";
import { steerStatusAgentRunCommand } from "./steer-status.js";

function diskFullError(): NodeJS.ErrnoException {
  return Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
}

afterEach(async () => {
  await cleanupGlobalMemoryManagersForTest();
});

describe("bdd agent controls", () => {
  it("inspects cwd project rule precedence without exposing rule content or mixing identity rules", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-agent-inspect-state-"));
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-agent-inspect-rules-"));
    const cwd = path.join(root, "packages", "core");
    const stdout: string[] = [];
    const stderr: string[] = [];

    try {
      await fs.promises.mkdir(path.join(root, ".git"));
      await fs.promises.mkdir(cwd, { recursive: true });
      await fs.promises.writeFile(path.join(stateDir, "AGENTS.md"), "identity-private-content\n", "utf-8");
      await fs.promises.writeFile(path.join(root, "AGENTS.md"), "root-private-content\n", "utf-8");
      await fs.promises.writeFile(path.join(cwd, "AGENTS.md"), "cwd-private-content\n", "utf-8");

      expect(await inspectAgentProjectRules({
        stateDir,
        cwd,
        json: true,
        writeStdout: (text) => stdout.push(text),
        writeStderr: (text) => stderr.push(text),
      })).toBe(0);

      const canonicalRoot = await fs.promises.realpath(root);
      const canonicalCwd = await fs.promises.realpath(cwd);
      expect(JSON.parse(stdout.join(""))).toMatchObject({
        kind: "project-rules",
        requestedCwd: path.resolve(cwd),
        cwd: canonicalCwd,
        root: {
          path: canonicalRoot,
          source: "git",
        },
        precedence: "root-to-cwd-later-wins",
        identityRules: {
          source: "state-workspace",
          stateDir: path.resolve(stateDir),
          includedInProjectPrompt: false,
        },
        sources: [
          {
            source: "project",
            path: path.join(canonicalRoot, "AGENTS.md"),
            appliesTo: canonicalRoot,
            priority: 0,
            contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
            sizeBytes: expect.any(Number),
          },
          {
            source: "project",
            path: path.join(canonicalCwd, "AGENTS.md"),
            appliesTo: canonicalCwd,
            priority: 1,
            contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
            sizeBytes: expect.any(Number),
          },
        ],
        skipped: [],
        prompt: {
          contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
          charLength: expect.any(Number),
          sourceCount: 2,
        },
      });
      expect(stdout.join("")).not.toContain("private-content");
      expect(stderr).toEqual([]);
    } finally {
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
      await fs.promises.rm(root, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("adds live semantic evidence to cwd inspection for an explicit symbol query", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-agent-inspect-code-intel-state-"));
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-agent-inspect-code-intel-"));
    const stdout: string[] = [];
    const stderr: string[] = [];

    try {
      await fs.promises.mkdir(path.join(root, ".git"));
      await fs.promises.mkdir(path.join(root, "src"));
      await fs.promises.writeFile(path.join(root, "AGENTS.md"), "Inspect this project.\n", "utf-8");
      await fs.promises.writeFile(path.join(root, "tsconfig.json"), JSON.stringify({
        compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext" },
        include: ["src/**/*.ts"],
      }), "utf-8");
      await fs.promises.writeFile(
        path.join(root, "src", "greeter.ts"),
        "export function createGreeter(): string { return \"hello\"; }\n",
        "utf-8",
      );

      const exitCode = await inspectAgentProjectRules({
        stateDir,
        cwd: root,
        symbol: "createGreeter",
        json: true,
        writeStdout: (text) => stdout.push(text),
        writeStderr: (text) => stderr.push(text),
      });
      expect(exitCode).toBe(0);

      expect(JSON.parse(stdout.join(""))).toMatchObject({
        kind: "project-rules",
        codeIntel: {
          status: "completed",
          query: {
            operation: "symbols",
            query: "createGreeter",
            requiredCapability: "semantic-live",
          },
          evidence: {
            contractVersion: "code-intel/v1",
            coordinateSystem: "zero-based-line-column",
            items: [expect.objectContaining({
              location: expect.objectContaining({ path: "src/greeter.ts" }),
            })],
            page: { returned: 1, truncated: false },
            freshness: { status: "fresh" },
            provenance: {
              providerId: "typescript-language-service",
              providerVersion: expect.any(String),
              capability: "semantic-live",
              workspaceRevision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
            },
            diagnostics: [],
          },
          fallback: {
            used: false,
            reason: null,
          },
        },
      });
      expect(stderr).toEqual([]);
    } finally {
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
      await fs.promises.rm(root, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("continues one Conversation and inspects its Gateway-owned metadata", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-agent-controls-"));
    const conversationId = "agent-cli-continue";
    const observedConversationIds: string[] = [];
    const agent: BelldandyAgent = {
      async *run(input) {
        observedConversationIds.push(input.conversationId);
        yield { type: "status", status: "running" };
        yield { type: "final", text: `echo:${input.text}` };
      },
    };
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => agent,
    });
    const stdout: string[] = [];
    const stderr: string[] = [];

    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(server.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        expect(await runAgentRunCommand({
          stateDir,
          prompt: "first",
          conversationId,
          jsonl: true,
          writeStdout: (text) => stdout.push(text),
          writeStderr: (text) => stderr.push(text),
        })).toBe(0);

        stdout.length = 0;
        expect(await continueAgentRunCommand({
          stateDir,
          conversationId,
          prompt: "second",
          jsonl: true,
          writeStdout: (text) => stdout.push(text),
          writeStderr: (text) => stderr.push(text),
        })).toBe(0);

        const inspectStdout: string[] = [];
        expect(await inspectAgentConversation({
          stateDir,
          conversationId,
          json: true,
          writeStdout: (text) => inspectStdout.push(text),
          writeStderr: (text) => stderr.push(text),
        })).toBe(0);

        expect(observedConversationIds).toEqual([conversationId, conversationId]);
        const events = stdout.join("").trim().split("\n").map((line) => JSON.parse(line) as { binding: { conversationId?: string } });
        expect(events.every((event) => event.binding.conversationId === conversationId)).toBe(true);
        expect(JSON.parse(inspectStdout.join(""))).toMatchObject({
          conversationId,
          messages: expect.any(Array),
        });
        expect(stderr).toEqual([]);
      });
    } finally {
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("sends the output schema contract when continuing a Conversation", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-agent-continue-schema-"));
    const conversationId = "agent-cli-continue-schema";
    let observedPrompt = "";
    const agent: BelldandyAgent = {
      async *run(input) {
        if (input.text.includes("## Output Schema Contract")) observedPrompt = input.text;
        yield { type: "final", text: JSON.stringify({ status: "continued" }) };
      },
    };
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => agent,
    });

    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(server.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        expect(await runAgentRunCommand({
          stateDir,
          conversationId,
          prompt: "Start the structured conversation.",
          jsonl: true,
          writeStdout: () => {},
          writeStderr: () => {},
        })).toBe(0);

        expect(await continueAgentRunCommand({
          stateDir,
          conversationId,
          prompt: "Continue and return the requested JSON.",
          jsonl: true,
          outputSchema: {
            type: "object",
            required: ["status"],
            additionalProperties: false,
            properties: { status: { const: "continued" } },
          },
          writeStdout: () => {},
          writeStderr: () => {},
        })).toBe(0);
      });

      expect(observedPrompt).toContain("## Output Schema Contract");
      expect(observedPrompt).toContain('"status":{"const":"continued"}');
      expect(observedPrompt).toContain("Return only raw JSON that validates against this schema.");
    } finally {
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("reports an exact Conversation run as interrupted after its runtime owner is lost", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-agent-status-lost-"));
    const binding = { conversationId: "conversation-lost", agentRunId: "run-lost" };
    const previousStore = new CodingRunRecoveryMarkerStore(stateDir, {
      ownerInstanceId: "gateway-before-restart",
      ownerProcessId: 101,
      isProcessAlive: () => false,
    });
    await previousStore.markActive({ source: "conversation", binding, startedAtMs: 100 });
    const journal = new CodingRunReconciliationJournal(stateDir);
    journal.record({
      version: CODING_RUN_PROTOCOL_VERSION,
      seq: 1,
      timestampMs: 100,
      source: "conversation",
      binding,
      type: "run.started",
      payload: { status: "running" },
    });
    journal.record({
      version: CODING_RUN_PROTOCOL_VERSION,
      seq: 2,
      timestampMs: 110,
      source: "conversation",
      binding,
      type: "tool.started",
      payload: { tool: { id: "tool-lost", name: "file_write", arguments: { secret: "hidden" } } },
    });
    journal.record({
      version: CODING_RUN_PROTOCOL_VERSION,
      seq: 3,
      timestampMs: 120,
      source: "conversation",
      binding,
      type: "tool.completed",
      payload: { tool: { id: "tool-lost", name: "file_write", success: true, output: "hidden" } },
    });
    const restartedStore = new CodingRunRecoveryMarkerStore(stateDir, {
      ownerInstanceId: "gateway-after-restart",
      ownerProcessId: 202,
      isProcessAlive: () => false,
    });
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      conversationRunRegistry: new ConversationRunRegistry({ recoveryStore: restartedStore }),
      agentFactory: () => ({ async *run() { yield { type: "final", text: "unused" }; } }),
    });
    const stdout: string[] = [];
    const stderr: string[] = [];

    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(server.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        expect(await statusAgentRunCommand({
          stateDir,
          ...binding,
          json: true,
          writeStdout: (text) => stdout.push(text),
          writeStderr: (text) => stderr.push(text),
        })).toBe(0);
      });

      expect(JSON.parse(stdout.join(""))).toMatchObject({
        source: "conversation",
        status: "interrupted",
        binding,
        evidence: {
          runtimeState: "lost",
          lastObservedState: "active",
          reconciliation: {
            state: "uncertain",
            journalState: "available",
            observedOperationCount: 1,
            appliedOperationCount: 0,
            uncertainOperationCount: 1,
            operations: [{
              toolName: "file_write",
              state: "uncertain",
              evidence: "workspace_mutation_evidence_unavailable",
            }],
          },
        },
      });
      expect(stdout.join("")).not.toContain("hidden");
      expect(stderr).toEqual([]);
    } finally {
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("does not settle a recovery marker when completion journal persistence hits ENOSPC", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-agent-journal-sink-down-"));
    const recoveryStore = new CodingRunRecoveryMarkerStore(stateDir, {
      ownerInstanceId: "gateway-before-sink-failure",
      ownerProcessId: 101,
      isProcessAlive: () => false,
    });
    const registry = new ConversationRunRegistry({ recoveryStore });
    const durableJournal = new CodingRunReconciliationJournal(stateDir);
    const journalWithCompletionFailure = {
      record: (event: Parameters<CodingRunReconciliationJournal["record"]>[0]) => {
        if (event.type === "tool.completed") throw diskFullError();
        return durableJournal.record(event);
      },
      reconcile: durableJournal.reconcile.bind(durableJournal),
    };
    let sideEffectApplied = false;
    const agent: BelldandyAgent = {
      async *run() {
        yield { type: "tool_call", id: "tool-sink-down", name: "file_write", arguments: { secret: "hidden" } };
        sideEffectApplied = true;
        yield { type: "tool_result", id: "tool-sink-down", name: "file_write", success: true, output: "hidden" };
        yield { type: "final", text: "must-not-complete" };
      },
    };
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      conversationRunRegistry: registry,
      codingRunReconciliationJournal: journalWithCompletionFailure,
      agentFactory: () => agent,
    });
    const stdout: string[] = [];
    const stderr: string[] = [];

    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(server.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        expect(await runAgentRunCommand({
          stateDir,
          prompt: "apply one mutation",
          conversationId: "conversation-sink-down",
          jsonl: true,
          writeStdout: (text) => stdout.push(text),
          writeStderr: (text) => stderr.push(text),
        })).not.toBe(0);
      });

      expect(sideEffectApplied).toBe(true);
      await waitFor(() => registry.getRuntimeSnapshot().activeCount === 0);
      expect(registry.getRuntimeSnapshot()).toEqual({ activeCount: 0, stopRequestedCount: 0 });
      const events = stdout.join("").trim().split("\n").filter(Boolean)
        .map((line) => JSON.parse(line) as { binding?: { agentRunId?: string }; type?: string });
      const agentRunId = events.find((event) => event.binding?.agentRunId)?.binding?.agentRunId;
      expect(agentRunId).toBeTruthy();
      if (!agentRunId) throw new Error("expected run binding");

      const restartedStore = new CodingRunRecoveryMarkerStore(stateDir, {
        ownerInstanceId: "gateway-after-sink-failure",
        ownerProcessId: 202,
        isProcessAlive: () => false,
      });
      await expect(restartedStore.lookup({
        source: "conversation",
        binding: { conversationId: "conversation-sink-down", agentRunId },
      })).resolves.toMatchObject({ state: "lost" });
      await expect(durableJournal.reconcile({
        conversationId: "conversation-sink-down",
        agentRunId,
      })).resolves.toMatchObject({
        state: "uncertain",
        appliedOperationCount: 0,
        uncertainOperationCount: 1,
        operations: [{ toolName: "file_write", state: "started" }],
      });
      expect(stdout.join("")).not.toContain("hidden");
    } finally {
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("cleans up a durable run before Agent execution when the initial journal record hits ENOSPC", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-agent-initial-journal-failure-"));
    let activeBinding: { source: "conversation"; binding: { conversationId: string; agentRunId: string } } | undefined;
    const markSettled = vi.fn(async () => true);
    const registry = new ConversationRunRegistry({
      recoveryStore: {
        markActive: vi.fn(async (input) => {
          activeBinding = { source: "conversation", binding: { ...input.binding } as { conversationId: string; agentRunId: string } };
        }),
        markSettled,
        lookup: vi.fn(async () => ({ state: "not_found" as const })),
      },
    });
    let agentStarted = false;
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      conversationRunRegistry: registry,
      codingRunReconciliationJournal: {
        record: () => { throw diskFullError(); },
        reconcile: async () => ({
          state: "uncertain",
          journalState: "unavailable",
          observedOperationCount: 0,
          mutationOperationCount: 0,
          appliedOperationCount: 0,
          uncertainOperationCount: 1,
          reason: "journal_unavailable",
          operations: [],
        }),
      },
      agentFactory: () => ({
        async *run() {
          agentStarted = true;
          yield { type: "final", text: "must-not-run" };
        },
      }),
    });

    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(server.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        expect(await runAgentRunCommand({
          stateDir,
          prompt: "must fail before execution",
          conversationId: "conversation-initial-journal-failure",
          jsonl: true,
          writeStdout: () => undefined,
          writeStderr: () => undefined,
        })).not.toBe(0);
      });

      expect(agentStarted).toBe(false);
      expect(registry.getRuntimeSnapshot()).toEqual({ activeCount: 0, stopRequestedCount: 0 });
      expect(markSettled).toHaveBeenCalledWith(activeBinding);
    } finally {
      if (activeBinding) registry.clear(activeBinding.binding.conversationId, activeBinding.binding.agentRunId);
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("removes reconciliation evidence after a durable run settles", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-agent-journal-settled-"));
    const remove = vi.fn(async () => true);
    const registry = new ConversationRunRegistry({
      recoveryStore: {
        markActive: vi.fn(async () => undefined),
        markSettled: vi.fn(async () => true),
        lookup: vi.fn(async () => ({ state: "not_found" as const })),
      },
    });
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      conversationRunRegistry: registry,
      codingRunReconciliationJournal: {
        record: () => true,
        remove,
        reconcile: async () => ({
          state: "none",
          journalState: "available",
          observedOperationCount: 0,
          mutationOperationCount: 0,
          appliedOperationCount: 0,
          uncertainOperationCount: 0,
          operations: [],
        }),
      },
      agentFactory: () => ({
        async *run() {
          yield { type: "final", text: "done" };
        },
      }),
    });

    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(server.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        expect(await runAgentRunCommand({
          stateDir,
          prompt: "complete without a mutation",
          conversationId: "conversation-journal-settled",
          jsonl: true,
          writeStdout: () => undefined,
          writeStderr: () => undefined,
        })).toBe(0);
      });

      expect(registry.getRuntimeSnapshot()).toEqual({ activeCount: 0, stopRequestedCount: 0 });
      expect(remove).toHaveBeenCalledOnce();
      expect(remove).toHaveBeenCalledWith(expect.objectContaining({
        conversationId: "conversation-journal-settled",
      }));
    } finally {
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("cancels only the bound active Conversation run", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-agent-cancel-"));
    const agent: BelldandyAgent = {
      async *run(input) {
        yield { type: "status", status: "running" };
        await new Promise<void>((resolve) => {
          if (input.abortSignal?.aborted) {
            resolve();
            return;
          }
          input.abortSignal?.addEventListener("abort", () => resolve(), { once: true });
        });
        yield { type: "status", status: "stopped" };
      },
    };
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => agent,
    });
    const stdout: string[] = [];
    const stderr: string[] = [];
    let resolveBinding: ((binding: { conversationId: string; agentRunId: string }) => void) | undefined;
    const bindingReady = new Promise<{ conversationId: string; agentRunId: string }>((resolve) => {
      resolveBinding = resolve;
    });

    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(server.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        const run = runAgentRunCommand({
          stateDir,
          prompt: "wait for cancellation",
          jsonl: true,
          writeStdout: (text) => {
            stdout.push(text);
            const event = JSON.parse(text) as { type?: string; binding?: { conversationId?: string; agentRunId?: string } };
            if (event.type === "run.started" && event.binding?.conversationId && event.binding.agentRunId) {
              resolveBinding?.({
                conversationId: event.binding.conversationId,
                agentRunId: event.binding.agentRunId,
              });
            }
          },
          writeStderr: (text) => stderr.push(text),
        });
        const binding = await bindingReady;

        const statusStdout: string[] = [];
        expect(await statusAgentRunCommand({
          stateDir,
          ...binding,
          json: true,
          writeStdout: (text) => statusStdout.push(text),
          writeStderr: (text) => stderr.push(text),
        })).toBe(0);
        expect(JSON.parse(statusStdout.join(""))).toMatchObject({
          source: "conversation",
          status: "running",
          binding,
          evidence: { registryState: "running" },
        });

        const cancelStdout: string[] = [];
        expect(await cancelAgentRunCommand({
          stateDir,
          ...binding,
          reason: "test cancellation",
          json: true,
          writeStdout: (text) => cancelStdout.push(text),
          writeStderr: (text) => stderr.push(text),
        })).toBe(0);
        expect(await run).toBe(5);

        expect(JSON.parse(cancelStdout.join(""))).toMatchObject({
          operation: "cancel",
          binding,
        });
        expect(stdout.join("")).toContain('"type":"run.cancelled"');
        expect(stderr).toEqual([]);
      });
    } finally {
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 10_000);

  it("queues and observes a bound Conversation follow-up", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-agent-follow-up-"));
    const prompts: string[] = [];
    let finishFirstRun: (() => void) | undefined;
    const firstRunPending = new Promise<void>((resolve) => {
      finishFirstRun = resolve;
    });
    const agent: BelldandyAgent = {
      async *run(input) {
        prompts.push(input.text);
        yield { type: "status", status: "running" };
        if (prompts.length === 1) await firstRunPending;
        yield { type: "final", text: `echo:${input.text}` };
        yield { type: "status", status: "done" };
      },
    };
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => agent,
    });
    let resolveBinding: ((binding: { conversationId: string; agentRunId: string }) => void) | undefined;
    const bindingReady = new Promise<{ conversationId: string; agentRunId: string }>((resolve) => {
      resolveBinding = resolve;
    });
    const stderr: string[] = [];

    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(server.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        const run = runAgentRunCommand({
          stateDir,
          prompt: "first turn",
          jsonl: true,
          writeStdout: (text) => {
            const event = JSON.parse(text) as { type?: string; binding?: { conversationId?: string; agentRunId?: string } };
            if (event.type === "run.started" && event.binding?.conversationId && event.binding.agentRunId) {
              resolveBinding?.({
                conversationId: event.binding.conversationId,
                agentRunId: event.binding.agentRunId,
              });
            }
          },
          writeStderr: (text) => stderr.push(text),
        });
        const binding = await bindingReady;
        const enqueueStdout: string[] = [];
        expect(await followUpAgentRunCommand({
          stateDir,
          ...binding,
          prompt: "second turn",
          idempotencyKey: "cli-follow-up-1",
          json: true,
          writeStdout: (text) => enqueueStdout.push(text),
          writeStderr: (text) => stderr.push(text),
        })).toBe(0);
        const queued = JSON.parse(enqueueStdout.join(""));
        expect(queued).toMatchObject({
          accepted: true,
          replayed: false,
          operation: "conversation.follow_up",
          command: { status: "queued", sourceBinding: binding },
        });

        finishFirstRun?.();
        expect(await run).toBe(0);
        await waitFor(() => prompts.length === 2);

        const statusStdout: string[] = [];
        expect(await followUpStatusAgentRunCommand({
          stateDir,
          ...binding,
          commandId: queued.command.commandId,
          json: true,
          writeStdout: (text) => statusStdout.push(text),
          writeStderr: (text) => stderr.push(text),
        })).toBe(0);
        const status = JSON.parse(statusStdout.join(""));
        expect(status).toMatchObject({
          status: "delivered",
          sourceBinding: binding,
          nextBinding: { conversationId: binding.conversationId },
        });
        expect(status.nextBinding.agentRunId).not.toBe(binding.agentRunId);
        expect(prompts).toEqual(["first turn", "second turn"]);
        expect(stderr).toEqual([]);
      });
    } finally {
      finishFirstRun?.();
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 10_000);

  it("replaces a bound Conversation run and exposes the replacement command", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-agent-replace-"));
    const prompts: string[] = [];
    const agent: BelldandyAgent = {
      async *run(input) {
        prompts.push(input.text);
        yield { type: "status", status: "running" };
        if (prompts.length === 1) {
          await new Promise<void>((resolve) => {
            if (input.abortSignal?.aborted) {
              resolve();
              return;
            }
            input.abortSignal?.addEventListener("abort", () => resolve(), { once: true });
          });
          yield { type: "status", status: "stopped" };
          return;
        }
        yield { type: "final", text: `done:${input.text}` };
        yield { type: "status", status: "done" };
      },
    };
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => agent,
    });
    let resolveBinding: ((binding: { conversationId: string; agentRunId: string }) => void) | undefined;
    const bindingReady = new Promise<{ conversationId: string; agentRunId: string }>((resolve) => {
      resolveBinding = resolve;
    });
    const stderr: string[] = [];

    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(server.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        const run = runAgentRunCommand({
          stateDir,
          prompt: "obsolete turn",
          jsonl: true,
          writeStdout: (text) => {
            const event = JSON.parse(text) as { type?: string; binding?: { conversationId?: string; agentRunId?: string } };
            if (event.type === "run.started" && event.binding?.conversationId && event.binding.agentRunId) {
              resolveBinding?.({
                conversationId: event.binding.conversationId,
                agentRunId: event.binding.agentRunId,
              });
            }
          },
          writeStderr: (text) => stderr.push(text),
        });
        const binding = await bindingReady;
        const replaceStdout: string[] = [];
        expect(await replaceAgentRunCommand({
          stateDir,
          ...binding,
          prompt: "replacement turn",
          idempotencyKey: "cli-replace-1",
          json: true,
          writeStdout: (text) => replaceStdout.push(text),
          writeStderr: (text) => stderr.push(text),
        })).toBe(0);
        const replacement = JSON.parse(replaceStdout.join(""));
        expect(replacement).toMatchObject({
          accepted: true,
          stopRequested: true,
          operation: "conversation.replace",
          command: { intent: "replace", status: "queued", sourceBinding: binding },
        });

        expect(await run).toBe(5);
        await waitFor(() => prompts.length === 2);
        const statusStdout: string[] = [];
        expect(await followUpStatusAgentRunCommand({
          stateDir,
          ...binding,
          commandId: replacement.command.commandId,
          json: true,
          writeStdout: (text) => statusStdout.push(text),
          writeStderr: (text) => stderr.push(text),
        })).toBe(0);
        expect(JSON.parse(statusStdout.join(""))).toMatchObject({
          intent: "replace",
          status: "delivered",
          sourceBinding: binding,
          nextBinding: { conversationId: binding.conversationId },
        });
        expect(prompts).toEqual(["obsolete turn", "replacement turn"]);
        expect(stderr).toEqual([]);
      });
    } finally {
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 10_000);

  it("steers the same Conversation run at its next model boundary", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-agent-steer-"));
    const conversationStore = new ConversationStore({ dataDir: path.join(stateDir, "sessions") });
    let releaseFirstModel: (() => void) | undefined;
    const firstModelPending = new Promise<void>((resolve) => {
      releaseFirstModel = resolve;
    });
    const deliveredPrompts: string[] = [];
    let runCalls = 0;
    const agent: BelldandyAgent = {
      getCodingRunCapabilities: () => ({ maxCostUsd: false, steerAtModelBoundary: true }),
      async *run(input) {
        runCalls++;
        yield { type: "status", status: "running" };
        await firstModelPending;
        if (!input.steering) throw new Error("steering mailbox missing");
        if (input.steering.sealIfIdle()) {
          yield { type: "final", text: "completed without steer" };
          yield { type: "status", status: "done" };
          return;
        }
        const commands = await input.steering.consumePending({ modelCallIndex: 2 });
        deliveredPrompts.push(...commands.map((command) => command.prompt));
        input.steering.sealIfIdle();
        yield { type: "final", text: `steered:${commands.map((command) => command.prompt).join("|")}` };
        yield { type: "status", status: "done" };
      },
    };
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      conversationStore,
      agentFactory: () => agent,
    });
    let resolveBinding: ((binding: { conversationId: string; agentRunId: string }) => void) | undefined;
    const bindingReady = new Promise<{ conversationId: string; agentRunId: string }>((resolve) => {
      resolveBinding = resolve;
    });
    const stderr: string[] = [];

    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(server.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        const run = runAgentRunCommand({
          stateDir,
          prompt: "initial turn",
          jsonl: true,
          writeStdout: (text) => {
            const event = JSON.parse(text) as { type?: string; binding?: { conversationId?: string; agentRunId?: string } };
            if (event.type === "run.started" && event.binding?.conversationId && event.binding.agentRunId) {
              resolveBinding?.({
                conversationId: event.binding.conversationId,
                agentRunId: event.binding.agentRunId,
              });
            }
          },
          writeStderr: (text) => stderr.push(text),
        });
        const binding = await bindingReady;
        const steerStdout: string[] = [];
        expect(await steerAgentRunCommand({
          stateDir,
          ...binding,
          prompt: "focus the regression",
          idempotencyKey: "cli-steer-1",
          json: true,
          writeStdout: (text) => steerStdout.push(text),
          writeStderr: (text) => stderr.push(text),
        })).toBe(0);
        const steer = JSON.parse(steerStdout.join(""));
        expect(steer).toMatchObject({
          accepted: true,
          replayed: false,
          operation: "conversation.steer",
          command: { intent: "steer", status: "queued", sourceBinding: binding },
        });

        releaseFirstModel?.();
        expect(await run).toBe(0);
        const statusStdout: string[] = [];
        expect(await steerStatusAgentRunCommand({
          stateDir,
          ...binding,
          commandId: steer.command.commandId,
          json: true,
          writeStdout: (text) => statusStdout.push(text),
          writeStderr: (text) => stderr.push(text),
        })).toBe(0);

        expect(JSON.parse(statusStdout.join(""))).toMatchObject({
          intent: "steer",
          status: "delivered",
          sourceBinding: binding,
          deliveredModelCallIndex: 2,
        });
        expect(runCalls).toBe(1);
        expect(deliveredPrompts).toEqual(["focus the regression"]);
        expect((await conversationStore.getConversationHistoryCompacted(binding.conversationId)).history)
          .toEqual([
            { role: "user", content: "initial turn" },
            { role: "user", content: "focus the regression" },
            { role: "assistant", content: "steered:focus the regression" },
          ]);
        expect(stderr).toEqual([]);
      });
    } finally {
      releaseFirstModel?.();
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 10_000);
});
