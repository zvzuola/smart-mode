import fs from "node:fs/promises";
import { PhaseStatus } from "../models.js";
import { runCompilationFix } from "../compilation_fix/index.js";
import { BasePhase } from "./base_phase.js";
/**
 * 编译修复 Phase 编排层：
 * - 仅负责阶段控制与上下文适配（不承载通用 Agent 回合循环）
 * - 仅负责上下文适配与状态映射，核心修复逻辑继续由 compilation_fix 内核负责
 */
export class CompilationFixPhase extends BasePhase {
    phaseId = "compilation_fix";
    phaseName = "编译修复";
    lastResponse;
    inputOverride;
    async execute(ctx, sendEvent) {
        const startTime = Date.now();
        console.info(`[COVERAGE][CompilationFixAgent] execute() 入口 | sessionId=${ctx.sessionId}, workspacePath=${ctx.workspacePath}, hasInputOverride=${!!this.inputOverride}`);
        try {
            const input = this.inputOverride ?? {
                project_abs_path: ctx.workspacePath,
            };
            console.info(`[COVERAGE][CompilationFixAgent] 编译修复输入 | project_abs_path=${input.project_abs_path}`);
            const runtimeContext = {
                session_id: ctx.sessionId,
                turn_id: ctx.turnId,
                turn_index: undefined,
                workspace_path: ctx.workspacePath,
                signal: ctx.signal,
                model_config: this.modelConfig,
                emit_event: sendEvent,
            };
            const result = await runCompilationFix(input, runtimeContext);
            this.lastResponse = result;
            const output = `CompilationFix ${result.final_status}: fixed=${result.fixed_count}, remaining=${result.remaining_count}`;
            const artifactPath = this.getArtifactPath(ctx);
            console.info(`[COVERAGE][CompilationFixAgent] 编译修复完成 | status=${result.final_status}, success=${result.success}, fixed=${result.fixed_count}, remaining=${result.remaining_count}, artifactPath=${artifactPath}`);
            try {
                await fs.writeFile(artifactPath, output, "utf8");
            }
            catch (writeError) {
                console.error(`[COVERAGE][CompilationFixAgent] 产物文件写入失败 | artifactPath=${artifactPath}, error=${writeError instanceof Error ? writeError.message : String(writeError)}`);
            }
            const duration = Date.now() - startTime;
            console.info(`[COVERAGE][CompilationFixAgent] execute() 完成 | duration=${duration}ms, resultStatus=${result.success ? 'COMPLETED' : 'FAILED'}`);
            return {
                phaseId: this.phaseId,
                status: result.success ? PhaseStatus.COMPLETED : PhaseStatus.FAILED,
                output,
                artifactPath,
                tokenUsage: { input: 0, output: 0 },
                startTime,
                endTime: Date.now(),
            };
        }
        catch (error) {
            const duration = Date.now() - startTime;
            console.error(`[COVERAGE][CompilationFixAgent] execute() ❌ 异常 | duration=${duration}ms, errorType=${error instanceof Error ? error.constructor.name : typeof error}, error=${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : '');
            return {
                phaseId: this.phaseId,
                status: PhaseStatus.FAILED,
                output: error instanceof Error ? error.message : String(error),
                tokenUsage: { input: 0, output: 0 },
                startTime,
                endTime: Date.now(),
            };
        }
        finally {
            this.inputOverride = undefined;
        }
    }
    resolveNextAction(result) {
        if (result.final_status === "部分修复") {
            return "NEED_HUMAN_REVIEW";
        }
        if (result.final_status === "未修复" || result.final_status === "执行异常") {
            return "RETRY";
        }
        return "DONE";
    }
    getLastResponse() {
        return this.lastResponse;
    }
    setInputOverride(input) {
        this.inputOverride = input;
    }
    getArtifactPath(ctx) {
        return `${ctx.specDir}/compilation_fix_report.md`;
    }
}
//# sourceMappingURL=compilation-fix-agent.js.map