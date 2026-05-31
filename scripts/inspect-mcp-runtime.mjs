import {
  initMCPIntegration,
  shutdownMCPIntegration,
  getMCPManagerIfInitialized,
} from "../packages/belldandy-core/src/mcp/index.ts";

function printJson(label, value) {
  console.log(`\n## ${label}`);
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  const manager = await initMCPIntegration();
  const runtime = getMCPManagerIfInitialized() ?? manager;
  const diagnostics = runtime.getDiagnostics();
  const allTools = runtime.getAllTools();
  const starweaverTools = allTools.filter((tool) =>
    String(tool.serverId).includes("starweaver") || String(tool.bridgedName).includes("starweaver"),
  );

  printJson("mcp-summary", {
    initialized: diagnostics.initialized,
    serverCount: diagnostics.serverCount,
    connectedCount: diagnostics.connectedCount,
    toolCount: diagnostics.toolCount,
  });

  printJson("mcp-servers", diagnostics.servers.map((server) => ({
    id: server.id,
    name: server.name,
    status: server.status,
    error: server.error ?? null,
    toolCount: server.toolCount,
    resourceCount: server.resourceCount,
    lastErrorKind: server.diagnostics?.lastErrorKind ?? null,
    lastErrorMessage: server.diagnostics?.lastErrorMessage ?? null,
    lastResultSource: server.diagnostics?.lastResult?.source ?? null,
    lastResultStrategy: server.diagnostics?.lastResult?.strategy ?? null,
  })));

  printJson("starweaver-tools", starweaverTools.map((tool) => ({
    serverId: tool.serverId,
    toolName: tool.name,
    bridgedName: tool.bridgedName,
  })));

  await shutdownMCPIntegration();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
