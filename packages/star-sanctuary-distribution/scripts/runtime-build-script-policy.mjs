import { spawnSync } from "node:child_process";

export const RUNTIME_BUILD_SCRIPT_POLICY_SCHEMA_VERSION = "runtime-build-script-policy/v1";

const BUILD_SCRIPT_DECISIONS = [
  {
    dependency: "better-sqlite3",
    slim: "allow",
    full: "allow",
    workspace: "allow",
    reason: "Every runtime requires the native SQLite memory backend.",
  },
  {
    dependency: "esbuild",
    slim: "allow",
    full: "allow",
    workspace: "allow",
    reason: "Gateway runtime configuration loading requires the packaged esbuild binary.",
  },
  {
    dependency: "node-pty",
    slim: "ignore",
    full: "allow",
    workspace: "allow",
    reason: "Slim uses child_process fallback; full requires the native PTY backend.",
  },
  {
    dependency: "onnxruntime-node",
    slim: "ignore",
    full: "allow",
    workspace: "ignore",
    reason: "Slim excludes local embeddings; full requires the ONNX native runtime.",
  },
  {
    dependency: "protobufjs",
    slim: "ignore",
    full: "ignore",
    workspace: "ignore",
    reason: "The published protobufjs runtime is loadable without its informational postinstall script.",
  },
];

function normalizeMode(mode) {
  if (mode !== "slim" && mode !== "full" && mode !== "workspace") {
    throw new Error(`Invalid runtime build script policy mode: ${String(mode)}`);
  }
  return mode;
}

function normalizeDependencyList(values, label) {
  if (!Array.isArray(values)) {
    throw new Error(`Runtime build script ${label} must be an array`);
  }
  const normalized = values.map((value) => {
    const dependency = typeof value === "string" ? value.trim() : "";
    if (!dependency) {
      throw new Error(`Invalid runtime build script ${label} dependency: ${String(value)}`);
    }
    return dependency;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`Runtime build script ${label} contains duplicate dependencies`);
  }
  return normalized.sort((a, b) => a.localeCompare(b));
}

export function createRuntimeBuildScriptPolicy(modeInput) {
  const mode = normalizeMode(modeInput);
  const decisions = BUILD_SCRIPT_DECISIONS
    .map((entry) => ({
      dependency: entry.dependency,
      action: entry[mode],
      reason: entry.reason,
    }))
    .sort((a, b) => a.dependency.localeCompare(b.dependency));
  return {
    schemaVersion: RUNTIME_BUILD_SCRIPT_POLICY_SCHEMA_VERSION,
    mode,
    onlyBuiltDependencies: decisions
      .filter((entry) => entry.action === "allow")
      .map((entry) => entry.dependency),
    ignoredBuiltDependencies: decisions
      .filter((entry) => entry.action === "ignore")
      .map((entry) => entry.dependency),
    decisions,
  };
}

export function assertRuntimeBuildScriptPolicy({
  mode,
  onlyBuiltDependencies,
  ignoredBuiltDependencies,
}) {
  const actualAllowed = normalizeDependencyList(onlyBuiltDependencies, "allow list");
  const actualIgnored = normalizeDependencyList(ignoredBuiltDependencies, "ignore list");
  const overlap = actualAllowed.filter((dependency) => actualIgnored.includes(dependency));
  if (overlap.length > 0) {
    throw new Error(`Runtime build script allow/ignore overlap: ${overlap.join(", ")}`);
  }

  const expected = createRuntimeBuildScriptPolicy(mode);
  const missingAllowed = expected.onlyBuiltDependencies.filter(
    (dependency) => !actualAllowed.includes(dependency),
  );
  const unexpectedAllowed = actualAllowed.filter(
    (dependency) => !expected.onlyBuiltDependencies.includes(dependency),
  );
  const missingIgnored = expected.ignoredBuiltDependencies.filter(
    (dependency) => !actualIgnored.includes(dependency),
  );
  const forbiddenIgnored = actualIgnored.filter(
    (dependency) => expected.onlyBuiltDependencies.includes(dependency),
  );
  const unexpectedIgnored = actualIgnored.filter(
    (dependency) => !expected.ignoredBuiltDependencies.includes(dependency)
      && !forbiddenIgnored.includes(dependency),
  );

  const failures = [];
  if (missingAllowed.length > 0) failures.push(`required allow: ${missingAllowed.join(", ")}`);
  if (unexpectedAllowed.length > 0) failures.push(`undeclared allow: ${unexpectedAllowed.join(", ")}`);
  if (missingIgnored.length > 0) failures.push(`required ignore: ${missingIgnored.join(", ")}`);
  if (forbiddenIgnored.length > 0) failures.push(`forbidden ignore: ${forbiddenIgnored.join(", ")}`);
  if (unexpectedIgnored.length > 0) failures.push(`undeclared ignore: ${unexpectedIgnored.join(", ")}`);
  if (failures.length > 0) {
    throw new Error(`Runtime build script policy mismatch for mode=${expected.mode}: ${failures.join("; ")}`);
  }

  return {
    ...expected,
    onlyBuiltDependencies: actualAllowed,
    ignoredBuiltDependencies: actualIgnored,
  };
}

function readPnpmDependencyList(cwd, setting) {
  const result = spawnSync("corepack", ["pnpm", "config", "get", setting, "--json"], {
    cwd,
    encoding: "utf-8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`Unable to read pnpm ${setting} for runtime build script policy`);
  }
  try {
    const parsed = JSON.parse(result.stdout);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    return parsed;
  } catch {
    throw new Error(`Invalid pnpm ${setting} JSON for runtime build script policy`);
  }
}

export function resolveRuntimeBuildScriptPolicy({ cwd, mode }) {
  return assertRuntimeBuildScriptPolicy({
    mode,
    onlyBuiltDependencies: readPnpmDependencyList(cwd, "only-built-dependencies"),
    ignoredBuiltDependencies: readPnpmDependencyList(cwd, "ignored-built-dependencies"),
  });
}
