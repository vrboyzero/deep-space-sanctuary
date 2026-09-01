import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  parseCodingAgentCandidateQualificationCliArguments,
} from "./run-coding-agent-candidate-qualification.mjs";

describe("coding agent candidate qualification CLI", () => {
  it("parses an aggregate root, optional scorecard, and verify mode", () => {
    expect(parseCodingAgentCandidateQualificationCliArguments([
      "--aggregate-root",
      "candidate-aggregate",
      "--scorecard-path",
      "candidate-scorecard.json",
      "--verify",
    ])).toEqual({
      aggregateRoot: path.resolve("candidate-aggregate"),
      scorecardPath: path.resolve("candidate-scorecard.json"),
      verify: true,
    });
  });

  it("does not consume the next flag as a missing path value", () => {
    expect(() => parseCodingAgentCandidateQualificationCliArguments([
      "--aggregate-root",
      "candidate-aggregate",
      "--scorecard-path",
      "--verify",
    ])).toThrow(/--scorecard-path.*value|requires.*--scorecard-path/i);
  });

  it("fails safely when the required aggregate root is omitted", () => {
    const result = spawnSync(process.execPath, [
      "--import",
      "tsx",
      fileURLToPath(new URL("./run-coding-agent-candidate-qualification.mjs", import.meta.url)),
    ], {
      encoding: "utf-8",
      windowsHide: true,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/failed:.*--aggregate-root/i);
    expect(result.stderr).not.toMatch(/contract is not implemented/i);
  });

  it("rejects missing, duplicate, and unknown CLI arguments", () => {
    expect(() => parseCodingAgentCandidateQualificationCliArguments([]))
      .toThrow(/--aggregate-root/i);
    expect(() => parseCodingAgentCandidateQualificationCliArguments([
      "--aggregate-root", "one", "--aggregate-root", "two",
    ])).toThrow(/--aggregate-root.*once/i);
    expect(() => parseCodingAgentCandidateQualificationCliArguments([
      "--aggregate-root", "one", "--scorecard-path", "one.json",
      "--scorecard-path", "two.json",
    ])).toThrow(/--scorecard-path.*once/i);
    expect(() => parseCodingAgentCandidateQualificationCliArguments([
      "--aggregate-root", "one", "--verify", "--verify",
    ])).toThrow(/--verify.*once/i);
    expect(() => parseCodingAgentCandidateQualificationCliArguments([
      "--aggregate-root", "one", "--unknown",
    ])).toThrow(/unknown/i);
  });
});
