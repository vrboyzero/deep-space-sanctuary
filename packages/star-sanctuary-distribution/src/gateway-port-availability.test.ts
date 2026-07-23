import net from "node:net";

import { afterEach, expect, test } from "vitest";

import { checkGatewayPortAvailability } from "./gateway-port-availability.js";

const servers: net.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => closeServer(server)));
});

test("reports available only after both wildcard address families can bind and close", async () => {
  const port = await reserveFreePort();

  await expect(checkGatewayPortAvailability(port)).resolves.toBe("available");
});

test("reports occupied when an IPv4 listener owns the port", async () => {
  const server = net.createServer();
  servers.push(server);
  const port = await listen(server, 0, "0.0.0.0");

  await expect(checkGatewayPortAvailability(port)).resolves.toBe("occupied");
});

test("reports unknown rather than treating an invalid port as available", async () => {
  await expect(checkGatewayPortAvailability(70_000)).resolves.toBe("unknown");
});

async function reserveFreePort(): Promise<number> {
  const server = net.createServer();
  const port = await listen(server, 0, "0.0.0.0");
  await closeServer(server);
  return port;
}

async function listen(server: net.Server, port: number, host: string): Promise<number> {
  return await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to resolve test port."));
        return;
      }
      resolve(address.port);
    });
  });
}

async function closeServer(server: net.Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
