import { realpath } from "node:fs/promises";
import path from "node:path";

function isAbsoluteLike(value: string): boolean {
  return path.isAbsolute(value) || /^[a-z]:[\\/]/i.test(value) || value.startsWith("\\\\");
}

function isPathWithinRoot(targetPath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return relative === ""
    || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export type SandboxWorkspaceResolution =
  | { ok: true; workspaceRoot: string; cwd: string }
  | { ok: false; reason: string };

/**
 * Resolves the one canonical workspace mount shared by foreground commands and
 * background jobs. A lexical containment check blocks obvious escapes before
 * canonical-path checks prevent symlink traversal outside an allowed root.
 */
export async function resolveSandboxWorkspace(input: {
  cwd?: string;
  workspaceRoot: string;
  extraWorkspaceRoots?: string[];
}): Promise<SandboxWorkspaceResolution> {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const requestedCwd = input.cwd ?? workspaceRoot;
  const cwd = isAbsoluteLike(requestedCwd)
    ? path.resolve(requestedCwd)
    : path.resolve(workspaceRoot, requestedCwd);
  const candidates = [workspaceRoot, ...(input.extraWorkspaceRoots ?? [])]
    .map((root) => path.resolve(root))
    .sort((left, right) => right.length - left.length);
  if (!candidates.some((root) => isPathWithinRoot(cwd, root))) {
    return { ok: false, reason: "Sandbox working directory escapes allowed roots." };
  }

  let canonicalCwd: string;
  try {
    canonicalCwd = await realpath(cwd);
  } catch {
    return { ok: false, reason: "Sandbox working directory does not exist or cannot be resolved." };
  }
  for (const root of candidates) {
    try {
      const canonicalRoot = await realpath(root);
      if (isPathWithinRoot(canonicalCwd, canonicalRoot)) {
        return { ok: true, workspaceRoot: canonicalRoot, cwd: canonicalCwd };
      }
    } catch {
      // An unresolved allowed root cannot become an OCI bind mount.
    }
  }
  return { ok: false, reason: "Sandbox working directory resolves outside the allowed workspace roots." };
}
