import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CODING_RUN_CLIENT_COMPATIBILITY,
  CODING_RUN_PROTOCOL_VERSION,
  CodingRunClient,
} from "@belldandy/core/coding-run-client";

export async function runExternalConsumer(cwd) {
  let requestIndex = 0;
  let client;
  client = new CodingRunClient({
    createRequestId: () => `external-${++requestIndex}`,
    write: async (line) => {
      const request = JSON.parse(line);
      queueMicrotask(() => client.consume(`${JSON.stringify(responseFor(request))}\n`));
    },
  });

  const operations = [];
  await client.start({ prompt: "Inspect the workspace.", cwd }); operations.push("start");
  await client.subscribeRun({ conversationId: "conversation-1", agentRunId: "run-1" }); operations.push("subscribe");
  await client.respondPermission({ agentRunId: "run-1", toolCallId: "tool-allow", decision: "allow" }); operations.push("respond_allow");
  await client.respondPermission({ agentRunId: "run-1", toolCallId: "tool-deny", decision: "deny" }); operations.push("respond_deny");
  await client.cancel({ conversationId: "conversation-1", agentRunId: "run-1" }); operations.push("cancel");
  await client.readArtifact({ agentRunId: "run-1" }); operations.push("read_artifact");
  client.close(); operations.push("close");

  return {
    protocolVersion: CODING_RUN_PROTOCOL_VERSION,
    compatibility: CODING_RUN_CLIENT_COMPATIBILITY,
    operations,
    contentMode: "none",
  };
}

function responseFor(request) {
  const type = request.type.replace("request", "response");
  if (request.type === "conversation.request") {
    return {
      version: "v1",
      type,
      id: request.id,
      ok: true,
      result: { binding: { conversationId: "conversation-1", agentRunId: "run-1" } },
    };
  }
  return {
    version: "v1",
    type,
    id: request.id,
    ok: true,
    result: { accepted: true, contentMode: "none" },
  };
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(fileURLToPath(import.meta.url))) {
  runExternalConsumer(process.argv[2])
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
