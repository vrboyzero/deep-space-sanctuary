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

function getMethodOpenPath(method) {
  if (typeof method.path === "string" && method.path.trim()) return method.path.trim();
  return method.filename ? `methods/${method.filename}` : "";
}

export function createToolSettingsMethodsTabView({ ownerDocument, t }) {
  return {
    render(target, { methods, toolControlView }) {
      if (!target) return null;

      const header = createElement(ownerDocument, "div", "tool-section-header");
      header.append(
        createElement(ownerDocument, "span", "", t("toolSettings.sectionMethods", {}, "Methods")),
        createElement(
          ownerDocument,
          "span",
          "tool-section-count",
          t("toolSettings.totalCount", { total: methods.length }, `${methods.length} total`),
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

      children.push(createPolicyNote(ownerDocument, [
        t(
          "toolSettings.methodsReadonlyHint",
          {},
          "Methods is a system-level read-only index here. Review and open files from this list, but do not manage enable/disable state in this tab.",
        ),
      ]));

      for (const method of [...methods].sort((a, b) => String(a.filename || "").localeCompare(String(b.filename || ""), "zh-CN"))) {
        const displayTitle = method.title || method.filename || t("toolSettings.methodTitleMissing", {}, "未命名方法");
        const metaParts = [
          method.filename ? `${t("toolSettings.methodFileLabel", {}, "文件")}: ${method.filename}` : "",
          method.status ? `${t("toolSettings.methodStatusLabel", {}, "状态")}: ${method.status}` : "",
        ].filter(Boolean);
        const row = createElement(ownerDocument, "div", "tool-item method-item");
        const info = createElement(ownerDocument, "div", "skill-item-info");
        info.appendChild(createElement(ownerDocument, "span", "tool-item-name", displayTitle));
        if (metaParts.length > 0) info.appendChild(createElement(ownerDocument, "span", "skill-meta", metaParts.join(" · ")));
        info.appendChild(createElement(
          ownerDocument,
          "span",
          "skill-desc",
          method.summary || t("toolSettings.methodSummaryMissing", {}, "暂无摘要"),
        ));
        row.appendChild(info);

        const openPath = getMethodOpenPath(method);
        if (openPath) {
          const actions = createElement(ownerDocument, "div", "tool-item-actions");
          const openButton = createElement(ownerDocument, "button", "button tool-inline-action", t("toolSettings.methodOpen", {}, "打开文件"));
          openButton.setAttribute("type", "button");
          openButton.setAttribute("data-method-path", openPath);
          actions.appendChild(openButton);
          row.appendChild(actions);
        }
        children.push(row);
      }

      target.replaceChildren(...children);
      return header;
    },
  };
}
