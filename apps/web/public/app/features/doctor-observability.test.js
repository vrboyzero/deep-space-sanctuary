// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildDoctorChatSummary, renderDoctorObservabilityCards } from "./doctor-observability.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("doctor observability formatting", () => {
  it("formats preflight compression governance diagnostics", () => {
    const summary = buildDoctorChatSummary({
      preflightCompressionGovernance: {
        summary: { status: "warn", headline: "preflight=attachments" },
        config: {
          enabled: true,
          mode: "attachments",
          attachmentThresholdChars: 1200,
          attachmentReference: "sidecar",
          persistentReferenceStoreEnabled: true,
        },
        storage: {
          sidecars: {
            totalSidecars: 2,
            expiredCount: 1,
            overLimitCount: 0,
            retentionMs: 604800000,
            maxEntries: 512,
            invalidCount: 0,
          },
          persistentReferences: {
            totalReferences: 3,
            expiredCount: 0,
            overLimitCount: 1,
            ttlMs: 86400000,
            maxEntries: 128,
            invalidCount: 0,
          },
        },
      },
    }, (_key, _params, fallback) => fallback);

    expect(summary.join("\n")).toContain("Preflight Compression");
    expect(summary.join("\n")).toContain("sidecars=2 / toolRefs=3");
    expect(summary.join("\n")).toContain("sidecar cleanup pending=1");
    expect(summary.join("\n")).toContain("tool reference cleanup pending=1");
  });

  it("builds a user-facing doctor summary for prompt and tool observability", () => {
    const lines = buildDoctorChatSummary({
      promptObservability: {
        residentStateBinding: {
          workspaceScopeSummary: "current workspace scope (default) rooted at E:/state",
          stateScopeSummary: "root-default private=E:/state; sessions=E:/state/sessions; shared=E:/state/team-memory",
        },
        launchExplainability: {
          catalogDefault: {
            role: "default",
            permissionMode: "confirm",
            allowedToolFamilies: ["workspace-read", "patch"],
            maxToolRiskLevel: "high",
            handoffStyle: "summary",
          },
          effectiveLaunch: {
            source: "catalog_default",
            agentId: "default",
            role: "default",
            permissionMode: "confirm",
            allowedToolFamilies: ["workspace-read", "patch"],
            maxToolRiskLevel: "high",
            handoffStyle: "summary",
          },
          runtimeResilience: {
            configuredFallbackCount: 1,
            alertLevel: "warn",
            alertCode: "recent_degrade",
            alertMessage: "Latest runtime required retry/fallback to recover.",
            dominantReason: "server_error",
            reasonClusterSummary: "server_error + timeout",
            mixedSignalHint: "Mixed 5xx + timeout signals suggest upstream instability; verify provider health and network latency before widening retries.",
            recoveryHint: "5xx instability dominates; keep fallback ready and verify provider health before trusting the primary route.",
            latestStatus: "success",
            latestSignal: "openai_chat/primary_chat",
            latestRoute: "backup/kimi-k2",
            latestRouteBehavior: "switched primary/gpt-4.1 -> backup/kimi-k2",
            latestReasonSummary: "server_error=1, timeout=1",
            overallReasonSummary: "server_error=1, timeout=1, rate_limit=1",
            totalsSummary: "observed=3, degraded=1, failed=0, retry=1, switch=1, cooldown=0",
            compactionRoute: "openai.com/gpt-4.1-mini",
            latestHeadline: "Latest run recovered via fallback (backup/kimi-k2); retry=1, switch=1, cooldown=0.",
          },
          delegationReason: null,
        },
        summary: {
          scope: "run",
          agentId: "default",
          conversationId: "conv-1",
          cacheSupport: "supported",
          providerCacheEligible: true,
          systemPromptFingerprint: "abc123fingerprint",
          structureSignature: "sig-123",
          prefixDrift: {
            status: "drifted",
            reasons: ["system_prompt_fingerprint_changed", "section_id_order_changed"],
          },
          prefixWarmState: {
            status: "warming",
            reason: "matching_prefix_recently_seen_may_still_be_warming",
            previousAgeMs: 1200,
          },
          orderingGuard: {
            status: "risk",
            reasons: ["dynamic_runtime_sections_present", "tool_contract_list_injected"],
          },
          warmupCoordination: {
            status: "warming",
            recommendation: "delay_if_possible",
            reason: "matching_prefix_recent_but_ordering_risk_present",
          },
          cacheFamilyAffinity: {
            status: "aligned",
            reason: "same_cache_family_as_previous",
          },
          counts: {
            sectionCount: 12,
            deltaCount: 2,
            providerNativeSystemBlockCount: 4,
          },
          promptSizes: {
            finalChars: 3200,
          },
          tokenBreakdown: {
            systemPromptEstimatedTokens: 800,
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
          truncationReason: {
            code: "max_chars_limit",
            droppedSectionCount: 2,
            droppedSectionLabels: ["methodology", "workspace-dir"],
            maxChars: 3000,
          },
        },
      },
      queryRuntime: {
        traces: [
          {
            method: "message.send",
            stages: [
              {
                stage: "completed",
                detail: {
                  localPromptEstimate: {
                    systemPromptTokens: 41651,
                    contextTokens: 1902,
                    totalPromptTokens: 43553,
                  },
                  providerRawUsage: {
                    promptTokens: 35338,
                    completionTokens: 81,
                    totalTokens: 35419,
                  },
                  requestShape: {
                    messageCount: 23,
                    systemMessageCount: 7,
                    toolSchemaCount: 66,
                  },
                  usageCalibration: {
                    estimatedPromptTokens: 1800,
                    actualInputTokens: 2100,
                    modelCalls: 2,
                    averageInputTokensPerCall: 1050,
                    deltaTokens: -750,
                    deltaRatio: -0.4167,
                    status: "over_estimated",
                  },
                },
              },
            ],
          },
        ],
      },
      toolBehaviorObservability: {
        visibilityContext: {
          launchExplainability: {
            catalogDefault: {
              role: "coder",
              permissionMode: "confirm",
              allowedToolFamilies: ["workspace-read", "workspace-write", "patch"],
              maxToolRiskLevel: "high",
              handoffStyle: "structured",
            },
            effectiveLaunch: {
              source: "runtime_launch_spec",
              agentId: "coder",
              profileId: "coder",
              role: "coder",
              permissionMode: "plan",
              allowedToolFamilies: ["workspace-read", "patch"],
              maxToolRiskLevel: "medium",
              policySummary: "permission=plan, patch-only",
              handoffStyle: "structured",
            },
            delegationReason: {
              source: "goal_subtask",
              intentKind: "goal_execution",
              intentSummary: "整理工具治理摘要",
              expectedDeliverableSummary: "返回治理摘要",
              aggregationMode: "main_agent_summary",
              contextKeys: ["goalId", "taskId"],
              sourceAgentIds: ["planner"],
            },
          },
          residentStateBinding: {
            workspaceScopeSummary: "current workspace scope (default) rooted at E:/state",
            stateScopeSummary: "root-default private=E:/state; sessions=E:/state/sessions; shared=E:/state/team-memory",
          },
        },
        counts: {
          includedContractCount: 5,
          visibleToolContractCount: 5,
        },
        included: ["run_command", "apply_patch"],
        experiment: {
          disabledContractNamesApplied: ["delegate_parallel"],
        },
      },
      toolContractV2Observability: {
        summary: {
          totalCount: 6,
          missingV2Count: 1,
          highRiskCount: 2,
          confirmRequiredCount: 3,
          governedTools: ["run_command", "apply_patch"],
          missingV2Tools: ["beta_builtin"],
        },
      },
      residentAgents: {
        summary: {
          totalCount: 2,
          activeCount: 1,
          runningCount: 1,
          idleCount: 1,
          backgroundCount: 0,
          errorCount: 0,
          digestReadyCount: 1,
          digestUpdatedCount: 1,
          digestIdleCount: 0,
          digestMissingCount: 0,
          recentTaskLinkedCount: 1,
          recentSubtaskLinkedCount: 1,
          experienceUsageLinkedCount: 1,
          catalogAnnotatedCount: 1,
          structuredHandoffCount: 1,
          skillHintedCount: 1,
          headline: "2 resident agent(s), active=1, isolated=1, shared=0, hybrid=1, running=1, background=0, idle=1, digest-ready=1, digest-updated=1, task-linked=1, subtask-linked=1, usage-linked=1",
          sharedReadEnabledCount: 1,
          memoryModeCounts: {
            isolated: 1,
            shared: 0,
            hybrid: 1,
          },
          writeTargetCounts: {
            private: 2,
            shared: 0,
          },
          sharedGovernanceCounts: {
            pendingCount: 1,
            claimedCount: 1,
            approvedCount: 2,
            rejectedCount: 0,
            revokedCount: 0,
          },
        },
        agents: [
          {
            id: "default",
            displayName: "Belldandy",
            memoryMode: "hybrid",
            sessionNamespace: "default",
            status: "running",
            conversationDigest: {
              status: "updated",
              pendingMessageCount: 3,
            },
            recentTaskDigest: {
              recentCount: 1,
              latestTaskId: "task-1",
              latestTitle: "收口 resident 任务观测",
              latestStatus: "success",
            },
            recentSubtaskDigest: {
              recentCount: 1,
              latestTaskId: "subtask-1",
              latestSummary: "整理 resident 连续观测摘要卡",
              latestStatus: "running",
              latestAgentId: "coder",
            },
            experienceUsageDigest: {
              usageCount: 2,
              methodCount: 1,
              skillCount: 1,
              latestAssetType: "method",
              latestAssetKey: "resident-observability-playbook.md",
              latestTaskId: "task-1",
            },
            memoryPolicy: {
              writeTarget: "private",
              readTargets: ["private", "shared"],
            },
            catalog: {
              defaultRole: "default",
              defaultPermissionMode: "confirm",
              defaultMaxToolRiskLevel: "high",
              skills: ["resident-observability"],
              whenToUse: ["收口 resident 主线"],
              handoffStyle: "summary",
            },
            launchExplainability: {
              catalogDefault: {
                role: "default",
                permissionMode: "confirm",
                allowedToolFamilies: ["workspace-read", "patch"],
                maxToolRiskLevel: "high",
                handoffStyle: "summary",
                skills: ["resident-observability"],
                whenToUse: ["收口 resident 主线"],
              },
              effectiveLaunch: {
                source: "catalog_default",
                agentId: "default",
                profileId: "default",
                role: "default",
                permissionMode: "confirm",
                allowedToolFamilies: ["workspace-read", "patch"],
                maxToolRiskLevel: "high",
                handoffStyle: "summary",
              },
            },
            sharedGovernance: {
              pendingCount: 1,
              claimedCount: 1,
              approvedCount: 2,
              rejectedCount: 0,
              revokedCount: 0,
            },
          },
          {
            id: "coder",
            displayName: "Coder",
            memoryMode: "isolated",
            sessionNamespace: "coder-main",
            status: "idle",
            conversationDigest: {
              status: "ready",
              pendingMessageCount: 0,
            },
            memoryPolicy: {
              writeTarget: "private",
              readTargets: ["private"],
            },
            catalog: {
              defaultRole: "coder",
              defaultPermissionMode: "confirm",
              defaultMaxToolRiskLevel: "high",
              skills: [],
              whenToUse: [],
              handoffStyle: "structured",
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
          },
        ],
      },
      mindProfileSnapshot: {
        summary: {
          available: true,
          selectedAgentId: "default",
          headline: "user ready, private 2, shared 1, digest 1/1, usage 1",
          activeResidentCount: 1,
          digestReadyCount: 1,
          digestUpdatedCount: 1,
          usageLinkedCount: 1,
          privateMemoryCount: 2,
          sharedMemoryCount: 1,
          summaryLineCount: 3,
          hasUserProfile: true,
          hasPrivateMemoryFile: true,
          hasSharedMemoryFile: true,
        },
        profile: {
          summaryLines: [
            "USER.md: 喜欢简洁状态表与短结论。",
            "Private MEMORY.md: 优先把大文件主体逻辑外移。",
            "Shared MEMORY.md: 外发统一走 sessionKey / binding。",
          ],
        },
        conversation: {
          topResidents: [
            {
              agentId: "default",
              headline: "Belldandy: status=running, digest=updated, pending=3",
            },
          ],
        },
        memory: {
          recentMemorySnippets: [
            {
              scope: "private",
              text: "优先把大文件主体逻辑外移。",
            },
            {
              scope: "shared",
              text: "外发统一走 sessionKey / binding。",
            },
          ],
        },
      },
      memoryFreshness: {
        summary: {
          available: true,
          headline: "当前治理队列存在待收口项",
          reviewRequiredCount: 1,
          staleCount: 0,
          supersededCount: 0,
          activeCount: 2,
        },
        items: [
          {
            memoryClass: "governance",
            status: "review_required",
            freshnessHeadline: "当前治理队列存在待收口项",
          },
          {
            memoryClass: "profile_semantic",
            status: "active",
            freshnessHeadline: "Profile semantic is active.",
          },
        ],
      },
      learningReviewInput: {
        summary: {
          available: true,
          headline: "memory=4, candidate=1, review=0, nudges=2",
          memorySignalCount: 4,
          candidateSignalCount: 1,
          reviewSignalCount: 0,
          nudgeCount: 2,
        },
        summaryLines: [
          "Mind snapshot: USER.md: 喜欢简洁状态表与短结论。",
          "Profile anchor: USER.md: 喜欢简洁状态表与短结论。",
        ],
        nudges: [
          "当前输入已具备最小 learning/review 条件，可继续进入 candidate / governance 审阅。",
          "优先回顾高频 methods/skills 的最新 usage。",
        ],
      },
      learningReviewNudgeRuntime: {
        summary: {
          available: true,
          triggered: true,
          headline: "latest foreground run triggered learning/review nudge; session=goal_node; source=explicit_user_intent+goal_review_pressure; signals=candidate/review; lines=1",
          sessionKind: "goal_node",
          triggerSources: ["explicit_user_intent", "goal_review_pressure"],
          signalKinds: ["candidate", "review"],
          lineCount: 1,
        },
        latest: {
          conversationId: "goal:goal_alpha:node:node_1:run:run_1",
          runId: "run_1",
          createdAt: 1710000130000,
          currentTurnPreview: "请帮我整理这轮长期任务的经验候选",
        },
      },
      dreamRuntime: {
        requested: {
          agentId: "default",
          defaultConversationId: "agent:default:main",
        },
        availability: {
          enabled: true,
          available: true,
          model: "gpt-4.1-mini",
        },
        headline: "Latest dream completed at 2026-04-19T12:05:00.000Z.",
        autoSummary: {
          triggerMode: "heartbeat",
          attemptedAt: "2026-04-19T12:00:00.000Z",
          executed: false,
          skipCode: "cooldown_active",
          skipReason: "cooldown active until 2026-04-19T18:05:00.000Z",
          cooldownUntil: "2026-04-19T18:05:00.000Z",
          signal: {
            lastDreamCursor: {
              digestGeneration: 0,
              sessionMemoryMessageCount: 0,
              sessionMemoryToolCursor: 0,
              taskChangeSeq: 0,
              memoryChangeSeq: 0,
            },
            currentCursor: {
              digestGeneration: 2,
              sessionMemoryMessageCount: 6,
              sessionMemoryToolCursor: 2,
              taskChangeSeq: 3,
              memoryChangeSeq: 2,
            },
            digestGenerationDelta: 2,
            sessionMemoryMessageDelta: 6,
            sessionMemoryToolDelta: 2,
            sessionMemoryRevisionDelta: 2,
            taskChangeSeqDelta: 3,
            memoryChangeSeqDelta: 2,
            changeBudget: 19,
          },
        },
        state: {
          status: "idle",
          autoStats: {
            attemptedCount: 5,
            executedCount: 2,
            skippedCount: 3,
            skipCodeCounts: {
              cooldown_active: 1,
              insufficient_signal: 2,
            },
            signalGateCounts: {
              digest_generation: 1,
              change_budget: 1,
              insufficient_signal: 2,
            },
            byTriggerMode: {
              heartbeat: {
                attemptedCount: 3,
                executedCount: 1,
                skippedCount: 2,
              },
              cron: {
                attemptedCount: 2,
                executedCount: 1,
                skippedCount: 1,
              },
            },
          },
          lastInput: {
            sourceCounts: {
              recentTaskCount: 3,
              recentDurableMemoryCount: 5,
              recentExperienceUsageCount: 2,
            },
          },
          recentRuns: [
            {
              id: "dream-1",
              status: "completed",
              requestedAt: "2026-04-19T12:00:00.000Z",
              finishedAt: "2026-04-19T12:05:00.000Z",
              summary: "收口共享审批和 dream writer 的链路差异。",
              generationMode: "fallback",
              fallbackReason: "llm_call_failed",
              consolidation: {
                profilePatchCandidates: [{ field: "profile.headline" }],
                staleCandidates: [{ memoryClass: "governance" }],
                contradictionCandidates: [{ topic: "review pressure" }],
              },
            },
          ],
        },
      },
      dreamCommons: {
        availability: {
          enabled: true,
          available: true,
          vaultPath: "E:/vaults/main",
          sharedStateDir: "E:/project/star-sanctuary/.state/team-memory",
        },
        headline: "Commons export last completed at 2026-04-19T13:10:00.000Z.",
        state: {
          status: "completed",
          lastAttemptAt: "2026-04-19T13:09:00.000Z",
          lastSuccessAt: "2026-04-19T13:10:00.000Z",
          approvedCount: 3,
          revokedCount: 1,
          noteCount: 4,
          agentPageCount: 2,
          targetPath: "E:/vaults/main/Star Sanctuary/Commons",
          indexPath: "E:/vaults/main/Star Sanctuary/Commons/INDEX.md",
        },
      },
      memoryRuntime: {
        compactionRuntime: {
          totals: {
            attempts: 3,
            compacted: 2,
            fallbacks: 1,
            failures: 1,
            warningHits: 0,
            blockingHits: 0,
            promptTooLongRetries: 1,
            skippedByCircuitBreaker: 0,
            circuitOpened: 0,
          },
          circuitBreaker: {
            open: false,
            consecutiveFailures: 0,
            remainingSkips: 0,
          },
          lastResult: {
            source: "request",
            compacted: true,
            fallbackUsed: true,
            warningTriggered: false,
            blockingTriggered: false,
            promptTooLongRetries: 1,
            failureReason: "compaction backend unavailable",
            savedTokenCount: 72,
            updatedAt: 1710000000000,
            summarizerObservability: {
              mode: "rolling",
              cacheAlignedRequested: true,
              cacheSupport: "supported",
              cacheHitTokens: 640,
              cacheMissTokens: 32,
              cacheSavingsUsd: 0.000123,
              usedWireApi: "chat_completions",
              compareAvailable: true,
              comparison: {
                mode: "cache_aligned_vs_plain",
                plainRequestMessageCount: 1,
                cacheAlignedRequestMessageCount: 4,
                plainPromptCharsEstimate: 1200,
                cacheAlignedReplayCharsEstimate: 980,
                cacheAlignedInstructionChars: 180,
                replayOverheadChars: 0,
              },
              strategy: {
                kind: "cache_aligned",
                providerCacheMode: "supported",
                selectionReason: "provider_cache_supported_with_context",
                degradePath: "cache_aligned_then_compaction_fallback",
                providerModelNotes: "cache=supported, json=medium, route=deepseek-flash",
                fallbackPolicy: "fallback_summary_on_request_or_parse_or_budget_failure",
                fallbackTriggered: true,
                fallbackSummary: "model_failure_fallback",
              },
              fallbackStage: "model_failure",
              failureReason: "compaction backend unavailable",
            },
          },
        },
        sharedMemory: {
          enabled: true,
          available: true,
          reasonMessages: [],
          secretGuard: {
            enabled: true,
            summary: "high-confidence rules enabled",
          },
          syncPolicy: {
            conflictPolicy: {
              summary: "local-write-wins-per-entry",
            },
          },
        },
      },
      delegationObservability: {
        summary: {
          totalCount: 2,
          protocolBackedCount: 1,
          completedCount: 1,
          activeCount: 1,
          sourceCounts: {
            goal_subtask: 1,
          },
          aggregationModeCounts: {
            main_agent_summary: 1,
          },
          headline: "delegation protocol=1/2; active=1; completed=1; sources=goal_subtask:1",
        },
        items: [
          {
            taskId: "subtask-1",
            agentId: "coder",
            status: "running",
            source: "goal_subtask",
            aggregationMode: "main_agent_summary",
            expectedDeliverableFormat: "patch",
            expectedDeliverableSummary: "返回治理摘要",
            intentSummary: "整理工具治理摘要",
          },
        ],
      },
      cronRuntime: {
        scheduler: {
          enabled: true,
          running: true,
          activeRuns: 2,
          lastTickAtMs: 1710000000000,
        },
        totals: {
          totalJobs: 3,
          enabledJobs: 2,
          disabledJobs: 1,
          staggeredJobs: 1,
          invalidNextRunJobs: 0,
        },
        sessionTargetCounts: {
          main: 1,
          isolated: 2,
        },
        deliveryModeCounts: {
          user: 2,
          none: 1,
        },
        failureDestinationModeCounts: {
          user: 1,
          none: 2,
        },
        recentJobs: [
          {
            id: "cron-job-1",
            name: "Digest",
            enabled: true,
            scheduleSummary: "every 60000ms",
            sessionTarget: "main",
            deliveryMode: "user",
            failureDestinationMode: "user",
            staggerMs: 15000,
            nextRunAtMs: 1710000060000,
            lastStatus: "ok",
          },
        ],
        headline: "enabled; jobs=2/3; session main=1; isolated=2; delivery user=2; none=1; stagger=1; activeRuns=2",
      },
      backgroundContinuationRuntime: {
        totals: {
          totalRuns: 4,
          runningRuns: 1,
          failedRuns: 1,
          skippedRuns: 1,
          conversationLinkedRuns: 3,
        },
        kindCounts: {
          cron: 2,
          heartbeat: 1,
          subtask: 1,
        },
        sessionTargetCounts: {
          main: 1,
          isolated: 1,
        },
        recentEntries: [
          {
            runId: "cron-run-1",
            kind: "cron",
            sourceId: "cron-job-1",
            label: "Digest",
            status: "ran",
            startedAt: 1710000000000,
            finishedAt: 1710000000200,
            summary: "Digest completed.",
            conversationId: "cron-main:cron-job-1",
            sessionTarget: "main",
            continuationState: {
              recommendedTargetId: "cron-main:cron-job-1",
              targetType: "conversation",
            },
          },
          {
            runId: "subtask:task_sub_1",
            kind: "subtask",
            sourceId: "task_sub_1",
            label: "Implement runtime bridge",
            status: "ran",
            startedAt: 1710000015000,
            finishedAt: 1710000015600,
            summary: "patch delivered",
            continuationState: {
              recommendedTargetId: "sub-session-1",
              targetType: "session",
            },
          },
          {
            runId: "heartbeat-run-1",
            kind: "heartbeat",
            sourceId: "heartbeat",
            label: "Heartbeat",
            status: "failed",
            startedAt: 1710000010000,
            finishedAt: 1710000010500,
            reason: "provider unavailable",
            continuationState: {},
          },
        ],
        headline: "runs=4; running=1; failed=1; skipped=1; cron=2; heartbeat=1; subtask=1; linked=3; main=1; isolated=1",
      },
      assistantModeRuntime: {
        available: true,
        enabled: true,
        status: "running",
        controls: {
          assistantModeEnabled: true,
          assistantModeSource: "explicit",
          assistantModeMismatch: false,
          heartbeatEnabled: true,
          heartbeatInterval: "45m",
          activeHours: "08:00-23:00",
          cronEnabled: true,
        },
        sources: {
          heartbeat: {
            enabled: true,
            interval: "45m",
            activeHours: "08:00-23:00",
            lastStatus: "running",
            lastSummary: "Heartbeat follow-up",
          },
          cron: {
            enabled: true,
            schedulerRunning: true,
            activeRuns: 2,
            totalJobs: 3,
            enabledJobs: 2,
            userDeliveryJobs: 2,
            lastStatus: "ran",
          },
        },
        delivery: {
          residentChannel: true,
          externalDeliveryPreference: ["feishu", "qq", "community", "discord"],
          confirmationRequired: true,
        },
        resident: {
          totalCount: 2,
          activeCount: 1,
          runningCount: 1,
          idleCount: 1,
          errorCount: 0,
          headline: "2 residents, active 1, running 1, digest ready 1, updated 1, shared review pending 1",
          primary: {
            id: "default",
            displayName: "Belldandy",
            status: "running",
            digestStatus: "updated",
            pendingMessageCount: 3,
            recommendedTargetId: "agent:default:main",
            targetType: "conversation",
            nextAction: "Continue resident follow-up",
          },
        },
        longTasks: {
          totalCount: 2,
          activeCount: 1,
          protocolBackedCount: 1,
          headline: "delegation protocol=1/2; active=1; completed=1; sources=goal_subtask:1",
          primary: {
            taskId: "subtask-1",
            agentId: "coder",
            status: "running",
            source: "goal_subtask",
            aggregationMode: "main_agent_summary",
            intentSummary: "整理工具治理摘要",
            expectedDeliverableSummary: "返回治理摘要",
          },
        },
        goals: {
          totalCount: 2,
          activeCount: 2,
          blockedCount: 1,
          pendingApprovalCount: 0,
          reviewingCount: 0,
          headline: "goals=2; active=2; blocked=1; pendingApproval=0; reviewing=0",
          primary: {
            goalId: "goal_review",
            title: "Review Flow",
            status: "blocked",
            summary: "当前 goal 处于阻塞态，优先解除关键节点阻塞。",
            nextAction: "先解除 review 节点的阻塞，再继续推进。",
            blockerSummary: "等待用户确认策略",
            checkpointSummary: "等待用户确认当前评审策略",
            targetId: "goal:review",
            targetType: "conversation",
          },
        },
        explanation: {
          nextAction: {
            summary: "Continue Heartbeat",
            targetId: "heartbeat-1",
            targetType: "conversation",
          },
          blockedReason: "waiting for the next eligible heartbeat or cron run",
          attentionReason: "Heartbeat: provider unavailable",
        },
        focus: {
          summary: "Continue Heartbeat",
          targetId: "heartbeat-1",
          targetType: "conversation",
        },
        attentionItems: [
          {
            kind: "failed_action",
            summary: "Heartbeat: provider unavailable",
            targetId: "heartbeat-1",
            targetType: "conversation",
          },
          {
            kind: "pending_confirmation",
            summary: "1 outbound confirmation(s) pending; latest qq request confirm-qq-1",
            targetId: "conv-pending-qq",
            targetType: "conversation",
          },
          {
            kind: "cron_invalid_next_run",
            summary: "1 enabled cron job(s) currently have no nextRunAtMs",
          },
        ],
        recentActions: [
          {
            kind: "heartbeat",
            sourceId: "heartbeat",
            label: "Heartbeat",
            status: "running",
            startedAt: 1710000200000,
            recommendedTargetId: "heartbeat-1",
            targetType: "conversation",
            summary: "Heartbeat follow-up",
          },
          {
            kind: "cron",
            sourceId: "cron-job-1",
            label: "Digest",
            status: "ran",
            startedAt: 1710000210000,
            finishedAt: 1710000210300,
            sessionTarget: "main",
            recommendedTargetId: "cron-main:cron-job-1",
            targetType: "conversation",
            summary: "Digest delivered",
            nextRunAtMs: 1710003810000,
          },
        ],
        headline: "enabled; status=running; heartbeat=on; interval=45m; activeHours=08:00-23:00; cron=on; jobs=2/3; recent=2; notify=resident+feishu>qq>community>discord; confirm=required",
      },
      configSource: {
        source: "state_dir",
        sourceLabel: "state-dir config",
        envDir: "C:/Users/admin/.star_sanctuary",
        stateDir: "C:/Users/admin/.star_sanctuary",
        stateDirActive: true,
        resolutionOrder: [
          "state-dir config (BELLDANDY_STATE_DIR)",
        ],
        headline: "Using state-dir config from C:/Users/admin/.star_sanctuary; Gateway reads .env / .env.local from BELLDANDY_STATE_DIR on every start.",
      },
      externalOutboundRuntime: {
        requireConfirmation: true,
        totals: {
          totalRecords: 5,
          pendingConfirmationCount: 1,
          confirmedCount: 2,
          autoApprovedCount: 2,
          rejectedCount: 1,
          sentCount: 3,
          failedCount: 2,
          resolveFailedCount: 1,
          deliveryFailedCount: 1,
        },
        channelCounts: {
          feishu: 2,
          qq: 2,
          discord: 1,
        },
        errorCodeCounts: {
          binding_not_found: 1,
          send_failed: 1,
        },
        failureStageCounts: {
          resolve: 1,
          delivery: 1,
          confirmation: 0,
        },
        recentFailures: [
          {
            timestamp: 1710000100000,
            targetChannel: "qq",
            delivery: "failed",
            resolution: "latest_binding",
            failureStage: "resolve",
            errorCode: "binding_not_found",
            error: "当前没有可用于 qq 的最新会话绑定。",
            requestedSessionKey: "channel=qq:chat=chat-2",
            contentPreview: "请去 QQ 提醒我",
          },
          {
            timestamp: 1710000120000,
            targetChannel: "discord",
            delivery: "failed",
            resolution: "explicit_session_key",
            failureStage: "delivery",
            errorCode: "send_failed",
            error: "discord send failed",
            targetSessionKey: "channel=discord:chat=room-1",
            contentPreview: "请去 Discord 提醒我",
          },
        ],
        recentPending: [
          {
            requestId: "confirm-qq-1",
            createdAt: 1710000135000,
            expiresAt: 1710000735000,
            conversationId: "conv-pending-qq",
            requestedByAgentId: "default",
            targetChannel: "qq",
            requestedSessionKey: "channel=qq:chat=chat-2",
            targetSessionKey: "channel=qq:chat=chat-2",
            contentPreview: "请去 QQ 提醒我",
          },
        ],
        headline: "records=5; sent=3; failed=2; resolve_failed=1; delivery_failed=1; confirm=required",
      },
      emailOutboundRuntime: {
        requireConfirmation: true,
        totals: {
          totalRecords: 3,
          confirmedCount: 1,
          autoApprovedCount: 1,
          rejectedCount: 1,
          sentCount: 2,
          failedCount: 1,
          attachmentRecordCount: 1,
        },
        providerCounts: {
          smtp: 3,
        },
        accountCounts: {
          default: 3,
        },
        errorCodeCounts: {
          send_failed: 1,
        },
        recentFailures: [
          {
            timestamp: 1710000140000,
            providerId: "smtp",
            accountId: "default",
            subject: "Weekly status",
            errorCode: "send_failed",
            error: "smtp timeout",
            threadId: "<thread-001@example.com>",
            replyToMessageId: "<reply-001@example.com>",
            bodyPreview: "Here is the weekly status update.",
          },
        ],
        headline: "records=3; sent=2; failed=1; providers=1; attachments=1; confirm=required",
      },
      emailInboundRuntime: {
        enabled: true,
        setup: {
          configured: true,
          runtimeExpected: true,
          missingFields: [],
          accountId: "primary",
          host: "imap.example.com",
          port: 993,
          secure: true,
          mailbox: "INBOX",
          requestedAgentId: "default",
          pollIntervalMs: 60000,
          connectTimeoutMs: 10000,
          socketTimeoutMs: 20000,
          bootstrapMode: "latest",
          recentWindowLimit: 50,
          headline: "IMAP polling is configured for primary@imap.example.com:993/INBOX -> agent default. First attach bootstrap=latest. Recent window limit=50.",
          nextStep: "If inbound mail still does not start, verify the Config Source card and confirm your latest .env/.env.local change has triggered a Gateway restart.",
        },
        totals: {
          totalRecords: 4,
          processedCount: 2,
          failedCount: 1,
          invalidEventCount: 1,
          duplicateCount: 1,
          attachmentRecordCount: 1,
          createdBindingCount: 1,
        },
        providerCounts: {
          imap: 4,
        },
        accountCounts: {
          primary: 4,
        },
        mailboxCounts: {
          INBOX: 4,
        },
        statusCounts: {
          processed: 2,
          failed: 1,
          invalid_event: 1,
          skipped_duplicate: 1,
        },
        errorCodeCounts: {
          ingest_failed: 1,
          invalid_event: 1,
        },
        recentFailures: [
          {
            timestamp: 1710000150000,
            providerId: "imap",
            accountId: "primary",
            mailbox: "INBOX",
            subject: "Need help",
            messageId: "<msg-900@example.com>",
            threadId: "<thread-900@example.com>",
            errorCode: "ingest_failed",
            error: "agent unavailable",
            bodyPreview: "Please help with the latest patch.",
          },
        ],
        headline: "records=4; processed=2; failed=1; invalid=1; duplicates=1; providers=1; attachments=1; runtime=enabled",
      },
      cameraRuntime: {
        summary: {
          available: true,
          defaultProviderId: "native_desktop",
          defaultSelection: {
            policy: "prefer_native_desktop",
            preferredOrder: [
              "native_desktop",
              "browser_loopback",
              "node_device",
            ],
            registeredProviders: [
              "native_desktop",
              "browser_loopback",
            ],
            skippedPreferredProviders: [],
            availableFallbackProviders: [
              "browser_loopback",
            ],
            missingFallbackProviders: [
              "node_device",
            ],
            configuredDefaultProvider: "browser_loopback",
            selectedProvider: "native_desktop",
            reason: "policy_preferred_provider",
            fallbackApplied: false,
            attempts: [
              {
                provider: "native_desktop",
                outcome: "selected",
                reason: "policy_preferred",
              },
            ],
          },
          registeredProviderIds: ["browser_loopback", "native_desktop"],
          warningCount: 1,
          errorCount: 0,
          headline: "native_desktop; status=degraded; helper=ready; devices 1/1 available, busy=1; issues error=0, warning=1",
          governance: {
            headline: "1 个 provider 需要优先处理；主失败码=device_busy。",
            blockedProviderCount: 1,
            permissionBlockedProviderCount: 0,
            permissionPromptProviderCount: 0,
            fallbackActiveProviderCount: 0,
            recentFailureCount: 0,
            recentRecoveredCount: 0,
            failureProviderCount: 0,
            repeatedFallback: false,
            dominantFailureCode: "device_busy",
            whyUnhealthy: "native_desktop 当前需要优先处理；依据=permission_state + diagnostic_issue + runtime_health；主因=device_busy。",
            recommendedAction: "关闭正在占用摄像头的会议或录制软件后重试。",
          },
        },
        providers: [
          {
            id: "browser_loopback",
            headline: "browser_loopback 已注册；doctor 当前不主动拉起浏览器，会在真实浏览器会话中补充运行时状态。",
            recoveryHints: [],
          },
          {
            id: "native_desktop",
            headline: "native_desktop; status=degraded; helper=ready; devices 1/1 available, busy=1; issues error=0, warning=1",
            configured: true,
            registered: true,
            status: "degraded",
            permissionState: "granted",
            helperStatus: "ready",
            launchConfig: {
              transport: "stdio",
              command: "C:/Program Files/nodejs/node.exe",
              helperEntry: "packages/belldandy-skills/dist/builtin/multimedia/camera-native-desktop-helper.js",
              cwd: "E:/project/star-sanctuary",
              powershellCommand: "powershell.exe",
              ffmpegCommand: "ffmpeg.exe",
            },
            capabilities: {
              list: true,
              snapshot: true,
              screenTargetList: true,
              screenCapture: true,
              displayCapture: true,
              windowCapture: true,
              regionCapture: true,
            },
            issueCounts: {
              info: 0,
              warning: 1,
              error: 0,
            },
            issues: [
              {
                code: "device_busy",
                severity: "warning",
                message: "OBSBOT Tiny 2 StreamCamera is currently busy.",
              },
            ],
            healthCheck: {
              provider: "native_desktop",
              status: "warn",
              source: "diagnostic",
              sources: ["permission_state", "diagnostic_issue", "runtime_health"],
              checkedAt: "2026-04-17T11:20:05.000Z",
              headline: "native_desktop 当前不可用：摄像头正在被其他应用占用。",
              summary: "status=warn, sources=permission_state+diagnostic_issue+runtime_health, provider=degraded, permission=granted/clear, reason=device_busy, dominant=device_busy, actions=2",
              actionable: true,
              fallbackApplied: false,
              primaryReasonCode: "device_busy",
              reasonCodes: ["device_busy"],
              permission: {
                state: "granted",
                gating: "clear",
                actionable: false,
              },
              failureStats: {
                issueCounts: {
                  total: 1,
                  info: 0,
                  warning: 1,
                  error: 0,
                  retryable: 1,
                },
                reasonCodeCounts: {
                  device_busy: 2,
                },
                dominantReasonCode: "device_busy",
                runtimeWindow: {
                  eventCount: 2,
                  successCount: 1,
                  failureCount: 1,
                  recoveredSuccessCount: 1,
                  dominantFailureCode: "device_busy",
                  lastFailureCode: "device_busy",
                },
              },
              recoveryActions: [
                {
                  kind: "close_competing_app",
                  priority: "now",
                  label: "关闭正在占用摄像头的会议或录制软件后重试。",
                },
                {
                  kind: "retry",
                  priority: "next",
                  label: "释放占用后最多重试一次，再观察 camera runtime 状态。",
                },
              ],
            },
            metadata: {
              helperStatus: "ready",
              helperVersion: "0.1.0",
              aliasMemory: {
                entryCount: 1,
                observedCount: 1,
                manualAliasCount: 1,
                favoriteCount: 1,
                snapshotPath: "C:/Users/admin/.star_sanctuary/diagnostics/camera-runtime/device-aliases.json",
              },
            },
            runtimeHealth: {
              status: "error",
              consecutiveFailures: 1,
              lastSuccessAt: "2026-04-17T11:20:00.000Z",
              historyWindow: {
                size: 32,
                eventCount: 2,
                successCount: 1,
                failureCount: 1,
                recoveredSuccessCount: 1,
                failureCodeCounts: {
                  device_busy: 1,
                },
                lastEvents: [
                  {
                    at: "2026-04-17T11:19:00.000Z",
                    operation: "capture_snapshot",
                    outcome: "failure",
                    code: "device_busy",
                    message: "OBSBOT Tiny 2 StreamCamera is currently busy.",
                  },
                  {
                    at: "2026-04-17T11:20:00.000Z",
                    operation: "capture_snapshot",
                    outcome: "success",
                    recovered: true,
                  },
                ],
              },
              lastFailure: {
                at: "2026-04-17T11:19:00.000Z",
                operation: "capture_snapshot",
                code: "device_busy",
                message: "OBSBOT Tiny 2 StreamCamera is currently busy.",
                recoveryHint: "关闭正在占用摄像头的会议或录制软件后重试。",
              },
            },
            runtimeHealthFreshness: {
              source: "memory+snapshot",
              level: "fresh",
              stale: false,
              ageMs: 4200,
              referenceAt: "2026-04-17T11:20:05.000Z",
              retention: {
                eventLimit: 32,
                horizonMs: 604800000,
              },
              snapshotPath: "C:/Users/admin/.star_sanctuary/diagnostics/camera-runtime/native_desktop-runtime-health.json",
            },
            sampleDevices: [
              "Studio Cam => OBSBOT Tiny 2 StreamCamera [available, external, busy, favorite, stable=usb-3564-fef8-453a4b75]",
            ],
            recoveryHints: [
              "关闭正在占用摄像头的会议或录制软件后重试。",
            ],
          },
        ],
      },
      runtimeResilienceDiagnostics: {
        alertLevel: "warn",
        alertCode: "recent_degrade",
        alertMessage: "Latest runtime required retry/fallback to recover.",
        dominantReason: "server_error",
        reasonClusterSummary: "server_error + timeout",
        mixedSignalHint: "Mixed 5xx + timeout signals suggest upstream instability; verify provider health and network latency before widening retries.",
        recoveryHint: "5xx instability dominates; keep fallback ready and verify provider health before trusting the primary route.",
        latestSignal: "openai_chat/primary_chat | agent=default | conv=conv-1",
        latestRouteBehavior: "switched primary/gpt-4.1 -> backup/kimi-k2",
        latestReasonSummary: "server_error=1, timeout=1",
        overallReasonSummary: "server_error=1, timeout=1, rate_limit=1",
        totalsSummary: "observed=3, degraded=1, failed=0, retry=1, switch=1, cooldown=0",
      },
      queryRuntime: {
        traces: [
          {
            method: "message.send",
            stages: [
              {
                stage: "completed",
                detail: {
                  localPromptEstimate: {
                    systemPromptTokens: 41651,
                    contextTokens: 1902,
                    totalPromptTokens: 43553,
                  },
                  providerRawUsage: {
                    promptTokens: 35338,
                    completionTokens: 81,
                    totalTokens: 35419,
                  },
                  requestShape: {
                    messageCount: 23,
                    systemMessageCount: 7,
                    toolSchemaCount: 66,
                  },
                  usageCalibration: {
                    estimatedPromptTokens: 1800,
                    actualInputTokens: 2100,
                    modelCalls: 2,
                    averageInputTokensPerCall: 1050,
                    deltaTokens: -750,
                    deltaRatio: -0.4167,
                    status: "over_estimated",
                  },
                },
              },
            ],
          },
        ],
        stopDiagnostics: {
          available: true,
          totalRequests: 2,
          acceptedRequests: 2,
          stoppedRuns: 1,
          runningAfterStopCount: 1,
          completedAfterStopCount: 0,
          failedAfterStopCount: 0,
          notFoundCount: 0,
          runMismatchCount: 0,
          recent: [
            {
              stopTraceId: "stop-trace-1",
              conversationId: "conv-1",
              runId: "run-1",
              requestedAt: 1710000160000,
              outcome: "running_after_stop",
              reason: "Stopped by user.",
              messageStatus: "running",
              messageLatestStage: "tool_result_emitted",
            },
            {
              stopTraceId: "stop-trace-2",
              conversationId: "conv-2",
              runId: "run-2",
              requestedAt: 1710000165000,
              outcome: "stopped",
              reason: "Stopped by user.",
              messageStatus: "completed",
              messageLatestStage: "completed",
              messageResponse: "stopped",
            },
          ],
        },
      },
        runtimeResilience: {
          version: 1,
          updatedAt: 1712736000000,
          routing: {
          primary: {
            profileId: "primary",
            provider: "openai.com",
            model: "gpt-4.1",
          },
          fallbacks: [
            {
              profileId: "backup",
              provider: "moonshot.ai",
              model: "kimi-k2",
            },
          ],
            compaction: {
              configured: true,
              sharesPrimaryRoute: false,
              route: {
                profileId: "compaction",
                provider: "openai.com",
                model: "gpt-4.1-mini",
              },
              auxSummaryVerdict: {
                strategy: "deepseek_flash_preferred",
                enabled: true,
                reason: "deepseek_primary_with_flash_candidate",
              },
            },
          },
        totals: {
          observedRuns: 3,
          degradedRuns: 1,
          failedRuns: 0,
          sameProfileRetries: 1,
          crossProfileFallbacks: 1,
          cooldownSkips: 0,
          terminalFailures: 0,
        },
        summary: {
          available: true,
          configuredFallbackCount: 1,
          lastOutcome: "success",
          headline: "Primary openai.com/gpt-4.1, 1 fallback profile(s) configured. Latest run recovered via fallback (backup/kimi-k2); retry=1, switch=1, cooldown=0.",
        },
        reasonCounts: {
          server_error: 1,
          rate_limit: 1,
        },
        latest: {
          source: "openai_chat",
          phase: "primary_chat",
          finalStatus: "success",
          finalProfileId: "backup",
          finalProvider: "moonshot.ai",
          finalModel: "kimi-k2",
          requestCount: 2,
          failedStageCount: 1,
          degraded: true,
          stepCounts: {
            cooldownSkips: 0,
            sameProfileRetries: 1,
            crossProfileFallbacks: 1,
            terminalFailures: 0,
          },
          reasonCounts: {
            server_error: 1,
          },
          updatedAt: 1712736000000,
          headline: "Latest run recovered via fallback (backup/kimi-k2); retry=1, switch=1, cooldown=0.",
        },
      },
    });

    expect(lines.join("\n")).toContain("Prompt");
    expect(lines.join("\n")).toContain("约 800 tokens");
    expect(lines.join("\n")).toContain("已省略 2 段");
    expect(lines.join("\n")).toContain("workspace scope: current workspace scope (default) rooted at E:/state");
    expect(lines.join("\n")).toContain("state scope: root-default private=E:/state; sessions=E:/state/sessions; shared=E:/state/team-memory");
    expect(lines.join("\n")).toContain("catalog default: role=default");
    expect(lines.join("\n")).toContain("effective launch: source=catalog_default, agent=default");
    expect(lines.join("\n")).toContain("工具使用规则");
    expect(lines.join("\n")).toContain("5 条工具规则生效");
    expect(lines.join("\n")).toContain("workspace / state scope 绑定");
    expect(lines.join("\n")).toContain("workspace scope: current workspace scope (default) rooted at E:/state");
    expect(lines.join("\n")).toContain("state scope: root-default private=E:/state; sessions=E:/state/sessions; shared=E:/state/team-memory");
    expect(lines.join("\n")).toContain("effective launch: source=runtime_launch_spec, agent=coder");
    expect(lines.join("\n")).toContain("delegation reason: source=goal_subtask");
    expect(lines.join("\n")).toContain("当前生效：run_command, apply_patch");
    expect(lines.join("\n")).toContain("Tool Contract V2");
    expect(lines.join("\n")).toContain("6 条 V2 契约");
    expect(lines.join("\n")).toContain("尚未补齐 V2 契约：beta_builtin");
    expect(lines.join("\n")).toContain("Resident Agents");
    expect(lines.join("\n")).toContain("2 个 resident");
    expect(lines.join("\n")).toContain("running 1 / background 0 / idle 1 / error 0");
    expect(lines.join("\n")).toContain("digest ready 1 / updated 1 / idle 0 / missing 0");
    expect(lines.join("\n")).toContain("1 resident(s) with recent task context");
    expect(lines.join("\n")).toContain("1 resident(s) with recent subtask context");
    expect(lines.join("\n")).toContain("1 resident(s) with experience usage context");
    expect(lines.join("\n")).toContain("1 resident(s) with catalog guidance");
    expect(lines.join("\n")).toContain("1 resident(s) with structured handoff");
    expect(lines.join("\n")).toContain("1 resident(s) with skill hints");
    expect(lines.join("\n")).toContain("Belldandy: hybrid");
    expect(lines.join("\n")).toContain("role=default");
    expect(lines.join("\n")).toContain("permission=confirm");
    expect(lines.join("\n")).toContain("risk=high");
    expect(lines.join("\n")).toContain("handoff=summary");
    expect(lines.join("\n")).toContain("skills=resident-observability");
    expect(lines.join("\n")).toContain("when=收口 resident 主线");
    expect(lines.join("\n")).toContain("digest=updated/3");
    expect(lines.join("\n")).toContain("task=收口 resident 任务观测 · success");
    expect(lines.join("\n")).toContain("subtask=整理 resident 连续观测摘要卡 · running · coder");
    expect(lines.join("\n")).toContain("review=p1/c1");
    expect(lines.join("\n")).toContain("usage=m1/s1 · resident-observability-playbook.md");
    expect(lines.join("\n")).toContain("Mind / Profile Snapshot");
    expect(lines.join("\n")).toContain("user ready, private 2, shared 1, digest 1/1, usage 1");
    expect(lines.join("\n")).toContain("USER.md: 喜欢简洁状态表与短结论。");
    expect(lines.join("\n")).toContain("Resident: Belldandy: status=running, digest=updated, pending=3");
    expect(lines.join("\n")).toContain("Learning / Review Input");
    expect(lines.join("\n")).toContain("memory 4 / candidate 1 / review 0");
    expect(lines.join("\n")).toContain("runtime triggered");
    expect(lines.join("\n")).toContain("session goal_node");
    expect(lines.join("\n")).toContain("sources: explicit_user_intent, goal_review_pressure");
    expect(lines.join("\n")).toContain("latest signal: openai_chat/primary_chat");
    expect(lines.join("\n")).toContain("route: switched primary/gpt-4.1 -> backup/kimi-k2");
    expect(lines.join("\n")).toContain("totals: observed=3, degraded=1, failed=0, retry=1, switch=1, cooldown=0");
    expect(lines.join("\n")).toContain("reasons: server_error=1, timeout=1, rate_limit=1");
    expect(lines.join("\n")).toContain("reason focus: server_error");
    expect(lines.join("\n")).toContain("reason cluster: server_error + timeout");
    expect(lines.join("\n")).toContain("mixed signal: Mixed 5xx + timeout signals suggest upstream instability; verify provider health and network latency before widening retries.");
    expect(lines.join("\n")).toContain("recovery hint: 5xx instability dominates; keep fallback ready and verify provider health before trusting the primary route.");
    expect(lines.join("\n")).toContain("alert warn/recent_degrade");
    expect(lines.join("\n")).toContain("Latest runtime required retry/fallback to recover.");
    expect(lines.join("\n")).toContain("prepend 480 chars");
    expect(lines.join("\n")).toContain("auto-recall 2/3");
    expect(lines.join("\n")).toContain("Prompt fingerprint: abc123fingerprint");
    expect(lines.join("\n")).toContain("Structure signature: sig-123");
    expect(lines.join("\n")).toContain("Prefix drift: drifted (system_prompt_fingerprint_changed, section_id_order_changed)");
    expect(lines.join("\n")).toContain("Prefix warm state: warming; reason=matching_prefix_recently_seen_may_still_be_warming; ageMs=1200");
    expect(lines.join("\n")).toContain("Ordering guard: risk (dynamic_runtime_sections_present, tool_contract_list_injected)");
    expect(lines.join("\n")).toContain("Warm-up coordination: warming; recommendation=delay_if_possible; reason=matching_prefix_recent_but_ordering_risk_present");
    expect(lines.join("\n")).toContain("Cache family affinity: aligned; reason=same_cache_family_as_previous");
    expect(lines.join("\n")).toContain("Context injection: prepend=480 chars; blocks=3; tags=current-turn, auto-recall");
    expect(lines.join("\n")).toContain("Auto recall: kept=2/3; filtered=1; minScore=0.42; topHits=mem-curated, mem-derived; sourceMix=curated:1, derived:1");
    expect(lines.join("\n")).toContain("runtime resilience: alert=warn/recent_degrade");
    expect(lines.join("\n")).toContain("reason_focus=server_error");
    expect(lines.join("\n")).toContain("reason_cluster=server_error + timeout");
    expect(lines.join("\n")).toContain("mixed_hint=Mixed 5xx + timeout signals suggest upstream instability; verify provider health and network latency before widening retries.");
    expect(lines.join("\n")).toContain("hint=5xx instability dominates; keep fallback ready and verify provider health before trusting the primary route.");
    expect(lines.join("\n")).toContain("signals: candidate, review");
    expect(lines.join("\n")).toContain("Latest turn: 请帮我整理这轮长期任务的经验候选");
    expect(lines.join("\n")).toContain("Nudge: 当前输入已具备最小 learning/review 条件，可继续进入 candidate / governance 审阅。");
    expect(lines.join("\n")).toContain("Dream Runtime");
    expect(lines.join("\n")).toContain("agent default");
    expect(lines.join("\n")).toContain("model gpt-4.1-mini");
    expect(lines.join("\n")).toContain("default conversation: agent:default:main");
    expect(lines.join("\n")).toContain("latest summary: 收口共享审批和 dream writer 的链路差异。");
    expect(lines.join("\n")).toContain("readonly consolidation: profile_patch=1, stale=1, contradiction=1");
    expect(lines.join("\n")).toContain("generation fallback");
    expect(lines.join("\n")).toContain("latest generation: fallback (llm_call_failed)");
    expect(lines.join("\n")).toContain("latest input: tasks=3, memories=5, usages=2");
    expect(lines.join("\n")).toContain("auto trigger: heartbeat at 2026-04-19T12:00:00.000Z -> skip cooldown_active");
    expect(lines.join("\n")).toContain("auto stats: attempted=5, executed=2, skipped=3");
    expect(lines.join("\n")).toContain("auto skip stats: cooldown_active:1, insufficient_signal:2");
    expect(lines.join("\n")).toContain("auto gate stats: digest_generation:1, change_budget:1, insufficient_signal:2");
    expect(lines.join("\n")).toContain("auto mode stats: heartbeat[attempted:3, executed:1, skipped:2], cron[attempted:2, executed:1, skipped:1]");
    expect(lines.join("\n")).toContain("auto note: cooldown active until 2026-04-19T18:05:00.000Z");
    expect(lines.join("\n")).toContain("auto signal: digestΔ=2, sessionMsgΔ=6, sessionToolΔ=2, sessionRevΔ=2, taskΔ=3, memoryΔ=2, budget=19");
    expect(lines.join("\n")).toContain("auto cursor: last[digest=0, msg=0, tool=0, task=0, memory=0] -> current[digest=2, msg=6, tool=2, task=3, memory=2]");
    expect(lines.join("\n")).toContain("auto gates: cooldown=2026-04-19T18:05:00.000Z; backoff=-");
    expect(lines.join("\n")).toContain("Dream Commons");
    expect(lines.join("\n")).toContain("vault E:/vaults/main");
    expect(lines.join("\n")).toContain("status completed");
    expect(lines.join("\n")).toContain("Commons export last completed at 2026-04-19T13:10:00.000Z.");
    expect(lines.join("\n")).toContain("shared state dir: E:/project/star-sanctuary/.state/team-memory");
    expect(lines.join("\n")).toContain("counts: approved=3, revoked=1, notes=4, agent-pages=2");
    expect(lines.join("\n")).toContain("commons path: E:/vaults/main/Star Sanctuary/Commons");
    expect(lines.join("\n")).toContain("index path: E:/vaults/main/Star Sanctuary/Commons/INDEX.md");
    expect(lines.join("\n")).toContain("timeline: attempt=2026-04-19T13:09:00.000Z, success=2026-04-19T13:10:00.000Z, failure=-");
    expect(lines.join("\n")).toContain("Shared Governance");
    expect(lines.join("\n")).toContain("Compaction Runtime");
    expect(lines.join("\n")).toContain("3 attempts / fallback 1 / failures 1");
    expect(lines.join("\n")).toContain("summary mode: rolling");
    expect(lines.join("\n")).toContain("cache aligned: yes");
    expect(lines.join("\n")).toContain("cache usage: hit=640, miss=32");
    expect(lines.join("\n")).toContain("cache savings: $0.000123");
    expect(lines.join("\n")).toContain("wire api: chat_completions");
    expect(lines.join("\n")).toContain("provider strategy: cache_aligned");
    expect(lines.join("\n")).toContain("provider cache mode: supported");
    expect(lines.join("\n")).toContain("selection reason: provider_cache_supported_with_context");
    expect(lines.join("\n")).toContain("degrade path: cache_aligned_then_compaction_fallback");
    expect(lines.join("\n")).toContain("fallback policy: fallback_summary_on_request_or_parse_or_budget_failure");
    expect(lines.join("\n")).toContain("fallback triggered: yes");
    expect(lines.join("\n")).toContain("fallback summary: model_failure_fallback");
    expect(lines.join("\n")).toContain("provider notes: cache=supported, json=medium, route=deepseek-flash");
    expect(lines.join("\n")).toContain("aux summary verdict: deepseek_flash_preferred / deepseek_primary_with_flash_candidate / enabled=yes");
    expect(lines.join("\n")).toContain("comparison available: yes");
    expect(lines.join("\n")).toContain("comparison: plain≈1200 chars, replay≈980 chars, instruction≈180 chars, overhead≈0 chars");
    expect(lines.join("\n")).toContain("comparison messages: plain=1, cache-aligned=4");
    expect(lines.join("\n")).toContain("fallback stage: model_failure");
    expect(lines.join("\n")).toContain("failure reason: compaction backend unavailable");
    expect(lines.join("\n")).toContain("1 个 shared reader");
    expect(lines.join("\n")).toContain("1 pending approval(s)");
    expect(lines.join("\n")).toContain("1 claimed pending item(s)");
    expect(lines.join("\n")).toContain("conflict policy");
    expect(lines.join("\n")).toContain("Delegation Protocol");
    expect(lines.join("\n")).toContain("1/2 protocol-backed");
    expect(lines.join("\n")).toContain("aggregation main_agent_summary:1");
    expect(lines.join("\n")).toContain("subtask-1: status=running, deliverable=patch, deliverable-summary=返回治理摘要, intent=整理工具治理摘要");
    expect(lines.join("\n")).toContain("Assistant Mode");
    expect(lines.join("\n")).toContain("mode on / explicit");
    expect(lines.join("\n")).toContain("status running");
    expect(lines.join("\n")).toContain("heartbeat on / 45m");
    expect(lines.join("\n")).toContain("cron on / jobs 2/3");
    expect(lines.join("\n")).toContain("notify resident + feishu > qq > community > discord");
    expect(lines.join("\n")).toContain("confirm required");
    expect(lines.join("\n")).toContain("resident running 1 / idle 1 / total 2");
    expect(lines.join("\n")).toContain("strategy: heartbeat=running, cron=ran, activeHours=08:00-23:00");
    expect(lines.join("\n")).toContain("driver policy: heartbeat + cron / source explicit");
    expect(lines.join("\n")).toContain("schedule policy: heartbeat 45m / 08:00-23:00 / cron jobs 2/3");
    expect(lines.join("\n")).toContain("delivery: resident channel always available; external preference resident + feishu > qq > community > discord");
    expect(lines.join("\n")).toContain("outbound policy: resident + feishu > qq > community > discord, confirm required");
    expect(lines.join("\n")).toContain("resident summary: 2 residents, active 1, running 1, digest ready 1, updated 1, shared review pending 1");
    expect(lines.join("\n")).toContain("resident focus: Belldandy, status=running, digest=updated/3, continue=Continue resident follow-up");
    expect(lines.join("\n")).toContain("long task summary: delegation protocol=1/2; active=1; completed=1; sources=goal_subtask:1");
    expect(lines.join("\n")).toContain("long task focus: subtask-1, status=running, agent=coder, intent=整理工具治理摘要, deliverable=返回治理摘要");
    expect(lines.join("\n")).toContain("goal summary: goals=2; active=2; blocked=1; pendingApproval=0; reviewing=0");
    expect(lines.join("\n")).toContain("goal focus: Review Flow, status=blocked, next=先解除 review 节点的阻塞，再继续推进。, blocked=等待用户确认策略, checkpoint=等待用户确认当前评审策略");
    expect(lines.join("\n")).toContain("next action: Continue Heartbeat, target=conversation:heartbeat-1");
    expect(lines.join("\n")).toContain("focus: Continue Heartbeat, target=conversation:heartbeat-1");
    expect(lines.join("\n")).toContain("blocked reason: waiting for the next eligible heartbeat or cron run");
    expect(lines.join("\n")).toContain("attention reason: Heartbeat: provider unavailable");
    expect(lines.join("\n")).toContain("attention item: Heartbeat: provider unavailable, target=conversation:heartbeat-1");
    expect(lines.join("\n")).toContain("attention item: 1 outbound confirmation(s) pending; latest qq request confirm-qq-1, target=conversation:conv-pending-qq");
    expect(lines.join("\n")).toContain("attention item: 1 enabled cron job(s) currently have no nextRunAtMs");
    expect(lines.join("\n")).toContain("agent snapshots:");
    expect(lines.join("\n")).toContain("Belldandy · 运行中");
    expect(lines.join("\n")).toContain("Coder · 空闲");
    expect(lines.join("\n")).toContain("Heartbeat: running, heartbeat, target=conversation:heartbeat-1, summary=Heartbeat follow-up");
    expect(lines.join("\n")).toContain("Digest: ran, cron, session=main, target=conversation:cron-main:cron-job-1, summary=Digest delivered");
    expect(lines.join("\n")).toContain("Config Source");
    expect(lines.join("\n")).toContain("current state-dir config");
    expect(lines.join("\n")).toContain("state-dir active");
    expect(lines.join("\n")).toContain("stateDir: C:/Users/admin/.star_sanctuary");
    expect(lines.join("\n")).toContain("resolution order: state-dir config (BELLDANDY_STATE_DIR)");
    expect(lines.join("\n")).toContain("Gateway reads .env / .env.local from BELLDANDY_STATE_DIR on every start.");
    expect(lines.join("\n")).toContain("Cron Runtime");
    expect(lines.join("\n")).toContain("2/3 jobs enabled");
    expect(lines.join("\n")).toContain("delivery user 2 / none 1");
    expect(lines.join("\n")).toContain("running / active 2");
    expect(lines.join("\n")).toContain("Digest: every 60000ms, enabled, session=main, delivery=user, failure=user, stagger=15000");
    expect(lines.join("\n")).toContain("Background Continuation Runtime");
    expect(lines.join("\n")).toContain("4 runs / running 1");
    expect(lines.join("\n")).toContain("cron 2 / heartbeat 1 / subtask 1");
    expect(lines.join("\n")).toContain("Digest: ran, cron, session=main, target=conversation:cron-main:cron-job-1");
    expect(lines.join("\n")).toContain("Implement runtime bridge: ran, subtask, target=session:sub-session-1, summary=patch delivered");
    expect(lines.join("\n")).toContain("Heartbeat: failed, heartbeat, reason=provider unavailable");
    expect(lines.join("\n")).toContain("External Outbound Runtime");
    expect(lines.join("\n")).toContain("5 records / sent 3 / failed 2");
    expect(lines.join("\n")).toContain("resolve 1 / delivery 1 / confirmation 0");
    expect(lines.join("\n")).toContain("channels feishu:2, qq:2, discord:1");
    expect(lines.join("\n")).toContain("error codes binding_not_found:1, send_failed:1");
    expect(lines.join("\n")).toContain("qq, 目标解析失败 · binding_not_found / 没有可用 binding");
    expect(lines.join("\n")).toContain("discord, 渠道投递失败 · send_failed / 渠道发送失败 · discord send failed");
    expect(lines.join("\n")).toContain("详细逐条记录仍可在 记忆查看 -> 消息审计 中查看。");
    expect(lines.join("\n")).toContain("Email Outbound Runtime");
    expect(lines.join("\n")).toContain("3 records / sent 2 / failed 1");
    expect(lines.join("\n")).toContain("attachments 1");
    expect(lines.join("\n")).toContain("providers smtp:3");
    expect(lines.join("\n")).toContain("accounts default:3");
    expect(lines.join("\n")).toContain("code=send_failed");
    expect(lines.join("\n")).toContain("reply=<reply-001@example.com>");
    expect(lines.join("\n")).toContain("thread=<thread-001@example.com>");
      expect(lines.join("\n")).toContain("Email Inbound Runtime");
      expect(lines.join("\n")).toContain("setup configured");
      expect(lines.join("\n")).toContain("IMAP polling is configured for primary@imap.example.com:993/INBOX -> agent default. First attach bootstrap=latest. Recent window limit=50.");
      expect(lines.join("\n")).toContain("account primary / imap.example.com:993 / secure=true / mailbox INBOX / agent default / interval 60000ms / bootstrap latest / recent window 50");
    expect(lines.join("\n")).toContain("如果你刚改过 .env/.env.local 但这里没变化，先去看 Config Source 卡片确认当前生效目录。");
    expect(lines.join("\n")).toContain("4 records / processed 2 / failed 1");
    expect(lines.join("\n")).toContain("invalid 1 / duplicates 1");
    expect(lines.join("\n")).toContain("mailboxes INBOX:4");
    expect(lines.join("\n")).toContain("statuses processed:2, failed:1, invalid_event:1, skipped_duplicate:1");
    expect(lines.join("\n")).toContain("message=<msg-900@example.com>");
    expect(lines.join("\n")).toContain("Camera Runtime");
    expect(lines.join("\n")).toContain("2 provider(s)");
    expect(lines.join("\n")).toContain("default native_desktop");
    expect(lines.join("\n")).toContain("default selection: policy=prefer_native_desktop, selected=native_desktop, reason=policy_preferred_provider, fallback=no");
    expect(lines.join("\n")).toContain("provider order: native_desktop -> browser_loopback -> node_device");
    expect(lines.join("\n")).toContain("registered providers: native_desktop, browser_loopback");
    expect(lines.join("\n")).toContain("fallback ready: browser_loopback");
    expect(lines.join("\n")).toContain("missing fallbacks: node_device");
    expect(lines.join("\n")).toContain("configured default: browser_loopback");
    expect(lines.join("\n")).toContain("selection trace: native_desktop:selected:policy_preferred");
    expect(lines.join("\n")).toContain("governance: 1 个 provider 需要优先处理；主失败码=device_busy。");
    expect(lines.join("\n")).toContain("governance counts: blocked=1, permission_blocked=0, permission_prompt=0, fallback_active=0");
    expect(lines.join("\n")).toContain("recent trend: failures=0, recovered=0, failureProviders=0, repeatedFallback=no, dominant=device_busy");
    expect(lines.join("\n")).toContain("why unhealthy: native_desktop 当前需要优先处理；依据=permission_state + diagnostic_issue + runtime_health；主因=device_busy。");
    expect(lines.join("\n")).toContain("next action: 关闭正在占用摄像头的会议或录制软件后重试。");
    expect(lines.join("\n")).toContain("native_desktop; status=degraded; helper=ready; devices 1/1 available, busy=1; issues error=0, warning=1");
    expect(lines.join("\n")).toContain("launch: command=C:/Program Files/nodejs/node.exe, entry=packages/belldandy-skills/dist/builtin/multimedia/camera-native-desktop-helper.js, cwd=E:/project/star-sanctuary");
    expect(lines.join("\n")).toContain("device: Studio Cam => OBSBOT Tiny 2 StreamCamera [available, external, busy, favorite, stable=usb-3564-fef8-453a4b75]");
    expect(lines.join("\n")).toContain("alias memory: entries=1, observed=1, manual=1, favorite=1, snapshot=C:/Users/admin/.star_sanctuary/diagnostics/camera-runtime/device-aliases.json");
    expect(lines.join("\n")).toContain("runtime health: status=error, failures=1, lastSuccess=2026-04-17T11:20:00.000Z");
    expect(lines.join("\n")).toContain("runtime freshness: source=memory+snapshot, level=fresh, stale=no, ageMs=4200, ref=2026-04-17T11:20:05.000Z");
    expect(lines.join("\n")).toContain("runtime retention: events<=32, horizonMs=604800000");
    expect(lines.join("\n")).toContain("runtime window: events=2, success=1, failure=1, recovered=1, codes=device_busy:1");
    expect(lines.join("\n")).toContain("recent events: capture_snapshot/failure:device_busy -> capture_snapshot/success:recovered");
    expect(lines.join("\n")).toContain("last failure: device_busy @ 2026-04-17T11:19:00.000Z (capture_snapshot) OBSBOT Tiny 2 StreamCamera is currently busy.");
    expect(lines.join("\n")).toContain("recent recovery hint: 关闭正在占用摄像头的会议或录制软件后重试。");
    expect(lines.join("\n")).toContain("health check: status=warn, source=diagnostic, sources=permission_state, diagnostic_issue, runtime_health, actionable=yes, codes=device_busy");
    expect(lines.join("\n")).toContain("governance: native_desktop 当前不可用：摄像头正在被其他应用占用。");
    expect(lines.join("\n")).toContain("permission: state=granted, gating=clear, actionable=no");
    expect(lines.join("\n")).toContain("failure stats: total=1, info=0, warning=1, error=0, retryable=1, dominant=device_busy");
    expect(lines.join("\n")).toContain("failure window: events=2, success=1, failure=1, recovered=1, dominant=device_busy, last=device_busy");
    expect(lines.join("\n")).toContain("failure codes: device_busy:2");
    expect(lines.join("\n")).toContain("recovery actions: now/close_competing_app:关闭正在占用摄像头的会议或录制软件后重试。 | next/retry:释放占用后最多重试一次，再观察 camera runtime 状态。");
    expect(lines.join("\n")).toContain("recovery: 关闭正在占用摄像头的会议或录制软件后重试。");
    expect(lines.join("\n")).toContain("Native Desktop Helper");
    expect(lines.join("\n")).toContain("configured yes");
    expect(lines.join("\n")).toContain("helper ready");
    expect(lines.join("\n")).toContain("PowerShell ready");
    expect(lines.join("\n")).toContain("FFmpeg ready");
    expect(lines.join("\n")).toContain("version 0.1.0");
    expect(lines.join("\n")).toContain("status: provider=degraded, helper=ready, permission=granted, registered=yes, configured=yes");
    expect(lines.join("\n")).toContain("launch: transport=stdio, command=C:/Program Files/nodejs/node.exe, entry=packages/belldandy-skills/dist/builtin/multimedia/camera-native-desktop-helper.js, cwd=E:/project/star-sanctuary");
    expect(lines.join("\n")).toContain("toolchain: powershell=powershell.exe (ready), ffmpeg=ffmpeg.exe (ready)");
    expect(lines.join("\n")).toContain("capabilities: camera_list=yes, camera_snapshot=yes, screen_targets=yes, screen_capture=yes, display_capture=yes, window_capture=yes, region_capture=yes");
    expect(lines.join("\n")).toContain("latest issue: device_busy / OBSBOT Tiny 2 StreamCamera is currently busy.");
    expect(lines.join("\n")).toContain("Agent Stop Runtime");
    expect(lines.join("\n")).toContain("2 stop requests");
    expect(lines.join("\n")).toContain("1 still running after stop");
    expect(lines.join("\n")).toContain("running_after_stop 1 / completed_after_stop 0 / failed_after_stop 0 / not_found 0 / run_mismatch 0");
    expect(lines.join("\n")).toContain("conv-1 / run-1: outcome=running_after_stop, reason=Stopped by user., message=running/tool_result_emitted");
    expect(lines.join("\n")).toContain("conv-2 / run-2: outcome=stopped, reason=Stopped by user., message=completed/completed / response=stopped");
    expect(lines.join("\n")).toContain("Query Runtime");
    expect(lines.join("\n")).toContain("1 traces");
    expect(lines.join("\n")).toContain("latest message.send");
    expect(lines.join("\n")).toContain("trace=-, latest stage=completed");
    expect(lines.join("\n")).toContain("usage calibration @ completed: estimated=1800, avg actual input/call=1050, delta=-42%, status=over_estimated");
    expect(lines.join("\n")).toContain("Runtime Resilience");
    expect(lines.join("\n")).toContain("primary openai.com/gpt-4.1");
    expect(lines.join("\n")).toContain("1 fallbacks");
    expect(lines.join("\n")).toContain("latest success");
    expect(lines.join("\n")).toContain("compaction route openai.com/gpt-4.1-mini");
    expect(lines.join("\n")).toContain("compaction aux verdict deepseek_flash_preferred / deepseek_primary_with_flash_candidate / enabled=yes");
  });
});

describe("doctor observability rendering", () => {
  function createRenderPayload() {
    return {
      promptObservability: {
        summary: {
          scope: "run",
          agentId: "default",
          counts: {
            sectionCount: 2,
            deltaCount: 1,
            providerNativeSystemBlockCount: 1,
          },
          promptSizes: {
            finalChars: 120,
          },
          tokenBreakdown: {
            systemPromptEstimatedTokens: 32,
          },
        },
        latestRun: {
          id: "dream-obs-1",
          status: "completed",
          requestedAt: "2026-04-19T12:00:00.000Z",
          finishedAt: "2026-04-19T12:05:00.000Z",
          summary: "收口共享审批和 dream writer 的链路差异。",
          generationMode: "fallback",
          fallbackReason: "llm_call_failed",
          consolidation: {
            profilePatchCandidates: [{ field: "profile.headline" }],
            staleCandidates: [{ memoryClass: "governance" }],
            contradictionCandidates: [{ topic: "review pressure" }],
          },
        },
      },
      queryRuntime: {
        traces: [
          {
            method: "message.send",
            stages: [
              {
                stage: "completed",
                detail: {
                  localPromptEstimate: {
                    systemPromptTokens: 41651,
                    contextTokens: 1902,
                    totalPromptTokens: 43553,
                  },
                  providerRawUsage: {
                    promptTokens: 35338,
                    completionTokens: 81,
                    totalTokens: 35419,
                  },
                  requestShape: {
                    messageCount: 23,
                    systemMessageCount: 7,
                    toolSchemaCount: 66,
                  },
                  usageCalibration: {
                    estimatedPromptTokens: 1800,
                    actualInputTokens: 2100,
                    modelCalls: 2,
                    averageInputTokensPerCall: 1050,
                    deltaTokens: -750,
                    deltaRatio: -0.4167,
                    status: "over_estimated",
                  },
                },
              },
            ],
          },
        ],
      },
      toolBehaviorObservability: {
        counts: {
          includedContractCount: 2,
          visibleToolContractCount: 2,
        },
        included: ["run_command"],
      },
      toolContractV2Observability: {
        summary: {
          totalCount: 2,
          missingV2Count: 0,
          highRiskCount: 1,
          confirmRequiredCount: 1,
          missingV2Tools: [],
        },
      },
      residentAgents: {
        summary: {
          totalCount: 1,
          activeCount: 1,
          runningCount: 1,
          idleCount: 0,
          backgroundCount: 0,
          errorCount: 0,
          digestReadyCount: 1,
          digestUpdatedCount: 0,
          digestIdleCount: 0,
          digestMissingCount: 0,
          recentTaskLinkedCount: 0,
          recentSubtaskLinkedCount: 0,
          experienceUsageLinkedCount: 0,
          catalogAnnotatedCount: 0,
          structuredHandoffCount: 0,
          skillHintedCount: 0,
          headline: "1 resident",
          memoryModeCounts: {
            isolated: 1,
            shared: 0,
            hybrid: 0,
          },
        },
        agents: [],
      },
      mindProfileSnapshot: {
        summary: {
          available: true,
          hasUserProfile: true,
          privateMemoryCount: 1,
          sharedMemoryCount: 0,
          activeResidentCount: 1,
          digestReadyCount: 1,
          digestUpdatedCount: 0,
          usageLinkedCount: 0,
          headline: "mind profile ready",
        },
        profile: {
          summaryLines: ["USER.md ready"],
        },
      },
      memoryFreshness: {
        summary: {
          available: true,
          headline: "当前治理队列存在待收口项",
          reviewRequiredCount: 1,
          staleCount: 0,
          supersededCount: 0,
          activeCount: 1,
        },
        items: [
          {
            memoryClass: "governance",
            status: "review_required",
            freshnessHeadline: "当前治理队列存在待收口项",
          },
        ],
      },
      memoryEvaluation: {
        available: true,
        status: "warn",
        headline: "Memory evaluation needs attention: profile=0, freshness review=1, shared pending=0, dream patch backlog=1.",
        profileStateFieldCount: 0,
        freshnessReviewRequiredCount: 1,
        freshnessStaleCount: 0,
        governancePendingCount: 0,
        governanceClaimedCount: 0,
        dreamProfilePatchBacklogCount: 1,
        dreamStaleBacklogCount: 1,
        dreamContradictionBacklogCount: 1,
        experienceUsageLinkedResidentCount: 0,
        signals: [
          "freshness review=1, stale=0",
          "dream backlog patch=1, stale=1, contradiction=1",
        ],
      },
    };
  }

  function flushAnimationFrames(queue) {
    let cursor = 0;
    while (cursor < queue.length) {
      const callback = queue[cursor];
      cursor += 1;
      if (typeof callback === "function") {
        callback(16 * cursor);
      }
    }
  }

  it("renders doctor cards in batches after the first synchronous chunk", () => {
    const callbacks = [];
    vi.stubGlobal("requestAnimationFrame", (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", (handle) => {
      callbacks[handle - 1] = null;
    });

    const container = document.createElement("div");
    renderDoctorObservabilityCards(container, createRenderPayload());

    const initialCount = container.children.length;
    expect(initialCount).toBeGreaterThan(0);
    expect(callbacks.length).toBeGreaterThan(0);

    flushAnimationFrames(callbacks);

    expect(container.children.length).toBeGreaterThan(initialCount);
  });

  it("cancels stale async doctor card batches when the container is rerendered", () => {
    const callbacks = [];
    vi.stubGlobal("requestAnimationFrame", (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", (handle) => {
      callbacks[handle - 1] = null;
    });

    const container = document.createElement("div");
    renderDoctorObservabilityCards(container, createRenderPayload());
    expect(callbacks.length).toBeGreaterThan(0);

    container.replaceChildren();
    renderDoctorObservabilityCards(container, {});
    flushAnimationFrames(callbacks);

    expect(container.children.length).toBe(0);
  });

  it("renders external outbound runtime as pass after later recovery even if historical failures remain", () => {
    const callbacks = [];
    vi.stubGlobal("requestAnimationFrame", (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", (handle) => {
      callbacks[handle - 1] = null;
    });

    const payload = createRenderPayload();
    payload.externalOutboundRuntime = {
      requireConfirmation: true,
      health: {
        status: "pass",
        activeFailure: false,
        recoveredAfterFailure: true,
        latestRecordAt: 1710000130000,
        latestSentAt: 1710000130000,
        latestFailedAt: 1710000120000,
      },
      totals: {
        totalRecords: 3,
        pendingConfirmationCount: 0,
        confirmedCount: 2,
        autoApprovedCount: 0,
        rejectedCount: 0,
        sentCount: 2,
        failedCount: 1,
        resolveFailedCount: 1,
        deliveryFailedCount: 0,
      },
      channelCounts: {
        feishu: 2,
        qq: 1,
      },
      errorCodeCounts: {
        binding_not_found: 1,
      },
      failureStageCounts: {
        resolve: 1,
        delivery: 0,
        confirmation: 0,
      },
      recentFailures: [
        {
          timestamp: 1710000120000,
          targetChannel: "qq",
          delivery: "failed",
          resolution: "latest_binding",
          failureStage: "resolve",
          errorCode: "binding_not_found",
          error: "当前没有可用于 qq 的最新会话绑定。",
          requestedSessionKey: "channel=qq:chat=chat-2",
          contentPreview: "请去 QQ 提醒我",
        },
      ],
      recentPending: [],
      headline: "records=3; sent=2; failed=1; resolve_failed=1; delivery_failed=0; confirm=required",
    };

    const container = document.createElement("div");
    renderDoctorObservabilityCards(container, payload);
    flushAnimationFrames(callbacks);

    const externalOutboundCard = Array.from(container.children).find((node) =>
      node.textContent?.includes("External Outbound Runtime")
    );
    expect(externalOutboundCard).toBeTruthy();
    const firstBadge = externalOutboundCard.querySelector(".badge");
    expect(firstBadge?.className).toContain("pass");
    expect(firstBadge?.className).not.toContain("warn");
  });

  it("renders usage calibration note inside the prompt doctor card", () => {
    const callbacks = [];
    vi.stubGlobal("requestAnimationFrame", (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", (handle) => {
      callbacks[handle - 1] = null;
    });

    const container = document.createElement("div");
    renderDoctorObservabilityCards(container, createRenderPayload());
    flushAnimationFrames(callbacks);

    expect(container.textContent || "").toContain("estimated=1800");
    expect(container.textContent || "").toContain("avg actual input/call=1050");
  });

  it("renders token usage diagnostics in the settings system checks", () => {
    const lines = buildDoctorChatSummary(createRenderPayload());

    expect(lines.join("\n")).toContain("Token Usage Diagnostics");
    expect(lines.join("\n")).toContain("LOCAL sys=41,651 ctx=1,902 total=43,553 msg=23 sysmsg=7 tools=66");
    expect(lines.join("\n")).toContain("RAW prompt=35,338 completion=81 total=35,419");
  });

  it("renders memory freshness in the doctor chat summary", () => {
    const lines = buildDoctorChatSummary(createRenderPayload());

    expect(lines.join("\n")).toContain("Memory Freshness");
    expect(lines.join("\n")).toContain("当前治理队列存在待收口项");
    expect(lines.join("\n")).toContain("governance [review_required]");
  });

  it("renders memory evaluation in the doctor chat summary", () => {
    const lines = buildDoctorChatSummary(createRenderPayload());

    expect(lines.join("\n")).toContain("Memory Evaluation");
    expect(lines.join("\n")).toContain("profile coverage 0");
    expect(lines.join("\n")).toContain("dream patch 1 / stale 1 / contradiction 1");
    expect(lines.join("\n")).toContain("Memory evaluation needs attention");
  });

  it("renders query runtime calibration summary in doctor cards", () => {
    const callbacks = [];
    vi.stubGlobal("requestAnimationFrame", (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", (handle) => {
      callbacks[handle - 1] = null;
    });

    const container = document.createElement("div");
    renderDoctorObservabilityCards(container, createRenderPayload());
    flushAnimationFrames(callbacks);

    expect(container.textContent || "").toContain("Query Runtime");
    expect(container.textContent || "").toContain("latest stage=completed");
    expect(container.textContent || "").toContain("usage calibration @ completed: estimated=1800, avg actual input/call=1050, delta=-42%, status=over_estimated");
  });

  it("renders memory freshness card from top-level doctor payload", () => {
    const callbacks = [];
    vi.stubGlobal("requestAnimationFrame", (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", (handle) => {
      callbacks[handle - 1] = null;
    });

    const container = document.createElement("div");
    renderDoctorObservabilityCards(container, createRenderPayload());
    flushAnimationFrames(callbacks);

    expect(container.textContent || "").toContain("Memory Freshness");
    expect(container.textContent || "").toContain("当前治理队列存在待收口项");
  });

  it("renders memory evaluation card from top-level doctor payload", () => {
    const callbacks = [];
    vi.stubGlobal("requestAnimationFrame", (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", (handle) => {
      callbacks[handle - 1] = null;
    });

    const container = document.createElement("div");
    renderDoctorObservabilityCards(container, createRenderPayload());
    flushAnimationFrames(callbacks);

    expect(container.textContent || "").toContain("Memory Evaluation");
    expect(container.textContent || "").toContain("profile coverage 0");
    expect(container.textContent || "").toContain("dream patch 1 / stale 1 / contradiction 1");
  });
});
