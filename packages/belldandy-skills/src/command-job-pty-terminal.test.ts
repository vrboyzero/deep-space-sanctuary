import { describe, expect, it } from "vitest";

import {
  createPtyTerminalResponseFilter,
  PTY_CURSOR_POSITION_RESPONSE,
} from "./command-job-pty-terminal.js";

const CURSOR_POSITION_QUERY = "\u001b[6n";

describe("createPtyTerminalResponseFilter", () => {
  it("consumes cursor position queries and preserves surrounding command output", () => {
    const filter = createPtyTerminalResponseFilter();

    expect(filter.consume(`before${CURSOR_POSITION_QUERY}middle${CURSOR_POSITION_QUERY}after`)).toEqual({
      output: "beforemiddleafter",
      responses: [PTY_CURSOR_POSITION_RESPONSE, PTY_CURSOR_POSITION_RESPONSE],
    });
    expect(filter.flush()).toBe("");
  });

  it("recognizes a cursor position query across every chunk boundary", () => {
    for (let split = 1; split < CURSOR_POSITION_QUERY.length; split += 1) {
      const filter = createPtyTerminalResponseFilter();

      expect(filter.consume(CURSOR_POSITION_QUERY.slice(0, split))).toEqual({
        output: "",
        responses: [],
      });
      expect(filter.consume(CURSOR_POSITION_QUERY.slice(split))).toEqual({
        output: "",
        responses: [PTY_CURSOR_POSITION_RESPONSE],
      });
      expect(filter.flush()).toBe("");
    }
  });

  it("preserves similar controls and flushes an incomplete query on exit", () => {
    const filter = createPtyTerminalResponseFilter();

    expect(filter.consume("plain\u001b[5nmore\u001b[6")).toEqual({
      output: "plain\u001b[5nmore",
      responses: [],
    });
    expect(filter.flush()).toBe("\u001b[6");
    expect(filter.flush()).toBe("");
  });
});
