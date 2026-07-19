import { describe, expect, it } from "vitest";

import { buildProviderNativeSystemBlocks, buildSystemPrompt, buildSystemPromptResult, buildWorkspaceContext, renderSystemPromptSections } from "./system-prompt.js";
import { parseWorkspaceDocument, type WorkspaceFile, type WorkspaceFileName, type WorkspaceLoadResult } from "./workspace.js";

const baseWorkspace = {
  dir: "/workspace",
  hasSoul: true,
  hasIdentity: true,
  hasUser: true,
  hasBootstrap: false,
  hasAgents: true,
  hasTools: true,
  hasHeartbeat: false,
  hasMemory: false,
};

function createWorkspaceFile(name: "AGENTS.md" | "SOUL.md" | "TOOLS.md" | "IDENTITY.md" | "USER.md" | "BOOTSTRAP.md" | "MEMORY.md", content: string) {
  return {
    name,
    path: `/workspace/${name}`,
    content,
    document: parseWorkspaceDocument(content),
    missing: false as const,
  };
}

function createMissingWorkspaceFile(name: WorkspaceFileName): WorkspaceFile {
  return {
    name,
    path: `/workspace/${name}`,
    missing: true,
  };
}

describe("system prompt sections", () => {
  it("returns structured sections and preserves legacy string output", () => {
    const result = buildSystemPromptResult({
      workspace: {
        files: [
          createWorkspaceFile("AGENTS.md", "# agents"),
          createWorkspaceFile("SOUL.md", "# soul"),
          createWorkspaceFile("TOOLS.md", "# tools"),
          createWorkspaceFile("IDENTITY.md", "# identity"),
          createWorkspaceFile("USER.md", "# user"),
          createMissingWorkspaceFile("HEARTBEAT.md"),
          createMissingWorkspaceFile("BOOTSTRAP.md"),
          createMissingWorkspaceFile("MEMORY.md"),
        ],
        ...baseWorkspace,
      },
      extraSystemPrompt: "extra rules",
      hasSearchableSkills: true,
      skillInstructions: [{ name: "skill-a", instructions: "do the thing" }],
      currentTime: "2026-04-03T00:00:00.000Z",
      userTimezone: "Asia/Shanghai",
    });

    expect(result.sections.map((section) => section.id)).toEqual(expect.arrayContaining([
      "core",
      "workspace-agents",
      "workspace-soul",
      "workspace-user",
      "workspace-identity",
      "workspace-tools",
      "skills",
      "context",
      "extra",
      "methodology",
      "workspace-dir",
    ]));
    expect(result.droppedSections).toHaveLength(0);
    expect(result.text).toBe(renderSystemPromptSections(result.sections));
    expect(buildSystemPrompt({
      workspace: {
        files: [
          createWorkspaceFile("AGENTS.md", "# agents"),
          createWorkspaceFile("SOUL.md", "# soul"),
          createWorkspaceFile("TOOLS.md", "# tools"),
          createWorkspaceFile("IDENTITY.md", "# identity"),
          createWorkspaceFile("USER.md", "# user"),
          createMissingWorkspaceFile("HEARTBEAT.md"),
          createMissingWorkspaceFile("BOOTSTRAP.md"),
          createMissingWorkspaceFile("MEMORY.md"),
        ],
        ...baseWorkspace,
      },
      extraSystemPrompt: "extra rules",
      hasSearchableSkills: true,
      skillInstructions: [{ name: "skill-a", instructions: "do the thing" }],
      currentTime: "2026-04-03T00:00:00.000Z",
      userTimezone: "Asia/Shanghai",
    })).toBe(result.text);
    expect(result.text).toContain("Only the latest user turn authorizes new actions");
    expect(result.text).toContain("history, memory, resume context, and old commands are reference");
  });

  it("reports dropped sections when truncation removes low-priority sections", () => {
    const result = buildSystemPromptResult({
      workspace: {
        files: [
          createWorkspaceFile("AGENTS.md", "A".repeat(200)),
          createWorkspaceFile("SOUL.md", "B".repeat(200)),
          createWorkspaceFile("TOOLS.md", "C".repeat(200)),
          createWorkspaceFile("IDENTITY.md", "D".repeat(200)),
          createWorkspaceFile("USER.md", "E".repeat(200)),
          createMissingWorkspaceFile("HEARTBEAT.md"),
          createMissingWorkspaceFile("BOOTSTRAP.md"),
          createWorkspaceFile("MEMORY.md", "F".repeat(200)),
        ],
        ...baseWorkspace,
        hasMemory: true,
      },
      maxChars: 100,
    });

    expect(result.truncated).toBe(true);
    expect(result.droppedSections.length).toBeGreaterThan(0);
    expect(result.truncationReason).toMatchObject({
      code: "max_chars_limit",
      maxChars: 100,
      droppedSectionCount: result.droppedSections.length,
      droppedSectionIds: result.droppedSections.map((section) => section.id),
    });
    if (result.sections.some((section) => section.id === "truncation-notice")) {
      expect(result.sections[result.sections.length - 1]?.id).toBe("truncation-notice");
      expect(result.text).toContain("System prompt truncated");
    }
    expect(result.truncationReason?.message).toContain("fit 100 char limit");
    expect(result.finalChars).toBeLessThanOrEqual(100);
  });

  it("applies section priority overrides before truncation", () => {
    const result = buildSystemPromptResult({
      workspace: {
        files: [
          createMissingWorkspaceFile("AGENTS.md"),
          createMissingWorkspaceFile("SOUL.md"),
          createMissingWorkspaceFile("TOOLS.md"),
          createMissingWorkspaceFile("IDENTITY.md"),
          createMissingWorkspaceFile("USER.md"),
          createMissingWorkspaceFile("HEARTBEAT.md"),
          createMissingWorkspaceFile("BOOTSTRAP.md"),
          createMissingWorkspaceFile("MEMORY.md"),
        ],
        ...baseWorkspace,
        hasSoul: false,
        hasIdentity: false,
        hasUser: false,
        hasAgents: false,
        hasTools: false,
      },
      extraSystemPrompt: "X".repeat(2000),
      currentTime: "2026-04-03T00:00:00.000Z",
      userTimezone: "Asia/Shanghai",
      maxChars: 1800,
      sectionPriorityOverrides: {
        methodology: 5,
      },
    });

    expect(result.sections[0]?.id).toBe("core");
    expect(result.droppedSections.map((section) => section.id)).toContain("extra");
    expect(result.droppedSections.map((section) => section.id)).toContain("workspace-dir");
    expect(result.sections.some((section) => section.id === "extra")).toBe(false);
    expect(result.sections.some((section) => section.id === "methodology")).toBe(true);
  });

  it("strips frontmatter from workspace prompt bodies and exposes section metadata", () => {
    const agentsContent = [
      "---",
      "summary: \"workspace guide\"",
      "read_when:",
      "  - session start",
      "  - when rules change",
      "layer: core",
      "cache: sticky",
      "role: system",
      "---",
      "# agents body",
    ].join("\n");

    const result = buildSystemPromptResult({
      workspace: {
        files: [
          createWorkspaceFile("AGENTS.md", agentsContent),
          createWorkspaceFile("SOUL.md", "# soul"),
          createWorkspaceFile("TOOLS.md", "# tools"),
          createWorkspaceFile("IDENTITY.md", "# identity"),
          createWorkspaceFile("USER.md", "# user"),
          createMissingWorkspaceFile("HEARTBEAT.md"),
          createMissingWorkspaceFile("BOOTSTRAP.md"),
          createMissingWorkspaceFile("MEMORY.md"),
        ],
        ...baseWorkspace,
      },
    });

    const agentsSection = result.sections.find((section) => section.id === "workspace-agents");
    expect(agentsSection).toMatchObject({
      sourceFile: "/workspace/AGENTS.md",
      summary: "workspace guide",
      readWhen: ["session start", "when rules change"],
      layer: "core",
      cacheHint: "sticky",
      role: "system",
    });
    expect(agentsSection?.text).toContain("# agents body");
    expect(agentsSection?.text).not.toContain('summary: "workspace guide"');
    expect(result.text).not.toContain("read_when:");
  });

  it("builds workspace context from stripped prompt bodies", () => {
    const workspace: WorkspaceLoadResult = {
      files: [
        createWorkspaceFile("AGENTS.md", ["---", "summary: \"guide\"", "---", "# agents body"].join("\n")),
        createWorkspaceFile("SOUL.md", "# soul body"),
        createMissingWorkspaceFile("TOOLS.md"),
        createMissingWorkspaceFile("IDENTITY.md"),
        createMissingWorkspaceFile("USER.md"),
        createMissingWorkspaceFile("HEARTBEAT.md"),
        createMissingWorkspaceFile("BOOTSTRAP.md"),
        createMissingWorkspaceFile("MEMORY.md"),
      ],
      ...baseWorkspace,
      hasSoul: true,
      hasIdentity: false,
      hasUser: false,
      hasAgents: true,
      hasTools: false,
    };

    const context = buildWorkspaceContext(workspace);
    expect(context).toContain("## AGENTS.md");
    expect(context).toContain("# agents body");
    expect(context).not.toContain('summary: "guide"');
  });

  it("builds provider-native system blocks from sections and system deltas", () => {
    const result = buildSystemPromptResult({
      workspace: {
        files: [
          createWorkspaceFile("AGENTS.md", "# agents"),
          createWorkspaceFile("SOUL.md", "# soul"),
          createWorkspaceFile("TOOLS.md", "# tools"),
          createWorkspaceFile("IDENTITY.md", "# identity"),
          createWorkspaceFile("USER.md", "# user"),
          createMissingWorkspaceFile("HEARTBEAT.md"),
          createMissingWorkspaceFile("BOOTSTRAP.md"),
          createMissingWorkspaceFile("MEMORY.md"),
        ],
        ...baseWorkspace,
      },
      extraSystemPrompt: "extra rules",
      hasSearchableSkills: true,
      currentTime: "2026-04-03T00:00:00.000Z",
      userTimezone: "Asia/Shanghai",
    });

    const blocks = buildProviderNativeSystemBlocks({
      sections: result.sections,
      deltas: [
        {
          id: "runtime-identity",
          deltaType: "runtime-identity",
          role: "system",
          text: "## runtime identity",
        },
        {
          id: "recent-memory",
          deltaType: "user-prelude",
          role: "user-prelude",
          text: "<recent-memory>ctx</recent-memory>",
        },
      ],
    });

    expect(blocks.map((block) => block.blockType)).toEqual([
      "static-persona",
      "static-capability",
      "dynamic-runtime",
    ]);
    expect(blocks[0]).toMatchObject({
      id: "provider-native-static-persona",
      sourceSectionIds: expect.arrayContaining(["core", "workspace-agents", "workspace-soul", "workspace-user", "workspace-identity"]),
      cacheControlEligible: true,
    });
    expect(blocks[1]).toMatchObject({
      id: "provider-native-static-capability",
      sourceSectionIds: expect.arrayContaining(["workspace-tools", "skills", "context", "extra", "methodology", "workspace-dir"]),
      cacheControlEligible: true,
    });
    expect(blocks[2]).toMatchObject({
      id: "provider-native-dynamic-runtime",
      sourceDeltaIds: ["runtime-identity"],
      cacheControlEligible: false,
    });
    expect(blocks[2]?.text).toContain("## runtime identity");
    expect(blocks[2]?.text).not.toContain("<recent-memory>");
  });

  it("uses unified capability routing language for methods, skills, and deferred tools", () => {
    const result = buildSystemPromptResult({
      workspace: {
        files: [
          createWorkspaceFile("AGENTS.md", "# agents"),
          createWorkspaceFile("SOUL.md", "# soul"),
          createWorkspaceFile("TOOLS.md", "# tools"),
          createWorkspaceFile("IDENTITY.md", "# identity"),
          createWorkspaceFile("USER.md", "# user"),
          createMissingWorkspaceFile("HEARTBEAT.md"),
          createMissingWorkspaceFile("BOOTSTRAP.md"),
          createMissingWorkspaceFile("MEMORY.md"),
        ],
        ...baseWorkspace,
      },
      hasSearchableSkills: true,
    });

    const text = result.text;
    expect(text).toContain("## Capability Routing");
    expect(text).toContain("SOPs / reusable workflows: use `method_search`");
    expect(text).toContain("Skills / domain instructions: use `skills_search`");
    expect(text).toContain("Hidden heavy tools or MCP tools: use `tool_search` only when the exact schema is not visible");
    expect(text).toContain("Runtime governance / diagnostics / metadata are queried through RPC surfaces");
    expect(text).toContain("Searching alone does not count as usage.");
  });

  it("inserts runtime sections between workspace tools and memory", () => {
    const result = buildSystemPromptResult({
      workspace: {
        files: [
          createWorkspaceFile("AGENTS.md", "# agents"),
          createWorkspaceFile("SOUL.md", "# soul"),
          createWorkspaceFile("TOOLS.md", "# tools"),
          createWorkspaceFile("IDENTITY.md", "# identity"),
          createWorkspaceFile("USER.md", "# user"),
          createMissingWorkspaceFile("HEARTBEAT.md"),
          createMissingWorkspaceFile("BOOTSTRAP.md"),
          createWorkspaceFile("MEMORY.md", "# memory"),
        ],
        ...baseWorkspace,
        hasMemory: true,
      },
      runtimeSections: [
        {
          id: "tool-use-policy",
          label: "tool-use-policy",
          source: "runtime",
          priority: 55,
          text: "## Tool Use Operating Policy",
        },
        {
          id: "role-execution-policy",
          label: "role-execution-policy",
          source: "profile",
          priority: 58,
          text: "## Role Execution Policy (coder)",
        },
      ],
    });

    expect(result.sections.map((section) => section.id)).toEqual(expect.arrayContaining([
      "workspace-tools",
      "tool-use-policy",
      "role-execution-policy",
      "workspace-memory",
    ]));
    expect(result.sections.findIndex((section) => section.id === "workspace-tools"))
      .toBeLessThan(result.sections.findIndex((section) => section.id === "tool-use-policy"));
    expect(result.sections.findIndex((section) => section.id === "role-execution-policy"))
      .toBeLessThan(result.sections.findIndex((section) => section.id === "workspace-memory"));

    const blocks = buildProviderNativeSystemBlocks({
      sections: result.sections,
    });
    expect(blocks.find((block) => block.blockType === "dynamic-runtime")?.sourceSectionIds).toEqual(
      expect.arrayContaining(["tool-use-policy", "role-execution-policy"]),
    );
  });

  it("keeps always skills fully injected while degrading high skills to summaries", () => {
    const result = buildSystemPromptResult({
      workspace: {
        files: [
          createMissingWorkspaceFile("AGENTS.md"),
          createMissingWorkspaceFile("SOUL.md"),
          createMissingWorkspaceFile("TOOLS.md"),
          createMissingWorkspaceFile("IDENTITY.md"),
          createMissingWorkspaceFile("USER.md"),
          createMissingWorkspaceFile("HEARTBEAT.md"),
          createMissingWorkspaceFile("BOOTSTRAP.md"),
          createMissingWorkspaceFile("MEMORY.md"),
        ],
        ...baseWorkspace,
        hasSoul: false,
        hasIdentity: false,
        hasUser: false,
        hasAgents: false,
        hasTools: false,
      },
      skillInstructions: [
        {
          name: "always-skill",
          priority: "always",
          description: "keep this fully visible",
          instructions: "Always instructions: follow every step exactly.",
        },
        {
          name: "high-skill",
          priority: "high",
          description: "only summary should stay resident",
          instructions: "High instructions that should not remain as full resident text.",
        },
      ],
      hasSearchableSkills: false,
    });

    const text = result.text;
    expect(text).toContain("## [always-skill]");
    expect(text).toContain("Always instructions: follow every step exactly.");
    expect(text).toContain("## High-Priority Skill Summaries");
    expect(text).toContain("`high-skill` - only summary should stay resident");
    expect(text).not.toContain("High instructions that should not remain as full resident text.");
    expect(text).toContain("Open the exact one with `skill_get` once you decide to adopt it.");
  });

  it("bounds the skill section by UTF-8 bytes and degrades overflow always skills", () => {
    const workspace = {
      files: [
        createMissingWorkspaceFile("AGENTS.md"),
        createMissingWorkspaceFile("SOUL.md"),
        createMissingWorkspaceFile("TOOLS.md"),
        createMissingWorkspaceFile("IDENTITY.md"),
        createMissingWorkspaceFile("USER.md"),
        createMissingWorkspaceFile("HEARTBEAT.md"),
        createMissingWorkspaceFile("BOOTSTRAP.md"),
        createMissingWorkspaceFile("MEMORY.md"),
      ],
      ...baseWorkspace,
      hasSoul: false,
      hasIdentity: false,
      hasUser: false,
      hasAgents: false,
      hasTools: false,
    };
    const firstSkill = {
      name: "utf8-always",
      priority: "always" as const,
      description: "UTF-8 bounded fixture",
      instructions: `关键步骤-${"你".repeat(64)}`,
    };
    const baseline = buildSystemPromptResult({
      workspace,
      skillInstructions: [firstSkill],
      maxSkillPromptBytes: 1024 * 1024,
    });
    const exactBytes = baseline.skillPromptBudget?.renderedBytes ?? 0;

    const exact = buildSystemPromptResult({
      workspace,
      skillInstructions: [firstSkill],
      maxSkillPromptBytes: exactBytes,
    });
    const below = buildSystemPromptResult({
      workspace,
      skillInstructions: [firstSkill],
      maxSkillPromptBytes: exactBytes - 1,
    });

    expect(exact.text).toContain(firstSkill.instructions);
    expect(exact.skillPromptBudget).toMatchObject({
      maxBytes: exactBytes,
      deferredInstructionCount: 0,
    });
    expect(below.text).not.toContain(firstSkill.instructions);
    expect(below.text).toContain("`utf8-always` - UTF-8 bounded fixture");
    expect(below.skillPromptBudget?.deferredInstructionCount).toBe(1);
    expect(below.skillPromptBudget?.renderedBytes).toBeLessThanOrEqual(exactBytes - 1);
  });

  it("keeps aggregate always-skill prompt content within one shared budget", () => {
    const skillInstructions = [
      {
        name: "first-always",
        priority: "always" as const,
        description: "first summary",
        instructions: `FIRST-FULL-${"a".repeat(256)}`,
      },
      {
        name: "second-always",
        priority: "always" as const,
        description: "second summary",
        instructions: `SECOND-FULL-${"b".repeat(256)}`,
      },
    ];
    const firstOnly = buildSystemPromptResult({
      skillInstructions: [skillInstructions[0]],
      maxSkillPromptBytes: 1024 * 1024,
    });
    const sharedBudget = firstOnly.skillPromptBudget?.renderedBytes ?? 0;

    const result = buildSystemPromptResult({
      skillInstructions,
      maxSkillPromptBytes: sharedBudget,
    });

    expect(result.text).toContain("FIRST-FULL-");
    expect(result.text).not.toContain("SECOND-FULL-");
    expect(result.skillPromptBudget?.deferredInstructionCount).toBe(1);
    expect(result.skillPromptBudget?.renderedBytes).toBeLessThanOrEqual(sharedBudget);
  });

  it("applies the default 64 KiB skill budget when no override is provided", () => {
    const result = buildSystemPromptResult({
      skillInstructions: [{
        name: "oversized-default",
        priority: "always",
        description: "default budget fixture",
        instructions: "x".repeat(80 * 1024),
      }],
    });

    expect(result.text).not.toContain("x".repeat(80 * 1024));
    expect(result.skillPromptBudget).toMatchObject({
      maxBytes: 64 * 1024,
      deferredInstructionCount: 1,
    });
    expect(result.skillPromptBudget?.renderedBytes).toBeLessThanOrEqual(64 * 1024);
  });

  it("promotes routing sections ahead of low-priority runtime sections when maxChars mode is enabled", () => {
    const result = buildSystemPromptResult({
      workspace: {
        files: [
          createMissingWorkspaceFile("AGENTS.md"),
          createMissingWorkspaceFile("SOUL.md"),
          createMissingWorkspaceFile("TOOLS.md"),
          createMissingWorkspaceFile("IDENTITY.md"),
          createMissingWorkspaceFile("USER.md"),
          createMissingWorkspaceFile("HEARTBEAT.md"),
          createMissingWorkspaceFile("BOOTSTRAP.md"),
          createMissingWorkspaceFile("MEMORY.md"),
        ],
        ...baseWorkspace,
        hasSoul: false,
        hasIdentity: false,
        hasUser: false,
        hasAgents: false,
        hasTools: false,
      },
      hasSearchableSkills: true,
      currentTime: "2026-04-03T00:00:00.000Z",
      userTimezone: "Asia/Shanghai",
      maxChars: 5000,
      extraSystemPrompt: "X".repeat(200),
      runtimeSections: [
        {
          id: "tool-use-policy",
          label: "tool-use-policy",
          source: "runtime",
          priority: 55,
          text: "## Tool Use Operating Policy",
        },
        {
          id: "team-operating-model",
          label: "team-operating-model",
          source: "runtime",
          priority: 57,
          text: "## Team Operating Model",
        },
        {
          id: "method-skill-asset-summary",
          label: "method-skill-asset-summary",
          source: "runtime",
          priority: 58,
          text: "## Method / Skill Asset Summary",
        },
        {
          id: "role-execution-policy",
          label: "role-execution-policy",
          source: "profile",
          priority: 59,
          text: "## Role Execution Policy",
        },
      ],
    });

    const sectionIds = result.sections.map((section) => section.id);
    expect(sectionIds.indexOf("tool-use-policy")).toBeLessThan(sectionIds.indexOf("team-operating-model"));
    expect(sectionIds.indexOf("method-skill-asset-summary")).toBeLessThan(sectionIds.indexOf("team-operating-model"));
    expect(sectionIds.indexOf("skills")).toBeLessThan(sectionIds.indexOf("role-execution-policy"));
    expect(sectionIds.indexOf("methodology")).toBeLessThan(sectionIds.indexOf("role-execution-policy"));
    expect(sectionIds.indexOf("context")).toBeLessThan(sectionIds.indexOf("role-execution-policy"));
  });

  it("hard-caps even a single oversized kept section to the requested maxChars budget", () => {
    const result = buildSystemPromptResult({
      workspace: {
        files: [
          createMissingWorkspaceFile("AGENTS.md"),
          createMissingWorkspaceFile("SOUL.md"),
          createMissingWorkspaceFile("TOOLS.md"),
          createMissingWorkspaceFile("IDENTITY.md"),
          createMissingWorkspaceFile("USER.md"),
          createMissingWorkspaceFile("HEARTBEAT.md"),
          createMissingWorkspaceFile("BOOTSTRAP.md"),
          createMissingWorkspaceFile("MEMORY.md"),
        ],
        ...baseWorkspace,
        hasSoul: false,
        hasIdentity: false,
        hasUser: false,
        hasAgents: false,
        hasTools: false,
      },
      maxChars: 40,
    });

    expect(result.truncated).toBe(true);
    expect(result.finalChars).toBeLessThanOrEqual(40);
    expect(result.truncationReason).toMatchObject({
      code: "max_chars_limit",
      maxChars: 40,
      droppedSectionCount: expect.any(Number),
      truncatedSectionIds: ["core"],
    });
    expect(result.text.length).toBeLessThanOrEqual(40);
  });
});
