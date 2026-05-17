import crypto from "node:crypto";

import type { AgentRegistry, BelldandyAgent, ConversationStore } from "@belldandy/agent";
import {
  evaluateChannelSecurityPolicy,
  loadChannelSecurityConfig,
  resolveChannelSecurityConfigPath,
  type ChannelSecurityApprovalRequestInput,
} from "@belldandy/channels";
import type { MessageSendParams } from "@belldandy/protocol";
import { runAgentToCompletionWithLifecycle } from "./query-runtime-agent-run.js";
import { QueryRuntime, type QueryRuntimeObserver } from "./query-runtime.js";
import {
  appendAutoTaskReport,
  consumeAutoTaskReport,
  resolveAutoTaskReportForOutput,
  sanitizeVisibleAssistantText,
} from "./task-auto-report.js";
import type { WebhookConfig, WebhookRequestParams, IdempotencyManager, WebhookResponse } from "./webhook/index.js";
import { findWebhookRule, generateConversationId, generatePromptFromPayload, verifyWebhookToken } from "./webhook/index.js";

type QueryRuntimeLogger = {
  info: (module: string, message: string, data?: unknown) => void;
  error: (module: string, message: string, data?: unknown) => void;
};

type RoomMember = NonNullable<NonNullable<MessageSendParams["roomContext"]>["members"]>[number];

export type QueryRuntimeHttpMethod = "api.message" | "webhook.receive";

export type QueryRuntimeHttpJsonResponse = {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
};

export type CommunityMessageQueryRuntimeContext = {
  requestId: string;
  authorization?: string;
  communityApiToken?: string;
  body: unknown;
  stateDir: string;
  agentFactory?: () => BelldandyAgent;
  agentRegistry?: AgentRegistry;
  conversationStore: ConversationStore;
  log: QueryRuntimeLogger;
  runtimeObserver?: QueryRuntimeObserver<"api.message">;
  onChannelSecurityApprovalRequired?: (input: ChannelSecurityApprovalRequestInput) => void | Promise<void>;
  emitAutoRunTaskTokenResult: (
    conversationStore: ConversationStore,
    payload: {
      conversationId: string;
      inputTokens: number;
      outputTokens: number;
      durationMs: number;
      inputCostUsd?: number;
      outputCostUsd?: number;
      totalCostUsd?: number;
    },
  ) => void;
};

export type WebhookReceiveQueryRuntimeContext = {
  requestId: string;
  webhookId?: string;
  authorization?: string;
  idempotencyKey?: string;
  body: unknown;
  agentFactory?: () => BelldandyAgent;
  agentRegistry?: AgentRegistry;
  webhookConfig?: WebhookConfig;
  webhookIdempotency?: IdempotencyManager;
  conversationStore: ConversationStore;
  log: QueryRuntimeLogger;
  runtimeObserver?: QueryRuntimeObserver<"webhook.receive">;
  emitAutoRunTaskTokenResult: (
    conversationStore: ConversationStore,
    payload: {
      conversationId: string;
      inputTokens: number;
      outputTokens: number;
      durationMs: number;
      inputCostUsd?: number;
      outputCostUsd?: number;
      totalCostUsd?: number;
    },
  ) => void;
};

export async function handleCommunityMessageWithQueryRuntime(
  ctx: CommunityMessageQueryRuntimeContext,
): Promise<QueryRuntimeHttpJsonResponse> {
  const runtime = new QueryRuntime({
    method: "api.message" as const,
    traceId: ctx.requestId,
    observer: ctx.runtimeObserver,
  });
  let conversationIdForCleanup: string | undefined;

  try {
    return await runtime.run(async (queryRuntime) => {
      queryRuntime.mark("runtime_checked", {
        detail: {
          tokenConfigured: Boolean(ctx.communityApiToken),
        },
      });

      if (!ctx.communityApiToken) {
        queryRuntime.mark("completed", {
          detail: {
            code: "API_MISCONFIGURED",
          },
        });
        return {
          status: 503,
          body: {
            ok: false,
            error: { code: "API_MISCONFIGURED", message: "Community API token is not configured." },
          },
        };
      }

      const authorization = ctx.authorization;
      const authorized = isBearerAuthorized(authorization, ctx.communityApiToken);
      queryRuntime.mark("auth_checked", {
        detail: {
          authorized,
        },
      });
      if (!authorized) {
        queryRuntime.mark("completed", {
          detail: {
            code: "UNAUTHORIZED",
          },
        });
        return {
          status: 401,
          headers: {
            "WWW-Authenticate": 'Bearer realm="belldandy-community"',
          },
          body: {
            ok: false,
            error: { code: "UNAUTHORIZED", message: "Missing or invalid bearer token." },
          },
        };
      }

      const body = isObjectRecord(ctx.body) ? ctx.body : {};
      const text = typeof body.text === "string" ? body.text : "";
      const conversationId = typeof body.conversationId === "string" ? body.conversationId : "";
      conversationIdForCleanup = conversationId || undefined;
      const from = typeof body.from === "string" ? body.from : undefined;
      const agentId = typeof body.agentId === "string" ? body.agentId : undefined;
      const accountId = typeof body.accountId === "string" ? body.accountId.trim() : "";
      const senderInfo = toSenderInfo(body.senderInfo);
      const roomContext = toRoomContext(body.roomContext);
      const mentioned = typeof body.mentioned === "boolean"
        ? body.mentioned
        : inferCommunityMentioned(text, accountId || agentId);
      const mentions = Array.isArray(body.mentions)
        ? body.mentions.map((item) => String(item)).filter(Boolean)
        : (mentioned ? [accountId || agentId || "__mentioned__"].filter(Boolean) : []);
      const senderId = senderInfo?.id ?? from;
      const chatKind = roomContext?.roomId ? "room" : "dm";

      if (!text) {
        queryRuntime.mark("completed", {
          detail: {
            code: "INVALID_REQUEST",
            missing: "text",
          },
        });
        return {
          status: 400,
          body: {
            ok: false,
            error: { code: "INVALID_REQUEST", message: "Missing or invalid 'text' field" },
          },
        };
      }

      if (!conversationId) {
        queryRuntime.mark("completed", {
          detail: {
            code: "INVALID_REQUEST",
            missing: "conversationId",
          },
        });
        return {
          status: 400,
          body: {
            ok: false,
            error: { code: "INVALID_REQUEST", message: "Missing or invalid 'conversationId' field" },
          },
        };
      }

      queryRuntime.mark("request_validated", {
        conversationId,
        detail: {
          from: from ?? "unknown",
          requestedAgentId: agentId ?? "default",
          accountId: accountId || undefined,
        },
      });

      const securityDecision = evaluateChannelSecurityPolicy(
        loadChannelSecurityConfig(resolveChannelSecurityConfigPath(ctx.stateDir)),
        {
          channel: "community",
          accountId: accountId || undefined,
          chatKind,
          chatId: roomContext?.roomId ?? conversationId,
          text,
          senderId,
          senderName: senderInfo?.name,
          mentions,
          mentioned,
          eventType: "http",
        },
      );
      if (securityDecision && !securityDecision.allow) {
        if (securityDecision.reason === "channel_security:dm_allowlist_blocked" && senderId) {
          await ctx.onChannelSecurityApprovalRequired?.({
            channel: "community",
            accountId: accountId || undefined,
            senderId,
            senderName: senderInfo?.name,
            chatId: roomContext?.roomId ?? conversationId,
            chatKind: "dm",
            messagePreview: text,
          });
        }
        queryRuntime.mark("completed", {
          conversationId,
          detail: {
            code: "CHANNEL_SECURITY_BLOCKED",
            reason: securityDecision.reason,
            accountId: accountId || undefined,
            chatKind,
          },
        });
        return {
          status: 403,
          body: {
            ok: false,
            error: {
              code: "CHANNEL_SECURITY_BLOCKED",
              message: `Community message blocked by channel security policy (${securityDecision.reason}).`,
            },
            payload: {
              reason: securityDecision.reason,
              accountId: accountId || undefined,
              chatKind,
            },
          },
        };
      }

      const agent = createAgent({
        agentFactory: ctx.agentFactory,
        agentRegistry: ctx.agentRegistry,
        requestedAgentId: agentId,
      });
      if (!agent) {
        queryRuntime.mark("completed", {
          conversationId,
          detail: {
            code: "AGENT_UNAVAILABLE",
          },
        });
        return {
          status: 503,
          body: {
            ok: false,
            error: { code: "AGENT_UNAVAILABLE", message: "No agent configured" },
          },
        };
      }

      queryRuntime.mark("agent_created", {
        conversationId,
        detail: {
          requestedAgentId: agentId ?? "default",
        },
      });

      ctx.log.info("api", `Processing community message: conversationId=${conversationId}, from=${from || "unknown"}`);

      const runId = crypto.randomUUID();
      queryRuntime.mark("agent_running", { conversationId });
      const runResult = await runAgentToCompletionWithLifecycle(agent, {
        conversationId,
        runInput: {
          conversationId,
          text,
          userInput: text,
          agentId,
          roomContext,
          senderInfo,
          meta: {
            runId,
            channel: "community",
            accountId: accountId || undefined,
          },
        },
        onToolEvent: (detail) => {
          queryRuntime.mark("tool_event_emitted", {
            conversationId,
            detail,
          });
        },
        onToolCall: (item) => {
          queryRuntime.mark("tool_call_emitted", {
            conversationId,
            detail: {
              toolName: item.name,
            },
          });
        },
        onToolResult: (item) => {
          queryRuntime.mark("tool_result_emitted", {
            conversationId,
            detail: {
              toolName: item.name,
              success: item.success,
              hasError: Boolean(item.error),
              ...(item.failureKind ? { failureKind: item.failureKind } : {}),
            },
          });
        },
        onFailed: (detail) => {
          ctx.log.error("api", "Community message agent run failed", {
            conversationId,
            ...detail,
          });
        },
      });

      if (runResult.latestUsage) {
        ctx.emitAutoRunTaskTokenResult(ctx.conversationStore, {
          conversationId,
          inputTokens: runResult.latestUsage.inputTokens,
          outputTokens: runResult.latestUsage.outputTokens,
          durationMs: runResult.durationMs,
          inputCostUsd: runResult.latestUsage.inputCostUsd,
          outputCostUsd: runResult.latestUsage.outputCostUsd,
          totalCostUsd: runResult.latestUsage.totalCostUsd,
        });
        queryRuntime.mark("task_result_recorded", {
          conversationId,
          detail: {
            inputTokens: runResult.latestUsage.inputTokens,
            outputTokens: runResult.latestUsage.outputTokens,
          },
        });
      }
      const responseText = appendAutoTaskReport(
        sanitizeVisibleAssistantText(runResult.finalText),
        resolveAutoTaskReportForOutput({
          conversationId,
          durationMs: runResult.durationMs,
          inputTokens: runResult.latestUsage?.inputTokens,
          outputTokens: runResult.latestUsage?.outputTokens,
        }),
      );

      queryRuntime.mark("response_built", {
        conversationId,
        detail: {
          hasUsage: Boolean(runResult.latestUsage),
          responseLength: responseText.length,
        },
      });
      queryRuntime.mark("completed", { conversationId });

      ctx.log.info("api", `Community message processed successfully: ${responseText.substring(0, 50)}...`);
      return {
        status: 200,
        body: {
          ok: true,
          payload: {
            conversationId,
            runId,
            response: responseText,
          },
        },
      };
    });
  } catch (error) {
    if (conversationIdForCleanup) {
      consumeAutoTaskReport(conversationIdForCleanup);
    }
    ctx.log.error("api", "Failed to process community message", error);
    return {
      status: 500,
      body: {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      },
    };
  }
}

export async function handleWebhookReceiveWithQueryRuntime(
  ctx: WebhookReceiveQueryRuntimeContext,
): Promise<QueryRuntimeHttpJsonResponse> {
  const runtime = new QueryRuntime({
    method: "webhook.receive" as const,
    traceId: ctx.requestId,
    observer: ctx.runtimeObserver,
  });

  let ownedIdempotency = false;
  let conversationIdForCleanup: string | undefined;

  try {
    return await runtime.run(async (queryRuntime) => {
      queryRuntime.mark("runtime_checked", {
        detail: {
          hasWebhookConfig: Boolean(ctx.webhookConfig),
          hasIdempotencyManager: Boolean(ctx.webhookIdempotency),
        },
      });

      const webhookId = typeof ctx.webhookId === "string" ? ctx.webhookId : "";
      if (!webhookId) {
        queryRuntime.mark("completed", {
          detail: {
            code: "INVALID_REQUEST",
            missing: "webhookId",
          },
        });
        return {
          status: 400,
          body: {
            ok: false,
            error: { code: "INVALID_REQUEST", message: "Missing webhook ID" },
          },
        };
      }

      const rule = ctx.webhookConfig ? findWebhookRule(ctx.webhookConfig, webhookId) : undefined;
      if (!rule) {
        queryRuntime.mark("completed", {
          detail: {
            webhookId,
            code: "WEBHOOK_NOT_FOUND",
          },
        });
        return {
          status: 404,
          body: {
            ok: false,
            error: { code: "WEBHOOK_NOT_FOUND", message: `Webhook "${webhookId}" not found` },
          },
        };
      }

      queryRuntime.mark("webhook_rule_loaded", {
        detail: {
          webhookId,
          enabled: rule.enabled,
        },
      });
      if (!rule.enabled) {
        queryRuntime.mark("completed", {
          detail: {
            webhookId,
            code: "WEBHOOK_DISABLED",
          },
        });
        return {
          status: 403,
          body: {
            ok: false,
            error: { code: "WEBHOOK_DISABLED", message: `Webhook "${webhookId}" is disabled` },
          },
        };
      }

      const authorized = verifyWebhookToken(rule, ctx.authorization);
      queryRuntime.mark("auth_checked", {
        detail: {
          webhookId,
          authorized,
        },
      });
      if (!authorized) {
        queryRuntime.mark("completed", {
          detail: {
            webhookId,
            code: "UNAUTHORIZED",
          },
        });
        return {
          status: 401,
          headers: {
            "WWW-Authenticate": 'Bearer realm="belldandy-webhook"',
          },
          body: {
            ok: false,
            error: { code: "UNAUTHORIZED", message: "Missing or invalid bearer token" },
          },
        };
      }

      const idempotencyKey = typeof ctx.idempotencyKey === "string" ? ctx.idempotencyKey : undefined;
      const idempotencyManager = idempotencyKey ? ctx.webhookIdempotency : undefined;
      if (idempotencyManager && idempotencyKey) {
        const acquired = idempotencyManager.acquireRequest(webhookId, idempotencyKey);
        queryRuntime.mark("idempotency_checked", {
          detail: {
            webhookId,
            keyPresent: true,
            result: acquired.status,
          },
        });
        if (acquired.status === "cached") {
          ctx.log.info("webhook", `Duplicate request detected from cache: ${webhookId} / ${idempotencyKey}`);
          queryRuntime.mark("response_built", {
            detail: {
              webhookId,
              duplicate: true,
              source: "cache",
            },
          });
          queryRuntime.mark("completed");
          return {
            status: 200,
            body: { ...acquired.response, duplicate: true },
          };
        }
        if (acquired.status === "pending") {
          ctx.log.info("webhook", `Duplicate request joined in-flight execution: ${webhookId} / ${idempotencyKey}`);
          try {
            const response = await acquired.promise;
            queryRuntime.mark("response_built", {
              detail: {
                webhookId,
                duplicate: true,
                source: "pending",
              },
            });
            queryRuntime.mark("completed");
            return {
              status: 200,
              body: { ...response, duplicate: true },
            };
          } catch (error) {
            queryRuntime.mark("completed", {
              detail: {
                webhookId,
                duplicate: true,
                code: "INTERNAL_ERROR",
              },
            });
            return {
              status: 500,
              body: {
                ok: false,
                error: {
                  code: "INTERNAL_ERROR",
                  message: error instanceof Error ? error.message : "Unknown error",
                },
              },
            };
          }
        }
        ownedIdempotency = true;
      } else {
        queryRuntime.mark("idempotency_checked", {
          detail: {
            webhookId,
            keyPresent: false,
            result: "bypass",
          },
        });
      }

      const params = isObjectRecord(ctx.body) ? ctx.body as WebhookRequestParams : {};
      const requestedAgentId = typeof params.agentId === "string" ? params.agentId : rule.defaultAgentId;
      const conversationId = typeof params.conversationId === "string" && params.conversationId
        ? params.conversationId
        : generateConversationId(rule);
      conversationIdForCleanup = conversationId;

      let promptText = typeof params.text === "string" ? params.text : "";
      if (!promptText && params.payload) {
        promptText = generatePromptFromPayload(rule, params.payload);
      }

      queryRuntime.mark("prompt_built", {
        conversationId,
        detail: {
          webhookId,
          source: typeof params.text === "string" && params.text ? "text" : params.payload ? "payload" : "empty",
          promptLength: promptText.length,
        },
      });

      if (!promptText.trim()) {
        queryRuntime.mark("completed", {
          conversationId,
          detail: {
            webhookId,
            code: "INVALID_REQUEST",
            missing: "text_or_payload",
          },
        });
        return {
          status: 400,
          body: {
            ok: false,
            error: { code: "INVALID_REQUEST", message: "Missing text or payload" },
          },
        };
      }

      queryRuntime.mark("request_validated", {
        conversationId,
        detail: {
          webhookId,
          requestedAgentId: requestedAgentId ?? "default",
        },
      });

      const agent = createAgent({
        agentFactory: ctx.agentFactory,
        agentRegistry: ctx.agentRegistry,
        requestedAgentId,
      });
      if (!agent) {
        queryRuntime.mark("completed", {
          conversationId,
          detail: {
            webhookId,
            code: "AGENT_UNAVAILABLE",
          },
        });
        return {
          status: 503,
          body: {
            ok: false,
            error: { code: "AGENT_UNAVAILABLE", message: "No agent configured" },
          },
        };
      }

      queryRuntime.mark("agent_created", {
        conversationId,
        detail: {
          webhookId,
          requestedAgentId: requestedAgentId ?? "default",
        },
      });

      ctx.log.info("webhook", `Processing webhook: id=${webhookId}, conversationId=${conversationId}, agentId=${requestedAgentId ?? "default"}`);

      const runId = crypto.randomUUID();
      queryRuntime.mark("agent_running", {
        conversationId,
        detail: {
          webhookId,
        },
      });
      const runResult = await runAgentToCompletionWithLifecycle(agent, {
        conversationId,
        runInput: {
          conversationId,
          text: promptText,
          userInput: promptText,
          agentId: requestedAgentId,
          meta: {
            runId,
          },
        },
        onToolEvent: (detail) => {
          queryRuntime.mark("tool_event_emitted", {
            conversationId,
            detail,
          });
        },
        onToolCall: (item) => {
          queryRuntime.mark("tool_call_emitted", {
            conversationId,
            detail: {
              toolName: item.name,
            },
          });
        },
        onToolResult: (item) => {
          queryRuntime.mark("tool_result_emitted", {
            conversationId,
            detail: {
              toolName: item.name,
              success: item.success,
              hasError: Boolean(item.error),
              ...(item.failureKind ? { failureKind: item.failureKind } : {}),
            },
          });
        },
        onFailed: (detail) => {
          ctx.log.error("webhook", "Webhook agent run failed", {
            conversationId,
            webhookId,
            ...detail,
          });
        },
      });

      if (runResult.latestUsage) {
        ctx.emitAutoRunTaskTokenResult(ctx.conversationStore, {
          conversationId,
          inputTokens: runResult.latestUsage.inputTokens,
          outputTokens: runResult.latestUsage.outputTokens,
          durationMs: runResult.durationMs,
          inputCostUsd: runResult.latestUsage.inputCostUsd,
          outputCostUsd: runResult.latestUsage.outputCostUsd,
          totalCostUsd: runResult.latestUsage.totalCostUsd,
        });
        queryRuntime.mark("task_result_recorded", {
          conversationId,
          detail: {
            inputTokens: runResult.latestUsage.inputTokens,
            outputTokens: runResult.latestUsage.outputTokens,
          },
        });
      }
      const responseText = appendAutoTaskReport(
        sanitizeVisibleAssistantText(runResult.finalText),
        resolveAutoTaskReportForOutput({
          conversationId,
          durationMs: runResult.durationMs,
          inputTokens: runResult.latestUsage?.inputTokens,
          outputTokens: runResult.latestUsage?.outputTokens,
        }),
      );

      const response: WebhookResponse = {
        ok: true,
        payload: {
          webhookId,
          conversationId,
          runId,
          response: responseText,
        },
      };

      if (idempotencyManager && idempotencyKey) {
        idempotencyManager.completeRequest(webhookId, idempotencyKey, response);
        ownedIdempotency = false;
      }

      queryRuntime.mark("response_built", {
        conversationId,
        detail: {
          webhookId,
          hasUsage: Boolean(runResult.latestUsage),
          responseLength: responseText.length,
        },
      });
      queryRuntime.mark("completed", { conversationId });

      ctx.log.info("webhook", `Webhook processed successfully: ${responseText.substring(0, 50)}...`);
      return {
        status: 200,
        body: response as unknown as Record<string, unknown>,
      };
    });
  } catch (error) {
    const webhookId = typeof ctx.webhookId === "string" ? ctx.webhookId : "";
    const idempotencyKey = typeof ctx.idempotencyKey === "string" ? ctx.idempotencyKey : undefined;
    if (ownedIdempotency && webhookId && idempotencyKey && ctx.webhookIdempotency) {
      ctx.webhookIdempotency.failRequest(webhookId, idempotencyKey, error);
    }
    if (conversationIdForCleanup) {
      consumeAutoTaskReport(conversationIdForCleanup);
    }
    ctx.log.error("webhook", "Failed to process webhook", error);
    return {
      status: 500,
      body: {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      },
    };
  }
}

function createAgent(input: {
  agentFactory?: () => BelldandyAgent;
  agentRegistry?: AgentRegistry;
  requestedAgentId?: string;
}): BelldandyAgent | undefined {
  if (input.requestedAgentId && input.agentRegistry) {
    return input.agentRegistry.create(input.requestedAgentId);
  }
  return input.agentFactory?.();
}

function isBearerAuthorized(authorization: string | undefined, expectedToken: string): boolean {
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
    return false;
  }
  const token = authorization.slice("Bearer ".length).trim();
  return Boolean(token) && token === expectedToken;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function inferCommunityMentioned(text: string, accountId?: string): boolean {
  const normalizedText = String(text ?? "").trim().toLowerCase();
  const normalizedAccountId = typeof accountId === "string" ? accountId.trim().toLowerCase() : "";
  if (!normalizedText || !normalizedAccountId) return false;
  return normalizedText.includes(`@${normalizedAccountId}`) || normalizedText.includes(normalizedAccountId);
}

function toSenderInfo(value: unknown): MessageSendParams["senderInfo"] {
  if (!isObjectRecord(value)) {
    return undefined;
  }
  const type = value.type === "user" || value.type === "agent" ? value.type : undefined;
  const id = typeof value.id === "string" ? value.id : undefined;
  if (!type || !id) {
    return undefined;
  }
  return {
    type,
    id,
    name: typeof value.name === "string" ? value.name : undefined,
    identity: typeof value.identity === "string" ? value.identity : undefined,
  };
}

function toRoomContext(value: unknown): MessageSendParams["roomContext"] {
  if (!isObjectRecord(value)) {
    return undefined;
  }
  const environment = value.environment === "local" || value.environment === "community"
    ? value.environment
    : undefined;
  if (!environment) {
    return undefined;
  }

  let members: RoomMember[] | undefined;
  if (Array.isArray(value.members)) {
    members = [];
    for (const member of value.members) {
      if (!isObjectRecord(member)) {
        continue;
      }
      const type = member.type === "user" || member.type === "agent" ? member.type : undefined;
      const id = typeof member.id === "string" ? member.id : undefined;
      if (!type || !id) {
        continue;
      }
      members.push({
        type,
        id,
        name: typeof member.name === "string" ? member.name : undefined,
        identity: typeof member.identity === "string" ? member.identity : undefined,
      });
    }
  }

  return {
    environment,
    roomId: typeof value.roomId === "string" ? value.roomId : undefined,
    sessionKey: typeof value.sessionKey === "string" ? value.sessionKey : undefined,
    clientId: typeof value.clientId === "string" ? value.clientId : undefined,
    members,
  };
}
