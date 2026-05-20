import path from "node:path";

export interface MemoryIndexPaths {
  sessionsDir: string;
  additionalRoots: string[];
  additionalFiles: string[];
}

export function resolveMemoryIndexPaths(
  stateDir: string,
  options: { includeTeamSharedMemory?: boolean; teamSharedStateDir?: string } = {},
): MemoryIndexPaths {
  const additionalRoots = [
    path.join(stateDir, "memory"),
    path.join(stateDir, "dreams"),
  ];
  const additionalFiles = [
    path.join(stateDir, "MEMORY.md"),
    path.join(stateDir, "DREAM.md"),
  ];

  if (options.includeTeamSharedMemory === true) {
    const teamSharedStateDir = options.teamSharedStateDir || path.join(stateDir, "team-memory");
    additionalRoots.push(path.join(teamSharedStateDir, "memory"));
    additionalFiles.push(path.join(teamSharedStateDir, "MEMORY.md"));
  }

  return {
    sessionsDir: path.join(stateDir, "sessions"),
    additionalRoots,
    additionalFiles,
  };
}
