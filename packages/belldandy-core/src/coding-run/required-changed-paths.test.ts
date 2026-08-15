import { describe, expect, it } from "vitest";

import {
  MAX_REQUIRED_CHANGED_PATHS,
  MAX_REQUIRED_CHANGED_PATH_LENGTH,
  parseRequiredChangedPaths,
} from "./required-changed-paths.js";

describe("parseRequiredChangedPaths", () => {
  it("normalizes one bounded workspace-relative path set", () => {
    expect(parseRequiredChangedPaths([
      "jsonrpc\\src\\common\\api.ts",
      "protocol/src/common/protocol.ts",
    ])).toEqual({
      ok: true,
      value: [
        "jsonrpc/src/common/api.ts",
        "protocol/src/common/protocol.ts",
      ],
    });
  });

  it.each([
    [[], "non-empty array"],
    [["src/api.ts", "src/api.ts"], "must not contain duplicates"],
    [["C:\\workspace\\src\\api.ts"], "workspace-relative"],
    [["/workspace/src/api.ts"], "workspace-relative"],
    [["src/../api.ts"], "must not contain . or .. segments"],
    [["src/\u0000api.ts"], "control characters"],
    [Array.from({ length: MAX_REQUIRED_CHANGED_PATHS + 1 }, (_, index) => `src/file-${index}.ts`), "at most"],
    [[`src/${"a".repeat(MAX_REQUIRED_CHANGED_PATH_LENGTH)}.ts`], "characters or fewer"],
  ])("rejects invalid path contracts %#", (value, message) => {
    expect(parseRequiredChangedPaths(value)).toMatchObject({
      ok: false,
      message: expect.stringContaining(message),
    });
  });
});
