import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, test } from "vitest";

import {
  buildDefaultProfile,
  buildBuiltinWorkerProfiles,
  loadAgentProfiles,
  resolveAgentProfileMetadata,
  resolveModelConfig,
} from "./agent-profile.js";

test("resolveAgentProfileMetadata applies resident defaults", () => {
  const metadata = resolveAgentProfileMetadata(buildDefaultProfile());
  expect(metadata).toEqual({
    kind: "resident",
    workspaceBinding: "current",
    workspaceDir: "default",
    sessionNamespace: "default",
    memoryMode: "hybrid",
    catalog: {
      whenToUse: [],
      defaultRole: "default",
      defaultPermissionMode: undefined,
      defaultAllowedToolFamilies: undefined,
      defaultMaxToolRiskLevel: undefined,
      methods: [],
      skills: [],
      handoffStyle: "summary",
    },
  });
});

test("loadAgentProfiles accepts resident metadata extensions and ignores invalid enum values", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-agent-profile-"));
  const configPath = path.join(tempDir, "agents.json");
  await fs.writeFile(configPath, JSON.stringify({
    agents: [
      {
        id: "coder",
        displayName: "Coder",
        model: "primary",
        kind: "resident",
        workspaceBinding: "current",
        workspaceDir: "coder",
        sessionNamespace: "coder-main",
        memoryMode: "isolated",
        whenToUse: ["需要改代码", "需要补测试"],
        defaultRole: "coder",
        defaultAllowedToolFamilies: ["workspace-read", "patch", "workspace-read"],
        methods: ["Review-Checklist.md", "Review-Checklist.md", "Refactor-Plan.md"],
        skills: ["repo-map", "repo-map", "review-helper"],
        handoffStyle: "structured",
        maxToolCalls: 48,
        toolLoopIterationBudget: 12,
        maxRunWallTimeMs: 600000,
        maxTotalTokens: 240000,
        maxHighRiskToolCalls: 8,
      },
      {
        id: "verifier",
        displayName: "Verifier",
        model: "primary",
        kind: "not-valid",
        workspaceBinding: "not-valid",
        sessionNamespace: "verifier scope",
        memoryMode: "not-valid",
        defaultRole: "not-valid",
        defaultPermissionMode: "not-valid",
        defaultMaxToolRiskLevel: "not-valid",
        handoffStyle: "not-valid",
        maxRunWallTimeMs: 0,
        maxTotalTokens: -1,
        maxHighRiskToolCalls: -1,
      },
    ],
  }), "utf-8");

  const profiles = await loadAgentProfiles(configPath);
  expect(profiles).toHaveLength(2);
  expect(profiles[0]).toMatchObject({
    id: "coder",
    kind: "resident",
    workspaceBinding: "current",
    workspaceDir: "coder",
    sessionNamespace: "coder-main",
    memoryMode: "isolated",
    whenToUse: ["需要改代码", "需要补测试"],
    defaultRole: "coder",
    defaultAllowedToolFamilies: ["workspace-read", "patch"],
    methods: ["Review-Checklist.md", "Refactor-Plan.md"],
    skills: ["repo-map", "review-helper"],
    handoffStyle: "structured",
    maxToolCalls: 48,
    toolLoopIterationBudget: 12,
    maxRunWallTimeMs: 600000,
    maxTotalTokens: 240000,
    maxHighRiskToolCalls: 8,
  });
  expect(profiles[1]).toMatchObject({
    id: "verifier",
    kind: undefined,
    workspaceBinding: undefined,
    sessionNamespace: "verifier scope",
    memoryMode: undefined,
    maxRunWallTimeMs: undefined,
    maxTotalTokens: undefined,
    maxHighRiskToolCalls: undefined,
  });

  expect(resolveAgentProfileMetadata(profiles[1]!)).toEqual({
    kind: "resident",
    workspaceBinding: "current",
    workspaceDir: "verifier",
    sessionNamespace: "verifier-scope",
    memoryMode: "hybrid",
    catalog: {
      whenToUse: [],
      defaultRole: "default",
      defaultPermissionMode: undefined,
      defaultAllowedToolFamilies: undefined,
      defaultMaxToolRiskLevel: undefined,
      methods: [],
      skills: [],
      handoffStyle: "summary",
    },
  });

  expect(resolveAgentProfileMetadata(profiles[0]!)).toEqual({
    kind: "resident",
    workspaceBinding: "current",
    workspaceDir: "coder",
    sessionNamespace: "coder-main",
    memoryMode: "isolated",
    catalog: {
      whenToUse: ["需要改代码", "需要补测试"],
      defaultRole: "coder",
      defaultPermissionMode: "confirm",
      defaultAllowedToolFamilies: ["workspace-read", "patch"],
      defaultMaxToolRiskLevel: "high",
      methods: ["Review-Checklist.md", "Refactor-Plan.md"],
      skills: ["repo-map", "review-helper"],
      handoffStyle: "structured",
    },
  });
});

test("loadAgentProfiles accepts UTF-8 BOM config files", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-agent-profile-bom-"));
  const configPath = path.join(tempDir, "agents.json");
  await fs.writeFile(configPath, "\uFEFF" + JSON.stringify({
    agents: [
      {
        id: "coder",
        displayName: "Coder",
        model: "primary",
      },
    ],
  }), "utf-8");

  const profiles = await loadAgentProfiles(configPath);
  expect(profiles).toHaveLength(1);
  expect(profiles[0]).toMatchObject({
    id: "coder",
    displayName: "Coder",
    model: "primary",
  });
});

test("resolveModelConfig accepts manual model override without falling back to named profiles", () => {
  const resolved = resolveModelConfig(
    "manual:gpt-5.1-mini",
    {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-primary",
      model: "gpt-5",
    },
    [
      {
        id: "kimi-k2.5",
        baseUrl: "https://api.moonshot.cn/v1",
        apiKey: "sk-kimi",
        model: "kimi-k2.5",
      },
    ],
  );

  expect(resolved).toEqual({
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-primary",
    model: "gpt-5.1-mini",
    source: "manual",
  });
});

test("buildBuiltinWorkerProfiles exposes commander and verifier defaults", () => {
  const profiles = buildBuiltinWorkerProfiles();
  expect(profiles).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: "commander",
      kind: "worker",
      defaultRole: "commander",
      defaultPermissionMode: "confirm",
      defaultAllowedToolFamilies: [
        "workspace-read",
        "browser",
        "memory",
        "goal-governance",
        "session-orchestration",
      ],
      handoffStyle: "structured",
    }),
    expect.objectContaining({
      id: "verifier",
      kind: "worker",
      defaultRole: "verifier",
      handoffStyle: "structured",
    }),
  ]));
});

test("resolveModelConfig preserves primary and named reasoning config", () => {
  const primaryResolved = resolveModelConfig(
    "primary",
    {
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-primary",
      model: "deepseek-v4-pro",
      wireApi: "responses",
      thinking: { type: "enabled" },
      reasoningEffort: "high",
      options: { num_ctx: 32768 },
      requestBodyExtras: {
        chat_template_kwargs: {
          enable_thinking: true,
        },
      },
    },
    [],
  );

  expect(primaryResolved).toEqual({
    baseUrl: "https://api.deepseek.com",
    apiKey: "sk-primary",
    model: "deepseek-v4-pro",
    wireApi: "responses",
    thinking: { type: "enabled" },
    reasoningEffort: "high",
    options: { num_ctx: 32768 },
    requestBodyExtras: {
      chat_template_kwargs: {
        enable_thinking: true,
      },
    },
    source: "primary",
  });

  const namedResolved = resolveModelConfig(
    "deepseek-fallback",
    {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-primary",
      model: "gpt-5",
    },
    [
      {
        id: "deepseek-fallback",
        baseUrl: "https://api.deepseek.com",
        apiKey: "sk-deepseek",
        model: "deepseek-v4-flash",
        thinking: { type: "enabled" },
        reasoningEffort: "max",
        options: { num_ctx: 16384 },
        requestBodyExtras: {
          chat_template_kwargs: {
            enable_thinking: true,
          },
        },
        messageLayout: "single_system_only",
      },
    ],
  );

  expect(namedResolved).toEqual({
    baseUrl: "https://api.deepseek.com",
    apiKey: "sk-deepseek",
    model: "deepseek-v4-flash",
    thinking: { type: "enabled" },
    reasoningEffort: "max",
    options: { num_ctx: 16384 },
    requestBodyExtras: {
      chat_template_kwargs: {
        enable_thinking: true,
      },
    },
    messageLayout: "single_system_only",
    source: "named",
  });
});
