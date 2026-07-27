import { defineCommand } from "citty";

export default defineCommand({
  meta: { name: "agent", description: "Run and inspect headless Conversation agents" },
  subCommands: {
    run: () => import("./agent/run.js").then((module) => module.default),
    continue: () => import("./agent/continue.js").then((module) => module.default),
    inspect: () => import("./agent/inspect.js").then((module) => module.default),
    status: () => import("./agent/status.js").then((module) => module.default),
    "follow-up": () => import("./agent/follow-up.js").then((module) => module.default),
    "follow-up-status": () => import("./agent/follow-up-status.js").then((module) => module.default),
    steer: () => import("./agent/steer.js").then((module) => module.default),
    "steer-status": () => import("./agent/steer-status.js").then((module) => module.default),
    replace: () => import("./agent/replace.js").then((module) => module.default),
    cancel: () => import("./agent/cancel.js").then((module) => module.default),
  },
});
