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

function createToggle(ownerDocument, serverId, checked) {
  const toggle = createElement(ownerDocument, "label", "toggle-switch");
  const checkbox = ownerDocument.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = checked;
  checkbox.setAttribute("data-category", "mcp_servers");
  checkbox.setAttribute("data-name", text(serverId));
  toggle.append(checkbox, createElement(ownerDocument, "span", "toggle-slider"));
  return toggle;
}

function compareServerIds(left, right) {
  const leftId = text(left.id);
  const rightId = text(right.id);
  if (leftId < rightId) return -1;
  if (leftId > rightId) return 1;
  return 0;
}

function renderToolNames(server) {
  return (server.tools || [])
    .map((toolName) => text(toolName).replace(`mcp_${text(server.id)}_`, ""))
    .join(", ");
}

export function createToolSettingsMcpTabView({ ownerDocument, t }) {
  return {
    render(target, { servers, enabledCount, toolControlView }) {
      if (!target) return null;

      const header = createElement(ownerDocument, "div", "tool-section-header");
      header.append(
        createElement(ownerDocument, "span", "", t("toolSettings.sectionMcp", {}, "MCP Servers")),
        createElement(
          ownerDocument,
          "span",
          "tool-section-count",
          t(
            "toolSettings.enabledCount",
            { enabled: enabledCount, total: servers.length },
            `${enabledCount}/${servers.length} enabled`,
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

      for (const server of [...servers].sort(compareServerIds)) {
        const row = createElement(
          ownerDocument,
          "div",
          `tool-item${server.checked ? "" : " disabled"}${server.visibility && !server.visibility.available ? " unavailable" : ""}`,
        );
        const info = createElement(ownerDocument, "div", "skill-item-info");
        info.appendChild(createElement(ownerDocument, "span", "tool-item-name", server.id));
        const toolNames = renderToolNames(server);
        info.appendChild(createElement(
          ownerDocument,
          "span",
          toolNames ? "skill-desc" : "skill-meta",
          toolNames || t("toolSettings.emptyNoTools", {}, "No tools"),
        ));
        appendVisibilitySummary(ownerDocument, info, server.visibility);
        row.append(info, createToggle(ownerDocument, server.id, server.checked));
        children.push(row);
      }

      target.replaceChildren(...children);
      return header;
    },
  };
}
