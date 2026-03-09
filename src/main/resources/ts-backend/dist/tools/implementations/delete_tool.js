/**
 * Delete 工具 - 删除文件或目录
 */
import fs from "node:fs/promises";
import path from "node:path";
import { getGlobalWorkspacePath } from "../../context/workspace.js";
export class DeleteTool {
    name = "Delete";
    description = "Deletes a file or directory from the filesystem";
    get_definition() {
        return {
            name: this.name,
            description: `Deletes a file or directory from the filesystem. This operation is tracked by the snapshot system and can be rolled back if needed.

Usage guidelines:
1. **File Deletion**:
   - Provide the path to the file you want to delete (relative or absolute)
   - The file must exist and be accessible
   - Example: Delete a single file like \`old_file.txt\` or \`/path/to/file.txt\`

2. **Directory Deletion**:
   - For empty directories, just provide the path
   - For non-empty directories, you MUST set \`recursive: true\`
   - Be careful with recursive deletion as it will remove all contents

3. **Path Requirements**:
   - You can use either relative paths (e.g., "temp/data.txt") or absolute paths (e.g., "/workspace/temp/data.txt")
   - Relative paths will be automatically resolved relative to the workspace directory
   - The path must exist in the filesystem

4. **Safety Features**:
    - All deletions are tracked by the snapshot system
    - Users can review and roll back deletions if needed
    - The tool requires user confirmation for execution

5. **Best Practices**:
   - Before deleting, consider using the Read or LS tools to verify the target
   - For directories, use LS to check contents before recursive deletion
   - Prefer this tool over bash \`rm\` commands for better tracking and safety

Example usage:
\`\`\`json
{
  "path": "/workspace/old_file.txt"
}
\`\`\`

Example for directory:
\`\`\`json
{
  "path": "/workspace/temp_folder",
  "recursive": true
}
\`\`\`

Important notes:
 - NEVER use bash \`rm\` commands when this tool is available
 - This tool provides better safety through the snapshot system
 - All deletions can be rolled back through the snapshot interface
 - The tool will fail gracefully if permissions are insufficient`,
            input_schema: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "The absolute path to the file or directory to delete",
                    },
                    recursive: {
                        type: "boolean",
                        description: "If true, recursively delete directories and their contents. Required when deleting non-empty directories. Default: false",
                    },
                },
                required: ["path"],
            },
        };
    }
    async execute(input, context) {
        const startTime = Date.now();
        const { path: filePath, recursive } = input.arguments;
        try {
            // 参数验证
            if (typeof filePath !== "string") {
                throw new Error("path must be a string");
            }
            if (filePath.trim() === "") {
                throw new Error("path cannot be empty");
            }
            const isRecursive = typeof recursive === "boolean" ? recursive : false;
            // 解析路径（优先级：context > 全局workspace > 当前目录）
            let fullPath = filePath;
            if (!path.isAbsolute(filePath)) {
                const workspace = context.workspace_path || getGlobalWorkspacePath();
                if (workspace) {
                    fullPath = path.resolve(workspace, filePath);
                }
            }
            // 检查路径是否存在
            let stats;
            try {
                stats = await fs.stat(fullPath);
            }
            catch {
                throw new Error(`Path does not exist: ${fullPath}`);
            }
            const isDirectory = stats.isDirectory();
            // 如果是目录，检查是否需要递归删除
            if (isDirectory) {
                const entries = await fs.readdir(fullPath);
                const isEmpty = entries.length === 0;
                if (!isEmpty && !isRecursive) {
                    throw new Error(`Directory is not empty: ${fullPath}. Set recursive=true to delete non-empty directories`);
                }
                // 删除目录
                if (isRecursive) {
                    await fs.rm(fullPath, { recursive: true, force: false });
                }
                else {
                    await fs.rmdir(fullPath);
                }
            }
            else {
                // 删除文件
                await fs.unlink(fullPath);
            }
            return {
                tool_id: input.tool_id,
                tool_name: input.tool_name,
                result: {
                    success: true,
                    path: fullPath,
                    is_directory: isDirectory,
                    recursive: isRecursive,
                },
                result_for_assistant: `Successfully deleted ${isDirectory ? "directory" : "file"} at: ${fullPath}`,
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
                result_for_assistant: `Failed to delete: ${error instanceof Error ? error.message : String(error)}`,
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
        return true; // 删除操作需要权限
    }
}
//# sourceMappingURL=delete_tool.js.map