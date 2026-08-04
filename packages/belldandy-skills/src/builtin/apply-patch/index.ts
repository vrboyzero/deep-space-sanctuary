import crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Tool, ToolCallResult, ToolContext } from "../../types.js";
import { parsePatchText } from "./dsl.js";
import { applyUpdateChunks } from "./match.js";
import { withToolContract } from "../../tool-contract.js";
import { resolveRuntimeFilesystemScope } from "../../runtime-policy.js";
import { readAbortReason, throwIfAborted } from "../../abort-utils.js";
import { buildFailureToolCallResult } from "../../failure-kind.js";
import { resolvePrivilegedWorkspaceWriteChannels } from "../privileged-workspace-write-contract.js";

// ============ Helper Functions ============

/** 敏感文件模式（禁止修改） */
const SENSITIVE_PATTERNS = [
    ".env",
    ".env.local",
    ".env.production",
    "credentials",
    "secret",
    ".key",
    ".pem",
    ".p12",
    ".pfx",
    "id_rsa",
    "id_ed25519",
    ".ssh",
    "password",
    "token",
];

/** 检查路径是否包含敏感文件模式 */
function isSensitivePath(relativePath: string): boolean {
    const lower = relativePath.toLowerCase();
    return SENSITIVE_PATTERNS.some(p => lower.includes(p));
}

/** 检查路径是否在黑名单中 */
function isDeniedPath(relativePath: string, deniedPaths: string[]): string | null {
    const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
    for (const denied of deniedPaths) {
        const deniedNorm = denied.replace(/\\/g, "/").toLowerCase();
        if (normalized.includes(deniedNorm)) {
            return denied;
        }
    }
    return null;
}

function isAllowedPath(relativePath: string, allowedPaths: string[]): boolean {
    if (allowedPaths.length === 0) return true;
    const normalizedRelative = relativePath.replace(/\\/g, "/").toLowerCase();
    return allowedPaths.some((entry) => {
        const normalizedAllowed = entry.replace(/\\/g, "/").toLowerCase();
        if (normalizedAllowed === ".") return true;
        return normalizedRelative.startsWith(normalizedAllowed + "/") || normalizedRelative === normalizedAllowed;
    });
}

function isUnderRoot(absolute: string, root: string): { ok: true; relative: string } | { ok: false } {
    const resolvedRoot = path.resolve(root);
    const rel = path.relative(resolvedRoot, absolute);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return { ok: false };
    return { ok: true, relative: rel.replace(/\\/g, "/") };
}

/** 规范化并验证路径在工作区内（主工作区或 extraWorkspaceRoots 中的任一根目录下） */
function resolveAndValidatePath(
    pathArg: string,
    workspaceRoot: string,
    extraWorkspaceRoots?: string[],
): { ok: true; absolute: string; relative: string } | { ok: false; error: string } {
    const trimmed = (pathArg || "").trim();
    if (!trimmed) {
        return { ok: false, error: "路径不能为空" };
    }

    const normalized = trimmed.replace(/\\/g, "/");
    const mainRoot = path.resolve(workspaceRoot);

    const absolute = path.isAbsolute(normalized) || (trimmed.length >= 2 && /^[A-Za-z]:/.test(trimmed))
        ? path.resolve(normalized)
        : path.resolve(mainRoot, normalized);

    const underMain = isUnderRoot(absolute, mainRoot);
    if (underMain.ok) {
        return { ok: true, absolute, relative: underMain.relative };
    }

    for (const extraRoot of extraWorkspaceRoots ?? []) {
        const underExtra = isUnderRoot(absolute, path.resolve(extraRoot));
        if (underExtra.ok) {
            return { ok: true, absolute, relative: underExtra.relative };
        }
    }

    return { ok: false, error: "路径越界：不允许访问工作区外的文件" };
}

function validateWritablePath(
    pathArg: string,
    context: ToolContext,
): { ok: true; absolute: string; relative: string } | { ok: false; error: string } {
    const scope = resolveRuntimeFilesystemScope(context);
    const resolved = resolveAndValidatePath(pathArg, scope.workspaceRoot, scope.extraWorkspaceRoots);
    if (!resolved.ok) return resolved;

    if (isSensitivePath(resolved.relative)) {
        return { ok: false, error: `[${resolved.relative}] 禁止修改敏感文件` };
    }

    const denied = isDeniedPath(resolved.relative, context.policy.deniedPaths);
    if (denied) {
        return { ok: false, error: `[${resolved.relative}] 禁止修改路径：${denied}` };
    }

    if (!isAllowedPath(resolved.relative, context.policy.allowedPaths)) {
        return { ok: false, error: `[${resolved.relative}] 路径不在写入白名单中` };
    }

    return resolved;
}

async function ensureDir(filePath: string) {
    const parent = path.dirname(filePath);
    if (!parent || parent === ".") return;
    await fs.mkdir(parent, { recursive: true });
}

type PreparedPatchOperation =
    | { kind: "add"; absolute: string; relative: string; contents: string }
    | { kind: "delete"; absolute: string; relative: string }
    | { kind: "update"; absolute: string; relative: string; newContent: string; move?: { absolute: string; relative: string } };

function resolveMutationWorkspaceRoot(absolute: string, context: ToolContext): string {
    const scope = resolveRuntimeFilesystemScope(context);
    const roots = [scope.workspaceRoot, ...(scope.extraWorkspaceRoots ?? [])];
    for (const root of roots) {
        if (isUnderRoot(absolute, path.resolve(root)).ok) return path.resolve(root);
    }
    throw new Error("Workspace mutation target is outside its resolved workspace root.");
}

function collectMutationGroups(operations: readonly PreparedPatchOperation[], context: ToolContext): Map<string, Array<{ absolutePath: string; relativePath: string }>> {
    const groups = new Map<string, Array<{ absolutePath: string; relativePath: string }>>();
    const add = (absolute: string, relative: string) => {
        const workspaceRoot = resolveMutationWorkspaceRoot(absolute, context);
        const targets = groups.get(workspaceRoot) ?? [];
        if (!targets.some((target) => target.absolutePath === absolute)) {
            targets.push({ absolutePath: absolute, relativePath: relative });
        }
        groups.set(workspaceRoot, targets);
    };
    for (const operation of operations) {
        add(operation.absolute, operation.relative);
        if (operation.kind === "update" && operation.move) {
            add(operation.move.absolute, operation.move.relative);
        }
    }
    return groups;
}

function readWorkspaceMutationOperation(context: ToolContext) {
    return context.agentRunId && context.toolCallId
        ? {
            conversationId: context.conversationId,
            agentRunId: context.agentRunId,
            toolCallId: context.toolCallId,
        }
        : undefined;
}

async function prepareWorkspaceMutations(
    context: ToolContext,
    groups: ReadonlyMap<string, readonly { absolutePath: string; relativePath: string }[]>,
): Promise<void> {
    if (!context.workspaceMutationObserver || !context.workspaceRevisionId) return;
    for (const [workspaceRoot, targets] of groups) {
        await context.workspaceMutationObserver.prepareMutations({
            workspaceRevisionId: context.workspaceRevisionId,
            workspaceRoot,
            toolName: "apply_patch",
            targets,
            operation: readWorkspaceMutationOperation(context),
        });
    }
}

async function commitWorkspaceMutation(
    context: ToolContext,
    absolute: string,
    relative: string,
): Promise<void> {
    if (!context.workspaceMutationObserver || !context.workspaceRevisionId) return;
    await context.workspaceMutationObserver.commitMutations({
        workspaceRevisionId: context.workspaceRevisionId,
        workspaceRoot: resolveMutationWorkspaceRoot(absolute, context),
        toolName: "apply_patch",
        targets: [{ absolutePath: absolute, relativePath: relative }],
        operation: readWorkspaceMutationOperation(context),
    });
}

// ============ apply_patch Tool ============

export const applyPatchTool: Tool = withToolContract({
    definition: {
        name: "apply_patch",
        description:
            "使用 Unified Diff 变体格式（基于 Blocks）修改一个或多个文件。支持在一次调用中执行添加、删除、更新和移动操作。**这是修改代码的首选方式**。",
        parameters: {
            type: "object",
            properties: {
                input: {
                    type: "string",
                    description: "包含 *** Begin Patch 和 *** End Patch 标记的完整补丁内容",
                },
            },
            required: ["input"],
        },
    },

    async execute(args, context): Promise<ToolCallResult> {
        const start = Date.now();
        const id = crypto.randomUUID();
        const name = "apply_patch";

        const makeError = (error: string, failureKind?: ToolCallResult["failureKind"]): ToolCallResult => (
            buildFailureToolCallResult({
                id,
                name,
                start,
                error,
                ...(failureKind ? { failureKind } : {}),
            })
        );

        // 参数校验
        const inputArg = args.input;
        if (typeof inputArg !== "string" || !inputArg.trim()) {
            return makeError("参数错误：input 必须是非空字符串", "input_error");
        }

        try {
            throwIfAborted(context.abortSignal);
            // 1. 解析 Patch DSL
            const parsed = parsePatchText(inputArg);
            if (parsed.hunks.length === 0) {
                return makeError("未找到任何修改（No Hunks found）", "input_error");
            }

            const summary = {
                added: [] as string[],
                modified: [] as string[],
                deleted: [] as string[],
            };
            const seen = {
                added: new Set<string>(),
                modified: new Set<string>(),
                deleted: new Set<string>(),
            };

            const recordSummary = (bucket: keyof typeof summary, file: string) => {
                if (seen[bucket].has(file)) return;
                seen[bucket].add(file);
                summary[bucket].push(file);
            };

            // 2. 先完成所有预计算；只有在真正提交前才允许 stop，
            // 这样可以避免写了一半文件后因为中断留下不一致状态。
            const operations: PreparedPatchOperation[] = [];
            for (const hunk of parsed.hunks) {
                throwIfAborted(context.abortSignal);
                const pathCheck = validateWritablePath(hunk.path, context);
                if (!pathCheck.ok) throw new Error(pathCheck.error);
                const { absolute, relative } = pathCheck;

                if (hunk.kind === "add") {
                    const existing = await fs.stat(absolute).catch(() => null);
                    if (existing?.isFile()) {
                        throw new Error(`[${relative}] Add File 仅用于新文件；目标文件已存在，请改用 Update File`);
                    }
                    if (existing && !existing.isFile()) {
                        throw new Error(`[${relative}] 目标路径已存在且不是普通文件，无法使用 Add File`);
                    }
                    operations.push({
                        kind: "add",
                        absolute,
                        relative,
                        contents: hunk.contents,
                    });
                    continue;
                }

                if (hunk.kind === "delete") {
                    operations.push({
                        kind: "delete",
                        absolute,
                        relative,
                    });
                    continue;
                }

                if (hunk.kind === "update") {
                    const newContent = await applyUpdateChunks(absolute, hunk.chunks);

                    if (hunk.movePath) {
                        const moveCheck = validateWritablePath(hunk.movePath, context);
                        if (!moveCheck.ok) throw new Error(moveCheck.error);
                        operations.push({
                            kind: "update",
                            absolute,
                            relative,
                            newContent,
                            move: {
                                absolute: moveCheck.absolute,
                                relative: moveCheck.relative,
                            },
                        });
                    } else {
                        operations.push({
                            kind: "update",
                            absolute,
                            relative,
                            newContent,
                        });
                    }
                }
            }

            throwIfAborted(context.abortSignal);
            await prepareWorkspaceMutations(context, collectMutationGroups(operations, context));

            // 3. 进入提交阶段后不再响应 stop，优先保证补丁整体一致性。
            for (const operation of operations) {
                if (operation.kind === "add") {
                    await ensureDir(operation.absolute);
                    await fs.writeFile(operation.absolute, operation.contents, "utf8");
                    await commitWorkspaceMutation(context, operation.absolute, operation.relative);
                    recordSummary("added", operation.relative);
                    continue;
                }

                if (operation.kind === "delete") {
                    await fs.rm(operation.absolute, { force: true });
                    await commitWorkspaceMutation(context, operation.absolute, operation.relative);
                    recordSummary("deleted", operation.relative);
                    continue;
                }

                if (operation.move) {
                    await ensureDir(operation.move.absolute);
                    await fs.writeFile(operation.move.absolute, operation.newContent, "utf8");
                    await commitWorkspaceMutation(context, operation.move.absolute, operation.move.relative);
                    await fs.rm(operation.absolute, { force: true });
                    await commitWorkspaceMutation(context, operation.absolute, operation.relative);
                    recordSummary("modified", `${operation.relative} -> ${operation.move.relative}`);
                    continue;
                }

                await fs.writeFile(operation.absolute, operation.newContent, "utf8");
                await commitWorkspaceMutation(context, operation.absolute, operation.relative);
                recordSummary("modified", operation.relative);
            }

            return {
                id,
                name,
                success: true,
                output: JSON.stringify({
                    summary,
                    details: "Patch applied successfully",
                }),
                durationMs: Date.now() - start,
            };

        } catch (err) {
            if (context.abortSignal?.aborted) {
                return makeError(readAbortReason(context.abortSignal), "environment_error");
            }
            return makeError(err instanceof Error ? err.message : String(err));
        }
    },
}, {
    family: "patch",
    isReadOnly: false,
    isConcurrencySafe: false,
    needsPermission: true,
    riskLevel: "high",
    channels: resolvePrivilegedWorkspaceWriteChannels(),
    safeScopes: ["privileged"],
    activityDescription: "Apply a structured patch to one or more workspace files",
    resultSchema: {
        kind: "json",
        description: "Patch application summary encoded as JSON text.",
    },
    outputPersistencePolicy: "artifact",
});
