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

function appendContractDetails(ownerDocument, info, contract) {
  if (!contract) return;

  if (contract.description) {
    info.appendChild(createElement(ownerDocument, "span", "tool-contract-desc", contract.description));
  }
  const badges = createElement(ownerDocument, "div", "tool-contract-badges");
  badges.append(...contract.badges.map((badge) => createElement(
    ownerDocument,
    "span",
    `tool-contract-badge${badge.className ? ` ${badge.className}` : ""}`,
    badge.label,
  )));
  info.appendChild(badges);
  info.appendChild(createElement(ownerDocument, "span", "tool-contract-meta", contract.meta));
}

function createWorkflowCapabilitySummary(ownerDocument, workflowCapabilityView) {
  if (!workflowCapabilityView) return null;

  const note = createElement(ownerDocument, "div", "tool-settings-policy-note");
  const statusLine = ownerDocument.createElement("div");
  statusLine.append(
    createElement(ownerDocument, "strong", "", workflowCapabilityView.title),
    ownerDocument.createTextNode(" · "),
    ownerDocument.createTextNode(text(workflowCapabilityView.status)),
  );
  note.append(
    statusLine,
    createElement(ownerDocument, "div", "", workflowCapabilityView.reason),
  );
  return note;
}

function createToggle(ownerDocument, name, checked) {
  const toggle = createElement(ownerDocument, "label", "toggle-switch");
  const checkbox = ownerDocument.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = checked;
  checkbox.setAttribute("data-category", "builtin");
  checkbox.setAttribute("data-name", text(name));
  toggle.append(checkbox, createElement(ownerDocument, "span", "toggle-slider"));
  return toggle;
}

function compareToolNames(left, right) {
  return text(left.name).localeCompare(text(right.name));
}

export function createToolSettingsBuiltinTabView({ ownerDocument, t }) {
  return {
    render(target, { tools, enabledCount, toolControlView, workflowCapabilityView }) {
      if (!target) return null;

      const header = createElement(ownerDocument, "div", "tool-section-header");
      header.append(
        createElement(ownerDocument, "span", "", t("toolSettings.sectionBuiltin", {}, "Built-in Tools")),
        createElement(
          ownerDocument,
          "span",
          "tool-section-count",
          t(
            "toolSettings.enabledCount",
            { enabled: enabledCount, total: tools.length },
            `${enabledCount}/${tools.length} enabled`,
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
      const workflowSummary = createWorkflowCapabilitySummary(ownerDocument, workflowCapabilityView);
      if (workflowSummary) children.push(workflowSummary);

      for (const tool of [...tools].sort(compareToolNames)) {
        const row = createElement(
          ownerDocument,
          "div",
          `tool-item${tool.checked ? "" : " disabled"}${tool.visibility && !tool.visibility.available ? " unavailable" : ""}`,
        );
        const info = createElement(ownerDocument, "div", "tool-item-info");
        info.appendChild(createElement(ownerDocument, "span", "tool-item-name", tool.name));
        appendContractDetails(ownerDocument, info, tool.contract);
        appendVisibilitySummary(ownerDocument, info, tool.visibility);
        row.append(info, createToggle(ownerDocument, tool.name, tool.checked));
        children.push(row);
      }

      target.replaceChildren(...children);
      return header;
    },
  };
}
