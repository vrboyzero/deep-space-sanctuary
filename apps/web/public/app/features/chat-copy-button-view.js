const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export function createChatCopyButtonView({ ownerDocument, t }) {
  return {
    render(button) {
      if (!button) return;
      const icon = ownerDocument.createElementNS(SVG_NAMESPACE, "svg");
      icon.setAttribute("width", "14");
      icon.setAttribute("height", "14");
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("fill", "none");
      icon.setAttribute("stroke", "currentColor");
      icon.setAttribute("stroke-width", "2");
      icon.setAttribute("stroke-linecap", "round");
      icon.setAttribute("stroke-linejoin", "round");

      const rect = ownerDocument.createElementNS(SVG_NAMESPACE, "rect");
      rect.setAttribute("x", "9");
      rect.setAttribute("y", "9");
      rect.setAttribute("width", "13");
      rect.setAttribute("height", "13");
      rect.setAttribute("rx", "2");
      rect.setAttribute("ry", "2");

      const path = ownerDocument.createElementNS(SVG_NAMESPACE, "path");
      path.setAttribute("d", "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1");
      icon.append(rect, path);

      const label = ownerDocument.createElement("span");
      label.textContent = t("chat.copy", {}, "Copy");

      button.className = "copy-msg-btn";
      button.title = t("chat.copyFullTitle", {}, "Copy full message");
      if (typeof button.replaceChildren === "function") {
        button.replaceChildren(icon, label);
      } else {
        button.textContent = "";
        button.append(icon, label);
      }
    },
  };
}
