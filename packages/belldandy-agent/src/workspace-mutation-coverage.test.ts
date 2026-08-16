import { describe, expect, it } from "vitest";

import {
  createWorkspaceMutationPathCoverage,
  hasOnlyWorkspaceMutationChangedPaths,
} from "./workspace-mutation-coverage.js";

describe("workspace mutation path coverage", () => {
  it("accumulates trusted required paths across successful mutations", () => {
    const coverage = createWorkspaceMutationPathCoverage(["src/api.ts", "src/protocol.ts"]);

    expect(coverage.observeSuccessfulMutation(metadata(["src/api.ts"]))).toBe(false);
    expect(coverage.missingPaths()).toEqual(["src/protocol.ts"]);
    expect(coverage.observeSuccessfulMutation(metadata(["src/protocol.ts"]))).toBe(true);
    expect(coverage.missingPaths()).toEqual([]);
  });

  it("accepts only trusted metadata paths inside the allowed continuation scope", () => {
    expect(hasOnlyWorkspaceMutationChangedPaths(
      metadata(["SRC/PROTOCOL.TS"]),
      ["src/protocol.ts"],
    )).toBe(true);
    expect(hasOnlyWorkspaceMutationChangedPaths(
      metadata(["src/protocol.ts", "src/api.ts"]),
      ["src/protocol.ts"],
    )).toBe(false);
    expect(hasOnlyWorkspaceMutationChangedPaths(undefined, ["src/protocol.ts"])).toBe(false);
  });
});

function metadata(changedPaths: string[]) {
  return { workspaceMutation: { schemaVersion: 1, changedPaths } };
}
