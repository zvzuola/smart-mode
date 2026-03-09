/**
 * HarmonyOS编译检查工具 - 用于验证HarmonyOS项目的编译正确性
 *
 * 通过编译HarmonyOS项目来验证代码修改的正确性
 *
 * 对标Rust版本: backend/vcoder/crates/core/src/agentic/tools/implementations/hmos_compilation_tool.rs
 */
import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { findDevecoHome, setUserDevecoHome, getUserDevecoHome } from "./deveco_resolver.js";
const execAsync = promisify(exec);
const MAX_ASSISTANT_ERROR_CHARS = 12000;
/**
 * HarmonyOS编译检查工具
 */
export class HmosCompilationTool {
    name = "HmosCompilation";
    description = `Compile a HarmonyOS project. Returns filtered error messages on failure (warnings are excluded)

WHEN TO USE:
- After modifying HarmonyOS/ArkTS source files to verify correctness
- After fixing compilation errors to confirm the fix works
- Before concluding a task to ensure code changes are valid`;
    /**
     * 设置用户配置的 DevEco Studio 路径（委托到 deveco_resolver）
     */
    static setUserConfigDevecoHome(devecoHome) {
        setUserDevecoHome(devecoHome);
    }
    /**
     * 获取当前用户配置的 DevEco Studio 路径（委托到 deveco_resolver）
     */
    static getUserConfigDevecoHome() {
        return getUserDevecoHome();
    }
    get_definition() {
        return {
            name: this.name,
            description: this.description,
            input_schema: {
                type: "object",
                properties: {
                    project_abs_path: {
                        type: "string",
                        description: "The absolute path of the HarmonyOS project",
                    },
                },
                required: ["project_abs_path"],
            },
        };
    }
    // findDevecoHome 已提取到 deveco_resolver.ts
    /**
     * 构建编译命令
     */
    async buildCompilationCommand(devecoHome, _projectPath) {
        const isWindows = process.platform === "win32";
        // Windows: tools/node/node.exe  macOS: tools/node/bin/node
        const nodePath = isWindows
            ? path.join(devecoHome, "tools", "node", "node.exe")
            : path.join(devecoHome, "tools", "node", "bin", "node");
        const hvigorwPath = path.join(devecoHome, "tools", "hvigor", "bin", "hvigorw.js");
        const devecoSdkHome = path.join(devecoHome, "sdk");
        // 验证必要文件存在
        try {
            await fs.access(nodePath);
        }
        catch {
            throw new Error(`Node.js not found at: ${nodePath}`);
        }
        try {
            await fs.access(hvigorwPath);
        }
        catch {
            throw new Error(`Hvigorw not found at: ${hvigorwPath}`);
        }
        try {
            await fs.access(devecoSdkHome);
        }
        catch {
            throw new Error(`SDK not found at: ${devecoSdkHome}`);
        }
        // 构建环境变量
        const pathSeparator = isWindows ? ";" : ":";
        const pathDirs = isWindows
            ? [
                path.join(devecoHome, "tools", "node"),
                path.join(devecoHome, "tools", "ohpm", "bin"),
                path.join(devecoHome, "tools", "hvigor", "bin"),
                path.join(devecoHome, "jbr", "bin"),
                "C:\\Windows\\system32",
                "C:\\Windows",
                "C:\\Windows\\System32\\Wbem",
            ]
            : [
                path.join(devecoHome, "tools", "node", "bin"),
                path.join(devecoHome, "tools", "ohpm", "bin"),
                path.join(devecoHome, "tools", "hvigor", "bin"),
                path.join(devecoHome, "jbr", "Contents", "Home", "bin"),
                "/usr/local/bin",
                "/usr/bin",
                "/bin",
            ];
        const env = {
            PATH: pathDirs.join(pathSeparator),
            DEVECO_SDK_HOME: devecoSdkHome,
        };
        // 构建编译参数
        const args = [
            hvigorwPath,
            "assembleHap",
            "--mode",
            "module",
            "-p",
            "product=default",
            "-p",
            "buildMode=debug",
            "--error",
            "--parallel",
            "--incremental",
            "--no-daemon",
        ];
        return {
            command: nodePath,
            args,
            env,
        };
    }
    /**
     * 过滤编译输出，只保留错误信息（排除警告）
     */
    filterCompilationOutput(stderr) {
        if (!stderr.includes("ERROR")) {
            return stderr;
        }
        // 使用简单的字符串处理过滤警告
        const lines = stderr.split("\n");
        const errorLines = [];
        let skipWarnings = false;
        for (const line of lines) {
            if (line.includes("WARN")) {
                skipWarnings = true;
            }
            else if (line.includes("ERROR")) {
                skipWarnings = false;
                errorLines.push(line);
            }
            else if (!skipWarnings) {
                errorLines.push(line);
            }
        }
        return errorLines.join("\n");
    }
    async maybeTruncateErrorOutput(filteredError) {
        if (filteredError.length <= MAX_ASSISTANT_ERROR_CHARS) {
            return {
                displayText: filteredError,
                isTruncated: false,
            };
        }
        const fullOutputPath = path.join(os.tmpdir(), `vcoder-hmos-compilation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.log`);
        await fs.writeFile(fullOutputPath, filteredError, "utf8");
        const preview = filteredError.slice(0, MAX_ASSISTANT_ERROR_CHARS);
        const marker = `\n\n已截断显示，完整编译结果已保存至文件：\n${fullOutputPath}\n`;
        return {
            displayText: `${preview}${marker}`,
            isTruncated: true,
            fullOutputPath,
        };
    }
    async execute(input, _context) {
        const startTime = Date.now();
        try {
            const projectPath = input.arguments.project_abs_path;
            if (!projectPath || typeof projectPath !== "string") {
                throw new Error("project_abs_path is required");
            }
            console.info(`🔧 Starting HarmonyOS project compilation check: ${projectPath}`);
            // 验证项目路径存在
            try {
                await fs.access(projectPath);
            }
            catch {
                throw new Error(`Project path does not exist: ${projectPath}`);
            }
            // 查找DevEco Studio安装路径
            const devecoHome = await findDevecoHome();
            if (!devecoHome) {
                throw new Error("DevEco Studio 安装路径未找到。请通过以下方式之一进行配置：\n" +
                    "1. 在右上角设置菜单 → 工具设置中配置 DevEco Studio 路径\n" +
                    "2. 设置系统环境变量 DEVECO_HOME 指向 DevEco Studio 安装目录\n" +
                    "   例如: C:\\Program Files\\DevEco Studio");
            }
            console.info(`📁 DevEco Studio path: ${devecoHome}`);
            // 构建编译命令
            const { command, args, env } = await this.buildCompilationCommand(devecoHome, projectPath);
            const fullCommand = `"${command}" ${args.map((arg) => `"${arg}"`).join(" ")}`;
            console.info(`🚀 Executing compilation command: ${fullCommand}`);
            // 执行编译命令
            let stdout = "";
            let stderr = "";
            let exitCode = 0;
            let success = false;
            try {
                const result = await execAsync(fullCommand, {
                    cwd: projectPath,
                    env: { ...process.env, ...env },
                    maxBuffer: 10 * 1024 * 1024, // 10MB buffer
                    windowsHide: true, // 隐藏Windows命令行窗口
                });
                stdout = result.stdout;
                stderr = result.stderr;
                exitCode = 0;
                success = true;
            }
            catch (error) {
                stdout = error.stdout || "";
                stderr = error.stderr || "";
                exitCode = error.code || -1;
                success = false;
            }
            const duration = Date.now() - startTime;
            console.info(`✅ Compilation completed (${duration}ms)`);
            console.info(`📊 Exit code: ${exitCode}`);
            // 检查编译结果
            const compilationSuccess = success && !stderr.includes("ERROR");
            let resultMessage;
            let isOutputTruncated = false;
            let fullOutputPath;
            if (compilationSuccess) {
                console.info("✅ Compilation successful");
                resultMessage = "Compilation successful";
            }
            else {
                console.warn("❌ Compilation failed");
                // 过滤掉warning，只保留错误信息
                const filteredError = this.filterCompilationOutput(stderr);
                const truncated = await this.maybeTruncateErrorOutput(filteredError);
                isOutputTruncated = truncated.isTruncated;
                fullOutputPath = truncated.fullOutputPath;
                resultMessage = `Compilation failed:\n${truncated.displayText}`;
            }
            // 返回结果
            return {
                tool_id: input.tool_id,
                tool_name: input.tool_name,
                result: {
                    success: compilationSuccess,
                    exit_code: exitCode,
                    stdout,
                    stderr,
                    is_output_truncated: isOutputTruncated,
                    full_output_path: fullOutputPath,
                    execution_time_ms: duration,
                    project_path: projectPath,
                    deveco_home: devecoHome,
                },
                result_for_assistant: resultMessage,
                is_error: !compilationSuccess,
                duration_ms: duration,
            };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`❌ HarmonyOS compilation tool error: ${errorMsg}`);
            return {
                tool_id: input.tool_id,
                tool_name: input.tool_name,
                result: {
                    success: false,
                    error: errorMsg,
                },
                result_for_assistant: `Compilation failed: ${errorMsg}`,
                is_error: true,
                duration_ms: Date.now() - startTime,
            };
        }
    }
    is_end_turn_tool() {
        return false;
    }
    is_concurrency_safe() {
        return false; // 编译过程可能修改构建缓存，不安全并发
    }
    is_readonly() {
        return true; // 编译检查不修改源代码，只读操作
    }
    needs_permissions(_input) {
        return false; // 编译检查不需要用户权限确认
    }
    async validate_input(input, _context) {
        const projectPath = input.project_abs_path;
        if (typeof projectPath !== "string") {
            return {
                result: false,
                message: "project_abs_path is required and must be a string",
                error_code: 400,
            };
        }
        // 验证路径存在
        try {
            await fs.access(projectPath);
        }
        catch {
            return {
                result: false,
                message: `Project path does not exist: ${projectPath}`,
                error_code: 404,
            };
        }
        return {
            result: true,
        };
    }
    render_result_for_assistant(output) {
        if (typeof output === "object" && output !== null) {
            const result = output;
            const success = result.success;
            if (success === true) {
                return "Compilation successful";
            }
            else {
                const error = result.error;
                return `Compilation failed: ${error || "Unknown error"}`;
            }
        }
        return "Compilation result unknown";
    }
    render_tool_use_message(input) {
        const path = input.project_abs_path;
        if (typeof path === "string") {
            return `Compiling HarmonyOS project: ${path}`;
        }
        return "Compiling HarmonyOS project";
    }
}
//# sourceMappingURL=hmos_compilation_tool.js.map