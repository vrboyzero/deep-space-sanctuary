import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  runCodingAgentCandidateGitDeliveryReceipt,
  CODING_AGENT_CANDIDATE_GIT_DELIVERY_RECEIPT_VERSION,
} from "./coding-agent-candidate-git-delivery-receipt.mjs";

export { runCodingAgentCandidateGitDeliveryReceipt, CODING_AGENT_CANDIDATE_GIT_DELIVERY_RECEIPT_VERSION };

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--aggregate-root") {
      if (options.aggregateRoot !== undefined || !argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error("--aggregate-root is required exactly once");
      options.aggregateRoot = path.resolve(argv[++index]);
    } else if (argv[index] === "--generated-at") {
      if (options.generatedAt !== undefined || !argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error("--generated-at is required at most once");
      options.generatedAt = argv[++index];
    } else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!options.aggregateRoot) throw new Error("--aggregate-root is required");
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCodingAgentCandidateGitDeliveryReceipt(parseArguments(process.argv.slice(2)))
    .then((receipt) => { process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`); })
    .catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
