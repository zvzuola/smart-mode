/**
 * 需求分析阶段：
 * 分析用户需求，读取项目代码理解上下文，输出结构化需求文档
 * - SpecificationAgent: AI 交互执行
 * - SpecificationPhase: Workflow 调度入口
 */
import { SpecWorkflowAgent } from "./base_agent.js";
import { BasePhase } from "./base_phase.js";
export class SpecificationAgent extends SpecWorkflowAgent {
    phaseId = "specification";
    promptTemplate = "spec_specification";
    phaseName = "需求分析";
    getArtifactFileName() {
        return "requirements.md";
    }
}
export class SpecificationPhase extends BasePhase {
    phaseId = "specification";
    phaseName = "需求分析";
    createAgent() {
        return new SpecificationAgent();
    }
}
//# sourceMappingURL=specification-agent.js.map