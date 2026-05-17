import { expect, test } from "vitest";

import { inspectMcpConfigRouting } from "./mcp-config-routing.js";

test("inspectMcpConfigRouting flags placeholder SSE API key on starweaver-central", () => {
  const report = inspectMcpConfigRouting({
    mcpServers: {
      starweaver: {
        command: "node",
        autoConnect: false,
      },
      "starweaver-central": {
        url: "http://127.0.0.1:28767/sse",
        headers: {
          Authorization: "Bearer replace-with-your-sse-api-key",
        },
      },
    },
  }, "mcp.json", {
    target: "127.0.0.1:28767",
    reachable: true,
  });

  expect(report.starweaver.status).toBe("central_primary_placeholder_key");
  expect(report.starweaver.headline).toContain("placeholder API key");
  expect(report.starweaver.central?.authHeaderPlaceholder).toBe(true);
});

test("inspectMcpConfigRouting flags unreachable shared host when starweaver-central is primary", () => {
  const report = inspectMcpConfigRouting({
    mcpServers: {
      "starweaver-central": {
        url: "http://127.0.0.1:28767/sse",
        headers: {
          Authorization: "Bearer real-key",
        },
      },
    },
  }, "mcp.json", {
    target: "127.0.0.1:28767",
    reachable: false,
    error: "ECONNREFUSED",
  });

  expect(report.starweaver.status).toBe("central_primary_unreachable");
  expect(report.starweaver.headline).toContain("shared host is unreachable");
  expect(report.starweaver.runtimeProbe).toEqual({
    target: "127.0.0.1:28767",
    reachable: false,
    error: "ECONNREFUSED",
  });
});

test("inspectMcpConfigRouting reports local fallback active when local starweaver still auto-connects", () => {
  const report = inspectMcpConfigRouting({
    mcpServers: {
      starweaver: {
        command: "node",
        autoConnect: true,
      },
      "starweaver-central": {
        url: "http://127.0.0.1:28767/sse",
        headers: {
          Authorization: "Bearer real-key",
        },
      },
    },
  }, "mcp.json", {
    target: "127.0.0.1:28767",
    reachable: true,
  });

  expect(report.starweaver.status).toBe("local_fallback_active");
  expect(report.starweaver.headline).toContain("local starweaver stdio");
  expect(report.starweaver.local?.id).toBe("starweaver");
  expect(report.starweaver.central?.id).toBe("starweaver-central");
});
