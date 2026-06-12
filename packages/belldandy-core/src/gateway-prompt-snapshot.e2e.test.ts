import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";
import WebSocket from "ws";
import { buildDefaultProfile } from "@belldandy/agent";
import { MemoryManager, type TaskActivityRecord, type TaskRecord } from "@belldandy/memory";

import {
  loadConversationPromptSnapshotArtifact,
  getConversationPromptSnapshotArtifactPath,
  persistConversationPromptSnapshot,
} from "./conversation-prompt-snapshot.js";
import { resolveResidentMemoryPolicy } from "./resident-memory-policy.js";
import { approvePairingCode } from "./security/store.js";

const TEST_FILE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_FILE_DIR, "..", "..", "..");
const GATEWAY_ENTRY_PATH = path.join(REPO_ROOT, "packages", "belldandy-core", "src", "bin", "gateway.ts");

function resolveWebRoot() {
  return path.join(REPO_ROOT, "apps", "web", "public");
}

test("gateway persists prompt snapshot across restart and reloads it via inspect and rpc", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-prompt-snapshot-e2e-"));
  const conversationId = "conv-prompt-snapshot-e2e";
  const promptMarker = "PROMPT_SNAPSHOT_E2E_MARKER";
  const fakeOpenAI = await startFakeOpenAIServer();
  let gateway: GatewayProcessHandle | undefined;
  let wsHandle: GatewayWebSocketHandle | undefined;

  try {
    gateway = await startGatewayProcess({
      stateDir,
      openaiBaseUrl: `${fakeOpenAI.baseUrl}/v1`,
      promptMarker,
    });
    wsHandle = await connectGatewayWebSocket(gateway.port);

    const firstSendReqId = "message-send-before-pairing";
    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: firstSendReqId,
      method: "message.send",
      params: {
        conversationId,
        text: "snapshot persistence",
      },
    }));
    await approveLatestPairingCode(wsHandle.frames, stateDir);

    const secondSendReqId = "message-send-after-pairing";
    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: secondSendReqId,
      method: "message.send",
      params: {
        conversationId,
        text: "snapshot persistence",
      },
    }));
    await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === secondSendReqId && frame.ok === true));
    await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "event" && frame.event === "chat.final" && frame.payload?.conversationId === conversationId));

    const sendRes = wsHandle.frames.find((frame) => frame.type === "res" && frame.id === secondSendReqId && frame.ok === true);
    const runId = typeof sendRes?.payload?.runId === "string" ? sendRes.payload.runId : "";
    expect(runId).toBeTruthy();

    const artifactPath = getConversationPromptSnapshotArtifactPath({
      stateDir,
      conversationId,
      runId,
    });
    await waitFor(async () => {
      try {
        await fs.access(artifactPath);
        return true;
      } catch {
        return false;
      }
    });

    const persisted = await loadConversationPromptSnapshotArtifact({
      stateDir,
      conversationId,
      runId,
    });
    expect(persisted).toBeDefined();
    expect(persisted?.manifest).toMatchObject({
      conversationId,
      runId,
      source: "runtime.prompt_snapshot",
    });
    expect(persisted?.snapshot.systemPrompt).toContain(promptMarker);
    expect(persisted?.snapshot.messages[0]).toMatchObject({
      role: "system",
      content: expect.stringContaining(promptMarker),
    });

    await wsHandle.close();
    wsHandle = undefined;
    await stopGatewayProcess(gateway);
    gateway = undefined;

    gateway = await startGatewayProcess({
      stateDir,
      openaiBaseUrl: `${fakeOpenAI.baseUrl}/v1`,
      promptMarker,
    });
    wsHandle = await connectGatewayWebSocket(gateway.port);

    const inspectReqId = "agents-prompt-inspect-before-pairing";
    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: inspectReqId,
      method: "agents.prompt.inspect",
      params: {
        conversationId,
        runId,
      },
    }));
    await approveLatestPairingCode(wsHandle.frames, stateDir);

    const inspectAfterPairingReqId = "agents-prompt-inspect-after-pairing";
    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: inspectAfterPairingReqId,
      method: "agents.prompt.inspect",
      params: {
        conversationId,
        runId,
      },
    }));
    await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === inspectAfterPairingReqId && frame.ok === true));

    const inspectRes = wsHandle.frames.find((frame) => frame.type === "res" && frame.id === inspectAfterPairingReqId);
    expect(inspectRes?.payload).toMatchObject({
      scope: "run",
      conversationId,
      runId,
      text: expect.stringContaining(promptMarker),
      metadata: {
        tokenBreakdown: {
          systemPromptEstimatedTokens: expect.any(Number),
          deltaEstimatedTokens: expect.any(Number),
          providerNativeSystemBlockEstimatedTokens: expect.any(Number),
        },
        snapshotScope: "run",
        providerNativeSystemBlockCount: expect.any(Number),
      },
    });
    expect(inspectRes?.payload?.sections?.[0]).toMatchObject({
      estimatedChars: expect.any(Number),
      estimatedTokens: expect.any(Number),
    });
    expect(inspectRes?.payload?.providerNativeSystemBlocks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        blockType: "static-persona",
        cacheControlEligible: true,
        estimatedChars: expect.any(Number),
        estimatedTokens: expect.any(Number),
      }),
      expect.objectContaining({
        blockType: "static-capability",
        cacheControlEligible: true,
        estimatedChars: expect.any(Number),
        estimatedTokens: expect.any(Number),
      }),
    ]));
    expect(Array.isArray(inspectRes?.payload?.messages)).toBe(true);
    expect(inspectRes?.payload?.messages[0]).toMatchObject({
      role: "system",
      content: expect.stringContaining(promptMarker),
    });

    const rpcReqId = "conversation-prompt-snapshot-get";
    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: rpcReqId,
      method: "conversation.prompt_snapshot.get",
      params: {
        conversationId,
        runId,
      },
    }));
    await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === rpcReqId && frame.ok === true));

    const rpcRes = wsHandle.frames.find((frame) => frame.type === "res" && frame.id === rpcReqId);
    expect(rpcRes?.payload?.snapshot).toMatchObject({
      manifest: {
        conversationId,
        runId,
        source: "runtime.prompt_snapshot",
      },
      summary: {
        providerNativeSystemBlockCount: expect.any(Number),
        systemPromptEstimatedTokens: expect.any(Number),
        deltaEstimatedTokens: expect.any(Number),
        providerNativeSystemBlockEstimatedTokens: expect.any(Number),
      },
      snapshot: {
        systemPrompt: expect.stringContaining(promptMarker),
        providerNativeSystemBlocks: expect.arrayContaining([
          expect.objectContaining({
            blockType: "static-persona",
            cacheControlEligible: true,
            estimatedTokens: expect.any(Number),
          }),
          expect.objectContaining({
            blockType: "static-capability",
            cacheControlEligible: true,
            estimatedTokens: expect.any(Number),
          }),
        ]),
      },
    });

    const doctorReqId = "system-doctor-prompt-observability";
    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: doctorReqId,
      method: "system.doctor",
      params: {
        promptConversationId: conversationId,
        promptRunId: runId,
      },
    }));
    await waitFor(
      () => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === doctorReqId && frame.ok === true),
      15_000,
    );

    const doctorRes = wsHandle.frames.find((frame) => frame.type === "res" && frame.id === doctorReqId);
    expect(doctorRes?.payload?.promptObservability).toMatchObject({
      requested: {
        conversationId,
        runId,
      },
      summary: {
        scope: "run",
        conversationId,
        runId,
        counts: {
          sectionCount: expect.any(Number),
          deltaCount: expect.any(Number),
          providerNativeSystemBlockCount: expect.any(Number),
        },
        tokenBreakdown: {
          systemPromptEstimatedTokens: expect.any(Number),
          deltaEstimatedTokens: expect.any(Number),
          providerNativeSystemBlockEstimatedTokens: expect.any(Number),
        },
      },
    });
    expect(doctorRes?.payload?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "prompt_observability",
        status: "pass",
      }),
    ]));

    expect(fakeOpenAI.requests).toHaveLength(1);
  } finally {
    if (wsHandle) {
      await wsHandle.close().catch(() => {});
    }
    if (gateway) {
      await stopGatewayProcess(gateway).catch(() => {});
    }
    await fakeOpenAI.close().catch(() => {});
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
}, 60000);

test("gateway applies prompt section disable experiments to agent inspect", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-prompt-experiment-e2e-"));
  const fakeOpenAI = await startFakeOpenAIServer();
  let gateway: GatewayProcessHandle | undefined;
  let wsHandle: GatewayWebSocketHandle | undefined;

  try {
    gateway = await startGatewayProcess({
      stateDir,
      openaiBaseUrl: `${fakeOpenAI.baseUrl}/v1`,
      promptMarker: "PROMPT_EXPERIMENT_E2E_MARKER",
      extraEnv: {
        BELLDANDY_PROMPT_EXPERIMENT_DISABLE_SECTIONS: "methodology",
      },
    });
    wsHandle = await connectGatewayWebSocket(gateway.port);

    const inspectReqId = "agents-prompt-inspect-experiment-before-pairing";
    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: inspectReqId,
      method: "agents.prompt.inspect",
      params: {
        agentId: "default",
      },
    }));
    await approveLatestPairingCode(wsHandle.frames, stateDir);

    const inspectAfterPairingReqId = "agents-prompt-inspect-experiment-after-pairing";
    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: inspectAfterPairingReqId,
      method: "agents.prompt.inspect",
      params: {
        agentId: "default",
      },
    }));
    await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === inspectAfterPairingReqId && frame.ok === true));

    const inspectRes = wsHandle.frames.find((frame) => frame.type === "res" && frame.id === inspectAfterPairingReqId);
    expect(inspectRes?.payload?.sections?.map((section: any) => section.id)).not.toContain("methodology");
    expect(inspectRes?.payload?.droppedSections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "methodology",
        estimatedChars: expect.any(Number),
        estimatedTokens: expect.any(Number),
      }),
    ]));
    expect(inspectRes?.payload?.metadata?.promptExperiments).toMatchObject({
      disabledSectionIdsConfigured: ["methodology"],
      disabledSectionIdsApplied: ["methodology"],
    });
  } finally {
    if (wsHandle) {
      await wsHandle.close().catch(() => {});
    }
    if (gateway) {
      await stopGatewayProcess(gateway).catch(() => {});
    }
    await fakeOpenAI.close().catch(() => {});
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
}, 60000);

test("gateway enforces hard max system prompt cap and exposes dropped sections in inspect and snapshot", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-prompt-hard-cap-e2e-"));
  const conversationId = "conv-prompt-hard-cap-e2e";
  const maxChars = 40;
  const fakeOpenAI = await startFakeOpenAIServer();
  let gateway: GatewayProcessHandle | undefined;
  let wsHandle: GatewayWebSocketHandle | undefined;

  try {
    gateway = await startGatewayProcess({
      stateDir,
      openaiBaseUrl: `${fakeOpenAI.baseUrl}/v1`,
      promptMarker: "PROMPT_HARD_CAP_E2E_MARKER",
      extraEnv: {
        BELLDANDY_MAX_SYSTEM_PROMPT_CHARS: String(maxChars),
      },
    });
    wsHandle = await connectGatewayWebSocket(gateway.port);

    const sendBeforePairingReqId = "message-send-hard-cap-before-pairing";
    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: sendBeforePairingReqId,
      method: "message.send",
      params: {
        conversationId,
        text: "hard cap snapshot validation",
      },
    }));
    await approveLatestPairingCode(wsHandle.frames, stateDir);

    const sendReqId = "message-send-hard-cap-after-pairing";
    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: sendReqId,
      method: "message.send",
      params: {
        conversationId,
        text: "hard cap snapshot validation",
      },
    }));
    await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === sendReqId && frame.ok === true));
    await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "event" && frame.event === "chat.final" && frame.payload?.conversationId === conversationId));
    await waitFor(() => fakeOpenAI.requests.length > 0);

    const sendRes = wsHandle.frames.find((frame) => frame.type === "res" && frame.id === sendReqId && frame.ok === true);
    const runId = typeof sendRes?.payload?.runId === "string" ? sendRes.payload.runId : "";
    expect(runId).toBeTruthy();

    const persisted = await waitFor(async () => {
      return loadConversationPromptSnapshotArtifact({
        stateDir,
        conversationId,
        runId,
      });
    }, 10000);
    expect(persisted.summary.truncationReason).toMatchObject({
      code: "max_chars_limit",
      maxChars,
    });
    expect(persisted.snapshot.systemPrompt.length).toBeLessThanOrEqual(maxChars);
    expect(
      (persisted.summary.truncationReason?.droppedSectionIds?.length ?? 0)
      + (persisted.summary.truncationReason?.truncatedSectionIds?.length ?? 0),
    ).toBeGreaterThan(0);

    const inspectReqId = "agents-prompt-inspect-hard-cap-after-pairing";
    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: inspectReqId,
      method: "agents.prompt.inspect",
      params: {
        conversationId,
        runId,
      },
    }));
    await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === inspectReqId && frame.ok === true));

    const inspectRes = wsHandle.frames.find((frame) => frame.type === "res" && frame.id === inspectReqId);
    expect(inspectRes?.payload?.finalChars).toBeLessThanOrEqual(maxChars);
    expect(inspectRes?.payload?.metadata?.truncationReason).toMatchObject({
      code: "max_chars_limit",
      maxChars,
    });
    const inspectSectionIds = inspectRes?.payload?.sections?.map((section: any) => section.id) ?? [];
    const inspectDroppedIds = inspectRes?.payload?.metadata?.truncationReason?.droppedSectionIds ?? [];
    for (const droppedSectionId of inspectDroppedIds) {
      expect(inspectSectionIds).not.toContain(droppedSectionId);
    }
    if (inspectDroppedIds.length > 0) {
      expect(inspectRes?.payload?.droppedSections?.map((section: any) => section.id)).toEqual(
        expect.arrayContaining(inspectDroppedIds),
      );
    }

    const rpcReqId = "conversation-prompt-snapshot-hard-cap-get";
    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: rpcReqId,
      method: "conversation.prompt_snapshot.get",
      params: {
        conversationId,
        runId,
      },
    }));
    await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === rpcReqId && frame.ok === true));

    const rpcRes = wsHandle.frames.find((frame) => frame.type === "res" && frame.id === rpcReqId);
    expect(rpcRes?.payload?.snapshot?.summary).toMatchObject({
      systemPromptChars: expect.any(Number),
      truncationReason: {
        code: "max_chars_limit",
        maxChars,
      },
    });
    expect(rpcRes?.payload?.snapshot?.summary?.systemPromptChars).toBeLessThanOrEqual(maxChars);
    expect(rpcRes?.payload?.snapshot?.snapshot?.systemPrompt.length).toBeLessThanOrEqual(maxChars);
  } finally {
    if (wsHandle) {
      await wsHandle.close().catch(() => {});
    }
    if (gateway) {
      await stopGatewayProcess(gateway).catch(() => {});
    }
    await fakeOpenAI.close().catch(() => {});
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
}, 60000);

test("gateway injects work overview and resume details into non-mock continuation prompts", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-prompt-resume-context-e2e-"));
  const conversationId = "conv-real-resume-current";
  const promptMarker = "PROMPT_RESUME_CONTEXT_E2E_MARKER";
  const continuationText = "继续修 memory viewer 来源解释入口，上次做到哪了？";
  const fakeOpenAI = await startFakeOpenAIServer();
  let gateway: GatewayProcessHandle | undefined;
  let wsHandle: GatewayWebSocketHandle | undefined;

  try {
    await seedResumePromptTasks(stateDir);

    gateway = await startGatewayProcess({
      stateDir,
      openaiBaseUrl: `${fakeOpenAI.baseUrl}/v1`,
      promptMarker,
      extraEnv: {
        BELLDANDY_TASK_MEMORY_ENABLED: "true",
        BELLDANDY_CONTEXT_INJECTION: "true",
        BELLDANDY_CONTEXT_INJECTION_TASK_LIMIT: "3",
        BELLDANDY_AUTO_RECALL_ENABLED: "false",
      },
    });
    wsHandle = await connectGatewayWebSocket(gateway.port);

    const sendBeforePairingReqId = "message-send-resume-context-before-pairing";
    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: sendBeforePairingReqId,
      method: "message.send",
      params: {
        conversationId,
        text: continuationText,
      },
    }));
    await approveLatestPairingCode(wsHandle.frames, stateDir);

    const sendReqId = "message-send-resume-context-after-pairing";
    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: sendReqId,
      method: "message.send",
      params: {
        conversationId,
        text: continuationText,
      },
    }));
    await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === sendReqId && frame.ok === true));
    await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "event" && frame.event === "chat.final" && frame.payload?.conversationId === conversationId));
    await waitFor(() => fakeOpenAI.requests.length > 0);

    const sendRes = wsHandle.frames.find((frame) => frame.type === "res" && frame.id === sendReqId && frame.ok === true);
    const runId = typeof sendRes?.payload?.runId === "string" ? sendRes.payload.runId : "";
    expect(runId).toBeTruthy();

    const modelPromptText = extractFakeOpenAIRequestText(fakeOpenAI.requests.at(-1)?.body);
    expect(modelPromptText).toContain("<work-overview");
    expect(modelPromptText).toContain("<resume-details");
    expect(modelPromptText).toContain("继续修 memory viewer 来源解释入口");
    expect(modelPromptText).toContain("stop=已补来源解释卡片初版，待继续接 explain_sources 与 viewer 懒加载。");
    expect(modelPromptText).toContain("next=先验证最近变更或产物，再继续后续动作。");
    expect(modelPromptText).toContain("resume-activity");
    expect(modelPromptText).toContain("修复 memory viewer 来源解释渲染");
    expect(modelPromptText).not.toContain("similar-work");
    expect(modelPromptText).not.toContain("<recent-tasks");

    const artifactPath = getConversationPromptSnapshotArtifactPath({
      stateDir,
      conversationId,
      runId,
    });
    await waitFor(async () => {
      try {
        await fs.access(artifactPath);
        return true;
      } catch {
        return false;
      }
    });

    const persisted = await loadConversationPromptSnapshotArtifact({
      stateDir,
      conversationId,
      runId,
    });
    expect(persisted?.snapshot.prependContext).toContain("<work-overview");
    expect(persisted?.snapshot.prependContext).toContain("<resume-details");
    expect(persisted?.snapshot.prependContext).toContain("stop=已补来源解释卡片初版，待继续接 explain_sources 与 viewer 懒加载。");
    expect(persisted?.snapshot.prependContext).toContain("next=先验证最近变更或产物，再继续后续动作。");
    expect(persisted?.snapshot.prependContext).toContain("resume-activity");
    expect(persisted?.snapshot.prependContext).not.toContain("similar-work");
    expect(persisted?.snapshot.prependContext).not.toContain("<recent-tasks");
    expect(persisted?.snapshot.deltas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "work-overview",
        deltaType: "user-prelude",
        text: expect.stringContaining("<work-overview"),
      }),
      expect.objectContaining({
        id: "resume-details",
        deltaType: "user-prelude",
        text: expect.stringContaining("<resume-details"),
      }),
    ]));

    const inspectReqId = "agents-prompt-inspect-resume-context-after-pairing";
    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: inspectReqId,
      method: "agents.prompt.inspect",
      params: {
        conversationId,
        runId,
      },
    }));
    await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === inspectReqId && frame.ok === true));

    const inspectRes = wsHandle.frames.find((frame) => frame.type === "res" && frame.id === inspectReqId);
    expect(inspectRes?.payload?.deltas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "work-overview",
        deltaType: "user-prelude",
        text: expect.stringContaining("stop=已补来源解释卡片初版，待继续接 explain_sources 与 viewer 懒加载。"),
      }),
      expect.objectContaining({
        id: "resume-details",
        deltaType: "user-prelude",
        text: expect.stringContaining("resume-activity"),
      }),
    ]));
    expect(fakeOpenAI.requests).toHaveLength(1);
  } finally {
    if (wsHandle) {
      await wsHandle.close().catch(() => {});
    }
    if (gateway) {
      await stopGatewayProcess(gateway).catch(() => {});
    }
    await fakeOpenAI.close().catch(() => {});
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
}, 60000);

test("gateway exposes canonical profile state through model prompt, persisted snapshot, and inspect surfaces", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-prompt-profile-state-e2e-"));
  const conversationId = "conv-profile-state-runtime";
  const promptMarker = "PROMPT_PROFILE_STATE_E2E_MARKER";
  const currentTurnText = "继续这个项目，先给稳定结论。";
  const fakeOpenAI = await startFakeOpenAIServer();
  let gateway: GatewayProcessHandle | undefined;
  let wsHandle: GatewayWebSocketHandle | undefined;

  try {
    await seedPromptProfileState(stateDir);

    gateway = await startGatewayProcess({
      stateDir,
      openaiBaseUrl: `${fakeOpenAI.baseUrl}/v1`,
      promptMarker,
    });
    wsHandle = await connectGatewayWebSocket(gateway.port);

    const sendBeforePairingReqId = "message-send-profile-state-before-pairing";
    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: sendBeforePairingReqId,
      method: "message.send",
      params: {
        conversationId,
        text: currentTurnText,
      },
    }));
    await approveLatestPairingCode(wsHandle.frames, stateDir);

    const sendReqId = "message-send-profile-state-after-pairing";
    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: sendReqId,
      method: "message.send",
      params: {
        conversationId,
        text: currentTurnText,
      },
    }));
    await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === sendReqId && frame.ok === true));
    await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "event" && frame.event === "chat.final" && frame.payload?.conversationId === conversationId));
    await waitFor(() => fakeOpenAI.requests.length > 0);

    const sendRes = wsHandle.frames.find((frame) => frame.type === "res" && frame.id === sendReqId && frame.ok === true);
    const runId = typeof sendRes?.payload?.runId === "string" ? sendRes.payload.runId : "";
    expect(runId).toBeTruthy();

    const modelPromptText = extractFakeOpenAIRequestText(fakeOpenAI.requests.at(-1)?.body);
    expect(modelPromptText).toContain("<mind-profile-runtime");
    expect(modelPromptText).toContain("<canonical-profile-state>");
    expect(modelPromptText).toContain("preferences.response_style = 先给稳定结论，再展开说明");
    expect(modelPromptText).toContain("workstyle.planning_preference = 先列计划，再推进实现");

    const artifactPath = getConversationPromptSnapshotArtifactPath({
      stateDir,
      conversationId,
      runId,
    });
    await waitFor(async () => {
      try {
        await fs.access(artifactPath);
        return true;
      } catch {
        return false;
      }
    });

    const persisted = await loadConversationPromptSnapshotArtifact({
      stateDir,
      conversationId,
      runId,
    });
    expect(persisted?.snapshot.prependContext).toContain("<mind-profile-runtime");
    expect(persisted?.snapshot.prependContext).toContain("<canonical-profile-state>");
    expect(persisted?.snapshot.prependContext).toContain("preferences.response_style = 先给稳定结论，再展开说明");
    expect(persisted?.snapshot.prependContext).toContain("workstyle.planning_preference = 先列计划，再推进实现");
    expect(persisted?.snapshot.deltas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "mind-profile-runtime",
        deltaType: "user-prelude",
        source: "mind-profile-runtime",
        text: expect.stringContaining("<canonical-profile-state>"),
        metadata: expect.objectContaining({
          blockTag: "mind-profile-runtime",
          activationReason: "profile_state_present",
          profileStateLineCount: 2,
          profileStatePaths: [
            "preferences.response_style",
            "workstyle.planning_preference",
          ],
          memoryFreshness: expect.objectContaining({
            summary: expect.objectContaining({
              available: true,
              itemCount: 1,
            }),
            items: expect.arrayContaining([
              expect.objectContaining({
                memoryClass: "profile_semantic",
              }),
            ]),
          }),
        }),
      }),
    ]));

    const inspectReqId = "agents-prompt-inspect-profile-state-after-pairing";
    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: inspectReqId,
      method: "agents.prompt.inspect",
      params: {
        conversationId,
        runId,
      },
    }));
    await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === inspectReqId && frame.ok === true));

    const inspectRes = wsHandle.frames.find((frame) => frame.type === "res" && frame.id === inspectReqId);
    expect(inspectRes?.payload?.metadata).toMatchObject({
      snapshotScope: "run",
      hasPrependContext: true,
      deltaCount: expect.any(Number),
      deltaTypes: expect.arrayContaining(["user-prelude"]),
      memoryFreshness: {
        summary: {
          available: true,
          itemCount: 1,
        },
        items: [
          expect.objectContaining({
            memoryClass: "profile_semantic",
          }),
        ],
      },
    });
    expect(inspectRes?.payload?.deltas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "mind-profile-runtime",
        deltaType: "user-prelude",
        source: "mind-profile-runtime",
        text: expect.stringContaining("preferences.response_style = 先给稳定结论，再展开说明"),
        metadata: expect.objectContaining({
          blockTag: "mind-profile-runtime",
          activationReason: "profile_state_present",
          profileStateLineCount: 2,
          memoryFreshness: expect.objectContaining({
            summary: expect.objectContaining({
              available: true,
              itemCount: 1,
            }),
          }),
        }),
      }),
    ]));

    const rpcReqId = "conversation-prompt-snapshot-profile-state-get";
    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: rpcReqId,
      method: "conversation.prompt_snapshot.get",
      params: {
        conversationId,
        runId,
      },
    }));
    await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === rpcReqId && frame.ok === true));

    const rpcRes = wsHandle.frames.find((frame) => frame.type === "res" && frame.id === rpcReqId);
    expect(rpcRes?.payload?.snapshot?.summary).toMatchObject({
      hasPrependContext: true,
      deltaCount: expect.any(Number),
    });
    expect(rpcRes?.payload?.snapshot?.snapshot?.prependContext).toContain("<canonical-profile-state>");
    expect(rpcRes?.payload?.snapshot?.snapshot?.deltas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "mind-profile-runtime",
        metadata: expect.objectContaining({
          activationReason: "profile_state_present",
          profileStatePaths: [
            "preferences.response_style",
            "workstyle.planning_preference",
          ],
          memoryFreshness: expect.objectContaining({
            summary: expect.objectContaining({
              available: true,
              itemCount: 1,
            }),
          }),
        }),
      }),
    ]));
    expect(fakeOpenAI.requests).toHaveLength(1);
  } finally {
    if (wsHandle) {
      await wsHandle.close().catch(() => {});
    }
    if (gateway) {
      await stopGatewayProcess(gateway).catch(() => {});
    }
    await fakeOpenAI.close().catch(() => {});
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
}, 60000);

test("gateway applies prompt section priority override experiments to agent inspect", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-prompt-priority-experiment-e2e-"));
  const fakeOpenAI = await startFakeOpenAIServer();
  let gateway: GatewayProcessHandle | undefined;
  let wsHandle: GatewayWebSocketHandle | undefined;

  try {
    gateway = await startGatewayProcess({
      stateDir,
      openaiBaseUrl: `${fakeOpenAI.baseUrl}/v1`,
      promptMarker: "PROMPT_PRIORITY_EXPERIMENT_E2E_MARKER",
      extraEnv: {
        BELLDANDY_PROMPT_EXPERIMENT_SECTION_PRIORITY_OVERRIDES: "methodology:5,extra:150",
      },
    });
    wsHandle = await connectGatewayWebSocket(gateway.port);

    const inspectReqId = "agents-prompt-inspect-priority-before-pairing";
    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: inspectReqId,
      method: "agents.prompt.inspect",
      params: {
        agentId: "default",
      },
    }));
    await approveLatestPairingCode(wsHandle.frames, stateDir);

    const inspectAfterPairingReqId = "agents-prompt-inspect-priority-after-pairing";
    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: inspectAfterPairingReqId,
      method: "agents.prompt.inspect",
      params: {
        agentId: "default",
      },
    }));
    await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === inspectAfterPairingReqId && frame.ok === true));

    const inspectRes = wsHandle.frames.find((frame) => frame.type === "res" && frame.id === inspectAfterPairingReqId);
    const sectionIds = inspectRes?.payload?.sections?.map((section: any) => section.id) ?? [];
    expect(sectionIds.indexOf("methodology")).toBeGreaterThanOrEqual(0);
    expect(sectionIds.indexOf("context")).toBeGreaterThanOrEqual(0);
    expect(sectionIds.indexOf("extra")).toBeGreaterThanOrEqual(0);
    expect(sectionIds.indexOf("methodology")).toBeLessThan(sectionIds.indexOf("context"));
    expect(sectionIds.indexOf("context")).toBeLessThan(sectionIds.indexOf("extra"));
    expect(inspectRes?.payload?.metadata?.promptExperiments).toMatchObject({
      sectionPriorityOverridesConfigured: {
        methodology: 5,
        extra: 150,
      },
      sectionPriorityOverridesApplied: {
        methodology: 5,
        extra: 150,
      },
    });
  } finally {
    if (wsHandle) {
      await wsHandle.close().catch(() => {});
    }
    if (gateway) {
      await stopGatewayProcess(gateway).catch(() => {});
    }
    await fakeOpenAI.close().catch(() => {});
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
}, 60000);

test("gateway applies prompt tool contract experiments to tool visibility and model definitions", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-prompt-tool-contract-experiment-e2e-"));
  const fakeOpenAI = await startFakeOpenAIServer();
  let gateway: GatewayProcessHandle | undefined;
  let wsHandle: GatewayWebSocketHandle | undefined;

  try {
    gateway = await startGatewayProcess({
      stateDir,
      openaiBaseUrl: `${fakeOpenAI.baseUrl}/v1`,
      promptMarker: "PROMPT_TOOL_CONTRACT_EXPERIMENT_E2E_MARKER",
      extraEnv: {
        BELLDANDY_TOOLS_ENABLED: "true",
        BELLDANDY_DANGEROUS_TOOLS_ENABLED: "true",
        BELLDANDY_PROMPT_EXPERIMENT_DISABLE_TOOL_CONTRACTS: "apply_patch",
      },
    });
    wsHandle = await connectGatewayWebSocket(gateway.port);

    const sendBeforePairingReqId = "message-send-tool-contract-before-pairing";
    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: sendBeforePairingReqId,
      method: "message.send",
      params: {
        conversationId: "conv-tool-contract-experiment",
        text: "tool contract experiment",
      },
    }));
    await approveLatestPairingCode(wsHandle.frames, stateDir);

    const toolsListAfterPairingReqId = "tools-list-tool-contract-after-pairing";
    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: toolsListAfterPairingReqId,
      method: "tools.list",
      params: {},
    }));
    await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === toolsListAfterPairingReqId && frame.ok === true));

    const toolsListRes = wsHandle.frames.find((frame) => frame.type === "res" && frame.id === toolsListAfterPairingReqId);
    expect(toolsListRes?.payload?.builtin).toEqual(expect.arrayContaining(["apply_patch"]));
    expect(toolsListRes?.payload?.visibility?.apply_patch).toMatchObject({
      available: false,
      reasonCode: "blocked-by-security-matrix",
      contractReason: "blocked",
    });

    const sendReqId = "message-send-tool-contract-after-pairing";
    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: sendReqId,
      method: "message.send",
      params: {
        conversationId: "conv-tool-contract-experiment",
        text: "tool contract experiment",
      },
    }));
    await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === sendReqId && frame.ok === true));
    await waitFor(() => fakeOpenAI.requests.length > 0);

    const requestTools = fakeOpenAI.requests[0]?.body?.tools;
    expect(Array.isArray(requestTools)).toBe(true);
    expect((requestTools as Array<any>).map((tool) => tool?.function?.name)).not.toContain("apply_patch");

    const inspectReqId = "agents-prompt-inspect-tool-contract-after-pairing";
    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: inspectReqId,
      method: "agents.prompt.inspect",
      params: {
        agentId: "default",
      },
    }));
    await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === inspectReqId && frame.ok === true));

    const inspectRes = wsHandle.frames.find((frame) => frame.type === "res" && frame.id === inspectReqId);
    expect(inspectRes?.payload?.sections?.map((section: any) => section.id)).toContain("tool-behavior-contracts");
    expect(inspectRes?.payload?.metadata?.promptExperiments).toMatchObject({
      disabledToolContractNamesConfigured: ["apply_patch"],
      disabledToolContractNamesApplied: ["apply_patch"],
    });
    expect(inspectRes?.payload?.metadata?.toolBehaviorObservability).toMatchObject({
      counts: {
        includedContractCount: expect.any(Number),
      },
      included: expect.arrayContaining([
        "run_command",
        "delegate_task",
        "file_write",
        "file_delete",
        "delegate_parallel",
      ]),
      experiment: {
        disabledContractNamesConfigured: ["apply_patch"],
        disabledContractNamesApplied: ["apply_patch"],
      },
    });
    expect(inspectRes?.payload?.metadata?.toolBehaviorObservability?.included).toEqual(expect.arrayContaining([
      "run_command",
      "delegate_task",
      "file_write",
      "file_delete",
      "delegate_parallel",
    ]));
    expect(inspectRes?.payload?.metadata?.toolBehaviorObservability?.included).not.toContain("apply_patch");
    expect(inspectRes?.payload?.metadata?.toolBehaviorObservability?.summary).toContain("## run_command");
    expect(inspectRes?.payload?.metadata?.toolBehaviorObservability?.summary).toContain("## delegate_task");
    expect(inspectRes?.payload?.metadata?.toolBehaviorObservability?.summary).toContain("## file_write");
    expect(inspectRes?.payload?.metadata?.toolBehaviorObservability?.summary).toContain("## file_delete");
    expect(inspectRes?.payload?.metadata?.toolBehaviorObservability?.summary).toContain("## delegate_parallel");
    expect(inspectRes?.payload?.metadata?.toolBehaviorObservability?.summary).not.toContain("## apply_patch");
    expect(inspectRes?.payload?.metadata?.toolContractsIncluded).toBeUndefined();
    expect(inspectRes?.payload?.metadata?.toolContractSummary).toBeUndefined();
  } finally {
    if (wsHandle) {
      await wsHandle.close().catch(() => {});
    }
    if (gateway) {
      await stopGatewayProcess(gateway).catch(() => {});
    }
    await fakeOpenAI.close().catch(() => {});
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
}, 60000);

test("gateway does not force legacy marker fallback for unstructured snapshots without the legacy marker", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-prompt-no-legacy-marker-e2e-"));
  const conversationId = "conv-prompt-no-legacy-marker";
  const runId = "run-no-legacy-marker";
  const fakeOpenAI = await startFakeOpenAIServer();
  let gateway: GatewayProcessHandle | undefined;
  let wsHandle: GatewayWebSocketHandle | undefined;

  try {
    await persistConversationPromptSnapshot({
      stateDir,
      snapshot: {
        agentId: "default",
        conversationId,
        runId,
        createdAt: 1712000002000,
        systemPrompt: "PROMPT_NO_LEGACY_MARKER_E2E_MARKER\nRuntime identity: user=test-user",
        messages: [
          { role: "system", content: "PROMPT_NO_LEGACY_MARKER_E2E_MARKER\nRuntime identity: user=test-user" },
          { role: "user", content: "hello" },
        ],
      },
    });

    gateway = await startGatewayProcess({
      stateDir,
      openaiBaseUrl: `${fakeOpenAI.baseUrl}/v1`,
      promptMarker: "PROMPT_NO_LEGACY_MARKER_E2E_MARKER",
    });
    wsHandle = await connectGatewayWebSocket(gateway.port);

    const inspectReqId = "agents-prompt-inspect-no-legacy-marker-before-pairing";
    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: inspectReqId,
      method: "agents.prompt.inspect",
      params: {
        conversationId,
        runId,
      },
    }));
    await approveLatestPairingCode(wsHandle.frames, stateDir);

    const inspectAfterPairingReqId = "agents-prompt-inspect-no-legacy-marker-after-pairing";
    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: inspectAfterPairingReqId,
      method: "agents.prompt.inspect",
      params: {
        conversationId,
        runId,
      },
    }));
    await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === inspectAfterPairingReqId && frame.ok === true));

    const inspectRes = wsHandle.frames.find((frame) => frame.type === "res" && frame.id === inspectAfterPairingReqId);
    expect(inspectRes?.payload?.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "runtime-system-prompt",
        text: "PROMPT_NO_LEGACY_MARKER_E2E_MARKER\nRuntime identity: user=test-user",
      }),
    ]));
    expect(inspectRes?.payload?.deltas ?? []).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "snapshot-normalize",
      }),
    ]));
  } finally {
    if (wsHandle) {
      await wsHandle.close().catch(() => {});
    }
    if (gateway) {
      await stopGatewayProcess(gateway).catch(() => {});
    }
    await fakeOpenAI.close().catch(() => {});
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
}, 60000);

test("gateway normalizes legacy persisted snapshots before run inspection", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-prompt-legacy-normalize-e2e-"));
  const conversationId = "conv-prompt-legacy-normalize";
  const runId = "run-legacy-normalize";
  const artifactPath = getConversationPromptSnapshotArtifactPath({
    stateDir,
    conversationId,
    runId,
  });
  const fakeOpenAI = await startFakeOpenAIServer();
  let gateway: GatewayProcessHandle | undefined;
  let wsHandle: GatewayWebSocketHandle | undefined;

  try {
    await fs.mkdir(path.dirname(artifactPath), { recursive: true });
    await fs.writeFile(artifactPath, JSON.stringify({
      schemaVersion: 1,
      manifest: {
        conversationId,
        runId,
        agentId: "default",
        createdAt: 1712000002500,
        persistedAt: 1712000002501,
        source: "runtime.prompt_snapshot",
      },
      summary: {
        messageCount: 2,
        systemPromptChars: 81,
        includesHookSystemPrompt: false,
        hasPrependContext: true,
        deltaCount: 0,
        deltaChars: 0,
        systemPromptEstimatedTokens: 0,
        deltaEstimatedTokens: 0,
        providerNativeSystemBlockCount: 0,
        providerNativeSystemBlockChars: 0,
        providerNativeSystemBlockEstimatedTokens: 0,
      },
      snapshot: {
        systemPrompt: "PROMPT_LEGACY_NORMALIZE_E2E_MARKER\n## Identity Context (Runtime)\n- Current User UUID: test-user",
        messages: [
          {
            role: "system",
            content: "PROMPT_LEGACY_NORMALIZE_E2E_MARKER\n## Identity Context (Runtime)\n- Current User UUID: test-user",
          },
          { role: "user", content: "hello" },
        ],
        hookSystemPromptUsed: false,
        prependContext: "<recent-memory>ctx</recent-memory>",
      },
    }, null, 2), "utf-8");

    gateway = await startGatewayProcess({
      stateDir,
      openaiBaseUrl: `${fakeOpenAI.baseUrl}/v1`,
      promptMarker: "PROMPT_LEGACY_NORMALIZE_E2E_MARKER",
    });
    wsHandle = await connectGatewayWebSocket(gateway.port);

    const inspectReqId = "agents-prompt-inspect-legacy-normalize-before-pairing";
    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: inspectReqId,
      method: "agents.prompt.inspect",
      params: {
        conversationId,
        runId,
      },
    }));
    await approveLatestPairingCode(wsHandle.frames, stateDir);

    const inspectAfterPairingReqId = "agents-prompt-inspect-legacy-normalize-after-pairing";
    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: inspectAfterPairingReqId,
      method: "agents.prompt.inspect",
      params: {
        conversationId,
        runId,
      },
    }));
    await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === inspectAfterPairingReqId && frame.ok === true));

    const inspectRes = wsHandle.frames.find((frame) => frame.type === "res" && frame.id === inspectAfterPairingReqId);
    expect(inspectRes?.payload?.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "runtime-system-prompt",
        text: "PROMPT_LEGACY_NORMALIZE_E2E_MARKER",
      }),
    ]));
    expect(inspectRes?.payload?.deltas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "runtime-identity-context",
        deltaType: "runtime-identity",
        source: "snapshot-normalize",
      }),
      expect.objectContaining({
        id: "prepend-context",
        deltaType: "user-prelude",
        source: "snapshot-normalize",
      }),
    ]));

    const rpcReqId = "conversation-prompt-snapshot-legacy-normalize-get";
    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: rpcReqId,
      method: "conversation.prompt_snapshot.get",
      params: {
        conversationId,
        runId,
      },
    }));
    await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === rpcReqId && frame.ok === true));

    const rpcRes = wsHandle.frames.find((frame) => frame.type === "res" && frame.id === rpcReqId);
    expect(rpcRes?.payload?.snapshot?.summary).toMatchObject({
      deltaCount: 2,
      hasPrependContext: true,
    });
    expect(rpcRes?.payload?.snapshot?.snapshot?.deltas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "runtime-identity-context",
      }),
      expect.objectContaining({
        id: "prepend-context",
      }),
    ]));
  } finally {
    if (wsHandle) {
      await wsHandle.close().catch(() => {});
    }
    if (gateway) {
      await stopGatewayProcess(gateway).catch(() => {});
    }
    await fakeOpenAI.close().catch(() => {});
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
}, 60000);

test("gateway prefers structured deltas over legacy marker splitting for old snapshots", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-prompt-legacy-fallback-e2e-"));
  const conversationId = "conv-prompt-legacy-fallback";
  const runId = "run-legacy-fallback";
  const fakeOpenAI = await startFakeOpenAIServer();
  let gateway: GatewayProcessHandle | undefined;
  let wsHandle: GatewayWebSocketHandle | undefined;

  try {
    await persistConversationPromptSnapshot({
      stateDir,
      snapshot: {
        agentId: "default",
        conversationId,
        runId,
        createdAt: 1712000001000,
        systemPrompt: "PROMPT_LEGACY_FALLBACK_E2E_MARKER\nRuntime identity: user=test-user",
        messages: [
          { role: "system", content: "PROMPT_LEGACY_FALLBACK_E2E_MARKER\nRuntime identity: user=test-user" },
          { role: "user", content: "hello" },
        ],
        deltas: [
          {
            id: "runtime-identity-context",
            deltaType: "runtime-identity",
            role: "system",
            source: "legacy-structured-delta",
            text: "Runtime identity: user=test-user",
          },
        ],
      },
    });

    gateway = await startGatewayProcess({
      stateDir,
      openaiBaseUrl: `${fakeOpenAI.baseUrl}/v1`,
      promptMarker: "PROMPT_LEGACY_FALLBACK_E2E_MARKER",
    });
    wsHandle = await connectGatewayWebSocket(gateway.port);

    const inspectReqId = "agents-prompt-inspect-legacy-fallback-before-pairing";
    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: inspectReqId,
      method: "agents.prompt.inspect",
      params: {
        conversationId,
        runId,
      },
    }));
    await approveLatestPairingCode(wsHandle.frames, stateDir);

    const inspectAfterPairingReqId = "agents-prompt-inspect-legacy-fallback-after-pairing";
    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: inspectAfterPairingReqId,
      method: "agents.prompt.inspect",
      params: {
        conversationId,
        runId,
      },
    }));
    await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === inspectAfterPairingReqId && frame.ok === true));

    const inspectRes = wsHandle.frames.find((frame) => frame.type === "res" && frame.id === inspectAfterPairingReqId);
    expect(inspectRes?.payload?.sections?.map((section: any) => section.id)).toContain("runtime-system-prompt");
    expect(inspectRes?.payload?.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "runtime-system-prompt",
        text: "PROMPT_LEGACY_FALLBACK_E2E_MARKER",
      }),
    ]));
    expect(inspectRes?.payload?.deltas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "runtime-identity-context",
        source: "legacy-structured-delta",
      }),
    ]));
    expect(inspectRes?.payload?.deltas).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "snapshot-normalize",
      }),
    ]));
    expect(inspectRes?.payload?.providerNativeSystemBlocks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        blockType: "dynamic-runtime",
        sourceDeltaIds: ["runtime-identity-context"],
      }),
    ]));
  } finally {
    if (wsHandle) {
      await wsHandle.close().catch(() => {});
    }
    if (gateway) {
      await stopGatewayProcess(gateway).catch(() => {});
    }
    await fakeOpenAI.close().catch(() => {});
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
}, 60000);

type FakeOpenAIHandle = {
  baseUrl: string;
  requests: Array<{ url: string; body: Record<string, unknown> }>;
  close: () => Promise<void>;
};

async function startFakeOpenAIServer(): Promise<FakeOpenAIHandle> {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || !req.url || !req.url.endsWith("/chat/completions")) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }

    const raw = await readRequestBody(req);
    const body = JSON.parse(raw || "{}") as Record<string, unknown>;
    requests.push({
      url: req.url,
      body,
    });

    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "gpt-test",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "stubbed response",
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2,
      },
    }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind fake OpenAI server");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () => {
      if (!server.listening) return;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

type GatewayProcessHandle = {
  child: ChildProcess;
  port: number;
  output: string[];
};

async function startGatewayProcess(input: {
  stateDir: string;
  openaiBaseUrl: string;
  promptMarker: string;
  extraEnv?: Record<string, string>;
}): Promise<GatewayProcessHandle> {
  const output: string[] = [];
  const port = await getAvailablePort();
  const inheritedEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      !key.startsWith("BELLDANDY_")
      && !key.startsWith("OPENAI_")
      && !key.startsWith("STAR_SANCTUARY_")
      && key !== "AUTO_OPEN_BROWSER"
    ),
  );
  const child = spawn(process.execPath, ["--import", "tsx", GATEWAY_ENTRY_PATH], {
    cwd: REPO_ROOT,
    env: {
      ...inheritedEnv,
      BELLDANDY_STATE_DIR: input.stateDir,
      BELLDANDY_ENV_DIR: input.stateDir,
      BELLDANDY_PORT: String(port),
      BELLDANDY_HOST: "127.0.0.1",
      BELLDANDY_AUTH_MODE: "none",
      BELLDANDY_COMMUNITY_API_ENABLED: "false",
      BELLDANDY_ALLOWED_ORIGINS: "http://127.0.0.1",
      BELLDANDY_AGENT_PROVIDER: "openai",
      BELLDANDY_OPENAI_API_KEY: "test-openai-key",
      BELLDANDY_OPENAI_BASE_URL: input.openaiBaseUrl,
      BELLDANDY_OPENAI_MODEL: "gpt-test",
      BELLDANDY_OPENAI_STREAM: "false",
      BELLDANDY_OPENAI_SYSTEM_PROMPT: input.promptMarker,
      BELLDANDY_PRIMARY_WARMUP_ENABLED: "false",
      BELLDANDY_HEARTBEAT_ENABLED: "false",
      BELLDANDY_CRON_ENABLED: "false",
      AUTO_OPEN_BROWSER: "false",
      OPENAI_API_KEY: "test-openai-key",
      STAR_SANCTUARY_WEB_ROOT: resolveWebRoot(),
      ...input.extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.setEncoding("utf-8");
  child.stderr?.setEncoding("utf-8");

  const consumeOutput = (chunk: string | Buffer) => {
    const text = chunk.toString();
    output.push(text);
  };
  child.stdout?.on("data", consumeOutput);
  child.stderr?.on("data", consumeOutput);

  await waitFor(async () => {
    if (child.exitCode !== null) {
      throw new Error(`Gateway exited before startup (code=${String(child.exitCode)})\n${output.join("")}`);
    }
    const joined = output.join("");
    const match = new RegExp(`Belldandy Gateway running: http://127\\.0\\.0\\.1:${port}`).exec(joined);
    if (!match) {
      return undefined;
    }
    return true;
  }, 30000);

  return {
    child,
    port,
    output,
  };
}

async function stopGatewayProcess(handle: GatewayProcessHandle): Promise<void> {
  const child = handle.child;
  if (child.exitCode !== null || child.killed) {
    return;
  }

  child.kill();

  const exited = await Promise.race([
    once(child, "exit").then(() => true),
    sleep(3000).then(() => false),
  ]);
  if (exited) {
    return;
  }

  if (typeof child.pid === "number" && process.platform === "win32") {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
    await once(killer, "exit").catch(() => {});
    await once(child, "exit").catch(() => {});
    return;
  }

  child.kill("SIGKILL");
  await once(child, "exit").catch(() => {});
}

type GatewayWebSocketHandle = {
  ws: WebSocket;
  frames: any[];
  close: () => Promise<void>;
};

async function connectGatewayWebSocket(port: number): Promise<GatewayWebSocketHandle> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closePromise = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => {
    frames.push(JSON.parse(data.toString("utf-8")));
  });

  await waitFor(() => frames.some((frame) => frame.type === "connect.challenge"));
  ws.send(JSON.stringify({ type: "connect", role: "web", auth: { mode: "none" } }));
  await waitFor(() => frames.some((frame) => frame.type === "hello-ok"));

  return {
    ws,
    frames,
    close: async () => {
      if (ws.readyState === WebSocket.CLOSED) return;
      ws.close();
      await closePromise;
    },
  };
}

async function approveLatestPairingCode(frames: any[], stateDir: string): Promise<void> {
  await waitFor(() => frames.some((frame) => frame.type === "event" && frame.event === "pairing.required"));
  const approved = await waitFor(async () => {
    const pairingEvents = frames.filter((frame) => frame.type === "event" && frame.event === "pairing.required");
    const candidateCodes = [];
    const seen = new Set<string>();

    for (const frame of pairingEvents.slice().reverse()) {
      const code = frame?.payload?.code ? String(frame.payload.code) : "";
      if (!code || seen.has(code)) {
        continue;
      }
      seen.add(code);
      candidateCodes.push(code);
    }

    for (const code of candidateCodes) {
      const result = await approvePairingCode({ code, stateDir });
      if (result.ok) {
        return result;
      }
    }

    return undefined;
  }, 5000);

  expect(approved?.ok).toBe(true);
}

async function seedResumePromptTasks(stateDir: string): Promise<void> {
  const memoryPolicy = resolveResidentMemoryPolicy(stateDir, buildDefaultProfile());
  await fs.mkdir(memoryPolicy.managerStateDir, { recursive: true });

  const memoryManager = new MemoryManager({
    workspaceRoot: memoryPolicy.managerStateDir,
    stateDir: memoryPolicy.managerStateDir,
    storePath: path.join(memoryPolicy.managerStateDir, "memory.sqlite"),
    taskMemoryEnabled: true,
    openaiApiKey: "test-memory-seed-key",
  });

  try {
    const store = (memoryManager as any).store as {
      createTask(task: TaskRecord): void;
      createTaskActivity(activity: TaskActivityRecord): void;
    };

    seedTaskForPrompt(store, {
      taskId: "task-real-resume-current",
      conversationId: "conv-real-resume-current",
      agentId: "default",
      status: "partial",
      objective: "继续修 memory viewer 来源解释入口",
      summary: "已补来源解释卡片初版，待继续接 explain_sources 与 viewer 懒加载。",
      updatedAt: "2026-04-17T13:20:00.000Z",
      workRecapHeadline: "已确认 2 条执行事实；当前停在：已补来源解释卡片初版，待继续接 explain_sources 与 viewer 懒加载。",
      nextStep: "先验证最近变更或产物，再继续后续动作。",
      activities: [
        createPromptContextActivity({
          id: "activity-real-current-1",
          taskId: "task-real-resume-current",
          conversationId: "conv-real-resume-current",
          sequence: 0,
          kind: "tool_called",
          state: "completed",
          happenedAt: "2026-04-17T13:05:00.000Z",
          title: "已执行工具 apply_patch",
        }),
        createPromptContextActivity({
          id: "activity-real-current-2",
          taskId: "task-real-resume-current",
          conversationId: "conv-real-resume-current",
          sequence: 1,
          kind: "file_changed",
          state: "completed",
          happenedAt: "2026-04-17T13:10:00.000Z",
          title: "已变更文件：apps/web/public/app/features/memory-detail-render.js",
          files: ["apps/web/public/app/features/memory-detail-render.js"],
        }),
      ],
    });

    seedTaskForPrompt(store, {
      taskId: "task-real-resume-similar",
      conversationId: "conv-real-resume-similar",
      agentId: "default",
      status: "success",
      objective: "修复 memory viewer 来源解释渲染",
      summary: "已补 viewer 中 explain_sources 来源说明与任务详情展示。",
      updatedAt: "2026-04-16T17:00:00.000Z",
      workRecapHeadline: "任务已完成；已确认 1 条执行事实。",
      activities: [
        createPromptContextActivity({
          id: "activity-real-similar-1",
          taskId: "task-real-resume-similar",
          conversationId: "conv-real-resume-similar",
          sequence: 0,
          kind: "file_changed",
          state: "completed",
          happenedAt: "2026-04-16T16:55:00.000Z",
          title: "已变更文件：apps/web/public/app/features/memory-detail-render.js",
          files: ["apps/web/public/app/features/memory-detail-render.js"],
        }),
      ],
    });
  } finally {
    memoryManager.close();
  }
}

async function seedPromptProfileState(stateDir: string): Promise<void> {
  const memoryPolicy = resolveResidentMemoryPolicy(stateDir, buildDefaultProfile());
  await fs.mkdir(memoryPolicy.managerStateDir, { recursive: true });

  const memoryManager = new MemoryManager({
    workspaceRoot: memoryPolicy.managerStateDir,
    stateDir: memoryPolicy.managerStateDir,
    storePath: path.join(memoryPolicy.managerStateDir, "memory.sqlite"),
    openaiApiKey: "test-memory-seed-key",
  });

  try {
    memoryManager.upsertProfileStateEntry({
      scope: "user",
      path: "preferences.response_style",
      value: "先给稳定结论，再展开说明",
      createdBy: "test-seed",
    });
    memoryManager.upsertProfileStateEntry({
      scope: "user",
      path: "workstyle.planning_preference",
      value: "先列计划，再推进实现",
      createdBy: "test-seed",
    });
  } finally {
    memoryManager.close();
  }
}

function seedTaskForPrompt(store: {
  createTask(task: TaskRecord): void;
  createTaskActivity(activity: TaskActivityRecord): void;
}, input: {
  taskId: string;
  conversationId: string;
  agentId?: string;
  status: TaskRecord["status"];
  objective?: string;
  summary?: string;
  updatedAt: string;
  workRecapHeadline: string;
  nextStep?: string;
  activities: TaskActivityRecord[];
}): void {
  const derivedFromActivityIds = input.activities.map((activity) => activity.id);
  const confirmedFacts = input.activities.map((activity) => activity.title);
  const task: TaskRecord = {
    id: input.taskId,
    conversationId: input.conversationId,
    sessionKey: input.conversationId,
    agentId: input.agentId,
    source: "chat",
    status: input.status,
    objective: input.objective,
    summary: input.summary,
    startedAt: input.updatedAt,
    finishedAt: input.status === "success" ? input.updatedAt : undefined,
    createdAt: input.updatedAt,
    updatedAt: input.updatedAt,
    workRecap: {
      taskId: input.taskId,
      conversationId: input.conversationId,
      sessionKey: input.conversationId,
      agentId: input.agentId,
      headline: input.workRecapHeadline,
      confirmedFacts,
      pendingActions: input.nextStep ? [input.nextStep] : undefined,
      derivedFromActivityIds,
      updatedAt: input.updatedAt,
    },
    resumeContext: {
      taskId: input.taskId,
      conversationId: input.conversationId,
      sessionKey: input.conversationId,
      agentId: input.agentId,
      currentStopPoint: input.status === "success" ? "任务已完成。" : input.summary,
      nextStep: input.nextStep,
      derivedFromActivityIds,
      updatedAt: input.updatedAt,
    },
  };

  store.createTask(task);
  for (const activity of input.activities) {
    store.createTaskActivity(activity);
  }
}

function createPromptContextActivity(input: {
  id: string;
  taskId: string;
  conversationId: string;
  sequence: number;
  kind: TaskActivityRecord["kind"];
  state: TaskActivityRecord["state"];
  happenedAt: string;
  title: string;
  files?: string[];
}): TaskActivityRecord {
  return {
    id: input.id,
    taskId: input.taskId,
    conversationId: input.conversationId,
    sessionKey: input.conversationId,
    source: "chat",
    kind: input.kind,
    state: input.state,
    sequence: input.sequence,
    happenedAt: input.happenedAt,
    recordedAt: input.happenedAt,
    title: input.title,
    files: input.files,
  };
}

function extractFakeOpenAIRequestText(body?: Record<string, unknown>): string {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  return messages
    .flatMap((message) => extractOpenAIMessageContent((message as Record<string, unknown>)?.content))
    .join("\n\n");
}

function extractOpenAIMessageContent(content: unknown): string[] {
  if (typeof content === "string") {
    return [content];
  }
  if (!Array.isArray(content)) {
    return [];
  }
  return content.flatMap((part) => {
    if (!part || typeof part !== "object") {
      return [];
    }
    const text = (part as Record<string, unknown>).text;
    return typeof text === "string" ? [text] : [];
  });
}

async function readRequestBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function waitFor<T>(predicate: () => T | Promise<T>, timeoutMs = 5000): Promise<Exclude<T, false | undefined | null>> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await predicate();
    if (result) {
      return result as Exclude<T, false | undefined | null>;
    }
    await sleep(20);
  }
  throw new Error(`timeout after ${timeoutMs}ms`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getAvailablePort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Failed to reserve an ephemeral port");
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  return address.port;
}
