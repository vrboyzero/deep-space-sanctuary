import { describe, expect, it } from "vitest";

import {
  buildWorkspaceMutationResultMetadata,
  readWorkspaceMutationChangedPaths,
} from "./workspace-mutation-result.js";

describe("workspace mutation result metadata", () => {
  it("round-trips one versioned changed-path set", () => {
    const metadata = buildWorkspaceMutationResultMetadata([
      "jsonrpc/src/common/api.ts",
      "protocol/src/common/protocol.ts",
    ]);

    expect(metadata).toEqual({
      workspaceMutation: {
        schemaVersion: 1,
        changedPaths: [
          "jsonrpc/src/common/api.ts",
          "protocol/src/common/protocol.ts",
        ],
      },
    });
    expect(readWorkspaceMutationChangedPaths(metadata)).toEqual([
      "jsonrpc/src/common/api.ts",
      "protocol/src/common/protocol.ts",
    ]);
  });

  it.each([
    [undefined],
    [{}],
    [{ workspaceMutation: { schemaVersion: 2, changedPaths: ["src/api.ts"] } }],
    [{ workspaceMutation: { schemaVersion: 1, changedPaths: [] } }],
    [{ workspaceMutation: { schemaVersion: 1, changedPaths: ["src/api.ts", "src/api.ts"] } }],
    [{ workspaceMutation: { schemaVersion: 1, changedPaths: ["../api.ts"] } }],
  ])("rejects malformed metadata %#", (metadata) => {
    expect(readWorkspaceMutationChangedPaths(metadata)).toBeUndefined();
  });
});
