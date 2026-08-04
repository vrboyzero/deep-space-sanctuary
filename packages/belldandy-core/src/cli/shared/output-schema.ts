import fs from "node:fs/promises";
import path from "node:path";

import { toSafeCodingRunErrorMessage } from "../../coding-run/contracts.js";
import {
  MAX_OUTPUT_SCHEMA_BYTES,
  compileOutputSchema,
  type OutputSchemaValidator,
} from "../../coding-run/output-schema.js";

export { compileOutputSchema, type OutputSchemaValidator };

export async function loadOutputSchemaFile(value: string): Promise<{ ok: true; schema: unknown } | { ok: false; message: string }> {
  const filePath = path.resolve(value);
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      return { ok: false, message: "--output-schema must reference a JSON file." };
    }
    if (stat.size > MAX_OUTPUT_SCHEMA_BYTES) {
      return { ok: false, message: "--output-schema exceeds the 1 MiB size limit." };
    }
    return { ok: true, schema: JSON.parse(await fs.readFile(filePath, "utf-8")) as unknown };
  } catch (error) {
    return {
      ok: false,
      message: `Unable to read --output-schema: ${toSafeCodingRunErrorMessage(error).slice(0, 320)}`,
    };
  }
}

export async function resolveOptionalOutputSchema(value: unknown): Promise<
  { ok: true; schema?: unknown } | { ok: false; message: string }
> {
  const filePath = typeof value === "string" ? value.trim() : "";
  if (!filePath) return { ok: true };
  return await loadOutputSchemaFile(filePath);
}
