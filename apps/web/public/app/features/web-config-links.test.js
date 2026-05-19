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
});
