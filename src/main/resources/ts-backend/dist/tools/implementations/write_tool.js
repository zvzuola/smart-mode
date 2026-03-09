/**
 * Write 工具 - 写入文件内容
 */
import fs from "node:fs/promises";
import path from "node:path";
import { getGlobalWorkspacePath } from "../../context/workspace.js";
export class WriteTool {
    name = "Write";
    description = `Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.`;
    get_definition() {
        return {
            name: this.name,
            description: this.description,
            input_schema: {
                type: "object",
                properties: {
                    file_path: {
                        type: "string",
                        description: "The absolute path to the file to write (must be absolute, not relative)",
                    },
                    content: {
                        type: "string",
                        description: "The content to write to the file",
                    },
                },
                required: ["file_path", "content"],
            },
        };
    }
    async execute(input, context) {
        const startTime = Date.now();
        // 支持新旧参数名（向后兼容）
        const filePath = (input.arguments.file_path || input.arguments.path);
        const content = (input.arguments.content || input.arguments.contents);
        try {
            if (typeof filePath !== "string") {
                throw new Error("file_path must be a string");
            }
            if (typeof content !== "string") {
                throw new Error("content must be a string");
            }
            // 解析路径（优先级：context > 全局workspace > 当前目录）
            let fullPath = filePath;
            if (!path.isAbsolute(filePath)) {
                const workspace = context.workspace_path || getGlobalWorkspacePath();
                if (workspace) {
                    fullPath = path.resolve(workspace, filePath);
                }
            }
            // 确保目录存在
            const dir = path.dirname(fullPath);
            await fs.mkdir(dir, { recursive: true });
            // 写入文件
            await fs.writeFile(fullPath, content, "utf-8");
            const lineCount = content.split("\n").length;
            return {
                tool_id: input.tool_id,
                tool_name: input.tool_name,
                result: {
                    path: filePath,
                    bytes_written: Buffer.byteLength(content, "utf-8"),
                },
                result_for_assistant: `已写入文件 ${filePath}（${lineCount} 行）`,
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
                result_for_assistant: `写入文件失败: ${error instanceof Error ? error.message : String(error)}`,
                is_error: true,
                duration_ms: Date.now() - startTime,
            };
        }
    }
    is_end_turn_tool() {
        return false;
    }
    is_concurrency_safe() {
        return false; // 写入操作不是并发安全的
    }
    is_readonly() {
        return false;
    }
    needs_permissions(_input) {
        return true; // 写入操作需要权限
    }
}
//# sourceMappingURL=write_tool.js.map