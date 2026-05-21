import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, test } from "vitest";

import {
  buildConversationPromptSnapshotArtifact,
  getConversationPromptSnapshotArtifactPath,
  getConversationPromptSnapshotSystemPromptBlobRoot,
  getConversationPromptSnapshotDirectory,
  loadConversationPromptSnapshotArtifact,
  persistConversationPromptSnapshot,
  renderConversationPromptSnapshotText,
  type ConversationPromptSnapshotArtifact,
} from "./conversation-prompt-snapshot.js";

test("renderConversationPromptSnapshotText includes resident metadata summary when present", () => {
  const artifact: ConversationPromptSnapshotArtifact = {
    schemaVersion: 1,
    manifest: {
      conversationId: "agent:coder:main",
      runId: "run-1",
      agentId: "coder",
      createdAt: 123,
      persistedAt: 456,
      source: "runtime.prompt_snapshot",
    },
    summary: {
      messageCount: 1,
      systemPromptChars: 18,
      includesHookSystemPrompt: false,
      hasPrependContext: false,
      deltaCount: 0,
      deltaChars: 0,
      systemPromptEstimatedTokens: 5,
      deltaEstimatedTokens: 0,
      providerNativeSystemBlockCount: 0,
      providerNativeSystemBlockChars: 0,
      providerNativeSystemBlockEstimatedTokens: 0,
      tokenBreakdown: {
        systemPromptEstimatedChars: 18,
        systemPromptEstimatedTokens: 5,
        sectionEstimatedChars: 0,
        sectionEstimatedTokens: 0,
        droppedSectionEstimatedChars: 0,
        droppedSectionEstimatedTokens: 0,
        deltaEstimatedChars: 0,
        deltaEstimatedTokens: 0,
        providerNativeSystemBlockEstimatedChars: 0,
        providerNativeSystemBlockEstimatedTokens: 0,
      },
    },
    snapshot: {
      systemPrompt: "system prompt body",
      messages: [{ role: "system", content: "system prompt body" }],
      hookSystemPromptUsed: false,
      inputMeta: {
        residentProfile: {
          memoryMode: "hybrid",
          sessionNamespace: "coder-main",
        },
        memoryPolicy: {
          writeTarget: "private",
          readTargets: ["private", "shared"],
        },
      },
    },
  };

  const rendered = renderConversationPromptSnapshotText(artifact);
  expect(rendered).toContain("Resident Metadata");
  expect(rendered).toContain("\"memoryMode\": \"hybrid\"");
  expect(rendered).toContain("\"writeTarget\": \"private\"");
});

test("renderConversationPromptSnapshotText includes explainability sidecar when provided", () => {
  const artifact: ConversationPromptSnapshotArtifact = {
    schemaVersion: 1,
    manifest: {
      conversationId: "agent:coder:main",
      runId: "run-2",
      agentId: "coder",
      createdAt: 123,
      persistedAt: 456,
      source: "runtime.prompt_snapshot",
    },
    summary: {
      messageCount: 1,
      systemPromptChars: 18,
      includesHookSystemPrompt: false,
      hasPrependContext: false,
      deltaCount: 0,
      deltaChars: 0,
      systemPromptEstimatedTokens: 5,
      deltaEstimatedTokens: 0,
      providerNativeSystemBlockCount: 0,
      providerNativeSystemBlockChars: 0,
      providerNativeSystemBlockEstimatedTokens: 0,
      tokenBreakdown: {
        systemPromptEstimatedChars: 18,
        systemPromptEstimatedTokens: 5,
        sectionEstimatedChars: 0,
        sectionEstimatedTokens: 0,
        droppedSectionEstimatedChars: 0,
        droppedSectionEstimatedTokens: 0,
        deltaEstimatedChars: 0,
        deltaEstimatedTokens: 0,
        providerNativeSystemBlockEstimatedChars: 0,
        providerNativeSystemBlockEstimatedTokens: 0,
      },
    },
    snapshot: {
      systemPrompt: "system prompt body",
      messages: [{ role: "system", content: "system prompt body" }],
      hookSystemPromptUsed: false,
    },
  };

  const rendered = renderConversationPromptSnapshotText(artifact, {
    residentStateBinding: {
      workspaceScopeSummary: "custom workspace scope (repo-a) rooted at E:/state/workspaces/repo-a",
      stateScopeSummary: "private=E:/state/workspaces/repo-a/agents/coder; sessions=E:/state/workspaces/repo-a/agents/coder/sessions; shared=E:/state/workspaces/repo-a/team-memory",
    },
    launchExplainability: {
      catalogDefault: {
        role: "coder",
        permissionMode: "confirm",
        allowedToolFamilies: ["workspace-read", "workspace-write", "patch"],
        maxToolRiskLevel: "high",
        handoffStyle: "structured",
      },
      effectiveLaunch: {
        source: "catalog_default",
        agentId: "coder",
        profileId: "coder",
        role: "coder",
        permissionMode: "confirm",
        allowedToolFamilies: ["workspace-read", "workspace-write", "patch"],
        maxToolRiskLevel: "high",
        handoffStyle: "structured",
      },
    },
  });

  expect(rendered).toContain("Resident State Binding");
  expect(rendered).toContain("workspace scope: custom workspace scope (repo-a) rooted at E:/state/workspaces/repo-a");
  expect(rendered).toContain("Launch Explainability");
  expect(rendered).toContain("catalog default: role=coder");
  expect(rendered).toContain("effective launch: source=catalog_default, agent=coder");
});

test("buildConversationPromptSnapshotArtifact summarizes R5 auto-recall observability metrics", () => {
  const artifact = buildConversationPromptSnapshotArtifact({
    snapshot: {
      conversationId: "conversation-r5-auto-recall",
      createdAt: 123,
      systemPrompt: "system prompt body",
      messages: [{ role: "system", content: "system prompt body" }],
      hookSystemPromptUsed: false,
      prependContext: "auto recall block",
      deltas: [{
        id: "auto-recall",
        deltaType: "user-prelude",
        role: "user-prelude",
        source: "context-injection",
        text: "<auto-recall>\n- [memory] line a\n- [memory] line b\n</auto-recall>",
        metadata: {
          blockTag: "auto-recall",
          lineCount: 2,
          observability: {
            candidateCount: 2,
            keptCount: 2,
            injectedCount: 2,
            filteredOutCount: 0,
            minScore: 0.3,
            sourceClassMix: {
              curated: 1,
              raw: 1,
            },
            nodeHitCount: 1,
            nodeBackedCount: 1,
            chunkOnlyCount: 1,
            nodeBackedShare: 0.5,
            chunkOnlyShare: 0.5,
            nodeHitRate: 0.5,
            fallbackApplied: true,
            fallbackRate: 0.5,
            usefulHitCount: 1,
            usefulHitRate: 0.5,
            charsPerUsefulHit: 200,
            tokensPerUsefulHit: 50,
            sourceNoiseCount: 1,
            sourceNoiseRatio: 0.5,
            nodeSummarySavingsChars: 60,
            nodeSummarySavingsTokens: 15,
            nodeSummaryCompressionRatio: 0.4,
            injectionCharsBySourceClass: {
              curated: 120,
              raw: 80,
            },
            injectionTokensBySourceClass: {
              curated: 30,
              raw: 20,
            },
          },
        },
      }],
      inputMeta: {},
    },
    persistedAt: 456,
  });

  expect(artifact.summary.contextInjection).toMatchObject({
    prependContextChars: 17,
    totalBlockCount: 1,
    autoRecall: {
      candidateCount: 2,
      keptCount: 2,
      injectedCount: 2,
      usefulHitCount: 1,
      usefulHitRate: 0.5,
      nodeHitRate: 0.5,
      tokensPerUsefulHit: 50,
      fallbackRate: 0.5,
      sourceNoiseRatio: 0.5,
      nodeSummarySavingsTokens: 15,
      injectionCharsBySourceClass: {
        curated: 120,
        raw: 80,
      },
      injectionTokensBySourceClass: {
        curated: 30,
        raw: 20,
      },
    },
  });
});

test("persistConversationPromptSnapshot keeps only the latest persisted runs per regular conversation", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-prompt-snapshot-regular-"));
  const conversationId = "agent-default-main";

  try {
    for (let index = 1; index <= 22; index += 1) {
      await persistConversationPromptSnapshot({
        stateDir,
        snapshot: buildSnapshot({
          conversationId,
          runId: `run-${index}`,
          createdAt: index,
        }),
      });
    }

    const files = await fs.readdir(getConversationPromptSnapshotDirectory(stateDir, conversationId));
    expect(files).toHaveLength(20);
    expect(files).not.toContain("run-run-1.prompt-snapshot.json");
    expect(files).not.toContain("run-run-2.prompt-snapshot.json");
    expect(files).toContain("run-run-22.prompt-snapshot.json");
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test("persistConversationPromptSnapshot keeps only the latest persisted heartbeat snapshots globally", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-prompt-snapshot-heartbeat-"));

  try {
    for (let index = 1; index <= 7; index += 1) {
      await persistConversationPromptSnapshot({
        stateDir,
        snapshot: buildSnapshot({
          conversationId: `heartbeat-${index}`,
          runId: `heartbeat-run-${index}`,
          createdAt: index,
        }),
      });
    }

    await expect(fs.access(getConversationPromptSnapshotDirectory(stateDir, "heartbeat-1"))).rejects.toThrow();
    await expect(fs.access(getConversationPromptSnapshotDirectory(stateDir, "heartbeat-2"))).rejects.toThrow();

    for (let index = 3; index <= 7; index += 1) {
      const files = await fs.readdir(getConversationPromptSnapshotDirectory(stateDir, `heartbeat-${index}`));
      expect(files).toHaveLength(1);
      expect(files[0]).toBe(`run-heartbeat-run-${index}.prompt-snapshot.json`);
    }
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test("persistConversationPromptSnapshot removes aged prompt snapshots based on retention days", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-prompt-snapshot-age-"));
  const oldConversationId = "agent-old";
  const currentConversationId = "agent-current";
  const now = Date.now();
  const tenDaysAgo = new Date(now - (10 * 24 * 60 * 60 * 1000));

  try {
    const oldPersisted = await persistConversationPromptSnapshot({
      stateDir,
      snapshot: buildSnapshot({
        conversationId: oldConversationId,
        runId: "run-old",
        createdAt: 1,
      }),
      retention: {
        maxAgeDays: 30,
      },
    });
    await fs.utimes(oldPersisted.outputPath, tenDaysAgo, tenDaysAgo);

    await persistConversationPromptSnapshot({
      stateDir,
      snapshot: buildSnapshot({
        conversationId: currentConversationId,
        runId: "run-current",
        createdAt: 2,
      }),
      retention: {
        defaultMaxRunsPerConversation: 20,
        heartbeatMaxRuns: 5,
        maxAgeDays: 7,
        now,
      },
    });

    await expect(fs.access(oldPersisted.outputPath)).rejects.toThrow();
    await expect(fs.access(getConversationPromptSnapshotDirectory(stateDir, oldConversationId))).rejects.toThrow();
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test("persistConversationPromptSnapshot uses email-thread specific retention limit", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-prompt-snapshot-email-thread-"));
  const conversationId = "channel=email:scope=per-account-thread:provider=imap:account=default:thread=%3Cthread-001%40example.com%3E";

  try {
    for (let index = 1; index <= 4; index += 1) {
      await persistConversationPromptSnapshot({
        stateDir,
        snapshot: buildSnapshot({
          conversationId,
          runId: `run-email-${index}`,
          createdAt: index,
        }),
        retention: {
          defaultMaxRunsPerConversation: 20,
          heartbeatMaxRuns: 5,
          emailThreadMaxRuns: 2,
          maxAgeDays: 7,
        },
      });
    }

    const files = await fs.readdir(getConversationPromptSnapshotDirectory(stateDir, conversationId));
    expect(files).toHaveLength(2);
    expect(files.sort()).toEqual([
      "run-run-email-3.prompt-snapshot.json",
      "run-run-email-4.prompt-snapshot.json",
    ]);
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test("persistConversationPromptSnapshot writes a human-readable index for latest prompt snapshots", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-prompt-snapshot-index-"));

  try {
    await persistConversationPromptSnapshot({
      stateDir,
      snapshot: buildSnapshot({
        conversationId: "agent:default:main",
        runId: "run-main-1",
        createdAt: 100,
      }),
    });
    await persistConversationPromptSnapshot({
      stateDir,
      snapshot: buildSnapshot({
        conversationId: "goal:goal_alpha",
        runId: "run-goal-1",
        createdAt: 200,
      }),
    });

    const indexRoot = path.join(stateDir, "diagnostics", "prompt-snapshots");
    const indexJson = JSON.parse(await fs.readFile(path.join(indexRoot, "_index.json"), "utf-8"));
    const indexText = await fs.readFile(path.join(indexRoot, "_index.txt"), "utf-8");

    expect(indexJson.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        conversationId: "agent:default:main",
        sessionKind: "agent_main",
      }),
      expect.objectContaining({
        conversationId: "goal:goal_alpha",
        sessionKind: "goal",
      }),
    ]));
    expect(indexText).toContain("Prompt Snapshot Index");
    expect(indexText).toContain("agent:default:main");
    expect(indexText).toContain("goal:goal_alpha");
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test("persistConversationPromptSnapshot persists schema v2 with systemPromptRef and load expands the blob", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-prompt-snapshot-v2-"));
  const conversationId = "conv-v2";
  const runId = "run-v2";

  try {
    const persisted = await persistConversationPromptSnapshot({
      stateDir,
      snapshot: buildSnapshot({
        conversationId,
        runId,
        createdAt: 10,
        systemPrompt: "system prompt body v2",
      }),
    });

    const raw = JSON.parse(await fs.readFile(persisted.outputPath, "utf-8"));
    expect(raw.schemaVersion).toBe(2);
    expect(raw.snapshot.systemPrompt).toBeUndefined();
    expect(raw.snapshot.systemPromptRef).toMatchObject({
      hash: expect.stringMatching(/^sha256:/),
      chars: "system prompt body v2".length,
    });
    expect(raw.snapshot.messages[0]).toEqual({
      role: "system",
      contentRef: "systemPrompt",
    });

    const blobRoot = getConversationPromptSnapshotSystemPromptBlobRoot(stateDir);
    const blobFiles = await fs.readdir(blobRoot);
    expect(blobFiles).toHaveLength(1);

    const loaded = await loadConversationPromptSnapshotArtifact({
      stateDir,
      conversationId,
      runId,
    });
    expect(loaded?.schemaVersion).toBe(2);
    expect(loaded?.snapshot.systemPrompt).toBe("system prompt body v2");
    expect(loaded?.snapshot.messages[0]).toMatchObject({
      role: "system",
      content: "system prompt body v2",
    });
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test("persistConversationPromptSnapshot keeps first system message inline when content differs from system prompt", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-prompt-snapshot-inline-"));
  const conversationId = "conv-inline";
  const runId = "run-inline";

  try {
    const persisted = await persistConversationPromptSnapshot({
      stateDir,
      snapshot: {
        ...buildSnapshot({
          conversationId,
          runId,
          createdAt: 11,
          systemPrompt: "system prompt body",
        }),
        messages: [{ role: "system", content: "different system message" }],
      },
    });

    const raw = JSON.parse(await fs.readFile(persisted.outputPath, "utf-8"));
    expect(raw.snapshot.messages[0]).toEqual({
      role: "system",
      content: "different system message",
    });
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test("buildConversationPromptSnapshotArtifact drops duplicated token breakdown fields from input meta", () => {
  const artifact = buildConversationPromptSnapshotArtifact({
    snapshot: {
      agentId: "coder",
      conversationId: "agent:coder:main",
      runId: "run-dedup",
      createdAt: 123,
      systemPrompt: "system prompt body",
      messages: [{ role: "system", content: "system prompt body" }],
      hookSystemPromptUsed: false,
      inputMeta: {
        tokenBreakdown: { systemPromptEstimatedTokens: 999 },
        promptTokenBreakdown: { systemPromptEstimatedTokens: 888 },
        truncationReason: { code: "max_chars_limit" },
        residentProfile: {
          memoryMode: "hybrid",
        },
      },
    },
  });

  const rendered = renderConversationPromptSnapshotText(artifact);
  expect(rendered).toContain("Resident Metadata");
  expect(rendered).not.toContain("\"promptTokenBreakdown\"");
  expect(rendered).not.toContain("\"tokenBreakdown\"");
  expect(rendered).not.toContain("\"truncationReason\"");
});


test("loadConversationPromptSnapshotArtifact expands older schema v2 message content without contentRef", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-prompt-snapshot-v2-legacy-"));
  const conversationId = "conv-v2-legacy";
  const runId = "run-v2-legacy";
  const createdAt = 12;
  const systemPrompt = "legacy system prompt";

  try {
    const persisted = await persistConversationPromptSnapshot({
      stateDir,
      snapshot: buildSnapshot({
        conversationId,
        runId,
        createdAt,
        systemPrompt,
      }),
    });

    const raw = JSON.parse(await fs.readFile(persisted.outputPath, "utf-8"));
    raw.snapshot.messages = [{ role: "system", content: systemPrompt }];
    await fs.writeFile(persisted.outputPath, JSON.stringify(raw, null, 2), "utf-8");

    const loaded = await loadConversationPromptSnapshotArtifact({
      stateDir,
      conversationId,
      runId,
    });

    expect(loaded?.snapshot.systemPrompt).toBe(systemPrompt);
    expect(loaded?.snapshot.messages[0]).toEqual({
      role: "system",
      content: systemPrompt,
    });
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test("persistConversationPromptSnapshot reuses shared system prompt blobs and cleans orphaned blobs", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-prompt-snapshot-blob-"));
  const conversationIdA = "conv-a";
  const conversationIdB = "conv-b";

  try {
    await persistConversationPromptSnapshot({
      stateDir,
      snapshot: buildSnapshot({
        conversationId: conversationIdA,
        runId: "run-1",
        createdAt: 1,
        systemPrompt: "shared prompt",
      }),
    });
    await persistConversationPromptSnapshot({
      stateDir,
      snapshot: buildSnapshot({
        conversationId: conversationIdB,
        runId: "run-2",
        createdAt: 2,
        systemPrompt: "shared prompt",
      }),
    });

    const blobRoot = getConversationPromptSnapshotSystemPromptBlobRoot(stateDir);
    let blobFiles = await fs.readdir(blobRoot);
    expect(blobFiles).toHaveLength(1);

    await persistConversationPromptSnapshot({
      stateDir,
      snapshot: buildSnapshot({
        conversationId: conversationIdA,
        runId: "run-3",
        createdAt: 3,
        systemPrompt: "new prompt",
      }),
      retention: {
        defaultMaxRunsPerConversation: 1,
        heartbeatMaxRuns: 5,
        maxAgeDays: 0,
      },
    });

    const artifactAOld = getConversationPromptSnapshotArtifactPath({
      stateDir,
      conversationId: conversationIdA,
      runId: "run-1",
    });
    await expect(fs.access(artifactAOld)).rejects.toThrow();

    blobFiles = await fs.readdir(blobRoot);
    expect(blobFiles).toHaveLength(2);

    await persistConversationPromptSnapshot({
      stateDir,
      snapshot: buildSnapshot({
        conversationId: conversationIdB,
        runId: "run-4",
        createdAt: 4,
        systemPrompt: "new prompt 2",
      }),
      retention: {
        defaultMaxRunsPerConversation: 1,
        heartbeatMaxRuns: 5,
        maxAgeDays: 0,
      },
    });

    blobFiles = await fs.readdir(blobRoot);
    expect(blobFiles).toHaveLength(2);
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

function buildSnapshot(input: {
  conversationId: string;
  runId: string;
  createdAt: number;
  systemPrompt?: string;
}) {
  const systemPrompt = input.systemPrompt ?? `system:${input.runId}`;
  return {
    agentId: "default",
    conversationId: input.conversationId,
    runId: input.runId,
    createdAt: input.createdAt,
    systemPrompt,
    messages: [{ role: "system" as const, content: systemPrompt }],
  };
}
