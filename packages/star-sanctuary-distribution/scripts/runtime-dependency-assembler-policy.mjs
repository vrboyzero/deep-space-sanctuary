function requireNonEmptyString(value, label) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new Error(`Invalid runtime dependency ${label}: ${String(value)}`);
  }
  return normalized;
}

function createSharedPnpmArgs(storeDir) {
  return [
    "--store-dir",
    requireNonEmptyString(storeDir, "store directory"),
    "--config.package-import-method=copy",
    "--child-concurrency=1",
    "--network-concurrency=1",
  ];
}

export function createRuntimeDependencyPrefetchArgs({ storeDir }) {
  const sharedArgs = createSharedPnpmArgs(storeDir);
  // Prefetch 是唯一允许解析/访问 registry 的阶段；它先产出匹配 runtime manifest 的 lockfile，再填充 store。
  const lockfileArgs = [
    "pnpm",
    "install",
    "--prod",
    "--lockfile-only",
    "--ignore-scripts",
    "--prefer-offline",
    "--no-frozen-lockfile",
    ...sharedArgs,
  ];
  const fetchArgs = [
    "pnpm",
    "fetch",
    "--prod",
    "--frozen-lockfile",
    "--prefer-offline",
    ...sharedArgs,
  ];
  return { lockfileArgs, fetchArgs };
}

export function assertFrozenOfflineInstallArgs(args) {
  if (!Array.isArray(args)) {
    throw new Error("Runtime dependency assembler install args must be an array");
  }

  const failures = [];
  if (args[0] !== "pnpm" || args[1] !== "install") failures.push("pnpm install command");
  if (!args.includes("--offline")) failures.push("--offline");
  if (!args.includes("--frozen-lockfile")) failures.push("--frozen-lockfile");
  if (args.includes("--prefer-offline")) failures.push("forbidden --prefer-offline");
  if (args.includes("--no-frozen-lockfile")) failures.push("forbidden --no-frozen-lockfile");
  if (args.includes("--lockfile=false") || args.includes("--no-lockfile")) {
    failures.push("forbidden lockfile bypass");
  }
  if (failures.length > 0) {
    throw new Error(`Runtime dependency assembler install policy violation: ${failures.join(", ")}`);
  }
  return args;
}

export function createRuntimeDependencyInstallArgs({ storeDir }) {
  const args = [
    "pnpm",
    "install",
    "--prod",
    "--offline",
    "--frozen-lockfile",
    ...createSharedPnpmArgs(storeDir),
  ];
  return assertFrozenOfflineInstallArgs(args);
}

function filterExcludedDependencyPatches(pnpm, excludedOptionalDependencies) {
  if (!pnpm || typeof pnpm !== "object" || Array.isArray(pnpm)) return pnpm;
  const excluded = new Set(excludedOptionalDependencies ?? []);
  if (excluded.size === 0 || !pnpm.patchedDependencies) return pnpm;

  const patchedDependencies = Object.fromEntries(
    Object.entries(pnpm.patchedDependencies)
      .filter(([patchKey]) => ![...excluded].some((dependency) => patchKey.startsWith(`${dependency}@`))),
  );
  const filtered = { ...pnpm };
  if (Object.keys(patchedDependencies).length > 0) {
    filtered.patchedDependencies = patchedDependencies;
  } else {
    delete filtered.patchedDependencies;
  }
  return filtered;
}

export function createRuntimeRootPackageJson({
  packageManager,
  engines,
  pnpm,
  sqliteVecVersion,
  excludedOptionalDependencies = [],
}) {
  const runtimePackageJson = {
    name: "star-sanctuary-portable-runtime",
    private: true,
    type: "module",
    packageManager: requireNonEmptyString(packageManager, "package manager"),
    engines,
    dependencies: {
      "sqlite-vec-windows-x64": requireNonEmptyString(sqliteVecVersion, "sqlite-vec version"),
    },
  };
  const runtimePnpm = filterExcludedDependencyPatches(pnpm, excludedOptionalDependencies);
  if (runtimePnpm && typeof runtimePnpm === "object" && !Array.isArray(runtimePnpm)) {
    // Lockfile settings must match the root pnpm policy, including overrides and patch identities.
    runtimePackageJson.pnpm = runtimePnpm;
  }
  return runtimePackageJson;
}

function stripRuntimeTypeExportConditions(value) {
  if (Array.isArray(value)) {
    return value.map(stripRuntimeTypeExportConditions);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const runtimeValue = {};
  for (const [key, nested] of Object.entries(value)) {
    if (key === "types") continue;
    runtimeValue[key] = stripRuntimeTypeExportConditions(nested);
  }
  return runtimeValue;
}

export function sanitizeRuntimeWorkspacePackageJson(packageJson, options = {}) {
  const sanitized = { ...packageJson };
  delete sanitized.devDependencies;
  delete sanitized.scripts;
  delete sanitized.types;
  if (sanitized.exports) {
    sanitized.exports = stripRuntimeTypeExportConditions(sanitized.exports);
  }
  const excludedOptionalDependencies = new Set(options.excludedOptionalDependencies ?? []);
  if (sanitized.optionalDependencies && excludedOptionalDependencies.size > 0) {
    sanitized.optionalDependencies = Object.fromEntries(
      Object.entries(sanitized.optionalDependencies)
        .filter(([dependency]) => !excludedOptionalDependencies.has(dependency)),
    );
    if (Object.keys(sanitized.optionalDependencies).length === 0) {
      delete sanitized.optionalDependencies;
    }
  }
  return sanitized;
}
