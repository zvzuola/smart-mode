import { CompilationFixExecutionMode } from "../config.js";
import { ErrorClassifier } from "./classifier.js";
import { FixResultBuilder } from "./result_builder.js";
import { CompilationFixScheduler } from "./scheduler.js";
import { applyDependencyAnalysis } from "./dependency_analyzer.js";
export class CompilationFixEngine {
    runtime;
    config;
    classifier;
    scheduler;
    resultBuilder;
    constructor(runtime, config) {
        this.runtime = runtime;
        this.config = config;
        this.classifier = new ErrorClassifier(config);
        this.scheduler = new CompilationFixScheduler(config, runtime, this.classifier);
        this.resultBuilder = new FixResultBuilder(this.classifier);
    }
    async run(input, signal) {
        const startAt = Date.now();
        const projectAbsPath = input.project_abs_path;
        let mainChatRoundIndex = 0;
        let mainChatOrder = 0;
        const nextMainChatOrder = () => {
            mainChatOrder += 1;
            return mainChatOrder;
        };
        const createMainChatRound = (prefix) => {
            mainChatRoundIndex += 1;
            const roundId = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const order = nextMainChatOrder();
            this.runtime.emit_main_chat_round_started?.(roundId, mainChatRoundIndex, order);
            return { roundId, order };
        };
        const emitMainChatText = (text) => {
            const { roundId } = createMainChatRound("cf-main");
            this.runtime.emit_main_chat_text?.(roundId, text, "text");
            return roundId;
        };
        console.info(`[CompilationFixAgent] 开始编译修复，工程路径: ${projectAbsPath}`);
        emitMainChatText("开始编译修复");
        let currentErrorText = "";
        let initialCompileSuccess = true;
        emitMainChatText("获取编译错误信息");
        console.info("[CompilationFixAgent] 开始全量编译获取错误信息...");
        const { roundId: compileRoundId } = createMainChatRound("cf-compile");
        const compileToolId = `cf-compile-${Date.now()}`;
        const compileStart = Date.now();
        this.runtime.emit_main_chat_tool_event?.(compileRoundId, {
            tool_id: compileToolId,
            tool_name: "HmosCompilation",
            event_type: "EarlyDetected",
        });
        this.runtime.emit_main_chat_tool_event?.(compileRoundId, {
            tool_id: compileToolId,
            tool_name: "HmosCompilation",
            event_type: "Started",
        });
        const compileResult = await this.runtime.compile(projectAbsPath, signal);
        this.runtime.emit_main_chat_tool_event?.(compileRoundId, {
            tool_id: compileToolId,
            tool_name: "HmosCompilation",
            event_type: "Completed",
            duration_ms: Date.now() - compileStart,
            result: compileResult.success
                ? { success: true, message: "Compilation successful", errors_text: "", raw_result: compileResult.raw_result }
                : {
                    success: false,
                    message: compileResult.errors_text?.trim() || "Compilation failed",
                    errors_text: compileResult.errors_text,
                    raw_result: compileResult.raw_result,
                },
            error: compileResult.success ? undefined : (compileResult.errors_text?.trim() || "Compilation failed"),
        });
        currentErrorText = compileResult.errors_text;
        initialCompileSuccess = compileResult.success;
        if (compileResult.success) {
            console.info("[CompilationFixAgent] 编译成功，无错误");
        }
        else {
            console.info(`[CompilationFixAgent] 获取到编译错误信息，长度: ${currentErrorText.length}`);
        }
        if (!compileResult.success && !this.classifier.hasErrors(currentErrorText)) {
            console.error("[CompilationFixAgent] 编译检查失败且未提取到可修复错误");
            return {
                success: false,
                final_status: "执行异常",
                progress: "0/0",
                fixed_count: 0,
                remaining_count: 0,
                remaining_errors: currentErrorText.trim().length > 0
                    ? currentErrorText
                    : "Compilation check failed before collecting diagnostics.",
                code_category_errors: [],
                file_category_errors: [],
                modifications: [],
                metrics: {
                    duration_ms: Date.now() - startAt,
                    rounds: 0,
                    mode: CompilationFixExecutionMode.SERIAL,
                },
            };
        }
        if (!this.classifier.hasErrors(currentErrorText)) {
            console.info("[CompilationFixAgent] 未检测到编译错误，直接返回");
            emitMainChatText("未检测到编译错误，直接返回");
            return {
                success: initialCompileSuccess,
                final_status: initialCompileSuccess ? "全部修复" : "执行异常",
                progress: "0/0",
                fixed_count: 0,
                remaining_count: 0,
                remaining_errors: "",
                code_category_errors: [],
                file_category_errors: [],
                modifications: [],
                metrics: {
                    duration_ms: Date.now() - startAt,
                    rounds: 0,
                    mode: CompilationFixExecutionMode.SERIAL,
                },
            };
        }
        const initialErrors = this.classifier.parseErrors(currentErrorText);
        const totalErrors = initialErrors.length;
        const maxRounds = this.config.maxStrategyFixRounds;
        console.info("[CompilationFixAgent] === 智能分批模式（Batch Fix Mode）===");
        console.info(`[CompilationFixAgent] 发现 ${totalErrors} 个编译错误`);
        const allResults = [];
        const allBatchSummaries = [];
        let rounds = 0;
        let parsedForNextRound = initialErrors;
        for (let round = 1; round <= maxRounds; round += 1) {
            rounds = round;
            console.info(`[CompilationFixAgent] === 第${round}轮智能分批修复 ===`);
            const roundStartMainChatRoundId = emitMainChatText(`开始第${round}轮修复`);
            this.runtime.emit_main_chat_panel_marker?.(round, roundStartMainChatRoundId, nextMainChatOrder());
            const parsed = parsedForNextRound;
            if (parsed.length === 0) {
                console.info(`[CompilationFixAgent] 第${round}轮开始时无剩余错误，提前结束`);
                break;
            }
            const categorized = this.classifier.categorizeByCode(parsed);
            const split = this.classifier.extractHighDensityFileCategories(categorized);
            const subCategorized = this.classifier.subcategorize(split.codeCategories);
            const analyzed = applyDependencyAnalysis({
                fileCategories: split.fileCategories,
                codeCategories: subCategorized,
                threshold: this.config.dependencyAnalysisThreshold,
            });
            const fileGroups = this.classifier.mergeSmallFileCategories(analyzed.fileCategories);
            const codeGroups = this.classifier.mergeSmallCodeCategories(analyzed.codeCategories);
            console.info(`[CompilationFixAgent] 文件级小类合并后，分为 ${fileGroups.length} 组；` +
                `错误码小类合并后，分为 ${codeGroups.length} 组`);
            console.info(`[CompilationFixAgent] 第${round}轮执行模式: ${this.config.mode}`);
            const executed = await this.scheduler.execute(projectAbsPath, fileGroups, codeGroups, round);
            allResults.push(...executed.fix_results);
            allBatchSummaries.push(...executed.batch_summaries);
            currentErrorText = executed.remaining_errors_text;
            parsedForNextRound = this.classifier.parseErrors(currentErrorText);
            const remaining = parsedForNextRound.length;
            console.info(`[CompilationFixAgent] 第${round}轮修复后剩余错误数: ${remaining}`);
            emitMainChatText(`剩余错误数：${remaining}`);
            if (remaining === 0) {
                console.info("[CompilationFixAgent] 所有错误已修复，提前结束");
                break;
            }
        }
        const response = this.resultBuilder.build(allResults, totalErrors, currentErrorText, Date.now() - startAt, rounds, this.config.mode, allBatchSummaries);
        console.info(`[CompilationFixAgent] 智能分批修复完成: 初始 ${totalErrors} 个, 修复 ${response.fixed_count} 个, 剩余 ${response.remaining_count} 个`);
        emitMainChatText(`修复结束，初始错误${totalErrors}个，剩余${response.remaining_count}个`);
        return response;
    }
}
//# sourceMappingURL=engine.js.map