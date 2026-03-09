/**
 * 任务规划阶段：
 * 基于架构设计，拆分为可执行的开发任务列表
 * - PlanningAgent: AI 交互执行
 * - PlanningPhase: Workflow 调度入口
 */
import { SpecWorkflowAgent } from "./base_agent.js";
import { BasePhase } from "./base_phase.js";
export class PlanningAgent extends SpecWorkflowAgent {
    phaseId = "planning";
    promptTemplate = "spec_planning";
    phaseName = "任务规划";
    getArtifactFileName() {
        return "planning.md";
    }
}
export class PlanningPhase extends BasePhase {
    phaseId = "planning";
    phaseName = "任务规划";
    createAgent() {
        return new PlanningAgent();
    }
}
//# sourceMappingURL=planning-agent.js.map