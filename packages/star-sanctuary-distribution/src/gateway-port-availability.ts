import net from "node:net";

export type GatewayPortAvailability = "available" | "occupied" | "unknown";

const WILDCARD_BIND_TARGETS: ReadonlyArray<net.ListenOptions> = [
  { host: "0.0.0.0" },
  { host: "::", ipv6Only: true },
];

/**
 * 只有 IPv4 与 IPv6 通配地址都完成 bind/close 才确认端口空闲。
 * 任一地址族无法确认时返回 unknown，让 preflight 继续既有 PowerShell fail-closed 路径。
 */
export async function checkGatewayPortAvailability(port: number): Promise<GatewayPortAvailability> {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return "unknown";
  }
  for (const target of WILDCARD_BIND_TARGETS) {
    const result = await bindAndClose({ ...target, port });
    if (result !== "available") {
      return result;
    }
  }
  return "available";
}

async function bindAndClose(options: net.ListenOptions): Promise<GatewayPortAvailability> {
  return await new Promise((resolve) => {
    const server = net.createServer();
    let settled = false;
    const finish = (result: GatewayPortAvailability) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const onError = (error: NodeJS.ErrnoException) => {
      finish(error.code === "EADDRINUSE" ? "occupied" : "unknown");
    };
    server.once("error", onError);
    server.once("listening", () => {
      server.off("error", onError);
      server.close((error) => finish(error ? "unknown" : "available"));
    });
    try {
      server.listen(options);
    } catch {
      finish("unknown");
    }
  });
}
