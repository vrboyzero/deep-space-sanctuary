import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { listFaqisTool } from "./builtin/list-faqis.js";
import { switchFaqiTool } from "./builtin/switch-faqi.js";
import {
  ensureFaqiDir,
  indexFaqiDefinitions,
  loadFaqiDefinitions,
  readFaqiState,
  resolveToolWhitelistFromFaqi,
  setCurrentFaqiForAgent,
  writeFaqiState,
} from "./faqi.js";

async function createTempStateDir(prefix: string): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await ensureFaqiDir(tempDir);
  return tempDir;
}

describe("faqi helpers", () => {
  it("loads valid FAQI definitions and reports invalid files", async () => {
    const stateDir = await createTempStateDir("belldandy-faqi-");
    await fs.writeFile(path.join(stateDir, "faqis", "safe-dev.md"), [
      "# 【FAQI | 法器 | safe-dev】",
      "",
      "用途：安全开发",
      "",
      "## tools",
      "",
      "- file_read",
      "- file_write",
      "- file_read",
    ].join("\n"), "utf-8");
    await fs.writeFile(path.join(stateDir, "faqis", "broken.md"), "# broken", "utf-8");

    const loaded = await loadFaqiDefinitions(stateDir);

    expect(loaded.definitions).toHaveLength(1);
    expect(loaded.definitions[0]).toMatchObject({
      name: "safe-dev",
      purpose: "安全开发",
      toolNames: ["file_read", "file_write"],
    });
    expect(loaded.issues).toHaveLength(1);
    expect(loaded.issues[0]?.name).toBe("broken");
  });

  it("accepts grouped tool comments inside the tools section", async () => {
    const stateDir = await createTempStateDir("belldandy-faqi-groups-");
    await fs.writeFile(path.join(stateDir, "faqis", "full-dev.md"), [
      "# 【FAQI | 法器 | full-dev】",
      "",
      "用途：带分组标题的 FAQI",
      "",
      "## tools",
      "",
      "# === 基础文件操作 ===",
      "- file_read",
      "- file_write",
      "",
      "# === 系统执行 ===",
      "- run_command",
      "",
      "## notes",
      "后续段落不应被当成工具",
      "- not_a_tool_after_notes",
    ].join("\n"), "utf-8");

    const loaded = await loadFaqiDefinitions(stateDir);

    expect(loaded.issues).toHaveLength(0);
    expect(loaded.definitions).toHaveLength(1);
    expect(loaded.definitions[0]).toMatchObject({
      name: "full-dev",
      toolNames: ["file_read", "file_write", "run_command"],
    });
  });

  it("resolves tool whitelist from currentFaqi and falls back to toolWhitelist", async () => {
    const stateDir = await createTempStateDir("belldandy-faqi-resolution-");
    await fs.writeFile(path.join(stateDir, "faqis", "safe-dev.md"), [
      "## tools",
      "- file_read",
      "- apply_patch",
    ].join("\n"), "utf-8");
    const loaded = await loadFaqiDefinitions(stateDir);
    const definitions = indexFaqiDefinitions(loaded.definitions);

    const withFaqi = resolveToolWhitelistFromFaqi({
      agentId: "coder",
      state: {
        agents: {
          coder: { currentFaqi: "safe-dev" },
        },
      },
      definitions,
      fallbackToolWhitelist: ["file_read", "run_command"],
    });
    expect(withFaqi.source).toBe("faqi");
    expect(withFaqi.toolWhitelist).toEqual(["file_read", "apply_patch"]);

    const fallback = resolveToolWhitelistFromFaqi({
      agentId: "coder",
      state: {
        agents: {
          coder: { currentFaqi: "missing-dev" },
        },
      },
      definitions,
      fallbackToolWhitelist: ["file_read", "run_command"],
    });
    expect(fallback.source).toBe("toolWhitelist");
    expect(fallback.toolWhitelist).toEqual(["file_read", "run_command"]);
    expect(fallback.currentFaqi).toBe("missing-dev");
  });

  it("only resolves tool whitelist and does not imply ownership over methods or skills", async () => {
    const stateDir = await createTempStateDir("belldandy-faqi-scope-");
    await fs.writeFile(path.join(stateDir, "faqis", "safe-dev.md"), [
      "## tools",
      "- file_read",
      "- apply_patch",
    ].join("\n"), "utf-8");
    const loaded = await loadFaqiDefinitions(stateDir);
    const definitions = indexFaqiDefinitions(loaded.definitions);

    const originalMethods = ["multi-agent-review.md"];
    const originalSkills = ["orchestration-playbook"];

    const resolved = resolveToolWhitelistFromFaqi({
      agentId: "coder",
      state: {
        agents: {
          coder: { currentFaqi: "safe-dev" },
        },
      },
      definitions,
      fallbackToolWhitelist: ["file_read", "run_command"],
    });

    expect(resolved.source).toBe("faqi");
    expect(resolved.toolWhitelist).toEqual(["file_read", "apply_patch"]);
    expect(originalMethods).toEqual(["multi-agent-review.md"]);
    expect(originalSkills).toEqual(["orchestration-playbook"]);
    expect(Object.keys(resolved)).not.toContain("methods");
    expect(Object.keys(resolved)).not.toContain("skills");
  });
});

describe("faqi tools", () => {
  it("switch_faqi updates only the current agent state", async () => {
    const stateDir = await createTempStateDir("belldandy-faqi-switch-");
    await fs.writeFile(path.join(stateDir, "faqis", "safe-dev.md"), [
      "## tools",
      "- file_read",
      "- apply_patch",
    ].join("\n"), "utf-8");
    await writeFaqiState(stateDir, {
      agents: {
        default: { currentFaqi: "default-kit" },
      },
    });

    const result = await switchFaqiTool.execute(
      { faqi_name: "safe-dev" },
      {
        conversationId: "conv-1",
        workspaceRoot: stateDir,
        stateDir,
        agentId: "coder",
        policy: {
          allowedPaths: [],
          deniedPaths: [],
          allowedDomains: [],
          deniedDomains: [],
          maxTimeoutMs: 30_000,
          maxResponseBytes: 512_000,
        },
      },
    );

    expect(result.success).toBe(true);
    const state = await readFaqiState(stateDir);
    expect(state.agents?.default?.currentFaqi).toBe("default-kit");
    expect(state.agents?.coder?.currentFaqi).toBe("safe-dev");
  });

  it("list_faqis marks the current FAQI and warns about invalid currentFaqi", async () => {
    const stateDir = await createTempStateDir("belldandy-faqi-list-");
    await fs.writeFile(path.join(stateDir, "faqis", "safe-dev.md"), [
      "用途：安全开发",
      "",
      "## tools",
      "- file_read",
      "- apply_patch",
    ].join("\n"), "utf-8");
    const nextState = setCurrentFaqiForAgent({}, "coder", "missing-dev");
    await writeFaqiState(stateDir, nextState);

    const result = await listFaqisTool.execute(
      {},
      {
        conversationId: "conv-2",
        workspaceRoot: stateDir,
        stateDir,
        agentId: "coder",
        policy: {
          allowedPaths: [],
          deniedPaths: [],
          allowedDomains: [],
          deniedDomains: [],
          maxTimeoutMs: 30_000,
          maxResponseBytes: 512_000,
        },
      },
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("Current FAQI: missing-dev");
    expect(result.output).toContain("safe-dev");
    expect(result.output).toContain("当前运行时会回退到旧 toolWhitelist");
  });
});
