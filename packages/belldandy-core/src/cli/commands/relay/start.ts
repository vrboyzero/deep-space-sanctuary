/**
 * bdd relay start — Start the WebSocket-CDP relay server.
 */
import { defineCommand } from "citty";
import { createCLIContext } from "../../shared/context.js";

const DEFAULT_RELAY_PORT = 28892;

export default defineCommand({
  meta: { name: "start", description: "Start the browser CDP relay server" },
  args: {
    port: { type: "string", description: `Relay port (default: ${DEFAULT_RELAY_PORT})` },
    json: { type: "boolean", description: "JSON output" },
    "state-dir": { type: "string", description: "Override state directory" },
  },
  async run({ args }) {
    const ctx = createCLIContext({ json: args.json, stateDir: args["state-dir"] });
    const port = args.port ? Number(args.port) : DEFAULT_RELAY_PORT;

    if (isNaN(port) || port < 1 || port > 65535) {
      ctx.error(`Invalid port: ${args.port}`);
      process.exit(1);
    }

    try {
      const { RelayServer, resolveRelayCredential } = await import("@belldandy/browser");
      const credential = await resolveRelayCredential({
        stateDir: ctx.stateDir,
        configuredToken: process.env.BELLDANDY_RELAY_TOKEN,
      });
      const relay = new RelayServer(port, { token: credential.token });
      await relay.start();

      if (ctx.json) {
        ctx.output({ status: "running", port: relay.port, credentialSource: credential.source });
      } else {
        ctx.success(`CDP relay listening on 127.0.0.1:${relay.port}`);
        ctx.log("Configure the browser extension with `bdd relay credential` before connecting.");
        ctx.log("Press Ctrl+C to stop.");
      }

      // Keep process alive until signal
      await new Promise<void>((resolve) => {
        process.on("SIGINT", resolve);
        process.on("SIGTERM", resolve);
      });
    } catch (err) {
      ctx.error(`Failed to start relay: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  },
});
