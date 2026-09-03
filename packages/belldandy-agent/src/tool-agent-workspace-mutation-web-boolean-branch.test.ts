import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./model-request-transport.js", () => ({
  requestModelTransport: (options: { url: string | URL; init: RequestInit }) => (
    fetch(options.url, options.init)
  ),
}));

import { ToolEnabledAgent } from "./tool-agent.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ToolEnabledAgent serialized-false boolean branch correction", () => {
  it("rebuilds the frozen truncated correction as the minimal SVG-inclusive predicate change", async () => {
    const requiredPath = "src/diff/props.js";
    const baselineBranch = [
      "\t\tif (typeof value == 'function') {",
      "\t\t\t// never serialize functions as attribute values",
      "\t\t} else if (value != NULL && value !== false) {",
      "\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
      "\t\t} else {",
      "\t\t\tdom.removeAttribute(name);",
      "\t\t}",
    ].join("\n");
    const booleanCondition = "\t\t} else if (typeof value == 'boolean' && !value && !isSvg) {";
    const correctedCondition = "\t\t} else if (typeof value == 'boolean' && !value) {";
    const postWriteBranch = [
      "\t\tif (typeof value == 'function') {",
      "\t\t\t// never serialize functions as attribute values",
      booleanCondition,
      "\t\t\t// False for boolean attributes (aria-/, data-/) means false.",
      "\t\t\tif (/^(aria|data)-/.test(name)) {",
      "\t\t\t\tdom.setAttribute(name, 'false');",
      "\t\t\t} else {",
      "\t\t\t\tdom.removeAttribute(name);",
      "\t\t\t}",
      "\t\t} else if (value != NULL && value !== false) {",
      "\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
      "\t\t} else {",
      "\t\t\tdom.removeAttribute(name);",
      "\t\t}",
    ].join("\n");
    const sourcePrefix = Array.from(
      { length: 145 },
      (_, index) => `const unrelatedBefore${index} = ${index};`,
    ).join("\n");
    const sourceSuffix = Array.from(
      { length: 70 },
      (_, index) => `const unrelatedAfter${index} = ${index};`,
    ).join("\n");
    const baselineSource = `${sourcePrefix}\n${baselineBranch}\n${sourceSuffix}`;
    const postWriteSource = baselineSource.replace(baselineBranch, postWriteBranch);
    const correctedSource = postWriteSource.replace(booleanCondition, correctedCondition);
    const initialPatch = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      " \t\tif (typeof value == 'function') {",
      " \t\t\t// never serialize functions as attribute values",
      "-\t\t} else if (value != NULL && value !== false) {",
      "-\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
      "+\t\t} else if (typeof value == 'boolean' && !value && !isSvg) {",
      "+\t\t\t// False for boolean attributes (aria-/, data-/) means false.",
      "+\t\t\tif (/^(aria|data)-/.test(name)) {",
      "+\t\t\t\tdom.setAttribute(name, 'false');",
      "+\t\t\t} else {",
      "+\t\t\t\tdom.removeAttribute(name);",
      "+\t\t\t}",
      "+\t\t} else if (value != NULL && value !== false) {",
      "+\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
      " \t\t} else {",
      " \t\t\tdom.removeAttribute(name);",
      " \t\t}",
      "*** End Patch",
    ].join("\n");
    const truncatedCorrection = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      "-\t\tif (typeof value == 'function') {",
      "-\t\t\t// never serialize functions as attribute values",
      `-${booleanCondition}`,
      "-\t\t\t// False for boolean attributes (aria-/, data-/) m",
      "+\t\tif (value == NULL) {",
      "+\t\t\tdom.removeAttribute(name);",
      "+\t\t} else if (typeof value == 'function' || typeof value == 'boolean' && !value && !isSvg) {",
      "+\t\t\tif (typeof value == 'function') {",
      "+\t\t\t\t// never serialize functions as attribute values",
      "+\t\t\t}",
      "*** End Patch",
    ].join("\n");
    const expectedCorrection = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      `-${booleanCondition}`,
      `+${correctedCondition}`,
      "*** End Patch",
    ].join("\n");
    const task = "Fix the frozen browser-facing regression in the real web project. Preserve false values for aria-* and data-* attributes by serializing them, remove ordinary attributes with false values, and remove every attribute with null or undefined values. Make the smallest change in src/diff/props.js and pass the supplied deterministic checks. Use the frozen behavior truth set real-web-ui-regression-v1. False aria-* and data-* values are serialized as the string false. False values for ordinary attributes remove the attribute. Null and undefined values remove every attribute, including aria-* and data-* attributes.";
    const successJson = '{"summary":"Verified serialized false attributes across HTML and SVG."}';
    const requests: Array<Record<string, any>> = [];
    const executedPatches: string[] = [];
    let currentSource = baselineSource;
    let ordinaryCallCount = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      const instruction = String(body.messages?.[0]?.content ?? "");
      if (instruction.includes("Post-mutation final objective review phase")) {
        return jsonResponse({
          choices: [{ finish_reason: "stop", message: { content: successJson } }],
          usage: { prompt_tokens: 300, completion_tokens: 30 },
        });
      }
      if (instruction.includes("Post-mutation verification phase")) {
        return jsonResponse(modelToolCall("read-current-source", "file_read", {
          path: requiredPath,
          limit: 1_048_576,
        }));
      }
      if (instruction.includes("Post-mutation objective review phase")
        || instruction.includes("Post-mutation objective correction input retry phase")) {
        return jsonResponse(modelToolCall("repair-truncated-branch", "apply_patch", {
          input: truncatedCorrection,
        }));
      }
      ordinaryCallCount++;
      return jsonResponse(ordinaryCallCount === 1
        ? modelToolCall("read-baseline-source", "file_read", { path: requiredPath })
        : modelToolCall("add-boolean-branch", "apply_patch", { input: initialPatch }));
    });

    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => {
      if (request.name === "file_read") {
        return {
          id: request.id,
          name: request.name,
          success: true,
          output: JSON.stringify({
            path: requiredPath,
            size: currentSource.length,
            truncated: false,
            content: currentSource,
          }),
          durationMs: 1,
        };
      }
      const patchInput = String(request.arguments?.input ?? "");
      executedPatches.push(patchInput);
      if (patchInput === initialPatch) {
        currentSource = postWriteSource;
      } else if (patchInput === expectedCorrection) {
        currentSource = correctedSource;
      } else {
        return {
          id: request.id,
          name: request.name,
          success: false,
          output: "",
          error: "Failed to find expected lines: truncated branch context",
          failureKind: "input_error" as const,
          metadata: { repairAction: "apply_patch_input_invalid" },
          durationMs: 1,
        };
      }
      return {
        id: request.id,
        name: request.name,
        success: true,
        output: "Patch applied successfully",
        metadata: {
          workspaceMutation: { schemaVersion: 1, changedPaths: [requiredPath] },
        },
        durationMs: 1,
      };
    });
    const agent = createAgent(execute);

    const items = await collect(agent.run({
      conversationId: "conv-frozen-web-boolean-branch",
      text: task,
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths: [requiredPath],
          toolLoopIterationBudget: 10,
        },
      },
      structuredOutput: {
        schema: { type: "object", required: ["summary"] },
        validateOutput: (text: string) => text === successJson
          ? { ok: true as const, outputText: text }
          : { ok: false as const, message: "summary is required" },
      },
    } as any));

    expect(postWriteSource.length).toBeGreaterThan(4_096);
    expect(executedPatches).toEqual([
      initialPatch,
      truncatedCorrection,
      expectedCorrection,
    ]);
    expect(currentSource).toBe(correctedSource);
    expect(items.at(-2)).toEqual({ type: "final", text: successJson });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
    expect(requests.some((request) => String(request.messages?.[0]?.content ?? "")
      .includes("Post-mutation objective correction input retry phase"))).toBe(true);
  });

  it("rebuilds the frozen broad fallback correction without rewriting correct prefix branches", async () => {
    const requiredPath = "src/diff/props.js";
    const lineEnding = "\r\n";
    const functionGuard = "\t\tif (typeof value == 'function') {";
    const functionComment = "\t\t\t// never serialize functions as attribute values";
    const originalCondition = "\t\t} else if (value != NULL && value !== false) {";
    const ordinarySetAttribute = "\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);";
    const removalStatement = "\t\t\tdom.removeAttribute(name);";
    const unconditionalFallback = "\t\t} else {";
    const guardedFallback = "\t\t} else if (value !== false) {";
    const branchEnd = "\t\t}";
    const baselineBranch = [
      functionGuard,
      functionComment,
      originalCondition,
      ordinarySetAttribute,
      unconditionalFallback,
      removalStatement,
      branchEnd,
    ].join(lineEnding);
    const postWriteBranch = [
      functionGuard,
      functionComment,
      "\t\t} else if (value == NULL) {",
      removalStatement,
      "\t\t} else if (",
      "\t\t\t(name[0] == 'a' && name[1] == 'r' && name[2] == 'i' && name[3] == 'a' && name[4] == '-') ||",
      "\t\t\t(name[0] == 'd' && name[1] == 'a' && name[2] == 't' && name[3] == 'a' && name[4] == '-')",
      "\t\t) {",
      "\t\t\tdom.setAttribute(name, value === false ? 'false' : (name == 'popover' && value == true ? '' : value));",
      unconditionalFallback,
      ordinarySetAttribute,
      branchEnd,
    ].join(lineEnding);
    const correctedBranch = postWriteBranch.replace(
      [unconditionalFallback, ordinarySetAttribute, branchEnd].join(lineEnding),
      [
        guardedFallback,
        ordinarySetAttribute,
        unconditionalFallback,
        removalStatement,
        branchEnd,
      ].join(lineEnding),
    );
    const sourcePrefix = Array.from(
      { length: 145 },
      (_, index) => `const unrelatedBefore${index} = ${index};`,
    ).join(lineEnding);
    const sourceSuffix = Array.from(
      { length: 70 },
      (_, index) => `const unrelatedAfter${index} = ${index};`,
    ).join(lineEnding);
    const baselineSource = `${sourcePrefix}${lineEnding}${baselineBranch}${lineEnding}${sourceSuffix}`;
    const postWriteSource = baselineSource.replace(baselineBranch, postWriteBranch);
    const correctedSource = postWriteSource.replace(postWriteBranch, correctedBranch);
    const initialPatch = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      ` ${functionGuard}`,
      ` ${functionComment}`,
      `-${originalCondition}`,
      `-${ordinarySetAttribute}`,
      "+\t\t} else if (value == NULL) {",
      `+${removalStatement}`,
      "+\t\t} else if (",
      "+\t\t\t(name[0] == 'a' && name[1] == 'r' && name[2] == 'i' && name[3] == 'a' && name[4] == '-') ||",
      "+\t\t\t(name[0] == 'd' && name[1] == 'a' && name[2] == 't' && name[3] == 'a' && name[4] == '-')",
      "+\t\t) {",
      "+\t\t\tdom.setAttribute(name, value === false ? 'false' : (name == 'popover' && value == true ? '' : value));",
      ` ${unconditionalFallback}`,
      `-${removalStatement}`,
      `+${ordinarySetAttribute}`,
      ` ${branchEnd}`,
      "*** End Patch",
    ].join("\n");
    const contextOnlyOutputRepair = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      ` ${unconditionalFallback}`,
      ` ${ordinarySetAttribute}`,
      "*** End Patch",
    ].join("\n");
    const broadInputCorrection = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      `-${functionGuard}`,
      "+\t\tif (typeof value == 'function' || value === false) {",
      ` ${functionComment}`,
      "*** End Patch",
    ].join("\n");
    const expectedCorrection = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      `-${unconditionalFallback}`,
      `-${ordinarySetAttribute}`,
      `+${guardedFallback}`,
      `+${ordinarySetAttribute}`,
      `+${unconditionalFallback}`,
      `+${removalStatement}`,
      ` ${branchEnd}`,
      "*** End Patch",
    ].join(lineEnding);
    const task = [
      "Fix the frozen browser-facing regression in the real web project. Preserve false values for aria-* and data-* attributes by serializing them, remove ordinary attributes with false values, and remove every attribute with null or undefined values. Make the smallest change in src/diff/props.js and pass the supplied deterministic checks. Use the frozen behavior truth set real-web-ui-regression-v1. The deterministic checks are in test/shared/benchmark-v3-ui-regression.test.js. False aria-* and data-* values are serialized as the string false. False values for ordinary attributes remove the attribute. Null and undefined values remove every attribute, including aria-* and data-* attributes. Only src/diff/props.js may change, and semantically equivalent implementations are accepted. Do not modify tests, dependencies, package metadata, or any path other than src/diff/props.js. Return exactly one JSON object with a non-empty summary.",
    ].join("\n");
    const successJson = '{"summary":"Verified exact false and nullish attribute behavior."}';
    const requests: Array<Record<string, any>> = [];
    const executedPatches: string[] = [];
    let currentSource = baselineSource;
    let ordinaryCallCount = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      const instruction = String(body.messages?.[0]?.content ?? "");
      if (instruction.includes("Post-mutation final objective review phase")) {
        return jsonResponse({
          choices: [{ finish_reason: "stop", message: { content: successJson } }],
          usage: { prompt_tokens: 300, completion_tokens: 30 },
        });
      }
      if (instruction.includes("Post-mutation verification phase")) {
        return jsonResponse(modelToolCall(`read-current-source-${requests.length}`, "file_read", {
          path: requiredPath,
          limit: 1_048_576,
        }));
      }
      if (instruction.includes("Post-mutation objective correction input retry phase")) {
        return jsonResponse(modelToolCall("broad-input-correction", "apply_patch", {
          input: broadInputCorrection,
        }));
      }
      if (instruction.includes("Post-mutation objective review output repair phase")) {
        return jsonResponse(modelToolCall("context-only-output-repair", "apply_patch", {
          input: contextOnlyOutputRepair,
        }));
      }
      if (instruction.includes("Post-mutation objective review phase")) {
        return jsonResponse({
          choices: [{
            finish_reason: "stop",
            message: { content: "The branch still needs a contract correction." },
          }],
          usage: { prompt_tokens: 300, completion_tokens: 30 },
        });
      }
      ordinaryCallCount += 1;
      return jsonResponse(ordinaryCallCount === 1
        ? modelToolCall("read-baseline-source", "file_read", { path: requiredPath })
        : modelToolCall("apply-broad-branch", "apply_patch", { input: initialPatch }));
    });

    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => {
      if (request.name === "file_read") {
        return {
          id: request.id,
          name: request.name,
          success: true,
          output: JSON.stringify({
            path: requiredPath,
            size: currentSource.length,
            truncated: false,
            content: currentSource,
          }),
          durationMs: 1,
        };
      }
      const patchInput = String(request.arguments?.input ?? "");
      executedPatches.push(patchInput);
      if (patchInput === initialPatch) {
        currentSource = postWriteSource;
      } else if (patchInput === expectedCorrection) {
        currentSource = correctedSource;
      } else {
        return {
          id: request.id,
          name: request.name,
          success: false,
          output: "",
          error: "Unexpected correction reached the patch executor",
          failureKind: "input_error" as const,
          metadata: { repairAction: "apply_patch_input_invalid" },
          durationMs: 1,
        };
      }
      return {
        id: request.id,
        name: request.name,
        success: true,
        output: "Patch applied successfully",
        metadata: {
          workspaceMutation: { schemaVersion: 1, changedPaths: [requiredPath] },
        },
        durationMs: 1,
      };
    });
    const agent = createAgent(execute);

    const items = await collect(agent.run({
      conversationId: "conv-frozen-web-multiline-fallback",
      text: task,
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths: [requiredPath],
          toolLoopIterationBudget: 10,
        },
      },
      structuredOutput: {
        schema: { type: "object", required: ["summary"] },
        validateOutput: (text: string) => text === successJson
          ? { ok: true as const, outputText: text }
          : { ok: false as const, message: "summary is required" },
      },
    } as any));

    expect(postWriteSource.length).toBeGreaterThan(4_096);
    expect(items.at(-2)).toEqual({ type: "final", text: successJson });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
    expect(executedPatches).toEqual([initialPatch, expectedCorrection]);
    expect(executedPatches).not.toContain(contextOnlyOutputRepair);
    expect(executedPatches).not.toContain(broadInputCorrection);
    expect(currentSource).toBe(correctedSource);
    expect(requests.some((request) => String(request.messages?.[0]?.content ?? "")
      .includes("Post-mutation objective review output repair phase"))).toBe(true);
    expect(requests.some((request) => String(request.messages?.[0]?.content ?? "")
      .includes("Post-mutation objective correction input retry phase"))).toBe(true);
  });

  it("rebuilds the frozen WSL2 narrow-prefix output repair before accepting its final summary", async () => {
    const requiredPath = "src/diff/props.js";
    const functionGuard = "\t\tif (typeof value == 'function') {";
    const functionComment = "\t\t\t// never serialize functions as attribute values";
    const originalCondition = "\t\t} else if (value != NULL && value !== false) {";
    const ordinarySetAttribute = "\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);";
    const removalStatement = "\t\t\tdom.removeAttribute(name);";
    const branchEnd = "\t\t}";
    const narrowPredicate = "name[0] == 'a' && name[1] == 'r' || name[0] == 'd' && name[1] == 'a'";
    const baselineBranch = [
      functionGuard,
      functionComment,
      originalCondition,
      ordinarySetAttribute,
      "\t\t} else {",
      removalStatement,
      branchEnd,
    ].join("\n");
    const firstPostWriteBranch = [
      "\t\tif (value == NULL) {",
      removalStatement,
      `\t\t} else if (${narrowPredicate}) {`,
      branchEnd,
    ].join("\n");
    const regressedBranch = [
      "\t\tif (value == NULL) {",
      removalStatement,
      `\t\t} else if (value === false && !(${narrowPredicate})) {`,
      removalStatement,
      `\t\t} else if (value === false && (${narrowPredicate})) {`,
      "\t\t\tdom.setAttribute(name, 'false');",
      branchEnd,
    ].join("\n");
    const correctedBranch = [
      functionGuard,
      functionComment,
      "\t\t} else if (value == NULL) {",
      removalStatement,
      "\t\t} else if (",
      "\t\t\t(name[0] == 'a' && name[1] == 'r' && name[2] == 'i' && name[3] == 'a' && name[4] == '-') ||",
      "\t\t\t(name[0] == 'd' && name[1] == 'a' && name[2] == 't' && name[3] == 'a' && name[4] == '-')",
      "\t\t) {",
      "\t\t\tdom.setAttribute(name, value === false ? 'false' : (name == 'popover' && value == true ? '' : value));",
      "\t\t} else if (value !== false) {",
      ordinarySetAttribute,
      "\t\t} else {",
      removalStatement,
      branchEnd,
    ].join("\n");
    const sourcePrefix = Array.from(
      { length: 145 },
      (_, index) => `const unrelatedBefore${index} = ${index};`,
    ).join("\n");
    const sourceSuffix = Array.from(
      { length: 70 },
      (_, index) => `const unrelatedAfter${index} = ${index};`,
    ).join("\n");
    const baselineSource = `${sourcePrefix}\n${baselineBranch}\n${sourceSuffix}`;
    const firstPostWriteSource = baselineSource.replace(baselineBranch, firstPostWriteBranch);
    const regressedSource = firstPostWriteSource.replace(firstPostWriteBranch, regressedBranch);
    const correctedSource = regressedSource.replace(regressedBranch, correctedBranch);
    const initialPatch = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      `-${functionGuard}`,
      `-${functionComment}`,
      `-${originalCondition}`,
      `-${ordinarySetAttribute}`,
      "-\t\t} else {",
      `-${removalStatement}`,
      "+\t\tif (value == NULL) {",
      `+${removalStatement}`,
      `+\t\t} else if (${narrowPredicate}) {`,
      "*** End Patch",
    ].join("\n");
    const regressedOutputRepair = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      "-\t\tif (value == NULL) {",
      "+\t\tif (value == NULL) {",
      ` ${removalStatement}`,
      `-\t\t} else if (${narrowPredicate}) {`,
      `-${branchEnd}`,
      `+\t\t} else if (value === false && !(${narrowPredicate})) {`,
      `+${removalStatement}`,
      `+\t\t} else if (value === false && (${narrowPredicate})) {`,
      "+\t\t\tdom.setAttribute(name, 'false');",
      `+${branchEnd}`,
      " \t}",
      " }",
      "*** End Patch",
    ].join("\n");
    const expectedCorrection = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      "-\t\tif (value == NULL) {",
      `-${removalStatement}`,
      `-\t\t} else if (${narrowPredicate}) {`,
      `-${branchEnd}`,
      `+${functionGuard}`,
      `+${functionComment}`,
      "+\t\t} else if (value == NULL) {",
      `+${removalStatement}`,
      "+\t\t} else if (",
      "+\t\t\t(name[0] == 'a' && name[1] == 'r' && name[2] == 'i' && name[3] == 'a' && name[4] == '-') ||",
      "+\t\t\t(name[0] == 'd' && name[1] == 'a' && name[2] == 't' && name[3] == 'a' && name[4] == '-')",
      "+\t\t) {",
      "+\t\t\tdom.setAttribute(name, value === false ? 'false' : (name == 'popover' && value == true ? '' : value));",
      "+\t\t} else if (value !== false) {",
      `+${ordinarySetAttribute}`,
      "+\t\t} else {",
      `+${removalStatement}`,
      `+${branchEnd}`,
      "*** End Patch",
    ].join("\n");
    const task = "Fix the frozen browser-facing regression in the real web project. Preserve false values for aria-* and data-* attributes by serializing them, remove ordinary attributes with false values, and remove every attribute with null or undefined values. Make the smallest change in src/diff/props.js and pass the supplied deterministic checks. Use the frozen behavior truth set real-web-ui-regression-v1. The deterministic checks are in test/shared/benchmark-v3-ui-regression.test.js. False aria-* and data-* values are serialized as the string false. False values for ordinary attributes remove the attribute. Null and undefined values remove every attribute, including aria-* and data-* attributes. Only src/diff/props.js may change, and semantically equivalent implementations are accepted. Do not modify tests, dependencies, package metadata, or any path other than src/diff/props.js. Return exactly one JSON object with a non-empty summary.";
    const successJson = "{\"summary\":\"false values for aria-* and data-* attributes are serialized as the string 'false'; false values for ordinary attributes remove the attribute; null and undefined values remove every attribute, including aria-* and data-*. Only src/diff/props.js was changed.\"}";
    const requests: Array<Record<string, any>> = [];
    const executedPatches: string[] = [];
    let currentSource = baselineSource;
    let ordinaryCallCount = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      const instruction = String(body.messages?.[0]?.content ?? "");
      if (instruction.includes("Post-mutation final objective review phase")) {
        return jsonResponse({
          choices: [{ finish_reason: "stop", message: { content: successJson } }],
          usage: { prompt_tokens: 300, completion_tokens: 60 },
        });
      }
      if (instruction.includes("Post-mutation verification phase")) {
        return jsonResponse(modelToolCall(`read-current-source-${requests.length}`, "file_read", {
          path: requiredPath,
          limit: 1_048_576,
        }));
      }
      if (instruction.includes("Post-mutation objective review output repair phase")) {
        return jsonResponse(modelToolCall("frozen-regressed-output-repair", "apply_patch", {
          input: regressedOutputRepair,
        }));
      }
      if (instruction.includes("Post-mutation objective review phase")) {
        return jsonResponse({
          choices: [{
            finish_reason: "stop",
            message: { content: "The attribute fallback still needs correction before completion." },
          }],
          usage: { prompt_tokens: 300, completion_tokens: 60 },
        });
      }
      ordinaryCallCount += 1;
      return jsonResponse(ordinaryCallCount === 1
        ? modelToolCall("read-frozen-baseline", "file_read", { path: requiredPath })
        : modelToolCall("apply-frozen-initial-patch", "apply_patch", { input: initialPatch }));
    });

    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => {
      if (request.name === "file_read") {
        return {
          id: request.id,
          name: request.name,
          success: true,
          output: JSON.stringify({
            path: requiredPath,
            size: currentSource.length,
            truncated: false,
            content: currentSource,
          }),
          durationMs: 1,
        };
      }
      const patchInput = String(request.arguments?.input ?? "");
      executedPatches.push(patchInput);
      if (patchInput === initialPatch) {
        currentSource = firstPostWriteSource;
      } else if (patchInput === regressedOutputRepair) {
        currentSource = regressedSource;
      } else if (patchInput === expectedCorrection) {
        currentSource = correctedSource;
      } else {
        return {
          id: request.id,
          name: request.name,
          success: false,
          output: "",
          error: "Unexpected correction reached the patch executor",
          failureKind: "input_error" as const,
          metadata: { repairAction: "apply_patch_input_invalid" },
          durationMs: 1,
        };
      }
      return {
        id: request.id,
        name: request.name,
        success: true,
        output: "Patch applied successfully",
        metadata: {
          workspaceMutation: { schemaVersion: 1, changedPaths: [requiredPath] },
        },
        durationMs: 1,
      };
    });
    const agent = createAgent(execute);

    const items = await collect(agent.run({
      conversationId: "conv-frozen-web-wsl2-narrow-prefix",
      text: task,
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths: [requiredPath],
          toolLoopIterationBudget: 10,
        },
      },
      structuredOutput: {
        schema: { type: "object", required: ["summary"] },
        validateOutput: (text: string) => text === successJson
          ? { ok: true as const, outputText: text }
          : { ok: false as const, message: "summary is required" },
      },
    } as any));

    expect(firstPostWriteSource.length).toBeGreaterThan(4_096);
    expect(items.at(-2)).toEqual({ type: "final", text: successJson });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
    expect(executedPatches).toEqual([initialPatch, expectedCorrection]);
    expect(executedPatches).not.toContain(regressedOutputRepair);
    expect(currentSource).toBe(correctedSource);
    expect(requests.some((request) => String(request.messages?.[0]?.content ?? "")
      .includes("Post-mutation objective review output repair phase"))).toBe(true);
  });
});

function createAgent(execute: ReturnType<typeof vi.fn>): ToolEnabledAgent {
  return new ToolEnabledAgent({
    baseUrl: "https://api.openai.com/v1",
    apiKey: "test-key",
    model: "deepseek-v4-flash",
    thinking: { type: "enabled" },
    maxTotalTokens: 24_000,
    maxOutputTokens: 4_096,
    toolLoopIterationBudget: 10,
    streamingEnabled: false,
    toolExecutor: {
      getDefinitions: () => [toolDefinition("file_read"), toolDefinition("apply_patch")],
      getRegisteredToolContract: (name: string) => name === "apply_patch"
        ? { name, family: "patch", isReadOnly: false, riskLevel: "high" as const }
        : { name, family: "workspace-read", isReadOnly: true, riskLevel: "low" as const },
      consumeLoadedDeferredToolsForNextTurn: vi.fn(async () => []),
      setTokenCounter: vi.fn(),
      clearTokenCounter: vi.fn(),
      releaseConversation: vi.fn(),
      execute,
    } as any,
  });
}

function toolDefinition(name: string) {
  return {
    type: "function" as const,
    function: {
      name,
      description: `${name} tool`,
      parameters: { type: "object", properties: {} },
    },
  };
}

function modelToolCall(id: string, name: string, args: Record<string, unknown>) {
  return {
    choices: [{
      finish_reason: "tool_calls",
      message: {
        content: null,
        tool_calls: [{
          id,
          type: "function",
          function: { name, arguments: JSON.stringify(args) },
        }],
      },
    }],
    usage: { prompt_tokens: 300, completion_tokens: 60 },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function collect(iterable: AsyncIterable<any>): Promise<any[]> {
  const items: any[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}
