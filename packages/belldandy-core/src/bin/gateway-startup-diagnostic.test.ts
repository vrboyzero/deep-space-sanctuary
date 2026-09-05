import { describe, expect, it, vi } from "vitest";

import { reportGatewayStartupPhase } from "./gateway-startup-diagnostic.js";

describe("Gateway startup diagnostic", () => {
  it("sends only the versioned phase when explicitly enabled over connected IPC", () => {
    const send = vi.fn((..._args: unknown[]) => true);
    reportGatewayStartupPhase("entry", {
      env: { BELLDANDY_GATEWAY_STARTUP_DIAGNOSTIC: "ipc-v1", BELLDANDY_AUTH_TOKEN: "must-not-send" },
      connected: true,
      send,
    });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toEqual({ type: "gateway.startup/v1", phase: "entry" });
    expect(JSON.stringify(send.mock.calls)).not.toContain("must-not-send");
  });

  it("does not emit in ordinary or disconnected Gateway processes", () => {
    const send = vi.fn((..._args: unknown[]) => true);
    reportGatewayStartupPhase("entry", { env: {}, connected: true, send });
    reportGatewayStartupPhase("entry", {
      env: { BELLDANDY_GATEWAY_STARTUP_DIAGNOSTIC: "true" }, connected: true, send,
    });
    reportGatewayStartupPhase("entry", {
      env: { BELLDANDY_GATEWAY_STARTUP_DIAGNOSTIC: "ipc-v1" }, connected: false, send,
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps diagnostic transport failure from failing Gateway startup", () => {
    expect(() => reportGatewayStartupPhase("entry", {
      env: { BELLDANDY_GATEWAY_STARTUP_DIAGNOSTIC: "ipc-v1" },
      connected: true,
      send: vi.fn(() => { throw new Error("IPC channel closed"); }),
    })).not.toThrow();
  });
});
