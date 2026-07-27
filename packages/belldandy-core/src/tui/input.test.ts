import { describe, expect, it, vi } from "vitest";

import {
  acquireTuiMouseMode,
  parseTuiMouseInput,
  resolveTuiInputAction,
  resolveTuiMouseAction,
  sanitizeTuiTextInput,
  type TuiInputContext,
  type TuiInputKey,
} from "./input.js";

const emptyKey: TuiInputKey = {
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  pageDown: false,
  pageUp: false,
  return: false,
  escape: false,
  ctrl: false,
  shift: false,
  tab: false,
  backspace: false,
  delete: false,
  meta: false,
  super: false,
};

const baseContext: TuiInputContext = {
  tab: "chat",
  changesFocus: "worktrees",
  modal: undefined,
  busy: false,
  columns: 100,
  rows: 24,
  bodyHeight: 19,
  conversationCount: 0,
  selectedConversationIndex: 0,
  workspaceTargetCount: 0,
  selectedWorkspaceTargetIndex: 0,
  revisionCount: 0,
  selectedRevisionIndex: 0,
  commandJobCount: 0,
  selectedCommandJobIndex: 0,
};

describe("TUI input contract", () => {
  it("parses bounded SGR mouse input and rejects malformed or release events", () => {
    expect(parseTuiMouseInput("[<0;16;2M")).toEqual({
      button: "left",
      column: 16,
      row: 2,
    });
    expect(parseTuiMouseInput("\u001b[<64;12;8M")).toEqual({
      button: "wheel-up",
      column: 12,
      row: 8,
    });
    expect(parseTuiMouseInput("[<0;16;2m")).toBeUndefined();
    expect(parseTuiMouseInput("[<0;0;2M")).toBeUndefined();
    expect(parseTuiMouseInput("[<4294967296;16;2M")).toBeUndefined();
    expect(parseTuiMouseInput("[<0;16;999999M")).toBeUndefined();
  });

  it("keeps modal input authoritative over tabs and underlying lists", () => {
    const modalContext = {
      ...baseContext,
      modal: "permission" as const,
      conversationCount: 3,
    };
    expect(resolveTuiInputAction("", { ...emptyKey, tab: true }, modalContext)).toEqual({ type: "modal.choice.toggle" });
    expect(resolveTuiMouseAction(
      { button: "left", column: 8, row: 2 },
      modalContext,
    )).toEqual({ type: "ignored" });
    expect(resolveTuiMouseAction(
      { button: "left", column: 87, row: 20 },
      modalContext,
    )).toEqual({ type: "ignored" });
    expect(resolveTuiMouseAction(
      { button: "wheel-down", column: 50, row: 10 },
      modalContext,
    )).toEqual({ type: "list.move", list: "permissions", offset: 1 });
  });

  it("maps keyboard and mouse to the same tab and list actions", () => {
    expect(resolveTuiInputAction("", { ...emptyKey, tab: true }, baseContext)).toEqual({
      type: "tab.cycle",
      offset: 1,
    });
    expect(resolveTuiMouseAction(
      { button: "left", column: 18, row: 2 },
      baseContext,
    )).toEqual({ type: "tab.select", tab: "changes" });

    const sessions = {
      ...baseContext,
      tab: "sessions" as const,
      conversationCount: 12,
      selectedConversationIndex: 6,
    };
    expect(resolveTuiInputAction("", { ...emptyKey, downArrow: true }, sessions)).toEqual({
      type: "list.move",
      list: "conversations",
      offset: 1,
    });
    expect(resolveTuiMouseAction(
      { button: "wheel-down", column: 20, row: 10 },
      sessions,
    )).toEqual({ type: "list.move", list: "conversations", offset: 1 });
  });

  it("drops terminal control input while preserving sanitized paste text", () => {
    expect(resolveTuiInputAction("[<0;16;2M", emptyKey, baseContext)).toEqual({ type: "ignored" });
    expect(resolveTuiInputAction("[31m", emptyKey, baseContext)).toEqual({ type: "ignored" });
    expect(sanitizeTuiTextInput("hello\n世界\u001b[31m", 64)).toBe("hello世界[31m");
    expect(sanitizeTuiTextInput("abcdef", 3)).toBe("abc");
  });

  it("opens remote push preview only from Changes with an explicit control chord", () => {
    const changes = { ...baseContext, tab: "changes" as const };
    expect(resolveTuiInputAction("p", { ...emptyKey, ctrl: true }, changes)).toEqual({
      type: "remote-delivery.push.request",
    });
    expect(resolveTuiInputAction("p", { ...emptyKey, ctrl: true }, baseContext)).toEqual({ type: "ignored" });
    expect(resolveTuiInputAction("p", emptyKey, changes)).toEqual({ type: "ignored" });
  });

  it("enables mouse reporting only for declared TTY terminals and restores it once", () => {
    const writes: string[] = [];
    const stdout = {
      isTTY: true,
      write: vi.fn((value: string) => {
        writes.push(value);
        return true;
      }),
    } as unknown as NodeJS.WriteStream;
    const lease = acquireTuiMouseMode({
      stdinIsTTY: true,
      stdout,
      env: { TERM: "xterm-256color" },
    });

    expect(lease.enabled).toBe(true);
    expect(writes).toEqual(["\u001b[?1000h\u001b[?1006h"]);
    lease.release();
    lease.release();
    expect(writes).toEqual([
      "\u001b[?1000h\u001b[?1006h",
      "\u001b[?1006l\u001b[?1000l",
    ]);

    const unsupportedWrite = vi.fn();
    const unsupported = acquireTuiMouseMode({
      stdinIsTTY: true,
      stdout: { isTTY: true, write: unsupportedWrite } as unknown as NodeJS.WriteStream,
      env: { TERM: "dumb" },
    });
    expect(unsupported.enabled).toBe(false);
    unsupported.release();
    expect(unsupportedWrite).not.toHaveBeenCalled();
  });
});
