import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveMemoryIndexPaths } from "./memory-index-paths.js";

describe("resolveMemoryIndexPaths", () => {
  it("keeps memory indexing inside BELLDANDY_STATE_DIR", () => {
    const stateDir = "C:/Users/admin/.star_sanctuary";
    const result = resolveMemoryIndexPaths(stateDir);

    expect(result.sessionsDir).toBe(path.join(stateDir, "sessions"));
    expect(result.additionalRoots).toEqual([
      path.join(stateDir, "memory"),
      path.join(stateDir, "dreams"),
    ]);
    expect(result.additionalFiles).toEqual([
      path.join(stateDir, "MEMORY.md"),
      path.join(stateDir, "DREAM.md"),
    ]);
  });

  it("can opt into team shared memory indexing without leaving stateDir", () => {
    const stateDir = "C:/Users/admin/.star_sanctuary";
    const result = resolveMemoryIndexPaths(stateDir, { includeTeamSharedMemory: true });

    expect(result.sessionsDir).toBe(path.join(stateDir, "sessions"));
    expect(result.additionalRoots).toEqual([
      path.join(stateDir, "memory"),
      path.join(stateDir, "dreams"),
      path.join(stateDir, "team-memory", "memory"),
    ]);
    expect(result.additionalFiles).toEqual([
      path.join(stateDir, "MEMORY.md"),
      path.join(stateDir, "DREAM.md"),
      path.join(stateDir, "team-memory", "MEMORY.md"),
    ]);
  });

  it("can point shared memory indexing at a workspace-scoped shared layer", () => {
    const stateDir = "C:/Users/admin/.star_sanctuary/workspaces/project-b/agents/coder";
    const teamSharedStateDir = "C:/Users/admin/.star_sanctuary/workspaces/project-b/team-memory";
    const result = resolveMemoryIndexPaths(stateDir, {
      includeTeamSharedMemory: true,
      teamSharedStateDir,
    });

    expect(result.sessionsDir).toBe(path.join(stateDir, "sessions"));
    expect(result.additionalRoots).toEqual([
      path.join(stateDir, "memory"),
      path.join(stateDir, "dreams"),
      path.join(teamSharedStateDir, "memory"),
    ]);
    expect(result.additionalFiles).toEqual([
      path.join(stateDir, "MEMORY.md"),
      path.join(stateDir, "DREAM.md"),
      path.join(teamSharedStateDir, "MEMORY.md"),
    ]);
  });
});
