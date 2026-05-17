import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolEnabledAgent } from "@belldandy/agent";

import {
  buildPromptFocusRuntimePrelude,
  collectPromptFocusTerms,
  scorePromptFocusChunks,
  buildPromptFocusChunks,
} from "./prompt-focus-runtime-prelude.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }).catch(() => {})));
});

async function createWorkspaceFixture(): Promise<string> {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-prompt-focus-"));
  tempDirs.push(stateDir);
  await fs.writeFile(path.join(stateDir, "AGENTS.md"), [
    "# 全局规则",
    "",
    "## 执行路由",
    "",
    "### PLAN",
    "",
    "跨文件或跨模块、新功能开发、接口契约变化、风险明显时，先做简短规划，并说明验证方式。",
    "",
    "### HITL",
    "",
    "删除或覆盖大量文件、权限与密钥调整等高风险动作，需要先说明影响、风险与回滚方式。",
    "",
  ].join("\n"), "utf-8");
  await fs.writeFile(path.join(stateDir, "SOUL.md"), [
    "# 核心人格",
    "",
    "## 记忆守护",
    "",
    "如果某个改进会让记忆功能下降、污染长期记忆或破坏现有记忆链路，应先调整方案，否则暂缓。",
    "",
  ].join("\n"), "utf-8");
  return stateDir;
}

describe("prompt focus runtime prelude", () => {
  it("injects the most relevant AGENTS.md section as runtime prompt focus", async () => {
    const stateDir = await createWorkspaceFixture();

    const result = await buildPromptFocusRuntimePrelude({
      stateDir,
      agentId: "default",
      currentTurnText: "我要改一个跨文件功能，先给我简短规划和风险说明。",
      config: {
        enabled: true,
        maxSections: 2,
        maxChars: 600,
        minScore: 4,
        maxExcerptChars: 180,
      },
    });

    expect(result?.prependContext).toContain("<prompt-focus");
    expect(result?.prependContext).toContain("AGENTS.md > 全局规则 / 执行路由 / PLAN");
    expect(result?.prependContext).toContain("简短规划");
    expect(result?.deltas?.[0]?.metadata).toMatchObject({
      blockTag: "prompt-focus-runtime",
      indexVersion: "workspace-doc-lexical-v1",
      indexedFiles: expect.arrayContaining(["AGENTS.md", "SOUL.md"]),
      matchedChunkCount: expect.any(Number),
    });
    expect(result?.deltas?.[0]?.text).toContain("AGENTS.md > 全局规则 / 执行路由 / PLAN");
  });

  it("can focus memory guard guidance from SOUL.md without touching durable memory", async () => {
    const stateDir = await createWorkspaceFixture();

    const result = await buildPromptFocusRuntimePrelude({
      stateDir,
      agentId: "default",
      currentTurnText: "这次优化不能让记忆功能下降，如果会影响长期记忆就先暂缓。",
      config: {
        enabled: true,
        maxSections: 2,
        maxChars: 600,
        minScore: 4,
        maxExcerptChars: 180,
      },
    });

    expect(result?.prependContext).toContain("SOUL.md > 核心人格 / 记忆守护");
    expect(result?.prependContext).toContain("记忆功能下降");
    expect(result).not.toHaveProperty("systemPrompt");
  });

  it("skips injection when there is no strong lexical match", async () => {
    const stateDir = await createWorkspaceFixture();

    const result = await buildPromptFocusRuntimePrelude({
      stateDir,
      agentId: "default",
      currentTurnText: "今天天气怎么样？",
      config: {
        enabled: true,
        maxSections: 2,
        maxChars: 600,
        minScore: 6,
        maxExcerptChars: 180,
      },
    });

    expect(result).toBeUndefined();
  });

  it("keeps the static system prompt unchanged and adds runtime delta in snapshots", async () => {
    const stateDir = await createWorkspaceFixture();
    const prelude = await buildPromptFocusRuntimePrelude({
      stateDir,
      agentId: "default",
      currentTurnText: "我要改跨文件逻辑，先规划一下并提示相关规则。",
      config: {
        enabled: true,
        maxSections: 2,
        maxChars: 600,
        minScore: 4,
        maxExcerptChars: 180,
      },
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(createJsonResponse({
      choices: [{
        message: {
          content: "done",
        },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));

    const snapshots: any[] = [];
    const agent = new ToolEnabledAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      systemPrompt: "base-system-prompt",
      toolExecutor: createToolExecutor(),
      onPromptSnapshot: (snapshot) => {
        snapshots.push(snapshot);
      },
      hookRunner: {
        runBeforeAgentStart: async () => prelude,
        runAgentEnd: async () => {},
        runBeforeToolCall: async () => undefined,
        runAfterToolCall: async () => {},
        runToolResultPersist: () => undefined,
      } as any,
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-prompt-focus",
      text: "hello",
      userInput: "我要改跨文件逻辑，先规划一下并提示相关规则。",
    }));

    expect(items).toContainEqual({ type: "final", text: "done" });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].systemPrompt).toBe("base-system-prompt");
    expect(snapshots[0].prependContext).toContain("<prompt-focus");
    expect(snapshots[0].deltas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "prompt-focus-runtime",
        deltaType: "user-prelude",
        role: "user-prelude",
        text: expect.stringContaining("AGENTS.md > 全局规则 / 执行路由 / PLAN"),
      }),
    ]));
    expect(snapshots[0].messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "system",
        content: "base-system-prompt",
      }),
      expect.objectContaining({
        role: "user",
        content: expect.stringContaining("<prompt-focus"),
      }),
    ]));
  });
});

describe("prompt focus lexical helpers", () => {
  it("extracts mixed Chinese and English lexical terms", () => {
    const terms = collectPromptFocusTerms("请继续处理 memory guard 和跨文件 plan", 12);
    expect(terms).toEqual(expect.arrayContaining(["memory", "guard", "plan"]));
    expect(terms.some((term) => term.includes("跨文件"))).toBe(true);
  });

  it("scores heading matches above weak body-only matches", () => {
    const chunks = buildPromptFocusChunks({
      name: "AGENTS.md",
      path: "E:/tmp/AGENTS.md",
      missing: false,
      content: [
        "# Rules",
        "",
        "## PLAN",
        "",
        "跨文件改动先做计划。",
        "",
        "## Notes",
        "",
        "这里也提到计划，但不是主标题。",
      ].join("\n"),
      document: {
        raw: "",
        body: [
          "# Rules",
          "",
          "## PLAN",
          "",
          "跨文件改动先做计划。",
          "",
          "## Notes",
          "",
          "这里也提到计划，但不是主标题。",
        ].join("\n"),
        hasFrontmatter: false,
      },
    } as any);

    const matches = scorePromptFocusChunks({
      currentTurnText: "please make a plan first",
      chunks,
      minScore: 2,
    });

    expect(matches[0]?.chunk.headingPath.join(" / ")).toBe("Rules / PLAN");
    expect(matches[0]?.score).toBeGreaterThan(matches[1]?.score ?? 0);
  });
});

function createToolExecutor(overrides: Record<string, unknown> = {}): any {
  return {
    getDefinitions: () => [],
    consumeLoadedDeferredToolsForNextTurn: vi.fn(async () => []),
    setTokenCounter: vi.fn(),
    clearTokenCounter: vi.fn(),
    execute: vi.fn(),
    ...overrides,
  };
}

async function collectItems(stream: AsyncIterable<any>): Promise<any[]> {
  const items: any[] = [];
  for await (const item of stream) {
    items.push(item);
  }
  return items;
}

function createJsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
