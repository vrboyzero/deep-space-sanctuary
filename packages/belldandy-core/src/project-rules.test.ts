import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveProjectRules } from "./project-rules.js";

describe("resolveProjectRules", () => {
  it("discovers AGENTS.md files from the nearest Git root to cwd in precedence order", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-project-rules-"));
    const packageDir = path.join(root, "packages", "core");
    const cwd = path.join(packageDir, "src");

    try {
      await fs.promises.mkdir(path.join(root, ".git"));
      await fs.promises.mkdir(cwd, { recursive: true });
      await fs.promises.writeFile(path.join(root, "AGENTS.md"), "root-rule = shared\n", "utf-8");
      await fs.promises.writeFile(path.join(packageDir, "AGENTS.md"), "root-rule = package\n", "utf-8");

      const canonicalRoot = await fs.promises.realpath(root);
      const canonicalCwd = await fs.promises.realpath(cwd);
      const result = await resolveProjectRules({ cwd });

      expect(result).toMatchObject({
        requestedCwd: path.resolve(cwd),
        cwd: canonicalCwd,
        root: {
          path: canonicalRoot,
          source: "git",
        },
        rules: [
          {
            path: path.join(canonicalRoot, "AGENTS.md"),
            scopeDir: canonicalRoot,
            priority: 0,
            content: "root-rule = shared\n",
            contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
          },
          {
            path: path.join(canonicalRoot, "packages", "core", "AGENTS.md"),
            scopeDir: path.join(canonicalRoot, "packages", "core"),
            priority: 1,
            content: "root-rule = package\n",
            contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
          },
        ],
      });
      expect(result.prompt.text.indexOf("root-rule = shared")).toBeLessThan(
        result.prompt.text.indexOf("root-rule = package"),
      );
      expect(result.prompt.sourceCount).toBe(2);
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  it("uses cwd as a diagnosed fallback root outside Git repositories", async () => {
    const cwd = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-project-rules-no-git-"));

    try {
      await fs.promises.writeFile(path.join(cwd, "AGENTS.md"), "local non-git rule\n", "utf-8");
      const canonicalCwd = await fs.promises.realpath(cwd);

      const result = await resolveProjectRules({ cwd });

      expect(result.root).toEqual({
        path: canonicalCwd,
        source: "cwd-fallback",
      });
      expect(result.rules).toHaveLength(1);
      expect(result.rules[0]).toMatchObject({
        path: path.join(canonicalCwd, "AGENTS.md"),
        content: "local non-git rule\n",
      });
      expect(result.diagnostics).toEqual([
        {
          code: "git_root_not_found",
          severity: "warning",
          path: canonicalCwd,
          message: "No Git root was found; project rule discovery is limited to cwd.",
        },
      ]);
    } finally {
      await fs.promises.rm(cwd, { recursive: true, force: true });
    }
  });

  it("omits oversized rule files with an observable diagnostic", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-project-rules-large-"));
    const cwd = path.join(root, "src");

    try {
      await fs.promises.mkdir(path.join(root, ".git"));
      await fs.promises.mkdir(cwd);
      const oversizedContent = "this rule is too large\n";
      await fs.promises.writeFile(path.join(root, "AGENTS.md"), oversizedContent, "utf-8");
      await fs.promises.writeFile(path.join(cwd, "AGENTS.md"), "local\n", "utf-8");

      const canonicalRoot = await fs.promises.realpath(root);
      const result = await resolveProjectRules({ cwd, maxFileBytes: 8 });

      expect(result.rules).toHaveLength(1);
      expect(result.rules[0]?.content).toBe("local\n");
      expect(result.prompt.text).not.toContain(oversizedContent.trim());
      expect(result.diagnostics).toEqual([
        {
          code: "rule_file_too_large",
          severity: "warning",
          path: path.join(canonicalRoot, "AGENTS.md"),
          message: "Project rule file exceeds the 8 byte limit and was skipped.",
          sizeBytes: Buffer.byteLength(oversizedContent),
          maxBytes: 8,
        },
      ]);
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  it("enforces an observable total rule budget across nested files", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-project-rules-total-"));
    const cwd = path.join(root, "src");

    try {
      await fs.promises.mkdir(path.join(root, ".git"));
      await fs.promises.mkdir(cwd);
      await fs.promises.writeFile(path.join(root, "AGENTS.md"), "root123\n", "utf-8");
      await fs.promises.writeFile(path.join(cwd, "AGENTS.md"), "child12\n", "utf-8");

      const canonicalRoot = await fs.promises.realpath(root);
      const result = await resolveProjectRules({ cwd, maxTotalBytes: 12 });

      expect(result.rules.map((rule) => rule.content)).toEqual(["root123\n"]);
      expect(result.prompt.text).not.toContain("child12");
      expect(result.diagnostics).toEqual([
        {
          code: "rule_total_limit_exceeded",
          severity: "warning",
          path: path.join(canonicalRoot, "src", "AGENTS.md"),
          message: "Project rule files exceed the 12 byte total limit and this file was skipped.",
          sizeBytes: 8,
          loadedBytes: 8,
          maxBytes: 12,
        },
      ]);
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  it("does not follow AGENTS.md symlinks outside the project", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-project-rules-symlink-"));
    const externalDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-project-rules-external-"));

    try {
      await fs.promises.mkdir(path.join(root, ".git"));
      await fs.promises.writeFile(path.join(externalDir, "secret.md"), "external secret rule\n", "utf-8");
      await fs.promises.symlink(externalDir, path.join(root, "AGENTS.md"), "junction");

      const canonicalRoot = await fs.promises.realpath(root);
      const result = await resolveProjectRules({ cwd: root });

      expect(result.rules).toEqual([]);
      expect(result.prompt.text).not.toContain("external secret rule");
      expect(result.diagnostics).toEqual([
        {
          code: "rule_file_symlink",
          severity: "warning",
          path: path.join(canonicalRoot, "AGENTS.md"),
          message: "Project rule symlinks are not followed and this file was skipped.",
        },
      ]);
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
      await fs.promises.rm(externalDir, { recursive: true, force: true });
    }
  });

  it("skips non-regular AGENTS.md paths with a stable diagnostic", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-project-rules-non-file-"));

    try {
      await fs.promises.mkdir(path.join(root, ".git"));
      await fs.promises.mkdir(path.join(root, "AGENTS.md"));

      const canonicalRoot = await fs.promises.realpath(root);
      const result = await resolveProjectRules({ cwd: root });

      expect(result.rules).toEqual([]);
      expect(result.diagnostics).toEqual([
        {
          code: "rule_file_not_regular",
          severity: "warning",
          path: path.join(canonicalRoot, "AGENTS.md"),
          message: "Project rule path is not a regular file and was skipped.",
        },
      ]);
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });
});
