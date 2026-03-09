/**
 * 总结报告阶段：
 * 汇总所有阶段成果，生成最终报告
 * - SummaryAgent: AI 交互执行
 * - SummaryPhase: Workflow 调度入口
 */
import { SpecWorkflowAgent } from "./base_agent.js";
import { BasePhase } from "./base_phase.js";
export class SummaryAgent extends SpecWorkflowAgent {
    phaseId = "summary";
    promptTemplate = "spec_summary";
    phaseName = "总结报告";
    getArtifactFileName() {
        return "summary.md";
    }
}
export class SummaryPhase extends BasePhase {
    phaseId = "summary";
    phaseName = "总结报告";
    createAgent() {
        return new SummaryAgent();
    }
}
//# sourceMappingURL=summary-agent.js.map