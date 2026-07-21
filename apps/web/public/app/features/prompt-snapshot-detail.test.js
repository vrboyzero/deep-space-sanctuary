// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { createPromptSnapshotDetailView } from "./prompt-snapshot-detail.js";

describe("prompt snapshot detail rendering", () => {
  it("renders sidecar summaries inside the snapshot detail block", () => {
    const detail = createPromptSnapshotDetailView({
      ownerDocument: document,
      formatDateTime: (value) => String(value),
      t: (_key, _params, fallback) => fallback,
    }).render({
      snapshot: {
        manifest: {
          conversationId: "sub_task_1",
          runId: "run-1",
          agentId: "coder",
          createdAt: 1712000000000,
        },
        summary: {
          messageCount: 2,
          deltaCount: 1,
          providerNativeSystemBlockCount: 1,
          tokenBreakdown: {
            systemPromptEstimatedTokens: 88,
          },
          contextInjection: {
            prependContextChars: 480,
            totalBlockCount: 3,
            blockTags: ["current-turn", "auto-recall"],
            autoRecall: {
              candidateCount: 3,
              keptCount: 2,
              filteredOutCount: 1,
              minScore: 0.42,
              topHitIds: ["mem-curated", "mem-derived"],
              sourceClassMix: {
                curated: 1,
                derived: 1,
              },
            },
          },
        },
        snapshot: {
          systemPrompt: "Follow the repo conventions.",
          messages: [
            { role: "system", content: "Follow the repo conventions." },
            { role: "user", content: "Ship the patch." },
          ],
          deltas: [
            {
              id: "role-execution-policy",
              deltaType: "role-execution-policy",
              text: "Operate as verifier.",
            },
            {
              id: "runtime-identity-authority",
              deltaType: "runtime-identity-authority",
              text: "## Runtime Identity Authority",
              metadata: {
                authorityMode: "verifiable_only",
                actorRelation: "subordinate",
                recommendedAction: "guide_only",
                currentLabel: "首席执行官 (CEO)",
                teamId: "team-42",
              },
            },
            {
              id: "team-completion-gate-call-1",
              deltaType: "team-completion-gate",
              text: "## Team Completion Gate",
              metadata: {
                completionGate: {
                  status: "pending",
                  finalFanInVerdict: "hold_fan_in",
                  summary: "Team completion gate pending: accepted=lane_1; retry=lane_2.",
                },
              },
            },
            {
              id: "tool-post-verification-call-1",
              deltaType: "tool-post-verification",
              text: "## Delegation Result Review",
              metadata: {
                delegationResult: {
                  followUpStrategy: {
                    mode: "single",
                    summary: "Suggested next step: retry with follow-up delegation: Agent verifier.",
                    recommendedRuntimeAction: "retry_delegation",
                    highPriorityLabels: ["Agent verifier"],
                    verifierHandoffLabels: ["Agent verifier"],
                    items: [
                      {
                        label: "Agent verifier",
                        action: "retry",
                        recommendedRuntimeAction: "retry_delegation",
                        priority: "high",
                      },
                    ],
                  },
                },
              },
            },
          ],
          providerNativeSystemBlocks: [
            {
              id: "provider-native-static-capability",
              blockType: "static-capability",
              text: "Follow the repo conventions.",
              sourceSectionIds: ["core", "tool-use-policy"],
              sourceDeltaIds: [],
            },
            {
              id: "provider-native-dynamic-runtime",
              blockType: "dynamic-runtime",
              text: "Operate as verifier.",
              sourceSectionIds: ["role-execution-policy", "team-shared-state-policy"],
              sourceDeltaIds: ["role-execution-policy", "team-completion-gate-call-1"],
            },
          ],
        },
      },
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
    }, "sub_task_1");
    const html = detail?.textContent ?? "";

    expect(html).toContain("Prompt Snapshot");
    expect(html).toContain("custom workspace scope (repo-a) rooted at E:/state/workspaces/repo-a");
    expect(html).toContain("catalog default: role=coder");
    expect(html).toContain("effective launch: source=catalog_default, agent=coder");
    expect(html).toContain("Follow the repo conventions.");
    expect(html).toContain("Prepend Context Chars");
    expect(html).toContain("480");
    expect(html).toContain("Context Injection Blocks");
    expect(html).toContain("3");
    expect(html).toContain("Auto Recall");
    expect(html).toContain("2/3");
    expect(html).toContain("Context Injection Block Tags");
    expect(html).toContain("current-turn");
    expect(html).toContain("auto-recall");
    expect(html).toContain("Auto Recall Summary");
    expect(html).toContain("kept=2/3");
    expect(html).toContain("filtered=1");
    expect(html).toContain("minScore=0.42");
    expect(html).toContain("topHits=mem-curated, mem-derived");
    expect(html).toContain("sourceMix=curated:1, derived:1");
    expect(html).toContain("Active Prompt Sections");
    expect(html).toContain("core");
    expect(html).toContain("tool-use-policy");
    expect(html).toContain("Active Prompt Deltas");
    expect(html).toContain("role-execution-policy (role-execution-policy)");
    expect(html).toContain("Provider Block Routing");
    expect(html).toContain("dynamic-runtime, sections=role-execution-policy+team-shared-state-policy, deltas=role-execution-policy+team-completion-gate-call-1");
    expect(html).toContain("Team Coordination");
    expect(html).toContain("sections=team-shared-state-policy");
    expect(html).toContain("team-completion-gate (team-completion-gate-call-1)");
    expect(html).toContain("completion_gate=pending; verdict=hold_fan_in");
    expect(html).toContain("Follow-Up Strategy");
    expect(html).toContain("tool-post-verification: runtime=retry_delegation; high=Agent verifier; verifier_handoff=Agent verifier");
    expect(html).toContain("Agent verifier: retry -> retry_delegation [high]");
    expect(html).toContain("Identity Authority");
    expect(html).toContain("runtime-identity-authority");
    expect(html).toContain("mode=verifiable_only; relation=subordinate; action=guide_only");
    expect(html).toContain("current_label=首席执行官 (CEO)");
    expect(html).toContain("team_id=team-42");
    expect(html).toContain("#1 system");
    expect(detail?.getAttribute("data-subtask-prompt-snapshot-session")).toBe("sub_task_1");
  });
});
