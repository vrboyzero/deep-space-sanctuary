import { defineCommand } from "citty";

import {
  previewMarketplaceExtensionUpdate,
  updateMarketplaceExtension,
} from "../../../extension-marketplace-service.js";
import { createCLIContext } from "../../shared/context.js";
import { failCli } from "./shared.js";

export default defineCommand({
  meta: { name: "update", description: "Refresh an installed extension from its known marketplace source" },
  args: {
    id: { type: "positional", description: "Installed extension id (<name>@<marketplace>)", required: true },
    "confirm-hash": { type: "string", description: "Exact confirmation hash from the trust preview" },
    json: { type: "boolean", description: "JSON output" },
    "state-dir": { type: "string", description: "Override state directory" },
  },
  async run({ args }) {
    const ctx = createCLIContext({ json: args.json, stateDir: args["state-dir"] });

    try {
      const input = {
        stateDir: ctx.stateDir,
        extensionId: args.id,
      };
      const preview = await previewMarketplaceExtensionUpdate(input);
      if (!args["confirm-hash"]) {
        if (ctx.json) {
          ctx.output({ status: "confirmation_required", preview });
          return;
        }
        ctx.log(`Extension: ${preview.extensionId} ${preview.currentVersion ?? "unknown"} -> ${preview.versionLabel}`);
        ctx.log(`Host API: ${preview.currentHostApi ?? "unknown"} -> ${preview.hostApi}`);
        ctx.log(`Permissions: ${preview.permissions.join(", ") || "none"}`);
        ctx.log(`Content SHA-256: ${preview.currentContentSha256 ?? "unknown"} -> ${preview.contentSha256}`);
        ctx.log(`Confirmation hash: ${preview.confirmationHash}`);
        return;
      }
      const result = await updateMarketplaceExtension({
        ...input,
        confirmationHash: args["confirm-hash"],
      });

      if (ctx.json) {
        ctx.output({
          status: "updated",
          extension: result.installed,
          source: result.preparedSource,
          materialized: result.materialized,
          audit: result.audit,
        });
        return;
      }

      ctx.success(`Updated ${result.installed.id}`);
      ctx.log(`  version: ${result.installed.version ?? "unknown"}`);
      ctx.log(`  materialized: ${result.materialized.materializedPath}`);
      ctx.log(`  audit: ${result.audit.auditId}`);
    } catch (error) {
      failCli(ctx, error instanceof Error ? error.message : String(error));
    }
  },
});

