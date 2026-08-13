import crypto from "node:crypto";
import fs from "node:fs/promises";
import { atomicWriteGoalJson } from "./atomic-write.js";
import type {
  GoalTaskCheckpointStatus,
  GoalTaskGraph,
  GoalTaskNode,
  GoalTaskNodeCreateInput,
  GoalTaskNodeStatus,
  GoalTaskNodeTransitionInput,
  GoalTaskNodeUpdateInput,
  LongTermGoal,
} from "./types.js";

const TERMINAL_NODE_STATUSES = new Set<GoalTaskNodeStatus>(["done", "skipped"]);
const TRANSITION_DEPENDENCY_GUARD = new Set<GoalTaskNodeStatus>(["in_progress", "pending_review", "validating", "done"]);
const ALLOWED_TRANSITIONS: Record<GoalTaskNodeStatus, GoalTaskNodeStatus[]> = {
  draft: ["ready", "skipped"],
  ready: ["in_progress", "blocked", "skipped"],
  in_progress: ["blocked", "pending_review", "validating", "done", "failed"],
  blocked: ["ready", "in_progress", "pending_review", "skipped"],
  pending_review: ["validating", "in_progress", "done", "blocked"],
  validating: ["done", "in_progress", "blocked", "failed"],
  done: [],
  failed: ["ready", "in_progress", "blocked", "skipped"],
  skipped: [],
};

type GoalTaskGraphMutationResult = {
  graph: GoalTaskGraph;
  node: GoalTaskNode;
};

type GoalTaskGraphFileLike = {
  version?: unknown;
  goalId?: unknown;
  updatedAt?: unknown;
  nodes?: unknown;
  edges?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean),
  )];
}

function normalizeStatus(value: unknown): GoalTaskNodeStatus {
  const normalized = normalizeString(value);
  switch (normalized) {
    case "draft":
    case "ready":
    case "in_progress":
    case "blocked":
    case "pending_review":
    case "validating":
    case "done":
    case "failed":
    case "skipped":
      return normalized;
    default:
      return "draft";
  }
}

function normalizeCheckpointStatus(
  value: unknown,
  checkpointRequired: boolean,
): GoalTaskCheckpointStatus {
  const normalized = normalizeString(value);
  switch (normalized) {
    case "not_required":
    case "required":
    case "waiting_user":
    case "approved":
    case "rejected":
    case "expired":
      if (!checkpointRequired && normalized !== "not_required") {
        return "not_required";
      }
      return normalized;
    default:
      return checkpointRequired ? "required" : "not_required";
  }
}

function createNodeId(): string {
  return `node_${crypto.randomUUID().slice(0, 8)}`;
}

function createEdgeId(from: string, to: string): string {
  return `dep:${from}->${to}`;
}

function mergeStringArray(base: string[], patch?: string[]): string[] {
  if (!patch || patch.length === 0) return [...base];
  return [...new Set([...base, ...patch])];
}

function buildEdges(nodes: GoalTaskNode[]): GoalTaskGraph["edges"] {
  const edges: GoalTaskGraph["edges"] = [];
  for (const node of nodes) {
    for (const dependencyId of node.dependsOn) {
      edges.push({
        id: createEdgeId(dependencyId, node.id),
        from: dependencyId,
        to: node.id,
        kind: "depends_on",
      });
    }
  }
  return edges;
}

function normalizeNode(
  raw: unknown,
  now: string,
  fallbackId: string,
): GoalTaskNode {
  const source = isRecord(raw) ? raw : {};
  const id = normalizeString(source.id) ?? fallbackId;
  const checkpointRequired = Boolean(source.checkpointRequired);
  const status = normalizeStatus(source.status);

  return {
    id,
    title: normalizeString(source.title) ?? id,
    status,
    description: normalizeString(source.description),
    phase: normalizeString(source.phase),
    owner: normalizeString(source.owner),
    dependsOn: normalizeStringArray(source.dependsOn).filter((item) => item !== id),
    acceptance: normalizeStringArray(source.acceptance),
    artifacts: normalizeStringArray(source.artifacts),
    summary: normalizeString(source.summary),
    blockReason: normalizeString(source.blockReason),
    checkpointRequired,
    checkpointStatus: normalizeCheckpointStatus(source.checkpointStatus, checkpointRequired),
    lastRunId: normalizeString(source.lastRunId),
    metadata: isRecord(source.metadata) ? source.metadata : undefined,
    createdAt: normalizeString(source.createdAt) ?? now,
    updatedAt: normalizeString(source.updatedAt) ?? now,
    startedAt: normalizeString(source.startedAt),
    completedAt: normalizeString(source.completedAt),
    blockedAt: normalizeString(source.blockedAt),
  };
}

function assertUniqueNodeIds(nodes: GoalTaskNode[]): void {
  const seen = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.id)) {
      throw new Error(`Duplicate task node id: ${node.id}`);
    }
    seen.add(node.id);
  }
}

function assertDependenciesExist(nodes: GoalTaskNode[]): void {
  const ids = new Set(nodes.map((node) => node.id));
  for (const node of nodes) {
    for (const dependencyId of node.dependsOn) {
      if (!ids.has(dependencyId)) {
        throw new Error(`Task node "${node.id}" depends on missing node "${dependencyId}"`);
      }
      if (dependencyId === node.id) {
        throw new Error(`Task node "${node.id}" cannot depend on itself`);
      }
    }
  }
}

function assertAcyclic(nodes: GoalTaskNode[]): void {
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) {
    adjacency.set(node.id, node.dependsOn);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (nodeId: string) => {
    if (visited.has(nodeId)) return;
    if (visiting.has(nodeId)) {
      throw new Error(`Task graph contains a cycle at node "${nodeId}"`);
    }
    visiting.add(nodeId);
    for (const dependencyId of adjacency.get(nodeId) ?? []) {
      visit(dependencyId);
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
  };

  for (const node of nodes) {
    visit(node.id);
  }
}

function getNodeById(graph: GoalTaskGraph, nodeId: string): GoalTaskNode {
  const node = graph.nodes.find((item) => item.id === nodeId);
  if (!node) {
    throw new Error(`Task node not found: ${nodeId}`);
  }
  return node;
}

function areDependenciesSatisfied(graph: GoalTaskGraph, node: GoalTaskNode): boolean {
  return node.dependsOn.every((dependencyId) => {
    const dependency = graph.nodes.find((item) => item.id === dependencyId);
    return Boolean(dependency && TERMINAL_NODE_STATUSES.has(dependency.status));
  });
}

function assertStatusDependencies(graph: GoalTaskGraph, node: GoalTaskNode, status: GoalTaskNodeStatus): void {
  if (!TRANSITION_DEPENDENCY_GUARD.has(status)) return;
  if (!areDependenciesSatisfied(graph, node)) {
    throw new Error(`Task node "${node.id}" still has unfinished dependencies.`);
  }
}

function validateGraph(graph: GoalTaskGraph): GoalTaskGraph {
  assertUniqueNodeIds(graph.nodes);
  assertDependenciesExist(graph.nodes);
  assertAcyclic(graph.nodes);
  for (const node of graph.nodes) {
    assertStatusDependencies(graph, node, node.status);
  }
  return {
    ...graph,
    edges: buildEdges(graph.nodes),
  };
}

export function createEmptyGoalTaskGraph(goalId?: string): GoalTaskGraph {
  return {
    version: 2,
    goalId,
    updatedAt: new Date().toISOString(),
    nodes: [],
    edges: [],
  };
}

export function normalizeGoalTaskGraph(raw: unknown, goalId?: string): GoalTaskGraph {
  const now = new Date().toISOString();
  if (!isRecord(raw)) {
    return createEmptyGoalTaskGraph(goalId);
  }

  const source = raw as GoalTaskGraphFileLike;
  const nodesRaw = Array.isArray(source.nodes) ? source.nodes : [];
  const nodes = nodesRaw.map((item, index) => normalizeNode(item, now, `node_${index + 1}`));
  const graph: GoalTaskGraph = {
    version: 2,
    goalId: normalizeString(source.goalId) ?? goalId,
    updatedAt: normalizeString(source.updatedAt) ?? now,
    nodes,
    edges: [],
  };
  return validateGraph(graph);
}

export async function readGoalTaskGraph(goal: Pick<LongTermGoal, "id" | "tasksPath">): Promise<GoalTaskGraph> {
  try {
    const raw = await fs.readFile(goal.tasksPath, "utf-8");
    return normalizeGoalTaskGraph(JSON.parse(raw) as unknown, goal.id);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return createEmptyGoalTaskGraph(goal.id);
    }
    throw err;
  }
}

export async function writeGoalTaskGraph(
  goal: Pick<LongTermGoal, "id" | "tasksPath">,
  graph: GoalTaskGraph,
): Promise<GoalTaskGraph> {
  const normalized = validateGraph({
    ...graph,
    version: 2,
    goalId: goal.id,
    updatedAt: new Date().toISOString(),
  });
  await atomicWriteGoalJson(goal.tasksPath, normalized);
  return normalized;
}

export function createGoalTaskNode(
  graph: GoalTaskGraph,
  input: GoalTaskNodeCreateInput,
): GoalTaskGraphMutationResult {
  const now = new Date().toISOString();
  const id = normalizeString(input.id) ?? createNodeId();
  const initialStatus: GoalTaskNodeStatus = input.status ?? "draft";
  if (graph.nodes.some((node) => node.id === id)) {
    throw new Error(`Task node id already exists: ${id}`);
  }

  const checkpointRequired = Boolean(input.checkpointRequired);
  const node: GoalTaskNode = {
    id,
    title: input.title.trim(),
    status: initialStatus,
    description: normalizeString(input.description),
    phase: normalizeString(input.phase),
    owner: normalizeString(input.owner),
    dependsOn: normalizeStringArray(input.dependsOn).filter((item) => item !== id),
    acceptance: normalizeStringArray(input.acceptance),
    artifacts: [],
    summary: undefined,
    blockReason: undefined,
    checkpointRequired,
    checkpointStatus: normalizeCheckpointStatus(input.checkpointStatus, checkpointRequired),
    lastRunId: undefined,
    metadata: input.metadata,
    createdAt: now,
    updatedAt: now,
    startedAt: undefined,
    completedAt: initialStatus === "skipped" ? now : undefined,
    blockedAt: initialStatus === "blocked" ? now : undefined,
  };
  const nextGraph = validateGraph({
    ...graph,
    nodes: [...graph.nodes, node],
    updatedAt: now,
  });
  return { graph: nextGraph, node: getNodeById(nextGraph, id) };
}

export function updateGoalTaskNode(
  graph: GoalTaskGraph,
  nodeId: string,
  patch: GoalTaskNodeUpdateInput,
): GoalTaskGraphMutationResult {
  const current = getNodeById(graph, nodeId);
  const now = new Date().toISOString();
  const checkpointRequired = patch.checkpointRequired ?? current.checkpointRequired;
  const nextNode: GoalTaskNode = {
    ...current,
    title: patch.title?.trim() || current.title,
    description: patch.description === undefined ? current.description : normalizeString(patch.description),
    phase: patch.phase === undefined ? current.phase : normalizeString(patch.phase),
    owner: patch.owner === undefined ? current.owner : normalizeString(patch.owner),
    dependsOn: patch.dependsOn === undefined
      ? current.dependsOn
      : normalizeStringArray(patch.dependsOn).filter((item) => item !== nodeId),
    acceptance: patch.acceptance === undefined ? current.acceptance : normalizeStringArray(patch.acceptance),
    artifacts: patch.artifacts === undefined ? current.artifacts : normalizeStringArray(patch.artifacts),
    checkpointRequired,
    checkpointStatus: patch.checkpointStatus === undefined
      ? normalizeCheckpointStatus(current.checkpointStatus, checkpointRequired)
      : normalizeCheckpointStatus(patch.checkpointStatus, checkpointRequired),
    metadata: patch.metadata === undefined ? current.metadata : patch.metadata,
    updatedAt: now,
  };

  const nextGraph = validateGraph({
    ...graph,
    nodes: graph.nodes.map((node) => (node.id === nodeId ? nextNode : node)),
    updatedAt: now,
  });
  return { graph: nextGraph, node: getNodeById(nextGraph, nodeId) };
}

export function transitionGoalTaskNode(
  graph: GoalTaskGraph,
  nodeId: string,
  toStatus: GoalTaskNodeStatus,
  input: GoalTaskNodeTransitionInput = {},
): GoalTaskGraphMutationResult {
  const current = getNodeById(graph, nodeId);
  const now = new Date().toISOString();
  if (current.status !== toStatus && !ALLOWED_TRANSITIONS[current.status].includes(toStatus)) {
    throw new Error(`Invalid task node transition: ${current.status} -> ${toStatus}`);
  }

  const checkpointRequired = current.checkpointRequired;
  const nextNode: GoalTaskNode = {
    ...current,
    status: toStatus,
    owner: input.owner === undefined ? current.owner : normalizeString(input.owner),
    summary: input.summary === undefined ? current.summary : normalizeString(input.summary),
    blockReason: input.blockReason === undefined ? current.blockReason : normalizeString(input.blockReason),
    artifacts: mergeStringArray(current.artifacts, normalizeStringArray(input.artifacts)),
    checkpointStatus: input.checkpointStatus === undefined
      ? normalizeCheckpointStatus(current.checkpointStatus, checkpointRequired)
      : normalizeCheckpointStatus(input.checkpointStatus, checkpointRequired),
    lastRunId: normalizeString(input.runId) ?? current.lastRunId,
    updatedAt: now,
    startedAt: toStatus === "in_progress" ? current.startedAt ?? now : current.startedAt,
    completedAt: toStatus === "done" || toStatus === "skipped" ? now : current.completedAt,
    blockedAt: toStatus === "blocked" ? now : current.blockedAt,
  };

  const nextGraph = validateGraph({
    ...graph,
    nodes: graph.nodes.map((node) => (node.id === nodeId ? nextNode : node)),
    updatedAt: now,
  });
  assertStatusDependencies(nextGraph, nextNode, toStatus);
  return { graph: nextGraph, node: getNodeById(nextGraph, nodeId) };
}

export function getGoalTaskNodeTransitionMap(): Record<GoalTaskNodeStatus, GoalTaskNodeStatus[]> {
  return ALLOWED_TRANSITIONS;
}
