/**
 * LS 工具 - 列出目录内容
 */
import fs from "node:fs/promises";
import path from "node:path";
import { getGlobalWorkspacePath } from "../../context/workspace.js";
export class LSTool {
    name = "LS";
    description = "Recursively lists files and directories in a given path";
    defaultLimit = 200;
    get_definition() {
        return {
            name: this.name,
            description: `Recursively lists files and directories in a given path.

Usage:
- The path parameter must be an absolute path, not a relative path
- You can optionally provide an array of glob patterns to ignore with the ignore parameter
- Hidden files (files starting with '.') are automatically excluded
- Results are sorted by modification time (newest first)`,
            input_schema: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "The absolute path to the directory to list (must be absolute, not relative)",
                    },
                    ignore: {
                        type: "array",
                        items: {
                            type: "string",
                        },
                        description: 'List of glob patterns (relative to path) to ignore. Examples: "*.js" ignores all .js files.',
                    },
                    limit: {
                        type: "number",
                        description: "The maximum number of entries to return. Defaults to 100.",
                    },
                },
                required: ["path"],
            },
        };
    }
    matchesPattern(filename, pattern) {
        // 简单的 glob 匹配实现
        const regex = new RegExp("^" +
            pattern
                .replace(/\./g, "\\.")
                .replace(/\*/g, ".*")
                .replace(/\?/g, ".") +
            "$");
        return regex.test(filename);
    }
    shouldIgnore(filePath, basePath, ignorePatterns) {
        const relativePath = path.relative(basePath, filePath);
        const filename = path.basename(filePath);
        // 忽略隐藏文件
        if (filename.startsWith(".")) {
            return true;
        }
        // 检查 ignore 模式
        if (ignorePatterns && ignorePatterns.length > 0) {
            for (const pattern of ignorePatterns) {
                if (this.matchesPattern(filename, pattern) || this.matchesPattern(relativePath, pattern)) {
                    return true;
                }
            }
        }
        return false;
    }
    async listRecursive(dirPath, basePath, ignorePatterns, limit, entries = []) {
        if (limit && entries.length >= limit) {
            return entries;
        }
        try {
            const items = await fs.readdir(dirPath, { withFileTypes: true });
            for (const item of items) {
                if (limit && entries.length >= limit) {
                    break;
                }
                const itemPath = path.join(dirPath, item.name);
                // 检查是否应该忽略
                if (this.shouldIgnore(itemPath, basePath, ignorePatterns)) {
                    continue;
                }
                try {
                    const stats = await fs.stat(itemPath);
                    const entry = {
                        name: item.name,
                        path: itemPath,
                        is_dir: item.isDirectory(),
                        modified_time: stats.mtime.toISOString(),
                        size: item.isFile() ? stats.size : undefined,
                    };
                    entries.push(entry);
                    // 递归处理子目录
                    if (item.isDirectory() && (!limit || entries.length < limit)) {
                        await this.listRecursive(itemPath, basePath, ignorePatterns, limit, entries);
                    }
                }
                catch (error) {
                    // 忽略无法访问的文件/目录
                    console.warn(`Cannot access ${itemPath}:`, error);
                }
            }
        }
        catch (error) {
            console.warn(`Cannot read directory ${dirPath}:`, error);
        }
        return entries;
    }
    formatFilesList(entries, basePath) {
        if (entries.length === 0) {
            return `${basePath}/\n(no entries found)`;
        }
        // 按修改时间排序（最新的在前）
        const sorted = entries.sort((a, b) => {
            return new Date(b.modified_time).getTime() - new Date(a.modified_time).getTime();
        });
        // 格式化输出
        const lines = [`${basePath}/`];
        for (const entry of sorted) {
            const relativePath = path.relative(basePath, entry.path);
            const indent = "  ".repeat((relativePath.match(/[/\\]/g) || []).length);
            const marker = entry.is_dir ? "/" : "";
            const modifiedDate = new Date(entry.modified_time).toLocaleString();
            lines.push(`${indent}- ${entry.name}${marker}`);
            lines.push(`${indent}  last modified: ${modifiedDate}`);
        }
        return lines.join("\n");
    }
    async execute(input, context) {
        const startTime = Date.now();
        const { path: dirPath, ignore, limit } = input.arguments;
        try {
            // 参数验证
            if (typeof dirPath !== "string") {
                throw new Error("path must be a string");
            }
            if (dirPath.trim() === "") {
                throw new Error("path cannot be empty");
            }
            // 解析路径（优先级：context > 全局workspace > 当前目录）
            let fullPath = dirPath;
            if (!path.isAbsolute(dirPath)) {
                const workspace = context.workspace_path || getGlobalWorkspacePath();
                if (workspace) {
                    fullPath = path.resolve(workspace, dirPath);
                }
            }
            // 检查路径是否存在且是目录
            let stats;
            try {
                stats = await fs.stat(fullPath);
            }
            catch {
                throw new Error(`Directory does not exist: ${fullPath}`);
            }
            if (!stats.isDirectory()) {
                throw new Error(`Path is not a directory: ${fullPath}`);
            }
            // 解析 ignore 参数
            const ignorePatterns = Array.isArray(ignore) && ignore.every((p) => typeof p === "string")
                ? ignore
                : undefined;
            // 解析 limit 参数
            const maxLimit = typeof limit === "number" ? limit : this.defaultLimit;
            // 列出文件
            const entries = await this.listRecursive(fullPath, fullPath, ignorePatterns, maxLimit);
            // 格式化结果
            const resultText = this.formatFilesList(entries, fullPath);
            return {
                tool_id: input.tool_id,
                tool_name: input.tool_name,
                result: {
                    path: fullPath,
                    entries: entries.map((e) => ({
                        name: e.name,
                        path: e.path,
                        is_dir: e.is_dir,
                        modified_time: e.modified_time,
                    })),
                    total: entries.length,
                    limit: maxLimit,
                },
                result_for_assistant: resultText,
                is_error: false,
                duration_ms: Date.now() - startTime,
            };
        }
        catch (error) {
            return {
                tool_id: input.tool_id,
                tool_name: input.tool_name,
                result: {
                    error: error instanceof Error ? error.message : String(error),
                },
                result_for_assistant: `Failed to list directory: ${error instanceof Error ? error.message : String(error)}`,
                is_error: true,
                duration_ms: Date.now() - startTime,
            };
        }
    }
    is_end_turn_tool() {
        return false;
    }
    is_concurrency_safe() {
        return true;
    }
    is_readonly() {
        return true;
    }
    needs_permissions(_input) {
        return false; // 只读操作不需要权限
    }
}
//# sourceMappingURL=ls_tool.js.map