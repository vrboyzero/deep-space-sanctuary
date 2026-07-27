import { defineCommand } from "citty";

import { startCodingRunMcpProcess } from "../../../coding-run/mcp-process.js";
import { createCLIContext } from "../../shared/context.js";

export default defineCommand({
  meta: { name: "mcp", description: "Expose the Gateway-authorized coding runtime as an MCP stdio server" },
  args: {
    "state-dir": { type: "string", description: "Override state directory" },
  },
  async run({ args }) {
    const ctx = createCLIContext({ stateDir: args["state-dir"] });
    const runtime = await startCodingRunMcpProcess({ stateDir: ctx.stateDir });
    process.stdin.once("end", () => { void runtime.close(); });
  },
});
