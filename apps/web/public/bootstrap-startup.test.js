import fs from "node:fs";
import vm from "node:vm";

import { describe, expect, it, vi } from "vitest";

const bootstrapSource = fs.readFileSync(new URL("./bootstrap-startup.js", import.meta.url), "utf8");

function runBootstrap(startup) {
  const window = {
    __SS_WEBCHAT_STARTUP__: startup,
    performance: {
      now: () => 100,
      getEntriesByType: () => [],
    },
    localStorage: { getItem: () => null },
    navigator: { language: "en-US" },
    addEventListener: () => {},
  };
  const document = {
    documentElement: { dataset: {}, style: {} },
    addEventListener: () => {},
  };
  vm.runInNewContext(bootstrapSource, {
    window,
    document,
    URLSearchParams,
    console: { info: vi.fn() },
  });
  return window.__SS_WEBCHAT_STARTUP__;
}

describe("WebChat startup bootstrap", () => {
  it("bounds and sanitizes pre-existing marks before retaining them", () => {
    const startup = {
      navigationStartMs: 0,
      parseStartedAtMs: 0,
      marks: Array.from({ length: 65 }, (_, index) => ({
        stage: index === 64 ? "https://private.example.test/secret" : "safe.startup.stage",
        atMs: index,
        url: "wss://private.example.test/?token=secret",
        reason: "message body must not be retained",
        numericValue: index,
        enabled: true,
        ...Object.fromEntries(Array.from({ length: 20 }, (_, extraIndex) => [
          `extra${extraIndex}`,
          extraIndex,
        ])),
      })),
    };

    const hydrated = runBootstrap(startup);
    const serializedMarks = JSON.stringify(hydrated.marks);
    const retainedLegacyMark = hydrated.marks.find((mark) => mark.numericValue === 64);

    expect(hydrated.marks).toHaveLength(64);
    expect(retainedLegacyMark).toMatchObject({
      stage: "unknown",
      atMs: 64,
      numericValue: 64,
      enabled: true,
    });
    expect(Object.keys(retainedLegacyMark).filter((key) => !["stage", "atMs"].includes(key))).toHaveLength(16);
    expect(serializedMarks).not.toContain("private.example.test");
    expect(serializedMarks).not.toContain("message body must not be retained");
  });
});
