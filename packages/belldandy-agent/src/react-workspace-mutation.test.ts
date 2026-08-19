import { describe, expect, it } from "vitest";

import {
  buildWorkspaceMutationContinuationPlan,
  buildWorkspaceMutationContinuationRequest,
  buildWorkspaceMutationNavigationRequest,
  buildWorkspaceMutationObjectiveReviewRequest,
  buildWorkspaceMutationRecoveryPlan,
  buildWorkspaceMutationRecoveryRequest,
  buildWorkspaceMutationVerificationRequest,
  canPreserveContextOnlyWorkspaceMutationPatchHunks,
  coalesceWorkspaceMutationApplyPatchEnvelopes,
  coalesceWorkspaceMutationApplyPatchToolCalls,
  hasDisjointSmallestChangeCorrectionHunks,
  hasExpandedSmallestChangeCorrectionHunks,
  hasBroadenedSmallestChangeCorrectionHunks,
  hasRevertedSmallestChangeCorrectionHunks,
  hasRedundantWorkspaceMutationPatchHunks,
  inspectContextOnlyWorkspaceMutationPatchPreservation,
  inspectWorkspaceMutationPatchHunks,
  normalizeWorkspaceMutationRecoveryToolCall,
  retainActionableWorkspaceMutationPatchSections,
  retainMissingWorkspaceMutationPatchSections,
  selectRequiredWorkspaceMutationNavigationToolCalls,
  selectRequiredWorkspaceMutationVerificationToolCalls,
  selectWorkspaceMutationNavigationToolDefinitions,
  selectWorkspaceMutationToolDefinitions,
  WORKSPACE_MUTATION_RECOVERY_MIN_OUTPUT_TOKEN_RESERVE,
  WORKSPACE_MUTATION_RECOVERY_OUTPUT_TOKEN_RESERVE,
} from "./react-workspace-mutation.js";

describe("ReAct workspace mutation recovery", () => {
  it("detects a smallest-change correction that leaves the prior patch delta intact", () => {
    const priorPatch = [
      "*** Begin Patch",
      "*** Update File: src/diff/props.js",
      "@@",
      "-} else if (value != NULL && value !== false) {",
      "+} else if (value != NULL) {",
      "*** End Patch",
    ].join("\n");
    const disjointCorrection = applyPatchToolCall([
      "*** Begin Patch",
      "*** Update File: src/diff/props.js",
      "@@",
      "-dom.setAttribute(name, value);",
      "+dom.setAttribute(name, value == false ? false : value);",
      "*** End Patch",
    ]);
    const refiningCorrection = applyPatchToolCall([
      "*** Begin Patch",
      "*** Update File: src/diff/props.js",
      "@@",
      "-} else if (value != NULL) {",
      "+} else if (value != NULL && (value !== false || name[4] == '-')) {",
      "*** End Patch",
    ]);
    const retainedCorrection = applyPatchToolCall([
      "*** Begin Patch",
      "*** Update File: src/diff/props.js",
      "@@",
      "-if (typeof value == 'function') {",
      "-  // never serialize functions as attribute values",
      "-} else if (value != NULL) {",
      "+if (typeof value == 'function') {",
      "+  // never serialize functions as attribute values",
      "+} else if (name[0] == 'a' && value === false) {",
      "+  // false aria-* values should be removed",
      "+} else if (value != NULL) {",
      "*** End Patch",
    ]);
    expect(hasDisjointSmallestChangeCorrectionHunks(
      disjointCorrection,
      [priorPatch],
      "Restore the behavior with the smallest change.",
    )).toBe(true);
    expect(hasDisjointSmallestChangeCorrectionHunks(
      refiningCorrection,
      [priorPatch],
      "Restore the behavior with the smallest change.",
    )).toBe(false);
    expect(hasDisjointSmallestChangeCorrectionHunks(
      disjointCorrection,
      [priorPatch],
      "Restore the behavior.",
    )).toBe(false);
    expect(hasDisjointSmallestChangeCorrectionHunks(
      retainedCorrection,
      [priorPatch],
      "Restore the behavior with the smallest change.",
    )).toBe(false);
    expect(hasExpandedSmallestChangeCorrectionHunks(
      retainedCorrection,
      [priorPatch],
      "Restore the behavior with the smallest change.",
    )).toBe(true);
  });

  it("keeps the smallest-change correction guard conservative across patch shapes", () => {
    const priorPatch = [
      "*** Begin Patch",
      "*** Update File: src/diff/props.js",
      "@@",
      "-old condition",
      "+broad condition",
      "*** End Patch",
    ].join("\n");
    const multiHunkRefinement = applyPatchToolCall([
      "*** Begin Patch",
      "*** Update File: src/diff/props.js",
      "@@",
      "-broad condition",
      "+narrow condition",
      "@@",
      "-old adjacent line",
      "+new adjacent line",
      "*** End Patch",
    ]);
    const differentPathCorrection = applyPatchToolCall([
      "*** Begin Patch",
      "*** Update File: src/diff/helpers.js",
      "@@",
      "-old helper",
      "+new helper",
      "*** End Patch",
    ]);
    const deletionOnlyCorrection = applyPatchToolCall([
      "*** Begin Patch",
      "*** Update File: src/diff/props.js",
      "@@",
      "-unrelated fallback",
      "*** End Patch",
    ]);
    const deletionOnlyPriorPatch = [
      "*** Begin Patch",
      "*** Update File: src/diff/props.js",
      "@@",
      "-legacy condition",
      "*** End Patch",
    ].join("\n");

    expect(hasDisjointSmallestChangeCorrectionHunks(
      multiHunkRefinement,
      [priorPatch],
      "Use the minimal patch.",
    )).toBe(false);
    expect(hasDisjointSmallestChangeCorrectionHunks(
      differentPathCorrection,
      [priorPatch],
      "Use the minimal patch.",
    )).toBe(false);
    expect(hasDisjointSmallestChangeCorrectionHunks(
      deletionOnlyCorrection,
      [priorPatch],
      "Use the minimal patch.",
    )).toBe(true);
    expect(hasDisjointSmallestChangeCorrectionHunks(
      deletionOnlyCorrection,
      [deletionOnlyPriorPatch],
      "Use the minimal patch.",
    )).toBe(false);
  });

  it("detects a smallest-change correction that expands a prior one-line mutation into a block rewrite", () => {
    const priorPatch = [
      "*** Begin Patch",
      "*** Update File: src/diff/props.js",
      "@@",
      "-} else if (value != NULL && value !== false) {",
      "+} else if (value != NULL) {",
      "*** End Patch",
    ].join("\n");
    const expandedCorrection = applyPatchToolCall([
      "*** Begin Patch",
      "*** Update File: src/diff/props.js",
      "@@",
      "-if (typeof value == 'function') {",
      "-  // never serialize functions as attribute values",
      "-} else if (value != NULL) {",
      "-  dom.setAttribute(name, value);",
      "-} else {",
      "-  dom.removeAttribute(name);",
      "+if (value == NULL) {",
      "+  dom.removeAttribute(name);",
      "+} else if (typeof value == 'function') {",
      "+  // never serialize functions as attribute values",
      "+} else {",
      "+  dom.setAttribute(name, value);",
      "+}",
      "*** End Patch",
    ]);
    const refiningCorrection = applyPatchToolCall([
      "*** Begin Patch",
      "*** Update File: src/diff/props.js",
      "@@",
      "-} else if (value != NULL) {",
      "+} else if (value != NULL && (value !== false || name[4] == '-')) {",
      "*** End Patch",
    ]);
    const broadeningCorrection = applyPatchToolCall([
      "*** Begin Patch",
      "*** Update File: src/diff/props.js",
      "@@",
      "-\t\t} else if (value != NULL && (value !== false || name.indexOf('aria-') === 0)) {",
      "+\t\t} else if (value != NULL) {",
      "*** End Patch",
    ]);
    const boundedBlockCorrection = applyPatchToolCall([
      "*** Begin Patch",
      "*** Update File: src/diff/props.js",
      "@@",
      "-if (ready) {",
      "-} else if (value != NULL) {",
      "-  set(value);",
      "+if (ready && value != NULL) {",
      "+} else if (value !== false) {",
      "+  set(value);",
      "*** End Patch",
    ]);
    const differentPathExpansion = applyPatchToolCall([
      "*** Begin Patch",
      "*** Update File: src/diff/helpers.js",
      "@@",
      "-old one",
      "-old two",
      "-old three",
      "-old four",
      "+new one",
      "+new two",
      "+new three",
      "+new four",
      "*** End Patch",
    ]);
    const secondPriorPatch = [
      "*** Begin Patch",
      "*** Update File: src/diff/props.js",
      "@@",
      "-old fallback",
      "+broad fallback",
      "*** End Patch",
    ].join("\n");
    const multiPriorRefinement = applyPatchToolCall([
      "*** Begin Patch",
      "*** Update File: src/diff/props.js",
      "@@",
      "-} else if (value != NULL) {",
      "-  old adjacent condition",
      "+} else if (value !== false) {",
      "+  new adjacent condition",
      "@@",
      "-broad fallback",
      "-  old adjacent fallback",
      "+narrow fallback",
      "+  new adjacent fallback",
      "*** End Patch",
    ]);
    const mixedPathRefinement = applyPatchToolCall([
      "*** Begin Patch",
      "*** Update File: src/diff/props.js",
      "@@",
      "-} else if (value != NULL) {",
      "+} else if (value !== false) {",
      "*** Update File: src/diff/helpers.js",
      "@@",
      "-old one",
      "-old two",
      "-old three",
      "-old four",
      "+new one",
      "+new two",
      "+new three",
      "+new four",
      "*** End Patch",
    ]);

    expect(hasExpandedSmallestChangeCorrectionHunks(
      expandedCorrection,
      [priorPatch],
      "Restore the behavior with the smallest change.",
    )).toBe(true);
    expect(hasExpandedSmallestChangeCorrectionHunks(
      refiningCorrection,
      [priorPatch],
      "Restore the behavior with the smallest change.",
    )).toBe(false);
    expect(hasExpandedSmallestChangeCorrectionHunks(
      expandedCorrection,
      [priorPatch],
      "Restore the behavior.",
    )).toBe(false);
    expect(hasExpandedSmallestChangeCorrectionHunks(
      boundedBlockCorrection,
      [priorPatch],
      "Restore the behavior with the smallest change.",
    )).toBe(false);
    expect(hasExpandedSmallestChangeCorrectionHunks(
      differentPathExpansion,
      [priorPatch],
      "Restore the behavior with the smallest change.",
    )).toBe(false);
    expect(hasExpandedSmallestChangeCorrectionHunks(
      multiPriorRefinement,
      [priorPatch, secondPriorPatch],
      "Restore the behavior with the smallest change.",
    )).toBe(false);
    expect(hasExpandedSmallestChangeCorrectionHunks(
      mixedPathRefinement,
      [priorPatch],
      "Restore the behavior with the smallest change.",
    )).toBe(false);
  });

  it("counts only effective prior changes when a hunk repeats an unchanged line", () => {
    const formalPriorPatch = [
      "*** Begin Patch",
      "*** Update File: src/diff/props.js",
      "@@",
      "-\t\t} else if (value != NULL && value !== false) {",
      "+\t\t} else if (value != NULL) {",
      "-\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
      "+\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
      "*** End Patch",
    ].join("\n");
    const formalCorrection = applyPatchToolCall([
      "*** Begin Patch",
      "*** Update File: src/diff/props.js",
      "@@",
      "-\t\tif (typeof value == 'function') {",
      "-\t\t\t// never serialize functions as attribute values",
      "-\t\t} else if (value != NULL) {",
      "+\t\tif (typeof value == 'function') {",
      "+\t\t\t// never serialize functions as attribute values",
      "+\t\t} else if (name[0] == 'a' && name[1] == 'r' && name[2] == 'i' && name[3] == 'a' && name[4] == '-' && value === false) {",
      "+\t\t\t// false aria-* values should be removed",
      "+\t\t} else if (value != NULL) {",
      "*** End Patch",
    ]);

    expect(hasExpandedSmallestChangeCorrectionHunks(
      formalCorrection,
      [formalPriorPatch],
      "Restore the behavior with the smallest change.",
    )).toBe(true);
  });

  it("detects a smallest-change correction that exactly reverses a prior mutation", () => {
    const priorPatch = [
      "*** Begin Patch",
      "*** Update File: src/diff/props.js",
      "@@",
      "-\t\t} else if (value != NULL && value !== false) {",
      "+\t\t} else if (value != NULL && (value !== false || name.indexOf('aria-') === 0)) {",
      "*** End Patch",
    ].join("\n");
    const revertingCorrection = applyPatchToolCall([
      "*** Begin Patch",
      "*** Update File: src/diff/props.js",
      "@@",
      "-\t\t} else if (value != NULL && (value !== false || name.indexOf('aria-') === 0)) {",
      "+\t\t} else if (value != NULL && value !== false) {",
      " \t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
      "*** End Patch",
    ]);
    const refiningCorrection = applyPatchToolCall([
      "*** Begin Patch",
      "*** Update File: src/diff/props.js",
      "@@",
      "-\t\t} else if (value != NULL && (value !== false || name.indexOf('aria-') === 0)) {",
      "+\t\t} else if (value != NULL && (value !== false || name[4] == '-')) {",
      "*** End Patch",
    ]);
    const broadeningCorrection = applyPatchToolCall([
      "*** Begin Patch",
      "*** Update File: src/diff/props.js",
      "@@",
      "-\t\t} else if (value != NULL && (value !== false || name.indexOf('aria-') === 0)) {",
      "+\t\t} else if (value != NULL) {",
      "*** End Patch",
    ]);
    const revertingWithIndependentChange = applyPatchToolCall([
      "*** Begin Patch",
      "*** Update File: src/diff/props.js",
      "@@",
      "-\t\t} else if (value != NULL && (value !== false || name.indexOf('aria-') === 0)) {",
      "+\t\t} else if (value != NULL && value !== false) {",
      "@@",
      "-old helper",
      "+new helper",
      "*** End Patch",
    ]);
    const secondPriorPatch = [
      "*** Begin Patch",
      "*** Update File: src/diff/helpers.js",
      "@@",
      "-old helper",
      "+new helper",
      "*** End Patch",
    ].join("\n");
    const revertingAcrossPriorPaths = applyPatchToolCall([
      "*** Begin Patch",
      "*** Update File: src/diff/props.js",
      "@@",
      "-\t\t} else if (value != NULL && (value !== false || name.indexOf('aria-') === 0)) {",
      "+\t\t} else if (value != NULL && value !== false) {",
      "*** Update File: src/diff/helpers.js",
      "@@",
      "-new helper",
      "+old helper",
      "*** End Patch",
    ]);
    const multiLinePriorPatch = [
      "*** Begin Patch",
      "*** Update File: src/diff/props.js",
      "@@",
      "-old first",
      "-old second",
      "+new first",
      "+new second",
      "*** End Patch",
    ].join("\n");
    const partialReversion = applyPatchToolCall([
      "*** Begin Patch",
      "*** Update File: src/diff/props.js",
      "@@",
      "-new first",
      "+old first",
      "*** End Patch",
    ]);

    expect(hasRevertedSmallestChangeCorrectionHunks(
      revertingCorrection,
      [priorPatch],
      "Restore the behavior with the smallest change.",
    )).toBe(true);
    expect(hasRevertedSmallestChangeCorrectionHunks(
      refiningCorrection,
      [priorPatch],
      "Restore the behavior with the smallest change.",
    )).toBe(false);
    expect(hasBroadenedSmallestChangeCorrectionHunks(
      broadeningCorrection,
      [priorPatch],
      "Restore the behavior with the smallest change.",
    )).toBe(true);
    expect(hasRevertedSmallestChangeCorrectionHunks(
      revertingWithIndependentChange,
      [priorPatch],
      "Restore the behavior with the smallest change.",
    )).toBe(false);
    expect(hasRevertedSmallestChangeCorrectionHunks(
      revertingAcrossPriorPaths,
      [priorPatch, secondPriorPatch],
      "Restore the behavior with the smallest change.",
    )).toBe(true);
    expect(hasRevertedSmallestChangeCorrectionHunks(
      partialReversion,
      [multiLinePriorPatch],
      "Restore the behavior with the smallest change.",
    )).toBe(false);
    expect(hasRevertedSmallestChangeCorrectionHunks(
      revertingCorrection,
      [priorPatch],
      "Restore the behavior.",
    )).toBe(false);
  });

  it("normalizes only colonless Update File headers inside a recovery patch envelope", () => {
    const call = {
      function: {
        name: "apply_patch",
        arguments: JSON.stringify({
          input: [
            "*** Begin Patch",
            "*** Update File src/api.ts",
            "@@",
            "-old",
            "+new",
            "*** Add File src/other.ts",
            "+content",
            "*** End Patch",
          ].join("\n"),
          extra: "preserved",
        }),
      },
    };

    const normalized = normalizeWorkspaceMutationRecoveryToolCall(call);

    expect(JSON.parse(normalized.function.arguments)).toEqual({
      input: [
        "*** Begin Patch",
        "*** Update File: src/api.ts",
        "@@",
        "-old",
        "+new",
        "*** Add File src/other.ts",
        "+content",
        "*** End Patch",
      ].join("\n"),
      extra: "preserved",
    });
  });

  it("leaves colonless Update File text outside a patch envelope untouched", () => {
    const call = {
      function: {
        name: "apply_patch",
        arguments: JSON.stringify({ input: "*** Update File src/api.ts\n-old\n+new" }),
      },
    };

    expect(normalizeWorkspaceMutationRecoveryToolCall(call)).toBe(call);
  });

  it("coalesces multiple complete apply_patch envelopes from one tool call", () => {
    const call = applyPatchToolCall([
      "*** Begin Patch",
      "*** Update File: src/api.ts",
      "@@",
      "-old api",
      "+new api",
      "*** End Patch",
      "*** Begin Patch",
      "*** Update File: src/protocol.ts",
      "@@",
      "-old protocol",
      "+new protocol",
      "*** End Patch",
    ]);

    const coalesced = coalesceWorkspaceMutationApplyPatchEnvelopes(call, [
      "src/api.ts",
      "src/protocol.ts",
    ]);

    expect(JSON.parse(coalesced?.function.arguments ?? "{}")).toEqual({
      input: [
        "*** Begin Patch",
        "*** Update File: src/api.ts",
        "@@",
        "-old api",
        "+new api",
        "*** Update File: src/protocol.ts",
        "@@",
        "-old protocol",
        "+new protocol",
        "*** End Patch",
      ].join("\n"),
    });
  });

  it.each([
    {
      name: "an extra End Patch marker",
      lines: [
        "*** Begin Patch",
        "*** Update File: src/api.ts",
        "@@",
        "-old",
        "+new",
        "*** End Patch",
        "*** End Patch",
      ],
      allowedPaths: ["src/api.ts"],
    },
    {
      name: "text between envelopes",
      lines: [
        "*** Begin Patch",
        "*** Update File: src/api.ts",
        "@@",
        "-old",
        "+new",
        "*** End Patch",
        "apply the next patch too",
        "*** Begin Patch",
        "*** Update File: src/protocol.ts",
        "@@",
        "-old",
        "+new",
        "*** End Patch",
      ],
      allowedPaths: ["src/api.ts", "src/protocol.ts"],
    },
    {
      name: "an incomplete final envelope",
      lines: [
        "*** Begin Patch",
        "*** Update File: src/api.ts",
        "@@",
        "-old",
        "+new",
        "*** End Patch",
        "*** Begin Patch",
        "*** Update File: src/protocol.ts",
        "@@",
        "-old",
        "+new",
      ],
      allowedPaths: ["src/api.ts", "src/protocol.ts"],
    },
    {
      name: "an empty envelope",
      lines: [
        "*** Begin Patch",
        "*** Update File: src/api.ts",
        "@@",
        "-old",
        "+new",
        "*** End Patch",
        "*** Begin Patch",
        "*** End Patch",
      ],
      allowedPaths: ["src/api.ts"],
    },
    {
      name: "a path outside the required set",
      lines: [
        "*** Begin Patch",
        "*** Update File: src/api.ts",
        "@@",
        "-old",
        "+new",
        "*** End Patch",
        "*** Begin Patch",
        "*** Update File: src/outside.ts",
        "@@",
        "-old",
        "+new",
        "*** End Patch",
      ],
      allowedPaths: ["src/api.ts"],
    },
  ])("rejects multiple patch envelopes with $name", ({ lines, allowedPaths }) => {
    expect(coalesceWorkspaceMutationApplyPatchEnvelopes(
      applyPatchToolCall(lines),
      allowedPaths,
    )).toBeUndefined();
  });

  it("rejects multiple patch envelopes with extra tool arguments", () => {
    const call = applyPatchToolCall([
      "*** Begin Patch",
      "*** Update File: src/api.ts",
      "@@",
      "-old api",
      "+new api",
      "*** End Patch",
      "*** Begin Patch",
      "*** Update File: src/protocol.ts",
      "@@",
      "-old protocol",
      "+new protocol",
      "*** End Patch",
    ]);
    call.function.arguments = JSON.stringify({
      ...JSON.parse(call.function.arguments),
      unexpected: true,
    });

    expect(coalesceWorkspaceMutationApplyPatchEnvelopes(call, [
      "src/api.ts",
      "src/protocol.ts",
    ])).toBeUndefined();
  });

  it("rejects more than sixteen complete patch envelopes", () => {
    const lines = Array.from({ length: 17 }, (_, index) => [
      "*** Begin Patch",
      `*** Update File: src/file-${index}.ts`,
      "@@",
      "-old",
      "+new",
      "*** End Patch",
    ]).flat();

    expect(coalesceWorkspaceMutationApplyPatchEnvelopes(
      applyPatchToolCall(lines),
      Array.from({ length: 17 }, (_, index) => `src/file-${index}.ts`),
    )).toBeUndefined();
  });

  it("fails closed for unsafe split continuation patch sets", () => {
    const apiPatch = applyPatchToolCall([
      "*** Begin Patch",
      "*** Update File: src/api.ts",
      "@@",
      "-old api",
      "+new api",
      "*** End Patch",
    ]);
    const protocolPatch = applyPatchToolCall([
      "*** Begin Patch",
      "*** Update File: src/protocol.ts",
      "@@",
      "-old protocol",
      "+new protocol",
      "*** End Patch",
    ]);
    const allowedPaths = ["src/api.ts", "src/protocol.ts"];
    const invalidPatchSets = [
      [apiPatch, {
        function: { name: "file_write", arguments: JSON.stringify({ path: "src/protocol.ts" }) },
      }],
      [apiPatch, apiPatch],
      [apiPatch, applyPatchToolCall([
        "*** Begin Patch",
        "*** Update File: ../src/protocol.ts",
        "@@",
        "-old protocol",
        "+new protocol",
        "*** End Patch",
      ])],
      [apiPatch, applyPatchToolCall([
        "*** Begin Patch",
        "*** Add File: src/protocol.ts",
        "+new protocol",
        "*** End Patch",
      ])],
      [apiPatch, {
        function: {
          ...protocolPatch.function,
          arguments: JSON.stringify({
            ...JSON.parse(protocolPatch.function.arguments),
            unexpected: true,
          }),
        },
      }],
      Array.from({ length: 17 }, () => apiPatch),
    ];

    for (const patchSet of invalidPatchSets) {
      expect(coalesceWorkspaceMutationApplyPatchToolCalls(
        patchSet,
        allowedPaths,
      )).toBeUndefined();
    }
    expect(coalesceWorkspaceMutationApplyPatchToolCalls(
      [apiPatch, protocolPatch],
      ["src/api.ts", "./src/api.ts"],
    )).toBeUndefined();
  });

  it("retains only complete missing-path sections from a continuation patch", () => {
    const call = applyPatchToolCall([
      "*** Begin Patch",
      "*** Update File: src/api.ts",
      "@@",
      "-old api",
      "+new api",
      "*** Update File: src/connection.ts",
      "@@",
      "-old connection",
      "+new connection",
      "*** Update File: src/protocol.ts",
      "@@",
      "-old protocol",
      "+new protocol",
      "*** End Patch",
    ]);

    const retained = retainMissingWorkspaceMutationPatchSections(
      call,
      ["src/api.ts", "src/protocol.ts"],
      ["src/api.ts", "src/connection.ts", "src/protocol.ts"],
    );

    expect(JSON.parse(retained!.function.arguments)).toEqual({
      input: [
        "*** Begin Patch",
        "*** Update File: src/api.ts",
        "@@",
        "-old api",
        "+new api",
        "*** Update File: src/protocol.ts",
        "@@",
        "-old protocol",
        "+new protocol",
        "*** End Patch",
      ].join("\n"),
    });
  });

  it("does not retain continuation sections from incomplete or untrusted patches", () => {
    const requiredPaths = ["src/api.ts", "src/connection.ts", "src/protocol.ts"];
    const completePatch = [
      "*** Begin Patch",
      "*** Update File: src/api.ts",
      "@@",
      "-old api",
      "+new api",
      "*** Update File: src/connection.ts",
      "@@",
      "-old connection",
      "+new connection",
      "*** Update File: src/protocol.ts",
      "@@",
      "-old protocol",
      "+new protocol",
      "*** End Patch",
    ].join("\n");
    const invalidCalls = [
      applyPatchToolCall([
        "*** Begin Patch",
        "*** Update File: src/api.ts",
        "@@",
        "-old api",
        "+new api",
        "*** Update File: src/connection.ts",
        "@@",
        "-old connection",
        "+new connection",
        "*** End Patch",
      ]),
      applyPatchToolCall([
        "*** Begin Patch",
        "*** Update File: src/api.ts",
        "@@",
        "-old api",
        "+new api",
        "*** Update File: src/outside.ts",
        "@@",
        "-old outside",
        "+new outside",
        "*** Update File: src/protocol.ts",
        "@@",
        "-old protocol",
        "+new protocol",
        "*** End Patch",
      ]),
      applyPatchToolCall([
        "*** Begin Patch",
        "*** Update File: src/api.ts",
        "@@",
        " api context only",
        "*** Update File: src/connection.ts",
        "@@",
        "-old connection",
        "+new connection",
        "*** Update File: src/protocol.ts",
        "@@",
        "-old protocol",
        "+new protocol",
        "*** End Patch",
      ]),
      {
        ...applyPatchToolCall(completePatch.split("\n")),
        function: {
          name: "apply_patch",
          arguments: JSON.stringify({ input: completePatch, unexpected: true }),
        },
      },
      applyPatchToolCall(["", ...completePatch.split("\n")]),
    ];

    for (const call of invalidCalls) {
      expect(retainMissingWorkspaceMutationPatchSections(
        call,
        ["src/api.ts", "src/protocol.ts"],
        requiredPaths,
      )).toBeUndefined();
    }
  });

  it("does not guess hunk ownership for repeated empty update sections", () => {
    const input = [
      "*** Begin Patch",
      "*** Update File: src/api.ts",
      "@@",
      "-old export",
      "+new export",
      "*** Update File: src/api.ts",
      "*** Update File: src/connection.ts",
      "@@",
      "-old import from api",
      "+new import from api",
      "*** End Patch",
    ].join("\n");
    const call = {
      function: {
        name: "apply_patch",
        arguments: JSON.stringify({ input }),
      },
    };

    expect(normalizeWorkspaceMutationRecoveryToolCall(call)).toBe(call);
  });

  it("preserves a context-only hunk when the same file retains an actionable hunk", () => {
    const call = applyPatchToolCall([
      "*** Begin Patch",
      "*** Update File: src/api.ts",
      "@@",
      " unchanged import",
      "@@",
      "-old export",
      "+new export",
      "*** End Patch",
    ]);

    const normalized = normalizeWorkspaceMutationRecoveryToolCall(call);

    expect(normalized).toBe(call);
    expect(canPreserveContextOnlyWorkspaceMutationPatchHunks(normalized)).toBe(true);
    expect(inspectContextOnlyWorkspaceMutationPatchPreservation(normalized)).toEqual({
      canPreserve: true,
      rejectionReason: null,
      sectionCount: 1,
      actionableSectionCount: 1,
    });
    expect(inspectWorkspaceMutationPatchHunks(normalized)?.contextOnlyHunkCount).toBe(1);
  });

  it("preserves context-only hunks only when every file retains an actionable hunk", () => {
    const call = applyPatchToolCall([
      "*** Begin Patch",
      "*** Update File: src/api.ts",
      "@@",
      " api context",
      "@@",
      "-old api",
      "+new api",
      "*** Update File: src/protocol.ts",
      "@@",
      " protocol context",
      "@@",
      "-old protocol",
      "+new protocol",
      "*** End Patch",
    ]);

    const normalized = normalizeWorkspaceMutationRecoveryToolCall(call);

    expect(normalized).toBe(call);
    expect(canPreserveContextOnlyWorkspaceMutationPatchHunks(normalized)).toBe(true);
    expect(inspectWorkspaceMutationPatchHunks(normalized)).toMatchObject({
      hunkCount: 4,
      contextOnlyHunkCount: 2,
      paths: ["src/api.ts", "src/protocol.ts"],
    });
  });

  it("does not remove no-op hunks when any file would have no actionable hunk", () => {
    const call = applyPatchToolCall([
      "*** Begin Patch",
      "*** Update File: src/api.ts",
      "@@",
      "-old api",
      "+new api",
      "*** Update File: src/protocol.ts",
      "@@",
      " protocol context",
      "*** End Patch",
    ]);

    expect(normalizeWorkspaceMutationRecoveryToolCall(call)).toBe(call);
    expect(canPreserveContextOnlyWorkspaceMutationPatchHunks(call)).toBe(false);
    expect(inspectContextOnlyWorkspaceMutationPatchPreservation(call)).toEqual({
      canPreserve: false,
      rejectionReason: "non_actionable_update_section",
      sectionCount: 2,
      actionableSectionCount: 1,
    });
    expect(inspectWorkspaceMutationPatchHunks(call)).toMatchObject({
      hunkCount: 2,
      contextOnlyHunkCount: 1,
      contextOnlyHunkPaths: ["src/protocol.ts"],
    });
  });

  it("drops independent no-op duplicate sections only when retained paths stay unique", () => {
    const safeCall = applyPatchToolCall([
      "*** Begin Patch",
      "*** Update File: src/api.ts",
      "@@",
      " api context only",
      "*** Update File: src/connection.ts",
      "@@",
      "-old connection",
      "+new connection",
      "*** Update File: src/api.ts",
      "@@",
      "-old api",
      "+new api",
      "*** End Patch",
    ]);
    const retained = retainActionableWorkspaceMutationPatchSections(
      safeCall,
      ["src/api.ts", "src/connection.ts"],
    );

    expect(inspectContextOnlyWorkspaceMutationPatchPreservation(safeCall)).toEqual({
      canPreserve: false,
      rejectionReason: "duplicate_update_path",
      sectionCount: 3,
      actionableSectionCount: 2,
    });
    expect(JSON.parse(retained?.function.arguments ?? "{}")).toEqual({
      input: [
        "*** Begin Patch",
        "*** Update File: src/connection.ts",
        "@@",
        "-old connection",
        "+new connection",
        "*** Update File: src/api.ts",
        "@@",
        "-old api",
        "+new api",
        "*** End Patch",
      ].join("\n"),
    });

    const unsafeCall = applyPatchToolCall([
      "*** Begin Patch",
      "*** Update File: src/api.ts",
      "@@",
      " api context only",
      "*** Update File: src/api.ts",
      "@@",
      "-old import",
      "+new import",
      "*** Update File: src/api.ts",
      "@@",
      "-old export",
      "+new export",
      "*** End Patch",
    ]);
    expect(retainActionableWorkspaceMutationPatchSections(
      unsafeCall,
      ["src/api.ts"],
    )).toBeUndefined();
    expect(inspectContextOnlyWorkspaceMutationPatchPreservation(unsafeCall)).toEqual({
      canPreserve: false,
      rejectionReason: "duplicate_update_path",
      sectionCount: 3,
      actionableSectionCount: 2,
    });
  });

  it.each([
    {
      name: "an unsafe later path",
      rejectionReason: "unsafe_update_path",
      trailingLines: [
        "*** Update File: ../outside.ts",
        "@@",
        "-old outside",
        "+new outside",
      ],
    },
    {
      name: "an invalid later hunk line",
      rejectionReason: "invalid_hunk_line",
      trailingLines: [
        "*** Update File: src/connection.ts",
        "@@",
        "invalid context without a patch marker",
      ],
    },
  ])("validates $name after detecting a repeated path", ({ rejectionReason, trailingLines }) => {
    const call = applyPatchToolCall([
      "*** Begin Patch",
      "*** Update File: src/api.ts",
      "@@",
      " api context only",
      "*** Update File: src/api.ts",
      "@@",
      "-old api",
      "+new api",
      ...trailingLines,
      "*** End Patch",
    ]);

    expect(inspectContextOnlyWorkspaceMutationPatchPreservation(call)).toMatchObject({
      canPreserve: false,
      rejectionReason,
    });
    expect(retainActionableWorkspaceMutationPatchSections(call, [
      "src/api.ts",
      "src/connection.ts",
    ])).toBeUndefined();
  });

  it.each([
    {
      name: "unknown hunk ownership",
      rejectionReason: "hunk_without_update_section",
      lines: [
        "*** Begin Patch",
        "@@",
        " unknown context",
        "*** Update File: src/api.ts",
        "@@",
        "-old api",
        "+new api",
        "*** End Patch",
      ],
    },
    {
      name: "an invalid context line",
      rejectionReason: "invalid_hunk_line",
      lines: [
        "*** Begin Patch",
        "*** Update File: src/api.ts",
        "@@",
        "invalid context without a patch marker",
        "@@",
        "-old api",
        "+new api",
        "*** End Patch",
      ],
    },
  ])("does not remove no-op hunks with $name", ({ lines, rejectionReason }) => {
    const call = applyPatchToolCall(lines);

    expect(normalizeWorkspaceMutationRecoveryToolCall(call)).toBe(call);
    expect(canPreserveContextOnlyWorkspaceMutationPatchHunks(call)).toBe(false);
    expect(inspectContextOnlyWorkspaceMutationPatchPreservation(call)).toMatchObject({
      canPreserve: false,
      rejectionReason,
    });
    expect(inspectWorkspaceMutationPatchHunks(call)?.contextOnlyHunkCount).toBe(1);
  });

  it("diagnoses an unexpected End Patch marker without retaining patch text", () => {
    const call = {
      function: {
        name: "apply_patch",
        arguments: JSON.stringify({
          input: [
            "*** Begin Patch",
            "*** Update File: src/api.ts",
            "@@",
            "-old export",
            "+new export",
            "*** End Patch",
            "*** End Patch",
          ].join("\n"),
        }),
      },
    };

    expect(inspectWorkspaceMutationPatchHunks(call)).toEqual({
      hunkCount: 1,
      contextOnlyHunkCount: 0,
      contextOnlyHunkPaths: [],
      paths: ["src/api.ts"],
      endMarkerCount: 2,
      unexpectedEndMarkerCount: 1,
      unexpectedEndMarkerPaths: ["src/api.ts"],
    });
  });

  it("detects a correction hunk that only re-adds an existing line alongside comments", () => {
    const requiredPaths = ["src/diff/props.js"];
    const messages = [
      { role: "user" as const, content: "Restore false aria-* serialization without changing other false attributes." },
      {
        role: "assistant" as const,
        tool_calls: [{
          id: "read-props",
          function: { name: "file_read", arguments: JSON.stringify({ path: requiredPaths[0] }) },
        }],
      },
      {
        role: "tool" as const,
        tool_call_id: "read-props",
        content: JSON.stringify({
          path: requiredPaths[0],
          truncated: false,
          content: [
            "\t\t// aria- and data- attributes have no boolean representation.",
            "\t\t// A `false` value is different from the attribute not being present.",
            "\t\tif (typeof value == 'function') {",
          ].join("\n"),
        }),
      },
    ];
    const correction = applyPatchToolCall([
      "*** Begin Patch",
      "*** Update File: src/diff/props.js",
      "@@",
      "+\t\t// aria- and data- attributes have no boolean representation.",
      "+\t\t// A `false` value is different from the attribute not being present.",
      "-\t\tif (typeof value == 'function') {",
      "+\t\tif (typeof value == 'function') {",
      "*** End Patch",
    ]);

    expect(hasRedundantWorkspaceMutationPatchHunks(correction, messages, requiredPaths)).toBe(true);
    expect(hasRedundantWorkspaceMutationPatchHunks(applyPatchToolCall([
      "*** Begin Patch",
      "*** Update File: src/diff/props.js",
      "@@",
      "-\t\t} else if (value != NULL && value !== false) {",
      "+\t\t} else if (value != NULL && (value !== false || name[4] == '-')) {",
      "*** End Patch",
    ]), messages, requiredPaths)).toBe(false);

    const latestSourceWithoutCommentBlock = [
      ...messages,
      {
        role: "assistant" as const,
        tool_calls: [{
          id: "read-props-latest",
          function: { name: "file_read", arguments: JSON.stringify({ path: requiredPaths[0] }) },
        }],
      },
      {
        role: "tool" as const,
        tool_call_id: "read-props-latest",
        content: JSON.stringify({
          path: "E:\\fixture\\src\\diff\\props.js",
          truncated: false,
          content: "\t\tif (typeof value == 'function') {",
        }),
      },
    ];
    expect(hasRedundantWorkspaceMutationPatchHunks(
      correction,
      latestSourceWithoutCommentBlock,
      requiredPaths,
    )).toBe(false);
  });

  it("bounds context-only hunk diagnostics to safe relative paths", () => {
    const call = {
      function: {
        name: "apply_patch",
        arguments: JSON.stringify({
          input: [
            "*** Begin Patch",
            "*** Update File: C:\\\\secrets\\\\prompt.txt",
            "@@",
            " unchanged",
            "*** End Patch",
          ].join("\n"),
        }),
      },
    };

    expect(inspectWorkspaceMutationPatchHunks(call)).toEqual({
      hunkCount: 1,
      contextOnlyHunkCount: 1,
      contextOnlyHunkPaths: ["<unsafe>"],
      paths: ["<unsafe>"],
      endMarkerCount: 1,
      unexpectedEndMarkerCount: 0,
      unexpectedEndMarkerPaths: [],
    });
  });

  it("builds one bounded read-after-write request for each required path", () => {
    const definitions = [toolDefinition("file_read"), toolDefinition("apply_patch")];
    const readTools = selectWorkspaceMutationNavigationToolDefinitions(definitions, (name) => (
      name === "file_read" ? { isReadOnly: true } : { isReadOnly: false }
    ));

    const request = buildWorkspaceMutationVerificationRequest({
      messages: [{ role: "user", content: "Remove the deprecated public API from both files." }],
      tools: readTools,
      maxInputTokens: 700,
      requiredChangedPaths: ["src/api.ts", "src/protocol.ts"],
      tokenEstimateContext: { model: "deepseek-v4-flash" },
    });

    expect(request).toMatchObject({
      maxFileReadCalls: 2,
      requiredVerificationPaths: ["src/api.ts", "src/protocol.ts"],
      tools: [expect.objectContaining({ function: expect.objectContaining({ name: "file_read" }) })],
    });
    expect(request?.messages[0]?.content).toContain("Post-mutation verification phase");
    expect(request?.messages[0]?.content).toContain("from the start without an anchor");
    expect(request?.messages[0]?.content).toContain("discard any supplied non-empty anchor");
    expect(request?.messages[1]?.content).toContain("Trusted required paths to verify after mutation");
  });

  it("normalizes anchored verification reads to bounded full-file reads", () => {
    const apiRead = fileReadToolCall("read-api", "src/api.ts");
    apiRead.function.arguments = JSON.stringify({
      path: "src/api.ts",
      anchor: "export { TraceValue",
      offset: 0,
    });
    const protocolRead = fileReadToolCall("read-protocol", "./src/protocol.ts");
    protocolRead.function.arguments = JSON.stringify({ path: "./src/protocol.ts", anchor: "trace?: TraceValue" });

    const selected = selectRequiredWorkspaceMutationVerificationToolCalls(
      [apiRead, protocolRead],
      ["src/api.ts", "src/protocol.ts"],
      ["file_read"],
      2,
    );

    expect(selected?.map((call) => JSON.parse(call.function.arguments))).toEqual([
      { path: "src/api.ts", limit: 1_048_576 },
      { path: "./src/protocol.ts", limit: 1_048_576 },
    ]);
  });

  it("normalizes exact unanchored verification reads to the bounded full-file limit", () => {
    const apiRead = fileReadToolCall("read-api", "src/api.ts");
    apiRead.function.arguments = JSON.stringify({ path: "src/api.ts", limit: 102_400 });
    const protocolRead = fileReadToolCall("read-protocol", "./src/protocol.ts");
    protocolRead.function.arguments = JSON.stringify({ path: "./src/protocol.ts", maxBytes: 102_400 });

    const selected = selectRequiredWorkspaceMutationVerificationToolCalls(
      [apiRead, protocolRead],
      ["src/api.ts", "src/protocol.ts"],
      ["file_read"],
      2,
    );

    expect(selected?.map((call) => JSON.parse(call.function.arguments))).toEqual([
      { path: "src/api.ts", limit: 1_048_576 },
      { path: "./src/protocol.ts", limit: 1_048_576 },
    ]);
  });

  it.each([
    { name: "uses an empty anchor", arguments: { path: "src/api.ts", anchor: "" } },
    { name: "uses a positive offset with an anchor", arguments: { path: "src/api.ts", anchor: "TraceValue", offset: 1 } },
    { name: "uses a cursor without an anchor", arguments: { path: "src/api.ts", cursor: "next" } },
  ])("fails closed when verification $name", ({ arguments: readArguments }) => {
    const call = fileReadToolCall("read-api", "src/api.ts");
    call.function.arguments = JSON.stringify(readArguments);

    expect(selectRequiredWorkspaceMutationVerificationToolCalls(
      [call],
      ["src/api.ts"],
      ["file_read"],
      1,
    )).toBeUndefined();
  });

  it("retains exactly one read per required navigation path and drops unrelated reads", () => {
    const requiredPaths = ["src/api.ts", "src/protocol.ts"];
    const calls = [
      fileReadToolCall("read-api", "src/api.ts"),
      fileReadToolCall("read-extra", "test/frozen.mjs"),
      fileReadToolCall("read-protocol", "./src/protocol.ts"),
    ];

    const selected = selectRequiredWorkspaceMutationNavigationToolCalls(
      calls,
      requiredPaths,
      ["file_read"],
      2,
    );

    expect(selected?.map((call) => call.id)).toEqual(["read-api", "read-protocol"]);
    expect(selected?.map((call) => JSON.parse(call.function.arguments).limit)).toEqual([
      1_048_576,
      1_048_576,
    ]);
  });

  it("normalizes unreliable required navigation anchors to bounded full-file reads", () => {
    const apiRead = fileReadToolCall("read-api", "src/api.ts");
    const protocolRead = fileReadToolCall("read-protocol", "src/protocol.ts");
    protocolRead.function.arguments = JSON.stringify({
      path: "src/protocol.ts",
      anchor: "TraceValue",
      limit: 102_400,
    });

    const selected = selectRequiredWorkspaceMutationNavigationToolCalls(
      [apiRead, protocolRead],
      ["src/api.ts", "src/protocol.ts"],
      ["file_read"],
      2,
    );

    expect(selected?.map((call) => JSON.parse(call.function.arguments))).toEqual([
      { path: "src/api.ts", limit: 1_048_576 },
      { path: "src/protocol.ts", limit: 1_048_576 },
    ]);
  });

  it.each([
    {
      name: "duplicates a required path",
      calls: [
        fileReadToolCall("read-api-1", "src/api.ts"),
        fileReadToolCall("read-api-2", "./src/api.ts"),
        fileReadToolCall("read-protocol", "src/protocol.ts"),
      ],
    },
    {
      name: "omits a required path",
      calls: [fileReadToolCall("read-api", "src/api.ts")],
    },
  ])("fails closed when navigation $name", ({ calls }) => {
    expect(selectRequiredWorkspaceMutationNavigationToolCalls(
      calls,
      ["src/api.ts", "src/protocol.ts"],
      ["file_read"],
      2,
    )).toBeUndefined();
  });

  it.each([
    { name: "uses base64 encoding", arguments: { encoding: "base64" } },
    { name: "uses a cursor", arguments: { cursor: "next-page" } },
    { name: "uses a positive offset", arguments: { offset: 1 } },
    { name: "uses a negative offset", arguments: { offset: -1 } },
    { name: "uses a non-numeric offset", arguments: { offset: "0" } },
  ])("fails closed before required navigation $name", ({ arguments: extraArguments }) => {
    const call = fileReadToolCall("read-api", "src/api.ts");
    call.function.arguments = JSON.stringify({ path: "src/api.ts", ...extraArguments });

    expect(selectRequiredWorkspaceMutationNavigationToolCalls(
      [call],
      ["src/api.ts"],
      ["file_read"],
      1,
    )).toBeUndefined();
  });

  it("accepts an explicit zero offset and expands the required read", () => {
    const call = fileReadToolCall("read-api", "src/api.ts");
    call.function.arguments = JSON.stringify({ path: "src/api.ts", offset: 0 });

    const selected = selectRequiredWorkspaceMutationNavigationToolCalls(
      [call],
      ["src/api.ts"],
      ["file_read"],
      1,
    );

    expect(JSON.parse(selected?.[0]?.function.arguments ?? "{}")).toEqual({
      path: "src/api.ts",
      limit: 1_048_576,
    });
  });

  it.each([
    { name: "limit", arguments: { limit: 102_400 } },
    { name: "legacy maxBytes", arguments: { maxBytes: 102_400 } },
  ])("expands an unanchored required read with an explicit $name", ({ arguments: readArguments }) => {
    const call = fileReadToolCall("read-api", "src/api.ts");
    call.function.arguments = JSON.stringify({ path: "src/api.ts", ...readArguments });

    const selected = selectRequiredWorkspaceMutationNavigationToolCalls(
      [call],
      ["src/api.ts"],
      ["file_read"],
      1,
    );

    expect(JSON.parse(selected?.[0]?.function.arguments ?? "{}")).toEqual({
      path: "src/api.ts",
      limit: 1_048_576,
    });
  });

  it("builds one bounded mutation-only request from the task and recent read evidence", () => {
    const definitions = [
      toolDefinition("file_read"),
      toolDefinition("apply_patch"),
      toolDefinition("run_command"),
    ];
    const mutationTools = selectWorkspaceMutationToolDefinitions(definitions, (name) => {
      if (name === "apply_patch") return { family: "patch", isReadOnly: false };
      if (name === "file_read") return { family: "workspace-read", isReadOnly: true };
      return { family: "command-exec", isReadOnly: false };
    });

    const request = buildWorkspaceMutationRecoveryRequest({
      maxInputTokens: 700,
      tools: mutationTools,
      tokenEstimateContext: { model: "deepseek-v4-flash" },
      messages: [
        { role: "system", content: "Large ordinary coding system prompt must not be retained." },
        { role: "user", content: "Fix the exported Go API and its call sites." },
        {
          role: "assistant",
          tool_calls: [{ id: "read-1", function: { name: "file_read", arguments: "{}" } }],
        },
        {
          role: "tool",
          tool_call_id: "read-1",
          content: JSON.stringify({ path: "api.go", content: `package api\n${"X".repeat(20_000)}` }),
        },
      ],
    });

    expect(mutationTools.map((tool) => tool.function.name)).toEqual(["apply_patch"]);
    expect(request).toBeDefined();
    expect(request?.estimatedInputTokens).toBeLessThanOrEqual(700);
    expect(request?.messages).toEqual([
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("Mutation-only recovery phase"),
      }),
      expect.objectContaining({
        role: "user",
        content: expect.stringContaining("Fix the exported Go API"),
      }),
    ]);
    expect(request?.messages[0]?.content).toContain("one atomic checklist");
    expect(request?.messages[0]?.content).toContain(
      "One final *** End Patch",
    );
    expect(request?.messages[0]?.content).toContain(
      "Copy context/removal lines exactly from one taskRelevantContexts item or exact evidence",
    );
    expect(request?.messages[0]?.content).toContain(
      "Preserve replacement surroundings",
    );
    expect(request?.messages[0]?.content).toContain(
      "exactly one non-empty *** Update File: <path> section",
    );
    expect(request?.messages[0]?.content).toContain(
      "cross file headers",
    );
    expect(request?.messages[1]?.content).toContain("[tool=file_read]");
    expect(request?.messages.some((message) => message.role === ("tool" as string))).toBe(false);
    expect(WORKSPACE_MUTATION_RECOVERY_OUTPUT_TOKEN_RESERVE).toBe(4_096);
    expect(WORKSPACE_MUTATION_RECOVERY_MIN_OUTPUT_TOKEN_RESERVE).toBe(1_024);
  });

  it("builds a bounded missing-path-only continuation plan", () => {
    const plan = buildWorkspaceMutationContinuationPlan({
      messages: [
        { role: "user", content: "Apply the public API migration." },
        {
          role: "assistant",
          tool_calls: [{ id: "read-protocol", function: { name: "file_read", arguments: "{}" } }],
        },
        {
          role: "tool",
          tool_call_id: "read-protocol",
          content: JSON.stringify({ path: "src/protocol.ts", truncated: false, content: "export type Protocol = {};" }),
        },
      ],
      tools: [toolDefinition("apply_patch")],
      remainingTokenBudget: 10_000,
      maxOutputTokens: 4_096,
      finalizationOutputTokens: 1_024,
      inputSafetyFactor: 1.2,
      missingRequiredChangedPaths: ["src/protocol.ts"],
      tokenEstimateContext: { model: "deepseek-v4-flash" },
    });

    expect(plan).toBeDefined();
    expect(plan?.messages[0]?.content).toContain("Missing-path mutation continuation phase");
    expect(plan?.messages[0]?.content).toContain("no already-covered or unlisted path");
    expect(plan?.messages[0]?.content).toContain(
      "Copy context/removal lines exactly from one taskRelevantContexts item or exact evidence",
    );
    expect(plan?.messages[0]?.content).toContain(
      "Preserve replacement surroundings",
    );
    expect(plan?.messages[0]?.content).toContain(
      "exactly one non-empty *** Update File: <path> section",
    );
    expect(plan?.messages[0]?.content).toContain(
      "cross file headers",
    );
    expect(plan?.messages[1]?.content).toContain(
      'Trusted required changed paths still missing:\n["src/protocol.ts"]',
    );
    expect(plan?.outputTokens).toBeLessThanOrEqual(4_096);
  });

  it("requires actionable hunks and exact source whitespace in required mutations", () => {
    const messages = [
      { role: "user" as const, content: "Remove TraceValues from the public API." },
      {
        role: "assistant" as const,
        tool_calls: [{ id: "read-api", function: { name: "file_read", arguments: "{}" } }],
      },
      {
        role: "tool" as const,
        tool_call_id: "read-api",
        content: JSON.stringify({
          path: "jsonrpc/src/common/api.ts",
          truncated: false,
          content: "export { TraceValue, TraceValues, TraceFormat };",
        }),
      },
    ];
    const recovery = buildWorkspaceMutationRecoveryRequest({
      maxInputTokens: 1_400,
      tools: [toolDefinition("apply_patch")],
      missingRequiredChangedPaths: ["jsonrpc/src/common/api.ts"],
      tokenEstimateContext: { model: "deepseek-v4-flash" },
      messages,
    });
    const continuation = buildWorkspaceMutationContinuationPlan({
      messages,
      tools: [toolDefinition("apply_patch")],
      remainingTokenBudget: 10_000,
      maxOutputTokens: 4_096,
      finalizationOutputTokens: 1_024,
      inputSafetyFactor: 1.2,
      missingRequiredChangedPaths: ["jsonrpc/src/common/api.ts"],
      tokenEstimateContext: { model: "deepseek-v4-flash" },
    });

    for (const instruction of [
      recovery?.messages[0]?.content,
      continuation?.messages[0]?.content,
    ]) {
      expect(instruction).toContain(
        "Each *** Update File section/@@ hunk needs actual +/-",
      );
      expect(instruction).toContain(
        "space-prefixed lines are context only",
      );
      expect(instruction).toContain("No context-only hunk");
      expect(instruction).toContain(
        "Copy context/removal lines exactly from one taskRelevantContexts item or exact evidence",
      );
      expect(instruction).toContain(
        "preserving source tabs/spaces after the one diff marker",
      );
    }
  });

  it("keeps bounded continuation file evidence as valid JSON with complete source lines", () => {
    const targetLine = `\tNotificationHandler4, ${"NotificationHandler8, ".repeat(12)}TraceValue, TraceValues, TraceFormat,`;
    const spacer = Array.from(
      { length: 12 },
      (_, index) => `const filler${index} = "${"x".repeat(64)}";`,
    ).join("\n");
    const fileContent = [
      spacer,
      targetLine,
      spacer,
      "export { TraceValues };",
      spacer,
      "export type PublicTrace = TraceValues;",
      spacer,
      "const legacyTrace: TraceValues | undefined = undefined;",
      spacer,
      "type TraceAlias = TraceValues;",
      spacer,
      "export const traceValues: TraceValues[] = [];",
      spacer,
    ].join("\n");
    const request = buildWorkspaceMutationContinuationRequest({
      maxInputTokens: 700,
      tools: [toolDefinition("apply_patch")],
      missingRequiredChangedPaths: ["jsonrpc/src/common/api.ts"],
      tokenEstimateContext: { model: "deepseek-v4-flash" },
      messages: [
        {
          role: "user",
          content: "Remove every TraceValues export from the public API.",
        },
        {
          role: "assistant",
          tool_calls: [{ id: "read-api", function: { name: "file_read", arguments: "{}" } }],
        },
        {
          role: "tool",
          tool_call_id: "read-api",
          content: JSON.stringify({
            path: "jsonrpc/src/common/api.ts",
            truncated: false,
            content: fileContent,
          }),
        },
      ],
    });

    expect(request).toBeDefined();
    const boundedEvidence = request?.messages[1]?.content.split("[tool=file_read]\n").at(-1) ?? "";
    const parsedEvidence = JSON.parse(boundedEvidence) as {
      path?: string;
      taskRelevantContexts?: Array<{ context?: string }>;
    };
    expect(parsedEvidence.path).toBe("jsonrpc/src/common/api.ts");
    expect(parsedEvidence.taskRelevantContexts?.some(({ context }) => (
      context?.split("\n").includes(targetLine)
    ))).toBe(true);
    expect(boundedEvidence).not.toContain("chars bounded for mutation recovery");
  });

  it("builds a bounded source-navigation request with source-read tools only", () => {
    const definitions = [
      toolDefinition("file_read"),
      toolDefinition("text_search"),
      toolDefinition("list_files"),
      toolDefinition("apply_patch"),
    ];
    const navigationTools = selectWorkspaceMutationNavigationToolDefinitions(definitions, (name) => ({
      isReadOnly: name !== "apply_patch",
    }));
    const request = buildWorkspaceMutationNavigationRequest({
      maxInputTokens: 700,
      tools: navigationTools,
      missingRequiredChangedPaths: [
        "jsonrpc/src/common/connection.ts",
        "protocol/src/common/protocol.ts",
      ],
      tokenEstimateContext: { model: "deepseek-v4-flash" },
      messages: [
        { role: "user", content: "Migrate the deprecated API in every required file." },
        {
          role: "assistant",
          tool_calls: [{ id: "read-1", function: { name: "file_read", arguments: "{}" } }],
        },
        {
          role: "tool",
          tool_call_id: "read-1",
          content: JSON.stringify({
            path: "protocol/src/common/protocol.ts",
            truncated: true,
            content: "import { TraceValues } from 'vscode-jsonrpc';",
          }),
        },
      ],
    });

    expect(navigationTools.map((tool) => tool.function.name)).toEqual(["file_read", "text_search"]);
    expect(request?.estimatedInputTokens).toBeLessThanOrEqual(700);
    expect(request?.messages[0]?.content).toContain("Bounded source-navigation phase");
    expect(request?.messages[0]?.content).toContain("at most two file_read calls");
    expect(request?.messages[1]?.content).toContain("protocol/src/common/protocol.ts");
    expect(request?.missingRequiredSourceEvidencePaths).toEqual([
      "jsonrpc/src/common/connection.ts",
      "protocol/src/common/protocol.ts",
    ]);
  });

  it("retains a function from a focused anchor window with the canary evidence budget", () => {
    const anchor = "func (c *Command) Name() string";
    const functionBody = [
      anchor + " {",
      "\tname := c.Use",
      "\ti := strings.LastIndex(name, \" \")",
      "\tif i >= 0 {",
      "\t\tname = name[:i]",
      "\t}",
      "\treturn name",
      "}",
    ].join("\n");
    const focusedRead = JSON.stringify({
      path: "command.go",
      bytesRead: 4_096,
      anchor: { text: anchor, byteOffset: 46_089 },
      content: `${"before := value\n".repeat(120)}${functionBody}\n${"after := value\n".repeat(120)}`,
    });

    const request = buildWorkspaceMutationRecoveryRequest({
      maxInputTokens: 2_584,
      tools: [toolDefinition("apply_patch")],
      tokenEstimateContext: { model: "deepseek-v4-flash" },
      messages: [
        { role: "user", content: "Fix Command.Name so it returns the first token." },
        {
          role: "assistant",
          tool_calls: [{ id: "list-1", function: { name: "list_files", arguments: "{}" } }],
        },
        { role: "tool", tool_call_id: "list-1", content: JSON.stringify({ entries: ["command.go"] }) },
        {
          role: "assistant",
          tool_calls: [{ id: "read-1", function: { name: "file_read", arguments: "{}" } }],
        },
        { role: "tool", tool_call_id: "read-1", content: JSON.stringify({ path: "go.mod", content: "module cobra" }) },
        {
          role: "assistant",
          tool_calls: [{ id: "read-2", function: { name: "file_read", arguments: "{}" } }],
        },
        { role: "tool", tool_call_id: "read-2", content: JSON.stringify({ path: "benchmark_test.go", content: "want serve" }) },
        {
          role: "assistant",
          tool_calls: [{ id: "read-3", function: { name: "file_read", arguments: "{}" } }],
        },
        { role: "tool", tool_call_id: "read-3", content: "路径不是文件" },
        {
          role: "assistant",
          tool_calls: [{ id: "read-4", function: { name: "file_read", arguments: "{}" } }],
        },
        { role: "tool", tool_call_id: "read-4", content: focusedRead },
      ],
    });

    expect(request).toBeDefined();
    expect(request?.messages[1]?.content).toContain(anchor);
    expect(request?.messages[1]?.content).toContain("strings.LastIndex");
    const focusedEvidence = request?.messages[1]?.content.split("[tool=file_read]").at(-1);
    expect(focusedEvidence).toContain('"contentTruncatedForMutationRecovery":true');
    expect(focusedEvidence).toContain('"anchorContext":');
  });

  it("retains task-relevant identifiers from the middle of a complete large required file", () => {
    const targetContext = "export interface InitializeParams {\n\ttrace?: TraceValues;\n}";
    const request = buildWorkspaceMutationRecoveryRequest({
      maxInputTokens: 900,
      tools: [toolDefinition("apply_patch")],
      missingRequiredChangedPaths: ["protocol/src/common/protocol.ts"],
      tokenEstimateContext: { model: "deepseek-v4-flash" },
      messages: [
        {
          role: "user",
          content: "Remove TraceValues from the public API and migrate protocol to TraceValue.",
        },
        {
          role: "assistant",
          tool_calls: [{
            id: "read-protocol",
            function: { name: "file_read", arguments: "{}" },
          }],
        },
        {
          role: "tool",
          tool_call_id: "read-protocol",
          content: JSON.stringify({
            path: "protocol/src/common/protocol.ts",
            truncated: false,
            content: `import { TraceValues } from "vscode-jsonrpc";\n${"x".repeat(40_000)}\n${targetContext}\n${"y".repeat(40_000)}`,
          }),
        },
      ],
    });

    expect(request?.missingRequiredSourceEvidencePaths).toEqual([]);
    expect(request?.messages[1]?.content).toContain("trace?: TraceValues;");
  });

  it("prioritizes source-shaped wildcard and literal terms over incidental hyphenated prose", () => {
    const incidentalContexts = Array.from({ length: 6 }, (_, index) => [
      "x".repeat(800),
      `const browser = ${index};`,
      "y".repeat(800),
    ].join("\n")).join("\n");
    const targetContext = "\t\t} else if (value != NULL && value !== false) {";
    const request = buildWorkspaceMutationRecoveryRequest({
      maxInputTokens: 900,
      tools: [toolDefinition("apply_patch")],
      missingRequiredChangedPaths: ["src/diff/props.js"],
      tokenEstimateContext: { model: "deepseek-v4-flash" },
      messages: [
        {
          role: "user",
          content: "Fix the frozen browser-facing regression and restore false aria-* attribute serialization with the smallest change in src/diff/props.js.",
        },
        {
          role: "assistant",
          tool_calls: [{
            id: "read-props",
            function: { name: "file_read", arguments: "{}" },
          }],
        },
        {
          role: "tool",
          tool_call_id: "read-props",
          content: JSON.stringify({
            path: "src/diff/props.js",
            truncated: false,
            content: `${incidentalContexts}\n${targetContext}\n${"z".repeat(800)}`,
          }),
        },
      ],
    });

    expect(request?.messages[1]?.content).toContain("value != NULL && value !== false");
  });

  it("retains the current Preact value branch after task-relevant false comments", () => {
    const currentSource = [
      ...Array.from({ length: 220 }, (_, index) => `const before${index} = 1;`),
      "\t\t// aria- and data- attributes have no boolean representation.",
      "\t\t// A `false` value is different from the attribute not being",
      "\t\t// present, so we can't remove it. For non-boolean aria",
      "\t\t// attributes we could treat false as a removal, but the",
      "\t\t// amount of exceptions would cost too many bytes. On top of",
      "\t\t// that other frameworks generally stringify `false`.",
      "",
      "\t\tif (typeof value == 'function') {",
      "\t\t\t// never serialize functions as attribute values",
      "\t\t} else if (value != NULL) {",
      "\t\t\tdom.setAttribute(name, value);",
      "\t\t}",
      ...Array.from({ length: 80 }, (_, index) => `const after${index} = 1;`),
    ].join("\n");
    const request = buildWorkspaceMutationObjectiveReviewRequest({
      maxInputTokens: 1_637,
      tools: [toolDefinition("apply_patch")],
      requiredChangedPaths: ["src/diff/props.js"],
      tokenEstimateContext: { model: "deepseek-v4-flash" },
      messages: [
        {
          role: "user",
          content: "Fix the frozen browser-facing regression and restore false aria-* attribute serialization with the smallest change in src/diff/props.js.",
        },
        {
          role: "assistant",
          tool_calls: [{
            id: "read-props-current",
            function: { name: "file_read", arguments: "{}" },
          }],
        },
        {
          role: "tool",
          tool_call_id: "read-props-current",
          content: JSON.stringify({
            path: "src/diff/props.js",
            truncated: false,
            content: currentSource,
          }),
        },
      ],
    });

    expect(currentSource.length).toBeGreaterThan(4_096);
    expect(request?.messages[0]?.content).toContain(
      "Make the smallest patch relative to the current source",
    );
    expect(request?.messages[0]?.content).toContain(
      "Preserve every already-correct adjacent expression and branch byte-for-byte as patch context",
    );
    expect(request?.messages[0]?.content).toContain(
      "Do not refactor, expand, normalize, modernize, or make an equivalent rewrite",
    );
    expect(request?.messages[1]?.content).toContain("} else if (value != NULL) {");
  });

  it("fails closed when every required objective-review read cannot fit the request", () => {
    const requiredChangedPaths = ["src/first.ts", "src/second.ts"];
    const messages = [
      { role: "user" as const, content: "Apply the required migration." },
      {
        role: "assistant" as const,
        tool_calls: requiredChangedPaths.map((path, index) => ({
          id: `read-${index}`,
          function: { name: "file_read", arguments: JSON.stringify({ path }) },
        })),
      },
      ...requiredChangedPaths.map((path, index) => ({
        role: "tool" as const,
        tool_call_id: `read-${index}`,
        content: JSON.stringify({
          path,
          truncated: false,
          content: `export const value = ${index};\n${"x".repeat(4_000)}`,
        }),
      })),
    ];
    const requests = Array.from({ length: 81 }, (_, index) => 400 + index * 10)
      .map((maxInputTokens) => buildWorkspaceMutationObjectiveReviewRequest({
        maxInputTokens,
        tools: [toolDefinition("apply_patch")],
        requiredChangedPaths,
        tokenEstimateContext: { model: "deepseek-v4-flash" },
        messages,
      }))
      .filter((request) => request !== undefined);

    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((request) => (
      request.missingRequiredSourceEvidencePaths.length === 0
    ))).toBe(true);
  });

  it("fails closed when the latest required objective-review read is truncated", () => {
    expect(buildWorkspaceMutationObjectiveReviewRequest({
      maxInputTokens: 900,
      tools: [toolDefinition("apply_patch")],
      requiredChangedPaths: ["src/api.ts"],
      tokenEstimateContext: { model: "deepseek-v4-flash" },
      messages: [
        { role: "user", content: "Apply the required migration." },
        {
          role: "assistant",
          tool_calls: [{
            id: "read-api",
            function: { name: "file_read", arguments: "{}" },
          }],
        },
        {
          role: "tool",
          tool_call_id: "read-api",
          content: JSON.stringify({
            path: "src/api.ts",
            truncated: true,
            content: "export const stale = true;",
          }),
        },
      ],
    })).toBeUndefined();
  });

  it("retains every task-relevant occurrence from a complete medium required file", () => {
    const importContext = "import { TraceValue, TraceValues } from './connection';";
    const exportContext = "export { TraceValue, TraceValues, TraceFormat };";
    const request = buildWorkspaceMutationRecoveryRequest({
      maxInputTokens: 900,
      tools: [toolDefinition("apply_patch")],
      missingRequiredChangedPaths: ["jsonrpc/src/common/api.ts"],
      tokenEstimateContext: { model: "deepseek-v4-flash" },
      messages: [
        {
          role: "user",
          content: "Remove every TraceValues import and export from the public API.",
        },
        {
          role: "assistant",
          tool_calls: [{
            id: "read-api",
            function: { name: "file_read", arguments: "{}" },
          }],
        },
        {
          role: "tool",
          tool_call_id: "read-api",
          content: JSON.stringify({
            path: "jsonrpc/src/common/api.ts",
            truncated: false,
            content: `${"const header = true;\n".repeat(130)}${importContext}\n${"const middle = true;\n".repeat(130)}${exportContext}\n${"const tail = true;\n".repeat(20)}`,
          }),
        },
      ],
    });

    expect(request?.missingRequiredSourceEvidencePaths).toEqual([]);
    expect(request?.messages[1]?.content).toContain(importContext);
    expect(request?.messages[1]?.content).toContain(exportContext);
  });

  it("labels disjoint task contexts with source lines and forbids cross-context hunks", () => {
    const fileContent = [
      ...Array.from({ length: 40 }, (_, index) => `const before${index} = true;`),
      "import { TraceValue, TraceValues } from './connection';",
      ...Array.from({ length: 260 }, (_, index) => `const between${index} = true;`),
      "export { TraceValue, TraceValues, TraceFormat };",
      ...Array.from({ length: 40 }, (_, index) => `const after${index} = true;`),
    ].join("\n");
    const request = buildWorkspaceMutationRecoveryRequest({
      maxInputTokens: 1_400,
      tools: [toolDefinition("apply_patch")],
      missingRequiredChangedPaths: ["jsonrpc/src/common/api.ts"],
      tokenEstimateContext: { model: "deepseek-v4-flash" },
      messages: [
        {
          role: "user",
          content: "Remove every TraceValues import and export from the public API.",
        },
        {
          role: "assistant",
          tool_calls: [{
            id: "read-api",
            function: { name: "file_read", arguments: "{}" },
          }],
        },
        {
          role: "tool",
          tool_call_id: "read-api",
          content: JSON.stringify({
            path: "jsonrpc/src/common/api.ts",
            truncated: false,
            content: fileContent,
          }),
        },
      ],
    });

    const projectedEvidence = JSON.parse(
      request?.messages[1]?.content.split("[tool=file_read]\n").at(-1) ?? "{}",
    ) as {
      taskRelevantContexts?: Array<{
        context: string;
        lines?: string;
      }>;
    };
    const contexts = projectedEvidence.taskRelevantContexts ?? [];
    expect(contexts).toHaveLength(2);
    const ranges = contexts.map(({ lines }) => (
      lines?.split("-").map((value) => Number.parseInt(value, 10)) ?? []
    ));
    expect(ranges.every(([startLine, endLine]) => (
      Number.isInteger(startLine) && Number.isInteger(endLine)
    ))).toBe(true);
    expect(ranges[0]?.[1]).toBeLessThan((ranges[1]?.[0] ?? 0) - 1);
    expect(request?.messages[0]?.content).toContain(
      "Never join items/fragments",
    );
  });

  it("keeps projected task contexts aligned to complete source lines", () => {
    const prefixLine = "x".repeat(250);
    const targetLine = "\tCancellationStrategy, MessageStrategy, TraceValues";
    const suffixLine = "y".repeat(600);
    const request = buildWorkspaceMutationRecoveryRequest({
      maxInputTokens: 1_400,
      tools: [toolDefinition("apply_patch")],
      missingRequiredChangedPaths: ["jsonrpc/src/common/api.ts"],
      tokenEstimateContext: { model: "deepseek-v4-flash" },
      messages: [
        {
          role: "user",
          content: "Remove TraceValues from the public API.",
        },
        {
          role: "assistant",
          tool_calls: [{
            id: "read-api",
            function: { name: "file_read", arguments: "{}" },
          }],
        },
        {
          role: "tool",
          tool_call_id: "read-api",
          content: JSON.stringify({
            path: "jsonrpc/src/common/api.ts",
            truncated: false,
            content: [
              "const header = true;\n".repeat(220),
              prefixLine,
              targetLine,
              suffixLine,
              "const tail = true;",
            ].join("\n"),
          }),
        },
      ],
    });

    const projectedEvidence = JSON.parse(
      request?.messages[1]?.content.split("[tool=file_read]\n").at(-1) ?? "{}",
    ) as { taskRelevantContexts?: Array<{ context: string }> };
    const context = projectedEvidence.taskRelevantContexts?.[0]?.context ?? "";
    expect(context).toBe(`${prefixLine}\n${targetLine}\n${suffixLine}\n`);
  });

  it("prefers reasoning headroom and shrinks output only when the run budget is tight", () => {
    const input = {
      messages: [{ role: "user", content: "Change api.go." }],
      tools: [toolDefinition("apply_patch")],
      maxOutputTokens: 4_096,
      finalizationOutputTokens: 1_024,
      inputSafetyFactor: 1.2,
      tokenEstimateContext: { model: "deepseek-v4-flash" },
    };

    const preferred = buildWorkspaceMutationRecoveryPlan({
      ...input,
      remainingTokenBudget: 10_000,
    });
    const tight = buildWorkspaceMutationRecoveryPlan({
      ...input,
      remainingTokenBudget: 4_600,
    });

    expect(preferred?.outputTokens).toBe(4_096);
    expect(tight?.outputTokens).toBeGreaterThanOrEqual(1_024);
    expect(tight?.outputTokens).toBeLessThan(4_096);
  });

  it("keeps an explicitly smaller max output token limit as a hard cap", () => {
    const plan = buildWorkspaceMutationRecoveryPlan({
      messages: [{ role: "user", content: "Change api.go." }],
      tools: [toolDefinition("apply_patch")],
      remainingTokenBudget: 10_000,
      maxOutputTokens: 512,
      finalizationOutputTokens: 512,
      inputSafetyFactor: 1.2,
      tokenEstimateContext: { model: "deepseek-v4-flash" },
    });

    expect(plan?.outputTokens).toBe(512);
  });

  it("fails closed when no allowed workspace mutation tool is available", () => {
    expect(buildWorkspaceMutationRecoveryRequest({
      maxInputTokens: 700,
      tools: [],
      messages: [{ role: "user", content: "Change the file." }],
    })).toBeUndefined();
  });
});

function toolDefinition(name: string) {
  return {
    type: "function" as const,
    function: {
      name,
      description: `${name} description`,
      parameters: { type: "object", properties: {} },
    },
  };
}

function applyPatchToolCall(lines: string[]) {
  return {
    function: {
      name: "apply_patch",
      arguments: JSON.stringify({ input: lines.join("\n") }),
    },
  };
}

function fileReadToolCall(id: string, path: string) {
  return {
    id,
    function: {
      name: "file_read",
      arguments: JSON.stringify({ path }),
    },
  };
}
