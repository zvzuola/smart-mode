export var CompilationFixExecutionMode;
(function (CompilationFixExecutionMode) {
    CompilationFixExecutionMode["MIXED_PARALLEL"] = "mixed_parallel";
    CompilationFixExecutionMode["FILE_PARALLEL"] = "file_parallel";
    CompilationFixExecutionMode["CODE_PARALLEL"] = "code_parallel";
    CompilationFixExecutionMode["SERIAL"] = "serial";
})(CompilationFixExecutionMode || (CompilationFixExecutionMode = {}));
export const DEFAULT_COMPILATION_FIX_CONFIG = {
    maxStrategyFixRounds: 5,
    mergeThreshold: 10,
    highDensityThreshold: 3,
    dependencyAnalysisThreshold: 10,
    mode: CompilationFixExecutionMode.MIXED_PARALLEL,
    maxConcurrentTasks: 5,
    taskTimeoutSec: 300,
    subCategorizationWhitelist: ["10505001"],
    subCategorizationThreshold: 10,
};
export function resolveCompilationFixConfig(workspaceConfig) {
    const merged = {
        ...DEFAULT_COMPILATION_FIX_CONFIG,
        ...(workspaceConfig || {}),
    };
    return merged;
}
//# sourceMappingURL=config.js.map