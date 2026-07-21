// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { createChatCopyFeedbackView } from "./chat-copy-feedback-view.js";

describe("chat copy feedback view", () => {
  it("uses text feedback and restores the original child nodes without innerHTML", () => {
    const button = document.createElement("button");
    button.innerHTML = '<svg data-icon="copy"><path d="M1 1"></path></svg><span>Copy</span>';
    const originalChildren = Array.from(button.childNodes);
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(button, "innerHTML", {
      configurable: true,
      get() {
        return descriptor.get.call(this);
      },
      set(value) {
        if (value) throw new Error("Chat copy feedback must not use innerHTML");
        descriptor.set.call(this, value);
      },
    });

    try {
      const view = createChatCopyFeedbackView({
        t: () => '<img src=x onerror="alert(1)">Copied',
      });
      const snapshot = view.capture(button);
      view.showCopied(button);

      expect(button.textContent).toBe('<img src=x onerror="alert(1)">Copied');
      expect(button.querySelector("img, [onerror]")).toBeNull();

      view.restore(button, snapshot);
      expect(Array.from(button.childNodes)).toEqual(originalChildren);
      expect(button.querySelector("svg path")?.getAttribute("d")).toBe("M1 1");
    } finally {
      Object.defineProperty(button, "innerHTML", descriptor);
    }
  });
});
