import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { expect, test } from "vitest";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const fixture = {
  warmupRuns: 2,
  sampleRuns: 5,
  totalNodeCount: 50,
  chunksPerNode: 20,
  sourcesPerNode: 1,
  chunkContentBytes: 512,
  scenarios: [1, 10, 50],
};

function sample(durationMs: number, sqliteStatementCount: number) {
  return { durationMs, sqliteStatementCount };
}

test("memory tree detail benchmark records fixed-corpus statement, plan and behavior evidence without thresholds", async () => {
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-memory-tree-detail-benchmark.mjs")).href,
  );
  const report = benchmarkModule.createMemoryTreeDetailBenchmarkReport({
    generatedAt: "2026-07-23T00:00:00.000Z",
    environment: { platform: "win32", nodeVersion: "v22.14.0", betterSqlite3Version: "11.9.1" },
    source: { commit: "fixture-commit", workspaceDirty: true, lockfileSha256: "fixture-lock-hash" },
    fixture,
    queryPlans: {
      nodeById: ["SEARCH memory_tree_nodes USING INDEX sqlite_autoindex_memory_tree_nodes_1 (id=?)"],
      edgesByParent: ["SEARCH memory_tree_edges USING INDEX idx_memory_tree_edges_parent (parent_node_id=?)"],
      chunkById: ["SEARCH chunks USING INDEX sqlite_autoindex_chunks_1 (id=?)"],
      sourcesByIds: ["SEARCH memory_sources USING INDEX sqlite_autoindex_memory_sources_1 (id=?)"],
    },
    scenarios: [
      {
        id: "tree_detail_1_node",
        operation: "MemoryManager.getMemoryTreeNodeDetails",
        observed: {
          nodeCount: 1,
          edgeCount: 21,
          chunkCount: 20,
          sourceCount: 1,
          behaviorDigest: "digest-1",
        },
        samples: [sample(1, 4), sample(2, 4), sample(3, 4), sample(4, 4), sample(5, 4)],
      },
      {
        id: "tree_detail_10_nodes",
        operation: "MemoryManager.getMemoryTreeNodeDetails",
        observed: {
          nodeCount: 10,
          edgeCount: 210,
          chunkCount: 200,
          sourceCount: 10,
          behaviorDigest: "digest-10",
        },
        samples: [sample(10, 4), sample(11, 4), sample(12, 4), sample(13, 4), sample(14, 4)],
      },
      {
        id: "tree_detail_50_nodes",
        operation: "MemoryManager.getMemoryTreeNodeDetails",
        observed: {
          nodeCount: 50,
          edgeCount: 1050,
          chunkCount: 1000,
          sourceCount: 50,
          behaviorDigest: "digest-50",
        },
        samples: [sample(50, 5), sample(51, 5), sample(52, 5), sample(53, 5), sample(54, 5)],
      },
    ],
  });

  expect(report).toMatchObject({
    schemaVersion: "performance-benchmark-report/v1",
    status: "completed",
    benchmark: {
      id: "memory-tree-detail",
      mode: "report_only",
      executionMode: "warm_in_process",
      thresholdApplied: false,
    },
    fixture,
    queryPlans: {
      nodeById: expect.any(Array),
      edgesByParent: expect.any(Array),
      chunkById: expect.any(Array),
      sourcesByIds: expect.any(Array),
    },
  });
  expect(report).not.toHaveProperty("thresholds");
  expect(report.scenarios[0]).toMatchObject({
    observed: { nodeCount: 1, edgeCount: 21, chunkCount: 20, sourceCount: 1 },
    warmLatencyMs: { p50: 3, p95: 5 },
    sqliteStatementCount: { unit: "statements", p50: 4, p95: 4 },
  });
  expect(report.scenarios[1]?.sqliteStatementCount).toMatchObject({ p50: 4, p95: 4 });
  expect(report.scenarios[2]?.sqliteStatementCount).toMatchObject({ p50: 5, p95: 5 });
  expect(report.scenarios.map((scenario: { samples: unknown[] }) => scenario.samples)).toHaveLength(3);
});

test("root exposes the tsx-backed memory tree detail benchmark command", async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(workspaceRoot, "package.json"), "utf-8")) as {
    scripts?: Record<string, string>;
  };

  expect(packageJson.scripts?.["benchmark:memory-tree-detail"])
    .toBe("node --import tsx scripts/run-memory-tree-detail-benchmark.mjs");
});

test("memory tree detail benchmark accepts pnpm argument separators", async () => {
  const benchmarkModule = await import(
    pathToFileURL(path.join(workspaceRoot, "scripts", "run-memory-tree-detail-benchmark.mjs")).href,
  );

  expect(benchmarkModule.parseMemoryTreeDetailBenchmarkArgs([
    "--",
    "--sample-runs",
    "3",
    "--warmup-runs",
    "0",
  ])).toMatchObject({
    sampleRuns: 3,
    warmupRuns: 0,
  });
});
