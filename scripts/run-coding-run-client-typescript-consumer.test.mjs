import { describe, expect, it } from "vitest";

import { runCodingRunClientTypeScriptConsumer } from "./run-coding-run-client-typescript-consumer.mjs";

describe("coding-run client packed TypeScript consumer", () => {
  it("compiles the packed declarations under strict NodeNext and runs the lifecycle", async () => {
    const result = await runCodingRunClientTypeScriptConsumer();
    expect(result).toMatchObject({
      schemaVersion: "coding-run-client-typescript-consumer/v1",
      consumer: "packed-core-typescript-nodenext",
      compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext", strict: true },
      protocolVersion: "v1",
      compatibility: {
        currentProtocolVersion: "v1",
        previousProtocolVersion: null,
        previousVersionGate: "not_applicable_initial_version",
      },
      operations: ["start", "subscribe", "respond_allow", "respond_deny", "cancel", "read_artifact", "close"],
      contentMode: "none",
      checkedErrorCode: "request_timeout",
      temporaryRootRemoved: true,
    });
  }, 60_000);
});
