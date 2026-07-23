import { defineCommand } from "citty";
import { writeSessionTranscriptExportBundle } from "@belldandy/agent";
import { createCLIContext } from "../../shared/context.js";
import {
  createConversationStoreForCLI,
  hasTranscriptLikeData,
  recordConversationCLIExport,
  resolveConversationCLIOutputPath,
} from "./_shared.js";
import {
  applyTranscriptExportProjection,
  normalizeTranscriptEventTypes,
  normalizeTranscriptRestoreView,
  parseCommaSeparatedValues,
  parsePositiveInteger,
  SUPPORTED_TRANSCRIPT_EVENT_TYPES,
  SUPPORTED_TRANSCRIPT_RESTORE_VIEWS,
} from "../../../conversation-debug-projection.js";

export default defineCommand({
  meta: { name: "export", description: "Export a persisted conversation transcript bundle" },
  args: {
    json: { type: "boolean", description: "JSON output" },
    "state-dir": { type: "string", description: "Override state directory" },
    "conversation-id": { type: "string", description: "Conversation ID", required: true },
    mode: { type: "string", description: "Export mode: internal | shareable | metadata_only" },
    "event-types": { type: "string", description: `Filter events by type: ${SUPPORTED_TRANSCRIPT_EVENT_TYPES.join(", ")}` },
    "event-limit": { type: "string", description: "Keep only the newest N transcript events after filtering" },
    "restore-view": { type: "string", description: `Choose restore section: ${SUPPORTED_TRANSCRIPT_RESTORE_VIEWS.join(" | ")}` },
    pretty: { type: "boolean", description: "Pretty-print JSON output (default: true)" },
    output: { type: "string", description: "Write export JSON to file" },
    "output-dir": { type: "string", description: "Write export JSON into a directory using a stable generated file name" },
  },
  async run({ args }) {
    const ctx = createCLIContext({ json: args.json, stateDir: args["state-dir"] });
    const conversationId = typeof args["conversation-id"] === "string" ? args["conversation-id"].trim() : "";
    const mode = typeof args.mode === "string" ? args.mode.trim() : undefined;
    const eventTypesRaw = parseCommaSeparatedValues(typeof args["event-types"] === "string" ? args["event-types"] : undefined);
    const eventTypes = normalizeTranscriptEventTypes(eventTypesRaw);
    const eventLimit = parsePositiveInteger(typeof args["event-limit"] === "string" ? args["event-limit"] : undefined);
    const restoreViewRaw = typeof args["restore-view"] === "string" ? args["restore-view"].trim() : undefined;
    const restoreView = normalizeTranscriptRestoreView(restoreViewRaw);

    if (!conversationId) {
      ctx.error("conversation-id is required");
      process.exit(1);
    }
    if (mode !== undefined && mode !== "internal" && mode !== "shareable" && mode !== "metadata_only") {
      ctx.error("mode must be internal, shareable, or metadata_only");
      process.exit(1);
    }
    if (eventTypesRaw && !eventTypes) {
      ctx.error(`event-types must be one or more of: ${SUPPORTED_TRANSCRIPT_EVENT_TYPES.join(", ")}`);
      process.exit(1);
    }
    if (restoreViewRaw && !restoreView) {
      ctx.error(`restore-view must be one of: ${SUPPORTED_TRANSCRIPT_RESTORE_VIEWS.join(", ")}`);
      process.exit(1);
    }

    const store = createConversationStoreForCLI(ctx.stateDir);
    const bundle = await store.buildConversationTranscriptExport(conversationId, { mode });
    if (!hasTranscriptLikeData(bundle)) {
      ctx.error(`Conversation '${conversationId}' not found or transcript data is empty`);
      process.exit(1);
    }

    const projectedBundle = applyTranscriptExportProjection(bundle, {
      eventTypes,
      eventLimit,
      restoreView,
    });
    const pretty = args.pretty !== false;
    const outputPath = await resolveConversationCLIOutputPath({
      output: typeof args.output === "string" ? args.output : undefined,
      outputDir: typeof args["output-dir"] === "string" ? args["output-dir"] : undefined,
      conversationId,
      artifact: "transcript",
      variant: projectedBundle.manifest.redactionMode,
      extension: "json",
    });
    if (outputPath) {
      await writeSessionTranscriptExportBundle(outputPath, projectedBundle, { pretty });
      await recordConversationCLIExport({
        stateDir: ctx.stateDir,
        conversationId,
        artifact: "transcript",
        format: "json",
        outputPath,
        mode: projectedBundle.manifest.redactionMode,
        projectionFilter: projectedBundle.projectionFilter,
      });
      if (ctx.json) {
        ctx.output({ output: outputPath, conversationId, mode: projectedBundle.manifest.redactionMode });
      } else {
        ctx.success(`Transcript export written to ${outputPath}`);
      }
      return;
    }

    const serialized = JSON.stringify(projectedBundle, null, pretty ? 2 : 0);
    console.log(serialized);
  },
});
