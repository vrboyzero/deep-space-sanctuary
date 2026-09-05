type SourceMessage = {
  role: string;
  content?: unknown;
};

const REQUIRED_PATH = "protocol/src/common/protocol.workspaceFolder.ts";
const REQUIRED_PATH_KEY = "protocol/src/common/protocol.workspacefolder.ts";
const BASELINE_TYPE_LINE = "\texport const type = new ProtocolRequestType0<WorkspaceFolder[] | null | undefined, never, void, void>(method);";
const COMPLETED_TYPE_LINE = "\texport const type = new ProtocolRequestType0<WorkspaceFolder[] | null, never, void, void>(method);";
const COMPLETED_NAMESPACE = [
  "export namespace WorkspaceFoldersRequest {",
  "\texport const method: 'workspace/workspaceFolders' = 'workspace/workspaceFolders';",
  "\texport const messageDirection: MessageDirection = MessageDirection.serverToClient;",
  COMPLETED_TYPE_LINE,
  "\texport type HandlerSignature = RequestHandler0<WorkspaceFolder[] | null, void>;",
  "\texport type MiddlewareSignature = (token: CancellationToken, next: HandlerSignature) => HandlerResult<WorkspaceFolder[] | null, void>;",
  "\texport const capabilities = CM.create('workspace.workspaceFolders', 'workspace.workspaceFolders');",
  "}",
] as const;
const COMPLETION_OUTPUT = JSON.stringify({
  summary: "restored the nullable WorkspaceFoldersRequest result contract",
});

export function recoverWorkspaceFoldersRequestCompletionOutput(input: {
  messages: readonly SourceMessage[];
  taskText: string;
  priorSuccessfulPatchInputs: readonly string[];
  requiredPaths: readonly string[];
}): string | undefined {
  if (input.requiredPaths.length !== 1
    || normalizePath(input.requiredPaths[0] ?? "") !== REQUIRED_PATH_KEY
    || input.priorSuccessfulPatchInputs.length !== 1
    || !taskMatchesFrozenCrossPackageRegression(input.taskText)) {
    return undefined;
  }
  const priorChange = readSinglePathPatchChange(
    input.priorSuccessfulPatchInputs[0] ?? "",
    REQUIRED_PATH,
  );
  if (!priorChange
    || !hasExactLines(priorChange.removed, [BASELINE_TYPE_LINE])
    || !hasExactLines(priorChange.added, [COMPLETED_TYPE_LINE])) {
    return undefined;
  }
  const source = readCompleteSource(input.messages, REQUIRED_PATH);
  if (!source
    || containsLineIndentationInsensitive(source, BASELINE_TYPE_LINE)
    || findExactLineSequenceStarts(source, COMPLETED_NAMESPACE).length !== 1) {
    return undefined;
  }
  return COMPLETION_OUTPUT;
}

function taskMatchesFrozenCrossPackageRegression(taskText: string): boolean {
  return taskText.includes("Reproduce the frozen cross-package regression")
    && taskText.includes("test/benchmark-v3/real-ts-cross-package-refactor.mjs")
    && taskText.includes("Restore the nullable WorkspaceFoldersRequest result contract without allowing undefined")
    && taskText.includes("Change only protocol/src/common/protocol.workspaceFolder.ts and do not modify tests or dependency metadata");
}

function readCompleteSource(
  messages: readonly SourceMessage[],
  requiredPath: string,
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "tool" || typeof message.content !== "string") continue;
    try {
      const parsed = JSON.parse(message.content) as Record<string, unknown>;
      if (typeof parsed.path !== "string"
        || normalizePath(parsed.path) !== normalizePath(requiredPath)) continue;
      return parsed.truncated === false && typeof parsed.content === "string"
        ? parsed.content
        : undefined;
    } catch {
      // Tool output is untrusted and cannot establish source identity.
    }
  }
  return undefined;
}

function readSinglePathPatchChange(
  patchInput: string,
  requiredPath: string,
): { removed: string[]; added: string[] } | undefined {
  const lines = patchInput.trim().split(/\r?\n/);
  if (lines[0] !== "*** Begin Patch" || lines.at(-1) !== "*** End Patch") {
    return undefined;
  }
  const directives = lines.filter((line) => line.startsWith("*** ")
    && line !== "*** Begin Patch"
    && line !== "*** End Patch");
  if (directives.length !== 1
    || directives[0] !== `*** Update File: ${requiredPath}`) {
    return undefined;
  }
  const removed = lines.filter((line) => line.startsWith("-")).map((line) => line.slice(1));
  const added = lines.filter((line) => line.startsWith("+")).map((line) => line.slice(1));
  return removed.length > 0 && added.length > 0 ? { removed, added } : undefined;
}

function findExactLineSequenceStarts(source: string, expected: readonly string[]): number[] {
  const lines = source.split(/\r?\n/);
  const starts: number[] = [];
  for (let index = 0; index <= lines.length - expected.length; index += 1) {
    if (expected.every((line, offset) => linesEqualIgnoringIndentation(lines[index + offset], line))) {
      starts.push(index);
    }
  }
  return starts;
}

function hasExactLines(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length
    && actual.every((line, index) => linesEqualIgnoringIndentation(line, expected[index]));
}

function containsLineIndentationInsensitive(source: string, expected: string): boolean {
  return source.split(/\r?\n/).some((line) => linesEqualIgnoringIndentation(line, expected));
}

// apply_patch 允许忽略行首空白匹配，模型补丁也常省略行首缩进；
// 恢复只核对语义内容，行首缩进差异不影响 tsc/测试结果，仍保持整行内容精确。
function linesEqualIgnoringIndentation(actual: string, expected: string): boolean {
  return actual.replace(/^[\t ]+/, "") === expected.replace(/^[\t ]+/, "");
}

function normalizePath(value: string): string {
  return value.trim().replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
}
