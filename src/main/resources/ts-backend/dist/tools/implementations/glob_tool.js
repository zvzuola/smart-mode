/**
 * Glob 工具 - 文件名模式匹配
 */
import fs from "node:fs/promises";
import path from "node:path";
import { getGlobalWorkspacePath } from "../../context/workspace.js";
export class GlobTool {
    name = "Glob";
    description = `Fast file pattern matching tool support Standard Unix-style glob syntax
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths
- Use this tool when you need to find files by name patterns
- You can call multiple tools in a single response. It is always better to speculatively perform multiple searches in parallel if they are potentially useful.
<example>
- List files and directories in path: path = "/path/to/search", pattern = "*"
- Search all markdown files in path recursively: path = "/path/to/search", pattern = "**/*.md"
- Search all typescript files in src: path = "/path/to/search", pattern = "src/**/*.ts"
</example>`;
    get_definition() {
        return {
            name: this.name,
            description: this.description,
            input_schema: {
                type: "object",
                properties: {
                    pattern: {
                        type: "string",
                        description: 'The glob pattern to match files against. Patterns not starting with "**/" are automatically prepended with "**/" to enable recursive searching. Examples: "*.js" (becomes "**/*.js"), "**/node_modules/**", "**/test/**/test_*.ts"',
                    },
                    path: {
                        type: "string",
                        description: "Absolute path to directory to search for files in. If not provided, defaults to workspace root.",
                    },
                    limit: {
                        type: "number",
                        description: "Maximum number of files to return. Defaults to 200.",
                    },
                },
                required: ["pattern"],
            },
        };
    }
    matchesGlobPattern(filename, pattern) {
        // 转换 glob 模式为正则表达式
        let regexPattern = pattern
            .replace(/\./g, "\\.") // . -> \.
            .replace(/\*\*/g, "§§") // ** -> 临时占位符
            .replace(/\*/g, "[^/\\\\]*") // * -> [^/\\]*
            .replace(/§§/g, ".*") // ** -> .*
            .replace(/\?/g, "."); // ? -> .
        const regex = new RegExp("^" + regexPattern + "$");
        return regex.test(filename);
    }
    async findFiles(dirPath, pattern, basePath, limit, results = []) {
        if (results.length >= limit) {
            return results;
        }
        try {
            const items = await fs.readdir(dirPath, { withFileTypes: true });
            for (const item of items) {
                if (results.length >= limit) {
                    break;
                }
                const itemPath = path.join(dirPath, item.name);
                const relativePath = path.relative(basePath, itemPath);
                // 跳过隐藏文件和常见的忽略目录
                if (item.name.startsWith(".") ||
                    item.name === "node_modules" ||
                    item.name === "target" ||
                    item.name === "dist" ||
                    item.name === "build") {
                    continue;
                }
                try {
                    if (item.isDirectory()) {
                        // 递归搜索子目录
                        await this.findFiles(itemPath, pattern, basePath, limit, results);
                    }
                    else if (item.isFile()) {
                        // 检查文件名是否匹配模式
                        if (this.matchesGlobPattern(relativePath, pattern) ||
                            this.matchesGlobPattern(relativePath.replace(/\\/g, "/"), pattern)) {
                            const stats = await fs.stat(itemPath);
                            results.push({
                                path: itemPath,
                                mtime: stats.mtime,
                            });
                        }
                    }
                }
                catch (error) {
                    // 忽略无法访问的文件
                    console.warn(`Cannot access ${itemPath}:`, error);
                }
            }
        }
        catch (error) {
            console.warn(`Cannot read directory ${dirPath}:`, error);
        }
        return results;
    }
    async execute(input, context) {
        const startTime = Date.now();
        const { pattern, path: searchPath, limit } = input.arguments;
        try {
            // 参数验证
            if (typeof pattern !== "string") {
                throw new Error("pattern must be a string");
            }
            if (pattern.trim() === "") {
                throw new Error("pattern cannot be empty");
            }
            // 解析搜索路径
            let basePath;
            if (typeof searchPath === "string" && searchPath.trim() !== "") {
                basePath = path.isAbsolute(searchPath) ? searchPath : path.resolve(context.workspace_path || ".", searchPath);
            }
            else {
                basePath = context.workspace_path || getGlobalWorkspacePath() || process.cwd();
            }
            // 检查路径是否存在
            try {
                const stats = await fs.stat(basePath);
                if (!stats.isDirectory()) {
                    throw new Error(`Path is not a directory: ${basePath}`);
                }
            }
            catch {
                throw new Error(`Directory does not exist: ${basePath}`);
            }
            // 解析 limit
            const maxLimit = typeof limit === "number" ? limit : 200;
            // 确保模式以 **/ 开头（递归搜索）
            let searchPattern = pattern;
            if (!pattern.startsWith("**/") && !pattern.startsWith("/")) {
                searchPattern = "**/" + pattern;
            }
            // 搜索文件
            const results = await this.findFiles(basePath, searchPattern, basePath, maxLimit);
            // 按修改时间排序（最新的在前）
            results.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
            // 格式化结果
            const paths = results.map((r) => r.path);
            let resultText;
            if (paths.length === 0) {
                resultText = `No files found matching pattern: ${pattern}`;
            }
            else {
                resultText = `Found ${paths.length} file(s) matching pattern: ${pattern}\n\n${paths.join("\n")}`;
                if (results.length >= maxLimit) {
                    resultText += `\n\n(showing first ${maxLimit} files)`;
                }
            }
            return {
                tool_id: input.tool_id,
                tool_name: input.tool_name,
                result: {
                    pattern,
                    base_path: basePath,
                    files: paths,
                    count: paths.length,
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
                result_for_assistant: `Failed to search files: ${error instanceof Error ? error.message : String(error)}`,
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
//# sourceMappingURL=glob_tool.js.map