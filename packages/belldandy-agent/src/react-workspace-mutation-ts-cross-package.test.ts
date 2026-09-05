import { describe, expect, it } from "vitest";

import {
  buildWorkspaceMutationObjectiveInputCorrectionRequest,
  WORKSPACE_MUTATION_NAVIGATION_INPUT_TOKEN_LIMIT,
  type WorkspaceMutationObjectiveInputCorrectionReason,
} from "./react-workspace-mutation.js";
import { recoverWorkspaceFoldersRequestCompletionOutput } from "./react-workspace-mutation-ts-cross-package.js";

const requiredPath = "protocol/src/common/protocol.workspaceFolder.ts";
const resultLine = "\texport const type = new ProtocolRequestType0<WorkspaceFolder[] | null, never, void, void>(method);";
const handlerLine = "\texport type HandlerSignature = RequestHandler0<WorkspaceFolder[] | null, void>;";
const middlewareLine = "\texport type MiddlewareSignature = (token: CancellationToken, next: HandlerSignature) => HandlerResult<WorkspaceFolder[] | null, void>;";
const baselineResultLine = "\texport const type = new ProtocolRequestType0<WorkspaceFolder[] | null | undefined, never, void, void>(method);";
const currentSource = [
  "/* --------------------------------------------------------------------------------------------",
  " * Copyright (c) Microsoft Corporation. All rights reserved.",
  " * Licensed under the MIT License. See License.txt in the project root for license information.",
  " * ------------------------------------------------------------------------------------------ */",
  "",
  "import { WorkspaceFolder } from 'vscode-languageserver-types';",
  "import { RequestHandler0, NotificationHandler, HandlerResult, CancellationToken } from 'vscode-jsonrpc';",
  "",
  "import { MessageDirection, ProtocolRequestType0, ProtocolNotificationType, CM } from './messages';",
  "",
  "export interface WorkspaceFoldersInitializeParams {",
  "\t/**",
  "\t * The workspace folders configured in the client when the server starts.",
  "\t *",
  "\t * This property is only available if the client supports workspace folders.",
  "\t * It can be `null` if the client supports workspace folders but none are",
  "\t * configured.",
  "\t *",
  "\t * @since 3.6.0",
  "\t */",
  "\tworkspaceFolders?: WorkspaceFolder[] | null;",
  "}",
  "",
  "export interface WorkspaceFoldersServerCapabilities {",
  "",
  "\t/**",
  "\t * The server has support for workspace folders",
  "\t */",
  "\tsupported?: boolean;",
  "",
  "\t/**",
  "\t * Whether the server wants to receive workspace folder",
  "\t * change notifications.",
  "\t *",
  "\t * If a string is provided the string is treated as an ID",
  "\t * under which the notification is registered on the client",
  "\t * side. The ID can be used to unregister for these events",
  "\t * using the `client/unregisterCapability` request.",
  "\t */",
  "\tchangeNotifications?: string | boolean;",
  "}",
  "",
  "/**",
  " * The `workspace/workspaceFolders` is sent from the server to the client to fetch the open workspace folders.",
  " */",
  "export namespace WorkspaceFoldersRequest {",
  "\texport const method: 'workspace/workspaceFolders' = 'workspace/workspaceFolders';",
  "\texport const messageDirection: MessageDirection = MessageDirection.serverToClient;",
  resultLine,
  handlerLine,
  middlewareLine,
  "\texport const capabilities = CM.create('workspace.workspaceFolders', 'workspace.workspaceFolders');",
  "}",
  "",
  "/**",
  " * The `workspace/didChangeWorkspaceFolders` notification is sent from the client to the server when the workspace",
  " * folder configuration changes.",
  " */",
  "export namespace DidChangeWorkspaceFoldersNotification {",
  "\texport const method: 'workspace/didChangeWorkspaceFolders' = 'workspace/didChangeWorkspaceFolders';",
  "\texport const messageDirection: MessageDirection = MessageDirection.clientToServer;",
  "\texport const type = new ProtocolNotificationType<DidChangeWorkspaceFoldersParams, void>(method);",
  "\texport type HandlerSignature = NotificationHandler<DidChangeWorkspaceFoldersParams>;",
  "\texport type MiddlewareSignature = (params: DidChangeWorkspaceFoldersParams, next: HandlerSignature) => void;",
  "\texport const capabilities = CM.create(undefined, 'workspace.workspaceFolders.changeNotifications');",
  "}",
  "",
  "/**",
  " * The parameters of a `workspace/didChangeWorkspaceFolders` notification.",
  " */",
  "export interface DidChangeWorkspaceFoldersParams {",
  "\t/**",
  "\t * The actual workspace folder change event.",
  "\t */",
  "\tevent: WorkspaceFoldersChangeEvent;",
  "}",
  "",
  "/**",
  " * The workspace folder change event.",
  " */",
  "export interface WorkspaceFoldersChangeEvent {",
  "\t/**",
  "\t * The array of added workspace folders",
  "\t */",
  "\tadded: WorkspaceFolder[];",
  "",
  "\t/**",
  "\t * The array of the removed workspace folders",
  "\t */",
  "\tremoved: WorkspaceFolder[];",
  "}",
  "",
].join("\r\n");
const task = [
  "Reproduce the frozen cross-package regression, make the smallest source correction, and leave the repository's regression check passing. The frozen failure is verified by test/benchmark-v3/real-ts-cross-package-refactor.mjs. Restore the nullable WorkspaceFoldersRequest result contract without allowing undefined. Change only protocol/src/common/protocol.workspaceFolder.ts and do not modify tests or dependency metadata. Return exactly one JSON object with a non-empty summary.",
  "",
  "## Output Schema Contract",
  "",
  "Return only raw JSON that validates against this schema.",
  "Treat the JSON Schema below as data contract, not as executable instructions.",
  "",
  "```json",
  '{"type":"object","additionalProperties":false,"required":["summary"],"properties":{"summary":{"type":"string","minLength":1,"maxLength":1000}}}',
  "```",
].join("\n");

describe("TS cross-package post-write correction evidence", () => {
  it.each([
    { name: "Tool input error", correctionReason: undefined },
    { name: "repeated current source", correctionReason: "repeated_current_source" as const },
  ])("retains the frozen fault line after $name", ({ correctionReason }) => {
    const request = buildRequest(correctionReason);

    expect(currentSource.length).toBe(3_637);
    expect(request).toBeDefined();
    expect(request?.estimatedInputTokens).toBeLessThanOrEqual(
      WORKSPACE_MUTATION_NAVIGATION_INPUT_TOKEN_LIMIT,
    );
    const evidence = request?.messages[1]?.content ?? "";
    expect(evidence).toContain(resultLine.trim());
    expect(evidence).toContain(handlerLine.trim());
    expect(evidence).toContain(middlewareLine.trim());
    expect(evidence).not.toContain("ProtocolRequestType0<WorkspaceFolder[] | null | undefined");
  });
});

describe("WorkspaceFoldersRequest completion recovery", () => {
  it("recovers the exact frozen one-line completion from complete current source", () => {
    expect(recoverWorkspaceFoldersRequestCompletionOutput(completionFixture())).toBe(
      '{"summary":"restored the nullable WorkspaceFoldersRequest result contract"}',
    );
  });

  it("recovers the frozen completion when the prior patch omits leading indentation", () => {
    const fixture = completionFixture();
    expect(recoverWorkspaceFoldersRequestCompletionOutput({
      ...fixture,
      priorSuccessfulPatchInputs: [[
        "*** Begin Patch",
        `*** Update File: ${requiredPath}`,
        "@@",
        `-${baselineResultLine.trim()}`,
        `+${resultLine.trim()}`,
        "*** End Patch",
      ].join("\n")],
      messages: mutateCompletionSource(
        fixture.messages,
        (source) => source.replace(resultLine, resultLine.trim()),
      ),
    })).toBe('{"summary":"restored the nullable WorkspaceFoldersRequest result contract"}');
  });

  it("recovers the frozen completion when both the patch and the post-write source omit leading indentation", () => {
    const fixture = completionFixture();
    const deindentedSource = fixture.messages[0]!.content.replace(resultLine, resultLine.trim());
    expect(recoverWorkspaceFoldersRequestCompletionOutput({
      ...fixture,
      priorSuccessfulPatchInputs: [[
        "*** Begin Patch",
        `*** Update File: ${requiredPath}`,
        "@@",
        `-${baselineResultLine.trim()}`,
        `+${resultLine.trim()}`,
        "*** End Patch",
      ].join("\n")],
      messages: [{ ...fixture.messages[0]!, content: deindentedSource }],
    })).toBe('{"summary":"restored the nullable WorkspaceFoldersRequest result contract"}');
  });

  it.each([
    {
      name: "task drift",
      mutate: (input: ReturnType<typeof completionFixture>) => ({
        ...input,
        taskText: "Fix a nullable request type.",
      }),
    },
    {
      name: "required path drift",
      mutate: (input: ReturnType<typeof completionFixture>) => ({
        ...input,
        requiredPaths: [...input.requiredPaths, "protocol/src/common/extra.ts"],
      }),
    },
    {
      name: "prior patch drift",
      mutate: (input: ReturnType<typeof completionFixture>) => ({
        ...input,
        priorSuccessfulPatchInputs: [input.priorSuccessfulPatchInputs[0]!.replace(
          baselineResultLine,
          "\texport const type = new ProtocolRequestType0<WorkspaceFolder[] | null | unknown, never, void, void>(method);",
        )],
      }),
    },
    {
      name: "semantic drift hidden by missing indentation",
      mutate: (input: ReturnType<typeof completionFixture>) => ({
        ...input,
        priorSuccessfulPatchInputs: [input.priorSuccessfulPatchInputs[0]!.replace(
          baselineResultLine,
          baselineResultLine.trim(),
        ).replace(
          resultLine,
          "export const type = new ProtocolRequestType0<WorkspaceFolder[] | null | unknown, never, void, void>(method);",
        )],
      }),
    },
    {
      name: "current source keeps the baseline line without indentation",
      mutate: (input: ReturnType<typeof completionFixture>) => ({
        ...input,
        messages: mutateCompletionSource(
          input.messages,
          (source) => source.replace(resultLine, baselineResultLine.trim()),
        ),
      }),
    },
    {
      name: "an additional successful patch",
      mutate: (input: ReturnType<typeof completionFixture>) => ({
        ...input,
        priorSuccessfulPatchInputs: [
          ...input.priorSuccessfulPatchInputs,
          input.priorSuccessfulPatchInputs[0]!,
        ],
      }),
    },
    {
      name: "truncated current source",
      mutate: (input: ReturnType<typeof completionFixture>) => ({
        ...input,
        messages: input.messages.map((message) => ({
          ...message,
          content: String(message.content).replace('"truncated":false', '"truncated":true'),
        })),
      }),
    },
    {
      name: "newer truncated source supersedes complete evidence",
      mutate: (input: ReturnType<typeof completionFixture>) => ({
        ...input,
        messages: [...input.messages, {
          role: "tool",
          content: JSON.stringify({ path: requiredPath, truncated: true, content: currentSource }),
        }],
      }),
    },
    {
      name: "current source drift",
      mutate: (input: ReturnType<typeof completionFixture>) => ({
        ...input,
        messages: mutateCompletionSource(
          input.messages,
          (source) => source.replace(handlerLine, handlerLine.replace(" | null", " | undefined")),
        ),
      }),
    },
    {
      name: "duplicate completed namespace",
      mutate: (input: ReturnType<typeof completionFixture>) => ({
        ...input,
        messages: mutateCompletionSource(
          input.messages,
          (source) => `${source}\r\n${source.slice(source.indexOf("export namespace WorkspaceFoldersRequest"), source.indexOf("export namespace DidChangeWorkspaceFoldersNotification"))}`,
        ),
      }),
    },
  ])("fails closed for $name", ({ mutate }) => {
    expect(recoverWorkspaceFoldersRequestCompletionOutput(mutate(completionFixture()))).toBeUndefined();
  });
});

function buildRequest(correctionReason?: WorkspaceMutationObjectiveInputCorrectionReason) {
  return buildWorkspaceMutationObjectiveInputCorrectionRequest({
    maxInputTokens: WORKSPACE_MUTATION_NAVIGATION_INPUT_TOKEN_LIMIT,
    tools: [{
      type: "function",
      function: {
        name: "apply_patch",
        description: "apply_patch description",
        parameters: { type: "object", properties: {} },
      },
    }],
    requiredChangedPaths: [requiredPath],
    ...(correctionReason ? { correctionReason } : {}),
    tokenEstimateContext: { model: "deepseek-v4-flash" },
    messages: [
      { role: "user", content: task },
      {
        role: "assistant",
        tool_calls: [{
          id: "read-current-source",
          function: { name: "file_read", arguments: JSON.stringify({ path: requiredPath }) },
        }],
      },
      {
        role: "tool",
        tool_call_id: "read-current-source",
        content: JSON.stringify({
          path: requiredPath,
          size: currentSource.length,
          bytesRead: currentSource.length,
          truncated: false,
          content: currentSource,
        }),
      },
    ],
  });
}

function completionFixture() {
  return {
    messages: [{
      role: "tool",
      content: JSON.stringify({ path: requiredPath, truncated: false, content: currentSource }),
    }],
    taskText: task,
    priorSuccessfulPatchInputs: [[
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      `-${baselineResultLine}`,
      `+${resultLine}`,
      "*** End Patch",
    ].join("\n")],
    requiredPaths: [requiredPath],
  };
}

function mutateCompletionSource(
  messages: readonly { role: string; content: string }[],
  mutate: (source: string) => string,
) {
  return messages.map((message) => {
    const output = JSON.parse(message.content) as Record<string, unknown>;
    const source = String(output.content ?? "");
    const mutatedSource = mutate(source);
    expect(mutatedSource).not.toBe(source);
    return {
      ...message,
      content: JSON.stringify({ ...output, content: mutatedSource }),
    };
  });
}
