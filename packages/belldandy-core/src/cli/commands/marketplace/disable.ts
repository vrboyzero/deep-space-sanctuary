import { defineCommand } from "citty";

import { disableMarketplaceExtension } from "../../../extension-marketplace-service.js";
import { createCLIContext } from "../../shared/context.js";
import { createMarketplaceExtensionRuntimeCoordinator, failCli } from "./shared.js";

export default defineCommand({
  meta: { name: "disable", description: "Disable an installed marketplace extension in the ledger" },
  args: {
    id: { type: "positional", description: "Installed extension id (<name>@<marketplace>)", required: true },
    json: { type: "boolean", description: "JSON output" },
    "state-dir": { type: "string", description: "Override state directory" },
  },
  async run({ args }) {
    const ctx = createCLIContext({ json: args.json, stateDir: args["state-dir"] });

    try {
      const record = await disableMarketplaceExtension(ctx.stateDir, args.id, {
        runtimeCoordinator: createMarketplaceExtensionRuntimeCoordinator(ctx.stateDir),
      });
      if (ctx.json) {
        ctx.output({ status: "disabled", extension: record });
        return;
      }
      ctx.success(`Disabled ${record.id}`);
    } catch (error) {
      failCli(ctx, error instanceof Error ? error.message : String(error));
    }
  },
});

