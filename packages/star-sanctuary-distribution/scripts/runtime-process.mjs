import net from "node:net";
import { spawnSync } from "node:child_process";

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function reserveFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to reserve a loopback port.")));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

export async function checkHealth(url) {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

export async function terminateChild(child, options = {}) {
  const { graceMs = 1000 } = options;

  if (child.exitCode != null) {
    return;
  }

  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    await wait(graceMs);
    return;
  }

  child.kill("SIGTERM");
  await wait(graceMs);
  if (child.exitCode == null) {
    child.kill("SIGKILL");
  }
}

export function resolveStartupWaitSeconds(mode, timings) {
  if (mode === "full") {
    return timings.full;
  }
  return timings.slim;
}
