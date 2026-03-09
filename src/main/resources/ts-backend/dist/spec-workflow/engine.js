/**
 * Spec 工作流引擎
 * 管理阶段执行顺序、状态转换、用户操作等待
 */
import { WorkflowStatus, PhaseStatus } from "./models.js";
import { saveWorkflowState } from "./persistence.js";
export class WorkflowEngine {
    status = WorkflowStatus.IDLE;
    currentPhaseIndex = 0;
    phases;
    context;
    phasesRuntime;
    // 用户操作等待机制
    _actionResolve;
    _waitingForAction = false;
    // 可变事件发送器：前端重连时更新，确保事件发到最新连接
    _sendEvent;
    constructor(phases, phasesRuntime, context) {
        this.phases = phases.sort((a, b) => a.order - b.order);
        this.phasesRuntime = phasesRuntime;
        this.context = context;
    }
    // ============ 公共方法 ============
    getStatus() {
        return this.status;
    }
    getCurrentPhase() {
        return this.phases[this.currentPhaseIndex];
    }
    isWaitingForAction() {
        return this._waitingForAction;
    }
    getContext() {
        return this.context;
    }
    getCurrentPhaseIndex() {
        return this.currentPhaseIndex;
    }
    setCurrentPhaseIndex(index) {
        this.currentPhaseIndex = index;
    }
    /**
     * 重新发送工作流定义和所有已完成阶段的事件（用于前端重连后恢复状态）
     */
    reEmitState(sendEvent) {
        this._sendEvent = sendEvent;
        this.emitWorkflowDefinition(sendEvent);
        // <= currentPhaseIndex: 当引擎处于 WAITING_FOR_USER 时，当前阶段已完成，
        // 需要重发其 phase-completed 事件（含 availableActions）
        for (let i = 0; i <= this.currentPhaseIndex && i < this.phases.length; i++) {
            const phase = this.phases[i];
            const result = this.context.phaseResults.get(phase.id);
            if (result) {
                const isLast = i >= this.phases.length - 1;
                this.emitPhaseCompleted(sendEvent, phase, this.getAvailableActions(phase, isLast), this.getCanRollbackTo(phase), result);
            }
        }
        this.emitWorkflowStatus(sendEvent);
    }
    /** 持久化当前工作流状态（best-effort，不抛异常） */
    async persistState() {
        try {
            await saveWorkflowState(this.context.workspacePath, this.context, this.status, this.currentPhaseIndex);
        }
        catch (e) {
            console.warn(`[WorkflowEngine] persistState failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    /**
     * 核心执行循环
     * 支持恢复模式：如果 context.phaseResults 已有某阶段结果，跳过执行直接进入等待循环
     */
    /**
     * 更新事件发送回调（前端 WebSocket 重连时调用）
     */
    updateSendEvent(fn) {
        this._sendEvent = fn;
    }
    async execute(initialSendEvent) {
        this._sendEvent = initialSendEvent;
        // 代理：所有内部代码引用此局部变量，自动走 this._sendEvent（支持热替换）
        const sendEvent = (evt) => this._sendEvent(evt);
        console.info(`[WorkflowEngine] execute() | sessionId=${this.context.sessionId}, phaseIndex=${this.currentPhaseIndex}, totalPhases=${this.phases.length}`);
        this.status = WorkflowStatus.RUNNING;
        this.emitWorkflowDefinition(sendEvent);
        this.emitWorkflowStatus(sendEvent);
        try {
            while (this.currentPhaseIndex < this.phases.length) {
                if (this.context.signal?.aborted) {
                    this.status = WorkflowStatus.ABORTED;
                    this.emitWorkflowStatus(sendEvent);
                    return;
                }
                const phase = this.phases[this.currentPhaseIndex];
                const runtime = this.phasesRuntime.get(phase.id);
                if (!runtime) {
                    throw new Error(`Phase runtime not found: ${phase.id}`);
                }
                // ---- 恢复模式：阶段已有结果，跳过执行 ----
                let result;
                const existingResult = this.context.phaseResults.get(phase.id);
                if (existingResult) {
                    console.info(`[WorkflowEngine] RESTORE: skipping phase ${phase.id} (already completed)`);
                    result = existingResult;
                }
                else {
                    // ---- 正常模式：执行阶段 Agent ----
                    console.info(`[WorkflowEngine] executing phase ${phase.id}`);
                    this.emitPhaseStarted(sendEvent, phase);
                    try {
                        const phaseStartTime = Date.now();
                        result = await runtime.execute(this.context, sendEvent);
                        console.info(`[WorkflowEngine] phase ${phase.id} done in ${Date.now() - phaseStartTime}ms`);
                    }
                    catch (error) {
                        console.error(`[WorkflowEngine] phase ${phase.id} FAILED: ${error instanceof Error ? error.message : String(error)}`);
                        result = {
                            phaseId: phase.id,
                            status: PhaseStatus.FAILED,
                            output: error instanceof Error ? error.message : String(error),
                            tokenUsage: { input: 0, output: 0 },
                            startTime: Date.now(),
                            endTime: Date.now(),
                        };
                    }
                    this.context.phaseResults.set(phase.id, result);
                    this.context.executionHistory.push(phase.id);
                    // 自动持久化工作流状态
                    await this.persistState();
                }
                // 4. 发送阶段完成事件
                const isLastPhase = this.currentPhaseIndex >= this.phases.length - 1;
                const availableActions = this.getAvailableActions(phase, isLastPhase);
                const canRollbackTo = this.getCanRollbackTo(phase);
                this.emitPhaseCompleted(sendEvent, phase, availableActions, canRollbackTo, result);
                // 5. 进入用户操作等待内循环
                let exitInnerLoop = false;
                while (!exitInnerLoop) {
                    this.status = WorkflowStatus.WAITING_FOR_USER;
                    this.emitWorkflowStatus(sendEvent);
                    const action = await this.waitForUserAction();
                    console.info(`[WorkflowEngine] action received: ${action.type} at phase ${phase.id}`);
                    if (this.context.signal?.aborted) {
                        this.status = WorkflowStatus.ABORTED;
                        this.emitWorkflowStatus(sendEvent);
                        return;
                    }
                    switch (action.type) {
                        case "feedback": {
                            this.status = WorkflowStatus.RUNNING;
                            this.emitWorkflowStatus(sendEvent);
                            const prevResult = this.context.phaseResults.get(phase.id);
                            if (!prevResult || !runtime) {
                                console.warn(`[WorkflowEngine] feedback: missing result or runtime for ${phase.id}`);
                                break;
                            }
                            if (!this.context.feedbackHistory.has(phase.id)) {
                                this.context.feedbackHistory.set(phase.id, []);
                            }
                            const history = this.context.feedbackHistory.get(phase.id);
                            const originalTurnId = this.context.turnId;
                            if (action.turnId) {
                                this.context.turnId = action.turnId;
                            }
                            try {
                                const responseText = await runtime.handleFeedback(this.context, sendEvent, prevResult, action.message, history);
                                history.push({ role: "user", content: action.message });
                                history.push({ role: "assistant", content: responseText });
                                // 自动持久化
                                await this.persistState();
                            }
                            catch (error) {
                                console.error(`[WorkflowEngine] feedback error: ${error instanceof Error ? error.message : String(error)}`);
                                this.emitWorkflowError(sendEvent, error instanceof Error ? error.message : String(error), phase.id);
                            }
                            finally {
                                if (action.turnId) {
                                    this.context.turnId = originalTurnId;
                                }
                            }
                            this.emitPhaseCompleted(sendEvent, phase, availableActions, canRollbackTo, prevResult);
                            break;
                        }
                        case "next_phase":
                            this.currentPhaseIndex++;
                            exitInnerLoop = true;
                            break;
                        case "rollback": {
                            try {
                                const cleanedPhases = this.rollbackToPhase(action.targetPhase);
                                this.emitRollback(sendEvent, action.targetPhase, cleanedPhases);
                                await this.persistState();
                            }
                            catch (error) {
                                this.emitWorkflowError(sendEvent, error instanceof Error ? error.message : String(error), phase.id);
                            }
                            exitInnerLoop = true;
                            break;
                        }
                        case "edit": {
                            if (action.feedback) {
                                const prevResult = this.context.phaseResults.get(phase.id);
                                if (prevResult) {
                                    prevResult.output += `\n\n[用户反馈]: ${action.feedback}`;
                                }
                            }
                            this.context.phaseResults.delete(phase.id);
                            this.context.feedbackHistory.delete(phase.id);
                            await this.persistState();
                            exitInnerLoop = true;
                            break;
                        }
                        case "complete_workflow":
                            this.currentPhaseIndex = this.phases.length;
                            exitInnerLoop = true;
                            break;
                        case "abort":
                            this.status = WorkflowStatus.ABORTED;
                            this.emitWorkflowStatus(sendEvent);
                            return;
                    }
                }
                this.status = WorkflowStatus.RUNNING;
                this.emitWorkflowStatus(sendEvent);
            }
            // 工作流完成
            this.status = WorkflowStatus.COMPLETED;
            this.emitWorkflowCompleted(sendEvent);
            this.emitWorkflowStatus(sendEvent);
        }
        catch (error) {
            console.error(`[WorkflowEngine] top-level error: ${error instanceof Error ? error.message : String(error)}`);
            this.status = WorkflowStatus.FAILED;
            this.emitWorkflowError(sendEvent, error instanceof Error ? error.message : String(error));
            this.emitWorkflowStatus(sendEvent);
            throw error;
        }
    }
    /**
     * 外部调用：用户提交操作
     */
    handleUserAction(action) {
        console.info(`[COVERAGE][WorkflowEngine] handleUserAction() | actionType=${action.type}, isWaiting=${this._waitingForAction}, hasResolve=${!!this._actionResolve}`);
        if (this._actionResolve && this._waitingForAction) {
            this._waitingForAction = false;
            const resolve = this._actionResolve;
            this._actionResolve = undefined;
            resolve(action);
        }
        else {
            console.warn(`[COVERAGE][WorkflowEngine] handleUserAction: 操作被忽略(未在等待状态) | actionType=${action.type}, isWaiting=${this._waitingForAction}, hasResolve=${!!this._actionResolve}`);
        }
    }
    // ============ 内部方法 ============
    waitForUserAction() {
        return new Promise((resolve) => {
            this._actionResolve = resolve;
            this._waitingForAction = true;
        });
    }
    /**
     * 回退到指定阶段，返回被清理的阶段 ID 列表
     */
    rollbackToPhase(targetPhase) {
        const targetIndex = this.phases.findIndex((p) => p.id === targetPhase);
        if (targetIndex < 0) {
            throw new Error(`Phase not found: ${targetPhase}`);
        }
        const cleanedPhases = [];
        for (let i = targetIndex; i < this.phases.length; i++) {
            const phaseId = this.phases[i].id;
            if (this.context.phaseResults.has(phaseId)) {
                this.context.phaseResults.delete(phaseId);
                cleanedPhases.push(phaseId);
            }
        }
        // 从执行历史中移除被清理的阶段
        this.context.executionHistory = this.context.executionHistory.filter((id) => !cleanedPhases.includes(id));
        this.currentPhaseIndex = targetIndex;
        return cleanedPhases;
    }
    /**
     * 获取当前阶段可用的用户操作
     */
    getAvailableActions(currentPhase, isLastPhase = false) {
        const actions = [];
        // 最后阶段用 complete_workflow 代替 next_phase
        if (isLastPhase) {
            actions.push("complete_workflow");
        }
        else {
            actions.push("next_phase");
        }
        actions.push("edit", "feedback", "abort");
        // 如果不是第一个阶段，允许回退
        if (currentPhase.order > 0) {
            actions.push("rollback");
        }
        return actions;
    }
    // ============ 事件发送 ============
    emitWorkflowDefinition(sendEvent) {
        console.info(`[COVERAGE][WorkflowEngine] emitWorkflowDefinition | phaseCount=${this.phases.length}, currentPhaseId=${this.phases[this.currentPhaseIndex]?.id}`);
        try {
            const payload = {
                sessionId: this.context.sessionId,
                turnId: this.context.turnId,
                phases: this.phases.map((p) => ({
                    id: p.id,
                    name: p.name,
                    description: p.description,
                    order: p.order,
                    status: this.context.phaseResults.has(p.id)
                        ? (this.context.phaseResults.get(p.id).status)
                        : PhaseStatus.PENDING,
                })),
                currentPhase: this.phases[this.currentPhaseIndex].id,
            };
            sendEvent({
                event: "spec-workflow://definition",
                payload: payload,
            });
        }
        catch (error) {
            console.error(`[COVERAGE][WorkflowEngine] emitWorkflowDefinition: 事件发送异常 | error=${error instanceof Error ? error.message : String(error)}`);
        }
    }
    emitPhaseStarted(sendEvent, phase) {
        const payload = {
            sessionId: this.context.sessionId,
            turnId: this.context.turnId,
            phaseId: phase.id,
            phaseName: phase.name,
            phaseOrder: phase.order,
        };
        sendEvent({
            event: "spec-workflow://phase-started",
            payload: payload,
        });
    }
    emitPhaseCompleted(sendEvent, phase, availableActions, canRollbackTo, result) {
        const payload = {
            sessionId: this.context.sessionId,
            turnId: this.context.turnId,
            phaseId: phase.id,
            phaseName: phase.name,
            status: result.status,
            summary: result.output ? result.output.slice(0, 500) : undefined,
            availableActions,
            canRollbackTo,
            artifactPath: result.artifactPath,
        };
        sendEvent({
            event: "spec-workflow://phase-completed",
            payload: payload,
        });
    }
    emitWorkflowStatus(sendEvent) {
        const currentPhase = this.phases[this.currentPhaseIndex];
        const payload = {
            sessionId: this.context.sessionId,
            turnId: this.context.turnId,
            status: this.status,
            currentPhase: currentPhase?.id,
            executionHistory: [...this.context.executionHistory],
        };
        sendEvent({
            event: "spec-workflow://status",
            payload: payload,
        });
    }
    emitWorkflowCompleted(sendEvent) {
        let totalInput = 0;
        let totalOutput = 0;
        const results = [];
        for (const [phaseId, result] of this.context.phaseResults) {
            totalInput += result.tokenUsage.input;
            totalOutput += result.tokenUsage.output;
            results.push({
                phaseId,
                status: result.status,
                artifactPath: result.artifactPath,
                tokenUsage: result.tokenUsage,
            });
        }
        const payload = {
            sessionId: this.context.sessionId,
            turnId: this.context.turnId,
            phaseResults: results,
            totalTokenUsage: { input: totalInput, output: totalOutput },
        };
        sendEvent({
            event: "spec-workflow://completed",
            payload: payload,
        });
    }
    emitRollback(sendEvent, targetPhase, cleanedPhases) {
        const payload = {
            sessionId: this.context.sessionId,
            turnId: this.context.turnId,
            targetPhase,
            cleanedPhases,
        };
        sendEvent({
            event: "spec-workflow://rollback-completed",
            payload: payload,
        });
    }
    /**
     * 发送错误事件
     */
    emitWorkflowError(sendEvent, error, phaseId) {
        console.error(`[COVERAGE][WorkflowEngine] emitWorkflowError | phaseId=${phaseId ?? 'N/A'}, error=${error.slice(0, 300)}`);
        const payload = {
            sessionId: this.context.sessionId,
            turnId: this.context.turnId,
            error,
            phaseId,
        };
        try {
            sendEvent({
                event: "spec-workflow://error",
                payload: payload,
            });
        }
        catch (emitError) {
            console.error(`[COVERAGE][WorkflowEngine] emitWorkflowError: 事件发送本身也异常 | emitError=${emitError instanceof Error ? emitError.message : String(emitError)}`);
        }
    }
    /**
     * 获取可回退到的阶段列表
     */
    getCanRollbackTo(currentPhase) {
        const rollbackTargets = [];
        for (let i = 0; i < this.phases.length; i++) {
            const p = this.phases[i];
            if (p.order < currentPhase.order && this.context.phaseResults.has(p.id)) {
                rollbackTargets.push({
                    phase_id: p.id,
                    phase_name: p.name,
                    position: p.order,
                });
            }
        }
        return rollbackTargets;
    }
}
//# sourceMappingURL=engine.js.map