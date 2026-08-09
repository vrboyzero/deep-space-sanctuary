import type { CodeIntelQueryResult } from "./types.js";

export const CODE_INTEL_COORDINATE_SYSTEM = "zero-based-line-column" as const;

export type CodeIntelQueryProjection = CodeIntelQueryResult & {
  coordinateSystem: typeof CODE_INTEL_COORDINATE_SYSTEM;
};

export function projectCodeIntelQueryResult(
  result: CodeIntelQueryResult,
): CodeIntelQueryProjection {
  return {
    ...result,
    coordinateSystem: CODE_INTEL_COORDINATE_SYSTEM,
  };
}
