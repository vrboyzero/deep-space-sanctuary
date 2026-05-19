import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { Chunker } from "./chunker.js";
import type { MemoryChunk } from "./types.js";
import type { MemorySourceInventoryConfiguredSource } from "./memory-source-inventory.js";

export type ExternalMemoryIngestAdapter = "obsidian_markdown_directory_v1";
export type ExternalMemoryIngestFileStatus = "eligible" | "skipped";

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
  skipReason?: string;
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
};

export type ExternalMemoryIngestApplyResult = {
  appliedAt: string;
  source: MemorySourceInventoryConfiguredSource;
  sourceId: string;
  importedFileCount: number;
  importedChunkCount: number;
  skippedFiles: Array<{ path: string; reason: string }>;
  chunksBySourcePath: Array<{ sourcePath: string; chunks: MemoryChunk[] }>;
};

const OBSIDIAN_MARKDOWN_ADAPTER: ExternalMemoryIngestAdapter = "obsidian_markdown_directory_v1";

export async function previewObsidianMarkdownDirectoryIngest(
  source: MemorySourceInventoryConfiguredSource,
): Promise<ExternalMemoryIngestPreview> {
  const rootPath = normalizeRootPath(source.rootPath);
  const sourceLabel = source.label.trim();
  const sourceId = buildConfiguredExternalSourceId(source, 1);
  const generatedAt = new Date().toISOString();
  const files = await listMarkdownFiles(rootPath);
  const chunker = new Chunker();
  const fileManifest: ExternalMemoryIngestFileManifest[] = [];
  const skipReasons: Array<{ path: string; reason: string }> = [];
  let estimatedChunks = 0;
  let estimatedBytes = 0;

  for (const filePath of files) {
    const relativePath = path.relative(rootPath, filePath).replace(/\\/g, "/");
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
    adapter: OBSIDIAN_MARKDOWN_ADAPTER,
    generatedAt,
    source,
    sourceId,
    sourceLabel,
    sourceClass: source.sourceClass,
    scope: source.scope ?? "private",
    storage: "external",
    rootPath,
    totalFiles: fileManifest.length,
    eligibleFiles,
    skippedFiles: Math.max(0, fileManifest.length - eligibleFiles),
    estimatedChunks,
    estimatedBytes,
    fileManifest,
    skipReasons,
  };
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
            externalSourceType: "external_obsidian_markdown",
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
  };
}

function normalizeRootPath(rootPath?: string): string {
  const normalized = typeof rootPath === "string" ? rootPath.trim() : "";
  if (!normalized) {
    throw new Error("configured external ingest requires a non-empty rootPath.");
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
