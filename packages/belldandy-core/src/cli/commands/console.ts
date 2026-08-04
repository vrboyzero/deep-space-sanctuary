import { defineCommand } from "citty";
import pc from "picocolors";

import { getDaemonStatus, formatUptime } from "../daemon.js";
import { createCLIContext } from "../shared/context.js";
import { invokeGatewayMethod } from "../shared/gateway-rpc.js";

type DoctorCheck = {
  id?: string;
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
};

type ConsoleAgentItem = {
  id: string;
  displayName: string;
  model: string;
  status?: string;
  mainConversationId?: string;
  observabilityHeadline?: string;
  warnings?: string[];
};

type ConsoleSubTaskItem = {
  id: string;
  agentId: string;
  status: string;
  summary?: string;
  instruction?: string;
  updatedAt?: number;
  archivedAt?: number;
};

type ConsoleSnapshot = {
  generatedAt: string;
  stateDir: string;
  daemon: ReturnType<typeof getDaemonStatus>;
  gateway: {
    wsUrl?: string;
    connected: boolean;
    paired: boolean;
    error?: string;
  };
  checks: DoctorCheck[];
  checkSummary: {
    pass: number;
    warn: number;
    fail: number;
  };
  agents: ConsoleAgentItem[];
  agentSummary: {
    total: number;
    running: number;
    background: number;
    idle: number;
    error: number;
    other: number;
    warningAgents: number;
  };
  subtasks: ConsoleSubTaskItem[];
  subtaskSummary: {
    total: number;
    active: number;
    pending: number;
    running: number;
    failed: number;
    done: number;
    stopped: number;
    archived: number;
  };
  runtime: {
    cronHeadline?: string;
    backgroundHeadline?: string;
    resilienceHeadline?: string;
    delegationHeadline?: string;
  };
  sourceErrors: {
    doctor?: string;
    roster?: string;
    subtasks?: string;
  };
  hints: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseDoctorChecks(payload: Record<string, unknown>): DoctorCheck[] {
  const checks = Array.isArray(payload.checks) ? payload.checks : [];
  return checks.flatMap((item) => {
    if (!isRecord(item)) return [];
    const status = item.status === "pass" || item.status === "warn" || item.status === "fail"
      ? item.status
      : "warn";
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const message = typeof item.message === "string" ? item.message.trim() : "";
    if (!name) return [];
    return [{
      ...(typeof item.id === "string" && item.id.trim() ? { id: item.id.trim() } : {}),
      name,
      status,
      message,
    }];
  });
}

function parseAgents(payload: Record<string, unknown>): ConsoleAgentItem[] {
  const agents = Array.isArray(payload.agents) ? payload.agents : [];
  return agents.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!id) return [];
    const warnings = Array.isArray(item.warnings)
      ? item.warnings.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    return [{
      id,
      displayName: typeof item.displayName === "string" && item.displayName.trim() ? item.displayName.trim() : id,
      model: typeof item.model === "string" && item.model.trim() ? item.model.trim() : "-",
      ...(typeof item.status === "string" && item.status.trim() ? { status: item.status.trim() } : {}),
      ...(typeof item.mainConversationId === "string" && item.mainConversationId.trim()
        ? { mainConversationId: item.mainConversationId.trim() }
        : {}),
      ...(typeof item.observabilityHeadline === "string" && item.observabilityHeadline.trim()
        ? { observabilityHeadline: item.observabilityHeadline.trim() }
        : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    }];
  });
}

function parseSubtasks(payload: Record<string, unknown>): ConsoleSubTaskItem[] {
  const items = Array.isArray(payload.items) ? payload.items : [];
  return items.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const agentId = typeof item.agentId === "string" ? item.agentId.trim() : "";
    const status = typeof item.status === "string" ? item.status.trim() : "";
    if (!id || !agentId || !status) return [];
    return [{
      id,
      agentId,
      status,
      ...(typeof item.summary === "string" && item.summary.trim() ? { summary: item.summary.trim() } : {}),
      ...(typeof item.instruction === "string" && item.instruction.trim() ? { instruction: item.instruction.trim() } : {}),
      ...(typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt) ? { updatedAt: item.updatedAt } : {}),
      ...(typeof item.archivedAt === "number" && Number.isFinite(item.archivedAt) ? { archivedAt: item.archivedAt } : {}),
    }];
  });
}

export function extractConsoleRuntimeHeadline(section: unknown): string | undefined {
  if (!isRecord(section)) return undefined;
  const directHeadline = typeof section.headline === "string" ? section.headline.trim() : "";
  if (directHeadline) {
    return directHeadline;
  }
  const summary = isRecord(section.summary) ? section.summary : undefined;
  const headline = summary && typeof summary.headline === "string" ? summary.headline.trim() : "";
  return headline || undefined;
}

function headlineFromRuntimeResilience(section: unknown): string | undefined {
  if (!isRecord(section)) return undefined;
  const alertMessage = typeof section.alertMessage === "string" ? section.alertMessage.trim() : "";
  const totalsSummary = typeof section.totalsSummary === "string" ? section.totalsSummary.trim() : "";
  if (alertMessage && totalsSummary) {
    return `${alertMessage} ${totalsSummary}`.trim();
  }
  return alertMessage || totalsSummary || undefined;
}

function buildHints(input: {
  checks: DoctorCheck[];
  sourceErrors: ConsoleSnapshot["sourceErrors"];
  agents: ConsoleAgentItem[];
}): string[] {
  const hints: string[] = [];
  if (input.sourceErrors.doctor) {
    hints.push(`doctor: ${input.sourceErrors.doctor}`);
  }
  if (input.sourceErrors.roster) {
    hints.push(`agents roster: ${input.sourceErrors.roster}`);
  }
  if (input.sourceErrors.subtasks) {
    hints.push(`subtasks: ${input.sourceErrors.subtasks}`);
  }
  for (const check of input.checks) {
    if (check.status === "warn" || check.status === "fail") {
      hints.push(`${check.name}: ${check.message}`);
    }
  }
  for (const agent of input.agents) {
    for (const warning of agent.warnings ?? []) {
      hints.push(`${agent.id}: ${warning}`);
    }
  }
  return [...new Set(hints)].slice(0, 6);
}

function colorizeStatus(status: string): string {
  switch (status) {
    case "pass":
    case "running":
    case "done":
    case "completed":
    case "ok":
      return pc.green(status);
    case "warn":
    case "background":
    case "queued":
    case "paused":
      return pc.yellow(status);
    case "fail":
    case "error":
    case "timeout":
    case "stopped":
    case "interrupted":
      return pc.red(status);
    default:
      return pc.cyan(status);
  }
}

function formatTimestamp(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return new Date(value).toLocaleString();
}

function truncateText(value: string | undefined, limit = 96): string {
  const normalized = (value ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) return "-";
  return normalized.length > limit ? `${normalized.slice(0, Math.max(0, limit - 3))}...` : normalized;
}

function formatPortFromWsUrl(wsUrl?: string): string {
  if (!wsUrl) return "-";
  try {
    const parsed = new URL(wsUrl);
    return parsed.port || (parsed.protocol === "wss:" ? "443" : "80");
  } catch {
    return "-";
  }
}

function summarizeChecks(checks: DoctorCheck[]) {
  return checks.reduce(
    (summary, check) => {
      summary[check.status] += 1;
      return summary;
    },
    { pass: 0, warn: 0, fail: 0 },
  );
}

function summarizeAgents(agents: ConsoleAgentItem[]) {
  return agents.reduce(
    (summary, agent) => {
      summary.total += 1;
      const normalizedStatus = (agent.status ?? "").trim().toLowerCase();
      switch (normalizedStatus) {
        case "running":
          summary.running += 1;
          break;
        case "background":
          summary.background += 1;
          break;
        case "idle":
          summary.idle += 1;
          break;
        case "error":
        case "timeout":
        case "stopped":
          summary.error += 1;
          break;
        default:
          if (normalizedStatus) summary.other += 1;
          break;
      }
      if ((agent.warnings?.length ?? 0) > 0) {
        summary.warningAgents += 1;
      }
      return summary;
    },
    { total: 0, running: 0, background: 0, idle: 0, error: 0, other: 0, warningAgents: 0 },
  );
}

function summarizeSubtasks(subtasks: ConsoleSubTaskItem[]) {
  return subtasks.reduce(
    (summary, item) => {
      summary.total += 1;
      if (typeof item.archivedAt === "number") {
        summary.archived += 1;
      }
      switch (item.status) {
        case "queued":
        case "pending":
          summary.pending += 1;
          summary.active += 1;
          break;
        case "running":
          summary.running += 1;
          summary.active += 1;
          break;
        case "done":
          summary.done += 1;
          break;
        case "error":
        case "timeout":
        case "interrupted":
          summary.failed += 1;
          break;
        case "stopped":
          summary.stopped += 1;
          break;
      }
      return summary;
    },
    { total: 0, active: 0, pending: 0, running: 0, failed: 0, done: 0, stopped: 0, archived: 0 },
  );
}

function normalizeSourceErrors(input: {
  doctor?: string;
  roster?: string;
  subtasks?: string;
}): ConsoleSnapshot["sourceErrors"] {
  const doctor = input.doctor?.trim();
  const roster = input.roster?.trim();
  const subtasks = input.subtasks?.trim();
  return {
    ...(doctor ? { doctor } : {}),
    ...(roster && roster !== doctor ? { roster } : {}),
    ...(subtasks && subtasks !== doctor ? { subtasks } : {}),
  };
}

function compareSubtasks(a: ConsoleSubTaskItem, b: ConsoleSubTaskItem): number {
  const aArchived = typeof a.archivedAt === "number" ? 1 : 0;
  const bArchived = typeof b.archivedAt === "number" ? 1 : 0;
  if (aArchived !== bArchived) {
    return aArchived - bArchived;
  }
  const aUpdated = typeof a.updatedAt === "number" ? a.updatedAt : 0;
  const bUpdated = typeof b.updatedAt === "number" ? b.updatedAt : 0;
  if (aUpdated !== bUpdated) {
    return bUpdated - aUpdated;
  }
  return a.id.localeCompare(b.id);
}

export function renderConsoleWatchStatusBar(snapshot: ConsoleSnapshot, intervalSeconds: number): string {
  const gatewayStatus = snapshot.gateway.connected ? pc.green("connected") : pc.yellow("unreachable");
  const doctorStatus = snapshot.sourceErrors.doctor ? pc.red("doctor failed") : pc.green("doctor ok");
  const rosterStatus = snapshot.sourceErrors.roster ? pc.red("roster failed") : pc.green("roster ok");
  const subtasksStatus = snapshot.sourceErrors.subtasks ? pc.red("subtasks failed") : pc.green("subtasks ok");
  return [
    `[${gatewayStatus}]`,
    `refresh ${intervalSeconds}s`,
    `snapshot ${snapshot.generatedAt}`,
    doctorStatus,
    rosterStatus,
    subtasksStatus,
    "Ctrl+C to exit",
  ].join(" | ");
}

export function renderConsoleSnapshot(snapshot: ConsoleSnapshot): string {
  const lines: string[] = [];

  lines.push(pc.bold("Belldandy Console"));
  lines.push(pc.dim(`Generated: ${snapshot.generatedAt}`));
  lines.push("");

  lines.push(pc.bold("Gateway"));
  lines.push(`  Daemon: ${snapshot.daemon.running ? pc.green("running") : pc.gray("stopped")}`);
  lines.push(`  PID: ${snapshot.daemon.pid ?? "-"}`);
  lines.push(`  Uptime: ${snapshot.daemon.uptime != null ? formatUptime(snapshot.daemon.uptime) : "-"}`);
  lines.push(`  State Dir: ${snapshot.stateDir}`);
  lines.push(`  Port: ${formatPortFromWsUrl(snapshot.gateway.wsUrl)}`);
  lines.push(`  WS: ${snapshot.gateway.connected ? pc.green("connected") : pc.yellow("unreachable")}`);
  if (snapshot.gateway.wsUrl) {
    lines.push(`  Endpoint: ${snapshot.gateway.wsUrl}`);
  }
  lines.push(`  Log: ${snapshot.daemon.logFile}`);
  lines.push(
    `  Checks: pass ${snapshot.checkSummary.pass}, warn ${snapshot.checkSummary.warn}, fail ${snapshot.checkSummary.fail}`,
  );
  if (snapshot.gateway.error) {
    lines.push(`  Error: ${pc.red(snapshot.gateway.error)}`);
  }
  lines.push("");

  lines.push(pc.bold("Agents"));
  if (snapshot.sourceErrors.roster) {
    lines.push(`  Roster: ${pc.red(snapshot.sourceErrors.roster)}`);
  }
  lines.push(
    `  Summary: total ${snapshot.agentSummary.total}, running ${snapshot.agentSummary.running}, background ${snapshot.agentSummary.background}, idle ${snapshot.agentSummary.idle}, error ${snapshot.agentSummary.error}, warnings ${snapshot.agentSummary.warningAgents}`,
  );
  if (snapshot.agentSummary.other > 0) {
    lines.push(`  Other statuses: ${snapshot.agentSummary.other}`);
  }
  if (snapshot.agents.length === 0) {
    lines.push(snapshot.sourceErrors.roster ? "  Agent roster unavailable." : "  No resident agents visible.");
  } else {
    for (const agent of snapshot.agents) {
      const status = agent.status ? colorizeStatus(agent.status) : "-";
      lines.push(`  - ${agent.id} (${agent.displayName}) | ${status} | ${agent.model}`);
      if (agent.mainConversationId) {
        lines.push(`    main: ${agent.mainConversationId}`);
      }
      if (agent.observabilityHeadline) {
        lines.push(`    ${truncateText(agent.observabilityHeadline, 120)}`);
      }
    }
  }
  lines.push("");

  lines.push(pc.bold("Runtime"));
  if (snapshot.sourceErrors.subtasks) {
    lines.push(`  Subtasks: ${pc.red(snapshot.sourceErrors.subtasks)}`);
  }
  lines.push(
    `  Subtasks: total ${snapshot.subtaskSummary.total}, active ${snapshot.subtaskSummary.active}, pending ${snapshot.subtaskSummary.pending}, running ${snapshot.subtaskSummary.running}, failed ${snapshot.subtaskSummary.failed}, done ${snapshot.subtaskSummary.done}, stopped ${snapshot.subtaskSummary.stopped}`,
  );
  if (snapshot.subtaskSummary.archived > 0) {
    lines.push(`  Archived: ${snapshot.subtaskSummary.archived}`);
  }
  if (snapshot.runtime.resilienceHeadline) {
    lines.push(`  Resilience: ${truncateText(snapshot.runtime.resilienceHeadline, 140)}`);
  }
  if (snapshot.runtime.cronHeadline) {
    lines.push(`  Cron: ${truncateText(snapshot.runtime.cronHeadline, 140)}`);
  }
  if (snapshot.runtime.backgroundHeadline) {
    lines.push(`  Background: ${truncateText(snapshot.runtime.backgroundHeadline, 140)}`);
  }
  if (snapshot.runtime.delegationHeadline) {
    lines.push(`  Delegation: ${truncateText(snapshot.runtime.delegationHeadline, 140)}`);
  }
  if (snapshot.subtasks.length > 0) {
    lines.push("  Recent subtasks:");
    for (const item of snapshot.subtasks.slice(0, 5)) {
      lines.push(`    - ${item.id} | ${item.agentId} | ${colorizeStatus(item.status)} | ${truncateText(item.summary || item.instruction, 80)}`);
      lines.push(`      updated: ${formatTimestamp(item.updatedAt)}`);
    }
  } else {
    lines.push(snapshot.sourceErrors.subtasks ? "  Recent subtasks unavailable." : "  No recent subtasks.");
  }
  lines.push("");

  lines.push(pc.bold("Hints"));
  if (snapshot.hints.length === 0) {
    lines.push(`  ${pc.green("No immediate warnings.")}`);
  } else {
    for (const hint of snapshot.hints) {
      lines.push(`  - ${hint}`);
    }
  }

  return lines.join("\n");
}

export async function buildConsoleSnapshot(stateDir: string): Promise<ConsoleSnapshot> {
  const daemon = getDaemonStatus(stateDir);

  const doctorResult = await invokeGatewayMethod({
    stateDir,
    method: "system.doctor",
    params: {},
    requestIdPrefix: "console-system-doctor",
    timeoutMs: 4_000,
    clientName: "bdd console",
    parsePayload: (payload) => payload,
  });
  const rosterResult = await invokeGatewayMethod({
    stateDir,
    method: "agents.roster.get",
    params: {},
    requestIdPrefix: "console-agents-roster",
    timeoutMs: 3_000,
    clientName: "bdd console",
    parsePayload: parseAgents,
  });
  const subtaskResult = await invokeGatewayMethod({
    stateDir,
    method: "subtask.list",
    params: { includeArchived: false },
    requestIdPrefix: "console-subtask-list",
    timeoutMs: 3_000,
    clientName: "bdd console",
    parsePayload: parseSubtasks,
  });

  const doctorPayload = doctorResult.ok ? doctorResult.payload : {};
  const checks = doctorResult.ok ? parseDoctorChecks(doctorPayload) : [];
  const agents = rosterResult.ok
    ? rosterResult.payload
    : doctorResult.ok && isRecord(doctorPayload.residentAgents) && Array.isArray(doctorPayload.residentAgents.agents)
      ? parseAgents({ agents: doctorPayload.residentAgents.agents })
      : [];
  const subtasks = (subtaskResult.ok ? subtaskResult.payload : []).slice().sort(compareSubtasks);
  const sourceErrors = normalizeSourceErrors({
    ...(!doctorResult.ok ? { doctor: doctorResult.error } : {}),
    ...(!rosterResult.ok ? { roster: rosterResult.error } : {}),
    ...(!subtaskResult.ok ? { subtasks: subtaskResult.error } : {}),
  });

  return {
    generatedAt: new Date().toLocaleString(),
    stateDir,
    daemon,
    gateway: {
      wsUrl: doctorResult.wsUrl,
      connected: doctorResult.ok || rosterResult.ok || subtaskResult.ok,
      paired: doctorResult.ok ? doctorResult.paired : rosterResult.ok ? rosterResult.paired : subtaskResult.ok ? subtaskResult.paired : false,
      ...(!doctorResult.ok ? { error: doctorResult.error } : {}),
    },
    checks,
    checkSummary: summarizeChecks(checks),
    agents,
    agentSummary: summarizeAgents(agents),
    subtasks,
    subtaskSummary: summarizeSubtasks(subtasks),
    runtime: {
      ...(doctorResult.ok && extractConsoleRuntimeHeadline(doctorPayload.cronRuntime)
        ? { cronHeadline: extractConsoleRuntimeHeadline(doctorPayload.cronRuntime) }
        : {}),
      ...(doctorResult.ok && extractConsoleRuntimeHeadline(doctorPayload.backgroundContinuationRuntime)
        ? { backgroundHeadline: extractConsoleRuntimeHeadline(doctorPayload.backgroundContinuationRuntime) }
        : {}),
      ...(doctorResult.ok && headlineFromRuntimeResilience(doctorPayload.runtimeResilienceDiagnostics)
        ? { resilienceHeadline: headlineFromRuntimeResilience(doctorPayload.runtimeResilienceDiagnostics) }
        : {}),
      ...(doctorResult.ok && extractConsoleRuntimeHeadline(doctorPayload.delegationObservability)
        ? { delegationHeadline: extractConsoleRuntimeHeadline(doctorPayload.delegationObservability) }
        : {}),
    },
    sourceErrors,
    hints: buildHints({
      checks,
      sourceErrors,
      agents,
    }),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default defineCommand({
  meta: { name: "console", description: "Show a lightweight terminal runtime console" },
  args: {
    json: { type: "boolean", description: "JSON output" },
    "state-dir": { type: "string", description: "Override state directory" },
    watch: { type: "boolean", description: "Refresh continuously" },
    interval: { type: "string", description: "Refresh interval seconds (default: 5)" },
  },
  async run({ args }) {
    const ctx = createCLIContext({ json: args.json, stateDir: args["state-dir"] });
    const watch = args.watch === true;
    const intervalSecondsRaw = Number(args.interval ?? "5");
    const intervalSeconds = Number.isFinite(intervalSecondsRaw) && intervalSecondsRaw > 0
      ? Math.max(1, Math.floor(intervalSecondsRaw))
      : 5;

    if (watch && ctx.json) {
      ctx.error("--watch cannot be combined with --json in D2-MVP.");
      process.exit(1);
    }

    do {
      const snapshot = await buildConsoleSnapshot(ctx.stateDir);
      if (ctx.json) {
        ctx.output(snapshot);
      } else {
        if (watch) {
          process.stdout.write("\x1Bc");
          ctx.log(pc.dim(`${renderConsoleWatchStatusBar(snapshot, intervalSeconds)}\n`));
        }
        ctx.log(renderConsoleSnapshot(snapshot));
      }
      if (!watch) {
        return;
      }
      await sleep(intervalSeconds * 1000);
    } while (watch);
  },
});
