import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { isNativeDesktopHelperEntrypoint } from "./camera-native-desktop-helper.js";
import { NativeDesktopStdioHelperClient } from "./camera-native-desktop-stdio-client.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "camera-native-helper-e2e-"));
  tempDirs.push(dir);
  return dir;
}

async function createNodeScript(filename: string, source: string): Promise<string> {
  const dir = await createTempDir();
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, source, "utf8");
  return filePath;
}

function createContext(workspaceRoot: string) {
  return {
    conversationId: "conv-camera",
    workspaceRoot,
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

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("camera native desktop helper", () => {
  it("treats a junction-resolved helper path as the same entrypoint", async () => {
    const argvPath = path.join(os.tmpdir(), "install-root", "current", "camera-native-desktop-helper.js");
    const modulePath = path.join(os.tmpdir(), "project-root", "camera-native-desktop-helper.js");
    const moduleUrl = pathToFileURL(modulePath).href;
    const resolvedArgPath = path.resolve(argvPath);
    const resolvedModulePath = path.resolve(modulePath);
    const realpathCalls: string[] = [];
    const realpathImpl = async (targetPath: string) => {
      realpathCalls.push(targetPath);
      if (targetPath === resolvedArgPath) {
        return resolvedModulePath;
      }
      if (targetPath === resolvedModulePath) {
        return targetPath;
      }
      throw new Error(`unexpected realpath target: ${targetPath}`);
    };

    await expect(isNativeDesktopHelperEntrypoint(argvPath, moduleUrl, realpathImpl)).resolves.toBe(true);
    expect(realpathCalls).toEqual([
      resolvedArgPath,
      resolvedModulePath,
    ]);
  });

  it("serves hello/list_devices/capture_snapshot over stdio with fake platform commands", async () => {
    const workspaceRoot = await createTempDir();
    const powershellPath = await createNodeScript("fake-powershell.mjs", `
      process.stdout.write(JSON.stringify([{
        name: "Logitech Brio",
        pnpDeviceId: "USB\\\\VID_046D&PID_085E\\\\ABC123",
        pnpClass: "Camera",
        manufacturer: "Logitech",
        status: "OK"
      }]));
    `);
    const ffmpegPath = await createNodeScript("fake-ffmpeg.mjs", `
      import fs from "node:fs/promises";
      import path from "node:path";
      const args = process.argv.slice(2);
      if (args.includes("-version")) {
        process.stdout.write("ffmpeg version n7\\n");
        process.exit(0);
      }
      if (args.includes("-list_devices")) {
        process.stderr.write([
          "[dshow @ 000001] DirectShow video devices",
          "[dshow @ 000001] \\"Logitech Brio\\"",
          "[dshow @ 000001] Alternative name \\"@device_pnp_\\\\\\\\?\\\\usb#vid_046d&pid_085e#abc123#{00000000-0000-0000-0000-000000000000}\\\\global\\"",
          "[dshow @ 000001] DirectShow audio devices"
        ].join("\\n"));
        process.exit(0);
      }
      const outputPath = args[args.length - 1];
      const pngBuffer = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0r0AAAAASUVORK5CYII=", "base64");
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, pngBuffer);
      process.exit(0);
    `);
    const helperPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "camera-native-desktop-helper.ts",
    );

    const client = new NativeDesktopStdioHelperClient({
      protocol: "camera-native-desktop/v1",
      transport: "stdio",
      command: process.execPath,
      args: ["--import", "tsx", helperPath],
      env: {
        BELLDANDY_CAMERA_NATIVE_HELPER_POWERSHELL_COMMAND: process.execPath,
        BELLDANDY_CAMERA_NATIVE_HELPER_POWERSHELL_ARGS_JSON: JSON.stringify([powershellPath]),
        BELLDANDY_CAMERA_NATIVE_HELPER_FFMPEG_COMMAND: process.execPath,
        BELLDANDY_CAMERA_NATIVE_HELPER_FFMPEG_ARGS_JSON: JSON.stringify([ffmpegPath]),
      },
      startupTimeoutMs: 5_000,
      requestTimeoutMs: 5_000,
    });

    const context = createContext(workspaceRoot);
    const list = await client.listDevices({
      selection: {
        facing: "front",
      },
    }, context);

    expect(list.devices).toEqual([
      expect.objectContaining({
        label: "Logitech Brio",
      }),
    ]);
    const capture = await client.captureSnapshot({
      selection: {
        stableKey: list.selectedStableKey,
      },
      output: {
        format: "png",
      },
      timeoutMs: 5_000,
    }, context);

    expect(capture.artifact.path).toContain("screenshots");
    expect(capture.device.label).toBe("Logitech Brio");

    await client.close();
  }, 15_000);
});
