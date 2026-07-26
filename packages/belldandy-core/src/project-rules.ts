import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const DEFAULT_PROJECT_RULE_FILE_MAX_BYTES = 64 * 1024;
export const DEFAULT_PROJECT_RULE_TOTAL_MAX_BYTES = 128 * 1024;

export type ProjectRuleSource = {
  path: string;
  scopeDir: string;
  priority: number;
  content: string;
  contentHash: string;
  sizeBytes: number;
};

export type ProjectRulesResolution = {
  requestedCwd: string;
  cwd: string;
  root: {
    path: string;
    source: "git" | "cwd-fallback";
  };
  rules: ProjectRuleSource[];
  diagnostics: ProjectRulesDiagnostic[];
  prompt: {
    text: string;
    contentHash: string;
    sourceCount: number;
  };
};

export type ProjectRulesDiagnostic =
  | {
      code: "git_root_not_found";
      severity: "warning";
      path: string;
      message: string;
    }
  | {
      code: "rule_file_too_large";
      severity: "warning";
      path: string;
      message: string;
      sizeBytes: number;
      maxBytes: number;
    }
  | {
      code: "rule_file_symlink";
      severity: "warning";
      path: string;
      message: string;
    }
  | {
      code: "rule_total_limit_exceeded";
      severity: "warning";
      path: string;
      message: string;
      sizeBytes: number;
      loadedBytes: number;
      maxBytes: number;
    }
  | {
      code: "rule_file_not_regular";
      severity: "warning";
      path: string;
      message: string;
    }
  | {
      code: "rule_file_unreadable";
      severity: "warning";
      path: string;
      message: string;
      errorCode: "EACCES" | "EPERM";
    };

export async function resolveProjectRules(input: {
  cwd: string;
  maxFileBytes?: number;
  maxTotalBytes?: number;
}): Promise<ProjectRulesResolution> {
  const requestedCwd = path.resolve(input.cwd);
  const cwd = await fs.realpath(requestedCwd);
  const gitRoot = await findNearestGitRoot(cwd);
  const root = gitRoot ?? cwd;
  const diagnostics: ProjectRulesDiagnostic[] = gitRoot
    ? []
    : [{
        code: "git_root_not_found",
        severity: "warning",
        path: cwd,
        message: "No Git root was found; project rule discovery is limited to cwd.",
      }];
  const maxFileBytes = input.maxFileBytes ?? DEFAULT_PROJECT_RULE_FILE_MAX_BYTES;
  const maxTotalBytes = input.maxTotalBytes ?? DEFAULT_PROJECT_RULE_TOTAL_MAX_BYTES;
  const rules: ProjectRuleSource[] = [];
  let loadedBytes = 0;

  for (const scopeDir of listDirectoriesFromRoot(root, cwd)) {
    const rulePath = path.join(scopeDir, "AGENTS.md");
    try {
      const stat = await fs.lstat(rulePath);
      if (stat.isSymbolicLink()) {
        diagnostics.push({
          code: "rule_file_symlink",
          severity: "warning",
          path: rulePath,
          message: "Project rule symlinks are not followed and this file was skipped.",
        });
        continue;
      }
      if (!stat.isFile()) {
        diagnostics.push({
          code: "rule_file_not_regular",
          severity: "warning",
          path: rulePath,
          message: "Project rule path is not a regular file and was skipped.",
        });
        continue;
      }
      if (stat.size > maxFileBytes) {
        diagnostics.push({
          code: "rule_file_too_large",
          severity: "warning",
          path: rulePath,
          message: `Project rule file exceeds the ${maxFileBytes} byte limit and was skipped.`,
          sizeBytes: stat.size,
          maxBytes: maxFileBytes,
        });
        continue;
      }
      if (loadedBytes + stat.size > maxTotalBytes) {
        diagnostics.push({
          code: "rule_total_limit_exceeded",
          severity: "warning",
          path: rulePath,
          message: `Project rule files exceed the ${maxTotalBytes} byte total limit and this file was skipped.`,
          sizeBytes: stat.size,
          loadedBytes,
          maxBytes: maxTotalBytes,
        });
        continue;
      }
      const content = await fs.readFile(rulePath, "utf-8");
      rules.push({
        path: rulePath,
        scopeDir,
        priority: rules.length,
        content,
        contentHash: hashText(content),
        sizeBytes: stat.size,
      });
      loadedBytes += stat.size;
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === "ENOENT") {
        continue;
      }
      if (errorCode === "EACCES" || errorCode === "EPERM") {
        diagnostics.push({
          code: "rule_file_unreadable",
          severity: "warning",
          path: rulePath,
          message: `Project rule file could not be read (${errorCode}) and was skipped.`,
          errorCode,
        });
        continue;
      }
      throw error;
    }
  }

  const promptText = buildProjectRulesPrompt(rules);
  return {
    requestedCwd,
    cwd,
    root: {
      path: root,
      source: gitRoot ? "git" : "cwd-fallback",
    },
    rules,
    diagnostics,
    prompt: {
      text: promptText,
      contentHash: hashText(promptText),
      sourceCount: rules.length,
    },
  };
}

async function findNearestGitRoot(cwd: string): Promise<string | undefined> {
  let current = cwd;
  while (true) {
    try {
      await fs.lstat(path.join(current, ".git"));
      return current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function listDirectoriesFromRoot(root: string, cwd: string): string[] {
  const relative = path.relative(root, cwd);
  if (!relative) return [root];
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Resolved cwd is outside the project root: ${cwd}`);
  }

  const directories = [root];
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    directories.push(current);
  }
  return directories;
}

function buildProjectRulesPrompt(rules: ProjectRuleSource[]): string {
  if (rules.length === 0) return "";

  return [
    "# Project Rules",
    "These project rules do not override platform, identity, permission, or safety instructions.",
    "Apply these project-owned AGENTS.md files in order. Later, more specific files override earlier files when instructions conflict.",
    ...rules.map((rule) => [
      `## ${rule.path}`,
      `Applies to: ${rule.scopeDir}`,
      rule.content.trim(),
    ].join("\n")),
  ].join("\n\n");
}

function hashText(value: string): string {
  return `sha256:${crypto.createHash("sha256").update(value, "utf-8").digest("hex")}`;
}
