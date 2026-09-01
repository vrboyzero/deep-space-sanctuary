import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  collectCodingAgentCandidateGlobalEvidence,
  collectCodingAgentCandidateOwnedResourceSweep,
  probeCodingAgentCandidateOwnedResources,
} from "./coding-agent-candidate-evidence.mjs";

const tempRoots = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((target) => fs.rm(target, { recursive: true, force: true })));
});

describe("coding agent candidate-global evidence", () => {
  it("scans exact sensitive values without following links or echoing matched content", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-agent-candidate-evidence-"));
    tempRoots.push(root);
    const scanRoot = path.join(root, "declared-root");
    const outsideRoot = path.join(root, "outside-root");
    const sensitiveValue = "candidate-sensitive-value-for-test";
    await fs.mkdir(path.join(scanRoot, "nested"), { recursive: true });
    await fs.mkdir(outsideRoot, { recursive: true });
    await fs.writeFile(path.join(scanRoot, "safe.txt"), "safe fixture\n", "utf-8");
    await fs.writeFile(
      path.join(scanRoot, "nested", "matched.txt"),
      `prefix:${sensitiveValue}:suffix\n`,
      "utf-8",
    );
    await fs.writeFile(path.join(outsideRoot, "must-not-scan.txt"), sensitiveValue, "utf-8");
    await fs.symlink(
      outsideRoot,
      path.join(scanRoot, "outside-link"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const probedPlatforms = [];

    const evidence = await collectCodingAgentCandidateGlobalEvidence({
      sensitiveRoots: [scanRoot],
      sensitiveValues: [sensitiveValue],
    }, {
      async collectResourceSweep({ platform }) {
        probedPlatforms.push(platform);
        return emptyResourceSweep(platform);
      },
    });

    expect(evidence).toEqual({
      sensitiveScan: {
        status: "completed",
        scope: "candidate_declared_roots",
        linkPolicy: "count_do_not_follow",
        contentPolicy: "exact_values_non_echoing",
        rootCount: 1,
        regularFileCount: 2,
        unreadableFileCount: 0,
        symlinkOrReparsePointCount: 1,
        findingCount: 1,
      },
      resourceSweeps: [
        emptyResourceSweep("windows-native"),
        emptyResourceSweep("wsl2-linux"),
      ],
    });
    expect(probedPlatforms).toEqual(["windows-native", "wsl2-linux"]);
    expect(JSON.stringify(evidence)).not.toContain(sensitiveValue);
    expect(JSON.stringify(evidence)).not.toContain("matched.txt");
    expect(JSON.stringify(evidence)).not.toContain("must-not-scan.txt");
  });

  it("rejects overlapping declared roots before counting any file twice", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-agent-candidate-evidence-"));
    tempRoots.push(root);
    const scanRoot = path.join(root, "declared-root");
    const nestedRoot = path.join(scanRoot, "nested");
    await fs.mkdir(nestedRoot, { recursive: true });
    await fs.writeFile(path.join(nestedRoot, "fixture.txt"), "sensitive-value", "utf-8");

    await expect(collectCodingAgentCandidateGlobalEvidence({
      sensitiveRoots: [scanRoot, nestedRoot],
      sensitiveValues: ["sensitive-value"],
    }, {
      collectResourceSweep: ({ platform }) => emptyResourceSweep(platform),
    })).rejects.toThrow(/roots.*overlap/i);
  });

  it("finds an exact sensitive value across the default stream chunk boundary", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-agent-candidate-evidence-"));
    tempRoots.push(root);
    const scanRoot = path.join(root, "declared-root");
    const sensitiveValue = "candidate-sensitive-boundary-value";
    await fs.mkdir(scanRoot, { recursive: true });
    await fs.writeFile(path.join(scanRoot, "boundary.bin"), Buffer.concat([
      Buffer.alloc((64 * 1024) - 3, 0x61),
      Buffer.from(sensitiveValue, "utf-8"),
      Buffer.from("\n", "utf-8"),
    ]));

    const evidence = await collectCodingAgentCandidateGlobalEvidence({
      sensitiveRoots: [scanRoot],
      sensitiveValues: [sensitiveValue],
    }, {
      collectResourceSweep: ({ platform }) => emptyResourceSweep(platform),
    });

    expect(evidence.sensitiveScan).toMatchObject({
      regularFileCount: 1,
      unreadableFileCount: 0,
      findingCount: 1,
    });
    expect(JSON.stringify(evidence)).not.toContain(sensitiveValue);
  });

  it("rejects a declared root that is itself a link", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-agent-candidate-evidence-"));
    tempRoots.push(root);
    const actualRoot = path.join(root, "actual-root");
    const linkedRoot = path.join(root, "linked-root");
    await fs.mkdir(actualRoot, { recursive: true });
    await fs.symlink(
      actualRoot,
      linkedRoot,
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(collectCodingAgentCandidateGlobalEvidence({
      sensitiveRoots: [linkedRoot],
      sensitiveValues: ["candidate-sensitive-value-for-test"],
    }, {
      collectResourceSweep: ({ platform }) => emptyResourceSweep(platform),
    })).rejects.toThrow(/roots.*regular directories/i);
  });
});

describe("coding agent candidate-owned resource sweep", () => {
  it("summarizes only explicit inventory without leaking resource identifiers", async () => {
    const inventory = {
      listeners: [
        { host: "127.0.0.1", port: 29255 },
        { host: "127.0.0.1", port: 29256 },
      ],
      processIds: [42421],
      runtimeMarkers: [
        "E:\\candidate-runtime\\active.marker",
        "E:\\candidate-runtime\\remaining.marker",
      ],
      runtimeEnvFiles: ["E:\\candidate-runtime\\.env.local"],
    };

    const sweep = await collectCodingAgentCandidateOwnedResourceSweep({
      platform: "windows-native",
      inventory,
    }, {
      async probeOwnedResources() {
        return {
          listeners: [true, false],
          processIds: [true],
          runtimeMarkers: [false, true],
          runtimeEnvFiles: [false],
        };
      },
    });

    expect(sweep).toEqual({
      platform: "windows-native",
      status: "completed",
      scope: "candidate_owned_resources",
      remainingListenerCount: 1,
      remainingOwnedProcessCount: 1,
      remainingRuntimeMarkerCount: 1,
      remainingRuntimeEnvFileCount: 0,
      orphanResourceCount: 3,
    });
    const serialized = JSON.stringify(sweep);
    expect(serialized).not.toContain("29255");
    expect(serialized).not.toContain("42421");
    expect(serialized).not.toContain("remaining.marker");
  });

  it.runIf(process.platform === "win32")(
    "probes real Windows runtime paths without reading or returning file content",
    async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-agent-candidate-resources-"));
      tempRoots.push(root);
      const markerPath = path.join(root, "active.marker");
      const missingEnvPath = path.join(root, ".env.local");
      const sensitiveContent = "candidate-runtime-sensitive-content";
      await fs.writeFile(markerPath, sensitiveContent, "utf-8");

      const sweep = await collectCodingAgentCandidateOwnedResourceSweep({
        platform: "windows-native",
        inventory: {
          ...emptyResourceInventory(),
          runtimeMarkers: [markerPath],
          runtimeEnvFiles: [missingEnvPath],
        },
      }, {
        probeOwnedResources: probeCodingAgentCandidateOwnedResources,
      });

      expect(sweep).toEqual({
        platform: "windows-native",
        status: "completed",
        scope: "candidate_owned_resources",
        remainingListenerCount: 0,
        remainingOwnedProcessCount: 0,
        remainingRuntimeMarkerCount: 1,
        remainingRuntimeEnvFileCount: 0,
        orphanResourceCount: 1,
      });
      const serialized = JSON.stringify(sweep);
      expect(serialized).not.toContain(markerPath);
      expect(serialized).not.toContain(sensitiveContent);
    },
  );

  it.runIf(process.platform === "win32")(
    "probes an exact Windows listener without connecting to it",
    async () => {
      const server = net.createServer();
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      try {
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("Listener fixture address missing.");

        const sweep = await collectCodingAgentCandidateOwnedResourceSweep({
          platform: "windows-native",
          inventory: {
            ...emptyResourceInventory(),
            listeners: [{ host: "127.0.0.1", port: address.port }],
          },
        }, {
          probeOwnedResources: probeCodingAgentCandidateOwnedResources,
        });

        expect(sweep).toMatchObject({
          remainingListenerCount: 1,
          orphanResourceCount: 1,
        });
        expect(JSON.stringify(sweep)).not.toContain(String(address.port));
      } finally {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
    },
  );

  it.runIf(process.platform === "win32")(
    "probes exact Windows process identifiers without searching command lines",
    async () => {
      const missingProcessId = 2_147_483_647;

      const sweep = await collectCodingAgentCandidateOwnedResourceSweep({
        platform: "windows-native",
        inventory: {
          ...emptyResourceInventory(),
          processIds: [process.pid, missingProcessId],
        },
      }, {
        probeOwnedResources: probeCodingAgentCandidateOwnedResources,
      });

      expect(sweep).toMatchObject({
        remainingOwnedProcessCount: 1,
        orphanResourceCount: 1,
      });
      const serialized = JSON.stringify(sweep);
      expect(serialized).not.toContain(String(process.pid));
      expect(serialized).not.toContain(String(missingProcessId));
    },
  );

  it.runIf(process.platform === "win32")(
    "probes real WSL2 runtime paths in the explicit distribution without reading content",
    async () => {
      const sweep = await collectCodingAgentCandidateOwnedResourceSweep({
        platform: "wsl2-linux",
        distribution: "Ubuntu-22.04",
        inventory: {
          ...emptyResourceInventory(),
          runtimeMarkers: ["/proc/self/status"],
          runtimeEnvFiles: ["/tmp/star-sanctuary-candidate-resource-missing/.env.local"],
        },
      }, {
        probeOwnedResources: probeCodingAgentCandidateOwnedResources,
      });

      expect(sweep).toMatchObject({
        remainingRuntimeMarkerCount: 1,
        remainingRuntimeEnvFileCount: 0,
        orphanResourceCount: 1,
      });
      const serialized = JSON.stringify(sweep);
      expect(serialized).not.toContain("/proc/self/status");
      expect(serialized).not.toContain(".env.local");
    },
  );

  it.runIf(process.platform === "win32")(
    "probes an exact WSL2 listener without connecting to it",
    async () => {
      const fixture = await startWslListenerFixture("Ubuntu-22.04");
      try {
        const sweep = await collectCodingAgentCandidateOwnedResourceSweep({
          platform: "wsl2-linux",
          distribution: "Ubuntu-22.04",
          inventory: {
            ...emptyResourceInventory(),
            listeners: [{ host: "127.0.0.1", port: fixture.port }],
          },
        }, {
          probeOwnedResources: probeCodingAgentCandidateOwnedResources,
        });

        expect(sweep).toMatchObject({
          remainingListenerCount: 1,
          orphanResourceCount: 1,
        });
        expect(JSON.stringify(sweep)).not.toContain(String(fixture.port));
      } finally {
        await fixture.close();
      }
    },
    15_000,
  );

  it.runIf(process.platform === "win32")(
    "probes exact WSL2 process identifiers without searching command lines",
    async () => {
      const fixture = await startWslProcessFixture("Ubuntu-22.04");
      const missingProcessId = 2_147_483_647;
      try {
        const sweep = await collectCodingAgentCandidateOwnedResourceSweep({
          platform: "wsl2-linux",
          distribution: "Ubuntu-22.04",
          inventory: {
            ...emptyResourceInventory(),
            processIds: [fixture.processId, missingProcessId],
          },
        }, {
          probeOwnedResources: probeCodingAgentCandidateOwnedResources,
        });

        expect(sweep).toMatchObject({
          remainingOwnedProcessCount: 1,
          orphanResourceCount: 1,
        });
        const serialized = JSON.stringify(sweep);
        expect(serialized).not.toContain(String(fixture.processId));
        expect(serialized).not.toContain(String(missingProcessId));
      } finally {
        await fixture.close();
      }
    },
    15_000,
  );

  it("rejects an unsupported platform before probing resources", async () => {
    let probeCallCount = 0;

    await expect(collectCodingAgentCandidateOwnedResourceSweep({
      platform: "unknown-platform",
      inventory: emptyResourceInventory(),
    }, {
      async probeOwnedResources() {
        probeCallCount += 1;
        return emptyResourceObservation();
      },
    })).rejects.toThrow(/platform.*windows-native.*wsl2-linux/i);

    expect(probeCallCount).toBe(0);
  });

  it("requires an explicit WSL2 distribution before probing resources", async () => {
    let probeCallCount = 0;

    await expect(collectCodingAgentCandidateOwnedResourceSweep({
      platform: "wsl2-linux",
      inventory: emptyResourceInventory(),
    }, {
      async probeOwnedResources() {
        probeCallCount += 1;
        return emptyResourceObservation();
      },
    })).rejects.toThrow(/WSL2.*distribution.*required/i);

    expect(probeCallCount).toBe(0);
  });

  it("rejects an observation that does not cover every inventory item", async () => {
    await expect(collectCodingAgentCandidateOwnedResourceSweep({
      platform: "windows-native",
      inventory: {
        ...emptyResourceInventory(),
        listeners: [
          { host: "127.0.0.1", port: 29255 },
          { host: "127.0.0.1", port: 29256 },
        ],
      },
    }, {
      async probeOwnedResources() {
        return {
          ...emptyResourceObservation(),
          listeners: [false],
        };
      },
    })).rejects.toThrow(/observation.*listeners.*length/i);
  });

  it("rejects a non-boolean resource observation", async () => {
    await expect(collectCodingAgentCandidateOwnedResourceSweep({
      platform: "windows-native",
      inventory: {
        ...emptyResourceInventory(),
        processIds: [42421],
      },
    }, {
      async probeOwnedResources() {
        return {
          ...emptyResourceObservation(),
          processIds: [null],
        };
      },
    })).rejects.toThrow(/observation.*processIds.*boolean/i);
  });

  it("rejects an invalid listener inventory before probing resources", async () => {
    let probeCallCount = 0;

    await expect(collectCodingAgentCandidateOwnedResourceSweep({
      platform: "windows-native",
      inventory: {
        ...emptyResourceInventory(),
        listeners: [{ host: "localhost", port: 0 }],
      },
    }, {
      async probeOwnedResources() {
        probeCallCount += 1;
        return emptyResourceObservation();
      },
    })).rejects.toThrow(/inventory.*listener.*IP.*port/i);

    expect(probeCallCount).toBe(0);
  });

  it("rejects duplicate listener inventory before probing resources", async () => {
    const listener = { host: "127.0.0.1", port: 29255 };
    let probeCallCount = 0;

    await expect(collectCodingAgentCandidateOwnedResourceSweep({
      platform: "windows-native",
      inventory: {
        ...emptyResourceInventory(),
        listeners: [listener, { ...listener }],
      },
    }, {
      async probeOwnedResources() {
        probeCallCount += 1;
        return emptyResourceObservation();
      },
    })).rejects.toThrow(/inventory.*listeners.*unique/i);

    expect(probeCallCount).toBe(0);
  });

  it("rejects an invalid process inventory before probing resources", async () => {
    let probeCallCount = 0;

    await expect(collectCodingAgentCandidateOwnedResourceSweep({
      platform: "windows-native",
      inventory: {
        ...emptyResourceInventory(),
        processIds: [0],
      },
    }, {
      async probeOwnedResources() {
        probeCallCount += 1;
        return emptyResourceObservation();
      },
    })).rejects.toThrow(/inventory.*processIds.*positive.*integer/i);

    expect(probeCallCount).toBe(0);
  });

  it("rejects a process identifier outside the signed 32-bit range", async () => {
    let probeCallCount = 0;

    await expect(collectCodingAgentCandidateOwnedResourceSweep({
      platform: "windows-native",
      inventory: {
        ...emptyResourceInventory(),
        processIds: [2_147_483_648],
      },
    }, {
      async probeOwnedResources() {
        probeCallCount += 1;
        return emptyResourceObservation();
      },
    })).rejects.toThrow(/inventory.*processIds.*32-bit/i);

    expect(probeCallCount).toBe(0);
  });

  it("rejects duplicate process inventory before probing resources", async () => {
    let probeCallCount = 0;

    await expect(collectCodingAgentCandidateOwnedResourceSweep({
      platform: "windows-native",
      inventory: {
        ...emptyResourceInventory(),
        processIds: [42421, 42421],
      },
    }, {
      async probeOwnedResources() {
        probeCallCount += 1;
        return emptyResourceObservation();
      },
    })).rejects.toThrow(/inventory.*processIds.*unique/i);

    expect(probeCallCount).toBe(0);
  });

  it("rejects a relative Windows runtime path before probing resources", async () => {
    let probeCallCount = 0;

    await expect(collectCodingAgentCandidateOwnedResourceSweep({
      platform: "windows-native",
      inventory: {
        ...emptyResourceInventory(),
        runtimeMarkers: ["candidate-runtime\\active.marker"],
      },
    }, {
      async probeOwnedResources() {
        probeCallCount += 1;
        return emptyResourceObservation();
      },
    })).rejects.toThrow(/inventory.*runtimeMarkers.*Windows.*absolute/i);

    expect(probeCallCount).toBe(0);
  });

  it("rejects a non-POSIX WSL2 runtime path before probing resources", async () => {
    let probeCallCount = 0;

    await expect(collectCodingAgentCandidateOwnedResourceSweep({
      platform: "wsl2-linux",
      inventory: {
        ...emptyResourceInventory(),
        runtimeMarkers: ["E:\\candidate-runtime\\active.marker"],
      },
    }, {
      async probeOwnedResources() {
        probeCallCount += 1;
        return emptyResourceObservation();
      },
    })).rejects.toThrow(/inventory.*runtimeMarkers.*POSIX.*absolute/i);

    expect(probeCallCount).toBe(0);
  });

  it("rejects a relative Windows runtime env path before probing resources", async () => {
    let probeCallCount = 0;

    await expect(collectCodingAgentCandidateOwnedResourceSweep({
      platform: "windows-native",
      inventory: {
        ...emptyResourceInventory(),
        runtimeEnvFiles: ["candidate-runtime\\.env.local"],
      },
    }, {
      async probeOwnedResources() {
        probeCallCount += 1;
        return emptyResourceObservation();
      },
    })).rejects.toThrow(/inventory.*runtimeEnvFiles.*Windows.*absolute/i);

    expect(probeCallCount).toBe(0);
  });

  it("rejects a non-POSIX WSL2 runtime env path before probing resources", async () => {
    let probeCallCount = 0;

    await expect(collectCodingAgentCandidateOwnedResourceSweep({
      platform: "wsl2-linux",
      inventory: {
        ...emptyResourceInventory(),
        runtimeEnvFiles: ["E:\\candidate-runtime\\.env.local"],
      },
    }, {
      async probeOwnedResources() {
        probeCallCount += 1;
        return emptyResourceObservation();
      },
    })).rejects.toThrow(/inventory.*runtimeEnvFiles.*POSIX.*absolute/i);

    expect(probeCallCount).toBe(0);
  });

  it("rejects duplicate Windows runtime paths case-insensitively", async () => {
    let probeCallCount = 0;

    await expect(collectCodingAgentCandidateOwnedResourceSweep({
      platform: "windows-native",
      inventory: {
        ...emptyResourceInventory(),
        runtimeMarkers: [
          "E:\\candidate-runtime\\active.marker",
          "e:\\candidate-runtime\\ACTIVE.marker",
        ],
      },
    }, {
      async probeOwnedResources() {
        probeCallCount += 1;
        return emptyResourceObservation();
      },
    })).rejects.toThrow(/inventory.*runtimeMarkers.*unique/i);

    expect(probeCallCount).toBe(0);
  });

  it("rejects duplicate normalized WSL2 runtime paths", async () => {
    let probeCallCount = 0;

    await expect(collectCodingAgentCandidateOwnedResourceSweep({
      platform: "wsl2-linux",
      inventory: {
        ...emptyResourceInventory(),
        runtimeMarkers: [
          "/tmp/candidate-runtime/active.marker",
          "/tmp/candidate-runtime/./active.marker",
        ],
      },
    }, {
      async probeOwnedResources() {
        probeCallCount += 1;
        return emptyResourceObservation();
      },
    })).rejects.toThrow(/inventory.*runtimeMarkers.*unique/i);

    expect(probeCallCount).toBe(0);
  });

  it("rejects a runtime path reused across marker and env inventory", async () => {
    let probeCallCount = 0;

    await expect(collectCodingAgentCandidateOwnedResourceSweep({
      platform: "windows-native",
      inventory: {
        ...emptyResourceInventory(),
        runtimeMarkers: ["E:\\candidate-runtime\\active.env"],
        runtimeEnvFiles: ["e:\\candidate-runtime\\ACTIVE.env"],
      },
    }, {
      async probeOwnedResources() {
        probeCallCount += 1;
        return emptyResourceObservation();
      },
    })).rejects.toThrow(/inventory.*runtimeMarkers.*runtimeEnvFiles.*distinct/i);

    expect(probeCallCount).toBe(0);
  });
});

function emptyResourceSweep(platform) {
  return {
    platform,
    status: "completed",
    scope: "candidate_owned_resources",
    remainingListenerCount: 0,
    remainingOwnedProcessCount: 0,
    remainingRuntimeMarkerCount: 0,
    remainingRuntimeEnvFileCount: 0,
    orphanResourceCount: 0,
  };
}

function emptyResourceInventory() {
  return {
    listeners: [],
    processIds: [],
    runtimeMarkers: [],
    runtimeEnvFiles: [],
  };
}

function emptyResourceObservation() {
  return {
    listeners: [],
    processIds: [],
    runtimeMarkers: [],
    runtimeEnvFiles: [],
  };
}

async function startWslListenerFixture(distribution) {
  const script = [
    "const net=require('node:net');",
    "const server=net.createServer();",
    "const close=()=>server.close(()=>process.exit(0));",
    "server.listen(0,'127.0.0.1',()=>{",
    "  const address=server.address();",
    "  process.stdout.write(JSON.stringify({port:address.port})+'\\n');",
    "});",
    "process.stdin.once('data',close);",
    "setTimeout(close,15000).unref();",
  ].join("");
  const child = spawn(
    "wsl.exe",
    ["--distribution", distribution, "--exec", "node", "-e", script],
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
  );
  const fixture = await readWslFixtureReady(child);
  return {
    ...fixture,
    async close() {
      if (child.exitCode !== null) return;
      child.stdin.end("close\n");
      await waitForChildExit(child);
    },
  };
}

async function startWslProcessFixture(distribution) {
  const script = [
    "const close=()=>process.exit(0);",
    "process.stdout.write(JSON.stringify({processId:process.pid})+'\\n');",
    "process.stdin.once('data',close);",
    "setTimeout(close,15000).unref();",
  ].join("");
  const child = spawn(
    "wsl.exe",
    ["--distribution", distribution, "--exec", "node", "-e", script],
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
  );
  const fixture = await readWslProcessFixtureReady(child);
  return {
    ...fixture,
    async close() {
      if (child.exitCode !== null) return;
      child.stdin.end("close\n");
      await waitForChildExit(child);
    },
  };
}

async function readWslFixtureReady(child) {
  return await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const finishError = (error) => {
      child.stdin.end();
      reject(error);
    };
    child.stderr.setEncoding("utf-8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", finishError);
    child.once("exit", (code) => {
      finishError(new Error(`WSL listener fixture exited before readiness (${code}): ${stderr}`));
    });
    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const newlineIndex = stdout.indexOf("\n");
      if (newlineIndex < 0) return;
      try {
        const ready = JSON.parse(stdout.slice(0, newlineIndex));
        if (!Number.isSafeInteger(ready.port) || ready.port < 1 || ready.port > 65_535) {
          throw new Error("WSL listener fixture returned an invalid port.");
        }
        child.removeListener("error", finishError);
        resolve({ port: ready.port });
      } catch (error) {
        finishError(error);
      }
    });
  });
}

async function readWslProcessFixtureReady(child) {
  return await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const finishError = (error) => {
      child.stdin.end();
      reject(error);
    };
    child.stderr.setEncoding("utf-8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", finishError);
    child.once("exit", (code) => {
      finishError(new Error(`WSL process fixture exited before readiness (${code}): ${stderr}`));
    });
    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const newlineIndex = stdout.indexOf("\n");
      if (newlineIndex < 0) return;
      try {
        const ready = JSON.parse(stdout.slice(0, newlineIndex));
        if (!Number.isSafeInteger(ready.processId) || ready.processId < 1) {
          throw new Error("WSL process fixture returned an invalid process identifier.");
        }
        child.removeListener("error", finishError);
        resolve({ processId: ready.processId });
      } catch (error) {
        finishError(error);
      }
    });
  });
}

async function waitForChildExit(child) {
  if (child.exitCode !== null) return;
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
}
