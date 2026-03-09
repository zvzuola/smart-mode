/**
 * StrReplace 工具 - 精确字符串替换
 * 对应 Rust 版本的 FileEditTool (Edit)
 */
import fs from "node:fs/promises";
import path from "node:path";
import { getGlobalWorkspacePath } from "../../context/workspace.js";
export class StrReplaceTool {
    name = "Edit";
    description = "Performs exact string replacements in files";
    get_definition() {
        return {
            name: this.name,
            description: `Performs exact string replacements in files.

Usage:
- You must use your \`Read\` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file.
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if \`old_string\` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use \`replace_all\` to change every instance of \`old_string\`.
- Use \`replace_all\` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.`,
            input_schema: {
                type: "object",
                properties: {
                    file_path: {
                        type: "string",
                        description: "The absolute path to the file to modify",
                    },
                    old_string: {
                        type: "string",
                        description: "The text to replace (must be unique within the file, and must match the file contents exactly, including all whitespace and indentation)",
                    },
                    new_string: {
                        type: "string",
                        description: "The text to replace it with (must be different from old_string)",
                    },
                    replace_all: {
                        type: "boolean",
                        description: "Replace all occurences of old_string (default false)",
                    },
                },
                required: ["file_path", "old_string", "new_string"],
            },
        };
    }
    async execute(input, context) {
        const startTime = Date.now();
        const { file_path, old_string, new_string, replace_all } = input.arguments;
        try {
            // 参数验证
            if (typeof file_path !== "string") {
                throw new Error("file_path must be a string");
            }
            if (typeof old_string !== "string") {
                throw new Error("old_string must be a string");
            }
            if (typeof new_string !== "string") {
                throw new Error("new_string must be a string");
            }
            if (old_string === new_string) {
                throw new Error("old_string and new_string must be different");
            }
            const replaceAll = typeof replace_all === "boolean" ? replace_all : false;
            // 解析路径（优先级：context > 全局workspace > 当前目录）
            let fullPath = file_path;
            if (!path.isAbsolute(file_path)) {
                const workspace = context.workspace_path || getGlobalWorkspacePath();
                if (workspace) {
                    fullPath = path.resolve(workspace, file_path);
                }
            }
            // 检查文件是否存在
            try {
                await fs.access(fullPath);
            }
            catch {
                throw new Error(`File does not exist: ${fullPath}`);
            }
            // 读取文件内容
            const content = await fs.readFile(fullPath, "utf-8");
            // 检查 old_string 是否存在
            if (!content.includes(old_string)) {
                throw new Error(`old_string not found in file: ${fullPath}`);
            }
            // 检查唯一性
            if (!replaceAll) {
                const occurrences = content.split(old_string).length - 1;
                if (occurrences > 1) {
                    throw new Error(`old_string appears ${occurrences} times in file. Either provide a larger string with more surrounding context to make it unique or use replace_all=true`);
                }
            }
            // 执行替换
            let newContent;
            let replacementCount;
            if (replaceAll) {
                newContent = content.split(old_string).join(new_string);
                replacementCount = content.split(old_string).length - 1;
            }
            else {
                newContent = content.replace(old_string, new_string);
                replacementCount = 1;
            }
            // 写入文件
            await fs.writeFile(fullPath, newContent, "utf-8");
            // 计算行号信息
            const startLine = content.substring(0, content.indexOf(old_string)).split("\n").length;
            const oldLines = old_string.split("\n").length;
            const newLines = new_string.split("\n").length;
            const oldEndLine = startLine + oldLines - 1;
            const newEndLine = startLine + newLines - 1;
            return {
                tool_id: input.tool_id,
                tool_name: input.tool_name,
                result: {
                    file_path: fullPath,
                    old_string,
                    new_string,
                    success: true,
                    start_line: startLine,
                    old_end_line: oldEndLine,
                    new_end_line: newEndLine,
                    replacement_count: replacementCount,
                },
                result_for_assistant: `Successfully edited ${fullPath} (${replacementCount} replacement${replacementCount > 1 ? "s" : ""})`,
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
                result_for_assistant: `Failed to edit file: ${error instanceof Error ? error.message : String(error)}`,
                is_error: true,
                duration_ms: Date.now() - startTime,
            };
        }
    }
    is_end_turn_tool() {
        return false;
    }
    is_concurrency_safe() {
        return false;
    }
    is_readonly() {
        return false;
    }
    needs_permissions(_input) {
        return true; // 编辑操作需要权限
    }
}
//# sourceMappingURL=str_replace_tool.js.map