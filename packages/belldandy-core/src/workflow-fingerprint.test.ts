import { describe, expect, it } from "vitest";

import {
  computeWorkflowFingerprint,
  computeStableHash,
  computeWorkflowToolPolicyHash,
  stableCanonicalize,
  type WorkflowFingerprintInput,
} from "./workflow-fingerprint.js";

function makeInput(overrides: Partial<WorkflowFingerprintInput> = {}): WorkflowFingerprintInput {
  return {
    schemaVersion: 1,
    workflowName: "code-audit",
    workflowVersion: "1.0.0",
    scriptHash: "abc123",
    callKey: "scan/0/auth",
    prompt: "扫描 auth 模块",
    model: "gpt-4o",
    agentProfileId: "default",
    systemPromptHash: "sys-hash",
    toolPolicyHash: "policy-hash",
    role: "researcher",
    allowedToolFamilies: ["read", "search"],
    maxToolRiskLevel: "low",
    delegationHash: "del-hash",
    workflowArgs: { targetDir: "src" },
    ...overrides,
  };
}

describe("stableCanonicalize", () => {
  it("排序对象 key", () => {
    expect(stableCanonicalize({ b: 1, a: 2 })).toBe(stableCanonicalize({ a: 2, b: 1 }));
  });

  it("保持数组顺序", () => {
    expect(stableCanonicalize([3, 1, 2])).toBe("[3,1,2]");
  });

  it("忽略 undefined 字段", () => {
    expect(stableCanonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("递归排序嵌套对象", () => {
    expect(stableCanonicalize({ outer: { z: 1, a: 2 } })).toBe('{"outer":{"a":2,"z":1}}');
  });

  it("NaN 被转为 null", () => {
    expect(stableCanonicalize({ x: Number.NaN })).toBe('{"x":null}');
  });
});

describe("computeWorkflowFingerprint", () => {
  it("相同输入产生相同指纹", () => {
    expect(computeWorkflowFingerprint(makeInput())).toBe(computeWorkflowFingerprint(makeInput()));
  });

  it("prompt 变化时指纹不同", () => {
    const a = computeWorkflowFingerprint(makeInput({ prompt: "扫描 auth" }));
    const b = computeWorkflowFingerprint(makeInput({ prompt: "扫描 api" }));
    expect(a).not.toBe(b);
  });

  it("callKey 变化时指纹不同", () => {
    const a = computeWorkflowFingerprint(makeInput({ callKey: "scan/0" }));
    const b = computeWorkflowFingerprint(makeInput({ callKey: "scan/1" }));
    expect(a).not.toBe(b);
  });

  it("scriptHash 变化时指纹不同", () => {
    const a = computeWorkflowFingerprint(makeInput({ scriptHash: "hash-a" }));
    const b = computeWorkflowFingerprint(makeInput({ scriptHash: "hash-b" }));
    expect(a).not.toBe(b);
  });

  it("workflowArgs 变化时指纹不同", () => {
    const a = computeWorkflowFingerprint(makeInput({ workflowArgs: { targetDir: "src" } }));
    const b = computeWorkflowFingerprint(makeInput({ workflowArgs: { targetDir: "lib" } }));
    expect(a).not.toBe(b);
  });

  it("workflowArgs key 顺序不同时指纹相同（稳定序列化）", () => {
    const a = computeWorkflowFingerprint(makeInput({ workflowArgs: { a: 1, b: 2 } }));
    const b = computeWorkflowFingerprint(makeInput({ workflowArgs: { b: 2, a: 1 } }));
    expect(a).toBe(b);
  });

  it("allowedToolFamilies 顺序不同时指纹相同", () => {
    const a = computeWorkflowFingerprint(makeInput({ allowedToolFamilies: ["read", "search"] }));
    const b = computeWorkflowFingerprint(makeInput({ allowedToolFamilies: ["search", "read"] }));
    expect(a).toBe(b);
  });

  it("model 变化时指纹不同", () => {
    const a = computeWorkflowFingerprint(makeInput({ model: "gpt-4o" }));
    const b = computeWorkflowFingerprint(makeInput({ model: "claude-sonnet" }));
    expect(a).not.toBe(b);
  });

  it("role 变化时指纹不同", () => {
    const a = computeWorkflowFingerprint(makeInput({ role: "researcher" }));
    const b = computeWorkflowFingerprint(makeInput({ role: "verifier" }));
    expect(a).not.toBe(b);
  });

  it("toolPolicyHash 变化时指纹不同", () => {
    const a = computeWorkflowFingerprint(makeInput({ toolPolicyHash: "p1" }));
    const b = computeWorkflowFingerprint(makeInput({ toolPolicyHash: "p2" }));
    expect(a).not.toBe(b);
  });

  it("delegationHash 变化时指纹不同", () => {
    const a = computeWorkflowFingerprint(makeInput({ delegationHash: "d1" }));
    const b = computeWorkflowFingerprint(makeInput({ delegationHash: "d2" }));
    expect(a).not.toBe(b);
  });

  it("workflowVersion 变化时指纹不同", () => {
    const a = computeWorkflowFingerprint(makeInput({ workflowVersion: "1.0.0" }));
    const b = computeWorkflowFingerprint(makeInput({ workflowVersion: "1.0.1" }));
    expect(a).not.toBe(b);
  });

  it("schemaVersion 变化时指纹不同", () => {
    const a = computeWorkflowFingerprint(makeInput({ schemaVersion: 1 }));
    const b = computeWorkflowFingerprint(makeInput({ schemaVersion: 2 }));
    expect(a).not.toBe(b);
  });

  it("返回 64 字符 hex sha256", () => {
    const fp = computeWorkflowFingerprint(makeInput());
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("computeStableHash", () => {
  it("相同对象相同 hash", () => {
    expect(computeStableHash({ a: 1, b: 2 })).toBe(computeStableHash({ b: 2, a: 1 }));
  });

  it("不同对象不同 hash", () => {
    expect(computeStableHash({ a: 1 })).not.toBe(computeStableHash({ a: 2 }));
  });

  it("null 和 undefined 视为相同（JSON 语义）", () => {
    // undefined 在稳定序列化中被忽略，与 null 产生相同 hash
    expect(computeStableHash(null)).toBe(computeStableHash(undefined));
  });

  it("cwd 或隔离模式变化时指纹不同", () => {
    const normal = computeWorkflowFingerprint(makeInput({ cwd: "C:/repo/packages/demo" }));
    const isolated = computeWorkflowFingerprint(makeInput({
      cwd: "C:/repo/packages/demo",
      isolationMode: "worktree",
    }));
    const otherCwd = computeWorkflowFingerprint(makeInput({ cwd: "C:/repo/packages/other" }));
    expect(normal).not.toBe(isolated);
    expect(normal).not.toBe(otherCwd);
  });
});

describe("computeWorkflowToolPolicyHash", () => {
  it("allowedToolFamilies 顺序不同时 hash 相同", () => {
    const a = computeWorkflowToolPolicyHash({
      role: "researcher",
      permissionMode: "plan",
      allowedToolFamilies: ["workspace-read", "network-read"],
      maxToolRiskLevel: "medium",
      policySummary: "read only",
    });
    const b = computeWorkflowToolPolicyHash({
      role: "researcher",
      permissionMode: "plan",
      allowedToolFamilies: ["network-read", "workspace-read"],
      maxToolRiskLevel: "medium",
      policySummary: "read only",
    });
    expect(a).toBe(b);
  });

  it("permissionMode 变化时 hash 不同", () => {
    const a = computeWorkflowToolPolicyHash({ permissionMode: "plan" });
    const b = computeWorkflowToolPolicyHash({ permissionMode: "confirm" });
    expect(a).not.toBe(b);
  });
});
