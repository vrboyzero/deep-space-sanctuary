import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeGatewayMethodMock = vi.hoisted(() => vi.fn());

vi.mock("../../shared/gateway-rpc.js", () => ({
  invokeGatewayMethod: invokeGatewayMethodMock,
}));

import { createMarketplaceExtensionRuntimeCoordinator } from "./shared.js";

describe("Marketplace extension runtime coordinator", () => {
  beforeEach(() => {
    invokeGatewayMethodMock.mockReset();
  });

  it("calls the pairing-protected revoke RPC and validates its bound result", async () => {
    invokeGatewayMethodMock.mockImplementation(async (input) => ({
      ok: true,
      payload: input.parsePayload({
        revoked: true,
        extensionId: "demo-plugin@official-market",
        operation: "update",
      }),
      paired: true,
      wsUrl: "ws://127.0.0.1:28889",
    }));
    const coordinator = createMarketplaceExtensionRuntimeCoordinator("C:\\state");

    await expect(coordinator.revokeForMutation({
      extensionId: "demo-plugin@official-market",
      operation: "update",
    })).resolves.toBeUndefined();

    expect(invokeGatewayMethodMock).toHaveBeenCalledWith(expect.objectContaining({
      stateDir: "C:\\state",
      method: "extension.runtime.revoke",
      params: {
        extensionId: "demo-plugin@official-market",
        operation: "update",
      },
      timeoutMs: 15_000,
    }));
    const invocation = invokeGatewayMethodMock.mock.calls[0][0];
    expect(() => invocation.parsePayload({
      revoked: true,
      extensionId: "other-plugin@official-market",
      operation: "update",
    })).toThrow(/invalid extension runtime revoke result/i);
  });

  it("fails closed when the Gateway cannot revoke the active runtime", async () => {
    invokeGatewayMethodMock.mockResolvedValue({
      ok: false,
      error: "Extension runtime Supervisor is unavailable.",
      errorCode: "runtime_unavailable",
      paired: true,
      wsUrl: "ws://127.0.0.1:28889",
    });
    const coordinator = createMarketplaceExtensionRuntimeCoordinator("C:\\state");

    await expect(coordinator.revokeForMutation({
      extensionId: "demo-plugin@official-market",
      operation: "disable",
    })).rejects.toThrow(/runtime Supervisor is unavailable/i);
  });
});
