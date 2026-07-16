import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

import { generateBootstrapAuthToken } from "./bootstrap-auth-token.js";

test("bootstrap auth token carries 256 bits in a URL-safe format", () => {
  const token = generateBootstrapAuthToken();
  const encodedSecret = token.slice("setup-".length);

  expect(token).toMatch(/^setup-[A-Za-z0-9_-]{43}$/);
  expect(Buffer.from(encodedSecret, "base64url")).toHaveLength(32);
});

test("all production setup-token consumers delegate to the shared generator", async () => {
  const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const consumerPaths = [
    "packages/star-sanctuary-distribution/src/env.ts",
    "packages/star-sanctuary-distribution/src/portable-entry.ts",
    "packages/star-sanctuary-distribution/src/single-exe-entry.ts",
    "packages/belldandy-core/src/bin/launcher-auth.ts",
  ];

  for (const relativePath of consumerPaths) {
    const source = await fs.readFile(path.join(workspaceRoot, relativePath), "utf-8");
    expect(source, relativePath).toContain("generateBootstrapAuthToken");
    expect(source, relativePath).not.toMatch(/randomBytes\(4\)/);
  }
});
