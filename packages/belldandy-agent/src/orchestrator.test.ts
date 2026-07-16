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
      const conversationStore = new ConversationStore();

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
