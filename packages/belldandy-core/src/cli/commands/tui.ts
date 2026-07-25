import path from "node:path";

import { defineCommand } from "citty";

import { CODING_RUN_EXIT_CODES } from "../../coding-run/contracts.js";
import { runCodingTui } from "../../tui/index.js";
import { createCLIContext } from "../shared/context.js";

type TuiRunner = typeof runCodingTui;

export async function runTuiCommand(input: {
  stateDir: string;
  cwd: string;
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  runTui?: TuiRunner;
  writeStderr?: (text: string) => void;
}): Promise<number> {
  const writeStderr = input.writeStderr ?? ((text) => { process.stderr.write(text); });
  if (!input.stdinIsTTY || !input.stdoutIsTTY) {
    writeStderr("bdd tui requires an interactive stdin and stdout.\n");
    return CODING_RUN_EXIT_CODES.invalidInput;
  }
  return (input.runTui ?? runCodingTui)({
    stateDir: path.resolve(input.stateDir),
    cwd: path.resolve(input.cwd),
  });
}

export default defineCommand({
  meta: { name: "tui", description: "Open the interactive Star Sanctuary coding workbench" },
  args: {
    "state-dir": { type: "string", description: "Override state directory" },
    cwd: { type: "string", description: "Workspace directory (default: current directory)" },
  },
  async run({ args }) {
    const ctx = createCLIContext({ stateDir: args["state-dir"] });
    process.exitCode = await runTuiCommand({
      stateDir: ctx.stateDir,
      cwd: typeof args.cwd === "string" && args.cwd.trim() ? args.cwd : process.cwd(),
      stdinIsTTY: process.stdin.isTTY === true,
      stdoutIsTTY: process.stdout.isTTY === true,
    });
  },
});
