import {
  getMemoryClassBindingEntry,
  listMemoryClassBindingEntries,
  type MemoryClass,
  type MemoryClassBindingRegistryEntry,
  type MemoryClassBindingRole,
  type MemoryTruthMode,
} from "@belldandy/memory";

export type MemoryClassSignalStatus = "available" | "partial" | "missing";

export interface MemoryClassRegistryRoleView {
  role: MemoryClassBindingRole;
  count: number;
  truthModes: MemoryTruthMode[];
  modulePaths: string[];
}

export interface MemoryClassRegistryClassView {
  memoryClass: MemoryClass;
  label: string;
  goal: string;
  truthBoundary: string;
  canonicalSourceSummary: string;
  primaryWritePathSummary: string;
  runtimeUsageSummary: string;
  observabilityUsageSummary: string;
  freshnessSignals: string[];
  lineageSignals: string[];
  bindingCount: number;
  truthModes: MemoryTruthMode[];
  roles: MemoryClassRegistryRoleView[];
}

export interface MemoryClassRegistryView {
  summary: {
    classCount: number;
    bindingCount: number;
    runtimeConsumerCount: number;
    reviewConsumerCount: number;
    observabilityConsumerCount: number;
    headline: string;
  };
  classes: MemoryClassRegistryClassView[];
}

export interface MemoryClassSignalView extends MemoryClassRegistryClassView {
  status: MemoryClassSignalStatus;
  summary: string;
  note?: string;
}

export interface BuildMemoryClassRegistryViewInput {
  memoryClasses?: readonly MemoryClass[];
}

export interface BuildMemoryClassSignalViewsInput extends BuildMemoryClassRegistryViewInput {
  presentClasses?: readonly MemoryClass[];
  partialClasses?: readonly MemoryClass[];
  noteByClass?: Partial<Record<MemoryClass, string>>;
  includeMissing?: boolean;
}

const MEMORY_CLASS_ROLE_ORDER: readonly MemoryClassBindingRole[] = [
  "canonical_source",
  "primary_write_path",
  "primary_read_model",
  "runtime_consumer",
  "review_consumer",
  "observability_consumer",
] as const;

const MEMORY_CLASS_SHORT_LABELS: Record<MemoryClass, string> = {
  profile_semantic: "profile",
  project_semantic: "project",
  episodic_task: "task",
  procedural_experience: "experience",
  governance: "governance",
};

// 这里把 memory 包里的静态 registry 压成 consumer 可直接读取的轻量视图。
export function buildMemoryClassRegistryView(
  input: BuildMemoryClassRegistryViewInput = {},
): MemoryClassRegistryView {
  const entries = filterBindingEntries(input.memoryClasses);
  const classes = entries.map(toMemoryClassRegistryClassView);
  const bindingCount = classes.reduce((sum, item) => sum + item.bindingCount, 0);
  const runtimeConsumerCount = countBindingsByRole(entries, "runtime_consumer");
  const reviewConsumerCount = countBindingsByRole(entries, "review_consumer");
  const observabilityConsumerCount = countBindingsByRole(entries, "observability_consumer");

  return {
    summary: {
      classCount: classes.length,
      bindingCount,
      runtimeConsumerCount,
      reviewConsumerCount,
      observabilityConsumerCount,
      headline: `${classes.length} classes, ${bindingCount} bindings, runtime=${runtimeConsumerCount}, review=${reviewConsumerCount}, observability=${observabilityConsumerCount}`,
    },
    classes,
  };
}

export function buildMemoryClassSignalViews(
  input: BuildMemoryClassSignalViewsInput = {},
): MemoryClassSignalView[] {
  const registryView = buildMemoryClassRegistryView({
    memoryClasses: input.memoryClasses,
  });
  const presentClasses = new Set(input.presentClasses ?? []);
  const partialClasses = new Set(input.partialClasses ?? []);
  const includeMissing = input.includeMissing !== false;
  const noteByClass = input.noteByClass ?? {};

  return registryView.classes
    .map<MemoryClassSignalView>((item) => {
      const note = noteByClass[item.memoryClass];
      const status = presentClasses.has(item.memoryClass)
        ? "available"
        : partialClasses.has(item.memoryClass)
          ? "partial"
          : "missing";
      return {
        ...item,
        status,
        ...(note ? { note } : {}),
        summary: buildMemoryClassSignalSummary(item.label, status, note),
      };
    })
    .filter((item) => includeMissing || item.status !== "missing");
}

export function formatMemoryClassSignalCoverage(signals: readonly MemoryClassSignalView[]): string {
  return signals
    .map((item) => `${MEMORY_CLASS_SHORT_LABELS[item.memoryClass]}=${item.status}`)
    .join(", ");
}

export function buildPresentMemoryClassSignals(
  memoryClasses: readonly MemoryClass[],
  noteByClass: Partial<Record<MemoryClass, string>> = {},
): MemoryClassSignalView[] {
  return buildMemoryClassSignalViews({
    memoryClasses,
    presentClasses: memoryClasses,
    noteByClass,
    includeMissing: false,
  });
}

function filterBindingEntries(memoryClasses?: readonly MemoryClass[]): MemoryClassBindingRegistryEntry[] {
  if (!Array.isArray(memoryClasses) || memoryClasses.length <= 0) {
    return listMemoryClassBindingEntries();
  }
  return memoryClasses.map((memoryClass) => getMemoryClassBindingEntry(memoryClass));
}

function toMemoryClassRegistryClassView(entry: MemoryClassBindingRegistryEntry): MemoryClassRegistryClassView {
  const truthModes = [...new Set(entry.bindings.map((binding) => binding.truthMode))];
  const roles = MEMORY_CLASS_ROLE_ORDER
    .map((role) => {
      const bindings = entry.bindings.filter((binding) => binding.role === role);
      if (bindings.length <= 0) {
        return null;
      }
      return {
        role,
        count: bindings.length,
        truthModes: [...new Set(bindings.map((binding) => binding.truthMode))],
        modulePaths: bindings.map((binding) => binding.modulePath),
      } satisfies MemoryClassRegistryRoleView;
    })
    .filter((item): item is MemoryClassRegistryRoleView => Boolean(item));

  return {
    memoryClass: entry.contract.memoryClass,
    label: entry.contract.label,
    goal: entry.contract.goal,
    truthBoundary: entry.contract.truthBoundary,
    canonicalSourceSummary: entry.contract.canonicalSourceSummary,
    primaryWritePathSummary: entry.contract.primaryWritePathSummary,
    runtimeUsageSummary: entry.contract.runtimeUsageSummary,
    observabilityUsageSummary: entry.contract.observabilityUsageSummary,
    freshnessSignals: [...entry.contract.freshnessSignals],
    lineageSignals: [...entry.contract.lineageSignals],
    bindingCount: entry.bindings.length,
    truthModes,
    roles,
  };
}

function countBindingsByRole(
  entries: readonly MemoryClassBindingRegistryEntry[],
  role: MemoryClassBindingRole,
): number {
  return entries.reduce((sum, entry) => sum + entry.bindings.filter((binding) => binding.role === role).length, 0);
}

function buildMemoryClassSignalSummary(
  label: string,
  status: MemoryClassSignalStatus,
  note?: string,
): string {
  if (note) {
    return `${label}: ${status} - ${note}`;
  }
  switch (status) {
    case "available":
      return `${label}: available`;
    case "partial":
      return `${label}: partial`;
    default:
      return `${label}: missing`;
  }
}
