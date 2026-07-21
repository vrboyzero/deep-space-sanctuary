import { describe, expect, it } from "vitest";

import {
  MemoryModelPrivacyRuntime,
  preparePrivateSummaryModelRequest,
  resolveMemoryModelEndpointTrust,
} from "./memory-model-privacy.js";

describe("memory model privacy policy", () => {
  it("classifies loopback model endpoints as local", () => {
    expect(resolveMemoryModelEndpointTrust("http://127.0.0.1:11434/v1", [])).toBe("local");
    expect(resolveMemoryModelEndpointTrust("http://localhost:1234/v1", [])).toBe("local");
    expect(resolveMemoryModelEndpointTrust("http://[::1]:8080/v1", [])).toBe("local");
  });

  it("classifies an explicitly allowlisted remote host as trusted", () => {
    expect(resolveMemoryModelEndpointTrust(
      "https://Models.Example.Test/v1",
      ["models.example.test"],
    )).toBe("trusted_remote");
  });

  it("classifies a non-allowlisted remote host as untrusted", () => {
    expect(resolveMemoryModelEndpointTrust(
      "https://unknown.example.test/v1",
      ["models.example.test"],
    )).toBe("untrusted_remote");
  });

  it("redacts only the outbound copy for a remote private summary request", () => {
    const payload = {
      model: "summary-model",
      messages: [{ role: "user", content: "contact alice@example.test" }],
    };

    const prepared = preparePrivateSummaryModelRequest({
      jobFamily: "dream",
      baseUrl: "https://models.example.test/v1",
      payload,
      trustedRemoteHosts: ["models.example.test"],
      redactor: (text) => text.replace("alice@example.test", "[REDACTED]"),
    });

    expect(payload.messages[0]?.content).toBe("contact alice@example.test");
    expect(prepared.payload).toEqual({
      model: "summary-model",
      messages: [{ role: "user", content: "contact [REDACTED]" }],
    });
    expect(prepared.snapshot).toMatchObject({
      jobFamily: "dream",
      dataClass: "private_summary",
      trustProfile: "trusted_remote",
      redactorStatus: "applied",
    });
  });

  it("preserves a remote payload when the redactor is off", () => {
    const payload = {
      model: "summary-model",
      messages: [{ role: "user", content: "private summary source" }],
    };

    const prepared = preparePrivateSummaryModelRequest({
      jobFamily: "idle_summary",
      baseUrl: "https://unknown.example.test/v1",
      payload,
      trustedRemoteHosts: [],
    });

    expect(prepared.payload).toBe(payload);
    expect(prepared.snapshot).toMatchObject({
      jobFamily: "idle_summary",
      dataClass: "private_summary",
      trustProfile: "untrusted_remote",
      redactorStatus: "off",
    });
  });

  it("rejects an oversized UTF-8 request before transport", () => {
    expect(() => preparePrivateSummaryModelRequest({
      jobFamily: "durable_extraction",
      baseUrl: "https://models.example.test/v1",
      payload: { messages: [{ role: "user", content: "私密摘要" }] },
      trustedRemoteHosts: [],
      maxRequestBytes: 16,
    })).toThrow("Private summary model request exceeds 16 byte limit.");
  });

  it("reports only bounded privacy metadata for all model job families", () => {
    const runtime = new MemoryModelPrivacyRuntime({
      trustedRemoteHosts: ["trusted.example.test"],
      redactor: (text) => text.replace("doctor-private-body", "[REDACTED]"),
    });
    runtime.registerEndpoint("dream", "http://127.0.0.1:11434/v1");
    runtime.registerEndpoint("idle_summary", "https://trusted.example.test/v1");
    const prepared = runtime.prepareRequest({
      jobFamily: "durable_extraction",
      baseUrl: "https://unknown.example.test/v1",
      payload: {
        apiKey: "doctor-api-key",
        messages: [{ role: "user", content: "doctor-private-body" }],
      },
    });
    runtime.completeRequest(prepared.observation, {
      httpStatus: 200,
      responseBytes: 42,
    });

    expect(runtime.getDoctorReport()).toEqual({
      dataClass: "private_summary",
      items: [
        {
          jobFamily: "dream",
          dataClass: "private_summary",
          trustProfile: "local",
          leavesLocalMachine: false,
          redactorStatus: "enabled",
          requestBytes: 0,
          responseBytes: 0,
          status: "idle",
        },
        {
          jobFamily: "durable_extraction",
          dataClass: "private_summary",
          trustProfile: "untrusted_remote",
          leavesLocalMachine: true,
          redactorStatus: "enabled",
          requestBytes: prepared.snapshot.requestBytes,
          responseBytes: 42,
          status: "succeeded",
          httpStatus: 200,
        },
        {
          jobFamily: "idle_summary",
          dataClass: "private_summary",
          trustProfile: "trusted_remote",
          leavesLocalMachine: true,
          redactorStatus: "enabled",
          requestBytes: 0,
          responseBytes: 0,
          status: "idle",
        },
      ],
    });
    const serialized = JSON.stringify(runtime.getDoctorReport());
    expect(serialized).not.toContain("doctor-private-body");
    expect(serialized).not.toContain("doctor-api-key");
  });

  it("ignores a stale completion after a newer request owns the family snapshot", () => {
    const runtime = new MemoryModelPrivacyRuntime();
    const first = runtime.prepareRequest({
      jobFamily: "dream",
      baseUrl: "https://models.example.test/v1",
      payload: { messages: [{ role: "user", content: "first-private-body" }] },
    });
    const second = runtime.prepareRequest({
      jobFamily: "dream",
      baseUrl: "https://models.example.test/v1",
      payload: { messages: [{ role: "user", content: "second-private-body" }] },
    });

    runtime.completeRequest(first.observation, { httpStatus: 200, responseBytes: 11 });
    runtime.failRequest(second.observation, { httpStatus: 503, responseBytes: 22 });

    expect(runtime.getDoctorReport().items).toEqual([
      expect.objectContaining({
        jobFamily: "dream",
        status: "failed",
        httpStatus: 503,
        responseBytes: 22,
      }),
    ]);
    const serialized = JSON.stringify(runtime.getDoctorReport());
    expect(serialized).not.toContain("first-private-body");
    expect(serialized).not.toContain("second-private-body");
  });

  it("builds the shared trusted-host and basic-redactor policy from environment", () => {
    const source = "email alice@example.test token sk-private-123456";
    const runtime = MemoryModelPrivacyRuntime.fromEnv({
      BELLDANDY_MEMORY_PRIVATE_SUMMARY_TRUSTED_HOSTS: "trusted.example.test, other.example.test",
      BELLDANDY_MEMORY_PRIVATE_SUMMARY_REDACTOR: "basic",
    } as NodeJS.ProcessEnv);

    const prepared = runtime.prepareRequest({
      jobFamily: "idle_summary",
      baseUrl: "https://trusted.example.test/v1",
      payload: { messages: [{ role: "user", content: source }] },
    });

    expect(source).toContain("alice@example.test");
    expect(prepared.snapshot).toMatchObject({
      trustProfile: "trusted_remote",
      redactorStatus: "applied",
    });
    expect(prepared.body).toContain("[REDACTED_EMAIL]");
    expect(prepared.body).toContain("[REDACTED_SECRET]");
    expect(prepared.body).not.toContain("alice@example.test");
    expect(prepared.body).not.toContain("sk-private-123456");
  });
});
