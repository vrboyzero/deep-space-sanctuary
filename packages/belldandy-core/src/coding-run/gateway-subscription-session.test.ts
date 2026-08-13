import { once } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";

const { approvePairingCodeMock } = vi.hoisted(() => ({
  approvePairingCodeMock: vi.fn(async () => ({ ok: true as const, clientId: "paired-client" })),
}));

vi.mock("../security/store.js", () => ({
  approvePairingCode: approvePairingCodeMock,
}));

import { GatewayCodingRunSubscriptionSession } from "./gateway-subscription-session.js";
import { CODING_RUN_PROTOCOL_VERSION } from "./contracts.js";
import { withEnv } from "../server-testkit.js";

const servers: WebSocketServer[] = [];

afterEach(async () => {
  approvePairingCodeMock.mockClear();
  await Promise.all(servers.splice(0).map(async (server) => {
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }));
});

describe("Gateway coding run subscription session", () => {
  it("preserves validated exact-bound efficiency evidence from the Gateway response", async () => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    servers.push(server);
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP listener.");
    const binding = { conversationId: "conversation-evidence", agentRunId: "run-evidence" };

    server.on("connection", (socket) => {
      socket.send(JSON.stringify({ type: "connect.challenge" }));
      socket.on("message", (raw) => {
        const frame = JSON.parse(raw.toString("utf-8")) as Record<string, unknown>;
        if (frame.type === "connect") {
          socket.send(JSON.stringify({ type: "hello-ok" }));
          return;
        }
        if (frame.type !== "req" || frame.method !== "coding.run.subscribe" || typeof frame.id !== "string") return;
        socket.send(JSON.stringify({
          type: "res",
          id: frame.id,
          ok: true,
          payload: {
            earliestSeq: 1,
            latestSeq: 2,
            efficiencyEvidence: {
              status: "complete",
              projectionTimeline: {
                source: "gateway_event_broker",
                coverage: "complete",
                binding,
                statusCoverage: ["needs_input"],
                items: [
                  { status: "running", observedAtMs: 1_000 },
                  { status: "completed", observedAtMs: 1_500 },
                ],
              },
              humanInterventionEvidence: {
                source: "human_response",
                coverage: "complete",
                binding,
                count: 0,
              },
            },
          },
        }));
      });
    });

    const session = new GatewayCodingRunSubscriptionSession("state-dir");
    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(address.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        await expect(session.subscribe({
          subscription: { version: CODING_RUN_PROTOCOL_VERSION, binding },
          onEvent: () => undefined,
          onInterrupted: () => undefined,
        })).resolves.toMatchObject({
          ok: true,
          payload: {
            earliestSeq: 1,
            latestSeq: 2,
            efficiencyEvidence: {
              status: "complete",
              projectionTimeline: { binding },
              humanInterventionEvidence: { count: 0 },
            },
          },
        });
      });
    } finally {
      session.close();
    }
  });

  it.each([
    {
      name: "cross-binding evidence",
      mutate: (evidence: Record<string, any>) => {
        evidence.projectionTimeline.binding.agentRunId = "other-run";
      },
    },
    {
      name: "content-bearing evidence",
      mutate: (evidence: Record<string, any>) => {
        evidence.projectionTimeline.items[0].prompt = "private prompt";
      },
    },
    {
      name: "non-monotonic evidence",
      mutate: (evidence: Record<string, any>) => {
        evidence.projectionTimeline.items[1].observedAtMs = 999;
      },
    },
  ])("rejects $name from the Gateway", async ({ mutate }) => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    servers.push(server);
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP listener.");
    const binding = { conversationId: "conversation-invalid", agentRunId: "run-invalid" };
    const evidence: Record<string, any> = {
      status: "complete",
      projectionTimeline: {
        source: "gateway_event_broker",
        coverage: "complete",
        binding: { ...binding },
        statusCoverage: ["needs_input"],
        items: [
          { status: "running", observedAtMs: 1_000 },
          { status: "completed", observedAtMs: 1_500 },
        ],
      },
      humanInterventionEvidence: {
        source: "human_response",
        coverage: "complete",
        binding: { ...binding },
        count: 0,
      },
    };
    mutate(evidence);

    server.on("connection", (socket) => {
      socket.send(JSON.stringify({ type: "connect.challenge" }));
      socket.on("message", (raw) => {
        const frame = JSON.parse(raw.toString("utf-8")) as Record<string, unknown>;
        if (frame.type === "connect") {
          socket.send(JSON.stringify({ type: "hello-ok" }));
          return;
        }
        if (frame.type !== "req" || frame.method !== "coding.run.subscribe" || typeof frame.id !== "string") return;
        socket.send(JSON.stringify({
          type: "res",
          id: frame.id,
          ok: true,
          payload: { earliestSeq: 1, latestSeq: 2, efficiencyEvidence: evidence },
        }));
      });
    });

    const session = new GatewayCodingRunSubscriptionSession("state-dir");
    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(address.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        await expect(session.subscribe({
          subscription: { version: CODING_RUN_PROTOCOL_VERSION, binding },
          onEvent: () => undefined,
          onInterrupted: () => undefined,
        })).resolves.toEqual({
          ok: false,
          error: {
            code: "gateway_unavailable",
            message: "Gateway returned an invalid coding run subscription response.",
          },
        });
      });
    } finally {
      session.close();
    }
  });

  it("accepts a legacy Gateway subscription response without additive efficiency evidence", async () => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    servers.push(server);
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP listener.");

    server.on("connection", (socket) => {
      socket.send(JSON.stringify({ type: "connect.challenge" }));
      socket.on("message", (raw) => {
        const frame = JSON.parse(raw.toString("utf-8")) as Record<string, unknown>;
        if (frame.type === "connect") {
          socket.send(JSON.stringify({ type: "hello-ok" }));
          return;
        }
        if (frame.type !== "req" || frame.method !== "coding.run.subscribe" || typeof frame.id !== "string") return;
        socket.send(JSON.stringify({
          type: "res",
          id: frame.id,
          ok: true,
          payload: { earliestSeq: 1, latestSeq: 2 },
        }));
      });
    });

    const session = new GatewayCodingRunSubscriptionSession("state-dir");
    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(address.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        await expect(session.subscribe({
          subscription: {
            version: CODING_RUN_PROTOCOL_VERSION,
            binding: { conversationId: "legacy-conversation", agentRunId: "legacy-run" },
          },
          onEvent: () => undefined,
          onInterrupted: () => undefined,
        })).resolves.toEqual({ ok: true, payload: { earliestSeq: 1, latestSeq: 2 } });
      });
    } finally {
      session.close();
    }
  });

  it("retries after pairing.required arrives after the initial pairing_required response", async () => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    servers.push(server);
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP listener.");
    let subscriptionRequestCount = 0;

    server.on("connection", (socket) => {
      socket.send(JSON.stringify({ type: "connect.challenge" }));
      socket.on("message", (raw) => {
        const frame = JSON.parse(raw.toString("utf-8")) as Record<string, unknown>;
        if (frame.type === "connect") {
          socket.send(JSON.stringify({ type: "hello-ok" }));
          return;
        }
        if (frame.type !== "req" || frame.method !== "coding.run.subscribe" || typeof frame.id !== "string") return;
        subscriptionRequestCount += 1;
        if (subscriptionRequestCount === 1) {
          socket.send(JSON.stringify({
            type: "res",
            id: frame.id,
            ok: false,
            error: { code: "pairing_required", message: "Pairing required." },
          }));
          setTimeout(() => {
            socket.send(JSON.stringify({
              type: "event",
              event: "pairing.required",
              payload: { code: "PAIR1234" },
            }));
          }, 0);
          return;
        }
        socket.send(JSON.stringify({
          type: "res",
          id: frame.id,
          ok: false,
          error: { code: "not_found", message: "Coding run event source was not found." },
        }));
      });
    });

    const session = new GatewayCodingRunSubscriptionSession("state-dir");
    try {
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(address.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        await expect(session.subscribe({
          subscription: {
            version: CODING_RUN_PROTOCOL_VERSION,
            binding: { conversationId: "conversation-1", agentRunId: "run-1" },
            cursor: 1,
          },
          onEvent: () => undefined,
          onInterrupted: () => undefined,
        })).resolves.toEqual({
          ok: false,
          error: { code: "not_found", message: "Coding run event source was not found." },
        });
      });
    } finally {
      session.close();
    }

    expect(approvePairingCodeMock).toHaveBeenCalledWith({ code: "PAIR1234", stateDir: "state-dir" });
    expect(subscriptionRequestCount).toBe(2);
  });
});
