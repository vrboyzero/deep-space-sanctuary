import { describe, expect, it } from "vitest";

import { normalizeConfiguredMemorySourcesInput } from "./memory-configured-sources-store.js";

describe("memory configured sources store", () => {
  it("accepts valid searchPolicy values", () => {
    const result = normalizeConfiguredMemorySourcesInput([{
      label: "Obsidian Vault",
      sourceClass: "curated",
      searchPolicy: "searchable",
      rootPath: "E:/vault",
      fileExtensions: [".md"],
    }]);
    expect("error" in result).toBe(false);
    if ("error" in result) {
      throw new Error(result.error);
    }
    expect(result.sources[0]).toMatchObject({
      label: "Obsidian Vault",
      searchPolicy: "searchable",
    });
  });

  it("rejects invalid searchPolicy values", () => {
    const result = normalizeConfiguredMemorySourcesInput([{
      label: "Obsidian Vault",
      sourceClass: "curated",
      searchPolicy: "invalid-policy",
      rootPath: "E:/vault",
    }]);
    expect(result).toMatchObject({
      error: expect.stringContaining("searchPolicy"),
    });
  });
});
