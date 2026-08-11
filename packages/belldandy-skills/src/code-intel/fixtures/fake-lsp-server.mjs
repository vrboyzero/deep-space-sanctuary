import {
  ExitNotification,
  InitializeRequest,
  InitializedNotification,
  ShutdownRequest,
  createProtocolConnection,
} from "vscode-languageserver-protocol/node.js";

const ignoreExit = process.argv.includes("--ignore-exit");
const connection = createProtocolConnection(process.stdin, process.stdout);
let initializeParams;
let initialized = false;
const openedDocuments = [];

connection.onRequest(InitializeRequest.type, (params) => {
  initializeParams = params;
  return {
    capabilities: {
      definitionProvider: true,
      referencesProvider: true,
      workspaceSymbolProvider: true,
    },
    serverInfo: { name: "fake-lsp", version: "1.0.0" },
  };
});

connection.onNotification(InitializedNotification.type, () => {
  initialized = true;
});

connection.onRequest("test/echo", (params) => ({ params }));

connection.onRequest("test/state", () => ({
  initialized,
  rootUri: initializeParams?.rootUri,
  clientName: initializeParams?.clientInfo?.name,
}));

connection.onRequest("test/environment", (params) => {
  const keys = Array.isArray(params?.keys) ? params.keys : [];
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
});

connection.onNotification("textDocument/didOpen", (params) => {
  openedDocuments.push(params?.textDocument?.uri);
});

connection.onRequest("test/open-documents", () => [...openedDocuments]);

connection.onRequest("test/server-requests", async (params) => {
  const workspaceFolders = await connection.sendRequest("workspace/workspaceFolders");
  const configuration = await connection.sendRequest("workspace/configuration", {
    items: [
      { section: "gopls" },
      { section: "gopls.buildFlags" },
      { section: "unknown" },
    ],
  });
  const registration = await captureServerRequest("client/registerCapability", {
    registrations: [{
      id: "fake-registration",
      method: String(params?.registrationMethod ?? "workspace/didChangeConfiguration"),
      registerOptions: {},
    }],
  });
  const progress = await captureServerRequest("window/workDoneProgress/create", {
    token: "fake-progress",
  });
  const unknown = await captureServerRequest("workspace/applyEdit", {
    edit: { changes: {} },
  });
  return {
    workspaceFolders,
    configuration,
    registration,
    progress,
    unknown,
  };
});

connection.onRequest("test/start-work-done-progress", async (params) => {
  const token = "fake-work-done-progress";
  const start = async () => {
    await connection.sendRequest("window/workDoneProgress/create", { token });
    connection.sendNotification("$/progress", {
      token,
      value: { kind: "begin", title: "Loading workspace" },
    });
    setTimeout(() => {
      connection.sendNotification("$/progress", {
        token,
        value: { kind: "end", message: "Ready" },
      });
    }, Number(params?.delayMs ?? 50));
  };
  const startDelayMs = Number(params?.startDelayMs ?? 0);
  if (startDelayMs > 0) {
    setTimeout(() => void start(), startDelayMs);
  } else {
    await start();
  }
  return null;
});

connection.onRequest("test/stderr", (params) => {
  process.stderr.write(String(params?.text ?? ""));
  return null;
});

connection.onRequest("test/large-response", (params) => ({
  text: "x".repeat(Number(params?.bytes ?? 0)),
}));

connection.onRequest("test/hang", (_params, token) => new Promise((_resolve, reject) => {
  token.onCancellationRequested(() => {
    process.stderr.write("request-cancelled\n");
    reject(new Error("cancelled"));
  });
}));

connection.onRequest("test/crash", () => {
  setImmediate(() => process.exit(17));
  return new Promise(() => {});
});

connection.onRequest(ShutdownRequest.type, () => null);

connection.onNotification(ExitNotification.type, () => {
  if (!ignoreExit) {
    setImmediate(() => process.exit(0));
  }
});

connection.listen();

async function captureServerRequest(method, params) {
  try {
    return { ok: true, value: await connection.sendRequest(method, params) };
  } catch (error) {
    return {
      ok: false,
      code: typeof error?.code === "number" ? error.code : null,
      message: typeof error?.message === "string" ? error.message : "request rejected",
    };
  }
}
