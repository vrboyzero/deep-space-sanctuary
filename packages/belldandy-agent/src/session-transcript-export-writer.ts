import { createWriteStream } from "node:fs";
import * as fsp from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import type { Writable } from "node:stream";

import type { SessionTranscriptExportBundle } from "./session-transcript-export.js";

export type SessionTranscriptExportWriteOptions = {
  pretty?: boolean;
};

/**
 * Streams large array sections to a temporary file, then atomically publishes it.
 * The exported JSON schema stays identical to the in-memory bundle contract.
 */
export async function writeSessionTranscriptExportBundle<T extends SessionTranscriptExportBundle>(
  targetPath: string,
  bundle: T,
  options: SessionTranscriptExportWriteOptions = {},
): Promise<void> {
  const resolvedTargetPath = path.resolve(targetPath);
  const tempPath = `${resolvedTargetPath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  const pretty = options.pretty !== false;
  await fsp.mkdir(path.dirname(resolvedTargetPath), { recursive: true });

  const writer = createWriteStream(tempPath, { encoding: "utf8", flags: "wx" });
  try {
    await writeTranscriptExportBundle(writer, bundle, pretty);
    writer.end();
    await once(writer, "finish");
    await fsp.rename(tempPath, resolvedTargetPath);
  } catch (error) {
    writer.destroy();
    await once(writer, "close").catch(() => undefined);
    await fsp.unlink(tempPath).catch((cleanupError: NodeJS.ErrnoException) => {
      if (cleanupError.code !== "ENOENT") throw cleanupError;
    });
    throw error;
  }
}

async function writeTranscriptExportBundle(
  writer: Writable,
  bundle: SessionTranscriptExportBundle,
  pretty: boolean,
): Promise<void> {
  const newline = pretty ? "\n" : "";
  const indent = (depth: number) => pretty ? "  ".repeat(depth) : "";
  let topLevelWritten = false;
  const writeTopLevel = async (key: string, writeValue: () => Promise<void>): Promise<void> => {
    if (topLevelWritten) await writeChunk(writer, `,${newline}`);
    topLevelWritten = true;
    await writeChunk(writer, `${indent(1)}${JSON.stringify(key)}:${pretty ? " " : ""}`);
    await writeValue();
  };

  await writeChunk(writer, `{${newline}`);
  await writeTopLevel("manifest", () => writeJsonValue(writer, bundle.manifest, pretty, 1));
  await writeTopLevel("events", () => writeJsonArray(writer, bundle.events, pretty, 1));
  await writeTopLevel("restore", async () => {
    await writeChunk(writer, `{${newline}`);
    await writeChunk(writer, `${indent(2)}"rawMessages":${pretty ? " " : ""}`);
    await writeJsonArray(writer, bundle.restore.rawMessages, pretty, 2);
    await writeChunk(writer, `,${newline}${indent(2)}"compactedView":${pretty ? " " : ""}`);
    await writeJsonArray(writer, bundle.restore.compactedView, pretty, 2);
    await writeChunk(writer, `,${newline}${indent(2)}"canonicalExtractionView":${pretty ? " " : ""}`);
    await writeJsonArray(writer, bundle.restore.canonicalExtractionView, pretty, 2);
    await writeChunk(writer, `,${newline}${indent(2)}"diagnostics":${pretty ? " " : ""}`);
    await writeJsonValue(writer, bundle.restore.diagnostics, pretty, 2);
    await writeChunk(writer, `${newline}${indent(1)}}`);
  });
  await writeTopLevel("summary", () => writeJsonValue(writer, bundle.summary, pretty, 1));
  await writeTopLevel("redaction", () => writeJsonValue(writer, bundle.redaction, pretty, 1));

  const knownKeys = new Set(["manifest", "events", "restore", "summary", "redaction"]);
  const extraFields = bundle as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(extraFields)) {
    if (knownKeys.has(key)) continue;
    await writeTopLevel(key, () => writeJsonValue(writer, value, pretty, 1));
  }
  await writeChunk(writer, `${newline}}${newline}`);
}

async function writeJsonArray(
  writer: Writable,
  values: readonly unknown[],
  pretty: boolean,
  depth: number,
): Promise<void> {
  if (values.length === 0) {
    await writeChunk(writer, "[]");
    return;
  }

  if (!pretty) {
    await writeChunk(writer, "[");
    for (let index = 0; index < values.length; index += 1) {
      if (index > 0) await writeChunk(writer, ",");
      await writeJsonValue(writer, values[index], false, depth + 1);
    }
    await writeChunk(writer, "]");
    return;
  }

  const itemIndent = "  ".repeat(depth + 1);
  const closeIndent = "  ".repeat(depth);
  await writeChunk(writer, "[\n");
  for (let index = 0; index < values.length; index += 1) {
    if (index > 0) await writeChunk(writer, ",\n");
    await writeChunk(writer, itemIndent);
    await writeJsonValue(writer, values[index], true, depth + 1);
  }
  await writeChunk(writer, `\n${closeIndent}]`);
}

async function writeJsonValue(
  writer: Writable,
  value: unknown,
  pretty: boolean,
  depth: number,
): Promise<void> {
  const serialized = JSON.stringify(value, null, pretty ? 2 : 0) ?? "null";
  const continuationIndent = pretty ? `\n${"  ".repeat(depth)}` : "";
  await writeChunk(writer, serialized.replace(/\n/g, continuationIndent));
}

async function writeChunk(writer: Writable, chunk: string): Promise<void> {
  if (!writer.write(chunk, "utf8")) {
    await once(writer, "drain");
  }
}
