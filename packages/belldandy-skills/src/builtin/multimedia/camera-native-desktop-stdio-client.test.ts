import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import {
  BELLDANDY_CAMERA_NATIVE_HELPER_ARGS_JSON_ENV,
  BELLDANDY_CAMERA_NATIVE_HELPER_COMMAND_ENV,
  BELLDANDY_CAMERA_NATIVE_HELPER_ENV_JSON_ENV,
  BELLDANDY_CAMERA_NATIVE_HELPER_IDLE_SHUTDOWN_MS_ENV,
  BELLDANDY_CAMERA_NATIVE_HELPER_REQUEST_TIMEOUT_MS_ENV,
  BELLDANDY_CAMERA_NATIVE_HELPER_STARTUP_TIMEOUT_MS_ENV,
  NativeDesktopStdioHelperClient,
  readNativeDesktopHelperConfigFromEnv,
} from "./camera-native-desktop-stdio-client.js";
import {
  BELLDANDY_RUNTIME_DIR_ENV,
} from "./camera-native-desktop-launch.js";

const helperScripts: string[] = [];

async function createHelperScript(source: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "camera-native-desktop-helper-"));
  const filePath = path.join(dir, "helper.mjs");
  await fs.writeFile(filePath, source, "utf8");
  helperScripts.push(dir);
  return filePath;
}

async function createInstalledRuntimeHelperScript(source: string): Promise<{
  installRoot: string;
  runtimeDir: string;
  helperEntryArg: string;
  helperPath: string;
}> {
  const installRoot = await fs.mkdtemp(path.join(os.tmpdir(), "camera-native-desktop-install-root-"));
  const runtimeDir = path.join(installRoot, "current");
  const helperEntryArg = "packages/belldandy-skills/dist/builtin/multimedia/camera-native-desktop-helper.js";
  const helperPath = path.join(runtimeDir, helperEntryArg);
  await fs.mkdir(path.dirname(helperPath), { recursive: true });
  await fs.writeFile(helperPath, source, "utf8");
  helperScripts.push(installRoot);
  return {
    installRoot,
    runtimeDir,
    helperEntryArg,
    helperPath,
  };
}

async function createPortableRuntimeHelperScript(source: string): Promise<{
  portableRoot: string;
  runtimeDir: string;
  helperEntryArg: string;
  helperPath: string;
  portableExePath: string;
}> {
  const portableRoot = await fs.mkdtemp(path.join(os.tmpdir(), "camera-native-desktop-portable-root-"));
  const runtimeDir = path.join(portableRoot, "runtime");
  const helperEntryArg = "packages/belldandy-skills/dist/builtin/multimedia/camera-native-desktop-helper.js";
  const helperPath = path.join(runtimeDir, helperEntryArg);
  const portableExePath = path.join(portableRoot, "star-sanctuary.exe");
  await fs.mkdir(path.dirname(helperPath), { recursive: true });
  await fs.writeFile(helperPath, source, "utf8");
  await fs.writeFile(portableExePath, "placeholder", "utf8");
  helperScripts.push(portableRoot);
  return {
    portableRoot,
    runtimeDir,
    helperEntryArg,
    helperPath,
    portableExePath,
  };
}

function createContext() {
  return {
    conversationId: "conv-camera",
    workspaceRoot: "E:/project/star-sanctuary",
    policy: {
      allowedPaths: [],
      deniedPaths: [],
      allowedDomains: [],
      deniedDomains: [],
      maxTimeoutMs: 5_000,
      maxResponseBytes: 1024 * 1024,
    },
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
      trace: () => undefined,
    },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000, intervalMs = 20): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`waitFor timeout after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function removeDirWithRetries(dir: string, retries = 8, delayMs = 50): Promise<void> {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if ((code !== "EBUSY" && code !== "EPERM") || attempt === retries) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  await Promise.all(helperScripts.splice(0).map((dir) => removeDirWithRetries(dir)));
});

describe("camera native desktop stdio client", () => {
  it("parses helper config from environment variables", () => {
    const config = readNativeDesktopHelperConfigFromEnv({
      [BELLDANDY_CAMERA_NATIVE_HELPER_COMMAND_ENV]: process.execPath,
      [BELLDANDY_CAMERA_NATIVE_HELPER_ARGS_JSON_ENV]: JSON.stringify(["helper.mjs"]),
      [BELLDANDY_CAMERA_NATIVE_HELPER_ENV_JSON_ENV]: JSON.stringify({ FOO: "bar" }),
      [BELLDANDY_CAMERA_NATIVE_HELPER_STARTUP_TIMEOUT_MS_ENV]: "1234",
      [BELLDANDY_CAMERA_NATIVE_HELPER_REQUEST_TIMEOUT_MS_ENV]: "5678",
      [BELLDANDY_CAMERA_NATIVE_HELPER_IDLE_SHUTDOWN_MS_ENV]: "90",
    });

    expect(config).toEqual({
      protocol: "camera-native-desktop/v1",
      transport: "stdio",
      command: process.execPath,
      args: ["helper.mjs"],
      env: { FOO: "bar" },
      cwd: undefined,
      startupTimeoutMs: 1234,
      requestTimeoutMs: 5678,
      idleShutdownMs: 90,
    });
  });

  it("starts the helper, performs hello, and completes request/response over stdio", async () => {
    const helperPath = await createHelperScript(`
      import readline from "node:readline";
      const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
      rl.on("line", (line) => {
        const message = JSON.parse(line);
        if (message.method === "hello") {
          process.stdout.write(JSON.stringify({
            kind: "response",
            protocol: "camera-native-desktop/v1",
            id: message.id,
            method: "hello",
            ok: true,
            result: {
              protocol: "camera-native-desktop/v1",
              helperVersion: "0.1.0",
              platform: "windows",
              transport: "stdio",
              helperStatus: "ready",
              capabilities: {
                diagnose: true,
                list: true,
                snapshot: true,
                clip: false,
                audio: false,
                hotplug: true,
                background: true,
                stillFormats: ["png"],
                clipFormats: [],
                selectionByStableKey: true,
                deviceChangeEvents: true
              }
            }
          }) + "\\n");
          return;
        }
        if (message.method === "list_devices") {
          process.stdout.write(JSON.stringify({
            kind: "response",
            protocol: "camera-native-desktop/v1",
            id: message.id,
            method: "list_devices",
            ok: true,
            result: {
              observedAt: "2026-04-17T08:00:00.000Z",
              helperStatus: "ready",
              permissionState: "granted",
              selectedDeviceId: "dev-1",
              selectedStableKey: "usb-logitech-brio",
              selectionReason: "explicit_device_ref",
              devices: [{
                deviceId: "dev-1",
                stableKey: "usb-logitech-brio",
                label: "Logitech Brio",
                source: "external",
                transport: "native",
                external: true,
                available: true,
                kind: "videoinput"
              }]
            }
          }) + "\\n");
        }
      });
    `);

    const client = new NativeDesktopStdioHelperClient({
      protocol: "camera-native-desktop/v1",
      transport: "stdio",
      command: process.execPath,
      args: [helperPath],
      startupTimeoutMs: 2_000,
      requestTimeoutMs: 2_000,
    });

    const result = await client.listDevices({
      selection: {
        deviceRef: "native_desktop:device:usb-logitech-brio",
      },
    }, createContext());

    expect(result).toMatchObject({
      helperStatus: "ready",
      permissionState: "granted",
      selectedStableKey: "usb-logitech-brio",
      devices: [
        expect.objectContaining({
          stableKey: "usb-logitech-brio",
        }),
      ],
    });

    await client.close();
  });

  it("fails when the helper request exceeds timeout", async () => {
    const helperPath = await createHelperScript(`
      import readline from "node:readline";
      const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
      rl.on("line", (line) => {
        const message = JSON.parse(line);
        if (message.method === "hello") {
          process.stdout.write(JSON.stringify({
            kind: "response",
            protocol: "camera-native-desktop/v1",
            id: message.id,
            method: "hello",
            ok: true,
            result: {
              protocol: "camera-native-desktop/v1",
              helperVersion: "0.1.0",
              platform: "windows",
              transport: "stdio",
              helperStatus: "ready",
              capabilities: {
                diagnose: true,
                list: true,
                snapshot: true,
                clip: false,
                audio: false,
                hotplug: true,
                background: true,
                stillFormats: ["png"],
                clipFormats: [],
                selectionByStableKey: true,
                deviceChangeEvents: true
              }
            }
          }) + "\\n");
        }
      });
    `);

    const client = new NativeDesktopStdioHelperClient({
      protocol: "camera-native-desktop/v1",
      transport: "stdio",
      command: process.execPath,
      args: [helperPath],
      startupTimeoutMs: 2_000,
      requestTimeoutMs: 100,
    });

    await expect(client.listDevices({}, createContext())).rejects.toThrow(
      "native_desktop helper list_devices timed out after 100ms.",
    );

    await client.close();
  });

  it("terminates the helper before rejecting an aborted request", async () => {
    const helperPath = await createHelperScript(`
      import fs from "node:fs";
      import readline from "node:readline";
      fs.writeFileSync(process.env.HELPER_PID_PATH, String(process.pid));
      const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
      rl.on("line", (line) => {
        const message = JSON.parse(line);
        if (message.method === "hello") {
          process.stdout.write(JSON.stringify({
            kind: "response",
            protocol: "camera-native-desktop/v1",
            id: message.id,
            method: "hello",
            ok: true,
            result: {
              protocol: "camera-native-desktop/v1",
              helperVersion: "0.1.0",
              platform: "windows",
              transport: "stdio",
              helperStatus: "ready",
              capabilities: {
                diagnose: true, list: true, snapshot: true, clip: false, audio: false,
                hotplug: true, background: true, stillFormats: ["png"], clipFormats: [],
                selectionByStableKey: true, deviceChangeEvents: true
              }
            }
          }) + "\\n");
        }
      });
      setTimeout(() => process.exit(0), 1500);
    `);
    const pidPath = path.join(path.dirname(helperPath), "abort-helper.pid");
    const client = new NativeDesktopStdioHelperClient({
      protocol: "camera-native-desktop/v1",
      transport: "stdio",
      command: process.execPath,
      args: [helperPath],
      env: { HELPER_PID_PATH: pidPath },
      startupTimeoutMs: 2_000,
      requestTimeoutMs: 2_000,
    });
    const controller = new AbortController();
    const request = client.listDevices({}, {
      ...createContext(),
      abortSignal: controller.signal,
    });
    await waitFor(() => Boolean((client as any).lastHelloResponse)
      && (client as any).pendingRequests.size > 0);

    controller.abort("Stopped camera request.");
    await expect(request).rejects.toThrow("Stopped camera request.");
    const helperPid = Number(await fs.readFile(pidPath, "utf-8"));

    expect(isProcessAlive(helperPid)).toBe(false);
    expect((client as any).child).toBeNull();
  });

  it("kills and waits for the helper before rejecting invalid JSON", async () => {
    const helperPath = await createHelperScript(`
      import fs from "node:fs";
      import readline from "node:readline";
      fs.writeFileSync(process.env.HELPER_PID_PATH, String(process.pid));
      const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
      rl.once("line", () => {
        process.stdout.write("not-json\\n");
        setTimeout(() => process.exit(0), 500);
      });
    `);
    const pidPath = path.join(path.dirname(helperPath), "helper.pid");
    const client = new NativeDesktopStdioHelperClient({
      protocol: "camera-native-desktop/v1",
      transport: "stdio",
      command: process.execPath,
      args: [helperPath],
      env: { HELPER_PID_PATH: pidPath },
      startupTimeoutMs: 2_000,
      requestTimeoutMs: 2_000,
    });

    await expect(client.listDevices({}, createContext())).rejects.toThrow("emitted invalid JSON");
    const helperPid = Number(await fs.readFile(pidPath, "utf-8"));

    expect(isProcessAlive(helperPid)).toBe(false);
    expect((client as any).child).toBeNull();
  });

  it("rejects and terminates a helper that exceeds the stdout line byte limit", async () => {
    const helperPath = await createHelperScript(`
      import readline from "node:readline";
      const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
      rl.once("line", () => {
        process.stdout.write("x".repeat(1024 * 1024 + 1));
        setTimeout(() => process.exit(0), 800);
      });
    `);
    const client = new NativeDesktopStdioHelperClient({
      protocol: "camera-native-desktop/v1",
      transport: "stdio",
      command: process.execPath,
      args: [helperPath],
      startupTimeoutMs: 2_000,
      requestTimeoutMs: 200,
    });

    try {
      await expect(client.listDevices({}, createContext())).rejects.toThrow(
        "stdout line exceeded 1048576 bytes",
      );
    } finally {
      await client.close();
    }
  });

  it("fails fast when hello response uses the wrong protocol version", async () => {
    const helperPath = await createHelperScript(`
      import readline from "node:readline";
      const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
      rl.on("line", (line) => {
        const message = JSON.parse(line);
        if (message.method === "hello") {
          process.stdout.write(JSON.stringify({
            kind: "response",
            protocol: "camera-native-desktop/v999",
            id: message.id,
            method: "hello",
            ok: true,
            result: {
              protocol: "camera-native-desktop/v999",
              helperVersion: "0.1.0",
              platform: "windows",
              transport: "stdio",
              helperStatus: "ready",
              capabilities: {
                diagnose: true,
                list: true,
                snapshot: true,
                clip: false,
                audio: false,
                hotplug: true,
                background: true,
                stillFormats: ["png"],
                clipFormats: [],
                selectionByStableKey: true,
                deviceChangeEvents: true
              }
            }
          }) + "\\n");
        }
      });
    `);

    const client = new NativeDesktopStdioHelperClient({
      protocol: "camera-native-desktop/v1",
      transport: "stdio",
      command: process.execPath,
      args: [helperPath],
      startupTimeoutMs: 2_000,
      requestTimeoutMs: 2_000,
    });

    await expect(client.listDevices({}, createContext())).rejects.toThrow(
      "protocol mismatch",
    );

    await client.close();
  });

  it("auto-closes the helper after the idle timeout elapses", async () => {
    const helperPath = await createHelperScript(`
      import readline from "node:readline";
      const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
      rl.on("line", (line) => {
        const message = JSON.parse(line);
        if (message.method === "hello") {
          process.stdout.write(JSON.stringify({
            kind: "response",
            protocol: "camera-native-desktop/v1",
            id: message.id,
            method: "hello",
            ok: true,
            result: {
              protocol: "camera-native-desktop/v1",
              helperVersion: "0.1.0",
              platform: "windows",
              transport: "stdio",
              helperStatus: "ready",
              capabilities: {
                diagnose: true,
                list: true,
                snapshot: true,
                clip: false,
                audio: false,
                hotplug: true,
                background: true,
                stillFormats: ["png"],
                clipFormats: [],
                selectionByStableKey: true,
                deviceChangeEvents: true
              }
            }
          }) + "\\n");
          return;
        }
        if (message.method === "list_devices") {
          process.stdout.write(JSON.stringify({
            kind: "response",
            protocol: "camera-native-desktop/v1",
            id: message.id,
            method: "list_devices",
            ok: true,
            result: {
              observedAt: "2026-04-17T08:00:00.000Z",
              helperStatus: "ready",
              permissionState: "granted",
              devices: []
            }
          }) + "\\n");
        }
      });
    `);

    const client = new NativeDesktopStdioHelperClient({
      protocol: "camera-native-desktop/v1",
      transport: "stdio",
      command: process.execPath,
      args: [helperPath],
      startupTimeoutMs: 2_000,
      requestTimeoutMs: 2_000,
      idleShutdownMs: 25,
    });

    await client.listDevices({}, createContext());

    await waitFor(() => !(client as any).child, 2_000);
  });

  it("fails fast when the configured helper cwd does not exist", async () => {
    const helperPath = await createHelperScript("process.stdin.resume();");
    const client = new NativeDesktopStdioHelperClient({
      protocol: "camera-native-desktop/v1",
      transport: "stdio",
      command: process.execPath,
      args: [helperPath],
      cwd: path.join(os.tmpdir(), "missing-native-desktop-helper-cwd"),
      startupTimeoutMs: 2_000,
      requestTimeoutMs: 2_000,
    });

    await expect(client.listDevices({}, createContext())).rejects.toThrow(
      "Configured native_desktop helper cwd does not exist or is not a directory",
    );
  });

  it("fails fast when the configured helper entry path does not exist", async () => {
    const helperDir = await fs.mkdtemp(path.join(os.tmpdir(), "camera-native-desktop-helper-missing-entry-"));
    helperScripts.push(helperDir);
    const client = new NativeDesktopStdioHelperClient({
      protocol: "camera-native-desktop/v1",
      transport: "stdio",
      command: process.execPath,
      args: ["./missing-helper-entry.mjs"],
      cwd: helperDir,
      startupTimeoutMs: 2_000,
      requestTimeoutMs: 2_000,
    });

    await expect(client.listDevices({}, createContext())).rejects.toThrow(
      "Configured native_desktop helper entry does not exist",
    );
  });

  it("reports a PATH lookup failure with an actionable launch hint", async () => {
    const spawnProcess = () => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const stdin = new PassThrough();
      const child = Object.assign(new EventEmitter(), {
        stdout,
        stderr,
        stdin,
        killed: false,
        exitCode: null,
        kill() {
          this.killed = true;
          this.exitCode = 1;
          queueMicrotask(() => this.emit("close", 1, null));
          return true;
        },
      });
      setTimeout(() => child.emit(
        "error",
        Object.assign(new Error("spawn missing-helper ENOENT"), { code: "ENOENT" }),
      ), 10);
      return child as unknown as import("node:child_process").ChildProcessWithoutNullStreams;
    };

    const client = new NativeDesktopStdioHelperClient({
      protocol: "camera-native-desktop/v1",
      transport: "stdio",
      command: "missing-helper",
      args: ["packages/belldandy-skills/dist/builtin/multimedia/camera-native-desktop-helper.js"],
      startupTimeoutMs: 2_000,
      requestTimeoutMs: 2_000,
    }, {
      spawnProcess: spawnProcess as typeof import("node:child_process").spawn,
    });

    await expect(client.listDevices({}, createContext())).rejects.toThrow(
      "command \"missing-helper\" was not found on PATH",
    );
  });

  it("resolves repo-relative helper entry against runtimeDir for installed layouts", async () => {
    const installLayout = await createInstalledRuntimeHelperScript(`
      const readline = require("node:readline");
      const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
      rl.on("line", (line) => {
        const message = JSON.parse(line);
        if (message.method === "hello") {
          process.stdout.write(JSON.stringify({
            kind: "response",
            protocol: "camera-native-desktop/v1",
            id: message.id,
            method: "hello",
            ok: true,
            result: {
              protocol: "camera-native-desktop/v1",
              helperVersion: "0.1.0",
              platform: "windows",
              transport: "stdio",
              helperStatus: "ready",
              capabilities: {
                diagnose: true,
                list: true,
                snapshot: true,
                clip: false,
                audio: false,
                hotplug: true,
                background: true,
                stillFormats: ["png"],
                clipFormats: [],
                selectionByStableKey: true,
                deviceChangeEvents: true
              }
            }
          }) + "\\n");
          return;
        }
        if (message.method === "list_devices") {
          process.stdout.write(JSON.stringify({
            kind: "response",
            protocol: "camera-native-desktop/v1",
            id: message.id,
            method: "list_devices",
            ok: true,
            result: {
              observedAt: "2026-04-17T08:00:00.000Z",
              helperStatus: "ready",
              permissionState: "granted",
              devices: []
            }
          }) + "\\n");
        }
      });
    `);

    const client = new NativeDesktopStdioHelperClient({
      protocol: "camera-native-desktop/v1",
      transport: "stdio",
      command: process.execPath,
      args: [installLayout.helperEntryArg],
      cwd: installLayout.installRoot,
      startupTimeoutMs: 2_000,
      requestTimeoutMs: 2_000,
    }, {
      env: {
        ...process.env,
        [BELLDANDY_RUNTIME_DIR_ENV]: installLayout.runtimeDir,
      },
    });

    await expect(client.listDevices({}, createContext())).resolves.toMatchObject({
      helperStatus: "ready",
      permissionState: "granted",
      devices: [],
    });

    await client.close();
  });

  it("treats the portable star-sanctuary.exe runtime as a node-like helper launcher", async () => {
    const portableLayout = await createPortableRuntimeHelperScript(`
      const readline = require("node:readline");
      const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
      rl.on("line", (line) => {
        const message = JSON.parse(line);
        if (message.method === "hello") {
          process.stdout.write(JSON.stringify({
            kind: "response",
            protocol: "camera-native-desktop/v1",
            id: message.id,
            method: "hello",
            ok: true,
            result: {
              protocol: "camera-native-desktop/v1",
              helperVersion: "0.1.0",
              platform: "windows",
              transport: "stdio",
              helperStatus: "ready",
              capabilities: {
                diagnose: true,
                list: true,
                snapshot: true,
                clip: false,
                audio: false,
                hotplug: true,
                background: true,
                stillFormats: ["png"],
                clipFormats: [],
                selectionByStableKey: true,
                deviceChangeEvents: true
              }
            }
          }) + "\\n");
          return;
        }
        if (message.method === "list_devices") {
          process.stdout.write(JSON.stringify({
            kind: "response",
            protocol: "camera-native-desktop/v1",
            id: message.id,
            method: "list_devices",
            ok: true,
            result: {
              observedAt: "2026-04-17T08:00:00.000Z",
              helperStatus: "ready",
              permissionState: "granted",
              devices: []
            }
          }) + "\\n");
        }
      });
    `);
    const spawnCalls: Array<{ command: string; args: string[] }> = [];
    const spawnProcess = (command: string, args?: readonly string[]) => {
      spawnCalls.push({
        command,
        args: [...(args ?? [])],
      });
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const stdin = new PassThrough();
      let buffer = "";
      stdin.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex >= 0) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (line) {
            const message = JSON.parse(line);
            if (message.method === "hello") {
              stdout.write(JSON.stringify({
                kind: "response",
                protocol: "camera-native-desktop/v1",
                id: message.id,
                method: "hello",
                ok: true,
                result: {
                  protocol: "camera-native-desktop/v1",
                  helperVersion: "0.1.0",
                  platform: "windows",
                  transport: "stdio",
                  helperStatus: "ready",
                  capabilities: {
                    diagnose: true,
                    list: true,
                    snapshot: true,
                    clip: false,
                    audio: false,
                    hotplug: true,
                    background: true,
                    stillFormats: ["png"],
                    clipFormats: [],
                    selectionByStableKey: true,
                    deviceChangeEvents: true,
                  },
                },
              }) + "\n");
            } else if (message.method === "list_devices") {
              stdout.write(JSON.stringify({
                kind: "response",
                protocol: "camera-native-desktop/v1",
                id: message.id,
                method: "list_devices",
                ok: true,
                result: {
                  observedAt: "2026-04-17T08:00:00.000Z",
                  helperStatus: "ready",
                  permissionState: "granted",
                  devices: [],
                },
              }) + "\n");
            }
          }
          newlineIndex = buffer.indexOf("\n");
        }
      });
      const child = Object.assign(new EventEmitter(), {
        stdout,
        stderr,
        stdin,
        killed: false,
        exitCode: null,
        kill() {
          this.killed = true;
          this.exitCode = 0;
          queueMicrotask(() => this.emit("close", 0, null));
          return true;
        },
      });
      return child as unknown as import("node:child_process").ChildProcessWithoutNullStreams;
    };

    const client = new NativeDesktopStdioHelperClient({
      protocol: "camera-native-desktop/v1",
      transport: "stdio",
      command: portableLayout.portableExePath,
      args: [portableLayout.helperEntryArg],
      cwd: portableLayout.portableRoot,
      startupTimeoutMs: 2_000,
      requestTimeoutMs: 2_000,
    }, {
      env: {
        ...process.env,
        [BELLDANDY_RUNTIME_DIR_ENV]: portableLayout.runtimeDir,
      },
      spawnProcess: spawnProcess as typeof import("node:child_process").spawn,
    });

    await expect(client.listDevices({}, createContext())).resolves.toMatchObject({
      helperStatus: "ready",
      permissionState: "granted",
      devices: [],
    });
    expect(spawnCalls).toEqual([
      {
        command: portableLayout.portableExePath,
        args: [portableLayout.helperPath],
      },
    ]);

    await client.close();
  });
});
