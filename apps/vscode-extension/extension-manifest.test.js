import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const extensionRoot = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8"));

describe("Star Sanctuary VS Code extension manifest", () => {
  it("keeps executable and state directory configuration machine-scoped with conservative defaults", () => {
    const properties = manifest.contributes.configuration.properties;
    expect(properties["starSanctuary.codingRun.command"]).toMatchObject({
      type: "string",
      default: "bdd",
      scope: "machine",
    });
    expect(properties["starSanctuary.codingRun.stateDir"]).toMatchObject({
      type: "string",
      default: "",
      scope: "machine",
    });
  });

  it("registers bounded Conversation start, exact-bound controls, native change view, and the passive view", () => {
    expect(manifest.contributes.views.explorer).toEqual([{
      id: "starSanctuary.codingRuns",
      name: "Star Sanctuary",
    }]);
    expect(manifest.contributes.commands.map((command) => command.command)).toEqual([
      "starSanctuary.codingRun.start",
      "starSanctuary.codingRun.stop",
      "starSanctuary.codingRun.cancelConversation",
      "starSanctuary.codingRun.cancelWorkflow",
      "starSanctuary.codingRun.subscribeConversation",
      "starSanctuary.codingRun.allowPermission",
      "starSanctuary.codingRun.denyPermission",
      "starSanctuary.codingRun.ask",
      "starSanctuary.codingRun.viewChanges",
    ]);
  });
});
