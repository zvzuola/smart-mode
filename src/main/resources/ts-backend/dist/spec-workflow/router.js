/**
 * 工作流消息路由器
 * 全局单例，管理 sessionId → SpecWorkflowExecutor 映射
 */
export class WorkflowMessageRouter {
    executors = new Map();
    /**
     * 注册工作流执行器
     */
    register(sessionId, executor) {
        const hadPrevious = this.executors.has(sessionId);
        this.executors.set(sessionId, executor);
        console.info(`[COVERAGE][Router] register | sessionId=${sessionId}, hadPrevious=${hadPrevious}, activeCount=${this.executors.size}`);
    }
    /**
     * 注销工作流执行器
     */
    unregister(sessionId) {
        const existed = this.executors.has(sessionId);
        this.executors.delete(sessionId);
        console.info(`[COVERAGE][Router] unregister | sessionId=${sessionId}, existed=${existed}, remainingCount=${this.executors.size}`);
    }
    /**
     * 获取工作流执行器
     */
    getExecutor(sessionId) {
        const executor = this.executors.get(sessionId);
        console.info(`[COVERAGE][Router] getExecutor | sessionId=${sessionId}, found=${!!executor}`);
        return executor;
    }
    /**
     * 路由用户操作到对应的工作流引擎
     * @returns 是否成功路由
     */
    routeUserAction(sessionId, action) {
        console.info(`[COVERAGE][Router] routeUserAction 入口 | sessionId=${sessionId}, actionType=${action.type}, activeExecutors=[${[...this.executors.keys()].join(',')}]`);
        const executor = this.executors.get(sessionId);
        if (!executor) {
            console.warn(`[COVERAGE][Router] routeUserAction: 无活跃工作流 | sessionId=${sessionId}`);
            return false;
        }
        if (!executor.isWaitingForAction()) {
            console.warn(`[COVERAGE][Router] routeUserAction: 工作流未在等待状态 | sessionId=${sessionId}, status=${executor.getStatus()}`);
            return false;
        }
        console.info(`[COVERAGE][Router] routeUserAction: 路由成功 | sessionId=${sessionId}, actionType=${action.type}`);
        executor.handleUserAction(action);
        return true;
    }
    /**
     * 检查是否有活跃的工作流
     */
    hasActiveWorkflow(sessionId) {
        const active = this.executors.has(sessionId);
        console.info(`[COVERAGE][Router] hasActiveWorkflow | sessionId=${sessionId}, active=${active}`);
        return active;
    }
    /**
     * 清理所有工作流
     */
    clear() {
        console.info(`[COVERAGE][Router] clear | clearingCount=${this.executors.size}`);
        this.executors.clear();
    }
}
/** 全局单例 */
export const workflowRouter = new WorkflowMessageRouter();
//# sourceMappingURL=router.js.map