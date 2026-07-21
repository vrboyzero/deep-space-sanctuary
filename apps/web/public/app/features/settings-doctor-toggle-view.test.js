// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { createSettingsDoctorToggleView } from "./settings-doctor-toggle-view.js";

describe("Settings Doctor toggle DOM owner", () => {
  it("renders all transient states as text and replaces the prior label", () => {
    const button = document.createElement("button");
    const view = createSettingsDoctorToggleView({
      ownerDocument: document,
      t: (key) => `<img data-key="${key}" onerror="alert(1)">locale`,
    });

    view.render(button, "checking");
    expect(button.className).toBe("button button-muted badge");
    expect(button.children).toHaveLength(1);
    expect(button.children[0].tagName).toBe("SPAN");
    expect(button.children[0].textContent).toBe('<img data-key="settings.doctorChecking" onerror="alert(1)">locale');
    expect(button.children[0].getAttribute("data-i18n")).toBe("settings.doctorChecking");
    expect(button.querySelector("img")).toBeNull();

    view.render(button, "disconnected");
    expect(button.className).toBe("button badge fail");
    expect(button.children).toHaveLength(1);
    expect(button.children[0].textContent).toContain("settings.doctorDisconnected");
    expect(button.children[0].getAttribute("data-i18n")).toBe("settings.doctorDisconnected");

    view.render(button, "failed");
    expect(button.children).toHaveLength(1);
    expect(button.children[0].textContent).toContain("settings.doctorCheckFailed");
    expect(button.children[0].getAttribute("data-i18n")).toBe("settings.doctorCheckFailed");
    expect(button.querySelector("img, svg, [onerror]")).toBeNull();
  });

  it("ignores missing buttons and unknown states", () => {
    const view = createSettingsDoctorToggleView({ ownerDocument: document, t: () => "label" });
    expect(() => view.render(null, "checking")).not.toThrow();
    const button = document.createElement("button");
    expect(() => view.render(button, "unknown")).not.toThrow();
    expect(button.children).toHaveLength(0);
  });
});
