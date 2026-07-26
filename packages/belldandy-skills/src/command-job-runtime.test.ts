import { describe, expect, it } from "vitest";

import { createCommandJobProcess } from "./command-job-runtime.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("createCommandJobProcess", () => {
  it("replays early output and preserves a UTF-8 code point split across runtime chunks", async () => {
    const jobProcess = await createCommandJobProcess({
      executable: process.execPath,
      args: [
        "-e",
        "process.stdout.write(Buffer.from([0xe4])); setTimeout(() => process.stdout.write(Buffer.from([0xbd, 0xa0])), 5);",
      ],
      cwd: process.cwd(),
      env: process.env,
      stdinMode: "closed",
    });

    // The manager may attach after a fast OCI CLI process has already emitted and exited.
    await delay(50);
    const output: string[] = [];
    jobProcess.onData((data) => output.push(data));
    const exit = await Promise.race([
      new Promise((resolve) => jobProcess.onExit(resolve)),
      delay(100).then(() => undefined),
    ]);

    expect(exit).toEqual({ exitCode: 0 });
    expect(output.join("")).toBe("你");
  });
});
