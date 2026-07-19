import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DelegationProtocol } from "@belldandy/skills";
import { SubAgentOrchestrator, type OrchestratorOptions } from "./orchestrator.js";
import { AgentRegistry } from "./agent-registry.js";
import { ConversationStore } from "./conversation.js";
import type { AgentContentPart, BelldandyAgent, AgentStreamItem, AgentRunInput } from "./index.js";
import type { AgentProfile } from "./agent-profile.js";
import { cleanupSharedCompressedContextStore, getSharedCompressedContextStore } from "./shared-compressed-context.js";

// ─── Helpers ─────────────────────────────────────────────────────────────

function createMockAgent(response: string, delayMs = 0): BelldandyAgent {
  return {
    async *run(_input: AgentRunInput): AsyncIterable<AgentStreamItem> {
      yield { type: "status", status: "running" };
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      yield { type: "delta", delta: response };
      yield { type: "final", text: response };
      yield { type: "status", status: "done" };
    },
  };
}

function createErrorAgent(errorMsg: string): BelldandyAgent {
  return {
    async *run(_input: AgentRunInput): AsyncIterable<AgentStreamItem> {
      yield { type: "status", status: "running" };
      throw new Error(errorMsg);
    },
  };
}

function createSlowAgent(delayMs: number): BelldandyAgent {
  return {
    async *run(_input: AgentRunInput): AsyncIterable<AgentStreamItem> {
      yield { type: "status", status: "running" };
      await new Promise((r) => setTimeout(r, delayMs));
      yield { type: "final", text: "slow result" };
      yield { type: "status", status: "done" };
    },
  };
}

const defaultProfile: AgentProfile = {
  id: "default",
  displayName: "Default",
  model: "primary",
};

const coderProfile: AgentProfile = {
  id: "coder",
  displayName: "Coder",
  model: "primary",
};

function setup(overrides?: Partial<OrchestratorOptions>) {
  const conversationStore = new ConversationStore();
  const registry = new AgentRegistry(() => createMockAgent("default response"));
  registry.register(defaultProfile);

  const orchestrator = new SubAgentOrchestrator({
    agentRegistry: registry,
    conversationStore,
    ...overrides,
  });

  return { orchestrator, registry, conversationStore };
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("SubAgentOrchestrator", () => {
  beforeEach(() => {
    cleanupSharedCompressedContextStore("team-shared-context");
  });

  describe("spawn", () => {
    it("should spawn a sub-agent and return result", async () => {
      const { orchestrator } = setup();

      const result = await orchestrator.spawn({
        parentConversationId: "parent-1",
        instruction: "Write a hello world function",
      });

      expect(result.success).toBe(true);
      expect(result.output).toBe("default response");
      expect(result.sessionId).toMatch(/^sub_/);
    });

    it("releases optional agent conversation state after the stream finalizes", async () => {
      let finalized = false;
      const releaseConversation = vi.fn(() => {
        expect(finalized).toBe(true);
      });
      const agent: BelldandyAgent = {
        async *run(): AsyncIterable<AgentStreamItem> {
          try {
            yield { type: "final", text: "released response" };
          } finally {
            finalized = true;
          }
        },
        releaseConversation,
      };
      const registry = new AgentRegistry(() => agent);
      registry.register(defaultProfile);
      const conversationStore = new ConversationStore();
      const orchestrator = new SubAgentOrchestrator({
        agentRegistry: registry,
        conversationStore,
      });

      const result = await orchestrator.spawn({
        parentConversationId: "parent-release",
        instruction: "Release after completion",
      });

      expect(result.success).toBe(true);
      expect(releaseConversation).toHaveBeenCalledOnce();
      expect(releaseConversation).toHaveBeenCalledWith(result.sessionId);
    });

    it("preserves the spawn result when asynchronous conversation release fails", async () => {
      const warn = vi.fn();
      const agent: BelldandyAgent = {
        async *run(): AsyncIterable<AgentStreamItem> {
          yield { type: "final", text: "release failure is isolated" };
        },
        async releaseConversation(): Promise<void> {
          throw new Error("release failed");
        },
      };
      const registry = new AgentRegistry(() => agent);
      registry.register(defaultProfile);
      const conversationStore = new ConversationStore();
      const storeRelease = vi.spyOn(conversationStore, "releaseConversation");
      const orchestrator = new SubAgentOrchestrator({
        agentRegistry: registry,
        conversationStore,
        logger: {
          info: vi.fn(),
          warn,
          error: vi.fn(),
          debug: vi.fn(),
        },
      });

      const result = await orchestrator.spawn({
        parentConversationId: "parent-release-error",
        instruction: "Keep the result",
      });
      await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce());
      await vi.waitFor(() => expect(storeRelease).toHaveBeenCalledWith(result.sessionId));

      expect(result).toMatchObject({
        success: true,
        output: "release failure is isolated",
      });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("conversation release failed"),
        expect.objectContaining({ error: expect.any(Error) }),
      );
    });

    it("releases ConversationStore only after session_end and agent release settle", async () => {
      let resolveSessionEnd!: () => void;
      const sessionEndPending = new Promise<void>((resolve) => {
        resolveSessionEnd = resolve;
      });
      let resolveAgentRelease!: () => void;
      const agentReleasePending = new Promise<void>((resolve) => {
        resolveAgentRelease = resolve;
      });
      const agent: BelldandyAgent = {
        async *run(): AsyncIterable<AgentStreamItem> {
          yield { type: "final", text: "barrier response" };
        },
        releaseConversation: vi.fn(() => agentReleasePending),
      };
      const registry = new AgentRegistry(() => agent);
      registry.register(defaultProfile);
      const conversationStore = new ConversationStore();
      const storeRelease = vi.spyOn(conversationStore, "releaseConversation");
      const orchestrator = new SubAgentOrchestrator({
        agentRegistry: registry,
        conversationStore,
        hookRunner: {
          runSessionStart: vi.fn(async () => {}),
          runSessionEnd: vi.fn(() => sessionEndPending),
        },
      });

      const result = await orchestrator.spawn({
        parentConversationId: "parent-store-release-barrier",
        instruction: "Wait for both barrier branches",
      });

      expect(result.success).toBe(true);
      expect(storeRelease).not.toHaveBeenCalled();
      resolveSessionEnd();
      await Promise.resolve();
      expect(storeRelease).not.toHaveBeenCalled();
      resolveAgentRelease();

      await vi.waitFor(() => expect(storeRelease).toHaveBeenCalledOnce());
      expect(storeRelease).toHaveBeenCalledWith(result.sessionId);
    });

    it("does not block the next queued spawn while the completion barrier is pending", async () => {
      let resolveFirstSessionEnd!: () => void;
      const firstSessionEndPending = new Promise<void>((resolve) => {
        resolveFirstSessionEnd = resolve;
      });
      let sessionEndCalls = 0;
      const registry = new AgentRegistry(() => createMockAgent("queue drain response"));
      registry.register(defaultProfile);
      const conversationStore = new ConversationStore();
      const storeRelease = vi.spyOn(conversationStore, "releaseConversation");
      const orchestrator = new SubAgentOrchestrator({
        agentRegistry: registry,
        conversationStore,
        maxConcurrent: 1,
        hookRunner: {
          runSessionStart: vi.fn(async () => {}),
          runSessionEnd: vi.fn(() => {
            sessionEndCalls += 1;
            return sessionEndCalls === 1 ? firstSessionEndPending : Promise.resolve();
          }),
        },
      });

      const first = orchestrator.spawn({
        parentConversationId: "parent-barrier-queue-first",
        instruction: "First barrier run",
      });
      const second = orchestrator.spawn({
        parentConversationId: "parent-barrier-queue-second",
        instruction: "Second barrier run",
      });
      const [firstResult, secondResult] = await Promise.all([first, second]);

      expect(firstResult.success).toBe(true);
      expect(secondResult.success).toBe(true);
      expect(sessionEndCalls).toBe(2);
      expect(storeRelease).toHaveBeenCalledWith(secondResult.sessionId);
      expect(storeRelease).not.toHaveBeenCalledWith(firstResult.sessionId);

      resolveFirstSessionEnd();
      await vi.waitFor(() => expect(storeRelease).toHaveBeenCalledWith(firstResult.sessionId));
    });

    it("should spawn with a specific agent ID", async () => {
      const { orchestrator, registry } = setup();
      registry.register(coderProfile);
      // Override the factory to return a different response for coder
      const coderAgent = createMockAgent("coder response");
      // Clear cached instance and re-register with custom factory
      const customRegistry = new AgentRegistry((profile) => {
        if (profile.id === "coder") return coderAgent;
        return createMockAgent("default response");
      });
      customRegistry.register(defaultProfile);
      customRegistry.register(coderProfile);

      const orch = new SubAgentOrchestrator({
        agentRegistry: customRegistry,
        conversationStore: new ConversationStore(),
      });

      const result = await orch.spawn({
        parentConversationId: "parent-1",
        agentId: "coder",
        instruction: "Write tests",
      });

      expect(result.success).toBe(true);
      expect(result.output).toBe("coder response");
    });

    it("should forward modelOverride from launchSpec to AgentRegistry.create", async () => {
      const calls: Array<string | undefined> = [];
      const registry = new AgentRegistry((_profile, opts) => {
        calls.push(opts?.modelOverride);
        return createMockAgent("model override response");
      });
      registry.register(defaultProfile);

      const orch = new SubAgentOrchestrator({
        agentRegistry: registry,
        conversationStore: new ConversationStore(),
      });

      const result = await orch.spawn({
        launchSpec: {
          parentConversationId: "parent-1",
          instruction: "Use model override",
          modelOverride: "claude-opus",
        },
      });

      expect(result.success).toBe(true);
      expect(calls).toEqual(["claude-opus"]);
      expect(orch.getSession(result.sessionId)?.launchSpec.modelOverride).toBe("claude-opus");
    });

    it("stores completed lane summaries in shared compressed context for team runs", async () => {
      const { orchestrator } = setup();

      const result = await orchestrator.spawn({
        launchSpec: {
          parentConversationId: "parent-1",
          instruction: "Implement lane A",
          delegationProtocol: {
            source: "delegate_parallel",
            intent: { kind: "parallel_subtasks", summary: "Implement lane A" },
            contextPolicy: {
              includeParentConversation: true,
              includeStructuredContext: true,
              contextKeys: [],
            },
            expectedDeliverable: { summary: "lane result", format: "summary" },
            aggregationPolicy: { mode: "parallel_collect", summarizeFailures: true },
            launchDefaults: {},
            team: {
              id: "team-shared-context",
              mode: "parallel_subtasks",
              currentLaneId: "lane_a",
              memberRoster: [
                { laneId: "lane_a", agentId: "coder", role: "coder" },
                { laneId: "lane_b", agentId: "verifier", role: "verifier" },
              ],
            },
          },
        },
      });

      expect(result.success).toBe(true);
      const store = getSharedCompressedContextStore("team-shared-context");
      expect(store?.get("lane_a")).toMatchObject({
        laneId: "lane_a",
        agentId: "default",
        rawSummary: "default response",
        status: "active",
      });
    });

    it("injects existing shared compressed context into later team lane history", async () => {
      const seenHistories: Array<Array<{ role: string; content: string | AgentContentPart[] }>> = [];
      const registry = new AgentRegistry(() => ({
        async *run(input: AgentRunInput): AsyncIterable<AgentStreamItem> {
          seenHistories.push((input.history ?? []).map((item) => ({ role: item.role, content: item.content })));
          yield { type: "status", status: "running" };
          yield { type: "final", text: "worker output" };
          yield { type: "status", status: "done" };
        },
      }));
      registry.register(defaultProfile);

      const orch = new SubAgentOrchestrator({
        agentRegistry: registry,
        conversationStore: new ConversationStore(),
      });

      const teamMetadata: NonNullable<DelegationProtocol["team"]> = {
        id: "team-shared-context",
        mode: "parallel_subtasks",
        memberRoster: [
          { laneId: "lane_a", agentId: "coder", role: "coder" },
          { laneId: "lane_b", agentId: "verifier", role: "verifier" },
        ],
      };
      const teamProtocol: DelegationProtocol = {
        source: "delegate_parallel",
        intent: { kind: "parallel_subtasks", summary: "Coordinate lanes" },
        contextPolicy: {
          includeParentConversation: true,
          includeStructuredContext: true,
          contextKeys: [],
        },
        expectedDeliverable: { summary: "lane result", format: "summary" as const },
        aggregationPolicy: { mode: "parallel_collect", summarizeFailures: true },
        launchDefaults: {},
        team: teamMetadata,
      };

      await orch.spawn({
        launchSpec: {
          parentConversationId: "parent-1",
          instruction: "Implement lane A",
          delegationProtocol: {
            ...teamProtocol,
            team: {
              ...teamMetadata,
              currentLaneId: "lane_a",
            },
          },
        },
      });

      await orch.spawn({
        launchSpec: {
          parentConversationId: "parent-1",
          instruction: "Verify lane B",
          delegationProtocol: {
            ...teamProtocol,
            team: {
              ...teamMetadata,
              currentLaneId: "lane_b",
            },
          },
        },
      });

      expect(seenHistories).toHaveLength(2);
      const containsText = (needle: string) => seenHistories[1]?.some((item) =>
        typeof item.content === "string" && item.content.includes(needle));
      expect(containsText("<team-shared-context")).toBe(true);
      expect(containsText("Lane lane_a")).toBe(true);
      expect(containsText("worker output")).toBe(true);
    });

    it("should apply catalog launch defaults when spawn input omits role and policy fields", async () => {
      const registry = new AgentRegistry(() => createMockAgent("catalog response"));
      registry.register(defaultProfile);
      registry.register({
        id: "ops-coder",
        displayName: "Ops Coder",
        model: "primary",
        defaultRole: "coder",
        defaultPermissionMode: "confirm",
        defaultAllowedToolFamilies: ["workspace-read", "workspace-write", "patch"],
        defaultMaxToolRiskLevel: "high",
      });

      const orch = new SubAgentOrchestrator({
        agentRegistry: registry,
        conversationStore: new ConversationStore(),
      });

      const result = await orch.spawn({
        parentConversationId: "parent-1",
        agentId: "ops-coder",
        instruction: "Implement rollout guardrails",
      });

      expect(result.success).toBe(true);
      const session = orch.getSession(result.sessionId);
      expect(session?.launchSpec).toMatchObject({
        agentId: "ops-coder",
        profileId: "ops-coder",
        role: "coder",
        permissionMode: "confirm",
        allowedToolFamilies: ["workspace-read", "workspace-write", "patch"],
        maxToolRiskLevel: "high",
      });
    });

    it("should expose resolveLaunchSpec with the same catalog-normalized semantics as spawn", () => {
      const registry = new AgentRegistry(() => createMockAgent("catalog response"));
      registry.register(defaultProfile);
      registry.register({
        id: "ops-coder",
        displayName: "Ops Coder",
        model: "primary",
        defaultRole: "coder",
        defaultPermissionMode: "confirm",
        defaultAllowedToolFamilies: ["workspace-read", "workspace-write", "patch"],
        defaultMaxToolRiskLevel: "high",
      });

      const orch = new SubAgentOrchestrator({
        agentRegistry: registry,
        conversationStore: new ConversationStore(),
      });

      const spec = orch.resolveLaunchSpec({
        parentConversationId: "parent-1",
        agentId: "ops-coder",
        instruction: "Implement rollout guardrails",
      });

      expect(spec).toMatchObject({
        agentId: "ops-coder",
        profileId: "ops-coder",
        role: "coder",
        permissionMode: "confirm",
        allowedToolFamilies: ["workspace-read", "workspace-write", "patch"],
        maxToolRiskLevel: "high",
      });
    });

    it("should return error when agent ID not found", async () => {
      const { orchestrator } = setup();

      const result = await orchestrator.spawn({
        parentConversationId: "parent-1",
        agentId: "nonexistent",
        instruction: "Do something",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("nonexistent");
    });

    it("should enforce max nesting depth", async () => {
      const { orchestrator } = setup({ maxDepth: 2 });

      const result = await orchestrator.spawn({
        parentConversationId: "parent-1",
        instruction: "Nested task",
        context: { _orchestratorDepth: 2 },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("nesting depth");
    });

    it("should allow spawn within depth limit", async () => {
      const { orchestrator } = setup({ maxDepth: 2 });

      const result = await orchestrator.spawn({
        parentConversationId: "parent-1",
        instruction: "Nested task",
        context: { _orchestratorDepth: 1 },
      });

      expect(result.success).toBe(true);
    });

    it("should queue when max concurrent reached and resolve after slot frees", async () => {
      const slowRegistry = new AgentRegistry(() => createSlowAgent(200));
      slowRegistry.register(defaultProfile);

      const orch = new SubAgentOrchestrator({
        agentRegistry: slowRegistry,
        conversationStore: new ConversationStore(),
        maxConcurrent: 1,
        sessionTimeoutMs: 5000,
      });

      // Start first spawn (will be slow)
      const p1 = orch.spawn({
        parentConversationId: "parent-1",
        instruction: "Slow task 1",
      });

      // Second spawn — should be queued, not rejected
      const p2 = orch.spawn({
        parentConversationId: "parent-1",
        instruction: "Slow task 2",
      });

      expect(orch.queueSize).toBe(1);
      expect(orch.getRuntimeSnapshot()).toMatchObject({
        activeCount: 1,
        queuedCount: 1,
        maxConcurrent: 1,
      });

      // Both should eventually succeed
      const [result1, result2] = await Promise.all([p1, p2]);
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(orch.queueSize).toBe(0);
      expect(orch.getRuntimeSnapshot()).toMatchObject({
        activeCount: 0,
        queuedCount: 0,
      });
    });

    it("should handle agent errors gracefully", async () => {
      const errorRegistry = new AgentRegistry(() => createErrorAgent("Agent crashed"));
      errorRegistry.register(defaultProfile);

      const orch = new SubAgentOrchestrator({
        agentRegistry: errorRegistry,
        conversationStore: new ConversationStore(),
      });

      const result = await orch.spawn({
        parentConversationId: "parent-1",
        instruction: "Crash me",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Agent crashed");
    });

    it("should handle timeout", async () => {
      const slowRegistry = new AgentRegistry(() => createSlowAgent(2000));
      slowRegistry.register(defaultProfile);

      const orch = new SubAgentOrchestrator({
        agentRegistry: slowRegistry,
        conversationStore: new ConversationStore(),
        sessionTimeoutMs: 50,
      });

      const result = await orch.spawn({
        parentConversationId: "parent-1",
        instruction: "Too slow",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("timed out");
    }, 10_000);

    it("should keep timeout terminal state and avoid late completion overwrite", async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-orchestrator-timeout-"));
      const events: any[] = [];
      const lateAgent: BelldandyAgent = {
        async *run(_input: AgentRunInput): AsyncIterable<AgentStreamItem> {
          yield { type: "status", status: "running" };
          await new Promise((r) => setTimeout(r, 80));
          yield { type: "final", text: "late result" };
          yield { type: "status", status: "done" };
        },
      };
      const registry = new AgentRegistry(() => lateAgent);
      registry.register(defaultProfile);
      const conversationStore = new ConversationStore({ dataDir: path.join(tempDir, "sessions") });

      const orch = new SubAgentOrchestrator({
        agentRegistry: registry,
        conversationStore,
        sessionTimeoutMs: 20,
        onEvent: (event) => events.push(event),
      });

      const result = await orch.spawn({
        parentConversationId: "p1",
        instruction: "Late task",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("timed out");

      await new Promise((r) => setTimeout(r, 120));

      const session = orch.getSession(result.sessionId);
      expect(session?.status).toBe("timeout");
      expect(session?.result).toBeUndefined();
      expect(conversationStore.getHistory(result.sessionId)).toEqual([
        { role: "user", content: "Late task" },
      ]);

      const completedEvents = events.filter((event) => event.type === "completed");
      expect(completedEvents).toHaveLength(1);
      expect(completedEvents[0]).toMatchObject({
        sessionId: result.sessionId,
        success: false,
      });
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("aborts a never-settling agent when the session times out", async () => {
      let observedSignal: AbortSignal | undefined;
      let releaseAgent: (() => void) | undefined;
      const agentRelease = new Promise<void>((resolve) => {
        releaseAgent = resolve;
      });
      const neverSettlingAgent: BelldandyAgent = {
        async *run(input: AgentRunInput): AsyncIterable<AgentStreamItem> {
          observedSignal = input.abortSignal;
          yield { type: "status", status: "running" };
          await agentRelease;
        },
      };
      const registry = new AgentRegistry(() => neverSettlingAgent);
      registry.register(defaultProfile);
      const conversationStore = new ConversationStore();
      const storeRelease = vi.spyOn(conversationStore, "releaseConversation");
      const orch = new SubAgentOrchestrator({
        agentRegistry: registry,
        conversationStore,
        sessionTimeoutMs: 20,
      });

      const result = await orch.spawn({
        parentConversationId: "p-timeout-abort",
        instruction: "Wait forever",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("timed out");
      expect(observedSignal?.aborted).toBe(true);
      expect(orch.getSession(result.sessionId)?.status).toBe("timeout");
      expect(storeRelease).not.toHaveBeenCalled();
      releaseAgent?.();
      await vi.waitFor(() => expect(storeRelease).toHaveBeenCalledWith(result.sessionId));
    });

    it("stops a never-settling agent without waiting for its iterator to close", async () => {
      let observedSignal: AbortSignal | undefined;
      let releaseAgentWork: (() => void) | undefined;
      const agentWork = new Promise<void>((resolve) => {
        releaseAgentWork = resolve;
      });
      let releaseAgentFinalizer: (() => void) | undefined;
      const agentFinalizer = new Promise<void>((resolve) => {
        releaseAgentFinalizer = resolve;
      });
      let resolveStarted: ((sessionId: string) => void) | undefined;
      const started = new Promise<string>((resolve) => {
        resolveStarted = resolve;
      });
      const neverSettlingAgent: BelldandyAgent = {
        async *run(input: AgentRunInput): AsyncIterable<AgentStreamItem> {
          observedSignal = input.abortSignal;
          try {
            yield { type: "status", status: "running" };
            await agentWork;
          } finally {
            await agentFinalizer;
          }
        },
      };
      const registry = new AgentRegistry(() => neverSettlingAgent);
      registry.register(defaultProfile);
      const conversationStore = new ConversationStore();
      const storeRelease = vi.spyOn(conversationStore, "releaseConversation");
      const orch = new SubAgentOrchestrator({
        agentRegistry: registry,
        conversationStore,
        sessionTimeoutMs: 5_000,
      });

      const pending = orch.spawn({
        parentConversationId: "p-stop-abort",
        instruction: "Wait forever",
        onSessionCreated: (sessionId) => resolveStarted?.(sessionId),
      });
      const sessionId = await started;

      await expect(orch.stopSession(sessionId, "Stopped for test.")).resolves.toBe(true);
      const result = await pending;

      expect(result).toMatchObject({
        success: false,
        sessionId,
        error: "Stopped for test.",
      });
      expect(observedSignal?.aborted).toBe(true);
      expect(observedSignal?.reason).toBe("Stopped for test.");
      expect(orch.getSession(sessionId)?.status).toBe("stopped");
      expect(storeRelease).not.toHaveBeenCalled();
      releaseAgentWork?.();
      await Promise.resolve();
      expect(storeRelease).not.toHaveBeenCalled();
      releaseAgentFinalizer?.();
      await vi.waitFor(() => expect(storeRelease).toHaveBeenCalledWith(sessionId));
    });

    it("forwards a parent abort signal to the running sub-agent", async () => {
      const parentController = new AbortController();
      let observedSignal: AbortSignal | undefined;
      let releaseAgent: (() => void) | undefined;
      const agentRelease = new Promise<void>((resolve) => {
        releaseAgent = resolve;
      });
      let resolveStarted: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        resolveStarted = resolve;
      });
      const neverSettlingAgent: BelldandyAgent = {
        async *run(input: AgentRunInput): AsyncIterable<AgentStreamItem> {
          observedSignal = input.abortSignal;
          resolveStarted?.();
          yield { type: "status", status: "running" };
          await agentRelease;
        },
      };
      const registry = new AgentRegistry(() => neverSettlingAgent);
      registry.register(defaultProfile);
      const orch = new SubAgentOrchestrator({
        agentRegistry: registry,
        conversationStore: new ConversationStore(),
        sessionTimeoutMs: 5_000,
      });

      const pending = orch.spawn({
        parentConversationId: "p-parent-abort",
        instruction: "Wait for parent stop",
        abortSignal: parentController.signal,
      });
      await started;
      parentController.abort("Workflow stopped by user.");

      const result = await pending;
      expect(result).toMatchObject({
        success: false,
        error: "Workflow stopped by user.",
      });
      expect(observedSignal?.aborted).toBe(true);
      expect(observedSignal?.reason).toBe("Workflow stopped by user.");
      expect(orch.getSession(result.sessionId)?.status).toBe("stopped");
      releaseAgent?.();
    });
  });

  describe("spawnParallel", () => {
    it("should run multiple tasks in parallel", async () => {
      const { orchestrator } = setup();

      const results = await orchestrator.spawnParallel([
        { parentConversationId: "parent-1", instruction: "Task A" },
        { parentConversationId: "parent-1", instruction: "Task B" },
      ]);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
    });

    it("should handle all parallel tasks via queue when exceeding maxConcurrent", async () => {
      const { orchestrator } = setup({ maxConcurrent: 2 });

      const results = await orchestrator.spawnParallel([
        { parentConversationId: "p", instruction: "A" },
        { parentConversationId: "p", instruction: "B" },
        { parentConversationId: "p", instruction: "C" },
      ]);

      // All 3 should complete (excess queued, not dropped)
      expect(results).toHaveLength(3);
      expect(results.every((r) => r.success)).toBe(true);
    });
  });

  describe("listSessions", () => {
    it("should list all sessions", async () => {
      const { orchestrator } = setup();

      await orchestrator.spawn({ parentConversationId: "p1", instruction: "Task 1" });
      await orchestrator.spawn({ parentConversationId: "p2", instruction: "Task 2" });

      const all = orchestrator.listSessions();
      expect(all).toHaveLength(2);
    });

    it("should filter by parent conversation ID", async () => {
      const { orchestrator } = setup();

      await orchestrator.spawn({ parentConversationId: "p1", instruction: "Task 1" });
      await orchestrator.spawn({ parentConversationId: "p2", instruction: "Task 2" });

      const filtered = orchestrator.listSessions("p1");
      expect(filtered).toHaveLength(1);
      expect(filtered[0].parentId).toBe("p1");
    });
  });

  describe("getSession", () => {
    it("should return session by ID", async () => {
      const { orchestrator } = setup();

      const result = await orchestrator.spawn({
        parentConversationId: "p1",
        instruction: "Task 1",
      });

      const session = orchestrator.getSession(result.sessionId);
      expect(session).toBeDefined();
      expect(session!.status).toBe("done");
      expect(session!.agentId).toBe("default");
    });

    it("should return undefined for unknown session", () => {
      const { orchestrator } = setup();
      expect(orchestrator.getSession("nonexistent")).toBeUndefined();
    });
  });

  describe("cleanup", () => {
    it("should clean up old completed sessions", async () => {
      const { orchestrator } = setup();

      await orchestrator.spawn({ parentConversationId: "p1", instruction: "Old task" });

      // All sessions are "done", cleanup with 0ms maxAge should remove them
      const cleaned = orchestrator.cleanup(0);
      expect(cleaned).toBe(1);
      expect(orchestrator.listSessions()).toHaveLength(0);
    });

    it("should not clean up recent sessions", async () => {
      const { orchestrator } = setup();

      await orchestrator.spawn({ parentConversationId: "p1", instruction: "Recent task" });

      const cleaned = orchestrator.cleanup(60_000);
      expect(cleaned).toBe(0);
      expect(orchestrator.listSessions()).toHaveLength(1);
    });

    it("uses the configured retention window when no cleanup override is provided", async () => {
      const now = vi.spyOn(Date, "now").mockReturnValue(3_000);
      try {
        const { orchestrator } = setup({ terminalSessionRetentionMs: 1_000 });
        await orchestrator.spawn({ parentConversationId: "p1", instruction: "Configured retention" });

        now.mockReturnValue(3_999);
        expect(orchestrator.cleanup()).toBe(0);
        now.mockReturnValue(4_000);
        expect(orchestrator.cleanup()).toBe(1);
      } finally {
        now.mockRestore();
      }
    });
  });

  describe("terminal session retention", () => {
    it("evicts the oldest terminal sessions when the retention capacity is exceeded", async () => {
      const { orchestrator } = setup({
        terminalSessionMaxEntries: 2,
        terminalSessionRetentionMs: 60_000,
      });

      const first = await orchestrator.spawn({ parentConversationId: "p1", instruction: "First" });
      const second = await orchestrator.spawn({ parentConversationId: "p1", instruction: "Second" });
      const third = await orchestrator.spawn({ parentConversationId: "p1", instruction: "Third" });

      expect(orchestrator.getSession(first.sessionId)).toBeUndefined();
      expect(orchestrator.listSessions().map((session) => session.id)).toEqual([
        second.sessionId,
        third.sessionId,
      ]);
      expect(orchestrator.getRuntimeSnapshot()).toMatchObject({
        retainedTerminalCount: 2,
        maxRetainedTerminalCount: 2,
        evictedTerminalCount: 1,
        oldestRetainedTerminalAgeMs: expect.any(Number),
      });
    });

    it("expires terminal sessions by finished time when retention is observed", async () => {
      const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
      try {
        const { orchestrator } = setup({
          terminalSessionMaxEntries: 4,
          terminalSessionRetentionMs: 100,
        });
        const result = await orchestrator.spawn({ parentConversationId: "p1", instruction: "Expire" });

        now.mockReturnValue(1_101);

        expect(orchestrator.getSession(result.sessionId)).toBeUndefined();
        expect(orchestrator.getRuntimeSnapshot()).toMatchObject({
          retainedTerminalCount: 0,
          evictedTerminalCount: 1,
          oldestRetainedTerminalAgeMs: 0,
        });
      } finally {
        now.mockRestore();
      }
    });

    it("pins running and pending sessions while expired terminal sessions are pruned", async () => {
      const now = vi.spyOn(Date, "now").mockReturnValue(2_000);
      let releaseRunning: (() => void) | undefined;
      const running = new Promise<void>((resolve) => {
        releaseRunning = resolve;
      });
      let createdAgents = 0;
      const registry = new AgentRegistry(() => {
        createdAgents++;
        if (createdAgents === 1) {
          return createMockAgent("terminal");
        }
        return {
          async *run(): AsyncIterable<AgentStreamItem> {
            yield { type: "status", status: "running" };
            await running;
            yield { type: "final", text: "released" };
          },
        } satisfies BelldandyAgent;
      });
      registry.register(defaultProfile);
      const orchestrator = new SubAgentOrchestrator({
        agentRegistry: registry,
        conversationStore: new ConversationStore(),
        maxConcurrent: 1,
        terminalSessionMaxEntries: 2,
        terminalSessionRetentionMs: 100,
      });

      try {
        await orchestrator.spawn({ parentConversationId: "p1", instruction: "Terminal" });
        const active = orchestrator.spawn({ parentConversationId: "p1", instruction: "Active" });
        const pending = orchestrator.spawn({ parentConversationId: "p1", instruction: "Pending" });

        now.mockReturnValue(2_101);
        expect(orchestrator.getRuntimeSnapshot()).toMatchObject({
          activeCount: 1,
          queuedCount: 1,
          retainedTerminalCount: 0,
          evictedTerminalCount: 1,
        });
        expect(orchestrator.listSessions().map((session) => session.status).sort()).toEqual([
          "pending",
          "running",
        ]);

        releaseRunning?.();
        await Promise.all([active, pending]);
      } finally {
        releaseRunning?.();
        now.mockRestore();
      }
    });
  });

  describe("onEvent callback", () => {
    it("should emit started and completed events", async () => {
      const events: any[] = [];
      const { orchestrator } = setup({
        onEvent: (e) => events.push(e),
      });

      await orchestrator.spawn({
        parentConversationId: "p1",
        instruction: "Tracked task",
      });

      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events[0].type).toBe("started");
      expect(events[0].agentId).toBe("default");
      expect(events[events.length - 1].type).toBe("completed");
      expect(events[events.length - 1].success).toBe(true);
    });

    it("should not fail or leak slots when onEvent throws", async () => {
      const { orchestrator } = setup({
        onEvent: () => {
          throw new Error("event boom");
        },
      });

      const result1 = await orchestrator.spawn({
        parentConversationId: "p1",
        instruction: "Task 1",
      });
      const result2 = await orchestrator.spawn({
        parentConversationId: "p1",
        instruction: "Task 2",
      });

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(orchestrator.queueSize).toBe(0);
    });
  });

  describe("queue", () => {
    it("assigns a real session id to queued work and stops it before execution", async () => {
      let releaseFirst: (() => void) | undefined;
      const firstCompleted = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let createdAgents = 0;
      const registry = new AgentRegistry(() => {
        createdAgents++;
        if (createdAgents === 1) {
          return {
            async *run(): AsyncIterable<AgentStreamItem> {
              yield { type: "status", status: "running" };
              await firstCompleted;
              yield { type: "final", text: "first done" };
            },
          } satisfies BelldandyAgent;
        }
        return createMockAgent("queued agent should not run");
      });
      registry.register(defaultProfile);
      const orch = new SubAgentOrchestrator({
        agentRegistry: registry,
        conversationStore: new ConversationStore(),
        maxConcurrent: 1,
        sessionTimeoutMs: 5_000,
      });

      const first = orch.spawn({
        parentConversationId: "p-queue-stop",
        instruction: "Hold the only slot",
      });
      let queuedSessionId: string | undefined;
      const queued = orch.spawn({
        parentConversationId: "p-queue-stop",
        instruction: "Do not start",
        onQueued: (_position, sessionId) => {
          queuedSessionId = sessionId;
        },
      });

      expect(queuedSessionId).toMatch(/^sub_/);
      expect(orch.getSession(queuedSessionId!)?.status).toBe("pending");
      await expect(orch.stopSession(queuedSessionId!, "Cancelled while queued.")).resolves.toBe(true);

      await expect(queued).resolves.toMatchObject({
        success: false,
        sessionId: queuedSessionId,
        error: "Cancelled while queued.",
      });
      expect(createdAgents).toBe(1);

      releaseFirst?.();
      await expect(first).resolves.toMatchObject({ success: true });
    });

    it("should reject when queue is full", async () => {
      const slowRegistry = new AgentRegistry(() => createSlowAgent(500));
      slowRegistry.register(defaultProfile);

      const orch = new SubAgentOrchestrator({
        agentRegistry: slowRegistry,
        conversationStore: new ConversationStore(),
        maxConcurrent: 1,
        maxQueueSize: 1,
        sessionTimeoutMs: 5000,
      });

      // Fill the running slot
      const p1 = orch.spawn({ parentConversationId: "p1", instruction: "Task 1" });
      // Fill the queue
      const p2 = orch.spawn({ parentConversationId: "p1", instruction: "Task 2" });
      // This should be rejected (queue full)
      const result3 = await orch.spawn({ parentConversationId: "p1", instruction: "Task 3" });

      expect(result3.success).toBe(false);
      expect(result3.error).toContain("queue full");

      await Promise.all([p1, p2]);
    });

    it("should emit queued event", async () => {
      const events: any[] = [];
      const slowRegistry = new AgentRegistry(() => createSlowAgent(200));
      slowRegistry.register(defaultProfile);

      const orch = new SubAgentOrchestrator({
        agentRegistry: slowRegistry,
        conversationStore: new ConversationStore(),
        maxConcurrent: 1,
        sessionTimeoutMs: 5000,
        onEvent: (e) => events.push(e),
      });

      const p1 = orch.spawn({ parentConversationId: "p1", instruction: "Task 1" });
      const p2 = orch.spawn({ parentConversationId: "p1", instruction: "Task 2" });

      // Should have a "queued" event
      const queuedEvents = events.filter((e) => e.type === "queued");
      expect(queuedEvents.length).toBe(1);
      expect(queuedEvents[0].position).toBe(1);

      await Promise.all([p1, p2]);
    });

    it("should drain queue in order", async () => {
      const order: string[] = [];
      const slowRegistry = new AgentRegistry((profile) => ({
        async *run(input: AgentRunInput): AsyncIterable<AgentStreamItem> {
          yield { type: "status", status: "running" };
          await new Promise((r) => setTimeout(r, 100));
          order.push(input.text);
          yield { type: "final", text: input.text };
          yield { type: "status", status: "done" };
        },
      }));
      slowRegistry.register(defaultProfile);

      const orch = new SubAgentOrchestrator({
        agentRegistry: slowRegistry,
        conversationStore: new ConversationStore(),
        maxConcurrent: 1,
        sessionTimeoutMs: 5000,
      });

      const results = await Promise.all([
        orch.spawn({ parentConversationId: "p1", instruction: "first" }),
        orch.spawn({ parentConversationId: "p1", instruction: "second" }),
        orch.spawn({ parentConversationId: "p1", instruction: "third" }),
      ]);

      expect(results.every((r) => r.success)).toBe(true);
      expect(order).toEqual(["first", "second", "third"]);
    });
  });

  describe("hookRunner integration", () => {
    it("passes the session abort signal to hooks", async () => {
      const mockHookRunner = {
        runSessionStart: vi.fn(async () => {}),
        runSessionEnd: vi.fn(async () => {}),
      };
      const slowRegistry = new AgentRegistry(() => createSlowAgent(50));
      slowRegistry.register(defaultProfile);
      const orch = new SubAgentOrchestrator({
        agentRegistry: slowRegistry,
        conversationStore: new ConversationStore(),
        hookRunner: mockHookRunner,
        sessionTimeoutMs: 10_000,
      });
      let resolveSessionId: ((sessionId: string) => void) | undefined;
      const sessionStarted = new Promise<string>((resolve) => {
        resolveSessionId = resolve;
      });

      const pending = orch.spawn({
        parentConversationId: "p-hook-abort",
        instruction: "Stop hook test",
        onSessionCreated: (sessionId) => resolveSessionId?.(sessionId),
      });
      const sessionId = await sessionStarted;
      const startCall = mockHookRunner.runSessionStart.mock.calls[0] as unknown[];
      const hookSignal = (startCall[1] as { abortSignal?: AbortSignal }).abortSignal;

      await orch.stopSession(sessionId, "Stop hook test.");
      await pending;

      expect(hookSignal?.aborted).toBe(true);
      expect(hookSignal?.reason).toBe("Stop hook test.");
    });

    it("should call session_start and session_end hooks", async () => {
      const hookCalls: string[] = [];
      const mockHookRunner = {
        runSessionStart: vi.fn(async () => { hookCalls.push("start"); }),
        runSessionEnd: vi.fn(async () => { hookCalls.push("end"); }),
      };

      const { orchestrator } = setup({ hookRunner: mockHookRunner });

      await orchestrator.spawn({
        parentConversationId: "p1",
        instruction: "Hooked task",
      });

      expect(mockHookRunner.runSessionStart).toHaveBeenCalledTimes(1);
      expect(mockHookRunner.runSessionEnd).toHaveBeenCalledTimes(1);
      expect(hookCalls).toEqual(["start", "end"]);

      // Verify session_end was called with correct shape
      const endCall = mockHookRunner.runSessionEnd.mock.calls[0] as unknown[];
      expect(endCall[0]).toHaveProperty("sessionId");
      expect(endCall[0]).toHaveProperty("messageCount");
      expect(endCall[0]).toHaveProperty("durationMs");
      expect(endCall[1]).toHaveProperty("agentId", "default");
    });

    it("should call session_end on error", async () => {
      const mockHookRunner = {
        runSessionStart: vi.fn(async () => {}),
        runSessionEnd: vi.fn(async () => {}),
      };

      const errorRegistry = new AgentRegistry(() => createErrorAgent("boom"));
      errorRegistry.register(defaultProfile);

      const orch = new SubAgentOrchestrator({
        agentRegistry: errorRegistry,
        conversationStore: new ConversationStore(),
        hookRunner: mockHookRunner,
      });

      const result = await orch.spawn({
        parentConversationId: "p1",
        instruction: "Fail task",
      });

      expect(result.success).toBe(false);
      // Give hooks time to fire (they are async fire-and-forget)
      await new Promise((r) => setTimeout(r, 50));
      expect(mockHookRunner.runSessionEnd).toHaveBeenCalledTimes(1);
    });

    it("should not fail if hookRunner throws", async () => {
      const mockHookRunner = {
        runSessionStart: vi.fn(async () => { throw new Error("hook boom"); }),
        runSessionEnd: vi.fn(async () => { throw new Error("hook boom"); }),
      };

      const { orchestrator } = setup({ hookRunner: mockHookRunner });

      const result = await orchestrator.spawn({
        parentConversationId: "p1",
        instruction: "Resilient task",
      });

      // Should still succeed despite hook errors
      expect(result.success).toBe(true);
    });
  });

  describe("spawnParallel with queue", () => {
    it("should handle more tasks than maxConcurrent via queue", async () => {
      const slowRegistry = new AgentRegistry(() => createSlowAgent(100));
      slowRegistry.register(defaultProfile);

      const orch = new SubAgentOrchestrator({
        agentRegistry: slowRegistry,
        conversationStore: new ConversationStore(),
        maxConcurrent: 2,
        sessionTimeoutMs: 5000,
      });

      const results = await orch.spawnParallel([
        { parentConversationId: "p1", instruction: "Task A" },
        { parentConversationId: "p1", instruction: "Task B" },
        { parentConversationId: "p1", instruction: "Task C" },
        { parentConversationId: "p1", instruction: "Task D" },
      ]);

      expect(results).toHaveLength(4);
      expect(results.every((r) => r.success)).toBe(true);
    });
  });
});
