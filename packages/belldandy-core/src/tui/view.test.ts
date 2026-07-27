import stringWidth from "string-width";
import { describe, expect, it } from "vitest";

import { toLeadingVisibleLines, toVisibleLines, truncateTuiIdentifier } from "./view.js";

describe("TUI visible text", () => {
  it("strips terminal control sequences and keeps wide lines inside the viewport", () => {
    const lines = toVisibleLines("safe\u001b[2J中文内容abcdef", 8, 4);

    expect(lines.join("\n")).not.toContain("\u001b");
    expect(lines.join("\n")).toContain("safe");
    expect(lines.every((line) => stringWidth(line) <= 8)).toBe(true);
    expect(stringWidth(truncateTuiIdentifier("工具名称很长", 8))).toBeLessThanOrEqual(8);
  });

  it("keeps only the newest bounded lines", () => {
    expect(toVisibleLines("one\ntwo\nthree\nfour", 20, 2)).toEqual(["three", "four"]);
  });

  it("keeps the leading bounded lines for stable review viewports", () => {
    expect(toLeadingVisibleLines("summary\nhunk\npatch one\npatch two", 20, 3))
      .toEqual(["summary", "hunk", "patch one"]);
  });
});
