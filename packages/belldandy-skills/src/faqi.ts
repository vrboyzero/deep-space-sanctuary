import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const FAQI_DIRNAME = "faqis";
export const FAQI_STATE_FILENAME = "faqis-state.json";

export type FaqiDefinition = {
  name: string;
  title?: string;
  purpose?: string;
  toolNames: string[];
  filePath: string;
};

export type FaqiLoadIssue = {
  name: string;
  filePath: string;
  message: string;
};

export type FaqiState = {
  agents?: Record<string, { currentFaqi?: string }>;
};

export type FaqiResolution = {
  currentFaqi?: string;
  activeFaqi?: FaqiDefinition;
  toolWhitelist?: string[];
  source: "faqi" | "toolWhitelist";
};

function normalizeToolNames(value: Iterable<string> | undefined): string[] | undefined {
  if (!value) return undefined;
  const normalized = Array.from(new Set(
    Array.from(value)
      .map((item) => item.trim())
      .filter(Boolean),
  ));
  return normalized.length > 0 ? normalized : undefined;
}

export function resolveFaqiDir(stateDir: string): string {
  return path.join(stateDir, FAQI_DIRNAME);
}

export function resolveFaqiStatePath(stateDir: string): string {
  return path.join(stateDir, FAQI_STATE_FILENAME);
}

export function resolveFaqiAgentId(agentId?: string): string {
  return typeof agentId === "string" && agentId.trim() ? agentId.trim() : "default";
}

export function normalizeFaqiName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.includes("/") || normalized.includes("\\") || normalized.includes("..")) {
    return undefined;
  }
  return normalized;
}

export function resolveFaqiFilePath(stateDir: string, faqiName: string): string {
  return path.join(resolveFaqiDir(stateDir), `${faqiName}.md`);
}

export function parseFaqiMarkdown(input: {
  name: string;
  content: string;
  filePath: string;
}): FaqiDefinition {
  const lines = input.content.split(/\r?\n/);
  const title = lines.find((line) => /^#\s+/.test(line))?.replace(/^#\s+/, "").trim() || undefined;
  const purpose = lines
    .map((line) => line.trim())
    .find((line) => /^用途[:：]/.test(line))
    ?.replace(/^用途[:：]\s*/, "")
    .trim() || undefined;

  let toolsStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+tools\s*$/i.test(lines[i].trim())) {
      toolsStart = i + 1;
      break;
    }
  }

  if (toolsStart === -1) {
    throw new Error("FAQI 文件缺少 `## tools` 段");
  }

  const tools: string[] = [];
  for (let i = toolsStart; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (/^#\s*=+.*=+\s*$/.test(line)) {
      continue;
    }
    if (/^#{1,6}\s+/.test(line)) {
      break;
    }
    if (!/^[-*]\s+/.test(line)) {
      continue;
    }
    const toolName = line.replace(/^[-*]\s+/, "").trim();
    if (toolName) {
      tools.push(toolName);
    }
  }

  const toolNames = normalizeToolNames(tools);
  if (!toolNames || toolNames.length === 0) {
    throw new Error("FAQI 文件未声明任何工具");
  }

  return {
    name: input.name,
    title,
    purpose,
    toolNames,
    filePath: input.filePath,
  };
}

export async function ensureFaqiDir(stateDir: string): Promise<string> {
  const dir = resolveFaqiDir(stateDir);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function loadFaqiDefinitions(stateDir: string): Promise<{
  definitions: FaqiDefinition[];
  issues: FaqiLoadIssue[];
}> {
  const faqiDir = resolveFaqiDir(stateDir);
  try {
    const entries = await fs.readdir(faqiDir, { withFileTypes: true });
    const definitions: FaqiDefinition[] = [];
    const issues: FaqiLoadIssue[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) {
        continue;
      }
      const name = entry.name.slice(0, -3);
      const filePath = path.join(faqiDir, entry.name);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        definitions.push(parseFaqiMarkdown({ name, content, filePath }));
      } catch (err) {
        issues.push({
          name,
          filePath,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    definitions.sort((left, right) => left.name.localeCompare(right.name));
    issues.sort((left, right) => left.name.localeCompare(right.name));
    return { definitions, issues };
  } catch {
    return { definitions: [], issues: [] };
  }
}

export async function loadFaqiDefinitionByName(stateDir: string, faqiName: string): Promise<FaqiDefinition | undefined> {
  const normalized = normalizeFaqiName(faqiName);
  if (!normalized) {
    throw new Error("FAQI 名称包含非法字符");
  }

  const filePath = resolveFaqiFilePath(stateDir, normalized);
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return parseFaqiMarkdown({ name: normalized, content, filePath });
  } catch (err) {
    if ((err as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return undefined;
    }
    throw err;
  }
}

export async function readFaqiState(stateDir: string): Promise<FaqiState> {
  const statePath = resolveFaqiStatePath(stateDir);
  try {
    const raw = await fs.readFile(statePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const record = parsed as Record<string, unknown>;
    const agents = record.agents;
    if (!agents || typeof agents !== "object" || Array.isArray(agents)) {
      return {};
    }

    const normalizedAgents: Record<string, { currentFaqi?: string }> = {};
    for (const [agentId, value] of Object.entries(agents as Record<string, unknown>)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        continue;
      }
      const currentFaqi = normalizeFaqiName((value as Record<string, unknown>).currentFaqi);
      normalizedAgents[resolveFaqiAgentId(agentId)] = currentFaqi ? { currentFaqi } : {};
    }
    return { agents: normalizedAgents };
  } catch {
    return {};
  }
}

export async function writeFaqiState(stateDir: string, state: FaqiState): Promise<void> {
  const statePath = resolveFaqiStatePath(stateDir);
  const dir = path.dirname(statePath);
  await fs.mkdir(dir, { recursive: true });

  const payload: FaqiState = {};
  if (state.agents && Object.keys(state.agents).length > 0) {
    const normalizedAgents: Record<string, { currentFaqi?: string }> = {};
    for (const [agentId, value] of Object.entries(state.agents)) {
      const resolvedAgentId = resolveFaqiAgentId(agentId);
      const currentFaqi = normalizeFaqiName(value?.currentFaqi);
      normalizedAgents[resolvedAgentId] = currentFaqi ? { currentFaqi } : {};
    }
    payload.agents = normalizedAgents;
  }

  const tmpPath = `${statePath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(payload, null, 2), "utf-8");
  await fs.rename(tmpPath, statePath);
}

export function getCurrentFaqiForAgent(state: FaqiState, agentId?: string): string | undefined {
  const resolvedAgentId = resolveFaqiAgentId(agentId);
  return normalizeFaqiName(state.agents?.[resolvedAgentId]?.currentFaqi);
}

export function setCurrentFaqiForAgent(state: FaqiState, agentId: string, faqiName: string): FaqiState {
  const resolvedAgentId = resolveFaqiAgentId(agentId);
  const normalizedFaqiName = normalizeFaqiName(faqiName);
  if (!normalizedFaqiName) {
    throw new Error("FAQI 名称包含非法字符");
  }
  return {
    agents: {
      ...(state.agents ?? {}),
      [resolvedAgentId]: { currentFaqi: normalizedFaqiName },
    },
  };
}

export function indexFaqiDefinitions(definitions: FaqiDefinition[]): Map<string, FaqiDefinition> {
  return new Map(definitions.map((definition) => [definition.name, definition]));
}

export function resolveToolWhitelistFromFaqi(input: {
  agentId?: string;
  state: FaqiState;
  definitions: Map<string, FaqiDefinition>;
  fallbackToolWhitelist?: string[];
}): FaqiResolution {
  const currentFaqi = getCurrentFaqiForAgent(input.state, input.agentId);
  const fallbackToolWhitelist = normalizeToolNames(input.fallbackToolWhitelist);
  if (!currentFaqi) {
    return {
      toolWhitelist: fallbackToolWhitelist,
      source: "toolWhitelist",
    };
  }

  const activeFaqi = input.definitions.get(currentFaqi);
  if (!activeFaqi) {
    return {
      currentFaqi,
      toolWhitelist: fallbackToolWhitelist,
      source: "toolWhitelist",
    };
  }

  return {
    currentFaqi,
    activeFaqi,
    toolWhitelist: activeFaqi.toolNames,
    source: "faqi",
  };
}
