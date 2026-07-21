// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createToolSettingsSkillsTabView } from "./tool-settings-skills-tab-view.js";

const t = (_key, _params, fallback) => fallback ?? "";

describe("Tool Settings Skills tab DOM owner", () => {
  it("renders skill metadata, optional content, visibility, and checkbox data as text, properties, and attributes without an HTML parser", () => {
    const body = document.createElement("div");
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(body, "innerHTML", {
      configurable: true,
      get() {
        return descriptor.get.call(this);
      },
      set(value) {
        if (value) throw new Error("Tool Settings Skills tab must not use innerHTML");
        descriptor.set.call(this, value);
      },
    });

    try {
      const view = createToolSettingsSkillsTabView({ ownerDocument: document, t });
      view.render(body, {
        skills: [
          {
            name: 'zeta"><img src=x onerror="alert(1)">',
            source: '<svg onload="alert(2)">Source',
            priority: '<iframe srcdoc="alert(3)">Priority',
            description: '<button onclick="alert(4)">description',
            tags: ['<img src=x onerror="alert(5)">tag', "second-tag"],
            checked: false,
            visibility: {
              available: false,
              label: '<svg onload="alert(6)">Blocked',
              alwaysEnabled: true,
              alwaysEnabledLabel: '<button onclick="alert(7)">Always',
              reasonMessage: '<iframe srcdoc="alert(8)">reason',
            },
          },
          {
            name: "alpha-skill",
            source: "Bundled",
            priority: "High",
            description: "",
            tags: [],
            checked: true,
            visibility: {
              available: true,
              label: "Visible in Current Context",
              alwaysEnabled: false,
              alwaysEnabledLabel: "Always Enabled",
              reasonMessage: "",
            },
          },
        ],
        enabledCount: 1,
        toolControlView: {
          context: '<img src=x onerror="alert(9)">Agent: alpha',
          details: ['<svg onload="alert(10)">Tool Control: Confirm'],
          scopeLines: ['<button onclick="alert(11)">scope'],
          launchExplainabilityLines: ['<iframe srcdoc="alert(12)">launch'],
          runtimeLines: ['<img src=x onerror="alert(13)">runtime'],
        },
      });

      expect([...body.children].map((child) => child.className)).toEqual([
        "tool-section-header",
        "tool-settings-context",
        "tool-settings-policy-note",
        "tool-settings-policy-note",
        "tool-settings-policy-note",
        "tool-settings-policy-note",
        "tool-item",
        "tool-item disabled unavailable",
      ]);
      expect(body.querySelector(".tool-section-header")?.textContent).toBe("Skills1/2 enabled");
      expect(body.querySelector(".tool-settings-context")?.textContent).toBe(
        '<img src=x onerror="alert(9)">Agent: alpha',
      );
      expect([...body.querySelectorAll(".tool-settings-policy-note")].map((node) => node.textContent)).toEqual([
        '<svg onload="alert(10)">Tool Control: Confirm',
        '<button onclick="alert(11)">scope',
        '<iframe srcdoc="alert(12)">launch',
        '<img src=x onerror="alert(13)">runtime',
      ]);

      const rows = [...body.querySelectorAll(".tool-item")];
      expect(rows.map((row) => row.querySelector(".tool-item-name")?.textContent)).toEqual([
        "alpha-skill",
        'zeta"><img src=x onerror="alert(1)">',
      ]);
      expect(rows[0]?.querySelector(".skill-meta")?.textContent).toBe("Bundled · High");
      expect(rows[0]?.querySelector(".skill-desc")).toBeNull();
      expect(rows[0]?.querySelector(".skill-tags")).toBeNull();
      expect(rows[0]?.querySelector(".tool-contract-badge")?.className).toBe(
        "tool-contract-badge visibility-available",
      );

      expect(rows[1]?.querySelector(".skill-meta")?.textContent).toBe(
        '<svg onload="alert(2)">Source · <iframe srcdoc="alert(3)">Priority',
      );
      expect(rows[1]?.querySelector(".skill-desc")?.textContent).toBe(
        '<button onclick="alert(4)">description',
      );
      expect([...(rows[1]?.querySelectorAll(".skill-tag") ?? [])].map((node) => node.textContent)).toEqual([
        '<img src=x onerror="alert(5)">tag',
        "second-tag",
      ]);
      const zetaInput = rows[1]?.querySelector("input[type=checkbox]");
      expect(zetaInput?.checked).toBe(false);
      expect(zetaInput?.getAttribute("data-category")).toBe("skills");
      expect(zetaInput?.getAttribute("data-name")).toBe('zeta"><img src=x onerror="alert(1)">');
      expect(rows[1]?.querySelector(".tool-visibility-badges")?.textContent).toBe(
        '<svg onload="alert(6)">Blocked<button onclick="alert(7)">Always',
      );
      expect(rows[1]?.querySelector(".tool-visibility-reason")?.textContent).toBe(
        '<iframe srcdoc="alert(8)">reason',
      );
      expect(body.querySelector("img, svg, iframe, button[onclick], [onerror], [onload]")).toBeNull();
    } finally {
      Object.defineProperty(body, "innerHTML", descriptor);
    }
  });

  it("replaces old rows and ignores a missing body", () => {
    const view = createToolSettingsSkillsTabView({ ownerDocument: document, t });
    const body = document.createElement("div");
    const first = view.render(body, {
      skills: [{ name: "first", source: "User", priority: "Low", description: "One", tags: [], checked: true, visibility: null }],
      enabledCount: 1,
      toolControlView: null,
    });
    const second = view.render(body, {
      skills: [{ name: "second", source: "Plugin", priority: "Normal", description: "", tags: ["tag"], checked: false, visibility: null }],
      enabledCount: 0,
      toolControlView: null,
    });

    expect(first?.isConnected).toBe(false);
    expect(second).toBe(body.firstElementChild);
    expect(body.querySelector(".tool-item-name")?.textContent).toBe("second");
    expect(body.querySelector(".skill-tags")?.textContent).toBe("tag");
    expect(body.querySelector("input[type=checkbox]")?.checked).toBe(false);
    expect(view.render(null, { skills: [], enabledCount: 0, toolControlView: null })).toBeNull();
  });

  it("keeps owner rendering before the existing Skills toggle-listener assembly", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "apps/web/public/app/features/tool-settings.js"), "utf8");
    const skillsStart = source.indexOf("function renderSkillsTab(skillList, disabledList, visibilityBySkill, visibilityContext, toolControl)");
    const skillsEnd = source.indexOf("function bindToggleEvents", skillsStart);
    const skillsSource = source.slice(skillsStart, skillsEnd);
    const renderIndex = skillsSource.indexOf("toolSettingsSkillsTabView.render(toolSettingsBody, {");
    const bindIndex = skillsSource.indexOf("bindToggleEvents();", renderIndex);

    expect(source).toContain([
      "import { createToolSettingsSkillsTabView }",
      "from",
      '"./tool-settings-skills-tab-view.js";',
    ].join(" "));
    expect(source).toContain(
      "const toolSettingsSkillsTabView = createToolSettingsSkillsTabView({",
    );
    expect(skillsSource).not.toContain("toolSettingsBody.innerHTML");
    expect(renderIndex).toBeGreaterThan(-1);
    expect(bindIndex).toBeGreaterThan(renderIndex);
    expect(skillsSource.slice(bindIndex)).toContain("bindToggleEvents();");
    expect(source).toContain("updateSaveButtonAvailability();");
  });
});
