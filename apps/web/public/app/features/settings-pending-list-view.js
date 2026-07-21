export function createSettingsPendingListView({ ownerDocument, t, formatDateTime }) {
  function createElement(tagName) {
    return ownerDocument?.createElement?.(tagName) ?? null;
  }

  function setText(element, value) {
    if (element) element.textContent = String(value ?? "");
    return element;
  }

  function setAttribute(element, name, value) {
    if (element) element.setAttribute(name, String(value ?? ""));
    return element;
  }

  function append(parent, ...children) {
    if (!parent) return parent;
    for (const child of children) {
      if (child) parent.appendChild(child);
    }
    return parent;
  }

  function replaceChildren(container, children) {
    if (!container) return;
    if (typeof container.replaceChildren === "function") {
      container.replaceChildren(...children);
      return;
    }
    container.textContent = "";
    children.forEach((child) => container.appendChild(child));
  }

  function createEmptyState(message) {
    const empty = createElement("div");
    if (!empty) return null;
    empty.className = "memory-viewer-empty";
    return setText(empty, message);
  }

  function createMetaRow(values) {
    const meta = createElement("div");
    if (!meta) return null;
    meta.className = "memory-list-item-meta";
    return append(meta, ...values.map((value) => setText(createElement("span"), value)));
  }

  function createActionButton({ className, action, requestAttribute, requestValue, label }) {
    const button = createElement("button");
    if (!button) return null;
    button.className = `button ${className}`;
    setAttribute(button, "type", "button");
    setAttribute(button, action.name, action.value);
    setAttribute(button, requestAttribute, requestValue);
    return setText(button, label);
  }

  function createChannelSecurityCard(item) {
    const card = createElement("div");
    if (!card) return null;
    card.className = "memory-detail-card";
    const channel = `${item?.channel || ""}${item?.accountId ? `/${item.accountId}` : ""}:${item?.senderId || ""}`;
    const label = setText(createElement("span"), channel);
    if (label) label.className = "memory-detail-label";
    const detail = setText(createElement("div"), item?.senderName || "-");
    if (detail) detail.className = "memory-detail-text";
    const meta = createMetaRow([
      item?.chatId || "-",
      formatDateTime(item?.updatedAt || item?.requestedAt),
      `seen ${Number(item?.seenCount || 0)}`,
    ]);
    const children = [label, detail, meta];
    if (item?.messagePreview) {
      const snippet = setText(createElement("div"), item.messagePreview);
      if (snippet) snippet.className = "memory-list-item-snippet";
      children.push(snippet);
    }
    const actions = createElement("div");
    if (actions) actions.className = "goal-detail-actions goal-checkpoint-actions";
    append(
      actions,
      createActionButton({
        className: "goal-inline-action",
        action: { name: "data-channel-security-action", value: "approve" },
        requestAttribute: "data-channel-security-request-id",
        requestValue: item?.id,
        label: t("settings.channelSecurityApprove", {}, "批准"),
      }),
      createActionButton({
        className: "goal-inline-action-secondary",
        action: { name: "data-channel-security-action", value: "reject" },
        requestAttribute: "data-channel-security-request-id",
        requestValue: item?.id,
        label: t("settings.channelSecurityReject", {}, "拒绝"),
      }),
    );
    children.push(actions);
    return append(card, ...children);
  }

  function createPairingCard(item) {
    const card = createElement("div");
    if (!card) return null;
    card.className = "memory-detail-card";
    const label = setText(createElement("span"), `Pairing Code: ${item?.code || "-"}`);
    if (label) label.className = "memory-detail-label";
    const detail = setText(
      createElement("div"),
      item?.message || t("settings.pairingPendingDefaultMessage", {}, "当前 WebChat 会话需要完成配对批准。"),
    );
    if (detail) detail.className = "memory-detail-text";
    const meta = createMetaRow([
      item?.clientId || "-",
      formatDateTime(item?.updatedAt),
    ]);
    const actions = createElement("div");
    if (actions) actions.className = "goal-detail-actions goal-checkpoint-actions";
    append(actions, createActionButton({
      className: "goal-inline-action",
      action: { name: "data-pairing-action", value: "approve" },
      requestAttribute: "data-pairing-code",
      requestValue: item?.code,
      label: t("settings.pairingApprove", {}, "批准"),
    }));
    return append(card, label, detail, meta, actions);
  }

  function renderChannelSecurityPending(container, pending = []) {
    if (!container) return;
    const items = Array.isArray(pending) ? pending : [];
    const children = items.length === 0
      ? [createEmptyState(t("settings.channelSecurityPendingEmpty", {}, "当前没有待审批 sender。"))]
      : items.map(createChannelSecurityCard).filter(Boolean);
    replaceChildren(container, children.filter(Boolean));
  }

  function renderPairingPending(container, pending = []) {
    if (!container) return;
    const items = Array.isArray(pending) ? pending : [];
    const children = items.length === 0
      ? [createEmptyState(t("settings.pairingPendingEmpty", {}, "当前没有待批准的配对码。"))]
      : items.map(createPairingCard).filter(Boolean);
    replaceChildren(container, children.filter(Boolean));
  }

  return {
    renderChannelSecurityPending,
    renderPairingPending,
  };
}
