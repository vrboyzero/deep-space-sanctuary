import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryManager } from "@belldandy/memory";

import { buildMindProfileRuntimePrelude } from "./mind-profile-runtime-prelude.js";

describe("buildMindProfileRuntimePrelude", () => {
  let stateDir: string;
  let sharedStateDir: string;
  let manager: MemoryManager;

  beforeEach(async () => {
    if (!process.env.OPENAI_API_KEY) {
      process.env.OPENAI_API_KEY = "test-placeholder-key";
    }

    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-mind-runtime-prelude-"));
    sharedStateDir = path.join(stateDir, "team-memory");
    const sessionsDir = path.join(stateDir, "sessions");
    const memoryDir = path.join(stateDir, "memory");
    const sharedMemoryDir = path.join(sharedStateDir, "memory");
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.mkdir(memoryDir, { recursive: true });
    await fs.mkdir(sharedMemoryDir, { recursive: true });

    manager = new MemoryManager({
      workspaceRoot: sessionsDir,
      additionalRoots: [memoryDir, sharedMemoryDir],
      additionalFiles: [
        path.join(stateDir, "MEMORY.md"),
        path.join(sharedStateDir, "MEMORY.md"),
      ],
      storePath: path.join(stateDir, "memory.sqlite"),
      modelsDir: path.join(stateDir, "models"),
      stateDir,
    });
  });

  afterEach(async () => {
    manager.close();
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  });

  it("builds runtime prelude for main sessions with stable mind signals", async () => {
    await fs.writeFile(path.join(stateDir, "USER.md"), "# USER\n**名字：** 小星\n偏好简洁结论。\n", "utf-8");
    await fs.writeFile(path.join(stateDir, "MEMORY.md"), "# MEMORY\n优先给短结论与验证口径。\n", "utf-8");
    manager.upsertProfileStateEntry({
      scope: "user",
      path: "preferences.response_style",
      value: "先给稳定结论，再展开说明",
      createdBy: "test",
    });
    manager.upsertProfileStateEntry({
      scope: "user",
      path: "workstyle.planning_preference",
      value: "先列计划，再推进实现",
      createdBy: "test",
    });
    (manager as any).store.upsertChunk({
      id: "private-memory-1",
      sourcePath: "MEMORY.md",
      sourceType: "file",
      memoryType: "core",
      content: "优先给短结论与验证口径。",
      agentId: "default",
      visibility: "private",
    });

    const result = await buildMindProfileRuntimePrelude({
      stateDir,
      agentId: "default",
      sessionKey: "agent:default:main",
      currentTurnText: "继续这个项目，先告诉我最关键的结论。",
      residentMemoryManagers: [{
        agentId: "default",
        stateDir,
        memoryMode: "hybrid",
        policy: {
          memoryMode: "hybrid",
          managerStateDir: stateDir,
          sharedStateDir,
          writeTarget: "private",
          readTargets: ["private", "shared"],
          includeSharedMemoryReads: true,
        },
        manager,
      } as any],
      config: {
        enabled: true,
        maxLines: 3,
        maxLineLength: 96,
        maxChars: 240,
        minSignalCount: 2,
      },
    });

    expect(result?.prependContext).toContain("<mind-profile-runtime");
    expect(result?.prependContext).toContain("<canonical-profile-state>");
    expect(result?.prependContext).toContain("preferences.response_style = 先给稳定结论，再展开说明");
    expect(result?.prependContext).toContain("workstyle.planning_preference = 先列计划，再推进实现");
    expect(result?.prependContext).toContain("<runtime-summary>");
    expect(result?.prependContext).toContain("User anchor: 小星");
    expect(result?.deltas?.[0]?.metadata).toMatchObject({
      blockTag: "mind-profile-runtime",
      sessionKind: "main",
      signalCount: expect.any(Number),
      // canonical profile state 是此 prelude 的更强激活依据，即使摘要信号也达到阈值。
      activationReason: "profile_state_present",
      profileStateLineCount: 2,
      summaryLineCount: 1,
      profileStatePaths: [
        "preferences.response_style",
        "workstyle.planning_preference",
      ],
      memoryFreshness: {
        summary: {
          available: true,
          itemCount: 1,
        },
        items: [
          expect.objectContaining({
            memoryClass: "profile_semantic",
          }),
        ],
      },
    });
  });

  it("injects canonical profile state even when summary signals stay below the normal threshold", async () => {
    manager.upsertProfileStateEntry({
      scope: "user",
      path: "preferences.response_style",
      value: "先给稳定结论，再展开说明",
      createdBy: "test",
    });

    const result = await buildMindProfileRuntimePrelude({
      stateDir,
      agentId: "default",
      sessionKey: "agent:default:main",
      residentMemoryManagers: [{
        agentId: "default",
        stateDir,
        memoryMode: "hybrid",
        policy: {
          memoryMode: "hybrid",
          managerStateDir: stateDir,
          sharedStateDir,
          writeTarget: "private",
          readTargets: ["private", "shared"],
          includeSharedMemoryReads: true,
        },
        manager,
      } as any],
      config: {
        enabled: true,
        maxLines: 3,
        maxLineLength: 96,
        maxChars: 240,
        minSignalCount: 2,
      },
    });

    expect(result?.prependContext).toContain("<canonical-profile-state>");
    expect(result?.prependContext).toContain("preferences.response_style = 先给稳定结论，再展开说明");
    expect(result?.deltas?.[0]?.metadata).toMatchObject({
      activationReason: "profile_state_present",
      profileStateLineCount: 1,
    });
  });

  it("does not inject runtime prelude for goal sessions", async () => {
    await fs.writeFile(path.join(stateDir, "USER.md"), "# USER\n**名字：** 小星\n", "utf-8");

    const result = await buildMindProfileRuntimePrelude({
      stateDir,
      agentId: "default",
      sessionKey: "goal:goal_alpha",
      residentMemoryManagers: [{
        agentId: "default",
        stateDir,
        memoryMode: "hybrid",
        policy: {
          memoryMode: "hybrid",
          managerStateDir: stateDir,
          sharedStateDir,
          writeTarget: "private",
          readTargets: ["private", "shared"],
          includeSharedMemoryReads: true,
        },
        manager,
      } as any],
      config: {
        enabled: true,
        maxLines: 3,
        maxLineLength: 96,
        maxChars: 240,
        minSignalCount: 2,
      },
    });

    expect(result).toBeUndefined();
  });

  it("does not inject when stable mind signals are too weak", async () => {
    const result = await buildMindProfileRuntimePrelude({
      stateDir,
      agentId: "default",
      sessionKey: "agent:default:main",
      residentMemoryManagers: [{
        agentId: "default",
        stateDir,
        memoryMode: "hybrid",
        policy: {
          memoryMode: "hybrid",
          managerStateDir: stateDir,
          sharedStateDir,
          writeTarget: "private",
          readTargets: ["private", "shared"],
          includeSharedMemoryReads: true,
        },
        manager,
      } as any],
      config: {
        enabled: true,
        maxLines: 3,
        maxLineLength: 96,
        maxChars: 240,
        minSignalCount: 2,
      },
    });

    expect(result).toBeUndefined();
  });
});
