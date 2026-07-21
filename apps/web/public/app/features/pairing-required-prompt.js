function applyStyles(element, styles) {
  Object.assign(element.style, styles);
}

function createTextElement(tagName, text, className = "") {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

export function renderPairingRequiredFallback(target, {
  code = "",
  t = (_key, _params, fallback) => fallback ?? "",
} = {}) {
  if (!target) return;
  const pairingCode = typeof code === "string" ? code : String(code ?? "");
  const card = document.createElement("div");
  card.style.lineHeight = "1.6";
  card.appendChild(createTextElement(
    "div",
    t("settings.pairingPendingDefaultMessage", {}, "The current WebChat session still needs pairing approval."),
  ));

  const codeRow = document.createElement("div");
  codeRow.style.marginTop = "8px";
  codeRow.append(`${t("runtime.pairingCodeLabel", {}, "Pairing code")}：`);
  codeRow.appendChild(createTextElement("b", pairingCode || "-"));
  card.appendChild(codeRow);

  const command = createTextElement(
    "div",
    `corepack pnpm bdd pairing approve ${pairingCode}`,
  );
  applyStyles(command, {
    background: "var(--bg-secondary)",
    borderRadius: "4px",
    fontFamily: "monospace",
    margin: "8px 0",
    padding: "8px",
  });
  card.appendChild(command);

  const hint = createTextElement(
    "div",
    t("runtime.pairingCliHint", {}, "If the inline approval button is unavailable, run this command in a new terminal and then resend your message here."),
  );
  applyStyles(hint, {
    color: "var(--text-secondary)",
    fontSize: "12px",
  });
  card.appendChild(hint);
  target.replaceChildren(card);
}

export function createPairingRequiredPromptRenderer({
  t = (_key, _params, fallback) => fallback ?? "",
  openPairingPending,
  approvePairing,
  showNotice,
} = {}) {
  return function renderPairingRequiredPrompt(target, payload = {}) {
    if (!target) return;
    const code = typeof payload.code === "string" ? payload.code.trim().toUpperCase() : "";
    const message = typeof payload.message === "string" && payload.message.trim()
      ? payload.message.trim()
      : t("settings.pairingPendingDefaultMessage", {}, "The current WebChat session still needs pairing approval.");
    const clientId = typeof payload.clientId === "string" ? payload.clientId.trim() : "";

    const card = document.createElement("div");
    card.className = "pairing-required-card";
    card.style.lineHeight = "1.6";
    card.appendChild(createTextElement("div", message));

    const codeRow = document.createElement("div");
    codeRow.style.marginTop = "8px";
    codeRow.append(`${t("runtime.pairingCodeLabel", {}, "Pairing code")}：`);
    codeRow.appendChild(createTextElement("b", code || "-"));
    card.appendChild(codeRow);

    const actions = document.createElement("div");
    applyStyles(actions, {
      alignItems: "center",
      display: "flex",
      flexWrap: "wrap",
      gap: "8px",
      marginTop: "10px",
    });
    const approveButton = createTextElement(
      "button",
      t("settings.pairingApprove", {}, "Approve"),
      "btn pairing-approve-btn",
    );
    approveButton.type = "button";
    const openSettingsButton = createTextElement(
      "button",
      t("settings.title", {}, "Settings"),
      "btn pairing-open-settings-btn",
    );
    openSettingsButton.type = "button";
    const statusElement = createTextElement("span", "", "pairing-status-text");
    applyStyles(statusElement, {
      color: "var(--text-secondary)",
      fontSize: "12px",
    });
    actions.append(approveButton, openSettingsButton, statusElement);
    card.appendChild(actions);

    const hint = document.createElement("div");
    applyStyles(hint, {
      color: "var(--text-secondary)",
      fontSize: "12px",
      marginTop: "10px",
    });
    hint.append(`${t("runtime.pairingCliHint", {}, "If the inline approval button is unavailable, use the CLI fallback below and then resend your message here.")} `);
    hint.appendChild(createTextElement("code", `bdd pairing approve ${code || "<CODE>"}`));
    card.appendChild(hint);

    if (clientId) {
      const clientRow = document.createElement("div");
      applyStyles(clientRow, {
        color: "var(--text-secondary)",
        fontSize: "12px",
        marginTop: "6px",
      });
      clientRow.append("clientId: ");
      clientRow.appendChild(createTextElement("code", clientId));
      card.appendChild(clientRow);
    }

    target.replaceChildren(card);
    openSettingsButton.addEventListener("click", () => {
      void openPairingPending?.();
    });
    approveButton.addEventListener("click", async () => {
      if (!code) {
        statusElement.textContent = t("settings.pairingCodeMissing", {}, "Pairing code is required.");
        return;
      }
      approveButton.disabled = true;
      openSettingsButton.disabled = true;
      statusElement.textContent = t("settings.pairingProcessing", {}, "Processing...");
      const approved = typeof approvePairing === "function"
        ? await approvePairing(code)
        : { ok: false, message: t("settings.pairingApproveFailedFallback", {}, "Pairing approval failed.") };
      if (!approved?.ok) {
        statusElement.textContent = approved?.message || t("settings.pairingApproveFailedFallback", {}, "Pairing approval failed.");
        approveButton.disabled = false;
        openSettingsButton.disabled = false;
        return;
      }
      statusElement.textContent = t("runtime.pairingApprovedResend", {}, "Pairing approved. You can resend your message now.");
      approveButton.textContent = t("runtime.pairingApprovedButton", {}, "Approved");
      showNotice?.(
        t("settings.pairingApprovedTitle", {}, "Pairing approved"),
        t("settings.pairingApprovedMessage", { code }, "Pairing code {code} was approved. You can continue in the current WebChat session."),
        "success",
        3200,
      );
    }, { once: true });
  };
}
