/**
 * Read 工具 - 读取文件内容
 */
import fs from "node:fs/promises";
import path from "node:path";
import { getGlobalWorkspacePath } from "../../context/workspace.js";
export class ReadTool {
    name = "Read";
    // 配置参数，对齐Rust版本
    defaultMaxLinesToRead = 2000;
    maxLineChars = 2000;
    description = `Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path.
- By default, it reads up to ${this.defaultMaxLinesToRead} lines starting from the beginning of the file. 
- You can optionally specify a start_line and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters.
- Any lines longer than ${this.maxLineChars} characters will be truncated.
- Results are returned using cat -n format, with line numbers starting at 1
- This tool can only read files, not directories. To read a directory, use an ls command via the Bash tool.
- You can call multiple tools in a single response. It is always better to speculatively read multiple potentially useful files in parallel.`;
    get_definition() {
        return {
            name: this.name,
            description: this.description,
            input_schema: {
                type: "object",
                properties: {
                    file_path: {
                        type: "string",
                        description: "The absolute path to the file to read",
                    },
                    start_line: {
                        type: "number",
                        description: "The line number to start reading from. Only provide if the file is too large to read at once",
                    },
                    limit: {
                        type: "number",
                        description: "The number of lines to read. Only provide if the file is too large to read at once.",
                    },
                },
                required: ["file_path"],
            },
        };
    }
    /**
     * 验证输入参数（对齐Rust版本的validate_input）
     */
    async validateInput(filePath) {
        if (!filePath || filePath.trim() === "") {
            return { valid: false, error: "file_path cannot be empty" };
        }
        try {
            const stats = await fs.stat(filePath);
            if (!stats.isFile()) {
                return { valid: false, error: `Path is not a file: ${filePath}` };
            }
            return { valid: true };
        }
        catch (error) {
            if (error.code === "ENOENT") {
                return { valid: false, error: `File does not exist: ${filePath}` };
            }
            return { valid: false, error: `Cannot access file: ${error instanceof Error ? error.message : String(error)}` };
        }
    }
    /**
     * 截断过长的行（对齐Rust版本的max_line_chars）
     */
    truncateLine(line) {
        if (line.length <= this.maxLineChars) {
            return line;
        }
        return line.substring(0, this.maxLineChars) + "...";
    }
    async execute(input, context) {
        const startTime = Date.now();
        // 支持新旧参数名（向后兼容）
        const filePath = (input.arguments.file_path || input.arguments.path);
        const startLine = (input.arguments.start_line || input.arguments.offset);
        const limit = input.arguments.limit;
        try {
            if (typeof filePath !== "string") {
                throw new Error("file_path must be a string");
            }
            // 解析路径（如果是相对路径，使用工作区路径）
            // 优先级：context > 全局workspace > 当前目录
            let fullPath = filePath;
            if (!path.isAbsolute(filePath)) {
                const workspace = context.workspace_path || getGlobalWorkspacePath();
                if (workspace) {
                    fullPath = path.resolve(workspace, filePath);
                }
            }
            // 验证输入（对齐Rust版本）
            const validation = await this.validateInput(fullPath);
            if (!validation.valid) {
                throw new Error(validation.error);
            }
            // 读取文件内容
            const content = await fs.readFile(fullPath, "utf-8");
            const lines = content.split("\n");
            const totalLines = lines.length;
            // 处理分页和默认限制（对齐Rust版本）
            const effectiveStartLine = startLine ?? 1;
            const effectiveLimit = limit ?? this.defaultMaxLinesToRead;
            const startIdx = Math.max(0, effectiveStartLine - 1);
            const endIdx = Math.min(lines.length, startIdx + effectiveLimit);
            const resultLines = lines.slice(startIdx, endIdx);
            // 添加行号并截断过长的行（对齐Rust版本）
            const numberedLines = resultLines.map((line, idx) => {
                const lineNum = effectiveStartLine + idx;
                const truncatedLine = this.truncateLine(line);
                return `${String(lineNum).padStart(6, " ")}|${truncatedLine}`;
            });
            const fileContent = numberedLines.join("\n");
            const actualStartLine = effectiveStartLine;
            const actualEndLine = effectiveStartLine + resultLines.length - 1;
            const linesRead = resultLines.length;
            // 构建返回结果（对齐Rust版本的格式）
            const resultForAssistant = `Read lines ${actualStartLine}-${actualEndLine} from ${fullPath} (${totalLines} total lines)
<file_content>
${fileContent}
</file_content>`;
            return {
                tool_id: input.tool_id,
                tool_name: input.tool_name,
                result: {
                    file_path: fullPath,
                    content: fileContent,
                    total_lines: totalLines,
                    lines_read: linesRead,
                    start_line: actualStartLine,
                    end_line: actualEndLine,
                    size: fileContent.length,
                },
                result_for_assistant: resultForAssistant,
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
                result_for_assistant: `读取文件失败: ${error instanceof Error ? error.message : String(error)}`,
                is_error: true,
                duration_ms: Date.now() - startTime,
            };
        }
    }
    is_end_turn_tool() {
        return false;
    }
    is_concurrency_safe() {
        return true; // 读取操作是并发安全的
    }
    is_readonly() {
        return true;
    }
    needs_permissions(_input) {
        return false; // 只读操作不需要权限
    }
}
//# sourceMappingURL=read_tool.js.map