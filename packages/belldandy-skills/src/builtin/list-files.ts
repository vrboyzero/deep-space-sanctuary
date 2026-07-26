import crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Tool, ToolContext, ToolCallResult } from "../types.js";
import { withToolContract } from "../tool-contract.js";
import { resolveRuntimeFilesystemScope } from "../runtime-policy.js";
import { isAbortError, readAbortReason, throwIfAborted } from "../abort-utils.js";

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

/** 检查路径是否在指定根目录下（不越界） */
function isUnderRoot(absolute: string, root: string): { ok: true; relative: string } | { ok: false } {
    const resolvedRoot = path.resolve(root);
    const rel = path.relative(resolvedRoot, absolute);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return { ok: false };
    return { ok: true, relative: rel.replace(/\\/g, "/") };
}

function expandHomeShorthand(pathArg: string): string {
    const trimmed = (pathArg || "").trim();
    if (trimmed === "~") {
        return os.homedir();
    }
    if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
        return path.join(os.homedir(), trimmed.slice(2));
    }
    return trimmed;
}

/** 规范化并验证路径在工作区内（主工作区或 extraWorkspaceRoots 中的任一根目录下）；返回匹配的根目录供列目录时计算相对路径用 */
function resolveAndValidatePath(
    pathArg: string,
    workspaceRoot: string,
    extraWorkspaceRoots?: string[]
): { ok: true; absolute: string; relative: string; effectiveRoot: string } | { ok: false; error: string } {
    const trimmed = (pathArg || "").trim();
    if (!trimmed) {
        return { ok: false, error: "路径不能为空" };
    }

    const expanded = expandHomeShorthand(trimmed);
    const normalized = expanded.replace(/\\/g, "/");
    const mainRoot = path.resolve(workspaceRoot);

    let absolute: string;
    if (path.isAbsolute(normalized) || (expanded.length >= 2 && /^[A-Za-z]:/.test(expanded))) {
        absolute = path.resolve(normalized);
    } else {
        absolute = path.resolve(mainRoot, normalized);
    }

    const underMain = isUnderRoot(absolute, mainRoot);
    if (underMain.ok) {
        return { ok: true, absolute, relative: underMain.relative, effectiveRoot: mainRoot };
    }
    if (extraWorkspaceRoots?.length) {
        for (const extra of extraWorkspaceRoots) {
            const resolvedExtra = path.resolve(extra);
            const underExtra = isUnderRoot(absolute, resolvedExtra);
            if (underExtra.ok) {
                return { ok: true, absolute, relative: underExtra.relative, effectiveRoot: resolvedExtra };
            }
        }
    }

    return { ok: false, error: "路径越界：不允许访问工作区外的目录" };
}

// ============ list_files 工具 ============

type FileEntry = {
    name: string;
    path: string;
    type: "file" | "directory";
    size?: number;
};

const MAX_LIST_FILE_ENTRIES = 1_000;
const DEFAULT_LIST_FILES_RESPONSE_BYTES = 512_000;

type DirectoryListingState = {
    entries: FileEntry[];
    maxEntries: number;
    truncated: boolean;
};

async function listDirectory(
    dir: string,
    workspaceRoot: string,
    deniedPaths: string[],
    recursive: boolean,
    maxDepth: number,
    currentDepth: number,
    state: DirectoryListingState,
    signal?: AbortSignal,
): Promise<void> {
    if (currentDepth > maxDepth) return;
    throwIfAborted(signal);

    try {
        const directory = await fs.opendir(dir);
        for await (const item of directory) {
            throwIfAborted(signal);
            if (state.entries.length >= state.maxEntries) {
                state.truncated = true;
                return;
            }
            const fullPath = path.join(dir, item.name);
            const relativePath = path.relative(workspaceRoot, fullPath).replace(/\\/g, "/");
            if (isDeniedPath(relativePath, deniedPaths)) {
                continue;
            }

            if (item.isDirectory()) {
                state.entries.push({
                    name: item.name,
                    path: relativePath,
                    type: "directory",
                });

                if (recursive && currentDepth < maxDepth) {
                    await listDirectory(
                        fullPath,
                        workspaceRoot,
                        deniedPaths,
                        recursive,
                        maxDepth,
                        currentDepth + 1,
                        state,
                        signal,
                    );
                    if (state.truncated) {
                        return;
                    }
                }
            } else if (item.isFile()) {
                try {
                    const stat = await fs.stat(fullPath);
                    state.entries.push({
                        name: item.name,
                        path: relativePath,
                        type: "file",
                        size: stat.size,
                    });
                } catch {
                    // 忽略无法访问的文件
                    state.entries.push({
                        name: item.name,
                        path: relativePath,
                        type: "file",
                    });
                }
            }
        }
    } catch (error) {
        if (isAbortError(error)) {
            throw error;
        }
        // 忽略无法访问的目录
    }
}

function normalizeResponseByteLimit(value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
        return DEFAULT_LIST_FILES_RESPONSE_BYTES;
    }
    return Math.max(1, Math.floor(value));
}

function buildBoundedListingOutput(input: {
    path: string;
    recursive: boolean;
    depth: number;
    entries: FileEntry[];
    traversalTruncated: boolean;
    maxEntries: number;
    maxResponseBytes: number;
}): string | undefined {
    const buildPayload = (entryCount: number, truncated: boolean): string => JSON.stringify({
        path: input.path,
        totalEntries: entryCount,
        recursive: input.recursive,
        depth: input.depth,
        ...(truncated
            ? {
                truncated: true,
                limits: {
                    maxEntries: input.maxEntries,
                    maxResponseBytes: input.maxResponseBytes,
                },
            }
            : {}),
        entries: input.entries.slice(0, entryCount),
    });

    const complete = buildPayload(input.entries.length, input.traversalTruncated);
    if (Buffer.byteLength(complete, "utf-8") <= input.maxResponseBytes) {
        return complete;
    }

    // 二分查找可保留的最大条目数，确保截断后仍是完整可解析的 JSON。
    let low = 0;
    let high = input.entries.length;
    let best: string | undefined;
    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const candidate = buildPayload(middle, true);
        if (Buffer.byteLength(candidate, "utf-8") <= input.maxResponseBytes) {
            best = candidate;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }
    return best;
}

export const listFilesTool: Tool = withToolContract({
    definition: {
        name: "list_files",
        description:
            "列出工作区内或 BELLDANDY_EXTRA_WORKSPACE_ROOTS 配置的根目录下指定目录的文件和子目录。path 可为相对路径（相对主工作区）或允许范围内的绝对路径（如 C:/、E:/ 下的路径）。",
        parameters: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description: "目录路径：相对主工作区的相对路径，或允许的绝对路径如 C:/Users、E:/project（默认为 '.' 即主工作区根）",
                },
                recursive: {
                    type: "boolean",
                    description: "是否递归列出子目录内容（默认 false）",
                },
                depth: {
                    type: "number",
                    description: "递归深度限制（默认 3，最大 10）",
                },
            },
            required: [],
        },
    },

    async execute(args, context): Promise<ToolCallResult> {
        const start = Date.now();
        const id = crypto.randomUUID();
        const name = "list_files";

        const makeError = (error: string): ToolCallResult => ({
            id,
            name,
            success: false,
            output: "",
            error,
            durationMs: Date.now() - start,
        });

        // 参数处理
        const pathArg = typeof args.path === "string" && args.path.trim() ? args.path.trim() : ".";
        const recursive = args.recursive === true;
        const depth = typeof args.depth === "number" && args.depth > 0
            ? Math.min(args.depth, 10)
            : 3;

        // 路径验证（主工作区或 extraWorkspaceRoots 下的目录均可）
        const scope = resolveRuntimeFilesystemScope(context);
        const pathResult = resolveAndValidatePath(pathArg, scope.workspaceRoot, scope.extraWorkspaceRoots);
        if (!pathResult.ok) {
            return makeError(pathResult.error);
        }

        const { absolute, relative, effectiveRoot } = pathResult;

        // 黑名单检查
        const denied = isDeniedPath(relative, context.policy.deniedPaths);
        if (denied) {
            return makeError(`禁止访问路径：${denied}`);
        }

        try {
            throwIfAborted(context.abortSignal);
            const stat = await fs.stat(absolute);

            if (!stat.isDirectory()) {
                return makeError(`路径不是目录：${relative}`);
            }

            const listingState: DirectoryListingState = {
                entries: [],
                maxEntries: MAX_LIST_FILE_ENTRIES,
                truncated: false,
            };
            await listDirectory(
                absolute,
                effectiveRoot,
                context.policy.deniedPaths,
                recursive,
                depth,
                1,
                listingState,
                context.abortSignal,
            );

            // 按类型和名称排序
            listingState.entries.sort((a, b) => {
                if (a.type !== b.type) {
                    return a.type === "directory" ? -1 : 1;
                }
                return a.name.localeCompare(b.name);
            });

            const maxResponseBytes = normalizeResponseByteLimit(context.policy.maxResponseBytes);
            const output = buildBoundedListingOutput({
                path: relative || ".",
                recursive,
                depth,
                entries: listingState.entries,
                traversalTruncated: listingState.truncated,
                maxEntries: listingState.maxEntries,
                maxResponseBytes,
            });
            if (!output) {
                return makeError(`响应预算过小：list_files 至少需要容纳基础 JSON 元数据（当前 ${maxResponseBytes} bytes）`);
            }

            return {
                id,
                name,
                success: true,
                output,
                durationMs: Date.now() - start,
            };
        } catch (err) {
            if (isAbortError(err)) {
                return makeError(readAbortReason(context.abortSignal));
            }
            const code = (err as NodeJS.ErrnoException).code;
            if (code === "ENOENT") {
                return makeError(`目录不存在：${relative}`);
            }
            if (code === "EACCES") {
                return makeError(`无权访问目录：${relative}`);
            }
            return makeError(err instanceof Error ? err.message : String(err));
        }
    },
}, {
    family: "workspace-read",
    isReadOnly: true,
    isConcurrencySafe: true,
    needsPermission: false,
    riskLevel: "low",
    channels: ["gateway", "web", "cli"],
    safeScopes: ["local-safe", "web-safe"],
    activityDescription: "List files and directories inside the workspace",
    resultSchema: {
        kind: "json",
        description: "Directory listing payload encoded as JSON text.",
    },
    outputPersistencePolicy: "conversation",
});
