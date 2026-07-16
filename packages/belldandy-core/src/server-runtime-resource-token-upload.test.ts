import fs from "node:fs";

import { describe, expect, it } from "vitest";

const serverSource = fs.readFileSync(new URL("./server.ts", import.meta.url), "utf8");

describe("Gateway runtime resource wiring", () => {
  it("registers the token usage upload queue as a bounded B02 resource provider", () => {
    expect(serverSource).toContain("getTokenUsageUploadRuntimeSnapshot");
    expect(serverSource).toMatch(/\(\) => \[getTokenUsageUploadRuntimeSnapshot\(\)\]/);
  });
});
