/**
 * Git 工具 - Git版本控制操作
 * 对标Rust版本的 git_tool.rs
 */
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { getGlobalWorkspacePath } from "../../context/workspace.js";
const execAsync = promisify(exec);
/**
 * 允许的Git操作类型
 */
const ALLOWED_OPERATIONS = [
    "status",
    "diff",
    "log",
    "add",
    "commit",
    "branch",
    "checkout",
    "switch",
    "pull",
    "push",
    "fetch",
    "merge",
    "rebase",
    "stash",
    "reset",
    "restore",
    "show",
    "tag",
    "remote",
    "clone",
    "init",
    "blame",
    "cherry-pick",
    "rev-parse",
    "describe",
    "shortlog",
    "clean",
];
/**
 * 危险的Git操作（需要特别警告）
 */
const DANGEROUS_OPERATIONS = [
    "push --force",
    "push -f",
    "reset --hard",
    "clean -fd",
    "rebase",
];
export class GitTool {
    name = "Git";
    description = "Execute Git version control operations";
    get_definition() {
        return {
            name: this.name,
            description: `Execute Git version control operations safely.

Supported operations:
- status: View working tree status
- diff: View changes  
- log: View commit history
- add: Add files to staging area
- commit: Commit changes
- branch: Branch operations
- checkout/switch: Switch branches
- pull/push/fetch: Remote operations
- merge/rebase: Branch integration
- stash: Stash changes
- reset/restore: Undo changes
- And more...

IMPORTANT Safety Rules:
1. Dangerous operations (force push, hard reset, etc.) require explicit confirmation
2. Always review changes before committing
3. Use --dry-run when available to preview changes
4. Avoid destructive operations without backup

Usage Examples:
- "git status" - Check current status
- "git diff" - View unstaged changes
- "git diff --staged" - View staged changes
- "git log -10 --oneline" - View recent commits
- "git add ." - Stage all changes
- "git commit -m 'message'" - Commit with message
- "git push" - Push to remote`,
            input_schema: {
                type: "object",
                properties: {
                    operation: {
                        type: "string",
                        description: "The Git operation to execute (e.g., status, diff, log, add, commit)",
                    },
                    args: {
                        type: "string",
                        description: "Additional arguments for the Git command (optional)",
                    },
                    working_directory: {
                        type: "string",
                        description: "Working directory for Git command (defaults to workspace root)",
                    },
                },
                required: ["operation"],
            },
        };
    }
    async execute(input, context) {
        const startTime = Date.now();
        const { operation, args, working_directory } = input.arguments;
        try {
            if (typeof operation !== "string") {
                throw new Error("operation must be a string");
            }
            // 验证操作
            if (!ALLOWED_OPERATIONS.includes(operation)) {
                throw new Error(`Git operation '${operation}' is not allowed. Allowed operations: ${ALLOWED_OPERATIONS.join(", ")}`);
            }
            // 检查危险操作
            const fullCommand = args ? `${operation} ${args}` : operation;
            const isDangerous = DANGEROUS_OPERATIONS.some((danger) => fullCommand.includes(danger));
            if (isDangerous) {
                return {
                    tool_id: input.tool_id,
                    tool_name: input.tool_name,
                    result: {
                        warning: "Dangerous operation detected. Please confirm before proceeding.",
                        operation: fullCommand,
                    },
                    result_for_assistant: `⚠️ Warning: "${fullCommand}" is a dangerous Git operation. Please ask the user for explicit confirmation before proceeding.`,
                    is_error: false,
                    duration_ms: Date.now() - startTime,
                };
            }
            // 确定工作目录
            const cwd = (typeof working_directory === "string" ? working_directory : undefined) ||
                context.workspace_path ||
                getGlobalWorkspacePath() ||
                process.cwd();
            // 构建完整的Git命令
            const gitCommand = args ? `git ${operation} ${args}` : `git ${operation}`;
            // 执行Git命令
            const { stdout, stderr } = await execAsync(gitCommand, {
                cwd,
                maxBuffer: 1024 * 1024 * 10, // 10MB
            });
            const output = stdout || stderr || "";
            return {
                tool_id: input.tool_id,
                tool_name: input.tool_name,
                result: {
                    success: true,
                    operation: operation,
                    output: output,
                    working_directory: cwd,
                },
                result_for_assistant: this.formatGitOutput(operation, output),
                is_error: false,
                duration_ms: Date.now() - startTime,
            };
        }
        catch (error) {
            const errorMessage = error.message || String(error);
            const output = error.stdout || error.stderr || errorMessage;
            return {
                tool_id: input.tool_id,
                tool_name: input.tool_name,
                result: {
                    success: false,
                    operation: String(operation),
                    error: errorMessage,
                    output: output,
                },
                result_for_assistant: `Git operation failed: ${errorMessage}\n\nOutput: ${output}`,
                is_error: true,
                duration_ms: Date.now() - startTime,
            };
        }
    }
    /**
     * 格式化Git输出给助手
     */
    formatGitOutput(operation, output) {
        if (!output || output.trim().length === 0) {
            return `Git ${operation} completed successfully (no output).`;
        }
        // 对不同操作进行特殊格式化
        switch (operation) {
            case "status":
                return `Git Status:\n\`\`\`\n${output}\n\`\`\``;
            case "diff":
                return `Git Diff:\n\`\`\`diff\n${output}\n\`\`\``;
            case "log":
                return `Git Log:\n\`\`\`\n${output}\n\`\`\``;
            default:
                return `Git ${operation} output:\n\`\`\`\n${output}\n\`\`\``;
        }
    }
    is_end_turn_tool() {
        return false;
    }
    is_concurrency_safe() {
        return false; // Git操作可能修改仓库状态，不并发安全
    }
    is_readonly() {
        return false;
    }
    needs_permissions(input) {
        // 只读操作不需要权限
        const readonlyOps = ["status", "diff", "log", "show", "branch", "tag", "remote"];
        const operation = input?.operation;
        if (typeof operation === "string" && readonlyOps.includes(operation)) {
            return false;
        }
        return true; // 其他操作需要权限
    }
    async validate_input(input) {
        const operation = input.operation;
        if (typeof operation !== "string" || !operation) {
            return {
                result: false,
                message: "operation is required and must be a string",
                error_code: 400,
            };
        }
        if (!ALLOWED_OPERATIONS.includes(operation)) {
            return {
                result: false,
                message: `Git operation '${operation}' is not allowed`,
                error_code: 403,
                meta: {
                    allowed_operations: ALLOWED_OPERATIONS,
                },
            };
        }
        return {
            result: true,
        };
    }
    render_tool_use_message(input) {
        const operation = input.operation;
        const args = input.args;
        if (args && typeof args === "string") {
            return `git ${operation} ${args}`;
        }
        return `git ${operation}`;
    }
}
//# sourceMappingURL=git_tool.js.map