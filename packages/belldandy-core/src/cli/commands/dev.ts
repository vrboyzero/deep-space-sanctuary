/**
 * bdd dev — Start Gateway in development mode with the same foreground supervisor
 * semantics as `bdd start`, while still running the source gateway entry via tsx.
 */
import { defineCommand } from "citty";
import { startForeground } from "../daemon.js";
import { createCLIContext } from "../shared/context.js";

export default defineCommand({
  meta: { name: "dev", description: "Start Gateway in development mode (with supervisor)" },
  args: {
    json: { type: "boolean", description: "JSON output" },
    "state-dir": { type: "string", description: "Override state directory" },
  },
  async run({ args }) {
    const ctx = createCLIContext({ json: args.json, stateDir: args["state-dir"] });
    await startForeground(ctx.stateDir);
  },
});
