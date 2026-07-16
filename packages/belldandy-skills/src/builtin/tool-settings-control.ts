import crypto from "node:crypto";
import type { JsonObject, Tool, ToolCallResult, ToolContext } from "../types.js";
import { withToolContract } from "../tool-contract.js";

export const TOOL_SETTINGS_CONTROL_NAME = "tool_settings_control";

export type AgentToolControlMode = "disabled" | "confirm" | "auto";

export type ToolSettingsDisabledConfig = {
  builtin: string[];
  mcp_servers: string[];
  plugins: string[];
  skills: string[];
};

type ToolSettingsConfigManagerLike = {
  getConfig(): {
    version: number;
    disabled: ToolSettingsDisabledConfig;
  };
  updateConfig(disabled: Partial<ToolSettingsDisabledConfig>): Promise<void>;
};

type PendingToolControlRequestLike = {
  requestId: string;
  conversationId: string;
  requestedByAgentId?: string;
  changes: ToolControlChanges;
  createdAt: number;
  expiresAt: number;
  passwordApprovedAt?: number;
};

type ToolControlConfirmationStoreLike = {
  create(req: Omit<PendingToolControlRequestLike, "createdAt" | "expiresAt">): PendingToolControlRequestLike;
  get(requestId: string): PendingToolControlRequestLike | undefined;
  getLatestByConversation(conversationId: string): PendingToolControlRequestLike | undefined;
  getLatestApprovedByConversation(conversationId: string): PendingToolControlRequestLike | undefined;
  markPasswordApproved(requestId: string, approvedAt?: number): PendingToolControlRequestLike | undefined;
  delete(requestId: string): void;
  cleanupExpired(now?: number): void;
};

export type AgentToolControlDeps = {
  toolsConfigManager: ToolSettingsConfigManagerLike;
  getControlMode: () => AgentToolControlMode;
  getHasConfirmPassword?: () => boolean;
  listRegisteredTools: () => string[];
  listPluginIds?: () => string[];
  confirmationStore: ToolControlConfirmationStoreLike;
};

export type ToolControlChanges = {
  enableBuiltin: string[];
  disableBuiltin: string[];
  enableMcpServers: string[];
  disableMcpServers: string[];
  enablePlugins: string[];
  disablePlugins: string[];
};

const APPROVAL_PREFIX = "批准工具设置变更";

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))];
}

function normalizeRequestId(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function sortStrings(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function extractMcpServerId(toolName: string): string | null {
  if (!toolName.startsWith("mcp_")) return null;
  const rest = toolName.slice(4);
  const idx = rest.indexOf("_");
  if (idx <= 0) return null;
  return rest.slice(0, idx);
}

function collectRegistrySnapshot(deps: AgentToolControlDeps) {
  const registeredTools = deps.listRegisteredTools();
  const builtinTools = sortStrings(
    registeredTools.filter((name) => !name.startsWith("mcp_") && name !== TOOL_SETTINGS_CONTROL_NAME),
  );
  const mcpServers = sortStrings(
    registeredTools
      .map((name) => extractMcpServerId(name))
      .filter((name): name is string => Boolean(name)),
  );
  const pluginIds = sortStrings(deps.listPluginIds?.() ?? []);
  return { registeredTools, builtinTools, mcpServers, pluginIds };
}

function normalizeChanges(args: JsonObject): ToolControlChanges {
  return {
    enableBuiltin: normalizeStringList(args.enableBuiltin),
    disableBuiltin: normalizeStringList(args.disableBuiltin),
    enableMcpServers: normalizeStringList(args.enableMcpServers),
    disableMcpServers: normalizeStringList(args.disableMcpServers),
    enablePlugins: normalizeStringList(args.enablePlugins),
    disablePlugins: normalizeStringList(args.disablePlugins),
  };
}

function hasAnyChanges(changes: ToolControlChanges): boolean {
  return Object.values(changes).some((list) => list.length > 0);
}

function validateChanges(changes: ToolControlChanges, snapshot: ReturnType<typeof collectRegistrySnapshot>): string | undefined {
  const builtinSet = new Set(snapshot.builtinTools);
  const mcpSet = new Set(snapshot.mcpServers);
  const pluginSet = new Set(snapshot.pluginIds);

  if (changes.enableBuiltin.includes(TOOL_SETTINGS_CONTROL_NAME) || changes.disableBuiltin.includes(TOOL_SETTINGS_CONTROL_NAME)) {
    return `${TOOL_SETTINGS_CONTROL_NAME} 是保留工具，不能被修改。`;
  }

  const invalidBuiltin = [...changes.enableBuiltin, ...changes.disableBuiltin].find((name) => !builtinSet.has(name));
  if (invalidBuiltin) return `未找到已注册 builtin 工具: ${invalidBuiltin}`;

  const invalidMcp = [...changes.enableMcpServers, ...changes.disableMcpServers].find((name) => !mcpSet.has(name));
  if (invalidMcp) return `未找到已注册 MCP 服务器: ${invalidMcp}`;

  const invalidPlugin = [...changes.enablePlugins, ...changes.disablePlugins].find((name) => !pluginSet.has(name));
  if (invalidPlugin) return `未找到已加载插件: ${invalidPlugin}`;

  return undefined;
}

export function applyToolControlChanges(
  config: ToolSettingsDisabledConfig,
  changes: ToolControlChanges,
): Pick<ToolSettingsDisabledConfig, "builtin" | "mcp_servers" | "plugins"> {
  const builtin = new Set(config.builtin);
  const mcpServers = new Set(config.mcp_servers);
  const plugins = new Set(config.plugins);

  for (const name of changes.enableBuiltin) builtin.delete(name);
  for (const name of changes.disableBuiltin) builtin.add(name);
  builtin.delete(TOOL_SETTINGS_CONTROL_NAME);

  for (const name of changes.enableMcpServers) mcpServers.delete(name);
  for (const name of changes.disableMcpServers) mcpServers.add(name);

  for (const name of changes.enablePlugins) plugins.delete(name);
  for (const name of changes.disablePlugins) plugins.add(name);

  return {
    builtin: sortStrings(builtin),
    mcp_servers: sortStrings(mcpServers),
    plugins: sortStrings(plugins),
  };
}

function buildApprovalText(requestId: string): string {
  return `${APPROVAL_PREFIX} ${normalizeRequestId(requestId)}`;
}

function buildPendingApprovalHint(hasConfirmPassword: boolean, requestId: string): string[] {
  if (hasConfirmPassword) {
    return [
      "如确认，请让用户回复已配置的工具开关确认口令。",
      `收到确认后，再次调用 ${TOOL_SETTINGS_CONTROL_NAME}，参数使用 action=\"confirm\" 即可。`,
    ];
  }
  return [
    `如确认，请回复：${buildApprovalText(requestId)}`,
    `收到确认后，再次调用 ${TOOL_SETTINGS_CONTROL_NAME}，参数使用 action=\"confirm\" 与 requestId=\"${requestId}\"。`,
  ];
}

function buildMissingApprovalError(hasConfirmPassword: boolean, requestId: string): string {
  if (hasConfirmPassword) {
    return "尚未检测到有效确认口令。请让用户回复已配置的工具开关确认口令。";
  }
  return `尚未检测到精确确认口令。请让用户回复：${buildApprovalText(requestId)}`;
}

function getLatestUserMessage(context: ToolContext): string | undefined {
  const history = context.conversationStore?.getHistory(context.conversationId) ?? [];
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "user") {
      return history[i].content.trim();
    }
  }
  return undefined;
}

function extractApprovalRequestId(message: string | undefined): string | undefined {
  const normalized = String(message ?? "").trim();
  if (!normalized) return undefined;
  const match = /^批准工具设置变更\s+([A-Z0-9-]+)$/iu.exec(normalized);
  if (!match) return undefined;
  return normalizeRequestId(match[1]);
}

function isUnknownRequestId(value: string | undefined): boolean {
  const normalized = normalizeRequestId(value);
  return !normalized || normalized === "UNKNOWN" || normalized === "N/A" || normalized === "NONE" || normalized === "NULL";
}

function sameChanges(a: ToolControlChanges, b: ToolControlChanges): boolean {
  return JSON.stringify({
    enableBuiltin: sortStrings(a.enableBuiltin),
    disableBuiltin: sortStrings(a.disableBuiltin),
    enableMcpServers: sortStrings(a.enableMcpServers),
    disableMcpServers: sortStrings(a.disableMcpServers),
    enablePlugins: sortStrings(a.enablePlugins),
    disablePlugins: sortStrings(a.disablePlugins),
  }) === JSON.stringify({
    enableBuiltin: sortStrings(b.enableBuiltin),
    disableBuiltin: sortStrings(b.disableBuiltin),
    enableMcpServers: sortStrings(b.enableMcpServers),
    disableMcpServers: sortStrings(b.disableMcpServers),
    enablePlugins: sortStrings(b.enablePlugins),
    disablePlugins: sortStrings(b.disablePlugins),
  });
}

export function summarizeToolControlChanges(changes: ToolControlChanges): string[] {
  const lines: string[] = [];
  if (changes.enableBuiltin.length > 0) lines.push(`启用 builtin: ${changes.enableBuiltin.join(", ")}`);
  if (changes.disableBuiltin.length > 0) lines.push(`关闭 builtin: ${changes.disableBuiltin.join(", ")}`);
  if (changes.enableMcpServers.length > 0) lines.push(`启用 MCP: ${changes.enableMcpServers.join(", ")}`);
  if (changes.disableMcpServers.length > 0) lines.push(`关闭 MCP: ${changes.disableMcpServers.join(", ")}`);
  if (changes.enablePlugins.length > 0) lines.push(`启用插件: ${changes.enablePlugins.join(", ")}`);
  if (changes.disablePlugins.length > 0) lines.push(`关闭插件: ${changes.disablePlugins.join(", ")}`);
  return lines;
}

function buildStatusOutput(mode: AgentToolControlMode, snapshot: ReturnType<typeof collectRegistrySnapshot>, config: ToolSettingsDisabledConfig): string {
  const lines = [
    `Mode: ${mode}`,
    `Builtin tools: ${snapshot.builtinTools.length}`,
    `MCP servers: ${snapshot.mcpServers.length}`,
    `Plugins: ${snapshot.pluginIds.length}`,
    `Disabled builtin: ${sortStrings(config.builtin.filter((name) => name !== TOOL_SETTINGS_CONTROL_NAME)).join(", ") || "(none)"}`,
    `Disabled MCP servers: ${sortStrings(config.mcp_servers).join(", ") || "(none)"}`,
    `Disabled plugins: ${sortStrings(config.plugins).join(", ") || "(none)"}`,
  ];
  return lines.join("\n");
}

export function buildToolControlDisabledPayload(disabled: ToolSettingsDisabledConfig) {
  return {
    builtin: sortStrings(disabled.builtin.filter((name) => name !== TOOL_SETTINGS_CONTROL_NAME)),
    mcp_servers: sortStrings(disabled.mcp_servers),
    plugins: sortStrings(disabled.plugins),
    skills: sortStrings(disabled.skills),
  };
}

function isWebChatUiConfirmContext(context: ToolContext): boolean {
  return context.roomContext?.environment === "local";
}

function getConfirmTargetClientId(context: ToolContext): string | undefined {
  const roomContext = context.roomContext as (ToolContext["roomContext"] & { clientId?: string }) | undefined;
  return typeof roomContext?.clientId === "string" && roomContext.clientId.trim()
    ? roomContext.clientId.trim()
    : undefined;
}

export function createToolSettingsControlTool(deps: AgentToolControlDeps): Tool {
  return withToolContract({
    definition: {
      name: TOOL_SETTINGS_CONTROL_NAME,
      description: "Control the global runtime disabled list for currently registered builtin tools, MCP servers, and plugins. This does not change BELLDANDY_TOOLS_ENABLED, does not modify BELLDANDY_TOOL_GROUPS, and does not manage skills.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description: "status=show current runtime tool settings, apply=request a change, confirm=finalize a previously requested change in confirm mode",
            enum: ["status", "apply", "confirm"],
          },
          enableBuiltin: { type: "array", description: "Builtin tool names to enable", items: { type: "string" } },
          disableBuiltin: { type: "array", description: "Builtin tool names to disable", items: { type: "string" } },
          enableMcpServers: { type: "array", description: "MCP server ids to enable", items: { type: "string" } },
          disableMcpServers: { type: "array", description: "MCP server ids to disable", items: { type: "string" } },
          enablePlugins: { type: "array", description: "Plugin ids to enable", items: { type: "string" } },
          disablePlugins: { type: "array", description: "Plugin ids to disable", items: { type: "string" } },
          requestId: {
            type: "string",
            description: "Required for action=confirm. The pending request id returned by a previous apply call in confirm mode.",
          },
          reason: {
            type: "string",
            description: "Optional short reason for the requested change, for transcript clarity only.",
          },
        },
        required: ["action"],
      },
    },

    async execute(args: JsonObject, context: ToolContext): Promise<ToolCallResult> {
      const start = Date.now();
      deps.confirmationStore.cleanupExpired();

      const action = String(args.action ?? "status").trim().toLowerCase();
      const mode = deps.getControlMode();
      const hasConfirmPassword = deps.getHasConfirmPassword?.() ?? false;
      const config = deps.toolsConfigManager.getConfig().disabled;
      const snapshot = collectRegistrySnapshot(deps);

      if (action === "status") {
        return {
          id: "",
          name: TOOL_SETTINGS_CONTROL_NAME,
          success: true,
          output: buildStatusOutput(mode, snapshot, config),
          durationMs: Date.now() - start,
        };
      }

      if (mode === "disabled") {
        return {
          id: "",
          name: TOOL_SETTINGS_CONTROL_NAME,
          success: false,
          output: "",
          error: "Agent tool control is disabled by BELLDANDY_AGENT_TOOL_CONTROL_MODE=disabled.",
          durationMs: Date.now() - start,
        };
      }

      if (action === "apply") {
        const changes = normalizeChanges(args);
        if (!hasAnyChanges(changes)) {
          return {
            id: "",
            name: TOOL_SETTINGS_CONTROL_NAME,
            success: false,
            output: "",
            error: "没有提供任何变更项。",
            durationMs: Date.now() - start,
          };
        }

        const validationError = validateChanges(changes, snapshot);
        if (validationError) {
          return {
            id: "",
            name: TOOL_SETTINGS_CONTROL_NAME,
            success: false,
            output: "",
            error: validationError,
            durationMs: Date.now() - start,
          };
        }

        const latestUserMessage = hasConfirmPassword ? undefined : getLatestUserMessage(context);
        const approvedRequestId = hasConfirmPassword ? undefined : extractApprovalRequestId(latestUserMessage);
        const latestPending = hasConfirmPassword
          ? deps.confirmationStore.getLatestByConversation(context.conversationId)
          : undefined;
        const passwordApprovedPending = hasConfirmPassword
          ? deps.confirmationStore.getLatestApprovedByConversation(context.conversationId)
          : undefined;
        const pendingApproved = approvedRequestId
          ? deps.confirmationStore.get(approvedRequestId)
          : passwordApprovedPending;
        if (mode === "confirm" && pendingApproved) {
          if (pendingApproved && pendingApproved.conversationId === context.conversationId) {
            if (sameChanges(pendingApproved.changes, changes)) {
              const nextDisabled = applyToolControlChanges(config, pendingApproved.changes);
              await deps.toolsConfigManager.updateConfig(nextDisabled);
              const latestDisabled = deps.toolsConfigManager.getConfig().disabled;
              context.broadcast?.("tools.config.updated", {
                source: "agent",
                mode,
                disabled: buildToolControlDisabledPayload(latestDisabled),
              });
              deps.confirmationStore.delete(pendingApproved.requestId);
              return {
                id: "",
                name: TOOL_SETTINGS_CONTROL_NAME,
                success: true,
                output: [
                  "检测到用户已回复确认口令，已直接执行待确认的全局工具设置变更。",
                  ...summarizeToolControlChanges(pendingApproved.changes),
                  `Disabled builtin: ${latestDisabled.builtin.filter((name) => name !== TOOL_SETTINGS_CONTROL_NAME).join(", ") || "(none)"}`,
                  `Disabled MCP servers: ${latestDisabled.mcp_servers.join(", ") || "(none)"}`,
                  `Disabled plugins: ${latestDisabled.plugins.join(", ") || "(none)"}`,
                ].join("\n"),
                durationMs: Date.now() - start,
              };
            }

            return {
              id: "",
              name: TOOL_SETTINGS_CONTROL_NAME,
              success: false,
              output: "",
              error: hasConfirmPassword
                ? "检测到用户已经批准当前会话最近一次待确认请求，但本次 apply 的变更内容与已批准请求不一致。请改用 action=\"confirm\" 完成原请求，或重新发起新的确认。"
                : `检测到用户已经批准待确认请求 ${pendingApproved.requestId}，但本次 apply 的变更内容与待确认请求不一致。请改用 action="confirm" 并传入 requestId="${pendingApproved.requestId}"，或重新发起新的确认。`,
              durationMs: Date.now() - start,
            };
          }
        }

        if (mode === "auto") {
          const nextDisabled = applyToolControlChanges(config, changes);
          await deps.toolsConfigManager.updateConfig(nextDisabled);
          const latestDisabled = deps.toolsConfigManager.getConfig().disabled;
          context.broadcast?.("tools.config.updated", {
            source: "agent",
            mode,
            disabled: buildToolControlDisabledPayload(latestDisabled),
          });
          return {
            id: "",
            name: TOOL_SETTINGS_CONTROL_NAME,
            success: true,
            output: [
              "已执行全局工具设置变更。",
              ...summarizeToolControlChanges(changes),
              `Disabled builtin: ${latestDisabled.builtin.filter((name) => name !== TOOL_SETTINGS_CONTROL_NAME).join(", ") || "(none)"}`,
              `Disabled MCP servers: ${latestDisabled.mcp_servers.join(", ") || "(none)"}`,
              `Disabled plugins: ${latestDisabled.plugins.join(", ") || "(none)"}`,
            ].join("\n"),
            durationMs: Date.now() - start,
          };
        }

        const requestId = normalizeRequestId(crypto.randomUUID().slice(0, 5));
        const pendingRequest = deps.confirmationStore.create({
          requestId,
          conversationId: context.conversationId,
          requestedByAgentId: context.agentId,
          changes,
        });

        if (isWebChatUiConfirmContext(context)) {
          const summary = summarizeToolControlChanges(changes);
          context.broadcast?.("tool_settings.confirm.required", {
            source: "agent",
            mode,
            conversationId: context.conversationId,
            requestId,
            requestedByAgentId: context.agentId,
            summary,
            impact: "这是全局工具设置变更，会影响当前 Gateway 的其他会话。",
            expiresAt: pendingRequest.expiresAt,
            targetClientId: getConfirmTargetClientId(context),
          });
          return {
            id: "",
            name: TOOL_SETTINGS_CONTROL_NAME,
            success: true,
            output: [
              "已创建待确认的全局工具设置变更请求。",
              "当前通道将通过 WebChat 页面确认窗口处理后续审批。",
              "不要要求用户在聊天区输入确认口令或确认短语；等待页面确认结果后再继续。",
              ...summary,
            ].join("\n"),
            durationMs: Date.now() - start,
          };
        }

        return {
          id: "",
          name: TOOL_SETTINGS_CONTROL_NAME,
          success: true,
          output: [
            "本次请求尚未执行。",
            ...summarizeToolControlChanges(changes),
            "这是全局调用设置变更，会影响当前 Gateway 的其他会话。",
            ...buildPendingApprovalHint(hasConfirmPassword, requestId),
          ].join("\n"),
          durationMs: Date.now() - start,
        };
      }

      if (action === "confirm") {
        if (mode !== "confirm") {
          return {
            id: "",
            name: TOOL_SETTINGS_CONTROL_NAME,
            success: false,
            output: "",
            error: `当前模式为 ${mode}，不需要 confirm。`,
            durationMs: Date.now() - start,
          };
        }

        const latestUserMessage = hasConfirmPassword ? undefined : getLatestUserMessage(context);
        const requestIdFromMessage = hasConfirmPassword ? undefined : extractApprovalRequestId(latestUserMessage);
        const latestPending = hasConfirmPassword
          ? deps.confirmationStore.getLatestByConversation(context.conversationId)
          : undefined;
        const latestApprovedPending = hasConfirmPassword
          ? deps.confirmationStore.getLatestApprovedByConversation(context.conversationId)
          : undefined;
        const requestIdArg = normalizeRequestId(args.requestId);
        const requestId = isUnknownRequestId(requestIdArg)
          ? (requestIdFromMessage ?? latestApprovedPending?.requestId ?? latestPending?.requestId ?? "")
          : requestIdArg;

        if (!requestId) {
          return {
            id: "",
            name: TOOL_SETTINGS_CONTROL_NAME,
            success: false,
            output: "",
            error: hasConfirmPassword
              ? "当前会话没有待确认的工具设置请求。"
              : requestIdFromMessage
                ? `缺少有效 requestId。可直接使用最近用户确认口令中的 requestId=${requestIdFromMessage}。`
                : latestApprovedPending
                  ? `缺少有效 requestId。可直接使用最近已完成确认的 requestId=${latestApprovedPending.requestId}。`
                  : "缺少 requestId。",
            durationMs: Date.now() - start,
          };
        }

        const pending = deps.confirmationStore.get(requestId);
        if (!pending) {
          if (requestIdFromMessage && requestIdFromMessage !== requestId) {
            const fallbackPending = deps.confirmationStore.get(requestIdFromMessage);
            if (fallbackPending && fallbackPending.conversationId === context.conversationId) {
              const nextDisabled = applyToolControlChanges(config, fallbackPending.changes);
              await deps.toolsConfigManager.updateConfig(nextDisabled);
              const latestDisabled = deps.toolsConfigManager.getConfig().disabled;
              context.broadcast?.("tools.config.updated", {
                source: "agent",
                mode,
                disabled: buildToolControlDisabledPayload(latestDisabled),
              });
              deps.confirmationStore.delete(requestIdFromMessage);
              return {
                id: "",
                name: TOOL_SETTINGS_CONTROL_NAME,
                success: true,
                output: [
                  `传入的 requestId="${requestId}" 无效；已改用最近用户确认口令中的 requestId="${requestIdFromMessage}" 完成变更。`,
                  ...summarizeToolControlChanges(fallbackPending.changes),
                  `Disabled builtin: ${latestDisabled.builtin.filter((name) => name !== TOOL_SETTINGS_CONTROL_NAME).join(", ") || "(none)"}`,
                  `Disabled MCP servers: ${latestDisabled.mcp_servers.join(", ") || "(none)"}`,
                  `Disabled plugins: ${latestDisabled.plugins.join(", ") || "(none)"}`,
                ].join("\n"),
                durationMs: Date.now() - start,
              };
            }
          }
          if (latestApprovedPending && latestApprovedPending.requestId !== requestId) {
            const fallbackPending = deps.confirmationStore.get(latestApprovedPending.requestId);
            if (fallbackPending && fallbackPending.conversationId === context.conversationId) {
              const nextDisabled = applyToolControlChanges(config, fallbackPending.changes);
              await deps.toolsConfigManager.updateConfig(nextDisabled);
              const latestDisabled = deps.toolsConfigManager.getConfig().disabled;
              context.broadcast?.("tools.config.updated", {
                source: "agent",
                mode,
                disabled: buildToolControlDisabledPayload(latestDisabled),
              });
              deps.confirmationStore.delete(latestApprovedPending.requestId);
              return {
                id: "",
                name: TOOL_SETTINGS_CONTROL_NAME,
                success: true,
                output: [
                  hasConfirmPassword
                    ? "传入的 requestId 无效；已改用当前会话最近一次已完成确认的待确认请求完成变更。"
                    : `传入的 requestId="${requestId}" 无效；已改用最近已完成确认的 requestId="${latestApprovedPending.requestId}" 完成变更。`,
                  ...summarizeToolControlChanges(fallbackPending.changes),
                  `Disabled builtin: ${latestDisabled.builtin.filter((name) => name !== TOOL_SETTINGS_CONTROL_NAME).join(", ") || "(none)"}`,
                  `Disabled MCP servers: ${latestDisabled.mcp_servers.join(", ") || "(none)"}`,
                  `Disabled plugins: ${latestDisabled.plugins.join(", ") || "(none)"}`,
                ].join("\n"),
                durationMs: Date.now() - start,
              };
            }
          }
          return {
            id: "",
            name: TOOL_SETTINGS_CONTROL_NAME,
            success: false,
            output: "",
            error: `未找到待确认请求: ${requestId}`,
            durationMs: Date.now() - start,
          };
        }

        if (pending.conversationId !== context.conversationId) {
          return {
            id: "",
            name: TOOL_SETTINGS_CONTROL_NAME,
            success: false,
            output: "",
            error: "待确认请求不属于当前会话。",
            durationMs: Date.now() - start,
          };
        }

        if (hasConfirmPassword ? !pending.passwordApprovedAt : extractApprovalRequestId(latestUserMessage) !== requestId) {
          return {
            id: "",
            name: TOOL_SETTINGS_CONTROL_NAME,
            success: false,
            output: "",
            error: buildMissingApprovalError(hasConfirmPassword, requestId),
            durationMs: Date.now() - start,
          };
        }

        const nextDisabled = applyToolControlChanges(config, pending.changes);
        await deps.toolsConfigManager.updateConfig(nextDisabled);
        const latestDisabled = deps.toolsConfigManager.getConfig().disabled;
        context.broadcast?.("tools.config.updated", {
          source: "agent",
          mode,
          disabled: buildToolControlDisabledPayload(latestDisabled),
        });
        deps.confirmationStore.delete(requestId);

        return {
          id: "",
          name: TOOL_SETTINGS_CONTROL_NAME,
          success: true,
          output: [
            "已根据用户确认执行全局工具设置变更。",
            ...summarizeToolControlChanges(pending.changes),
            `Disabled builtin: ${latestDisabled.builtin.filter((name) => name !== TOOL_SETTINGS_CONTROL_NAME).join(", ") || "(none)"}`,
            `Disabled MCP servers: ${latestDisabled.mcp_servers.join(", ") || "(none)"}`,
            `Disabled plugins: ${latestDisabled.plugins.join(", ") || "(none)"}`,
          ].join("\n"),
          durationMs: Date.now() - start,
        };
      }

      return {
        id: "",
        name: TOOL_SETTINGS_CONTROL_NAME,
        success: false,
        output: "",
        error: `未知 action: ${action}`,
        durationMs: Date.now() - start,
      };
    },
  }, {
    family: "service-admin",
    isReadOnly: false,
    isConcurrencySafe: false,
    needsPermission: true,
    riskLevel: "high",
    channels: ["gateway", "web"],
    safeScopes: ["privileged", "web-safe"],
    activityDescription: "Read or change global Tool runtime configuration",
    resultSchema: { kind: "text", description: "Tool configuration status or confirmation result." },
    outputPersistencePolicy: "external-state",
  });
}
