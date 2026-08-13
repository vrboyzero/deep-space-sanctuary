import { describe, expect, it } from "vitest";

import { runCodingRunClientExternalConsumer } from "./run-coding-run-client-external-consumer.mjs";

describe("coding-run client packed external consumer", () => {
  it("loads the narrow package subpath from a temporary packed consumer root", async () => {
    const result = await runCodingRunClientExternalConsumer();
    expect(result).toMatchObject({
      schemaVersion: "coding-run-client-external-consumer/v1",
      consumer: "packed-core-self-reference",
      protocolVersion: "v1",
      compatibility: {
        currentProtocolVersion: "v1",
        previousProtocolVersion: null,
        previousVersionGate: "not_applicable_initial_version",
      },
      operations: ["start", "subscribe", "respond_allow", "respond_deny", "cancel", "read_artifact", "close"],
      contentMode: "none",
      temporaryRootRemoved: true,
    });
  }, 20_000);
});
