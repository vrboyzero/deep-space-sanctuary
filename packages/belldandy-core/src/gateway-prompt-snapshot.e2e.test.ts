import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath, pathToFileURL } from "node:url";

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
const BROWSER_TOOLS_MODULE_URL = pathToFileURL(path.join(
  REPO_ROOT,
  "packages",
  "belldandy-skills",
  "dist",
  "builtin",
  "browser",
  "tools.js",
)).href;

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

test("gateway forensic prompt snapshot separates latest analysis-only request from historical resume actions", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-prompt-history-boundary-e2e-"));
  const conversationId = "conv-real-resume-current";
  const promptMarker = "PROMPT_HISTORY_BOUNDARY_E2E_MARKER";
  const analysisText = "继续分析一下为什么之前会误执行旧命令，不要执行任何命令，只做原因分析。";
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

    const sendBeforePairingReqId = "message-send-history-boundary-before-pairing";
    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: sendBeforePairingReqId,
      method: "message.send",
      params: {
        conversationId,
        text: analysisText,
      },
    }));
    await approveLatestPairingCode(wsHandle.frames, stateDir);

    const sendReqId = "message-send-history-boundary-after-pairing";
    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: sendReqId,
      method: "message.send",
      params: {
        conversationId,
        text: analysisText,
      },
    }));
    await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === sendReqId && frame.ok === true));
    await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "event" && frame.event === "chat.final" && frame.payload?.conversationId === conversationId));
    await waitFor(() => fakeOpenAI.requests.length > 0);

    const sendRes = wsHandle.frames.find((frame) => frame.type === "res" && frame.id === sendReqId && frame.ok === true);
    const runId = typeof sendRes?.payload?.runId === "string" ? sendRes.payload.runId : "";
    expect(runId).toBeTruthy();

    const modelPromptText = extractFakeOpenAIRequestText(fakeOpenAI.requests.at(-1)?.body);
    expect(modelPromptText).toContain("<current-turn");
    expect(modelPromptText).toContain("<latest-user-request");
    expect(modelPromptText).toContain("只有这里的最新用户请求");
    expect(modelPromptText).toContain("不要自动重放旧动作");
    expect(modelPromptText).toContain(analysisText);
    expect(modelPromptText).toContain("<work-overview");
    expect(modelPromptText).toContain("<resume-details");
    expect(modelPromptText).toContain("已执行工具 apply_patch");
    expect(modelPromptText).toContain("先验证最近变更或产物，再继续后续动作。");
    expect(modelPromptText).toContain("旧命令、旧工具结果、旧 next step、旧参数默认都只是恢复线索");

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
    expect(persisted?.snapshot.systemPrompt).toContain("Only the latest user turn authorizes new actions");
    expect(persisted?.snapshot.prependContext).toContain("<current-turn");
    expect(persisted?.snapshot.prependContext).toContain("<latest-user-request");
    expect(persisted?.snapshot.prependContext).toContain(analysisText);
    expect(persisted?.snapshot.prependContext).toContain("已执行工具 apply_patch");
    expect(persisted?.snapshot.prependContext).toContain("先验证最近变更或产物，再继续后续动作。");
    expect(persisted?.snapshot.prependContext).toContain("不要自动重放旧动作");
    expect(persisted?.snapshot.prependContext).toContain("旧命令、旧工具结果、旧 next step、旧参数默认都只是恢复线索");

    const inspectReqId = "agents-prompt-inspect-history-boundary-after-pairing";
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
    expect(inspectRes?.payload?.text).toContain("Only the latest user turn authorizes new actions");
    expect(inspectRes?.payload?.deltas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "current-turn",
        deltaType: "user-prelude",
        text: expect.stringContaining("<latest-user-request"),
      }),
      expect.objectContaining({
        id: "work-overview",
        deltaType: "user-prelude",
        text: expect.stringContaining("next=先验证最近变更或产物，再继续后续动作。"),
      }),
      expect.objectContaining({
        id: "resume-details",
        deltaType: "user-prelude",
        text: expect.stringContaining("已执行工具 apply_patch"),
      }),
    ]));

    const rpcReqId = "conversation-prompt-snapshot-history-boundary-get";
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
    expect(rpcRes?.payload?.snapshot?.snapshot?.systemPrompt).toContain("Only the latest user turn authorizes new actions");
    expect(rpcRes?.payload?.snapshot?.snapshot?.prependContext).toContain("<latest-user-request");
    expect(rpcRes?.payload?.snapshot?.snapshot?.prependContext).toContain(analysisText);
    expect(rpcRes?.payload?.snapshot?.snapshot?.prependContext).toContain("已执行工具 apply_patch");
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

test("gateway carryover context forensics keeps a single latest file_read source across real multi-turn prompts", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-carryover-context-e2e-"));
  const conversationId = "conv-carryover-context-real";
  const promptMarker = "PROMPT_CARRYOVER_CONTEXT_E2E_MARKER";
  const fileRelativePath = "src/app.ts";
  const fileAbsolutePath = path.join(stateDir, "src", "app.ts");
  const fakeOpenAI = await startFakeOpenAIServer({
    handler: ({ requests }) => {
      switch (requests.length) {
        case 1:
          return createFakeChatCompletionResponse({
            content: "",
            toolCalls: [{
              id: "call-file-1",
              name: "file_read",
              arguments: JSON.stringify({ path: fileRelativePath }),
            }],
          });
        case 2:
          return createFakeChatCompletionResponse({
            content: "已读取第一版文件。",
          });
        case 3:
          return createFakeChatCompletionResponse({
            content: "",
            toolCalls: [{
              id: "call-file-2",
              name: "file_read",
              arguments: JSON.stringify({ path: fileRelativePath }),
            }],
          });
        case 4:
          return createFakeChatCompletionResponse({
            content: "已读取第二版文件。",
          });
        case 5:
          return createFakeChatCompletionResponse({
            content: "基于现有上下文给出稳定结论。",
          });
        default:
          return createFakeChatCompletionResponse({
            content: `unexpected request ${requests.length}`,
          });
      }
    },
  });
  let gateway: GatewayProcessHandle | undefined;
  let wsHandle: GatewayWebSocketHandle | undefined;

  try {
    await fs.mkdir(path.dirname(fileAbsolutePath), { recursive: true });
    await fs.writeFile(fileAbsolutePath, "export const answer = 42;\nexport const label = \"v1\";\n", "utf-8");

    gateway = await startGatewayProcess({
      stateDir,
      openaiBaseUrl: `${fakeOpenAI.baseUrl}/v1`,
      promptMarker,
      extraEnv: {
        BELLDANDY_TOOLS_ENABLED: "true",
        BELLDANDY_CONTEXT_INJECTION: "true",
        BELLDANDY_AUTO_RECALL_ENABLED: "false",
      },
    });
    wsHandle = await connectGatewayWebSocket(gateway.port);

    const sendMessage = async (requestId: string, text: string): Promise<string> => {
      const finalCountBefore = wsHandle!.frames.filter((frame) =>
        frame.type === "event"
        && frame.event === "chat.final"
        && frame.payload?.conversationId === conversationId
      ).length;
      wsHandle!.ws.send(JSON.stringify({
        type: "req",
        id: requestId,
        method: "message.send",
        params: {
          conversationId,
          text,
        },
      }));
      await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === requestId && frame.ok === true));
      await waitFor(() =>
        wsHandle!.frames.filter((frame) =>
          frame.type === "event"
          && frame.event === "chat.final"
          && frame.payload?.conversationId === conversationId
        ).length > finalCountBefore,
      );
      const sendRes = wsHandle!.frames.find((frame) => frame.type === "res" && frame.id === requestId && frame.ok === true);
      const runId = typeof sendRes?.payload?.runId === "string" ? sendRes.payload.runId : "";
      expect(runId).toBeTruthy();
      return runId;
    };

    const readMeta = async (requestId: string) => {
      wsHandle!.ws.send(JSON.stringify({
        type: "req",
        id: requestId,
        method: "conversation.meta",
        params: {
          conversationId,
        },
      }));
      await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === requestId && frame.ok === true));
      return wsHandle!.frames.find((frame) => frame.type === "res" && frame.id === requestId)?.payload;
    };

    const inspectRun = async (requestId: string, runId: string) => {
      wsHandle!.ws.send(JSON.stringify({
        type: "req",
        id: requestId,
        method: "agents.prompt.inspect",
        params: {
          conversationId,
          runId,
        },
      }));
      await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === requestId && frame.ok === true));
      return wsHandle!.frames.find((frame) => frame.type === "res" && frame.id === requestId)?.payload;
    };

    const sendBeforePairingReqId = "message-send-carryover-before-pairing";
    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: sendBeforePairingReqId,
      method: "message.send",
      params: {
        conversationId,
        text: "pairing bootstrap",
      },
    }));
    await approveLatestPairingCode(wsHandle.frames, stateDir);

    await sendMessage("message-send-carryover-round-1", "读取 src/app.ts，并总结关键事实。");
    await waitFor(() => fakeOpenAI.requests.length >= 2);

    const metaAfterFirstRun = await readMeta("conversation-meta-carryover-round-1");
    expect(metaAfterFirstRun?.carryoverContextEstimate).toMatchObject({
      itemCount: 1,
    });
    expect(metaAfterFirstRun?.carryoverContextEstimate?.tokens).toBeGreaterThan(0);
    expect(metaAfterFirstRun?.nextTurnContextEstimate?.tokens).toBeGreaterThan(metaAfterFirstRun?.retainedContextEstimate?.tokens ?? 0);

    await fs.writeFile(fileAbsolutePath, "export const answer = 43;\nexport const label = \"v2\";\n", "utf-8");

    await sendMessage("message-send-carryover-round-2", "继续分析这个文件，如有需要可再次读取。");
    await waitFor(() => fakeOpenAI.requests.length >= 4);

    const secondTurnPrompt = fakeOpenAI.requestTexts[2] ?? "";
    const secondTurnCarryover = extractTaggedPromptBlock(secondTurnPrompt, "carryover-context");
    expect(secondTurnPrompt).toContain("<carryover-context");
    expect(secondTurnCarryover).toContain("file_read: src/app.ts");
    expect(secondTurnCarryover).toContain("export const answer = 42;");
    expect(countSubstring(secondTurnCarryover, "file_read: src/app.ts")).toBe(1);

    const metaAfterSecondRun = await readMeta("conversation-meta-carryover-round-2");
    expect(metaAfterSecondRun?.carryoverContextEstimate).toMatchObject({
      itemCount: 1,
    });
    expect(metaAfterSecondRun?.carryoverContextEstimate?.tokens).toBeGreaterThan(0);
    expect(metaAfterSecondRun?.nextTurnContextEstimate?.tokens).toBeGreaterThan(metaAfterSecondRun?.retainedContextEstimate?.tokens ?? 0);

    const finalRunId = await sendMessage("message-send-carryover-round-3", "继续，不要再读文件，直接基于现有上下文给出结论。");
    await waitFor(() => fakeOpenAI.requests.length >= 5);

    const thirdTurnPrompt = fakeOpenAI.requestTexts[4] ?? "";
    const thirdTurnCarryover = extractTaggedPromptBlock(thirdTurnPrompt, "carryover-context");
    expect(thirdTurnPrompt).toContain("<carryover-context");
    expect(thirdTurnCarryover).toContain("file_read: src/app.ts");
    expect(thirdTurnCarryover).toContain("export const answer = 43;");
    expect(thirdTurnCarryover).not.toContain("export const answer = 42;");
    expect(countSubstring(thirdTurnCarryover, "file_read: src/app.ts")).toBe(1);

    const inspectRes = await inspectRun("agents-prompt-inspect-carryover-round-3", finalRunId);
    const carryoverDelta = Array.isArray(inspectRes?.deltas)
      ? inspectRes.deltas.find((item: any) => item?.id === "carryover-context")
      : undefined;
    expect(carryoverDelta).toMatchObject({
      id: "carryover-context",
      deltaType: "user-prelude",
      text: expect.stringContaining("file_read: src/app.ts"),
    });
    expect(String(carryoverDelta?.text ?? "")).toContain("export const answer = 43;");
    expect(String(carryoverDelta?.text ?? "")).not.toContain("export const answer = 42;");
    expect(countSubstring(String(carryoverDelta?.text ?? ""), "file_read: src/app.ts")).toBe(1);

    expect(fakeOpenAI.requests).toHaveLength(5);
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

test("gateway low-risk config A/B keeps retained history thicker without displacing carryover context", async () => {
  const rounds = Array.from({ length: 12 }, (_, index) => {
    const turn = index + 1;
    return `第${turn}轮：保留这个续做锚点 MARKER_TURN_${turn.toString().padStart(2, "0")}，并继续当前分析。`;
  });

  async function runScenario(input: {
    stateDirPrefix: string;
    promptMarker: string;
    conversationId: string;
    extraEnv?: Record<string, string>;
  }) {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), input.stateDirPrefix));
    const fileRelativePath = "src/app.ts";
    const fileAbsolutePath = path.join(stateDir, "src", "app.ts");
    let requestCount = 0;
    const fakeOpenAI = await startFakeOpenAIServer({
      handler: () => {
        requestCount += 1;
        if (requestCount === 1) {
          return createFakeChatCompletionResponse({
            content: "",
            toolCalls: [{
              id: "ab-call-file-1",
              name: "file_read",
              arguments: JSON.stringify({ path: fileRelativePath }),
            }],
          });
        }
        if (requestCount === 2) {
          return createFakeChatCompletionResponse({
            content: "已读取关键文件，继续推进。",
          });
        }
        return createFakeChatCompletionResponse({
          content: `ack-turn-${requestCount}`,
        });
      },
    });
    let gateway: GatewayProcessHandle | undefined;
    let wsHandle: GatewayWebSocketHandle | undefined;

    try {
      await fs.mkdir(path.dirname(fileAbsolutePath), { recursive: true });
      await fs.writeFile(fileAbsolutePath, "export const answer = 42;\nexport const label = \"ab-test\";\n", "utf-8");

      gateway = await startGatewayProcess({
        stateDir,
        openaiBaseUrl: `${fakeOpenAI.baseUrl}/v1`,
        promptMarker: input.promptMarker,
        extraEnv: {
          BELLDANDY_TOOLS_ENABLED: "true",
          BELLDANDY_CONTEXT_INJECTION: "true",
          BELLDANDY_AUTO_RECALL_ENABLED: "false",
          BELLDANDY_CONTEXT_INJECTION_INCLUDE_SESSION: "false",
          BELLDANDY_TASK_MEMORY_ENABLED: "false",
          BELLDANDY_MEMORY_SESSION_DIGEST_MAX_RUNS: "0",
          ...(input.extraEnv ?? {}),
        },
      });
      wsHandle = await connectGatewayWebSocket(gateway.port);

      const sendMessage = async (requestId: string, text: string): Promise<string> => {
        const finalCountBefore = wsHandle!.frames.filter((frame) =>
          frame.type === "event"
          && frame.event === "chat.final"
          && frame.payload?.conversationId === input.conversationId
        ).length;
        wsHandle!.ws.send(JSON.stringify({
          type: "req",
          id: requestId,
          method: "message.send",
          params: {
            conversationId: input.conversationId,
            text,
          },
        }));
        await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === requestId && frame.ok === true));
        await waitFor(() =>
          wsHandle!.frames.filter((frame) =>
            frame.type === "event"
            && frame.event === "chat.final"
            && frame.payload?.conversationId === input.conversationId
          ).length > finalCountBefore,
        );
        const sendRes = wsHandle!.frames.find((frame) => frame.type === "res" && frame.id === requestId && frame.ok === true);
        const runId = typeof sendRes?.payload?.runId === "string" ? sendRes.payload.runId : "";
        expect(runId).toBeTruthy();
        return runId;
      };

      const readMeta = async (requestId: string) => {
        wsHandle!.ws.send(JSON.stringify({
          type: "req",
          id: requestId,
          method: "conversation.meta",
          params: {
            conversationId: input.conversationId,
          },
        }));
        await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === requestId && frame.ok === true));
        return wsHandle!.frames.find((frame) => frame.type === "res" && frame.id === requestId)?.payload;
      };

      const sendBeforePairingReqId = `${input.conversationId}-before-pairing`;
      wsHandle.ws.send(JSON.stringify({
        type: "req",
        id: sendBeforePairingReqId,
        method: "message.send",
        params: {
          conversationId: input.conversationId,
          text: "pairing bootstrap",
        },
      }));
      await approveLatestPairingCode(wsHandle.frames, stateDir);

      await sendMessage(`${input.conversationId}-read-file`, "先读取 src/app.ts，并记住里面的关键事实。");
      await waitFor(() => fakeOpenAI.requests.length >= 2);

      let finalRunId = "";
      for (let index = 0; index < rounds.length; index += 1) {
        finalRunId = await sendMessage(`${input.conversationId}-turn-${index + 1}`, rounds[index]);
      }
      await waitFor(() => fakeOpenAI.requests.length >= 2 + rounds.length);

      const meta = await readMeta(`${input.conversationId}-meta-final`);
      const finalPromptText = fakeOpenAI.requestTexts.at(-1) ?? "";
      const finalCarryoverBlock = extractTaggedPromptBlock(finalPromptText, "carryover-context");

      return {
        stateDir,
        finalRunId,
        meta,
        finalPromptText,
        finalCarryoverBlock,
        requestCount: fakeOpenAI.requests.length,
      };
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
  }

  const baseline = await runScenario({
    stateDirPrefix: "belldandy-low-risk-ab-baseline-",
    promptMarker: "PROMPT_LOW_RISK_AB_BASELINE",
    conversationId: "conv-low-risk-ab-baseline",
  });
  const variant = await runScenario({
    stateDirPrefix: "belldandy-low-risk-ab-variant-",
    promptMarker: "PROMPT_LOW_RISK_AB_VARIANT",
    conversationId: "conv-low-risk-ab-variant",
    extraEnv: {
      BELLDANDY_MAX_HISTORY: "60",
      BELLDANDY_COMPACTION_KEEP_RECENT: "40",
      BELLDANDY_TOOL_RESULT_TRANSCRIPT_CHAR_LIMIT: "24000",
      BELLDANDY_PROMPT_SNAPSHOT_MAX_RUNS: "96",
      BELLDANDY_PROMPT_SNAPSHOT_MAX_PERSISTED_RUNS: "40",
    },
  });

  expect(baseline.meta?.messages).toHaveLength(10);
  expect(variant.meta?.messages).toHaveLength(26);

  expect(Number(baseline.meta?.retainedContextEstimate?.messageCount ?? 0)).toBe(10);
  expect(Number(variant.meta?.retainedContextEstimate?.messageCount ?? 0)).toBe(26);
  expect(Number(variant.meta?.retainedContextEstimate?.tokens ?? 0)).toBeGreaterThan(Number(baseline.meta?.retainedContextEstimate?.tokens ?? 0));

  expect(Number(baseline.meta?.carryoverContextEstimate?.itemCount ?? 0)).toBe(1);
  expect(Number(variant.meta?.carryoverContextEstimate?.itemCount ?? 0)).toBe(1);
  expect(Number(baseline.meta?.nextTurnContextEstimate?.tokens ?? 0)).toBeGreaterThan(Number(baseline.meta?.retainedContextEstimate?.tokens ?? 0));
  expect(Number(variant.meta?.nextTurnContextEstimate?.tokens ?? 0)).toBeGreaterThan(Number(variant.meta?.retainedContextEstimate?.tokens ?? 0));

  expect(baseline.finalPromptText).not.toContain("MARKER_TURN_01");
  expect(variant.finalPromptText).toContain("MARKER_TURN_01");
  expect(baseline.finalPromptText).not.toContain("MARKER_TURN_04");
  expect(variant.finalPromptText).toContain("MARKER_TURN_04");
  expect(baseline.finalPromptText).toContain("MARKER_TURN_12");
  expect(variant.finalPromptText).toContain("MARKER_TURN_12");

  expect(baseline.finalCarryoverBlock).toContain("file_read: src/app.ts");
  expect(variant.finalCarryoverBlock).toContain("file_read: src/app.ts");
  expect(countSubstring(baseline.finalCarryoverBlock, "file_read: src/app.ts")).toBe(1);
  expect(countSubstring(variant.finalCarryoverBlock, "file_read: src/app.ts")).toBe(1);
  expect(baseline.requestCount).toBe(14);
  expect(variant.requestCount).toBe(14);
}, 120000);

test("gateway carryover context ranks multi-source records by current request relevance and keeps stable source keys", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-carryover-multi-source-e2e-"));
  const conversationId = "conv-carryover-multi-source-real";
  const promptMarker = "PROMPT_CARRYOVER_MULTI_SOURCE_E2E_MARKER";
  const logDate = new Date().toISOString().slice(0, 10);
  const fakeOpenAI = await startFakeOpenAIServer({
    handler: ({ requests }) => {
      switch (requests.length) {
        case 1:
          return createFakeChatCompletionResponse({
            content: "",
            toolCalls: [{
              id: "call-file-seed",
              name: "file_read",
              arguments: JSON.stringify({ path: "src/app.ts" }),
            }],
          });
        case 2:
          return createFakeChatCompletionResponse({
            content: "已读取文件。",
          });
        case 3:
          return createFakeChatCompletionResponse({
            content: "",
            toolCalls: [{
              id: "call-conversation-seed",
              name: "conversation_read",
              arguments: JSON.stringify({ conversation_id: conversationId, view: "restore", limit: 5 }),
            }],
          });
        case 4:
          return createFakeChatCompletionResponse({
            content: "已读取会话恢复视图。",
          });
        case 5:
          return createFakeChatCompletionResponse({
            content: "",
            toolCalls: [{
              id: "call-log-search-seed",
              name: "log_search",
              arguments: JSON.stringify({ query: "spawn EPERM", startDate: logDate, endDate: logDate }),
            }],
          });
        case 6:
          return createFakeChatCompletionResponse({
            content: "已读取日志错误。",
          });
        case 7:
          return createFakeChatCompletionResponse({
            content: "基于现有上下文继续排查 pnpm test 的 spawn EPERM。",
          });
        default:
          return createFakeChatCompletionResponse({
            content: `unexpected request ${requests.length}`,
          });
      }
    },
  });
  let gateway: GatewayProcessHandle | undefined;
  let wsHandle: GatewayWebSocketHandle | undefined;

  try {
    await fs.mkdir(path.join(stateDir, "src"), { recursive: true });
    await fs.writeFile(path.join(stateDir, "src", "app.ts"), "export const answer = 43;\n", "utf-8");
    await fs.mkdir(path.join(stateDir, "logs"), { recursive: true });
    await fs.writeFile(
      path.join(stateDir, "logs", `${logDate}.log`),
      `[ERROR][gateway] spawn EPERM while launching pnpm test\n[INFO][gateway] startup ok\n`,
      "utf-8",
    );

    gateway = await startGatewayProcess({
      stateDir,
      openaiBaseUrl: `${fakeOpenAI.baseUrl}/v1`,
      promptMarker,
      extraEnv: {
        BELLDANDY_TOOLS_ENABLED: "true",
        BELLDANDY_CONTEXT_INJECTION: "true",
        BELLDANDY_AUTO_RECALL_ENABLED: "false",
        BELLDANDY_CONTEXT_INJECTION_INCLUDE_SESSION: "false",
      },
    });
    wsHandle = await connectGatewayWebSocket(gateway.port);

    const sendMessage = async (requestId: string, text: string): Promise<string> => {
      const finalCountBefore = wsHandle!.frames.filter((frame) =>
        frame.type === "event"
        && frame.event === "chat.final"
        && frame.payload?.conversationId === conversationId
      ).length;
      wsHandle!.ws.send(JSON.stringify({
        type: "req",
        id: requestId,
        method: "message.send",
        params: {
          conversationId,
          text,
        },
      }));
      await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === requestId && frame.ok === true));
      await waitFor(() =>
        wsHandle!.frames.filter((frame) =>
          frame.type === "event"
          && frame.event === "chat.final"
          && frame.payload?.conversationId === conversationId
        ).length > finalCountBefore,
      );
      const sendRes = wsHandle!.frames.find((frame) => frame.type === "res" && frame.id === requestId && frame.ok === true);
      const runId = typeof sendRes?.payload?.runId === "string" ? sendRes.payload.runId : "";
      expect(runId).toBeTruthy();
      return runId;
    };

    const readMeta = async (requestId: string) => {
      wsHandle!.ws.send(JSON.stringify({
        type: "req",
        id: requestId,
        method: "conversation.meta",
        params: {
          conversationId,
        },
      }));
      await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === requestId && frame.ok === true));
      return wsHandle!.frames.find((frame) => frame.type === "res" && frame.id === requestId)?.payload;
    };

    const sendBeforePairingReqId = "message-send-carryover-multi-source-before-pairing";
    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: sendBeforePairingReqId,
      method: "message.send",
      params: {
        conversationId,
        text: "pairing bootstrap",
      },
    }));
    await approveLatestPairingCode(wsHandle.frames, stateDir);

    await sendMessage("message-send-carryover-source-file", "先读取 src/app.ts，并记住关键事实。");
    await waitFor(() => fakeOpenAI.requests.length >= 2);

    await sendMessage("message-send-carryover-source-conversation", "再读取当前会话的 restore 视图，确认上轮停点。");
    await waitFor(() => fakeOpenAI.requests.length >= 4);

    await sendMessage("message-send-carryover-source-log", "再搜索 logs 里关于 spawn EPERM 的错误。");
    await waitFor(() => fakeOpenAI.requests.length >= 6);

    await sendMessage("message-send-carryover-source-final", "继续排查 pnpm test 的 spawn EPERM，不要重复读文件。");
    await waitFor(() => fakeOpenAI.requests.length >= 7);

    const finalPromptText = fakeOpenAI.requestTexts.at(-1) ?? "";
    const carryoverBlock = extractTaggedPromptBlock(finalPromptText, "carryover-context");
    const meta = await readMeta("conversation-meta-carryover-multi-source");

    expect(carryoverBlock).toContain("log_search: spawn EPERM");
    expect(carryoverBlock).toContain("conversation_read: conv-carryover-multi-source-real#restore");
    expect(carryoverBlock).toContain("file_read: src/app.ts");
    expect(carryoverBlock.indexOf("log_search: spawn EPERM")).toBeGreaterThanOrEqual(0);
    expect(carryoverBlock.indexOf("log_search: spawn EPERM")).toBeLessThan(carryoverBlock.indexOf("conversation_read: conv-carryover-multi-source-real#restore"));
    expect(carryoverBlock.indexOf("log_search: spawn EPERM")).toBeLessThan(carryoverBlock.indexOf("file_read: src/app.ts"));

    expect(Number(meta?.carryoverContextEstimate?.itemCount ?? 0)).toBe(3);
    expect(Number(meta?.nextTurnContextEstimate?.tokens ?? 0)).toBeGreaterThan(Number(meta?.retainedContextEstimate?.tokens ?? 0));
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
}, 120000);

test("gateway long-session experience A/B compares baseline, low-risk, and low-risk+carryover on rereads, omissions, and conclusion stability", async () => {
  const FACT_ROLLOUT_DECISION = "rolloutDecision=low-risk-first";
  const FACT_NORMALIZE_OLD_FACTS = "normalizeOldFacts = false;";
  const FACT_STOP_POINT = "stopPoint=verify-long-session-ab-metrics";
  const FACT_ROOT_CAUSE = "rootCause=spawn-EPERM-vitest-child-process";
  const EXPECTED_FACTS = [
    FACT_ROLLOUT_DECISION,
    FACT_NORMALIZE_OLD_FACTS,
    FACT_STOP_POINT,
    FACT_ROOT_CAUSE,
  ];
  const canonicalFinalText = [
    "稳定结论：",
    FACT_ROLLOUT_DECISION,
    "carryoverLimit = 6;",
    FACT_NORMALIZE_OLD_FACTS,
    FACT_STOP_POINT,
    FACT_ROOT_CAUSE,
  ].join("\n");
  const fillerTurns = Array.from({ length: 8 }, (_, index) =>
    `第${index + 1}轮继续推进长会话验证，保留占位 MARKER_LONG_${String(index + 1).padStart(2, "0")}。`);

  async function runScenario(input: {
    stateDirPrefix: string;
    promptMarker: string;
    conversationId: string;
    extraEnv?: Record<string, string>;
  }) {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), input.stateDirPrefix));
    const fileRelativePath = "src/runtime/carryover.ts";
    const fileAbsolutePath = path.join(stateDir, "src", "runtime", "carryover.ts");
    const logDate = new Date().toISOString().slice(0, 10);
    const logQuery = "spawn-EPERM";
    const scenarioState = {
      finalTurnToolCalls: 0,
    };
    const fakeOpenAI = await startFakeOpenAIServer({
      handler: ({ body, requests }) => {
        const promptText = extractFakeOpenAIRequestText(body);
        const latestUserRequest = extractTaggedPromptInnerText(promptText, "latest-user-request");
        const missingFacts = EXPECTED_FACTS.filter((fact) => !promptText.includes(fact));

        switch (requests.length) {
          case 1:
            return createFakeChatCompletionResponse({
              content: "",
              toolCalls: [{
                id: "long-file-1",
                name: "file_read",
                arguments: JSON.stringify({ path: fileRelativePath }),
              }],
            });
          case 2:
            return createFakeChatCompletionResponse({
              content: "已确认 src/runtime/carryover.ts 中 carryoverLimit = 6；我继续核对其他来源。",
            });
          case 3:
            return createFakeChatCompletionResponse({
              content: "",
              toolCalls: [{
                id: "long-conversation-1",
                name: "conversation_read",
                arguments: JSON.stringify({ conversation_id: input.conversationId, view: "restore", limit: 20 }),
              }],
            });
          case 4:
            return createFakeChatCompletionResponse({
              content: `从 restore 看，${FACT_STOP_POINT}。`,
            });
          case 5:
            return createFakeChatCompletionResponse({
              content: "",
              toolCalls: [{
                id: "long-log-1",
                name: "log_search",
                arguments: JSON.stringify({ query: logQuery, startDate: logDate, endDate: logDate }),
              }],
            });
          case 6:
            return createFakeChatCompletionResponse({
              content: `日志结论：${FACT_ROOT_CAUSE}。`,
            });
          case 7:
            return createFakeChatCompletionResponse({
              content: `收到，${FACT_ROLLOUT_DECISION}。`,
            });
          default:
            if (latestUserRequest.includes("不要重读，直接给完整结论")) {
              if (missingFacts.length === 0) {
                return createFakeChatCompletionResponse({
                  content: canonicalFinalText,
                });
              }
              if (scenarioState.finalTurnToolCalls > 0) {
                return createFakeChatCompletionResponse({
                  content: canonicalFinalText,
                });
              }
              scenarioState.finalTurnToolCalls += 1;
              if (missingFacts.includes(FACT_ROLLOUT_DECISION) || missingFacts.includes(FACT_STOP_POINT)) {
                return createFakeChatCompletionResponse({
                  content: "",
                  toolCalls: [{
                    id: `long-final-conversation-${scenarioState.finalTurnToolCalls}`,
                    name: "conversation_read",
                    arguments: JSON.stringify({ conversation_id: input.conversationId, view: "restore", limit: 20 }),
                  }],
                });
              }
              if (missingFacts.includes(FACT_NORMALIZE_OLD_FACTS)) {
                return createFakeChatCompletionResponse({
                  content: "",
                  toolCalls: [{
                    id: `long-final-file-${scenarioState.finalTurnToolCalls}`,
                    name: "file_read",
                    arguments: JSON.stringify({ path: fileRelativePath }),
                  }],
                });
              }
              if (missingFacts.includes(FACT_ROOT_CAUSE)) {
                return createFakeChatCompletionResponse({
                  content: "",
                  toolCalls: [{
                    id: `long-final-log-${scenarioState.finalTurnToolCalls}`,
                    name: "log_search",
                    arguments: JSON.stringify({ query: logQuery, startDate: logDate, endDate: logDate }),
                  }],
                });
              }
              return createFakeChatCompletionResponse({
                content: canonicalFinalText,
              });
            }
            return createFakeChatCompletionResponse({
              content: `ack-long-turn-${requests.length}`,
            });
        }
      },
    });
    let gateway: GatewayProcessHandle | undefined;
    let wsHandle: GatewayWebSocketHandle | undefined;

    try {
      await fs.mkdir(path.dirname(fileAbsolutePath), { recursive: true });
      await fs.writeFile(fileAbsolutePath, [
        "export const carryoverLimit = 6;",
        "export const normalizeOldFacts = false;",
        "export const carryoverSourceMode = \"stable\";",
        "",
      ].join("\n"), "utf-8");
      await fs.mkdir(path.join(stateDir, "logs"), { recursive: true });
      await fs.writeFile(
        path.join(stateDir, "logs", `${logDate}.log`),
        [
          `[ERROR][gateway] ${FACT_ROOT_CAUSE}`,
          "[INFO][gateway] startup ok",
          "",
        ].join("\n"),
        "utf-8",
      );

      gateway = await startGatewayProcess({
        stateDir,
        openaiBaseUrl: `${fakeOpenAI.baseUrl}/v1`,
        promptMarker: input.promptMarker,
        extraEnv: {
          BELLDANDY_TOOLS_ENABLED: "true",
          BELLDANDY_CONTEXT_INJECTION: "true",
          BELLDANDY_AUTO_RECALL_ENABLED: "false",
          BELLDANDY_CONTEXT_INJECTION_INCLUDE_SESSION: "false",
          BELLDANDY_TASK_MEMORY_ENABLED: "false",
          BELLDANDY_MEMORY_SESSION_DIGEST_MAX_RUNS: "0",
          ...(input.extraEnv ?? {}),
        },
      });
      wsHandle = await connectGatewayWebSocket(gateway.port);

      const sendMessage = async (
        requestId: string,
        text: string,
        timeoutMs = 5000,
      ): Promise<{ runId: string; finalText: string }> => {
        const finalCountBefore = wsHandle!.frames.filter((frame) =>
          frame.type === "event"
          && frame.event === "chat.final"
          && frame.payload?.conversationId === input.conversationId
        ).length;
        wsHandle!.ws.send(JSON.stringify({
          type: "req",
          id: requestId,
          method: "message.send",
          params: {
            conversationId: input.conversationId,
            text,
          },
        }));
        await waitFor(
          () => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === requestId && frame.ok === true),
          timeoutMs,
        );
        await waitFor(() =>
          wsHandle!.frames.filter((frame) =>
            frame.type === "event"
            && frame.event === "chat.final"
            && frame.payload?.conversationId === input.conversationId
          ).length > finalCountBefore,
          timeoutMs,
        );
        const sendRes = wsHandle!.frames.find((frame) => frame.type === "res" && frame.id === requestId && frame.ok === true);
        const runId = typeof sendRes?.payload?.runId === "string" ? sendRes.payload.runId : "";
        const finalFrame = wsHandle!.frames
          .filter((frame) =>
            frame.type === "event"
            && frame.event === "chat.final"
            && frame.payload?.conversationId === input.conversationId)
          .at(-1);
        const finalText = String(finalFrame?.payload?.text ?? "");
        expect(runId).toBeTruthy();
        expect(finalText).toBeTruthy();
        return { runId, finalText };
      };

      const readMeta = async (requestId: string) => {
        wsHandle!.ws.send(JSON.stringify({
          type: "req",
          id: requestId,
          method: "conversation.meta",
          params: {
            conversationId: input.conversationId,
          },
        }));
        await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === requestId && frame.ok === true));
        return wsHandle!.frames.find((frame) => frame.type === "res" && frame.id === requestId)?.payload;
      };

      const sendBeforePairingReqId = `${input.conversationId}-before-pairing`;
      wsHandle.ws.send(JSON.stringify({
        type: "req",
        id: sendBeforePairingReqId,
        method: "message.send",
        params: {
          conversationId: input.conversationId,
          text: "pairing bootstrap",
        },
      }));
      await approveLatestPairingCode(wsHandle.frames, stateDir);

      await sendMessage(`${input.conversationId}-source-file`, "先读取 src/runtime/carryover.ts，并记住实现细节。");
      await sendMessage(`${input.conversationId}-source-conversation`, "再读取当前会话 restore 视图，确认停点。");
      await sendMessage(`${input.conversationId}-source-log`, "再搜索 logs 里关于 spawn-EPERM 的错误。");
      await sendMessage(`${input.conversationId}-decision`, `再记住这个决策：${FACT_ROLLOUT_DECISION}。`);

      for (let index = 0; index < fillerTurns.length; index += 1) {
        await sendMessage(`${input.conversationId}-filler-${index + 1}`, fillerTurns[index]);
      }

      const preFinalRequestCount = fakeOpenAI.requests.length;
      const finalResult = await sendMessage(
        `${input.conversationId}-final`,
        "不要重读，直接给完整结论：需要包含 rolloutDecision、normalizeOldFacts、stopPoint、rootCause。",
        15000,
      );
      const initialFinalPromptText = fakeOpenAI.requestTexts[preFinalRequestCount] ?? "";
      const initialMissingFacts = EXPECTED_FACTS.filter((fact) => !initialFinalPromptText.includes(fact));
      const meta = await readMeta(`${input.conversationId}-meta-final`);

      return {
        initialFinalPromptText,
        initialFinalCarryoverBlock: extractTaggedPromptBlock(initialFinalPromptText, "carryover-context"),
        initialMissingFacts,
        finalTurnToolCalls: scenarioState.finalTurnToolCalls,
        finalText: finalResult.finalText,
        meta,
      };
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
  }

  const baseline = await runScenario({
    stateDirPrefix: "belldandy-long-session-baseline-",
    promptMarker: "PROMPT_LONG_SESSION_BASELINE",
    conversationId: "conv-long-session-baseline",
    extraEnv: {
      BELLDANDY_CARRYOVER_CONTEXT_ENABLED: "true",
    },
  });
  const lowRiskOnly = await runScenario({
    stateDirPrefix: "belldandy-long-session-low-risk-only-",
    promptMarker: "PROMPT_LONG_SESSION_LOW_RISK_ONLY",
    conversationId: "conv-long-session-low-risk-only",
    extraEnv: {
      BELLDANDY_MAX_HISTORY: "60",
      BELLDANDY_COMPACTION_KEEP_RECENT: "40",
      BELLDANDY_TOOL_RESULT_TRANSCRIPT_CHAR_LIMIT: "24000",
      BELLDANDY_PROMPT_SNAPSHOT_MAX_RUNS: "96",
      BELLDANDY_PROMPT_SNAPSHOT_MAX_PERSISTED_RUNS: "40",
      BELLDANDY_CARRYOVER_CONTEXT_ENABLED: "false",
    },
  });
  const lowRiskWithCarryover = await runScenario({
    stateDirPrefix: "belldandy-long-session-low-risk-carryover-",
    promptMarker: "PROMPT_LONG_SESSION_LOW_RISK_CARRYOVER",
    conversationId: "conv-long-session-low-risk-carryover",
    extraEnv: {
      BELLDANDY_MAX_HISTORY: "60",
      BELLDANDY_COMPACTION_KEEP_RECENT: "40",
      BELLDANDY_TOOL_RESULT_TRANSCRIPT_CHAR_LIMIT: "24000",
      BELLDANDY_PROMPT_SNAPSHOT_MAX_RUNS: "96",
      BELLDANDY_PROMPT_SNAPSHOT_MAX_PERSISTED_RUNS: "40",
      BELLDANDY_CARRYOVER_CONTEXT_ENABLED: "true",
    },
  });

  expect(baseline.initialMissingFacts).toEqual([
    FACT_ROLLOUT_DECISION,
    FACT_STOP_POINT,
  ]);
  expect(lowRiskOnly.initialMissingFacts).toEqual([
    FACT_NORMALIZE_OLD_FACTS,
  ]);
  expect(lowRiskWithCarryover.initialMissingFacts).toEqual([]);

  expect(baseline.finalTurnToolCalls).toBeLessThanOrEqual(1);
  expect(lowRiskOnly.finalTurnToolCalls).toBeLessThanOrEqual(1);
  expect(lowRiskWithCarryover.finalTurnToolCalls).toBe(0);

  expect(baseline.finalText).toBe(canonicalFinalText);
  expect(lowRiskOnly.finalText).toBe(canonicalFinalText);
  expect(lowRiskWithCarryover.finalText).toBe(canonicalFinalText);
  expect(new Set([
    baseline.finalText,
    lowRiskOnly.finalText,
    lowRiskWithCarryover.finalText,
  ]).size).toBe(1);

  expect(baseline.initialFinalCarryoverBlock).toContain("file_read: src/runtime/carryover.ts");
  expect(baseline.initialFinalCarryoverBlock).toContain(FACT_NORMALIZE_OLD_FACTS);
  expect(baseline.initialFinalCarryoverBlock).toContain("log_search: spawn-EPERM");
  expect(baseline.initialFinalCarryoverBlock).toContain(FACT_ROOT_CAUSE);

  expect(lowRiskOnly.initialFinalPromptText).not.toContain("<carryover-context");
  expect(lowRiskOnly.initialFinalPromptText).toContain(FACT_ROLLOUT_DECISION);
  expect(lowRiskOnly.initialFinalPromptText).toContain(FACT_STOP_POINT);
  expect(lowRiskOnly.initialFinalPromptText).toContain(FACT_ROOT_CAUSE);
  expect(lowRiskOnly.initialFinalPromptText).not.toContain(FACT_NORMALIZE_OLD_FACTS);

  expect(lowRiskWithCarryover.initialFinalCarryoverBlock).toContain("file_read: src/runtime/carryover.ts");
  expect(lowRiskWithCarryover.initialFinalCarryoverBlock).toContain(FACT_NORMALIZE_OLD_FACTS);
  expect(lowRiskWithCarryover.initialFinalPromptText).toContain(FACT_ROLLOUT_DECISION);
  expect(lowRiskWithCarryover.initialFinalPromptText).toContain(FACT_STOP_POINT);

  expect(Number(baseline.meta?.carryoverContextEstimate?.itemCount ?? 0)).toBeGreaterThan(0);
  expect(Number(lowRiskOnly.meta?.carryoverContextEstimate?.itemCount ?? 0)).toBe(0);
  expect(Number(lowRiskWithCarryover.meta?.carryoverContextEstimate?.itemCount ?? 0)).toBeGreaterThan(0);
}, 180000);

test("gateway debug-session experience A/B keeps run_command failure facts and log_read hints without reruns when low-risk history and carryover are combined", async () => {
  const FACT_DECISION = "decision=prefer-log-read-before-rerun";
  const FACT_FAILURE_SIGNATURE = "failureSignature=spawn-EPERM-while-launching-pnpm-test";
  const FACT_LOG_HINT = "logHint=close-inherited-handles-before-spawning-vitest-child";
  const EXPECTED_FACTS = [
    FACT_DECISION,
    FACT_FAILURE_SIGNATURE,
    FACT_LOG_HINT,
  ];
  const canonicalFinalText = [
    "稳定结论：",
    FACT_DECISION,
    FACT_FAILURE_SIGNATURE,
    FACT_LOG_HINT,
  ].join("\n");
  const fillerTurns = Array.from({ length: 8 }, (_, index) =>
    `第${index + 1}轮继续推进错误排查续做，保留占位 MARKER_DEBUG_${String(index + 1).padStart(2, "0")}。`);

  async function runScenario(input: {
    stateDirPrefix: string;
    promptMarker: string;
    conversationId: string;
    extraEnv?: Record<string, string>;
  }) {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), input.stateDirPrefix));
    const logDate = new Date().toISOString().slice(0, 10);
    const failingCommand = `node -e "console.error('${FACT_FAILURE_SIGNATURE}'); process.exit(1)"`;
    const scenarioState = {
      finalTurnToolCalls: 0,
    };
    const fakeOpenAI = await startFakeOpenAIServer({
      handler: ({ body, requests }) => {
        const promptText = extractFakeOpenAIRequestText(body);
        const latestUserRequest = extractTaggedPromptInnerText(promptText, "latest-user-request");
        const missingFacts = EXPECTED_FACTS.filter((fact) => !promptText.includes(fact));

        switch (requests.length) {
          case 1:
            return createFakeChatCompletionResponse({
              content: "",
              toolCalls: [{
                id: "debug-run-command-1",
                name: "run_command",
                arguments: JSON.stringify({ command: failingCommand }),
              }],
            });
          case 2:
            return createFakeChatCompletionResponse({
              content: "命令失败了，我先改用日志排查。",
            });
          case 3:
            return createFakeChatCompletionResponse({
              content: "",
              toolCalls: [{
                id: "debug-log-read-1",
                name: "log_read",
                arguments: JSON.stringify({ date: logDate, keyword: "EPERM" }),
              }],
            });
          case 4:
            return createFakeChatCompletionResponse({
              content: "日志已读取，我继续整理结论。",
            });
          case 5:
            return createFakeChatCompletionResponse({
              content: `收到，${FACT_DECISION}。`,
            });
          default:
            if (latestUserRequest.includes("不要重跑命令，直接给完整结论")) {
              if (missingFacts.length === 0) {
                return createFakeChatCompletionResponse({
                  content: canonicalFinalText,
                });
              }
              if (scenarioState.finalTurnToolCalls > 0) {
                return createFakeChatCompletionResponse({
                  content: canonicalFinalText,
                });
              }
              scenarioState.finalTurnToolCalls += 1;
              if (missingFacts.includes(FACT_DECISION)) {
                return createFakeChatCompletionResponse({
                  content: "",
                  toolCalls: [{
                    id: `debug-final-conversation-${scenarioState.finalTurnToolCalls}`,
                    name: "conversation_read",
                    arguments: JSON.stringify({ conversation_id: input.conversationId, view: "restore", limit: 20 }),
                  }],
                });
              }
              if (missingFacts.includes(FACT_FAILURE_SIGNATURE) || missingFacts.includes(FACT_LOG_HINT)) {
                return createFakeChatCompletionResponse({
                  content: "",
                  toolCalls: [{
                    id: `debug-final-log-${scenarioState.finalTurnToolCalls}`,
                    name: "log_read",
                    arguments: JSON.stringify({ date: logDate, keyword: "EPERM" }),
                  }],
                });
              }
              return createFakeChatCompletionResponse({
                content: canonicalFinalText,
              });
            }
            return createFakeChatCompletionResponse({
              content: `ack-debug-turn-${requests.length}`,
            });
        }
      },
    });
    let gateway: GatewayProcessHandle | undefined;
    let wsHandle: GatewayWebSocketHandle | undefined;

    try {
      await fs.mkdir(path.join(stateDir, "logs"), { recursive: true });
      await fs.writeFile(
        path.join(stateDir, "logs", `${logDate}.log`),
        [
          `[ERROR][gateway] ${FACT_FAILURE_SIGNATURE}; ${FACT_LOG_HINT}`,
          "[INFO][gateway] startup ok",
          "",
        ].join("\n"),
        "utf-8",
      );

      gateway = await startGatewayProcess({
        stateDir,
        openaiBaseUrl: `${fakeOpenAI.baseUrl}/v1`,
        promptMarker: input.promptMarker,
        extraEnv: {
          BELLDANDY_TOOLS_ENABLED: "true",
          BELLDANDY_DANGEROUS_TOOLS_ENABLED: "true",
          BELLDANDY_CONTEXT_INJECTION: "true",
          BELLDANDY_AUTO_RECALL_ENABLED: "false",
          BELLDANDY_CONTEXT_INJECTION_INCLUDE_SESSION: "false",
          BELLDANDY_TASK_MEMORY_ENABLED: "false",
          BELLDANDY_MEMORY_SESSION_DIGEST_MAX_RUNS: "0",
          ...(input.extraEnv ?? {}),
        },
      });
      wsHandle = await connectGatewayWebSocket(gateway.port);

      const sendMessage = async (
        requestId: string,
        text: string,
        timeoutMs = 5000,
      ): Promise<{ runId: string; finalText: string }> => {
        const finalCountBefore = wsHandle!.frames.filter((frame) =>
          frame.type === "event"
          && frame.event === "chat.final"
          && frame.payload?.conversationId === input.conversationId
        ).length;
        wsHandle!.ws.send(JSON.stringify({
          type: "req",
          id: requestId,
          method: "message.send",
          params: {
            conversationId: input.conversationId,
            text,
          },
        }));
        await waitFor(
          () => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === requestId && frame.ok === true),
          timeoutMs,
        );
        await waitFor(() =>
          wsHandle!.frames.filter((frame) =>
            frame.type === "event"
            && frame.event === "chat.final"
            && frame.payload?.conversationId === input.conversationId
          ).length > finalCountBefore,
          timeoutMs,
        );
        const sendRes = wsHandle!.frames.find((frame) => frame.type === "res" && frame.id === requestId && frame.ok === true);
        const runId = typeof sendRes?.payload?.runId === "string" ? sendRes.payload.runId : "";
        const finalFrame = wsHandle!.frames
          .filter((frame) =>
            frame.type === "event"
            && frame.event === "chat.final"
            && frame.payload?.conversationId === input.conversationId)
          .at(-1);
        const finalText = String(finalFrame?.payload?.text ?? "");
        expect(runId).toBeTruthy();
        expect(finalText).toBeTruthy();
        return { runId, finalText };
      };

      const readMeta = async (requestId: string) => {
        wsHandle!.ws.send(JSON.stringify({
          type: "req",
          id: requestId,
          method: "conversation.meta",
          params: {
            conversationId: input.conversationId,
          },
        }));
        await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === requestId && frame.ok === true));
        return wsHandle!.frames.find((frame) => frame.type === "res" && frame.id === requestId)?.payload;
      };

      const sendBeforePairingReqId = `${input.conversationId}-before-pairing`;
      wsHandle.ws.send(JSON.stringify({
        type: "req",
        id: sendBeforePairingReqId,
        method: "message.send",
        params: {
          conversationId: input.conversationId,
          text: "pairing bootstrap",
        },
      }));
      await approveLatestPairingCode(wsHandle.frames, stateDir);

      await sendMessage(`${input.conversationId}-source-run-command`, "先跑一次 pnpm test，确认失败信号。", 15000);
      await sendMessage(`${input.conversationId}-source-log-read`, "再直接读取当天日志，确认错误提示。");
      await sendMessage(`${input.conversationId}-decision`, `再记住这个决策：${FACT_DECISION}。`);

      for (let index = 0; index < fillerTurns.length; index += 1) {
        await sendMessage(`${input.conversationId}-filler-${index + 1}`, fillerTurns[index]);
      }

      const preFinalRequestCount = fakeOpenAI.requests.length;
      const finalResult = await sendMessage(
        `${input.conversationId}-final`,
        "不要重跑命令，直接给完整结论：需要包含 decision、failureSignature、logHint。",
        15000,
      );
      const initialFinalPromptText = fakeOpenAI.requestTexts[preFinalRequestCount] ?? "";
      const initialMissingFacts = EXPECTED_FACTS.filter((fact) => !initialFinalPromptText.includes(fact));
      const meta = await readMeta(`${input.conversationId}-meta-final`);

      return {
        initialFinalPromptText,
        initialFinalCarryoverBlock: extractTaggedPromptBlock(initialFinalPromptText, "carryover-context"),
        initialMissingFacts,
        finalTurnToolCalls: scenarioState.finalTurnToolCalls,
        finalText: finalResult.finalText,
        meta,
      };
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
  }

  const baseline = await runScenario({
    stateDirPrefix: "belldandy-debug-session-baseline-",
    promptMarker: "PROMPT_DEBUG_SESSION_BASELINE",
    conversationId: "conv-debug-session-baseline",
    extraEnv: {
      BELLDANDY_CARRYOVER_CONTEXT_ENABLED: "true",
    },
  });
  const lowRiskOnly = await runScenario({
    stateDirPrefix: "belldandy-debug-session-low-risk-only-",
    promptMarker: "PROMPT_DEBUG_SESSION_LOW_RISK_ONLY",
    conversationId: "conv-debug-session-low-risk-only",
    extraEnv: {
      BELLDANDY_MAX_HISTORY: "60",
      BELLDANDY_COMPACTION_KEEP_RECENT: "40",
      BELLDANDY_TOOL_RESULT_TRANSCRIPT_CHAR_LIMIT: "24000",
      BELLDANDY_PROMPT_SNAPSHOT_MAX_RUNS: "96",
      BELLDANDY_PROMPT_SNAPSHOT_MAX_PERSISTED_RUNS: "40",
      BELLDANDY_CARRYOVER_CONTEXT_ENABLED: "false",
    },
  });
  const lowRiskWithCarryover = await runScenario({
    stateDirPrefix: "belldandy-debug-session-low-risk-carryover-",
    promptMarker: "PROMPT_DEBUG_SESSION_LOW_RISK_CARRYOVER",
    conversationId: "conv-debug-session-low-risk-carryover",
    extraEnv: {
      BELLDANDY_MAX_HISTORY: "60",
      BELLDANDY_COMPACTION_KEEP_RECENT: "40",
      BELLDANDY_TOOL_RESULT_TRANSCRIPT_CHAR_LIMIT: "24000",
      BELLDANDY_PROMPT_SNAPSHOT_MAX_RUNS: "96",
      BELLDANDY_PROMPT_SNAPSHOT_MAX_PERSISTED_RUNS: "40",
      BELLDANDY_CARRYOVER_CONTEXT_ENABLED: "true",
    },
  });

  expect(baseline.initialMissingFacts).toEqual([
    FACT_DECISION,
  ]);
  expect(lowRiskOnly.initialMissingFacts).toEqual([
    FACT_FAILURE_SIGNATURE,
    FACT_LOG_HINT,
  ]);
  expect(lowRiskWithCarryover.initialMissingFacts).toEqual([]);

  expect(baseline.finalTurnToolCalls).toBe(1);
  expect(lowRiskOnly.finalTurnToolCalls).toBe(1);
  expect(lowRiskWithCarryover.finalTurnToolCalls).toBe(0);

  expect(baseline.finalText).toBe(canonicalFinalText);
  expect(lowRiskOnly.finalText).toBe(canonicalFinalText);
  expect(lowRiskWithCarryover.finalText).toBe(canonicalFinalText);
  expect(new Set([
    baseline.finalText,
    lowRiskOnly.finalText,
    lowRiskWithCarryover.finalText,
  ]).size).toBe(1);

  expect(baseline.initialFinalCarryoverBlock).toContain("run_command: node -e");
  expect(baseline.initialFinalCarryoverBlock).toContain(FACT_FAILURE_SIGNATURE);
  expect(baseline.initialFinalCarryoverBlock).toContain("log_read:");
  expect(baseline.initialFinalCarryoverBlock).toContain(FACT_LOG_HINT);
  expect(baseline.initialFinalPromptText).not.toContain(FACT_DECISION);
  expect(baseline.initialFinalPromptText).toContain(FACT_LOG_HINT);

  expect(lowRiskOnly.initialFinalPromptText).not.toContain("<carryover-context");
  expect(lowRiskOnly.initialFinalPromptText).toContain(FACT_DECISION);
  expect(lowRiskOnly.initialFinalPromptText).not.toContain(FACT_FAILURE_SIGNATURE);
  expect(lowRiskOnly.initialFinalPromptText).not.toContain(FACT_LOG_HINT);

  expect(lowRiskWithCarryover.initialFinalCarryoverBlock).toContain("run_command: node -e");
  expect(lowRiskWithCarryover.initialFinalCarryoverBlock).toContain(FACT_FAILURE_SIGNATURE);
  expect(lowRiskWithCarryover.initialFinalCarryoverBlock).toContain("log_read:");
  expect(lowRiskWithCarryover.initialFinalCarryoverBlock).toContain(FACT_LOG_HINT);
  expect(lowRiskWithCarryover.initialFinalPromptText).toContain(FACT_DECISION);
  expect(lowRiskWithCarryover.initialFinalPromptText).toContain(FACT_FAILURE_SIGNATURE);
  expect(lowRiskWithCarryover.initialFinalPromptText).toContain(FACT_LOG_HINT);

  expect(Number(baseline.meta?.carryoverContextEstimate?.itemCount ?? 0)).toBeGreaterThan(0);
  expect(Number(lowRiskOnly.meta?.carryoverContextEstimate?.itemCount ?? 0)).toBe(0);
  expect(Number(lowRiskWithCarryover.meta?.carryoverContextEstimate?.itemCount ?? 0)).toBeGreaterThan(0);
}, 180000);

test("gateway browser_get_content experience A/B keeps article facts and avoids rereads when low-risk history and carryover are combined", async () => {
  const FACT_BROWSER_DECISION = "browserDecision=prefer-carryover-page-facts";
  const FACT_BROWSER_ROOT_CAUSE = "browserRootCause=fixture-article-shows-context-drift";
  const FACT_BROWSER_STOP_POINT = "browserStopPoint=verify-browser-content-ab-metrics";
  const FACT_BROWSER_TITLE = "Fixture Browser Carryover Article";
  const EXPECTED_FACTS = [
    FACT_BROWSER_DECISION,
    FACT_BROWSER_ROOT_CAUSE,
    FACT_BROWSER_STOP_POINT,
  ];
  const canonicalFinalText = [
    "稳定结论：",
    FACT_BROWSER_DECISION,
    FACT_BROWSER_ROOT_CAUSE,
    FACT_BROWSER_STOP_POINT,
  ].join("\n");
  const fillerTurns = Array.from({ length: 8 }, (_, index) =>
    `第${index + 1}轮继续推进 browser 正文续做验证，保留占位 MARKER_BROWSER_${String(index + 1).padStart(2, "0")}。`);

  async function runScenario(input: {
    stateDirPrefix: string;
    promptMarker: string;
    conversationId: string;
    extraEnv?: Record<string, string>;
  }) {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), input.stateDirPrefix));
    const fixturePageUrl = "https://example.com/context/browser-carryover-article";
    const fixturePageBodyText = [
      FACT_BROWSER_ROOT_CAUSE,
      FACT_BROWSER_STOP_POINT,
      "这篇正文用于验证 browser_get_content 的体验级 carryover 恢复效果。",
      "如果续做阶段还能直接恢复这些正文事实，就说明正文类来源的漂移已经受控。",
      "额外补足一些正文长度，确保 waitForFunction 的正文长度阈值被满足。".repeat(8),
    ].join(" ");
    const fixturePageHtml = [
      "<html><head><title>",
      FACT_BROWSER_TITLE,
      "</title></head><body><article>",
      `<h1>${FACT_BROWSER_TITLE}</h1>`,
      `<p>${FACT_BROWSER_ROOT_CAUSE}</p>`,
      `<p>${FACT_BROWSER_STOP_POINT}</p>`,
      "<p>这篇正文用于验证 browser_get_content 的体验级 carryover 恢复效果。</p>",
      "<p>如果续做阶段还能直接恢复这些正文事实，就说明正文类来源的漂移已经受控。</p>",
      `<p>${"额外补足一些正文长度，确保 waitForFunction 的正文长度阈值被满足。".repeat(8)}</p>`,
      "</article></body></html>",
    ].join("");
    const preload = await createBrowserGetContentFixturePreload({
      stateDir,
      pageUrl: fixturePageUrl,
      pageTitle: FACT_BROWSER_TITLE,
      bodyText: fixturePageBodyText,
      html: fixturePageHtml,
    });
    const scenarioState = {
      finalTurnToolCalls: 0,
    };
    const fakeOpenAI = await startFakeOpenAIServer({
      handler: ({ body, requests }) => {
        const promptText = extractFakeOpenAIRequestText(body);
        const latestUserRequest = extractTaggedPromptInnerText(promptText, "latest-user-request");
        const missingFacts = EXPECTED_FACTS.filter((fact) => !promptText.includes(fact));

        switch (requests.length) {
          case 1:
            return createFakeChatCompletionResponse({
              content: "",
              toolCalls: [{
                id: "browser-content-1",
                name: "browser_get_content",
                arguments: JSON.stringify({ format: "markdown" }),
              }],
            });
          case 2:
            return createFakeChatCompletionResponse({
              content: `已确认正文来源 ${FACT_BROWSER_ROOT_CAUSE}；我继续核对续做停点。`,
            });
          case 3:
            return createFakeChatCompletionResponse({
              content: "",
              toolCalls: [{
                id: "browser-conversation-1",
                name: "conversation_read",
                arguments: JSON.stringify({ conversation_id: input.conversationId, view: "restore", limit: 20 }),
              }],
            });
          case 4:
            return createFakeChatCompletionResponse({
              content: `从 restore 看，${FACT_BROWSER_STOP_POINT}。`,
            });
          case 5:
            return createFakeChatCompletionResponse({
              content: `收到，${FACT_BROWSER_DECISION}。`,
            });
          default:
            if (latestUserRequest.includes("不要重复读取页面，直接给完整结论")) {
              if (missingFacts.length === 0) {
                return createFakeChatCompletionResponse({
                  content: canonicalFinalText,
                });
              }
              if (scenarioState.finalTurnToolCalls > 0) {
                return createFakeChatCompletionResponse({
                  content: canonicalFinalText,
                });
              }
              scenarioState.finalTurnToolCalls += 1;
              if (missingFacts.includes(FACT_BROWSER_DECISION) || missingFacts.includes(FACT_BROWSER_STOP_POINT)) {
                return createFakeChatCompletionResponse({
                  content: "",
                  toolCalls: [{
                    id: `browser-final-conversation-${scenarioState.finalTurnToolCalls}`,
                    name: "conversation_read",
                    arguments: JSON.stringify({ conversation_id: input.conversationId, view: "restore", limit: 20 }),
                  }],
                });
              }
              if (missingFacts.includes(FACT_BROWSER_ROOT_CAUSE)) {
                return createFakeChatCompletionResponse({
                  content: "",
                  toolCalls: [{
                    id: `browser-final-content-${scenarioState.finalTurnToolCalls}`,
                    name: "browser_get_content",
                    arguments: JSON.stringify({ format: "markdown" }),
                  }],
                });
              }
              return createFakeChatCompletionResponse({
                content: canonicalFinalText,
              });
            }
            return createFakeChatCompletionResponse({
              content: `ack-browser-turn-${requests.length}`,
            });
        }
      },
    });
    let gateway: GatewayProcessHandle | undefined;
    let wsHandle: GatewayWebSocketHandle | undefined;

    try {
      gateway = await startGatewayProcess({
        stateDir,
        openaiBaseUrl: `${fakeOpenAI.baseUrl}/v1`,
        promptMarker: input.promptMarker,
        extraEnv: {
          BELLDANDY_TOOLS_ENABLED: "true",
          BELLDANDY_BROWSER_RELAY_ENABLED: "false",
          BELLDANDY_CONTEXT_INJECTION: "true",
          BELLDANDY_AUTO_RECALL_ENABLED: "false",
          BELLDANDY_CONTEXT_INJECTION_INCLUDE_SESSION: "false",
          BELLDANDY_TASK_MEMORY_ENABLED: "false",
          BELLDANDY_MEMORY_SESSION_DIGEST_MAX_RUNS: "0",
          ...(input.extraEnv ?? {}),
        },
        extraImports: [preload.importSpecifier],
      });
      wsHandle = await connectGatewayWebSocket(gateway.port, {
        role: "node",
        clientId: `bdd-node-browser-${input.conversationId}`,
      });

      const sendMessage = async (
        requestId: string,
        text: string,
        timeoutMs = 5000,
      ): Promise<{ runId: string; finalText: string }> => {
        const finalCountBefore = wsHandle!.frames.filter((frame) =>
          frame.type === "event"
          && frame.event === "chat.final"
          && frame.payload?.conversationId === input.conversationId
        ).length;
        wsHandle!.ws.send(JSON.stringify({
          type: "req",
          id: requestId,
          method: "message.send",
          params: {
            conversationId: input.conversationId,
            text,
          },
        }));
        await waitFor(
          () => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === requestId && frame.ok === true),
          timeoutMs,
        );
        await waitFor(() =>
          wsHandle!.frames.filter((frame) =>
            frame.type === "event"
            && frame.event === "chat.final"
            && frame.payload?.conversationId === input.conversationId
          ).length > finalCountBefore,
          timeoutMs,
        );
        const sendRes = wsHandle!.frames.find((frame) => frame.type === "res" && frame.id === requestId && frame.ok === true);
        const runId = typeof sendRes?.payload?.runId === "string" ? sendRes.payload.runId : "";
        const finalFrame = wsHandle!.frames
          .filter((frame) =>
            frame.type === "event"
            && frame.event === "chat.final"
            && frame.payload?.conversationId === input.conversationId)
          .at(-1);
        const finalText = String(finalFrame?.payload?.text ?? "");
        expect(runId).toBeTruthy();
        expect(finalText).toBeTruthy();
        return { runId, finalText };
      };

      const readMeta = async (requestId: string) => {
        wsHandle!.ws.send(JSON.stringify({
          type: "req",
          id: requestId,
          method: "conversation.meta",
          params: {
            conversationId: input.conversationId,
          },
        }));
        await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === requestId && frame.ok === true));
        return wsHandle!.frames.find((frame) => frame.type === "res" && frame.id === requestId)?.payload;
      };

      const sendBeforePairingReqId = `${input.conversationId}-before-pairing`;
      wsHandle.ws.send(JSON.stringify({
        type: "req",
        id: sendBeforePairingReqId,
        method: "message.send",
        params: {
          conversationId: input.conversationId,
          text: "pairing bootstrap",
        },
      }));
      await approveLatestPairingCode(wsHandle.frames, stateDir);
      const toolsVisibilityRes = await (async () => {
        const requestId = `${input.conversationId}-tools-list`;
        wsHandle!.ws.send(JSON.stringify({
          type: "req",
          id: requestId,
          method: "tools.list",
          params: {
            conversationId: input.conversationId,
          },
        }));
        await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === requestId && frame.ok === true));
        return wsHandle!.frames.find((frame) => frame.type === "res" && frame.id === requestId)?.payload;
      })();

      await sendMessage(`${input.conversationId}-source-browser`, "先读取当前页面正文，并记住关键事实。", 15000);
      await sendMessage(`${input.conversationId}-source-conversation`, "再读取当前会话 restore 视图，确认停点。");
      await sendMessage(`${input.conversationId}-decision`, `再记住这个决策：${FACT_BROWSER_DECISION}。`);

      for (let index = 0; index < fillerTurns.length; index += 1) {
        await sendMessage(`${input.conversationId}-filler-${index + 1}`, fillerTurns[index]);
      }

      const preFinalRequestCount = fakeOpenAI.requests.length;
      const finalResult = await sendMessage(
        `${input.conversationId}-final`,
        "不要重复读取页面，直接给完整结论：需要包含 browserDecision、browserRootCause、browserStopPoint。",
        15000,
      );
      const initialFinalPromptText = fakeOpenAI.requestTexts[preFinalRequestCount] ?? "";
      const initialMissingFacts = EXPECTED_FACTS.filter((fact) => !initialFinalPromptText.includes(fact));
      const meta = await readMeta(`${input.conversationId}-meta-final`);

      return {
        initialFinalPromptText,
        initialFinalCarryoverBlock: extractTaggedPromptBlock(initialFinalPromptText, "carryover-context"),
        initialMissingFacts,
        finalTurnToolCalls: scenarioState.finalTurnToolCalls,
        finalText: finalResult.finalText,
        meta,
        toolsVisibility: toolsVisibilityRes?.visibility?.browser_get_content,
      };
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
  }

  const baseline = await runScenario({
    stateDirPrefix: "belldandy-browser-session-baseline-",
    promptMarker: "PROMPT_BROWSER_SESSION_BASELINE",
    conversationId: "conv-browser-session-baseline",
    extraEnv: {
      BELLDANDY_CARRYOVER_CONTEXT_ENABLED: "true",
    },
  });
  const lowRiskOnly = await runScenario({
    stateDirPrefix: "belldandy-browser-session-low-risk-only-",
    promptMarker: "PROMPT_BROWSER_SESSION_LOW_RISK_ONLY",
    conversationId: "conv-browser-session-low-risk-only",
    extraEnv: {
      BELLDANDY_MAX_HISTORY: "60",
      BELLDANDY_COMPACTION_KEEP_RECENT: "40",
      BELLDANDY_TOOL_RESULT_TRANSCRIPT_CHAR_LIMIT: "24000",
      BELLDANDY_PROMPT_SNAPSHOT_MAX_RUNS: "96",
      BELLDANDY_PROMPT_SNAPSHOT_MAX_PERSISTED_RUNS: "40",
      BELLDANDY_CARRYOVER_CONTEXT_ENABLED: "false",
    },
  });
  const lowRiskWithCarryover = await runScenario({
    stateDirPrefix: "belldandy-browser-session-low-risk-carryover-",
    promptMarker: "PROMPT_BROWSER_SESSION_LOW_RISK_CARRYOVER",
    conversationId: "conv-browser-session-low-risk-carryover",
    extraEnv: {
      BELLDANDY_MAX_HISTORY: "60",
      BELLDANDY_COMPACTION_KEEP_RECENT: "40",
      BELLDANDY_TOOL_RESULT_TRANSCRIPT_CHAR_LIMIT: "24000",
      BELLDANDY_PROMPT_SNAPSHOT_MAX_RUNS: "96",
      BELLDANDY_PROMPT_SNAPSHOT_MAX_PERSISTED_RUNS: "40",
      BELLDANDY_CARRYOVER_CONTEXT_ENABLED: "true",
    },
  });

  expect(baseline.initialMissingFacts).toEqual([
    FACT_BROWSER_DECISION,
  ]);
  expect(lowRiskOnly.initialMissingFacts).toEqual([]);
  expect(lowRiskWithCarryover.initialMissingFacts).toEqual([]);

  expect(baseline.finalTurnToolCalls).toBe(1);
  expect(lowRiskOnly.finalTurnToolCalls).toBe(0);
  expect(lowRiskWithCarryover.finalTurnToolCalls).toBe(0);

  expect(baseline.finalText).toBe(canonicalFinalText);
  expect(lowRiskOnly.finalText).toBe(canonicalFinalText);
  expect(lowRiskWithCarryover.finalText).toBe(canonicalFinalText);
  expect(new Set([
    baseline.finalText,
    lowRiskOnly.finalText,
    lowRiskWithCarryover.finalText,
  ]).size).toBe(1);

  expect(baseline.initialFinalCarryoverBlock).toContain("browser_get_content: https://example.com/context/browser-carryover-article");
  expect(baseline.initialFinalCarryoverBlock).toContain(FACT_BROWSER_ROOT_CAUSE);
  expect(baseline.initialFinalCarryoverBlock).toContain(FACT_BROWSER_STOP_POINT);
  expect(baseline.initialFinalPromptText).not.toContain(FACT_BROWSER_DECISION);
  expect(baseline.initialFinalPromptText).toContain(FACT_BROWSER_ROOT_CAUSE);
  expect(baseline.initialFinalPromptText).toContain(FACT_BROWSER_STOP_POINT);

  expect(lowRiskOnly.initialFinalPromptText).not.toContain("<carryover-context");
  expect(lowRiskOnly.initialFinalPromptText).toContain(FACT_BROWSER_DECISION);
  expect(lowRiskOnly.initialFinalPromptText).toContain(FACT_BROWSER_ROOT_CAUSE);
  expect(lowRiskOnly.initialFinalPromptText).toContain(FACT_BROWSER_STOP_POINT);

  expect(lowRiskWithCarryover.initialFinalCarryoverBlock).toContain("browser_get_content: https://example.com/context/browser-carryover-article");
  expect(lowRiskWithCarryover.initialFinalCarryoverBlock).toContain(FACT_BROWSER_ROOT_CAUSE);
  expect(lowRiskWithCarryover.initialFinalCarryoverBlock).toContain(FACT_BROWSER_STOP_POINT);
  expect(lowRiskWithCarryover.initialFinalPromptText).toContain(FACT_BROWSER_DECISION);
  expect(lowRiskWithCarryover.initialFinalPromptText).toContain(FACT_BROWSER_ROOT_CAUSE);
  expect(lowRiskWithCarryover.initialFinalPromptText).toContain(FACT_BROWSER_STOP_POINT);

  expect(Number(baseline.meta?.carryoverContextEstimate?.itemCount ?? 0)).toBeGreaterThan(0);
  expect(Number(lowRiskOnly.meta?.carryoverContextEstimate?.itemCount ?? 0)).toBe(0);
  expect(Number(lowRiskWithCarryover.meta?.carryoverContextEstimate?.itemCount ?? 0)).toBeGreaterThan(0);
}, 180000);

test("gateway browser_get_content carryover keeps pageUrl-scoped facts separated across page switches", async () => {
  const PAGE_A_URL = "https://example.com/context/browser-carryover-page-a";
  const PAGE_B_URL = "https://example.com/context/browser-carryover-page-b";
  const FACT_PAGE_A_ROOT_CAUSE = "browserPageARootCause=page-a-documents-old-render-path";
  const FACT_PAGE_A_STOP_POINT = "browserPageAStopPoint=archive-page-a-context-only";
  const FACT_PAGE_B_DECISION = "browserPageBDecision=prefer-page-b-current-source";
  const FACT_PAGE_B_ROOT_CAUSE = "browserPageBRootCause=page-b-confirms-source-key-isolation";
  const FACT_PAGE_B_STOP_POINT = "browserPageBStopPoint=ship-page-url-stable-carryover";
  const EXPECTED_PAGE_B_FACTS = [
    FACT_PAGE_B_DECISION,
    FACT_PAGE_B_ROOT_CAUSE,
    FACT_PAGE_B_STOP_POINT,
  ];
  const canonicalFinalText = [
    "第二页稳定结论：",
    FACT_PAGE_B_DECISION,
    FACT_PAGE_B_ROOT_CAUSE,
    FACT_PAGE_B_STOP_POINT,
  ].join("\n");
  const fillerTurns = Array.from({ length: 8 }, (_, index) =>
    `第${index + 1}轮继续推进跨页面 carryover 验证，保留占位 MARKER_BROWSER_MULTI_${String(index + 1).padStart(2, "0")}。`);
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-browser-multi-page-carryover-"));
  const conversationId = "conv-browser-multi-page-carryover";
  const preload = await createSequentialBrowserGetContentFixturePreload({
    stateDir,
    pages: [
      {
        pageUrl: PAGE_A_URL,
        pageTitle: "Fixture Browser Carryover Page A",
        bodyText: [
          FACT_PAGE_A_ROOT_CAUSE,
          FACT_PAGE_A_STOP_POINT,
          "第一页正文专门用于验证它不会在跨页面续做时覆盖第二页事实。",
          "额外补足一些正文长度，确保 waitForFunction 的正文长度阈值被满足。".repeat(8),
        ].join(" "),
        html: [
          "<html><head><title>Fixture Browser Carryover Page A</title></head><body><article>",
          "<h1>Fixture Browser Carryover Page A</h1>",
          `<p>${FACT_PAGE_A_ROOT_CAUSE}</p>`,
          `<p>${FACT_PAGE_A_STOP_POINT}</p>`,
          "<p>第一页正文专门用于验证它不会在跨页面续做时覆盖第二页事实。</p>",
          `<p>${"额外补足一些正文长度，确保 waitForFunction 的正文长度阈值被满足。".repeat(8)}</p>`,
          "</article></body></html>",
        ].join(""),
      },
      {
        pageUrl: PAGE_B_URL,
        pageTitle: "Fixture Browser Carryover Page B",
        bodyText: [
          FACT_PAGE_B_ROOT_CAUSE,
          FACT_PAGE_B_STOP_POINT,
          "第二页正文用于确认 pageUrl 稳定来源键能把当前页面事实单独保留下来。",
          "额外补足一些正文长度，确保 waitForFunction 的正文长度阈值被满足。".repeat(8),
        ].join(" "),
        html: [
          "<html><head><title>Fixture Browser Carryover Page B</title></head><body><article>",
          "<h1>Fixture Browser Carryover Page B</h1>",
          `<p>${FACT_PAGE_B_ROOT_CAUSE}</p>`,
          `<p>${FACT_PAGE_B_STOP_POINT}</p>`,
          "<p>第二页正文用于确认 pageUrl 稳定来源键能把当前页面事实单独保留下来。</p>",
          `<p>${"额外补足一些正文长度，确保 waitForFunction 的正文长度阈值被满足。".repeat(8)}</p>`,
          "</article></body></html>",
        ].join(""),
      },
    ],
  });
  const fakeOpenAI = await startFakeOpenAIServer({
    handler: ({ body, requests }) => {
      const promptText = extractFakeOpenAIRequestText(body);
      const latestUserRequest = extractTaggedPromptInnerText(promptText, "latest-user-request");
      const missingFacts = EXPECTED_PAGE_B_FACTS.filter((fact) => !promptText.includes(fact));

      switch (requests.length) {
        case 1:
          return createFakeChatCompletionResponse({
            content: "",
            toolCalls: [{
              id: "browser-page-a",
              name: "browser_get_content",
              arguments: JSON.stringify({ format: "markdown" }),
            }],
          });
        case 2:
          return createFakeChatCompletionResponse({
            content: `已读取第一页：${FACT_PAGE_A_ROOT_CAUSE}，${FACT_PAGE_A_STOP_POINT}。`,
          });
        case 3:
          return createFakeChatCompletionResponse({
            content: "",
            toolCalls: [{
              id: "browser-page-b",
              name: "browser_get_content",
              arguments: JSON.stringify({ format: "markdown" }),
            }],
          });
        case 4:
          return createFakeChatCompletionResponse({
            content: `已读取第二页：${FACT_PAGE_B_ROOT_CAUSE}，${FACT_PAGE_B_STOP_POINT}。`,
          });
        case 5:
          return createFakeChatCompletionResponse({
            content: `收到，${FACT_PAGE_B_DECISION}。`,
          });
        default:
          if (latestUserRequest.includes("第二页稳定结论")) {
            return createFakeChatCompletionResponse({
              content: missingFacts.length === 0
                ? canonicalFinalText
                : `MISSING_PAGE_B_FACTS:${missingFacts.join(",")}`,
            });
          }
          return createFakeChatCompletionResponse({
            content: `ack-browser-multi-turn-${requests.length}`,
          });
      }
    },
  });
  let gateway: GatewayProcessHandle | undefined;
  let wsHandle: GatewayWebSocketHandle | undefined;

  try {
    gateway = await startGatewayProcess({
      stateDir,
      openaiBaseUrl: `${fakeOpenAI.baseUrl}/v1`,
      promptMarker: "PROMPT_BROWSER_MULTI_PAGE_CARRYOVER",
      extraEnv: {
        BELLDANDY_TOOLS_ENABLED: "true",
        BELLDANDY_BROWSER_RELAY_ENABLED: "false",
        BELLDANDY_CONTEXT_INJECTION: "true",
        BELLDANDY_AUTO_RECALL_ENABLED: "false",
        BELLDANDY_CONTEXT_INJECTION_INCLUDE_SESSION: "false",
        BELLDANDY_TASK_MEMORY_ENABLED: "false",
        BELLDANDY_MEMORY_SESSION_DIGEST_MAX_RUNS: "0",
        BELLDANDY_MAX_HISTORY: "60",
        BELLDANDY_COMPACTION_KEEP_RECENT: "40",
        BELLDANDY_TOOL_RESULT_TRANSCRIPT_CHAR_LIMIT: "24000",
        BELLDANDY_PROMPT_SNAPSHOT_MAX_RUNS: "96",
        BELLDANDY_PROMPT_SNAPSHOT_MAX_PERSISTED_RUNS: "40",
        BELLDANDY_CARRYOVER_CONTEXT_ENABLED: "true",
      },
      extraImports: [preload.importSpecifier],
    });
    wsHandle = await connectGatewayWebSocket(gateway.port, {
      role: "node",
      clientId: "bdd-node-browser-multi-page",
    });

    const sendMessage = async (
      requestId: string,
      text: string,
      timeoutMs = 5000,
    ): Promise<{ runId: string; finalText: string }> => {
      const finalCountBefore = wsHandle!.frames.filter((frame) =>
        frame.type === "event"
        && frame.event === "chat.final"
        && frame.payload?.conversationId === conversationId
      ).length;
      wsHandle!.ws.send(JSON.stringify({
        type: "req",
        id: requestId,
        method: "message.send",
        params: {
          conversationId,
          text,
        },
      }));
      await waitFor(
        () => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === requestId && frame.ok === true),
        timeoutMs,
      );
      await waitFor(() =>
        wsHandle!.frames.filter((frame) =>
          frame.type === "event"
          && frame.event === "chat.final"
          && frame.payload?.conversationId === conversationId
        ).length > finalCountBefore,
        timeoutMs,
      );
      const sendRes = wsHandle!.frames.find((frame) => frame.type === "res" && frame.id === requestId && frame.ok === true);
      const runId = typeof sendRes?.payload?.runId === "string" ? sendRes.payload.runId : "";
      const finalFrame = wsHandle!.frames
        .filter((frame) =>
          frame.type === "event"
          && frame.event === "chat.final"
          && frame.payload?.conversationId === conversationId)
        .at(-1);
      const finalText = String(finalFrame?.payload?.text ?? "");
      expect(runId).toBeTruthy();
      expect(finalText).toBeTruthy();
      return { runId, finalText };
    };

    const readMeta = async (requestId: string) => {
      wsHandle!.ws.send(JSON.stringify({
        type: "req",
        id: requestId,
        method: "conversation.meta",
        params: {
          conversationId,
        },
      }));
      await waitFor(() => wsHandle!.frames.some((frame) => frame.type === "res" && frame.id === requestId && frame.ok === true));
      return wsHandle!.frames.find((frame) => frame.type === "res" && frame.id === requestId)?.payload;
    };

    wsHandle.ws.send(JSON.stringify({
      type: "req",
      id: `${conversationId}-before-pairing`,
      method: "message.send",
      params: {
        conversationId,
        text: "pairing bootstrap",
      },
    }));
    await approveLatestPairingCode(wsHandle.frames, stateDir);

    await sendMessage(`${conversationId}-page-a`, "先读取第一页正文，并只记住第一页事实。", 15000);
    await sendMessage(`${conversationId}-page-b`, "现在切换到第二页，再读取当前页面正文，并记住第二页事实。", 15000);
    await sendMessage(`${conversationId}-decision`, `再记住这个当前页决策：${FACT_PAGE_B_DECISION}。`);

    for (let index = 0; index < fillerTurns.length; index += 1) {
      await sendMessage(`${conversationId}-filler-${index + 1}`, fillerTurns[index]);
    }

    const preFinalRequestCount = fakeOpenAI.requests.length;
    const finalResult = await sendMessage(
      `${conversationId}-final`,
      "不要重复读取页面，直接给第二页稳定结论：需要包含 browserPageBDecision、browserPageBRootCause、browserPageBStopPoint，且不要把第一页事实误当成第二页。",
      15000,
    );
    const initialFinalPromptText = fakeOpenAI.requestTexts[preFinalRequestCount] ?? "";
    const initialFinalCarryoverBlock = extractTaggedPromptBlock(initialFinalPromptText, "carryover-context");
    const pageALine = initialFinalCarryoverBlock
      .split("\n")
      .find((line) => line.includes(`browser_get_content: ${PAGE_A_URL}`)) ?? "";
    const pageBLine = initialFinalCarryoverBlock
      .split("\n")
      .find((line) => line.includes(`browser_get_content: ${PAGE_B_URL}`)) ?? "";
    const meta = await readMeta(`${conversationId}-meta-final`);

    expect(finalResult.finalText).toBe(canonicalFinalText);
    expect(initialFinalPromptText).toContain(FACT_PAGE_B_DECISION);
    expect(initialFinalPromptText).toContain(FACT_PAGE_B_ROOT_CAUSE);
    expect(initialFinalPromptText).toContain(FACT_PAGE_B_STOP_POINT);

    expect(initialFinalCarryoverBlock).toContain(`browser_get_content: ${PAGE_A_URL}`);
    expect(initialFinalCarryoverBlock).toContain(`browser_get_content: ${PAGE_B_URL}`);
    expect(countSubstring(initialFinalCarryoverBlock, `browser_get_content: ${PAGE_A_URL}`)).toBe(1);
    expect(countSubstring(initialFinalCarryoverBlock, `browser_get_content: ${PAGE_B_URL}`)).toBe(1);

    expect(pageALine).toContain(FACT_PAGE_A_ROOT_CAUSE);
    expect(pageALine).toContain(FACT_PAGE_A_STOP_POINT);
    expect(pageALine).not.toContain(FACT_PAGE_B_ROOT_CAUSE);
    expect(pageALine).not.toContain(FACT_PAGE_B_STOP_POINT);

    expect(pageBLine).toContain(FACT_PAGE_B_ROOT_CAUSE);
    expect(pageBLine).toContain(FACT_PAGE_B_STOP_POINT);
    expect(pageBLine).not.toContain(FACT_PAGE_A_ROOT_CAUSE);
    expect(pageBLine).not.toContain(FACT_PAGE_A_STOP_POINT);

    expect(Number(meta?.carryoverContextEstimate?.itemCount ?? 0)).toBeGreaterThanOrEqual(2);
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
}, 180000);

type FakeOpenAIHandle = {
  baseUrl: string;
  requests: Array<{ url: string; body: Record<string, unknown> }>;
  requestTexts: string[];
  close: () => Promise<void>;
};

async function startFakeOpenAIServer(options?: {
  handler?: (input: {
    url: string;
    body: Record<string, unknown>;
    requests: Array<{ url: string; body: Record<string, unknown> }>;
  }) => unknown;
}): Promise<FakeOpenAIHandle> {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const requestTexts: string[] = [];
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
    requestTexts.push(extractFakeOpenAIRequestText(body));

    const responsePayload = options?.handler
      ? options.handler({
        url: req.url,
        body,
        requests,
      })
      : undefined;

    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(responsePayload ?? {
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
    requestTexts,
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

function createFakeChatCompletionResponse(payload: {
  content?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
}) {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "gpt-test",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          ...(payload.content !== undefined ? { content: payload.content } : {}),
          ...(payload.toolCalls?.length
            ? {
              tool_calls: payload.toolCalls.map((toolCall) => ({
                id: toolCall.id,
                type: "function",
                function: {
                  name: toolCall.name,
                  arguments: toolCall.arguments,
                },
              })),
            }
            : {}),
          },
        finish_reason: payload.toolCalls?.length ? "tool_calls" : "stop",
      },
    ],
    usage: {
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2,
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
  extraImports?: string[];
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
  const nodeArgs = ["--import", "tsx"];
  for (const extraImport of input.extraImports ?? []) {
    nodeArgs.push("--import", extraImport);
  }
  nodeArgs.push(GATEWAY_ENTRY_PATH);

  const child = spawn(process.execPath, nodeArgs, {
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

async function createBrowserGetContentFixturePreload(input: {
  stateDir: string;
  pageUrl: string;
  pageTitle: string;
  bodyText: string;
  html: string;
}): Promise<{ filePath: string; importSpecifier: string }> {
  const preloadPath = path.join(input.stateDir, "browser-get-content-fixture-preload.mjs");
  const moduleCode = [
    `import { BrowserManager } from ${JSON.stringify(BROWSER_TOOLS_MODULE_URL)};`,
    `const fixturePageUrl = ${JSON.stringify(input.pageUrl)};`,
    `const fixturePageTitle = ${JSON.stringify(input.pageTitle)};`,
    `const fixtureBodyText = ${JSON.stringify(input.bodyText)};`,
    `const fixtureHtml = ${JSON.stringify(input.html)};`,
    "BrowserManager.getInstance = () => ({",
    "  getPage: async () => ({",
    "    waitForFunction: async () => true,",
    "    content: async () => fixtureHtml,",
    "    evaluate: async () => ({ title: fixturePageTitle, bodyText: fixtureBodyText }),",
    "    url: () => fixturePageUrl,",
    "    isClosed: () => false,",
    "    target: () => ({ _targetId: 'fixture-browser-page' }),",
    "  }),",
    "});",
    "",
  ].join("\n");
  await fs.writeFile(preloadPath, moduleCode, "utf-8");
  return {
    filePath: preloadPath,
    importSpecifier: pathToFileURL(preloadPath).href,
  };
}

async function createSequentialBrowserGetContentFixturePreload(input: {
  stateDir: string;
  pages: Array<{
    pageUrl: string;
    pageTitle: string;
    bodyText: string;
    html: string;
  }>;
}): Promise<{ filePath: string; importSpecifier: string }> {
  const preloadPath = path.join(input.stateDir, "browser-get-content-sequential-fixture-preload.mjs");
  const moduleCode = [
    `import { BrowserManager } from ${JSON.stringify(BROWSER_TOOLS_MODULE_URL)};`,
    `const fixturePages = ${JSON.stringify(input.pages)};`,
    "let callCount = 0;",
    "BrowserManager.getInstance = () => ({",
    "  getPage: async () => {",
    "    const index = Math.min(callCount, fixturePages.length - 1);",
    "    callCount += 1;",
    "    const page = fixturePages[index];",
    "    return {",
    "      waitForFunction: async () => true,",
    "      content: async () => page.html,",
    "      evaluate: async () => ({ title: page.pageTitle, bodyText: page.bodyText }),",
    "      url: () => page.pageUrl,",
    "      isClosed: () => false,",
    "      target: () => ({ _targetId: `fixture-browser-page-${index + 1}` }),",
    "    };",
    "  },",
    "});",
    "",
  ].join("\n");
  await fs.writeFile(preloadPath, moduleCode, "utf-8");
  return {
    filePath: preloadPath,
    importSpecifier: pathToFileURL(preloadPath).href,
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

async function connectGatewayWebSocket(
  port: number,
  options?: {
    role?: "web" | "cli" | "node";
    clientId?: string;
  },
): Promise<GatewayWebSocketHandle> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closePromise = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => {
    frames.push(JSON.parse(data.toString("utf-8")));
  });

  await waitFor(() => frames.some((frame) => frame.type === "connect.challenge"));
  ws.send(JSON.stringify({
    type: "connect",
    role: options?.role ?? "web",
    auth: { mode: "none" },
    ...(options?.clientId ? { clientId: options.clientId } : {}),
  }));
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

function extractTaggedPromptBlock(text: string, tagName: string): string {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`, "i");
  return pattern.exec(text)?.[0] ?? "";
}

function extractTaggedPromptInnerText(text: string, tagName: string): string {
  const block = extractTaggedPromptBlock(text, tagName);
  if (!block) {
    return "";
  }
  return block
    .replace(new RegExp(`^<${tagName}\\b[^>]*>`, "i"), "")
    .replace(new RegExp(`<\\/${tagName}>$`, "i"), "")
    .trim();
}

function countSubstring(text: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let searchIndex = 0;
  while (searchIndex < text.length) {
    const matchIndex = text.indexOf(needle, searchIndex);
    if (matchIndex === -1) {
      break;
    }
    count += 1;
    searchIndex = matchIndex + needle.length;
  }
  return count;
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
