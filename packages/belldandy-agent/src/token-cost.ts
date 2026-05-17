export type ModelUsagePricing = {
  inputUsdPer1M: number;
  outputUsdPer1M: number;
  cacheReadUsdPer1M?: number;
  cacheCreationUsdPer1M?: number;
};

export type UsageCostBreakdown = {
  inputUsd: number;
  outputUsd: number;
  cacheReadUsd: number;
  cacheCreationUsd: number;
  totalUsd: number;
};

function roundUsd(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

export function calculateUsageCostUsd(input: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  pricing?: ModelUsagePricing;
}): UsageCostBreakdown | undefined {
  if (!input.pricing) return undefined;
  const inputUsd = (Math.max(0, input.inputTokens) / 1_000_000) * input.pricing.inputUsdPer1M;
  const outputUsd = (Math.max(0, input.outputTokens) / 1_000_000) * input.pricing.outputUsdPer1M;
  const cacheReadUsd = input.pricing.cacheReadUsdPer1M
    ? (Math.max(0, input.cacheReadTokens ?? 0) / 1_000_000) * input.pricing.cacheReadUsdPer1M
    : 0;
  const cacheCreationUsd = input.pricing.cacheCreationUsdPer1M
    ? (Math.max(0, input.cacheCreationTokens ?? 0) / 1_000_000) * input.pricing.cacheCreationUsdPer1M
    : 0;
  const totalUsd = inputUsd + outputUsd + cacheReadUsd + cacheCreationUsd;
  return {
    inputUsd: roundUsd(inputUsd),
    outputUsd: roundUsd(outputUsd),
    cacheReadUsd: roundUsd(cacheReadUsd),
    cacheCreationUsd: roundUsd(cacheCreationUsd),
    totalUsd: roundUsd(totalUsd),
  };
}
