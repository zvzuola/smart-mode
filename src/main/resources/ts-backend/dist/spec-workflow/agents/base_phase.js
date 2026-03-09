/**
 * Spec 工作流 Phase 基类
 * 仅承载阶段执行编排（绑定 Agent、派发 execute/feedback）
 */
export class BasePhase {
    /** 模型配置（由外部注入） */
    modelConfig;
    _agent;
    /**
     * 子类可覆盖：创建该阶段绑定的 Agent 实例。
     * 返回 undefined 表示该阶段不通过 Agent 执行（需自行覆盖 execute）。
     */
    createAgent() {
        return undefined;
    }
    /**
     * 获取（懒加载）Agent 实例，并完成模型注入。
     */
    getAgent() {
        if (!this._agent) {
            const created = this.createAgent();
            if (created) {
                created.modelConfig = this.modelConfig;
            }
            this._agent = created;
        }
        return this._agent;
    }
    /**
     * 执行阶段
     */
    async execute(ctx, sendEvent) {
        console.info(`[BasePhase] [${this.phaseId}] execute`);
        const agent = this.getAgent();
        if (!agent) {
            throw new Error(`Phase ${this.phaseId} has no agent executor`);
        }
        return agent.execute(ctx, sendEvent);
    }
    /**
     * 阶段完成后的反馈对话
     */
    async handleFeedback(ctx, sendEvent, phaseResult, feedbackMessage, feedbackHistory) {
        console.info(`[BasePhase] [${this.phaseId}] handleFeedback: "${feedbackMessage.slice(0, 100)}"`);
        const agent = this.getAgent();
        if (!agent) {
            throw new Error(`Phase ${this.phaseId} does not support feedback`);
        }
        return agent.handleFeedback(ctx, sendEvent, phaseResult, feedbackMessage, feedbackHistory);
    }
}
//# sourceMappingURL=base_phase.js.map