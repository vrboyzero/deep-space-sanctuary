import type { Tool, JsonObject, ToolContext } from "../../types.js";
import { promises as fs } from "fs";
import * as path from "path";
import { getGlobalMemoryManager } from "@belldandy/memory";
import { getMethodsDir } from "./list.js";

export const methodReadTool: Tool = {
    definition: {
        name: "method_read",
        description: "读取指定的方法论文档内容。当通过 method_list 发现相关方法后，使用此工具读取详细步骤。",
        parameters: {
            type: "object",
            properties: {
                filename: {
                    type: "string",
                    description: "方法文件名（例如: 'file-read-basic.md' 或 '网页-自动化-基础.md'）"
                }
            },
            required: ["filename"]
        }
    },
    execute: async (args: JsonObject, context: ToolContext) => {
        const filename = args.filename as string;
        if (typeof filename !== "string" || !filename) {
            return {
                id: "error",
                name: "method_read",
                success: false,
                output: "缺少参数: filename",
                error: "Missing filename",
                durationMs: 0
            };
        }

        // 方法文件只接受文件名；在 POSIX 上也要把 Windows 反斜杠视为路径分隔符。
        const normalizedFilename = filename.replace(/\\/g, "/");
        if (normalizedFilename.includes("/")) {
            return {
                id: "error",
                name: "method_read",
                success: false,
                output: "非法的路径访问。",
                error: "Path traversal detected",
                durationMs: 0
            };
        }

        const methodsDir = path.resolve(getMethodsDir(context));
        const filePath = path.resolve(methodsDir, filename);

        // 安全检查：防止路径遍历
        if (!filePath.startsWith(methodsDir + path.sep) && filePath !== methodsDir) {
            return {
                id: "error",
                name: "method_read",
                success: false,
                output: "非法的路径访问。",
                error: "Path traversal detected",
                durationMs: 0
            };
        }

        try {
            const content = await fs.readFile(filePath, "utf-8");
            try {
                const manager = getGlobalMemoryManager({
                    agentId: context.agentId,
                    conversationId: context.conversationId,
                    workspaceRoot: context.workspaceRoot,
                });
                const task = manager?.getTaskByConversation(context.conversationId);
                if (manager && task) {
                    manager.recordMethodUsage(task.id, filename, { usedVia: "tool" });
                }
            } catch {
                // usage 记录失败不影响 method 正常读取
            }
            return {
                id: "method_read",
                name: "method_read",
                success: true,
                output: content,
                durationMs: 0
            };
        } catch (error) {
            const err = error as Error;
            return {
                id: "error",
                name: "method_read",
                success: false,
                output: `无法读取方法文件 '${filename}': ${err.message}`,
                error: err.message,
                durationMs: 0
            };
        }
    }
};
