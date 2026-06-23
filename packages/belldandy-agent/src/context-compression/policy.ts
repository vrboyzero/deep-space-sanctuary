/**
 * 策略合并工具
 *
 * 将用户传入的 Partial<CompressionPolicy> 与默认策略合并，
 * 并处理 sourceOverrides 的逐项覆盖。
 */
import { DEFAULT_COMPRESSION_POLICY, type CompressionPolicy, type CompressionSourceKind } from "./types.js";

export function resolveCompressionPolicy(
  override?: Partial<CompressionPolicy>,
): CompressionPolicy {
  if (!override) return { ...DEFAULT_COMPRESSION_POLICY };

  const base: CompressionPolicy = {
    ...DEFAULT_COMPRESSION_POLICY,
    ...override,
    sourceOverrides: undefined,
  };

  if (override.sourceOverrides) {
    base.sourceOverrides = {};
    for (const key of Object.keys(override.sourceOverrides) as CompressionSourceKind[]) {
      const userOverride = override.sourceOverrides[key];
      if (!userOverride) continue;
      const defaultOverride = DEFAULT_COMPRESSION_POLICY.sourceOverrides?.[key];
      base.sourceOverrides[key] = {
        ...defaultOverride,
        ...userOverride,
      };
    }
  }

  return base;
}

/** 判断某来源是否允许压缩 */
export function isSourceEnabled(
  policy: CompressionPolicy,
  sourceKind: CompressionSourceKind,
): boolean {
  if (!policy.enabled) return false;
  const override = policy.sourceOverrides?.[sourceKind];
  if (typeof override?.enabled === "boolean") return override.enabled;
  return true;
}

/** 判断某来源是否允许 lossy 压缩 */
export function isSourceLossyAllowed(
  policy: CompressionPolicy,
  sourceKind: CompressionSourceKind,
): boolean {
  const override = policy.sourceOverrides?.[sourceKind];
  if (typeof override?.allowLossy === "boolean") return override.allowLossy;
  return policy.allowLossy;
}

/** 判断某来源是否允许引用存储 */
export function isReferenceStoreAllowed(
  policy: CompressionPolicy,
  sourceKind: CompressionSourceKind,
): boolean {
  const override = policy.sourceOverrides?.[sourceKind];
  if (typeof override?.allowReferenceStore === "boolean") return override.allowReferenceStore;
  return policy.allowReferenceStore;
}
