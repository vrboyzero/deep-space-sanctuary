import { describe, expect, it } from "vitest";

import {
  buildCommandPermissionPreview,
  parseCommandPlan,
  sanitizeCommandPlanForAudit,
  sanitizeCommandPermissionPreview,
  summarizeCommandPlanForAudit,
} from "./command-plan.js";

describe("parseCommandPlan", () => {
  it("accepts an explicit non-interactive, network-isolated command plan", () => {
    expect(parseCommandPlan({
      executable: "node",
      argv: ["--version"],
      cwd: "packages/belldandy-skills",
      env: { NODE_ENV: "test", PRIVATE_TOKEN: "do-not-log" },
      network: "none",
      writeScope: "workspace-readonly",
      stdinMode: "closed",
    })).toEqual({
      ok: true,
      plan: {
        executable: "node",
        argv: ["--version"],
        cwd: "packages/belldandy-skills",
        env: { NODE_ENV: "test", PRIVATE_TOKEN: "do-not-log" },
        network: "none",
        writeScope: "workspace-readonly",
        stdinMode: "closed",
      },
    });
  });

  it("rejects shell entrypoints, networked plans, and unknown stdin modes", () => {
    expect(parseCommandPlan({ executable: "sh", argv: ["-c", "echo unsafe"] })).toMatchObject({
      ok: false,
      code: "shell_entrypoint_blocked",
    });
    expect(parseCommandPlan({ executable: "node", network: "allow" })).toMatchObject({
      ok: false,
      code: "unsupported_network_mode",
    });
    expect(parseCommandPlan({ executable: "node", stdinMode: "pipe" })).toMatchObject({
      ok: true,
      plan: { stdinMode: "pipe" },
    });
    expect(parseCommandPlan({ executable: "node", stdinMode: "pty" })).toMatchObject({
      ok: true,
      plan: { stdinMode: "pty" },
    });
    expect(parseCommandPlan({ executable: "node", stdinMode: "inherited" })).toMatchObject({
      ok: false,
      code: "unsupported_stdin_mode",
    });
  });

  it("does not include environment values in the audit summary", () => {
    const parsed = parseCommandPlan({
      executable: "node",
      argv: ["--version"],
      env: { PRIVATE_TOKEN: "do-not-log", LOG_LEVEL: "debug" },
    });
    if (!parsed.ok) throw new Error("expected command plan to parse");

    expect(summarizeCommandPlanForAudit(parsed.plan)).toEqual({
      executable: "node",
      argv: ["--version"],
      cwd: ".",
      environmentKeys: ["LOG_LEVEL", "PRIVATE_TOKEN"],
      network: "none",
      writeScope: "workspace-readonly",
      stdinMode: "closed",
    });

    expect(sanitizeCommandPlanForAudit({
      commandPlan: {
        executable: "node",
        env: { PRIVATE_TOKEN: "do-not-log" },
      },
    })).toEqual({
      commandPlan: {
        executable: "node",
        env: { PRIVATE_TOKEN: "[REDACTED]" },
      },
    });

    expect(sanitizeCommandPlanForAudit({
      action: "write",
      jobId: "job-1",
      data: "stdin-secret",
    })).toEqual({
      action: "write",
      jobId: "job-1",
      data: "[REDACTED]",
    });
  });

  it("projects a command approval preview without environment, stdin, or sensitive argv values", () => {
    const preview = buildCommandPermissionPreview({
      toolName: "command_job",
      arguments: {
        action: "start",
        commandPlan: {
          executable: "node",
          argv: ["--token", "do-not-leak", "--header=Authorization: Bearer do-not-leak", "PRIVATE_TOKEN=do-not-leak", "https://example.test/?token=do-not-leak", "--version"],
          cwd: "packages/belldandy-skills",
          env: { PRIVATE_TOKEN: "do-not-leak", LOG_LEVEL: "debug" },
          network: "none",
          writeScope: "workspace-readonly",
          stdinMode: "pipe",
          timeoutMs: 120_000,
        },
      },
    });

    expect(preview).toEqual({
      kind: "command",
      action: "start",
      commandPlan: {
        executable: "node",
        argv: ["--token", "[REDACTED]", "--header=[REDACTED]", "PRIVATE_TOKEN=[REDACTED]", "https://example.test/?token=[REDACTED]", "--version"],
        cwd: "packages/belldandy-skills",
        environmentKeys: ["LOG_LEVEL", "PRIVATE_TOKEN"],
        network: "none",
        writeScope: "workspace-readonly",
        stdinMode: "pipe",
        timeoutMs: 120_000,
      },
    });
    expect(JSON.stringify(preview)).not.toContain("do-not-leak");

    const stdinPreview = buildCommandPermissionPreview({
      toolName: "command_job",
      arguments: {
        action: "write",
        jobId: "11111111-1111-4111-8111-111111111111",
        data: "stdin-secret",
      },
    });
    expect(stdinPreview).toEqual({
      kind: "command",
      action: "write",
      jobId: "11111111-1111-4111-8111-111111111111",
      stdinProvided: true,
    });
    expect(JSON.stringify(stdinPreview)).not.toContain("stdin-secret");

    expect(buildCommandPermissionPreview({ toolName: "file_write", arguments: {} })).toBeUndefined();
    expect(sanitizeCommandPermissionPreview({
      kind: "command",
      action: "run",
      commandPlan: {
        executable: "node",
        argv: ["--api-key=must-not-leak"],
        cwd: ".",
        environmentKeys: ["API_KEY"],
        network: "none",
        writeScope: "workspace-readonly",
        stdinMode: "closed",
      },
    })).toMatchObject({
      commandPlan: { argv: ["--api-key=[REDACTED]"] },
    });
  });
});
