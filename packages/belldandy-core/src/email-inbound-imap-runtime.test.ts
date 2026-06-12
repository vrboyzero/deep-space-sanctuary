import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ConversationStore, type AgentRunInput, type AgentStreamItem, type BelldandyAgent } from "@belldandy/agent";

import {
  createFileEmailInboundAuditStore,
  resolveEmailInboundAuditStorePath,
} from "./email-inbound-audit-store.js";
import {
  createFileEmailInboundCheckpointStore,
  resolveEmailInboundCheckpointStorePath,
} from "./email-inbound-checkpoint-store.js";
import { startImapPollingEmailInboundRuntime } from "./email-inbound-imap-runtime.js";
import {
  createFileEmailThreadBindingStore,
  resolveEmailThreadBindingStorePath,
} from "./email-thread-binding-store.js";
import { waitFor } from "./server-testkit.js";

const tempDirs: string[] = [];
const servers: net.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }).catch(() => {})));
});

class FastAgent implements BelldandyAgent {
  async *run(input: AgentRunInput): AsyncIterable<AgentStreamItem> {
    yield { type: "status", status: "running" };
    yield { type: "final", text: `ok:${input.text.slice(0, 16)}` };
    yield { type: "status", status: "done" };
  }
}

function createFakeImapServer(): Promise<{ server: net.Server; port: number }> {
  const rawMessage = [
    "Message-ID: <msg-001@example.com>",
    "Subject: Project Update",
    "From: Alice <alice@example.com>",
    "To: Team <team@example.com>",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Please review the latest patch.",
  ].join("\r\n");
  const literalLength = Buffer.byteLength(rawMessage, "utf-8");

  const server = net.createServer((socket) => {
    socket.write("* OK fake-imap ready\r\n");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf-8");
      while (buffer.includes("\r\n")) {
        const lineEnd = buffer.indexOf("\r\n");
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 2);
        if (!line.trim()) continue;
        const [tag, ...rest] = line.split(" ");
        const command = rest.join(" ");
        if (command.startsWith("LOGIN")) {
          socket.write(`${tag} OK LOGIN completed\r\n`);
          continue;
        }
        if (command.startsWith("SELECT")) {
          socket.write(`* 1 EXISTS\r\n${tag} OK [READ-ONLY] SELECT completed\r\n`);
          continue;
        }
        if (command.startsWith("UID SEARCH")) {
          const sinceMatch = command.match(/UID SEARCH UID (\d+):\*/i);
          const since = sinceMatch ? Number(sinceMatch[1]) : 1;
          const body = since <= 7 ? "* SEARCH 7" : "* SEARCH";
          socket.write(`${body}\r\n${tag} OK SEARCH completed\r\n`);
          continue;
        }
        if (command.startsWith("UID FETCH 7")) {
          socket.write(`* 1 FETCH (UID 7 FLAGS (\\\\Seen) INTERNALDATE "15-Apr-2026 03:15:00 +0000" BODY[] {${literalLength}}\r\n${rawMessage}\r\n)\r\n${tag} OK FETCH completed\r\n`);
          continue;
        }
        if (command.startsWith("LOGOUT")) {
          socket.write(`* BYE LOGOUT requested\r\n${tag} OK LOGOUT completed\r\n`);
          socket.end();
          continue;
        }
        socket.write(`${tag} BAD unsupported\r\n`);
      }
    });
  });
  servers.push(server);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("failed to resolve fake imap port"));
        return;
      }
      resolve({ server, port: address.port });
    });
  });
}

describe("startImapPollingEmailInboundRuntime", () => {
  it("bootstraps from the latest UID on first attach and skips historical backlog by default", async () => {
    const oldRawMessage = [
      "Message-ID: <msg-old@example.com>",
      "Subject: Old mail",
      "From: Alice <alice@example.com>",
      "To: Team <team@example.com>",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "This historical mail should be skipped on first attach.",
    ].join("\r\n");
    const newRawMessage = [
      "Message-ID: <msg-new@example.com>",
      "Subject: New mail",
      "From: Bob <bob@example.com>",
      "To: Team <team@example.com>",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "This mail arrives after the initial baseline.",
    ].join("\r\n");
    const oldLiteralLength = Buffer.byteLength(oldRawMessage, "utf-8");
    const newLiteralLength = Buffer.byteLength(newRawMessage, "utf-8");
    let releaseNewMessage = false;

    const server = net.createServer((socket) => {
      socket.write("* OK fake-imap ready\r\n");
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf-8");
        while (buffer.includes("\r\n")) {
          const lineEnd = buffer.indexOf("\r\n");
          const line = buffer.slice(0, lineEnd);
          buffer = buffer.slice(lineEnd + 2);
          if (!line.trim()) continue;
          const [tag, ...rest] = line.split(" ");
          const command = rest.join(" ");
          if (command.startsWith("LOGIN")) {
            socket.write(`${tag} OK LOGIN completed\r\n`);
            continue;
          }
          if (command.startsWith("STATUS")) {
            socket.write(`* STATUS INBOX (UIDNEXT 101)\r\n${tag} OK STATUS completed\r\n`);
            continue;
          }
          if (command.startsWith("SELECT")) {
            socket.write(`* 100 EXISTS\r\n${tag} OK [READ-ONLY] SELECT completed\r\n`);
            continue;
          }
          if (command.startsWith("UID SEARCH")) {
            const body = releaseNewMessage ? "* SEARCH 101" : "* SEARCH";
            socket.write(`${body}\r\n${tag} OK SEARCH completed\r\n`);
            continue;
          }
          if (command.startsWith("UID FETCH 100")) {
            socket.write(`* 1 FETCH (UID 100 FLAGS (\\\\Seen) INTERNALDATE "15-Apr-2026 03:15:00 +0000" BODY[] {${oldLiteralLength}}\r\n${oldRawMessage}\r\n)\r\n${tag} OK FETCH completed\r\n`);
            continue;
          }
          if (command.startsWith("UID FETCH 101")) {
            socket.write(`* 1 FETCH (UID 101 FLAGS (\\\\Seen) INTERNALDATE "15-Apr-2026 03:16:00 +0000" BODY[] {${newLiteralLength}}\r\n${newRawMessage}\r\n)\r\n${tag} OK FETCH completed\r\n`);
            continue;
          }
          if (command.startsWith("LOGOUT")) {
            socket.write(`* BYE LOGOUT requested\r\n${tag} OK LOGOUT completed\r\n`);
            socket.end();
            continue;
          }
          socket.write(`${tag} BAD unsupported\r\n`);
        }
      });
    });
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("failed to resolve fake imap port");
    }

    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-email-imap-bootstrap-"));
    tempDirs.push(stateDir);
    const conversationStore = new ConversationStore();
    const threadBindingStore = createFileEmailThreadBindingStore(resolveEmailThreadBindingStorePath(stateDir));
    const checkpointStore = createFileEmailInboundCheckpointStore(resolveEmailInboundCheckpointStorePath(stateDir));
    const auditStore = createFileEmailInboundAuditStore(resolveEmailInboundAuditStorePath(stateDir));
    const infos: Array<{ module: string; message: string; data?: unknown }> = [];

    const runtime = await startImapPollingEmailInboundRuntime({
      enabled: true,
      host: "127.0.0.1",
      port: address.port,
      secure: false,
      username: "user",
      password: "pass",
      accountId: "primary",
      mailbox: "INBOX",
      pollIntervalMs: 60_000,
      agentFactory: () => new FastAgent(),
      conversationStore,
      threadBindingStore,
      checkpointStore,
      auditStore,
      logger: {
        info(module, message, data) {
          infos.push({ module, message, data });
        },
        warn() {},
        error() {},
      },
    });

    expect(runtime).toBeDefined();
    await expect(checkpointStore.get({
      providerId: "imap",
      accountId: "primary",
      mailbox: "INBOX",
    })).resolves.toEqual(expect.objectContaining({
      lastUid: 100,
      processedMessageIds: [],
    }));
    await expect(auditStore.listRecent(5)).resolves.toEqual([]);
    expect(infos).toEqual(expect.arrayContaining([
      expect.objectContaining({
        module: "email-inbound",
        message: "Initialized IMAP checkpoint from latest UID; historical backlog is skipped on first attach",
        data: expect.objectContaining({
          baselineUid: 100,
          bootstrapMode: "latest",
        }),
      }),
    ]));

    releaseNewMessage = true;
    await runtime?.pollNow();
    await waitFor(() => {
      const conversationId = "channel=email:scope=per-account-thread:provider=imap:account=primary:thread=%3Cmsg-new%40example.com%3E";
      return Boolean(conversationStore.get(conversationId)?.messages?.length === 2);
    }, 4000);

    expect(conversationStore.get("channel=email:scope=per-account-thread:provider=imap:account=primary:thread=%3Cmsg-old%40example.com%3E")).toBeUndefined();
    await runtime?.stop();
  });

  it("imports only the latest recent window on first attach when recentWindowLimit is configured", async () => {
    const oldRawMessage = [
      "Message-ID: <msg-098@example.com>",
      "Subject: Old mail",
      "From: Alice <alice@example.com>",
      "To: Team <team@example.com>",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "This historical mail should be skipped.",
    ].join("\r\n");
    const recentOneRawMessage = [
      "Message-ID: <msg-099@example.com>",
      "Subject: Recent one",
      "From: Bob <bob@example.com>",
      "To: Team <team@example.com>",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "This mail should be imported in the recent window.",
    ].join("\r\n");
    const recentTwoRawMessage = [
      "Message-ID: <msg-100@example.com>",
      "Subject: Recent two",
      "From: Carol <carol@example.com>",
      "To: Team <team@example.com>",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "This mail should also be imported in the recent window.",
    ].join("\r\n");
    const oldLiteralLength = Buffer.byteLength(oldRawMessage, "utf-8");
    const recentOneLiteralLength = Buffer.byteLength(recentOneRawMessage, "utf-8");
    const recentTwoLiteralLength = Buffer.byteLength(recentTwoRawMessage, "utf-8");

    const server = net.createServer((socket) => {
      socket.write("* OK fake-imap ready\r\n");
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf-8");
        while (buffer.includes("\r\n")) {
          const lineEnd = buffer.indexOf("\r\n");
          const line = buffer.slice(0, lineEnd);
          buffer = buffer.slice(lineEnd + 2);
          if (!line.trim()) continue;
          const [tag, ...rest] = line.split(" ");
          const command = rest.join(" ");
          if (command.startsWith("LOGIN")) {
            socket.write(`${tag} OK LOGIN completed\r\n`);
            continue;
          }
          if (command.startsWith("STATUS")) {
            socket.write(`* STATUS INBOX (UIDNEXT 101)\r\n${tag} OK STATUS completed\r\n`);
            continue;
          }
          if (command.startsWith("SELECT")) {
            socket.write(`* 100 EXISTS\r\n${tag} OK [READ-ONLY] SELECT completed\r\n`);
            continue;
          }
          if (command.startsWith("UID SEARCH")) {
            socket.write(`* SEARCH 99 100\r\n${tag} OK SEARCH completed\r\n`);
            continue;
          }
          if (command.startsWith("UID FETCH 98")) {
            socket.write(`* 1 FETCH (UID 98 FLAGS (\\\\Seen) INTERNALDATE "15-Apr-2026 03:10:00 +0000" BODY[] {${oldLiteralLength}}\r\n${oldRawMessage}\r\n)\r\n${tag} OK FETCH completed\r\n`);
            continue;
          }
          if (command.startsWith("UID FETCH 99")) {
            socket.write(`* 1 FETCH (UID 99 FLAGS (\\\\Seen) INTERNALDATE "15-Apr-2026 03:11:00 +0000" BODY[] {${recentOneLiteralLength}}\r\n${recentOneRawMessage}\r\n)\r\n${tag} OK FETCH completed\r\n`);
            continue;
          }
          if (command.startsWith("UID FETCH 100")) {
            socket.write(`* 1 FETCH (UID 100 FLAGS (\\\\Seen) INTERNALDATE "15-Apr-2026 03:12:00 +0000" BODY[] {${recentTwoLiteralLength}}\r\n${recentTwoRawMessage}\r\n)\r\n${tag} OK FETCH completed\r\n`);
            continue;
          }
          if (command.startsWith("LOGOUT")) {
            socket.write(`* BYE LOGOUT requested\r\n${tag} OK LOGOUT completed\r\n`);
            socket.end();
            continue;
          }
          socket.write(`${tag} BAD unsupported\r\n`);
        }
      });
    });
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("failed to resolve fake imap port");
    }

    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-email-imap-recent-window-"));
    tempDirs.push(stateDir);
    const conversationStore = new ConversationStore();
    const threadBindingStore = createFileEmailThreadBindingStore(resolveEmailThreadBindingStorePath(stateDir));
    const checkpointStore = createFileEmailInboundCheckpointStore(resolveEmailInboundCheckpointStorePath(stateDir));
    const auditStore = createFileEmailInboundAuditStore(resolveEmailInboundAuditStorePath(stateDir));

    const runtime = await startImapPollingEmailInboundRuntime({
      enabled: true,
      host: "127.0.0.1",
      port: address.port,
      secure: false,
      username: "user",
      password: "pass",
      accountId: "primary",
      mailbox: "INBOX",
      pollIntervalMs: 60_000,
      recentWindowLimit: 2,
      agentFactory: () => new FastAgent(),
      conversationStore,
      threadBindingStore,
      checkpointStore,
      auditStore,
      logger: {
        info() {},
        warn() {},
        error() {},
      },
    });

    expect(runtime).toBeDefined();
    await waitFor(() => {
      const one = conversationStore.get("channel=email:scope=per-account-thread:provider=imap:account=primary:thread=%3Cmsg-099%40example.com%3E");
      const two = conversationStore.get("channel=email:scope=per-account-thread:provider=imap:account=primary:thread=%3Cmsg-100%40example.com%3E");
      return Boolean(one?.messages?.length === 2 && two?.messages?.length === 2);
    }, 4000);

    expect(conversationStore.get("channel=email:scope=per-account-thread:provider=imap:account=primary:thread=%3Cmsg-098%40example.com%3E")).toBeUndefined();
    await expect(checkpointStore.get({
      providerId: "imap",
      accountId: "primary",
      mailbox: "INBOX",
    })).resolves.toEqual(expect.objectContaining({
      lastUid: 100,
      processedMessageIds: ["<msg-099@example.com>", "<msg-100@example.com>"],
    }));

    await runtime?.stop();
  });

  it("fast-forwards a stale checkpoint to the recent window when backlog grows too large", async () => {
    const latestRawMessage = [
      "Message-ID: <msg-120@example.com>",
      "Subject: Latest mail",
      "From: Dave <dave@example.com>",
      "To: Team <team@example.com>",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Only the latest mail should be imported after the checkpoint is fast-forwarded.",
    ].join("\r\n");
    const latestLiteralLength = Buffer.byteLength(latestRawMessage, "utf-8");

    const server = net.createServer((socket) => {
      socket.write("* OK fake-imap ready\r\n");
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf-8");
        while (buffer.includes("\r\n")) {
          const lineEnd = buffer.indexOf("\r\n");
          const line = buffer.slice(0, lineEnd);
          buffer = buffer.slice(lineEnd + 2);
          if (!line.trim()) continue;
          const [tag, ...rest] = line.split(" ");
          const command = rest.join(" ");
          if (command.startsWith("LOGIN")) {
            socket.write(`${tag} OK LOGIN completed\r\n`);
            continue;
          }
          if (command.startsWith("STATUS")) {
            socket.write(`* STATUS INBOX (UIDNEXT 121)\r\n${tag} OK STATUS completed\r\n`);
            continue;
          }
          if (command.startsWith("SELECT")) {
            socket.write(`* 120 EXISTS\r\n${tag} OK [READ-ONLY] SELECT completed\r\n`);
            continue;
          }
          if (command.startsWith("UID SEARCH")) {
            socket.write(`* SEARCH 120\r\n${tag} OK SEARCH completed\r\n`);
            continue;
          }
          if (command.startsWith("UID FETCH 120")) {
            socket.write(`* 1 FETCH (UID 120 FLAGS (\\\\Seen) INTERNALDATE "15-Apr-2026 03:20:00 +0000" BODY[] {${latestLiteralLength}}\r\n${latestRawMessage}\r\n)\r\n${tag} OK FETCH completed\r\n`);
            continue;
          }
          if (command.startsWith("LOGOUT")) {
            socket.write(`* BYE LOGOUT requested\r\n${tag} OK LOGOUT completed\r\n`);
            socket.end();
            continue;
          }
          socket.write(`${tag} BAD unsupported\r\n`);
        }
      });
    });
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("failed to resolve fake imap port");
    }

    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-email-imap-stale-checkpoint-"));
    tempDirs.push(stateDir);
    const conversationStore = new ConversationStore();
    const threadBindingStore = createFileEmailThreadBindingStore(resolveEmailThreadBindingStorePath(stateDir));
    const checkpointStore = createFileEmailInboundCheckpointStore(resolveEmailInboundCheckpointStorePath(stateDir));
    const auditStore = createFileEmailInboundAuditStore(resolveEmailInboundAuditStorePath(stateDir));
    await checkpointStore.update({
      providerId: "imap",
      accountId: "primary",
      mailbox: "INBOX",
      lastUid: 10,
    });

    const runtime = await startImapPollingEmailInboundRuntime({
      enabled: true,
      host: "127.0.0.1",
      port: address.port,
      secure: false,
      username: "user",
      password: "pass",
      accountId: "primary",
      mailbox: "INBOX",
      pollIntervalMs: 60_000,
      recentWindowLimit: 1,
      agentFactory: () => new FastAgent(),
      conversationStore,
      threadBindingStore,
      checkpointStore,
      auditStore,
      logger: {
        info() {},
        warn() {},
        error() {},
      },
    });

    expect(runtime).toBeDefined();
    await waitFor(() => {
      const conversationId = "channel=email:scope=per-account-thread:provider=imap:account=primary:thread=%3Cmsg-120%40example.com%3E";
      return Boolean(conversationStore.get(conversationId)?.messages?.length === 2);
    }, 4000);
    await expect(checkpointStore.get({
      providerId: "imap",
      accountId: "primary",
      mailbox: "INBOX",
    })).resolves.toEqual(expect.objectContaining({
      lastUid: 120,
      processedMessageIds: ["<msg-120@example.com>"],
    }));

    await runtime?.stop();
  });

  it("logs a structured error when IMAP polling times out before the greeting arrives", async () => {
    const server = net.createServer((_socket) => {
      // accept the connection but never send the IMAP greeting
    });
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("failed to resolve fake imap port");
    }

    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-email-imap-timeout-"));
    tempDirs.push(stateDir);
    const conversationStore = new ConversationStore();
    const threadBindingStore = createFileEmailThreadBindingStore(resolveEmailThreadBindingStorePath(stateDir));
    const checkpointStore = createFileEmailInboundCheckpointStore(resolveEmailInboundCheckpointStorePath(stateDir));
    const loggerErrors: Array<{ module: string; message: string; data?: unknown }> = [];

    const runtime = await startImapPollingEmailInboundRuntime({
      enabled: true,
      host: "127.0.0.1",
      port: address.port,
      secure: false,
      username: "user",
      password: "pass",
      accountId: "primary",
      mailbox: "INBOX",
      pollIntervalMs: 60_000,
      connectTimeoutMs: 80,
      socketTimeoutMs: 80,
      agentFactory: () => new FastAgent(),
      conversationStore,
      threadBindingStore,
      checkpointStore,
      logger: {
        info() {},
        warn() {},
        error(module, message, data) {
          loggerErrors.push({ module, message, data });
        },
      },
    });

    expect(runtime).toBeDefined();
    expect(loggerErrors).toEqual([
      expect.objectContaining({
        module: "email-inbound",
        message: "IMAP inbound poll failed",
        data: expect.objectContaining({
          accountId: "primary",
          host: "127.0.0.1",
          mailbox: "INBOX",
          error: expect.objectContaining({
            message: "IMAP read timeout",
          }),
        }),
      }),
    ]);

    await runtime?.stop();
  });

  it("polls IMAP, ingests the email, and advances the checkpoint", async () => {
    const { port } = await createFakeImapServer();
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-email-imap-"));
    tempDirs.push(stateDir);
    const conversationStore = new ConversationStore();
    const threadBindingStore = createFileEmailThreadBindingStore(resolveEmailThreadBindingStorePath(stateDir));
    const checkpointStore = createFileEmailInboundCheckpointStore(resolveEmailInboundCheckpointStorePath(stateDir));
    const auditStore = createFileEmailInboundAuditStore(resolveEmailInboundAuditStorePath(stateDir));

    const runtime = await startImapPollingEmailInboundRuntime({
      enabled: true,
      host: "127.0.0.1",
      port,
      secure: false,
      username: "user",
      password: "pass",
      accountId: "primary",
      mailbox: "INBOX",
      pollIntervalMs: 60_000,
      bootstrapMode: "all",
      agentFactory: () => new FastAgent(),
      conversationStore,
      threadBindingStore,
      checkpointStore,
      auditStore,
      logger: {
        info() {},
        warn() {},
        error() {},
      },
    });

    expect(runtime).toBeDefined();
    await waitFor(() => {
      const threadSessionKey = "channel=email:scope=per-account-thread:provider=imap:account=primary:thread=%3Cmsg-001%40example.com%3E";
      const conversation = conversationStore.get(threadSessionKey);
      return Boolean(conversation && conversation.messages.length >= 2);
    }, 4000);

    const conversationId = "channel=email:scope=per-account-thread:provider=imap:account=primary:thread=%3Cmsg-001%40example.com%3E";
    const conversation = conversationStore.get(conversationId);
    expect(conversation?.messages).toHaveLength(2);
    expect(conversation?.messages[0]?.role).toBe("user");
    expect(conversation?.messages[1]?.role).toBe("assistant");
    await expect(threadBindingStore.getByThread({
      providerId: "imap",
      accountId: "primary",
      threadId: "<msg-001@example.com>",
    })).resolves.toEqual(expect.objectContaining({
      conversationId,
      lastMessageId: "<msg-001@example.com>",
    }));
    await expect(checkpointStore.get({
      providerId: "imap",
      accountId: "primary",
      mailbox: "INBOX",
    })).resolves.toEqual(expect.objectContaining({
      lastUid: 7,
      processedMessageIds: ["<msg-001@example.com>"],
    }));
    await expect(auditStore.listRecent(2)).resolves.toEqual([
      expect.objectContaining({
        status: "processed",
        providerId: "imap",
        accountId: "primary",
        mailbox: "INBOX",
        messageId: "<msg-001@example.com>",
        conversationId,
        createdBinding: true,
      }),
    ]);

    await runtime?.pollNow();
    expect(conversationStore.get(conversationId)?.messages).toHaveLength(2);
    await runtime?.stop();
  });

  it("isolates failed inbound messages, retries them later, and still processes later mail in the same poll", async () => {
    const firstRawMessage = [
      "Message-ID: <msg-retry@example.com>",
      "Subject: First mail",
      "From: Alice <alice@example.com>",
      "To: Team <team@example.com>",
      "In-Reply-To: <thread-retry@example.com>",
      "References: <thread-retry@example.com>",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Please retry this one first.",
    ].join("\r\n");
    const secondRawMessage = [
      "Message-ID: <msg-ok@example.com>",
      "Subject: Second mail",
      "From: Bob <bob@example.com>",
      "To: Team <team@example.com>",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "This one should continue even if the first message fails.",
    ].join("\r\n");
    const firstLiteralLength = Buffer.byteLength(firstRawMessage, "utf-8");
    const secondLiteralLength = Buffer.byteLength(secondRawMessage, "utf-8");

    const server = net.createServer((socket) => {
      socket.write("* OK fake-imap ready\r\n");
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf-8");
        while (buffer.includes("\r\n")) {
          const lineEnd = buffer.indexOf("\r\n");
          const line = buffer.slice(0, lineEnd);
          buffer = buffer.slice(lineEnd + 2);
          if (!line.trim()) continue;
          const [tag, ...rest] = line.split(" ");
          const command = rest.join(" ");
          if (command.startsWith("LOGIN")) {
            socket.write(`${tag} OK LOGIN completed\r\n`);
            continue;
          }
          if (command.startsWith("SELECT")) {
            socket.write(`* 2 EXISTS\r\n${tag} OK [READ-ONLY] SELECT completed\r\n`);
            continue;
          }
          if (command.startsWith("UID SEARCH")) {
            const sinceMatch = command.match(/UID SEARCH UID (\d+):\*/i);
            const since = sinceMatch ? Number(sinceMatch[1]) : 1;
            const body = since <= 7 ? "* SEARCH 7 8" : "* SEARCH";
            socket.write(`${body}\r\n${tag} OK SEARCH completed\r\n`);
            continue;
          }
          if (command.startsWith("UID FETCH 7")) {
            socket.write(`* 1 FETCH (UID 7 FLAGS (\\\\Seen) INTERNALDATE "15-Apr-2026 03:20:00 +0000" BODY[] {${firstLiteralLength}}\r\n${firstRawMessage}\r\n)\r\n${tag} OK FETCH completed\r\n`);
            continue;
          }
          if (command.startsWith("UID FETCH 8")) {
            socket.write(`* 2 FETCH (UID 8 FLAGS (\\\\Seen) INTERNALDATE "15-Apr-2026 03:21:00 +0000" BODY[] {${secondLiteralLength}}\r\n${secondRawMessage}\r\n)\r\n${tag} OK FETCH completed\r\n`);
            continue;
          }
          if (command.startsWith("LOGOUT")) {
            socket.write(`* BYE LOGOUT requested\r\n${tag} OK LOGOUT completed\r\n`);
            socket.end();
            continue;
          }
          socket.write(`${tag} BAD unsupported\r\n`);
        }
      });
    });
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("failed to resolve fake imap port");
    }

    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-email-imap-"));
    tempDirs.push(stateDir);
    const conversationStore = new ConversationStore();
    const threadBindingStore = createFileEmailThreadBindingStore(resolveEmailThreadBindingStorePath(stateDir));
    const checkpointStore = createFileEmailInboundCheckpointStore(resolveEmailInboundCheckpointStorePath(stateDir));
    const auditStore = createFileEmailInboundAuditStore(resolveEmailInboundAuditStorePath(stateDir));
    let runCount = 0;

    const runtime = await startImapPollingEmailInboundRuntime({
      enabled: true,
      host: "127.0.0.1",
      port: address.port,
      secure: false,
      username: "user",
      password: "pass",
      accountId: "primary",
      mailbox: "INBOX",
      pollIntervalMs: 60_000,
      bootstrapMode: "all",
      agentFactory: () => ({
        async *run(input: AgentRunInput): AsyncIterable<AgentStreamItem> {
          runCount += 1;
          if (input.text.includes("<msg-retry@example.com>") && runCount === 1) {
            throw new Error("temporary agent failure");
          }
          yield { type: "status", status: "running" };
          yield { type: "final", text: `ok:${input.text.slice(0, 12)}` };
          yield { type: "status", status: "done" };
        },
      }),
      conversationStore,
      threadBindingStore,
      checkpointStore,
      auditStore,
      logger: {
        info() {},
        warn() {},
        error() {},
      },
    });

    expect(runtime).toBeDefined();
    await waitFor(() => {
      const okConversationId = "channel=email:scope=per-account-thread:provider=imap:account=primary:thread=%3Cmsg-ok%40example.com%3E";
      return Boolean(conversationStore.get(okConversationId)?.messages?.length === 2);
    }, 4000);

    const firstCheckpoint = await checkpointStore.get({
      providerId: "imap",
      accountId: "primary",
      mailbox: "INBOX",
    });
    expect(firstCheckpoint).toEqual(expect.objectContaining({
      lastUid: 8,
      processedMessageIds: ["<msg-ok@example.com>"],
      failedMessages: [expect.objectContaining({
        uid: 7,
        messageId: "<msg-retry@example.com>",
        attempts: 1,
      })],
    }));

    const firstAuditItems = await auditStore.listRecent(5);
    expect(firstAuditItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        messageId: "<msg-retry@example.com>",
        status: "failed",
        retryAttempt: 1,
        retryScheduled: true,
        retryExhausted: false,
      }),
      expect.objectContaining({
        messageId: "<msg-ok@example.com>",
        status: "processed",
        triageCategory: "informational",
      }),
    ]));

    await runtime?.pollNow();
    await waitFor(() => {
      const retryConversationId = "channel=email:scope=per-account-thread:provider=imap:account=primary:thread=%3Cthread-retry%40example.com%3E";
      const messages = conversationStore.get(retryConversationId)?.messages ?? [];
      return messages.length >= 3 && messages.some((item) => item.role === "assistant");
    }, 4000);
    const retryConversationId = "channel=email:scope=per-account-thread:provider=imap:account=primary:thread=%3Cthread-retry%40example.com%3E";
    expect(conversationStore.get(retryConversationId)?.messages).toEqual([
      expect.objectContaining({ role: "user" }),
      expect.objectContaining({ role: "user" }),
      expect.objectContaining({ role: "assistant" }),
    ]);

    await expect(checkpointStore.get({
      providerId: "imap",
      accountId: "primary",
      mailbox: "INBOX",
    })).resolves.toEqual(expect.objectContaining({
      lastUid: 8,
      processedMessageIds: ["<msg-ok@example.com>", "<msg-retry@example.com>"],
      failedMessages: [],
    }));

    const recentAuditItems = await auditStore.listRecent(6);
    expect(recentAuditItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        messageId: "<msg-retry@example.com>",
        status: "processed",
        triageCategory: "reply_required",
        triageNeedsFollowUp: true,
      }),
    ]));

    await runtime?.stop();
  });
});
