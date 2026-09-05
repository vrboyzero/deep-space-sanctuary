import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { runWindowsBenchmark } from "./run-coding-agent-benchmark-windows.mjs";

describe("Gateway bootstrap IPC through the Windows benchmark launcher", () => {
  it.each([true, false])("retains real child phases with listening=%s", async (listening) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "gateway-bootstrap-fixture-"));
    const portProbe = net.createServer();
    await new Promise((resolve) => portProbe.listen(0, "127.0.0.1", resolve));
    const port = portProbe.address().port;
    await new Promise((resolve, reject) => portProbe.close((error) => error ? reject(error) : resolve()));
    const runBenchmark = vi.fn(async () => 0);
    const loadProviderEnvironment = vi.fn(() => { throw new Error("Provider must not be read."); });
    try {
      const running = runWindowsBenchmark({
        workspaceRoot: process.cwd(),
        fixtureRoot: path.join(root, "fixture"),
        artifactRoot: path.join(root, "artifact"),
        stateRoot: root,
        provider: "openai",
        modelId: "fixture",
        credentialsConfigured: false,
        host: "127.0.0.1",
        port,
        authMode: "none",
        attempt: 1,
      }, {
        platform: "win32",
        gatewayReadyTimeoutMs: 2_000,
        loadProviderEnvironment,
        verifyGateway: async () => {},
        runBenchmark,
        spawn(command, _args, options) {
          expect(options.stdio[3]).toBe("ipc");
          expect(options.env.BELLDANDY_GATEWAY_STARTUP_DIAGNOSTIC).toBe("ipc-v1");
          const script = [
            'process.send({type:"gateway.startup/v1",phase:"entry"});',
            'process.send({type:"gateway.startup/v1",phase:"build_guard_complete"});',
            'process.send({type:"gateway.startup/v1",phase:"module_body",token:"must-not-retain"});',
            ...(listening ? [
              'process.send({type:"gateway.startup/v1",phase:"module_body"});',
              `require("node:net").createServer().listen(${port},"127.0.0.1");`,
            ] : ['setInterval(() => {}, 1000);']),
          ].join("\n");
          return spawn(command, ["--input-type=commonjs", "-e", script], options);
        },
      });
      if (listening) await expect(running).resolves.toBe(0);
      else await expect(running).rejects.toThrow(/Gateway readiness timed out/);
      const report = JSON.parse(await fs.readFile(path.join(root, "gateway-readiness.json"), "utf8"));
      expect(report.status).toBe(listening ? "ready" : "failed");
      expect(report.child.exited).toBe(true);
      expect(report.output.stdoutBytes).toBe(0);
      expect(report.output.stderrBytes).toBe(0);
      expect(report.events.filter((event) => event.phase.startsWith("bootstrap_")).map((event) => event.phase))
        .toEqual(listening
          ? ["bootstrap_entry", "bootstrap_build_guard_complete", "bootstrap_module_body"]
          : ["bootstrap_entry", "bootstrap_build_guard_complete"]);
      expect(JSON.stringify(report)).not.toContain("must-not-retain");
      expect(runBenchmark).toHaveBeenCalledTimes(listening ? 1 : 0);
      expect(loadProviderEnvironment).not.toHaveBeenCalled();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 15_000);
});
