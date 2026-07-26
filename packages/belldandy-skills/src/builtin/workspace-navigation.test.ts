import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { ToolContext } from "../types.js";
import { collectWorkspaceFiles } from "./workspace-navigation.js";

describe("collectWorkspaceFiles", () => {
  let tempDir: string;
  let context: ToolContext;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-workspace-navigation-"));
    context = {
      conversationId: "conv-workspace-navigation",
      workspaceRoot: tempDir,
      policy: {
        allowedPaths: [],
        deniedPaths: [".git", "node_modules", "restricted"],
        allowedDomains: [],
        deniedDomains: [],
        maxTimeoutMs: 5_000,
        maxResponseBytes: 64 * 1024,
      },
    };
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("returns a stable, policy-bounded file inventory with include and exclude globs", async () => {
    await writeFile(".gitignore", "ignored/\n");
    await writeFile("src/.gitignore", "generated/\n");
    await writeFile("src/app.ts", "export const app = true;\n");
    await writeFile("src/generated/build.ts", "export const build = true;\n");
    await writeFile("docs/readme.md", "docs\n");
    await writeFile("ignored/private.ts", "private\n");
    await writeFile(".hidden.ts", "hidden\n");
    await writeFile(".env", "secret\n");
    await writeFile("restricted/blocked.ts", "blocked\n");

    const collected = await collectWorkspaceFiles({
      context,
      include: ["**/*.ts"],
      exclude: ["src/app.ts"],
    });

    expect(collected.ok).toBe(true);
    if (!collected.ok) return;
    expect(collected.value.files).toEqual([]);
    expect(collected.value.skipped).toMatchObject({
      ignored: expect.any(Number),
      hidden: expect.any(Number),
      sensitive: expect.any(Number),
      policyDenied: expect.any(Number),
      excluded: 1,
    });
    expect(collected.value.gitignoreFiles).toBe(2);
  });

  it("stops before descending into an ignored search root", async () => {
    await writeFile(".gitignore", "ignored/\n");
    await writeFile("ignored/value.ts", "value\n");

    const collected = await collectWorkspaceFiles({
      context,
      path: "ignored",
    });

    expect(collected.ok).toBe(true);
    if (!collected.ok) return;
    expect(collected.value.files).toEqual([]);
    expect(collected.value.skipped.ignored).toBe(1);
  });

  async function writeFile(relativePath: string, content: string): Promise<void> {
    const target = path.join(tempDir, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf-8");
  }
});
