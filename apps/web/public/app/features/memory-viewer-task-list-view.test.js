// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createMemoryViewerTaskListView } from "./memory-viewer-task-list-view.js";

afterEach(() => {
  document.body.replaceChildren();
});

function blockNonEmptyInnerHtml(element) {
  const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  Object.defineProperty(element, "innerHTML", {
    configurable: true,
    get() {
      return innerHtmlDescriptor.get.call(this);
    },
    set(value) {
      if (value) throw new Error("Memory Viewer task list must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

describe("Memory Viewer task list DOM owner", () => {
  it("renders ordered task rows and pagination without an HTML parser", () => {
    const container = document.createElement("div");
    document.body.append(container);
    blockNonEmptyInnerHtml(container);
    const view = createMemoryViewerTaskListView();
    const taskId = 'task"><img src=x onerror=alert(1)>';

    expect(() => view.render({
      container,
      rows: [
        {
          id: taskId,
          isActive: true,
          title: "<script>alert(2)</script>Task",
          meta: [
            { text: "<svg onload=alert(3)>completed" },
            { text: "manual" },
            { text: "<img src=x onerror=alert(4)>Goal", kind: "shared" },
            { text: "2026-07-21" },
          ],
          snippet: "<iframe srcdoc='<script>alert(5)</script>'>summary",
        },
      ],
      pagination: {
        summary: "<img src=x onerror=alert(6)>Showing 1-20 / 21",
        previousLabel: "< Prev",
        nextLabel: "Next >",
        previousDisabled: true,
        nextDisabled: false,
      },
    })).not.toThrow();

    const item = container.querySelector("[data-task-id]");
    expect(item?.getAttribute("data-task-id")).toBe(taskId);
    expect(item?.className).toBe("memory-list-item active");
    expect(item?.querySelector(".memory-list-item-title")?.textContent).toBe("<script>alert(2)</script>Task");
    expect([...item?.querySelectorAll(".memory-list-item-meta span") ?? []].map((node) => ({
      text: node.textContent,
      className: node.className,
    }))).toEqual([
      { text: "<svg onload=alert(3)>completed", className: "" },
      { text: "manual", className: "" },
      { text: "<img src=x onerror=alert(4)>Goal", className: "memory-badge memory-badge-shared" },
      { text: "2026-07-21", className: "" },
    ]);
    expect(item?.querySelector(".memory-list-item-snippet")?.textContent)
      .toBe("<iframe srcdoc='<script>alert(5)</script>'>summary");

    const footer = container.querySelector(".memory-list-pagination");
    expect(footer?.querySelector(".memory-list-pagination-summary")?.textContent)
      .toBe("<img src=x onerror=alert(6)>Showing 1-20 / 21");
    const buttons = [...footer?.querySelectorAll("[data-memory-list-page-action]") ?? []];
    expect(buttons.map((button) => button.getAttribute("data-memory-list-page-action"))).toEqual(["prev", "next"]);
    expect(buttons.map((button) => ({ text: button.textContent, disabled: button.disabled }))).toEqual([
      { text: "< Prev", disabled: true },
      { text: "Next >", disabled: false },
    ]);
    expect(container.querySelector("img, script, svg, iframe, [onerror], [onload]")).toBeNull();
  });

  it("omits single-page pagination, replaces prior content, and treats a missing root as a no-op", () => {
    const container = document.createElement("div");
    const view = createMemoryViewerTaskListView();
    view.render({
      container,
      rows: [{ id: "task-1", isActive: false, title: "First", meta: [], snippet: "Summary" }],
      pagination: {
        summary: "Showing 1-20 / 21",
        previousLabel: "Prev",
        nextLabel: "Next",
        previousDisabled: true,
        nextDisabled: false,
      },
    });
    const previousRow = container.querySelector("[data-task-id]");

    view.render({
      container,
      rows: [{ id: "task-2", isActive: true, title: "Second", meta: [], snippet: "Updated" }],
      pagination: null,
    });

    expect(previousRow?.isConnected).toBe(false);
    expect(container.querySelectorAll("[data-task-id]")).toHaveLength(1);
    expect(container.querySelector("[data-task-id]")?.getAttribute("data-task-id")).toBe("task-2");
    expect(container.querySelector(".memory-list-pagination")).toBeNull();
    expect(() => view.render({ container: null, rows: [], pagination: null })).not.toThrow();
  });

  it("owns only the task-list sink without retaining the legacy pagination producer", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "apps/web/public/app/features/memory-viewer.js"),
      "utf8",
    );
    const taskListStart = source.indexOf("function renderTaskList(items)");
    const taskListEnd = source.indexOf("function setActiveMemoryViewerListItem", taskListStart);
    const taskListSource = source.slice(taskListStart, taskListEnd);

    expect(source).toContain('import { createMemoryViewerTaskListView }');
    expect(source).toContain("const taskListView = createMemoryViewerTaskListView();");
    expect(taskListSource).not.toContain("memoryViewerListEl.innerHTML");
    expect(taskListSource).toContain("taskListView.render({");
    expect(source).not.toContain("function renderMemoryViewerPaginationFooter");
  });
});
