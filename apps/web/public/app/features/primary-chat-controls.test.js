// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createPrimaryChatControlsFeature } from "./primary-chat-controls.js";

describe("primary chat controls lifecycle", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("forwards connect and composer commands until dispose", () => {
    document.body.innerHTML = `
      <button id="connect">Connect</button>
      <button id="send">Send</button>
    `;
    const onConnect = vi.fn();
    const onComposerPrimaryAction = vi.fn();
    const feature = createPrimaryChatControlsFeature({
      connectButton: document.getElementById("connect"),
      sendButton: document.getElementById("send"),
      onConnect,
      onComposerPrimaryAction,
    });

    expect(feature.getRuntimeSnapshot()).toEqual({ listenerCount: 2, disposed: false });
    document.getElementById("connect").click();
    document.getElementById("send").click();
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onComposerPrimaryAction).toHaveBeenCalledTimes(1);

    feature.dispose();
    feature.dispose();
    document.getElementById("connect").click();
    document.getElementById("send").click();
    expect(feature.getRuntimeSnapshot()).toEqual({ listenerCount: 0, disposed: true });
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onComposerPrimaryAction).toHaveBeenCalledTimes(1);
  });
});
