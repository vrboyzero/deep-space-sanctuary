/**
 * 日志读取工具 - 供 Agent 回溯分析任务执行过程、错误排查和性能分析
 *
 * 与 Phase 18 日志系统配合，支持方法论系统的自我反思。
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Tool, ToolContext, ToolCallResult, JsonObject } from "../types.js";
import { withToolContract } from "../tool-contract.js";

const LOGS_DIR_NAME = "logs";

/** 获取日志目录绝对路径 */
function getLogsDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, LOGS_DIR_NAME);
}

/** 解析日期字符串 YYYY-MM-DD，返回当天 0 点的 Date */
function parseDateStr(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mon = parseInt(m[2], 10) - 1;
  const d = parseInt(m[3], 10);
  const date = new Date(y, mon, d);
  if (date.getFullYear() !== y || date.getMonth() !== mon || date.getDate() !== d) return null;
  return date;
}

/** 格式化日期为 YYYY-MM-DD */
function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** 列出某日期对应的所有日志文件（主文件 + 轮转文件） */
async function listLogFilesForDate(logsDir: string, dateStr: string): Promise<string[]> {
  const files: string[] = [];
  try {
    const entries = await fs.readdir(logsDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".log")) continue;
      if (e.name === `${dateStr}.log` || e.name.startsWith(`${dateStr}.`)) {
        files.push(path.join(logsDir, e.name));
      }
    }
    files.sort();
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== "ENOENT") throw err;
  }
  return files;
}

/** 读取日志文件内容，按行过滤 */
async function readAndFilterLogFile(
  filePath: string,
  opts: { level?: string; moduleFilter?: string; keyword?: string }
): Promise<string[]> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch {
    return [];
  }
  const lines = content.split(/\n/).filter((line) => line.trim());
  const { level, moduleFilter, keyword } = opts;

  return lines.filter((line) => {
    if (level) {
      const levelUpper = level.toUpperCase();
      if (!line.includes(`[${levelUpper}]`)) return false;
    }
    if (moduleFilter && !line.includes(`[${moduleFilter}]`)) return false;
    if (keyword && !line.includes(keyword)) return false;
    return true;
  });
}

// ============ log_read 工具 ============

export const logReadTool: Tool = withToolContract({
  definition: {
    name: "log_read",
    description:
      "读取系统运行日志，用于分析任务执行过程、错误排查和性能分析。日志按日期分文件存储在工作区 logs 目录下。",
    parameters: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "日期，格式 YYYY-MM-DD，默认为今天",
        },
        level: {
          type: "string",
          description: "过滤日志级别：debug/info/warn/error，可选",
          enum: ["debug", "info", "warn", "error"],
        },
        module: {
          type: "string",
          description: "过滤模块名，如 gateway/agent/tools/memory/mcp/heartbeat，可选",
        },
        keyword: {
          type: "string",
          description: "关键词过滤，仅返回包含该关键词的行，可选",
        },
        tail: {
          type: "number",
          description: "只返回最后 N 行，默认 100，避免输出过长",
        },
      },
      required: [],
    },
  },

  async execute(args: JsonObject, context: ToolContext): Promise<ToolCallResult> {
    const start = Date.now();
    const id = crypto.randomUUID();
    const name = "log_read";

    const makeError = (error: string): ToolCallResult => ({
      id,
      name,
      success: false,
      output: "",
      error,
      durationMs: Date.now() - start,
    });

    const logsDir = getLogsDir(context.workspaceRoot);

    // 确保 logs 目录在工作区内
    const resolvedLogs = path.resolve(logsDir);
    const resolvedWorkspace = path.resolve(context.workspaceRoot);
    if (!resolvedLogs.startsWith(resolvedWorkspace + path.sep) && resolvedLogs !== resolvedWorkspace) {
      return makeError("日志目录不在工作区内");
    }

    const dateArg = typeof args.date === "string" ? args.date : null;
    const dateStr = dateArg && parseDateStr(dateArg) ? formatDate(parseDateStr(dateArg)!) : formatDate(new Date());
    const level = typeof args.level === "string" ? args.level : undefined;
    const moduleFilter = typeof args.module === "string" ? args.module : undefined;
    const keyword = typeof args.keyword === "string" ? args.keyword : undefined;
    const tail = typeof args.tail === "number" && args.tail > 0 ? Math.min(args.tail, 5000) : 100;

    try {
      const files = await listLogFilesForDate(logsDir, dateStr);
      if (files.length === 0) {
        return {
          id,
          name,
          success: true,
          output: `[log_read] 指定日期 ${dateStr} 暂无日志文件。日志目录: ${logsDir}`,
          durationMs: Date.now() - start,
        };
      }

      const allLines: string[] = [];
      for (const fp of files) {
        const lines = await readAndFilterLogFile(fp, { level, moduleFilter, keyword });
        allLines.push(...lines);
      }

      const resultLines = allLines.slice(-tail);
      const output =
        resultLines.length === 0
          ? `[log_read] 日期 ${dateStr} 下无匹配日志（level=${level ?? "all"}, module=${moduleFilter ?? "all"}, keyword=${keyword ?? "none"}）`
          : resultLines.join("\n");

      return {
        id,
        name,
        success: true,
        output,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      const msg = (err as Error).message;
      return makeError(`读取日志失败: ${msg}`);
    }
  },
}, {
  family: "workspace-read",
  isReadOnly: true,
  isConcurrencySafe: true,
  needsPermission: false,
  riskLevel: "low",
  channels: ["gateway", "web"],
  safeScopes: ["local-safe", "web-safe"],
  activityDescription: "Read gateway log files from the workspace logs directory",
  resultSchema: {
    kind: "text",
    description: "Filtered log lines text.",
  },
  outputPersistencePolicy: "conversation",
});

// ============ log_search 工具 ============

export const logSearchTool: Tool = withToolContract({
  definition: {
    name: "log_search",
    description: "在日志中搜索错误、警告或特定关键词，用于快速定位问题。",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "搜索关键词（支持大小写敏感的子串匹配）",
        },
        startDate: {
          type: "string",
          description: "开始日期 YYYY-MM-DD，可选，默认最近 3 天",
        },
        endDate: {
          type: "string",
          description: "结束日期 YYYY-MM-DD，可选，默认今天",
        },
        level: {
          type: "string",
          description: "过滤日志级别：debug/info/warn/error，可选",
          enum: ["debug", "info", "warn", "error"],
        },
        maxLines: {
          type: "number",
          description: "最多返回匹配行数，默认 200",
        },
      },
      required: ["query"],
    },
  },

  async execute(args: JsonObject, context: ToolContext): Promise<ToolCallResult> {
    const start = Date.now();
    const id = crypto.randomUUID();
    const name = "log_search";

    const makeError = (error: string): ToolCallResult => ({
      id,
      name,
      success: false,
      output: "",
      error,
      durationMs: Date.now() - start,
    });

    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) {
      return makeError("参数错误：query 不能为空");
    }

    const logsDir = getLogsDir(context.workspaceRoot);
    const resolvedLogs = path.resolve(logsDir);
    const resolvedWorkspace = path.resolve(context.workspaceRoot);
    if (!resolvedLogs.startsWith(resolvedWorkspace + path.sep) && resolvedLogs !== resolvedWorkspace) {
      return makeError("日志目录不在工作区内");
    }

    const today = new Date();
    const endDateArg = typeof args.endDate === "string" ? args.endDate : null;
    const startDateArg = typeof args.startDate === "string" ? args.startDate : null;

    const endDate = endDateArg && parseDateStr(endDateArg) ? parseDateStr(endDateArg)! : today;
    let startDate: Date;
    if (startDateArg && parseDateStr(startDateArg)) {
      startDate = parseDateStr(startDateArg)!;
    } else {
      startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 3);
    }

    if (startDate > endDate) {
      return makeError("startDate 不能晚于 endDate");
    }

    const level = typeof args.level === "string" ? args.level : undefined;
    const maxLines = typeof args.maxLines === "number" && args.maxLines > 0 ? Math.min(args.maxLines, 1000) : 200;

    try {
      const matches: string[] = [];
      const current = new Date(startDate);

      while (current <= endDate) {
        const dateStr = formatDate(current);
        const files = await listLogFilesForDate(logsDir, dateStr);
        for (const fp of files) {
          const lines = await readAndFilterLogFile(fp, { level });
          for (const line of lines) {
            if (line.includes(query)) {
              matches.push(line);
              if (matches.length >= maxLines) break;
            }
          }
          if (matches.length >= maxLines) break;
        }
        if (matches.length >= maxLines) break;
        current.setDate(current.getDate() + 1);
      }

      const output =
        matches.length === 0
          ? `[log_search] 未找到包含 "${query}" 的日志（范围: ${formatDate(startDate)} ~ ${formatDate(endDate)}）`
          : matches.join("\n");

      return {
        id,
        name,
        success: true,
        output,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      const msg = (err as Error).message;
      return makeError(`搜索日志失败: ${msg}`);
    }
  },
}, {
  family: "workspace-read",
  isReadOnly: true,
  isConcurrencySafe: true,
  needsPermission: false,
  riskLevel: "low",
  channels: ["gateway", "web"],
  safeScopes: ["local-safe", "web-safe"],
  activityDescription: "Search gateway log files by keyword and date range",
  resultSchema: {
    kind: "text",
    description: "Log search result text.",
  },
  outputPersistencePolicy: "conversation",
});
