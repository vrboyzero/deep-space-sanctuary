import { setRuntimeStyles } from "./runtime-style-registry.js";

const NODE_ICONS = {
  task: "\u2611", note: "\u270E", method: "\uD83D\uDCCB",
  knowledge: "\uD83D\uDCA1", "agent-output": "\uD83E\uDD16",
  screenshot: "\uD83D\uDDBC", session: "\uD83D\uDCAC", group: "\uD83D\uDCC1",
};

function text(value) {
  return String(value ?? "");
}

function matchesGoalNode(node, activeGoalNodeId) {
  const normalizedGoalNodeId = typeof activeGoalNodeId === "string" ? activeGoalNodeId.trim() : "";
  if (!normalizedGoalNodeId || !node || typeof node !== "object") return false;
  const data = node.data && typeof node.data === "object" ? node.data : {};
  const candidates = [
    node.id,
    data.nodeId,
    data.goalNodeId,
    data.taskNodeId,
    data.ref && typeof data.ref === "object" ? data.ref.id : "",
  ];
  return candidates.some((value) => typeof value === "string" && value.trim() === normalizedGoalNodeId);
}

function appendPort(ownerDocument, root, side) {
  const port = ownerDocument.createElement("div");
  port.className = `node-port node-port-${side}`;
  port.setAttribute("data-port", side);
  root.appendChild(port);
}

export function getCanvasNodeIcon(type, fallback = "\u25A0") {
  return NODE_ICONS[type] || fallback;
}

export function createCanvasNodeContentView({ ownerDocument }) {
  return {
    render(body, node, { activeGoalNodeId, activeNodeTitle } = {}) {
      if (!body) return null;

      const data = node.data;
      const isGoalActive = matchesGoalNode(node, activeGoalNodeId);
      const root = ownerDocument.createElement("div");
      root.className = `canvas-node node-${node.type}${data.status ? ` node-status-${data.status}` : ""}${isGoalActive ? " goal-active" : ""}${Array.isArray(data.tags) && data.tags.includes("running") ? " react-running" : ""}`;
      root.setAttribute("data-node-id", node.id);
      if (data.color) setRuntimeStyles(root, { "border-left-color": text(data.color) });

      const header = ownerDocument.createElement("div");
      header.className = "node-header";
      const icon = ownerDocument.createElement("span");
      icon.className = "node-type-icon";
      icon.textContent = getCanvasNodeIcon(node.type);
      header.appendChild(icon);

      if (node.type === "task") {
        const statusDot = ownerDocument.createElement("span");
        statusDot.className = "node-status-dot";
        header.appendChild(statusDot);
      }

      const title = ownerDocument.createElement("span");
      title.className = "node-title";
      title.textContent = text(data.title);
      header.appendChild(title);

      if (isGoalActive) {
        const activeBadge = ownerDocument.createElement("span");
        activeBadge.className = "node-active-badge";
        activeBadge.setAttribute("title", text(activeNodeTitle));
        activeBadge.textContent = "ACTIVE";
        header.appendChild(activeBadge);
      }

      if (data.ref) {
        const refBadge = ownerDocument.createElement("span");
        refBadge.className = "node-ref-badge";
        refBadge.setAttribute("title", `${text(data.ref.type)}: ${text(data.ref.id)}`);
        refBadge.textContent = "\u{1F517}";
        header.appendChild(refBadge);
      }

      root.appendChild(header);

      if (node.type === "screenshot" && data.imageUrl) {
        const image = ownerDocument.createElement("img");
        image.className = "node-screenshot-img";
        image.setAttribute("src", text(data.imageUrl));
        image.setAttribute("alt", "screenshot");
        root.appendChild(image);
      } else if (!data.collapsed && data.content) {
        const content = data.content.length > 200 ? `${data.content.slice(0, 200)}\u2026` : data.content;
        const nodeBody = ownerDocument.createElement("div");
        nodeBody.className = "node-body";
        nodeBody.textContent = text(content);
        root.appendChild(nodeBody);
      }

      if (data.tags && data.tags.length) {
        const tags = ownerDocument.createElement("div");
        tags.className = "node-tags";
        const tagElements = data.tags.map((tag) => {
          const tagElement = ownerDocument.createElement("span");
          tagElement.className = "node-tag";
          tagElement.setAttribute("data-tag", text(tag));
          tagElement.textContent = text(tag);
          return tagElement;
        });
        tags.append(...tagElements);
        root.appendChild(tags);
      }

      appendPort(ownerDocument, root, "top");
      appendPort(ownerDocument, root, "bottom");
      appendPort(ownerDocument, root, "left");
      appendPort(ownerDocument, root, "right");

      body.replaceChildren(root);
      return root;
    },
  };
}
