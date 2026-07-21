const DOCTOR_TOGGLE_STATES = Object.freeze({
  checking: {
    className: "button button-muted badge",
    key: "settings.doctorChecking",
    fallback: "检查中...",
  },
  disconnected: {
    className: "button badge fail",
    key: "settings.doctorDisconnected",
    fallback: "Disconnected",
  },
  failed: {
    className: "button badge fail",
    key: "settings.doctorCheckFailed",
    fallback: "Check Failed",
  },
});

export function createSettingsDoctorToggleView({ ownerDocument, t }) {
  return {
    render(button, state) {
      if (!button) return;
      const config = DOCTOR_TOGGLE_STATES[state];
      if (!config) return;

      const label = ownerDocument.createElement("span");
      label.setAttribute("data-i18n", config.key);
      label.textContent = t(config.key, {}, config.fallback);

      button.className = config.className;
      if (typeof button.replaceChildren === "function") {
        button.replaceChildren(label);
      } else {
        button.textContent = "";
        button.appendChild(label);
      }
    },
  };
}
