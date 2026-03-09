/**
 * Shell 工具 - 执行 Shell 命令
 */
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { getGlobalWorkspacePath } from "../../context/workspace.js";
const execAsync = promisify(exec);
const MAX_OUTPUT_LENGTH = 30000;
/**
 * 去除 ANSI 转义码
 */
function stripAnsi(text) {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;]*m/g, "");
}
/**
 * 按字符数截断字符串
 */
function truncateStringByChars(s, maxChars) {
    if (s.length <= maxChars) {
        return s;
    }
    return s.slice(0, maxChars);
}
export class ShellTool {
    name = "Bash"; // 对标Rust版本的工具名，确保前端正确渲染
    description = `Executes a given command in a persistent shell session with optional timeout, ensuring proper handling and security measures.

IMPORTANT: This tool is for terminal operations like git, npm, docker, etc. DO NOT use it for file operations (reading, writing, editing, searching, finding files) - use the specialized tools for this instead.

Before executing the command, please follow these steps:

1. Directory Verification:
   - If the command will create new directories or files, first use ls to verify the parent directory exists and is the correct location
   - For example, before running "mkdir foo/bar", first use ls foo to check that "foo" exists and is the intended parent directory

2. Command Execution:
   - Always quote file paths that contain spaces with double quotes (e.g., cd "path with spaces/file.txt")
   - Examples of proper quoting:
     - cd "/Users/name/My Documents" (correct)
     - cd /Users/name/My Documents (incorrect - will fail)
     - python "/path/with spaces/script.py" (correct)
     - python /path/with spaces/script.py (incorrect - will fail)
   - After ensuring proper quoting, execute the command.
   - Capture the output of the command.

Usage notes:
  - The command argument is required and MUST be a single-line command.
  - DO NOT use multiline commands or HEREDOC syntax (e.g., <<EOF, heredoc with newlines). Only single-line commands are supported.
  - You can specify an optional timeout in milliseconds.
  - It is very helpful if you write a clear, concise description of what this command does in 5-10 words.
  - If the output exceeds 30000 characters, output will be truncated before being returned to you.

  - Avoid using this tool with the find, grep, cat, head, tail, sed, awk, or echo commands, unless explicitly instructed or when these commands are truly necessary for the task. Instead, always prefer using the dedicated tools for these commands:
    - File search: Use Glob (NOT find or ls)
    - Content search: Use Grep (NOT grep or rg)
    - Read files: Use Read (NOT cat/head/tail)
    - Edit files: Use Edit (NOT sed/awk)
    - Write files: Use Write (NOT echo >/cat <<EOF)
    - Communication: Output text directly (NOT echo/printf)
  - When issuing multiple commands:
    - If the commands are independent and can run in parallel, make multiple Bash tool calls in a single message. For example, if you need to run "git status" and "git diff", send a single message with two Bash tool calls in parallel.
    - If the commands depend on each other and must run sequentially, use a single Bash call with '&&' to chain them together (e.g., git add . && git commit -m "message" && git push). For instance, if one operation must complete before another starts (like mkdir before cp, Write before Bash for git operations, or git add before git commit), run these operations sequentially instead.
    - Use ';' only when you need to run commands sequentially but don't care if earlier commands fail
    - DO NOT use newlines to separate commands (newlines are ok in quoted strings)
  - Try to maintain your current working directory throughout the session by using absolute paths and avoiding usage of cd. You may use cd if the User explicitly requests it.
    <good-example>
    pytest /foo/bar/tests
    </good-example>
    <bad-example>
    cd /foo/bar && pytest tests
    </bad-example>`;
    /**
     * 别名：Bash（为了与 Rust 版本兼容）
     */
    get aliases() {
        return ["Bash"];
    }
    /**
     * 解码输出（处理 Windows GBK 编码问题）
     */
    decodeOutput(buffer) {
        if (!buffer) {
            return "";
        }
        if (typeof buffer === "string") {
            return buffer;
        }
        // 先尝试 UTF-8
        const utf8Text = buffer.toString("utf8");
        // 如果没有乱码字符，说明是 UTF-8 编码
        if (!utf8Text.includes("�")) {
            return utf8Text;
        }
        // Windows 系统可能是 GBK 编码，尝试使用 latin1 作为中间格式
        // 注意：这是一个简化处理，完整的 GBK 转换需要 iconv-lite 库
        if (process.platform === "win32") {
            // 对于 Windows，如果有乱码，保留原始 UTF-8（PowerShell 输出应该是 UTF-8）
            return utf8Text;
        }
        return utf8Text;
    }
    get_definition() {
        return {
            name: this.name,
            description: this.description,
            input_schema: {
                type: "object",
                properties: {
                    command: {
                        type: "string",
                        description: "The command to execute",
                    },
                    timeout: {
                        type: "number",
                        description: "Optional timeout in milliseconds (max 600000)",
                    },
                    description: {
                        type: "string",
                        description: "Clear, concise description of what this command does in 5-10 words, in active voice. Examples:\nInput: ls\nOutput: List files in current directory\n\nInput: git status\nOutput: Show working tree status\n\nInput: npm install\nOutput: Install package dependencies\n\nInput: mkdir foo\nOutput: Create directory 'foo'",
                    },
                },
                required: ["command"],
            },
        };
    }
    /**
     * 渲染结果（使用与 Rust 版本相同的 XML 格式）
     */
    renderResult(outputText, interrupted, exitCode) {
        let resultString = "";
        // 退出码
        resultString += `<exit_code>${exitCode}</exit_code>`;
        // 主要输出内容
        if (outputText.length > 0) {
            const cleanedOutput = stripAnsi(outputText);
            const outputLen = cleanedOutput.length;
            if (outputLen > MAX_OUTPUT_LENGTH) {
                const truncated = truncateStringByChars(cleanedOutput, MAX_OUTPUT_LENGTH);
                resultString += `<output truncated="true">${truncated}</output>`;
            }
            else {
                resultString += `<output>${cleanedOutput}</output>`;
            }
        }
        // 中断提示
        if (interrupted) {
            resultString +=
                '<status type="interrupted">Command was canceled by the user. ASK THE USER what they would like to do next.</status>';
        }
        return resultString;
    }
    async execute(input, context) {
        const startTime = Date.now();
        const { command, timeout, description } = input.arguments;
        // 检查是否被取消
        let interrupted = false;
        if (context.signal?.aborted) {
            interrupted = true;
        }
        try {
            if (typeof command !== "string") {
                throw new Error("command must be a string");
            }
            // 工作目录优先级：context > 全局workspace > process.cwd()
            const cwd = context.workspace_path || getGlobalWorkspacePath() || process.cwd();
            const timeoutMs = typeof timeout === "number" ? Math.min(timeout, 600000) : 30000;
            // 执行命令（带超时）
            let finalCommand = command;
            const execOptions = {
                cwd,
                timeout: timeoutMs,
                maxBuffer: 1024 * 1024 * 10, // 10MB
                signal: context.signal,
                encoding: 'buffer', // 使用 buffer 模式，手动处理编码
            };
            // Windows 系统使用 PowerShell 并设置输出编码为 UTF-8
            if (process.platform === 'win32') {
                // 使用 PowerShell 并设置编码
                execOptions.shell = 'powershell.exe';
                // 在命令前添加编码设置
                finalCommand = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${command}`;
            }
            const { stdout, stderr } = await execAsync(finalCommand, execOptions);
            // 手动处理编码转换
            const stdoutStr = this.decodeOutput(stdout);
            const stderrStr = this.decodeOutput(stderr);
            const output = stdoutStr || stderrStr || "";
            const exitCode = 0;
            // 构建结果数据（用于 result 字段）
            const resultData = {
                success: true,
                command,
                output,
                exit_code: exitCode,
                interrupted: false,
                working_directory: cwd,
                execution_time_ms: Date.now() - startTime,
                terminal_session_id: context.session_id, // 对标Rust版本
            };
            // 渲染给 AI 的结果（XML 格式）
            const resultForAssistant = this.renderResult(output, false, exitCode);
            return {
                tool_id: input.tool_id,
                tool_name: input.tool_name,
                result: resultData,
                result_for_assistant: resultForAssistant,
                is_error: false,
                duration_ms: Date.now() - startTime,
            };
        }
        catch (error) {
            // 检查是否是取消导致的错误
            if (error.killed || error.signal === "SIGTERM" || context.signal?.aborted) {
                interrupted = true;
            }
            const exitCode = interrupted ? 130 : error.code || 1;
            // 手动处理编码转换
            const stdoutStr = this.decodeOutput(error.stdout);
            const stderrStr = this.decodeOutput(error.stderr);
            const output = stdoutStr || stderrStr || error.message || "";
            // 构建结果数据
            const resultData = {
                success: false,
                command: command,
                output,
                exit_code: exitCode,
                interrupted,
                working_directory: context.workspace_path || getGlobalWorkspacePath() || process.cwd(),
                execution_time_ms: Date.now() - startTime,
                terminal_session_id: context.session_id, // 对标Rust版本
            };
            // 渲染给 AI 的结果（XML 格式）
            const resultForAssistant = this.renderResult(output, interrupted, exitCode);
            return {
                tool_id: input.tool_id,
                tool_name: input.tool_name,
                result: resultData,
                result_for_assistant: resultForAssistant,
                is_error: !interrupted && exitCode !== 0, // 如果是中断，不标记为错误
                duration_ms: Date.now() - startTime,
            };
        }
    }
    is_end_turn_tool() {
        return false;
    }
    is_concurrency_safe() {
        return false; // Shell 命令执行不是并发安全的
    }
    is_readonly() {
        return false; // Shell 可能会修改文件系统
    }
    needs_permissions(_input) {
        return true; // Shell工具总是需要权限检查
    }
    async validate_input(input, _context) {
        const command = input.command;
        if (typeof command !== "string" || !command) {
            return {
                result: false,
                message: "command is required and must be a string",
                error_code: 400,
            };
        }
        // 检查禁止的命令（对标Rust版本的BANNED_COMMANDS）
        const bannedCommands = [
            "alias",
            "curl",
            "curlie",
            "wget",
            "axel",
            "aria2c",
            "nc",
            "telnet",
            "lynx",
            "w3m",
            "links",
            "httpie",
            "xh",
            "http-prompt",
            "chrome",
            "firefox",
            "safari",
        ];
        const parts = command.split(/\s+/);
        const baseCmd = parts[0]?.toLowerCase();
        if (baseCmd && bannedCommands.includes(baseCmd)) {
            return {
                result: false,
                message: `Command '${baseCmd}' is not allowed for security reasons`,
                error_code: 403,
            };
        }
        return {
            result: true,
        };
    }
    render_result_for_assistant(output) {
        if (typeof output === "object" && output !== null) {
            const result = output;
            const outputText = String(result.output || "");
            const exitCode = Number(result.exit_code || 0);
            const interrupted = Boolean(result.interrupted);
            return this.renderResult(outputText, interrupted, exitCode);
        }
        return String(output);
    }
    render_tool_use_message(input) {
        const command = input.command;
        if (typeof command === "string") {
            // 清理HEREDOC格式的命令（对标Rust版本）
            if (command.includes('"$(cat <<\'EOF\'')) {
                const match = command.match(/"\\$\\(cat <<'EOF'\n(.+?)\nEOF\n\\)"/s);
                if (match) {
                    return match[1].trim();
                }
            }
            return command;
        }
        return "Executing command";
    }
}
//# sourceMappingURL=shell_tool.js.map