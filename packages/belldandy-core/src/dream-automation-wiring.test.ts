import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("dream automation gateway wiring", () => {
  it("forwards finalized source events without waiting inside the source claim", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "packages/belldandy-core/src/bin/gateway-main.ts"),
      "utf8",
    );

    expect(source).toContain("runCoordinator: backgroundRunCoordinator");
    expect(source).toContain("void dreamAutomationRuntime.handleHeartbeatEvent(event)");
    expect(source).toContain("void dreamAutomationRuntime.handleCronEvent(event)");
    expect(source).not.toContain("await dreamAutomationRuntime.handleHeartbeatEvent(event)");
    expect(source).not.toContain("await dreamAutomationRuntime.handleCronEvent(event)");
  });
});
