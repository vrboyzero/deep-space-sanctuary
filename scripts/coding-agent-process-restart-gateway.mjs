import path from "node:path";
import { fileURLToPath } from "node:url";

import { startGatewayServer } from "../packages/belldandy-core/src/server.ts";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const values = parseNamedArgs(process.argv.slice(2));
  const stateDir = path.resolve(requireValue(values, "state-dir"));
  const port = Number(requireValue(values, "port"));
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error("--port must be an integer between 0 and 65535.");
  }

  // This process deliberately bypasses the production bootstrap: it has one inert fixture agent,
  // no channel registration, and explicit loopback/auth settings for restart-boundary evidence.
  const gateway = await startGatewayServer({
    host: "127.0.0.1",
    port,
    auth: { mode: "none" },
    webRoot: path.join(scriptDir, "..", "apps", "web", "public"),
    stateDir,
    agentFactory: () => ({
      async *run() {
        await new Promise(() => {});
      },
    }),
  });

  process.stdout.write(`${JSON.stringify({
    type: "coding-benchmark-gateway-ready",
    pid: process.pid,
    port: gateway.port,
  })}\n`);
  await new Promise(() => {});
}

function parseNamedArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`Invalid argument near ${flag ?? "<end>"}.`);
    }
    values.set(flag.slice(2), value);
  }
  return values;
}

function requireValue(values, key) {
  const value = values.get(key);
  if (typeof value !== "string" || !value.trim()) throw new Error(`--${key} is required.`);
  return value.trim();
}

main().catch((error) => {
  process.stderr.write(`[coding-agent-process-restart-gateway] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
