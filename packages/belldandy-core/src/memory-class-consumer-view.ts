import type { MemoryClass } from "@belldandy/memory";

import {
  buildMemoryClassRegistryView,
  buildMemoryClassSignalViews,
  formatMemoryClassSignalCoverage,
  type MemoryClassRegistryView,
  type MemoryClassSignalView,
} from "./memory-class-registry-view.js";

export interface MemoryClassConsumerView {
  memoryClassSignals: MemoryClassSignalView[];
  memoryClassCoverage: {
    availableCount: number;
    partialCount: number;
    missingCount: number;
    headline: string;
  };
  memoryClassRegistry?: MemoryClassRegistryView;
}

export interface BuildMemoryClassConsumerViewInput {
  memoryClasses?: readonly MemoryClass[];
  presentClasses?: readonly MemoryClass[];
  partialClasses?: readonly MemoryClass[];
  noteByClass?: Partial<Record<MemoryClass, string>>;
  includeMissing?: boolean;
  includeRegistry?: boolean;
  registryClasses?: readonly MemoryClass[];
}

export function buildMemoryClassConsumerView(
  input: BuildMemoryClassConsumerViewInput = {},
): MemoryClassConsumerView {
  const signals = buildMemoryClassSignalViews({
    memoryClasses: input.memoryClasses,
    presentClasses: input.presentClasses,
    partialClasses: input.partialClasses,
    noteByClass: input.noteByClass,
    includeMissing: input.includeMissing,
  });
  const availableCount = signals.filter((item) => item.status === "available").length;
  const partialCount = signals.filter((item) => item.status === "partial").length;
  const missingCount = signals.filter((item) => item.status === "missing").length;
  const registry = input.includeRegistry
    ? buildMemoryClassRegistryView({
      memoryClasses: input.registryClasses ?? input.memoryClasses,
    })
    : undefined;

  return {
    memoryClassSignals: signals,
    memoryClassCoverage: {
      availableCount,
      partialCount,
      missingCount,
      headline: signals.length > 0 ? formatMemoryClassSignalCoverage(signals) : "no classed signals",
    },
    ...(registry ? { memoryClassRegistry: registry } : {}),
  };
}
