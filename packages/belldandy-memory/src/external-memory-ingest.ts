import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { Chunker } from "./chunker.js";
import type { MemoryChunk } from "./types.js";
import type { MemorySourceInventoryConfiguredSource } from "./memory-source-inventory.js";

export type ExternalMemoryIngestAdapter = "obsidian_markdown_directory_v1" | "markdown_file_v1";
export type ExternalMemoryIngestFileStatus = "eligible" | "skipped";
export type ExternalMemoryIngestRescanState = "new" | "changed" | "unchanged";

export type ExternalMemoryIngestFileManifest = {
  path: string;
  relativePath: string;
  size: number;
  mtime: string;
  estimatedChunks: number;
  contentHash: string;
  sourceType: "file";
  memoryType: "other";
  status: ExternalMemoryIngestFileStatus;
  rescanState?: ExternalMemoryIngestRescanState;
  skipReason?: string;
};

export type ExternalMemoryIngestStaleFile = {
  path: string;
  relativePath: string;
  previousChunkCount: number;
  previousContentHash?: string;
  reason: "missing_from_preview";
};

export type ExternalMemoryIngestExistingFile = {
  path: string;
  relativePath?: string;
  contentHash?: string;
  chunkCount?: number;
};

export type ExternalMemoryIngestPreview = {
  adapter: ExternalMemoryIngestAdapter;
  generatedAt: string;
  source: MemorySourceInventoryConfiguredSource;
  sourceId: string;
  sourceLabel: string;
  sourceClass: MemorySourceInventoryConfiguredSource["sourceClass"];
  scope: NonNullable<MemorySourceInventoryConfiguredSource["scope"]>;
  storage: "external";
  rootPath: string;
  totalFiles: number;
  eligibleFiles: number;
  skippedFiles: number;
  estimatedChunks: number;
  estimatedBytes: number;
  fileManifest: ExternalMemoryIngestFileManifest[];
  skipReasons: Array<{ path: string; reason: string }>;
  rescan: {
    mode: "initial" | "rescan";
    previousFileCount: number;
    newFileCount: number;
    changedFileCount: number;
    unchangedFileCount: number;
    staleFileCount: number;
    staleFiles: ExternalMemoryIngestStaleFile[];
  };
};

export type ExternalMemoryIngestApplyResult = {
  appliedAt: string;
  source: MemorySourceInventoryConfiguredSource;
  sourceId: string;
  importedFileCount: number;
  importedChunkCount: number;
  skippedFiles: Array<{ path: string; reason: string }>;
  chunksBySourcePath: Array<{ sourcePath: string; chunks: MemoryChunk[] }>;
  staleFilesRemoved: number;
  staleChunksRemoved: number;
};

const OBSIDIAN_MARKDOWN_ADAPTER: ExternalMemoryIngestAdapter = "obsidian_markdown_directory_v1";
const MARKDOWN_FILE_ADAPTER: ExternalMemoryIngestAdapter = "markdown_file_v1";

export async function previewObsidianMarkdownDirectoryIngest(
  source: MemorySourceInventoryConfiguredSource,
): Promise<ExternalMemoryIngestPreview> {
  const rootPath = normalizeRootPath(source.rootPath);
  const files = await listMarkdownFiles(rootPath);
  return await previewMarkdownExternalIngest(source, {
    adapter: OBSIDIAN_MARKDOWN_ADAPTER,
    rootPath,
    files,
  });
}

export async function previewMarkdownFileIngest(
  source: MemorySourceInventoryConfiguredSource,
): Promise<ExternalMemoryIngestPreview> {
  const filePath = normalizeFilePath(source.filePath);
  return await previewMarkdownExternalIngest(source, {
    adapter: MARKDOWN_FILE_ADAPTER,
    rootPath: path.dirname(filePath),
    files: [filePath],
  });
}

export async function materializeObsidianMarkdownChunks(
  preview: ExternalMemoryIngestPreview,
  options: {
    appliedAt: string;
    reportId: string;
  },
): Promise<ExternalMemoryIngestApplyResult> {
  const chunker = new Chunker();
  const chunksBySourcePath: Array<{ sourcePath: string; chunks: MemoryChunk[] }> = [];
  const skippedFiles: Array<{ path: string; reason: string }> = [];
  let importedFileCount = 0;
  let importedChunkCount = 0;
  const externalSourceType = preview.adapter === MARKDOWN_FILE_ADAPTER
    ? "external_markdown_file"
    : "external_obsidian_markdown";

  for (const file of preview.fileManifest) {
    if (file.status !== "eligible") {
      skippedFiles.push({
        path: file.path,
        reason: file.skipReason || "not_eligible",
      });
      continue;
    }
    try {
      const content = await fs.readFile(file.path, "utf-8");
      if (hashExternalContent(content) !== file.contentHash) {
        skippedFiles.push({
          path: file.path,
          reason: "changed_since_preview",
        });
        continue;
      }
      const chunkTexts = chunker.splitText(content);
      if (chunkTexts.length <= 0) {
        skippedFiles.push({
          path: file.path,
          reason: "empty_content",
        });
        continue;
      }
      const baseId = createHash("md5").update(file.path).digest("hex");
      const chunks = chunkTexts.map((chunkContent, index) => ({
        id: `${baseId}_${index}`,
        sourcePath: file.path,
        sourceType: file.sourceType,
        memoryType: file.memoryType,
        content: chunkContent,
        metadata: {
          file_hash: file.contentHash,
          file_mtime: file.mtime,
          chunk_index: index,
          total_chunks: chunkTexts.length,
          memoryTree: {
            externalSourceId: preview.sourceId,
            externalSourceLabel: preview.sourceLabel,
            ingestAdapter: preview.adapter,
            externalSourceType,
            ingestedByReportId: options.reportId,
            ingestAppliedAt: options.appliedAt,
          },
        },
      } satisfies MemoryChunk));
      chunksBySourcePath.push({
        sourcePath: file.path,
        chunks,
      });
      importedFileCount += 1;
      importedChunkCount += chunks.length;
    } catch (error) {
      skippedFiles.push({
        path: file.path,
        reason: error instanceof Error ? error.message : "read_failed",
      });
    }
  }

  return {
    appliedAt: options.appliedAt,
    source: preview.source,
    sourceId: preview.sourceId,
    importedFileCount,
    importedChunkCount,
    skippedFiles,
    chunksBySourcePath,
    staleFilesRemoved: 0,
    staleChunksRemoved: 0,
  };
}

export function annotateExternalIngestPreviewRescan(
  preview: ExternalMemoryIngestPreview,
  existingFiles: ExternalMemoryIngestExistingFile[],
): ExternalMemoryIngestPreview {
  const previousByPath = new Map(existingFiles.map((item) => [item.path, item] as const));
  const nextManifest = preview.fileManifest.map((item) => {
    if (item.status !== "eligible") {
      return item;
    }
    const existing = previousByPath.get(item.path);
    const rescanState: ExternalMemoryIngestRescanState = !existing
      ? "new"
      : existing.contentHash && existing.contentHash === item.contentHash
        ? "unchanged"
        : "changed";
    previousByPath.delete(item.path);
    return {
      ...item,
      rescanState,
    };
  });
  const staleFiles = Array.from(previousByPath.values())
    .sort((left, right) => left.path.localeCompare(right.path, "en-US"))
    .map((item) => ({
      path: item.path,
      relativePath: item.relativePath || path.basename(item.path),
      previousChunkCount: item.chunkCount ?? 0,
      previousContentHash: item.contentHash,
      reason: "missing_from_preview" as const,
    }));
  return {
    ...preview,
    fileManifest: nextManifest,
    rescan: {
      mode: existingFiles.length > 0 ? "rescan" : "initial",
      previousFileCount: existingFiles.length,
      newFileCount: nextManifest.filter((item) => item.rescanState === "new").length,
      changedFileCount: nextManifest.filter((item) => item.rescanState === "changed").length,
      unchangedFileCount: nextManifest.filter((item) => item.rescanState === "unchanged").length,
      staleFileCount: staleFiles.length,
      staleFiles,
    },
  };
}

function normalizeRootPath(rootPath?: string): string {
  const normalized = typeof rootPath === "string" ? rootPath.trim() : "";
  if (!normalized) {
    throw new Error("configured external ingest requires a non-empty rootPath.");
  }
  return path.resolve(normalized);
}

function normalizeFilePath(filePath?: string): string {
  const normalized = typeof filePath === "string" ? filePath.trim() : "";
  if (!normalized) {
    throw new Error("configured external ingest requires a non-empty filePath.");
  }
  return path.resolve(normalized);
}

async function listMarkdownFiles(rootPath: string): Promise<string[]> {
  const rootStat = await fs.stat(rootPath).catch(() => null);
  if (!rootStat || !rootStat.isDirectory()) {
    throw new Error(`configured external rootPath is not a readable directory: ${rootPath}`);
  }

  const files: string[] = [];
  const stack = [rootPath];
  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) continue;
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".obsidian" || entry.name === ".git" || entry.name === "node_modules") {
        continue;
      }
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        files.push(fullPath);
      }
    }
  }
  files.sort((left, right) => left.localeCompare(right, "en-US"));
  return files;
}

function hashExternalContent(content: string): string {
  return createHash("sha1").update(content).digest("hex");
}

async function previewMarkdownExternalIngest(
  source: MemorySourceInventoryConfiguredSource,
  input: {
    adapter: ExternalMemoryIngestAdapter;
    rootPath: string;
    files: string[];
  },
): Promise<ExternalMemoryIngestPreview> {
  const sourceLabel = source.label.trim();
  const sourceId = buildConfiguredExternalSourceId(source, 1);
  const generatedAt = new Date().toISOString();
  const chunker = new Chunker();
  const fileManifest: ExternalMemoryIngestFileManifest[] = [];
  const skipReasons: Array<{ path: string; reason: string }> = [];
  let estimatedChunks = 0;
  let estimatedBytes = 0;

  for (const filePath of input.files) {
    const relativePath = path.relative(input.rootPath, filePath).replace(/\\/g, "/") || path.basename(filePath);
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        fileManifest.push({
          path: filePath,
          relativePath,
          size: 0,
          mtime: generatedAt,
          estimatedChunks: 0,
          contentHash: "",
          sourceType: "file",
          memoryType: "other",
          status: "skipped",
          skipReason: "not_a_file",
        });
        skipReasons.push({ path: filePath, reason: "not_a_file" });
        continue;
      }
      const content = await fs.readFile(filePath, "utf-8");
      const normalizedContent = content.trim();
      if (!normalizedContent) {
        fileManifest.push({
          path: filePath,
          relativePath,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
          estimatedChunks: 0,
          contentHash: hashExternalContent(content),
          sourceType: "file",
          memoryType: "other",
          status: "skipped",
          skipReason: "empty_content",
        });
        skipReasons.push({ path: filePath, reason: "empty_content" });
        continue;
      }
      const chunks = chunker.splitText(content);
      const estimatedChunkCount = chunks.length;
      estimatedChunks += estimatedChunkCount;
      estimatedBytes += stat.size;
      fileManifest.push({
        path: filePath,
        relativePath,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        estimatedChunks: estimatedChunkCount,
        contentHash: hashExternalContent(content),
        sourceType: "file",
        memoryType: "other",
        status: "eligible",
      });
    } catch (error) {
      fileManifest.push({
        path: filePath,
        relativePath,
        size: 0,
        mtime: generatedAt,
        estimatedChunks: 0,
        contentHash: "",
        sourceType: "file",
        memoryType: "other",
        status: "skipped",
        skipReason: error instanceof Error ? error.message : "read_failed",
      });
      skipReasons.push({
        path: filePath,
        reason: error instanceof Error ? error.message : "read_failed",
      });
    }
  }

  const eligibleFiles = fileManifest.filter((item) => item.status === "eligible").length;
  return {
    adapter: input.adapter,
    generatedAt,
    source,
    sourceId,
    sourceLabel,
    sourceClass: source.sourceClass,
    scope: source.scope ?? "private",
    storage: "external",
    rootPath: input.rootPath,
    totalFiles: fileManifest.length,
    eligibleFiles,
    skippedFiles: Math.max(0, fileManifest.length - eligibleFiles),
    estimatedChunks,
    estimatedBytes,
    fileManifest,
    skipReasons,
    rescan: {
      mode: "initial",
      previousFileCount: 0,
      newFileCount: eligibleFiles,
      changedFileCount: 0,
      unchangedFileCount: 0,
      staleFileCount: 0,
      staleFiles: [],
    },
  };
}

function buildConfiguredExternalSourceId(
  source: MemorySourceInventoryConfiguredSource,
  index: number,
): string {
  const explicitId = typeof source.id === "string" ? source.id.trim() : "";
  if (explicitId) {
    return explicitId;
  }
  const label = source.label.trim() || `configured-source-${index}`;
  return `configured:${sanitizeIdentifier(label)}:${index}`;
}

function sanitizeIdentifier(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "configured-source";
}
