import { describe, expect, it } from "vitest";

import {
  isUnsafeCorrectionAfterCompletedTraceValuesApiMigration,
  rebuildTraceValuesApiMigrationToolCall,
  type TraceValuesApiMigrationRegressionInput,
} from "./react-workspace-mutation-ts-api-migration.js";

const apiPath = "jsonrpc/src/common/api.ts";
const connectionPath = "jsonrpc/src/common/connection.ts";
const protocolPath = "protocol/src/common/protocol.ts";
const requiredPaths = [apiPath, connectionPath, protocolPath];
const importLine = "\tNotificationHandler9, Trace, TraceValue, TraceFormat,";
const taskText = "Apply the frozen public API migration in the TypeScript monorepo, update all affected packages, and preserve the supplied tests. Remove the deprecated public TraceValues value/type aliases from jsonrpc, remove both barrel exports, and migrate protocol back to TraceValue. Change exactly jsonrpc/src/common/connection.ts, jsonrpc/src/common/api.ts, and protocol/src/common/protocol.ts.";

describe("TraceValues API migration recovery", () => {
  it("rebuilds the frozen three-file migration from complete source evidence", () => {
    const rebuilt = rebuildTraceValuesApiMigrationToolCall(recoveryFixture());

    expect(rebuilt).toBeDefined();
    const patchInput = readPatchInput(rebuilt!);
    expect(patchInput.match(/^\*\*\* Update File:/gm)).toHaveLength(3);
    for (const path of requiredPaths) {
      expect(patchInput.split(/\r?\n/).filter((line) => line === `*** Update File: ${path}`)).toHaveLength(1);
    }
    expect(patchInput).toContain("-export const TraceValues = TraceValue;");
    expect(patchInput).toContain("-export type TraceValues = TraceValue;");
    expect(patchInput).toContain("-\tCancellationReceiverStrategy, IdCancellationReceiverStrategy, RequestCancellationReceiverStrategy, CancellationSenderStrategy, CancellationStrategy, MessageStrategy, TraceValues");
    expect(patchInput).toContain("+\tCancellationReceiverStrategy, IdCancellationReceiverStrategy, RequestCancellationReceiverStrategy, CancellationSenderStrategy, CancellationStrategy, MessageStrategy");
    expect(patchInput).toContain("-\tNotificationHandler4, NotificationHandler5, NotificationHandler6, NotificationHandler7, NotificationHandler8, NotificationHandler9, Trace, TraceValue, TraceValues, TraceFormat,");
    expect(patchInput).toContain("+\tNotificationHandler4, NotificationHandler5, NotificationHandler6, NotificationHandler7, NotificationHandler8, NotificationHandler9, Trace, TraceValue, TraceFormat,");
    expect(patchInput).toContain("-import { ProgressToken, RequestHandler, TraceValues } from 'vscode-jsonrpc';");
    expect(patchInput).toContain("+import { ProgressToken, RequestHandler, TraceValue } from 'vscode-jsonrpc';");
    expect(patchInput).toContain("-\ttrace?: TraceValues;");
    expect(patchInput).toContain("+\ttrace?: TraceValue;");
  });

  it.each([
    {
      name: "task drift",
      mutate: (input: ReturnType<typeof recoveryFixture>) => ({
        ...input,
        taskText: "Remove a deprecated TypeScript alias.",
      }),
    },
    {
      name: "required path drift",
      mutate: (input: ReturnType<typeof recoveryFixture>) => ({
        ...input,
        requiredPaths: [...input.requiredPaths, "jsonrpc/src/common/extra.ts"],
      }),
    },
    {
      name: "truncated source evidence",
      mutate: (input: ReturnType<typeof recoveryFixture>) => ({
        ...input,
        messages: input.messages.map((message) => message.role === "tool"
          ? { ...message, content: String(message.content).replace('"truncated":false', '"truncated":true') }
          : message),
      }),
    },
    {
      name: "newer truncated source supersedes older complete evidence",
      mutate: (input: ReturnType<typeof recoveryFixture>) => ({
        ...input,
        messages: [...input.messages, {
          role: "tool",
          content: JSON.stringify({
            path: apiPath,
            truncated: true,
            content: "newer incomplete source",
          }),
        }],
      }),
    },
    {
      name: "source shape drift",
      mutate: (input: ReturnType<typeof recoveryFixture>) => ({
        ...input,
        messages: input.messages.map((message) => ({
          ...message,
          content: typeof message.content === "string"
            ? message.content.replace("export const TraceValues = TraceValue;", "export const TraceValues = readTraceValue();")
            : message.content,
        })),
      }),
    },
  ])("fails closed for $name", ({ mutate }) => {
    expect(rebuildTraceValuesApiMigrationToolCall(mutate(recoveryFixture()))).toBeUndefined();
  });
});

describe("TraceValues API migration correction regression", () => {
  it.each([
    {
      name: "removal of the still-exported TraceValue import",
      mutate: (input: TraceValuesApiMigrationRegressionInput) => input,
    },
    {
      name: "a stale multi-file correction whose removed lines are absent",
      mutate: (input: TraceValuesApiMigrationRegressionInput) => ({
        ...input,
        correctionChanges: [
          {
            path: apiPath,
            removed: [
              "export type TraceValue = Trace.Values;",
              "export { Trace as TraceValues };",
            ],
            added: [],
          },
          {
            path: connectionPath,
            removed: ["export { TraceValues, TraceValue } from './api';"],
            added: [],
          },
          {
            path: protocolPath,
            removed: ["import { TraceValues } from 'vscode-jsonrpc';"],
            added: ["import { TraceValue } from 'vscode-jsonrpc';"],
          },
        ],
      }),
    },
  ])("detects $name after a complete migration", ({ mutate }) => {
    expect(isUnsafeCorrectionAfterCompletedTraceValuesApiMigration(mutate(fixture()))).toBe(true);
  });

  it.each([
    {
      name: "task drift",
      mutate: (input: TraceValuesApiMigrationRegressionInput) => ({
        ...input,
        taskText: "Remove a deprecated alias.",
      }),
    },
    {
      name: "required path drift",
      mutate: (input: TraceValuesApiMigrationRegressionInput) => ({
        ...input,
        requiredPaths: [...input.requiredPaths, "jsonrpc/src/common/extra.ts"],
      }),
    },
    {
      name: "prior patch drift",
      mutate: (input: TraceValuesApiMigrationRegressionInput) => ({
        ...input,
        priorChanges: input.priorChanges.filter((change) => change.path !== protocolPath),
      }),
    },
    {
      name: "extra prior delta",
      mutate: (input: TraceValuesApiMigrationRegressionInput) => ({
        ...input,
        priorChanges: [...input.priorChanges, {
          path: connectionPath,
          removed: ["export const unrelated = true;"],
          added: ["export const unrelated = false;"],
        }],
      }),
    },
    {
      name: "current source drift",
      mutate: (input: TraceValuesApiMigrationRegressionInput) => ({
        ...input,
        currentSources: new Map(input.currentSources).set(
          apiPath,
          input.currentSources.get(apiPath)!.replace("export { Trace, TraceValue, TraceFormat };", "export { Trace, TraceFormat };"),
        ),
      }),
    },
    {
      name: "correction drift",
      mutate: (input: TraceValuesApiMigrationRegressionInput) => ({
        ...input,
        correctionChanges: [{
          path: apiPath,
          removed: [importLine],
          added: [importLine.replace("TraceFormat", "TraceOptions")],
        }],
      }),
    },
    {
      name: "comment-shaped correction",
      mutate: (input: TraceValuesApiMigrationRegressionInput) => {
        const source = input.currentSources.get(apiPath)!;
        const commentLine = "\t// TraceValue, remains part of the public API";
        return {
          ...input,
          currentSources: new Map(input.currentSources).set(
            apiPath,
            source.replace(importLine, `${commentLine}\n${importLine}`),
          ),
          correctionChanges: [{
            path: apiPath,
            removed: [commentLine],
            added: [commentLine.replace("TraceValue, ", "")],
          }],
        };
      },
    },
  ])("fails closed for $name", ({ mutate }) => {
    expect(isUnsafeCorrectionAfterCompletedTraceValuesApiMigration(mutate(fixture()))).toBe(false);
  });
});

function fixture(): TraceValuesApiMigrationRegressionInput {
  return {
    taskText,
    requiredPaths,
    priorChanges: [
      {
        path: connectionPath,
        removed: [
          "export const TraceValues = TraceValue;",
          "export type TraceValues = TraceValue;",
        ],
        added: [],
      },
      {
        path: apiPath,
        removed: [
          "import { Trace, TraceValue, TraceValues, TraceFormat } from './connection';",
          "export { Trace, TraceValue, TraceValues, TraceFormat };",
        ],
        added: [
          "import { Trace, TraceValue, TraceFormat } from './connection';",
          "export { Trace, TraceValue, TraceFormat };",
        ],
      },
      {
        path: protocolPath,
        removed: [
          "import { ProgressToken, RequestHandler, TraceValues } from 'vscode-jsonrpc';",
          "\ttrace?: TraceValues;",
        ],
        added: [
          "import { ProgressToken, RequestHandler, TraceValue } from 'vscode-jsonrpc';",
          "\ttrace?: TraceValue;",
        ],
      },
    ],
    correctionChanges: [{
      path: apiPath,
      removed: [importLine],
      added: [importLine.replace("TraceValue, ", "")],
    }],
    currentSources: new Map([
      [apiPath, [
        "import {",
        importLine,
        "} from './connection';",
        "export { Trace, TraceValue, TraceFormat };",
      ].join("\n")],
      [connectionPath, [
        "export namespace TraceValue {",
        "\texport const Off: 'off' = 'off';",
        "}",
        "export type TraceValue = 'off' | 'messages' | 'compact' | 'verbose';",
      ].join("\n")],
      [protocolPath, [
        "import { ProgressToken, RequestHandler, TraceValue } from 'vscode-jsonrpc';",
        "export interface _InitializeParams {",
        "\ttrace?: TraceValue;",
        "}",
      ].join("\n")],
    ]),
  };
}

function recoveryFixture() {
  const sources = new Map([
    [apiPath, [
      "import {",
      "\tNotificationHandler4, NotificationHandler5, NotificationHandler6, NotificationHandler7, NotificationHandler8, NotificationHandler9, Trace, TraceValue, TraceFormat,",
      "\tTraceOptions, SetTraceParams, SetTraceNotification, LogTraceParams, LogTraceNotification, Tracer, ConnectionErrors, ConnectionError, CancellationId,",
      "\tCancellationReceiverStrategy, IdCancellationReceiverStrategy, RequestCancellationReceiverStrategy, CancellationSenderStrategy, CancellationStrategy, MessageStrategy, TraceValues",
      "} from './connection';",
      "export {",
      "\tNotificationHandler4, NotificationHandler5, NotificationHandler6, NotificationHandler7, NotificationHandler8, NotificationHandler9, Trace, TraceValue, TraceValues, TraceFormat,",
      "\tCancellationReceiverStrategy, IdCancellationReceiverStrategy, RequestCancellationReceiverStrategy, CancellationSenderStrategy, CancellationStrategy, MessageStrategy",
      "};",
    ].join("\r\n")],
    [connectionPath, [
      "export namespace TraceValue {",
      "\texport const Off: 'off' = 'off';",
      "}",
      "export type TraceValue = 'off' | 'messages' | 'compact' | 'verbose';",
      "",
      "/**",
      " * @deprecated Use TraceValue instead",
      " */",
      "export const TraceValues = TraceValue;",
      "export type TraceValues = TraceValue;",
      "",
      "export namespace Trace {",
    ].join("\r\n")],
    [protocolPath, [
      "import { ProgressToken, RequestHandler, TraceValues } from 'vscode-jsonrpc';",
      "export interface _InitializeParams {",
      "\ttrace?: TraceValues;",
      "}",
    ].join("\n")],
  ]);
  return {
    toolCall: {
      id: "incomplete-migration",
      function: {
        name: "apply_patch",
        arguments: JSON.stringify({
          input: [
            "*** Begin Patch",
            `*** Update File: ${connectionPath}`,
            "@@",
            "-export const TraceValues = TraceValue;",
            "-export type TraceValues = TraceValue;",
            "*** End Patch",
          ].join("\n"),
        }),
      },
    },
    messages: [...sources].map(([path, content]) => ({
      role: "tool",
      content: JSON.stringify({ path, truncated: false, content }),
    })),
    taskText,
    priorSuccessfulPatchInputs: [],
    requiredPaths,
  };
}

function readPatchInput(toolCall: { function: { arguments: string } }): string {
  return (JSON.parse(toolCall.function.arguments) as { input: string }).input;
}
