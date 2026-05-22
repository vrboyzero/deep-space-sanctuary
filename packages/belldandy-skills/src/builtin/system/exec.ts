import type { Tool, ToolCallResult, ToolExecPolicy } from "../../types.js";
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { withToolContract } from "../../tool-contract.js";
import { resolveRuntimeFilesystemScope } from "../../runtime-policy.js";
import { readAbortReason, throwIfAborted } from "../../abort-utils.js";
import { buildFailureToolCallResult, inferToolFailureKindFromError } from "../../failure-kind.js";

// 安全策略配置
const BLOCKLIST = new Set([
    "sudo", "su", "mkfs", "dd", "shutdown", "reboot", "poweroff", "init",
    ":(){:|:&};:" // Fork bomb
]);

// 受保护文件（禁止通过 exec 触达）
const PROTECTED_FILES = ["soul.md"];

// 通用命令（所有平台）
const COMMON_SAFELIST = [
    // 核心系统/文本
    "pwd", "whoami", "echo", "cat", "grep", "head", "tail", "less",
    "which", "uname", "who", "id", "uptime", "time",
    "sed", "awk", "sort", "uniq", "cut", "wc", "tee", "tr", "xargs",
    // JS/TS
    "git", "npm", "pnpm", "node", "yarn", "bun", "npx", "tsc", "vite", "next", "vue", "vue-cli",
    "eslint", "prettier", "storybook", "turbo", "nx",
    // Python
    "python", "python3", "pip", "pip3", "pipenv", "conda", "pytest", "pipx", "poetry", "ruff", "black",
    // 编译/底层
    "gcc", "g++", "make", "cmake", "cargo", "go",
    // 其他语言工具
    "java", "mvn", "dotnet", "dotnet-format",
    // 文件与进程
    "touch", "mkdir", "cp", "mv", "rmdir", "rm",
    "ps", "df", "du", "hostname",
    // 网络/传输
    "curl", "wget", "scp", "rsync",
    "dig", "nslookup", "traceroute", "tracert", "ip", "ifconfig",
    // 文件搜索/过滤
    "rg", "fd", "jq", "yq",
    // 媒体与文档
    "ffmpeg", "magick", "pandoc",
    // 版本控制辅助
    "gh", "glab",
    // 常见 create-* 初始化命令
    "create-react-app",
];

// Unix 特定命令 (Linux + macOS)
const UNIX_SAFELIST = [
    "date",
    "ls", "top", "free", "chmod", "chown", "ln", "which", "find", "xargs",
    "uname", "who", "id", "uptime", "time",
    "sed", "awk", "sort", "uniq", "cut", "wc", "tee", "tr",
    "tar", "gzip", "gunzip", "zip", "unzip",
    "dig", "nslookup", "traceroute", "ip", "ifconfig",
    "gh", "glab",
    "gradle", "gradlew", "mvnw",
    "pipx", "poetry", "ruff", "black",
    "eslint", "prettier", "storybook", "turbo", "nx",
    "golangci-lint", "goimports",
    "open",  // macOS 特有：打开文件/URL
    "ssh", "ping", "netstat",
];

// Windows 特定命令
const WINDOWS_SAFELIST = [
    "dir", "copy", "move", "del", "ren", "type", "ls",
    "ipconfig", "netstat", "tasklist", "where", "ping", "hostname", "ssh",
    "tracert",
    "powershell", "powershell.exe", "pwsh",  // Windows shell (可通过 policy extraBlocklist 禁用)
    "start"  // Windows 特有：打开文件/URL
];

// 根据平台构建白名单
function buildSafelist(): Set<string> {
    const list = [...COMMON_SAFELIST];
    if (process.platform === "win32") {
        list.push(...WINDOWS_SAFELIST);
    } else {
        // macOS (darwin) 和 Linux 共享 Unix 命令
        list.push(...UNIX_SAFELIST);
    }
    return new Set(list);
}

const SAFELIST = buildSafelist();

const DEFAULT_EXEC_POLICY: Required<ToolExecPolicy> = {
    quickTimeoutMs: 5_000,
    longTimeoutMs: 300_000,
    quickCommands: [],
    longCommands: [],
    extraSafelist: [],
    extraBlocklist: [],
    nonInteractive: {
        enabled: true,
        additionalFlags: [],
        defaultFlags: [],
        rules: {},
    },
};

const ENV_FILE_PATTERN = /\.env(\.|$)/i;
const ENV_READ_KEYWORDS = ["cat", "type", "more", "less", "head", "tail", "grep", "rg", "sed", "awk", "get-content"];
const NON_INTERACTIVE_FLAGS = ["--yes", "-y", "--assume-yes", "--non-interactive", "--no-interaction"];
const WINDOWS_FILE_COMMANDS = new Set(["copy", "move", "ren", "del"]);
const WINDOWS_CONTROLLED_BUILTINS = new Set(["if", "for"]);

const QUICK_COMMANDS = new Set([
    "pwd", "whoami", "echo", "git", "ls", "dir", "cat", "head", "tail",
    "rg", "fd", "jq", "yq", "hostname", "df", "du", "netstat", "ping", "ipconfig", "tasklist", "where",
    "which", "uname", "who", "id", "uptime", "time",
    "sed", "awk", "sort", "uniq", "cut", "wc", "tee", "tr", "xargs",
    "dig", "nslookup", "traceroute", "tracert", "ip", "ifconfig"
]);

const LONG_COMMANDS = new Set([
    "npm", "pnpm", "yarn", "npx", "node", "python", "python3", "pip", "pip3", "pipenv", "conda", "pytest", "pipx", "poetry",
    "tsc", "vite", "next", "vue", "vue-cli", "gcc", "g++", "make", "cmake", "cargo", "go", "java", "mvn", "dotnet",
    "gradle", "gradlew", "mvnw",
    "ffmpeg", "pandoc", "magick",
    "powershell", "powershell.exe", "pwsh"
]);

const DEFAULT_NON_INTERACTIVE_RULES: Array<{ cmd: string; sub?: string[]; flags: string[] }> = [
    { cmd: "npm", sub: ["init"], flags: ["-y"] },
    { cmd: "npx", flags: ["--yes"] },
    { cmd: "yarn", flags: ["--non-interactive"] },
    { cmd: "pnpm", sub: ["dlx", "create", "init"], flags: ["--yes"] },
    { cmd: "conda", sub: ["install", "update", "remove", "uninstall", "create"], flags: ["-y"] },
];

function normalizeExecPolicy(policy?: ToolExecPolicy): Required<ToolExecPolicy> {
    if (!policy) return DEFAULT_EXEC_POLICY;
    return {
        quickTimeoutMs: policy.quickTimeoutMs ?? DEFAULT_EXEC_POLICY.quickTimeoutMs,
        longTimeoutMs: policy.longTimeoutMs ?? DEFAULT_EXEC_POLICY.longTimeoutMs,
        quickCommands: policy.quickCommands ?? DEFAULT_EXEC_POLICY.quickCommands,
        longCommands: policy.longCommands ?? DEFAULT_EXEC_POLICY.longCommands,
        extraSafelist: policy.extraSafelist ?? DEFAULT_EXEC_POLICY.extraSafelist,
        extraBlocklist: policy.extraBlocklist ?? DEFAULT_EXEC_POLICY.extraBlocklist,
        nonInteractive: {
            enabled: policy.nonInteractive?.enabled ?? DEFAULT_EXEC_POLICY.nonInteractive.enabled,
            additionalFlags: policy.nonInteractive?.additionalFlags ?? DEFAULT_EXEC_POLICY.nonInteractive.additionalFlags,
            defaultFlags: policy.nonInteractive?.defaultFlags ?? DEFAULT_EXEC_POLICY.nonInteractive.defaultFlags,
            rules: policy.nonInteractive?.rules ?? DEFAULT_EXEC_POLICY.nonInteractive.rules,
        },
    };
}

function normalizeList(list?: string[]): string[] {
    if (!Array.isArray(list)) return [];
    return list.map(v => v.trim()).filter(Boolean);
}

function buildSafelistWithPolicy(policy: Required<ToolExecPolicy>): Set<string> {
    const base = new Set(SAFELIST);
    for (const cmd of normalizeList(policy.extraSafelist)) {
        base.add(cmd.toLowerCase());
    }
    for (const cmd of normalizeList(policy.extraBlocklist)) {
        base.delete(cmd.toLowerCase());
    }
    return base;
}

function buildBlocklistWithPolicy(policy: Required<ToolExecPolicy>): Set<string> {
    const base = new Set(Array.from(BLOCKLIST));
    for (const cmd of normalizeList(policy.extraBlocklist)) {
        base.add(cmd.toLowerCase());
    }
    return base;
}

function buildCommandSet(defaultSet: Set<string>, extra?: string[]): Set<string> {
    const set = new Set(defaultSet);
    for (const cmd of normalizeList(extra)) {
        set.add(cmd.toLowerCase());
    }
    return set;
}

function parsePolicyRules(rules: Record<string, string[] | string>): Array<{ cmd: string; sub?: string[]; flags: string[] }> {
    const parsed: Array<{ cmd: string; sub?: string[]; flags: string[] }> = [];
    for (const [key, value] of Object.entries(rules ?? {})) {
        const trimmed = key.trim().toLowerCase();
        if (!trimmed) continue;
        const parts = trimmed.split(/\s+/);
        const cmd = parts[0];
        const sub = parts.length > 1 ? [parts[1]] : undefined;
        const flags = Array.isArray(value) ? value.map(v => String(v)) : [String(value)];
        parsed.push({ cmd, sub, flags });
    }
    return parsed;
}

function containsProtectedPath(command: string): boolean {
    const lower = command.toLowerCase();
    return PROTECTED_FILES.some(p => lower.includes(p));
}

function isEnvReadAttempt(command: string): boolean {
    const lower = command.toLowerCase();
    if (!ENV_FILE_PATTERN.test(lower)) return false;
    return ENV_READ_KEYWORDS.some(k => lower.includes(`${k} `) || lower.startsWith(`${k} `));
}

function applyNonInteractiveFlags(command: string, policy: Required<ToolExecPolicy>): string {
    if (!policy.nonInteractive.enabled) return command;

    const trimmed = command.trim();
    if (!trimmed) return trimmed;

    const lower = trimmed.toLowerCase();
    const detectionFlags = new Set([
        ...NON_INTERACTIVE_FLAGS,
        ...normalizeList(policy.nonInteractive.additionalFlags),
        ...normalizeList(policy.nonInteractive.defaultFlags),
    ]);

    for (const flag of detectionFlags) {
        if (flag && lower.includes(flag.toLowerCase())) return trimmed;
    }

    const parts = trimmed.split(/\s+/);
    const executable = parts[0]?.toLowerCase() ?? "";
    const sub = parts[1]?.toLowerCase();

    const rules = [
        ...DEFAULT_NON_INTERACTIVE_RULES,
        ...parsePolicyRules(policy.nonInteractive.rules ?? {}),
    ];

    for (const rule of rules) {
        if (rule.cmd !== executable) continue;
        if (rule.sub && (!sub || !rule.sub.includes(sub))) continue;
        const flags = normalizeList(rule.flags);
        if (flags.length > 0) return `${trimmed} ${flags.join(" ")}`;
    }

    const defaultFlags = normalizeList(policy.nonInteractive.defaultFlags);
    if (defaultFlags.length > 0) {
        return `${trimmed} ${defaultFlags.join(" ")}`;
    }

    return trimmed;
}

function determineTimeoutMs(command: string, provided: number | undefined, policy: Required<ToolExecPolicy>): number {
    if (typeof provided === "number" && provided > 0) return provided;
    const executable = command.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    const quickSet = buildCommandSet(QUICK_COMMANDS, policy.quickCommands);
    const longSet = buildCommandSet(LONG_COMMANDS, policy.longCommands);
    if (longSet.has(executable)) return policy.longTimeoutMs;
    if (quickSet.has(executable)) return policy.quickTimeoutMs;
    return policy.quickTimeoutMs;
}

function killChildProcess(child: ChildProcess): void {
    try {
        child.kill("SIGKILL");
        return;
    } catch {
        // ignore
    }
    try {
        child.kill();
    } catch {
        // ignore
    }
    if (child.pid) {
        try {
            process.kill(child.pid, "SIGKILL");
        } catch {
            // ignore
        }
    }
}

function isAbsoluteLike(input: string): boolean {
    return path.isAbsolute(input) || /^[A-Za-z]:/.test(input) || input.startsWith("\\\\");
}

function stripOuterQuotes(token: string): string {
    if (token.length >= 2) {
        if ((token.startsWith("\"") && token.endsWith("\"")) || (token.startsWith("'") && token.endsWith("'"))) {
            return token.slice(1, -1);
        }
    }
    return token;
}

function tokenizeCommand(segment: string): string[] {
    const matches = segment.match(/"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s]+/g) ?? [];
    return matches.map(stripOuterQuotes).filter(Boolean);
}

function serializeTokens(tokens: string[]): string {
    return tokens
        .map((token) => (/\s/.test(token) ? `"${token.replace(/"/g, '\\"')}"` : token))
        .join(" ")
        .trim();
}

function trimParensToken(token: string, side: "start" | "end"): string {
    if (side === "start") return token.replace(/^\(+/, "");
    return token.replace(/\)+$/, "");
}

function unwrapGroupedTokens(tokens: string[]): string[] {
    if (tokens.length === 0) return tokens;
    const copy = [...tokens];
    copy[0] = trimParensToken(copy[0], "start");
    copy[copy.length - 1] = trimParensToken(copy[copy.length - 1], "end");
    return copy.map(stripOuterQuotes).filter(Boolean);
}

function isUnderAnyAllowedRoot(absolute: string, workspaceRoot: string, extraWorkspaceRoots?: string[]): boolean {
    if (isUnderRoot(absolute, workspaceRoot)) return true;
    return (extraWorkspaceRoots ?? []).some((root) => isUnderRoot(absolute, root));
}

function resolveExecPath(targetPath: string, cwd: string): string {
    return isAbsoluteLike(targetPath)
        ? path.resolve(targetPath)
        : path.resolve(cwd, targetPath);
}

function resolveWorkingDirectory(
    cwdArg: string | undefined,
    workspaceRoot: string,
    extraWorkspaceRoots?: string[]
): { ok: true; cwd: string } | { ok: false; reason: string } {
    const cwd = cwdArg
        ? (isAbsoluteLike(cwdArg) ? path.resolve(cwdArg) : path.resolve(workspaceRoot, cwdArg))
        : path.resolve(workspaceRoot);

    if (!isUnderAnyAllowedRoot(cwd, workspaceRoot, extraWorkspaceRoots)) {
        return { ok: false, reason: "Working directory escapes allowed roots." };
    }

    return { ok: true, cwd };
}

function isWindowsSwitchToken(token: string): boolean {
    return /^\/(?![\\/])[A-Za-z?][^\\/:]*$/i.test(token);
}

function getValidatedPathOperands(executable: string, tokens: string[]): string[] {
    const args = tokens.slice(1);
    const nonSwitchArgs = args.filter((token) => !isWindowsSwitchToken(token));

    switch (executable) {
        case "copy":
        case "move":
            return nonSwitchArgs.slice(0, Math.max(0, nonSwitchArgs.length));
        case "ren":
            return nonSwitchArgs.slice(0, 2);
        case "del":
            return nonSwitchArgs;
        default:
            return [];
    }
}

type ParsedControlledBuiltin =
    | { kind: "if"; conditionPath: string; thenCommand: string; elseCommand?: string }
    | { kind: "for"; iterableTokens: string[]; nestedCommand: string };

function countParenDelta(token: string): number {
    let delta = 0;
    for (const ch of token) {
        if (ch === "(") delta += 1;
        if (ch === ")") delta -= 1;
    }
    return delta;
}

function splitTokensAtTopLevelKeyword(tokens: string[], keyword: string): { before: string[]; after?: string[] } {
    let depth = 0;

    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token.toLowerCase() === keyword && depth === 0) {
            return {
                before: tokens.slice(0, index),
                after: tokens.slice(index + 1),
            };
        }
        depth += countParenDelta(token);
    }

    return { before: tokens };
}

function parseControlledWindowsBuiltin(cmd: string): ParsedControlledBuiltin | { error: string } | null {
    const tokens = tokenizeCommand(cmd);
    if (tokens.length === 0) return { error: "Empty command" };

    const executable = tokens[0].toLowerCase();
    if (!WINDOWS_CONTROLLED_BUILTINS.has(executable)) return null;

    if (executable === "if") {
        let index = 1;
        if (tokens[index]?.toLowerCase() === "not") index += 1;
        if (tokens[index]?.toLowerCase() !== "exist") {
            return { error: "Only 'if [not] exist <path> <command> [else <command>]' is allowed." };
        }

        const conditionPath = tokens[index + 1];
        const commandTokens = tokens.slice(index + 2);
        const { before, after } = splitTokensAtTopLevelKeyword(commandTokens, "else");
        const thenTokens = unwrapGroupedTokens(before);
        const elseTokens = after ? unwrapGroupedTokens(after) : [];
        if (!conditionPath || thenTokens.length === 0 || (after && elseTokens.length === 0)) {
            return { error: "Only 'if [not] exist <path> <command> [else <command>]' is allowed." };
        }

        return {
            kind: "if",
            conditionPath,
            thenCommand: serializeTokens(thenTokens),
            elseCommand: elseTokens.length > 0 ? serializeTokens(elseTokens) : undefined,
        };
    }

    let index = 1;
    while (index < tokens.length && isWindowsSwitchToken(tokens[index])) {
        index += 1;
    }

    if (!tokens[index]) {
        return { error: "Only 'for ... in (...) do <command>' is allowed." };
    }
    index += 1;

    if (tokens[index]?.toLowerCase() !== "in") {
        return { error: "Only 'for ... in (...) do <command>' is allowed." };
    }

    const doIndex = tokens.findIndex((token, idx) => idx > index && token.toLowerCase() === "do");
    if (doIndex < 0) {
        return { error: "Only 'for ... in (...) do <command>' is allowed." };
    }

    const iterableTokens = unwrapGroupedTokens(tokens.slice(index + 1, doIndex));
    const nestedTokens = unwrapGroupedTokens(tokens.slice(doIndex + 1));
    if (iterableTokens.length === 0 || nestedTokens.length === 0) {
        return { error: "Only 'for ... in (...) do <command>' is allowed." };
    }

    return {
        kind: "for",
        iterableTokens,
        nestedCommand: serializeTokens(nestedTokens),
    };
}

function shouldSkipPathOperandValidation(token: string): boolean {
    return /^%[^%]+%?$/.test(token);
}

function validateCommandSegments(
    command: string,
    validator: (segment: string, depth: number) => { valid: boolean; reason?: string },
    depth = 0,
): { valid: boolean; reason?: string } {
    const segmented = splitCommandSegments(command);
    if (!segmented.ok) {
        return { valid: false, reason: segmented.reason };
    }

    for (const segment of segmented.segments) {
        const validation = validator(segment, depth + 1);
        if (!validation.valid) {
            return validation;
        }
    }

    return { valid: true };
}

function validateControlledBuiltinCommand(
    cmd: string,
    safelist: Set<string>,
    blocklist: Set<string>,
    depth = 0,
): { handled: boolean; valid: boolean; reason?: string } {
    if (process.platform !== "win32") return { handled: false, valid: true };
    if (depth > 3) {
        return { handled: true, valid: false, reason: "Windows shell builtin nesting is too deep." };
    }

    const parsed = parseControlledWindowsBuiltin(cmd);
    if (parsed == null) return { handled: false, valid: true };
    if ("error" in parsed) {
        return { handled: true, valid: false, reason: parsed.error };
    }

    if (parsed.kind === "if") {
        const thenValidation = validateCommandSegments(
            parsed.thenCommand,
            (segment, nextDepth) => validateCommandInternal(segment, safelist, blocklist, nextDepth),
            depth,
        );
        if (!thenValidation.valid) {
            return { handled: true, valid: false, reason: thenValidation.reason };
        }

        if (parsed.elseCommand) {
            const elseValidation = validateCommandSegments(
                parsed.elseCommand,
                (segment, nextDepth) => validateCommandInternal(segment, safelist, blocklist, nextDepth),
                depth,
            );
            if (!elseValidation.valid) {
                return { handled: true, valid: false, reason: elseValidation.reason };
            }
        }

        return { handled: true, valid: true };
    }

    const nestedValidation = validateCommandSegments(
        parsed.nestedCommand,
        (segment, nextDepth) => validateCommandInternal(segment, safelist, blocklist, nextDepth),
        depth,
    );
    if (!nestedValidation.valid) {
        return { handled: true, valid: false, reason: nestedValidation.reason };
    }

    return { handled: true, valid: true };
}

function validateControlledBuiltinPathBoundaries(
    cmd: string,
    cwd: string,
    workspaceRoot: string,
    extraWorkspaceRoots: string[] | undefined,
    depth = 0,
): { handled: boolean; valid: boolean; reason?: string } {
    if (process.platform !== "win32") return { handled: false, valid: true };
    if (depth > 3) {
        return { handled: true, valid: false, reason: "Windows shell builtin nesting is too deep." };
    }

    const parsed = parseControlledWindowsBuiltin(cmd);
    if (parsed == null) return { handled: false, valid: true };
    if ("error" in parsed) {
        return { handled: true, valid: false, reason: parsed.error };
    }

    const operands = parsed.kind === "if"
        ? [parsed.conditionPath]
        : parsed.iterableTokens.filter((token) => !shouldSkipPathOperandValidation(token));

    for (const operand of operands) {
        const absolute = resolveExecPath(operand, cwd);
        if (!isUnderAnyAllowedRoot(absolute, workspaceRoot, extraWorkspaceRoots)) {
            return { handled: true, valid: false, reason: `Path operand escapes allowed roots: ${operand}` };
        }
    }

    if (parsed.kind === "if") {
        const thenValidation = validateCommandSegments(
            parsed.thenCommand,
            (segment, nextDepth) => validateCommandPathBoundariesInternal(
                segment,
                cwd,
                workspaceRoot,
                extraWorkspaceRoots,
                nextDepth,
            ),
            depth,
        );
        if (!thenValidation.valid) {
            return { handled: true, valid: false, reason: thenValidation.reason };
        }

        if (parsed.elseCommand) {
            const elseValidation = validateCommandSegments(
                parsed.elseCommand,
                (segment, nextDepth) => validateCommandPathBoundariesInternal(
                    segment,
                    cwd,
                    workspaceRoot,
                    extraWorkspaceRoots,
                    nextDepth,
                ),
                depth,
            );
            if (!elseValidation.valid) {
                return { handled: true, valid: false, reason: elseValidation.reason };
            }
        }

        return { handled: true, valid: true };
    }

    const nestedValidation = validateCommandSegments(
        parsed.nestedCommand,
        (segment, nextDepth) => validateCommandPathBoundariesInternal(
            segment,
            cwd,
            workspaceRoot,
            extraWorkspaceRoots,
            nextDepth,
        ),
        depth,
    );
    if (!nestedValidation.valid) {
        return { handled: true, valid: false, reason: nestedValidation.reason };
    }

    return { handled: true, valid: true };
}

function validateCommandPathBoundariesInternal(
    cmd: string,
    cwd: string,
    workspaceRoot: string,
    extraWorkspaceRoots?: string[],
    depth = 0,
): { valid: true } | { valid: false; reason: string } {
    const builtinValidation = validateControlledBuiltinPathBoundaries(
        cmd,
        cwd,
        workspaceRoot,
        extraWorkspaceRoots,
        depth,
    );
    if (builtinValidation.handled) {
        return builtinValidation.valid
            ? { valid: true }
            : { valid: false, reason: builtinValidation.reason ?? "Windows shell builtin path validation failed." };
    }

    const tokens = tokenizeCommand(cmd);
    if (tokens.length === 0) {
        return { valid: false, reason: "Empty command" };
    }

    const executable = tokens[0].toLowerCase();
    if (!WINDOWS_FILE_COMMANDS.has(executable)) {
        return { valid: true };
    }

    const operands = getValidatedPathOperands(executable, tokens);
    for (const operand of operands) {
        const absolute = resolveExecPath(operand, cwd);
        if (!isUnderAnyAllowedRoot(absolute, workspaceRoot, extraWorkspaceRoots)) {
            return { valid: false, reason: `Path operand escapes allowed roots: ${operand}` };
        }
    }

    return { valid: true };
}

function validateCommandPathBoundaries(
    cmd: string,
    cwd: string,
    workspaceRoot: string,
    extraWorkspaceRoots?: string[]
): { valid: true } | { valid: false; reason: string } {
    return validateCommandPathBoundariesInternal(cmd, cwd, workspaceRoot, extraWorkspaceRoots);
}

function validateCommandInternal(cmd: string, safelist: Set<string>, blocklist: Set<string>, depth = 0): { valid: boolean; reason?: string } {
    const trimmed = cmd.trim();
    if (!trimmed) return { valid: false, reason: "Empty command" };

    const builtinValidation = validateControlledBuiltinCommand(trimmed, safelist, blocklist, depth);
    if (builtinValidation.handled) {
        return builtinValidation.valid
            ? { valid: true }
            : { valid: false, reason: builtinValidation.reason };
    }

    // 1. 拆分命令 (简单拆分，不处理复杂引号引用，优先保证安全)
    const parts = trimmed.split(/\s+/);
    const executable = parts[0].toLowerCase(); // Windows 命令不区分大小写，统一转小写判断

    // 2. 检查黑名单
    if (blocklist.has(executable)) {
        return { valid: false, reason: `Command '${executable}' is blocked by security policy.` };
    }

    // 3. 检查白名单
    // 注意：如果我们不在白名单中，默认拒绝（Strict Mode）
    // 为了灵活性，我们允许本地脚本与 create-* 命令
    const isLocalScript = executable.startsWith("./") || executable.startsWith("../") || executable.endsWith(".sh") || executable.endsWith(".js");
    const isCreateCommand = executable.startsWith("create-");

    if (!safelist.has(executable) && !isLocalScript && !isCreateCommand) {
        // 允许 rm/del 但要检查参数
        if (executable === "rm" || executable === "del") {
            // pass to arg check
        } else {
            return { valid: false, reason: `Command '${executable}' is not in the safe list.` };
        }
    }

    // 4. 检查参数风险
    // 针对 rm
    if (executable === "rm") {
        const args = parts.slice(1).join(" ");
        if (args.includes("-r") || args.includes("-R") || args.includes("-f") || args.includes("-F")) {
            return { valid: false, reason: "Recursive/Force deletion with 'rm' is blocked. Please use 'delete_file' tool or manual verification." };
        }
    }
    
    // 针对 del (Windows)
    if (executable === "del") {
        const args = parts.slice(1).join(" ").toLowerCase();
        // /s (recursive), /q (quiet mode), /f (force) - Windows style
        if (args.includes("/s") || args.includes("/q") || args.includes("/f")) {
            return { valid: false, reason: "Recursive/Quiet deletion with 'del' is blocked. Please use 'delete_file' tool or manual verification." };
        }
    }

    // 5. 检查管道/重定向中的高危操作 (简单检查)
    // 如果包含 sudo 即使在中间也不行
    if (trimmed.includes(" sudo ")) {
        return { valid: false, reason: "Command contains 'sudo' which is forbidden." };
    }

    return { valid: true };
}

function validateCommand(cmd: string, safelist: Set<string>, blocklist: Set<string>): { valid: boolean; reason?: string } {
    return validateCommandInternal(cmd, safelist, blocklist);
}

function isUnderRoot(absolute: string, root: string): boolean {
    const resolvedRoot = path.resolve(root);
    const rel = path.relative(resolvedRoot, path.resolve(absolute));
    return !(rel.startsWith("..") || path.isAbsolute(rel));
}

function buildShellSyntaxPolicyReason(
    reason: string,
    command: string,
): string {
    if (reason !== "Redirection syntax is blocked by security policy.") {
        return reason;
    }

    const hints = [
        "run_command already captures stdout/stderr, so shell redirection is usually unnecessary.",
        "Prefer command-native flags or dedicated tools like file_read, log_read, and log_search when you need bounded output.",
    ];

    if (/[<>]/.test(command)) {
        hints.push("Remove >, <, or 2>/dev/null from the command instead of trying to hide or redirect output.");
    }

    if (/\|\s*(head|tail)\b/i.test(command)) {
        hints.push("If you only need a small slice of output, prefer tool-specific limit flags or a bounded read instead of piping to head/tail.");
    }

    if (process.platform === "win32") {
        hints.push("On Windows, avoid Unix shell snippets such as 2>/dev/null; if you need shell-specific formatting, use a PowerShell command explicitly and keep it non-interactive.");
    }

    return `${reason} ${hints.join(" ")}`;
}

function splitCommandSegments(
    command: string,
): { ok: true; segments: string[] } | { ok: false; reason: string; reasonCode?: "subshell" | "redirection" | "syntax" } {
    const segments: string[] = [];
    let current = "";
    let quote: "'" | "\"" | null = null;
    let escaped = false;
    let parenDepth = 0;

    const pushSegment = () => {
        const trimmed = current.trim();
        if (trimmed) segments.push(trimmed);
        current = "";
    };

    for (let i = 0; i < command.length; i++) {
        const ch = command[i];
        const next = command[i + 1];

        if (escaped) {
            current += ch;
            escaped = false;
            continue;
        }

        if (ch === "\\") {
            current += ch;
            escaped = true;
            continue;
        }

        if (quote) {
            if (ch === quote) quote = null;
            current += ch;
            continue;
        }

        if (ch === "'" || ch === "\"") {
            quote = ch;
            current += ch;
            continue;
        }

        if (ch === "(") {
            parenDepth += 1;
            current += ch;
            continue;
        }

        if (ch === ")") {
            parenDepth = Math.max(0, parenDepth - 1);
            current += ch;
            continue;
        }

        if (ch === "`" || (ch === "$" && next === "(")) {
            return { ok: false, reason: "Subshell syntax is blocked by security policy.", reasonCode: "subshell" };
        }

        if (ch === ">" || ch === "<") {
            return { ok: false, reason: "Redirection syntax is blocked by security policy.", reasonCode: "redirection" };
        }

        if (ch === ";" || ch === "\n") {
            if (parenDepth === 0) {
                pushSegment();
                continue;
            }
            current += ch;
            continue;
        }

        if (ch === "|" || ch === "&") {
            // 支持单字符与双字符控制符：|、||、&、&&
            if (parenDepth === 0) {
                pushSegment();
                if (next === ch) i += 1;
                continue;
            }
        }

        current += ch;
    }

    if (quote) {
        return { ok: false, reason: "Unterminated quote in command.", reasonCode: "syntax" };
    }

    pushSegment();
    if (segments.length === 0) {
        return { ok: false, reason: "Empty command", reasonCode: "syntax" };
    }

    return { ok: true, segments };
}

export const runCommandTool: Tool = withToolContract({
    definition: {
        name: "run_command",
        description: "在宿主机执行 Shell 命令。仅允许安全列表内的开发工具 (git, npm, ls, etc.)。**禁止** sudo, mkfs 等高危操作。",
        parameters: {
            type: "object",
            properties: {
                command: {
                    type: "string",
                    description: "要执行的 Shell 命令",
                },
                cwd: {
                    type: "string",
                    description: "工作目录（可选，默认工作区根目录）",
                },
                timeoutMs: {
                    type: "number",
                    description: "超时时间（毫秒），默认 5000",
                },
            },
            required: ["command"],
        },
    },

    async execute(args, context): Promise<ToolCallResult> {
        const start = Date.now();
        const id = crypto.randomUUID();
        const name = "run_command";

        const makeResult = (
            success: boolean,
            output: string,
            error?: string,
            failureKind?: ToolCallResult["failureKind"],
        ): ToolCallResult => (
            success
                ? {
                    id,
                    name,
                    success,
                    output,
                    durationMs: Date.now() - start,
                }
                : buildFailureToolCallResult({
                    id,
                    name,
                    start,
                    output,
                    error: error ?? "",
                    ...(failureKind ? { failureKind } : {}),
                })
        );

        const commandRaw = args.command as string;
        if (!commandRaw || typeof commandRaw !== "string") {
            return makeResult(false, "", "Command is required", "input_error");
        }

        // 路径拦截优先：禁止触达 SOUL.md
        if (containsProtectedPath(commandRaw)) {
            const reason = "Access to protected file 'SOUL.md' is blocked.";
            context.logger?.warn(`[Security Block] ${commandRaw} -> ${reason}`);
            return makeResult(false, "", `Security Error: ${reason}`, "permission_or_policy");
        }

        // 环境变量保护：禁止通过 exec 读取 .env
        if (isEnvReadAttempt(commandRaw)) {
            const reason = "Reading .env via exec is forbidden.";
            context.logger?.warn(`[Security Block] ${commandRaw} -> ${reason}`);
            return makeResult(false, "", `Security Error: ${reason}`, "permission_or_policy");
        }

        const execPolicy = normalizeExecPolicy(context.policy.exec);
        const safelist = buildSafelistWithPolicy(execPolicy);
        const blocklist = buildBlocklistWithPolicy(execPolicy);

        const command = applyNonInteractiveFlags(commandRaw, execPolicy);

        // 安全验证：按 shell 控制符分段，逐段校验，避免拼接绕过
        const segmented = splitCommandSegments(command);
        if (!segmented.ok) {
            const policyReason = buildShellSyntaxPolicyReason(segmented.reason, command);
            context.logger?.warn(`[Security Block] ${command} -> ${policyReason}`);
            return makeResult(false, "", `Security Error: ${policyReason}`, "permission_or_policy");
        }

        for (const segment of segmented.segments) {
            const validation = validateCommand(segment, safelist, blocklist);
            if (!validation.valid) {
                context.logger?.warn(`[Security Block] ${segment} -> ${validation.reason}`);
                return makeResult(false, "", `Security Error: ${validation.reason}`, "permission_or_policy");
            }
        }

        const scope = resolveRuntimeFilesystemScope(context);
        const cwdArg = typeof args.cwd === "string" ? args.cwd : context.defaultCwd;
        const cwdResult = resolveWorkingDirectory(
            cwdArg,
            scope.workspaceRoot,
            scope.extraWorkspaceRoots,
        );
        if (!cwdResult.ok) {
            const reason = cwdResult.reason;
            context.logger?.warn(`[Security Block] cwd=${cwdArg ?? scope.workspaceRoot} -> ${reason}`);
            return makeResult(false, "", `Security Error: ${reason}`, "permission_or_policy");
        }
        const cwd = cwdResult.cwd;

        for (const segment of segmented.segments) {
            const pathValidation = validateCommandPathBoundaries(
                segment,
                cwd,
                scope.workspaceRoot,
                scope.extraWorkspaceRoots,
            );
            if (!pathValidation.valid) {
                context.logger?.warn(`[Security Block] ${segment} -> ${pathValidation.reason}`);
                return makeResult(false, "", `Security Error: ${pathValidation.reason}`, "permission_or_policy");
            }
        }

        const timeoutMs = determineTimeoutMs(command, args.timeoutMs as number | undefined, execPolicy);

        context.logger?.info(`[exec] Run: ${command} in ${cwd}`);
        try {
            throwIfAborted(context.abortSignal);
        } catch {
            return makeResult(false, "", readAbortReason(context.abortSignal), "environment_error");
        }

        return new Promise((resolve) => {
            const child = spawn(command, {
                cwd,
                shell: true,
                env: { ...process.env, FORCE_COLOR: "0" }, // 禁用颜色代码
            });
            // run_command 当前不支持向子进程写入 stdin；显式结束 stdin，
            // 避免非交互 CLI 在拿到参数后继续等待 EOF。
            child.stdin?.end();

            let stdout = "";
            let stderr = "";
            let settled = false;

            const finalize = (result: ToolCallResult) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timeoutTimer);
                context.abortSignal?.removeEventListener("abort", onAbort);
                resolve(result);
            };

            const onAbort = () => {
                killChildProcess(child);
                finalize(makeResult(false, stdout, readAbortReason(context.abortSignal), "environment_error"));
            };

            const timeoutTimer = setTimeout(() => {
                killChildProcess(child);
                finalize(makeResult(false, stdout, `Timeout after ${timeoutMs}ms\nStderr: ${stderr}`, "environment_error"));
            }, timeoutMs);
            context.abortSignal?.addEventListener("abort", onAbort, { once: true });

            child.stdout.on("data", (data) => {
                stdout += data.toString();
            });

            child.stderr.on("data", (data) => {
                stderr += data.toString();
            });

            child.on("close", (code) => {
                if (code === 0) {
                    finalize(makeResult(true, stdout));
                } else {
                    finalize(makeResult(
                        false,
                        stdout,
                        `Process exited with code ${code}\nStderr: ${stderr}`,
                        inferToolFailureKindFromError(stderr || `Process exited with code ${code}`),
                    ));
                }
            });

            child.on("error", (err) => {
                finalize(makeResult(false, stdout, `Spawn error: ${err.message}`, "environment_error"));
            });
        });
    },
}, {
    family: "command-exec",
    isReadOnly: false,
    isConcurrencySafe: false,
    needsPermission: true,
    riskLevel: "critical",
    channels: ["gateway", "web", "cli"],
    safeScopes: ["privileged"],
    activityDescription: "Execute a shell command on the host inside allowed workspace boundaries",
    resultSchema: {
        kind: "text",
        description: "Captured stdout with optional stderr metadata.",
    },
    outputPersistencePolicy: "conversation",
});
