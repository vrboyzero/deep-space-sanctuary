import {
  CODING_RUN_CLIENT_COMPATIBILITY,
  CODING_RUN_PROTOCOL_VERSION,
  CodingRunClient,
  type CodingRunClientOptions,
  type CodingRunClientRequestErrorCode,
} from "@belldandy/core/coding-run-client";

export type TypeScriptConsumerResult = {
  protocolVersion: typeof CODING_RUN_PROTOCOL_VERSION;
  compatibility: typeof CODING_RUN_CLIENT_COMPATIBILITY;
  operations: string[];
  contentMode: "none";
  checkedErrorCode: CodingRunClientRequestErrorCode;
};

export async function runTypeScriptConsumer(cwd: string): Promise<TypeScriptConsumerResult> {
  let requestIndex = 0;
  let client: CodingRunClient;
  const options = {
    createRequestId: () => `typescript-external-${++requestIndex}`,
    write: async (line: string) => {
      const request = JSON.parse(line) as { id: string; type: string };
      queueMicrotask(() => client.consume(`${JSON.stringify(responseFor(request))}\n`));
    },
  } satisfies CodingRunClientOptions;
  client = new CodingRunClient(options);

  const operations: string[] = [];
  await client.start({ prompt: "Inspect the workspace.", cwd });
  operations.push("start");
  await client.subscribeRun({ conversationId: "conversation-1", agentRunId: "run-1" });
  operations.push("subscribe");
  await client.respondPermission({ agentRunId: "run-1", toolCallId: "tool-allow", decision: "allow" });
  operations.push("respond_allow");
  await client.respondPermission({ agentRunId: "run-1", toolCallId: "tool-deny", decision: "deny" });
  operations.push("respond_deny");
  await client.cancel({ conversationId: "conversation-1", agentRunId: "run-1" });
  operations.push("cancel");
  await client.readArtifact({ agentRunId: "run-1" });
  operations.push("read_artifact");
  client.close();
  operations.push("close");

  return {
    protocolVersion: CODING_RUN_PROTOCOL_VERSION,
    compatibility: CODING_RUN_CLIENT_COMPATIBILITY,
    operations,
    contentMode: "none",
    checkedErrorCode: "request_timeout",
  };
}

function responseFor(request: { id: string; type: string }): object {
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
