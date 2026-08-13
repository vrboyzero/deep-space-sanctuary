import fs from "node:fs";

import { describe, expect, it } from "vitest";

describe("Gateway SubTask Supervisor budget wiring", () => {
  it("reuses global run limits and keeps verifier and cost budgets explicit", () => {
    const source = fs.readFileSync(new URL("./bin/gateway-main.ts", import.meta.url), "utf8");

    expect(source).toContain('readEnv("BELLDANDY_SUB_AGENT_MAX_VERIFIERS")');
    expect(source).toContain('readEnv("BELLDANDY_SUB_AGENT_MAX_COST_USD")');
    expect(source).toContain("maxVerifierChildren: subAgentMaxVerifiers");
    expect(source).toContain("maxWallTimeMs: Math.min(subAgentTimeoutMs, maxRunWallTimeMs)");
    expect(source).toContain("toolLoopIterationBudget,");
    expect(source).toContain("maxTotalTokens,");
    expect(source).toContain("maxCostUsd: subAgentMaxCostUsd");
    expect(source).toContain("maxHighRiskToolCalls,");
  });
});
