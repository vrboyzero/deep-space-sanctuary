import { defineCommand } from "citty";

export default defineCommand({
  meta: { name: "bridge", description: "Configure bridge targets and transports" },
  subCommands: {
    "claude-code-exec-mcp": () => import("./bridge-claude-code-exec-mcp.js").then((m) => m.default),
    "codex-exec-mcp": () => import("./bridge-codex-exec-mcp.js").then((m) => m.default),
    "starweaver-central": () => import("./bridge-starweaver-central.js").then((m) => m.default),
  },
});
