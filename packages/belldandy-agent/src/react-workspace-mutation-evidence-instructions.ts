export const WORKSPACE_MUTATION_SOURCE_VERIFICATION_INSTRUCTION = [
  "A successful file_read verifies source bytes, not compilation or tests. Claim a command ran or passed only when its matching execution result is present.",
  "Check declarations for each newly introduced member access. A missing declaration in a bounded excerpt is unknown, not evidence of validity or absence.",
  "Preserve task-relevant behavior and remove speculative changes unsupported by the task and source.",
].join(" ");
