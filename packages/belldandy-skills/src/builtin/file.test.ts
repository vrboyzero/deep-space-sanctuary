import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import type { ToolContext } from "../types.js";

const memoryManager = {
  linkTaskMemoriesFromSource: vi.fn(),
  getTaskByConversation: vi.fn(),
  recordMethodUsage: vi.fn(),
  recordSkillUsage: vi.fn(),
};

vi.mock("@belldandy/memory", () => ({
  getGlobalMemoryManager: () => memoryManager,
}));

const { fileDeleteTool, fileEditTool, fileReadTool, fileWriteTool } = await import("./file.js");

describe("file tools", () => {
  let tempDir: string;
  let baseContext: ToolContext;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
    vi.clearAllMocks();
    baseContext = {
      conversationId: "test-conv",
      workspaceRoot: tempDir,
      policy: {
        allowedPaths: [],
        deniedPaths: [".git", "node_modules"],
        allowedDomains: [],
        deniedDomains: [],
        maxTimeoutMs: 5000,
        maxResponseBytes: 1024,
      },
    };
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("file_read", () => {
    it("describes ranges as bytes and directs truncated reads to nextCursor", () => {
      const properties = fileReadTool.definition.parameters.properties as Record<
        string,
        { description?: string }
      >;

      expect(fileReadTool.definition.description).toContain("字节（不是行数）");
      expect(fileReadTool.definition.description).toContain("truncated=true");
      expect(properties.offset?.description).toContain("字节（不是行数）");
      expect(properties.limit?.description).toContain("字节（不是行数）");
      expect(properties.cursor?.description).toContain("truncated=true");
      expect(fileReadTool.definition.description).toContain("anchor");
      expect(properties.anchor?.description).toContain("精确文本");
      expect(properties.anchor?.description).toContain("大型源码");
    });

    it("should read existing file", async () => {
      const testFile = path.join(tempDir, "test.txt");
      await fs.writeFile(testFile, "Hello, Belldandy!", "utf-8");

      const result = await fileReadTool.execute({ path: "test.txt" }, baseContext);

      expect(result.success).toBe(true);
      const output = JSON.parse(result.output);
      expect(output.content).toBe("Hello, Belldandy!");
      expect(output.path).toBe("test.txt");
    });

    it("returns a stable edit revision that changes when the file changes", async () => {
      const testFile = path.join(tempDir, "revision.txt");
      await fs.writeFile(testFile, "alpha", "utf-8");

      const first = await fileReadTool.execute({ path: "revision.txt" }, baseContext);
      const unchanged = await fileReadTool.execute({ path: "revision.txt" }, baseContext);
      expect(first.success).toBe(true);
      expect(unchanged.success).toBe(true);
      const firstOutput = JSON.parse(first.output);
      const unchangedOutput = JSON.parse(unchanged.output);
      expect(firstOutput.revision).toMatch(/^[a-f0-9]{64}$/u);
      expect(unchangedOutput.revision).toBe(firstOutput.revision);

      let previousRevision = firstOutput.revision;
      for (let index = 0; index < 64; index += 1) {
        await fs.writeFile(testFile, String(index).padStart(5, "0"), "utf-8");
        const changed = await fileReadTool.execute({ path: "revision.txt" }, baseContext);
        expect(changed.success).toBe(true);
        const changedRevision = JSON.parse(changed.output).revision;
        expect(changedRevision).not.toBe(previousRevision);
        previousRevision = changedRevision;
      }
    });

    it("binds edit revisions to the exact real path on case-sensitive filesystems", async () => {
      if (process.platform === "win32") return;

      const upperPath = path.join(tempDir, "CaseBound.txt");
      const lowerPath = path.join(tempDir, "casebound.txt");
      await fs.writeFile(upperPath, "shared inode", "utf-8");
      await fs.link(upperPath, lowerPath);

      const upper = await fileReadTool.execute({ path: "CaseBound.txt" }, baseContext);
      const lower = await fileReadTool.execute({ path: "casebound.txt" }, baseContext);

      expect(upper.success).toBe(true);
      expect(lower.success).toBe(true);
      expect(JSON.parse(upper.output).revision).not.toBe(JSON.parse(lower.output).revision);
    });

    it("should return error for non-existent file", async () => {
      const result = await fileReadTool.execute({ path: "not-exist.txt" }, baseContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("不存在");
      expect(result.failureKind).toBe("input_error");
    });

    it("should block path traversal", async () => {
      const result = await fileReadTool.execute({ path: "../../../etc/passwd" }, baseContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("越界");
    });

    it("should block absolute paths", async () => {
      const result = await fileReadTool.execute({ path: "/etc/passwd" }, baseContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("越界");
    });

    it("should block sensitive files (.env)", async () => {
      const envFile = path.join(tempDir, ".env");
      await fs.writeFile(envFile, "SECRET=123", "utf-8");

      const result = await fileReadTool.execute({ path: ".env" }, baseContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("敏感文件");
      expect(result.failureKind).toBe("permission_or_policy");
    });

    it("should block sensitive files (credentials)", async () => {
      await fs.mkdir(path.join(tempDir, "config"), { recursive: true });
      await fs.writeFile(path.join(tempDir, "config", "credentials.json"), "{}", "utf-8");

      const result = await fileReadTool.execute({ path: "config/credentials.json" }, baseContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("敏感文件");
    });

    it("should block denied paths (.git)", async () => {
      await fs.mkdir(path.join(tempDir, ".git"), { recursive: true });
      await fs.writeFile(path.join(tempDir, ".git", "config"), "test", "utf-8");

      const result = await fileReadTool.execute({ path: ".git/config" }, baseContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("禁止访问");
    });

    it("should truncate large files", async () => {
      const largeContent = "x".repeat(200 * 1024); // 200KB
      await fs.writeFile(path.join(tempDir, "large.txt"), largeContent, "utf-8");

      const result = await fileReadTool.execute(
        { path: "large.txt", maxBytes: 1024 },
        baseContext
      );

      expect(result.success).toBe(true);
      const output = JSON.parse(result.output);
      expect(output.truncated).toBe(true);
      expect(output.bytesRead).toBe(1024);
    });

    it("should read bounded byte ranges and resume with a file-bound cursor", async () => {
      await fs.writeFile(path.join(tempDir, "paged.txt"), "0123456789", "utf-8");
      await fs.writeFile(path.join(tempDir, "other.txt"), "abcdefghij", "utf-8");

      const first = await fileReadTool.execute({
        path: "paged.txt",
        offset: 2,
        limit: 3,
      }, baseContext);

      expect(first.success).toBe(true);
      const firstOutput = JSON.parse(first.output);
      expect(firstOutput).toMatchObject({
        path: "paged.txt",
        size: 10,
        bytesRead: 3,
        content: "234",
        range: { offset: 2, endOffset: 5 },
        truncated: true,
        nextCursor: expect.any(String),
      });

      const second = await fileReadTool.execute({
        path: "paged.txt",
        limit: 3,
        cursor: firstOutput.nextCursor,
      }, baseContext);
      expect(second.success).toBe(true);
      expect(JSON.parse(second.output)).toMatchObject({
        content: "567",
        range: { offset: 5, endOffset: 8 },
        truncated: true,
      });

      const mismatched = await fileReadTool.execute({
        path: "other.txt",
        cursor: firstOutput.nextCursor,
      }, baseContext);
      expect(mismatched.success).toBe(false);
      expect(mismatched.error).toContain("cursor");
      expect(mismatched.failureKind).toBe("input_error");

      await fs.appendFile(path.join(tempDir, "paged.txt"), "x", "utf-8");
      const stale = await fileReadTool.execute({
        path: "paged.txt",
        cursor: firstOutput.nextCursor,
      }, baseContext);
      expect(stale.success).toBe(false);
      expect(stale.error).toContain("cursor");
    });

    it("should read a bounded window around one exact UTF-8 anchor", async () => {
      const prefix = `${"前缀".repeat(80)}\n`;
      const anchor = "func (c *Command) Name() string";
      const suffix = ` {\n\treturn c.Use\n}\n${"suffix".repeat(80)}`;
      await fs.writeFile(path.join(tempDir, "anchored.go"), `${prefix}${anchor}${suffix}`, "utf-8");

      const result = await fileReadTool.execute({
        path: "anchored.go",
        anchor,
        limit: 160,
      }, baseContext);

      expect(result.success).toBe(true);
      const output = JSON.parse(result.output);
      expect(output).toMatchObject({
        anchor: {
          text: anchor,
          byteOffset: Buffer.byteLength(prefix, "utf-8"),
        },
        bytesRead: 160,
        truncated: true,
      });
      expect(output.range.offset).toBeGreaterThan(0);
      expect(output.content).toContain(anchor);
    });

    it("should fail closed when an anchor is absent or ambiguous", async () => {
      await fs.writeFile(path.join(tempDir, "anchors.txt"), "same\nmiddle\nsame\n", "utf-8");

      const absent = await fileReadTool.execute({
        path: "anchors.txt",
        anchor: "missing",
      }, baseContext);
      expect(absent).toMatchObject({ success: false, failureKind: "input_error" });
      expect(absent.error).toContain("anchor");
      expect(absent.error).toContain("未找到");

      const ambiguous = await fileReadTool.execute({
        path: "anchors.txt",
        anchor: "same",
      }, baseContext);
      expect(ambiguous).toMatchObject({ success: false, failureKind: "input_error" });
      expect(ambiguous.error).toContain("anchor");
      expect(ambiguous.error).toContain("2");
    });

    it("should reject anchor with offset, cursor, or base64 encoding", async () => {
      await fs.writeFile(path.join(tempDir, "anchor-input.txt"), "target", "utf-8");

      for (const args of [
        { path: "anchor-input.txt", anchor: "target", offset: 0 },
        { path: "anchor-input.txt", anchor: "target", cursor: "cursor" },
        { path: "anchor-input.txt", anchor: "target", encoding: "base64" },
        { path: "anchor-input.txt", anchor: "target", limit: 3 },
        { path: "anchor-input.txt", anchor: "" },
        { path: "anchor-input.txt", anchor: "\uD800" },
      ]) {
        const result = await fileReadTool.execute(args, baseContext);
        expect(result).toMatchObject({ success: false, failureKind: "input_error" });
        expect(result.error).toContain("anchor");
      }
    });

    it("should reject anchor scans beyond the bounded file size", async () => {
      const oversizedPath = path.join(tempDir, "oversized-anchor.txt");
      await fs.writeFile(oversizedPath, "target", "utf-8");
      await fs.truncate(oversizedPath, (16 * 1024 * 1024) + 1);

      const result = await fileReadTool.execute({
        path: "oversized-anchor.txt",
        anchor: "target",
      }, baseContext);

      expect(result).toMatchObject({ success: false, failureKind: "input_error" });
      expect(result.error).toContain("anchor");
      expect(result.error).toContain(String(16 * 1024 * 1024));
    });

    it("should reject an offset beyond the file size", async () => {
      await fs.writeFile(path.join(tempDir, "short.txt"), "short", "utf-8");

      const result = await fileReadTool.execute({ path: "short.txt", offset: 6 }, baseContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("offset");
      expect(result.failureKind).toBe("input_error");
    });

    it("should reject direct symlink targets when the platform allows creating them", async () => {
      const target = path.join(tempDir, "target.txt");
      const link = path.join(tempDir, "linked.txt");
      await fs.writeFile(target, "target", "utf-8");
      try {
        await fs.symlink(target, link, "file");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EPERM") return;
        throw error;
      }

      const result = await fileReadTool.execute({ path: "linked.txt" }, baseContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("符号链接");
      expect(result.failureKind).toBe("permission_or_policy");
    });

    it("should read nested files", async () => {
      await fs.mkdir(path.join(tempDir, "a", "b", "c"), { recursive: true });
      await fs.writeFile(path.join(tempDir, "a", "b", "c", "deep.txt"), "deep content", "utf-8");

      const result = await fileReadTool.execute({ path: "a/b/c/deep.txt" }, baseContext);

      expect(result.success).toBe(true);
      const output = JSON.parse(result.output);
      expect(output.content).toBe("deep content");
    });

    it("should enforce cwd isolation for relative file reads", async () => {
      const isolatedRoot = path.join(tempDir, "isolated");
      await fs.mkdir(isolatedRoot, { recursive: true });
      await fs.writeFile(path.join(isolatedRoot, "inside.txt"), "inside", "utf-8");
      await fs.writeFile(path.join(tempDir, "outside.txt"), "outside", "utf-8");

      const isolatedContext: ToolContext = {
        ...baseContext,
        defaultCwd: isolatedRoot,
        launchSpec: {
          isolationMode: "cwd",
        },
      };

      const insideResult = await fileReadTool.execute({ path: "inside.txt" }, isolatedContext);
      expect(insideResult.success).toBe(true);
      expect(JSON.parse(insideResult.output).content).toBe("inside");

      const outsideResult = await fileReadTool.execute({ path: "../outside.txt" }, isolatedContext);
      expect(outsideResult.success).toBe(false);
      expect(outsideResult.error).toContain("越界");
    });

    it("should link used memory for MEMORY.md and memory/* reads", async () => {
      await fs.writeFile(path.join(tempDir, "MEMORY.md"), "# Memory", "utf-8");

      const rootMemoryResult = await fileReadTool.execute({ path: "MEMORY.md" }, baseContext);
      expect(rootMemoryResult.success).toBe(true);
      expect(memoryManager.linkTaskMemoriesFromSource).toHaveBeenCalledWith(
        "test-conv",
        "MEMORY.md",
        "used",
      );

      await fs.mkdir(path.join(tempDir, "memory"), { recursive: true });
      await fs.writeFile(path.join(tempDir, "memory", "2026-03-15.md"), "# 2026-03-15", "utf-8");

      const dailyMemoryResult = await fileReadTool.execute({ path: "memory/2026-03-15.md" }, baseContext);
      expect(dailyMemoryResult.success).toBe(true);
      expect(memoryManager.linkTaskMemoriesFromSource).toHaveBeenCalledWith(
        "test-conv",
        "memory/2026-03-15.md",
        "used",
      );
    });

    it("should not link non-memory file reads", async () => {
      await fs.writeFile(path.join(tempDir, "notes.txt"), "plain notes", "utf-8");

      const result = await fileReadTool.execute({ path: "notes.txt" }, baseContext);

      expect(result.success).toBe(true);
      expect(memoryManager.linkTaskMemoriesFromSource).not.toHaveBeenCalled();
    });

    it("should record method usage when reading methods/*.md through file_read", async () => {
      await fs.mkdir(path.join(tempDir, "methods"), { recursive: true });
      await fs.writeFile(path.join(tempDir, "methods", "网页自动化基础.md"), "# 方法\n\n内容", "utf-8");
      memoryManager.getTaskByConversation.mockReturnValue({
        id: "task-file-method-1",
        conversationId: "test-conv",
      });

      const result = await fileReadTool.execute({ path: "methods/网页自动化基础.md" }, baseContext);

      expect(result.success).toBe(true);
      expect(memoryManager.recordMethodUsage).toHaveBeenCalledWith("task-file-method-1", "网页自动化基础.md", {
        usedVia: "tool",
      });
    });

    it("should record skill usage when reading skills/**/SKILL.md through file_read", async () => {
      await fs.mkdir(path.join(tempDir, "skills", "web-auto"), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, "skills", "web-auto", "SKILL.md"),
        `---
name: 网页自动化 Skill
description: 用于网页自动化任务
---

1. 打开浏览器
2. 执行网页自动化`,
        "utf-8",
      );
      memoryManager.getTaskByConversation.mockReturnValue({
        id: "task-file-skill-1",
        conversationId: "test-conv",
      });

      const result = await fileReadTool.execute({ path: "skills/web-auto/SKILL.md" }, baseContext);

      expect(result.success).toBe(true);
      expect(memoryManager.recordSkillUsage).toHaveBeenCalledWith("task-file-skill-1", "网页自动化 Skill", {
        usedVia: "tool",
      });
    });

    it("should record method usage when reading an absolute file under extraWorkspaceRoots", async () => {
      const methodsRoot = path.join(tempDir, "external-methods");
      const methodPath = path.join(methodsRoot, "methods", "跨根目录方法.md");
      await fs.mkdir(path.dirname(methodPath), { recursive: true });
      await fs.writeFile(methodPath, "# 方法\n\n跨根目录内容", "utf-8");
      memoryManager.getTaskByConversation.mockReturnValue({
        id: "task-file-method-extra-1",
        conversationId: "test-conv",
      });

      const result = await fileReadTool.execute({
        path: methodPath,
      }, {
        ...baseContext,
        extraWorkspaceRoots: [methodsRoot],
      });

      expect(result.success).toBe(true);
      expect(memoryManager.recordMethodUsage).toHaveBeenCalledWith("task-file-method-extra-1", "跨根目录方法.md", {
        usedVia: "tool",
      });
    });

    it("should record skill usage when reading an absolute SKILL.md under extraWorkspaceRoots", async () => {
      const skillsRoot = path.join(tempDir, "external-skills");
      const skillPath = path.join(skillsRoot, "web-auto", "SKILL.md");
      await fs.mkdir(path.dirname(skillPath), { recursive: true });
      await fs.writeFile(
        skillPath,
        `---
name: 跨根目录 Skill
description: 通过额外根目录读取
---

1. 打开浏览器
2. 执行自动化`,
        "utf-8",
      );
      memoryManager.getTaskByConversation.mockReturnValue({
        id: "task-file-skill-extra-1",
        conversationId: "test-conv",
      });

      const result = await fileReadTool.execute({
        path: skillPath,
      }, {
        ...baseContext,
        extraWorkspaceRoots: [skillsRoot],
      });

      expect(result.success).toBe(true);
      expect(memoryManager.recordSkillUsage).toHaveBeenCalledWith("task-file-skill-extra-1", "跨根目录 Skill", {
        usedVia: "tool",
      });
    });
  });

  describe("file_write", () => {
    it("should write new file", async () => {
      const result = await fileWriteTool.execute(
        { path: "output.txt", content: "Hello, World!" },
        baseContext
      );

      expect(result.success).toBe(true);
      const content = await fs.readFile(path.join(tempDir, "output.txt"), "utf-8");
      expect(content).toBe("Hello, World!");
    });

    it("should overwrite existing file", async () => {
      await fs.writeFile(path.join(tempDir, "existing.txt"), "old content", "utf-8");

      const result = await fileWriteTool.execute(
        { path: "existing.txt", content: "new content" },
        baseContext
      );

      expect(result.success).toBe(true);
      const content = await fs.readFile(path.join(tempDir, "existing.txt"), "utf-8");
      expect(content).toBe("new content");
    });

    it("prepares a workspace revision before writing and commits the resulting hash after success", async () => {
      await fs.writeFile(path.join(tempDir, "tracked.txt"), "before", "utf-8");
      const workspaceMutationObserver = {
        prepareMutations: vi.fn(async () => {}),
        commitMutations: vi.fn(async () => {}),
      };

      const result = await fileWriteTool.execute(
        { path: "tracked.txt", content: "after" },
        {
          ...baseContext,
          workspaceRevisionId: "gateway-run-1",
          agentRunId: "gateway-run-1",
          toolCallId: "tool-file-write-1",
          workspaceMutationObserver,
        },
      );

      expect(result.success).toBe(true);
      expect(workspaceMutationObserver.prepareMutations).toHaveBeenCalledWith(expect.objectContaining({
        workspaceRevisionId: "gateway-run-1",
        toolName: "file_write",
        operation: {
          conversationId: baseContext.conversationId,
          agentRunId: "gateway-run-1",
          toolCallId: "tool-file-write-1",
        },
        targets: [{ absolutePath: path.join(tempDir, "tracked.txt"), relativePath: "tracked.txt" }],
      }));
      expect(workspaceMutationObserver.commitMutations).toHaveBeenCalledWith(expect.objectContaining({
        operation: {
          conversationId: baseContext.conversationId,
          agentRunId: "gateway-run-1",
          toolCallId: "tool-file-write-1",
        },
      }));
    });

    it("does not create a workspace revision when replace validation rejects the write", async () => {
      await fs.writeFile(path.join(tempDir, "no-match.txt"), "before", "utf-8");
      const workspaceMutationObserver = {
        prepareMutations: vi.fn(async () => {}),
        commitMutations: vi.fn(async () => {}),
      };

      const result = await fileWriteTool.execute(
        { path: "no-match.txt", content: "after", mode: "replace", regex: "missing" },
        {
          ...baseContext,
          workspaceRevisionId: "gateway-run-invalid-write",
          workspaceMutationObserver,
        },
      );

      expect(result.success).toBe(false);
      expect(workspaceMutationObserver.prepareMutations).not.toHaveBeenCalled();
      expect(workspaceMutationObserver.commitMutations).not.toHaveBeenCalled();
    });

    it("should append to file", async () => {
      await fs.writeFile(path.join(tempDir, "append.txt"), "line1\n", "utf-8");

      const result = await fileWriteTool.execute(
        { path: "append.txt", content: "line2\n", mode: "append" },
        baseContext
      );

      expect(result.success).toBe(true);
      const content = await fs.readFile(path.join(tempDir, "append.txt"), "utf-8");
      expect(content).toBe("line1\nline2\n");
    });

    it("should replace a line range and preserve CRLF line endings", async () => {
      await fs.writeFile(path.join(tempDir, "replace-crlf.txt"), "line1\r\nline2\r\nline3\r\n", "utf-8");

      const result = await fileWriteTool.execute(
        {
          path: "replace-crlf.txt",
          content: "middle",
          mode: "replace",
          startLine: 2,
          endLine: 2,
        },
        baseContext,
      );

      expect(result.success).toBe(true);
      await expect(fs.readFile(path.join(tempDir, "replace-crlf.txt"), "utf-8")).resolves.toBe("line1\r\nmiddle\r\nline3\r\n");
    });

    it("should replace content by regex", async () => {
      await fs.writeFile(path.join(tempDir, "replace-regex.txt"), "name=old\nname=older\n", "utf-8");

      const result = await fileWriteTool.execute(
        {
          path: "replace-regex.txt",
          content: "name=new",
          mode: "replace",
          regex: "^name=.*$",
          regexFlags: "m",
        },
        baseContext,
      );

      expect(result.success).toBe(true);
      await expect(fs.readFile(path.join(tempDir, "replace-regex.txt"), "utf-8")).resolves.toBe("name=new\nname=older\n");
    });

    it("should reject regex replace patterns with high ReDoS risk", async () => {
      await fs.writeFile(path.join(tempDir, "replace-regex-risky.txt"), "aaaaaaaaaaaaaaaaaaaa!", "utf-8");

      const result = await fileWriteTool.execute(
        {
          path: "replace-regex-risky.txt",
          content: "safe",
          mode: "replace",
          regex: "(a+)+$",
          regexFlags: "",
        },
        baseContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("高回溯风险");
      expect(result.failureKind).toBe("permission_or_policy");
    });

    it("should reject regex replace on oversized text files", async () => {
      await fs.writeFile(path.join(tempDir, "replace-regex-large.txt"), `name=old\n${"a".repeat(260_000)}`, "utf-8");

      const result = await fileWriteTool.execute(
        {
          path: "replace-regex-large.txt",
          content: "name=new",
          mode: "replace",
          regex: "^name=.*$",
          regexFlags: "m",
        },
        baseContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("文本过大");
      expect(result.failureKind).toBe("permission_or_policy");
    });

    it("should insert content after the requested line", async () => {
      await fs.writeFile(path.join(tempDir, "insert.txt"), "alpha\nbeta\ngamma\n", "utf-8");

      const result = await fileWriteTool.execute(
        {
          path: "insert.txt",
          content: "between",
          mode: "insert",
          line: 2,
          position: "after",
        },
        baseContext,
      );

      expect(result.success).toBe(true);
      await expect(fs.readFile(path.join(tempDir, "insert.txt"), "utf-8")).resolves.toBe("alpha\nbeta\nbetween\ngamma\n");
    });

    it("should create parent directories", async () => {
      const result = await fileWriteTool.execute(
        { path: "new/nested/dir/file.txt", content: "nested!" },
        baseContext
      );

      expect(result.success).toBe(true);
      const content = await fs.readFile(path.join(tempDir, "new/nested/dir/file.txt"), "utf-8");
      expect(content).toBe("nested!");
    });

    it("should block path traversal", async () => {
      const result = await fileWriteTool.execute(
        { path: "../outside.txt", content: "malicious" },
        baseContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("越界");
    });

    it("should block sensitive paths", async () => {
      const result = await fileWriteTool.execute(
        { path: ".env.local", content: "SECRET=hack" },
        baseContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("敏感文件");
    });

    it("should enforce allowedPaths whitelist", async () => {
      const restrictedContext: ToolContext = {
        ...baseContext,
        policy: {
          ...baseContext.policy,
          allowedPaths: ["output", "tmp"],
        },
      };

      // 不在白名单中
      const result1 = await fileWriteTool.execute(
        { path: "forbidden/file.txt", content: "test" },
        restrictedContext
      );
      expect(result1.success).toBe(false);
      expect(result1.error).toContain("白名单");
      expect(result1.failureKind).toBe("permission_or_policy");

      // 在白名单中
      const result2 = await fileWriteTool.execute(
        { path: "output/file.txt", content: "allowed" },
        restrictedContext
      );
      expect(result2.success).toBe(true);
    });

    it("should block denied paths", async () => {
      const result = await fileWriteTool.execute(
        { path: "node_modules/malicious.js", content: "bad code" },
        baseContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("禁止写入");
    });

    it("should write relative paths under cwd isolation root", async () => {
      const isolatedRoot = path.join(tempDir, "isolated-write");
      await fs.mkdir(isolatedRoot, { recursive: true });

      const isolatedContext: ToolContext = {
        ...baseContext,
        defaultCwd: isolatedRoot,
        launchSpec: {
          isolationMode: "cwd",
        },
      };

      const result = await fileWriteTool.execute(
        { path: "nested/output.txt", content: "isolated" },
        isolatedContext,
      );

      expect(result.success).toBe(true);
      await expect(fs.readFile(path.join(isolatedRoot, "nested", "output.txt"), "utf-8")).resolves.toBe("isolated");
      await expect(fs.access(path.join(tempDir, "nested", "output.txt"))).rejects.toThrow();
    });
  });

  describe("file_edit", () => {
    it("requires a read revision before editing and leaves the file unchanged", async () => {
      const targetPath = path.join(tempDir, "exact-edit.txt");
      await fs.writeFile(targetPath, "before value\n", "utf-8");

      const result = await fileEditTool.execute({
        path: "exact-edit.txt",
        oldText: "before",
        newText: "after",
      }, baseContext);

      expect(result.success).toBe(false);
      expect(result.failureKind).toBe("input_error");
      expect(result.error).toContain("revision");
      expect(JSON.parse(result.output)).toEqual({
        code: "read_revision_required",
        path: "exact-edit.txt",
        repairHint: {
          tool: "file_read",
          arguments: { path: "exact-edit.txt" },
          reason: "read_before_edit",
        },
      });
      await expect(fs.readFile(targetPath, "utf-8")).resolves.toBe("before value\n");
    });

    it("rejects a stale read revision before preparing a mutation", async () => {
      const targetPath = path.join(tempDir, "stale-edit.txt");
      await fs.writeFile(targetPath, "original value\n", "utf-8");
      const readResult = await fileReadTool.execute({ path: "stale-edit.txt" }, baseContext);
      const revision = JSON.parse(readResult.output).revision;
      await fs.writeFile(targetPath, "current value\n", "utf-8");
      const workspaceMutationObserver = {
        prepareMutations: vi.fn(async () => {}),
        commitMutations: vi.fn(async () => {}),
      };

      const result = await fileEditTool.execute({
        path: "stale-edit.txt",
        oldText: "current",
        newText: "edited",
        revision,
      }, {
        ...baseContext,
        workspaceRevisionId: "gateway-run-stale-edit",
        workspaceMutationObserver,
      });

      expect(result.success).toBe(false);
      expect(result.failureKind).toBe("business_logic_error");
      expect(JSON.parse(result.output)).toEqual({
        code: "stale_file",
        path: "stale-edit.txt",
        repairHint: {
          tool: "file_read",
          arguments: { path: "stale-edit.txt" },
          reason: "stale_file",
        },
      });
      expect(workspaceMutationObserver.prepareMutations).not.toHaveBeenCalled();
      expect(workspaceMutationObserver.commitMutations).not.toHaveBeenCalled();
      await expect(fs.readFile(targetPath, "utf-8")).resolves.toBe("current value\n");
    });

    it("returns a structured repair hint when the old text is absent", async () => {
      const targetPath = path.join(tempDir, "missing-edit.txt");
      await fs.writeFile(targetPath, "alpha beta\n", "utf-8");
      const readResult = await fileReadTool.execute({ path: "missing-edit.txt" }, baseContext);
      const revision = JSON.parse(readResult.output).revision;
      const workspaceMutationObserver = {
        prepareMutations: vi.fn(async () => {}),
        commitMutations: vi.fn(async () => {}),
      };

      const result = await fileEditTool.execute({
        path: "missing-edit.txt",
        oldText: "gamma",
        newText: "delta",
        revision,
      }, {
        ...baseContext,
        workspaceRevisionId: "gateway-run-missing-edit",
        workspaceMutationObserver,
      });

      expect(result.success).toBe(false);
      expect(result.failureKind).toBe("business_logic_error");
      expect(JSON.parse(result.output)).toEqual({
        code: "old_text_not_found",
        path: "missing-edit.txt",
        matchCount: 0,
        repairHint: {
          tool: "file_read",
          arguments: { path: "missing-edit.txt" },
          reason: "old_text_not_found",
        },
      });
      expect(workspaceMutationObserver.prepareMutations).not.toHaveBeenCalled();
      expect(workspaceMutationObserver.commitMutations).not.toHaveBeenCalled();
      await expect(fs.readFile(targetPath, "utf-8")).resolves.toBe("alpha beta\n");
    });

    it("rejects non-unique old text and reports the exact match count", async () => {
      const targetPath = path.join(tempDir, "ambiguous-edit.txt");
      await fs.writeFile(targetPath, "alpha alpha alpha\n", "utf-8");
      const readResult = await fileReadTool.execute({ path: "ambiguous-edit.txt" }, baseContext);
      const revision = JSON.parse(readResult.output).revision;
      const workspaceMutationObserver = {
        prepareMutations: vi.fn(async () => {}),
        commitMutations: vi.fn(async () => {}),
      };

      const result = await fileEditTool.execute({
        path: "ambiguous-edit.txt",
        oldText: "alpha",
        newText: "delta",
        revision,
      }, {
        ...baseContext,
        workspaceRevisionId: "gateway-run-ambiguous-edit",
        workspaceMutationObserver,
      });

      expect(result.success).toBe(false);
      expect(result.failureKind).toBe("business_logic_error");
      expect(JSON.parse(result.output)).toEqual({
        code: "old_text_not_unique",
        path: "ambiguous-edit.txt",
        matchCount: 3,
        repairHint: {
          tool: "file_read",
          arguments: { path: "ambiguous-edit.txt" },
          reason: "old_text_not_unique",
        },
      });
      expect(workspaceMutationObserver.prepareMutations).not.toHaveBeenCalled();
      expect(workspaceMutationObserver.commitMutations).not.toHaveBeenCalled();
      await expect(fs.readFile(targetPath, "utf-8")).resolves.toBe("alpha alpha alpha\n");
    });

    it("replaces the unique match between workspace revision prepare and commit", async () => {
      const targetPath = path.join(tempDir, "successful-edit.txt");
      await fs.writeFile(targetPath, "alpha old omega\n", "utf-8");
      const readResult = await fileReadTool.execute({ path: "successful-edit.txt" }, baseContext);
      const revision = JSON.parse(readResult.output).revision;
      const callOrder: string[] = [];
      const workspaceMutationObserver = {
        prepareMutations: vi.fn(async () => {
          callOrder.push("prepare");
          await expect(fs.readFile(targetPath, "utf-8")).resolves.toBe("alpha old omega\n");
        }),
        commitMutations: vi.fn(async () => {
          callOrder.push("commit");
          await expect(fs.readFile(targetPath, "utf-8")).resolves.toBe("alpha new omega\n");
        }),
      };

      const result = await fileEditTool.execute({
        path: "successful-edit.txt",
        oldText: "old",
        newText: "new",
        revision,
      }, {
        ...baseContext,
        workspaceRevisionId: "gateway-run-successful-edit",
        agentRunId: "gateway-run-successful-edit",
        toolCallId: "tool-file-edit-1",
        workspaceMutationObserver,
      });

      expect(result.success).toBe(true);
      expect(JSON.parse(result.output)).toEqual({
        path: "successful-edit.txt",
        replacements: 1,
        bytesWritten: Buffer.byteLength("alpha new omega\n", "utf-8"),
        totalSize: Buffer.byteLength("alpha new omega\n", "utf-8"),
      });
      expect(callOrder).toEqual(["prepare", "commit"]);
      expect(workspaceMutationObserver.prepareMutations).toHaveBeenCalledWith(expect.objectContaining({
        workspaceRevisionId: "gateway-run-successful-edit",
        workspaceRoot: tempDir,
        toolName: "file_edit",
        operation: {
          conversationId: baseContext.conversationId,
          agentRunId: "gateway-run-successful-edit",
          toolCallId: "tool-file-edit-1",
        },
        targets: [{ absolutePath: targetPath, relativePath: "successful-edit.txt" }],
      }));
      expect(workspaceMutationObserver.commitMutations).toHaveBeenCalledWith(expect.objectContaining({
        workspaceRevisionId: "gateway-run-successful-edit",
        toolName: "file_edit",
      }));
      await expect(fs.readFile(targetPath, "utf-8")).resolves.toBe("alpha new omega\n");
    });

    it("rejects overlapping old text as ambiguous", async () => {
      const targetPath = path.join(tempDir, "overlap-edit.txt");
      await fs.writeFile(targetPath, "aaa", "utf-8");
      const readResult = await fileReadTool.execute({ path: "overlap-edit.txt" }, baseContext);

      const result = await fileEditTool.execute({
        path: "overlap-edit.txt",
        oldText: "aa",
        newText: "b",
        revision: JSON.parse(readResult.output).revision,
      }, baseContext);

      expect(result.success).toBe(false);
      expect(JSON.parse(result.output)).toMatchObject({
        code: "old_text_not_unique",
        matchCount: 2,
      });
      await expect(fs.readFile(targetPath, "utf-8")).resolves.toBe("aaa");
    });

    it("rejects invalid UTF-8 before preparing a mutation", async () => {
      const targetPath = path.join(tempDir, "invalid-utf8.txt");
      await fs.writeFile(targetPath, Buffer.from([0xc3, 0x28]));
      const readResult = await fileReadTool.execute({ path: "invalid-utf8.txt" }, baseContext);
      const workspaceMutationObserver = {
        prepareMutations: vi.fn(async () => {}),
        commitMutations: vi.fn(async () => {}),
      };

      const result = await fileEditTool.execute({
        path: "invalid-utf8.txt",
        oldText: "(",
        newText: ")",
        revision: JSON.parse(readResult.output).revision,
      }, { ...baseContext, workspaceMutationObserver });

      expect(result.success).toBe(false);
      expect(result.failureKind).toBe("input_error");
      expect(JSON.parse(result.output)).toMatchObject({ code: "invalid_utf8" });
      expect(workspaceMutationObserver.prepareMutations).not.toHaveBeenCalled();
      expect(workspaceMutationObserver.commitMutations).not.toHaveBeenCalled();
      await expect(fs.readFile(targetPath)).resolves.toEqual(Buffer.from([0xc3, 0x28]));
    });

    it("edits an absolute file under an explicit extra workspace root", async () => {
      const extraRoot = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-edit-extra-"));
      try {
        const targetPath = path.join(extraRoot, "extra-edit.txt");
        await fs.writeFile(targetPath, "before", "utf-8");
        const context = { ...baseContext, extraWorkspaceRoots: [extraRoot] };
        const readResult = await fileReadTool.execute({ path: targetPath }, context);
        const workspaceMutationObserver = {
          prepareMutations: vi.fn(async () => {}),
          commitMutations: vi.fn(async () => {}),
        };

        const result = await fileEditTool.execute({
          path: targetPath,
          oldText: "before",
          newText: "after",
          revision: JSON.parse(readResult.output).revision,
        }, {
          ...context,
          workspaceRevisionId: "gateway-run-extra-edit",
          workspaceMutationObserver,
        });

        expect(result.success).toBe(true);
        expect(JSON.parse(result.output).path).toBe("extra-edit.txt");
        expect(workspaceMutationObserver.prepareMutations).toHaveBeenCalledWith(expect.objectContaining({
          workspaceRoot: extraRoot,
        }));
        await expect(fs.readFile(targetPath, "utf-8")).resolves.toBe("after");
      } finally {
        await fs.rm(extraRoot, { recursive: true, force: true });
      }
    });

    it("enforces the write allowlist before preparing a mutation", async () => {
      const targetPath = path.join(tempDir, "blocked", "exact-edit.txt");
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, "before", "utf-8");
      const readResult = await fileReadTool.execute({ path: "blocked/exact-edit.txt" }, baseContext);
      const workspaceMutationObserver = {
        prepareMutations: vi.fn(async () => {}),
        commitMutations: vi.fn(async () => {}),
      };

      const result = await fileEditTool.execute({
        path: "blocked/exact-edit.txt",
        oldText: "before",
        newText: "after",
        revision: JSON.parse(readResult.output).revision,
      }, {
        ...baseContext,
        policy: { ...baseContext.policy, allowedPaths: ["allowed"] },
        workspaceMutationObserver,
      });

      expect(result.success).toBe(false);
      expect(result.failureKind).toBe("permission_or_policy");
      expect(JSON.parse(result.output)).toMatchObject({ code: "path_not_allowed" });
      expect(workspaceMutationObserver.prepareMutations).not.toHaveBeenCalled();
      expect(workspaceMutationObserver.commitMutations).not.toHaveBeenCalled();
      await expect(fs.readFile(targetPath, "utf-8")).resolves.toBe("before");
    });

    it("rejects a direct symlink even when its revision belongs to the linked target", async () => {
      const targetPath = path.join(tempDir, "symlink-target.txt");
      const linkPath = path.join(tempDir, "symlink-edit.txt");
      await fs.writeFile(targetPath, "before", "utf-8");
      try {
        await fs.symlink(targetPath, linkPath, "file");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EPERM") return;
        throw error;
      }
      const readResult = await fileReadTool.execute({ path: "symlink-target.txt" }, baseContext);
      const workspaceMutationObserver = {
        prepareMutations: vi.fn(async () => {}),
        commitMutations: vi.fn(async () => {}),
      };

      const result = await fileEditTool.execute({
        path: "symlink-edit.txt",
        oldText: "before",
        newText: "after",
        revision: JSON.parse(readResult.output).revision,
      }, { ...baseContext, workspaceMutationObserver });

      expect(result.success).toBe(false);
      expect(result.failureKind).toBe("permission_or_policy");
      expect(JSON.parse(result.output)).toMatchObject({ code: "symlink_denied" });
      expect(workspaceMutationObserver.prepareMutations).not.toHaveBeenCalled();
      expect(workspaceMutationObserver.commitMutations).not.toHaveBeenCalled();
      await expect(fs.readFile(targetPath, "utf-8")).resolves.toBe("before");
    });
  });

  describe("file_delete", () => {
    it("prepares and commits a workspace revision around deletion", async () => {
      await fs.writeFile(path.join(tempDir, "tracked-delete.txt"), "before", "utf-8");
      const workspaceMutationObserver = {
        prepareMutations: vi.fn(async () => {}),
        commitMutations: vi.fn(async () => {}),
      };

      const result = await fileDeleteTool.execute(
        { path: "tracked-delete.txt" },
        {
          ...baseContext,
          workspaceRevisionId: "gateway-run-2",
          workspaceMutationObserver,
        },
      );

      expect(result.success).toBe(true);
      expect(workspaceMutationObserver.prepareMutations).toHaveBeenCalledTimes(1);
      expect(workspaceMutationObserver.commitMutations).toHaveBeenCalledTimes(1);
    });

    it("should enforce allowedPaths whitelist", async () => {
      await fs.mkdir(path.join(tempDir, "allowed"), { recursive: true });
      await fs.mkdir(path.join(tempDir, "blocked"), { recursive: true });
      await fs.writeFile(path.join(tempDir, "allowed", "ok.txt"), "ok", "utf-8");
      await fs.writeFile(path.join(tempDir, "blocked", "no.txt"), "no", "utf-8");

      const restrictedContext: ToolContext = {
        ...baseContext,
        policy: {
          ...baseContext.policy,
          allowedPaths: ["allowed"],
        },
      };

      const blockedResult = await fileDeleteTool.execute(
        { path: "blocked/no.txt" },
        restrictedContext,
      );
      expect(blockedResult.success).toBe(false);
      expect(blockedResult.error).toContain("白名单");
      expect(blockedResult.failureKind).toBe("permission_or_policy");

      const allowedResult = await fileDeleteTool.execute(
        { path: "allowed/ok.txt" },
        restrictedContext,
      );
      expect(allowedResult.success).toBe(true);
      await expect(fs.access(path.join(tempDir, "allowed", "ok.txt"))).rejects.toThrow();
    });
  });

  describe("tool definitions", () => {
    it("file_read should have correct definition", () => {
      expect(fileReadTool.definition.name).toBe("file_read");
      expect(fileReadTool.definition.parameters.required).toContain("path");
    });

    it("file_write should have correct definition", () => {
      expect(fileWriteTool.definition.name).toBe("file_write");
      expect(fileWriteTool.definition.parameters.required).toContain("path");
      expect(fileWriteTool.definition.parameters.required).toContain("content");
    });
  });
});
