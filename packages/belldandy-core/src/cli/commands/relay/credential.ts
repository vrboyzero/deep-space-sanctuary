/**
 * bdd relay credential — Explicitly reveal the local Relay credential for extension setup.
 * The credential is never included in normal Gateway, Relay, or doctor logs.
 */
import { defineCommand } from "citty";

import { createCLIContext } from "../../shared/context.js";

export default defineCommand({
  meta: { name: "credential", description: "Print the local browser Relay credential for extension setup" },
  args: {
    json: { type: "boolean", description: "JSON output" },
    "state-dir": { type: "string", description: "Override state directory" },
  },
  async run({ args }) {
    const ctx = createCLIContext({ json: args.json, stateDir: args["state-dir"] });
    const { resolveRelayCredential } = await import("@belldandy/browser");
    const credential = await resolveRelayCredential({
      stateDir: ctx.stateDir,
      configuredToken: process.env.BELLDANDY_RELAY_TOKEN,
    });
    ctx.output({ token: credential.token, source: credential.source });
  },
});
