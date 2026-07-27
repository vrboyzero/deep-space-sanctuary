import type { JsonObject } from "@belldandy/protocol";

import type {
  ExtensionRuntimeInvocation,
  ExtensionRuntimeRegistrations,
} from "./extension-runtime-supervisor.js";

export const EXTENSION_RUNTIME_PROTOCOL_VERSION = 1;
export const EXTENSION_RUNTIME_MAX_FRAME_BYTES = 1024 * 1024;

export type ExtensionRuntimeHostRequest =
  | {
    version: typeof EXTENSION_RUNTIME_PROTOCOL_VERSION;
    type: "activate";
    id: string;
    pluginModuleRelativePath: string;
  }
  | {
    version: typeof EXTENSION_RUNTIME_PROTOCOL_VERSION;
    type: "invoke";
    id: string;
    invocation: ExtensionRuntimeInvocation;
  }
  | {
    version: typeof EXTENSION_RUNTIME_PROTOCOL_VERSION;
    type: "dispose";
    id: string;
    reason: string;
  };

export type ExtensionRuntimeHostResponse =
  | {
    version: typeof EXTENSION_RUNTIME_PROTOCOL_VERSION;
    type: "activated";
    id: string;
    ok: true;
    registrations: ExtensionRuntimeRegistrations;
  }
  | {
    version: typeof EXTENSION_RUNTIME_PROTOCOL_VERSION;
    type: "result";
    id: string;
    ok: true;
    result?: JsonObject;
  }
  | {
    version: typeof EXTENSION_RUNTIME_PROTOCOL_VERSION;
    type: "disposed";
    id: string;
    ok: true;
  }
  | {
    version: typeof EXTENSION_RUNTIME_PROTOCOL_VERSION;
    type: "error";
    id: string;
    ok: false;
    error: {
      code: "activation_failed" | "invocation_failed" | "protocol_error" | "dispose_failed";
      message: string;
    };
  };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseFrame(line: string): Record<string, unknown> {
  if (Buffer.byteLength(line, "utf8") > EXTENSION_RUNTIME_MAX_FRAME_BYTES) {
    throw new Error("Extension runtime frame exceeds the size limit.");
  }
  let value: unknown;
  try {
    value = JSON.parse(line) as unknown;
  } catch {
    throw new Error("Extension runtime frame is not valid JSON.");
  }
  if (!isRecord(value)) {
    throw new Error("Extension runtime frame must be an object.");
  }
  if (value.version !== EXTENSION_RUNTIME_PROTOCOL_VERSION) {
    throw new Error("Extension runtime protocol version is unsupported.");
  }
  if (typeof value.id !== "string" || !value.id || value.id.length > 128) {
    throw new Error("Extension runtime frame ID is invalid.");
  }
  return value;
}

function assertSafeRelativePath(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value || value.includes("\u0000") || value.includes("\\")) {
    throw new Error("Extension runtime plugin module path is invalid.");
  }
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value)) {
    throw new Error("Extension runtime plugin module path must be relative.");
  }
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Extension runtime plugin module path contains unsafe segments.");
  }
}

export function parseExtensionRuntimeRequestLine(line: string): ExtensionRuntimeHostRequest {
  const frame = parseFrame(line);
  if (frame.type === "activate") {
    assertSafeRelativePath(frame.pluginModuleRelativePath);
    return frame as ExtensionRuntimeHostRequest;
  }
  if (frame.type === "invoke") {
    if (!isRecord(frame.invocation)) {
      throw new Error("Extension runtime invocation is invalid.");
    }
    return frame as ExtensionRuntimeHostRequest;
  }
  if (frame.type === "dispose") {
    if (typeof frame.reason !== "string" || !frame.reason || frame.reason.length > 128) {
      throw new Error("Extension runtime dispose reason is invalid.");
    }
    return frame as ExtensionRuntimeHostRequest;
  }
  throw new Error("Unsupported extension runtime request type.");
}

export function parseExtensionRuntimeHostResponseLine(line: string): ExtensionRuntimeHostResponse {
  const frame = parseFrame(line);
  if (frame.type === "activated" && frame.ok === true && isRecord(frame.registrations)) {
    return frame as ExtensionRuntimeHostResponse;
  }
  if (frame.type === "result" && frame.ok === true) {
    if (frame.result !== undefined && !isRecord(frame.result)) {
      throw new Error("Extension runtime invocation result is invalid.");
    }
    return frame as ExtensionRuntimeHostResponse;
  }
  if (frame.type === "disposed" && frame.ok === true) {
    return frame as ExtensionRuntimeHostResponse;
  }
  if (frame.type === "error" && frame.ok === false && isRecord(frame.error)) {
    if (typeof frame.error.code !== "string" || typeof frame.error.message !== "string") {
      throw new Error("Extension runtime error response is invalid.");
    }
    return frame as ExtensionRuntimeHostResponse;
  }
  throw new Error("Extension runtime response type is unsupported.");
}

export function serializeExtensionRuntimeFrame(frame: ExtensionRuntimeHostRequest | ExtensionRuntimeHostResponse): string {
  const line = JSON.stringify(frame);
  if (Buffer.byteLength(line, "utf8") > EXTENSION_RUNTIME_MAX_FRAME_BYTES) {
    throw new Error("Extension runtime frame exceeds the size limit.");
  }
  return `${line}\n`;
}
