import path from "node:path";

import type { CommandPermissionPreview, CommandPermissionPreviewAction, JsonObject } from "./types.js";

const MAX_EXECUTABLE_CHARS = 512;
const MAX_ARGV_ENTRIES = 256;
const MAX_ARGUMENT_CHARS = 16_384;
const MAX_ENV_ENTRIES = 64;
const MAX_ENV_VALUE_CHARS = 16_384;
const MAX_TIMEOUT_MS = 300_000;

const SHELL_ENTRYPOINTS = new Set([
  "bash",
  "cmd",
  "cmd.exe",
  "dash",
  "fish",
  "ksh",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
  "sh",
  "zsh",
]);

const COMMAND_PLAN_FIELDS = new Set([
  "argv",
  "cwd",
  "env",
  "executable",
  "network",
  "stdinMode",
  "timeoutMs",
  "writeScope",
]);

const COMMAND_PERMISSION_ACTIONS = new Set<CommandPermissionPreviewAction>([
  "run",
  "start",
  "read",
  "write",
  "resize",
  "cancel",
  "status",
  "list",
]);
const COMMAND_JOB_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SENSITIVE_ARGUMENT_NAME_PATTERN = /(?:api[_-]?key|authorization|credential|cookie|pass(?:word|wd)?|secret|token|private[_-]?key|session)/i;
const SENSITIVE_HEADER_PATTERN = /(?:authorization|proxy-authorization|x-api-key|x-auth-token|cookie|set-cookie)\s*[:=]/i;
const SENSITIVE_ASSIGNMENT_PATTERN = /^([A-Za-z_][A-Za-z0-9_-]*(?:api[_-]?key|authorization|credential|cookie|pass(?:word|wd)?|secret|token|private[_-]?key|session)[A-Za-z0-9_-]*\s*=).*/i;
const SENSITIVE_QUERY_PATTERN = /([?&](?:api[_-]?key|authorization|credential|cookie|pass(?:word|wd)?|secret|token|private[_-]?key|session)=)[^&#\s]*/i;

export type CommandPlan = {
  executable: string;
  argv: string[];
  cwd?: string;
  env: Record<string, string>;
  network: "none";
  writeScope: "workspace-readonly" | "workspace-readwrite";
  stdinMode: "closed" | "pipe" | "pty";
  timeoutMs?: number;
};

export type CommandPlanParseResult =
  | { ok: true; plan: CommandPlan }
  | {
    ok: false;
    code:
      | "invalid_command_plan"
      | "missing_executable"
      | "invalid_executable"
      | "shell_entrypoint_blocked"
      | "invalid_argv"
      | "invalid_cwd"
      | "invalid_env"
      | "unsupported_network_mode"
      | "unsupported_write_scope"
      | "unsupported_stdin_mode"
      | "invalid_timeout";
    message: string;
  };

function failure(code: Exclude<CommandPlanParseResult, { ok: true }> ["code"], message: string): CommandPlanParseResult {
  return { ok: false, code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function isAbsoluteOrTraversalPath(value: string): boolean {
  if (path.isAbsolute(value) || /^[a-z]:[\\/]/i.test(value) || value.startsWith("\\\\")) {
    return true;
  }
  return value.split(/[\\/]+/).some((part) => part === "..");
}

function normalizeExecutable(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const executable = value.trim();
  if (!executable || executable.length > MAX_EXECUTABLE_CHARS || /\s/.test(executable) || hasControlCharacter(executable)) {
    return undefined;
  }
  return executable;
}

function normalizeArgv(value: unknown): string[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ARGV_ENTRIES) return undefined;
  const argv: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length > MAX_ARGUMENT_CHARS || hasControlCharacter(item)) {
      return undefined;
    }
    argv.push(item);
  }
  return argv;
}

function normalizeCwd(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const cwd = value.trim();
  if (!cwd || hasControlCharacter(cwd) || isAbsoluteOrTraversalPath(cwd)) {
    return null;
  }
  return cwd;
}

function normalizeEnv(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return {};
  if (!isRecord(value) || Object.keys(value).length > MAX_ENV_ENTRIES) return undefined;
  const env: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
      || typeof item !== "string"
      || item.length > MAX_ENV_VALUE_CHARS
      || hasControlCharacter(item)) {
      return undefined;
    }
    env[key] = item;
  }
  return env;
}

/**
 * Parses the only command representation allowed by a sandbox-required coding run.
 * It deliberately has no shell syntax, pipe, redirection, or inherited host environment.
 */
export function parseCommandPlan(value: unknown): CommandPlanParseResult {
  if (!isRecord(value)) {
    return failure("invalid_command_plan", "commandPlan must be an object.");
  }
  const unknownField = Object.keys(value).find((key) => !COMMAND_PLAN_FIELDS.has(key));
  if (unknownField) {
    return failure("invalid_command_plan", `commandPlan contains unsupported field: ${unknownField}.`);
  }

  const executable = normalizeExecutable(value.executable);
  if (!executable) {
    return failure(value.executable === undefined ? "missing_executable" : "invalid_executable", "commandPlan.executable must be one executable token.");
  }
  if (SHELL_ENTRYPOINTS.has(executable.toLowerCase())) {
    return failure("shell_entrypoint_blocked", "Shell entrypoints are not allowed in commandPlan.");
  }

  const argv = normalizeArgv(value.argv);
  if (!argv) {
    return failure("invalid_argv", "commandPlan.argv must be a bounded array of plain string arguments.");
  }

  const cwd = normalizeCwd(value.cwd);
  if (cwd === null) {
    return failure("invalid_cwd", "commandPlan.cwd must be a relative path inside the selected workspace root.");
  }

  const env = normalizeEnv(value.env);
  if (!env) {
    return failure("invalid_env", "commandPlan.env must be a bounded object of string environment values.");
  }

  const network = value.network ?? "none";
  if (network !== "none") {
    return failure("unsupported_network_mode", "This command sandbox slice supports only network: none.");
  }

  const writeScope = value.writeScope ?? "workspace-readonly";
  if (writeScope !== "workspace-readonly" && writeScope !== "workspace-readwrite") {
    return failure("unsupported_write_scope", "commandPlan.writeScope must be workspace-readonly or workspace-readwrite.");
  }

  const stdinMode = value.stdinMode ?? "closed";
  if (stdinMode !== "closed" && stdinMode !== "pipe" && stdinMode !== "pty") {
    return failure("unsupported_stdin_mode", "commandPlan.stdinMode must be closed, pipe, or pty.");
  }

  let timeoutMs: number | undefined;
  if (value.timeoutMs !== undefined) {
    const requestedTimeoutMs = value.timeoutMs;
    if (typeof requestedTimeoutMs !== "number"
      || !Number.isSafeInteger(requestedTimeoutMs)
      || requestedTimeoutMs <= 0
      || requestedTimeoutMs > MAX_TIMEOUT_MS) {
      return failure("invalid_timeout", `commandPlan.timeoutMs must be an integer between 1 and ${MAX_TIMEOUT_MS}.`);
    }
    timeoutMs = requestedTimeoutMs;
  }

  return {
    ok: true,
    plan: {
      executable,
      argv,
      ...(cwd ? { cwd } : {}),
      env,
      network,
      writeScope,
      stdinMode,
      ...(timeoutMs ? { timeoutMs } : {}),
    },
  };
}

/** Values are intentionally omitted so audit, events, and approval projections cannot expose command env secrets. */
export function summarizeCommandPlanForAudit(plan: CommandPlan): JsonObject {
  return {
    executable: plan.executable,
    argv: [...plan.argv],
    cwd: plan.cwd ?? ".",
    environmentKeys: Object.keys(plan.env).sort(),
    network: plan.network,
    writeScope: plan.writeScope,
    stdinMode: plan.stdinMode,
    ...(plan.timeoutMs ? { timeoutMs: plan.timeoutMs } : {}),
  };
}

/** Replaces every structured command environment value before the generic audit redactor runs. */
export function sanitizeCommandPlanForAudit(args: JsonObject): JsonObject {
  const commandPlan = isRecord(args.commandPlan) ? args.commandPlan : undefined;
  const environment = commandPlan && isRecord(commandPlan.env) ? commandPlan.env : undefined;
  const isCommandJobWrite = args.action === "write" && typeof args.data === "string";
  if (!environment && !isCommandJobWrite) return args;
  return {
    ...args,
    ...(commandPlan && environment ? {
      commandPlan: {
        ...commandPlan,
        env: Object.fromEntries(Object.keys(environment).map((key) => [key, "[REDACTED]"])),
      },
    } : {}),
    ...(isCommandJobWrite ? { data: "[REDACTED]" } : {}),
  };
}

/**
 * Builds the only command detail that can cross an approval boundary. Environment
 * values and stdin never enter the projection, and likely secret argv values are masked.
 */
export function buildCommandPermissionPreview(input: {
  toolName: string;
  arguments: JsonObject;
}): CommandPermissionPreview | undefined {
  if (input.toolName === "run_command") {
    const parsed = parseCommandPlan(input.arguments.commandPlan);
    if (!parsed.ok) return undefined;
    return sanitizeCommandPermissionPreview({
      kind: "command",
      action: "run",
      commandPlan: commandPlanPermissionPreview(parsed.plan),
    });
  }
  if (input.toolName !== "command_job" || typeof input.arguments.action !== "string") return undefined;
  const action = input.arguments.action as CommandPermissionPreviewAction;
  if (!COMMAND_PERMISSION_ACTIONS.has(action) || action === "run") return undefined;

  const preview: CommandPermissionPreview = { kind: "command", action };
  if (action === "start") {
    const parsed = parseCommandPlan(input.arguments.commandPlan);
    if (!parsed.ok) return undefined;
    preview.commandPlan = commandPlanPermissionPreview(parsed.plan);
  } else if (typeof input.arguments.jobId === "string" && COMMAND_JOB_ID_PATTERN.test(input.arguments.jobId)) {
    preview.jobId = input.arguments.jobId;
  }
  if (action === "write" && typeof input.arguments.data === "string") {
    preview.stdinProvided = true;
  }
  if (action === "read") {
    if (Number.isSafeInteger(input.arguments.cursor) && (input.arguments.cursor as number) >= 0) {
      preview.cursor = input.arguments.cursor as number;
    }
    if (Number.isSafeInteger(input.arguments.maxBytes) && (input.arguments.maxBytes as number) > 0) {
      preview.maxBytes = input.arguments.maxBytes as number;
    }
  }
  if (action === "resize") {
    if (Number.isSafeInteger(input.arguments.cols) && (input.arguments.cols as number) > 0) {
      preview.cols = input.arguments.cols as number;
    }
    if (Number.isSafeInteger(input.arguments.rows) && (input.arguments.rows as number) > 0) {
      preview.rows = input.arguments.rows as number;
    }
  }
  return sanitizeCommandPermissionPreview(preview);
}

/** Re-validates a cross-process approval preview and discards every unknown/raw field. */
export function sanitizeCommandPermissionPreview(value: unknown): CommandPermissionPreview | undefined {
  if (!isRecord(value) || value.kind !== "command" || typeof value.action !== "string") return undefined;
  const action = value.action as CommandPermissionPreviewAction;
  if (!COMMAND_PERMISSION_ACTIONS.has(action)) return undefined;

  const commandPlan = value.commandPlan === undefined
    ? undefined
    : sanitizeCommandPlanPermissionPreview(value.commandPlan);
  if (value.commandPlan !== undefined && !commandPlan) return undefined;
  if ((action === "run" || action === "start") && !commandPlan) return undefined;

  const preview: CommandPermissionPreview = {
    kind: "command",
    action,
    ...(commandPlan ? { commandPlan } : {}),
  };
  if (action !== "run" && action !== "start" && typeof value.jobId === "string" && COMMAND_JOB_ID_PATTERN.test(value.jobId)) {
    preview.jobId = value.jobId;
  }
  if (action === "write" && value.stdinProvided === true) preview.stdinProvided = true;
  if (action === "read") {
    if (Number.isSafeInteger(value.cursor) && (value.cursor as number) >= 0) preview.cursor = value.cursor as number;
    if (Number.isSafeInteger(value.maxBytes) && (value.maxBytes as number) > 0) preview.maxBytes = value.maxBytes as number;
  }
  if (action === "resize") {
    if (Number.isSafeInteger(value.cols) && (value.cols as number) > 0) preview.cols = value.cols as number;
    if (Number.isSafeInteger(value.rows) && (value.rows as number) > 0) preview.rows = value.rows as number;
  }
  return preview;
}

function commandPlanPermissionPreview(plan: CommandPlan): NonNullable<CommandPermissionPreview["commandPlan"]> {
  return {
    executable: plan.executable,
    argv: redactCommandArgv(plan.argv),
    cwd: plan.cwd ?? ".",
    environmentKeys: Object.keys(plan.env).sort(),
    network: plan.network,
    writeScope: plan.writeScope,
    stdinMode: plan.stdinMode,
    ...(plan.timeoutMs ? { timeoutMs: plan.timeoutMs } : {}),
  };
}

function sanitizeCommandPlanPermissionPreview(value: unknown): NonNullable<CommandPermissionPreview["commandPlan"]> | undefined {
  if (!isRecord(value)
    || typeof value.executable !== "string"
    || !isSafePreviewString(value.executable, MAX_EXECUTABLE_CHARS)
    || !Array.isArray(value.argv)
    || value.argv.length > MAX_ARGV_ENTRIES
    || typeof value.cwd !== "string"
    || !isSafePreviewString(value.cwd, MAX_ARGUMENT_CHARS)
    || !Array.isArray(value.environmentKeys)
    || value.environmentKeys.length > MAX_ENV_ENTRIES
    || value.network !== "none"
    || (value.writeScope !== "workspace-readonly" && value.writeScope !== "workspace-readwrite")
    || (value.stdinMode !== "closed" && value.stdinMode !== "pipe" && value.stdinMode !== "pty")) {
    return undefined;
  }
  const argv: string[] = [];
  for (const item of value.argv) {
    if (typeof item !== "string" || !isSafePreviewString(item, MAX_ARGUMENT_CHARS)) return undefined;
    argv.push(item);
  }
  const environmentKeys: string[] = [];
  for (const key of value.environmentKeys) {
    if (typeof key !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return undefined;
    environmentKeys.push(key);
  }
  if (new Set(environmentKeys).size !== environmentKeys.length) return undefined;
  if (value.timeoutMs !== undefined
    && (typeof value.timeoutMs !== "number"
      || !Number.isSafeInteger(value.timeoutMs)
      || value.timeoutMs <= 0
      || value.timeoutMs > MAX_TIMEOUT_MS)) {
    return undefined;
  }
  return {
    executable: value.executable,
    argv: redactCommandArgv(argv),
    cwd: value.cwd,
    environmentKeys: environmentKeys.sort(),
    network: "none",
    writeScope: value.writeScope,
    stdinMode: value.stdinMode,
    ...(value.timeoutMs !== undefined ? { timeoutMs: value.timeoutMs } : {}),
  };
}

function redactCommandArgv(argv: readonly string[]): string[] {
  let redactNext = false;
  return argv.map((argument) => {
    if (redactNext) {
      redactNext = false;
      return "[REDACTED]";
    }
    const option = /^(-{1,2}[^=\s]+)(?:=(.*))?$/.exec(argument);
    if (option && SENSITIVE_ARGUMENT_NAME_PATTERN.test(option[1])) {
      if (option[2] === undefined) {
        redactNext = true;
        return option[1];
      }
      return `${option[1]}=[REDACTED]`;
    }
    if (option?.[2] !== undefined && SENSITIVE_HEADER_PATTERN.test(option[2])) {
      return `${option[1]}=[REDACTED]`;
    }
    if (SENSITIVE_HEADER_PATTERN.test(argument)) {
      const separator = argument.search(/[:=]/);
      return separator >= 0 ? `${argument.slice(0, separator + 1)}[REDACTED]` : "[REDACTED]";
    }
    const assignment = SENSITIVE_ASSIGNMENT_PATTERN.exec(argument);
    if (assignment) return `${assignment[1]}[REDACTED]`;
    if (SENSITIVE_QUERY_PATTERN.test(argument)) {
      return argument.replace(SENSITIVE_QUERY_PATTERN, "$1[REDACTED]");
    }
    if (/^bearer\s+/i.test(argument)) return "Bearer [REDACTED]";
    return argument;
  });
}

function isSafePreviewString(value: string, maxLength: number): boolean {
  return value.length > 0 && value.length <= maxLength && !hasControlCharacter(value);
}
