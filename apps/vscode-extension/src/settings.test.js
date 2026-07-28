import { createRequire } from "node:module";
import path from "node:path";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  resolveCodingRunCommand,
  resolveCodingRunStateDir,
} = require("./settings.cjs");

describe("VS Code coding-run settings", () => {
  it("falls back to the conservative command when configuration is missing or invalid", () => {
    expect(resolveCodingRunCommand(undefined)).toBe("bdd");
    expect(resolveCodingRunCommand("  ")).toBe("bdd");
    expect(resolveCodingRunCommand("bdd\n--unsafe")).toBe("bdd");
    expect(resolveCodingRunCommand("C:\\Tools\\bdd.cmd")).toBe("C:\\Tools\\bdd.cmd");
  });

  it("ignores missing, relative, and control-character state directories", () => {
    const absoluteStateDir = path.join(path.parse(process.cwd()).root, "state-dir");
    expect(resolveCodingRunStateDir(undefined)).toBeUndefined();
    expect(resolveCodingRunStateDir("relative-state")).toBeUndefined();
    expect(resolveCodingRunStateDir("C:\\state\ninvalid")).toBeUndefined();
    expect(resolveCodingRunStateDir(absoluteStateDir)).toBe(absoluteStateDir);
  });
});
