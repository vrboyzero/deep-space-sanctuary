const SAFE_ASSISTANT_TAGS = [
  "a", "audio", "b", "blockquote", "br", "button", "code", "div", "em", "h1", "h2", "h3", "h4", "h5", "h6", "hr",
  "i", "img", "li", "ol", "p", "pre", "source", "span", "strong", "table", "tbody", "td", "th", "thead", "tr", "ul", "video",
];

const SAFE_ASSISTANT_ATTRS = [
  "alt", "autoplay", "class", "controls", "href", "loop", "muted", "playsinline", "poster", "preload", "rel", "src", "target", "title", "type",
];

const SAME_ORIGIN_MEDIA_PREFIXES = ["/avatar/", "/generated/"];
export const GENERATED_IMAGE_REVEAL_PREFIX = "#generated-image-reveal:";
const RICH_CONTENT_TRUSTED_TYPES_POLICY_NAME = "belldandy-rich-content";
let richContentTrustedTypesPolicy = null;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function getDomPurify() {
  const purifier = window.DOMPurify;
  return purifier && typeof purifier.sanitize === "function" ? purifier : null;
}

function createTrustedRichHtml(value) {
  const trustedTypes = window.trustedTypes;
  if (!trustedTypes || typeof trustedTypes.createPolicy !== "function") return value;
  if (!richContentTrustedTypesPolicy) {
    try {
      // 此 policy 只接收 DOMPurify 处理后的字符串或受限 DOM 序列化结果；调用方
      // 不应将模型原文或其他外部输入直接传入，避免把 policy 变成全局绕过通道。
      richContentTrustedTypesPolicy = trustedTypes.createPolicy(RICH_CONTENT_TRUSTED_TYPES_POLICY_NAME, {
        createHTML: (safeHtml) => safeHtml,
      });
    } catch {
      return value;
    }
  }
  return richContentTrustedTypesPolicy.createHTML(value);
}

/**
 * 富内容只接受受限 Markdown HTML；DOMPurify 负责解析器差异和 mXSS，业务层再
 * 收紧媒体来源，避免模型输出触发任意下载或内存型 data URL。
 */
export function sanitizeRichContent(rawHtml) {
  const content = typeof rawHtml === "string" ? rawHtml : "";
  const purifier = getDomPurify();
  if (!purifier) {
    return escapeHtml(content);
  }

  const sanitized = purifier.sanitize(content, {
    ALLOWED_TAGS: SAFE_ASSISTANT_TAGS,
    ALLOWED_ATTR: SAFE_ASSISTANT_ATTRS,
    FORBID_TAGS: ["form", "iframe", "input", "math", "object", "script", "style", "svg", "textarea"],
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    RETURN_TRUSTED_TYPE: false,
  });
  const template = document.createElement("template");
  template.innerHTML = createTrustedRichHtml(sanitized);
  constrainRichContentUrls(template.content);
  return createTrustedRichHtml(template.innerHTML);
}

export function isSafeAssistantMediaUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.origin === window.location.origin) {
      return SAME_ORIGIN_MEDIA_PREFIXES.some((prefix) => parsed.pathname.startsWith(prefix));
    }
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isSafeAssistantLinkUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  if (value.startsWith(GENERATED_IMAGE_REVEAL_PREFIX)) return true;
  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.origin === window.location.origin) return true;
    return parsed.protocol === "https:" || parsed.protocol === "mailto:" || parsed.protocol === "tel:";
  } catch {
    return false;
  }
}

function isExternalHttpsLinkUrl(value) {
  try {
    const parsed = new URL(value, window.location.origin);
    return parsed.origin !== window.location.origin && parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function constrainRichContentUrls(root) {
  root.querySelectorAll("a[href]").forEach((link) => {
    const href = link.getAttribute("href") || "";
    if (!isSafeAssistantLinkUrl(href)) {
      link.removeAttribute("href");
    }

    if (link.hasAttribute("target") && link.getAttribute("target") !== "_blank") {
      link.removeAttribute("target");
    }
    if (isExternalHttpsLinkUrl(href)) {
      // 外链固定在隔离 context 打开，模型不能选择 _top/_parent 覆盖 WebChat。
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
      link.setAttribute("referrerpolicy", "no-referrer");
    } else if (link.getAttribute("target") === "_blank") {
      link.setAttribute("rel", "noopener noreferrer");
    }
  });

  root.querySelectorAll("img[src], audio[src], video[src], source[src], video[poster]").forEach((media) => {
    for (const attr of ["src", "poster"]) {
      const value = media.getAttribute(attr);
      if (value !== null && !isSafeAssistantMediaUrl(value)) {
        media.removeAttribute(attr);
      }
    }
  });
}
