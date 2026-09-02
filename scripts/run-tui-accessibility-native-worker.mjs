import path from "node:path";
import { pathToFileURL } from "node:url";

import { collectTuiAccessibilityPlatformObservation } from "./run-tui-performance-benchmark.mjs";

export function parseTuiAccessibilityNativeWorkerArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!["--platform", "--startup-timeout-seconds", "--state-dir"].includes(flag)
      || !value || value.startsWith("--") || values.has(flag)) {
      throw new Error("Invalid TUI accessibility native worker arguments.");
    }
    values.set(flag, value);
  }
  const platform = values.get("--platform");
  if (!["windows-native", "wsl2-linux"].includes(platform)) {
    throw new Error("TUI accessibility native worker platform is invalid.");
  }
  const startupTimeoutSeconds = Number(values.get("--startup-timeout-seconds"));
  if (!Number.isSafeInteger(startupTimeoutSeconds)
    || startupTimeoutSeconds < 5 || startupTimeoutSeconds > 120) {
    throw new Error("TUI accessibility native worker timeout is invalid.");
  }
  const stateDirValue = values.get("--state-dir");
  if (!stateDirValue) throw new Error("TUI accessibility native worker state dir is required.");
  return { platform, startupTimeoutSeconds, stateDir: path.resolve(stateDirValue) };
}

async function main() {
  const input = parseTuiAccessibilityNativeWorkerArguments(process.argv.slice(2));
  const result = await collectTuiAccessibilityPlatformObservation(input.platform, input);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entryUrl === import.meta.url) {
  main().then(
    () => process.exit(0),
    (error) => {
      process.stderr.write(`[tui-accessibility-worker] ${error.message}\n`, () => process.exit(1));
    },
  );
}
