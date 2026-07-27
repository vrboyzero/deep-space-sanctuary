import { defineCommand } from "citty";

import { listMarketplaceExtensionAudits } from "../../../extension-marketplace-audit.js";
import { createCLIContext } from "../../shared/context.js";

export default defineCommand({
  meta: { name: "audit", description: "List marketplace trust operation audit records" },
  args: {
    json: { type: "boolean", description: "JSON output" },
    "state-dir": { type: "string", description: "Override state directory" },
  },
  async run({ args }) {
    const ctx = createCLIContext({ json: args.json, stateDir: args["state-dir"] });
    const audits = await listMarketplaceExtensionAudits(ctx.stateDir);

    if (ctx.json) {
      ctx.output({ audits });
      return;
    }

    ctx.log(`Marketplace trust audits: ${audits.length}`);
    for (const audit of audits) {
      ctx.log(`  - ${audit.operation} ${audit.extensionId} [${audit.status}] ${audit.auditId}`);
    }
  },
});
