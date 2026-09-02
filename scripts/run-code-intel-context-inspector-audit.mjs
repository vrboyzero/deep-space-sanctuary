import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hashCanonicalText } from "./coding-agent-benchmark-contract.mjs";

export const CODE_INTEL_CONTEXT_INSPECTOR_AUDIT_REPORT_VERSION =
  "code-intel-context-inspector-audit-report/v1";

const SOURCE_FILES = Object.freeze([
  Object.freeze({
    path: "packages/belldandy-skills/src/code-intel/projection.ts",
    runtimePath: "packages/belldandy-skills/dist/code-intel/projection.js",
  }),
  Object.freeze({
    path: "packages/belldandy-skills/src/code-intel/types.ts",
    runtimePath: "packages/belldandy-skills/dist/code-intel/types.js",
  }),
]);

export async function buildCodeIntelContextInspectorAuditReport(input) {
  const sourceRoot = path.resolve(requireText(input?.sourceRoot, "sourceRoot"));
  const generatedAt = requireIsoTimestamp(input?.generatedAt ?? new Date().toISOString());
  const harness = requireRepositoryIdentity(input?.harness);
  const sourceFiles = await Promise.all(SOURCE_FILES.map(async (entry) => ({
    ...entry,
    sha256: hashCanonicalText((await readBoundedRegularFile(
      path.join(sourceRoot, ...entry.path.split("/")),
      `Context Inspector source ${entry.path}`,
    )).toString("utf-8")),
    runtimeSha256: hashCanonicalText((await readBoundedRegularFile(
      path.join(sourceRoot, ...entry.runtimePath.split("/")),
      `Context Inspector runtime ${entry.runtimePath}`,
    )).toString("utf-8")),
  })));
  const projectionRuntime = sourceFiles[0];
  const projectionUrl = pathToFileURL(
    path.join(sourceRoot, ...projectionRuntime.runtimePath.split("/")),
  );
  projectionUrl.searchParams.set("sha256", projectionRuntime.runtimeSha256);
  const runtime = await import(projectionUrl.href);
  if (typeof runtime.projectCodeIntelQueryResult !== "function") {
    throw new Error(
      `Context Inspector runtime projection export is missing from ${projectionRuntime.runtimePath}.`,
    );
  }

  const scenarios = createAuditInputs().map(({ id, input: scenarioInput }) => {
    const projection = runtime.projectCodeIntelQueryResult(scenarioInput);
    return {
      id,
      inputSha256: sha256(JSON.stringify(scenarioInput)),
      projectionSha256: sha256(JSON.stringify(projection)),
      input: scenarioInput,
      projection,
    };
  });
  const failures = [];
  if (scenarios.some(({ input: scenarioInput, projection }) => {
    return JSON.stringify(projection) !== JSON.stringify({
      ...scenarioInput,
      coordinateSystem: "zero-based-line-column",
    });
  })) {
    failures.push("projection_shape_mismatch");
  }
  if (scenarios.some(({ projection }) => {
    return projection.coordinateSystem !== "zero-based-line-column";
  })) {
    failures.push("coordinate_system_mismatch");
  }
  if (scenarios.some(({ projection }) => exposesMutationAuthority(projection))) {
    failures.push("mutation_authority_exposed");
  }

  return {
    schemaVersion: CODE_INTEL_CONTEXT_INSPECTOR_AUDIT_REPORT_VERSION,
    generatedAt,
    harness,
    sourceIdentity: {
      aggregateSha256: sha256(JSON.stringify(sourceFiles)),
      files: sourceFiles,
    },
    contract: {
      version: "code-intel/v1",
      projection: "projectCodeIntelQueryResult",
      coordinateSystem: "zero-based-line-column",
      mutationAuthority: "none",
    },
    scenarios,
    execution: {
      mode: "read-only",
      gatewayCalls: 0,
      modelCalls: 0,
      providerCalls: 0,
      networkCalls: 0,
      credentialsRead: false,
      workspaceMutations: 0,
    },
    gate: {
      passed: failures.length === 0,
      failures,
    },
  };
}

export async function writeCodeIntelContextInspectorAuditReport(report, outputPathValue) {
  const outputPath = path.resolve(requireText(outputPathValue, "outputPath"));
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  let handle;
  try {
    handle = await fs.open(outputPath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`Context Inspector audit artifact already exists: ${outputPath}`);
    }
    throw error;
  }
  try {
    await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`, "utf-8");
  } finally {
    await handle.close();
  }
}

export async function runCodeIntelContextInspectorAudit(input) {
  const report = await buildCodeIntelContextInspectorAuditReport(input);
  await writeCodeIntelContextInspectorAuditReport(report, input?.outputPath);
  return report;
}

export function parseCodeIntelContextInspectorAuditCliArguments(argv) {
  const names = new Map([
    ["--source-root", "sourceRoot"],
    ["--output", "outputPath"],
    ["--harness-commit", "commit"],
    ["--harness-lockfile-sha256", "lockfileSha256"],
    ["--harness-worktree-content-sha256", "worktreeContentSha256"],
    ["--generated-at", "generatedAt"],
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const argument = argv[index];
    const name = names.get(argument);
    if (name === undefined) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`Context Inspector audit requires a value for ${argument}.`);
    }
    if (values.has(name)) {
      throw new Error(`Duplicate argument: ${argument}`);
    }
    values.set(name, value);
  }
  const generatedAt = values.has("generatedAt")
    ? requireIsoTimestamp(values.get("generatedAt"))
    : undefined;
  return {
    sourceRoot: path.resolve(requireText(values.get("sourceRoot"), "--source-root")),
    outputPath: path.resolve(requireText(values.get("outputPath"), "--output")),
    ...(generatedAt === undefined ? {} : { generatedAt }),
    harness: requireRepositoryIdentity({
      commit: values.get("commit"),
      workspaceDirty: false,
      lockfileSha256: values.get("lockfileSha256"),
      worktreeContentSha256: values.get("worktreeContentSha256"),
    }),
  };
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    const input = parseCodeIntelContextInspectorAuditCliArguments(process.argv.slice(2));
    const report = await runCodeIntelContextInspectorAudit(input);
    process.stdout.write(`${JSON.stringify({
      outputPath: input.outputPath,
      schemaVersion: report.schemaVersion,
      gate: report.gate,
    })}\n`);
    if (!report.gate.passed) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

function createAuditInputs() {
  const common = {
    contractVersion: "code-intel/v1",
    items: [{
      location: {
        scope: "workspace",
        path: "packages/example/src/index.ts",
        range: {
          start: { line: 4, column: 2 },
          end: { line: 4, column: 15 },
        },
      },
      symbolKind: "function",
      documentRevision: `sha256:${"1".repeat(64)}`,
    }],
    provenance: {
      providerId: "context-inspector-audit-provider",
      providerVersion: "1.0.0",
      capability: "semantic-live",
      workspaceRevision: "context-inspector-audit-revision",
      observedAtMs: 1_788_315_200_000,
    },
  };
  return [
    {
      id: "fresh-completed",
      input: {
        ...structuredClone(common),
        operation: "symbols",
        status: "completed",
        page: { returned: 1, truncated: false },
        freshness: { status: "fresh" },
        diagnostics: [],
      },
    },
    {
      id: "stale-partial",
      input: {
        ...structuredClone(common),
        operation: "definition",
        status: "partial",
        page: {
          returned: 1,
          truncated: true,
          nextCursor: "context-inspector-audit-cursor",
        },
        freshness: {
          status: "stale",
          reason: "workspace_revision_changed",
        },
        diagnostics: [{
          code: "provider_partial",
          message: "Index refresh is pending.",
        }],
      },
    },
    {
      id: "unknown-partial",
      input: {
        ...structuredClone(common),
        operation: "references",
        status: "partial",
        page: { returned: 1, truncated: false },
        freshness: {
          status: "unknown",
          reason: "provider_refresh_pending",
        },
        diagnostics: [{
          code: "freshness_unknown",
          message: "Provider freshness is not yet known.",
        }],
      },
    },
  ];
}

function exposesMutationAuthority(value) {
  if (Array.isArray(value)) return value.some(exposesMutationAuthority);
  if (value === null || typeof value !== "object") return false;
  const forbiddenKeys = new Set([
    "mutationAuthority",
    "mutation",
    "write",
    "writeFile",
    "applyPatch",
    "deleteFile",
  ]);
  return Object.entries(value).some(([key, nested]) => {
    return forbiddenKeys.has(key) || exposesMutationAuthority(nested);
  });
}

async function readBoundedRegularFile(filePath, label) {
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) {
    throw new Error(`${label} must be a bounded regular file.`);
  }
  return await fs.readFile(filePath);
}

function requireRepositoryIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",")
      !== "commit,lockfileSha256,workspaceDirty,worktreeContentSha256"
    || !/^[a-f0-9]{40}$/.test(value.commit)
    || value.workspaceDirty !== false
    || !/^[a-f0-9]{64}$/.test(value.lockfileSha256)
    || !/^[a-f0-9]{64}$/.test(value.worktreeContentSha256)) {
    throw new Error("Context Inspector audit requires a clean harness identity.");
  }
  return structuredClone(value);
}

function requireIsoTimestamp(value) {
  const timestamp = requireText(value, "generatedAt");
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== timestamp) {
    throw new Error("Context Inspector audit generatedAt must be an ISO timestamp.");
  }
  return timestamp;
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Context Inspector audit ${label} is required.`);
  }
  return value.trim();
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
