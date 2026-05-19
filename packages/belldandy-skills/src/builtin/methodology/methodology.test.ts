import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ToolContext } from "../../types.js";
import { methodListTool } from "./list.js";
import { methodReadTool } from "./read.js";
import { methodCreateTool } from "./create.js";
import { methodSearchTool } from "./search.js";
import { isValidMethodFilename, resolveMethodsDir, resolveStateDir } from "./dir.js";
import { parseMethodContent } from "./meta.js";

describe("methodology tools", () => {
    let stateDir: string;
    let context: ToolContext;

    beforeEach(async () => {
        stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-methods-"));
        context = {
            conversationId: "test-conversation",
            workspaceRoot: stateDir,
            policy: {
                allowedPaths: [],
                deniedPaths: [],
                allowedDomains: [],
                deniedDomains: [],
                maxTimeoutMs: 1000,
                maxResponseBytes: 1024 * 1024,
            },
            logger: {
                info: () => {},
                warn: () => {},
                error: () => {},
                debug: () => {},
                trace: () => {},
            },
        };
    });

    afterEach(async () => {
        await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    });

    it("resolves methods dir from workspaceRoot first", () => {
        expect(resolveMethodsDir(context)).toBe(path.join(stateDir, "methods"));
    });

    it("falls back to BELLDANDY_STATE_DIR when workspaceRoot is missing", () => {
        const env = { BELLDANDY_STATE_DIR: stateDir } as NodeJS.ProcessEnv;
        expect(resolveStateDir(undefined, env)).toBe(stateDir);
        expect(resolveMethodsDir(undefined, env)).toBe(path.join(stateDir, "methods"));
    });

    it("accepts only canonical three-part method filenames", () => {
        expect(isValidMethodFilename("file-read-basic.md")).toBe(true);
        expect(isValidMethodFilename("网页-自动化-基础.md")).toBe(true);
        expect(isValidMethodFilename("memory-query-recall.md")).toBe(true);
        expect(isValidMethodFilename("网页自动化基础.md")).toBe(false);
        expect(isValidMethodFilename("file-read.md")).toBe(false);
        expect(isValidMethodFilename("file-read-basic-extra.md")).toBe(false);
        expect(isValidMethodFilename("bad name.md")).toBe(false);
        expect(isValidMethodFilename("invalid:name.md")).toBe(false);
    });

    it("returns empty-list message when no methods exist", async () => {
        const result = await methodListTool.execute({}, context);
        expect(result.success).toBe(true);
        expect(result.output).toContain("目前没有存储任何方法文档");
    });

    it("parses optional frontmatter metadata without requiring migration", () => {
        const parsed = parseMethodContent(`---
summary: "浏览器自动化基础方法"
status: "verified"
read_when:
  - "执行网页自动化前"
tags:
  - "browser"
  - "automation"
---

# 网页自动化基础方法

## 适用场景
- 自动化操作
`);

        expect(parsed.title).toBe("网页自动化基础方法");
        expect(parsed.metadata.summary).toBe("浏览器自动化基础方法");
        expect(parsed.metadata.status).toBe("verified");
        expect(parsed.metadata.readWhen).toEqual(["执行网页自动化前"]);
        expect(parsed.metadata.tags).toEqual(["browser", "automation"]);
    });

    it("lists methods from the context state directory", async () => {
        const methodsDir = resolveMethodsDir(context);
        await fs.mkdir(methodsDir, { recursive: true });
        await fs.writeFile(path.join(methodsDir, "File-read-basic.md"), `---
summary: "读取文件的基础方法"
status: "verified"
---

# File Read`, "utf-8");

        const result = await methodListTool.execute({}, context);
        expect(result.success).toBe(true);
        expect(result.output).toContain("File-read-basic.md");
        expect(result.output).toContain("状态：verified");
        expect(result.output).toContain("摘要：读取文件的基础方法");
    });

    it("creates, reads, and searches methods inside the context state directory", async () => {
        const created = await methodCreateTool.execute({
            filename: "File-read-basic.md",
            content: "# 文件读取方法\n\n## 适用场景\n- 读取文件",
        }, context);
        expect(created.success).toBe(true);

        const filePath = path.join(resolveMethodsDir(context), "File-read-basic.md");
        const saved = await fs.readFile(filePath, "utf-8");
        expect(saved).toContain("文件读取方法");

        const read = await methodReadTool.execute({ filename: "File-read-basic.md" }, context);
        expect(read.success).toBe(true);
        expect(read.output).toContain("文件读取方法");

        const search = await methodSearchTool.execute({ keyword: "读取" }, context);
        expect(search.success).toBe(true);
        expect(search.output).toContain("File-read-basic.md");
    });

    it("supports canonical Chinese three-part filenames", async () => {
        const created = await methodCreateTool.execute({
            filename: "网页-自动化-基础.md",
            content: "# 网页自动化基础方法\n\n## 适用场景\n- 中文文件名",
        }, context);

        expect(created.success).toBe(true);

        const read = await methodReadTool.execute({ filename: "网页-自动化-基础.md" }, context);
        expect(read.success).toBe(true);
        expect(read.output).toContain("网页自动化基础方法");
    });

    it("searches methods with canonical Chinese three-part filenames", async () => {
        const created = await methodCreateTool.execute({
            filename: "网页-自动化-经验.md",
            content: "# 网页自动化经验总结\n\n## 适用场景\n- 自动化浏览器操作",
        }, context);
        expect(created.success).toBe(true);

        const search = await methodSearchTool.execute({ keyword: "经验总结" }, context);
        expect(search.success).toBe(true);
        expect(search.output).toContain("网页-自动化-经验.md");
    });

    it("rejects invalid method filenames", async () => {
        const created = await methodCreateTool.execute({
            filename: "invalid name.md",
            content: "# invalid",
        }, context);

        expect(created.success).toBe(false);
        expect(created.error).toBe("Invalid filename format");
    });

    it("blocks path traversal for create and read", async () => {
        const createResult = await methodCreateTool.execute({
            filename: "..\\outside.md",
            content: "# outside",
        }, context);
        expect(createResult.success).toBe(false);

        const readResult = await methodReadTool.execute({ filename: "..\\outside.md" }, context);
        expect(readResult.success).toBe(false);
        expect(readResult.error).toBe("Path traversal detected");
    });

    it("returns ranked search results with title and snippet", async () => {
        await methodCreateTool.execute({
            filename: "网页-自动化-基础.md",
            content: `---
summary: "适用于浏览器自动化"
status: "verified"
read_when:
  - "执行网页自动化前"
tags:
  - "browser"
  - "automation"
---

# 网页自动化基础方法

## 适用场景
- 自动化浏览器操作`,
        }, context);

        await methodCreateTool.execute({
            filename: "记录-杂项-说明.md",
            content: "# 说明文档\n\n这里提到自动化，但只是正文命中。",
        }, context);

        const search = await methodSearchTool.execute({ keyword: "自动化" }, context);
        expect(search.success).toBe(true);
        expect(search.output).toContain("标题：网页自动化基础方法");
        expect(search.output).toContain("状态：verified");
        expect(search.output).toContain("标签：browser, automation");
        expect(search.output).toContain("使用时机：执行网页自动化前");
        expect(search.output).toContain("摘要：");

        const firstIndex = search.output.indexOf("网页-自动化-基础.md");
        const secondIndex = search.output.indexOf("记录-杂项-说明.md");
        expect(firstIndex).toBeGreaterThanOrEqual(0);
        expect(secondIndex).toBeGreaterThan(firstIndex);
    });

    it("soft-boosts preferred methods without restricting full search", async () => {
        await methodCreateTool.execute({
            filename: "Review-Code-Checklist.md",
            content: `---
summary: "适用于自动化审查"
---

# Review Checklist

## Purpose
用于自动化审查`,
        }, context);

        await methodCreateTool.execute({
            filename: "Refactor-Code-Checklist.md",
            content: `---
summary: "适用于自动化审查"
---

# Refactor Checklist

## Purpose
也用于自动化审查`,
        }, context);

        const preferredContext: ToolContext = {
            ...context,
            agentCatalogPreferences: {
                methods: ["Refactor-Code-Checklist.md"],
            },
        };

        const search = await methodSearchTool.execute({ keyword: "自动化审查" }, preferredContext);
        expect(search.success).toBe(true);
        expect(search.output).toContain("推荐：preferred");

        const preferredIndex = search.output.indexOf("Refactor-Code-Checklist.md");
        const regularIndex = search.output.indexOf("Review-Code-Checklist.md");
        expect(preferredIndex).toBeGreaterThanOrEqual(0);
        expect(regularIndex).toBeGreaterThanOrEqual(0);
        expect(preferredIndex).toBeLessThan(regularIndex);
    });

    it("returns not-found message when search misses", async () => {
        const search = await methodSearchTool.execute({ keyword: "不存在的关键词" }, context);
        expect(search.success).toBe(true);
        expect(search.output).toContain("未找到包含");
    });
});
