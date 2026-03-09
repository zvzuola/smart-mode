function normalizeForSubcategory(message) {
    return message
        .replace(/'[^']*'/g, "'x'")
        .replace(/"[^"]*"/g, '"x"')
        .replace(/\b\d+\b/g, "#")
        .trim();
}
function stripAnsi(text) {
    // Normalize ANSI/terminal color control sequences before regex parsing.
    return text.replace(/\u001B\[[0-9;]*m/g, "");
}
export class ErrorClassifier {
    config;
    constructor(config) {
        this.config = config;
    }
    countErrors(errorText) {
        return this.parseErrors(errorText).length;
    }
    hasErrors(errorText) {
        if (!errorText || errorText.trim().length === 0) {
            return false;
        }
        const normalizedText = stripAnsi(errorText);
        return /(?:Error Message|错误信息)[:：]/i.test(normalizedText);
    }
    parseErrors(errorText) {
        if (!errorText || errorText.trim().length === 0) {
            console.info("[CompilationFixClassifier] 待分类错误文本为空");
            return [];
        }
        const normalizedText = stripAnsi(errorText);
        console.info(`[CompilationFixClassifier] 待分类的错误文本: ${normalizedText}`);
        const parsed = [];
        const categories = new Map();
        const errorPattern = /(?:\d+\s+)?(?:\S+\s+)?ERROR:\s*(\d+)\s+.*?[\r\n]+(?:Error Message|错误信息)[:：]\s*(.+?)\s+(?:At File|File|文件)[:：]\s*([^\r\n]+?)(?:\s|$|[\r\n])(?:[\r\n]+\*\s*Try the following:\s*[\r\n]+(?<suggestion>.*?)(?=(?:\r?\n\s*\*\s*Try:|\r?\n\s*COMPILE RESULT:|\r?\n\s*(?:\d+\s+)?(?:\S+\s+)?ERROR:|\Z)))?/gis;
        const lineColumnPattern = /:(\d+):(\d+)$/;
        const matches = [...normalizedText.matchAll(errorPattern)];
        let matchCount = 0;
        for (const match of matches) {
            matchCount += 1;
            const errorCode = match[1]?.trim();
            const message = match[2]?.trim() || "";
            const filePathWithPos = match[3]?.trim() || "";
            const suggestionRaw = match.groups?.suggestion;
            if (!errorCode || !filePathWithPos) {
                continue;
            }
            let suggestionText;
            if (suggestionRaw) {
                const suggestionLines = suggestionRaw
                    .trim()
                    .split(/\r?\n/)
                    .map((line) => line.trim())
                    .filter((line) => line.length > 0);
                const cleaned = suggestionLines.map((line) => line.replace(/^[>\s]+/, "").trim());
                const joined = cleaned.join("\n").trim();
                if (joined.length > 0) {
                    suggestionText = joined;
                }
            }
            const lineColumnMatch = filePathWithPos.match(lineColumnPattern);
            let filePath = filePathWithPos;
            let line = 0;
            let column = 0;
            if (lineColumnMatch?.[1] && lineColumnMatch?.[2]) {
                line = Number.parseInt(lineColumnMatch[1], 10) || 0;
                column = Number.parseInt(lineColumnMatch[2], 10) || 0;
                filePath = filePathWithPos.slice(0, lineColumnMatch.index).trim();
            }
            // 与 Python 版本一致：统一为正斜杠
            filePath = filePath.replace(/\\/g, "/");
            const list = categories.get(errorCode) || [];
            const duplicate = list.some((item) => item.file === filePath && item.line === line && item.column === column);
            if (duplicate) {
                console.warn(`[CompilationFixClassifier] 跳过重复错误: error_code=${errorCode}, file=${filePath}, line=${line}, column=${column}`);
                continue;
            }
            list.push({
                error_code: errorCode,
                file: filePath,
                line,
                column,
                message_details: message,
                suggestion: suggestionText,
                raw: match[0],
            });
            categories.set(errorCode, list);
        }
        if (categories.size > 0) {
            for (const errors of categories.values()) {
                parsed.push(...errors);
            }
            console.info(`[CompilationFixClassifier] 正则分类完成: 匹配到 ${matchCount} 个错误，分为 ${categories.size} 类，去重后 ${parsed.length} 个`);
            return parsed;
        }
        console.warn("[CompilationFixClassifier] 正则未匹配到任何结构化错误");
        return [];
    }
    categorizeByCode(errors) {
        console.info(`[CompilationFixClassifier] 开始按错误码分类，输入错误数: ${errors.length}`);
        const byCode = new Map();
        for (const err of errors) {
            const list = byCode.get(err.error_code) || [];
            list.push(err);
            byCode.set(err.error_code, list);
        }
        const categories = [];
        for (const [errorCode, group] of byCode.entries()) {
            categories.push({
                error_code: errorCode,
                error_message: group[0]?.message_details,
                errors: group,
                count: group.length,
                priority: 0,
                fixed_count: 0,
                remaining_count: group.length,
            });
        }
        const sorted = categories.sort((a, b) => b.count - a.count);
        console.info(`[CompilationFixClassifier] 按错误码分类完成，得到 ${sorted.length} 个分类`);
        return sorted;
    }
    categorizeByFile(errors) {
        const byFile = new Map();
        for (const err of errors) {
            const list = byFile.get(err.file) || [];
            list.push(err);
            byFile.set(err.file, list);
        }
        const categories = [];
        for (const [file, group] of byFile.entries()) {
            categories.push({
                error_file_path: file,
                errors: group,
                count: group.length,
                priority: group.length,
                fixed_count: 0,
                remaining_count: group.length,
            });
        }
        return categories.sort((a, b) => b.count - a.count);
    }
    subcategorize(categories) {
        console.info(`[CompilationFixClassifier] 开始二次分类，输入分类数: ${categories.length}`);
        const result = [];
        for (const category of categories) {
            const shouldSubcategorize = this.config.subCategorizationWhitelist.includes(category.error_code) &&
                category.count >= this.config.subCategorizationThreshold;
            if (!shouldSubcategorize) {
                result.push(category);
                continue;
            }
            console.info(`[CompilationFixClassifier] 错误码 ${category.error_code} 触发二次分类，错误数量: ${category.count}`);
            const byPattern = new Map();
            for (const err of category.errors) {
                const key = normalizeForSubcategory(err.message_details);
                const list = byPattern.get(key) || [];
                list.push(err);
                byPattern.set(key, list);
            }
            for (const [pattern, grouped] of byPattern.entries()) {
                result.push({
                    error_code: category.error_code,
                    error_message: pattern,
                    errors: grouped,
                    count: grouped.length,
                    priority: category.priority,
                    fixed_count: 0,
                    remaining_count: grouped.length,
                });
                console.info(`[CompilationFixClassifier] 错误码 ${category.error_code} 子类 pattern="${pattern.slice(0, 80)}" 数量: ${grouped.length}`);
            }
        }
        console.info(`[CompilationFixClassifier] 二次分类完成，输出分类数: ${result.length}`);
        return result;
    }
    extractHighDensityFileCategories(categories) {
        const fileMap = new Map();
        for (const category of categories) {
            for (const err of category.errors) {
                const list = fileMap.get(err.file) || [];
                list.push(err);
                fileMap.set(err.file, list);
            }
        }
        const highDensityFiles = new Set();
        const fileCategories = [];
        for (const [file, errors] of fileMap.entries()) {
            if (errors.length >= this.config.highDensityThreshold) {
                highDensityFiles.add(file);
                fileCategories.push({
                    error_file_path: file,
                    errors,
                    count: errors.length,
                    priority: errors.length,
                    fixed_count: 0,
                    remaining_count: errors.length,
                });
            }
        }
        console.info(`[CompilationFixClassifier] 识别到 ${highDensityFiles.size} 个高密度文件（阈值>=${this.config.highDensityThreshold}）`);
        const codeCategories = [];
        for (const category of categories) {
            const left = category.errors.filter((err) => !highDensityFiles.has(err.file));
            if (left.length === 0) {
                continue;
            }
            codeCategories.push({
                ...category,
                errors: left,
                count: left.length,
                remaining_count: left.length,
            });
        }
        console.info(`[CompilationFixClassifier] 文件级关联分析后：文件分类 ${fileCategories.length} 个, 错误码分类 ${codeCategories.length} 个`);
        return { fileCategories, codeCategories };
    }
    mergeSmallFileCategories(categories) {
        const merged = this.mergeSmallCategoriesGeneric(categories, (item) => item.count);
        console.info(`[CompilationFixClassifier] 文件级小类合并后，分为 ${merged.length} 组`);
        return merged;
    }
    mergeSmallCodeCategories(categories) {
        const merged = this.mergeSmallCategoriesGeneric(categories, (item) => item.count);
        console.info(`[CompilationFixClassifier] 错误码小类合并后，分为 ${merged.length} 组`);
        return merged;
    }
    validateCodeCategoryErrors(category, remainingErrorsText) {
        console.info(`[CompilationFixClassifier] 开始验证错误类型: ${category.error_code}, 数量: ${category.count}`);
        if (!this.hasErrors(remainingErrorsText)) {
            const resolvedCategory = {
                ...category,
                fixed_count: category.count,
                remaining_count: 0,
            };
            return {
                updatedCategory: null,
                validationResult: {
                    code_category_errors: [resolvedCategory],
                    file_category_errors: [],
                    initial_count: category.count,
                    fixed_count: category.count,
                    remaining_count: 0,
                    modifications: ["所有错误已在之前批次中解决"],
                    final_status: "全部修复",
                    all_remaining_errors: remainingErrorsText,
                },
            };
        }
        const remaining = this.parseErrors(remainingErrorsText).filter((item) => item.error_code === category.error_code);
        const remainingExactKeyMap = new Map();
        for (const item of remaining) {
            remainingExactKeyMap.set(this.exactErrorKey(item), item);
        }
        const validErrors = [];
        const fixedErrors = [];
        const updatedLineErrors = [];
        for (const original of category.errors) {
            const exact = remainingExactKeyMap.get(this.exactErrorKey(original));
            if (exact) {
                validErrors.push(original);
                continue;
            }
            // 行号漂移匹配（与 Python 逻辑对齐）：
            // 1) 优先 code_context 精确匹配；
            // 2) 再使用归一化 message 回退匹配。
            const shiftedByContext = remaining.find((item) => {
                if (item.file !== original.file || item.error_code !== original.error_code) {
                    return false;
                }
                if (!item.code_context || !original.code_context) {
                    return false;
                }
                return item.code_context.trim() === original.code_context.trim();
            });
            const shiftedByMessage = remaining.find((item) => item.file === original.file &&
                item.error_code === original.error_code &&
                normalizeForSubcategory(item.message_details) === normalizeForSubcategory(original.message_details));
            const shifted = shiftedByContext || shiftedByMessage;
            if (shifted) {
                validErrors.push({
                    ...original,
                    line: shifted.line,
                    column: shifted.column,
                    code_context: shifted.code_context ?? original.code_context,
                });
                updatedLineErrors.push(original);
                continue;
            }
            fixedErrors.push(original);
        }
        if (validErrors.length === 0) {
            console.info(`[CompilationFixClassifier] 错误类型 ${category.error_code} 已全部修复`);
            const resolvedCategory = {
                ...category,
                fixed_count: category.count,
                remaining_count: 0,
            };
            return {
                updatedCategory: null,
                validationResult: {
                    code_category_errors: [resolvedCategory],
                    file_category_errors: [],
                    initial_count: category.count,
                    fixed_count: category.count,
                    remaining_count: 0,
                    modifications: ["所有错误已在之前批次中解决"],
                    final_status: "全部修复",
                    all_remaining_errors: remainingErrorsText,
                },
            };
        }
        if (fixedErrors.length > 0 || updatedLineErrors.length > 0) {
            const updatedCategory = {
                ...category,
                errors: validErrors,
                count: validErrors.length,
                fixed_count: fixedErrors.length,
                remaining_count: validErrors.length,
            };
            const modifications = [];
            if (fixedErrors.length > 0) {
                modifications.push(`${fixedErrors.length} 个错误已在之前批次中解决`);
            }
            if (updatedLineErrors.length > 0) {
                modifications.push(`${updatedLineErrors.length} 个错误发生行号漂移并已更新`);
            }
            console.info(`[CompilationFixClassifier] 错误类型 ${category.error_code} 验证完成, 仍然存在: ${validErrors.length}, ` +
                `已修复: ${fixedErrors.length}, 行号更新: ${updatedLineErrors.length}`);
            return {
                updatedCategory,
                validationResult: {
                    code_category_errors: [updatedCategory],
                    file_category_errors: [],
                    initial_count: category.count,
                    fixed_count: fixedErrors.length,
                    remaining_count: updatedCategory.count,
                    modifications,
                    final_status: fixedErrors.length > 0 ? "部分修复" : "未修复",
                    all_remaining_errors: remainingErrorsText,
                },
            };
        }
        console.info(`[CompilationFixClassifier] 错误类型 ${category.error_code} 验证完成, 仍然存在: ${validErrors.length}, 已修复: 0, 行号更新: 0`);
        return {
            updatedCategory: {
                ...category,
                fixed_count: 0,
                remaining_count: category.count,
            },
        };
    }
    mergeSmallCategoriesGeneric(categories, getCount) {
        const threshold = this.config.mergeThreshold;
        const large = [];
        const small = [];
        for (const category of categories) {
            if (getCount(category) >= threshold) {
                large.push(category);
            }
            else {
                small.push(category);
            }
        }
        const result = large.map((item) => [item]);
        let current = [];
        let currentCount = 0;
        for (const item of small) {
            const size = getCount(item);
            if (current.length === 0 || currentCount + size <= threshold) {
                current.push(item);
                currentCount += size;
            }
            else {
                result.push(current);
                current = [item];
                currentCount = size;
            }
        }
        if (current.length > 0) {
            result.push(current);
        }
        return result;
    }
    extractValue(text, patterns) {
        for (const pattern of patterns) {
            const matched = text.match(pattern);
            if (matched?.[1]) {
                return matched[1].trim();
            }
        }
        return undefined;
    }
    exactErrorKey(item) {
        return `${item.error_code}|${item.file}|${item.line}|${item.column}`;
    }
}
//# sourceMappingURL=classifier.js.map