import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyPatchTool } from "./index.js";
import type { ToolContext } from "../../types.js";

describe("apply_patch tool", () => {
  let tempDir: string;
  let baseContext: ToolContext;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-apply-patch-"));
    baseContext = {
      conversationId: "test-conversation",
      workspaceRoot: tempDir,
      policy: {
        allowedPaths: [],
        deniedPaths: ["node_modules", ".git"],
        allowedDomains: [],
        deniedDomains: [],
        maxTimeoutMs: 30_000,
        maxResponseBytes: 1024 * 1024,
      },
    };
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should allow writing workspace root files when allowedPaths contains dot", async () => {
    const result = await applyPatchTool.execute(
      {
        input: [
          "*** Begin Patch",
          "*** Add File: TOOLS.md",
          "+hello from root",
          "*** End Patch",
        ].join("\n"),
      },
      {
        ...baseContext,
        policy: {
          ...baseContext.policy,
          allowedPaths: ["."],
        },
      },
    );

    expect(result.success).toBe(true);
    await expect(fs.readFile(path.join(tempDir, "TOOLS.md"), "utf-8")).resolves.toBe("hello from root\n");
  });

  it("should unwrap an apply_patch wrapper around raw patch text", async () => {
    const result = await applyPatchTool.execute(
      {
        input: [
          "apply_patch(",
          "*** Begin Patch",
          "*** Add File: WRAPPED.md",
          "+wrapped patch",
          "*** End Patch",
          ")",
        ].join("\n"),
      },
      {
        ...baseContext,
        policy: {
          ...baseContext.policy,
          allowedPaths: ["."],
        },
      },
    );

    expect(result.success).toBe(true);
    await expect(fs.readFile(path.join(tempDir, "WRAPPED.md"), "utf-8")).resolves.toBe("wrapped patch\n");
  });

  it("should unwrap a code fence around raw patch text", async () => {
    const result = await applyPatchTool.execute(
      {
        input: [
          "```patch",
          "*** Begin Patch",
          "*** Add File: FENCED.md",
          "+wrapped fence",
          "*** End Patch",
          "```",
        ].join("\n"),
      },
      {
        ...baseContext,
        policy: {
          ...baseContext.policy,
          allowedPaths: ["."],
        },
      },
    );

    expect(result.success).toBe(true);
    await expect(fs.readFile(path.join(tempDir, "FENCED.md"), "utf-8")).resolves.toBe("wrapped fence\n");
  });

  it("should still reject files outside whitelist", async () => {
    const result = await applyPatchTool.execute(
      {
        input: [
          "*** Begin Patch",
          "*** Add File: docs/TOOLS.md",
          "+forbidden",
          "*** End Patch",
        ].join("\n"),
      },
      {
        ...baseContext,
        policy: {
          ...baseContext.policy,
          allowedPaths: ["output"],
        },
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("白名单");
  });

  it("should reject move targets outside allowedPaths whitelist", async () => {
    await fs.mkdir(path.join(tempDir, "allowed"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "allowed", "source.txt"), "hello\n", "utf-8");

    const restrictedResult = await applyPatchTool.execute(
      {
        input: [
          "*** Begin Patch",
          "*** Update File: allowed/source.txt",
          "*** Move to: blocked/moved.txt",
          "@@",
          "-hello",
          "+hello moved",
          "*** End Patch",
        ].join("\n"),
      },
      {
        ...baseContext,
        policy: {
          ...baseContext.policy,
          allowedPaths: ["allowed"],
        },
      },
    );

    expect(restrictedResult.success).toBe(false);
    expect(restrictedResult.error).toContain("白名单");
  });

  it("should allow absolute paths under extraWorkspaceRoots", async () => {
    const extraRoot = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-apply-patch-extra-"));
    const targetPath = path.join(extraRoot, "nested", "TOOLS.md").replace(/\\/g, "/");

    try {
      const result = await applyPatchTool.execute(
        {
          input: [
            "*** Begin Patch",
            `*** Add File: ${targetPath}`,
            "+hello extra root",
            "*** End Patch",
          ].join("\n"),
        },
        {
          ...baseContext,
          extraWorkspaceRoots: [extraRoot],
          policy: {
            ...baseContext.policy,
            allowedPaths: ["."],
          },
        },
      );

      expect(result.success).toBe(true);
      await expect(fs.readFile(path.join(extraRoot, "nested", "TOOLS.md"), "utf-8")).resolves.toBe("hello extra root\n");
    } finally {
      await fs.rm(extraRoot, { recursive: true, force: true });
    }
  });

  it("should reject Add File when the target already exists", async () => {
    await fs.writeFile(path.join(tempDir, "existing.txt"), "old\n", "utf-8");

    const result = await applyPatchTool.execute(
      {
        input: [
          "*** Begin Patch",
          "*** Add File: existing.txt",
          "+new",
          "*** End Patch",
        ].join("\n"),
      },
      baseContext,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("目标文件已存在");
    await expect(fs.readFile(path.join(tempDir, "existing.txt"), "utf-8")).resolves.toBe("old\n");
  });

  it("should preserve CRLF line endings when updating an existing file", async () => {
    await fs.writeFile(path.join(tempDir, "crlf.txt"), "alpha\r\nbeta\r\n", "utf-8");

    const result = await applyPatchTool.execute(
      {
        input: [
          "*** Begin Patch",
          "*** Update File: crlf.txt",
          "@@",
          " alpha",
          "-beta",
          "+gamma",
          "*** End Patch",
        ].join("\n"),
      },
      baseContext,
    );

    expect(result.success).toBe(true);
    await expect(fs.readFile(path.join(tempDir, "crlf.txt"), "utf-8")).resolves.toBe("alpha\r\ngamma\r\n");
  });

  it("should stop before applying any writes when abortSignal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort("Stopped by user.");

    const result = await applyPatchTool.execute(
      {
        input: [
          "*** Begin Patch",
          "*** Add File: STOPPED.md",
          "+should not be written",
          "*** End Patch",
        ].join("\n"),
      },
      {
        ...baseContext,
        abortSignal: controller.signal,
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("Stopped by user.");
    expect(result.failureKind).toBe("environment_error");
    await expect(fs.access(path.join(tempDir, "STOPPED.md"))).rejects.toBeDefined();
  });
});
