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

function appendOptionalDependencyPolicy(args, includeOptionalNative) {
  if (!includeOptionalNative) {
    args.push("--no-optional");
  }
  return args;
}

export function createRuntimeDependencyPrefetchArgs({ includeOptionalNative, storeDir }) {
  const sharedArgs = createSharedPnpmArgs(storeDir);
  // Prefetch 是唯一允许解析/访问 registry 的阶段；它先产出匹配 runtime manifest 的 lockfile，再填充 store。
  const lockfileArgs = appendOptionalDependencyPolicy([
    "pnpm",
    "install",
    "--prod",
    "--lockfile-only",
    "--ignore-scripts",
    "--prefer-offline",
    "--no-frozen-lockfile",
    ...sharedArgs,
  ], includeOptionalNative);
  const fetchArgs = appendOptionalDependencyPolicy([
    "pnpm",
    "fetch",
    "--prod",
    "--frozen-lockfile",
    "--prefer-offline",
    ...sharedArgs,
  ], includeOptionalNative);
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

export function createRuntimeDependencyInstallArgs({ includeOptionalNative, storeDir }) {
  const args = appendOptionalDependencyPolicy([
    "pnpm",
    "install",
    "--prod",
    "--offline",
    "--frozen-lockfile",
    ...createSharedPnpmArgs(storeDir),
  ], includeOptionalNative);
  return assertFrozenOfflineInstallArgs(args);
}

export function createRuntimeRootPackageJson({ packageManager, engines, pnpm, sqliteVecVersion }) {
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
  if (pnpm && typeof pnpm === "object" && !Array.isArray(pnpm)) {
    // Lockfile settings must match the root pnpm policy, including overrides and patch identities.
    runtimePackageJson.pnpm = pnpm;
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

export function sanitizeRuntimeWorkspacePackageJson(packageJson) {
  const sanitized = { ...packageJson };
  delete sanitized.devDependencies;
  delete sanitized.scripts;
  delete sanitized.types;
  if (sanitized.exports) {
    sanitized.exports = stripRuntimeTypeExportConditions(sanitized.exports);
  }
  return sanitized;
}
