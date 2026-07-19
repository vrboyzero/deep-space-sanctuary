import fs from "node:fs";

import { describe, expect, it } from "vitest";

const appSource = fs.readFileSync(new URL("./app.js", import.meta.url), "utf8");
const settingsSource = fs.readFileSync(new URL("./app/features/settings.js", import.meta.url), "utf8");

describe("WebChat app lifecycle wiring", () => {
  it("disposes ChatNetwork exactly once from the main pagehide fan-out", () => {
    const lifecycleBlock = appSource.match(
      /window\.addEventListener\("pagehide", \(\) => \{\s*agentSessionCacheFeature\.dispose\(\);([\s\S]*?)\}, \{ once: true \}\);/,
    )?.[0] ?? "";
    const chatNetworkDisposeCalls = appSource.match(/chatNetworkFeature\?\.dispose\(\);/g) ?? [];

    expect(lifecycleBlock).toContain("chatNetworkFeature?.dispose();");
    expect(chatNetworkDisposeCalls).toHaveLength(1);
  });

  it("disposes pending Doctor card rendering from the settings lifecycle", () => {
    const settingsDisposeBlock = settingsSource.match(
      /function dispose\(\) \{\s*if \(disposed\) return;([\s\S]*?)\n  \}/,
    )?.[0] ?? "";
    const doctorDisposeCalls = settingsSource.match(
      /disposeDoctorObservabilityCardRendering\(doctorStatusEl\);/g,
    ) ?? [];

    expect(settingsDisposeBlock).toContain("disposeDoctorObservabilityCardRendering(doctorStatusEl);");
    expect(doctorDisposeCalls).toHaveLength(1);
  });

  it("disposes Goals specialist panel controls exactly once from pagehide", () => {
    const lifecycleBlock = appSource.match(
      /window\.addEventListener\("pagehide", \(\) => \{\s*agentSessionCacheFeature\.dispose\(\);([\s\S]*?)\}, \{ once: true \}\);/,
    )?.[0] ?? "";
    const specialistDisposeCalls = appSource.match(/goalsSpecialistPanelsFeature\?\.dispose\(\);/g) ?? [];

    expect(lifecycleBlock).toContain("goalsSpecialistPanelsFeature?.dispose();");
    expect(specialistDisposeCalls).toHaveLength(1);
  });
});
