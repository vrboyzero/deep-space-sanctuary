import { describe, expect, it, vi } from "vitest";

const memoryManager = {
  getTaskByConversation: vi.fn(),
  recordSkillUsage: vi.fn(),
};

vi.mock("@belldandy/memory", () => ({
  getGlobalMemoryManager: () => memoryManager,
}));

const { createSkillsSearchTool } = await import("./skills-tool.js");

describe("skills_search summary discovery", () => {
  it("returns compact summaries and points callers to skill_get for full instructions", async () => {
    const registry = {
      searchSkills: vi.fn().mockReturnValue([
        {
          name: "网页自动化 Skill",
          description: "用于浏览器自动化任务",
          priority: "normal",
          tags: ["browser", "automation"],
          instructions: "1. 打开浏览器\n2. 点击页面\n3. 提交表单",
          source: { type: "user", path: "E:/skills/web-auto/SKILL.md" },
        },
      ]),
    } as any;

    const tool = createSkillsSearchTool(registry);
    const result = await tool.execute({ query: "browser automation" }, {} as any);

    expect(result.success).toBe(true);
    expect(result.output).toContain("## 网页自动化 Skill [browser, automation]");
    expect(result.output).toContain("- priority: normal");
    expect(result.output).toContain("- source: user");
    expect(result.output).toContain("- matched_on:");
    expect(result.output).toContain("skills_search 只返回摘要候选");
    expect(result.output).toContain("优先调用 `skill_get`");
    expect(result.output).not.toContain("1. 打开浏览器");
    expect(memoryManager.recordSkillUsage).not.toHaveBeenCalled();
  });

  it("reports when there are more matches than shown", async () => {
    const registry = {
      searchSkills: vi.fn().mockReturnValue(
        Array.from({ length: 6 }, (_, index) => ({
          name: `Skill-${index + 1}`,
          description: `Description ${index + 1}`,
          priority: "normal",
          tags: [],
          instructions: `Instructions ${index + 1}`,
          source: { type: "bundled" },
        })),
      ),
    } as any;

    const tool = createSkillsSearchTool(registry);
    const result = await tool.execute({ query: "skill" }, {} as any);

    expect(result.success).toBe(true);
    expect(result.output).toContain("（还有 1 个匹配结果未显示，请缩小搜索范围）");
    expect(result.output).not.toContain("Instructions 1");
  });

  it("soft-boosts preferred skills while keeping full search results available", async () => {
    const registry = {
      searchSkills: vi.fn().mockReturnValue([
        {
          name: "review-helper",
          description: "帮助代码审查",
          priority: "normal",
          tags: ["review"],
          instructions: "用于代码审查",
          source: { type: "bundled" },
        },
        {
          name: "refactor-helper",
          description: "帮助代码审查",
          priority: "normal",
          tags: ["review"],
          instructions: "也用于代码审查",
          source: { type: "bundled" },
        },
      ]),
    } as any;

    const tool = createSkillsSearchTool(registry);
    const result = await tool.execute({
      query: "代码审查",
    }, {
      agentCatalogPreferences: {
        skills: ["refactor-helper"],
      },
    } as any);

    expect(result.success).toBe(true);
    expect(result.output).toContain("- preferred: profile");

    const preferredIndex = result.output.indexOf("## refactor-helper");
    const regularIndex = result.output.indexOf("## review-helper");
    expect(preferredIndex).toBeGreaterThanOrEqual(0);
    expect(regularIndex).toBeGreaterThanOrEqual(0);
    expect(preferredIndex).toBeLessThan(regularIndex);
  });
});
