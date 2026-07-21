import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("memory idle summary gateway wiring", () => {
  it("keeps timer and active-agent policy out of gateway-main", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "packages/belldandy-core/src/bin/gateway-main.ts"),
      "utf8",
    );

    expect(source).toContain("startMemoryIdleSummaryRuntime({");
    expect(source).toContain("memoryIdleSummaryRuntime.onAgentStart()");
    expect(source).toContain("memoryIdleSummaryRuntime.onAgentEnd()");
    expect(source).not.toContain("let activeAgentCount = 0");
    expect(source).not.toContain("let idleSummaryTimer");
    expect(source).not.toContain("mm.runIdleSummaries()");
  });
});
