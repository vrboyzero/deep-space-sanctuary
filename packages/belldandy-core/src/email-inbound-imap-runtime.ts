import net from "node:net";
import tls from "node:tls";

import type { AgentRegistry, BelldandyAgent, ConversationStore } from "@belldandy/agent";
import type { GatewayEventFrame } from "@belldandy/protocol";

import type { EmailInboundAuditStore } from "./email-inbound-audit-store.js";
import type { EmailInboundCheckpointStore } from "./email-inbound-checkpoint-store.js";
import { ImapPollingEmailInboundProvider } from "./email-inbound-imap-provider.js";
import { parseRawEmailMessage } from "./email-inbound-mime.js";
import {
  processDueEmailFollowUpReminders,
  scheduleEmailFollowUpReminder,
} from "./email-follow-up-reminder-runtime.js";
import type { EmailFollowUpReminderStore } from "./email-follow-up-reminder-store.js";
import { buildEmailInboundTriage } from "./email-inbound-triage.js";
import type { EmailThreadBindingStore } from "./email-thread-binding-store.js";
import { ingestEmailInboundEvent } from "./email-inbound-ingress.js";

type QueryRuntimeLogger = {
  info: (module: string, message: string, data?: unknown) => void;
  warn: (module: string, message: string, data?: unknown) => void;
  error: (module: string, message: string, data?: unknown) => void;
};

export type ImapPollingEmailInboundRuntimeHandle = {
  stop(): Promise<void>;
  pollNow(): Promise<void>;
};

export type EmailInboundImapBootstrapMode = "latest" | "all";

export type ImapPollingEmailInboundRuntimeOptions = {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  accountId: string;
  mailbox?: string;
  pollIntervalMs?: number;
  requestedAgentId?: string;
  connectTimeoutMs?: number;
  socketTimeoutMs?: number;
  bootstrapMode?: EmailInboundImapBootstrapMode;
  recentWindowLimit?: number;
  agentFactory?: () => BelldandyAgent;
  agentRegistry?: AgentRegistry;
  conversationStore: ConversationStore;
  threadBindingStore: EmailThreadBindingStore;
  checkpointStore: EmailInboundCheckpointStore;
  auditStore?: EmailInboundAuditStore;
  reminderStore?: EmailFollowUpReminderStore;
  broadcastEvent?: (frame: GatewayEventFrame) => void;
  logger: QueryRuntimeLogger;
};

type ImapFetchedMessage = {
  uid: number;
  internalDate?: string;
  flags: string[];
  rawMessage: Buffer;
};

const DEFAULT_MAILBOX = "INBOX";
const DEFAULT_POLL_INTERVAL_MS = 60_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_SOCKET_TIMEOUT_MS = 20_000;
const MAX_FAILURE_RETRY_ATTEMPTS = 3;

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizeBootstrapMode(value: unknown): EmailInboundImapBootstrapMode {
  return String(value ?? "").trim().toLowerCase() === "all" ? "all" : "latest";
}

function serializeRuntimeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const maybeCode = typeof (error as Error & { code?: unknown }).code === "string"
      ? (error as Error & { code?: string }).code
      : undefined;
    return {
      name: error.name,
      message: error.message,
      ...(maybeCode ? { code: maybeCode } : {}),
      ...(typeof error.stack === "string" && error.stack.trim() ? { stack: error.stack } : {}),
    };
  }
  if (error && typeof error === "object" && !Array.isArray(error)) {
    return error as Record<string, unknown>;
  }
  return {
    message: String(error),
  };
}

function summarizeAddresses(items: Array<{ address: string; name?: string }>): string[] {
  return (Array.isArray(items) ? items : [])
    .map((item) => normalizeString(item?.address))
    .filter(Boolean);
}

function summarizePreview(input: {
  snippet?: string;
  textBody?: string;
  htmlBody?: string;
}): string {
  const snippet = normalizeString(input.snippet);
  if (snippet) return snippet;
  const textBody = normalizeString(input.textBody);
  if (textBody) return textBody;
  return normalizeString(input.htmlBody).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function toEmailInboundAuditTriage(input: ReturnType<typeof buildEmailInboundTriage>) {
  return {
    triageCategory: input.category,
    triagePriority: input.priority,
    triageDisposition: input.disposition,
    triageSummary: input.summary,
    triageRationale: input.rationale,
    triageNeedsReply: input.needsReply,
    triageNeedsFollowUp: input.needsFollowUp,
    ...(typeof input.followUpWindowHours === "number" ? { triageFollowUpWindowHours: input.followUpWindowHours } : {}),
    ...(input.suggestedReplyStarter ? { suggestedReplyStarter: input.suggestedReplyStarter } : {}),
    ...(input.suggestedReplySubject ? { suggestedReplySubject: input.suggestedReplySubject } : {}),
    ...(input.suggestedReplyDraft ? { suggestedReplyDraft: input.suggestedReplyDraft } : {}),
    ...(input.suggestedReplyQuality ? { suggestedReplyQuality: input.suggestedReplyQuality } : {}),
    ...(input.suggestedReplyConfidence ? { suggestedReplyConfidence: input.suggestedReplyConfidence } : {}),
    ...(input.suggestedReplyWarnings.length > 0 ? { suggestedReplyWarnings: input.suggestedReplyWarnings } : {}),
    ...(input.suggestedReplyChecklist.length > 0 ? { suggestedReplyChecklist: input.suggestedReplyChecklist } : {}),
  };
}

function quotedPrintableDecode(input: string): string {
  const normalized = input.replace(/=\r?\n/g, "");
  return normalized.replace(/=([0-9A-Fa-f]{2})/g, (_match, hex: string) => {
    return String.fromCharCode(parseInt(hex, 16));
  });
}

function decodeContentTransfer(body: string, encoding: string): string {
  const normalizedEncoding = normalizeString(encoding).toLowerCase();
  if (normalizedEncoding === "base64") {
    try {
      return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf-8");
    } catch {
      return body;
    }
  }
  if (normalizedEncoding === "quoted-printable") {
    return quotedPrintableDecode(body);
  }
  return body;
}

function splitHeadersAndBody(raw: string): { headersRaw: string; bodyRaw: string } {
  const separatorIndex = raw.indexOf("\r\n\r\n");
  if (separatorIndex >= 0) {
    return {
      headersRaw: raw.slice(0, separatorIndex),
      bodyRaw: raw.slice(separatorIndex + 4),
    };
  }
  const lfIndex = raw.indexOf("\n\n");
  if (lfIndex >= 0) {
    return {
      headersRaw: raw.slice(0, lfIndex),
      bodyRaw: raw.slice(lfIndex + 2),
    };
  }
  return {
    headersRaw: raw,
    bodyRaw: "",
  };
}

function parseHeaders(rawHeaders: string): Record<string, string> {
  const unfolded = rawHeaders.replace(/\r?\n[ \t]+/g, " ");
  const headers: Record<string, string> = {};
  for (const line of unfolded.split(/\r?\n/)) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();
    if (!key || !value) continue;
    headers[key] = value;
  }
  return headers;
}

function parseAddressList(value: string | undefined): Array<{ address: string; name?: string }> {
  const input = normalizeString(value);
  if (!input) return [];
  const results: Array<{ address: string; name?: string }> = [];
  const parts = input.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  for (const part of parts) {
    const normalized = part.trim();
    if (!normalized) continue;
    const angleMatch = normalized.match(/^(.*?)(?:<([^<>]+)>)$/);
    if (angleMatch) {
      const name = normalizeString(angleMatch[1]).replace(/^"|"$/g, "");
      const address = normalizeString(angleMatch[2]);
      if (address) {
        results.push(name ? { address, name } : { address });
      }
      continue;
    }
    const address = normalizeString(normalized.replace(/^"|"$/g, ""));
    if (address) {
      results.push({ address });
    }
  }
  return results;
}

function parseMultipartBoundary(contentType: string): string | undefined {
  const match = contentType.match(/boundary="?([^";]+)"?/i);
  return match?.[1]?.trim();
}

function parsePart(input: string): {
  headers: Record<string, string>;
  body: string;
} {
  const { headersRaw, bodyRaw } = splitHeadersAndBody(input);
  return {
    headers: parseHeaders(headersRaw),
    body: bodyRaw,
  };
}

function collectBodyParts(
  headers: Record<string, string>,
  bodyRaw: string,
): {
  textBody?: string;
  htmlBody?: string;
  attachments: Array<{ filename?: string; contentType?: string; sizeBytes?: number; inline?: boolean; contentId?: string }>;
} {
  const contentType = normalizeString(headers["content-type"]).toLowerCase();
  const transferEncoding = normalizeString(headers["content-transfer-encoding"]);
  if (!contentType.startsWith("multipart/")) {
    const decoded = decodeContentTransfer(bodyRaw, transferEncoding);
    if (contentType.includes("text/html")) {
      return { htmlBody: decoded, attachments: [] };
    }
    return { textBody: decoded, attachments: [] };
  }

  const boundary = parseMultipartBoundary(contentType);
  if (!boundary) {
    return { textBody: decodeContentTransfer(bodyRaw, transferEncoding), attachments: [] };
  }

  const textParts: string[] = [];
  const htmlParts: string[] = [];
  const attachments: Array<{ filename?: string; contentType?: string; sizeBytes?: number; inline?: boolean; contentId?: string }> = [];
  const marker = `--${boundary}`;
  const chunks = bodyRaw.split(marker);
  for (const chunk of chunks) {
    const normalizedChunk = chunk.trim();
    if (!normalizedChunk || normalizedChunk === "--") continue;
    const trimmed = normalizedChunk.endsWith("--")
      ? normalizedChunk.slice(0, -2).trim()
      : normalizedChunk;
    const part = parsePart(trimmed);
    const partType = normalizeString(part.headers["content-type"]).toLowerCase();
    const disposition = normalizeString(part.headers["content-disposition"]).toLowerCase();
    if (partType.startsWith("multipart/")) {
      const nested = collectBodyParts(part.headers, part.body);
      if (nested.textBody) textParts.push(nested.textBody);
      if (nested.htmlBody) htmlParts.push(nested.htmlBody);
      attachments.push(...nested.attachments);
      continue;
    }

    const decoded = decodeContentTransfer(part.body, part.headers["content-transfer-encoding"] || "");
    const filename = normalizeString(part.headers["content-disposition"]?.match(/filename="?([^";]+)"?/i)?.[1])
      || normalizeString(part.headers["content-type"]?.match(/name="?([^";]+)"?/i)?.[1]);
    const contentId = normalizeString(part.headers["content-id"])?.replace(/^<|>$/g, "");
    const isAttachment = disposition.includes("attachment") || Boolean(filename);
    if (isAttachment) {
      attachments.push({
        ...(filename ? { filename } : {}),
        ...(partType ? { contentType: partType.split(";")[0] } : {}),
        ...(contentId ? { contentId } : {}),
        ...(disposition.includes("inline") ? { inline: true } : {}),
        ...(decoded ? { sizeBytes: Buffer.byteLength(decoded, "utf-8") } : {}),
      });
      continue;
    }
    if (partType.includes("text/html")) {
      htmlParts.push(decoded);
      continue;
    }
    textParts.push(decoded);
  }

  return {
    ...(textParts.length > 0 ? { textBody: textParts.join("\n\n") } : {}),
    ...(htmlParts.length > 0 ? { htmlBody: htmlParts.join("\n\n") } : {}),
    attachments,
  };
}

function parseRawEmail(rawMessage: string): {
  messageId?: string;
  threadId?: string;
  subject?: string;
  from: Array<{ address: string; name?: string }>;
  to: Array<{ address: string; name?: string }>;
  cc: Array<{ address: string; name?: string }>;
  bcc: Array<{ address: string; name?: string }>;
  replyTo: Array<{ address: string; name?: string }>;
  inReplyToMessageId?: string;
  references: string[];
  textBody?: string;
  htmlBody?: string;
  attachments: Array<{ filename?: string; contentType?: string; sizeBytes?: number; inline?: boolean; contentId?: string }>;
  snippet?: string;
  headers: Record<string, string>;
} {
  const { headersRaw, bodyRaw } = splitHeadersAndBody(rawMessage);
  const headers = parseHeaders(headersRaw);
  const bodyParts = collectBodyParts(headers, bodyRaw);
  const textBody = normalizeString(bodyParts.textBody);
  const htmlBody = normalizeString(bodyParts.htmlBody);
  const snippetSource = textBody || htmlBody.replace(/<[^>]+>/g, " ");
  const referencesHeader = normalizeString(headers.references);
  const references = referencesHeader
    ? referencesHeader.split(/\s+/).map((item) => item.trim()).filter(Boolean)
    : [];
  return {
    ...(normalizeString(headers["message-id"]) ? { messageId: normalizeString(headers["message-id"]) } : {}),
    ...(normalizeString(headers.subject) ? { subject: normalizeString(headers.subject) } : {}),
    from: parseAddressList(headers.from),
    to: parseAddressList(headers.to),
    cc: parseAddressList(headers.cc),
    bcc: parseAddressList(headers.bcc),
    replyTo: parseAddressList(headers["reply-to"]),
    ...(normalizeString(headers["in-reply-to"]) ? { inReplyToMessageId: normalizeString(headers["in-reply-to"]) } : {}),
    references,
    ...(textBody ? { textBody } : {}),
    ...(htmlBody ? { htmlBody } : {}),
    attachments: bodyParts.attachments,
    ...(snippetSource ? { snippet: snippetSource.replace(/\s+/g, " ").trim().slice(0, 320) } : {}),
    headers,
  };
}

function parseSearchUids(response: Buffer): number[] {
  const text = response.toString("utf-8");
  const match = text.match(/\* SEARCH(.*)\r?\n/i);
  if (!match) return [];
  return match[1]
    .trim()
    .split(/\s+/)
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0)
    .map((item) => Math.floor(item));
}

function parseUidNext(response: Buffer): number {
  const text = response.toString("utf-8");
  const match = text.match(/\bUIDNEXT (\d+)/i);
  if (!match) return 0;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function parseFetchedMessage(response: Buffer): ImapFetchedMessage {
  const text = response.toString("utf-8");
  const uidMatch = text.match(/\bUID (\d+)/i);
  const flagsMatch = text.match(/\bFLAGS \(([^)]*)\)/i);
  const dateMatch = text.match(/\bINTERNALDATE "([^"]+)"/i);
  const marker = Buffer.from("BODY[] {", "utf-8");
  const markerIndex = response.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error("IMAP FETCH response missing BODY[] literal");
  }
  const literalStart = markerIndex + marker.length;
  const literalEnd = response.indexOf(Buffer.from("}\r\n", "utf-8"), literalStart);
  if (literalEnd < 0) {
    throw new Error("IMAP FETCH response missing BODY[] literal terminator");
  }
  const literalLength = Number(response.slice(literalStart, literalEnd).toString("utf-8"));
  const rawStart = literalEnd + 3;
  const rawEnd = rawStart + literalLength;
  const rawMessage = response.slice(rawStart, rawEnd);
  return {
    uid: uidMatch ? Math.floor(Number(uidMatch[1])) : 0,
    ...(dateMatch ? { internalDate: dateMatch[1] } : {}),
    flags: flagsMatch
      ? flagsMatch[1].split(/\s+/).map((item) => item.trim()).filter(Boolean)
      : [],
    rawMessage,
  };
}

class SimpleImapClient {
  private socket?: net.Socket | tls.TLSSocket;
  private buffer = Buffer.alloc(0);
  private tagCounter = 0;

  constructor(
    private readonly options: {
      host: string;
      port: number;
      secure: boolean;
      connectTimeoutMs: number;
      socketTimeoutMs: number;
    },
  ) {}

  async connect(): Promise<void> {
    if (this.socket) return;
    this.socket = await new Promise<net.Socket | tls.TLSSocket>((resolve, reject) => {
      let connectSettled = false;
      let connectTimer: NodeJS.Timeout | undefined;
      const settleConnect = (fn: () => void) => {
        if (connectSettled) return;
        connectSettled = true;
        if (connectTimer) {
          clearTimeout(connectTimer);
          connectTimer = undefined;
        }
        fn();
      };
      const connectOptions = {
        host: this.options.host,
        port: this.options.port,
      };
      const socket = this.options.secure
        ? tls.connect(connectOptions)
        : net.connect(connectOptions);
      connectTimer = setTimeout(() => {
        settleConnect(() => {
          socket.destroy(new Error("IMAP connect timeout"));
          reject(new Error("IMAP connect timeout"));
        });
      }, this.options.connectTimeoutMs);
      const onInitialError = (error: Error) => {
        settleConnect(() => reject(error));
      };
      socket.once("error", onInitialError);
      const onConnect = () => {
        settleConnect(() => {
          socket.off("error", onInitialError);
          resolve(socket);
        });
      };
      socket.on("data", (chunk) => {
        this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
      });
      if (this.options.secure) {
        socket.once("secureConnect", onConnect);
      } else {
        socket.once("connect", onConnect);
      }
    });
    try {
      await this.readUntil((buffer) => {
        const greetingEnd = buffer.indexOf(Buffer.from("\r\n", "utf-8"));
        return greetingEnd >= 0 ? greetingEnd + 2 : -1;
      }, this.options.connectTimeoutMs);
    } catch (error) {
      this.socket?.destroy();
      this.socket = undefined;
      this.buffer = Buffer.alloc(0);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (!this.socket) return;
    try {
      await this.sendCommand("LOGOUT");
    } catch {
      // ignore logout noise
    }
    await new Promise<void>((resolve) => {
      if (!this.socket) {
        resolve();
        return;
      }
      this.socket.once("close", () => resolve());
      this.socket.end();
    });
    this.socket = undefined;
    this.buffer = Buffer.alloc(0);
  }

  async sendCommand(command: string): Promise<Buffer> {
    if (!this.socket) {
      throw new Error("IMAP client is not connected");
    }
    this.tagCounter += 1;
    const tag = `A${String(this.tagCounter).padStart(4, "0")}`;
    this.socket.write(`${tag} ${command}\r\n`);
    return this.readUntil((buffer) => {
      const taggedOk = Buffer.from(`\r\n${tag} OK`, "utf-8");
      const taggedNo = Buffer.from(`\r\n${tag} NO`, "utf-8");
      const taggedBad = Buffer.from(`\r\n${tag} BAD`, "utf-8");
      let index = buffer.indexOf(taggedOk);
      if (index < 0) index = buffer.indexOf(taggedNo);
      if (index < 0) index = buffer.indexOf(taggedBad);
      if (index < 0 && buffer.indexOf(Buffer.from(`${tag} OK`, "utf-8")) === 0) {
        index = 0;
      }
      if (index < 0 && buffer.indexOf(Buffer.from(`${tag} NO`, "utf-8")) === 0) {
        index = 0;
      }
      if (index < 0 && buffer.indexOf(Buffer.from(`${tag} BAD`, "utf-8")) === 0) {
        index = 0;
      }
      if (index < 0) return -1;
      const lineEnd = buffer.indexOf(Buffer.from("\r\n", "utf-8"), index + 1);
      return lineEnd >= 0 ? lineEnd + 2 : -1;
    }, this.options.socketTimeoutMs);
  }

  private async readUntil(
    resolver: (buffer: Buffer) => number,
    timeoutMs: number,
  ): Promise<Buffer> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const endIndex = resolver(this.buffer);
      if (endIndex >= 0) {
        const chunk = this.buffer.slice(0, endIndex);
        this.buffer = this.buffer.slice(endIndex);
        return chunk;
      }
      await new Promise<void>((resolve, reject) => {
        if (!this.socket) {
          reject(new Error("IMAP socket is closed"));
          return;
        }
        const remaining = Math.max(1, timeoutMs - (Date.now() - startedAt));
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error("IMAP read timeout"));
        }, remaining);
        const onData = () => {
          cleanup();
          resolve();
        };
        const onClose = () => {
          cleanup();
          reject(new Error("IMAP socket closed"));
        };
        const onError = (error: Error) => {
          cleanup();
          reject(error);
        };
        const cleanup = () => {
          clearTimeout(timer);
          this.socket?.off("data", onData);
          this.socket?.off("close", onClose);
          this.socket?.off("error", onError);
        };
        this.socket.on("data", onData);
        this.socket.once("close", onClose);
        this.socket.once("error", onError);
      });
    }
    throw new Error("IMAP read timeout");
  }
}

async function fetchImapMessages(input: {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  mailbox: string;
  sinceUid: number;
  connectTimeoutMs: number;
  socketTimeoutMs: number;
}): Promise<ImapFetchedMessage[]> {
  const client = new SimpleImapClient({
    host: input.host,
    port: input.port,
    secure: input.secure,
    connectTimeoutMs: input.connectTimeoutMs,
    socketTimeoutMs: input.socketTimeoutMs,
  });
  await client.connect();
  try {
    await client.sendCommand(`LOGIN "${input.username.replace(/"/g, '\\"')}" "${input.password.replace(/"/g, '\\"')}"`);
    await client.sendCommand(`SELECT "${input.mailbox.replace(/"/g, '\\"')}"`);
    const searchResponse = await client.sendCommand(`UID SEARCH UID ${Math.max(1, input.sinceUid + 1)}:*`);
    const uids = parseSearchUids(searchResponse);
    const messages: ImapFetchedMessage[] = [];
    for (const uid of uids) {
      const fetchResponse = await client.sendCommand(`UID FETCH ${uid} (UID FLAGS INTERNALDATE BODY.PEEK[])`);
      messages.push(parseFetchedMessage(fetchResponse));
    }
    return messages;
  } finally {
    await client.close();
  }
}

async function fetchLatestKnownUid(input: {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  mailbox: string;
  connectTimeoutMs: number;
  socketTimeoutMs: number;
}): Promise<number> {
  const client = new SimpleImapClient({
    host: input.host,
    port: input.port,
    secure: input.secure,
    connectTimeoutMs: input.connectTimeoutMs,
    socketTimeoutMs: input.socketTimeoutMs,
  });
  await client.connect();
  try {
    await client.sendCommand(`LOGIN "${input.username.replace(/"/g, '\\"')}" "${input.password.replace(/"/g, '\\"')}"`);
    const statusResponse = await client.sendCommand(`STATUS "${input.mailbox.replace(/"/g, '\\"')}" (UIDNEXT)`);
    const uidNext = parseUidNext(statusResponse);
    return Math.max(0, uidNext - 1);
  } finally {
    await client.close();
  }
}

async function fetchImapMessagesByUidList(input: {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  mailbox: string;
  uids: number[];
  connectTimeoutMs: number;
  socketTimeoutMs: number;
}): Promise<ImapFetchedMessage[]> {
  const safeUids = [...new Set((Array.isArray(input.uids) ? input.uids : [])
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0)
    .map((item) => Math.floor(item)))].sort((left, right) => left - right);
  if (safeUids.length === 0) {
    return [];
  }
  const client = new SimpleImapClient({
    host: input.host,
    port: input.port,
    secure: input.secure,
    connectTimeoutMs: input.connectTimeoutMs,
    socketTimeoutMs: input.socketTimeoutMs,
  });
  await client.connect();
  try {
    await client.sendCommand(`LOGIN "${input.username.replace(/"/g, '\\"')}" "${input.password.replace(/"/g, '\\"')}"`);
    await client.sendCommand(`SELECT "${input.mailbox.replace(/"/g, '\\"')}"`);
    const messages: ImapFetchedMessage[] = [];
    for (const uid of safeUids) {
      const fetchResponse = await client.sendCommand(`UID FETCH ${uid} (UID FLAGS INTERNALDATE BODY.PEEK[])`);
      messages.push(parseFetchedMessage(fetchResponse));
    }
    return messages;
  } finally {
    await client.close();
  }
}

export async function startImapPollingEmailInboundRuntime(
  options: ImapPollingEmailInboundRuntimeOptions,
): Promise<ImapPollingEmailInboundRuntimeHandle | undefined> {
  if (!options.enabled) {
    return undefined;
  }

  const host = normalizeString(options.host);
  const username = normalizeString(options.username);
  const password = normalizeString(options.password);
  const accountId = normalizeString(options.accountId) || "default";
  const mailbox = normalizeString(options.mailbox) || DEFAULT_MAILBOX;
  if (!host || !username || !password) {
    options.logger.warn("email-inbound", "IMAP inbound runtime enabled but host/username/password is incomplete, skipping runtime start");
    return undefined;
  }

  const provider = new ImapPollingEmailInboundProvider({
    accountId,
  });
  const bootstrapMode = normalizeBootstrapMode(options.bootstrapMode);
  const recentWindowLimit = normalizePositiveInt(options.recentWindowLimit, 0);
  const pollIntervalMs = normalizePositiveInt(options.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS);
  const connectTimeoutMs = normalizePositiveInt(options.connectTimeoutMs, DEFAULT_CONNECT_TIMEOUT_MS);
  const socketTimeoutMs = normalizePositiveInt(options.socketTimeoutMs, DEFAULT_SOCKET_TIMEOUT_MS);
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let pollChain = Promise.resolve();

  const appendAudit = async (record: Parameters<NonNullable<typeof options.auditStore>["append"]>[0]) => {
    if (!options.auditStore) return;
    try {
      await options.auditStore.append(record);
    } catch (error) {
      options.logger.warn("email-inbound", "Failed to append inbound email audit record", error);
    }
  };

  const pollOnce = async () => {
    await processDueEmailFollowUpReminders({
      reminderStore: options.reminderStore,
      conversationStore: options.conversationStore,
      broadcastEvent: options.broadcastEvent,
      logger: options.logger,
    });

    const checkpoint = await options.checkpointStore.get({
      providerId: provider.providerId,
      accountId,
      mailbox,
    });
    const isBootstrapPoll = !checkpoint;
    const shouldInspectLatestUid = isBootstrapPoll || recentWindowLimit > 0;
    const latestKnownUid = shouldInspectLatestUid
      ? await fetchLatestKnownUid({
        host,
        port: options.port,
        secure: options.secure,
        username,
        password,
        mailbox,
        connectTimeoutMs,
        socketTimeoutMs,
      })
      : 0;
    if (isBootstrapPoll && bootstrapMode === "latest" && recentWindowLimit <= 0) {
      const baselineUid = latestKnownUid;
      await options.checkpointStore.update({
        providerId: provider.providerId,
        accountId,
        mailbox,
        lastUid: baselineUid,
      });
      options.logger.info("email-inbound", "Initialized IMAP checkpoint from latest UID; historical backlog is skipped on first attach", {
        providerId: provider.providerId,
        accountId,
        mailbox,
        bootstrapMode,
        baselineUid,
      });
      return;
    }
    let sinceUid = checkpoint?.lastUid ?? 0;
    if (recentWindowLimit > 0 && latestKnownUid > 0) {
      const windowBaselineUid = Math.max(0, latestKnownUid - recentWindowLimit);
      if (windowBaselineUid > sinceUid) {
        await options.checkpointStore.update({
          providerId: provider.providerId,
          accountId,
          mailbox,
          lastUid: windowBaselineUid,
        });
        sinceUid = windowBaselineUid;
        options.logger.info("email-inbound", "Fast-forwarded IMAP checkpoint to recent window limit", {
          providerId: provider.providerId,
          accountId,
          mailbox,
          recentWindowLimit,
          latestUid: latestKnownUid,
          baselineUid: windowBaselineUid,
          bootstrapMode,
          reason: isBootstrapPoll ? "bootstrap_recent_window" : "stale_checkpoint_recent_window",
        });
      }
    }
    const processedMessageIds = new Set(checkpoint?.processedMessageIds ?? []);
    const processFetchedMessage = async (item: ImapFetchedMessage, mode: "fresh" | "retry") => {
      const parsed = parseRawEmailMessage(item.rawMessage);
      const normalized = provider.normalizeInboundEvent({
        accountId,
        raw: {
          uid: item.uid,
          messageId: parsed.messageId,
          threadId: parsed.threadId,
          subject: parsed.subject,
          from: parsed.from,
          to: parsed.to,
          cc: parsed.cc,
          bcc: parsed.bcc,
          replyTo: parsed.replyTo,
          snippet: parsed.snippet,
          textBody: parsed.textBody,
          htmlBody: parsed.htmlBody,
          receivedAt: item.internalDate ? Date.parse(item.internalDate) : Date.now(),
          references: parsed.references,
          inReplyToMessageId: parsed.inReplyToMessageId,
          attachments: parsed.attachments,
          mailbox,
          flags: item.flags,
          headers: parsed.headers,
        },
      });
      if (!normalized.ok) {
        options.logger.warn("email-inbound", `Skipped invalid inbound email event: ${normalized.message}`, {
          uid: item.uid,
          issues: normalized.issues,
        });
        await appendAudit({
          timestamp: Date.now(),
          providerId: provider.providerId,
          accountId,
          mailbox,
          status: "invalid_event",
          ...(parsed.messageId ? { messageId: parsed.messageId } : {}),
          ...(parsed.threadId ? { threadId: parsed.threadId } : {}),
          ...(parsed.subject ? { subject: parsed.subject } : {}),
          from: summarizeAddresses(parsed.from),
          to: summarizeAddresses(parsed.to),
          bodyPreview: summarizePreview(parsed),
          attachmentCount: parsed.attachments.length,
          inlineAttachmentCount: parsed.inlineAttachmentCount,
          ...(parsed.inReplyToMessageId ? { inReplyToMessageId: parsed.inReplyToMessageId } : {}),
          ...(parsed.references.length > 0 ? { references: parsed.references } : {}),
          checkpointUid: item.uid,
          errorCode: "invalid_event",
          error: normalized.issues.join("; ") || normalized.message,
        });
        await options.checkpointStore.update({
          providerId: provider.providerId,
          accountId,
          mailbox,
          lastUid: item.uid,
          processedMessageId: parsed.messageId,
        });
        return;
      }
      const normalizedValue = normalized.value;
      const triage = buildEmailInboundTriage(normalizedValue);
      if (processedMessageIds.has(normalizedValue.messageId)) {
        await appendAudit({
          timestamp: Date.now(),
          providerId: normalizedValue.providerId,
          accountId: normalizedValue.accountId,
          mailbox,
          status: "skipped_duplicate",
          messageId: normalizedValue.messageId,
          threadId: normalizedValue.threadId,
          subject: normalizedValue.subject,
          from: summarizeAddresses(normalizedValue.from),
          to: summarizeAddresses(normalizedValue.to),
          bodyPreview: summarizePreview(normalizedValue),
          attachmentCount: normalizedValue.attachments.length,
          inlineAttachmentCount: parsed.inlineAttachmentCount,
          receivedAt: normalizedValue.receivedAt,
          ...toEmailInboundAuditTriage(triage),
          ...(normalizedValue.inReplyToMessageId ? { inReplyToMessageId: normalizedValue.inReplyToMessageId } : {}),
          ...(normalizedValue.references.length > 0 ? { references: normalizedValue.references } : {}),
          checkpointUid: item.uid,
        });
        await options.checkpointStore.update({
          providerId: provider.providerId,
          accountId,
          mailbox,
          lastUid: item.uid,
          processedMessageId: normalizedValue.messageId,
        });
        return;
      }
      try {
        const result = await ingestEmailInboundEvent({
          agentFactory: options.agentFactory,
          agentRegistry: options.agentRegistry,
          conversationStore: options.conversationStore,
          threadBindingStore: options.threadBindingStore,
          log: options.logger,
          broadcastEvent: options.broadcastEvent,
        }, {
          event: normalizedValue,
          requestedAgentId: options.requestedAgentId,
        });
        await appendAudit({
          timestamp: Date.now(),
          providerId: normalizedValue.providerId,
          accountId: normalizedValue.accountId,
          mailbox,
          status: "processed",
          messageId: normalizedValue.messageId,
          threadId: normalizedValue.threadId,
          subject: normalizedValue.subject,
          from: summarizeAddresses(normalizedValue.from),
          to: summarizeAddresses(normalizedValue.to),
          bodyPreview: summarizePreview(normalizedValue),
          attachmentCount: normalizedValue.attachments.length,
          inlineAttachmentCount: parsed.inlineAttachmentCount,
          receivedAt: normalizedValue.receivedAt,
          conversationId: result.conversationId,
          sessionKey: result.sessionKey,
          requestedAgentId: result.requestedAgentId,
          runId: result.runId,
          checkpointUid: item.uid,
          createdBinding: result.createdBinding,
          ...toEmailInboundAuditTriage(result.triage),
          ...(normalizedValue.inReplyToMessageId ? { inReplyToMessageId: normalizedValue.inReplyToMessageId } : {}),
          ...(normalizedValue.references.length > 0 ? { references: normalizedValue.references } : {}),
        });
        processedMessageIds.add(normalizedValue.messageId);
        await scheduleEmailFollowUpReminder({
          reminderStore: options.reminderStore,
          event: {
            providerId: normalizedValue.providerId,
            accountId: normalizedValue.accountId,
            threadId: normalizedValue.threadId,
            messageId: normalizedValue.messageId,
            subject: normalizedValue.subject,
            receivedAt: normalizedValue.receivedAt,
          },
          conversationId: result.conversationId,
          requestedAgentId: result.requestedAgentId,
          triage: result.triage,
        });
        await options.checkpointStore.update({
          providerId: provider.providerId,
          accountId,
          mailbox,
          lastUid: item.uid,
          processedMessageId: normalizedValue.messageId,
        });
      } catch (error) {
        const failure = await options.checkpointStore.recordFailure({
          providerId: normalizedValue.providerId,
          accountId: normalizedValue.accountId,
          mailbox,
          uid: item.uid,
          messageId: normalizedValue.messageId,
          threadId: normalizedValue.threadId,
          subject: normalizedValue.subject,
          error: error instanceof Error ? error.message : String(error),
        });
        const retryExhausted = failure.attempts >= MAX_FAILURE_RETRY_ATTEMPTS;
        await appendAudit({
          timestamp: Date.now(),
          providerId: normalizedValue.providerId,
          accountId: normalizedValue.accountId,
          mailbox,
          status: "failed",
          messageId: normalizedValue.messageId,
          threadId: normalizedValue.threadId,
          subject: normalizedValue.subject,
          from: summarizeAddresses(normalizedValue.from),
          to: summarizeAddresses(normalizedValue.to),
          bodyPreview: summarizePreview(normalizedValue),
          attachmentCount: normalizedValue.attachments.length,
          inlineAttachmentCount: parsed.inlineAttachmentCount,
          receivedAt: normalizedValue.receivedAt,
          requestedAgentId: options.requestedAgentId,
          checkpointUid: item.uid,
          ...toEmailInboundAuditTriage(triage),
          ...(normalizedValue.inReplyToMessageId ? { inReplyToMessageId: normalizedValue.inReplyToMessageId } : {}),
          ...(normalizedValue.references.length > 0 ? { references: normalizedValue.references } : {}),
          retryAttempt: failure.attempts,
          retryScheduled: !retryExhausted,
          retryExhausted,
          errorCode: retryExhausted
            ? "ingest_retry_exhausted"
            : mode === "retry"
              ? "ingest_retry_failed"
              : "ingest_failed",
          error: error instanceof Error ? error.message : String(error),
        });
        if (retryExhausted) {
          processedMessageIds.add(normalizedValue.messageId);
          await options.checkpointStore.update({
            providerId: provider.providerId,
            accountId,
            mailbox,
            lastUid: item.uid,
            processedMessageId: normalizedValue.messageId,
          });
          options.logger.warn("email-inbound", "Inbound email retry budget exhausted; message is marked as skipped", {
            providerId: normalizedValue.providerId,
            accountId: normalizedValue.accountId,
            mailbox,
            messageId: normalizedValue.messageId,
            threadId: normalizedValue.threadId,
            attempts: failure.attempts,
          });
          return;
        }
        await options.checkpointStore.update({
          providerId: provider.providerId,
          accountId,
          mailbox,
          lastUid: item.uid,
        });
        options.logger.warn("email-inbound", "Inbound email processing failed; queued for retry", {
          providerId: normalizedValue.providerId,
          accountId: normalizedValue.accountId,
          mailbox,
          messageId: normalizedValue.messageId,
          threadId: normalizedValue.threadId,
          attempts: failure.attempts,
        });
        return;
      }
    };

    const retryQueue = Array.isArray(checkpoint?.failedMessages) ? checkpoint.failedMessages : [];
    if (retryQueue.length > 0) {
      const retryFetched = await fetchImapMessagesByUidList({
        host,
        port: options.port,
        secure: options.secure,
        username,
        password,
        mailbox,
        uids: retryQueue.map((item) => item.uid),
        connectTimeoutMs,
        socketTimeoutMs,
      });
      const retryByUid = new Map(retryFetched.map((item) => [item.uid, item]));
      for (const queued of retryQueue) {
        const fetchedRetry = retryByUid.get(queued.uid);
        if (!fetchedRetry) {
          options.logger.warn("email-inbound", "Queued IMAP retry message is no longer fetchable", {
            accountId,
            mailbox,
            messageId: queued.messageId,
            uid: queued.uid,
            attempts: queued.attempts,
          });
          continue;
        }
        await processFetchedMessage(fetchedRetry, "retry");
      }
    }

    const fetched = await fetchImapMessages({
      host,
      port: options.port,
      secure: options.secure,
      username,
      password,
      mailbox,
      sinceUid,
      connectTimeoutMs,
      socketTimeoutMs,
    });
    for (const item of fetched) {
      await processFetchedMessage(item, "fresh");
    }
  };

  const scheduleNext = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      void runPoll();
    }, pollIntervalMs);
  };

  const runPoll = async () => {
    pollChain = pollChain.then(async () => {
      try {
        await pollOnce();
      } catch (error) {
        options.logger.error("email-inbound", "IMAP inbound poll failed", {
          accountId,
          host,
          port: options.port,
          secure: options.secure,
          mailbox,
          error: serializeRuntimeError(error),
        });
      } finally {
        scheduleNext();
      }
    });
    await pollChain;
  };

  options.logger.info("email-inbound", `IMAP inbound runtime started (account=${accountId}, host=${host}, port=${options.port}, secure=${options.secure}, mailbox=${mailbox}, intervalMs=${pollIntervalMs})`);
  await runPoll();

  return {
    async stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      await pollChain.catch(() => undefined);
    },
    async pollNow() {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      await runPoll();
    },
  };
}
