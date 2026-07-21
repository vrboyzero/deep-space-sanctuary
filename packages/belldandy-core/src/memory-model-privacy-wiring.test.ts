import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MemoryModelPrivacyRuntime } from "@belldandy/memory";
import { afterEach, describe, expect, it } from "vitest";

import { buildGatewayServerOptions } from "./bin/gateway-server-runtime.js";
import { createScopedMemoryManagers } from "./resident-memory-managers.js";
import { cleanupGlobalMemoryManagersForTest } from "./server-testkit.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await cleanupGlobalMemoryManagersForTest();
  await Promise.all(tempDirs.splice(0).map((dir) => fsp.rm(dir, { recursive: true, force: true })));
});

describe("memory model privacy gateway wiring", () => {
  it("forwards one owner to scoped managers and server options", async () => {
    const stateDir = await fsp.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-privacy-wiring-"));
    tempDirs.push(stateDir);
    const modelPrivacyRuntime = new MemoryModelPrivacyRuntime();

    createScopedMemoryManagers({
      stateDir,
      modelsDir: path.join(stateDir, "models"),
      embeddingEnabled: false,
      summaryEnabled: true,
      summaryBaseUrl: "https://summary.example.test/v1",
      evolutionEnabled: true,
      evolutionBaseUrl: "https://evolution.example.test/v1",
      modelPrivacyRuntime,
      indexerOptions: { watch: false },
    });
    const serverOptions = buildGatewayServerOptions({
      memoryModelPrivacyRuntime: modelPrivacyRuntime,
    } as Parameters<typeof buildGatewayServerOptions>[0]);

    expect(serverOptions.memoryModelPrivacyRuntime).toBe(modelPrivacyRuntime);
    expect(modelPrivacyRuntime.getDoctorReport().items).toEqual(expect.arrayContaining([
      expect.objectContaining({ jobFamily: "idle_summary", dataClass: "private_summary" }),
      expect.objectContaining({ jobFamily: "durable_extraction", dataClass: "private_summary" }),
    ]));
  });

  it("keeps the production composition on the shared owner", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "packages/belldandy-core/src/bin/gateway-main.ts"),
      "utf8",
    );

    expect(source).toContain("modelPrivacyRuntime: memoryBackgroundRuntime.modelPrivacyRuntime");
    expect(source).toContain("memoryModelPrivacyRuntime: memoryBackgroundRuntime.modelPrivacyRuntime");
  });
});
