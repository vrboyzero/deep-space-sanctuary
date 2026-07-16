import type { Tool } from "./types.js";
import {
  getToolContract,
  type ToolContractChannel,
  type ToolContractSafeScope,
} from "./tool-contract.js";
import {
  evaluateToolContractAccess,
  type ToolContractAccessPolicy,
} from "./security-matrix.js";

export interface ToolPoolAssemblyContext extends ToolContractAccessPolicy {
  includeToolsWithoutContract?: boolean;
  channel?: ToolContractChannel;
  enabledGroups?: Iterable<string>;
  allowedSafeScopes?: Iterable<ToolContractSafeScope>;
  flags?: Record<string, boolean>;
  /** Gateway startup treats a missing contract as a configuration error. */
  requireToolContracts?: boolean;
}

type ToolEntryValue = Tool | readonly Tool[];

type ToolEntryFactory = (
  context: ToolPoolAssemblyContext,
) => ToolEntryValue | Promise<ToolEntryValue>;

export interface ToolPoolEntry {
  tool?: Tool;
  tools?: readonly Tool[];
  factory?: ToolEntryFactory;
  group?: string;
  when?: (context: ToolPoolAssemblyContext) => boolean;
}

function isGroupEnabled(
  group: string | undefined,
  enabledGroups?: Iterable<string>,
): boolean {
  if (!group) {
    return true;
  }

  if (!enabledGroups) {
    return true;
  }

  const groups = new Set(
    Array.from(enabledGroups, (item) => item.trim().toLowerCase()),
  );

  return groups.has("all") || groups.has(group.toLowerCase());
}

function isToolAllowedByContract(
  tool: Tool,
  context: ToolPoolAssemblyContext,
): boolean {
  return evaluateToolContractAccess(tool, context).allowed;
}

async function resolveEntryTools(
  entry: ToolPoolEntry,
  context: ToolPoolAssemblyContext,
): Promise<Tool[]> {
  if (entry.tool) {
    return [entry.tool];
  }

  if (entry.tools) {
    return [...entry.tools];
  }

  if (entry.factory) {
    const resolved = await entry.factory(context);
    return Array.isArray(resolved) ? [...resolved] : [resolved as Tool];
  }

  return [];
}

export class ToolPoolAssembler {
  readonly #entries: readonly ToolPoolEntry[];

  constructor(entries: readonly ToolPoolEntry[]) {
    this.#entries = entries;
  }

  async assemble(context: ToolPoolAssemblyContext = {}): Promise<Tool[]> {
    const deduped = new Map<string, Tool>();

    for (const entry of this.#entries) {
      if (!isGroupEnabled(entry.group, context.enabledGroups)) {
        continue;
      }

      if (entry.when && !entry.when(context)) {
        continue;
      }

      const tools = await resolveEntryTools(entry, context);
      for (const tool of tools) {
        if (context.requireToolContracts && !getToolContract(tool)) {
          throw new Error(`Tool pool contains an ungoverned tool: ${tool.definition.name}`);
        }
        if (!isToolAllowedByContract(tool, context)) {
          continue;
        }
        if (deduped.has(tool.definition.name)) {
          throw new Error(`Duplicate tool in pool: ${tool.definition.name}`);
        }
        deduped.set(tool.definition.name, tool);
      }
    }

    return [...deduped.values()];
  }
}
