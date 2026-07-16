/**
 * bdd relay — parent command for browser CDP relay.
 */
import { defineCommand } from "citty";

export default defineCommand({
  meta: { name: "relay", description: "Browser CDP relay management" },
  subCommands: {
    start: () => import("./relay/start.js").then((m) => m.default),
    credential: () => import("./relay/credential.js").then((m) => m.default),
  },
});
