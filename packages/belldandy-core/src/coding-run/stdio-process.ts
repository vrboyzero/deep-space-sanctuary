import {
  CODING_RUN_EXIT_CODES,
  toSafeCodingRunErrorMessage,
  type AgentRunEvent,
  type CodingRunErrorCode,
  type CodingRunSubscription,
  type CodingRunSubscriptionErrorCode,
  type RunControl,
} from "./contracts.js";
import { GatewayCodingRunSubscriptionSession } from "./gateway-subscription-session.js";
import {
  CodingRunControlError,
  CodingRunSubscriptionError,
  createCodingRunNdjsonServer,
  type CodingRunArtifactRequest,
  type CodingRunConversationRequest,
} from "./stdio.js";
import { invokeGatewayMethod } from "../cli/shared/gateway-rpc.js";

export type GatewayControlInvocationResult =
  | { ok: true; payload: unknown }
  | { ok: false; error: { code: CodingRunErrorCode; message: string } };

export type GatewayConversationInvocationResult =
  | { ok: true; payload: unknown }
  | { ok: false; error: { code: CodingRunErrorCode; message: string } };

export type GatewaySubscriptionInvocationResult =
  | { ok: true; payload: unknown }
  | { ok: false; error: { code: CodingRunSubscriptionErrorCode; message: string } };

export type GatewayArtifactInvocationResult =
  | { ok: true; payload: unknown }
  | { ok: false; error: { code: CodingRunErrorCode; message: string } };

export type CodingRunStdioOptions = {
  stateDir: string;
  conversationFrom?: "vscode" | "tui";
  input: AsyncIterable<string | Uint8Array>;
  writeStdout: (line: string) => void | Promise<void>;
  writeStderr: (line: string) => void | Promise<void>;
  invokeGatewayControl?: (control: RunControl, stateDir: string) => Promise<GatewayControlInvocationResult>;
  invokeGatewayConversation?: (
    conversation: CodingRunConversationRequest,
    stateDir: string,
  ) => Promise<GatewayConversationInvocationResult>;
  invokeGatewayArtifact?: (
    artifact: CodingRunArtifactRequest,
    stateDir: string,
  ) => Promise<GatewayArtifactInvocationResult>;
  invokeGatewaySubscription?: (input: {
    subscription: CodingRunSubscription;
    stateDir: string;
    onEvent: (event: AgentRunEvent) => void;
    onInterrupted: (error: { code: CodingRunSubscriptionErrorCode; message: string }) => void;
  }) => Promise<GatewaySubscriptionInvocationResult>;
};

/**
 * 进程级 stdio bridge：机器输出只写 NDJSON，实际领域控制仍由 Gateway 的配对保护路由执行。
 */
export async function runCodingRunStdio(input: CodingRunStdioOptions): Promise<number> {
  const invokeGatewayControl = input.invokeGatewayControl ?? invokeGatewayCodingRunControl;
  const invokeGatewayConversation = input.invokeGatewayConversation ?? ((conversation, stateDir) => (
    invokeGatewayCodingRunConversation(conversation, stateDir, input.conversationFrom ?? "vscode")
  ));
  const invokeGatewayArtifact = input.invokeGatewayArtifact ?? invokeGatewayCodingRunArtifact;
  const gatewaySubscriptionSession = new GatewayCodingRunSubscriptionSession(input.stateDir);
  const invokeGatewaySubscription = input.invokeGatewaySubscription ?? (async ({ subscription, onEvent, onInterrupted }) => {
    const result = await gatewaySubscriptionSession.subscribe({ subscription, onEvent, onInterrupted });
    return result.ok
      ? { ok: true as const, payload: result.payload }
      : { ok: false as const, error: result.error };
  });
  let server!: ReturnType<typeof createCodingRunNdjsonServer>;
  server = createCodingRunNdjsonServer({
    write: input.writeStdout,
    handleControl: async (control) => {
      const result = await invokeGatewayControl(control, input.stateDir);
      if (!result.ok) {
        throw new CodingRunControlError(result.error.code, result.error.message);
      }
      return result.payload;
    },
    handleConversation: async (conversation) => {
      const result = await invokeGatewayConversation(conversation, input.stateDir);
      if (!result.ok) {
        throw new CodingRunControlError(result.error.code, result.error.message);
      }
      return result.payload;
    },
    handleArtifact: async (artifact) => {
      const result = await invokeGatewayArtifact(artifact, input.stateDir);
      if (!result.ok) {
        throw new CodingRunControlError(result.error.code, result.error.message);
      }
      return result.payload;
    },
    handleSubscription: async (subscription) => {
      let active = false;
      const queuedEvents: AgentRunEvent[] = [];
      const queuedInterruptions: Array<{ code: CodingRunSubscriptionErrorCode; message: string }> = [];
      const emitEvent = (event: AgentRunEvent) => {
        if (!active) {
          queuedEvents.push(event);
          return;
        }
        void server.emitEvent(event);
      };
      const emitInterruption = (error: { code: CodingRunSubscriptionErrorCode; message: string }) => {
        if (!active) {
          queuedInterruptions.push(error);
          return;
        }
        void server.emitSubscriptionError({ ...error, binding: { ...subscription.binding } });
      };
      const result = await invokeGatewaySubscription({
        subscription,
        stateDir: input.stateDir,
        onEvent: emitEvent,
        onInterrupted: emitInterruption,
      });
      if (!result.ok) throw new CodingRunSubscriptionError(result.error.code, result.error.message);
      setImmediate(() => {
        active = true;
        for (const event of queuedEvents.splice(0)) void server.emitEvent(event);
        for (const error of queuedInterruptions.splice(0)) {
          void server.emitSubscriptionError({ ...error, binding: { ...subscription.binding } });
        }
      });
      return result.payload;
    },
  });

  try {
    for await (const chunk of input.input) {
      await server.consume(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
    }
    await server.flush();
    return CODING_RUN_EXIT_CODES.success;
  } catch (error) {
    await input.writeStderr(`${toSafeCodingRunErrorMessage(error)}\n`);
    return CODING_RUN_EXIT_CODES.executionFailed;
  } finally {
    gatewaySubscriptionSession.close();
  }
}

export async function invokeGatewayCodingRunControl(
  control: RunControl,
  stateDir: string,
): Promise<GatewayControlInvocationResult> {
  const response = await invokeGatewayMethod({
    stateDir,
    method: "coding.run.control",
    params: { control },
    requestIdPrefix: "bdd-coding-run-stdio",
    clientName: "bdd coding-run stdio",
    parsePayload: (payload) => payload,
  });
  if (response.ok) return { ok: true, payload: response.payload };
  return {
    ok: false,
    error: {
      code: resolveGatewayErrorCode(response.errorCode, response.error),
      message: toSafeCodingRunErrorMessage(response.error),
    },
  };
}

/**
 * 编辑器仅能传入提示词、绝对 cwd 与既有会话 ID；工具策略和权限模式由 bridge 固定为 confirm，
 * 不为本地 adapter 创建第二套 Conversation 或放宽 Gateway 的 message.send 边界。
 */
export async function invokeGatewayCodingRunConversation(
  conversation: CodingRunConversationRequest,
  stateDir: string,
  from: "vscode" | "tui" | "mcp",
): Promise<GatewayConversationInvocationResult> {
  const response = await invokeGatewayMethod({
    stateDir,
    method: "message.send",
    params: {
      ...(conversation.conversationId ? { conversationId: conversation.conversationId } : {}),
      text: conversation.text,
      from,
      autoStopPreviousRun: false,
      codingRun: {
        cwd: conversation.cwd,
        permissionMode: "confirm",
      },
    },
    requestIdPrefix: `bdd-coding-run-${from}-conversation`,
    clientName: from === "tui" ? "bdd tui" : from === "mcp" ? "bdd coding-run mcp" : "bdd coding-run stdio",
    parsePayload: (payload) => {
      const conversationId = typeof payload.conversationId === "string" ? payload.conversationId.trim() : "";
      const agentRunId = typeof payload.runId === "string" ? payload.runId.trim() : "";
      if (!conversationId || !agentRunId) {
        throw new Error("Gateway accepted message.send without a complete Conversation binding.");
      }
      return { binding: { conversationId, agentRunId } };
    },
  });
  if (response.ok) return { ok: true, payload: response.payload };
  return {
    ok: false,
    error: {
      code: resolveGatewayErrorCode(response.errorCode, response.error),
      message: toSafeCodingRunErrorMessage(response.error),
    },
  };
}

export async function invokeGatewayCodingRunArtifact(
  artifact: CodingRunArtifactRequest,
  stateDir: string,
): Promise<GatewayArtifactInvocationResult> {
  const response = await invokeGatewayMethod({
    stateDir,
    method: "workspace.revision.preview",
    params: artifact,
    requestIdPrefix: "bdd-coding-run-artifact",
    clientName: "bdd coding-run artifact",
    parsePayload: (payload) => payload,
  });
  if (response.ok) return { ok: true, payload: response.payload };
  return {
    ok: false,
    error: {
      code: resolveGatewayErrorCode(response.errorCode, response.error),
      message: toSafeCodingRunErrorMessage(response.error),
    },
  };
}

export function resolveGatewayErrorCode(errorCode: string | undefined, message: string): CodingRunErrorCode {
  if (isCodingRunErrorCode(errorCode)) return errorCode;
  if (/pairing|permission|denied/i.test(message)) return "permission_required";
  if (/timed out|websocket|connect|ECONN/i.test(message)) return "gateway_unavailable";
  return "internal";
}

function isCodingRunErrorCode(value: unknown): value is CodingRunErrorCode {
  return value === "invalid_request"
    || value === "not_found"
    || value === "run_mismatch"
    || value === "not_active"
    || value === "permission_required"
    || value === "permission_denied"
    || value === "policy_denied"
    || value === "budget_exhausted"
    || value === "cancelled"
    || value === "interrupted"
    || value === "output_schema_invalid"
    || value === "gateway_unavailable"
    || value === "internal";
}
