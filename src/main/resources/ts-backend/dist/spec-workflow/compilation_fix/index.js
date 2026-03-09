import { resolveCompilationFixConfig } from "./config.js";
import { CompilationFixEngine } from "./core/engine.js";
import { parseCompilationFixInput } from "./core/schemas.js";
import { ToolRuntime } from "./runtime/tool_runtime.js";
export { resolveCompilationFixConfig } from "./config.js";
export * from "./core/models.js";
export * from "./core/schemas.js";
export async function runCompilationFix(rawInput, context) {
    console.info("[CompilationFixEntry] 开始执行 runCompilationFix");
    const parsedInput = parseCompilationFixInput(rawInput);
    const config = resolveCompilationFixConfig();
    console.info(`[CompilationFixEntry] 输入解析完成: project=${parsedInput.project_abs_path}, max_rounds=${config.maxStrategyFixRounds}`);
    console.info(`[CompilationFixEntry] 配置: mode=${config.mode}, max_tasks=${config.maxConcurrentTasks}, timeout=${config.taskTimeoutSec}s`);
    const runtime = new ToolRuntime(context);
    const engine = new CompilationFixEngine(runtime, config);
    const response = await engine.run(parsedInput, context.signal);
    console.info(`[CompilationFixEntry] 执行完成: status=${response.final_status}, fixed=${response.fixed_count}, remaining=${response.remaining_count}, duration=${response.metrics.duration_ms}ms`);
    return response;
}
//# sourceMappingURL=index.js.map