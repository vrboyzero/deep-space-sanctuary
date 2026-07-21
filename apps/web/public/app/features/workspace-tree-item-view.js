function createTreeItemContent(ownerDocument, name) {
  const icon = ownerDocument.createElement("span");
  icon.className = "tree-item-icon";
  const label = ownerDocument.createElement("span");
  label.className = "tree-item-name";
  label.textContent = String(name ?? "");
  return [icon, label];
}

export function createWorkspaceTreeItemView({ ownerDocument }) {
  return {
    createDirectory(item, { expanded = false } = {}) {
      const element = ownerDocument.createElement("div");
      element.className = `tree-folder${expanded ? " expanded" : ""}`;

      const trigger = ownerDocument.createElement("div");
      trigger.className = "tree-item";
      trigger.append(...createTreeItemContent(ownerDocument, item?.name));

      const children = ownerDocument.createElement("div");
      children.className = "tree-children";
      element.append(trigger, children);
      return { element, trigger, children };
    },

    createFile(item, { active = false } = {}) {
      const element = ownerDocument.createElement("div");
      element.className = "tree-file";

      const trigger = ownerDocument.createElement("div");
      trigger.className = `tree-item${active ? " active" : ""}`;
      trigger.append(...createTreeItemContent(ownerDocument, item?.name));
      element.append(trigger);
      return { element, trigger };
    },
  };
}
