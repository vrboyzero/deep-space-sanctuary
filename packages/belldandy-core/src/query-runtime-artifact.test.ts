import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleArtifactRevealWithQueryRuntime } from "./query-runtime-artifact.js";

describe("query-runtime-artifact", () => {
  let tempDir: string;
  let generatedDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-artifact-test-"));
    generatedDir = path.join(tempDir, "generated");
    await fs.mkdir(path.join(generatedDir, "images"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("reveals generated artifacts under /generated", async () => {
    const targetPath = path.join(generatedDir, "images", "sample.png");
    await fs.writeFile(targetPath, Buffer.from("png"));
    const revealArtifactPath = vi.fn().mockResolvedValue(undefined);

    const result = await handleArtifactRevealWithQueryRuntime({
      requestId: "artifact-reveal-ok",
      generatedDir,
      isUnderRoot: (root, target) => {
        const relative = path.relative(root, target);
        return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
      },
      revealArtifactPath,
    }, {
      path: "/generated/images/sample.png",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected artifact.reveal to succeed");
    }
    expect(result.payload).toMatchObject({
      revealed: true,
      path: "/generated/images/sample.png",
    });
    expect(revealArtifactPath).toHaveBeenCalledWith(targetPath);
  });

  it("rejects generated artifact paths that escape the generated directory", async () => {
    const revealArtifactPath = vi.fn().mockResolvedValue(undefined);

    const result = await handleArtifactRevealWithQueryRuntime({
      requestId: "artifact-reveal-escape",
      generatedDir,
      isUnderRoot: (root, target) => {
        const relative = path.relative(root, target);
        return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
      },
      revealArtifactPath,
    }, {
      path: "/generated/../secrets.txt",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected artifact.reveal to fail");
    }
    expect(result.error).toMatchObject({
      code: "invalid_path",
    });
    expect(revealArtifactPath).not.toHaveBeenCalled();
  });

  it("rejects generated artifacts whose canonical target escapes through a directory link", async () => {
    const outsideDir = path.join(tempDir, "outside");
    const linkPath = path.join(generatedDir, "escape");
    await fs.mkdir(outsideDir, { recursive: true });
    await fs.writeFile(path.join(outsideDir, "secret.png"), Buffer.from("secret"));
    await fs.symlink(outsideDir, linkPath, process.platform === "win32" ? "junction" : "dir");
    const revealArtifactPath = vi.fn().mockResolvedValue(undefined);

    const result = await handleArtifactRevealWithQueryRuntime({
      requestId: "artifact-reveal-canonical-escape",
      generatedDir,
      isUnderRoot: (root, target) => {
        const relative = path.relative(root, target);
        return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
      },
      revealArtifactPath,
    }, {
      path: "/generated/escape/secret.png",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected artifact.reveal to reject a canonical escape");
    }
    expect(result.error).toMatchObject({ code: "invalid_path" });
    expect(revealArtifactPath).not.toHaveBeenCalled();
  });
});
