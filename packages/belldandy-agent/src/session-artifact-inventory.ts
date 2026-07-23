import { createHash } from "node:crypto";
import type { Dir } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const SESSION_DIGEST_SUFFIX = ".digest.json";
const SESSION_MEMORY_SUFFIX = ".session-memory.json";
const SESSION_META_SUFFIX = ".meta.json";
const CURSOR_VERSION = 1;

const DEFAULT_LIMITS: Required<SessionArtifactInventoryLimits> = {
    maxDirectoryEntries: 4_096,
    maxCandidates: 512,
    maxStatConcurrency: 8,
    maxMetadataReadConcurrency: 4,
    maxMetadataBytesPerFile: 16 * 1024,
    maxMetadataBytesTotal: 1024 * 1024,
    defaultPageSize: 24,
    maxPageSize: 100,
};

export type SessionArtifactInventoryLimits = {
    maxDirectoryEntries?: number;
    maxCandidates?: number;
    maxStatConcurrency?: number;
    maxMetadataReadConcurrency?: number;
    maxMetadataBytesPerFile?: number;
    maxMetadataBytesTotal?: number;
    defaultPageSize?: number;
    maxPageSize?: number;
};

export type SessionArtifactInventoryItem = {
    safeConversationId: string;
    conversationId: string;
    newestFileMs: number;
    digestPath?: string;
    sessionMemoryPath?: string;
    metaPath?: string;
};

export type SessionArtifactInventoryDiagnostics = {
    scannedDirectoryEntries: number;
    artifactCandidates: number;
    metadataBytesRead: number;
    ignoredArtifactCandidates: number;
    unavailableReason?: "root_unavailable" | "directory_entry_limit" | "candidate_limit" | "metadata_total_byte_limit" | "directory_read_failed";
};

export type SessionArtifactInventoryPage = {
    status: "ready" | "unavailable";
    items: SessionArtifactInventoryItem[];
    nextCursor?: string;
    revision?: string;
    diagnostics: SessionArtifactInventoryDiagnostics;
};

export type SessionArtifactInventoryPageOptions = {
    cursor?: string;
    limit?: number;
};

export class SessionArtifactInventoryCursorError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "SessionArtifactInventoryCursorError";
    }
}

type ArtifactFileInfo = {
    path: string;
    mtimeMs: number;
    size: number;
};

type ArtifactCandidate = {
    safeConversationId: string;
    digestPath?: string;
    sessionMemoryPath?: string;
};

type InventorySnapshot = {
    items: SessionArtifactInventoryItem[];
    revision: string;
    diagnostics: SessionArtifactInventoryDiagnostics;
};

type DecodedCursor = {
    revision: string;
    last: Pick<SessionArtifactInventoryItem, "safeConversationId" | "newestFileMs">;
};

export class SessionArtifactInventory {
    private readonly rootDir: string;
    private readonly limits: Required<SessionArtifactInventoryLimits>;

    constructor(options: {
        rootDir: string;
        limits?: SessionArtifactInventoryLimits;
    }) {
        this.rootDir = options.rootDir;
        this.limits = {
            ...DEFAULT_LIMITS,
            ...normalizeLimits(options.limits),
        };
    }

    async listPage(options: SessionArtifactInventoryPageOptions = {}): Promise<SessionArtifactInventoryPage> {
        const snapshot = await this.rebuildSnapshot();
        if (!snapshot) {
            return this.unavailablePage({
                scannedDirectoryEntries: 0,
                artifactCandidates: 0,
                metadataBytesRead: 0,
                ignoredArtifactCandidates: 0,
                unavailableReason: "directory_read_failed",
            });
        }
        if ("unavailableReason" in snapshot.diagnostics && snapshot.diagnostics.unavailableReason) {
            return {
                status: "unavailable",
                items: [],
                diagnostics: snapshot.diagnostics,
            };
        }

        const cursor = options.cursor ? decodeCursor(options.cursor) : undefined;
        if (cursor && cursor.revision !== snapshot.revision) {
            throw new SessionArtifactInventoryCursorError("Session artifact inventory cursor is stale.");
        }

        const startIndex = cursor ? this.resolveCursorStartIndex(snapshot.items, cursor) : 0;
        const limit = normalizePageSize(options.limit, this.limits);
        const items = snapshot.items.slice(startIndex, startIndex + limit);
        const last = items.at(-1);
        const hasMore = startIndex + items.length < snapshot.items.length;

        return {
            status: "ready",
            items,
            ...(hasMore && last ? {
                nextCursor: encodeCursor({
                    revision: snapshot.revision,
                    last: {
                        safeConversationId: last.safeConversationId,
                        newestFileMs: last.newestFileMs,
                    },
                }),
            } : {}),
            revision: snapshot.revision,
            diagnostics: snapshot.diagnostics,
        };
    }

    private async rebuildSnapshot(): Promise<InventorySnapshot | null> {
        const diagnostics: SessionArtifactInventoryDiagnostics = {
            scannedDirectoryEntries: 0,
            artifactCandidates: 0,
            metadataBytesRead: 0,
            ignoredArtifactCandidates: 0,
        };
        const candidates = new Map<string, ArtifactCandidate>();

        let dir: Dir | undefined;
        try {
            dir = await fs.opendir(this.rootDir);
            for await (const entry of dir) {
                diagnostics.scannedDirectoryEntries += 1;
                if (diagnostics.scannedDirectoryEntries > this.limits.maxDirectoryEntries) {
                    return this.unavailableSnapshot(diagnostics, "directory_entry_limit");
                }
                if (!entry.isFile()) continue;

                const suffix = resolveArtifactSuffix(entry.name);
                if (!suffix) continue;
                const safeConversationId = entry.name.slice(0, -suffix.length);
                if (!safeConversationId) continue;

                const candidate: ArtifactCandidate = candidates.get(safeConversationId) ?? { safeConversationId };
                const filePath = path.join(this.rootDir, entry.name);
                if (suffix === SESSION_DIGEST_SUFFIX) {
                    candidate.digestPath = filePath;
                } else {
                    candidate.sessionMemoryPath = filePath;
                }
                candidates.set(safeConversationId, candidate);
                if (candidates.size > this.limits.maxCandidates) {
                    return this.unavailableSnapshot(diagnostics, "candidate_limit");
                }
            }
        } catch (error) {
            const code = (error as NodeJS.ErrnoException | undefined)?.code;
            if (code === "ENOENT") {
                return {
                    items: [],
                    revision: computeRevision([]),
                    diagnostics,
                };
            }
            return this.unavailableSnapshot(diagnostics, "directory_read_failed");
        } finally {
            await dir?.close().catch(() => {});
        }

        diagnostics.artifactCandidates = candidates.size;
        const inspected = await mapWithConcurrency([...candidates.values()], this.limits.maxStatConcurrency, async (candidate) => {
            const [digest, sessionMemory, meta] = await Promise.all([
                candidate.digestPath ? inspectRegularFile(candidate.digestPath) : undefined,
                candidate.sessionMemoryPath ? inspectRegularFile(candidate.sessionMemoryPath) : undefined,
                inspectRegularFile(path.join(this.rootDir, `${candidate.safeConversationId}${SESSION_META_SUFFIX}`)),
            ]);
            return { candidate, digest, sessionMemory, meta };
        });

        let metadataBudget = 0;
        const resolved = await mapWithConcurrency(inspected, this.limits.maxMetadataReadConcurrency, async (entry) => {
            if (!entry.digest && !entry.sessionMemory) {
                diagnostics.ignoredArtifactCandidates += 1;
                return undefined;
            }

            const metadataSize = entry.meta?.size ?? 0;
            if (metadataBudget + metadataSize > this.limits.maxMetadataBytesTotal) {
                return "metadata_total_byte_limit" as const;
            }
            metadataBudget += metadataSize;

            let conversationId: string | undefined;
            if (!entry.candidate.safeConversationId.includes("%")) {
                conversationId = entry.candidate.safeConversationId;
            } else if (entry.meta && entry.meta.size <= this.limits.maxMetadataBytesPerFile) {
                const parsed = await readConversationIdFromMeta(entry.meta.path, entry.meta.size, this.limits.maxMetadataBytesPerFile);
                diagnostics.metadataBytesRead += parsed.bytesRead;
                conversationId = parsed.conversationId;
            }

            if (!conversationId) {
                diagnostics.ignoredArtifactCandidates += 1;
                return undefined;
            }

            const newestFileMs = Math.max(entry.digest?.mtimeMs ?? 0, entry.sessionMemory?.mtimeMs ?? 0);
            return {
                item: {
                    safeConversationId: entry.candidate.safeConversationId,
                    conversationId,
                    newestFileMs,
                    ...(entry.digest ? { digestPath: entry.digest.path } : {}),
                    ...(entry.sessionMemory ? { sessionMemoryPath: entry.sessionMemory.path } : {}),
                    ...(entry.meta ? { metaPath: entry.meta.path } : {}),
                } satisfies SessionArtifactInventoryItem,
                revisionPart: buildRevisionPart(entry.candidate.safeConversationId, entry.digest, entry.sessionMemory, entry.meta),
            };
        });

        if (resolved.includes("metadata_total_byte_limit")) {
            return this.unavailableSnapshot(diagnostics, "metadata_total_byte_limit");
        }

        const entries = resolved.filter((entry): entry is { item: SessionArtifactInventoryItem; revisionPart: string } => Boolean(entry));
        const items = entries
            .map((entry) => entry.item)
            .sort(compareInventoryItems);
        return {
            items,
            revision: computeRevision(entries.map((entry) => entry.revisionPart)),
            diagnostics,
        };
    }

    private resolveCursorStartIndex(items: SessionArtifactInventoryItem[], cursor: DecodedCursor): number {
        const index = items.findIndex((item) => (
            item.safeConversationId === cursor.last.safeConversationId
            && item.newestFileMs === cursor.last.newestFileMs
        ));
        if (index < 0) {
            throw new SessionArtifactInventoryCursorError("Session artifact inventory cursor anchor is unavailable.");
        }
        return index + 1;
    }

    private unavailableSnapshot(
        diagnostics: SessionArtifactInventoryDiagnostics,
        unavailableReason: NonNullable<SessionArtifactInventoryDiagnostics["unavailableReason"]>,
    ): InventorySnapshot {
        return {
            items: [],
            revision: "",
            diagnostics: {
                ...diagnostics,
                unavailableReason,
            },
        };
    }

    private unavailablePage(diagnostics: SessionArtifactInventoryDiagnostics): SessionArtifactInventoryPage {
        return {
            status: "unavailable",
            items: [],
            diagnostics,
        };
    }
}

function resolveArtifactSuffix(fileName: string): typeof SESSION_DIGEST_SUFFIX | typeof SESSION_MEMORY_SUFFIX | undefined {
    if (fileName.endsWith(SESSION_MEMORY_SUFFIX)) {
        return SESSION_MEMORY_SUFFIX;
    }
    if (fileName.endsWith(SESSION_DIGEST_SUFFIX)) {
        return SESSION_DIGEST_SUFFIX;
    }
    return undefined;
}

function normalizeLimits(limits: SessionArtifactInventoryLimits | undefined): SessionArtifactInventoryLimits {
    if (!limits) return {};
    return Object.fromEntries(Object.entries(limits).flatMap(([key, value]) => {
        if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
            return [];
        }
        return [[key, Math.floor(value)]];
    })) as SessionArtifactInventoryLimits;
}

function normalizePageSize(value: number | undefined, limits: Required<SessionArtifactInventoryLimits>): number {
    const requested = typeof value === "number" && Number.isFinite(value)
        ? Math.floor(value)
        : limits.defaultPageSize;
    return Math.max(1, Math.min(limits.maxPageSize, requested));
}

async function inspectRegularFile(filePath: string): Promise<ArtifactFileInfo | undefined> {
    try {
        const stat = await fs.lstat(filePath);
        if (!stat.isFile()) return undefined;
        return {
            path: filePath,
            mtimeMs: Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : 0,
            size: Number.isFinite(stat.size) ? stat.size : 0,
        };
    } catch {
        return undefined;
    }
}

async function readConversationIdFromMeta(
    filePath: string,
    expectedSize: number,
    maxBytes: number,
): Promise<{ conversationId?: string; bytesRead: number }> {
    const handle = await fs.open(filePath, "r").catch(() => undefined);
    if (!handle) return { bytesRead: 0 };
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > maxBytes) {
            return { bytesRead: 0 };
        }
        const byteLength = Math.min(Math.max(0, stat.size), Math.max(0, expectedSize), maxBytes);
        const buffer = Buffer.alloc(byteLength);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        const raw = buffer.subarray(0, bytesRead).toString("utf-8");
        const parsed = JSON.parse(raw) as { conversationId?: unknown };
        const conversationId = typeof parsed.conversationId === "string" && parsed.conversationId.trim()
            ? parsed.conversationId.trim()
            : undefined;
        return { conversationId, bytesRead };
    } catch {
        return { bytesRead: 0 };
    } finally {
        await handle.close().catch(() => {});
    }
}

function buildRevisionPart(
    safeConversationId: string,
    digest: ArtifactFileInfo | undefined,
    sessionMemory: ArtifactFileInfo | undefined,
    meta: ArtifactFileInfo | undefined,
): string {
    return [
        safeConversationId,
        serializeFileInfo(digest),
        serializeFileInfo(sessionMemory),
        serializeFileInfo(meta),
    ].join("|");
}

function serializeFileInfo(info: ArtifactFileInfo | undefined): string {
    return info ? `${info.mtimeMs}:${info.size}` : "-";
}

function computeRevision(parts: string[]): string {
    return createHash("sha256")
        .update([...parts].sort((left, right) => left.localeCompare(right, "en-US")).join("\n"))
        .digest("base64url");
}

function compareInventoryItems(left: SessionArtifactInventoryItem, right: SessionArtifactInventoryItem): number {
    if (left.newestFileMs !== right.newestFileMs) {
        return right.newestFileMs - left.newestFileMs;
    }
    return left.safeConversationId.localeCompare(right.safeConversationId, "en-US");
}

function encodeCursor(cursor: DecodedCursor): string {
    return Buffer.from(JSON.stringify({ version: CURSOR_VERSION, ...cursor }), "utf-8").toString("base64url");
}

function decodeCursor(value: string): DecodedCursor {
    try {
        const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf-8")) as {
            version?: unknown;
            revision?: unknown;
            last?: { safeConversationId?: unknown; newestFileMs?: unknown };
        };
        if (
            parsed.version !== CURSOR_VERSION
            || typeof parsed.revision !== "string"
            || !parsed.revision
            || typeof parsed.last?.safeConversationId !== "string"
            || !parsed.last.safeConversationId
            || typeof parsed.last.newestFileMs !== "number"
            || !Number.isFinite(parsed.last.newestFileMs)
        ) {
            throw new Error("invalid cursor shape");
        }
        return {
            revision: parsed.revision,
            last: {
                safeConversationId: parsed.last.safeConversationId,
                newestFileMs: parsed.last.newestFileMs,
            },
        };
    } catch {
        throw new SessionArtifactInventoryCursorError("Session artifact inventory cursor is invalid.");
    }
}

async function mapWithConcurrency<T, R>(
    values: T[],
    concurrency: number,
    mapper: (value: T) => Promise<R>,
): Promise<R[]> {
    const results = new Array<R>(values.length);
    let nextIndex = 0;
    const workerCount = Math.min(Math.max(1, concurrency), values.length);
    await Promise.all(Array.from({ length: workerCount }, async () => {
        while (true) {
            const index = nextIndex;
            nextIndex += 1;
            if (index >= values.length) return;
            results[index] = await mapper(values[index]);
        }
    }));
    return results;
}
