import { defineCommand } from "citty";

export default defineCommand({
  meta: { name: "coding-run", description: "Bridge coding runs over local NDJSON or MCP stdio" },
  subCommands: {
    stdio: () => import("./coding-run/stdio.js").then((module) => module.default),
    mcp: () => import("./coding-run/mcp.js").then((module) => module.default),
  },
});
