import fs from "node:fs";

import { describe, expect, it } from "vitest";

const featuresDirectory = new URL("./", import.meta.url);
const appSource = fs.readFileSync(new URL("../../app.js", import.meta.url), "utf8");
const doctorSource = fs.readFileSync(new URL("./doctor-observability.js", import.meta.url), "utf8");

describe("WebChat lifecycle resource inventory", () => {
  it("keeps every explicit snapshot owner next to at least one fixture", () => {
    const fileNames = fs.readdirSync(featuresDirectory);
    const sourceFileNames = fileNames.filter((fileName) => fileName.endsWith(".js") && !fileName.endsWith(".test.js"));
    const snapshotOwners = sourceFileNames.filter((fileName) => {
      const source = fs.readFileSync(new URL(fileName, featuresDirectory), "utf8");
      return source.includes("getRuntimeSnapshot") || source.includes("getRetentionSnapshot");
    });
    const ownersWithoutFixture = snapshotOwners.filter((fileName) => {
      const baseName = fileName.slice(0, -3);
      return !fileNames.some((candidate) => (
        candidate === `${baseName}.test.js`
        || candidate === `${baseName}.lifecycle.test.js`
        || (candidate.startsWith(`${baseName}.`) && candidate.endsWith(".test.js"))
      ));
    });

    expect(snapshotOwners.length).toBeGreaterThanOrEqual(90);
    expect(ownersWithoutFixture).toEqual([]);
  });

  it("registers unique top-level composite providers for every critical resource family", () => {
    const providerBlock = appSource.match(
      /\[\s*\(\) => taskTokenResultPanelFeature,([\s\S]*?)\]\.forEach\(registerWebchatLifecycleProvider\);/,
    )?.[0] ?? "";
    const providerNames = [...providerBlock.matchAll(/\(\) => ([A-Za-z0-9_]+),/g)]
      .map((match) => match[1]);

    expect(providerNames).toHaveLength(51);
    expect(new Set(providerNames).size).toBe(providerNames.length);
    expect(providerNames).toEqual(expect.arrayContaining([
      "taskTokenHistoryByConversation",
      "bootSequenceFeature",
      "agentSessionCacheFeature",
      "appShellFeature",
      "chatNetworkFeature",
      "agentRuntimeFeature",
      "goalsSpecialistPanelsFeature",
      "memoryRuntimeFeature",
      "memoryViewerFeature",
      "experienceWorkbenchFeature",
      "bridgeRuntimeFeature",
    ]));
    expect(providerNames).not.toContain("sessionNavigationFeature");
  });

  it("keeps new Doctor card logic outside the oversized observability assembler", () => {
    expect(doctorSource).toContain('import { buildWebchatLifecycleCard } from "./doctor-webchat-lifecycle-card.js";');
    expect(doctorSource).not.toContain("function buildWebchatLifecycleCard");
    expect(doctorSource.match(/buildWebchatLifecycleCard\(payload, t\)/g)).toHaveLength(2);
  });
});
