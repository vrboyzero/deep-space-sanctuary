import fs from "node:fs";

import { describe, expect, it } from "vitest";

describe("Gateway workflow runtime wiring", () => {
  it("initializes the workflow runtime only after scoped memory managers exist", () => {
    const source = fs.readFileSync(new URL("./bin/gateway-main.ts", import.meta.url), "utf8");
    const memoryInitialization = source.indexOf("const scopedMemoryManagers = createScopedMemoryManagers({");
    const workflowInitialization = source.indexOf("const workflowMemoryManager = scopedMemoryManagers.defaultManager;");

    expect(memoryInitialization).toBeGreaterThanOrEqual(0);
    expect(workflowInitialization).toBeGreaterThan(memoryInitialization);
    expect(source.match(/toolExecutor\.registerTool\(runWorkflowTool/g)).toHaveLength(1);
    expect(source).not.toContain("WorkflowRuntime skipped (memory manager not available)");
  });
});
