import { defineCommand } from "citty";

import { runCodingRunStdio } from "../../../coding-run/stdio-process.js";
import { createCLIContext } from "../../shared/context.js";

function writeProcessStream(stream: NodeJS.WriteStream, line: string): Promise<void> {
  if (stream.write(line)) return Promise.resolve();
  return new Promise((resolve) => stream.once("drain", resolve));
}

export default defineCommand({
  meta: { name: "stdio", description: "Run the coding-run NDJSON stdio bridge" },
  args: {
    "state-dir": { type: "string", description: "Override state directory" },
  },
  async run({ args }) {
    const ctx = createCLIContext({ stateDir: args["state-dir"] });
    process.exitCode = await runCodingRunStdio({
      stateDir: ctx.stateDir,
      input: process.stdin,
      writeStdout: (line) => writeProcessStream(process.stdout, line),
      writeStderr: (line) => writeProcessStream(process.stderr, line),
    });
  },
});
