import { describe, expect, it } from "vitest";

import {
  buildDerivedRetrievalDoctorReport,
  type DerivedRetrievalRuntimeSnapshot,
} from "./derived-retrieval-doctor.js";

describe("buildDerivedRetrievalDoctorReport", () => {
  it("keeps a fresh manager informational without claiming a derived retrieval failure", () => {
    const report = buildDerivedRetrievalDoctorReport();

    expect(report.summary).toMatchObject({
      available: false,
      observedRunCount: 0,
      chainCount: 3,
    });
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "memory_derived_retrieval",
        status: "pass",
        message: expect.stringContaining("No derived retrieval run"),
      }),
    ]);
  });

  it("projects only bounded counters, budgets, and deadline facts from the latest run", () => {
    const snapshot: DerivedRetrievalRuntimeSnapshot = {
      observedAt: "2026-07-23T12:00:00.000Z",
      reports: {
        session: {
          admitted: true,
          candidateCount: 24,
          detailCount: 48,
          readByteCount: 96 * 1024,
          resultCount: 4,
          skipped: false,
          deadline: {
            exceededBeforeStart: false,
            exceededAfterCompletion: false,
          },
        },
        task: {
          admitted: false,
          candidateCount: 0,
          detailCount: 0,
          readByteCount: 0,
          resultCount: 0,
          skipped: true,
          skipReason: "deadline",
          deadline: {
            exceededBeforeStart: true,
            exceededAfterCompletion: false,
          },
        },
        experience: {
          admitted: true,
          candidateCount: 24,
          detailCount: 12,
          readByteCount: 24 * 1024,
          resultCount: 2,
          skipped: false,
          deadline: {
            exceededBeforeStart: false,
            exceededAfterCompletion: true,
          },
        },
      },
    };

    const report = buildDerivedRetrievalDoctorReport(snapshot);

    expect(report.summary).toMatchObject({
      available: true,
      observedAt: snapshot.observedAt,
      observedRunCount: 1,
      admittedChainCount: 2,
      skippedChainCount: 1,
      deadlineExceededBeforeStartCount: 1,
      deadlineExceededAfterCompletionCount: 1,
      candidateCount: 48,
      detailCount: 60,
      readByteCount: 120 * 1024,
      resultCount: 6,
    });
    expect(report.summary.budgets).toMatchObject({
      session: {
        candidateLimit: 24,
        totalReadByteLimit: 256 * 1024,
      },
      task: {
        referenceRequestLimit: 5,
        maxDistinctDetailCount: 61,
      },
      experience: {
        candidateLimit: 24,
        detailLimit: 12,
        totalBodyByteLimit: 96 * 1024,
      },
    });
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "memory_derived_retrieval",
        status: "warn",
        message: expect.stringContaining("deadlineBeforeStart=1"),
      }),
    ]);
    expect(JSON.stringify(report)).not.toContain("query");
    expect(JSON.stringify(report)).not.toContain("content");
    expect(JSON.stringify(report)).not.toContain("sourcePath");
  });
});
