import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertReleaseContentManifest,
  collectReleaseContentManifest,
} from "./release-content-manifest.mjs";

describe("release content manifest", () => {
  let fixtureRoot;

  beforeEach(() => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "star-release-content-"));
    fs.mkdirSync(path.join(fixtureRoot, "nested"));
    fs.writeFileSync(path.join(fixtureRoot, "nested", "alpha.txt"), "alpha");
  });

  afterEach(() => {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it("collects and verifies normalized per-file identities", () => {
    const summary = collectReleaseContentManifest(fixtureRoot);

    expect(summary).toMatchObject({
      fileCount: 1,
      totalBytes: 5,
      files: [{
        path: "nested/alpha.txt",
        size: 5,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        mode: expect.any(Number),
      }],
    });
    expect(assertReleaseContentManifest({
      rootPath: fixtureRoot,
      expectedFiles: summary.files,
      label: "fixture content",
    })).toEqual(summary);
  });

  it("rejects missing and unexpected staged files", () => {
    const missingSummary = collectReleaseContentManifest(fixtureRoot);
    fs.rmSync(path.join(fixtureRoot, "nested", "alpha.txt"));
    expect(() => assertReleaseContentManifest({
      rootPath: fixtureRoot,
      expectedFiles: missingSummary.files,
      label: "fixture content",
    })).toThrow(/missing staged files/i);

    fs.writeFileSync(path.join(fixtureRoot, "nested", "alpha.txt"), "alpha");
    const unexpectedSummary = collectReleaseContentManifest(fixtureRoot);
    fs.writeFileSync(path.join(fixtureRoot, "extra.txt"), "extra");
    expect(() => assertReleaseContentManifest({
      rootPath: fixtureRoot,
      expectedFiles: unexpectedSummary.files,
      label: "fixture content",
    })).toThrow(/unexpected staged file/i);
  });

  it("rejects same-size content replacement and mode drift", () => {
    const contentSummary = collectReleaseContentManifest(fixtureRoot);
    fs.writeFileSync(path.join(fixtureRoot, "nested", "alpha.txt"), "bravo");
    expect(() => assertReleaseContentManifest({
      rootPath: fixtureRoot,
      expectedFiles: contentSummary.files,
      label: "fixture content",
    })).toThrow(/SHA-256 mismatch/i);

    fs.writeFileSync(path.join(fixtureRoot, "nested", "alpha.txt"), "alpha");
    const modeSummary = collectReleaseContentManifest(fixtureRoot);
    modeSummary.files[0].mode ^= 0o100;
    expect(() => assertReleaseContentManifest({
      rootPath: fixtureRoot,
      expectedFiles: modeSummary.files,
      label: "fixture content",
    })).toThrow(/mode mismatch/i);
  });
});
