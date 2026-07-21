// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createLocaleController } from "./locale.js";

function createController() {
  return createLocaleController({
    storageKey: "locale-retention-test",
    defaultLocale: "zh-CN",
    dictionaries: {
      "zh-CN": { common: { save: "保存" } },
      "en-US": { common: { save: "Save" } },
    },
    localeMeta: {
      "zh-CN": { label: "简体中文" },
      "en-US": { label: "English" },
    },
  });
}

describe("locale controller lifecycle", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.lang = "zh-CN";
    document.documentElement.dataset.locale = "zh-CN";
    document.body.innerHTML = '<select id="locale"></select>';
  });

  it("renders locale codes and labels as option data instead of HTML", () => {
    const unsafeLocale = 'evil" onmouseover="alert(1)';
    const unsafeLabel = '</option><option onfocus="alert(1)">Injected';
    const controller = createLocaleController({
      defaultLocale: "safe",
      dictionaries: {
        safe: {},
        [unsafeLocale]: {},
      },
      localeMeta: {
        safe: { label: "Safe" },
        [unsafeLocale]: { label: unsafeLabel },
      },
    });
    const select = document.getElementById("locale");

    controller.bindSelect(select);

    expect(select.options).toHaveLength(2);
    expect(select.querySelector("[onmouseover], [onfocus]")).toBeNull();
    expect(select.options[1].value).toBe(unsafeLocale);
    expect(select.options[1].textContent).toBe(unsafeLabel);
    controller.dispose();
  });

  it("removes subscribers and bound select listeners on dispose", () => {
    const controller = createController();
    const select = document.getElementById("locale");
    const subscriber = vi.fn();
    const unsubscribe = controller.subscribe(subscriber);
    controller.bindSelect(select);

    expect(controller.getRuntimeSnapshot()).toMatchObject({
      subscriberCount: 1,
      boundSelectCount: 1,
      localeChangeCount: 0,
      disposed: false,
    });

    select.value = "en-US";
    select.dispatchEvent(new Event("change"));
    expect(controller.getLocale()).toBe("en-US");
    expect(subscriber).toHaveBeenCalledWith("en-US");

    controller.dispose();
    expect(controller.getRuntimeSnapshot()).toMatchObject({
      subscriberCount: 0,
      boundSelectCount: 0,
      localeChangeCount: 1,
      disposed: true,
    });

    select.value = "zh-CN";
    select.dispatchEvent(new Event("change"));
    expect(controller.getLocale()).toBe("en-US");
    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(controller.setLocale("zh-CN")).toBe("en-US");
    unsubscribe();
  });

  it("does not retain bindings or subscribers added after dispose", () => {
    const controller = createController();
    controller.dispose();

    controller.bindSelect(document.getElementById("locale"));
    const unsubscribe = controller.subscribe(vi.fn());

    expect(controller.getRuntimeSnapshot()).toMatchObject({
      subscriberCount: 0,
      boundSelectCount: 0,
      disposed: true,
    });
    expect(() => unsubscribe()).not.toThrow();
  });
});
