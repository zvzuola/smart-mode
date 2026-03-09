/**
 * 代码执行阶段：
 * 按任务列表逐一执行代码编写/修改
 * - ExecutionAgent: AI 交互执行
 * - ExecutionPhase: Workflow 调度入口（含尾部自动编译修复子步骤）
 */
import { PhaseStatus } from "../models.js";
import { runCompilationFix } from "../compilation_fix/index.js";
import { SpecWorkflowAgent } from "./base_agent.js";
import { BasePhase } from "./base_phase.js";
export class ExecutionAgent extends SpecWorkflowAgent {
    phaseId = "execution";
    promptTemplate = "spec_execution";
    phaseName = "代码执行";
    getArtifactFileName() {
        return "execution_report.md";
    }
}
export class ExecutionPhase extends BasePhase {
    phaseId = "execution";
    phaseName = "代码执行";
    createAgent() {
        return new ExecutionAgent();
    }
    async execute(ctx, sendEvent) {
        const startTime = Date.now();
        // Step 1: AI 代码编写（复用 Agent 循环）
        const codeResult = await super.execute(ctx, sendEvent);
        if (codeResult.status === PhaseStatus.FAILED) {
            return codeResult;
        }
        // Step 2: 自动编译修复（子步骤）
        console.info(`[ExecutionPhase] 代码编写完成，开始自动编译修复 | sessionId=${ctx.sessionId}`);
        try {
            const runtimeContext = {
                session_id: ctx.sessionId,
                turn_id: ctx.turnId,
                workspace_path: ctx.workspacePath,
                signal: ctx.signal,
                model_config: this.modelConfig,
                emit_event: sendEvent,
            };
            const fixResult = await runCompilationFix({ project_abs_path: ctx.workspacePath }, runtimeContext);
            const fixSummary = [
                `\n---\n## 编译验证结果`,
                `状态: ${fixResult.final_status}`,
                `已修复: ${fixResult.fixed_count}, 剩余: ${fixResult.remaining_count}`,
            ].join("\n");
            console.info(`[ExecutionPhase] 编译修复完成 | status=${fixResult.final_status}, fixed=${fixResult.fixed_count}, remaining=${fixResult.remaining_count}`);
            return {
                phaseId: this.phaseId,
                status: codeResult.status,
                output: codeResult.output + fixSummary,
                artifactPath: codeResult.artifactPath,
                tokenUsage: codeResult.tokenUsage,
                startTime,
                endTime: Date.now(),
            };
        }
        catch (error) {
            console.error(`[ExecutionPhase] 编译修复异常，不影响代码执行结果 | error=${error instanceof Error ? error.message : String(error)}`);
            const errorNote = `\n---\n## 编译验证结果\n编译修复执行异常: ${error instanceof Error ? error.message : String(error)}`;
            return {
                phaseId: this.phaseId,
                status: codeResult.status,
                output: codeResult.output + errorNote,
                artifactPath: codeResult.artifactPath,
                tokenUsage: codeResult.tokenUsage,
                startTime,
                endTime: Date.now(),
            };
        }
    }
}
//# sourceMappingURL=execution-agent.js.map