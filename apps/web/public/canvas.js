/**
 * Canvas 可视化工作区 — 前端引擎
 *
 * 模块:
 *   BoardManager   — 数据管理 (CRUD, undo/redo, dirty, dagre layout)
 *   CanvasRenderer — SVG 渲染 (nodes, edges, viewport transform)
 *   CanvasApp      — 顶层控制器 (toolbar, WS bridge, lifecycle)
 *
 * 依赖: 本地 hash manifest 装载的 dagre.js（global `dagre`）
 * 约束: vanilla JS, zero build step, ESM module
 */

import { awaitWebAssetsReady } from "./app/bootstrap/web-assets.js";
import { createCanvasBoardItemView } from "./app/features/canvas-board-item-view.js";
import { createCanvasBoardListHeaderTitleView } from "./app/features/canvas-board-list-header-title-view.js";
import { createCanvasNodeContentView, getCanvasNodeIcon } from "./app/features/canvas-node-content-view.js";
import { createCanvasNodeEditDialogView } from "./app/features/canvas-node-edit-dialog-view.js";
import { createCanvasResourcePickerDialogView } from "./app/features/canvas-resource-picker-dialog-view.js";
import { createCanvasResourcePickerItemView } from "./app/features/canvas-resource-picker-item-view.js";
import { createCanvasResourcePickerEmptyView } from "./app/features/canvas-resource-picker-empty-view.js";

await awaitWebAssetsReady();

const canvasBoardItemView = createCanvasBoardItemView({ ownerDocument: document });
const canvasBoardListHeaderTitleView = createCanvasBoardListHeaderTitleView({ ownerDocument: document });
const canvasNodeContentView = createCanvasNodeContentView({ ownerDocument: document });
const canvasNodeEditDialogView = createCanvasNodeEditDialogView({ ownerDocument: document });
const canvasResourcePickerDialogView = createCanvasResourcePickerDialogView({ ownerDocument: document });
const canvasResourcePickerItemView = createCanvasResourcePickerItemView({ ownerDocument: document });
const canvasResourcePickerEmptyView = createCanvasResourcePickerEmptyView({ ownerDocument: document });

// ─── Helpers ─────────────────────────────────────────────────

function cvId() {
  return Math.random().toString(36).slice(2, 10);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function interpolate(template, params = {}) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) => {
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      return String(params[key]);
    }
    return `{${key}}`;
  });
}

function t(key, params = {}, fallback = key) {
  if (typeof window._belldandyT === "function") {
    return window._belldandyT(key, params, fallback);
  }
  return interpolate(fallback, params);
}

// ─── Node Templates ──────────────────────────────────────────

const DEFAULT_SIZE = {
  task: [220, 120], note: [240, 140], method: [220, 100],
  knowledge: [220, 120], "agent-output": [280, 160],
  screenshot: [320, 240], session: [200, 80], group: [400, 300],
};

// ─── BoardManager ────────────────────────────────────────────

class BoardManager {
  constructor() {
    /** @type {object|null} */
    this.board = null;
    this.dirty = false;
    this._undoStack = [];
    this._redoStack = [];
  }

  /** Load board data (from JSON object) */
  load(boardData) {
    this.board = boardData;
    this.dirty = false;
    this._undoStack = [];
    this._redoStack = [];
  }

  /** Create a new empty board */
  createEmpty(name) {
    const id = cvId();
    const now = new Date().toISOString();
    this.board = {
      version: 1, id, name: name || t("canvas.unnamedBoard", {}, "Untitled Board"),
      createdAt: now, updatedAt: now,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: {}, edges: {},
    };
    this.dirty = true;
    return this.board;
  }

  _snapshot() {
    if (!this.board) return;
    this._undoStack.push(JSON.stringify(this.board));
    if (this._undoStack.length > 50) this._undoStack.shift();
    this._redoStack = [];
  }

  undo() {
    if (!this._undoStack.length || !this.board) return false;
    this._redoStack.push(JSON.stringify(this.board));
    this.board = JSON.parse(this._undoStack.pop());
    this.dirty = true;
    return true;
  }

  redo() {
    if (!this._redoStack.length || !this.board) return false;
    this._undoStack.push(JSON.stringify(this.board));
    this.board = JSON.parse(this._redoStack.pop());
    this.dirty = true;
    return true;
  }

  addNode(type, title, opts = {}) {
    if (!this.board) return null;
    this._snapshot();
    const id = cvId();
    const [w, h] = DEFAULT_SIZE[type] || [220, 120];
    const existing = Object.values(this.board.nodes);
    const x = existing.length > 0
      ? Math.max(...existing.map(n => n.x + n.width)) + 40
      : 40;
    const y = existing.length > 0 ? existing[existing.length - 1].y : 40;

    const node = {
      id, type, x, y, width: w, height: h, pinned: false,
      data: { title, ...opts },
    };
    this.board.nodes[id] = node;
    this.dirty = true;
    return node;
  }

  updateNode(nodeId, updates) {
    if (!this.board || !this.board.nodes[nodeId]) return false;
    this._snapshot();
    Object.assign(this.board.nodes[nodeId].data, updates);
    this.dirty = true;
    return true;
  }

  moveNode(nodeId, x, y) {
    const node = this.board?.nodes[nodeId];
    if (!node) return;
    node.x = x;
    node.y = y;
    node.pinned = true;
    this.dirty = true;
  }

  removeNode(nodeId) {
    if (!this.board || !this.board.nodes[nodeId]) return;
    this._snapshot();
    delete this.board.nodes[nodeId];
    for (const [eid, e] of Object.entries(this.board.edges)) {
      if (e.from === nodeId || e.to === nodeId) delete this.board.edges[eid];
    }
    this.dirty = true;
  }

  addEdge(fromId, toId, opts = {}) {
    if (!this.board) return null;
    if (fromId === toId) return null;
    if (!this.board.nodes[fromId] || !this.board.nodes[toId]) return null;
    const dup = Object.values(this.board.edges).find(e => e.from === fromId && e.to === toId);
    if (dup) return null;
    this._snapshot();
    const id = cvId();
    const edge = { id, from: fromId, to: toId, ...opts };
    this.board.edges[id] = edge;
    this.dirty = true;
    return edge;
  }

  removeEdge(edgeId) {
    if (!this.board || !this.board.edges[edgeId]) return;
    this._snapshot();
    delete this.board.edges[edgeId];
    this.dirty = true;
  }

  /** dagre auto-layout (requires global `dagre`) */
  autoLayout(direction = "TB") {
    if (!this.board || typeof dagre === "undefined") return;
    this._snapshot();
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: direction, nodesep: 60, ranksep: 80, marginx: 40, marginy: 40 });
    g.setDefaultEdgeLabel(() => ({}));

    const nodes = Object.values(this.board.nodes);
    for (const n of nodes) {
      g.setNode(n.id, { width: n.width, height: n.height });
    }
    for (const e of Object.values(this.board.edges)) {
      if (this.board.nodes[e.from] && this.board.nodes[e.to]) {
        g.setEdge(e.from, e.to);
      }
    }

    dagre.layout(g);

    for (const n of nodes) {
      if (n.pinned) continue;
      const laid = g.node(n.id);
      if (laid) {
        n.x = laid.x - laid.width / 2;
        n.y = laid.y - laid.height / 2;
      }
    }
    this.dirty = true;
  }

  toJSON() {
    if (!this.board) return null;
    this.board.updatedAt = new Date().toISOString();
    return JSON.stringify(this.board, null, 2);
  }
}

// ─── CanvasRenderer ──────────────────────────────────────────

const SVG_NS = "http://www.w3.org/2000/svg";
const XHTML_NS = "http://www.w3.org/1999/xhtml";
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3;

class CanvasRenderer {
  constructor(svgEl, viewportEl, nodesLayer, edgesLayer) {
    this.svg = svgEl;
    this.viewport = viewportEl;
    this.nodesLayer = nodesLayer;
    this.edgesLayer = edgesLayer;

    // viewport transform state
    this.panX = 0;
    this.panY = 0;
    this.zoom = 1;

    // interaction state
    this.selectedNodeId = null;
    this.selectedEdgeId = null;
    this.activeGoalNodeId = null;
    this._dragState = null;   // { nodeId, startX, startY, origX, origY }
    this._panState = null;    // { startX, startY, origPanX, origPanY }
    this._connectState = null; // { fromNodeId, fromPort, tempLine }

    // callbacks (set by CanvasApp)
    this.onNodeMoved = null;      // (nodeId, x, y)
    this.onNodeSelected = null;   // (nodeId | null)
    this.onEdgeSelected = null;   // (edgeId | null)
    this.onEdgeCreated = null;    // (fromId, toId)
    this.onNodeDoubleClick = null; // (nodeId)
    this.onCanvasContextMenu = null; // (x, y)
    this.onNodeContextMenu = null;   // (nodeId, x, y)

    this._initInteraction();
  }

  // ── Viewport ──

  setTransform(px, py, z) {
    this.panX = px;
    this.panY = py;
    this.zoom = clamp(z, MIN_ZOOM, MAX_ZOOM);
    this.viewport.setAttribute("transform", `translate(${this.panX},${this.panY}) scale(${this.zoom})`);
  }

  applyZoom(delta, cx, cy) {
    const factor = delta > 0 ? 0.9 : 1.1;
    const newZoom = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    // zoom toward cursor
    const scale = newZoom / this.zoom;
    const newPanX = cx - (cx - this.panX) * scale;
    const newPanY = cy - (cy - this.panY) * scale;
    this.setTransform(newPanX, newPanY, newZoom);
  }

  fitView(board) {
    if (!board || !Object.keys(board.nodes).length) return;
    const nodes = Object.values(board.nodes);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    }
    const pad = 60;
    const rect = this.svg.getBoundingClientRect();
    const svgW = rect.width || 800;
    const svgH = rect.height || 600;
    const contentW = maxX - minX + pad * 2;
    const contentH = maxY - minY + pad * 2;
    const z = clamp(Math.min(svgW / contentW, svgH / contentH), MIN_ZOOM, MAX_ZOOM);
    const px = (svgW - contentW * z) / 2 - (minX - pad) * z;
    const py = (svgH - contentH * z) / 2 - (minY - pad) * z;
    this.setTransform(px, py, z);
  }

  screenToCanvas(sx, sy) {
    return {
      x: (sx - this.panX) / this.zoom,
      y: (sy - this.panY) / this.zoom,
    };
  }

  // ── Render ──

  renderAll(board) {
    this.nodesLayer.innerHTML = "";
    this.edgesLayer.innerHTML = "";
    if (!board) return;

    // edges first (below nodes)
    for (const edge of Object.values(board.edges)) {
      this._renderEdge(edge, board);
    }
    // nodes
    for (const node of Object.values(board.nodes)) {
      this._renderNode(node);
    }
  }

  _renderNode(node) {
    const fo = document.createElementNS(SVG_NS, "foreignObject");
    fo.setAttribute("x", node.x);
    fo.setAttribute("y", node.y);
    fo.setAttribute("width", node.width);
    fo.setAttribute("height", node.height);
    fo.setAttribute("data-node-id", node.id);
    fo.style.overflow = "visible";

    const body = document.createElementNS(XHTML_NS, "div");
    body.setAttribute("xmlns", XHTML_NS);
    body.style.position = "relative";
    body.style.width = node.width + "px";
    body.style.height = node.height + "px";
    canvasNodeContentView.render(body, node, {
      activeGoalNodeId: this.activeGoalNodeId,
      activeNodeTitle: t("canvas.activeNodeTitle", {}, "Current activeNode"),
    });

    fo.appendChild(body);
    this.nodesLayer.appendChild(fo);

    if (node.id === this.selectedNodeId) {
      const inner = body.querySelector(".canvas-node");
      if (inner) inner.classList.add("selected");
    }
  }

  _renderEdge(edge, board) {
    const fromNode = board.nodes[edge.from];
    const toNode = board.nodes[edge.to];
    if (!fromNode || !toNode) return;

    const from = this._portPos(fromNode, edge.fromPort || "bottom");
    const to = this._portPos(toNode, edge.toPort || "top");

    const dx = Math.abs(to.x - from.x) * 0.4;
    const dy = Math.abs(to.y - from.y) * 0.5;
    const d = `M ${from.x} ${from.y} C ${from.x + dx} ${from.y + dy}, ${to.x - dx} ${to.y - dy}, ${to.x} ${to.y}`;

    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("data-edge-id", edge.id);
    path.setAttribute("marker-end", "url(#cv-arrowhead)");

    let cls = "canvas-edge";
    if (edge.style === "dashed") cls += " edge-dashed";
    else if (edge.style === "dotted") cls += " edge-dotted";
    if (edge.id === this.selectedEdgeId) cls += " selected";
    path.setAttribute("class", cls);

    // hit area (wider invisible path for easier clicking)
    const hit = document.createElementNS(SVG_NS, "path");
    hit.setAttribute("d", d);
    hit.setAttribute("data-edge-id", edge.id);
    hit.setAttribute("class", "canvas-edge-hit");
    hit.style.fill = "none";
    hit.style.stroke = "transparent";
    hit.style.strokeWidth = "12";
    hit.style.cursor = "pointer";

    this.edgesLayer.appendChild(path);
    this.edgesLayer.appendChild(hit);

    // label
    if (edge.label) {
      const mx = (from.x + to.x) / 2;
      const my = (from.y + to.y) / 2;
      const text = document.createElementNS(SVG_NS, "text");
      text.setAttribute("x", mx);
      text.setAttribute("y", my - 6);
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("class", "canvas-edge-label");
      text.textContent = edge.label;
      this.edgesLayer.appendChild(text);
    }
  }

  _portPos(node, port) {
    switch (port) {
      case "top":    return { x: node.x + node.width / 2, y: node.y };
      case "bottom": return { x: node.x + node.width / 2, y: node.y + node.height };
      case "left":   return { x: node.x, y: node.y + node.height / 2 };
      case "right":  return { x: node.x + node.width, y: node.y + node.height / 2 };
      default:       return { x: node.x + node.width / 2, y: node.y + node.height };
    }
  }

  // ── Update single elements (for incremental updates) ──

  updateNodePosition(nodeId, x, y) {
    const fo = this.nodesLayer.querySelector(`foreignObject[data-node-id="${nodeId}"]`);
    if (fo) {
      fo.setAttribute("x", x);
      fo.setAttribute("y", y);
    }
  }

  // ── Interaction ──

  _initInteraction() {
    const svg = this.svg;

    // Wheel zoom
    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      this.applyZoom(e.deltaY, cx, cy);
    }, { passive: false });

    // Mouse events
    svg.addEventListener("mousedown", (e) => this._onMouseDown(e));
    svg.addEventListener("mousemove", (e) => this._onMouseMove(e));
    svg.addEventListener("mouseup", (e) => this._onMouseUp(e));
    svg.addEventListener("dblclick", (e) => this._onDblClick(e));
    svg.addEventListener("contextmenu", (e) => this._onContextMenu(e));
  }

  _findNodeId(el) {
    let cur = el;
    while (cur && cur !== this.svg) {
      if (cur.dataset && cur.dataset.nodeId) return cur.dataset.nodeId;
      if (cur.getAttribute && cur.getAttribute("data-node-id")) return cur.getAttribute("data-node-id");
      cur = cur.parentElement || cur.parentNode;
    }
    return null;
  }

  _findEdgeId(el) {
    let cur = el;
    while (cur && cur !== this.svg) {
      if (cur.dataset && cur.dataset.edgeId) return cur.dataset.edgeId;
      if (cur.getAttribute && cur.getAttribute("data-edge-id")) return cur.getAttribute("data-edge-id");
      cur = cur.parentElement || cur.parentNode;
    }
    return null;
  }

  _findPort(el) {
    let cur = el;
    while (cur && cur !== this.svg) {
      if (cur.classList && cur.classList.contains("node-port")) {
        const port = cur.dataset.port || cur.getAttribute("data-port");
        const nodeId = this._findNodeId(cur);
        return { nodeId, port };
      }
      cur = cur.parentElement || cur.parentNode;
    }
    return null;
  }

  _onMouseDown(e) {
    const rect = this.svg.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // Port drag → start connection
    const portInfo = this._findPort(e.target);
    if (portInfo && portInfo.nodeId) {
      e.preventDefault();
      this._connectState = { fromNodeId: portInfo.nodeId, fromPort: portInfo.port, tempLine: null };
      this.svg.classList.add("connecting");
      return;
    }

    // Node drag
    const nodeId = this._findNodeId(e.target);
    if (nodeId && e.button === 0) {
      e.preventDefault();
      const cp = this.screenToCanvas(sx, sy);
      this._dragState = { nodeId, startX: cp.x, startY: cp.y, origX: 0, origY: 0 };
      // select
      this.selectedNodeId = nodeId;
      this.selectedEdgeId = null;
      this.onNodeSelected?.(nodeId);
      return;
    }

    // Edge click
    const edgeId = this._findEdgeId(e.target);
    if (edgeId) {
      this.selectedEdgeId = edgeId;
      this.selectedNodeId = null;
      this.onEdgeSelected?.(edgeId);
      return;
    }

    // Pan (middle button or left on empty area)
    if (e.button === 1 || (e.button === 0 && !nodeId)) {
      e.preventDefault();
      this._panState = { startX: e.clientX, startY: e.clientY, origPanX: this.panX, origPanY: this.panY };
      this.svg.classList.add("panning");
      // deselect
      this.selectedNodeId = null;
      this.selectedEdgeId = null;
      this.onNodeSelected?.(null);
      this.onEdgeSelected?.(null);
    }
  }

  _onMouseMove(e) {
    const rect = this.svg.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // Connection drag
    if (this._connectState) {
      // TODO: draw temp line (deferred to Step 3 polish)
      return;
    }

    // Node drag
    if (this._dragState) {
      const cp = this.screenToCanvas(sx, sy);
      const dx = cp.x - this._dragState.startX;
      const dy = cp.y - this._dragState.startY;
      // We need the original node position — stored on first move
      if (!this._dragState._moved) {
        const fo = this.nodesLayer.querySelector(`foreignObject[data-node-id="${this._dragState.nodeId}"]`);
        if (fo) {
          this._dragState.origX = parseFloat(fo.getAttribute("x"));
          this._dragState.origY = parseFloat(fo.getAttribute("y"));
        }
        this._dragState._moved = true;
      }
      const nx = this._dragState.origX + dx;
      const ny = this._dragState.origY + dy;
      this.updateNodePosition(this._dragState.nodeId, nx, ny);
      return;
    }

    // Pan
    if (this._panState) {
      const dx = e.clientX - this._panState.startX;
      const dy = e.clientY - this._panState.startY;
      this.setTransform(this._panState.origPanX + dx, this._panState.origPanY + dy, this.zoom);
    }
  }

  _onMouseUp(e) {
    // Connection end
    if (this._connectState) {
      const toNodeId = this._findNodeId(e.target);
      if (toNodeId && toNodeId !== this._connectState.fromNodeId) {
        this.onEdgeCreated?.(this._connectState.fromNodeId, toNodeId);
      }
      this._connectState = null;
      this.svg.classList.remove("connecting");
      return;
    }

    // Node drag end
    if (this._dragState) {
      if (this._dragState._moved) {
        const fo = this.nodesLayer.querySelector(`foreignObject[data-node-id="${this._dragState.nodeId}"]`);
        if (fo) {
          const nx = parseFloat(fo.getAttribute("x"));
          const ny = parseFloat(fo.getAttribute("y"));
          this.onNodeMoved?.(this._dragState.nodeId, nx, ny);
        }
      }
      this._dragState = null;
      return;
    }

    // Pan end
    if (this._panState) {
      this._panState = null;
      this.svg.classList.remove("panning");
    }
  }

  _onDblClick(e) {
    const nodeId = this._findNodeId(e.target);
    if (nodeId) {
      this.onNodeDoubleClick?.(nodeId);
    }
  }

  _onContextMenu(e) {
    e.preventDefault();
    const nodeId = this._findNodeId(e.target);
    if (nodeId) {
      this.onNodeContextMenu?.(nodeId, e.clientX, e.clientY);
    } else {
      this.onCanvasContextMenu?.(e.clientX, e.clientY);
    }
  }
}

// ─── CanvasApp (top-level controller) ────────────────────────

class CanvasApp {
  constructor() {
    this.manager = new BoardManager();
    this.renderer = null;
    this._sendReq = null;   // injected by app.js
    this._autoSaveTimer = null;
    this._contextMenuEl = null;
    this.currentBoardId = null;
    this.goalContext = null;
    // ReAct visualization state
    this.reactEnabled = false;
    this._reactNodes = new Map(); // toolCallId → nodeId
    this._reactLastNodeId = null; // for chaining edges
  }

  /** Initialize — called once after DOM ready */
  init(sendReqFn) {
    this._sendReq = sendReqFn;

    const svg = document.getElementById("canvasSvg");
    const vp = document.getElementById("canvasViewport");
    const nl = document.getElementById("canvasNodesLayer");
    const el = document.getElementById("canvasEdgesLayer");
    if (!svg || !vp || !nl || !el) return;

    this.renderer = new CanvasRenderer(svg, vp, nl, el);

    // Wire callbacks
    this.renderer.onNodeMoved = (id, x, y) => {
      this.manager.moveNode(id, x, y);
      this._scheduleSave();
    };
    this.renderer.onNodeSelected = (id) => {
      // future: show node inspector
    };
    this.renderer.onEdgeCreated = (fromId, toId) => {
      const edge = this.manager.addEdge(fromId, toId);
      if (edge) {
        this._rerender();
        this._scheduleSave();
      }
    };
    this.renderer.onNodeDoubleClick = (nodeId) => {
      const node = this.manager.board?.nodes[nodeId];
      if (!node) return;
      const ref = node.data.ref;
      if (!ref) {
        // No ref — open inline edit dialog
        this._editNodeDialog(nodeId);
        return;
      }
      switch (ref.type) {
        case "method":
          window._belldandyOpenFile?.("methods/" + ref.id);
          break;
        case "memory":
          // Open memory daily note in editor
          window._belldandyOpenFile?.("memory/" + ref.id);
          break;
        case "session":
          // Switch to chat and load conversation
          window._belldandyLoadConversation?.(ref.id);
          break;
        case "url":
          window.open(ref.id, "_blank", "noopener");
          break;
        case "file":
          window._belldandyOpenFile?.(ref.id);
          break;
      }
    };
    this.renderer.onCanvasContextMenu = (cx, cy) => {
      this._showContextMenu(cx, cy, [
        { label: t("canvas.contextAddTask", {}, "+ Task"), action: () => this._addNodeInteractive("task") },
        { label: t("canvas.contextAddNote", {}, "+ Note"), action: () => this._addNodeInteractive("note") },
        { label: t("canvas.contextAddMethod", {}, "+ Method"), action: () => this._addNodeInteractive("method") },
        { label: t("canvas.contextAddKnowledge", {}, "+ Knowledge"), action: () => this._addNodeInteractive("knowledge") },
        "sep",
        { label: t("canvas.autoLayoutTitle", {}, "Auto Layout"), action: () => this.autoLayout() },
        { label: t("canvas.fitViewTitle", {}, "Fit View"), action: () => this.fitView() },
      ]);
    };
    this.renderer.onNodeContextMenu = (nodeId, cx, cy) => {
      this._showContextMenu(cx, cy, [
        { label: t("canvas.deleteNode", {}, "Delete Node"), action: () => { this.manager.removeNode(nodeId); this._rerender(); this._scheduleSave(); } },
        { label: t("canvas.togglePin", {}, "Pin/Unpin"), action: () => {
          const n = this.manager.board?.nodes[nodeId];
          if (n) { n.pinned = !n.pinned; this._rerender(); }
        }},
      ]);
    };

    // Toolbar buttons
    this._bindBtn("canvasAddTask", () => this._addNodeInteractive("task"));
    this._bindBtn("canvasAddNote", () => this._addNodeInteractive("note"));
    this._bindBtn("canvasAddMethod", () => this._addNodeInteractive("method"));
    this._bindBtn("canvasAutoLayout", () => this.autoLayout());
    this._bindBtn("canvasFitView", () => this.fitView());
    this._bindBtn("canvasZoomIn", () => { this.renderer.setTransform(this.renderer.panX, this.renderer.panY, this.renderer.zoom * 1.2); this._updateZoomLabel(); });
    this._bindBtn("canvasZoomOut", () => { this.renderer.setTransform(this.renderer.panX, this.renderer.panY, this.renderer.zoom / 1.2); this._updateZoomLabel(); });
    this._bindBtn("canvasSave", () => this.save());
    this._bindBtn("canvasClose", () => window._belldandySwitchMode?.("chat"));
    this._bindBtn("canvasAnalyze", () => this._analyzeBoard());
    this._bindBtn("canvasReactToggle", () => this._toggleReact());

    // Keyboard shortcuts
    document.addEventListener("keydown", (e) => {
      if (!this.currentBoardId) return;
      const section = document.getElementById("canvasSection");
      if (!section || section.classList.contains("hidden")) return;

      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) { if (this.manager.redo()) this._rerender(); }
        else { if (this.manager.undo()) this._rerender(); }
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (this.renderer.selectedNodeId) {
          this.manager.removeNode(this.renderer.selectedNodeId);
          this.renderer.selectedNodeId = null;
          this._rerender();
          this._scheduleSave();
        } else if (this.renderer.selectedEdgeId) {
          this.manager.removeEdge(this.renderer.selectedEdgeId);
          this.renderer.selectedEdgeId = null;
          this._rerender();
          this._scheduleSave();
        }
      }
    });

    // Close context menu on click elsewhere
    document.addEventListener("click", () => this._hideContextMenu());

    // Zoom label sync
    svg.addEventListener("wheel", () => setTimeout(() => this._updateZoomLabel(), 0));
  }

  // ── Board lifecycle ──

  async openBoard(boardId) {
    if (!this._sendReq) return;
    try {
      const res = await this._sendReq({ type: "req", id: cvId(), method: "workspace.read", params: { path: `canvas/${boardId}.json` } });
      if (!res.ok) throw new Error(res.error?.message || "read failed");
      const board = JSON.parse(res.payload.content);
      this.manager.load(board);
      this.currentBoardId = boardId;
      this._rerender();
      this._updateBoardName();

      // Restore viewport
      if (board.viewport) {
        this.renderer.setTransform(board.viewport.x, board.viewport.y, board.viewport.zoom);
      } else {
        this.renderer.fitView(board);
      }
      this._updateZoomLabel();
      window._belldandySyncCanvasContext?.();
    } catch (e) {
      console.error("Canvas: failed to open board", e);
    }
  }

  async createBoard(name) {
    const board = this.manager.createEmpty(name);
    this.currentBoardId = board.id;
    await this.save();
    this._rerender();
    this._updateBoardName();
    this.renderer.setTransform(0, 0, 1);
    this._updateZoomLabel();
    window._belldandySyncCanvasContext?.();
    return board.id;
  }

  async save() {
    if (!this._sendReq || !this.manager.board) return;
    // Save viewport state
    this.manager.board.viewport = {
      x: this.renderer.panX,
      y: this.renderer.panY,
      zoom: this.renderer.zoom,
    };
    const json = this.manager.toJSON();
    try {
      await this._sendReq({
        type: "req", id: cvId(),
        method: "workspace.write",
        params: { path: `canvas/${this.manager.board.id}.json`, content: json },
      });
      this.manager.dirty = false;
    } catch (e) {
      console.error("Canvas: save failed", e);
    }
  }

  async listBoards() {
    if (!this._sendReq) return [];
    try {
      const res = await this._sendReq({
        type: "req", id: cvId(),
        method: "workspace.list",
        params: { path: "canvas" },
      });
      if (!res.ok) return [];
      return (res.payload.items || [])
        .filter(i => i.type === "file" && i.name.endsWith(".json"))
        .map(i => ({ id: i.name.replace(".json", ""), name: i.name }));
    } catch { return []; }
  }

  close() {
    if (this.manager.dirty) this.save();
    this.currentBoardId = null;
    this.manager.board = null;
    if (this.renderer) {
      this.renderer.nodesLayer.innerHTML = "";
      this.renderer.edgesLayer.innerHTML = "";
    }
    window._belldandySyncCanvasContext?.();
  }

  /** Show board list UI in the canvas section */
  async showBoardList() {
    const section = document.getElementById("canvasSection");
    if (!section) return;

    // Hide SVG and toolbar, show list
    const svg = document.getElementById("canvasSvg");
    const toolbar = document.getElementById("canvasToolbar");
    if (svg) svg.style.display = "none";
    if (toolbar) toolbar.style.display = "none";

    // Remove existing list if any
    let listEl = section.querySelector(".canvas-board-list");
    if (listEl) listEl.remove();

    listEl = document.createElement("div");
    listEl.className = "canvas-board-list";

    // Header
    const header = document.createElement("div");
    header.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;";
    canvasBoardListHeaderTitleView.render(header, t("canvas.boardListTitle", {}, "Canvas Workspace"));
    const headerBtns = document.createElement("div");
    headerBtns.style.cssText = "display:flex;gap:8px;";

    const newBtn = document.createElement("button");
    newBtn.className = "canvas-tb-btn";
    newBtn.textContent = t("canvas.newBoard", {}, "+ New Board");
    newBtn.addEventListener("click", async () => {
      const name = prompt(
        t("canvas.boardNamePrompt", {}, "Board name:"),
        t("canvas.newBoardDefaultName", {}, "New Board"),
      );
      if (!name) return;
      await this.createBoard(name);
      this._showCanvasView();
    });
    headerBtns.appendChild(newBtn);

    const backBtn = document.createElement("button");
    backBtn.className = "canvas-tb-btn canvas-tb-close";
    backBtn.textContent = t("canvas.back", {}, "Back");
    backBtn.addEventListener("click", () => {
      window._belldandySwitchMode?.("chat");
    });
    headerBtns.appendChild(backBtn);
    header.appendChild(headerBtns);
    listEl.appendChild(header);

    // Board items
    const boards = await this.listBoards();
    if (boards.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = "text-align:center;color:var(--text-muted);padding:40px 0;font-size:14px;";
      empty.textContent = t("canvas.emptyBoards", {}, "No boards yet. Create one with the button above.");
      listEl.appendChild(empty);
    } else {
      for (const b of boards) {
        const item = document.createElement("div");
        item.className = "canvas-board-item";
        canvasBoardItemView.render(item, b);
        item.addEventListener("click", async () => {
          await this.openBoard(b.id);
          this._showCanvasView();
        });
        listEl.appendChild(item);
      }
    }

    section.appendChild(listEl);
    window._belldandySyncCanvasContext?.();
  }

  /** Switch from board list to canvas view */
  _showCanvasView() {
    const section = document.getElementById("canvasSection");
    if (!section) return;
    const svg = document.getElementById("canvasSvg");
    const toolbar = document.getElementById("canvasToolbar");
    const listEl = section.querySelector(".canvas-board-list");
    if (listEl) listEl.remove();
    if (svg) svg.style.display = "";
    if (toolbar) toolbar.style.display = "";
    window._belldandySyncCanvasContext?.();
  }

  // ── Event bridge (called from app.js handleEvent) ──

  handleCanvasEvent(action, payload) {
    if (!this.manager.board) return;
    switch (action) {
      case "node_added":
        if (payload.node) {
          this.manager.board.nodes[payload.nodeId] = payload.node;
          this._rerender();
        }
        break;
      case "node_updated":
        if (payload.node && this.manager.board.nodes[payload.nodeId]) {
          this.manager.board.nodes[payload.nodeId] = payload.node;
          this._rerender();
        }
        break;
      case "node_removed":
        delete this.manager.board.nodes[payload.nodeId];
        if (payload.removedEdges) {
          for (const eid of payload.removedEdges) delete this.manager.board.edges[eid];
        }
        this._rerender();
        break;
      case "edge_added":
        if (payload.edge) {
          this.manager.board.edges[payload.edgeId] = payload.edge;
          this._rerender();
        }
        break;
      case "edge_removed":
        delete this.manager.board.edges[payload.edgeId];
        this._rerender();
        break;
      case "board_created":
        // Could refresh board list if showing
        break;
    }
  }

  // ── Internal ──

  setGoalContext(context) {
    this.goalContext = context && typeof context === "object" ? { ...context } : null;
    if (this.renderer) {
      this.renderer.activeGoalNodeId = typeof this.goalContext?.nodeId === "string" && this.goalContext.nodeId.trim()
        ? this.goalContext.nodeId.trim()
        : null;
    }
    if (this.manager.board) {
      this._rerender();
    }
  }

  _rerender() {
    if (this.renderer && this.manager.board) {
      this.renderer.activeGoalNodeId = typeof this.goalContext?.nodeId === "string" && this.goalContext.nodeId.trim()
        ? this.goalContext.nodeId.trim()
        : null;
      this.renderer.renderAll(this.manager.board);
    }
  }

  _scheduleSave() {
    clearTimeout(this._autoSaveTimer);
    this._autoSaveTimer = setTimeout(() => this.save(), 2000);
  }

  _updateBoardName() {
    const el = document.getElementById("canvasBoardName");
    if (!el) return;
    if (this.manager.board) {
      el.textContent = this.manager.board.name;
      return;
    }
    el.textContent = t("canvas.unnamedBoard", {}, "Untitled Board");
  }

  _updateZoomLabel() {
    const el = document.getElementById("canvasZoomLabel");
    if (el && this.renderer) el.textContent = Math.round(this.renderer.zoom * 100) + "%";
  }

  _addNodeInteractive(type) {
    // For method/knowledge/session types, show resource picker
    if (type === "method" || type === "knowledge" || type === "session") {
      this._showResourcePicker(type);
      return;
    }
    const icon = getCanvasNodeIcon(type, "");
    const title = prompt(t("canvas.nodeTitlePrompt", { icon, type }, `Enter ${icon} ${type} node title:`));
    if (!title) return;
    const node = this.manager.addNode(type, title);
    if (node) {
      this._rerender();
      this._scheduleSave();
    }
  }

  autoLayout() {
    this.manager.autoLayout();
    this._rerender();
    this._scheduleSave();
  }

  fitView() {
    if (this.renderer && this.manager.board) {
      this.renderer.fitView(this.manager.board);
      this._updateZoomLabel();
    }
  }

  _bindBtn(id, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", fn);
  }

  // ── Resource picker for method/knowledge/session nodes ──

  async _showResourcePicker(type) {
    const items = await this._fetchResources(type);
    const overlay = document.createElement("div");
    overlay.className = "canvas-picker-overlay";

    const dialog = document.createElement("div");
    dialog.className = "canvas-picker-dialog";

    const typeLabels = {
      method: t("canvas.resourceMethod", {}, "Method"),
      knowledge: t("canvas.resourceKnowledge", {}, "Knowledge"),
      session: t("canvas.resourceSession", {}, "Session"),
    };
    const refType = type === "knowledge" ? "memory" : type;

    const { body, closeButton: closeBtn, manualButton: manualBtn } = canvasResourcePickerDialogView.render(dialog, {
      title: t("canvas.resourcePickerTitle", { typeLabel: typeLabels[type] || type }, `Choose ${typeLabels[type] || type} resource`),
      manualLabel: t("canvas.manualInput", {}, "Manual Input"),
    });

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

    manualBtn.addEventListener("click", () => {
      close();
      const icon = getCanvasNodeIcon(type, "");
      const title = prompt(t("canvas.nodeTitlePrompt", { icon, type }, `Enter ${icon} ${type} node title:`));
      if (!title) return;
      const node = this.manager.addNode(type, title);
      if (node) { this._rerender(); this._scheduleSave(); }
    });

    if (items.length === 0) {
      canvasResourcePickerEmptyView.render(body, t("canvas.noAvailableResources", { typeLabel: typeLabels[type] || type }, `No available ${typeLabels[type] || type} resources`));
    } else {
      for (const item of items) {
        const row = document.createElement("div");
        row.className = "canvas-picker-item";
        canvasResourcePickerItemView.render(row, item);
        row.addEventListener("click", () => {
          close();
          const node = this.manager.addNode(type, item.name, {
            ref: { type: refType, id: item.id },
            content: item.content || undefined,
          });
          if (node) { this._rerender(); this._scheduleSave(); }
        });
        body.appendChild(row);
      }
    }
  }

  async _fetchResources(type) {
    if (!this._sendReq) return [];
    try {
      if (type === "method") {
        const res = await this._sendReq({
          type: "req", id: cvId(),
          method: "workspace.list",
          params: { path: "methods" },
        });
        if (!res.ok) return [];
        return (res.payload.items || [])
          .filter(i => i.type === "file" && i.name.endsWith(".md"))
          .map(i => ({ id: i.name, name: i.name.replace(/\.md$/, ""), desc: t("canvas.methodDoc", {}, "Method Doc") }));
      }
      if (type === "knowledge") {
        const res = await this._sendReq({
          type: "req", id: cvId(),
          method: "workspace.list",
          params: { path: "memory" },
        });
        if (!res.ok) return [];
        return (res.payload.items || [])
          .filter(i => i.type === "file" && i.name.endsWith(".md"))
          .map(i => ({ id: i.name, name: i.name.replace(/\.md$/, ""), desc: t("canvas.memoryNote", {}, "Memory Note") }));
      }
      if (type === "session") {
        const res = await this._sendReq({
          type: "req", id: cvId(),
          method: "workspace.list",
          params: { path: "sessions" },
        });
        if (!res.ok) return [];
        return (res.payload.items || [])
          .filter(i => i.type === "file")
          .map(i => {
            const id = i.name.replace(/\.jsonl$/, "");
            return { id, name: id, desc: t("canvas.conversationSession", {}, "Conversation Session") };
          });
      }
    } catch { /* ignore */ }
    return [];
  }

  // ── Inline node edit dialog ──

  _editNodeDialog(nodeId) {
    const node = this.manager.board?.nodes[nodeId];
    if (!node) return;

    const overlay = document.createElement("div");
    overlay.className = "canvas-picker-overlay";

    const dialog = document.createElement("div");
    dialog.className = "canvas-picker-dialog";

    const d = node.data;
    const {
      closeButton: closeBtn,
      saveButton: saveBtn,
      titleInput,
      contentInput,
    } = canvasNodeEditDialogView.render(dialog, {
      dialogTitle: t("canvas.editNode", {}, "Edit Node"),
      titleLabel: t("canvas.titleLabel", {}, "Title"),
      contentLabel: t("canvas.contentLabel", {}, "Content"),
      saveLabel: t("canvas.save", {}, "Save"),
      title: d.title,
      content: d.content || "",
    });

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

    titleInput.focus();

    saveBtn.addEventListener("click", () => {
      const updates = {};
      const newTitle = titleInput.value.trim();
      const newContent = contentInput.value;
      if (newTitle && newTitle !== d.title) updates.title = newTitle;
      if (newContent !== (d.content || "")) updates.content = newContent;
      if (Object.keys(updates).length) {
        this.manager.updateNode(nodeId, updates);
        this._rerender();
        this._scheduleSave();
      }
      close();
    });
  }

  // ── Canvas Snapshot (text summary for Agent context) ──

  getCanvasSnapshot() {
    const board = this.manager.board;
    if (!board) return null;
    const nodes = Object.values(board.nodes);
    if (nodes.length === 0) return null;

    const lines = [t("canvas.snapshotBoardLine", { boardName: board.name, count: nodes.length }, `Board: ${board.name} (${nodes.length} nodes)`)];
    for (const n of nodes) {
      const ref = n.data.ref ? ` [${n.data.ref.type}:${n.data.ref.id}]` : "";
      const status = n.data.status ? ` (${n.data.status})` : "";
      lines.push(`- [${n.type}] ${n.data.title}${status}${ref}`);
      if (n.data.content) {
        const preview = n.data.content.length > 100 ? n.data.content.slice(0, 100) + "\u2026" : n.data.content;
        lines.push(`  ${preview}`);
      }
    }
    const edges = Object.values(board.edges);
    if (edges.length > 0) {
      lines.push(t("canvas.snapshotEdges", {}, "Edges:"));
      for (const e of edges) {
        const from = board.nodes[e.from]?.data.title ?? e.from;
        const to = board.nodes[e.to]?.data.title ?? e.to;
        lines.push(`- ${from} \u2192 ${to}${e.label ? ` "${e.label}"` : ""}`);
      }
    }
    return lines.join("\n");
  }

  // ── Analyze Board (send snapshot to Agent) ──

  _analyzeBoard() {
    if (!this.manager.board) return;
    const snapshot = this.getCanvasSnapshot();
    if (!snapshot) return;
    // Switch to chat and send the snapshot as a message
    window._belldandySwitchMode?.("chat");
    const promptEl = document.getElementById("prompt");
    if (promptEl) {
      promptEl.value = t("canvas.analyzePrompt", { snapshot }, `Please analyze the following canvas content and provide suggestions and insights:\n\n${snapshot}`);
      promptEl.focus();
    }
  }

  // ── ReAct Toggle ──

  _toggleReact() {
    this.reactEnabled = !this.reactEnabled;
    const btn = document.getElementById("canvasReactToggle");
    if (btn) {
      btn.classList.toggle("canvas-tb-active", this.reactEnabled);
    }
    if (!this.reactEnabled) {
      // Clear temporary react nodes
      this._clearReactNodes();
    }
  }

  _clearReactNodes() {
    if (!this.manager.board) return;
    let changed = false;
    for (const [, nodeId] of this._reactNodes) {
      if (this.manager.board.nodes[nodeId] && !this.manager.board.nodes[nodeId].pinned) {
        delete this.manager.board.nodes[nodeId];
        // Remove associated edges
        for (const [eid, e] of Object.entries(this.manager.board.edges)) {
          if (e.from === nodeId || e.to === nodeId) delete this.manager.board.edges[eid];
        }
        changed = true;
      }
    }
    this._reactNodes.clear();
    this._reactLastNodeId = null;
    if (changed) this._rerender();
  }

  // ── ReAct Event Handler (called from app.js handleEvent) ──

  handleReactEvent(eventType, payload) {
    if (!this.reactEnabled || !this.manager.board) return;

    if (eventType === "tool_call") {
      const toolName = payload.name || "unknown";
      const args = typeof payload.arguments === "string"
        ? payload.arguments
        : JSON.stringify(payload.arguments || {});
      const preview = args.length > 120 ? args.slice(0, 120) + "\u2026" : args;

      const node = this.manager.addNode("agent-output", `\u{1F527} ${toolName}`, {
        content: preview,
        tags: ["react", "running"],
        color: "var(--canvas-react-running-text)",
      });
      if (node) {
        node._react = true; // mark as temporary
        this._reactNodes.set(payload.id, node.id);

        // Chain edge from previous react node
        if (this._reactLastNodeId && this.manager.board.nodes[this._reactLastNodeId]) {
          this.manager.addEdge(this._reactLastNodeId, node.id, { label: "next", style: "dashed" });
        }
        this._reactLastNodeId = node.id;

        this.manager.autoLayout();
        this._rerender();
      }
    }

    if (eventType === "tool_result") {
      const nodeId = this._reactNodes.get(payload.id);
      if (nodeId && this.manager.board.nodes[nodeId]) {
        const n = this.manager.board.nodes[nodeId];
        const output = payload.output || "";
        const preview = output.length > 200 ? output.slice(0, 200) + "\u2026" : output;
        n.data.content = preview;
        n.data.tags = ["react", payload.success ? "done" : "error"];
        n.data.color = payload.success ? "var(--canvas-react-done-text)" : "var(--canvas-react-error-text)";
        this._rerender();
      }
    }
  }

  // Called from app.js when chat.final arrives while react is enabled
  handleReactFinal(text) {
    if (!this.reactEnabled || !this.manager.board) return;
    const preview = text.length > 300 ? text.slice(0, 300) + "\u2026" : text;
    const node = this.manager.addNode("agent-output", t("canvas.reactFinalTitle", {}, "\u{1F4AC} Agent Summary"), {
      content: preview,
      tags: ["react", "final"],
      color: "var(--canvas-react-final-text)",
    });
    if (node) {
      node._react = true;
      if (this._reactLastNodeId && this.manager.board.nodes[this._reactLastNodeId]) {
        this.manager.addEdge(this._reactLastNodeId, node.id, { label: "result", style: "dashed" });
      }
      this._reactLastNodeId = node.id;
      this.manager.autoLayout();
      this._rerender();
    }
  }

  _showContextMenu(cx, cy, items) {
    this._hideContextMenu();
    const menu = document.createElement("div");
    menu.className = "canvas-context-menu";
    menu.style.left = cx + "px";
    menu.style.top = cy + "px";

    for (const item of items) {
      if (item === "sep") {
        const sep = document.createElement("div");
        sep.className = "canvas-context-sep";
        menu.appendChild(sep);
      } else {
        const row = document.createElement("div");
        row.className = "canvas-context-item";
        row.textContent = item.label;
        row.addEventListener("click", (e) => {
          e.stopPropagation();
          this._hideContextMenu();
          item.action();
        });
        menu.appendChild(row);
      }
    }

    document.body.appendChild(menu);
    this._contextMenuEl = menu;
  }

  _hideContextMenu() {
    if (this._contextMenuEl) {
      this._contextMenuEl.remove();
      this._contextMenuEl = null;
    }
  }

  refreshLocale() {
    this._updateBoardName();
    const section = document.getElementById("canvasSection");
    if (section?.querySelector(".canvas-board-list")) {
      void this.showBoardList();
    }
  }
}

// ─── Global Instance ─────────────────────────────────────────

window._canvasApp = new CanvasApp();
