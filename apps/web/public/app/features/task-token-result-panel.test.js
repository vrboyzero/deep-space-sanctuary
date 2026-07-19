// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createTaskTokenResultPanelFeature } from "./task-token-result-panel.js";

function createFixture(options = {}) {
  document.body.innerHTML = `
    <div id="panel" style="display:flex"></div>
    <span id="name">old-name</span>
    <span id="input">old-input</span>
    <span id="output">old-output</span>
    <span id="total">old-total</span>
  `;
  const recordResult = vi.fn();
  const feature = createTaskTokenResultPanelFeature({
    enabled: options.enabled === true,
    panel: document.getElementById("panel"),
    valueElements: {
      taskName: document.getElementById("name"),
      taskIn: document.getElementById("input"),
      taskOut: document.getElementById("output"),
      taskTotal: document.getElementById("total"),
    },
    formatTokenCount: (value) => `${value}tok`,
    recordResult,
  });
  return {
    feature,
    panel: document.getElementById("panel"),
    recordResult,
    valueElements: {
      taskName: document.getElementById("name"),
      taskIn: document.getElementById("input"),
      taskOut: document.getElementById("output"),
      taskTotal: document.getElementById("total"),
    },
  };
}

const payload = {
  conversationId: "conversation-1",
  name: "task-1",
  inputTokens: 12,
  outputTokens: 8,
  totalTokens: 20,
};

describe("task token result panel lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("records history but keeps the disabled transient panel inert", () => {
    vi.useFakeTimers();
    const fixture = createFixture();

    fixture.feature.showTaskTokenResult(payload);

    expect(fixture.recordResult).toHaveBeenCalledWith(payload);
    expect(fixture.panel.style.display).toBe("none");
    expect(fixture.valueElements.taskName.textContent).toBe("old-name");
    expect(fixture.valueElements.taskIn.textContent).toBe("old-input");
    expect(fixture.feature.getRuntimeSnapshot()).toEqual({
      enabled: false,
      pendingTimerCount: 0,
      disposed: false,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves the enabled metric and auto-hide behavior behind the owner", async () => {
    vi.useFakeTimers();
    const fixture = createFixture({ enabled: true });

    fixture.feature.showTaskTokenResult(payload);

    expect(fixture.valueElements.taskName.textContent).toBe("task-1");
    expect(fixture.valueElements.taskIn.textContent).toBe("12tok");
    expect(fixture.valueElements.taskOut.textContent).toBe("8tok");
    expect(fixture.valueElements.taskTotal.textContent).toBe("20tok");
    expect(fixture.panel.style.display).toBe("flex");
    expect(fixture.feature.getRuntimeSnapshot().pendingTimerCount).toBe(1);

    await vi.advanceTimersByTimeAsync(8_000);

    expect(fixture.panel.style.display).toBe("none");
    expect(fixture.feature.getRuntimeSnapshot().pendingTimerCount).toBe(0);
  });

  it("clears its timer on dispose and ignores late results", () => {
    vi.useFakeTimers();
    const fixture = createFixture({ enabled: true });
    fixture.feature.showTaskTokenResult(payload);
    fixture.recordResult.mockClear();

    fixture.feature.dispose();
    fixture.feature.showTaskTokenResult({ ...payload, name: "late-task" });

    expect(fixture.panel.style.display).toBe("none");
    expect(fixture.recordResult).not.toHaveBeenCalled();
    expect(fixture.valueElements.taskName.textContent).toBe("task-1");
    expect(fixture.feature.getRuntimeSnapshot()).toEqual({
      enabled: true,
      pendingTimerCount: 0,
      disposed: true,
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
