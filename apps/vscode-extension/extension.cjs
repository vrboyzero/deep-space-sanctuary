const vscode = require("vscode");

const { CodingRunStdioClient } = require("./src/stdio-client.cjs");
const { resolveCodingRunCommand, resolveCodingRunStateDir } = require("./src/settings.cjs");
const { readConversationBinding, resolveWorkspaceCwd } = require("./src/conversation-request.cjs");
const { createCodingRunStreamOutput } = require("./src/stream-output.cjs");
const {
  isPermissionToolCompleted,
  readPermissionRequest,
  summarizePermissionRequest,
} = require("./src/permission-request.cjs");

let runtime;

function activate(context) {
  runtime = createExtensionRuntime(vscode);
  runtime.register(context);
}

function deactivate() {
  runtime?.dispose();
  runtime = undefined;
}

function createExtensionRuntime(api) {
  const output = api.window.createOutputChannel("Star Sanctuary Coding Runs");
  const streamOutput = api.window.createOutputChannel("Star Sanctuary Coding Stream");
  const stream = createCodingRunStreamOutput(streamOutput);
  const status = api.window.createStatusBarItem(api.StatusBarAlignment.Left, 100);
  const provider = new CodingRunTreeProvider(api, () => runtimeState);
  let runtimeState = {
    bridge: "stopped",
    eventCount: 0,
    subscription: "No subscription",
    lastEvent: "No events",
    lastSeq: undefined,
    binding: undefined,
    pendingPermission: undefined,
    permission: "No pending tool approval",
  };
  let client;

  const refresh = () => {
    status.text = `$(radio-tower) Star Sanctuary: ${runtimeState.bridge}`;
    status.tooltip = "Star Sanctuary Coding Run Bridge";
    status.command = "starSanctuary.codingRun.ask";
    status.show();
    provider.refresh();
    void api.commands.executeCommand("setContext", "starSanctuary.codingRunState", runtimeState.bridge);
  };

  const appendDiagnostic = (message) => {
    output.appendLine(`[coding-run] ${safeMessage(message)}`);
  };

  const ensureClient = async () => {
    if (!client || client.state === "error") {
      const configuration = api.workspace.getConfiguration("starSanctuary");
      const command = resolveCodingRunCommand(configuration.get("codingRun.command"));
      const stateDir = resolveCodingRunStateDir(configuration.get("codingRun.stateDir"));
      client = new CodingRunStdioClient({
        command,
        stateDir,
        onStateChange: (bridge) => {
          runtimeState = { ...runtimeState, bridge };
          refresh();
        },
        onEvent: (event) => {
          stream.appendEvent(event);
          const pendingPermission = readPermissionRequest(event);
          const completedPendingPermission = runtimeState.pendingPermission
            && isPermissionToolCompleted(event, runtimeState.pendingPermission);
          runtimeState = {
            ...runtimeState,
            eventCount: runtimeState.eventCount + 1,
            subscription: isTerminalRunEvent(event.type) ? "Completed" : "Active",
            lastEvent: pendingPermission
              ? `Permission requested: ${summarizePermissionRequest(pendingPermission)}`
              : summarizeRunEvent(event),
            lastSeq: event.seq,
            binding: { ...event.binding },
            pendingPermission: pendingPermission
              ?? (isTerminalRunEvent(event.type) || completedPendingPermission ? undefined : runtimeState.pendingPermission),
            permission: pendingPermission
              ? `Awaiting decision: ${summarizePermissionRequest(pendingPermission)}`
              : (isTerminalRunEvent(event.type) || completedPendingPermission
                ? "No pending tool approval"
                : runtimeState.permission),
          };
          if (pendingPermission) {
            appendDiagnostic(`Tool permission requested: ${summarizePermissionRequest(pendingPermission)}.`);
          }
          provider.refresh();
        },
        onSubscriptionError: (error) => {
          runtimeState = {
            ...runtimeState,
            subscription: `Interrupted: ${error.code}`,
            lastEvent: "Subscription interrupted",
          };
          provider.refresh();
          appendDiagnostic(`Subscription interrupted: ${error.code}`);
        },
        onProtocolError: (error) => appendDiagnostic(`Protocol ${error.code}: ${error.message}`),
      });
    }
    await client.start();
    appendDiagnostic("Bridge started.");
    return client;
  };

  const start = async () => {
    try {
      await ensureClient();
      void api.window.showInformationMessage("Star Sanctuary coding-run bridge is running.");
    } catch (error) {
      appendDiagnostic(error);
      void api.window.showErrorMessage(`Star Sanctuary bridge could not start: ${safeMessage(error)}`);
    }
  };

  const stop = () => {
    client?.stop();
    runtimeState = {
      bridge: "stopped",
      eventCount: 0,
      subscription: "No subscription",
      lastEvent: "No events",
      lastSeq: undefined,
      binding: undefined,
      pendingPermission: undefined,
      permission: "No pending tool approval",
    };
    refresh();
    appendDiagnostic("Bridge stopped.");
  };

  const cancelConversation = async () => {
    const conversationId = await promptRequired(api, "Conversation ID");
    if (!conversationId) return;
    const agentRunId = await promptRequired(api, "Conversation run ID");
    if (!agentRunId) return;
    const reason = await api.window.showInputBox({ prompt: "Cancellation reason (optional)", ignoreFocusOut: true });
    await runControl(api, appendDiagnostic, async () => (await ensureClient()).cancelConversation({
      conversationId,
      agentRunId,
      ...(reason?.trim() ? { reason } : {}),
    }));
  };

  const cancelWorkflow = async () => {
    const journalId = await promptRequired(api, "Workflow Journal ID");
    if (!journalId) return;
    const workflowRunId = await promptRequired(api, "Workflow runtime run ID");
    if (!workflowRunId) return;
    const reason = await api.window.showInputBox({ prompt: "Cancellation reason (optional)", ignoreFocusOut: true });
    await runControl(api, appendDiagnostic, async () => (await ensureClient()).cancelWorkflow({
      journalId,
      workflowRunId,
      ...(reason?.trim() ? { reason } : {}),
    }));
  };

  const subscribeBinding = async (binding, cursor, resetState = true) => {
    try {
      runtimeState = {
        ...runtimeState,
        ...(resetState ? { eventCount: 0 } : {}),
        subscription: "Subscribing",
        lastEvent: "Awaiting Gateway events",
        binding: { ...binding },
        pendingPermission: undefined,
        permission: "No pending tool approval",
      };
      refresh();
      const result = await (await ensureClient()).subscribeConversation({
        ...binding,
        ...(cursor === undefined ? {} : { cursor }),
      });
      if (!result.ok) {
        runtimeState = { ...runtimeState, subscription: `Rejected: ${result.error.code}` };
        refresh();
        appendDiagnostic(`Subscription rejected: ${result.error.code}`);
        void api.window.showWarningMessage(`Star Sanctuary subscription was rejected: ${safeMessage(result.error.message)}`);
        return false;
      }
      runtimeState = { ...runtimeState, subscription: "Active" };
      refresh();
      appendDiagnostic("Conversation event subscription accepted.");
      return true;
    } catch (error) {
      runtimeState = { ...runtimeState, subscription: "Interrupted" };
      refresh();
      appendDiagnostic(error);
      void api.window.showErrorMessage(`Star Sanctuary subscription failed: ${safeMessage(error)}`);
      return false;
    }
  };

  const subscribeConversation = async () => {
    const conversationId = await promptRequired(api, "Conversation ID");
    if (!conversationId) return;
    const agentRunId = await promptRequired(api, "Conversation run ID");
    if (!agentRunId) return;
    const cursor = runtimeState.binding
      && runtimeState.binding.conversationId === conversationId
      && runtimeState.binding.agentRunId === agentRunId
      ? runtimeState.lastSeq
      : undefined;
    await subscribeBinding({ conversationId, agentRunId }, cursor);
  };

  const ask = async () => {
    const cwd = resolveWorkspaceCwd(api.workspace, api.window.activeTextEditor?.document?.uri);
    if (!cwd) {
      void api.window.showWarningMessage("Open a local workspace folder before starting a Star Sanctuary coding run.");
      return;
    }
    const text = await api.window.showInputBox({
      prompt: "Coding request for the active workspace",
      ignoreFocusOut: true,
      validateInput: (value) => normalizeInput(value) ? undefined : "A coding request is required.",
    });
    if (!text) return;
    const conversationId = runtimeState.binding?.conversationId;
    stream.reset();
    streamOutput.show(true);
    runtimeState = {
      ...runtimeState,
      eventCount: 0,
      subscription: "Starting",
      lastEvent: "Sending workspace request",
      lastSeq: undefined,
      binding: undefined,
      pendingPermission: undefined,
      permission: "No pending tool approval",
    };
    refresh();
    try {
      const result = await (await ensureClient()).requestConversation({
        text,
        cwd,
        ...(conversationId ? { conversationId } : {}),
      });
      if (!result.ok) {
        runtimeState = { ...runtimeState, subscription: `Rejected: ${result.error.code}` };
        refresh();
        appendDiagnostic(`Conversation request rejected: ${result.error.code}`);
        void api.window.showWarningMessage(`Star Sanctuary coding request was rejected: ${safeMessage(result.error.message)}`);
        return;
      }
      const binding = readConversationBinding(result.result);
      if (!binding) {
        runtimeState = { ...runtimeState, subscription: "Interrupted" };
        refresh();
        appendDiagnostic("Conversation request returned an incomplete binding.");
        void api.window.showErrorMessage("Star Sanctuary coding request returned an invalid Conversation binding.");
        return;
      }
      await subscribeBinding(binding, undefined, false);
    } catch (error) {
      runtimeState = { ...runtimeState, subscription: "Interrupted" };
      refresh();
      appendDiagnostic(error);
      void api.window.showErrorMessage(`Star Sanctuary coding request failed: ${safeMessage(error)}`);
    }
  };

  const viewChanges = async () => {
    try {
      await api.commands.executeCommand("workbench.view.scm");
    } catch (error) {
      appendDiagnostic(error);
      void api.window.showErrorMessage(`Star Sanctuary could not open Source Control: ${safeMessage(error)}`);
    }
  };

  const respondPermission = async (decision) => {
    const pendingPermission = runtimeState.pendingPermission;
    if (!pendingPermission) {
      void api.window.showWarningMessage("Star Sanctuary has no pending tool approval.");
      return;
    }
    const summary = summarizePermissionRequest(pendingPermission);
    runtimeState = {
      ...runtimeState,
      permission: `Submitting ${decision}: ${summary}`,
    };
    refresh();
    try {
      const result = await (await ensureClient()).respondPermission({
        agentRunId: pendingPermission.agentRunId,
        ...(pendingPermission.worktreeId ? { worktreeId: pendingPermission.worktreeId } : {}),
        toolCallId: pendingPermission.toolCallId,
        decision,
      });
      if (result.ok) {
        runtimeState = {
          ...runtimeState,
          pendingPermission: undefined,
          permission: "No pending tool approval",
          lastEvent: `Permission ${decision}ed: ${summary}`,
        };
        refresh();
        appendDiagnostic(`Tool permission ${decision}ed: ${summary}.`);
        void api.window.showInformationMessage(`Star Sanctuary tool permission ${decision}ed.`);
        return;
      }
      const isStale = result.error.code === "not_found"
        || result.error.code === "run_mismatch"
        || result.error.code === "permission_denied";
      runtimeState = {
        ...runtimeState,
        ...(isStale ? { pendingPermission: undefined, permission: "No pending tool approval" } : { permission: `Awaiting decision: ${summary}` }),
      };
      refresh();
      appendDiagnostic(`Tool permission rejected: ${result.error.code}`);
      void api.window.showWarningMessage(`Star Sanctuary permission was rejected: ${safeMessage(result.error.message)}`);
    } catch (error) {
      runtimeState = { ...runtimeState, permission: `Awaiting decision: ${summary}` };
      refresh();
      appendDiagnostic(error);
      void api.window.showErrorMessage(`Star Sanctuary permission failed: ${safeMessage(error)}`);
    }
  };

  return {
    register(context) {
      context.subscriptions.push(
        output,
        streamOutput,
        status,
        api.window.registerTreeDataProvider("starSanctuary.codingRuns", provider),
        api.commands.registerCommand("starSanctuary.codingRun.start", start),
        api.commands.registerCommand("starSanctuary.codingRun.stop", stop),
        api.commands.registerCommand("starSanctuary.codingRun.cancelConversation", cancelConversation),
        api.commands.registerCommand("starSanctuary.codingRun.cancelWorkflow", cancelWorkflow),
        api.commands.registerCommand("starSanctuary.codingRun.subscribeConversation", subscribeConversation),
        api.commands.registerCommand("starSanctuary.codingRun.allowPermission", () => respondPermission("allow")),
        api.commands.registerCommand("starSanctuary.codingRun.denyPermission", () => respondPermission("deny")),
        api.commands.registerCommand("starSanctuary.codingRun.ask", ask),
        api.commands.registerCommand("starSanctuary.codingRun.viewChanges", viewChanges),
        { dispose: () => client?.stop() },
      );
      refresh();
    },
    dispose() {
      client?.stop();
      status.dispose();
      output.dispose();
      streamOutput.dispose();
    },
  };
}

class CodingRunTreeProvider {
  constructor(api, getState) {
    this.api = api;
    this.getState = getState;
    this.changeEmitter = new api.EventEmitter();
    this.onDidChangeTreeData = this.changeEmitter.event;
  }

  refresh() {
    this.changeEmitter.fire(undefined);
  }

  getTreeItem(item) {
    return item;
  }

  getChildren() {
    const state = this.getState();
    return [
      createTreeItem(this.api, "Ask Star Sanctuary", "Active local workspace", "comment-discussion", "starSanctuary.codingRun.ask"),
      createTreeItem(this.api, `Bridge: ${state.bridge}`, `${state.eventCount} event frame(s)`, state.bridge === "running" ? "debug-start" : "debug-disconnect", "starSanctuary.codingRun.start"),
      createTreeItem(this.api, `Conversation Events: ${state.subscription}`, state.lastEvent, state.subscription === "Active" ? "pulse" : "debug-disconnect", "starSanctuary.codingRun.subscribeConversation"),
      ...(state.pendingPermission ? [
        createTreeItem(this.api, "Allow Pending Tool", state.permission, "check", "starSanctuary.codingRun.allowPermission"),
        createTreeItem(this.api, "Deny Pending Tool", state.permission, "close", "starSanctuary.codingRun.denyPermission"),
      ] : [
        createTreeItem(this.api, "Tool Approval", state.permission, "shield", undefined),
      ]),
      createTreeItem(this.api, "Cancel Conversation Run", "Requires exact conversation and run IDs", "circle-slash", "starSanctuary.codingRun.cancelConversation"),
      createTreeItem(this.api, "Cancel Workflow Run", "Requires exact Journal and runtime run IDs", "circle-slash", "starSanctuary.codingRun.cancelWorkflow"),
      createTreeItem(this.api, "View Workspace Changes", "Open VS Code Source Control", "source-control", "starSanctuary.codingRun.viewChanges"),
    ];
  }
}

function summarizeRunEvent(event) {
  const type = normalizeInput(event?.type) ?? "Unknown event";
  const seq = Number.isSafeInteger(event?.seq) ? event.seq : 0;
  return `${type} #${seq}`;
}

function isTerminalRunEvent(type) {
  return type === "run.cancelled"
    || type === "run.interrupted"
    || type === "run.completed"
    || type === "run.failed";
}

function createTreeItem(api, label, description, icon, command) {
  const item = new api.TreeItem(label, api.TreeItemCollapsibleState.None);
  item.description = description;
  item.iconPath = new api.ThemeIcon(icon);
  if (command) item.command = { command, title: label };
  return item;
}

async function promptRequired(api, prompt) {
  return api.window.showInputBox({
    prompt,
    ignoreFocusOut: true,
    validateInput: (value) => normalizeInput(value) ? undefined : `${prompt} is required.`,
  });
}

async function runControl(api, appendDiagnostic, invoke) {
  try {
    const result = await invoke();
    if (result.ok) {
      void api.window.showInformationMessage("Star Sanctuary control accepted.");
      return;
    }
    appendDiagnostic(`Control rejected: ${result.error.code}`);
    void api.window.showWarningMessage(`Star Sanctuary control was rejected: ${safeMessage(result.error.message)}`);
  } catch (error) {
    appendDiagnostic(error);
    void api.window.showErrorMessage(`Star Sanctuary control failed: ${safeMessage(error)}`);
  }
}

function normalizeInput(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || /[\u0000-\u001f\u007f]/.test(normalized)) return undefined;
  return normalized;
}

function safeMessage(value) {
  const text = value instanceof Error ? value.message : String(value ?? "");
  return text.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 512) || "Unknown error.";
}

module.exports = { activate, deactivate };
