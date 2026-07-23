import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  getGlobalMemoryManager,
  listGlobalMemoryManagers,
  resetGlobalMemoryManagers,
} from "@belldandy/memory";

import { createScopedMemoryManagers } from "./resident-memory-managers.js";

type ResidentProfile = {
  id: string;
  displayName: string;
  model: string;
  kind: "resident";
  workspaceDir: string;
  memoryMode: "isolated" | "shared" | "hybrid";
};

function createRegistry(profiles: ResidentProfile[]) {
  return {
    getProfile(agentId: string) {
      return profiles.find((profile) => profile.id === agentId);
    },
    list() {
      return profiles;
    },
  } as any;
}

async function writeSessionMemory(rootDir: string, conversationId: string, marker: string): Promise<void> {
  const sessionsDir = path.join(rootDir, "sessions");
  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.writeFile(path.join(sessionsDir, `${conversationId}.session-memory.json`), JSON.stringify({
    summary: `${marker} summary`,
    currentGoal: marker,
    nextStep: `${marker} next step`,
    updatedAt: Date.parse("2026-07-23T00:00:00.000Z"),
  }), "utf-8");
}

describe("scoped memory session artifact inventory", () => {
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    const managers = listGlobalMemoryManagers();
    resetGlobalMemoryManagers();
    await Promise.allSettled(managers.map((manager) => manager.close()));
    for (const dir of cleanupDirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    cleanupDirs.clear();
  });

  it("keeps default, isolated, shared and hybrid derived sessions on their own state roots", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-scoped-session-inventory-"));
    cleanupDirs.add(stateDir);
    const profiles: ResidentProfile[] = [
      { id: "default", displayName: "Default", model: "primary", kind: "resident", workspaceDir: "default", memoryMode: "isolated" },
      { id: "isolated", displayName: "Isolated", model: "primary", kind: "resident", workspaceDir: "isolated", memoryMode: "isolated" },
      { id: "shared", displayName: "Shared", model: "primary", kind: "resident", workspaceDir: "shared", memoryMode: "shared" },
      { id: "hybrid", displayName: "Hybrid", model: "primary", kind: "resident", workspaceDir: "hybrid", memoryMode: "hybrid" },
    ];

    await Promise.all([
      writeSessionMemory(stateDir, "conv-default", "marker-default"),
      writeSessionMemory(path.join(stateDir, "agents", "isolated"), "conv-isolated", "marker-isolated"),
      writeSessionMemory(path.join(stateDir, "team-memory"), "conv-shared", "marker-shared"),
      writeSessionMemory(path.join(stateDir, "agents", "hybrid"), "conv-hybrid", "marker-hybrid"),
    ]);

    const { defaultManager } = createScopedMemoryManagers({
      stateDir,
      agentRegistry: createRegistry(profiles),
      modelsDir: path.join(stateDir, "models"),
      embeddingEnabled: false,
      indexerOptions: { watch: false },
    });
    const isolatedManager = getGlobalMemoryManager({ agentId: "isolated" });
    const sharedManager = getGlobalMemoryManager({ agentId: "shared" });
    const hybridManager = getGlobalMemoryManager({ agentId: "hybrid" });
    expect(isolatedManager).toBeTruthy();
    expect(sharedManager).toBeTruthy();
    expect(hybridManager).toBeTruthy();
    if (!isolatedManager || !sharedManager || !hybridManager) {
      throw new Error("expected scoped MemoryManagers");
    }

    const managers = [
      { manager: defaultManager, marker: "marker-default", conversationId: "conv-default" },
      { manager: isolatedManager, marker: "marker-isolated", conversationId: "conv-isolated" },
      { manager: sharedManager, marker: "marker-shared", conversationId: "conv-shared" },
      { manager: hybridManager, marker: "marker-hybrid", conversationId: "conv-hybrid" },
    ];
    for (const entry of managers) {
      const result = await entry.manager.searchWithDiagnostics(entry.marker, {
        limit: 3,
        routingPolicy: "chunk_only",
      });
      const derived = result.items.filter((item) => item.id.startsWith("derived-session:"));
      expect(derived).toHaveLength(1);
      expect(derived[0]?.metadata).toMatchObject({
        derivedRetrieval: { conversationId: entry.conversationId },
      });
      expect(derived[0]?.content).toContain(entry.marker);
      for (const otherMarker of ["marker-default", "marker-isolated", "marker-shared", "marker-hybrid"]) {
        if (otherMarker !== entry.marker) {
          expect(derived[0]?.content).not.toContain(otherMarker);
        }
      }
    }
  });
});
