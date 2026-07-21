import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

describe("workflow runtime owner inventory", () => {
  it("keeps controller, batch, and retry policies in adjacent owners", () => {
    const contextSource = readSource("packages/belldandy-core/src/workflow-context-impl.ts");
    const runtimeSource = readSource("packages/belldandy-core/src/workflow-runtime.ts");
    const retrySource = readSource("packages/belldandy-core/src/workflow-agent-call-runner.ts");
    const gatewaySource = readSource("packages/belldandy-core/src/bin/gateway-main.ts");

    expect(contextSource).toContain('from "./workflow-agent-call-runner.js"');
    expect(contextSource).toContain('from "./workflow-batch-runner.js"');
    expect(contextSource).not.toContain(".consumeRetry(");
    expect(contextSource).not.toContain("class Semaphore");

    expect(runtimeSource).toContain('from "./workflow-run-controller.js"');
    expect(runtimeSource).toContain('from "./workflow-batch-runner.js"');
    expect(runtimeSource).not.toContain(".consumeRetry(");
    expect(retrySource).toContain("options.budgetGuard.consumeRetry()");

    expect(gatewaySource).not.toContain("runWorkflowAgentCall");
    expect(gatewaySource).not.toContain("runWorkflowBatch");
    expect(gatewaySource).not.toContain("resolveWorkflowBatchLimits");
  });
});
