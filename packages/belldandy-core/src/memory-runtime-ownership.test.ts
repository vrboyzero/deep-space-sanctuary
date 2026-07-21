import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

function countLines(source: string): number {
  return source.split(/\r?\n/u).length;
}

describe("memory runtime owner inventory", () => {
  it("keeps scheduler, input, privacy, and response policies in adjacent owners", () => {
    const schedulerSource = readSource(
      "packages/belldandy-core/src/memory-background-job-scheduler.ts",
    );
    const inputSource = readSource(
      "packages/belldandy-memory/src/durable-extraction-input.ts",
    );
    const privacySource = readSource(
      "packages/belldandy-memory/src/memory-model-privacy.ts",
    );
    const responseSource = readSource(
      "packages/belldandy-memory/src/private-summary-model-response.ts",
    );

    expect(schedulerSource).toContain("export class MemoryBackgroundJobScheduler");
    expect(inputSource).toContain("export function selectDurableExtractionInput");
    expect(privacySource).toContain("export class MemoryModelPrivacyRuntime");
    expect(privacySource).toContain("export function preparePrivateSummaryModelRequest");
    expect(responseSource).toContain("export async function readBoundedPrivateSummaryModelResponse");

    for (const source of [schedulerSource, inputSource, privacySource, responseSource]) {
      expect(countLines(source)).toBeLessThan(3_000);
    }
  });

  it("keeps Gateway and MemoryManager files on composition and forwarding", () => {
    const gatewaySource = readSource("packages/belldandy-core/src/bin/gateway-main.ts");
    const gatewayMemorySource = readSource(
      "packages/belldandy-core/src/bin/gateway-memory-background-runtime.ts",
    );
    const serverSource = readSource("packages/belldandy-core/src/server.ts");
    const managerSource = readSource("packages/belldandy-memory/src/manager.ts");
    const durableExtractionSource = readSource(
      "packages/belldandy-memory/src/durable-extraction.ts",
    );

    expect(gatewaySource).toContain("createGatewayMemoryBackgroundRuntime");
    expect(gatewaySource).not.toContain("new MemoryBackgroundJobScheduler");
    expect(gatewaySource).not.toContain("MemoryModelPrivacyRuntime.fromEnv");
    expect(gatewayMemorySource).toContain("new MemoryBackgroundJobScheduler");
    expect(gatewayMemorySource).toContain("MemoryModelPrivacyRuntime.fromEnv(input.env)");

    expect(serverSource).not.toContain("class MemoryBackgroundJobScheduler");
    expect(serverSource).not.toContain("function resolveMemoryModelEndpointTrust");
    expect(serverSource).not.toContain("function selectDurableExtractionInput");
    expect(managerSource).not.toContain("function resolveMemoryModelEndpointTrust");
    expect(managerSource).not.toContain("function selectDurableExtractionInput");
    expect(managerSource).not.toContain("readBoundedPrivateSummaryModelResponse");
    expect(durableExtractionSource).toContain("selectDurableExtractionInput(sourceMessages");
  });
});
