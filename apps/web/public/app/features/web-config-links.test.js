// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { applyWebConfigLinks } from "./web-config-links.js";

describe("applyWebConfigLinks", () => {
  it("applies configured external links including aliyun one-key entry", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const recommendApiLink = document.createElement("a");
    const aliyunOneKeyLink = document.createElement("a");
    const officialHomeLink = document.createElement("a");
    const workshopLink = document.createElement("a");
    applyWebConfigLinks(
      {
        recommendApiLink,
        aliyunOneKeyLink,
        officialHomeLink,
        workshopLink,
      },
      {
        recommendApiUrl: "https://example.com/recommend",
        aliyunOneKeyUrl: "https://example.com/aliyun",
        officialHomeUrl: "https://example.com/home",
        workshopUrl: "https://example.com/workshop",
      },
    );

    expect(recommendApiLink.href).toBe("https://example.com/recommend");
    expect(aliyunOneKeyLink.href).toBe("https://example.com/aliyun");
    expect(officialHomeLink.href).toBe("https://example.com/home");
    expect(workshopLink.href).toBe("https://example.com/workshop");
    expect(recommendApiLink.target).toBe("_blank");
    expect(recommendApiLink.rel).toBe("noopener noreferrer");

    recommendApiLink.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(openSpy).toHaveBeenCalledWith("https://example.com/recommend", "_blank", "noopener,noreferrer");
    openSpy.mockRestore();
  });

  it("skips missing refs or urls", () => {
    const recommendApiLink = document.createElement("a");
    recommendApiLink.href = "https://example.com/original";

    applyWebConfigLinks(
      {
        recommendApiLink,
        aliyunOneKeyLink: null,
      },
      {
        aliyunOneKeyUrl: "https://example.com/aliyun",
      },
    );

    expect(recommendApiLink.href).toBe("https://example.com/original");
  });

  it("releases configured link listeners on dispose", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const recommendApiLink = document.createElement("a");
    const officialHomeLink = document.createElement("a");
    const feature = applyWebConfigLinks(
      { recommendApiLink, officialHomeLink },
      {
        recommendApiUrl: "https://example.com/recommend",
        officialHomeUrl: "https://example.com/home",
      },
    );
    expect(feature.getRuntimeSnapshot()).toEqual({ listenerCount: 2, disposed: false });

    feature.dispose();
    feature.dispose();
    expect(feature.getRuntimeSnapshot()).toEqual({ listenerCount: 0, disposed: true });
    recommendApiLink.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    officialHomeLink.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(openSpy).not.toHaveBeenCalled();
    expect(recommendApiLink.href).toBe("https://example.com/recommend");
    expect(recommendApiLink.target).toBe("_blank");
    expect(recommendApiLink.rel).toBe("noopener noreferrer");
    openSpy.mockRestore();
  });
});
