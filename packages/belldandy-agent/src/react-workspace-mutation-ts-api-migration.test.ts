import { describe, expect, it } from "vitest";

import {
  isRegressiveTraceValueImportCorrection,
  type TraceValuesApiMigrationRegressionInput,
} from "./react-workspace-mutation-ts-api-migration.js";

const apiPath = "jsonrpc/src/common/api.ts";
const connectionPath = "jsonrpc/src/common/connection.ts";
const protocolPath = "protocol/src/common/protocol.ts";
const requiredPaths = [apiPath, connectionPath, protocolPath];
const importLine = "\tNotificationHandler9, Trace, TraceValue, TraceFormat,";
const taskText = "Apply the frozen public API migration in the TypeScript monorepo, update all affected packages, and preserve the supplied tests. Remove the deprecated public TraceValues value/type aliases from jsonrpc, remove both barrel exports, and migrate protocol back to TraceValue. Change exactly jsonrpc/src/common/connection.ts, jsonrpc/src/common/api.ts, and protocol/src/common/protocol.ts.";

describe("TraceValues API migration correction regression", () => {
  it("detects removal of the still-exported TraceValue import after a complete migration", () => {
    expect(isRegressiveTraceValueImportCorrection(fixture())).toBe(true);
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
    expect(isRegressiveTraceValueImportCorrection(mutate(fixture()))).toBe(false);
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
