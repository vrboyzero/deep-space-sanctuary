import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("durable extraction scheduler wiring", () => {
  it("routes bounded durable jobs through the shared Memory scheduler", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "packages/belldandy-core/src/server.ts"),
      "utf8",
    );

    expect(source).toContain("acquireJob: ({ conversationId, estimatedTokenUnits, signal }) => {");
    expect(source).toContain('family: "durable_extraction"');
    expect(source).toContain('priority: "normal"');
    expect(source).toContain('BELLDANDY_MEMORY_DURABLE_EXTRACTION_MAX_INPUT_BYTES');
    expect(source).toContain('BELLDANDY_MEMORY_DURABLE_EXTRACTION_CLOSE_DEADLINE_MS');
  });
});
