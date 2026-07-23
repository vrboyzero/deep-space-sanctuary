import { describe, expect, it } from "vitest";

import {
  buildEmbeddingCacheDoctorReport,
  DEFAULT_EMBEDDING_CACHE_RETENTION,
} from "./embedding-cache-doctor.js";

describe("buildEmbeddingCacheDoctorReport", () => {
  it("projects anonymous cache capacity and age without exposing raw creation time", () => {
    const report = buildEmbeddingCacheDoctorReport({
      cache: {
        entryCount: 11,
        totalBytes: 256,
        oldestCreatedAt: "2020-01-01T00:00:00.000Z",
      },
      retention: {
        ...DEFAULT_EMBEDDING_CACHE_RETENTION,
        maxEntries: 10,
        maxBytes: 512,
      },
      nowMs: Date.parse("2026-07-23T00:00:00.000Z"),
    });

    expect(report.summary).toMatchObject({
      entryCount: 11,
      totalBytes: 256,
      oldestEntryAgeMs: Date.parse("2026-07-23T00:00:00.000Z") - Date.parse("2020-01-01T00:00:00.000Z"),
      retention: {
        maxEntries: 10,
        maxBytes: 512,
      },
    });
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "memory_embedding_cache",
        status: "warn",
      }),
    ]);
    expect(JSON.stringify(report)).not.toContain("2020-01-01T00:00:00.000Z");
    expect(JSON.stringify(report)).not.toContain("2026-07-23T00:00:00.000Z");
    expect(JSON.stringify(report)).not.toContain("content_hash");
    expect(JSON.stringify(report)).not.toContain("embeddingVector");
  });

  it("keeps an empty cache informational", () => {
    const report = buildEmbeddingCacheDoctorReport({
      cache: {
        entryCount: 0,
        totalBytes: 0,
      },
      retention: DEFAULT_EMBEDDING_CACHE_RETENTION,
      nowMs: Date.parse("2026-07-23T00:00:00.000Z"),
    });

    expect(report.summary).toMatchObject({
      entryCount: 0,
      totalBytes: 0,
      retention: DEFAULT_EMBEDDING_CACHE_RETENTION,
    });
    expect(report.summary).not.toHaveProperty("oldestEntryAgeMs");
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "memory_embedding_cache",
        status: "pass",
      }),
    ]);
  });
});
