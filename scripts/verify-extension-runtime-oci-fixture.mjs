import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { HookRegistry } from "../packages/belldandy-agent/dist/hooks.js";
import { ToolExecutor } from "../packages/belldandy-skills/dist/executor.js";

import { createOciExtensionRuntimeAdapter } from "../packages/belldandy-core/dist/extension-runtime-oci-adapter.js";
import { getExtensionRuntimeLeaseRoot } from "../packages/belldandy-core/dist/extension-runtime-lease.js";
import { ExtensionRuntimeSupervisor } from "../packages/belldandy-core/dist/extension-runtime-supervisor.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function readExtensionRuntimeFixtureEnvironment(name, env = process.env) {
  const direct = env[name];
  if (direct) return direct;
  const fallback = {
    BELLDANDY_EXTENSION_HOST_BACKEND: env.BELLDANDY_COMMAND_SANDBOX_BACKEND,
    BELLDANDY_EXTENSION_HOST_OCI_RUNTIME: env.BELLDANDY_COMMAND_SANDBOX_OCI_RUNTIME,
    BELLDANDY_EXTENSION_HOST_OCI_IMAGE: env.BELLDANDY_COMMAND_SANDBOX_OCI_IMAGE,
  };
  return fallback[name];
}

function runRuntimeCommand(runtime, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(runtime, args, {
      cwd: repositoryRoot,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function writeFixturePlugin(extensionRoot) {
  await fs.mkdir(path.join(extensionRoot, "dist"), { recursive: true });
  await fs.writeFile(path.join(extensionRoot, "visible.txt"), "extension-visible", "utf8");
  await fs.writeFile(path.join(extensionRoot, "dist", "plugin.mjs"), `
    import fs from "node:fs";

    function observe() {
      const probeWrite = (target) => {
        try { fs.writeFileSync(target, "must-not-write"); return true; } catch { return false; }
      };
      return {
        extensionVisible: fs.readFileSync("/extension/visible.txt", "utf8") === "extension-visible",
        workspaceVisible: fs.existsSync("/workspace/sentinel.txt"),
        stateVisible: fs.existsSync("/state/sentinel.txt"),
        hostSecretVisible: Boolean(process.env.BELLDANDY_EXTENSION_FIXTURE_SECRET),
        extensionWritable: probeWrite("/extension/plugin-write.txt"),
        rootfsWritable: probeWrite("/belldandy-rootfs-write-probe"),
        networkInterfaces: fs.readdirSync("/sys/class/net").sort()
      };
    }

    const topLevel = observe();
    export default {
      id: "isolation-fixture",
      name: "Isolation Fixture",
      async activate(context) {
        const activation = observe();
        context.registerTool({
          definition: {
            name: "extension_isolation_probe",
            description: "Probe Extension Host isolation",
            parameters: { type: "object", properties: {} }
          },
          contract: {
            name: "extension_isolation_probe",
            family: "other",
            isReadOnly: true,
            isConcurrencySafe: true,
            needsPermission: false,
            riskLevel: "low",
            channels: ["gateway"],
            safeScopes: ["remote-safe"],
            activityDescription: "Probe Extension Host isolation",
            resultSchema: { kind: "json", description: "Isolation result" },
            outputPersistencePolicy: "none"
          },
          async execute(_args, toolContext) {
            return {
              id: "host-result",
              name: "extension_isolation_probe",
              success: true,
              output: JSON.stringify({
                topLevel,
                activation,
                tool: observe(),
                toolContextKeys: Object.keys(toolContext).sort()
              }),
              durationMs: 0
            };
          }
        });
        context.registerHooks({
          beforeToolCall: async () => ({ isolationHook: observe() })
        });
      }
    };
  `, "utf8");
}

function assertIsolationObservation(observation) {
  assert.equal(observation.extensionVisible, true);
  assert.equal(observation.workspaceVisible, false);
  assert.equal(observation.stateVisible, false);
  assert.equal(observation.hostSecretVisible, false);
  assert.equal(observation.extensionWritable, false);
  assert.equal(observation.rootfsWritable, false);
  assert.deepEqual(observation.networkInterfaces, ["lo"]);
}

export async function verifyExtensionRuntimeOciFixture(input = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-extension-runtime-fixture-"));
  try {
  const stateDir = path.join(root, "state");
  const workspaceRoot = path.join(root, "workspace");
  const extensionRoot = path.join(root, "extension");
  await Promise.all([
    fs.mkdir(stateDir, { recursive: true }),
    fs.mkdir(workspaceRoot, { recursive: true }),
    fs.mkdir(extensionRoot, { recursive: true }),
  ]);
  await fs.writeFile(path.join(stateDir, "sentinel.txt"), "state-unchanged", "utf8");
  await fs.writeFile(path.join(workspaceRoot, "sentinel.txt"), "workspace-unchanged", "utf8");
  await writeFixturePlugin(extensionRoot);

  const previousSecret = process.env.BELLDANDY_EXTENSION_FIXTURE_SECRET;
  process.env.BELLDANDY_EXTENSION_FIXTURE_SECRET = "must-not-enter-host";
  let supervisor;
  try {
    const admission = await createOciExtensionRuntimeAdapter({
      stateDir,
      hostRoot: path.join(repositoryRoot, "packages", "belldandy-core", "dist"),
      readEnv: (name) => readExtensionRuntimeFixtureEnvironment(name, input.env ?? process.env),
    });
    if (!admission.available) {
      throw new Error(`OCI Extension Host fixture unavailable: ${admission.reason}`);
    }

    const toolExecutor = new ToolExecutor({ tools: [], workspaceRoot });
    const hookRegistry = new HookRegistry();
    supervisor = new ExtensionRuntimeSupervisor({
      stateDir,
      adapter: admission.adapter,
      toolExecutor,
      hookRegistry,
    });
    await supervisor.activateVerifiedExtension({
      extensionId: "isolation-fixture@local",
      extensionName: "isolation-fixture",
      installPath: extensionRoot,
      pluginModuleRelativePath: "dist/plugin.mjs",
      contentSha256: "a".repeat(64),
      hostApi: 2,
      permissions: ["tool:extension_isolation_probe", "hook:beforeToolCall"],
      runtimeCapabilities: [],
      skillDirs: [],
    });

    const toolResult = await toolExecutor.execute({
      id: "isolation-call",
      name: "extension_isolation_probe",
      arguments: {},
    }, "isolation-conversation", "isolation-agent");
    assert.equal(toolResult.success, true, toolResult.error);
    const probe = JSON.parse(toolResult.output);
    assertIsolationObservation(probe.topLevel);
    assertIsolationObservation(probe.activation);
    assertIsolationObservation(probe.tool);
    assert.deepEqual(probe.toolContextKeys, ["abortSignal", "agentId", "conversationId"]);

    const hook = hookRegistry.getHooks("before_tool_call")[0];
    assert.ok(hook);
    const hookResult = await hook.handler(
      { toolName: "file_read", params: { path: "README.md" } },
      { agentId: "isolation-agent", sessionKey: "isolation-conversation", toolName: "file_read" },
    );
    assertIsolationObservation(hookResult.params.isolationHook);
  } finally {
    await supervisor?.dispose().catch(() => {});
    if (previousSecret === undefined) delete process.env.BELLDANDY_EXTENSION_FIXTURE_SECRET;
    else process.env.BELLDANDY_EXTENSION_FIXTURE_SECRET = previousSecret;
  }

  assert.equal(await fs.readFile(path.join(stateDir, "sentinel.txt"), "utf8"), "state-unchanged");
  assert.equal(await fs.readFile(path.join(workspaceRoot, "sentinel.txt"), "utf8"), "workspace-unchanged");
  await assert.rejects(fs.access(path.join(extensionRoot, "plugin-write.txt")));

  const runtime = readExtensionRuntimeFixtureEnvironment("BELLDANDY_EXTENSION_HOST_OCI_RUNTIME", input.env ?? process.env) ?? "docker";
  const residual = await runRuntimeCommand(runtime, [
    "ps", "--all", "--quiet", "--filter", "label=com.star-sanctuary.extension-runtime.lease",
  ]);
  assert.equal(residual.code, 0, residual.stderr);
  assert.equal(residual.stdout.trim(), "", `residual extension containers: ${residual.stdout.trim()}`);
  const leaseEntries = await fs.readdir(getExtensionRuntimeLeaseRoot(stateDir)).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  assert.deepEqual(leaseEntries, []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyExtensionRuntimeOciFixture()
    .then(() => console.log("[verify:extension-runtime-oci] isolation and lease cleanup passed"))
    .catch((error) => {
      console.error(`[verify:extension-runtime-oci] ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
