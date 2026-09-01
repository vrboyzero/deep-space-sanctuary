import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import {
  buildCodeIntelContextInspectorAuditReport,
  parseCodeIntelContextInspectorAuditCliArguments,
  runCodeIntelContextInspectorAudit,
  writeCodeIntelContextInspectorAuditReport,
} from "./run-code-intel-context-inspector-audit.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportSchemaPath = path.join(
  workspaceRoot,
  "benchmarks/code-intel/v1/context-inspector-audit-report.schema.json",
);
const producerPath = fileURLToPath(
  new URL("./run-code-intel-context-inspector-audit.mjs", import.meta.url),
);
const sourceFiles = Object.freeze([
  "packages/belldandy-skills/src/code-intel/projection.ts",
  "packages/belldandy-skills/src/code-intel/types.ts",
  "packages/belldandy-skills/dist/code-intel/projection.js",
  "packages/belldandy-skills/dist/code-intel/types.js",
]);
const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => {
    return fs.rm(root, { recursive: true, force: true });
  }));
});

describe("CodeIntel Context Inspector audit", () => {
  it("preserves evidence, freshness, provenance, diagnostics, and paging without mutation authority", async () => {
    const schema = JSON.parse(await fs.readFile(reportSchemaPath, "utf-8"));
    const report = await buildCodeIntelContextInspectorAuditReport({
      sourceRoot: workspaceRoot,
      generatedAt: "2026-09-02T08:00:00.000Z",
      harness: repositoryIdentity("a"),
    });

    const compiled = compileOutputSchema(schema);
    expect(compiled).toMatchObject({ ok: true });
    expect(compiled.ok && compiled.validator.validateOutput(JSON.stringify(report)))
      .toMatchObject({ ok: true });
    expect(report.contract).toEqual({
      version: "code-intel/v1",
      projection: "projectCodeIntelQueryResult",
      coordinateSystem: "zero-based-line-column",
      mutationAuthority: "none",
    });
    expect(report.scenarios.map(({ id }) => id)).toEqual([
      "fresh-completed",
      "stale-partial",
      "unknown-partial",
    ]);
    expect(report.scenarios.every(({ input, projection }) => {
      return JSON.stringify(projection) === JSON.stringify({
        ...input,
        coordinateSystem: "zero-based-line-column",
      });
    })).toBe(true);
    expect(report.gate).toEqual({ passed: true, failures: [] });
    expect(report.execution).toEqual({
      mode: "read-only",
      gatewayCalls: 0,
      modelCalls: 0,
      providerCalls: 0,
      networkCalls: 0,
      credentialsRead: false,
      workspaceMutations: 0,
    });
  });

  it("writes one immutable audit report and refuses to overwrite it", async () => {
    const temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "ss-context-inspector-audit-"),
    );
    temporaryRoots.push(temporaryRoot);
    const outputPath = path.join(temporaryRoot, "report.json");
    const report = await buildCodeIntelContextInspectorAuditReport({
      sourceRoot: workspaceRoot,
      generatedAt: "2026-09-02T08:00:00.000Z",
      harness: repositoryIdentity("a"),
    });

    await writeCodeIntelContextInspectorAuditReport(report, outputPath);

    expect(JSON.parse(await fs.readFile(outputPath, "utf-8"))).toEqual(report);
    await expect(writeCodeIntelContextInspectorAuditReport(report, outputPath))
      .rejects.toThrow(/already exists/i);
  });

  it("builds and writes one immutable report through the public run seam", async () => {
    const temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "ss-context-inspector-run-"),
    );
    temporaryRoots.push(temporaryRoot);
    const outputPath = path.join(temporaryRoot, "report.json");
    const input = {
      sourceRoot: workspaceRoot,
      outputPath,
      generatedAt: "2026-09-02T08:00:00.000Z",
      harness: repositoryIdentity("a"),
    };

    const report = await runCodeIntelContextInspectorAudit(input);

    expect(JSON.parse(await fs.readFile(outputPath, "utf-8"))).toEqual(report);
    expect(report.gate).toEqual({ passed: true, failures: [] });
    await expect(runCodeIntelContextInspectorAudit(input)).rejects.toThrow(/already exists/i);
  });

  it("materializes one immutable report through the CLI process", async () => {
    const temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "ss-context-inspector-cli-"),
    );
    temporaryRoots.push(temporaryRoot);
    const outputPath = path.join(temporaryRoot, "report.json");
    const argv = [
      producerPath,
      "--source-root", workspaceRoot,
      "--output", outputPath,
      "--harness-commit", "a".repeat(40),
      "--harness-lockfile-sha256", "b".repeat(64),
      "--harness-worktree-content-sha256", "c".repeat(64),
      "--generated-at", "2026-09-02T08:00:00.000Z",
    ];

    const first = spawnSync(process.execPath, argv, {
      cwd: workspaceRoot,
      encoding: "utf-8",
      windowsHide: true,
    });

    expect(first.status).toBe(0);
    expect(first.stderr).toBe("");
    expect(JSON.parse(first.stdout)).toEqual({
      outputPath,
      schemaVersion: "code-intel-context-inspector-audit-report/v1",
      gate: { passed: true, failures: [] },
    });
    const artifactBeforeRetry = await fs.readFile(outputPath);

    const second = spawnSync(process.execPath, argv, {
      cwd: workspaceRoot,
      encoding: "utf-8",
      windowsHide: true,
    });

    expect(second.status).toBe(1);
    expect(second.stdout).toBe("");
    expect(second.stderr).toMatch(/already exists/i);
    expect(await fs.readFile(outputPath)).toEqual(artifactBeforeRetry);
  });

  it("fails before writing when the bound runtime projection export is missing", async () => {
    const sourceRoot = await createSourceFixture("export const unrelated = true;\n");
    const outputPath = path.join(sourceRoot, "report.json");

    await expect(runCodeIntelContextInspectorAudit({
      sourceRoot,
      outputPath,
      generatedAt: "2026-09-02T08:00:00.000Z",
      harness: repositoryIdentity("a"),
    })).rejects.toThrow(
      /runtime projection export is missing.*packages\/belldandy-skills\/dist\/code-intel\/projection\.js/i,
    );
    await expect(fs.stat(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("records a schema-valid failed audit when the runtime uses the wrong coordinates", async () => {
    const sourceRoot = await createSourceFixture(`
export function projectCodeIntelQueryResult(result) {
  return { ...result, coordinateSystem: "one-based-line-column" };
}
`);
    const outputPath = path.join(sourceRoot, "report.json");

    const report = await runCodeIntelContextInspectorAudit({
      sourceRoot,
      outputPath,
      generatedAt: "2026-09-02T08:00:00.000Z",
      harness: repositoryIdentity("a"),
    });
    const schema = JSON.parse(await fs.readFile(reportSchemaPath, "utf-8"));
    const compiled = compileOutputSchema(schema);

    expect(compiled).toMatchObject({ ok: true });
    expect(compiled.ok && compiled.validator.validateOutput(JSON.stringify(report)))
      .toMatchObject({ ok: true });
    expect(report.scenarios.every(({ projection }) => {
      return projection.coordinateSystem === "one-based-line-column";
    })).toBe(true);
    expect(report.gate).toEqual({
      passed: false,
      failures: ["projection_shape_mismatch", "coordinate_system_mismatch"],
    });
    expect(JSON.parse(await fs.readFile(outputPath, "utf-8"))).toEqual(report);
  });

  it("records a failed audit when the runtime drops required projection evidence", async () => {
    const sourceRoot = await createSourceFixture(`
export function projectCodeIntelQueryResult(result) {
  const { provenance, ...projection } = result;
  return { ...projection, coordinateSystem: "zero-based-line-column" };
}
`);
    const outputPath = path.join(sourceRoot, "report.json");

    const report = await runCodeIntelContextInspectorAudit({
      sourceRoot,
      outputPath,
      generatedAt: "2026-09-02T08:00:00.000Z",
      harness: repositoryIdentity("a"),
    });
    const schema = JSON.parse(await fs.readFile(reportSchemaPath, "utf-8"));
    const compiled = compileOutputSchema(schema);

    expect(compiled).toMatchObject({ ok: true });
    expect(compiled.ok && compiled.validator.validateOutput(JSON.stringify(report)))
      .toMatchObject({ ok: true });
    expect(report.scenarios.every(({ projection }) => {
      return !("provenance" in projection);
    })).toBe(true);
    expect(report.gate).toEqual({
      passed: false,
      failures: ["projection_shape_mismatch"],
    });
    expect(JSON.parse(await fs.readFile(outputPath, "utf-8"))).toEqual(report);
  });

  it("records a failed audit when the runtime exposes mutation authority", async () => {
    const sourceRoot = await createSourceFixture(`
export function projectCodeIntelQueryResult(result) {
  return {
    ...result,
    coordinateSystem: "zero-based-line-column",
    write: "workspace-file",
  };
}
`);
    const outputPath = path.join(sourceRoot, "report.json");

    const report = await runCodeIntelContextInspectorAudit({
      sourceRoot,
      outputPath,
      generatedAt: "2026-09-02T08:00:00.000Z",
      harness: repositoryIdentity("a"),
    });
    const schema = JSON.parse(await fs.readFile(reportSchemaPath, "utf-8"));
    const compiled = compileOutputSchema(schema);

    expect(compiled).toMatchObject({ ok: true });
    expect(compiled.ok && compiled.validator.validateOutput(JSON.stringify(report)))
      .toMatchObject({ ok: true });
    expect(report.scenarios.every(({ projection }) => {
      return projection.write === "workspace-file";
    })).toBe(true);
    expect(report.gate).toEqual({
      passed: false,
      failures: ["projection_shape_mismatch", "mutation_authority_exposed"],
    });
    expect(JSON.parse(await fs.readFile(outputPath, "utf-8"))).toEqual(report);
  });

  it("parses only explicit source, output, and clean harness identity arguments", () => {
    expect(parseCodeIntelContextInspectorAuditCliArguments([
      "--source-root", ".",
      "--output", "artifacts/context-inspector/report.json",
      "--harness-commit", "a".repeat(40),
      "--harness-lockfile-sha256", "b".repeat(64),
      "--harness-worktree-content-sha256", "c".repeat(64),
      "--generated-at", "2026-09-02T08:00:00.000Z",
    ])).toEqual({
      sourceRoot: workspaceRoot,
      outputPath: path.join(workspaceRoot, "artifacts/context-inspector/report.json"),
      generatedAt: "2026-09-02T08:00:00.000Z",
      harness: {
        commit: "a".repeat(40),
        workspaceDirty: false,
        lockfileSha256: "b".repeat(64),
        worktreeContentSha256: "c".repeat(64),
      },
    });
    expect(() => parseCodeIntelContextInspectorAuditCliArguments([
      "--unknown", "value",
    ])).toThrow(/unknown argument/i);
  });

  it.each([
    {
      label: "duplicate output selection",
      argv: validCliArguments().concat([
        "--output", "artifacts/context-inspector/other-report.json",
      ]),
      error: /duplicate argument.*--output/i,
    },
    {
      label: "missing trailing value",
      argv: validCliArguments().concat(["--generated-at"]),
      error: /requires a value.*--generated-at/i,
    },
    {
      label: "missing output",
      argv: validCliArguments().filter((_, index) => index < 2 || index > 3),
      error: /--output is required/i,
    },
    {
      label: "invalid harness commit",
      argv: replaceCliValue(validCliArguments(), "--harness-commit", "invalid"),
      error: /clean harness identity/i,
    },
    {
      label: "invalid harness lockfile digest",
      argv: replaceCliValue(
        validCliArguments(),
        "--harness-lockfile-sha256",
        "f".repeat(63),
      ),
      error: /clean harness identity/i,
    },
    {
      label: "invalid generated time",
      argv: validCliArguments().concat(["--generated-at", "not-a-time"]),
      error: /generatedAt must be an ISO timestamp/i,
    },
  ])("rejects $label", ({ argv, error }) => {
    expect(() => parseCodeIntelContextInspectorAuditCliArguments(argv)).toThrow(error);
  });
});

function validCliArguments() {
  return [
    "--source-root", ".",
    "--output", "artifacts/context-inspector/report.json",
    "--harness-commit", "a".repeat(40),
    "--harness-lockfile-sha256", "b".repeat(64),
    "--harness-worktree-content-sha256", "c".repeat(64),
  ];
}

function replaceCliValue(argv, name, value) {
  const result = [...argv];
  result[result.indexOf(name) + 1] = value;
  return result;
}

function repositoryIdentity(seed) {
  return {
    commit: seed.repeat(40),
    workspaceDirty: false,
    lockfileSha256: seed.repeat(64),
    worktreeContentSha256: seed.repeat(64),
  };
}

async function createSourceFixture(projectionRuntime) {
  const sourceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "ss-context-inspector-source-"),
  );
  temporaryRoots.push(sourceRoot);
  for (const relativePath of sourceFiles) {
    const target = path.join(sourceRoot, ...relativePath.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    if (relativePath.endsWith("/projection.js")) {
      await fs.writeFile(target, projectionRuntime, "utf-8");
    } else {
      await fs.copyFile(
        path.join(workspaceRoot, ...relativePath.split("/")),
        target,
      );
    }
  }
  return sourceRoot;
}
