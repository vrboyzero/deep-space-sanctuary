import { describe, expect, it } from "vitest";

import {
    buildMemoryExactDedupPreviewReport,
    ensureMemoryDedupBackupFile,
    normalizeChunkContentForExactDedup,
    type MemoryDedupChunkSnapshot,
} from "./memory-dedup.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("memory exact dedup preview", () => {
    it("groups chunks by trimmed LF-normalized content and preserves only the preferred keeper", () => {
        const chunks: MemoryDedupChunkSnapshot[] = [
            {
                id: "chunk-1",
                sourcePath: "memory/a.md",
                sourceType: "manual",
                memoryType: "daily",
                visibility: "private",
                content: "  hello world\r\nsame line  ",
                createdAt: "2026-05-17T00:00:00.000Z",
                updatedAt: "2026-05-17T00:00:00.000Z",
                taskLinkCount: 0,
            },
            {
                id: "chunk-2",
                sourcePath: "memory/b.md",
                sourceType: "manual",
                memoryType: "daily",
                visibility: "shared",
                content: "hello world\nsame line",
                createdAt: "2026-05-18T00:00:00.000Z",
                updatedAt: "2026-05-18T00:00:00.000Z",
                taskLinkCount: 2,
            },
            {
                id: "chunk-3",
                sourcePath: "memory/c.md",
                sourceType: "manual",
                memoryType: "daily",
                visibility: "private",
                content: "hello world same line but different",
                createdAt: "2026-05-19T00:00:00.000Z",
                updatedAt: "2026-05-19T00:00:00.000Z",
                taskLinkCount: 0,
            },
        ];

        const report = buildMemoryExactDedupPreviewReport({ chunks });
        expect(normalizeChunkContentForExactDedup("  a\r\nb  ")).toBe("a\nb");
        expect(report.strategy).toBe("hash_only_exact");
        expect(report.totals.scannedChunks).toBe(3);
        expect(report.totals.duplicateGroups).toBe(1);
        expect(report.totals.duplicateChunks).toBe(2);
        expect(report.totals.removableChunks).toBe(1);
        expect(report.groups).toHaveLength(1);
        expect(report.groups[0]?.keep.id).toBe("chunk-2");
        expect(report.groups[0]?.remove.map((item) => item.id)).toEqual(["chunk-1"]);
    });

    it("creates a sqlite backup file before apply", () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-memory-dedup-backup-"));
        const dbPath = path.join(tmpDir, "memory.sqlite");
        const backupRootDir = path.join(tmpDir, "backups");
        fs.writeFileSync(dbPath, "sqlite-placeholder", "utf-8");

        try {
            const backup = ensureMemoryDedupBackupFile({
                dbPath,
                backupRootDir,
                runId: "dedup-test",
            });
            expect(backup.runId).toBe("dedup-test");
            expect(fs.existsSync(backup.backupPath)).toBe(true);
            expect(fs.readFileSync(backup.backupPath, "utf-8")).toBe("sqlite-placeholder");
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
