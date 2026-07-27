import { defineCommand } from "citty";

import {
  previewMarketplaceExtensionUninstall,
  uninstallMarketplaceExtension,
} from "../../../extension-marketplace-service.js";
import { createCLIContext } from "../../shared/context.js";
import { failCli } from "./shared.js";

export default defineCommand({
  meta: { name: "uninstall", description: "Uninstall an installed marketplace extension" },
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
      const preview = await previewMarketplaceExtensionUninstall(input);
      if (!args["confirm-hash"]) {
        if (ctx.json) {
          ctx.output({ status: "confirmation_required", preview });
          return;
        }
        ctx.log(`Extension: ${preview.extensionId} v${preview.versionLabel ?? "unknown"}`);
        ctx.log(`Install path: ${preview.installPath}`);
        ctx.log(`Permissions: ${preview.permissions.join(", ") || "none"}`);
        ctx.log(`Content SHA-256: ${preview.contentSha256 ?? "unknown"}`);
        ctx.log(`Confirmation hash: ${preview.confirmationHash}`);
        return;
      }
      const result = await uninstallMarketplaceExtension({
        ...input,
        confirmationHash: args["confirm-hash"],
      });

      if (ctx.json) {
        ctx.output({ status: "uninstalled", extension: result.removed, audit: result.audit });
        return;
      }

      ctx.success(`Uninstalled ${result.removed.id}`);
      ctx.log(`  audit: ${result.audit.auditId}`);
    } catch (error) {
      failCli(ctx, error instanceof Error ? error.message : String(error));
    }
  },
});

