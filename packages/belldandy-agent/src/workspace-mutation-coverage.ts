import { readWorkspaceMutationChangedPaths } from "@belldandy/skills";

export type WorkspaceMutationPathCoverage = {
  observeSuccessfulMutation(metadata: unknown): boolean;
  missingPaths(): string[];
};

export function createWorkspaceMutationPathCoverage(
  requiredChangedPaths: readonly string[],
): WorkspaceMutationPathCoverage {
  const requiredByIdentity = new Map(
    requiredChangedPaths.map((requiredPath) => [requiredPath.toLowerCase(), requiredPath]),
  );
  const observedIdentities = new Set<string>();

  return {
    observeSuccessfulMutation(metadata: unknown): boolean {
      if (requiredByIdentity.size === 0) {
        return true;
      }
      const changedPaths = readWorkspaceMutationChangedPaths(metadata);
      if (!changedPaths) {
        return false;
      }
      for (const changedPath of changedPaths) {
        const identity = changedPath.toLowerCase();
        if (requiredByIdentity.has(identity)) {
          observedIdentities.add(identity);
        }
      }
      return observedIdentities.size === requiredByIdentity.size;
    },
    missingPaths(): string[] {
      return [...requiredByIdentity]
        .filter(([identity]) => !observedIdentities.has(identity))
        .map(([, requiredPath]) => requiredPath);
    },
  };
}
