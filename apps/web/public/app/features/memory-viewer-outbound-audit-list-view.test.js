// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createMemoryViewerOutboundAuditListView } from "./memory-viewer-outbound-audit-list-view.js";

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
      if (value) throw new Error("Memory Viewer outbound audit list must not use innerHTML");
      innerHtmlDescriptor.set.call(this, value);
    },
  });
}

describe("Memory Viewer outbound audit list DOM owner", () => {
  it("renders organizer and audit rows with pagination without an HTML parser", () => {
    const container = document.createElement("div");
    document.body.append(container);
    blockNonEmptyInnerHtml(container);
    const view = createMemoryViewerOutboundAuditListView();
    const organizerId = 'email_thread_organizer:thread"><img src=x onerror=alert(1)>';

    expect(() => view.render({
      container,
      rows: [
        {
          id: organizerId,
          isActive: true,
          title: "<script>alert(2)</script>Organizer",
          meta: [
            "<svg onload=alert(3)>2026-07-21",
            "<iframe srcdoc='<script>alert(4)</script>'>sender",
            "needs reply",
          ],
          snippet: "<img src=x onerror=alert(5)>Organizer summary",
        },
        {
          id: "channel:req-2",
          isActive: false,
          title: "<math><mtext>Channel / confirmed</mtext></math>",
          meta: ["2026-07-20", "req-2", "<object data=x>agent-2"],
          snippet: "<img src=x onerror=alert(6)>Audit preview",
        },
      ],
      pagination: {
        summary: "<img src=x onerror=alert(7)>Showing 1-20 / 21",
        previousLabel: "< Prev",
        nextLabel: "Next >",
        previousDisabled: true,
        nextDisabled: false,
      },
    })).not.toThrow();

    const rows = [...container.querySelectorAll("[data-outbound-audit-id]")];
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.getAttribute("data-outbound-audit-id"))).toEqual([organizerId, "channel:req-2"]);
    expect(rows.map((row) => row.className)).toEqual(["memory-list-item active", "memory-list-item"]);
    expect(rows.map((row) => row.querySelector(".memory-list-item-title")?.textContent)).toEqual([
      "<script>alert(2)</script>Organizer",
      "<math><mtext>Channel / confirmed</mtext></math>",
    ]);
    expect([...rows[0]?.querySelectorAll(".memory-list-item-meta span") ?? []].map((node) => node.textContent)).toEqual([
      "<svg onload=alert(3)>2026-07-21",
      "<iframe srcdoc='<script>alert(4)</script>'>sender",
      "needs reply",
    ]);
    expect(rows.map((row) => row.querySelector(".memory-list-item-snippet")?.textContent)).toEqual([
      "<img src=x onerror=alert(5)>Organizer summary",
      "<img src=x onerror=alert(6)>Audit preview",
    ]);

    const buttons = [...container.querySelectorAll("[data-memory-list-page-action]")];
    expect(buttons.map((button) => button.getAttribute("data-memory-list-page-action"))).toEqual(["prev", "next"]);
    expect(buttons.map((button) => ({ text: button.textContent, disabled: button.disabled }))).toEqual([
      { text: "< Prev", disabled: true },
      { text: "Next >", disabled: false },
    ]);
    expect(container.querySelector("img, script, svg, iframe, math, object, [onerror], [onload]")).toBeNull();
  });

  it("omits single-page pagination, replaces prior content, and treats a missing root as a no-op", () => {
    const container = document.createElement("div");
    const view = createMemoryViewerOutboundAuditListView();
    view.render({
      container,
      rows: [{ id: "audit-1", isActive: false, title: "First", meta: [], snippet: "Summary" }],
      pagination: {
        summary: "Showing 1-20 / 21",
        previousLabel: "Prev",
        nextLabel: "Next",
        previousDisabled: true,
        nextDisabled: false,
      },
    });
    const previousRow = container.querySelector("[data-outbound-audit-id]");

    view.render({
      container,
      rows: [{ id: "audit-2", isActive: true, title: "Second", meta: [], snippet: "Updated" }],
      pagination: null,
    });

    expect(previousRow?.isConnected).toBe(false);
    expect(container.querySelectorAll("[data-outbound-audit-id]")).toHaveLength(1);
    expect(container.querySelector("[data-outbound-audit-id]")?.getAttribute("data-outbound-audit-id")).toBe("audit-2");
    expect(container.querySelector(".memory-list-pagination")).toBeNull();
    expect(() => view.render({ container: null, rows: [], pagination: null })).not.toThrow();
  });

  it("owns only the outbound-audit list sink without retaining the legacy pagination producer", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "apps/web/public/app/features/memory-viewer.js"),
      "utf8",
    );
    const outboundListStart = source.indexOf("function renderExternalOutboundAuditList(items)");
    const outboundListEnd = source.indexOf("function renderExternalOutboundAuditDetail", outboundListStart);
    const outboundListSource = source.slice(outboundListStart, outboundListEnd);

    expect(source).toContain('import { createMemoryViewerOutboundAuditListView }');
    expect(source).toContain("const outboundAuditListView = createMemoryViewerOutboundAuditListView();");
    expect(outboundListSource).not.toContain("memoryViewerListEl.innerHTML");
    expect(outboundListSource).toContain("outboundAuditListView.render({");
    expect(source).not.toContain("function renderMemoryViewerPaginationFooter");
    expect(source).toContain("function renderSharedReviewList(items)");
  });
});
