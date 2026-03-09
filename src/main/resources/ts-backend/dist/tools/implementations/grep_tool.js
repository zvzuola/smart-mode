/**
 * Grep 工具 - 代码搜索
 */
import fs from "node:fs/promises";
import path from "node:path";
import { getGlobalWorkspacePath } from "../../context/workspace.js";
export class GrepTool {
    name = "Grep";
    description = `A powerful search tool built on ripgrep

Usage:
- ALWAYS use Grep for search tasks. NEVER invoke \`grep\` or \`rg\` as a Bash command. The Grep tool has been optimized for correct permissions and access.
- Supports full regex syntax (e.g., "log.*Error", "function\\s+\\w+")
- Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter (e.g., "js", "py", "rust")
- Output modes: "content" shows matching lines, "files_with_matches" shows only file paths (default), "count" shows match counts
- Use Task tool for open-ended searches requiring multiple rounds
- Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping (use interface\\{\\} to find interface{} in Go code)
- Multiline matching: By default patterns match within single lines only. For cross-line patterns like struct \\{[\\s\\S]*?field, use multiline: true`;
    get_definition() {
        return {
            name: this.name,
            description: this.description,
            input_schema: {
                type: "object",
                properties: {
                    pattern: {
                        type: "string",
                        description: "The regular expression pattern to search for in file contents",
                    },
                    path: {
                        type: "string",
                        description: "File or directory to search in (rg PATH). Defaults to current working directory.",
                    },
                    glob: {
                        type: "string",
                        description: 'Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}") - maps to rg --glob',
                    },
                    type: {
                        type: "string",
                        description: "File type to search (rg --type). Common types: js, py, rust, go, java, etc. More efficient than include for standard file types.",
                    },
                    output_mode: {
                        type: "string",
                        description: 'Output mode: "content" shows matching lines (supports -A/-B/-C context, -n line numbers, head_limit), "files_with_matches" shows file paths (supports head_limit), "count" shows match counts (supports head_limit). Defaults to "files_with_matches".',
                    },
                    "-i": {
                        type: "boolean",
                        description: "Case insensitive search (rg -i) Defaults to false",
                    },
                    "-A": {
                        type: "number",
                        description: "Number of lines to show after each match (rg -A). Requires output_mode: \"content\", ignored otherwise.",
                    },
                    "-B": {
                        type: "number",
                        description: "Number of lines to show before each match (rg -B). Requires output_mode: \"content\", ignored otherwise.",
                    },
                    "-C": {
                        type: "number",
                        description: "Number of lines to show before and after each match (rg -C). Requires output_mode: \"content\", ignored otherwise.",
                    },
                    head_limit: {
                        type: "number",
                        description: "Limit output size. For \"content\" mode: limits total matches shown. For \"files_with_matches\" and \"count\" modes: limits number of files.",
                    },
                    multiline: {
                        type: "boolean",
                        description: "Enable multiline mode where . matches newlines and patterns can span lines (rg -U --multiline-dotall). Default: false.",
                    },
                },
                required: ["pattern"],
            },
        };
    }
    getTypeExtensions(type) {
        const typeMap = {
            js: [".js", ".jsx"],
            ts: [".ts", ".tsx"],
            typescript: [".ts", ".tsx"],
            javascript: [".js", ".jsx"],
            python: [".py"],
            py: [".py"],
            rust: [".rs"],
            go: [".go"],
            java: [".java"],
            cpp: [".cpp", ".cc", ".cxx", ".hpp", ".h"],
            c: [".c", ".h"],
            json: [".json"],
            yaml: [".yaml", ".yml"],
            xml: [".xml"],
            html: [".html", ".htm"],
            css: [".css", ".scss", ".sass"],
            md: [".md"],
            markdown: [".md"],
        };
        return typeMap[type.toLowerCase()] || [];
    }
    matchesGlob(filename, pattern) {
        const regex = new RegExp("^" +
            pattern
                .replace(/\./g, "\\.")
                .replace(/\*/g, ".*")
                .replace(/\?/g, ".") +
            "$");
        return regex.test(filename);
    }
    shouldSearchFile(filePath, glob, type) {
        const filename = path.basename(filePath);
        const ext = path.extname(filePath);
        // 跳过隐藏文件和常见的忽略目录
        if (filename.startsWith(".") || filePath.includes("/node_modules/") || filePath.includes("\\node_modules\\")) {
            return false;
        }
        // 检查文件类型
        if (type) {
            const extensions = this.getTypeExtensions(type);
            if (extensions.length > 0 && !extensions.includes(ext)) {
                return false;
            }
        }
        // 检查 glob 模式
        if (glob) {
            if (!this.matchesGlob(filename, glob)) {
                return false;
            }
        }
        return true;
    }
    async searchFile(filePath, pattern, options) {
        const matches = [];
        let count = 0;
        try {
            const content = await fs.readFile(filePath, "utf-8");
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const match = pattern.exec(line);
                if (match) {
                    count++;
                    if (options.outputMode === "content") {
                        matches.push({
                            file: filePath,
                            line_number: i + 1,
                            line_content: line,
                            match_start: match.index,
                            match_end: match.index + match[0].length,
                        });
                    }
                }
            }
        }
        catch (error) {
            // 忽略无法读取的文件
            console.warn(`Cannot read file ${filePath}:`, error);
        }
        return { matches, count };
    }
    async searchDirectory(dirPath, pattern, options, results = {
        matches: [],
        files: new Set(),
        counts: [],
    }) {
        if (options.outputMode === "content" && results.matches.length >= options.headLimit) {
            return results;
        }
        if (options.outputMode === "files_with_matches" && results.files.size >= options.headLimit) {
            return results;
        }
        if (options.outputMode === "count" && results.counts.length >= options.headLimit) {
            return results;
        }
        try {
            const items = await fs.readdir(dirPath, { withFileTypes: true });
            for (const item of items) {
                const itemPath = path.join(dirPath, item.name);
                // 跳过常见的忽略目录
                if (item.name.startsWith(".") ||
                    item.name === "node_modules" ||
                    item.name === "target" ||
                    item.name === "dist" ||
                    item.name === "build") {
                    continue;
                }
                try {
                    if (item.isDirectory()) {
                        await this.searchDirectory(itemPath, pattern, options, results);
                    }
                    else if (item.isFile() && this.shouldSearchFile(itemPath, options.glob, options.type)) {
                        const { matches, count } = await this.searchFile(itemPath, pattern, options);
                        if (count > 0) {
                            if (options.outputMode === "content") {
                                results.matches.push(...matches.slice(0, options.headLimit - results.matches.length));
                            }
                            else if (options.outputMode === "files_with_matches") {
                                results.files.add(itemPath);
                            }
                            else if (options.outputMode === "count") {
                                results.counts.push({ file: itemPath, match_count: count });
                            }
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
    formatResults(results, outputMode) {
        if (outputMode === "content") {
            if (results.matches.length === 0) {
                return "No matches found";
            }
            const lines = [];
            let currentFile = "";
            for (const match of results.matches) {
                if (match.file !== currentFile) {
                    if (currentFile !== "") {
                        lines.push("");
                    }
                    lines.push(`File: ${match.file}`);
                    currentFile = match.file;
                }
                lines.push(`  ${match.line_number}: ${match.line_content}`);
            }
            return lines.join("\n");
        }
        else if (outputMode === "files_with_matches") {
            if (results.files.size === 0) {
                return "No files with matches found";
            }
            return Array.from(results.files).join("\n");
        }
        else if (outputMode === "count") {
            if (results.counts.length === 0) {
                return "No matches found";
            }
            const lines = ["Match counts by file:"];
            for (const { file, match_count } of results.counts) {
                lines.push(`  ${match_count} matches in ${file}`);
            }
            const total = results.counts.reduce((sum, c) => sum + c.match_count, 0);
            lines.push(`\nTotal: ${total} matches in ${results.counts.length} files`);
            return lines.join("\n");
        }
        return "";
    }
    async execute(input, context) {
        const startTime = Date.now();
        const { pattern, path: searchPath, glob, type, output_mode, "-i": caseInsensitive, "-A": afterContext, "-B": beforeContext, "-C": aroundContext, head_limit, multiline, } = input.arguments;
        try {
            // 参数验证
            if (typeof pattern !== "string") {
                throw new Error("pattern must be a string");
            }
            if (pattern.trim() === "") {
                throw new Error("pattern cannot be empty");
            }
            // 构建正则表达式
            const flags = (caseInsensitive ? "i" : "") + (multiline ? "ms" : "");
            let regex;
            try {
                regex = new RegExp(pattern, flags);
            }
            catch (error) {
                throw new Error(`Invalid regex pattern: ${error instanceof Error ? error.message : String(error)}`);
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
            let stats;
            try {
                stats = await fs.stat(basePath);
            }
            catch {
                throw new Error(`Path does not exist: ${basePath}`);
            }
            // 解析参数
            const outputMode = output_mode || "content";
            const beforeCtx = typeof aroundContext === "number"
                ? aroundContext
                : typeof beforeContext === "number"
                    ? beforeContext
                    : undefined;
            const afterCtx = typeof aroundContext === "number"
                ? aroundContext
                : typeof afterContext === "number"
                    ? afterContext
                    : undefined;
            const maxLimit = typeof head_limit === "number" ? head_limit : 100;
            // 执行搜索
            let results;
            if (stats.isFile()) {
                // 搜索单个文件
                const { matches, count } = await this.searchFile(basePath, regex, {
                    outputMode,
                    beforeContext: beforeCtx,
                    afterContext: afterCtx,
                });
                results = {
                    matches,
                    files: count > 0 ? new Set([basePath]) : new Set(),
                    counts: count > 0 ? [{ file: basePath, match_count: count }] : [],
                };
            }
            else {
                // 搜索目录
                results = await this.searchDirectory(basePath, regex, {
                    outputMode,
                    glob: typeof glob === "string" ? glob : undefined,
                    type: typeof type === "string" ? type : undefined,
                    beforeContext: beforeCtx,
                    afterContext: afterCtx,
                    headLimit: maxLimit,
                });
            }
            // 格式化结果
            const resultText = this.formatResults(results, outputMode);
            return {
                tool_id: input.tool_id,
                tool_name: input.tool_name,
                result: {
                    pattern,
                    base_path: basePath,
                    output_mode: outputMode,
                    matches: results.matches.slice(0, maxLimit),
                    files: Array.from(results.files).slice(0, maxLimit),
                    counts: results.counts.slice(0, maxLimit),
                    total_matches: results.matches.length,
                    total_files: results.files.size,
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
                result_for_assistant: `Failed to search: ${error instanceof Error ? error.message : String(error)}`,
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
//# sourceMappingURL=grep_tool.js.map