import type { AgentRegistry, ModelProfile } from "@belldandy/agent";
import type { GatewayReqFrame, GatewayResFrame } from "@belldandy/protocol";

import { handleModelCatalogListWithQueryRuntime } from "../query-runtime-model-catalog.js";
import type { QueryRuntimeTraceStore } from "../query-runtime-trace.js";
import {
  getModelFallbackConfigContent,
  mergeModelFallbackConfigSecrets,
  parseModelFallbackConfigContent,
  REDACTED_MODEL_SECRET_PLACEHOLDER,
  resolveModelFallbackConfigPath,
  writeModelFallbackConfig,
} from "../model-fallback-config.js";

type ModelsConfigMethodContext = {
  stateDir: string;
  primaryModelConfig?: { baseUrl: string; apiKey: string; model: string; protocol?: string; wireApi?: string };
  modelFallbacks?: ModelProfile[];
  preferredProviderIds: string[];
  modelConfigPath?: string;
  agentRegistry?: AgentRegistry;
  queryRuntimeTraceStore: QueryRuntimeTraceStore;
};

export async function handleModelsConfigMethod(
  req: GatewayReqFrame,
  ctx: ModelsConfigMethodContext,
): Promise<GatewayResFrame | null> {
  switch (req.method) {
    case "models.list": {
      return handleModelCatalogListWithQueryRuntime({
        requestId: req.id,
        primaryModelConfig: ctx.primaryModelConfig,
        modelFallbacks: ctx.modelFallbacks,
        currentDefault: ctx.agentRegistry?.getProfile("default")?.model ?? "primary",
        preferredProviderIds: ctx.preferredProviderIds,
        runtimeObserver: ctx.queryRuntimeTraceStore.createObserver<"models.list">(),
      });
    }

    case "models.config.get": {
      try {
        const payload = await getModelFallbackConfigContent(
          resolveModelFallbackConfigPath(ctx.stateDir, ctx.modelConfigPath),
          { redactApiKeys: true },
        );
        return {
          type: "res",
          id: req.id,
          ok: true,
          payload,
        };
      } catch (error) {
        return {
          type: "res",
          id: req.id,
          ok: false,
          error: {
            code: "model_config_read_failed",
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }

    case "models.config.update": {
      const params = req.params as unknown as { content?: string } | undefined;
      const content = typeof params?.content === "string" ? params.content : "";
      const modelConfigPath = resolveModelFallbackConfigPath(ctx.stateDir, ctx.modelConfigPath);
      try {
        const existingConfig = await getModelFallbackConfigContent(modelConfigPath);
        const editedConfig = parseModelFallbackConfigContent(content);
        const mergedConfig = mergeModelFallbackConfigSecrets(existingConfig.config, editedConfig, {
          redactedPlaceholder: REDACTED_MODEL_SECRET_PLACEHOLDER,
        });
        await writeModelFallbackConfig(modelConfigPath, mergedConfig);
        if (ctx.modelFallbacks) {
          ctx.modelFallbacks.splice(0, ctx.modelFallbacks.length, ...mergedConfig.fallbacks.map((item) => ({ ...item })));
        }
        ctx.agentRegistry?.clearAllInstances();
        return {
          type: "res",
          id: req.id,
          ok: true,
          payload: await getModelFallbackConfigContent(modelConfigPath, { redactApiKeys: true }),
        };
      } catch (error) {
        return {
          type: "res",
          id: req.id,
          ok: false,
          error: {
            code: "invalid_model_config",
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }

    default:
      return null;
  }
}
