import type { ModelProfile } from "@belldandy/agent";
import type { GatewayResFrame } from "@belldandy/protocol";

import { buildProviderModelCatalog, type PrimaryModelCatalogConfig } from "./provider-model-catalog.js";
import { QueryRuntime, type QueryRuntimeObserver } from "./query-runtime.js";

type ModelCatalogQueryRuntimeMethod = "models.list";

export type QueryRuntimeModelCatalogContext = {
  requestId: string;
  primaryModelConfig?: PrimaryModelCatalogConfig;
  modelFallbacks?: ModelProfile[];
  currentDefault?: string;
  preferredProviderIds?: string[];
  deepSeekRoutePolicyEnabled?: boolean;
  runtimeObserver?: QueryRuntimeObserver<ModelCatalogQueryRuntimeMethod>;
};

export async function handleModelCatalogListWithQueryRuntime(
  ctx: QueryRuntimeModelCatalogContext,
): Promise<GatewayResFrame> {
  const runtime = new QueryRuntime({
    method: "models.list" as const,
    traceId: ctx.requestId,
    observer: ctx.runtimeObserver,
  });

  return runtime.run(async (queryRuntime) => {
    queryRuntime.mark("request_validated", {
      detail: {
        currentDefault: ctx.currentDefault ?? "primary",
        fallbackCount: ctx.modelFallbacks?.length ?? 0,
        preferredProviderCount: ctx.preferredProviderIds?.length ?? 0,
      },
    });

    const payload = buildProviderModelCatalog({
      primaryModelConfig: ctx.primaryModelConfig,
      modelFallbacks: ctx.modelFallbacks,
      currentDefault: ctx.currentDefault,
      preferredProviderIds: ctx.preferredProviderIds,
      deepSeekRoutePolicyEnabled: ctx.deepSeekRoutePolicyEnabled,
    });

    queryRuntime.mark("response_built", {
      detail: {
        providerCount: payload.providers.length,
        modelCount: payload.models.length,
        missingAuthCount: payload.models.filter((item) => item.authStatus === "missing").length,
        preferredProviderCount: payload.preferredProviderIds.length,
      },
    });
    queryRuntime.mark("completed", {
      detail: {
        providerCount: payload.providers.length,
        modelCount: payload.models.length,
      },
    });

    return {
      type: "res",
      id: ctx.requestId,
      ok: true,
      payload,
    };
  });
}
