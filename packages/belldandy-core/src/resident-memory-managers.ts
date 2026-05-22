import fs from "node:fs";
import path from "node:path";

import { buildDefaultProfile, isResidentAgentProfile, type AgentRegistry, type AgentProfile } from "@belldandy/agent";
import {
  MemoryManager,
  registerGlobalMemoryManager,
  registerGlobalMemoryManagerResolver,
  type MemoryManagerOptions,
} from "@belldandy/memory";

import { resolveMemoryIndexPaths } from "./memory-index-paths.js";
import {
  resolveResidentMemoryPolicy,
  resolveResidentSharedStateDir,
  type ResolvedResidentMemoryPolicy,
} from "./resident-memory-policy.js";

type SharedMemoryManagerOptions = Omit<
  MemoryManagerOptions,
  "workspaceRoot" | "additionalRoots" | "additionalFiles" | "storePath" | "modelsDir" | "stateDir"
> & {
  stateDir: string;
  modelsDir: string;
  agentRegistry?: AgentRegistry;
  includeTeamSharedMemory?: boolean;
  teamSharedStateDir?: string;
};

export type ScopedMemoryManagerRecord = {
  agentId: string;
  stateDir: string;
  memoryMode: "shared" | "isolated" | "hybrid";
  policy: ResolvedResidentMemoryPolicy;
  manager: MemoryManager;
};

function createMemoryManagerForStateDir(
  managerStateDir: string,
  options: Omit<SharedMemoryManagerOptions, "stateDir"> & { includeTeamSharedMemory?: boolean },
): MemoryManager {
  const memoryIndexPaths = resolveMemoryIndexPaths(managerStateDir, {
    includeTeamSharedMemory: options.includeTeamSharedMemory,
    teamSharedStateDir: options.teamSharedStateDir,
  });
  fs.mkdirSync(memoryIndexPaths.sessionsDir, { recursive: true });
  fs.mkdirSync(path.join(managerStateDir, "memory"), { recursive: true });

  return new MemoryManager({
    ...options,
    workspaceRoot: memoryIndexPaths.sessionsDir,
    additionalRoots: memoryIndexPaths.additionalRoots,
    additionalFiles: memoryIndexPaths.additionalFiles,
    storePath: path.join(managerStateDir, "memory.sqlite"),
    modelsDir: options.modelsDir,
    stateDir: managerStateDir,
  });
}

export function createScopedMemoryManagers(options: SharedMemoryManagerOptions): {
  defaultManager: MemoryManager;
  records: ScopedMemoryManagerRecord[];
} {
  const records: ScopedMemoryManagerRecord[] = [];
  const managersByStateDir = new Map<string, MemoryManager>();

  function resolveRegisteredManager(policy: ResolvedResidentMemoryPolicy): MemoryManager {
    const cached = managersByStateDir.get(policy.managerStateDir);
    if (cached) {
      return cached;
    }
    const manager = createMemoryManagerForStateDir(policy.managerStateDir, {
      ...options,
      includeTeamSharedMemory: policy.includeSharedMemoryReads,
      teamSharedStateDir: policy.sharedStateDir,
    });
    managersByStateDir.set(policy.managerStateDir, manager);
    return manager;
  }

  function registerLazySharedLayerManager(sharedStateDir: string): void {
    registerGlobalMemoryManagerResolver(() => {
      const cached = managersByStateDir.get(sharedStateDir);
      if (cached) {
        return cached;
      }

      const manager = createMemoryManagerForStateDir(sharedStateDir, {
        ...options,
        includeTeamSharedMemory: false,
      });
      managersByStateDir.set(sharedStateDir, manager);
      registerGlobalMemoryManager(manager, {
        workspaceRoot: sharedStateDir,
      });
      return manager;
    }, {
      workspaceRoot: sharedStateDir,
    });
  }

  function registerResidentManager(profile: AgentProfile, isDefault = false): MemoryManager {
    const policy = resolveResidentMemoryPolicy(options.stateDir, profile);
    const manager = resolveRegisteredManager(policy);
    registerGlobalMemoryManager(manager, {
      agentId: profile.id,
      workspaceRoot: policy.managerStateDir,
      ...(isDefault ? { isDefault: true } : {}),
    });
    records.push({
      agentId: profile.id,
      stateDir: policy.managerStateDir,
      memoryMode: policy.memoryMode,
      policy,
      manager,
    });
    return manager;
  }

  function registerLazyResidentManager(profile: AgentProfile): void {
    const policy = resolveResidentMemoryPolicy(options.stateDir, profile);
    registerLazySharedLayerManager(policy.sharedStateDir);
    registerGlobalMemoryManagerResolver(() => {
      const manager = resolveRegisteredManager(policy);
      registerGlobalMemoryManager(manager, {
        agentId: profile.id,
        workspaceRoot: policy.managerStateDir,
      });
      records.push({
        agentId: profile.id,
        stateDir: policy.managerStateDir,
        memoryMode: policy.memoryMode,
        policy,
        manager,
      });
      return manager;
    }, {
      agentId: profile.id,
      workspaceRoot: policy.managerStateDir,
    });
  }

  // 共享层 manager / 非 default resident manager 都改为按需创建。
  registerLazySharedLayerManager(resolveResidentSharedStateDir(options.stateDir));

  const configuredDefault = options.agentRegistry?.getProfile("default");
  const defaultProfile = configuredDefault && isResidentAgentProfile(configuredDefault)
    ? configuredDefault
    : buildDefaultProfile();
  const defaultManager = registerResidentManager(defaultProfile, true);

  for (const profile of options.agentRegistry?.list() ?? []) {
    if (profile.id === "default") continue;
    if (!isResidentAgentProfile(profile)) continue;
    registerLazyResidentManager(profile);
  }

  return {
    defaultManager,
    records,
  };
}
