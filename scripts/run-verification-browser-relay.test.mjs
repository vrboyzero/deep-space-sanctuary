import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import {
  VerificationBrowserRelayFixtureError,
  attachVerificationBrowserRelaySigint,
  getVerificationBrowserArtifactPaths,
  parseVerificationBrowserRelayArgs,
  resolveChromeExecutable,
  resolveMv3ChromeExecutable,
  runVerificationBrowserRelayFixture,
  serializeVerificationBrowserRelayError,
  writeVerificationBrowserRelayArtifacts,
} from "./run-verification-browser-relay.mjs";

const workspaceRoot = path.resolve(import.meta.dirname, "..");
const browserEvidenceSchemaPath = path.join(workspaceRoot, "benchmarks/verification/v1/browser-evidence.schema.json");
const skipRealBrowserTests = process.env.BELLDANDY_SKIP_REAL_BROWSER_RELAY_TESTS === "true";
const chromeExecutablePath = skipRealBrowserTests ? null : await resolveChromeExecutable().catch(() => null);
const mv3ChromeExecutablePath = skipRealBrowserTests ? null : await resolveMv3ChromeExecutable().catch(() => null);
const realChromeIt = chromeExecutablePath ? it : it.skip;
const realMv3ChromeIt = mv3ChromeExecutablePath ? it : it.skip;
const revision = {
  commit: "59af707ac60e32400b842eb5c7ad842609838ce8",
  workspaceHash: crypto.createHash("sha256").update("browser-relay-test-workspace").digest("hex"),
};

describe("verification Browser Relay producer", () => {
  it("parses only bounded explicit CLI arguments and rejects workspace-root escape", () => {
    expect(parseVerificationBrowserRelayArgs([
      "--output-dir", "artifacts/verification/browser",
      "--commit", revision.commit,
      "--extension-path", "apps/browser-extension",
      "--workspace-hash", revision.workspaceHash,
      "--timeout-ms", "5000",
      "--session-timeout-ms", "15000",
      "--viewport", "390x844@2",
    ])).toMatchObject({
      outputDir: "artifacts/verification/browser",
      commit: revision.commit,
      extensionPath: "apps/browser-extension",
      workspaceHash: revision.workspaceHash,
      timeoutMs: 5000,
      sessionTimeoutMs: 15_000,
      viewport: { width: 390, height: 844, deviceScaleFactor: 2 },
    });
    expect(() => parseVerificationBrowserRelayArgs(["--timeout-ms", "999"])).toThrow(/between 1000 and 120000/u);
    expect(() => parseVerificationBrowserRelayArgs(["--session-timeout-ms", "0"])).toThrow(/between 1 and 120000/u);
    expect(() => parseVerificationBrowserRelayArgs(["--viewport", "319x640"])).toThrow(/width must be between 320 and 4096/u);
    expect(() => parseVerificationBrowserRelayArgs(["--unknown", "value"])).toThrow(/unsupported argument/iu);
    expect(() => getVerificationBrowserArtifactPaths(".."))
      .toThrow(/must be a child of the workspace/u);
  });

  it("serializes fixture failures without exposing error正文", () => {
    const serialized = serializeVerificationBrowserRelayError(new VerificationBrowserRelayFixtureError(
      "secret error正文",
      {
        reason: "cancelled",
        lifecycle: {
          status: "settled",
          pageClosed: true,
          browserClosed: true,
          pendingRequestCount: 0,
          orphanResourceCount: 0,
        },
        diagnostics: {
          relay: {
            state: "stopped",
            httpListening: false,
            extensionConnected: false,
            cdpClientCount: 0,
            pendingRequestCount: 0,
          },
          proxy: { openSocketCount: 0, pendingCommandCount: 0 },
          cleanupErrorCount: 0,
        },
      },
    ));
    expect(serialized).toEqual({
      reason: "cancelled",
      lifecycle: {
        status: "settled",
        pageClosed: true,
        browserClosed: true,
        pendingRequestCount: 0,
        orphanResourceCount: 0,
      },
      diagnostics: {
        relay: {
          state: "stopped",
          httpListening: false,
          extensionConnected: false,
          extensionConnectionCount: 0,
          cdpClientCount: 0,
          pendingRequestCount: 0,
        },
        proxy: { openSocketCount: 0, pendingCommandCount: 0 },
        cleanupErrorCount: 0,
      },
    });
    expect(JSON.stringify(serialized)).not.toContain("secret error正文");
  });

  it("maps SIGINT to the fixture AbortSignal and releases the listener", () => {
    const signalTarget = new EventEmitter();
    const controller = new AbortController();
    const detach = attachVerificationBrowserRelaySigint(controller, signalTarget);

    signalTarget.emit("SIGINT");

    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBeInstanceOf(Error);
    expect(controller.signal.reason.message).toBe("SIGINT");
    expect(signalTarget.listenerCount("SIGINT")).toBe(0);
    detach();
    expect(signalTarget.listenerCount("SIGINT")).toBe(0);
  });

  realChromeIt("produces Schema-valid hash-bound artifacts through a real Relay and Chrome", async () => {
    const tempRoot = path.join(workspaceRoot, ".tmp-codex");
    await fs.mkdir(tempRoot, { recursive: true });
    const outputDir = await fs.mkdtemp(path.join(tempRoot, "verification-browser-relay-test-"));
    try {
      const artifactPaths = getVerificationBrowserArtifactPaths(outputDir);
      const result = await runVerificationBrowserRelayFixture({
        revision,
        chromeExecutablePath,
        artifactPaths,
        timeoutMs: 30_000,
      });
      const schema = JSON.parse(await fs.readFile(browserEvidenceSchemaPath, "utf8"));
      const compiled = compileOutputSchema(schema);
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) return;

      expect(result.evidence).toMatchObject({
        status: "passed",
        reason: "all_checks_passed",
        revision,
        page: { loaded: true, finalRoute: "/fixture.html" },
        dom: { changed: true, assertions: { failed: 0 } },
        console: { errorCount: 0 },
        requests: { failedCount: 0, blockedExternalCount: 0, assertions: { failed: 0 } },
        lifecycle: {
          status: "settled",
          pageClosed: true,
          browserClosed: true,
          pendingRequestCount: 0,
          orphanResourceCount: 0,
        },
      });
      expect(result.evidence.requests.outcomes).toEqual(expect.arrayContaining([
        { method: "GET", route: "/fixture.html", status: 200, count: 1 },
        { method: "POST", route: "/probe", status: 200, count: 1 },
      ]));
      expect(result.diagnostics).toEqual({
        relay: {
          state: "stopped",
          httpListening: false,
          extensionConnected: false,
          extensionConnectionCount: 1,
          cdpClientCount: 0,
          pendingRequestCount: 0,
        },
        proxy: { openSocketCount: 0, pendingCommandCount: 0 },
        cleanupErrorCount: 0,
        cleanupErrorLabels: [],
      });
      expect(compiled.validator.validateOutput(JSON.stringify(result.evidence))).toMatchObject({ ok: true });

      const targets = await writeVerificationBrowserRelayArtifacts(outputDir, result);
      const [reportContent, screenshotContent, evidenceContent] = await Promise.all([
        fs.readFile(targets.report, "utf8"),
        fs.readFile(targets.screenshot),
        fs.readFile(targets.evidence, "utf8"),
      ]);
      expect(crypto.createHash("sha256").update(reportContent).digest("hex")).toBe(result.evidence.source.sha256);
      expect(crypto.createHash("sha256").update(screenshotContent).digest("hex")).toBe(result.evidence.screenshot.artifact.sha256);
      expect(screenshotContent.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      expect(`${reportContent}\n${evidenceContent}`).not.toMatch(/verification-fixture|belldandy-relay-v1|<html|verification"/iu);
      await expect(writeVerificationBrowserRelayArtifacts(outputDir, result)).rejects.toThrow(/already exists/u);
    } finally {
      await fs.rm(outputDir, { recursive: true, force: true });
    }
  }, 60_000);

  realChromeIt("settles every resource after a real Chrome interaction deadline", async () => {
    await expect(runVerificationBrowserRelayFixture({
      revision,
      chromeExecutablePath,
      artifactPaths: {
        report: ".tmp-codex/browser-deadline-report.json",
        screenshot: ".tmp-codex/browser-deadline-screenshot.png",
        evidence: ".tmp-codex/browser-deadline-evidence.json",
      },
      timeoutMs: 30_000,
      sessionTimeoutMs: 100,
      probeDelayMs: 5_000,
    })).rejects.toMatchObject({
      name: "VerificationBrowserRelayFixtureError",
      reason: "timed_out",
      lifecycle: {
        status: "settled",
        pageClosed: true,
        browserClosed: true,
        pendingRequestCount: 0,
        orphanResourceCount: 0,
      },
      diagnostics: {
        relay: {
          state: "stopped",
          httpListening: false,
          extensionConnected: false,
          cdpClientCount: 0,
          pendingRequestCount: 0,
        },
        proxy: { openSocketCount: 0, pendingCommandCount: 0 },
        cleanupErrorCount: 0,
      },
    });
  }, 60_000);

  realMv3ChromeIt("produces settled evidence through the real MV3 extension service worker", async () => {
    const result = await runVerificationBrowserRelayFixture({
      revision,
      chromeExecutablePath: mv3ChromeExecutablePath,
      extensionPath: path.join(workspaceRoot, "apps/browser-extension"),
      artifactPaths: {
        report: ".tmp-codex/browser-mv3-report.json",
        screenshot: ".tmp-codex/browser-mv3-screenshot.png",
        evidence: ".tmp-codex/browser-mv3-evidence.json",
      },
      timeoutMs: 20_000,
    });

    expect(result.evidence).toMatchObject({
      status: "passed",
      reason: "all_checks_passed",
      lifecycle: {
        status: "settled",
        pageClosed: true,
        browserClosed: true,
        pendingRequestCount: 0,
        orphanResourceCount: 0,
      },
    });
    expect(result.evidence.requests.outcomes).toEqual(expect.arrayContaining([
      { method: "GET", route: "/fixture.html", status: 200, count: 1 },
      { method: "POST", route: "/probe", status: 200, count: 1 },
    ]));
    expect(result.diagnostics).toMatchObject({
      relay: {
        state: "stopped",
        extensionConnected: false,
        extensionConnectionCount: 1,
        cdpClientCount: 0,
        pendingRequestCount: 0,
      },
      proxy: { openSocketCount: 0, pendingCommandCount: 0 },
      cleanupErrorCount: 0,
      cleanupErrorLabels: [],
    });
  }, 60_000);

  realMv3ChromeIt("restarts the real MV3 service worker and keeps one Relay owner", async () => {
    const result = await runVerificationBrowserRelayFixture({
      revision,
      chromeExecutablePath: mv3ChromeExecutablePath,
      extensionPath: path.join(workspaceRoot, "apps/browser-extension"),
      artifactPaths: {
        report: ".tmp-codex/browser-mv3-restart-report.json",
        screenshot: ".tmp-codex/browser-mv3-restart-screenshot.png",
        evidence: ".tmp-codex/browser-mv3-restart-evidence.json",
      },
      timeoutMs: 20_000,
      restartMv3ServiceWorker: true,
    });

    expect(result.evidence).toMatchObject({
      status: "passed",
      reason: "all_checks_passed",
      lifecycle: {
        status: "settled",
        pendingRequestCount: 0,
        orphanResourceCount: 0,
      },
    });
    expect(result.diagnostics).toMatchObject({
      relay: {
        state: "stopped",
        extensionConnected: false,
        extensionConnectionCount: 2,
        cdpClientCount: 0,
        pendingRequestCount: 0,
      },
      cleanupErrorCount: 0,
      cleanupErrorLabels: [],
    });
  }, 60_000);

  realMv3ChromeIt("reconnects the real MV3 socket after attach and preserves page routing", async () => {
    const result = await runVerificationBrowserRelayFixture({
      revision,
      chromeExecutablePath: mv3ChromeExecutablePath,
      extensionPath: path.join(workspaceRoot, "apps/browser-extension"),
      artifactPaths: {
        report: ".tmp-codex/browser-mv3-relay-reconnect-report.json",
        screenshot: ".tmp-codex/browser-mv3-relay-reconnect-screenshot.png",
        evidence: ".tmp-codex/browser-mv3-relay-reconnect-evidence.json",
      },
      timeoutMs: 20_000,
      reconnectMv3ExtensionBeforeInteraction: true,
    });

    expect(result.evidence).toMatchObject({
      status: "passed",
      reason: "all_checks_passed",
      page: { loaded: true, finalRoute: "/fixture.html" },
      lifecycle: {
        status: "settled",
        pendingRequestCount: 0,
        orphanResourceCount: 0,
      },
    });
    expect(result.diagnostics).toMatchObject({
      relay: {
        state: "stopped",
        extensionConnected: false,
        extensionConnectionCount: 2,
        cdpClientCount: 0,
        pendingRequestCount: 0,
      },
      cleanupErrorCount: 0,
      cleanupErrorLabels: [],
    });
  }, 60_000);

  realMv3ChromeIt("runs three fresh MV3 sessions across bounded viewports without residue", async () => {
    const viewports = [
      { width: 375, height: 667, deviceScaleFactor: 1 },
      { width: 768, height: 1024, deviceScaleFactor: 1 },
      { width: 1440, height: 900, deviceScaleFactor: 1 },
    ];
    const screenshotHashes = [];
    for (const [index, viewport] of viewports.entries()) {
      const result = await runVerificationBrowserRelayFixture({
        revision,
        chromeExecutablePath: mv3ChromeExecutablePath,
        extensionPath: path.join(workspaceRoot, "apps/browser-extension"),
        artifactPaths: {
          report: `.tmp-codex/browser-mv3-repeat-${index + 1}-report.json`,
          screenshot: `.tmp-codex/browser-mv3-repeat-${index + 1}-screenshot.png`,
          evidence: `.tmp-codex/browser-mv3-repeat-${index + 1}-evidence.json`,
        },
        timeoutMs: 20_000,
        viewport,
      });
      expect(result.evidence).toMatchObject({
        status: "passed",
        reason: "all_checks_passed",
        viewport,
        screenshot: { width: viewport.width, height: viewport.height },
        lifecycle: {
          status: "settled",
          pageClosed: true,
          browserClosed: true,
          pendingRequestCount: 0,
          orphanResourceCount: 0,
        },
      });
      expect(result.diagnostics).toMatchObject({
        relay: {
          state: "stopped",
          extensionConnectionCount: 1,
          cdpClientCount: 0,
          pendingRequestCount: 0,
        },
        cleanupErrorCount: 0,
        cleanupErrorLabels: [],
      });
      screenshotHashes.push(result.evidence.screenshot.artifact.sha256);
    }
    expect(new Set(screenshotHashes).size).toBe(viewports.length);
  }, 120_000);

  realMv3ChromeIt("settles the real MV3 extension path after an interaction deadline", async () => {
    await expect(runVerificationBrowserRelayFixture({
      revision,
      chromeExecutablePath: mv3ChromeExecutablePath,
      extensionPath: path.join(workspaceRoot, "apps/browser-extension"),
      artifactPaths: {
        report: ".tmp-codex/browser-mv3-deadline-report.json",
        screenshot: ".tmp-codex/browser-mv3-deadline-screenshot.png",
        evidence: ".tmp-codex/browser-mv3-deadline-evidence.json",
      },
      timeoutMs: 20_000,
      sessionTimeoutMs: 100,
      probeDelayMs: 5_000,
    })).rejects.toMatchObject({
      name: "VerificationBrowserRelayFixtureError",
      reason: "timed_out",
      lifecycle: {
        status: "settled",
        pageClosed: true,
        browserClosed: true,
        pendingRequestCount: 0,
        orphanResourceCount: 0,
      },
      diagnostics: {
        relay: {
          state: "stopped",
          extensionConnected: false,
          cdpClientCount: 0,
          pendingRequestCount: 0,
        },
        proxy: { openSocketCount: 0, pendingCommandCount: 0 },
        cleanupErrorCount: 0,
        cleanupErrorLabels: [],
      },
    });
  }, 60_000);

  realMv3ChromeIt("settles the real MV3 extension path after external cancellation", async () => {
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(new Error("mv3 user cancellation error正文")), 1_000);
    try {
      await expect(runVerificationBrowserRelayFixture({
        revision,
        chromeExecutablePath: mv3ChromeExecutablePath,
        extensionPath: path.join(workspaceRoot, "apps/browser-extension"),
        artifactPaths: {
          report: ".tmp-codex/browser-mv3-cancel-report.json",
          screenshot: ".tmp-codex/browser-mv3-cancel-screenshot.png",
          evidence: ".tmp-codex/browser-mv3-cancel-evidence.json",
        },
        timeoutMs: 20_000,
        probeDelayMs: 5_000,
        signal: controller.signal,
      })).rejects.toMatchObject({
        name: "VerificationBrowserRelayFixtureError",
        reason: "cancelled",
        lifecycle: {
          status: "settled",
          pageClosed: true,
          browserClosed: true,
          pendingRequestCount: 0,
          orphanResourceCount: 0,
        },
        diagnostics: {
          relay: {
            state: "stopped",
            extensionConnected: false,
            cdpClientCount: 0,
            pendingRequestCount: 0,
          },
          proxy: { openSocketCount: 0, pendingCommandCount: 0 },
          cleanupErrorCount: 0,
          cleanupErrorLabels: [],
        },
      });
    } finally {
      clearTimeout(abortTimer);
    }
  }, 60_000);

  realChromeIt("settles every resource after external AbortSignal cancellation", async () => {
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(new Error("user cancellation error正文")), 1_000);
    try {
      await expect(runVerificationBrowserRelayFixture({
        revision,
        chromeExecutablePath,
        artifactPaths: {
          report: ".tmp-codex/browser-cancel-report.json",
          screenshot: ".tmp-codex/browser-cancel-screenshot.png",
          evidence: ".tmp-codex/browser-cancel-evidence.json",
        },
        timeoutMs: 30_000,
        probeDelayMs: 5_000,
        signal: controller.signal,
      })).rejects.toMatchObject({
        name: "VerificationBrowserRelayFixtureError",
        reason: "cancelled",
        lifecycle: {
          status: "settled",
          pageClosed: true,
          browserClosed: true,
          pendingRequestCount: 0,
          orphanResourceCount: 0,
        },
        diagnostics: {
          relay: {
            state: "stopped",
            httpListening: false,
            extensionConnected: false,
            cdpClientCount: 0,
            pendingRequestCount: 0,
          },
          proxy: { openSocketCount: 0, pendingCommandCount: 0 },
          cleanupErrorCount: 0,
        },
      });
    } finally {
      clearTimeout(abortTimer);
    }
  }, 60_000);
});
