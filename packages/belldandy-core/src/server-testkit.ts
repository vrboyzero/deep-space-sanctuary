import path from "node:path";

import { expect } from "vitest";
import WebSocket from "ws";
import type { BelldandyRole } from "@belldandy/protocol";

import { listGlobalMemoryManagers, resetGlobalMemoryManagers } from "@belldandy/memory";
import type { Tool, ToolContractChannel } from "@belldandy/skills";
import { withToolContract } from "@belldandy/skills";

import { approvePairingCode } from "./security/store.js";

export function resolveWebRoot(rootDir = process.cwd()): string {
  return path.join(rootDir, "apps", "web", "public");
}

export async function pairWebSocketClient(
  ws: WebSocket,
  frames: any[],
  stateDir: string,
  role: BelldandyRole = "web",
): Promise<void> {
  await waitFor(() => frames.some((f) => f.type === "connect.challenge"));
  ws.send(JSON.stringify({ type: "connect", role, auth: { mode: "none" } }));
  await waitFor(() => frames.some((f) => f.type === "hello-ok"));
  await waitFor(() => frames.some((f) => f.type === "event" && f.event === "pairing.required"));
  await approveLatestPairingCode(frames, stateDir);
}

export function toSafeConversationFileIdForTest(id: string): string {
  const encodeChar = (char: string): string => {
    const codePoint = char.codePointAt(0);
    if (typeof codePoint !== "number") return "_";
    return `%${codePoint.toString(16).toUpperCase().padStart(2, "0")}`;
  };

  let safeId = id.replace(/[<>:"/\\|?*\u0000-\u001F%]/g, encodeChar);
  safeId = safeId.replace(/[. ]+$/g, (match) => Array.from(match).map(encodeChar).join(""));
  if (!safeId) {
    safeId = "_";
  }

  const windowsBasename = safeId.split(".")[0] ?? safeId;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(windowsBasename)) {
    safeId = `_${safeId}`;
  }

  return safeId;
}

export function formatLocalDateForTest(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createTestTool(name: string): Tool {
  return {
    definition: {
      name,
      description: `test tool ${name}`,
      parameters: {
        type: "object",
        properties: {},
      },
    },
    async execute() {
      return {
        id: "",
        name,
        success: true,
        output: name,
        durationMs: 0,
      };
    },
  };
}

export function createContractedTestTool(name: string): Tool {
  return withToolContract(createTestTool(name), {
    family: "other",
    isReadOnly: true,
    isConcurrencySafe: true,
    needsPermission: false,
    riskLevel: "low",
    channels: ["gateway"],
    safeScopes: ["local-safe"],
    activityDescription: `contracted tool ${name}`,
    resultSchema: {
      kind: "text",
      description: "test tool output",
    },
    outputPersistencePolicy: "conversation",
  });
}

export function createWriteContractedTestTool(name: string): Tool {
  return withToolContract(createTestTool(name), {
    family: "workspace-write",
    isReadOnly: false,
    isConcurrencySafe: false,
    needsPermission: true,
    riskLevel: "high",
    channels: resolvePrivilegedWorkspaceWriteChannelsForTest(),
    safeScopes: ["privileged"],
    activityDescription: `write tool ${name}`,
    resultSchema: {
      kind: "text",
      description: "test tool output",
    },
    outputPersistencePolicy: "artifact",
  });
}

function resolvePrivilegedWorkspaceWriteChannelsForTest(env: NodeJS.ProcessEnv = process.env): ToolContractChannel[] {
  const raw = typeof env.BELLDANDY_PRIVILEGED_WORKSPACE_WRITE_CHANNELS === "string"
    ? env.BELLDANDY_PRIVILEGED_WORKSPACE_WRITE_CHANNELS.trim()
    : "";
  const defaults: ToolContractChannel[] = ["gateway", "cli"];
  if (!raw) {
    return [...defaults];
  }

  const parsed = raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is ToolContractChannel => item === "gateway" || item === "web" || item === "cli");

  return parsed.length > 0 ? [...new Set(parsed)] : [...defaults];
}

export function toBase64(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64");
}

export async function cleanupGlobalMemoryManagersForTest(): Promise<void> {
  const managers = listGlobalMemoryManagers();
  resetGlobalMemoryManagers();
  await Promise.allSettled(
    managers.map(async (manager) => {
      try {
        await manager.close();
      } catch {
        // ignore cleanup noise from already-disposed managers
      }
    }),
  );
}

export async function withEnv(
  changes: Record<string, string | undefined>,
  run: () => Promise<void>,
): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(changes)) {
    prev[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

export async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await sleep(10);
  }
  throw new Error("timeout");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function approveLatestPairingCode(frames: any[], stateDir: string, timeoutMs = 5000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const pairingEvents = frames.filter((frame) => frame.type === "event" && frame.event === "pairing.required");
    const candidateCodes: string[] = [];
    const seen = new Set<string>();

    for (const frame of pairingEvents.slice().reverse()) {
      const code = frame?.payload?.code ? String(frame.payload.code) : "";
      if (!code || seen.has(code)) {
        continue;
      }
      seen.add(code);
      candidateCodes.push(code);
    }

    for (const code of candidateCodes) {
      const approved = await approvePairingCode({ code, stateDir });
      if (approved.ok) {
        expect(code.length).toBeGreaterThan(0);
        return;
      }
    }

    await sleep(20);
  }

  throw new Error(`timeout approving pairing code after ${timeoutMs}ms`);
}
