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

describe("ToolEnabledAgent post-mutation structured output", () => {
  it("requests JSON mode before failing closed on two full-length prose reviews", async () => {
    const requiredPath = "src/diff/props.js";
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      if (requests.length === 1) {
        return jsonResponse(modelToolCall("patch-broad", "apply_patch", {
          input: [
            "*** Begin Patch",
            `*** Update File: ${requiredPath}`,
            "@@",
            "-\t\t} else if (value != NULL && value !== false) {",
            "+\t\t} else if (value != NULL) {",
            "*** End Patch",
          ].join("\n"),
        }, 500, 100));
      }
      if (requests.length === 2) {
        return jsonResponse(modelToolCall("read-broad", "file_read", {
          path: requiredPath,
          limit: 1_048_576,
        }, 500, 100));
      }
      return jsonResponse({
        choices: [{
          finish_reason: "length",
          message: {
            content: "The post-write evidence requires further review. ".repeat(96),
          },
        }],
        usage: { prompt_tokens: 1_700, completion_tokens: 1_024 },
      });
    });

    const execute = vi.fn(async (request: {
      id: string;
      name: string;
    }) => ({
      id: request.id,
      name: request.name,
      success: true,
      output: request.name === "file_read"
        ? JSON.stringify({
            path: requiredPath,
            truncated: false,
            content: "\t\t} else if (value != NULL) {",
          })
        : "Patch applied successfully",
      ...(request.name === "apply_patch" ? {
        metadata: {
          workspaceMutation: { schemaVersion: 1, changedPaths: [requiredPath] },
        },
      } : {}),
      durationMs: 1,
    }));
    const agent = createAgent(execute);

    const items = await collect(agent.run({
      conversationId: "conv-post-mutation-objective-full-length-prose",
      text: "Restore false aria-* attribute serialization with the smallest change while preserving ordinary false attribute behavior.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths: [requiredPath],
          toolLoopIterationBudget: 6,
        },
      },
      structuredOutput: {
        schema: { type: "object", required: ["summary"] },
        validateOutput: (text: string) => text === '{"summary":"corrected and verified"}'
          ? { ok: true as const, outputText: text }
          : { ok: false as const, message: "summary is required" },
      },
    } as any));

    expect(requests).toHaveLength(4);
    expect(requests[2]?.response_format).toEqual({ type: "json_object" });
    expect(requests[3]?.response_format).toEqual({ type: "json_object" });
    expect(requests[2]?.messages[0]?.content).toContain(
      "Return exactly one complete raw JSON value",
    );
    expect(requests[2]?.messages[0]?.content).toContain('"required":["summary"]');
    expect(requests[2]?.tools?.map((tool: any) => tool.function.name)).toEqual(["apply_patch"]);
    expect(requests[3]?.tools?.map((tool: any) => tool.function.name)).toEqual(["apply_patch"]);
    expect(requests[2]?.max_tokens).toBe(1_024);
    expect(requests[3]?.max_tokens).toBe(1_024);
    expect(requests[2]?.thinking).toEqual({ type: "disabled" });
    expect(requests[3]?.thinking).toEqual({ type: "disabled" });
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual([
      "apply_patch",
      "file_read",
    ]);
    expect(items.at(-2)).toEqual({
      type: "final",
      text: "required workspace mutation was not completed: the post-write objective review returned neither valid final JSON nor an allowed correction after its one phase-aware output repair.",
    });
    expect(items.at(-1)).toEqual({ type: "status", status: "error" });
  });

  it("keeps malformed successful objective review repair inside the objective-review phase", async () => {
    const requiredPath = "src/dom.ts";
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      if (requests.length === 1) {
        return jsonResponse(modelToolCall("patch-1", "apply_patch", {
          input: "*** Begin Patch\n*** Update File: src/dom.ts\n@@\n-old\n+new\n*** End Patch",
        }, 500, 100));
      }
      if (requests.length === 2) {
        return jsonResponse(modelToolCall("read-1", "file_read", {
          path: requiredPath,
          limit: 1_048_576,
        }, 500, 100));
      }
      if (requests.length === 3) {
        return jsonResponse({
          choices: [{
            finish_reason: "stop",
            message: { content: "The mutation satisfies the requested behavior." },
          }],
          usage: { prompt_tokens: 17_000, completion_tokens: 100 },
        });
      }
      if ((body.thinking as { type?: unknown } | undefined)?.type !== "disabled") {
        return jsonResponse({
          choices: [{
            finish_reason: "length",
            message: { content: null, reasoning_content: "R".repeat(Number(body.max_tokens)) },
          }],
          usage: { prompt_tokens: 300, completion_tokens: Number(body.max_tokens) },
        });
      }
      return jsonResponse({
        choices: [{
          finish_reason: "stop",
          message: { content: '{"summary":"migrated"}' },
        }],
        usage: { prompt_tokens: 300, completion_tokens: 20 },
      });
    });

    const source = Array.from(
      { length: 900 },
      (_, index) => `const currentBehavior${index} = preserveCase(${index});`,
    ).join("\n");
    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => ({
      id: request.id,
      name: request.name,
      success: true,
      output: request.name === "file_read"
        ? JSON.stringify({ path: requiredPath, truncated: false, content: source })
        : "Patch applied successfully",
      ...(request.name === "apply_patch" ? {
        metadata: {
          workspaceMutation: { schemaVersion: 1, changedPaths: [requiredPath] },
        },
      } : {}),
      durationMs: 1,
    }));
    const agent = createAgent(execute);
    const validateOutput = vi.fn((text: string) => text === '{"summary":"migrated"}'
      ? { ok: true as const, outputText: text }
      : { ok: false as const, message: "summary is required" });

    const items = await collect(agent.run({
      conversationId: "conv-post-mutation-structured-repair-thinking",
      text: "Apply the smallest change while preserving behavior outside the requested subset.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths: [requiredPath],
          toolLoopIterationBudget: 6,
        },
      },
      structuredOutput: {
        schema: { type: "object", required: ["summary"] },
        validateOutput,
      },
    } as any));

    expect(requests).toHaveLength(4);
    expect(requests[2]?.messages[0]?.content).toContain("Post-mutation objective review phase");
    expect(requests[2]?.thinking).toEqual({ type: "disabled" });
    expect(requests[3]?.messages[0]?.content).toContain(
      "Post-mutation objective review output repair phase",
    );
    expect(requests[3]?.messages[1]?.content).toContain("currentBehavior0");
    expect(requests[3]?.tools?.map((tool: any) => tool.function.name)).toEqual(["apply_patch"]);
    expect(requests[3]?.thinking).toEqual({ type: "disabled" });
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual([
      "apply_patch",
      "file_read",
    ]);
    expect(validateOutput).toHaveBeenCalledTimes(2);
    expect(items).toContainEqual({ type: "final", text: '{"summary":"migrated"}' });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("fails closed when objective-review output repair remains invalid", async () => {
    const requiredPath = "src/dom.ts";
    const requests: Array<Record<string, any>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      if (requests.length === 1) {
        return jsonResponse(modelToolCall("patch-1", "apply_patch", {
          input: "*** Begin Patch\n*** Update File: src/dom.ts\n@@\n-old\n+new\n*** End Patch",
        }, 500, 100));
      }
      if (requests.length === 2) {
        return jsonResponse(modelToolCall("read-1", "file_read", {
          path: requiredPath,
          limit: 1_048_576,
        }, 500, 100));
      }
      return jsonResponse({
        choices: [{
          finish_reason: "stop",
          message: {
            content: requests.length === 3
              ? "The mutation still needs a final contract review."
              : "The repair remains incomplete and cannot establish success.",
          },
        }],
        usage: { prompt_tokens: 500, completion_tokens: 30 },
      });
    });

    const execute = vi.fn(async (request: {
      id: string;
      name: string;
    }) => ({
      id: request.id,
      name: request.name,
      success: true,
      output: request.name === "file_read"
        ? JSON.stringify({ path: requiredPath, truncated: false, content: "export const current = true;" })
        : "Patch applied successfully",
      ...(request.name === "apply_patch" ? {
        metadata: {
          workspaceMutation: { schemaVersion: 1, changedPaths: [requiredPath] },
        },
      } : {}),
      durationMs: 1,
    }));
    const agent = createAgent(execute);

    const items = await collect(agent.run({
      conversationId: "conv-post-mutation-objective-output-repair-fails-closed",
      text: "Apply the smallest change while preserving behavior outside the requested subset.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths: [requiredPath],
          toolLoopIterationBudget: 6,
        },
      },
      structuredOutput: {
        schema: { type: "object", required: ["summary"] },
        validateOutput: (text: string) => text === '{"summary":"migrated"}'
          ? { ok: true as const, outputText: text }
          : { ok: false as const, message: "summary is required" },
      },
    } as any));

    expect(requests).toHaveLength(4);
    expect(requests[2]?.messages[0]?.content).toContain("Post-mutation objective review phase");
    expect(requests[3]?.messages[0]?.content).toContain(
      "Post-mutation objective review output repair phase",
    );
    expect(requests[3]?.messages[0]?.content).not.toContain(
      "Bounded structured-output repair phase",
    );
    expect(requests[3]?.tools?.map((tool: any) => tool.function.name)).toEqual(["apply_patch"]);
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual([
      "apply_patch",
      "file_read",
    ]);
    expect(items.at(-2)).toEqual({
      type: "final",
      text: "required workspace mutation was not completed: the post-write objective review returned neither valid final JSON nor an allowed correction after its one phase-aware output repair.",
    });
    expect(items.at(-1)).toEqual({ type: "status", status: "error" });
  });

  it("uses malformed objective review repair to correct an unpreserved outside behavior", async () => {
    const requiredPath = "src/diff/props.js";
    const broadCondition = "\t\t} else if (value != NULL) {";
    const correctedCondition = "\t\t} else if (value != NULL && (value !== false || name[4] == '-')) {";
    const broadSource = [
      "\t\t// aria- and data- attributes have no boolean representation.",
      "\t\tif (typeof value == 'function') {",
      broadCondition,
      "\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
      "\t\t} else {",
      "\t\t\tdom.removeAttribute(name);",
      "\t\t}",
    ].join("\n");
    const correctedSource = broadSource.replace(broadCondition, correctedCondition);
    const correctionPatch = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      `-${broadCondition}`,
      `+${correctedCondition}`,
      "*** End Patch",
    ].join("\n");
    const requests: Array<Record<string, any>> = [];
    let mutationCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      if (requests.length === 1) {
        return jsonResponse(modelToolCall("patch-broad", "apply_patch", {
          input: [
            "*** Begin Patch",
            `*** Update File: ${requiredPath}`,
            "@@",
            "-\t\t} else if (value != NULL && value !== false) {",
            `+${broadCondition}`,
            "*** End Patch",
          ].join("\n"),
        }, 500, 100));
      }
      if (requests.length === 2 || requests.length === 5) {
        return jsonResponse(modelToolCall(`read-${requests.length}`, "file_read", {
          path: requiredPath,
          limit: 1_048_576,
        }, 500, 100));
      }
      if (requests.length === 3) {
        return jsonResponse({
          choices: [{
            finish_reason: "stop",
            message: {
              content: "The positive aria witness passes, but the current predicate also serializes false for ordinary attributes, so outside behavior is not preserved.",
            },
          }],
          usage: { prompt_tokens: 1_700, completion_tokens: 100 },
        });
      }
      if (requests.length === 4) {
        return jsonResponse(modelToolCall("correct-outside-behavior", "apply_patch", {
          input: correctionPatch,
        }, 500, 100));
      }
      return jsonResponse({
        choices: [{
          finish_reason: "stop",
          message: { content: '{"summary":"corrected and verified"}' },
        }],
        usage: { prompt_tokens: 500, completion_tokens: 30 },
      });
    });

    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => {
      if (request.name === "apply_patch") {
        mutationCount++;
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
      }
      return {
        id: request.id,
        name: request.name,
        success: true,
        output: JSON.stringify({
          path: requiredPath,
          truncated: false,
          content: mutationCount > 1 ? correctedSource : broadSource,
        }),
        durationMs: 1,
      };
    });
    const agent = createAgent(execute);

    const items = await collect(agent.run({
      conversationId: "conv-post-mutation-objective-output-repair",
      text: "Restore false aria-* attribute serialization with the smallest change while preserving the public behavior of other attributes.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths: [requiredPath],
          toolLoopIterationBudget: 6,
        },
      },
      structuredOutput: {
        schema: { type: "object", required: ["summary"] },
        validateOutput: (text: string) => text === '{"summary":"corrected and verified"}'
          ? { ok: true as const, outputText: text }
          : { ok: false as const, message: "summary is required" },
      },
    } as any));

    expect(requests).toHaveLength(6);
    expect(requests[3]?.messages[0]?.content).toContain(
      "Post-mutation objective review output repair phase",
    );
    expect(requests[3]?.messages[0]?.content).toContain(
      "Do not turn an incomplete or uncertain review into a success summary",
    );
    expect(requests[3]?.messages[1]?.content).toContain(broadCondition.trim());
    expect(requests[3]?.tools?.map((tool: any) => tool.function.name)).toEqual(["apply_patch"]);
    expect(requests[3]?.thinking).toEqual({ type: "disabled" });
    expect(execute.mock.calls.map(([request]) => request.name)).toEqual([
      "apply_patch",
      "file_read",
      "apply_patch",
      "file_read",
    ]);
    expect(execute.mock.calls[2]?.[0]?.arguments).toEqual({ input: correctionPatch });
    expect(items).toContainEqual({ type: "final", text: '{"summary":"corrected and verified"}' });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("rejects a valid summary for the f92f880 missing null guard", async () => {
    const requiredPath = "src/diff/props.js";
    const initialCondition = "\t\t} else if (value !== false || name[4] == '-') {";
    const correctedCondition = "\t\t} else if (value != NULL && (value !== false || name[4] == '-')) {";
    const initialPatch = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      "-\t\t} else if (value != NULL && value !== false) {",
      `+${initialCondition}`,
      "*** End Patch",
    ].join("\n");
    const correctionPatch = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      `-${initialCondition}`,
      `+${correctedCondition}`,
      "*** End Patch",
    ].join("\n");
    const requests: Array<Record<string, any>> = [];
    const executedPatches: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      const instruction = String(body.messages?.[0]?.content ?? "");
      if (requests.length === 1) {
        return jsonResponse(modelToolCall("patch-missing-null-guard", "apply_patch", {
          input: initialPatch,
        }, 300, 60));
      }
      if (requests.length === 2 || requests.length === 5) {
        return jsonResponse(modelToolCall(`read-${requests.length}`, "file_read", {
          path: requiredPath,
          limit: 1_048_576,
        }, 300, 60));
      }
      if (requests.length === 3) {
        return jsonResponse({
          choices: [{
            finish_reason: "stop",
            message: { content: '{"summary":"looks complete"}' },
          }],
          usage: { prompt_tokens: 300, completion_tokens: 30 },
        });
      }
      if (instruction.includes("Post-mutation objective correction input retry phase")) {
        return jsonResponse(modelToolCall("restore-null-guard", "apply_patch", {
          input: correctionPatch,
        }, 300, 60));
      }
      return jsonResponse({
        choices: [{
          finish_reason: "stop",
          message: { content: '{"summary":"corrected"}' },
        }],
        usage: { prompt_tokens: 300, completion_tokens: 30 },
      });
    });
    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => {
      if (request.name === "apply_patch") {
        executedPatches.push(String(request.arguments?.input ?? ""));
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
      }
      const content = executedPatches.includes(correctionPatch)
        ? `${correctedCondition}\n\t\t\tdom.setAttribute(name, value);`
        : `${initialCondition}\n\t\t\tdom.setAttribute(name, value);`;
      return {
        id: request.id,
        name: request.name,
        success: true,
        output: JSON.stringify({ path: requiredPath, truncated: false, content }),
        durationMs: 1,
      };
    });
    const agent = createAgent(execute);

    const items = await collect(agent.run({
      conversationId: "conv-post-mutation-missing-null-guard",
      text: "Restore false aria-* attribute serialization with the smallest change while preserving ordinary false attribute behavior.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths: [requiredPath],
          toolLoopIterationBudget: 6,
        },
      },
      structuredOutput: {
        schema: { type: "object", required: ["summary"] },
        validateOutput: (text: string) => /^\{"summary":"(?:looks complete|corrected)"\}$/.test(text)
          ? { ok: true as const, outputText: text }
          : { ok: false as const, message: "summary is required" },
      },
    } as any));

    expect(requests).toHaveLength(6);
    expect(requests[2]?.messages[0]?.content).toContain(
      "Preserve existing outer guards for null or missing values byte-for-byte",
    );
    expect(requests[2]?.messages[0]?.content).toContain(
      "restore the missing guard first using the removed line as authoritative source evidence",
    );
    expect(requests[2]?.messages[0]?.content).toContain(
      "In the same correction, restore the missing guard and add the smallest task-specific subset predicate",
    );
    expect(requests[2]?.messages[0]?.content).toContain(
      "Restoring only the original combined guard is an exact reversal and remains invalid",
    );
    expect(requests[3]?.messages[0]?.content).toContain(
      "Post-mutation objective correction input retry phase",
    );
    expect(requests[3]?.messages[0]?.content).toContain(
      "Preserve existing outer guards for null or missing values byte-for-byte",
    );
    expect(requests[3]?.messages[0]?.content).toContain(
      "restore the missing guard first using the removed line as authoritative source evidence",
    );
    expect(requests[3]?.messages[0]?.content).toContain(
      "In the same correction, restore the missing guard and add the smallest task-specific subset predicate",
    );
    expect(requests[3]?.messages[0]?.content).toContain(
      "Restoring only the original combined guard is an exact reversal and remains invalid",
    );
    expect(executedPatches).toEqual([initialPatch, correctionPatch]);
    expect(items).toContainEqual({ type: "final", text: '{"summary":"corrected"}' });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("retries a structured correction whose false witness remains shadowed", async () => {
    const requiredPath = "src/diff/props.js";
    const earlyFalseRemoval = "\t\t} else if (value == NULL || value === false) {";
    const reachableEarlyRemoval = "\t\t} else if (value == NULL || (value === false && name[4] != '-')) {";
    const falseAriaBranch = "\t\t} else if (name[0] == 'a' && name[1] == 'r' && value === false) {";
    const widenedAriaBranch = "\t\t} else if (name[0] == 'a' && name[1] == 'r') {";
    const setAttributeLine = "\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);";
    const removeAttributeLine = "\t\t\tdom.removeAttribute(name);";
    const initialPatch = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      "-\t\t} else if (value != NULL && value !== false) {",
      `+${earlyFalseRemoval}`,
      `+${removeAttributeLine}`,
      `+${falseAriaBranch}`,
      "+\t\t\tdom.setAttribute(name, 'false');",
      "+\t\t} else {",
      ` ${setAttributeLine}`,
      "-\t\t} else {",
      "*** End Patch",
    ].join("\n");
    const shadowedCorrection = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      `-${falseAriaBranch}`,
      `+${widenedAriaBranch}`,
      "*** End Patch",
    ].join("\n");
    const reachableCorrection = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      `-${earlyFalseRemoval}`,
      `+${reachableEarlyRemoval}`,
      "@@",
      ` ${setAttributeLine}`,
      `-${removeAttributeLine}`,
      "*** End Patch",
    ].join("\n");
    const postInitialSource = [
      earlyFalseRemoval,
      removeAttributeLine,
      falseAriaBranch,
      "\t\t\tdom.setAttribute(name, 'false');",
      "\t\t} else {",
      setAttributeLine,
      removeAttributeLine,
      "\t\t}",
    ].join("\n");
    const postCorrectionSource = postInitialSource
      .replace(earlyFalseRemoval, reachableEarlyRemoval)
      .replace(`${setAttributeLine}\n${removeAttributeLine}`, setAttributeLine);
    const requests: Array<Record<string, any>> = [];
    const executedPatches: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      const instruction = String(body.messages?.[0]?.content ?? "");
      if (instruction.includes("Post-mutation verification phase")) {
        return jsonResponse(modelToolCall("read-current-source", "file_read", {
          path: requiredPath,
          limit: 1_048_576,
        }, 300, 60));
      }
      if (instruction.includes("Post-mutation objective correction input retry phase")) {
        return jsonResponse(modelToolCall("correct-reachable-false", "apply_patch", {
          input: reachableCorrection,
        }, 300, 60));
      }
      if (instruction.includes("Post-mutation final objective review phase")) {
        return jsonResponse({
          choices: [{
            finish_reason: "stop",
            message: { content: '{"summary":"corrected and verified"}' },
          }],
          usage: { prompt_tokens: 300, completion_tokens: 30 },
        });
      }
      if (instruction.includes("Post-mutation objective review phase")) {
        return jsonResponse(modelToolCall("correct-shadowed-false", "apply_patch", {
          input: shadowedCorrection,
        }, 300, 60));
      }
      return jsonResponse(modelToolCall("patch-shadowed-false", "apply_patch", {
        input: initialPatch,
      }, 300, 60));
    });
    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => {
      if (request.name === "apply_patch") {
        executedPatches.push(String(request.arguments?.input ?? ""));
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
      }
      return {
        id: request.id,
        name: request.name,
        success: true,
        output: JSON.stringify({
          path: request.arguments?.path,
          truncated: false,
          content: executedPatches.includes(reachableCorrection)
            ? postCorrectionSource
            : postInitialSource,
        }),
        durationMs: 1,
      };
    });
    const agent = createAgent(execute);

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-shadowed-false-witness",
      text: "Restore false aria-* attribute serialization with the smallest change while preserving the public behavior of other attributes.",
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths: [requiredPath],
          toolLoopIterationBudget: 6,
        },
      },
      structuredOutput: {
        schema: { type: "object", required: ["summary"] },
        validateOutput: (text: string) => text === '{"summary":"corrected and verified"}'
          ? { ok: true as const, outputText: text }
          : { ok: false as const, message: "summary is required" },
      },
    } as any));

    expect(requests).toHaveLength(6);
    expect(requests[3]?.messages[0]?.content).toContain(
      "Post-mutation objective correction input retry phase",
    );
    expect(executedPatches).toEqual([initialPatch, reachableCorrection]);
    expect(executedPatches).not.toContain(shadowedCorrection);
    expect(items).toContainEqual({
      type: "final",
      text: '{"summary":"corrected and verified"}',
    });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("rebuilds a repeated correction after a predicate admits the ordinary false witness", async () => {
    const requiredPath = "src/diff/props.js";
    const originalCondition = "\t\t} else if (value != NULL && value !== false) {";
    const broadenedCondition = "\t\t} else if (value != NULL && (name.charCodeAt(0) < 97 || name.charCodeAt(0) > 122 || name.charCodeAt(3) != 45 || value !== false)) {";
    const correctedCondition = "\t\t} else if (value != NULL && (value !== false || name[4] == '-')) {";
    const sourcePrefix = [
      "\t\t// aria- and data- attributes have no boolean representation.",
      "\t\t// A `false` value is different from the attribute not being present.",
    ].join("\n");
    const initialPatch = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      `-${originalCondition}`,
      `+${broadenedCondition}`,
      "*** End Patch",
    ].join("\n");
    const repeatedCorrection = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      "+\t\t// aria- and data- attributes have no boolean representation.",
      "+\t\t// A `false` value is different from the attribute not being present.",
      `-${broadenedCondition}`,
      `+${broadenedCondition}`,
      "*** End Patch",
    ].join("\n");
    const semanticCorrection = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      `-${broadenedCondition}`,
      `+${correctedCondition}`,
      "*** End Patch",
    ].join("\n");
    const localRejection = "only repeated current-source lines and produced no semantic delta";
    const task = "Fix the frozen browser-facing regression in the real web project. Preserve false values for aria-* and data-* attributes by serializing them, remove ordinary attributes with false values, and remove every attribute with null or undefined values. Make the smallest change in src/diff/props.js and pass the supplied deterministic checks.";
    const requests: Array<Record<string, any>> = [];
    const executedPatches: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      const instruction = String(body.messages?.[0]?.content ?? "");
      if (instruction.includes("Post-mutation verification phase")) {
        return jsonResponse(modelToolCall(`read-${requests.length}`, "file_read", {
          path: requiredPath,
          limit: 1_048_576,
        }, 300, 60));
      }
      if (instruction.includes("Post-mutation objective correction input retry phase")) {
        return jsonResponse(modelToolCall("correct-ordinary-false", "apply_patch", {
          input: instruction.includes(localRejection)
            ? semanticCorrection
            : repeatedCorrection,
        }, 300, 60));
      }
      if (instruction.includes("Post-mutation final objective review phase")) {
        return jsonResponse({
          choices: [{
            finish_reason: "stop",
            message: { content: '{"summary":"corrected and verified"}' },
          }],
          usage: { prompt_tokens: 300, completion_tokens: 30 },
        });
      }
      if (instruction.includes("Post-mutation objective review phase")) {
        return jsonResponse(modelToolCall("repeat-current-source", "apply_patch", {
          input: repeatedCorrection,
        }, 300, 60));
      }
      return jsonResponse(modelToolCall("patch-broadened-false", "apply_patch", {
        input: initialPatch,
      }, 300, 60));
    });
    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => {
      if (request.name === "apply_patch") {
        executedPatches.push(String(request.arguments?.input ?? ""));
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
      }
      const condition = executedPatches.includes(semanticCorrection)
        ? correctedCondition
        : broadenedCondition;
      return {
        id: request.id,
        name: request.name,
        success: true,
        output: JSON.stringify({
          path: request.arguments?.path,
          truncated: false,
          content: `${sourcePrefix}\n${condition}\n\t\t\tdom.setAttribute(name, value);`,
        }),
        durationMs: 1,
      };
    });
    const agent = createAgent(execute);

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-ordinary-false-witness",
      text: task,
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths: [requiredPath],
          toolLoopIterationBudget: 6,
        },
      },
      structuredOutput: {
        schema: { type: "object", required: ["summary"] },
        validateOutput: (text: string) => text === '{"summary":"corrected and verified"}'
          ? { ok: true as const, outputText: text }
          : { ok: false as const, message: "summary is required" },
      },
    } as any));

    expect(requests).toHaveLength(6);
    expect(requests[3]?.messages[0]?.content).toContain(localRejection);
    expect(requests[3]?.messages[1]?.content).toContain(
      "remove ordinary attributes with false values",
    );
    expect(executedPatches).toEqual([initialPatch, semanticCorrection]);
    expect(executedPatches).not.toContain(repeatedCorrection);
    expect(items).toContainEqual({
      type: "final",
      text: '{"summary":"corrected and verified"}',
    });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("repairs an extra closing delimiter when objective review accepts the initial broken source", async () => {
    const requiredPath = "src/diff/props.js";
    const originalCondition = "\t\t} else if (value != NULL && value !== false) {";
    const serializedFalseCondition = "\t\t} else if (value === false && (name[0] === 'a' && name[1] === 'r' && name[2] === 'i' && name[3] === 'a' || name[0] === 'd' && name[1] === 'a' && name[2] === 't' && name[3] === 'a')) {";
    const setAttributeLine = "\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);";
    const removeAttributeLine = "\t\t\tdom.removeAttribute(name);";
    const originalSource = [
      "export function setProperty(dom, name, value) {",
      "\tif (name == 'style') {",
      "\t\tdom.style.cssText = value;",
      "\t} else {",
      "\t\t// aria- and data- attributes have no boolean representation.",
      "\t\t// A `false` value is different from the attribute not being present.",
      "\t\tif (typeof value == 'function') {",
      "\t\t\t// never serialize functions as attribute values",
      originalCondition,
      setAttributeLine,
      "\t\t} else {",
      removeAttributeLine,
      "\t\t}",
      "\t}",
      "}",
    ].join("\n");
    const postInitialSource = originalSource.replace(
      [
        originalCondition,
        setAttributeLine,
        "\t\t} else {",
        removeAttributeLine,
        "\t\t}",
      ].join("\n"),
      [
        originalCondition,
        setAttributeLine,
        serializedFalseCondition,
        "\t\t\tdom.setAttribute(name, 'false');",
        "\t\t} else {",
        removeAttributeLine,
        "\t\t}",
        "\t\t}",
      ].join("\n"),
    );
    const postCorrectionSource = postInitialSource.replace(
      "\t\t}\n\t\t}\n\t}\n}",
      "\t\t}\n\t}\n}",
    );
    const initialPatch = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      ` ${originalCondition}`,
      ` ${setAttributeLine}`,
      `+${serializedFalseCondition}`,
      "+\t\t\tdom.setAttribute(name, 'false');",
      " \t\t} else {",
      ` ${removeAttributeLine}`,
      " \t\t}",
      "+\t\t}",
      "*** End Patch",
    ].join("\n");
    const deletionCorrection = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      " \t\t} else {",
      ` ${removeAttributeLine}`,
      " \t\t}",
      "-\t\t}",
      " \t}",
      " }",
      "*** End Patch",
    ].join("\n");
    const structuralGuidance = "complete current source proves that a prior replacement left an extra standalone closing delimiter";
    const successfulSummary = "{\"summary\":\"Corrected src/diff/props.js to preserve and serialize false values for aria-* and data-* attributes as the string 'false', while removing ordinary attributes with false values and removing every attribute with null or undefined values.\"}";
    const task = "Fix the frozen browser-facing regression in the real web project. Preserve false values for aria-* and data-* attributes by serializing them, remove ordinary attributes with false values, and remove every attribute with null or undefined values. Make the smallest change in src/diff/props.js and pass the supplied deterministic checks.";
    const requests: Array<Record<string, any>> = [];
    const executedPatches: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      const instruction = String(body.messages?.[0]?.content ?? "");
      if (instruction.includes("Post-mutation verification phase")) {
        return jsonResponse(modelToolCall(`read-${requests.length}`, "file_read", {
          path: requiredPath,
          limit: 1_048_576,
        }, 300, 60));
      }
      if (instruction.includes("Post-mutation objective correction input retry phase")) {
        return jsonResponse(modelToolCall("remove-extra-closing-delimiter", "apply_patch", {
          input: deletionCorrection,
        }, 300, 60));
      }
      if (instruction.includes("Post-mutation final objective review phase")
        || instruction.includes("Post-mutation objective review phase")) {
        return jsonResponse({
          choices: [{
            finish_reason: "stop",
            message: { content: successfulSummary },
          }],
          usage: { prompt_tokens: 300, completion_tokens: 30 },
        });
      }
      return jsonResponse(modelToolCall("patch-formal-source", "apply_patch", {
        input: initialPatch,
      }, 300, 60));
    });
    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => {
      if (request.name === "file_read") {
        const source = executedPatches.includes(deletionCorrection)
          ? postCorrectionSource
          : postInitialSource;
        return {
          id: request.id,
          name: request.name,
          success: true,
          output: JSON.stringify({
            path: requiredPath,
            size: source.length,
            truncated: false,
            content: source,
          }),
          durationMs: 1,
        };
      }
      executedPatches.push(String(request.arguments?.input ?? ""));
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
      conversationId: "conv-required-mutation-initial-extra-closing-delimiter",
      text: task,
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths: [requiredPath],
          toolLoopIterationBudget: 6,
        },
      },
      structuredOutput: {
        schema: { type: "object", required: ["summary"] },
        validateOutput: (text: string) => text === successfulSummary
          ? { ok: true as const, outputText: text }
          : { ok: false as const, message: "summary is required" },
      },
    } as any));

    expect(postInitialSource).toContain("\t\t}\n\t\t}\n\t}\n}");
    expect(requests).toHaveLength(6);
    expect(requests[3]?.messages[0]?.content).toContain(structuralGuidance);
    expect(requests[3]?.messages[1]?.content).toContain("\\t\\t}\\n\\t\\t}");
    expect(executedPatches).toEqual([initialPatch, deletionCorrection]);
    expect(items).toContainEqual({ type: "final", text: successfulSummary });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("repairs an extra closing branch delimiter after a repeated correction", async () => {
    const requiredPath = "src/diff/props.js";
    const removeAttributeLine = "\t\t\tdom.removeAttribute(name);";
    const setAttributeLine = "\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);";
    const originalMutationSlice = [
      "\t\tif (typeof value == 'function') {",
      "\t\t\t// never serialize functions as attribute values",
      "\t\t} else if (value != NULL && value !== false) {",
      setAttributeLine,
      "\t\t} else {",
      removeAttributeLine,
    ].join("\r\n");
    const replacementBlock = [
      "\t\tif (value == NULL || typeof value == 'undefined') {",
      removeAttributeLine,
      "\t\t} else if (value === false) {",
      "\t\t\tif (name.startsWith('aria-') || name.startsWith('data-')) {",
      "\t\t\t\tdom.setAttribute(name, 'false');",
      "\t\t\t} else {",
      removeAttributeLine,
      "\t\t\t}",
      "\t\t} else if (typeof value == 'function') {",
      "\t\t\t// never serialize functions as attribute values",
      "\t\t} else {",
      setAttributeLine,
      "\t\t}",
    ].join("\r\n");
    const originalSource = [
      "export function setProperty(dom, name, value) {",
      "\to: if (name == 'style') {",
      "\t\tdom.style.cssText = value;",
      "\t} else {",
      "\t\t// aria- and data- attributes have no boolean representation.",
      "\t\t// A `false` value is different from the attribute not being present.",
      originalMutationSlice,
      "\t\t}",
      "\t}",
      "}",
    ].join("\r\n");
    const postInitialSource = originalSource.replace(originalMutationSlice, replacementBlock);
    const postCorrectionSource = postInitialSource.replace(
      `${replacementBlock}\r\n\t\t}\r\n\t}\r\n}`,
      `${replacementBlock}\r\n\t}\r\n}`,
    );
    const initialPatch = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      "-\t\tif (typeof value == 'function') {",
      "-\t\t\t// never serialize functions as attribute values",
      "-\t\t} else if (value != NULL && value !== false) {",
      `-${setAttributeLine}`,
      "-\t\t} else {",
      `-${removeAttributeLine}`,
      "+\t\tif (value == NULL || typeof value == 'undefined') {",
      `+${removeAttributeLine}`,
      "+\t\t} else if (value === false) {",
      "+\t\t\tif (name.startsWith('aria-') || name.startsWith('data-')) {",
      "+\t\t\t\tdom.setAttribute(name, 'false');",
      "+\t\t\t} else {",
      `+${removeAttributeLine}`,
      "+\t\t\t}",
      "+\t\t} else if (typeof value == 'function') {",
      "+\t\t\t// never serialize functions as attribute values",
      "+\t\t} else {",
      `+${setAttributeLine}`,
      "+\t\t}",
      "*** End Patch",
    ].join("\n");
    const repeatedCorrection = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      "-\t\t}",
      "+\t\t}",
      "*** End Patch",
    ].join("\n");
    const deletionCorrection = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      " \t\t} else {",
      ` ${setAttributeLine}`,
      " \t\t}",
      "-\t\t}",
      " \t}",
      " }",
      "*** End Patch",
    ].join("\n");
    const structuralGuidance = "When the complete current source proves that a prior replacement left an extra standalone closing delimiter";
    const successfulSummary = '{"summary":"removed the extra closing delimiter and verified the attribute behavior"}';
    const task = "Fix the frozen browser-facing regression in the real web project. Preserve false values for aria-* and data-* attributes by serializing them, remove ordinary attributes with false values, and remove every attribute with null or undefined values. Make the smallest change in src/diff/props.js and pass the supplied deterministic checks.";
    const requests: Array<Record<string, any>> = [];
    const executedPatches: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      const instruction = String(body.messages?.[0]?.content ?? "");
      if (instruction.includes("Post-mutation verification phase")) {
        return jsonResponse(modelToolCall(`read-${requests.length}`, "file_read", {
          path: requiredPath,
          limit: 1_048_576,
        }, 300, 60));
      }
      if (instruction.includes("Post-mutation objective correction input retry phase")) {
        return jsonResponse(modelToolCall("remove-extra-closing-delimiter", "apply_patch", {
          input: instruction.includes(structuralGuidance)
            ? deletionCorrection
            : repeatedCorrection,
        }, 300, 60));
      }
      if (instruction.includes("Post-mutation final objective review phase")) {
        return jsonResponse({
          choices: [{
            finish_reason: "stop",
            message: { content: successfulSummary },
          }],
          usage: { prompt_tokens: 300, completion_tokens: 30 },
        });
      }
      if (instruction.includes("Post-mutation objective review phase")) {
        return jsonResponse(modelToolCall("repeat-current-closing-delimiter", "apply_patch", {
          input: repeatedCorrection,
        }, 300, 60));
      }
      return jsonResponse(modelToolCall("patch-incomplete-branch-replacement", "apply_patch", {
        input: initialPatch,
      }, 300, 60));
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
            size: (executedPatches.includes(deletionCorrection)
              ? postCorrectionSource
              : postInitialSource).length,
            truncated: false,
            content: executedPatches.includes(deletionCorrection)
              ? postCorrectionSource
              : postInitialSource,
          }),
          durationMs: 1,
        };
      }
      const patchInput = String(request.arguments?.input ?? "");
      executedPatches.push(patchInput);
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
      conversationId: "conv-required-mutation-extra-closing-delimiter",
      text: task,
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths: [requiredPath],
          toolLoopIterationBudget: 6,
        },
      },
      structuredOutput: {
        schema: { type: "object", required: ["summary"] },
        validateOutput: (text: string) => text === successfulSummary
          ? { ok: true as const, outputText: text }
          : { ok: false as const, message: "summary is required" },
      },
    } as any));

    expect(postInitialSource).toContain("\t\t}\r\n\t\t}\r\n\t}\r\n}");
    expect(requests).toHaveLength(6);
    expect(requests[3]?.messages[0]?.content).toContain(structuralGuidance);
    expect(requests[3]?.messages[1]?.content).toContain("\\t\\t}\\r\\n\\t\\t}");
    expect(executedPatches).toEqual([initialPatch, deletionCorrection]);
    expect(items).toContainEqual({ type: "final", text: successfulSummary });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("rejects an LF tail rewrite when an extra delimiter requires deletion-only correction", async () => {
    const requiredPath = "src/diff/props.js";
    const removeAttributeLine = "\t\t\tdom.removeAttribute(name);";
    const setAttributeLine = "\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);";
    const brokenMutationSlice = [
      "\t\tif (typeof value == 'function') {",
      "\t\t\t// never serialize functions as attribute values",
      "\t\t} else if (value != NULL && value !== false) {",
      setAttributeLine,
      "\t\t} else {",
      removeAttributeLine,
    ].join("\n");
    const initialReplacement = [
      "\t\tconst isAriaOrData = name.indexOf('aria-') === 0 || name.indexOf('data-') === 0;",
      "\t\tif (value == NULL) {",
      removeAttributeLine,
      "\t\t} else if (value === false) {",
      "\t\t\tif (isAriaOrData) {",
      "\t\t\t\tdom.setAttribute(name, 'false');",
      "\t\t\t} else {",
      removeAttributeLine,
      "\t\t\t}",
      "\t\t} else if (typeof value == 'function') {",
      "\t\t\t// never serialize functions as attribute values",
      "\t\t} else {",
      setAttributeLine,
      "\t\t}",
    ].join("\n");
    const originalSource = [
      "export function setProperty(dom, name, value) {",
      "\to: if (name == 'style') {",
      "\t\tdom.style.cssText = value;",
      "\t} else {",
      "\t\t// aria- and data- attributes have no boolean representation.",
      "\t\t// A `false` value is different from the attribute not being present.",
      brokenMutationSlice,
      "\t\t}",
      "\t}",
      "}",
    ].join("\n");
    const postInitialSource = originalSource.replace(brokenMutationSlice, initialReplacement);
    const broadRemovedPrefix = [
      "\t\tif (value == NULL) {",
      removeAttributeLine,
      "\t\t} else if (value === false) {",
      "\t\t\tif (isAriaOrData) {",
      "\t\t\t\tdom.setAttribute(name, 'false');",
    ].join("\n");
    const broadAddedPrefix = [
      broadRemovedPrefix,
      "\t\t\t} else {",
      removeAttributeLine,
      "\t\t\t}",
      "\t\t} else {",
      "\t\t\tdom.setAttribute(name, value);",
      "\t\t}",
    ].join("\n");
    const postBroadSource = postInitialSource.replace(broadRemovedPrefix, broadAddedPrefix);
    const postDeletionSource = postInitialSource.replace(
      `${initialReplacement}\n\t\t}\n\t}\n}`,
      `${initialReplacement}\n\t}\n}`,
    );
    const initialPatch = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      "-\t\tif (typeof value == 'function') {",
      "-\t\t\t// never serialize functions as attribute values",
      "-\t\t} else if (value != NULL && value !== false) {",
      `-${setAttributeLine}`,
      "-\t\t} else {",
      `-${removeAttributeLine}`,
      "+\t\tconst isAriaOrData = name.indexOf('aria-') === 0 || name.indexOf('data-') === 0;",
      "+\t\tif (value == NULL) {",
      `+${removeAttributeLine}`,
      "+\t\t} else if (value === false) {",
      "+\t\t\tif (isAriaOrData) {",
      "+\t\t\t\tdom.setAttribute(name, 'false');",
      "+\t\t\t} else {",
      `+${removeAttributeLine}`,
      "+\t\t\t}",
      "+\t\t} else if (typeof value == 'function') {",
      "+\t\t\t// never serialize functions as attribute values",
      "+\t\t} else {",
      `+${setAttributeLine}`,
      "+\t\t}",
      "*** End Patch",
    ].join("\n");
    const broadCorrection = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      "-\t\tif (value == NULL) {",
      `-${removeAttributeLine}`,
      "-\t\t} else if (value === false) {",
      "-\t\t\tif (isAriaOrData) {",
      "-\t\t\t\tdom.setAttribute(name, 'false');",
      "+\t\tif (value == NULL) {",
      `+${removeAttributeLine}`,
      "+\t\t} else if (value === false) {",
      "+\t\t\tif (isAriaOrData) {",
      "+\t\t\t\tdom.setAttribute(name, 'false');",
      "+\t\t\t} else {",
      `+${removeAttributeLine}`,
      "+\t\t\t}",
      "+\t\t} else {",
      "+\t\t\tdom.setAttribute(name, value);",
      "+\t\t}",
      "*** End Patch",
    ].join("\n");
    const deletionCorrection = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      " \t\t} else {",
      ` ${setAttributeLine}`,
      " \t\t}",
      "-\t\t}",
      " \t}",
      " }",
      "*** End Patch",
    ].join("\n");
    const deletionOnlyGuidance = "Remove only the extra delimiter with a deletion-only hunk";
    const successfulSummary = '{"summary":"removed the extra closing delimiter and verified the attribute behavior"}';
    const task = "Fix the frozen browser-facing regression in the real web project. Preserve false values for aria-* and data-* attributes by serializing them, remove ordinary attributes with false values, and remove every attribute with null or undefined values. Make the smallest change in src/diff/props.js and pass the supplied deterministic checks.";
    const requests: Array<Record<string, any>> = [];
    const executedPatches: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      const instruction = String(body.messages?.[0]?.content ?? "");
      if (instruction.includes("Post-mutation verification phase")) {
        return jsonResponse(modelToolCall(`read-${requests.length}`, "file_read", {
          path: requiredPath,
          limit: 1_048_576,
        }, 300, 60));
      }
      if (instruction.includes("Post-mutation objective correction input retry phase")) {
        return jsonResponse(modelToolCall("delete-extra-closing-delimiter", "apply_patch", {
          input: instruction.includes(deletionOnlyGuidance)
            ? deletionCorrection
            : broadCorrection,
        }, 300, 60));
      }
      if (instruction.includes("Post-mutation final objective review phase")) {
        return jsonResponse({
          choices: [{
            finish_reason: "stop",
            message: { content: successfulSummary },
          }],
          usage: { prompt_tokens: 300, completion_tokens: 30 },
        });
      }
      if (instruction.includes("Post-mutation objective review phase")) {
        return jsonResponse(modelToolCall("rewrite-current-tail", "apply_patch", {
          input: broadCorrection,
        }, 300, 60));
      }
      return jsonResponse(modelToolCall("patch-incomplete-lf-replacement", "apply_patch", {
        input: initialPatch,
      }, 300, 60));
    });
    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => {
      if (request.name === "file_read") {
        const content = executedPatches.includes(deletionCorrection)
          ? postDeletionSource
          : executedPatches.includes(broadCorrection)
            ? postBroadSource
            : postInitialSource;
        return {
          id: request.id,
          name: request.name,
          success: true,
          output: JSON.stringify({
            path: requiredPath,
            size: content.length,
            truncated: false,
            content,
          }),
          durationMs: 1,
        };
      }
      executedPatches.push(String(request.arguments?.input ?? ""));
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
      conversationId: "conv-required-mutation-lf-deletion-only-tail",
      text: task,
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths: [requiredPath],
          toolLoopIterationBudget: 6,
        },
      },
      structuredOutput: {
        schema: { type: "object", required: ["summary"] },
        validateOutput: (text: string) => text === successfulSummary
          ? { ok: true as const, outputText: text }
          : { ok: false as const, message: "summary is required" },
      },
    } as any));

    expect(postInitialSource).toContain("\t\t}\n\t\t}\n\t}\n}");
    expect(postBroadSource).toContain("\t\t}\n\t\t\t} else {");
    expect(items).toContainEqual({ type: "final", text: successfulSummary });
    expect(executedPatches).toEqual([initialPatch, deletionCorrection]);
    expect(requests).toHaveLength(6);
    expect(requests[3]?.messages[0]?.content).toContain(deletionOnlyGuidance);
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("fails closed when complete LF post-correction source still has a reattached branch tail", async () => {
    const requiredPath = "src/diff/props.js";
    const removeAttributeLine = "\t\t\tdom.removeAttribute(name);";
    const setAttributeLine = "\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);";
    const brokenMutationSlice = [
      "\t\tif (typeof value == 'function') {",
      "\t\t\t// never serialize functions as attribute values",
      "\t\t} else if (value != NULL && value !== false) {",
      setAttributeLine,
      "\t\t} else {",
      removeAttributeLine,
    ].join("\n");
    const initialReplacement = [
      "\t\tconst isAriaOrData = name.indexOf('aria-') === 0 || name.indexOf('data-') === 0;",
      "\t\tif (value == NULL) {",
      removeAttributeLine,
      "\t\t} else if (value === false) {",
      "\t\t\tif (isAriaOrData) {",
      "\t\t\t\tdom.setAttribute(name, 'false');",
      "\t\t\t} else {",
      removeAttributeLine,
      "\t\t\t}",
      "\t\t} else if (typeof value == 'function') {",
      "\t\t\t// never serialize functions as attribute values",
      "\t\t} else {",
      setAttributeLine,
      "\t\t}",
    ].join("\n");
    const originalSource = [
      "export function setProperty(dom, name, value) {",
      "\to: if (name == 'style') {",
      "\t\tdom.style.cssText = value;",
      "\t} else {",
      "\t\t// aria- and data- attributes have no boolean representation.",
      "\t\t// A `false` value is different from the attribute not being present.",
      brokenMutationSlice,
      "\t\t}",
      "\t}",
      "}",
    ].join("\n");
    const postInitialSource = originalSource.replace(brokenMutationSlice, initialReplacement);
    const broadRemovedPrefix = [
      "\t\tif (value == NULL) {",
      removeAttributeLine,
      "\t\t} else if (value === false) {",
      "\t\t\tif (isAriaOrData) {",
      "\t\t\t\tdom.setAttribute(name, 'false');",
    ].join("\n");
    const invalidFinalSource = postInitialSource.replace(
      broadRemovedPrefix,
      [
        broadRemovedPrefix,
        "\t\t\t} else {",
        removeAttributeLine,
        "\t\t\t}",
        "\t\t} else {",
        "\t\t\tdom.setAttribute(name, value);",
        "\t\t}",
      ].join("\n"),
    );
    const initialPatch = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      "-\t\tif (typeof value == 'function') {",
      "-\t\t\t// never serialize functions as attribute values",
      "-\t\t} else if (value != NULL && value !== false) {",
      `-${setAttributeLine}`,
      "-\t\t} else {",
      `-${removeAttributeLine}`,
      ...initialReplacement.split("\n").map((line) => `+${line}`),
      "*** End Patch",
    ].join("\n");
    const deletionCorrection = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      " \t\t} else {",
      ` ${setAttributeLine}`,
      " \t\t}",
      "-\t\t}",
      " \t}",
      " }",
      "*** End Patch",
    ].join("\n");
    const successfulSummary = '{"summary":"removed the extra closing delimiter and verified the attribute behavior"}';
    const task = "Fix the frozen browser-facing regression in the real web project. Preserve false values for aria-* and data-* attributes by serializing them, remove ordinary attributes with false values, and remove every attribute with null or undefined values. Make the smallest change in src/diff/props.js and pass the supplied deterministic checks.";
    const requests: Array<Record<string, any>> = [];
    const executedPatches: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      const instruction = String(body.messages?.[0]?.content ?? "");
      if (instruction.includes("Post-mutation verification phase")) {
        return jsonResponse(modelToolCall(`read-${requests.length}`, "file_read", {
          path: requiredPath,
          limit: 1_048_576,
        }, 300, 60));
      }
      if (instruction.includes("Post-mutation final objective review phase")) {
        return jsonResponse({
          choices: [{
            finish_reason: "stop",
            message: { content: successfulSummary },
          }],
          usage: { prompt_tokens: 300, completion_tokens: 30 },
        });
      }
      if (instruction.includes("Post-mutation objective review phase")) {
        return jsonResponse(modelToolCall("delete-extra-closing-delimiter", "apply_patch", {
          input: deletionCorrection,
        }, 300, 60));
      }
      return jsonResponse(modelToolCall("patch-incomplete-lf-replacement", "apply_patch", {
        input: initialPatch,
      }, 300, 60));
    });
    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => {
      if (request.name === "apply_patch") {
        executedPatches.push(String(request.arguments?.input ?? ""));
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
      }
      const content = executedPatches.includes(deletionCorrection)
        ? invalidFinalSource
        : postInitialSource;
      return {
        id: request.id,
        name: request.name,
        success: true,
        output: JSON.stringify({
          path: requiredPath,
          size: content.length,
          truncated: false,
          content,
        }),
        durationMs: 1,
      };
    });
    const agent = createAgent(execute);

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-lf-invalid-final-tail",
      text: task,
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths: [requiredPath],
          toolLoopIterationBudget: 6,
        },
      },
      structuredOutput: {
        schema: { type: "object", required: ["summary"] },
        validateOutput: (text: string) => text === successfulSummary
          ? { ok: true as const, outputText: text }
          : { ok: false as const, message: "summary is required" },
      },
    } as any));

    expect(invalidFinalSource).toContain("\t\t}\n\t\t\t} else {");
    expect(executedPatches).toEqual([initialPatch, deletionCorrection]);
    expect(requests).toHaveLength(5);
    expect(items).not.toContainEqual({ type: "final", text: successfulSummary });
    expect(items.at(-2)).toEqual({
      type: "final",
      text: expect.stringContaining("post-write objective review accepted"),
    });
    expect(items.at(-1)).toEqual({ type: "status", status: "error" });
  });

  it("rebuilds an atomic patch from the complete current branch context", async () => {
    const requiredPath = "src/diff/props.js";
    const originalCondition = "\t\t} else if (value != NULL && value !== false) {";
    const correctedCondition = "\t\t} else if (value != NULL && (value !== false || name[4] == '-')) {";
    const removalLine = "\t\t\tdom.removeAttribute(name);";
    const sourceBranch = [
      "\t\t// aria- and data- attributes have no boolean representation.",
      "\t\t// A `false` value is different from the attribute not being",
      "\t\t// present, so we can't remove it. For non-boolean aria",
      "\t\t// attributes we could treat false as a removal, but the",
      "\t\t// amount of exceptions would cost too many bytes. On top of",
      "\t\t// that other frameworks generally stringify `false`.",
      "",
      "\t\tif (typeof value == 'function') {",
      "\t\t\t// never serialize functions as attribute values",
      originalCondition,
      "\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
      "\t\t} else {",
      removalLine,
      "\t\t}",
    ].join("\r\n");
    const originalSource = [
      "// shared event objects retain their own clocks",
      ...Array.from({ length: 220 }, (_, index) => `const prefix${index} = ${index};`),
      sourceBranch,
      ...Array.from({ length: 40 }, (_, index) => `const suffix${index} = ${index};`),
    ].join("\r\n");
    const correctedSource = originalSource.replace(originalCondition, correctedCondition);
    const failedPatch = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      `-${originalCondition}`,
      `+${correctedCondition}`,
      " \t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
      " \t\t} else {",
      " \t\t}",
      "*** End Patch",
    ].join("\n");
    const correctedPatch = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      `-${originalCondition}`,
      `+${correctedCondition}`,
      " \t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
      " \t\t} else {",
      ` ${removalLine}`,
      " \t\t}",
      "*** End Patch",
    ].join("\n");
    const task = "Fix the frozen browser-facing regression in the real web project. Preserve false values for aria-* and data-* attributes by serializing them, remove ordinary attributes with false values, and remove every attribute with null or undefined values. Make the smallest change in src/diff/props.js and pass the supplied deterministic checks. Use the frozen behavior truth set real-web-ui-regression-v1. The deterministic checks are in test/shared/benchmark-v3-ui-regression.test.js.";
    const requests: Array<Record<string, any>> = [];
    const attemptedPatches: string[] = [];
    let correctionEvidenceContexts: string[] = [];
    let correctionApplied = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      const instruction = String(body.messages?.[0]?.content ?? "");
      if (requests.length === 1) {
        return jsonResponse(modelToolCall("read-current-source", "file_read", {
          path: requiredPath,
        }, 300, 60));
      }
      if (instruction.includes("Mutation-only recovery phase")) {
        return jsonResponse(modelToolCall("patch-missing-current-line", "apply_patch", {
          input: failedPatch,
        }, 300, 60));
      }
      if (instruction.includes("Atomic input correction phase")) {
        const evidence = String(body.messages?.[1]?.content ?? "");
        const boundedEvidence = evidence
          .split("[tool=file_read]\n")
          .at(-1)
          ?.split("\n\n[tool=")[0] ?? "";
        const parsedEvidence = JSON.parse(boundedEvidence) as {
          taskRelevantContexts?: Array<{ context?: unknown }>;
        };
        correctionEvidenceContexts = (parsedEvidence.taskRelevantContexts ?? [])
          .map(({ context }) => typeof context === "string" ? context : "");
        return jsonResponse(modelToolCall("patch-current-context", "apply_patch", {
          input: correctionEvidenceContexts.some((context) => context.includes(removalLine))
            ? correctedPatch
            : failedPatch,
        }, 300, 60));
      }
      if (instruction.includes("Post-mutation verification phase")) {
        return jsonResponse(modelToolCall("read-corrected-source", "file_read", {
          path: requiredPath,
          limit: 1_048_576,
        }, 300, 60));
      }
      return jsonResponse({
        choices: [{
          finish_reason: "stop",
          message: { content: '{"summary":"corrected and verified"}' },
        }],
        usage: { prompt_tokens: 300, completion_tokens: 30 },
      });
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
            size: originalSource.length,
            bytesRead: originalSource.length,
            truncated: false,
            content: correctionApplied ? correctedSource : originalSource,
          }),
          durationMs: 1,
        };
      }
      const patchInput = String(request.arguments?.input ?? "");
      attemptedPatches.push(patchInput);
      if (patchInput !== correctedPatch) {
        return {
          id: request.id,
          name: request.name,
          success: false,
          output: "",
          error: "Failed to find expected lines",
          failureKind: "input_error" as const,
          metadata: { repairAction: "apply_patch_input_invalid" },
          durationMs: 1,
        };
      }
      correctionApplied = true;
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
      conversationId: "conv-required-mutation-complete-current-branch-context",
      text: task,
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths: [requiredPath],
          toolLoopIterationBudget: 3,
        },
      },
      structuredOutput: {
        schema: { type: "object", required: ["summary"] },
        validateOutput: (text: string) => text === '{"summary":"corrected and verified"}'
          ? { ok: true as const, outputText: text }
          : { ok: false as const, message: "summary is required" },
      },
    } as any));

    expect(requests[2]?.messages[0]?.content).toContain("Atomic input correction phase");
    expect(correctionEvidenceContexts).toContainEqual(expect.stringContaining(removalLine));
    expect(requests).toHaveLength(5);
    expect(attemptedPatches).toEqual([failedPatch, correctedPatch]);
    expect(items).toContainEqual({
      type: "final",
      text: '{"summary":"corrected and verified"}',
    });
    expect(items.at(-1)).toEqual({ type: "status", status: "done" });
  });

  it("fails closed when a repeated-source retry leaves invalid unreachable false control flow", async () => {
    const requiredPath = "src/diff/props.js";
    const originalCondition = "\t\t} else if (value != NULL && value !== false) {";
    const sourcePrefix = [
      "\t\t// aria- and data- attributes have no boolean representation.",
      "\t\t// A `false` value is different from the attribute not being present.",
    ].join("\n");
    const initialPatch = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      " \t\tif (typeof value == 'function') {",
      " \t\t\t// never serialize functions as attribute values",
      `-${originalCondition}`,
      "-\t\t\tdom.setAttribute(name, name == 'popover' && value == true ? '' : value);",
      `+${originalCondition}`,
      "+\t\t\tlet val = name == 'popover' && value == true ? '' : value;",
      "+\t\t\tif (name[0] == 'a' && name[1] == 'r' && name[2] == 'i' && name[3] == 'a' && name[4] == '-') {",
      "+\t\t\t\tdom.setAttribute(name, val === false ? 'false' : val);",
      "+\t\t\t} else if (name[0] == 'd' && name[1] == 'a' && name[2] == 't' && name[3] == 'a' && name[4] == '-') {",
      "+\t\t\t\tdom.setAttribute(name, val === false ? 'false' : val);",
      "+\t\t\t} else {",
      "+\t\t\t\tdom.setAttribute(name, val);",
      "+\t\t\t}",
      "+\t\t} else if (value === false) {",
      "+\t\t\tdom.removeAttribute(name);",
      " \t\t} else {",
      "*** End Patch",
    ].join("\n");
    const repeatedCorrection = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      `-${originalCondition}`,
      `+${originalCondition}`,
      "*** End Patch",
    ].join("\n");
    const invalidCorrection = [
      "*** Begin Patch",
      `*** Update File: ${requiredPath}`,
      "@@",
      "-\t\tif (typeof value == 'function') {",
      "-\t\t\t// never serialize functions as attribute values",
      `-${originalCondition}`,
      "+\t\tif (typeof value == 'function') {",
      "+\t\t\t// never serialize functions as attribute values",
      "+\t\t} else if (value == NULL || value === false) {",
      "+\t\t\t// attribute values false, null, and undefined are removed;",
      "+\t\t\t// false values for aria-* and data-* are serialized below",
      "+\t\t} else {",
      " \t\t\tlet val = name == 'popover' && value == true ? '' : value;",
      " \t\t\tif (name[0] == 'a' && name[1] == 'r' && name[2] == 'i' && name[3] == 'a' && name[4] == '-') {",
      "*** End Patch",
    ].join("\n");
    const postInitialSource = [
      sourcePrefix,
      "\t\tif (typeof value == 'function') {",
      "\t\t\t// never serialize functions as attribute values",
      originalCondition,
      "\t\t\tlet val = name == 'popover' && value == true ? '' : value;",
      "\t\t\tif (name[0] == 'a' && name[1] == 'r' && name[2] == 'i' && name[3] == 'a' && name[4] == '-') {",
      "\t\t\t\tdom.setAttribute(name, val === false ? 'false' : val);",
      "\t\t\t} else if (name[0] == 'd' && name[1] == 'a' && name[2] == 't' && name[3] == 'a' && name[4] == '-') {",
      "\t\t\t\tdom.setAttribute(name, val === false ? 'false' : val);",
      "\t\t\t} else {",
      "\t\t\t\tdom.setAttribute(name, val);",
      "\t\t\t}",
      "\t\t} else if (value === false) {",
      "\t\t\tdom.removeAttribute(name);",
      "\t\t} else {",
      "\t\t\tdom.removeAttribute(name);",
      "\t\t}",
    ].join("\n");
    const postCorrectionSource = postInitialSource.replace(
      [
        "\t\tif (typeof value == 'function') {",
        "\t\t\t// never serialize functions as attribute values",
        originalCondition,
      ].join("\n"),
      [
        "\t\tif (typeof value == 'function') {",
        "\t\t\t// never serialize functions as attribute values",
        "\t\t} else if (value == NULL || value === false) {",
        "\t\t\t// attribute values false, null, and undefined are removed;",
        "\t\t\t// false values for aria-* and data-* are serialized below",
        "\t\t} else {",
      ].join("\n"),
    );
    const successfulSummary = '{"summary":"Verified false aria/data serialization and ordinary false removal."}';
    const task = "Fix the frozen browser-facing regression in the real web project. Preserve false values for aria-* and data-* attributes by serializing them, remove ordinary attributes with false values, and remove every attribute with null or undefined values. Make the smallest change in src/diff/props.js and pass the supplied deterministic checks.";
    const requests: Array<Record<string, any>> = [];
    const executedPatches: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
      requests.push(body);
      const instruction = String(body.messages?.[0]?.content ?? "");
      if (instruction.includes("Post-mutation verification phase")) {
        return jsonResponse(modelToolCall(`read-${requests.length}`, "file_read", {
          path: requiredPath,
          limit: 1_048_576,
        }, 300, 60));
      }
      if (instruction.includes("Post-mutation objective correction input retry phase")) {
        return jsonResponse(modelToolCall("invalid-control-flow", "apply_patch", {
          input: invalidCorrection,
        }, 300, 60));
      }
      if (instruction.includes("Post-mutation final objective review phase")) {
        return jsonResponse({
          choices: [{
            finish_reason: "stop",
            message: { content: successfulSummary },
          }],
          usage: { prompt_tokens: 300, completion_tokens: 30 },
        });
      }
      if (instruction.includes("Post-mutation objective review phase")) {
        return jsonResponse(modelToolCall("repeat-current-source", "apply_patch", {
          input: repeatedCorrection,
        }, 300, 60));
      }
      return jsonResponse(modelToolCall("patch-unreachable-false", "apply_patch", {
        input: initialPatch,
      }, 300, 60));
    });
    const execute = vi.fn(async (request: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }) => {
      if (request.name === "apply_patch") {
        executedPatches.push(String(request.arguments?.input ?? ""));
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
      }
      return {
        id: request.id,
        name: request.name,
        success: true,
        output: JSON.stringify({
          path: request.arguments?.path,
          truncated: false,
          content: executedPatches.includes(invalidCorrection)
            ? postCorrectionSource
            : postInitialSource,
        }),
        durationMs: 1,
      };
    });
    const agent = createAgent(execute);

    const items = await collect(agent.run({
      conversationId: "conv-required-mutation-invalid-false-control-flow",
      text: task,
      automationProfile: "bare",
      meta: {
        _agentLaunchSpec: {
          workspaceMutationRequirement: "required",
          requiredChangedPaths: [requiredPath],
          toolLoopIterationBudget: 6,
        },
      },
      structuredOutput: {
        schema: { type: "object", required: ["summary"] },
        validateOutput: (text: string) => text === successfulSummary
          ? { ok: true as const, outputText: text }
          : { ok: false as const, message: "summary is required" },
      },
    } as any));

    expect(executedPatches).toEqual([initialPatch, invalidCorrection]);
    expect(requests).toHaveLength(6);
    expect(requests[3]?.messages[0]?.content).toContain(
      "Keep one coherent sibling if/else chain",
    );
    expect(items).not.toContainEqual({ type: "final", text: successfulSummary });
    expect(items.at(-2)).toEqual({
      type: "final",
      text: expect.stringContaining("post-write objective review accepted"),
    });
    expect(items.at(-1)).toEqual({ type: "status", status: "error" });
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
    toolLoopIterationBudget: 6,
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

function modelToolCall(
  id: string,
  name: string,
  args: Record<string, unknown>,
  promptTokens: number,
  completionTokens: number,
) {
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
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
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
