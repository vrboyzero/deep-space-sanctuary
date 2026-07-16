#!/usr/bin/env node
import os from "node:os";
import path from "node:path";

import { resolveRelayCredential } from "../relay-credential.js";
import { RelayServer } from "../relay.js";

const port = parseInt(process.env.BELLDANDY_RELAY_PORT || "28892", 10);

async function main() {
    const stateDir = process.env.BELLDANDY_STATE_DIR?.trim() || path.join(os.homedir(), ".star_sanctuary");
    const credential = await resolveRelayCredential({
        stateDir,
        configuredToken: process.env.BELLDANDY_RELAY_TOKEN,
    });
    const relay = new RelayServer(port, { token: credential.token });
    await relay.start();
    console.log(`Belldandy Relay Server running on port ${port}`);

    process.on("SIGINT", async () => {
        console.log("\nStopping relay...");
        await relay.stop();
        process.exit(0);
    });
}

main().catch((err) => {
    console.error("Relay failed to start:", err);
    process.exit(1);
});
