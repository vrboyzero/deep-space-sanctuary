import { describe, expect, it } from "vitest";

import { normalizeStableTopicAliasKey, resolveStableTopicAlias } from "./memory-tree-topic-aliases.js";

describe("memory tree topic aliases", () => {
  it("normalizes separators and strips generic suffix aliases to one canonical topic key", () => {
    expect(normalizeStableTopicAliasKey("Viewer Audit")).toBe("viewer-audit");
    expect(resolveStableTopicAlias("viewer_audit")).toMatchObject({
      normalizedKey: "viewer-audit",
      canonicalKey: "viewer-audit",
    });
    expect(resolveStableTopicAlias("viewer-audit-checklist")).toMatchObject({
      normalizedKey: "viewer-audit-checklist",
      canonicalKey: "viewer-audit",
    });
  });
});
