import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeAll, expect, test } from "vitest";
import WebSocket from "ws";

import { MemoryManager, registerGlobalMemoryManager } from "@belldandy/memory";

import { startGatewayServer } from "./server.js";
import {
  cleanupGlobalMemoryManagersForTest,
  pairWebSocketClient,
  resolveWebRoot,
  waitFor,
} from "./server-testkit.js";

beforeAll(() => {
  if (!process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = "test-placeholder-key";
  }
});

afterEach(async () => {
  await cleanupGlobalMemoryManagersForTest();
});

test("server exposes skill freshness across doctor, candidate, usage, and task payloads", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-skill-freshness-server-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-skill-freshness-workspace-"));
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });
  (memoryManager as any).embeddingProvider = {
    modelName: "test-skill-freshness",
    embed: async () => [0.1],
    embedBatch: async (texts: string[]) => texts.map(() => [0.1]),
    embedQuery: async () => [0.1],
  };
  registerGlobalMemoryManager(memoryManager);

  const acceptedSkillCandidate = {
    id: "exp-skill-freshness-accepted",
    taskId: "task-skill-source",
    type: "skill" as const,
    status: "accepted" as const,
    title: "Browser Repair Skill",
    slug: "browser-repair-skill",
    content: "name: Browser Repair Skill\n# Browser Repair Skill",
    sourceTaskSnapshot: {
      taskId: "task-skill-source",
      conversationId: "conv-skill-source",
      source: "chat" as const,
      status: "success" as const,
      startedAt: "2026-04-10T00:00:00.000Z",
    },
    publishedPath: path.join(workspaceRoot, "skills", "browser-repair-skill", "SKILL.md"),
    createdAt: "2026-04-10T00:00:00.000Z",
    acceptedAt: "2026-04-10T00:05:00.000Z",
  };
  (memoryManager as any).store.createExperienceCandidate(acceptedSkillCandidate);
  (memoryManager as any).store.createExperienceCandidate({
    id: "exp-skill-freshness-patch",
    taskId: "task-skill-patch",
    type: "skill",
    status: "draft",
    title: "Browser Repair Skill",
    slug: "browser-repair-skill",
    content: "name: Browser Repair Skill\n# Patch candidate",
    sourceTaskSnapshot: {
      taskId: "task-skill-patch",
      conversationId: "conv-skill-patch",
      source: "chat",
      status: "failed",
      startedAt: "2026-04-10T05:00:00.000Z",
    },
    createdAt: "2026-04-10T05:00:00.000Z",
  });

  for (const item of [
    { id: "task-skill-use-1", status: "failed" as const, time: "2026-04-10T01:00:00.000Z" },
    { id: "task-skill-use-2", status: "partial" as const, time: "2026-04-10T02:00:00.000Z" },
    { id: "task-skill-use-3", status: "success" as const, time: "2026-04-10T03:00:00.000Z" },
    { id: "task-skill-use-4", status: "failed" as const, time: "2026-04-10T04:00:00.000Z" },
  ]) {
    (memoryManager as any).store.createTask({
      id: item.id,
      conversationId: `conv-${item.id}`,
      sessionKey: `session-${item.id}`,
      source: "chat",
      status: item.status,
      title: item.id,
      startedAt: item.time,
      finishedAt: item.time,
      createdAt: item.time,
      updatedAt: item.time,
    });
    memoryManager.recordSkillUsage(item.id, "Browser Repair Skill", {
      sourceCandidateId: acceptedSkillCandidate.id,
      usedVia: "tool",
    });
  }

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    additionalWorkspaceRoots: [workspaceRoot],
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({ type: "req", id: "doctor-skill-freshness", method: "system.doctor", params: {} }));
    ws.send(JSON.stringify({ type: "req", id: "candidate-skill-freshness", method: "experience.candidate.get", params: { candidateId: acceptedSkillCandidate.id } }));
    ws.send(JSON.stringify({ type: "req", id: "usage-stats-skill-freshness", method: "experience.usage.stats", params: { limit: 10, filter: { assetType: "skill" } } }));
    ws.send(JSON.stringify({ type: "req", id: "task-skill-freshness", method: "memory.task.get", params: { taskId: "task-skill-use-4" } }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "doctor-skill-freshness"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "candidate-skill-freshness"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "usage-stats-skill-freshness"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "task-skill-freshness"));

    const doctorRes = frames.find((f) => f.type === "res" && f.id === "doctor-skill-freshness");
    const candidateRes = frames.find((f) => f.type === "res" && f.id === "candidate-skill-freshness");
    const usageStatsRes = frames.find((f) => f.type === "res" && f.id === "usage-stats-skill-freshness");
    const taskRes = frames.find((f) => f.type === "res" && f.id === "task-skill-freshness");

    expect(doctorRes.ok).toBe(true);
    expect(doctorRes.payload?.skillFreshness?.summary?.needsPatchCount).toBeGreaterThanOrEqual(1);
    expect(doctorRes.payload?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "skill_freshness",
        status: "warn",
      }),
    ]));

    expect(candidateRes.ok).toBe(true);
    expect(candidateRes.payload?.candidate?.skillFreshness?.status).toBe("needs_patch");
    expect(candidateRes.payload?.candidate?.skillFreshness?.signals?.some((entry: any) => entry.code === "pending_update_candidate")).toBe(true);

    expect(usageStatsRes.ok).toBe(true);
    expect(usageStatsRes.payload?.items?.[0]?.skillFreshness?.status).toBe("needs_patch");

    expect(taskRes.ok).toBe(true);
    expect(taskRes.payload?.task?.usedSkills?.[0]?.skillFreshness?.status).toBe("needs_patch");

    ws.send(JSON.stringify({
      type: "req",
      id: "skill-freshness-manual-mark",
      method: "experience.skill.freshness.update",
      params: {
        sourceCandidateId: acceptedSkillCandidate.id,
        reason: "手测发现说明已经过时",
        markedBy: "tester",
        stale: true,
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "skill-freshness-manual-mark"));
    const updateRes = frames.find((f) => f.type === "res" && f.id === "skill-freshness-manual-mark");
    expect(updateRes.ok).toBe(true);
    expect(updateRes.payload?.mark?.reason).toContain("过时");

    ws.send(JSON.stringify({ type: "req", id: "candidate-skill-freshness-after-mark", method: "experience.candidate.get", params: { candidateId: acceptedSkillCandidate.id } }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "candidate-skill-freshness-after-mark"));
    const candidateAfterMarkRes = frames.find((f) => f.type === "res" && f.id === "candidate-skill-freshness-after-mark");
    expect(candidateAfterMarkRes.payload?.candidate?.skillFreshness?.manualStaleMark?.reason).toContain("过时");
  } finally {
    ws.close();
    await closeP;
    await server.close();
    memoryManager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("server exposes usage-only manual stale marks across doctor, usage, and task payloads", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-skill-freshness-usage-only-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-skill-freshness-usage-workspace-"));
  const memoryManager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });
  (memoryManager as any).embeddingProvider = {
    modelName: "test-skill-freshness-usage-only",
    embed: async () => [0.1],
    embedBatch: async (texts: string[]) => texts.map(() => [0.1]),
    embedQuery: async () => [0.1],
  };
  registerGlobalMemoryManager(memoryManager);

  (memoryManager as any).store.createTask({
    id: "task-usage-only-skill",
    conversationId: "conv-usage-only-skill",
    sessionKey: "session-usage-only-skill",
    source: "chat",
    status: "success",
    title: "usage only skill task",
    startedAt: "2026-04-10T07:00:00.000Z",
    finishedAt: "2026-04-10T07:00:00.000Z",
    createdAt: "2026-04-10T07:00:00.000Z",
    updatedAt: "2026-04-10T07:00:00.000Z",
  });
  memoryManager.recordSkillUsage("task-usage-only-skill", "web-monitor", {
    usedVia: "tool",
  });
  const usageId = memoryManager.listExperienceUsages(10, { assetType: "skill" })[0]?.id;
  expect(usageId).toBeTruthy();

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    additionalWorkspaceRoots: [workspaceRoot],
  });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);

    ws.send(JSON.stringify({
      type: "req",
      id: "usage-only-manual-mark",
      method: "experience.skill.freshness.update",
      params: {
        skillKey: "web-monitor",
        reason: "真实手测后怀疑说明已过时",
        markedBy: "tester",
        stale: true,
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "usage-only-manual-mark"));
    const updateRes = frames.find((f) => f.type === "res" && f.id === "usage-only-manual-mark");
    expect(updateRes.ok).toBe(true);
    expect(updateRes.payload?.skillFreshness?.status).toBe("warn_stale");

    ws.send(JSON.stringify({ type: "req", id: "doctor-usage-only", method: "system.doctor", params: {} }));
    ws.send(JSON.stringify({ type: "req", id: "usage-stats-usage-only", method: "experience.usage.stats", params: { limit: 10, filter: { assetType: "skill" } } }));
    ws.send(JSON.stringify({ type: "req", id: "usage-get-usage-only", method: "experience.usage.get", params: { usageId } }));
    ws.send(JSON.stringify({ type: "req", id: "task-usage-only", method: "memory.task.get", params: { taskId: "task-usage-only-skill" } }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "doctor-usage-only"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "usage-stats-usage-only"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "usage-get-usage-only"));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "task-usage-only"));

    const doctorRes = frames.find((f) => f.type === "res" && f.id === "doctor-usage-only");
    const usageStatsRes = frames.find((f) => f.type === "res" && f.id === "usage-stats-usage-only");
    const usageGetRes = frames.find((f) => f.type === "res" && f.id === "usage-get-usage-only");
    const taskRes = frames.find((f) => f.type === "res" && f.id === "task-usage-only");

    expect(doctorRes.ok).toBe(true);
    expect(doctorRes.payload?.skillFreshness?.summary?.warnCount).toBeGreaterThanOrEqual(1);
    expect(doctorRes.payload?.skillFreshness?.summary?.topItems?.some((item: any) => item.skillKey === "web-monitor" && item.status === "warn_stale")).toBe(true);

    expect(usageStatsRes.ok).toBe(true);
    expect(usageStatsRes.payload?.items?.find((item: any) => item.assetKey === "web-monitor")?.skillFreshness?.manualStaleMark?.reason).toContain("过时");
    expect(usageGetRes.ok).toBe(true);
    expect(usageGetRes.payload?.usage?.skillFreshness?.status).toBe("warn_stale");

    expect(taskRes.ok).toBe(true);
    expect(taskRes.payload?.task?.usedSkills?.find((item: any) => item.assetKey === "web-monitor")?.skillFreshness?.status).toBe("warn_stale");

    ws.send(JSON.stringify({
      type: "req",
      id: "usage-only-manual-clear",
      method: "experience.skill.freshness.update",
      params: {
        skillKey: "web-monitor",
        stale: false,
      },
    }));
    await waitFor(() => frames.some((f) => f.type === "res" && f.id === "usage-only-manual-clear"));
    const clearRes = frames.find((f) => f.type === "res" && f.id === "usage-only-manual-clear");
    expect(clearRes.ok).toBe(true);
  } finally {
    ws.close();
    await closeP;
    await server.close();
    memoryManager.close();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});
