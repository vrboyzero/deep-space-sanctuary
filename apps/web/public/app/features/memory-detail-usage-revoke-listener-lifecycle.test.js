// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createMemoryDetailUsageRevokeListenerLifecycle } from "./memory-detail-usage-revoke-listener-lifecycle.js";

function createFixture(state = { pendingUsageRevokeId: null }) {
  const dependencies = {
    getState: () => state,
    confirmAction: vi.fn(() => true),
    revokeTaskUsage: vi.fn().mockResolvedValue(undefined),
    t: (_key, _params, fallback) => fallback || "",
  };
  return {
    dependencies,
    lifecycle: createMemoryDetailUsageRevokeListenerLifecycle(dependencies),
    state,
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("memory detail usage revoke listener lifecycle", () => {
  it("releases a retained revoke button listener on dispose", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <button data-revoke-usage-id="usage-1" data-revoke-task-id="task-1" data-revoke-asset-key="skill-demo">Revoke</button>
    `;
    const revokeButton = container.querySelector("button");
    const { dependencies, lifecycle } = createFixture();

    lifecycle.bindTaskUsageRevokeButtons(container, "task-1");
    expect(lifecycle.getRuntimeSnapshot().retainedUsageRevokeButtonListenerCount).toBe(1);

    lifecycle.dispose();
    revokeButton.click();

    expect(dependencies.confirmAction).not.toHaveBeenCalled();
    expect(dependencies.revokeTaskUsage).not.toHaveBeenCalled();
    expect(lifecycle.getRuntimeSnapshot()).toEqual({
      disposed: true,
      retainedUsageRevokeButtonListenerCount: 0,
    });
  });

  it("preserves busy, confirm, parameter, and repeated binding behavior", async () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <button data-revoke-usage-id="usage-1" data-revoke-task-id="task-1" data-revoke-asset-key="skill-demo">Revoke</button>
    `;
    const revokeButton = container.querySelector("button");
    const { dependencies, lifecycle, state } = createFixture();

    lifecycle.bindTaskUsageRevokeButtons(container, "fallback-task");
    state.pendingUsageRevokeId = "usage-busy";
    revokeButton.click();
    expect(dependencies.confirmAction).not.toHaveBeenCalled();

    state.pendingUsageRevokeId = null;
    dependencies.confirmAction.mockReturnValueOnce(false);
    revokeButton.click();
    expect(dependencies.revokeTaskUsage).not.toHaveBeenCalled();

    dependencies.confirmAction.mockReturnValue(true);
    revokeButton.click();
    await Promise.resolve();
    expect(dependencies.confirmAction).toHaveBeenCalledWith(
      "Confirm revoking this usage record?\n\nskill-demo",
    );
    expect(dependencies.revokeTaskUsage).toHaveBeenCalledWith("usage-1", "task-1", "skill-demo");
    expect(lifecycle.getRuntimeSnapshot().retainedUsageRevokeButtonListenerCount).toBe(1);

    lifecycle.bindTaskUsageRevokeButtons(container, "fallback-task");
    revokeButton.click();
    await Promise.resolve();
    expect(dependencies.revokeTaskUsage).toHaveBeenCalledTimes(2);
    expect(lifecycle.getRuntimeSnapshot().retainedUsageRevokeButtonListenerCount).toBe(1);
  });
});
