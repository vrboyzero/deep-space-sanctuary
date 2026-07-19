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

    lifecycle.dispose();
    pathButton.click();

    expect(openSourcePath).not.toHaveBeenCalled();
    expect(lifecycle.getRuntimeSnapshot()).toEqual({
      disposed: true,
      retainedMemoryPathListenerCount: 0,
    });
  });

  it("preserves path and line forwarding without listener duplication", async () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <button data-open-source="C:/workspace/first.md" data-open-line="42">First</button>
      <button data-open-source="C:/workspace/second.md">Second</button>
    `;
    const openSourcePath = vi.fn().mockResolvedValue(undefined);
    const lifecycle = createMemoryDetailPathListenerLifecycle({ openSourcePath });

    lifecycle.bindMemoryPathLinks(container);
    container.querySelector("[data-open-line]").click();
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
  });
});
