import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const approvePairing = vi.hoisted(() => vi.fn());
vi.mock("../../security/store.js", () => ({ approvePairingCode: approvePairing }));
const sockets: FakeSocket[] = [];
class FakeSocket extends EventEmitter {
  sent: Array<Record<string, any>> = [];
  constructor() { super(); sockets.push(this); }
  send(text: string) { this.sent.push(JSON.parse(text)); }
  close() { this.emit("close"); }
  receive(frame: Record<string, unknown>) { this.emit("message", Buffer.from(JSON.stringify(frame))); }
}
vi.mock("ws", () => ({ default: FakeSocket }));

import { invokeGatewayMethod } from "./gateway-rpc.js";

beforeEach(() => { vi.useFakeTimers(); sockets.length = 0; approvePairing.mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

async function begin() {
  const result = invokeGatewayMethod({ stateDir: "/test/state", method: "coding.run.control",
    params: { operation: "permission.respond" }, requestIdPrefix: "test-permission", parsePayload: (payload) => payload });
  await vi.waitFor(() => expect(sockets).toHaveLength(1));
  const socket = sockets[0];
  socket.receive({ type: "hello-ok" });
  return { socket, result };
}
const required = { type: "event", event: "pairing.required", payload: { code: "fixture-code" } };
const requests = (socket: FakeSocket) => socket.sent.filter((frame) => frame.type === "req");

describe("Gateway RPC pairing ordering", () => {
  it("waits for pairing approval before the handshake timer can dispatch a mutation", async () => {
    let completeApproval!: (value: { ok: true }) => void;
    approvePairing.mockImplementation(() => new Promise((resolve) => { completeApproval = resolve; }));
    const { socket, result } = await begin();
    socket.receive(required);
    await vi.advanceTimersByTimeAsync(25);
    const beforeApproval = requests(socket).length;
    completeApproval({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    for (const request of requests(socket)) socket.receive({ type: "res", id: request.id, ok: true, payload: { accepted: true } });
    expect(await result).toMatchObject({ ok: true, payload: { accepted: true } });
    expect(beforeApproval).toBe(0);
    expect(requests(socket)).toHaveLength(1);
  });

  it("retains the first in-flight response when a late pairing event finishes", async () => {
    approvePairing.mockResolvedValue({ ok: true });
    const { socket, result } = await begin();
    await vi.advanceTimersByTimeAsync(25);
    const first = requests(socket)[0];
    socket.receive(required);
    await vi.advanceTimersByTimeAsync(0);
    const sentCount = requests(socket).length;
    socket.receive({ type: "res", id: first.id, ok: true, payload: { accepted: true, alreadyResolved: false } });
    for (const request of requests(socket).slice(1)) socket.receive({ type: "res", id: request.id, ok: true,
      payload: { accepted: true, alreadyResolved: true } });
    expect(await result).toMatchObject({ ok: true, payload: { alreadyResolved: false } });
    expect(sentCount).toBe(1);
  });

  it.each([true, false])("retries once after an explicit pairing rejection (approvalFirst=%s)", async (approvalFirst) => {
    approvePairing.mockResolvedValue({ ok: true });
    const { socket, result } = await begin();
    await vi.advanceTimersByTimeAsync(25);
    const first = requests(socket)[0];
    if (approvalFirst) { socket.receive(required); await vi.advanceTimersByTimeAsync(0); }
    socket.receive({ type: "res", id: first.id, ok: false, error: { code: "pairing_required" } });
    if (!approvalFirst) { socket.receive(required); await vi.advanceTimersByTimeAsync(0); }
    const second = requests(socket)[1];
    if (second) socket.receive({ type: "res", id: second.id, ok: true, payload: { accepted: true } });
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toMatchObject({ ok: true, payload: { accepted: true } });
    expect(requests(socket)).toHaveLength(2);
  });

  it("coalesces duplicate pairing events and fails closed after a rejected retry", async () => {
    let completeApproval!: (value: { ok: true }) => void;
    approvePairing.mockImplementation(() => new Promise((resolve) => { completeApproval = resolve; }));
    const { socket, result } = await begin();
    await vi.advanceTimersByTimeAsync(25);
    socket.receive(required);
    socket.receive(required);
    socket.receive({ type: "res", id: requests(socket)[0].id, ok: false, error: { code: "pairing_required" } });
    completeApproval({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    const second = requests(socket)[1];
    socket.receive({ type: "res", id: second.id, ok: false, error: { code: "pairing_required" } });
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toMatchObject({ ok: false, errorCode: "pairing_required" });
    expect(approvePairing).toHaveBeenCalledTimes(1);
    expect(requests(socket)).toHaveLength(2);
  });
});
