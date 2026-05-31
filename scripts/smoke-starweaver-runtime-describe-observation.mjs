import WebSocket from "ws";
import fs from "node:fs/promises";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check, timeoutMs = 180000, intervalMs = 200) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) {
      return;
    }
    await sleep(intervalMs);
  }
  throw new Error(`waitFor timeout after ${timeoutMs}ms`);
}

async function pairWebSocketClient(ws, frames) {
  await waitFor(() => frames.some((f) => f.type === "connect.challenge"));
  ws.send(JSON.stringify({ type: "connect", role: "web", auth: { mode: "none" } }));
  await waitFor(() => frames.some((f) => f.type === "hello-ok"));
  await waitFor(() => frames.some((f) => f.type === "event" && f.event === "pairing.required"));
  const pairing = frames.find((f) => f.type === "event" && f.event === "pairing.required");
  const code = pairing?.payload?.code ? String(pairing.payload.code) : "";
  if (!code) {
    throw new Error("pairing code missing");
  }
  const approveReqId = "req-pairing-approve";
  ws.send(JSON.stringify({
    type: "req",
    id: approveReqId,
    method: "pairing.approve",
    params: { code },
  }));
  await waitFor(() => frames.some((f) => f.type === "res" && f.id === approveReqId && f.ok === true));
}

function collectToolEvents(frames) {
  return frames.filter((frame) => frame.type === "event" && frame.event === "tool_event");
}

function collectTokenEvents(frames) {
  return frames.filter((frame) => frame.type === "event" && frame.event === "token.counter.result");
}

function toToolResultMap(frames) {
  const entries = frames
    .filter((frame) => frame.type === "event" && frame.event === "tool.result")
    .map((frame) => frame.payload ?? null)
    .filter(Boolean);
  return new Map(entries.map((item) => [item.toolCallId, item]));
}

function summarizeRound(toolDigests, toolResultMap, roundIndex) {
  const items = Array.isArray(toolDigests) ? toolDigests : [];
  const toolSearches = items.filter((item) => item.toolName === "tool_search");
  const runtimeDescribeCalls = items.filter((item) =>
    item.toolName === "mcp_starweaver_central_starweaver_runtime_describe"
    || item.toolName === "mcp_starweaver_starweaver_runtime_describe"
  );

  return {
    roundIndex,
    toolCount: items.length,
    toolSearch: {
      count: toolSearches.length,
      queries: toolSearches
        .map((item) => item.target ?? item.args?.query ?? null)
        .filter((item) => typeof item === "string"),
      selects: toolSearches
        .map((item) => item.args?.select ?? null)
        .filter((item) => Array.isArray(item)),
      contentChars: toolSearches.reduce((sum, item) => {
        const result = toolResultMap.get(item.toolCallId);
        return sum + Number(result?.contentChars ?? 0);
      }, 0)
    },
    runtimeDescribe: {
      count: runtimeDescribeCalls.length,
      toolNames: runtimeDescribeCalls.map((item) => item.toolName),
      contentChars: runtimeDescribeCalls.reduce((sum, item) => {
        const result = toolResultMap.get(item.toolCallId);
        return sum + Number(result?.contentChars ?? 0);
      }, 0)
    }
  };
}

function summarize(frames, conversationId) {
  const toolEvents = collectToolEvents(frames).filter((frame) => frame.payload?.conversationId === conversationId);
  const runtimeDescribeEvents = toolEvents.filter((frame) =>
    frame.payload?.toolName === "mcp_starweaver_central_starweaver_runtime_describe"
    || frame.payload?.toolName === "mcp_starweaver_starweaver_runtime_describe"
  );
  const tokenEvents = collectTokenEvents(frames).filter((frame) => frame.payload?.conversationId === conversationId);
  const runToken = tokenEvents.find((frame) => frame.payload?.name === "run")?.payload ?? null;
  const finalEvent = frames.find((frame) => frame.type === "event" && frame.event === "chat.final" && frame.payload?.conversationId === conversationId)?.payload ?? null;
  const metaPath = `H:\\.star_sanctuary\\sessions\\${conversationId}.meta.json`;
  const toolResultMap = toToolResultMap(frames);

  const roundBoundaries = [];
  for (const frame of frames) {
    if (
      frame.type === "event"
      && frame.event === "chat.final"
      && frame.payload?.conversationId === conversationId
    ) {
      roundBoundaries.push(frame.payload?.runId ?? null);
    }
  }

  const roundRuns = roundBoundaries.filter(Boolean);
  const roundToolDigests = roundRuns.map((runId) =>
    toolEvents
      .filter((frame) => frame.payload?.runId === runId)
      .map((frame) => frame.payload)
  );

  return {
    conversationId,
    metaPath,
    runtimeDescribe: {
      toolEventCount: runtimeDescribeEvents.length,
      toolNames: runtimeDescribeEvents.map((frame) => frame.payload?.toolName ?? null),
      payloads: runtimeDescribeEvents.map((frame) => frame.payload ?? null),
    },
    stableSummary: {
      roundCount: roundToolDigests.length,
      rounds: roundToolDigests.map((items, index) =>
        summarizeRound(items, toolResultMap, index + 1)
      ),
      secondTurnStillRepeatsToolSearch:
        Boolean(roundToolDigests[1]?.some((item) => item.toolName === "tool_search")),
      secondTurnStillRepeatsRuntimeDescribe:
        Boolean(
          roundToolDigests[1]?.some((item) =>
            item.toolName === "mcp_starweaver_central_starweaver_runtime_describe"
            || item.toolName === "mcp_starweaver_starweaver_runtime_describe"
          )
        )
    },
    toolEventCount: toolEvents.length,
    tokenEventCount: tokenEvents.length,
    runTokenResult: runToken,
    runTokenResults: tokenEvents.map((frame) => frame.payload ?? null),
    finalText: finalEvent?.text ?? null,
    lastToolEvents: toolEvents.slice(-12).map((frame) => frame.payload ?? null),
  };
}

async function summarizeFromMeta(conversationId) {
  const metaPath = `H:\\.star_sanctuary\\sessions\\${conversationId}.meta.json`;
  const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
  const toolDigests = Array.isArray(meta?.toolDigests) ? meta.toolDigests : [];
  const recentToolResults = Array.isArray(meta?.recentToolResults) ? meta.recentToolResults : [];
  const toolResultMap = new Map(
    recentToolResults
      .filter((item) => item?.toolCallId)
      .map((item) => [item.toolCallId, item])
  );

  const runTokens = Array.isArray(meta?.taskTokenRecords)
    ? meta.taskTokenRecords.filter((item) => item?.name === "run")
    : [];
  const chronologicalRuns = [...runTokens].sort(
    (left, right) => Number(left?.createdAt ?? 0) - Number(right?.createdAt ?? 0)
  );

  const firstToolSearchIndex = toolDigests.findIndex((item) => item?.toolName === "tool_search");
  const secondTurnToolSearchIndex =
    firstToolSearchIndex >= 0
      ? toolDigests.findIndex(
          (item, index) => index > firstToolSearchIndex && item?.toolName === "tool_search"
        )
      : -1;

  const roundOneItems =
    secondTurnToolSearchIndex > 0 ? toolDigests.slice(0, secondTurnToolSearchIndex) : toolDigests;
  const roundTwoItems =
    secondTurnToolSearchIndex > 0 ? toolDigests.slice(secondTurnToolSearchIndex) : [];

  return {
    conversationId,
    metaPath,
    stableSummary: {
      roundCount: roundTwoItems.length > 0 ? 2 : 1,
      rounds: [
        summarizeRound(roundOneItems, toolResultMap, 1),
        ...(roundTwoItems.length > 0 ? [summarizeRound(roundTwoItems, toolResultMap, 2)] : [])
      ],
      secondTurnStillRepeatsToolSearch: roundTwoItems.some((item) => item?.toolName === "tool_search"),
      secondTurnStillRepeatsRuntimeDescribe: roundTwoItems.some((item) =>
        item?.toolName === "mcp_starweaver_central_starweaver_runtime_describe"
        || item?.toolName === "mcp_starweaver_starweaver_runtime_describe"
      )
    },
    runTokenResults: chronologicalRuns.map((item) => ({
      name: item.name,
      inputTokens: item.inputTokens,
      outputTokens: item.outputTokens,
      totalTokens: item.totalTokens,
      durationMs: item.durationMs,
      createdAt: item.createdAt
    })),
    toolDigests,
    recentToolResults
  };
}

async function main() {
  const host = process.env.STAR_WEAVER_OBSERVE_HOST || "127.0.0.1";
  const port = Number(process.env.STAR_WEAVER_OBSERVE_PORT || "28889");
  const allowedStarweaverTools = [
    "mcp_starweaver_central_starweaver_runtime_describe",
    "mcp_starweaver_central_starweaver_wake_signals_peek",
    "mcp_starweaver_central_starweaver_command_peek",
    "mcp_starweaver_central_starweaver_agent_delivery_peek",
  ];
  const exactStarweaverToolSearchQuery =
    "starweaver_runtime_describe starweaver_wake_signals_peek starweaver_command_peek starweaver_agent_delivery_peek";
  const prompt = process.argv.slice(2).join(" ").trim()
    || [
      "这是一次性能验收测试，不是正式业务会话。",
      "你现在连接的是 starweaver-central。",
      "本轮只允许使用以下 4 个 StarWeaver 工具：",
      allowedStarweaverTools.map((name) => `- ${name}`).join("\n"),
      "不要改用 bridge_*、ptc_runtime、list_files、file_read、web_fetch、tool_settings_control、browser 或其它任何替代链路。",
      "如果当前看不到这 4 个工具，只允许先用一次 tool_search 精确检索并 select 这 4 个工具本身。",
      `tool_search.query 只允许使用这一条固定词串：${exactStarweaverToolSearchQuery}`,
      "禁止使用 `starweaver_central`、`starweaver`、family 名、主题词、模糊缩写或任何更宽泛 query。",
      "如果 query 已命中这 4 个 exact tools，必须在同一轮立刻 select；不要先只 query 再等下一轮补 select。",
      "不要扩展到无关 family，不要改查别的工具族。",
      "拿到这 4 个工具后，先调用 runtime_describe，再调用 wake_signals_peek、command_peek、agent_delivery_peek。",
      "如果拿到相同 actorId/sessionId/gameId 的上下文，不要重复读取 runtime_describe。",
      "最后只返回一句中文测试摘要。",
    ].join("\n");
  const followupPrompt = [
    "这是同一场性能验收测试的第二轮，不是正式业务会话。",
    "仍然只允许使用同一组 4 个 StarWeaver 工具：",
    allowedStarweaverTools.map((name) => `- ${name}`).join("\n"),
    "沿用刚才同一会话里已经拿到的 StarWeaver 运行态与相同上下文继续判断。",
    "如果 actorId/sessionId/gameId 没变，不要重复调用 runtime_describe。",
    "不要改用 bridge_*、ptc_runtime、list_files、file_read、web_fetch、tool_settings_control、browser 或其它任何替代链路。",
    "只需要再确认 wake_signals_peek、command_peek、agent_delivery_peek 是否仍为空，并返回一句中文测试摘要。"
  ].join("\n");

  const ws = new WebSocket(`ws://${host}:${port}`, { origin: `http://${host}:${port}` });
  const frames = [];
  const closeP = new Promise((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => {
    frames.push(JSON.parse(data.toString("utf-8")));
  });

  const conversationId = `conv-starweaver-observe-${Date.now()}`;
  try {
    await pairWebSocketClient(ws, frames);
    frames.length = 0;

    const reqId = "starweaver-observation-1";
    ws.send(JSON.stringify({
      type: "req",
      id: reqId,
      method: "message.send",
      params: {
        conversationId,
        text: prompt,
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === reqId && f.ok === true));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "chat.final" && f.payload?.conversationId === conversationId));
    await waitFor(() => frames.some((f) => f.type === "event" && f.event === "token.counter.result" && f.payload?.conversationId === conversationId));

    const firstRunId = frames.find((f) => f.type === "event" && f.event === "chat.final" && f.payload?.conversationId === conversationId)?.payload?.runId;

    const reqId2 = "starweaver-observation-2";
    ws.send(JSON.stringify({
      type: "req",
      id: reqId2,
      method: "message.send",
      params: {
        conversationId,
        text: followupPrompt,
      },
    }));

    await waitFor(() => frames.some((f) => f.type === "res" && f.id === reqId2 && f.ok === true));
    await waitFor(() => frames.some((f) =>
      f.type === "event"
      && f.event === "chat.final"
      && f.payload?.conversationId === conversationId
      && f.payload?.runId !== firstRunId
    ));
    await waitFor(() => collectTokenEvents(frames).filter((f) => f.payload?.conversationId === conversationId).length >= 2);

    const summary = await summarizeFromMeta(conversationId);
    const forbiddenToolDigests = (summary.toolDigests ?? []).filter((item) => {
      const name = String(item?.toolName ?? "");
      if (!name || name === "tool_search") {
        return false;
      }
      return !allowedStarweaverTools.includes(name);
    });
    if (forbiddenToolDigests.length > 0) {
      throw new Error(`observation smoke drifted to non-StarWeaver tools: ${forbiddenToolDigests.map((item) => item.toolName).join(", ")}`);
    }
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      conversationId,
      frameCount: frames.length,
      framesTail: frames.slice(-24),
      summary: await summarizeFromMeta(conversationId).catch(() => summarize(frames, conversationId)),
    }, null, 2));
    throw error;
  } finally {
    ws.close();
    await closeP;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
