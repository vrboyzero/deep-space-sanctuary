import { defineCommand } from "citty";

import {
  installMarketplaceExtension,
  previewMarketplaceExtensionInstall,
} from "../../../extension-marketplace-service.js";
import { createCLIContext } from "../../shared/context.js";
import { buildMarketplaceSourceFromArgs, failCli } from "./shared.js";

export default defineCommand({
  meta: { name: "install", description: "Install an extension from a marketplace source" },
  args: {
    marketplace: { type: "positional", description: "Marketplace name", required: true },
    source: { type: "string", description: "Source type: directory|github|git|url|npm", required: true },
    path: { type: "string", description: "Directory source path" },
    repo: { type: "string", description: "GitHub repository (owner/name)" },
    url: { type: "string", description: "Git or URL source URL" },
    package: { type: "string", description: "npm package name" },
    ref: { type: "string", description: "Git ref / branch / tag" },
    version: { type: "string", description: "npm package version" },
    "manifest-path": { type: "string", description: "Relative manifest path" },
    "auto-update": { type: "boolean", description: "Mark marketplace source as auto-update enabled" },
    disabled: { type: "boolean", description: "Install as disabled in ledger" },
    "confirm-hash": { type: "string", description: "Exact confirmation hash from the trust preview" },
    json: { type: "boolean", description: "JSON output" },
    "state-dir": { type: "string", description: "Override state directory" },
  },
  async run({ args }) {
    const ctx = createCLIContext({ json: args.json, stateDir: args["state-dir"] });

    try {
      const source = buildMarketplaceSourceFromArgs(args as Record<string, unknown>);
      const input = {
        stateDir: ctx.stateDir,
        marketplace: args.marketplace,
        source,
        manifestPath: args["manifest-path"],
        autoUpdate: args["auto-update"],
        enabled: !args.disabled,
      };
      const preview = await previewMarketplaceExtensionInstall(input);
      if (!args["confirm-hash"]) {
        if (ctx.json) {
          ctx.output({ status: "confirmation_required", preview });
          return;
        }
        ctx.log(`Extension: ${preview.extensionId} v${preview.versionLabel}`);
        ctx.log(`Host API: ${preview.hostApi}`);
        ctx.log(`Permissions: ${preview.permissions.join(", ") || "none"}`);
        ctx.log(`Content SHA-256: ${preview.contentSha256}`);
        ctx.log(`Confirmation hash: ${preview.confirmationHash}`);
        return;
      }
      const result = await installMarketplaceExtension({
        ...input,
        confirmationHash: args["confirm-hash"],
      });

      if (ctx.json) {
        ctx.output({
          status: "installed",
          marketplace: result.marketplace,
          extension: result.installed,
          source: result.preparedSource,
          materialized: result.materialized,
          audit: result.audit,
        });
        return;
      }

      ctx.success(`Installed ${result.installed.id}`);
      ctx.log(`  source: ${result.preparedSource.source.source}`);
      ctx.log(`  materialized: ${result.materialized.materializedPath}`);
      ctx.log(`  enabled: ${result.installed.enabled}`);
      ctx.log(`  audit: ${result.audit.auditId}`);
    } catch (error) {
      failCli(ctx, error instanceof Error ? error.message : String(error));
    }
  },
});

