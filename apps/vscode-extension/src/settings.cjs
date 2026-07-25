const path = require("node:path");

const DEFAULT_CODING_RUN_COMMAND = "bdd";

function resolveCodingRunCommand(value) {
  return normalizeInput(value) ?? DEFAULT_CODING_RUN_COMMAND;
}

function resolveCodingRunStateDir(value) {
  const stateDir = normalizeInput(value);
  return stateDir && path.isAbsolute(stateDir) ? stateDir : undefined;
}

function normalizeInput(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || /[\u0000-\u001f\u007f]/.test(normalized)) return undefined;
  return normalized;
}

module.exports = {
  resolveCodingRunCommand,
  resolveCodingRunStateDir,
};
