import type { BelldandyRole } from "@belldandy/protocol";

/**
 * Gateway 对外 RPC 的唯一目录。新增方法必须先在这里声明，避免 capability
 * 公告、配对校验与实际分发各自维护一份容易漂移的名单。
 */
export type GatewayMethodRisk = "bootstrap" | "read" | "write" | "admin" | "code-execution";

export type GatewayCapability =
  | "gateway.read"
  | "gateway.write"
  | "gateway.admin"
  | "workflow.execute";

export type GatewayMethodPolicy = {
  method: string;
  advertised: boolean;
  requiresPairing: boolean;
  allowedRoles: readonly BelldandyRole[];
  risk: GatewayMethodRisk;
  requiredCapability?: GatewayCapability;
};

const ALL_GATEWAY_ROLES = ["web", "cli", "node"] as const satisfies readonly BelldandyRole[];

// 该清单与 server.ts 的 switch 分发保持一一对应，由 registry test 固定关键高风险方法。
const GATEWAY_METHOD_NAMES = [
  "pairing.approve",
  "models.list",
  "models.config.get",
  "models.config.update",
  "message.send",
  "conversation.run.stop",
  "tool_settings.confirm",
  "external_outbound.confirm",
  "external_outbound.audit.list",
  "email_outbound.confirm",
  "email_outbound.audit.list",
  "email_inbound.audit.list",
  "email_followup.list",
  "config.read",
  "config.update",
  "channel.reply_chunking.get",
  "channel.reply_chunking.update",
  "channel.security.get",
  "channel.security.update",
  "channel.security.pending.list",
  "channel.security.approve",
  "channel.security.reject",
  "config.readRaw",
  "config.writeRaw",
  "tools.list",
  "tools.update",
  "agent.catalog.get",
  "agent.contracts.get",
  "delegation.inspect.get",
  "system.restart",
  "agent.create",
  "agents.list",
  "agents.roster.get",
  "agent.session.ensure",
  "agents.prompt.inspect",
  "system.doctor",
  "cron.run_now",
  "cron.recovery.run",
  "goal.create",
  "goal.list",
  "goal.get",
  "goal.resume",
  "goal.pause",
  "goal.handoff.get",
  "goal.handoff.generate",
  "goal.retrospect.generate",
  "goal.experience.suggest",
  "goal.method_candidates.generate",
  "goal.skill_candidates.generate",
  "goal.flow_patterns.generate",
  "goal.flow_patterns.cross_goal",
  "goal.review_governance.summary",
  "goal.capability.get",
  "goal.capability.update",
  "goal.capability.commander_decide",
  "goal.approval.scan",
  "goal.suggestion_review.list",
  "goal.suggestion_review.workflow.set",
  "goal.suggestion_review.decide",
  "goal.suggestion_review.escalate",
  "goal.suggestion_review.scan",
  "goal.suggestion.publish",
  "goal.checkpoint.list",
  "goal.archive",
  "goal.delete",
  "goal.checkpoint.request",
  "goal.checkpoint.approve",
  "goal.checkpoint.reject",
  "goal.checkpoint.expire",
  "goal.checkpoint.reopen",
  "goal.checkpoint.escalate",
  "goal.task_graph.read",
  "goal.task_graph.create",
  "goal.task_graph.update",
  "goal.task_graph.claim",
  "goal.task_graph.pending_review",
  "goal.task_graph.validating",
  "goal.task_graph.complete",
  "goal.task_graph.block",
  "goal.task_graph.fail",
  "goal.task_graph.skip",
  "memory.search",
  "memory.get",
  "memory.recent",
  "memory.stats",
  "memory.configured_sources.get",
  "memory.configured_sources.update",
  "memory.inventory.preview",
  "memory.tree.report.inventory.preview",
  "memory.tree.report.external_ingest.preview",
  "memory.tree.report.dedup.preview",
  "memory.tree.report.shared_governance.preview",
  "memory.tree.report.list",
  "memory.tree.report.get",
  "memory.tree.report.export_markdown",
  "memory.tree.report.review",
  "memory.tree.report.apply",
  "memory.tree.lifecycle.get",
  "memory.tree.lifecycle.report",
  "memory.tree.job.report",
  "memory.tree.lifecycle.ensure",
  "memory.tree.node.rebuild",
  "memory.tree.node.list",
  "memory.tree.node.search",
  "memory.tree.node.get",
  "memory.tree.source.rebuild",
  "memory.tree.source.list",
  "memory.tree.score.rebuild",
  "memory.tree.score.list",
  "memory.dedup.preview",
  "memory.dedup.apply",
  "memory.share.queue",
  "memory.share.promote",
  "memory.share.review",
  "memory.share.claim",
  "memory.task.list",
  "memory.task.get",
  "memory.recent_work",
  "memory.resume_context",
  "memory.similar_past_work",
  "memory.explain_sources",
  "experience.candidate.check_duplicate",
  "experience.candidate.generate",
  "experience.candidate.get",
  "experience.candidate.list",
  "experience.candidate.stats",
  "experience.candidate.accept",
  "experience.candidate.reject",
  "experience.candidate.reject_bulk",
  "experience.candidate.cleanup_consumed",
  "experience.asset.list",
  "experience.asset.read",
  "experience.candidate.synthesize.preview",
  "experience.candidate.synthesize.create",
  "experience.usage.get",
  "experience.usage.list",
  "experience.usage.stats",
  "experience.usage.revoke",
  "experience.skill.freshness.update",
  "dream.run",
  "dream.status.get",
  "dream.history.list",
  "dream.get",
  "dream.consolidation.review",
  "dream.consolidation.apply",
  "dream.commons.status.get",
  "dream.commons.export_now",
  "workspace.list",
  "workspace.read",
  "workspace.readSource",
  "workspace.write",
  "artifact.reveal",
  "context.compact",
  "context.compact.partial",
  "conversation.meta",
  "conversation.transcript.export",
  "conversation.timeline.get",
  "conversation.prompt_snapshot.get",
  "conversation.preflight_compression.retrieve",
  "conversation.tool_result_reference.retrieve",
  "conversation.digest.get",
  "conversation.digest.refresh",
  "conversation.memory.extraction.get",
  "conversation.memory.extract",
  "conversation.restore",
  "workspace.revision.list",
  "workspace.revision.preview",
  "workspace.revision.restore",
  "workspace.change.review.verify_after_restore",
  "workspace.worktree.status",
  "workspace.worktree.create",
  "workspace.worktree.diff",
  "workspace.worktree.keep.preview",
  "workspace.worktree.keep.confirm",
  "workspace.worktree.apply.preview",
  "workspace.worktree.apply.confirm",
  "workspace.worktree.discard.preview",
  "workspace.worktree.discard.confirm",
  "workspace.worktree.remove.preview",
  "workspace.worktree.remove.confirm",
  "workspace.worktree.stage.preview",
  "workspace.worktree.stage.confirm",
  "workspace.worktree.commit.preview",
  "workspace.worktree.commit.confirm",
  "workspace.worktree.branch.preview",
  "workspace.worktree.branch.confirm",
  "workspace.worktree.sweep",
  "workspace.remote_delivery.targets",
  "workspace.remote_delivery.push.preview",
  "workspace.remote_delivery.push.confirm",
  "workspace.remote_delivery.pull_request.preview",
  "workspace.remote_delivery.pull_request.confirm",
  "workspace.remote_delivery.audit.list",
  "extension.runtime.revoke",
  "coding.run.status",
  "coding.run.follow_up.status",
  "coding.run.steer.status",
  "coding.run.permission.list",
  "coding.run.control",
  "coding.run.subscribe",
  "command.job.list",
  "command.job.read",
  "command.job.cancel",
  "subtask.list",
  "subtask.get",
  "subtask.resume",
  "subtask.takeover",
  "subtask.update",
  "subtask.stop",
  "subtask.archive",
  "bridge.session.list",
  "bridge.session.peek",
  "workflow.run",
  "workflow.status",
  "workflow.stop",
  "workflow.list",
] as const;

// 保留既有无副作用 discovery/read 行为；其余历史未保护方法要么是状态写入，
// 要么属于 workflow/task-graph 控制面，均已在 P0.3 收敛为 pairing-required。
const PUBLIC_METHODS = new Set<string>([
  "models.list",
  "agents.list",
  "agents.roster.get",
  "tools.list",
]);
const BOOTSTRAP_METHODS = new Set<string>(["pairing.approve"]);
const CODE_EXECUTION_METHODS = new Set<string>(["workflow.run"]);
const ADMIN_METHODS = new Set<string>([
  "config.update",
  "config.readRaw",
  "config.writeRaw",
  "channel.security.update",
  "channel.security.approve",
  "channel.security.reject",
  "system.restart",
  "tools.update",
  "agent.create",
  "agent.session.ensure",
  "cron.run_now",
  "cron.recovery.run",
  "goal.archive",
  "goal.delete",
  "goal.capability.update",
  "goal.capability.commander_decide",
  "goal.suggestion_review.workflow.set",
  "goal.suggestion_review.decide",
  "goal.suggestion_review.escalate",
  "goal.suggestion.publish",
  "goal.checkpoint.approve",
  "goal.checkpoint.reject",
  "goal.checkpoint.expire",
  "goal.checkpoint.reopen",
  "goal.checkpoint.escalate",
  "goal.task_graph.claim",
  "goal.task_graph.complete",
  "goal.task_graph.block",
  "goal.task_graph.fail",
  "goal.task_graph.skip",
  "memory.configured_sources.update",
  "memory.tree.report.apply",
  "memory.tree.lifecycle.ensure",
  "memory.tree.node.rebuild",
  "memory.tree.source.rebuild",
  "memory.tree.score.rebuild",
  "memory.dedup.apply",
  "memory.share.queue",
  "memory.share.promote",
  "memory.share.review",
  "memory.share.claim",
  "experience.candidate.accept",
  "experience.candidate.reject",
  "experience.candidate.reject_bulk",
  "experience.candidate.cleanup_consumed",
  "experience.candidate.synthesize.create",
  "experience.usage.revoke",
  "experience.skill.freshness.update",
  "dream.consolidation.apply",
  "dream.commons.export_now",
  "workspace.write",
  "artifact.reveal",
  "workspace.remote_delivery.push.confirm",
  "workspace.remote_delivery.pull_request.confirm",
  "extension.runtime.revoke",
]);

function isReadMethod(method: string): boolean {
  return /(?:\.get|\.list|\.read|\.readSource|\.search|\.stats|\.status|\.report|\.preview|\.inspect|\.peek|\.export_markdown|\.explain_sources|\.recent_work|\.resume_context|\.similar_past_work)$/.test(method)
    || method === "tools.list"
    || method === "agents.list"
    || method === "agents.roster.get"
    || method === "system.doctor"
    || method === "conversation.meta"
    || method === "conversation.timeline.get"
    || method === "conversation.preflight_compression.retrieve"
    || method === "conversation.tool_result_reference.retrieve"
    || method === "coding.run.subscribe"
    || method === "workspace.change.review.verify_after_restore"
    || method === "workspace.worktree.diff"
    || method === "workspace.worktree.keep.preview"
    || method === "workspace.worktree.apply.preview"
    || method === "workspace.worktree.discard.preview"
    || method === "workspace.worktree.remove.preview"
    || method === "workspace.worktree.stage.preview"
    || method === "workspace.worktree.commit.preview"
    || method === "workspace.worktree.branch.preview"
    || method === "workspace.remote_delivery.targets"
    || method === "workspace.remote_delivery.push.preview"
    || method === "workspace.remote_delivery.pull_request.preview";
}

function resolveRisk(method: string): GatewayMethodRisk {
  if (BOOTSTRAP_METHODS.has(method)) return "bootstrap";
  if (CODE_EXECUTION_METHODS.has(method)) return "code-execution";
  if (ADMIN_METHODS.has(method)) return "admin";
  if (isReadMethod(method)) return "read";
  return "write";
}

function resolveRequiredCapability(risk: GatewayMethodRisk): GatewayCapability | undefined {
  switch (risk) {
    case "read":
      return "gateway.read";
    case "write":
      return "gateway.write";
    case "admin":
      return "gateway.admin";
    case "code-execution":
      return "workflow.execute";
    case "bootstrap":
      return undefined;
  }
}

function createGatewayMethodRegistry(): {
  registry: ReadonlyMap<string, GatewayMethodPolicy>;
  validationErrors: string[];
} {
  const registry = new Map<string, GatewayMethodPolicy>();
  const validationErrors: string[] = [];

  for (const method of GATEWAY_METHOD_NAMES) {
    if (registry.has(method)) {
      validationErrors.push(`duplicate gateway method: ${method}`);
      continue;
    }
    const risk = resolveRisk(method);
    const requiresPairing = !PUBLIC_METHODS.has(method) && !BOOTSTRAP_METHODS.has(method);
    registry.set(method, {
      method,
      advertised: true,
      // `pairing.approve` is the deliberate bootstrap exception. The CLI remains
      // available for an out-of-band approval when the inline WebChat flow is unavailable.
      requiresPairing,
      allowedRoles: ALL_GATEWAY_ROLES,
      risk,
      requiredCapability: requiresPairing ? resolveRequiredCapability(risk) : undefined,
    });
  }

  return { registry, validationErrors };
}

const CREATED_REGISTRY = createGatewayMethodRegistry();

export function getGatewayMethodPolicy(method: string): GatewayMethodPolicy | undefined {
  return CREATED_REGISTRY.registry.get(method);
}

export function getGatewayMethodRegistryInventory(): GatewayMethodPolicy[] {
  return [...CREATED_REGISTRY.registry.values()];
}

export function getAdvertisedGatewayMethods(): string[] {
  return getGatewayMethodRegistryInventory()
    .filter((policy) => policy.advertised)
    .map((policy) => policy.method);
}

export function validateGatewayMethodRegistry(): string[] {
  const errors = [...CREATED_REGISTRY.validationErrors];
  for (const policy of CREATED_REGISTRY.registry.values()) {
    if (!policy.method.trim()) errors.push("empty gateway method");
    if (policy.allowedRoles.length === 0) errors.push(`gateway method has no allowed roles: ${policy.method}`);
    if (policy.requiresPairing && !policy.requiredCapability) {
      errors.push(`paired gateway method has no capability: ${policy.method}`);
    }
  }
  return errors;
}
