import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  EXTENSION_RUNTIME_PROTOCOL_VERSION,
  type ExtensionRuntimeHostResponse,
} from "./extension-runtime-contract.js";
import {
  OciExtensionRuntimeAdapter,
  buildOciExtensionRuntimeInvocation,
  resolveOciExtensionRuntimeConfig,
  type ExtensionRuntimeTransport,
} from "./extension-runtime-oci-adapter.js";

const pinnedImage = `belldandy-extension-host@sha256:${"a".repeat(64)}`;

class FakeTransport implements ExtensionRuntimeTransport {
  readonly written: string[] = [];
  terminated = false;
  private readonly lineListeners = new Set<(line: string) => void>();
  private readonly exitListeners = new Set<(error: Error) => void>();

  write(line: string): void {
    this.written.push(line);
  }

  onLine(listener: (line: string) => void): () => void {
    this.lineListeners.add(listener);
    return () => this.lineListeners.delete(listener);
  }

  onExit(listener: (error: Error) => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(response: ExtensionRuntimeHostResponse): void {
    const line = JSON.stringify(response);
    for (const listener of this.lineListeners) listener(line);
  }

  exit(message: string): void {
    for (const listener of this.exitListeners) listener(new Error(message));
  }
}

function grant() {
  return {
    extensionId: "pure-plugin@official-market",
    extensionName: "pure-plugin",
    installPath: path.resolve("materialized", "pure-plugin"),
    pluginModuleRelativePath: "dist/plugin.mjs",
    contentSha256: "b".repeat(64),
    hostApi: 2,
    permissions: ["tool:pure_echo" as const],
    runtimeCapabilities: [],
    skillDirs: [],
  };
}

describe("OCI extension runtime adapter", () => {
  it("builds a fail-closed isolated invocation with only read-only extension and host mounts", () => {
    const invocation = buildOciExtensionRuntimeInvocation({
      config: { backend: "oci", runtime: "docker", image: pinnedImage },
      extensionRoot: path.resolve("materialized", "pure-plugin"),
      hostRoot: path.resolve("packages", "belldandy-core", "dist"),
      lease: {
        leaseId: "12345678-1234-4234-8234-123456789abc",
        containerName: "belldandy-extension-12345678123442348234123456789abc",
        cidFile: path.resolve("runtime", "container.cid"),
      },
    });

    expect(invocation.executable).toBe("docker");
    expect(invocation.args).toEqual(expect.arrayContaining([
      "--pull=never",
      "--network", "none",
      "--read-only",
      "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges",
      "--pids-limit", "64",
      "--memory", "256m",
      "--cpus", "1",
      "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=32m",
      "--entrypoint", "node",
      pinnedImage,
      "/belldandy-host/extension-runtime-host-process.js",
      "/extension",
    ]));
    const mounts = invocation.args.filter((_value, index) => invocation.args[index - 1] === "--mount");
    expect(mounts).toHaveLength(2);
    expect(mounts.every((mount) => mount.includes("readonly"))).toBe(true);
    expect(invocation.args.join(" ")).not.toMatch(/\/workspace|stateDir|USERPROFILE|HOME=/i);
  });

  it("accepts only a configured digest-pinned OCI image", () => {
    expect(resolveOciExtensionRuntimeConfig((name) => ({
      BELLDANDY_EXTENSION_HOST_BACKEND: "oci",
      BELLDANDY_EXTENSION_HOST_OCI_RUNTIME: "docker",
      BELLDANDY_EXTENSION_HOST_OCI_IMAGE: pinnedImage,
    })[name])).toEqual({ backend: "oci", runtime: "docker", image: pinnedImage });
    expect(resolveOciExtensionRuntimeConfig((name) => ({
      BELLDANDY_EXTENSION_HOST_BACKEND: "oci",
      BELLDANDY_EXTENSION_HOST_OCI_IMAGE: "belldandy-extension-host:latest",
    })[name])).toBeUndefined();
    expect(resolveOciExtensionRuntimeConfig(() => undefined)).toBeUndefined();
  });

  it("fails the session closed on a duplicate response", async () => {
    const transport = new FakeTransport();
    const release = vi.fn(async () => undefined);
    const adapter = new OciExtensionRuntimeAdapter({
      config: { backend: "oci", runtime: "docker", image: pinnedImage },
      stateDir: path.resolve("state"),
      hostRoot: path.resolve("host"),
      launch: async () => ({ transport, release }),
    });
    const activation = adapter.activate(grant());
    await vi.waitFor(() => expect(transport.written).toHaveLength(1));
    const activationRequest = JSON.parse(transport.written[0]);
    transport.respond({
      version: EXTENSION_RUNTIME_PROTOCOL_VERSION,
      type: "activated",
      id: activationRequest.id,
      ok: true,
      registrations: {
        plugin: { id: "pure-plugin", name: "Pure Plugin" },
        tools: [],
        hooks: [],
        skillDirs: [],
      },
    });
    const session = await activation;
    const fatal = vi.fn();
    session.onFatal?.(fatal);
    const invocation = session.invoke({
      kind: "tool",
      invocationId: "invoke-1",
      generation: 1,
      toolName: "pure_echo",
      arguments: {},
      context: { conversationId: "conversation-1" },
    });
    transport.respond({
      version: 1,
      type: "result",
      id: "invoke-1",
      ok: true,
      result: { id: "invoke-1", name: "pure_echo", success: true, output: "ok", durationMs: 0 },
    });
    await expect(invocation).resolves.toMatchObject({ success: true });

    transport.respond({
      version: 1,
      type: "result",
      id: "invoke-1",
      ok: true,
      result: { id: "invoke-1", name: "pure_echo", success: true, output: "duplicate", durationMs: 0 },
    });
    await vi.waitFor(() => expect(fatal).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringMatching(/duplicate.*response/i),
    })));
    expect(transport.terminated).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
    await expect(session.invoke({
      kind: "tool",
      invocationId: "invoke-2",
      generation: 1,
      toolName: "pure_echo",
      arguments: {},
      context: { conversationId: "conversation-1" },
    })).rejects.toThrow(/closed/i);
  });

  it("rejects pending requests and releases the lease when the host exits", async () => {
    const transport = new FakeTransport();
    const release = vi.fn(async () => undefined);
    const adapter = new OciExtensionRuntimeAdapter({
      config: { backend: "oci", runtime: "docker", image: pinnedImage },
      stateDir: path.resolve("state"),
      hostRoot: path.resolve("host"),
      launch: async () => ({ transport, release }),
    });
    const activation = adapter.activate(grant());
    await vi.waitFor(() => expect(transport.written).toHaveLength(1));
    transport.exit("host exited");

    await expect(activation).rejects.toThrow(/host exited/i);
    expect(transport.terminated).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
