type RecordLike = Record<string, unknown>;

export const BELLDANDY_LEGACY_EXTENSION_HOST_API_VERSION = 1;
export const BELLDANDY_ISOLATED_EXTENSION_HOST_API_VERSION = 2;
export const BELLDANDY_EXTENSION_HOST_API_VERSION = BELLDANDY_ISOLATED_EXTENSION_HOST_API_VERSION;

export type ExtensionManifestKind = "plugin" | "skill-pack";
export type ExtensionPluginHookName = "beforeRun" | "afterRun" | "beforeToolCall" | "afterToolCall";
export type ExtensionPermission =
  | `tool:${string}`
  | `hook:${ExtensionPluginHookName}`
  | `skill:${string}`;

export interface ExtensionHostCompatibility {
  hostApi: number;
}

export interface ExtensionRuntimeDeclaration {
  capabilities: string[];
}

export type ExtensionMarketplaceSource =
  | { source: "directory"; path: string }
  | { source: "github"; repo: string; ref?: string; manifestPath?: string }
  | { source: "git"; url: string; ref?: string; manifestPath?: string }
  | { source: "url"; url: string }
  | { source: "npm"; package: string; version?: string };

export interface ExtensionManifestAuthor {
  name: string;
  email?: string;
  url?: string;
}

export interface ExtensionManifest {
  schemaVersion: 1;
  name: string;
  kind: ExtensionManifestKind;
  version: string;
  description?: string;
  author?: ExtensionManifestAuthor;
  entry: {
    pluginModule?: string;
    skillDirs?: string[];
  };
  capabilities?: {
    tools?: boolean;
    hooks?: boolean;
    skills?: boolean;
  };
  compatibility?: ExtensionHostCompatibility;
  permissions?: ExtensionPermission[];
  runtime?: ExtensionRuntimeDeclaration;
  dependencies?: string[];
}

export interface MarketplaceManifestEntry {
  name: string;
  kind: ExtensionManifestKind;
  version?: string;
  description?: string;
  manifestPath?: string;
  source: ExtensionMarketplaceSource;
}

export interface MarketplaceManifest {
  schemaVersion: 1;
  name: string;
  description?: string;
  extensions: MarketplaceManifestEntry[];
}

const NAME_PATTERN = /^[a-z0-9][-a-z0-9._]*$/i;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const EXTENSION_PLUGIN_HOOK_NAMES = new Set<ExtensionPluginHookName>([
  "beforeRun",
  "afterRun",
  "beforeToolCall",
  "afterToolCall",
]);

function isRecordLike(value: unknown): value is RecordLike {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertRecordLike(value: unknown, label: string): RecordLike {
  if (!isRecordLike(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function parseRequiredName(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  const normalized = value.trim();
  if (!NAME_PATTERN.test(normalized)) {
    throw new Error(`${label} must use kebab-case or dot/underscore-safe identifier format.`);
  }
  return normalized;
}

function parseOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  const normalized = value.trim();
  return normalized || undefined;
}

function parseVersion(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  const normalized = value.trim();
  if (!SEMVER_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a semver-like string.`);
  }
  return normalized;
}

function parseOptionalRelativePath(value: unknown, label: string): string | undefined {
  const normalized = parseOptionalString(value, label);
  if (!normalized) return undefined;
  if (normalized.startsWith("/") || normalized.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(normalized)) {
    throw new Error(`${label} must be relative, not absolute.`);
  }
  if (normalized.split(/[\\/]+/).some((part) => part === "..")) {
    throw new Error(`${label} cannot contain parent directory traversal.`);
  }
  return normalized;
}

function parseOptionalStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`${label}[${index}] must be a non-empty string.`);
    }
    return item.trim();
  });
}

function parseOptionalRelativePathArray(value: unknown, label: string): string[] | undefined {
  const values = parseOptionalStringArray(value, label);
  return values?.map((item, index) => parseOptionalRelativePath(item, `${label}[${index}]`) ?? item);
}

function parseCompatibility(value: unknown, label: string): ExtensionHostCompatibility | undefined {
  if (value === undefined) return undefined;
  const input = assertRecordLike(value, label);
  if (!Number.isSafeInteger(input.hostApi) || (input.hostApi as number) < 1) {
    throw new Error(`${label}.hostApi must be a positive integer.`);
  }
  return { hostApi: input.hostApi as number };
}

function parseRuntimeDeclaration(value: unknown, label: string): ExtensionRuntimeDeclaration | undefined {
  if (value === undefined) return undefined;
  const input = assertRecordLike(value, label);
  const capabilities = parseOptionalStringArray(input.capabilities, `${label}.capabilities`);
  if (!capabilities) {
    throw new Error(`${label}.capabilities must be an array.`);
  }
  return { capabilities };
}

export function isSupportedExtensionHostApi(kind: ExtensionManifestKind, hostApi: number): boolean {
  if (kind === "skill-pack") {
    return hostApi === BELLDANDY_LEGACY_EXTENSION_HOST_API_VERSION
      || hostApi === BELLDANDY_ISOLATED_EXTENSION_HOST_API_VERSION;
  }
  return hostApi === BELLDANDY_LEGACY_EXTENSION_HOST_API_VERSION
    || hostApi === BELLDANDY_ISOLATED_EXTENSION_HOST_API_VERSION;
}

export function parseExtensionPermissions(
  value: unknown,
  label = "Extension permissions",
): ExtensionPermission[] | undefined {
  const values = parseOptionalStringArray(value, label);
  if (!values) return undefined;

  return values.map<ExtensionPermission>((permission, index) => {
    const separatorIndex = permission.indexOf(":");
    const kind = permission.slice(0, separatorIndex);
    const target = permission.slice(separatorIndex + 1);
    if (!kind || !target) {
      throw new Error(`${label}[${index}] must use a supported permission prefix.`);
    }

    if (kind === "tool") {
      return `tool:${parseRequiredName(target, `${label}[${index}] tool name`)}` as ExtensionPermission;
    }
    if (kind === "hook" && EXTENSION_PLUGIN_HOOK_NAMES.has(target as ExtensionPluginHookName)) {
      return `hook:${target as ExtensionPluginHookName}`;
    }
    if (kind === "skill") {
      const skillDir = parseOptionalRelativePath(target, `${label}[${index}] skill directory`);
      if (!skillDir) {
        throw new Error(`${label}[${index}] skill directory is required.`);
      }
      return `skill:${skillDir.replace(/\\/g, "/")}` as ExtensionPermission;
    }
    throw new Error(`${label}[${index}] must use a supported permission prefix.`);
  });
}

function parseManifestKind(value: unknown, label: string): ExtensionManifestKind {
  if (value === "plugin" || value === "skill-pack") return value;
  throw new Error(`${label} must be "plugin" or "skill-pack".`);
}

export function parseExtensionMarketplaceSource(value: unknown, label = "Marketplace source"): ExtensionMarketplaceSource {
  const input = assertRecordLike(value, label);
  const source = parseOptionalString(input.source, `${label}.source`);

  switch (source) {
    case "directory":
      return {
        source,
        path: parseOptionalString(input.path, `${label}.path`) ?? (() => {
          throw new Error(`${label}.path is required.`);
        })(),
      };
    case "github":
      return {
        source,
        repo: parseOptionalString(input.repo, `${label}.repo`) ?? (() => {
          throw new Error(`${label}.repo is required.`);
        })(),
        ref: parseOptionalString(input.ref, `${label}.ref`),
        manifestPath: parseOptionalRelativePath(input.manifestPath, `${label}.manifestPath`),
      };
    case "git":
      return {
        source,
        url: parseOptionalString(input.url, `${label}.url`) ?? (() => {
          throw new Error(`${label}.url is required.`);
        })(),
        ref: parseOptionalString(input.ref, `${label}.ref`),
        manifestPath: parseOptionalRelativePath(input.manifestPath, `${label}.manifestPath`),
      };
    case "url":
      return {
        source,
        url: parseOptionalString(input.url, `${label}.url`) ?? (() => {
          throw new Error(`${label}.url is required.`);
        })(),
      };
    case "npm":
      return {
        source,
        package: parseOptionalString(input.package, `${label}.package`) ?? (() => {
          throw new Error(`${label}.package is required.`);
        })(),
        version: parseOptionalString(input.version, `${label}.version`),
      };
    default:
      throw new Error(`${label}.source is invalid or unsupported.`);
  }
}

function parseAuthor(value: unknown, label: string): ExtensionManifestAuthor | undefined {
  if (value === undefined) return undefined;
  const input = assertRecordLike(value, label);
  return {
    name: parseOptionalString(input.name, `${label}.name`) ?? (() => {
      throw new Error(`${label}.name is required.`);
    })(),
    email: parseOptionalString(input.email, `${label}.email`),
    url: parseOptionalString(input.url, `${label}.url`),
  };
}

export function isValidMarketplaceName(value: string): boolean {
  return NAME_PATTERN.test(value);
}

export function isValidExtensionName(value: string): boolean {
  return NAME_PATTERN.test(value);
}

export function formatExtensionId(name: string, marketplace: string): string {
  return `${name}@${marketplace}`;
}

export function parseExtensionManifest(input: unknown): ExtensionManifest {
  const manifest = assertRecordLike(input, "Extension manifest");
  const schemaVersion = manifest.schemaVersion === undefined ? 1 : manifest.schemaVersion;
  if (schemaVersion !== 1) {
    throw new Error("Extension manifest schemaVersion must be 1.");
  }

  const kind = parseManifestKind(manifest.kind, "Extension manifest.kind");
  const entry = assertRecordLike(manifest.entry, "Extension manifest.entry");
  const pluginModule = parseOptionalRelativePath(entry.pluginModule, "Extension manifest.entry.pluginModule");
  const skillDirs = parseOptionalRelativePathArray(entry.skillDirs, "Extension manifest.entry.skillDirs");

  if (kind === "plugin" && !pluginModule) {
    throw new Error("Plugin manifest requires entry.pluginModule.");
  }
  if (kind === "skill-pack" && (!skillDirs || skillDirs.length === 0)) {
    throw new Error("Skill-pack manifest requires at least one entry.skillDirs item.");
  }

  const capabilities = manifest.capabilities === undefined
    ? undefined
    : (() => {
      const inputCapabilities = assertRecordLike(manifest.capabilities, "Extension manifest.capabilities");
      return {
        tools: inputCapabilities.tools === undefined ? undefined : Boolean(inputCapabilities.tools),
        hooks: inputCapabilities.hooks === undefined ? undefined : Boolean(inputCapabilities.hooks),
        skills: inputCapabilities.skills === undefined ? undefined : Boolean(inputCapabilities.skills),
      };
    })();
  const compatibility = parseCompatibility(manifest.compatibility, "Extension manifest.compatibility");
  const permissions = parseExtensionPermissions(manifest.permissions, "Extension manifest.permissions");
  const runtime = parseRuntimeDeclaration(manifest.runtime, "Extension manifest.runtime");

  return {
    schemaVersion: 1,
    name: parseRequiredName(manifest.name, "Extension manifest.name"),
    kind,
    version: parseVersion(manifest.version, "Extension manifest.version"),
    description: parseOptionalString(manifest.description, "Extension manifest.description"),
    author: parseAuthor(manifest.author, "Extension manifest.author"),
    entry: {
      pluginModule,
      skillDirs,
    },
    capabilities,
    ...(compatibility ? { compatibility } : {}),
    ...(permissions ? { permissions } : {}),
    ...(runtime ? { runtime } : {}),
    dependencies: parseOptionalStringArray(manifest.dependencies, "Extension manifest.dependencies"),
  };
}

export function parseMarketplaceManifest(input: unknown): MarketplaceManifest {
  const manifest = assertRecordLike(input, "Marketplace manifest");
  const schemaVersion = manifest.schemaVersion === undefined ? 1 : manifest.schemaVersion;
  if (schemaVersion !== 1) {
    throw new Error("Marketplace manifest schemaVersion must be 1.");
  }
  if (!Array.isArray(manifest.extensions)) {
    throw new Error("Marketplace manifest.extensions must be an array.");
  }

  return {
    schemaVersion: 1,
    name: parseRequiredName(manifest.name, "Marketplace manifest.name"),
    description: parseOptionalString(manifest.description, "Marketplace manifest.description"),
    extensions: manifest.extensions.map((item, index) => {
      const entry = assertRecordLike(item, `Marketplace manifest.extensions[${index}]`);
      return {
        name: parseRequiredName(entry.name, `Marketplace manifest.extensions[${index}].name`),
        kind: parseManifestKind(entry.kind, `Marketplace manifest.extensions[${index}].kind`),
        version: entry.version === undefined
          ? undefined
          : parseVersion(entry.version, `Marketplace manifest.extensions[${index}].version`),
        description: parseOptionalString(entry.description, `Marketplace manifest.extensions[${index}].description`),
        manifestPath: parseOptionalRelativePath(entry.manifestPath, `Marketplace manifest.extensions[${index}].manifestPath`),
        source: parseExtensionMarketplaceSource(entry.source, `Marketplace manifest.extensions[${index}].source`),
      } satisfies MarketplaceManifestEntry;
    }),
  };
}
