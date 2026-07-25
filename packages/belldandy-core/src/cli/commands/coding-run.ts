import { defineCommand } from "citty";

export default defineCommand({
  meta: { name: "coding-run", description: "Bridge coding run controls over local NDJSON stdio" },
  subCommands: {
    stdio: () => import("./coding-run/stdio.js").then((module) => module.default),
  },
});
