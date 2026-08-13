import type {
  CodingRunCapabilityName,
  CodingRunCapabilityRequirements,
} from "@belldandy/protocol";

const CAPABILITY_NAMES = new Set<CodingRunCapabilityName>([
  "tools",
  "languageToolchain",
  "sandbox",
  "approvalChannel",
  "worktree",
  "journal",
  "trace",
  "verifier",
  "mcp",
  "plugin",
  "skill",
]);
const ALLOWED_KEYS = new Set(["schemaVersion", "capabilities", "tools", "mcpServers", "plugins", "skills"]);
const MAX_IDENTIFIERS = 64;
const MAX_IDENTIFIER_LENGTH = 160;

export type CodingRunCapabilityRequirementsParseResult =
  | { ok: true; value: CodingRunCapabilityRequirements }
  | { ok: false; message: string };

/** 严格解析无正文的 capability requirement v1，拒绝未知字段。 */
export function parseCodingRunCapabilityRequirements(
  value: unknown,
): CodingRunCapabilityRequirementsParseResult {
  if (!isRecord(value)) {
    return failure("codingRun.requiredCapabilities must be an object");
  }
  const unknownKey = Object.keys(value).find((key) => !ALLOWED_KEYS.has(key));
  if (unknownKey) {
    return failure(`codingRun.requiredCapabilities.${unknownKey} is not supported`);
  }
  if (value.schemaVersion !== 1) {
    return failure("codingRun.requiredCapabilities.schemaVersion must be 1");
  }

  const capabilities = parseCapabilityNames(value.capabilities);
  if (!capabilities.ok) return capabilities;
  const tools = parseIdentifiers(value.tools, "tools");
  if (!tools.ok) return tools;
  const mcpServers = parseIdentifiers(value.mcpServers, "mcpServers");
  if (!mcpServers.ok) return mcpServers;
  const plugins = parseIdentifiers(value.plugins, "plugins");
  if (!plugins.ok) return plugins;
  const skills = parseIdentifiers(value.skills, "skills");
  if (!skills.ok) return skills;

  const requiredNames = new Set(capabilities.value);
  for (const [name, ids] of [
    ["tools", tools.value],
    ["mcp", mcpServers.value],
    ["plugin", plugins.value],
    ["skill", skills.value],
  ] as const) {
    if (requiredNames.has(name) && !ids) {
      return failure(`codingRun.requiredCapabilities.${name} requires at least one exact id`);
    }
  }
  if (!capabilities.value && !tools.value && !mcpServers.value && !plugins.value && !skills.value) {
    return failure("codingRun.requiredCapabilities must declare at least one capability or exact id");
  }

  return {
    ok: true,
    value: {
      schemaVersion: 1,
      ...(capabilities.value ? { capabilities: capabilities.value } : {}),
      ...(tools.value ? { tools: tools.value } : {}),
      ...(mcpServers.value ? { mcpServers: mcpServers.value } : {}),
      ...(plugins.value ? { plugins: plugins.value } : {}),
      ...(skills.value ? { skills: skills.value } : {}),
    },
  };
}

function parseCapabilityNames(
  value: unknown,
): { ok: true; value?: CodingRunCapabilityName[] } | { ok: false; message: string } {
  if (value === undefined) return { ok: true };
  if (!Array.isArray(value) || value.length === 0 || value.length > CAPABILITY_NAMES.size) {
    return failure("codingRun.requiredCapabilities.capabilities must contain 1-11 capability names");
  }
  const normalized: CodingRunCapabilityName[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !CAPABILITY_NAMES.has(item as CodingRunCapabilityName)) {
      return failure("codingRun.requiredCapabilities.capabilities contains an unknown capability name");
    }
    normalized.push(item as CodingRunCapabilityName);
  }
  return { ok: true, value: [...new Set(normalized)] };
}

function parseIdentifiers(
  value: unknown,
  field: "tools" | "mcpServers" | "plugins" | "skills",
): { ok: true; value?: string[] } | { ok: false; message: string } {
  if (value === undefined) return { ok: true };
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_IDENTIFIERS) {
    return failure(`codingRun.requiredCapabilities.${field} must contain 1-${MAX_IDENTIFIERS} exact ids`);
  }
  const normalized: string[] = [];
  for (const item of value) {
    const id = typeof item === "string" ? item.trim() : "";
    if (!id || id.length > MAX_IDENTIFIER_LENGTH || /[\u0000-\u001f\u007f]/.test(id)) {
      return failure(`codingRun.requiredCapabilities.${field} contains an invalid id`);
    }
    normalized.push(id);
  }
  return { ok: true, value: [...new Set(normalized)] };
}

function failure(message: string): { ok: false; message: string } {
  return { ok: false, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
