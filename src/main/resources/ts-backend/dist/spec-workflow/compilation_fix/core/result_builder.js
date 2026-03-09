function computeFinalStatus(fixedCount, remainingCount, hasExecutionException) {
    if (remainingCount === 0) {
        return "全部修复";
    }
    if (fixedCount > 0) {
        return "部分修复";
    }
    if (hasExecutionException) {
        return "执行异常";
    }
    return "未修复";
}
export class FixResultBuilder {
    classifier;
    constructor(classifier) {
        this.classifier = classifier;
    }
    build(aggregatedResults, totalErrors, remainingErrorsText, durationMs, rounds, mode, batchSummaries = []) {
        console.info(`[CompilationFixResultBuilder] 开始聚合结果: aggregated_results=${aggregatedResults.length}, total_errors=${totalErrors}, rounds=${rounds}, mode=${mode}`);
        const remainingCount = this.classifier.countErrors(remainingErrorsText);
        const fixedCount = Math.max(0, totalErrors - remainingCount);
        const hasExecutionException = aggregatedResults.some((item) => item.final_status === "执行异常");
        const finalStatus = computeFinalStatus(fixedCount, remainingCount, hasExecutionException);
        console.info(`[CompilationFixResultBuilder] 统计: fixed=${fixedCount}, remaining=${remainingCount}, has_execution_exception=${hasExecutionException}, final_status=${finalStatus}`);
        const codeCategoryErrors = aggregatedResults.flatMap((item) => item.code_category_errors);
        const fileCategoryErrors = aggregatedResults.flatMap((item) => item.file_category_errors);
        const modifications = aggregatedResults.flatMap((item) => item.modifications);
        const response = {
            success: finalStatus !== "执行异常",
            final_status: finalStatus,
            progress: `${fixedCount}/${totalErrors}`,
            fixed_count: fixedCount,
            remaining_count: remainingCount,
            remaining_errors: remainingErrorsText,
            code_category_errors: codeCategoryErrors,
            file_category_errors: fileCategoryErrors,
            modifications,
            metrics: {
                duration_ms: durationMs,
                rounds,
                mode,
            },
            batch_summaries: batchSummaries.length > 0 ? batchSummaries : undefined,
        };
        console.info(`[CompilationFixResultBuilder] 聚合完成: success=${response.success}, progress=${response.progress}, modifications=${response.modifications.length}`);
        return response;
    }
}
//# sourceMappingURL=result_builder.js.map