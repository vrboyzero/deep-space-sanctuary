import type { MCPManager } from "@belldandy/mcp";

type McpCallResult = Awaited<ReturnType<MCPManager["callTool"]>>;

function normalizeText(value: string): string | null {
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function stringifyDetail(value: unknown): string | null {
  if (typeof value === "string") {
    return normalizeText(value);
  }

  if (value === null || value === undefined) {
    return null;
  }

  try {
    const text = JSON.stringify(value, null, 2);
    return normalizeText(text);
  } catch {
    return normalizeText(String(value));
  }
}

export function formatMcpToolError(
  result: McpCallResult,
  fallbackMessage: string
): string {
  const details: string[] = [];
  const pushDetail = (value: unknown) => {
    const text = stringifyDetail(value);
    if (text && !details.includes(text)) {
      details.push(text);
    }
  };

  pushDetail(result.error);
  pushDetail(result.structuredContent);

  for (const item of result.content ?? []) {
    if (item.type === "text") {
      pushDetail(item.text);
      continue;
    }

    pushDetail(item);
  }

  if (details.length === 0) {
    return fallbackMessage;
  }

  return `${fallbackMessage}\n${details.join("\n\n")}`;
}
