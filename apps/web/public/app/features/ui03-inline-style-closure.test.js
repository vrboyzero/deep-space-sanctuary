import fs from "node:fs";

import { describe, expect, it } from "vitest";

const indexHtml = fs.readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

describe("UI03 inline style closure", () => {
  it("keeps the production shell free of inline style, style block, and inline script surfaces", () => {
    expect(indexHtml.match(/\sstyle\s*=/gi) ?? []).toHaveLength(0);
    expect(indexHtml.match(/<style(?:\s|>)/gi) ?? []).toHaveLength(0);
    expect(indexHtml.match(/<script(?![^>]*\bsrc\s*=)[^>]*>/gi) ?? []).toHaveLength(0);
  });

  it("moves the former static layout rules into the named stylesheet contract", () => {
    for (const className of [
      "form-checkbox",
      "button-primary",
      "settings-subsection-header--spaced",
      "modal-header-content",
      "settings-inline-actions",
      "doctor-status-list",
    ]) {
      expect(indexHtml).toContain(className);
      expect(styles).toContain(`.${className}`);
    }
  });
});
