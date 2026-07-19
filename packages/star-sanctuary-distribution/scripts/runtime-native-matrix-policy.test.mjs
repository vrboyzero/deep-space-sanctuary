import { describe, expect, it } from "vitest";

import { createRuntimeNativeMatrix } from "./runtime-native-matrix-policy.mjs";

const target = {
  mode: "slim",
  platform: "win32",
  arch: "x64",
  nodeAbi: "127",
};

describe("runtime native matrix policy", () => {
  it("records slim fallback/absence and full native load requirements", () => {
    const slim = createRuntimeNativeMatrix(target);
    const full = createRuntimeNativeMatrix({ ...target, mode: "full" });

    expect(slim.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        packageName: "node-pty",
        expectedState: "fallback",
        loadExpectation: "forbidden",
        fallbackBackend: "child_process",
      }),
      expect.objectContaining({
        packageName: "onnxruntime-node",
        expectedState: "absent",
        loadExpectation: "forbidden",
      }),
    ]));
    expect(full.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        packageName: "node-pty",
        expectedState: "required",
        loadExpectation: "required",
        fallbackBackend: null,
      }),
      expect.objectContaining({
        packageName: "onnxruntime-node",
        expectedState: "required",
        loadExpectation: "required",
      }),
    ]));
  });
});
