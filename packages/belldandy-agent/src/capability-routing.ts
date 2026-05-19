export function buildCapabilityRoutingIndexLines(): string[] {
  return [
    "## Capability Routing",
    "Use the smallest matching entrypoint first; discover before opening full instructions or schemas.",
    "- SOPs / reusable workflows: use `method_search` (or `method_list`) to find candidates, then `method_read` to open the exact method.",
    "- Skills / domain instructions: use `skills_search` to discover candidates, then `skill_get` to open the exact skill you decide to adopt.",
    "- Heavy builtin tools or MCP tools not currently visible: use `tool_search` first, then load/select only the exact schema needed for the next turn.",
    "- Runtime governance / diagnostics / metadata are queried through RPC surfaces; do not confuse them with native tool-calling paths.",
  ];
}

export function buildCapabilityUsageNotesLines(): string[] {
  return [
    "Usage notes:",
    "- Searching alone does not count as usage.",
    "- `method_read` and `skill_get` auto-record usage when the current conversation already has a task.",
    "- If you adopted a method or skill through another path, call `experience_usage_record` manually; if recorded by mistake, use `experience_usage_revoke` on the current task.",
  ];
}
