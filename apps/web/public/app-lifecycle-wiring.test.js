import fs from "node:fs";

import { describe, expect, it } from "vitest";

const appSource = fs.readFileSync(new URL("./app.js", import.meta.url), "utf8");
const settingsSource = fs.readFileSync(new URL("./app/features/settings.js", import.meta.url), "utf8");

describe("WebChat app lifecycle wiring", () => {
  it("forwards request lifecycle options through the app entrypoint", () => {
    expect(appSource).toContain("function sendReq(frame, options) {");
    expect(appSource).toContain("return chatNetworkFeature?.sendReq(frame, options) ?? Promise.resolve(null);");
  });

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

  it("disposes the boot sequence exactly once from the main pagehide fan-out", () => {
    const lifecycleBlock = appSource.match(
      /window\.addEventListener\("pagehide", \(\) => \{\s*agentSessionCacheFeature\.dispose\(\);([\s\S]*?)\}, \{ once: true \}\);/,
    )?.[0] ?? "";
    const bootSequenceDisposeCalls = appSource.match(/bootSequenceFeature\.dispose\(\);/g) ?? [];

    expect(lifecycleBlock).toContain("bootSequenceFeature.dispose();");
    expect(bootSequenceDisposeCalls).toHaveLength(1);
    expect(appSource).toContain("return bootSequenceFeature.play();");
  });

  it("captures lifecycle pagehide diagnostics once after feature disposal", () => {
    const lifecycleBlock = appSource.match(
      /window\.addEventListener\("pagehide", \(\) => \{\s*agentSessionCacheFeature\.dispose\(\);([\s\S]*?)\}, \{ once: true \}\);/,
    )?.[0] ?? "";
    const pagehideCaptureCalls = appSource.match(/webchatLifecycleDiagnostics\.capturePagehide\(\);/g) ?? [];

    expect(lifecycleBlock).toContain("webchatLifecycleDiagnostics.capturePagehide();");
    expect(lifecycleBlock.indexOf("localeController.dispose();")).toBeLessThan(
      lifecycleBlock.indexOf("webchatLifecycleDiagnostics.capturePagehide();"),
    );
    expect(pagehideCaptureCalls).toHaveLength(1);
  });

  it("wires lifecycle replacement, feature dispose, and explicit Doctor snapshots", () => {
    expect(appSource).toContain("onReplacementSettlement: () => webchatLifecycleDiagnostics.captureReplacementSettlement()");
    expect(appSource).toContain("onFeatureDispose: () => webchatLifecycleDiagnostics.captureFeatureDispose()");
    expect(appSource).toContain("getWebchatLifecycleSummary: () => webchatLifecycleDiagnostics.getSummary()");
    expect(appSource).toContain("webchatLifecycle: webchatLifecycleDiagnostics.getSummary()");
  });
});
