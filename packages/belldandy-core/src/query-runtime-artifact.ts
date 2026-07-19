import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";

import type { GatewayResFrame } from "@belldandy/protocol";

import { QueryRuntime, type QueryRuntimeObserver } from "./query-runtime.js";

type ArtifactQueryRuntimeMethod = "artifact.reveal";

export type QueryRuntimeArtifactContext = {
  requestId: string;
  generatedDir: string;
  isUnderRoot: (root: string, target: string) => boolean;
  runtimeObserver?: QueryRuntimeObserver<ArtifactQueryRuntimeMethod>;
  revealArtifactPath?: (targetPath: string) => Promise<void>;
};

function normalizeGeneratedArtifactPath(inputPath: string): string {
  const trimmed = inputPath.trim();
  if (!trimmed) return "";
  let normalized = trimmed;
  if (normalized.startsWith("#generated-image-reveal:")) {
    normalized = normalized.slice("#generated-image-reveal:".length);
  }
  if (normalized.startsWith("/generated/")) {
    normalized = normalized.slice("/generated/".length);
  } else if (normalized.startsWith("generated/")) {
    normalized = normalized.slice("generated/".length);
  } else if (normalized.startsWith("/")) {
    normalized = normalized.slice(1);
  }
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // keep raw when fragment is not encoded
  }
  return normalized.replaceAll("\\", "/");
}

export async function revealArtifactPathInShell(targetPath: string): Promise<void> {
  const stat = await fs.stat(targetPath);
  const directory = stat.isDirectory() ? targetPath : path.dirname(targetPath);

  if (process.platform === "win32") {
    const args = stat.isDirectory()
      ? [directory]
      : [`/select,${targetPath}`];
    await spawnDetached("explorer.exe", args);
    return;
  }

  if (process.platform === "darwin") {
    const args = stat.isDirectory()
      ? [directory]
      : ["-R", targetPath];
    await spawnDetached("open", args);
    return;
  }

  await spawnDetached("xdg-open", [directory]);
}

async function spawnDetached(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export async function handleArtifactRevealWithQueryRuntime(
  ctx: QueryRuntimeArtifactContext,
  params: { path: string },
): Promise<GatewayResFrame> {
  const runtime = new QueryRuntime({
    method: "artifact.reveal" as const,
    traceId: ctx.requestId,
    observer: ctx.runtimeObserver,
  });

  return runtime.run(async (queryRuntime) => {
    queryRuntime.mark("request_validated", {
      detail: {
        path: params.path,
      },
    });

    const relativePath = normalizeGeneratedArtifactPath(params.path);
    if (!relativePath) {
      queryRuntime.mark("completed", {
        detail: {
          code: "invalid_path",
        },
      });
      return {
        type: "res",
        id: ctx.requestId,
        ok: false,
        error: { code: "invalid_path", message: "artifact path is required" },
      };
    }

    const targetPath = path.resolve(ctx.generatedDir, relativePath);
    queryRuntime.mark("artifact_target_resolved", {
      detail: {
        relativePath,
        targetPath,
      },
    });

    if (!ctx.isUnderRoot(ctx.generatedDir, targetPath)) {
      queryRuntime.mark("completed", {
        detail: {
          relativePath,
          code: "invalid_path",
        },
      });
      return {
        type: "res",
        id: ctx.requestId,
        ok: false,
        error: { code: "invalid_path", message: "artifact path escapes generated directory" },
      };
    }

    let canonicalGeneratedDir: string;
    let canonicalTargetPath: string;
    try {
      // 词法 containment 无法识别目录链接；shell 只能接收已验证的 canonical target。
      [canonicalGeneratedDir, canonicalTargetPath] = await Promise.all([
        fs.realpath(ctx.generatedDir),
        fs.realpath(targetPath),
      ]);
    } catch {
      queryRuntime.mark("completed", {
        detail: {
          relativePath,
          code: "not_found",
        },
      });
      return {
        type: "res",
        id: ctx.requestId,
        ok: false,
        error: { code: "not_found", message: "artifact not found" },
      };
    }

    if (!ctx.isUnderRoot(canonicalGeneratedDir, canonicalTargetPath)) {
      queryRuntime.mark("completed", {
        detail: {
          relativePath,
          code: "invalid_path",
        },
      });
      return {
        type: "res",
        id: ctx.requestId,
        ok: false,
        error: { code: "invalid_path", message: "artifact path resolves outside generated directory" },
      };
    }

    const revealArtifactPath = ctx.revealArtifactPath ?? revealArtifactPathInShell;
    await revealArtifactPath(canonicalTargetPath);
    queryRuntime.mark("artifact_revealed", {
      detail: {
        relativePath,
      },
    });
    queryRuntime.mark("completed", {
      detail: {
        relativePath,
      },
    });

    return {
      type: "res",
      id: ctx.requestId,
      ok: true,
      payload: {
        revealed: true,
        path: `/generated/${relativePath.replaceAll("\\", "/")}`,
      },
    };
  });
}
