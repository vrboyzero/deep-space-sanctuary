import crypto from "node:crypto";
import type { IncomingMessage, Server } from "node:http";

import { extractIdentityInfo } from "@belldandy/agent";
import type {
  BelldandyRole,
  ConnectRequestFrame,
  GatewayAuth,
  GatewayEventFrame,
  GatewayFrame,
  GatewayReqFrame,
  GatewayResFrame,
} from "@belldandy/protocol";
import { WebSocketServer, type WebSocket } from "ws";

import { BELLDANDY_VERSION } from "./version.generated.js";
import { ensurePairingCode, isClientAllowed } from "./security/store.js";

type GatewayAuthConfig = {
  mode: "none" | "token" | "password";
  token?: string;
  password?: string;
};

type GatewayWebSocketLog = {
  debug: (module: string, message: string, data?: unknown) => void;
  info: (module: string, message: string, data?: unknown) => void;
  warn: (module: string, message: string, data?: unknown) => void;
  error: (module: string, message: string, data?: unknown) => void;
};

export type GatewayWebSocketConnectionContext = {
  clientId: string;
  userUuid?: string;
};

type CreateGatewayWebSocketRuntimeOptions = {
  server: Server;
  host: string;
  stateDir: string;
  auth: GatewayAuthConfig;
  log: GatewayWebSocketLog;
  onActivity?: () => void;
  isConfigured?: () => boolean;
  startupObservability?: {
    onFirstWebSocketConnection?: (input: { timestampMs: number; remoteAddress?: string | null }) => void;
    onFirstAuthenticatedWebSocket?: (input: { timestampMs: number; clientId: string }) => void;
    onInvalidTokenClose?: (input: { timestampMs: number; reason?: string | null; remoteAddress?: string | null }) => void;
  };
  onRequest: (
    ws: WebSocket,
    frame: GatewayReqFrame,
    connection: GatewayWebSocketConnectionContext,
  ) => Promise<GatewayResFrame | null>;
};

type GatewayWebSocketRuntime = {
  broadcast: (frame: GatewayEventFrame) => void;
  close: () => Promise<void>;
};

type ConnectionState = {
  connected: boolean;
  nonce: string;
  sessionId: string;
  role: BelldandyRole;
  challengeSentAt: number;
  clientId?: string;
  userUuid?: string;
};

const DEFAULT_METHODS = [
  "message.send",
  "conversation.run.stop",
  "artifact.reveal",
  "pairing.approve",
  "tool_settings.confirm",
  "external_outbound.confirm",
  "external_outbound.audit.list",
  "email_outbound.confirm",
  "email_outbound.audit.list",
  "email_followup.list",
  "models.list",
  "models.config.get",
  "models.config.update",
  "config.read",
  "config.update",
  "channel.reply_chunking.get",
  "channel.reply_chunking.update",
  "channel.security.get",
  "channel.security.update",
  "channel.security.pending.list",
  "channel.security.approve",
  "channel.security.reject",
  "system.doctor",
  "system.restart",
  "workspace.list",
  "workspace.read",
  "workspace.readSource",
  "workspace.write",
  "context.compact",
  "context.compact.partial",
  "conversation.meta",
  "conversation.restore",
  "conversation.transcript.export",
  "conversation.timeline.get",
  "conversation.prompt_snapshot.get",
  "conversation.digest.get",
  "conversation.digest.refresh",
  "conversation.memory.extract",
  "conversation.memory.extraction.get",
  "subtask.list",
  "subtask.get",
  "subtask.resume",
  "subtask.takeover",
  "subtask.update",
  "subtask.stop",
  "subtask.archive",
  "tools.list",
  "tools.update",
  "agent.catalog.get",
  "agent.contracts.get",
  "delegation.inspect.get",
  "agents.prompt.inspect",
  "agent.create",
  "agents.list",
  "agents.roster.get",
  "agent.session.ensure",
  "memory.search",
  "memory.get",
  "memory.recent",
  "memory.stats",
  "memory.share.queue",
  "memory.share.promote",
  "memory.share.claim",
  "memory.share.review",
  "memory.task.list",
  "memory.task.get",
  "memory.recent_work",
  "memory.resume_context",
  "memory.similar_past_work",
  "memory.explain_sources",
  "dream.run",
  "dream.status.get",
  "dream.history.list",
  "dream.get",
  "dream.commons.status.get",
  "dream.commons.export_now",
  "experience.candidate.check_duplicate",
  "experience.candidate.generate",
  "experience.candidate.get",
  "experience.candidate.list",
  "experience.candidate.accept",
  "experience.candidate.reject",
  "experience.candidate.reject_bulk",
  "experience.candidate.cleanup_consumed",
  "experience.usage.get",
  "experience.usage.list",
  "experience.usage.stats",
  "experience.usage.revoke",
  "experience.skill.freshness.update",
  "goal.create",
  "goal.list",
  "goal.get",
  "goal.resume",
  "goal.pause",
  "goal.handoff.get",
  "goal.handoff.generate",
  "goal.retrospect.generate",
  "goal.experience.suggest",
  "goal.method_candidates.generate",
  "goal.skill_candidates.generate",
  "goal.flow_patterns.generate",
  "goal.flow_patterns.cross_goal",
  "goal.review_governance.summary",
  "goal.approval.scan",
  "goal.suggestion_review.list",
  "goal.suggestion_review.workflow.set",
  "goal.suggestion_review.decide",
  "goal.suggestion_review.escalate",
  "goal.suggestion_review.scan",
  "goal.suggestion.publish",
  "goal.checkpoint.list",
  "goal.checkpoint.request",
  "goal.checkpoint.approve",
  "goal.checkpoint.reject",
  "goal.checkpoint.expire",
  "goal.checkpoint.reopen",
  "goal.checkpoint.escalate",
  "cron.run_now",
  "cron.recovery.run",
  "goal.task_graph.read",
  "goal.task_graph.create",
  "goal.task_graph.update",
  "goal.task_graph.claim",
  "goal.task_graph.pending_review",
  "goal.task_graph.validating",
  "goal.task_graph.complete",
  "goal.task_graph.block",
  "goal.task_graph.fail",
  "goal.task_graph.skip",
];

const DEFAULT_EVENTS = [
  "chat.delta",
  "chat.final",
  "conversation.run.stopped",
  "agent.status",
  "token.usage",
  "token.counter.result",
  "channel.security.pending",
  "conversation.digest.updated",
  "conversation.memory.extraction.updated",
  "goal.update",
  "subtask.update",
  "pairing.required",
  "tools.config.updated",
  "tool_settings.confirm.required",
  "tool_settings.confirm.resolved",
  "external_outbound.confirm.required",
  "external_outbound.confirm.resolved",
  "email_outbound.confirm.required",
  "email_outbound.confirm.resolved",
  "tool_event",
];

export function createGatewayWebSocketRuntime(
  options: CreateGatewayWebSocketRuntimeOptions,
): GatewayWebSocketRuntime {
  let firstConnectionObserved = false;
  let firstAuthenticatedObserved = false;
  const wss = new WebSocketServer({
    server: options.server,
    verifyClient: (info: { origin?: string; req: IncomingMessage; secure: boolean }) => {
      return verifyWebSocketOrigin(info.origin, options.host, options.log);
    },
  });

  wss.on("connection", (ws, req) => {
    const ip = req.socket.remoteAddress;
    options.log.info("ws", `New connection from ${ip}`);
    if (!firstConnectionObserved) {
      firstConnectionObserved = true;
      options.startupObservability?.onFirstWebSocketConnection?.({
        timestampMs: Date.now(),
        remoteAddress: ip,
      });
    }

    ws.on("error", (err) => {
      options.log.error("ws", `Error (${ip}): ${err.message}`);
    });

    ws.on("close", (code, reason) => {
      options.log.info("ws", `Closed (${ip}): ${code} ${reason}`);
    });

    const state: ConnectionState = {
      connected: false,
      nonce: crypto.randomUUID(),
      sessionId: crypto.randomUUID(),
      role: "web",
      challengeSentAt: Date.now(),
    };

    sendGatewayFrame(ws, { type: "connect.challenge", nonce: state.nonce });

    const challengeTimer = setTimeout(() => {
      if (!state.connected) {
        safeClose(ws, 4401, "connect timeout");
      }
    }, 10_000);

    ws.on("message", async (data) => {
      options.onActivity?.();

      const raw = typeof data === "string" ? data : data.toString("utf-8");
      const frame = safeParseFrame(raw);
      if (!frame) {
        safeClose(ws, 4400, "invalid frame");
        return;
      }

      if (!state.connected) {
        if (frame.type !== "connect") {
          sendGatewayResponse(ws, {
            type: "res",
            id: crypto.randomUUID(),
            ok: false,
            error: { code: "not_connected", message: "Handshake required." },
          });
          return;
        }
        const accepted = acceptConnect(frame, options.auth);
        if (!accepted.ok) {
          if (accepted.message === "invalid token") {
            options.startupObservability?.onInvalidTokenClose?.({
              timestampMs: Date.now(),
              reason: accepted.message,
              remoteAddress: ip,
            });
          }
          safeClose(ws, 4403, accepted.message);
          return;
        }
        clearTimeout(challengeTimer);
        state.connected = true;
        state.role = accepted.role;
        state.clientId = normalizeClientId(frame.clientId) ?? state.sessionId;
        state.userUuid = frame.userUuid;
        if (!firstAuthenticatedObserved) {
          firstAuthenticatedObserved = true;
          options.startupObservability?.onFirstAuthenticatedWebSocket?.({
            timestampMs: Date.now(),
            clientId: state.clientId,
          });
        }
        options.log.debug("ws", "WebSocket connected", {
          clientId: state.clientId,
          hasUserUuid: Boolean(state.userUuid),
        });

        const identityInfo = await extractIdentityInfo(options.stateDir);
        sendGatewayFrame(ws, {
          type: "hello-ok",
          sessionId: state.sessionId,
          role: state.role,
          methods: DEFAULT_METHODS,
          events: DEFAULT_EVENTS,
          version: BELLDANDY_VERSION,
          agentName: identityInfo.agentName,
          agentAvatar: identityInfo.agentAvatar,
          userName: identityInfo.userName,
          userAvatar: identityInfo.userAvatar,
          supportsUuid: true,
          configOk: options.isConfigured ? options.isConfigured() : true,
        });
        if (ws.readyState !== 1) {
          return;
        }
        const allowed = await isClientAllowed({
          clientId: state.clientId ?? state.sessionId,
          stateDir: options.stateDir,
        });
        if (!allowed) {
          if (ws.readyState !== 1) {
            return;
          }
          const pairing = await ensurePairingCode({
            clientId: state.clientId ?? state.sessionId,
            stateDir: options.stateDir,
          });
          sendGatewayFrame(ws, {
            type: "event",
            event: "pairing.required",
            payload: {
              clientId: state.clientId ?? state.sessionId,
              code: pairing.code,
              message: "pairing required: approve this code to allow messages",
            },
          });
        }
        return;
      }

      if (frame.type !== "req") {
        return;
      }

      try {
        const response = await options.onRequest(ws, frame, {
          clientId: state.clientId ?? state.sessionId,
          userUuid: state.userUuid,
        });
        if (response) {
          sendGatewayResponse(ws, response);
        }
      } catch (error) {
        options.log.error("ws", "Request handler threw an uncaught error", {
          clientId: state.clientId ?? state.sessionId,
          method: frame.method,
          requestId: frame.id,
          error: summarizeWebSocketRuntimeError(error),
        });
        sendGatewayResponse(ws, {
          type: "res",
          id: frame.id,
          ok: false,
          error: {
            code: "internal_error",
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    });

    ws.on("close", () => {
      clearTimeout(challengeTimer);
    });
  });

  return {
    broadcast: (frame) => {
      for (const client of wss.clients) {
        if (client.readyState === 1) {
          client.send(JSON.stringify(frame));
        }
      }
    },
    close: async () => {
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}

export function sendGatewayResponse(ws: WebSocket, frame: GatewayResFrame) {
  sendGatewayFrame(ws, frame);
}

export function sendGatewayEvent(ws: WebSocket, frame: GatewayEventFrame) {
  sendGatewayFrame(ws, frame);
}

function sendGatewayFrame(ws: WebSocket, frame: GatewayFrame) {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify(frame));
}

function summarizeWebSocketRuntimeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ? String(error.stack).slice(0, 1600) : undefined,
    };
  }
  return {
    message: String(error),
  };
}

function verifyWebSocketOrigin(origin: string | undefined, host: string, log: GatewayWebSocketLog): boolean {
  const rawOrigin = origin || "";
  const isLocalBinding = host === "127.0.0.1" || host === "localhost";
  const allowedOriginsRaw = process.env.BELLDANDY_ALLOWED_ORIGINS;
  const allowedOriginsSource = allowedOriginsRaw
    ? allowedOriginsRaw.split(",").map((item) => item.trim()).filter(Boolean)
    : [];
  const allowedOrigins = allowedOriginsSource
    .map((item) => normalizeOrigin(item))
    .filter((item): item is string => Boolean(item));

  if (allowedOrigins.length === 0 && isLocalBinding) {
    if (!rawOrigin) {
      return true;
    }
    const allowed = isLocalLoopbackOrigin(rawOrigin);
    if (!allowed) {
      log.info("ws", `Rejected origin: ${rawOrigin}`);
    }
    return allowed;
  }
  if (allowedOrigins.length === 0) {
    log.error("ws", `Rejected connection: no allowed origins configured for ${host}`);
    return false;
  }
  const normalizedOrigin = normalizeOrigin(rawOrigin);
  if (!normalizedOrigin) {
    log.info("ws", `Rejected origin: ${rawOrigin}`);
    return false;
  }
  const allowed = allowedOrigins.includes(normalizedOrigin);
  if (!allowed) {
    log.info("ws", `Rejected origin: ${rawOrigin}`);
  }
  return allowed;
}

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return null;
  }
}

function isLocalLoopbackOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return url.hostname === "127.0.0.1" || url.hostname === "localhost";
  } catch {
    return false;
  }
}

function acceptConnect(
  frame: ConnectRequestFrame,
  authCfg: GatewayAuthConfig,
): { ok: true; role: BelldandyRole } | { ok: false; message: string } {
  const auth = frame.auth ?? { mode: "none" };
  const role = frame.role ?? "web";
  if (!isRole(role)) return { ok: false, message: "invalid role" };

  if (authCfg.mode === "none") return { ok: true, role };

  if (authCfg.mode === "token") {
    if (!authCfg.token) return { ok: false, message: "server auth misconfigured" };
    if (auth.mode !== "token") return { ok: false, message: "token required" };
    if (auth.token !== authCfg.token) return { ok: false, message: "invalid token" };
    return { ok: true, role };
  }

  if (authCfg.mode === "password") {
    if (!authCfg.password) return { ok: false, message: "server auth misconfigured" };
    if (auth.mode !== "password") return { ok: false, message: "password required" };
    if (auth.password !== authCfg.password) return { ok: false, message: "invalid password" };
    return { ok: true, role };
  }

  return { ok: false, message: "invalid auth mode" };
}

function safeParseFrame(raw: string): GatewayFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const type = obj.type;
  if (type === "connect") {
    const role = typeof obj.role === "string" ? obj.role : "web";
    const auth = parseAuth(obj.auth);
    const clientId = typeof obj.clientId === "string" ? obj.clientId : undefined;
    const userUuid = typeof obj.userUuid === "string" && obj.userUuid.trim() ? obj.userUuid.trim() : undefined;
    return {
      type: "connect",
      role: isRole(role) ? role : "web",
      clientId,
      auth,
      clientName: typeof obj.clientName === "string" ? obj.clientName : undefined,
      clientVersion: typeof obj.clientVersion === "string" ? obj.clientVersion : undefined,
      userUuid,
    };
  }
  if (type === "req") {
    const id = typeof obj.id === "string" ? obj.id : "";
    const method = typeof obj.method === "string" ? obj.method : "";
    if (!id || !method) return null;
    return { type: "req", id, method, params: (obj.params ?? undefined) as any };
  }
  return null;
}

function parseAuth(value: unknown): GatewayAuth {
  if (!value || typeof value !== "object") return { mode: "none" };
  const obj = value as Record<string, unknown>;
  const mode = obj.mode;
  if (mode === "token") {
    const token = typeof obj.token === "string" ? obj.token : "";
    return { mode: "token", token };
  }
  if (mode === "password") {
    const password = typeof obj.password === "string" ? obj.password : "";
    return { mode: "password", password };
  }
  return { mode: "none" };
}

function isRole(value: string): value is BelldandyRole {
  return value === "web" || value === "cli" || value === "node";
}

function normalizeClientId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 200) return null;
  return trimmed;
}

function safeClose(ws: WebSocket, code: number, reason: string) {
  try {
    ws.close(code, reason);
  } catch {
    // ignore
  }
}
