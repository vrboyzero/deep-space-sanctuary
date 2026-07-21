const RUNTIME_STYLESHEET_ID = "webchatRuntimeStylesheet";
const RUNTIME_STYLE_CLASS_PREFIX = "webchat-runtime-style-";

const ALLOWED_STYLE_PROPERTIES = new Set([
  "background",
  "background-image",
  "border",
  "border-left-color",
  "border-radius",
  "box-sizing",
  "color",
  "cursor",
  "display",
  "flex-direction",
  "flex-wrap",
  "font-family",
  "font-size",
  "font-weight",
  "gap",
  "height",
  "left",
  "line-height",
  "margin",
  "margin-bottom",
  "margin-top",
  "max-height",
  "max-width",
  "min-width",
  "opacity",
  "overflow",
  "overflow-y",
  "padding",
  "position",
  "scroll-behavior",
  "text-align",
  "top",
  "width",
]);
const ALLOWED_CUSTOM_PROPERTIES = new Set([
  "--token-usage-observability-shift",
  "--token-usage-observability-top",
]);

let nextRuntimeStyleId = 0;
const runtimeStyleEntries = new WeakMap();
const documentRuntimeStyleRegistries = new WeakMap();

function getStyleSheet(documentRef) {
  const primarySheet = documentRef?.getElementById?.(RUNTIME_STYLESHEET_ID)?.sheet;
  if (primarySheet && typeof primarySheet.insertRule === "function") {
    return primarySheet;
  }

  // Tests may supply a same-document stylesheet without creating an inline production fallback.
  const testSheet = documentRef?.querySelector?.("style[data-ui03-runtime-stylesheet]")?.sheet;
  return testSheet && typeof testSheet.insertRule === "function" ? testSheet : null;
}

function getRuleIndex(styleSheet, rule) {
  return Array.from(styleSheet.cssRules ?? []).indexOf(rule);
}

function visitRemovedElement(node, callback) {
  if (node?.nodeType !== 1) return;
  callback(node);
  for (const child of node.children ?? []) {
    visitRemovedElement(child, callback);
  }
}

function getDocumentRuntimeStyleRegistry(documentRef) {
  if (!documentRef) return null;
  let registry = documentRuntimeStyleRegistries.get(documentRef);
  if (registry) return registry;

  registry = { entries: new Map(), pendingDetachedEntries: new Set() };
  const MutationObserverCtor = documentRef.defaultView?.MutationObserver ?? globalThis.MutationObserver;
  if (typeof MutationObserverCtor === "function" && documentRef.documentElement) {
    const observer = new MutationObserverCtor((records) => {
      for (const record of records) {
        for (const node of record.removedNodes) {
          visitRemovedElement(node, (element) => {
            if (registry.entries.has(element)) registry.pendingDetachedEntries.add(element);
          });
        }
      }
      if (!registry.pendingDetachedEntries.size) return;
      queueMicrotask(() => {
        for (const element of registry.pendingDetachedEntries) {
          registry.pendingDetachedEntries.delete(element);
          if (!element.isConnected) clearRuntimeStyles(element);
        }
      });
    });
    observer.observe(documentRef.documentElement, { childList: true, subtree: true });
    registry.observer = observer;
  }
  documentRuntimeStyleRegistries.set(documentRef, registry);
  return registry;
}

function normalizeStyleDeclarations(declarations) {
  if (!declarations || typeof declarations !== "object") return [];
  const normalized = [];
  for (const [property, value] of Object.entries(declarations)) {
    if (!ALLOWED_STYLE_PROPERTIES.has(property) && !ALLOWED_CUSTOM_PROPERTIES.has(property)) {
      throw new Error(`Unsupported runtime style property: ${property}`);
    }
    if (value === null || value === undefined || value === "") {
      normalized.push([property, null]);
      continue;
    }
    normalized.push([property, String(value)]);
  }
  return normalized;
}

function createRuntimeStyleEntry(element) {
  const documentRef = element?.ownerDocument ?? globalThis.document;
  const styleSheet = getStyleSheet(documentRef);
  if (!styleSheet || !element?.classList) return null;

  const className = `${RUNTIME_STYLE_CLASS_PREFIX}${++nextRuntimeStyleId}`;
  try {
    const ruleIndex = styleSheet.insertRule(`.${className} {}`, styleSheet.cssRules.length);
    const rule = styleSheet.cssRules[ruleIndex];
    if (!rule?.style) return null;
    const registry = getDocumentRuntimeStyleRegistry(documentRef);
    const entry = { className, rule, styleSheet, documentRegistry: registry, properties: new Set() };
    runtimeStyleEntries.set(element, entry);
    registry?.entries.set(element, entry);
    element.classList.add(className);
    return entry;
  } catch {
    // A stylesheet not yet loaded or made unreadable by a host policy must not fall back to style attributes.
    return null;
  }
}

/**
 * Applies dynamic presentation through a rule in the existing same-origin stylesheet.
 * This intentionally never creates a style attribute or a runtime style element.
 */
export function setRuntimeStyles(element, declarations) {
  if (!element) return false;
  const normalized = normalizeStyleDeclarations(declarations);
  const entry = runtimeStyleEntries.get(element) ?? createRuntimeStyleEntry(element);
  if (!entry) return false;

  const nextProperties = new Set(normalized.map(([property]) => property));
  for (const property of entry.properties) {
    if (!nextProperties.has(property)) {
      entry.rule.style.removeProperty(property);
    }
  }
  for (const [property, value] of normalized) {
    if (value === null) {
      entry.rule.style.removeProperty(property);
    } else {
      entry.rule.style.setProperty(property, value);
    }
  }
  entry.properties = new Set(normalized.filter(([, value]) => value !== null).map(([property]) => property));
  return true;
}

export function clearRuntimeStyles(element) {
  const entry = runtimeStyleEntries.get(element);
  if (!entry) return false;
  element.classList?.remove(entry.className);
  const ruleIndex = getRuleIndex(entry.styleSheet, entry.rule);
  if (ruleIndex >= 0) {
    try {
      entry.styleSheet.deleteRule(ruleIndex);
    } catch {
      // The element is already detached from the stylesheet; removing its class still prevents reuse.
    }
  }
  runtimeStyleEntries.delete(element);
  entry.documentRegistry?.entries.delete(element);
  entry.documentRegistry?.pendingDetachedEntries.delete(element);
  return true;
}

export function toRuntimeStyleUrl(value, documentRef = globalThis.document) {
  if (typeof value !== "string" || !value.trim()) return "none";
  try {
    const url = new URL(value, documentRef?.baseURI ?? "http://localhost/");
    if (!new Set(["http:", "https:", "data:"]).has(url.protocol)) return "none";
    return `url(${JSON.stringify(url.href)})`;
  } catch {
    return "none";
  }
}
