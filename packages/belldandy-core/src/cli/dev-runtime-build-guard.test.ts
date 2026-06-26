import { expect, test, vi } from "vitest";
import type { WorkspacePackageBuildGuardResult } from "./workspace-build-guard.js";

const { ensureFreshWorkspaceBuildsForDevRuntimeMock } = vi.hoisted(() => ({
  ensureFreshWorkspaceBuildsForDevRuntimeMock: vi.fn<() => WorkspacePackageBuildGuardResult>(() => ({ ok: true, mode: "verified", packageNames: [] })),
}));

vi.mock("./workspace-build-guard.js", () => ({
  ensureFreshWorkspaceBuildsForDevRuntime: ensureFreshWorkspaceBuildsForDevRuntimeMock,
}));

import { ensureFreshWorkspaceBuildsBeforeGatewayModuleLoad } from "./dev-runtime-build-guard.js";

test("ensureFreshWorkspaceBuildsBeforeGatewayModuleLoad passes when workspace artifacts are fresh", () => {
  expect(() => ensureFreshWorkspaceBuildsBeforeGatewayModuleLoad()).not.toThrow();
  expect(ensureFreshWorkspaceBuildsForDevRuntimeMock).toHaveBeenCalledTimes(1);
});

test("ensureFreshWorkspaceBuildsBeforeGatewayModuleLoad throws when workspace build guard fails", () => {
  ensureFreshWorkspaceBuildsForDevRuntimeMock.mockReturnValueOnce({
    ok: false,
    mode: "failed",
    packageNames: ["@belldandy/agent"],
    reason: "Workspace package build guard failed while rebuilding: @belldandy/agent",
  });

  expect(() => ensureFreshWorkspaceBuildsBeforeGatewayModuleLoad()).toThrow(
    "Workspace package build guard failed while rebuilding: @belldandy/agent",
  );
});
