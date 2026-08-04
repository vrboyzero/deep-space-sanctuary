import type { ExtensionMarketplaceSource } from "@belldandy/plugins";
import type {
  MarketplaceExtensionRuntimeCoordinator,
  MarketplaceExtensionRuntimeMutation,
} from "../../../extension-marketplace-service.js";
import type { CLIContext } from "../../shared/context.js";
import { invokeGatewayMethod } from "../../shared/gateway-rpc.js";

const MARKETPLACE_RUNTIME_REVOKE_TIMEOUT_MS = 15_000;

export function failCli(ctx: CLIContext, message: string): never {
  ctx.error(message);
  process.exit(1);
}

function requireTrimmed(value: unknown, label: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  return normalized;
}

export function buildMarketplaceSourceFromArgs(args: Record<string, unknown>): ExtensionMarketplaceSource {
  const sourceType = requireTrimmed(args.source, "source").toLowerCase();

  switch (sourceType) {
    case "directory":
      return {
        source: "directory",
        path: requireTrimmed(args.path, "path"),
      };
    case "github":
      return {
        source: "github",
        repo: requireTrimmed(args.repo, "repo"),
        ref: typeof args.ref === "string" && args.ref.trim() ? args.ref.trim() : undefined,
        manifestPath: typeof args["manifest-path"] === "string" && args["manifest-path"].trim()
          ? args["manifest-path"].trim()
          : undefined,
      };
    case "git":
      return {
        source: "git",
        url: requireTrimmed(args.url, "url"),
        ref: typeof args.ref === "string" && args.ref.trim() ? args.ref.trim() : undefined,
        manifestPath: typeof args["manifest-path"] === "string" && args["manifest-path"].trim()
          ? args["manifest-path"].trim()
          : undefined,
      };
    case "url":
      return {
        source: "url",
        url: requireTrimmed(args.url, "url"),
      };
    case "npm":
      return {
        source: "npm",
        package: requireTrimmed(args.package, "package"),
        version: typeof args.version === "string" && args.version.trim() ? args.version.trim() : undefined,
      };
    default:
      throw new Error(`Unsupported source type: ${sourceType}`);
  }
}

export function createMarketplaceExtensionRuntimeCoordinator(
  stateDir: string,
): MarketplaceExtensionRuntimeCoordinator {
  return {
    async revokeForMutation(input) {
      const result = await invokeGatewayMethod<{
        revoked: true;
        extensionId: string;
        operation: MarketplaceExtensionRuntimeMutation;
      }>({
        stateDir,
        method: "extension.runtime.revoke",
        params: {
          extensionId: input.extensionId,
          operation: input.operation,
        },
        requestIdPrefix: "bdd-marketplace-runtime-revoke",
        clientName: "bdd marketplace",
        timeoutMs: MARKETPLACE_RUNTIME_REVOKE_TIMEOUT_MS,
        parsePayload: (payload) => {
          if (
            payload.revoked !== true
            || payload.extensionId !== input.extensionId
            || payload.operation !== input.operation
          ) {
            throw new Error("Gateway returned an invalid extension runtime revoke result.");
          }
          return {
            revoked: true,
            extensionId: input.extensionId,
            operation: input.operation,
          };
        },
      });
      if (!result.ok) {
        throw new Error(`Extension runtime revoke failed: ${result.error}`);
      }
    },
  };
}

