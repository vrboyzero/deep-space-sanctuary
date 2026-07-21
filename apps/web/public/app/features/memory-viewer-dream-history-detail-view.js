function appendTextElement(ownerDocument, parent, tagName, className, text) {
  const element = ownerDocument.createElement(tagName);
  element.className = className;
  element.textContent = String(text ?? "");
  parent.append(element);
  return element;
}

function appendDetailCard(ownerDocument, parent, label, value) {
  const card = ownerDocument.createElement("div");
  card.className = "memory-detail-card";
  appendTextElement(ownerDocument, card, "span", "memory-detail-label", label);
  appendTextElement(ownerDocument, card, "div", "memory-detail-text", value);
  parent.append(card);
  return card;
}

function appendActionButton(ownerDocument, parent, action, label) {
  const button = ownerDocument.createElement("button");
  button.className = "memory-usage-action-btn";
  button.setAttribute("data-dream-consolidation-action", action);
  button.textContent = String(label ?? "");
  parent.append(button);
}

export function createMemoryViewerDreamHistoryDetailView() {
  return {
    render({ container, detail = {}, labels = {} } = {}) {
      if (!container) return;
      const ownerDocument = container.ownerDocument ?? document;
      const shell = ownerDocument.createElement("div");
      shell.className = "memory-detail-shell";

      const header = ownerDocument.createElement("div");
      header.className = "memory-detail-header";
      const headerBody = ownerDocument.createElement("div");
      appendTextElement(ownerDocument, headerBody, "div", "memory-detail-title", detail.title);
      if (detail.summary) {
        appendTextElement(ownerDocument, headerBody, "div", "memory-detail-text", detail.summary);
      }
      header.append(headerBody);
      shell.append(header);

      const grid = ownerDocument.createElement("div");
      grid.className = "memory-detail-grid";
      for (const card of Array.isArray(detail.cards) ? detail.cards : []) {
        appendDetailCard(ownerDocument, grid, card?.label, card?.value);
      }
      shell.append(grid);

      const actionEntries = [
        ["approve", detail.actions?.canApprove === true, labels.approve],
        ["reject", detail.actions?.canReject === true, labels.reject],
        ["apply", detail.actions?.canApply === true, labels.apply],
      ].filter(([, visible]) => visible);
      if (actionEntries.length > 0) {
        const actions = ownerDocument.createElement("div");
        actions.className = "goal-detail-actions";
        for (const [action, , label] of actionEntries) {
          appendActionButton(ownerDocument, actions, action, label);
        }
        shell.append(actions);
      }

      if (detail.reason) {
        appendDetailCard(ownerDocument, shell, labels.reason, detail.reason);
      }

      const contentCard = ownerDocument.createElement("div");
      contentCard.className = "memory-detail-card";
      appendTextElement(ownerDocument, contentCard, "span", "memory-detail-label", labels.content);
      if (detail.content) {
        appendTextElement(ownerDocument, contentCard, "pre", "memory-detail-pre", detail.content);
      } else {
        appendTextElement(ownerDocument, contentCard, "div", "memory-detail-text", detail.emptyText);
      }
      shell.append(contentCard);

      container.replaceChildren(shell);
    },
  };
}
