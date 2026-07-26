import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildOciSandboxInvocation,
  buildSandboxRuntimeEnvironment,
  probeOciCommandSandboxRuntime,
  resolveOciCommandSandboxConfig,
} from "../packages/belldandy-skills/src/command-sandbox.ts";
import { createOciSandboxLease } from "../packages/belldandy-skills/src/command-sandbox-lease.ts";
import {
  commandJobTool,
  shutdownCommandJobs,
} from "../packages/belldandy-skills/src/builtin/system/command-job.ts";

const scriptPath = fileURLToPath(import.meta.url);
const FIXTURE_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_CHARS = 64 * 1024;

export function buildOciSandboxFixturePlans() {
  return [
    {
      id: "rootfs-readonly",
      plan: {
        executable: "node",
        argv: ["-e", [
          "const fs = require('node:fs');",
          "try { fs.writeFileSync('/belldandy-rootfs-write-probe', 'blocked'); process.exitCode = 2; }",
          "catch { process.stdout.write('rootfs-readonly'); }",
        ].join(" ")],
        env: {},
        network: "none",
        writeScope: "workspace-readonly",
        stdinMode: "closed",
      },
      expectedOutput: "rootfs-readonly",
    },
    {
      id: "workspace-readonly",
      plan: {
        executable: "node",
        argv: ["-e", [
          "const fs = require('node:fs');",
          "try { fs.writeFileSync('/workspace/readonly-probe.txt', 'blocked'); process.exitCode = 2; }",
          "catch { process.stdout.write('workspace-readonly'); }",
        ].join(" ")],
        env: {},
        network: "none",
        writeScope: "workspace-readonly",
        stdinMode: "closed",
      },
      expectedOutput: "workspace-readonly",
    },
    {
      id: "workspace-readwrite",
      plan: {
        executable: "node",
        argv: [
          "-e",
          "require('node:fs').writeFileSync('/workspace/readwrite-probe.txt', 'workspace-write-ok'); process.stdout.write('workspace-readwrite');",
        ],
        env: {},
        network: "none",
        writeScope: "workspace-readwrite",
        stdinMode: "closed",
      },
      expectedOutput: "workspace-readwrite",
    },
    {
      id: "network-none",
      plan: {
        executable: "node",
        argv: ["-e", [
          "const fs = require('node:fs');",
          "const interfaces = fs.readdirSync('/sys/class/net').sort();",
          "if (interfaces.length !== 1 || interfaces[0] !== 'lo') throw new Error('unexpected network interfaces: ' + interfaces.join(','));",
          "process.stdout.write('network-none');",
        ].join(" ")],
        env: {},
        network: "none",
        writeScope: "workspace-readonly",
        stdinMode: "closed",
      },
      expectedOutput: "network-none",
    },
  ];
}

export function buildOciSandboxJobPlans() {
  return ["pipe", "pty"].map((stdinMode) => ({
    id: `job-${stdinMode}`,
    plan: {
      executable: "node",
      argv: ["-e", `setInterval(() => process.stdout.write('${stdinMode}-tick\\n'), 100);`],
      env: {},
      network: "none",
      writeScope: "workspace-readonly",
      stdinMode,
      timeoutMs: FIXTURE_TIMEOUT_MS,
    },
    expectedOutput: `${stdinMode}-tick`,
  }));
}

export async function verifyOciSandboxFixture(input = {}) {
  const config = input.config ?? resolveOciCommandSandboxConfig({ readEnv: input.readEnv });
  if (!config) {
    throw new Error(
      "OCI sandbox fixture requires BELLDANDY_COMMAND_SANDBOX_BACKEND=oci, a docker/podman runtime, and a digest-pinned image.",
    );
  }
  const runtime = await (input.probeOciRuntime ?? probeOciCommandSandboxRuntime)(config);
  if (!runtime.available) {
    throw new Error("OCI sandbox fixture requires a reachable local Docker or Podman daemon; no runtime was started.");
  }

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-command-sandbox-fixture-"));
  const workspace = path.join(root, "workspace");
  await fs.mkdir(workspace);
  try {
    for (const fixture of buildOciSandboxFixturePlans()) {
      const result = await runFixturePlan({ config, workspace, fixture });
      assert.equal(result.exitCode, 0, fixture.id + " exited with " + result.exitCode + ": " + result.stderr);
      assert.match(result.stdout, new RegExp(fixture.expectedOutput));
    }

    await assert.rejects(fs.access(path.join(workspace, "readonly-probe.txt")));
    assert.equal(
      await fs.readFile(path.join(workspace, "readwrite-probe.txt"), "utf8"),
      "workspace-write-ok",
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

export async function verifyOciSandboxJobFixture(input = {}) {
  const config = input.config ?? resolveOciCommandSandboxConfig({ readEnv: input.readEnv });
  if (!config) {
    throw new Error(
      "OCI sandbox job fixture requires BELLDANDY_COMMAND_SANDBOX_BACKEND=oci, a docker/podman runtime, and a digest-pinned image.",
    );
  }
  const runtime = await (input.probeOciRuntime ?? probeOciCommandSandboxRuntime)(config);
  if (!runtime.available) {
    throw new Error("OCI sandbox job fixture requires a reachable local Docker or Podman daemon; no runtime was started.");
  }

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-command-sandbox-job-fixture-"));
  const workspace = path.join(root, "workspace");
  const stateDir = path.join(root, "state");
  await fs.mkdir(workspace);
  const readEnv = (name) => ({
    BELLDANDY_COMMAND_SANDBOX_BACKEND: config.backend,
    BELLDANDY_COMMAND_SANDBOX_OCI_RUNTIME: config.runtime,
    BELLDANDY_COMMAND_SANDBOX_OCI_IMAGE: config.image,
  })[name];
  const context = {
    conversationId: "command-sandbox-oci-job-fixture",
    workspaceRoot: workspace,
    defaultCwd: workspace,
    stateDir,
    readEnv,
    launchSpec: { commandSandbox: "required" },
    policy: {
      allowedPaths: [],
      deniedPaths: [],
      allowedDomains: [],
      deniedDomains: [],
      maxTimeoutMs: FIXTURE_TIMEOUT_MS,
      maxResponseBytes: MAX_OUTPUT_CHARS,
    },
  };

  try {
    for (const fixture of buildOciSandboxJobPlans()) {
      const started = await commandJobTool.execute({ action: "start", commandPlan: fixture.plan }, context);
      assert.equal(started.success, true, `${fixture.id} failed to start: ${started.error ?? "unknown error"}`);
      const jobId = JSON.parse(started.output).jobId;
      const read = await waitForJobOutput({ context, jobId, expectedOutput: fixture.expectedOutput });
      assert.match(JSON.parse(read.output).output, new RegExp(fixture.expectedOutput));
      if (fixture.plan.stdinMode === "pty") {
        const resized = await commandJobTool.execute({ action: "resize", jobId, cols: 120, rows: 36 }, context);
        assert.equal(resized.success, true, `${fixture.id} resize failed: ${resized.error ?? "unknown error"}`);
      }
      const cancelled = await commandJobTool.execute({ action: "cancel", jobId }, context);
      assert.equal(cancelled.success, true, `${fixture.id} cancellation failed: ${cancelled.error ?? "unknown error"}`);
      const snapshot = JSON.parse(cancelled.output);
      assert.equal(snapshot.status, "cancelled");
      assert.equal(snapshot.processCloseObserved, true);
      assert.equal(snapshot.cleanup?.commandSandboxLeaseCleanupStatus, "removed");
    }
  } finally {
    await shutdownCommandJobs();
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function waitForJobOutput(input) {
  const deadline = Date.now() + FIXTURE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const read = await commandJobTool.execute({ action: "read", jobId: input.jobId, cursor: 0, maxBytes: 4096 }, input.context);
    assert.equal(read.success, true, `job output read failed: ${read.error ?? "unknown error"}`);
    const snapshot = JSON.parse(read.output);
    if (snapshot.output.includes(input.expectedOutput)) return read;
    if (snapshot.status !== "running") {
      throw new Error(`job reached ${snapshot.status} before producing ${input.expectedOutput}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`job did not produce ${input.expectedOutput} within ${FIXTURE_TIMEOUT_MS}ms`);
}

async function runFixturePlan(input) {
  const lease = await createOciSandboxLease({ config: input.config });
  let release;
  try {
    const invocation = buildOciSandboxInvocation({
      config: input.config,
      workspaceRoot: input.workspace,
      cwd: input.workspace,
      plan: input.fixture.plan,
      lease: lease.binding,
    });
    const result = await runOciInvocation(invocation, () => lease.markRuntimeStarted());
    return result;
  } finally {
    release = await lease.release();
    await lease.cleanupArtifacts();
    assert.equal(release.status, "removed", input.fixture.id + " did not release its OCI container lease.");
    assert.match(release.containerId ?? "", /^[a-f0-9]{12,64}$/i);
  }
}

function runOciInvocation(invocation, onStarted) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(invocation.executable, invocation.args, {
        cwd: invocation.cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: buildSandboxRuntimeEnvironment(),
      });
      onStarted();
    } catch (error) {
      resolve({
        exitCode: null,
        stdout: "",
        stderr: error instanceof Error ? error.message : "OCI fixture spawn failed.",
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    const append = (value, chunk) => (value + chunk.toString("utf8")).slice(0, MAX_OUTPUT_CHARS);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // The OCI CLI may already be gone.
      }
      finish({ exitCode: null, stdout, stderr: stderr || "OCI fixture timed out." });
    }, FIXTURE_TIMEOUT_MS);

    child.stdout?.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });
    child.once("error", (error) => {
      finish({
        exitCode: null,
        stdout,
        stderr: stderr || (error instanceof Error ? error.message : "OCI fixture spawn failed."),
      });
    });
    child.once("close", (code) => finish({ exitCode: code, stdout, stderr }));
  });
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(scriptPath)) {
  (async () => {
    await verifyOciSandboxFixture();
    await verifyOciSandboxJobFixture();
  })().then(
    () => console.log("[verify:command-sandbox-oci] all OCI isolation and command job fixtures passed"),
    (error) => {
      console.error("[verify:command-sandbox-oci] " + (error instanceof Error ? error.message : String(error)));
      process.exitCode = 1;
    },
  );
}
