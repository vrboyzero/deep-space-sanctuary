import { defineCommand } from "citty";

export default defineCommand({
  meta: { name: "agent", description: "Run and inspect headless Conversation agents" },
  subCommands: {
    run: () => import("./agent/run.js").then((module) => module.default),
    continue: () => import("./agent/continue.js").then((module) => module.default),
    inspect: () => import("./agent/inspect.js").then((module) => module.default),
    cancel: () => import("./agent/cancel.js").then((module) => module.default),
  },
});
