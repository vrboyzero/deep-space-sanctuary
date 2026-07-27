import type { TuiTab } from "./state.js";

export const TUI_TABS: readonly TuiTab[] = ["chat", "sessions", "changes", "runtime"];

const MAX_MOUSE_COORDINATE = 32_767;
const SGR_MOUSE_PATTERN = /^(?:\u001b)?\[<(\d+);(\d+);(\d+)([mM])$/;
const CSI_INPUT_PATTERN = /^\[[0-?]*[ -/]*[@-~]$/;
const MOUSE_MODE_ENABLE = "\u001b[?1000h\u001b[?1006h";
const MOUSE_MODE_DISABLE = "\u001b[?1006l\u001b[?1000l";

export type TuiInputKey = {
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  pageDown: boolean;
  pageUp: boolean;
  return: boolean;
  escape: boolean;
  ctrl: boolean;
  shift: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
  meta: boolean;
  super: boolean;
  eventType?: "press" | "repeat" | "release";
};

export type TuiModal = "permission" | "restore" | "command-job-cancel" | "remote-push";
export type TuiList = "permissions" | "conversations" | "worktrees" | "revisions" | "command-jobs";

export type TuiInputContext = {
  tab: TuiTab;
  changesFocus: "worktrees" | "revisions";
  modal?: TuiModal;
  busy: boolean;
  columns: number;
  rows: number;
  bodyHeight: number;
  conversationCount: number;
  selectedConversationIndex: number;
  workspaceTargetCount: number;
  selectedWorkspaceTargetIndex: number;
  revisionCount: number;
  selectedRevisionIndex: number;
  commandJobCount: number;
  selectedCommandJobIndex: number;
  runtimeAvailable?: boolean;
};

export type TuiInputAction =
  | { type: "ignored" }
  | { type: "modal.choice.toggle" }
  | { type: "modal.confirm"; choice?: 0 | 1 }
  | { type: "modal.dismiss" }
  | { type: "cancel-or-exit" }
  | { type: "tab.cycle"; offset: -1 | 1 }
  | { type: "tab.select"; tab: TuiTab }
  | { type: "changes.focus"; focus: "worktrees" | "revisions" }
  | { type: "list.move"; list: TuiList; offset: -1 | 1 }
  | { type: "list.select"; list: Exclude<TuiList, "permissions">; index: number }
  | { type: "page.navigate"; owner: "changes" | "command-jobs"; direction: "next" | "previous" }
  | { type: "command-job.cancel.request" }
  | { type: "remote-delivery.push.request" }
  | { type: "activate" }
  | { type: "transient.clear" }
  | { type: "input.backspace" }
  | { type: "input.insert"; text: string };

export type TuiMouseEvent = {
  button: "left" | "wheel-up" | "wheel-down";
  column: number;
  row: number;
};

export function parseTuiMouseInput(input: string): TuiMouseEvent | undefined {
  const match = SGR_MOUSE_PATTERN.exec(input);
  if (!match || match[4] !== "M") return undefined;
  const code = Number.parseInt(match[1]!, 10);
  const column = Number.parseInt(match[2]!, 10);
  const row = Number.parseInt(match[3]!, 10);
  if (!Number.isSafeInteger(code) || code < 0 || code > 127
    || !isMouseCoordinate(column) || !isMouseCoordinate(row)) return undefined;

  const baseCode = code & ~28;
  if (baseCode === 0) return { button: "left", column, row };
  if (baseCode === 64) return { button: "wheel-up", column, row };
  if (baseCode === 65) return { button: "wheel-down", column, row };
  return undefined;
}

export function resolveTuiInputAction(
  input: string,
  key: TuiInputKey,
  context: TuiInputContext,
): TuiInputAction {
  if (key.eventType === "release") return { type: "ignored" };
  if (context.modal) {
    if (context.modal === "permission" && (key.upArrow || key.downArrow)) {
      return { type: "list.move", list: "permissions", offset: key.upArrow ? -1 : 1 };
    }
    if (key.leftArrow || key.rightArrow || key.tab) return { type: "modal.choice.toggle" };
    if (key.return) return { type: "modal.confirm" };
    if (key.escape) return { type: "modal.dismiss" };
    return { type: "ignored" };
  }
  if (key.ctrl && input === "c") return { type: "cancel-or-exit" };
  if (context.tab === "changes" && key.ctrl && input.toLowerCase() === "p" && !context.busy) {
    return { type: "remote-delivery.push.request" };
  }
  if (key.tab) return { type: "tab.cycle", offset: key.shift ? -1 : 1 };
  if (context.tab === "changes" && (key.leftArrow || key.rightArrow)) {
    if (key.leftArrow && context.changesFocus === "revisions") return { type: "changes.focus", focus: "worktrees" };
    if (key.rightArrow && context.changesFocus === "worktrees") return { type: "changes.focus", focus: "revisions" };
  }
  if (key.leftArrow || key.rightArrow) return { type: "tab.cycle", offset: key.leftArrow ? -1 : 1 };
  if (context.tab === "changes" && (key.pageDown || key.pageUp)) {
    return { type: "page.navigate", owner: "changes", direction: key.pageDown ? "next" : "previous" };
  }
  if (context.tab === "runtime" && (key.pageDown || key.pageUp)) {
    return { type: "page.navigate", owner: "command-jobs", direction: key.pageDown ? "next" : "previous" };
  }
  if (context.tab === "runtime" && (key.backspace || key.delete)) return { type: "command-job.cancel.request" };
  if (key.upArrow || key.downArrow) {
    const list = activeList(context);
    return list ? { type: "list.move", list, offset: key.upArrow ? -1 : 1 } : { type: "ignored" };
  }
  if (key.return) return { type: "activate" };
  if (key.escape) return { type: "transient.clear" };
  if (context.tab !== "chat" || key.ctrl || key.meta || key.super || context.busy) return { type: "ignored" };
  if (key.backspace || key.delete) return { type: "input.backspace" };
  if (isTerminalControlInput(input)) return { type: "ignored" };
  const text = sanitizeTuiTextInput(input, Number.MAX_SAFE_INTEGER);
  return text ? { type: "input.insert", text } : { type: "ignored" };
}

export function resolveTuiMouseAction(event: TuiMouseEvent, context: TuiInputContext): TuiInputAction {
  if (context.modal) {
    if (event.button === "wheel-up" || event.button === "wheel-down") {
      return context.modal === "permission"
        ? { type: "list.move", list: "permissions", offset: event.button === "wheel-up" ? -1 : 1 }
        : { type: "ignored" };
    }
    const choice = resolveModalChoice(event, context);
    return choice === undefined ? { type: "ignored" } : { type: "modal.confirm", choice };
  }

  if (event.button === "left" && event.row === 2) {
    const tab = tabAtColumn(event.column);
    return tab ? { type: "tab.select", tab } : { type: "ignored" };
  }
  if (event.button === "wheel-up" || event.button === "wheel-down") {
    const list = activeList(context);
    return list
      ? { type: "list.move", list, offset: event.button === "wheel-up" ? -1 : 1 }
      : { type: "ignored" };
  }
  if (event.button !== "left") return { type: "ignored" };
  if (context.tab === "sessions") return resolveSessionsClick(event, context);
  if (context.tab === "changes") return resolveChangesClick(event, context);
  if (context.tab === "runtime") return resolveRuntimeClick(event, context);
  return { type: "ignored" };
}

export function sanitizeTuiTextInput(input: string, remainingCharacters: number): string {
  if (remainingCharacters <= 0) return "";
  const visible = input.replace(/[\u0000-\u001f\u007f]/g, "");
  let result = "";
  for (const character of visible) {
    if (result.length + character.length > remainingCharacters) break;
    result += character;
  }
  return result;
}

export function acquireTuiMouseMode(input: {
  stdinIsTTY: boolean;
  stdout: NodeJS.WriteStream;
  env: Readonly<Record<string, string | undefined>>;
}): { enabled: boolean; release: () => void } {
  if (!supportsTuiMouseMode(input.stdinIsTTY, input.stdout.isTTY === true, input.env)) {
    return { enabled: false, release: () => {} };
  }
  try {
    input.stdout.write(MOUSE_MODE_ENABLE);
  } catch {
    return { enabled: false, release: () => {} };
  }
  let released = false;
  return {
    enabled: true,
    release: () => {
      if (released) return;
      released = true;
      try {
        input.stdout.write(MOUSE_MODE_DISABLE);
      } catch {
        // Terminal teardown is best-effort when the output stream is already closed.
      }
    },
  };
}

function supportsTuiMouseMode(
  stdinIsTTY: boolean,
  stdoutIsTTY: boolean,
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  if (!stdinIsTTY || !stdoutIsTTY) return false;
  const term = env.TERM?.trim().toLowerCase() ?? "";
  if (term === "dumb") return false;
  if (/^(xterm|screen|tmux|rxvt|kitty|wezterm|foot|alacritty)(-|$)/.test(term)) return true;
  if (env.WT_SESSION || env.KITTY_WINDOW_ID || env.WEZTERM_PANE || env.TMUX) return true;
  return /^(vscode|wezterm|iterm\.app|apple_terminal|hyper|kitty)$/i.test(env.TERM_PROGRAM?.trim() ?? "");
}

function isMouseCoordinate(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_MOUSE_COORDINATE;
}

function isTerminalControlInput(input: string): boolean {
  return SGR_MOUSE_PATTERN.test(input) || CSI_INPUT_PATTERN.test(input);
}

function activeList(context: TuiInputContext): TuiList | undefined {
  if (context.tab === "sessions") return "conversations";
  if (context.tab === "changes") return context.changesFocus;
  if (context.tab === "runtime") return "command-jobs";
  return undefined;
}

function tabAtColumn(column: number): TuiTab | undefined {
  let start = 2;
  for (const tab of TUI_TABS) {
    const end = start + tab.length - 1;
    if (column >= start && column <= end) return tab;
    start = end + 2;
  }
  return undefined;
}

function resolveModalChoice(event: TuiMouseEvent, context: TuiInputContext): 0 | 1 | undefined {
  const footerContentRow = 4 + context.bodyHeight;
  if (event.row !== footerContentRow) return undefined;
  const widths = context.modal === "permission"
    ? [7, 6]
    : context.modal === "restore"
      ? [9, 8]
      : context.modal === "remote-push" ? [6, 8] : [12, 14];
  const end = context.columns - 2;
  const secondStart = end - widths[1]! + 1;
  const firstEnd = secondStart - 2;
  const firstStart = firstEnd - widths[0]! + 1;
  if (event.column >= firstStart && event.column <= firstEnd) return 0;
  if (event.column >= secondStart && event.column <= end) return 1;
  return undefined;
}

function resolveSessionsClick(event: TuiMouseEvent, context: TuiInputContext): TuiInputAction {
  const visibleCount = Math.max(1, context.bodyHeight - 2);
  const start = centeredStart(context.selectedConversationIndex, context.conversationCount, visibleCount);
  const offset = event.row - 4;
  const index = start + offset;
  return offset >= 0 && offset < visibleCount && index < context.conversationCount
    ? { type: "list.select", list: "conversations", index }
    : { type: "ignored" };
}

function resolveChangesClick(event: TuiMouseEvent, context: TuiInputContext): TuiInputAction {
  const compact = context.columns < 80;
  const leftWidth = compact ? context.columns : Math.max(30, Math.floor(context.columns * 0.5));
  const upperHeight = compact
    ? Math.max(3, Math.min(context.bodyHeight - 2, Math.ceil(context.bodyHeight * 0.65)))
    : context.bodyHeight;
  const worktrees = !compact ? event.column <= leftWidth : event.row < 3 + upperHeight;
  if (worktrees) {
    if (event.row === 4) return { type: "changes.focus", focus: "worktrees" };
    const maxLines = Math.max(1, Math.min(3, Math.floor((upperHeight - 5) / 4)));
    const start = centeredStart(context.selectedWorkspaceTargetIndex, context.workspaceTargetCount, maxLines);
    const index = start + event.row - 5;
    return event.row >= 5 && index >= start && index < start + maxLines && index < context.workspaceTargetCount
      ? { type: "list.select", list: "worktrees", index }
      : { type: "changes.focus", focus: "worktrees" };
  }

  const paneTop = compact ? 3 + upperHeight : 3;
  if (event.row === paneTop + 1) return { type: "changes.focus", focus: "revisions" };
  const index = event.row - (paneTop + 2);
  return index >= 0 && index < context.revisionCount
    ? { type: "list.select", list: "revisions", index }
    : { type: "changes.focus", focus: "revisions" };
}

function resolveRuntimeClick(event: TuiMouseEvent, context: TuiInputContext): TuiInputAction {
  const compact = context.columns < 80;
  const jobsHeight = compact
    ? Math.max(3, Math.min(Math.max(3, context.bodyHeight - 2), Math.ceil(context.bodyHeight * 0.55)))
    : context.bodyHeight;
  const summaryLineCount = context.runtimeAvailable ? 7 : 1;
  const maxLines = Math.max(1, jobsHeight - summaryLineCount - 4);
  const start = centeredStart(context.selectedCommandJobIndex, context.commandJobCount, maxLines);
  const firstRow = 5 + summaryLineCount;
  const index = start + event.row - firstRow;
  return event.row >= firstRow && index >= start && index < start + maxLines && index < context.commandJobCount
    ? { type: "list.select", list: "command-jobs", index }
    : { type: "ignored" };
}

function centeredStart(selectedIndex: number, total: number, visibleCount: number): number {
  return Math.max(0, Math.min(selectedIndex - Math.floor(visibleCount / 2), total - visibleCount));
}
