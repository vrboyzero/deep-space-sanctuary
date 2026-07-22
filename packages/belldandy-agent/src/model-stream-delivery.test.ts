import { describe, expect, it } from "vitest";

import { createModelStreamTextDelivery } from "./model-stream-delivery.js";

describe("Model stream text delivery", () => {
  it("hides fragmented tool protocol blocks while preserving surrounding text", async () => {
    const delivery = createModelStreamTextDelivery({ flushIntervalMs: 1_000 });
    const deltasPromise = collect(delivery.deltas);

    expect(await delivery.push("Hello <|tool_ca")).toBe(true);
    expect(await delivery.push("ll_begin|>{\"secret\":true}")).toBe(false);
    expect(await delivery.push("<|tool_call_end|> world")).toBe(true);
    await delivery.complete();

    const deltas = await deltasPromise;
    expect(deltas.join("")).toBe("Hello  world");
    expect(delivery.getText()).toBe("Hello  world");
    expect(JSON.stringify(deltas)).not.toContain("secret");
  });

  it("coalesces later deltas at the configured character bound", async () => {
    const delivery = createModelStreamTextDelivery({
      flushIntervalMs: 1_000,
      maxBatchChars: 5,
    });
    const deltasPromise = collect(delivery.deltas);

    await delivery.push("A");
    await delivery.push("bc");
    await delivery.push("def");
    await delivery.complete();

    expect(await deltasPromise).toEqual(["A", "bcdef"]);
  });
});

async function collect(iterable: AsyncIterable<string>): Promise<string[]> {
  const items: string[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}
