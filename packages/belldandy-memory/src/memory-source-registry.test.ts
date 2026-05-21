import { describe, expect, it } from "vitest";

import {
  classifyMemorySource,
  resolveMemorySourceAdmission,
  resolveMemorySourceIdentity,
} from "./memory-source-registry.js";

describe("memory source registry", () => {
  it("classifies session-derived files and resolves default admission policies", () => {
    const digest = classifyMemorySource("E:/state/sessions/conv-1.digest.json", "file");
    expect(digest).toMatchObject({
      sourceKind: "session_digest",
      sourceClass: "derived",
      builtinInventoryId: "builtin:sessions:digest",
    });

    const admission = resolveMemorySourceAdmission({
      sourceKind: digest.sourceKind,
      sourceClass: digest.sourceClass,
    });
    expect(admission).toMatchObject({
      searchPolicy: "summary-input-only",
      dedupPolicy: "derived-overlay",
      retentionHint: "refresh-from-source",
      explicit: false,
    });
  });

  it("lets configured sources override the default search policy", () => {
    const admission = resolveMemorySourceAdmission({
      sourceKind: "configured_external",
      sourceClass: "curated",
      storage: "external",
      configuredSearchPolicy: "searchable",
    });
    expect(admission).toMatchObject({
      searchPolicy: "searchable",
      explicit: true,
    });
    expect(admission.rationale).toContain("configured source");
  });

  it("builds shared family keys for sibling session artifacts", () => {
    const raw = resolveMemorySourceIdentity({
      id: "builtin:sessions:messages",
      sourceKind: "session_messages",
      sourceClass: "raw",
      scope: "private",
      sourcePath: "E:/state/sessions/conv-2.jsonl",
      builtinInventoryId: "builtin:sessions:messages",
      updatedAt: "2026-05-21T10:00:00.000Z",
    });
    const digest = resolveMemorySourceIdentity({
      id: "builtin:sessions:digest",
      sourceKind: "session_digest",
      sourceClass: "derived",
      scope: "private",
      sourcePath: "E:/state/sessions/conv-2.digest.json",
      builtinInventoryId: "builtin:sessions:digest",
      updatedAt: "2026-05-21T10:05:00.000Z",
    });

    expect(raw.sourceFamilyKey).toBe("session:e:/state/sessions/conv-2");
    expect(digest.sourceFamilyKey).toBe(raw.sourceFamilyKey);
    expect(digest.revisionHint).toBe("2026-05-21T10:05:00.000Z");
  });
});
