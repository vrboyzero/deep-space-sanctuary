import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import { startGatewayServer } from "../packages/belldandy-core/src/server.ts";
import {
  cleanupGlobalMemoryManagersForTest,
  resolveWebRoot,
} from "../packages/belldandy-core/src/server-testkit.ts";

import {
  buildAgentRunArgs,
  collectWorkspaceArtifact,
  resolveCodingCiProfile,
  sanitizeDiagnostic,
  validateAgentRunEvents,
} from "./run-coding-agent-ci.mjs";

const tempRoots = [];

afterEach(async () => {
  await cleanupGlobalMemoryManagersForTest();
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("coding agent CI runner", () => {
  it("defaults to a bounded read-only profile and requires explicit workspace-write opt-in", () => {
    expect(resolveCodingCiProfile(undefined)).toEqual({
      mode: "plan",
      permissionMode: "plan",
      toolAllow: ["file_read", "list_files"],
    });
    expect(resolveCodingCiProfile("workspace-write")).toEqual({
      mode: "workspace-write",
      permissionMode: "acceptEdits",
      toolAllow: ["file_read", "list_files", "apply_patch", "file_write", "file_delete"],
    });
    expect(() => resolveCodingCiProfile("confirm")).toThrow(/mode/i);
  });

  it("builds one fixed-budget JSONL invocation without shell or push tools", () => {
    const args = buildAgentRunArgs({
      workspace: "C:/fixture/workspace",
      stateDir: "C:/fixture/state",
      outputSchemaPath: "C:/fixture/review-output.schema.json",
      profile: resolveCodingCiProfile("workspace-write"),
    });

    expect(args).toEqual([
      "agent", "run",
      "--jsonl",
      "--cwd", path.resolve("C:/fixture/workspace"),
      "--state-dir", path.resolve("C:/fixture/state"),
      "--permission-mode", "accept-edits",
      "--tool-allow", "file_read,list_files,apply_patch,file_write,file_delete",
      "--tool-deny", "run_command,spawn_subagent",
      "--timeout", "300000",
      "--max-turns", "12",
      "--max-tokens", "24000",
      "--output-schema", path.resolve("C:/fixture/review-output.schema.json"),
    ]);
    expect(args.join(" ")).not.toMatch(/\b(?:push|merge|apply)\b/);
  });

  it("accepts one continuous v1 event stream with a unique terminal event", () => {
    const binding = { agentRunId: "run-ci", conversationId: "conv-ci" };
    const events = [
      event(1, "run.started", binding, { status: "running" }),
      event(2, "message.delta", binding, { delta: "ok" }),
      event(3, "run.completed", binding, { output: { text: "{\"summary\":\"ok\",\"findings\":[]}" } }),
    ];

    expect(validateAgentRunEvents(events, isFixtureEvent)).toEqual({
      binding,
      terminalType: "run.completed",
    });
    expect(() => validateAgentRunEvents([
      events[0],
      event(3, "run.completed", binding, {}),
    ], isFixtureEvent)).toThrow(/sequence/i);
  });

  it("collects tracked and untracked changes into one reviewable patch", async () => {
    const root = await createGitFixture();
    await fs.writeFile(path.join(root, "tracked.txt"), "changed\n", "utf-8");
    await fs.writeFile(path.join(root, "new file.txt"), "new\n", "utf-8");

    const artifact = collectWorkspaceArtifact({ workspace: root, mode: "workspace-write" });

    expect(artifact.changedPaths).toEqual(["new file.txt", "tracked.txt"]);
    expect(artifact.patch).toContain("tracked.txt");
    expect(artifact.patch).toContain("new file.txt");
    expect(artifact.patch).toContain("+changed");
    expect(artifact.patch).toContain("+new");
  });

  it("fails closed for unexpected read-only writes and sensitive artifact paths", async () => {
    const planRoot = await createGitFixture();
    await fs.writeFile(path.join(planRoot, "tracked.txt"), "changed\n", "utf-8");
    expect(() => collectWorkspaceArtifact({ workspace: planRoot, mode: "plan" })).toThrow(/read-only/i);

    const sensitiveRoot = await createGitFixture();
    await fs.writeFile(path.join(sensitiveRoot, "credentials.json"), "{}\n", "utf-8");
    expect(() => collectWorkspaceArtifact({ workspace: sensitiveRoot, mode: "workspace-write" })).toThrow(/sensitive/i);
  });

  it("redacts secret-shaped diagnostics before persistence", () => {
    expect(sanitizeDiagnostic("apiKey=abc token: Bearer xyz ordinary=value"))
      .toBe("apiKey=[REDACTED] token:[REDACTED] ordinary=value");
  });

  it("runs the built Headless CLI through a real Gateway and emits review artifacts", async () => {
    const workspace = await createGitFixture();
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-coding-ci-state-"));
    tempRoots.push(stateDir);
    const artifactDir = path.join(stateDir, "artifacts");
    const promptPath = path.join(stateDir, "prompt.md");
    const outputSchemaPath = path.join(stateDir, "output.schema.json");
    await fs.writeFile(promptPath, "Review the fixture and return JSON.", "utf-8");
    await fs.writeFile(outputSchemaPath, JSON.stringify({
      type: "object",
      additionalProperties: false,
      required: ["summary", "findings"],
      properties: {
        summary: { type: "string" },
        findings: { type: "array" },
      },
    }), "utf-8");
    const agent = {
      async *run() {
        yield { type: "final", text: JSON.stringify({ summary: "clean fixture", findings: [] }) };
      },
    };
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => agent,
    });

    try {
      const result = await runNode([
        path.resolve("scripts/run-coding-agent-ci.mjs"),
        "--workspace", workspace,
        "--state-dir", stateDir,
        "--artifact-dir", artifactDir,
        "--prompt-file", promptPath,
        "--output-schema", outputSchemaPath,
        "--mode", "plan",
      ], workspace, {
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(server.port),
        BELLDANDY_AUTH_MODE: "none",
      });

      const diagnostics = await fs.readFile(path.join(artifactDir, "diagnostics.log"), "utf-8").catch(() => "");
      expect(result.exitCode, `${result.stderr}\n${diagnostics}`).toBe(0);
      const manifest = JSON.parse(await fs.readFile(path.join(artifactDir, "manifest.json"), "utf-8"));
      const output = JSON.parse(await fs.readFile(path.join(artifactDir, "result.json"), "utf-8"));
      expect(manifest).toMatchObject({
        schemaVersion: "coding-agent-ci/v1",
        protocolVersion: "v1",
        mode: "plan",
        cliExitCode: 0,
        terminalType: "run.completed",
        changedPaths: [],
        checks: {
          cleanBaseline: true,
          eventContract: true,
          artifactPolicy: true,
          automaticPush: false,
        },
      });
      expect(output).toEqual({ summary: "clean fixture", findings: [] });
      await expect(fs.readFile(path.join(artifactDir, "changes.patch"), "utf-8")).resolves.toBe("");
    } finally {
      await server.close();
    }
  }, 20_000);
});

function event(seq, type, binding, payload) {
  return {
    version: "v1",
    seq,
    timestampMs: 1_700_000_000_000 + seq,
    source: "conversation",
    binding,
    type,
    payload,
  };
}

function isFixtureEvent(value) {
  return Boolean(
    value
      && value.version === "v1"
      && Number.isInteger(value.seq)
      && value.seq > 0
      && value.source === "conversation"
      && typeof value.binding?.agentRunId === "string"
      && typeof value.binding?.conversationId === "string"
      && typeof value.type === "string"
      && value.payload
      && typeof value.payload === "object",
  );
}

async function createGitFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-coding-ci-"));
  tempRoots.push(root);
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  execFileSync("git", ["config", "user.email", "ci@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "CI Fixture"], { cwd: root });
  await fs.writeFile(path.join(root, "tracked.txt"), "baseline\n", "utf-8");
  execFileSync("git", ["add", "tracked.txt"], { cwd: root });
  execFileSync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: root });
  return root;
}

async function runNode(args, cwd, env) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}
