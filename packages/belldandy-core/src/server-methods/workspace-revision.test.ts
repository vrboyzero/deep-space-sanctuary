import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { WorkspaceRevisionRuntime } from "../workspace-revision.js";
import { handleWorkspaceRevisionMethod } from "./workspace-revision.js";

describe("workspace revision Gateway methods", () => {
  it("lists checkpoints, previews by default, and writes only with apply: true", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-workspace-revision-method-"));
    try {
      const workspaceRoot = path.join(rootDir, "workspace");
      const stateDir = path.join(rootDir, "state");
      const filePath = path.join(workspaceRoot, "note.txt");
      await fs.mkdir(workspaceRoot, { recursive: true });
      await fs.writeFile(filePath, "before", "utf-8");
      const runtime = new WorkspaceRevisionRuntime({ stateDir });
      const targets = [{ absolutePath: filePath, relativePath: "note.txt" }];
      await runtime.prepareMutations({ revisionId: "gateway-run-1", workspaceRoot, toolName: "file_write", targets });
      await fs.writeFile(filePath, "after", "utf-8");
      await runtime.commitMutations({ revisionId: "gateway-run-1", workspaceRoot, toolName: "file_write", targets });

      await expect(handleWorkspaceRevisionMethod(
        { type: "req", id: "list", method: "workspace.revision.list" },
        { runtime },
      )).resolves.toMatchObject({ ok: true, payload: { checkpoints: [expect.objectContaining({ revisionId: "gateway-run-1" })] } });

      const preview = await handleWorkspaceRevisionMethod(
        { type: "req", id: "preview", method: "workspace.revision.preview", params: { revisionId: "gateway-run-1" } },
        { runtime },
      );
      expect(preview).toMatchObject({ ok: true, payload: { canRestore: true, changes: [expect.objectContaining({ action: "restore" })] } });

      const dryRun = await handleWorkspaceRevisionMethod(
        { type: "req", id: "restore-preview", method: "workspace.revision.restore", params: { revisionId: "gateway-run-1" } },
        { runtime },
      );
      expect(dryRun).toMatchObject({ ok: true, payload: { applied: false } });
      await expect(fs.readFile(filePath, "utf-8")).resolves.toBe("after");

      const restored = await handleWorkspaceRevisionMethod(
        { type: "req", id: "restore", method: "workspace.revision.restore", params: { revisionId: "gateway-run-1", apply: true } },
        { runtime },
      );
      expect(restored).toMatchObject({ ok: true, payload: { applied: true } });
      await expect(fs.readFile(filePath, "utf-8")).resolves.toBe("before");
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
});
