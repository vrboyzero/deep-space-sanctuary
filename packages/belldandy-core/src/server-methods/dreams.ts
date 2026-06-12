import type { DreamRuntime } from "@belldandy/memory";
import type { GatewayReqFrame, GatewayResFrame } from "@belldandy/protocol";

import type { ObsidianCommonsRuntime } from "../obsidian-commons-runtime.js";

type DreamMethodContext = {
  resolveDreamRuntime: (agentId?: string) => DreamRuntime | null;
  resolveDefaultConversationId: (agentId?: string) => string;
  resolveCommonsExportRuntime?: () => ObsidianCommonsRuntime | null;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readOptionalString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function clampListLimit(value: unknown, fallback: number, max = 100): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function ok(id: string, payload: Record<string, unknown>): GatewayResFrame {
  return { type: "res", id, ok: true, payload };
}

function invalid(id: string, message: string): GatewayResFrame {
  return { type: "res", id, ok: false, error: { code: "invalid_params", message } };
}

function notAvailable(id: string): GatewayResFrame {
  return { type: "res", id, ok: false, error: { code: "not_available", message: "Dream runtime is not available." } };
}

function notFound(id: string, message: string): GatewayResFrame {
  return { type: "res", id, ok: false, error: { code: "not_found", message } };
}

function confirmationRequired(id: string, message: string): GatewayResFrame {
  return {
    type: "res",
    id,
    ok: false,
    error: {
      code: "confirmation_required",
      message,
    },
  };
}

async function buildCommonsStatusPayload(
  runtime: ObsidianCommonsRuntime | null,
): Promise<Record<string, unknown>> {
  if (!runtime) {
    return {
      availability: {
        enabled: false,
        available: false,
        reason: "commons export runtime unavailable",
      },
      state: null,
      headline: "Commons export runtime is unavailable.",
    };
  }

  const availability = runtime.getAvailability();
  const state = await runtime.getState();
  const headline = !availability.available
    ? `Commons export is blocked: ${availability.reason ?? "unknown reason"}.`
    : state.status === "failed"
      ? `Commons export failed at ${state.lastFailureAt ?? state.updatedAt}.`
      : state.lastSuccessAt
        ? `Commons export last completed at ${state.lastSuccessAt}.`
        : "Commons export is ready and has no runs yet.";
  return {
    availability,
    state,
    headline,
  };
}

export async function handleDreamMethod(
  req: GatewayReqFrame,
  ctx: DreamMethodContext,
): Promise<GatewayResFrame | null> {
  if (!req.method.startsWith("dream.")) {
    return null;
  }

  const params = isObjectRecord(req.params) ? req.params : {};
  const agentId = readOptionalString(params, "agentId") ?? "default";

  switch (req.method) {
    case "dream.run": {
      const runtime = ctx.resolveDreamRuntime(agentId);
      if (!runtime) return notAvailable(req.id);
      const conversationId = readOptionalString(params, "conversationId") ?? ctx.resolveDefaultConversationId(agentId);
      const reason = readOptionalString(params, "reason");
      const result = await runtime.run({
        conversationId,
        triggerMode: "manual",
        reason,
      });
      return ok(req.id, {
        agentId,
        availability: runtime.getAvailability(),
        record: result.record,
        state: result.state,
        dream: result.draft,
        markdown: result.markdown,
      });
    }

    case "dream.status.get": {
      const runtime = ctx.resolveDreamRuntime(agentId);
      if (!runtime) return notAvailable(req.id);
      const state = await runtime.getState();
      return ok(req.id, {
        agentId,
        availability: runtime.getAvailability(),
        defaultConversationId: ctx.resolveDefaultConversationId(agentId),
        state,
      });
    }

    case "dream.history.list": {
      const runtime = ctx.resolveDreamRuntime(agentId);
      if (!runtime) return notAvailable(req.id);
      const limit = clampListLimit(params.limit, 10, 50);
      return ok(req.id, {
        agentId,
        availability: runtime.getAvailability(),
        items: await runtime.listHistory(limit),
      });
    }

    case "dream.get": {
      const runtime = ctx.resolveDreamRuntime(agentId);
      if (!runtime) return notAvailable(req.id);
      const dreamId = readOptionalString(params, "dreamId");
      const item = await runtime.getDream({ dreamId });
      if (!item) {
        return notFound(req.id, dreamId ? "Dream run not found." : "No dream available.");
      }
      return ok(req.id, {
        agentId,
        availability: runtime.getAvailability(),
        item: item.record,
        content: item.content,
      });
    }

    case "dream.consolidation.review": {
      const runtime = ctx.resolveDreamRuntime(agentId);
      if (!runtime) return notAvailable(req.id);
      const dreamId = readOptionalString(params, "dreamId");
      if (!dreamId) return invalid(req.id, "dreamId is required");
      const decision = readOptionalString(params, "decision");
      if (decision !== "approved" && decision !== "rejected" && decision !== "superseded") {
        return invalid(req.id, "decision must be approved, rejected, or superseded.");
      }
      const approvedCandidatePaths = Array.isArray(params.approvedCandidatePaths)
        ? params.approvedCandidatePaths
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
        : undefined;
      try {
        const result = await runtime.reviewConsolidation(dreamId, decision, {
          reviewedBy: readOptionalString(params, "reviewedBy") ?? readOptionalString(params, "agentId") ?? "rpc",
          note: readOptionalString(params, "note"),
          approvedCandidatePaths,
        });
        return ok(req.id, {
          agentId,
          availability: runtime.getAvailability(),
          record: result.record,
          state: result.state,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/not found/i.test(message)) {
          return notFound(req.id, message);
        }
        return invalid(req.id, message);
      }
    }

    case "dream.consolidation.apply": {
      const runtime = ctx.resolveDreamRuntime(agentId);
      if (!runtime) return notAvailable(req.id);
      const dreamId = readOptionalString(params, "dreamId");
      if (!dreamId) return invalid(req.id, "dreamId is required");
      if (params.confirmed !== true) {
        return confirmationRequired(req.id, "dream.consolidation.apply requires explicit confirmed=true because it mutates canonical profile state.");
      }
      try {
        const result = await runtime.applyConsolidation(dreamId, {
          appliedBy: readOptionalString(params, "appliedBy") ?? readOptionalString(params, "agentId") ?? "rpc",
          note: readOptionalString(params, "note"),
        });
        return ok(req.id, {
          agentId,
          availability: runtime.getAvailability(),
          appliedPatchCount: result.appliedPatchCount,
          record: result.record,
          state: result.state,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/not found/i.test(message)) {
          return notFound(req.id, message);
        }
        return invalid(req.id, message);
      }
    }

    case "dream.commons.status.get": {
      const commonsRuntime = ctx.resolveCommonsExportRuntime?.() ?? null;
      return ok(req.id, await buildCommonsStatusPayload(commonsRuntime));
    }

    case "dream.commons.export_now": {
      const commonsRuntime = ctx.resolveCommonsExportRuntime?.() ?? null;
      if (!commonsRuntime) {
        return {
          type: "res",
          id: req.id,
          ok: false,
          error: { code: "not_available", message: "Commons export runtime is not available." },
        };
      }
      const result = await commonsRuntime.runNow();
      return ok(req.id, {
        agentId,
        exported: result.exported,
        availability: commonsRuntime.getAvailability(),
        state: result.state,
      });
    }
  }

  return invalid(req.id, "Unsupported dream method.");
}
