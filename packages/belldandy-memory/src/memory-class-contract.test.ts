import { describe, expect, it } from "vitest";

import {
  getMemoryClassContract,
  isMemoryClass,
  isMemoryTruthMode,
  listMemoryClassContracts,
  normalizeMemoryClass,
  normalizeMemoryTruthMode,
} from "./memory-class-contract.js";

describe("memory class contract", () => {
  it("normalizes memory classes and truth modes", () => {
    expect(isMemoryClass("profile_semantic")).toBe(true);
    expect(isMemoryClass("unknown")).toBe(false);
    expect(normalizeMemoryClass(" Profile_Semantic ")).toBe("profile_semantic");
    expect(normalizeMemoryClass("missing", "governance")).toBe("governance");

    expect(isMemoryTruthMode("runtime_projection")).toBe(true);
    expect(isMemoryTruthMode("snapshot")).toBe(false);
    expect(normalizeMemoryTruthMode(" Review_Artifact ")).toBe("review_artifact");
    expect(normalizeMemoryTruthMode(undefined, "derived")).toBe("derived");
  });

  it("exposes the five-layer contract definitions", () => {
    const contracts = listMemoryClassContracts();
    expect(contracts.map((item) => item.memoryClass)).toEqual([
      "profile_semantic",
      "project_semantic",
      "episodic_task",
      "procedural_experience",
      "governance",
    ]);

    expect(getMemoryClassContract("governance")).toMatchObject({
      label: "Governance",
    });
    expect(getMemoryClassContract("governance").truthBoundary).toContain("not a semantic memory layer");
    expect(getMemoryClassContract("profile_semantic").lineageSignals).toContain("profileStateEvents");
  });
});
