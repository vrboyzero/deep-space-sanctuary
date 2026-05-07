import { describe, expect, test } from "vitest";

import { describeConfigureCompletion } from "./shared.js";

describe("configure completion", () => {
  test("marks changed when the requested module produced notes", () => {
    const summary = describeConfigureCompletion("webhook", "Webhook", {
      configuredModules: ["webhook"],
      notes: ["Webhook config saved: state/webhooks.json"],
    });

    expect(summary).toEqual({
      changed: true,
      message: "Webhook configuration saved",
      notes: [
        "Webhook config saved: state/webhooks.json",
        "Starweaver shared-host default remains: prefer starweaver-central, keep local starweaver only as fallback with autoConnect=false.",
      ],
    });
  });

  test("marks unchanged when the requested module was skipped", () => {
    const summary = describeConfigureCompletion("community", "Community", {
      configuredModules: [],
      notes: [],
    });

    expect(summary).toEqual({
      changed: false,
      message: "Community configuration unchanged",
      notes: [
        "Starweaver shared-host default remains: prefer starweaver-central, keep local starweaver only as fallback with autoConnect=false.",
      ],
    });
  });
});
