import { createHash } from "node:crypto";
function stableStringify(value) {
    if (value === null || value === undefined) {
        return String(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    }
    if (typeof value === "object") {
        const entries = Object.entries(value).sort((a, b) => a[0].localeCompare(b[0]));
        return `{${entries.map(([k, v]) => `${k}:${stableStringify(v)}`).join(",")}}`;
    }
    return String(value);
}
function hashText(text) {
    return createHash("sha1").update(text).digest("hex").slice(0, 12);
}
export class LoopDetector {
    config;
    recent_calls = [];
    call_hash_counter = new Map();
    failure_counter = new Map();
    detected_patterns = [];
    last_progress_round = 0;
    compilation_check_count = 0;
    total_rounds = 0;
    constructor(config = {}) {
        this.config = {
            window_size: config.window_size ?? 10,
            repeated_tool_threshold: config.repeated_tool_threshold ?? 5,
            repeated_failure_threshold: config.repeated_failure_threshold ?? 5,
            no_progress_rounds: config.no_progress_rounds ?? 5,
            compilation_loop_threshold: config.compilation_loop_threshold ?? 6,
        };
    }
    recordToolCall(tool_name, arguments_value, result_value, success, round_number) {
        const call_hash = hashText(`${tool_name}:${stableStringify(arguments_value)}`);
        const result_hash = hashText(stableStringify(result_value).slice(0, 1000));
        const record = {
            tool_name,
            arguments: arguments_value,
            call_hash,
            result_hash,
            success,
            round_number,
        };
        this.recent_calls.push(record);
        if (this.recent_calls.length > this.config.window_size) {
            this.recent_calls = this.recent_calls.slice(-this.config.window_size);
        }
        this.call_hash_counter.set(call_hash, (this.call_hash_counter.get(call_hash) || 0) + 1);
        if (!success) {
            this.failure_counter.set(call_hash, (this.failure_counter.get(call_hash) || 0) + 1);
        }
        else {
            this.last_progress_round = Math.max(this.last_progress_round, round_number);
        }
        if (tool_name === "HmosCompilation" && !success) {
            this.compilation_check_count += 1;
        }
        this.total_rounds = Math.max(this.total_rounds, round_number);
    }
    getWarningMessage() {
        const patterns = this.checkPatterns();
        const significant = patterns.filter((item) => item.severity !== "low");
        if (significant.length === 0) {
            return undefined;
        }
        const warningParts = ["⚠️ 循环检测警告：", ...significant.map((item) => `- ${item.description}`), "", "建议："];
        const patternTypes = new Set(significant.map((item) => item.pattern_type));
        if (patternTypes.has("repeated_tool")) {
            warningParts.push("• 避免使用相同参数重复调用同一工具");
        }
        if (patternTypes.has("repeated_failure")) {
            warningParts.push("• 当前方法多次失败，请尝试其他解决方案");
        }
        if (patternTypes.has("no_progress")) {
            warningParts.push("• 最近几轮没有进展，请重新思考问题或请求用户帮助");
        }
        if (patternTypes.has("compilation_loop")) {
            warningParts.push("• 编译错误多次修复失败，建议查看知识库或请求用户帮助");
        }
        if (patternTypes.has("same_result_loop")) {
            warningParts.push("• 工具调用返回相同结果，说明方法无效，请换个思路");
        }
        return warningParts.join("\n");
    }
    shouldTerminate() {
        const patterns = this.checkPatterns();
        const critical = patterns.find((item) => item.severity === "critical");
        if (critical) {
            return { stop: true, reason: critical.description };
        }
        const highCount = patterns.filter((item) => item.severity === "high").length;
        if (highCount >= 2) {
            return {
                stop: true,
                reason: patterns
                    .filter((item) => item.severity === "high")
                    .map((item) => item.description)
                    .join("; "),
            };
        }
        return { stop: false };
    }
    checkPatterns() {
        const patterns = [];
        const repeatedTool = this.detectRepeatedTool();
        if (repeatedTool) {
            patterns.push(repeatedTool);
        }
        const repeatedFailure = this.detectRepeatedFailure();
        if (repeatedFailure) {
            patterns.push(repeatedFailure);
        }
        const noProgress = this.detectNoProgress();
        if (noProgress) {
            patterns.push(noProgress);
        }
        const compilationLoop = this.detectCompilationLoop();
        if (compilationLoop) {
            patterns.push(compilationLoop);
        }
        const sameResultLoop = this.detectSameResultLoop();
        if (sameResultLoop) {
            patterns.push(sameResultLoop);
        }
        this.detected_patterns = [...this.detected_patterns, ...patterns];
        return patterns;
    }
    detectRepeatedTool() {
        if (this.recent_calls.length < this.config.repeated_tool_threshold) {
            return undefined;
        }
        const counter = new Map();
        for (const item of this.recent_calls) {
            const key = `${item.call_hash}:${item.result_hash}`;
            const prev = counter.get(key) || { count: 0, tool_name: item.tool_name };
            prev.count += 1;
            counter.set(key, prev);
        }
        let hit;
        for (const value of counter.values()) {
            if (!hit || value.count > hit.count) {
                hit = value;
            }
        }
        if (!hit || hit.count < this.config.repeated_tool_threshold) {
            return undefined;
        }
        const highThreshold = this.config.repeated_tool_threshold * 1.5;
        const severity = hit.count >= this.config.repeated_tool_threshold * 2
            ? "critical"
            : hit.count >= highThreshold
                ? "high"
                : "medium";
        return {
            pattern_type: "repeated_tool",
            description: `工具 ${hit.tool_name} 在窗口内重复调用且返回相同结果 ${hit.count} 次`,
            occurrences: hit.count,
            severity,
        };
    }
    detectRepeatedFailure() {
        let maxEntry;
        for (const [call_hash, count] of this.failure_counter.entries()) {
            if (!maxEntry || count > maxEntry.count) {
                maxEntry = { call_hash, count };
            }
        }
        if (!maxEntry || maxEntry.count < this.config.repeated_failure_threshold) {
            return undefined;
        }
        const failedCalls = this.recent_calls.filter((item) => item.call_hash === maxEntry.call_hash && !item.success);
        const sample = failedCalls[0];
        const severity = maxEntry.count >= this.config.repeated_failure_threshold * 2 ? "critical" : "high";
        return {
            pattern_type: "repeated_failure",
            description: `工具 ${sample?.tool_name || "unknown"} 相同参数连续失败 ${maxEntry.count} 次`,
            occurrences: maxEntry.count,
            severity,
        };
    }
    detectNoProgress() {
        const roundsWithoutProgress = this.total_rounds - this.last_progress_round;
        if (roundsWithoutProgress < this.config.no_progress_rounds) {
            return undefined;
        }
        const severity = roundsWithoutProgress >= this.config.no_progress_rounds * 2 ? "critical" : "high";
        return {
            pattern_type: "no_progress",
            description: `已经 ${roundsWithoutProgress} 轮没有有效进展`,
            occurrences: roundsWithoutProgress,
            severity,
        };
    }
    detectCompilationLoop() {
        if (this.compilation_check_count < this.config.compilation_loop_threshold) {
            return undefined;
        }
        const severity = this.compilation_check_count >= this.config.compilation_loop_threshold * 2 ? "critical" : "high";
        return {
            pattern_type: "compilation_loop",
            description: `HmosCompilation 已执行失败 ${this.compilation_check_count} 次，疑似编译修复循环`,
            occurrences: this.compilation_check_count,
            severity,
        };
    }
    detectSameResultLoop() {
        if (this.recent_calls.length < 3) {
            return undefined;
        }
        const resultHashCounter = new Map();
        for (const item of this.recent_calls) {
            resultHashCounter.set(item.result_hash, (resultHashCounter.get(item.result_hash) || 0) + 1);
        }
        let maxCount = 0;
        for (const count of resultHashCounter.values()) {
            if (count > maxCount) {
                maxCount = count;
            }
        }
        if (maxCount < 3) {
            return undefined;
        }
        return {
            pattern_type: "same_result_loop",
            description: `工具调用返回了 ${maxCount} 次相同结果`,
            occurrences: maxCount,
            severity: "medium",
        };
    }
    reset() {
        this.recent_calls = [];
        this.call_hash_counter.clear();
        this.failure_counter.clear();
        this.detected_patterns = [];
        this.last_progress_round = 0;
        this.compilation_check_count = 0;
        this.total_rounds = 0;
    }
    getStatistics() {
        return {
            total_rounds: this.total_rounds,
            total_tool_calls: this.recent_calls.length,
            unique_tool_calls: this.call_hash_counter.size,
            failed_calls: this.recent_calls.filter((call) => !call.success).length,
            compilation_checks: this.compilation_check_count,
            rounds_without_progress: this.total_rounds - this.last_progress_round,
            detected_patterns: this.detected_patterns.length,
            critical_patterns: this.detected_patterns.filter((item) => item.severity === "critical").length,
            high_patterns: this.detected_patterns.filter((item) => item.severity === "high").length,
        };
    }
}
//# sourceMappingURL=loop_detector.js.map