// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createMemoryDetailPathListenerLifecycle } from "./memory-detail-path-listener-lifecycle.js";

afterEach(() => {
  document.body.replaceChildren();
});

describe("memory detail path listener lifecycle", () => {
  it("releases a retained path button listener on dispose", () => {
    const container = document.createElement("div");
    container.innerHTML = '<button data-open-source="C:/workspace/source.md">Open source</button>';
    const pathButton = container.querySelector("button");
    const openSourcePath = vi.fn().mockResolvedValue(undefined);
    const lifecycle = createMemoryDetailPathListenerLifecycle({ openSourcePath });

    lifecycle.bindMemoryPathLinks(container);
    expect(lifecycle.getRuntimeSnapshot().retainedMemoryPathListenerCount).toBe(1);

    expect(lifecycle.dispose()).toBe(true);
    expect(lifecycle.dispose()).toBe(false);
    expect(lifecycle.activate()).toBe(false);
    pathButton.click();

    expect(openSourcePath).not.toHaveBeenCalled();
    expect(lifecycle.getRuntimeSnapshot()).toEqual({
      disposed: true,
      retainedMemoryPathListenerCount: 0,
    });
  });

  it("owns path and line forwarding across activation cycles", async () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <button data-open-source="C:/workspace/first.md" data-open-line="42">First</button>
      <button data-open-source="C:/workspace/second.md">Second</button>
    `;
    const openSourcePath = vi.fn().mockResolvedValue(undefined);
    const lifecycle = createMemoryDetailPathListenerLifecycle({ openSourcePath });
    const firstButton = container.querySelector("[data-open-line]");
    const addListenerSpy = vi.spyOn(firstButton, "addEventListener");

    lifecycle.bindMemoryPathLinks(container);
    const retainedListener = addListenerSpy.mock.calls.find(([type]) => type === "click")?.[1];
    firstButton.click();
    container.querySelector("[data-open-source='C:/workspace/second.md']").click();
    await Promise.resolve();

    expect(openSourcePath).toHaveBeenCalledWith("C:/workspace/first.md", { startLine: 42 });
    expect(openSourcePath).toHaveBeenCalledWith("C:/workspace/second.md", { startLine: undefined });
    expect(lifecycle.getRuntimeSnapshot().retainedMemoryPathListenerCount).toBe(2);

    lifecycle.bindMemoryPathLinks(container);
    container.querySelector("[data-open-line]").click();
    await Promise.resolve();
    expect(openSourcePath).toHaveBeenCalledTimes(3);
    expect(lifecycle.getRuntimeSnapshot().retainedMemoryPathListenerCount).toBe(2);

    openSourcePath.mockClear();
    expect(lifecycle.deactivate()).toBe(true);
    expect(lifecycle.deactivate()).toBe(false);
    firstButton.click();
    await retainedListener?.({ type: "click" });
    expect(openSourcePath).not.toHaveBeenCalled();
    expect(lifecycle.getRuntimeSnapshot()).toEqual({
      disposed: false,
      retainedMemoryPathListenerCount: 0,
    });

    const addCallCount = addListenerSpy.mock.calls.length;
    lifecycle.bindMemoryPathLinks(container);
    expect(addListenerSpy).toHaveBeenCalledTimes(addCallCount);
    expect(lifecycle.activate()).toBe(true);
    lifecycle.bindMemoryPathLinks(container);
    firstButton.click();
    await Promise.resolve();
    expect(openSourcePath).toHaveBeenCalledWith("C:/workspace/first.md", { startLine: 42 });
    expect(lifecycle.getRuntimeSnapshot().retainedMemoryPathListenerCount).toBe(2);
  });
});
