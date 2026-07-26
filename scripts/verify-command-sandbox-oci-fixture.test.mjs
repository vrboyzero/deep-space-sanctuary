import { describe, expect, it, vi } from "vitest";

import {
  buildOciSandboxJobPlans,
  buildOciSandboxFixturePlans,
  verifyOciSandboxFixture,
} from "./verify-command-sandbox-oci-fixture.mjs";

describe("OCI command sandbox fixture contract", () => {
  it("keeps the fixed fixture matrix inside the structured no-network command boundary", () => {
    const fixtures = buildOciSandboxFixturePlans();

    expect(fixtures.map((fixture) => fixture.id)).toEqual([
      "rootfs-readonly",
      "workspace-readonly",
      "workspace-readwrite",
      "network-none",
    ]);
    expect(fixtures.every((fixture) => fixture.plan.network === "none")).toBe(true);
    expect(fixtures.filter((fixture) => fixture.id !== "workspace-readwrite")
      .every((fixture) => fixture.plan.writeScope === "workspace-readonly")).toBe(true);
    expect(fixtures.find((fixture) => fixture.id === "workspace-readwrite")?.plan.writeScope)
      .toBe("workspace-readwrite");
  });

  it("keeps pipe and PTY jobs in the same bounded no-network sandbox profile", () => {
    const fixtures = buildOciSandboxJobPlans();

    expect(fixtures.map((fixture) => fixture.id)).toEqual(["job-pipe", "job-pty"]);
    expect(fixtures.every((fixture) => fixture.plan.network === "none")).toBe(true);
    expect(fixtures.every((fixture) => fixture.plan.writeScope === "workspace-readonly")).toBe(true);
    expect(fixtures.every((fixture) => fixture.plan.timeoutMs === 15_000)).toBe(true);
  });

  it("rejects missing OCI configuration before probing or starting a fixture", async () => {
    const probeOciRuntime = vi.fn(async () => ({ available: true }));

    await expect(verifyOciSandboxFixture({
      readEnv: () => undefined,
      probeOciRuntime,
    })).rejects.toThrow("requires BELLDANDY_COMMAND_SANDBOX_BACKEND=oci");

    expect(probeOciRuntime).not.toHaveBeenCalled();
  });
});
