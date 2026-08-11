/**
 * bdd doctor — Health check / diagnostic command.
 * Checks Node version, state dir, env config, port availability, memory DB, MCP config.
 */
import { defineCommand } from "citty";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import pc from "picocolors";
import {
  buildDefaultProfile,
  isResidentAgentProfile,
  loadAgentProfiles,
  resolveAgentProfileMetadata,
} from "@belldandy/agent";
import { createCLIContext } from "../shared/context.js";
import {
  loadProjectEnvFiles,
  resolveEnvPath,
  resolveEnvLocalPath,
} from "../shared/env-loader.js";
import {
  buildToolBehaviorObservability,
  readConfiguredPromptExperimentToolContracts,
} from "../../tool-behavior-observability.js";
import {
  buildCameraRuntimeDoctorReport,
  buildGoCodeIntelDoctorReport,
  buildToolContractV2Summary,
  listToolContractsV2,
} from "@belldandy/skills";
import { readMcpRoutingDoctorReport } from "../../mcp-config-routing.js";
import { buildResidentAgentObservabilitySnapshot } from "../../resident-agent-observability.js";
import { resolveResidentMemoryPolicy } from "../../resident-memory-policy.js";
import { buildDeploymentBackendsDoctorReport } from "../../deployment-backends.js";
import { buildOptionalCapabilitiesDoctorReport } from "../../optional-capabilities-doctor.js";
import { readRuntimeResilienceDoctorReport } from "../../runtime-resilience.js";
import { buildRuntimeResilienceDiagnosticSummary } from "../../runtime-resilience-diagnostics.js";
import { requestModelConnectivityCheck } from "../../model-connectivity-check.js";

interface CheckResult {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
  fix?: string;
}

type OpenAIWireApi = "chat_completions" | "responses";

const REQUIRED_NODE_MAJOR = 22;
const REQUIRED_NODE_MINOR = 12;
const DEFAULT_PORT = 28889;

function resolveExecutableOnPath(candidates: string[]): string | null {
  const rawPath = process.env.PATH ?? "";
  if (!rawPath.trim()) return null;

  const pathEntries = rawPath.split(path.delimiter).filter(Boolean);
  const executableNames = process.platform === "win32"
    ? candidates.flatMap((candidate) => {
      const ext = path.extname(candidate).toLowerCase();
      if (ext) {
        return [candidate];
      }
      const pathext = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
        .split(";")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
      return [...new Set([candidate, ...pathext.map((suffix) => `${candidate}${suffix}`)])];
    })
    : candidates;

  for (const dir of pathEntries) {
    for (const executableName of executableNames) {
      const targetPath = path.join(dir, executableName);
      try {
        if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
          return targetPath;
        }
      } catch {
        // ignore invalid PATH entries
      }
    }
  }
  return null;
}

function resolveOpenAIWireApi(): OpenAIWireApi {
  const raw = (process.env.BELLDANDY_OPENAI_WIRE_API ?? "chat_completions").trim().toLowerCase();
  return raw === "responses" ? "responses" : "chat_completions";
}

function checkNodeVersion(): CheckResult {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major! > REQUIRED_NODE_MAJOR || (major === REQUIRED_NODE_MAJOR && minor! >= REQUIRED_NODE_MINOR)) {
    return { name: "Node.js version", status: "pass", message: `v${process.versions.node}` };
  }
  return {
    name: "Node.js version",
    status: "fail",
    message: `v${process.versions.node} (requires >= ${REQUIRED_NODE_MAJOR}.${REQUIRED_NODE_MINOR}.0)`,
    fix: "Install Node.js >= 22.12.0",
  };
}

async function checkPnpm(): Promise<CheckResult> {
  try {
    const { execFileSync } = await import("node:child_process");
    const commandCandidates = [
      {
        file: process.platform === "win32" ? "pnpm.cmd" : "pnpm",
        args: ["--version"],
        via: "",
      },
      {
        file: process.platform === "win32" ? "corepack.cmd" : "corepack",
        args: ["pnpm", "--version"],
        via: " (via corepack)",
      },
    ];
    for (const candidate of commandCandidates) {
      try {
        const version = execFileSync(candidate.file, candidate.args, { encoding: "utf-8", timeout: 5000 }).trim();
        if (version) {
          return { name: "pnpm", status: "pass", message: `v${version}${candidate.via}` };
        }
      } catch {
        // try next candidate
      }
    }
  } catch {
    // fall through to warning below
  }
  const corepackPath = resolveExecutableOnPath(["corepack", "corepack.cmd"]);
  if (corepackPath) {
    return {
      name: "pnpm",
      status: "pass",
      message: `available via corepack (${corepackPath})`,
    };
  }
  return { name: "pnpm", status: "warn", message: "not found", fix: "Install pnpm: corepack enable && corepack prepare pnpm@latest --activate" };
}

function checkStateDir(stateDir: string): CheckResult {
  try {
    fs.accessSync(stateDir, fs.constants.R_OK | fs.constants.W_OK);
    return { name: "State directory", status: "pass", message: stateDir };
  } catch {
    if (!fs.existsSync(stateDir)) {
      return { name: "State directory", status: "fail", message: `${stateDir} does not exist`, fix: `Create it: mkdir "${stateDir}"` };
    }
    return { name: "State directory", status: "fail", message: `${stateDir} is not writable`, fix: "Check directory permissions" };
  }
}

function checkEnvLocal(envDir: string): CheckResult {
  const envPath = resolveEnvLocalPath(envDir);
  if (fs.existsSync(envPath)) {
    return { name: ".env.local", status: "pass", message: envPath };
  }
  return { name: ".env.local", status: "warn", message: "not found", fix: "Run 'bdd setup' to create initial configuration" };
}

function checkRequiredEnv(envDir: string): CheckResult[] {
  const results: CheckResult[] = [];
  const envPath = resolveEnvLocalPath(envDir);
  loadProjectEnvFiles({
    envPath: resolveEnvPath(envDir),
    envLocalPath: envPath,
  });

  const provider = process.env.BELLDANDY_AGENT_PROVIDER ?? "mock";
  results.push({
    name: "Agent provider",
    status: provider === "mock" ? "warn" : "pass",
    message: provider,
    ...(provider === "mock" ? { fix: "Set BELLDANDY_AGENT_PROVIDER=openai for real LLM" } : {}),
  });

  if (provider === "openai") {
    const baseUrl = process.env.BELLDANDY_OPENAI_BASE_URL;
    const apiKey = process.env.BELLDANDY_OPENAI_API_KEY;
    const model = process.env.BELLDANDY_OPENAI_MODEL;
    const wireApi = resolveOpenAIWireApi();

    results.push({
      name: "OpenAI Base URL",
      status: baseUrl ? "pass" : "fail",
      message: baseUrl ?? "not set",
      ...(!baseUrl ? { fix: "bdd config set BELLDANDY_OPENAI_BASE_URL <url>" } : {}),
    });
    results.push({
      name: "OpenAI API Key",
      status: apiKey ? "pass" : "fail",
      message: apiKey ? "configured" : "not set",
      ...(!apiKey ? { fix: "bdd config set BELLDANDY_OPENAI_API_KEY <key>" } : {}),
    });
    results.push({
      name: "OpenAI Model",
      status: model ? "pass" : "fail",
      message: model ?? "not set",
      ...(!model ? { fix: "bdd config set BELLDANDY_OPENAI_MODEL <model>" } : {}),
    });
    results.push({
      name: "OpenAI Wire API",
      status: "pass",
      message: wireApi,
    });
  }

  return results;
}

function checkPort(port: number): Promise<CheckResult> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        resolve({ name: `Port ${port}`, status: "warn", message: "in use", fix: `Another process is using port ${port}. Change with BELLDANDY_PORT` });
      } else {
        resolve({ name: `Port ${port}`, status: "warn", message: err.message });
      }
    });
    server.once("listening", () => {
      server.close(() => {
        resolve({ name: `Port ${port}`, status: "pass", message: "available" });
      });
    });
    server.listen(port, "127.0.0.1");
  });
}

function checkMemoryDb(stateDir: string): CheckResult {
  // 新默认：memory.sqlite（Gateway 使用）
  const defaultNew = path.join(stateDir, "memory.sqlite");
  // 兼容旧默认：memory.db（历史版本）
  const legacy = path.join(stateDir, "memory.db");

  const override = process.env.BELLDANDY_MEMORY_DB;
  const dbPath = override ?? defaultNew;

  if (fs.existsSync(dbPath)) {
    try {
      fs.accessSync(dbPath, fs.constants.R_OK | fs.constants.W_OK);
      return { name: "Memory DB", status: "pass", message: dbPath };
    } catch {
      return { name: "Memory DB", status: "warn", message: `${dbPath} exists but not writable` };
    }
  }

  // 没有新库但发现旧库：给出明确提示，避免“以为失效”的错觉
  if (!override && fs.existsSync(legacy)) {
    return {
      name: "Memory DB",
      status: "warn",
      message: `${defaultNew} not found (legacy DB found: ${legacy})`,
      fix: `Rename "${legacy}" -> "${defaultNew}" (or set BELLDANDY_MEMORY_DB="${legacy}")`,
    };
  }

  return { name: "Memory DB", status: "warn", message: "not created yet (will be created on first start)" };
}

async function checkMcpConfig(stateDir: string): Promise<CheckResult> {
  const report = await readMcpRoutingDoctorReport(stateDir);
  if (!report.exists) {
    return { name: "MCP config", status: "pass", message: "not configured (optional)" };
  }
  if (report.parseError) {
    return { name: "MCP config", status: "warn", message: `Parse error: ${report.parseError}` };
  }
  return { name: "MCP config", status: "pass", message: `${report.serverCount} server(s) configured` };
}

async function checkStarweaverMcpRouting(stateDir: string): Promise<CheckResult> {
  const report = await readMcpRoutingDoctorReport(stateDir);
  if (report.parseError) {
    return {
      name: "Starweaver MCP Routing",
      status: "warn",
      message: `Unavailable: ${report.parseError}`,
      fix: "Fix mcp.json before relying on Star Weaver MCP routes.",
    };
  }

  const status = report.starweaver.status === "central_primary" || report.starweaver.status === "not_configured"
    ? "pass"
    : "warn";
  return {
    name: "Starweaver MCP Routing",
    status,
    message: report.starweaver.headline,
    fix: status === "warn" ? report.starweaver.fix : undefined,
  };
}

function formatDoctorKeyCountSummary(value: Record<string, number> | undefined): string {
  const entries = Object.entries(value ?? {}).filter(([, count]) => Number.isFinite(count) && Number(count) > 0);
  if (!entries.length) {
    return "-";
  }
  return entries.map(([key, count]) => `${key}:${count}`).join(", ");
}

async function checkModelConnectivity(): Promise<CheckResult> {
  const baseUrl = process.env.BELLDANDY_OPENAI_BASE_URL;
  const apiKey = process.env.BELLDANDY_OPENAI_API_KEY;
  const model = process.env.BELLDANDY_OPENAI_MODEL;
  const wireApi = resolveOpenAIWireApi();

  if (!baseUrl || !apiKey || !model) {
    return { name: "Model connectivity", status: "warn", message: "skipped (missing config)" };
  }

  try {
    const result = await requestModelConnectivityCheck({
      baseUrl,
      apiKey,
      model,
      wireApi,
      timeoutMs: 10_000,
    });
    if (result.ok) {
      return { name: "Model connectivity", status: "pass", message: `${model} reachable` };
    }
    return {
      name: "Model connectivity",
      status: "fail",
      message: `HTTP ${result.status}: ${result.responseBody.slice(0, 100)}`,
    };
  } catch (err) {
    return {
      name: "Model connectivity",
      status: "fail",
      message: err instanceof Error ? err.message : String(err),
      fix: "Check BELLDANDY_OPENAI_BASE_URL and network connectivity",
    };
  }
}

export default defineCommand({
  meta: { name: "doctor", description: "Check system health and configuration" },
  args: {
    json: { type: "boolean", description: "JSON output" },
    "state-dir": { type: "string", description: "Override state directory" },
    "check-model": { type: "boolean", description: "Test model API connectivity (sends a minimal request)" },
  },
  async run({ args }) {
    const ctx = createCLIContext({ json: args.json, stateDir: args["state-dir"] });
    const stateDir = ctx.stateDir;
    const port = Number(process.env.BELLDANDY_PORT ?? DEFAULT_PORT);

    const results: CheckResult[] = [];
    const envLocalCheck = checkEnvLocal(ctx.envDir);
    const requiredEnvChecks = checkRequiredEnv(ctx.envDir);
    const deploymentBackends = buildDeploymentBackendsDoctorReport({ stateDir });

    const [
      pnpmCheck,
      portCheck,
      modelConnectivityCheck,
      configuredProfiles,
      optionalCapabilities,
      codeIntelGo,
      cameraRuntime,
      runtimeResilience,
      mcpConfigCheck,
      starweaverRoutingCheck,
      mcpRouting,
    ] = await Promise.all([
      checkPnpm(),
      checkPort(port),
      args["check-model"] ? checkModelConnectivity() : Promise.resolve<CheckResult | undefined>(undefined),
      loadAgentProfiles(path.join(stateDir, "agents.json")),
      buildOptionalCapabilitiesDoctorReport(),
      buildGoCodeIntelDoctorReport(),
      buildCameraRuntimeDoctorReport({
        context: {
          conversationId: "bdd.doctor",
          workspaceRoot: process.cwd(),
          stateDir,
        },
      }),
      readRuntimeResilienceDoctorReport(stateDir),
      checkMcpConfig(stateDir),
      checkStarweaverMcpRouting(stateDir),
      readMcpRoutingDoctorReport(stateDir),
    ]);

    results.push(checkNodeVersion());
    results.push(pnpmCheck);
    results.push(checkStateDir(stateDir));
    results.push({ name: "Environment directory", status: "pass", message: ctx.stateDir });
    results.push(envLocalCheck);
    results.push(...requiredEnvChecks);
    results.push(portCheck);
    results.push(checkMemoryDb(stateDir));
    results.push(mcpConfigCheck);
    results.push(starweaverRoutingCheck);
    if (args["check-model"]) {
      results.push(modelConnectivityCheck ?? { name: "Model connectivity", status: "warn", message: "skipped" });
    }

    const toolBehaviorObservability = buildToolBehaviorObservability({
      disabledContractNamesConfigured: readConfiguredPromptExperimentToolContracts(),
    });
    const toolContractV2Observability = {
      summary: buildToolContractV2Summary(listToolContractsV2()),
    };
    const residentProfiles = [
      buildDefaultProfile(),
      ...configuredProfiles.filter((profile) => profile.id !== "default" && isResidentAgentProfile(profile)),
    ];
    const residentAgents = await buildResidentAgentObservabilitySnapshot({
      agents: residentProfiles.map((profile) => {
        const metadata = resolveAgentProfileMetadata(profile);
        return {
          id: profile.id,
          displayName: profile.displayName,
          model: profile.model,
          kind: "resident" as const,
          workspaceBinding: metadata.workspaceBinding,
          sessionNamespace: metadata.sessionNamespace,
          memoryMode: metadata.memoryMode,
          status: "configured",
          memoryPolicy: resolveResidentMemoryPolicy(stateDir, profile),
        };
      }),
    });
    results.push({
      name: "Resident agents",
      status: residentAgents.summary.totalCount > 0 ? "pass" : "warn",
      message: residentAgents.summary.headline,
    });
    results.push({
      name: "Deployment Backends",
      status: deploymentBackends.summary.warningCount > 0 || deploymentBackends.summary.selectedResolved === false
        ? "warn"
        : "pass",
      message: deploymentBackends.headline,
      fix: !deploymentBackends.configExists
        ? `Create ${deploymentBackends.configPath} or start gateway once to materialize the default profile`
        : deploymentBackends.summary.selectedResolved === false
          ? `Update selectedProfileId in ${deploymentBackends.configPath}`
          : undefined,
    });
    results.push({
      name: "Optional Capabilities",
      status: optionalCapabilities.summary.warnCount > 0 ? "warn" : "pass",
      message: optionalCapabilities.summary.headline,
      fix: optionalCapabilities.summary.fix,
    });
    results.push({
      name: "Go CodeIntel",
      status: codeIntelGo.summary.status === "unavailable"
        || codeIntelGo.summary.status === "incompatible"
        ? "warn"
        : "pass",
      message: codeIntelGo.summary.headline,
    });
    if (cameraRuntime) {
      results.push({
        name: "Camera Runtime",
        status: cameraRuntime.summary.errorCount > 0
          ? "warn"
          : cameraRuntime.summary.warningCount > 0
            ? "warn"
            : "pass",
        message: cameraRuntime.summary.headline,
        fix: cameraRuntime.summary.fix,
      });
    }
    const runtimeResilienceDiagnostics = runtimeResilience
      ? buildRuntimeResilienceDiagnosticSummary(runtimeResilience)
      : undefined;
    if (runtimeResilience) {
      results.push({
        name: "Runtime Resilience",
        status: runtimeResilienceDiagnostics?.alertLevel ?? "warn",
        message: runtimeResilienceDiagnostics
          ? `${runtimeResilienceDiagnostics.alertCode}: ${runtimeResilienceDiagnostics.alertMessage}`
          : "runtime diagnostics unavailable",
      });
    }

    // Output
    if (ctx.json) {
      const summary = {
        pass: results.filter((r) => r.status === "pass").length,
        warn: results.filter((r) => r.status === "warn").length,
        fail: results.filter((r) => r.status === "fail").length,
      };
      ctx.output({
        checks: results,
        summary,
        configSource: {
          stateDir: ctx.stateDir,
          envDir: ctx.envDir,
          stateDirSource: ctx.stateDirSource,
          ...(ctx.stateDirBootstrapFilePath ? { stateDirBootstrapFilePath: ctx.stateDirBootstrapFilePath } : {}),
        },
        toolBehaviorObservability,
        toolContractV2Observability,
        residentAgents,
        deploymentBackends,
        optionalCapabilities,
        codeIntelGo,
        mcpRouting,
        ...(cameraRuntime ? { cameraRuntime } : {}),
        ...(runtimeResilience ? { runtimeResilience } : {}),
        ...(runtimeResilienceDiagnostics ? { runtimeResilienceDiagnostics } : {}),
      });
      return;
    }

    ctx.log("Star Sanctuary Doctor\n");
    ctx.log(`  State Dir Source: ${ctx.stateDirSource}${ctx.stateDirBootstrapFilePath ? ` (${ctx.stateDirBootstrapFilePath})` : ""}`);
    for (const r of results) {
      const icon = r.status === "pass" ? "\u2713" : r.status === "warn" ? "\u26A0" : "\u2717";
      const colorFn =
        r.status === "pass" ? pc.green : r.status === "warn" ? pc.yellow : pc.red;

      ctx.log(colorFn(`  ${icon} ${r.name}: ${r.message}`));
      if (r.fix && r.status !== "pass") {
        ctx.log(`    \u2192 ${r.fix}`);
      }
    }

    ctx.log("");
    ctx.log("Tool Behavior Observability");
    ctx.log(`  included contracts: ${toolBehaviorObservability.counts.includedContractCount}`);
    ctx.log(`  included: ${toolBehaviorObservability.included.join(", ") || "(none)"}`);
    ctx.log(
      `  disabled by experiment: ${toolBehaviorObservability.experiment?.disabledContractNamesConfigured.join(", ") || "(none)"}`,
    );
    ctx.log("");
    ctx.log("Resident Agents");
    ctx.log(`  total: ${residentAgents.summary.totalCount}`);
    ctx.log(
      `  runtime: running ${residentAgents.summary.runningCount}, background ${residentAgents.summary.backgroundCount}, idle ${residentAgents.summary.idleCount}, error ${residentAgents.summary.errorCount}`,
    );
    ctx.log(
      `  digest: ready ${residentAgents.summary.digestReadyCount}, updated ${residentAgents.summary.digestUpdatedCount}, idle ${residentAgents.summary.digestIdleCount}, missing ${residentAgents.summary.digestMissingCount}`,
    );
    for (const agent of residentAgents.agents.slice(0, 3)) {
      ctx.log(`  - ${agent.displayName}: ${agent.observabilityHeadline ?? agent.memoryMode}`);
    }
    ctx.log("");
    ctx.log("Deployment Backends");
    ctx.log(`  config: ${deploymentBackends.configPath}`);
    ctx.log(`  profiles: ${deploymentBackends.summary.enabledCount}/${deploymentBackends.summary.profileCount} enabled`);
    ctx.log(
      `  selected: ${deploymentBackends.summary.selectedProfileId ?? "-"} (${deploymentBackends.summary.selectedBackend ?? "-"})`,
    );
    ctx.log(
      `  kinds: local ${deploymentBackends.summary.backendCounts.local}, docker ${deploymentBackends.summary.backendCounts.docker}, ssh ${deploymentBackends.summary.backendCounts.ssh}`,
    );
    for (const item of deploymentBackends.items.slice(0, 3)) {
      ctx.log(`  - ${item.label}: ${item.message}`);
    }
    ctx.log("");
    ctx.log("Optional Capabilities");
    ctx.log(`  headline: ${optionalCapabilities.summary.headline}`);
    for (const item of optionalCapabilities.items) {
      ctx.log(`  - ${item.name}: ${item.message}`);
      ctx.log(`    impact: ${item.impact}`);
      if (item.fix) {
        ctx.log(`    fix: ${item.fix}`);
      }
    }
    if (cameraRuntime) {
      ctx.log("");
      ctx.log("Camera Runtime");
      ctx.log(`  headline: ${cameraRuntime.summary.headline}`);
      ctx.log(`  providers: ${cameraRuntime.summary.registeredProviderIds.join(", ") || "(none)"}`);
      if (cameraRuntime.summary.defaultProviderId) {
        ctx.log(`  default: ${cameraRuntime.summary.defaultProviderId}`);
      }
      if (cameraRuntime.summary.defaultSelection) {
        const attempts = Array.isArray(cameraRuntime.summary.defaultSelection.attempts)
          ? cameraRuntime.summary.defaultSelection.attempts.map((attempt) => {
            const bits: string[] = [attempt.provider, attempt.outcome, attempt.reason];
            if (attempt.detail) {
              bits.push(attempt.detail);
            }
            return bits.join(":");
          })
          : [];
        ctx.log(
          `  default selection: policy=${cameraRuntime.summary.defaultSelection.policy}, selected=${cameraRuntime.summary.defaultSelection.selectedProvider}, reason=${cameraRuntime.summary.defaultSelection.reason}, fallback=${cameraRuntime.summary.defaultSelection.fallbackApplied ? "yes" : "no"}`,
        );
        ctx.log(`  provider order: ${cameraRuntime.summary.defaultSelection.preferredOrder.join(" -> ")}`);
        ctx.log(`  registered providers: ${cameraRuntime.summary.defaultSelection.registeredProviders.join(", ") || "(none)"}`);
        ctx.log(`  fallback ready: ${cameraRuntime.summary.defaultSelection.availableFallbackProviders.join(", ") || "(none)"}`);
        ctx.log(`  missing fallbacks: ${cameraRuntime.summary.defaultSelection.missingFallbackProviders.join(", ") || "(none)"}`);
        if (cameraRuntime.summary.defaultSelection.skippedPreferredProviders.length) {
          ctx.log(`  skipped preferred: ${cameraRuntime.summary.defaultSelection.skippedPreferredProviders.join(", ")}`);
        }
        if (cameraRuntime.summary.defaultSelection.configuredDefaultProvider) {
          ctx.log(`  configured default: ${cameraRuntime.summary.defaultSelection.configuredDefaultProvider}`);
        }
        if (attempts.length) {
          ctx.log(`  selection trace: ${attempts.join(" -> ")}`);
        }
      }
      if (cameraRuntime.summary.governance) {
        ctx.log(`  governance: ${cameraRuntime.summary.governance.headline}`);
        ctx.log(
          `  governance counts: blocked=${cameraRuntime.summary.governance.blockedProviderCount}, permission_blocked=${cameraRuntime.summary.governance.permissionBlockedProviderCount}, permission_prompt=${cameraRuntime.summary.governance.permissionPromptProviderCount}, fallback_active=${cameraRuntime.summary.governance.fallbackActiveProviderCount}`,
        );
        ctx.log(
          `  recent trend: failures=${cameraRuntime.summary.governance.recentFailureCount}, recovered=${cameraRuntime.summary.governance.recentRecoveredCount}, failureProviders=${cameraRuntime.summary.governance.failureProviderCount}, repeatedFallback=${cameraRuntime.summary.governance.repeatedFallback ? "yes" : "no"}, dominant=${cameraRuntime.summary.governance.dominantFailureCode ?? "-"}`,
        );
        if (cameraRuntime.summary.governance.whyUnhealthy) {
          ctx.log(`  why unhealthy: ${cameraRuntime.summary.governance.whyUnhealthy}`);
        }
        if (cameraRuntime.summary.governance.whyFallback) {
          ctx.log(`  why fallback: ${cameraRuntime.summary.governance.whyFallback}`);
        }
        if (cameraRuntime.summary.governance.recommendedAction) {
          ctx.log(`  next action: ${cameraRuntime.summary.governance.recommendedAction}`);
        }
      }
      for (const provider of cameraRuntime.providers) {
        ctx.log(`  - ${provider.id}: ${provider.headline}`);
        if (provider.launchConfig) {
          ctx.log(`    launch: ${provider.launchConfig.command}`);
          if (provider.launchConfig.resolvedCommand) {
            ctx.log(`    resolved command: ${provider.launchConfig.resolvedCommand}`);
          }
          if (provider.launchConfig.helperEntry) {
            ctx.log(`    entry: ${provider.launchConfig.helperEntry}`);
          }
          if (provider.launchConfig.resolvedHelperEntry) {
            ctx.log(`    resolved entry: ${provider.launchConfig.resolvedHelperEntry}`);
          }
          if (provider.launchConfig.cwd) {
            ctx.log(`    cwd: ${provider.launchConfig.cwd}`);
          }
          if (provider.launchConfig.runtimeDir) {
            ctx.log(`    runtimeDir: ${provider.launchConfig.runtimeDir}`);
          }
        }
        if (provider.sampleDevices?.length) {
          for (const device of provider.sampleDevices) {
            ctx.log(`    device: ${device}`);
          }
        }
        const aliasMemory = provider.metadata && typeof provider.metadata === "object"
          ? (provider.metadata as Record<string, unknown>).aliasMemory as Record<string, unknown> | undefined
          : undefined;
        if (aliasMemory) {
          ctx.log(
            `    alias memory: entries=${aliasMemory.entryCount ?? "-"}, observed=${aliasMemory.observedCount ?? "-"}`
            + `, manual=${aliasMemory.manualAliasCount ?? "-"}, favorite=${aliasMemory.favoriteCount ?? "-"}`
            + (typeof aliasMemory.snapshotPath === "string" ? `, snapshot=${aliasMemory.snapshotPath}` : ""),
          );
        }
        if (provider.runtimeHealth) {
          ctx.log(
            `    runtime health: status=${provider.runtimeHealth.status}, failures=${provider.runtimeHealth.consecutiveFailures}, lastSuccess=${provider.runtimeHealth.lastSuccessAt ?? "-"}`,
          );
          const historyWindow = provider.runtimeHealth.historyWindow;
          if (historyWindow) {
            ctx.log(
              `    runtime window: events=${historyWindow.eventCount}, success=${historyWindow.successCount}, failure=${historyWindow.failureCount}, recovered=${historyWindow.recoveredSuccessCount}, codes=${formatDoctorKeyCountSummary(historyWindow.failureCodeCounts)}`,
            );
            const lastEvents = Array.isArray(historyWindow.lastEvents) ? historyWindow.lastEvents.slice(-3) : [];
            if (lastEvents.length) {
              ctx.log(
                `    recent events: ${lastEvents.map((event) => {
                  const outcomeBits: string[] = [event.outcome];
                  if (event.code) {
                    outcomeBits.push(event.code);
                  }
                  if (event.recovered) {
                    outcomeBits.push("recovered");
                  }
                  return `${event.operation}/${outcomeBits.join(":")}`;
                }).join(" -> ")}`,
              );
            }
          }
          if (provider.runtimeHealth.lastFailure) {
            ctx.log(
              `    last failure: ${provider.runtimeHealth.lastFailure.code ?? "unknown"} @ ${provider.runtimeHealth.lastFailure.at} (${provider.runtimeHealth.lastFailure.operation}) ${provider.runtimeHealth.lastFailure.message}`,
            );
            if (provider.runtimeHealth.lastFailure.recoveryHint) {
              ctx.log(`    recovery: ${provider.runtimeHealth.lastFailure.recoveryHint}`);
            }
          }
          if (provider.runtimeHealth.lastRecoveryAt) {
            ctx.log(`    recovered at: ${provider.runtimeHealth.lastRecoveryAt}`);
          }
        }
        if (provider.healthCheck) {
          ctx.log(
            `    health check: status=${provider.healthCheck.status}, source=${provider.healthCheck.source}, sources=${provider.healthCheck.sources.join(", ") || "(none)"}, actionable=${provider.healthCheck.actionable ? "yes" : "no"}, codes=${provider.healthCheck.reasonCodes.join(", ") || "(none)"}`,
          );
          ctx.log(`    governance: ${provider.healthCheck.headline}`);
          ctx.log(
            `    permission: state=${provider.healthCheck.permission.state}, gating=${provider.healthCheck.permission.gating}, actionable=${provider.healthCheck.permission.actionable ? "yes" : "no"}`,
          );
          ctx.log(
            `    failure stats: total=${provider.healthCheck.failureStats.issueCounts.total}, info=${provider.healthCheck.failureStats.issueCounts.info}, warning=${provider.healthCheck.failureStats.issueCounts.warning}, error=${provider.healthCheck.failureStats.issueCounts.error}, retryable=${provider.healthCheck.failureStats.issueCounts.retryable}, dominant=${provider.healthCheck.failureStats.dominantReasonCode ?? "-"}`,
          );
          if (provider.healthCheck.failureStats.runtimeWindow) {
            ctx.log(
              `    failure window: events=${provider.healthCheck.failureStats.runtimeWindow.eventCount}, success=${provider.healthCheck.failureStats.runtimeWindow.successCount}, failure=${provider.healthCheck.failureStats.runtimeWindow.failureCount}, recovered=${provider.healthCheck.failureStats.runtimeWindow.recoveredSuccessCount}, dominant=${provider.healthCheck.failureStats.runtimeWindow.dominantFailureCode ?? "-"}, last=${provider.healthCheck.failureStats.runtimeWindow.lastFailureCode ?? "-"}`,
            );
          }
          if (Object.keys(provider.healthCheck.failureStats.reasonCodeCounts).length) {
            ctx.log(`    failure codes: ${formatDoctorKeyCountSummary(provider.healthCheck.failureStats.reasonCodeCounts)}`);
          }
          if (provider.healthCheck.recoveryActions.length) {
            ctx.log(
              `    recovery actions: ${provider.healthCheck.recoveryActions.slice(0, 3).map((action) => `${action.priority}/${action.kind}:${action.label}`).join(" | ")}`,
            );
          }
        }
        if (provider.runtimeHealthFreshness) {
          ctx.log(
            `    runtime freshness: source=${provider.runtimeHealthFreshness.source}, level=${provider.runtimeHealthFreshness.level}, stale=${provider.runtimeHealthFreshness.stale ? "yes" : "no"}, ageMs=${provider.runtimeHealthFreshness.ageMs ?? "-"}, ref=${provider.runtimeHealthFreshness.referenceAt ?? "-"}` 
            + (provider.runtimeHealthFreshness.snapshotPath ? `, snapshot=${provider.runtimeHealthFreshness.snapshotPath}` : ""),
          );
          ctx.log(
            `    runtime retention: events<=${provider.runtimeHealthFreshness.retention.eventLimit}, horizonMs=${provider.runtimeHealthFreshness.retention.horizonMs}`,
          );
          if (provider.runtimeHealthFreshness.snapshotIssue) {
            ctx.log(
              `    runtime snapshot issue: ${provider.runtimeHealthFreshness.snapshotIssue.code} ${provider.runtimeHealthFreshness.snapshotIssue.message}`,
            );
            if (provider.runtimeHealthFreshness.snapshotIssue.quarantinePath) {
              ctx.log(`    runtime snapshot quarantine: ${provider.runtimeHealthFreshness.snapshotIssue.quarantinePath}`);
            }
          }
        }
        if (provider.fix) {
          ctx.log(`    fix: ${provider.fix}`);
        }
      }
    }
    if (runtimeResilience) {
      const runtimeDiagnostics = buildRuntimeResilienceDiagnosticSummary(runtimeResilience);
      ctx.log("");
      ctx.log("Runtime Resilience");
      ctx.log(`  routing: primary ${runtimeResilience.routing.primary.provider}/${runtimeResilience.routing.primary.model}`);
      ctx.log(`  fallbacks: ${runtimeResilience.routing.fallbacks.length}`);
      if (runtimeResilience.routing.compaction?.configured) {
        ctx.log(`  compaction: ${runtimeResilience.routing.compaction.route?.provider ?? "-"} / ${runtimeResilience.routing.compaction.route?.model ?? "-"}`);
        if (runtimeResilience.routing.compaction.auxSummaryVerdict) {
          ctx.log(
            `  compaction aux verdict: ${runtimeResilience.routing.compaction.auxSummaryVerdict.strategy ?? "-"}`
            + ` / ${runtimeResilience.routing.compaction.auxSummaryVerdict.reason ?? "-"}`
            + ` / enabled=${runtimeResilience.routing.compaction.auxSummaryVerdict.enabled ? "yes" : "no"}`,
          );
        }
      }
      ctx.log(`  headline: ${runtimeResilience.summary.headline}`);
      ctx.log(`  totals: ${runtimeDiagnostics.totalsSummary}`);
      if (runtimeDiagnostics.latestSignal) {
        ctx.log(`  latest signal: ${runtimeDiagnostics.latestSignal}`);
      }
      if (runtimeDiagnostics.latestRouteBehavior) {
        ctx.log(`  latest route: ${runtimeDiagnostics.latestRouteBehavior}`);
      }
      if (runtimeDiagnostics.latestReasonSummary) {
        ctx.log(`  latest reasons: ${runtimeDiagnostics.latestReasonSummary}`);
      }
      if (runtimeDiagnostics.overallReasonSummary) {
        ctx.log(`  reasons: ${runtimeDiagnostics.overallReasonSummary}`);
      }
      if (runtimeDiagnostics.dominantReason) {
        ctx.log(`  reason focus: ${runtimeDiagnostics.dominantReason}`);
      }
      if (runtimeDiagnostics.reasonClusterSummary) {
        ctx.log(`  reason cluster: ${runtimeDiagnostics.reasonClusterSummary}`);
      }
      if (runtimeDiagnostics.recoveryHint) {
        ctx.log(`  recovery hint: ${runtimeDiagnostics.recoveryHint}`);
      }
      if (runtimeDiagnostics.mixedSignalHint) {
        ctx.log(`  mixed signal: ${runtimeDiagnostics.mixedSignalHint}`);
      }
    }

    ctx.log("");
    ctx.log("Tool Contract V2");
    ctx.log(`  total governed tools: ${toolContractV2Observability.summary.totalCount}`);
    ctx.log(`  high risk tools: ${toolContractV2Observability.summary.highRiskCount}`);
    ctx.log(`  confirm required tools: ${toolContractV2Observability.summary.confirmRequiredCount}`);
    ctx.log(`  missing V2 tools: ${toolContractV2Observability.summary.missingV2Tools.join(", ") || "(none)"}`);

    const fails = results.filter((r) => r.status === "fail").length;
    const warns = results.filter((r) => r.status === "warn").length;
    ctx.log("");
    if (fails > 0) {
      ctx.error(`${fails} issue(s) found, ${warns} warning(s)`);
      process.exit(1);
    } else if (warns > 0) {
      ctx.warn(`All checks passed with ${warns} warning(s)`);
    } else {
      ctx.success("All checks passed");
    }
  },
});

