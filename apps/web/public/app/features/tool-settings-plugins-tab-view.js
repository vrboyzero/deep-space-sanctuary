function text(value) {
  return String(value ?? "");
}

function createElement(ownerDocument, tagName, className = "", value) {
  const element = ownerDocument.createElement(tagName);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = text(value);
  return element;
}

function createPolicyNote(ownerDocument, lines) {
  const note = createElement(ownerDocument, "div", "tool-settings-policy-note");
  note.append(...lines.map((line) => createElement(ownerDocument, "div", "", line)));
  return note;
}

function appendVisibilitySummary(ownerDocument, info, visibility) {
  if (!visibility) return;

  const badges = createElement(ownerDocument, "div", "tool-visibility-badges");
  badges.appendChild(createElement(
    ownerDocument,
    "span",
    `tool-contract-badge ${visibility.available ? "visibility-available" : "visibility-blocked"}`,
    visibility.label,
  ));
  if (visibility.alwaysEnabled) {
    badges.appendChild(createElement(
      ownerDocument,
      "span",
      "tool-contract-badge visibility-always-enabled",
      visibility.alwaysEnabledLabel,
    ));
  }
  info.appendChild(badges);
  if (visibility.reasonMessage) {
    info.appendChild(createElement(ownerDocument, "span", "tool-visibility-reason", visibility.reasonMessage));
  }
}

function createToggle(ownerDocument, name, checked) {
  const toggle = createElement(ownerDocument, "label", "toggle-switch");
  const checkbox = ownerDocument.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = checked;
  checkbox.setAttribute("data-category", "plugins");
  checkbox.setAttribute("data-name", text(name));
  toggle.append(checkbox, createElement(ownerDocument, "span", "toggle-slider"));
  return toggle;
}

function comparePluginNames(left, right) {
  const leftName = text(left.name);
  const rightName = text(right.name);
  if (leftName < rightName) return -1;
  if (leftName > rightName) return 1;
  return 0;
}

export function createToolSettingsPluginsTabView({ ownerDocument, t }) {
  return {
    render(target, { plugins, enabledCount, toolControlView }) {
      if (!target) return null;

      const header = createElement(ownerDocument, "div", "tool-section-header");
      header.append(
        createElement(ownerDocument, "span", "", t("toolSettings.sectionPlugins", {}, "Plugins")),
        createElement(
          ownerDocument,
          "span",
          "tool-section-count",
          t(
            "toolSettings.enabledCount",
            { enabled: enabledCount, total: plugins.length },
            `${enabledCount}/${plugins.length} enabled`,
          ),
        ),
      );

      const children = [header];
      if (toolControlView) {
        children.push(createElement(ownerDocument, "div", "tool-settings-context", toolControlView.context));
        children.push(createPolicyNote(ownerDocument, toolControlView.details));
        if (toolControlView.scopeLines.length) children.push(createPolicyNote(ownerDocument, toolControlView.scopeLines));
        if (toolControlView.launchExplainabilityLines.length) {
          children.push(createPolicyNote(ownerDocument, toolControlView.launchExplainabilityLines));
        }
        if (toolControlView.runtimeLines.length) children.push(createPolicyNote(ownerDocument, toolControlView.runtimeLines));
      }

      for (const plugin of [...plugins].sort(comparePluginNames)) {
        const row = createElement(
          ownerDocument,
          "div",
          `tool-item${plugin.checked ? "" : " disabled"}${plugin.visibility && !plugin.visibility.available ? " unavailable" : ""}`,
        );
        const info = createElement(ownerDocument, "div", "skill-item-info");
        info.appendChild(createElement(ownerDocument, "span", "tool-item-name", plugin.name));
        appendVisibilitySummary(ownerDocument, info, plugin.visibility);
        row.append(info, createToggle(ownerDocument, plugin.name, plugin.checked));
        children.push(row);
      }

      target.replaceChildren(...children);
      return header;
    },
  };
}
