import { getGlobalToolRegistry } from "../../../tools/registry.js";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
function generateId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
const compilationCache = new Map();
const inFlightCompilations = new Map();
const ignoredDirNames = new Set([
    ".git",
    ".vcoder_ts",
    ".idea",
    ".vscode",
    "node_modules",
    "build",
    "dist",
    "out",
    ".hvigor",
    ".hbuilderx",
]);
const trackedFileExtensions = new Set([
    ".ets",
    ".ts",
    ".js",
    ".json",
    ".json5",
    ".hsp",
    ".har",
    ".cjs",
    ".mjs",
    ".yaml",
    ".yml",
    ".toml",
    ".xml",
    ".gradle",
]);
const trackedFileNames = new Set([
    "module.json",
    "hvigorfile.ts",
    "build-profile.json5",
    "oh-package.json5",
    "package.json",
    "tsconfig.json",
]);
function shouldSkipDir(dirName) {
    return ignoredDirNames.has(dirName.toLowerCase());
}
function shouldTrackFile(fileName) {
    const lower = fileName.toLowerCase();
    if (trackedFileNames.has(lower)) {
        return true;
    }
    const ext = path.extname(lower);
    return trackedFileExtensions.has(ext);
}
async function collectProjectFingerprintParts(projectRoot, currentPath, parts) {
    let entries;
    try {
        entries = await fs.readdir(currentPath, { withFileTypes: true });
    }
    catch (error) {
        console.warn(`[CompilationFixCompileService] 读取目录失败，跳过: ${currentPath}, error=${error instanceof Error ? error.message : String(error)}`);
        return;
    }
    for (const entry of entries) {
        const entryPath = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
            if (shouldSkipDir(entry.name)) {
                continue;
            }
            await collectProjectFingerprintParts(projectRoot, entryPath, parts);
            continue;
        }
        if (!entry.isFile()) {
            continue;
        }
        if (!shouldTrackFile(entry.name)) {
            continue;
        }
        try {
            const entryStat = await fs.stat(entryPath);
            const relativePath = path.relative(projectRoot, entryPath).replace(/\\/g, "/").toLowerCase();
            parts.push(`${relativePath}|${entryStat.size}|${Math.floor(entryStat.mtimeMs)}`);
        }
        catch (error) {
            console.warn(`[CompilationFixCompileService] 获取文件状态失败，跳过: ${entryPath}, error=${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
async function buildProjectFingerprint(projectAbsPath) {
    const normalizedRoot = path.resolve(projectAbsPath);
    const parts = [];
    await collectProjectFingerprintParts(normalizedRoot, normalizedRoot, parts);
    parts.sort();
    const digest = createHash("sha1").update(parts.join("\n")).digest("hex");
    return `${parts.length}|${digest}`;
}
function extractFullOutputPath(text) {
    const marker = /完整编译结果已保存至文件：\s*\r?\n\s*([^\r\n]+)/i;
    const matched = text.match(marker);
    if (matched?.[1]) {
        return matched[1].trim();
    }
    return undefined;
}
async function resolveFullErrorsText(rawText, fullOutputPath) {
    const pathFromMarker = extractFullOutputPath(rawText);
    const candidatePath = fullOutputPath || pathFromMarker;
    if (!candidatePath) {
        return rawText;
    }
    try {
        const fullText = await fs.readFile(candidatePath, "utf8");
        if (fullText.trim().length > 0) {
            console.info(`[CompilationFixCompileService] 读取完整编译日志成功: ${candidatePath}`);
            return fullText;
        }
    }
    catch (error) {
        console.warn(`[CompilationFixCompileService] 读取完整编译日志失败，回退截断文本: ${error instanceof Error ? error.message : String(error)}`);
    }
    return rawText;
}
function shouldCacheCompilationResult(toolResult, resultData) {
    if (resultData.success) {
        return { cacheable: true };
    }
    const executionError = typeof toolResult.error === "string" && toolResult.error.trim().length > 0;
    if (executionError) {
        return { cacheable: false, reason: "tool_execution_error" };
    }
    if (resultData.errors_text.trim().length === 0) {
        return { cacheable: false, reason: "empty_errors_text" };
    }
    return { cacheable: true };
}
export async function runCompilationCheck(project_abs_path, context) {
    const fingerprint = await buildProjectFingerprint(project_abs_path);
    const cached = compilationCache.get(project_abs_path);
    if (cached && cached.fingerprint === fingerprint) {
        console.info(`[CompilationFixCompileService] 命中编译缓存，project=${project_abs_path}`);
        return cached.result;
    }
    const pending = inFlightCompilations.get(project_abs_path);
    if (pending) {
        console.info(`[CompilationFixCompileService] 复用进行中的编译任务，project=${project_abs_path}`);
        return pending;
    }
    const runPromise = (async () => {
        console.info(`[CompilationFixCompileService] 开始调用 HmosCompilation，project=${project_abs_path}`);
        const tool = getGlobalToolRegistry().get("HmosCompilation");
        if (!tool) {
            console.error("[CompilationFixCompileService] HmosCompilation 工具未注册");
            throw new Error("HmosCompilation tool is not registered");
        }
        const input = {
            tool_id: generateId("tool"),
            tool_name: "HmosCompilation",
            arguments: { project_abs_path },
        };
        const toolContext = {
            session_id: context.session_id,
            turn_id: context.turn_id,
            turn_index: context.turn_index,
            workspace_path: context.workspace_path,
            signal: context.signal,
        };
        const output = await tool.execute(input, toolContext);
        const result = output.result;
        const resultForAssistant = output.result_for_assistant || "";
        const stderr = typeof result?.stderr === "string" ? result.stderr : "";
        const mergedErrorsText = [resultForAssistant, stderr].filter((item) => item.length > 0).join("\n");
        const fullOutputPath = typeof result?.full_output_path === "string" ? result.full_output_path : undefined;
        const errorsText = await resolveFullErrorsText(mergedErrorsText, fullOutputPath);
        const resultData = {
            success: !output.is_error,
            errors_text: output.is_error ? errorsText : "",
            raw_result: output.result,
        };
        if (resultData.success) {
            console.info("[CompilationFixCompileService] 编译检查成功");
        }
        else {
            console.info(`[CompilationFixCompileService] 编译检查失败，错误文本长度: ${resultData.errors_text.length}`);
        }
        const cacheDecision = shouldCacheCompilationResult(result, resultData);
        if (cacheDecision.cacheable) {
            compilationCache.set(project_abs_path, {
                fingerprint,
                result: resultData,
            });
        }
        else {
            console.info(`[CompilationFixCompileService] 跳过写入编译缓存，project=${project_abs_path}, reason=${cacheDecision.reason ?? "unknown"}`);
        }
        return resultData;
    })();
    inFlightCompilations.set(project_abs_path, runPromise);
    try {
        return await runPromise;
    }
    finally {
        inFlightCompilations.delete(project_abs_path);
    }
}
//# sourceMappingURL=compile_service.js.map