import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertReleaseIdentityMatches,
  resolveReleaseIdentity,
  validateReleaseIdentity,
} from "./release-identity.mjs";

describe("release identity", () => {
  let fixtureRoot;
  const lockfileContent = "lockfileVersion: '9.0'\n";

  beforeEach(() => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "star-release-identity-"));
    fs.writeFileSync(path.join(fixtureRoot, "pnpm-lock.yaml"), lockfileContent);
    fs.writeFileSync(path.join(fixtureRoot, "builder.mjs"), "export const builder = true;\n");
    fs.writeFileSync(path.join(fixtureRoot, "policy.mjs"), "export const policy = true;\n");
  });

  afterEach(() => {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it("resolves version, commit, and lockfile identities from explicit local inputs", () => {
    const identity = resolveReleaseIdentity({
      version: "1.2.3",
      workspaceRoot: fixtureRoot,
      environment: {
        BELLDANDY_RELEASE_COMMIT_SHA: "a".repeat(40),
      },
      buildGraphInputPaths: ["policy.mjs", "builder.mjs"],
    });
    const buildGraphInputs = ["builder.mjs", "policy.mjs"].map((inputPath) => ({
      path: inputPath,
      sha256: crypto.createHash("sha256")
        .update(fs.readFileSync(path.join(fixtureRoot, inputPath)))
        .digest("hex"),
    }));
    const buildGraphSha256 = crypto.createHash("sha256")
      .update(JSON.stringify({ schemaVersion: 1, inputs: buildGraphInputs }))
      .digest("hex");

    expect(identity).toEqual({
      schemaVersion: 1,
      version: "1.2.3",
      commitSha: "a".repeat(40),
      lockfileSha256: crypto.createHash("sha256").update(lockfileContent).digest("hex"),
      buildGraphSha256,
    });
  });

  it("rejects incomplete or malformed release identities", () => {
    const valid = {
      schemaVersion: 1,
      version: "1.2.3",
      commitSha: "a".repeat(40),
      lockfileSha256: "b".repeat(64),
      buildGraphSha256: "c".repeat(64),
    };

    expect(() => validateReleaseIdentity({ ...valid, version: "" })).toThrow(/version/i);
    expect(() => validateReleaseIdentity({ ...valid, commitSha: "not-a-commit" })).toThrow(/commit sha/i);
    expect(() => validateReleaseIdentity({ ...valid, lockfileSha256: "short" })).toThrow(/lockfile sha-256/i);
    expect(() => validateReleaseIdentity({ ...valid, buildGraphSha256: "short" })).toThrow(/buildgraph sha-256/i);
  });

  it("rejects a manifest identity from another source revision", () => {
    const expected = {
      schemaVersion: 1,
      version: "1.2.3",
      commitSha: "a".repeat(40),
      lockfileSha256: "b".repeat(64),
      buildGraphSha256: "c".repeat(64),
    };
    const actual = {
      ...expected,
      commitSha: "c".repeat(40),
    };

    expect(() => assertReleaseIdentityMatches(actual, expected)).toThrow(/commit sha mismatch/i);
  });
});
