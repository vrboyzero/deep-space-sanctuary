import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CodingRunRecoveryMarkerStore } from "./recovery-marker-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })
  ));
});

describe("CodingRunRecoveryMarkerStore", () => {
  it("projects only an exact active marker from a lost runtime owner", async () => {
    const stateDir = await createStateDir();
    const first = new CodingRunRecoveryMarkerStore(stateDir, {
      ownerInstanceId: "gateway-instance-a",
      ownerProcessId: 101,
      isProcessAlive: () => false,
      now: () => 1_000,
    });
    await first.markActive({
      source: "conversation",
      binding: { conversationId: "conversation-1", agentRunId: "run-1" },
      startedAtMs: 900,
    });

    const restarted = new CodingRunRecoveryMarkerStore(stateDir, {
      ownerInstanceId: "gateway-instance-b",
      ownerProcessId: 202,
      isProcessAlive: () => false,
      now: () => 2_000,
    });
    await expect(restarted.lookup({
      source: "conversation",
      binding: { conversationId: "conversation-1", agentRunId: "run-1" },
    })).resolves.toMatchObject({
      state: "lost",
      marker: {
        source: "conversation",
        binding: { conversationId: "conversation-1", agentRunId: "run-1" },
        startedAtMs: 900,
        updatedAtMs: 1_000,
      },
    });
    await expect(restarted.lookup({
      source: "conversation",
      binding: { conversationId: "conversation-1", agentRunId: "run-old" },
    })).resolves.toEqual({ state: "not_found" });
  });

  it("does not report settled markers or a still-live foreign owner as lost", async () => {
    const stateDir = await createStateDir();
    const first = new CodingRunRecoveryMarkerStore(stateDir, {
      ownerInstanceId: "gateway-instance-a",
      ownerProcessId: 101,
      isProcessAlive: (pid) => pid === 101,
      now: () => 1_000,
    });
    const binding = {
      agentRunId: "workflow-run-1",
      workflow: { journalId: "journal-1", workflowRunId: "workflow-run-1" },
    } as const;
    await first.markActive({ source: "workflow", binding, startedAtMs: 800 });

    const concurrent = new CodingRunRecoveryMarkerStore(stateDir, {
      ownerInstanceId: "gateway-instance-b",
      ownerProcessId: 202,
      isProcessAlive: (pid) => pid === 101,
      now: () => 1_500,
    });
    await expect(concurrent.lookup({ source: "workflow", binding })).resolves.toEqual({
      state: "live_owner",
    });

    await first.markSettled({ source: "workflow", binding });
    await expect(concurrent.lookup({ source: "workflow", binding })).resolves.toEqual({
      state: "settled",
    });
  });

  it("fails closed without overwriting a corrupt marker file", async () => {
    const stateDir = await createStateDir();
    const markerPath = path.join(stateDir, "coding-run-recovery-markers.json");
    await fs.writeFile(markerPath, "{not-json", "utf-8");
    const store = new CodingRunRecoveryMarkerStore(stateDir, {
      ownerInstanceId: "gateway-instance-a",
      ownerProcessId: 101,
      isProcessAlive: () => false,
    });
    const binding = { conversationId: "conversation-1", agentRunId: "run-1" } as const;

    await expect(store.lookup({ source: "conversation", binding })).resolves.toEqual({
      state: "unavailable",
    });
    await expect(store.markActive({
      source: "conversation",
      binding,
      startedAtMs: 1,
    })).rejects.toThrow("recovery marker state is invalid");
    await expect(fs.readFile(markerPath, "utf-8")).resolves.toBe("{not-json");
  });
});

async function createStateDir(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-coding-run-recovery-"));
  temporaryDirectories.push(directory);
  return directory;
}
