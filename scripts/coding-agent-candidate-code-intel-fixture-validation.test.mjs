import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import { addCandidateCodeIntelEvidence } from "./coding-agent-candidate-code-intel-evidence-fixtures.mjs";
import { withSafetyEvidenceFixture } from "./coding-agent-candidate-dimension-evidence-fixtures.mjs";

const schemaByVersion = new Map([
  ["code-intel-truth-set-report/v1", "benchmarks/code-intel/v1/report.schema.json"],
  ["code-intel-context-inspector-audit-report/v1", "benchmarks/code-intel/v1/context-inspector-audit-report.schema.json"],
  ["code-intel-resource-soak-report/v1", "benchmarks/code-intel/v1/resource-soak-report.schema.json"],
  ["code-intel-agent-uplift-report/v1", "benchmarks/code-intel/v1/agent-uplift-report.schema.json"],
  ["code-intel-agent-uplift-platform/v1", "benchmarks/code-intel/v1/agent-uplift-platform.schema.json"],
  ["code-intel-go-truth-set-report/v1", "benchmarks/code-intel/v1/go-truth-set-report.schema.json"],
  ["code-intel-go-oci-promotion-gate-report/v1", "benchmarks/code-intel/v1/go-oci-promotion-gate-report.schema.json"],
  ["code-intel-go-canary-comparator-report/v1", "benchmarks/code-intel/v1/go-canary-comparator-report.schema.json"],
]);

describe("coding agent candidate CodeIntel fixture", () => {
  it("materializes eleven reports accepted by their producer schemas", async () => {
    await withSafetyEvidenceFixture(async ({ aggregateRoot }) => {
      let captured;
      await addCandidateCodeIntelEvidence(aggregateRoot, {
        inspect(value) {
          captured = value;
        },
      });
      const references = [
        ...captured.receipt.truthSet,
        captured.receipt.contextInspector,
        ...captured.receipt.resourceSoak,
        captured.receipt.agentUplift.aggregate,
        ...captured.receipt.agentUplift.platformReports,
        captured.receipt.goCanary.comparator,
        captured.receipt.goCanary.windowsNative,
        captured.receipt.goCanary.wsl2Oci,
      ];

      expect(references).toHaveLength(11);
      for (const reference of references) {
        const schemaPath = schemaByVersion.get(reference.artifactSchemaVersion);
        const [schema, artifactText] = await Promise.all([
          fs.readFile(path.resolve(schemaPath), "utf8").then(JSON.parse),
          fs.readFile(path.resolve(aggregateRoot, ...reference.path.split("/")), "utf8"),
        ]);
        const compiled = compileOutputSchema(schema);
        expect(compiled, reference.path).toMatchObject({ ok: true });
        const validation = compiled.ok && compiled.validator.validateOutput(artifactText);
        expect(
          validation,
          `${reference.path}: ${JSON.stringify(validation)}`,
        ).toMatchObject({ ok: true });
      }
    });
  });
});
