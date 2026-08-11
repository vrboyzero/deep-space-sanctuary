import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const backgroundPath = fileURLToPath(new URL("./background.js", import.meta.url));

describe("browser extension Relay lifecycle wiring", () => {
  it("delegates connection ownership to the controller and releases it on MV3 suspend", async () => {
    const source = await readFile(backgroundPath, "utf8");

    expect(source).toContain('import { RelayConnectionController } from "./relay-connection-controller.js";');
    expect(source).toContain("const relayConnection = new RelayConnectionController({");
    expect(source).not.toContain("let relayWs = null");
    expect(source).not.toContain("let relayConnectPromise = null");
    expect(source).not.toContain("setupAutoReconnect");

    expect(source).toMatch(/chrome\.runtime\.onSuspend\.addListener\(\(\) => \{[\s\S]*relayConnection\.dispose\(\);[\s\S]*tabs\.clear\(\);[\s\S]*tabBySession\.clear\(\);/);
    expect(source).toContain("void chrome.alarms.clear(KEEP_ALIVE_ALARM_NAME);");
    expect(source).toMatch(/method === "Target\.closeTarget"[\s\S]*targetIdStr === "page-1"[\s\S]*chrome\.tabs\.query\(\{ active: true, currentWindow: true \}\)[\s\S]*chrome\.tabs\.remove\(closeTabId\)/);
    expect(source).toMatch(/function onDebuggerDetach[\s\S]*Target\.detachedFromTarget[\s\S]*Target\.targetDestroyed[\s\S]*tabs\.delete\(tabId\)/);
  });
});
