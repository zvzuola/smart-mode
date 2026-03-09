/**
 * 架构设计阶段：
 * 基于需求文档，设计技术架构、模块划分、接口定义
 * - DesignAgent: AI 交互执行
 * - DesignPhase: Workflow 调度入口
 */
import { SpecWorkflowAgent } from "./base_agent.js";
import { BasePhase } from "./base_phase.js";
export class DesignAgent extends SpecWorkflowAgent {
    phaseId = "design";
    promptTemplate = "spec_design";
    phaseName = "架构设计";
    getArtifactFileName() {
        return "design.md";
    }
}
export class DesignPhase extends BasePhase {
    phaseId = "design";
    phaseName = "架构设计";
    createAgent() {
        return new DesignAgent();
    }
}
//# sourceMappingURL=design-agent.js.map