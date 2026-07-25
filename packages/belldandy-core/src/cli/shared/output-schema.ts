import fs from "node:fs/promises";
import path from "node:path";

import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";

import { toSafeCodingRunErrorMessage } from "../../coding-run/contracts.js";

const MAX_OUTPUT_SCHEMA_BYTES = 1024 * 1024;

export type OutputSchemaValidator = {
  validateOutput: (text: string) => { ok: true } | { ok: false; message: string };
};

export function compileOutputSchema(schema: unknown): { ok: true; validator: OutputSchemaValidator } | { ok: false; message: string } {
  try {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const validate = ajv.compile(schema as AnySchema);
    return {
      ok: true,
      validator: {
        validateOutput: (text) => {
          let output: unknown;
          try {
            output = JSON.parse(text);
          } catch {
            return { ok: false, message: "Final output is not valid JSON." };
          }
          if (validate(output)) return { ok: true };
          const firstError = validate.errors?.[0];
          const location = firstError?.instancePath || "/";
          return {
            ok: false,
            message: `Final output does not match --output-schema at ${location}.`,
          };
        },
      },
    };
  } catch (error) {
    return {
      ok: false,
      message: `Invalid --output-schema: ${toSafeCodingRunErrorMessage(error).slice(0, 320)}`,
    };
  }
}

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
