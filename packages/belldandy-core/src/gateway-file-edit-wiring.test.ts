import fs from "node:fs";

import { describe, expect, it } from "vitest";

describe("Gateway builtin tool wiring", () => {
  it("exports file_edit and registers it as a deferred workspace-write tool", () => {
    const skillsIndex = fs.readFileSync(
      new URL("../../belldandy-skills/src/index.ts", import.meta.url),
      "utf8",
    );
    const source = fs.readFileSync(new URL("./bin/gateway-main.ts", import.meta.url), "utf8");
    const poolStart = source.indexOf("const gatewayToolPoolAssembler = new ToolPoolAssembler");
    const poolEnd = source.indexOf("const DELEGATION_TOOL_NAMES", poolStart);
    const coreNamesStart = source.indexOf("const CORE_TOOL_NAMES");
    const coreNamesEnd = source.indexOf("const deferredToolNames", coreNamesStart);

    expect(skillsIndex).toMatch(/export \{[^}]*fileEditTool[^}]*\} from "\.\/builtin\/file\.js";/s);
    expect(poolStart).toBeGreaterThanOrEqual(0);
    expect(poolEnd).toBeGreaterThan(poolStart);
    expect(source.slice(poolStart, poolEnd)).toContain("fileEditTool");
    expect(coreNamesStart).toBeGreaterThanOrEqual(0);
    expect(coreNamesEnd).toBeGreaterThan(coreNamesStart);
    expect(source.slice(coreNamesStart, coreNamesEnd)).not.toContain("fileEditTool");
    expect(source).toContain("apply_patch, file_read, file_edit, file_write");
  });

  it("exposes code_intel before broad workspace exploration tools", () => {
    const source = fs.readFileSync(new URL("./bin/gateway-main.ts", import.meta.url), "utf8");
    const poolStart = source.indexOf("const gatewayToolPoolAssembler = new ToolPoolAssembler");
    const poolEnd = source.indexOf("const DELEGATION_TOOL_NAMES", poolStart);
    const poolSource = source.slice(poolStart, poolEnd);
    const codeIntelIndex = poolSource.indexOf("codeIntelTool");

    expect(poolStart).toBeGreaterThanOrEqual(0);
    expect(poolEnd).toBeGreaterThan(poolStart);
    expect(codeIntelIndex).toBeGreaterThanOrEqual(0);
    for (const broadTool of ["fileReadTool", "listFilesTool", "textSearchTool", "fileGlobTool"]) {
      expect(codeIntelIndex, `codeIntelTool should precede ${broadTool}`)
        .toBeLessThan(poolSource.indexOf(broadTool));
    }
  });
});
