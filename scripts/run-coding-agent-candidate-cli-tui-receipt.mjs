import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  runCodingAgentCandidateCliTuiReceipt,
  CODING_AGENT_CANDIDATE_CLI_TUI_RECEIPT_VERSION,
} from "./coding-agent-candidate-cli-tui-receipt.mjs";

export { runCodingAgentCandidateCliTuiReceipt, CODING_AGENT_CANDIDATE_CLI_TUI_RECEIPT_VERSION };

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--aggregate-root") {
      if (options.aggregateRoot !== undefined || !argv[index + 1] || argv[index + 1].startsWith("--")) {
        throw new Error("--aggregate-root is required exactly once");
      }
      options.aggregateRoot = path.resolve(argv[index + 1]);
      index += 1;
    } else if (argv[index] === "--generated-at") {
      if (options.generatedAt !== undefined || !argv[index + 1] || argv[index + 1].startsWith("--")) {
        throw new Error("--generated-at is required at most once");
      }
      options.generatedAt = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`unknown argument ${String(argv[index])}`);
    }
  }
  if (options.aggregateRoot === undefined) throw new Error("--aggregate-root is required");
  return options;
}

async function main() {
  const receipt = await runCodingAgentCandidateCliTuiReceipt(parseArguments(process.argv.slice(2)));
  console.log(`[coding-agent-candidate-cli-tui] wrote ${receipt.schemaVersion}.`);
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`[coding-agent-candidate-cli-tui] failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
