import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { BackgroundRunCoordinator } from "../background-run-coordinator.js";
import { createGatewayMemoryBackgroundRuntime } from "./gateway-memory-background-runtime.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("createGatewayMemoryBackgroundRuntime", () => {
  it("shares one loaded accounting owner between the budget guard and scheduler", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-gateway-memory-runtime-"));
    tempDirs.push(stateDir);
    const runtime = await createGatewayMemoryBackgroundRuntime({
      stateDir,
      runCoordinator: new BackgroundRunCoordinator(),
      logger: { warn: vi.fn() },
    });

    const admission = await runtime.jobScheduler.acquire({
      family: "dream",
      agentId: "default",
      priority: "high",
      estimatedTokenUnits: 512,
    });
    if ("reason" in admission) throw new Error(admission.reason);
    await admission.complete(() => undefined);

    await expect(runtime.usageAccounting.listEvents({
      consumer: "background_model_run",
    })).resolves.toEqual([
      expect.objectContaining({ outcome: "started", quantity: 512 }),
      expect.objectContaining({ outcome: "completed", quantity: 512 }),
    ]);
  });

  it("creates one shared private-summary policy snapshot from environment", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-gateway-memory-privacy-"));
    tempDirs.push(stateDir);
    const runtime = await createGatewayMemoryBackgroundRuntime({
      stateDir,
      runCoordinator: new BackgroundRunCoordinator(),
      env: {
        BELLDANDY_MEMORY_PRIVATE_SUMMARY_TRUSTED_HOSTS: "trusted.example.test",
        BELLDANDY_MEMORY_PRIVATE_SUMMARY_REDACTOR: "basic",
      } as NodeJS.ProcessEnv,
    });

    const prepared = runtime.modelPrivacyRuntime.prepareRequest({
      jobFamily: "dream",
      baseUrl: "https://trusted.example.test/v1",
      payload: { messages: [{ role: "user", content: "alice@example.test" }] },
    });

    expect(prepared.snapshot).toMatchObject({
      dataClass: "private_summary",
      trustProfile: "trusted_remote",
      redactorStatus: "applied",
    });
    expect(prepared.body).not.toContain("alice@example.test");
  });
});
